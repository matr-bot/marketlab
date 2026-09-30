import type {
  AddResult,
  CancelResult,
  Cents,
  DepthLevel,
  OrderId,
  RejectReason,
  Rejection,
  RestingOrder,
  Side,
} from "./types";

export interface NewLimitOrder {
  id: OrderId;
  ownerId: string;
  side: Side;
  price: Cents;
  qty: number;
}

interface Level {
  readonly price: Cents;
  /** Insertion-ordered, so iteration order is time priority. O(1) delete for cancels. */
  readonly orders: Map<OrderId, MutableOrder>;
  totalQty: number;
}

type MutableOrder = { -readonly [K in keyof RestingOrder]: RestingOrder[K] };

class BookSide {
  private readonly levels = new Map<Cents, Level>();
  /** Prices sorted best-first: descending for bids, ascending for asks. */
  private readonly prices: Cents[] = [];

  constructor(private readonly side: Side) {}

  /** True if price `a` has higher priority than price `b` on this side. */
  private better(a: Cents, b: Cents): boolean {
    return this.side === "buy" ? a > b : a < b;
  }

  bestPrice(): Cents | null {
    return this.prices.length > 0 ? this.prices[0] : null;
  }

  level(price: Cents): Level | undefined {
    return this.levels.get(price);
  }

  insert(order: MutableOrder): void {
    let level = this.levels.get(order.price);
    if (!level) {
      level = { price: order.price, orders: new Map(), totalQty: 0 };
      this.levels.set(order.price, level);
      this.prices.splice(this.insertionIndex(order.price), 0, order.price);
    }
    level.orders.set(order.id, order);
    level.totalQty += order.qty;
  }

  remove(order: MutableOrder): void {
    const level = this.levels.get(order.price);
    if (!level || !level.orders.delete(order.id)) {
      throw new Error(`OrderBook invariant broken: order ${order.id} missing from its level`);
    }
    level.totalQty -= order.qty;
    if (level.orders.size === 0) {
      this.levels.delete(order.price);
      this.prices.splice(this.prices.indexOf(order.price), 1);
    }
  }

  depth(maxLevels: number): DepthLevel[] {
    return this.prices.slice(0, maxLevels).map((price) => {
      const level = this.levels.get(price)!;
      return { price, qty: level.totalQty, orderCount: level.orders.size };
    });
  }

  levelCount(): number {
    return this.prices.length;
  }

  /** Binary search for where `price` belongs in best-first order. */
  private insertionIndex(price: Cents): number {
    let lo = 0;
    let hi = this.prices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.better(this.prices[mid], price)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/**
 * Limit order book for one ticker, with price-time priority.
 *
 * This is the passive data structure: it stores resting limit orders and answers queries.
 * It never matches. An order that would cross the spread is rejected (`WOULD_CROSS`), because routing
 * aggressive orders is the matching engine's job (build step 2). As a result the book is
 * never crossed: best bid < best ask whenever both exist.
 */
export class OrderBook {
  private readonly bids = new BookSide("buy");
  private readonly asks = new BookSide("sell");
  private readonly byId = new Map<OrderId, MutableOrder>();
  private nextSeq = 0;

  constructor(
    readonly ticker: string,
    /** Minimum price increment in cents. */
    readonly tickSize: Cents = 1,
  ) {
    if (!Number.isSafeInteger(tickSize) || tickSize <= 0) {
      throw new RangeError(`tickSize must be a positive integer number of cents, got ${tickSize}`);
    }
  }

  /**
   * Rest a limit order in the book. Never throws for bad input: invalid, duplicate or
   * crossing orders come back as `{ ok: false, reason }`.
   */
  add(input: NewLimitOrder): AddResult {
    const { id, ownerId, side, price, qty } = input;
    if (this.byId.has(id)) return reject("DUPLICATE_ID", `Duplicate order id: ${id}`);
    if (side !== "buy" && side !== "sell") return reject("INVALID_SIDE", `Invalid side: ${String(side)}`);
    if (!Number.isSafeInteger(price) || price <= 0) {
      return reject("INVALID_PRICE", `price must be a positive integer number of cents, got ${price}`);
    }
    if (price % this.tickSize !== 0) {
      return reject("OFF_TICK", `price ${price} is not a multiple of tick size ${this.tickSize}`);
    }
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      return reject("INVALID_QTY", `qty must be a positive integer, got ${qty}`);
    }
    if (this.wouldCross(side, price)) {
      return reject(
        "WOULD_CROSS",
        `${side} @ ${price} would cross the spread; aggressive orders must go through the matching engine`,
      );
    }

    const order: MutableOrder = { id, ownerId, side, price, qty, seq: this.nextSeq++ };
    this.sideOf(side).insert(order);
    this.byId.set(id, order);
    return { ok: true, order: { ...order } };
  }

  /** Remove a resting order. Returns the removed order, or `UNKNOWN_ORDER` if it is not in the book. */
  cancel(id: OrderId): CancelResult {
    const order = this.byId.get(id);
    if (!order) return { ok: false, reason: "UNKNOWN_ORDER", message: `Unknown order id: ${id}` };
    this.sideOf(order.side).remove(order);
    this.byId.delete(id);
    return { ok: true, order: { ...order } };
  }

  /**
   * Reduce a resting order's quantity (a partial or full fill). The order keeps its time
   * priority. Removes the order when it reaches zero. Returns the remaining quantity.
   *
   * Only the matching engine calls this, with orders it just read from the book, so a bad
   * id or quantity is a programming error and throws.
   */
  reduce(id: OrderId, qty: number): number {
    const order = this.byId.get(id);
    if (!order) throw new Error(`Unknown order id: ${id}`);
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > order.qty) {
      throw new RangeError(`reduce qty must be an integer in 1..${order.qty}, got ${qty}`);
    }
    if (qty === order.qty) {
      this.cancel(id);
      return 0;
    }
    order.qty -= qty;
    this.sideOf(order.side).level(order.price)!.totalQty -= qty;
    return order.qty;
  }

  get(id: OrderId): RestingOrder | undefined {
    const order = this.byId.get(id);
    return order ? { ...order } : undefined;
  }

  bestBid(): Cents | null {
    return this.bids.bestPrice();
  }

  bestAsk(): Cents | null {
    return this.asks.bestPrice();
  }

  /** Best ask minus best bid in cents, or null if either side is empty. */
  spread(): Cents | null {
    const bid = this.bestBid();
    const ask = this.bestAsk();
    return bid === null || ask === null ? null : ask - bid;
  }

  /** The order with top priority on a side (best price, then earliest arrival). */
  bestOrder(side: Side): RestingOrder | undefined {
    const book = this.sideOf(side);
    const price = book.bestPrice();
    if (price === null) return undefined;
    const first = book.level(price)!.orders.values().next().value;
    return first ? { ...first } : undefined;
  }

  /** Orders at one price level, in time priority. */
  ordersAt(side: Side, price: Cents): RestingOrder[] {
    const level = this.sideOf(side).level(price);
    return level ? [...level.orders.values()].map((o) => ({ ...o })) : [];
  }

  /** Aggregated levels for one side, best price first. */
  depth(side: Side, maxLevels = Infinity): DepthLevel[] {
    return this.sideOf(side).depth(maxLevels);
  }

  levelCount(side: Side): number {
    return this.sideOf(side).levelCount();
  }

  /** Number of resting orders on both sides. */
  get size(): number {
    return this.byId.size;
  }

  private sideOf(side: Side): BookSide {
    return side === "buy" ? this.bids : this.asks;
  }

  private wouldCross(side: Side, price: Cents): boolean {
    const opposite = side === "buy" ? this.bestAsk() : this.bestBid();
    if (opposite === null) return false;
    return side === "buy" ? price >= opposite : price <= opposite;
  }
}

function reject(reason: RejectReason, message: string): Rejection {
  return { ok: false, reason, message };
}
