import { describe, expect, it } from "vitest";
import { MAX_ORDER_QTY, MAX_PRICE_CENTS, OrderBook, type NewLimitOrder } from "./orderBook";
import type { AddResult, RestingOrder, Side } from "./types";

let counter = 0;
const order = (side: Side, price: number, qty = 10, overrides: Partial<NewLimitOrder> = {}) => ({
  id: `o${++counter}`,
  ownerId: "t1",
  side,
  price,
  qty,
  ...overrides,
});

/** Add an order that the test expects to be accepted; fails loudly if it is rejected. */
function place(book: OrderBook, input: NewLimitOrder): RestingOrder {
  const result = book.add(input);
  if (!result.ok) throw new Error(`setup order rejected: ${result.reason} (${result.message})`);
  return result.order;
}

function reasonOf(result: AddResult) {
  return result.ok ? "ACCEPTED" : result.reason;
}

/** Checks every structural invariant of the book against a brute-force recount. */
function expectInvariants(book: OrderBook) {
  let total = 0;
  for (const side of ["buy", "sell"] as const) {
    const levels = book.depth(side);
    const prices = levels.map((l) => l.price);
    const sorted = [...prices].sort((a, b) => (side === "buy" ? b - a : a - b));
    expect(prices).toEqual(sorted);
    expect(new Set(prices).size).toBe(prices.length);

    for (const level of levels) {
      const orders = book.ordersAt(side, level.price);
      expect(orders.length).toBe(level.orderCount);
      expect(orders.reduce((s, o) => s + o.qty, 0)).toBe(level.qty);
      expect(orders.every((o) => o.qty > 0 && o.side === side && o.price === level.price)).toBe(true);
      const seqs = orders.map((o) => o.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      total += orders.length;
    }
  }
  expect(total).toBe(book.size);
  const bid = book.bestBid();
  const ask = book.bestAsk();
  if (bid !== null && ask !== null) expect(bid).toBeLessThan(ask);
}

describe("OrderBook", () => {
  describe("empty book", () => {
    it("has no prices, spread, or orders", () => {
      const book = new OrderBook("SPY");
      expect(book.bestBid()).toBeNull();
      expect(book.bestAsk()).toBeNull();
      expect(book.spread()).toBeNull();
      expect(book.bestOrder("buy")).toBeUndefined();
      expect(book.depth("sell")).toEqual([]);
      expect(book.size).toBe(0);
    });
  });

  describe("adding orders", () => {
    it("tracks best bid, best ask and spread in cents", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 10_000));
      place(book, order("buy", 10_005));
      place(book, order("sell", 10_020));
      place(book, order("sell", 10_010));
      expect(book.bestBid()).toBe(10_005);
      expect(book.bestAsk()).toBe(10_010);
      expect(book.spread()).toBe(5);
      expectInvariants(book);
    });

    it("sorts bids high-to-low and asks low-to-high regardless of arrival order", () => {
      const book = new OrderBook("SPY");
      for (const p of [99, 97, 100, 98]) place(book, order("buy", p));
      for (const p of [103, 101, 104, 102]) place(book, order("sell", p));
      expect(book.depth("buy").map((l) => l.price)).toEqual([100, 99, 98, 97]);
      expect(book.depth("sell").map((l) => l.price)).toEqual([101, 102, 103, 104]);
    });

    it("aggregates quantity and order count per level", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 5));
      place(book, order("buy", 100, 7));
      place(book, order("buy", 99, 3));
      expect(book.depth("buy")).toEqual([
        { price: 100, qty: 12, orderCount: 2 },
        { price: 99, qty: 3, orderCount: 1 },
      ]);
    });

    it("limits depth to the requested number of levels", () => {
      const book = new OrderBook("SPY");
      for (const p of [101, 102, 103]) place(book, order("sell", p));
      expect(book.depth("sell", 2).map((l) => l.price)).toEqual([101, 102]);
    });

    it("returns every level for depth(Infinity) and none for depth(0)", () => {
      const book = new OrderBook("SPY");
      for (const p of [101, 102, 103]) place(book, order("sell", p));
      expect(book.depth("sell", Infinity)).toHaveLength(3);
      expect(book.depth("sell", 5)).toHaveLength(3);
      expect(book.depth("sell", 0)).toEqual([]);
    });

    it.each([-1, 1.5, NaN, -Infinity])("throws for an invalid depth limit %s", (maxLevels) => {
      const book = new OrderBook("SPY");
      for (const p of [101, 102, 103]) place(book, order("sell", p));
      expect(() => book.depth("sell", maxLevels)).toThrow(
        /maxLevels must be a non-negative integer or Infinity/,
      );
    });

    it("returns a snapshot that cannot mutate the book", () => {
      const book = new OrderBook("SPY");
      const placed = place(book, order("buy", 100, 5, { id: "a" })) as { qty: number };
      placed.qty = 999;
      expect(book.get("a")?.qty).toBe(5);
      expect(book.depth("buy")[0].qty).toBe(5);
    });

    it("returns the stored order with an increasing sequence number across both sides", () => {
      const book = new OrderBook("SPY");
      const a = book.add({ id: "a", ownerId: "mm", side: "buy", price: 100, qty: 5 });
      const b = place(book, { id: "b", ownerId: "mm", side: "sell", price: 105, qty: 7 });
      expect(a).toEqual({
        ok: true,
        order: { id: "a", ownerId: "mm", side: "buy", price: 100, qty: 5, seq: 0 },
      });
      expect(b.seq).toBe(1);
      expect(book.get("b")).toEqual(b);
    });

    it("does not consume a sequence number for a rejected order", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100));
      expect(book.add(order("buy", -1)).ok).toBe(false);
      expect(place(book, order("buy", 99)).seq).toBe(1);
    });
  });

  describe("price-time priority", () => {
    it("gives priority to the better price, then the earlier order", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "early" }));
      place(book, order("buy", 100, 10, { id: "late" }));
      expect(book.bestOrder("buy")?.id).toBe("early");
      place(book, order("buy", 101, 10, { id: "better" }));
      expect(book.bestOrder("buy")?.id).toBe("better");
      expect(book.ordersAt("buy", 100).map((o) => o.id)).toEqual(["early", "late"]);
    });

    it("keeps time priority after a partial fill", () => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105, 10, { id: "first" }));
      place(book, order("sell", 105, 10, { id: "second" }));
      expect(book.reduce("first", 4)).toBe(6);
      expect(book.bestOrder("sell")).toMatchObject({ id: "first", qty: 6 });
      expect(book.depth("sell")[0]).toEqual({ price: 105, qty: 16, orderCount: 2 });
    });

    it("does not change seq on a partial fill", () => {
      const book = new OrderBook("SPY");
      const placed = place(book, order("buy", 100, 10, { id: "a" }));
      book.reduce("a", 3);
      expect(book.get("a")?.seq).toBe(placed.seq);
    });

    it("loses its place when cancelled and re-added", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a" }));
      place(book, order("buy", 100, 10, { id: "b" }));
      book.cancel("a");
      place(book, order("buy", 100, 10, { id: "a" }));
      expect(book.ordersAt("buy", 100).map((o) => o.id)).toEqual(["b", "a"]);
    });
  });

  describe("cancel", () => {
    it("removes the order, returns it, and drops empty levels", () => {
      const book = new OrderBook("SPY");
      const a = place(book, order("buy", 100, 10, { id: "a" }));
      place(book, order("buy", 99, 10, { id: "b" }));
      expect(book.cancel("a")).toEqual({ ok: true, order: a });
      expect(book.bestBid()).toBe(99);
      expect(book.levelCount("buy")).toBe(1);
      expect(book.get("a")).toBeUndefined();
      expectInvariants(book);
    });

    it("removes an order from the middle of a level", () => {
      const book = new OrderBook("SPY");
      for (const id of ["a", "b", "c"]) place(book, order("sell", 110, 5, { id }));
      book.cancel("b");
      expect(book.ordersAt("sell", 110).map((o) => o.id)).toEqual(["a", "c"]);
      expect(book.depth("sell")[0]).toEqual({ price: 110, qty: 10, orderCount: 2 });
    });

    it("returns UNKNOWN_ORDER for unknown or already-cancelled ids", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a" }));
      expect(book.cancel("nope")).toEqual({
        ok: false,
        reason: "UNKNOWN_ORDER",
        message: "Unknown order id: nope",
      });
      expect(book.cancel("a").ok).toBe(true);
      expect(book.cancel("a")).toMatchObject({ ok: false, reason: "UNKNOWN_ORDER" });
    });

    it("cancels a partially filled order, removing only its remaining quantity", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a" }));
      place(book, order("buy", 100, 4, { id: "b" }));
      book.reduce("a", 6);
      expect(book.cancel("a")).toMatchObject({ ok: true, order: { id: "a", qty: 4 } });
      expect(book.depth("buy")).toEqual([{ price: 100, qty: 4, orderCount: 1 }]);
      expect(book.bestOrder("buy")?.id).toBe("b");
    });

    it("removes the level when its only, partially filled order is cancelled", () => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105, 10, { id: "a" }));
      book.reduce("a", 9);
      book.cancel("a");
      expect(book.bestAsk()).toBeNull();
      expect(book.levelCount("sell")).toBe(0);
    });

    it("treats a fully filled order as gone: cancel fails, reduce throws, id is reusable", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 5, { id: "a" }));
      book.reduce("a", 5);
      expect(book.cancel("a").ok).toBe(false);
      expect(() => book.reduce("a", 1)).toThrow(/Unknown order id/);
      expect(book.add(order("buy", 100, 5, { id: "a" })).ok).toBe(true);
    });
  });

  describe("orders by owner", () => {
    it("lists an owner's orders across both sides in arrival order", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "m1", ownerId: "mm" }));
      place(book, order("buy", 99, 10, { id: "n1", ownerId: "noise" }));
      place(book, order("sell", 105, 10, { id: "m2", ownerId: "mm" }));
      place(book, order("buy", 98, 10, { id: "m3", ownerId: "mm" }));
      expect(book.ordersOf("mm").map((o) => o.id)).toEqual(["m1", "m2", "m3"]);
      expect(book.ordersOf("noise").map((o) => o.id)).toEqual(["n1"]);
      expect(book.ordersOf("nobody")).toEqual([]);
      expect(book.ownerCount).toBe(2);
    });

    it("cancelAll removes only that owner's orders and returns them", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "m1", ownerId: "mm" }));
      place(book, order("buy", 100, 5, { id: "n1", ownerId: "noise" }));
      place(book, order("sell", 105, 10, { id: "m2", ownerId: "mm" }));
      const cancelled = book.cancelAll("mm");
      expect(cancelled.map((o) => o.id)).toEqual(["m1", "m2"]);
      expect(book.size).toBe(1);
      expect(book.bestAsk()).toBeNull();
      expect(book.depth("buy")).toEqual([{ price: 100, qty: 5, orderCount: 1 }]);
      expect(book.ordersOf("mm")).toEqual([]);
      expect(book.ownerCount).toBe(1);
      expectInvariants(book);
    });

    it("cancelAll for an owner with no orders is a no-op", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { ownerId: "mm" }));
      expect(book.cancelAll("nobody")).toEqual([]);
      expect(book.size).toBe(1);
    });

    it("reflects partial fills and drops fully filled or cancelled orders", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a", ownerId: "mm" }));
      place(book, order("buy", 99, 10, { id: "b", ownerId: "mm" }));
      place(book, order("buy", 98, 10, { id: "c", ownerId: "mm" }));
      book.reduce("a", 4);
      book.reduce("b", 10);
      book.cancel("c");
      expect(book.ordersOf("mm")).toEqual([expect.objectContaining({ id: "a", qty: 6 })]);
    });

    it("forgets an owner once their last order is gone", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a", ownerId: "mm" }));
      book.reduce("a", 10);
      expect(book.ownerCount).toBe(0);
    });

    it("does not register an owner for a rejected order", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", -1, 10, { ownerId: "ghost" }));
      expect(book.ownerCount).toBe(0);
      expect(book.ordersOf("ghost")).toEqual([]);
    });
  });

  describe("reduce (engine-only, throws on misuse)", () => {
    it("removes the order when reduced to zero", () => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105, 10, { id: "a" }));
      expect(book.reduce("a", 10)).toBe(0);
      expect(book.size).toBe(0);
      expect(book.bestAsk()).toBeNull();
    });

    it.each([0, -1, 11, 2.5, NaN])("rejects invalid quantity %s", (qty) => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105, 10, { id: "a" }));
      expect(() => book.reduce("a", qty)).toThrow(RangeError);
      expect(book.get("a")?.qty).toBe(10);
    });

    it("names the allowed range in its error", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 5, { id: "a" }));
      expect(() => book.reduce("a", 6)).toThrow(/reduce qty must be an integer in 1\.\.5, got 6/);
    });

    it("rejects unknown ids", () => {
      expect(() => new OrderBook("SPY").reduce("nope", 1)).toThrow(/Unknown order id/);
    });
  });

  describe("rejections return reason codes (money is integer cents)", () => {
    it.each([0, -100, 100.5, 0.1 + 0.2, NaN, Infinity])("rejects price %s as INVALID_PRICE", (price) => {
      const book = new OrderBook("SPY");
      expect(reasonOf(book.add(order("buy", price)))).toBe("INVALID_PRICE");
      expect(book.size).toBe(0);
    });

    it.each([0, -5, 1.5, NaN])("rejects quantity %s as INVALID_QTY", (qty) => {
      expect(reasonOf(new OrderBook("SPY").add(order("buy", 100, qty)))).toBe("INVALID_QTY");
    });

    it("includes a readable message with the offending value", () => {
      const book = new OrderBook("SPY");
      expect(book.add(order("buy", 1.5))).toMatchObject({
        message: "price must be an integer number of cents in 1..100000000, got 1.5",
      });
      expect(book.add(order("buy", 100, 0))).toMatchObject({
        message: "qty must be an integer in 1..10000000, got 0",
      });
    });

    it.each([1, 4, 6, 10_001, 10_004])("rejects %i on a 5-cent tick as OFF_TICK", (price) => {
      expect(reasonOf(new OrderBook("SPY", 5).add(order("buy", price)))).toBe("OFF_TICK");
    });

    it.each([5, 10, 10_000])("accepts %i on a 5-cent tick", (price) => {
      expect(new OrderBook("SPY", 5).add(order("buy", price)).ok).toBe(true);
    });

    it("rejects duplicate ids, including across sides, and leaves the original intact", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a" }));
      const dup = book.add(order("sell", 200, 10, { id: "a" }));
      expect(dup).toEqual({ ok: false, reason: "DUPLICATE_ID", message: "Duplicate order id: a" });
      expect(book.get("a")).toMatchObject({ side: "buy", price: 100 });
      expect(book.size).toBe(1);
    });

    it("rejects an invalid side", () => {
      const bad = order("buy", 100, 10, { side: "hold" as Side });
      expect(reasonOf(new OrderBook("SPY").add(bad))).toBe("INVALID_SIDE");
    });

    it.each([0, -1, 0.5])("throws for an invalid tick size %s (configuration error)", (tick) => {
      expect(() => new OrderBook("SPY", tick)).toThrow(RangeError);
    });

    it("names the bad tick size in its error", () => {
      expect(() => new OrderBook("SPY", 0)).toThrow(
        /tickSize must be a positive integer number of cents, got 0/,
      );
    });
  });

  describe("never crossed", () => {
    it.each([
      ["buy", 105], // at the best ask
      ["buy", 110], // through the best ask
      ["sell", 100], // at the best bid
      ["sell", 95], // through the best bid
    ] as const)("rejects a %s at %i as WOULD_CROSS when bid=100 ask=105", (side, price) => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100));
      place(book, order("sell", 105));
      const result = book.add(order(side, price));
      expect(reasonOf(result)).toBe("WOULD_CROSS");
      expect(!result.ok && result.message).toMatch(/matching engine/);
      expect(book.size).toBe(2);
    });

    it("allows orders inside the spread", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100));
      place(book, order("sell", 105));
      place(book, order("buy", 102));
      place(book, order("sell", 103));
      expect(book.bestBid()).toBe(102);
      expect(book.bestAsk()).toBe(103);
      expect(book.spread()).toBe(1);
      expectInvariants(book);
    });
  });

  describe("spread on a one-sided book", () => {
    it("is null with only bids", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100));
      expect(book.bestBid()).toBe(100);
      expect(book.bestAsk()).toBeNull();
      expect(book.spread()).toBeNull();
    });

    it("is null with only asks", () => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105));
      expect(book.bestBid()).toBeNull();
      expect(book.spread()).toBeNull();
    });
  });

  describe("price level cleanup", () => {
    it("removes a non-best level and leaves its neighbours intact", () => {
      const book = new OrderBook("SPY");
      for (const [id, p] of [["a", 100], ["b", 99], ["c", 98]] as const) {
        place(book, order("buy", p, 10, { id }));
      }
      book.cancel("b");
      expect(book.depth("buy").map((l) => l.price)).toEqual([100, 98]);
      expect(book.ordersAt("buy", 99)).toEqual([]);
      expectInvariants(book);
    });

    it("leaves no trace of an emptied level: ordersAt, depth and levelCount all agree", () => {
      const book = new OrderBook("SPY");
      place(book, order("sell", 105, 3, { id: "a" }));
      place(book, order("sell", 105, 4, { id: "b" }));
      book.cancel("a");
      book.reduce("b", 4);
      expect(book.ordersAt("sell", 105)).toEqual([]);
      expect(book.depth("sell")).toEqual([]);
      expect(book.levelCount("sell")).toBe(0);
      expect(book.size).toBe(0);
    });

    it("starts a fresh level with zero totals when a price is reused", () => {
      const book = new OrderBook("SPY");
      place(book, order("buy", 100, 10, { id: "a" }));
      book.cancel("a");
      place(book, order("buy", 100, 3, { id: "b" }));
      expect(book.depth("buy")).toEqual([{ price: 100, qty: 3, orderCount: 1 }]);
    });

    it("returns an empty list for a price that never had orders", () => {
      expect(new OrderBook("SPY").ordersAt("buy", 100)).toEqual([]);
    });
  });

  describe("very large numbers (JS integers lose precision above 2^53 - 1)", () => {
    const MAX = Number.MAX_SAFE_INTEGER;

    it("limits guarantee an order's notional value (price × qty) is an exact integer", () => {
      expect(Number.isSafeInteger(MAX_PRICE_CENTS * MAX_ORDER_QTY)).toBe(true);
    });

    it("accepts an order exactly at the price and size limits", () => {
      const book = new OrderBook("SPY");
      expect(place(book, order("buy", MAX_PRICE_CENTS, MAX_ORDER_QTY))).toMatchObject({
        price: MAX_PRICE_CENTS,
        qty: MAX_ORDER_QTY,
      });
    });

    it.each([MAX_PRICE_CENTS + 1, MAX + 1, 2 ** 60, 1e21])("rejects price %s as INVALID_PRICE", (price) => {
      expect(reasonOf(new OrderBook("SPY").add(order("buy", price)))).toBe("INVALID_PRICE");
    });

    it.each([MAX_ORDER_QTY + 1, MAX, MAX + 1, 1e21])("rejects quantity %s as INVALID_QTY", (qty) => {
      expect(reasonOf(new OrderBook("SPY").add(order("buy", 100, qty)))).toBe("INVALID_QTY");
    });

    it("throws for an unsafe tick size", () => {
      expect(() => new OrderBook("SPY", MAX + 1)).toThrow(RangeError);
    });

    // Regression for the review finding: two orders summing past 2^53 - 1 used to corrupt
    // the level total permanently. That order size is now rejected up front.
    it("cannot be pushed into an inexact level total", () => {
      const book = new OrderBook("SPY");
      expect(reasonOf(book.add(order("buy", 100, MAX, { id: "huge" })))).toBe("INVALID_QTY");
      for (let i = 0; i < 1_000; i++) place(book, order("buy", 100, MAX_ORDER_QTY));
      place(book, order("buy", 100, 2, { id: "small" }));
      expect(book.depth("buy")[0].qty).toBe(1_000 * MAX_ORDER_QTY + 2);
    });
  });

  describe("randomized operations", () => {
    // Test-local deterministic generator (mulberry32) so failures are reproducible.
    const rng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    it.each([1, 2, 3, 42, 2008])("keeps every invariant over 2,000 random ops (seed %i)", (seed) => {
      const rand = rng(seed);
      const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
      const book = new OrderBook("SPY");
      const live: string[] = [];
      let n = 0;

      for (let step = 0; step < 2_000; step++) {
        const op = rand();
        if (op < 0.6 || live.length === 0) {
          const side: Side = rand() < 0.5 ? "buy" : "sell";
          const price = side === "buy" ? int(9_900, 10_000) : int(10_001, 10_100);
          const id = `r${n++}`;
          place(book, { id, ownerId: "r", side, price, qty: int(1, 50) });
          live.push(id);
        } else {
          const idx = int(0, live.length - 1);
          const id = live[idx];
          const current = book.get(id)!.qty;
          if (op < 0.8 || current === 1) {
            expect(book.cancel(id).ok).toBe(true);
            live.splice(idx, 1);
          } else if (book.reduce(id, int(1, current)) === 0) {
            live.splice(idx, 1);
          }
        }
        if (step % 100 === 0) expectInvariants(book);
      }
      expectInvariants(book);
      expect(book.size).toBe(live.length);
    });
  });
});
