import { describe, expect, it } from "vitest";
import { highestPrice, toTick } from "./price";

describe("toTick: the only place a computed price becomes whole cents (D-027)", () => {
  it.each([
    [18_699.5, 1, "down", 18_699],
    [18_699.5, 1, "up", 18_700],
    [18_700, 1, "down", 18_700], // already on the grid: unchanged either way
    [18_700, 1, "up", 18_700],
    [18_703.2, 5, "down", 18_700],
    [18_703.2, 5, "up", 18_705],
    [-12, 1, "down", 1], // never below one tick
    [0.2, 5, "up", 5],
    [1e12, 1, "up", 100_000_000], // never above the price cap
    [1e12, 7, "down", 99_999_998], // the highest tick at or below the cap
  ] as const)("toTick(%s, %s, %s) = %s", (x, tick, dir, expected) => {
    expect(toTick(x, tick, dir)).toBe(expected);
  });

  it("buys never round up and sells never round down, and every result is whole cents on the grid", () => {
    for (let i = 0; i < 20_000; i++) {
      const x = 18_000 + i * 0.137;
      for (const tick of [1, 5]) {
        const down = toTick(x, tick, "down");
        const up = toTick(x, tick, "up");
        expect(down).toBeLessThanOrEqual(x);
        expect(up).toBeGreaterThanOrEqual(x);
        expect(up - down).toBeLessThanOrEqual(tick);
        expect(Number.isSafeInteger(down) && down % tick === 0 && Number.isSafeInteger(up) && up % tick === 0).toBe(true);
      }
    }
  });

  it.each([NaN, Infinity, -Infinity])("throws for a non-finite price %s", (x) => {
    expect(() => toTick(x, 1, "down")).toThrow(`toTick needs a finite price, got ${x}`);
  });

  it.each([0, -1, 1.5])("throws for a bad tick %s", (tick) => {
    expect(() => toTick(100, tick, "down")).toThrow(`tick must be a positive integer number of cents, got ${tick}`);
  });

  it("throws for a tick larger than the price cap instead of returning 0 (Codex review)", () => {
    expect(() => toTick(100, 100_000_001, "down")).toThrow("tick 100000001 is larger than the maximum price 100000000");
    expect(toTick(5e7, 100_000_000, "down")).toBe(100_000_000); // a tick exactly at the cap still works: one valid price
  });

  it("throws for a bad direction", () => {
    expect(() => toTick(100, 1, "sideways" as "up")).toThrow('direction must be "down" or "up", got sideways');
  });
});

describe("highestPrice: the top of the legal range on a tick grid", () => {
  it.each([
    [1, 100_000_000],
    [7, 99_999_998],
    [100_000_000, 100_000_000],
  ])("highestPrice(%s) = %s", (tick, expected) => {
    expect(highestPrice(tick)).toBe(expected);
  });
});
