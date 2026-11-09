import type { UserEvent } from "@/engine/simulation";
import { formatAvgPrice, formatPrice, formatQty } from "./format";

/**
 * One line saying what happened to one of the student's commands, in plain words. Every number in
 * it comes from the event the engine logged.
 */
export function formatUserEvent(e: UserEvent): string {
  if (e.kind === "cancel") return e.message;
  const side = e.side === "buy" ? "BUY" : "SELL";
  const what = `${side} ${formatQty(e.requestedQty)}${e.limitPrice !== null ? ` @ ${formatPrice(e.limitPrice)}` : ""}`;
  switch (e.status) {
    case "rejected":
      return `${what} rejected: ${e.message}`;
    case "filled":
      return `${what} filled @ ${formatAvgPrice(e.avgPrice!)}`;
    case "resting":
      return `${what} is resting in the book until the market trades at your price.`;
    case "cancelled":
      return `${what}: ${e.message}`;
    case "partial": {
      const filled = `${side} ${formatQty(e.filledQty)} of ${formatQty(e.requestedQty)} filled @ ${formatAvgPrice(e.avgPrice!)}`;
      if (e.restingQty > 0) return `${filled}; ${formatQty(e.restingQty)} resting in the book.`;
      return `${filled}; ${formatQty(e.cancelledQty)} cancelled: the book ran out of shares to trade against.`;
    }
  }
}
