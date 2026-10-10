import { describe, expect, it } from "vitest";
import type { BookView, SubmitResult } from "../matchingEngine";
import { Rng } from "../rng";
import type { CancelResult, RestingOrder } from "../types";
import { oldestFirst, type AgentContext, type AgentOrder } from "./agent";
import { DEFAULT_NOISE_PARAMS, NoiseTrader, noiseTraders, paretoSize, referencePrice } from "./noiseTrader";

/** A fake market for driving one trader's decisions directly, recording what it does. */
function fakeContext(opts: { bid?: number | null; ask?: number | null; last?: number | null; orders?: RestingOrder[]; tick?: number } = {}) {
  const submitted: AgentOrder[] = [];
  const cancelled: string[] = [];
  const book = {
    tickSize: opts.tick ?? 1,
    bestBid: () => (opts.bid === undefined ? 18_699 : opts.bid),
    bestAsk: () => (opts.ask === undefined ? 18_701 : opts.ask),
  } as unknown as BookView;
  const ctx: AgentContext = {
    time: 0,
    book,
    lastTradePrice: opts.last ?? null,
    startPrice: 18_700,
    myOrders: () => opts.orders ?? [],
    submit: (o) => {
      submitted.push(o);
      return { ok: false, reason: "NO_LIQUIDITY", message: "fake" } as SubmitResult;
    },
    cancel: (id) => {
      cancelled.push(id);
      return { ok: false, reason: "UNKNOWN_ORDER", message: "fake" } as CancelResult;
    },
  };
  return { ctx, submitted, cancelled };
}

const minOf = (xs: number[]) => xs.reduce((m, x) => (x < m ? x : m), Infinity);
const maxOf = (xs: number[]) => xs.reduce((m, x) => (x > m ? x : m), -Infinity);
const resting = (id: string, seq: number): RestingOrder => ({ id, ownerId: "noise-1", agentType: "noise", side: "buy", price: 18_690, qty: 100, seq });

describe("NoiseTrader: decisions match the plan's probabilities (fixed seeds, 200,000 decisions)", () => {
  const N = 200_000;
  const trader = new NoiseTrader(Rng.fromSeed(187).stream("decisions").stream("noise-1"));
  const { ctx, submitted } = fakeContext(); // no resting orders, so it never cancels
  for (let i = 0; i < N; i++) trader.act(ctx);
  const limits = submitted.filter((o): o is Extract<AgentOrder, { type: "limit" }> => o.type === "limit");
  const markets = submitted.filter((o) => o.type === "market");

  it("places an order on every arrival when it has nothing resting", () => {
    expect(submitted).toHaveLength(N);
  });

  it("buys half the time and sends a market order 10% of the time", () => {
    const buys = submitted.filter((o) => o.side === "buy").length;
    expect(Math.abs(buys / N - 0.5)).toBeLessThan(5 * Math.sqrt(0.25 / N));
    expect(Math.abs(markets.length / N - 0.1)).toBeLessThan(5 * Math.sqrt(0.09 / N));
  });

  it("prices limits around the mid: δ = 8·E − 2, about 22% at or through the mid", () => {
    // Mid is 18,700. Buys sit at toTick(mid − δ, down), sells at toTick(mid + δ, up).
    const through = limits.filter((o) => (o.side === "buy" ? o.price >= 18_700 : o.price <= 18_700)).length;
    expect(Math.abs(through / limits.length - (1 - Math.exp(-2 / 8)))).toBeLessThan(0.01);
    const avgDistance = limits.reduce((s, o) => s + (o.side === "buy" ? 18_700 - o.price : o.price - 18_700), 0) / limits.length;
    expect(avgDistance).toBeGreaterThan(5.5); // E[δ] = 6¢; rounding away from the mid adds up to 1¢
    expect(avgDistance).toBeLessThan(7);
    expect(limits.every((o) => Number.isSafeInteger(o.price))).toBe(true);
  });

  it("draws sizes from a Pareto tail with α ≈ 1.5 (Hill estimator), capped per order type", () => {
    const sizes = limits.map((o) => o.qty);
    expect(minOf(sizes)).toBe(100);
    expect(maxOf(sizes)).toBeLessThanOrEqual(25_000);
    expect(sizes.every((q) => Number.isInteger(q))).toBe(true);
    expect(maxOf(markets.map((o) => o.qty))).toBeLessThanOrEqual(2_000); // D-025
    expect(maxOf(markets.map((o) => o.qty))).toBe(2_000); // the cap is actually reached
    // Tail probabilities P(q > x) = (100/x)^1.5, unaffected by the 25,000 cap below it.
    const share1000 = sizes.filter((q) => q > 1_000).length / sizes.length;
    expect(Math.abs(share1000 - Math.pow(0.1, 1.5))).toBeLessThan(0.003); // P(q > 1,000) ≈ 3.2%
    const share5000 = sizes.filter((q) => q > 5_000).length / sizes.length;
    expect(Math.abs(share5000 - Math.pow(0.02, 1.5))).toBeLessThan(0.001); // P(q > 5,000) ≈ 0.28%
  });

  it("has tail exponent α ≈ 1.5 by the Hill (1975) estimator on uncapped draws", () => {
    // Uncapped, because dropping capped values biases the estimate upward. k = 10,000 of
    // 500,000 draws gives a standard error of about α/√k ≈ 0.015; the bound is 4 standard errors.
    const rng = Rng.fromSeed(187);
    const draws = Array.from({ length: 500_000 }, () => paretoSize(rng, 1.5, 100, Number.MAX_SAFE_INTEGER));
    const top = draws.sort((a, b) => b - a).slice(0, 10_001);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) sum += Math.log(top[i] / top[10_000]);
    expect(Math.abs(10_000 / sum - 1.5)).toBeLessThan(0.06);
  });
});

describe("NoiseTrader: cancellations", () => {
  it("cancels about 35% of the time when it has resting orders, and then places nothing", () => {
    const trader = new NoiseTrader(Rng.fromSeed(1));
    const orders = [resting("SPY-1", 1), resting("SPY-2", 2)];
    let cancels = 0;
    for (let i = 0; i < 100_000; i++) {
      const { ctx, submitted, cancelled } = fakeContext({ orders });
      trader.act(ctx);
      if (cancelled.length) {
        cancels++;
        expect(submitted).toEqual([]);
      }
    }
    expect(Math.abs(cancels / 100_000 - 0.35)).toBeLessThan(5 * Math.sqrt(0.35 * 0.65 / 100_000));
  });

  it("chooses the order to cancel from an oldest-first list, whatever order the book reports (D-026)", () => {
    const orders = [resting("SPY-7", 7), resting("SPY-3", 3), resting("SPY-12", 12), resting("SPY-9", 9)];
    const shuffled = [orders[2], orders[0], orders[3], orders[1]];
    for (let seed = 0; seed < 200; seed++) {
      const a = fakeContext({ orders });
      const b = fakeContext({ orders: shuffled });
      new NoiseTrader(Rng.fromSeed(seed)).act(a.ctx);
      new NoiseTrader(Rng.fromSeed(seed)).act(b.ctx);
      expect(a.cancelled).toEqual(b.cancelled);
      expect(a.submitted).toEqual(b.submitted);
    }
  });

  it("sorts by engine sequence, not by id text (SPY-12 is newer than SPY-9)", () => {
    expect(oldestFirst([resting("SPY-12", 12), resting("SPY-9", 9), resting("SPY-10", 10)]).map((o) => o.id)).toEqual(["SPY-9", "SPY-10", "SPY-12"]);
  });

  it("at the 5-order cap, cancels its oldest order before placing a new one", () => {
    const orders = [5, 1, 4, 2, 3].map((s) => resting(`SPY-${s}`, s));
    let checked = 0;
    for (let seed = 0; seed < 300; seed++) {
      const { ctx, submitted, cancelled } = fakeContext({ orders });
      new NoiseTrader(Rng.fromSeed(seed)).act(ctx);
      if (submitted.length === 1) {
        expect(cancelled).toEqual(["SPY-1"]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("NoiseTrader: reference price", () => {
  it.each([
    [{ bid: 18_699, ask: 18_701 }, 18_700],
    [{ bid: 18_700, ask: 18_701 }, 18_700.5], // a half-cent mid is fine; toTick rounds it
    [{ bid: null, ask: 18_701, last: 18_650 }, 18_650], // one side empty: last trade
    [{ bid: 18_699, ask: null, last: null }, 18_700], // no trade yet: the opening price
    [{ bid: null, ask: null, last: null }, 18_700],
  ])("%j → %s", (opts, expected) => {
    expect(referencePrice(fakeContext(opts).ctx)).toBe(expected);
  });

  it("prices on the tick grid and never more aggressively than intended", () => {
    const trader = new NoiseTrader(Rng.fromSeed(3));
    const { ctx, submitted } = fakeContext({ bid: 18_695, ask: 18_705, tick: 5 });
    for (let i = 0; i < 5_000; i++) trader.act(ctx);
    for (const o of submitted) if (o.type === "limit") expect(o.price % 5).toBe(0);
  });
});

describe("paretoSize and noiseTraders", () => {
  it("never returns less than xMin or more than the cap", () => {
    const rng = Rng.fromSeed(9);
    for (let i = 0; i < 50_000; i++) {
      const q = paretoSize(rng, 1.5, 100, 2_000);
      expect(q >= 100 && q <= 2_000 && Number.isInteger(q)).toBe(true);
    }
  });

  it("builds N traders with ids noise-1 … noise-N, type noise, the given rate and parameters", () => {
    const specs = noiseTraders(3, 0.5);
    expect(specs.map((s) => [s.id, s.agentType, s.ratePerSec])).toEqual([
      ["noise-1", "noise", 0.5],
      ["noise-2", "noise", 0.5],
      ["noise-3", "noise", 0.5],
    ]);
    expect(specs[0].create(Rng.fromSeed(1))).toBeInstanceOf(NoiseTrader);
    expect(DEFAULT_NOISE_PARAMS).toEqual({
      pMarket: 0.1, mu: 8, theta: 2, alpha: 1.5, xMin: 100, limitSizeCap: 25_000, marketSizeCap: 2_000, pCancel: 0.35, maxResting: 5,
    });
  });
});
