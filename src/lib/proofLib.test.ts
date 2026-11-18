import { describe, expect, it } from "vitest";
// A plain .mjs build script (typed by its JSDoc), tested here so its arithmetic is pinned.
import { backedClaims, CLAIMS, summarizeMutants, summarizeUnit } from "../../scripts/proofLib.mjs";

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
});
