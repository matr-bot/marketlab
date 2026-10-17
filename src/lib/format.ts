// Display formatting. Prices arrive as integer cents and are shown exactly (CLAUDE.md: exact
// prices and sizes, never rounded). Only the percentage change uses floating point, and it is a
// display ratio, never money.

const qtyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 18742 → "187.42"; 123456789 → "1,234,567.89". */
export function formatPrice(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${qtyFormat.format(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Signed price change: 35 → "+0.35", -120 → "-1.20", 0 → "0.00". */
export function formatChange(cents: number): string {
  return cents > 0 ? `+${formatPrice(cents)}` : formatPrice(cents);
}

/** Signed percent change of `change` against `base`, two decimals: (35, 18700) → "+0.19%". */
export function formatPercent(change: number, base: number): string {
  const pct = (change / base) * 100;
  const text = Math.abs(pct).toFixed(2);
  if (text === "0.00") return "0.00%";
  return `${pct > 0 ? "+" : "-"}${text}%`;
}

/** The mid of two cent prices, exactly: (18699, 18701) → "187.00"; (18699, 18700) → "186.995". */
export function formatMid(bid: number, ask: number): string {
  const sum = bid + ask;
  return sum % 2 === 0 ? formatPrice(sum / 2) : `${formatPrice((sum - 1) / 2)}5`;
}

/** Shares with thousands separators: 1340 → "1,340". */
export function formatQty(qty: number): string {
  return qtyFormat.format(qty);
}
