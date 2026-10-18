import { exp, ln } from "./detMath";
import type { Rng } from "./rng";

// Fair value and headline shocks (D-043). Fair value V is the one piece of "truth" in the market:
// what the stock is worth. Only value traders read it. It drifts slowly as a random walk and
// jumps when a headline arrives; a shock also makes panic sellers more sensitive for a while.

/** What a headline does to the market. Tuesday's AI route produces the same fields (ScenarioParams). */
export interface ShockParams {
  /** Fair-value jump, as a fraction: −0.03 = −3%. Clamped to ±20%. */
  readonly fairValuePct: number;
  /** Panic sensitivity s: panic thresholds are divided by s while the shock lasts. Clamped to [0.5, 3]. */
  readonly panicSensitivity: number;
  /** How long the sensitivity lasts, in sim seconds. Clamped to [10, 1800]. */
  readonly durationSec: number;
}

export interface FundamentalParams {
  /** Random-walk volatility of V, log units per √second. */
  readonly sigmaV: number;
  /** V is updated every this many sim ms (on the tick grid). */
  readonly stepMs: number;
  /** V never leaves [startPrice / bound, startPrice × bound] however many shocks arrive. */
  readonly bound: number;
}

export const DEFAULT_FUNDAMENTAL_PARAMS: FundamentalParams = {
  sigmaV: 2.0e-5, // ≈ 0.37¢/√s at $187: half the observed calm mid volatility (D-032)
  stepMs: 1_000,
  bound: 5,
};

export const SHOCK_LIMITS = {
  fairValuePct: [-0.2, 0.2],
  panicSensitivity: [0.5, 3],
  durationSec: [10, 1_800],
} as const;

const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, x));

/** A shock with every field inside its limits (so any headline maps to sensible numbers). */
export function clampShock(s: ShockParams): ShockParams {
  for (const [k, v] of Object.entries(s)) if (!Number.isFinite(v)) throw new RangeError(`shock ${k} must be a finite number, got ${v}`);
  return {
    fairValuePct: clamp(s.fairValuePct, SHOCK_LIMITS.fairValuePct),
    panicSensitivity: clamp(s.panicSensitivity, SHOCK_LIMITS.panicSensitivity),
    durationSec: clamp(s.durationSec, SHOCK_LIMITS.durationSec),
  };
}

export class Fundamental {
  /** Fair value in cents (unrounded; it is a belief, not a price, and becomes cents only through toTick). */
  private v: number;
  private lnV: number;
  private readonly lnLo: number;
  private readonly lnHi: number;
  /** Panic sensitivity in force, from when and until when (sim ms). */
  private s = 1;
  private sFrom = 0;
  private sUntil = -1;

  constructor(
    private readonly rng: Rng,
    startPrice: number,
    readonly params: FundamentalParams = DEFAULT_FUNDAMENTAL_PARAMS,
  ) {
    if (!(params.sigmaV >= 0) || !Number.isFinite(params.sigmaV)) throw new RangeError(`sigmaV must be a non-negative finite number, got ${params.sigmaV}`);
    if (!Number.isSafeInteger(params.stepMs) || params.stepMs <= 0 || params.stepMs % 100 !== 0) throw new RangeError(`stepMs must be a positive multiple of 100, got ${params.stepMs}`);
    if (!(params.bound > 1) || !Number.isFinite(params.bound)) throw new RangeError(`bound must be a finite number above 1, got ${params.bound}`);
    this.v = startPrice;
    this.lnV = ln(startPrice);
    this.lnLo = ln(startPrice / params.bound);
    this.lnHi = ln(startPrice * params.bound);
  }

  /** Fair value now, in cents. */
  get value(): number {
    return this.v;
  }

  /** Panic sensitivity at `timeMs`: the active shock's s, or 1. */
  sensitivityAt(timeMs: number): number {
    return timeMs >= this.sFrom && timeMs < this.sUntil ? this.s : 1;
  }

  /** Called at every tick end: one random-walk step on the `stepMs` grid. */
  onTickEnd(timeMs: number): void {
    if (timeMs % this.params.stepMs !== 0) return;
    const sd = this.params.sigmaV * Math.sqrt(this.params.stepMs / 1000);
    this.setLn(this.lnV + sd * this.rng.normal() - (sd * sd) / 2);
  }

  /**
   * A headline at `timeMs`. V jumps by the shock (shocks compound: each headline is new news). If a
   * shock is still active, sensitivity becomes the larger of the two and the window runs to the
   * later end (D-043), so repeated headlines never multiply panic without limit.
   */
  shock(raw: ShockParams, timeMs: number): ShockParams {
    const s = clampShock(raw);
    this.setLn(this.lnV + ln(1 + s.fairValuePct));
    const active = timeMs >= this.sFrom && timeMs < this.sUntil;
    this.s = active ? Math.max(this.s, s.panicSensitivity) : s.panicSensitivity;
    if (!active) this.sFrom = timeMs;
    this.sUntil = Math.max(active ? this.sUntil : -1, timeMs + s.durationSec * 1000);
    return s;
  }

  private setLn(x: number): void {
    this.lnV = Math.min(this.lnHi, Math.max(this.lnLo, x));
    this.v = exp(this.lnV);
  }
}

/**
 * The mid sampled once per second of sim time, for the last `capacity` seconds. Agents ask for the
 * highest mid since a time (panic sellers' drawdown window). A one-sided book is skipped.
 */
export class MidHistory {
  private readonly times: number[] = [];
  private readonly mids: number[] = [];

  constructor(readonly capacity = 600) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }

  /** Called at every tick end with bid + ask (or null); records a sample on whole seconds. */
  onTickEnd(timeMs: number, midX2: number | null): void {
    if (timeMs % 1_000 !== 0 || midX2 === null) return;
    this.times.push(timeMs);
    this.mids.push(midX2 / 2);
    if (this.times.length > this.capacity) {
      this.times.shift();
      this.mids.shift();
    }
  }

  /** Highest sampled mid at or after `sinceMs`, or null if there is none. */
  maxSince(sinceMs: number): number | null {
    let best: number | null = null;
    for (let i = this.times.length - 1; i >= 0 && this.times[i] >= sinceMs; i--) {
      if (best === null || this.mids[i] > best) best = this.mids[i];
    }
    return best;
  }
}
