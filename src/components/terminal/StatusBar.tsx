"use client";

import { formatSimTime } from "@/engine/simClock";
import type { Frame } from "@/engine/feed";
import { formatChange, formatPercent, formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";
import { useFlash } from "./useFlash";

/** Ticker, last price, change and % change vs the open, volume, sim clock and seed. */
export function StatusBar({ frame }: { frame: Frame }) {
  const last = frame.last ?? frame.open;
  const change = last - frame.open;
  const lastRef = useFlash<HTMLSpanElement>(frame.last, "price");
  const volRef = useFlash<HTMLSpanElement>(frame.volume, "neutral");
  const direction = change > 0 ? styles.up : change < 0 ? styles.down : styles.num;
  return (
    <header className={styles.status} data-testid="status-bar">
      <span className={styles.brand}>MARKETLAB</span>
      <span className={styles.ticker}>{frame.ticker}</span>
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
      <span className={styles.spacer} />
      <span className={styles.num} data-testid="sim-clock">
        {formatSimTime(frame.time)}
      </span>
      <span className={styles.field}>
        <span className={styles.label}>SEED</span>
        <span className={styles.num}>{frame.seed}</span>
      </span>
    </header>
  );
}
