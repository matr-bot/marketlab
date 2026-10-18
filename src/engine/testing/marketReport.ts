// Market sanity report (test-only). Runs a simulation and measures what a careful reviewer would
// ask about a thin, noise-only market. Every number comes from engine state through the
// simulation's observer hooks; the report never changes the market.
import type { AgentSpec } from "../agents/agent";
import { DEFAULT_MM_PARAMS, MarketMaker, type MarketMakerParams } from "../agents/marketMaker";
import { noiseTraders, type NoiseTraderParams, DEFAULT_NOISE_PARAMS } from "../agents/noiseTrader";
import { Simulation } from "../simulation";
import type { Side } from "../types";

export interface MarketReport {
  ticks: number;
  /** Share of tick ends with no bids / no asks / either side empty. */
  bidEmptyShare: number;
  askEmptyShare: number;
  eitherEmptyShare: number;
  /** Average and median spread in cents, over tick ends with both sides present. */
  avgSpread: number;
  medianSpread: number;
  /** Average resting orders per side at tick ends. */
  avgBidOrders: number;
  avgAskOrders: number;
  trades: number;
  volume: number;
  /** Trade prices (cents). */
  open: number | null;
  low: number | null;
  high: number | null;
  close: number | null;
  /** Largest price span within one order's fills (last fill − first fill, cents). */
  largestSweepSpan: number;
  /** Largest change in the mid caused by one order (both sides present before and after). */
  largestMidMove: number;
  /** Orders whose fills spanned more than 3 distinct prices. */
  sweepsOver3Levels: number;
  marketOrders: number;
  marketOrdersOver2000: number;
  noLiquidityRejections: number;
  /** Minutes with no trade at all. */
  minutesWithoutTrades: number;
  /** Share of tick-end best bids / asks where a market maker has an order at that price. */
  mmAtBestBidShare: number;
  mmAtBestAskShare: number;
  /** Share of the quantity at the best bid and ask that belongs to market makers. */
  mmShareOfBestQty: number;
  /** Market-maker P&L in cents, marked to the final mid, per market maker. */
  mmPnl: Record<string, number>;
  /** Fills with a market maker on either side. */
  mmFills: number;
  /** Largest absolute market-maker position (shares). */
  mmMaxAbsPosition: number;
}

export interface ReportOptions {
  noise?: NoiseTraderParams;
  /** Market makers to add (none by default). */
  marketMakers?: ReadonlyArray<{ gamma: number }>;
  mmParams?: MarketMakerParams;
  /** Multiply the volatility the market makers see (a stub, for "what if volatility were 4×"). */
  mmSigmaMultiplier?: number;
}

/** Market makers built for a report, optionally seeing a multiplied volatility. */
function reportMarketMakers(opts: ReportOptions): AgentSpec[] {
  const params = opts.mmParams ?? DEFAULT_MM_PARAMS;
  const mult = opts.mmSigmaMultiplier ?? 1;
  return (opts.marketMakers ?? []).map(({ gamma }, i) => ({
    id: `mm-${i + 1}`,
    agentType: "marketMaker" as const,
    ratePerSec: 5,
    create: () => {
      const mm = new MarketMaker({ ...params, gamma });
      return {
        act: (ctx) => {
          if (mult === 1) return mm.act(ctx);
          const v = ctx.volatility;
          mm.act({
            time: ctx.time, book: ctx.book, startPrice: ctx.startPrice, myOrders: ctx.myOrders, submit: ctx.submit, cancel: ctx.cancel,
            lastTradePrice: ctx.lastTradePrice, position: ctx.position,
            fairValue: ctx.fairValue, panicSensitivity: ctx.panicSensitivity, maxMidSince: ctx.maxMidSince,
            volatility: { sigma: v.sigma * mult, fast: v.fast * mult, slow: v.slow * mult, samples: v.samples, ready: v.ready },
          });
        },
      };
    },
  }));
}

/** Median: the middle value, or the average of the two middle values for an even count; NaN if empty. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runMarketReport(seed: number, ticks: number, params: NoiseTraderParams | ReportOptions = DEFAULT_NOISE_PARAMS): MarketReport {
  const opts: ReportOptions = "pMarket" in params ? { noise: params } : params;
  let mmAtBid = 0;
  let mmAtAsk = 0;
  let bestQty = 0;
  let mmBestQty = 0;
  let mmMaxAbsPosition = 0;
  let bidEmpty = 0;
  let askEmpty = 0;
  let eitherEmpty = 0;
  const spreads: number[] = [];
  let bidOrders = 0;
  let askOrders = 0;
  let trades = 0;
  let volume = 0;
  let open: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  let close: number | null = null;
  let largestSweepSpan = 0;
  let largestMidMove = 0;
  let sweepsOver3Levels = 0;
  let marketOrders = 0;
  let marketOrdersOver2000 = 0;
  let noLiquidityRejections = 0;
  const tradedMinutes = new Set<number>();
  let midBefore: number | null = null;

  const sim: Simulation = new Simulation({
    seed,
    agents: [...noiseTraders(40, 0.5, opts.noise ?? DEFAULT_NOISE_PARAMS), ...reportMarketMakers(opts)],
    observer: {
      onArrival: () => {
        const bid = sim.engine.book.bestBid();
        const ask = sim.engine.book.bestAsk();
        midBefore = bid !== null && ask !== null ? (bid + ask) / 2 : null;
      },
      onSubmit: (_agent, order, result, time) => {
        if (order.type === "market") {
          marketOrders++;
          if (order.qty > 2_000) marketOrdersOver2000++;
        }
        if (!result.ok) {
          if (result.reason === "NO_LIQUIDITY") noLiquidityRejections++;
          return;
        }
        const prices = result.fills.map((f) => f.price);
        for (const f of result.fills) {
          trades++;
          volume += f.qty;
          open ??= f.price;
          low = low === null ? f.price : Math.min(low, f.price);
          high = high === null ? f.price : Math.max(high, f.price);
          close = f.price;
          tradedMinutes.add(Math.floor(time / 60_000));
        }
        if (prices.length > 0) largestSweepSpan = Math.max(largestSweepSpan, Math.abs(prices[prices.length - 1] - prices[0]));
        if (new Set(prices).size > 3) sweepsOver3Levels++;
        const bid = sim.engine.book.bestBid();
        const ask = sim.engine.book.bestAsk();
        if (midBefore !== null && bid !== null && ask !== null) largestMidMove = Math.max(largestMidMove, Math.abs((bid + ask) / 2 - midBefore));
      },
      onTickEnd: () => {
        const book = sim.engine.book;
        const bid = book.bestBid();
        const ask = book.bestAsk();
        if (bid === null) bidEmpty++;
        if (ask === null) askEmpty++;
        if (bid === null || ask === null) eitherEmpty++;
        else spreads.push(ask - bid);
        for (const [side, price] of [["buy", bid], ["sell", ask]] as const) {
          if (price === null) continue;
          const atBest = book.ordersAt(side, price);
          const mm = atBest.filter((o) => o.agentType === "marketMaker");
          if (mm.length > 0) {
            if (side === "buy") mmAtBid++;
            else mmAtAsk++;
          }
          bestQty += atBest.reduce((s, o) => s + o.qty, 0);
          mmBestQty += mm.reduce((s, o) => s + o.qty, 0);
        }
        for (let i = 1; i <= (opts.marketMakers ?? []).length; i++) mmMaxAbsPosition = Math.max(mmMaxAbsPosition, Math.abs(sim.positionOf(`mm-${i}`)));
        const count = (side: Side) => book.depth(side).reduce((s, l) => s + l.orderCount, 0);
        bidOrders += count("buy");
        askOrders += count("sell");
      },
    },
  });
  sim.run(ticks);
  const finalBid = sim.engine.book.bestBid();
  const finalAsk = sim.engine.book.bestAsk();
  const finalMid = finalBid !== null && finalAsk !== null ? (finalBid + finalAsk) / 2 : (sim.lastTradePrice ?? sim.startPrice);
  const mmPnl: Record<string, number> = {};
  for (let i = 1; i <= (opts.marketMakers ?? []).length; i++) mmPnl[`mm-${i}`] = sim.cashOf(`mm-${i}`) + sim.positionOf(`mm-${i}`) * finalMid;

  const minutes = Math.ceil((ticks * 100) / 60_000);
  return {
    ticks,
    bidEmptyShare: bidEmpty / ticks,
    askEmptyShare: askEmpty / ticks,
    eitherEmptyShare: eitherEmpty / ticks,
    avgSpread: spreads.length ? spreads.reduce((s, x) => s + x, 0) / spreads.length : NaN,
    medianSpread: median(spreads),
    avgBidOrders: bidOrders / ticks,
    avgAskOrders: askOrders / ticks,
    trades,
    volume,
    open,
    low,
    high,
    close,
    largestSweepSpan,
    largestMidMove,
    sweepsOver3Levels,
    marketOrders,
    marketOrdersOver2000,
    noLiquidityRejections,
    minutesWithoutTrades: minutes - tradedMinutes.size,
    mmAtBestBidShare: mmAtBid / ticks,
    mmAtBestAskShare: mmAtAsk / ticks,
    mmShareOfBestQty: bestQty > 0 ? mmBestQty / bestQty : 0,
    mmPnl,
    mmFills: sim.engine.fills.filter((f) => f.buy.agentType === "marketMaker" || f.sell.agentType === "marketMaker").length,
    mmMaxAbsPosition,
  };
}
