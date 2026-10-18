import { toTick } from "../price";
import type { Rng } from "../rng";
import type { Cents } from "../types";
import type { Agent, AgentContext, AgentSpec } from "./agent";

// Panic seller (D-045): a Granovetter threshold cascade. Each trader holds some shares and has its
// own pain point: a drop of dᵢ within a window of Wᵢ seconds. When the mid has fallen that far
// from its recent high (thresholds divided by a headline's panic sensitivity), it dumps shares with
// market orders. Its selling deepens the drop, which crosses the next trader's threshold: one
// panic triggers the next. Source: Granovetter (1978), "Threshold models of collective behavior",
// American Journal of Sociology 83(6).
//
// Stopping rules, so panic can never take the price to zero:
// 1. limited holdings: it sells only what it holds, never short;
// 2. a panic lasts at most `panicSec`;
// 3. it stops early if the mid recovers to within half its threshold of the high;
// 4. then a `cooldownSec` cooldown before it can panic again.
// When calm again, it slowly rebuilds its holdings with small passive bids below the market, so a
// later headline can start a new cascade (repeated shocks, D-045).

export interface PanicTraderParams {
  /** Trigger drop dᵢ ~ U(dropMin, dropMax), as a fraction of the window's high. */
  readonly dropMin: number;
  readonly dropMax: number;
  /** Window Wᵢ ~ U(windowMinSec, windowMaxSec). */
  readonly windowMinSec: number;
  readonly windowMaxSec: number;
  /** Holdings Hᵢ ~ U(holdingsMin, holdingsMax), whole lots. */
  readonly holdingsMin: number;
  readonly holdingsMax: number;
  /** Market sell size per arrival while panicking ~ U(sellMin, sellMax), whole lots. */
  readonly sellMin: number;
  readonly sellMax: number;
  readonly panicSec: number;
  readonly cooldownSec: number;
  /** Rebuild: one passive bid of up to `rebuildQty`, `rebuildOffset` cents below the mid (never above the best bid). */
  readonly rebuildQty: number;
  readonly rebuildOffset: number;
  /** Rebuild only while the drawdown is below this fraction of the trigger (the market is calm). */
  readonly calmFraction: number;
  readonly lotSize: number;
}

export const DEFAULT_PANIC_PARAMS: PanicTraderParams = {
  dropMin: 0.005,
  dropMax: 0.03,
  windowMinSec: 20,
  windowMaxSec: 90,
  holdingsMin: 1_000,
  holdingsMax: 6_000,
  sellMin: 300,
  sellMax: 1_500,
  panicSec: 20,
  cooldownSec: 300,
  rebuildQty: 200,
  rebuildOffset: 2,
  calmFraction: 0.5,
  lotSize: 100,
};

export type PanicPhase = "calm" | "panic" | "cooldown";

export class PanicTrader implements Agent {
  readonly drop: number;
  readonly windowMs: number;
  readonly holdings: number;
  private phase: PanicPhase = "calm";
  private panicStart = 0;
  private panicHigh = 0;
  private panicDrop = 0;
  private cooldownUntil = 0;
  /** Times this trader has started a panic (for reports and the narrator). */
  panics = 0;

  constructor(
    private readonly rng: Rng,
    private readonly params: PanicTraderParams = DEFAULT_PANIC_PARAMS,
  ) {
    const p = params;
    const lots = (x: number) => Math.round(x / p.lotSize) * p.lotSize;
    this.drop = p.dropMin + (p.dropMax - p.dropMin) * rng.uniform();
    this.windowMs = Math.round((p.windowMinSec + (p.windowMaxSec - p.windowMinSec) * rng.uniform()) * 10) * 100;
    this.holdings = lots(p.holdingsMin + (p.holdingsMax - p.holdingsMin) * rng.uniform());
  }

  get state(): PanicPhase {
    return this.phase;
  }

  act(ctx: AgentContext): void {
    const p = this.params;
    const bid = ctx.book.bestBid();
    const ask = ctx.book.bestAsk();
    if (bid === null || ask === null) return;
    const mid = (bid + ask) / 2;
    const now = ctx.time;
    const held = this.holdings + ctx.position; // starts at Hᵢ; fills move it

    if (this.phase === "cooldown" && now >= this.cooldownUntil) this.phase = "calm";

    if (this.phase === "calm") {
      const high = ctx.maxMidSince(now - this.windowMs);
      const threshold = this.drop / ctx.panicSensitivity;
      const drawdown = high === null ? 0 : 1 - mid / high;
      if (high !== null && drawdown >= threshold && held > 0) {
        this.phase = "panic";
        this.panics++;
        this.panicStart = now;
        this.panicHigh = high;
        this.panicDrop = threshold;
        for (const o of ctx.myOrders()) ctx.cancel(o.id);
      } else {
        this.rebuild(ctx, held, bid, mid, drawdown < threshold * p.calmFraction);
        return;
      }
    }

    if (this.phase === "panic") {
      const over = now - this.panicStart >= p.panicSec * 1000;
      const recovered = mid >= this.panicHigh * (1 - this.panicDrop / 2);
      if (held <= 0 || over || recovered) {
        this.phase = "cooldown";
        this.cooldownUntil = now + p.cooldownSec * 1000;
        return;
      }
      const size = p.sellMin + (p.sellMax - p.sellMin) * this.rng.uniform();
      const qty = Math.min(held, Math.max(p.lotSize, Math.floor(size / p.lotSize) * p.lotSize));
      ctx.submit({ type: "market", side: "sell", qty });
    }
  }

  /** Calm: rest one small passive bid toward the target holdings; otherwise rest nothing. */
  private rebuild(ctx: AgentContext, held: number, bid: Cents, mid: number, calm: boolean): void {
    const p = this.params;
    const missing = Math.floor((this.holdings - held) / p.lotSize) * p.lotSize;
    const mine = ctx.myOrders();
    if (!calm || missing <= 0) {
      for (const o of mine) ctx.cancel(o.id);
      return;
    }
    const price = Math.min(bid, toTick(mid - p.rebuildOffset, ctx.book.tickSize, "down"));
    const qty = Math.min(p.rebuildQty, missing);
    if (mine.length === 1 && mine[0].side === "buy" && mine[0].price === price && mine[0].qty === qty) return;
    for (const o of mine) ctx.cancel(o.id);
    ctx.submit({ type: "limit", side: "buy", price, qty });
  }
}

/** `count` panic sellers with ids panic-1 … panic-N. */
export function panicTraders(count: number, ratePerSec: number, params: PanicTraderParams = DEFAULT_PANIC_PARAMS): AgentSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `panic-${i + 1}`,
    agentType: "panic" as const,
    ratePerSec,
    create: (decisions: Rng) => new PanicTrader(decisions, params),
  }));
}
