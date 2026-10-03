import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Guards the engine rule in eslint.config.mjs: src/engine must never import
// React, Next.js, or UI code, and must not touch DOM globals.
describe("engine import boundary (ESLint)", () => {
  const eslint = new ESLint();
  const lint = async (code: string) => {
    const [result] = await eslint.lintText(code, { filePath: "src/engine/probe.ts" });
    return result.messages.map((m) => m.ruleId);
  };

  it.each([
    ['import { useState } from "react";\nexport const x = useState;', "no-restricted-imports"],
    ['import { createRoot } from "react-dom/client";\nexport const x = createRoot;', "no-restricted-imports"],
    ['import Link from "next/link";\nexport const x = Link;', "no-restricted-imports"],
    ['import Page from "@/app/page";\nexport const x = Page;', "no-restricted-imports"],
    ["export const x = window.location;", "no-restricted-globals"],
    ["export const x = document.body;", "no-restricted-globals"],
  ])("rejects %j", async (code, rule) => {
    expect(await lint(code)).toContain(rule);
  });

  it("allows plain TypeScript", async () => {
    expect(await lint("export const add = (a: number, b: number): number => a + b;\n")).toEqual([]);
  });
}, 30_000);

// Guards the determinism rule (D-019): engine source may not reach functions that differ between
// browsers, an unseeded random source or the real clock, by any route. Tests and benchmarks are
// exempt. (determinism.test.ts is the runtime backstop for anything static analysis can't see.)
describe("engine determinism rule (ESLint)", () => {
  const eslint = new ESLint();
  const lint = async (code: string, filePath = "src/engine/probe.ts") => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.map((m) => m.ruleId);
  };

  const inexact = ["log", "log1p", "log2", "log10", "exp", "expm1", "pow", "cbrt", "hypot", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "random"];

  it.each(inexact)("rejects Math.%s", async (fn) => {
    expect(await lint(`export const x = Math.${fn}(0.5, 0.5);`)).toContain("no-restricted-syntax");
  });

  it.each([
    // Every bypass from the Codex review, and more.
    ["globalThis.Math.log(2)", 'export const x = globalThis.Math.log(2);'],
    ["an alias", "const m = Math;\nexport const x = m.log(2);"],
    ["destructuring", "const { log } = Math;\nexport const x = log(2);"],
    ["bracket access", 'export const x = Math["log"](2);'],
    ["optional chaining", "export const x = Math?.log(2);"],
    ["the comma trick", "export const x = (0, Math).log(2);"],
    ["passing Math to a function", "const f = (m: { log(x: number): number }) => m.log(2);\nexport const x = f(Math);"],
    ["Reflect", 'export const x = Reflect.get(Math, "log");'],
  ])("rejects reaching Math through %s", async (_label, code) => {
    expect((await lint(code)).length).toBeGreaterThan(0);
  });

  it.each([
    ["Date.now()", "export const x = Date.now();"],
    ["new Date()", "export const x = new Date();"],
    ["an alias of Date", "const D = Date;\nexport const x = D.now();"],
    ["performance.now()", "export const x = performance.now();"],
    ["crypto", "export const x = crypto.getRandomValues(new Uint32Array(1));"],
    ["self", "export const x = self;"],
    ["global", "export const x = global;"],
  ])("rejects %s", async (_label, code) => {
    expect(await lint(code)).toContain("no-restricted-globals");
  });

  it.each([
    ["**", "export const x = 2 ** 10;", "no-restricted-syntax"],
    ["**=", "let x = 2;\nx **= 3;\nexport { x };", "no-restricted-syntax"],
    ["eval", 'export const x = eval("1");', "no-eval"],
    ["new Function", 'export const f = new Function("return 1");', "no-new-func"],
  ])("rejects %s", async (_label, code, rule) => {
    expect(await lint(code)).toContain(rule);
  });

  it("names the replacement in its message", async () => {
    const [result] = await eslint.lintText("export const x = Math.log(2);", { filePath: "src/engine/probe.ts" });
    expect(result.messages[0].message).toMatch(/For ln, exp and pow use detMath; for randomness use Rng/);
  });

  it("allows the exact Math members, written out directly", async () => {
    const code =
      "export const f = (a: number, b: number): number => Math.sqrt(a * a + b * b) + Math.floor(a / b) + Math.ceil(a) - Math.trunc(a) + Math.round(a) + Math.min(a, b) + Math.max(a, b) + Math.abs(b) + Math.imul(1, 2) + Math.sign(a) + Math.fround(a) + Math.clz32(1);\n";
    expect(await lint(code)).toEqual([]);
  });

  it("still applies the DOM boundary to engine source", async () => {
    expect(await lint("export const x = window.location;")).toContain("no-restricted-globals");
  });

  it("keeps detMath out of price and cash code (integer money)", async () => {
    const code = 'import { ln } from "./detMath";\nexport const x = ln(2);\n';
    for (const file of ["orderBook", "matchingEngine", "validation", "marketRegistry", "types"]) {
      expect(await lint(code, `src/engine/${file}.ts`)).toContain("no-restricted-imports");
    }
    expect(await lint(code, "src/engine/rng.ts")).toEqual([]);
    expect(await lint('import { useState } from "react";\nexport const x = useState;', "src/engine/orderBook.ts")).toContain("no-restricted-imports");
  });

  it("exempts tests and benchmarks (they compare against Math.log and time things)", async () => {
    const code = "export const x = Math.log(2) + Math.random() + Date.now() + 2 ** 3;\n";
    expect(await lint(code, "src/engine/probe.test.ts")).toEqual([]);
    expect(await lint(code, "src/engine/probe.bench.ts")).toEqual([]);
  });

  it("applies only to the engine, not to UI code", async () => {
    expect(await lint("export const x = Math.log(2) + Date.now();\n", "src/app/probe.ts")).toEqual([]);
  });
}, 30_000);
