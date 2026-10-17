import { exp, ln, sqrt } from "./detMath";

// Realized volatility of the mid price (D-029 to D-032).
//
// - Measured from the MID sampled on a fixed sim-time grid, never from trade prices: trades bounce
//   between bid and ask, which made trade-based volatility 2.3x the mid-based value (D-029).
// - Sampled every 5 s: sampling every second overstates it ~1.7x because the noise-only mid
//   flickers (measured with the volatility signature plot, D-030).
// - Two exponentially weighted moving averages (EWMA, RiskMetrics 1996) of per-second squared log
//   returns: a fast one (30 s half-life) that reacts to a shock within seconds, and a slow one
//   (120 s) that is steady. Users of the estimate take the larger of the two (D-031).
// - Units: log return per √second of sim time. In cents per √second: σ × mid (D-032).

export interface VolatilityParams {
  /** Sampling interval in sim ms (a multiple of the 100 ms tick). */
  readonly sampleMs: number;
  /** Half-life of the fast EWMA, in sim seconds. */
  readonly fastHalfLifeSec: number;
  /** Half-life of the slow EWMA, in sim seconds. */
  readonly slowHalfLifeSec: number;
  /** Starting volatility (log return per √s) until real samples arrive. */
  readonly sigma0: number;
  /** Returns needed before the estimate counts as `ready` (the first sample only sets the baseline, so 24 → ready at 125 s). */
  readonly warmupSamples: number;
}

export const DEFAULT_VOLATILITY_PARAMS: VolatilityParams = {
  sampleMs: 5_000,
  fastHalfLifeSec: 30,
  slowHalfLifeSec: 120,
  sigma0: 4.3e-5, // measured from the noise-only market at 5 s sampling (≈ 0.8¢/√s at $187)
  warmupSamples: 24,
};

/** What agents may read. All σ values are log return per √second of sim time. */
export interface VolatilityView {
  /** max(fast, slow): the value to act on. */
  readonly sigma: number;
  readonly fast: number;
  readonly slow: number;
  /** Returns folded in so far. */
  readonly samples: number;
  /** True once `samples` ≥ the warm-up count. */
  readonly ready: boolean;
}

export class VolatilityEstimator {
  private fastVar: number;
  private slowVar: number;
  private count = 0;
  private lastMidX2: number | null = null;
  private lastTimeMs = 0;
  readonly view: VolatilityView;

  constructor(readonly params: VolatilityParams = DEFAULT_VOLATILITY_PARAMS) {
    const p = params;
    if (!Number.isSafeInteger(p.sampleMs) || p.sampleMs <= 0 || p.sampleMs % 100 !== 0) {
      throw new RangeError(`sampleMs must be a positive multiple of 100, got ${p.sampleMs}`);
    }
    for (const [name, v] of [["fastHalfLifeSec", p.fastHalfLifeSec], ["slowHalfLifeSec", p.slowHalfLifeSec], ["sigma0", p.sigma0]] as const) {
      if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`${name} must be a positive finite number, got ${v}`);
    }
    if (!Number.isSafeInteger(p.warmupSamples) || p.warmupSamples < 0) {
      throw new RangeError(`warmupSamples must be a non-negative integer, got ${p.warmupSamples}`);
    }
    this.fastVar = p.sigma0 * p.sigma0;
    this.slowVar = p.sigma0 * p.sigma0;
    const self = (): VolatilityEstimator => this;
    this.view = Object.freeze({
      get sigma() {
        return self().sigma;
      },
      get fast() {
        return sqrt(self().fastVar);
      },
      get slow() {
        return sqrt(self().slowVar);
      },
      get samples() {
        return self().count;
      },
      get ready() {
        return self().count >= self().params.warmupSamples;
      },
    });
  }

  /** max(fast, slow), log return per √s. */
  get sigma(): number {
    return sqrt(this.fastVar > this.slowVar ? this.fastVar : this.slowVar);
  }

  /** True if sim time `timeMs` is on the sampling grid. */
  isSampleTime(timeMs: number): boolean {
    return timeMs % this.params.sampleMs === 0;
  }

  /**
   * Fold in the mid at a sample time. `midX2` is bid + ask (doubled mid, an integer), or null if a
   * side of the book is empty, in which case the sample is skipped (D-032): the next return is taken
   * from the last good mid and divided by the real elapsed time, so it stays a fair per-second rate.
   */
  sample(timeMs: number, midX2: number | null): void {
    if (!Number.isSafeInteger(timeMs) || timeMs < this.lastTimeMs) {
      throw new RangeError(`sample time must be a non-decreasing integer number of ms, got ${timeMs}`);
    }
    if (midX2 === null) return;
    if (!Number.isSafeInteger(midX2) || midX2 <= 0) throw new RangeError(`midX2 must be a positive integer, got ${midX2}`);
    if (this.lastMidX2 !== null) {
      const dtSec = (timeMs - this.lastTimeMs) / 1000;
      if (dtSec > 0) {
        const r = ln(midX2 / this.lastMidX2);
        const perSecond = (r * r) / dtSec;
        // Decay by elapsed time, so a skipped sample (longer gap) weighs the old estimate less.
        const lnHalf = -0.6931471805599453;
        const lf = exp((lnHalf * dtSec) / this.params.fastHalfLifeSec);
        const ls = exp((lnHalf * dtSec) / this.params.slowHalfLifeSec);
        this.fastVar = lf * this.fastVar + (1 - lf) * perSecond;
        this.slowVar = ls * this.slowVar + (1 - ls) * perSecond;
        this.count++;
      }
    }
    this.lastMidX2 = midX2;
    this.lastTimeMs = timeMs;
  }
}
