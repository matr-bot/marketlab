import { MatchingEngine } from "./matchingEngine";
import type { Cents } from "./types";

/** One MatchingEngine (and so one OrderBook) per ticker. Multi-stock ready from day one. */
export class MarketRegistry {
  private readonly markets = new Map<string, MatchingEngine>();

  /** Create a market. Throws on a bad or duplicate ticker: that is a setup bug, not order flow. */
  create(ticker: string, tickSize: Cents = 1): MatchingEngine {
    if (typeof ticker !== "string" || !/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) {
      throw new RangeError(`ticker must be 1-10 uppercase letters, digits or dots, starting with a letter, got ${JSON.stringify(ticker)}`);
    }
    if (this.markets.has(ticker)) throw new Error(`Market already exists: ${ticker}`);
    const engine = new MatchingEngine(ticker, tickSize);
    this.markets.set(ticker, engine);
    return engine;
  }

  get(ticker: string): MatchingEngine | undefined {
    return this.markets.get(ticker);
  }

  /** Tickers in creation order. */
  tickers(): string[] {
    return [...this.markets.keys()];
  }
}
