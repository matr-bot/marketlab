import type { OrderReport } from "@/engine/executionReport";

/**
 * A part of one order's cost (spread, impact, or the whole slippage) in basis points of the order's
 * value at the arrival mid: exactly the engine's `orderSlippageBps` definition applied to that part,
 * so the parts add up to the total (D-072). Null without an arrival mid or a cost.
 */
export function costBps(x2: number | null, r: Pick<OrderReport, "qty" | "arrivalMidX2">): number | null {
  return x2 === null || r.arrivalMidX2 === null || r.qty === 0 ? null : (x2 / (r.qty * r.arrivalMidX2)) * 10_000;
}
