// The proof on the landing page (D-085): pure functions over test and mutation reports, so every number
// shown is computed from a report, never typed. Used by scripts/proof.mjs and mutation-summary.mjs.

/**
 * Stryker's mutation score: detected (killed + timeout) over valid mutants (detected + survived + no
 * coverage), as a percentage. Compile and runtime errors and ignored mutants are not counted.
 * @param {{ files: Record<string, { mutants: Array<{ status: string }> }> }} report
 */
export function summarizeMutants(report) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  let files = 0;
  for (const file of Object.values(report.files)) {
    files++;
    for (const m of file.mutants) if (m.status in counts) counts[m.status]++;
  }
  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  return {
    files,
    mutants: valid,
    killed: counts.Killed,
    timeout: counts.Timeout,
    survived: counts.Survived,
    noCoverage: counts.NoCoverage,
    score: valid === 0 ? null : Math.round((10_000 * detected) / valid) / 100,
  };
}

/**
 * Unit test totals from a Vitest JSON report.
 * @param {{ numTotalTests: number, numPassedTests: number, numFailedTests: number, numPendingTests: number, testResults: Array<{ name: string, assertionResults: Array<{ fullName: string, status: string }> }> }} report
 */
export function summarizeUnit(report) {
  return { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests, files: report.testResults.length };
}

/**
 * The claims, each backed by named tests. A claim is shown only if every one of its tests is found and
 * passed; otherwise it is left out (never shown on faith).
 */
export const CLAIMS = [
  { id: "replay", label: "DETERMINISTIC REPLAY", tests: [{ file: "src/engine/simulation.test.ts", title: /byte-identical fill log/ }, { file: "src/engine/feed.test.ts", title: /identical fill log for the same number of ticks/ }] },
  { id: "money", label: "INTEGER-CENT MONEY", tests: [{ file: "src/engine/matchingEngine.test.ts", title: /rejects limit price off tick/ }, { file: "src/engine/boundary.test.ts", title: /integer money/ }] },
  { id: "network", label: "RUNS IN THE BROWSER", tests: [{ file: "src/lib/network.test.ts", title: /calls fetch only with an allowed same-origin path/ }, { file: "src/lib/network.test.ts", title: /keeps the engine and the worker off the network/ }] },
];

/**
 * Which claims their tests back.
 * @param {Array<{ file: string, title: string, status: string }>} tests every test, file relative to the repo
 */
export function backedClaims(tests) {
  return CLAIMS.flatMap((c) => {
    const found = c.tests.map((t) => tests.find((x) => x.file === t.file && t.title.test(x.title)));
    if (found.some((f) => f === undefined || f.status !== "passed")) return [];
    return [{ id: c.id, label: c.label, tests: found.map((f) => ({ file: f.file, title: f.title })) }];
  });
}
