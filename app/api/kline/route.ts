import { NextRequest, NextResponse } from "next/server";
import { isValidISODate, marketFor, type KlinePoint } from "@/lib/stocks";

const KLINE_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get";

interface EastmoneyResponse {
  rc?: number;
  data?: {
    code?: string;
    name?: string;
    klines?: string[];
  } | null;
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseKline(line: string): KlinePoint | null {
  const fields = line.split(",");
  if (fields.length < 11 || !isValidISODate(fields[0])) return null;
  return {
    date: fields[0],
    open: numberValue(fields[1]),
    close: numberValue(fields[2]),
    high: numberValue(fields[3]),
    low: numberValue(fields[4]),
    volume: numberValue(fields[5]),
    amount: numberValue(fields[6]),
    amplitude: numberValue(fields[7]),
    pctChange: numberValue(fields[8]),
    change: numberValue(fields[9]),
    turnover: numberValue(fields[10]),
  };
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const start = request.nextUrl.searchParams.get("start") ?? "";
  const end = request.nextUrl.searchParams.get("end") ?? "";

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "请输入 6 位股票代码" }, { status: 400 });
  }
  if (!isValidISODate(start) || !isValidISODate(end) || start > end) {
    return NextResponse.json({ error: "请选择有效的开始和结束日期" }, { status: 400 });
  }

  const { market, secid } = marketFor(code);
  const query = new URLSearchParams({
    secid,
    ut: "7eea3edcaed734bea9cbfc24409ed989",
    klt: "101",
    fqt: "1",
    beg: start.replaceAll("-", ""),
    end: end.replaceAll("-", ""),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${KLINE_ENDPOINT}?${query}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: `https://quote.eastmoney.com/${market.toLowerCase()}${code}.html`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      next: { revalidate: 300 },
      signal: controller.signal,
    });
    if (!response.ok) {
      return NextResponse.json({ error: "东方财富行情接口暂时不可用", upstreamStatus: response.status }, { status: 502 });
    }

    const raw = await response.json() as EastmoneyResponse;
    if (raw.rc !== 0 || !raw.data) {
      return NextResponse.json({ error: "未找到该股票，请检查代码是否正确" }, { status: 404 });
    }

    const klines = (raw.data.klines ?? [])
      .map(parseKline)
      .filter((point): point is KlinePoint => point !== null);

    return NextResponse.json({
      code,
      name: raw.data.name ?? code,
      market,
      secid,
      klines,
    }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: timedOut ? "行情请求超时，请稍后重试" : "无法连接东方财富行情服务" },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
