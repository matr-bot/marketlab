"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_COMMAND_LENGTH } from "@/lib/command";
import styles from "./terminal.module.css";

/**
 * The command bar: type a code and press Enter (CLAUDE.md, Command bar). Today it runs the offline
 * headlines FED, CEO, BEAT and DOWNGRADE (D-048), with no network call. Keyboard first: typing
 * anywhere on the page goes to the bar; Esc clears it. It only collects text; the terminal parses
 * it and shows the reply (a parse error, or the worker's accept / "still digesting" answer).
 */
export function CommandBar({ onCommand, reply }: { onCommand: (text: string) => void; reply: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (input === null || document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) input.focus(); // the key itself lands in the bar
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.commandBar}>
      <span className={styles.prompt}>&gt;</span>
      <input
        ref={inputRef}
        className={styles.commandInput}
        data-testid="command-input"
        aria-label="Command"
        value={text}
        maxLength={MAX_COMMAND_LENGTH}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommand(text);
            setText("");
          }
          if (e.key === "Escape") setText("");
        }}
      />
      <span className={styles.commandReply} data-testid="command-reply">
        {reply}
      </span>
    </div>
  );
}
