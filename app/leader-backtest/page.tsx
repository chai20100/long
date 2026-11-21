import type { Metadata } from "next";
import { LeaderBacktest } from "@/components/leader-backtest";

export const metadata: Metadata = {
  title: "龙头分歧转强回测 · 多股日线",
  description: "基于 Cloudflare D1 涨停池数据的主线龙头分歧后早盘转强策略回测。",
};

export default function LeaderBacktestPage() {
  return <LeaderBacktest />;
}
