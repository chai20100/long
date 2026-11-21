"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { localISO, monthsAgo } from "@/lib/boards";
import type { ExecutionTrade } from "@/lib/first-divergence-strategy";

interface ProgramResult {
  trades: ExecutionTrade[];
  diagnostics: { candidateDivergences: number; confirmedSignals: number; unfilledSignals: number };
  stats: {
    trades: number;
    closedTrades: number;
    openTrades: number;
    winningTrades: number;
    winRate: number | null;
    averageReturn: number | null;
    profitFactor: number | null;
    cumulativeReturn: number;
    maxDrawdown: number;
  };
}

interface MissingData {
  code: string;
  error: string;
}

function numberDisplay(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(2)}${suffix}`;
}

export function FirstDivergenceProgram() {
  const today = localISO(new Date());
  const [themeName, setThemeName] = useState("自定义主线");
  const [leaderCode, setLeaderCode] = useState("");
  const [peers, setPeers] = useState("");
  const [start, setStart] = useState(monthsAgo(12));
  const [end, setEnd] = useState(today);
  const [minLeaderBoards, setMinLeaderBoards] = useState(2);
  const [minThemeLimitUps, setMinThemeLimitUps] = useState(2);
  const [minPeerConfirm, setMinPeerConfirm] = useState(2);
  const [peerMinReturn, setPeerMinReturn] = useState(2);
  const [holdingDays, setHoldingDays] = useState(3);
  const [costBps, setCostBps] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<MissingData[]>([]);
  const [result, setResult] = useState<ProgramResult | null>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMissing([]);
    try {
      const response = await fetch("/api/first-divergence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeName, leaderCode, start, end, minLeaderBoards, minThemeLimitUps,
          minPeerConfirm, peerMinReturn, holdingDays, costBps,
          peers: peers.split(/[\s,，、]+/).filter(Boolean),
        }),
      });
      const body = await response.json() as ProgramResult & { error?: string; missing?: MissingData[] };
      if (!response.ok) {
        setMissing(body.missing ?? []);
        throw new Error(body.error ?? "策略执行失败");
      }
      setResult(body);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "策略执行失败");
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!result?.trades.length) return;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["主线确认日", "分歧日", "入场日", "龙头", "代码", "分歧类型", "连板高度", "信号时间", "成交时间", "成交价", "同步核心股", "退出日", "退出价", "退出原因", "净收益率(%)"];
    const rows = result.trades.map((trade) => [
      trade.baseDate, trade.divergenceDate, trade.entryDate, trade.name, trade.code,
      trade.divergenceKind, trade.leaderBoards, trade.signalTime, trade.entryTime, trade.entryPrice,
      trade.confirmedPeers.map((peer) => `${peer.name}(${peer.returnPct}%)`).join("、"),
      trade.exitDate, trade.exitPrice, trade.exitReason, trade.netReturn,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `first-divergence-${leaderCode}-${start}-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <header className="site-header"><div className="header-inner">
        <a className="brand" href="/" aria-label="返回行情看板"><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 5v7m0 9v6M8 12h0v9H3v-9h5Zm16-7v8m0 10v4m0-14h0v10h-5V13h5ZM16 9v5m0 10v4m0-14h0v10h-5V14h5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="brand-copy"><strong>多股日线</strong><small>KLINE BOARD</small></span></a>
        <div className="header-actions"><span className="source-badge"><span className="source-dot" />BaoStock 5 分钟数据<span className="badge-divider" />D1 + R2</span><a className="strategy-nav-link" href="/leader-backtest">龙头回测</a><a className="strategy-nav-link" href="/">返回看板</a></div>
      </div></header>

      <main className="dashboard execution-dashboard">
        <section className="page-intro backtest-intro"><div><p className="eyebrow">FIRST DIVERGENCE · EXECUTABLE RULES</p><h1>首次分歧，<span>等板块共振再执行。</span></h1><p className="intro-description">独立策略板块：主线确认、龙头确认、首次充分分歧、5 分钟共振信号、下一根 K 线限价执行、明确退出。</p></div><div className="backtest-engine-badge"><span />无未来函数信号<small>信号与成交分离</small></div></section>

        <section className="execution-flow" aria-label="执行流程">
          {["自定义主线核心股", "连板高度确认龙头", "首次放量炸板或断板", "同根 5 分钟板块共振", "下一根 5 分钟限价执行", "失败或到期退出"].map((label, index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong></article>)}
        </section>

        <form className="execution-panel" onSubmit={run}>
          <div className="execution-section-title"><div><h2>策略配置</h2><p>核心股用于定义主线和同步强度，最多 7 只；程序不会自动替它们编造历史题材分类。</p></div><button className="run-backtest-button" type="submit" disabled={loading}>{loading ? <span className="loading-spinner" /> : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 4 9 6-9 6V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}{loading ? "正在执行…" : "运行策略"}</button></div>
          <div className="execution-universe">
            <label><span>板块名称</span><input value={themeName} maxLength={30} onChange={(event) => setThemeName(event.target.value)} required /></label>
            <label><span>龙头代码</span><input value={leaderCode} onChange={(event) => setLeaderCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="如 600000" pattern="[0-9]{6}" required /></label>
            <label className="execution-peers"><span>板块核心股代码（不含龙头）</span><textarea value={peers} onChange={(event) => setPeers(event.target.value)} placeholder="600004, 600006" rows={2} required /></label>
          </div>
          <div className="execution-parameters">
            <label><span>开始日期</span><input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} required /></label>
            <label><span>结束日期</span><input type="date" value={end} max={today} onChange={(event) => setEnd(event.target.value)} required /></label>
            <label><span>龙头最低连板</span><input type="number" min="1" max="10" value={minLeaderBoards} onChange={(event) => setMinLeaderBoards(event.target.valueAsNumber)} required /></label>
            <label><span>主线最少涨停</span><input type="number" min="1" max="8" value={minThemeLimitUps} onChange={(event) => setMinThemeLimitUps(event.target.valueAsNumber)} required /></label>
            <label><span>同步确认核心股</span><input type="number" min="1" max="7" value={minPeerConfirm} onChange={(event) => setMinPeerConfirm(event.target.valueAsNumber)} required /></label>
            <label><span>核心股最小涨幅 %</span><input type="number" min="0" max="19" value={peerMinReturn} onChange={(event) => setPeerMinReturn(event.target.valueAsNumber)} required /></label>
            <label><span>持有交易日</span><input type="number" min="1" max="20" value={holdingDays} onChange={(event) => setHoldingDays(event.target.valueAsNumber)} required /></label>
            <label><span>双边成本（基点）</span><input type="number" min="0" max="200" value={costBps} onChange={(event) => setCostBps(event.target.valueAsNumber)} required /></label>
          </div>
          <p className="execution-data-note">需要所选股票的三年日线与 5 分钟线已同步到 R2。可前往 <a href="/leader-backtest#market-data-sync">沪深全市场三年行情</a> 查看同步进度。</p>
        </form>

        {error && <div className="execution-error" role="alert"><strong>{error}</strong>{missing.length > 0 && <ul>{missing.map((item) => <li key={item.code}>{item.code}：{item.error}</li>)}</ul>}</div>}

        {loading && <div className="backtest-loading"><span className="loading-spinner" /><strong>正在逐根检查 5 分钟信号与成交</strong><span>不会使用收盘结果倒推早盘买点</span></div>}

        {!loading && result && <section className="execution-results">
          <div className="results-heading"><div><p className="eyebrow">EXECUTION RESULT</p><h2>执行结果 <span>{start} — {end}</span></h2></div><button type="button" onClick={exportCsv} disabled={!result.trades.length}>导出 CSV</button></div>
          <div className="execution-diagnostics"><span>分歧候选 <strong>{result.diagnostics.candidateDivergences}</strong></span><span>共振信号 <strong>{result.diagnostics.confirmedSignals}</strong></span><span>未成交信号 <strong>{result.diagnostics.unfilledSignals}</strong></span><span>实际成交 <strong>{result.stats.trades}</strong></span></div>
          <div className="stats-grid execution-stats"><article><span>实际成交</span><strong>{result.stats.trades}</strong><small>{result.stats.closedTrades} 笔已退出 · {result.stats.openTrades} 笔未到期</small></article><article><span>胜率</span><strong>{numberDisplay(result.stats.winRate, "%")}</strong><small>{result.stats.winningTrades} 笔净收益为正</small></article><article><span>平均净收益</span><strong>{numberDisplay(result.stats.averageReturn, "%")}</strong><small>已扣除双边成本</small></article><article><span>盈亏比</span><strong>{numberDisplay(result.stats.profitFactor)}</strong><small>总盈利 ÷ 总亏损绝对值</small></article><article><span>信号序列累计</span><strong>{numberDisplay(result.stats.cumulativeReturn, "%")}</strong><small>逐笔复利，非组合曲线</small></article><article><span>序列最大回撤</span><strong>{numberDisplay(result.stats.maxDrawdown, "%")}</strong><small>按成交顺序计算</small></article></div>
          {result.trades.length ? <div className="trades-table-wrap"><table className="trades-table execution-table"><thead><tr><th>成交 / 龙头</th><th>主线与首次分歧</th><th>共振信号</th><th>限价执行</th><th>退出</th><th>净收益</th></tr></thead><tbody>{result.trades.map((trade) => <tr key={trade.id}><td><strong>{trade.entryDate}</strong><span className="trade-stock">{trade.name}<small>{trade.code}</small></span><small>{trade.themeName} · 原 {trade.leaderBoards} 连板</small></td><td><span className="theme-pill">{trade.divergenceKind}</span><small>{trade.divergenceDate} 分歧</small><small>{trade.baseDate} 主线涨停 {trade.themeLimitUps} 家</small></td><td><strong>{trade.signalTime.slice(5, 16)}</strong><span className="peer-list">{trade.confirmedPeers.map((peer) => `${peer.name} ${peer.returnPct}%`).join("、")}</span><small>同一根 5 分钟 K 线确认</small></td><td><strong>{trade.entryTime.slice(11, 16)}</strong><span>¥{trade.entryPrice.toFixed(2)}</span><small>下一根 K 线限价成交</small></td><td>{trade.exitDate ? <><strong>{trade.exitDate}</strong><span>¥{trade.exitPrice?.toFixed(2)}</span><small>{trade.exitReason}</small></> : "尚未到退出日"}</td><td className={`return-cell ${(trade.netReturn ?? 0) > 0 ? "quote-up" : (trade.netReturn ?? 0) < 0 ? "quote-down" : ""}`}>{trade.netReturn === null ? "—" : `${trade.netReturn > 0 ? "+" : ""}${trade.netReturn.toFixed(2)}%`}</td></tr>)}</tbody></table></div> : <div className="empty-backtest"><h3>没有产生可执行交易</h3><p>请结合上方诊断判断是没有分歧、没有板块共振，还是信号未能成交。</p></div>}
        </section>}
      </main>
      <footer className="site-footer"><span>5 分钟收盘确认，下一根 K 线执行 · 未模拟排队位置 · 板块由指定核心股定义</span><span>历史回测不代表未来收益，不构成投资建议</span></footer>
    </div>
  );
}
