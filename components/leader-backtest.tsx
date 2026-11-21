"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { localISO, monthsAgo } from "@/lib/boards";
import {
  DEFAULT_LEADER_OPTIONS,
  type BacktestStats,
  type LeaderStrategyOptions,
  type LeaderTrade,
} from "@/lib/leader-strategy";

interface Coverage {
  start: string | null;
  end: string | null;
  days: number;
  events: number;
}

interface BacktestResponse {
  options: LeaderStrategyOptions;
  coverage: Coverage;
  stats: BacktestStats;
  trades: LeaderTrade[];
}

interface SyncProgress {
  current: number;
  total: number;
  synced: number;
  skipped: number;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarDays(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let value = start; value <= end; value = shiftDate(value, 1)) {
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(value);
  }
  return dates;
}

function displayNumber(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(2)}${suffix}`;
}

function csvCell(value: string | number | null): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function LeaderBacktest() {
  const today = localISO(new Date());
  const [form, setForm] = useState<LeaderStrategyOptions>({
    ...DEFAULT_LEADER_OPTIONS,
    start: monthsAgo(6),
    end: today,
  });
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dataOpen, setDataOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const cancelSync = useRef(false);

  async function refreshCoverage() {
    try {
      const response = await fetch("/api/leader/data", { cache: "no-store" });
      const body = await response.json() as { coverage?: Coverage; error?: string };
      if (!response.ok || !body.coverage) throw new Error(body.error ?? "数据状态读取失败");
      setCoverage(body.coverage);
      setError("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "数据状态读取失败");
    }
  }

  useEffect(() => {
    void refreshCoverage();
  }, []);

  async function runBacktest(event?: FormEvent) {
    event?.preventDefault();
    if (form.start > form.end) {
      setError("开始日期不能晚于结束日期");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(
        Object.entries(form).map(([key, value]) => [key, String(value)]),
      );
      const response = await fetch(`/api/leader/backtest?${query}`, { cache: "no-store" });
      const body = await response.json() as BacktestResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "回测执行失败");
      setResult(body);
      setCoverage(body.coverage);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "回测执行失败");
    } finally {
      setLoading(false);
    }
  }

  async function syncRange() {
    const dates = calendarDays(shiftDate(form.start, -7), form.end);
    if (!dates.length || dates.length > 270) {
      setSyncMessage("同步区间无效或超过一年");
      return;
    }
    cancelSync.current = false;
    setSyncing(true);
    setSyncMessage("");
    setError("");
    let synced = 0;
    let skipped = 0;
    let processed = 0;
    try {
      for (let index = 0; index < dates.length; index += 1) {
        if (cancelSync.current) break;
        setSyncProgress({ current: index + 1, total: dates.length, synced, skipped });
        const response = await fetch("/api/leader/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dates[index] }),
        });
        const body = await response.json() as { error?: string; total?: number };
        processed = index + 1;
        if (!response.ok) {
          if ((response.status === 400 && body.error?.includes("非交易日"))
            || (response.status === 404 && body.error?.includes("均为空"))) {
            skipped += 1;
            continue;
          }
          throw new Error(`${dates[index]}：${body.error ?? "同步失败"}`);
        }
        synced += 1;
      }
      setSyncProgress({ current: processed, total: dates.length, synced, skipped });
      setSyncMessage(cancelSync.current
        ? `已停止：成功同步 ${synced} 个交易日，跳过 ${skipped} 个无数据日`
        : `同步完成：${synced} 个交易日，跳过 ${skipped} 个无数据日`);
      await refreshCoverage();
    } catch (reason: unknown) {
      setSyncMessage(reason instanceof Error ? reason.message : "数据同步失败");
      await refreshCoverage();
    } finally {
      setSyncing(false);
    }
  }

  function exportCsv() {
    if (!result?.trades.length) return;
    const header = [
      "主线确认日", "分歧日", "入场日", "股票代码", "股票名称", "题材", "龙头连板数",
      "分歧类型", "首封时间", "题材早盘涨停数", "前日早盘涨停数", "同步跟风股",
      "入场价", "退出日", "退出价", "净收益率(%)",
    ];
    const rows = result.trades.map((trade) => [
      trade.baseDate, trade.divergenceDate, trade.entryDate, trade.code, trade.name, trade.themeName,
      trade.leaderBoards, trade.divergenceKind === "broken" ? "炸板" : "开板后回封",
      trade.firstLimitTime, trade.earlyLimitUps, trade.previousEarlyLimitUps,
      trade.peers.map((peer) => `${peer.name}(${peer.firstLimitTime.slice(0, 5)})`).join("、"),
      trade.entryPrice, trade.exitDate, trade.exitPrice, trade.netReturn,
    ]);
    const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `leader-backtest-${result.options.start}-${result.options.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const stats = result?.stats;
  const partialCoverage = Boolean(result && (
    !result.coverage.start || !result.coverage.end
    || result.coverage.start > result.options.start
    || result.coverage.end < result.options.end
  ));

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="返回多股日线首页">
            <span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 5v7m0 9v6M8 12h0v9H3v-9h5Zm16-7v8m0 10v4m0-14h0v10h-5V13h5ZM16 9v5m0 10v4m0-14h0v10h-5V14h5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span className="brand-copy"><strong>多股日线</strong><small>KLINE BOARD</small></span>
          </a>
          <div className="header-actions">
            <span className="source-badge"><span className="source-dot" />东方财富数据<span className="badge-divider" />Cloudflare D1</span>
            <a className="strategy-nav-link" href="/">返回行情看板</a>
          </div>
        </div>
      </header>

      <main className="dashboard backtest-dashboard">
        <section className="page-intro backtest-intro">
          <div>
            <p className="eyebrow">主线龙头 · 分歧转强回测</p>
            <h1>不追一致，<span>只等分歧后的再转强。</span></h1>
            <p className="intro-description">筛选主线龙头分歧后的次日早盘涨停，要求同题材同步增强；每个信号都有完整、可复核的规则轨迹。</p>
          </div>
          <div className="backtest-engine-badge"><span />D1 数据驱动<small>规则透明可复核</small></div>
        </section>

        <section className="strategy-rules" aria-label="策略规则">
          <article><span>01</span><div><h2>锁定主线龙头</h2><p>以前一阶段涨停宽度确定唯一主线，以连板高度、首封先后确定原龙头。</p></div></article>
          <article><span>02</span><div><h2>等待真实分歧</h2><p>龙头炸板，或盘中开板后回封；只保留次日仍由该龙头发出信号的样本。</p></div></article>
          <article><span>03</span><div><h2>确认板块转强</h2><p>早盘涨停家数较前日增加，且跟风股在设定同步窗口内首封，再记录龙头涨停价。</p></div></article>
        </section>

        <form className="backtest-panel" onSubmit={runBacktest}>
          <div className="backtest-panel-heading">
            <div><h2>回测设置</h2><p>入场日落在区间内；前置识别自动读取历史数据，退出日可晚于结束日。</p></div>
            <button className="run-backtest-button" type="submit" disabled={loading || syncing}>
              {loading ? <span className="loading-spinner" /> : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 4 9 6-9 6V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
              {loading ? "正在回测…" : "开始回测"}
            </button>
          </div>
          <div className="backtest-controls">
            <label><span>开始日期</span><input type="date" value={form.start} max={form.end} onChange={(event) => setForm({ ...form, start: event.target.value })} required /></label>
            <label><span>结束日期</span><input type="date" value={form.end} max={today} onChange={(event) => setForm({ ...form, end: event.target.value })} required /></label>
            <label><span>早盘截止</span><input type="time" min="09:30" max="11:30" step="60" value={form.earlyCutoff} onChange={(event) => setForm({ ...form, earlyCutoff: event.target.value })} required /></label>
            <label><span>持有交易日</span><input type="number" min="1" max="20" value={form.holdingDays} onChange={(event) => setForm({ ...form, holdingDays: event.target.valueAsNumber })} required /></label>
            <label><span>主线最少涨停</span><input type="number" min="1" max="50" value={form.minThemeLimitUps} onChange={(event) => setForm({ ...form, minThemeLimitUps: event.target.valueAsNumber })} required /></label>
            <label><span>龙头最低连板</span><input type="number" min="1" max="20" value={form.minLeaderBoards} onChange={(event) => setForm({ ...form, minLeaderBoards: event.target.valueAsNumber })} required /></label>
            <label><span>早盘最少涨停</span><input type="number" min="2" max="30" value={form.minEarlyLimitUps} onChange={(event) => setForm({ ...form, minEarlyLimitUps: event.target.valueAsNumber })} required /></label>
            <label><span>同步窗口（分钟）</span><input type="number" min="0" max="120" value={form.syncWindowMinutes} onChange={(event) => setForm({ ...form, syncWindowMinutes: event.target.valueAsNumber })} required /></label>
            <label><span>双边成本（基点）</span><input type="number" min="0" max="200" value={form.costBps} onChange={(event) => setForm({ ...form, costBps: event.target.valueAsNumber })} required /></label>
          </div>
          <div className="backtest-form-note">10 基点 = 0.10% · 默认持有 3 个交易日 · 单次区间最长 1 年</div>
        </form>

        <section className={`data-panel${dataOpen ? " is-open" : ""}`}>
          <button className="data-panel-toggle" type="button" onClick={() => setDataOpen(!dataOpen)} aria-expanded={dataOpen}>
            <span className="data-panel-title"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="M4 5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5" stroke="currentColor" strokeWidth="1.4" /></svg>回测数据管理</span>
            <span className="coverage-summary">{coverage?.days ? `已覆盖 ${coverage.start} — ${coverage.end} · ${coverage.days} 个交易日` : "暂无已同步的涨停池数据"}<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={dataOpen ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </button>
          {dataOpen && (
            <div className="data-panel-body">
              <div><h3>同步上方回测区间</h3><p>逐交易日抓取涨停池、炸板池并写入 D1；自动多取开始前 7 天用于识别主线与分歧。重复同步会刷新当日数据；上游过早历史为空时会跳过，题材默认使用东方财富行业分类。</p></div>
              <div className="data-sync-actions">
                <button type="button" onClick={syncRange} disabled={syncing}>{syncing ? "正在同步…" : "同步区间数据"}</button>
                {syncing && <button className="cancel-sync-button" type="button" onClick={() => { cancelSync.current = true; }}>完成后停止</button>}
              </div>
              {syncProgress && <div className="sync-progress"><div><span style={{ width: `${Math.min(100, syncProgress.current / syncProgress.total * 100)}%` }} /></div><p>处理 {syncProgress.current}/{syncProgress.total} 个工作日 · 已同步 {syncProgress.synced} 日 · 跳过 {syncProgress.skipped} 个无数据日</p></div>}
              {syncMessage && <p className="sync-message">{syncMessage}</p>}
            </div>
          )}
        </section>

        {error && <p className="backtest-error" role="alert">{error}</p>}

        {loading && <div className="backtest-loading"><span className="loading-spinner" /><strong>正在识别分歧与转强信号</strong><span>同时获取退出日行情，请稍候</span></div>}

        {!loading && result && (
          <section className="backtest-results">
            <div className="results-heading">
              <div><p className="eyebrow">BACKTEST RESULT</p><h2>回测结果 <span>{result.options.start} — {result.options.end}</span></h2></div>
              <button type="button" onClick={exportCsv} disabled={!result.trades.length}>导出 CSV</button>
            </div>
            {partialCoverage && <p className="coverage-warning">结果仅基于已同步数据；当前覆盖 {result.coverage.start ?? "—"} — {result.coverage.end ?? "—"}，未覆盖日期不会产生信号。</p>}
            <div className="stats-grid">
              <article><span>有效信号</span><strong>{stats?.signalCount ?? 0}</strong><small>{stats?.closedTrades ?? 0} 笔已到期 · {stats?.openTrades ?? 0} 笔未到期</small></article>
              <article><span>胜率</span><strong>{displayNumber(stats?.winRate ?? null, "%")}</strong><small>{stats?.winningTrades ?? 0} 笔净收益为正</small></article>
              <article><span>平均净收益</span><strong className={(stats?.averageReturn ?? 0) >= 0 ? "quote-up" : "quote-down"}>{displayNumber(stats?.averageReturn ?? null, "%")}</strong><small>中位数 {displayNumber(stats?.medianReturn ?? null, "%")}</small></article>
              <article><span>盈亏比</span><strong>{displayNumber(stats?.profitFactor ?? null)}</strong><small>总盈利 ÷ 总亏损绝对值</small></article>
              <article><span>信号序列累计</span><strong className={(stats?.cumulativeReturn ?? 0) >= 0 ? "quote-up" : "quote-down"}>{displayNumber(stats?.cumulativeReturn ?? null, "%")}</strong><small>逐笔复利，非组合资金曲线</small></article>
              <article><span>序列最大回撤</span><strong>{displayNumber(stats?.maxDrawdown ?? null, "%")}</strong><small>按信号入场顺序计算</small></article>
            </div>

            {result.trades.length ? (
              <div className="trades-table-wrap">
                <table className="trades-table">
                  <thead><tr><th>入场日期 / 龙头</th><th>主线与分歧</th><th>早盘转强确认</th><th>入场价</th><th>退出日期 / 价格</th><th>净收益</th></tr></thead>
                  <tbody>{result.trades.map((trade) => (
                    <tr key={trade.id}>
                      <td><strong>{trade.entryDate}</strong><span className="trade-stock">{trade.name}<small>{trade.code}</small></span><small>首封 {trade.firstLimitTime.slice(0, 5)} · 原 {trade.leaderBoards} 连板</small></td>
                      <td><span className="theme-pill">{trade.themeName}</span><small>{trade.divergenceDate} {trade.divergenceKind === "broken" ? "炸板分歧" : `开板 ${trade.divergenceOpenCount} 次后回封`}</small><small>主线确认 {trade.baseDate}</small></td>
                      <td><strong className="breadth-change">{trade.previousEarlyLimitUps} → {trade.earlyLimitUps} 家</strong><span className="peer-list" title={trade.peers.map((peer) => `${peer.name} ${peer.firstLimitTime}`).join("\n")}>{trade.peers.map((peer) => peer.name).join("、")}</span><small>同步首封 {trade.peers.length} 家</small></td>
                      <td className="numeric-cell">¥{trade.entryPrice.toFixed(2)}</td>
                      <td className="numeric-cell">{trade.exitDate ? <><strong>{trade.exitDate}</strong><span>¥{trade.exitPrice?.toFixed(2)}</span></> : <span className={trade.exitError ? "exit-error" : ""}>{trade.exitError ?? "未满持有期"}</span>}</td>
                      <td className={`return-cell ${(trade.netReturn ?? 0) > 0 ? "quote-up" : (trade.netReturn ?? 0) < 0 ? "quote-down" : ""}`}>{trade.netReturn === null ? "—" : `${trade.netReturn > 0 ? "+" : ""}${trade.netReturn.toFixed(2)}%`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="empty-backtest"><h3>当前条件下没有有效信号</h3><p>可先同步区间数据，或调整主线宽度、早盘截止时间和同步窗口。</p></div>
            )}
            {Boolean(stats?.failedExits) && <p className="coverage-warning">{stats?.failedExits} 笔信号的退出行情获取失败，未计入收益统计；可稍后重试。</p>}
          </section>
        )}
      </main>

      <footer className="site-footer"><span>首封时间仅作板块同步转强代理 · 未模拟涨停排队与滑点 · 数据保存于 Cloudflare D1</span><span>历史回测不代表未来收益，不构成投资建议</span></footer>
    </div>
  );
}
