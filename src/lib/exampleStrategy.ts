import { clampStrategy, type StrategySpec } from "@/engine/strategy";

/**
 * The STRATEGY workspace's first-load example (D-088): the demo's idea, as fixed data, so the builder,
 * the glass box and START are ready without an AI call. Clamped exactly as START clamps a spec.
 */
export const EXAMPLE_TEXT = "Buy 500 after a quick 3% drop because panic sellers overshoot; stop loss 1%, out after 2 minutes";

export const EXAMPLE_SPEC: StrategySpec = clampStrategy({
  entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 },
  stopLossPct: 0.01,
  takeProfitPct: null,
  timeExitSec: 120,
  qty: 500,
  cooldownSec: 30,
});
