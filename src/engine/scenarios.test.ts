import { describe, expect, it } from "vitest";
import { buildOrderReports, totalExecution } from "./executionReport";
import { SHOCK_LIMITS } from "./fundamental";
import { createScenarioMarket, FREE_PLAY, MAX_SEED, parseSeed, resolveRun, runLink, SCENARIOS, scenarioById } from "./scenarios";
import { USER_ID, type Simulation } from "./simulation";
import { fingerprint } from "./testing/fingerprint";

const midOf = (sim: Simulation): number => {
  const b = sim.engine.book.bestBid();
  const a = sim.engine.book.bestAsk();
  if (b === null || a === null) throw new Error("one-sided book");
  return (a + b) / 2;
};
/** The mid `sec` seconds after the scenario opens, on a fresh run (the book can be one-sided for a moment in a crash; look a tick later). */
function midAt(id: string, sec: number): number {
  const sim = createScenarioMarket(scenarioById(id)!);
  sim.run(sec * 10);
  for (let i = 0; i < 100 && (sim.engine.book.bestBid() === null || sim.engine.book.bestAsk() === null); i++) sim.step();
  return midOf(sim);
}

describe("the scenario library is well-formed", () => {
  it("has unique, link-safe ids, free play first, and a known set", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("free");
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(ids).toEqual(["free", "rate-shock", "earnings-miss", "fraud", "whipsaw", "quiet-buy"]);
  });

  it("every scenario has a brief, a task, a lesson, a valid seed and headlines in time order inside its duration", () => {
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.brief.length).toBeGreaterThan(30);
      expect(s.task.length).toBeGreaterThan(30);
      expect(s.teaches.length).toBeGreaterThan(3);
      expect(Number.isSafeInteger(s.seed) && s.seed >= 0 && s.seed <= MAX_SEED).toBe(true);
      const times = s.shocks.map((x) => x.atSec);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const sh of s.shocks) {
        expect(sh.atSec).toBeGreaterThanOrEqual(10);
        expect(sh.atSec).toBeLessThan(s.durationSec);
        expect(sh.code).toMatch(/^[A-Z]{2,8}$/); // fits a chart marker
        expect(sh.headline.length).toBeGreaterThan(5);
        // Authored inside the engine's limits, so nothing is silently clamped.
        expect(sh.shock.fairValuePct).toBeGreaterThanOrEqual(SHOCK_LIMITS.fairValuePct[0]);
        expect(sh.shock.fairValuePct).toBeLessThanOrEqual(SHOCK_LIMITS.fairValuePct[1]);
        expect(sh.shock.panicSensitivity).toBeGreaterThanOrEqual(SHOCK_LIMITS.panicSensitivity[0]);
        expect(sh.shock.panicSensitivity).toBeLessThanOrEqual(SHOCK_LIMITS.panicSensitivity[1]);
        expect(sh.shock.durationSec).toBeGreaterThanOrEqual(SHOCK_LIMITS.durationSec[0]);
        expect(sh.shock.durationSec).toBeLessThanOrEqual(SHOCK_LIMITS.durationSec[1]);
      }
    }
  });

  it("scenarios other than free play each use their own seed", () => {
    const seeds = SCENARIOS.map((s) => s.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("links: ?scn=<id>&seed=<n>", () => {
  it("finds a scenario by id, ignoring case and spaces", () => {
    expect(scenarioById(" Rate-Shock ")?.id).toBe("rate-shock");
    expect(scenarioById("nope")).toBeUndefined();
  });

  it("accepts only whole-number seeds in range", () => {
    expect(parseSeed("42")).toBe(42);
    expect(parseSeed(" 0 ")).toBe(0);
    expect(parseSeed(String(MAX_SEED))).toBe(MAX_SEED);
    for (const bad of [null, undefined, "", "-1", "4.5", "1e3", "abc", "99999999999", String(MAX_SEED + 1), "0x10"]) expect(parseSeed(bad)).toBeUndefined();
  });

  it("opens free play for a missing or unknown scenario (flagging the unknown one), and a link's seed overrides the scenario's", () => {
    expect(resolveRun(null, null)).toEqual({ scenario: FREE_PLAY, seed: 187, unknownScenario: false });
    expect(resolveRun("", "")).toEqual({ scenario: FREE_PLAY, seed: 187, unknownScenario: false });
    expect(resolveRun("moon", null)).toEqual({ scenario: FREE_PLAY, seed: 187, unknownScenario: true });
    expect(resolveRun("rate-shock", null)).toMatchObject({ seed: 4101, unknownScenario: false });
    expect(resolveRun("rate-shock", "7")).toMatchObject({ seed: 7 });
    expect(resolveRun("rate-shock", "garbage")).toMatchObject({ seed: 4101 });
  });

  it("builds a link that resolves back to the same run", () => {
    for (const s of SCENARIOS) {
      const url = new URL(runLink(s, 99), "https://example.test");
      expect(resolveRun(url.searchParams.get("scn"), url.searchParams.get("seed"))).toMatchObject({ scenario: s, seed: 99 });
    }
  });
});

describe("each scenario plays out as its brief says", () => {
  it("opens already trading with no headline yet, and is deterministic: the same link gives the same market", () => {
    for (const s of SCENARIOS) {
      const a = createScenarioMarket(s);
      const b = createScenarioMarket(s);
      expect(a.engine.fillCount).toBeGreaterThan(1_000);
      expect(a.shocks).toEqual([]);
      a.run(900);
      b.run(900);
      expect(fingerprint({ fills: a.engine.fills, bids: a.engine.book.depth("buy") })).toBe(fingerprint({ fills: b.engine.fills, bids: b.engine.book.depth("buy") }));
      expect(a.shocks.map((x) => x.label)).toEqual(s.shocks.filter((x) => x.atSec <= 90).map((x) => x.code));
    }
  });

  it("negative headlines pull the price down by more than 1% within a minute, positive ones push it up", () => {
    for (const s of SCENARIOS) {
      for (const sh of s.shocks) {
        const before = midAt(s.id, sh.atSec - 1);
        const after = midAt(s.id, sh.atSec + 60);
        const move = (after - before) / before;
        if (sh.shock.fairValuePct < 0) expect(move, `${s.id}/${sh.code}`).toBeLessThan(-0.01);
        else expect(move, `${s.id}/${sh.code}`).toBeGreaterThan(0.01);
      }
    }
  });

  it("stays a market: the price keeps inside ±15% of the open and the book is two-sided almost all the time", () => {
    for (const s of SCENARIOS) {
      const sim = createScenarioMarket(s);
      const open = midOf(sim);
      let oneSided = 0;
      const ticks = s.durationSec * 10;
      for (let i = 0; i < ticks; i++) {
        sim.step();
        const b = sim.engine.book.bestBid();
        const a = sim.engine.book.bestAsk();
        if (b === null || a === null) {
          oneSided++;
          continue;
        }
        expect(Math.abs((a + b) / 2 / open - 1), s.id).toBeLessThan(0.15);
      }
      expect(oneSided / ticks, s.id).toBeLessThan(0.02);
    }
  });

  it("whipsaw: the bad news is bought back — the price ends above where the downgrade left it", () => {
    expect(midAt("whipsaw", 200)).toBeGreaterThan(midAt("whipsaw", 130) * 1.03);
  });
});

describe("quiet-buy teaches what it says (market impact and order slicing)", () => {
  it("one 50,000-share market order cannot fill and pays more per share than ten 5,000-share slices that all fill", () => {
    const scenario = scenarioById("quiet-buy")!;
    expect(scenario.target).toEqual({ side: "buy", qty: 50_000 });
    for (const seed of [scenario.seed, 1, 2]) {
      const oneShot = createScenarioMarket(scenario, seed);
      oneShot.submitUserOrder({ type: "market", side: "buy", qty: 50_000 });
      oneShot.run(20);
      const big = totalExecution(buildOrderReports(oneShot.engine.fills, USER_ID));

      const sliced = createScenarioMarket(scenario, seed);
      for (let i = 0; i < 10; i++) {
        sliced.submitUserOrder({ type: "market", side: "buy", qty: 5_000 });
        sliced.run(300); // 30 s apart: the book rebuilds in between
      }
      const slices = totalExecution(buildOrderReports(sliced.engine.fills, USER_ID));

      expect(big.qty, `seed ${seed}`).toBeLessThan(50_000); // the book ran out
      expect(oneShot.userEvents[0].status).toBe("partial");
      expect(slices.qty, `seed ${seed}`).toBe(50_000);
      expect(slices.slippageBps!, `seed ${seed}`).toBeLessThan(big.slippageBps!);
    }
  });
});
