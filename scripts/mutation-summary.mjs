// After a Stryker run (npm run test:mutation): summarize reports/mutation/mutation.json into the small,
// committed data/proof/mutation.json the landing page shows, with when it ran and on which commit
// (D-085). The full report stays out of git; Stryker is too slow to run inside a deploy build.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { summarizeMutants } from "./proofLib.mjs";

const REPORT = "reports/mutation/mutation.json";
const OUT = "data/proof/mutation.json";
const git = (cmd) => execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

const summary = summarizeMutants(JSON.parse(readFileSync(REPORT, "utf8")));
// Uncommitted engine files mean the run measured something no commit contains: say so.
const dirty = git("status --porcelain -- src/engine").split("\n").filter(Boolean).map((l) => l.slice(3));
const out = { scope: "src/engine", ...summary, ranAt: statSync(REPORT).mtime.toISOString(), commit: git("rev-parse --short HEAD"), uncommitted: dirty };
mkdirSync("data/proof", { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`mutation score ${out.score}% (${out.mutants} mutants, ${out.files} files) at ${out.commit}${dirty.length ? `, with uncommitted: ${dirty.join(", ")}` : ""} → ${OUT}`);
