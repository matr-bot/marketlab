import { OrderBook } from "./orderBook";
import type { AgentType, CancelResult, Cents, DepthLevel, OrderId, Rejection, RestingOrder, Side } from "./types";
import { reject, validateOrder } from "./validation";

/** An incoming limit order. The engine assigns its id (D-014). */
export interface LimitOrderInput {
  type: "limit";
  ownerId: string;
  agentType: AgentType;
  side: Side;
  /** Worst acceptable price: the most a buyer pays, the least a seller accepts. */
  price: Cents;
  qty: number;
}

/** Trades immediately at the best available prices. Any unfilled part is cancelled (D-007). */
export interface MarketOrderInput {
  type: "market";
  ownerId: string;
  agentType: AgentType;
  side: Side;
  qty: number;
}

export type OrderInput = LimitOrderInput | MarketOrderInput;

/**
 * The market as the order found it when it arrived (D-010). Slippage is measured from here.
 * A missing side is recorded as null, and anything that depends on it is null too.
 */
export interface ArrivalQuote {
  readonly bid: Cents | null;
  readonly ask: Cents | null;
  /**
   * Twice the mid price, (bid + ask). Stored doubled so it stays an exact integer even when the
   * mid falls on a half cent (bid 100, ask 101 → mid 100.5 → midX2 201). Null if either side is empty.
   * The arrival mid is the order's intended price for slippage (implementation shortfall).
   */
  readonly midX2: number | null;
  /** Best opposite price at arrival: the ask for a buy, the bid for a sell. Null if that side is empty. */
  readonly touch: Cents | null;
}

/** One side of a fill. */
export interface FillParty {
  readonly orderId: OrderId;
  readonly ownerId: string;
  readonly agentType: AgentType;
  /** The order's limit (worst acceptable) price; null for a market order. A resting order's limit is its price. */
  readonly limitPrice: Cents | null;
  /** The quote when this party's order arrived (for the resting side, when it was submitted). */
  readonly arrival: ArrivalQuote;
}

/** One trade between an incoming (aggressor) order and a resting order. Frozen: the log is history. */
export interface Fill {
  /** 0, 1, 2, … per market, in execution order. */
  readonly seq: number;
  /** Sim time in milliseconds. */
  readonly time: number;
  readonly ticker: string;
  /** Always the resting order's price. */
  readonly price: Cents;
  readonly qty: number;
  /** Side of the incoming order that caused the trade. */
  readonly aggressor: Side;
  readonly buy: FillParty;
  readonly sell: FillParty;
}

export type SubmitResult =
  | {
      readonly ok: true;
      /** Assigned by the engine: `<ticker>-<n>`, n = 1, 2, 3, … never reused (D-014). */
      readonly orderId: OrderId;
      readonly arrival: ArrivalQuote;
      /** Fills caused by this order, in execution order. */
      readonly fills: Fill[];
      /** What is left resting in the book (limit orders only), or null. */
      readonly resting: RestingOrder | null;
      /** Quantity cancelled instead of filled or rested (a market order's unfilled part, D-007). */
      readonly cancelledQty: number;
      /** The submitter's own resting orders cancelled to prevent a self-trade (D-008). */
      readonly selfTradeCancelled: RestingOrder[];
    }
  | Rejection;

/**
 * Read-only view of one market's book: query functions only. It is a separate frozen object,
 * not the OrderBook itself, so no cast can reach add/cancel/reduce. All writes go through the
 * engine, which keeps arrival quotes and the fill log in sync (D-013).
 */
export interface BookView {
  readonly ticker: string;
  readonly tickSize: Cents;
  readonly size: number;
  readonly ownerCount: number;
  bestBid(): Cents | null;
  bestAsk(): Cents | null;
  spread(): Cents | null;
  bestOrder(side: Side): RestingOrder | undefined;
  ordersAt(side: Side, price: Cents): RestingOrder[];
  depth(side: Side, maxLevels?: number): DepthLevel[];
  levelCount(side: Side): number;
  get(id: OrderId): RestingOrder | undefined;
  has(id: OrderId): boolean;
  ordersOf(ownerId: string): RestingOrder[];
}

function readOnlyView(book: OrderBook): BookView {
  return Object.freeze({
    ticker: book.ticker,
    tickSize: book.tickSize,
    get size() {
      return book.size;
    },
    get ownerCount() {
      return book.ownerCount;
    },
    bestBid: () => book.bestBid(),
    bestAsk: () => book.bestAsk(),
    spread: () => book.spread(),
    bestOrder: (side: Side) => book.bestOrder(side),
    ordersAt: (side: Side, price: Cents) => book.ordersAt(side, price),
    depth: (side: Side, maxLevels?: number) => book.depth(side, maxLevels),
    levelCount: (side: Side) => book.levelCount(side),
    get: (id: OrderId) => book.get(id),
    has: (id: OrderId) => book.has(id),
    ordersOf: (ownerId: string) => book.ordersOf(ownerId),
  });
}

/**
 * Continuous double auction for one ticker. Incoming orders match the opposite side by
 * price-time priority; each fill happens at the resting order's price. Limit-order remainders
 * rest in the book; market-order remainders are cancelled. The book is never left crossed.
 *
 * Deterministic: no randomness, no clock reads. Time is passed in by the caller.
 */
export class MatchingEngine {
  private readonly orderBook: OrderBook;
  readonly book: BookView;
  /** Arrival quote of every resting order, removed when the order leaves the book. */
  private readonly arrivals = new Map<OrderId, ArrivalQuote>();
  private readonly log: Fill[] = [];
  /** Number given to the next accepted order. Rejected orders do not consume one. */
  private nextOrderNumber = 1;

  constructor(ticker: string, tickSize: Cents = 1) {
    this.orderBook = new OrderBook(ticker, tickSize);
    this.book = readOnlyView(this.orderBook);
  }

  get ticker(): string {
    return this.orderBook.ticker;
  }

  /** A copy of every fill so far, in execution order. */
  get fills(): Fill[] {
    return this.log.slice();
  }

  get fillCount(): number {
    return this.log.length;
  }

  /** Fills with seq ≥ `fromSeq`, for batching (e.g. everything since the last frame). */
  fillsSince(fromSeq: number): Fill[] {
    return this.log.slice(Math.max(0, fromSeq));
  }

  /** The arrival quote of a resting order, or undefined if it is not in the book. */
  arrivalOf(id: OrderId): ArrivalQuote | undefined {
    return this.arrivals.get(id);
  }

  /** Number of tracked arrival quotes; always equals `book.size` (checked by tests). */
  get trackedArrivals(): number {
    return this.arrivals.size;
  }

  submit(order: OrderInput, time: number): SubmitResult {
    if (!Number.isSafeInteger(time) || time < 0) {
      throw new RangeError(`time must be a non-negative integer number of ms, got ${time}`);
    }
    if (order.type !== "limit" && order.type !== "market") {
      return reject("INVALID_ORDER_TYPE", `order type must be "limit" or "market", got ${JSON.stringify((order as { type: unknown }).type)}`);
    }
    const isLimit = order.type === "limit";
    const id = `${this.orderBook.ticker}-${this.nextOrderNumber}`;
    const invalid = validateOrder({ ...order, id }, { tickSize: this.orderBook.tickSize, live: this.orderBook, priced: isLimit });
    if (invalid) return invalid;

    const { ownerId, agentType, side, qty } = order;
    const opposite: Side = side === "buy" ? "sell" : "buy";
    const arrival = this.quote(side);
    if (!isLimit && arrival.touch === null) {
      return reject("NO_LIQUIDITY", `market ${side} for ${qty} has nothing to trade against: the ${opposite} side is empty`);
    }
    this.nextOrderNumber++;

    const taker: FillParty = Object.freeze({ orderId: id, ownerId, agentType, limitPrice: isLimit ? order.price : null, arrival });
    const fills: Fill[] = [];
    const selfTradeCancelled: RestingOrder[] = [];
    let remaining = qty;

    while (remaining > 0) {
      const maker = this.orderBook.bestOrder(opposite);
      if (!maker) break;
      if (isLimit && !crosses(side, order.price, maker.price)) break;
      if (maker.ownerId === ownerId) {
        // Self-trade prevention (D-008): the resting order is the stale one, so cancel it.
        this.cancel(maker.id);
        selfTradeCancelled.push(maker);
        continue;
      }
      const makerArrival = this.arrivals.get(maker.id);
      if (!makerArrival) throw new Error(`MatchingEngine invariant broken: no arrival quote for ${maker.id}`);
      const fillQty = Math.min(remaining, maker.qty);
      if (this.orderBook.reduce(maker.id, fillQty) === 0) this.arrivals.delete(maker.id);
      remaining -= fillQty;

      const makerParty: FillParty = Object.freeze({
        orderId: maker.id,
        ownerId: maker.ownerId,
        agentType: maker.agentType,
        limitPrice: maker.price,
        arrival: makerArrival,
      });
      const fill: Fill = Object.freeze({
        seq: this.log.length,
        time,
        ticker: this.orderBook.ticker,
        price: maker.price,
        qty: fillQty,
        aggressor: side,
        buy: side === "buy" ? taker : makerParty,
        sell: side === "sell" ? taker : makerParty,
      });
      this.log.push(fill);
      fills.push(fill);
    }

    let resting: RestingOrder | null = null;
    let cancelledQty = 0;
    if (remaining > 0 && isLimit) {
      const added = this.orderBook.add({ id, ownerId, agentType, side, price: order.price, qty: remaining });
      // Cannot fail: the order was validated and everything it crossed has been consumed.
      if (!added.ok) throw new Error(`MatchingEngine invariant broken: remainder rejected (${added.reason})`);
      resting = added.order;
      this.arrivals.set(id, arrival);
    } else {
      cancelledQty = remaining;
    }
    return { ok: true, orderId: id, arrival, fills, resting, cancelledQty, selfTradeCancelled };
  }

  cancel(id: OrderId): CancelResult {
    this.arrivals.delete(id);
    return this.orderBook.cancel(id);
  }

  /** Cancel every resting order of one owner, e.g. a market maker pulling its quotes. */
  cancelAll(ownerId: string): RestingOrder[] {
    const cancelled = this.orderBook.cancelAll(ownerId);
    for (const o of cancelled) this.arrivals.delete(o.id);
    return cancelled;
  }

  /** The quote an incoming order on `side` sees right now. Frozen: it is shared by fills. */
  private quote(side: Side): ArrivalQuote {
    const bid = this.orderBook.bestBid();
    const ask = this.orderBook.bestAsk();
    return Object.freeze({
      bid,
      ask,
      midX2: bid === null || ask === null ? null : bid + ask,
      touch: side === "buy" ? ask : bid,
    });
  }
}

/** True if an incoming order on `side` with limit `limit` can trade with a resting `restingPrice`. */
function crosses(side: Side, limit: Cents, restingPrice: Cents): boolean {
  return side === "buy" ? restingPrice <= limit : restingPrice >= limit;
}
