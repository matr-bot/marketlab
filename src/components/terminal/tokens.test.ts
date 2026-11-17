import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVar, cssVariables, TOKENS, type Token } from "./tokens";

// D-068: every color comes from tokens.ts, and amber (`accent`) appears only in the allowed places.

const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "components"].map((d) => join(ROOT, d));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const UI = DIRS.flatMap(files);
const rel = (p: string) => relative(ROOT, p);
const TOKEN_FILE = "components/terminal/tokens.ts";

/** Rule blocks of a stylesheet as [selector, body]; innermost blocks, so rules inside @media count too. */
function rules(css: string): Array<[string, string]> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

/** The only selectors that may use the accent: the active panel, the command-line cursor, the primary action. */
const ACCENT_ALLOWED: Record<string, readonly string[]> = {
  "components/Panel.module.css": [".active"],
  "components/terminal/terminal.module.css": [".commandInput", ".sendBtn"],
};

describe("color tokens (D-068)", () => {
  it("maps every token to a CSS custom property", () => {
    expect(cssVar("panelBg")).toBe("--panel-bg");
    expect(cssVar("upTint")).toBe("--up-tint");
    expect(Object.keys(cssVariables())).toHaveLength(Object.keys(TOKENS).length);
  });

  it("finds the UI files", () => {
    expect(UI.map(rel)).toContain(TOKEN_FILE);
    expect(UI.some((p) => p.endsWith("terminal.module.css"))).toBe(true);
  });

  it("has no color literal outside tokens.ts", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|(?:^|[\s:])(?:white|black|red|green|orange|gold|yellow)\s*[;!]/;
    const offenders = UI.filter((p) => rel(p) !== TOKEN_FILE).flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => ({ line: line.replace(/\/\/.*$|\/\*.*?\*\//g, ""), at: `${rel(p)}:${i + 1}` }))
        .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line) && literal.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("uses only CSS variables that a token (or the font) defines", () => {
    const known = new Set((Object.keys(TOKENS) as Token[]).map(cssVar));
    const unknown = UI.filter((p) => p.endsWith(".css")).flatMap((p) =>
      [...readFileSync(p, "utf8").matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((v) => !known.has(v) && !v.startsWith("--font-")).map((v) => `${rel(p)} ${v}`),
    );
    expect(unknown).toEqual([]);
  });

  it("uses the accent only on the active panel, the command cursor and the primary action", () => {
    const misuse: string[] = [];
    for (const p of UI) {
      const name = rel(p);
      const text = readFileSync(p, "utf8");
      if (p.endsWith(".css")) {
        for (const [selector, body] of rules(text)) {
          if (!body.includes("var(--accent)")) continue;
          const allowed = ACCENT_ALLOWED[name] ?? [];
          // The allowed class itself, optionally with pseudo-classes (`.sendBtn:hover`), nothing nested under it.
          const ok = selector.split(",").every((s) => allowed.some((a) => new RegExp(`^\\${a}(:[a-z-]+)*$`).test(s.trim())));
          if (!ok) misuse.push(`${name} ${selector}`);
        }
      } else if (name !== TOKEN_FILE && /TOKENS\.accent|--accent/.test(text)) {
        misuse.push(name);
      }
    }
    expect(misuse).toEqual([]);
  });
});
