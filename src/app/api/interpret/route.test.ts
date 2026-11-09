import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const URL_ = "https://marketlab.example/api/interpret";
const post = (body: string, headers: Record<string, string> = { origin: "https://marketlab.example" }) =>
  POST(new Request(URL_, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));

describe("POST /api/interpret: HTTP checks (D-052)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; // no network in tests
  });
  afterEach(() => {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  it("refuses other origins and requests with no origin", async () => {
    expect((await post(JSON.stringify({ headline: "Fed hikes" }), { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(JSON.stringify({ headline: "Fed hikes" }), {})).status).toBe(403);
  });

  it("refuses bodies over 1 KB, malformed JSON, and headlines outside 1 to 200 characters", async () => {
    expect((await post(JSON.stringify({ headline: "x".repeat(2_000) }))).status).toBe(413);
    expect((await post("{not json"))).toHaveProperty("status", 400);
    expect((await post(JSON.stringify({ headline: "   " }))).status).toBe(400);
    expect((await post(JSON.stringify({ headline: "x".repeat(201) }))).status).toBe(400);
    expect((await post(JSON.stringify({ title: "Fed hikes" }))).status).toBe(400);
  });

  it("with no API key configured, answers 200 with the offline fallback", async () => {
    const res = await post(JSON.stringify({ headline: "Fed unexpectedly hikes rates 75 basis points" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, source: "offline", preset: "FED" });
    const none = await (await post(JSON.stringify({ headline: "Aliens land in Ohio" }))).json();
    expect(none).toMatchObject({ ok: true, source: "offline", preset: null, scenario: null, message: "AI unavailable · offline, only clear events work (a rate hike, fraud, a beat, a miss, a downgrade), or type FED, CEO, BEAT or DOWNGRADE on its own." });
  });
});

describe("POST /api/interpret: strategies (D-064)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; // no network in tests
  });
  afterEach(() => {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  it("refuses a strategy body outside 1 to 300 characters, or with a headline instead of text", async () => {
    expect((await post(JSON.stringify({ kind: "strategy", text: " " }))).status).toBe(400);
    expect((await post(JSON.stringify({ kind: "strategy", text: "x".repeat(301) }))).status).toBe(400);
    const res = await post(JSON.stringify({ kind: "strategy", headline: "Buy after a 3% drop" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, message: "A strategy is 1 to 300 characters." });
  });

  it("with no API key, understands simple phrasing offline and says so", async () => {
    const res = await post(JSON.stringify({ kind: "strategy", text: "Buy after a quick 3% drop because panic sellers overshoot" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, source: "offline", strategy: { spec: { entry: { rule: "buyAfterDrop", pct: 0.03, windowSec: 60 } }, reason: "" } });
  });

  it("a headline body is still a headline", async () => {
    expect(await (await post(JSON.stringify({ kind: "headline", headline: "Fed unexpectedly hikes rates 75 basis points" }))).json()).toMatchObject({ source: "offline", preset: "FED" });
  });
});
