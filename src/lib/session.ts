import type { Session } from "@/lib/market-types";

export function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

export function marketSession(now = new Date()): Session {
  const { weekday, hour, minute } = shanghaiParts(now);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const mins = hour * 60 + minute;
  if (mins >= 9 * 60 + 15 && mins < 9 * 60 + 30) return "auction";
  if (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) return "morning";
  if (mins >= 11 * 60 + 30 && mins < 13 * 60) return "lunch";
  if (mins >= 13 * 60 && mins < 14 * 60 + 57) return "afternoon";
  if (mins >= 14 * 60 + 57 && mins < 15 * 60) return "close-auction";
  return "closed";
}

export function priceModeOf(session: Session): "last" | "settle" {
  return session === "closed" ? "settle" : "last";
}

export const SESSION_LABEL: Record<Session, string> = {
  auction: "开盘集合竞价",
  morning: "交易中",
  lunch: "午间休市",
  afternoon: "交易中",
  "close-auction": "收盘集合竞价",
  closed: "已收盘",
};

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
