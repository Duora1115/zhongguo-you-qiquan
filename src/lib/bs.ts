import type { Right } from "@/lib/market-types";

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * erf);
}

function d1d2(S: number, K: number, T: number, sigma: number, r: number, q: number) {
  const vol = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vol;
  return { d1, d2: d1 - vol, vol };
}

export function bsPrice(
  right: Right,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
): number {
  if (!(S > 0) || !(K > 0)) return 0;
  if (T <= 1 / 365 / 8 || sigma <= 1e-6) {
    return right === "C" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const { d1, d2 } = d1d2(S, K, T, sigma, r, q);
  const df = Math.exp(-r * T);
  const dq = Math.exp(-q * T);
  if (right === "C") return S * dq * normCdf(d1) - K * df * normCdf(d2);
  return K * df * normCdf(-d2) - S * dq * normCdf(-d1);
}

export function bsVega(S: number, K: number, T: number, sigma: number, r: number, q: number): number {
  if (!(S > 0) || !(K > 0) || T <= 0 || sigma <= 0) return 0;
  const { d1 } = d1d2(S, K, T, sigma, r, q);
  return S * Math.exp(-q * T) * normPdf(d1) * Math.sqrt(T);
}

export type Greeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export function bsGreeks(
  right: Right,
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
): Greeks {
  if (!(S > 0) || !(K > 0) || T <= 1 / 365 / 8 || sigma <= 1e-4) {
    const intrinsicDelta = right === "C" ? (S > K ? 1 : 0) : S < K ? -1 : 0;
    return { delta: intrinsicDelta, gamma: 0, theta: 0, vega: 0 };
  }
  const { d1, d2 } = d1d2(S, K, T, sigma, r, q);
  const dq = Math.exp(-q * T);
  const df = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const gamma = (dq * pdf) / (S * sigma * Math.sqrt(T));
  const vega = S * dq * pdf * Math.sqrt(T);
  const common = -(S * dq * pdf * sigma) / (2 * Math.sqrt(T));
  if (right === "C") {
    return {
      delta: dq * normCdf(d1),
      gamma,
      vega,
      theta: common - r * K * df * normCdf(d2) + q * S * dq * normCdf(d1),
    };
  }
  return {
    delta: -dq * normCdf(-d1),
    gamma,
    vega,
    theta: common + r * K * df * normCdf(-d2) - q * S * dq * normCdf(-d1),
  };
}

export function impliedVol(
  right: Right,
  price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
): number | null {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 1 / 365 / 2)) return null;
  const discK = K * Math.exp(-r * T);
  const discS = S * Math.exp(-q * T);
  const floor = right === "C" ? Math.max(discS - discK, 0) : Math.max(discK - discS, 0);
  if (price < floor - 1e-4) return null;
  let sigma = Math.min(1.5, Math.max(0.05, Math.abs(price - floor) / (S * Math.sqrt(T) * 0.4) || 0.2));
  for (let i = 0; i < 28; i += 1) {
    const model = bsPrice(right, S, K, T, sigma, r, q);
    const vega = bsVega(S, K, T, sigma, r, q);
    const diff = model - price;
    if (Math.abs(diff) < 1e-4) return sigma;
    if (vega < 1e-8) break;
    sigma = Math.min(4, Math.max(0.01, sigma - diff / vega));
  }
  const model = bsPrice(right, S, K, T, sigma, r, q);
  if (Math.abs(model - price) > Math.max(0.003, price * 0.08)) return null;
  return sigma;
}

export function lognormalCdf(x: number, S: number, T: number, sigma: number, r: number, q: number): number {
  if (x <= 0) return 0;
  if (!(S > 0) || !(T > 0) || !(sigma > 0)) return x >= S ? 1 : 0;
  const mean = Math.log(S) + (r - q - 0.5 * sigma * sigma) * T;
  const sd = sigma * Math.sqrt(T);
  return normCdf((Math.log(x) - mean) / sd);
}

export function lognormalPdf(x: number, S: number, T: number, sigma: number, r: number, q: number): number {
  if (x <= 0 || !(S > 0) || !(T > 0) || !(sigma > 0)) return 0;
  const mean = Math.log(S) + (r - q - 0.5 * sigma * sigma) * T;
  const sd = sigma * Math.sqrt(T);
  const z = (Math.log(x) - mean) / sd;
  return normPdf(z) / (x * sd);
}
