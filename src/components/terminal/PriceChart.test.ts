import { describe, expect, it } from "vitest";
import { createScenarioMarket, FREE_PLAY } from "@/engine/scenarios";
import { MarketFeed } from "@/engine/feed";
import { chartCandles } from "./PriceChart";

const range = (candles: readonly { low: number; high: number }[]) =>
  Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));

describe("GP range after a headline", () => {
  it("keeps the latest candle when its interval is longer than the focus window", () => {
    const candle = { start: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 };
    expect(chartCandles([candle], 60_000, "30s")).toEqual([candle]);
  });

  it.each(["FED", "CEO"])("focuses the real post-%s candles without losing the full history", (code) => {
    const feed = new MarketFeed(createScenarioMarket(FREE_PLAY, 187), 187);
    expect(feed.applyPreset(code).ok).toBe(true);
    feed.advance(900); // 90 seconds after the shock: the initial repricing is outside the 30 s view
    const full = feed.frame().candles;
    const recent = chartCandles(full, feed.candleMs, "30s");

    expect(full.length).toBeGreaterThan(recent.length);
    expect(chartCandles(full, feed.candleMs, "full")).toBe(full);
    expect(recent.length).toBeGreaterThan(1);
    expect(recent.every((c) => full.includes(c))).toBe(true);
    expect(recent.at(-1)).toBe(full.at(-1));
    expect(range(recent)).toBeGreaterThan(0); // real trades still have a visible range
    expect(range(full)).toBeGreaterThan(10 * range(recent));
  });
});
