import { createDemoMarket, WARMUP_TICKS } from "@/engine/demoMarket";
import { MarketFeed, TickPacer } from "@/engine/feed";
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
      feed = new MarketFeed(createDemoMarket(msg.seed), msg.seed);
      feed.advance(WARMUP_TICKS);
      pacer = new TickPacer();
      lastRequestAt = performance.now();
      scope.postMessage({ type: "frame", frame: feed.frame() });
    } else if (msg.type === "frame") {
      if (feed === null || pacer === null) throw new Error("frame requested before start");
      const now = performance.now();
      feed.advance(pacer.ticksFor(now - lastRequestAt, msg.speed));
      lastRequestAt = now;
      scope.postMessage({ type: "frame", frame: feed.frame() });
    } else if (msg.type === "shock") {
      // Never throws: an unknown code or a headline too soon after the last one is refused as data.
      if (feed !== null) scope.postMessage({ type: "shock", result: feed.applyPreset(msg.code) });
    }
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
