import { describe, expect, it } from "vitest";
import type { BookView, SubmitResult } from "../matchingEngine";
import { Rng } from "../rng";
import type { CancelResult, RestingOrder } from "../types";
import type { AgentContext, AgentOrder } from "./agent";
import { DEFAULT_VALUE_PARAMS, ValueTrader, valueOrder, valueTraders } from "./valueTrader";

const P = DEFAULT_VALUE_PARAMS;
const at = (over: Partial<Parameters<typeof valueOrder>[1]>) => valueOrder(P, { belief: 18_700, mid: 18_700, theta: 0.002, position: 0, tick: 1, ...over });

describe("valueOrder: trade toward belief beyond the threshold (D-044), worked by hand", () => {
  it("does nothing inside the threshold band, including exactly at it", () => {
    expect(at({ belief: 18_700 * 1.0019 })).toBeNull();
    expect(at({ belief: 18_700 * 0.9981 })).toBeNull();
    expect(at({ belief: 10_020, mid: 10_000 })).toBeNull(); // gap = 20 / 10,000 = θ exactly
  });

  it("buys a little just beyond the threshold, limit at belief·(1 − θ)", () => {
    // gap 0.3% > θ 0.2%: q = 200 · 0.1 / 0.2 = 100; price ⌊18756.1 × 0.998⌋ = ⌊18718.59⌋
    expect(at({ belief: 18_700 * 1.003 })).toEqual({ side: "buy", price: 18_718, qty: 100 });
  });

  it("sells after a −3% fair-value shock, as much as one order allows, limit at belief·(1 + θ)", () => {
    // gap −3%: q = 200 · 2.8 / 0.2 = 2,800 → capped at 1,000; price ⌈18139 × 1.002⌉ = ⌈18175.28⌉
    expect(at({ belief: 18_139 })).toEqual({ side: "sell", price: 18_176, qty: 1_000 });
  });

  it("orders at least one lot", () => {
    expect(at({ belief: 18_700 * 1.00201 })?.qty).toBe(100); // 200 · 0.00001/0.002 = 1 share → one lot
  });

  it("never lets a fill take its position past ±6,000 shares", () => {
    expect(at({ belief: 18_139, position: -5_500 })?.qty).toBe(500);
    expect(at({ belief: 18_139, position: -6_000 })).toBeNull();
    expect(at({ belief: 18_139, position: -5_950 })).toBeNull(); // room for 50 shares: less than a lot
    expect(at({ belief: 19_261, position: 5_700 })?.qty).toBe(300);
    for (let pos = -6_000; pos <= 6_000; pos += 137) {
      for (const belief of [18_139, 19_261]) {
        const o = at({ belief, position: pos });
        if (o) expect(Math.abs(pos + (o.side === "buy" ? o.qty : -o.qty))).toBeLessThanOrEqual(6_000);
      }
    }
  });
});

describe("ValueTrader: heterogeneous beliefs and thresholds", () => {
  it("draws a persistent offset within ±0.08% and a threshold in [0.10%, 0.30%]", () => {
    const traders = Array.from({ length: 2_000 }, (_, i) => new ValueTrader(Rng.fromSeed(i)));
    expect(traders.every((t) => Math.abs(t.offset) <= 0.0008 && t.theta >= 0.001 && t.theta <= 0.003)).toBe(true);
    const sd = Math.sqrt(traders.reduce((s, t) => s + t.offset ** 2, 0) / traders.length);
    expect(sd).toBeGreaterThan(0.00027); // N(0, 0.03%) slightly shrunk by the clip
    expect(sd).toBeLessThan(0.00031);
    expect(Math.max(...traders.map((t) => Math.abs(t.offset)))).toBeCloseTo(0.0008, 6); // the clip binds sometimes
  });

  it("no trader is a permanent bull or bear: the offset clip is below the smallest threshold", () => {
    expect(P.offsetClip).toBeLessThan(P.thetaMin);
  });

  function fake(mid: number, fairValue: number, position = 0) {
    const resting: RestingOrder[] = [];
    const log: string[] = [];
    let n = 0;
    const ctx: AgentContext = {
      time: 0,
      book: { tickSize: 1, bestBid: () => mid - 0.5, bestAsk: () => mid + 0.5 } as unknown as BookView,
      lastTradePrice: null,
      startPrice: 18_700,
      position,
      volatility: { sigma: 4.3e-5, fast: 4.3e-5, slow: 4.3e-5, samples: 30, ready: true },
      fairValue,
      panicSensitivity: 1,
      maxMidSince: () => null,
      myOrders: () => [...resting],
      submit: (o: AgentOrder) => {
        if (o.type !== "limit") throw new Error("value traders post limits");
        resting.push({ id: `V-${++n}`, ownerId: "value-1", agentType: "value", side: o.side, price: o.price, qty: o.qty, seq: n });
        log.push(`submit ${o.side} ${o.qty}@${o.price}`);
        return { ok: true } as SubmitResult;
      },
      cancel: (id: string) => {
        resting.splice(resting.findIndex((o) => o.id === id), 1);
        log.push(`cancel ${id}`);
        return { ok: true } as CancelResult;
      },
    };
    return { ctx, log, resting };
  }

  it("sells after the fair value drops, keeps an unchanged order, and cancels once back inside its band", () => {
    const t = new ValueTrader(Rng.fromSeed(1), { ...P, noiseSd: 0 });
    const m = fake(18_700.5, 18_139);
    t.act(m.ctx);
    expect(m.log).toHaveLength(1);
    expect(m.log[0]).toMatch(/^submit sell 1000@181\d\d$/);
    t.act(m.ctx);
    expect(m.log).toHaveLength(1); // unchanged: no requote, keeps time priority
    const back = fake(18_139.5, 18_139);
    back.resting.push(...m.resting);
    t.act(back.ctx);
    expect(back.log).toEqual([`cancel ${m.resting[0].id}`]);
  });

  it("builds value-1 … value-N", () => {
    const specs = valueTraders(15, 0.5);
    expect(specs.map((s) => s.id).slice(0, 2)).toEqual(["value-1", "value-2"]);
    expect([specs.length, specs[0].agentType, specs[0].ratePerSec]).toEqual([15, "value", 0.5]);
    expect(specs[0].create(Rng.fromSeed(1))).toBeInstanceOf(ValueTrader);
  });
});
