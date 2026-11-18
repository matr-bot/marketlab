"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatSimTime } from "@/engine/simClock";
import { PriceChart } from "../terminal/PriceChart";
import { Time } from "../terminal/Time";
import { useMarket } from "../terminal/useMarket";
import { WhoPanel } from "../terminal/WhoPanel";
import styles from "./landing.module.css";

/** The run replayed (D-084): the Fed hike scenario on the demo seed. Read-only: nothing is ever sent to it. */
const SCENARIO = "rate-shock";
/** Sim time after the open when the loop starts again: 30 s calm, the hike, 60 s of crash and recovery. */
const LOOP_MS = 90_000;
/** 4× real time: about 7.5 s calm, then the hike, a loop of about 22 s. */
const SPEED = 4;
/** The chart shows the last three minutes, so calm candles stand before the crash (D-087). */
const WINDOW_MS = 180_000;
/** Widest candle slot in the hero chart, px: three minutes of 10 s candles fill it. */
const HERO_SLOT = 40;
/** Desk lines in the log. */
const LOG_LINES = 6;
const noop = () => undefined;
const HANDLERS = { onShockResult: noop, onOrderResult: noop, onWho: noop, onRunData: noop };

/**
 * The landing hero (D-084, D-087): a looping replay of the FED moment from the real engine in a worker,
 * seed 187, the rate-shock scenario. Left: `intro` (the line and OPEN TERMINAL), then the replay's event
 * log, the desk narrator's own lines for this run, synced and reset with each loop. Right: a mini GP of
 * the last three minutes over the WHO table. Same seed and no inputs, so every loop is the same market
 * (CLAUDE.md, Engine rules: seeded and deterministic); a new loop is a RERUN.
 */
export function HeroReplay({ seed, intro }: { seed: number; intro: ReactNode }) {
  const [loop, setLoop] = useState(0);
  const { status } = useMarket({ seed, scenarioId: SCENARIO, runId: loop, strategy: null }, { speed: SPEED, paused: false }, HANDLERS);
  const market = status.kind === "live" ? status.market : null;
  const done = market !== null && market.frame.time - market.startTime >= LOOP_MS;
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setLoop((n) => n + 1), 0);
    return () => window.clearTimeout(t);
  }, [done]);
  const candles = market === null ? [] : market.candles.filter((c) => c.start > market.frame.time - WINDOW_MS);
  const log = market === null ? [] : market.chat.filter((c) => c.time >= market.startTime).slice(-LOG_LINES);

  return (
    <section className={styles.hero} aria-label="MarketLab">
      <div className={styles.heroText}>
        {intro}
        <div className={styles.replayLog} data-testid="replay-log" data-loop={loop} aria-live="off">
          <div className={styles.replayLogHead}>REPLAY LOG · DESK</div>
          {log.length === 0 ? (
            <div className={styles.dim}>—</div>
          ) : (
            log.map((c) => (
              <div key={c.seq} className={styles.replayLine} data-kind={c.kind}>
                <span className={styles.replayTime}>
                  <Time ms={c.time} />
                </span>
                <span>{c.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className={styles.replay} data-testid="replay" data-loop={loop} aria-label={`Replay of a simulated Fed hike, seed ${seed}`}>
        <div className={styles.replayHead}>
          <span>REPLAY · SEED {seed}</span>
          <span>{market === null ? "" : formatSimTime(market.frame.time).slice(0, 8)}</span>
        </div>
        <div className={styles.replayChart}>{market !== null && <PriceChart candles={candles} candleMs={market.frame.candleMs} last={market.frame.last} headlines={market.headlines} maxSlot={HERO_SLOT} />}</div>
        <div className={styles.replayWho}>{market !== null && <WhoPanel who={market.frame.who} />}</div>
      </div>
    </section>
  );
}
