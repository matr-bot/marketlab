import { describe, expect, it } from "vitest";
import type { UserEvent } from "@/engine/simulation";
import { formatUserEvent } from "./userMessages";

const base: UserEvent = {
  seq: 0, ref: 0, time: 0, kind: "order", side: "buy", orderType: "market", requestedQty: 500, limitPrice: null,
  status: "filled", filledQty: 500, avgPrice: 18_701.3333, restingQty: 0, cancelledQty: 0, reason: null, message: "",
};

describe("formatUserEvent", () => {
  it("a filled market order", () => {
    expect(formatUserEvent(base)).toBe("BUY 500 filled @ 187.01");
  });

  it("a limit order says its price; a resting one explains what resting means", () => {
    expect(formatUserEvent({ ...base, orderType: "limit", limitPrice: 18_650, status: "resting", filledQty: 0, avgPrice: null, restingQty: 500 })).toBe(
      "BUY 500 @ 186.50 is resting in the book until the market trades at your price.",
    );
  });

  it("a market order the book could only part-fill says the rest was cancelled and why", () => {
    expect(formatUserEvent({ ...base, requestedQty: 50_000, status: "partial", filledQty: 17_512, avgPrice: 18_713.5, cancelledQty: 32_488 })).toBe(
      "BUY 17,512 of 50,000 filled @ 187.14; 32,488 cancelled: the book ran out of shares to trade against.",
    );
  });

  it("a limit order that part-filled and rested", () => {
    expect(formatUserEvent({ ...base, side: "sell", orderType: "limit", limitPrice: 18_700, requestedQty: 1_000, status: "partial", filledQty: 400, avgPrice: 18_700, restingQty: 600 })).toBe(
      "SELL 400 of 1,000 filled @ 187.00; 600 resting in the book.",
    );
  });

  it("a rejection shows the engine's reason; a cancel shows its own message", () => {
    expect(formatUserEvent({ ...base, status: "rejected", filledQty: 0, avgPrice: null, reason: "POSITION_LIMIT", message: "That would take your position past 500,000 shares." })).toBe(
      "BUY 500 rejected: That would take your position past 500,000 shares.",
    );
    expect(formatUserEvent({ ...base, kind: "cancel", side: null, orderType: null, status: "cancelled", message: "Cancelled 2 open orders." })).toBe("Cancelled 2 open orders.");
  });

  it("a market order with nothing to trade against", () => {
    expect(formatUserEvent({ ...base, side: "sell", status: "cancelled", filledQty: 0, avgPrice: null, cancelledQty: 500, message: "Nothing to trade against: the order was cancelled." })).toBe(
      "SELL 500: Nothing to trade against: the order was cancelled.",
    );
  });
});
