"use client";

import { useEffect, useRef } from "react";
import { TOKENS } from "./tokens";

/** How long a tick flash shows (D-078). It is the only animation in the app. */
export const FLASH_MS = 150;

/** Flash `el`'s background up (green) or down (red) for FLASH_MS, then nothing: no fade, no slide. */
export function flash(el: Element, direction: "up" | "down") {
  if (typeof (el as HTMLElement).animate !== "function") return;
  const backgroundColor = direction === "up" ? TOKENS.upFlash : TOKENS.downFlash;
  (el as HTMLElement).animate([{ backgroundColor }, { backgroundColor }], { duration: FLASH_MS, easing: "steps(1, end)" });
}

/**
 * The tick flash for a price (CLAUDE.md, "Numbers must move like a real market"; D-078): when `value`
 * changes, its background flashes green if it went up, red if down, for 150ms. The new number shows at
 * once; only the background changes.
 */
export function useFlash<T extends HTMLElement>(value: number | null) {
  const ref = useRef<T>(null);
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    const el = ref.current;
    if (el === null || before === null || value === null || before === value) return;
    flash(el, value > before ? "up" : "down");
  }, [value]);
  return ref;
}
