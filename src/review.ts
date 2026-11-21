import type { Env, LimitEventRow } from "./types";
import { clamp, minutesSinceOpen, round } from "./utils";

async function eventRows(env: Env, date: string): Promise<LimitEventRow[]> {
  const result = await env.DB.prepare(`
    SELECT
      l.*, s.name, s.market, s.board_type, t.name AS theme_name
    FROM limit_events l
    JOIN stocks s ON s.code = l.stock_code
    JOIN themes t ON t.id = l.theme_id
    WHERE l.trade_date = ?
    ORDER BY l.theme_id, l.status, l.continuous_boards DESC, l.first_limit_time
  `).bind(date).all<LimitEventRow>();
  return result.results;
}

function stockView(row: LimitEventRow) {
  return {
    code: row.stock_code,
    name: row.name,
    market: row.market,
    boardType: row.board_type,
    status: row.status,
    price: row.price,
    pctChange: round(row.pct_change, 2),
    amount: row.amount,
    turnoverRate: round(row.turnover_rate, 2),
    firstLimitTime: row.first_limit_time,
    lastLimitTime: row.last_limit_time,
    openCount: row.open_count,
    continuousBoards: row.continuous_boards,
    windowDays: row.window_days,
    windowBoards: row.window_boards,
  };
}

function scoreStocks(rows: LimitEventRow[]) {
  const sealed = rows.filter((row) => row.status === "sealed");
  const maxBoards = Math.max(1, ...sealed.map((row) => row.continuous_boards));
  const maxAmountLog = Math.max(1, ...sealed.map((row) => Math.log1p(row.amount)));

  return sealed.map((row) => {
    const ownTime = minutesSinceOpen(row.first_limit_time);
    const followers15 = sealed.filter((other) => {
      if (other.stock_code === row.stock_code || !other.first_limit_time || !row.first_limit_time) return false;
      const difference = minutesSinceOpen(other.first_limit_time) - ownTime;
      return difference >= 0 && difference <= 15;
    }).length;
    const laterFollowers = sealed.filter((other) => (
      other.stock_code !== row.stock_code
      && other.first_limit_time
      && row.first_limit_time
      && minutesSinceOpen(other.first_limit_time) > ownTime
    )).length;
    const height = clamp(row.continuous_boards / maxBoards * 100);
    const lead = clamp(100 - (ownTime - 565) / 335 * 100);
    const drive = clamp(followers15 * 30 + laterFollowers * 10);
    const resilience = clamp(100 - row.open_count * 20);
    const continuity = clamp(row.continuous_boards * 20);
    const liquidity = clamp(Math.log1p(row.amount) / maxAmountLog * 100);
    const score = round(
      height * 0.25 + lead * 0.15 + drive * 0.20
      + resilience * 0.15 + continuity * 0.10 + liquidity * 0.15,
    );
    return {
      ...stockView(row),
      score,
      scoreBreakdown: {
        height: round(height),
        lead: round(lead),
        follow: round(drive),
        resilience: round(resilience),
        continuity: round(continuity),
        liquidity: round(liquidity),
      },
      follow15: followers15,
      laterFollowers,
      reasons: [
        `连续高度 ${row.continuous_boards} 板，题材内最高 ${maxBoards} 板`,
        `首封 ${row.first_limit_time?.slice(0, 5) ?? "时间未知"}，后15分钟同题材涨停 ${followers15} 家`,
        `炸板 ${row.open_count} 次，换手率 ${round(row.turnover_rate, 2)}%`,
      ],
    };
  }).sort((a, b) => b.score - a.score || b.continuousBoards - a.continuousBoards);
}

function previousCore(rows: LimitEventRow[]) {
  return rows.filter((row) => row.status === "sealed").sort((a, b) => (
    b.continuous_boards - a.continuous_boards
    || minutesSinceOpen(a.first_limit_time) - minutesSinceOpen(b.first_limit_time)
  ))[0];
}

function validationFor(
  current: LimitEventRow[],
  previous: LimitEventRow[],
  promoted: number,
  leaderCode?: string,
) {
  const sealed = current.filter((row) => row.status === "sealed");
  const previousSealed = previous.filter((row) => row.status === "sealed");
  const count = sealed.length;
  const previousCount = previousSealed.length;
  const maxBoards = Math.max(0, ...sealed.map((row) => row.continuous_boards));
  const previousMax = Math.max(0, ...previousSealed.map((row) => row.continuous_boards));
  let label: string;
  if (!previousCount) label = "新发酵";
  else if (!count) label = "退潮";
  else if (maxBoards > previousMax && count < previousCount) label = "高位缩圈";
  else if (promoted > 0 && count >= previousCount) label = "梯队延续";
  else if (count <= previousCount * 0.5) label = "分歧退潮";
  else if (promoted > 0) label = "缩圈晋级";
  else label = "轮动分化";

  let detail = previousCount
    ? `较前日晋级 ${promoted} 家，涨停 ${previousCount} → ${count} 家。`
    : "前五日样本中，前一交易日无同题材涨停记录。";
  const oldCore = previousCore(previousSealed);
  if (oldCore && leaderCode && oldCore.stock_code !== leaderCode) {
    const stillSealed = sealed.some((row) => row.stock_code === oldCore.stock_code);
    if (!stillSealed) detail += ` 原高标${oldCore.name}未封，当前只标记为核心切换候选。`;
  }
  return { label, detail };
}

export async function latestReviewDate(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT MAX(trade_date) AS date FROM limit_events").first<{ date: string | null }>();
  return row?.date ?? null;
}

export async function listReviewDates(env: Env, limit = 60) {
  const safeLimit = Math.min(250, Math.max(1, Math.trunc(limit)));
  const result = await env.DB.prepare(
    "SELECT DISTINCT trade_date FROM limit_events ORDER BY trade_date DESC LIMIT ?",
  ).bind(safeLimit).all<{ trade_date: string }>();
  return result.results.map((row) => row.trade_date);
}

export async function getReview(env: Env, date: string) {
  const currentRows = await eventRows(env, date);
  if (!currentRows.length) return null;

  const recentDatesResult = await env.DB.prepare(`
    SELECT DISTINCT trade_date FROM limit_events
    WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 5
  `).bind(date).all<{ trade_date: string }>();
  const recentDates = recentDatesResult.results.map((row) => row.trade_date);
  const historyEntries = await Promise.all(recentDates.map(async (historyDate) => [
    historyDate,
    historyDate === date ? currentRows : await eventRows(env, historyDate),
  ] as const));
  const history = new Map(historyEntries);
  const previousDate = recentDates.find((item) => item < date) ?? null;
  const previousRows = previousDate ? history.get(previousDate) ?? [] : [];

  const currentThemes = new Map<number, LimitEventRow[]>();
  for (const row of currentRows) {
    const rows = currentThemes.get(row.theme_id) ?? [];
    rows.push(row);
    currentThemes.set(row.theme_id, rows);
  }
  const maxThemeAmountLog = Math.max(1, ...[...currentThemes.values()].map((rows) => (
    Math.log1p(rows.filter((row) => row.status === "sealed").reduce((sum, row) => sum + row.amount, 0))
  )));

  const themes = [...currentThemes.entries()].map(([id, rows]) => {
    const sealed = rows.filter((row) => row.status === "sealed");
    const broken = rows.filter((row) => row.status === "broken");
    const scored = scoreStocks(rows);
    const previous = previousRows.filter((row) => row.theme_id === id);
    const previousByCode = new Map(previous.map((row) => [row.stock_code, row]));
    const promoted = sealed.filter((row) => {
      const old = previousByCode.get(row.stock_code);
      return old?.status === "sealed" && row.continuous_boards > old.continuous_boards;
    }).length;
    const activeDays = recentDates.filter((historyDate) => (
      (history.get(historyDate) ?? []).some((row) => row.theme_id === id && row.status === "sealed")
    )).length;
    const maxBoards = Math.max(0, ...sealed.map((row) => row.continuous_boards));
    const totalAmount = sealed.reduce((sum, row) => sum + row.amount, 0);
    const sealRate = rows.length ? sealed.length / rows.length * 100 : 0;
    const previousSealedCount = previous.filter((row) => row.status === "sealed").length;
    const promotionRate = previousSealedCount ? promoted / previousSealedCount * 100 : 50;
    const breadth = clamp(sealed.length * 20);
    const height = clamp(maxBoards / 5 * 100);
    const persistence = clamp(activeDays / 3 * 100);
    const liquidity = clamp(Math.log1p(totalAmount) / maxThemeAmountLog * 100);
    const score = round(
      breadth * 0.22 + height * 0.18 + persistence * 0.20
      + sealRate * 0.15 + promotionRate * 0.15 + liquidity * 0.10,
    );

    const levels = new Map<number, ReturnType<typeof stockView>[]>();
    for (const stock of scored) {
      const level = levels.get(stock.continuousBoards) ?? [];
      level.push(stock);
      levels.set(stock.continuousBoards, level);
    }
    const ladder = [...levels.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([level, stocks]) => ({
        level,
        stocks: stocks.sort((a, b) => minutesSinceOpen(a.firstLimitTime) - minutesSinceOpen(b.firstLimitTime)),
      }));
    const multiDay = scored.filter((stock) => (
      stock.windowDays > stock.continuousBoards && stock.windowBoards > stock.continuousBoards
    ));
    const validation = validationFor(rows, previous, promoted, scored[0]?.code);
    return {
      id,
      name: rows[0].theme_name,
      score,
      metrics: {
        limitUpCount: sealed.length,
        brokenCount: broken.length,
        maxBoards,
        activeDays,
        promotedCount: promoted,
        sealRate: round(sealRate),
        totalAmount,
      },
      scoreBreakdown: {
        breadth: round(breadth),
        height: round(height),
        persistence: round(persistence),
        seal: round(sealRate),
        promotion: round(promotionRate),
        liquidity: round(liquidity),
      },
      validation,
      leaders: scored.slice(0, 3),
      ladder: {
        continuous: ladder,
        multiDay,
        broken: broken.map(stockView),
      },
    };
  }).sort((a, b) => b.score - a.score);

  const indices = await env.DB.prepare(
    "SELECT secid, name, close, pct_change, amount FROM market_indices WHERE trade_date = ? ORDER BY secid",
  ).bind(date).all<{ secid: string; name: string; close: number; pct_change: number; amount: number }>();
  const sealedCount = currentRows.filter((row) => row.status === "sealed").length;
  const brokenCount = currentRows.length - sealedCount;
  return {
    date,
    previousDate,
    overview: {
      limitUpCount: sealedCount,
      brokenCount,
      sealRate: round(currentRows.length ? sealedCount / currentRows.length * 100 : 0),
      maxBoards: Math.max(0, ...currentRows.map((row) => row.continuous_boards)),
      indices: indices.results.map((row) => ({
        secid: row.secid,
        name: row.name,
        close: row.close,
        pctChange: row.pct_change,
        amount: row.amount,
      })),
    },
    themes,
    methodology: {
      classification: "默认使用东方财富行业分类，人工校正会覆盖后续抓取的行业归类。",
      leaderScore: "高度25%、领涨15%、后续涨停关联20%、回封15%、持续10%、流动性15%。",
      themeScore: "宽度22%、高度18%、持续20%、封板15%、晋级15%、流动性10%。",
      limitation: "题材和评分均为复盘启发式规则；首封时间关联不代表因果带动，趋势中军尚未纳入。",
    },
  };
}
