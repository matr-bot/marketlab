import { describe, expect, it } from "vitest";
import type { BookView, SubmitResult } from "../matchingEngine";
import { Simulation } from "../simulation";
import type { CancelResult, RestingOrder } from "../types";
import type { AgentContext, AgentOrder } from "./agent";
import { computeQuotes, DEFAULT_MM_PARAMS, MarketMaker, marketMakers, othersBest, type QuoteInputs } from "./marketMaker";
import { noiseTraders } from "./noiseTrader";
import { MAX_PRICE_CENTS } from "../validation";

/** The hand-worked examples below use k = 1/¢ (the default is 1.5 since D-049; formulas are the same). */
const P = { ...DEFAULT_MM_PARAMS, k: 1 };
const MUTATION_RUN = process.env.MARKETLAB_MUTATION === "1";
/** σ such that σ × mid = 1¢ per √s at a $187.00 mid, so γσc²τ = γ·60. */
const ONE_CENT = 1 / 18_700;
const inputs = (over: Partial<QuoteInputs> = {}): QuoteInputs => ({
  mid: 18_700,
  sigma: ONE_CENT,
  position: 0,
  othersBestBid: null,
  othersBestAsk: null,
  tick: 1,
  ...over,
});

describe("computeQuotes: Avellaneda–Stoikov, worked by hand (γ = 0.01/¢, k = 1/¢, τ = 60 s, σc = 1¢/√s)", () => {
  // risk part γσc²τ = 0.01 × 1 × 60 = 0.6¢; competitive part (2/γ)ln(1 + γ/k) = 200·ln(1.01) ≈ 1.990¢.
  const competitive = 200 * Math.log(1.01);

  it("flat: reservation = mid; spread = 0.6 + 1.990 = 2.590¢; quotes rounded away from the market", () => {
    const q = computeQuotes(P, inputs());
    expect(q.riskPart).toBeCloseTo(0.6, 12);
    expect(q.spread).toBeCloseTo(0.6 + competitive, 12);
    expect(q.reservation).toBe(18_700);
    // bid = ⌊18700 − 1.295⌋ = 18698, ask = ⌈18700 + 1.295⌉ = 18702
    expect([q.bid?.price, q.ask?.price]).toEqual([18_698, 18_702]);
  });

  it("long 10 lots: reservation drops by q·γσc²τ = 10 × 0.6 = 6¢, so both quotes lean lower", () => {
    const q = computeQuotes(P, inputs({ position: 1_000 }));
    expect(q.reservation).toBeCloseTo(18_694, 10);
    expect([q.bid?.price, q.ask?.price]).toEqual([18_692, 18_696]);
  });

  it("short 10 lots: reservation rises by 6¢", () => {
    const q = computeQuotes(P, inputs({ position: -1_000 }));
    expect(q.reservation).toBeCloseTo(18_706, 10);
    expect([q.bid?.price, q.ask?.price]).toEqual([18_704, 18_708]);
  });

  it("4× volatility multiplies the risk part by 16: spread 0.6·16 + 1.990 = 11.59¢", () => {
    const calm = computeQuotes(P, inputs());
    const stressed = computeQuotes(P, inputs({ sigma: 4 * ONE_CENT }));
    expect(stressed.riskPart).toBeCloseTo(16 * calm.riskPart, 10);
    expect(stressed.spread).toBeCloseTo(9.6 + competitive, 10);
    expect(stressed.ask!.price - stressed.bid!.price).toBeGreaterThan(2 * (calm.ask!.price - calm.bid!.price));
  });

  it("uses γ/k in the competitive part: k = 2 gives (2/γ)·ln(1 + γ/k) = 200·ln(1.005) ≈ 0.998¢", () => {
    const q = computeQuotes({ ...P, k: 2 }, inputs());
    expect(q.spread).toBeCloseTo(0.6 + 200 * Math.log(1.005), 12);
  });

  it("handles a half-cent mid", () => {
    const q = computeQuotes(P, inputs({ mid: 18_700.5, sigma: 1 / 18_700.5 }));
    expect([q.bid?.price, q.ask?.price]).toEqual([18_699, 18_702]); // ⌊18699.205⌋, ⌈18701.795⌉
  });
});

describe("computeQuotes: never crosses the spread (post-only, D-035)", () => {
  // High volatility (5¢/√s) and 10 lots of inventory shift the reservation price by 150¢, far
  // enough that unclamped quotes would cross the market.
  const FIVE_CENTS = 5 / 18_700;
  const UNCAPPED = { ...P, maxSkew: 1e9, maxHalfSpread: 1e9 }; // these cases test the clamp, not the stress caps

  it("short: keeps the bid below others' best ask", () => {
    const q = computeQuotes(UNCAPPED, inputs({ sigma: FIVE_CENTS, position: -1_000, othersBestAsk: 18_701, othersBestBid: 18_700 }));
    expect(q.reservation).toBeCloseTo(18_850, 8);
    expect(q.bid!.price).toBe(18_700); // clamped to bestAsk − 1
    expect(q.ask!.price).toBeGreaterThan(18_850);
  });

  it("long: keeps the ask above others' best bid", () => {
    const q = computeQuotes(UNCAPPED, inputs({ sigma: FIVE_CENTS, position: 1_000, othersBestBid: 18_750 }));
    expect(q.ask!.price).toBe(18_751); // clamped to bestBid + 1
    expect(q.bid!.price).toBeLessThan(18_560);
  });

  it("leaves quotes alone when they don't cross, and drops a bid that would be below one tick", () => {
    const tight = computeQuotes(P, inputs({ othersBestAsk: 18_699 }));
    expect([tight.bid!.price, tight.ask!.price]).toEqual([18_698, 18_702]);
    expect(computeQuotes(P, inputs({ mid: 2, sigma: 1e-9, othersBestAsk: 1 })).bid).toBeNull();
  });

  it("drops the ask when no legal price is above others' best bid, and still quotes the last one (Codex review)", () => {
    // Codex: with others' best bid at the cap, the clamp made the ask MAX_PRICE_CENTS + 1 tick, which the book rejects.
    const near = (over: Partial<QuoteInputs>) => inputs({ mid: MAX_PRICE_CENTS - 1, sigma: 1e-12, ...over });
    expect(computeQuotes(P, near({ othersBestBid: MAX_PRICE_CENTS })).ask).toBeNull();
    expect(computeQuotes(P, near({ othersBestBid: MAX_PRICE_CENTS })).bid).not.toBeNull(); // the other side is unaffected
    expect(computeQuotes(P, near({ othersBestBid: MAX_PRICE_CENTS - 1 })).ask!.price).toBe(MAX_PRICE_CENTS);
    // Tick 7: the highest legal price is 99,999,998, not the cap itself.
    expect(computeQuotes(P, near({ tick: 7, othersBestBid: 99_999_998 })).ask).toBeNull();
    expect(computeQuotes(P, near({ tick: 7, othersBestBid: 99_999_991 })).ask!.price).toBe(99_999_998);
  });

  it("drops the bid when no legal price is below others' best ask, and still quotes the last one", () => {
    const low = (over: Partial<QuoteInputs>) => inputs({ mid: 20, sigma: 1e-12, ...over });
    expect(computeQuotes(P, low({ tick: 5, othersBestAsk: 5 })).bid).toBeNull();
    expect(computeQuotes(P, low({ tick: 5, othersBestAsk: 5 })).ask).not.toBeNull();
    expect(computeQuotes(P, low({ tick: 5, othersBestAsk: 10 })).bid!.price).toBe(5);
  });

  it("always has bid < ask and never crosses others' best prices (20,000 random cases)", () => {
    let seed = 7;
    const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    for (let i = 0; i < 20_000; i++) {
      const bb = rand() < 0.2 ? null : 18_600 + Math.floor(rand() * 200);
      const ba = rand() < 0.2 ? null : (bb ?? 18_600) + 1 + Math.floor(rand() * 10);
      const q = computeQuotes(P, inputs({ mid: 18_600 + rand() * 200, sigma: rand() * 10 * ONE_CENT + 1e-9, position: Math.round((rand() - 0.5) * 9_800), othersBestBid: bb, othersBestAsk: ba }));
      if (q.bid && q.ask) expect(q.bid.price).toBeLessThan(q.ask.price);
      if (q.bid && ba !== null) expect(q.bid.price).toBeLessThan(ba);
      if (q.ask && bb !== null) expect(q.ask.price).toBeGreaterThan(bb);
    }
  });
});

describe("computeQuotes: stress caps (D-047)", () => {
  // 40× calm volatility and a full long inventory: uncapped, r = s − 50 · 0.01 · (40σ₀·s)² · 60 is
  // about $7,700 below the mid, so the ask would land at the 1¢ floor (found by the crash test).
  const crash = inputs({ sigma: 40 * P.sigma0, position: 5_000 - 100 });

  it("caps the inventory skew at 25¢ and the half-spread at 25¢", () => {
    const q = computeQuotes(P, crash);
    expect(q.reservation).toBe(18_700 - 25);
    expect(q.spread).toBe(50);
    expect(q.ask?.price).toBe(18_700); // was the 1¢ floor before the cap
    expect(q.bid).toBeNull(); // at the long limit it adds no inventory
  });

  it("never quotes further than skew + half-spread = 50¢ from the mid, at any volatility or inventory", () => {
    for (const mult of [1, 4, 40, 400]) {
      for (let pos = -4_900; pos <= 4_900; pos += 700) {
        const q = computeQuotes(P, inputs({ sigma: mult * P.sigma0, position: pos }));
        for (const side of [q.bid, q.ask]) if (side) expect(Math.abs(side.price - 18_700)).toBeLessThanOrEqual(51);
      }
    }
  });

  it("does not bind in a calm market: the worked example is unchanged", () => {
    const q = computeQuotes(P, inputs({ position: 1_000 }));
    expect(q.reservation).toBeCloseTo(18_694, 10);
  });
});

describe("computeQuotes: size (D-036)", () => {
  const atSigma0 = (over: Partial<QuoteInputs>) => computeQuotes(P, inputs({ sigma: P.sigma0, ...over }));

  it("quotes the base size when calm and flat", () => {
    expect([atSigma0({}).bid?.qty, atSigma0({}).ask?.qty]).toEqual([500, 500]);
  });

  it("shrinks with volatility, floored at 25% and rounded down to whole lots", () => {
    expect(atSigma0({ sigma: 2 * P.sigma0 }).bid?.qty).toBe(200); // 500 × 0.5 = 250 → 200
    expect(atSigma0({ sigma: 10 * P.sigma0 }).bid?.qty).toBe(100); // 500 × 0.25 = 125 → 100
    expect(atSigma0({ sigma: 0.5 * P.sigma0 }).bid?.qty).toBe(500); // never above base
  });

  it("shrinks the side that would grow inventory and stops at the limit", () => {
    expect([atSigma0({ position: 2_500 }).bid?.qty, atSigma0({ position: 2_500 }).ask?.qty]).toEqual([200, 500]);
    expect(atSigma0({ position: 5_000 }).bid).toBeNull();
    expect(atSigma0({ position: -5_000 }).ask).toBeNull();
    expect(atSigma0({ position: 4_850 }).bid).toBeNull(); // 500 × 0.03 = 15 → 0 lots
    expect(atSigma0({ position: -4_950 }).bid?.qty).toBe(500);
    // Far from the limit on the side that shrinks inventory: the full size, not capped by the limit.
    expect(atSigma0({ position: 4_800 }).ask?.qty).toBe(500);
    expect(atSigma0({ position: -4_800 }).bid?.qty).toBe(500);
  });

  it("never lets a fill take inventory past the limit", () => {
    for (let pos = -5_000; pos <= 5_000; pos += 37) {
      const q = atSigma0({ position: pos });
      if (q.bid) expect(pos + q.bid.qty).toBeLessThanOrEqual(5_000);
      if (q.ask) expect(pos - q.ask.qty).toBeGreaterThanOrEqual(-5_000);
    }
  });
});

describe("MarketMaker.act: requotes only when price or size changes (Step 4+5 change 3)", () => {
  /** A fake market that records the market maker's actions and holds its resting orders. */
  function fakeMarket(state: { bid: number | null; ask: number | null; sigma: number; position: number }) {
    const resting: RestingOrder[] = [];
    const log: string[] = [];
    let n = 0;
    const others = { buy: () => state.bid, sell: () => state.ask };
    const book = {
      tickSize: 1,
      depth: (side: "buy" | "sell") => {
        const mine = resting.filter((o) => o.side === side).map((o) => o.price);
        const prices = [...new Set([others[side](), ...mine])].filter((p) => p !== null).sort((a, b) => (side === "buy" ? b - a : a - b));
        return prices.map((price) => ({ price, qty: 1, orderCount: 1 }));
      },
      ordersAt: (side: "buy" | "sell", price: number) => {
        const mine = resting.filter((o) => o.side === side && o.price === price);
        return price === others[side]() ? [...mine, { id: `other-${side}`, ownerId: "x" } as RestingOrder] : mine;
      },
    } as unknown as BookView;
    const ctx = (): AgentContext => ({
      time: 0,
      book,
      lastTradePrice: null,
      startPrice: 18_700,
      fairValue: 18_700,
      panicSensitivity: 1,
      maxMidSince: () => null,
      position: state.position,
      volatility: { sigma: state.sigma, fast: state.sigma, slow: state.sigma, samples: 30, ready: true },
      myOrders: () => [...resting],
      submit: (o: AgentOrder) => {
        if (o.type !== "limit") throw new Error("market makers only post limits");
        const id = `MM-${++n}`;
        resting.push({ id, ownerId: "mm-1", agentType: "marketMaker", side: o.side, price: o.price, qty: o.qty, seq: n });
        log.push(`submit ${o.side} ${o.qty}@${o.price}`);
        return { ok: true } as SubmitResult;
      },
      cancel: (id: string) => {
        resting.splice(resting.findIndex((o) => o.id === id), 1);
        log.push(`cancel ${id}`);
        return { ok: true } as CancelResult;
      },
    });
    return { ctx, resting, log };
  }

  it("places a bid and an ask, then leaves them alone while nothing changes (keeps time priority)", () => {
    const state = { bid: 18_699, ask: 18_701, sigma: P.sigma0, position: 0 };
    const m = fakeMarket(state);
    const mm = new MarketMaker(P);
    mm.act(m.ctx());
    expect(m.log).toEqual(["submit buy 500@18698", "submit sell 500@18702"]);
    m.log.length = 0;
    for (let i = 0; i < 5; i++) mm.act(m.ctx());
    expect(m.log).toEqual([]);
  });

  it("replaces only the side whose price or size changed", () => {
    const state = { bid: 18_699, ask: 18_701, sigma: P.sigma0, position: 0 };
    const m = fakeMarket(state);
    const mm = new MarketMaker(P);
    mm.act(m.ctx());
    m.log.length = 0;
    state.position = 2_500; // bid size 500 → 200 and reservation drops ~1.2¢: both sides change
    mm.act(m.ctx());
    expect(m.log.filter((l) => l.startsWith("cancel"))).toHaveLength(2);
    m.log.length = 0;
    state.ask = 18_702; // only others' best ask moves; the market maker's own quotes depend on the mid
    mm.act(m.ctx());
    expect(m.log.every((l) => l.startsWith("cancel") || l.startsWith("submit"))).toBe(true);
    expect(m.resting).toHaveLength(2);
  });

  it("prices off the opening price, not half the ask, when others have only one side", () => {
    const m = fakeMarket({ bid: null, ask: 18_801, sigma: P.sigma0, position: 0 });
    new MarketMaker(P).act(m.ctx());
    expect(m.log).toEqual(["submit buy 500@18698", "submit sell 500@18702"]); // around startPrice 18,700
  });

  it("cancels a side that can no longer be quoted and places nothing there", () => {
    const state = { bid: 18_699, ask: 18_701, sigma: P.sigma0, position: 0 };
    const m = fakeMarket(state);
    const mm = new MarketMaker(P);
    mm.act(m.ctx());
    const askId = m.resting.find((o) => o.side === "sell")!.id;
    m.log.length = 0;
    state.position = -5_000; // at the short limit: no ask allowed
    mm.act(m.ctx());
    expect(m.log).toContain(`cancel ${askId}`);
    expect(m.log.some((l) => l.startsWith("submit sell"))).toBe(false);
    expect(m.resting.filter((o) => o.side === "sell")).toHaveLength(0);
  });

  it("cancels before placing, and never keeps more than one quote per side", () => {
    const state = { bid: 18_699, ask: 18_701, sigma: P.sigma0, position: 0 };
    const m = fakeMarket(state);
    const mm = new MarketMaker(P);
    mm.act(m.ctx());
    m.log.length = 0;
    state.bid = 18_690; // the mid stays 18,700 but both quotes are re-sized by a position change
    state.ask = 18_710;
    state.position = -1_500;
    mm.act(m.ctx());
    const kinds = m.log.map((l) => l.split(" ")[0]);
    expect(kinds).toEqual(["cancel", "cancel", "submit", "submit"]);
    expect(m.resting.filter((o) => o.side === "buy")).toHaveLength(1);
    expect(m.resting.filter((o) => o.side === "sell")).toHaveLength(1);
  });

  it("ignores its own quotes when finding the market's best prices", () => {
    const m = fakeMarket({ bid: 18_699, ask: 18_701, sigma: P.sigma0, position: 0 });
    m.resting.push({ id: "MM-own", ownerId: "mm-1", agentType: "marketMaker", side: "buy", price: 18_700, qty: 100, seq: 0 });
    const ctx = m.ctx();
    expect(othersBest(ctx.book, "buy", new Set(["MM-own"]))).toBe(18_699);
    expect(othersBest(ctx.book, "buy", new Set())).toBe(18_700);
    expect(othersBest({ depth: () => [], ordersAt: () => [] } as unknown as BookView, "sell", new Set())).toBeNull();
  });
});

describe("Market makers in the live market (one sim-hour, seed 187)", () => {
  const run = () => {
    const maxResting = { "mm-1": 0, "mm-2": 0 };
    let maxAbs = 0;
    const s2 = new Simulation({
      seed: 187,
      agents: [...noiseTraders(40, 0.5), ...marketMakers()],
      observer: {
        onTickEnd: () => {
          for (const id of ["mm-1", "mm-2"] as const) {
            maxResting[id] = Math.max(maxResting[id], s2.engine.book.ordersOf(id).length);
            maxAbs = Math.max(maxAbs, Math.abs(s2.positionOf(id)));
          }
        },
      },
    });
    s2.run(36_000);
    return { sim: s2, maxResting, maxAbs };
  };

  it.skipIf(MUTATION_RUN)("never takes liquidity, never holds more than one quote per side, and stays inside its inventory limit", () => {
    const { sim, maxResting, maxAbs } = run();
    const mmFills = sim.engine.fills.filter((f) => f.buy.agentType === "marketMaker" || f.sell.agentType === "marketMaker");
    expect(mmFills.length).toBeGreaterThan(1_000);
    for (const f of mmFills) {
      const taker = f.aggressor === "buy" ? f.buy : f.sell;
      expect(taker.agentType).not.toBe("marketMaker"); // post-only: always the resting side
    }
    expect(Math.max(maxResting["mm-1"], maxResting["mm-2"])).toBeLessThanOrEqual(2);
    expect(maxAbs).toBeLessThanOrEqual(5_000);
  });

  it.skipIf(MUTATION_RUN)("makes money against uninformed noise traders, marked to the mid (Step 4+5 change 4)", () => {
    for (const seed of [187, 1, 2]) {
      const sim = new Simulation({ seed, agents: [...noiseTraders(40, 0.5), ...marketMakers()] });
      sim.run(36_000);
      const mid = (sim.engine.book.bestBid()! + sim.engine.book.bestAsk()!) / 2;
      for (const id of ["mm-1", "mm-2"]) expect(sim.cashOf(id) + sim.positionOf(id) * mid, `${id} seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it.skipIf(MUTATION_RUN)("also makes money on seeds that were NOT used to choose k (out of sample, D-033, Codex review)", () => {
    // k = 1.0 was picked on seeds 187, 1 and 2, so the test above only guards against regressions.
    // Seeds 3, 4 and 5 were fixed before looking at their results. Measured: +$124 to +$235 each.
    for (const seed of [3, 4, 5]) {
      const sim = new Simulation({ seed, agents: [...noiseTraders(40, 0.5), ...marketMakers()] });
      sim.run(36_000);
      const mid = (sim.engine.book.bestBid()! + sim.engine.book.bestAsk()!) / 2;
      for (const id of ["mm-1", "mm-2"]) expect(sim.cashOf(id) + sim.positionOf(id) * mid, `${id} seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("builds two market makers with ids mm-1, mm-2 and the given risk aversions", () => {
    const specs = marketMakers();
    expect(specs.map((s) => [s.id, s.agentType, s.ratePerSec])).toEqual([
      ["mm-1", "marketMaker", 5],
      ["mm-2", "marketMaker", 5],
    ]);
    expect(specs[0].create(undefined as never)).toBeInstanceOf(MarketMaker);
    expect(DEFAULT_MM_PARAMS).toEqual({ gamma: 0.01, k: 1.5, tauSec: 60, lotSize: 100, baseSize: 500, maxInventory: 5_000, minSizeFactor: 0.25, sigma0: 4.3e-5, maxSkew: 25, maxHalfSpread: 25 });
  });
});
