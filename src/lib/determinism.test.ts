import { describe, expect, it } from "vitest";
import { findNonFinite, firstDivergence, runDeterminism, type DeterminismResult } from "./determinism";
import pinsJson from "./determinismPins.json";

const pins = pinsJson as unknown as DeterminismResult;

// D-091: the same check the browsers run (/determinism, e2e/determinism.spec.ts). The CI determinism
// job runs this on Linux x64 and macOS arm64, Node 22 and 24: every one must reproduce the pins.
describe("determinism across platforms (D-091)", () => {
  const result = runDeterminism();

  it("reproduces the pinned engine state and detMath fingerprints exactly", () => {
    expect(firstDivergence(pins, result)).toBeNull();
    expect(result.runs.map((r) => r.final)).toEqual(pins.runs.map((r) => r.final));
    expect(result.detMath).toEqual(pins.detMath);
  });

  it("names the first diverging tick when a result differs", () => {
    const tampered: DeterminismResult = { ...result, runs: result.runs.map((r, i) => (i === 1 ? { ...r, perTick: r.perTick.map((h, t) => (t >= 299 ? "00000000" : h)) } : r)) };
    expect(firstDivergence(pins, tampered)).toMatch(/^rate-shock-187: first diverging tick 300 of 900 \(sim \+30\.0 s\)/);
    expect(firstDivergence(pins, { ...result, detMath: ["x", "y"] })).toMatch(/^detMath:/);
  });

  it("the NaN guard: no NaN or ±Infinity in any agent's state or any hashed value, at any tick", () => {
    expect(result.nonFinite).toBeNull();
    expect(pins.nonFinite).toBeNull();
  });

  it("the guard finds a planted NaN or ±Infinity anywhere: nested objects, arrays, Maps, typed arrays", () => {
    expect(findNonFinite({ a: [1, { b: 2 }] }, "x")).toBeNull();
    expect(findNonFinite({ a: [1, { b: Number.NaN }] }, "x")).toBe("x.a[1].b = NaN");
    expect(findNonFinite({ m: new Map([["k", { v: -Infinity }]]) }, "x")).toBe("x.m.get(k).v = -Infinity");
    expect(findNonFinite({ t: new Float64Array([1, Infinity]) }, "x")).toBe("x.t[1] = Infinity");
    const cyclic: { self?: unknown; n: number } = { n: 1 };
    cyclic.self = cyclic;
    expect(findNonFinite(cyclic, "x")).toBeNull();
  });

  it("covers the product's markets: the free-play crowd and the Fed hike, with trades in both", () => {
    expect(result.runs.map((r) => r.id)).toEqual(["free-187", "rate-shock-187"]);
    for (const r of result.runs) expect(r.fills).toBeGreaterThan(500);
  });
});
