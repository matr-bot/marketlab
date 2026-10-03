import { describe, expect, it } from "vitest";
import { ShadowBook } from "./testing/shadow";
import { runBookWorkload } from "./testing/workloads";

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
  it.each([1, 2, 3, 42, 2008])("matches the shadow for 3,000 random operations (seed %i)", (seed) => {
    const { seen, peak } = runBookWorkload(seed);
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
  }, 30_000); // a full random workload; allow for slow or busy machines
});
