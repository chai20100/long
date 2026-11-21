import { withBaostock, type BaostockKlineResult } from "@/lib/baostock";
import type { LeaderDatabase } from "@/lib/leader-data";

interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface MarketBucket {
  put(key: string, body: ArrayBuffer, options?: {
    httpMetadata?: { contentType?: string; contentEncoding?: string };
  }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export interface MarketEnv {
  DB: LeaderDatabase;
  MARKET_DATA: MarketBucket;
}

interface SyncStateRow {
  range_start: string;
  range_end: string;
  status: "ready" | "running" | "complete";
  created_at: string;
  updated_at: string;
}

interface SyncItemRow {
  code: string;
  name: string;
  market: string;
  ipo_date: string | null;
  out_date: string | null;
  listing_status: string;
  status: "pending" | "running" | "complete" | "error";
  daily_rows: number;
  minute_rows: number;
  daily_key: string | null;
  minute_key: string | null;
  attempts: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface MarketFile {
  version: 1;
  source: "baostock";
  code: string;
  frequency: "d" | "5m";
  adjust: "none";
  rangeStart: string;
  rangeEnd: string;
  fields: string[];
  rows: string[][];
}

function localDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function threeYearsAgo(end: string): string {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 3);
  return date.toISOString().slice(0, 10);
}

async function gzip(value: string): Promise<ArrayBuffer> {
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function gunzip(value: ArrayBuffer): Promise<string> {
  const stream = new Blob([value]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function objectKey(code: string, frequency: "d" | "5m", start: string, end: string): string {
  return `baostock/v1/${frequency}/${code}/${start}_${end}.json.gz`;
}

async function saveMarketObject(
  env: MarketEnv,
  code: string,
  frequency: "d" | "5m",
  start: string,
  end: string,
  data: BaostockKlineResult,
): Promise<{ key: string; rows: number; bytes: number }> {
  const key = objectKey(code, frequency, start, end);
  const file: MarketFile = {
    version: 1,
    source: "baostock",
    code,
    frequency,
    adjust: "none",
    rangeStart: start,
    rangeEnd: end,
    fields: data.fields,
    rows: data.rows,
  };
  const compressed = await gzip(JSON.stringify(file));
  await env.MARKET_DATA.put(key, compressed, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
  const first = data.rows[0];
  const last = data.rows.at(-1);
  const valueIndex = frequency === "5m" && data.fields.includes("time") ? data.fields.indexOf("time") : 0;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO market_data_objects (
      code, frequency, range_start, range_end, object_key, row_count,
      first_value, last_value, compressed_bytes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code, frequency, range_start, range_end) DO UPDATE SET
      object_key = excluded.object_key, row_count = excluded.row_count,
      first_value = excluded.first_value, last_value = excluded.last_value,
      compressed_bytes = excluded.compressed_bytes, updated_at = excluded.updated_at
  `).bind(
    code, frequency, start, end, key, data.rows.length,
    first?.[valueIndex] ?? null, last?.[valueIndex] ?? null, compressed.byteLength, now,
  ).run();
  return { key, rows: data.rows.length, bytes: compressed.byteLength };
}

export async function marketSyncStatus(env: MarketEnv) {
  const state = await env.DB.prepare("SELECT * FROM market_sync_state WHERE id = 1").first<SyncStateRow>();
  const counts = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed,
      COALESCE(SUM(daily_rows), 0) AS daily_rows,
      COALESCE(SUM(minute_rows), 0) AS minute_rows
    FROM market_sync_items
  `).first<Record<string, number>>();
  const errors = await env.DB.prepare(`
    SELECT code, name, error, attempts, updated_at FROM market_sync_items
    WHERE status = 'error' ORDER BY updated_at DESC LIMIT 8
  `).all<Pick<SyncItemRow, "code" | "name" | "error" | "attempts" | "updated_at">>();
  const lastCompleted = await env.DB.prepare(`
    SELECT code, name, daily_rows, minute_rows, finished_at FROM market_sync_items
    WHERE status = 'complete' ORDER BY finished_at DESC LIMIT 1
  `).first<Pick<SyncItemRow, "code" | "name" | "daily_rows" | "minute_rows" | "finished_at">>();
  return {
    state: state ? {
      rangeStart: state.range_start,
      rangeEnd: state.range_end,
      status: state.status,
      createdAt: state.created_at,
      updatedAt: state.updated_at,
    } : null,
    counts: {
      total: Number(counts?.total ?? 0),
      completed: Number(counts?.completed ?? 0),
      pending: Number(counts?.pending ?? 0),
      running: Number(counts?.running ?? 0),
      failed: Number(counts?.failed ?? 0),
      dailyRows: Number(counts?.daily_rows ?? 0),
      minuteRows: Number(counts?.minute_rows ?? 0),
    },
    errors: errors.results,
    lastCompleted: lastCompleted ?? null,
  };
}

export async function initializeMarketSync(env: MarketEnv) {
  const existing = await env.DB.prepare("SELECT id FROM market_sync_state WHERE id = 1").first();
  if (existing) return marketSyncStatus(env);
  const stocks = await withBaostock((client) => client.listStocks());
  const end = localDate(new Date());
  const start = threeYearsAgo(end);
  const eligible = stocks.filter((stock) => (
    /^(sh|sz)\.\d{6}$/.test(stock.code)
    && stock.type === "1"
    && (!stock.ipoDate || stock.ipoDate <= end)
    && (!stock.outDate || stock.outDate >= start)
  ));
  if (eligible.length < 1000) throw new Error("BaoStock 股票清单不完整，已取消初始化");
  const now = new Date().toISOString();
  const insert = env.DB.prepare(`
    INSERT INTO market_sync_items (
      code, name, market, ipo_date, out_date, listing_status, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(code) DO NOTHING
  `);
  for (let offset = 0; offset < eligible.length; offset += 400) {
    const statements = eligible.slice(offset, offset + 400).map((stock) => insert.bind(
      stock.code, stock.name, stock.code.slice(0, 2).toUpperCase(),
      stock.ipoDate || null, stock.outDate || null, stock.status, now,
    ));
    await env.DB.batch(statements);
  }
  await env.DB.prepare(`
    INSERT INTO market_sync_state (id, range_start, range_end, status, created_at, updated_at)
    VALUES (1, ?, ?, 'ready', ?, ?)
  `).bind(start, end, now, now).run();
  return marketSyncStatus(env);
}

async function nextPendingItem(env: MarketEnv): Promise<SyncItemRow | null> {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await env.DB.prepare(`
    UPDATE market_sync_items SET status = 'pending', updated_at = ?
    WHERE status = 'running' AND started_at < ?
  `).bind(new Date().toISOString(), staleBefore).run();
  const item = await env.DB.prepare(`
    SELECT * FROM market_sync_items WHERE status = 'pending' ORDER BY code LIMIT 1
  `).first<SyncItemRow>();
  if (!item) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE market_sync_items
    SET status = 'running', attempts = attempts + 1, error = NULL, started_at = ?, updated_at = ?
    WHERE code = ? AND status = 'pending'
  `).bind(now, now, item.code).run();
  return { ...item, status: "running", attempts: item.attempts + 1, started_at: now };
}

export async function syncNextMarketStock(env: MarketEnv) {
  const state = await env.DB.prepare("SELECT * FROM market_sync_state WHERE id = 1").first<SyncStateRow>();
  if (!state) throw new Error("请先初始化三年同步任务");
  const item = await nextPendingItem(env);
  if (!item) {
    await env.DB.prepare("UPDATE market_sync_state SET status = 'complete', updated_at = ? WHERE id = 1")
      .bind(new Date().toISOString()).run();
    return { done: true, status: await marketSyncStatus(env) };
  }
  await env.DB.prepare("UPDATE market_sync_state SET status = 'running', updated_at = ? WHERE id = 1")
    .bind(new Date().toISOString()).run();

  try {
    const listingStart = item.ipo_date && item.ipo_date > state.range_start ? item.ipo_date : state.range_start;
    const listingEnd = item.out_date && item.out_date < state.range_end ? item.out_date : state.range_end;
    const empty = { fields: [], rows: [] };
    let daily: BaostockKlineResult = empty;
    let minute: BaostockKlineResult = empty;
    if (listingStart <= listingEnd) {
      [daily, minute] = await withBaostock(async (client) => [
        await client.queryKline(item.code, listingStart, listingEnd, "d"),
        await client.queryKline(item.code, listingStart, listingEnd, "5"),
      ]);
    }
    const dailyObject = await saveMarketObject(env, item.code, "d", state.range_start, state.range_end, daily);
    const minuteObject = await saveMarketObject(env, item.code, "5m", state.range_start, state.range_end, minute);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE market_sync_items SET status = 'complete', daily_rows = ?, minute_rows = ?,
        daily_key = ?, minute_key = ?, error = NULL, finished_at = ?, updated_at = ?
      WHERE code = ?
    `).bind(
      daily.rows.length, minute.rows.length, dailyObject.key, minuteObject.key, now, now, item.code,
    ).run();
    return {
      done: false,
      item: { code: item.code, name: item.name, dailyRows: daily.rows.length, minuteRows: minute.rows.length },
      status: await marketSyncStatus(env),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE market_sync_items SET status = 'error', error = ?, finished_at = ?, updated_at = ?
      WHERE code = ?
    `).bind(message, new Date().toISOString(), new Date().toISOString(), item.code).run();
    return {
      done: false,
      item: { code: item.code, name: item.name, error: message },
      status: await marketSyncStatus(env),
    };
  }
}

export async function retryMarketSyncErrors(env: MarketEnv) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE market_sync_items SET status = 'pending', error = NULL, updated_at = ? WHERE status = 'error'
  `).bind(now).run();
  await env.DB.prepare("UPDATE market_sync_state SET status = 'ready', updated_at = ? WHERE id = 1")
    .bind(now).run();
  return marketSyncStatus(env);
}

export async function validateMarketObject(env: MarketEnv, requestedCode?: string) {
  const item = requestedCode
    ? await env.DB.prepare("SELECT * FROM market_sync_items WHERE code = ? AND status = 'complete'")
      .bind(requestedCode).first<SyncItemRow>()
    : await env.DB.prepare("SELECT * FROM market_sync_items WHERE status = 'complete' ORDER BY finished_at DESC LIMIT 1")
      .first<SyncItemRow>();
  if (!item) throw new Error("没有可校验的已完成股票");
  const checks = [];
  for (const frequency of ["d", "5m"] as const) {
    const key = frequency === "d" ? item.daily_key : item.minute_key;
    const expectedRows = frequency === "d" ? item.daily_rows : item.minute_rows;
    if (!key) throw new Error(`${item.code} 缺少 ${frequency} 对象索引`);
    const object = await env.MARKET_DATA.get(key);
    if (!object) throw new Error(`${item.code} 缺少 ${frequency} R2 对象`);
    const file = JSON.parse(await gunzip(await object.arrayBuffer())) as MarketFile;
    const valid = file.code === item.code && file.frequency === frequency
      && file.rows.length === expectedRows && file.version === 1;
    if (!valid) throw new Error(`${item.code} ${frequency} 数据校验不一致`);
    checks.push({ frequency, rows: file.rows.length, key, valid });
  }
  return { code: item.code, name: item.name, checks };
}
