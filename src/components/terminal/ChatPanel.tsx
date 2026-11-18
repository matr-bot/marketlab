"use client";

import type { ChatMessage } from "@/engine/narrator";
import { Explain } from "./Learn";
import styles from "./terminal.module.css";
import { Time } from "./Time";

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
          <span className={styles.chatTime}>
            <Time ms={m.time} />
          </span>
          <span>{m.text}</span>
        </div>
      ))}
    </div>
  );
}
