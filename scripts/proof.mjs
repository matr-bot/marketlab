// Before every build (npm run build → prebuild): run the unit tests and write public/proof.json, the
// numbers on the landing page (D-085). Nothing on the page is typed by hand: a failing test fails the
// build, so a page with these numbers never ships over red tests.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { backedClaims, crossPlatformVerdict, summarizeUnit, withCrossPlatform } from "./proofLib.mjs";

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();
const git = (cmd) => {
  try {
    return run(`git ${cmd}`).trim();
  } catch {
    return null;
  }
};

// Unit tests, run now. A build machine can be far slower than a laptop (2 cores on Vercel), so the whole-
// market tests get a generous per-test timeout: a slow machine is not a failing test.
const unitOut = join(tmpdir(), `marketlab-vitest-${process.pid}.json`);
let failedRun = false;
try {
  run(`npx vitest run --reporter=json --outputFile=${unitOut} --testTimeout=120000 --hookTimeout=120000`);
} catch {
  failedRun = true;
}
if (!existsSync(unitOut)) {
  console.error("proof: the unit tests did not run; not building.");
  process.exit(1);
}
const unitReport = JSON.parse(readFileSync(unitOut, "utf8"));
if (failedRun || unitReport.numFailedTests > 0) {
  // Name every failure, so the build log says what is red.
  for (const f of unitReport.testResults) for (const a of f.assertionResults) if (a.status === "failed") console.error(`proof: FAILED ${relative(process.cwd(), f.name)} › ${a.fullName}\n  ${(a.failureMessages ?? []).join("\n").split("\n")[0]}`);
  console.error("proof: unit tests failed; not building over red tests.");
  process.exit(1);
}
rmSync(unitOut, { force: true });
const unit = summarizeUnit(unitReport);
const tests = unitReport.testResults.flatMap((f) => f.assertionResults.map((a) => ({ file: relative(process.cwd(), f.name), title: a.fullName, name: a.title, status: a.status })));

// Browser tests: listed (they run in CI on every push, not in this build).
let browser = null;
try {
  const list = JSON.parse(run("npx playwright test --list --reporter=json"));
  let n = 0;
  const walk = (s) => {
    (s.suites ?? []).forEach(walk);
    for (const spec of s.specs ?? []) n += spec.tests.length;
  };
  list.suites.forEach(walk);
  browser = { listed: n };
} catch {
  browser = null;
}

// The last mutation run, committed by npm run test:mutation.
const mutation = existsSync("data/proof/mutation.json") ? JSON.parse(readFileSync("data/proof/mutation.json", "utf8")) : null;

// Where the source is: Vercel's repository, else the origin remote.
const remote = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `https://github.com/${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : (git("remote get-url origin")?.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "") ?? null);
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? git("rev-parse --short HEAD");

// Cross-platform determinism (D-091), from this commit's CI: the determinism matrix (Linux x64, macOS
// arm64, Node 22 and 24) and browser-determinism (Chromium, Firefox, WebKit). On Vercel the build waits
// for them (CI and the deploy start together); a failed job stops the build; if they never finish, the
// claim stays the unit-backed one, never the cross-platform one.
let claims = backedClaims(tests);
const fullSha = process.env.VERCEL_GIT_COMMIT_SHA ?? git("rev-parse HEAD");
const slug = remote?.replace(/^https:\/\/github\.com\//, "") ?? null;
if (fullSha !== null && slug !== null) {
  const deadline = Date.now() + (process.env.VERCEL ? 20 * 60_000 : 0);
  let verdict = "pending";
  let runUrl = `https://github.com/${slug}/commit/${fullSha}/checks`;
  for (;;) {
    try {
      const res = await fetch(`https://api.github.com/repos/${slug}/commits/${fullSha}/check-runs?per_page=100`, { headers: { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
      if (res.ok) {
        const body = await res.json();
        verdict = crossPlatformVerdict(body.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })));
        const run = body.check_runs.find((r) => r.name === "browser-determinism");
        if (run?.html_url) runUrl = run.html_url;
      }
    } catch {
      verdict = "pending";
    }
    if (verdict !== "pending" || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  if (verdict === "failed") {
    console.error(`proof: CI's cross-platform determinism failed for ${fullSha.slice(0, 7)}; not building (${runUrl}).`);
    process.exit(1);
  }
  if (verdict === "passed") claims = withCrossPlatform(claims, runUrl);
  console.log(`proof: cross-platform determinism ${verdict}`);
}

const proof = { generatedAt: new Date().toISOString(), commit, repo: remote, unit, browser, mutation, claims };
mkdirSync("public", { recursive: true });
writeFileSync("public/proof.json", `${JSON.stringify(proof, null, 2)}\n`);
console.log(`proof: ${unit.passed}/${unit.total} unit tests passed, ${browser?.listed ?? "?"} browser tests listed, mutation ${mutation?.score ?? "none"}, ${proof.claims.length} claims backed → public/proof.json`);
