import { describe, expect, it } from "vitest";
import { OrderBook, type NewLimitOrder } from "./orderBook";
import type { Side } from "./types";

let counter = 0;
const order = (side: Side, price: number, qty = 10, overrides: Partial<NewLimitOrder> = {}) => ({
  id: `o${++counter}`,
  ownerId: "t1",
  side,
  price,
  qty,
  ...overrides,
});

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
      book.add(order("buy", 10_000));
      book.add(order("buy", 10_005));
      book.add(order("sell", 10_020));
      book.add(order("sell", 10_010));
      expect(book.bestBid()).toBe(10_005);
      expect(book.bestAsk()).toBe(10_010);
      expect(book.spread()).toBe(5);
      expectInvariants(book);
    });

    it("sorts bids high-to-low and asks low-to-high regardless of arrival order", () => {
      const book = new OrderBook("SPY");
      for (const p of [99, 97, 100, 98]) book.add(order("buy", p));
      for (const p of [103, 101, 104, 102]) book.add(order("sell", p));
      expect(book.depth("buy").map((l) => l.price)).toEqual([100, 99, 98, 97]);
      expect(book.depth("sell").map((l) => l.price)).toEqual([101, 102, 103, 104]);
    });

    it("aggregates quantity and order count per level", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 5));
      book.add(order("buy", 100, 7));
      book.add(order("buy", 99, 3));
      expect(book.depth("buy")).toEqual([
        { price: 100, qty: 12, orderCount: 2 },
        { price: 99, qty: 3, orderCount: 1 },
      ]);
    });

    it("limits depth to the requested number of levels", () => {
      const book = new OrderBook("SPY");
      for (const p of [101, 102, 103]) book.add(order("sell", p));
      expect(book.depth("sell", 2).map((l) => l.price)).toEqual([101, 102]);
    });

    it("returns a snapshot that cannot mutate the book", () => {
      const book = new OrderBook("SPY");
      const placed = book.add(order("buy", 100, 5, { id: "a" })) as { qty: number };
      placed.qty = 999;
      expect(book.get("a")?.qty).toBe(5);
      expect(book.depth("buy")[0].qty).toBe(5);
    });
  });

  describe("price-time priority", () => {
    it("gives priority to the better price, then the earlier order", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "early" }));
      book.add(order("buy", 100, 10, { id: "late" }));
      expect(book.bestOrder("buy")?.id).toBe("early");
      book.add(order("buy", 101, 10, { id: "better" }));
      expect(book.bestOrder("buy")?.id).toBe("better");
      expect(book.ordersAt("buy", 100).map((o) => o.id)).toEqual(["early", "late"]);
    });

    it("keeps time priority after a partial fill", () => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105, 10, { id: "first" }));
      book.add(order("sell", 105, 10, { id: "second" }));
      expect(book.reduce("first", 4)).toBe(6);
      expect(book.bestOrder("sell")).toMatchObject({ id: "first", qty: 6 });
      expect(book.depth("sell")[0]).toEqual({ price: 105, qty: 16, orderCount: 2 });
    });

    it("loses its place when cancelled and re-added", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      book.add(order("buy", 100, 10, { id: "b" }));
      book.cancel("a");
      book.add(order("buy", 100, 10, { id: "a" }));
      expect(book.ordersAt("buy", 100).map((o) => o.id)).toEqual(["b", "a"]);
    });
  });

  describe("cancel", () => {
    it("removes the order and drops empty levels", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      book.add(order("buy", 99, 10, { id: "b" }));
      expect(book.cancel("a")).toBe(true);
      expect(book.bestBid()).toBe(99);
      expect(book.levelCount("buy")).toBe(1);
      expect(book.get("a")).toBeUndefined();
      expectInvariants(book);
    });

    it("removes an order from the middle of a level", () => {
      const book = new OrderBook("SPY");
      for (const id of ["a", "b", "c"]) book.add(order("sell", 110, 5, { id }));
      book.cancel("b");
      expect(book.ordersAt("sell", 110).map((o) => o.id)).toEqual(["a", "c"]);
      expect(book.depth("sell")[0]).toEqual({ price: 110, qty: 10, orderCount: 2 });
    });

    it("returns false for unknown or already-cancelled ids", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      expect(book.cancel("nope")).toBe(false);
      expect(book.cancel("a")).toBe(true);
      expect(book.cancel("a")).toBe(false);
    });
  });

  describe("reduce", () => {
    it("removes the order when reduced to zero", () => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105, 10, { id: "a" }));
      expect(book.reduce("a", 10)).toBe(0);
      expect(book.size).toBe(0);
      expect(book.bestAsk()).toBeNull();
    });

    it.each([0, -1, 11, 2.5, NaN])("rejects invalid quantity %s", (qty) => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105, 10, { id: "a" }));
      expect(() => book.reduce("a", qty)).toThrow(RangeError);
      expect(book.get("a")?.qty).toBe(10);
    });

    it("rejects unknown ids", () => {
      expect(() => new OrderBook("SPY").reduce("nope", 1)).toThrow(/Unknown order id/);
    });
  });

  describe("validation (money is integer cents)", () => {
    it.each([0, -100, 100.5, 0.1 + 0.2, NaN, Infinity])("rejects price %s", (price) => {
      const book = new OrderBook("SPY");
      expect(() => book.add(order("buy", price))).toThrow(RangeError);
      expect(book.size).toBe(0);
    });

    it.each([0, -5, 1.5, NaN])("rejects quantity %s", (qty) => {
      expect(() => new OrderBook("SPY").add(order("buy", 100, qty))).toThrow(RangeError);
    });

    it("enforces tick size", () => {
      const book = new OrderBook("SPY", 5);
      expect(() => book.add(order("buy", 10_003))).toThrow(/tick size/);
      expect(() => book.add(order("buy", 10_005))).not.toThrow();
    });

    it.each([0, -1, 0.5])("rejects tick size %s", (tick) => {
      expect(() => new OrderBook("SPY", tick)).toThrow(RangeError);
    });

    it("rejects duplicate ids, including across sides", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      expect(() => book.add(order("sell", 200, 10, { id: "a" }))).toThrow(/Duplicate/);
    });

    it("rejects an invalid side", () => {
      const bad = order("buy", 100, 10, { side: "hold" as Side });
      expect(() => new OrderBook("SPY").add(bad)).toThrow(/Invalid side/);
    });
  });

  describe("never crossed", () => {
    it.each([
      ["buy", 105], // at the best ask
      ["buy", 110], // through the best ask
      ["sell", 100], // at the best bid
      ["sell", 95], // through the best bid
    ] as const)("rejects a %s at %i when bid=100 ask=105", (side, price) => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100));
      book.add(order("sell", 105));
      expect(() => book.add(order(side, price))).toThrow(/matching engine/);
      expect(book.size).toBe(2);
    });

    it("allows orders inside the spread", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100));
      book.add(order("sell", 105));
      book.add(order("buy", 102));
      book.add(order("sell", 103));
      expect(book.bestBid()).toBe(102);
      expect(book.bestAsk()).toBe(103);
      expect(book.spread()).toBe(1);
      expectInvariants(book);
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
          book.add({ id, ownerId: "r", side, price, qty: int(1, 50) });
          live.push(id);
        } else {
          const idx = int(0, live.length - 1);
          const id = live[idx];
          const current = book.get(id)!.qty;
          if (op < 0.8 || current === 1) {
            expect(book.cancel(id)).toBe(true);
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

describe("OrderBook edge cases", () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  describe("spread on a one-sided book", () => {
    it("is null with only bids", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100));
      expect(book.bestBid()).toBe(100);
      expect(book.bestAsk()).toBeNull();
      expect(book.spread()).toBeNull();
    });

    it("is null with only asks", () => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105));
      expect(book.bestBid()).toBeNull();
      expect(book.spread()).toBeNull();
    });
  });

  describe("add return value", () => {
    it("returns the stored order with an increasing sequence number across both sides", () => {
      const book = new OrderBook("SPY");
      const a = book.add({ id: "a", ownerId: "mm", side: "buy", price: 100, qty: 5 });
      const b = book.add({ id: "b", ownerId: "mm", side: "sell", price: 105, qty: 7 });
      expect(a).toEqual({ id: "a", ownerId: "mm", side: "buy", price: 100, qty: 5, seq: 0 });
      expect(b.seq).toBe(1);
      expect(book.get("b")).toEqual(b);
    });

    it("does not change seq on a partial fill", () => {
      const book = new OrderBook("SPY");
      const placed = book.add(order("buy", 100, 10, { id: "a" }));
      book.reduce("a", 3);
      expect(book.get("a")?.seq).toBe(placed.seq);
    });
  });

  describe("cancel after fills", () => {
    it("cancels a partially filled order and removes only its remaining quantity", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      book.add(order("buy", 100, 4, { id: "b" }));
      book.reduce("a", 6);
      expect(book.cancel("a")).toBe(true);
      expect(book.depth("buy")).toEqual([{ price: 100, qty: 4, orderCount: 1 }]);
      expect(book.bestOrder("buy")?.id).toBe("b");
    });

    it("removes the level when its only, partially filled order is cancelled", () => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105, 10, { id: "a" }));
      book.reduce("a", 9);
      book.cancel("a");
      expect(book.bestAsk()).toBeNull();
      expect(book.levelCount("sell")).toBe(0);
    });

    it("treats a fully filled order as gone: cancel is false, reduce throws, id is reusable", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 5, { id: "a" }));
      book.reduce("a", 5);
      expect(book.cancel("a")).toBe(false);
      expect(() => book.reduce("a", 1)).toThrow(/Unknown order id/);
      expect(() => book.add(order("buy", 100, 5, { id: "a" }))).not.toThrow();
    });
  });

  describe("price level cleanup", () => {
    it("removes a non-best level and leaves its neighbours intact", () => {
      const book = new OrderBook("SPY");
      for (const [id, p] of [["a", 100], ["b", 99], ["c", 98]] as const) {
        book.add(order("buy", p, 10, { id }));
      }
      book.cancel("b");
      expect(book.depth("buy").map((l) => l.price)).toEqual([100, 98]);
      expect(book.ordersAt("buy", 99)).toEqual([]);
      expectInvariants(book);
    });

    it("leaves no trace of an emptied level: ordersAt, depth and levelCount all agree", () => {
      const book = new OrderBook("SPY");
      book.add(order("sell", 105, 3, { id: "a" }));
      book.add(order("sell", 105, 4, { id: "b" }));
      book.cancel("a");
      book.reduce("b", 4);
      expect(book.ordersAt("sell", 105)).toEqual([]);
      expect(book.depth("sell")).toEqual([]);
      expect(book.levelCount("sell")).toBe(0);
      expect(book.size).toBe(0);
    });

    it("starts a fresh level with zero totals when a price is reused", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, 10, { id: "a" }));
      book.cancel("a");
      book.add(order("buy", 100, 3, { id: "b" }));
      expect(book.depth("buy")).toEqual([{ price: 100, qty: 3, orderCount: 1 }]);
    });

    it("returns an empty list for a price that never had orders", () => {
      expect(new OrderBook("SPY").ordersAt("buy", 100)).toEqual([]);
    });
  });

  describe("tick size", () => {
    it.each([1, 4, 6, 10_001, 10_004])("rejects %i on a 5-cent tick", (price) => {
      expect(() => new OrderBook("SPY", 5).add(order("buy", price))).toThrow(/tick size/);
    });

    it.each([5, 10, 10_000])("accepts %i on a 5-cent tick", (price) => {
      expect(() => new OrderBook("SPY", 5).add(order("buy", price))).not.toThrow();
    });
  });

  describe("error messages name the problem", () => {
    it("reports bad price, qty, tick size and reduce qty clearly", () => {
      const book = new OrderBook("SPY");
      expect(() => book.add(order("buy", 1.5))).toThrow(/price must be a positive integer number of cents, got 1.5/);
      expect(() => book.add(order("buy", 100, 0))).toThrow(/qty must be a positive integer, got 0/);
      expect(() => new OrderBook("SPY", 0)).toThrow(/tickSize must be a positive integer number of cents, got 0/);
      book.add(order("buy", 100, 5, { id: "a" }));
      expect(() => book.reduce("a", 6)).toThrow(/reduce qty must be an integer in 1\.\.5, got 6/);
    });
  });

  describe("very large numbers (JS integers lose precision above 2^53 - 1)", () => {
    it("accepts the largest safe integer price and quantity", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", MAX, MAX, { id: "a" }));
      expect(book.get("a")).toMatchObject({ price: MAX, qty: MAX });
    });

    it.each([MAX + 1, 2 ** 60, 1e21])("rejects unsafe price %s", (price) => {
      expect(() => new OrderBook("SPY").add(order("buy", price))).toThrow(RangeError);
    });

    it.each([MAX + 1, 2 ** 60, 1e21])("rejects unsafe quantity %s", (qty) => {
      expect(() => new OrderBook("SPY").add(order("buy", 100, qty))).toThrow(RangeError);
    });

    it("rejects an unsafe tick size", () => {
      expect(() => new OrderBook("SPY", MAX + 1)).toThrow(RangeError);
    });

    // KNOWN BUG (found in review): each order's qty is checked, but the level total is not.
    // Two orders summing past 2^53 - 1 corrupt the level total permanently.
    // `it.fails` passes while the bug exists; when it is fixed, change this to `it`.
    it.fails("keeps level totals exact when orders at one price sum past 2^53 - 1", () => {
      const book = new OrderBook("SPY");
      book.add(order("buy", 100, MAX, { id: "huge" }));
      book.add(order("buy", 100, 2, { id: "small" }));
      book.cancel("huge");
      expect(book.depth("buy")[0].qty).toBe(2);
    });
  });
});
