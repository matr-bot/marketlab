"use client";

import type { FrameExecution } from "@/engine/feed";
import { orderSlippageBps, perShareCents } from "@/engine/executionReport";
import { formatSimTime } from "@/engine/simClock";
import { formatAvgPrice, formatBps, formatCentsPerShare, formatDollarsX2, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";

const per = (x2: number | null, qty: number) => (x2 === null ? null : perShareCents(x2, qty));

/**
 * EXR: the execution report. For every order, the price you intended (the mid when it arrived)
 * against the average price you got, split into the cost of crossing the spread and the cost of the
 * order's own size. All figures are exact integer arithmetic from the fill log; "¢/SH" is cents per
 * share. A positive cost is money lost to the market; negative is price improvement.
 */
export function ExecPanel({ exr }: { exr: FrameExecution | null }) {
  if (exr === null || exr.orders.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="exr-empty">
        <p>No fills yet.</p>
        <p className={styles.dim}>Send an order from TKT, or type BUY 500. This report shows what each one really cost: the price you intended against the price you got.</p>
      </div>
    );
  }
  const t = exr.totals;
  const rows = [...exr.orders].reverse();
  return (
    <div className={styles.exrWrap} data-testid="exr">
      <div className={styles.exrScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th title="Sim time of the order's first fill.">TIME</th>
              <th title="Buy or sell.">SIDE</th>
              <th title="Shares filled.">QTY</th>
              <th title="Average price you got.">AVG</th>
              <th title="The mid price when your order arrived: the price you intended.">ARR MID</th>
              <th title="Total slippage, cents per share: average price vs the arrival mid. Positive is a cost.">SLIP ¢/SH</th>
              <th title="Cents per share you paid just to cross from the mid to the best price on the other side.">SPREAD</th>
              <th title="Cents per share your own size cost, beyond the best price: the order pushing the price against itself.">IMPACT</th>
              <th title="Slippage in basis points (hundredths of a percent) of the order's value.">BPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orderId} data-testid="exr-row">
                <td>{formatSimTime(r.time)}</td>
                <td>{r.side === "buy" ? "BUY" : "SELL"}</td>
                <td>{formatQty(r.qty)}</td>
                <td>{formatAvgPrice(r.avgPrice)}</td>
                <td>{r.arrivalMidX2 === null ? "—" : formatAvgPrice(r.arrivalMidX2 / 2)}</td>
                <td>{formatCentsPerShare(per(r.slippageX2, r.qty))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatCentsPerShare(per(r.spreadX2, r.qty))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatCentsPerShare(per(r.impactX2, r.qty))}</td>
                <td>{formatBps(orderSlippageBps(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.exrTotal} data-testid="exr-total">
        {t.slippageX2 === null || t.spreadX2 === null || t.impactX2 === null || t.passiveX2 === null ? (
          <span>
            TOTAL {formatQty(t.qty)} SH · NO ARRIVAL MID, SO NO SLIPPAGE FIGURE
          </span>
        ) : (
          <span>
            <span className={styles.label}>TOTAL COST</span> {formatDollarsX2(t.slippageX2)} ({formatBps(t.slippageBps)} bp) <span className={styles.dim}>=</span> <span className={styles.label}>SPREAD</span>{" "}
            {formatDollarsX2(t.spreadX2)} <span className={styles.dim}>+</span> <span className={styles.label}>IMPACT</span> {formatDollarsX2(t.impactX2)}
            {t.passiveX2 !== 0 && (
              <>
                {" "}
                <span className={styles.dim}>+</span> <span className={styles.label}>RESTING FILLS</span> {formatDollarsX2(t.passiveX2)}
              </>
            )}
            <span className={styles.dim}> · {formatQty(t.qty)} sh in {t.orders} order{t.orders === 1 ? "" : "s"}</span>
          </span>
        )}
      </div>
    </div>
  );
}
