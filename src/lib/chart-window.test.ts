import assert from "node:assert/strict";
import test from "node:test";
import { chartPriceWindow, pnlDomain } from "./chart-window.ts";

test("a strike above spot keeps a full right wing, not a 3% sliver", () => {
  const spot = 2.878;
  const strike = 3.3;
  const wing = Math.max(spot * 0.25 * Math.sqrt(2 / 365) * 3.2, spot * 0.045);
  const { lo, hi } = chartPriceWindow(spot, [strike], wing);
  assert.ok(hi > strike * 1.08, `hi ${hi} still hugs the strike`);
  assert.ok(hi - strike >= 0.4);
  const strikeAt = (strike - lo) / (hi - lo);
  assert.ok(strikeAt < 0.8, `strike sits at ${strikeAt}, right wing is still clipped`);
  assert.ok(lo < spot);
});

test("pnl scale includes the right edge instead of clamping it to 0.72x the loss", () => {
  const points = [
    { expiry: 4800, now: 4800 },
    { expiry: -4400, now: -4400 },
    { expiry: 9000, now: 9000 },
  ];
  const [lo, hi] = pnlDomain(points, true, true);
  assert.ok(hi >= 9000, `right wing clipped at ${hi}`);
  assert.ok(lo <= -4400);
});
