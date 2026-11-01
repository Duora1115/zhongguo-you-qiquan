import type { MarketSnapshot } from "@/lib/market-types";

export function isNativeShell(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { __QIHENG_APK?: boolean }).__QIHENG_APK);
}

export async function requestMarket(force: boolean): Promise<MarketSnapshot> {
  if (isNativeShell()) {
    const { loadMarket } = await import("@/lib/market.fetch");
    return loadMarket(force);
  }
  const { getMarket } = await import("@/lib/market.functions");
  return getMarket({ data: { force } });
}
