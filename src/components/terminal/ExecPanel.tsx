"use client";

import type { FrameExecution } from "@/engine/feed";
import { perShareCents } from "@/engine/executionReport";
import { formatSimTime } from "@/engine/simClock";
import { formatAvgPrice, formatBps, formatCentsPerShare, formatDollarsX2, formatMidX2, formatQty } from "@/lib/format";
import { costBps } from "@/lib/exrBps";
import { Explain, useLearn } from "./Learn";
import styles from "./terminal.module.css";

const per = (x2: number | null, qty: number) => (x2 === null ? null : perShareCents(x2, qty));

/**
 * EXR: the execution report. For every order, the price you intended (the mid when it arrived)
 * against the average price you got, split into the cost of crossing the spread and the cost of the
 * order's own size. Costs show in basis points of the order's value (D-072); Learn mode adds the
 * arrival mid and cents per share. All figures come from the fill log. A positive cost is money lost
 * to the market; negative is price improvement.
 */
export function ExecPanel({ exr }: { exr: FrameExecution | null }) {
  const learn = useLearn();
  if (exr === null || exr.orders.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="exr-empty">
        <p className={styles.dim}>—</p>
        <Explain id="exr.empty" />
      </div>
    );
  }
  const t = exr.totals;
  const rows = [...exr.orders].reverse();
  return (
    <div className={styles.exrWrap} data-testid="exr">
      <Explain id="exr.what" />
      <div className={styles.exrScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th title="Sim time of the order's first fill.">TIME</th>
              <th title="Buy or sell.">B/S</th>
              <th title="Who sent it: YOU by hand, or STRAT, your strategy.">SRC</th>
              <th title="Shares filled.">QTY</th>
              <th title="Average price you got.">AVG</th>
              {learn && <th title="The mid price when your order arrived: the price you intended.">ARR MID</th>}
              {learn && <th title="Total slippage, cents per share: average price vs the arrival mid. Positive is a cost.">SLIP ¢/SH</th>}
              <th title="Total slippage in basis points (hundredths of a percent) of the order's value at the arrival mid. Positive is a cost.">SLIP</th>
              <th title="Basis points paid just to cross from the mid to the best price on the other side.">SPREAD</th>
              <th title="Basis points your own size cost beyond the best price: the order pushing the price against itself.">IMPACT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orderId} data-testid="exr-row">
                <td>{formatSimTime(r.time)}</td>
                <td>{r.side === "buy" ? "B" : "S"}</td>
                <td data-testid="exr-src">{r.source === "strategy" ? "STRAT" : "YOU"}</td>
                <td>{formatQty(r.qty)}</td>
                <td>{formatAvgPrice(r.avgPrice)}</td>
                {learn && <td>{r.arrivalMidX2 === null ? "—" : formatMidX2(r.arrivalMidX2)}</td>}
                {learn && <td>{formatCentsPerShare(per(r.slippageX2, r.qty))}</td>}
                <td>{formatBps(costBps(r.slippageX2, r))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatBps(costBps(r.spreadX2, r))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatBps(costBps(r.impactX2, r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.exrTotal} data-testid="exr-total">
        {t.slippageX2 === null || t.spreadX2 === null || t.impactX2 === null || t.passiveX2 === null ? (
          <span title="No order had an arrival mid (one side of the book was empty), so there is no intended price to measure slippage against.">
            <span className={styles.label}>QTY</span> {formatQty(t.qty)} · NO ARRIVAL MID
          </span>
        ) : (
          <span>
            <span className={styles.label}>SLIP</span> {formatDollarsX2(t.slippageX2)} · {formatBps(t.slippageBps)} <span className={styles.label}>BPS</span> <span className={styles.dim}>=</span> <span className={styles.label}>SPREAD</span>{" "}
            {formatDollarsX2(t.spreadX2)} <span className={styles.dim}>+</span> <span className={styles.label}>IMPACT</span> {formatDollarsX2(t.impactX2)}
            {t.passiveX2 !== 0 && (
              <>
                {" "}
                <span className={styles.dim}>+</span> <span className={styles.label}>RESTING</span> {formatDollarsX2(t.passiveX2)}
              </>
            )}
            <span className={styles.dim}>
              {" "}
              · <span className={styles.label}>QTY</span> {formatQty(t.qty)} · <span className={styles.label}>ORDERS</span> {t.orders}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
