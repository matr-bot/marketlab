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
