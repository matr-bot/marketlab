import { describe, expect, it } from "vitest";
import { ArrivalScheduler, type Arrival } from "./arrivals";
import { Rng } from "./rng";
import { SimClock } from "./simClock";
import { fingerprint } from "./testing/fingerprint";

const scheduler = (seed = 187) => new ArrivalScheduler(Rng.fromSeed(seed));

/** Arrival counts per 1-second window for one source over `seconds`. */
function countsPerSecond(arrivals: Arrival[], sourceId: string, seconds: number): number[] {
  const counts = new Array<number>(seconds).fill(0);
  for (const a of arrivals) if (a.sourceId === sourceId) counts[Math.floor(a.exactMs / 1000)]++;
  return counts;
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
};

describe("ArrivalScheduler: Poisson arrivals", () => {
  it.each([0.5, 5, 40])("averages `rate` orders per second with variance equal to the mean (rate %s)", (rate) => {
    const s = scheduler();
    s.addSource("noise-1", rate);
    const seconds = 20_000;
    const counts = countsPerSecond(s.drain(seconds * 1000), "noise-1", seconds);
    // For a Poisson process the count per window has mean = variance = rate.
    expect(Math.abs(mean(counts) - rate)).toBeLessThan(5 * Math.sqrt(rate / seconds));
    expect(Math.abs(variance(counts) / rate - 1)).toBeLessThan(0.05);
  });

  it("produces irregular gaps, not a steady rhythm", () => {
    const s = scheduler();
    s.addSource("a", 5);
    const times = s.drain(2_000_000).map((a) => a.exactMs);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // Exponential gaps: standard deviation equals the mean (coefficient of variation 1).
    expect(Math.abs(Math.sqrt(variance(gaps)) / mean(gaps) - 1)).toBeLessThan(0.03);
    expect(Math.abs(mean(gaps) - 200)).toBeLessThan(5 * 200 / Math.sqrt(gaps.length));
  });

  it("gives each source its own rate", () => {
    const s = scheduler();
    s.addSource("slow", 1);
    s.addSource("fast", 10);
    const arrivals = s.drain(5_000_000);
    const n = (id: string) => arrivals.filter((a) => a.sourceId === id).length;
    expect(Math.abs(n("slow") / 5_000 - 1)).toBeLessThan(5 / Math.sqrt(5_000));
    expect(Math.abs(n("fast") / 50_000 - 1)).toBeLessThan(5 / Math.sqrt(50_000));
  });
});

describe("ArrivalScheduler: ordering and timestamps", () => {
  it("returns arrivals in time order, merged across sources, each before the drain time", () => {
    const s = scheduler();
    for (const id of ["a", "b", "c"]) s.addSource(id, 7);
    const arrivals = s.drain(60_000);
    expect(new Set(arrivals.map((a) => a.sourceId))).toEqual(new Set(["a", "b", "c"]));
    for (let i = 1; i < arrivals.length; i++) expect(arrivals[i].exactMs).toBeGreaterThanOrEqual(arrivals[i - 1].exactMs);
    for (const a of arrivals) {
      expect(a.exactMs).toBeLessThan(60_000);
      expect(a.timeMs).toBe(Math.floor(a.exactMs));
      expect(Number.isInteger(a.timeMs)).toBe(true);
    }
  });

  it("splits identically into ticks: no arrival is lost or counted twice", () => {
    const whole = scheduler();
    const ticked = scheduler();
    for (const s of [whole, ticked]) {
      s.addSource("a", 30);
      s.addSource("b", 3);
    }
    const all = whole.drain(100_000);
    const clock = new SimClock();
    const pieces: Arrival[] = [];
    for (let i = 0; i < 1_000; i++) {
      const w = clock.advance();
      const got = ticked.drain(w.end);
      for (const a of got) expect(a.exactMs >= w.start && a.exactMs < w.end).toBe(true);
      pieces.push(...got);
    }
    expect(pieces).toEqual(all);
  });

  it("returns nothing for an empty window and allows repeating the same drain time", () => {
    const s = scheduler();
    s.addSource("a", 5);
    s.drain(1_000);
    expect(s.drain(1_000)).toEqual([]);
  });
});

describe("ArrivalScheduler: determinism", () => {
  const run = (seed: number) => {
    const s = scheduler(seed);
    s.addSource("noise-1", 5);
    s.addSource("noise-2", 12);
    s.addSource("mm-1", 2);
    return s.drain(600_000);
  };

  it("same seed gives an identical schedule; a different seed gives a different one", () => {
    expect(fingerprint(run(187))).toBe(fingerprint(run(187)));
    expect(fingerprint(run(187))).not.toBe(fingerprint(run(188)));
  });

  it("adding a source never changes another source's arrival times (the what-if property)", () => {
    const without = scheduler();
    without.addSource("noise-1", 5);
    const withExtra = scheduler();
    withExtra.addSource("noise-1", 5);
    withExtra.addSource("whale-1", 50);
    const times = (arr: Arrival[]) => arr.filter((a) => a.sourceId === "noise-1").map((a) => a.exactMs);
    expect(times(withExtra.drain(300_000))).toEqual(times(without.drain(300_000)));
  });

  it("is pinned: the first arrivals for seed 187 never change", () => {
    const s = scheduler(187);
    s.addSource("noise-1", 5);
    expect(s.drain(3_000).map((a) => a.timeMs)).toEqual(GOLDEN);
  });
});

describe("ArrivalScheduler: each source's arrivals are strictly increasing", () => {
  it("even when gaps are far smaller than the spacing between doubles at a late time", () => {
    // At a billion ms, doubles are ~1.2e-7 ms apart; at 1e12 orders/s gaps are ~1e-9 ms, so most
    // would round away. The scheduler must still move strictly forward.
    const s = scheduler();
    s.drain(1e9);
    s.addSource("hft", 1e12);
    const times = s.drain(1e9 + 0.001).map((a) => a.exactMs);
    expect(times.length).toBeGreaterThan(1_000);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[0]).toBeGreaterThan(1e9);
  });
});

describe("ArrivalScheduler: changing rates (hook for Week 3 bursts)", () => {
  it("takes effect exactly at the change time", () => {
    const s = scheduler();
    s.addSource("a", 2);
    const before = s.drain(1_000_000);
    s.setRate("a", 20, 1_000_000);
    const after = s.drain(2_000_000);
    expect(Math.abs(before.length / 2_000 - 1)).toBeLessThan(5 / Math.sqrt(2_000));
    expect(Math.abs(after.length / 20_000 - 1)).toBeLessThan(5 / Math.sqrt(20_000));
    expect(after.every((a) => a.exactMs >= 1_000_000)).toBe(true);
    expect(s.rateOf("a")).toBe(20);
  });

  it("silences a source at rate 0 and restarts it from the change time", () => {
    const s = scheduler();
    s.addSource("a", 0);
    expect(s.drain(10_000)).toEqual([]);
    s.setRate("a", 50, 10_000);
    const resumed = s.drain(20_000);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed[0].exactMs).toBeGreaterThanOrEqual(10_000);
    s.setRate("a", 0, 20_000);
    expect(s.drain(1_000_000)).toEqual([]);
  });

  it("a source added later starts from the current time", () => {
    const s = scheduler();
    s.drain(50_000);
    s.addSource("late", 10);
    const got = s.drain(60_000);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((a) => a.exactMs >= 50_000)).toBe(true);
  });

  it("refuses to change the past or skip an undrained arrival", () => {
    const s = scheduler();
    s.addSource("a", 5);
    s.drain(1_000);
    expect(() => s.setRate("a", 5, 999)).toThrow("rate change at 999 ms is before already-drained time 1000 ms");
    expect(() => s.setRate("a", 5, NaN)).toThrow(/before already-drained time/);
    expect(() => s.setRate("a", 5, 10_000_000)).toThrow(/has an undrained arrival at .* before the rate change at 10000000 ms; drain first/);
    expect(() => s.setRate("nope", 5, 1_000)).toThrow("Unknown arrival source: nope");
    expect(() => s.drain(999)).toThrow("drain(999) would go back before 1000 ms");
    expect(() => s.drain(NaN)).toThrow(/would go back/);
  });
});

describe("ArrivalScheduler: setup errors", () => {
  it.each([-1, NaN, Infinity])("rejects rate %s", (rate) => {
    expect(() => scheduler().addSource("a", rate)).toThrow(`rate must be a finite number of orders per second >= 0, got ${rate}`);
    const s = scheduler();
    s.addSource("a", 1);
    expect(() => s.setRate("a", rate, 0)).toThrow(/rate must be a finite number/);
  });

  it("rejects empty or duplicate source ids", () => {
    const s = scheduler();
    expect(() => s.addSource("", 1)).toThrow('source id must be a non-empty string, got ""');
    expect(() => s.addSource(7 as unknown as string, 1)).toThrow("source id must be a non-empty string, got 7");
    s.addSource("a", 1);
    expect(() => s.addSource("a", 2)).toThrow("Duplicate arrival source: a");
    expect(s.rateOf("missing")).toBeUndefined();
  });
});

// Arrival timestamps (whole ms) in the first 3 seconds for seed 187, source "noise-1" at 5 orders/s.
const GOLDEN: number[] = [238, 425, 753, 754, 957, 1073, 1294, 1447, 1550, 1556, 1708, 1719, 2072, 2249, 2276, 2305, 2473, 2521, 2731, 2761];
