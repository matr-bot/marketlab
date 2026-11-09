import type { Fill, FillParty } from "./matchingEngine";
import type { Cents, OrderId, Side } from "./types";

// Execution report (EXR). For every order one owner placed, how far the average price it got was
// from the price it intended, and why. The intended price is the arrival mid (implementation
// shortfall, D-010): the middle of the market at the moment the order arrived.
//
// For the part of an order that crossed the spread (the aggressor fills), slippage splits exactly:
//   spread cost  = arrival mid → the best opposite price (the touch)   what it costs to cross at all
//   impact cost  = touch → the price actually paid                     what the order's own size did
// The part that rested and was hit later (passive fills) is not a cost of crossing: its edge is the
// distance between its price and the arrival mid, and it is reported separately.
//
// Everything is exact integer arithmetic. Prices are cents and a mid can be a half cent, so every
// slippage figure is stored doubled ("X2": half-cents × shares). Positive = cost to the owner,
// negative = price improvement. Pure functions of the fill log: the same fills give the same report.

export interface OrderReport {
  readonly orderId: OrderId;
  readonly side: Side;
  /** Sim ms of the order's first fill. */
  readonly time: number;
  /** Shares filled so far (aggressive + passive). */
  readonly qty: number;
  readonly aggressiveQty: number;
  readonly passiveQty: number;
  /** Σ price × shares in cents: the exact amount paid or received. */
  readonly notional: number;
  /** Average fill price in cents (notional ÷ qty). Display rounds it; nothing else uses it. */
  readonly avgPrice: number;
  /** Twice the mid when the order arrived, or null if one side of the book was empty (no intended price). */
  readonly arrivalMidX2: number | null;
  /** Total slippage vs the arrival mid, half-cent shares; null when there was no arrival mid. */
  readonly slippageX2: number | null;
  /** Of the aggressive fills: the cost of crossing from the mid to the touch. */
  readonly spreadX2: number | null;
  /** Of the aggressive fills: the cost of the order's own size, from the touch to the price paid. */
  readonly impactX2: number | null;
  /** Of the passive fills: price vs the arrival mid (negative = earned the spread). */
  readonly passiveX2: number | null;
}

export interface ExecutionTotals {
  readonly orders: number;
  readonly qty: number;
  readonly notional: number;
  /** Totals over the orders that had an arrival mid; null if none did. */
  readonly slippageX2: number | null;
  readonly spreadX2: number | null;
  readonly impactX2: number | null;
  readonly passiveX2: number | null;
  /** Slippage as basis points of the arrival-mid value of those orders, or null. A display ratio, not money. */
  readonly slippageBps: number | null;
}

interface Acc {
  orderId: OrderId;
  side: Side;
  time: number;
  qty: number;
  aggressiveQty: number;
  passiveQty: number;
  notional: number;
  midX2: number | null;
  aggregate: number;
  spread: number;
  passive: number;
}

/** One report per order of `ownerId`, in the order of each order's first fill. */
export function buildOrderReports(fills: readonly Fill[], ownerId: string): OrderReport[] {
  const byOrder = new Map<OrderId, Acc>();
  for (const f of fills) {
    const party: FillParty | null = f.buy.ownerId === ownerId ? f.buy : f.sell.ownerId === ownerId ? f.sell : null;
    if (party === null) continue;
    const side: Side = party === f.buy ? "buy" : "sell";
    const sign = side === "buy" ? 1 : -1;
    let acc = byOrder.get(party.orderId);
    if (acc === undefined) {
      acc = { orderId: party.orderId, side, time: f.time, qty: 0, aggressiveQty: 0, passiveQty: 0, notional: 0, midX2: party.arrival.midX2, aggregate: 0, spread: 0, passive: 0 };
      byOrder.set(party.orderId, acc);
    }
    acc.qty += f.qty;
    acc.notional += f.price * f.qty;
    const aggressive = f.aggressor === side;
    if (aggressive) acc.aggressiveQty += f.qty;
    else acc.passiveQty += f.qty;
    const mid = party.arrival.midX2;
    const touch = party.arrival.touch;
    if (mid === null) continue;
    const edge = sign * f.qty * (2 * f.price - mid);
    if (aggressive) {
      acc.aggregate += edge;
      // An aggressive fill had a touch to trade against; with a mid present, both sides were quoted.
      acc.spread += sign * f.qty * (2 * (touch as Cents) - mid);
    } else {
      acc.passive += edge;
    }
  }
  return [...byOrder.values()].map((a) => {
    const known = a.midX2 !== null;
    return {
      orderId: a.orderId,
      side: a.side,
      time: a.time,
      qty: a.qty,
      aggressiveQty: a.aggressiveQty,
      passiveQty: a.passiveQty,
      notional: a.notional,
      avgPrice: a.notional / a.qty,
      arrivalMidX2: a.midX2,
      slippageX2: known ? a.aggregate + a.passive : null,
      spreadX2: known ? a.spread : null,
      impactX2: known ? a.aggregate - a.spread : null,
      passiveX2: known ? a.passive : null,
    };
  });
}

/** Totals over a set of order reports; orders with no arrival mid count in volume but not in slippage. */
export function totalExecution(reports: readonly OrderReport[]): ExecutionTotals {
  let qty = 0;
  let notional = 0;
  let slip = 0;
  let spread = 0;
  let impact = 0;
  let passive = 0;
  let midValueX2 = 0;
  let measured = 0;
  for (const r of reports) {
    qty += r.qty;
    notional += r.notional;
    if (r.slippageX2 === null || r.spreadX2 === null || r.impactX2 === null || r.passiveX2 === null || r.arrivalMidX2 === null) continue;
    measured++;
    slip += r.slippageX2;
    spread += r.spreadX2;
    impact += r.impactX2;
    passive += r.passiveX2;
    midValueX2 += r.qty * r.arrivalMidX2;
  }
  return {
    orders: reports.length,
    qty,
    notional,
    slippageX2: measured > 0 ? slip : null,
    spreadX2: measured > 0 ? spread : null,
    impactX2: measured > 0 ? impact : null,
    passiveX2: measured > 0 ? passive : null,
    slippageBps: measured > 0 && midValueX2 > 0 ? (slip / midValueX2) * 10_000 : null,
  };
}

/** Half-cent shares → cents per share (e.g. 3 cents per share of slippage). A display value. */
export function perShareCents(x2: number, qty: number): number {
  return x2 / (2 * qty);
}

/** Half-cent shares → whole cents, rounded once at the end (a dollar amount for display). */
export function totalCents(x2: number): number {
  return Math.round(x2 / 2);
}

/** One order's slippage as basis points of its arrival-mid value, or null if it had no arrival mid. A display ratio. */
export function orderSlippageBps(r: OrderReport): number | null {
  return r.slippageX2 === null || r.arrivalMidX2 === null || r.qty === 0 ? null : (r.slippageX2 / (r.qty * r.arrivalMidX2)) * 10_000;
}
