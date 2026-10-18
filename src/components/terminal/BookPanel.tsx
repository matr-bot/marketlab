"use client";

import { useEffect, useRef, useState } from "react";
import type { Frame } from "@/engine/feed";
import type { DepthLevel } from "@/engine/types";
import { formatMid, formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

/** Minimum row height in px; rows stretch to fill the panel exactly. */
const ROW_H = 16;

/**
 * Levels to show per side: as many as fit in `height` (header and spread rows take one row each).
 * Both sides show the same number, capped by the thinner side, so the spread stays centered. If a
 * side is empty (a one-sided book in a crash), the other side still shows its levels and the empty
 * side shows one "NO BIDS" / "NO ASKS" row, never a blank panel.
 */
export function levelsPerSide(height: number, asks: number, bids: number): { asks: number; bids: number } {
  const fit = Math.max(1, Math.floor((height - 2 * ROW_H) / (2 * ROW_H)));
  if (asks === 0 || bids === 0) return { asks: Math.min(fit, asks), bids: Math.min(fit, bids) };
  const n = Math.min(fit, asks, bids);
  return { asks: n, bids: n };
}

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
 * to the status bar and TAPE. Asks sit above the spread (best at the bottom), bids below it (best
 * at the top), the same number on each side, so the spread is always centered and the panel full.
 */
export function BookPanel({ frame }: { frame: Frame }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const n = height === 0 ? { asks: 0, bids: 0 } : levelsPerSide(height, frame.asks.length, frame.bids.length);
  const asks = frame.asks.slice(0, n.asks).reverse();
  const bids = frame.bids.slice(0, n.bids);
  const spread = frame.bid !== null && frame.ask !== null ? frame.ask - frame.bid : null;
  const maxQty = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  return (
    <div ref={boxRef} className={styles.bookPanel} data-testid="book" data-levels={Math.min(n.asks, n.bids)}>
      <div className={`${styles.bookRow} ${styles.bookHead}`}>
        <span>SIDE</span>
        <span>ORDERS</span>
        <span>SIZE</span>
        <span>PRICE</span>
      </div>
      <div className={styles.bookAsks}>
        {frame.asks.length === 0 && height > 0 && <div className={`${styles.bookRow} ${styles.bookEmpty}`}>NO ASKS</div>}
        {asks.map((l) => (
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
        {frame.bids.length === 0 && height > 0 && <div className={`${styles.bookRow} ${styles.bookEmpty}`}>NO BIDS</div>}
        {bids.map((l) => (
          <Level key={`b${l.price}`} level={l} side="BID" maxQty={maxQty} />
        ))}
      </div>
    </div>
  );
}
