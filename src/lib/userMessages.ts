import type { UserEvent } from "@/engine/simulation";
import { formatAvgPrice, formatPrice, formatQty } from "./format";

/**
 * One line saying what happened to one of the student's commands, as data rather than a sentence
 * (D-072). Every number in it comes from the event the engine logged.
 */
export function formatUserEvent(e: UserEvent): string {
  // The strategy's orders say so, so they are never mistaken for the student's own (D-062).
  return e.source === "strategy" ? `STRAT · ${describe(e)}` : describe(e);
}

function describe(e: UserEvent): string {
  if (e.kind === "cancel") return e.message;
  const side = e.side === "buy" ? "BUY" : "SELL";
  const what = `${side} ${formatQty(e.requestedQty)}${e.limitPrice !== null ? ` @ ${formatPrice(e.limitPrice)}` : ""}`;
  // A resting order traded later, against someone else's order.
  if (e.kind === "fill") return e.status === "filled" ? `${what} filled` : `${what}: ${formatQty(e.filledQty)} filled, ${formatQty(e.restingQty)} resting`;
  switch (e.status) {
    case "rejected":
      return `${what} rejected: ${e.message}`;
    case "filled":
      return `${what} filled @ ${formatAvgPrice(e.avgPrice!)}`;
    case "resting":
      return `${what} resting`;
    case "cancelled":
      return `${what}: ${e.message}`;
    case "partial": {
      const filled = `${side} ${formatQty(e.filledQty)} of ${formatQty(e.requestedQty)} filled @ ${formatAvgPrice(e.avgPrice!)}`;
      if (e.restingQty > 0) return `${filled}; ${formatQty(e.restingQty)} resting`;
      return `${filled}; ${formatQty(e.cancelledQty)} cancelled · book exhausted`;
    }
  }
}
