import { describe, expect, it } from "vitest";
import { createScenarioModelCall } from "./anthropicModel";
import { interpretOpenScenario } from "./scenarioInterpret";

// Opt-in semantic holdout evaluation. Requires an API key; CI and offline development skip it.
const key = process.env.ANTHROPIC_API_KEY;
describe.skipIf(process.env.LIVE !== "1" || !key)("LIVE: open-ended unseen scenarios", () => {
  const call = createScenarioModelCall(key!);
  const cases = [
    { text: "Iran blocks the Strait of Hormuz", entity: /Iran|Hormuz/i, factor: "oilCosts", direction: 1 },
    { text: "Tankers cannot pass through Hormuz after a regional conflict", entity: /Hormuz|tanker/i, factor: "oilCosts", direction: 1 },
    { text: "The Federal Reserve unexpectedly raises rates", entity: /Fed|Federal Reserve/i, factor: "interestRates", direction: 1 },
    { text: "US-China trade war escalates", entity: /China|US|United States/i, factor: "tradeFriction", direction: 1 },
    { text: "A new chip export ban cuts semiconductor sales", entity: /chip|semiconductor/i, factor: "semiconductors", direction: -1 },
  ] as const;
  it.each(cases)("interprets $text without presets or verified-event claims", async ({ text, entity, factor, direction }) => {
    const result = await interpretOpenScenario(() => call(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypothetical).toBe(true);
    expect([...result.interpretation.entities, result.interpretation.summary].join(" ")).toMatch(entity);
    expect(result.interpretation.effects).toContainEqual(expect.objectContaining({ factor, direction }));
  }, 30_000);
  it.each(["SpaceX IPO", "Anthropic IPO", "A robotics startup IPO changes aerospace funding expectations"])("understands terse or unseen IPO wording: %s", async (text) => {
    const result = await interpretOpenScenario(() => call(text));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hypothetical).toBe(true);
      expect(result.interpretation.entities.length).toBeGreaterThan(0);
      expect(result.interpretation.assumptions.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
