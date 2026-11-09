import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { maxDrawdownOf, returnsOf, sharpeOf } from "@/engine/metrics";
import { createDemoMarket, WARMUP_TICKS } from "@/engine/demoMarket";
import { MidHistory } from "@/engine/fundamental";
import { presetByCode } from "@/engine/presets";
import { createScenarioMarket, scenarioById } from "@/engine/scenarios";
import type { Simulation } from "@/engine/simulation";
import { StrategyRunner, type StrategySpec } from "@/engine/strategy";
import { strategyPython, type RunData } from "./python";

// The glass box promise (CLAUDE.md; D-065): the Python shown is generated from the spec and matches
// what the engine ran. This runs the generated program with a real Python 3 on the engine's own
// record of a run and requires the same decisions at the same seconds, the same Sharpe and the same
// max drawdown, exactly. It fails, loudly, if python3 is not installed: it is never skipped.

const dir = mkdtempSync(join(tmpdir(), "marketlab-py-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function python(): string {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe" });
    return "python3";
  } catch {
    throw new Error("python3 is required for the glass-box agreement test (D-065) and was not found. Install Python 3; this test is never skipped.");
  }
}

interface Outcome {
  readonly sim: Simulation;
  /** Every whole-second mid sampled by the test itself, independently of the strategy's record. */
  readonly sampled: [number, number][];
}

/** Open a scenario, start `spec`, optionally send a preset `atSec` later, run `seconds`, sampling mids itself. */
function run(scenarioId: string, seed: number, spec: StrategySpec, seconds: number, shock?: { code: string; atSec: number }): Outcome {
  const sampled: [number, number][] = [];
  const sampleFrom = (s: Simulation) => {
    const bid = s.engine.book.bestBid();
    const ask = s.engine.book.bestAsk();
    if (s.clock.now % 1_000 === 0 && bid !== null && ask !== null) sampled.push([s.clock.now, (bid + ask) / 2]);
  };
  // The warm-up, sampled on an identical twin (same seed: a scenario opens on exactly this market),
  // so the window before the start is checked against our own samples, not the engine's history.
  const twin = createDemoMarket(seed);
  for (let i = 0; i < WARMUP_TICKS; i++) {
    twin.step();
    sampleFrom(twin);
  }
  const sim = createScenarioMarket(scenarioById(scenarioId)!, seed);
  expect(sim.clock.now).toBe(twin.clock.now);
  const sample = () => sampleFrom(sim);
  expect(sim.startStrategy(spec).ok).toBe(true);
  const start = sim.clock.now;
  for (let i = 0; i < seconds * 10; i++) {
    if (shock && sim.clock.now === start + shock.atSec * 1_000) sim.applyShock(presetByCode(shock.code)!.shock, shock.code);
    sim.step();
    sample();
  }
  return { sim, sampled };
}

function agree(name: string, { sim, sampled }: Outcome) {
  const runner = sim.strategy!;
  // The record the Python reads is exactly what the market showed each second.
  const seen = runner.mids;
  const first = seen[0][0];
  const last = seen[seen.length - 1][0];
  expect(seen.map(([t, m]) => [t, m])).toEqual(sampled.filter(([t]) => t >= first && t <= last));

  const data: RunData = { start_ms: runner.startedAt, mids: seen, equity: runner.equity.values, capital: runner.capital! };
  const file = join(dir, `${name}.py`);
  const input = join(dir, `${name}.json`);
  writeFileSync(file, strategyPython(runner.spec));
  writeFileSync(input, JSON.stringify(data));
  const out = JSON.parse(execFileSync(python(), ["-I", file, input], { encoding: "utf8" })) as { decisions: [number, string, string][]; returns: number; sharpe: number | null; max_drawdown_cents: number | null };

  const engineDecisions = runner.decisions.filter((d) => d.reason !== "stopped").map((d) => [d.time, d.action, d.reason]);
  expect(out.decisions).toEqual(engineDecisions);
  const returns = returnsOf(runner.equity.values, runner.capital!);
  expect(out.returns).toBe(returns.length);
  expect(out.sharpe).toBe(sharpeOf(returns)?.sharpe ?? null); // exactly, not "close to"
  expect(out.max_drawdown_cents).toBe(maxDrawdownOf(runner.equity.values, runner.capital!)!.drawdown);
  return { engineDecisions, out };
}

/** Run the engine's runner on a scripted series (fills at the mid), then the Python on its record. */
function scripted(name: string, spec: StrategySpec, mids: readonly number[]) {
  const history = new MidHistory();
  const runner = new StrategyRunner(spec, 0);
  mids.forEach((m, sec) => {
    history.onTickEnd(sec * 1_000, m * 2);
    const intent = runner.onTick(sec * 1_000, history);
    if (intent !== null) runner.onFill(intent.side, intent.qty, m);
  });
  const file = join(dir, `${name}.py`);
  const input = join(dir, `${name}.json`);
  writeFileSync(file, strategyPython(spec));
  writeFileSync(input, JSON.stringify({ start_ms: 0, mids: runner.mids, equity: runner.equity.values, capital: runner.capital! } satisfies RunData));
  const out = JSON.parse(execFileSync(python(), ["-I", file, input], { encoding: "utf8" })) as { decisions: [number, string, string][] };
  const engine = runner.decisions.map((d) => [d.time / 1_000, d.action, d.reason]);
  expect(out.decisions.map(([t, a, r]) => [t / 1_000, a, r])).toEqual(engine);
  return engine;
}

describe("the generated Python and the engine agree on every boundary (scripted prices)", () => {
  it("long: entry exactly at the level, with the high exactly WINDOW_SEC back; stop and take profit exactly; entries held off by the cooldown; time exit exactly", () => {
    const s: StrategySpec = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 10 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 20, qty: 100, cooldownSec: 5 };
    const m: number[] = [20_000, ...Array(9).fill(19_900)];
    m[10] = 20_000 * (1 - 0.03); // the high at 0 s is exactly 10 s back: inside the window
    m[11] = m[10] * (1 - 0.02); // stop, exactly
    for (let t = 12; t <= 16; t++) m[t] = 19_000; // the drop rule holds from 12 s, the cooldown ends at 16 s
    m[17] = 19_000 * (1 + 0.02); // take profit, exactly
    for (let t = 18; t <= 21; t++) m[t] = 19_000; // cooldown again until 22 s
    m[22] = m[17] * (1 - 0.03); // entry exactly at the level (the window's high is the 17 s mid)
    for (let t = 23; t <= 44; t++) m[t] = m[22]; // between the levels: only the time exit, exactly at 42 s
    expect(scripted("long-edges", s, m)).toEqual([
      [10, "entry", "entry"],
      [11, "exit", "stopLoss"],
      [16, "entry", "entry"],
      [17, "exit", "takeProfit"],
      [22, "entry", "entry"],
      [42, "exit", "timeExit"],
    ]);
  });

  it("short: entry exactly at a rise, stop and take profit exactly, with no cooldown", () => {
    const s: StrategySpec = { entry: { rule: "sellAfterRise", pct: 0.01, windowSec: 5 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: null, qty: 100, cooldownSec: 0 };
    const m: number[] = [20_000, 20_100, 20_100, 20_100, 20_100];
    m[5] = 20_000 * (1 + 0.01); // the low at 0 s is exactly 5 s back
    m[6] = m[5] * (1 + 0.02); // stop, exactly
    m[7] = 20_100 * (1 + 0.01); // re-entry the next second: the window's low is now 20,100
    m[8] = m[7] / (1 + 0.02); // a near miss: above the take-profit level entry × (1 − 2%), so no exit
    m[9] = m[7] * (1 - 0.02); // take profit, exactly
    expect(scripted("short-edges", s, m)).toEqual([
      [5, "entry", "entry"],
      [6, "exit", "stopLoss"],
      [7, "entry", "entry"],
      [9, "exit", "takeProfit"],
    ]);
  });

  it("the other two rules, exactly at their levels", () => {
    const rise: StrategySpec = { entry: { rule: "buyAfterRise", pct: 0.01, windowSec: 5 }, stopLossPct: null, takeProfitPct: null, timeExitSec: 2, qty: 100, cooldownSec: 0 };
    expect(scripted("rise", rise, [20_000, 20_000 * (1 + 0.01), 20_200, 20_200])).toEqual([
      [1, "entry", "entry"],
      [3, "exit", "timeExit"],
    ]);
    const drop: StrategySpec = { ...rise, entry: { rule: "sellAfterDrop", pct: 0.01, windowSec: 5 } };
    expect(scripted("drop", drop, [20_000, 20_000 * (1 - 0.01), 19_800, 19_800])).toEqual([
      [1, "entry", "entry"],
      [3, "exit", "timeExit"],
    ]);
  });
});

describe("the generated Python and the engine agree (D-065)", () => {
  it("the demo: buy after a 3% drop in 60 s, through FED on seed 187, several round trips", () => {
    const demo: StrategySpec = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 120, qty: 500, cooldownSec: 5 };
    const { engineDecisions, out } = agree("demo", run("free", 187, demo, 900, { code: "FED", atSec: 10 }));
    expect(engineDecisions.length).toBeGreaterThanOrEqual(2);
    expect(out.sharpe).not.toBeNull();
  }, 120_000);

  it("a short: sell after a 0.5% rise in 30 s, with every exit on, through the whipsaw's reversal", () => {
    const short: StrategySpec = { entry: { rule: "sellAfterRise", pct: 0.005, windowSec: 30 }, stopLossPct: 0.01, takeProfitPct: 0.005, timeExitSec: 60, qty: 300, cooldownSec: 0 };
    const { engineDecisions } = agree("short", run("whipsaw", 4104, short, 480));
    expect(new Set(engineDecisions.map((d) => d[2])).size).toBeGreaterThanOrEqual(2); // more than one kind of exit or entry
  }, 120_000);

  it("rise and drop rules on both sides, in a calm market and a crash", () => {
    const rules: StrategySpec["entry"]["rule"][] = ["buyAfterRise", "sellAfterDrop"];
    for (const rule of rules) {
      const spec: StrategySpec = { entry: { rule, pct: 0.002, windowSec: 20 }, stopLossPct: 0.004, takeProfitPct: null, timeExitSec: 45, qty: 200, cooldownSec: 10 };
      agree(`${rule}-calm`, run("free", 187, spec, 300));
      agree(`${rule}-fraud`, run("fraud", 4103, spec, 300));
    }
  }, 240_000);

  it("the program names every rule and number from the spec, and nothing from an AI", () => {
    const code = strategyPython({ entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: null, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 });
    for (const line of ['ENTRY_RULE = "buyAfterDrop"', "ENTRY_PCT = 0.03", "WINDOW_SEC = 60", "STOP_LOSS_PCT = None", "TAKE_PROFIT_PCT = 0.02", "TIME_EXIT_SEC = 300", "SHARES = 500", "COOLDOWN_SEC = 30", "PERIODS_PER_YEAR = TRADING_DAYS_PER_YEAR * SESSION_SECONDS / RETURN_INTERVAL_SEC  # 5896800", "RISK_FREE_ANNUAL = 0.04"]) {
      expect(code).toContain(line);
    }
    expect(code).toContain("high = max(window)");
    expect(code).toContain("not written by an AI");
  });
});
