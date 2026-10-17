import type { BookView, SubmitResult } from "../matchingEngine";
import type { Rng } from "../rng";
import type { AgentType, CancelResult, Cents, OrderId, RestingOrder, Side } from "../types";
import type { VolatilityView } from "../volatility";

// The agent interface (D-023). An agent acts only at its own random arrival times (Poisson, from
// the scheduler), never on a fixed rhythm. Each time, it gets a context: what it may see and the
// two things it may do. The simulation fills in the agent's owner id and agent type on every
// order, so an agent cannot act as anyone else.

/** An order as an agent writes it: no id, owner or agent type (the simulation adds those). */
export type AgentOrder =
  | { type: "limit"; side: Side; price: Cents; qty: number }
  | { type: "market"; side: Side; qty: number };

export interface AgentContext {
  /** Sim time of this arrival, in whole ms since the open. */
  readonly time: number;
  /** Read-only view of the market's book. */
  readonly book: BookView;
  /** Price of the most recent trade, or null before the first trade. */
  readonly lastTradePrice: Cents | null;
  /** The opening price, used when there is neither a two-sided book nor a trade yet. */
  readonly startPrice: Cents;
  /** Shares this agent holds: + long, − short (the simulation tracks it from fills). */
  readonly position: number;
  /** Realized volatility of the mid (log return per √second of sim time; D-029 to D-032). */
  readonly volatility: VolatilityView;
  /** This agent's resting orders, oldest first (sorted explicitly by engine sequence; D-026). */
  myOrders(): RestingOrder[];
  submit(order: AgentOrder): SubmitResult;
  /** Cancel one of this agent's own resting orders. Anyone else's order is UNKNOWN_ORDER. */
  cancel(orderId: OrderId): CancelResult;
}

export interface Agent {
  act(ctx: AgentContext): void;
}

/** How the simulation creates an agent. `create` receives the agent's own decision stream. */
export interface AgentSpec {
  /** Unique id; also the owner id on the agent's orders and the name of its random streams. */
  readonly id: string;
  readonly agentType: AgentType;
  /** Average arrivals per second. */
  readonly ratePerSec: number;
  create(decisions: Rng): Agent;
}

/** Oldest first, by the book's sequence number (assigned when an order starts resting). */
export function oldestFirst(orders: readonly RestingOrder[]): RestingOrder[] {
  return [...orders].sort((a, b) => a.seq - b.seq);
}
