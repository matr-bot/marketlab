import { describe, expect, it } from "vitest";
import { compileScenario, ScenarioStudioMarket, STUDIO_ASSETS, type ScenarioInterpretation } from "./scenarioStudio";

const scenario = (effects: ScenarioInterpretation["effects"]): ScenarioInterpretation => ({
  summary: "A hypothetical market event", entities: [], sectors: [], mechanisms: [], assumptions: ["Illustrative"], uncertainty: "medium", effects,
});

describe("open-ended scenario compiler", () => {
  it("maps economically different events to distinct bounded asset signals", () => {
    const oil = compileScenario(scenario([{ factor: "oilCosts", direction: 1, strength: 3, mechanism: "Oil input costs rise" }]), 187);
    const tech = compileScenario(scenario([{ factor: "technology", direction: 1, strength: 2, mechanism: "Technology sentiment improves" }]), 187);
    const oilOf = (ticker: string) => oil.signals.find((s) => s.ticker === ticker)!.fairValuePct;
    const techOf = (ticker: string) => tech.signals.find((s) => s.ticker === ticker)!.fairValuePct;
    expect(oilOf("ENRG")).toBeGreaterThan(0);
    expect(oilOf("AIRX")).toBeLessThan(0);
    expect(techOf("TECX")).toBeGreaterThan(techOf("ENRG"));
    expect(STUDIO_ASSETS).toHaveLength(5);
    expect(oil.signals.every((s) => Math.abs(s.fairValuePct) <= 0.06)).toBe(true);
  });

  it("keeps unsupported effects inert", () => {
    const compiled = compileScenario(scenario([]), 187);
    expect(compiled.signals.every((signal) => signal.fairValuePct === 0)).toBe(true);
  });

  it("replays the same frozen interpretation and seed through matched trades", () => {
    const compiled = compileScenario(scenario([{ factor: "oilCosts", direction: 1, strength: 3, mechanism: "Supply disruption" }]), 187);
    const a = new ScenarioStudioMarket(compiled);
    const b = new ScenarioStudioMarket(compiled);
    a.advance(900);
    b.advance(900);
    const left = a.frames();
    const right = b.frames();
    expect(left).toEqual(right);
    expect(left.every((asset) => asset.ordersSubmitted > 0)).toBe(true);
    expect(left.every((asset) => asset.totalTrades > 0)).toBe(true);
    expect(left.every((asset) => asset.frame.last === null || asset.frame.trades.some((trade) => trade.price === asset.frame.last) || asset.frame.droppedTrades > 0)).toBe(true);
  });

  it("produces different transaction prices for energy and airline exposures", () => {
    const compiled = compileScenario(scenario([{ factor: "oilCosts", direction: 1, strength: 3, mechanism: "A shipping interruption raises oil costs" }]), 187);
    const market = new ScenarioStudioMarket(compiled);
    market.advance(1_200);
    const assets = market.frames();
    const change = (ticker: string) => {
      const asset = assets.find((item) => item.ticker === ticker)!;
      const open = STUDIO_ASSETS.find((item) => item.ticker === ticker)!.startPrice;
      expect(asset.totalTrades).toBeGreaterThan(0);
      return (asset.frame.last! - open) / open;
    };
    expect(change("ENRG")).toBeGreaterThan(change("AIRX"));
  });
});
