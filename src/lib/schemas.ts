import { z } from "zod";
import { clampShock, type ShockParams } from "@/engine/fundamental";
import { clampStrategy, ENTRY_RULES, type StrategySpec } from "@/engine/strategy";

// AI contracts (CLAUDE.md, "AI contracts"; D-052). The model may only return data matching
// ModelOutput. Structured outputs guarantee the shape but not numeric ranges, so the server
// validates again and clamps every number with the engine's own clampShock: whatever a headline
// says, only in-range ScenarioParams can reach the market.

/** What the model must return (structured outputs). Numbers are plain; ranges are enforced after. */
export const ModelOutput = z.object({
  relevance: z.enum(["market_news", "not_news"]),
  /** Percent change in fair value: −3 means −3%. */
  fairValueChangePercent: z.number(),
  panicSensitivity: z.number(),
  durationSeconds: z.number(),
  volatilityMultiplier: z.number(),
  liquidityMultiplier: z.number(),
  /** One short sentence, no numbers. */
  reason: z.string(),
});
export type ModelOutput = z.infer<typeof ModelOutput>;

/** The request body of POST /api/interpret. */
export const InterpretRequest = z.object({ headline: z.string().trim().min(1).max(200) });

/** ScenarioParams: the clamped shock the engine applies, plus the AI's one-line reason. */
export interface ScenarioParams {
  readonly shock: ShockParams;
  readonly reason: string;
}

const NO_EFFECT: ShockParams = { fairValuePct: 0, panicSensitivity: 1, durationSec: 10, volatilityMultiplier: 1, liquidityMultiplier: 1 };

/** The reason as shown: no digits (numbers on screen come from the params, never from model text), ≤ 120 chars. */
export function cleanReason(text: string): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[0-9]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
}

/** Model output → clamped ScenarioParams. Non-finite numbers are rejected (null), never guessed. */
export function toScenario(out: ModelOutput): ScenarioParams | null {
  const nums = [out.fairValueChangePercent, out.panicSensitivity, out.durationSeconds, out.volatilityMultiplier, out.liquidityMultiplier];
  if (!nums.every(Number.isFinite)) return null;
  if (out.relevance === "not_news") return { shock: NO_EFFECT, reason: cleanReason(out.reason) || "Not market news: no effect on fair value." };
  const shock = clampShock({
    fairValuePct: out.fairValueChangePercent / 100,
    panicSensitivity: out.panicSensitivity,
    durationSec: out.durationSeconds,
    volatilityMultiplier: out.volatilityMultiplier,
    liquidityMultiplier: out.liquidityMultiplier,
  });
  return { shock, reason: cleanReason(out.reason) };
}

/** What the route answers. `source` says where the params came from. */
export type InterpretResponse =
  | { readonly ok: true; readonly source: "ai" | "cache"; readonly headline: string; readonly scenario: ScenarioParams }
  | { readonly ok: true; readonly source: "offline"; readonly headline: string; readonly preset: string | null; readonly scenario: ScenarioParams | null; readonly message: string }
  | { readonly ok: false; readonly message: string };

// ---------- StrategySpec (D-064) ----------

/** The request body for a strategy: `{"kind": "strategy", "text": "..."}`. */
export const StrategyRequest = z.object({ kind: z.literal("strategy"), text: z.string().trim().min(1).max(300) });

/**
 * What the model must return for a strategy (structured outputs). The entry rule can only be one of
 * the engine's four; an idea the menu cannot express says so (`expressible: "no"`) instead of being
 * forced into a rule. Percents are plain numbers (3 = 3%); ranges are enforced after.
 */
export const StrategyModelOutput = z.object({
  expressible: z.enum(["yes", "no"]),
  entryRule: z.enum(ENTRY_RULES),
  entryPercent: z.number(),
  windowSeconds: z.number(),
  stopLossPercent: z.number().nullable(),
  takeProfitPercent: z.number().nullable(),
  timeExitSeconds: z.number().nullable(),
  shares: z.number(),
  cooldownSeconds: z.number(),
  /** One short sentence, no numbers: the idea's market logic, or what the menu is missing. */
  reason: z.string(),
});
export type StrategyModelOutput = z.infer<typeof StrategyModelOutput>;

/** What a strategy becomes when the text gives no number for it (the AI's prompt and the offline parser use the same). */
export const STRATEGY_DEFAULTS = { windowSec: 60, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 } as const;

/** The clamped spec the engine will run, plus the one-line reason (the AI's, or empty offline). */
export interface StrategyParams {
  readonly spec: StrategySpec;
  readonly reason: string;
}

/** Model output → a clamped spec, "unsupported" with the model's reason, or null for non-finite numbers (never guessed). */
export function toStrategy(out: StrategyModelOutput): { readonly kind: "ok"; readonly params: StrategyParams } | { readonly kind: "unsupported"; readonly reason: string } | null {
  const nums = [out.entryPercent, out.windowSeconds, out.stopLossPercent, out.takeProfitPercent, out.timeExitSeconds, out.shares, out.cooldownSeconds];
  if (!nums.every((n) => n === null || Number.isFinite(n))) return null;
  if (out.expressible === "no") return { kind: "unsupported", reason: cleanReason(out.reason) };
  const pct = (x: number | null) => (x === null ? null : x / 100);
  const spec = clampStrategy({
    entry: { rule: out.entryRule, pct: out.entryPercent / 100, windowSec: out.windowSeconds },
    stopLossPct: pct(out.stopLossPercent),
    takeProfitPct: pct(out.takeProfitPercent),
    timeExitSec: out.timeExitSeconds,
    qty: out.shares,
    cooldownSec: out.cooldownSeconds,
  });
  return { kind: "ok", params: { spec, reason: cleanReason(out.reason) } };
}

/** What the route answers for a strategy. `source` says where the spec came from; "offline" is never the AI. */
export type StrategyResponse =
  | { readonly ok: true; readonly source: "ai" | "cache"; readonly text: string; readonly strategy: StrategyParams }
  | { readonly ok: true; readonly source: "ai"; readonly text: string; readonly strategy: null; readonly message: string }
  | { readonly ok: true; readonly source: "offline"; readonly text: string; readonly strategy: StrategyParams | null; readonly message: string }
  | { readonly ok: false; readonly message: string };
