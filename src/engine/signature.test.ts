import { describe, expect, it } from "vitest";
import { marketMakers } from "./agents/marketMaker";
import { noiseTraders } from "./agents/noiseTrader";
import { createDemoMarket, demoAgents } from "./demoMarket";
import { presetByCode, PRESETS } from "./presets";
import { IMPACT_HORIZON_MS } from "./simulation";
import { runShockScenario } from "./testing/shockScenario";

// The shock signature (D-047): what each offline headline must do to the demo market, checked on
// the seeds used for tuning (187, 1, 2) and on seeds never used for tuning (3, 4, 5). Whole-market
// runs, so they skip themselves in mutation runs (D-028); the rules they rest on have unit tests.
const MUTATION_RUN = process.env.MARKETLAB_MUTATION === "1";
const IN_SAMPLE = [187, 1, 2];
const OUT_OF_SAMPLE = [3, 4, 5];
const SEEDS = [...IN_SAMPLE, ...OUT_OF_SAMPLE];

type Result = ReturnType<typeof runShockScenario>;
const results = new Map<string, Result>();
const run = (code: string, seed: number): Result => {
  const key = `${code}/${seed}`;
  if (!results.has(key)) results.set(key, runShockScenario(seed, [{ label: code, shock: presetByCode(code)!.shock }]));
  return results.get(key)!;
};

describe.skipIf(MUTATION_RUN)("Shock signature: FED, Fed surprise hike (fair value −3%)", () => {
  it.each(SEEDS)("seed %i: moves 2–5% within 60 s and never more than 5% in 6 minutes", (seed) => {
    const r = run("FED", seed);
    expect(r.move60Pct).toBeLessThanOrEqual(-2);
    expect(r.moveMaxPct).toBeGreaterThanOrEqual(-5);
  });

  it.each(SEEDS)("seed %i: panic cascades only after the news (≥ 3 panic sellers, none before)", (seed) => {
    const r = run("FED", seed);
    expect(r.panicSellsBefore).toBe(0);
    expect(r.panicTradersAfter).toBeGreaterThanOrEqual(3);
  });

  it.each(SEEDS)("seed %i: market makers pull back visibly: spread ≥ 2×, their depth near the mid ≤ half, total depth ≤ 70%", (seed) => {
    const r = run("FED", seed);
    expect(r.spreadAfter).toBeGreaterThanOrEqual(2 * r.spreadBefore);
    expect(r.mmDepth10After).toBeLessThanOrEqual(0.5 * r.mmDepth10Before);
    expect(r.depth10After).toBeLessThanOrEqual(0.7 * r.depth10Before);
  });

  it.each(SEEDS)("seed %i: value traders recover at least half the overshoot past fair value, and the price stays down", (seed) => {
    const r = run("FED", seed);
    if (!Number.isNaN(r.overshootRecovered)) expect(r.overshootRecovered).toBeGreaterThanOrEqual(0.5);
    expect(r.recoveredMidPct).toBeLessThanOrEqual(-1); // the news really lowered value: no full bounce back
    expect(Math.abs(r.endVsFairPct)).toBeLessThan(0.5); // ends near the new fair value
  });
});

describe.skipIf(MUTATION_RUN)("Shock signature: CEO, CEO arrested (fair value −6%)", () => {
  it.each(SEEDS)("seed %i: falls at least 2% within 60 s and never below −15%", (seed) => {
    const r = run("CEO", seed);
    expect(r.move60Pct).toBeLessThanOrEqual(-2);
    expect(r.moveMaxPct).toBeGreaterThanOrEqual(-15);
    expect(r.panicTradersAfter).toBeGreaterThanOrEqual(3);
  });

  it.each(SEEDS)("seed %i: partial recovery: at least half the overshoot, ending near fair value, still below −4%", (seed) => {
    const r = run("CEO", seed);
    if (!Number.isNaN(r.overshootRecovered)) expect(r.overshootRecovered).toBeGreaterThanOrEqual(0.5);
    expect(r.recoveredMidPct).toBeLessThanOrEqual(-4);
    expect(Math.abs(r.endVsFairPct)).toBeLessThan(0.5);
  });
});

describe.skipIf(MUTATION_RUN)("Shock signature: BEAT, earnings beat (fair value +4%)", () => {
  it.each(SEEDS)("seed %i: rises 2–5% within 60 s, with no panic and no overshoot past +5%", (seed) => {
    const r = run("BEAT", seed);
    expect(r.move60Pct).toBeGreaterThanOrEqual(2);
    expect(r.moveMaxPct).toBeLessThanOrEqual(5);
    expect(r.panicSharesAfter).toBe(0);
  });
});

describe.skipIf(MUTATION_RUN)("Shock signature: DOWNGRADE, analyst downgrade (fair value −1%): the teaching contrast", () => {
  it.each(SEEDS)("seed %i: a small shock moves the price down but triggers zero panic sales", (seed) => {
    const r = run("DOWNGRADE", seed);
    expect(r.panicSharesAfter).toBe(0);
    expect(r.moveMaxPct).toBeLessThan(-0.5);
    expect(r.moveMaxPct).toBeGreaterThanOrEqual(-2);
  });
});

describe.skipIf(MUTATION_RUN)("Repeated headlines (D-045)", () => {
  const FED = presetByCode("FED")!.shock;

  it.each(SEEDS)("seed %i: FED ×5 within 30 s stays bounded: never more than 3% past the new fair value", (seed) => {
    const r = runShockScenario(seed, [0, 60, 120, 180, 240].map((atTick) => ({ label: "FED", shock: FED, atTick })), { afterTicks: 6_000 });
    const lowest = Math.min(...r.rows.flatMap((x) => (x.mid === null ? [] : [x.mid])));
    const shocks = r.sim.shocks;
    expect(shocks[4].fairValueAfter / shocks[0].fairValueBefore).toBeCloseTo(0.97 ** 5, 3); // −14.1%: five headlines compound (plus 24 s of drift)
    expect(lowest).toBeGreaterThanOrEqual(r.v1 * 0.97);
    expect(lowest).toBeGreaterThanOrEqual(r.m0 * 0.8);
    expect(Math.abs(r.endVsFairPct)).toBeLessThan(1);
    expect(r.oneSidedTicks / r.rows.length).toBeLessThan(0.05); // the page always has prices to show
  });

  it.each(SEEDS)("seed %i: FED, then FED again 10 minutes later: panic sellers have rebuilt and cascade again", (seed) => {
    const r = runShockScenario(seed, [{ label: "FED", shock: FED, atTick: 0 }, { label: "FED", shock: FED, atTick: 6_000 }], { afterTicks: 9_000 });
    const second = r.sim.shocks[1].time;
    const sellers = new Set(r.sim.engine.fills.filter((f) => f.time >= second && f.sell.agentType === "panic").map((f) => f.sell.ownerId));
    expect(sellers.size).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(MUTATION_RUN)("Value traders pull a displaced price back to fair value (D-044)", () => {
  it("after BEAT, the gap (mid − V) / V decays: AR(1) over 5-second steps ≤ 0.5, pooled over 6 seeds", () => {
    let sxy = 0;
    let sxx = 0;
    for (const seed of SEEDS) {
      const r = run("BEAT", seed);
      const gaps = r.rows.filter((x) => x.time % 5_000 === 0 && x.mid !== null).slice(0, 24).map((x) => (x.mid! - r.v1) / r.v1);
      for (let i = 1; i < gaps.length; i++) {
        sxy += gaps[i - 1] * gaps[i];
        sxx += gaps[i - 1] ** 2;
      }
    }
    expect(sxy / sxx).toBeLessThanOrEqual(0.5); // measured 0.009: the gap closes within one 5 s step
  });
});

describe.skipIf(MUTATION_RUN)("No false panics", () => {
  it.each(SEEDS)("seed %i: a calm hour of the demo market has zero panic sales", (seed) => {
    const sim = createDemoMarket(seed);
    sim.run(36_000);
    expect(sim.engine.fills.filter((f) => f.sell.agentType === "panic")).toHaveLength(0);
  });
});

describe.skipIf(MUTATION_RUN)("First-minute P&L by agent type (D-047, for the narrator)", () => {
  it("is null until 60 s have passed, then fixed; and it sums to zero across types (money only changes hands)", () => {
    const sim = createDemoMarket(187);
    sim.run(6_000);
    sim.applyShock(PRESETS[0].shock, "FED");
    sim.run(IMPACT_HORIZON_MS / 100 - 1);
    expect(sim.shockImpacts[0].pnlByType).toBeNull();
    sim.run(1);
    const pnl = sim.shockImpacts[0].pnlByType!;
    expect(Object.keys(pnl).sort()).toEqual(["marketMaker", "noise", "panic", "value"]);
    expect(Math.abs(Object.values(pnl).reduce((s, x) => s + x!, 0))).toBeLessThanOrEqual(2); // rounding to whole cents per type
    sim.run(600);
    expect(sim.shockImpacts[0].pnlByType).toEqual(pnl);
  });

  it.each(SEEDS)("seed %i: market makers lose money in FED's first minute (adverse selection against informed value traders)", (seed) => {
    expect(run("FED", seed).pnl60.marketMaker).toBeLessThan(0);
  });

  it("measures the same thing in a market with no value traders (no adverse selection source): makers do not lose a fortune", () => {
    const r = runShockScenario(187, [{ label: "FED", shock: PRESETS[0].shock }], { agents: [...noiseTraders(40, 0.5), ...marketMakers()] });
    expect(Math.abs(r.pnl60.marketMaker)).toBeLessThan(Math.abs(run("FED", 187).pnl60.marketMaker));
  });
});

// Keep the demo crowd honest: these signature numbers are about this exact market.
it("the signature runs on the demo crowd", () => {
  expect(demoAgents()).toHaveLength(77);
});
