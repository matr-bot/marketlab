import { marketMakers } from "./agents/marketMaker";
import { noiseTraders } from "./agents/noiseTrader";
import { Simulation } from "./simulation";

// The market every page load opens on (CLAUDE.md: calm regime, demo seed). One definition shared
// by the worker and the tests, so what the tests pin is what the page shows.

/** The demo seed shown in the status bar. */
export const DEMO_SEED = 187;

/** Sim time simulated before the first frame, so the chart, tape and volatility are warm (D-038). */
export const WARMUP_TICKS = 6_000; // 10 minutes: the page opens at 09:40:00.000

/** 40 noise traders and two Avellaneda–Stoikov market makers trading MLAB from $187.00. */
export function createDemoMarket(seed: number = DEMO_SEED): Simulation {
  return new Simulation({ seed, ticker: "MLAB", agents: [...noiseTraders(40, 0.5), ...marketMakers()] });
}
