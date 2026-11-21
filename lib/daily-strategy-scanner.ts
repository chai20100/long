import { fetchTradingDates, ingestLeaderDate, loadLeaderEvents, type LeaderDatabase } from "@/lib/leader-data";
import { isValidISODate, marketFor } from "@/lib/stocks";
import type { DailyBar } from "@/lib/first-divergence-strategy";
import { scanDailyStrategy, type DailyScanOptions } from "@/lib/daily-strategy-rules";
import { withBaostock } from "@/lib/baostock";

const DEFAULT_OPTIONS: DailyScanOptions = {
  minLeaderBoards: 2,
  minThemeLimitUps: 3,
  minAmountRatio: 1,
  maxThemes: 5,
};

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayShanghai(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function tradingCalendar(start: string, end: string) {
  try {
    const dates = await withBaostock((client) => client.listTradingDates(start, end));
    if (dates.length) return { dates, source: "baostock" };
  } catch {
    const dates = await fetchTradingDates(start, end);
    return { dates, source: "eastmoney" };
  }
  return { dates: await fetchTradingDates(start, end), source: "eastmoney" };
}

async function fetchStockDaily(code: string, start: string, end: string): Promise<DailyBar[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const query = new URLSearchParams({
        secid: marketFor(code).secid,
        klt: "101",
        fqt: "0",
        beg: start.replaceAll("-", ""),
        end: end.replaceAll("-", ""),
        fields1: "f1,f2,f3,f4,f5,f6",
        fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      });
      const host = attempt === 1 ? "push2.eastmoney.com" : "push2his.eastmoney.com";
      const response = await fetch(`https://${host}/api/qt/stock/kline/get?${query}`, {
        headers: {
          Accept: "application/json",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`东方财富日线 HTTP ${response.status}`);
      const body = await response.json() as { data?: { klines?: string[] } | null };
      return (body.data?.klines ?? []).map((line) => {
        const fields = line.split(",");
        return {
          date: fields[0],
          open: Number(fields[1]) || 0,
          close: Number(fields[2]) || 0,
          high: Number(fields[3]) || 0,
          low: Number(fields[4]) || 0,
          volume: Number(fields[5]) || 0,
          amount: Number(fields[6]) || 0,
        };
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("东方财富日线请求失败");
}

async function dailyHistoryForLeaders(codes: string[], start: string, end: string) {
  const dailyByCode: Record<string, DailyBar[]> = {};
  const failed = new Map<string, { code: string; error: string }>();
  for (let offset = 0; offset < codes.length; offset += 3) {
    await Promise.all(codes.slice(offset, offset + 3).map(async (code) => {
      try {
        dailyByCode[code] = await fetchStockDaily(code, start, end);
      } catch (error) {
        failed.set(code, { code, error: error instanceof Error ? error.message : String(error) });
      }
    }));
  }
  const fallbackCodes: string[] = [];
  if (failed.size) {
    try {
      await withBaostock(async (client) => {
        for (const code of failed.keys()) {
          const baoCode = `${marketFor(code).market.toLowerCase()}.${code}`;
          const result = await client.queryKline(baoCode, start, end, "d");
          const fields = Object.fromEntries(result.fields.map((field, index) => [field, index]));
          dailyByCode[code] = result.rows.map((row) => ({
            date: row[fields.date],
            open: Number(row[fields.open]) || 0,
            close: Number(row[fields.close]) || 0,
            high: Number(row[fields.high]) || 0,
            low: Number(row[fields.low]) || 0,
            volume: Number(row[fields.volume]) || 0,
            amount: Number(row[fields.amount]) || 0,
          }));
          fallbackCodes.push(code);
          failed.delete(code);
        }
      });
    } catch {
      return { dailyByCode, errors: [...failed.values()], fallbackCodes };
    }
  }
  return { dailyByCode, errors: [...failed.values()], fallbackCodes };
}

export async function runDailyCloseScan(db: LeaderDatabase, requestedDate?: string) {
  const requested = requestedDate || todayShanghai();
  if (!isValidISODate(requested)) throw new Error("扫描日期无效");
  const calendarResult = await tradingCalendar(shiftDate(requested, -25), requested);
  const calendar = calendarResult.dates;
  const scanDate = calendar.at(-1);
  if (!scanDate) throw new Error("所选日期之前没有可用交易日");
  const scanIndex = calendar.indexOf(scanDate);
  if (scanIndex < 1) throw new Error("缺少主线确认日");
  const requiredDates = calendar.slice(Math.max(0, scanIndex - 3), scanIndex + 1);
  let events = await loadLeaderEvents(db, requiredDates[0], scanDate);
  const present = new Set(events.map((event) => event.tradeDate));
  const syncedDates: string[] = [];
  for (const date of requiredDates) {
    if (present.has(date)) continue;
    await ingestLeaderDate(db, date);
    syncedDates.push(date);
  }
  if (syncedDates.length) events = await loadLeaderEvents(db, requiredDates[0], scanDate);
  const preliminary = scanDailyStrategy(events, {}, calendar, scanDate, DEFAULT_OPTIONS);
  const { dailyByCode, errors, fallbackCodes } = await dailyHistoryForLeaders(
    preliminary.requiredCodes,
    shiftDate(scanDate, -15),
    scanDate,
  );
  const result = scanDailyStrategy(events, dailyByCode, calendar, scanDate, DEFAULT_OPTIONS);
  const savedAt = new Date().toISOString();
  const payload = {
    scanDate,
    baseDate: calendar[scanIndex - 1],
    dataDates: requiredDates,
    options: DEFAULT_OPTIONS,
    candidates: result.candidates,
    watch: result.watch,
    diagnostics: {
      ...result.diagnostics,
      dataErrors: [...result.diagnostics.dataErrors, ...errors],
      autoSyncedDates: syncedDates,
      calendarSource: calendarResult.source,
      dailyFallbackCodes: fallbackCodes,
    },
    methodology: {
      candidate: "前一交易日已确认的主线龙头，在扫描日首次放量炸板或收跌断板，进入下一交易日弱转强候选。",
      watch: "扫描日仍保持连板且所属主线有效的龙头，继续等待首次分歧。",
      peers: "候选股下方的观察股用于下一交易日同一根 5 分钟 K 线的板块共振确认。",
      execution: "候选不等于买入；次日必须重新确认龙头 5 分钟封板与核心股同步走强。",
    },
    savedAt,
  };
  await db.prepare(`
    INSERT INTO daily_strategy_scans (trade_date, result, created_at) VALUES (?, ?, ?)
    ON CONFLICT(trade_date) DO UPDATE SET result = excluded.result, created_at = excluded.created_at
  `).bind(scanDate, JSON.stringify(payload), savedAt).run();
  return payload;
}

export async function getDailyCloseScan(db: LeaderDatabase, date?: string) {
  const row = date
    ? await db.prepare("SELECT result, created_at FROM daily_strategy_scans WHERE trade_date = ?").bind(date)
      .first<{ result: string; created_at: string }>()
    : await db.prepare("SELECT result, created_at FROM daily_strategy_scans ORDER BY trade_date DESC LIMIT 1")
      .first<{ result: string; created_at: string }>();
  if (!row) return null;
  return JSON.parse(row.result) as unknown;
}
