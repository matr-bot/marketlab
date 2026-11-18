import { describe, expect, it } from "vitest";
import { demoAgents } from "@/engine/demoMarket";
import { AGENT_MODELS, crowdCounts } from "./models";

describe("crowd models (D-083)", () => {
  it("counts the crowd the worker actually runs", () => {
    const c = crowdCounts();
    expect(c.total).toBe(demoAgents().length);
    expect(Object.values(c.byType).reduce((s, n) => s + (n ?? 0), 0)).toBe(c.total);
  });

  it("explains every trader type in the crowd, each with a model and a citation", () => {
    const types = Object.keys(crowdCounts().byType).sort();
    expect(AGENT_MODELS.map((m) => m.type).sort()).toEqual(types);
    for (const m of AGENT_MODELS) {
      expect(m.citation).toMatch(/\(\d{4}\)/);
      expect(m.detail).toMatch(/D-0\d\d/);
    }
  });
});
