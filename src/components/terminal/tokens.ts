/**
 * The design tokens (D-068, design v2 from D-094). Every color, font and type size in the app comes from
 * this file: `layout.tsx` turns it into CSS custom properties on <html> (`cssVariables`), CSS modules
 * use only `var(--…)`, and the canvas chart and the flash hook import the values. `tokens.test.ts`
 * fails on a color literal, a font family or a font size written anywhere else.
 *
 * Two surfaces share one system: the terminal (dark, warm grays, D-094) and the landing page (paper and
 * ink, the `paper…` / `ink…` tokens). Spacing is a 4px scale and every radius is 0 (`geometry.test.ts`).
 *
 * Rules:
 * - `up` / `down`: price direction (candles, last-price flash, change, TAPE price by tick), plus the
 *   two BOOK sides as muted tints and the TKT BUY/SELL toggle when selected. Nothing else.
 * - `accent` (amber): ONLY the ticket's SEND button and the active panel's marker. `tokens.test.ts`
 *   pins the selectors allowed to use it. The landing page has no accent: its primary action is ink.
 * - `alert`: the PAUSED badge. Deliberately not `down`, so it never reads as a falling price.
 */
export const TOKENS = {
  /** The gutter between panels, and the page behind them. */
  bg: "#0C0B0A",
  /** A panel's surface. */
  panelBg: "#141311",
  /** One step up from a panel: popovers, hover, the selected chip. */
  raised: "#1D1B19",
  /** Hairlines, only where a rule aids scanning (table rows, the drawer's top edge). */
  border: "#2A2724",
  /** All numbers and data: a warm white. */
  data: "#E8E6E1",
  /** Column headers, units, panel titles, secondary text (5.3:1 on a panel). */
  label: "#8D8982",
  /** Disabled controls only (not text that must be read). */
  disabled: "#5C5954",
  up: "#4FA36F",
  down: "#D2605A",
  /** BOOK depth bars: the side's color, muted. */
  upTint: "rgba(79, 163, 111, 0.16)",
  downTint: "rgba(210, 96, 90, 0.16)",
  accent: "#E8A33D",
  alert: "#A8322C",
  alertFg: "#FFFFFF",
  /** Chart gridlines. */
  grid: "#1D1B19",
  /** The tick flash (D-078): the background behind a price or a book level that just moved up or down. */
  upFlash: "rgba(79, 163, 111, 0.45)",
  downFlash: "rgba(210, 96, 90, 0.45)",
  /** The BOOK level flash: a 25% tint, not a solid row (D-089). */
  upFlashSoft: "rgba(79, 163, 111, 0.25)",
  downFlashSoft: "rgba(210, 96, 90, 0.25)",
  /** Horizontal percentage bars (WHO). */
  bar: "rgba(141, 137, 130, 0.22)",
  selection: "#3A3733",
  /** Behind a dialog. */
  scrim: "rgba(12, 11, 10, 0.75)",
  /** The landing page (D-094): warm paper, ink text, rules, and price direction readable on paper. */
  paper: "#F4F0E8",
  ink: "#1C1A17",
  /** Secondary ink: captions, labels, the footer (6.1:1 on paper). */
  inkSecondary: "#5E5A53",
  rule: "#D8D2C6",
  paperUp: "#2E7D4F",
  paperDown: "#B23A32",
} as const;

export type Token = keyof typeof TOKENS;

/**
 * The type scale (D-070, D-094): few sizes, big jumps. Terminal: labels 11, data 13, the last price 22.
 * Landing: body 15, the standfirst and proof figures 22, the headline 56 (36 at phone width).
 * Emitted as `--fs-label` etc.
 */
export const TYPE = {
  fsLabel: "11px",
  fsData: "13px",
  fsBody: "15px",
  fsHero: "22px",
  fsDisplayMobile: "36px",
  fsDisplay: "56px",
} as const;

/**
 * One face per job (D-094), self-hosted by next/font (`layout.tsx` sets the `--font-plex-…` and
 * `--font-newsreader` variables). Display: headlines on the landing page only. Interface: labels and
 * buttons. Data: numbers only, with tabular figures and a slashed zero. Emitted as `--font-display` etc.
 */
export const FONTS = {
  fontDisplay: 'var(--font-newsreader), "Iowan Old Style", Georgia, serif',
  fontSans: 'var(--font-plex-sans), "Helvetica Neue", Arial, sans-serif',
  fontMono: 'var(--font-plex-mono), ui-monospace, "SFMono-Regular", Menlo, monospace',
} as const;

/**
 * Button tiers (D-069). Primary: the accent fill, one per screen (TKT SEND). Secondary: outlined, for
 * every other action that matters (STRAT START, BACKTEST, the launcher's secondary actions). There is
 * no filled white button. `terminal.module.css` `.secondary` implements this exactly; `tokens.test.ts`
 * compares the two.
 */
export const SECONDARY_BUTTON = {
  background: "transparent",
  border: "1px solid var(--data)",
  color: "var(--data)",
  "border-radius": "0",
  hover: { background: "var(--raised)" },
} as const;

type Name = Token | keyof typeof TYPE | keyof typeof FONTS;

/** camelCase token → CSS custom property name: `panelBg` → `--panel-bg`. */
export function cssVar(token: Name): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Every token as a CSS custom property, for the `style` of <html>. */
export function cssVariables(): Record<string, string> {
  const all: Record<string, string> = { ...TOKENS, ...TYPE, ...FONTS };
  return Object.fromEntries(Object.entries(all).map(([t, v]) => [cssVar(t as Name), v]));
}
