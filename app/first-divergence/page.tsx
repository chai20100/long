import type { Metadata } from "next";
import { FirstDivergenceProgram } from "@/components/first-divergence-program";

export const metadata: Metadata = {
  title: "首次分歧弱转强执行程序 · 多股日线",
  description: "使用日线与 5 分钟数据执行主线龙头首次分歧后的板块共振弱转强策略。",
};

export default function FirstDivergencePage() {
  return <FirstDivergenceProgram />;
}
