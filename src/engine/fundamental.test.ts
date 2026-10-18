import { describe, expect, it } from "vitest";
import { noiseTraders } from "./agents/noiseTrader";
import { clampShock, DEFAULT_FUNDAMENTAL_PARAMS, Fundamental, MidHistory, type ShockParams } from "./fundamental";
import { Rng } from "./rng";
import { Simulation } from "./simulation";

const FED: ShockParams = { fairValuePct: -0.03, panicSensitivity: 1.5, durationSec: 300 };
const quiet = (start = 18_700) => new Fundamental(Rng.fromSeed(1).stream("fundamental"), start, { ...DEFAULT_FUNDAMENTAL_PARAMS, sigmaV: 0 });

describe("Fundamental: fair value V (D-043)", () => {
  it("starts at the opening price and, with no volatility, only moves on shocks", () => {
    const f = quiet();
    for (let t = 100; t <= 60_000; t += 100) f.onTickEnd(t);
    expect(f.value).toBeCloseTo(18_700, 9);
    f.shock(FED, 60_000);
    expect(f.value).toBeCloseTo(18_700 * 0.97, 8); // −3%: 181.39
  });

  it("compounds repeated shocks: each headline is new news", () => {
    const f = quiet();
    for (let i = 0; i < 5; i++) f.shock(FED, i * 1_000);
    expect(f.value).toBeCloseTo(18_700 * 0.97 ** 5, 6); // −14.1%
  });

  it("never leaves [start / 5, start × 5]", () => {
    const f = quiet();
    for (let i = 0; i < 100; i++) f.shock({ ...FED, fairValuePct: -0.2 }, i);
    expect(f.value).toBeCloseTo(18_700 / 5, 6);
    for (let i = 0; i < 200; i++) f.shock({ ...FED, fairValuePct: 0.2 }, i);
    expect(f.value).toBeCloseTo(18_700 * 5, 4);
  });

  it("random-walks at sigmaV per √s, stepping once per second on the tick grid", () => {
    const f = new Fundamental(Rng.fromSeed(7).stream("fundamental"), 18_700);
    const logs: number[] = [Math.log(f.value)];
    for (let t = 100; t <= 3_600_000; t += 100) {
      const before = f.value;
      f.onTickEnd(t);
      if (t % 1_000 !== 0) expect(f.value).toBe(before); // only on whole seconds
      else logs.push(Math.log(f.value));
    }
    const r = logs.slice(1).map((x, i) => x - logs[i]);
    const sd = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length);
    expect(sd).toBeGreaterThan(2.0e-5 * 0.97); // 3,600 one-second steps: ±1.2% standard error
    expect(sd).toBeLessThan(2.0e-5 * 1.03);
  });

  it("scales the step by √(step / 1 s): a 4-second step has twice the 1-second spread", () => {
    const f = new Fundamental(Rng.fromSeed(8).stream("fundamental"), 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, stepMs: 4_000 });
    const logs = [Math.log(f.value)];
    for (let t = 4_000; t <= 4_000 * 3_000; t += 4_000) {
      f.onTickEnd(t);
      logs.push(Math.log(f.value));
    }
    const r = logs.slice(1).map((x, i) => x - logs[i]);
    const sd = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length);
    expect(sd).toBeGreaterThan(4.0e-5 * 0.95);
    expect(sd).toBeLessThan(4.0e-5 * 1.05);
  });

  it("sets panic sensitivity for the shock's duration, then returns to 1", () => {
    const f = quiet();
    f.shock(FED, 10_000);
    expect([f.sensitivityAt(9_999), f.sensitivityAt(10_000), f.sensitivityAt(309_999), f.sensitivityAt(310_000)]).toEqual([1, 1.5, 1.5, 1]);
  });

  it("overlapping shocks: sensitivity is the larger one, the window runs to the later end (no runaway)", () => {
    const f = quiet();
    f.shock({ ...FED, panicSensitivity: 2, durationSec: 300 }, 0); // until 300 s
    f.shock({ ...FED, panicSensitivity: 1.5, durationSec: 60 }, 100_000); // ends earlier, smaller s
    expect([f.sensitivityAt(150_000), f.sensitivityAt(299_999), f.sensitivityAt(300_000)]).toEqual([2, 2, 1]);
    f.shock({ ...FED, panicSensitivity: 1.5, durationSec: 300 }, 200_000); // ends later: extends
    expect([f.sensitivityAt(400_000), f.sensitivityAt(499_999), f.sensitivityAt(500_000)]).toEqual([2, 2, 1]);
    for (let i = 0; i < 10; i++) f.shock({ ...FED, panicSensitivity: 3 }, 600_000 + i);
    expect(f.sensitivityAt(600_100)).toBe(3); // never more than the largest single shock (clamped at 3)
  });

  it("a shock exactly when the previous window ends starts fresh; an overlapping one keeps the original start", () => {
    const f = quiet();
    f.shock({ ...FED, panicSensitivity: 3, durationSec: 10 }, 0); // until 10 s
    f.shock({ ...FED, panicSensitivity: 0.5, durationSec: 10 }, 10_000); // exactly at the end: fresh
    expect(f.sensitivityAt(15_000)).toBe(0.5);
    const g = quiet();
    g.shock({ ...FED, durationSec: 300 }, 0);
    g.shock({ ...FED, durationSec: 300 }, 100_000);
    expect(g.sensitivityAt(50_000)).toBe(1.5); // still active between the two headlines
  });

  it("a shock after the previous one has ended starts fresh", () => {
    const f = quiet();
    f.shock({ ...FED, panicSensitivity: 3, durationSec: 10 }, 0);
    f.shock({ ...FED, panicSensitivity: 0.5, durationSec: 10 }, 20_000);
    expect(f.sensitivityAt(25_000)).toBe(0.5);
  });

  it("clamps any shock into sensible ranges and rejects non-numbers", () => {
    expect(clampShock({ fairValuePct: -0.9, panicSensitivity: 10, durationSec: 1 })).toEqual({ fairValuePct: -0.2, panicSensitivity: 3, durationSec: 10 });
    expect(clampShock({ fairValuePct: 0.5, panicSensitivity: 0, durationSec: 99_999 })).toEqual({ fairValuePct: 0.2, panicSensitivity: 0.5, durationSec: 1_800 });
    expect(clampShock(FED)).toEqual(FED);
    expect(() => clampShock({ ...FED, fairValuePct: NaN })).toThrow("shock fairValuePct must be a finite number, got NaN");
    expect(() => clampShock({ ...FED, durationSec: Infinity })).toThrow(/durationSec/);
  });

  it("rejects bad parameters", () => {
    const rng = Rng.fromSeed(1);
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, sigmaV: -1 })).toThrow("sigmaV must be a non-negative finite number, got -1");
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, stepMs: 150 })).toThrow("stepMs must be a positive multiple of 100, got 150");
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, stepMs: 0 })).toThrow("stepMs must be a positive multiple of 100, got 0");
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, stepMs: -100 })).toThrow(/stepMs must be/);
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, stepMs: 100.5 })).toThrow(/stepMs must be/);
    expect(() => new Fundamental(rng, 18_700, { ...DEFAULT_FUNDAMENTAL_PARAMS, bound: 1 })).toThrow("bound must be a finite number above 1, got 1");
  });
});

describe("MidHistory: the mid once per second", () => {
  it("samples on whole seconds only, skips a one-sided book, and answers the highest mid since a time", () => {
    const h = new MidHistory();
    h.onTickEnd(500, 37_400); // not a whole second
    h.onTickEnd(1_000, 37_400); // 187.00
    h.onTickEnd(2_000, null); // one-sided: skipped
    h.onTickEnd(3_000, 37_450); // 187.25
    h.onTickEnd(4_000, 37_380); // 186.90
    expect([h.maxSince(0), h.maxSince(3_500), h.maxSince(4_000), h.maxSince(4_001)]).toEqual([18_725, 18_690, 18_690, null]);
  });

  it("has nothing to say when every sample was one-sided", () => {
    const h = new MidHistory();
    h.onTickEnd(1_000, null);
    h.onTickEnd(2_000, null);
    expect(h.maxSince(0)).toBeNull();
  });

  it("holds exactly `capacity` samples, oldest included", () => {
    const h = new MidHistory(3);
    [37_600, 37_400, 37_400].forEach((m, i) => h.onTickEnd((i + 1) * 1_000, m));
    expect(h.maxSince(0)).toBe(18_800);
    expect(() => new MidHistory(1)).not.toThrow();
  });

  it("includes the oldest sample it still holds", () => {
    const h = new MidHistory();
    h.onTickEnd(1_000, 37_500);
    expect(h.maxSince(0)).toBe(18_750);
    h.onTickEnd(2_000, 37_400);
    expect(h.maxSince(0)).toBe(18_750); // the oldest is the highest
  });

  it("keeps only the last `capacity` samples", () => {
    const h = new MidHistory(3);
    [1, 2, 3, 4].forEach((s) => h.onTickEnd(s * 1_000, 37_400 + (s === 1 ? 1_000 : 0)));
    expect(h.maxSince(0)).toBe(18_700); // the 1-second spike has rolled off
    expect(() => new MidHistory(0)).toThrow("capacity must be a positive integer, got 0");
  });
});

describe("Shocks inside the simulation", () => {
  const sim = () => new Simulation({ seed: 187, agents: noiseTraders(40, 0.5) });

  it("applies a queued shock at the start of the next tick and logs it", () => {
    const s = sim();
    s.run(50);
    const before = s.fundamental.value;
    s.applyShock(FED, "FED");
    expect(s.shocks).toEqual([]); // queued, not applied yet
    s.step();
    expect(s.shocks).toEqual([{ time: 5_000, label: "FED", shock: FED, fairValueBefore: before, fairValueAfter: s.fundamental.value }]);
    expect(s.fundamental.value / before).toBeCloseTo(0.97, 9);
    expect(Object.isFrozen(s.shocks[0])).toBe(true);
  });

  it("walks fair value as the simulation runs, and skips one-sided books in the mid history", () => {
    const s = new Simulation({ seed: 5, agents: [] }); // no agents: the book stays empty
    s.run(600);
    expect(s.fundamental.value).not.toBe(18_700);
    expect(Math.abs(s.fundamental.value / 18_700 - 1)).toBeLessThan(0.01);
    expect(s.midHistory.maxSince(0)).toBeNull();
    const bidsOnly = new Simulation({
      seed: 5,
      agents: [{ id: "b", agentType: "user", ratePerSec: 5, create: () => ({ act: (ctx) => void (ctx.myOrders().length === 0 && ctx.submit({ type: "limit", side: "buy", price: 18_650, qty: 100 })) }) }],
    });
    bidsOnly.run(100);
    expect(bidsOnly.engine.book.bestBid()).toBe(18_650);
    expect(bidsOnly.midHistory.maxSince(0)).toBeNull(); // a bid alone is not a mid
    const asksOnly = new Simulation({
      seed: 5,
      agents: [{ id: "a", agentType: "user", ratePerSec: 5, create: () => ({ act: (ctx) => void (ctx.myOrders().length === 0 && ctx.submit({ type: "limit", side: "sell", price: 18_750, qty: 100 })) }) }],
    });
    asksOnly.run(100);
    expect(asksOnly.midHistory.maxSince(0)).toBeNull(); // nor an ask alone
  });

  it("gives agents fair value, sensitivity and the mid history", () => {
    const seen: Array<[number, number, number | null]> = [];
    const s = new Simulation({
      seed: 3,
      agents: [
        ...noiseTraders(10, 0.5),
        { id: "probe", agentType: "user", ratePerSec: 2, create: () => ({ act: (ctx) => void seen.push([ctx.fairValue, ctx.panicSensitivity, ctx.maxMidSince(ctx.time - 10_000)]) }) },
      ],
      fundamental: { ...DEFAULT_FUNDAMENTAL_PARAMS, sigmaV: 0 },
    });
    s.run(300);
    s.applyShock(FED, "FED");
    s.run(100);
    const after = seen.filter(([v]) => v < 18_500); // after the shock (before it, V is 18,700 up to rounding)
    expect(after.length).toBeGreaterThan(5);
    expect(after.every(([v, sens]) => Math.abs(v - 18_139) < 1 && sens === 1.5)).toBe(true);
    expect(seen.some(([, , m]) => m !== null && m > 18_000)).toBe(true);
  });

  it("the same seed and the same shocks at the same ticks give the identical market", () => {
    const run = () => {
      const s = sim();
      s.run(300);
      s.applyShock(FED, "FED");
      s.run(300);
      return JSON.stringify(s.engine.fills);
    };
    expect(run()).toBe(run());
  });
});
