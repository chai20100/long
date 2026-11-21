export interface StockRef {
  code: string;
  name: string;
}

export interface KlinePoint {
  date: string;
  open: number;
  close: number;
  low: number;
  high: number;
  volume: number;
  amount: number;
  amplitude: number;
  pctChange: number;
  change: number;
  turnover: number;
}

export interface StockKline {
  code: string;
  name: string;
  market: string;
  secid: string;
  klines: KlinePoint[];
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function marketFor(code: string): { market: string; secid: string } {
  if (/^(6|9)/.test(code)) return { market: "SH", secid: `1.${code}` };
  if (/^(4|8|920)/.test(code)) return { market: "BJ", secid: `0.${code}` };
  return { market: "SZ", secid: `0.${code}` };
}
