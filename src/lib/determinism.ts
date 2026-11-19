import type { AgentSpec } from "@/engine/agents/agent";
import { demoAgents, WARMUP_TICKS } from "@/engine/demoMarket";
import { exp, ln } from "@/engine/detMath";
import { scenarioById } from "@/engine/scenarios";
import { Simulation } from "@/engine/simulation";
import { detMathInputs } from "@/engine/testing/detMathInputs";
import { fingerprint } from "@/engine/testing/fingerprint";

/**
 * The cross-platform determinism check (D-091), the same code in Node (Vitest, Linux and macOS) and in
 * a browser worker (Chromium, Firefox, WebKit): runs the product's markets on seed 187 and hashes the
 * full engine state, every fill and both sides of the book, plus detMath's fingerprint. A short hash
 * after every tick says where two platforms first diverge, if they ever do.
 */
export interface DeterminismRun {
  readonly id: string;
  readonly ticks: number;
  readonly fills: number;
  /** fingerprint({ fills, bids, asks }) of the whole run: what the pins compare. */
  readonly final: string;
  /** The first 8 hex digits of each tick's fingerprint (that tick's new fills and the book after it). */
  readonly perTick: readonly string[];
}

export interface DeterminismResult {
  readonly runs: readonly DeterminismRun[];
  /**
   * The engine NaN guard (D-091): the first NaN or ±Infinity found in any agent's state or any value fed
   * into the state hash, checked after every tick of both runs, as "run tick N: path = value"; null if
   * none. NaN payloads are the one thing that legitimately differs between JavaScript engines, so the
   * market must never hold one.
   */
  readonly nonFinite: string | null;
  /** detMath's ln and exp fingerprints over the shared bit-built inputs (as detMath.test.ts pins). */
  readonly detMath: readonly [string, string];
}

const SEED = 187;
/** Free play: the full demo crowd from the open, 10 sim-minutes (100 ms ticks). */
const FREE_TICKS = 6_000;
/** The Fed-hike scenario: after its warm-up, 90 sim-seconds through the hike (at 30 s). */
const RATE_SHOCK_TICKS = 900;

/** The first non-finite number inside `value` (objects, arrays, Maps, Sets), as "path = value", or null. */
export function findNonFinite(value: unknown, path: string, seen = new WeakSet<object>()): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path} = ${value}`;
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    const a = value as unknown as ArrayLike<number | bigint>;
    for (let i = 0; i < a.length; i++) if (typeof a[i] === "number" && !Number.isFinite(a[i] as number)) return `${path}[${i}] = ${a[i]}`;
    return null;
  }
  if (value instanceof Map) {
    for (const [k, v] of value) {
      const hit = findNonFinite(k, `${path}.key(${String(k)})`, seen) ?? findNonFinite(v, `${path}.get(${String(k)})`, seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value instanceof Set) {
    let i = 0;
    for (const v of value) {
      const hit = findNonFinite(v, `${path}{${i++}}`, seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    const hit = findNonFinite(v, Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`, seen);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The demo crowd with every agent object kept for inspection (D-091): each spec's `create` is wrapped
 * to remember what it returns. Ids, types, rates and random streams are untouched, so the market is the
 * same one the product runs (the pinned hashes prove it).
 */
function watchedCrowd(): { specs: AgentSpec[]; agents: Array<{ id: string; agent: unknown }> } {
  const agents: Array<{ id: string; agent: unknown }> = [];
  const specs = demoAgents().map((spec) => ({
    ...spec,
    create: (stream: Parameters<AgentSpec["create"]>[0]) => {
      const agent = spec.create(stream);
      agents.push({ id: spec.id, agent });
      return agent;
    },
  }));
  return { specs, agents };
}

function record(id: string, sim: Simulation, ticks: number, agents: Array<{ id: string; agent: unknown }>): { run: DeterminismRun; nonFinite: string | null } {
  const perTick: string[] = [];
  let seen = sim.engine.fills.length;
  let nonFinite: string | null = null;
  for (let t = 0; t < ticks; t++) {
    sim.run(1);
    const fills = sim.engine.fills;
    const hashed = { fills: fills.slice(seen), bids: sim.engine.book.depth("buy"), asks: sim.engine.book.depth("sell") };
    perTick.push(fingerprint(hashed).slice(0, 8));
    seen = fills.length;
    if (nonFinite === null) {
      const hit = findNonFinite(hashed, "hashed") ?? agents.reduce<string | null>((h, a) => h ?? findNonFinite(a.agent, `agent ${a.id}`), null);
      if (hit !== null) nonFinite = `${id} tick ${t + 1}: ${hit}`;
    }
  }
  const final = fingerprint({ fills: sim.engine.fills, bids: sim.engine.book.depth("buy"), asks: sim.engine.book.depth("sell") });
  return { run: { id, ticks, fills: sim.engine.fills.length, final, perTick }, nonFinite };
}

/**
 * A double's bits as hex, every NaN as the canonical 0x7ff8000000000000 (D-091): a NaN's payload is
 * implementation-defined (V8 keeps it; SpiderMonkey and JavaScriptCore canonicalize it), so it is not
 * part of what must be identical.
 */
export const bitsOf = (() => {
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  return (x: number) => {
    if (Number.isNaN(x)) return "0x7ff8000000000000";
    f64[0] = x;
    return `0x${u32[1].toString(16).padStart(8, "0")}${u32[0].toString(16).padStart(8, "0")}`;
  };
})();

export function runDeterminism(): DeterminismResult {
  // Free play: the product's demo market (createDemoMarket), with its agents watched.
  const freeCrowd = watchedCrowd();
  const free = record(`free-${SEED}`, new Simulation({ seed: SEED, ticker: "MLAB", agents: freeCrowd.specs }), FREE_TICKS, freeCrowd.agents);
  // The Fed hike: as createScenarioMarket builds it (warm-up, then the scenario's scheduled shocks).
  const shockCrowd = watchedCrowd();
  const shockSim = new Simulation({ seed: SEED, ticker: "MLAB", agents: shockCrowd.specs });
  shockSim.run(WARMUP_TICKS);
  const start = shockSim.clock.now;
  for (const s of scenarioById("rate-shock")!.shocks) shockSim.scheduleShock(start + s.atSec * 1_000, s.shock, s.code, s.headline, s.release);
  const rateShock = record(`rate-shock-${SEED}`, shockSim, RATE_SHOCK_TICKS, shockCrowd.agents);
  const { lnIn, expIn } = detMathInputs();
  const detMath: [string, string] = [fingerprint(lnIn.map((x) => bitsOf(ln(x)))), fingerprint(expIn.map((x) => bitsOf(exp(x))))];
  return { runs: [free.run, rateShock.run], nonFinite: free.nonFinite ?? rateShock.nonFinite, detMath };
}

/** Where two results first differ: the run and tick, or detMath, or null if they are identical. */
export function firstDivergence(expected: DeterminismResult, actual: DeterminismResult): string | null {
  for (const e of expected.runs) {
    const a = actual.runs.find((r) => r.id === e.id);
    if (a === undefined) return `${e.id}: missing`;
    const tick = e.perTick.findIndex((h, i) => a.perTick[i] !== h);
    if (tick >= 0) return `${e.id}: first diverging tick ${tick + 1} of ${e.ticks} (sim +${((tick + 1) / 10).toFixed(1)} s), expected ${e.perTick[tick]}, got ${a.perTick[tick]}`;
    if (a.final !== e.final) return `${e.id}: every tick matches but the final state differs (${e.final} vs ${a.final})`;
  }
  if (expected.detMath.join() !== actual.detMath.join()) return `detMath: expected ${expected.detMath.join(", ")}, got ${actual.detMath.join(", ")}`;
  return null;
}
