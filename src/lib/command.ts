import { PRESETS, presetByCode } from "@/engine/presets";

// The command bar (CLAUDE.md, Command bar). Today it knows the offline headlines (D-048); Tuesday,
// any other text goes to the AI route as a headline. Friendly errors, never crashes.

export type Command =
  | { readonly kind: "empty" }
  | { readonly kind: "shock"; readonly code: string; readonly headline: string }
  | { readonly kind: "error"; readonly message: string };

const CODES = PRESETS.map((p) => p.code).join(", ");

/** `FED`, `fed`, `SHOCK FED` or `MLAB FED` → that preset; anything else → a friendly error. */
export function parseCommand(input: string): Command {
  const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { kind: "empty" };
  const rest = words[0].toUpperCase() === "SHOCK" || words[0].toUpperCase() === "MLAB" ? words.slice(1) : words;
  if (rest.length === 1) {
    const preset = presetByCode(rest[0]);
    if (preset) return { kind: "shock", code: preset.code, headline: preset.headline };
  }
  return { kind: "error", message: `Unknown command "${input.trim()}". Headlines available offline: ${CODES}.` };
}
