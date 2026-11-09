// Strategy metrics (CLAUDE.md, Glass box rules; D-063). One definition everywhere: the engine
// computes these, the glass box shows the formula with these numbers in it, and the generated
// Python computes them the same way, in the same order of operations, so all three agree exactly.
//
// Returns are taken once per sim second: r_i = (E_i − E_{i−1}) ÷ capital, where E is the strategy's
// equity (cash + shares × mid) and capital is its size × the first mid it saw. Annualizing uses the
// sim's own clock: one return per sim second, and a trading year of 252 sessions × 23,400 s (the
// session runs 09:30 to 16:00). This replaces D-032's "no annualizing" for Sharpe only.

/** Sessions in a trading year. */
export const TRADING_DAYS_PER_YEAR = 252;
/** Seconds in one session, 09:30 to 16:00. */
export const SESSION_SECONDS = 23_400;
/** Sim seconds between returns. */
export const RETURN_INTERVAL_SEC = 1;
/** Returns in a trading year: 252 × 23,400 ÷ 1 = 5,896,800. */
export const PERIODS_PER_YEAR = (TRADING_DAYS_PER_YEAR * SESSION_SECONDS) / RETURN_INTERVAL_SEC;
/** Annual risk-free rate, a round figure near short Treasury bill yields. Shown in the formula. */
export const RISK_FREE_ANNUAL = 0.04;

export interface SharpeResult {
  /** Returns behind the number. */
  readonly n: number;
  /** Mean return per second. */
  readonly mean: number;
  /** Sample standard deviation of returns (n − 1), per second. */
  readonly sd: number;
  /** Risk-free return per second: RISK_FREE_ANNUAL ÷ PERIODS_PER_YEAR. */
  readonly rfPerPeriod: number;
  /** √PERIODS_PER_YEAR. */
  readonly annualFactor: number;
  /** (mean − rf) ÷ sd × √PERIODS_PER_YEAR. */
  readonly sharpe: number;
}

export interface DrawdownResult {
  /** Largest fall from a running peak, in cents (≥ 0). */
  readonly drawdown: number;
  /** As a fraction of capital. */
  readonly pct: number;
  /** Equity at that peak and at the trough after it, in cents. */
  readonly peak: number;
  readonly trough: number;
}

/** One return per step of the equity series, as a fraction of capital. */
export function returnsOf(equity: readonly number[], capital: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) out.push((equity[i] - equity[i - 1]) / capital);
  return out;
}

/** Annualized Sharpe of per-second returns; null with fewer than 2 returns or no variation. */
export function sharpeOf(returns: readonly number[]): SharpeResult | null {
  const n = returns.length;
  if (n < 2) return null;
  let total = 0;
  for (let i = 0; i < n; i++) total += returns[i];
  const mean = total / n;
  let squares = 0;
  for (let i = 0; i < n; i++) {
    const d = returns[i] - mean;
    squares += d * d;
  }
  const sd = Math.sqrt(squares / (n - 1));
  if (sd === 0) return null;
  const rfPerPeriod = RISK_FREE_ANNUAL / PERIODS_PER_YEAR;
  const annualFactor = Math.sqrt(PERIODS_PER_YEAR);
  return { n, mean, sd, rfPerPeriod, annualFactor, sharpe: ((mean - rfPerPeriod) / sd) * annualFactor };
}

/** Largest peak-to-trough fall of the equity series; null if it has no points. */
export function maxDrawdownOf(equity: readonly number[], capital: number): DrawdownResult | null {
  if (equity.length === 0) return null;
  let peak = equity[0];
  let best = 0;
  let bestPeak = equity[0];
  let bestTrough = equity[0];
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = peak - equity[i];
    if (dd > best) {
      best = dd;
      bestPeak = peak;
      bestTrough = equity[i];
    }
  }
  return { drawdown: best, pct: best / capital, peak: bestPeak, trough: bestTrough };
}
