import { describe, expect, it } from "vitest";
import type { Candle } from "@/engine/feed";
import { axisStep, markerCode, MIN_RANGE, priceRange, ZOOM_MS } from "./chart";

const candle = (start: number, low: number, high: number): Candle => ({ start, open: low, high, low, close: high, volume: 100 });

describe("chart helpers (D-079)", () => {
  it("shortens headline codes to at most five characters", () => {
    expect(["FED", "CEO", "BEAT", "DOWNGRADE", "NEWS", "RATES", "SOMETHINGLONG"].map(markerCode)).toEqual(["FED", "CEO", "BEAT", "DNGR", "NEWS", "RATES", "SOME"]);
  });

  it("zooms the price range to the candles of the last two minutes", () => {
    const old = candle(0, 17_600, 18_700); // the crash, three minutes ago
    const recent = [candle(ZOOM_MS + 60_000, 18_090, 18_110), candle(ZOOM_MS + 70_000, 18_095, 18_120)];
    const full = priceRange([old, ...recent], 18_100, false);
    const zoomed = priceRange([old, ...recent], 18_100, true);
    expect(full.lo).toBeLessThan(17_600);
    expect(full.hi).toBeGreaterThan(18_700);
    expect(zoomed.lo).toBeGreaterThan(18_080);
    expect(zoomed.hi).toBeLessThan(18_130);
  });

  it("keeps at least MIN_RANGE cents and always includes the last price", () => {
    const r = priceRange([candle(0, 18_700, 18_700)], 18_700, false);
    expect(r.hi - r.lo).toBeGreaterThanOrEqual(MIN_RANGE);
    const withLast = priceRange([candle(0, 18_700, 18_701)], 18_650, true);
    expect(withLast.lo).toBeLessThan(18_650);
  });

  it("picks a round axis step giving at most about 12 labels", () => {
    expect(axisStep(18_690, 18_710)).toBe(2);
    expect(axisStep(17_600, 18_700)).toBe(100);
    expect((18_710 - 18_690) / axisStep(18_690, 18_710)).toBeLessThanOrEqual(12);
  });
});
