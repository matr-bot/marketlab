import type { AgentContext, AgentOrder, AgentSpec } from "./agents/agent";
import { ArrivalScheduler, type Arrival } from "./arrivals";
import { MarketRegistry } from "./marketRegistry";
import type { MatchingEngine, OrderInput, SubmitResult } from "./matchingEngine";
import { Rng } from "./rng";
import { SimClock, type TickWindow } from "./simClock";
import type { AgentType, CancelResult, Cents, OrderId, RejectReason, Side } from "./types";
import { DEFAULT_VOLATILITY_PARAMS, VolatilityEstimator, type VolatilityParams } from "./volatility";
import { clampShock, DEFAULT_FUNDAMENTAL_PARAMS, Fundamental, MidHistory, type FundamentalParams, type ShockParams } from "./fundamental";

// The simulation loop (D-023). Each tick: advance the clock 100 ms, take every agent arrival in
// that window in exact time order, and let each agent act at its arrival's timestamp. Orders
// execute immediately, so the next agent sees the market the previous one left. Deterministic:
// same seed + same config → identical fills (fingerprint-tested).
//
// Random streams (D-018, D-023): each agent's arrival times come from "arrivals/<id>" and its
// decisions from "decisions/<id>", so changing how an agent decides never moves anyone's
// arrival times, and changing one agent never shifts another agent's numbers.

export interface SimulationConfig {
  readonly seed: number;
  readonly ticker?: string;
  readonly tickSize?: Cents;
  /** Opening reference price in cents (default 18,700 = $187.00). */
  readonly startPrice?: Cents;
  readonly agents: readonly AgentSpec[];
  /** Realized-volatility settings (default: 5 s sampling, 30 s and 120 s half-lives). */
  readonly volatility?: VolatilityParams;
  /** Fair-value settings (default: a slow random walk, D-043). */
  readonly fundamental?: FundamentalParams;
  /** Optional hooks for reports and tests; they observe only and cannot change anything. */
  readonly observer?: SimulationObserver;
}

export interface SimulationObserver {
  onArrival?(arrival: Arrival): void;
  onSubmit?(agentId: string, order: OrderInput, result: SubmitResult, time: number): void;
  onCancel?(agentId: string, orderId: OrderId, result: CancelResult, time: number): void;
  onTickEnd?(window: TickWindow): void;
}

export const DEFAULT_START_PRICE: Cents = 18_700;

/** At most one headline per this much sim time (D-051): the market digests one before the next. */
export const SHOCK_SPACING_MS = 3_000;
/** Headlines (and their P&L records) kept; older ones are dropped. */
export const SHOCK_HISTORY = 50;

/** The student's trader: orders from the page enter the market as this owner (agent type "user"). */
export const USER_ID = "user";
/** Largest single order a student can send, in shares. */
export const MAX_USER_ORDER_QTY = 100_000;
/** Largest position, long or short, a student can build, in shares. */
export const MAX_USER_POSITION = 500_000;
/** Commands waiting for the next tick; more than this are refused so a burst can never pile up work (D-051). */
export const MAX_PENDING_USER_COMMANDS = 20;
/** Outcomes kept for the page; older ones are dropped. */
export const USER_EVENT_HISTORY = 100;
/** Scheduled (scenario) headlines allowed at once. */
export const MAX_SCHEDULED_SHOCKS = 100;

/** An order as the student sends it. Prices are integer cents; a market order has no price. */
export type UserOrder =
  | { readonly type: "market"; readonly side: Side; readonly qty: number }
  | { readonly type: "limit"; readonly side: Side; readonly qty: number; readonly price: Cents };

export type UserRejectReason = RejectReason | "QUEUE_FULL" | "POSITION_LIMIT" | "ORDER_TOO_LARGE";

/** Queued for the start of the next tick (`ref` ties it to its later `UserEvent`), or refused with nothing queued. */
export type UserQueueResult = { readonly ok: true; readonly ref: number } | { readonly ok: false; readonly reason: UserRejectReason; readonly message: string };

/** What happened to one command once the tick ran it. Sent to the page exactly once. */
export interface UserEvent {
  /** 0, 1, 2, … in the order run; never reused. */
  readonly seq: number;
  /** The ref returned when the command was queued. */
  readonly ref: number;
  /** Sim ms: the start of the tick it ran in. */
  readonly time: number;
  readonly kind: "order" | "cancel";
  readonly side: Side | null;
  readonly orderType: "market" | "limit" | null;
  /** Shares asked for (orders), or open orders cancelled (cancel). */
  readonly requestedQty: number;
  readonly limitPrice: Cents | null;
  readonly status: "filled" | "partial" | "resting" | "cancelled" | "rejected";
  readonly filledQty: number;
  /** Average fill price in cents (an exact ratio), or null if nothing filled. */
  readonly avgPrice: number | null;
  /** Shares left resting in the book. */
  readonly restingQty: number;
  /** Shares cancelled instead of traded (a market order that ran out of liquidity). */
  readonly cancelledQty: number;
  readonly reason: UserRejectReason | null;
  readonly message: string;
}

/** The student's desk: what they hold and what is open. */
export interface Desk {
  /** Shares: + long, − short. */
  readonly position: number;
  /** Cash change in cents from every fill (− for buying, + for selling). */
  readonly cash: number;
  /** The price positions are marked to: the mid (may be a half cent), else the last trade. */
  readonly mark: number;
  /** cash + position × mark, rounded once to whole cents. Gains and losses since the open of the run. */
  readonly pnl: number;
  readonly openOrders: readonly { readonly id: OrderId; readonly side: Side; readonly price: Cents; readonly qty: number }[];
}

type UserCommand = { readonly kind: "order"; readonly ref: number; readonly order: UserOrder } | { readonly kind: "cancel"; readonly ref: number };

/** Accepted, or refused because the last headline was too recent (returned as data, never thrown). */
export type ShockResult = { readonly ok: true } | { readonly ok: false; readonly reason: "SHOCK_TOO_SOON"; readonly message: string };

/** A headline applied to the market: when, what it was called, and the (clamped) shock it caused. */
export interface ShockEvent {
  /** 0, 1, 2, … in the order applied; never reused, so a reader can tell new headlines from old. */
  readonly seq: number;
  /** Sim ms: the start of the tick it was applied in. */
  readonly time: number;
  readonly label: string;
  /** The headline text, when it differs from the label (a scenario or custom shock). */
  readonly headline?: string;
  readonly shock: ShockParams;
  /** Fair value just before and just after the jump, in cents. */
  readonly fairValueBefore: number;
  readonly fairValueAfter: number;
}

/** How long after a headline its P&L impact is measured (D-047). */
export const IMPACT_HORIZON_MS = 60_000;

/**
 * Who made and lost money in the first minute after a headline: for each agent type, the change in
 * (cash + position × mid) from the shock to 60 s later, in whole cents (rounded once, at the end).
 * `pnlByType` is null until the minute has passed. Market makers losing here is adverse selection:
 * they trade with value traders who know the news (D-047).
 */
export interface ShockImpact {
  /** The headline's `seq`. */
  readonly seq: number;
  readonly time: number;
  readonly label: string;
  readonly pnlByType: Readonly<Partial<Record<AgentType, number>>> | null;
}

interface ImpactRecord {
  readonly seq: number;
  readonly time: number;
  readonly label: string;
  readonly start: Map<AgentType, number>;
  pnlByType: Partial<Record<AgentType, number>> | null;
}

export class Simulation {
  readonly rng: Rng;
  readonly clock = new SimClock();
  readonly engine: MatchingEngine;
  readonly startPrice: Cents;
  private readonly scheduler: ArrivalScheduler;
  private readonly agents = new Map<string, { spec: AgentSpec; act: (ctx: AgentContext) => void }>();
  private readonly observer: SimulationObserver;
  private last: Cents | null = null;
  readonly volatility: VolatilityEstimator;
  /** Fair value (random stream "fundamental") and the active shock's panic sensitivity. */
  readonly fundamental: Fundamental;
  /** The mid once per second, for drawdown windows. */
  readonly midHistory = new MidHistory();
  private pendingShock: { shock: ShockParams; label: string; headline?: string } | null = null;
  /** Scenario headlines due at fixed sim times, soonest first (ties keep the order they were added). */
  private readonly scheduled: { at: number; shock: ShockParams; label: string; headline?: string }[] = [];
  /** The student's commands waiting for the next tick, in the order they were sent. */
  private userQueue: UserCommand[] = [];
  private userRef = 0;
  private userEventSeq = 0;
  private readonly userEventLog: UserEvent[] = [];
  private lastShockTime: number | null = null;
  private shockSeq = 0;
  /** The last SHOCK_HISTORY headlines and their P&L records (open or finalized). */
  private readonly shockLog: ShockEvent[] = [];
  private readonly impacts: ImpactRecord[] = [];
  /** Only records still inside their 60 s window are scanned each tick (at most 20, given the spacing). */
  private openImpacts: ImpactRecord[] = [];
  /** Shares and cash (cents) per agent, from fills. */
  private readonly positions = new Map<string, number>();
  private readonly cash = new Map<string, number>();

  constructor(config: SimulationConfig) {
    this.rng = Rng.fromSeed(config.seed);
    this.engine = new MarketRegistry().create(config.ticker ?? "MLAB", config.tickSize ?? 1);
    this.startPrice = config.startPrice ?? DEFAULT_START_PRICE;
    if (!Number.isSafeInteger(this.startPrice) || this.startPrice <= 0 || this.startPrice % this.engine.book.tickSize !== 0) {
      throw new RangeError(`startPrice must be a positive whole number of ticks in cents, got ${this.startPrice}`);
    }
    this.observer = config.observer ?? {};
    this.volatility = new VolatilityEstimator(config.volatility ?? DEFAULT_VOLATILITY_PARAMS);
    this.fundamental = new Fundamental(this.rng.stream("fundamental"), this.startPrice, config.fundamental ?? DEFAULT_FUNDAMENTAL_PARAMS);
    this.scheduler = new ArrivalScheduler(this.rng); // streams "arrivals/<id>"
    const decisions = this.rng.stream("decisions");
    for (const spec of config.agents) {
      if (this.agents.has(spec.id)) throw new Error(`Duplicate agent id: ${spec.id}`);
      const agent = spec.create(decisions.stream(spec.id));
      this.agents.set(spec.id, { spec, act: (ctx) => agent.act(ctx) });
      this.scheduler.addSource(spec.id, spec.ratePerSec);
    }
  }

  /** How many agents trade in this market. */
  get agentCount(): number {
    return this.agents.size;
  }

  /** How many agents of one type trade in this market. */
  agentCountOfType(type: AgentType): number {
    let n = 0;
    for (const { spec } of this.agents.values()) if (spec.agentType === type) n++;
    return n;
  }

  /** Price of the most recent trade, or null before the first trade. */
  get lastTradePrice(): Cents | null {
    return this.last;
  }

  /** Shares held by an agent (+ long, − short); 0 if it never traded. */
  positionOf(agentId: string): number {
    return this.positions.get(agentId) ?? 0;
  }

  /** Cash change of an agent in cents (− for buying, + for selling); 0 if it never traded. */
  cashOf(agentId: string): number {
    return this.cash.get(agentId) ?? 0;
  }

  /**
   * Queue a headline. It is applied at the start of the next tick, before any agent acts, so the
   * same seed + the same shocks at the same ticks always give the same market (D-043). Refused,
   * with nothing queued, if one is already waiting or the last was under SHOCK_SPACING_MS of sim
   * time ago (D-051), so a burst of commands can never pile up work.
   */
  applyShock(shock: ShockParams, label: string, headline?: string): ShockResult {
    const at = this.clock.now; // the next tick starts here
    if (this.pendingShock !== null || (this.lastShockTime !== null && at < this.lastShockTime + SHOCK_SPACING_MS)) {
      const waitMs = this.pendingShock !== null ? SHOCK_SPACING_MS : this.lastShockTime! + SHOCK_SPACING_MS - at;
      return { ok: false, reason: "SHOCK_TOO_SOON", message: `The market is still digesting the last headline. Try again in ${Math.ceil(waitMs / 1000)} s.` };
    }
    this.pendingShock = headline === undefined ? { shock, label } : { shock, label, headline };
    return { ok: true };
  }

  /**
   * Put a headline on the calendar: it is applied at the start of the first tick at or after `atMs`
   * (sim ms), before any agent acts, so a scenario replays identically for the same seed. Scenario
   * headlines are not rate-limited: the author chose their spacing. Throws on misuse (a bug in our
   * code), never on market flow.
   */
  scheduleShock(atMs: number, shock: ShockParams, label: string, headline?: string): void {
    if (!Number.isSafeInteger(atMs) || atMs < 0) throw new RangeError(`atMs must be a non-negative integer, got ${atMs}`);
    if (this.scheduled.length >= MAX_SCHEDULED_SHOCKS) throw new RangeError(`at most ${MAX_SCHEDULED_SHOCKS} scheduled headlines`);
    clampShock(shock); // a non-finite number must fail now, not in the middle of a tick
    const entry = headline === undefined ? { at: atMs, shock, label } : { at: atMs, shock, label, headline };
    let i = this.scheduled.length;
    while (i > 0 && this.scheduled[i - 1].at > atMs) i--;
    this.scheduled.splice(i, 0, entry);
  }

  /** Every headline applied so far, oldest first. */
  get shocks(): readonly ShockEvent[] {
    return this.shockLog;
  }

  /** Each headline's first-minute P&L by agent type (null until the minute has passed), oldest first. */
  get shockImpacts(): readonly ShockImpact[] {
    return this.impacts.map(({ seq, time, label, pnlByType }) => ({ seq, time, label, pnlByType }));
  }

  /** The mid, or the last trade, or the opening price: what positions are marked to. */
  markPrice(): number {
    const bid = this.engine.book.bestBid();
    const ask = this.engine.book.bestAsk();
    return bid !== null && ask !== null ? (bid + ask) / 2 : (this.last ?? this.startPrice);
  }

  /** cash + position × mark price, summed per agent type (cents, unrounded). */
  private valueByType(): Map<AgentType, number> {
    const mark = this.markPrice();
    const out = new Map<AgentType, number>();
    for (const [id, { spec }] of this.agents) out.set(spec.agentType, (out.get(spec.agentType) ?? 0) + this.cashOf(id) + this.positionOf(id) * mark);
    return out;
  }

  /** Advance one tick (100 ms): every arrival in the window acts, in exact time order. */
  step(): TickWindow {
    const window = this.clock.advance();
    while (this.scheduled.length > 0 && this.scheduled[0].at <= window.start) {
      const due = this.scheduled.shift()!;
      this.commitShock(due.shock, due.label, due.headline, window.start);
    }
    if (this.pendingShock !== null) {
      const { shock, label, headline } = this.pendingShock;
      this.pendingShock = null;
      this.commitShock(shock, label, headline, window.start);
    }
    this.runUserCommands(window.start);
    for (const arrival of this.scheduler.drain(window.end)) {
      this.observer.onArrival?.(arrival);
      const agent = this.agents.get(arrival.sourceId)!;
      agent.act(this.context(agent.spec, arrival.timeMs));
    }
    if (this.volatility.isSampleTime(window.end)) {
      const bid = this.engine.book.bestBid();
      const ask = this.engine.book.bestAsk();
      this.volatility.sample(window.end, bid !== null && ask !== null ? bid + ask : null);
    }
    const bid = this.engine.book.bestBid();
    const ask = this.engine.book.bestAsk();
    this.midHistory.onTickEnd(window.end, bid !== null && ask !== null ? bid + ask : null);
    this.fundamental.onTickEnd(window.end);
    // Records open in sequence order and all last 60 s, so the due ones are always at the front.
    while (this.openImpacts.length > 0 && window.end >= this.openImpacts[0].time + IMPACT_HORIZON_MS) {
      const imp = this.openImpacts.shift()!;
      const pnl: Partial<Record<AgentType, number>> = {};
      for (const [type, v] of this.valueByType()) pnl[type] = Math.round(v - (imp.start.get(type) ?? 0));
      imp.pnlByType = Object.freeze(pnl);
    }
    this.observer.onTickEnd?.(window);
    return window;
  }

  /** Apply a headline now (the start of a tick): fair value jumps, the event is logged, its P&L window opens. */
  private commitShock(shock: ShockParams, label: string, headline: string | undefined, time: number): void {
    this.lastShockTime = time;
    const seq = this.shockSeq++;
    const before = this.fundamental.value;
    const applied = this.fundamental.shock(shock, time);
    const event: ShockEvent = { seq, time, label, ...(headline === undefined ? {} : { headline }), shock: applied, fairValueBefore: before, fairValueAfter: this.fundamental.value };
    this.shockLog.push(Object.freeze(event));
    const record: ImpactRecord = { seq, time, label, start: this.valueByType(), pnlByType: null };
    this.impacts.push(record);
    this.openImpacts.push(record);
    if (this.shockLog.length > SHOCK_HISTORY) this.shockLog.shift();
    if (this.impacts.length > SHOCK_HISTORY) this.impacts.shift();
  }

  /**
   * Queue the student's order for the start of the next tick, before any agent acts. Like headlines,
   * this keeps the market deterministic: the same seed + the same commands at the same ticks always
   * give the same market, so a "what if?" rerun differs only by what the student changed. The
   * outcome (fills, resting, rejection) arrives later as a `UserEvent`.
   */
  submitUserOrder(order: UserOrder): UserQueueResult {
    if (!Number.isSafeInteger(order.qty) || order.qty <= 0) return { ok: false, reason: "INVALID_QTY", message: `Quantity must be a whole number of shares, at least 1 (got ${order.qty}).` };
    if (order.qty > MAX_USER_ORDER_QTY) return { ok: false, reason: "ORDER_TOO_LARGE", message: `One order can be at most ${MAX_USER_ORDER_QTY.toLocaleString("en-US")} shares.` };
    if (this.userQueue.length >= MAX_PENDING_USER_COMMANDS) return { ok: false, reason: "QUEUE_FULL", message: "Too many orders waiting for the next tick. Try again in a moment." };
    const ref = this.userRef++;
    this.userQueue.push({ kind: "order", ref, order });
    return { ok: true, ref };
  }

  /** Queue "cancel all my open orders" for the start of the next tick. */
  cancelUserOrders(): UserQueueResult {
    if (this.userQueue.length >= MAX_PENDING_USER_COMMANDS) return { ok: false, reason: "QUEUE_FULL", message: "Too many orders waiting for the next tick. Try again in a moment." };
    const ref = this.userRef++;
    this.userQueue.push({ kind: "cancel", ref });
    return { ok: true, ref };
  }

  /** Outcomes of the student's commands so far (the last USER_EVENT_HISTORY), oldest first. */
  get userEvents(): readonly UserEvent[] {
    return this.userEventLog;
  }

  /** The student's position, cash, P&L marked to the mid, and open orders. */
  get desk(): Desk {
    const mark = this.markPrice();
    const position = this.positionOf(USER_ID);
    const cash = this.cashOf(USER_ID);
    return {
      position,
      cash,
      mark,
      pnl: Math.round(cash + position * mark),
      openOrders: this.engine.book.ordersOf(USER_ID).map((o) => ({ id: o.id, side: o.side, price: o.price, qty: o.qty })),
    };
  }

  private runUserCommands(time: number): void {
    if (this.userQueue.length === 0) return;
    const commands = this.userQueue;
    this.userQueue = [];
    for (const c of commands) {
      if (c.kind === "cancel") {
        const cancelled = this.engine.cancelAll(USER_ID).length;
        this.logUserEvent({
          ref: c.ref, time, kind: "cancel", side: null, orderType: null, requestedQty: cancelled, limitPrice: null, status: "cancelled",
          filledQty: 0, avgPrice: null, restingQty: 0, cancelledQty: cancelled, reason: null,
          message: cancelled === 0 ? "No open orders to cancel." : `Cancelled ${cancelled} open order${cancelled === 1 ? "" : "s"}.`,
        });
        continue;
      }
      this.runUserOrder(c.ref, c.order, time);
    }
  }

  private runUserOrder(ref: number, order: UserOrder, time: number): void {
    const base = { ref, time, kind: "order" as const, side: order.side, orderType: order.type, requestedQty: order.qty, limitPrice: order.type === "limit" ? order.price : null };
    const position = this.positionOf(USER_ID);
    const after = position + (order.side === "buy" ? order.qty : -order.qty);
    if (Math.abs(after) > MAX_USER_POSITION && Math.abs(after) > Math.abs(position)) {
      this.logUserEvent({ ...base, status: "rejected", filledQty: 0, avgPrice: null, restingQty: 0, cancelledQty: 0, reason: "POSITION_LIMIT", message: `That would take your position past ${MAX_USER_POSITION.toLocaleString("en-US")} shares.` });
      return;
    }
    const result = this.place(USER_ID, "user", order, time);
    if (!result.ok) {
      this.logUserEvent({ ...base, status: "rejected", filledQty: 0, avgPrice: null, restingQty: 0, cancelledQty: 0, reason: result.reason, message: result.message });
      return;
    }
    const filledQty = result.fills.reduce((n, f) => n + f.qty, 0);
    const notional = result.fills.reduce((n, f) => n + f.price * f.qty, 0);
    const restingQty = result.resting?.qty ?? 0;
    const status = filledQty === order.qty ? "filled" : restingQty > 0 ? (filledQty > 0 ? "partial" : "resting") : filledQty > 0 ? "partial" : "cancelled";
    this.logUserEvent({
      ...base, status, filledQty, avgPrice: filledQty > 0 ? notional / filledQty : null, restingQty, cancelledQty: result.cancelledQty, reason: null,
      message: status === "cancelled" ? "Nothing to trade against: the order was cancelled." : "",
    });
  }

  private logUserEvent(e: Omit<UserEvent, "seq">): void {
    this.userEventLog.push(Object.freeze({ seq: this.userEventSeq++, ...e }));
    if (this.userEventLog.length > USER_EVENT_HISTORY) this.userEventLog.shift();
  }

  /** Send an order into the market as `ownerId`: execute it, book the fills for both sides, track the last trade. */
  private place(ownerId: string, agentType: AgentType, order: AgentOrder, time: number): SubmitResult {
    const input: OrderInput = { ...order, ownerId, agentType };
    const result = this.engine.submit(input, time);
    if (result.ok) {
      for (const f of result.fills) {
        this.book(f.buy.ownerId, f.qty, -f.price * f.qty);
        this.book(f.sell.ownerId, -f.qty, f.price * f.qty);
      }
      if (result.fills.length > 0) this.last = result.fills[result.fills.length - 1].price;
    }
    this.observer.onSubmit?.(ownerId, input, result, time);
    return result;
  }

  /** Advance `ticks` ticks. */
  run(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`ticks must be a non-negative integer, got ${ticks}`);
    for (let i = 0; i < ticks; i++) this.step();
  }

  private book(agentId: string, shares: number, cents: number): void {
    this.positions.set(agentId, (this.positions.get(agentId) ?? 0) + shares);
    this.cash.set(agentId, (this.cash.get(agentId) ?? 0) + cents);
  }

  private context(spec: AgentSpec, time: number): AgentContext {
    const engine = this.engine;
    const lastTrade = () => this.last;
    const position = () => this.positionOf(spec.id);
    const fundamental = this.fundamental;
    const history = this.midHistory;
    return {
      time,
      book: engine.book,
      startPrice: this.startPrice,
      volatility: this.volatility.view,
      get fairValue() {
        return fundamental.value;
      },
      panicSensitivity: fundamental.sensitivityAt(time),
      liquidityMultiplier: fundamental.liquidityAt(time),
      maxMidSince: (sinceMs: number) => history.maxSince(sinceMs),
      get lastTradePrice() {
        return lastTrade();
      },
      get position() {
        return position();
      },
      myOrders: () => engine.book.ordersOf(spec.id),
      submit: (order: AgentOrder) => this.place(spec.id, spec.agentType, order, time),
      cancel: (orderId: OrderId) => {
        const owned = engine.book.get(orderId)?.ownerId === spec.id;
        const result: CancelResult = owned
          ? engine.cancel(orderId)
          : { ok: false, reason: "UNKNOWN_ORDER", message: `Unknown order id: ${orderId}` };
        this.observer.onCancel?.(spec.id, orderId, result, time);
        return result;
      },
    };
  }
}
