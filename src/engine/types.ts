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
