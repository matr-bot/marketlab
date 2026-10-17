"use client";

import type { Frame } from "@/engine/feed";
import type { DepthLevel } from "@/engine/types";
import { formatMid, formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";
import { useFlash } from "./useFlash";

function Level({ level, side }: { level: DepthLevel; side: "BID" | "ASK" }) {
  const sizeRef = useFlash<HTMLSpanElement>(level.qty, "neutral");
  return (
    <div className={styles.bookRow}>
      <span className={styles.bookSide}>{side}</span>
      <span>{level.orderCount}</span>
      <span ref={sizeRef}>{formatQty(level.qty)}</span>
      <span>{formatPrice(level.price)}</span>
    </div>
  );
}

/**
 * Best bid/ask and the levels behind them. Asks sit above the spread (best at the bottom), bids
 * below it (best at the top); each half shows as many levels as fit, so the best prices are always
 * the ones on screen.
 */
export function BookPanel({ frame }: { frame: Frame }) {
  const spread = frame.bid !== null && frame.ask !== null ? frame.ask - frame.bid : null;
  return (
    <div className={styles.bookPanel} data-testid="book">
      <div className={`${styles.bookRow} ${styles.bookHead}`}>
        <span>SIDE</span>
        <span>ORDERS</span>
        <span>SIZE</span>
        <span>PRICE</span>
      </div>
      <div className={styles.bookAsks}>
        {[...frame.asks].reverse().map((l) => (
          <Level key={`a${l.price}`} level={l} side="ASK" />
        ))}
      </div>
      <div className={`${styles.bookRow} ${styles.bookSpread}`}>
        <span>SPREAD</span>
        <span />
        <span>{spread === null ? "—" : formatPrice(spread)}</span>
        <span>{frame.bid === null || frame.ask === null ? "" : `MID ${formatMid(frame.bid, frame.ask)}`}</span>
      </div>
      <div className={styles.bookBids}>
        {frame.bids.map((l) => (
          <Level key={`b${l.price}`} level={l} side="BID" />
        ))}
      </div>
    </div>
  );
}
