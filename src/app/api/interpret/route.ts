import { createModelCall } from "@/lib/anthropicModel";
import { interpretHeadline } from "@/lib/interpret";
import { RateLimiter, TtlCache } from "@/lib/rateLimit";
import { InterpretRequest, type ScenarioParams } from "@/lib/schemas";

// POST /api/interpret: the app's only network call (CLAUDE.md, Architecture; D-052). The API key
// lives only in the server environment (ANTHROPIC_API_KEY, set in Vercel), is never sent to the
// browser, logged or echoed. Every failure answers 200 with an offline fallback, so the demo
// never dies because of the network.

export const maxDuration = 10;

const MAX_BODY_BYTES = 1_024;

// Per serverless instance (best effort; the workspace spend limit is the hard cap).
const limiter = new RateLimiter();
const cache = new TtlCache<ScenarioParams>();

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
  if (length > MAX_BODY_BYTES) return Response.json({ ok: false, message: "Headline too long." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ ok: false, message: "Headline too long." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, message: "Send a JSON body like {\"headline\": \"...\"}." }, { status: 400 });
  }
  const parsed = InterpretRequest.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, message: "A headline is 1 to 200 characters." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const answer = await interpretHeadline(parsed.data.headline, clientIp(request), {
    callModel: apiKey ? createModelCall(apiKey) : null,
    limiter,
    cache,
    now: () => Date.now(),
  });
  return Response.json(answer);
}
