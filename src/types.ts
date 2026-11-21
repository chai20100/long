export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  INGEST_TOKEN?: string;
}

export type EventStatus = "sealed" | "broken";

export interface RawPoolItem {
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

export interface EastmoneyPoolResponse {
  rc?: number;
  data?: {
    tc?: number;
    qdate?: number | string;
    pool?: RawPoolItem[];
  } | null;
}

export interface NormalizedEvent {
  tradeDate: string;
  code: string;
  name: string;
  market: string;
  boardType: string;
  industry: string;
  status: EventStatus;
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
  source: string;
}

export interface IndexQuote {
  tradeDate: string;
  secid: string;
  name: string;
  close: number | null;
  pctChange: number | null;
  amount: number;
}

export interface LimitEventRow {
  trade_date: string;
  stock_code: string;
  theme_id: number;
  theme_name: string;
  name: string;
  market: string;
  board_type: string;
  status: EventStatus;
  price: number | null;
  pct_change: number;
  amount: number;
  turnover_rate: number;
  first_limit_time: string | null;
  last_limit_time: string | null;
  open_count: number;
  continuous_boards: number;
  window_days: number;
  window_boards: number;
}
