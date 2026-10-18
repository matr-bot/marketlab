import { describe, expect, it } from "vitest";
import { formatChange, formatInterval, formatMid, formatPercent, formatPrice, formatQty } from "./format";

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
