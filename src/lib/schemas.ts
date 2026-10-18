import { z } from "zod";
import { clampShock, type ShockParams } from "@/engine/fundamental";

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
