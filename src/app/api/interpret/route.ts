import { createModelCall, createScenarioModelCall, createStrategyModelCall } from "@/lib/anthropicModel";
import { interpretHeadline, interpretStrategy } from "@/lib/interpret";
import { RateLimiter, TtlCache } from "@/lib/rateLimit";
import { InterpretRequest, StrategyRequest, type ScenarioParams, type StrategyParams } from "@/lib/schemas";
import { ScenarioRequest, interpretOpenScenario } from "@/lib/scenarioInterpret";

// POST /api/interpret: the app's only network call (CLAUDE.md, Architecture; D-052). The API key
// lives only in the server environment (ANTHROPIC_API_KEY, set in Vercel), is never sent to the
// browser, logged or echoed. Every failure answers 200 with an offline fallback, so the demo
// never dies because of the network. A body with "kind": "strategy" is a trading idea (D-064);
// anything else is a headline, exactly as before.

export const maxDuration = 10;

const MAX_BODY_BYTES = 2_048;

// Per serverless instance (best effort; the workspace spend limit is the hard cap).
const limiter = new RateLimiter();
const cache = new TtlCache<ScenarioParams>();
const strategyCache = new TtlCache<StrategyParams>();

/** The visitor's IP for rate limiting (Vercel sets x-forwarded-for). */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Only our own pages may call this route. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden." }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return Response.json({ ok: false, message: "Too long: a headline is at most 200 characters, a strategy 300." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ ok: false, message: "Too long: a headline is at most 200 characters, a strategy 300." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, message: "Send a JSON body like {\"headline\": \"...\"}." }, { status: 400 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "scenario") {
    const scenario = ScenarioRequest.safeParse(body);
    if (!scenario.success) return Response.json({ ok: false, source: "unsupported", message: "A scenario is 2 to 500 characters." }, { status: 400 });
    if (!apiKey) return Response.json(await interpretOpenScenario(null));
    if (!limiter.allow(clientIp(request), Date.now())) return Response.json({ ok: false, source: "unavailable", message: "AI is busy. Please try again later; nothing was applied." });
    return Response.json(await interpretOpenScenario(() => createScenarioModelCall(apiKey)(scenario.data.text)));
  }
  if (typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "strategy") {
    const strategy = StrategyRequest.safeParse(body);
    if (!strategy.success) return Response.json({ ok: false, message: "A strategy is 1 to 300 characters." }, { status: 400 });
    const answer = await interpretStrategy(strategy.data.text, clientIp(request), {
      callModel: apiKey ? createStrategyModelCall(apiKey) : null,
      limiter,
      cache: strategyCache,
      now: () => Date.now(),
    });
    return Response.json(answer);
  }
  const parsed = InterpretRequest.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, message: "A headline is 1 to 200 characters." }, { status: 400 });

  const answer = await interpretHeadline(parsed.data.headline, clientIp(request), {
    callModel: apiKey ? createModelCall(apiKey) : null,
    limiter,
    cache,
    now: () => Date.now(),
  });
  return Response.json(answer);
}
