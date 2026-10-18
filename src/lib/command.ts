import { PRESETS, presetByCode } from "@/engine/presets";

// The command bar (CLAUDE.md, Command bar). Known codes first: the offline headlines (D-048); any
// other text is a NEWS headline for /api/interpret (D-052). Friendly errors, never crashes.

export type Command =
  | { readonly kind: "empty" }
  | { readonly kind: "shock"; readonly code: string; readonly headline: string }
  | { readonly kind: "news"; readonly headline: string }
  | { readonly kind: "error"; readonly message: string };

const CODES = PRESETS.map((p) => p.code).join(", ");
/** Longest accepted command (D-051). */
export const MAX_COMMAND_LENGTH = 200;

/** `FED`, `fed`, `SHOCK FED` or `MLAB FED` → that preset; any other text → a NEWS headline. */
export function parseCommand(input: string): Command {
  if (input.length > MAX_COMMAND_LENGTH) return { kind: "error", message: `Commands are at most ${MAX_COMMAND_LENGTH} characters.` };
  const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { kind: "empty" };
  const rest = words[0].toUpperCase() === "SHOCK" || words[0].toUpperCase() === "MLAB" ? words.slice(1) : words;
  if (rest.length === 1) {
    const preset = presetByCode(rest[0]);
    if (preset) return { kind: "shock", code: preset.code, headline: preset.headline };
  }
  if (rest.length === 0) return { kind: "error", message: `Type a headline after SHOCK, or one of ${CODES}.` };
  return { kind: "news", headline: input.trim().replace(/\s+/g, " ") };
}
