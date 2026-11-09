"use client";

import { useState } from "react";
import type { Frame } from "@/engine/feed";
import type { UserEvent } from "@/engine/simulation";
import { parseCommand } from "@/lib/command";
import { estimateMarketFill } from "@/lib/estimate";
import { formatAvgPrice, formatCentsPerShare, formatDollars, formatMid, formatPrice, formatQty } from "@/lib/format";
import { formatUserEvent } from "@/lib/userMessages";
import styles from "./terminal.module.css";

const QUICK_SIZES: readonly (readonly [string, string])[] = [
  ["100", "100"],
  ["500", "500"],
  ["1K", "1000"],
  ["5K", "5000"],
];

/**
 * TKT: the order ticket. A thin form over the command bar: it builds the same text you could type
 * (`BUY 500 @ 187.25`), runs it through the same parser, and sends it. Below the form, an estimate
 * walks the book on screen the way the matching engine will, so you see roughly what an order will
 * cost before you send it. Green and red mean price direction only, so the two sides are told apart
 * by label and outline, not by color.
 */
export function TicketPanel({ frame, lastEvent, paused, onCommand }: { frame: Frame; lastEvent: UserEvent | null; paused: boolean; onCommand: (text: string) => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [qty, setQty] = useState("500");
  const [price, setPrice] = useState("");

  const text = `${side.toUpperCase()} ${qty.trim()}${type === "limit" ? ` @ ${price.trim()}` : ""}`;
  const cmd = qty.trim() === "" || (type === "limit" && price.trim() === "") ? null : parseCommand(text);
  const order = cmd !== null && cmd.kind === "order" ? cmd.order : null;
  const mid = frame.bid !== null && frame.ask !== null ? (frame.bid + frame.ask) / 2 : null;

  const send = () => {
    if (order !== null) onCommand(text);
  };
  const chooseType = (next: "market" | "limit") => {
    setType(next);
    // A limit order starts at the price that rests: the best bid for a buy, the best ask for a sell.
    if (next === "limit" && price === "") fillPrice(side === "buy" ? frame.bid : frame.ask);
  };
  const fillPrice = (cents: number | null) => {
    if (cents !== null) setPrice(formatPrice(cents).replace(/,/g, ""));
  };

  // What the order would do, from the book on screen.
  let preview: string;
  if (order === null) {
    preview = cmd !== null && cmd.kind === "error" ? cmd.message : "Enter a number of shares" + (type === "limit" ? " and a price." : ".");
  } else if (order.type === "market") {
    const e = estimateMarketFill(side === "buy" ? frame.asks : frame.bids, order.qty, side, mid);
    if (e.avgPrice === null) preview = "Nothing to trade against: this order would be cancelled.";
    else {
      const cost = e.slippageCents === null ? "" : ` · ${formatCentsPerShare(e.slippageCents)}¢/sh vs mid`;
      const short = e.shortBy === 0 ? "" : e.bookExhausted ? ` · only ${formatQty(e.filledQty)} of ${formatQty(order.qty)} available` : ` · ${formatQty(e.shortBy)} may fill beyond the levels shown`;
      preview = `EST. AVG ${formatAvgPrice(e.avgPrice)}${cost}${short}`;
    }
  } else {
    const crosses = side === "buy" ? frame.ask !== null && order.price >= frame.ask : frame.bid !== null && order.price <= frame.bid;
    if (!crosses) preview = `Rests in the book at ${formatPrice(order.price)} and fills only if the market trades to it.`;
    else {
      const levels = (side === "buy" ? frame.asks : frame.bids).filter((l) => (side === "buy" ? l.price <= order.price : l.price >= order.price));
      const e = estimateMarketFill(levels, order.qty, side, mid);
      preview = `Crosses the spread: EST. ${formatQty(e.filledQty)} fill @ ${e.avgPrice === null ? "—" : formatAvgPrice(e.avgPrice)}${e.shortBy > 0 ? `, ${formatQty(e.shortBy)} rest at ${formatPrice(order.price)}` : ""}`;
    }
  }

  const { desk } = frame;
  const open = desk.openOrders;
  return (
    <div className={styles.ticket} data-testid="ticket">
      <div className={styles.quoteRow}>
        <span className={styles.label}>BID</span>
        <span className={styles.num}>{frame.bid === null ? "—" : formatPrice(frame.bid)}</span>
        <span className={styles.dim}>×{frame.bids.length > 0 ? formatQty(frame.bids[0].qty) : "—"}</span>
        <span className={styles.label}>ASK</span>
        <span className={styles.num}>{frame.ask === null ? "—" : formatPrice(frame.ask)}</span>
        <span className={styles.dim}>×{frame.asks.length > 0 ? formatQty(frame.asks[0].qty) : "—"}</span>
        <span className={styles.label}>MID</span>
        <span className={styles.num}>{frame.bid === null || frame.ask === null ? "—" : formatMid(frame.bid, frame.ask)}</span>
      </div>

      <dl className={styles.deskGrid}>
        <div title="Shares you hold: positive is long, negative is short.">
          <dt>POSITION</dt>
          <dd data-testid="ticket-position">{desk.position > 0 ? "+" : ""}{formatQty(desk.position)}</dd>
        </div>
        <div title="Cash from your trades plus your shares valued at the mid price. Crossing the spread shows up here as an immediate small loss.">
          <dt>P&amp;L</dt>
          <dd data-testid="ticket-pnl">{formatDollars(desk.pnl, true)}</dd>
        </div>
        <div title="The price your shares are valued at: the mid of the best bid and ask.">
          <dt>MARK</dt>
          <dd>{formatAvgPrice(desk.mark)}</dd>
        </div>
      </dl>

      <div className={styles.formRow}>
        <div className={styles.segment} role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.segBtn} ${side === s ? styles.segOn : ""}`}
              aria-pressed={side === s}
              data-testid={`ticket-${s}`}
              onClick={() => {
                setSide(s);
                if (type === "limit") fillPrice(s === "buy" ? frame.bid : frame.ask);
              }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className={styles.segment} role="group" aria-label="Order type">
          {(["market", "limit"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.segBtn} ${type === t ? styles.segOn : ""}`}
              aria-pressed={type === t}
              data-testid={`ticket-${t}`}
              title={t === "market" ? "Trades now at the best prices available, however far that takes the price." : "Trades only at your price or better; otherwise it waits in the book."}
              onClick={() => chooseType(t)}
            >
              {t === "market" ? "MKT" : "LMT"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.formRow}>
        <label className={styles.field}>
          <span className={styles.label}>QTY</span>
          <input
            className={styles.input}
            data-testid="ticket-qty"
            inputMode="numeric"
            value={qty}
            maxLength={10}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
        </label>
        {QUICK_SIZES.map(([label, value]) => (
          <button key={label} type="button" className={styles.chip} onClick={() => setQty(value)}>
            {label}
          </button>
        ))}
      </div>

      {type === "limit" && (
        <div className={styles.formRow}>
          <label className={styles.field}>
            <span className={styles.label}>PRICE</span>
            <input
              className={styles.input}
              data-testid="ticket-price"
              inputMode="decimal"
              value={price}
              maxLength={12}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
          </label>
          <button type="button" className={styles.chip} onClick={() => fillPrice(frame.bid)}>
            BID
          </button>
          <button type="button" className={styles.chip} onClick={() => fillPrice(frame.ask)}>
            ASK
          </button>
        </div>
      )}

      <div className={styles.preview} data-testid="ticket-preview">
        {preview}
      </div>

      <button type="button" className={styles.sendBtn} disabled={order === null} data-testid="ticket-send" onClick={send}>
        SEND {side.toUpperCase()} {order === null ? "" : formatQty(order.qty)} {type === "market" ? "MKT" : order !== null && order.type === "limit" ? `@ ${formatPrice(order.price)}` : "LMT"}
      </button>
      {paused && <div className={styles.note}>PAUSED: orders wait and execute when the market resumes (RUN).</div>}

      <div className={styles.openOrders}>
        <div className={styles.openHead}>
          <span className={styles.label}>OPEN ORDERS ({open.length})</span>
          {open.length > 0 && (
            <button type="button" className={styles.chip} data-testid="ticket-cancel" onClick={() => onCommand("CANCEL")}>
              CANCEL ALL
            </button>
          )}
        </div>
        {open.slice(0, 3).map((o) => (
          <div key={o.id} className={styles.openRow}>
            {o.side.toUpperCase()} {formatQty(o.qty)} @ {formatPrice(o.price)}
          </div>
        ))}
        {open.length > 3 && <div className={styles.dim}>+{open.length - 3} more</div>}
      </div>

      <div className={styles.lastMessage} data-testid="ticket-message">
        {lastEvent === null ? "Orders you send show here and in EXR with their exact cost." : formatUserEvent(lastEvent)}
      </div>
    </div>
  );
}
