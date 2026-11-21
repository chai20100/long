export function normalizeDate(input?: string | null): string | null {
  if (!input) return null;
  const digits = input.replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error("日期格式应为 YYYY-MM-DD 或 YYYYMMDD");
  }
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error("无效交易日期");
  }
  return iso;
}

export function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

export function clock(value?: number | string | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  const digits = String(value).replaceAll(":", "").padStart(6, "0");
  if (!/^\d{6}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

export function minutesSinceOpen(value: string | null): number {
  if (!value) return 24 * 60;
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 60 + minutes + seconds / 60;
}

export function marketFor(code: string): string {
  if (/^(4|8|920)/.test(code)) return "BJ";
  if (/^(6|9)/.test(code)) return "SH";
  return "SZ";
}

export function boardTypeFor(code: string, name: string): string {
  if (name.toUpperCase().includes("ST")) return "ST";
  if (/^(4|8|920)/.test(code)) return "北交所";
  if (/^(300|301|688)/.test(code)) return "20cm";
  return "10cm";
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}
