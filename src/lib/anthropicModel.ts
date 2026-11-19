import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODEL, STRATEGY_SYSTEM_PROMPT, SYSTEM_PROMPT, type ModelCall, type ModelResult, type StrategyModelCall } from "./interpret";
import { ModelOutput, StrategyModelOutput } from "./schemas";

// The one real model call (server-only: imported by /api/interpret and the live-check script,
// never by a client component). Claude Haiku 5.5 with structured outputs at low effort; it takes
// no temperature (only 1 or omitted is accepted), so consistency comes from the fixed prompt, low
// effort, structured outputs and the cache (D-052). 6 s timeout, no retries: a slow answer falls
// back offline instead of stalling the demo. Headlines and strategies (D-064) share all of this.

export const TIMEOUT_MS = 6_000;

/** One structured-output call: the user's text goes inside `<tag>` tags (angle brackets removed) as data. */
/**
 * One log line per model call (D-092): token counts and why it stopped, to size max_tokens from real
 * use. Never the user's text, the model's answer or the key.
 */
export function usageLine(tag: string, usage: { input_tokens: number; output_tokens: number }, stopReason: string | null): string {
  return JSON.stringify({ event: "interpret_usage", tag, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, stop_reason: stopReason });
}

function createParseCall<S extends z.ZodType>(apiKey: string, system: string, schema: S, tag: string): (text: string) => Promise<ModelResult<z.infer<S>>> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  return async (text) => {
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 2_048, // thinking counts toward max_tokens on this model
        output_config: { effort: "low", format: zodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: `<${tag}>${text.replace(/[<>]/g, "")}</${tag}>` }],
      });
      console.log(usageLine(tag, response.usage, response.stop_reason));
      if (response.stop_reason === "refusal") return { kind: "refusal" };
      if (response.stop_reason === "max_tokens") return { kind: "truncated" };
      if (response.parsed_output === null) return { kind: "invalid" };
      return { kind: "ok", output: response.parsed_output as z.infer<S> };
    } catch (error) {
      // Timeouts, rate limits, network and API errors all fall back offline; never echo details.
      const detail = error instanceof Anthropic.APIError ? `api ${error.status}` : error instanceof Error ? error.name : "unknown";
      return { kind: "error", detail };
    }
  };
}

export function createModelCall(apiKey: string): ModelCall {
  return createParseCall(apiKey, SYSTEM_PROMPT, ModelOutput, "headline");
}

export function createStrategyModelCall(apiKey: string): StrategyModelCall {
  return createParseCall(apiKey, STRATEGY_SYSTEM_PROMPT, StrategyModelOutput, "strategy");
}
