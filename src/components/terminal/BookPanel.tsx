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

type OpenOrder = Frame["desk"]["openOrders"][number];

/** The student's resting orders not at any of the levels shown (QA #8). */
export function ordersBeyond(orders: readonly OpenOrder[], asks: readonly DepthLevel[], bids: readonly DepthLevel[]): OpenOrder[] {
  const shown = new Set([...asks.map((l) => `sell ${l.price}`), ...bids.map((l) => `buy ${l.price}`)]);
  return orders.filter((o) => !shown.has(`${o.side} ${o.price}`));
}

/** The widest depth bar, in % of the row: the largest level never tints the whole row (D-071). */
export const BAR_MAX_PCT = 50;

/**
 * One level, with a depth bar behind it, right-anchored: width = this level's size ÷ the largest size
 * shown, scaled to BAR_MAX_PCT. The tint is the side (D-068), so there is no SIDE column (D-071).
 * `mine`: the student's shares resting here (outlined row, tooltip).
 */
function Level({ level, side, maxQty, mine }: { level: DepthLevel; side: "BID" | "ASK"; maxQty: number; mine: number }) {
  return (
    <div className={`${styles.bookRow} ${mine > 0 ? styles.bookMine : ""}`} data-side={side} data-mine={mine > 0 || undefined} title={mine > 0 ? `Your order: ${formatQty(mine)} of these ${formatQty(level.qty)} shares` : undefined}>
      <span>{level.orderCount}</span>
      <span>{formatQty(level.qty)}</span>
      <span>{formatPrice(level.price)}</span>
      <span aria-hidden className={`${styles.depthBar} ${side === "BID" ? styles.depthBid : styles.depthAsk}`} style={{ width: `${(BAR_MAX_PCT * level.qty) / maxQty}%` }} />
    </div>
  );
}

/**
 * Best bid/ask and the levels behind them, each with a depth bar in its side's muted tint (D-068)
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
  const open = frame.desk.openOrders;
  const fitAll = height === 0 ? { asks: 0, bids: 0 } : levelsPerSide(height, frame.asks.length, frame.bids.length);
  // If any of the student's orders would be off screen, give up one row to say where they are (QA #8).
  const reserve = open.length > 0 && ordersBeyond(open, frame.asks.slice(0, fitAll.asks), frame.bids.slice(0, fitAll.bids)).length > 0;
  const n = reserve ? levelsPerSide(height - ROW_H, frame.asks.length, frame.bids.length) : fitAll;
  const asks = frame.asks.slice(0, n.asks).reverse();
  const bids = frame.bids.slice(0, n.bids);
  const beyond = reserve ? ordersBeyond(open, asks, bids) : [];
  const mineAt = (side: "buy" | "sell", price: number) => open.reduce((t, o) => (o.side === side && o.price === price ? t + o.qty : t), 0);
  const spread = frame.bid !== null && frame.ask !== null ? frame.ask - frame.bid : null;
  const maxQty = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  return (
    <div ref={boxRef} className={styles.bookPanel} data-testid="book" data-levels={Math.min(n.asks, n.bids)}>
      <div className={`${styles.bookRow} ${styles.bookHead}`}>
        <span>ORDERS</span>
        <span>SIZE</span>
        <span>PRICE</span>
      </div>
      <div className={styles.bookAsks}>
        {frame.asks.length === 0 && height > 0 && <div className={`${styles.bookRow} ${styles.bookEmpty}`}>NO ASKS · liquidity vacuum</div>}
        {asks.map((l) => (
          <Level key={`a${l.price}`} level={l} side="ASK" maxQty={maxQty} mine={mineAt("sell", l.price)} />
        ))}
      </div>
      <div className={`${styles.bookRow} ${styles.bookSpread}`}>
        <span>SPREAD</span>
        <span>{spread === null ? "—" : formatPrice(spread)}</span>
        <span>{frame.bid === null || frame.ask === null ? "" : `MID ${formatMid(frame.bid, frame.ask)}`}</span>
      </div>
      <div className={styles.bookBids}>
        {frame.bids.length === 0 && height > 0 && <div className={`${styles.bookRow} ${styles.bookEmpty}`}>NO BIDS · liquidity vacuum</div>}
        {bids.map((l) => (
          <Level key={`b${l.price}`} level={l} side="BID" maxQty={maxQty} mine={mineAt("buy", l.price)} />
        ))}
      </div>
      {beyond.length > 0 && (
        <div className={`${styles.bookRow} ${styles.bookBeyond}`} data-testid="book-beyond" title={beyond.map((o) => `Your ${o.side} order: ${formatQty(o.qty)} @ ${formatPrice(o.price)}, beyond the levels shown`).join("\n")}>
          YOUR {beyond.slice(0, 1).map((o) => `${o.side === "buy" ? "BUY" : "SELL"} ${formatQty(o.qty)} @ ${formatPrice(o.price)}`)}
          {beyond.length > 1 ? ` +${beyond.length - 1} more` : ""} · further out
        </div>
      )}
    </div>
  );
}
