import type { Candle, Frame, FrameExecution, FrameHeadline, FrameTrade } from "@/engine/feed";
import type { ChatMessage } from "@/engine/narrator";
import type { Scenario, ScenarioTarget } from "@/engine/scenarios";
import type { Desk, UserEvent } from "@/engine/simulation";
import type { AgentType } from "@/engine/types";

// What the panels show, folded from the worker's frames. Pure: (state, frame) → new state, so the
// page holds no market logic of its own and every number on screen comes from a frame.

/** Candles kept for the chart: one sim-hour of 10-second candles. */
export const MAX_CANDLES = 360;
/** Trades kept for TAPE, newest first. */
export const MAX_TAPE = 100;
/** Headlines kept for GP markers and the narrator. */
export const MAX_HEADLINES = 50;
/** Desk-chat messages kept for the CHAT panel. */
export const MAX_CHAT = 50;
/** Outcomes of the student's orders kept for the ticket's message line. */
export const MAX_USER_EVENTS = 50;

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
  /** The last MAX_CHAT desk-chat messages, oldest first. */
  readonly chat: readonly ChatMessage[];
  /** Sim ms of the first frame: when the scenario opened (the market is warmed up and trading by then). */
  readonly startTime: number;
  /** The student's position, cash, P&L and open orders as of the latest frame. */
  readonly desk: Desk;
  /** The latest execution report (kept until a newer one arrives); null before the student has traded. */
  readonly exr: FrameExecution | null;
  /** The last MAX_USER_EVENTS outcomes of the student's commands, oldest first. */
  readonly userEvents: readonly UserEvent[];
}

export function applyFrame(prev: MarketState | null, frame: Frame): MarketState {
  return {
    frame,
    candles: mergeCandles(prev?.candles ?? [], frame.candles),
    tape: frame.trades.length === 0 && prev ? prev.tape : [...frame.trades].reverse().concat(prev?.tape ?? []).slice(0, MAX_TAPE),
    frameCount: (prev?.frameCount ?? 0) + 1,
    headlines: mergeHeadlines(prev?.headlines ?? [], frame),
    chat: frame.chat.length === 0 && prev ? prev.chat : [...(prev?.chat ?? []), ...frame.chat].slice(-MAX_CHAT),
    startTime: prev?.startTime ?? frame.time,
    desk: frame.desk,
    exr: frame.exr ?? prev?.exr ?? null,
    userEvents: mergeUserEvents(prev?.userEvents ?? [], frame.userEvents),
  };
}

function mergeUserEvents(have: readonly UserEvent[], fresh: readonly UserEvent[]): readonly UserEvent[] {
  if (fresh.length === 0) return have;
  const merged = [...have, ...fresh];
  return merged.length > MAX_USER_EVENTS ? merged.slice(merged.length - MAX_USER_EVENTS) : merged;
}

/** How a scenario is going, from what the page already holds: price since the open, and progress on its target. */
export interface ScenarioProgress {
  /** Sim seconds since the scenario opened. */
  readonly elapsedSec: number;
  /** The last trade before the scenario opened (cents), or null if the chart has no candle from before. */
  readonly open: number | null;
  readonly last: number | null;
  /** (last − open) ÷ open as a display ratio, or null. */
  readonly changePct: number | null;
  /** Lowest and highest trade price since the scenario opened (cents), or null before any trade. */
  readonly low: number | null;
  readonly high: number | null;
  /** Progress toward the scenario's target, or null if it has none. */
  readonly target: { readonly side: ScenarioTarget["side"]; readonly qty: number; readonly filled: number; readonly remaining: number; readonly slippageBps: number | null } | null;
}

export function scenarioProgress(state: MarketState, scenario: Scenario): ScenarioProgress {
  const { frame, candles, startTime } = state;
  const before = candles.filter((c) => c.start < startTime);
  const since = candles.filter((c) => c.start >= startTime);
  const open = before.length > 0 ? before[before.length - 1].close : null;
  const last = frame.last;
  const target = scenario.target;
  // A buy target counts shares held long; a sell target counts shares held short.
  const filled = target === undefined ? 0 : Math.min(target.qty, Math.max(0, target.side === "buy" ? state.desk.position : -state.desk.position));
  return {
    elapsedSec: Math.max(0, Math.floor((frame.time - startTime) / 1000)),
    open,
    last,
    changePct: open !== null && last !== null ? (last - open) / open : null,
    low: since.length > 0 ? Math.min(...since.map((c) => c.low)) : null,
    high: since.length > 0 ? Math.max(...since.map((c) => c.high)) : null,
    target: target === undefined ? null : { side: target.side, qty: target.qty, filled, remaining: target.qty - filled, slippageBps: state.exr?.totals.slippageBps ?? null },
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
