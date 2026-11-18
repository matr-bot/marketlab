"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FrameStrategy } from "@/engine/feed";
import type { StrategyDecision, StrategySpec } from "@/engine/strategy";
import { describeRules, pct, RULE_LABELS } from "@/lib/glassbox/english";
import { formulas } from "@/lib/glassbox/formulas";
import { strategyPython } from "@/lib/glassbox/python";
import { SHARPE_NOTE, SOURCE_LABELS, type StratSource } from "./StrategyPanel";
import { KeyHint } from "./KeyHint";
import styles from "./terminal.module.css";

/** Save text as a file in the browser. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The glass box (CLAUDE.md, "Show me what I built"; D-065): the same strategy four ways. English is
 * what the student typed; the rules, formulas and Python are all generated from the spec the engine
 * is running, and the formulas carry this run's real numbers. Esc or CLOSE dismisses it.
 */
export function GlassBox({
  text,
  source,
  reason,
  spec,
  strategy,
  decisions,
  onClose,
  onDownloadRun,
}: {
  text: string;
  source: StratSource;
  reason: string;
  spec: StrategySpec;
  strategy: Omit<FrameStrategy, "newDecisions"> | null;
  decisions: readonly StrategyDecision[];
  onClose: () => void;
  onDownloadRun: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => strategyPython(spec), [spec]);
  // Focus the dialog itself, not a button: the Enter that opened it must not press one (D-060).
  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: [string, string][] = [
    ["ENTRY RULE", RULE_LABELS[spec.entry.rule]],
    ["MOVE", pct(spec.entry.pct)],
    ["WITHIN", `${spec.entry.windowSec} s`],
    ["STOP LOSS", spec.stopLossPct === null ? "off" : pct(spec.stopLossPct)],
    ["TAKE PROFIT", spec.takeProfitPct === null ? "off" : pct(spec.takeProfitPct)],
    ["TIME EXIT", spec.timeExitSec === null ? "off" : `${spec.timeExitSec} s`],
    ["SHARES", String(spec.qty)],
    ["COOLDOWN", `${spec.cooldownSec} s`],
    ["ORDER TYPE", "market order, through the same queue and book as your own orders"],
    ["CHECKED", "once per sim second, on the mid (halfway between best bid and best ask)"],
  ];

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className={styles.glass} role="dialog" aria-modal="true" aria-label="What you built" data-testid="glass" onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.dialogHead}>
          <span>WHAT YOU BUILT · ENGLISH → RULES → FORMULAS → PYTHON</span>
          <button type="button" className={styles.chip} onClick={onClose}>
            CLOSE
            <KeyHint k="ESC" />
          </button>
        </header>
        <div className={styles.glassGrid}>
          <section className={styles.glassPart} data-testid="glass-english">
            <h3 className={styles.sectionHead}>1 · ENGLISH</h3>
            <p className={styles.glassQuote}>“{text}”</p>
            <p className={styles.dim}>
              Read by: <span className={styles.label}>{SOURCE_LABELS[source]}</span>
            </p>
            {reason && <p className={styles.newsReason}>AI&apos;s reason: “{reason}”</p>}
            <p className={styles.dim}>What the engine runs, in words:</p>
            <ul className={styles.stratRules}>
              {describeRules(spec).map((l) => (
                <li key={l.key}>{l.text}</li>
              ))}
            </ul>
          </section>

          <section className={styles.glassPart} data-testid="glass-rules">
            <h3 className={styles.sectionHead}>2 · RULES</h3>
            <table className={styles.helpTable}>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td className={styles.helpCmd}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.dim}>From a fixed menu: the AI can only pick one of four entry rules and numbers, which the engine clamps to safe ranges. It never writes code.</p>
          </section>

          <section className={styles.glassPart} data-testid="glass-formulas">
            <h3 className={styles.sectionHead}>3 · FORMULAS · WITH YOUR NUMBERS</h3>
            {formulas(spec, decisions, strategy).map((f) => (
              <div key={f.name} className={styles.formula} data-formula={f.name} title={f.name === "SHARPE" ? SHARPE_NOTE : undefined}>
                <div className={styles.label}>{f.name}</div>
                <div className={styles.formulaSym}>{f.symbolic}</div>
                <div className={styles.formulaNum}>{f.filled}</div>
              </div>
            ))}
            <p className={styles.dim}>{SHARPE_NOTE}</p>
          </section>

          <section className={styles.glassPart} data-testid="glass-python">
            <h3 className={styles.sectionHead}>4 · PYTHON · GENERATED FROM YOUR RULES BY TEMPLATE, NOT BY AN AI</h3>
            <div className={styles.formRow}>
              <button
                type="button"
                className={styles.chip}
                onClick={() =>
                  navigator.clipboard?.writeText(code).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                {copied ? "COPIED" : "COPY"}
              </button>
              <button type="button" className={styles.chip} onClick={() => download("strategy.py", code, "text/x-python")}>
                DOWNLOAD strategy.py
              </button>
              <button type="button" className={styles.chip} data-testid="glass-run-data" onClick={onDownloadRun} title="What your strategy saw this run (mids each second) and its equity: run python3 strategy.py run.json to get the same decisions and Sharpe.">
                DOWNLOAD run.json
              </button>
            </div>
            <pre className={styles.code} data-testid="glass-code">
              {code}
            </pre>
            <p className={styles.dim}>
              This code decides when to trade, exactly as the engine did. What you paid is the order book&apos;s doing: see EXR. If the book cannot take a whole exit at once, the engine keeps closing the rest every second and enters again only once flat; plain Python does not see the book, so only then can the two differ.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
