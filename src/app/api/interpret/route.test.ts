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
    expect(none).toMatchObject({ ok: true, source: "offline", preset: null, scenario: null, message: "AI unavailable · try FED, CEO, BEAT or DOWNGRADE." });
  });
});
