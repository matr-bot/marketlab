import { describe, expect, it } from "vitest";
import { buildOrderReports, orderSlippageBps, perShareCents, totalCents, totalExecution } from "./executionReport";
import { MatchingEngine, type OrderInput } from "./matchingEngine";
import type { Side } from "./types";

// Hand-computed cases. Book used throughout: bid 186.99 x 100, asks 187.01 x 100 and 187.02 x 100,
// so the arrival mid is 187.00 (midX2 = 37,400) and the touch is 187.01 for a buyer.
function book(): MatchingEngine {
  const e = new MatchingEngine("MLAB");
  e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "buy", price: 18_699, qty: 100 }, 0);
  e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "sell", price: 18_701, qty: 100 }, 0);
  e.submit({ type: "limit", ownerId: "noise", agentType: "noise", side: "sell", price: 18_702, qty: 100 }, 0);
  return e;
}
const market = (side: Side, qty: number): OrderInput => ({ type: "market", ownerId: "user", agentType: "user", side, qty });

describe("buildOrderReports: slippage against the arrival mid", () => {
  it("a market buy that sweeps two levels: total = spread cost + impact cost, in exact half-cents", () => {
    const e = book();
    e.submit(market("buy", 150), 1_000); // 100 @ 187.01, 50 @ 187.02
    const [r] = buildOrderReports(e.fills, "user");
    expect(r).toMatchObject({ side: "buy", time: 1_000, qty: 150, aggressiveQty: 150, passiveQty: 0, notional: 18_701 * 100 + 18_702 * 50, arrivalMidX2: 37_400 });
    // Σ q·(2p − mid): 100·(37,402 − 37,400) + 50·(37,404 − 37,400) = 200 + 200
    expect(r.slippageX2).toBe(400);
    // crossing to the touch (187.01): 100·2 + 50·2 = 300; the extra 187.02 the order's own size cost: 50·2 = 100
    expect([r.spreadX2, r.impactX2, r.passiveX2]).toEqual([300, 100, 0]);
    expect(r.avgPrice).toBeCloseTo(18_701.3333, 3);
    expect(perShareCents(r.slippageX2!, r.qty)).toBeCloseTo(1.3333, 3); // cents per share
    expect(totalCents(r.slippageX2!)).toBe(200); // $2.00 in all
  });

  it("a market sell of 100 at 186.99 costs the same 1 cent per share: the sign flips with the side", () => {
    const e = book();
    e.submit(market("sell", 100), 2_000);
    const [r] = buildOrderReports(e.fills, "user");
    expect(r.side).toBe("sell");
    expect([r.slippageX2, r.spreadX2, r.impactX2]).toEqual([200, 200, 0]);
  });

  it("a half-cent mid stays exact: bid 100, ask 101 → mid 100.5", () => {
    const e = new MatchingEngine("MLAB");
    e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "buy", price: 100, qty: 10 }, 0);
    e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "sell", price: 101, qty: 10 }, 0);
    e.submit(market("buy", 10), 5);
    const [r] = buildOrderReports(e.fills, "user");
    expect(r.arrivalMidX2).toBe(201);
    expect(r.slippageX2).toBe(10 * (202 - 201)); // half a cent a share, exactly 10 half-cent shares
  });

  it("a resting limit order that is hit later earns the spread: negative passive edge, no spread or impact", () => {
    const e = book();
    e.submit({ type: "limit", ownerId: "user", agentType: "user", side: "buy", price: 18_699, qty: 100 }, 1_000); // joins the bid
    e.submit({ type: "market", ownerId: "noise", agentType: "noise", side: "sell", qty: 100 }, 2_000); // hits the oldest bid first
    const fills = e.fills;
    const user = buildOrderReports(fills, "user");
    // Price-time priority: the market maker's 186.99 bid was first in line, so the user is not filled yet.
    expect(user).toEqual([]);
    e.submit({ type: "market", ownerId: "noise", agentType: "noise", side: "sell", qty: 100 }, 3_000); // now the user's turn
    const [r] = buildOrderReports(e.fills, "user");
    expect(r).toMatchObject({ side: "buy", time: 3_000, qty: 100, aggressiveQty: 0, passiveQty: 100 });
    expect(r.passiveX2).toBe(100 * (2 * 18_699 - 37_400)); // −200: paid 1¢ under the mid
    expect([r.spreadX2, r.impactX2, r.slippageX2]).toEqual([0, 0, -200]);
  });

  it("an order that arrives when one side is empty has no intended price: slippage is null, volume still counts", () => {
    const e = new MatchingEngine("MLAB");
    e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "sell", price: 18_701, qty: 100 }, 0); // no bids
    e.submit(market("buy", 100), 1_000);
    const [r] = buildOrderReports(e.fills, "user");
    expect(r).toMatchObject({ qty: 100, notional: 1_870_100, arrivalMidX2: null, slippageX2: null, spreadX2: null, impactX2: null, passiveX2: null });
    const t = totalExecution([r]);
    expect(t).toMatchObject({ orders: 1, qty: 100, notional: 1_870_100, slippageX2: null, slippageBps: null });
  });

  it("ignores other owners' fills and groups a partly filled order's fills together", () => {
    const e = book();
    e.submit(market("buy", 60), 1_000); // user: 60 @ 187.01
    e.submit({ type: "market", ownerId: "other", agentType: "noise", side: "buy", qty: 20 }, 1_500); // not the user
    e.submit(market("buy", 80), 2_000); // user: 40 @ 187.01, 40 @ 187.02
    const reports = buildOrderReports(e.fills, "user");
    expect(reports.map((r) => [r.qty, r.time])).toEqual([
      [60, 1_000],
      [80, 2_000],
    ]);
  });
});

describe("totalExecution", () => {
  it("adds orders and expresses slippage in basis points of the arrival-mid value", () => {
    const e = book();
    e.submit(market("buy", 150), 1_000);
    const reports = buildOrderReports(e.fills, "user");
    const t = totalExecution(reports);
    expect(t).toMatchObject({ orders: 1, qty: 150, slippageX2: 400, spreadX2: 300, impactX2: 100 });
    // 400 half-cent shares ÷ (150 shares × 37,400 half-cents) = 400 / 5,610,000 = 0.0000713 = 0.713 bp
    expect(t.slippageBps).toBeCloseTo(0.713, 3);
  });

  it("an empty report totals to zero orders and null slippage", () => {
    expect(totalExecution([])).toEqual({ orders: 0, qty: 0, notional: 0, slippageX2: null, spreadX2: null, impactX2: null, passiveX2: null, slippageBps: null });
  });
});

describe("orderSlippageBps", () => {
  it("is the order's slippage over its arrival-mid value: 400 half-cent shares on 150 × 37,400 → 0.713 bp", () => {
    const e = book();
    e.submit(market("buy", 150), 1_000);
    const [r] = buildOrderReports(e.fills, "user");
    expect(orderSlippageBps(r)).toBeCloseTo(0.713, 3);
    expect(orderSlippageBps(r)).toBeCloseTo(totalExecution([r]).slippageBps!, 12); // one order: same as the total
  });

  it("is null without an arrival mid", () => {
    const e = new MatchingEngine("MLAB");
    e.submit({ type: "limit", ownerId: "mm", agentType: "marketMaker", side: "sell", price: 18_701, qty: 100 }, 0);
    e.submit(market("buy", 100), 1_000);
    expect(orderSlippageBps(buildOrderReports(e.fills, "user")[0])).toBeNull();
  });
});
