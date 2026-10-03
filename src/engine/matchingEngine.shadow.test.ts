import { describe, expect, it } from "vitest";
import { runEngineWorkload } from "./testing/workloads";

describe("MatchingEngine vs ShadowEngine (randomized, compared after every step)", () => {
  it.each([1, 2, 3, 42, 2008])("matches the shadow for 3,000 random operations (seed %i)", (seed) => {
    const { seen, peak, fills } = runEngineWorkload(seed);
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
    expect(fills, "fills").toBeGreaterThanOrEqual(1_000);
  }, 30_000); // a full random workload; allow for slow or busy machines
});
