/**
 * The color tokens (D-068). Every color in the app comes from this file: `layout.tsx` turns it into
 * CSS custom properties on <html> (`cssVariables`), CSS modules use only `var(--…)`, and the canvas
 * chart and the flash hook import the values. `tokens.test.ts` fails on a color literal anywhere else.
 *
 * Rules:
 * - `up` / `down`: price direction (candles, last-price flash, change, TAPE price by tick), plus the
 *   two BOOK sides as muted tints and the TKT BUY/SELL toggle when selected. Nothing else.
 * - `accent` (amber): ONLY the active panel's border, the one primary action button on a screen and
 *   the command-line cursor. `tokens.test.ts` pins the selectors allowed to use it.
 * - `alert`: the PAUSED badge. Deliberately not `down`, so it never reads as a falling price.
 */
export const TOKENS = {
  bg: "#000000",
  panelBg: "#0A0A0A",
  border: "#1F1F1F",
  /** All numbers and data. */
  data: "#E6E6E6",
  /** Column headers, units, panel titles, secondary text. */
  label: "#7A7A7A",
  up: "#26A65B",
  down: "#E5484D",
  /** BOOK depth bars: the side's color, muted. */
  upTint: "rgba(38, 166, 91, 0.18)",
  downTint: "rgba(229, 72, 77, 0.18)",
  accent: "#F5A623",
  alert: "#C21F2A",
  alertFg: "#FFFFFF",
  hover: "#141414",
  /** Chart gridlines. */
  grid: "#141414",
  /** The brief neutral highlight for a changing non-price number. */
  flash: "#2E2E2E",
  /** Horizontal percentage bars (WHO). */
  bar: "rgba(122, 122, 122, 0.22)",
  selection: "#3A3A3A",
  /** Behind a dialog. */
  scrim: "rgba(0, 0, 0, 0.75)",
} as const;

export type Token = keyof typeof TOKENS;

/**
 * The type scale (D-070): one monospace font, three sizes. Labels (titles, column headers, units,
 * buttons) 11px gray; data 13px; the last price 22px bold. Emitted as `--fs-label` etc.
 */
export const TYPE = {
  fsLabel: "11px",
  fsData: "13px",
  fsHero: "22px",
} as const;

/**
 * Button tiers (D-069). Primary: the accent fill, one per screen (TKT SEND, START SESSION).
 * Secondary: outlined, for every other action that matters (STRAT START, BACKTEST, the launcher's
 * secondary actions). There is no filled white button. `terminal.module.css` `.secondary` implements
 * this exactly; `tokens.test.ts` compares the two.
 */
export const SECONDARY_BUTTON = {
  background: "transparent",
  border: "1px solid var(--data)",
  color: "var(--data)",
  "border-radius": "0",
  hover: { background: "var(--border)" },
} as const;

/** camelCase token → CSS custom property name: `panelBg` → `--panel-bg`. */
export function cssVar(token: Token | keyof typeof TYPE): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Every token as a CSS custom property, for the `style` of <html>. */
export function cssVariables(): Record<string, string> {
  const all: Record<string, string> = { ...TOKENS, ...TYPE };
  return Object.fromEntries(Object.entries(all).map(([t, v]) => [cssVar(t as Token), v]));
}
