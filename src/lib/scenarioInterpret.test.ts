import { describe, expect, it } from "vitest";
import { interpretOpenScenario, validateScenarioOutput } from "./scenarioInterpret";

const output = (summary: string) => ({ coherent: true, summary, entities: ["Unlisted company"], sectors: ["Technology"], mechanisms: ["New financing changes competitors' expectations"], assumptions: ["Offering terms are unknown"], uncertainty: "high", effects: [{ factor: "technology", direction: 1, strength: 1, mechanism: "Sector attention may increase" }] });

describe("scenario interpretation contract", () => {
  it("preserves a coherent interpretation as hypothetical", () => {
    const result = validateScenarioOutput(output("A hypothetical offering changes sector sentiment"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hypothetical).toBe(true);
  });
  it("does not apply unsupported or invalid model output", () => {
    expect(validateScenarioOutput({ ...output("Nonsense"), coherent: false }).ok).toBe(false);
    expect(validateScenarioOutput({ ...output("Bad"), effects: [{ factor: "imaginaryAsset", direction: 1, strength: 1, mechanism: "Unsupported" }] }).ok).toBe(false);
    const unmapped = validateScenarioOutput({ ...output("Unmapped"), effects: [] });
    expect(unmapped.ok).toBe(true);
    if (unmapped.ok) expect(unmapped.message).toMatch(/Nothing can be applied/);
  });
  it("reports API refusals, timeouts and exceptions without applying a scenario", async () => {
    for (const call of [
      () => Promise.resolve({ kind: "refusal" }),
      () => Promise.resolve({ kind: "error" }),
      () => Promise.reject(new Error("timeout")),
    ]) {
      expect(await interpretOpenScenario(call)).toMatchObject({ ok: false, source: "unavailable", message: expect.stringContaining("Nothing was applied") });
    }
  });
});
