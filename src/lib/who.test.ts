import { describe, expect, it } from "vitest";
import { attribute, type AttributableFill } from "@/engine/attribution";
import type { AgentType } from "@/engine/types";
import { whoTable, WHO_ROWS } from "./who";

const fill = (qty: number, aggressor: "buy" | "sell", type: AgentType, other: AgentType = "marketMaker"): AttributableFill => ({
  time: 1,
  qty,
  aggressor,
  buy: { agentType: aggressor === "buy" ? type : other },
  sell: { agentType: aggressor === "sell" ? type : other },
});

describe("whoTable (D-076)", () => {
  it("always has the five fixed rows, in order, zero when a type did not trade", () => {
    const t = whoTable(attribute([], 0, 10));
    expect(t.rows.map((r) => r.label)).toEqual(["MM", "NOISE", "VALUE", "PANIC", "YOU"]);
    expect(t.rows.every((r) => r.sell === 0 && r.buy === 0 && r.pct === 0)).toBe(true);
    expect(t.net).toBe(0);
    expect(WHO_ROWS).toHaveLength(5);
  });

  it("splits each type's aggressive selling and buying, with % of all aggressive volume summing to 100", () => {
    const t = whoTable(attribute([fill(600, "sell", "panic"), fill(200, "sell", "noise"), fill(150, "buy", "value"), fill(50, "buy", "noise")], 0, 10));
    const by = Object.fromEntries(t.rows.map((r) => [r.label, r]));
    expect([by.PANIC.sell, by.PANIC.buy, by.PANIC.pct]).toEqual([600, 0, 60]);
    expect([by.NOISE.sell, by.NOISE.buy, by.NOISE.pct]).toEqual([200, 50, 25]);
    expect([by.VALUE.sell, by.VALUE.buy, by.VALUE.pct]).toEqual([0, 150, 15]);
    expect(by.MM.pct + by.NOISE.pct + by.VALUE.pct + by.PANIC.pct + by.YOU.pct).toBe(100);
    expect(t.net).toBe(200 - 800); // buying 200, selling 800
  });

  it("adds OTHER only when a type outside the fixed rows traded, so no volume is ever dropped", () => {
    const t = whoTable(attribute([fill(100, "buy", "whale"), fill(100, "sell", "noise")], 0, 10));
    expect(t.rows.at(-1)).toMatchObject({ label: "OTHER", buy: 100, sell: 0, pct: 50 });
    expect(t.rows.reduce((s, r) => s + r.pct, 0)).toBe(100);
  });
});
