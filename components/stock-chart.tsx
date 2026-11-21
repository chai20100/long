"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import type { KlinePoint, StockKline, StockRef } from "@/lib/stocks";

echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const UP_COLOR = "#ed4b4b";
const DOWN_COLOR = "#159a72";

type DateRange = { start: string; end: string };

interface StockChartProps {
  stock: StockRef;
  range: DateRange;
  refreshKey: number;
  loadIndex: number;
  group: string;
  onRemove: (code: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDropStock: (event: DragEvent<HTMLElement>) => void;
}

function movingAverage(points: KlinePoint[], period: number): (number | null)[] {
  let sum = 0;
  return points.map((point, index) => {
    sum += point.close;
    if (index >= period) sum -= points[index - period].close;
    return index >= period - 1 ? Number((sum / period).toFixed(2)) : null;
  });
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

function formatAmount(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return value.toFixed(0);
}

function formatVolume(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿手`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)} 万手`;
  return `${value.toFixed(0)} 手`;
}

function tooltipHtml(point: KlinePoint): string {
  const changeClass = point.pctChange >= 0 ? "tooltip-up" : "tooltip-down";
  const rows = [
    ["开盘", formatPrice(point.open)],
    ["最高", formatPrice(point.high)],
    ["最低", formatPrice(point.low)],
    ["收盘", formatPrice(point.close)],
    ["涨跌幅", `${point.pctChange >= 0 ? "+" : ""}${point.pctChange.toFixed(2)}%`],
    ["成交量", formatVolume(point.volume)],
    ["成交额", formatAmount(point.amount)],
    ["换手率", `${point.turnover.toFixed(2)}%`],
  ];
  return `
    <div class="chart-tooltip">
      <div class="chart-tooltip-date">${point.date}</div>
      <div class="chart-tooltip-grid">
        ${rows.map(([label, value], index) => `
          <span>${label}</span>
          <strong class="${index === 4 ? changeClass : ""}">${value}</strong>
        `).join("")}
      </div>
    </div>
  `;
}

function buildOption(data: StockKline): EChartsCoreOption {
  const points = data.klines;
  const dates = points.map((point) => point.date);
  const candles = points.map((point) => [point.open, point.close, point.low, point.high]);
  const volumes = points.map((point) => point.volume);

  return {
    animation: true,
    animationDuration: 450,
    animationDurationUpdate: 350,
    animationEasing: "cubicOut",
    axisPointer: {
      link: [{ xAxisIndex: "all" }],
      label: { backgroundColor: "#566176" },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", crossStyle: { color: "#94a3b8" } },
      confine: true,
      backgroundColor: "#182235",
      borderWidth: 0,
      padding: 0,
      textStyle: { color: "#f8fafc", fontSize: 12 },
      extraCssText: "border-radius: 10px; box-shadow: 0 12px 30px rgba(15, 23, 42, .2);",
      formatter: (params: unknown) => {
        const items = params as { dataIndex: number }[];
        const point = points[items[0]?.dataIndex];
        return point ? tooltipHtml(point) : "";
      },
    },
    grid: [
      { left: 12, right: 14, top: 18, height: "55%", containLabel: true },
      { left: 12, right: 14, top: "70%", height: "15%", containLabel: true },
    ],
    xAxis: [
      {
        type: "category",
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "#e5e9ef" } },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        gridIndex: 1,
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "#e5e9ef" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#8a94a6",
          fontSize: 10,
          hideOverlap: true,
          formatter: (value: string) => value.slice(5),
        },
        min: "dataMin",
        max: "dataMax",
      },
    ],
    yAxis: [
      {
        scale: true,
        position: "right",
        splitNumber: 3,
        axisLabel: { color: "#8a94a6", fontSize: 10, formatter: (value: number) => value.toFixed(2) },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#edf0f4", type: "dashed" } },
      },
      {
        gridIndex: 1,
        position: "right",
        splitNumber: 2,
        axisLabel: {
          color: "#8a94a6",
          fontSize: 10,
          formatter: (value: number) => value >= 10_000 ? `${(value / 10_000).toFixed(0)}万` : value,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
      },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
        height: 16,
        bottom: 2,
        borderColor: "transparent",
        backgroundColor: "#f4f6f8",
        fillerColor: "rgba(226, 232, 240, .7)",
        handleStyle: { color: "#a7b0bf", borderColor: "#a7b0bf" },
        moveHandleStyle: { color: "#c2c9d3" },
        emphasis: { moveHandleStyle: { color: "#8f99a9" } },
        dataBackground: {
          lineStyle: { color: "#d4dae3" },
          areaStyle: { color: "#edf0f4" },
        },
        selectedDataBackground: {
          lineStyle: { color: "#8f99a9" },
          areaStyle: { color: "#dce1e8" },
        },
        textStyle: { color: "#8a94a6", fontSize: 9 },
        brushSelect: false,
      },
    ],
    series: [
      {
        name: "日K",
        type: "candlestick",
        data: candles,
        barMaxWidth: 16,
        itemStyle: {
          color: UP_COLOR,
          color0: DOWN_COLOR,
          borderColor: UP_COLOR,
          borderColor0: DOWN_COLOR,
        },
      },
      ...([5, 10, 20, 60] as const).map((period, index) => ({
        name: `MA${period}`,
        type: "line" as const,
        data: movingAverage(points, period),
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        lineStyle: {
          width: 1.25,
          color: ["#e7a83e", "#8b5cf6", "#3b82f6", "#8792a5"][index],
        },
        emphasis: { disabled: true },
        z: 3,
      })),
      {
        name: "成交量",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        barMaxWidth: 16,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const point = points[params.dataIndex];
            return point && point.close < point.open ? DOWN_COLOR : UP_COLOR;
          },
          opacity: 0.72,
        },
      },
    ],
  };
}

export function StockChart({
  stock,
  range,
  refreshKey,
  loadIndex,
  group,
  onRemove,
  onDragStart,
  onDragEnd,
  onDropStock,
}: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const loadOrder = useRef(loadIndex).current;
  const [data, setData] = useState<StockKline | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chart.group = group;
    chartRef.current = chart;
    echarts.connect(group);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [group]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setData(null);

    const query = new URLSearchParams({ code: stock.code, start: range.start, end: range.end });
    const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

    async function loadData() {
      let message = "行情加载失败";
      await wait(loadOrder * 300);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!active) return;
        try {
          const response = await fetch(`/api/kline?${query}`, { signal: controller.signal });
          const body = await response.json() as StockKline & { error?: string };
          if (response.ok) {
            if (active) {
              setData(body);
              setLoading(false);
            }
            return;
          }
          message = body.error ?? message;
          if (response.status !== 429 && response.status < 500) break;
        } catch (reason: unknown) {
          if (controller.signal.aborted) return;
          message = reason instanceof Error ? reason.message : message;
        }
        if (attempt < 2) await wait(400 * (attempt + 1));
      }
      if (active) {
        setError(message);
        setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
      controller.abort();
    };
  }, [stock.code, range.start, range.end, refreshKey, retryKey, loadOrder]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (data?.klines.length) {
      chart.setOption(buildOption(data), { notMerge: true });
    } else {
      chart.clear();
    }
  }, [data]);

  const latest = data?.klines.at(-1);
  const changeClass = latest ? latest.pctChange >= 0 ? "quote-up" : "quote-down" : "";
  const market = data?.market ?? (/^(6|9)/.test(stock.code) ? "SH" : "SZ");

  return (
    <article
      className="stock-card"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropStock}
    >
      <div className="stock-card-header">
        <div className="stock-identity">
          <div className="stock-name-row">
            <h2>{data?.name ?? stock.name}</h2>
            <span className="stock-code">{market} {stock.code}</span>
            <a
              className="external-link"
              href={`https://quote.eastmoney.com/${market.toLowerCase()}${stock.code}.html`}
              target="_blank"
              rel="noreferrer"
              aria-label={`在东方财富查看${stock.code}`}
              title="在东方财富查看"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M7 5h8v8M15 5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
          <div className="stock-quote">
            {latest ? (
              <>
                <strong className={changeClass}>{formatPrice(latest.close)}</strong>
                <span className={changeClass}>
                  {latest.pctChange >= 0 ? "+" : ""}{latest.pctChange.toFixed(2)}%
                </span>
                <span className="latest-date">{latest.date.slice(5)} 收盘</span>
              </>
            ) : <span className="quote-placeholder">{loading ? "行情加载中…" : "暂无行情"}</span>}
          </div>
        </div>
        <button
          className="drag-handle stock-drag-handle"
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-label={`拖动排序${stock.code}`}
          title="拖动排序股票"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="3.5" r="1" /><circle cx="11" cy="3.5" r="1" />
            <circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" />
            <circle cx="5" cy="12.5" r="1" /><circle cx="11" cy="12.5" r="1" />
          </svg>
        </button>
        <button className="remove-stock" type="button" onClick={() => onRemove(stock.code)} aria-label={`移除${stock.code}`} title="移除股票">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="chart-toolbar">
        <div className="chart-tags"><span>日K</span><span>前复权</span></div>
        <div className="ma-legend" aria-label="均线图例">
          <span className="ma-5">MA5</span>
          <span className="ma-10">MA10</span>
          <span className="ma-20">MA20</span>
          <span className="ma-60">MA60</span>
        </div>
      </div>

      <div className="chart-stage">
        <div className="chart-container" ref={containerRef} />
        {loading && (
          <div className="chart-state">
            <span className="loading-spinner" />
            <span>正在获取东方财富行情</span>
          </div>
        )}
        {!loading && error && (
          <div className="chart-state chart-error">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 8v5m0 3.5v.1M10.3 4.7 3.1 17.2A2 2 0 0 0 4.8 20h14.4a2 2 0 0 0 1.7-2.8L13.7 4.7a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{error}</span>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button>
          </div>
        )}
        {!loading && !error && data && data.klines.length === 0 && (
          <div className="chart-state"><span>该时间范围内暂无交易数据</span></div>
        )}
      </div>

      <div className="stock-card-footer">
        <span>{data ? `${data.klines.length} 个交易日` : "日线行情"}</span>
        <span>滚轮缩放 · 拖动平移</span>
      </div>
    </article>
  );
}
