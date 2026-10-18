import { toTick } from "../price";
import type { Rng } from "../rng";
import type { Cents, Side } from "../types";
import type { Agent, AgentContext, AgentSpec } from "./agent";
import { referencePrice } from "./noiseTrader";

// Value trader: a fundamentalist (D-044). It believes the stock is worth roughly fair value V, with
// its own small, persistent offset plus a little fresh noise each time it looks. When the market is
// far enough from its belief (beyond its own threshold), it trades toward the belief with a
// marketable limit order that stops at belief ∓ threshold, so it never chases past its own view.
// Sources: Chiarella & Iori (2002), "A simulation analysis of the microstructure of double auction
// markets", Quantitative Finance 2(5) (fundamentalist component); Farmer & Joshi (2002), "The price
// dynamics of common trading strategies", JEBO 49 (value investors with entry thresholds and
// heterogeneous perceived values).

export interface ValueTraderParams {
  /** Persistent belief offset: εᵢ ~ N(0, offsetSd), clipped to ±offsetClip (fractions of V). */
  readonly offsetSd: number;
  readonly offsetClip: number;
  /** Fresh belief noise at each arrival: ηₜ ~ N(0, noiseSd). */
  readonly noiseSd: number;
  /** Each trader's threshold θᵢ ~ U(thetaMin, thetaMax), as a fraction of the mid. */
  readonly thetaMin: number;
  readonly thetaMax: number;
  /** Size q = lots(q0 · (|gap| − θ) / θ), between one lot and maxOrder shares. */
  readonly q0: number;
  readonly maxOrder: number;
  /** Position limit in shares, long or short. */
  readonly maxInventory: number;
  readonly lotSize: number;
}

export const DEFAULT_VALUE_PARAMS: ValueTraderParams = {
  offsetSd: 0.0003,
  offsetClip: 0.0008,
  noiseSd: 0.0003,
  thetaMin: 0.001,
  thetaMax: 0.003,
  q0: 200,
  maxOrder: 1_000,
  // 4,000 in the plan. A second FED 10 minutes after the first did not move seed 2's price: value
  // traders, still net short from the first headline, ran out of room to sell, and noise bids
  // absorbed the rest (D-044). 6,000 restores the cascade; 8,000 changed nothing further.
  maxInventory: 6_000,
  lotSize: 100,
};

/** What a value trader wants right now, or null for "nothing". Pure: same inputs → same order. */
export function valueOrder(
  p: ValueTraderParams,
  i: { belief: number; mid: number; theta: number; position: number; tick: Cents },
): { side: Side; price: Cents; qty: number } | null {
  const gap = (i.belief - i.mid) / i.mid;
  if (Math.abs(gap) <= i.theta) return null;
  const side: Side = gap > 0 ? "buy" : "sell";
  const lots = (shares: number) => Math.floor(shares / p.lotSize) * p.lotSize;
  const wanted = Math.min(p.maxOrder, Math.max(p.lotSize, lots((p.q0 * (Math.abs(gap) - i.theta)) / i.theta)));
  const room = side === "buy" ? p.maxInventory - i.position : p.maxInventory + i.position;
  const qty = Math.min(wanted, lots(room));
  if (qty <= 0) return null;
  const price = side === "buy" ? toTick(i.belief * (1 - i.theta), i.tick, "down") : toTick(i.belief * (1 + i.theta), i.tick, "up");
  return { side, price, qty };
}

export class ValueTrader implements Agent {
  /** Persistent belief offset εᵢ and threshold θᵢ, drawn once. */
  readonly offset: number;
  readonly theta: number;

  constructor(
    private readonly rng: Rng,
    private readonly params: ValueTraderParams = DEFAULT_VALUE_PARAMS,
  ) {
    const p = params;
    this.offset = Math.max(-p.offsetClip, Math.min(p.offsetClip, p.offsetSd * rng.normal()));
    this.theta = p.thetaMin + (p.thetaMax - p.thetaMin) * rng.uniform();
  }

  act(ctx: AgentContext): void {
    const belief = ctx.fairValue * (1 + this.offset + this.params.noiseSd * this.rng.normal());
    const want = valueOrder(this.params, { belief, mid: referencePrice(ctx), theta: this.theta, position: ctx.position, tick: ctx.book.tickSize });
    // One resting order at most; an unchanged one keeps its time priority.
    const mine = ctx.myOrders();
    if (want !== null && mine.length === 1 && mine[0].side === want.side && mine[0].price === want.price && mine[0].qty === want.qty) return;
    for (const o of mine) ctx.cancel(o.id);
    if (want !== null) ctx.submit({ type: "limit", ...want });
  }
}

/** `count` value traders with ids value-1 … value-N. */
export function valueTraders(count: number, ratePerSec: number, params: ValueTraderParams = DEFAULT_VALUE_PARAMS): AgentSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `value-${i + 1}`,
    agentType: "value" as const,
    ratePerSec,
    create: (decisions: Rng) => new ValueTrader(decisions, params),
  }));
}
