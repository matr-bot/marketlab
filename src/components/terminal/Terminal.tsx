"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/Panel";
import type { Attribution } from "@/engine/attribution";
import type { PresetResult } from "@/engine/feed";
import { clampShock, type ShockParams } from "@/engine/fundamental";
import { presetByCode } from "@/engine/presets";
import { FREE_PLAY, resolveRun, runLink, SCENARIOS, scenarioById, type Scenario } from "@/engine/scenarios";
import type { UserQueueResult } from "@/engine/simulation";
import { parseCommand } from "@/lib/command";
import { formatInterval } from "@/lib/format";
import { offlineMatch, OFFLINE_HELP } from "@/lib/offlineMatch";
import type { InterpretResponse } from "@/lib/schemas";
import { formatUserEvent } from "@/lib/userMessages";
import { BookPanel } from "./BookPanel";
import { ChatPanel } from "./ChatPanel";
import { CommandBar } from "./CommandBar";
import { ControlStrip } from "./ControlStrip";
import { ExecPanel } from "./ExecPanel";
import { HelpOverlay } from "./HelpOverlay";
import { NewsPanel } from "./NewsPanel";
import { NewsPreview, type NewsState } from "./NewsPreview";
import { PriceChart } from "./PriceChart";
import { StatusBar } from "./StatusBar";
import { TapePanel } from "./TapePanel";
import { TicketPanel } from "./TicketPanel";
import { TickerTape } from "./TickerTape";
import styles from "./terminal.module.css";
import { useMarket, type RunSpec } from "./useMarket";
import { WhoPanel } from "./WhoPanel";

const CLIENT_TIMEOUT_MS = 8_000;

interface Run {
  readonly scenario: Scenario;
  readonly seed: number;
  /** Bumped by RERUN, SEED and SCN to start the market again from the open. */
  readonly runId: number;
}

const WELCOME = "Type a headline, or FED, BUY 500 or HELP, and press Enter.";

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
    const code = offlineMatch(headline);
    if (code === null) return { ok: true, source: "offline", headline, preset: null, scenario: null, message: OFFLINE_HELP };
    return { ok: true, source: "offline", headline, preset: code, scenario: { shock: presetByCode(code)!.shock, reason: "" }, message: `AI unavailable · used offline preset ${code} (closest match).` };
  }
}

/** The run a link asks for (`?scn=rate-shock&seed=42`); null on the server, where there is no link yet. */
function runFromLink(): { run: Run; note: string | null } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const r = resolveRun(q.get("scn"), q.get("seed"));
  return { run: { scenario: r.scenario, seed: r.seed, runId: 0 }, note: r.unknownScenario ? `Unknown scenario "${(q.get("scn") ?? "").slice(0, 30)}": opened free play instead. Type SCN to see them.` : null };
}

/** Keep the address bar pointing at this exact run, so a refresh or a copy of the link reopens it. */
function showRunInAddressBar(scenario: Scenario, seed: number) {
  window.history.replaceState(null, "", runLink(scenario, seed));
}

/**
 * The terminal. Panels keep their default-layout numbers (CLAUDE.md); functions that have not
 * shipped yet are simply not drawn, and the grid closes up around the ones that have.
 */
export function Terminal() {
  // Read once, on the client. The first render is the same "opening" screen as the server's either way.
  const [initial] = useState(runFromLink);
  const [run, setRun] = useState<Run | null>(initial?.run ?? null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // What the reply line says. A newer outcome of the student's orders replaces it (`seen`: the last outcome it already knew).
  const [reply, setReply] = useState({ text: initial?.note ?? WELCOME, seen: -1 });
  const [news, setNews] = useState<NewsState>({ phase: "idle" });
  const [whoWindow, setWhoWindow] = useState<Attribution | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<number | null>(null);
  const pendingApply = useRef(false);
  const latestSeqRef = useRef(-1);
  const say = useCallback((text: string, seen?: number) => setReply({ text, seen: seen ?? latestSeqRef.current }), []);

  // The worker decides whether a headline is accepted (at most one per 3 s of sim time, D-051).
  const onShockResult = useCallback(
    (r: PresetResult) => {
      say(r.ok ? `${r.code} · ${r.headline}` : r.message);
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
  const spec: RunSpec | null = run === null ? null : { seed: run.seed, scenarioId: run.scenario.id, runId: run.runId };
  const { status, sendShock, sendParams, requestWho, sendCustomShock, sendOrder, sendCancel } = useMarket(spec, { speed, paused }, { onShockResult, onOrderResult, onWho });

  const latestEvent = status.kind === "live" ? (status.market.userEvents.at(-1) ?? null) : null;
  useEffect(() => {
    latestSeqRef.current = latestEvent?.seq ?? -1;
  });

  const apply = useCallback(() => {
    if (news.phase !== "preview" && !(news.phase === "applied" && news.edited)) return;
    pendingApply.current = true;
    sendParams(clampShock(news.draft), news.phase === "applied" ? `${news.headline} (edited)` : news.headline);
  }, [news, sendParams]);

  const restart = (next: Run, text: string) => {
    setRun(next);
    setPaused(false);
    // A new market: the old headline preview and the old candle selection belong to the market that ended.
    setNews({ phase: "idle" });
    pendingApply.current = false;
    setSelectedCandle(null);
    setWhoWindow(null);
    say(text, -1);
    showRunInAddressBar(next.scenario, next.seed);
  };

  const onCommand = async (text: string) => {
    if (text.trim() === "") {
      apply(); // Enter on an empty bar applies the preview
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
      case "customShock":
        setNews({ phase: "idle" });
        sendCustomShock(cmd.fairValuePct, cmd.panicSensitivity, cmd.durationSec);
        return;
      case "news":
        await interpretHeadline(cmd.headline);
        return;
      case "order":
        sendOrder(cmd.order);
        if (paused) say("Order queued. The market is paused: it executes when you RUN.");
        return;
      case "cancelOrders":
        sendCancel();
        if (paused) say("Cancel queued. The market is paused: it happens when you RUN.");
        return;
      case "pause":
        setPaused(true);
        say("Market paused. RUN resumes it.");
        return;
      case "run":
        setPaused(false);
        say("Market running.");
        return;
      case "speed":
        setSpeed(cmd.speed);
        say(cmd.speed === 1 ? "Real time." : `Running ${cmd.speed}× real time. The market is the same, just sooner.`);
        return;
      case "scenario": {
        if (cmd.id === null) {
          say(`Scenarios: ${SCENARIOS.map((s) => s.id).join(", ")}. Open one with SCN <name>.`);
          return;
        }
        const scenario = scenarioById(cmd.id) ?? FREE_PLAY;
        restart({ scenario, seed: scenario.seed, runId: (run?.runId ?? 0) + 1 }, `Opening "${scenario.title}". Read the brief and task in NEWS.`);
        return;
      }
      case "seed":
        if (run !== null) restart({ ...run, seed: cmd.seed, runId: run.runId + 1 }, `Seed ${cmd.seed}: a different market, same scenario.`);
        return;
      case "rerun":
        if (run !== null) restart({ ...run, runId: run.runId + 1 }, "Restarted from the open: same scenario, same seed, same market until you act differently.");
        return;
      case "link": {
        if (run === null) return;
        const url = `${window.location.origin}${runLink(run.scenario, run.seed)}`;
        const copy = typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error("no clipboard"));
        copy.then(
          () => say(`Link copied: ${url}`),
          () => say(`Link: ${url}`),
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
    say(answer.source === "offline" ? answer.message : "The AI chose these parameters. Enter applies them; Tab edits them first.");
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

  const market = status.market;
  const { frame, candles, tape, frameCount, headlines, chat } = market;
  const who = selectedCandle !== null && whoWindow !== null ? whoWindow : frame.who;
  const scenario = run?.scenario ?? FREE_PLAY;
  const shown = latestEvent !== null && latestEvent.seq > reply.seen ? formatUserEvent(latestEvent) : reply.text;
  return (
    <div className={styles.shell}>
      <StatusBar frame={frame} scenarioTitle={scenario.title} paused={paused} speed={speed} />
      <TickerTape ticker={frame.ticker} trades={frame.trades} headlines={frame.headlines} frameCount={frameCount} />
      <CommandBar onCommand={onCommand} reply={shown} />
      <NewsPreview news={news} onEdit={onEdit} onApply={apply} onCancel={onCancel} />
      <main className={styles.grid}>
        <Panel number={1} code="GP" title={`${frame.ticker} PRICE · ${formatInterval(frame.candleMs)} CANDLES`} className={styles.gp}>
          <PriceChart candles={candles} candleMs={frame.candleMs} last={frame.last} headlines={headlines} selected={selectedCandle} onSelect={(s) => onSelectCandle(s, frame.candleMs)} />
        </Panel>
        <Panel number={2} code="WHO" title="WHO MOVED THE PRICE" className={styles.whoArea}>
          <WhoPanel who={who} selected={selectedCandle !== null && whoWindow !== null} />
        </Panel>
        <Panel number={3} code="CHAT" title="DESK CHAT" className={styles.chatArea}>
          <ChatPanel chat={chat} />
        </Panel>
        <Panel number={4} code="TAPE" title="TIME & SALES" className={styles.tape}>
          <TapePanel tape={tape} />
        </Panel>
        <Panel number={5} code="BOOK" title={`${frame.ticker} DEPTH`} className={styles.book}>
          <BookPanel frame={frame} />
        </Panel>
        <Panel number={6} code="TKT" title="ORDER TICKET" meta="SIMULATED · NO REAL MONEY" className={styles.tkt}>
          <TicketPanel frame={frame} lastEvent={latestEvent} paused={paused} onCommand={onCommand} />
        </Panel>
        <Panel number={7} code="NEWS" title="SCENARIO & HEADLINES" className={styles.newsArea}>
          <NewsPanel scenario={scenario} market={market} onCommand={onCommand} />
        </Panel>
        <Panel number={8} code="EXR" title="EXECUTION REPORT" meta="COST VS THE MID WHEN YOUR ORDER ARRIVED" className={styles.exr}>
          <ExecPanel exr={market.exr} />
        </Panel>
      </main>
      <ControlStrip paused={paused} speed={speed} onCommand={onCommand} />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
