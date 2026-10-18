"use client";

import { SHOCK_LIMITS, type ShockParams } from "@/engine/fundamental";
import styles from "./terminal.module.css";

/** What the NEWS strip shows (D-052): nothing, waiting for the AI, a preview to apply, or the last applied. */
export type NewsState =
  | { readonly phase: "idle" }
  | { readonly phase: "interpreting"; readonly headline: string }
  | { readonly phase: "preview" | "applied"; readonly headline: string; readonly source: string; readonly reason: string; readonly draft: ShockParams; readonly edited: boolean };

type Field = { key: keyof ShockParams; label: string; unit: string; toView: (x: number) => number; fromView: (x: number) => number; step: number };

const FIELDS: readonly Field[] = [
  { key: "fairValuePct", label: "FAIR VALUE", unit: "%", toView: (x) => Math.round(x * 1000) / 10, fromView: (x) => x / 100, step: 0.5 },
  { key: "panicSensitivity", label: "PANIC", unit: "×", toView: (x) => x, fromView: (x) => x, step: 0.1 },
  { key: "volatilityMultiplier", label: "VOL", unit: "×", toView: (x) => x, fromView: (x) => x, step: 0.1 },
  { key: "liquidityMultiplier", label: "LIQUIDITY", unit: "×", toView: (x) => x, fromView: (x) => x, step: 0.05 },
  { key: "durationSec", label: "FOR", unit: "s", toView: (x) => x, fromView: (x) => x, step: 10 },
];

const range = (f: Field) => SHOCK_LIMITS[f.key].map((x) => f.toView(x)).join(" to ");

/**
 * The NEWS strip under the command bar: what the AI chose for a headline, editable before (or after)
 * it is applied. Enter applies, Tab moves between fields, Esc cancels. Every number shown is the
 * clamped parameter the engine will get; the reason is the AI's own words, labelled as such.
 */
export function NewsPreview({ news, onEdit, onApply, onCancel }: { news: NewsState; onEdit: (draft: ShockParams) => void; onApply: () => void; onCancel: () => void }) {
  if (news.phase === "idle") return null;
  if (news.phase === "interpreting") {
    return (
      <div className={styles.news} data-testid="news" data-phase="interpreting">
        <span className={styles.label}>NEWS</span> <span className={styles.newsHeadline}>“{news.headline}”</span> <span className={styles.dimText}>interpreting…</span>
      </div>
    );
  }
  const state = news.phase === "applied" ? (news.edited ? "EDITED · Enter applies it as a new headline" : "APPLIED") : "Enter apply · Tab edit · Esc cancel";
  return (
    <div className={styles.news} data-testid="news" data-phase={news.phase}>
      <span className={styles.label}>NEWS</span>
      <span className={styles.newsHeadline}>“{news.headline}”</span>
      <span className={styles.dimText}>{news.source} →</span>
      {FIELDS.map((f) => (
        <label key={f.key} className={styles.newsField} title={`Range ${range(f)} ${f.unit}`}>
          <span className={styles.label}>{f.label}</span>
          <input
            type="number"
            data-field={f.key}
            className={styles.newsInput}
            step={f.step}
            value={f.toView(news.draft[f.key])}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onEdit({ ...news.draft, [f.key]: f.fromView(v) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onApply();
              if (e.key === "Escape") onCancel();
            }}
          />
          <span className={styles.dimText}>{f.unit}</span>
        </label>
      ))}
      {news.reason && <span className={styles.newsReason}>AI&apos;s reason: “{news.reason}”</span>}
      <span className={styles.newsHint}>{state}</span>
    </div>
  );
}
