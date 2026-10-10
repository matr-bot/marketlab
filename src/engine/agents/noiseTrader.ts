import { pow } from "../detMath";
import { toTick } from "../price";
import type { Rng } from "../rng";
import type { Cents, Side } from "../types";
import { oldestFirst, type Agent, type AgentContext, type AgentSpec } from "./agent";

// Zero-intelligence noise trader (D-024 to D-026). It has no view on value: at each of its
// random arrival times it either cancels one of its orders or sends a new one, buy or sell at
// random, priced near the mid, with a heavy-tailed size. Sources: Gode & Sunder (1993); Smith,
// Farmer, Gillemot & Krishnamurthy (2003); Farmer, Patelli & Zovko (2005); size tail from
// Gopikrishnan, Plerou, Gabaix & Stanley (2000).

export interface NoiseTraderParams {
  /** Probability an order is a market order. */
  readonly pMarket: number;
  /** Limit offset δ = mu·E − theta (cents), E ~ Exp(1): scale. */
  readonly mu: number;
  /** Limit offset shift (cents); P(δ < 0) = 1 − e^(−theta/mu). */
  readonly theta: number;
  /** Pareto tail exponent for order size. */
  readonly alpha: number;
  /** Smallest order size (shares). */
  readonly xMin: number;
  /** Largest limit order (shares). */
  readonly limitSizeCap: number;
  /** Largest market order (shares). Big sweeps belong to the whale and panic agents (D-025). */
  readonly marketSizeCap: number;
  /** Probability an arrival cancels one of its resting orders (when it has any). */
  readonly pCancel: number;
  /** Most resting orders a trader keeps; at the cap, the oldest is cancelled before placing. */
  readonly maxResting: number;
}

export const DEFAULT_NOISE_PARAMS: NoiseTraderParams = {
  pMarket: 0.1,
  mu: 8,
  theta: 2,
  alpha: 1.5,
  xMin: 100,
  limitSizeCap: 25_000,
  // Market orders are capped far lower (D-025): in the seed-187 hour, uncapped noise market
  // orders caused a single 38¢ sweep; at 2,000 the largest is 10¢ and depth is unchanged.
  marketSizeCap: 2_000,
  pCancel: 0.35,
  maxResting: 5,
};

/** Capped Pareto size: min(cap, ⌊xMin · U^(−1/α)⌋), U strictly inside (0, 1). Whole shares, ≥ xMin. */
export function paretoSize(rng: Rng, alpha: number, xMin: number, cap: number): number {
  return Math.min(cap, Math.floor(xMin * pow(rng.uniformOpen(), -1 / alpha)));
}

/**
 * The price an order is placed relative to: the mid if both sides exist, otherwise the last
 * trade, otherwise the opening price. May be a half cent (the mid of 18700 and 18701).
 */
export function referencePrice(ctx: Pick<AgentContext, "book" | "lastTradePrice" | "startPrice">): number {
  const bid = ctx.book.bestBid();
  const ask = ctx.book.bestAsk();
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return ctx.lastTradePrice ?? ctx.startPrice;
}

export class NoiseTrader implements Agent {
  constructor(
    private readonly rng: Rng,
    private readonly params: NoiseTraderParams = DEFAULT_NOISE_PARAMS,
  ) {}

  act(ctx: AgentContext): void {
    const p = this.params;
    const mine = oldestFirst(ctx.myOrders());

    if (mine.length > 0 && this.rng.uniform() < p.pCancel) {
      ctx.cancel(mine[this.rng.int(0, mine.length - 1)].id);
      return;
    }
    if (mine.length >= p.maxResting) ctx.cancel(mine[0].id);

    const side: Side = this.rng.uniform() < 0.5 ? "buy" : "sell";
    if (this.rng.uniform() < p.pMarket) {
      ctx.submit({ type: "market", side, qty: paretoSize(this.rng, p.alpha, p.xMin, p.marketSizeCap) });
      return;
    }
    const m = referencePrice(ctx);
    const delta = p.mu * this.rng.exponential(1) - p.theta;
    const tick: Cents = ctx.book.tickSize;
    const price = side === "buy" ? toTick(m - delta, tick, "down") : toTick(m + delta, tick, "up");
    ctx.submit({ type: "limit", side, price, qty: paretoSize(this.rng, p.alpha, p.xMin, p.limitSizeCap) });
  }
}

/** `count` noise traders with ids noise-1 … noise-N. */
export function noiseTraders(count: number, ratePerSec: number, params: NoiseTraderParams = DEFAULT_NOISE_PARAMS): AgentSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `noise-${i + 1}`,
    agentType: "noise" as const,
    ratePerSec,
    create: (decisions: Rng) => new NoiseTrader(decisions, params),
  }));
}
