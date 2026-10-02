import { AGENT_TYPES, type AgentType, type Cents, type OrderId, type RejectReason, type Rejection, type Side } from "./types";

/** Highest accepted price: $1,000,000.00 per share. */
export const MAX_PRICE_CENTS = 100_000_000;
/** Largest accepted order size in shares. */
export const MAX_ORDER_QTY = 10_000_000;
// Why these limits: price × qty ≤ 1e15 < 2^53, so an order's notional value is always an
// exact integer. A level total would need ~900 million max-size orders to lose precision.

/** The fields every order shares. `price` is only checked when `priced` is set (limit orders). */
export interface OrderFields {
  id: OrderId;
  ownerId: string;
  agentType: AgentType;
  side: Side;
  qty: number;
  price?: Cents;
}

export interface ValidationContext {
  tickSize: Cents;
  /** Orders currently resting in the book (anything with `has(id)`, e.g. a Map or the OrderBook). */
  live: { has(id: OrderId): boolean };
  /** Validate `price` too (limit orders). Market orders have no price. */
  priced: boolean;
}

const AGENT_TYPE_SET: ReadonlySet<string> = new Set(AGENT_TYPES);

/**
 * Shared by the OrderBook and the MatchingEngine so both apply exactly the same rules, in the
 * same order. The order of checks is part of the contract: the first failing check decides the
 * reason code. Returns null when the order is valid.
 */
export function validateOrder(o: OrderFields, ctx: ValidationContext): Rejection | null {
  if (typeof o.id !== "string" || o.id === "") {
    return reject("INVALID_ID", `order id must be a non-empty string, got ${JSON.stringify(o.id)}`);
  }
  if (typeof o.ownerId !== "string" || o.ownerId === "") {
    return reject("INVALID_OWNER", `ownerId must be a non-empty string, got ${JSON.stringify(o.ownerId)}`);
  }
  if (!AGENT_TYPE_SET.has(o.agentType)) {
    return reject("INVALID_AGENT_TYPE", `agentType must be one of ${AGENT_TYPES.join(", ")}, got ${JSON.stringify(o.agentType)}`);
  }
  if (ctx.live.has(o.id)) return reject("DUPLICATE_ID", `Duplicate order id: ${o.id}`);
  if (o.side !== "buy" && o.side !== "sell") return reject("INVALID_SIDE", `Invalid side: ${String(o.side)}`);
  if (ctx.priced) {
    const price = o.price as number;
    if (!Number.isSafeInteger(price) || price <= 0 || price > MAX_PRICE_CENTS) {
      return reject("INVALID_PRICE", `price must be an integer number of cents in 1..${MAX_PRICE_CENTS}, got ${price}`);
    }
    if (price % ctx.tickSize !== 0) {
      return reject("OFF_TICK", `price ${price} is not a multiple of tick size ${ctx.tickSize}`);
    }
  }
  if (!Number.isSafeInteger(o.qty) || o.qty <= 0 || o.qty > MAX_ORDER_QTY) {
    return reject("INVALID_QTY", `qty must be an integer in 1..${MAX_ORDER_QTY}, got ${o.qty}`);
  }
  return null;
}

export function reject(reason: RejectReason, message: string): Rejection {
  return { ok: false, reason, message };
}
