"use client";

import { topType, type Attribution } from "@/engine/attribution";
import { formatQty, traderName } from "@/lib/format";
import { whoTable } from "@/lib/who";
import { Explain } from "./Learn";
import styles from "./terminal.module.css";

const signed = (n: number) => (n > 0 ? `+${formatQty(n)}` : formatQty(n));

/**
 * WHO moved the price (D-054, D-076): aggressive volume by trader type as a fixed table, one row per
 * type whether it traded or not (zero rows in gray), so nothing shifts as types come and go. SELL QTY
 * hit bids, BUY QTY lifted asks; % is the type's share of all aggressive volume in the window (whole
 * percentages that sum to 100); NET is buying minus selling. The last 60 s by default; a clicked GP
 * candle shows that candle's window (the header says which).
 */
export function WhoPanel({ who }: { who: Attribution }) {
  const { rows, net } = whoTable(who);
  const main = who.selling.shares >= who.buying.shares ? { word: "selling", side: who.selling } : { word: "buying", side: who.buying };
  const top = topType(main.side);
  return (
    <div className={styles.who} data-testid="who">
      <Explain id="who.window" />
      {top !== null && (
        <Explain id="who.summary">
          <span className={styles.whoSummary} data-testid="who-summary">
            {top.pct}% of {main.word} came from {traderName(top.type)}.
          </span>
        </Explain>
      )}
      <table className={`${styles.table} ${styles.whoTable}`}>
        <thead>
          <tr>
            <th>AGENT</th>
            <th title="Shares sold aggressively: sellers who hit the bid.">SELL QTY</th>
            <th title="Shares bought aggressively: buyers who lifted the ask.">BUY QTY</th>
            <th title="Share of all aggressive volume in the window, both sides. The rows add up to 100.">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const zero = r.sell === 0 && r.buy === 0;
            return (
              <tr key={r.key} data-type={r.key} data-zero={zero || undefined} className={zero ? styles.whoZero : undefined} title={r.name}>
                <td>{r.label}</td>
                <td>{formatQty(r.sell)}</td>
                <td>{formatQty(r.buy)}</td>
                <td className={styles.whoPct}>
                  <span className={styles.whoBar} style={{ width: `${r.pct}%` }} aria-hidden />
                  <span className={styles.whoPctText}>{r.pct}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.whoNet} data-testid="who-net">
            <td title="Aggressive buying minus aggressive selling in the window.">NET</td>
            <td colSpan={2} className={net > 0 ? styles.up : net < 0 ? styles.down : undefined}>
              {signed(net)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
