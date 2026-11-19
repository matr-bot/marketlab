import { describe, expect, it } from "vitest";
// A plain .mjs build script (typed by its JSDoc), tested here so its arithmetic is pinned.
import { backedClaims, CLAIMS, CROSS_PLATFORM_JOBS, CROSS_PLATFORM_LABEL, crossPlatformVerdict, summarizeMutants, summarizeUnit, withCrossPlatform } from "../../scripts/proofLib.mjs";

describe("proof numbers are computed from reports (D-085)", () => {
  it("scores mutants as Stryker does: detected over valid", () => {
    const report = { files: { a: { mutants: [{ status: "Killed" }, { status: "Killed" }, { status: "Timeout" }, { status: "Survived" }] }, b: { mutants: [{ status: "NoCoverage" }, { status: "CompileError" }, { status: "Ignored" }] } } };
    expect(summarizeMutants(report)).toEqual({ files: 2, mutants: 5, killed: 2, timeout: 1, survived: 1, noCoverage: 1, score: 60 });
    expect(summarizeMutants({ files: {} }).score).toBeNull();
  });

  it("reads unit totals from a Vitest report", () => {
    expect(summarizeUnit({ numTotalTests: 10, numPassedTests: 9, numFailedTests: 0, numPendingTests: 1, testResults: [{ name: "x", assertionResults: [] }] })).toEqual({ total: 10, passed: 9, failed: 0, skipped: 1, files: 1 });
  });

  it("shows a claim only when every test behind it was found and passed", () => {
    const all = CLAIMS.flatMap((c) => c.tests.map((t) => ({ file: t.file, title: `x ${t.title.source.replace(/\\/g, "")} x`, status: "passed" })));
    expect(backedClaims(all).map((c) => c.id)).toEqual(["replay", "money", "network"]);
    expect(backedClaims(all.map((t) => ({ ...t, name: "own name" })))[0].tests[0].name).toBe("own name"); // the test's own name, for the page
    expect(backedClaims(all)[0].tests[0].name).toBe(all[0].title); // without one, the full name
    const oneFailed = all.map((t, i) => (i === 0 ? { ...t, status: "failed" } : t));
    expect(backedClaims(oneFailed).map((c) => c.id)).toEqual(["money", "network"]);
    expect(backedClaims(all.slice(1)).map((c) => c.id)).toEqual(["money", "network"]);
  });

  it("reads the cross-platform verdict from CI check runs (D-091)", () => {
    const ok = CROSS_PLATFORM_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" }));
    expect(crossPlatformVerdict(ok)).toBe("passed");
    expect(crossPlatformVerdict(ok.slice(1))).toBe("pending"); // a job missing
    expect(crossPlatformVerdict(ok.map((r, i) => (i === 2 ? { ...r, status: "in_progress", conclusion: null } : r)))).toBe("pending");
    expect(crossPlatformVerdict(ok.map((r, i) => (i === 4 ? { ...r, conclusion: "failure" } : r)))).toBe("failed");
    expect(crossPlatformVerdict([...ok.slice(0, 4), { name: "browser-determinism", status: "completed", conclusion: "cancelled" }])).toBe("failed");
  });

  it("folds the CI evidence into the replay claim only", () => {
    const claims = [
      { id: "replay", label: "DETERMINISTIC REPLAY", tests: [{ file: "a", title: "t", name: "t" }] },
      { id: "money", label: "INTEGER-CENT MONEY", tests: [] },
    ];
    const out = withCrossPlatform(claims, "https://ci/run/1");
    expect(out[0].label).toBe(CROSS_PLATFORM_LABEL);
    expect(out[0].tests).toHaveLength(1 + CROSS_PLATFORM_JOBS.length);
    expect(out[1]).toEqual(claims[1]);
  });
});

