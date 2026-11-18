"use client";

import type { FrameExecution } from "@/engine/feed";
import type { Frame } from "@/engine/feed";
import type { UserEvent } from "@/engine/simulation";
import { ExecPanel } from "./ExecPanel";
import styles from "./terminal.module.css";
import { OpenOrders, TicketPanel } from "./TicketPanel";

export type TicketTab = "ORDER" | "FILLS" | "OPEN";

/**
 * TKT with three tabs (D-075): ORDER (the ticket and SEND), FILLS (the execution report, formerly the
 * EXR panel) and OPEN (resting limit orders). FILLS shows how many orders filled since it was last
 * seen; OPEN shows how many orders rest. `TKT` opens ORDER, `EXR` opens FILLS.
 */
export function TicketDesk({ tab, onTab, frame, exr, fillsUnread, lastEvent, paused, onCommand }: { tab: TicketTab; onTab: (tab: TicketTab) => void; frame: Frame; exr: FrameExecution | null; fillsUnread: number; lastEvent: UserEvent | null; paused: boolean; onCommand: (text: string) => void }) {
  const open = frame.desk.openOrders;
  const tabButton = (t: TicketTab, count: number) => (
    <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.drawerTab} ${tab === t ? styles.drawerTabOn : ""}`} data-testid={`ticket-tab-${t}`} onClick={() => onTab(t)}>
      {t}
      {count > 0 && <span className={styles.drawerCount}>{count}</span>}
    </button>
  );
  return (
    <div className={styles.ticketDesk} data-tab={tab}>
      <div className={styles.subTabs} role="tablist" aria-label="Ticket">
        {tabButton("ORDER", 0)}
        {tabButton("FILLS", tab === "FILLS" ? 0 : fillsUnread)}
        {tabButton("OPEN", open.length)}
      </div>
      <div className={styles.ticketBody}>
        {tab === "ORDER" && <TicketPanel frame={frame} lastEvent={lastEvent} paused={paused} onCommand={onCommand} />}
        {tab === "FILLS" && <ExecPanel exr={exr} />}
        {tab === "OPEN" && <OpenOrders orders={open} onCommand={onCommand} />}
      </div>
    </div>
  );
}
