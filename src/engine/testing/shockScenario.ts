// Shock signature harness (test-only, D-047). Runs the demo market, applies a headline and measures
// what a judge would see: how far and how fast the price moved, whether panic cascaded, whether
// market makers pulled back (spread, their share of the best prices, depth near the mid), how much
// the price recovered, and who made money in the first minute. Every number comes from engine state.
import type { AgentSpec } from "../agents/agent";
import { createDemoMarket, WARMUP_TICKS } from "../demoMarket";
import type { ShockParams } from "../fundamental";
import { Simulation } from "../simulation";

export interface ScenarioOptions {
  /** Sim ticks before the headline (default: the page's 10-minute warm-up). */
  readonly warmupTicks?: number;
  /** Sim ticks recorded after the headline (default 6 minutes). */
  readonly afterTicks?: number;
  /** Agents, if not the demo crowd. */
  readonly agents?: readonly AgentSpec[];
}

interface TickRow {
  time: number;
  mid: number | null;
  spread: number | null;
  /** Share of the quantity at the best bid and ask that belongs to market makers. */
  mmBestShare: number;
  /** Shares resting within 10¢ of the mid, both sides; and how many of them are market makers'. */
  depth10: number;
  mmDepth10: number;
}

export interface ScenarioResult {
  readonly seed: number;
  /** Mid at the headline, fair value before and after (cents). */
  readonly m0: number;
  readonly v0: number;
  readonly v1: number;
  /** Most extreme mid in the direction of the news within 60 s, and within the whole run (as % move from m0). */
  readonly move60Pct: number;
  readonly moveMaxPct: number;
  /** Seconds from the headline to the extreme. */
  readonly extremeAtSec: number;
  /** Share of the move recovered 180 s after the extreme: (mid(extreme + 180 s) − extreme) / (m0 − extreme). */
  readonly recoveredShare: number;
  /** Mid 180 s after the extreme, as % from m0. */
  readonly recoveredMidPct: number;
  /**
   * Share of the overshoot past the new fair value recovered 180 s after the extreme:
   * (mid(extreme + 180 s) − extreme) / (V₁ − extreme); NaN if the price never went past V₁.
   */
  readonly overshootRecovered: number;
  /** Mid at the end of the run as % from m0, and as % from the new fair value. */
  readonly endPct: number;
  readonly endVsFairPct: number;
  readonly panicSellsBefore: number;
  readonly panicSharesAfter: number;
  readonly panicTradersAfter: number;
  /** 2 minutes before vs the 30 s after: average spread, MM share of best quantity, depth within 10¢. */
  readonly spreadBefore: number;
  readonly spreadAfter: number;
  readonly mmBestShareBefore: number;
  readonly mmBestShareAfter: number;
  readonly depth10Before: number;
  readonly depth10After: number;
  /** Market makers' own shares within 10¢ of the mid: their withdrawal in absolute terms. */
  readonly mmDepth10Before: number;
  readonly mmDepth10After: number;
  /** First-minute P&L in dollars by agent type (from Simulation.shockImpacts). */
  readonly pnl60: Readonly<Record<string, number>>;
  /** Ticks where a side of the book was empty, after the headline. */
  readonly oneSidedTicks: number;
}

/** What the book looks like at the end of a tick. */
function snapshot(sim: Simulation): TickRow {
  const book = sim.engine.book;
  const bid = book.bestBid();
  const ask = book.bestAsk();
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  let best = 0;
  let mmBest = 0;
  for (const [side, price] of [["buy", bid], ["sell", ask]] as const) {
    if (price === null) continue;
    for (const o of book.ordersAt(side, price)) {
      best += o.qty;
      if (o.agentType === "marketMaker") mmBest += o.qty;
    }
  }
  let depth10 = 0;
  let mmDepth10 = 0;
  if (mid !== null) {
    for (const side of ["buy", "sell"] as const) {
      for (const l of book.depth(side)) {
        if (Math.abs(l.price - mid) > 10) continue;
        depth10 += l.qty;
        for (const o of book.ordersAt(side, l.price)) if (o.agentType === "marketMaker") mmDepth10 += o.qty;
      }
    }
  }
  return { time: sim.clock.now, mid, spread: mid === null ? null : ask! - bid!, mmBestShare: best > 0 ? mmBest / best : 0, depth10, mmDepth10 };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

/** Run the demo market, apply `shocks` (label → params) at the end of the warm-up, measure the response. */
export function runShockScenario(seed: number, shocks: ReadonlyArray<{ label: string; shock: ShockParams; atTick?: number }>, options: ScenarioOptions = {}): ScenarioResult & { sim: Simulation; rows: TickRow[] } {
  const warmup = options.warmupTicks ?? WARMUP_TICKS;
  const after = options.afterTicks ?? 3_600;
  const sim = options.agents ? new Simulation({ seed, ticker: "MLAB", agents: options.agents }) : createDemoMarket(seed);
  const rows: TickRow[] = [];
  const panicFills: Array<{ time: number; owner: string; qty: number }> = [];

  sim.run(warmup);
  const shocksByTick = new Map<number, Array<{ label: string; shock: ShockParams }>>();
  for (const s of shocks) shocksByTick.set(s.atTick ?? 0, [...(shocksByTick.get(s.atTick ?? 0) ?? []), s]);
  const t0 = sim.clock.now;
  for (let i = 0; i < after; i++) {
    for (const s of shocksByTick.get(i) ?? []) sim.applyShock(s.shock, s.label);
    sim.step();
    rows.push(snapshot(sim));
  }
  for (const f of sim.engine.fills) if (f.sell.agentType === "panic") panicFills.push({ time: f.time, owner: f.sell.ownerId, qty: f.qty });

  // The baseline is the 2 minutes before the headline: the same seed replayed (deterministic).
  const base = options.agents ? new Simulation({ seed, ticker: "MLAB", agents: options.agents }) : createDemoMarket(seed);
  const baseRows: TickRow[] = [];
  base.run(warmup - 1_200);
  for (let i = 0; i < 1_200; i++) {
    base.step();
    baseRows.push(snapshot(base));
  }

  const first = sim.shocks[0];
  const shockTime = first ? first.time : t0;
  const m0 = baseRows[baseRows.length - 1].mid ?? sim.startPrice;
  const down = (first?.fairValueAfter ?? 0) < (first?.fairValueBefore ?? 0);
  const mids = rows.filter((r) => r.mid !== null) as Array<TickRow & { mid: number }>;
  const extremeOf = (rs: typeof mids) => rs.reduce((e, r) => ((down ? r.mid < e.mid : r.mid > e.mid) ? r : e), rs[0]);
  const within60 = mids.filter((r) => r.time <= shockTime + 60_000);
  const e60 = extremeOf(within60);
  const eAll = extremeOf(mids);
  const later = mids.find((r) => r.time >= eAll.time + 180_000) ?? mids[mids.length - 1];
  const pct = (x: number) => (100 * (x - m0)) / m0;
  const end = mids[mids.length - 1].mid;
  const v1 = sim.fundamental.value;
  const afterRows = rows.filter((r) => r.time > shockTime && r.time <= shockTime + 30_000);
  const impact = sim.shockImpacts[0]?.pnlByType ?? {};
  const pnl60: Record<string, number> = {};
  for (const [k, v] of Object.entries(impact)) pnl60[k] = (v as number) / 100;
  const panicAfter = panicFills.filter((f) => f.time >= shockTime);

  return {
    sim,
    rows,
    seed,
    m0,
    v0: first?.fairValueBefore ?? sim.fundamental.value,
    v1,
    move60Pct: pct(e60.mid),
    moveMaxPct: pct(eAll.mid),
    extremeAtSec: (eAll.time - shockTime) / 1000,
    recoveredShare: eAll.mid === m0 ? 0 : (later.mid - eAll.mid) / (m0 - eAll.mid),
    recoveredMidPct: pct(later.mid),
    overshootRecovered: (down ? eAll.mid < v1 : eAll.mid > v1) ? (later.mid - eAll.mid) / (v1 - eAll.mid) : NaN,
    endPct: pct(end),
    endVsFairPct: (100 * (end - v1)) / v1,
    panicSellsBefore: panicFills.filter((f) => f.time < shockTime).length,
    panicSharesAfter: panicAfter.reduce((s, f) => s + f.qty, 0),
    panicTradersAfter: new Set(panicAfter.map((f) => f.owner)).size,
    spreadBefore: avg(baseRows.flatMap((r) => (r.spread === null ? [] : [r.spread]))),
    spreadAfter: avg(afterRows.flatMap((r) => (r.spread === null ? [] : [r.spread]))),
    mmBestShareBefore: avg(baseRows.map((r) => r.mmBestShare)),
    mmBestShareAfter: avg(afterRows.map((r) => r.mmBestShare)),
    depth10Before: avg(baseRows.map((r) => r.depth10)),
    depth10After: avg(afterRows.map((r) => r.depth10)),
    mmDepth10Before: avg(baseRows.map((r) => r.mmDepth10)),
    mmDepth10After: avg(afterRows.map((r) => r.mmDepth10)),
    pnl60,
    oneSidedTicks: rows.filter((r) => r.mid === null).length,
  };
}
