export function chartPriceWindow(spot: number, strikes: number[], wing: number): { lo: number; hi: number } {
  const base = spot > 0 ? spot : 1;
  const anchors = strikes.length ? strikes : [base];
  const lowAnchor = Math.min(base, ...anchors);
  const highAnchor = Math.max(base, ...anchors);
  const reach = Math.max(wing * 2.5, base * 0.18, (highAnchor - lowAnchor) * 0.75);
  return {
    lo: Math.max(0.05, lowAnchor - reach),
    hi: highAnchor + reach,
  };
}

export function pnlDomain(
  points: { expiry: number; now: number }[],
  showExpiry: boolean,
  showNow: boolean,
): [number, number] {
  if (points.length < 2) return [-1, 1];
  let lo = 0;
  let hi = 0;
  for (const point of points) {
    for (const item of [showExpiry ? point.expiry : null, showNow ? point.now : null]) {
      if (item == null || !Number.isFinite(item)) continue;
      lo = Math.min(lo, item);
      hi = Math.max(hi, item);
    }
  }
  if (hi <= lo) hi = lo + 1;
  const pad = Math.max((hi - lo) * 0.08, 1);
  return [lo - pad, hi + pad];
}
