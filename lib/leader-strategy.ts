export interface LeaderEvent {
  tradeDate: string;
  stockCode: string;
  name: string;
  themeId: number;
  themeName: string;
  status: "sealed" | "broken";
  price: number | null;
  pctChange: number;
  amount: number;
  turnoverRate: number;
  firstLimitTime: string | null;
  openCount: number;
  continuousBoards: number;
}

export interface LeaderStrategyOptions {
  start: string;
  end: string;
  minThemeLimitUps: number;
  minLeaderBoards: number;
  earlyCutoff: string;
  minEarlyLimitUps: number;
  syncWindowMinutes: number;
  holdingDays: number;
  costBps: number;
}

export interface StrategyPeer {
  code: string;
  name: string;
  firstLimitTime: string;
}

export interface LeaderSignal {
  id: string;
  baseDate: string;
  divergenceDate: string;
  entryDate: string;
  themeId: number;
  themeName: string;
  code: string;
  name: string;
  leaderBoards: number;
  divergenceKind: "broken" | "opened";
  divergenceOpenCount: number;
  entryPrice: number;
  firstLimitTime: string;
  earlyLimitUps: number;
  previousEarlyLimitUps: number;
  peers: StrategyPeer[];
}

export interface LeaderTrade extends LeaderSignal {
  exitDate: string | null;
  exitPrice: number | null;
  grossReturn: number | null;
  netReturn: number | null;
  exitError: string | null;
}

export interface BacktestStats {
  signalCount: number;
  closedTrades: number;
  openTrades: number;
  failedExits: number;
  winningTrades: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  profitFactor: number | null;
  cumulativeReturn: number;
  maxDrawdown: number;
}

export const DEFAULT_LEADER_OPTIONS = {
  minThemeLimitUps: 3,
  minLeaderBoards: 2,
  earlyCutoff: "10:00",
  minEarlyLimitUps: 2,
  syncWindowMinutes: 30,
  holdingDays: 3,
  costBps: 10,
} satisfies Omit<LeaderStrategyOptions, "start" | "end">;

function clockMinutes(value: string | null): number {
  if (!value || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return Number.POSITIVE_INFINITY;
  const [hours, minutes, seconds = 0] = value.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sealedEarly(events: LeaderEvent[], themeId: number, cutoff: string) {
  const open = clockMinutes("09:30");
  const end = clockMinutes(cutoff);
  return events.filter((event) => {
    const time = clockMinutes(event.firstLimitTime);
    return event.themeId === themeId && event.status === "sealed" && time >= open && time <= end;
  });
}

export function findLeaderSignals(
  events: LeaderEvent[],
  options: LeaderStrategyOptions,
  tradingDates?: string[],
): LeaderSignal[] {
  const byDate = new Map<string, LeaderEvent[]>();
  for (const event of events) {
    const rows = byDate.get(event.tradeDate) ?? [];
    rows.push(event);
    byDate.set(event.tradeDate, rows);
  }
  const dates = tradingDates
    ? [...new Set(tradingDates)].sort()
    : [...byDate.keys()].sort();
  const signals: LeaderSignal[] = [];

  for (let index = 2; index < dates.length; index += 1) {
    const entryDate = dates[index];
    if (entryDate < options.start || entryDate > options.end) continue;
    const divergenceDate = dates[index - 1];
    const baseDate = dates[index - 2];
    const baseEvents = (byDate.get(baseDate) ?? []).filter((event) => event.status === "sealed");
    const baseThemes = new Map<number, LeaderEvent[]>();
    for (const event of baseEvents) {
      const rows = baseThemes.get(event.themeId) ?? [];
      rows.push(event);
      baseThemes.set(event.themeId, rows);
    }

    const mainline = [...baseThemes.values()].map((rows) => ({
      rows,
      maxBoards: Math.max(0, ...rows.map((row) => row.continuousBoards)),
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
    })).filter((candidate) => (
      candidate.rows.length >= options.minThemeLimitUps
      && candidate.maxBoards >= options.minLeaderBoards
    )).sort((left, right) => (
      right.rows.length - left.rows.length
      || right.maxBoards - left.maxBoards
      || right.amount - left.amount
      || left.rows[0].themeName.localeCompare(right.rows[0].themeName, "zh-CN")
    ))[0];
    if (!mainline) continue;

    const leader = [...mainline.rows].sort((left, right) => (
      right.continuousBoards - left.continuousBoards
      || clockMinutes(left.firstLimitTime) - clockMinutes(right.firstLimitTime)
      || right.amount - left.amount
      || left.stockCode.localeCompare(right.stockCode)
    ))[0];
    if (!leader || leader.continuousBoards < options.minLeaderBoards) continue;

    const divergenceEvents = byDate.get(divergenceDate) ?? [];
    const divergence = divergenceEvents.find((event) => (
      event.stockCode === leader.stockCode && event.themeId === leader.themeId
    ));
    if (!divergence || (divergence.status !== "broken" && divergence.openCount < 1)) continue;

    const entryEvents = byDate.get(entryDate) ?? [];
    const entry = entryEvents.find((event) => (
      event.stockCode === leader.stockCode
      && event.themeId === leader.themeId
      && event.status === "sealed"
    ));
    if (!entry || entry.price === null || entry.price <= 0) continue;
    const leaderTime = clockMinutes(entry.firstLimitTime);
    if (leaderTime < clockMinutes("09:30") || leaderTime > clockMinutes(options.earlyCutoff)) continue;

    const early = sealedEarly(entryEvents, leader.themeId, options.earlyCutoff);
    const previousEarly = sealedEarly(divergenceEvents, leader.themeId, options.earlyCutoff);
    if (early.length < options.minEarlyLimitUps || early.length <= previousEarly.length) continue;
    const peers = early.filter((event) => (
      event.stockCode !== leader.stockCode
      && Math.abs(clockMinutes(event.firstLimitTime) - leaderTime) <= options.syncWindowMinutes
    )).sort((left, right) => (
      clockMinutes(left.firstLimitTime) - clockMinutes(right.firstLimitTime)
      || left.stockCode.localeCompare(right.stockCode)
    ));
    if (!peers.length) continue;

    signals.push({
      id: `${entryDate}:${leader.stockCode}`,
      baseDate,
      divergenceDate,
      entryDate,
      themeId: leader.themeId,
      themeName: leader.themeName,
      code: leader.stockCode,
      name: leader.name,
      leaderBoards: leader.continuousBoards,
      divergenceKind: divergence.status === "broken" ? "broken" : "opened",
      divergenceOpenCount: divergence.openCount,
      entryPrice: entry.price,
      firstLimitTime: entry.firstLimitTime ?? "",
      earlyLimitUps: early.length,
      previousEarlyLimitUps: previousEarly.length,
      peers: peers.map((peer) => ({
        code: peer.stockCode,
        name: peer.name,
        firstLimitTime: peer.firstLimitTime ?? "",
      })),
    });
  }
  return signals;
}

export function calculateBacktestStats(trades: LeaderTrade[]): BacktestStats {
  const closed = trades.filter((trade) => trade.netReturn !== null);
  const returns = closed.map((trade) => trade.netReturn as number);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const sortedReturns = [...returns].sort((left, right) => left - right);
  const middle = Math.floor(sortedReturns.length / 2);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak * 100);
  }

  return {
    signalCount: trades.length,
    closedTrades: closed.length,
    openTrades: trades.filter((trade) => trade.netReturn === null && !trade.exitError).length,
    failedExits: trades.filter((trade) => trade.exitError !== null).length,
    winningTrades: wins.length,
    winRate: returns.length ? round(wins.length / returns.length * 100) : null,
    averageReturn: returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
    medianReturn: returns.length ? round(sortedReturns.length % 2
      ? sortedReturns[middle]
      : (sortedReturns[middle - 1] + sortedReturns[middle]) / 2) : null,
    profitFactor: returns.length && grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    cumulativeReturn: round((equity - 1) * 100),
    maxDrawdown: round(maxDrawdown),
  };
}
