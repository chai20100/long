import { NextRequest, NextResponse } from "next/server";
import { getDailyCloseScan, runDailyCloseScan } from "@/lib/daily-strategy-scanner";
import { leaderDatabase } from "@/lib/leader-db";

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get("date") ?? undefined;
    const result = await getDailyCloseScan(await leaderDatabase(), date);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "扫描结果读取失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  const body = await request.json().catch(() => ({})) as { date?: unknown };
  if (body.date !== undefined && typeof body.date !== "string") {
    return NextResponse.json({ error: "扫描日期无效" }, { status: 400 });
  }
  try {
    const result = await runDailyCloseScan(await leaderDatabase(), body.date);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "收盘扫描失败" }, { status: 502 });
  }
}
