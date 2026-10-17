import type { Cents } from "./types";
import { MAX_PRICE_CENTS } from "./validation";

// The one place a computed (floating-point) price becomes a whole-cent price (D-019, D-027).

/**
 * Round a computed price to the tick grid. Buys round DOWN and sells round UP, so rounding never
 * makes an order more aggressive than the trader intended. The result is clamped to
 * [tick, the highest tick ≤ MAX_PRICE_CENTS] and is always a safe integer number of cents.
 */
export function toTick(x: number, tick: Cents, direction: "down" | "up"): Cents {
  if (!Number.isFinite(x)) throw new RangeError(`toTick needs a finite price, got ${x}`);
  if (!Number.isSafeInteger(tick) || tick <= 0) throw new RangeError(`tick must be a positive integer number of cents, got ${tick}`);
  // Its own guard, even though the book rejects such ticks too: otherwise the clamp below would
  // return 0, which is not a valid price.
  if (tick > MAX_PRICE_CENTS) throw new RangeError(`tick ${tick} is larger than the maximum price ${MAX_PRICE_CENTS}`);
  if (direction !== "down" && direction !== "up") throw new RangeError(`direction must be "down" or "up", got ${String(direction)}`);
  const steps = direction === "down" ? Math.floor(x / tick) : Math.ceil(x / tick);
  return Math.min(Math.max(steps, 1) * tick, highestPrice(tick));
}

/** The highest price on the `tick` grid that the book accepts: the largest multiple of `tick` ≤ MAX_PRICE_CENTS. */
export function highestPrice(tick: Cents): Cents {
  return Math.floor(MAX_PRICE_CENTS / tick) * tick;
}
