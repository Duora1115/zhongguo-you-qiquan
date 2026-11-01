export function cny(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10_000) {
    const wan = abs / 10_000;
    return `${sign}${wan.toFixed(wan >= 100 ? 1 : 2)}万`;
  }
  if (abs >= 100) return sign + abs.toFixed(0);
  return sign + abs.toFixed(2);
}

export function signedCny(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${cny(n)}`;
  return cny(n);
}

export function px(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(4);
}

export function strikePx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

export function ivText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function pct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function shares(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + Math.abs(Math.round(n)).toLocaleString("zh-CN");
}

export function expiryLabel(expiry: string, dte: number): string {
  const [, month, day] = expiry.split("-");
  const when = dte <= 0 ? "今日" : `${dte}天`;
  return `${month}-${day} · ${when}`;
}
