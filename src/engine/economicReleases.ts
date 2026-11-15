import type { ShockParams } from "./fundamental";

/** Hypothetical MLAB releases. Values are percentage points, except JOBS in thousands. */
export const INDICATORS = ["CPI", "JOBS", "GDP", "RATES"] as const;
export type Indicator = (typeof INDICATORS)[number];

export const RELEASE_CALIBRATION: Readonly<Record<Indicator, {
  readonly typicalSurprise: number;
  /** +1: a higher print hurts MLAB; -1: a higher print helps it. */
  readonly direction: 1 | -1;
  readonly sensitivityBps: number;
  readonly forecast: number;
  readonly defaultActual: number;
}>> = {
  CPI: { typicalSurprise: 0.2, direction: 1, sensitivityBps: 80, forecast: 3.1, defaultActual: 3.4 },
  JOBS: { typicalSurprise: 50, direction: -1, sensitivityBps: 100, forecast: 180, defaultActual: 150 },
  GDP: { typicalSurprise: 0.5, direction: -1, sensitivityBps: 80, forecast: 2.0, defaultActual: 1.4 },
  RATES: { typicalSurprise: 0.25, direction: 1, sensitivityBps: 150, forecast: 0.25, defaultActual: 0.75 },
};

export interface EconomicRelease {
  readonly indicator: Indicator;
  readonly forecast: number;
  readonly actual: number;
  /** Surprise in typical-surprise units, before the ±3 cap. */
  readonly z: number;
  readonly shock: ShockParams;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Fixed educational calibration, not a claim about measured market responses. */
export function makeEconomicRelease(indicator: Indicator, actual = RELEASE_CALIBRATION[indicator].defaultActual): EconomicRelease {
  if (!Number.isFinite(actual)) throw new RangeError("Release actual must be finite");
  const c = RELEASE_CALIBRATION[indicator];
  const z = Math.round(((actual - c.forecast) / c.typicalSurprise) * 10_000) / 10_000;
  const bounded = clamp(z, -3, 3);
  const magnitude = Math.abs(bounded);
  const fairValuePct = Math.round(-c.direction * c.sensitivityBps * bounded) / 10_000;
  // An upside surprise never creates panic. Sub-one-sigma misses do not either.
  const panicSensitivity = fairValuePct < 0 && magnitude >= 1 ? 1 + 0.25 * magnitude : 1;
  // RATES at z=2 is the existing FED signature: -3%, panic 1.5×, vol 1×, liquidity 1×.
  // Stress above that legacy reference scales; other releases scale from zero surprise.
  const stress = indicator === "RATES" ? Math.max(0, magnitude - 2) : magnitude;
  const shock: ShockParams = {
    fairValuePct,
    panicSensitivity,
    durationSec: 300,
    volatilityMultiplier: 1 + 0.2 * stress,
    liquidityMultiplier: 1 - 0.1 * stress,
  };
  return { indicator, forecast: c.forecast, actual, z, shock };
}

export function releaseValue(indicator: Indicator, value: number): string {
  if (indicator === "JOBS") return `${value}K`;
  if (indicator === "RATES") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  return `${value.toFixed(1)}%`;
}

export function fairValueChange(pct: number): string {
  return `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`;
}

export function releaseLine(release: EconomicRelease): string {
  return `${release.indicator} ${releaseValue(release.indicator, release.actual)} vs ${releaseValue(release.indicator, release.forecast)} expected → fair value ${fairValueChange(release.shock.fairValuePct)}`;
}
