import { entrySide, measuresDrop, type EntryRule, type StrategySpec } from "@/engine/strategy";
import { formatQty } from "@/lib/format";

// The rules in plain English (D-064, D-065). One description, used by the STRAT preview and the glass
// box, generated from the spec the engine runs, so the words always say what the code does.

export const RULE_LABELS: Record<EntryRule, string> = {
  buyAfterDrop: "BUY AFTER A DROP",
  buyAfterRise: "BUY AFTER A RISE",
  sellAfterRise: "SELL SHORT AFTER A RISE",
  sellAfterDrop: "SELL SHORT AFTER A DROP",
};

/** A fraction as a percent with no trailing zeros: 0.03 → "3%", 0.025 → "2.5%". */
export function pct(x: number): string {
  return `${Number((x * 100).toFixed(4))}%`;
}

export interface RuleLine {
  readonly key: "entry" | "stopLoss" | "takeProfit" | "timeExit" | "cooldown";
  readonly text: string;
}

/** One sentence per rule, in the order the engine checks them. Exits that are off are left out. */
export function describeRules(spec: StrategySpec): RuleLine[] {
  const { rule, pct: p, windowSec } = spec.entry;
  const long = entrySide(rule) === "buy";
  const drop = measuresDrop(rule);
  const shares = `${formatQty(spec.qty)} share${spec.qty === 1 ? "" : "s"}`;
  const close = long ? "Sell" : "Buy back";
  const lines: RuleLine[] = [
    {
      key: "entry",
      text: `${long ? "Buy" : "Sell short"} ${shares} when the mid is ${pct(p)} ${drop ? "below its highest" : "above its lowest"} point of the last ${windowSec} s.`,
    },
  ];
  if (spec.stopLossPct !== null) lines.push({ key: "stopLoss", text: `Stop loss: ${close.toLowerCase()} if the mid moves ${pct(spec.stopLossPct)} ${long ? "below" : "above"} the mid when you entered.` });
  if (spec.takeProfitPct !== null) lines.push({ key: "takeProfit", text: `Take profit: ${close.toLowerCase()} if the mid moves ${pct(spec.takeProfitPct)} ${long ? "above" : "below"} the mid when you entered.` });
  if (spec.timeExitSec !== null) lines.push({ key: "timeExit", text: `Time exit: ${close.toLowerCase()} ${spec.timeExitSec} s after the entry, whatever the price.` });
  lines.push({ key: "cooldown", text: spec.cooldownSec === 0 ? "After an exit, it may enter again the next second." : `After an exit, wait ${spec.cooldownSec} s before entering again.` });
  return lines;
}
