import { DEFAULT_DEPTH_LEVELS } from "@/engine/feed";
import type { DepthLevel, Side } from "@/engine/types";

// A pre-trade estimate for the ticket: walk the levels on screen exactly the way the matching
// engine would (best price first, each level in full before the next) and report what a market
// order of this size would cost if the book did not change before it arrived. It is an estimate
// because the market moves in the meantime; the execution report shows what really happened.

export interface FillEstimate {
  /** Shares the levels shown could fill. */
  readonly filledQty: number;
  /** Average price in cents over those shares (an exact ratio), or null if nothing could fill. */
  readonly avgPrice: number | null;
  /** The last (worst) price touched, in cents, or null. */
  readonly worstPrice: number | null;
  /** Cost against the mid in cents per share (positive = worse than the mid), or null without a mid or a fill. */
  readonly slippageCents: number | null;
  /** Shares the shown levels could not fill. */
  readonly shortBy: number;
  /** True if that shortfall is a real lack of liquidity; false if there may be more book beyond the levels shown. */
  readonly bookExhausted: boolean;
}

/** `levels` are the side the order trades against, best first (asks for a buy, bids for a sell). */
export function estimateMarketFill(levels: readonly DepthLevel[], qty: number, side: Side, mid: number | null, maxLevels: number = DEFAULT_DEPTH_LEVELS): FillEstimate {
  let remaining = qty;
  let notional = 0;
  let worst: number | null = null;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.qty);
    notional += take * level.price;
    remaining -= take;
    worst = level.price;
  }
  const filledQty = qty - remaining;
  const avgPrice = filledQty > 0 ? notional / filledQty : null;
  const sign = side === "buy" ? 1 : -1;
  return {
    filledQty,
    avgPrice,
    worstPrice: worst,
    slippageCents: avgPrice !== null && mid !== null ? sign * (avgPrice - mid) : null,
    shortBy: remaining,
    bookExhausted: remaining > 0 && levels.length < maxLevels,
  };
}
