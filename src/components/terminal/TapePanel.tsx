"use client";

import type { FrameTrade } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

const ROWS = 60;

/**
 * Time & sales: every trade, newest first. Each print is colored by the side that initiated it
 * (buyer green ▲, seller red ▼), so its color always agrees with its AGGRESSOR label (D-042).
 */
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
        {tape.slice(0, ROWS).map((t) => {
          const buyer = t.aggressor === "buy";
          const side = buyer ? styles.up : styles.down;
          return (
            <tr key={t.seq} data-aggressor={t.aggressor}>
              <td>{formatSimTime(t.time)}</td>
              <td className={side}>
                {formatPrice(t.price)} {buyer ? "▲" : "▼"}
              </td>
              <td>{formatQty(t.qty)}</td>
              <td className={side}>{buyer ? "BUYER" : "SELLER"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
