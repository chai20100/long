"use client";

import { useEffect, useRef, useState } from "react";

interface SyncCounts {
  total: number;
  completed: number;
  pending: number;
  running: number;
  failed: number;
  dailyRows: number;
  minuteRows: number;
}

interface SyncStatus {
  state: {
    rangeStart: string;
    rangeEnd: string;
    status: "ready" | "running" | "complete";
  } | null;
  counts: SyncCounts;
  errors: { code: string; name: string; error: string; attempts: number }[];
  lastCompleted: {
    code: string;
    name: string;
    daily_rows: number;
    minute_rows: number;
  } | null;
}

interface NextResult {
  done: boolean;
  item?: { code: string; name: string; dailyRows?: number; minuteRows?: number; error?: string };
  status: SyncStatus;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function MarketDataSync() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState<NextResult["item"] | null>(null);
  const cancel = useRef(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/market/sync", { cache: "no-store" });
      const body = await response.json() as SyncStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "全市场同步状态读取失败");
      setStatus(body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "全市场同步状态读取失败");
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function post<T>(action: string): Promise<T> {
    const response = await fetch("/api/market/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "行情同步请求失败");
    return body;
  }

  async function initialize() {
    setBusy(true);
    setMessage("");
    try {
      const body = await post<SyncStatus>("initialize");
      setStatus(body);
      setMessage(`已载入 ${formatCount(body.counts.total)} 只沪深股票，可开始同步`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "初始化失败");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    cancel.current = false;
    setRunning(true);
    setMessage("");
    try {
      if (!status?.state) {
        const initialized = await post<SyncStatus>("initialize");
        setStatus(initialized);
      }
      while (!cancel.current) {
        const body = await post<NextResult>("next");
        setStatus(body.status);
        setCurrent(body.item ?? null);
        if (body.done) {
          setMessage(body.status.counts.failed
            ? `本轮结束：${body.status.counts.completed} 只完成，${body.status.counts.failed} 只失败，可重试失败项`
            : `全部 ${body.status.counts.completed} 只股票同步完成`);
          break;
        }
      }
      if (cancel.current) setMessage("已停止；已完成的股票不会重复下载，可随时继续");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步中断，可稍后继续");
      await loadStatus();
    } finally {
      setRunning(false);
    }
  }

  async function retryErrors() {
    setBusy(true);
    try {
      const body = await post<SyncStatus>("retry");
      setStatus(body);
      setMessage("失败项已重新加入待同步队列");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "失败项重试失败");
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setBusy(true);
    setMessage("");
    try {
      const body = await post<{
        code: string;
        name: string;
        checks: { frequency: string; rows: number; valid: boolean }[];
      }>("validate");
      setMessage(`${body.name} ${body.code} 校验通过：${body.checks.map((check) => `${check.frequency} ${formatCount(check.rows)} 行`).join("，")}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据校验失败");
    } finally {
      setBusy(false);
    }
  }

  const counts = status?.counts;
  const processed = (counts?.completed ?? 0) + (counts?.failed ?? 0);
  const percent = counts?.total ? Math.min(100, processed / counts.total * 100) : 0;
  const pending = (counts?.pending ?? 0) + (counts?.running ?? 0);

  return (
    <section className="market-sync-section" id="market-data-sync">
      <div className="market-sync-heading">
        <div>
          <p className="eyebrow">BAOSTOCK · SHANGHAI / SHENZHEN</p>
          <h2>沪深全市场三年行情</h2>
          <p>日线 + 5 分钟线 · 不复权 · R2 gzip 压缩存储 · 含区间内退市股票 · 不含北交所</p>
        </div>
        <span className={`market-sync-state${running ? " is-running" : ""}`}>{running ? "同步中" : status?.state ? "可断点续传" : "尚未初始化"}</span>
      </div>

      <div className="market-sync-range">
        <div><span>数据区间</span><strong>{status?.state ? `${status.state.rangeStart} — ${status.state.rangeEnd}` : "点击初始化后确定近三年区间"}</strong></div>
        <div><span>股票数量</span><strong>{counts ? formatCount(counts.total) : "—"}</strong></div>
        <div><span>日线行数</span><strong>{counts ? formatCount(counts.dailyRows) : "—"}</strong></div>
        <div><span>5 分钟行数</span><strong>{counts ? formatCount(counts.minuteRows) : "—"}</strong></div>
      </div>

      {counts && counts.total > 0 && (
        <div className="market-sync-progress">
          <div className="market-sync-progress-labels"><span>已处理 {formatCount(processed)} / {formatCount(counts.total)} 只</span><span>{percent.toFixed(1)}% · 待同步 {formatCount(pending)} · 失败 {formatCount(counts.failed)}</span></div>
          <div className="market-sync-progress-track"><span style={{ width: `${percent}%` }} /></div>
        </div>
      )}

      <div className="market-sync-actions">
        {!status?.state ? (
          <button className="market-sync-primary" type="button" onClick={initialize} disabled={busy}>{busy ? "正在载入股票清单…" : "初始化三年同步"}</button>
        ) : (
          <button className="market-sync-primary" type="button" onClick={run} disabled={busy || running || pending === 0}>{running ? "正在逐只同步…" : counts?.failed && pending === 0 ? "请先重试失败项" : "开始 / 继续同步"}</button>
        )}
        {running && <button type="button" onClick={() => { cancel.current = true; }}>当前股票完成后停止</button>}
        {Boolean(counts?.failed) && !running && <button type="button" onClick={retryErrors} disabled={busy}>重试失败项</button>}
        <button type="button" onClick={validate} disabled={busy || running || !counts?.completed}>校验最近完成数据</button>
      </div>

      {current && <p className={`market-sync-current${current.error ? " has-error" : ""}`} aria-live="polite">{current.name} {current.code}{current.error ? `：${current.error}` : `：日线 ${formatCount(current.dailyRows ?? 0)} 行，5 分钟 ${formatCount(current.minuteRows ?? 0)} 行`}</p>}
      {message && <p className="market-sync-message" role="status">{message}</p>}
      {Boolean(status?.errors.length) && (
        <details className="market-sync-errors">
          <summary>查看最近失败记录（{status?.errors.length}）</summary>
          <ul>{status?.errors.map((item) => <li key={item.code}><strong>{item.name} {item.code}</strong><span>{item.error}</span><small>已尝试 {item.attempts} 次</small></li>)}</ul>
        </details>
      )}
      <p className="market-sync-notice">首次同步需要数千次上游请求，耗时较长且可能产生 R2 存储费用。请保持页面打开；关闭或中断后可从 D1 进度继续。空行情股票也会记录为已完成，不会反复下载。</p>
    </section>
  );
}
