"use client";

import { formatDollars } from "@/lib/format";
import styles from "./terminal.module.css";

const W = 600;
const H = 160;

/**
 * The strategy's equity (D-086): the engine's own record, cash + shares × mid in cents, once per sim
 * second from the strategy's start (the series behind its Sharpe and drawdown). Same seed and spec, same
 * curve. Drawn as an SVG line over a zero line; `data-equity` carries the values for tests.
 */
export function EquityCurve({ equity }: { equity: readonly number[] }) {
  if (equity.length < 2) {
    return (
      <div className={styles.equity} data-testid="equity" data-equity={equity.join(",")}>
        <span className={styles.dim}>—</span>
      </div>
    );
  }
  const lo = Math.min(0, ...equity);
  const hi = Math.max(0, ...equity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (equity.length - 1)) * W;
  const y = (v: number) => 4 + ((hi - v) / span) * (H - 8);
  const last = equity[equity.length - 1];
  return (
    <div className={styles.equity} data-testid="equity" data-equity={equity.join(",")}>
      <div className={styles.equityHead}>
        <span className={styles.label}>EQUITY · P&amp;L PER SIM SECOND</span>
        <span>
          <span className={styles.label}>N</span> {equity.length} <span className={styles.label}>LAST</span> {formatDollars(Math.round(last), true)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.equitySvg} aria-label="Strategy equity, one point per sim second" role="img">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className={styles.equityZero} />
        <polyline points={equity.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} className={styles.equityLine} />
      </svg>
      <div className={styles.equityAxis}>
        <span>{formatDollars(Math.round(hi), true)}</span>
        <span>{formatDollars(Math.round(lo), true)}</span>
      </div>
    </div>
  );
}
