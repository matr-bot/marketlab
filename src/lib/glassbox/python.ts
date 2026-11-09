import { PERIODS_PER_YEAR, RETURN_INTERVAL_SEC, RISK_FREE_ANNUAL, SESSION_SECONDS, TRADING_DAYS_PER_YEAR } from "@/engine/metrics";
import { measuresDrop, entrySide, type StrategySpec } from "@/engine/strategy";

// The glass box's Python (CLAUDE.md, Glass box rules; D-065). Generated from the StrategySpec by this
// template, never written by the LLM, so the code shown is the code that matches what the engine ran.
// It mirrors src/engine/strategy.ts (the decisions) and src/engine/metrics.ts (Sharpe, drawdown)
// operation for operation, in the same order, so it gives the same decisions and the same numbers
// bit for bit on the same input; strategyPython.test.ts runs it to prove that. Standard library only.

/** A number as a Python literal that parses to the same double: JS prints the shortest round-trip form, as Python does. */
function py(x: number | null): string {
  if (x === null) return "None";
  if (!Number.isFinite(x)) throw new RangeError(`not a finite number: ${x}`);
  return String(x);
}

/** The whole program for this spec. */
export function strategyPython(spec: StrategySpec): string {
  const { rule, pct, windowSec } = spec.entry;
  const side = entrySide(rule);
  const drop = measuresDrop(rule);
  const what = `${side === "buy" ? "Buy" : "Sell short"} when the mid has ${drop ? "fallen" : "risen"} ENTRY_PCT from its ${drop ? "highest" : "lowest"} point in the last WINDOW_SEC seconds.`;
  const entryTest = drop
    ? `            high = max(window)\n            level = high * (1 - ENTRY_PCT)\n            if mid <= level:`
    : `            low = min(window)\n            level = low * (1 + ENTRY_PCT)\n            if mid >= level:`;
  return `# MarketLab strategy, generated from your rules by MarketLab's own templates (not written by an AI).
#
# It decides WHEN to trade from the mid price (halfway between the best bid and the best ask),
# sampled once per sim second, exactly as MarketLab's engine does. In MarketLab each decision then
# becomes a market order in a real order book; the prices you actually got are in EXR, not here.
#
# Run it on the data from this run:  python3 strategy.py run.json
# Standard library only. Prices are in cents.

import json
import math
import sys

# ---- Your rules ----
ENTRY_RULE = "${rule}"
# ${what}
ENTRY_PCT = ${py(pct)}
WINDOW_SEC = ${py(windowSec)}
STOP_LOSS_PCT = ${py(spec.stopLossPct)}  # exit if the mid moves this much against you from your entry mid
TAKE_PROFIT_PCT = ${py(spec.takeProfitPct)}  # exit if the mid moves this much in your favor
TIME_EXIT_SEC = ${py(spec.timeExitSec)}  # exit this many seconds after the entry
SHARES = ${py(spec.qty)}
COOLDOWN_SEC = ${py(spec.cooldownSec)}  # wait after an exit before entering again
SIDE = "${side}"

# ---- How results are measured (the same definitions MarketLab shows) ----
TRADING_DAYS_PER_YEAR = ${TRADING_DAYS_PER_YEAR}
SESSION_SECONDS = ${SESSION_SECONDS}  # 09:30 to 16:00
RETURN_INTERVAL_SEC = ${RETURN_INTERVAL_SEC}  # one return per sim second
PERIODS_PER_YEAR = TRADING_DAYS_PER_YEAR * SESSION_SECONDS / RETURN_INTERVAL_SEC  # ${PERIODS_PER_YEAR}
RISK_FREE_ANNUAL = ${py(RISK_FREE_ANNUAL)}


def decide(mids, start_ms):
    """mids: [[time_ms, mid_cents], ...] once per sim second, oldest first, starting WINDOW_SEC
    before start_ms. Returns the decisions: [time_ms, "entry" or "exit", reason]."""
    decisions = []
    position = None  # (entry_mid, entry_time_ms) while a position is open
    cooldown_until = -1
    for i in range(len(mids)):
        t, mid = mids[i]
        if t < start_ms:
            continue
        if position is not None:
            entry_mid, entry_time = position
            reason = None
            if STOP_LOSS_PCT is not None:
                if SIDE == "buy":
                    level = entry_mid * (1 - STOP_LOSS_PCT)
                    hit = mid <= level
                else:
                    level = entry_mid * (1 + STOP_LOSS_PCT)
                    hit = mid >= level
                if hit:
                    reason = "stopLoss"
            if reason is None and TAKE_PROFIT_PCT is not None:
                if SIDE == "buy":
                    level = entry_mid * (1 + TAKE_PROFIT_PCT)
                    hit = mid >= level
                else:
                    level = entry_mid * (1 - TAKE_PROFIT_PCT)
                    hit = mid <= level
                if hit:
                    reason = "takeProfit"
            if reason is None and TIME_EXIT_SEC is not None and t - entry_time >= TIME_EXIT_SEC * 1000:
                reason = "timeExit"
            if reason is not None:
                decisions.append([t, "exit", reason])
                position = None
                cooldown_until = t + COOLDOWN_SEC * 1000
        else:
            if t < cooldown_until:
                continue
            # The window: every sample from WINDOW_SEC seconds ago up to and including now.
            window = [m for (s, m) in mids[: i + 1] if s >= t - WINDOW_SEC * 1000]
${entryTest}
                decisions.append([t, "entry", "entry"])
                position = (mid, t)
    return decisions


def returns_of(equity, capital):
    """One return per second: the change in equity (cash + shares x mid) as a fraction of capital."""
    return [(equity[i] - equity[i - 1]) / capital for i in range(1, len(equity))]


def sharpe_of(returns):
    """(mean return - risk-free rate) / standard deviation of returns, annualized with the sim clock."""
    n = len(returns)
    if n < 2:
        return None
    total = 0.0
    for r in returns:  # a plain loop on purpose: Python's sum() rounds floats differently (3.12+)
        total += r
    mean = total / n
    squares = 0.0
    for r in returns:
        d = r - mean
        squares += d * d
    sd = math.sqrt(squares / (n - 1))
    if sd == 0:
        return None
    rf_per_period = RISK_FREE_ANNUAL / PERIODS_PER_YEAR
    return (mean - rf_per_period) / sd * math.sqrt(PERIODS_PER_YEAR)


def max_drawdown_of(equity):
    """The largest fall in equity from a running peak, in cents."""
    if len(equity) == 0:
        return None
    peak = equity[0]
    worst = 0
    for e in equity:
        if e > peak:
            peak = e
        if peak - e > worst:
            worst = peak - e
    return worst


if __name__ == "__main__":
    run = json.load(open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin)
    returns = returns_of(run["equity"], run["capital"])
    print(json.dumps({
        "decisions": decide(run["mids"], run["start_ms"]),
        "returns": len(returns),
        "sharpe": sharpe_of(returns),
        "max_drawdown_cents": max_drawdown_of(run["equity"]),
    }))
`;
}

/** The run data the Python reads: what the strategy saw and its equity, as the engine recorded them. */
export interface RunData {
  readonly start_ms: number;
  readonly mids: readonly (readonly [number, number])[];
  readonly equity: readonly number[];
  readonly capital: number;
}
