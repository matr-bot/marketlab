// Seeded random workloads shared by the shadow tests and the determinism backstop (test-only).
// Each one drives real engine code and checks it against the naive shadow models after every
// step (D-004), then returns what it saw plus a fingerprint of the final state, so the same
// workload can be rerun with the inexact Math functions stubbed out (determinism.test.ts).
import { expect } from "vitest";
import { ArrivalScheduler } from "../arrivals";
import { exp, ln, pow } from "../detMath";
import { MarketRegistry } from "../marketRegistry";
import { type MatchingEngine, type OrderInput, type SubmitResult } from "../matchingEngine";
import { OrderBook, type NewLimitOrder } from "../orderBook";
import { Rng } from "../rng";
import { SimClock } from "../simClock";
import type { AddResult, AgentType, CancelResult, RejectReason, RestingOrder, Side } from "../types";
import { fingerprint } from "./fingerprint";
import {
  bookSnapshot,
  rng,
  sameFast,
  SHADOW_MAX_ORDER_QTY as MAX_ORDER_QTY,
  SHADOW_MAX_PRICE_CENTS as MAX_PRICE_CENTS,
  ShadowBook,
  ShadowEngine,
  shadowSnapshot,
  type ShadowSubmit,
} from "./shadow";

export interface WorkloadResult {
  /** How many times each outcome happened (for the coverage guards). */
  seen: Map<string, number>;
  /** Most resting orders at any point. */
  peak: number;
  /** Fills produced (0 for the book-only workload). */
  fills: number;
  /** Fingerprint of everything observable at the end. */
  fingerprint: string;
}

const toEqual = (a: unknown, e: unknown) => expect(a).toEqual(e);

// ---------------------------------------------------------------------------------------------
// Order book vs ShadowBook
// ---------------------------------------------------------------------------------------------

export function runBookWorkload(seed: number, steps = 3_000): WorkloadResult {
  const MID = 10_000;
  const TICK = 5;
  const OWNERS = ["mm1", "mm2", "noise", "whale", "user"] as const;
  /** Ways to make an otherwise valid order invalid. */
  const CORRUPTIONS: ReadonlyArray<(o: NewLimitOrder, int: (lo: number, hi: number) => number) => NewLimitOrder> = [
    (o, int) => ({ ...o, price: o.price + int(1, TICK - 1) }), // OFF_TICK
    (o) => ({ ...o, price: MAX_PRICE_CENTS + TICK }), // INVALID_PRICE (over the cap)
    (o) => ({ ...o, price: 0 }),
    (o) => ({ ...o, price: -TICK }),
    (o) => ({ ...o, price: o.price + 0.5 }),
    (o) => ({ ...o, qty: 0 }), // INVALID_QTY
    (o) => ({ ...o, qty: -3 }),
    (o) => ({ ...o, qty: 2.5 }),
    (o) => ({ ...o, qty: NaN }),
    (o) => ({ ...o, qty: MAX_ORDER_QTY + 1 }),
    (o) => ({ ...o, id: "" }), // INVALID_ID
    (o) => ({ ...o, ownerId: "" }), // INVALID_OWNER
    (o) => ({ ...o, side: "hold" as Side }), // INVALID_SIDE
    (o) => ({ ...o, agentType: "trader" as AgentType }), // INVALID_AGENT_TYPE
  ];

  const { next: rand, int, pick } = rng(seed);
  const book = new OrderBook("SPY", TICK);
  const shadow = new ShadowBook(TICK);
  const allIds: string[] = [];
  const seen = new Map<string, number>();
  const count = (outcome: string) => seen.set(outcome, (seen.get(outcome) ?? 0) + 1);
  let n = 0;
  let peak = 0;

  const expectSameAdd = (actual: AddResult, expected: { ok: true; order: RestingOrder } | { ok: false; reason: RejectReason }) => {
    if (expected.ok) expect(actual).toEqual(expected);
    else expect(actual).toMatchObject({ ok: false, reason: expected.reason });
  };
  const expectSameCancel = (actual: CancelResult, expected: CancelResult) => expect(actual).toEqual(expected);
  const freshOrder = (): NewLimitOrder => {
    // Mostly passive prices so the book builds depth; 15% aggressive enough to cross.
    const side: Side = rand() < 0.5 ? "buy" : "sell";
    const ticks = rand() < 0.15 ? int(-20, 0) : int(1, 60);
    const price = side === "buy" ? MID - TICK * ticks : MID + TICK * ticks;
    const qty = rand() < 0.05 ? int(1, MAX_ORDER_QTY) : int(1, 50);
    const agentType: AgentType = pick(["noise", "marketMaker", "momentum", "whale", "user"]);
    return { id: `r${n++}`, ownerId: pick(OWNERS), agentType, side, price, qty };
  };
  const add = (input: NewLimitOrder, label: string) => {
    if (typeof input.id === "string" && input.id !== "" && !allIds.includes(input.id)) allIds.push(input.id);
    const expected = shadow.add(input);
    expectSameAdd(book.add(input), expected);
    count(`${label}:${expected.ok ? "ACCEPTED" : expected.reason}`);
  };

  for (let step = 0; step < steps; step++) {
    const live = shadow.orders;
    const op = rand();
    if (op < 0.45 || live.length === 0) {
      add(freshOrder(), "add");
    } else if (op < 0.53) {
      // Reuse an id: live ids must be DUPLICATE_ID, ids of gone orders are free again.
      const id = rand() < 0.5 ? pick(live).id : pick(allIds);
      add({ ...freshOrder(), id }, "reuse");
    } else if (op < 0.6) {
      add(pick(CORRUPTIONS)(freshOrder(), int), "invalid");
    } else if (op < 0.71) {
      const target = pick(live);
      expectSameCancel(book.cancel(target.id), shadow.cancel(target.id));
      count("cancel:live");
    } else if (op < 0.75) {
      const liveIds = new Set(live.map((r) => r.id));
      const goneIds = allIds.filter((id) => !liveIds.has(id));
      const id = goneIds.length > 0 && rand() < 0.7 ? pick(goneIds) : `never-${step}`;
      expectSameCancel(book.cancel(id), shadow.cancel(id));
      count("cancel:missing");
    } else if (op < 0.99) {
      const target = pick(live);
      const qty = rand() < 0.3 ? target.qty : int(1, target.qty);
      expect(book.reduce(target.id, qty)).toBe(shadow.reduce(target.id, qty));
      count(qty === target.qty ? "fill:full" : "fill:partial");
    } else {
      const owner = pick(OWNERS);
      expect(book.cancelAll(owner)).toEqual(shadow.cancelAll(owner));
      count("cancelAll");
    }
    sameFast(bookSnapshot(book, allIds, OWNERS), shadowSnapshot(shadow, allIds, OWNERS), toEqual);
    peak = Math.max(peak, book.size);
  }
  return { seen, peak, fills: 0, fingerprint: fingerprint(bookSnapshot(book, allIds, OWNERS)) };
}

// ---------------------------------------------------------------------------------------------
// Matching engine vs ShadowEngine
// ---------------------------------------------------------------------------------------------

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
    // Integer money (D-001, D-019): price, size and notional are exact integers.
    expect(Number.isSafeInteger(f.price) && Number.isSafeInteger(f.qty) && Number.isSafeInteger(f.price * f.qty)).toBe(true);
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

export function runEngineWorkload(seed: number, steps = 3_000): WorkloadResult {
  const MID = 10_000;
  const TICK = 5;
  // Few owners, so agents often meet their own resting orders and self-trade prevention is exercised.
  const OWNERS = ["mm1", "mm2", "noise", "whale"] as const;
  const TYPES: readonly AgentType[] = ["noise", "marketMaker", "momentum", "panic", "whale"];

  const { next: rand, int, pick } = rng(seed);
  const engine = new MarketRegistry().create("SPY", TICK);
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

  for (let step = 0; step < steps; step++) {
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
      { book: bookSnapshot(engine.book, allIds, OWNERS), arrivals: liveIds.map((id) => engine.arrivalOf(id)), fillCount: engine.fillCount },
      { book: shadowSnapshot(shadow.book, allIds, OWNERS), arrivals: liveIds.map((id) => shadow.arrivals.get(id)), fillCount: shadow.fills.length },
      toEqual,
    );
    if (step % 250 === 0) sameFast(engine.fills, shadow.fills, toEqual);
    peak = Math.max(peak, engine.book.size);
  }
  sameFast(engine.fills, shadow.fills, toEqual);
  return { seen, peak, fills: engine.fillCount, fingerprint: fingerprint({ fills: engine.fills, book: bookSnapshot(engine.book, allIds, OWNERS) }) };
}

// ---------------------------------------------------------------------------------------------
// Randomness, deterministic math, clock and arrivals
// ---------------------------------------------------------------------------------------------

/** Exercises every Rng distribution, named streams, detMath and the arrival scheduler. */
export function runRandomnessWorkload(seed: number): WorkloadResult {
  const root = Rng.fromSeed(seed);
  const draws: number[] = [];
  for (const label of ["noise-1", "mm-1", "whale-1"]) {
    const s = root.stream("agents").stream(label);
    for (let i = 0; i < 2_000; i++) {
      draws.push(s.uniform(), s.uniformOpen(), s.int(-50, 50), s.normal(), s.exponential(3));
      const x = s.uniformOpen() * 100;
      draws.push(ln(x), exp(x / 20), pow(x, -1 / 1.5));
    }
  }
  const scheduler = new ArrivalScheduler(root);
  for (let i = 0; i < 20; i++) scheduler.addSource(`src-${i}`, 0.5 + i);
  const clock = new SimClock();
  const arrivals: number[] = [];
  for (let t = 0; t < 3_000; t++) {
    const w = clock.advance();
    if (t === 1_500) scheduler.setRate("src-3", 40, w.start);
    for (const a of scheduler.drain(w.end)) arrivals.push(a.exactMs);
  }
  return { seen: new Map([["arrivals", arrivals.length]]), peak: 0, fills: 0, fingerprint: fingerprint({ draws, arrivals }) };
}
