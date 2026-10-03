import { describe, expect, it } from "vitest";
import { runBookWorkload, runEngineWorkload, runRandomnessWorkload, type WorkloadResult } from "./testing/workloads";

// Runtime backstop for the determinism lint rule (D-019). Static analysis can't see everything:
// a dependency, a computed property name or code built at runtime could still reach Math.log,
// Math.random or the clock. So: replace every banned global with a stub that throws, run the
// engine's full random workloads, and require (a) nothing threw and (b) the result is identical
// to a normal run. Anything that sneaks through fails this test. (The ** operator cannot be
// stubbed at runtime; the lint rule covers it.)

const INEXACT_MATH = [
  "log", "log1p", "log2", "log10", "exp", "expm1", "pow", "cbrt", "hypot",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "random",
] as const;

class BannedCall extends Error {}

/**
 * Runs `fn` with every banned global replaced by a throwing stub, then restores them all. `fn`
 * must be synchronous, so nothing else (including the test runner) runs while they are stubbed.
 */
function withBannedGlobals<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const math = Math as unknown as Record<string, unknown>;
  const banned = (name: string) => () => {
    throw new BannedCall(`engine code called ${name}`);
  };
  const saved = {
    math: INEXACT_MATH.map((k) => [k, math[k]] as const),
    Date: g.Date,
    perfNow: Object.getOwnPropertyDescriptor(performance, "now"),
    getRandomValues: Object.getOwnPropertyDescriptor(crypto, "getRandomValues"),
  };
  try {
    for (const k of INEXACT_MATH) math[k] = banned(`Math.${k}`);
    const FakeDate = function () {
      throw new BannedCall("engine code called Date");
    } as unknown as Record<string, unknown>;
    FakeDate.now = banned("Date.now");
    g.Date = FakeDate;
    Object.defineProperty(performance, "now", { value: banned("performance.now"), configurable: true, writable: true });
    Object.defineProperty(crypto, "getRandomValues", { value: banned("crypto.getRandomValues"), configurable: true, writable: true });
    return fn();
  } finally {
    for (const [k, v] of saved.math) math[k] = v;
    g.Date = saved.Date;
    if (saved.perfNow) Object.defineProperty(performance, "now", saved.perfNow);
    else delete (performance as unknown as Record<string, unknown>).now;
    if (saved.getRandomValues) Object.defineProperty(crypto, "getRandomValues", saved.getRandomValues);
    else delete (crypto as unknown as Record<string, unknown>).getRandomValues;
  }
}

describe("determinism backstop: banned globals really are banned while stubbed", () => {
  it.each<[string, () => unknown]>([
    ["Math.log", () => Math.log(2)],
    ["Math.exp", () => Math.exp(1)],
    ["Math.pow", () => Math.pow(2, 3)],
    ["Math.sin", () => Math.sin(1)],
    ["Math.cos", () => Math.cos(1)],
    ["Math.random", () => Math.random()],
    ["Date.now", () => Date.now()],
    ["new Date", () => new Date()],
    ["performance.now", () => performance.now()],
    ["crypto.getRandomValues", () => crypto.getRandomValues(new Uint32Array(1))],
  ])("%s throws inside the backstop", (_name, call) => {
    expect(() => withBannedGlobals(call)).toThrow(BannedCall);
  });

  it("restores everything afterwards", () => {
    withBannedGlobals(() => 0);
    expect(Math.log(Math.E)).toBe(1);
    expect(typeof Date.now()).toBe("number");
    expect(typeof performance.now()).toBe("number");
    expect(Math.random()).toBeLessThan(1);
    expect(crypto.getRandomValues(new Uint32Array(1))).toHaveLength(1);
  });

  it("leaves the exact Math members working", () => {
    expect(withBannedGlobals(() => Math.sqrt(16) + Math.floor(2.5) + Math.max(1, 2) + Math.imul(3, 4))).toBe(4 + 2 + 2 + 12);
  });
});

describe("determinism backstop: the engine's full random workloads never reach a banned global", () => {
  const same = (normal: WorkloadResult, stubbed: WorkloadResult) => {
    expect(stubbed.fingerprint).toBe(normal.fingerprint);
    expect(stubbed.fills).toBe(normal.fills);
    expect([...stubbed.seen]).toEqual([...normal.seen]);
  };

  // Each case runs a full workload twice; allow for slow or busy machines.
  const SLOW = 30_000;

  it.each([1, 2, 3, 42, 2008])("order book workload, seed %i", (seed) => {
    same(runBookWorkload(seed), withBannedGlobals(() => runBookWorkload(seed)));
  }, SLOW);

  it.each([1, 2, 3, 42, 2008])("matching engine workload, seed %i", (seed) => {
    const normal = runEngineWorkload(seed);
    expect(normal.fills).toBeGreaterThan(1_000);
    same(normal, withBannedGlobals(() => runEngineWorkload(seed)));
  }, SLOW);

  it.each([1, 187, 4_294_967_295])("randomness, detMath, clock and arrivals workload, seed %i", (seed) => {
    const normal = runRandomnessWorkload(seed);
    expect(normal.seen.get("arrivals")).toBeGreaterThan(10_000);
    same(normal, withBannedGlobals(() => runRandomnessWorkload(seed)));
  }, SLOW);
});
