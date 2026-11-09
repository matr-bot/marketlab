"use client";

import { formatSimTime } from "@/engine/simClock";
import type { Frame } from "@/engine/feed";
import { formatChange, formatPercent, formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";
import { useFlash } from "./useFlash";

/**
 * Ticker, last price, change and % change vs the open, volume, sim clock and seed, plus the scenario
 * running. A PAUSED or speed tag appears only when the market is not running at normal speed, so a
 * frozen or fast screen is never mistaken for a fault.
 */
export function StatusBar({ frame, scenarioTitle, paused, speed }: { frame: Frame; scenarioTitle: string; paused: boolean; speed: number }) {
  const last = frame.last ?? frame.open;
  const change = last - frame.open;
  const lastRef = useFlash<HTMLSpanElement>(frame.last, "price");
  const volRef = useFlash<HTMLSpanElement>(frame.volume, "neutral");
  const direction = change > 0 ? styles.up : change < 0 ? styles.down : styles.num;
  return (
    <header className={styles.status} data-testid="status-bar">
      <span className={styles.brand}>MARKETLAB</span>
      <span className={styles.ticker}>{frame.ticker}</span>
      <span className={styles.simTag} title="A simulated market: no real security, no real money">
        SIMULATED
      </span>
      {paused && (
        <span className={styles.simTag} data-testid="paused-tag" title="The market is paused. RUN resumes it.">
          PAUSED
        </span>
      )}
      {!paused && speed !== 1 && (
        <span className={styles.simTag} data-testid="speed-tag" title="Running faster than real time. Same seed, same market, whatever the speed.">
          {speed}X
        </span>
      )}
      <span ref={lastRef} className={styles.last} data-testid="last-price">
        {formatPrice(last)}
      </span>
      <span className={direction}>
        {formatChange(change)} {formatPercent(change, frame.open)}
      </span>
      <span className={styles.field}>
        <span className={styles.label}>VOL</span>
        <span ref={volRef} className={styles.num}>
          {formatQty(frame.volume)}
        </span>
      </span>
      <span className={styles.field}>
        <span className={styles.label}>BID</span>
        <span className={styles.num}>{frame.bid === null ? "—" : formatPrice(frame.bid)}</span>
        <span className={styles.label}>ASK</span>
        <span className={styles.num}>{frame.ask === null ? "—" : formatPrice(frame.ask)}</span>
      </span>
      <span className={styles.subtitle}>Simulated market · every trade from {formatQty(frame.agents)} agents</span>
      <span className={styles.spacer} />
      <span className={styles.num} data-testid="sim-clock">
        {formatSimTime(frame.time)}
      </span>
      <span className={styles.field} title="The scenario running. Open another with SCN.">
        <span className={styles.label}>SCN</span>
        <span className={styles.num} data-testid="status-scenario">
          {scenarioTitle}
        </span>
      </span>
      <span className={styles.field} title="The same seed gives the same market for everyone.">
        <span className={styles.label}>SEED</span>
        <span className={styles.num}>{frame.seed}</span>
      </span>
    </header>
  );
}
