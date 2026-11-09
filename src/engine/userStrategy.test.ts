import { describe, expect, it } from "vitest";
import { createDemoMarket, WARMUP_TICKS } from "./demoMarket";
import { buildOrderReports } from "./executionReport";
import { MarketFeed } from "./feed";
import { maxDrawdownOf, returnsOf, sharpeOf } from "./metrics";
import { presetByCode } from "./presets";
import { Simulation, USER_ID } from "./simulation";
import type { StrategySpec } from "./strategy";
import { fingerprint } from "./testing/fingerprint";

// The student's strategy trading in the real market (D-062): through the student's own order path,
// deterministic, and never touching the student's manual position.

/** The demo strategy: "Buy after a quick 3% drop because panic sellers overshoot." */
const DEMO: StrategySpec = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 };
const FED = presetByCode("FED")!;

const warm = (seed = 187): Simulation => {
  const sim = createDemoMarket(seed);
  sim.run(WARMUP_TICKS);
  return sim;
};
const userFills = (sim: Simulation) => sim.engine.fills.filter((f) => f.buy.ownerId === USER_ID || f.sell.ownerId === USER_ID);
const marketFingerprint = (sim: Simulation) => fingerprint({ fills: sim.engine.fills, bids: sim.engine.book.depth("buy"), asks: sim.engine.book.depth("sell"), decisions: sim.strategy?.decisions ?? [] });

/** Start the demo strategy, send FED 10 s later, and run `seconds` more. Chunk sizes vary how ticks are batched, as frames do. */
function demoRun(seconds: number, chunk = 1): Simulation {
  const sim = warm();
  expect(sim.startStrategy(DEMO).ok).toBe(true);
  sim.run(100);
  expect(sim.applyShock(FED.shock, FED.code).ok).toBe(true);
  for (let done = 0; done < seconds * 10; done += chunk) sim.run(Math.min(chunk, seconds * 10 - done));
  return sim;
}

describe("the demo: a strategy that buys a 3% drop, through FED on seed 187", () => {
  it("enters on the drop with a market order that fills, shows in EXR with its arrival mid, and exits by a rule", () => {
    const sim = demoRun(420); // the 300 s time exit at the latest
    const strat = sim.strategy!;
    const [entry, exit] = strat.decisions;
    expect(entry).toMatchObject({ action: "entry", reason: "entry", side: "buy", qty: 500 });
    expect(entry.mid!).toBeLessThanOrEqual(entry.level!);
    expect(entry.level).toBe(entry.reference! * (1 - 0.03));
    expect(exit).toMatchObject({ action: "exit", side: "sell", reference: entry.mid });
    expect(["stopLoss", "takeProfit", "timeExit"]).toContain(exit.reason);

    // Each decision's order ran through the student's own path, marked as the strategy's.
    const events = sim.userEvents.filter((e) => e.source === "strategy");
    expect(events.map((e) => [e.time, e.side, e.status])).toEqual([
      [entry.time, "buy", "filled"],
      [exit.time, "sell", "filled"],
    ]);
    // In EXR, with an arrival mid, and recognisably the strategy's.
    const reports = buildOrderReports(userFills(sim), USER_ID);
    expect(reports).toHaveLength(2);
    for (const r of reports) {
      expect(sim.isStrategyOrder(r.orderId)).toBe(true);
      expect(r.arrivalMidX2).not.toBeNull();
      expect(r.spreadX2).not.toBeNull();
    }
    // Round trip done: flat, with the P&L of two fills.
    expect([strat.position, strat.trades, sim.desk.position]).toEqual([0, 1, 0]);
    expect(strat.cash).toBe(sim.desk.cash);
  });

  it("is deterministic: same seed + same spec + same commands give the same market, however ticks are batched", () => {
    const a = demoRun(180, 1);
    const b = demoRun(180, 7);
    const c = demoRun(180, 60);
    expect(marketFingerprint(b)).toBe(marketFingerprint(a));
    expect(marketFingerprint(c)).toBe(marketFingerprint(a));
    expect(a.strategy!.equity.values).toEqual(c.strategy!.equity.values);
  });

  it("changes the market only through its own orders: without it, the same seed gives a different fill log", () => {
    const without = warm();
    without.run(100);
    without.applyShock(FED.shock, FED.code);
    without.run(1_800);
    expect(marketFingerprint(demoRun(180))).not.toBe(marketFingerprint(without));
  });
});

describe("starting, stopping and the student's own position", () => {
  it("starts at the start of the next tick, like any command", () => {
    const sim = warm();
    sim.startStrategy(DEMO);
    expect(sim.strategy).toBeNull();
    const t = sim.clock.now;
    sim.step();
    expect(sim.strategy!.startedAt).toBe(t);
  });

  it("never closes the student's manual shares: exits sell only what the strategy bought", () => {
    const sim = warm();
    sim.submitUserOrder({ type: "market", side: "buy", qty: 1_000 });
    sim.run(1);
    expect(sim.desk.position).toBe(1_000);
    sim.startStrategy(DEMO);
    sim.run(100);
    sim.applyShock(FED.shock, FED.code);
    sim.run(4_200);
    expect(sim.strategy!.trades).toBeGreaterThanOrEqual(1);
    expect(sim.strategy!.position).toBe(0);
    expect(sim.desk.position).toBe(1_000);
  });

  it("STOP closes the strategy's position at the market with reason 'stopped', then makes no more decisions", () => {
    const sim = demoRun(0);
    while (!sim.strategy!.inPosition) sim.step();
    const held = sim.strategy!.position;
    expect(held).toBe(500);
    sim.stopStrategy();
    sim.step();
    const last = sim.strategy!.decisions.at(-1)!;
    expect(last).toMatchObject({ action: "exit", reason: "stopped", side: "sell", qty: 500 });
    // Right after FED the bid side is empty for a few seconds (docs/LATER.md): the close is retried
    // once a second until the book takes it.
    for (let i = 0; i < 300 && !sim.strategy!.done; i++) sim.step();
    expect(sim.strategy!.done).toBe(true);
    expect(sim.strategy!.position).toBe(0);
    const closes = sim.userEvents.filter((e) => e.source === "strategy" && e.side === "sell");
    expect(closes.at(-1)!.status).toBe("filled");
    const count = sim.strategy!.decisions.length;
    sim.run(600);
    expect(sim.strategy!.decisions).toHaveLength(count);
  });

  it("starting a new strategy first closes the old one's shares", () => {
    const sim = demoRun(0);
    while (!sim.strategy!.inPosition) sim.step();
    const old = sim.strategy!;
    sim.startStrategy({ ...DEMO, entry: { rule: "sellAfterRise", pct: 0.05, windowSec: 60 } });
    sim.step();
    expect(old.running).toBe(false);
    for (let i = 0; i < 300 && !old.done; i++) sim.step(); // retired, still closing until flat
    expect(old.position).toBe(0);
    expect(sim.strategy).not.toBe(old);
    expect(sim.desk.position).toBe(0);
  });

  it("refuses a spec the engine cannot use, with nothing queued", () => {
    const sim = warm();
    expect(sim.startStrategy({ ...DEMO, qty: Number.NaN })).toMatchObject({ ok: false, reason: "INVALID_STRATEGY" });
    expect(sim.startStrategy({ ...DEMO, entry: { rule: "nope" as never, pct: 0.03, windowSec: 60 } })).toMatchObject({ ok: false, reason: "INVALID_STRATEGY" });
    sim.step();
    expect(sim.strategy).toBeNull();
  });

  it("clamps the spec it runs", () => {
    const sim = warm();
    sim.startStrategy({ ...DEMO, qty: 1e9, entry: { rule: "buyAfterDrop", pct: 3, windowSec: 60 } });
    sim.step();
    expect(sim.strategy!.spec).toMatchObject({ qty: 10_000, entry: { pct: 0.2 } });
  });

  it("shares the student's account, so self-trade prevention cancels a manual order its order would hit (D-008)", () => {
    const sim = demoRun(0);
    while (!sim.strategy!.inPosition) sim.step();
    // Post a manual bid inside a spread of at least 2¢ so it is the best bid, and keep trying until it
    // is still resting there a tick later (an agent may fill it first).
    const twoSidedWide = () => {
      const bid = sim.engine.book.bestBid();
      const ask = sim.engine.book.bestAsk();
      return bid !== null && ask !== null && ask - bid >= 2;
    };
    let price = 0;
    for (let tries = 0; tries < 50; tries++) {
      while (!twoSidedWide()) sim.step();
      price = sim.engine.book.bestBid()! + 1;
      sim.submitUserOrder({ type: "limit", side: "buy", price, qty: 100 });
      sim.step();
      if (sim.desk.openOrders.length === 1 && sim.engine.book.bestBid() === price) break;
      sim.cancelUserOrders();
      sim.step();
    }
    expect(sim.engine.book.bestBid()).toBe(price);
    const fillsBefore = sim.engine.fills.length;
    sim.stopStrategy(); // the strategy's closing sell meets the best bid first: the student's own
    sim.step();
    expect(sim.desk.openOrders).toEqual([]); // cancelled by self-trade prevention, not filled
    const closing = sim.engine.fills.slice(fillsBefore);
    expect(closing.length).toBeGreaterThan(0);
    expect(closing.every((f) => f.buy.ownerId !== USER_ID)).toBe(true);
    expect(sim.engine.fills.some((f) => f.buy.ownerId === f.sell.ownerId)).toBe(false);
  });
});

describe("in the frame", () => {
  it("EXR and the desk include strategy fills (the feed takes them like any fill of the student's)", () => {
    const sim = warm();
    const feed = new MarketFeed(sim, 187);
    feed.frame();
    sim.startStrategy(DEMO);
    feed.advance(100);
    sim.applyShock(FED.shock, FED.code);
    feed.advance(600);
    const frame = feed.frame();
    expect(frame.exr!.orders.length).toBeGreaterThanOrEqual(1);
    expect(frame.exr!.orders.every((o) => o.source === "strategy")).toBe(true);
    expect(frame.userEvents.some((e) => e.source === "strategy")).toBe(true);
  });

  it("sends each decision once, the strategy's own P&L, and metrics equal to the definitions on its equity", () => {
    const sim = warm();
    const feed = new MarketFeed(sim, 187);
    expect(feed.frame().strategy).toBeNull();
    sim.submitUserOrder({ type: "market", side: "buy", qty: 200 }); // a manual trade: in EXR as "manual", not in the strategy
    sim.startStrategy(DEMO);
    feed.advance(100);
    sim.applyShock(FED.shock, FED.code);
    feed.advance(300);
    const a = feed.frame();
    const s = a.strategy!;
    expect(s.status).toBe("running");
    expect(s.newDecisions.map((d) => d.reason)).toEqual(["entry"]);
    expect(feed.frame().strategy!.newDecisions).toEqual([]); // not repeated
    expect(a.exr!.orders.map((o) => o.source)).toEqual(["manual", "strategy"]);
    expect(s.position).toBe(500);
    expect(s.pnl).toBe(Math.round(s.cash + s.position * sim.markPrice()));
    expect(sim.desk.position).toBe(700);

    const runner = sim.strategy!;
    const { values } = runner.equity;
    expect(s.points).toBe(values.length);
    expect(s.sharpe).toEqual(sharpeOf(returnsOf(values, runner.capital!)));
    expect(s.drawdown).toEqual(maxDrawdownOf(values, runner.capital!));
    expect(s.sharpe!.n).toBe(values.length - 1);

    // A new strategy is a new run: its decisions start again from the first.
    // (A 0.1% drop over 300 s is certain after FED, so it enters in its first second.)
    sim.startStrategy({ ...DEMO, entry: { rule: "sellAfterDrop", pct: 0.001, windowSec: 300 } });
    feed.advance(20);
    const b = feed.frame().strategy!;
    expect(b.startedAt).not.toBe(s.startedAt);
    expect(b.newDecisions[0]).toMatchObject({ seq: 0, reason: "entry", side: "sell" });
  });
});
