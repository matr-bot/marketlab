import type { Candle } from "@/engine/feed";

/** The y-axis zoom window (D-079): double-click GP to fit the price axis to the last two minutes. */
export const ZOOM_MS = 120_000;
/** Cents the price axis spans at least, so a quiet market is not blown up to full height. */
export const MIN_RANGE = 10;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];

/** A headline's marker on the chart, at most five characters: FED, CEO, BEAT, DNGR, CPI, NEWS… */
export function markerCode(code: string): string {
  if (code === "DOWNGRADE") return "DNGR";
  return code.length <= 5 ? code : code.slice(0, 4);
}

/**
 * The price axis range in cents, padded 8% each side: the candles shown (or, zoomed, those that
 * started in the last two minutes) and the last price. At least MIN_RANGE cents tall.
 */
export function priceRange(visible: readonly Candle[], last: number | null, zoom: boolean): { lo: number; hi: number } {
  const newest = visible.length > 0 ? visible[visible.length - 1].start : 0;
  const shown = zoom ? visible.filter((c) => c.start > newest - ZOOM_MS) : visible;
  let lo = Math.min(...shown.map((c) => c.low), ...(last === null ? [] : [last]));
  let hi = Math.max(...shown.map((c) => c.high), ...(last === null ? [] : [last]));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: MIN_RANGE };
  if (hi - lo < MIN_RANGE) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_RANGE / 2;
    hi = mid + MIN_RANGE / 2;
  }
  const pad = (hi - lo) * 0.08;
  return { lo: lo - pad, hi: hi + pad };
}

/** The axis step in cents: the round step giving at most `maxTicks` labels (D-079: about 12). */
export function axisStep(lo: number, hi: number, maxTicks = 12): number {
  return STEPS.find((s) => (hi - lo) / s <= maxTicks) ?? STEPS[STEPS.length - 1];
}
