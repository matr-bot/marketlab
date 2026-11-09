"use client";

import { useState } from "react";
import type { FrameStrategy } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { ENTRY_RULES, STRATEGY_LIMITS, type EntryRule, type StrategyDecision, type StrategySpec } from "@/engine/strategy";
import { formatDollars, formatQty } from "@/lib/format";
import { describeRules, RULE_LABELS } from "@/lib/glassbox/english";
import { dollars } from "@/lib/glassbox/formulas";
import styles from "./terminal.module.css";
import { useOverflowFade } from "./useOverflowFade";

/** What STRAT shows: typing an idea, waiting for the AI, a preview to check and edit, or the live strategy. */
export type StratState =
  | { readonly phase: "compose"; readonly message: string | null }
  | { readonly phase: "interpreting"; readonly text: string }
  | { readonly phase: "preview"; readonly text: string; readonly source: StratSource; readonly reason: string; readonly draft: StrategySpec }
  | { readonly phase: "live" };

/** Where a spec came from. Offline results are never labelled as the AI's. */
export type StratSource = "ai" | "cache" | "offline";

export const SOURCE_LABELS: Record<StratSource, string> = { ai: "AI", cache: "AI (CACHED)", offline: "UNDERSTOOD OFFLINE · NOT THE AI" };

export const SHARPE_NOTE =
  "Annualized from one-second returns with the sim's clock: a year is 252 sessions of 23,400 s. Short runs are noisy: a Sharpe from a few minutes of data means little, and a big number here is not a skill signal.";

const EXAMPLES = ["Buy after a quick 3% drop because panic sellers overshoot", "Short after a 1% rally in 30 seconds, stop loss 1%, take profit 0.5%"];

type NumField = { key: string; label: string; unit: string; get: (s: StrategySpec) => number | null; set: (s: StrategySpec, v: number | null) => StrategySpec; optional: boolean; range: string };

const FIELDS: readonly NumField[] = [
  { key: "pct", label: "MOVE", unit: "%", get: (s) => s.entry.pct * 100, set: (s, v) => ({ ...s, entry: { ...s.entry, pct: (v ?? 0) / 100 } }), optional: false, range: "0.1 to 20 %" },
  { key: "windowSec", label: "WITHIN", unit: "s", get: (s) => s.entry.windowSec, set: (s, v) => ({ ...s, entry: { ...s.entry, windowSec: v ?? 0 } }), optional: false, range: `${STRATEGY_LIMITS.windowSec[0]} to ${STRATEGY_LIMITS.windowSec[1]} s` },
  { key: "stopLossPct", label: "STOP LOSS", unit: "%", get: (s) => (s.stopLossPct === null ? null : s.stopLossPct * 100), set: (s, v) => ({ ...s, stopLossPct: v === null ? null : v / 100 }), optional: true, range: "0.1 to 20 %, blank = off" },
  { key: "takeProfitPct", label: "TAKE PROFIT", unit: "%", get: (s) => (s.takeProfitPct === null ? null : s.takeProfitPct * 100), set: (s, v) => ({ ...s, takeProfitPct: v === null ? null : v / 100 }), optional: true, range: "0.1 to 50 %, blank = off" },
  { key: "timeExitSec", label: "TIME EXIT", unit: "s", get: (s) => s.timeExitSec, set: (s, v) => ({ ...s, timeExitSec: v }), optional: true, range: "5 to 3,600 s, blank = off" },
  { key: "qty", label: "SHARES", unit: "", get: (s) => s.qty, set: (s, v) => ({ ...s, qty: v ?? 0 }), optional: false, range: "1 to 10,000" },
  { key: "cooldownSec", label: "COOLDOWN", unit: "s", get: (s) => s.cooldownSec, set: (s, v) => ({ ...s, cooldownSec: v ?? 0 }), optional: false, range: "0 to 600 s" },
];

/** A field's text while typing: kept as typed until it parses, so "0." is not thrown away. */
function viewOf(v: number | null): string {
  return v === null ? "" : String(Number(v.toFixed(4)));
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
}) {
  const [text, setText] = useState("");
  const { ref: fade } = useOverflowFade<HTMLDivElement>();

  if (state.phase === "compose" || state.phase === "interpreting") {
    const busy = state.phase === "interpreting";
    return (
      <div ref={fade} className={styles.strat} data-testid="strat" data-phase={state.phase}>
        <p className={styles.dim}>Describe a trading idea in plain English. It becomes rules from a fixed menu (buy or sell after a drop or rise, stop loss, take profit, time exit) that you check before it trades.</p>
        <textarea
          className={styles.stratInput}
          data-testid="strat-input"
          aria-label="Strategy"
          placeholder={EXAMPLES[0]}
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
        {busy ? <div className={styles.dim}>Reading your rules…</div> : state.message !== null && <div className={styles.note} data-testid="strat-message">{state.message}</div>}
        <div className={styles.formRow}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className={styles.chip} disabled={busy} onClick={() => setText(ex)}>
              {ex.length > 34 ? `${ex.slice(0, 33)}…` : ex}
            </button>
          ))}
        </div>
        {strategy !== null && <div className={styles.dim}>Your last strategy is {strategy.status === "running" ? "still running: starting a new one replaces it" : "stopped"}.</div>}
      </div>
    );
  }

  if (state.phase === "preview") {
    const { draft } = state;
    const lines = describeRules(draft);
    const lineFor = (key: string) => lines.find((l) => l.key === key || (key === "pct" || key === "windowSec" || key === "qty" ? l.key === "entry" : false))?.text;
    return (
      <div ref={fade} className={styles.strat} data-testid="strat" data-phase="preview">
        <div className={styles.stratSource}>
          <span className={styles.label}>{SOURCE_LABELS[state.source]}</span> <span className={styles.dimText}>read “{state.text}” as:</span>
        </div>
        <label className={styles.stratField}>
          <span className={styles.label}>RULE</span>
          <select
            className={styles.input}
            data-field="rule"
            value={draft.entry.rule}
            onChange={(e) => onEdit({ ...draft, entry: { ...draft.entry, rule: e.target.value as EntryRule } })}
          >
            {ENTRY_RULES.map((r) => (
              <option key={r} value={r}>
                {RULE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.stratGrid}>
          {FIELDS.map((f) => (
            <PreviewField key={f.key} field={f} draft={draft} onEdit={onEdit} onStart={onStart} onCancel={onCancel} explain={lineFor(f.key)} />
          ))}
        </div>
        <div className={styles.formRow}>
          <button type="button" className={`${styles.chip} ${styles.segOn}`} data-testid="strat-start" onClick={onStart}>
            START (ENTER)
          </button>
          <button type="button" className={styles.chip} onClick={onCancel}>
            CANCEL (ESC)
          </button>
        </div>
        <ul className={styles.stratRules} data-testid="strat-rules">
          {lines.map((l) => (
            <li key={l.key}>{l.text}</li>
          ))}
        </ul>
        {state.reason && <div className={styles.newsReason}>AI&apos;s reason: “{state.reason}”</div>}
      </div>
    );
  }

  // Live: the strategy as the engine runs it.
  if (strategy === null) return <div ref={fade} className={styles.strat} data-testid="strat" data-phase="starting">Starting at the next tick…</div>;
  const sh = strategy.sharpe;
  const dd = strategy.drawdown;
  const lastDecision = decisions.at(-1) ?? null;
  const status = strategy.status === "running" ? (strategy.inPosition ? "RUNNING · IN A POSITION" : "RUNNING · WAITING FOR THE ENTRY") : strategy.status === "closing" ? "STOPPED · CLOSING LEFTOVER SHARES" : "STOPPED";
  return (
    <div ref={fade} className={styles.strat} data-testid="strat" data-phase="live" data-status={strategy.status}>
      <div className={styles.stratHead}>
        <span className={styles.simTag} data-testid="strat-status">
          {status}
        </span>
      </div>
      <div className={styles.formRow}>
        <button type="button" className={`${styles.chip} ${styles.segOn}`} data-testid="strat-reveal" onClick={onReveal}>
          SHOW ME WHAT I BUILT
        </button>
        {strategy.status === "running" && (
          <button type="button" className={styles.chip} data-testid="strat-stop" onClick={onStop}>
            STOP
          </button>
        )}
        <button type="button" className={styles.chip} data-testid="strat-new" onClick={onNew}>
          NEW
        </button>
      </div>
      <div className={styles.dim}>{describeRules(strategy.spec)[0].text}</div>
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
      <div className={styles.dim} title={SHARPE_NOTE} data-testid="strat-samples">
        {sh === null ? "Sharpe needs at least two one-second returns." : `Sharpe from ${formatQty(sh.n)} one-second returns · short runs are noisy`}
      </div>
      <div className={styles.lastMessage} data-testid="strat-last">
        {lastDecision === null ? "No decision yet: waiting for the entry rule." : decisionLine(lastDecision)}
      </div>
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
