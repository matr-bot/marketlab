import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards D-006 in docs/DECISIONS.md: CLAUDE.md (builder) and AGENTS.md (Codex reviewer) stay
// separate, and the Next.js-managed rules block stays in CLAUDE.md where `next dev` maintains it.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf-8");
const MARKERS = ["<!-- BEGIN:nextjs-agent-rules -->", "<!-- END:nextjs-agent-rules -->"];

describe("agent instruction files (D-006)", () => {
  it("keeps the Next.js-managed block out of AGENTS.md", () => {
    const agents = read("AGENTS.md");
    for (const marker of MARKERS) expect(agents).not.toContain(marker);
  });

  it("keeps the reviewer role and its precedence over CLAUDE.md in AGENTS.md", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("You are the code reviewer for this project, not the builder.");
    expect(agents).toContain("Never modify files.");
    expect(agents).toMatch(/\*\*Precedence:\*\* this file overrides CLAUDE\.md/);
  });

  it("keeps the Next.js block in CLAUDE.md and never imports AGENTS.md there", () => {
    const claude = read("CLAUDE.md");
    for (const marker of MARKERS) expect(claude).toContain(marker);
    expect(claude).not.toMatch(/^@AGENTS\.md/m);
  });
});
