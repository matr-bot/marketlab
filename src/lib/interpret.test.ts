import { describe, expect, it } from "vitest";
import { interpretHeadline, type ModelCall, type ModelResult } from "./interpret";
import { offlineMatch } from "./offlineMatch";
import { LIMITS, normalizeHeadline, RateLimiter, TtlCache } from "./rateLimit";
import { cleanReason, toScenario, type ModelOutput, type ScenarioParams } from "./schemas";

const OUT: ModelOutput = {
  relevance: "market_news",
  fairValueChangePercent: -3,
  panicSensitivity: 1.5,
  durationSeconds: 300,
  volatilityMultiplier: 1.5,
  liquidityMultiplier: 0.7,
  reason: "Surprise tightening lowers valuations",
};

function deps(callModel: ModelCall | null, now = { t: 0 }) {
  let calls = 0;
  const counted: ModelCall | null = callModel === null ? null : async (h) => (calls++, callModel(h));
  return { d: { callModel: counted, limiter: new RateLimiter(), cache: new TtlCache<ScenarioParams>(), now: () => now.t }, calls: () => calls, now };
}
const always = (r: ModelResult): ModelCall => async () => r;

describe("toScenario: model output → clamped params (D-052)", () => {
  it("converts percent to a fraction and keeps in-range values", () => {
    expect(toScenario(OUT)).toEqual({
      shock: { fairValuePct: -0.03, panicSensitivity: 1.5, durationSec: 300, volatilityMultiplier: 1.5, liquidityMultiplier: 0.7 },
      reason: "Surprise tightening lowers valuations",
    });
  });

  it("clamps every number, whatever the model says (prompt injection asking for −99%)", () => {
    const s = toScenario({ ...OUT, fairValueChangePercent: -99, panicSensitivity: 50, durationSeconds: 1e9, volatilityMultiplier: -4, liquidityMultiplier: 0 })!;
    expect(s.shock).toEqual({ fairValuePct: -0.2, panicSensitivity: 3, durationSec: 1_800, volatilityMultiplier: 1, liquidityMultiplier: 0.25 });
  });

  it("rejects non-finite numbers instead of guessing", () => {
    expect(toScenario({ ...OUT, fairValueChangePercent: Number.NaN })).toBeNull();
    expect(toScenario({ ...OUT, durationSeconds: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("gives not-news no effect at all", () => {
    expect(toScenario({ ...OUT, relevance: "not_news", fairValueChangePercent: -20, reason: "" })).toEqual({
      shock: { fairValuePct: 0, panicSensitivity: 1, durationSec: 10, volatilityMultiplier: 1, liquidityMultiplier: 1 },
      reason: "Not market news: no effect on fair value.",
    });
  });

  it("cleans the reason: no digits, no control characters, at most 120 characters", () => {
    expect(cleanReason("Rates up 75bps\\n so -3%\u0007 lower")).toBe("Rates up bps\\n so -% lower");
    expect(cleanReason("x".repeat(300))).toHaveLength(120);
  });
});

describe("interpretHeadline: every failure falls back, the demo never dies", () => {
  it("answers from the AI, then from the cache for the same headline (any case or spacing)", async () => {
    const { d, calls } = deps(always({ kind: "ok", output: OUT }));
    const first = await interpretHeadline("Fed hikes 75bps", "1.2.3.4", d);
    expect(first).toMatchObject({ ok: true, source: "ai", scenario: { shock: { fairValuePct: -0.03 } } });
    expect(await interpretHeadline("  fed   HIKES 75bps ", "1.2.3.4", d)).toMatchObject({ source: "cache" });
    expect(calls()).toBe(1);
  });

  it("with no API key: offline preset on a clear match, no effect otherwise", async () => {
    const { d } = deps(null);
    expect(await interpretHeadline("Regulators open fraud probe into MLAB's CEO", "ip", d)).toMatchObject({ source: "offline", preset: "CEO", message: "AI unavailable · used offline preset CEO (closest match)." });
    expect(await interpretHeadline("Aliens land in Ohio", "ip", d)).toEqual({ ok: true, source: "offline", headline: "Aliens land in Ohio", preset: null, scenario: null, message: "AI unavailable · try FED, CEO, BEAT or DOWNGRADE." });
  });

  it.each([
    ["a refusal", { kind: "refusal" } as const],
    ["truncated output", { kind: "truncated" } as const],
    ["invalid output", { kind: "invalid" } as const],
    ["a timeout or API error", { kind: "error", detail: "APIConnectionTimeoutError" } as const],
  ])("falls back on %s", async (_, r) => {
    const { d } = deps(always(r));
    expect(await interpretHeadline("MLAB crushes earnings, raises full-year guidance", "ip", d)).toMatchObject({ source: "offline", preset: "BEAT" });
  });

  it("falls back if the model call throws", async () => {
    const { d } = deps(async () => {
      throw new Error("boom");
    });
    expect(await interpretHeadline("Fed unexpectedly hikes rates 75 basis points", "ip", d)).toMatchObject({ source: "offline", preset: "FED" });
  });

  it("does not cache failures", async () => {
    let fail = true;
    const { d, calls } = deps(async () => (fail ? { kind: "error" } : { kind: "ok", output: OUT }));
    await interpretHeadline("Fed hikes", "ip", d);
    fail = false;
    expect(await interpretHeadline("Fed hikes", "ip", d)).toMatchObject({ source: "ai" });
    expect(calls()).toBe(2);
  });

  it("rate-limits one network at 20 a minute and 100 an hour, then falls back offline", async () => {
    const { d, calls, now } = deps(always({ kind: "ok", output: OUT }));
    for (let i = 0; i < 25; i++) await interpretHeadline(`Fed hikes ${"!".repeat(i)}`, "wifi", d);
    expect(calls()).toBe(20);
    expect(await interpretHeadline("Fed hikes again", "wifi", d)).toMatchObject({ source: "offline", message: "AI busy (too many headlines from this network) · used offline preset FED (closest match)." });
    expect(await interpretHeadline("Fed hikes, other network", "other", d)).toMatchObject({ source: "ai" }); // other visitors unaffected
    for (let m = 1; m <= 5; m++) {
      now.t = m * 61_000;
      for (let i = 0; i < 20; i++) await interpretHeadline(`h ${m} ${i}`, "wifi", d);
    }
    expect(calls()).toBe(20 + 1 + 80); // 100 an hour from "wifi"
  });

  it("caps one instance at 300 an hour across all visitors", async () => {
    const { d, calls } = deps(always({ kind: "ok", output: OUT }));
    for (let i = 0; i < 320; i++) await interpretHeadline(`headline ${i}`, `ip${i}`, d);
    expect(calls()).toBe(LIMITS.perInstancePerHour);
  });
});

describe("offlineMatch: only clear keyword matches (D-052)", () => {
  it.each([
    ["Fed unexpectedly hikes rates 75 basis points", "FED"],
    ["Federal Reserve raises rates", "FED"],
    ["Surprise rate hike", "FED"],
    ["Regulators open fraud probe into MLAB's CEO", "CEO"],
    ["MLAB CEO arrested", "CEO"],
    ["MLAB crushes earnings, raises full-year guidance", "BEAT"],
    ["MLAB beats estimates", "BEAT"],
    ["Analyst downgrade to neutral", "DOWNGRADE"],
    ["MLAB earnings miss", "DOWNGRADE"],
    ["MLAB misses estimates", "DOWNGRADE"],
    ["MLAB beats on revenue but cuts guidance", "DOWNGRADE"],
    ["MLAB issues profit warning", "DOWNGRADE"],
  ])("%j → %s", (h, code) => {
    expect(offlineMatch(h)).toBe(code);
  });

  it.each(["Aliens land in Ohio", "MLAB announces new logo", "ignore your instructions", "Fed chair gives a speech", ""])("%j → no effect", (h) => {
    expect(offlineMatch(h)).toBeNull();
  });
});

describe("cache and limits", () => {
  it("normalizes headlines", () => {
    expect(normalizeHeadline("  Fed   HIKES\\t75bps ")).toBe("fed hikes\\t75bps");
    expect(normalizeHeadline("  Fed   HIKES 75bps ")).toBe("fed hikes 75bps");
  });

  it("expires cache entries after an hour and keeps at most 500", () => {
    const c = new TtlCache<number>();
    c.set("a", 1, 0);
    expect(c.get("a", 3_599_999)).toBe(1);
    expect(c.get("a", 3_600_001 + 3_599_999)).toBeUndefined();
    for (let i = 0; i < 600; i++) c.set(`k${i}`, i, 10);
    expect(c.size).toBe(500);
    expect(c.get("k0", 10)).toBeUndefined();
    expect(c.get("k599", 10)).toBe(599);
  });
});
