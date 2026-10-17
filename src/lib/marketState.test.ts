import { describe, expect, it } from "vitest";
import { createDemoMarket, DEMO_SEED } from "@/engine/demoMarket";
import { MarketFeed, type Frame } from "@/engine/feed";
import { applyFrame, MAX_CANDLES, MAX_TAPE, type MarketState } from "./marketState";

/** Fold `n` frames taken every `ticks` ticks, as the page does. */
function fold(n: number, ticks: number, feed = new MarketFeed(createDemoMarket(), DEMO_SEED)) {
  let state: MarketState | null = null;
  for (let i = 0; i < n; i++) {
    feed.advance(ticks);
    state = applyFrame(state, feed.frame());
  }
  return { state: state!, feed };
}

describe("applyFrame: the page's view of the market, folded from frames", () => {
  it("keeps every candle exactly as the engine built it", () => {
    const { state, feed } = fold(200, 3);
    const all = new MarketFeed(createDemoMarket(), DEMO_SEED); // the same market, taken as one frame
    all.advance(600);
    expect(state.candles).toEqual(all.frame().candles);
    expect(state.frame.time).toBe(feed.sim.clock.now);
    expect(state.frameCount).toBe(200);
  });

  it("keeps the newest trades for TAPE, newest first", () => {
    const { state, feed } = fold(300, 2);
    const fills = feed.sim.engine.fills;
    expect(state.tape).toHaveLength(MAX_TAPE);
    expect(state.tape.map((t) => t.seq)).toEqual(fills.slice(-MAX_TAPE).reverse().map((f) => f.seq));
  });

  it("keeps the same tape and candle arrays when a frame brings nothing new", () => {
    const { state, feed } = fold(50, 5);
    const next = applyFrame(state, feed.frame()); // nothing ran since the last frame
    expect(next.tape).toBe(state.tape);
    expect(next.candles).toBe(state.candles);
  });

  it("keeps at most one hour of candles", () => {
    const { state } = fold(40, 1_000); // 66 minutes
    expect(state.candles).toHaveLength(MAX_CANDLES);
    const starts = state.candles.map((c) => c.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("starts from nothing on the first frame", () => {
    const empty: Frame = { ...new MarketFeed(createDemoMarket(), DEMO_SEED).frame() };
    const s = applyFrame(null, empty);
    expect([s.candles, s.tape, s.frameCount]).toEqual([[], [], 1]);
  });
});
