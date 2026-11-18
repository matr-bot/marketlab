import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// D-085 ("runs in the browser"): the simulation needs no server. The only request the app makes is the
// AI route (/api/interpret), plus the landing page's own static proof file (/proof.json). The engine and
// the worker make none. The route itself (src/app/api) is the server side and is not scanned.

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return relative(SRC, p) === join("app", "api") ? [] : files(p);
    return /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const ALLOWED = ["/api/interpret", "/proof.json"];

describe("network: one API route, nothing else (D-085)", () => {
  const sources = files(SRC).map((p) => ({ file: relative(SRC, p), text: readFileSync(p, "utf8") }));

  it("calls fetch only with an allowed same-origin path, written as a literal", () => {
    const calls = sources.flatMap(({ file, text }) => [...text.matchAll(/\bfetch\(\s*([^,)]*)/g)].map((m) => ({ file, target: m[1].trim() })));
    expect(calls.length).toBeGreaterThan(0);
    const bad = calls.filter((c) => !ALLOWED.some((a) => c.target === `"${a}"`));
    expect(bad).toEqual([]);
  });

  it("opens no other channel: no XMLHttpRequest, WebSocket, EventSource or beacon", () => {
    const bad = sources.filter(({ text }) => /XMLHttpRequest|new WebSocket|new EventSource|sendBeacon/.test(text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it("keeps the engine and the worker off the network entirely", () => {
    const bad = sources.filter(({ file }) => /^(engine|worker)\//.test(file)).filter(({ text }) => /\bfetch\(|import\(\s*["']https?:/.test(text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });
});
