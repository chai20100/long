import { NextRequest, NextResponse } from "next/server";
import { attachExitPrices, fetchTradingDates, leaderDataCoverage, loadLeaderEvents } from "@/lib/leader-data";
import { databaseError, leaderDatabase } from "@/lib/leader-db";
import {
  calculateBacktestStats,
  DEFAULT_LEADER_OPTIONS,
  findLeaderSignals,
} from "@/lib/leader-strategy";
import { isValidISODate } from "@/lib/stocks";

function numberParam(
  request: NextRequest,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = request.nextUrl.searchParams.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} 应为 ${min}—${max} 的整数`);
  }
  return value;
}

function lookbackDate(start: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 45);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const start = request.nextUrl.searchParams.get("start") ?? "";
    const end = request.nextUrl.searchParams.get("end") ?? "";
    if (!isValidISODate(start) || !isValidISODate(end) || start > end) {
      return NextResponse.json({ error: "请选择有效的回测开始和结束日期" }, { status: 400 });
    }
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    if (days > 366) {
      return NextResponse.json({ error: "单次回测区间最长为 1 年" }, { status: 400 });
    }

    const earlyCutoff = request.nextUrl.searchParams.get("earlyCutoff") ?? DEFAULT_LEADER_OPTIONS.earlyCutoff;
    if (!/^(09:30|09:[3-5]\d|10:\d{2}|11:[0-2]\d|11:30)$/.test(earlyCutoff)) {
      return NextResponse.json({ error: "早盘截止时间应在 09:30—11:30 之间" }, { status: 400 });
    }
    const options = {
      start,
      end,
      minThemeLimitUps: numberParam(request, "minThemeLimitUps", DEFAULT_LEADER_OPTIONS.minThemeLimitUps, 1, 50),
      minLeaderBoards: numberParam(request, "minLeaderBoards", DEFAULT_LEADER_OPTIONS.minLeaderBoards, 1, 20),
      earlyCutoff,
      minEarlyLimitUps: numberParam(request, "minEarlyLimitUps", DEFAULT_LEADER_OPTIONS.minEarlyLimitUps, 2, 30),
      syncWindowMinutes: numberParam(request, "syncWindowMinutes", DEFAULT_LEADER_OPTIONS.syncWindowMinutes, 0, 120),
      holdingDays: numberParam(request, "holdingDays", DEFAULT_LEADER_OPTIONS.holdingDays, 1, 20),
      costBps: numberParam(request, "costBps", DEFAULT_LEADER_OPTIONS.costBps, 0, 200),
    };
    const db = await leaderDatabase();
    const historyStart = lookbackDate(start);
    const [events, coverage, tradingDates] = await Promise.all([
      loadLeaderEvents(db, historyStart, end),
      leaderDataCoverage(db),
      fetchTradingDates(historyStart, end),
    ]);
    const signals = findLeaderSignals(events, options, tradingDates);
    const trades = await attachExitPrices(signals, options.holdingDays, options.costBps);
    return NextResponse.json({
      options,
      coverage,
      stats: calculateBacktestStats(trades),
      trades,
      methodology: {
        mainline: "分歧前一交易日，涨停家数最多的题材为主线；依次以最高连板、成交额打破并列。",
        divergence: "原龙头炸板，或封板但至少开板一次，记为分歧。",
        confirmation: "次日原龙头早盘封板；题材早盘涨停数增加且达到下限，并至少有一只跟风股在同步窗口内首封。",
        execution: "以龙头涨停价为入场价，按个股交易日持有后的不复权收盘价退出，净收益扣除设定双边成本。",
        limitation: "涨停池首封时间是板块强度的代理，不是分钟级可成交模拟；未模拟排队、滑点、停牌和分红。信号逐笔复利仅用于事件研究，重叠信号不构成资金组合曲线。",
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const migrationError = databaseError(error);
    if (migrationError) return NextResponse.json({ error: migrationError }, { status: 503 });
    const message = error instanceof Error ? error.message : "回测执行失败";
    const invalidParam = /^(minThemeLimitUps|minLeaderBoards|minEarlyLimitUps|syncWindowMinutes|holdingDays|costBps) 应为/.test(message);
    return NextResponse.json({ error: message }, { status: invalidParam ? 400 : 500 });
  }
}
