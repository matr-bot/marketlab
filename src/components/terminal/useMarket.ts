"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_SEED } from "@/engine/demoMarket";
import { applyFrame, type MarketState } from "@/lib/marketState";
import type { FromWorker, ToWorker } from "@/worker/protocol";

export type MarketStatus = { readonly kind: "opening" } | { readonly kind: "live"; readonly market: MarketState } | { readonly kind: "error"; readonly message: string };

/**
 * Starts the simulation worker and asks it for one frame per animation frame (D-037). The next
 * request goes out only after the previous frame has arrived, so frames never queue up. While the
 * tab is hidden the browser stops animation frames, so the market pauses with it.
 */
export function useMarket(seed: number = DEMO_SEED, speed = 1): MarketStatus {
  const [status, setStatus] = useState<MarketStatus>({ kind: "opening" });
  // Read through a ref so a speed change takes effect on the next frame without restarting the market.
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const worker = new Worker(new URL("../../worker/sim.worker.ts", import.meta.url), { type: "module" });
    const send = (msg: ToWorker) => worker.postMessage(msg);
    let market: MarketState | null = null;
    let raf = 0;
    let stopped = false;

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (stopped) return;
      const msg = event.data;
      if (msg.type === "error") {
        setStatus({ kind: "error", message: msg.message });
        return;
      }
      market = applyFrame(market, msg.frame);
      setStatus({ kind: "live", market });
      raf = requestAnimationFrame(() => send({ type: "frame", speed: speedRef.current }));
    };
    worker.onerror = (event) => {
      if (!stopped) setStatus({ kind: "error", message: event.message || "the simulation worker failed to load" });
    };
    send({ type: "start", seed });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      worker.terminate();
    };
  }, [seed]);

  return status;
}
