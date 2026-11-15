import { describe, expect, it } from "vitest";
import { makeEconomicRelease, RELEASE_CALIBRATION, releaseLine } from "./economicReleases";
import { presetByCode } from "./presets";
import { MarketFeed } from "./feed";
import { createScenarioMarket, FREE_PLAY } from "./scenarios";

describe("hypothetical economic release calibration", () => {
  it("uses explicit forecasts, surprise scales, directions and sensitivities", () => {
    expect(RELEASE_CALIBRATION).toMatchObject({
      CPI: { typicalSurprise: 0.2, direction: 1, sensitivityBps: 80 },
      JOBS: { typicalSurprise: 50, direction: -1, sensitivityBps: 100 },
      GDP: { typicalSurprise: 0.5, direction: -1, sensitivityBps: 80 },
      RATES: { typicalSurprise: 0.25, direction: 1, sensitivityBps: 150 },
    });
  });

  it("turns CPI 3.4 vs 3.1 into -1.2% with stress scaled by |z|", () => {
    expect(makeEconomicRelease("CPI", 3.4)).toMatchObject({ forecast: 3.1, actual: 3.4, z: 1.5, shock: { fairValuePct: -0.012, panicSensitivity: 1.375, volatilityMultiplier: 1.3, liquidityMultiplier: 0.85 } });
    expect(releaseLine(makeEconomicRelease("CPI"))).toBe("CPI 3.4% vs 3.1% expected → fair value -1.2%");
  });

  it("turns JOBS 150K vs 180K into -0.6%, with no panic below one typical surprise", () => {
    expect(makeEconomicRelease("JOBS", 150)).toMatchObject({ forecast: 180, actual: 150, z: -0.6, shock: { fairValuePct: -0.006, panicSensitivity: 1, volatilityMultiplier: 1.12, liquidityMultiplier: 0.94 } });
    expect(makeEconomicRelease("JOBS", 230).shock.panicSensitivity).toBe(1); // favorable surprise
  });

  it("turns GDP 1.4% vs 2.0% into a -0.96% fair-value change and scaled stress", () => {
    expect(makeEconomicRelease("GDP", 1.4)).toMatchObject({ forecast: 2, actual: 1.4, z: -1.2, shock: { fairValuePct: -0.0096, panicSensitivity: 1.3, volatilityMultiplier: 1.24, liquidityMultiplier: 0.88 } });
  });

  it("makes RATES +0.75 vs +0.25 exactly the existing FED shock", () => {
    expect(makeEconomicRelease("RATES").shock).toEqual({ fairValuePct: -0.03, panicSensitivity: 1.5, durationSec: 300, volatilityMultiplier: 1, liquidityMultiplier: 1 });
    expect(presetByCode("FED")!.shock).toEqual(makeEconomicRelease("RATES").shock);
    expect(presetByCode("FED")!.release).toEqual(makeEconomicRelease("RATES"));
  });

  it("caps z at three and rejects non-finite actuals", () => {
    expect(makeEconomicRelease("CPI", 99).shock.fairValuePct).toBe(-0.024);
    expect(makeEconomicRelease("CPI", -99).shock.fairValuePct).toBe(0.024);
    expect(() => makeEconomicRelease("GDP", Number.NaN)).toThrow(RangeError);
  });

  it("shares FED's digest gate and sends a 30 s reaction from actual executed prices, once", () => {
    const feed = new MarketFeed(createScenarioMarket(FREE_PLAY, 187), 187);
    feed.frame();
    expect(feed.applyRelease("CPI", 3.4)).toMatchObject({ ok: true, code: "CPI", headline: "CPI 3.4% vs 3.1% expected → fair value -1.2%" });
    expect(feed.applyRelease("JOBS", 150)).toMatchObject({ ok: false, message: expect.stringContaining("still digesting") });
    feed.advance(1);
    const first = feed.frame();
    expect(first.headlines).toEqual([expect.objectContaining({ code: "CPI", fairValuePct: -0.012, release: expect.objectContaining({ actual: 3.4 }) })]);
    expect(first.releaseReactions).toEqual([]);
    feed.advance(299);
    const frame = feed.frame();
    const reaction = frame.releaseReactions[0];
    const shock = feed.sim.shocks[0];
    const last = feed.sim.engine.fills.filter((f) => f.time >= shock.time && f.time < shock.time + 30_000).at(-1);
    expect(reaction).toMatchObject({ seq: shock.seq, priceBefore: shock.releaseBasePrice, priceAfter: last?.price ?? null });
    if (last !== undefined && shock.releaseBasePrice !== null) expect(reaction.pricePct).toBe(Math.round(((last.price - shock.releaseBasePrice!) / shock.releaseBasePrice!) * 10_000) / 100);
    expect(reaction.pricePct).toBe(-1.09); // seed 187: the executed price moved less than the -1.2% fair-value jump
    expect(feed.frame().releaseReactions).toEqual([]);
    expect(feed.applyRelease("JOBS", 150)).toMatchObject({ ok: true });
  });

  it("pins a stronger RATES executed-price move for the release card's overshoot label", () => {
    const feed = new MarketFeed(createScenarioMarket(FREE_PLAY, 187), 187);
    feed.frame();
    feed.applyRelease("RATES");
    feed.advance(300);
    expect(feed.frame().releaseReactions[0].pricePct).toBe(-3.02);
  });
});
