import { NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const allowedEmail = process.env.AUTH_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  const sessionSecret = process.env.AUTH_SESSION_SECRET;
  if (!allowedEmail || !passwordHash || !sessionSecret) {
    return NextResponse.json({ error: "登录服务尚未配置完成" }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  if (!email || !password || password.length > 256) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const passwordValid = await verifyPassword(password, passwordHash);
  if (email !== allowedEmail || !passwordValid) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSession(email, sessionSecret),
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
