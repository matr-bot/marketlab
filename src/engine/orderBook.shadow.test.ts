import { describe, expect, it } from "vitest";
import { OrderBook, type NewLimitOrder } from "./orderBook";
import {
  bookSnapshot,
  rng,
  sameFast,
  SHADOW_MAX_ORDER_QTY as MAX_ORDER_QTY,
  SHADOW_MAX_PRICE_CENTS as MAX_PRICE_CENTS,
  ShadowBook,
  shadowSnapshot,
} from "./testing/shadow";
import type { AddResult, AgentType, CancelResult, RejectReason, RestingOrder, Side } from "./types";

/**
 * Compare every observable piece of OrderBook state against the shadow: levels, queues in
 * priority order, every id ever used (live ones match exactly, gone ones are undefined),
 * and every owner's orders.
 */
function expectSameState(book: OrderBook, shadow: ShadowBook, allIds: readonly string[], owners: readonly string[]) {
  sameFast(bookSnapshot(book, allIds, owners), shadowSnapshot(shadow, allIds, owners), (a, e) => expect(a).toEqual(e));
}

function expectSameAdd(actual: AddResult, expected: { ok: true; order: RestingOrder } | { ok: false; reason: RejectReason }) {
  if (expected.ok) expect(actual).toEqual(expected);
  else expect(actual).toMatchObject({ ok: false, reason: expected.reason });
}

function expectSameCancel(actual: CancelResult, expected: CancelResult) {
  expect(actual).toEqual(expected);
}

describe("ShadowBook (the reference itself)", () => {
  it("agrees with a hand-worked example", () => {
    const shadow = new ShadowBook(1);
    shadow.add({ id: "a", ownerId: "x", agentType: "noise", side: "buy", price: 100, qty: 5 });
    shadow.add({ id: "b", ownerId: "y", agentType: "noise", side: "buy", price: 100, qty: 7 });
    shadow.add({ id: "c", ownerId: "x", agentType: "noise", side: "buy", price: 101, qty: 1 });
    expect(shadow.queue("buy").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(shadow.depth("buy")).toEqual([
      { price: 101, qty: 1, orderCount: 1 },
      { price: 100, qty: 12, orderCount: 2 },
    ]);
    expect(shadow.add({ id: "d", ownerId: "z", agentType: "noise", side: "sell", price: 101, qty: 1 })).toEqual({ ok: false, reason: "WOULD_CROSS" });
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
    (o) => ({ ...o, agentType: "trader" as AgentType }), // INVALID_AGENT_TYPE
  ];

  it.each([1, 2, 3, 42, 2008])("matches the shadow for 3,000 random operations (seed %i)", (seed) => {
    const { next: rand, int, pick } = rng(seed);
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
      const agentType: AgentType = pick(["noise", "marketMaker", "momentum", "whale", "user"]);
      return { id: `r${n++}`, ownerId: pick(OWNERS), agentType, side, price, qty };
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
      "invalid:INVALID_OWNER", "invalid:INVALID_SIDE", "invalid:INVALID_AGENT_TYPE", "cancel:live", "cancel:missing",
      "fill:full", "fill:partial", "cancelAll",
    ]) {
      expect(seen.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(5);
    }
    expect(peak, "peak resting orders").toBeGreaterThanOrEqual(100);
  });
});
