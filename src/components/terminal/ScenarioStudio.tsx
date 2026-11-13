"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { compileScenario, SCENARIO_COMPILER_VERSION, STUDIO_ASSETS, type CompiledScenario, type StudioAssetFrame } from "@/engine/scenarioStudio";
import type { ScenarioResponse } from "@/lib/scenarioInterpret";
import { formatPrice } from "@/lib/format";
import styles from "./scenarioStudio.module.css";

const EXAMPLES = ["SpaceX IPO", "Anthropic IPO", "China takes Taiwan", "Iran blocks the Strait of Hormuz", "US-China trade war escalates", "The Federal Reserve unexpectedly raises rates"];
type PricePoint = { readonly time: number; readonly price: number };
type StudioMessage = { readonly type: "frames"; readonly assets: StudioAssetFrame[] } | { readonly type: "error"; readonly message: string };

function PriceTrace({ points }: { points: readonly PricePoint[] }) {
  if (points.length < 2) return <span className={styles.dim}>Waiting for trades…</span>;
  const shown = points.slice(-120);
  const min = Math.min(...shown.map((p) => p.price));
  const max = Math.max(...shown.map((p) => p.price));
  const range = Math.max(1, max - min);
  const path = shown.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (shown.length - 1)) * 300},${40 - ((p.price - min) / range) * 36}`).join(" ");
  return <svg className={styles.trace} viewBox="0 0 300 44" preserveAspectRatio="none" aria-label="Last executed trade prices"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function ScenarioStudio() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ScenarioResponse | null>(null);
  const [compiled, setCompiled] = useState<CompiledScenario | null>(null);
  const [assets, setAssets] = useState<StudioAssetFrame[]>([]);
  const [points, setPoints] = useState<Record<string, PricePoint[]>>({});
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestId = useRef(0);

  function stopMarket() {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }
  useEffect(() => () => stopMarket(), []);

  function changeText(next: string) {
    requestId.current++;
    setText(next);
    setResponse(null);
    setLoading(false);
  }

  async function interpret() {
    const current = text.trim();
    if (current.length < 2) return;
    const id = ++requestId.current;
    stopMarket();
    setCompiled(null);
    setAssets([]);
    setPoints({});
    setResponse(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "scenario", text: current }), signal: AbortSignal.timeout(12_000) });
      const result = (await res.json()) as ScenarioResponse;
      if (id === requestId.current) setResponse(result);
    } catch {
      if (id === requestId.current) setResponse({ ok: false, source: "unavailable", message: "AI interpretation could not be reached. Nothing was applied." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function apply() {
    if (response?.ok !== true || response.interpretation.effects.length === 0) return;
    stopMarket();
    const frozen = compileScenario(response.interpretation, 187);
    setCompiled(frozen);
    setAssets([]);
    setPoints({});
    setError(null);
    const worker = new Worker(new URL("../../worker/studio.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<StudioMessage>) => {
      if (event.data.type === "error") { setError(event.data.message); stopMarket(); return; }
      const frames = event.data.assets;
      setAssets(frames);
      setPoints((previous) => {
        const next = { ...previous };
        for (const asset of frames) {
          const fresh = asset.frame.trades.map((trade) => ({ time: trade.time, price: trade.price }));
          next[asset.ticker] = [...(next[asset.ticker] ?? []), ...fresh].slice(-120);
        }
        return next;
      });
    };
    worker.postMessage({ type: "start", compiled: frozen });
    timerRef.current = setInterval(() => worker.postMessage({ type: "step", ticks: 3 }), 300);
  }

  const interpretation = response?.ok === true ? response.interpretation : null;
  const preview = interpretation === null ? null : compileScenario(interpretation, 187);
  return <main className={styles.shell}>
    <header className={styles.header}><Link href="/">MLAB TERMINAL</Link><span>MARKET SCENARIO STUDIO</span><span>SIMULATED · SEED 187</span></header>
    <section className={styles.panel}>
      <h1>DESCRIBE A HYPOTHETICAL EVENT</h1>
      <p className={styles.dim}>Write a short or detailed scenario. AI interpretation is open-ended; supported effects trade through fictional order books.</p>
      <textarea aria-label="Market scenario" value={text} onChange={(event) => changeText(event.target.value)} maxLength={500} placeholder="What if a major chip supplier loses access to a key export market?" />
      <div className={styles.toolbar}><button type="button" onClick={() => void interpret()} disabled={loading || text.trim().length < 2}>{loading ? "INTERPRETING…" : "INTERPRET SCENARIO"}</button><span className={styles.dim}>Every event is treated as hypothetical. No real-world verification is performed.</span></div>
      <div className={styles.examples}>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => changeText(example)}>{example}</button>)}</div>
    </section>
    {response !== null && !response.ok && <section className={styles.panel} role="alert">{response.message}</section>}
    {interpretation !== null && preview !== null && <section className={styles.panel} data-testid="scenario-preview">
      <h2>INTERPRETATION PREVIEW · HYPOTHETICAL</h2>
      <p>{interpretation.summary}</p>
      <div className={styles.columns}>
        <div><h3>ENTITIES & SECTORS</h3><p>{interpretation.entities.join(", ") || "None identified"}</p><p className={styles.dim}>{interpretation.sectors.join(", ") || "No sector identified"}</p></div>
        <div><h3>ECONOMIC MECHANISMS</h3>{interpretation.mechanisms.map((item, i) => <p key={i}>{item}</p>)}</div>
        <div><h3>ASSUMPTIONS · UNCERTAINTY {interpretation.uncertainty.toUpperCase()}</h3>{interpretation.assumptions.map((item, i) => <p key={i}>{item}</p>)}</div>
      </div>
      <h3>ILLUSTRATIVE SIGNALS</h3>
      <p className={styles.dim}>These are modelled assumptions, not historical evidence or predictions. No historical sources are connected in Phase 1. The AI identifies factors; compiler {SCENARIO_COMPILER_VERSION} bounds agent inputs. Traded prices come only from matched orders.</p>
      <div className={styles.signals}>{preview.signals.map((signal) => <div key={signal.ticker}><strong>{signal.ticker}</strong><span>{signal.fairValuePct > 0 ? "+" : ""}{(signal.fairValuePct * 100).toFixed(2)}% belief signal</span><small>{signal.contributingFactors.join(", ") || "no supported exposure"}</small></div>)}</div>
      {interpretation.effects.length === 0 || preview.signals.every((signal) => signal.fairValuePct === 0) ? <p role="status">No supported asset effect can be applied. The scenario is understood, but this fictional asset set does not represent it.</p> : <div className={styles.toolbar}><button type="button" onClick={apply}>{compiled === null ? "APPLY TO SIMULATED MARKETS" : "RERUN SAME SEED & INTERPRETATION"}</button><span className={styles.dim}>Review assumptions above before applying.</span></div>}
    </section>}
    {error !== null && <section className={styles.panel} role="alert">Simulation error: {error}</section>}
    {compiled !== null && <section className={styles.panel} data-testid="studio-markets"><h2>MARKET REACTION · MATCHED TRADES</h2><p className={styles.dim}>Frozen interpretation · compiler {compiled.version} · seed {compiled.seed}. Price traces show executed trade prices; a flat trace means trades occurred at the same price or none occurred.</p><div className={styles.markets}>{STUDIO_ASSETS.map((definition) => {
      const asset = assets.find((item) => item.ticker === definition.ticker);
      const signal = compiled.signals.find((item) => item.ticker === definition.ticker)!;
      return <div className={styles.market} key={definition.ticker}><div className={styles.marketHead}><strong>{definition.ticker}</strong><span>{definition.name}</span><span>{asset?.frame.last === null || asset === undefined ? "—" : formatPrice(asset.frame.last)}</span></div><PriceTrace points={points[definition.ticker] ?? []} /><div className={styles.marketStats}><span>ORDERS {asset?.ordersSubmitted ?? 0}</span><span>TRADES {asset?.totalTrades ?? 0}</span><span>BID {asset?.frame.bid === null || asset === undefined ? "—" : formatPrice(asset.frame.bid)}</span><span>ASK {asset?.frame.ask === null || asset === undefined ? "—" : formatPrice(asset.frame.ask)}</span></div><div className={styles.marketStats}><span>ILLUSTRATIVE SIGNAL {(signal.fairValuePct * 100).toFixed(2)}%</span></div></div>;
    })}</div></section>}
  </main>;
}
