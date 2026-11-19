import { attribute, type Attribution } from "./attribution";
import { buildOrderReports, totalExecution, type ExecutionTotals, type OrderReport } from "./executionReport";
import { clampShock, type ShockParams } from "./fundamental";
import { makeEconomicRelease, releaseLine, releaseOvershoot, type EconomicRelease, type Indicator } from "./economicReleases";
import { maxDrawdownOf, returnsOf, sharpeOf, type DrawdownResult, type SharpeResult } from "./metrics";
import type { Fill } from "./matchingEngine";
import { Narrator, type ChatMessage } from "./narrator";
import { presetByCode } from "./presets";
import type { StrategyDecision, StrategySpec } from "./strategy";
import { USER_ID, type Desk, type Simulation, type UserEvent, type UserOrder, type UserQueueResult } from "./simulation";
import type { AgentType, Cents, DepthLevel, Side } from "./types";

// What the worker sends the page (D-037). The engine may produce many fills per frame; the feed
// coalesces everything since the last frame into ONE plain, structured-cloneable object: quotes,
// top-of-book depth, new trades and the candles they touched. It only reads the simulation, so
// taking frames can never change the market.

/**
 * Direction of a trade vs the previous trade's price; an unchanged price keeps the last direction
 * (zero tick). The session's first trade has no previous trade and counts as "up".
 */
export type TickDirection = "up" | "down";

export interface FrameTrade {
  readonly seq: number;
  /** Sim ms since the open. */
  readonly time: number;
  readonly price: Cents;
  readonly qty: number;
  readonly aggressor: Side;
  readonly tick: TickDirection;
}

/** OHLC and volume of every fill in [start, start + candleMs). An interval with no fills has no candle. */
export interface Candle {
  readonly start: number;
  readonly open: Cents;
  readonly high: Cents;
  readonly low: Cents;
  readonly close: Cents;
  /** Shares traded. */
  readonly volume: number;
}

/** A headline the market has received: when, what and how big. Sent once, in the frame after it lands. */
export interface FrameHeadline {
  /** The headline's sequence number (matches its later `FrameImpact`). */
  readonly seq: number;
  /** Sim ms the shock was applied. */
  readonly time: number;
  readonly code: string;
  readonly headline: string;
  /** The (clamped) fair-value jump, as a fraction: −0.03 = −3%. */
  readonly fairValuePct: number;
  readonly release?: EconomicRelease;
}

/** Executed-price reaction from the last trade before the release, measured over [0, 30 s). */
export interface FrameReleaseReaction {
  readonly seq: number;
  readonly priceBefore: Cents | null;
  readonly priceAfter: Cents | null;
  /** Furthest executed price in the fair-value direction, including the starting price. */
  readonly peakPrice: Cents | null;
  readonly peakPct: number | null;
  /** Last executed price in the first 30 s, versus the pre-release trade. */
  readonly pricePct: number | null;
  /** Peak exceeds the fair-value move in the same direction by more than 0.3 percentage points. */
  readonly overshoot: boolean;
}

/** A headline's first-minute P&L by agent type in cents (D-047). Sent once, when the minute is over. */
export interface FrameImpact {
  readonly seq: number;
  readonly pnlByType: Readonly<Partial<Record<AgentType, number>>>;
}

/** What `applyPreset` did: queued the headline, or refused it (unknown code, or too soon after the last). */
/** `note`: what the engine changed from what was asked (a custom shock clamped to its limits; QA #9). */
export type PresetResult = { readonly ok: true; readonly code: string; readonly headline: string; readonly note?: string } | { readonly ok: false; readonly message: string };

/** What clamping changed, in words: "fair value +999.0% → +20.0%" (QA #9). */
function cappedFields(raw: ShockParams, applied: ShockParams): string[] {
  const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const out: string[] = [];
  if (raw.fairValuePct !== applied.fairValuePct) out.push(`fair value ${pct(raw.fairValuePct)} → ${pct(applied.fairValuePct)}`);
  if (raw.panicSensitivity !== applied.panicSensitivity) out.push(`panic ${raw.panicSensitivity}× → ${applied.panicSensitivity}×`);
  if (raw.durationSec !== applied.durationSec) out.push(`${raw.durationSec} s → ${applied.durationSec} s`);
  if (raw.volatilityMultiplier !== applied.volatilityMultiplier) out.push(`volatility ${raw.volatilityMultiplier}× → ${applied.volatilityMultiplier}×`);
  if (raw.liquidityMultiplier !== applied.liquidityMultiplier) out.push(`liquidity ${raw.liquidityMultiplier}× → ${applied.liquidityMultiplier}×`);
  return out;
}

/** The student's execution report: the most recent orders and the totals over all of them. Sent only when it changed. */
/** An EXR row: the order's report, and whether the student sent it by hand or their strategy did (D-062). */
export type FrameOrderReport = OrderReport & { readonly source: "manual" | "strategy" };

export interface FrameExecution {
  /** Orders with fills, oldest first; at most `EXR_ORDERS`, the newest ones. */
  readonly orders: readonly FrameOrderReport[];
  readonly totals: ExecutionTotals;
}

/** The student's strategy in a frame (D-062, D-063). */
export interface FrameStrategy {
  /** Sim ms it started: identifies the run (a new strategy starts a new list of decisions). */
  readonly startedAt: number;
  readonly spec: StrategySpec;
  /** running: deciding; closing: stopped but still selling (or buying back) leftover shares; stopped: done. */
  readonly status: "running" | "closing" | "stopped";
  /** Whether a position is open by the rules (an entry decided, no exit yet). */
  readonly inPosition: boolean;
  /** The strategy's own shares and cash (cents), and P&L marked to the mid (whole cents). */
  readonly position: number;
  readonly cash: number;
  readonly pnl: number;
  readonly trades: number;
  /** Decisions made since the last frame (each sent exactly once per run). */
  readonly newDecisions: readonly StrategyDecision[];
  /** Size × the first mid seen, in cents; null before the first second. */
  readonly capital: number | null;
  /** Annualized Sharpe of one-second returns, with its parts; null with < 2 returns or no variation. */
  readonly sharpe: SharpeResult | null;
  readonly drawdown: DrawdownResult | null;
  /** Equity points behind the metrics (returns = points − 1). */
  readonly points: number;
}

/** Orders kept in `FrameExecution.orders`. */
export const EXR_ORDERS = 30;
/** Book levels per side in each frame unless `FeedOptions.depthLevels` says otherwise. */
export const DEFAULT_DEPTH_LEVELS = 40;
/** Fills of the student's kept for the execution report (a student cannot trade this much). */
const MAX_USER_FILLS = 20_000;

export interface Frame {
  readonly seed: number;
  readonly ticker: string;
  /** Sim ms since the open (the end of the last tick). */
  readonly time: number;
  /** The opening reference price; change is measured against it. */
  readonly open: Cents;
  /** Agents trading in this market (every trade comes from one of them). */
  readonly agents: number;
  readonly last: Cents | null;
  /** Shares traded since the open. */
  readonly volume: number;
  readonly bid: Cents | null;
  readonly ask: Cents | null;
  /** Top levels, best first. */
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
  /** New trades since the last frame, oldest first (at most `maxTradesPerFrame`, the newest ones). */
  readonly trades: readonly FrameTrade[];
  /** New trades left out of `trades` by the cap (still counted in volume and candles). */
  readonly droppedTrades: number;
  readonly candleMs: number;
  /** Candles created or changed since the last frame, oldest first. */
  readonly candles: readonly Candle[];
  /** Headlines applied since the last frame (each is sent exactly once; D-051). */
  readonly headlines: readonly FrameHeadline[];
  /** Finalized 30 s release reactions, each sent once. */
  readonly releaseReactions: readonly FrameReleaseReaction[];
  /** First-minute P&L records finalized since the last frame (each sent exactly once). */
  readonly impacts: readonly FrameImpact[];
  /** Desk-chat messages posted since the last frame (each sent exactly once; D-055). */
  readonly chat: readonly ChatMessage[];
  /** Who moved the price over the last 60 s of sim time (D-054). */
  readonly who: Attribution;
  /** The student's position, cash, P&L and open orders right now. */
  readonly desk: Desk;
  /** What happened to the student's commands since the last frame (each sent exactly once). */
  readonly userEvents: readonly UserEvent[];
  /** The execution report, or null if no fill of the student's arrived since the last frame. */
  readonly exr: FrameExecution | null;
  /** The student's strategy, or null if none was ever started. */
  readonly strategy: FrameStrategy | null;
}

/** WHO looks back this far by default; windows are answered from the last WHO_BUFFER_MS. */
export const WHO_WINDOW_MS = 60_000;
export const WHO_BUFFER_MS = 600_000;

export interface FeedOptions {
  /** Candle length in sim ms (default 10 s, D-038). */
  readonly candleMs?: number;
  /** Book levels per side in each frame (default 40: enough to fill a tall BOOK panel). */
  readonly depthLevels?: number;
  /** Most trades sent in one frame (default 500); the rest are counted in `droppedTrades`. */
  readonly maxTradesPerFrame?: number;
}

interface MutableCandle {
  start: number;
  open: Cents;
  high: Cents;
  low: Cents;
  close: Cents;
  volume: number;
}

export class MarketFeed {
  readonly candleMs: number;
  private readonly depthLevels: number;
  private readonly maxTrades: number;
  /** Next fill seq to ingest. */
  private seen = 0;
  private volume = 0;
  private lastPrice: Cents | null = null;
  private lastTick: TickDirection = "up";
  private readonly candles: MutableCandle[] = [];
  /** Index into `candles` of the oldest candle changed since the last frame, or null. */
  private dirtyFrom: number | null = null;
  private pending: FrameTrade[] = [];
  private readonly narrator: Narrator;
  /** Fills of the last WHO_BUFFER_MS, oldest first. */
  private whoFills: Fill[] = [];
  /** Next headline / impact seq to send. */
  private nextHeadline = 0;
  private readonly sentReactions = new Set<number>();
  private nextImpact = 0;
  private nextUserEvent = 0;
  private dropped = 0;
  /** Every fill the student was in, for the execution report. */
  private userFills: Fill[] = [];
  private exrDirty = false;
  /** Which strategy run the decision cursor and cached metrics belong to (its start time). */
  private strategyRun = -1;
  private nextDecision = 0;
  private metricsAt = -1;
  private metrics: { sharpe: SharpeResult | null; drawdown: DrawdownResult | null } = { sharpe: null, drawdown: null };

  constructor(
    readonly sim: Simulation,
    readonly seed: number,
    options: FeedOptions = {},
  ) {
    this.narrator = new Narrator(sim);
    this.candleMs = options.candleMs ?? 10_000;
    this.depthLevels = options.depthLevels ?? DEFAULT_DEPTH_LEVELS;
    this.maxTrades = options.maxTradesPerFrame ?? 500;
    if (!Number.isSafeInteger(this.candleMs) || this.candleMs <= 0 || this.candleMs % 100 !== 0) {
      throw new RangeError(`candleMs must be a positive multiple of 100, got ${this.candleMs}`);
    }
    if (!Number.isSafeInteger(this.depthLevels) || this.depthLevels < 1) throw new RangeError(`depthLevels must be a positive integer, got ${this.depthLevels}`);
    if (!Number.isSafeInteger(this.maxTrades) || this.maxTrades < 0) throw new RangeError(`maxTradesPerFrame must be a non-negative integer, got ${this.maxTrades}`);
    this.ingest();
  }

  /**
   * Queue the offline preset `code` (FED, CEO, BEAT, DOWNGRADE) for the start of the next tick.
   * Refused, with nothing applied, for an unknown code or under 3 s of sim time after the last
   * headline (D-051).
   */
  applyPreset(code: string): PresetResult {
    const preset = presetByCode(code);
    if (preset === undefined) return { ok: false, message: `Unknown headline code "${code.slice(0, 20)}".` };
    // A preset that is a release (FED is RATES +0.75 vs +0.25) is marked with its indicator, as the desk line names it (D-093).
    const label = preset.release?.indicator ?? preset.code;
    const r = this.sim.applyShock(preset.shock, label, preset.release === undefined ? undefined : preset.headline, preset.release);
    return r.ok ? { ok: true, code: label, headline: preset.headline } : { ok: false, message: r.message };
  }

  /** A hypothetical release uses the same pending slot and 3 s digest rule as FED. */
  applyRelease(indicator: Indicator, actual?: number): PresetResult {
    const release = makeEconomicRelease(indicator, actual);
    const headline = releaseLine(release);
    const r = this.sim.applyShock(release.shock, indicator, headline, release);
    return r.ok ? { ok: true, code: indicator, headline } : { ok: false, message: r.message };
  }

  /**
   * Queue a headline with explicit params (an AI interpretation or an edited one) for the next tick.
   * Same 3 s spacing as presets (D-051); the label is for display, the params are what the market
   * gets and what a replay records (D-052).
   */
  applyParams(shock: ShockParams, label: string): PresetResult {
    const r = this.sim.applyShock(shock, label.slice(0, 120));
    return r.ok ? { ok: true, code: "NEWS", headline: label.slice(0, 120) } : { ok: false, message: r.message };
  }

  /**
   * Queue a headline of the student's own for the start of the next tick: fair value moves by
   * `fairValuePct` (−0.03 = −3%), panic sellers are `panicSensitivity`× as jumpy for `durationSec`.
   * Every field is clamped to the engine's limits, and the reply says what was actually applied.
   * Refused for the same reasons as a preset (too soon after the last headline) or a non-number.
   */
  applyCustomShock(raw: ShockParams): PresetResult {
    let shock: ShockParams;
    try {
      shock = clampShock(raw);
    } catch {
      return { ok: false, message: "A shock needs real numbers: fair-value change, panic sensitivity, duration and the two multipliers." };
    }
    const pct = (shock.fairValuePct * 100).toFixed(1);
    const extra = `${shock.volatilityMultiplier !== 1 ? `, volatility ${shock.volatilityMultiplier}×` : ""}${shock.liquidityMultiplier !== 1 ? `, liquidity ${shock.liquidityMultiplier}×` : ""}`;
    const headline = `Custom shock: fair value ${shock.fairValuePct > 0 ? "+" : ""}${pct}%, panic ${shock.panicSensitivity}×${extra} for ${shock.durationSec} s`;
    const r = this.sim.applyShock(shock, "CUSTOM", headline);
    if (!r.ok) return { ok: false, message: r.message };
    const capped = cappedFields(raw, shock);
    return capped.length === 0 ? { ok: true, code: "CUSTOM", headline } : { ok: true, code: "CUSTOM", headline, note: `capped to the engine's limits: ${capped.join(", ")}` };
  }

  /** Queue the student's order for the start of the next tick; its outcome arrives in a later frame's `userEvents`. */
  submitOrder(order: UserOrder): UserQueueResult {
    return this.sim.submitUserOrder(order);
  }

  /** Queue "cancel all my open orders" for the start of the next tick. */
  cancelOrders(): UserQueueResult {
    return this.sim.cancelUserOrders();
  }

  /** Queue the student's strategy to start at the next tick (D-062). */
  startStrategy(spec: StrategySpec): UserQueueResult {
    return this.sim.startStrategy(spec);
  }

  /** Queue "stop my strategy" (closing its shares) for the next tick. */
  stopStrategy(): UserQueueResult {
    return this.sim.stopStrategy();
  }

  /** What the strategy's rules read and its equity, as recorded: the glass box's Python input (D-065). Null before a strategy has seen a mid. */
  runData(): { start_ms: number; mids: [number, number][]; equity: number[]; capital: number } | null {
    const runner = this.sim.strategy;
    if (runner === null || runner.capital === null) return null;
    return { start_ms: runner.startedAt, mids: runner.mids.map(([t, m]) => [t, m]), equity: [...runner.equity.values], capital: runner.capital };
  }

  /** Run `ticks` ticks of the simulation, with the narrator watching each, and take in their fills. */
  advance(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`ticks must be a non-negative integer, got ${ticks}`);
    for (let i = 0; i < ticks; i++) {
      this.sim.step();
      this.narrator.onTick();
    }
    this.ingest();
  }

  /** Who moved the price in [from, to), from the last WHO_BUFFER_MS of fills (D-054). */
  attribute(from: number, to: number): Attribution {
    return attribute(this.window(from), from, to);
  }

  /** The buffered fills with time ≥ from (binary search: the buffer is in time order). */
  private window(from: number): Fill[] {
    let lo = 0;
    let hi = this.whoFills.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.whoFills[mid].time < from) lo = mid + 1;
      else hi = mid;
    }
    return this.whoFills.slice(lo);
  }

  /** Everything since the last frame, as one object; then starts collecting the next frame. */
  frame(): Frame {
    const book = this.sim.engine.book;
    const frame: Frame = {
      seed: this.seed,
      ticker: this.sim.engine.ticker,
      time: this.sim.clock.now,
      open: this.sim.startPrice,
      agents: this.sim.agentCount,
      last: this.lastPrice,
      volume: this.volume,
      bid: book.bestBid(),
      ask: book.bestAsk(),
      bids: book.depth("buy", this.depthLevels),
      asks: book.depth("sell", this.depthLevels),
      trades: this.pending,
      droppedTrades: this.dropped,
      candleMs: this.candleMs,
      candles: this.dirtyFrom === null ? [] : this.candles.slice(this.dirtyFrom).map((c) => ({ ...c })),
      headlines: this.newHeadlines(),
      releaseReactions: this.newReactions(),
      impacts: this.newImpacts(),
      chat: this.narrator.take(),
      who: this.attribute(this.sim.clock.now - WHO_WINDOW_MS, this.sim.clock.now + 1),
      desk: this.sim.desk,
      userEvents: this.newUserEvents(),
      exr: this.newExecution(),
      strategy: this.strategyFrame(),
    };
    this.pending = [];
    this.dropped = 0;
    this.dirtyFrom = null;
    return frame;
  }

  /** Headlines with seq ≥ the next one to send; at most one per frame in practice (D-051). */
  private newHeadlines(): FrameHeadline[] {
    const out = this.sim.shocks
      .filter((s) => s.seq >= this.nextHeadline)
      .map((s) => ({ seq: s.seq, time: s.time, code: s.label, headline: s.headline ?? presetByCode(s.label)?.headline ?? s.label, fairValuePct: s.shock.fairValuePct, ...(s.release === undefined ? {} : { release: s.release }) }));
    if (out.length > 0) this.nextHeadline = out[out.length - 1].seq + 1;
    return out;
  }

  private newReactions(): FrameReleaseReaction[] {
    const out: FrameReleaseReaction[] = [];
    for (const s of this.sim.shocks) {
      if (s.release === undefined || this.sentReactions.has(s.seq) || this.sim.clock.now < s.time + 30_000) continue;
      const before = s.releaseBasePrice ?? null;
      // Use the full execution log: a frame can arrive long after the 10-minute WHO buffer expires.
      const fills = this.sim.engine.fills.filter((f) => f.time >= s.time && f.time < s.time + 30_000);
      const after = fills.at(-1)?.price ?? null;
      const pricePct = before === null || after === null ? null : Math.round(((after - before) / before) * 10_000) / 100;
      const peakPrice = before === null ? null : fills.reduce((peak, f) => s.shock.fairValuePct < 0 ? Math.min(peak, f.price) : Math.max(peak, f.price), before);
      const rawPeakPct = before === null || peakPrice === null ? null : ((peakPrice - before) / before) * 100;
      const peakPct = rawPeakPct === null ? null : Math.round(rawPeakPct * 100) / 100;
      const overshoot = releaseOvershoot(rawPeakPct, s.shock.fairValuePct);
      out.push({ seq: s.seq, priceBefore: before, priceAfter: after, peakPrice, peakPct, pricePct, overshoot });
      this.sentReactions.add(s.seq);
    }
    return out;
  }

  /** Finalized impacts not sent yet. They finalize in seq order, so a single cursor is enough. */
  private newImpacts(): FrameImpact[] {
    const out: FrameImpact[] = [];
    for (const i of this.sim.shockImpacts) if (i.seq >= this.nextImpact && i.pnlByType !== null) out.push({ seq: i.seq, pnlByType: i.pnlByType });
    if (out.length > 0) this.nextImpact = out[out.length - 1].seq + 1;
    return out;
  }

  /** The student's command outcomes not sent yet. They are logged in seq order, so a single cursor is enough. */
  private newUserEvents(): UserEvent[] {
    const out = this.sim.userEvents.filter((e) => e.seq >= this.nextUserEvent);
    if (out.length > 0) this.nextUserEvent = out[out.length - 1].seq + 1;
    return out;
  }

  /** The execution report if a fill of the student's arrived since the last frame, else null. */
  private newExecution(): FrameExecution | null {
    if (!this.exrDirty) return null;
    this.exrDirty = false;
    const reports = buildOrderReports(this.userFills, USER_ID);
    const recent = reports.slice(-EXR_ORDERS).map((r) => ({ ...r, source: this.sim.isStrategyOrder(r.orderId) ? ("strategy" as const) : ("manual" as const) }));
    return { orders: recent, totals: totalExecution(reports) };
  }

  /** The strategy's state, its decisions not sent yet, and metrics (recomputed only when equity grew). */
  private strategyFrame(): FrameStrategy | null {
    const runner = this.sim.strategy;
    if (runner === null) return null;
    if (runner.startedAt !== this.strategyRun) {
      this.strategyRun = runner.startedAt;
      this.nextDecision = 0;
      this.metricsAt = -1;
    }
    const newDecisions = runner.decisions.filter((d) => d.seq >= this.nextDecision);
    if (newDecisions.length > 0) this.nextDecision = newDecisions[newDecisions.length - 1].seq + 1;
    const { values } = runner.equity;
    if (values.length !== this.metricsAt) {
      this.metricsAt = values.length;
      const capital = runner.capital;
      this.metrics = capital === null ? { sharpe: null, drawdown: null } : { sharpe: sharpeOf(returnsOf(values, capital)), drawdown: maxDrawdownOf(values, capital) };
    }
    return {
      startedAt: runner.startedAt,
      spec: runner.spec,
      status: runner.running ? "running" : runner.isClosing ? "closing" : "stopped",
      inPosition: runner.inPosition,
      position: runner.position,
      cash: runner.cash,
      pnl: Math.round(runner.cash + runner.position * this.sim.markPrice()),
      trades: runner.trades,
      newDecisions,
      capital: runner.capital,
      sharpe: this.metrics.sharpe,
      drawdown: this.metrics.drawdown,
      points: values.length,
    };
  }

  private ingest(): void {
    const fills = this.sim.engine.fillsSince(this.seen);
    for (const f of fills) this.take(f);
    this.seen += fills.length;
    const keepFrom = this.sim.clock.now - WHO_BUFFER_MS;
    if (this.whoFills.length > 0 && this.whoFills[0].time < keepFrom) this.whoFills = this.window(keepFrom);
    // At most `maxTrades` wait for the next frame, the newest ones; older ones are only counted.
    if (this.pending.length > this.maxTrades) {
      const cut = this.pending.length - this.maxTrades;
      this.dropped += cut;
      this.pending = this.pending.slice(cut);
    }
  }

  private take(f: Fill): void {
    if (f.buy.ownerId === USER_ID || f.sell.ownerId === USER_ID) {
      this.userFills.push(f);
      if (this.userFills.length > MAX_USER_FILLS) this.userFills = this.userFills.slice(-MAX_USER_FILLS);
      this.exrDirty = true;
    }
    if (this.lastPrice !== null && f.price !== this.lastPrice) this.lastTick = f.price > this.lastPrice ? "up" : "down";
    this.lastPrice = f.price;
    this.volume += f.qty;
    this.whoFills.push(f);
    this.pending.push({ seq: f.seq, time: f.time, price: f.price, qty: f.qty, aggressor: f.aggressor, tick: this.lastTick });

    const start = f.time - (f.time % this.candleMs);
    const last = this.candles[this.candles.length - 1];
    if (last !== undefined && last.start === start) {
      if (f.price > last.high) last.high = f.price;
      if (f.price < last.low) last.low = f.price;
      last.close = f.price;
      last.volume += f.qty;
    } else {
      this.candles.push({ start, open: f.price, high: f.price, low: f.price, close: f.price, volume: f.qty });
    }
    if (this.dirtyFrom === null) this.dirtyFrom = this.candles.length - 1;
  }
}

/**
 * Turns real elapsed time into a whole number of 100 ms ticks (D-039). The real clock only decides
 * HOW MANY ticks run, never what happens in them: the market is the same for any frame timing.
 * A long gap (a hidden tab) is not caught up: at most `maxTicksPerCall` run and the rest is dropped,
 * so the page never freezes simulating a backlog.
 */
export class TickPacer {
  private carryMs = 0;

  constructor(
    readonly tickMs = 100,
    readonly maxTicksPerCall = 10,
  ) {
    if (!Number.isSafeInteger(tickMs) || tickMs <= 0) throw new RangeError(`tickMs must be a positive integer, got ${tickMs}`);
    if (!Number.isSafeInteger(maxTicksPerCall) || maxTicksPerCall < 1) throw new RangeError(`maxTicksPerCall must be a positive integer, got ${maxTicksPerCall}`);
  }

  /** Ticks due after `elapsedMs` more real ms at `speed`× (1 = real time). */
  ticksFor(elapsedMs: number, speed = 1): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError(`elapsedMs must be a non-negative finite number, got ${elapsedMs}`);
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError(`speed must be a positive finite number, got ${speed}`);
    this.carryMs += elapsedMs * speed;
    const due = Math.floor(this.carryMs / this.tickMs);
    if (due > this.maxTicksPerCall) {
      this.carryMs = 0;
      return this.maxTicksPerCall;
    }
    this.carryMs -= due * this.tickMs;
    return due;
  }
}
