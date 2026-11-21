import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  initializeMarketSync,
  marketSyncStatus,
  retryMarketSyncErrors,
  syncNextMarketStock,
  validateMarketObject,
  type MarketEnv,
} from "@/lib/market-sync";

async function marketEnvironment(): Promise<MarketEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as MarketEnv;
}

export async function GET() {
  try {
    return NextResponse.json(await marketSyncStatus(await marketEnvironment()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步状态读取失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  const body = await request.json().catch(() => null) as { action?: unknown; code?: unknown } | null;
  const action = body?.action;
  if (!["initialize", "next", "retry", "validate"].includes(String(action))) {
    return NextResponse.json({ error: "不支持的同步操作" }, { status: 400 });
  }
  if (body?.code !== undefined && (typeof body.code !== "string" || !/^(sh|sz)\.\d{6}$/.test(body.code))) {
    return NextResponse.json({ error: "股票代码格式无效" }, { status: 400 });
  }
  try {
    const env = await marketEnvironment();
    if (action === "initialize") return NextResponse.json(await initializeMarketSync(env));
    if (action === "next") return NextResponse.json(await syncNextMarketStock(env));
    if (action === "retry") return NextResponse.json(await retryMarketSyncErrors(env));
    return NextResponse.json(await validateMarketObject(env, body?.code));
  } catch (error) {
    const message = error instanceof Error ? error.message : "行情同步失败";
    const clientError = message.includes("请先") || message.includes("没有可校验");
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 502 });
  }
}
