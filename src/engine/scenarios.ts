import { createDemoMarket, DEMO_SEED, WARMUP_TICKS } from "./demoMarket";
import type { ShockParams } from "./fundamental";
import type { Simulation } from "./simulation";
import type { Side } from "./types";

// Scenarios: a market situation a professor can assign with a link. A scenario is data only: a seed,
// the headlines that hit at fixed sim times after the market opens, and the brief and task the
// student reads. Because the engine is seeded, every student who opens the same link sees the same
// market and the same headlines at the same moments; a student's own trades are the only difference.
// That is what makes results comparable across a class.

export interface ScenarioShock {
  /** Sim seconds after the scenario starts (the market is already open and warmed up). */
  readonly atSec: number;
  /** Short code for the chart marker, e.g. "HIKE". */
  readonly code: string;
  readonly headline: string;
  readonly shock: ShockParams;
}

/** A measurable goal: trade this much, and the debrief reports the cost. */
export interface ScenarioTarget {
  readonly side: Side;
  readonly qty: number;
}

export interface Scenario {
  /** Used in links: `?scn=<id>`. Lowercase letters, digits and dashes. */
  readonly id: string;
  readonly title: string;
  /** What is happening, in two or three plain sentences. */
  readonly brief: string;
  /** What the student is asked to do. */
  readonly task: string;
  /** The concept it teaches, in a few words. */
  readonly teaches: string;
  readonly seed: number;
  readonly shocks: readonly ScenarioShock[];
  readonly target?: ScenarioTarget;
  /** Suggested time to watch and trade, in sim seconds. */
  readonly durationSec: number;
}

export const FREE_PLAY: Scenario = {
  id: "free",
  title: "Free play",
  brief: "A calm market, already trading. Nothing is scheduled: type a headline, or trade, and watch what the crowd does.",
  task: "Experiment. Try FED, then SHOCK -2 to send your own fair-value shock, then BUY 500 and look at the execution report.",
  teaches: "Order book, price formation",
  seed: DEMO_SEED,
  shocks: [],
  durationSec: 600,
};

export const SCENARIOS: readonly Scenario[] = [
  FREE_PLAY,
  {
    id: "rate-shock",
    title: "Rate shock",
    brief: "The market is calm. Thirty seconds in, the Fed announces a surprise 75 basis point hike. Value traders will mark the stock down; some holders will panic.",
    task: "Before the news, decide whether to hold, sell or stay out. Trade through the headline, then explain who sold, why the price overshot, and what your trades cost you.",
    teaches: "News, fair value, overreaction",
    seed: 4101,
    shocks: [{ atSec: 30, code: "HIKE", headline: "Fed surprise hike 75bps", shock: { fairValuePct: -0.03, panicSensitivity: 1.5, durationSec: 300, volatilityMultiplier: 1, liquidityMultiplier: 1 } }],
    durationSec: 420,
  },
  {
    id: "earnings-miss",
    title: "Earnings miss, then a guidance cut",
    brief: "Results land below expectations, and ninety seconds later the company also cuts its outlook. Two pieces of bad news arrive close together.",
    task: "Sell into the first headline, or wait? Compare what you would have gotten at each moment, and how the second headline hit a market that had already moved.",
    teaches: "Sequential news, liquidity",
    seed: 4102,
    shocks: [
      { atSec: 20, code: "MISS", headline: "Earnings miss estimates", shock: { fairValuePct: -0.025, panicSensitivity: 1.3, durationSec: 240, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
      { atSec: 110, code: "CUT", headline: "Company cuts full-year guidance", shock: { fairValuePct: -0.02, panicSensitivity: 1.5, durationSec: 240, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
    ],
    durationSec: 480,
  },
  {
    id: "fraud",
    title: "Accounting fraud",
    brief: "A shock with no warning: the CEO is arrested for accounting fraud. Fair value drops sharply and panic sensitivity doubles.",
    task: "Market makers get hurt first. Watch the spread widen and the book thin out. Can you sell without paying the price of the panic? Report your slippage.",
    teaches: "Panic cascades, liquidity withdrawal",
    seed: 4103,
    shocks: [{ atSec: 25, code: "FRAUD", headline: "CEO arrested for accounting fraud", shock: { fairValuePct: -0.06, panicSensitivity: 2, durationSec: 300, volatilityMultiplier: 1, liquidityMultiplier: 1 } }],
    durationSec: 420,
  },
  {
    id: "whipsaw",
    title: "Bad news, then a reversal",
    brief: "A downgrade hits, and two minutes later the analyst walks it back and the company beats estimates. The price falls and then has to recover.",
    task: "Can you buy the overreaction? Find the bottom, size your order, and measure how much your own buying moved the price on the way back up.",
    teaches: "Overreaction, market impact",
    seed: 4104,
    shocks: [
      { atSec: 20, code: "DOWN", headline: "Analyst downgrades to sell", shock: { fairValuePct: -0.035, panicSensitivity: 1.8, durationSec: 240, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
      { atSec: 140, code: "BEAT", headline: "Earnings beat, guidance raised", shock: { fairValuePct: 0.045, panicSensitivity: 0.5, durationSec: 240, volatilityMultiplier: 1, liquidityMultiplier: 1 } },
    ],
    durationSec: 480,
  },
  {
    id: "quiet-buy",
    title: "Buy 50,000 shares quietly",
    brief: "You are an execution trader. A portfolio manager needs 50,000 shares of MLAB bought today. The market is calm and nothing is scheduled.",
    task: "Buy all 50,000 shares at the lowest cost you can. One big market order will run through the book, fill only part of the size, and push the price against you. Slice the order over time or post limit orders, then compare your slippage in basis points.",
    teaches: "Market impact, slippage, order slicing",
    seed: 4105,
    shocks: [],
    target: { side: "buy", qty: 50_000 },
    durationSec: 900,
  },
];

const BY_ID: ReadonlyMap<string, Scenario> = new Map(SCENARIOS.map((s) => [s.id, s]));

/** The scenario with this id (case-insensitive), or undefined. */
export function scenarioById(id: string): Scenario | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

/** Largest accepted seed: a whole number the random generator takes as-is. */
export const MAX_SEED = 2_147_483_647;

/** A seed from text: a whole number in 0..MAX_SEED, else undefined. */
export function parseSeed(text: string | null | undefined): number | undefined {
  if (text === null || text === undefined || !/^\d{1,10}$/.test(text.trim())) return undefined;
  const n = Number(text.trim());
  return n <= MAX_SEED ? n : undefined;
}

/**
 * What to run for a link like `/?scn=rate-shock&seed=42`: the scenario (free play if missing or
 * unknown) and its seed (the link's seed overrides the scenario's, for a "what if?" rerun).
 */
export function resolveRun(scn: string | null | undefined, seed: string | null | undefined): { scenario: Scenario; seed: number; unknownScenario: boolean } {
  const found = scn === null || scn === undefined || scn === "" ? undefined : scenarioById(scn);
  const scenario = found ?? FREE_PLAY;
  return { scenario, seed: parseSeed(seed) ?? scenario.seed, unknownScenario: found === undefined && scn !== null && scn !== undefined && scn !== "" };
}

/** The link that reopens this exact run: scenario and seed. Relative, so it works on any host. */
export function runLink(scenario: Scenario, seed: number): string {
  return `/?scn=${scenario.id}&seed=${seed}`;
}

/**
 * The market a scenario opens on: the demo crowd on `seed`, warmed up exactly like the page's
 * default market (so it is already trading), with the scenario's headlines on the calendar at
 * `atSec` seconds after the warm-up. Deterministic: the same scenario and seed give the same market.
 */
export function createScenarioMarket(scenario: Scenario, seed: number = scenario.seed): Simulation {
  const sim = createDemoMarket(seed);
  sim.run(WARMUP_TICKS);
  const start = sim.clock.now;
  for (const s of scenario.shocks) sim.scheduleShock(start + s.atSec * 1_000, s.shock, s.code, s.headline);
  return sim;
}
