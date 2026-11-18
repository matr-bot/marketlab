import { describe, expect, it } from "vitest";
import { FREE_PLAY, resolveRun, scenarioById } from "@/engine/scenarios";
import { learnFromQuery, sessionLink } from "./sessionLink";

describe("sessionLink (D-072)", () => {
  it("adds learn=1 only in Learn mode, and the link reopens the same run", () => {
    const s = scenarioById("rate-shock")!;
    expect(sessionLink(s, 42, false)).toBe("/terminal?scn=rate-shock&seed=42");
    const learn = sessionLink(s, 42, true);
    expect(learn).toBe("/terminal?scn=rate-shock&seed=42&learn=1");
    const q = new URL(learn, "https://example.test").searchParams;
    expect(resolveRun(q.get("scn"), q.get("seed"))).toMatchObject({ scenario: s, seed: 42 });
    expect(learnFromQuery(q)).toBe(true);
  });

  it("reads Learn mode as off unless learn=1", () => {
    for (const q of ["", "learn=0", "learn=true", "learn="]) expect(learnFromQuery(new URLSearchParams(q))).toBe(false);
    expect(sessionLink(FREE_PLAY, 187, false)).toBe("/terminal?scn=free&seed=187");
  });
});
