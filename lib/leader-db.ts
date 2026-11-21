import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { LeaderDatabase } from "@/lib/leader-data";

export async function leaderDatabase(): Promise<LeaderDatabase> {
  const { env } = await getCloudflareContext({ async: true });
  return (env as unknown as { DB: LeaderDatabase }).DB;
}

export function databaseError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no such table") || message.includes("DB is not defined")
    ? "龙头回测数据表尚未创建，请先执行 Cloudflare D1 迁移"
    : null;
}
