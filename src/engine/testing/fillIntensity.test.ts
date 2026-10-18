import { describe, expect, it } from "vitest";
import { DEFAULT_MM_PARAMS } from "../agents/marketMaker";
import { demoAgents } from "../demoMarket";
import { measureFillIntensity } from "./fillIntensity";

const MUTATION_RUN = process.env.MARKETLAB_MUTATION === "1";

describe.skipIf(MUTATION_RUN)("Market makers' k is consistent with the fill rates they get (D-049)", () => {
  it("in the demo market, fills fall off with distance at a rate within ±20% of the k they quote with", () => {
    const fit = measureFillIntensity(demoAgents, [187], 36_000, 10);
    const used = fit.bins.filter((b) => b.delta >= 1 && b.fills >= 10);
    expect(used.length).toBeGreaterThanOrEqual(2);
    expect(used.every((b, i) => i === 0 || b.lambda < used[i - 1].lambda)).toBe(true); // further away, filled less often
    expect(fit.k).toBeGreaterThan(0.8 * DEFAULT_MM_PARAMS.k);
    expect(fit.k).toBeLessThan(1.2 * DEFAULT_MM_PARAMS.k);
  });
});
