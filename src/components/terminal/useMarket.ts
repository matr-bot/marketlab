"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Attribution } from "@/engine/attribution";
import type { PresetResult } from "@/engine/feed";
import type { ShockParams } from "@/engine/fundamental";
import type { UserOrder, UserQueueResult } from "@/engine/simulation";
import { applyFrame, type MarketState } from "@/lib/marketState";
import type { FromWorker, ToWorker } from "@/worker/protocol";

export type MarketStatus = { readonly kind: "opening" } | { readonly kind: "live"; readonly market: MarketState } | { readonly kind: "error"; readonly message: string };

/** What to run. A new `runId` restarts the same scenario and seed from the open (RERUN). */
export interface RunSpec {
  readonly seed: number;
  readonly scenarioId: string;
  readonly runId: number;
}

export interface MarketControls {
  /** Multiples of real time. */
  readonly speed: number;
  readonly paused: boolean;
}

export interface MarketHandlers {
  /** A headline was accepted, or refused (too soon after the last one, or not numbers). */
  readonly onShockResult: (result: PresetResult) => void;
  /** An order or cancel was queued, or refused (bad size, queue full). What it did arrives in the next frames. */
  readonly onOrderResult: (result: UserQueueResult) => void;
  /** The worker answered a WHO request for a window (a clicked candle, D-054). */
  readonly onWho: (attribution: Attribution) => void;
}

/**
 * Starts the simulation worker for a run and asks it for one frame per animation frame (D-037). The
 * next request goes out only after the previous frame has arrived, so frames never queue up. While
 * the tab is hidden the browser stops animation frames, so the market pauses with it. Nothing starts
 * until `run` is known (the page reads the link first), so the market is never built twice.
 */
export function useMarket(run: RunSpec | null, controls: MarketControls, handlers: MarketHandlers) {
  // The status is tagged with the run that produced it, so a restart (RERUN, SEED, SCN) reads as
  // "opening" at once, with no state set inside the effect, and a late frame from the old market is ignored.
  const key = run === null ? null : `${run.scenarioId}:${run.seed}:${run.runId}`;
  const [held, setHeld] = useState<{ key: string | null; status: MarketStatus }>({ key: null, status: { kind: "opening" } });
  const status: MarketStatus = held.key === key ? held.status : { kind: "opening" };
  const handlersRef = useRef(handlers);
  // Read through refs so a speed change or a pause takes effect on the next frame without restarting the market.
  const controlsRef = useRef(controls);
  useEffect(() => {
    handlersRef.current = handlers;
    controlsRef.current = controls;
  });
  const workerRef = useRef<Worker | null>(null);

  const seed = run?.seed;
  const scenarioId = run?.scenarioId;
  const runId = run?.runId;
  useEffect(() => {
    if (seed === undefined || scenarioId === undefined) return;
    const runKey = `${scenarioId}:${seed}:${runId}`;
    const setStatus = (status: MarketStatus) => setHeld({ key: runKey, status });
    const worker = new Worker(new URL("../../worker/sim.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const send = (msg: ToWorker) => worker.postMessage(msg);
    let market: MarketState | null = null;
    let raf = 0;
    let timer = 0;
    let stopped = false;
    const requestFrame = () => {
      const { speed, paused } = controlsRef.current;
      send({ type: "frame", speed, paused });
    };

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (stopped) return;
      const msg = event.data;
      if (msg.type === "error") {
        setStatus({ kind: "error", message: msg.message });
        return;
      }
      if (msg.type === "shock") {
        handlersRef.current.onShockResult(msg.result);
        return;
      }
      if (msg.type === "order") {
        handlersRef.current.onOrderResult(msg.result);
        return;
      }
      if (msg.type === "who") {
        handlersRef.current.onWho(msg.attribution);
        return;
      }
      market = applyFrame(market, msg.frame);
      setStatus({ kind: "live", market });
      // Paused: nothing is moving, so check back a few times a second instead of every animation frame.
      if (controlsRef.current.paused) timer = window.setTimeout(requestFrame, 100);
      else raf = requestAnimationFrame(requestFrame);
    };
    worker.onerror = (event) => {
      if (!stopped) setStatus({ kind: "error", message: event.message || "the simulation worker failed to load" });
    };
    send({ type: "start", seed, scenarioId });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      worker.terminate();
      workerRef.current = null;
    };
  }, [seed, scenarioId, runId]);

  const post = useCallback((msg: ToWorker) => workerRef.current?.postMessage(msg), []);
  return {
    status,
    sendShock: useCallback((code: string) => post({ type: "shock", code }), [post]),
    sendParams: useCallback((shock: ShockParams, label: string) => post({ type: "shockParams", shock, label }), [post]),
    requestWho: useCallback((from: number, to: number) => post({ type: "who", from, to }), [post]),
    sendCustomShock: useCallback((fairValuePct: number, panicSensitivity: number, durationSec: number) => post({ type: "customShock", fairValuePct, panicSensitivity, durationSec }), [post]),
    sendOrder: useCallback((order: UserOrder) => post({ type: "order", order }), [post]),
    sendCancel: useCallback(() => post({ type: "cancelOrders" }), [post]),
  };
}
