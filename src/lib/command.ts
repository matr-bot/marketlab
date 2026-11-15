import { PRESETS, presetByCode } from "@/engine/presets";
import { parseSeed, SCENARIOS, scenarioById } from "@/engine/scenarios";
import { MAX_USER_ORDER_QTY, type UserOrder } from "@/engine/simulation";
import { INDICATORS, type Indicator } from "@/engine/economicReleases";

// The command bar (CLAUDE.md, Command bar). Keyboard first: every action in the terminal is a
// command, and the buttons on the page just run the same ones. Known codes and commands are matched
// first; any other text is a NEWS headline for /api/interpret (D-052). A command word only counts
// when what follows has that command's shape ("BUY 500", not "Buy now, pay later lender collapses"),
// and numbers after a command word always mean a command, so a mistyped order is a friendly error,
// never a headline. Parsing is pure and never throws.

export type Command =
  | { readonly kind: "empty" }
  /** A preset headline: FED, CEO, BEAT, DOWNGRADE (D-048). */
  | { readonly kind: "shock"; readonly code: string; readonly headline: string }
  /** Hypothetical economic release; null means the catalog's authored actual. */
  | { readonly kind: "release"; readonly indicator: Indicator; readonly actual: number | null }
  /** Any other text: a headline for the AI to interpret (D-052). */
  | { readonly kind: "news"; readonly headline: string }
  /** The student's own headline: fair-value change as a fraction (−0.03 = −3%), panic sensitivity, duration in seconds. */
  | { readonly kind: "customShock"; readonly fairValuePct: number; readonly panicSensitivity: number; readonly durationSec: number }
  | { readonly kind: "order"; readonly order: UserOrder }
  | { readonly kind: "cancelOrders" }
  | { readonly kind: "pause" }
  | { readonly kind: "run" }
  | { readonly kind: "speed"; readonly speed: number }
  /** Open a scenario by id, or (id null) list them. */
  | { readonly kind: "scenario"; readonly id: string | null }
  | { readonly kind: "seed"; readonly seed: number }
  | { readonly kind: "rerun" }
  | { readonly kind: "link" }
  | { readonly kind: "help" }
  /** Open a function in the active panel (CLAUDE.md, Command bar; D-066). */
  | { readonly kind: "open"; readonly code: FunctionCode }
  /** A trading idea for the strategy agent: `STRAT buy after a 3% drop` (D-064). */
  | { readonly kind: "strategy"; readonly text: string }
  | { readonly kind: "stopStrategy" }
  | { readonly kind: "error"; readonly message: string };

/** Function codes that open in a panel. HELP is a dialog and has its own command. */
export const FUNCTION_CODES = ["GP", "WHO", "CHAT", "TAPE", "BOOK", "TKT", "STRAT", "NEWS", "EXR"] as const;
export type FunctionCode = (typeof FUNCTION_CODES)[number];

/** Longest accepted command (D-051). */
export const MAX_COMMAND_LENGTH = 200;
/** Speeds the SPEED command accepts, as multiples of real time. */
export const SPEEDS = [1, 2, 4, 8] as const;
/** Defaults for SHOCK <pct> on a fall: how jumpy panic sellers get, and for how long (a rise defaults to no extra panic). */
export const DEFAULT_PANIC_SENSITIVITY = 1.5;
export const DEFAULT_SHOCK_SECONDS = 300;

const CODES = PRESETS.map((p) => p.code).join(", ");
const SHOCK_USAGE = `SHOCK needs a headline code (${CODES}) or a fair-value change in percent, e.g. SHOCK -3 (optionally then panic sensitivity and seconds: SHOCK -3 2 120).`;
const ORDER_USAGE = "Orders look like BUY 500, SELL 5K, or BUY 500 @ 187.25 for a limit order.";

/** Command reference for HELP: [what you type, what it does]. */
export const HELP_LINES: readonly (readonly [string, string])[] = [
  ["GP · BOOK · TAPE · TKT · EXR · STRAT · NEWS · WHO · CHAT", "Open that function in the active panel (click a panel's header to make it active; panel 7 by default)."],
  ["STRAT buy after a 3% drop", "Describe a strategy in plain English. Check its rules, then Enter starts it trading. STOP stops it."],
  ["FED · CEO · BEAT · DOWNGRADE", "Send a ready-made headline. The crowd reacts; fair value jumps and panic sellers may cascade."],
  ["CPI 3.4 · JOBS 150K · GDP 2.3 · RATES +0.75", "Hypothetical MLAB releases. A code alone uses an authored example; an optional number sets the actual. JOBS 150 and 150K mean the same thing. FED is the default RATES release."],
  ["Any other text", "A headline in your own words. The AI turns it into parameters you check and edit before they apply. If the AI is unavailable, only a clear event (a rate hike, fraud, a beat, a miss, a downgrade) maps to an offline preset, and the reply says which words matched; anything else has no effect."],
  ["SHOCK -3", "Your own shock: fair value falls 3%, with panic sellers 1.5× as jumpy for 300 s (a rise adds no panic). Set both: SHOCK -3 2 120. Values past the limits (±20%) are capped, and the reply says so."],
  ["BUY 500 · SELL 500", "A market order: trades at once against the book at the best prices, then the next, until filled."],
  ["BUY 500 @ 187.25", "A limit order: trades only at that price or better; otherwise it rests in the book and waits."],
  ["CANCEL", "Cancel all your resting limit orders."],
  ["PAUSE · RUN · SPEED 4", "Stop and start the market, or run it 1, 2, 4 or 8 times faster. Same seed, same market, whatever the speed."],
  ["SCN · SCN rate-shock", "List the scenarios, or open one. Each is a market situation with a brief and a task."],
  ["LINK", "Copy a link that reopens this exact scenario and seed, to assign it or share it."],
  ["SEED 42 · RERUN", "Run again with another seed, or the same seed from the start, to ask: what if I had done it differently?"],
];

const PERCENT = /^[+-]?\d+(\.\d+)?%?$/;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
/** A word that starts like a number ("500", "-3", "$187", "--3"): after a command word, it means a command. */
const NUMBERISH = /^[-+$.]*\d/;

function parseRelease(indicator: Indicator, args: readonly string[]): Command {
  const example = indicator === "JOBS" ? "JOBS 150K" : indicator === "RATES" ? "RATES +0.75" : indicator === "GDP" ? "GDP 2.3" : "CPI 3.4";
  if (args.length === 0) return { kind: "release", indicator, actual: null };
  const token = args[0];
  const valid = indicator === "JOBS" ? /^[+-]?\d+[kK]?$/.test(token) : /^[+-]?\d+(?:\.\d{1,2})?%?$/.test(token);
  if (args.length !== 1 || !valid) return { kind: "error", message: `${indicator} needs one actual value, e.g. ${example}.` };
  const actual = Number(token.replace(/[kK%]$/, ""));
  if (!Number.isFinite(actual) || Math.abs(actual) > (indicator === "JOBS" ? 10_000 : 100)) return { kind: "error", message: `${indicator} needs one actual value, e.g. ${example}.` };
  return { kind: "release", indicator, actual };
}

/** "-3", "-3%", "+2.5%" → −0.03 etc. as a fraction; null if not a number. */
function parsePercent(text: string): number | null {
  return PERCENT.test(text) ? Number(text.replace("%", "")) / 100 : null;
}

/** "500", "1,000", "5K", "1.5k" → whole shares; null if not a whole number of shares. */
function parseQty(text: string): number | null {
  if (!/^\d[\d,]*(\.\d+)?[kK]?$/.test(text)) return null;
  const thousands = /k$/i.test(text);
  const n = Number(text.replace(/,/g, "").replace(/k$/i, "")) * (thousands ? 1_000 : 1);
  const whole = Math.round(n);
  return Math.abs(n - whole) < 1e-6 ? whole : null;
}

/** "187.25", "$187.5", "187" → integer cents, exactly (no floating point); null if not a price with at most 2 decimals. */
function parsePriceCents(text: string): number | null {
  const m = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (m === null) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function parseOrder(side: "buy" | "sell", args: readonly string[]): Command {
  if (args.length === 0) return { kind: "error", message: ORDER_USAGE };
  const qty = parseQty(args[0]);
  if (qty === null) return { kind: "error", message: `"${args[0].slice(0, 20)}" is not a number of shares. ${ORDER_USAGE}` };
  if (qty < 1 || qty > MAX_USER_ORDER_QTY) return { kind: "error", message: `One order can be 1 to ${MAX_USER_ORDER_QTY.toLocaleString("en-US")} shares.` };
  if (args.length === 1) return { kind: "order", order: { type: "market", side, qty } };
  if (args.length === 3 && (args[1] === "@" || args[1].toUpperCase() === "AT")) {
    const price = parsePriceCents(args[2]);
    if (price === null) return { kind: "error", message: `"${args[2].slice(0, 20)}" is not a price. Use dollars with at most 2 decimals, e.g. BUY 500 @ 187.25.` };
    return { kind: "order", order: { type: "limit", side, qty, price } };
  }
  return { kind: "error", message: ORDER_USAGE };
}

function parseShock(args: readonly string[]): Command {
  if (args.length === 1) {
    const preset = presetByCode(args[0]);
    if (preset) return { kind: "shock", code: preset.code, headline: preset.headline };
  }
  const pct = args.length >= 1 && args.length <= 3 ? parsePercent(args[0]) : null;
  if (pct === null) return { kind: "error", message: SHOCK_USAGE };
  // Panic is a reaction to bad news: a positive shock adds none unless asked for (QA #9).
  const panic = args.length >= 2 ? (PLAIN_NUMBER.test(args[1]) ? Number(args[1]) : null) : pct > 0 ? 1 : DEFAULT_PANIC_SENSITIVITY;
  const seconds = args.length >= 3 ? (PLAIN_NUMBER.test(args[2]) ? Number(args[2]) : null) : DEFAULT_SHOCK_SECONDS;
  if (panic === null || seconds === null) return { kind: "error", message: SHOCK_USAGE };
  return { kind: "customShock", fairValuePct: pct, panicSensitivity: panic, durationSec: seconds };
}

/** Parse what was typed into the command bar. Case-insensitive; an optional leading `MLAB` is ignored. */
export function parseCommand(input: string): Command {
  if (input.length > MAX_COMMAND_LENGTH) return { kind: "error", message: `Commands are at most ${MAX_COMMAND_LENGTH} characters.` };
  const all = input.trim().replace(/@/g, " @ ").split(/\s+/).filter((w) => w.length > 0);
  if (all.length === 0) return { kind: "empty" };
  if (all.length === 1 && all[0].toUpperCase() === "MLAB") return { kind: "error", message: "Type a code or a headline after MLAB, e.g. MLAB FED. Type HELP for the list of commands." };
  const words = all[0].toUpperCase() === "MLAB" ? all.slice(1) : all;
  const verb = words[0].toUpperCase();
  const args = words.slice(1);
  const news: Command = { kind: "news", headline: input.trim().replace(/\s+/g, " ") };
  const unknown: Command = { kind: "error", message: `Unknown command "${input.trim()}". Type HELP for the list of commands.` };
  const numeric = args.length > 0 && NUMBERISH.test(args[0]);
  /** A one-word command: alone it runs; followed by a number it is a mistake; followed by words it is a headline. */
  const bare = (c: Command): Command => (args.length === 0 ? c : numeric ? unknown : news);

  const preset = words.length === 1 ? presetByCode(verb) : undefined;
  if (preset) return { kind: "shock", code: preset.code, headline: preset.headline };
  if ((INDICATORS as readonly string[]).includes(verb)) {
    if (args.length > 1 && !numeric) return news;
    return parseRelease(verb as Indicator, args);
  }
  // A function code alone opens it; followed by words it is a headline (D-061), except STRAT and NEWS below.
  if (args.length === 0 && (FUNCTION_CODES as readonly string[]).includes(verb)) return { kind: "open", code: verb as FunctionCode };
  // STRAT is not an English word: whatever follows is the strategy. NEWS <headline> is a headline
  // without the prefix. Both keep the text as typed (spacing tidied).
  const after = (code: string) => input.trim().replace(new RegExp(`^(mlab\\s+)?${code}\\s+`, "i"), "").replace(/\s+/g, " ");
  if (verb === "STRAT") return { kind: "strategy", text: after("strat") };
  if (verb === "NEWS") return { kind: "news", headline: after("news") };

  switch (verb) {
    case "SHOCK":
      if (args.length === 0) return { kind: "error", message: `Type a headline after SHOCK, or one of ${CODES}.` };
      if (args.length === 1 && presetByCode(args[0])) return parseShock(args);
      return numeric ? parseShock(args) : news;
    case "BUY":
    case "SELL":
      return args.length === 0 || numeric ? parseOrder(verb === "BUY" ? "buy" : "sell", args) : news;
    case "CANCEL":
      return args.length === 1 && args[0].toUpperCase() === "ALL" ? { kind: "cancelOrders" } : bare({ kind: "cancelOrders" });
    case "PAUSE":
      return bare({ kind: "pause" });
    case "RUN":
    case "PLAY":
    case "RESUME":
      return bare({ kind: "run" });
    case "SPEED": {
      if (args.length > 0 && !numeric) return news;
      const n = args.length === 1 && /^\d+$/.test(args[0]) ? Number(args[0]) : null;
      return n !== null && (SPEEDS as readonly number[]).includes(n) ? { kind: "speed", speed: n } : { kind: "error", message: `SPEED takes ${SPEEDS.join(", ")} (times real time), e.g. SPEED 4.` };
    }
    case "SCN":
    case "SCENARIO":
    case "SCENARIOS": {
      if (args.length === 0) return { kind: "scenario", id: null };
      // SCN is not an English word, so it is always a command; "Scenario …" with several words is a headline.
      if (verb !== "SCN" && args.length > 1) return news;
      const s = args.length === 1 ? scenarioById(args[0]) : undefined;
      return s ? { kind: "scenario", id: s.id } : { kind: "error", message: `Unknown scenario "${args.join(" ").slice(0, 30)}". Scenarios: ${SCENARIOS.map((x) => x.id).join(", ")}.` };
    }
    case "SEED": {
      if (args.length > 0 && !numeric) return news;
      const seed = args.length === 1 ? parseSeed(args[0]) : undefined;
      return seed === undefined ? { kind: "error", message: "SEED takes a whole number from 0 to 2147483647, e.g. SEED 42." } : { kind: "seed", seed };
    }
    case "RERUN":
    case "RESTART":
      return bare({ kind: "rerun" });
    case "LINK":
      return bare({ kind: "link" });
    case "HELP":
    case "?":
      return bare({ kind: "help" });
    case "STOP":
      return bare({ kind: "stopStrategy" });
    default:
      return news;
  }
}
