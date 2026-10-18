import { describe, expect, it } from "vitest";
import type { AgentContext, AgentSpec } from "./agents/agent";
import { createDemoMarket } from "./demoMarket";
import { dollars, Narrator, price, shares, type ChatMessage } from "./narrator";
import { presetByCode } from "./presets";
import { Simulation } from "./simulation";

/** Run `ticks` ticks with the narrator watching; collect everything it posts. */
function watch(sim: Simulation, n: Narrator, ticks: number, into: ChatMessage[]): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    n.onTick();
  }
  into.push(...n.take());
}

describe("formatting", () => {
  it("writes money, prices and shares exactly", () => {
    expect([dollars(2_928_100), dollars(-2_928_149), dollars(0), price(18_143.4), price(18_100), shares(21_957)]).toEqual(["$29,281", "$29,281", "$0", "$181.43", "$181.00", "21,957"]);
  });
});

describe("Narrator: FED on the demo market, seed 187 (D-055)", () => {
  const sim = createDemoMarket(187);
  const n = new Narrator(sim);
  const msgs: ChatMessage[] = [];
  watch(sim, n, 6_000, msgs);
  sim.applyShock(presetByCode("FED")!.shock, "FED");
  watch(sim, n, 3_000, msgs);
  const shock = sim.shocks[0];
  const after = msgs.filter((m) => m.time > shock.time);

  it("tells the whole story: the headline at once, then panic start and peak, informed flow, spread, recovery and the first minute", () => {
    expect(after[0].kind).toBe("headline");
    expect(after[0].time).toBe(shock.time + 100); // the end of the tick the headline landed in
    expect(after.slice(1, 7).map((m) => m.kind).sort()).toEqual(["flow", "impact", "panic", "panic", "recovery", "spread"]);
    const panics = after.filter((m) => m.kind === "panic");
    expect(panics[0].text).toMatch(/^Panic selling has started/);
    expect(panics[1].text).toMatch(/^Panic peaked/);
  });

  it("every number comes from the engine", () => {
    const text = (k: string) => after.find((m) => m.kind === k)!.text;
    expect(text("headline")).toBe(`FED · fair value -3.0%: value traders now price MLAB at ${price(shock.fairValueAfter)}.`);
    const fills = sim.engine.fills;
    const valueSold = fills.filter((f) => f.time >= shock.time && f.time < shock.time + 5_000 && f.aggressor === "sell" && f.sell.agentType === "value").reduce((t, f) => t + f.qty, 0);
    expect(text("flow")).toBe(`Value traders sold ${shares(valueSold)} shares in the first 5 s.`);
    const panicSellers = new Set(fills.filter((f) => f.time >= shock.time && f.aggressor === "sell" && f.sell.agentType === "panic").map((f) => f.sell.ownerId));
    expect(after.filter((m) => m.kind === "panic").at(-1)!.text).toBe(`Panic peaked: ${panicSellers.size} of 20 panic sellers sold into the drop.`);
    const pnl = sim.shockImpacts[0].pnlByType!;
    expect(pnl.marketMaker).toBeLessThan(0);
    expect(text("impact")).toBe(`First minute after FED: market makers lost ${dollars(pnl.marketMaker!)} to informed traders (adverse selection); value traders made ${dollars(pnl.value!)}.`);
  });

  it("posts at most one message per 4 s of sim time, except a headline, which posts at once", () => {
    for (let i = 1; i < msgs.length; i++) if (msgs[i].kind !== "headline") expect(msgs[i].time - msgs[i - 1].time).toBeGreaterThanOrEqual(4_000);
    expect(msgs.map((m) => m.seq)).toEqual(msgs.map((_, i) => i));
  });

  it("is deterministic: the same seed and headline give the same messages", () => {
    const again = createDemoMarket(187);
    const n2 = new Narrator(again);
    const msgs2: ChatMessage[] = [];
    watch(again, n2, 6_000, msgs2);
    again.applyShock(presetByCode("FED")!.shock, "FED");
    watch(again, n2, 3_000, msgs2);
    expect(msgs2).toEqual(msgs);
  });
});

describe("Narrator: a calm hour", () => {
  it("says the market is quiet about once a minute, with no panic or vacuum talk", () => {
    const sim = createDemoMarket(1);
    const n = new Narrator(sim);
    const msgs: ChatMessage[] = [];
    watch(sim, n, 36_000, msgs);
    const kinds = new Set(msgs.map((m) => m.kind));
    expect(kinds.has("panic") || kinds.has("vacuum") || kinds.has("headline")).toBe(false);
    const quiet = msgs.filter((m) => m.kind === "quiet").length;
    expect(quiet).toBeGreaterThanOrEqual(45);
    expect(quiet).toBeLessThanOrEqual(61);
    expect(msgs[0].text).toMatch(/^Quiet market: spread \d+\.\d¢, \d+\.\d trades a second, market makers at the best price \d+% of the time\.$/);
  }, 30_000);
});

describe("Narrator: liquidity vacuum", () => {
  it("reports how long a side of the book was empty, once it refills", () => {
    const scripted = (id: string, act: (ctx: AgentContext) => void): AgentSpec => ({ id, agentType: "user", ratePerSec: 10, create: () => ({ act }) });
    const sim = new Simulation({
      seed: 3,
      agents: [
        scripted("seller", (ctx) => void (ctx.myOrders().length === 0 && ctx.submit({ type: "limit", side: "sell", price: 18_710, qty: 100 }))),
        // Keeps a bid except between 10 s and 13 s of sim time.
        scripted("buyer", (ctx) => {
          const gap = ctx.time >= 10_000 && ctx.time < 13_000;
          const mine = ctx.myOrders();
          if (gap) for (const o of mine) ctx.cancel(o.id);
          else if (mine.length === 0) ctx.submit({ type: "limit", side: "buy", price: 18_690, qty: 100 });
        }),
      ],
    });
    const n = new Narrator(sim);
    const msgs: ChatMessage[] = [];
    watch(sim, n, 300, msgs);
    const v = msgs.filter((m) => m.kind === "vacuum");
    expect(v).toHaveLength(1);
    expect(v[0].text).toMatch(/^NO BIDS · liquidity vacuum for 3\.\d s\.$/);
  });
});
