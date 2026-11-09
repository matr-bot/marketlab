import { describe, expect, it } from "vitest";
import type { AgentSpec } from "./agents/agent";
import { createDemoMarket, WARMUP_TICKS } from "./demoMarket";
import { buildOrderReports } from "./executionReport";
import { PRESETS } from "./presets";
import { MAX_PENDING_USER_COMMANDS, MAX_SCHEDULED_SHOCKS, MAX_USER_ORDER_QTY, MAX_USER_POSITION, Simulation, USER_EVENT_HISTORY, USER_ID, type UserOrder } from "./simulation";
import { fingerprint } from "./testing/fingerprint";

const warm = (seed = 187, ticks = WARMUP_TICKS): Simulation => {
  const sim = createDemoMarket(seed);
  sim.run(ticks);
  return sim;
};
const marketFingerprint = (sim: Simulation) => fingerprint({ fills: sim.engine.fills, bids: sim.engine.book.depth("buy"), asks: sim.engine.book.depth("sell") });
const queued = (r: { ok: boolean }) => expect(r.ok).toBe(true);
const mid = (sim: Simulation) => (sim.engine.book.bestBid()! + sim.engine.book.bestAsk()!) / 2;
const userFills = (sim: Simulation) => sim.engine.fills.filter((f) => f.buy.ownerId === USER_ID || f.sell.ownerId === USER_ID);

describe("the student's orders (submitUserOrder)", () => {
  it("a market buy trades at the ask at the start of the next tick and the desk shows it", () => {
    const sim = warm();
    const ask = sim.engine.book.bestAsk()!;
    queued(sim.submitUserOrder({ type: "market", side: "buy", qty: 300 }));
    expect(sim.desk.position).toBe(0); // nothing happens until the tick runs
    sim.step();
    const [e] = sim.userEvents;
    expect(e).toMatchObject({ kind: "order", side: "buy", orderType: "market", requestedQty: 300, status: "filled", filledQty: 300, restingQty: 0, cancelledQty: 0, reason: null });
    expect(e.avgPrice!).toBeGreaterThanOrEqual(ask);
    const { desk } = sim;
    expect(desk.position).toBe(300);
    expect(desk.cash).toBe(-Math.round(e.avgPrice! * 300));
    expect(desk.openOrders).toEqual([]);
    // Every fill carries owner "user" and agent type "user" on the student's side.
    const fills = userFills(sim);
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) expect(f.buy.ownerId === USER_ID ? f.buy.agentType : f.sell.agentType).toBe("user");
  });

  it("the student's own size moves the price: a big buy pushes the mid and the average fill above the quote", () => {
    const control = warm();
    const sim = warm();
    const ask0 = sim.engine.book.bestAsk()!;
    const mid0 = mid(sim);
    expect(mid(control)).toBe(mid0); // identical until the student acts
    queued(sim.submitUserOrder({ type: "market", side: "buy", qty: 8_000 }));
    sim.step();
    control.step();
    const [e] = sim.userEvents;
    expect(e.filledQty).toBeGreaterThan(2_000); // swept several levels
    expect(e.avgPrice!).toBeGreaterThan(ask0); // paid more than the quote on the screen: slippage
    expect(sim.lastTradePrice!).toBeGreaterThan(ask0);
    expect(mid(sim)).toBeGreaterThan(mid(control)); // the market is higher than it would have been
    // Slippage is exact in the execution report and positive (a cost) for a buyer who swept the book.
    const [r] = buildOrderReports(sim.engine.fills, USER_ID);
    expect(r.qty).toBe(e.filledQty);
    expect(r.slippageX2!).toBeGreaterThan(0);
    expect(r.spreadX2! + r.impactX2!).toBe(r.slippageX2);
    expect(r.impactX2!).toBeGreaterThan(0);
  });

  it("is deterministic: same seed + same orders at the same ticks → the identical market; a different order → a different one", () => {
    const run = (qty: number) => {
      const sim = warm();
      sim.run(10);
      queued(sim.submitUserOrder({ type: "market", side: "sell", qty }));
      queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 400, price: sim.engine.book.bestBid()! }));
      sim.run(200);
      return marketFingerprint(sim);
    };
    expect(run(500)).toBe(run(500));
    expect(run(500)).not.toBe(run(900));
  });

  it("books cash and position exactly from the fill log, and P&L is cash + position × mark", () => {
    const sim = warm();
    const script: [number, UserOrder][] = [
      [0, { type: "market", side: "buy", qty: 1_200 }],
      [30, { type: "market", side: "sell", qty: 700 }],
      [60, { type: "limit", side: "buy", qty: 500, price: sim.engine.book.bestBid()! + 3 }],
      [90, { type: "market", side: "sell", qty: 2_000 }],
    ];
    let t = 0;
    for (const [at, order] of script) {
      sim.run(at - t);
      t = at;
      queued(sim.submitUserOrder(order));
    }
    sim.run(300);
    const fills = userFills(sim);
    let shares = 0;
    let cash = 0;
    for (const f of fills) {
      const sign = f.buy.ownerId === USER_ID ? 1 : -1;
      shares += sign * f.qty;
      cash -= sign * f.price * f.qty;
    }
    const { desk } = sim;
    expect([desk.position, desk.cash]).toEqual([shares, cash]);
    expect(desk.pnl).toBe(Math.round(cash + shares * desk.mark));
    // The sum of all agents' positions is zero: every share the student holds is somebody else's short.
    let net = 0;
    for (const id of ["mm-1", "mm-2", ...Array.from({ length: 40 }, (_, i) => `noise-${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `value-${i + 1}`), ...Array.from({ length: 20 }, (_, i) => `panic-${i + 1}`), USER_ID]) net += sim.positionOf(id);
    expect(net).toBe(0);
  });

  it("a limit order below the market rests, shows as open, and cancel-all removes it", () => {
    const sim = warm();
    const bid = sim.engine.book.bestBid()!;
    queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 700, price: bid - 50 }));
    sim.step();
    const [placed] = sim.userEvents;
    expect(placed).toMatchObject({ status: "resting", filledQty: 0, restingQty: 700, avgPrice: null, limitPrice: bid - 50 });
    expect(sim.desk.openOrders).toEqual([expect.objectContaining({ side: "buy", price: bid - 50, qty: 700 })]);
    queued(sim.cancelUserOrders());
    sim.step();
    expect(sim.userEvents[1]).toMatchObject({ kind: "cancel", status: "cancelled", cancelledQty: 1, message: "Cancelled 1 open order." });
    expect(sim.desk.openOrders).toEqual([]);
    queued(sim.cancelUserOrders());
    sim.step();
    expect(sim.userEvents[2].message).toBe("No open orders to cancel.");
  });

  it("a limit order that crosses fills at the resting prices, never worse than its limit", () => {
    const sim = warm();
    const ask = sim.engine.book.bestAsk()!;
    queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 400, price: ask + 2 }));
    sim.step();
    const [e] = sim.userEvents;
    expect(e.filledQty).toBeGreaterThan(0);
    expect(e.avgPrice!).toBeLessThanOrEqual(ask + 2);
  });
});

describe("the student's orders: refusals come back as data, never as a crash", () => {
  it("rejects a bad size at once and nothing is queued", () => {
    const sim = warm();
    expect(sim.submitUserOrder({ type: "market", side: "buy", qty: 0 })).toMatchObject({ ok: false, reason: "INVALID_QTY" });
    expect(sim.submitUserOrder({ type: "market", side: "buy", qty: 12.5 })).toMatchObject({ ok: false, reason: "INVALID_QTY" });
    expect(sim.submitUserOrder({ type: "market", side: "buy", qty: MAX_USER_ORDER_QTY + 1 })).toMatchObject({ ok: false, reason: "ORDER_TOO_LARGE" });
    sim.step();
    expect(sim.userEvents).toEqual([]);
  });

  it("a bad price is rejected by the engine when the tick runs, with its reason code", () => {
    const sim = warm();
    queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 100, price: -5 }));
    queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 100, price: 18_700.5 }));
    sim.step();
    expect(sim.userEvents.map((e) => [e.status, e.reason])).toEqual([
      ["rejected", "INVALID_PRICE"],
      ["rejected", "INVALID_PRICE"],
    ]);
    expect(sim.desk.position).toBe(0);
  });

  it("refuses commands beyond the queue limit until the tick drains it", () => {
    const sim = warm();
    for (let i = 0; i < MAX_PENDING_USER_COMMANDS; i++) queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 100, price: 100 }));
    expect(sim.submitUserOrder({ type: "market", side: "buy", qty: 100 })).toMatchObject({ ok: false, reason: "QUEUE_FULL" });
    expect(sim.cancelUserOrders()).toMatchObject({ ok: false, reason: "QUEUE_FULL" });
    sim.step();
    queued(sim.submitUserOrder({ type: "market", side: "buy", qty: 100 }));
  });

  it("will not let the position grow past the limit, but always lets the student reduce it", () => {
    // A market with one deep seller and one deep buyer, so the student can really reach the limit.
    const deep = (side: "buy" | "sell"): AgentSpec => ({
      id: `deep-${side}`,
      agentType: "whale",
      ratePerSec: 5,
      create: () => ({
        act(ctx) {
          if (ctx.myOrders().length === 0) ctx.submit({ type: "limit", side, price: side === "sell" ? 18_702 : 18_698, qty: 2_000_000 });
        },
      }),
    });
    const sim = new Simulation({ seed: 7, agents: [deep("sell"), deep("buy")] });
    sim.run(100); // both walls are up
    expect(sim.engine.book.bestAsk()).toBe(18_702);

    // 5 × 100,000 = 500,000 is exactly the limit and is allowed.
    for (let i = 0; i < 5; i++) queued(sim.submitUserOrder({ type: "market", side: "buy", qty: MAX_USER_ORDER_QTY }));
    sim.step();
    expect(sim.desk.position).toBe(MAX_USER_POSITION);
    expect(sim.userEvents.map((e) => e.status)).toEqual(["filled", "filled", "filled", "filled", "filled"]);

    // One more share long is refused with its reason, and nothing trades.
    queued(sim.submitUserOrder({ type: "market", side: "buy", qty: 1 }));
    sim.step();
    expect(sim.userEvents.at(-1)).toMatchObject({ status: "rejected", reason: "POSITION_LIMIT", filledQty: 0 });
    expect(sim.desk.position).toBe(MAX_USER_POSITION);

    // Reducing is always allowed, even all the way through zero to the short limit.
    queued(sim.submitUserOrder({ type: "market", side: "sell", qty: MAX_USER_ORDER_QTY }));
    sim.step();
    expect(sim.desk.position).toBe(MAX_USER_POSITION - MAX_USER_ORDER_QTY);
    for (let i = 0; i < 9; i++) queued(sim.submitUserOrder({ type: "market", side: "sell", qty: MAX_USER_ORDER_QTY })); // 400,000 − 900,000 = −500,000
    sim.step();
    expect(sim.desk.position).toBe(-MAX_USER_POSITION);
    queued(sim.submitUserOrder({ type: "market", side: "sell", qty: 1 }));
    sim.step();
    expect(sim.userEvents.at(-1)).toMatchObject({ status: "rejected", reason: "POSITION_LIMIT" });
  });

  it("keeps only the last USER_EVENT_HISTORY outcomes, with ever-increasing seq numbers", () => {
    const sim = warm();
    for (let i = 0; i < USER_EVENT_HISTORY + 20; i++) {
      queued(sim.submitUserOrder({ type: "limit", side: "buy", qty: 100, price: 100 }));
      sim.step();
    }
    const log = sim.userEvents;
    expect(log).toHaveLength(USER_EVENT_HISTORY);
    expect(log[0].seq).toBe(20);
    expect(log.at(-1)!.seq).toBe(USER_EVENT_HISTORY + 19);
  });
});

describe("scheduled headlines (scenarios)", () => {
  it("are applied at the first tick at or after their time, before any agent acts, in time order", () => {
    const sim = warm();
    const now = sim.clock.now;
    const fed = PRESETS[0].shock;
    sim.scheduleShock(now + 5_000, fed, "LATE", "The second headline");
    sim.scheduleShock(now + 1_050, fed, "EARLY"); // not on the 100 ms grid: applied at the next tick start
    sim.run(100);
    expect(sim.shocks.map((s) => [s.label, s.time, s.headline])).toEqual([
      ["EARLY", now + 1_100, undefined],
      ["LATE", now + 5_000, "The second headline"],
    ]);
    expect(sim.shocks[1].fairValueAfter).toBeLessThan(sim.shocks[1].fairValueBefore);
  });

  it("behave exactly like typing the same headline at the same tick: the identical market", () => {
    const typed = warm();
    typed.run(50);
    typed.applyShock(PRESETS[1].shock, "CEO");
    typed.run(300);

    const scheduled = warm();
    scheduled.scheduleShock(scheduled.clock.now + 5_000, PRESETS[1].shock, "CEO"); // the tick that starts 50 ticks from now
    scheduled.run(350);
    expect(marketFingerprint(scheduled)).toBe(marketFingerprint(typed));
  });

  it("are not rate-limited like typed headlines, and refuse nonsense up front", () => {
    const sim = warm();
    const t = sim.clock.now;
    for (let i = 0; i < 5; i++) sim.scheduleShock(t + 100 * (i + 1), PRESETS[3].shock, `S${i}`); // 100 ms apart
    sim.run(6);
    expect(sim.shocks).toHaveLength(5);
    expect(() => sim.scheduleShock(-1, PRESETS[0].shock, "X")).toThrow(RangeError);
    expect(() => sim.scheduleShock(100.5, PRESETS[0].shock, "X")).toThrow(RangeError);
    expect(() => sim.scheduleShock(100, { fairValuePct: Number.NaN, panicSensitivity: 1, durationSec: 60, volatilityMultiplier: 1, liquidityMultiplier: 1 }, "X")).toThrow(RangeError);
    const full = warm();
    for (let i = 0; i < MAX_SCHEDULED_SHOCKS; i++) full.scheduleShock(1_000_000 + i, PRESETS[3].shock, `S${i}`);
    expect(() => full.scheduleShock(2_000_000, PRESETS[3].shock, "ONE TOO MANY")).toThrow(RangeError);
  });
});
