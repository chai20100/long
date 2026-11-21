import { Hono } from "hono";
import { assignTheme, ingest } from "./ingest";
import { getReview, latestReviewDate, listReviewDates } from "./review";
import type { Env } from "./types";
import { normalizeDate } from "./utils";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
});

app.use("/api/admin/*", async (c, next) => {
  const expected = c.env.INGEST_TOKEN?.trim();
  if (!expected) {
    return c.json({ error: "服务器尚未配置 INGEST_TOKEN，请通过 wrangler secret 配置" }, 503);
  }
  if (c.req.header("Authorization") !== `Bearer ${expected}`) {
    return c.json({ error: "管理员令牌无效" }, 401);
  }
  await next();
});

app.get("/api/health", async (c) => {
  const latestDate = await latestReviewDate(c.env);
  const lastRun = await c.env.DB.prepare(`
    SELECT trade_date, status, item_count, error, started_at, finished_at
    FROM ingestion_runs ORDER BY started_at DESC LIMIT 1
  `).first();
  return c.json({ ok: true, source: "eastmoney", latestDate, lastRun });
});

app.get("/api/dates", async (c) => {
  const limit = Number(c.req.query("limit") ?? 60);
  return c.json({ dates: await listReviewDates(c.env, Number.isFinite(limit) ? limit : 60) });
});

app.get("/api/review/latest", async (c) => {
  const date = await latestReviewDate(c.env);
  if (!date) return c.json({ date: null, overview: null, themes: [] });
  const review = await getReview(c.env, date);
  return c.json(review);
});

app.get("/api/review/:date", async (c) => {
  const date = normalizeDate(c.req.param("date"));
  if (!date) return c.json({ error: "缺少交易日期" }, 400);
  const review = await getReview(c.env, date);
  if (!review) return c.json({ error: "该日期暂无复盘数据" }, 404);
  return c.json(review);
});

app.post("/api/admin/ingest", async (c) => {
  const body = await c.req.json<{ date?: string }>()
    .catch((): { date?: string } => ({}));
  try {
    const result = await ingest(c.env, body.date);
    return c.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("日期") || message.includes("非交易日") ? 400 : 502;
    return c.json({ ok: false, error: message }, status);
  }
});

app.post("/api/admin/theme", async (c) => {
  const body = await c.req.json<{ date?: string; stockCode?: string; themeName?: string }>()
    .catch((): { date?: string; stockCode?: string; themeName?: string } => ({}));
  try {
    const result = await assignTheme(
      c.env,
      body.date ?? "",
      body.stockCode ?? "",
      body.themeName ?? "",
    );
    return c.json({ ok: true, ...result });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "服务器处理失败", detail: error.message }, 500);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ingest(env).catch((error) => {
      console.error("定时抓取失败", error);
    }));
  },
} satisfies ExportedHandler<Env>;
