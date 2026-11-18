"use client";

import type { ReactNode } from "react";
import panel from "../Panel.module.css";
import { KeyHint } from "./KeyHint";
import styles from "./terminal.module.css";

export type DrawerSide = "DESK" | "NEWS";
export type DrawerMode = "closed" | "compact" | "full";

/**
 * The bottom drawer (D-074, D-077): STRAT, CHAT and NEWS share it. Closed it is one row of tabs, so the
 * chart and tape get the screen. Compact (what a headline opens) is DESK alone, full width, five lines,
 * newest on top. Full (STRATEGY opened by hand, or NEWS) shows two panes: the strategy on the left and
 * DESK or NEWS on the right. Unread counts sit on the side tab that is not showing.
 */
export function Drawer({
  mode,
  side,
  unread,
  strategyRunning,
  active,
  onActivate,
  onToggle,
  onOpenStrategy,
  onSide,
  strategy,
  desk,
  news,
}: {
  mode: DrawerMode;
  side: DrawerSide;
  unread: Readonly<Record<DrawerSide, number>>;
  strategyRunning: boolean;
  active: boolean;
  onActivate: () => void;
  onToggle: () => void;
  onOpenStrategy: () => void;
  onSide: (side: DrawerSide) => void;
  strategy: ReactNode;
  desk: ReactNode;
  news: ReactNode;
}) {
  const open = mode !== "closed";
  const full = mode === "full";
  const tab = (code: DrawerSide, label: string) => {
    const on = open && side === code;
    const count = on ? 0 : unread[code];
    return (
      <button type="button" role="tab" aria-selected={on} className={`${styles.drawerTab} ${on ? styles.drawerTabOn : ""}`} data-testid={`drawer-tab-${code}`} onClick={() => onSide(code)} title={code === "DESK" ? "Desk chat: the narrator (CHAT)" : "Scenario and headlines (NEWS)"}>
        {label}
        {count > 0 && (
          <span className={styles.drawerCount} data-testid={`drawer-unread-${code}`}>
            {count}
          </span>
        )}
      </button>
    );
  };
  return (
    <section className={`${panel.panel} ${styles.drawer} ${active ? panel.active : ""}`} aria-label="Strategy, desk chat and news" data-panel="DRAWER" data-testid="drawer" data-open={open || undefined} data-mode={mode} data-active={active || undefined} onMouseDown={onActivate}>
      <header className={styles.drawerHead} role="tablist">
        <button type="button" role="tab" aria-selected={full} className={`${styles.drawerTab} ${full ? styles.drawerTabOn : ""}`} data-testid="drawer-tab-STRAT" onClick={onOpenStrategy} title="Your strategy (STRAT)">
          STRATEGY
          {strategyRunning && <span className={styles.drawerCount}>RUN</span>}
        </button>
        <span className={styles.drawerSep} aria-hidden />
        {tab("DESK", "DESK")}
        {tab("NEWS", "NEWS")}
        <span className={styles.spacer} />
        <button type="button" className={styles.drawerToggle} aria-expanded={open} data-testid="drawer-toggle" onClick={onToggle} title={open ? "Collapse the drawer" : "Open the drawer"}>
          {open ? "▾" : "▴"}
          <KeyHint k="F3" />
        </button>
      </header>
      {mode === "compact" && (
        <div className={`${styles.drawerBody} ${styles.drawerCompact}`}>
          <div className={styles.drawerPane} data-pane="DESK">
            {desk}
          </div>
        </div>
      )}
      {full && (
        <div className={styles.drawerBody}>
          <div className={styles.drawerPane} data-pane="STRAT">
            {strategy}
          </div>
          <div className={styles.drawerPane} data-pane={side}>
            {side === "DESK" ? desk : news}
          </div>
        </div>
      )}
    </section>
  );
}
