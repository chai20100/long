import type { Metadata } from "next";
import { DailyStrategyBoard } from "@/components/daily-strategy-board";

export const metadata: Metadata = {
  title: "每日收盘候选股扫描 · 多股日线",
  description: "每日收盘后扫描主线龙头首次分歧候选股、连板观察股与板块共振观察股。",
};

export default function DailyStrategyPage() {
  return <DailyStrategyBoard />;
}
