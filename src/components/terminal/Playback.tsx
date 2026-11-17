"use client";

import { SPEEDS } from "@/lib/command";
import styles from "./terminal.module.css";

/**
 * Playback on the status strip (D-073): RUN/PAUSE, the speed segment, RERUN, LINK, then SESSION and
 * HELP. The same commands as the command bar, one click away; the selected speed is white on the
 * border gray, never amber.
 */
export function Playback({ paused, speed, sessionOpen, onCommand }: { paused: boolean; speed: number; sessionOpen: boolean; onCommand: (text: string) => void }) {
  return (
    <span className={styles.playback} role="group" aria-label="Playback" data-testid="playback">
      <button type="button" className={`${styles.segBtn} ${styles.playBtn}`} aria-pressed={paused} data-testid="playback-pause" onClick={() => onCommand(paused ? "RUN" : "PAUSE")} title={paused ? "Resume the market (RUN)" : "Pause the market (PAUSE)"}>
        {paused ? "RUN" : "PAUSE"}
      </button>
      <span className={styles.segment} role="group" aria-label="Speed">
        {SPEEDS.map((n) => (
          <button key={n} type="button" className={`${styles.segBtn} ${styles.playBtn} ${speed === n ? styles.segOn : ""}`} aria-pressed={speed === n} data-testid={`playback-speed-${n}`} onClick={() => onCommand(`SPEED ${n}`)} title={`${n}× real time (SPEED ${n}). Same seed, same market, whatever the speed.`}>
            {n}X
          </button>
        ))}
      </span>
      <button type="button" className={`${styles.segBtn} ${styles.playBtn}`} onClick={() => onCommand("RERUN")} title="Start this scenario again from the open, same seed (RERUN)">
        RERUN
      </button>
      <button type="button" className={`${styles.segBtn} ${styles.playBtn}`} data-testid="playback-link" onClick={() => onCommand("LINK")} title="Copy a link that reopens this exact session (LINK)">
        LINK
      </button>
      <button type="button" className={`${styles.segBtn} ${styles.playBtn} ${sessionOpen ? styles.segOn : ""}`} aria-pressed={sessionOpen} aria-haspopup="dialog" data-testid="playback-session" onClick={() => onCommand("SESSION")} title="Scenario, seed, mode and link (SESSION)">
        SESSION
      </button>
      <button type="button" className={`${styles.segBtn} ${styles.playBtn}`} onClick={() => onCommand("HELP")} title="Every command and abbreviation (HELP)">
        HELP
      </button>
    </span>
  );
}
