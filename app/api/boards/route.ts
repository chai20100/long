import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseBoardConfig } from "@/lib/boards";

interface D1PreparedStatement {
  bind(...values: string[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface BoardEnv {
  DB: {
    prepare(query: string): D1PreparedStatement;
  };
}

async function database(): Promise<BoardEnv["DB"]> {
  const { env } = await getCloudflareContext({ async: true });
  return (env as unknown as BoardEnv).DB;
}

export async function GET() {
  try {
    const email = process.env.AUTH_EMAIL?.toLowerCase() ?? "";
    const row = await (await database())
      .prepare("SELECT config, updated_at FROM board_configs WHERE user_email = ?")
      .bind(email)
      .first<{ config: string; updated_at: string }>();
    if (!row) return NextResponse.json({ config: null, updatedAt: null });
    const config = parseBoardConfig(JSON.parse(row.config));
    if (!config) return NextResponse.json({ error: "保存的看板配置无效" }, { status: 500 });
    return NextResponse.json({ config, updatedAt: row.updated_at }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "看板配置加载失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 200_000) {
    return NextResponse.json({ error: "看板配置过大" }, { status: 413 });
  }
  const config = parseBoardConfig(await request.json().catch(() => null));
  if (!config) {
    return NextResponse.json({ error: "看板配置格式无效，请检查板块名称和日期" }, { status: 400 });
  }

  try {
    const email = process.env.AUTH_EMAIL?.toLowerCase() ?? "";
    const updatedAt = new Date().toISOString();
    await (await database())
      .prepare(`
        INSERT INTO board_configs (user_email, config, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_email) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
      `)
      .bind(email, JSON.stringify(config), updatedAt)
      .run();
    return NextResponse.json({ ok: true, updatedAt });
  } catch {
    return NextResponse.json({ error: "保存失败，请稍后重试" }, { status: 500 });
  }
}
