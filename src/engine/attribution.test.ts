import { describe, expect, it } from "vitest";
import { attribute, topType, wholePercents, type AttributableFill } from "./attribution";
import { createDemoMarket } from "./demoMarket";
import { presetByCode } from "./presets";
import { Rng } from "./rng";
import type { AgentType } from "./types";

const fill = (time: number, qty: number, aggressor: "buy" | "sell", buyer: AgentType, seller: AgentType): AttributableFill => ({
  time,
  qty,
  aggressor,
  buy: { agentType: buyer },
  sell: { agentType: seller },
});

describe("wholePercents: whole numbers that always add up to exactly 100 (D-054)", () => {
  it("rounds by largest remainder: 1/3 each → 34, 33, 33 (ties by name)", () => {
    expect(wholePercents({ panic: 1, noise: 1, value: 1 })).toEqual({ noise: 34, panic: 33, value: 33 });
  });

  it("is exact when the shares divide evenly, and ignores types with no shares", () => {
    expect(wholePercents({ panic: 62, noise: 38, value: 0 })).toEqual({ panic: 62, noise: 38 });
    expect(wholePercents({})).toEqual({});
  });

  it("sums to 100 on 5,000 random splits, each within 1 point of the exact share", () => {
    const rng = Rng.fromSeed(5);
    const types: AgentType[] = ["noise", "marketMaker", "value", "panic", "user"];
    for (let i = 0; i < 5_000; i++) {
      const counts: Partial<Record<AgentType, number>> = {};
      for (const t of types) if (rng.uniform() < 0.7) counts[t] = rng.int(1, 5_000);
      const pct = wholePercents(counts);
      const total = Object.values(counts).reduce((s, n) => s + n!, 0);
      if (total === 0) continue;
      expect(Object.values(pct).reduce((s, n) => s + n!, 0)).toBe(100);
      for (const [t, n] of Object.entries(counts)) expect(Math.abs(pct[t as AgentType]! - (100 * n!) / total)).toBeLessThan(1);
    }
  });
});

describe("attribute: aggressive volume by trader type over a window", () => {
  const fills = [
    fill(1_000, 300, "sell", "noise", "panic"), // panic seller hit a bid
    fill(1_500, 200, "sell", "value", "value"), // value seller hit a value bid
    fill(2_000, 100, "buy", "noise", "marketMaker"), // noise buyer lifted a maker's ask
    fill(3_000, 999, "sell", "noise", "panic"), // outside the window [1,000, 3,000)
  ];

  it("counts the aggressor's shares by type, per side, in [from, to)", () => {
    const a = attribute(fills, 1_000, 3_000);
    expect(a.trades).toBe(3);
    expect(a.selling).toEqual({ shares: 500, byType: { panic: 300, value: 200 }, pct: { panic: 60, value: 40 } });
    expect(a.buying).toEqual({ shares: 100, byType: { noise: 100 }, pct: { noise: 100 } });
    expect(topType(a.selling)).toEqual({ type: "panic", pct: 60, shares: 300 });
  });

  it("says nothing for an empty window", () => {
    const a = attribute(fills, 10_000, 20_000);
    expect([a.trades, a.selling.shares, a.selling.pct, topType(a.selling)]).toEqual([0, 0, {}, null]);
  });

  it("matches a recount of the real fill log after FED, and the percentages add to 100", () => {
    const sim = createDemoMarket(187);
    sim.run(6_000);
    sim.applyShock(presetByCode("FED")!.shock, "FED");
    sim.run(600);
    const all = sim.engine.fills;
    const a = attribute(all, 600_000, 660_000);
    const recount = (s: "buy" | "sell") => all.filter((f) => f.time >= 600_000 && f.time < 660_000 && f.aggressor === s).reduce((t, f) => t + f.qty, 0);
    expect(a.selling.shares).toBe(recount("sell"));
    expect(a.buying.shares).toBe(recount("buy"));
    expect(Object.values(a.selling.byType).reduce((t, n) => t + n!, 0)).toBe(a.selling.shares);
    expect(Object.values(a.selling.pct).reduce((t, n) => t + n!, 0)).toBe(100);
    expect(a.selling.byType.panic).toBeGreaterThan(0); // the cascade shows up
    expect(a.selling.byType.value).toBeGreaterThan(0); // and the informed selling that started it
  });
});
