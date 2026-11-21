"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, FormEvent } from "react";
import { StockChart } from "@/components/stock-chart";
import {
  createDefaultBoards,
  initialRange,
  localISO,
  monthsAgo,
  parseBoardConfig,
  type DateRange,
  type WatchlistBoard,
} from "@/lib/boards";

const PRESETS = [
  { id: "1m", label: "近1月", months: 1 },
  { id: "3m", label: "近3月", months: 3 },
  { id: "6m", label: "近6月", months: 6 },
  { id: "1y", label: "近1年", months: 12 },
];

interface BoardUi {
  draftRange: DateRange;
  activePreset: string;
  codeInput: string;
  error: string;
  refreshKey: number;
  settingsOpen: boolean;
}

function boardUi(board: WatchlistBoard, settingsOpen = false): BoardUi {
  return {
    draftRange: { ...board.range },
    activePreset: "",
    codeInput: "",
    error: "",
    refreshKey: 0,
    settingsOpen: settingsOpen && !board.collapsed,
  };
}

function uiMap(boards: WatchlistBoard[], openFirst = false): Record<string, BoardUi> {
  return Object.fromEntries(boards.map((board, index) => [board.id, boardUi(board, openFirst && index === 0)]));
}

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M8 5v7m0 9v6M8 12h0v9H3v-9h5Zm16-7v8m0 10v4m0-14h0v10h-5V13h5ZM16 9v5m0 10v4m0-14h0v10h-5V14h5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DragIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="3.5" r="1" /><circle cx="11" cy="3.5" r="1" />
      <circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" />
      <circle cx="5" cy="12.5" r="1" /><circle cx="11" cy="12.5" r="1" />
    </svg>
  );
}

export function StockDashboard() {
  const [boards, setBoards] = useState<WatchlistBoard[]>(createDefaultBoards);
  const [ui, setUi] = useState<Record<string, BoardUi>>(() => uiMap(createDefaultBoards(), true));
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const draggedStock = useRef<{ boardId: string; code: string } | null>(null);
  const draggedBoard = useRef<string | null>(null);
  const revision = useRef(0);
  const today = localISO(new Date());

  useEffect(() => {
    let active = true;
    fetch("/api/boards", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { config?: unknown; error?: string };
        if (!response.ok) throw new Error(body.error ?? "配置加载失败");
        const config = body.config ? parseBoardConfig(body.config) : null;
        if (body.config && !config) throw new Error("保存的配置格式无效");
        if (!active) return;
        const nextBoards = config?.boards ?? createDefaultBoards();
        setBoards(nextBoards);
        setUi(uiMap(nextBoards, true));
        setPageSize(config?.pageSize ?? 10);
        setCurrentPage(1);
        setDirty(false);
      })
      .catch((reason: unknown) => {
        if (active) setSaveError(reason instanceof Error ? reason.message : "云端配置加载失败");
      })
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateUi(boardId: string, patch: Partial<BoardUi>) {
    setUi((current) => {
      const board = boards.find((item) => item.id === boardId);
      if (!board) return current;
      return { ...current, [boardId]: { ...(current[boardId] ?? boardUi(board)), ...patch } };
    });
  }

  function updateBoard(boardId: string, update: (board: WatchlistBoard) => WatchlistBoard) {
    revision.current += 1;
    setDirty(true);
    setSaveError("");
    setBoards((current) => current.map((board) => board.id === boardId ? update(board) : board));
  }

  async function saveBoards() {
    const config = parseBoardConfig({ version: 1, boards, pageSize });
    if (!config) {
      setSaveError("无法保存：请检查板块名称、日期和分页设置");
      return;
    }
    const savingRevision = revision.current;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/boards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败，请稍后重试");
      if (revision.current === savingRevision) setDirty(false);
    } catch (reason: unknown) {
      setSaveError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function newBoard() {
    if (boards.length >= 20) {
      setSaveError("最多创建 20 个自选板块");
      return;
    }
    const board: WatchlistBoard = {
      id: crypto.randomUUID(),
      name: `自选板块 ${boards.length + 1}`,
      stocks: [],
      range: initialRange(),
      columns: 2,
      collapsed: false,
    };
    revision.current += 1;
    setBoards((current) => [board, ...current]);
    setUi((current) => ({ ...current, [board.id]: boardUi(board, true) }));
    setCurrentPage(1);
    setDirty(true);
    setSaveError("");
  }

  function deleteBoard(board: WatchlistBoard) {
    if (!window.confirm(`确定删除“${board.name}”板块吗？`)) return;
    revision.current += 1;
    setBoards((current) => current.filter((item) => item.id !== board.id));
    setUi((current) => {
      const next = { ...current };
      delete next[board.id];
      return next;
    });
    setDirty(true);
  }

  function selectPreset(boardId: string, id: string, months: number) {
    const range = { start: monthsAgo(months), end: localISO(new Date()) };
    updateBoard(boardId, (board) => ({ ...board, range }));
    updateUi(boardId, { draftRange: range, activePreset: id, error: "" });
  }

  function applyRange(boardId: string, event: FormEvent) {
    event.preventDefault();
    const currentUi = ui[boardId];
    if (!currentUi) return;
    const range = currentUi.draftRange;
    if (!range.start || !range.end || range.start > range.end) {
      updateUi(boardId, { error: "开始日期不能晚于结束日期" });
      return;
    }
    updateBoard(boardId, (board) => ({ ...board, range: { ...range } }));
    updateUi(boardId, { error: "", refreshKey: currentUi.refreshKey + 1 });
  }

  function addStock(boardId: string, event: FormEvent) {
    event.preventDefault();
    const board = boards.find((item) => item.id === boardId);
    const currentUi = ui[boardId];
    if (!board || !currentUi) return;
    const code = currentUi.codeInput;
    if (!/^\d{6}$/.test(code)) {
      updateUi(boardId, { error: "请输入 6 位数字股票代码" });
      return;
    }
    if (board.stocks.some((stock) => stock.code === code)) {
      updateUi(boardId, { error: "这只股票已经在当前板块中" });
      return;
    }
    updateBoard(boardId, (current) => ({
      ...current,
      stocks: [...current.stocks, { code, name: code }],
    }));
    updateUi(boardId, { codeInput: "", error: "" });
  }

  function reorderStock(boardId: string, targetCode: string) {
    const source = draggedStock.current;
    if (!source || source.boardId !== boardId || source.code === targetCode) return;
    updateBoard(boardId, (board) => {
      const sourceIndex = board.stocks.findIndex((stock) => stock.code === source.code);
      const targetIndex = board.stocks.findIndex((stock) => stock.code === targetCode);
      if (sourceIndex < 0 || targetIndex < 0) return board;
      const stocks = [...board.stocks];
      const [moved] = stocks.splice(sourceIndex, 1);
      stocks.splice(targetIndex, 0, moved);
      return { ...board, stocks };
    });
  }

  function reorderBoard(targetId: string) {
    const sourceId = draggedBoard.current;
    if (!sourceId || sourceId === targetId) return;
    revision.current += 1;
    setBoards((current) => {
      const sourceIndex = current.findIndex((board) => board.id === sourceId);
      const targetIndex = current.findIndex((board) => board.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDirty(true);
  }

  const totalPages = Math.max(1, Math.ceil(boards.length / pageSize));
  const visibleBoards = boards.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="多股日线首页">
            <span className="brand-mark"><BrandMark /></span>
            <span className="brand-copy"><strong>多股日线</strong><small>KLINE BOARD</small></span>
          </a>
          <div className="header-actions">
            <div className="source-badge"><span className="source-dot" />东方财富数据<span className="badge-divider" />前复权</div>
            <a className="strategy-nav-link" href="/daily-strategy">每日扫描</a>
            <a className="strategy-nav-link" href="/first-divergence">弱转强程序</a>
            <a className="strategy-nav-link" href="/leader-backtest">龙头回测</a>
            <button
              className="logout-button"
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.assign("/login");
              }}
            >退出登录</button>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="page-intro">
          <div>
            <p className="eyebrow">A 股多板块对比工具</p>
            <h1>自选组合，<span>按你的方式看行情。</span></h1>
            <p className="intro-description">每个板块独立设置股票、日期和布局，拖动排序后保存到云端。</p>
          </div>
          <div className="intro-note">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 17 9 12l3 3 7-8M15 7h4v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>板块内十字光标与缩放联动</span>
          </div>
        </section>

        <div className="boards-toolbar">
          <div className="boards-toolbar-title">
            <h2>自选板块</h2>
            <span className="stock-count">{boards.length} 个</span>
            <span className={`save-state${dirty ? " unsaved" : ""}`}>
              {loadingConfig ? "正在读取云端配置…" : dirty ? "有未保存更改" : "所有更改已保存"}
            </span>
          </div>
          <div className="boards-actions">
            <label className="page-size-setting">
              每页
              <input
                type="number"
                min={1}
                max={50}
                value={pageSize}
                aria-label="每页板块数量"
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (!Number.isInteger(next) || next < 1 || next > 50 || next === pageSize) return;
                  revision.current += 1;
                  setPageSize(next);
                  setCurrentPage(1);
                  setDirty(true);
                }}
              />
              个板块
            </label>
            <button className="new-board-button" type="button" onClick={newBoard}>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              新建板块
            </button>
            <button className="save-boards-button" type="button" onClick={saveBoards} disabled={saving || loadingConfig || !dirty}>
              {saving ? <span className="loading-spinner" /> : (
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 3.5h10.5L16.5 6v10.5h-13v-13Z M7 3.5v5h6v-5M7 16.5v-5h6v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
              )}
              {saving ? "保存中…" : dirty ? "保存看板" : "已保存"}
            </button>
          </div>
        </div>
        {saveError && <p className="form-error save-error">{saveError}</p>}

        {loadingConfig ? (
          <div className="config-loading"><span className="loading-spinner" />正在恢复你的自选板块</div>
        ) : boards.length === 0 ? (
          <div className="empty-watchlist empty-boards">
            <span className="empty-icon"><BrandMark /></span>
            <h3>还没有自选板块</h3>
            <p>新建一个板块，再添加想对比的股票。</p>
            <button className="new-board-button" type="button" onClick={newBoard}>新建第一个板块</button>
          </div>
        ) : (
          <div className="boards-list">
            {visibleBoards.map((board) => {
              const currentUi = ui[board.id] ?? boardUi(board);
              const rangeIsDirty = currentUi.draftRange.start !== board.range.start || currentUi.draftRange.end !== board.range.end;
              return (
                <section
                  className={`board-section${board.collapsed ? " is-collapsed" : ""}`}
                  key={board.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderBoard(board.id);
                  }}
                >
                  <div className="board-panel">
                    <div className="board-titlebar">
                      <button
                        className="drag-handle board-drag-handle"
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          draggedBoard.current = board.id;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", board.id);
                        }}
                        onDragEnd={() => { draggedBoard.current = null; }}
                        aria-label={`拖动排序板块${board.name}`}
                        title="拖动排序板块"
                      ><DragIcon /></button>
                      <input
                        className="board-name-input"
                        value={board.name}
                        maxLength={30}
                        aria-label="板块名称"
                        onChange={(event) => updateBoard(board.id, (current) => ({ ...current, name: event.target.value }))}
                        onBlur={() => {
                          if (!board.name.trim()) updateBoard(board.id, (current) => ({ ...current, name: "未命名板块" }));
                        }}
                      />
                      <span className="stock-count">{board.stocks.length} 只</span>
                      <span className="board-range-summary">{board.range.start} — {board.range.end}</span>
                      <div className="board-title-actions">
                        <button
                          type="button"
                          className="board-collapse-toggle"
                          aria-expanded={!board.collapsed}
                          onClick={() => {
                            updateBoard(board.id, (current) => ({ ...current, collapsed: !current.collapsed }));
                            if (!board.collapsed) updateUi(board.id, { settingsOpen: false });
                          }}
                        >
                          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={board.collapsed ? "m6 8 4 4 4-4" : "m6 12 4-4 4 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          {board.collapsed ? "展开" : "收起"}
                        </button>
                        {!board.collapsed && (
                          <button
                            type="button"
                            className="board-settings-toggle"
                            aria-expanded={currentUi.settingsOpen}
                            onClick={() => updateUi(board.id, { settingsOpen: !currentUi.settingsOpen })}
                          >
                            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12M7 4v4m6 0v4m-5 2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                            板块设置
                          </button>
                        )}
                        <button className="delete-board-button" type="button" onClick={() => deleteBoard(board)}>删除</button>
                      </div>
                    </div>

                    {!board.collapsed && currentUi.settingsOpen && (
                      <div className="board-settings">
                        <div className="board-settings-row">
                          <div className="board-setting-group">
                            <span className="setting-label">时间范围</span>
                            <div className="preset-group" aria-label={`${board.name}快捷时间范围`}>
                              {PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  className={currentUi.activePreset === preset.id ? "active" : ""}
                                  onClick={() => selectPreset(board.id, preset.id, preset.months)}
                                >{preset.label}</button>
                              ))}
                            </div>
                          </div>
                          <div className="board-setting-group columns-setting">
                            <span className="setting-label">每行显示</span>
                            <div className="column-picker">
                              {([1, 2, 3, 4, 5, 6] as const).map((columns) => (
                                <button
                                  key={columns}
                                  type="button"
                                  className={board.columns === columns ? "active" : ""}
                                  onClick={() => updateBoard(board.id, (current) => ({ ...current, columns }))}
                                >{columns} 个</button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="board-settings-row board-settings-bottom">
                          <form className="board-date-form" onSubmit={(event) => applyRange(board.id, event)}>
                            <label className="date-field">
                              <span>开始日期</span>
                              <input
                                type="date"
                                value={currentUi.draftRange.start}
                                max={currentUi.draftRange.end || today}
                                onChange={(event) => updateUi(board.id, {
                                  draftRange: { ...currentUi.draftRange, start: event.target.value },
                                  activePreset: "",
                                  error: "",
                                })}
                                required
                              />
                            </label>
                            <span className="date-separator">至</span>
                            <label className="date-field">
                              <span>结束日期</span>
                              <input
                                type="date"
                                value={currentUi.draftRange.end}
                                max={today}
                                onChange={(event) => updateUi(board.id, {
                                  draftRange: { ...currentUi.draftRange, end: event.target.value },
                                  activePreset: "",
                                  error: "",
                                })}
                                required
                              />
                            </label>
                            <button className="apply-range-button" type="submit">{rangeIsDirty ? "应用区间" : "刷新图表"}</button>
                          </form>
                          <form className="add-stock-form" onSubmit={(event) => addStock(board.id, event)}>
                            <div className="stock-input-wrap">
                              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.4" /><path d="m12.2 12.2 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                              <input
                                value={currentUi.codeInput}
                                onChange={(event) => updateUi(board.id, {
                                  codeInput: event.target.value.replace(/\D/g, "").slice(0, 6),
                                  error: "",
                                })}
                                inputMode="numeric"
                                placeholder="输入 6 位代码添加股票"
                                aria-label={`${board.name}股票代码`}
                              />
                            </div>
                            <button type="submit">添加股票</button>
                          </form>
                        </div>
                        {currentUi.error && <p className="form-error board-form-error">{currentUi.error}</p>}
                      </div>
                    )}
                  </div>

                  {!board.collapsed && (board.stocks.length > 0 ? (
                    <div
                      className={`stock-grid board-stock-grid columns-${board.columns}${board.columns >= 3 ? " compact-columns" : ""}`}
                      style={{ "--board-columns": board.columns } as CSSProperties}
                    >
                      {board.stocks.map((stock, index) => (
                        <StockChart
                          key={stock.code}
                          stock={stock}
                          range={board.range}
                          refreshKey={currentUi.refreshKey}
                          loadIndex={index}
                          group={board.id}
                          onRemove={(code) => updateBoard(board.id, (current) => ({
                            ...current,
                            stocks: current.stocks.filter((item) => item.code !== code),
                          }))}
                          onDragStart={(event) => {
                            draggedStock.current = { boardId: board.id, code: stock.code };
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", stock.code);
                          }}
                          onDragEnd={() => { draggedStock.current = null; }}
                          onDropStock={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            reorderStock(board.id, stock.code);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-watchlist board-empty">
                      <h3>这个板块还是空的</h3>
                      <p>打开“板块设置”，输入股票代码添加第一张日线图。</p>
                    </div>
                  ))}
                </section>
              );
            })}
            {totalPages > 1 && (
              <nav className="boards-pagination" aria-label="板块分页">
                <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</button>
                <span>第 <strong>{currentPage}</strong> / {totalPages} 页</span>
                <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>下一页</button>
              </nav>
            )}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>数据来源：东方财富 · 日线前复权 · 看板与回测数据保存于 Cloudflare D1</span>
        <span>行情数据可能延迟，仅供参考，不构成投资建议</span>
      </footer>
    </div>
  );
}
