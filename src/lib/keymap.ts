/**
 * The keymap (D-080). Single letters cannot be global: typing anywhere goes to the command bar, and
 * BUY, SELL, SEED… start with them. So there are three scopes: global keys that never type (Space and
 * F-keys, not while typing in a field), the ticket's letters (only with focus inside TKT, where B, S,
 * M and L are not valid in QTY or PX), and the strategy preview. HELP lists this table.
 */
export type GlobalAction = "pause" | "help" | "session" | "drawer" | "backtest";
export type TicketAction = "buy" | "sell" | "market" | "limit";
export type Workspace = "TRADE" | "STRATEGY";

export const KEYMAP: ReadonlyArray<{ readonly keys: string; readonly action: string; readonly scope: "ANYWHERE" | "TKT" | "STRAT" | "GP" }> = [
  { keys: "any letter", action: "Type a command or a headline in the command bar", scope: "ANYWHERE" },
  { keys: "↵", action: "Run the command; on an empty bar, apply the headline preview or start the strategy preview", scope: "ANYWHERE" },
  { keys: "␣", action: "PAUSE / RUN", scope: "ANYWHERE" },
  { keys: "F1", action: "HELP", scope: "ANYWHERE" },
  { keys: "F2", action: "SESSION: scenario, seed, mode, link", scope: "ANYWHERE" },
  { keys: "F3", action: "Open or close the drawer (STRATEGY, DESK, NEWS)", scope: "ANYWHERE" },
  { keys: "F4", action: "BACKTEST: the glass box of the running strategy", scope: "ANYWHERE" },
  { keys: "⌥1 · ⌥2", action: "TRADE · STRATEGY workspace", scope: "ANYWHERE" },
  { keys: "Esc", action: "Close a dialog, clear the command bar, or go back to the live WHO window", scope: "ANYWHERE" },
  { keys: "↑ ↓", action: "Earlier commands, in the command bar", scope: "ANYWHERE" },
  { keys: "B · S", action: "BUY · SELL", scope: "TKT" },
  { keys: "M · L", action: "Market · limit order", scope: "TKT" },
  { keys: "↵", action: "SEND the order", scope: "TKT" },
  { keys: "↵ · Tab · Esc", action: "START · edit a field · cancel the preview", scope: "STRAT" },
  { keys: "click · double-click", action: "Pick a candle for WHO · zoom the price axis to the last two minutes", scope: "GP" },
];

/** True when the key would type into a field: those keys belong to the field, not to the terminal. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true);
}

/** The global action for a key press, or null. Space and the F-keys only; never while typing in a field. */
export function globalAction(key: string, target: EventTarget | null, mods: { ctrl: boolean; meta: boolean; alt: boolean }): GlobalAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (key === " ") return isTyping(target) ? null : "pause";
  const fkeys: Record<string, GlobalAction> = { F1: "help", F2: "session", F3: "drawer", F4: "backtest" };
  return fkeys[key] ?? null;
}

/**
 * A workspace key (D-086): Alt/Option + 1 or 2, by the physical key (`code`), so a Mac's Option+1 (which
 * types "¡") still works. Works even while typing, as it types nothing a command needs.
 */
export function workspaceKey(code: string, mods: { ctrl: boolean; meta: boolean; alt: boolean }): Workspace | null {
  if (!mods.alt || mods.ctrl || mods.meta) return null;
  return code === "Digit1" ? "TRADE" : code === "Digit2" ? "STRATEGY" : null;
}

/** A ticket letter (with focus inside TKT): B, S, M, L, either case. */
export function ticketAction(key: string, mods: { ctrl: boolean; meta: boolean; alt: boolean }): TicketAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  const map: Record<string, TicketAction> = { b: "buy", s: "sell", m: "market", l: "limit" };
  return map[key.toLowerCase()] ?? null;
}
