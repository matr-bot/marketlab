"use client";

import type { ReactNode } from "react";
import panel from "../Panel.module.css";
import styles from "./terminal.module.css";

export type DrawerSide = "DESK" | "NEWS";

/**
 * The bottom drawer (D-074): STRAT, CHAT and NEWS share it. Collapsed it is one row of tabs, so the
 * chart and tape get the screen; open, it shows two panes: the strategy on the left and DESK (the
 * narrator) or NEWS (scenario and headlines) on the right, so a strategy and the market's reaction are
 * on screen together. Unread counts sit on the side tab that is not showing.
 */
export function Drawer({
  open,
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
  open: boolean;
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
    <section className={`${panel.panel} ${styles.drawer} ${active ? panel.active : ""}`} aria-label="Strategy, desk chat and news" data-panel="DRAWER" data-testid="drawer" data-open={open || undefined} data-active={active || undefined} onMouseDown={onActivate}>
      <header className={styles.drawerHead} role="tablist">
        <button type="button" role="tab" aria-selected={open} className={`${styles.drawerTab} ${open ? styles.drawerTabOn : ""}`} data-testid="drawer-tab-STRAT" onClick={onOpenStrategy} title="Your strategy (STRAT)">
          STRATEGY
          {strategyRunning && <span className={styles.drawerCount}>RUN</span>}
        </button>
        <span className={styles.drawerSep} aria-hidden />
        {tab("DESK", "DESK")}
        {tab("NEWS", "NEWS")}
        <span className={styles.spacer} />
        <button type="button" className={styles.drawerToggle} aria-expanded={open} data-testid="drawer-toggle" onClick={onToggle} title={open ? "Collapse the drawer" : "Open the drawer"}>
          {open ? "▾" : "▴"}
        </button>
      </header>
      {open && (
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
