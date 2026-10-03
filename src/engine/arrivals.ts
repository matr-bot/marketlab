import { nextUp } from "./detMath";
import type { Rng } from "./rng";

// When each order source (an agent) sends its next order (D-020, D-021).
//
// Each source is a Poisson process: on average `rate` orders per second, with independent,
// exponentially distributed gaps between them, so arrivals are irregular rather than evenly
// spaced. Each source draws from its own named random stream (path "arrivals" / <id>), so one
// source's rate never changes another's arrival times. Each arrival is strictly later than the
// previous one from the same source.
//
// Rates may change over time (the Week 3 hook for bursts and news). Because exponential gaps are
// memoryless, redrawing the pending gap at the moment the rate changes gives exactly the right
// distribution for a piecewise-constant rate (cf. Lewis & Shedler 1979, thinning).

/** One arrival: which source, its exact time, and its timestamp in whole sim ms. */
export interface Arrival {
  readonly sourceId: string;
  /** Exact arrival time in sim ms (a double; used only for ordering). */
  readonly exactMs: number;
  /** Timestamp in whole sim ms: ⌊exactMs⌋. */
  readonly timeMs: number;
}

interface Source {
  readonly id: string;
  readonly rng: Rng;
  ratePerSec: number;
  /** Exact time of this source's next arrival in sim ms, or Infinity if its rate is 0. */
  next: number;
}

export class ArrivalScheduler {
  private readonly sources: Source[] = [];
  private readonly byId = new Map<string, Source>();
  /** Everything before this time has been handed out; time never moves backwards. */
  private drainedUntil = 0;

  constructor(private readonly rng: Rng) {}

  /** Register a source starting at the current time. Rate is in orders per second (0 = silent). */
  addSource(id: string, ratePerSec: number): void {
    if (typeof id !== "string" || id === "") throw new RangeError(`source id must be a non-empty string, got ${JSON.stringify(id)}`);
    if (this.byId.has(id)) throw new Error(`Duplicate arrival source: ${id}`);
    checkRate(ratePerSec);
    const source: Source = {
      id,
      rng: this.rng.stream("arrivals").stream(id),
      ratePerSec,
      next: Infinity,
    };
    source.next = this.nextAfter(source, this.drainedUntil);
    this.sources.push(source);
    this.byId.set(id, source);
  }

  /**
   * Change a source's rate from sim time `atMs` on. `atMs` may not be in the already-drained
   * past. The pending arrival is redrawn from `atMs` with the new rate (exact, by memorylessness).
   */
  setRate(id: string, ratePerSec: number, atMs: number): void {
    const source = this.byId.get(id);
    if (!source) throw new Error(`Unknown arrival source: ${id}`);
    checkRate(ratePerSec);
    if (!Number.isFinite(atMs) || atMs < this.drainedUntil) {
      throw new RangeError(`rate change at ${atMs} ms is before already-drained time ${this.drainedUntil} ms`);
    }
    if (source.next < atMs) {
      throw new Error(`source ${id} has an undrained arrival at ${source.next} ms before the rate change at ${atMs} ms; drain first`);
    }
    source.ratePerSec = ratePerSec;
    source.next = this.nextAfter(source, atMs);
  }

  rateOf(id: string): number | undefined {
    return this.byId.get(id)?.ratePerSec;
  }

  /**
   * Every arrival with exact time < `untilMs`, in time order. Ties on exact time (vanishingly
   * rare) go to the source registered first. Calls must not go backwards in time.
   */
  drain(untilMs: number): Arrival[] {
    if (!Number.isFinite(untilMs) || untilMs < this.drainedUntil) {
      throw new RangeError(`drain(${untilMs}) would go back before ${this.drainedUntil} ms`);
    }
    const out: Arrival[] = [];
    for (;;) {
      let earliest: Source | undefined;
      for (const s of this.sources) {
        if (s.next < untilMs && (earliest === undefined || s.next < earliest.next)) earliest = s;
      }
      if (earliest === undefined) break;
      out.push({ sourceId: earliest.id, exactMs: earliest.next, timeMs: Math.floor(earliest.next) });
      earliest.next = this.nextAfter(earliest, earliest.next);
    }
    this.drainedUntil = untilMs;
    return out;
  }

  /**
   * Exact time of the arrival after `fromMs`: fromMs + an exponential gap (seconds → ms). The gap
   * is always > 0, but at a very high rate it can be smaller than the spacing between doubles near
   * fromMs and round away; then the next representable time is used, so time strictly increases.
   */
  private nextAfter(source: Source, fromMs: number): number {
    if (source.ratePerSec === 0) return Infinity;
    const t = fromMs + source.rng.exponential(source.ratePerSec) * 1000;
    return t > fromMs ? t : nextUp(fromMs);
  }
}

function checkRate(ratePerSec: number): void {
  if (!(ratePerSec >= 0) || !Number.isFinite(ratePerSec)) {
    throw new RangeError(`rate must be a finite number of orders per second >= 0, got ${ratePerSec}`);
  }
}
