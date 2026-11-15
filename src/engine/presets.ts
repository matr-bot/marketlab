import type { ShockParams } from "./fundamental";
import { makeEconomicRelease, type EconomicRelease } from "./economicReleases";

// Offline headlines (D-048): fixed, reviewed shocks with no network call. They are the demo's
// fallback if the AI route or the Wi-Fi fails, and the reference cases the signature tests check.

export interface Preset {
  readonly code: string;
  readonly headline: string;
  readonly shock: ShockParams;
  readonly release?: EconomicRelease;
}

const fedRelease = makeEconomicRelease("RATES");
export const PRESETS: readonly Preset[] = [
  { code: "FED", headline: "Fed surprise hike 75bps", shock: fedRelease.shock, release: fedRelease },
  { code: "CEO", headline: "CEO arrested for accounting fraud", shock: { fairValuePct: -0.06, panicSensitivity: 2, durationSec: 300, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
  { code: "BEAT", headline: "Earnings beat, guidance raised", shock: { fairValuePct: 0.04, panicSensitivity: 0.5, durationSec: 300, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
  { code: "DOWNGRADE", headline: "Analyst downgrade to neutral", shock: { fairValuePct: -0.01, panicSensitivity: 1, durationSec: 120, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
];

/** The preset with this code (case-insensitive), or undefined. */
export function presetByCode(code: string): Preset | undefined {
  const c = code.trim().toUpperCase();
  return PRESETS.find((p) => p.code === c);
}
