import type { Frame } from "@/engine/feed";

// Messages between the page and the simulation worker (D-037). The page asks for a frame once per
// animation frame and waits for the answer before asking again, so at most one frame is in flight
// and the worker never posts more than one message per animation frame.

export type ToWorker =
  /** Build the market for `seed` and warm it up; answered with the first frame. */
  | { readonly type: "start"; readonly seed: number }
  /** Run the ticks due since the last request at `speed`× real time; answered with a frame. */
  | { readonly type: "frame"; readonly speed: number };

export type FromWorker =
  | { readonly type: "frame"; readonly frame: Frame }
  | { readonly type: "error"; readonly message: string };
