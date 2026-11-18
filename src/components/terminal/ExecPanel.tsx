"use client";

import type { FrameExecution } from "@/engine/feed";
import { perShareCents } from "@/engine/executionReport";
import { formatAvgPrice, formatBps, formatCentsPerShare, formatDollarsX2, formatMidX2, formatQty } from "@/lib/format";
import { costBps } from "@/lib/exrBps";
import { Explain, useLearn } from "./Learn";
import styles from "./terminal.module.css";
import { Time } from "./Time";

const per = (x2: number | null, qty: number) => (x2 === null ? null : perShareCents(x2, qty));

/**
 * EXR: the execution report. For every order, the price you intended (the mid when it arrived)
 * against the average price you got, split into the cost of crossing the spread and the cost of the
 * order's own size. Costs show in basis points of the order's value (D-072); Learn mode adds the
 * arrival mid and cents per share. All figures come from the fill log. A positive cost is money lost
 * to the market; negative is price improvement.
 */
export function ExecPanel({ exr, showTotals = true }: { exr: FrameExecution | null; /** False for a subset of the orders, whose totals the engine's are not (D-086). */ showTotals?: boolean }) {
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
        <table className={`${styles.table} ${styles.fillsTable}`}>
          <thead>
            <tr>
              <th title="Sim time of the order's first fill.">TIME</th>
              <th title="Buy or sell.">B/S</th>
              <th title="Who sent it: YOU by hand, or STRAT, your strategy.">SRC</th>
              <th title="Shares filled.">QTY</th>
              <th title="Average price you got.">AVG</th>
              <th title="Total slippage in basis points (hundredths of a percent) of the order's value at the arrival mid. Positive is a cost.">SLIP</th>
              <th title="Basis points paid just to cross from the mid to the best price on the other side.">SPREAD</th>
              <th title="Basis points your own size cost beyond the best price: the order pushing the price against itself.">IMPACT</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) => [
              <tr key={r.orderId} data-testid="exr-row">
                <td>
                  <Time ms={r.time} />
                </td>
                <td>{r.side === "buy" ? "B" : "S"}</td>
                <td data-testid="exr-src">{r.source === "strategy" ? "STRAT" : "YOU"}</td>
                <td>{formatQty(r.qty)}</td>
                <td>{formatAvgPrice(r.avgPrice)}</td>
                <td>{formatBps(costBps(r.slippageX2, r))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatBps(costBps(r.spreadX2, r))}</td>
                <td>{r.aggressiveQty === 0 ? "—" : formatBps(costBps(r.impactX2, r))}</td>
              </tr>,
              // Learn mode: the arrival mid and the cost in cents per share, on a line of their own so the table keeps its width.
              ...(learn
                ? [
                    <tr key={`${r.orderId}-learn`} className={styles.fillsLearn} data-explain="exr.row">
                      <td colSpan={8}>
                        <span className={styles.label}>ARR MID</span> <span data-testid="exr-arrival">{r.arrivalMidX2 === null ? "—" : formatMidX2(r.arrivalMidX2)}</span> · <span className={styles.label}>SLIP ¢/SH</span> {formatCentsPerShare(per(r.slippageX2, r.qty))}
                      </td>
                    </tr>,
                  ]
                : []),
            ])}
          </tbody>
        </table>
      </div>
      {showTotals && (
      <div className={styles.exrTotal} data-testid="exr-total">
        {t.slippageX2 === null || t.spreadX2 === null || t.impactX2 === null || t.passiveX2 === null ? (
          <dl className={styles.totals} title="No order had an arrival mid (one side of the book was empty), so there is no intended price to measure slippage against.">
            <div>
              <dt>QTY</dt>
              <dd>{formatQty(t.qty)}</dd>
            </div>
            <div>
              <dt>SLIP</dt>
              <dd>NO ARRIVAL MID</dd>
            </div>
          </dl>
        ) : (
          // Totals as labels over values (D-076): SLIP = SPREAD + IMPACT (+ RESTING), in dollars, and in BPS.
          <dl className={styles.totals}>
            <div title="Total slippage in dollars: the sum of every order's cost versus its arrival mid.">
              <dt>SLIP</dt>
              <dd>{formatDollarsX2(t.slippageX2)}</dd>
            </div>
            <div title="Total slippage in basis points of the orders' value at their arrival mids.">
              <dt>BPS</dt>
              <dd>{formatBps(t.slippageBps)}</dd>
            </div>
            <div title="Paid to cross from the mid to the best price.">
              <dt>SPREAD</dt>
              <dd>{formatDollarsX2(t.spreadX2)}</dd>
            </div>
            <div title="Paid for your own size beyond the best price.">
              <dt>IMPACT</dt>
              <dd>{formatDollarsX2(t.impactX2)}</dd>
            </div>
            {t.passiveX2 !== 0 && (
              <div title="Resting fills versus their arrival mid; negative means you earned the spread.">
                <dt>RESTING</dt>
                <dd>{formatDollarsX2(t.passiveX2)}</dd>
              </div>
            )}
            <div>
              <dt>QTY</dt>
              <dd>{formatQty(t.qty)}</dd>
            </div>
            <div>
              <dt>ORDERS</dt>
              <dd>{t.orders}</dd>
            </div>
          </dl>
        )}
      </div>
      )}
    </div>
  );
}
