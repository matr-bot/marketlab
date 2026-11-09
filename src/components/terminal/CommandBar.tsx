"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_COMMAND_LENGTH } from "@/lib/command";
import styles from "./terminal.module.css";

const HISTORY = 30;

/**
 * The command bar: type a headline or a command and press Enter (CLAUDE.md, Command bar; HELP lists them all).
 * Keyboard first: typing anywhere on the page goes to the bar; Esc clears it; the up and down
 * arrows recall earlier commands. It only collects text; the terminal parses it and shows the
 * reply (a parse error, the worker's answer, or what happened to your last order).
 */
export function CommandBar({ onCommand, reply }: { onCommand: (text: string) => void; reply: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const history = useRef<string[]>([]);
  const cursor = useRef(-1); // -1: not browsing history

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      const active = document.activeElement;
      // Typing in any field (the command bar itself, a NEWS parameter, the ticket's quantity and price) stays in that field.
      if (input === null || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 && e.key !== " ") input.focus(); // the key itself lands in the bar
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const recall = (step: 1 | -1) => {
    const h = history.current;
    if (h.length === 0) return;
    const next = Math.min(h.length - 1, Math.max(-1, cursor.current + step));
    cursor.current = next;
    setText(next === -1 ? "" : h[h.length - 1 - next]);
  };

  return (
    <div className={styles.commandBar}>
      <span className={styles.prompt}>&gt;</span>
      <input
        ref={inputRef}
        className={styles.commandInput}
        data-testid="command-input"
        aria-label="Command"
        placeholder="TYPE A HEADLINE OR A COMMAND · HELP"
        value={text}
        maxLength={MAX_COMMAND_LENGTH}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          cursor.current = -1;
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = text.trim();
            if (t !== "" && history.current[history.current.length - 1] !== t) history.current = [...history.current, t].slice(-HISTORY);
            cursor.current = -1;
            onCommand(text);
            setText("");
          }
          if (e.key === "Escape") {
            cursor.current = -1;
            setText("");
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            recall(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            recall(-1);
          }
        }}
      />
      <span className={styles.commandReply} data-testid="command-reply" role="status" aria-live="polite">
        {reply}
      </span>
    </div>
  );
}
