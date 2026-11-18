// Before every build (npm run build → prebuild): run the unit tests and write public/proof.json, the
// numbers on the landing page (D-085). Nothing on the page is typed by hand: a failing test fails the
// build, so a page with these numbers never ships over red tests.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { backedClaims, summarizeUnit } from "./proofLib.mjs";

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();
const git = (cmd) => {
  try {
    return run(`git ${cmd}`).trim();
  } catch {
    return null;
  }
};

// Unit tests, run now.
const unitOut = join(tmpdir(), `marketlab-vitest-${process.pid}.json`);
try {
  run(`npx vitest run --reporter=json --outputFile=${unitOut}`);
} catch {
  console.error("proof: unit tests failed; not building over red tests.");
  process.exit(1);
}
const unitReport = JSON.parse(readFileSync(unitOut, "utf8"));
rmSync(unitOut, { force: true });
const unit = summarizeUnit(unitReport);
const tests = unitReport.testResults.flatMap((f) => f.assertionResults.map((a) => ({ file: relative(process.cwd(), f.name), title: a.fullName, status: a.status })));

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

const proof = { generatedAt: new Date().toISOString(), commit, repo: remote, unit, browser, mutation, claims: backedClaims(tests) };
mkdirSync("public", { recursive: true });
writeFileSync("public/proof.json", `${JSON.stringify(proof, null, 2)}\n`);
console.log(`proof: ${unit.passed}/${unit.total} unit tests passed, ${browser?.listed ?? "?"} browser tests listed, mutation ${mutation?.score ?? "none"}, ${proof.claims.length} claims backed → public/proof.json`);
