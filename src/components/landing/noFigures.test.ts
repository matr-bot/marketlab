import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// D-085: no stat is typed by hand. The landing page's components show figures only from data (the
// crowd, the build, public/proof.json). Parsed with the TypeScript compiler, so it sees what renders:
// no digit in JSX text, none in a string that can render (a JSX child or a template's literal parts),
// and no number literal as a JSX child. Attributes (tabIndex={0}) and code (slice(0, 10)) are not
// figures on the page.

const FILES = ["Landing.tsx", "Proof.tsx", "HeroReplay.tsx"];

/** Visible figures in a TSX source: [kind, text] for each digit a reader could see. */
function figures(source: string): string[] {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const inChild = (n: ts.Node) => {
    // A JSX child: not inside an attribute.
    for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
      if (ts.isJsxAttribute(p)) return false;
      if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return true;
    }
    return false;
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && /\d/.test(n.text)) found.push(`text: ${n.text.trim()}`);
    if (ts.isJsxExpression(n) && n.expression !== undefined && inChild(n)) {
      const e = n.expression;
      if (ts.isNumericLiteral(e)) found.push(`number: ${e.text}`);
      if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && /\d/.test(e.text)) found.push(`string: ${e.text}`);
    }
    // Template literals that render (in a JSX child): their literal parts.
    if (ts.isTemplateExpression(n) && inChild(n)) {
      const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
      if (parts.some((t) => /\d/.test(t))) found.push(`template: ${parts.join("…")}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("the landing page types no figure (D-085)", () => {
  for (const file of FILES) {
    it(`${file} renders no figure that nothing computed`, () => {
      expect(figures(readFileSync(join(__dirname, file), "utf8"))).toEqual([]);
    });
  }

  it("catches a hardcoded stat (the check itself works)", () => {
    const planted = `export const A = () => (<p tabIndex={0}><b>1,055</b> UNIT TESTS {77} {"77 agents"} {\`v\${x} of 12\`} <i>{n.slice(0, 10)}</i></p>);`;
    expect(figures(planted)).toEqual(["text: 1,055", "number: 77", "string: 77 agents", "template: v… of 12"]);
  });
});
