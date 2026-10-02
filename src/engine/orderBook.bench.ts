import { bench, describe } from "vitest";
import { OrderBook } from "./orderBook";
import type { Side } from "./types";

// Run with `npm run bench`. Each benchmark replays a pre-generated list of exactly
// 100,000 operations on a fresh book, so ops/sec = hz × 100,000.

const OPS = 100_000;
const MID = 100_000; // $1,000.00 in cents

type Op =
  | { kind: "add"; id: string; side: Side; price: number; qty: number }
  | { kind: "cancel"; id: string };

/** Test-local deterministic generator (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random mix: `addShare` of ops add a resting order within `levelsPerSide` ticks of the mid,
 * the rest cancel a uniformly random live order (front, middle or back of its queue).
 */
function mixedOps(levelsPerSide: number, addShare: number, seed: number): Op[] {
  const rand = rng(seed);
  const live: string[] = [];
  const ops: Op[] = [];
  for (let i = 0; ops.length < OPS; i++) {
    if (live.length === 0 || rand() < addShare) {
      const side: Side = rand() < 0.5 ? "buy" : "sell";
      const offset = 1 + Math.floor(rand() * levelsPerSide);
      const id = `o${i}`;
      ops.push({ kind: "add", id, side, price: side === "buy" ? MID - offset : MID + offset, qty: 1 + Math.floor(rand() * 100) });
      live.push(id);
    } else {
      const idx = Math.floor(rand() * live.length);
      ops.push({ kind: "cancel", id: live[idx] });
      live[idx] = live[live.length - 1];
      live.pop();
    }
  }
  return ops;
}

/** Market makers each tick: cancel last quote, post a new one within 5 ticks of the mid. */
function requoteOps(agents: number, seed: number): Op[] {
  const rand = rng(seed);
  const quotes: (string | null)[] = new Array(agents).fill(null);
  const ops: Op[] = [];
  for (let tick = 0; ops.length < OPS; tick++) {
    for (let a = 0; a < agents && ops.length < OPS; a++) {
      const prev = quotes[a];
      if (prev) ops.push({ kind: "cancel", id: prev });
      if (ops.length >= OPS) break;
      const side: Side = a % 2 === 0 ? "buy" : "sell";
      const offset = 1 + Math.floor(rand() * 5);
      const id = `q${tick}-${a}`;
      ops.push({ kind: "add", id, side, price: side === "buy" ? MID - offset : MID + offset, qty: 100 });
      quotes[a] = id;
    }
  }
  return ops;
}

function replay(ops: Op[]) {
  const book = new OrderBook("BENCH");
  for (const op of ops) {
    if (op.kind === "add") book.add({ id: op.id, ownerId: "b", agentType: "noise", side: op.side, price: op.price, qty: op.qty });
    else book.cancel(op.id);
  }
  return book;
}

const scenarios = {
  "mixed add/cancel, ~200 levels (60% add)": mixedOps(100, 0.6, 1),
  "mixed add/cancel, ~5,000 levels (60% add)": mixedOps(2_500, 0.6, 2),
  "market-maker requote, 100 agents/tick": requoteOps(100, 3),
};

describe("OrderBook: 100,000 operations per iteration", () => {
  for (const [name, ops] of Object.entries(scenarios)) {
    const peak = replay(ops);
    bench(`${name} [ends at ${peak.size} orders, ${peak.levelCount("buy") + peak.levelCount("sell")} levels]`, () => {
      replay(ops);
    }, { time: 2_000 });
  }
});
