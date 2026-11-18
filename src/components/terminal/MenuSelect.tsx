"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./terminal.module.css";

/**
 * A token-styled replacement for a native <select> (D-088): a mono button with the value and ▾, and a
 * square list under it. Keyboard: ↑ ↓ change the value while closed (as a select does); ↵ or Space opens
 * the list; in the list ↑ ↓ move, ↵ picks, Esc closes (without cancelling what it sits in). A click
 * outside closes it. ARIA: a button with a listbox popup.
 */
export function MenuSelect<T extends string>({ value, options, onChange, field, label }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (v: T) => void; field: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const step = (from: number, d: 1 | -1) => (from + d + options.length) % options.length;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      if (open) setHi((h) => step(h, d));
      else onChange(options[step(index, d)].value);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation(); // ↵ here opens or picks; it does not START the strategy
      if (open) {
        onChange(options[hi].value);
        setOpen(false);
      } else {
        setHi(index);
        setOpen(true);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // closes the list only, not the preview
      setOpen(false);
    }
  };

  return (
    <span ref={box} className={styles.menuSelect}>
      <button
        type="button"
        className={styles.menuButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-field={field}
        data-value={value}
        onClick={() => {
          setHi(index);
          setOpen((o) => !o);
        }}
        onKeyDown={onKey}
      >
        {options[index]?.label ?? value}
        <span className={styles.keyHint} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.menuList} role="listbox" aria-label={label} data-testid={`menu-${field}`}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-value={o.value}
              className={`${i === hi ? styles.menuHi : ""} ${o.value === value ? styles.menuOn : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
