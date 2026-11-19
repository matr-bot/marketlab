"use client";

import { useEffect, useState } from "react";
import { firstDivergence, type DeterminismResult } from "@/lib/determinism";
import pins from "@/lib/determinismPins.json";

/**
 * Runs the determinism check (D-091) in a worker in this browser and compares it with the pins every
 * platform must match (Node on Linux and macOS, Chromium, Firefox, WebKit). Shows the result, or the
 * first diverging tick. Read-only, with no network: the pins ship with the page.
 */
export function DeterminismCheck() {
  const [out, setOut] = useState<{ result: DeterminismResult; ms: number } | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("../worker/determinism.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ result: DeterminismResult; ms: number }>) => {
      setOut(e.data);
      worker.terminate();
    };
    worker.postMessage("run");
    return () => worker.terminate();
  }, []);
  const divergence = out === null ? null : firstDivergence(pins as unknown as DeterminismResult, out.result);
  return (
    <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ fontSize: "var(--fs-label)", color: "var(--label)", letterSpacing: "0.08em", fontWeight: 400 }}>DETERMINISM CHECK · SEED 187</h1>
      {out === null ? (
        <p data-testid="determinism-status" data-state="running">
          RUNNING…
        </p>
      ) : (
        <>
          <p data-testid="determinism-status" data-state={divergence === null ? "identical" : "diverged"}>
            {divergence === null ? "IDENTICAL TO THE PINS" : `DIVERGED · ${divergence}`}
          </p>
          <pre data-testid="determinism-result" style={{ color: "var(--label)", whiteSpace: "pre-wrap" }}>
            {JSON.stringify({ runs: out.result.runs.map((r) => ({ id: r.id, ticks: r.ticks, fills: r.fills, final: r.final })), detMath: out.result.detMath, ms: out.ms }, null, 2)}
          </pre>
          <script type="application/json" data-testid="determinism-full" dangerouslySetInnerHTML={{ __html: JSON.stringify(out.result) }} />
        </>
      )}
    </main>
  );
}
