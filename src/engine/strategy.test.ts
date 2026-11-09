import { describe, expect, it } from "vitest";
import { MidHistory } from "./fundamental";
import { clampStrategy, DEFAULT_TIME_EXIT_SEC, StrategyRunner, type StrategySpec } from "./strategy";

const spec = (over: Partial<StrategySpec> = {}): StrategySpec => ({
  entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 },
  stopLossPct: 0.02,
  takeProfitPct: 0.02,
  timeExitSec: 300,
  qty: 500,
  cooldownSec: 30,
  ...over,
});

/** Feed whole-second mids (cents) to a real MidHistory and a runner, the way the simulation does. */
function drive(s: StrategySpec, mids: readonly (number | null)[], startSec = 0) {
  const history = new MidHistory();
  const runner = new StrategyRunner(s, startSec * 1_000);
  const intents: { t: number; side: string; qty: number }[] = [];
  mids.forEach((m, i) => {
    const t = (startSec + i) * 1_000;
    history.onTickEnd(t, m === null ? null : m * 2);
    const intent = runner.onTick(t, history);
    if (intent !== null) {
      intents.push({ t, ...intent });
      runner.onFill(intent.side, intent.qty, m!); // fill at the mid, for the test
    }
  });
  return { runner, intents, decisions: runner.decisions };
}

describe("clampStrategy", () => {
  it("clamps every number into its range and rounds seconds and shares", () => {
    const c = clampStrategy(spec({ entry: { rule: "sellAfterRise", pct: 5, windowSec: 9_999.4 }, stopLossPct: 0, takeProfitPct: 9, timeExitSec: 1.2, qty: 1e9, cooldownSec: -3 }));
    expect(c).toEqual({ entry: { rule: "sellAfterRise", pct: 0.2, windowSec: 600 }, stopLossPct: 0.001, takeProfitPct: 0.5, timeExitSec: 5, qty: 10_000, cooldownSec: 0 });
    expect(clampStrategy(spec({ qty: 499.6, entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 59.5 } }))).toMatchObject({ qty: 500, entry: { windowSec: 60 } });
  });

  it("keeps exits that are off, and adds a time exit when none is on", () => {
    expect(clampStrategy(spec({ stopLossPct: null }))).toMatchObject({ stopLossPct: null, takeProfitPct: 0.02, timeExitSec: 300 });
    expect(clampStrategy(spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: null })).timeExitSec).toBe(DEFAULT_TIME_EXIT_SEC);
  });

  it("throws on an unknown rule or a non-finite number (a bug in our code, never market flow)", () => {
    expect(() => clampStrategy(spec({ entry: { rule: "buyTheRumor" as never, pct: 0.03, windowSec: 60 } }))).toThrow(RangeError);
    expect(() => clampStrategy(spec({ qty: Number.NaN }))).toThrow(RangeError);
    expect(() => clampStrategy(spec({ stopLossPct: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
  });
});

describe("StrategyRunner: entries", () => {
  it("buy after a drop: enters when the mid is at or below the window's high × (1 − pct), not a half cent above", () => {
    const high = 20_000;
    const level = high * (1 - 0.03);
    // Above the level by half a cent: nothing. At or below: buy.
    expect(drive(spec(), [high, level + 0.5]).intents).toEqual([]);
    const { intents, decisions } = drive(spec(), [high, 19_700, level]);
    expect(intents).toEqual([{ t: 2_000, side: "buy", qty: 500 }]);
    expect(decisions[0]).toMatchObject({ seq: 0, time: 2_000, action: "entry", reason: "entry", side: "buy", qty: 500, mid: level, reference: high, level, heldSec: null });
  });

  it("only looks back windowSec: an older high does not count", () => {
    const s = spec({ entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 5 } });
    // 200.00 six seconds before the dip is outside a 5 s window; the high inside it is 195.00.
    expect(drive(s, [20_000, 19_500, 19_500, 19_500, 19_500, 19_500, 19_000]).intents).toEqual([]);
    expect(drive(s, [20_000, 19_500, 19_500, 19_500, 19_500, 19_400]).intents).toHaveLength(1); // 200.00 still inside
  });

  it("rise rules measure from the window's low; sell rules go short", () => {
    const low = 20_000;
    expect(drive(spec({ entry: { rule: "buyAfterRise", pct: 0.01, windowSec: 60 } }), [low, low * (1 + 0.01)]).intents).toEqual([{ t: 1_000, side: "buy", qty: 500 }]);
    expect(drive(spec({ entry: { rule: "sellAfterRise", pct: 0.01, windowSec: 60 } }), [low, low * (1 + 0.01)]).intents).toEqual([{ t: 1_000, side: "sell", qty: 500 }]);
    expect(drive(spec({ entry: { rule: "sellAfterDrop", pct: 0.01, windowSec: 60 } }), [low, low * (1 - 0.01)]).intents).toEqual([{ t: 1_000, side: "sell", qty: 500 }]);
  });

  it("acts only on whole seconds with a mid: other ticks and one-sided seconds are skipped", () => {
    const history = new MidHistory();
    const runner = new StrategyRunner(spec(), 0);
    history.onTickEnd(0, 40_000);
    expect(runner.onTick(0, history)).toBeNull();
    expect(runner.onTick(100, history)).toBeNull(); // not a whole second
    expect(runner.onTick(1_000, history)).toBeNull(); // no sample at 1 s
    expect(runner.equity.values).toEqual([0]); // only the second with a mid is recorded
    expect(runner.capital).toBe(500 * 20_000);
  });
});

describe("StrategyRunner: exits", () => {
  const enterAt = 19_400; // entry mid after a drop from 200.00
  it("stop loss: the mid at or below the entry mid × (1 − stop), for a long", () => {
    const { intents, decisions } = drive(spec(), [20_000, enterAt, 19_100, enterAt * (1 - 0.02)]);
    expect(intents).toEqual([
      { t: 1_000, side: "buy", qty: 500 },
      { t: 3_000, side: "sell", qty: 500 },
    ]);
    expect(decisions[1]).toMatchObject({ action: "exit", reason: "stopLoss", side: "sell", qty: 500, reference: enterAt, level: enterAt * (1 - 0.02), heldSec: 2 });
  });

  it("take profit: the mid at or above the entry mid × (1 + take profit)", () => {
    const { decisions } = drive(spec(), [20_000, enterAt, enterAt * (1 + 0.02)]);
    expect(decisions.map((d) => d.reason)).toEqual(["entry", "takeProfit"]);
  });

  it("time exit after exactly timeExitSec", () => {
    const s = spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: 3 });
    const { decisions } = drive(s, [20_000, enterAt, enterAt, enterAt, enterAt]);
    expect(decisions.map((d) => [d.reason, d.time])).toEqual([
      ["entry", 1_000],
      ["timeExit", 4_000],
    ]);
    expect(decisions[1]).toMatchObject({ level: null, heldSec: 3 });
  });

  it("a short's stop is above its entry and its take profit below", () => {
    const s = spec({ entry: { rule: "sellAfterRise", pct: 0.01, windowSec: 60 } });
    const up = 20_000 * (1 + 0.01);
    expect(drive(s, [20_000, up, up * (1 + 0.02)]).decisions.map((d) => [d.reason, d.side])).toEqual([
      ["entry", "sell"],
      ["stopLoss", "buy"],
    ]);
    expect(drive(s, [20_000, up, up * (1 - 0.02)]).decisions.map((d) => d.reason)).toEqual(["entry", "takeProfit"]);
  });

  it("waits out the cooldown after an exit before entering again", () => {
    const s = spec({ cooldownSec: 2, stopLossPct: null, takeProfitPct: null, timeExitSec: 5 });
    // Entry at 1 s, time exit at 6 s; the drop condition holds throughout, so re-entry comes at 8 s, not 7 s.
    const { decisions } = drive(s, [20_000, ...Array(9).fill(19_000)]);
    expect(decisions.map((d) => [d.reason, d.time / 1_000])).toEqual([
      ["entry", 1],
      ["timeExit", 6],
      ["entry", 8],
    ]);
  });

  it("an exit closes only the strategy's own filled shares; with none, it is logged but sends nothing", () => {
    const history = new MidHistory();
    const runner = new StrategyRunner(spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: 5 }), 0);
    history.onTickEnd(0, 40_000);
    runner.onTick(0, history);
    history.onTickEnd(1_000, 38_000);
    expect(runner.onTick(1_000, history)).toEqual({ side: "buy", qty: 500 });
    runner.onFill("buy", 120, 19_005); // only part of the market order filled
    for (let t = 2; t <= 6; t++) history.onTickEnd(t * 1_000, 38_000);
    for (let t = 2; t < 6; t++) expect(runner.onTick(t * 1_000, history)).toBeNull();
    expect(runner.onTick(6_000, history)).toEqual({ side: "sell", qty: 120 });
    expect(runner.trades).toBe(1);

    const empty = drive(spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: 1 }), []); // never entered
    expect(empty.runner.trades).toBe(0);
    const noFill = new StrategyRunner(spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: 1 }), 0);
    const h = new MidHistory();
    h.onTickEnd(0, 40_000);
    noFill.onTick(0, h);
    h.onTickEnd(1_000, 38_000);
    noFill.onTick(1_000, h); // entry decided, nothing filled
    h.onTickEnd(2_000, 38_000);
    expect(noFill.onTick(2_000, h)).toBeNull();
    expect(noFill.decisions.at(-1)).toMatchObject({ reason: "timeExit", qty: 0 });
    expect(noFill.trades).toBe(0);
  });
});

describe("StrategyRunner: stop, P&L and equity", () => {
  it("stop closes an open position with reason 'stopped' and ends all decisions", () => {
    const { runner } = drive(spec(), [20_000, 19_400]);
    expect(runner.stop(1_500, 19_401)).toEqual({ side: "sell", qty: 500 });
    expect(runner.decisions.at(-1)).toMatchObject({ reason: "stopped", time: 1_500, mid: 19_401, level: null });
    expect(runner.running).toBe(false);
    expect(runner.stop(1_600, 19_401)).toBeNull();
    runner.onFill("sell", 500, 19_400);
    const h = new MidHistory();
    h.onTickEnd(2_000, 30_000);
    expect(runner.onTick(2_000, h)).toBeNull();
    expect(runner.done).toBe(true);
    h.onTickEnd(3_000, 10_000); // a crash after the stop: still no decisions
    expect(runner.onTick(3_000, h)).toBeNull();
    expect(runner.decisions.at(-1)!.reason).toBe("stopped");
  });

  it("retries closing leftover shares once a second until flat, with no entries meanwhile and no extra decisions", () => {
    const s = spec({ stopLossPct: null, takeProfitPct: null, timeExitSec: 2, cooldownSec: 0 });
    const history = new MidHistory();
    const runner = new StrategyRunner(s, 0);
    const tick = (sec: number, mid: number) => {
      history.onTickEnd(sec * 1_000, mid * 2);
      return runner.onTick(sec * 1_000, history);
    };
    tick(0, 20_000);
    expect(tick(1, 19_000)).toEqual({ side: "buy", qty: 500 });
    runner.onFill("buy", 500, 19_000);
    tick(2, 19_000);
    expect(tick(3, 19_000)).toEqual({ side: "sell", qty: 500 }); // time exit; the book takes none of it
    expect(runner.isClosing).toBe(true);
    expect(tick(4, 19_000)).toEqual({ side: "sell", qty: 500 }); // retried, though the drop rule would enter
    runner.onFill("sell", 300, 19_000);
    expect(tick(5, 19_000)).toEqual({ side: "sell", qty: 200 });
    runner.onFill("sell", 200, 19_000);
    expect(tick(6, 19_000)).toEqual({ side: "buy", qty: 500 }); // flat again: the rules run in the same second
    expect(runner.decisions.map((d) => [d.reason, d.time / 1_000])).toEqual([
      ["entry", 1],
      ["timeExit", 3],
      ["entry", 6],
    ]);
  });

  it("a stop that cannot close keeps closing after the stop, then is done", () => {
    const { runner } = drive(spec(), [20_000, 19_400]);
    expect(runner.stop(1_500, null)).toEqual({ side: "sell", qty: 500 }); // the book takes none of it
    expect(runner.done).toBe(false);
    const h = new MidHistory();
    expect(runner.onTick(2_000, h)).toEqual({ side: "sell", qty: 500 }); // retried even without a mid
    runner.onFill("sell", 500, 19_300);
    expect(runner.onTick(3_000, h)).toBeNull();
    expect(runner.done).toBe(true);
  });

  it("stopping while flat sends nothing and logs nothing", () => {
    const runner = new StrategyRunner(spec(), 0);
    expect(runner.stop(0, null)).toBeNull();
    expect(runner.decisions).toEqual([]);
  });

  it("books its own fills and records equity = cash + shares × mid each second, before that second's decision", () => {
    const { runner } = drive(spec(), [20_000, 19_400, 19_600]);
    expect([runner.position, runner.cash]).toEqual([500, -500 * 19_400]);
    expect(runner.equity.values).toEqual([0, 0, -500 * 19_400 + 500 * 19_600]);
    expect(runner.equity.times).toEqual([0, 1_000, 2_000]);
  });
});
