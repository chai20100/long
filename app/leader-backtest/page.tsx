import type { Metadata } from "next";
import { LeaderBacktest } from "@/components/leader-backtest";

export const metadata: Metadata = {
  title: "龙头分歧转强回测 · 多股日线",
  description: "主线龙头分歧转强回测，支持 BaoStock 沪深股票三年日线与 5 分钟线同步到 Cloudflare R2。",
};

export default function LeaderBacktestPage() {
  return <LeaderBacktest />;
}
