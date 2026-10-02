import { describe, expect, it } from "vitest";
import { MatchingEngine, type OrderInput, type SubmitResult } from "./matchingEngine";
import {
  bookSnapshot,
  rng,
  sameFast,
  SHADOW_MAX_ORDER_QTY as MAX_ORDER_QTY,
  ShadowEngine,
  shadowSnapshot,
  type ShadowSubmit,
} from "./testing/shadow";
import type { AgentType, Side } from "./types";

const MID = 10_000;
const TICK = 5;
// Few owners, so agents often meet their own resting orders and self-trade prevention is exercised.
const OWNERS = ["mm1", "mm2", "noise", "whale"] as const;
const TYPES: readonly AgentType[] = ["noise", "marketMaker", "momentum", "panic", "whale"];

const toEqual = (a: unknown, e: unknown) => expect(a).toEqual(e);

/** Properties every accepted submit must satisfy, whatever the shadow says. */
function expectSubmitInvariants(order: OrderInput, r: Extract<SubmitResult, { ok: true }>, e: MatchingEngine) {
  const filled = r.fills.reduce((s, f) => s + f.qty, 0);
  // Every share is accounted for: filled + resting + cancelled = ordered.
  expect(filled + (r.resting?.qty ?? 0) + r.cancelledQty).toBe(order.qty);
  if (order.type === "market") expect(r.resting).toBeNull();
  else expect(r.cancelledQty).toBe(0);
  for (let i = 0; i < r.fills.length; i++) {
    const f = r.fills[i];
    expect(f.qty).toBeGreaterThan(0);
    expect(f.aggressor).toBe(order.side);
    expect(f.buy.ownerId).not.toBe(f.sell.ownerId); // no self-trades, ever
    if (order.type === "limit") expect(order.side === "buy" ? f.price <= order.price : f.price >= order.price).toBe(true);
    // Sweeping only ever moves to worse prices for the aggressor.
    if (i > 0) expect(order.side === "buy" ? f.price >= r.fills[i - 1].price : f.price <= r.fills[i - 1].price).toBe(true);
  }
  const bid = e.book.bestBid();
  const ask = e.book.bestAsk();
  if (bid !== null && ask !== null) expect(bid).toBeLessThan(ask); // never crossed
  expect(e.trackedArrivals).toBe(e.book.size); // no leaked or missing arrival quotes
}

describe("MatchingEngine vs ShadowEngine (randomized, compared after every step)", () => {
  it.each([1, 2, 3, 42, 2008])("matches the shadow for 3,000 random operations (seed %i)", (seed) => {
    const { next: rand, int, pick } = rng(seed);
    const engine = new MatchingEngine("SPY", TICK);
    const shadow = new ShadowEngine("SPY", TICK);
    const allIds: string[] = [];
    const seen = new Map<string, number>();
    const count = (outcome: string) => seen.set(outcome, (seen.get(outcome) ?? 0) + 1);
    let peak = 0;
    let time = 0;

    const base = () => ({ ownerId: pick(OWNERS), agentType: pick(TYPES), side: (rand() < 0.5 ? "buy" : "sell") as Side });
    const priceAt = (side: Side, ticksAway: number) => (side === "buy" ? MID - TICK * ticksAway : MID + TICK * ticksAway);
    const passive = (): OrderInput => {
      const b = base();
      return { ...b, type: "limit", price: priceAt(b.side, int(1, 40)), qty: int(1, 60) };
    };
    const aggressive = (): OrderInput => {
      const b = base();
      return { ...b, type: "limit", price: priceAt(b.side, -int(0, 15)), qty: int(1, 150) };
    };
    const market = (): OrderInput => ({ ...base(), type: "market", qty: rand() < 0.1 ? int(200, 2_000) : int(1, 80) });

    const CORRUPTIONS: ReadonlyArray<(o: OrderInput) => OrderInput> = [
      (o) => ({ ...o, type: "stop" }) as unknown as OrderInput,
      (o) => ({ ...o, ownerId: "" }),
      (o) => ({ ...o, agentType: "fund" as AgentType }),
      (o) => ({ ...o, side: "hold" as Side }),
      (o) => ({ ...o, qty: 0 }),
      (o) => ({ ...o, qty: 2.5 }),
      (o) => ({ ...o, qty: MAX_ORDER_QTY + 1 }),
      (o) => (o.type === "limit" ? { ...o, price: o.price + 1 } : o), // OFF_TICK
      (o) => (o.type === "limit" ? { ...o, price: 0 } : o), // INVALID_PRICE
    ];

    const submit = (order: OrderInput, label: string) => {
      const expected: ShadowSubmit = shadow.submit(order, time);
      const actual = engine.submit(order, time);
      if (expected.ok) {
        allIds.push(expected.orderId);
        sameFast(actual, expected, toEqual);
        if (actual.ok) expectSubmitInvariants(order, actual, engine);
        const f = expected.fills.length;
        count(`${label}:${f === 0 ? "nofill" : "fill"}${expected.resting ? "+rest" : ""}${expected.cancelledQty ? "+cancel" : ""}`);
        if (expected.selfTradeCancelled.length) count("selfTrade");
        if (f > 1 && new Set(expected.fills.map((x) => x.price)).size > 1) count("sweep");
      } else {
        expect(actual).toMatchObject({ ok: false, reason: expected.reason });
        count(`${label}:${expected.reason}`);
        count(`reason:${expected.reason}`);
      }
    };

    for (let step = 0; step < 3_000; step++) {
      time += int(0, 250);
      const live = shadow.book.orders;
      const op = rand();
      if (op < 0.55 || live.length < 5) submit(passive(), "passive");
      else if (op < 0.65) submit(aggressive(), "aggressive");
      else if (op < 0.74) submit(market(), "market");
      else if (op < 0.745) {
        // Drain one side completely, so the next market orders can meet an empty book.
        submit({ ...base(), type: "market", qty: MAX_ORDER_QTY }, "drain");
        submit(market(), "afterDrain");
      } else if (op < 0.84) submit(pick(CORRUPTIONS)(rand() < 0.7 ? passive() : market()), "invalid");
      else if (op < 0.99) {
        // Live orders, orders that already filled or were cancelled, and ids never issued.
        const r = rand();
        const id = r < 0.5 ? pick(live).id : r < 0.8 && allIds.length ? pick(allIds) : `SPY-${10_000_000 + step}`;
        const expected = shadow.cancel(id);
        sameFast(engine.cancel(id), expected, toEqual);
        count(expected.ok ? "cancel:live" : "cancel:missing");
      } else {
        const owner = pick(OWNERS);
        sameFast(engine.cancelAll(owner), shadow.cancelAll(owner), toEqual);
        count("cancelAll");
      }

      const liveIds = shadow.book.orders.map((r) => r.id);
      sameFast(
        { book: bookSnapshot(engine.book, allIds, OWNERS), arrivals: liveIds.map((id) => engine.arrivalOf(id)), fillCount: engine.fills.length },
        { book: shadowSnapshot(shadow.book, allIds, OWNERS), arrivals: liveIds.map((id) => shadow.arrivals.get(id)), fillCount: shadow.fills.length },
        toEqual,
      );
      if (step % 250 === 0) sameFast(engine.fills, shadow.fills, toEqual);
      peak = Math.max(peak, engine.book.size);
    }
    sameFast(engine.fills, shadow.fills, toEqual);

    // Guard against a vacuous test: every interesting path must actually have happened.
    for (const outcome of [
      "passive:nofill+rest", "aggressive:fill", "aggressive:fill+rest", "market:fill", "drain:fill+cancel",
      "reason:NO_LIQUIDITY", "selfTrade", "sweep",
      "invalid:INVALID_ORDER_TYPE", "invalid:INVALID_OWNER", "invalid:INVALID_AGENT_TYPE",
      "invalid:INVALID_SIDE", "invalid:INVALID_QTY", "invalid:OFF_TICK", "invalid:INVALID_PRICE",
      "cancel:live", "cancel:missing", "cancelAll",
    ]) {
      expect(seen.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(5);
    }
    expect(peak, "peak resting orders").toBeGreaterThanOrEqual(60);
    expect(engine.fills.length, "fills").toBeGreaterThanOrEqual(1_000);
  });
});
