import { MarketFeed, TickPacer } from "@/engine/feed";
import { createScenarioMarket, FREE_PLAY, scenarioById } from "@/engine/scenarios";
import type { FromWorker, ToWorker } from "./protocol";

// The simulation runs here, off the main thread (CLAUDE.md, Architecture). This file is the only
// place that reads the real clock, and only to ask the pacer HOW MANY ticks are due (D-039).

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
}
const scope = globalThis as unknown as WorkerScope;

let feed: MarketFeed | null = null;
let pacer: TickPacer | null = null;
let lastRequestAt = 0;

scope.onmessage = (event) => {
  try {
    const msg = event.data;
    if (msg.type === "start") {
      // The scenario's market arrives already warmed up and trading, with its headlines on the calendar.
      feed = new MarketFeed(createScenarioMarket(scenarioById(msg.scenarioId) ?? FREE_PLAY, msg.seed), msg.seed);
      pacer = new TickPacer();
      lastRequestAt = performance.now();
      scope.postMessage({ type: "frame", frame: feed.frame() });
    } else if (msg.type === "frame") {
      if (feed === null || pacer === null) throw new Error("frame requested before start");
      const now = performance.now();
      // Paused: no ticks run, and the time spent paused is not caught up afterwards.
      feed.advance(msg.paused ? 0 : pacer.ticksFor(now - lastRequestAt, msg.speed));
      lastRequestAt = now;
      scope.postMessage({ type: "frame", frame: feed.frame() });
    } else if (msg.type === "shock") {
      // Never throws: an unknown code or a headline too soon after the last one is refused as data.
      if (feed !== null) scope.postMessage({ type: "shock", result: feed.applyPreset(msg.code) });
    } else if (msg.type === "shockParams") {
      if (feed !== null) scope.postMessage({ type: "shock", result: feed.applyParams(msg.shock, msg.label) });
    } else if (msg.type === "who") {
      if (feed !== null) scope.postMessage({ type: "who", attribution: feed.attribute(msg.from, msg.to) });
    } else if (msg.type === "customShock") {
      if (feed !== null) scope.postMessage({ type: "shock", result: feed.applyCustomShock({ fairValuePct: msg.fairValuePct, panicSensitivity: msg.panicSensitivity, durationSec: msg.durationSec, volatilityMultiplier: 1, liquidityMultiplier: 1 }) });
    } else if (msg.type === "order") {
      // Never throws: a bad size or a full queue is refused as data; the engine's verdict comes in a later frame.
      if (feed !== null) scope.postMessage({ type: "order", result: feed.submitOrder(msg.order) });
    } else if (msg.type === "cancelOrders") {
      if (feed !== null) scope.postMessage({ type: "order", result: feed.cancelOrders() });
    }
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
