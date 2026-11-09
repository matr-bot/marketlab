import { describe, expect, it } from "vitest";
import { createDemoMarket, WARMUP_TICKS } from "./demoMarket";
import type { Simulation } from "./simulation";

// A resting order of the student's that someone else fills later is announced (QA #2): one "fill"
// event per agent order that hit it, partial until it is gone, then filled.

const warm = (): Simulation => {
  const sim = createDemoMarket(187);
  sim.run(WARMUP_TICKS);
  return sim;
};

/** Rest a sell limit of `qty` at the best ask (joining the queue there), and run until the book has taken it all. */
function restAndWait(qty: number) {
  const sim = warm();
  const price = sim.engine.book.bestAsk()!;
  sim.submitUserOrder({ type: "limit", side: "sell", price, qty });
  sim.step();
  expect(sim.userEvents.at(-1)).toMatchObject({ kind: "order", status: "resting", restingQty: qty });
  for (let i = 0; i < 6_000 && sim.desk.openOrders.length > 0; i++) sim.step();
  expect(sim.desk.openOrders).toEqual([]);
  return { sim, price };
}

describe("fills of the student's resting orders are announced", () => {
  it("a small order: one 'filled' event, at its own price, with the position to match", () => {
    const { sim, price } = restAndWait(100);
    const fills = sim.userEvents.filter((e) => e.kind === "fill");
    expect(fills.at(-1)).toMatchObject({ kind: "fill", source: "manual", side: "sell", orderType: "limit", requestedQty: 100, limitPrice: price, status: "filled", filledQty: 100, avgPrice: price, restingQty: 0 });
    expect(sim.desk.position).toBe(-100);
    expect(fills[0].ref).toBe(sim.userEvents[0].ref); // the same order the "resting" event announced
  });

  it("a big order fills in parts: 'partial' with what is filled and what still rests, then 'filled'", () => {
    const { sim } = restAndWait(3_000);
    const fills = sim.userEvents.filter((e) => e.kind === "fill");
    expect(fills.length).toBeGreaterThan(1);
    for (let i = 0; i < fills.length - 1; i++) {
      expect(fills[i].status).toBe("partial");
      expect(fills[i].filledQty + fills[i].restingQty).toBe(3_000);
      expect(fills[i + 1].filledQty).toBeGreaterThan(fills[i].filledQty);
    }
    expect(fills.at(-1)).toMatchObject({ status: "filled", filledQty: 3_000, restingQty: 0 });
  });

  it("a cancelled order is never announced as filled later", () => {
    const sim = warm();
    sim.submitUserOrder({ type: "limit", side: "sell", price: sim.engine.book.bestAsk()!, qty: 100 });
    sim.step();
    sim.cancelUserOrders();
    sim.step();
    sim.run(3_000);
    expect(sim.userEvents.filter((e) => e.kind === "fill")).toEqual([]);
  });
});
