"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/Panel";
import type { Attribution } from "@/engine/attribution";
import type { PresetResult } from "@/engine/feed";
import { clampShock, type ShockParams } from "@/engine/fundamental";
import { presetByCode } from "@/engine/presets";
import { parseCommand } from "@/lib/command";
import { formatInterval } from "@/lib/format";
import { offlineMatch, OFFLINE_HELP } from "@/lib/offlineMatch";
import type { InterpretResponse } from "@/lib/schemas";
import { BookPanel } from "./BookPanel";
import { ChatPanel } from "./ChatPanel";
import { CommandBar } from "./CommandBar";
import { NewsPreview, type NewsState } from "./NewsPreview";
import { PriceChart } from "./PriceChart";
import { StatusBar } from "./StatusBar";
import { TapePanel } from "./TapePanel";
import { TickerTape } from "./TickerTape";
import styles from "./terminal.module.css";
import { useMarket } from "./useMarket";
import { WhoPanel } from "./WhoPanel";

const CLIENT_TIMEOUT_MS = 8_000;

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

/**
 * The terminal. Panels keep their default-layout numbers (CLAUDE.md); functions that have not
 * shipped yet are simply not drawn, and the grid closes up around the ones that have.
 */
export function Terminal() {
  const [reply, setReply] = useState("Type a headline, or FED, CEO, BEAT or DOWNGRADE, and press Enter.");
  const [news, setNews] = useState<NewsState>({ phase: "idle" });
  const [whoWindow, setWhoWindow] = useState<Attribution | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<number | null>(null);
  const pendingApply = useRef(false);

  const handlers = useMemo(
    () => ({
      // The worker decides whether a headline is accepted (at most one per 3 s of sim time, D-051).
      onShockResult: (r: PresetResult) => {
        setReply(r.ok ? `${r.code} · ${r.headline}` : r.message);
        if (pendingApply.current) {
          pendingApply.current = false;
          if (r.ok) setNews((n) => (n.phase === "preview" || n.phase === "applied" ? { ...n, phase: "applied", edited: false } : n));
        }
      },
      onWho: (a: Attribution) => setWhoWindow(a),
    }),
    [],
  );
  const { status, sendShock, sendParams, requestWho } = useMarket(handlers);

  const apply = useCallback(() => {
    if (news.phase !== "preview" && !(news.phase === "applied" && news.edited)) return;
    pendingApply.current = true;
    sendParams(clampShock(news.draft), news.phase === "applied" ? `${news.headline} (edited)` : news.headline);
  }, [news, sendParams]);

  const onCommand = async (text: string) => {
    if (text.trim() === "") {
      apply(); // Enter on an empty bar applies the preview
      return;
    }
    const cmd = parseCommand(text);
    if (cmd.kind === "empty") return;
    if (cmd.kind === "error") {
      setReply(cmd.message);
      return;
    }
    if (cmd.kind === "shock") {
      setNews({ phase: "idle" });
      sendShock(cmd.code);
      return;
    }
    setNews({ phase: "interpreting", headline: cmd.headline });
    const answer = await interpret(cmd.headline);
    if (!answer.ok) {
      setNews({ phase: "idle" });
      setReply(answer.message);
      return;
    }
    if (answer.scenario === null) {
      setNews({ phase: "idle" });
      setReply(answer.source === "offline" ? answer.message : OFFLINE_HELP);
      return;
    }
    const source = answer.source === "offline" ? `offline preset ${answer.preset}` : answer.source === "cache" ? "AI (cached)" : "AI";
    setNews({ phase: "preview", headline: cmd.headline, source, reason: answer.source === "offline" ? "" : answer.scenario.reason, draft: answer.scenario.shock, edited: false });
    setReply(answer.source === "offline" ? answer.message : "The AI chose these parameters. Enter applies them; Tab edits them first.");
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

  const { frame, candles, tape, frameCount, headlines, chat } = status.market;
  const who = selectedCandle !== null && whoWindow !== null ? whoWindow : frame.who;
  return (
    <div className={styles.shell}>
      <StatusBar frame={frame} />
      <TickerTape ticker={frame.ticker} trades={frame.trades} headlines={frame.headlines} frameCount={frameCount} />
      <CommandBar onCommand={onCommand} reply={reply} />
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
      </main>
    </div>
  );
}
