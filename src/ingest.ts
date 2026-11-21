import { fetchIndices, fetchPool, latestTradeDate, normalizePoolItem } from "./eastmoney";
import type { Env, IndexQuote, NormalizedEvent } from "./types";
import { normalizeDate } from "./utils";

const SOURCE = "eastmoney";

async function themeId(env: Env, name: string, cache: Map<string, number>): Promise<number> {
  const existing = cache.get(name);
  if (existing) return existing;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO themes (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
    .bind(name, now)
    .run();
  const row = await env.DB.prepare("SELECT id FROM themes WHERE name = ?")
    .bind(name)
    .first<{ id: number }>();
  if (!row) throw new Error(`无法创建题材：${name}`);
  cache.set(String(row.id), row.id);
  cache.set(name, row.id);
  return row.id;
}

async function resolveThemes(env: Env, events: NormalizedEvent[]) {
  const cache = new Map<string, number>();
  const themeRows = await env.DB.prepare("SELECT id, name FROM themes").all<{ id: number; name: string }>();
  for (const row of themeRows.results) {
    cache.set(row.name, row.id);
    cache.set(String(row.id), row.id);
  }
  const overrides = new Map<string, number>();
  const overrideRows = await env.DB.prepare(
    "SELECT stock_code, theme_id FROM stock_theme_overrides",
  ).all<{ stock_code: string; theme_id: number }>();
  for (const row of overrideRows.results) overrides.set(row.stock_code, row.theme_id);

  const resolved = new Map<string, number>();
  for (const event of events) {
    const override = overrides.get(event.code);
    const id = override ?? await themeId(env, event.industry, cache);
    resolved.set(`${event.tradeDate}:${event.code}`, id);
  }
  return resolved;
}

async function saveRaw(env: Env, date: string, sealed: unknown, broken: unknown, indices: unknown) {
  const options = { httpMetadata: { contentType: "application/json; charset=utf-8" } };
  await Promise.all([
    env.RAW_BUCKET.put(`raw/${SOURCE}/${date}/limit-up.json`, JSON.stringify(sealed), options),
    env.RAW_BUCKET.put(`raw/${SOURCE}/${date}/broken.json`, JSON.stringify(broken), options),
    env.RAW_BUCKET.put(`raw/${SOURCE}/${date}/indices.json`, JSON.stringify(indices), options),
  ]);
}

async function replaceDailyData(env: Env, events: NormalizedEvent[], indices: IndexQuote[]) {
  if (!events.length) throw new Error("涨停池和炸板池均为空，已取消写入");
  const date = events[0].tradeDate;
  const now = new Date().toISOString();
  const themes = await resolveThemes(env, events);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM limit_events WHERE trade_date = ?").bind(date),
    env.DB.prepare("DELETE FROM market_indices WHERE trade_date = ?").bind(date),
  ];

  const upsertStock = env.DB.prepare(`
    INSERT INTO stocks (code, name, market, board_type, industry, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      market = excluded.market,
      board_type = excluded.board_type,
      industry = excluded.industry,
      updated_at = excluded.updated_at
  `);
  const seenStocks = new Set<string>();
  for (const event of events) {
    if (seenStocks.has(event.code)) continue;
    seenStocks.add(event.code);
    statements.push(upsertStock.bind(
      event.code,
      event.name,
      event.market,
      event.boardType,
      event.industry,
      now,
    ));
  }

  const insertEvent = env.DB.prepare(`
    INSERT INTO limit_events (
      trade_date, stock_code, theme_id, status, price, pct_change, amount,
      turnover_rate, first_limit_time, last_limit_time, open_count,
      continuous_boards, window_days, window_boards, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const event of events) {
    statements.push(insertEvent.bind(
      event.tradeDate,
      event.code,
      themes.get(`${event.tradeDate}:${event.code}`),
      event.status,
      event.price,
      event.pctChange,
      event.amount,
      event.turnoverRate,
      event.firstLimitTime,
      event.lastLimitTime,
      event.openCount,
      event.continuousBoards,
      event.windowDays,
      event.windowBoards,
      event.source,
      now,
    ));
  }

  const insertIndex = env.DB.prepare(`
    INSERT INTO market_indices (trade_date, secid, name, close, pct_change, amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const quote of indices) {
    statements.push(insertIndex.bind(
      quote.tradeDate,
      quote.secid,
      quote.name,
      quote.close,
      quote.pctChange,
      quote.amount,
    ));
  }
  await env.DB.batch(statements);
}

export async function ingest(env: Env, requestedDate?: string | null) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO ingestion_runs (id, source, status, started_at) VALUES (?, ?, 'running', ?)",
  ).bind(runId, SOURCE, startedAt).run();

  let date: string | undefined;
  try {
    date = normalizeDate(requestedDate) ?? await latestTradeDate();
    await env.DB.prepare("UPDATE ingestion_runs SET trade_date = ? WHERE id = ?")
      .bind(date, runId)
      .run();
    const [sealedPool, brokenPool, indexData] = await Promise.all([
      fetchPool(date, "sealed"),
      fetchPool(date, "broken"),
      fetchIndices(date),
    ]);
    const tradingDayConfirmed = indexData.quotes.some((quote) => (
      quote.secid === "1.000001" && quote.tradeDate === date
    ));
    if (!tradingDayConfirmed) throw new Error(`${date} 非交易日或指数日线不可用，已取消写入`);
    await saveRaw(env, date, sealedPool.response, brokenPool.response, indexData.raw);

    const byCode = new Map<string, NormalizedEvent>();
    for (const item of brokenPool.items) {
      const event = normalizePoolItem(item, "broken", date);
      byCode.set(event.code, event);
    }
    for (const item of sealedPool.items) {
      const event = normalizePoolItem(item, "sealed", date);
      byCode.set(event.code, event);
    }
    const events = [...byCode.values()];
    await replaceDailyData(env, events, indexData.quotes.filter((quote) => quote.tradeDate === date));

    const sealedCount = events.filter((event) => event.status === "sealed").length;
    const brokenCount = events.length - sealedCount;
    await env.DB.prepare(`
      UPDATE ingestion_runs
      SET status = 'success', item_count = ?, finished_at = ?, error = NULL
      WHERE id = ?
    `).bind(events.length, new Date().toISOString(), runId).run();
    await env.RAW_BUCKET.put(
      `raw/${SOURCE}/${date}/last-run.json`,
      JSON.stringify({ runId, date, sealedCount, brokenCount, finishedAt: new Date().toISOString() }),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
    return { runId, date, sealedCount, brokenCount, total: events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE ingestion_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?
    `).bind(new Date().toISOString(), message, runId).run();
    throw error;
  }
}

export async function assignTheme(
  env: Env,
  requestedDate: string,
  stockCode: string,
  themeName: string,
) {
  const date = normalizeDate(requestedDate);
  if (!date || !/^\d{6}$/.test(stockCode)) throw new Error("交易日期或股票代码无效");
  const cleanName = themeName.trim();
  if (!cleanName || cleanName.length > 40) throw new Error("题材名称应为 1—40 个字符");
  const event = await env.DB.prepare(
    "SELECT stock_code FROM limit_events WHERE trade_date = ? AND stock_code = ?",
  ).bind(date, stockCode).first();
  if (!event) throw new Error("该股票不在所选日期的涨停或炸板数据中");

  const cache = new Map<string, number>();
  const id = await themeId(env, cleanName, cache);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO stock_theme_overrides (stock_code, theme_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(stock_code) DO UPDATE SET theme_id = excluded.theme_id, updated_at = excluded.updated_at
    `).bind(stockCode, id, now),
    env.DB.prepare(
      "UPDATE limit_events SET theme_id = ?, updated_at = ? WHERE trade_date = ? AND stock_code = ?",
    ).bind(id, now, date, stockCode),
  ]);
  return { date, stockCode, theme: cleanName };
}
