"use client";

import { Panel } from "@/components/Panel";
import { formatInterval } from "@/lib/format";
import { BookPanel } from "./BookPanel";
import { CommandBar } from "./CommandBar";
import { PriceChart } from "./PriceChart";
import { StatusBar } from "./StatusBar";
import { TapePanel } from "./TapePanel";
import { TickerTape } from "./TickerTape";
import styles from "./terminal.module.css";
import { useMarket } from "./useMarket";

/**
 * The terminal. Panels keep their default-layout numbers (CLAUDE.md); functions that have not
 * shipped yet are simply not drawn, and the grid closes up around the ones that have.
 */
export function Terminal() {
  const { status, sendShock } = useMarket();

  if (status.kind === "opening") return <div className={styles.opening}>OPENING MARKET</div>;
  if (status.kind === "error") {
    return (
      <div className={styles.error} role="alert">
        The market stopped: {status.message}. Reload the page to reopen it.
      </div>
    );
  }

  const { frame, candles, tape, frameCount } = status.market;
  return (
    <div className={styles.shell}>
      <StatusBar frame={frame} />
      <TickerTape ticker={frame.ticker} trades={frame.trades} headlines={frame.headlines} frameCount={frameCount} />
      <CommandBar onShock={sendShock} />
      <main className={styles.grid}>
        <Panel number={1} code="GP" title={`${frame.ticker} PRICE · ${formatInterval(frame.candleMs)} CANDLES`} className={styles.gp}>
          <PriceChart candles={candles} candleMs={frame.candleMs} last={frame.last} headlines={frame.headlines} />
        </Panel>
        <Panel number={4} code="TAPE" title="TIME & SALES" className={styles.tape}>
          <TapePanel tape={tape} />
        </Panel>
        <Panel number={5} code="BOOK" title={`${frame.ticker} DEPTH`} className={styles.book}>
          <BookPanel frame={frame} />
        </Panel>
      </main>
    </div>
  );
}
