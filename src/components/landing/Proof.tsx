"use client";

import { useEffect, useState } from "react";
import { formatQty } from "@/lib/format";
import styles from "./landing.module.css";

/** public/proof.json, written before every build by scripts/proof.mjs (D-085). */
interface ProofData {
  readonly generatedAt: string;
  readonly commit: string | null;
  readonly repo: string | null;
  readonly unit: { readonly total: number; readonly passed: number; readonly failed: number; readonly skipped: number; readonly files: number };
  readonly browser: { readonly listed: number } | null;
  readonly mutation: {
    readonly scope: string;
    readonly score: number | null;
    readonly mutants: number;
    readonly files: number;
    readonly killed: number;
    readonly timeout: number;
    readonly survived: number;
    readonly noCoverage: number;
    readonly ranAt: string;
    readonly commit: string;
    readonly uncommitted: readonly string[];
  } | null;
  readonly claims: ReadonlyArray<{ readonly id: string; readonly label: string; readonly tests: ReadonlyArray<{ readonly file: string; readonly title: string; readonly name: string }> }>;
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * PROOF (D-085): every number comes from public/proof.json, computed from the test and mutation
 * reports when the site was built; this file contains no figure. Without the file the section is not
 * drawn. Each claim is shown only if the tests behind it passed in that build.
 */
export function Proof() {
  const [proof, setProof] = useState<ProofData | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/proof.json")
      .then((r) => (r.ok ? (r.json() as Promise<ProofData>) : null))
      .then((p) => live && setProof(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (proof === null) return null;
  const { unit, browser, mutation } = proof;
  const blob = (path: string) => (proof.repo === null ? null : `${proof.repo}/blob/${proof.commit ?? "main"}/${path}`);
  const decisions = blob("docs/DECISIONS.md");
  return (
    <section className={styles.section} aria-labelledby="proof" data-testid="proof">
      <h2 id="proof" className={styles.h2}>
        PROOF
      </h2>
      <p className={styles.sentence}>Every number here is computed from the test and mutation reports when the site is built.</p>
      <div className={styles.stats} data-testid="proof-stats">
        <span data-stat="unit">
          <b>{formatQty(unit.passed)}</b> UNIT TESTS PASSED
        </span>
        {browser !== null && (
          <span data-stat="browser">
            <b>{formatQty(browser.listed)}</b> BROWSER TESTS · CI
          </span>
        )}
        {mutation !== null && mutation.score !== null && (
          <span data-stat="mutation">
            MUTATION <b>{mutation.score.toFixed(1)}%</b> · ENGINE
          </span>
        )}
      </div>
      {/* Each claim names the tests that back it; a claim exists only if they passed in this build. */}
      <ul className={styles.claims} data-testid="proof-claims">
        {proof.claims.map((c) => (
          <li key={c.id} data-claim={c.id}>
            <span className={styles.claimLabel}>{c.label}</span>
            <span>
              {c.tests.map((t) => (
                <span key={t.title} className={styles.claimTest} title={`${t.file}: ${t.title}`}>
                  {t.name} <span className={styles.passed}>✓</span>{" "}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <details className={styles.layer} data-testid="proof-layer">
        <summary>
          <span className={styles.plus} aria-hidden />
          How each number was produced
        </summary>
        <div className={styles.layerBody}>
          <p>
            <span className={styles.dim}>UNIT </span>Vitest, run by this build at {proof.commit ?? "an unknown commit"} on {day(proof.generatedAt)}: {formatQty(unit.passed)} passed, {formatQty(unit.skipped)} skipped,{" "}
            {formatQty(unit.failed)} failed, across {formatQty(unit.files)} files. A failing test fails the build.
          </p>
          {browser !== null && (
            <p>
              <span className={styles.dim}>BROWSER </span>Playwright, {formatQty(browser.listed)} tests listed by this build; CI runs them against a production build on every push.
            </p>
          )}
          {mutation !== null && mutation.score !== null && (
            <p>
              <span className={styles.dim}>MUTATION </span>Stryker on {mutation.scope}, run on {day(mutation.ranAt)} at {mutation.commit}: of {formatQty(mutation.mutants)} mutants in {formatQty(mutation.files)} files, {formatQty(mutation.killed)} killed and{" "}
              {formatQty(mutation.timeout)} timed out (detected), {formatQty(mutation.survived)} survived, {formatQty(mutation.noCoverage)} had no coverage. Too slow for a deploy build, so this is the last run, dated.
              {mutation.uncommitted.length > 0 && <> The run included uncommitted engine files: {mutation.uncommitted.join(", ")}.</>}
            </p>
          )}
          {proof.claims.map((c) => (
            <p key={c.id}>
              <span className={styles.dim}>{c.label} </span>
              {c.tests.map((t) => `${t.file}: “${t.title}”`).join(" · ")}
            </p>
          ))}
        </div>
      </details>
      <p className={styles.links}>
        {proof.repo !== null && (
          <a className={styles.link} href={proof.repo} data-testid="proof-repo">
            SOURCE ↗
          </a>
        )}
        {decisions !== null && (
          <a className={styles.link} href={decisions}>
            DECISIONS.md ↗
          </a>
        )}
        <a className={styles.link} href="/proof.json">
          proof.json ↗
        </a>
      </p>
    </section>
  );
}
