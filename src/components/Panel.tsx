import type { ReactNode } from "react";
import styles from "./Panel.module.css";

type PanelProps = {
  title: string;
  /** Short status tag shown in the header, e.g. the week a panel goes live. */
  tag?: string;
  className?: string;
  children: ReactNode;
};

export function Panel({ title, tag, className, children }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ""}`} aria-label={title}>
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {tag && <span className={styles.tag}>{tag}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Honest placeholder: says what the panel will show and when, never fake data. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <div className={styles.placeholder}>{children}</div>;
}
