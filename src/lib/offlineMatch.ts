import { presetByCode } from "@/engine/presets";

// Offline fallback (D-052): when the AI is unavailable, a headline maps to a preset only on a clear
// keyword match; anything else has no effect. Negative earnings words are checked before positive
// ones, so "earnings miss" or "beats but cuts guidance" never becomes BEAT.

const RULES: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "CEO", pattern: /\b(fraud|arrest(ed|s)?|indict(ed|ment|s)?|charged|probe|scandal|bankrupt(cy)?|embezzl\w*)\b/i },
  { code: "FED", pattern: /\b(fed|federal reserve|central bank|fomc)\b.*\b(hike[sd]?|raise[sd]?|raising|tighten\w*)\b|\brate hikes?\b/i },
  { code: "DOWNGRADE", pattern: /\b(miss(es|ed)?|cuts? guidance|cut(s|ting)? (its |full-year )?(outlook|forecast|guidance)|lower(s|ed)? (guidance|outlook|forecast)|warns?|profit warning|downgrade[sd]?|slump\w*|plunge[sd]?)\b/i },
  { code: "BEAT", pattern: /\b(beat(s)?|crush(es|ed)?|tops? (estimates|expectations)|record (profit|revenue|earnings)|upgrade[sd]?|raise[sd]? (its |full-year )?(guidance|outlook|forecast))\b/i },
];

export const OFFLINE_HELP = "AI unavailable · try FED, CEO, BEAT or DOWNGRADE.";

/** The preset a headline clearly matches, or null. */
export function offlineMatch(headline: string): string | null {
  for (const r of RULES) if (r.pattern.test(headline)) return presetByCode(r.code)!.code;
  return null;
}
