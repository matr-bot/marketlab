import { ln } from "../detMath";
import { highestPrice, toTick } from "../price";
import type { BookView } from "../matchingEngine";
import type { Cents, RestingOrder, Side } from "../types";
import type { Agent, AgentContext, AgentSpec } from "./agent";

// Avellaneda–Stoikov market maker (D-033 to D-036). Avellaneda & Stoikov (2008), "High-frequency
// trading in a limit order book", Quantitative Finance 8(3). Inventory limits as in Guéant,
// Lehalle & Fernandez-Tapia (2013).
//
// It quotes both sides around a RESERVATION price, the mid nudged against its inventory, with a
// spread made of an inventory-risk part (grows with volatility²) and a competitive part (set by
// how quickly fills fall off with distance). It never crosses the spread (post-only), shrinks its
// size when volatility is high or inventory is near its limit, and only replaces a quote when its
// price or size actually changes, so unchanged quotes keep their place in the queue.

export interface MarketMakerParams {
  /** Risk aversion γ, per cent. */
  readonly gamma: number;
  /** Fill-intensity decay k, per cent: fills fall off as e^(−k·distance). */
  readonly k: number;
  /** Rolling horizon τ in seconds (the market never "closes", D-034). */
  readonly tauSec: number;
  /** Shares per lot; inventory q is measured in lots. */
  readonly lotSize: number;
  /** Quote size in shares when calm and flat. */
  readonly baseSize: number;
  /** Inventory limit in shares, long or short. */
  readonly maxInventory: number;
  /** Smallest size factor under high volatility (size × max(this, min(1, σ₀/σ))). */
  readonly minSizeFactor: number;
  /** Calm volatility (log return per √s) that size is measured against. */
  readonly sigma0: number;
}

export const DEFAULT_MM_PARAMS: MarketMakerParams = {
  gamma: 0.01,
  // 1.5 in the plan; 1.0 after the P&L investigation (D-033): at 1.5 the market maker's spread did
  // not cover the permanent price impact of noise market orders and it lost money on 5 of 6 runs.
  k: 1.0,
  tauSec: 60,
  lotSize: 100,
  baseSize: 500,
  maxInventory: 5_000,
  minSizeFactor: 0.25,
  sigma0: 4.3e-5,
};

export interface QuoteInputs {
  /** Reference mid in cents (may be a half cent). */
  readonly mid: number;
  /** Volatility, log return per √s (the larger of the fast and slow estimates). */
  readonly sigma: number;
  /** Current position in shares. */
  readonly position: number;
  /** Best bid / ask of OTHER traders (the market maker's own quotes excluded), or null. */
  readonly othersBestBid: Cents | null;
  readonly othersBestAsk: Cents | null;
  readonly tick: Cents;
}

export interface Quote {
  readonly price: Cents;
  readonly qty: number;
}

export interface Quotes {
  /** Reservation price r = s − q·γ·σc²·τ, in cents (unrounded). */
  readonly reservation: number;
  /** Total spread δ = γ·σc²·τ + (2/γ)·ln(1 + γ/k), in cents (unrounded). */
  readonly spread: number;
  /** Inventory-risk part of the spread, γ·σc²·τ (cents). */
  readonly riskPart: number;
  readonly bid: Quote | null;
  readonly ask: Quote | null;
}

/** The Avellaneda–Stoikov quotes for one moment. Pure: same inputs → same quotes. */
export function computeQuotes(p: MarketMakerParams, i: QuoteInputs): Quotes {
  const sigmaCents = i.sigma * i.mid; // cents per √s
  const q = i.position / p.lotSize; // lots
  const riskPart = p.gamma * sigmaCents * sigmaCents * p.tauSec;
  const reservation = i.mid - q * riskPart;
  const spread = riskPart + (2 / p.gamma) * ln(1 + p.gamma / p.k);

  let bidPrice = toTick(reservation - spread / 2, i.tick, "down");
  let askPrice = toTick(reservation + spread / 2, i.tick, "up");
  // Post-only (D-035): never at or through another trader's best price on the other side. The
  // bid can only move down and the ask only up, so bid < ask still holds afterwards. The clamp can
  // push a price off the legal range (bid below one tick, ask above the cap); that side then has
  // no legal post-only price and is not quoted (Codex review).
  if (i.othersBestAsk !== null) bidPrice = Math.min(bidPrice, i.othersBestAsk - i.tick);
  if (i.othersBestBid !== null) askPrice = Math.max(askPrice, i.othersBestBid + i.tick);

  // Size: smaller when volatility is high, and on the side that would grow the inventory.
  const volFactor = Math.max(p.minSizeFactor, Math.min(1, p.sigma0 / i.sigma));
  const lots = (shares: number) => Math.floor(shares / p.lotSize) * p.lotSize;
  const bidQty = Math.min(lots(p.baseSize * volFactor * (1 - Math.max(0, i.position) / p.maxInventory)), lots(p.maxInventory - i.position));
  const askQty = Math.min(lots(p.baseSize * volFactor * (1 - Math.max(0, -i.position) / p.maxInventory)), lots(p.maxInventory + i.position));

  return {
    reservation,
    spread,
    riskPart,
    bid: bidQty > 0 && bidPrice >= i.tick ? { price: bidPrice, qty: bidQty } : null,
    ask: askQty > 0 && askPrice <= highestPrice(i.tick) ? { price: askPrice, qty: askQty } : null,
  };
}

/** Best price on `side` among orders that are not in `mine`, or null. */
export function othersBest(book: BookView, side: Side, mine: ReadonlySet<string>): Cents | null {
  for (const level of book.depth(side)) {
    if (book.ordersAt(side, level.price).some((o) => !mine.has(o.id))) return level.price;
  }
  return null;
}

export class MarketMaker implements Agent {
  constructor(private readonly params: MarketMakerParams = DEFAULT_MM_PARAMS) {}

  act(ctx: AgentContext): void {
    const own = ctx.myOrders();
    const mine = new Set(own.map((o) => o.id));
    const bestBid = othersBest(ctx.book, "buy", mine);
    const bestAsk = othersBest(ctx.book, "sell", mine);
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : (ctx.lastTradePrice ?? ctx.startPrice);
    const quotes = computeQuotes(this.params, {
      mid,
      sigma: ctx.volatility.sigma,
      position: ctx.position,
      othersBestBid: bestBid,
      othersBestAsk: bestAsk,
      tick: ctx.book.tickSize,
    });

    // Replace a side only if its price or size changed (D-036): an unchanged quote keeps its
    // time priority. Cancel everything that changes first, then place, so the market maker never
    // briefly crosses its own quotes.
    const toPlace: Array<{ side: Side; quote: Quote }> = [];
    for (const side of ["buy", "sell"] as const) {
      const wanted = side === "buy" ? quotes.bid : quotes.ask;
      const resting: RestingOrder[] = own.filter((o) => o.side === side); // oldest first (agent contract, D-026)
      const keep = wanted !== null && resting.length === 1 && resting[0].price === wanted.price && resting[0].qty === wanted.qty;
      if (keep) continue;
      for (const o of resting) ctx.cancel(o.id);
      if (wanted !== null) toPlace.push({ side, quote: wanted });
    }
    for (const { side, quote } of toPlace) ctx.submit({ type: "limit", side, price: quote.price, qty: quote.qty });
  }
}

/** Two market makers by default: mm-1 (γ 0.010) and mm-2 (γ 0.015), requoting ~5 times a second. */
export function marketMakers(
  gammas: readonly number[] = [0.01, 0.015],
  ratePerSec = 5,
  params: MarketMakerParams = DEFAULT_MM_PARAMS,
): AgentSpec[] {
  return gammas.map((gamma, i) => ({
    id: `mm-${i + 1}`,
    agentType: "marketMaker" as const,
    ratePerSec,
    create: () => new MarketMaker({ ...params, gamma }),
  }));
}
