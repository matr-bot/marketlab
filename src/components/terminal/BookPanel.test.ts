import { describe, expect, it } from "vitest";
import { levelsPerSide, ordersBeyond } from "./BookPanel";

describe("levelsPerSide: BOOK shows the same number of levels on both sides", () => {
  it("fills the height: header and spread take a row each, the rest splits evenly", () => {
    expect(levelsPerSide(16 * 42, 40, 40)).toEqual({ asks: 20, bids: 20 }); // 42 rows: 2 fixed + 20 + 20
    expect(levelsPerSide(16 * 43 - 1, 40, 40)).toEqual({ asks: 20, bids: 20 }); // a partial row is absorbed by stretching
    expect(levelsPerSide(16 * 44, 40, 40)).toEqual({ asks: 21, bids: 21 });
  });

  it("is capped by the thinner side, so both sides always match", () => {
    expect(levelsPerSide(2_000, 40, 12)).toEqual({ asks: 12, bids: 12 });
    expect(levelsPerSide(2_000, 7, 40)).toEqual({ asks: 7, bids: 7 });
  });

  it("shows at least one level per side in a tiny panel", () => {
    expect(levelsPerSide(10, 40, 40)).toEqual({ asks: 1, bids: 1 });
  });

  it("never blanks the panel on a one-sided book: the other side still shows (found in a FED crash)", () => {
    expect(levelsPerSide(16 * 42, 0, 33)).toEqual({ asks: 0, bids: 20 });
    expect(levelsPerSide(16 * 42, 5, 0)).toEqual({ asks: 5, bids: 0 });
    expect(levelsPerSide(16 * 42, 0, 0)).toEqual({ asks: 0, bids: 0 });
  });
});

describe("ordersBeyond: the student's orders not at a level shown (QA #8)", () => {
  const lv = (price: number) => ({ price, qty: 100, orderCount: 1 });
  const asks = [lv(18_705), lv(18_706)];
  const bids = [lv(18_704), lv(18_703)];
  it("an order at a shown level is marked there, not listed; one further out is listed", () => {
    const orders = [
      { id: "MLAB-1", side: "sell" as const, price: 18_706, qty: 100 },
      { id: "MLAB-2", side: "sell" as const, price: 18_720, qty: 100 },
      { id: "MLAB-3", side: "buy" as const, price: 18_690, qty: 50 },
    ];
    expect(ordersBeyond(orders, asks, bids).map((o) => o.id)).toEqual(["MLAB-2", "MLAB-3"]);
  });
  it("matches side and price: a buy at an ask's price is not 'shown'", () => {
    expect(ordersBeyond([{ id: "MLAB-4", side: "buy", price: 18_705, qty: 1 }], asks, bids)).toHaveLength(1);
  });
});
