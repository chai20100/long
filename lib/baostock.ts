import { Socket } from "node:net";

const HOST = "public-api.baostock.com";
const PORT = 10030;
const VERSION = "00.9.40";
const SEPARATOR = "\x01";
const TERMINATOR = new TextEncoder().encode("<![CDATA[]]>\n");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PAGE_SIZE = 2000;

export interface BaostockKlineResult {
  fields: string[];
  rows: string[][];
}

export interface BaostockStock {
  code: string;
  name: string;
  ipoDate: string;
  outDate: string;
  type: string;
  status: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(value: string): number {
  let crc = 0xffffffff;
  for (const byte of encoder.encode(value)) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasTerminator(bytes: Uint8Array): boolean {
  if (bytes.length < TERMINATOR.length) return false;
  return TERMINATOR.every((byte, index) => bytes[bytes.length - TERMINATOR.length + index] === byte);
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const decompressed = await new Response(stream).arrayBuffer();
  return decoder.decode(decompressed);
}

function records(body: string[], index: number): string[][] {
  const value = body[index]?.trim();
  if (!value) return [];
  const parsed = JSON.parse(value) as { record?: string[][] };
  return Array.isArray(parsed.record) ? parsed.record : [];
}

export class BaostockClient {
  private socket: Socket | null = null;
  private chunks: Buffer[] = [];
  private length = 0;
  private notification: (() => void) | null = null;
  private failure: Error | null = null;
  private closed = false;

  async open(): Promise<void> {
    const socket = new Socket();
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.length += chunk.length;
      this.notification?.();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.notification?.();
    });
    socket.on("close", () => {
      this.closed = true;
      this.notification?.();
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("BaoStock 连接超时"));
      }, 20_000);
      const onError = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.off("error", onError);
        resolve();
      });
      socket.connect(PORT, HOST);
    });
    const login = await this.request("00", "login\x01anonymous\x01123456\x010");
    const body = login.split(SEPARATOR);
    if (body[0] !== "0") throw new Error(`BaoStock 登录失败：${body[1] ?? body[0]}`);
  }

  private async request(type: string, body: string): Promise<string> {
    const socket = this.socket;
    if (!socket || this.closed) throw new Error("BaoStock 连接尚未建立");
    const header = `${VERSION}${SEPARATOR}${type}${SEPARATOR}${String(body.length).padStart(10, "0")}`;
    const headBody = `${header}${body}`;
    this.chunks = [];
    this.length = 0;
    const payload = encoder.encode(`${headBody}${SEPARATOR}${crc32(headBody)}\n`);
    await new Promise<void>((resolve, reject) => {
      socket.write(payload, (error) => error ? reject(error) : resolve());
    });

    while (true) {
      if (this.chunks.length) {
        const combined = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        if (hasTerminator(combined)) {
          this.chunks = [];
          this.length = 0;
          return this.decodeResponse(combined);
        }
      }
      if (this.failure) throw this.failure;
      if (this.closed) throw new Error("BaoStock 连接意外关闭");
      await this.waitForData();
    }
  }

  private async waitForData(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.notification = null;
        this.socket?.destroy();
        reject(new Error("BaoStock 数据接收超时"));
      }, 30_000);
      this.notification = () => {
        clearTimeout(timeout);
        this.notification = null;
        resolve();
      };
    });
  }

  private async decodeResponse(bytes: Uint8Array): Promise<string> {
    const header = decoder.decode(bytes.slice(0, 21)).split(SEPARATOR);
    const type = header[1];
    const bodyLength = Number(header[2]);
    if (!Number.isInteger(bodyLength) || bodyLength < 0 || bytes.length < 21 + bodyLength) {
      throw new Error("BaoStock 返回消息长度无效");
    }
    const body = bytes.slice(21, 21 + bodyLength);
    if (type === "96" || type === "99" || type === "9B" || type === "9D") return inflate(body);
    return decoder.decode(bytes.slice(21));
  }

  async queryKline(
    code: string,
    start: string,
    end: string,
    frequency: "d" | "5",
  ): Promise<BaostockKlineResult> {
    const fields = frequency === "d"
      ? "date,code,open,high,low,close,preclose,volume,amount,turn,tradestatus,pctChg,isST"
      : "date,time,code,open,high,low,close,volume,amount";
    const allRows: string[][] = [];
    for (let page = 1; page <= 100; page += 1) {
      const body = [
        "query_history_k_data_plus", "anonymous", page, PAGE_SIZE,
        code, fields, start, end, frequency, "3",
      ].join(SEPARATOR);
      const response = (await this.request("95", body)).split(SEPARATOR);
      if (response[0] !== "0") throw new Error(`BaoStock 行情查询失败：${response[1] ?? response[0]}`);
      const rows = records(response, 6);
      allRows.push(...rows);
      if (rows.length < PAGE_SIZE) {
        return { fields: response[8]?.split(",").map((field) => field.trim()) ?? fields.split(","), rows: allRows };
      }
    }
    throw new Error(`${code} 行情分页超过安全上限`);
  }

  async listTradingDates(start: string, end: string): Promise<string[]> {
    const dates: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const body = ["query_trade_dates", "anonymous", page, PAGE_SIZE, start, end].join(SEPARATOR);
      const response = (await this.request("33", body)).split(SEPARATOR);
      if (response[0] !== "0") throw new Error(`BaoStock 交易日历查询失败：${response[1] ?? response[0]}`);
      const rows = records(response, 6);
      const fields = response[9]?.split(",").map((field) => field.trim()) ?? [];
      const dateIndex = fields.indexOf("calendar_date");
      const tradingIndex = fields.indexOf("is_trading_day");
      for (const row of rows) {
        if (row[tradingIndex] === "1" && row[dateIndex]) dates.push(row[dateIndex]);
      }
      if (rows.length < PAGE_SIZE) return dates;
    }
    throw new Error("BaoStock 交易日历分页超过安全上限");
  }

  async listStocks(): Promise<BaostockStock[]> {
    const all: BaostockStock[] = [];
    let fields: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const body = ["query_stock_basic", "anonymous", page, PAGE_SIZE, "", ""].join(SEPARATOR);
      const response = (await this.request("45", body)).split(SEPARATOR);
      if (response[0] !== "0") throw new Error(`BaoStock 股票清单查询失败：${response[1] ?? response[0]}`);
      const rows = records(response, 6);
      fields = response[9]?.split(",").map((field) => field.trim()) ?? fields;
      const index = Object.fromEntries(fields.map((field, position) => [field, position]));
      for (const row of rows) {
        all.push({
          code: row[index.code] ?? "",
          name: row[index.code_name] ?? "",
          ipoDate: row[index.ipoDate] ?? "",
          outDate: row[index.outDate] ?? "",
          type: row[index.type] ?? "",
          status: row[index.status] ?? "",
        });
      }
      if (rows.length < PAGE_SIZE) return all;
    }
    throw new Error("BaoStock 股票清单分页超过安全上限");
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.notification = null;
    socket?.destroy();
  }
}

export async function withBaostock<T>(operation: (client: BaostockClient) => Promise<T>): Promise<T> {
  const client = new BaostockClient();
  try {
    await client.open();
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
