"use client";

import type { Frame } from "@/engine/feed";
import type { DepthLevel } from "@/engine/types";
import { formatMid, formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

/** One level, with a depth bar behind it: width = this level's size ÷ the largest size shown. */
function Level({ level, side, maxQty }: { level: DepthLevel; side: "BID" | "ASK"; maxQty: number }) {
  return (
    <div className={styles.bookRow} data-side={side}>
      <span className={styles.bookSide}>{side}</span>
      <span>{level.orderCount}</span>
      <span>{formatQty(level.qty)}</span>
      <span>{formatPrice(level.price)}</span>
      <span aria-hidden className={`${styles.depthBar} ${side === "BID" ? styles.depthBid : styles.depthAsk}`} style={{ width: `${(100 * level.qty) / maxQty}%` }} />
    </div>
  );
}

/**
 * Best bid/ask and the levels behind them, each with a depth bar (dim green bids, dim red asks)
 * so thinning liquidity is visible at a glance. No change highlights here: price flashes belong
 * to the status bar and TAPE. Asks sit above the spread (best at the bottom), bids below it
 * (best at the top); each half shows as many levels as fit, so the best prices are always on screen.
 */
export function BookPanel({ frame }: { frame: Frame }) {
  const spread = frame.bid !== null && frame.ask !== null ? frame.ask - frame.bid : null;
  const maxQty = Math.max(1, ...frame.asks.map((l) => l.qty), ...frame.bids.map((l) => l.qty));
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
          <Level key={`a${l.price}`} level={l} side="ASK" maxQty={maxQty} />
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
          <Level key={`b${l.price}`} level={l} side="BID" maxQty={maxQty} />
        ))}
      </div>
    </div>
  );
}
