"use client";

import { useCallback, useState } from "react";
import { Panel } from "@/components/Panel";
import type { PresetResult } from "@/engine/feed";
import { parseCommand } from "@/lib/command";
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
  const [reply, setReply] = useState("Type FED, CEO, BEAT or DOWNGRADE and press Enter to send a headline.");
  // The worker decides whether a headline is accepted (at most one per 3 s of sim time, D-051).
  const onShockResult = useCallback((r: PresetResult) => setReply(r.ok ? `${r.code} · ${r.headline}` : r.message), []);
  const { status, sendShock } = useMarket(onShockResult);
  const onCommand = (text: string) => {
    const cmd = parseCommand(text);
    if (cmd.kind === "error") setReply(cmd.message);
    if (cmd.kind === "shock") sendShock(cmd.code);
  };

  if (status.kind === "opening") return <div className={styles.opening}>OPENING MARKET</div>;
  if (status.kind === "error") {
    return (
      <div className={styles.error} role="alert">
        The market stopped: {status.message}. Reload the page to reopen it.
      </div>
    );
  }

  const { frame, candles, tape, frameCount, headlines } = status.market;
  return (
    <div className={styles.shell}>
      <StatusBar frame={frame} />
      <TickerTape ticker={frame.ticker} trades={frame.trades} headlines={frame.headlines} frameCount={frameCount} />
      <CommandBar onCommand={onCommand} reply={reply} />
      <main className={styles.grid}>
        <Panel number={1} code="GP" title={`${frame.ticker} PRICE · ${formatInterval(frame.candleMs)} CANDLES`} className={styles.gp}>
          <PriceChart candles={candles} candleMs={frame.candleMs} last={frame.last} headlines={headlines} />
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
