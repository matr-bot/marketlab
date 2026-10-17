import type { ReactNode } from "react";
import styles from "./Panel.module.css";

type PanelProps = {
  /** Panel number in the default layout (CLAUDE.md, Default layout). */
  number: number;
  /** Function code, e.g. "GP". */
  code: string;
  title: string;
  className?: string;
  children: ReactNode;
};

/** A numbered terminal panel: header `1 GP · SPY PRICE`, then its body. */
export function Panel({ number, code, title, className, children }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ""}`} aria-label={`${code} ${title}`} data-panel={code}>
      <header className={styles.head}>
        <span className={styles.number}>{number}</span>
        <span className={styles.code}>{code}</span>
        <span className={styles.sep}>·</span>
        <h2 className={styles.title}>{title}</h2>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
