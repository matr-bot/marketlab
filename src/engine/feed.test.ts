import { describe, expect, it } from "vitest";
import { createDemoMarket, DEMO_SEED, WARMUP_TICKS } from "./demoMarket";
import { MarketFeed, TickPacer, type Candle, type Frame, type FrameTrade } from "./feed";
import type { Fill } from "./matchingEngine";
import { Rng } from "./rng";
import { fingerprint } from "./testing/fingerprint";

const feedOf = (seed = DEMO_SEED, options = {}) => new MarketFeed(createDemoMarket(seed), seed, options);

/** Recompute candles straight from the fill log, the slow obvious way. */
function candlesFromFills(fills: readonly Fill[], candleMs: number): Candle[] {
  const byStart = new Map<number, Fill[]>();
  for (const f of fills) {
    const start = Math.floor(f.time / candleMs) * candleMs;
    byStart.set(start, [...(byStart.get(start) ?? []), f]);
  }
  return [...byStart.entries()].map(([start, fs]) => ({
    start,
    open: fs[0].price,
    high: Math.max(...fs.map((f) => f.price)),
    low: Math.min(...fs.map((f) => f.price)),
    close: fs[fs.length - 1].price,
    volume: fs.reduce((s, f) => s + f.qty, 0),
  }));
}

/** Merge per-frame candle updates the way the page does: a later version of a candle replaces the earlier one. */
function mergeCandles(frames: readonly Frame[]): Candle[] {
  const byStart = new Map<number, Candle>();
  for (const fr of frames) for (const c of fr.candles) byStart.set(c.start, c);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

describe("createDemoMarket: what every page load opens on", () => {
  it("is MLAB from $187.00 with 40 noise traders and two market makers, seed 187, warmed up 10 minutes", () => {
    const sim = createDemoMarket();
    expect([DEMO_SEED, WARMUP_TICKS, sim.engine.ticker, sim.startPrice]).toEqual([187, 6_000, "MLAB", 18_700]);
    sim.run(WARMUP_TICKS);
    expect(sim.engine.fillCount).toBeGreaterThan(1_000);
    expect(sim.volatility.view.ready).toBe(true); // ready at 125 s, long before the page opens
    expect(new Set(sim.engine.fills.flatMap((f) => [f.buy.agentType, f.sell.agentType]))).toEqual(new Set(["noise", "marketMaker"]));
  });
});

describe("MarketFeed: one coalesced frame per request (D-037)", () => {
  it("every fill reaches exactly one frame, in order, with its exact price and size", () => {
    const feed = feedOf();
    const frames: Frame[] = [];
    for (let i = 0; i < 300; i++) {
      feed.advance(i % 7); // uneven: 0 to 6 ticks between frames
      frames.push(feed.frame());
    }
    const sent = frames.flatMap((f) => f.trades);
    const fills = feed.sim.engine.fills;
    expect(fills.length).toBeGreaterThan(100);
    expect(frames.every((f) => f.droppedTrades === 0)).toBe(true);
    expect(sent.map((t) => [t.seq, t.time, t.price, t.qty, t.aggressor])).toEqual(fills.map((f) => [f.seq, f.time, f.price, f.qty, f.aggressor]));
  });

  it("builds candles that match a recomputation from the fill log", () => {
    const feed = feedOf();
    const frames: Frame[] = [];
    for (let i = 0; i < 400; i++) {
      feed.advance(3);
      frames.push(feed.frame());
    }
    const expected = candlesFromFills(feed.sim.engine.fills, 10_000);
    expect(expected.length).toBeGreaterThanOrEqual(12);
    expect(mergeCandles(frames)).toEqual(expected);
  });

  it("sends only the candles that changed: none when nothing traded, the open one while it fills", () => {
    const feed = feedOf();
    feed.advance(600);
    const first = feed.frame();
    expect(first.candles.map((c) => c.start)).toEqual(candlesFromFills(feed.sim.engine.fills, 10_000).map((c) => c.start));
    expect(feed.frame().candles).toEqual([]); // nothing ran
    expect(feed.frame().trades).toEqual([]);
    feed.advance(5);
    const next = feed.frame();
    expect(next.candles.length).toBeLessThanOrEqual(2);
    if (next.trades.length > 0) expect(next.candles[next.candles.length - 1].close).toBe(next.trades[next.trades.length - 1].price);
  });

  it("reports the status bar's numbers from engine state", () => {
    const feed = feedOf();
    feed.advance(1_200);
    const f = feed.frame();
    const fills = feed.sim.engine.fills;
    const book = feed.sim.engine.book;
    expect(f).toMatchObject({ seed: 187, ticker: "MLAB", time: 120_000, open: 18_700, agents: 42, candleMs: 10_000 });
    expect(f.last).toBe(fills[fills.length - 1].price);
    expect(f.volume).toBe(fills.reduce((s, x) => s + x.qty, 0));
    expect([f.bid, f.ask]).toEqual([book.bestBid(), book.bestAsk()]);
    expect(f.bids).toEqual(book.depth("buy", 40));
    expect(f.asks).toEqual(book.depth("sell", 40));
    expect(f.bids.length).toBeLessThanOrEqual(40);
    expect(book.depth("buy").length).toBeGreaterThan(f.bids.length - 1); // never more than the book has
  });

  it("marks each trade up or down vs the previous trade, and an unchanged price keeps the last direction", () => {
    const feed = feedOf();
    feed.advance(3_000);
    const trades = feed.frame().trades;
    expect(trades.length).toBeGreaterThan(100);
    let dir: FrameTrade["tick"] = "up";
    for (let i = 1; i < trades.length; i++) {
      if (trades[i].price !== trades[i - 1].price) dir = trades[i].price > trades[i - 1].price ? "up" : "down";
      expect(trades[i].tick, `trade ${i}`).toBe(dir);
    }
    expect(new Set(trades.map((t) => t.tick))).toEqual(new Set(["up", "down"]));
    const fresh = feedOf();
    do fresh.advance(1);
    while (fresh.sim.engine.fillCount === 0);
    const first = fresh.frame().trades[0];
    expect([first.seq, first.tick]).toEqual([0, "up"]); // the session's first trade has no previous trade
  });

  it("caps the trades in one frame, keeping the newest and counting the rest", () => {
    const feed = feedOf(DEMO_SEED, { maxTradesPerFrame: 50 });
    feed.advance(600);
    const total = feed.sim.engine.fillCount;
    const f = feed.frame();
    expect(f.trades).toHaveLength(50);
    expect(f.droppedTrades).toBe(total - 50);
    expect(f.trades[49].seq).toBe(total - 1);
    expect(f.volume).toBe(feed.sim.engine.fills.reduce((s, x) => s + x.qty, 0)); // volume still counts every trade
    expect(feed.frame()).toMatchObject({ trades: [], droppedTrades: 0 });
  });

  it("picks up fills that happened before the feed was created", () => {
    const sim = createDemoMarket();
    sim.run(100);
    const f = new MarketFeed(sim, DEMO_SEED).frame();
    expect(sim.engine.fillCount).toBeGreaterThan(0);
    expect(f.trades.map((t) => t.seq)).toEqual(sim.engine.fills.map((x) => x.seq));
  });

  it("accepts the smallest valid options", () => {
    const feed = new MarketFeed(createDemoMarket(), 1, { depthLevels: 1, maxTradesPerFrame: 0 });
    feed.advance(300);
    const f = feed.frame();
    expect([f.bids.length, f.asks.length, f.trades.length]).toEqual([1, 1, 0]);
    expect(f.droppedTrades).toBe(feed.sim.engine.fillCount);
  });

  it("keeps its backlog bounded when frames are not taken for a long time", () => {
    const feed = feedOf(DEMO_SEED, { maxTradesPerFrame: 20 });
    for (let i = 0; i < 100; i++) feed.advance(60);
    const f = feed.frame();
    expect(f.trades.length).toBe(20);
    expect(f.droppedTrades + f.trades.length).toBe(feed.sim.engine.fillCount);
  });

  it("frames are copies: editing a sent candle cannot change the feed's own", () => {
    const feed = feedOf();
    feed.advance(305); // 30.5 s: the open candle is 30–40 s
    const sent = feed.frame().candles;
    (sent[sent.length - 1] as { volume: number }).volume = -1;
    let next: Frame;
    do {
      feed.advance(1);
      next = feed.frame();
    } while (next.trades.length === 0); // trade again inside the same candle
    expect(feed.sim.clock.now).toBeLessThan(40_000);
    const open = next.candles[next.candles.length - 1];
    expect(open).toEqual(candlesFromFills(feed.sim.engine.fills, 10_000).at(-1));
    expect(open.volume).toBeGreaterThan(0);
  });

  it("rejects bad options", () => {
    const sim = createDemoMarket();
    expect(() => new MarketFeed(sim, 1, { candleMs: 150 })).toThrow("candleMs must be a positive multiple of 100, got 150");
    expect(() => new MarketFeed(sim, 1, { candleMs: 0 })).toThrow(/candleMs must be/);
    expect(() => new MarketFeed(sim, 1, { depthLevels: 0 })).toThrow("depthLevels must be a positive integer, got 0");
    expect(() => new MarketFeed(sim, 1, { maxTradesPerFrame: -1 })).toThrow("maxTradesPerFrame must be a non-negative integer, got -1");
  });
});

describe("The real clock decides only HOW MANY ticks run, never what happens in them (D-039)", () => {
  /** The worker's loop: frame requests arrive after `gaps` real ms; each runs the pacer's ticks, then takes a frame. */
  function runLoop(gaps: () => number, totalTicks: number, speed = 1) {
    const feed = feedOf();
    const pacer = new TickPacer();
    const frames: Frame[] = [];
    let ran = 0;
    while (ran < totalTicks) {
      const due = Math.min(pacer.ticksFor(gaps(), speed), totalTicks - ran);
      feed.advance(due);
      ran += due;
      frames.push(feed.frame());
    }
    return { feed, frames };
  }

  it("smooth 60 fps, jittery frames and a 4× speed give the identical fill log for the same number of ticks", () => {
    const jitter = Rng.fromSeed(99);
    const smooth = runLoop(() => 1000 / 60, 3_000);
    const jittery = runLoop(() => jitter.uniform() * 250, 3_000);
    const fast = runLoop(() => 1000 / 60, 3_000, 4);
    const plain = createDemoMarket();
    plain.run(3_000);
    const prints = [smooth, jittery, fast].map(({ feed }) => fingerprint({ fills: feed.sim.engine.fills, bids: feed.sim.engine.book.depth("buy"), asks: feed.sim.engine.book.depth("sell") }));
    const plainPrint = fingerprint({ fills: plain.engine.fills, bids: plain.engine.book.depth("buy"), asks: plain.engine.book.depth("sell") });
    expect(prints).toEqual([plainPrint, plainPrint, plainPrint]);
    // Different timings slice the same market into different frames…
    expect(smooth.frames.length).not.toBe(jittery.frames.length);
    // …but the page ends up with the same trades and the same candles.
    const sent = (r: typeof smooth) => r.frames.flatMap((f) => f.trades);
    expect(sent(jittery)).toEqual(sent(smooth));
    expect(mergeCandles(jittery.frames)).toEqual(mergeCandles(smooth.frames));
  });
});

describe("TickPacer: real ms → whole 100 ms ticks", () => {
  it("runs one tick per 100 ms of real time and carries the remainder", () => {
    const p = new TickPacer();
    expect([16, 16, 16, 16, 16, 16, 16].map((ms) => p.ticksFor(ms))).toEqual([0, 0, 0, 0, 0, 0, 1]); // 112 ms → 1, carry 12
    expect(p.ticksFor(88)).toBe(1); // 12 + 88 = 100
    expect(p.ticksFor(250)).toBe(2); // carry 50
    expect(p.ticksFor(50)).toBe(1);
  });

  it("runs speed× as many ticks", () => {
    const p = new TickPacer();
    expect(p.ticksFor(100, 4)).toBe(4);
    expect(p.ticksFor(50, 0.5)).toBe(0);
    expect(p.ticksFor(150, 0.5)).toBe(1); // 25 + 75 = 100
  });

  it("does not catch up a long gap: at most maxTicksPerCall run and the backlog is dropped", () => {
    const p = new TickPacer(100, 10);
    expect(p.ticksFor(1_050)).toBe(10); // exactly the cap still runs normally and carries 50 ms
    expect(p.ticksFor(50)).toBe(1);
    expect(p.ticksFor(30_000)).toBe(10); // a hidden tab: 300 due, 10 run
    expect(p.ticksFor(50)).toBe(0); // and nothing is carried from the gap
    expect(p.ticksFor(50)).toBe(1);
  });

  it("rejects bad input", () => {
    expect(() => new TickPacer(0)).toThrow("tickMs must be a positive integer, got 0");
    expect(() => new TickPacer(100, 0)).toThrow("maxTicksPerCall must be a positive integer, got 0");
    expect(new TickPacer(100, 1).ticksFor(250)).toBe(1); // the smallest cap works
    const p = new TickPacer();
    expect(p.ticksFor(0)).toBe(0); // zero elapsed time is fine
    expect(() => p.ticksFor(-1)).toThrow("elapsedMs must be a non-negative finite number, got -1");
    expect(() => p.ticksFor(NaN)).toThrow(/elapsedMs must be/);
    expect(() => p.ticksFor(10, 0)).toThrow("speed must be a positive finite number, got 0");
    expect(() => p.ticksFor(10, Infinity)).toThrow(/speed must be/);
  });
});
