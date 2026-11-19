import { describe, expect, it } from "vitest";
import { interpretStrategy, type ModelResult, type StrategyModelCall } from "./interpret";
import { OFFLINE_STRATEGY_HELP, parseStrategyOffline } from "./offlineStrategy";
import { LIMITS, RateLimiter, TtlCache } from "./rateLimit";
import { StrategyModelOutput, StrategyRequest, toStrategy, type StrategyParams } from "./schemas";

// Plain English → StrategySpec (D-064): the model's output is data from a fixed menu, clamped by the
// engine; when the AI is unavailable, simple phrasing is understood offline and labelled as such.

const DEMO = "Buy after a quick 3% drop because panic sellers overshoot";
const OUT: StrategyModelOutput = {
  expressible: "yes",
  entryRule: "buyAfterDrop",
  entryPercent: 3,
  windowSeconds: 60,
  stopLossPercent: 2,
  takeProfitPercent: 2,
  timeExitSeconds: 300,
  shares: 500,
  cooldownSeconds: 30,
  reason: "Panic selling pushes the price below value, then it recovers",
};
const DEMO_SPEC = { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 }, stopLossPct: 0.02, takeProfitPct: 0.02, timeExitSec: 300, qty: 500, cooldownSec: 30 };

function deps(callModel: StrategyModelCall | null, now = { t: 0 }) {
  let calls = 0;
  const counted: StrategyModelCall | null = callModel === null ? null : async (t) => (calls++, callModel(t));
  return { d: { callModel: counted, limiter: new RateLimiter(), cache: new TtlCache<StrategyParams>(), now: () => now.t }, calls: () => calls };
}
const always = (r: ModelResult<StrategyModelOutput>): StrategyModelCall => async () => r;

describe("the request and the model's output contract", () => {
  it("a strategy body has kind 'strategy' and 1 to 300 characters", () => {
    expect(StrategyRequest.safeParse({ kind: "strategy", text: DEMO }).success).toBe(true);
    expect(StrategyRequest.safeParse({ kind: "strategy", text: "  " }).success).toBe(false);
    expect(StrategyRequest.safeParse({ kind: "strategy", text: "x".repeat(301) }).success).toBe(false);
    expect(StrategyRequest.safeParse({ text: DEMO }).success).toBe(false);
  });

  it("the entry rule can only be one of the engine's four", () => {
    expect(StrategyModelOutput.safeParse(OUT).success).toBe(true);
    expect(StrategyModelOutput.safeParse({ ...OUT, entryRule: "buyTheRumor" }).success).toBe(false);
    expect(StrategyModelOutput.safeParse({ ...OUT, stopLossPercent: null }).success).toBe(true);
  });
});

describe("toStrategy: model output → clamped spec", () => {
  it("converts percents to fractions and keeps in-range values", () => {
    expect(toStrategy(OUT)).toEqual({ kind: "ok", params: { spec: DEMO_SPEC, reason: "Panic selling pushes the price below value, then it recovers" } });
  });

  it("clamps every number, whatever the model says (an injected '100% of the account, 10 million shares')", () => {
    const r = toStrategy({ ...OUT, entryPercent: 900, windowSeconds: 1e9, stopLossPercent: -5, takeProfitPercent: 400, timeExitSeconds: 0.2, shares: 1e7, cooldownSeconds: -1 });
    expect(r).toMatchObject({ kind: "ok", params: { spec: { entry: { pct: 0.2, windowSec: 300 }, stopLossPct: 0.001, takeProfitPct: 0.5, timeExitSec: 5, qty: 10_000, cooldownSec: 0 } } });
  });

  it("keeps exits the idea did not mention off, and adds the time exit only when none is on", () => {
    expect(toStrategy({ ...OUT, stopLossPercent: null, timeExitSeconds: null })).toMatchObject({ params: { spec: { stopLossPct: null, takeProfitPct: 0.02, timeExitSec: null } } });
    expect(toStrategy({ ...OUT, stopLossPercent: null, takeProfitPercent: null, timeExitSeconds: null })).toMatchObject({ params: { spec: { timeExitSec: 300 } } });
  });

  it("rejects non-finite numbers instead of guessing, and passes an inexpressible idea on as unsupported", () => {
    expect(toStrategy({ ...OUT, shares: Number.NaN })).toBeNull();
    expect(toStrategy({ ...OUT, stopLossPercent: Number.POSITIVE_INFINITY })).toBeNull();
    expect(toStrategy({ ...OUT, expressible: "no", reason: "Needs a 50-day moving average" })).toEqual({ kind: "unsupported", reason: "Needs a -day moving average" });
  });
});

describe("parseStrategyOffline: simple phrasing only, never a guess", () => {
  it("reads the demo sentence: 'sellers' is not a sell, 'quick' takes the 60 s default window", () => {
    expect(parseStrategyOffline(DEMO)).toEqual(DEMO_SPEC);
  });

  it("reads a side, a direction, a percent, a window, exits and a size", () => {
    expect(parseStrategyOffline("Short after a 2.5% rally within 90 seconds, stop loss 1%, take profit 3%, 1,000 shares")).toEqual({
      entry: { rule: "sellAfterRise", pct: 0.025, windowSec: 90 },
      stopLossPct: 0.01,
      takeProfitPct: 0.03,
      timeExitSec: null,
      qty: 1_000,
      cooldownSec: 30,
    });
    expect(parseStrategyOffline("buy when it jumps 1% in 2 minutes and hold for 5 min")).toMatchObject({ entry: { rule: "buyAfterRise", pct: 0.01, windowSec: 120 }, stopLossPct: null, takeProfitPct: null, timeExitSec: 300 });
    expect(parseStrategyOffline("Sell after a 4 percent drop")).toMatchObject({ entry: { rule: "sellAfterDrop", pct: 0.04 } });
    expect(parseStrategyOffline("buy the sell-off of 3%")).toMatchObject({ entry: { rule: "buyAfterDrop" } }); // buy comes first
  });

  it("does not read an exit's percent as the entry's", () => {
    expect(parseStrategyOffline("stop loss 1%, buy after a 5% dip")).toMatchObject({ entry: { pct: 0.05 }, stopLossPct: 0.01 });
  });

  it("gives null when it cannot read the idea clearly", () => {
    for (const text of ["buy the dip", "Buy when the CEO tweets", "drops 3%", "buy after a 3% drop and a 2% rise", "hello"]) expect(parseStrategyOffline(text), text).toBeNull();
  });

  it("clamps what it reads", () => {
    expect(parseStrategyOffline("buy after a 90% drop, 99999 shares")).toMatchObject({ entry: { pct: 0.2 }, qty: 10_000 });
  });
});

describe("interpretStrategy: every path (D-064)", () => {
  it("returns the AI's clamped spec, and caches it", async () => {
    const { d, calls } = deps(always({ kind: "ok", output: OUT }));
    expect(await interpretStrategy(DEMO, "ip", d)).toEqual({ ok: true, source: "ai", text: DEMO, strategy: { spec: DEMO_SPEC, reason: OUT.reason } });
    expect(await interpretStrategy(`  ${DEMO.toUpperCase()} `, "ip", d)).toMatchObject({ source: "cache", strategy: { spec: DEMO_SPEC } });
    expect(calls()).toBe(1);
  });

  it("an idea the menu cannot express gets a friendly message, no spec, and is not cached", async () => {
    const { d, calls } = deps(always({ kind: "ok", output: { ...OUT, expressible: "no", reason: "Needs news about the CEO." } }));
    const r = await interpretStrategy("Buy when the CEO tweets", "ip", d);
    expect(r).toEqual({ ok: true, source: "ai", text: "Buy when the CEO tweets", strategy: null, message: "The rule menu can't express that yet. Needs news about the CEO. Try: buy (or sell) after a drop (or rise) of X% within N seconds, with a stop loss, take profit or time exit." });
    await interpretStrategy("Buy when the CEO tweets", "ip", d);
    expect(calls()).toBe(2);
  });

  it("with no API key, simple phrasing is understood offline, labelled offline, never as the AI", async () => {
    const { d } = deps(null);
    expect(await interpretStrategy(DEMO, "ip", d)).toEqual({ ok: true, source: "offline", text: DEMO, strategy: { spec: DEMO_SPEC, reason: "" }, message: "AI unavailable · understood offline from simple phrasing. Check every rule before you start it." });
    expect(await interpretStrategy("buy the dip", "ip", d)).toEqual({ ok: true, source: "offline", text: "buy the dip", strategy: null, message: OFFLINE_STRATEGY_HELP });
  });

  it.each([
    ["refusal", { kind: "refusal" } as const],
    ["truncated", { kind: "truncated" } as const],
    ["invalid", { kind: "invalid" } as const],
    ["error (timeout, network, API)", { kind: "error", detail: "api 529" } as const],
  ])("a %s falls back offline", async (_, result) => {
    const { d } = deps(always(result));
    expect(await interpretStrategy(DEMO, "ip", d)).toMatchObject({ source: "offline", strategy: { spec: DEMO_SPEC } });
  });

  it("a thrown call or non-finite numbers fall back offline, never crash", async () => {
    expect(await interpretStrategy(DEMO, "ip", deps(async () => Promise.reject(new Error("boom"))).d)).toMatchObject({ source: "offline" });
    expect(await interpretStrategy(DEMO, "ip", deps(always({ kind: "ok", output: { ...OUT, entryPercent: Number.NaN } })).d)).toMatchObject({ source: "offline" });
  });

  it("over the rate limit, says the AI is rate-limited and still understands simple phrasing offline (D-092)", async () => {
    const { d, calls } = deps(always({ kind: "ok", output: OUT }));
    for (let i = 0; i < LIMITS.perIpPerMinute; i++) await interpretStrategy(`buy after a ${i + 1}% drop`, "ip", d);
    const r = await interpretStrategy("sell after a 2% rise", "ip", d);
    expect(r).toMatchObject({ source: "offline", strategy: { spec: { entry: { rule: "sellAfterRise" } } } });
    expect((r as { message: string }).message).toMatch(/^AI rate-limited · understood offline/);
    expect(calls()).toBe(LIMITS.perIpPerMinute);
  });
});
