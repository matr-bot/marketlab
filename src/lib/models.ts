import { demoAgents } from "@/engine/demoMarket";
import type { AgentType } from "@/engine/types";

/**
 * The crowd as the landing page explains it (D-083): each trader type in plain words, then the
 * published model behind it, its citation and the decisions that set our parameters. Counts come from
 * the demo crowd itself (`demoAgents`), never typed in.
 */
export interface AgentModel {
  readonly type: AgentType;
  readonly label: string;
  /** One plain sentence. */
  readonly plain: string;
  readonly model: string;
  readonly citation: string;
  /** How MarketLab uses it, with the decisions that record it. */
  readonly detail: string;
}

export const AGENT_MODELS: readonly AgentModel[] = [
  {
    type: "marketMaker",
    label: "MARKET MAKERS",
    plain: "Quote a price to buy and a price to sell, and earn the gap.",
    model: "Avellaneda–Stoikov optimal market making",
    citation: "Avellaneda, M. & Stoikov, S. (2008). High-frequency trading in a limit order book. Quantitative Finance, 8(3), 217–224.",
    detail: "Quotes around a reservation price that leans against inventory; the spread widens with volatility and risk aversion. Fill-rate decay k = 1.5, estimated from the simulated fill rates; skew and half-spread capped at 25¢ (D-033 to D-036, D-047, D-049).",
  },
  {
    type: "value",
    label: "VALUE TRADERS",
    plain: "Buy below what they think the stock is worth, sell above it.",
    model: "Fundamentalist agents in the Chiarella–Iori fundamentalist–chartist–noise framework",
    citation: "Chiarella, C. & Iori, G. (2002). A simulation analysis of the microstructure of double auction markets. Quantitative Finance, 2(5), 346–353.",
    detail: "Each trades toward a belief about fair value, which follows a random walk and jumps on news; a headline moves fair value, and these traders move the price toward it (D-044).",
  },
  {
    type: "panic",
    label: "PANIC SELLERS",
    plain: "Sell when the drop passes their own pain point; one panic sets off the next.",
    model: "Heterogeneous threshold cascade",
    citation: "Granovetter, M. (1978). Threshold models of collective behavior. American Journal of Sociology, 83(6), 1420–1443.",
    detail: "Each has a different drawdown threshold, so a fall that triggers the most nervous pushes the price to the next threshold; they rebuild positions once the market is calm (D-045).",
  },
  {
    type: "noise",
    label: "NOISE TRADERS",
    plain: "Send small random orders, the everyday background of a market.",
    model: "Zero-intelligence traders",
    citation: "Gode, D. K. & Sunder, S. (1993). Allocative efficiency of markets with zero-intelligence traders. Journal of Political Economy, 101(1), 119–137.",
    detail: "Orders arrive as a Poisson process at random prices around the mid; they spread out and widen with volatility (D-046).",
  },
];

/** How many of each type the demo crowd has, and the total: from the crowd definition the worker runs. */
export function crowdCounts(): { total: number; byType: Partial<Record<AgentType, number>> } {
  const agents = demoAgents();
  const byType: Partial<Record<AgentType, number>> = {};
  for (const a of agents) byType[a.agentType] = (byType[a.agentType] ?? 0) + 1;
  return { total: agents.length, byType };
}
