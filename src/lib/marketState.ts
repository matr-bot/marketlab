import type { Candle, Frame, FrameHeadline, FrameTrade } from "@/engine/feed";
import type { AgentType } from "@/engine/types";

// What the panels show, folded from the worker's frames. Pure: (state, frame) → new state, so the
// page holds no market logic of its own and every number on screen comes from a frame.

/** Candles kept for the chart: one sim-hour of 10-second candles. */
export const MAX_CANDLES = 360;
/** Trades kept for TAPE, newest first. */
export const MAX_TAPE = 100;
/** Headlines kept for GP markers and the narrator. */
export const MAX_HEADLINES = 50;

/** A headline the page knows about, with its first-minute P&L once the worker has sent it. */
export interface HeadlineState extends FrameHeadline {
  readonly pnlByType: Readonly<Partial<Record<AgentType, number>>> | null;
}

export interface MarketState {
  /** The latest frame: quotes, depth, last price, volume, clock, seed. */
  readonly frame: Frame;
  /** Candles in time order (a candle updated in a later frame replaces the earlier version). */
  readonly candles: readonly Candle[];
  /** Most recent trades, newest first. */
  readonly tape: readonly FrameTrade[];
  /** Frames received, so a component can tell a new batch of trades from a re-render. */
  readonly frameCount: number;
  /** The last MAX_HEADLINES headlines, oldest first. */
  readonly headlines: readonly HeadlineState[];
}

export function applyFrame(prev: MarketState | null, frame: Frame): MarketState {
  return {
    frame,
    candles: mergeCandles(prev?.candles ?? [], frame.candles),
    tape: frame.trades.length === 0 && prev ? prev.tape : [...frame.trades].reverse().concat(prev?.tape ?? []).slice(0, MAX_TAPE),
    frameCount: (prev?.frameCount ?? 0) + 1,
    headlines: mergeHeadlines(prev?.headlines ?? [], frame),
  };
}

function mergeHeadlines(have: readonly HeadlineState[], frame: Frame): readonly HeadlineState[] {
  if (frame.headlines.length === 0 && frame.impacts.length === 0) return have;
  const pnl = new Map(frame.impacts.map((i) => [i.seq, i.pnlByType]));
  const merged = [...have, ...frame.headlines.map((h) => ({ ...h, pnlByType: null }))].map((h) => (pnl.has(h.seq) ? { ...h, pnlByType: pnl.get(h.seq)! } : h));
  return merged.length > MAX_HEADLINES ? merged.slice(merged.length - MAX_HEADLINES) : merged;
}

function mergeCandles(have: readonly Candle[], updates: readonly Candle[]): readonly Candle[] {
  if (updates.length === 0) return have;
  // Updates are oldest first; they replace every candle we have from the first update's start on.
  const firstStart = updates[0].start;
  let keep = have.length;
  while (keep > 0 && have[keep - 1].start >= firstStart) keep--;
  const merged = have.slice(0, keep).concat(updates);
  return merged.length > MAX_CANDLES ? merged.slice(merged.length - MAX_CANDLES) : merged;
}
