"use client";

import { useEffect, useRef } from "react";
import type { Scenario } from "@/engine/scenarios";
import styles from "./terminal.module.css";

/**
 * SESSION (D-073): what this run is, so it can be reproduced: scenario, seed, mode and the link that
 * reopens it. Moved off the status strip; opened by the SESSION button or command. Closes on Esc or a
 * click outside it.
 */
export function SessionPopover({ scenario, seed, learn, link, onCommand, onClose }: { scenario: Scenario; seed: number; learn: boolean; link: string; onCommand: (text: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // The SESSION button toggles it itself.
      if (ref.current?.contains(target as Node) || target?.closest("[data-testid=playback-session]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={styles.sessionPop} role="dialog" aria-label="Session" data-testid="session">
      <dl className={styles.sessionGrid}>
        <dt>SCN</dt>
        <dd data-testid="status-scenario" title={scenario.id}>
          {scenario.title}
        </dd>
        <dt>SEED</dt>
        <dd data-testid="session-seed">{seed}</dd>
        <dt>MODE</dt>
        <dd>{learn ? "LEARN" : "PRO"}</dd>
        <dt>LINK</dt>
        <dd className={styles.sessionLink} title={link}>
          {link}
        </dd>
      </dl>
      <div className={styles.formRow}>
        <button type="button" className={styles.chip} onClick={() => onCommand("LINK")}>
          COPY LINK
        </button>
        <button type="button" className={styles.chip} onClick={() => onCommand("RERUN")}>
          RERUN
        </button>
        <button type="button" className={styles.chip} onClick={onClose}>
          CLOSE <span className={styles.label}>ESC</span>
        </button>
      </div>
    </div>
  );
}
