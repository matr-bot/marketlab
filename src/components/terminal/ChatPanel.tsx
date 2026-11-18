"use client";

import type { ChatMessage } from "@/engine/narrator";
import { formatSimTime } from "@/engine/simClock";
import { Explain } from "./Learn";
import styles from "./terminal.module.css";

/**
 * Desk chat: the narrator's messages (D-055), every number from the engine. Newest on top (D-077), so
 * the latest event is always the first line, even in the compact five-line drawer.
 */
export function ChatPanel({ chat }: { chat: readonly ChatMessage[] }) {
  return (
    <div className={styles.chat} data-testid="chat">
      {chat.length === 0 && (
        <>
          <div className={styles.chatEmpty}>—</div>
          <Explain id="chat.empty" />
        </>
      )}
      {[...chat].reverse().map((m) => (
        <div key={m.seq} className={styles.chatRow} data-kind={m.kind}>
          <span className={styles.chatTime}>{formatSimTime(m.time).slice(0, 8)}</span>
          <span>{m.text}</span>
        </div>
      ))}
    </div>
  );
}
