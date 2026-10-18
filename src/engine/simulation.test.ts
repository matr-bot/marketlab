import { beforeAll, describe, expect, it } from "vitest";
import type { Agent, AgentContext, AgentSpec } from "./agents/agent";
import { marketMakers } from "./agents/marketMaker";
import { DEFAULT_NOISE_PARAMS, NoiseTrader, noiseTraders } from "./agents/noiseTrader";
import { Simulation } from "./simulation";
import { fingerprint } from "./testing/fingerprint";
import { runMarketReport } from "./testing/marketReport";

/** Set by vitest.stryker.config.mts: one-hour whole-market tests skip themselves in mutation runs (D-028). */
const MUTATION_RUN = process.env.MARKETLAB_MUTATION === "1";
const TEN_MINUTES = 6_000; // ticks
const ONE_HOUR = 36_000;
const demo = (seed = 187, agents: AgentSpec[] = noiseTraders(40, 0.5)) => new Simulation({ seed, agents });
const marketFingerprint = (sim: Simulation) =>
  fingerprint({ fills: sim.engine.fills, bids: sim.engine.book.depth("buy"), asks: sim.engine.book.depth("sell") });

describe("Simulation: same seed → identical market", () => {
  it("two runs of seed 187 produce a byte-identical fill log and book", () => {
    const a = demo();
    const b = demo();
    a.run(TEN_MINUTES);
    b.run(TEN_MINUTES);
    expect(a.engine.fillCount).toBeGreaterThan(1_000);
    expect(marketFingerprint(a)).toBe(marketFingerprint(b));
  });

  it("is pinned: the 10-minute demo market for seed 187 never changes unnoticed", () => {
    // Fingerprint of every fill (price, size, both sides' ids, owners, agent types, limit prices
    // and arrival quotes, times) and the final book. Any change to the engine, the agents, the
    // random numbers or the math that alters the demo market fails here.
    const sim = demo();
    sim.run(TEN_MINUTES);
    expect(marketFingerprint(sim)).toBe(PINNED_DEMO_MARKET);
  });

  it("is pinned with market makers too: 40 noise traders + 2 market makers, 10 minutes, seed 187", () => {
    const sim = demo(187, [...noiseTraders(40, 0.5), ...marketMakers()]);
    sim.run(TEN_MINUTES);
    expect(sim.engine.fills.some((f) => f.buy.agentType === "marketMaker" || f.sell.agentType === "marketMaker")).toBe(true);
    expect(marketFingerprint(sim)).toBe(PINNED_MM_MARKET);
  });

  it("a different seed gives a different market", () => {
    const a = demo(187);
    const b = demo(188);
    a.run(TEN_MINUTES);
    b.run(TEN_MINUTES);
    expect(marketFingerprint(a)).not.toBe(marketFingerprint(b));
  });
});

describe("Simulation: separate arrival and decision streams (D-023)", () => {
  /** Every arrival (agent and exact time) in a run. */
  const arrivalLog = (agents: AgentSpec[]) => {
    const log: string[] = [];
    const sim = new Simulation({ seed: 187, agents, observer: { onArrival: (a) => log.push(`${a.sourceId}@${a.exactMs}`) } });
    sim.run(TEN_MINUTES);
    return { log, fills: sim.engine.fillCount, market: marketFingerprint(sim) };
  };

  it("changing how one trader decides never moves anyone's arrival times", () => {
    const base = noiseTraders(40, 0.5);
    const whatIf = base.map((s) =>
      s.id === "noise-3" ? { ...s, create: (rng: Parameters<AgentSpec["create"]>[0]) => new NoiseTrader(rng, { ...DEFAULT_NOISE_PARAMS, pMarket: 0.9, mu: 30 }) } : s,
    );
    const a = arrivalLog(base);
    const b = arrivalLog(whatIf);
    expect(b.market).not.toBe(a.market); // the behavior change really changed the market
    expect(b.log).toEqual(a.log); // but every arrival happened at exactly the same time
    expect(a.log.length).toBeGreaterThan(10_000);
  });

  it("adding a trader never moves the other traders' arrival times", () => {
    const a = arrivalLog(noiseTraders(40, 0.5));
    const b = arrivalLog(noiseTraders(41, 0.5));
    expect(b.log.filter((x) => !x.startsWith("noise-41@"))).toEqual(a.log);
  });
});

describe.skipIf(MUTATION_RUN)("Simulation: invariants and conservation over one sim-hour", () => {
  // One hour of the demo market, checked after every tick and every order.
  const owners = new Set(noiseTraders(40, 0.5).map((s) => s.id));
  const violations: string[] = [];
  let lastFillTime = -1;
  let windowStart = 0;
  let windowEnd = 0;
  let submits = 0;
  /** Every accepted order, recorded from what was submitted and what the engine reported back. */
  const orders = new Map<string, { owner: string; side: "buy" | "sell"; submitted: number; limit: number | null; cancelled: number }>();
  let sim: Simulation;
  beforeAll(() => {
  sim = new Simulation({
    seed: 187,
    agents: noiseTraders(40, 0.5),
    observer: {
      onArrival: (a) => {
        if (a.timeMs < windowStart || a.timeMs >= windowEnd + 1) violations.push(`arrival ${a.timeMs} outside its tick`);
      },
      onSubmit: (agentId, order, result, time) => {
        submits++;
        if (order.ownerId !== agentId || order.agentType !== "noise") violations.push(`order stamped wrong: ${JSON.stringify(order)}`);
        if (!result.ok) return;
        orders.set(result.orderId, {
          owner: agentId,
          side: order.side,
          submitted: order.qty,
          limit: order.type === "limit" ? order.price : null,
          cancelled: result.cancelledQty, // a market order's unfilled part
        });
        for (const o of result.selfTradeCancelled) orders.get(o.id)!.cancelled += o.qty; // remaining qty at cancel
        for (const f of result.fills) {
          if (!(Number.isSafeInteger(f.price) && Number.isSafeInteger(f.qty) && Number.isSafeInteger(f.price * f.qty))) violations.push(`non-integer fill ${f.seq}`);
          if (f.time !== time || f.time < lastFillTime) violations.push(`fill ${f.seq} time out of order`);
          lastFillTime = f.time;
        }
      },
      onCancel: (_agentId, _orderId, result) => {
        if (result.ok) orders.get(result.order.id)!.cancelled += result.order.qty; // remaining qty at cancel
      },
      onTickEnd: (w) => {
        const bid = sim.engine.book.bestBid();
        const ask = sim.engine.book.bestAsk();
        if (bid !== null && ask !== null && bid >= ask) violations.push(`crossed at ${w.end}`);
        for (const id of owners) if (sim.engine.book.ordersOf(id).length > DEFAULT_NOISE_PARAMS.maxResting) violations.push(`${id} over the resting cap`);
        windowStart = w.end;
        windowEnd = w.end + 100;
      },
    },
  });
  windowEnd = 100;
  sim.run(ONE_HOUR);
  });

  it("never crosses the book, keeps every fill an exact integer and in time order, and stamps every order", () => {
    expect(violations.slice(0, 5)).toEqual([]);
    expect(submits).toBeGreaterThan(40_000);
  });

  it("only ever holds orders from known traders", () => {
    for (const side of ["buy", "sell"] as const) {
      for (const level of sim.engine.book.depth(side)) {
        for (const o of sim.engine.book.ordersAt(side, level.price)) expect(owners.has(o.ownerId)).toBe(true);
      }
    }
  });

  it("conserves every order's shares: submitted = filled (as taker or maker) + resting + cancelled", () => {
    // Independent of how fills are booked: each order's own record (from submit and cancel
    // results) is checked against the fill log AND against what the book actually holds. A fill
    // that takes the wrong quantity off a resting order breaks this.
    const filled = new Map<string, number>();
    for (const f of sim.engine.fills) {
      filled.set(f.buy.orderId, (filled.get(f.buy.orderId) ?? 0) + f.qty);
      filled.set(f.sell.orderId, (filled.get(f.sell.orderId) ?? 0) + f.qty);
    }
    const mismatches: string[] = [];
    let leftTotal = 0;
    let stillResting = 0;
    for (const [id, o] of orders) {
      const left = o.submitted - (filled.get(id) ?? 0) - o.cancelled;
      const resting = sim.engine.book.get(id)?.qty ?? 0;
      if (left !== resting || left < 0) mismatches.push(`${id}: submitted ${o.submitted}, filled ${filled.get(id) ?? 0}, cancelled ${o.cancelled}, but ${resting} resting`);
      leftTotal += left;
      if (resting > 0) stillResting++;
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(orders.size).toBeGreaterThan(30_000);
    // The book's own level totals must equal the sum of what each order has left.
    const depth = [...sim.engine.book.depth("buy"), ...sim.engine.book.depth("sell")];
    expect(depth.reduce((s, l) => s + l.qty, 0)).toBe(leftTotal);
    expect(depth.reduce((s, l) => s + l.orderCount, 0)).toBe(stillResting);
    // And every order in the book is one we saw submitted (no phantom orders).
    for (const side of ["buy", "sell"] as const) {
      for (const l of sim.engine.book.depth(side)) for (const o of sim.engine.book.ordersAt(side, l.price)) expect(orders.has(o.id)).toBe(true);
    }
  });

  it("conserves cash, recomputed from each resting order's own limit price rather than the fill's price field", () => {
    // Every fill must happen at the resting (maker) order's own submitted limit price and within
    // the taker's limit. Cash is then recomputed from those submitted prices, so a fill that
    // reported or charged a different price would show up as a mismatch with the fill log.
    const fromOrders = new Map<string, number>();
    const fromFills = new Map<string, number>();
    const bad: string[] = [];
    for (const f of sim.engine.fills) {
      const maker = f.aggressor === "buy" ? f.sell : f.buy;
      const taker = f.aggressor === "buy" ? f.buy : f.sell;
      const makerLimit = orders.get(maker.orderId)!.limit!;
      const takerLimit = orders.get(taker.orderId)!.limit;
      if (f.price !== makerLimit) bad.push(`fill ${f.seq} at ${f.price}, maker asked ${makerLimit}`);
      if (takerLimit !== null && (f.aggressor === "buy" ? makerLimit > takerLimit : makerLimit < takerLimit)) bad.push(`fill ${f.seq} breaks the taker's limit`);
      fromOrders.set(f.buy.ownerId, (fromOrders.get(f.buy.ownerId) ?? 0) - makerLimit * f.qty);
      fromOrders.set(f.sell.ownerId, (fromOrders.get(f.sell.ownerId) ?? 0) + makerLimit * f.qty);
      fromFills.set(f.buy.ownerId, (fromFills.get(f.buy.ownerId) ?? 0) - f.price * f.qty);
      fromFills.set(f.sell.ownerId, (fromFills.get(f.sell.ownerId) ?? 0) + f.price * f.qty);
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(fromOrders).toEqual(fromFills);
    expect([...fromOrders.values()].reduce((s, x) => s + x, 0)).toBe(0);
    expect(fromOrders.size).toBe(40); // every trader traded
  });

  it("tracks every agent's position and cash exactly as the fills add up", () => {
    const pos = new Map<string, number>();
    const cash = new Map<string, number>();
    for (const f of sim.engine.fills) {
      pos.set(f.buy.ownerId, (pos.get(f.buy.ownerId) ?? 0) + f.qty);
      pos.set(f.sell.ownerId, (pos.get(f.sell.ownerId) ?? 0) - f.qty);
      cash.set(f.buy.ownerId, (cash.get(f.buy.ownerId) ?? 0) - f.price * f.qty);
      cash.set(f.sell.ownerId, (cash.get(f.sell.ownerId) ?? 0) + f.price * f.qty);
    }
    for (const id of owners) {
      expect(sim.positionOf(id), id).toBe(pos.get(id) ?? 0);
      expect(sim.cashOf(id), id).toBe(cash.get(id) ?? 0);
    }
    expect(sim.positionOf("nobody")).toBe(0);
    expect(sim.cashOf("nobody")).toBe(0);
  });

  it("tracks the last trade price", () => {
    const fills = sim.engine.fills;
    expect(sim.lastTradePrice).toBe(fills[fills.length - 1].price);
  });
});

describe.skipIf(MUTATION_RUN)("Simulation: the market is alive (sanity bands for seed 187, one sim-hour; not realism claims)", () => {
  let r: ReturnType<typeof runMarketReport>;
  beforeAll(() => {
    r = runMarketReport(187, ONE_HOUR);
  });

  it("keeps both sides of the book populated", () => {
    expect(r.eitherEmptyShare).toBeLessThan(0.01);
    expect(r.avgBidOrders).toBeGreaterThan(30);
    expect(r.avgAskOrders).toBeGreaterThan(30);
  });

  it("keeps a tight spread and trades every minute", () => {
    expect(r.medianSpread).toBeLessThanOrEqual(2);
    expect(r.avgSpread).toBeLessThan(3);
    expect(r.minutesWithoutTrades).toBe(0);
    expect(r.trades).toBeGreaterThan(5_000); // about 9,000 since D-046 (was 19,500)
  });

  it("stays within ±2% of $187 and has no outsized single-order sweeps (market orders capped at 2,000, D-025)", () => {
    expect(r.low!).toBeGreaterThan(18_700 * 0.98);
    expect(r.high!).toBeLessThan(18_700 * 1.02);
    expect(r.marketOrdersOver2000).toBe(0);
    expect(r.largestSweepSpan).toBeLessThanOrEqual(15);
  });

  it("runs an hour of market fast enough to simulate faster than real time", () => {
    const start = performance.now();
    demo().run(ONE_HOUR);
    expect(performance.now() - start).toBeLessThan(3_000);
  });
});

describe("Simulation: the agent context", () => {
  /** A scripted agent that runs `script` on each arrival. */
  const scripted = (id: string, script: (ctx: AgentContext) => void, ratePerSec = 5): AgentSpec => ({
    id,
    agentType: "user",
    ratePerSec,
    create: (): Agent => ({ act: script }),
  });

  it("stamps the agent's own id and type on its orders and lets it cancel only its own", () => {
    const results: string[] = [];
    let alicesOrder: string | null = null;
    const sim = new Simulation({
      seed: 1,
      agents: [
        scripted("alice", (ctx) => {
          if (alicesOrder === null) {
            const r = ctx.submit({ type: "limit", side: "buy", price: 18_600, qty: 100 });
            if (r.ok) alicesOrder = r.orderId;
          }
        }),
        scripted("mallory", (ctx) => {
          if (alicesOrder !== null) results.push(ctx.cancel(alicesOrder).ok ? "cancelled" : "refused");
        }),
      ],
    });
    sim.run(50);
    expect(alicesOrder).not.toBeNull();
    expect(sim.engine.book.get(alicesOrder!)).toMatchObject({ ownerId: "alice", agentType: "user" });
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results)).toEqual(new Set(["refused"]));
  });

  it("answers UNKNOWN_ORDER, without crashing, for another agent's order or an id that doesn't exist", () => {
    const results: unknown[] = [];
    let othersOrder: string | null = null;
    const sim = new Simulation({
      seed: 4,
      agents: [
        scripted("owner", (ctx) => {
          if (othersOrder === null) {
            const r = ctx.submit({ type: "limit", side: "buy", price: 18_600, qty: 100 });
            if (r.ok) othersOrder = r.orderId;
          }
        }),
        scripted("probe", (ctx) => {
          if (othersOrder !== null && results.length === 0) {
            results.push(ctx.cancel(othersOrder), ctx.cancel("MLAB-999999"));
          }
        }),
      ],
    });
    sim.run(100);
    expect(results).toEqual([
      { ok: false, reason: "UNKNOWN_ORDER", message: `Unknown order id: ${othersOrder}` },
      { ok: false, reason: "UNKNOWN_ORDER", message: "Unknown order id: MLAB-999999" },
    ]);
    expect(sim.engine.book.get(othersOrder!)).toBeDefined(); // still resting
  });

  it("gives agents the time, the opening price and their own orders, and lets them cancel them", () => {
    const seen: Array<[number, number, number]> = [];
    const sim = new Simulation({
      seed: 2,
      startPrice: 25_000,
      agents: [
        scripted("bob", (ctx) => {
          seen.push([ctx.time, ctx.startPrice, ctx.myOrders().length]);
          const mine = ctx.myOrders();
          if (mine.length > 0) expect(ctx.cancel(mine[0].id).ok).toBe(true);
          else ctx.submit({ type: "limit", side: "sell", price: 25_100, qty: 10 });
        }),
      ],
    });
    sim.run(100);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every(([, start]) => start === 25_000)).toBe(true);
    expect(seen.map(([, , n]) => n).slice(0, 4)).toEqual([0, 1, 0, 1]);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
  });

  it("updates lastTradePrice from fills and shows it to agents", () => {
    let lastSeen: number | null = 0;
    const sim = new Simulation({
      seed: 3,
      agents: [
        scripted("maker", (ctx) => {
          if (ctx.myOrders().length === 0) ctx.submit({ type: "limit", side: "sell", price: 18_750, qty: 1_000_000 });
        }),
        scripted("taker", (ctx) => {
          lastSeen = ctx.lastTradePrice;
          ctx.submit({ type: "market", side: "buy", qty: 1 });
        }),
      ],
    });
    expect(sim.lastTradePrice).toBeNull();
    sim.run(100);
    expect(sim.lastTradePrice).toBe(18_750);
    expect(lastSeen).toBe(18_750);
  });

  it("books cash and position for both sides of every fill (fast version of the hour-long check)", () => {
    const sim = new Simulation({
      seed: 3,
      agents: [
        scripted("maker", (ctx) => {
          if (ctx.myOrders().length === 0) ctx.submit({ type: "limit", side: "sell", price: 18_750, qty: 1_000_000 });
        }),
        scripted("taker", (ctx) => {
          ctx.submit({ type: "market", side: "buy", qty: 3 });
        }),
      ],
    });
    sim.run(100);
    const n = sim.engine.fills.length;
    expect(n).toBeGreaterThan(5);
    expect([sim.positionOf("taker"), sim.cashOf("taker")]).toEqual([3 * n, -18_750 * 3 * n]);
    expect([sim.positionOf("maker"), sim.cashOf("maker")]).toEqual([-3 * n, 18_750 * 3 * n]);
    expect([sim.positionOf("nobody"), sim.cashOf("nobody")]).toEqual([0, 0]);
  });

  it("skips volatility samples while either side of the book is empty (D-032)", () => {
    for (const side of ["buy", "sell"] as const) {
      const sim = new Simulation({
        seed: 3,
        agents: [scripted("one-sided", (ctx) => void (ctx.myOrders().length < 3 && ctx.submit({ type: "limit", side, price: side === "buy" ? 18_600 : 18_800, qty: 10 })))],
      });
      sim.run(300); // 30 s: six sample times
      expect(sim.volatility.view.samples, side).toBe(0);
    }
  });

  it("rejects bad configuration", () => {
    expect(() => new Simulation({ seed: 1, agents: [...noiseTraders(2, 1), ...noiseTraders(1, 1)] })).toThrow("Duplicate agent id: noise-1");
    expect(() => new Simulation({ seed: 1, startPrice: 0, agents: [] })).toThrow(/startPrice must be a positive whole number of ticks/);
    expect(() => new Simulation({ seed: 1, startPrice: 18_701, tickSize: 5, agents: [] })).toThrow(/startPrice must be a positive whole number of ticks/);
    expect(() => new Simulation({ seed: 1, startPrice: 187.5, agents: [] })).toThrow(/startPrice must be a positive whole number of ticks/);
    expect(() => demo().run(-1)).toThrow("ticks must be a non-negative integer, got -1");
    expect(() => demo().run(1.5)).toThrow("ticks must be a non-negative integer, got 1.5");
  });

  it("run(0) is allowed and does nothing", () => {
    const sim = demo();
    sim.run(0);
    expect([sim.clock.tickCount, sim.engine.fillCount, sim.engine.book.size]).toEqual([0, 0, 0]);
  });

  it("defaults to MLAB at $187.00 with penny ticks", () => {
    const sim = demo();
    expect([sim.engine.ticker, sim.engine.book.tickSize, sim.startPrice]).toEqual(["MLAB", 1, 18_700]);
  });

  it("counts its agents", () => {
    expect(demo().agentCount).toBe(40);
    expect(demo(187, [...noiseTraders(40, 0.5), ...marketMakers()]).agentCount).toBe(42);
    expect(new Simulation({ seed: 1, agents: [] }).agentCount).toBe(0);
  });
});

// Fingerprints of the 10-minute seed-187 markets (fills + final book). History: re-pinned when
// the ticker became MLAB (D-041, text only); re-pinned when noise traders were spread out (D-046,
// an intended change to the market).
const PINNED_DEMO_MARKET = "6325214896cd887f";
// …with two market makers added.
const PINNED_MM_MARKET = "ef8a7803dfa1d8c7";
