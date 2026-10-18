import type { AgentContext, AgentOrder, AgentSpec } from "./agents/agent";
import { ArrivalScheduler, type Arrival } from "./arrivals";
import { MarketRegistry } from "./marketRegistry";
import type { MatchingEngine, OrderInput, SubmitResult } from "./matchingEngine";
import { Rng } from "./rng";
import { SimClock, type TickWindow } from "./simClock";
import type { CancelResult, Cents, OrderId } from "./types";
import { DEFAULT_VOLATILITY_PARAMS, VolatilityEstimator, type VolatilityParams } from "./volatility";
import { DEFAULT_FUNDAMENTAL_PARAMS, Fundamental, MidHistory, type FundamentalParams, type ShockParams } from "./fundamental";

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

/** A headline applied to the market: when, what it was called, and the (clamped) shock it caused. */
export interface ShockEvent {
  /** Sim ms: the start of the tick it was applied in. */
  readonly time: number;
  readonly label: string;
  readonly shock: ShockParams;
  /** Fair value just before and just after the jump, in cents. */
  readonly fairValueBefore: number;
  readonly fairValueAfter: number;
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
  private readonly pendingShocks: Array<{ shock: ShockParams; label: string }> = [];
  private readonly shockLog: ShockEvent[] = [];
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
   * same seed + the same shocks at the same ticks always give the same market (D-043).
   */
  applyShock(shock: ShockParams, label: string): void {
    this.pendingShocks.push({ shock, label });
  }

  /** Every headline applied so far, oldest first. */
  get shocks(): readonly ShockEvent[] {
    return this.shockLog;
  }

  /** Advance one tick (100 ms): every arrival in the window acts, in exact time order. */
  step(): TickWindow {
    const window = this.clock.advance();
    for (const { shock, label } of this.pendingShocks.splice(0)) {
      const before = this.fundamental.value;
      const applied = this.fundamental.shock(shock, window.start);
      this.shockLog.push(Object.freeze({ time: window.start, label, shock: applied, fairValueBefore: before, fairValueAfter: this.fundamental.value }));
    }
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
    this.observer.onTickEnd?.(window);
    return window;
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
      maxMidSince: (sinceMs: number) => history.maxSince(sinceMs),
      get lastTradePrice() {
        return lastTrade();
      },
      get position() {
        return position();
      },
      myOrders: () => engine.book.ordersOf(spec.id),
      submit: (order: AgentOrder) => {
        const input: OrderInput = { ...order, ownerId: spec.id, agentType: spec.agentType };
        const result = engine.submit(input, time);
        if (result.ok) {
          for (const f of result.fills) {
            this.book(f.buy.ownerId, f.qty, -f.price * f.qty);
            this.book(f.sell.ownerId, -f.qty, f.price * f.qty);
          }
          if (result.fills.length > 0) this.last = result.fills[result.fills.length - 1].price;
        }
        this.observer.onSubmit?.(spec.id, input, result, time);
        return result;
      },
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
