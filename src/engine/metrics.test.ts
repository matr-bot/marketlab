import { describe, expect, it } from "vitest";
import { maxDrawdownOf, PERIODS_PER_YEAR, returnsOf, RISK_FREE_ANNUAL, sharpeOf } from "./metrics";

describe("returns", () => {
  it("are equity changes as a fraction of capital", () => {
    expect(returnsOf([0, 1_000, 500, 500], 100_000)).toEqual([0.01, -0.005, 0]);
    expect(returnsOf([7], 100_000)).toEqual([]);
  });
});

describe("Sharpe (D-063)", () => {
  it("annualizes one-second returns over a 252-session year of 23,400 s", () => {
    expect(PERIODS_PER_YEAR).toBe(5_896_800);
  });

  it("is (mean − rf) ÷ sample sd × √periods, with every part reported", () => {
    // Returns 0.01, −0.005, 0, 0.003: mean 0.002, deviations 0.008, −0.007, −0.002, 0.001,
    // squares sum 0.000118, sample variance 0.000118 ÷ 3.
    const r = sharpeOf([0.01, -0.005, 0, 0.003])!;
    expect(r.n).toBe(4);
    expect(r.mean).toBeCloseTo(0.002, 15);
    expect(r.sd).toBeCloseTo(Math.sqrt(0.000118 / 3), 15);
    expect(r.rfPerPeriod).toBe(RISK_FREE_ANNUAL / 5_896_800);
    expect(r.annualFactor).toBe(Math.sqrt(5_896_800));
    expect(r.sharpe).toBe(((r.mean - r.rfPerPeriod) / r.sd) * r.annualFactor);
    expect(r.sharpe).toBeCloseTo(((0.002 - 0.04 / 5_896_800) / Math.sqrt(0.000118 / 3)) * 2_428.332, 0);
  });

  it("has no value with fewer than two returns or none of them varying", () => {
    expect(sharpeOf([])).toBeNull();
    expect(sharpeOf([0.01])).toBeNull();
    expect(sharpeOf([0, 0, 0])).toBeNull();
  });

  it("is negative when returns average below the risk-free rate", () => {
    expect(sharpeOf([0, 0, 0, 1e-9, -1e-9])!.sharpe).toBeLessThan(0);
  });
});

describe("max drawdown", () => {
  it("is the largest fall from a running peak, in cents and as a fraction of capital", () => {
    // Peaks 1,000 then 1,500; the worst fall is 1,500 → 200.
    expect(maxDrawdownOf([0, 1_000, 400, 1_500, 200, 900], 100_000)).toEqual({ drawdown: 1_300, pct: 0.013, peak: 1_500, trough: 200 });
  });

  it("counts a fall from the first point, is 0 for a rising series and null for none", () => {
    expect(maxDrawdownOf([0, -250], 10_000)).toEqual({ drawdown: 250, pct: 0.025, peak: 0, trough: -250 });
    expect(maxDrawdownOf([0, 1, 2], 10_000)).toEqual({ drawdown: 0, pct: 0, peak: 0, trough: 0 });
    expect(maxDrawdownOf([], 10_000)).toBeNull();
  });
});

describe("edges (from the mutation run)", () => {
  it("two returns are enough for a Sharpe", () => {
    expect(sharpeOf([0.01, 0.02])).not.toBeNull();
  });
});
