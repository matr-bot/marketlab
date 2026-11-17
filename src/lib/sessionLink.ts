import { runLink, type Scenario } from "@/engine/scenarios";

/**
 * The link that reopens this session: the engine's run link (scenario and seed) plus the UI's own
 * settings, today Learn mode (D-072). Relative, so it works on any host.
 */
export function sessionLink(scenario: Scenario, seed: number, learn: boolean): string {
  return `${runLink(scenario, seed)}${learn ? "&learn=1" : ""}`;
}

/** Learn mode from a query string: on only for `learn=1`. */
export function learnFromQuery(q: URLSearchParams): boolean {
  return q.get("learn") === "1";
}
