import { describe, expect, it } from "vitest";
import { MatchingEngine, type LimitOrderInput, type MarketOrderInput, type OrderInput, type SubmitResult } from "./matchingEngine";
import type { AgentType, Side } from "./types";

let n = 0;
/** Each helper order gets a unique owner unless one is given, so self-trade prevention stays out of the way. */
const lim = (side: Side, price: number, qty: number, o: Partial<LimitOrderInput> = {}): LimitOrderInput => ({
  type: "limit",
  ownerId: `own${++n}`,
  agentType: "noise",
  side,
  price,
  qty,
  ...o,
});
const mkt = (side: Side, qty: number, o: Partial<MarketOrderInput> = {}): MarketOrderInput => ({
  type: "market",
  ownerId: `own${++n}`,
  agentType: "noise",
  side,
  qty,
  ...o,
});

function accepted(result: SubmitResult) {
  if (!result.ok) throw new Error(`expected acceptance, got ${result.reason}: ${result.message}`);
  return result;
}

/** Engine with asks 100×5 (a1), 101×5 (a2), 103×10 (a3) and a bid 99×10 (b1). Returns their ids. */
function ladder() {
  const e = new MatchingEngine("SPY");
  const a1 = accepted(e.submit(lim("sell", 100, 5, { agentType: "marketMaker" }), 0)).orderId;
  const a2 = accepted(e.submit(lim("sell", 101, 5), 0)).orderId;
  const a3 = accepted(e.submit(lim("sell", 103, 10), 0)).orderId;
  const b1 = accepted(e.submit(lim("buy", 99, 10), 0)).orderId;
  return { e, a1, a2, a3, b1 };
}

const fillSummary = (r: SubmitResult) => accepted(r).fills.map((f) => [f.price, f.qty]);

describe("MatchingEngine", () => {
  describe("order ids (D-014)", () => {
    it("assigns <ticker>-1, -2, -3 … in order of acceptance", () => {
      const { e, a1, a2, a3, b1 } = ladder();
      expect([a1, a2, a3, b1]).toEqual(["SPY-1", "SPY-2", "SPY-3", "SPY-4"]);
      expect(accepted(e.submit(mkt("buy", 1), 0)).orderId).toBe("SPY-5");
    });

    it("never reuses an id, even after the order is cancelled or filled", () => {
      const e = new MatchingEngine("SPY");
      const first = accepted(e.submit(lim("sell", 100, 1), 0)).orderId;
      e.cancel(first);
      const second = accepted(e.submit(lim("sell", 100, 1), 0)).orderId;
      accepted(e.submit(mkt("buy", 1), 0)); // fills `second` completely
      const third = accepted(e.submit(lim("sell", 100, 1), 0)).orderId;
      expect(new Set([first, second, third]).size).toBe(3);
      expect(third).toBe("SPY-4");
    });

    it("does not use up an id for a rejected order", () => {
      const e = new MatchingEngine("SPY");
      expect(e.submit(lim("buy", 0, 1), 0).ok).toBe(false);
      expect(e.submit(mkt("buy", 1), 0)).toMatchObject({ reason: "NO_LIQUIDITY" });
      expect(accepted(e.submit(lim("buy", 100, 1), 0)).orderId).toBe("SPY-1");
    });

    it("ignores an id supplied by the caller", () => {
      const e = new MatchingEngine("SPY");
      const sneaky = { ...lim("buy", 100, 1), id: "mine" } as OrderInput;
      expect(accepted(e.submit(sneaky, 0)).orderId).toBe("SPY-1");
      expect(e.book.has("mine")).toBe(false);
    });
  });

  describe("limit orders", () => {
    it("rests without trading when it does not cross", () => {
      const { e, b1 } = ladder();
      const r = accepted(e.submit(lim("buy", 99, 4), 10));
      expect(r.fills).toEqual([]);
      expect(r.resting).toMatchObject({ id: r.orderId, price: 99, qty: 4 });
      expect(r.cancelledQty).toBe(0);
      expect(e.book.ordersAt("buy", 99).map((o) => o.id)).toEqual([b1, r.orderId]);
    });

    it("trades at the resting order's price, not its own limit", () => {
      const { e } = ladder();
      // Willing to pay 102, but the best ask is 100, so it pays 100.
      expect(fillSummary(e.submit(lim("buy", 102, 3), 0))).toEqual([[100, 3]]);
    });

    it("sweeps levels up to its limit and rests the remainder at the limit", () => {
      const { e } = ladder();
      const r = accepted(e.submit(lim("buy", 102, 20), 0));
      // Takes 100×5 and 101×5; 103 is above the limit, so the other 10 rest at 102.
      expect(r.fills.map((f) => [f.price, f.qty])).toEqual([[100, 5], [101, 5]]);
      expect(r.resting).toMatchObject({ id: r.orderId, side: "buy", price: 102, qty: 10 });
      expect(e.book.bestBid()).toBe(102);
      expect(e.book.bestAsk()).toBe(103);
    });

    it("fills a sell limit against bids, best (highest) first", () => {
      const e = new MatchingEngine("SPY");
      accepted(e.submit(lim("buy", 98, 5), 0));
      accepted(e.submit(lim("buy", 99, 5), 0));
      expect(fillSummary(e.submit(lim("sell", 98, 8), 0))).toEqual([[99, 5], [98, 3]]);
    });

    it("fills exactly at its limit price", () => {
      const { e } = ladder();
      expect(fillSummary(e.submit(lim("buy", 101, 10), 0))).toEqual([[100, 5], [101, 5]]);
      expect(e.book.bestAsk()).toBe(103);
    });
  });

  describe("market orders", () => {
    it("sweeps as many levels as it needs", () => {
      const { e } = ladder();
      const r = accepted(e.submit(mkt("buy", 12), 0));
      expect(r.fills.map((f) => [f.price, f.qty])).toEqual([[100, 5], [101, 5], [103, 2]]);
      expect(r.resting).toBeNull();
      expect(r.cancelledQty).toBe(0);
      expect(e.book.depth("sell")).toEqual([{ price: 103, qty: 8, orderCount: 1 }]);
    });

    it("cancels whatever it cannot fill instead of resting it (D-007)", () => {
      const { e } = ladder();
      const r = accepted(e.submit(mkt("buy", 30), 0));
      expect(r.fills.reduce((s, f) => s + f.qty, 0)).toBe(20);
      expect(r.cancelledQty).toBe(10);
      expect(r.resting).toBeNull();
      expect(e.book.bestAsk()).toBeNull();
      expect(e.book.has(r.orderId)).toBe(false);
    });

    it("is rejected with NO_LIQUIDITY when the other side is empty (D-011)", () => {
      const e = new MatchingEngine("SPY");
      accepted(e.submit(lim("buy", 99, 10), 0));
      const r = e.submit(mkt("buy", 5), 0);
      expect(r).toMatchObject({ ok: false, reason: "NO_LIQUIDITY" });
      expect(!r.ok && r.message).toBe("market buy for 5 has nothing to trade against: the sell side is empty");
      expect(e.fillCount).toBe(0);
      expect(e.book.size).toBe(1);
    });

    it("ignores any price field (market orders have no limit)", () => {
      const { e } = ladder();
      const order = { ...mkt("buy", 5), price: -1 } as OrderInput;
      expect(fillSummary(e.submit(order, 0))).toEqual([[100, 5]]);
    });
  });

  describe("price-time priority among resting orders", () => {
    it("fills the earlier order at a price first", () => {
      const e = new MatchingEngine("SPY");
      const first = accepted(e.submit(lim("sell", 100, 5), 0)).orderId;
      const second = accepted(e.submit(lim("sell", 100, 5), 0)).orderId;
      const r = accepted(e.submit(mkt("buy", 7), 0));
      expect(r.fills.map((f) => [f.sell.orderId, f.qty])).toEqual([[first, 5], [second, 2]]);
    });

    it("keeps a partially filled resting order at the front of its queue", () => {
      const e = new MatchingEngine("SPY");
      const first = accepted(e.submit(lim("sell", 100, 10), 0)).orderId;
      const second = accepted(e.submit(lim("sell", 100, 10), 0)).orderId;
      accepted(e.submit(mkt("buy", 4), 0));
      expect(e.book.ordersAt("sell", 100).map((o) => [o.id, o.qty])).toEqual([[first, 6], [second, 10]]);
    });
  });

  describe("self-trade prevention (D-008)", () => {
    it("cancels the submitter's own resting order instead of trading with it", () => {
      const e = new MatchingEngine("SPY");
      const mine = accepted(e.submit(lim("sell", 100, 5, { ownerId: "mm" }), 0)).orderId;
      const r = accepted(e.submit(lim("buy", 100, 5, { ownerId: "mm" }), 0));
      expect(r.fills).toEqual([]);
      expect(r.selfTradeCancelled).toEqual([expect.objectContaining({ id: mine, side: "sell" })]);
      expect(r.resting).toMatchObject({ id: r.orderId, price: 100, qty: 5 });
      expect(e.book.has(mine)).toBe(false);
      expect(e.arrivalOf(mine)).toBeUndefined();
    });

    it("keeps matching against other owners behind the cancelled order", () => {
      const e = new MatchingEngine("SPY");
      const mine = accepted(e.submit(lim("sell", 100, 5, { ownerId: "mm" }), 0)).orderId;
      const theirs = accepted(e.submit(lim("sell", 100, 5, { ownerId: "other" }), 0)).orderId;
      const r = accepted(e.submit(mkt("buy", 5, { ownerId: "mm" }), 0));
      expect(r.selfTradeCancelled.map((o) => o.id)).toEqual([mine]);
      expect(r.fills.map((f) => f.sell.orderId)).toEqual([theirs]);
    });

    it("lets a market order end with no fills if only the submitter's own orders were there", () => {
      const e = new MatchingEngine("SPY");
      accepted(e.submit(lim("sell", 100, 5, { ownerId: "mm" }), 0));
      const r = accepted(e.submit(mkt("buy", 5, { ownerId: "mm" }), 0));
      expect(r.fills).toEqual([]);
      expect(r.cancelledQty).toBe(5);
      expect(r.selfTradeCancelled).toHaveLength(1);
      expect(e.book.size).toBe(0);
    });
  });

  describe("fill records", () => {
    it("records both sides with owner, agent type, limit price and the aggressor", () => {
      const { e, a1 } = ladder();
      const r = accepted(e.submit(lim("buy", 102, 3, { ownerId: "panic1", agentType: "panic" }), 1_500));
      expect(r.fills).toHaveLength(1);
      const f = r.fills[0];
      expect(f).toMatchObject({ seq: 0, time: 1_500, ticker: "SPY", price: 100, qty: 3, aggressor: "buy" });
      expect(f.buy).toMatchObject({ orderId: r.orderId, ownerId: "panic1", agentType: "panic", limitPrice: 102 });
      expect(f.sell).toMatchObject({ orderId: a1, agentType: "marketMaker", limitPrice: 100 });
    });

    it("records a null limit price for a market order", () => {
      const { e, b1 } = ladder();
      const f = accepted(e.submit(mkt("sell", 2, { agentType: "whale" }), 0)).fills[0];
      expect(f.aggressor).toBe("sell");
      expect(f.sell).toMatchObject({ agentType: "whale", limitPrice: null });
      expect(f.buy).toMatchObject({ orderId: b1, limitPrice: 99 });
    });

    it("numbers fills across submits and appends them to the log", () => {
      const { e } = ladder();
      accepted(e.submit(mkt("buy", 7), 0)); // fills seq 0 (100×5) and 1 (101×2)
      accepted(e.submit(mkt("sell", 1), 5)); // seq 2
      expect(e.fills.map((f) => [f.seq, f.price, f.qty, f.time])).toEqual([[0, 100, 5, 0], [1, 101, 2, 0], [2, 99, 1, 5]]);
      expect(e.fillCount).toBe(3);
      expect(e.fillsSince(2).map((f) => f.seq)).toEqual([2]);
      expect(e.fillsSince(-4)).toHaveLength(3);
      expect(e.fillsSince(3)).toEqual([]);
    });

    it("gives the resting side the quote from when it arrived, not the current one", () => {
      const e = new MatchingEngine("SPY");
      accepted(e.submit(lim("buy", 99, 5), 0));
      accepted(e.submit(lim("sell", 101, 5), 0)); // arrives seeing bid 99, ask none
      accepted(e.submit(lim("sell", 100, 5), 0)); // arrives seeing 99 / 101
      const f = accepted(e.submit(mkt("buy", 8), 0)).fills;
      expect(f[0].sell.arrival).toEqual({ bid: 99, ask: 101, midX2: 200, touch: 99 });
      expect(f[1].sell.arrival).toEqual({ bid: 99, ask: null, midX2: null, touch: 99 });
    });

    it("cannot be altered by callers: fills are frozen and `fills` is a copy", () => {
      const { e } = ladder();
      const f = accepted(e.submit(mkt("buy", 1), 0)).fills[0];
      expect(Object.isFrozen(f) && Object.isFrozen(f.buy) && Object.isFrozen(f.sell) && Object.isFrozen(f.buy.arrival)).toBe(true);
      expect(() => {
        (f as { price: number }).price = 1;
      }).toThrow(TypeError);
      e.fills.pop();
      expect(e.fillCount).toBe(1);
    });
  });

  describe("arrival quote and slippage (D-010)", () => {
    it("records bid, ask, doubled mid and touch when both sides exist", () => {
      const { e } = ladder(); // bid 99, ask 100
      expect(accepted(e.submit(mkt("buy", 1), 0)).arrival).toEqual({ bid: 99, ask: 100, midX2: 199, touch: 100 });
      // After that fill the ask is still 100 (4 left).
      expect(accepted(e.submit(mkt("sell", 1), 0)).arrival).toEqual({ bid: 99, ask: 100, midX2: 199, touch: 99 });
    });

    it("keeps a half-cent mid exact by storing it doubled", () => {
      const e = new MatchingEngine("SPY");
      accepted(e.submit(lim("buy", 100, 1), 0));
      accepted(e.submit(lim("sell", 101, 1), 0));
      expect(accepted(e.submit(lim("buy", 100, 1), 0)).arrival.midX2).toBe(201); // mid = 100.5
    });

    it("marks what is missing when a side is empty", () => {
      const e = new MatchingEngine("SPY");
      expect(accepted(e.submit(lim("buy", 99, 1), 0)).arrival).toEqual({ bid: null, ask: null, midX2: null, touch: null });
      // Bid exists, no asks: a buy sees no touch, a sell's touch is the bid.
      expect(accepted(e.submit(lim("buy", 98, 1), 0)).arrival).toEqual({ bid: 99, ask: null, midX2: null, touch: null });
      expect(accepted(e.submit(lim("sell", 105, 1), 0)).arrival).toEqual({ bid: 99, ask: null, midX2: null, touch: 99 });
    });

    it("splits implementation shortfall exactly into spread cost and impact cost", () => {
      const { e } = ladder(); // bid 99, ask 100 → mid 99.5
      const r = accepted(e.submit(mkt("buy", 12), 0)); // fills 100×5, 101×5, 103×2
      const { midX2, touch } = r.arrival;
      const qty = 12;
      const notional = r.fills.reduce((s, f) => s + f.price * f.qty, 0); // 500 + 505 + 206 = 1211
      // All in half-cents so nothing is rounded.
      const shortfallX2 = 2 * notional - midX2! * qty; // 2422 - 2388 = 34 → 17¢
      const spreadX2 = (2 * touch! - midX2!) * qty; //    (200 - 199) × 12 = 12 → 6¢
      const impactX2 = 2 * notional - 2 * touch! * qty; // 2422 - 2400 = 22 → 11¢
      expect([shortfallX2, spreadX2, impactX2]).toEqual([34, 12, 22]);
      expect(spreadX2 + impactX2).toBe(shortfallX2);
    });

    it("tracks an arrival quote for exactly the orders in the book", () => {
      const { e, a1, a2 } = ladder();
      expect(e.trackedArrivals).toBe(e.book.size);
      expect(e.arrivalOf(a1)).toEqual({ bid: null, ask: null, midX2: null, touch: null });
      accepted(e.submit(mkt("buy", 5), 0)); // a1 fully filled
      expect(e.arrivalOf(a1)).toBeUndefined();
      e.cancel(a2);
      e.cancelAll("nobody");
      expect(e.arrivalOf(a2)).toBeUndefined();
      expect(e.trackedArrivals).toBe(e.book.size);
    });
  });

  describe("cancel through the engine", () => {
    it("cancels one order and forgets its arrival quote", () => {
      const { e, a3 } = ladder();
      expect(e.cancel(a3)).toMatchObject({ ok: true, order: { id: a3 } });
      expect(e.cancel(a3)).toEqual({ ok: false, reason: "UNKNOWN_ORDER", message: `Unknown order id: ${a3}` });
      expect(e.arrivalOf(a3)).toBeUndefined();
    });

    it("cancels all of one owner's orders", () => {
      const e = new MatchingEngine("SPY");
      const q1 = accepted(e.submit(lim("buy", 99, 1, { ownerId: "mm" }), 0)).orderId;
      const q2 = accepted(e.submit(lim("sell", 101, 1, { ownerId: "mm" }), 0)).orderId;
      const q3 = accepted(e.submit(lim("sell", 102, 1, { ownerId: "other" }), 0)).orderId;
      expect(e.cancelAll("mm").map((o) => o.id)).toEqual([q1, q2]);
      expect(e.trackedArrivals).toBe(1);
      expect(e.arrivalOf(q3)).toBeDefined();
    });
  });

  describe("read-only book view (D-013)", () => {
    it("exposes only query functions, on a frozen object that is not the OrderBook", () => {
      const { e } = ladder();
      const view = e.book as unknown as Record<string, unknown>;
      for (const write of ["add", "cancel", "cancelAll", "reduce"]) expect(view[write]).toBeUndefined();
      expect(Object.isFrozen(view)).toBe(true);
      expect(() => {
        view.add = () => undefined;
      }).toThrow(TypeError);
      expect(Object.keys(view).sort()).toEqual(
        ["bestAsk", "bestBid", "bestOrder", "depth", "get", "has", "levelCount", "ordersAt", "ordersOf", "ownerCount", "size", "spread", "tickSize", "ticker"],
      );
    });

    it("stays live: queries reflect later changes", () => {
      const { e, a1 } = ladder();
      const view = e.book;
      expect([view.size, view.ownerCount, view.bestAsk()]).toEqual([4, 4, 100]);
      e.cancel(a1);
      expect([view.size, view.ownerCount, view.bestAsk(), view.spread()]).toEqual([3, 3, 101, 2]);
      expect(view.depth("sell", 1)).toEqual([{ price: 101, qty: 5, orderCount: 1 }]);
      expect(view.levelCount("sell")).toBe(2);
      expect(view.ordersOf("nobody")).toEqual([]);
      expect(view.bestOrder("buy")?.price).toBe(99);
    });
  });

  describe("rejections (no fills, no state change)", () => {
    const cases: Array<[string, OrderInput, string]> = [
      ["unknown order type", { ...mkt("buy", 1), type: "stop" } as unknown as OrderInput, "INVALID_ORDER_TYPE"],
      ["empty owner", mkt("buy", 1, { ownerId: "" }), "INVALID_OWNER"],
      ["unknown agent type", mkt("buy", 1, { agentType: "hedgeFund" as AgentType }), "INVALID_AGENT_TYPE"],
      ["bad side", mkt("hold" as Side, 1), "INVALID_SIDE"],
      ["limit price 0", lim("buy", 0, 1), "INVALID_PRICE"],
      ["limit price off tick", lim("buy", 101, 1), "OFF_TICK"],
      ["zero quantity", mkt("buy", 0), "INVALID_QTY"],
      ["fractional quantity", lim("buy", 100, 1.5), "INVALID_QTY"],
    ];

    it.each(cases)("rejects %s", (_label, order, reason) => {
      const e = new MatchingEngine("SPY", 2);
      accepted(e.submit(lim("sell", 100, 5), 0));
      accepted(e.submit(lim("buy", 98, 5), 0));
      const before = [e.book.depth("buy"), e.book.depth("sell"), e.fillCount, e.trackedArrivals];
      expect(e.submit(order, 0)).toMatchObject({ ok: false, reason });
      expect([e.book.depth("buy"), e.book.depth("sell"), e.fillCount, e.trackedArrivals]).toEqual(before);
    });

    it("reports an invalid order before an empty book", () => {
      expect(new MatchingEngine("SPY").submit(mkt("buy", 0), 0)).toMatchObject({ reason: "INVALID_QTY" });
    });

    it("names the bad order type in its message", () => {
      const r = new MatchingEngine("SPY").submit({ ...mkt("buy", 1), type: "stop" } as unknown as OrderInput, 0);
      expect(!r.ok && r.message).toBe('order type must be "limit" or "market", got "stop"');
    });

    it.each([-1, 1.5, NaN])("throws for an invalid time %s (engine misuse)", (time) => {
      expect(() => new MatchingEngine("SPY").submit(lim("buy", 100, 1), time)).toThrow(
        /time must be a non-negative integer number of ms/,
      );
    });
  });

  it("exposes the ticker and the tick size", () => {
    const e = new MatchingEngine("NVDA", 5);
    expect(e.ticker).toBe("NVDA");
    expect(e.book.ticker).toBe("NVDA");
    expect(e.book.tickSize).toBe(5);
  });
});
