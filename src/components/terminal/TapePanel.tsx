"use client";

import type { FrameTrade } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

const ROWS = 60;

/**
 * Time & sales: every trade, newest first. The price is green when it ticked up from the previous
 * trade and red when it ticked down, with no arrow (D-071); the side that crossed the spread is a
 * neutral label (D-067, D-068).
 */
export function TapePanel({ tape }: { tape: readonly FrameTrade[] }) {
  return (
    <div className={styles.tapeWrap}>
      <table className={styles.table} data-testid="tape">
        <thead>
          <tr>
            <th>TIME</th>
            <th>PX</th>
            <th>QTY</th>
            <th title="The side that crossed the spread: B a buyer lifted the ask, S a seller hit the bid.">B/S</th>
          </tr>
        </thead>
        <tbody>
          {tape.slice(0, ROWS).map((t) => {
            const buyer = t.aggressor === "buy";
            // The price's color is its tick (up or down from the previous trade), with no arrow (D-071);
            // who crossed the spread is a neutral label (D-067, D-068).
            const tick = t.tick === "up" ? styles.up : styles.down;
            return (
              <tr key={t.seq} data-aggressor={t.aggressor} data-tick={t.tick}>
                <td>{formatSimTime(t.time)}</td>
                <td className={tick}>
                  {formatPrice(t.price)}
                </td>
                <td>{formatQty(t.qty)}</td>
                <td className={buyer ? styles.sideBuy : styles.sideSell}>{buyer ? "B" : "S"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
