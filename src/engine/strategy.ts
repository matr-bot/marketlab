import type { Side } from "./types";

// The student's strategy (CLAUDE.md, UserStrategyAgent; D-062). A strategy is data from a fixed menu
// of rules, never code: one entry rule, any of three exits, a size and a cooldown. The runner is a
// pure state machine. Once per sim second, at the start of the tick, it reads the mid sampled at
// that second (MidHistory, once per second) and the window behind it, and may ask for one market
// order. It never touches the book itself: the simulation sends the order through the same path as
// the student's own orders, so fills carry arrival quotes and show in EXR and on the desk.
//
// Every comparison is written exactly as the glass box's generated Python writes it
// (`ref * (1 - pct)`, same order of operations), so the two make the same decisions bit for bit.

export const ENTRY_RULES = ["buyAfterDrop", "buyAfterRise", "sellAfterRise", "sellAfterDrop"] as const;
export type EntryRule = (typeof ENTRY_RULES)[number];

export interface StrategySpec {
  /** Enter when the mid has moved `pct` (a fraction: 0.03 = 3%) from the window's high (drops) or low (rises). */
  readonly entry: { readonly rule: EntryRule; readonly pct: number; readonly windowSec: number };
  /** Exit when the mid moves this fraction against the position, measured from the entry's mid. */
  readonly stopLossPct: number | null;
  /** Exit when the mid moves this fraction in favor of the position, measured from the entry's mid. */
  readonly takeProfitPct: number | null;
  /** Exit this many sim seconds after the entry. */
  readonly timeExitSec: number | null;
  /** Shares per entry. */
  readonly qty: number;
  /** Sim seconds after an exit before the next entry may happen. */
  readonly cooldownSec: number;
}

/** Inclusive ranges every spec is clamped to. Windows stop at 600 s because MidHistory keeps 600 samples. */
export const STRATEGY_LIMITS = {
  pct: [0.001, 0.2],
  windowSec: [5, 600],
  stopLossPct: [0.001, 0.2],
  takeProfitPct: [0.001, 0.5],
  timeExitSec: [5, 3_600],
  qty: [1, 10_000],
  cooldownSec: [0, 600],
} as const;

/** The exit a spec gets when it names none: every position must end somehow. */
export const DEFAULT_TIME_EXIT_SEC = 300;
/** Decisions kept; older ones are dropped. */
export const MAX_DECISIONS = 200;
/** Equity samples kept (10 sim hours at one a second); older ones are dropped. */
export const MAX_EQUITY_POINTS = 36_000;

const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, x));

/**
 * A spec with every number in range: fractions clamped, seconds and shares rounded to whole numbers,
 * and a time exit added if no exit was given. Throws on an unknown rule or a non-finite number: the
 * route and the UI validate before this, so reaching it with nonsense is a bug in our code.
 */
export function clampStrategy(s: StrategySpec): StrategySpec {
  if (!(ENTRY_RULES as readonly string[]).includes(s.entry.rule)) throw new RangeError(`unknown entry rule ${String(s.entry.rule)}`);
  const nums: [string, number | null][] = [
    ["entry.pct", s.entry.pct],
    ["entry.windowSec", s.entry.windowSec],
    ["stopLossPct", s.stopLossPct],
    ["takeProfitPct", s.takeProfitPct],
    ["timeExitSec", s.timeExitSec],
    ["qty", s.qty],
    ["cooldownSec", s.cooldownSec],
  ];
  for (const [k, v] of nums) if (v !== null && !Number.isFinite(v)) throw new RangeError(`strategy ${k} must be a finite number, got ${v}`);
  const stopLossPct = s.stopLossPct === null ? null : clamp(s.stopLossPct, STRATEGY_LIMITS.stopLossPct);
  const takeProfitPct = s.takeProfitPct === null ? null : clamp(s.takeProfitPct, STRATEGY_LIMITS.takeProfitPct);
  const timeExitSec = s.timeExitSec === null ? null : clamp(Math.round(s.timeExitSec), STRATEGY_LIMITS.timeExitSec);
  return {
    entry: { rule: s.entry.rule, pct: clamp(s.entry.pct, STRATEGY_LIMITS.pct), windowSec: clamp(Math.round(s.entry.windowSec), STRATEGY_LIMITS.windowSec) },
    stopLossPct,
    takeProfitPct,
    timeExitSec: stopLossPct === null && takeProfitPct === null && timeExitSec === null ? DEFAULT_TIME_EXIT_SEC : timeExitSec,
    qty: clamp(Math.round(s.qty), STRATEGY_LIMITS.qty),
    cooldownSec: clamp(Math.round(s.cooldownSec), STRATEGY_LIMITS.cooldownSec),
  };
}

/** The side an entry trades: the two "buy" rules go long, the two "sell" rules go short. */
export function entrySide(rule: EntryRule): Side {
  return rule === "buyAfterDrop" || rule === "buyAfterRise" ? "buy" : "sell";
}

/** Drop rules measure from the window's high; rise rules from its low. */
export function measuresDrop(rule: EntryRule): boolean {
  return rule === "buyAfterDrop" || rule === "sellAfterDrop";
}

export type DecisionReason = "entry" | "stopLoss" | "takeProfit" | "timeExit" | "stopped";

/** One decision, with every number the rule compared, so the glass box can show the formula filled in. */
export interface StrategyDecision {
  /** 0, 1, 2, … in the order made; never reused. */
  readonly seq: number;
  /** Sim ms (a whole second, or the tick a stop arrived in). */
  readonly time: number;
  readonly action: "entry" | "exit";
  readonly reason: DecisionReason;
  /** The side of the order the decision asked for. */
  readonly side: Side;
  /** Shares asked for: the spec's size for an entry, the strategy's own shares for an exit (0 if it held none). */
  readonly qty: number;
  /** The mid the rule read, in cents (may be a half cent); null for a stop with no two-sided book. */
  readonly mid: number | null;
  /** What it was compared against: the window's high or low (entry), or the entry's mid (exits). */
  readonly reference: number | null;
  /** The trigger level the mid crossed (reference × (1 ∓ pct)); null for time exits and stops. */
  readonly level: number | null;
  /** Sim seconds held, for exits; null for entries. */
  readonly heldSec: number | null;
}

/** An order the strategy wants sent now. Always a market order. */
export interface StrategyIntent {
  readonly side: Side;
  readonly qty: number;
}

/** What the runner reads each second: the newest mid and the window behind it (MidHistory). */
export interface MidView {
  latestAt(timeMs: number): number | null;
  maxSince(sinceMs: number): number | null;
  minSince(sinceMs: number): number | null;
}

export class StrategyRunner {
  private open: { side: Side; entryMid: number; entryTime: number } | null = null;
  private cooldownUntil = -1;
  private seq = 0;
  private stopped = false;
  /** After an exit or a stop: shares are still held and are retried at the market once a second until flat. */
  private closing = false;
  private readonly log: StrategyDecision[] = [];
  private readonly eqTimes: number[] = [];
  private readonly eq: number[] = [];
  /** The strategy's own shares (+ long, − short) and cash in cents, from its fills only. */
  position = 0;
  cash = 0;
  /** Completed round trips (exits that closed shares). */
  trades = 0;
  /** size × the first mid it saw, in cents: what returns are measured against (D-063). Null until then. */
  capital: number | null = null;

  constructor(
    readonly spec: StrategySpec,
    /** Sim ms the strategy started (the tick its start command ran in). */
    readonly startedAt: number,
  ) {}

  /** Making decisions: started and not stopped. */
  get running(): boolean {
    return !this.stopped;
  }

  /** Still closing shares left over by an exit or a stop the book could not fully take. */
  get isClosing(): boolean {
    return this.closing;
  }

  /** Nothing more will happen: stopped and flat. */
  get done(): boolean {
    return this.stopped && !this.closing;
  }

  /** Whether a position is open (an entry decided and not yet exited). */
  get inPosition(): boolean {
    return this.open !== null;
  }

  get decisions(): readonly StrategyDecision[] {
    return this.log;
  }

  /** Equity (cash + shares × mid, cents) once per evaluated second, with its sim times. */
  get equity(): { readonly times: readonly number[]; readonly values: readonly number[] } {
    return { times: this.eqTimes, values: this.eq };
  }

  /**
   * Call at the start of every tick. On a whole second: records equity (if there is a mid), retries
   * closing leftover shares, or applies the rules, and may return one market order.
   */
  onTick(time: number, mids: MidView): StrategyIntent | null {
    if (this.done || time % 1_000 !== 0) return null;
    const mid = mids.latestAt(time);
    if (mid !== null) {
      if (this.capital === null) this.capital = this.spec.qty * mid;
      this.recordEquity(time, mid);
    }
    // Execution, not a rule: an exit the book could not fully take is retried, and no entry happens
    // meanwhile. Not a decision, so it is not in the log (the glass box says so).
    if (this.closing) {
      if (this.position !== 0) return this.closeIntent();
      this.closing = false;
    }
    if (this.stopped || mid === null) return null;

    if (this.open !== null) {
      const { side, entryMid, entryTime } = this.open;
      const long = side === "buy";
      const sl = this.spec.stopLossPct;
      const tp = this.spec.takeProfitPct;
      if (sl !== null) {
        const level = long ? entryMid * (1 - sl) : entryMid * (1 + sl);
        if (long ? mid <= level : mid >= level) return this.exit(time, "stopLoss", mid, entryMid, level);
      }
      if (tp !== null) {
        const level = long ? entryMid * (1 + tp) : entryMid * (1 - tp);
        if (long ? mid >= level : mid <= level) return this.exit(time, "takeProfit", mid, entryMid, level);
      }
      const t = this.spec.timeExitSec;
      if (t !== null && time - entryTime >= t * 1_000) return this.exit(time, "timeExit", mid, entryMid, null);
      return null;
    }

    if (time < this.cooldownUntil) return null;
    const { rule, pct, windowSec } = this.spec.entry;
    const since = time - windowSec * 1_000;
    if (measuresDrop(rule)) {
      const high = mids.maxSince(since)!; // includes this second's sample
      const level = high * (1 - pct);
      if (mid <= level) return this.enter(time, mid, high, level);
    } else {
      const low = mids.minSince(since)!;
      const level = low * (1 + pct);
      if (mid >= level) return this.enter(time, mid, low, level);
    }
    return null;
  }

  /** Book one of the strategy's own fills. */
  onFill(side: Side, qty: number, price: number): void {
    this.position += side === "buy" ? qty : -qty;
    this.cash += side === "buy" ? -price * qty : price * qty;
  }

  /** Stop for good. If shares are held, returns the order that closes them. */
  stop(time: number, mid: number | null): StrategyIntent | null {
    if (this.stopped) return null;
    this.stopped = true;
    if (this.open !== null) return this.exit(time, "stopped", mid, this.open.entryMid, null);
    // Flat by the rules but still closing leftovers: keep closing them.
    return this.closing && this.position !== 0 ? this.closeIntent() : null;
  }

  private enter(time: number, mid: number, reference: number, level: number): StrategyIntent {
    const side = entrySide(this.spec.entry.rule);
    this.open = { side, entryMid: mid, entryTime: time };
    this.record({ time, action: "entry", reason: "entry", side, qty: this.spec.qty, mid, reference, level, heldSec: null });
    return { side, qty: this.spec.qty };
  }

  /** Close the open position. A position is open from its entry decision on, even if the entry filled nothing. */
  private exit(time: number, reason: DecisionReason, mid: number | null, entryMid: number, level: number | null): StrategyIntent | null {
    const held = this.open!;
    this.open = null;
    this.cooldownUntil = time + this.spec.cooldownSec * 1_000;
    const qty = Math.abs(this.position);
    const side: Side = held.side === "buy" ? "sell" : "buy";
    this.record({ time, action: "exit", reason, side, qty, mid, reference: entryMid, level, heldSec: Math.floor((time - held.entryTime) / 1_000) });
    if (qty === 0) return null;
    this.trades++;
    this.closing = true; // cleared at the next second once flat
    return this.closeIntent();
  }

  /** A market order for every share the strategy itself holds, whatever the student's manual position is. */
  private closeIntent(): StrategyIntent {
    return { side: this.position > 0 ? "sell" : "buy", qty: Math.abs(this.position) };
  }

  private record(d: Omit<StrategyDecision, "seq">): void {
    this.log.push(Object.freeze({ seq: this.seq++, ...d }));
    if (this.log.length > MAX_DECISIONS) this.log.shift();
  }

  private recordEquity(time: number, mid: number): void {
    this.eqTimes.push(time);
    this.eq.push(this.cash + this.position * mid);
    if (this.eq.length > MAX_EQUITY_POINTS) {
      this.eqTimes.shift();
      this.eq.shift();
    }
  }
}
