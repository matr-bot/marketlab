import { marketMakers } from "./agents/marketMaker";
import { noiseTraders } from "./agents/noiseTrader";
import { panicTraders } from "./agents/panicTrader";
import { valueTraders } from "./agents/valueTrader";
import { MarketFeed, type Frame } from "./feed";
import type { ShockParams } from "./fundamental";
import { Simulation } from "./simulation";

/** These are illustrative fictional businesses, not claims about real securities. */
export const FACTORS = ["broadMarket", "technology", "energy", "airTravel", "aerospace", "oilCosts", "interestRates", "tradeFriction", "semiconductors"] as const;
export type Factor = (typeof FACTORS)[number];
export type FactorEffect = { readonly factor: Factor; readonly direction: -1 | 1; readonly strength: 1 | 2 | 3; readonly mechanism: string };
export interface ScenarioInterpretation {
  readonly summary: string;
  readonly entities: readonly string[];
  readonly sectors: readonly string[];
  readonly mechanisms: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: "low" | "medium" | "high";
  readonly effects: readonly FactorEffect[];
}

export interface FictionalAsset {
  readonly ticker: string;
  readonly name: string;
  readonly startPrice: number;
  readonly exposure: Readonly<Partial<Record<Factor, number>>>;
}

export const STUDIO_ASSETS: readonly FictionalAsset[] = [
  { ticker: "MLAB", name: "Broad market", startPrice: 18_700, exposure: { broadMarket: 1, technology: 0.25, energy: 0.1, oilCosts: -0.2, interestRates: -0.7, tradeFriction: -0.5, semiconductors: 0.15 } },
  { ticker: "TECX", name: "Technology", startPrice: 12_500, exposure: { broadMarket: 0.5, technology: 1, interestRates: -0.9, tradeFriction: -0.5, semiconductors: 0.8 } },
  { ticker: "ENRG", name: "Energy", startPrice: 8_400, exposure: { broadMarket: 0.3, energy: 1, oilCosts: 0.9, tradeFriction: -0.2 } },
  { ticker: "AIRX", name: "Airlines", startPrice: 6_200, exposure: { broadMarket: 0.5, airTravel: 1, oilCosts: -1, interestRates: -0.3, tradeFriction: -0.2 } },
  { ticker: "AERO", name: "Aerospace", startPrice: 15_200, exposure: { broadMarket: 0.4, aerospace: 1, technology: 0.2, tradeFriction: -0.4, semiconductors: 0.2 } },
];

export const SCENARIO_COMPILER_VERSION = "studio-1";
export interface AssetSignal { readonly ticker: string; readonly fairValuePct: number; readonly contributingFactors: readonly Factor[] }
export interface CompiledScenario {
  readonly version: typeof SCENARIO_COMPILER_VERSION;
  readonly seed: number;
  readonly interpretation: ScenarioInterpretation;
  readonly signals: readonly AssetSignal[];
}

/** Fixed illustrative calibration: model chooses mechanisms, code bounds their effects. */
export function compileScenario(interpretation: ScenarioInterpretation, seed: number): CompiledScenario {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError("Invalid scenario seed");
  const effects = interpretation.effects.slice(0, FACTORS.length);
  const signals = STUDIO_ASSETS.map((asset) => {
    let sum = 0;
    const factors: Factor[] = [];
    for (const effect of effects) {
      if (!FACTORS.includes(effect.factor) || ![-1, 1].includes(effect.direction) || ![1, 2, 3].includes(effect.strength)) throw new RangeError("Invalid scenario effect");
      const weight = asset.exposure[effect.factor] ?? 0;
      if (weight !== 0) {
        sum += weight * effect.direction * effect.strength;
        factors.push(effect.factor);
      }
    }
    return { ticker: asset.ticker, fairValuePct: Math.max(-0.06, Math.min(0.06, sum * 0.008)), contributingFactors: factors };
  });
  return { version: SCENARIO_COMPILER_VERSION, seed, interpretation, signals };
}

export interface StudioAssetFrame { readonly ticker: string; readonly name: string; readonly frame: Frame; readonly ordersSubmitted: number; readonly totalTrades: number }

/** A small independent market per asset. The legacy MLAB worker and student strategy are untouched. */
export class ScenarioStudioMarket {
  private readonly feeds: MarketFeed[];
  private readonly counts: number[];
  private readonly orders: number[];
  readonly compiled: CompiledScenario;

  constructor(compiled: CompiledScenario) {
    if (compiled.version !== SCENARIO_COMPILER_VERSION) throw new RangeError("Unknown scenario compiler version");
    this.compiled = compiled;
    this.counts = STUDIO_ASSETS.map(() => 0);
    this.orders = STUDIO_ASSETS.map(() => 0);
    this.feeds = STUDIO_ASSETS.map((asset, index) => {
      const sim = new Simulation({
        seed: (compiled.seed + index * 10_007) >>> 0,
        ticker: asset.ticker,
        startPrice: asset.startPrice,
        observer: { onSubmit: () => { this.orders[index]++; } },
        agents: [...noiseTraders(12, 0.5), ...marketMakers(), ...valueTraders(8, 0.5), ...panicTraders(8, 1)],
      });
      return new MarketFeed(sim, compiled.seed);
    });
    this.advance(300); // Same 30-second opening book on every replay.
    compiled.signals.forEach((signal, index) => {
      if (Math.abs(signal.fairValuePct) < 1e-9) return;
      const sim = this.feeds[index].sim;
      // Information arrives in three tranches. Each changes agent inputs, never the traded price.
      const fractions = [0.5, 0.3, 0.2];
      const offsets = [0, 8_000, 25_000];
      let remaining = signal.fairValuePct;
      fractions.forEach((fraction, step) => {
        const pct = step === fractions.length - 1 ? remaining : signal.fairValuePct * fraction;
        remaining = (1 + remaining) / (1 + pct) - 1;
        const shock: ShockParams = {
          fairValuePct: pct,
          panicSensitivity: signal.fairValuePct < 0 ? 1.4 : 1,
          durationSec: 90,
          volatilityMultiplier: 1,
          liquidityMultiplier: compiled.interpretation.uncertainty === "high" ? 0.75 : 1,
        };
        sim.scheduleShock(sim.clock.now + offsets[step], shock, `STUDIO ${step + 1}`, compiled.interpretation.summary.slice(0, 120));
      });
    });
  }

  advance(ticks: number): void { for (const feed of this.feeds) feed.advance(ticks); }

  frames(): StudioAssetFrame[] {
    return this.feeds.map((feed, index) => {
      const frame = feed.frame();
      this.counts[index] += frame.trades.length + frame.droppedTrades;
      return { ticker: STUDIO_ASSETS[index].ticker, name: STUDIO_ASSETS[index].name, frame, ordersSubmitted: this.orders[index], totalTrades: this.counts[index] };
    });
  }
}
