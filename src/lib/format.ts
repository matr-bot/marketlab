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
  return formatMidX2(bid + ask);
}

/** A mid from twice its value in cents, the one way mids are shown everywhere (QA #7): 37409 → "187.045", 37410 → "187.05". */
export function formatMidX2(x2: number): string {
  return x2 % 2 === 0 ? formatPrice(x2 / 2) : `${formatPrice((x2 - 1) / 2)}5`;
}

/** A candle interval for labels: 10_000 → "10S", 60_000 → "1M", 90_000 → "90S". */
export function formatInterval(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000}M` : `${ms / 1000}S`;
}

/** Shares with thousands separators: 1340 → "1,340". */
export function formatQty(qty: number): string {
  return qtyFormat.format(qty);
}

/**
 * A large count, compact for the status bar (D-073): exact below 10,000, then thousands with one
 * decimal, then millions with two: 9,999 → "9,999", 221,500 → "221.5K", 1,204,300 → "1.20M". The
 * exact figure goes in the tooltip.
 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return formatQty(n);
  if (abs < 999_950) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const TRADER_NAMES: Record<string, string> = {
  noise: "noise traders",
  marketMaker: "market makers",
  value: "value traders",
  panic: "panic sellers",
  momentum: "momentum traders",
  whale: "whales",
  user: "you",
};

/** A trader type as people say it: "panic" → "panic sellers". */
export function traderName(type: string): string {
  return TRADER_NAMES[type] ?? type;
}

const dollarsFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Cents as dollars: 1234 → "$12.34"; -310 → "-$3.10". With `signed`, a gain shows "+": 1234 → "+$12.34". Zero is "$0.00". */
export function formatDollars(cents: number, signed = false): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : signed && cents > 0 ? "+" : "";
  return `${sign}$${dollarsFormat.format(abs / 100)}`;
}

/** A price that is an average and so may fall between cents, shown to the cent: 18701.3333 → "187.01". */
export function formatAvgPrice(cents: number): string {
  return dollarsFormat.format(cents / 100);
}

/** Cents per share with two decimals, signed: 1.3333 → "1.33", -0.5 → "-0.50"; null → "—". */
export function formatCentsPerShare(cents: number | null): string {
  if (cents === null) return "—";
  const text = Math.abs(cents).toFixed(2);
  return cents < 0 && text !== "0.00" ? `-${text}` : text;
}

/** Basis points with one decimal: 0.713 → "0.7"; null → "—". */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  const text = Math.abs(bps).toFixed(1);
  return bps < 0 && text !== "0.0" ? `-${text}` : text;
}

/** Whole seconds as m:ss — 65 → "1:05", 600 → "10:00". */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Half-cents as dollars, exactly: 400 → "$2.00", 401 → "$2.005", -3 → "-$0.015". The execution report
 * is kept in half-cents (a mid can fall on a half cent), so showing at most three decimals keeps
 * spread + impact + resting fills adding up to the total on screen, with no rounding.
 */
export function formatDollarsX2(x2: number): string {
  const sign = x2 < 0 ? "-" : "";
  const abs = Math.abs(x2);
  const dollars = Math.floor(abs / 200);
  const half = abs % 200; // half-cents left over, 0..199
  const cents = String(Math.floor(half / 2)).padStart(2, "0");
  return `${sign}$${qtyFormat.format(dollars)}.${cents}${half % 2 === 1 ? "5" : ""}`;
}

/**
 * The big figure (D-078): how many leading characters every price in `texts` shares, so a panel can
 * show that prefix in gray and the digits that change in white. Always leaves at least the last
 * character out: ["186.96", "186.95", "186.94"] → 5 ("186.9"); ["187.01", "186.99"] → 2 ("18").
 */
export function bigFigureLength(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  let n = Math.min(...texts.map((t) => t.length)) - 1;
  const first = texts[0];
  for (const t of texts) {
    let i = 0;
    while (i < n && t[i] === first[i]) i++;
    n = i;
  }
  return Math.max(0, n);
}

