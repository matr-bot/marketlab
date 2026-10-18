import type { ShockParams } from "./fundamental";

// Offline headlines (D-048): fixed, reviewed shocks with no network call. They are the demo's
// fallback if the AI route or the Wi-Fi fails, and the reference cases the signature tests check.

export interface Preset {
  readonly code: string;
  readonly headline: string;
  readonly shock: ShockParams;
}

export const PRESETS: readonly Preset[] = [
  { code: "FED", headline: "Fed surprise hike 75bps", shock: { fairValuePct: -0.03, panicSensitivity: 1.5, durationSec: 300 } },
  { code: "CEO", headline: "CEO arrested for accounting fraud", shock: { fairValuePct: -0.06, panicSensitivity: 2, durationSec: 300 } },
  { code: "BEAT", headline: "Earnings beat, guidance raised", shock: { fairValuePct: 0.04, panicSensitivity: 0.5, durationSec: 300 } },
  { code: "DOWNGRADE", headline: "Analyst downgrade to neutral", shock: { fairValuePct: -0.01, panicSensitivity: 1, durationSec: 120 } },
];

/** The preset with this code (case-insensitive), or undefined. */
export function presetByCode(code: string): Preset | undefined {
  const c = code.trim().toUpperCase();
  return PRESETS.find((p) => p.code === c);
}
