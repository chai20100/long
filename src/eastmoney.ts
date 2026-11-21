import type {
  EastmoneyPoolResponse,
  EventStatus,
  IndexQuote,
  NormalizedEvent,
  RawPoolItem,
} from "./types";
import { boardTypeFor, clock, compactDate, marketFor, normalizeDate } from "./utils";

const SOURCE = "eastmoney";
const POOL_BASE = "https://push2ex.eastmoney.com";
const KLINE_BASE = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const TOKEN = "7eea3edcaed734bea9cbfc24409ed989";

const INDICES = [
  { secid: "1.000001", name: "上证指数" },
  { secid: "0.399001", name: "深证成指" },
  { secid: "0.399006", name: "创业板指" },
];

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; AShareLeaderRadar/0.1)",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`上游接口返回 HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("上游接口请求失败");
}

export async function fetchPool(date: string, status: EventStatus) {
  const path = status === "sealed" ? "getTopicZTPool" : "getTopicZBPool";
  const query = new URLSearchParams({
    ut: TOKEN,
    dpt: "wz.ztzt",
    Pageindex: "0",
    pagesize: "10000",
    sort: "fbt:asc",
    date: compactDate(date),
  });
  const response = await fetchJson(`${POOL_BASE}/${path}?${query}`) as EastmoneyPoolResponse;
  if (response.rc !== 0 || !response.data || !Array.isArray(response.data.pool)) {
    throw new Error(`${date} 没有可用的${status === "sealed" ? "涨停" : "炸板"}池数据`);
  }
  return { response, items: response.data.pool };
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePoolItem(
  item: RawPoolItem,
  status: EventStatus,
  requestedDate: string,
): NormalizedEvent {
  const code = String(item.c ?? "").padStart(6, "0");
  const name = String(item.n ?? code).trim();
  if (!/^\d{6}$/.test(code) || !name) throw new Error("上游股票数据缺少代码或名称");
  const tradeDate = normalizeDate(requestedDate);
  if (!tradeDate) throw new Error("缺少交易日期");
  return {
    tradeDate,
    code,
    name,
    market: marketFor(code),
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
    source: SOURCE,
  };
}

interface EastmoneyKlineResponse {
  rc?: number;
  data?: {
    name?: string;
    klines?: string[];
  } | null;
}

async function fetchIndex(secid: string, fallbackName: string, date?: string): Promise<{
  quote: IndexQuote | null;
  raw: EastmoneyKlineResponse;
}> {
  const query = new URLSearchParams({
    secid,
    klt: "101",
    fqt: "1",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });
  if (date) {
    query.set("beg", compactDate(date));
    query.set("end", compactDate(date));
  } else {
    query.set("lmt", "1");
    query.set("end", "20500101");
  }
  const raw = await fetchJson(`${KLINE_BASE}?${query}`) as EastmoneyKlineResponse;
  const line = raw.data?.klines?.at(-1);
  if (!line) return { quote: null, raw };
  const fields = line.split(",");
  const tradeDate = normalizeDate(fields[0]);
  if (!tradeDate) return { quote: null, raw };
  return {
    quote: {
      tradeDate,
      secid,
      name: raw.data?.name ?? fallbackName,
      close: numberValue(fields[2]),
      pctChange: numberValue(fields[8]),
      amount: numberValue(fields[6]),
    },
    raw,
  };
}

export async function latestTradeDate(): Promise<string> {
  const { quote } = await fetchIndex(INDICES[0].secid, INDICES[0].name);
  if (!quote) throw new Error("无法从指数日线确定最近交易日");
  return quote.tradeDate;
}

export async function fetchIndices(date?: string) {
  const results = await Promise.all(
    INDICES.map(({ secid, name }) => fetchIndex(secid, name, date)),
  );
  return {
    quotes: results.flatMap((result) => result.quote ? [result.quote] : []),
    raw: results.map((result) => result.raw),
  };
}
