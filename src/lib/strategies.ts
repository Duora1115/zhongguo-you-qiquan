import type { Contract, DraftLeg, MarketSnapshot, Right } from "@/lib/market-types";

export type StrategyId =
  | "long-call"
  | "long-put"
  | "bull-call"
  | "bear-call"
  | "bull-put"
  | "bear-put"
  | "long-straddle"
  | "short-straddle"
  | "long-strangle"
  | "short-strangle"
  | "iron-condor"
  | "iron-butterfly"
  | "butterfly"
  | "condor"
  | "ratio-call"
  | "risk-reversal"
  | "calendar"
  | "diagonal"
  | "covered-call"
  | "protective-put"
  | "collar";

export const STRATEGIES: { id: StrategyId; name: string; blurb: string }[] = [
  { id: "long-call", name: "买入认购", blurb: "看涨。亏损限于权利金。" },
  { id: "long-put", name: "买入认沽", blurb: "看跌。亏损限于权利金。" },
  { id: "bull-call", name: "牛市认购", blurb: "温和看涨。买低行权价、卖高行权价认购。" },
  { id: "bear-put", name: "熊市认沽", blurb: "温和看跌。买高行权价、卖低行权价认沽。" },
  { id: "bull-put", name: "牛市认沽", blurb: "看不跌。卖出认沽价差，先收权利金。" },
  { id: "bear-call", name: "熊市认购", blurb: "看不涨。卖出认购价差，先收权利金。" },
  { id: "long-straddle", name: "买入跨式", blurb: "赌大幅波动。同一行权价买入认购和认沽。" },
  { id: "short-straddle", name: "卖出跨式", blurb: "赌盘整。两端亏损可能很大。" },
  { id: "long-strangle", name: "买入宽跨", blurb: "更便宜的波动多头，行权价分开。" },
  { id: "short-strangle", name: "卖出宽跨", blurb: "收取权利金，两侧仍有风险。" },
  { id: "iron-condor", name: "铁鹰", blurb: "赌落在区间里。四条腿，亏损有上限。" },
  { id: "iron-butterfly", name: "铁蝶", blurb: "卖出平值跨式，再用两翼把亏损封住。" },
  { id: "butterfly", name: "蝶式", blurb: "赌价格钉在中间行权价附近。" },
  { id: "condor", name: "鹰式", blurb: "认购鹰式。赌价格落在两个卖出行权价之间。" },
  { id: "ratio-call", name: "认购比率", blurb: "买 1 张卖 2 张。上方亏损会放大。" },
  { id: "risk-reversal", name: "风险逆转", blurb: "卖虚值认沽、买虚值认购，方向偏多。" },
  { id: "calendar", name: "日历价差", blurb: "卖近月、买远月同一行权价，赚时间价值差。" },
  { id: "diagonal", name: "对角价差", blurb: "卖近月平值认购，买远月虚值认购。" },
  { id: "covered-call", name: "备兑认购", blurb: "持有 1 万份 ETF，卖出认购。" },
  { id: "protective-put", name: "保护认沽", blurb: "持有 1 万份 ETF，买入认沽保险。" },
  { id: "collar", name: "领口", blurb: "持有 ETF，买认沽、卖认购，锁住区间。" },
];

export type OutlookId = "up" | "down" | "flat" | "move";

export const OUTLOOKS: { id: OutlookId; name: string; hint: string; strategies: StrategyId[] }[] = [
  {
    id: "up",
    name: "看涨",
    hint: "觉得会涨",
    strategies: ["long-call", "bull-call", "bull-put", "risk-reversal", "covered-call"],
  },
  {
    id: "down",
    name: "看跌",
    hint: "觉得会跌",
    strategies: ["long-put", "bear-put", "bear-call", "protective-put"],
  },
  {
    id: "flat",
    name: "震荡",
    hint: "觉得不太动",
    strategies: ["iron-condor", "butterfly", "short-strangle", "short-straddle", "collar"],
  },
  {
    id: "move",
    name: "大波动",
    hint: "方向无所谓，赌它动起来",
    strategies: ["long-straddle", "long-strangle", "calendar", "ratio-call"],
  },
];

export function outlookOf(id: StrategyId | null): OutlookId {
  if (!id) return "up";
  return OUTLOOKS.find((item) => item.strategies.includes(id))?.id ?? "up";
}

function chain(contracts: Contract[], underlying: string, expiry: string, right: Right) {
  return contracts
    .filter((contract) => contract.underlying === underlying && contract.expiry === expiry && contract.right === right)
    .sort((a, b) => a.strike - b.strike);
}

function nearest(contracts: Contract[], spot: number): Contract | undefined {
  return contracts.reduce<Contract | undefined>((best, contract) => {
    if (!best) return contract;
    return Math.abs(contract.strike - spot) < Math.abs(best.strike - spot) ? contract : best;
  }, undefined);
}

function at(contracts: Contract[], index: number): Contract | undefined {
  if (index < 0 || index >= contracts.length) return undefined;
  return contracts[index];
}

function option(contract: Contract, side: "buy" | "sell", qty = 1): DraftLeg {
  return { kind: "option", code: contract.code, side, qty };
}

function stock(underlying: string, side: "buy" | "sell", qty = 1): DraftLeg {
  return { kind: "stock", underlying, side, qty };
}

export function listExpiries(contracts: Contract[], underlying: string): string[] {
  return [
    ...new Set(contracts.filter((contract) => contract.underlying === underlying).map((contract) => contract.expiry)),
  ].sort();
}

export function buildStrategy(
  id: StrategyId,
  contracts: Contract[],
  underlying: string,
  expiry: string,
  spot: number,
): { legs: DraftLeg[] } | { error: string } {
  const calls = chain(contracts, underlying, expiry, "C");
  const puts = chain(contracts, underlying, expiry, "P");
  const atmCall = nearest(calls, spot);
  const atmPut = nearest(puts, spot);
  if (!atmCall || !atmPut) return { error: "这个到期月附近没有成对的认购和认沽" };
  const callIndex = calls.findIndex((contract) => contract.code === atmCall.code);
  const putIndex = puts.findIndex((contract) => contract.strike === atmPut.strike);

  const need = (contract: Contract | undefined, label: string) => {
    if (!contract) return label;
    return null;
  };

  switch (id) {
    case "long-call":
      return { legs: [option(atmCall, "buy")] };
    case "long-put":
      return { legs: [option(atmPut, "buy")] };
    case "bull-call": {
      const higher = at(calls, callIndex + 2) ?? at(calls, callIndex + 1);
      const missing = need(higher, "上方认购不够");
      if (!higher || missing) return { error: missing ?? "上方认购不够" };
      return { legs: [option(atmCall, "buy"), option(higher, "sell")] };
    }
    case "bear-call": {
      const higher = at(calls, callIndex + 2) ?? at(calls, callIndex + 1);
      if (!higher) return { error: "上方认购不够" };
      return { legs: [option(atmCall, "sell"), option(higher, "buy")] };
    }
    case "bull-put": {
      const lower = at(puts, putIndex - 2) ?? at(puts, putIndex - 1);
      if (!lower) return { error: "下方认沽不够" };
      return { legs: [option(atmPut, "sell"), option(lower, "buy")] };
    }
    case "bear-put": {
      const lower = at(puts, putIndex - 2) ?? at(puts, putIndex - 1);
      if (!lower) return { error: "下方认沽不够" };
      return { legs: [option(atmPut, "buy"), option(lower, "sell")] };
    }
    case "long-straddle":
      return { legs: [option(atmCall, "buy"), option(atmPut, "buy")] };
    case "short-straddle":
      return { legs: [option(atmCall, "sell"), option(atmPut, "sell")] };
    case "long-strangle": {
      const call = at(calls, callIndex + 1);
      const put = at(puts, putIndex - 1);
      if (!call || !put) return { error: "虚值合约不够，换一个到期月" };
      return { legs: [option(call, "buy"), option(put, "buy")] };
    }
    case "short-strangle": {
      const call = at(calls, callIndex + 1);
      const put = at(puts, putIndex - 1);
      if (!call || !put) return { error: "虚值合约不够，换一个到期月" };
      return { legs: [option(call, "sell"), option(put, "sell")] };
    }
    case "iron-condor": {
      const sellPut = at(puts, putIndex - 1);
      const buyPut = at(puts, putIndex - 2);
      const sellCall = at(calls, callIndex + 1);
      const buyCall = at(calls, callIndex + 2);
      if (!sellPut || !buyPut || !sellCall || !buyCall) return { error: "行权价档位不够搭铁鹰" };
      return {
        legs: [option(buyPut, "buy"), option(sellPut, "sell"), option(sellCall, "sell"), option(buyCall, "buy")],
      };
    }
    case "iron-butterfly": {
      const low = at(puts, putIndex - 1);
      const high = at(calls, callIndex + 1);
      if (!low || !high) return { error: "行权价档位不够搭铁蝶" };
      return { legs: [option(low, "buy"), option(atmPut, "sell"), option(atmCall, "sell"), option(high, "buy")] };
    }
    case "butterfly": {
      const low = at(calls, callIndex - 1);
      const high = at(calls, callIndex + 1);
      if (!low || !high) return { error: "行权价档位不够搭蝶式" };
      return { legs: [option(low, "buy"), option(atmCall, "sell", 2), option(high, "buy")] };
    }
    case "condor": {
      const low = at(calls, callIndex - 1);
      const midHigh = at(calls, callIndex + 1);
      const high = at(calls, callIndex + 2);
      if (!low || !midHigh || !high) return { error: "行权价档位不够搭鹰式" };
      return { legs: [option(low, "buy"), option(atmCall, "sell"), option(midHigh, "sell"), option(high, "buy")] };
    }
    case "ratio-call": {
      const higher = at(calls, callIndex + 1);
      if (!higher) return { error: "上方认购不够" };
      return { legs: [option(atmCall, "buy"), option(higher, "sell", 2)] };
    }
    case "risk-reversal": {
      const call = at(calls, callIndex + 1) ?? atmCall;
      const put = at(puts, putIndex - 1) ?? atmPut;
      return { legs: [option(put, "sell"), option(call, "buy")] };
    }
    case "calendar": {
      const expiries = listExpiries(contracts, underlying);
      const next = expiries[expiries.indexOf(expiry) + 1];
      if (!next) return { error: "没有更远的到期月" };
      const far = nearest(chain(contracts, underlying, next, "C"), atmCall.strike);
      if (!far) return { error: "远月没有对应认购" };
      return { legs: [option(atmCall, "sell"), option(far, "buy")] };
    }
    case "diagonal": {
      const expiries = listExpiries(contracts, underlying);
      const next = expiries[expiries.indexOf(expiry) + 1];
      if (!next) return { error: "没有更远的到期月，换一个近月" };
      const farStrike = at(calls, callIndex + 1)?.strike ?? atmCall.strike;
      const far = nearest(chain(contracts, underlying, next, "C"), farStrike);
      if (!far) return { error: "远月没有对应认购" };
      return { legs: [option(atmCall, "sell"), option(far, "buy")] };
    }
    case "covered-call":
      return { legs: [stock(underlying, "buy"), option(atmCall, "sell")] };
    case "protective-put":
      return { legs: [stock(underlying, "buy"), option(atmPut, "buy")] };
    case "collar": {
      const call = at(calls, callIndex + 1);
      const put = at(puts, putIndex - 1);
      if (!call || !put) return { error: "虚值合约不够搭领口" };
      return { legs: [stock(underlying, "buy"), option(put, "buy"), option(call, "sell")] };
    }
    default:
      return { error: "未知策略" };
  }
}

export function seedStarter(market: MarketSnapshot, underlying: string): DraftLeg[] {
  const expiries = listExpiries(market.contracts, underlying);
  const spot = market.underlyings.find((item) => item.code === underlying)?.price ?? 0;
  if (!expiries.length || !(spot > 0)) return [];
  const built = buildStrategy("long-call", market.contracts, underlying, expiries[0], spot);
  return "legs" in built ? built.legs : [];
}

export function contractMark(contract: Contract, mode: "last" | "settle"): number {
  if (mode === "settle") {
    if (contract.settle > 0) return contract.settle;
    if (contract.last > 0) return contract.last;
  } else if (contract.last > 0) return contract.last;
  if (contract.bid > 0 && contract.ask > 0) return (contract.bid + contract.ask) / 2;
  if (contract.settle > 0) return contract.settle;
  return contract.prev;
}

export type TemplateId =
  | "single"
  | "vertical"
  | "covered"
  | "collar"
  | "straddle"
  | "strangle"
  | "calendar"
  | "diagonal"
  | "butterfly"
  | "condor"
  | "ironfly"
  | "ironcondor"
  | "custom";

export type ChainMode = "t" | "straddle" | "strangle" | "vertical";

export const TEMPLATES: {
  id: TemplateId;
  name: string;
  en: string;
  strategy: StrategyId | null;
  mode: ChainMode;
}[] = [
  { id: "single", name: "单腿期权", en: "Single Option", strategy: null, mode: "t" },
  { id: "vertical", name: "垂直策略", en: "Vertical Spread", strategy: "bull-call", mode: "vertical" },
  { id: "covered", name: "股票担保", en: "Covered Stock", strategy: "covered-call", mode: "t" },
  { id: "collar", name: "领式策略", en: "Collar", strategy: "collar", mode: "t" },
  { id: "straddle", name: "跨式策略", en: "Straddle", strategy: "long-straddle", mode: "straddle" },
  { id: "strangle", name: "宽跨式策略", en: "Strangle", strategy: "long-strangle", mode: "strangle" },
  { id: "calendar", name: "日历策略", en: "Calendar Spread", strategy: "calendar", mode: "t" },
  { id: "diagonal", name: "对角策略", en: "Diagonal Spread", strategy: "diagonal", mode: "t" },
  { id: "butterfly", name: "蝶式策略", en: "Butterfly", strategy: "butterfly", mode: "t" },
  { id: "condor", name: "鹰式策略", en: "Condor", strategy: "condor", mode: "t" },
  { id: "ironfly", name: "铁蝶式策略", en: "Iron Butterfly", strategy: "iron-butterfly", mode: "t" },
  { id: "ironcondor", name: "铁鹰式策略", en: "Iron Condor", strategy: "iron-condor", mode: "t" },
  { id: "custom", name: "自定义策略", en: "Custom", strategy: null, mode: "t" },
];

export function templateById(id: TemplateId) {
  return TEMPLATES.find((item) => item.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}
