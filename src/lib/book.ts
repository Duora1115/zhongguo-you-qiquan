import { bsGreeks, bsPrice, impliedVol, lognormalCdf, lognormalPdf } from "@/lib/bs";
import { chartPriceWindow } from "@/lib/chart-window";
import { legKey, type Contract, type DraftLeg, type MarketSnapshot, type Right } from "@/lib/market-types";
import { contractMark } from "@/lib/strategies";
import { MULTIPLIER } from "@/lib/underlyings";

export type ChainStat = { iv: number | null; delta: number | null };

export type ChainPrep = {
  stats: Map<string, ChainStat>;
  dividendByUnderlying: Map<string, number>;
  atmIvByUnderlying: Map<string, number>;
};

export type BookPoint = {
  price: number;
  expiry: number;
  now: number;
  expiryPos: number;
  density: number;
  expiryNeg: number;
  delta: number;
};

type Resolved = {
  key: string;
  leg: DraftLeg;
  underlying: string;
  name: string;
  detail: string;
  mark: number;
  entry: number;
  stale: boolean;
  iv: number;
  q: number;
  right?: Right;
  strike?: number;
  dte?: number;
  expiry?: string;
};

export type BookAnalysis = {
  points: BookPoint[];
  spot: number;
  scenario: number;
  expiryPnl: number;
  nowPnl: number;
  breakevens: number[];
  maxProfit: number | "unlimited";
  maxLoss: number | "unlimited";
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  netPremium: number;
  margin: number;
  pop: number | null;
  primaryExpiry: string | null;
  primaryDte: number;
  legs: Resolved[];
  mixed: boolean;
  dividend: number;
  atmIv: number | null;
  emLow: number | null;
  emHigh: number | null;
};

function nearestStrike(strikes: number[], spot: number): number | null {
  if (!strikes.length) return null;
  return strikes.reduce((best, strike) => (Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best));
}

function signOf(side: DraftLeg["side"]): number {
  return side === "buy" ? 1 : -1;
}

function valueOption(right: Right, S: number, K: number, T: number, sigma: number, r: number, q: number): number {
  if (T <= 1 / 365 / 8) return Math.max(right === "C" ? S - K : K - S, 0);
  return bsPrice(right, S, K, T, Math.min(4, Math.max(0.01, sigma)), r, q);
}

export function prepareStats(
  contracts: Contract[],
  spots: Map<string, number>,
  rate: number,
  priceMode: MarketSnapshot["priceMode"],
): ChainPrep {
  const stats = new Map<string, ChainStat>();
  const dividendByUnderlying = new Map<string, number>();
  const atmIvByUnderlying = new Map<string, number>();
  for (const code of new Set(contracts.map((contract) => contract.underlying))) {
    const spot = spots.get(code) ?? 0;
    const group = contracts.filter((contract) => contract.underlying === code);
    if (!(spot > 0) || !group.length) continue;
    const qByExpiry = new Map<string, number>();
    for (const expiry of new Set(group.map((contract) => contract.expiry))) {
      const slice = group.filter((contract) => contract.expiry === expiry);
      const strike = nearestStrike([...new Set(slice.map((contract) => contract.strike))], spot);
      const call = slice.find((contract) => contract.right === "C" && contract.strike === strike);
      const put = slice.find((contract) => contract.right === "P" && contract.strike === strike);
      const horizon = Math.max((call?.dte ?? put?.dte ?? 0) / 365, 1 / 365);
      if (!call || !put || !strike) continue;
      const callPx = contractMark(call, priceMode);
      const putPx = contractMark(put, priceMode);
      if (!(callPx > 0) || !(putPx > 0)) continue;
      const forward = callPx - putPx + strike * Math.exp(-rate * horizon);
      if (forward > 0) {
        const q = -Math.log(forward / spot) / horizon;
        if (q > -0.08 && q < 0.2) qByExpiry.set(expiry, q);
      }
    }
    const dividends = [...qByExpiry.values()];
    if (dividends.length) dividendByUnderlying.set(code, dividends.reduce((sum, item) => sum + item, 0) / dividends.length);
    const ivs: number[] = [];
    for (const contract of group) {
      const q = qByExpiry.get(contract.expiry) ?? dividendByUnderlying.get(code) ?? 0;
      const price = contractMark(contract, priceMode);
      const iv = impliedVol(contract.right, price, spot, contract.strike, contract.dte / 365, rate, q);
      const delta =
        iv == null
          ? null
          : bsGreeks(contract.right, spot, contract.strike, Math.max(contract.dte / 365, 1 / 365 / 8), iv, rate, q).delta;
      if (iv != null) ivs.push(iv);
      stats.set(contract.code, { iv, delta });
    }
    const front = [...new Set(group.map((contract) => contract.expiry))].sort()[0];
    const frontContracts = group.filter((contract) => contract.expiry === front);
    const atm = nearestStrike([...new Set(frontContracts.map((contract) => contract.strike))], spot);
    const atmIvs = frontContracts
      .filter((contract) => contract.strike === atm)
      .map((contract) => stats.get(contract.code)?.iv)
      .filter((iv): iv is number => iv != null);
    const pool = atmIvs.length ? atmIvs : ivs;
    if (pool.length) atmIvByUnderlying.set(code, pool.reduce((sum, item) => sum + item, 0) / pool.length);
  }
  return { stats, dividendByUnderlying, atmIvByUnderlying };
}

export function analyzeBook(input: {
  market: MarketSnapshot;
  focus: string;
  legs: DraftLeg[];
  entries: Record<string, number> | null;
  advance: number;
  ivShock: number;
  scenario: number | null;
  prep: ChainPrep;
}): BookAnalysis {
  const { market, focus, prep } = input;
  const spot = market.underlyings.find((item) => item.code === focus)?.price ?? 0;
  const scenario = input.scenario && input.scenario > 0 ? input.scenario : spot;
  const byCode = new Map(market.contracts.map((contract) => [contract.code, contract]));
  const spotOf = (code: string) => market.underlyings.find((item) => item.code === code)?.price ?? 0;
  const underlyingsInBook = new Set<string>();

  const resolved: Resolved[] = input.legs.map((leg) => {
    const key = legKey(leg);
    if (leg.kind === "stock") {
      const meta = market.underlyings.find((item) => item.code === leg.underlying);
      const mark = meta?.price ?? 0;
      underlyingsInBook.add(leg.underlying);
      return {
        key,
        leg,
        underlying: leg.underlying,
        name: `${meta?.name ?? leg.underlying} 正股`,
        detail: `${leg.side === "buy" ? "买入" : "卖出"} ${leg.qty} 万份`,
        mark,
        entry: input.entries?.[key] ?? mark,
        stale: !(mark > 0),
        iv: 0,
        q: 0,
      };
    }
    const contract = byCode.get(leg.code);
    const mark = contract ? contractMark(contract, market.priceMode) : 0;
    const underlying = contract?.underlying ?? focus;
    if (contract) underlyingsInBook.add(underlying);
    const fallbackIv = prep.atmIvByUnderlying.get(underlying) ?? 0.22;
    const iv = contract ? (prep.stats.get(contract.code)?.iv ?? fallbackIv) : fallbackIv;
    return {
      key,
      leg,
      underlying,
      name: contract?.name ?? leg.code,
      detail: contract
        ? `${contract.right === "C" ? "认购" : "认沽"} ${contract.strike.toFixed(3)} · 剩 ${contract.dte} 天`
        : "合约不在当前行情",
      mark,
      entry: input.entries?.[key] ?? mark,
      stale: !contract,
      right: contract?.right,
      strike: contract?.strike,
      dte: contract?.dte,
      expiry: contract?.expiry,
      iv,
      q: prep.dividendByUnderlying.get(underlying) ?? 0,
    };
  });

  const primary =
    resolved
      .filter((item) => item.leg.kind === "option" && item.expiry)
      .reduce<Resolved | null>((best, item) => (best ? ((item.dte ?? 99999) < (best.dte ?? 99999) ? item : best) : item), null) ??
    null;
  const primaryDte = primary?.dte ?? 0;
  const primaryExpiry = primary?.expiry ?? null;
  const advance = Math.min(Math.max(0, input.advance), primaryDte || 0);

  function pnl(item: Resolved, focusPrice: number, advanceDays: number, shock: number): number {
    const direction = signOf(item.leg.side);
    const focusSpot = spot > 0 ? spot : focusPrice;
    const scale = focusSpot > 0 ? focusPrice / focusSpot : 1;
    const S = spotOf(item.underlying) * scale;
    if (item.leg.kind === "stock") return direction * item.leg.qty * MULTIPLIER * (S - item.entry);
    if (item.right == null || item.strike == null || item.dte == null) return 0;
    const model = valueOption(item.right, S, item.strike, (item.dte - advanceDays) / 365, item.iv + shock, market.rate, item.q);
    return direction * item.leg.qty * MULTIPLIER * (model - item.entry);
  }

  function deltaAt(item: Resolved, focusPrice: number, advanceDays: number, shock: number): number {
    const direction = signOf(item.leg.side);
    const focusSpot = spot > 0 ? spot : focusPrice;
    const scale = focusSpot > 0 ? focusPrice / focusSpot : 1;
    const S = spotOf(item.underlying) * scale;
    const dSdF = focusSpot > 0 ? spotOf(item.underlying) / focusSpot : 1;
    if (item.leg.kind === "stock") return direction * item.leg.qty * MULTIPLIER * dSdF;
    if (item.right == null || item.strike == null || item.dte == null || !(S > 0)) return 0;
    const greek = bsGreeks(
      item.right,
      S,
      item.strike,
      Math.max((item.dte - advanceDays) / 365, 1 / 365 / 8),
      Math.min(4, Math.max(0.01, item.iv + shock)),
      market.rate,
      item.q,
    );
    return direction * item.leg.qty * MULTIPLIER * greek.delta * dSdF;
  }

  const strikes = resolved.flatMap((item) => (item.strike != null ? [item.strike] : []));
  const focusIv = prep.atmIvByUnderlying.get(focus) ?? null;
  const focusQ = prep.dividendByUnderlying.get(focus) ?? 0;
  const sigma = focusIv == null ? 0 : Math.max(0.01, focusIv + input.ivShock);
  const remain = Math.max((primaryDte - advance) / 365, 1 / 365);
  const move = (spot || 1) * (focusIv ?? 0.2) * Math.sqrt(Math.max(primaryDte, 1) / 365);
  const wing = Math.max(move * 3.2, (spot || 1) * 0.045);
  const { lo, hi } = chartPriceWindow(spot, strikes, wing);
  const prices = new Set<number>();
  for (let index = 0; index < 121; index += 1) prices.add(lo + ((hi - lo) * index) / 120);
  for (const strike of strikes) if (strike >= lo && strike <= hi) prices.add(strike);

  const points: BookPoint[] = [...prices].sort((a, b) => a - b).map((price) => {
    let expiry = 0;
    let now = 0;
    let delta = 0;
    for (const item of resolved) {
      expiry += pnl(item, price, primaryDte, 0);
      now += pnl(item, price, advance, input.ivShock);
      delta += deltaAt(item, price, advance, input.ivShock);
    }
    const density = sigma > 0 && spot > 0 ? lognormalPdf(price, spot, remain, sigma, market.rate, focusQ) : 0;
    return { price, expiry, now, expiryPos: expiry > 0 ? expiry : 0, expiryNeg: expiry < 0 ? expiry : 0, density, delta };
  });

  const breakevens: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (left.expiry === 0) breakevens.push(left.price);
    else if ((left.expiry < 0 && right.expiry > 0) || (left.expiry > 0 && right.expiry < 0)) {
      const t = left.expiry / (left.expiry - right.expiry);
      breakevens.push(left.price + t * (right.price - left.price));
    }
  }

  const slopeAt = (index: number) => {
    const left = points[index];
    const right = points[index + 1];
    return (right.expiry - left.expiry) / Math.max(1e-9, right.price - left.price);
  };
  const leftSlope = points.length > 2 ? slopeAt(0) : 0;
  const rightSlope = points.length > 2 ? slopeAt(points.length - 2) : 0;
  let maxProfit: number | "unlimited" = rightSlope > 800 || leftSlope < -800 ? "unlimited" : -Infinity;
  let maxLoss: number | "unlimited" = rightSlope < -800 || leftSlope > 800 ? "unlimited" : Infinity;
  for (const point of points) {
    if (maxProfit !== "unlimited") maxProfit = Math.max(maxProfit, point.expiry);
    if (maxLoss !== "unlimited") maxLoss = Math.min(maxLoss, point.expiry);
  }
  if (typeof maxProfit === "number" && !Number.isFinite(maxProfit)) maxProfit = 0;
  if (typeof maxLoss === "number" && !Number.isFinite(maxLoss)) maxLoss = 0;

  let netPremium = 0;
  let margin = 0;
  const covered = new Map<string, number>();
  for (const item of resolved) {
    if (item.leg.kind === "stock") {
      covered.set(item.underlying, (covered.get(item.underlying) ?? 0) + signOf(item.leg.side) * item.leg.qty);
    }
  }
  const greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const item of resolved) {
    const direction = signOf(item.leg.side);
    if (item.leg.kind === "stock") {
      greeks.delta += direction * item.leg.qty * MULTIPLIER;
      continue;
    }
    netPremium += -direction * item.leg.qty * MULTIPLIER * item.entry;
    if (item.right == null || item.strike == null || item.dte == null) continue;
    const underlyingSpot = spotOf(item.underlying);
    const greek = bsGreeks(
      item.right,
      underlyingSpot,
      item.strike,
      Math.max(item.dte / 365, 1 / 365 / 8),
      Math.max(0.01, item.iv),
      market.rate,
      item.q,
    );
    const scale = direction * item.leg.qty * MULTIPLIER;
    greeks.delta += scale * greek.delta;
    greeks.gamma += scale * greek.gamma;
    greeks.theta += (scale * greek.theta) / 365;
    greeks.vega += (scale * greek.vega) / 100;
    if (item.leg.side === "sell") {
      const held = Math.max(0, covered.get(item.underlying) ?? 0);
      const naked = item.right === "C" ? Math.max(0, item.leg.qty - held) : item.leg.qty;
      if (item.right === "C" && held > 0) covered.set(item.underlying, Math.max(0, held - item.leg.qty));
      const otm = item.right === "C" ? Math.max(item.strike - underlyingSpot, 0) : Math.max(underlyingSpot - item.strike, 0);
      const requirement =
        item.right === "C"
          ? item.entry + Math.max(0.12 * underlyingSpot - otm, 0.07 * underlyingSpot)
          : Math.min(item.entry + Math.max(0.12 * underlyingSpot - otm, 0.07 * item.strike), item.strike);
      margin += naked * MULTIPLIER * Math.max(0, requirement);
    }
  }

  let emLow: number | null = null;
  let emHigh: number | null = null;
  if (spot > 0 && focusIv != null && primaryDte > 0) {
    const band = Math.max(0.01, focusIv + input.ivShock) * Math.sqrt(primaryDte / 365);
    emLow = spot * Math.exp(-band);
    emHigh = spot * Math.exp(band);
  }

  let pop: number | null = null;
  const horizon = primaryDte / 365;
  if (focusIv && horizon > 1 / 365 / 2 && points.length > 2 && spot > 0) {
    let probability = 0;
    const cdf = (price: number) => lognormalCdf(price, spot, horizon, focusIv, market.rate, focusQ);
    if (points[0].expiry > 0) probability += cdf(points[0].price);
    for (let index = 1; index < points.length; index += 1) {
      const mid = (points[index - 1].expiry + points[index].expiry) / 2;
      if (mid > 0) probability += cdf(points[index].price) - cdf(points[index - 1].price);
    }
    const last = points[points.length - 1];
    if (last.expiry > 0) probability += 1 - cdf(last.price);
    pop = Math.min(1, Math.max(0, probability));
  }

  let expiryPnl = 0;
  let nowPnl = 0;
  for (const item of resolved) {
    expiryPnl += pnl(item, scenario, primaryDte, 0);
    nowPnl += pnl(item, scenario, advance, input.ivShock);
  }

  return {
    points,
    spot,
    scenario,
    expiryPnl,
    nowPnl,
    breakevens,
    maxProfit,
    maxLoss,
    greeks,
    netPremium,
    margin,
    pop,
    primaryExpiry,
    primaryDte,
    legs: resolved,
    mixed: underlyingsInBook.size > 1,
    dividend: focusQ,
    atmIv: focusIv,
    emLow,
    emHigh,
  };
}

export function sampleBook(points: BookPoint[], price: number): { expiry: number; now: number; delta: number } {
  if (!points.length) return { expiry: 0, now: 0, delta: 0 };
  if (price <= points[0].price) return points[0];
  const last = points[points.length - 1];
  if (price >= last.price) return last;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].price < price) lo = mid;
    else hi = mid;
  }
  const left = points[lo];
  const right = points[hi];
  const span = right.price - left.price;
  const t = span > 0 ? (price - left.price) / span : 0;
  return {
    expiry: left.expiry + (right.expiry - left.expiry) * t,
    now: left.now + (right.now - left.now) * t,
    delta: left.delta + (right.delta - left.delta) * t,
  };
}
