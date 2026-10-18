import type { AgentType, Side } from "./types";

// "Who moved the price?" (D-054, CLAUDE.md). For a window of sim time, aggressive (taker) volume by
// trader type and side, computed straight from the fill log: the aggressor is the side whose
// incoming order caused the trade, so its volume is what pushed the price. Shares are exact
// integers; percentages are whole numbers that always add up to exactly 100 (largest remainder).

/** The parts of a fill attribution needs. */
export interface AttributableFill {
  readonly time: number;
  readonly qty: number;
  readonly aggressor: Side;
  readonly buy: { readonly agentType: AgentType };
  readonly sell: { readonly agentType: AgentType };
}

export interface SideAttribution {
  /** Aggressive shares on this side in the window. */
  readonly shares: number;
  /** Shares by the aggressor's trader type (only types that traded). */
  readonly byType: Readonly<Partial<Record<AgentType, number>>>;
  /** Whole percentages of `shares` by type, summing to exactly 100 (empty when no shares). */
  readonly pct: Readonly<Partial<Record<AgentType, number>>>;
}

export interface Attribution {
  /** Window [from, to) in sim ms. */
  readonly from: number;
  readonly to: number;
  readonly trades: number;
  /** Aggressive buying (buyers who lifted asks) and aggressive selling (sellers who hit bids). */
  readonly buying: SideAttribution;
  readonly selling: SideAttribution;
}

/**
 * Whole percentages that sum to exactly 100: floor each share, then give the leftover points to
 * the largest remainders (ties broken by name, so the result never depends on input order).
 */
export function wholePercents<K extends string>(counts: Readonly<Partial<Record<K, number>>>): Partial<Record<K, number>> {
  const entries = (Object.entries(counts) as Array<[K, number]>).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const out: Partial<Record<K, number>> = {};
  if (total === 0) return out;
  const parts = entries.map(([k, n]) => {
    const exact = (100 * n) / total;
    return { k, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = 100 - parts.reduce((s, p) => s + p.floor, 0);
  const byRemainder = [...parts].sort((a, b) => b.rem - a.rem || (a.k < b.k ? -1 : 1));
  for (const p of byRemainder) {
    out[p.k] = p.floor + (left > 0 ? 1 : 0);
    if (left > 0) left--;
  }
  return out;
}

function side(fills: readonly AttributableFill[], s: Side): SideAttribution {
  const byType: Partial<Record<AgentType, number>> = {};
  let shares = 0;
  for (const f of fills) {
    if (f.aggressor !== s) continue;
    const type = s === "buy" ? f.buy.agentType : f.sell.agentType;
    byType[type] = (byType[type] ?? 0) + f.qty;
    shares += f.qty;
  }
  return { shares, byType, pct: wholePercents(byType) };
}

/** Attribution of the fills with `from ≤ time < to`. */
export function attribute(fills: readonly AttributableFill[], from: number, to: number): Attribution {
  const inWindow = fills.filter((f) => f.time >= from && f.time < to);
  return { from, to, trades: inWindow.length, buying: side(inWindow, "buy"), selling: side(inWindow, "sell") };
}

/** The type with the largest share of a side, e.g. for "62% of selling came from panic sellers". */
export function topType(s: SideAttribution): { type: AgentType; pct: number; shares: number } | null {
  let best: { type: AgentType; pct: number; shares: number } | null = null;
  for (const [type, shares] of Object.entries(s.byType) as Array<[AgentType, number]>) {
    if (best === null || shares > best.shares || (shares === best.shares && type < best.type)) best = { type, pct: s.pct[type]!, shares };
  }
  return best;
}
