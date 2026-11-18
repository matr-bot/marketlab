"use client";

import type { ReactNode } from "react";
import type { Candle, Frame, FrameExecution, FrameHeadline, FrameStrategy } from "@/engine/feed";
import { formatChange, formatDollars, formatPercent, formatPrice, formatQty } from "@/lib/format";
import { EquityCurve } from "./EquityCurve";
import { ExecPanel } from "./ExecPanel";
import { Explain } from "./Learn";
import { PriceChart } from "./PriceChart";
import { SHARPE_NOTE } from "./StrategyPanel";
import styles from "./terminal.module.css";
import { useFlash } from "./useFlash";

/**
 * The STRATEGY workspace (D-086), full screen under the status strip: the rule builder (left), the glass
 * box for what is being built or run (centre), and the results (right): the equity curve per sim second,
 * the strategy's metrics and its own fills in BPS, with the live price small in the corner. The market
 * keeps running; TRADE (⌥1) is one key away.
 */
export function StrategyWorkspace({
  builder,
  glass,
  strategy,
  equity,
  exr,
  frame,
  candles,
  headlines,
  openPrice,
}: {
  builder: ReactNode;
  glass: ReactNode;
  strategy: Omit<FrameStrategy, "newDecisions"> | null;
  equity: readonly number[];
  exr: FrameExecution | null;
  frame: Frame;
  candles: readonly Candle[];
  headlines: readonly FrameHeadline[];
  openPrice: number | null;
}) {
  const lastRef = useFlash<HTMLSpanElement>(frame.last);
  const base = openPrice ?? frame.open;
  const last = frame.last ?? base;
  const change = last - base;
  const stratOrders = exr === null ? null : { ...exr, orders: exr.orders.filter((o) => o.source === "strategy") };
  const sh = strategy?.sharpe ?? null;
  const dd = strategy?.drawdown ?? null;
  return (
    <main className={styles.workspace} data-testid="strategy-workspace">
      <section className={`${styles.wsPane} ${styles.wsBuilder}`} aria-label="Rule builder" data-pane="builder">
        <header className={styles.wsHead}>RULES</header>
        <div className={styles.wsBody}>{builder}</div>
      </section>
      <section className={styles.wsPane} aria-label="Glass box" data-pane="glass">
        <header className={styles.wsHead}>GLASS BOX · RULES → FORMULAS → PYTHON</header>
        <div className={`${styles.wsBody} ${styles.wsScroll}`}>{glass}</div>
      </section>
      <section className={styles.wsPane} aria-label="Results" data-pane="results">
        <div className={styles.wsPrice} data-testid="ws-price">
          <div className={styles.wsPriceHead}>
            <span className={styles.label}>{frame.ticker}</span>
            <span ref={lastRef} className={styles.wsLast}>
              {formatPrice(last)}
            </span>
            <span className={change > 0 ? styles.up : change < 0 ? styles.down : undefined}>
              {formatChange(change)} ({formatPercent(change, base)})
            </span>
          </div>
          <div className={styles.wsPriceChart}>
            <PriceChart candles={candles} candleMs={frame.candleMs} last={frame.last} headlines={headlines} readout={false} />
          </div>
        </div>
        <header className={styles.wsHead}>RESULTS</header>
        <div className={`${styles.wsBody} ${styles.wsScroll}`}>
          <EquityCurve equity={equity} />
          <dl className={styles.stratStats} data-testid="ws-stats">
            <div>
              <dt>P&amp;L</dt>
              <dd>{strategy === null ? "—" : formatDollars(strategy.pnl, true)}</dd>
            </div>
            <div title={SHARPE_NOTE}>
              <dt>SHARPE</dt>
              <dd>{sh === null ? "—" : sh.sharpe.toFixed(2)}</dd>
            </div>
            <div>
              <dt>MAX DD</dt>
              <dd>{dd === null ? "—" : formatDollars(-Math.round(dd.drawdown))}</dd>
            </div>
            <div>
              <dt>TRADES</dt>
              <dd>{strategy === null ? "—" : formatQty(strategy.trades)}</dd>
            </div>
            <div>
              <dt>N</dt>
              <dd>{sh === null ? "—" : formatQty(sh.n)}</dd>
            </div>
          </dl>
          <Explain id="strat.sharpe" />
          <div className={styles.wsHeadInline}>
            <span className={styles.label}>FILLS · STRAT</span>
            <span className={styles.label}>BPS</span>
          </div>
          <div className={styles.wsFills}>
            <ExecPanel exr={stratOrders} showTotals={false} />
          </div>
        </div>
      </section>
    </main>
  );
}
