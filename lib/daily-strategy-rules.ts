import type { LeaderEvent } from "@/lib/leader-strategy";
import { limitPrice, type DailyBar } from "@/lib/first-divergence-strategy";

export interface DailyScanOptions {
  minLeaderBoards: number;
  minThemeLimitUps: number;
  minAmountRatio: number;
  maxThemes: number;
}

export interface ScanPeer {
  code: string;
  name: string;
  continuousBoards: number;
  amount: number;
}

export interface DailyCandidate {
  id: string;
  code: string;
  name: string;
  themeId: number;
  themeName: string;
  leaderBoards: number;
  themeLimitUps: number;
  activeDays: number;
  divergenceKind: "炸板" | "断板";
  divergencePct: number;
  amountRatio: number;
  close: number;
  nextLimitPrice: number;
  peers: ScanPeer[];
}

export interface DailyWatchStock {
  id: string;
  code: string;
  name: string;
  themeName: string;
  continuousBoards: number;
  themeLimitUps: number;
  firstLimitTime: string;
  peers: ScanPeer[];
}

interface Mainline {
  themeId: number;
  themeName: string;
  rows: LeaderEvent[];
  activeDays: number;
  leader: LeaderEvent;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function minutes(value: string | null): number {
  if (!value) return 24 * 60;
  const [hours, minutes, seconds = 0] = value.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function peersFor(rows: LeaderEvent[], leaderCode: string): ScanPeer[] {
  return rows.filter((row) => row.stockCode !== leaderCode)
    .sort((left, right) => right.continuousBoards - left.continuousBoards || right.amount - left.amount)
    .slice(0, 4)
    .map((row) => ({
      code: row.stockCode,
      name: row.name,
      continuousBoards: row.continuousBoards,
      amount: row.amount,
    }));
}

function findMainlines(
  byDate: Map<string, LeaderEvent[]>,
  calendar: string[],
  dateIndex: number,
  options: DailyScanOptions,
): Mainline[] {
  const date = calendar[dateIndex];
  const sealed = (byDate.get(date) ?? []).filter((row) => row.status === "sealed");
  const themes = new Map<number, LeaderEvent[]>();
  for (const row of sealed) {
    const rows = themes.get(row.themeId) ?? [];
    rows.push(row);
    themes.set(row.themeId, rows);
  }
  return [...themes.values()].flatMap((rows): Mainline[] => {
    if (rows.length < options.minThemeLimitUps) return [];
    const leader = [...rows].sort((left, right) => (
      right.continuousBoards - left.continuousBoards
      || minutes(left.firstLimitTime) - minutes(right.firstLimitTime)
      || right.amount - left.amount
    ))[0];
    if (leader.continuousBoards < options.minLeaderBoards) return [];
    const activeDays = [dateIndex, dateIndex - 1, dateIndex - 2].filter((index) => (
      index >= 0 && (byDate.get(calendar[index]) ?? []).some((row) => row.themeId === leader.themeId && row.status === "sealed")
    )).length;
    if (activeDays < 2) return [];
    return [{
      themeId: leader.themeId,
      themeName: leader.themeName,
      rows,
      activeDays,
      leader,
    }];
  }).sort((left, right) => (
    right.rows.length - left.rows.length
    || right.leader.continuousBoards - left.leader.continuousBoards
    || right.leader.amount - left.leader.amount
  )).slice(0, options.maxThemes);
}

export function scanDailyStrategy(
  events: LeaderEvent[],
  dailyByCode: Record<string, DailyBar[]>,
  calendar: string[],
  scanDate: string,
  options: DailyScanOptions,
) {
  const byDate = new Map<string, LeaderEvent[]>();
  for (const event of events) {
    const rows = byDate.get(event.tradeDate) ?? [];
    rows.push(event);
    byDate.set(event.tradeDate, rows);
  }
  const scanIndex = calendar.lastIndexOf(scanDate);
  const baseIndex = scanIndex - 1;
  const baseMainlines = baseIndex >= 0 ? findMainlines(byDate, calendar, baseIndex, options) : [];
  const currentMainlines = findMainlines(byDate, calendar, scanIndex, options);
  const candidates: DailyCandidate[] = [];
  const dataErrors: { code: string; error: string }[] = [];

  for (const mainline of baseMainlines) {
    const leader = mainline.leader;
    const bars = dailyByCode[leader.stockCode] ?? [];
    const today = bars.find((bar) => bar.date === scanDate);
    const yesterday = bars.find((bar) => bar.date === calendar[baseIndex]);
    if (!today || !yesterday) {
      dataErrors.push({ code: leader.stockCode, error: "缺少分歧日或主线确认日日线" });
      continue;
    }
    const divergenceLimit = limitPrice(yesterday.close, leader.stockCode, leader.name);
    const diverged = today.close < divergenceLimit - 0.001
      && today.amount >= leader.amount * options.minAmountRatio
      && (today.high >= divergenceLimit - 0.001 || today.close < yesterday.close);
    if (!diverged) continue;
    candidates.push({
      id: `${scanDate}:${leader.stockCode}`,
      code: leader.stockCode,
      name: leader.name,
      themeId: mainline.themeId,
      themeName: mainline.themeName,
      leaderBoards: leader.continuousBoards,
      themeLimitUps: mainline.rows.length,
      activeDays: mainline.activeDays,
      divergenceKind: today.high >= divergenceLimit - 0.001 ? "炸板" : "断板",
      divergencePct: round((today.close / yesterday.close - 1) * 100),
      amountRatio: round(today.amount / Math.max(1, leader.amount)),
      close: today.close,
      nextLimitPrice: limitPrice(today.close, leader.stockCode, leader.name),
      peers: peersFor(mainline.rows, leader.stockCode),
    });
  }

  const watch: DailyWatchStock[] = currentMainlines.map((mainline) => ({
    id: `${scanDate}:${mainline.leader.stockCode}`,
    code: mainline.leader.stockCode,
    name: mainline.leader.name,
    themeName: mainline.themeName,
    continuousBoards: mainline.leader.continuousBoards,
    themeLimitUps: mainline.rows.length,
    firstLimitTime: mainline.leader.firstLimitTime ?? "—",
    peers: peersFor(mainline.rows, mainline.leader.stockCode),
  })).filter((row, index, rows) => rows.findIndex((other) => other.code === row.code) === index);
  return {
    candidates,
    watch,
    requiredCodes: baseMainlines.map((mainline) => mainline.leader.stockCode),
    diagnostics: {
      baseMainlines: baseMainlines.length,
      currentMainlines: currentMainlines.length,
      dataErrors,
    },
  };
}
