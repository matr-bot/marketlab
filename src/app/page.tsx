import { Panel, Placeholder } from "@/components/Panel";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>MARKETLAB</span>
          <span className={styles.tagline}>experiment with how markets work</span>
        </div>
        <dl className={styles.status}>
          <div>
            <dt>Engine</dt>
            <dd className={styles.offline}>not running</dd>
          </div>
          <div>
            <dt>Ticker</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>—</dd>
          </div>
        </dl>
      </header>

      <main className={styles.grid}>
        <Panel title="Price" tag="Week 2" className={styles.chart}>
          <Placeholder>
            <strong>Live candlestick chart</strong>
            Prices come from trades between simulated agents in the order book — nothing is
            scripted.
          </Placeholder>
        </Panel>

        <Panel title="Order Book" tag="Week 3" className={styles.book}>
          <Placeholder>
            <strong>Depth view</strong>
            Resting bids and asks per price level, best prices at the center.
          </Placeholder>
        </Panel>

        <Panel title="Trade Feed" tag="Week 2" className={styles.feed}>
          <Placeholder>
            <strong>Time &amp; sales</strong>
            Every fill: time, price, size, aggressor side.
          </Placeholder>
        </Panel>

        <Panel title="Execution Report" tag="Week 4" className={styles.report}>
          <Placeholder>
            <strong>Reality check</strong>
            Intended vs. actual fill price (slippage), P&amp;L, Sharpe ratio, max drawdown.
          </Placeholder>
        </Panel>

        <Panel title="Scenario" tag="Week 4" className={styles.scenario}>
          <label className={styles.label} htmlFor="headline">
            News headline
          </label>
          <input
            id="headline"
            className={styles.input}
            placeholder="e.g. Fed surprise hike 75bps"
            disabled
          />
          <Placeholder>
            AI turns the headline into editable parameters: sentiment, fair-value shock,
            volatility, market-maker liquidity.
          </Placeholder>
        </Panel>

        <Panel title="Strategy" tag="Week 4" className={styles.strategy}>
          <label className={styles.label} htmlFor="strategy">
            Describe a strategy
          </label>
          <textarea
            id="strategy"
            className={styles.input}
            rows={3}
            placeholder="e.g. Buy after a quick 3% drop because panic sellers overshoot."
            disabled
          />
          <div className={styles.actions}>
            <button className={styles.button} disabled>
              Buy
            </button>
            <button className={`${styles.button} ${styles.sell}`} disabled>
              Sell
            </button>
          </div>
        </Panel>

        <Panel title="Glass Box" tag="Week 4" className={styles.glass}>
          <ol className={styles.steps}>
            <li>English</li>
            <li>Rules</li>
            <li>Formulas</li>
            <li>Python</li>
          </ol>
          <Placeholder>
            Your strategy shown four ways. The Python is generated from the same rule spec the
            engine runs, so what you see is exactly what traded.
          </Placeholder>
        </Panel>
      </main>
    </div>
  );
}
