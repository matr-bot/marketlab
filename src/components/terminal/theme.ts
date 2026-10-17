// Terminal colors (CLAUDE.md, Design System). Kept in sync with the CSS variables in globals.css;
// the canvas chart and the flash animations need them as values.
export const COLORS = {
  bg: "#000000",
  amber: "#ffa028",
  white: "#f0f0f0",
  dim: "#8a8a8a",
  grid: "#1c1c1c",
  border: "#3a3a3a",
  /** Green and red mean price direction only. */
  up: "#1fd660",
  down: "#ff4040",
  /** Brief neutral highlight for changing non-price numbers. */
  highlight: "#4a3410",
} as const;
