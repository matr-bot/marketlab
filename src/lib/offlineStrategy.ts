import { clampStrategy, type EntryRule, type StrategySpec } from "@/engine/strategy";
import { STRATEGY_DEFAULTS } from "./schemas";

// Offline strategy parser (D-064): when the AI is unavailable, simple menu phrasing still works, so
// the demo sentence ("Buy after a quick 3% drop…") never depends on the network. It only reads what
// is plainly there: a side (buy/long or sell/short), a direction word (drop or rise), and a percent.
// Anything it cannot read clearly gives null, never a guess. The page labels its result as understood
// offline, so it is never mistaken for the AI.

export const OFFLINE_STRATEGY_HELP = "AI unavailable · try simple phrasing: Buy after a 3% drop within 60 seconds, stop loss 2%, take profit 2%.";

const DROP = /\b(drops?|dips?|falls?|fell|declines?|sell-?offs?|crash(es)?|plunges?|slides?|tumbles?)\b/;
const RISE = /\b(rises?|rose|rally|rallies|jumps?|spikes?|surges?|pops?|breakouts?|gains?|climbs?)\b/;
const NUMBER = String.raw`(\d+(?:\.\d+)?)`;

/** Seconds from "90 seconds", "90 s", "2 min", "2 minutes"; null if there is no such phrase. */
function seconds(text: string, pattern: RegExp): number | null {
  const m = pattern.exec(text);
  if (m === null) return null;
  const n = Number(m[1]);
  return /^m/.test(m[2]) ? n * 60 : n;
}

/** The spec simple text plainly says, with the shared defaults for anything it leaves out; null if unclear. */
export function parseStrategyOffline(input: string): StrategySpec | null {
  let text = input.toLowerCase().replace(/,/g, "");
  const stop = new RegExp(String.raw`\bstop(?:[- ]loss)?\s*(?:of|at)?\s*${NUMBER}\s*(?:%|percent)`).exec(text);
  const take = new RegExp(String.raw`\b(?:take[- ]profit|profit target|target)\s*(?:of|at)?\s*${NUMBER}\s*(?:%|percent)`).exec(text);
  const hold = seconds(text, new RegExp(String.raw`\b(?:hold(?: it)?(?: for)?|exit after|time exit(?: of)?)\s*${NUMBER}\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b`));
  const size = new RegExp(String.raw`\b${NUMBER}\s*(?:shares|sh)\b`).exec(text);
  // Remove the exit phrases so their percents are not read as the entry's.
  for (const m of [stop, take]) if (m !== null) text = text.replace(m[0], " ");

  const buyAt = text.search(/\b(buy|long)\b/);
  const sellAt = text.search(/\b(sell|short)\b/);
  if (buyAt === -1 && sellAt === -1) return null;
  const buy = sellAt === -1 || (buyAt !== -1 && buyAt < sellAt);
  const drop = DROP.test(text);
  const rise = RISE.test(text);
  if (drop === rise) return null; // neither, or both: unclear
  const pct = new RegExp(String.raw`${NUMBER}\s*(?:%|percent|pct)`).exec(text);
  if (pct === null) return null;

  const within = seconds(text, new RegExp(String.raw`\b(?:within|in|over)\s*(?:the last\s*)?${NUMBER}\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b`));
  const rule: EntryRule = buy ? (drop ? "buyAfterDrop" : "buyAfterRise") : drop ? "sellAfterDrop" : "sellAfterRise";
  const anyExit = stop !== null || take !== null || hold !== null;
  return clampStrategy({
    entry: { rule, pct: Number(pct[1]) / 100, windowSec: within ?? STRATEGY_DEFAULTS.windowSec },
    stopLossPct: stop !== null ? Number(stop[1]) / 100 : anyExit ? null : STRATEGY_DEFAULTS.stopLossPct,
    takeProfitPct: take !== null ? Number(take[1]) / 100 : anyExit ? null : STRATEGY_DEFAULTS.takeProfitPct,
    timeExitSec: hold ?? (anyExit ? null : STRATEGY_DEFAULTS.timeExitSec),
    qty: size !== null ? Number(size[1]) : STRATEGY_DEFAULTS.qty,
    cooldownSec: STRATEGY_DEFAULTS.cooldownSec,
  });
}
