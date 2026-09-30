/** Money and prices are always integer cents. Never floats. */
export type Cents = number;

export type Side = "buy" | "sell";

export type OrderId = string;

/** A limit order resting in the book. `qty` is the remaining (unfilled) quantity. */
export interface RestingOrder {
  readonly id: OrderId;
  readonly ownerId: string;
  readonly side: Side;
  readonly price: Cents;
  readonly qty: number;
  /** Arrival sequence number assigned by the book; lower = earlier = higher time priority. */
  readonly seq: number;
}

/** Aggregated view of one price level. */
export interface DepthLevel {
  readonly price: Cents;
  readonly qty: number;
  readonly orderCount: number;
}

/**
 * Why the book refused an order. Rejections are normal order flow (agents send bad or
 * stale orders all the time), so they are returned as data, never thrown.
 */
export type RejectReason =
  | "INVALID_ID"
  | "INVALID_OWNER"
  | "DUPLICATE_ID"
  | "INVALID_SIDE"
  | "INVALID_PRICE"
  | "OFF_TICK"
  | "INVALID_QTY"
  | "WOULD_CROSS";

export type Rejection = { readonly ok: false; readonly reason: RejectReason; readonly message: string };

export type AddResult = { readonly ok: true; readonly order: RestingOrder } | Rejection;

export type CancelResult =
  | { readonly ok: true; readonly order: RestingOrder }
  | { readonly ok: false; readonly reason: "UNKNOWN_ORDER"; readonly message: string };
