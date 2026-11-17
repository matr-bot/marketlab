"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EXPLAIN, type ExplainId } from "@/lib/explain";
import styles from "./terminal.module.css";

/** Learn mode on or off (D-072). Off by default: the terminal shows data only. */
export const LearnContext = createContext(false);

export function useLearn(): boolean {
  return useContext(LearnContext);
}

/**
 * A Learn-mode explanation: nothing in the default view; in Learn mode, the entry's text from
 * `explain.ts` (or `children`, for an entry whose text is live) in label gray.
 */
export function Explain({ id, children, inline = false }: { id: ExplainId; children?: ReactNode; inline?: boolean }) {
  if (!useLearn()) return null;
  const Tag = inline ? "span" : "div";
  return (
    <Tag className={styles.explain} data-explain={id}>
      {children ?? EXPLAIN[id]}
    </Tag>
  );
}
