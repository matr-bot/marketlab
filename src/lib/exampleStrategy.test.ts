import { describe, expect, it } from "vitest";
import { clampStrategy } from "@/engine/strategy";
import { describeRules } from "./glassbox/english";
import { strategyPython } from "./glassbox/python";
import { EXAMPLE_SPEC, EXAMPLE_TEXT } from "./exampleStrategy";

describe("the example strategy (D-088)", () => {
  it("is already inside the engine's limits: clamping changes nothing", () => {
    expect(clampStrategy(EXAMPLE_SPEC)).toEqual(EXAMPLE_SPEC);
  });

  it("says what its text says", () => {
    expect(EXAMPLE_TEXT).toMatch(/500/);
    expect(EXAMPLE_SPEC).toMatchObject({ qty: 500, stopLossPct: 0.01, timeExitSec: 120, entry: { rule: "buyAfterDrop", pct: 0.03 } });
    expect(describeRules(EXAMPLE_SPEC)[0].text).toMatch(/3% below/);
    expect(strategyPython(EXAMPLE_SPEC)).toContain("ENTRY_PCT = 0.03");
  });
});
