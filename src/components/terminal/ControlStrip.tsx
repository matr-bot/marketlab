"use client";

import { SPEEDS } from "@/lib/command";
import styles from "./terminal.module.css";

/**
 * The bottom strip: the same commands as the command bar, one click away. Nothing here does
 * anything the keyboard cannot; it is there for people who have not learned the commands yet.
 */
export function ControlStrip({ paused, speed, onCommand }: { paused: boolean; speed: number; onCommand: (text: string) => void }) {
  return (
    <footer className={styles.strip} data-testid="strip">
      <button type="button" className={styles.chip} onClick={() => onCommand("HELP")} title="List every command">
        HELP
      </button>
      <button type="button" className={`${styles.chip} ${paused ? styles.segOn : ""}`} aria-pressed={paused} data-testid="strip-pause" onClick={() => onCommand(paused ? "RUN" : "PAUSE")} title={paused ? "Resume the market" : "Pause the market"}>
        {paused ? "RUN" : "PAUSE"}
      </button>
      <span className={styles.group} role="group" aria-label="Speed">
        {SPEEDS.map((n) => (
          <button key={n} type="button" className={`${styles.chip} ${speed === n ? styles.segOn : ""}`} aria-pressed={speed === n} onClick={() => onCommand(`SPEED ${n}`)} title={`Run the market ${n} times faster than real time`}>
            {n}X
          </button>
        ))}
      </span>
      <button type="button" className={styles.chip} onClick={() => onCommand("RERUN")} title="Start this scenario again from the open, same seed">
        RERUN
      </button>
      <button type="button" className={styles.chip} data-testid="strip-link" onClick={() => onCommand("LINK")} title="Copy a link that reopens this exact scenario and seed">
        LINK
      </button>
      <span className={styles.spacer} />
      <span className={styles.dim}>Type a headline or a command anywhere · FED · SHOCK -3 · BUY 500 · SELL 500 @ 187.25 · SCN · HELP</span>
    </footer>
  );
}
