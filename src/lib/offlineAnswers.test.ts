import { describe, expect, it } from "vitest";
import { offlineHeadline, offlineStrategy } from "./interpret";
import { OFFLINE_STRATEGY_HELP } from "./offlineStrategy";

// D-092: the offline answers, shared by the route (its own limiter, no key, errors) and the browser
// (no network, or the firewall's 429 before the route), so the wording is the same on both paths.
describe("offline answers: rate-limited vs unavailable (D-092)", () => {
  it("a rate-limited strategy says so and is still understood offline", () => {
    const r = offlineStrategy("Buy after a 3% drop within 60 seconds, stop loss 2%", "rate-limited");
    expect(r).toMatchObject({ ok: true, source: "offline", strategy: { spec: { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 } } } });
    expect((r as { message: string }).message).toBe("AI rate-limited · understood offline from simple phrasing. Check every rule before you start it.");
  });

  it("a rate-limited strategy the offline parser cannot read gets the help, with the rate-limited prefix", () => {
    const r = offlineStrategy("do something clever", "rate-limited");
    expect(r).toMatchObject({ source: "offline", strategy: null });
    expect((r as { message: string }).message).toBe(OFFLINE_STRATEGY_HELP.replace(/^AI unavailable/, "AI rate-limited"));
  });

  it("an unavailable AI keeps the wording it had", () => {
    expect((offlineStrategy("do something clever", "unavailable") as { message: string }).message).toBe(OFFLINE_STRATEGY_HELP);
    expect((offlineStrategy("Buy after a 3% drop within 60 seconds", "unavailable") as { message: string }).message).toBe("AI unavailable · understood offline from simple phrasing. Check every rule before you start it.");
  });

  it("a rate-limited headline maps to its offline preset on a clear match, with the rate-limited prefix", () => {
    const r = offlineHeadline("Fed hikes rates by 75bps", "rate-limited");
    expect(r).toMatchObject({ ok: true, source: "offline", preset: "FED" });
    expect((r as { message: string }).message).toMatch(/^AI rate-limited · /);
    expect((offlineHeadline("Aliens land in Ohio", "rate-limited") as { message: string }).message).toMatch(/^AI rate-limited · /);
  });
});
