import { describe, expect, it } from "vitest";
import { MarketFeed, EXR_ORDERS, type Frame } from "./feed";
import { createScenarioMarket, scenarioById } from "./scenarios";
import { SHOCK_SPACING_MS } from "./simulation";

const feedFor = (id = "free", seed?: number) => {
  const sc = scenarioById(id)!;
  const s = seed ?? sc.seed;
  return new MarketFeed(createScenarioMarket(sc, s), s);
};

describe("the frame carries the student's desk, outcomes and execution report", () => {
  it("is plain data the worker can post, with a flat desk before the student has done anything", () => {
    const feed = feedFor();
    const frame = feed.frame();
    expect(() => structuredClone(frame)).not.toThrow();
    expect(frame.desk).toEqual({ position: 0, cash: 0, mark: expect.any(Number), pnl: 0, openOrders: [] });
    expect(frame.userEvents).toEqual([]);
    expect(frame.exr).toBeNull();
  });

  it("sends each order outcome exactly once and the execution report only when a fill arrived", () => {
    const feed = feedFor();
    feed.frame();
    expect(feed.submitOrder({ type: "market", side: "buy", qty: 500 })).toMatchObject({ ok: true });
    feed.advance(1);
    const a = feed.frame();
    expect(a.userEvents).toHaveLength(1);
    expect(a.userEvents[0]).toMatchObject({ kind: "order", status: "filled", filledQty: 500 });
    expect(a.desk.position).toBe(500);
    expect(a.exr).not.toBeNull();
    expect(a.exr!.orders).toHaveLength(1);
    expect(a.exr!.totals).toMatchObject({ orders: 1, qty: 500 });
    expect(a.exr!.totals.slippageX2).not.toBeNull();
    expect(() => structuredClone(a)).not.toThrow();

    feed.advance(1);
    const b = feed.frame();
    expect(b.userEvents).toEqual([]); // not repeated
    expect(b.exr).toBeNull(); // nothing new to report
    expect(b.desk.position).toBe(500); // but the desk is always current
  });

  it("a later fill of a resting order updates the report even though the student did nothing that frame", () => {
    const feed = feedFor();
    const first = feed.frame();
    const bid = first.bid!;
    feed.submitOrder({ type: "limit", side: "buy", qty: 3_000, price: bid + 1 });
    feed.advance(1);
    let frame = feed.frame();
    expect(frame.userEvents[0].status === "resting" || frame.userEvents[0].status === "partial" || frame.userEvents[0].status === "filled").toBe(true);
    let reported = frame.exr;
    // Let the market trade into it; the order fills as sellers arrive.
    for (let i = 0; i < 600 && frame.desk.openOrders.length > 0; i++) {
      feed.advance(10);
      frame = feed.frame();
      reported = frame.exr ?? reported;
    }
    expect(reported).not.toBeNull();
    expect(reported!.totals.qty).toBe(frame.desk.position);
  });

  it("keeps only the newest EXR_ORDERS orders in the list but totals over all of them", () => {
    const feed = feedFor();
    feed.frame();
    const total = EXR_ORDERS + 5;
    for (let i = 0; i < total; i++) {
      feed.submitOrder({ type: "market", side: i % 2 === 0 ? "buy" : "sell", qty: 100 });
      feed.advance(1);
    }
    const frame = feed.frame();
    expect(frame.exr!.orders).toHaveLength(EXR_ORDERS);
    expect(frame.exr!.totals.orders).toBe(total);
    expect(frame.exr!.totals.qty).toBe(total * 100);
  });

  it("refuses a bad size at once, as data", () => {
    const feed = feedFor();
    expect(feed.submitOrder({ type: "market", side: "buy", qty: -3 })).toMatchObject({ ok: false, reason: "INVALID_QTY" });
    expect(feed.cancelOrders()).toMatchObject({ ok: true });
  });
});

describe("custom headlines (applyCustomShock)", () => {
  it("applies the student's numbers, names them in the headline, and the chart marker is CUSTOM", () => {
    const feed = feedFor();
    feed.frame();
    const r = feed.applyCustomShock({ fairValuePct: -0.025, panicSensitivity: 1.5, durationSec: 120, volatilityMultiplier: 1, liquidityMultiplier: 1 });
    expect(r).toEqual({ ok: true, code: "CUSTOM", headline: "Custom shock: fair value -2.5%, panic 1.5× for 120 s" });
    feed.advance(1);
    const frame = feed.frame();
    expect(frame.headlines).toEqual([expect.objectContaining({ code: "CUSTOM", headline: "Custom shock: fair value -2.5%, panic 1.5× for 120 s", fairValuePct: -0.025 })]);
  });

  it("clamps to the engine's limits and says what was really applied", () => {
    const feed = feedFor();
    const r = feed.applyCustomShock({ fairValuePct: -0.9, panicSensitivity: 99, durationSec: 5, volatilityMultiplier: 1, liquidityMultiplier: 1 });
    expect(r).toEqual({ ok: true, code: "CUSTOM", headline: "Custom shock: fair value -20.0%, panic 3× for 10 s" });
  });

  it("refuses non-numbers with a friendly message and applies nothing", () => {
    const feed = feedFor();
    const r = feed.applyCustomShock({ fairValuePct: Number.NaN, panicSensitivity: 1, durationSec: 60, volatilityMultiplier: 1, liquidityMultiplier: 1 });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("real numbers") });
    feed.advance(2);
    expect(feed.frame().headlines).toEqual([]);
  });

  it("shares the digest rule with preset headlines: a second one too soon is refused", () => {
    const feed = feedFor();
    expect(feed.applyPreset("FED")).toMatchObject({ ok: true });
    expect(feed.applyCustomShock({ fairValuePct: -0.01, panicSensitivity: 1, durationSec: 60, volatilityMultiplier: 1, liquidityMultiplier: 1 })).toMatchObject({ ok: false, message: expect.stringContaining("digesting") });
    feed.advance(SHOCK_SPACING_MS / 100 + 1);
    expect(feed.applyCustomShock({ fairValuePct: -0.01, panicSensitivity: 1, durationSec: 60, volatilityMultiplier: 1, liquidityMultiplier: 1 })).toMatchObject({ ok: true });
  });
});

describe("scenario headlines in the frame", () => {
  it("arrive with their own code and headline text at the scheduled moment, once", () => {
    const feed = feedFor("rate-shock");
    const first: Frame = feed.frame();
    expect(first.headlines).toEqual([]);
    feed.advance(290);
    expect(feed.frame().headlines).toEqual([]); // 29 s: not yet
    feed.advance(20);
    const frame = feed.frame();
    expect(frame.headlines).toEqual([expect.objectContaining({ code: "HIKE", headline: "Fed surprise hike 75bps", fairValuePct: -0.03 })]);
    expect(frame.headlines[0].time - first.time).toBe(30_000);
    feed.advance(10);
    expect(feed.frame().headlines).toEqual([]);
  });
});
