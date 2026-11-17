import type { ReactNode } from "react";
import styles from "./Panel.module.css";

type PanelProps = {
  /** Slot in the default layout; kept as `data-slot` for tests, no longer drawn (D-070). */
  number: number;
  /** Function code, e.g. "GP". */
  code: string;
  /** What the panel is, for screen readers ("WHO MOVED THE PRICE"); not drawn (D-071). */
  label: string;
  /** Optional right-aligned gray detail in the header, e.g. `MLAB · 10S` or `60S`. */
  meta?: string;
  className?: string;
  /** The active panel: where a typed function code opens (CLAUDE.md, Command bar). */
  active?: boolean;
  /** Called on a mouse-down anywhere in the panel; it does not stop the click. */
  onActivate?: () => void;
  children: ReactNode;
};

/** A terminal panel: an 11px gray header with the function code and a right-aligned detail (`GP … MLAB · 10S`), then its body. */
export function Panel({ number, code, label, meta, className, active = false, onActivate, children }: PanelProps) {
  return (
    <section
      className={`${styles.panel} ${active ? styles.active : ""} ${className ?? ""}`}
      aria-label={`${code} ${label}`}
      data-panel={code}
      data-slot={number}
      data-active={active || undefined}
      onMouseDown={onActivate}
    >
      <header className={styles.head}>
        <h2 className={styles.code}>{code}</h2>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
