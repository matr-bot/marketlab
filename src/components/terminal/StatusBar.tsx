"use client";

import type { ReactNode } from "react";
import { formatSimTime } from "@/engine/simClock";
import type { Frame } from "@/engine/feed";
import { formatChange, formatCompact, formatPercent, formatPrice, formatQty } from "@/lib/format";
import { Explain } from "./Learn";
import styles from "./terminal.module.css";
import { useFlash } from "./useFlash";

const Sep = () => <span className={styles.statusSep} aria-hidden />;

/**
 * The status strip, one row (D-073):
 * `MLAB 186.93 −0.02 (−0.01%) │ BID 186.93 × 6,342 ASK 186.94 × 113 │ VOL 221.5K │ 09:40:20 │ ● PAUSED │ SIMULATED`,
 * then the playback control on the right (`controls`). Change is measured from the scenario open, the
 * same baseline as NEWS (D-067). Volume is compact with the exact figure as its tooltip. Below 1400px
 * wide the touch sizes give way (BOOK's first rows show them), so the strip stays one row.
 */
export function StatusBar({ frame, openPrice, paused, controls }: { frame: Frame; openPrice: number | null; paused: boolean; controls: ReactNode }) {
  const base = openPrice ?? frame.open;
  const last = frame.last ?? base;
  const change = last - base;
  const lastRef = useFlash<HTMLSpanElement>(frame.last, "price");
  const direction = change > 0 ? styles.up : change < 0 ? styles.down : styles.num;
  const bidQty = frame.bids[0]?.qty ?? null;
  const askQty = frame.asks[0]?.qty ?? null;
  return (
    <header className={styles.status} data-testid="status-bar">
      <span className={styles.ticker}>{frame.ticker}</span>
      <span ref={lastRef} className={styles.last} data-testid="last-price">
        {formatPrice(last)}
      </span>
      <span className={direction} data-testid="status-change" title={`Change since this run opened, at ${formatPrice(base)}: the same baseline as NEWS.`}>
        {formatChange(change)} ({formatPercent(change, base)})
      </span>
      <Sep />
      <span className={styles.field} data-testid="status-quote">
        <span className={styles.label}>BID</span>
        <span className={styles.num}>{frame.bid === null ? "—" : formatPrice(frame.bid)}</span>
        <span className={styles.quoteSize}>
          <span className={styles.label}>×</span> <span className={styles.num}>{bidQty === null ? "—" : formatQty(bidQty)}</span>
        </span>
        <span className={`${styles.label} ${styles.gapLeft}`}>ASK</span>
        <span className={styles.num}>{frame.ask === null ? "—" : formatPrice(frame.ask)}</span>
        <span className={styles.quoteSize}>
          <span className={styles.label}>×</span> <span className={styles.num}>{askQty === null ? "—" : formatQty(askQty)}</span>
        </span>
      </span>
      <Sep />
      <span className={styles.field}>
        <span className={styles.label}>VOL</span>
        <span className={styles.num} data-testid="status-volume" title={`${formatQty(frame.volume)} shares traded`}>
          {formatCompact(frame.volume)}
        </span>
      </span>
      <Sep />
      <span className={styles.num} data-testid="sim-clock" title={formatSimTime(frame.time)}>
        {formatSimTime(frame.time).slice(0, 8)}
      </span>
      {paused && (
        <>
          <Sep />
          <span className={styles.alertTag} data-testid="paused-tag" title="The market is paused. RUN resumes it.">
            ● PAUSED
          </span>
        </>
      )}
      <Sep />
      <span className={styles.simTag} title="A simulated market: no real security, no real money">
        SIMULATED
      </span>
      <Explain id="status.agents" inline>
        every trade from {formatQty(frame.agents)} agents
      </Explain>
      <span className={styles.spacer} />
      {controls}
    </header>
  );
}
