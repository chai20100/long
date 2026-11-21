import { isValidISODate, type StockRef } from "@/lib/stocks";

export interface DateRange {
  start: string;
  end: string;
}

export interface WatchlistBoard {
  id: string;
  name: string;
  stocks: StockRef[];
  range: DateRange;
  columns: 1 | 2 | 3 | 4 | 5 | 6;
  collapsed: boolean;
}

export interface BoardConfig {
  version: 1;
  boards: WatchlistBoard[];
  pageSize: number;
}

export const DEFAULT_STOCKS: StockRef[] = [
  { code: "603366", name: "日出东方" },
  { code: "600519", name: "贵州茅台" },
  { code: "300750", name: "宁德时代" },
  { code: "002594", name: "比亚迪" },
  { code: "600036", name: "招商银行" },
  { code: "601318", name: "中国平安" },
];

export function localISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthsAgo(months: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return localISO(target);
}

export function initialRange(): DateRange {
  return { start: monthsAgo(6), end: localISO(new Date()) };
}

export function createDefaultBoards(): WatchlistBoard[] {
  return [{
    id: "default-watchlist",
    name: "我的自选股",
    stocks: DEFAULT_STOCKS.map((stock) => ({ ...stock })),
    range: initialRange(),
    columns: 2,
    collapsed: false,
  }];
}

export function parseBoardConfig(value: unknown): BoardConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as { version?: unknown; boards?: unknown; pageSize?: unknown };
  const pageSize = input.pageSize ?? 10;
  if (
    input.version !== 1 || !Array.isArray(input.boards) || input.boards.length > 20
    || !Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 50
  ) return null;
  const boardIds = new Set<string>();
  const boards: WatchlistBoard[] = [];

  for (const candidate of input.boards) {
    if (!candidate || typeof candidate !== "object") return null;
    const board = candidate as Partial<WatchlistBoard>;
    if (
      typeof board.id !== "string" || !board.id || board.id.length > 100 || boardIds.has(board.id)
      || typeof board.name !== "string" || !board.name.trim() || board.name.length > 30
      || !Array.isArray(board.stocks)
      || !board.range || !isValidISODate(board.range.start) || !isValidISODate(board.range.end)
      || board.range.start > board.range.end
      || ![1, 2, 3, 4, 5, 6].includes(board.columns ?? 0)
      || (board.collapsed !== undefined && typeof board.collapsed !== "boolean")
    ) return null;

    const stockCodes = new Set<string>();
    const stocks: StockRef[] = [];
    for (const stock of board.stocks) {
      if (
        !stock || typeof stock !== "object" || !/^\d{6}$/.test(stock.code)
        || stockCodes.has(stock.code) || typeof stock.name !== "string" || stock.name.length > 50
      ) return null;
      stockCodes.add(stock.code);
      stocks.push({ code: stock.code, name: stock.name.trim() || stock.code });
    }

    boardIds.add(board.id);
    boards.push({
      id: board.id,
      name: board.name.trim(),
      stocks,
      range: { start: board.range.start, end: board.range.end },
      columns: board.columns as WatchlistBoard["columns"],
      collapsed: board.collapsed ?? false,
    });
  }
  return { version: 1, boards, pageSize: pageSize as number };
}
