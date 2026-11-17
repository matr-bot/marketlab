import { describe, expect, it } from "vitest";
import { orderSlippageBps, type OrderReport } from "@/engine/executionReport";
import { costBps } from "./exrBps";

const order = (o: Partial<OrderReport>): OrderReport => ({ orderId: 1, side: "buy", time: 0, qty: 500, aggressiveQty: 500, avgPrice: 18697, arrivalMidX2: 37391, slippageX2: 1300, spreadX2: 500, impactX2: 800, passiveX2: 0, source: "user", ...o }) as OrderReport;

describe("costBps (D-072)", () => {
  it("is the engine's slippage bps for the whole slippage", () => {
    const r = order({});
    expect(costBps(r.slippageX2, r)).toBe(orderSlippageBps(r));
  });

  it("splits: spread bps + impact bps + resting bps = slippage bps", () => {
    const r = order({ slippageX2: 1500, spreadX2: 500, impactX2: 800, passiveX2: 200 });
    expect(costBps(r.spreadX2, r)! + costBps(r.impactX2, r)! + costBps(r.passiveX2, r)!).toBeCloseTo(costBps(r.slippageX2, r)!, 12);
  });

  it("is a cost relative to value: 1.3 cents a share on a $186.955 mid is about 0.7 bps", () => {
    expect(costBps(1300, { qty: 500, arrivalMidX2: 37391 })).toBeCloseTo((1.3 / 186.955) * 100, 9);
  });

  it("is null without an arrival mid, a cost or a quantity", () => {
    expect(costBps(null, { qty: 500, arrivalMidX2: 37391 })).toBeNull();
    expect(costBps(100, { qty: 500, arrivalMidX2: null })).toBeNull();
    expect(costBps(100, { qty: 0, arrivalMidX2: 37391 })).toBeNull();
  });
});
