import type { ReactNode } from "react";
import styles from "./Panel.module.css";

type PanelProps = {
  /** Panel number in the default layout (CLAUDE.md, Default layout). */
  number: number;
  /** Function code, e.g. "GP". */
  code: string;
  title: string;
  /** Optional dim text at the right end of the header, e.g. a unit or a hint. */
  meta?: string;
  className?: string;
  /** The active panel: where a typed function code opens (CLAUDE.md, Command bar). */
  active?: boolean;
  /** Called on a mouse-down anywhere in the panel; it does not stop the click. */
  onActivate?: () => void;
  children: ReactNode;
};

/** A numbered terminal panel: header `1 GP · MLAB PRICE`, then its body. */
export function Panel({ number, code, title, meta, className, active = false, onActivate, children }: PanelProps) {
  return (
    <section
      className={`${styles.panel} ${active ? styles.active : ""} ${className ?? ""}`}
      aria-label={`${code} ${title}`}
      data-panel={code}
      data-slot={number}
      data-active={active || undefined}
      onMouseDown={onActivate}
    >
      <header className={styles.head}>
        <span className={styles.number}>{number}</span>
        <span className={styles.code}>{code}</span>
        <span className={styles.sep}>·</span>
        <h2 className={styles.title}>{title}</h2>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
