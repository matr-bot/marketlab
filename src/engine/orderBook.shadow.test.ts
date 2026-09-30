import { describe, expect, it } from "vitest";
import { MAX_ORDER_QTY, MAX_PRICE_CENTS, OrderBook, type NewLimitOrder } from "./orderBook";
import type { AddResult, CancelResult, DepthLevel, RejectReason, RestingOrder, Side } from "./types";

/**
 * Deliberately naive reference order book: one flat array in arrival order, and every
 * query answered by filtering and sorting from scratch. It shares no code with OrderBook,
 * so the two can only agree if both are right.
 */
class ShadowBook {
  orders: RestingOrder[] = [];
  private seq = 0;

  constructor(private readonly tick: number) {}

  add(o: NewLimitOrder): { ok: true; order: RestingOrder } | { ok: false; reason: RejectReason } {
    // Rejection precedence is part of the OrderBook contract; checked in the same order.
    const fail = (reason: RejectReason) => ({ ok: false as const, reason });
    if (typeof o.id !== "string" || o.id.length === 0) return fail("INVALID_ID");
    if (typeof o.ownerId !== "string" || o.ownerId.length === 0) return fail("INVALID_OWNER");
    if (this.orders.some((r) => r.id === o.id)) return fail("DUPLICATE_ID");
    if (o.side !== "buy" && o.side !== "sell") return fail("INVALID_SIDE");
    if (!Number.isInteger(o.price) || o.price < 1 || o.price > MAX_PRICE_CENTS) return fail("INVALID_PRICE");
    if (o.price % this.tick !== 0) return fail("OFF_TICK");
    if (!Number.isInteger(o.qty) || o.qty < 1 || o.qty > MAX_ORDER_QTY) return fail("INVALID_QTY");
    const crosses = this.orders.some((r) =>
      o.side === "buy" ? r.side === "sell" && r.price <= o.price : r.side === "buy" && r.price >= o.price,
    );
    if (crosses) return fail("WOULD_CROSS");
    const order = { id: o.id, ownerId: o.ownerId, side: o.side, price: o.price, qty: o.qty, seq: this.seq++ };
    this.orders.push(order);
    return { ok: true, order };
  }

  cancel(id: string): RestingOrder | undefined {
    const found = this.orders.find((r) => r.id === id);
    this.orders = this.orders.filter((r) => r.id !== id);
    return found;
  }

  reduce(id: string, qty: number): number {
    const found = this.orders.find((r) => r.id === id)!;
    const left = found.qty - qty;
    this.orders = this.orders
      .map((r) => (r.id === id ? { ...r, qty: left } : r))
      .filter((r) => r.qty > 0);
    return left;
  }

  cancelAll(ownerId: string): RestingOrder[] {
    const mine = this.orders.filter((r) => r.ownerId === ownerId);
    this.orders = this.orders.filter((r) => r.ownerId !== ownerId);
    return mine;
  }

  /** Orders on one side in full priority order: better price first, then earlier seq. */
  queue(side: Side): RestingOrder[] {
    return this.orders
      .filter((r) => r.side === side)
      .sort((a, b) => (a.price !== b.price ? (side === "buy" ? b.price - a.price : a.price - b.price) : a.seq - b.seq));
  }

  depth(side: Side): DepthLevel[] {
    const levels: DepthLevel[] = [];
    for (const r of this.queue(side)) {
      const last = levels[levels.length - 1];
      if (last && last.price === r.price) levels[levels.length - 1] = { price: r.price, qty: last.qty + r.qty, orderCount: last.orderCount + 1 };
      else levels.push({ price: r.price, qty: r.qty, orderCount: 1 });
    }
    return levels;
  }
}

/** Everything observable about a book, gathered into one structure for a single comparison. */
function snapshot(
  book: Pick<OrderBook, "size" | "depth" | "levelCount" | "bestOrder" | "ordersAt" | "bestBid" | "bestAsk" | "spread" | "get" | "ordersOf" | "ownerCount">,
  ids: readonly string[],
  owners: readonly string[],
) {
  const sides = (["buy", "sell"] as const).map((side) => {
    const depth = book.depth(side);
    return {
      depth,
      levelCount: book.levelCount(side),
      bestOrder: book.bestOrder(side),
      queues: depth.map((l) => book.ordersAt(side, l.price)),
    };
  });
  return {
    size: book.size,
    bestBid: book.bestBid(),
    bestAsk: book.bestAsk(),
    spread: book.spread(),
    sides,
    byId: ids.map((id) => book.get(id)),
    byOwner: owners.map((o) => book.ordersOf(o)),
    ownerCount: book.ownerCount,
  };
}

/** The same structure computed independently from the shadow's flat array. */
function expectedSnapshot(shadow: ShadowBook, ids: readonly string[], owners: readonly string[]) {
  const bid = shadow.depth("buy")[0]?.price ?? null;
  const ask = shadow.depth("sell")[0]?.price ?? null;
  return {
    size: shadow.orders.length,
    bestBid: bid,
    bestAsk: ask,
    spread: bid === null || ask === null ? null : ask - bid,
    sides: (["buy", "sell"] as const).map((side) => {
      const queue = shadow.queue(side);
      const depth = shadow.depth(side);
      return {
        depth,
        levelCount: depth.length,
        bestOrder: queue[0],
        queues: depth.map((l) => queue.filter((r) => r.price === l.price)),
      };
    }),
    byId: ((live) => ids.map((id) => live.get(id)))(new Map(shadow.orders.map((r) => [r.id, r]))),
    byOwner: owners.map((o) => shadow.orders.filter((r) => r.ownerId === o)),
    ownerCount: new Set(shadow.orders.map((r) => r.ownerId)).size,
  };
}

/**
 * Compare every observable piece of OrderBook state against the shadow: levels, queues in
 * priority order, every id ever used (live ones match exactly, gone ones are undefined),
 * and every owner's orders.
 */
function expectSameState(book: OrderBook, shadow: ShadowBook, allIds: readonly string[], owners: readonly string[]) {
  const actual = snapshot(book, allIds, owners);
  const expected = expectedSnapshot(shadow, allIds, owners);
  // Fast path: identical JSON means identical state. Otherwise toEqual is the judge and
  // prints a readable diff (a key-order-only JSON difference would still pass there).
  if (JSON.stringify(actual) !== JSON.stringify(expected)) expect(actual).toEqual(expected);
}

function expectSameAdd(actual: AddResult, expected: ReturnType<ShadowBook["add"]>) {
  if (expected.ok) expect(actual).toEqual(expected);
  else expect(actual).toMatchObject({ ok: false, reason: expected.reason });
}

function expectSameCancel(actual: CancelResult, expected: RestingOrder | undefined) {
  expect(actual).toEqual(expected ? { ok: true, order: expected } : expect.objectContaining({ ok: false, reason: "UNKNOWN_ORDER" }));
}

/** Test-local deterministic generator (mulberry32) so failures are reproducible by seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("ShadowBook (the reference itself)", () => {
  it("agrees with a hand-worked example", () => {
    const shadow = new ShadowBook(1);
    shadow.add({ id: "a", ownerId: "x", side: "buy", price: 100, qty: 5 });
    shadow.add({ id: "b", ownerId: "y", side: "buy", price: 100, qty: 7 });
    shadow.add({ id: "c", ownerId: "x", side: "buy", price: 101, qty: 1 });
    expect(shadow.queue("buy").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(shadow.depth("buy")).toEqual([
      { price: 101, qty: 1, orderCount: 1 },
      { price: 100, qty: 12, orderCount: 2 },
    ]);
    expect(shadow.add({ id: "d", ownerId: "z", side: "sell", price: 101, qty: 1 })).toEqual({ ok: false, reason: "WOULD_CROSS" });
    expect(shadow.reduce("a", 5)).toBe(0);
    expect(shadow.orders.map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("OrderBook vs ShadowBook (randomized, compared after every step)", () => {
  const MID = 10_000;
  const TICK = 5;
  const OWNERS = ["mm1", "mm2", "noise", "whale", "user"] as const;

  /** Ways to make an otherwise valid order invalid, each with the reason it must produce. */
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
  ];

  it.each([1, 2, 3, 42, 2008])("matches the shadow for 3,000 random operations (seed %i)", (seed) => {
    const rand = rng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const book = new OrderBook("SPY", TICK);
    const shadow = new ShadowBook(TICK);
    const allIds: string[] = [];
    const seen = new Map<string, number>();
    const count = (outcome: string) => seen.set(outcome, (seen.get(outcome) ?? 0) + 1);
    let n = 0;
    let peak = 0;

    const freshOrder = (): NewLimitOrder => {
      // Mostly passive prices so the book builds depth; 15% aggressive enough to cross.
      const side: Side = rand() < 0.5 ? "buy" : "sell";
      const ticks = rand() < 0.15 ? int(-20, 0) : int(1, 60);
      const price = side === "buy" ? MID - TICK * ticks : MID + TICK * ticks;
      const qty = rand() < 0.05 ? int(1, MAX_ORDER_QTY) : int(1, 50);
      return { id: `r${n++}`, ownerId: pick(OWNERS), side, price, qty };
    };
    const add = (input: NewLimitOrder, label: string) => {
      if (typeof input.id === "string" && input.id !== "" && !allIds.includes(input.id)) allIds.push(input.id);
      const expected = shadow.add(input);
      expectSameAdd(book.add(input), expected);
      count(`${label}:${expected.ok ? "ACCEPTED" : expected.reason}`);
    };

    for (let step = 0; step < 3_000; step++) {
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
      expectSameState(book, shadow, allIds, OWNERS);
      peak = Math.max(peak, book.size);
    }

    // Guard against a vacuous test: every interesting path must actually have happened.
    for (const outcome of [
      "add:ACCEPTED", "add:WOULD_CROSS", "reuse:DUPLICATE_ID", "reuse:ACCEPTED",
      "invalid:OFF_TICK", "invalid:INVALID_PRICE", "invalid:INVALID_QTY", "invalid:INVALID_ID",
      "invalid:INVALID_OWNER", "invalid:INVALID_SIDE", "cancel:live", "cancel:missing",
      "fill:full", "fill:partial", "cancelAll",
    ]) {
      expect(seen.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(5);
    }
    expect(peak, "peak resting orders").toBeGreaterThanOrEqual(100);
  });
});
