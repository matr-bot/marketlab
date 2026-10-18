import { describe, expect, it } from "vitest";
import { presetByCode, PRESETS } from "./presets";

describe("Offline presets (D-048)", () => {
  it("are the four reviewed headlines with fixed shocks", () => {
    expect(PRESETS.map((p) => [p.code, p.shock.fairValuePct, p.shock.panicSensitivity, p.shock.durationSec])).toEqual([
      ["FED", -0.03, 1.5, 300],
      ["CEO", -0.06, 2, 300],
      ["BEAT", 0.04, 0.5, 300],
      ["DOWNGRADE", -0.01, 1, 120],
    ]);
  });

  it("carry their headlines", () => {
    expect(PRESETS.map((p) => p.headline)).toEqual(["Fed surprise hike 75bps", "CEO arrested for accounting fraud", "Earnings beat, guidance raised", "Analyst downgrade to neutral"]);
  });

  it("are found by code, ignoring case and surrounding spaces", () => {
    expect(presetByCode(" fed ")?.code).toBe("FED");
    expect(presetByCode("Downgrade")?.headline).toBe("Analyst downgrade to neutral");
    expect(presetByCode("MOON")).toBeUndefined();
  });
});
