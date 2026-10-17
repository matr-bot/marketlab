"use client";

import { useEffect, useRef } from "react";
import { COLORS } from "./theme";

const FLASH_MS = 450;

/**
 * Flash an element when `value` changes (CLAUDE.md, "Numbers must move like a real market"):
 * - "price": green if it went up, red if down, then back to white;
 * - "neutral": a brief amber-tinted background for any other number (green/red are price-only).
 * No sliding or counting: the new number is shown at once, only its color changes.
 */
export function useFlash<T extends HTMLElement>(value: number | null, mode: "price" | "neutral") {
  const ref = useRef<T>(null);
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    const el = ref.current;
    if (el === null || before === null || value === null || before === value || typeof el.animate !== "function") return;
    if (mode === "price") {
      const color = value > before ? COLORS.up : COLORS.down;
      el.animate([{ color }, { color, offset: 0.4 }, { color: COLORS.white }], { duration: FLASH_MS, easing: "steps(1, end)" });
    } else {
      el.animate([{ backgroundColor: COLORS.highlight }, { backgroundColor: "transparent" }], { duration: FLASH_MS, easing: "steps(1, end)" });
    }
  }, [value, mode]);
  return ref;
}
