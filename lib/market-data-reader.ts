import type { LeaderDatabase } from "@/lib/leader-data";
import type { DailyBar, MinuteBar, StrategyStock } from "@/lib/first-divergence-strategy";

interface StoredMarketFile {
  code: string;
  frequency: "d" | "5m";
  fields: string[];
  rows: string[][];
}

interface ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MarketReaderEnv {
  DB: LeaderDatabase;
  MARKET_DATA: { get(key: string): Promise<ObjectBody | null> };
}

interface ManifestRow {
  object_key: string;
}

export function normalizeShanghaiShenzhenCode(value: string): string | null {
  const code = value.trim();
  if (!/^\d{6}$/.test(code) || /^(4|8|920)/.test(code)) return null;
  return `${/^(6|9)/.test(code) ? "sh" : "sz"}.${code}`;
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readFile(env: MarketReaderEnv, key: string): Promise<StoredMarketFile> {
  const object = await env.MARKET_DATA.get(key);
  if (!object) throw new Error(`R2 对象不存在：${key}`);
  const compressed = await object.arrayBuffer();
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as StoredMarketFile;
}

function fieldIndices(fields: string[]) {
  return Object.fromEntries(fields.map((field, index) => [field, index])) as Record<string, number>;
}

function parseDaily(file: StoredMarketFile, start: string, end: string): DailyBar[] {
  const index = fieldIndices(file.fields);
  return file.rows.filter((row) => row[index.date] >= start && row[index.date] <= end).map((row) => ({
    date: row[index.date],
    open: numberValue(row[index.open]),
    high: numberValue(row[index.high]),
    low: numberValue(row[index.low]),
    close: numberValue(row[index.close]),
    volume: numberValue(row[index.volume]),
    amount: numberValue(row[index.amount]),
  })).sort((left, right) => left.date.localeCompare(right.date));
}

function minuteTimestamp(date: string, value: string): string {
  if (/^\d{14}/.test(value)) {
    return `${date} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
  }
  return `${date} ${value}`;
}

function parseMinutes(file: StoredMarketFile, start: string, end: string): MinuteBar[] {
  const index = fieldIndices(file.fields);
  return file.rows.filter((row) => row[index.date] >= start && row[index.date] <= end).map((row) => {
    const date = row[index.date];
    return {
      timestamp: minuteTimestamp(date, row[index.time]),
      date,
      open: numberValue(row[index.open]),
      high: numberValue(row[index.high]),
      low: numberValue(row[index.low]),
      close: numberValue(row[index.close]),
      volume: numberValue(row[index.volume]),
      amount: numberValue(row[index.amount]),
    };
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

async function loadStock(
  env: MarketReaderEnv,
  code: string,
  start: string,
  end: string,
): Promise<StrategyStock> {
  const item = await env.DB.prepare("SELECT name FROM market_sync_items WHERE code = ?").bind(code)
    .first<{ name: string }>();
  if (!item) throw new Error(`${code} 尚未载入全市场股票清单`);
  const manifests = await env.DB.prepare(`
    SELECT frequency, object_key FROM market_data_objects
    WHERE code = ? AND range_start <= ? AND range_end >= ? AND frequency IN ('d', '5m')
  `).bind(code, start, end).all<{ frequency: "d" | "5m" } & ManifestRow>();
  const dailyManifest = manifests.results.find((row) => row.frequency === "d");
  const minuteManifest = manifests.results.find((row) => row.frequency === "5m");
  if (!dailyManifest || !minuteManifest) throw new Error(`${code} 尚未同步完整日线和 5 分钟线`);
  const [dailyFile, minuteFile] = await Promise.all([
    readFile(env, dailyManifest.object_key),
    readFile(env, minuteManifest.object_key),
  ]);
  const dataStart = shiftDate(start, -90);
  const dataEnd = shiftDate(end, 60);
  return {
    code,
    name: item.name,
    daily: parseDaily(dailyFile, dataStart, dataEnd),
    minutes: parseMinutes(minuteFile, dataStart, dataEnd),
  };
}

export async function loadStrategyGroup(
  env: MarketReaderEnv,
  inputCodes: string[],
  start: string,
  end: string,
): Promise<{ stocks: StrategyStock[]; missing: { code: string; error: string }[] }> {
  const stocks: StrategyStock[] = [];
  const missing: { code: string; error: string }[] = [];
  for (let offset = 0; offset < inputCodes.length; offset += 2) {
    const results = await Promise.all(inputCodes.slice(offset, offset + 2).map(async (code) => {
      try {
        return { stock: await loadStock(env, code, start, end), error: null };
      } catch (error) {
        return {
          stock: null,
          error: { code, error: error instanceof Error ? error.message : String(error) },
        };
      }
    }));
    for (const result of results) {
      if (result.stock) stocks.push(result.stock);
      if (result.error) missing.push(result.error);
    }
  }
  return { stocks, missing };
}
