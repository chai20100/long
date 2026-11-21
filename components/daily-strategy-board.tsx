"use client";

import { useEffect, useState } from "react";
import { localISO } from "@/lib/boards";
import type { DailyCandidate, DailyWatchStock } from "@/lib/daily-strategy-rules";

interface DailyScanResult {
  scanDate: string;
  baseDate: string;
  dataDates: string[];
  candidates: DailyCandidate[];
  watch: DailyWatchStock[];
  diagnostics: {
    baseMainlines: number;
    currentMainlines: number;
    dataErrors: { code: string; error: string }[];
    autoSyncedDates: string[];
  };
  savedAt: string;
}

function savedTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function DailyStrategyBoard() {
  const today = localISO(new Date());
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<DailyScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/daily-strategy", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { result?: DailyScanResult | null; error?: string };
        if (!response.ok) throw new Error(body.error ?? "扫描结果读取失败");
        setResult(body.result ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "扫描结果读取失败"));
  }, []);

  async function run() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/daily-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const body = await response.json() as { result?: DailyScanResult; error?: string };
      if (!response.ok || !body.result) throw new Error(body.error ?? "收盘扫描失败");
      setResult(body.result);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "收盘扫描失败");
    } finally {
      setLoading(false);
    }
  }

  function executionLink(candidate: DailyCandidate): string {
    const query = new URLSearchParams({
      leader: candidate.code,
      peers: candidate.peers.map((peer) => peer.code).join(","),
      theme: candidate.themeName,
    });
    return `/first-divergence?${query}`;
  }

  return (
    <div className="app-shell">
      <header className="site-header"><div className="header-inner">
        <a className="brand" href="/" aria-label="返回行情看板"><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 5v7m0 9v6M8 12h0v9H3v-9h5Zm16-7v8m0 10v4m0-14h0v10h-5V13h5ZM16 9v5m0 10v4m0-14h0v10h-5V14h5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="brand-copy"><strong>多股日线</strong><small>KLINE BOARD</small></span></a>
        <div className="header-actions"><span className="source-badge"><span className="source-dot" />东方财富收盘数据<span className="badge-divider" />Cloudflare D1</span><a className="strategy-nav-link" href="/first-divergence">弱转强程序</a><a className="strategy-nav-link" href="/leader-backtest">龙头回测</a><a className="strategy-nav-link" href="/">返回看板</a></div>
      </div></header>

      <main className="dashboard daily-scan-dashboard">
        <section className="page-intro backtest-intro"><div><p className="eyebrow">DAILY AFTER-CLOSE SCANNER</p><h1>今天收盘分歧，<span>明天只等共振。</span></h1><p className="intro-description">自动寻找首次充分分歧的主线龙头，同时保留仍在连板、等待分歧的观察股。候选不等于买入，次日必须重新确认 5 分钟板块共振。</p></div><div className="backtest-engine-badge"><span />每日保存扫描结果<small>打开网页即可查看</small></div></section>

        <section className="daily-scan-controls">
          <div><h2>收盘扫描</h2><p>建议交易日 15:30 后运行；周末和节假日自动选择之前最近交易日。缺少涨停池数据时会自动补抓。</p></div>
          <label><span>扫描日期</span><input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label>
          <button type="button" onClick={run} disabled={loading}>{loading ? <span className="loading-spinner" /> : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.4" /><path d="m12.2 12.2 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>}{loading ? "正在扫描…" : "运行收盘扫描"}</button>
        </section>

        {error && <p className="backtest-error" role="alert">{error}</p>}
        {loading && <div className="backtest-loading"><span className="loading-spinner" /><strong>正在确认主线、龙头与首次分歧</strong><span>同时检查候选股的共振观察股</span></div>}

        {!loading && !result && <div className="empty-backtest daily-scan-empty"><h3>还没有保存的扫描结果</h3><p>点击“运行收盘扫描”，生成今天的候选股与观察股。</p></div>}

        {!loading && result && <>
          <section className="daily-scan-summary">
            <article><span>扫描交易日</span><strong>{result.scanDate}</strong><small>主线确认日 {result.baseDate}</small></article>
            <article><span>明日候选股</span><strong>{result.candidates.length}</strong><small>今日首次充分分歧</small></article>
            <article><span>连板观察股</span><strong>{result.watch.length}</strong><small>尚未分歧，继续跟踪</small></article>
            <article><span>结果保存时间</span><strong className="daily-scan-time">{savedTime(result.savedAt)}</strong><small>数据日期 {result.dataDates.join(" / ")}</small></article>
          </section>
          {result.diagnostics.autoSyncedDates.length > 0 && <p className="daily-scan-note">本次自动补抓涨停池：{result.diagnostics.autoSyncedDates.join("、")}</p>}

          <section className="daily-stock-section">
            <div className="daily-stock-heading"><div><p className="eyebrow">NEXT-DAY CANDIDATES</p><h2>明日弱转强候选股 <span>{result.candidates.length}</span></h2></div><p>次日 5 分钟封板与板块共振缺一不可</p></div>
            {result.candidates.length ? <div className="candidate-grid">{result.candidates.map((candidate) => <article className="candidate-card" key={candidate.id}>
              <div className="candidate-card-header"><div><span className="theme-pill">{candidate.themeName}</span><h3>{candidate.name}<small>{candidate.code}</small></h3></div><span className="divergence-badge">{candidate.divergenceKind}分歧</span></div>
              <div className="candidate-metrics"><div><span>原连板高度</span><strong>{candidate.leaderBoards} 板</strong></div><div><span>分歧涨跌</span><strong className={candidate.divergencePct >= 0 ? "quote-up" : "quote-down"}>{candidate.divergencePct}%</strong></div><div><span>成交额比</span><strong>{candidate.amountRatio}×</strong></div><div><span>主线涨停宽度</span><strong>{candidate.themeLimitUps} 家</strong></div></div>
              <div className="candidate-price"><span>今日收盘 <strong>¥{candidate.close.toFixed(2)}</strong></span><span>次日涨停参考 <strong>¥{candidate.nextLimitPrice.toFixed(2)}</strong></span></div>
              <div className="candidate-peers"><span>共振观察股</span><div>{candidate.peers.map((peer) => <span key={peer.code}>{peer.name}<small>{peer.continuousBoards} 板</small></span>)}</div></div>
              <p className="candidate-condition">次日龙头 5 分钟收盘封板，同时至少 {Math.min(2, candidate.peers.length)} 只观察股涨幅 ≥ 2%，才进入执行确认。</p>
              <a className="candidate-execution-link" href={executionLink(candidate)}>送入弱转强执行程序<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
            </article>)}</div> : <div className="empty-backtest"><h3>今天没有符合规则的候选股</h3><p>{result.diagnostics.dataErrors.length ? "部分股票存在数据错误，请结合下方诊断确认扫描完整性。" : "没有主线龙头出现满足成交额条件的首次炸板或断板。"}</p></div>}
          </section>

          <section className="daily-stock-section watch-section">
            <div className="daily-stock-heading"><div><p className="eyebrow">WAITING FOR DIVERGENCE</p><h2>主线龙头观察股 <span>{result.watch.length}</span></h2></div><p>仍在连板，等待首次充分分歧</p></div>
            {result.watch.length ? <div className="watch-table-wrap"><table><thead><tr><th>龙头 / 主线</th><th>当前高度</th><th>主线宽度</th><th>首封时间</th><th>板块观察股</th><th>下一步</th></tr></thead><tbody>{result.watch.map((stock) => <tr key={stock.id}><td><strong>{stock.name}<small>{stock.code}</small></strong><span className="theme-pill">{stock.themeName}</span></td><td className="watch-boards">{stock.continuousBoards} 板</td><td>{stock.themeLimitUps} 家</td><td>{stock.firstLimitTime.slice(0, 5)}</td><td>{stock.peers.slice(0, 3).map((peer) => peer.name).join("、") || "—"}</td><td><span className="watch-status">等待首次分歧</span></td></tr>)}</tbody></table></div> : <div className="empty-backtest"><h3>当前没有符合条件的连板观察股</h3></div>}
          </section>
          {result.diagnostics.dataErrors.length > 0 && <div className="daily-data-errors"><strong>部分股票未参与候选判断</strong>{result.diagnostics.dataErrors.map((item) => <p key={item.code}>{item.code}：{item.error}</p>)}</div>}
        </>}
      </main>
      <footer className="site-footer"><span>候选股 ≠ 买入信号 · 次日必须重新确认 5 分钟封板与板块共振 · 结果保存于 D1</span><span>仅供策略研究，不构成投资建议</span></footer>
    </div>
  );
}
