"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/components/Panel";
import type { Attribution } from "@/engine/attribution";
import type { PresetResult } from "@/engine/feed";
import { clampShock, type ShockParams } from "@/engine/fundamental";
import { presetByCode } from "@/engine/presets";
import { FREE_PLAY, resolveRun, SCENARIOS, scenarioById, type Scenario } from "@/engine/scenarios";
import type { UserQueueResult } from "@/engine/simulation";
import { clampStrategy, type StrategySpec } from "@/engine/strategy";
import { parseCommand, type FunctionCode } from "@/lib/command";
import { formatSimTime } from "@/engine/simClock";
import { formatInterval } from "@/lib/format";
import type { RunData } from "@/lib/glassbox/python";
import { offlineFallback, OFFLINE_HELP } from "@/lib/offlineMatch";
import { OFFLINE_STRATEGY_HELP, parseStrategyOffline } from "@/lib/offlineStrategy";
import type { InterpretResponse, StrategyResponse } from "@/lib/schemas";
import { learnFromQuery, sessionLink } from "@/lib/sessionLink";
import { formatUserEvent } from "@/lib/userMessages";
import { BookPanel } from "./BookPanel";
import { ChatPanel } from "./ChatPanel";
import { CommandBar } from "./CommandBar";
import { ControlStrip } from "./ControlStrip";
import { ExecPanel } from "./ExecPanel";
import { download, GlassBox } from "./GlassBox";
import { HelpOverlay } from "./HelpOverlay";
import { LearnContext } from "./Learn";
import { NewsPanel } from "./NewsPanel";
import { NewsPreview, type NewsState } from "./NewsPreview";
import { PriceChart } from "./PriceChart";
import { StatusBar } from "./StatusBar";
import { StrategyPanel, type StratSource, type StratState } from "./StrategyPanel";
import { TapePanel } from "./TapePanel";
import { TicketPanel } from "./TicketPanel";
import styles from "./terminal.module.css";
import { useMarket, type RunSpec } from "./useMarket";
import { WhoPanel } from "./WhoPanel";

const CLIENT_TIMEOUT_MS = 8_000;

interface Run {
  readonly scenario: Scenario;
  readonly seed: number;
  /** Bumped by RERUN, SEED and SCN to start the market again from the open. */
  readonly runId: number;
  /** The student's strategy, started again at the open of a rerun (D-062). */
  readonly strategy: StrategySpec | null;
}

type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** The default layout (CLAUDE.md): 2 holds WHO (CROWD is cut) and 7 STRAT; NEWS opens by its code (D-066). */
const DEFAULT_SLOTS: Readonly<Record<Slot, FunctionCode>> = { 1: "GP", 2: "WHO", 3: "CHAT", 4: "TAPE", 5: "BOOK", 6: "TKT", 7: "STRAT", 8: "EXR" };
/** The panel a typed code opens in until another is clicked: the chart (D-071). */
const DEFAULT_ACTIVE: Slot = 1;

/** Ask /api/interpret; if the route itself is unreachable (no Wi-Fi), fall back here the same way. */
async function interpret(headline: string): Promise<InterpretResponse> {
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headline }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    return (await res.json()) as InterpretResponse;
  } catch {
    const { code, message } = offlineFallback(headline);
    if (code === null) return { ok: true, source: "offline", headline, preset: null, scenario: null, message };
    return { ok: true, source: "offline", headline, preset: code, scenario: { shock: presetByCode(code)!.shock, reason: "" }, message };
  }
}

/** Ask /api/interpret for a strategy (D-064); with the route unreachable, understand simple phrasing here. */
async function interpretStrategyText(text: string): Promise<StrategyResponse> {
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "strategy", text }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    return (await res.json()) as StrategyResponse;
  } catch {
    const spec = parseStrategyOffline(text);
    if (spec === null) return { ok: true, source: "offline", text, strategy: null, message: OFFLINE_STRATEGY_HELP };
    return { ok: true, source: "offline", text, strategy: { spec, reason: "" }, message: "AI unavailable · understood offline from simple phrasing. Check every rule before you start it." };
  }
}

/** The run a link asks for (`?scn=rate-shock&seed=42&learn=1`); null on the server, where there is no link yet. */
function runFromLink(): { run: Run; learn: boolean; note: string | null } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const r = resolveRun(q.get("scn"), q.get("seed"));
  return { run: { scenario: r.scenario, seed: r.seed, runId: 0, strategy: null }, learn: learnFromQuery(q), note: r.unknownScenario ? `Unknown scenario "${(q.get("scn") ?? "").slice(0, 30)}": opened free play instead. Type SCN to see them.` : null };
}

/** Keep the address bar pointing at this exact session, so a refresh or a copy of the link reopens it. */
function showRunInAddressBar(scenario: Scenario, seed: number, learn: boolean) {
  window.history.replaceState(null, "", sessionLink(scenario, seed, learn));
}

/**
 * The terminal. Panels keep their default-layout numbers (CLAUDE.md); a typed function code opens in
 * the active panel (D-066), and functions that have not shipped are simply not drawn.
 */
export function Terminal() {
  // Read once, on the client. The first render is the same "opening" screen as the server's either way.
  const [initial] = useState(runFromLink);
  const [run, setRun] = useState<Run | null>(initial?.run ?? null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // What the reply line says. A newer outcome of the student's orders replaces it (`seen`: the last outcome it already knew).
  const [reply, setReply] = useState({ text: initial?.note ?? "", seen: -1 });
  const learn = initial?.learn ?? false;
  const [news, setNews] = useState<NewsState>({ phase: "idle" });
  const [whoWindow, setWhoWindow] = useState<Attribution | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<number | null>(null);
  // Demo keeps STRAT in panel 7 and puts the release calendar in panel 2.
  const [slots, setSlots] = useState<Record<Slot, FunctionCode>>(() => initial?.run.scenario.id === "demo" ? { ...DEFAULT_SLOTS, 2: "NEWS" } : initial !== null && initial.run.scenario.id !== FREE_PLAY.id ? { ...DEFAULT_SLOTS, 7: "NEWS" } : { ...DEFAULT_SLOTS });
  const [active, setActive] = useState<Slot>(DEFAULT_ACTIVE);
  const [strat, setStrat] = useState<StratState>({ phase: "compose", message: null });
  /** The English behind the strategy that was started: what the glass box quotes. */
  const [built, setBuilt] = useState<{ text: string; source: StratSource; reason: string } | null>(null);
  const [glassOpen, setGlassOpen] = useState(false);
  const pendingApply = useRef(false);
  const wantRunData = useRef(false);
  const latestSeqRef = useRef(-1);
  const say = useCallback((text: string, seen?: number) => setReply({ text, seen: seen ?? latestSeqRef.current }), []);

  // The worker decides whether a headline is accepted (at most one per 3 s of sim time, D-051).
  const onShockResult = useCallback(
    (r: PresetResult) => {
      say(r.ok ? `${r.code} · ${r.headline}${r.note ? ` · ${r.note}` : ""}` : r.message);
      if (pendingApply.current) {
        pendingApply.current = false;
        if (r.ok) setNews((n) => (n.phase === "preview" || n.phase === "applied" ? { ...n, phase: "applied", edited: false } : n));
      }
    },
    [say],
  );
  // An accepted order says nothing yet: what it did arrives with the next frame. A refusal is shown now.
  const onOrderResult = useCallback((r: UserQueueResult) => (r.ok ? undefined : say(r.message)), [say]);
  const onWho = useCallback((a: Attribution) => setWhoWindow(a), []);
  const onRunData = useCallback(
    (data: RunData | null) => {
      if (!wantRunData.current) return;
      wantRunData.current = false;
      if (data === null) say("No run data yet: the strategy has not seen a price.");
      else download("run.json", JSON.stringify(data), "application/json");
    },
    [say],
  );
  const spec: RunSpec | null = run === null ? null : { seed: run.seed, scenarioId: run.scenario.id, runId: run.runId, strategy: run.strategy };
  const { status, sendShock, sendRelease, sendParams, requestWho, sendCustomShock, sendOrder, sendCancel, sendStrategy, sendStopStrategy, requestRunData } = useMarket(spec, { speed, paused }, { onShockResult, onOrderResult, onWho, onRunData });

  const market = status.kind === "live" ? status.market : null;
  const latestEvent = market?.userEvents.at(-1) ?? null;
  useEffect(() => {
    latestSeqRef.current = latestEvent?.seq ?? -1;
  });

  /**
   * Where a typed code opens: the active panel, except that the chart is never replaced by a code
   * while it is active (it is by default, D-071); then panel 7. Step 4c replaces this routing.
   */
  const target: Slot = active === 1 ? 7 : active;
  /** Open a function in the target panel; if it is already on screen, the two panels swap. */
  const open = useCallback(
    (code: FunctionCode) => {
      setSlots((s) => {
        if (s[target] === code) return s;
        const at = SLOTS.find((n) => s[n] === code);
        return at === undefined ? { ...s, [target]: code } : { ...s, [at]: s[target], [target]: code };
      });
    },
    [target],
  );
  const visible = (code: FunctionCode) => SLOTS.some((n) => slots[n] === code);

  const apply = useCallback(() => {
    if (news.phase !== "preview" && !(news.phase === "applied" && news.edited)) return false;
    pendingApply.current = true;
    sendParams(clampShock(news.draft), news.phase === "applied" ? `${news.headline} (edited)` : news.headline);
    return true;
  }, [news, sendParams]);

  /** Start the previewed strategy: clamped by the engine's own rules, through the command queue (D-062). False if there is none. */
  const startStrategy = (): boolean => {
    if (strat.phase !== "preview") return false;
    let clamped: StrategySpec;
    try {
      clamped = clampStrategy(strat.draft);
    } catch {
      say("That strategy has a number the engine cannot use. Check the fields.");
      return true;
    }
    sendStrategy(clamped);
    setBuilt({ text: strat.text, source: strat.source, reason: strat.reason });
    setStrat({ phase: "live" });
    say(paused ? "STRATEGY QUEUED · MARKET PAUSED" : "STRATEGY STARTED");
    return true;
  };

  const submitStrategy = async (text: string) => {
    if (!visible("STRAT")) open("STRAT");
    setStrat({ phase: "interpreting", text });
    const answer = await interpretStrategyText(text);
    if (!answer.ok) {
      setStrat({ phase: "compose", message: answer.message });
      say(answer.message);
      return;
    }
    if (answer.strategy === null) {
      const message = answer.source === "offline" || answer.source === "ai" ? (answer as { message: string }).message : OFFLINE_STRATEGY_HELP;
      setStrat({ phase: "compose", message });
      say(message);
      return;
    }
    setStrat({ phase: "preview", text, source: answer.source, reason: answer.strategy.reason, draft: answer.strategy.spec });
    say(answer.source === "offline" ? (answer as { message: string }).message : "CHECK STRAT · ↵ START · TAB EDIT");
  };

  const restart = (next: Omit<Run, "strategy">, text: string) => {
    // The student's strategy, if one is running, starts again at the open: same seed + same spec = same run.
    const keep = market?.strategy?.status === "running" ? market.strategy.spec : null;
    setRun({ ...next, strategy: keep });
    setPaused(false);
    // A new market: the old headline preview and the old candle selection belong to the market that ended.
    setNews({ phase: "idle" });
    pendingApply.current = false;
    setSelectedCandle(null);
    setWhoWindow(null);
    if (keep === null && strat.phase === "live") setStrat({ phase: "compose", message: null });
    say(keep === null ? text : `${text} · STRATEGY RESTARTS AT THE OPEN`, -1);
    showRunInAddressBar(next.scenario, next.seed, learn);
  };

  const onCommand = async (text: string) => {
    if (text.trim() === "") {
      // Enter on an empty bar applies the headline preview, or else starts the previewed strategy;
      // with neither, it clears the last message (QA #10).
      if (!apply() && !startStrategy()) say("");
      return;
    }
    const cmd = parseCommand(text);
    switch (cmd.kind) {
      case "empty":
        return;
      case "error":
        say(cmd.message);
        return;
      case "shock":
        setNews({ phase: "idle" });
        sendShock(cmd.code);
        return;
      case "release":
        setNews({ phase: "idle" });
        sendRelease(cmd.indicator, cmd.actual);
        return;
      case "customShock":
        setNews({ phase: "idle" });
        sendCustomShock(cmd.fairValuePct, cmd.panicSensitivity, cmd.durationSec);
        return;
      case "news":
        await interpretHeadline(cmd.headline);
        return;
      case "open":
        open(cmd.code);
        say("");
        return;
      case "strategy":
        if (cmd.text === "") {
          open("STRAT");
          return;
        }
        await submitStrategy(cmd.text);
        return;
      case "stopStrategy":
        if (market?.strategy?.status !== "running") {
          say("NO STRATEGY RUNNING");
          return;
        }
        sendStopStrategy();
        say("STOPPING STRATEGY · CLOSING AT MARKET");
        return;
      case "order":
        sendOrder(cmd.order);
        if (paused) say("ORDER QUEUED · MARKET PAUSED");
        return;
      case "cancelOrders":
        sendCancel();
        if (paused) say("CANCEL QUEUED · MARKET PAUSED");
        return;
      case "pause":
        setPaused(true);
        say("");
        return;
      case "run":
        setPaused(false);
        say("");
        return;
      case "speed":
        setSpeed(cmd.speed);
        say("");
        return;
      case "scenario": {
        if (cmd.id === null) {
          say(`SCN · ${SCENARIOS.map((s) => s.id).join(" · ")}`);
          return;
        }
        const scenario = scenarioById(cmd.id) ?? FREE_PLAY;
        // A scenario runs on its own seed, so a whole class sees the same market; say so if it replaces yours (QA #10).
        const seedNote = run !== null && run.seed !== scenario.seed ? ` It runs on its own seed, ${scenario.seed} (yours was ${run.seed}; SEED ${run.seed} reruns it on yours).` : "";
        restart({ scenario, seed: scenario.seed, runId: (run?.runId ?? 0) + 1 }, `SCN ${scenario.title.toUpperCase()}${seedNote}`);
        if (scenario.id === "demo") setSlots({ ...DEFAULT_SLOTS, 2: "NEWS" });
        else open("NEWS");
        return;
      }
      case "seed":
        if (run !== null) restart({ ...run, seed: cmd.seed, runId: run.runId + 1 }, `SEED ${cmd.seed}`);
        return;
      case "rerun":
        if (run !== null) restart({ ...run, runId: run.runId + 1 }, "RERUN · SAME SCENARIO, SAME SEED");
        return;
      case "link": {
        if (run === null) return;
        const url = `${window.location.origin}${sessionLink(run.scenario, run.seed, learn)}`;
        const copy = typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error("no clipboard"));
        copy.then(
          () => say(`LINK COPIED · ${url}`),
          () => say(`LINK · ${url}`),
        );
        return;
      }
      case "help":
        setHelpOpen(true);
        return;
    }
  };

  /** A headline in the student's own words: the AI's clamped params become an editable preview (D-052). */
  const interpretHeadline = async (headline: string) => {
    setNews({ phase: "interpreting", headline });
    const answer = await interpret(headline);
    if (!answer.ok) {
      setNews({ phase: "idle" });
      say(answer.message);
      return;
    }
    if (answer.scenario === null) {
      setNews({ phase: "idle" });
      say(answer.source === "offline" ? answer.message : OFFLINE_HELP);
      return;
    }
    const source = answer.source === "offline" ? `offline preset ${answer.preset}` : answer.source === "cache" ? "AI (cached)" : "AI";
    setNews({ phase: "preview", headline, source, reason: answer.source === "offline" ? "" : answer.scenario.reason, draft: answer.scenario.shock, edited: false });
    say(answer.source === "offline" ? answer.message : "AI PARAMETERS · ↵ APPLY · TAB EDIT");
  };

  const onEdit = (draft: ShockParams) => setNews((n) => (n.phase === "preview" || n.phase === "applied" ? { ...n, draft, edited: n.phase === "applied" ? true : n.edited } : n));
  const onCancel = () => setNews({ phase: "idle" });

  const onSelectCandle = useCallback(
    (start: number | null, candleMs: number) => {
      setSelectedCandle(start);
      if (start === null) setWhoWindow(null);
      else requestWho(start, start + candleMs);
    },
    [requestWho],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCandle(null);
        setWhoWindow(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (status.kind === "opening") return <div className={styles.opening}>OPENING MARKET</div>;
  if (status.kind === "error") {
    return (
      <div className={styles.error} role="alert">
        The market stopped: {status.message}. Reload the page to reopen it.
      </div>
    );
  }

  const m = status.market;
  const { frame, candles, tape, headlines, chat } = m;
  const who = selectedCandle !== null && whoWindow !== null ? whoWindow : frame.who;
  const scenario = run?.scenario ?? FREE_PLAY;
  const shown = latestEvent !== null && latestEvent.seq > reply.seen ? formatUserEvent(latestEvent) : reply.text;
  const canReveal = m.strategy !== null && built !== null;

  /** Screen-reader label, right-aligned header detail and body of a function, wherever it is shown (D-071). */
  const fn = (code: FunctionCode): { label: string; meta?: string; body: ReactNode } => {
    switch (code) {
      case "GP":
        return { label: `${frame.ticker} PRICE`, meta: `${frame.ticker} · ${formatInterval(frame.candleMs)}`, body: <PriceChart candles={candles} candleMs={frame.candleMs} last={frame.last} headlines={headlines} selected={selectedCandle} onSelect={(s) => onSelectCandle(s, frame.candleMs)} /> };
      case "WHO":
        return { label: "WHO MOVED THE PRICE", meta: selectedCandle !== null && whoWindow !== null ? `${formatSimTime(who.from).slice(0, 8)}–${formatSimTime(who.to).slice(0, 8)} · ESC` : "60S", body: <WhoPanel who={who} /> };
      case "CHAT":
        return { label: "DESK CHAT", body: <ChatPanel chat={chat} /> };
      case "TAPE":
        return { label: "TIME & SALES", body: <TapePanel tape={tape} /> };
      case "BOOK":
        return { label: `${frame.ticker} DEPTH`, meta: frame.ticker, body: <BookPanel frame={frame} /> };
      case "TKT":
        return { label: "ORDER TICKET", body: <TicketPanel frame={frame} lastEvent={latestEvent} paused={paused} onCommand={onCommand} /> };
      case "STRAT":
        return {
          label: "STRATEGY",
          body: (
            <StrategyPanel
              state={strat}
              strategy={m.strategy}
              decisions={m.decisions}
              onSubmit={(t) => void submitStrategy(t)}
              onEdit={(draft) => setStrat((s) => (s.phase === "preview" ? { ...s, draft } : s))}
              onStart={startStrategy}
              onCancel={() => setStrat({ phase: "compose", message: null })}
              onStop={() => void onCommand("STOP")}
              onReveal={() => canReveal && setGlassOpen(true)}
              onNew={() => setStrat({ phase: "compose", message: null })}
            />
          ),
        };
      case "NEWS":
        return { label: "SCENARIO & HEADLINES", body: <NewsPanel scenario={scenario} market={m} onCommand={onCommand} /> };
      case "EXR":
        return { label: "EXECUTION REPORT", body: <ExecPanel exr={m.exr} /> };
    }
  };

  // Grid areas belong to slots (positions), not functions: a function opened in panel 7 takes panel 7's place.
  const AREA: Record<Slot, string> = { 1: styles.gp, 2: styles.whoArea, 3: styles.chatArea, 4: styles.tape, 5: styles.book, 6: styles.tkt, 7: styles.newsArea, 8: styles.exr };

  return (
    <LearnContext value={learn}>
    <div className={styles.shell}>
      <StatusBar frame={frame} openPrice={m.openPrice} scenarioTitle={scenario.title} paused={paused} speed={speed} />
      <CommandBar onCommand={onCommand} reply={shown} />
      <NewsPreview news={news} onEdit={onEdit} onApply={apply} onCancel={onCancel} />
      <main className={styles.grid}>
        {SLOTS.map((n) => {
          const f = fn(slots[n]);
          return (
            <Panel key={n} number={n} code={slots[n]} label={f.label} meta={f.meta} className={AREA[n]} active={n === active} onActivate={() => setActive(n)}>
              {f.body}
            </Panel>
          );
        })}
      </main>
      <ControlStrip paused={paused} speed={speed} onCommand={onCommand} />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {glassOpen && m.strategy !== null && built !== null && (
        <GlassBox
          text={built.text}
          source={built.source}
          reason={built.reason}
          spec={m.strategy.spec}
          strategy={m.strategy}
          decisions={m.decisions}
          onClose={() => setGlassOpen(false)}
          onDownloadRun={() => {
            wantRunData.current = true;
            requestRunData();
          }}
        />
      )}
    </div>
    </LearnContext>
  );
}
