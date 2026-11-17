import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABBREV, LONG_FORMS } from "./abbrev";

// D-072: labels use the dictionary's spelling of each term. This scans every label literal in the
// terminal UI: table headers, <dt> terms, `styles.label` spans, BOOK's header and field labels
// (`label: "…"` in the field menus; Terminal.tsx's `label:` values are screen-reader descriptions,
// not labels, so that file's `label:` values are skipped).

const DIR = join(__dirname, "..", "components");
const FILES = [...readdirSync(join(DIR, "terminal")).map((f) => join(DIR, "terminal", f)), join(DIR, "Panel.tsx")].filter((f) => f.endsWith(".tsx"));

function labels(): Array<{ file: string; text: string }> {
  return FILES.flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const found = [
      ...[...src.matchAll(/<th[^>]*>([^<{]+)<\/th>/g)].map((m) => m[1]),
      ...[...src.matchAll(/<dt>([^<{]+)<\/dt>/g)].map((m) => m[1]),
      ...[...src.matchAll(/styles\.label\}>([^<{]+)</g)].map((m) => m[1]),
      ...(file.endsWith("Terminal.tsx") ? [] : [...src.matchAll(/\blabel: "([^"]+)"/g)].map((m) => m[1])),
    ];
    return found.map((text) => ({ file: file.slice(DIR.length + 1), text: text.replace(/&amp;/g, "&").trim() }));
  });
}

describe("abbreviation dictionary (D-072)", () => {
  it("finds the labels it checks", () => {
    const texts = labels().map((l) => l.text);
    expect(texts.length).toBeGreaterThan(30);
    for (const t of ["QTY", "PX", "AVG", "P&L", "B/S", "SLIP BPS"]) expect(texts).toContain(t);
  });

  it("explains every term, and every long form points at a term", () => {
    for (const [term, meaning] of Object.entries(ABBREV)) expect(meaning.length, term).toBeGreaterThan(10);
    for (const term of Object.values(LONG_FORMS)) expect(ABBREV).toHaveProperty([term]);
  });

  it("never uses a long form or variant of a dictionary term in a label", () => {
    const misuse = labels().flatMap(({ file, text }) => {
      const upper = ` ${text.toUpperCase().replace(/[·()]/g, " ")} `;
      return Object.entries(LONG_FORMS)
        .filter(([long]) => upper.includes(` ${long} `))
        .map(([long, term]) => `${file}: "${text}" uses ${long}; use ${term}`);
    });
    expect(misuse).toEqual([]);
  });
});
