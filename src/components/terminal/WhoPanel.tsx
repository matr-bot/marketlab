"use client";

import { topType, type Attribution, type SideAttribution } from "@/engine/attribution";
import { formatQty, traderName } from "@/lib/format";
import styles from "./terminal.module.css";

function Side({ label, side }: { label: string; side: SideAttribution }) {
  const rows = (Object.entries(side.byType) as Array<[string, number]>).sort((a, b) => b[1] - a[1]);
  return (
    <div className={styles.whoSide}>
      <div className={styles.whoHead}>
        <span>{label}</span>
        <span className={styles.num}>{formatQty(side.shares)} sh</span>
      </div>
      {rows.map(([type, shares]) => (
        <div key={type} className={styles.whoRow} data-type={type}>
          <span>{traderName(type)}</span>
          <span className={styles.num}>{formatQty(shares)}</span>
          <span className={styles.num}>{side.pct[type as keyof typeof side.pct]}%</span>
          <span className={styles.whoBar} style={{ width: `${side.pct[type as keyof typeof side.pct]}%` }} aria-hidden />
        </div>
      ))}
    </div>
  );
}

/**
 * WHO moved the price (D-054): aggressive volume by trader type, exact shares, whole percentages
 * that add up to 100. The last 60 s by default; a clicked GP candle shows that candle's window (the
 * header says which, D-071).
 */
export function WhoPanel({ who }: { who: Attribution }) {
  const main = who.selling.shares >= who.buying.shares ? { word: "selling", side: who.selling } : { word: "buying", side: who.buying };
  const top = topType(main.side);
  return (
    <div className={styles.who} data-testid="who">
      {who.trades === 0 || top === null ? (
        <div className={styles.chatEmpty}>No trades in this window.</div>
      ) : (
        <>
          <div className={styles.whoSummary} data-testid="who-summary">
            {top.pct}% of {main.word} came from {traderName(top.type)}.
          </div>
          <Side label="SELLING (hit bids)" side={who.selling} />
          <Side label="BUYING (lifted asks)" side={who.buying} />
        </>
      )}
    </div>
  );
}
