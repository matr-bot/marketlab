import type { AgentContext, AgentOrder, AgentSpec } from "./agents/agent";
import { ArrivalScheduler, type Arrival } from "./arrivals";
import { MarketRegistry } from "./marketRegistry";
import type { MatchingEngine, OrderInput, SubmitResult } from "./matchingEngine";
import { Rng } from "./rng";
import { SimClock, type TickWindow } from "./simClock";
import type { CancelResult, Cents, OrderId } from "./types";

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

export class Simulation {
  readonly rng: Rng;
  readonly clock = new SimClock();
  readonly engine: MatchingEngine;
  readonly startPrice: Cents;
  private readonly scheduler: ArrivalScheduler;
  private readonly agents = new Map<string, { spec: AgentSpec; act: (ctx: AgentContext) => void }>();
  private readonly observer: SimulationObserver;
  private last: Cents | null = null;

  constructor(config: SimulationConfig) {
    this.rng = Rng.fromSeed(config.seed);
    this.engine = new MarketRegistry().create(config.ticker ?? "SPY", config.tickSize ?? 1);
    this.startPrice = config.startPrice ?? DEFAULT_START_PRICE;
    if (!Number.isSafeInteger(this.startPrice) || this.startPrice <= 0 || this.startPrice % this.engine.book.tickSize !== 0) {
      throw new RangeError(`startPrice must be a positive whole number of ticks in cents, got ${this.startPrice}`);
    }
    this.observer = config.observer ?? {};
    this.scheduler = new ArrivalScheduler(this.rng); // streams "arrivals/<id>"
    const decisions = this.rng.stream("decisions");
    for (const spec of config.agents) {
      if (this.agents.has(spec.id)) throw new Error(`Duplicate agent id: ${spec.id}`);
      const agent = spec.create(decisions.stream(spec.id));
      this.agents.set(spec.id, { spec, act: (ctx) => agent.act(ctx) });
      this.scheduler.addSource(spec.id, spec.ratePerSec);
    }
  }

  /** Price of the most recent trade, or null before the first trade. */
  get lastTradePrice(): Cents | null {
    return this.last;
  }

  /** Advance one tick (100 ms): every arrival in the window acts, in exact time order. */
  step(): TickWindow {
    const window = this.clock.advance();
    for (const arrival of this.scheduler.drain(window.end)) {
      this.observer.onArrival?.(arrival);
      const agent = this.agents.get(arrival.sourceId)!;
      agent.act(this.context(agent.spec, arrival.timeMs));
    }
    this.observer.onTickEnd?.(window);
    return window;
  }

  /** Advance `ticks` ticks. */
  run(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`ticks must be a non-negative integer, got ${ticks}`);
    for (let i = 0; i < ticks; i++) this.step();
  }

  private context(spec: AgentSpec, time: number): AgentContext {
    const engine = this.engine;
    const lastTrade = () => this.last;
    return {
      time,
      book: engine.book,
      startPrice: this.startPrice,
      get lastTradePrice() {
        return lastTrade();
      },
      myOrders: () => engine.book.ordersOf(spec.id),
      submit: (order: AgentOrder) => {
        const input: OrderInput = { ...order, ownerId: spec.id, agentType: spec.agentType };
        const result = engine.submit(input, time);
        if (result.ok && result.fills.length > 0) this.last = result.fills[result.fills.length - 1].price;
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
