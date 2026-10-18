"use client";

import { useEffect, useRef, useState } from "react";
import { parseCommand } from "@/lib/command";
import styles from "./terminal.module.css";

/**
 * The command bar: type a code and press Enter (CLAUDE.md, Command bar). Today it runs the offline
 * headlines FED, CEO, BEAT and DOWNGRADE (D-048), with no network call. Keyboard first: typing
 * anywhere on the page goes to the bar; Esc clears it.
 */
export function CommandBar({ onShock }: { onShock: (code: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("Type FED, CEO, BEAT or DOWNGRADE and press Enter to send a headline.");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (input === null || document.activeElement === input || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) input.focus(); // the key itself lands in the bar
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const cmd = parseCommand(text);
    if (cmd.kind === "empty") return;
    if (cmd.kind === "error") {
      setReply(cmd.message);
      return;
    }
    onShock(cmd.code);
    setReply(`${cmd.code} · ${cmd.headline}`);
    setText("");
  };

  return (
    <div className={styles.commandBar}>
      <span className={styles.prompt}>&gt;</span>
      <input
        ref={inputRef}
        className={styles.commandInput}
        data-testid="command-input"
        aria-label="Command"
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setText("");
        }}
      />
      <span className={styles.commandReply} data-testid="command-reply">
        {reply}
      </span>
    </div>
  );
}
