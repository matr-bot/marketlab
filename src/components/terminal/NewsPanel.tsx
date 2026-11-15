"use client";

import type { Scenario } from "@/engine/scenarios";
import { SCENARIOS } from "@/engine/scenarios";
import type { AgentType } from "@/engine/types";
import { formatDollars, formatElapsed, formatPercent, formatPrice, formatQty, formatBps } from "@/lib/format";
import { fairValueChange, releaseLine, releaseValue } from "@/engine/economicReleases";
import { formatSimTime } from "@/engine/simClock";
import { scenarioProgress, type HeadlineState, type MarketState } from "@/lib/marketState";
import styles from "./terminal.module.css";
import { useOverflowFade } from "./useOverflowFade";

const TYPE_LABELS: Partial<Record<AgentType, string>> = {
  marketMaker: "MARKET MAKERS",
  noise: "NOISE TRADERS",
  value: "VALUE TRADERS",
  panic: "PANIC SELLERS",
  user: "YOU",
};
const TYPE_ORDER: readonly AgentType[] = ["marketMaker", "value", "panic", "noise", "user"];

/** The first-minute P&L of the newest headline that has one, by trader type. */
function latestImpact(headlines: readonly HeadlineState[]): HeadlineState | null {
  for (let i = headlines.length - 1; i >= 0; i--) if (headlines[i].pnlByType !== null) return headlines[i];
  return null;
}

/**
 * NEWS: the scenario and its headlines. Headlines are typed in the command bar, and the AI's
 * parameters are checked and edited in the NEWS strip under it (D-052); this panel is the record.
 * The brief and task say what the situation is and what to do; the numbers underneath (price since the open, progress on the target, who made and lost money
 * in the minute after each headline) come from the engine, so they are the debrief.
 */
export function NewsPanel({ scenario, market, onCommand }: { scenario: Scenario; market: MarketState; onCommand: (text: string) => void }) {
  const { ref: fade } = useOverflowFade<HTMLDivElement>();
  const p = scenarioProgress(market, scenario);
  const headlines = [...market.headlines].reverse().slice(0, 4);
  const impact = latestImpact(market.headlines);
  const pnl = impact?.pnlByType ?? null;
  const done = p.elapsedSec >= scenario.durationSec;
  const mm = pnl?.marketMaker;
  const informed = pnl?.value;
  const releaseHeadline = headlines.find((h) => h.release !== undefined);
  const scheduled = scenario.shocks.filter((s) => s.release !== undefined);
  return (
    <div className={styles.newsWrap} data-testid="news-panel">
      {/* Pinned: what the scenario is, how far along, and the target if it has one, always visible (QA #6). */}
      <div className={styles.newsPinned}>
        <div className={styles.scnHead}>
          <span className={styles.scnTitle} data-testid="scenario-title">
            {scenario.title}
          </span>
          <span className={styles.dim} title="Time since the scenario opened, of the suggested time.">
            {formatElapsed(p.elapsedSec)} / {formatElapsed(scenario.durationSec)}
            {done ? " · TIME" : ""}
          </span>
        </div>
        <div className={styles.progress} aria-hidden>
          <div className={styles.progressBar} style={{ width: `${Math.min(100, (100 * p.elapsedSec) / scenario.durationSec)}%` }} />
        </div>
        {p.target !== null && (
          <div className={styles.statRow} data-testid="scenario-target">
            <span>
              <span className={styles.label}>TARGET</span> {p.target.side.toUpperCase()} {formatQty(p.target.qty)}
            </span>
            <span>
              <span className={styles.label}>DONE</span> {formatQty(p.target.filled)}
            </span>
            <span>
              <span className={styles.label}>LEFT</span> {formatQty(p.target.remaining)}
            </span>
            <span title="Your slippage across all your orders, in basis points of their value.">
              <span className={styles.label}>SLIPPAGE</span> {formatBps(p.target.slippageBps)} bp
            </span>
          </div>
        )}
      </div>
      <div ref={fade} className={styles.newsScroll}>
        <p className={styles.para}>
          <span className={styles.label}>TASK </span>
          {scenario.task}
        </p>
        <p className={styles.para}>{scenario.brief}</p>
        <p className={styles.dim}>
          <span className={styles.label}>TEACHES </span>
          {scenario.teaches}
        </p>

        <div className={styles.statRow} data-testid="scenario-stats">
          <span title="The last trade price when the scenario opened.">
            <span className={styles.label}>OPEN</span> {p.open === null ? "—" : formatPrice(p.open)}
          </span>
          <span>
            <span className={styles.label}>LAST</span> {p.last === null ? "—" : formatPrice(p.last)}
          </span>
          <span>
            <span className={styles.label}>CHG</span> {p.open === null || p.last === null ? "—" : formatPercent(p.last - p.open, p.open)}
          </span>
          <span>
            <span className={styles.label}>LOW</span> {p.low === null ? "—" : formatPrice(p.low)}
          </span>
          <span>
            <span className={styles.label}>HIGH</span> {p.high === null ? "—" : formatPrice(p.high)}
          </span>
        </div>

        {scheduled.length > 0 && <div className={styles.releaseCalendar} data-testid="release-calendar">
          <div className={styles.sectionHead}>HYPOTHETICAL RELEASE CALENDAR</div>
          {scheduled.map((s) => {
            const at = market.startTime + s.atSec * 1_000;
            const landed = market.headlines.some((h) => h.time >= at && h.code === s.code && h.release !== undefined);
            return <div key={`${s.code}-${s.atSec}`} className={styles.releaseRow} data-indicator={s.code} data-state={landed ? "released" : "upcoming"}>
              <span>{formatSimTime(at).slice(0, 8)}</span>
              <span>{s.code}</span>
              <span>FORECAST {releaseValue(s.release!.indicator, s.release!.forecast)}</span>
              <span>{landed ? "RELEASED" : `IN ${formatElapsed(Math.ceil((at - market.frame.time) / 1000))}`}</span>
            </div>;
          })}
        </div>}

        {releaseHeadline?.release !== undefined && <div className={styles.releaseCard} data-testid="release-card" data-indicator={releaseHeadline.release.indicator}>
          <div className={styles.sectionHead}>HYPOTHETICAL RELEASE · {releaseHeadline.release.indicator}</div>
          <p>{releaseLine(releaseHeadline.release)}</p>
          <p>FAIR VALUE {fairValueChange(releaseHeadline.fairValuePct)} · {releaseHeadline.reaction === null ? "30 s price reaction pending" : releaseHeadline.reaction.pricePct === null ? "no post-release trades in 30 s" : (() => {
            const pricePct = releaseHeadline.reaction.pricePct;
            const overshoot = pricePct !== 0 && Math.sign(pricePct) === Math.sign(releaseHeadline.fairValuePct) && Math.abs(pricePct) > Math.abs(releaseHeadline.fairValuePct);
            return `PRICE ${pricePct > 0 ? "+" : ""}${pricePct.toFixed(2)}% IN 30 S${overshoot ? " (OVERSHOOT)" : ""}`;
          })()}</p>
          <p>PANIC {releaseHeadline.release.shock.panicSensitivity.toFixed(2)}× · VOLATILITY {releaseHeadline.release.shock.volatilityMultiplier.toFixed(2)}× · LIQUIDITY {releaseHeadline.release.shock.liquidityMultiplier.toFixed(2)}×</p>
          <p className={styles.dim}>Price is the last executed trade before the release versus the last executed trade in its first 30 s.</p>
        </div>}


        <div className={styles.sectionHead}>HEADLINES</div>
        {headlines.length === 0 ? (
          <p className={styles.dim}>{scenario.shocks.length > 0 ? "Nothing has hit the market yet." : "None yet. Type a headline in your own words, FED, or SHOCK -3 to send one."}</p>
        ) : (
          headlines.map((h) => (
            <div key={h.seq} className={styles.headlineRow} data-testid="headline-row">
              <span className={styles.dim}>{formatElapsed((h.time - market.startTime) / 1000)}</span>
              <span className={styles.headlineCode}>{h.code}</span>
              <span className={styles.headlineText}>{h.headline}</span>
              <span title="The jump in what the stock is worth.">FV {h.fairValuePct > 0 ? "+" : ""}{(h.fairValuePct * 100).toFixed(1)}%</span>
            </div>
          ))
        )}

        {pnl !== null && impact !== null && (
          <div data-testid="impact">
            <div className={styles.sectionHead} title="Change in cash + shares × mid for each kind of trader in the 60 seconds after the headline.">
              WHO MADE OR LOST MONEY · 60 S AFTER {impact.code}
            </div>
            {TYPE_ORDER.filter((t) => pnl[t] !== undefined && (t !== "user" || pnl[t] !== 0)).map((t) => (
              <div key={t} className={styles.impactRow}>
                <span>{TYPE_LABELS[t]}</span>
                <span>{formatDollars(pnl[t]!, true)}</span>
              </div>
            ))}
            {mm !== undefined && informed !== undefined && mm < 0 && informed > 0 && (
              <p className={styles.dim}>Market makers lost while value traders gained: the makers were trading against people who knew the news (adverse selection).</p>
            )}
          </div>
        )}

        {/* Last, so the brief and task get the room on a short screen; SCN <name> does the same from the keyboard. */}
        <div className={styles.sectionHead}>SCENARIOS · SCN &lt;NAME&gt;</div>
        <div className={styles.scnPicker} role="group" aria-label="Scenarios">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.chip} ${s.id === scenario.id ? styles.segOn : ""}`}
              aria-pressed={s.id === scenario.id}
              data-testid={`scn-${s.id}`}
              title={`${s.title}. ${s.brief}`}
              onClick={() => onCommand(`SCN ${s.id}`)}
            >
              {s.id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
