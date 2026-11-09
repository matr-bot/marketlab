import type { Attribution } from "@/engine/attribution";
import type { Frame, PresetResult } from "@/engine/feed";
import type { ShockParams } from "@/engine/fundamental";
import type { UserOrder, UserQueueResult } from "@/engine/simulation";

// Messages between the page and the simulation worker (D-037). The page asks for a frame once per
// animation frame and waits for the answer before asking again, so at most one frame is in flight
// and the worker never posts more than one message per animation frame.

export type ToWorker =
  /** Build the scenario's market for `seed` and warm it up; answered with the first frame. */
  | { readonly type: "start"; readonly seed: number; readonly scenarioId: string }
  /** Run the ticks due since the last request at `speed`× real time (none while paused); answered with a frame. */
  | { readonly type: "frame"; readonly speed: number; readonly paused: boolean }
  /** Apply an offline preset headline at the start of the next tick (D-048); answered with `shock`. */
  | { readonly type: "shock"; readonly code: string }
  /** Apply a headline with explicit params (AI or edited, D-052); answered with `shock`. */
  | { readonly type: "shockParams"; readonly shock: ShockParams; readonly label: string }
  /** Who moved the price in [from, to) (a clicked candle, D-054); answered with `who`. */
  | { readonly type: "who"; readonly from: number; readonly to: number }
  /** Apply the student's own headline: fair-value change as a fraction, panic sensitivity, duration in seconds; answered with `shock`. */
  | { readonly type: "customShock"; readonly fairValuePct: number; readonly panicSensitivity: number; readonly durationSec: number }
  /** Queue the student's order for the start of the next tick; answered with `order` (accepted or refused). */
  | { readonly type: "order"; readonly order: UserOrder }
  /** Queue "cancel all my open orders"; answered with `order`. */
  | { readonly type: "cancelOrders" };

export type FromWorker =
  | { readonly type: "frame"; readonly frame: Frame }
  /** Whether a headline was accepted, or why not (too soon after the last one, D-051). */
  | { readonly type: "shock"; readonly result: PresetResult }
  | { readonly type: "who"; readonly attribution: Attribution }
  /** Whether an order or cancel was queued, or why not. What it did arrives in a later frame's `userEvents`. */
  | { readonly type: "order"; readonly result: UserQueueResult }
  | { readonly type: "error"; readonly message: string };
