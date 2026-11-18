"use client";

import { useEffect, useState } from "react";
import { formatSimTime } from "@/engine/simClock";
import { PriceChart } from "../terminal/PriceChart";
import { useMarket } from "../terminal/useMarket";
import { WhoPanel } from "../terminal/WhoPanel";
import styles from "./landing.module.css";

/** The run replayed (D-084): the Fed hike scenario on the demo seed. Read-only: nothing is ever sent to it. */
const SCENARIO = "rate-shock";
/** Sim time after the open when the loop starts again: 30 s calm, the hike, 60 s of crash and recovery. */
const LOOP_MS = 90_000;
/** 4× real time: about 7.5 s calm, then the hike, a loop of about 22 s. */
const SPEED = 4;
const noop = () => undefined;
const HANDLERS = { onShockResult: noop, onOrderResult: noop, onWho: noop, onRunData: noop };

/**
 * The landing hero (D-084): a looping replay of the FED moment from the real engine in a worker, seed
 * 187, the rate-shock scenario: calm, the hike's marker, the crash candle, and WHO filling with panic
 * sellers and value traders. Same seed and no inputs, so every loop is the same market (CLAUDE.md,
 * Engine rules: seeded and deterministic); a new loop is a RERUN.
 */
export function HeroReplay({ seed }: { seed: number }) {
  const [loop, setLoop] = useState(0);
  const { status } = useMarket({ seed, scenarioId: SCENARIO, runId: loop, strategy: null }, { speed: SPEED, paused: false }, HANDLERS);
  const market = status.kind === "live" ? status.market : null;
  const done = market !== null && market.frame.time - market.startTime >= LOOP_MS;
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setLoop((n) => n + 1), 0);
    return () => window.clearTimeout(t);
  }, [done]);

  return (
    <div className={styles.replay} data-testid="replay" data-loop={loop} aria-label={`Replay of a simulated Fed hike, seed ${seed}`}>
      <div className={styles.replayHead}>
        <span>REPLAY · SEED {seed}</span>
        <span>{market === null ? "" : formatSimTime(market.frame.time).slice(0, 8)}</span>
      </div>
      <div className={styles.replayChart}>{market !== null && <PriceChart candles={market.candles} candleMs={market.frame.candleMs} last={market.frame.last} headlines={market.headlines} />}</div>
      <div className={styles.replayWho}>{market !== null && <WhoPanel who={market.frame.who} />}</div>
    </div>
  );
}
