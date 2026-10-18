import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext, AgentSpec } from "./agents/agent";
import { createDemoMarket } from "./demoMarket";
import { dollars, Narrator, price, shares, type ChatMessage } from "./narrator";
import { presetByCode } from "./presets";
import { Simulation } from "./simulation";

/** Whole-market narrator runs skip themselves in mutation runs (D-028); the rule tests below cover the logic. */
const MUTATION_RUN = process.env.MARKETLAB_MUTATION === "1";

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

describe.skipIf(MUTATION_RUN)("Narrator: FED on the demo market, seed 187 (D-055)", () => {
  // Built in beforeAll, not in the describe body: a skipped suite must not run the market at all.
  const sim = createDemoMarket(187);
  const msgs: ChatMessage[] = [];
  let shock: Simulation["shocks"][number];
  let after: ChatMessage[] = [];
  beforeAll(() => {
    const n = new Narrator(sim);
    watch(sim, n, 6_000, msgs);
    sim.applyShock(presetByCode("FED")!.shock, "FED");
    watch(sim, n, 3_000, msgs);
    shock = sim.shocks[0];
    after = msgs.filter((m) => m.time > shock.time);
  });

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

describe.skipIf(MUTATION_RUN)("Narrator: a calm hour", () => {
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

// ---------------------------------------------------------------------------------------------
// Rule-by-rule tests against a fake simulation the test drives tick by tick (fast, exact).

type FakeFill = { time: number; qty: number; price: number; aggressor: "buy" | "sell"; buy: { agentType: string; ownerId: string }; sell: { agentType: string; ownerId: string } };

class FakeSim {
  now = 0;
  bid: number | null = 18_699;
  ask: number | null = 18_701;
  makerAtBest = { buy: false, sell: false };
  fills: FakeFill[] = [];
  shocks: Array<{ seq: number; time: number; label: string; shock: { fairValuePct: number }; fairValueBefore: number; fairValueAfter: number }> = [];
  shockImpacts: Array<{ seq: number; time: number; label: string; pnlByType: Record<string, number> | null }> = [];
  fv = 18_700;
  get clock() {
    return { now: this.now };
  }
  get engine() {
    return {
      book: {
        bestBid: () => this.bid,
        bestAsk: () => this.ask,
        ordersAt: (side: "buy" | "sell") => [{ agentType: this.makerAtBest[side] ? "marketMaker" : "noise" }],
      },
      fillCount: this.fills.length,
      fillsSince: (s: number) => this.fills.slice(s),
    };
  }
  get fundamental() {
    return { value: this.fv };
  }
  agentCountOfType() {
    return 20;
  }
}

function harness() {
  const sim = new FakeSim();
  const n = new Narrator(sim as unknown as Simulation);
  const posted: ChatMessage[] = [];
  const tick = (k = 1) => {
    for (let i = 0; i < k; i++) {
      sim.now += 100;
      n.onTick();
      posted.push(...n.take());
    }
  };
  const fill = (qty: number, aggressor: "buy" | "sell", taker: string, owner = `${taker}-1`, price = 18_700) => {
    const maker = { agentType: "noise", ownerId: "noise-1" };
    const t = { agentType: taker, ownerId: owner };
    sim.fills.push({ time: sim.now, qty, price, aggressor, buy: aggressor === "buy" ? t : maker, sell: aggressor === "sell" ? t : maker });
  };
  const headline = (label: string, pct: number, before = sim.fv) => {
    const after = before * (1 + pct);
    sim.shocks.push({ seq: sim.shocks.length, time: sim.now, label, shock: { fairValuePct: pct }, fairValueBefore: before, fairValueAfter: after });
    sim.shockImpacts.push({ seq: sim.shockImpacts.length, time: sim.now, label, pnlByType: null });
    sim.fv = after;
  };
  return { sim, n, posted, tick, fill, headline };
}
const kinds = (ms: ChatMessage[]) => ms.map((m) => m.kind);

describe("Narrator rules (fake simulation)", () => {
  it("headline: posts at once, with the sign and the new fair value", () => {
    const h = harness();
    h.tick(10);
    h.headline("BEAT", 0.04);
    h.tick();
    expect(h.posted.map((m) => [m.kind, m.time, m.text])).toEqual([["headline", 1_100, "BEAT · fair value +4.0%: value traders now price MLAB at $194.48."]]);
  });

  it("flow: value traders' shares on the news side in the first 5 s only; none → no message", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick();
    h.fill(1_000, "sell", "value");
    h.fill(500, "buy", "value"); // wrong side: not counted
    h.fill(700, "sell", "panic"); // not a value trader
    h.tick(48);
    h.fill(300, "sell", "value"); // at 4.9 s: counted
    h.tick();
    h.fill(9_999, "sell", "value"); // at 5.0 s: outside the window
    h.tick(60);
    expect(h.posted.find((m) => m.kind === "flow")!.text).toBe("Value traders sold 1,300 shares in the first 5 s.");
    const quiet = harness();
    quiet.headline("BEAT", 0.04);
    quiet.tick(80);
    expect(kinds(quiet.posted)).not.toContain("flow");
  });

  it("flow after good news counts buying", () => {
    const h = harness();
    h.headline("BEAT", 0.04);
    h.tick();
    h.fill(800, "buy", "value");
    h.tick(60);
    expect(h.posted.find((m) => m.kind === "flow")!.text).toBe("Value traders bought 800 shares in the first 5 s.");
  });

  it("panic: one 'started' at the first seller, one 'peaked' after 10 s with no new sellers, only after the headline", () => {
    const h = harness();
    h.fill(100, "sell", "panic", "panic-9"); // before any headline, at time 0: counted from the start
    h.tick(30);
    const early = h.posted.filter((m) => m.kind === "panic").map((m) => m.text);
    expect(early).toEqual(["Panic selling has started: 1 of 20 panic sellers triggered."]);
    h.headline("FED", -0.03); // a headline resets the count
    h.tick();
    h.fill(100, "sell", "panic", "panic-1");
    h.tick();
    h.fill(100, "sell", "panic", "panic-2");
    h.fill(100, "buy", "panic", "panic-3"); // buying back is not panic
    h.tick(99); // 9.9 s without a new seller: not yet
    expect(h.posted.filter((m) => m.kind === "panic")).toHaveLength(2);
    h.tick(5);
    const texts = h.posted.filter((m) => m.kind === "panic").map((m) => m.text);
    expect(texts).toEqual(["Panic selling has started: 1 of 20 panic sellers triggered.", "Panic selling has started: 1 of 20 panic sellers triggered.", "Panic peaked: 2 of 20 panic sellers sold into the drop."]);
    h.tick(200);
    expect(h.posted.filter((m) => m.kind === "panic")).toHaveLength(3); // peaked only once
  });

  it("panic: no 'peaked' when nobody joined after the first", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick();
    h.fill(100, "sell", "panic", "panic-1");
    h.tick(300);
    expect(h.posted.filter((m) => m.kind === "panic").map((m) => m.text)).toEqual(["Panic selling has started: 1 of 20 panic sellers triggered."]);
  });

  it("vacuum: reported when the side refills, only for 2 s or more, with the side and duration", () => {
    const h = harness();
    h.sim.bid = null;
    h.tick(19); // 1.9 s
    h.sim.bid = 18_699;
    h.tick();
    expect(kinds(h.posted)).not.toContain("vacuum");
    h.sim.ask = null;
    h.tick(25); // 2.5 s
    h.sim.ask = 18_701;
    h.tick();
    expect(h.posted.filter((m) => m.kind === "vacuum").map((m) => m.text)).toEqual(["NO ASKS · liquidity vacuum for 2.5 s."]);
    h.sim.bid = null;
    h.tick(20); // exactly 2.0 s
    h.sim.bid = 18_699;
    h.tick(50);
    expect(h.posted.filter((m) => m.kind === "vacuum").at(-1)!.text).toBe("NO BIDS · liquidity vacuum for 2.0 s.");
  });

  it("spread: needs the 2 s average ≥ 6¢ and ≥ 3× the 2 minutes before, then waits 60 s before another", () => {
    const h = harness();
    h.tick(1_200); // 2 minutes at 2¢
    h.sim.bid = 18_697;
    h.sim.ask = 18_702; // 5¢: below the 6¢ floor
    h.tick(30);
    expect(kinds(h.posted)).not.toContain("spread");
    h.sim.bid = 18_696;
    h.sim.ask = 18_703; // 7¢
    h.tick(30);
    const notes = h.posted.filter((m) => m.kind === "spread");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/^Spread widened from \d\.\d¢ to \d\.\d¢ over the last 2 s: market makers pulled back\.$/);
    h.tick(500); // still wide, but within 60 s of the last note… and then the average has caught up
    expect(h.posted.filter((m) => m.kind === "spread")).toHaveLength(1);
  });

  it("spread: not before 10 s of history", () => {
    const h = harness();
    h.tick(5);
    h.sim.bid = 18_680;
    h.sim.ask = 18_720;
    h.tick(30);
    expect(kinds(h.posted)).not.toContain("spread");
  });

  it("recovery: after an overshoot of at least 0.5% past fair value, once half of it is back", () => {
    const h = harness();
    h.headline("FED", -0.03); // fair value 18,139
    h.tick();
    const mid = (m: number) => {
      h.sim.bid = m - 1;
      h.sim.ask = m + 1;
    };
    mid(18_000); // 139 past fair value: 0.74% of 18,700
    h.tick();
    mid(18_060); // 60 of 139 back: not half yet
    h.tick();
    expect(kinds(h.posted)).not.toContain("recovery");
    mid(18_070); // 70 back: half
    h.tick(50); // its turn comes within 4 s
    expect(h.posted.find((m) => m.kind === "recovery")!.text).toBe("Value traders bought the overshoot: MLAB back to $180.70, fair value $181.39.");
    h.tick(100);
    expect(h.posted.filter((m) => m.kind === "recovery")).toHaveLength(1);
  });

  it("recovery: no message for a small overshoot (under 0.5%), and 'sold into the spike' after good news", () => {
    const small = harness();
    small.headline("FED", -0.03);
    small.tick();
    small.sim.bid = 18_099;
    small.sim.ask = 18_101; // 39 past fair value: 0.2%
    small.tick();
    small.sim.bid = 18_138;
    small.sim.ask = 18_140;
    small.tick(30);
    expect(kinds(small.posted)).not.toContain("recovery");
    const up = harness();
    up.headline("BEAT", 0.04); // 19,448
    up.tick();
    up.sim.bid = 19_599;
    up.sim.ask = 19_601; // 152 past
    up.tick();
    up.sim.bid = 19_519;
    up.sim.ask = 19_521; // 80 back
    up.tick(50);
    expect(up.posted.find((m) => m.kind === "recovery")!.text).toBe("Value traders sold into the spike: MLAB back to $195.20, fair value $194.48.");
  });

  it("first minute: posted once when the P&L arrives, with 'lost'/'made' by sign", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick(10);
    expect(kinds(h.posted)).not.toContain("impact");
    h.sim.shockImpacts[0].pnlByType = { marketMaker: -2_928_100, value: 10_232_000 };
    h.tick(2);
    h.sim.shockImpacts.push({ seq: 1, time: 0, label: "BEAT", pnlByType: { marketMaker: 150_000, value: -40_000 } }); // no matching headline: ignored
    h.tick(60);
    expect(h.posted.filter((m) => m.kind === "impact").map((m) => m.text)).toEqual([
      "First minute after FED: market makers lost $29,281 to informed traders (adverse selection); value traders made $102,320.",
    ]);
    const g = harness();
    g.headline("BEAT", 0.04);
    g.tick();
    g.sim.shockImpacts[0].pnlByType = { marketMaker: 150_000, value: -40_000 };
    g.tick(60);
    expect(g.posted.find((m) => m.kind === "impact")!.text).toBe("First minute after BEAT: market makers made $1,500; value traders lost $400.");
  });

  it("quiet: after 60 s with nothing else, the last minute's spread, trade rate and makers at the best price", () => {
    const h = harness();
    h.sim.makerAtBest = { buy: true, sell: false }; // a maker at one side half the time…
    for (let i = 0; i < 600; i++) {
      if (i % 10 === 0) h.fill(100, "buy", "noise");
      h.sim.makerAtBest = { buy: i % 2 === 0, sell: false };
      h.tick();
    }
    const q = h.posted.filter((m) => m.kind === "quiet");
    expect(q.map((m) => m.time)).toEqual([60_000]);
    // Spread 2¢ throughout; 60 fills in 60 s; one side has a maker on half the ticks → 25%.
    expect(q[0].text).toBe("Quiet market: spread 2.0¢, 1.0 trades a second, market makers at the best price 25% of the time.");
    h.tick(600);
    expect(h.posted.filter((m) => m.kind === "quiet").map((m) => m.time)).toEqual([60_000, 120_000]);
  });

  it("pacing: one message per 4 s; when more than 5 wait, the least important go first", () => {
    const h = harness();
    // Twenty 2-second vacuums back to back: one finished every 2.1 s, about twice the posting rate.
    for (let i = 0; i < 20; i++) {
      h.sim.bid = null;
      h.tick(20);
      h.sim.bid = 18_699;
      h.tick();
    }
    h.tick(400);
    const v = h.posted.filter((m) => m.kind === "vacuum");
    for (let i = 1; i < h.posted.length; i++) expect(h.posted[i].time - h.posted[i - 1].time).toBeGreaterThanOrEqual(4_000);
    expect(v.length).toBeLessThan(20); // some were dropped once more than 5 waited
    expect(v.length).toBeGreaterThanOrEqual(14);
    expect(h.posted.map((m) => m.seq)).toEqual(h.posted.map((_, i) => i));
  });
});

describe("Narrator rule boundaries (fake simulation)", () => {
  it("formats millions with separators", () => {
    expect([dollars(123_456_789_00), shares(1_234_567)]).toEqual(["$123,456,789", "1,234,567"]);
  });

  it("a headline skips the 4 s pace: it posts 0.1 s after a quiet note", () => {
    const h = harness();
    h.tick(600); // the quiet note posts at 60.0 s
    expect(h.posted.at(-1)!.kind).toBe("quiet");
    h.headline("FED", -0.03);
    h.tick();
    expect(h.posted.at(-1)!.kind).toBe("headline");
    expect(h.posted.at(-1)!.time - h.posted.at(-2)!.time).toBe(100);
  });

  it("when two messages wait, the more important posts first even if it came later", () => {
    const h = harness();
    h.tick(1_200);
    h.sim.makerAtBest = { buy: false, sell: false };
    // Spread note (priority 2) queues, then a panic start (priority 1) in the same 4 s window.
    h.headline("BEAT", 0.04); // posts at once and starts the 4 s pace
    h.tick();
    h.sim.bid = 18_690;
    h.sim.ask = 18_710;
    h.tick(20);
    h.fill(100, "sell", "panic", "panic-1");
    h.tick(60);
    const after = kinds(h.posted).slice(kinds(h.posted).indexOf("headline") + 1);
    expect(after.indexOf("panic")).toBeLessThan(after.indexOf("spread"));
  });

  it("flow counts fills from the headline's tick up to 5 s later, inclusive of the first tick", () => {
    const h = harness();
    h.fill(5_000, "sell", "value"); // before the headline: not counted
    h.tick();
    h.headline("FED", -0.03);
    h.fill(200, "sell", "value"); // same instant as the headline
    h.tick(49);
    h.fill(300, "sell", "value"); // at 4.9 s after the headline
    h.tick(60);
    expect(h.posted.find((m) => m.kind === "flow")!.text).toBe("Value traders sold 500 shares in the first 5 s.");
  });

  it("panic counts only panic sellers hitting bids", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick();
    h.fill(100, "sell", "noise", "noise-7");
    h.fill(100, "buy", "panic", "panic-1");
    h.tick(200);
    expect(kinds(h.posted)).not.toContain("panic");
  });

  it("spread: exactly 6¢ and exactly 3× the average count; 5.9¢ or 2.9× do not", () => {
    // The rule is checked on the 20th wide tick: the last 2 s are all wide and the 2 minutes
    // before are all narrow (one tick later, wide samples start entering the baseline).
    const at = (beforeSpread: number, nowSpread: number) => {
      const h = harness();
      h.sim.bid = 18_700 - beforeSpread;
      h.sim.ask = 18_700;
      h.tick(1_200);
      h.sim.bid = 18_700 - nowSpread;
      h.tick(20);
      h.sim.bid = 18_700 - beforeSpread;
      h.tick(60); // let it post
      return kinds(h.posted).includes("spread");
    };
    expect(at(2, 6)).toBe(true); // 6¢ and 3×
    expect(at(2, 5)).toBe(false); // under 6¢
    expect(at(3, 8)).toBe(false); // 8¢ but under 3× of 3¢
    expect(at(3, 9)).toBe(true); // exactly 3×
  });

  it("spread: needs 100 samples of history before and 15 in the last 2 s", () => {
    const h = harness();
    h.tick(110); // 11 s of 2¢: 90 samples older than 2 s
    h.sim.bid = 18_680;
    h.tick(1);
    expect(kinds(h.posted)).not.toContain("spread");
  });

  it("spread: a second note needs 60 s", () => {
    const h = harness();
    h.tick(1_200);
    h.sim.bid = 18_690;
    h.tick(30);
    h.sim.bid = 18_699;
    h.tick(1_200);
    h.sim.bid = 18_690;
    h.tick(30);
    expect(h.posted.filter((m) => m.kind === "spread")).toHaveLength(2);
  });

  it("recovery: exactly 0.5% overshoot and exactly half back count", () => {
    const h = harness();
    h.headline("FED", -0.03); // V 18,139, m0 18,700: 0.5% is 93.5¢
    h.tick();
    h.sim.fv = 18_139;
    h.sim.bid = 18_139 - 94 - 1;
    h.sim.ask = 18_139 - 94 + 1; // 94¢ past fair value
    h.tick();
    h.sim.bid = 18_139 - 47 - 1;
    h.sim.ask = 18_139 - 47 + 1; // exactly half back
    h.tick(50);
    expect(kinds(h.posted)).toContain("recovery");
  });

  it("first minute: zero is 'made' for value traders and 'made' for market makers", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick();
    h.sim.shockImpacts[0].pnlByType = { marketMaker: 0, value: 0 };
    h.tick(60);
    expect(h.posted.find((m) => m.kind === "impact")!.text).toBe("First minute after FED: market makers made $0; value traders made $0.");
  });

  it("first minute: matched to its own headline when several are open", () => {
    const h = harness();
    h.headline("FED", -0.03);
    h.tick(31);
    h.headline("CEO", -0.06);
    h.tick();
    h.sim.shockImpacts[1].pnlByType = { marketMaker: -100, value: 100 };
    h.tick(60);
    expect(h.posted.filter((m) => m.kind === "impact").map((m) => m.text)).toEqual(["First minute after CEO: market makers lost $1 to informed traders (adverse selection); value traders made $1."]);
  });

  it("quiet: ignores one-sided ticks in the spread and counts the maker at either side", () => {
    const h = harness();
    for (let i = 0; i < 600; i++) {
      h.sim.ask = i % 2 === 0 ? 18_701 : null; // half the ticks one-sided
      h.sim.makerAtBest = { buy: false, sell: true };
      h.tick();
    }
    h.sim.ask = 18_701;
    expect(h.posted.find((m) => m.kind === "quiet")!.text).toMatch(/^Quiet market: spread 2\.0¢, 0\.0 trades a second, market makers at the best price 25% of the time\.$/);
  });

  it("forgets finished headlines (bounded memory): flow, first minute and recovery done, or 10 minutes passed", () => {
    const h = harness();
    for (let i = 0; i < 30; i++) {
      h.headline(`H${i}`, -0.01);
      h.tick(31);
      h.sim.shockImpacts[i].pnlByType = { marketMaker: 0, value: 0 };
    }
    h.tick(7_000);
    const watches = (h.n as unknown as { watches: unknown[] }).watches;
    expect(watches).toHaveLength(0);
  });
});
