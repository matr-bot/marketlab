"use client";

import { useEffect, useRef } from "react";
import { SCENARIOS } from "@/engine/scenarios";
import { HELP_LINES } from "@/lib/command";
import styles from "./terminal.module.css";

/** HELP: every command, what it does, and the scenarios. Closes on Esc, a click outside, or the button. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus the dialog itself, not its Close button: the Enter that ran HELP is still being delivered,
  // and on a focused button it would press Close and shut the dialog at once.
  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Help" data-testid="help" onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.dialogHead}>
          <span>HELP · COMMANDS</span>
          <button type="button" className={styles.chip} onClick={onClose}>
            CLOSE (ESC)
          </button>
        </header>
        <div className={styles.dialogBody}>
          <p className={styles.para}>
            MarketLab is a simulated market: a crowd of trading programs in a real order book. Nothing here is a real security and no money is real. Prices come only from the trades; when you trade, you move the price too.
          </p>
          <table className={styles.helpTable}>
            <tbody>
              {HELP_LINES.map(([cmd, what]) => (
                <tr key={cmd}>
                  <td className={styles.helpCmd}>{cmd}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.sectionHead}>SCENARIOS</div>
          <table className={styles.helpTable}>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s.id}>
                  <td className={styles.helpCmd}>SCN {s.id}</td>
                  <td>
                    <strong>{s.title}.</strong> {s.teaches}.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.dim}>Assigning a scenario: run LINK and send the link. Everyone who opens it gets the same market and the same headlines at the same moments, so results are comparable.</p>
        </div>
      </div>
    </div>
  );
}
