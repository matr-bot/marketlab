import { wholePercents, type Attribution } from "@/engine/attribution";
import type { AgentType } from "@/engine/types";

/** WHO's fixed rows, always in this order (D-076). Momentum and whale traders are cut (CLAUDE.md). */
export const WHO_ROWS: ReadonlyArray<{ readonly type: AgentType; readonly label: string; readonly name: string }> = [
  { type: "marketMaker", label: "MM", name: "Market makers" },
  { type: "noise", label: "NOISE", name: "Noise traders" },
  { type: "value", label: "VALUE", name: "Value traders" },
  { type: "panic", label: "PANIC", name: "Panic sellers" },
  { type: "user", label: "YOU", name: "You: your manual orders and your strategy" },
];

export interface WhoRow {
  readonly key: string;
  readonly label: string;
  readonly name: string;
  /** Aggressive shares sold (hit bids) and bought (lifted asks) in the window. */
  readonly sell: number;
  readonly buy: number;
  /** Whole percent of the window's aggressive volume, both sides: the rows sum to exactly 100 (0 without trades). */
  readonly pct: number;
}

/**
 * WHO as a fixed table (D-076): one row per trader type whether it traded or not, so nothing shifts as
 * types come and go, plus OTHER only if a type outside the fixed rows traded. NET is aggressive buying
 * minus aggressive selling. Every number comes from the attribution, which comes from the fill log.
 */
export function whoTable(who: Attribution): { rows: WhoRow[]; net: number } {
  const volume: Partial<Record<string, number>> = {};
  const types = new Set<string>([...Object.keys(who.selling.byType), ...Object.keys(who.buying.byType)]);
  for (const t of types) volume[t] = (who.selling.byType[t as AgentType] ?? 0) + (who.buying.byType[t as AgentType] ?? 0);
  const fixed = new Set<string>(WHO_ROWS.map((r) => r.type));
  const otherTypes = [...types].filter((t) => !fixed.has(t));
  const keyed: Record<string, number> = {};
  for (const r of WHO_ROWS) keyed[r.type] = volume[r.type] ?? 0;
  if (otherTypes.length > 0) keyed.other = otherTypes.reduce((s, t) => s + (volume[t] ?? 0), 0);
  const pct = wholePercents(keyed);
  const rows: WhoRow[] = WHO_ROWS.map((r) => ({ key: r.type, label: r.label, name: r.name, sell: who.selling.byType[r.type] ?? 0, buy: who.buying.byType[r.type] ?? 0, pct: pct[r.type] ?? 0 }));
  if (otherTypes.length > 0) {
    const sum = (side: "selling" | "buying") => otherTypes.reduce((s, t) => s + (who[side].byType[t as AgentType] ?? 0), 0);
    rows.push({ key: "other", label: "OTHER", name: otherTypes.join(", "), sell: sum("selling"), buy: sum("buying"), pct: pct.other ?? 0 });
  }
  return { rows, net: who.buying.shares - who.selling.shares };
}
