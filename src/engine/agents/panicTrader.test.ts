import { describe, expect, it } from "vitest";
import type { BookView, SubmitResult } from "../matchingEngine";
import { Rng } from "../rng";
import type { CancelResult, RestingOrder } from "../types";
import type { AgentContext, AgentOrder } from "./agent";
import { DEFAULT_PANIC_PARAMS, PanicTrader, panicTraders, type PanicTraderParams } from "./panicTrader";

/** Fixed draws: 1% trigger, 30 s window, 1,000 shares, 500-share sells. */
const FIXED: PanicTraderParams = { ...DEFAULT_PANIC_PARAMS, dropMin: 0.01, dropMax: 0.01, windowMinSec: 30, windowMaxSec: 30, holdingsMin: 1_000, holdingsMax: 1_000, sellMin: 500, sellMax: 500 };

/** A fake market the test moves by hand; fills are applied by the test through `fill`. */
function market() {
  const state = { mid: 18_700, high: 18_700 as number | null, s: 1, position: 0, time: 0 };
  const resting: RestingOrder[] = [];
  const log: string[] = [];
  let n = 0;
  const ctx = (): AgentContext => ({
    time: state.time,
    book: { tickSize: 1, bestBid: () => state.mid - 0.5, bestAsk: () => state.mid + 0.5 } as unknown as BookView,
    lastTradePrice: null,
    startPrice: 18_700,
    position: state.position,
    volatility: { sigma: 4.3e-5, fast: 4.3e-5, slow: 4.3e-5, samples: 30, ready: true },
    fairValue: 18_700,
    panicSensitivity: state.s,
    maxMidSince: () => state.high,
    myOrders: () => [...resting],
    submit: (o: AgentOrder) => {
      if (o.type === "market") log.push(`market ${o.side} ${o.qty}`);
      else {
        resting.push({ id: `P-${++n}`, ownerId: "panic-1", agentType: "panic", side: o.side, price: o.price, qty: o.qty, seq: n });
        log.push(`limit ${o.side} ${o.qty}@${o.price}`);
      }
      return { ok: true } as SubmitResult;
    },
    cancel: (id: string) => {
      resting.splice(resting.findIndex((o) => o.id === id), 1);
      log.push(`cancel ${id}`);
      return { ok: true } as CancelResult;
    },
  });
  return { state, ctx, log, resting };
}

const trader = (p: PanicTraderParams = FIXED) => new PanicTrader(Rng.fromSeed(1), p);

describe("PanicTrader: threshold cascade (D-045), with a fake market", () => {
  it("stays calm while the drawdown is below its trigger", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_700 * 0.991; // −0.9% < 1%
    t.act(m.ctx());
    expect([m.log, t.state]).toEqual([[], "calm"]);
  });

  it("panics at its trigger and dumps with market orders", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_700 * 0.99;
    t.act(m.ctx());
    expect([m.log, t.state, t.panics]).toEqual([["market sell 500"], "panic", 1]);
  });

  it("a headline's sensitivity divides the trigger: s = 2 panics at a 0.5% drop", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_700 * 0.995;
    t.act(m.ctx());
    expect(m.log).toEqual([]);
    m.state.s = 2;
    t.act(m.ctx());
    expect(m.log).toEqual(["market sell 500"]);
  });

  it("never sells more than it holds and never goes short", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_000;
    for (let i = 0; i < 10; i++) {
      t.act(m.ctx());
      const sold = m.log.filter((l) => l.startsWith("market")).reduce((s, l) => s + Number(l.split(" ")[2]), 0);
      m.state.position = -sold; // every sell fills
      m.state.time += 1_000;
    }
    expect(m.log.filter((l) => l.startsWith("market"))).toEqual(["market sell 500", "market sell 500"]);
    expect(t.state).toBe("cooldown");
    expect(1_000 + m.state.position).toBe(0);
  });

  it("panics for at most panicSec, then cools down for cooldownSec before it can panic again", () => {
    const t = trader({ ...FIXED, holdingsMin: 100_000, holdingsMax: 100_000 });
    const m = market();
    m.state.mid = 18_000; // stays down the whole time
    const sellsAt: number[] = [];
    for (let s = 0; s <= 400; s++) {
      m.state.time = s * 1_000;
      const before = m.log.length;
      t.act(m.ctx());
      if (m.log.length > before && m.log[m.log.length - 1].startsWith("market")) sellsAt.push(s);
    }
    // Sells at 0…19 s, stops at 20 s (panicSec), cooldown to 320 s, panics again at 320 s.
    expect(sellsAt.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(sellsAt.filter((s) => s >= 20 && s < 320)).toEqual([]);
    expect(sellsAt.filter((s) => s >= 320)[0]).toBe(320);
    expect(t.panics).toBe(2);
  });

  it("stops early when the mid recovers to within half its trigger of the high", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_700 * 0.99;
    t.act(m.ctx());
    m.state.mid = 18_700 * 0.995; // back to within 0.5% of the high
    m.state.time = 1_000;
    t.act(m.ctx());
    expect(m.log).toEqual(["market sell 500"]);
    expect(t.state).toBe("cooldown");
  });

  it("rebuilds its holdings when calm after the cooldown: one small passive bid, below the market", () => {
    const t = trader();
    const m = market();
    m.state.mid = 18_000;
    t.act(m.ctx());
    m.state.position = -500;
    m.state.time = 21_000;
    t.act(m.ctx()); // panic over → cooldown
    m.state.time = 200_000;
    m.state.high = 18_000;
    t.act(m.ctx());
    expect(m.log.some((l) => l.startsWith("limit"))).toBe(false); // still cooling down
    m.state.time = 330_000;
    t.act(m.ctx());
    // bid at min(best bid 17999.5 → , ⌊18000 − 2⌋ = 17998), 200 of the 500 missing shares
    expect(m.log[m.log.length - 1]).toBe("limit buy 200@17998");
    t.act(m.ctx());
    expect(m.log.filter((l) => l.startsWith("limit"))).toHaveLength(1); // unchanged: kept
  });

  it("does not rebuild while the market is still falling, and cancels its bid", () => {
    const t = trader();
    const m = market();
    m.state.position = -500;
    m.state.mid = 18_700;
    t.act(m.ctx());
    expect(m.resting).toHaveLength(1);
    m.state.mid = 18_700 * 0.994; // a 0.6% drawdown: over half the 1% trigger, not calm
    t.act(m.ctx());
    expect(m.resting).toHaveLength(0);
    expect(t.state).toBe("calm");
  });

  it("does nothing on a one-sided book and draws its trigger, window and holdings from the ranges", () => {
    const t = trader();
    const ctx = { ...market().ctx(), book: { tickSize: 1, bestBid: () => null, bestAsk: () => 18_700 } as unknown as BookView };
    t.act(ctx);
    const many = Array.from({ length: 1_000 }, (_, i) => new PanicTrader(Rng.fromSeed(i)));
    expect(many.every((x) => x.drop >= 0.005 && x.drop <= 0.03 && x.windowMs >= 20_000 && x.windowMs <= 90_000 && x.windowMs % 100 === 0)).toBe(true);
    expect(many.every((x) => x.holdings >= 1_000 && x.holdings <= 6_000 && x.holdings % 100 === 0)).toBe(true);
  });

  it("builds panic-1 … panic-N", () => {
    const specs = panicTraders(20, 1);
    expect([specs.length, specs[0].id, specs[19].id, specs[0].agentType, specs[0].ratePerSec]).toEqual([20, "panic-1", "panic-20", "panic", 1]);
    expect(specs[0].create(Rng.fromSeed(1))).toBeInstanceOf(PanicTrader);
  });
});
