import { NextResponse } from "next/server";
import { leaderDataCoverage } from "@/lib/leader-data";
import { databaseError, leaderDatabase } from "@/lib/leader-db";

export async function GET() {
  try {
    const coverage = await leaderDataCoverage(await leaderDatabase());
    return NextResponse.json({ coverage }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const migrationError = databaseError(error);
    return NextResponse.json(
      { error: migrationError ?? "数据状态读取失败" },
      { status: migrationError ? 503 : 500 },
    );
  }
}
