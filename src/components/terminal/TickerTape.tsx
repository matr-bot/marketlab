"use client";

import { useEffect, useRef } from "react";
import type { FrameHeadline, FrameTrade } from "@/engine/feed";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

const GAP_PX = 28;
const BASE_SPEED = 50; // px per second when quiet
const MAX_SPEED = 260;
/** Waiting items beyond this many strip widths are skipped, so the strip shows recent trades (D-040). */
const MAX_BACKLOG_WIDTHS = 2;
/** At most this many items exist in the strip; the oldest are dropped (D-051). */
export const MAX_TICKER_ITEMS = 20;
/** On the first frame (the warm-up), only the most recent trades enter the strip. */
const FIRST_FRAME_TRADES = 12;

interface Item {
  readonly el: HTMLSpanElement;
  x: number;
  readonly w: number;
  /** Headlines are never skipped. */
  readonly headline?: boolean;
}

/**
 * The scrolling ticker: each trade slides in from the right as `MLAB 1,340 @ 187.42 ▲`, green or red
 * by tick direction. It speeds up when trades queue up and slows when quiet. This strip is the one
 * place smooth scrolling is allowed; the numbers inside never change once printed. Headlines scroll
 * through in amber and jump the queue: waiting trades are skipped so the news enters at once.
 */
export function TickerTape({ ticker, trades, headlines, frameCount }: { ticker: string; trades: readonly FrameTrade[]; headlines: readonly FrameHeadline[]; frameCount: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const items = useRef<Item[]>([]);
  const seenFrame = useRef(0);

  // New trades from this frame join the end of the queue.
  useEffect(() => {
    const box = boxRef.current;
    if (box === null || frameCount === seenFrame.current) return; // each frame's trades join once
    seenFrame.current = frameCount;
    const queue = items.current;
    const width = box.clientWidth;
    // New headlines first (each arrives in exactly one frame): drop the trades still waiting to
    // enter, then the headline enters next.
    for (const h of headlines) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].x >= width && !queue[i].headline) queue.splice(i, 1)[0].el.remove();
      const el = document.createElement("span");
      el.className = `${styles.tickerItem} ${styles.headlineItem}`;
      el.dataset.headline = h.code;
      el.textContent = `${h.headline.toUpperCase()} · FAIR VALUE ${h.fairValuePct > 0 ? "+" : ""}${(h.fairValuePct * 100).toFixed(1)}%`;
      box.appendChild(el);
      const tail = queue[queue.length - 1];
      const item: Item = { el, x: Math.max(width, tail ? tail.x + tail.w : 0), w: el.offsetWidth + GAP_PX, headline: true };
      el.style.transform = `translateX(${item.x}px)`;
      queue.push(item);
    }
    const fresh = frameCount === 1 ? trades.slice(-FIRST_FRAME_TRADES) : trades;
    for (const t of fresh) {
      const el = document.createElement("span");
      el.className = `${styles.tickerItem} ${t.tick === "up" ? styles.up : styles.down}`;
      el.textContent = `${ticker} ${formatQty(t.qty)} @ ${formatPrice(t.price)} ${t.tick === "up" ? "▲" : "▼"}`;
      box.appendChild(el);
      const tail = queue[queue.length - 1];
      // The market is already running on load: the first frame's trades start across the strip.
      const entry = frameCount === 1 ? 0 : width;
      const item: Item = { el, x: Math.max(entry, tail ? tail.x + tail.w : 0), w: el.offsetWidth + GAP_PX };
      el.style.transform = `translateX(${item.x}px)`;
      queue.push(item);
    }
    // Too far behind: skip the oldest items that have not entered the strip yet.
    let waiting = queue.length > 0 ? queue[queue.length - 1].x + queue[queue.length - 1].w - width : 0;
    while (waiting > MAX_BACKLOG_WIDTHS * width) {
      const i = queue.findIndex((it) => it.x >= width && !it.headline);
      if (i < 0 || i === queue.length - 1) break;
      const [skipped] = queue.splice(i, 1);
      skipped.el.remove();
      for (let j = i; j < queue.length; j++) queue[j].x -= skipped.w;
      waiting -= skipped.w;
    }
    // Never more than MAX_TICKER_ITEMS nodes: drop waiting trades first, then the oldest items.
    while (queue.length > MAX_TICKER_ITEMS) {
      const waitingTrade = queue.findIndex((it) => it.x >= width && !it.headline);
      if (waitingTrade >= 0) {
        // Not on screen yet: remove it and close the gap behind it.
        const [dropped] = queue.splice(waitingTrade, 1);
        dropped.el.remove();
        for (let j = waitingTrade; j < queue.length; j++) queue[j].x -= dropped.w;
      } else {
        queue.shift()!.el.remove(); // the oldest, at the left edge
      }
    }
  }, [frameCount, trades, headlines, ticker]);

  // Scroll loop.
  useEffect(() => {
    let raf = 0;
    let before = performance.now();
    const step = (now: number) => {
      const box = boxRef.current;
      const queue = items.current;
      const dt = Math.min(0.1, (now - before) / 1000);
      before = now;
      if (box !== null && queue.length > 0) {
        const width = box.clientWidth;
        const tail = queue[queue.length - 1];
        const backlog = Math.max(0, tail.x + tail.w - width);
        const dx = Math.min(MAX_SPEED, BASE_SPEED + backlog * 0.15) * dt;
        for (const it of queue) {
          it.x -= dx;
          it.el.style.transform = `translateX(${it.x}px)`;
        }
        while (queue.length > 0 && queue[0].x + queue[0].w < 0) queue.shift()!.el.remove();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={boxRef} className={styles.tickerTape} data-testid="ticker" aria-label="Trade ticker" />;
}
