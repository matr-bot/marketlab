// Test-only reference implementations. Deliberately naive: one flat array, every question
// answered by filtering and sorting from scratch. Nothing here is shared with the real engine
// (not even validation), so real and shadow can only agree if both are right. See D-004.
import type { ArrivalQuote, Fill, FillParty, OrderInput } from "../matchingEngine";
import type { NewLimitOrder } from "../orderBook";
import type { AgentType, CancelResult, DepthLevel, RejectReason, RestingOrder, Side } from "../types";

/** The query side of a book. Both OrderBook and the engine's read-only BookView satisfy it. */
interface QueryableBook {
  readonly size: number;
  readonly ownerCount: number;
  bestBid(): number | null;
  bestAsk(): number | null;
  spread(): number | null;
  bestOrder(side: Side): RestingOrder | undefined;
  ordersAt(side: Side, price: number): RestingOrder[];
  depth(side: Side): DepthLevel[];
  levelCount(side: Side): number;
  get(id: string): RestingOrder | undefined;
  ordersOf(ownerId: string): RestingOrder[];
}

// The shadow's own copy of the limits, written out by hand rather than imported, so a wrong
// constant in the engine cannot silently agree with itself. validation.test.ts pins the real
// values to the same numbers.
export const SHADOW_MAX_PRICE_CENTS = 100_000_000;
export const SHADOW_MAX_ORDER_QTY = 10_000_000;

const AGENTS: readonly string[] = ["noise", "marketMaker", "momentum", "value", "panic", "whale", "user"];

type Fail = { ok: false; reason: RejectReason };
const fail = (reason: RejectReason): Fail => ({ ok: false, reason });

/** Field checks in the documented precedence order. `price` is skipped for market orders. */
function naiveValidate(
  o: { id: unknown; ownerId: unknown; agentType: unknown; side: unknown; qty: unknown; price?: unknown },
  tick: number,
  liveIds: ReadonlySet<string>,
  priced: boolean,
): Fail | null {
  if (typeof o.id !== "string" || o.id.length === 0) return fail("INVALID_ID");
  if (typeof o.ownerId !== "string" || o.ownerId.length === 0) return fail("INVALID_OWNER");
  if (!AGENTS.includes(o.agentType as string)) return fail("INVALID_AGENT_TYPE");
  if (liveIds.has(o.id)) return fail("DUPLICATE_ID");
  if (o.side !== "buy" && o.side !== "sell") return fail("INVALID_SIDE");
  if (priced) {
    const p = o.price as number;
    if (!Number.isInteger(p) || p < 1 || p > SHADOW_MAX_PRICE_CENTS) return fail("INVALID_PRICE");
    if (p % tick !== 0) return fail("OFF_TICK");
  }
  const q = o.qty as number;
  if (!Number.isInteger(q) || q < 1 || q > SHADOW_MAX_ORDER_QTY) return fail("INVALID_QTY");
  return null;
}

export class ShadowBook {
  orders: RestingOrder[] = [];
  private seq = 0;

  constructor(readonly tick: number) {}

  ids(): Set<string> {
    return new Set(this.orders.map((r) => r.id));
  }

  /** Append a resting order with the next sequence number (no checks). */
  push(o: Omit<RestingOrder, "seq">): RestingOrder {
    const order: RestingOrder = { id: o.id, ownerId: o.ownerId, agentType: o.agentType, side: o.side, price: o.price, qty: o.qty, seq: this.seq++ };
    this.orders.push(order);
    return order;
  }

  add(o: NewLimitOrder): { ok: true; order: RestingOrder } | Fail {
    const invalid = naiveValidate(o, this.tick, this.ids(), true);
    if (invalid) return invalid;
    const crosses = this.orders.some((r) =>
      o.side === "buy" ? r.side === "sell" && r.price <= o.price : r.side === "buy" && r.price >= o.price,
    );
    if (crosses) return fail("WOULD_CROSS");
    return { ok: true, order: this.push(o) };
  }

  /** Builds its own result (including the message) instead of borrowing the real one. */
  cancel(id: string): CancelResult {
    const found = this.orders.find((r) => r.id === id);
    if (!found) return { ok: false, reason: "UNKNOWN_ORDER", message: `Unknown order id: ${id}` };
    this.orders = this.orders.filter((r) => r.id !== id);
    return { ok: true, order: found };
  }

  reduce(id: string, qty: number): number {
    const found = this.orders.find((r) => r.id === id)!;
    const left = found.qty - qty;
    this.orders = this.orders.map((r) => (r.id === id ? { ...r, qty: left } : r)).filter((r) => r.qty > 0);
    return left;
  }

  cancelAll(ownerId: string): RestingOrder[] {
    const mine = this.orders.filter((r) => r.ownerId === ownerId);
    this.orders = this.orders.filter((r) => r.ownerId !== ownerId);
    return mine;
  }

  /** Orders on one side in full priority order: better price first, then earlier seq. */
  queue(side: Side): RestingOrder[] {
    return this.orders
      .filter((r) => r.side === side)
      .sort((a, b) => (a.price !== b.price ? (side === "buy" ? b.price - a.price : a.price - b.price) : a.seq - b.seq));
  }

  depth(side: Side): DepthLevel[] {
    const levels: DepthLevel[] = [];
    for (const r of this.queue(side)) {
      const last = levels[levels.length - 1];
      if (last && last.price === r.price) levels[levels.length - 1] = { price: r.price, qty: last.qty + r.qty, orderCount: last.orderCount + 1 };
      else levels.push({ price: r.price, qty: r.qty, orderCount: 1 });
    }
    return levels;
  }

  bestBid(): number | null {
    const prices = this.orders.filter((r) => r.side === "buy").map((r) => r.price);
    return prices.length ? Math.max(...prices) : null;
  }

  bestAsk(): number | null {
    const prices = this.orders.filter((r) => r.side === "sell").map((r) => r.price);
    return prices.length ? Math.min(...prices) : null;
  }
}

export type ShadowSubmit =
  | {
      ok: true;
      orderId: string;
      arrival: ArrivalQuote;
      fills: Fill[];
      resting: RestingOrder | null;
      cancelledQty: number;
      selfTradeCancelled: RestingOrder[];
    }
  | Fail;

/** Naive matcher on top of ShadowBook: re-sorts the whole opposite side before every fill. */
export class ShadowEngine {
  readonly book: ShadowBook;
  readonly arrivals = new Map<string, ArrivalQuote>();
  readonly fills: Fill[] = [];
  private accepted = 0;

  constructor(readonly ticker: string, tick: number) {
    this.book = new ShadowBook(tick);
  }

  submit(order: OrderInput, time: number): ShadowSubmit {
    if (order.type !== "limit" && order.type !== "market") return fail("INVALID_ORDER_TYPE");
    const limit = order.type === "limit" ? order.price : null;
    const id = `${this.ticker}-${this.accepted + 1}`;
    const invalid = naiveValidate({ ...order, id }, this.book.tick, this.book.ids(), limit !== null);
    if (invalid) return invalid;

    const bid = this.book.bestBid();
    const ask = this.book.bestAsk();
    const arrival: ArrivalQuote = {
      bid,
      ask,
      midX2: bid !== null && ask !== null ? bid + ask : null,
      touch: order.side === "buy" ? ask : bid,
    };
    if (limit === null && arrival.touch === null) return fail("NO_LIQUIDITY");
    this.accepted++;

    const opposite: Side = order.side === "buy" ? "sell" : "buy";
    const me: FillParty = { orderId: id, ownerId: order.ownerId, agentType: order.agentType, limitPrice: limit, arrival };
    const fills: Fill[] = [];
    const selfTradeCancelled: RestingOrder[] = [];
    let left = order.qty;
    for (;;) {
      if (left === 0) break;
      const best = this.book.queue(opposite)[0];
      if (best === undefined) break;
      const ok = limit === null || (order.side === "buy" ? best.price <= limit : best.price >= limit);
      if (!ok) break;
      if (best.ownerId === order.ownerId) {
        this.book.cancel(best.id);
        this.arrivals.delete(best.id);
        selfTradeCancelled.push(best);
        continue;
      }
      const q = Math.min(left, best.qty);
      const them: FillParty = { orderId: best.id, ownerId: best.ownerId, agentType: best.agentType as AgentType, limitPrice: best.price, arrival: this.arrivals.get(best.id)! };
      if (this.book.reduce(best.id, q) === 0) this.arrivals.delete(best.id);
      left -= q;
      const fill: Fill = {
        seq: this.fills.length,
        time,
        ticker: this.ticker,
        price: best.price,
        qty: q,
        aggressor: order.side,
        buy: order.side === "buy" ? me : them,
        sell: order.side === "sell" ? me : them,
      };
      this.fills.push(fill);
      fills.push(fill);
    }

    if (limit !== null && left > 0) {
      const resting = this.book.push({ id, ownerId: order.ownerId, agentType: order.agentType, side: order.side, price: limit, qty: left });
      this.arrivals.set(id, arrival);
      return { ok: true, orderId: id, arrival, fills, resting, cancelledQty: 0, selfTradeCancelled };
    }
    return { ok: true, orderId: id, arrival, fills, resting: null, cancelledQty: left, selfTradeCancelled };
  }

  cancel(id: string): CancelResult {
    this.arrivals.delete(id);
    return this.book.cancel(id);
  }

  cancelAll(ownerId: string): RestingOrder[] {
    const gone = this.book.cancelAll(ownerId);
    for (const r of gone) this.arrivals.delete(r.id);
    return gone;
  }
}

/** Everything observable about a real book, gathered into one structure for a single comparison. */
export function bookSnapshot(book: QueryableBook, ids: readonly string[], owners: readonly string[]) {
  return {
    size: book.size,
    bestBid: book.bestBid(),
    bestAsk: book.bestAsk(),
    spread: book.spread(),
    sides: (["buy", "sell"] as const).map((side) => {
      const depth = book.depth(side);
      return {
        depth,
        levelCount: book.levelCount(side),
        bestOrder: book.bestOrder(side),
        queues: depth.map((l) => book.ordersAt(side, l.price)),
      };
    }),
    byId: ids.map((id) => book.get(id)),
    byOwner: owners.map((o) => book.ordersOf(o)),
    ownerCount: book.ownerCount,
  };
}

/** The same structure computed independently from the shadow's flat array. */
export function shadowSnapshot(shadow: ShadowBook, ids: readonly string[], owners: readonly string[]) {
  const bid = shadow.depth("buy")[0]?.price ?? null;
  const ask = shadow.depth("sell")[0]?.price ?? null;
  const live = new Map(shadow.orders.map((r) => [r.id, r]));
  return {
    size: shadow.orders.length,
    bestBid: bid,
    bestAsk: ask,
    spread: bid === null || ask === null ? null : ask - bid,
    sides: (["buy", "sell"] as const).map((side) => {
      const queue = shadow.queue(side);
      const depth = shadow.depth(side);
      return {
        depth,
        levelCount: depth.length,
        bestOrder: queue[0],
        queues: depth.map((l) => queue.filter((r) => r.price === l.price)),
      };
    }),
    byId: ids.map((id) => live.get(id)),
    byOwner: owners.map((o) => shadow.orders.filter((r) => r.ownerId === o)),
    ownerCount: new Set(shadow.orders.map((r) => r.ownerId)).size,
  };
}

/**
 * Deep-compare two large structures quickly: identical JSON means identical. Otherwise fall
 * back to `check` (expect().toEqual), which is the real judge and prints a readable diff.
 */
export function sameFast(actual: unknown, expected: unknown, check: (a: unknown, e: unknown) => void): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) check(actual, expected);
}

/** Deterministic test generator (mulberry32) so failures reproduce by seed. */
export function rng(seed: number) {
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  return { next, int, pick };
}
