// Fill-intensity measurement for the market makers' k (test-only, D-049). Avellaneda & Stoikov
// (2008) model fills at distance δ from the mid as arriving at rate λ(δ) = A·e^(−kδ). We measure it:
// for every market-maker quote, its distance from the mid when placed (whole cents), how long it
// rested (until cancelled, fully filled or the run ended) and how many fills it got. λ(δ) = fills ÷
// quote-seconds at that distance; k is minus the slope of a least-squares fit of ln λ on δ.
import type { AgentSpec } from "../agents/agent";
import { ln } from "../detMath";
import { Simulation } from "../simulation";

export interface IntensityBin {
  /** Distance from the mid at placement, whole cents (rounded half up). */
  readonly delta: number;
  readonly quoteSeconds: number;
  readonly fills: number;
  /** Fills per quote-second. */
  readonly lambda: number;
}

export interface IntensityFit {
  readonly bins: readonly IntensityBin[];
  /** Fitted ln λ = lnA − k·δ over bins with at least `minFills` fills. */
  readonly k: number;
  readonly lnA: number;
  /** R² of the fit. */
  readonly r2: number;
}

/** Measure λ(δ) for every market maker in a market built from `agents`, over `ticks` ticks of `seeds`. */
export function measureFillIntensity(agents: () => AgentSpec[], seeds: readonly number[], ticks: number, minFills = 30): IntensityFit {
  const quoteMs = new Map<number, number>();
  const fillCount = new Map<number, number>();
  for (const seed of seeds) {
    const open = new Map<string, { delta: number; since: number; left: number }>();
    const close = (id: string, at: number) => {
      const q = open.get(id);
      if (!q) return;
      quoteMs.set(q.delta, (quoteMs.get(q.delta) ?? 0) + (at - q.since));
      open.delete(id);
    };
    const sim: Simulation = new Simulation({
      seed,
      agents: agents(),
      observer: {
        onSubmit: (_agent, order, result, time) => {
          if (!result.ok) return;
          for (const f of result.fills) {
            const maker = f.aggressor === "buy" ? f.sell : f.buy;
            const q = open.get(maker.orderId);
            if (!q) continue;
            fillCount.set(q.delta, (fillCount.get(q.delta) ?? 0) + 1);
            q.left -= f.qty;
            if (q.left <= 0) close(maker.orderId, time);
          }
          if (order.agentType !== "marketMaker" || result.resting === null) return;
          // Distance from the mid the quote was priced against: the arrival quote recorded by the engine.
          const { midX2 } = result.arrival;
          if (midX2 === null) return;
          open.set(result.orderId, { delta: Math.floor(Math.abs(result.resting.price - midX2 / 2) + 0.5), since: time, left: result.resting.qty });
        },
        onCancel: (_agent, orderId, result, time) => {
          if (result.ok) close(orderId, time);
        },
      },
    });
    sim.run(ticks);
    for (const id of [...open.keys()]) close(id, sim.clock.now);
  }

  const bins: IntensityBin[] = [...quoteMs.keys()]
    .sort((a, b) => a - b)
    .map((delta) => {
      const quoteSeconds = quoteMs.get(delta)! / 1000;
      const fills = fillCount.get(delta) ?? 0;
      return { delta, quoteSeconds, fills, lambda: quoteSeconds > 0 ? fills / quoteSeconds : 0 };
    });
  const used = bins.filter((b) => b.fills >= minFills && b.delta >= 1);
  const xs = used.map((b) => b.delta);
  const ys = used.map((b) => ln(b.lambda));
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const sxx = xs.reduce((s, x) => s + (x - mx) * (x - mx), 0);
  const slope = sxy / sxx;
  const ssTot = ys.reduce((s, y) => s + (y - my) * (y - my), 0);
  const ssRes = ys.reduce((s, y, i) => {
    const e = y - (my + slope * (xs[i] - mx));
    return s + e * e;
  }, 0);
  return { bins, k: -slope, lnA: my - slope * mx, r2: 1 - ssRes / ssTot };
}
