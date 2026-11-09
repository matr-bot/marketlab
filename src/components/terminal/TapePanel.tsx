"use client";

import type { FrameTrade } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";
import { useOverflowFade } from "./useOverflowFade";

const ROWS = 60;

/**
 * Time & sales: every trade, newest first. Each print is colored by the side that initiated it
 * (buyer green ▲, seller red ▼), so its color always agrees with its AGGRESSOR label (D-042).
 */
export function TapePanel({ tape }: { tape: readonly FrameTrade[] }) {
  const { ref: fade } = useOverflowFade<HTMLDivElement>();
  return (
    <div ref={fade} className={styles.tapeWrap}>
      <table className={styles.table} data-testid="tape">
        <thead>
          <tr>
            <th>TIME</th>
            <th>PRICE</th>
            <th>SIZE</th>
            <th>AGGRESSOR</th>
          </tr>
        </thead>
        <tbody>
          {tape.slice(0, ROWS).map((t) => {
            const buyer = t.aggressor === "buy";
            // Green and red are price direction only: the price and its arrow follow the tick (up or down
            // from the previous trade); who crossed the spread is in the side hues (QA #5).
            const tick = t.tick === "up" ? styles.up : styles.down;
            return (
              <tr key={t.seq} data-aggressor={t.aggressor} data-tick={t.tick}>
                <td>{formatSimTime(t.time)}</td>
                <td className={tick}>
                  {formatPrice(t.price)} {t.tick === "up" ? "▲" : "▼"}
                </td>
                <td>{formatQty(t.qty)}</td>
                <td className={buyer ? styles.sideBuy : styles.sideSell}>{buyer ? "BUYER" : "SELLER"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
