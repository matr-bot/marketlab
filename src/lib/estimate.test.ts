import { describe, expect, it } from "vitest";
import type { DepthLevel } from "@/engine/types";
import { estimateMarketFill } from "./estimate";

const asks: DepthLevel[] = [
  { price: 18_701, qty: 100, orderCount: 1 },
  { price: 18_702, qty: 200, orderCount: 2 },
  { price: 18_705, qty: 300, orderCount: 1 },
];
const bids: DepthLevel[] = [
  { price: 18_699, qty: 100, orderCount: 1 },
  { price: 18_698, qty: 400, orderCount: 3 },
];

describe("estimateMarketFill: walks the shown book like the matching engine", () => {
  it("a buy inside the first level pays that level's price, against a mid of 187.00", () => {
    expect(estimateMarketFill(asks, 60, "buy", 18_700)).toEqual({ filledQty: 60, avgPrice: 18_701, worstPrice: 18_701, slippageCents: 1, shortBy: 0, bookExhausted: false });
  });

  it("a buy that sweeps two levels averages them: 100 @ 187.01 + 150 @ 187.02", () => {
    const e = estimateMarketFill(asks, 250, "buy", 18_700);
    expect(e.filledQty).toBe(250);
    expect(e.avgPrice).toBeCloseTo((100 * 18_701 + 150 * 18_702) / 250, 9);
    expect(e.worstPrice).toBe(18_702);
    expect(e.slippageCents).toBeCloseTo(1.6, 9);
  });

  it("a sell walks down the bids and its cost is how far below the mid it averages", () => {
    const e = estimateMarketFill(bids, 300, "sell", 18_700);
    expect(e.avgPrice).toBeCloseTo((100 * 18_699 + 200 * 18_698) / 300, 9);
    expect(e.slippageCents).toBeCloseTo(18_700 - (100 * 18_699 + 200 * 18_698) / 300, 9);
    expect(e.slippageCents!).toBeGreaterThan(0);
  });

  it("an order bigger than a short book says the rest would be cancelled", () => {
    expect(estimateMarketFill(asks, 1_000, "buy", 18_700)).toMatchObject({ filledQty: 600, shortBy: 400, bookExhausted: true, worstPrice: 18_705 });
  });

  it("an order bigger than a full set of shown levels may still fill beyond them", () => {
    const e = estimateMarketFill(asks, 1_000, "buy", 18_700, 3); // 3 levels sent, 3 shown: there may be more
    expect(e).toMatchObject({ shortBy: 400, bookExhausted: false });
  });

  it("an empty side fills nothing and has no price", () => {
    expect(estimateMarketFill([], 100, "buy", null)).toEqual({ filledQty: 0, avgPrice: null, worstPrice: null, slippageCents: null, shortBy: 100, bookExhausted: true });
  });

  it("without a mid there is no slippage figure, but the average still is", () => {
    expect(estimateMarketFill(asks, 50, "buy", null)).toMatchObject({ avgPrice: 18_701, slippageCents: null });
  });
});

describe("estimateMarketFill agrees with the real engine when the book has not changed", () => {
  it("predicts the exact filled quantity and average price of market orders, buying and selling", async () => {
    const { MarketFeed } = await import("@/engine/feed");
    const { createScenarioMarket, scenarioById } = await import("@/engine/scenarios");
    const sc = scenarioById("free")!;
    for (const seed of [187, 11, 12]) {
      for (const [side, qty] of [["buy", 700], ["sell", 700], ["buy", 6_000], ["sell", 4_000]] as const) {
        const feed = new MarketFeed(createScenarioMarket(sc, seed), seed);
        feed.advance(137); // somewhere into the session
        const frame = feed.frame();
        const mid = (frame.bid! + frame.ask!) / 2;
        const estimate = estimateMarketFill(side === "buy" ? frame.asks : frame.bids, qty, side, mid);
        feed.submitOrder({ type: "market", side, qty });
        feed.advance(1); // the order runs at the start of this tick, before any agent acts
        const event = feed.frame().userEvents[0];
        expect(event.filledQty, `${seed} ${side} ${qty}`).toBe(estimate.filledQty);
        expect(event.avgPrice, `${seed} ${side} ${qty}`).toBe(estimate.avgPrice);
      }
    }
  });
});
