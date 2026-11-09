import { describe, expect, it } from "vitest";
import { sharpeOf } from "@/engine/metrics";
import type { StrategyDecision, StrategySpec } from "@/engine/strategy";
import { dollars, formulas, sci } from "./formulas";

const SPEC: StrategySpec = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 };
const at = (min: number, sec: number) => (min * 60 + sec) * 1_000; // sim ms from 09:30
const entry: StrategyDecision = { seq: 0, time: at(11, 12), action: "entry", reason: "entry", side: "buy", qty: 500, mid: 18_116, reference: 18_697.5, level: 18_697.5 * (1 - 0.03), heldSec: null };
const stop: StrategyDecision = { seq: 1, time: at(11, 40), action: "exit", reason: "stopLoss", side: "sell", qty: 500, mid: 17_750, reference: 18_116, level: 18_116 * (1 - 0.02), heldSec: 28 };

describe("number formats", () => {
  it("dollars: exact for half cents, thousands separated, 5 decimals for levels", () => {
    expect([dollars(18_116), dollars(18_116.5), dollars(18_136.575), dollars(9_344_750), dollars(-250)]).toEqual(["181.16", "181.165", "181.36575", "93,447.50", "-2.50"]);
  });
  it("sci: four significant figures", () => {
    expect([sci(0.0000123456), sci(-0.5), sci(0)]).toEqual(["1.235e-5", "-5.000e-1", "0"]);
  });
});

describe("formulas: symbols and this run's numbers", () => {
  it("before anything happens, says so instead of inventing numbers", () => {
    const f = formulas(SPEC, [], null);
    expect(f.map((x) => x.name)).toEqual(["ENTRY", "STOP LOSS", "TAKE PROFIT", "TIME EXIT", "RETURNS", "SHARPE", "MAX DRAWDOWN"]);
    expect(f[0]).toEqual({ name: "ENTRY", symbolic: "BUY when mid ≤ high(last 60 s) × (1 − 0.03)", filled: "No entry yet: the rule has not fired." });
    expect(f.find((x) => x.name === "SHARPE")!.filled).toBe("Needs at least two one-second returns that are not all the same.");
  });

  it("fills each rule with the numbers its last decision compared", () => {
    const f = formulas(SPEC, [entry, stop], { capital: 500 * 18_697.5, sharpe: null, drawdown: { drawdown: 18_300, pct: 18_300 / (500 * 18_697.5), peak: 0, trough: -18_300 }, points: 31 });
    expect(f[0].filled).toBe("09:41:12.000: 181.16 ≤ 186.975 × 0.97 = 181.36575 → BUY 500");
    expect(f[1]).toEqual({ name: "STOP LOSS", symbolic: "exit when mid ≤ entry mid × (1 − 0.02)", filled: "09:41:40.000: 177.50 ≤ 181.16 × 0.98 = 177.5368 → exit" });
    expect(f[2].filled).toBe("Not hit yet.");
    expect(f.find((x) => x.name === "RETURNS")!.filled).toBe("capital = 500 shares × the first mid = $93,487.50 · 30 one-second returns so far");
    expect(f.find((x) => x.name === "MAX DRAWDOWN")!.filled).toBe("$0.00 → -$183.00 = $183.00 (0.20% of capital)");
  });

  it("a short's stop is above its entry and its take profit below", () => {
    const f = formulas({ ...SPEC, entry: { rule: "sellAfterRise", pct: 0.01, windowSec: 30 } }, [], null);
    expect(f[0].symbolic).toBe("SELL SHORT when mid ≥ low(last 30 s) × (1 + 0.01)");
    expect(f[1].symbolic).toBe("exit when mid ≥ entry mid × (1 + 0.02)");
    expect(f[2].symbolic).toBe("exit when mid ≤ entry mid × (1 − 0.02)");
  });

  it("the Sharpe line shows the engine's own parts and how many returns are behind it", () => {
    const sh = sharpeOf([0.0001, -0.00005, 0.00002])!;
    const line = formulas(SPEC, [], { capital: 1, sharpe: sh, drawdown: null, points: 4 }).find((x) => x.name === "SHARPE")!;
    expect(line.symbolic).toBe("(mean(r) − r_f) ÷ sd(r) × √(252 × 23,400 ÷ 1), r_f = 0.04 ÷ 5,896,800 per second");
    expect(line.filled).toBe(`(${sci(sh.mean)} − ${sci(sh.rfPerPeriod)}) ÷ ${sci(sh.sd)} × 2428.33 = ${sh.sharpe.toFixed(2)} · from 3 one-second returns`);
  });
});
