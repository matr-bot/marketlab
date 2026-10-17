"use client";

import type { FrameTrade } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

const ROWS = 60;

/** Time & sales: every trade, newest first, colored by tick direction. */
export function TapePanel({ tape }: { tape: readonly FrameTrade[] }) {
  return (
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
        {tape.slice(0, ROWS).map((t) => (
          <tr key={t.seq}>
            <td>{formatSimTime(t.time)}</td>
            <td className={t.tick === "up" ? styles.up : styles.down}>
              {formatPrice(t.price)} {t.tick === "up" ? "▲" : "▼"}
            </td>
            <td>{formatQty(t.qty)}</td>
            <td className={styles.bookSide}>{t.aggressor === "buy" ? "BUYER" : "SELLER"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
