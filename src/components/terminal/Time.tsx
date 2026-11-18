import { formatSimTime } from "@/engine/simClock";
import styles from "./terminal.module.css";

/** A sim timestamp as HH:MM:SS.mmm, the milliseconds in label gray (D-080). */
export function Time({ ms }: { ms: number }) {
  const t = formatSimTime(ms);
  return (
    <>
      {t.slice(0, 8)}
      <span className={styles.bigFigure}>{t.slice(8)}</span>
    </>
  );
}
