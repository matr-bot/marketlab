import { describe, expect, it } from "vitest";
import { computeQuotes, DEFAULT_MM_PARAMS } from "./agents/marketMaker";
import { noiseTraders } from "./agents/noiseTrader";
import { Rng } from "./rng";
import { Simulation } from "./simulation";
import { DEFAULT_VOLATILITY_PARAMS, VolatilityEstimator, type VolatilityParams } from "./volatility";

const P = DEFAULT_VOLATILITY_PARAMS;
const est = (over: Partial<VolatilityParams> = {}) => new VolatilityEstimator({ ...P, ...over });

describe("VolatilityEstimator: the EWMA arithmetic", () => {
  it("starts at sigma0 for both speeds and is not ready", () => {
    const e = est();
    expect([e.view.fast, e.view.slow, e.view.sigma, e.view.samples, e.view.ready]).toEqual([4.3e-5, 4.3e-5, 4.3e-5, 0, false]);
  });

  it("folds one return in exactly: v = λ·v + (1 − λ)·r²/Δt, λ = 2^(−Δt/H)", () => {
    const e = est({ sigma0: 1e-4 });
    e.sample(5_000, 200_000_000);
    e.sample(10_000, 200_020_000); // r = ln(1.0001)
    const r = Math.log(200_020_000 / 200_000_000);
    const perSec = (r * r) / 5;
    const lf = Math.pow(0.5, 5 / 30);
    const ls = Math.pow(0.5, 5 / 120);
    expect(e.view.fast).toBeCloseTo(Math.sqrt(lf * 1e-8 + (1 - lf) * perSec), 15);
    expect(e.view.slow).toBeCloseTo(Math.sqrt(ls * 1e-8 + (1 - ls) * perSec), 15);
    expect(e.view.samples).toBe(1); // the first sample only sets the baseline
    expect(e.view.sigma).toBe(Math.max(e.view.fast, e.view.slow));
  });

  it("decays to half its variance after one half-life of a constant mid", () => {
    const e = est({ sigma0: 1e-4 });
    for (let t = 0; t <= 120_000; t += 5_000) e.sample(t, 37_400);
    // 30 s half-life → after 120 s the fast variance is 1/16 of the start; slow is 1/2.
    expect(e.view.fast ** 2 / 1e-8).toBeCloseTo(1 / 16, 10);
    expect(e.view.slow ** 2 / 1e-8).toBeCloseTo(1 / 2, 10);
  });

  it("skips a sample when a side is empty, then scales the next return by the real gap (D-032)", () => {
    const withGap = est();
    const direct = est();
    withGap.sample(5_000, 37_400);
    withGap.sample(10_000, null); // book one-sided: skipped
    withGap.sample(15_000, 37_420);
    direct.sample(5_000, 37_400);
    direct.sample(15_000, 37_420);
    expect([withGap.view.fast, withGap.view.slow, withGap.view.samples]).toEqual([direct.view.fast, direct.view.slow, direct.view.samples]);
  });

  it("ignores a second sample at the same time instead of dividing by zero elapsed time", () => {
    const e = est();
    e.sample(5_000, 37_400);
    e.sample(5_000, 37_500);
    expect([e.view.fast, e.view.slow, e.view.samples]).toEqual([P.sigma0, P.sigma0, 0]);
  });

  it("becomes ready after the warm-up count and its view is read-only but live", () => {
    const e = est({ warmupSamples: 3 });
    for (let i = 1; i <= 3; i++) e.sample(i * 5_000, 37_400 + i);
    expect(e.view.ready).toBe(false); // 3 samples = 2 returns
    e.sample(20_000, 37_400);
    expect(e.view.ready).toBe(true);
    expect(Object.isFrozen(e.view)).toBe(true);
  });

  it("knows its sampling grid", () => {
    const e = est();
    expect([e.isSampleTime(5_000), e.isSampleTime(10_000), e.isSampleTime(5_100), e.isSampleTime(0)]).toEqual([true, true, false, true]);
  });

  it("rejects bad input", () => {
    expect(() => est({ sampleMs: 150 })).toThrow("sampleMs must be a positive multiple of 100, got 150");
    expect(() => est({ sampleMs: 0 })).toThrow(/sampleMs must be/);
    expect(() => est({ fastHalfLifeSec: 0 })).toThrow("fastHalfLifeSec must be a positive finite number, got 0");
    expect(() => est({ slowHalfLifeSec: Infinity })).toThrow(/slowHalfLifeSec must be/);
    expect(() => est({ sigma0: -1 })).toThrow(/sigma0 must be/);
    expect(() => est({ warmupSamples: 1.5 })).toThrow("warmupSamples must be a non-negative integer, got 1.5");
    expect(() => est({ warmupSamples: -1 })).toThrow("warmupSamples must be a non-negative integer, got -1");
    expect(est({ warmupSamples: 0 }).view.ready).toBe(true); // zero warm-up is allowed: ready at once
    const e = est();
    e.sample(10_000, 37_400);
    expect(() => e.sample(5_000, 37_400)).toThrow(/non-decreasing/);
    expect(() => e.sample(15_000, 0)).toThrow("midX2 must be a positive integer, got 0");
    expect(() => e.sample(15_000, 374.5)).toThrow(/midX2 must be a positive integer/);
  });
});

describe("VolatilityEstimator: recovers a known volatility", () => {
  it("averages to the true σ of a random walk within 3% (both speeds)", () => {
    // Log mid follows a random walk with σ = 5e-5 per √s, sampled every 5 s. Mids are large
    // integers so rounding is negligible. EWMA variance is unbiased, so its time average is σ².
    const sigma = 5e-5;
    const rng = Rng.fromSeed(11);
    const e = est();
    let logMid = Math.log(2e9);
    let sumFast = 0;
    let sumSlow = 0;
    let n = 0;
    for (let i = 1; i <= 20_000; i++) {
      logMid += sigma * Math.sqrt(5) * rng.normal();
      e.sample(i * 5_000, Math.round(Math.exp(logMid)));
      if (i > 200) {
        sumFast += e.view.fast ** 2;
        sumSlow += e.view.slow ** 2;
        n++;
      }
    }
    expect(Math.abs(Math.sqrt(sumFast / n) / sigma - 1)).toBeLessThan(0.03);
    expect(Math.abs(Math.sqrt(sumSlow / n) / sigma - 1)).toBeLessThan(0.03);
  });
});

describe("Shock response: a sudden 4× volatility regime (Step 4+5 change 1)", () => {
  /**
   * Feed a calm regime (σ = σ₀) then switch to 4σ₀, using a mid that steps up and down by a fixed
   * amount so every return has exactly the regime's size. Returns the seconds until the market
   * maker's spread is at least double the calm one: either the exact formula spread δ, or the
   * quoted spread (ask − bid after rounding to whole cents away from the market).
   */
  function secondsToDouble(pickSigma: (e: VolatilityEstimator) => number, metric: "formula" | "quoted"): number {
    const sigma0 = DEFAULT_VOLATILITY_PARAMS.sigma0;
    const e = est();
    let t = 0;
    let up = false;
    const feed = (sigma: number) => {
      const step = sigma * Math.sqrt(5);
      t += 5_000;
      up = !up;
      e.sample(t, Math.round(2e9 * Math.exp(up ? step / 2 : -step / 2)));
    };
    for (let i = 0; i < 200; i++) feed(sigma0); // calm, long enough to settle
    const spread = () => {
      // k = 1, the value these response times were measured with (D-031).
      const q = computeQuotes({ ...DEFAULT_MM_PARAMS, k: 1 }, { mid: 18_700, sigma: pickSigma(e), position: 0, othersBestBid: null, othersBestAsk: null, tick: 1 });
      return metric === "formula" ? q.spread : q.ask!.price - q.bid!.price;
    };
    const calm = spread();
    const shockStart = t;
    for (let i = 0; i < 300; i++) {
      feed(4 * sigma0);
      if (spread() >= 2 * calm) return (t - shockStart) / 1000;
    }
    return Infinity;
  }

  const maxFast = (e: VolatilityEstimator) => e.view.sigma; // what the market maker uses
  const slowOnly = (e: VolatilityEstimator) => e.view.slow;

  it("doubles the formula spread within 30 s and the quoted spread within 50 s using max(fast, slow)", () => {
    expect(secondsToDouble(maxFast, "formula")).toBeLessThanOrEqual(30);
    expect(secondsToDouble(maxFast, "quoted")).toBeLessThanOrEqual(50);
  });

  it("is about 3× faster than the slow average alone", () => {
    expect(secondsToDouble(slowOnly, "formula")).toBeGreaterThanOrEqual(3 * secondsToDouble(maxFast, "formula"));
    expect(secondsToDouble(slowOnly, "quoted")).toBeGreaterThanOrEqual(3 * secondsToDouble(maxFast, "quoted"));
  });

  it("pins the measured response times (recorded in D-031)", () => {
    expect({
      formula: { maxFastSlow: secondsToDouble(maxFast, "formula"), slowOnly: secondsToDouble(slowOnly, "formula") },
      quoted: { maxFastSlow: secondsToDouble(maxFast, "quoted"), slowOnly: secondsToDouble(slowOnly, "quoted") },
    }).toEqual({ formula: { maxFastSlow: 30, slowOnly: 95 }, quoted: { maxFastSlow: 50, slowOnly: 175 } });
  });
});

describe("VolatilityEstimator inside the simulation", () => {
  it("samples exactly on the 5-second grid from the live mid", () => {
    const samples: number[] = [];
    const sim = new Simulation({ seed: 187, agents: noiseTraders(40, 0.5) });
    const original = sim.volatility.sample.bind(sim.volatility);
    sim.volatility.sample = (t, m) => {
      samples.push(t);
      original(t, m);
    };
    sim.run(6_000); // 10 minutes
    expect(samples).toEqual(Array.from({ length: 120 }, (_, i) => (i + 1) * 5_000));
    expect(sim.volatility.view.samples).toBeGreaterThan(100);
  });

  it("is ready at 125 s on the live market: one baseline sample at 5 s, then 24 returns (D-032, Codex review)", () => {
    const sim = new Simulation({ seed: 187, agents: noiseTraders(40, 0.5) });
    let end = 0;
    while (!sim.volatility.view.ready) end = sim.step().end;
    expect(end).toBe(125_000);
    expect(sim.volatility.view.samples).toBe(24);
  });

  it("measures the mid, which is calmer than trade prices (bid-ask bounce, D-029)", () => {
    const trades: number[] = [];
    const sim = new Simulation({ seed: 187, agents: noiseTraders(40, 0.5), observer: { onSubmit: (_a, _o, r) => r.ok && r.fills.forEach((f) => trades.push(f.price)) } });
    sim.run(36_000);
    let rv = 0;
    let lag = 0;
    let prev = 0;
    for (let i = 1; i < trades.length; i++) {
      const r = Math.log(trades[i] / trades[i - 1]);
      rv += r * r;
      lag += r * prev;
      prev = r;
    }
    const tradeSigmaPerSec = Math.sqrt(rv / 3_600);
    expect(lag / rv).toBeLessThan(-0.1); // trades bounce between bid and ask
    expect(tradeSigmaPerSec).toBeGreaterThan(1.5 * sim.volatility.view.slow);
  });
});
