"use client";

import { FormEvent, useState } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("chai20100@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "登录失败，请稍后重试");
        setLoading(false);
        return;
      }
      window.location.assign(nextPath);
    } catch {
      setError("网络连接失败，请稍后重试");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M8 5v7m0 9v6M8 12v9H3v-9h5Zm16-7v8m0 10v4m0-14v10h-5V13h5ZM16 9v5m0 10v4m0-14v10h-5V14h5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-copy"><strong>多股日线</strong><small>KLINE BOARD</small></span>
        </div>
        <div className="login-heading">
          <p className="eyebrow">PRIVATE DASHBOARD</p>
          <h1 id="login-title">欢迎回来</h1>
          <p>使用授权邮箱和密码进入你的行情看板。</p>
        </div>
        <form className="login-form" onSubmit={login}>
          <label>
            <span>邮箱地址</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? <span className="loading-spinner" /> : null}
            {loading ? "正在登录…" : "登录看板"}
          </button>
        </form>
        <div className="login-security">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M6 9V6a4 4 0 0 1 8 0v3M5 9h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          仅限授权用户访问
        </div>
      </section>
    </main>
  );
}
