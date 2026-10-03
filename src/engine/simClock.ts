// Simulated market time (D-021). Time is an integer number of milliseconds since the session
// opened at 09:30:00.000, and it moves only when the simulation advances it: the engine never
// reads the wall clock. How fast ticks play on screen (1x, 4x) is the worker's job (Step 7).

/** Length of one tick in sim milliseconds. */
export const TICK_MS = 100;
/** Session open as time of day: 09:30:00.000 (US market open). */
export const SESSION_OPEN_MS = (9 * 60 + 30) * 60 * 1000;

/** One tick: the half-open interval [start, end) in sim ms. */
export interface TickWindow {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export class SimClock {
  private ticks = 0;

  /** Sim ms since the open: the end of the last completed tick. */
  get now(): number {
    return this.ticks * TICK_MS;
  }

  /** Number of completed ticks. */
  get tickCount(): number {
    return this.ticks;
  }

  /**
   * Advance by one tick and return the window it covered. Windows are half-open, [start, end),
   * so an event at exactly `end` belongs to the next tick and nothing is ever counted twice.
   */
  advance(): TickWindow {
    const index = this.ticks++;
    return { index, start: index * TICK_MS, end: this.ticks * TICK_MS };
  }
}

/** Format sim ms since the open as a time of day, e.g. 0 → "09:30:00.000". */
export function formatSimTime(msSinceOpen: number): string {
  if (!Number.isSafeInteger(msSinceOpen) || msSinceOpen < 0) {
    throw new RangeError(`sim time must be a non-negative integer number of ms, got ${msSinceOpen}`);
  }
  const t = SESSION_OPEN_MS + msSinceOpen;
  const ms = t % 1000;
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60_000) % 60;
  const h = Math.floor(t / 3_600_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}.${String(ms).padStart(3, "0")}`;
}
