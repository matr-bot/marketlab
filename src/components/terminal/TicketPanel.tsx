"use client";

import { useState, type ReactNode } from "react";
import type { Frame } from "@/engine/feed";
import type { UserEvent } from "@/engine/simulation";
import { parseCommand } from "@/lib/command";
import { estimateMarketFill } from "@/lib/estimate";
import { formatAvgPrice, formatBps, formatCentsPerShare, formatDollars, formatMid, formatMidX2, formatPrice, formatQty } from "@/lib/format";
import { formatUserEvent } from "@/lib/userMessages";
import { Explain } from "./Learn";
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
 * cost before you send it. The selected side is filled green (BUY) or red (SELL), the one place
 * outside price direction and BOOK that uses them (D-068).
 */
export function TicketPanel({ frame, lastEvent, paused, onCommand }: { frame: Frame; lastEvent: UserEvent | null; paused: boolean; onCommand: (text: string) => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [qty, setQty] = useState("500");
  const [price, setPrice] = useState("");

  const text = `${side.toUpperCase()} ${qty.trim()}${type === "limit" ? ` @ ${price.trim()}` : ""}`;
  const cmd = qty.trim() === "" || (type === "limit" && price.trim() === "") ? null : parseCommand(text);
  const order = cmd !== null && cmd.kind === "order" ? cmd.order : null;
  // Why SEND is disabled (QA #10), as a short label (D-072); the full reason is the tooltip. Text that
  // is not a number parses as a headline (D-061), so the ticket says what it needs itself.
  const blocked: { label: string; reason: string } | null =
    order !== null
      ? null
      : qty.trim() === ""
        ? { label: "ENTER QTY", reason: "Enter a number of shares." }
        : cmd === null
          ? { label: "ENTER PX", reason: "Enter a limit price." }
          : cmd.kind === "error"
            ? { label: cmd.message.includes("is not a price") ? "INVALID PX" : "INVALID QTY", reason: cmd.message }
            : { label: "INVALID QTY", reason: `"${qty.trim().slice(0, 12)}" is not a number of shares: use a whole number, like 500 or 5K.` };
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

  // What the order would do, from the book on screen: one line of data (D-072); slippage in basis
  // points of the mid. Learn mode adds the words and cents per share.
  let preview: string;
  let explain: ReactNode = null;
  if (order === null) {
    preview = blocked!.label;
  } else if (order.type === "market") {
    const e = estimateMarketFill(side === "buy" ? frame.asks : frame.bids, order.qty, side, mid);
    if (e.avgPrice === null) {
      preview = "NO LIQUIDITY";
      explain = <Explain id="tkt.empty" />;
    } else {
      const bps = e.slippageCents === null || mid === null ? null : (e.slippageCents / mid) * 10_000;
      const cost = bps === null ? "" : ` · SLIP ${formatBps(bps)} BPS`;
      const short = e.shortBy === 0 ? "" : e.bookExhausted ? ` · ${formatQty(e.filledQty)}/${formatQty(order.qty)} AVAILABLE` : ` · ${formatQty(e.shortBy)} BEYOND BOOK SHOWN`;
      preview = `EST AVG ${formatAvgPrice(e.avgPrice)}${cost}${short}`;
      if (e.slippageCents !== null) explain = <Explain id="tkt.estimate">Estimated cost {formatCentsPerShare(e.slippageCents)}¢ per share versus the mid, walking the book on screen the way the matching engine will.</Explain>;
    }
  } else {
    const crosses = side === "buy" ? frame.ask !== null && order.price >= frame.ask : frame.bid !== null && order.price <= frame.bid;
    if (!crosses) {
      preview = `RESTS @ ${formatPrice(order.price)}`;
      explain = <Explain id="tkt.rests">Rests in the book at {formatPrice(order.price)} and fills only if the market trades to it.</Explain>;
    } else {
      const levels = (side === "buy" ? frame.asks : frame.bids).filter((l) => (side === "buy" ? l.price <= order.price : l.price >= order.price));
      const e = estimateMarketFill(levels, order.qty, side, mid);
      preview = `CROSSES · EST ${formatQty(e.filledQty)} @ ${e.avgPrice === null ? "—" : formatAvgPrice(e.avgPrice)}${e.shortBy > 0 ? ` · ${formatQty(e.shortBy)} RESTS @ ${formatPrice(order.price)}` : ""}`;
    }
  }

  const { desk } = frame;
  return (
    <div className={styles.ticket} data-testid="ticket">
      <Explain id="tkt.simulated" />
      <div className={styles.quoteRow} data-testid="ticket-quote">
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
          <dd>{Number.isInteger(desk.mark * 2) ? formatMidX2(desk.mark * 2) : formatAvgPrice(desk.mark)}</dd>
        </div>
      </dl>

      <div className={styles.formRow}>
        <div className={styles.segment} role="group" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.segBtn} ${side === s ? (s === "buy" ? styles.buyOn : styles.sellOn) : ""}`}
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
            <span className={styles.label}>PX</span>
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

      <div className={styles.preview} data-testid="ticket-preview" title={blocked?.reason}>
        {preview}
        {explain}
      </div>

      <button type="button" className={styles.sendBtn} disabled={order === null} data-testid="ticket-send" title={blocked?.reason} onClick={send}>
        {order === null ? "SEND" : `SEND ${side.toUpperCase()} ${formatQty(order.qty)} ${order.type === "market" ? "MKT" : `@ ${formatPrice(order.price)}`}`}
      </button>
      {paused && (
        <div className={styles.note} data-testid="ticket-paused">
          queued — market paused
          <Explain id="tkt.paused" />
        </div>
      )}

      {/* The outcome of the last order; not drawn until there is one (D-073). */}
      {lastEvent !== null ? (
        <div className={styles.lastMessage} data-testid="ticket-message">
          {formatUserEvent(lastEvent)}
        </div>
      ) : (
        <Explain id="tkt.messages" />
      )}
    </div>
  );
}

/** OPEN (D-075): the student's resting limit orders, newest last, with CANCEL ALL. */
export function OpenOrders({ orders, onCommand }: { orders: Frame["desk"]["openOrders"]; onCommand: (text: string) => void }) {
  return (
    <div className={styles.openOrders} data-testid="open-orders">
      {orders.length === 0 ? (
        <div className={styles.dim}>—</div>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>B/S</th>
                <th>QTY</th>
                <th>PX</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} data-testid="open-row">
                  <td>{o.side === "buy" ? "B" : "S"}</td>
                  <td>{formatQty(o.qty)}</td>
                  <td>{formatPrice(o.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.formRow}>
            <button type="button" className={styles.chip} data-testid="ticket-cancel" onClick={() => onCommand("CANCEL")}>
              CANCEL ALL
            </button>
          </div>
        </>
      )}
    </div>
  );
}
