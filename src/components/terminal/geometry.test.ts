import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// D-078: the terminal's geometry. Sharp, flat, on a 4px grid, and nothing moves but the tick flash.

const ROOT = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : name.endsWith(".css") ? [p] : [];
  });
}
const CSS = ["app", "components"].flatMap((d) => files(join(ROOT, d)));
const rel = (p: string) => relative(ROOT, p);

/** Declarations as [file, selector, property, value], comments removed. */
function declarations(): Array<[string, string, string, string]> {
  return CSS.flatMap((p) => {
    const css = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) =>
      m[2]
        .split(";")
        .map((d) => d.split(":"))
        .filter((d) => d.length >= 2)
        .map(([k, ...v]) => [rel(p), m[1].trim(), k.trim(), v.join(":").trim()] as [string, string, string, string]),
    );
  });
}

describe("terminal geometry (D-078)", () => {
  it("finds the stylesheets", () => {
    expect(CSS.map(rel)).toEqual(expect.arrayContaining(["app/globals.css", "components/terminal/terminal.module.css"]));
  });

  it("spaces on a 4px scale: every padding, margin and gap is a multiple of 4px (or -1px to overlap a hairline)", () => {
    const off = declarations()
      .filter(([, , prop]) => /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(prop))
      .flatMap(([file, sel, prop, value]) =>
        [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n !== -1 && n % 4 !== 0).map((n) => `${file} ${sel} { ${prop}: ${value} } (${n}px)`),
      );
    expect(off).toEqual([]);
  });

  it("has sharp corners, no shadows, no gradients, no glow", () => {
    const bad = declarations().filter(([, , prop, value]) => (prop === "border-radius" && value !== "0") || prop === "box-shadow" || prop === "text-shadow" || /gradient\(/.test(value) || (prop === "filter" && /blur|drop-shadow/.test(value)));
    expect(bad).toEqual([]);
  });

  it("has no CSS transitions; the only keyframes are the delayed OPENING MARKET reveal (0s, it does not move)", () => {
    const decls = declarations();
    expect(decls.filter(([, , prop]) => prop.startsWith("transition"))).toEqual([]);
    const animated = decls.filter(([, , prop]) => prop === "animation" || prop === "animation-name");
    expect(animated.map(([, sel, , v]) => `${sel} ${v}`)).toEqual([".opening appear 0s linear 1s forwards"]);
  });
});
