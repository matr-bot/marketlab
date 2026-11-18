"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FREE_PLAY, parseSeed, scenarioById } from "@/engine/scenarios";
import type { AgentModel } from "@/lib/models";
import { sessionLink } from "@/lib/sessionLink";
import { KeyHint } from "../terminal/KeyHint";
import { HeroReplay } from "./HeroReplay";
import term from "../terminal/terminal.module.css";
import styles from "./landing.module.css";

interface ScenarioItem {
  readonly id: string;
  readonly title: string;
  readonly teaches: string;
}

/** One plain sentence, then the technical layer behind a [+] (D-083). Native <details>: no animation. */
function Layer({ summary, children, testId }: { summary: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <details className={styles.layer} data-testid={testId}>
      <summary>
        <span className={styles.plus} aria-hidden />
        {summary}
      </summary>
      <div className={styles.layerBody}>{children}</div>
    </details>
  );
}

/**
 * The landing page (D-083): engineering paper, not a product page. A hero line with the one amber
 * action (OPEN TERMINAL), the problem, how the market works with the model behind each trader type,
 * and a session launcher. Same tokens and font as the terminal; keyboard-driven.
 */
export function Landing({
  initialSeed,
  demoSeed,
  agents,
  models,
  scenarios,
  build,
  proof,
}: {
  initialSeed: number;
  demoSeed: number;
  agents: number;
  models: ReadonlyArray<AgentModel & { count: number }>;
  /** The launcher's scenarios (the contest demo script is left out, D-087; `SCN demo` still opens it). */
  scenarios: readonly ScenarioItem[];
  build: { version: string; sha: string };
  /** The generated proof (step 6d); not drawn until it ships. */
  proof?: ReactNode;
}) {
  const openTerminal = `/terminal?scn=${FREE_PLAY.id}&seed=${demoSeed}`;
  const [index, setIndex] = useState(0);
  const [seedText, setSeedText] = useState(String(initialSeed));
  const [learn, setLearn] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  // Keys follow the links themselves: a full page load, so the terminal reads its run from the address.
  const openRef = useRef<HTMLAnchorElement>(null);
  const startRef = useRef<HTMLAnchorElement>(null);
  const seed = parseSeed(seedText.trim());
  const scenario = scenarioById(scenarios[index].id) ?? FREE_PLAY;
  const start = seed === undefined ? null : sessionLink(scenario, seed, learn);

  // Enter anywhere that is not a field, a list or a control opens the terminal (the amber action).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && t.closest("input, textarea, select, button, a, summary, [role=listbox]")) return;
      openRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + scenarios.length) % scenarios.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      startRef.current?.click();
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <span className={styles.brand}>MARKETLAB</span>
        <span className={styles.dim}>SIMULATED EXCHANGE · NO REAL MONEY</span>
      </header>

      <HeroReplay
        seed={demoSeed}
        intro={
          <>
          <h1 className={styles.h1}>A stock market you can break.</h1>
          <p className={styles.lede} data-testid="hero-line">
            {agents} trading agents, one real order book, every price explainable.
          </p>
          <a ref={openRef} className={styles.openTerminal} href={openTerminal} data-testid="open-terminal">
            OPEN TERMINAL
            <KeyHint k="↵" />
          </a>
          </>
        }
      />

      <section className={styles.section} aria-labelledby="problem">
        <h2 id="problem" className={styles.h2}>
          PROBLEM
        </h2>
        <ul className={styles.lines}>
          <li>Paper trading uses real prices that ignore you.</li>
          <li>You can&apos;t see who moved a price.</li>
          <li>You can&apos;t test &ldquo;what if.&rdquo;</li>
        </ul>
        <Layer summary="What MarketLab does instead" testId="layer-problem">
          <p>
            Prices here come only from orders matched in a limit order book, yours included: a market order walks the book, so its own size moves the price, and the execution report splits the cost into spread and impact against the mid when the order arrived.
          </p>
          <p>Every fill records the trader type on both sides, so &ldquo;who moved the price&rdquo; is a lookup in the fill log, not a guess.</p>
          <p>Every run is seeded: the same seed and the same inputs give the same market, so changing one thing and rerunning is a controlled experiment.</p>
        </Layer>
      </section>

      <section className={styles.section} aria-labelledby="how">
        <h2 id="how" className={styles.h2}>
          HOW IT WORKS
        </h2>
        <p className={styles.sentence}>Agents send orders, the book matches them, the price is the last trade, and every fill says who traded.</p>
        <div className={styles.flow} data-testid="flow">
          <span>AGENTS</span>
          <span className={styles.dim}>──►</span>
          <span>ORDER BOOK</span>
          <span className={styles.dim}>──►</span>
          <span>PRICE</span>
          <span className={styles.dim}>──►</span>
          <span>ATTRIBUTION</span>
        </div>
        <Layer summary="The order book, the price and attribution" testId="layer-engine">
          <p>A continuous double auction with price-time priority: limit, market and cancel orders. Prices and cash are integers in cents; there is no floating-point money.</p>
          <p>There is no price formula. The price is the last trade; a headline changes what traders believe, and their orders move the price.</p>
          <p>Each fill logs both sides&apos; trader type, its arrival quote and its limit, so attribution and slippage are exact, computed from the log.</p>
        </Layer>
        <ul className={styles.agents} data-testid="agents">
          {models.map((m) => (
            <li key={m.type} data-type={m.type}>
              <Layer
                summary={
                  <>
                    <span className={styles.agentLabel}>{m.label}</span>
                    <span className={styles.agentCount}>{m.count}</span>
                    <span>{m.plain}</span>
                  </>
                }
              >
                <p>
                  <span className={styles.dim}>MODEL </span>
                  {m.model}
                </p>
                <p className={styles.dim}>{m.citation}</p>
                <p>{m.detail}</p>
              </Layer>
            </li>
          ))}
        </ul>
      </section>

      {proof}

      <section className={styles.section} id="start" aria-labelledby="start-head">
        <h2 id="start-head" className={styles.h2}>
          START A SESSION
        </h2>
        <p className={styles.sentence}>Pick a scenario and a seed; the same pair always gives the same market.</p>
        <div className={styles.launcher}>
          <span className={styles.fieldLabel}>SCENARIO</span>
          <ul ref={listRef} className={styles.scenarios} role="listbox" tabIndex={0} aria-label="Scenario" aria-activedescendant={`scn-${scenarios[index].id}`} onKeyDown={onListKey} data-testid="scenario-list">
            {scenarios.map((s, i) => (
              <li
                key={s.id}
                id={`scn-${s.id}`}
                role="option"
                aria-selected={i === index}
                className={i === index ? styles.scenarioOn : undefined}
                data-id={s.id}
                title={s.teaches}
                onClick={() => {
                  setIndex(i);
                  listRef.current?.focus();
                }}
              >
                <span className={styles.caret} aria-hidden>
                  {i === index ? "▸" : ""}
                </span>
                {s.title}
              </li>
            ))}
          </ul>
          <label className={styles.fieldLabel} htmlFor="seed">
            SEED
          </label>
          <div className={styles.seedRow}>
            <input
              id="seed"
              className={term.input}
              data-testid="launcher-seed"
              inputMode="numeric"
              value={seedText}
              maxLength={10}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setSeedText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") startRef.current?.click();
              }}
            />
            {seed === undefined && <span className={styles.dim}>INVALID SEED</span>}
            <label className={styles.check}>
              <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid="launcher-learn" />
              LEARN MODE
            </label>
          </div>
          <span />
          {start === null ? (
            <span className={`${term.secondary} ${styles.disabled}`} aria-disabled="true" data-testid="start-session">
              START SESSION
              <KeyHint k="↵" />
            </span>
          ) : (
            <a ref={startRef} className={term.secondary} href={start} data-testid="start-session">
              START SESSION
              <KeyHint k="↵" />
            </a>
          )}
        </div>
        <p className={styles.dim} id="keys">
          ↑ ↓ SCENARIO (with the list focused) · ↵ START · ↵ ANYWHERE ELSE OPENS THE TERMINAL
        </p>
      </section>

      <footer className={styles.footer}>
        <span className={styles.dim}>{agents} agents · limit order book · deterministic replay</span>
        <span className={styles.dim} data-testid="build">
          v{build.version} · {build.sha} ·{" "}
          <a className={styles.link} href="#keys">
            HELP
          </a>
        </span>
      </footer>
    </div>
  );
}
