/// <reference lib="webworker" />
import { runDeterminism } from "@/lib/determinism";

// The cross-browser determinism check (D-091): the same code the Node tests run, in this browser's
// worker. Read-only: it builds its own markets and posts the result once.
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = () => {
  const started = performance.now();
  const result = runDeterminism();
  scope.postMessage({ result, ms: Math.round(performance.now() - started) });
};
