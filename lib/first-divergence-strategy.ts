export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export interface MinuteBar {
  timestamp: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

export interface StrategyStock {
  code: string;
  name: string;
  daily: DailyBar[];
  minutes: MinuteBar[];
}

export interface FirstDivergenceOptions {
  start: string;
  end: string;
  themeName: string;
  minLeaderBoards: number;
  minThemeLimitUps: number;
  minPeerConfirm: number;
  peerMinReturn: number;
  holdingDays: number;
  costBps: number;
}

export interface ConfirmedPeer {
  code: string;
  name: string;
  returnPct: number;
}

export interface ExecutionTrade {
  id: string;
  code: string;
  name: string;
  themeName: string;
  baseDate: string;
  divergenceDate: string;
  entryDate: string;
  divergenceKind: "炸板" | "断板";
  leaderBoards: number;
  themeLimitUps: number;
  activeDays: number;
  signalTime: string;
  entryTime: string;
  entryPrice: number;
  confirmedPeers: ConfirmedPeer[];
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: "确认失败，次日开盘退出" | "持有到期，收盘退出" | null;
  grossReturn: number | null;
  netReturn: number | null;
}

export interface ExecutionResult {
  trades: ExecutionTrade[];
  diagnostics: {
    candidateDivergences: number;
    confirmedSignals: number;
    unfilledSignals: number;
  };
  stats: {
    trades: number;
    closedTrades: number;
    openTrades: number;
    winningTrades: number;
    winRate: number | null;
    averageReturn: number | null;
    profitFactor: number | null;
    cumulativeReturn: number;
    maxDrawdown: number;
  };
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function limitRate(code: string, name: string): number {
  if (/^(300|301|688)/.test(code.slice(-6))) return 0.2;
  return name.toUpperCase().includes("ST") ? 0.05 : 0.1;
}

export function limitPrice(previousClose: number, code: string, name: string): number {
  return Math.round(previousClose * (1 + limitRate(code, name)) * 100) / 100;
}

function sealedAt(stock: StrategyStock, index: number): boolean {
  const bar = stock.daily[index];
  const previous = stock.daily[index - 1];
  if (!bar || !previous || previous.close <= 0) return false;
  return bar.close >= limitPrice(previous.close, stock.code, stock.name) - 0.001;
}

function streakAt(stock: StrategyStock, index: number): number {
  let streak = 0;
  for (let cursor = index; cursor >= 0 && sealedAt(stock, cursor); cursor -= 1) streak += 1;
  return streak;
}

function previousCloseBefore(stock: StrategyStock, date: string): number | null {
  let left = 0;
  let right = stock.daily.length - 1;
  let found = -1;
  while (left <= right) {
    const middle = (left + right) >> 1;
    if (stock.daily[middle].date < date) {
      found = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return found < 0 ? null : stock.daily[found].close;
}

function statsFor(trades: ExecutionTrade[]): ExecutionResult["stats"] {
  const returns = trades.flatMap((trade) => trade.netReturn === null ? [] : [trade.netReturn]);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const profit = wins.reduce((sum, value) => sum + value, 0);
  const loss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak * 100);
  }
  return {
    trades: trades.length,
    closedTrades: returns.length,
    openTrades: trades.length - returns.length,
    winningTrades: wins.length,
    winRate: returns.length ? round(wins.length / returns.length * 100, 2) : null,
    averageReturn: returns.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length, 2) : null,
    profitFactor: returns.length && loss > 0 ? round(profit / loss, 2) : null,
    cumulativeReturn: round((equity - 1) * 100, 2),
    maxDrawdown: round(maxDrawdown, 2),
  };
}

export function runFirstDivergenceStrategy(
  leader: StrategyStock,
  peers: StrategyStock[],
  options: FirstDivergenceOptions,
): ExecutionResult {
  const group = [leader, ...peers];
  const dailyIndices = new Map(group.map((stock) => [
    stock.code,
    new Map(stock.daily.map((bar, index) => [bar.date, index])),
  ]));
  const minuteMaps = new Map(group.map((stock) => [
    stock.code,
    new Map(stock.minutes.map((bar) => [bar.timestamp, bar])),
  ]));
  const leaderMinutesByDate = new Map<string, MinuteBar[]>();
  for (const bar of leader.minutes) {
    const rows = leaderMinutesByDate.get(bar.date) ?? [];
    rows.push(bar);
    leaderMinutesByDate.set(bar.date, rows);
  }
  const sealedCount = (date: string) => group.filter((stock) => {
    const index = dailyIndices.get(stock.code)?.get(date);
    return index !== undefined && sealedAt(stock, index);
  }).length;
  const trades: ExecutionTrade[] = [];
  const diagnostics = { candidateDivergences: 0, confirmedSignals: 0, unfilledSignals: 0 };

  for (let entryIndex = 2; entryIndex < leader.daily.length; entryIndex += 1) {
    const entryDay = leader.daily[entryIndex];
    if (entryDay.date < options.start || entryDay.date > options.end) continue;
    const divergenceIndex = entryIndex - 1;
    const baseIndex = entryIndex - 2;
    const divergence = leader.daily[divergenceIndex];
    const base = leader.daily[baseIndex];
    if (!sealedAt(leader, baseIndex)) continue;
    const leaderBoards = streakAt(leader, baseIndex);
    if (leaderBoards < options.minLeaderBoards) continue;
    const themeLimitUps = sealedCount(base.date);
    if (themeLimitUps < options.minThemeLimitUps) continue;
    const activeDays = [baseIndex, baseIndex - 1, baseIndex - 2].filter((index) => (
      index >= 0 && sealedCount(leader.daily[index].date) >= 1
    )).length;
    if (activeDays < 2) continue;

    const isLeader = group.every((stock) => {
      if (stock.code === leader.code) return true;
      const index = dailyIndices.get(stock.code)?.get(base.date);
      if (index === undefined) return true;
      const otherStreak = streakAt(stock, index);
      return otherStreak < leaderBoards
        || (otherStreak === leaderBoards && stock.daily[index].amount <= base.amount);
    });
    if (!isLeader) continue;

    const divergenceLimit = limitPrice(base.close, leader.code, leader.name);
    const diverged = divergence.close < divergenceLimit - 0.001
      && divergence.volume >= base.volume
      && (divergence.high >= divergenceLimit - 0.001 || divergence.close < base.close);
    if (!diverged) continue;
    diagnostics.candidateDivergences += 1;

    const entryLimit = limitPrice(divergence.close, leader.code, leader.name);
    const dayMinutes = leaderMinutesByDate.get(entryDay.date) ?? [];
    let executed = false;
    for (let minuteIndex = 0; minuteIndex + 1 < dayMinutes.length && !executed; minuteIndex += 1) {
      const signal = dayMinutes[minuteIndex];
      if (signal.volume <= 0 || signal.close < entryLimit - 0.001) continue;
      const confirmedPeers = peers.flatMap((stock) => {
        const previousClose = previousCloseBefore(stock, entryDay.date);
        const bar = minuteMaps.get(stock.code)?.get(signal.timestamp);
        if (previousClose === null || previousClose <= 0 || !bar || bar.volume <= 0) return [];
        const returnPct = (bar.close / previousClose - 1) * 100;
        return returnPct >= options.peerMinReturn
          ? [{ code: stock.code, name: stock.name, returnPct: round(returnPct, 2) }]
          : [];
      });
      if (confirmedPeers.length < options.minPeerConfirm) continue;
      diagnostics.confirmedSignals += 1;
      const execution = dayMinutes[minuteIndex + 1];
      if (execution.volume <= 0 || execution.low > entryLimit + 0.001 || execution.open <= 0) {
        diagnostics.unfilledSignals += 1;
        continue;
      }
      const entryPrice = round(Math.min(execution.open, entryLimit), 2);
      const entryClosedSealed = entryDay.close >= entryLimit - 0.001;
      const failureExit = !entryClosedSealed && leader.daily[entryIndex + 1]
        ? leader.daily[entryIndex + 1]
        : null;
      const timedExit = !failureExit ? leader.daily[entryIndex + options.holdingDays] ?? null : null;
      const exitPrice = failureExit?.open ?? timedExit?.close ?? null;
      const grossReturn = exitPrice === null ? null : round((exitPrice / entryPrice - 1) * 100);
      trades.push({
        id: `${entryDay.date}:${leader.code}`,
        code: leader.code,
        name: leader.name,
        themeName: options.themeName,
        baseDate: base.date,
        divergenceDate: divergence.date,
        entryDate: entryDay.date,
        divergenceKind: divergence.high >= divergenceLimit - 0.001 ? "炸板" : "断板",
        leaderBoards,
        themeLimitUps,
        activeDays,
        signalTime: signal.timestamp,
        entryTime: execution.timestamp,
        entryPrice,
        confirmedPeers,
        exitDate: failureExit?.date ?? timedExit?.date ?? null,
        exitPrice,
        exitReason: failureExit ? "确认失败，次日开盘退出" : timedExit ? "持有到期，收盘退出" : null,
        grossReturn,
        netReturn: grossReturn === null ? null : round(grossReturn - options.costBps / 100),
      });
      executed = true;
    }
  }
  return { trades, diagnostics, stats: statsFor(trades) };
}
