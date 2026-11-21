import { NextRequest, NextResponse } from "next/server";
import { ingestLeaderDate } from "@/lib/leader-data";
import { databaseError, leaderDatabase } from "@/lib/leader-db";

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  const body = await request.json().catch(() => null) as { date?: unknown } | null;
  if (typeof body?.date !== "string") {
    return NextResponse.json({ error: "请选择需要同步的交易日期" }, { status: 400 });
  }
  try {
    const result = await ingestLeaderDate(await leaderDatabase(), body.date);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const migrationError = databaseError(error);
    if (migrationError) return NextResponse.json({ error: migrationError }, { status: 503 });
    const message = error instanceof Error ? error.message : "数据同步失败";
    const invalidDate = message.includes("有效") || message.includes("非交易日");
    const unavailable = message.includes("均为空");
    const status = invalidDate ? 400 : unavailable ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
