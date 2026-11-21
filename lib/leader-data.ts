import { isValidISODate, marketFor } from "@/lib/stocks";
import type { LeaderEvent, LeaderSignal, LeaderTrade } from "@/lib/leader-strategy";

const SOURCE = "eastmoney";
const POOL_BASE = "https://push2ex.eastmoney.com";
const KLINE_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TOKEN = "7eea3edcaed734bea9cbfc24409ed989";

export interface LeaderStatement {
  bind(...values: (string | number | null)[]): LeaderStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface LeaderDatabase {
  prepare(query: string): LeaderStatement;
  batch(statements: LeaderStatement[]): Promise<unknown>;
}

interface RawPoolItem {
  c?: string | number;
  n?: string;
  p?: number;
  zdp?: number;
  amount?: number;
  hs?: number;
  lbc?: number;
  fbt?: number | string;
  lbt?: number | string;
  zbc?: number;
  hybk?: string;
  zttj?: { days?: number; ct?: number };
}

interface PoolResponse {
  rc?: number;
  data?: { pool?: RawPoolItem[] } | null;
}

interface KlineResponse {
  rc?: number;
  data?: { name?: string; klines?: string[] } | null;
}

interface NormalizedEvent {
  tradeDate: string;
  code: string;
  name: string;
  market: string;
  boardType: string;
  industry: string;
  status: "sealed" | "broken";
  price: number | null;
  pctChange: number;
  amount: number;
  turnoverRate: number;
  firstLimitTime: string | null;
  lastLimitTime: string | null;
  openCount: number;
  continuousBoards: number;
  windowDays: number;
  windowBoards: number;
}

interface LeaderEventRow {
  trade_date: string;
  stock_code: string;
  theme_id: number;
  theme_name: string;
  name: string;
  status: "sealed" | "broken";
  price: number | null;
  pct_change: number;
  amount: number;
  turnover_rate: number;
  first_limit_time: string | null;
  open_count: number;
  continuous_boards: number;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clock(value?: number | string | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  const digits = String(value).replaceAll(":", "").padStart(6, "0");
  if (!/^\d{6}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

function boardTypeFor(code: string, name: string): string {
  if (name.toUpperCase().includes("ST")) return "ST";
  if (/^(4|8|920)/.test(code)) return "北交所";
  if (/^(300|301|688)/.test(code)) return "20cm";
  return "10cm";
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

async function fetchJson(url: string, attempts = 2): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "User-Agent": "Mozilla/5.0 (compatible; KlineBoard/1.0)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`东方财富接口返回 HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("东方财富接口请求失败");
}

async function fetchPool(date: string, status: "sealed" | "broken") {
  const query = new URLSearchParams({
    ut: TOKEN,
    dpt: "wz.ztzt",
    Pageindex: "0",
    pagesize: "10000",
    sort: "fbt:asc",
    date: compactDate(date),
  });
  const path = status === "sealed" ? "getTopicZTPool" : "getTopicZBPool";
  const response = await fetchJson(`${POOL_BASE}/${path}?${query}`) as PoolResponse;
  if (response.rc !== 0 || !response.data || !Array.isArray(response.data.pool)) {
    throw new Error(`${date} 暂无${status === "sealed" ? "涨停" : "炸板"}池数据`);
  }
  return response.data.pool;
}

function normalizePoolItem(
  item: RawPoolItem,
  status: "sealed" | "broken",
  tradeDate: string,
): NormalizedEvent {
  const code = String(item.c ?? "").padStart(6, "0");
  const name = String(item.n ?? code).trim();
  if (!/^\d{6}$/.test(code) || !name) throw new Error("涨停池数据缺少股票代码或名称");
  return {
    tradeDate,
    code,
    name,
    market: marketFor(code).market,
    boardType: boardTypeFor(code, name),
    industry: String(item.hybk ?? "未分类").trim() || "未分类",
    status,
    price: item.p === undefined ? null : numberValue(item.p) / 1000,
    pctChange: numberValue(item.zdp),
    amount: numberValue(item.amount),
    turnoverRate: numberValue(item.hs),
    firstLimitTime: clock(item.fbt),
    lastLimitTime: clock(item.lbt),
    openCount: Math.max(0, Math.trunc(numberValue(item.zbc))),
    continuousBoards: status === "sealed" ? Math.max(1, Math.trunc(numberValue(item.lbc))) : 0,
    windowDays: Math.max(0, Math.trunc(numberValue(item.zttj?.days))),
    windowBoards: Math.max(0, Math.trunc(numberValue(item.zttj?.ct))),
  };
}

async function fetchShanghaiIndex(date: string) {
  const query = new URLSearchParams({
    secid: "1.000001",
    ut: TOKEN,
    klt: "101",
    fqt: "0",
    beg: compactDate(date),
    end: compactDate(date),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  const response = await fetchJson(`${KLINE_ENDPOINT}?${query}`) as KlineResponse;
  const line = response.data?.klines?.at(-1);
  if (!line) return null;
  const fields = line.split(",");
  if (fields[0] !== date || fields.length < 9) return null;
  return {
    tradeDate: fields[0],
    secid: "1.000001",
    name: response.data?.name ?? "上证指数",
    close: numberValue(fields[2]),
    pctChange: numberValue(fields[8]),
    amount: numberValue(fields[6]),
  };
}

export async function fetchTradingDates(start: string, end: string): Promise<string[]> {
  const query = new URLSearchParams({
    secid: "1.000001",
    ut: TOKEN,
    klt: "101",
    fqt: "0",
    beg: compactDate(start),
    end: compactDate(end),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  const response = await fetchJson(`${KLINE_ENDPOINT}?${query}`) as KlineResponse;
  if (response.rc !== 0 || !response.data || !Array.isArray(response.data.klines)) {
    throw new Error("交易日历暂时不可用");
  }
  return response.data.klines.flatMap((line) => {
    const date = line.split(",")[0];
    return isValidISODate(date) ? [date] : [];
  });
}

async function ensureTheme(
  db: LeaderDatabase,
  name: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  await db.prepare("INSERT INTO themes (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
    .bind(name, new Date().toISOString())
    .run();
  const row = await db.prepare("SELECT id FROM themes WHERE name = ?").bind(name).first<{ id: number }>();
  if (!row) throw new Error(`无法保存题材：${name}`);
  cache.set(name, row.id);
  return row.id;
}

async function resolveThemeIds(db: LeaderDatabase, events: NormalizedEvent[]) {
  const themes = await db.prepare("SELECT id, name FROM themes").all<{ id: number; name: string }>();
  const cache = new Map(themes.results.map((row) => [row.name, row.id]));
  const overrides = await db.prepare("SELECT stock_code, theme_id FROM stock_theme_overrides")
    .all<{ stock_code: string; theme_id: number }>();
  const overrideMap = new Map(overrides.results.map((row) => [row.stock_code, row.theme_id]));
  const resolved = new Map<string, number>();
  for (const event of events) {
    const id = overrideMap.get(event.code) ?? await ensureTheme(db, event.industry, cache);
    resolved.set(`${event.tradeDate}:${event.code}`, id);
  }
  return resolved;
}

async function replaceDailyEvents(db: LeaderDatabase, events: NormalizedEvent[], index: NonNullable<Awaited<ReturnType<typeof fetchShanghaiIndex>>>) {
  const date = events[0]?.tradeDate ?? index.tradeDate;
  const now = new Date().toISOString();
  const themeIds = await resolveThemeIds(db, events);
  const statements: LeaderStatement[] = [
    db.prepare("DELETE FROM limit_events WHERE trade_date = ?").bind(date),
    db.prepare("DELETE FROM market_indices WHERE trade_date = ?").bind(date),
  ];
  const upsertStock = db.prepare(`
    INSERT INTO stocks (code, name, market, board_type, industry, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, market = excluded.market, board_type = excluded.board_type,
      industry = excluded.industry, updated_at = excluded.updated_at
  `);
  const seenStocks = new Set<string>();
  for (const event of events) {
    if (seenStocks.has(event.code)) continue;
    seenStocks.add(event.code);
    statements.push(upsertStock.bind(
      event.code, event.name, event.market, event.boardType, event.industry, now,
    ));
  }
  const insertEvent = db.prepare(`
    INSERT INTO limit_events (
      trade_date, stock_code, theme_id, status, price, pct_change, amount,
      turnover_rate, first_limit_time, last_limit_time, open_count,
      continuous_boards, window_days, window_boards, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const event of events) {
    statements.push(insertEvent.bind(
      event.tradeDate, event.code, themeIds.get(`${event.tradeDate}:${event.code}`) ?? null,
      event.status, event.price, event.pctChange, event.amount, event.turnoverRate,
      event.firstLimitTime, event.lastLimitTime, event.openCount, event.continuousBoards,
      event.windowDays, event.windowBoards, SOURCE, now,
    ));
  }
  statements.push(db.prepare(`
    INSERT INTO market_indices (trade_date, secid, name, close, pct_change, amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(index.tradeDate, index.secid, index.name, index.close, index.pctChange, index.amount));
  await db.batch(statements);
}

export async function ingestLeaderDate(db: LeaderDatabase, date: string) {
  if (!isValidISODate(date)) throw new Error("请选择有效的交易日期");
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.prepare("INSERT INTO ingestion_runs (id, source, status, started_at) VALUES (?, ?, 'running', ?)")
    .bind(runId, SOURCE, startedAt)
    .run();
  try {
    const [sealed, broken, index] = await Promise.all([
      fetchPool(date, "sealed"),
      fetchPool(date, "broken"),
      fetchShanghaiIndex(date),
    ]);
    if (!index) throw new Error(`${date} 非交易日或指数行情不可用`);
    const byCode = new Map<string, NormalizedEvent>();
    for (const item of broken) {
      const event = normalizePoolItem(item, "broken", date);
      byCode.set(event.code, event);
    }
    for (const item of sealed) {
      const event = normalizePoolItem(item, "sealed", date);
      byCode.set(event.code, event);
    }
    const events = [...byCode.values()];
    if (!events.length) throw new Error(`${date} 涨停池和炸板池均为空，未写入数据`);
    await replaceDailyEvents(db, events, index);
    const sealedCount = events.filter((event) => event.status === "sealed").length;
    await db.prepare(`
      UPDATE ingestion_runs SET trade_date = ?, status = 'success', item_count = ?, finished_at = ?
      WHERE id = ?
    `).bind(date, events.length, new Date().toISOString(), runId).run();
    return { date, sealedCount, brokenCount: events.length - sealedCount, total: events.length };
  } catch (error) {
    await db.prepare(`
      UPDATE ingestion_runs SET trade_date = ?, status = 'failed', finished_at = ?, error = ? WHERE id = ?
    `).bind(date, new Date().toISOString(), error instanceof Error ? error.message : String(error), runId).run();
    throw error;
  }
}

export async function leaderDataCoverage(db: LeaderDatabase) {
  const row = await db.prepare(`
    SELECT MIN(trade_date) AS start, MAX(trade_date) AS end,
      COUNT(DISTINCT trade_date) AS days, COUNT(*) AS events
    FROM limit_events
  `).first<{ start: string | null; end: string | null; days: number; events: number }>();
  return {
    start: row?.start ?? null,
    end: row?.end ?? null,
    days: Number(row?.days ?? 0),
    events: Number(row?.events ?? 0),
  };
}

export async function loadLeaderEvents(db: LeaderDatabase, start: string, end: string) {
  const result = await db.prepare(`
    SELECT l.trade_date, l.stock_code, l.theme_id, t.name AS theme_name,
      s.name, l.status, l.price, l.pct_change, l.amount, l.turnover_rate,
      l.first_limit_time, l.open_count, l.continuous_boards
    FROM limit_events l
    JOIN stocks s ON s.code = l.stock_code
    JOIN themes t ON t.id = l.theme_id
    WHERE l.trade_date >= ? AND l.trade_date <= ?
    ORDER BY l.trade_date, l.theme_id, l.stock_code
  `).bind(start, end).all<LeaderEventRow>();
  return result.results.map((row): LeaderEvent => ({
    tradeDate: row.trade_date,
    stockCode: row.stock_code,
    name: row.name,
    themeId: row.theme_id,
    themeName: row.theme_name,
    status: row.status,
    price: row.price,
    pctChange: row.pct_change,
    amount: row.amount,
    turnoverRate: row.turnover_rate,
    firstLimitTime: row.first_limit_time,
    openCount: row.open_count,
    continuousBoards: row.continuous_boards,
  }));
}

interface DailyBar {
  date: string;
  close: number;
}

async function fetchDailyBars(code: string, start: string): Promise<DailyBar[]> {
  const query = new URLSearchParams({
    secid: marketFor(code).secid,
    ut: TOKEN,
    klt: "101",
    fqt: "0",
    beg: compactDate(start),
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  const response = await fetchJson(`${KLINE_ENDPOINT}?${query}`, 1) as KlineResponse;
  if (response.rc !== 0 || !response.data || !Array.isArray(response.data.klines)) {
    throw new Error("退出行情不可用");
  }
  return response.data.klines.flatMap((line) => {
    const fields = line.split(",");
    const close = numberValue(fields[2]);
    return isValidISODate(fields[0]) && close > 0 ? [{ date: fields[0], close }] : [];
  });
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export async function attachExitPrices(
  signals: LeaderSignal[],
  holdingDays: number,
  costBps: number,
): Promise<LeaderTrade[]> {
  const groups = new Map<string, LeaderSignal[]>();
  for (const signal of signals) {
    const rows = groups.get(signal.code) ?? [];
    rows.push(signal);
    groups.set(signal.code, rows);
  }
  const entries = [...groups.entries()];
  const histories = new Map<string, { bars: DailyBar[]; error: string | null }>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const [code, codeSignals] = entries[cursor];
      cursor += 1;
      const start = codeSignals.map((signal) => signal.entryDate).sort()[0];
      try {
        histories.set(code, { bars: await fetchDailyBars(code, start), error: null });
      } catch (error) {
        histories.set(code, {
          bars: [],
          error: error instanceof Error ? error.message : "退出行情请求失败",
        });
      }
    }
  }));

  return signals.map((signal) => {
    const history = histories.get(signal.code);
    const futureBars = (history?.bars ?? []).filter((bar) => bar.date > signal.entryDate);
    const exit = futureBars[holdingDays - 1] ?? null;
    const grossReturn = exit ? round((exit.close / signal.entryPrice - 1) * 100) : null;
    return {
      ...signal,
      exitDate: exit?.date ?? null,
      exitPrice: exit?.close ?? null,
      grossReturn,
      netReturn: grossReturn === null ? null : round(grossReturn - costBps / 100),
      exitError: history?.error ?? null,
    };
  });
}
