import { describe, expect, it } from "vitest";
import { formatSimTime, SESSION_OPEN_MS, SimClock, TICK_MS } from "./simClock";

describe("SimClock", () => {
  it("starts at the open with no ticks", () => {
    const c = new SimClock();
    expect([c.now, c.tickCount]).toEqual([0, 0]);
    expect(TICK_MS).toBe(100);
    expect(SESSION_OPEN_MS).toBe(34_200_000); // 09:30:00.000
  });

  it("advances in contiguous half-open windows [start, end)", () => {
    const c = new SimClock();
    expect(c.advance()).toEqual({ index: 0, start: 0, end: 100 });
    expect(c.advance()).toEqual({ index: 1, start: 100, end: 200 });
    expect([c.now, c.tickCount]).toEqual([200, 2]);
  });

  it("reaches exactly 1,000,000 ms after 10,000 ticks, with no gaps or overlaps", () => {
    const c = new SimClock();
    let expectedStart = 0;
    for (let i = 0; i < 10_000; i++) {
      const w = c.advance();
      expect(w.start).toBe(expectedStart);
      expect(w.end - w.start).toBe(TICK_MS);
      expectedStart = w.end;
    }
    expect(c.now).toBe(1_000_000);
  });
});

describe("formatSimTime", () => {
  it.each([
    [0, "09:30:00.000"],
    [1, "09:30:00.001"],
    [999, "09:30:00.999"],
    [1_000, "09:30:01.000"],
    [59_999, "09:30:59.999"],
    [60_000, "09:31:00.000"],
    [1_800_000, "10:00:00.000"],
    [23_400_000, "16:00:00.000"], // the close, 6.5 hours later
    [41_427_300, "21:00:27.300"],
  ])("%i ms after the open is %s", (ms, text) => {
    expect(formatSimTime(ms)).toBe(text);
  });

  it.each([-1, 1.5, NaN])("throws for %s", (ms) => {
    expect(() => formatSimTime(ms)).toThrow(`sim time must be a non-negative integer number of ms, got ${ms}`);
  });
});
