"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/engine/narrator";
import { formatSimTime } from "@/engine/simClock";
import styles from "./terminal.module.css";

/** Desk chat: the narrator's messages (D-055), newest at the bottom, every number from the engine. */
export function ChatPanel({ chat }: { chat: readonly ChatMessage[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const last = chat.length > 0 ? chat[chat.length - 1].seq : -1;
  useEffect(() => {
    const box = boxRef.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [last]);
  return (
    <div ref={boxRef} className={styles.chat} data-testid="chat">
      {chat.length === 0 && <div className={styles.chatEmpty}>The desk is watching the market…</div>}
      {chat.map((m) => (
        <div key={m.seq} className={styles.chatRow} data-kind={m.kind}>
          <span className={styles.chatTime}>{formatSimTime(m.time).slice(0, 8)}</span>
          <span>{m.text}</span>
        </div>
      ))}
    </div>
  );
}
