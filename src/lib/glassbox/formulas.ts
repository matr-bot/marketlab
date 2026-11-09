import type { FrameStrategy } from "@/engine/feed";
import { PERIODS_PER_YEAR, RETURN_INTERVAL_SEC, RISK_FREE_ANNUAL, SESSION_SECONDS, TRADING_DAYS_PER_YEAR } from "@/engine/metrics";
import { formatSimTime } from "@/engine/simClock";
import { entrySide, measuresDrop, type StrategyDecision, type StrategySpec } from "@/engine/strategy";
import { formatQty } from "@/lib/format";

// The glass box's formulas with the student's real numbers in them (CLAUDE.md, Glass box rules;
// D-065). Every number comes from the engine: the decision log (what each rule compared) and the
// metrics the frame carries. The symbols match the Python's names and the engine's definitions.

const thousands = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Cents as dollars, exact for mids (half cents) and to 5 decimals for levels: 18136.575 → "181.36575", 9344750 → "93,447.50". */
export function dollars(cents: number): string {
  const [whole, frac] = Math.abs(cents / 100).toFixed(5).split(".");
  const digits = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${cents < 0 ? "-" : ""}${thousands.format(Number(whole))}.${digits}`;
}

/** Cents as money, sign first: -18300 → "-$183.00". */
export function money(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${dollars(Math.abs(cents))}`;
}

/** A small ratio in scientific notation with 4 significant figures: 0.0000123456 → "1.235e-5". */
export function sci(x: number): string {
  if (x === 0) return "0";
  return x.toExponential(3).replace(/e\+?/, "e");
}

export interface Formula {
  /** What it is, e.g. "ENTRY". */
  readonly name: string;
  /** The formula in symbols. */
  readonly symbolic: string;
  /** The same formula with this run's numbers, or a note when there is none yet. */
  readonly filled: string;
}

const last = (decisions: readonly StrategyDecision[], reason: StrategyDecision["reason"]) => {
  for (let i = decisions.length - 1; i >= 0; i--) if (decisions[i].reason === reason) return decisions[i];
  return null;
};

export function formulas(spec: StrategySpec, decisions: readonly StrategyDecision[], s: Pick<FrameStrategy, "capital" | "sharpe" | "drawdown" | "points"> | null): Formula[] {
  const { rule, pct, windowSec } = spec.entry;
  const long = entrySide(rule) === "buy";
  const drop = measuresDrop(rule);
  const out: Formula[] = [];

  const entry = last(decisions, "entry");
  const refName = drop ? `high(last ${windowSec} s)` : `low(last ${windowSec} s)`;
  out.push({
    name: "ENTRY",
    symbolic: `${long ? "BUY" : "SELL SHORT"} when mid ${drop ? "≤" : "≥"} ${refName} × (1 ${drop ? "−" : "+"} ${pct})`,
    filled:
      entry === null || entry.mid === null || entry.reference === null || entry.level === null
        ? "No entry yet: the rule has not fired."
        : `${formatSimTime(entry.time)}: ${dollars(entry.mid)} ${drop ? "≤" : "≥"} ${dollars(entry.reference)} × ${Number((drop ? 1 - pct : 1 + pct).toFixed(6))} = ${dollars(entry.level)} → ${long ? "BUY" : "SELL SHORT"} ${formatQty(entry.qty)}`,
  });

  const exitRule = (name: string, key: "stopLoss" | "takeProfit", p: number | null, below: boolean) => {
    if (p === null) return;
    const d = last(decisions, key);
    out.push({
      name,
      symbolic: `exit when mid ${below ? "≤" : "≥"} entry mid × (1 ${below ? "−" : "+"} ${p})`,
      filled: d === null || d.mid === null || d.reference === null || d.level === null ? "Not hit yet." : `${formatSimTime(d.time)}: ${dollars(d.mid)} ${below ? "≤" : "≥"} ${dollars(d.reference)} × ${Number((below ? 1 - p : 1 + p).toFixed(6))} = ${dollars(d.level)} → exit`,
    });
  };
  // A long's stop is below its entry and its target above; a short's the other way round.
  exitRule("STOP LOSS", "stopLoss", spec.stopLossPct, long);
  exitRule("TAKE PROFIT", "takeProfit", spec.takeProfitPct, !long);
  if (spec.timeExitSec !== null) {
    const d = last(decisions, "timeExit");
    out.push({ name: "TIME EXIT", symbolic: `exit when t − entry time ≥ ${spec.timeExitSec} s`, filled: d === null ? "Not hit yet." : `${formatSimTime(d.time)}: held ${d.heldSec} s ≥ ${spec.timeExitSec} s → exit` });
  }

  const capital = s?.capital ?? null;
  out.push({
    name: "RETURNS",
    symbolic: "r_t = (E_t − E_(t−1)) ÷ capital, with E = cash + shares × mid, once per sim second",
    filled: capital === null ? "No price seen yet." : `capital = ${formatQty(spec.qty)} shares × the first mid = ${money(capital)} · ${formatQty(Math.max(0, (s?.points ?? 0) - 1))} one-second returns so far`,
  });

  const sh = s?.sharpe ?? null;
  out.push({
    name: "SHARPE",
    symbolic: `(mean(r) − r_f) ÷ sd(r) × √(${TRADING_DAYS_PER_YEAR} × ${formatQty(SESSION_SECONDS)} ÷ ${RETURN_INTERVAL_SEC}), r_f = ${RISK_FREE_ANNUAL} ÷ ${formatQty(PERIODS_PER_YEAR)} per second`,
    filled: sh === null ? "Needs at least two one-second returns that are not all the same." : `(${sci(sh.mean)} − ${sci(sh.rfPerPeriod)}) ÷ ${sci(sh.sd)} × ${sh.annualFactor.toFixed(2)} = ${sh.sharpe.toFixed(2)} · from ${formatQty(sh.n)} one-second returns`,
  });

  const dd = s?.drawdown ?? null;
  out.push({
    name: "MAX DRAWDOWN",
    symbolic: "largest fall of E from its running peak",
    filled: dd === null || capital === null ? "No equity yet." : `${money(dd.peak)} → ${money(dd.trough)} = ${money(dd.drawdown)} (${(dd.pct * 100).toFixed(2)}% of capital)`,
  });
  return out;
}
