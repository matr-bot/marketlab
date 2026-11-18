"use client";

import type { Workspace } from "@/lib/keymap";
import { KeyHint } from "./KeyHint";
import styles from "./terminal.module.css";

/** The workspace tabs on the status strip (D-086): TRADE ⌥1 · STRATEGY ⌥2. */
export function WorkspaceTabs({ workspace, onSelect }: { workspace: Workspace; onSelect: (w: Workspace) => void }) {
  return (
    <span className={styles.workspaces} role="tablist" aria-label="Workspace">
      {(["TRADE", "STRATEGY"] as const).map((w, i) => (
        <button key={w} type="button" role="tab" aria-selected={workspace === w} className={`${styles.segBtn} ${styles.playBtn} ${workspace === w ? styles.segOn : ""}`} data-testid={`workspace-${w}`} onClick={() => onSelect(w)}>
          {w}
          <KeyHint k={`⌥${i + 1}`} />
        </button>
      ))}
    </span>
  );
}
