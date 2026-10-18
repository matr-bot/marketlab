import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL, SYSTEM_PROMPT, type ModelCall } from "./interpret";
import { ModelOutput } from "./schemas";

// The one real model call (server-only: imported by /api/interpret and the live-check script,
// never by a client component). Claude Haiku 5.5 with structured outputs at low effort; it takes
// no temperature (only 1 or omitted is accepted), so consistency comes from the fixed prompt, low
// effort, structured outputs and the cache (D-052). 6 s timeout, no retries: a slow answer falls
// back offline instead of stalling the demo.

export const TIMEOUT_MS = 6_000;

export function createModelCall(apiKey: string): ModelCall {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  return async (headline) => {
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 2_048, // thinking counts toward max_tokens on this model
        output_config: { effort: "low", format: zodOutputFormat(ModelOutput) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `<headline>${headline.replace(/[<>]/g, "")}</headline>` }],
      });
      if (response.stop_reason === "refusal") return { kind: "refusal" };
      if (response.stop_reason === "max_tokens") return { kind: "truncated" };
      if (response.parsed_output === null) return { kind: "invalid" };
      return { kind: "ok", output: response.parsed_output };
    } catch (error) {
      // Timeouts, rate limits, network and API errors all fall back offline; never echo details.
      const detail = error instanceof Anthropic.APIError ? `api ${error.status}` : error instanceof Error ? error.name : "unknown";
      return { kind: "error", detail };
    }
  };
}
