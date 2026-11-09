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

/** What offline mode can do, said the same way everywhere (QA #4). */
export const OFFLINE_RULE = "offline, only clear events work (a rate hike, fraud, a beat, a miss, a downgrade), or type FED, CEO, BEAT or DOWNGRADE on its own.";
export const OFFLINE_HELP = `AI unavailable · ${OFFLINE_RULE}`;

/** The preset a headline clearly matches, or null. */
export function offlineMatch(headline: string): string | null {
  return offlineMatchWords(headline)?.code ?? null;
}

/** The preset a headline clearly matches and the words that matched it, or null. It matches events, never names: "CEO tweets" is not fraud. */
export function offlineMatchWords(headline: string): { code: string; words: string } | null {
  for (const r of RULES) {
    const m = r.pattern.exec(headline);
    if (m !== null) return { code: presetByCode(r.code)!.code, words: m[0].trim().slice(0, 40) };
  }
  return null;
}

/**
 * The offline answer to a headline, with a message that says why: which words matched which preset,
 * or what offline mode can do. Used by the route and by the page when the route is unreachable.
 */
export function offlineFallback(headline: string, prefix = "AI unavailable"): { code: string | null; message: string } {
  const m = offlineMatchWords(headline);
  if (m === null) return { code: null, message: `${prefix} · ${OFFLINE_RULE}` };
  return { code: m.code, message: `${prefix} · “${m.words}” matched the offline preset ${m.code}.` };
}
