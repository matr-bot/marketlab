"use client";

import { useState } from "react";
import type { FrameStrategy } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { ENTRY_RULES, STRATEGY_LIMITS, type EntryRule, type StrategyDecision, type StrategySpec } from "@/engine/strategy";
import { formatDollars, formatQty } from "@/lib/format";
import { describeRules, RULE_LABELS } from "@/lib/glassbox/english";
import { dollars } from "@/lib/glassbox/formulas";
import { Explain } from "./Learn";
import { MenuSelect } from "./MenuSelect";
import { KeyHint } from "./KeyHint";
import styles from "./terminal.module.css";
import { Time } from "./Time";

/** What STRAT shows: typing an idea, waiting for the AI, a preview to check and edit, or the live strategy. */
export type StratState =
  | { readonly phase: "compose"; readonly message: string | null }
  | { readonly phase: "interpreting"; readonly text: string }
  | { readonly phase: "preview"; readonly text: string; readonly source: StratSource; readonly reason: string; readonly draft: StrategySpec }
  | { readonly phase: "live" };

/** Where a spec came from. Offline results are never labelled as the AI's. */
export type StratSource = "ai" | "cache" | "offline" | "example";

export const SOURCE_LABELS: Record<StratSource, string> = { ai: "AI", cache: "AI (CACHED)", offline: "UNDERSTOOD OFFLINE · NOT THE AI", example: "EXAMPLE · NOT THE AI" };

export const SHARPE_NOTE =
  "Annualized from one-second returns with the sim's clock: a year is 252 sessions of 23,400 s. Short runs are noisy: a Sharpe from a few minutes of data means little, and a big number here is not a skill signal.";

const PLACEHOLDER = "e.g. buy 500 after a 3% drop, stop 1%";

/** The spec on one line of data (D-072): `BUY AFTER A DROP 3%/60S · QTY 500 · SL 1% · TP 0.5% · EXIT 120S`. */
export function compactRule(s: StrategySpec): string {
  const pct = (x: number) => `${Number((x * 100).toFixed(4))}%`;
  const parts = [`${RULE_LABELS[s.entry.rule]} ${pct(s.entry.pct)}/${s.entry.windowSec}S`, `QTY ${formatQty(s.qty)}`];
  if (s.stopLossPct !== null) parts.push(`SL ${pct(s.stopLossPct)}`);
  if (s.takeProfitPct !== null) parts.push(`TP ${pct(s.takeProfitPct)}`);
  if (s.timeExitSec !== null) parts.push(`EXIT ${s.timeExitSec}S`);
  return parts.join(" · ");
}

type NumField = { key: string; label: string; unit: string; get: (s: StrategySpec) => number | null; set: (s: StrategySpec, v: number | null) => StrategySpec; optional: boolean; range: string };

const FIELDS: readonly NumField[] = [
  { key: "pct", label: "MOVE", unit: "%", get: (s) => s.entry.pct * 100, set: (s, v) => ({ ...s, entry: { ...s.entry, pct: (v ?? 0) / 100 } }), optional: false, range: "0.1 to 20 %" },
  { key: "windowSec", label: "WITHIN", unit: "s", get: (s) => s.entry.windowSec, set: (s, v) => ({ ...s, entry: { ...s.entry, windowSec: v ?? 0 } }), optional: false, range: `${STRATEGY_LIMITS.windowSec[0]} to ${STRATEGY_LIMITS.windowSec[1]} s` },
  { key: "stopLossPct", label: "SL", unit: "%", get: (s) => (s.stopLossPct === null ? null : s.stopLossPct * 100), set: (s, v) => ({ ...s, stopLossPct: v === null ? null : v / 100 }), optional: true, range: "0.1 to 20 %, blank = off" },
  { key: "takeProfitPct", label: "TP", unit: "%", get: (s) => (s.takeProfitPct === null ? null : s.takeProfitPct * 100), set: (s, v) => ({ ...s, takeProfitPct: v === null ? null : v / 100 }), optional: true, range: "0.1 to 50 %, blank = off" },
  { key: "timeExitSec", label: "EXIT", unit: "s", get: (s) => s.timeExitSec, set: (s, v) => ({ ...s, timeExitSec: v }), optional: true, range: "5 to 3,600 s, blank = off" },
  { key: "qty", label: "QTY", unit: "", get: (s) => s.qty, set: (s, v) => ({ ...s, qty: v ?? 0 }), optional: false, range: "1 to 10,000" },
  { key: "cooldownSec", label: "COOLDOWN", unit: "s", get: (s) => s.cooldownSec, set: (s, v) => ({ ...s, cooldownSec: v ?? 0 }), optional: false, range: "0 to 600 s" },
];

/** A field's text while typing: kept as typed until it parses, so "0." is not thrown away. */
function viewOf(v: number | null): string {
  return v === null ? "" : String(Number(v.toFixed(4)));
}

/** A decision without its time: `STOP LOSS: SELL 500 · mid 179.94 vs level 180.03`. */
export function decisionText(d: StrategyDecision): string {
  return decisionLine(d).slice(formatSimTime(d.time).length + 1);
}

/** One line for a decision, with the numbers the rule compared. */
export function decisionLine(d: StrategyDecision): string {
  const what = `${d.side === "buy" ? "BUY" : "SELL"} ${formatQty(d.qty)}`;
  const why: Record<StrategyDecision["reason"], string> = { entry: "entry", stopLoss: "stop loss", takeProfit: "take profit", timeExit: "time exit", stopped: "stopped by you" };
  const cmp = d.mid !== null && d.level !== null ? ` · mid ${dollars(d.mid)} vs level ${dollars(d.level)}` : d.heldSec !== null ? ` · held ${d.heldSec} s` : "";
  return `${formatSimTime(d.time)} ${why[d.reason].toUpperCase()}: ${what}${cmp}`;
}

export function StrategyPanel({
  state,
  strategy,
  decisions,
  onSubmit,
  onEdit,
  onStart,
  onCancel,
  onStop,
  onReveal,
  onNew,
  showRules = true,
}: {
  state: StratState;
  strategy: Omit<FrameStrategy, "newDecisions"> | null;
  decisions: readonly StrategyDecision[];
  onSubmit: (text: string) => void;
  onEdit: (draft: StrategySpec) => void;
  onStart: () => void;
  onCancel: () => void;
  onStop: () => void;
  onReveal: () => void;
  onNew: () => void;
  /** The rules in words under the preview fields; off where a glass box shows them (D-088). */
  showRules?: boolean;
}) {
  const [text, setText] = useState("");

  if (state.phase === "compose" || state.phase === "interpreting") {
    const busy = state.phase === "interpreting";
    return (
      <div className={styles.strat} data-testid="strat" data-phase={state.phase}>
        <Explain id="strat.intro" />
        <textarea
          className={styles.stratInput}
          data-testid="strat-input"
          aria-label="Strategy"
          placeholder={PLACEHOLDER}
          value={busy ? state.text : text}
          maxLength={300}
          rows={3}
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim() !== "") onSubmit(text.trim());
            }
          }}
        />
        {busy ? <div className={styles.dim}>INTERPRETING…</div> : state.message !== null && <div className={styles.note} data-testid="strat-message">{state.message}</div>}
        {strategy !== null && (
          <div className={styles.dim} title={strategy.status === "running" ? "Your last strategy is still running: starting a new one replaces it." : "Your last strategy is stopped."}>
            {strategy.status === "running" ? "PREV RUNNING · REPLACED ON START" : "PREV STOPPED"}
          </div>
        )}
      </div>
    );
  }

  if (state.phase === "preview") {
    const { draft } = state;
    const lines = describeRules(draft);
    const lineFor = (key: string) => lines.find((l) => l.key === key || (key === "pct" || key === "windowSec" || key === "qty" ? l.key === "entry" : false))?.text;
    return (
      <div className={styles.strat} data-testid="strat" data-phase="preview">
        <div className={styles.stratSource}>
          <span className={styles.label}>{SOURCE_LABELS[state.source]}</span> <span className={styles.dimText}>“{state.text}”</span>
        </div>
        {/* A div, not a label: a click on a menu option must not bubble into a label's click on the button. */}
        <div className={styles.stratField}>
          <span className={styles.label}>RULE</span>
          <MenuSelect<EntryRule> field="rule" label="Entry rule" value={draft.entry.rule} options={ENTRY_RULES.map((r) => ({ value: r, label: RULE_LABELS[r] }))} onChange={(rule) => onEdit({ ...draft, entry: { ...draft.entry, rule } })} />
        </div>
        <div className={styles.stratGrid}>
          {FIELDS.map((f) => (
            <PreviewField key={f.key} field={f} draft={draft} onEdit={onEdit} onStart={onStart} onCancel={onCancel} explain={lineFor(f.key)} />
          ))}
        </div>
        <div className={styles.formRow}>
          <button type="button" className={styles.secondary} data-testid="strat-start" onClick={onStart}>
            START
            <KeyHint k="↵" />
          </button>
          <button type="button" className={styles.chip} onClick={onCancel}>
            CANCEL
            <KeyHint k="ESC" />
          </button>
        </div>
        {/* The rules in words; the STRATEGY workspace leaves them to its glass box (D-088). */}
        {showRules && (
          <ul className={styles.stratRules} data-testid="strat-rules">
            {lines.map((l) => (
              <li key={l.key}>{l.text}</li>
            ))}
          </ul>
        )}
        {state.reason && (
          <Explain id="strat.reason">
            <span className={styles.newsReason}>AI&apos;s reason: “{state.reason}”</span>
          </Explain>
        )}
      </div>
    );
  }

  // Live: the strategy as the engine runs it.
  if (strategy === null) return <div className={styles.strat} data-testid="strat" data-phase="starting">STARTING</div>;
  const sh = strategy.sharpe;
  const dd = strategy.drawdown;
  const lastDecision = decisions.at(-1) ?? null;
  const status = strategy.status === "running" ? (strategy.inPosition ? "RUNNING · IN POSITION" : "RUNNING · FLAT") : strategy.status === "closing" ? "STOPPED · CLOSING" : "STOPPED";
  return (
    <div className={styles.strat} data-testid="strat" data-phase="live" data-status={strategy.status}>
      <div className={styles.stratHead}>
        <span className={styles.simTag} data-testid="strat-status">
          {status}
        </span>
      </div>
      <div className={styles.formRow}>
        <button type="button" className={styles.secondary} data-testid="strat-reveal" title="The glass box: your strategy as English, rules, formulas with real numbers, and Python" onClick={onReveal}>
          BACKTEST
          <KeyHint k="F4" />
        </button>
        {strategy.status === "running" && (
          <button type="button" className={styles.secondary} data-testid="strat-stop" onClick={onStop}>
            STOP
          </button>
        )}
        <button type="button" className={styles.chip} data-testid="strat-new" onClick={onNew}>
          NEW
        </button>
      </div>
      <div className={styles.dim} data-testid="strat-rule">
        {compactRule(strategy.spec)}
      </div>
      <Explain id="strat.rule">{describeRules(strategy.spec)[0].text}</Explain>
      <dl className={styles.stratStats}>
        <div title="Shares the strategy holds: positive is long, negative is short. Separate from your manual trades.">
          <dt>POSITION</dt>
          <dd data-testid="strat-position">
            {strategy.position > 0 ? "+" : ""}
            {formatQty(strategy.position)}
          </dd>
        </div>
        <div title="The strategy's own cash plus its shares valued at the mid.">
          <dt>P&amp;L</dt>
          <dd data-testid="strat-pnl">{formatDollars(strategy.pnl, true)}</dd>
        </div>
        <div title="Completed round trips: entries that were closed.">
          <dt>TRADES</dt>
          <dd>{formatQty(strategy.trades)}</dd>
        </div>
        <div title={SHARPE_NOTE}>
          <dt>SHARPE</dt>
          <dd data-testid="strat-sharpe">{sh === null ? "—" : sh.sharpe.toFixed(2)}</dd>
        </div>
        <div title="The largest fall in the strategy's equity from a running peak.">
          <dt>MAX DD</dt>
          <dd>{dd === null ? "—" : formatDollars(-Math.round(dd.drawdown))}</dd>
        </div>
      </dl>
      <div className={styles.dim} title={`${sh === null ? "Sharpe needs at least two one-second returns. " : `Sharpe from ${formatQty(sh.n)} one-second returns. `}${SHARPE_NOTE}`} data-testid="strat-samples">
        <span className={styles.label}>N</span> {sh === null ? "—" : formatQty(sh.n)}
      </div>
      <Explain id="strat.sharpe" />
      <div className={styles.lastMessage} data-testid="strat-last">
        {lastDecision === null ? (
          "—"
        ) : (
          <>
            <Time ms={lastDecision.time} /> {decisionText(lastDecision)}
          </>
        )}
      </div>
      {lastDecision === null && <Explain id="strat.waiting" />}
    </div>
  );
}

function PreviewField({ field, draft, onEdit, onStart, onCancel, explain }: { field: NumField; draft: StrategySpec; onEdit: (d: StrategySpec) => void; onStart: () => void; onCancel: () => void; explain: string | undefined }) {
  // Kept as typed while focused, so a half-typed "0." or an emptied field is not overwritten.
  const [typing, setTyping] = useState<string | null>(null);
  const value = typing ?? viewOf(field.get(draft));
  return (
    <label className={styles.stratField} title={`${field.range}${explain ? ` · ${explain}` : ""}`}>
      <span className={styles.label}>{field.label}</span>
      <input
        className={styles.newsInput}
        data-field={field.key}
        inputMode="decimal"
        value={value}
        placeholder={field.optional ? "off" : ""}
        onChange={(e) => {
          setTyping(e.target.value);
          const t = e.target.value.trim();
          if (t === "" && field.optional) onEdit(field.set(draft, null));
          else if (t !== "" && Number.isFinite(Number(t))) onEdit(field.set(draft, Number(t)));
        }}
        onBlur={() => setTyping(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onStart();
          if (e.key === "Escape") onCancel();
        }}
      />
      <span className={styles.dimText}>{field.unit}</span>
    </label>
  );
}
