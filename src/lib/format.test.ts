import { describe, expect, it } from "vitest";
import { formatAvgPrice, formatBps, formatCentsPerShare, formatChange, formatDollars, formatDollarsX2, formatElapsed, formatInterval, formatMid, formatPercent, formatPrice, formatQty } from "./format";

describe("display formatting: exact cents, never rounded", () => {
  it.each([
    [18_742, "187.42"],
    [18_700, "187.00"],
    [5, "0.05"],
    [0, "0.00"],
    [123_456_789, "1,234,567.89"],
    [-120, "-1.20"],
  ])("formatPrice(%s) = %s", (cents, text) => {
    expect(formatPrice(cents)).toBe(text);
  });

  it("signs changes", () => {
    expect([formatChange(35), formatChange(-120), formatChange(0)]).toEqual(["+0.35", "-1.20", "0.00"]);
  });

  it("formats percent change to two decimals with a sign, and never shows -0.00%", () => {
    expect(formatPercent(35, 18_700)).toBe("+0.19%");
    expect(formatPercent(-120, 18_700)).toBe("-0.64%");
    expect(formatPercent(0, 18_700)).toBe("0.00%");
    expect(formatPercent(-1, 18_700)).toBe("-0.01%"); // -0.0053% rounds to -0.01%
    expect(formatPercent(-1, 1_000_000)).toBe("0.00%"); // -0.0001% rounds to zero: no sign
  });

  it("shows a half-cent mid exactly", () => {
    expect([formatMid(18_699, 18_701), formatMid(18_699, 18_700), formatMid(5, 6)]).toEqual(["187.00", "186.995", "0.055"]);
  });

  it("labels candle intervals", () => {
    expect([formatInterval(10_000), formatInterval(60_000), formatInterval(300_000), formatInterval(90_000), formatInterval(500)]).toEqual(["10S", "1M", "5M", "90S", "0.5S"]);
  });

  it("formats share counts with separators", () => {
    expect([formatQty(1_340), formatQty(1_204_300), formatQty(7)]).toEqual(["1,340", "1,204,300", "7"]);
  });
});

describe("dollars, averages, per-share cost, basis points and elapsed time", () => {
  it("formatDollars: sign, thousands separators, always two decimals", () => {
    expect(formatDollars(1234)).toBe("$12.34");
    expect(formatDollars(-310)).toBe("-$3.10");
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(1234, true)).toBe("+$12.34");
    expect(formatDollars(0, true)).toBe("$0.00");
    expect(formatDollars(-5, true)).toBe("-$0.05");
    expect(formatDollars(123_456_789)).toBe("$1,234,567.89");
  });

  it("formatAvgPrice: an average between cents shows to the cent", () => {
    expect(formatAvgPrice(18_701.3333)).toBe("187.01");
    expect(formatAvgPrice(18_700)).toBe("187.00");
    expect(formatAvgPrice(100_000_000)).toBe("1,000,000.00");
  });

  it("formatCentsPerShare and formatBps: fixed decimals, a dash for unknown, no negative zero", () => {
    expect(formatCentsPerShare(1.3333)).toBe("1.33");
    expect(formatCentsPerShare(-0.5)).toBe("-0.50");
    expect(formatCentsPerShare(-0.001)).toBe("0.00");
    expect(formatCentsPerShare(null)).toBe("—");
    expect(formatBps(0.713)).toBe("0.7");
    expect(formatBps(12)).toBe("12.0");
    expect(formatBps(-0.02)).toBe("0.0");
    expect(formatBps(-3.14)).toBe("-3.1");
    expect(formatBps(null)).toBe("—");
  });

  it("formatElapsed: m:ss", () => {
    expect([0, 5, 65, 600, 3_599.9, -4].map(formatElapsed)).toEqual(["0:00", "0:05", "1:05", "10:00", "59:59", "0:00"]);
  });
});

describe("formatDollarsX2: exact dollars from half-cents", () => {
  it("shows two decimals when whole cents, three when a half cent remains", () => {
    expect(formatDollarsX2(400)).toBe("$2.00");
    expect(formatDollarsX2(401)).toBe("$2.005");
    expect(formatDollarsX2(0)).toBe("$0.00");
    expect(formatDollarsX2(1)).toBe("$0.005");
    expect(formatDollarsX2(-3)).toBe("-$0.015");
    expect(formatDollarsX2(-200)).toBe("-$1.00");
    expect(formatDollarsX2(123_456_789)).toBe("$617,283.945");
  });

  it("parts add up exactly to the whole (no rounding on screen)", () => {
    const parse = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 1000);
    for (const [spread, impact] of [[300, 101], [1, 1], [199, 3], [7, 0]]) {
      expect(parse(formatDollarsX2(spread)) + parse(formatDollarsX2(impact))).toBe(parse(formatDollarsX2(spread + impact)));
    }
  });
});
