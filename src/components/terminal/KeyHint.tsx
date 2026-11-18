import styles from "./terminal.module.css";

/** A control's key, inside the control in label gray: `SEND ↵`, `BUY B` (D-080). */
export function KeyHint({ k }: { k: string }) {
  return (
    <span className={styles.keyHint} aria-hidden>
      {k}
    </span>
  );
}
