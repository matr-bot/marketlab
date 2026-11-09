"use client";

import { useEffect, useState } from "react";

/**
 * Marks a scroll area whose content continues past what is visible, below (`data-below`) or above
 * (`data-above`), so CSS fades that edge's line out instead of cutting it in half (QA #6). A mark goes
 * when that end is reached or everything fits. Re-checked on scroll, on resize and on content changes.
 *
 * Returns a ref setter (it attaches whenever the element mounts: EXR's table appears only after the
 * first fill) and the element, for a component that needs it itself.
 */
export function useOverflowFade<T extends HTMLElement>(): { ref: (el: T | null) => void; el: T | null } {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (el === null) return;
    const check = () => {
      el.toggleAttribute("data-below", el.scrollTop + el.clientHeight < el.scrollHeight - 1);
      el.toggleAttribute("data-above", el.scrollTop > 1);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const resize = new ResizeObserver(check);
    resize.observe(el);
    // Attribute changes are not observed, so setting the marks never triggers another check.
    const content = new MutationObserver(check);
    content.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", check);
      resize.disconnect();
      content.disconnect();
    };
  }, [el]);
  return { ref: setEl, el };
}
