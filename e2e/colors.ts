import { TOKENS, type Token } from "../src/components/terminal/tokens";

/**
 * A token as the browser reports it in getComputedStyle (D-094): `#4FA36F` → `rgb(79, 163, 111)`, and
 * `rgba(…)` tokens as written. The e2e checks compare against the tokens, so a palette change cannot
 * leave them asserting old colors.
 */
export function computed(token: Token): string {
  const v: string = TOKENS[token];
  const hex = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (hex === null) return v;
  const n = parseInt(hex[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
