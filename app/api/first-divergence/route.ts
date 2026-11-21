import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runFirstDivergenceStrategy, type FirstDivergenceOptions } from "@/lib/first-divergence-strategy";
import { loadStrategyGroup, normalizeShanghaiShenzhenCode, type MarketReaderEnv } from "@/lib/market-data-reader";
import { isValidISODate } from "@/lib/stocks";

function integerValue(value: unknown, fallback: number, min: number, max: number, label: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label}应为 ${min}—${max} 的整数`);
  return parsed;
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "策略参数无效" }, { status: 400 });
  try {
    const leaderCode = normalizeShanghaiShenzhenCode(String(body.leaderCode ?? ""));
    if (!leaderCode) throw new Error("请输入有效的沪深股票龙头代码");
    if (!Array.isArray(body.peers) || body.peers.length < 1 || body.peers.length > 7) {
      throw new Error("请填写 1—7 只板块核心股");
    }
    const peers = [...new Set(body.peers.map((code) => normalizeShanghaiShenzhenCode(String(code))))];
    if (peers.some((code) => code === null) || peers.includes(leaderCode)) {
      throw new Error("核心股代码无效或与龙头重复");
    }
    const peerCodes = peers as string[];
    const start = String(body.start ?? "");
    const end = String(body.end ?? "");
    if (!isValidISODate(start) || !isValidISODate(end) || start > end) throw new Error("回测日期无效");
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    if (days > 1100) throw new Error("单次策略回测最长为三年");
    const themeName = String(body.themeName ?? "自定义主线").trim();
    if (!themeName || themeName.length > 30) throw new Error("板块名称应为 1—30 个字符");
    const options: FirstDivergenceOptions = {
      start,
      end,
      themeName,
      minLeaderBoards: integerValue(body.minLeaderBoards, 2, 1, 10, "龙头最低连板"),
      minThemeLimitUps: integerValue(body.minThemeLimitUps, 2, 1, peerCodes.length + 1, "主线最少涨停"),
      minPeerConfirm: integerValue(body.minPeerConfirm, Math.min(2, peerCodes.length), 1, peerCodes.length, "同步确认核心股"),
      peerMinReturn: integerValue(body.peerMinReturn, 2, 0, 19, "核心股最小涨幅"),
      holdingDays: integerValue(body.holdingDays, 3, 1, 20, "持有交易日"),
      costBps: integerValue(body.costBps, 10, 0, 200, "双边成本"),
    };
    const { env } = await getCloudflareContext({ async: true });
    const market = env as unknown as MarketReaderEnv;
    const { stocks, missing } = await loadStrategyGroup(market, [leaderCode, ...peerCodes], start, end);
    if (missing.length) {
      return NextResponse.json({ error: "部分股票尚未同步完整数据", missing }, { status: 409 });
    }
    const leader = stocks.find((stock) => stock.code === leaderCode);
    const peerStocks = peerCodes.map((code) => stocks.find((stock) => stock.code === code)!);
    if (!leader || peerStocks.some((stock) => !stock) || leader.daily.length < 4) {
      return NextResponse.json({ error: "所选区间行情数据不足" }, { status: 409 });
    }
    const result = runFirstDivergenceStrategy(leader, peerStocks, options);
    return NextResponse.json({
      options,
      leaderCode,
      peerCodes,
      ...result,
      methodology: {
        mainline: "板块由指定核心股组合定义；分歧前一日达到涨停宽度，近三个交易日至少两天有涨停。",
        leader: "龙头在分歧前一日达到最低连板，高度与成交额不弱于组合内其他核心股。",
        divergence: "连板后的首次未封板，成交量不低于前一交易日，且出现炸板或收跌断板。",
        signal: "次日龙头 5 分钟收盘封涨停，同时达到数量的核心股在同一根 5 分钟 K 线涨幅达标。",
        execution: "信号后下一根 5 分钟 K 线，以开盘价与涨停价的较低者模拟限价成交；无成交量或价格未触及涨停价则不成交。",
        exit: "入场日收盘未封板时次日开盘退出，否则持有指定交易日后收盘退出；净收益扣除双边成本。",
        limitation: "信号计算无未来函数，但限价成交仍不包含排队位置；逐笔复利不是组合资金曲线。",
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "策略执行失败" }, { status: 400 });
  }
}
