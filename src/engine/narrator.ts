import type { Fill } from "./matchingEngine";
import type { Simulation } from "./simulation";

// The desk-chat narrator (D-055, CLAUDE.md "Desk chat panel"). Deterministic, not AI: it watches the
// simulation at every tick end and posts short desk-style messages built only from engine numbers
// (the fill log, the book, fair value, headline records), so every number it says is true.
//
// Pacing: at most one message per PACE_MS of sim time (a headline posts at once) and at most
// MAX_QUEUE waiting; when the queue is full the least important waiting message is dropped. Each one-off message (a headline, its
// first minute, its recovery) fires once.

export interface ChatMessage {
  /** 0, 1, 2, … in posting order. */
  readonly seq: number;
  /** Sim ms it was posted. */
  readonly time: number;
  readonly kind: "headline" | "flow" | "panic" | "vacuum" | "spread" | "recovery" | "impact" | "quiet";
  readonly text: string;
}

const PACE_MS = 4_000;
const MAX_QUEUE = 5;
const QUIET_MS = 60_000;
const FLOW_DELAY_MS = 5_000;
/** Lower is more important. */
const PRIORITY: Record<ChatMessage["kind"], number> = { headline: 0, flow: 1, panic: 1, vacuum: 1, impact: 2, spread: 2, recovery: 3, quiet: 9 };
/** Panic "peaked" is posted once the count has not grown for this long. */
const PANIC_SETTLE_MS = 10_000;
/** Spread note: the last 2 s average must be at least this many cents and 3× the 2 minutes before. */
const SPREAD_MIN_CENTS = 6;

/** Whole dollars with separators: 2928100 → "$29,281". */
export function dollars(cents: number): string {
  const d = Math.round(Math.abs(cents) / 100);
  return `$${String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** A price in cents (may be fractional) as $181.44. */
export function price(cents: number): string {
  const c = Math.round(cents);
  return `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** Shares with separators: 18400 → "18,400". */
export function shares(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

interface Pending {
  readonly kind: ChatMessage["kind"];
  readonly text: string;
  readonly created: number;
}

interface HeadlineWatch {
  readonly seq: number;
  readonly time: number;
  readonly label: string;
  readonly m0: number;
  readonly down: boolean;
  extreme: number;
  flowDone: boolean;
  recoveryDone: boolean;
  impactDone: boolean;
}

export class Narrator {
  private readonly out: ChatMessage[] = [];
  private queue: Pending[] = [];
  private nextSeq = 0;
  private lastPost = -Infinity;
  private lastAny = 0;
  private seenFill = 0;
  private seenShock = 0;
  private readonly watches: HeadlineWatch[] = [];
  /** Fills of the last QUIET_MS, for flow, panic and quiet statistics. */
  private recent: Fill[] = [];
  /** Tick-end samples of the last QUIET_MS: spread (null if one-sided) and whether a maker was at either best price. */
  private samples: Array<{ time: number; spread: number | null; makerAtBest: number }> = [];
  private vacuumSince: number | null = null;
  private vacuumSide: "BIDS" | "ASKS" | null = null;
  private panicSellers = new Set<string>();
  private panicAnnounced = 0;
  private panicPeakDone = false;
  private panicGrewAt = 0;
  private panicSince = 0;
  private lastSpreadNote = -Infinity;

  constructor(private readonly sim: Simulation) {
    this.seenFill = sim.engine.fillCount;
  }

  /** Messages posted since the last call, oldest first. */
  take(): ChatMessage[] {
    return this.out.splice(0);
  }

  /** Call after every tick. */
  onTick(): void {
    const sim = this.sim;
    const now = sim.clock.now;
    const book = sim.engine.book;
    const bid = book.bestBid();
    const ask = book.bestAsk();
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;

    // New fills, kept for QUIET_MS.
    const fresh = sim.engine.fillsSince(this.seenFill);
    this.seenFill += fresh.length;
    for (const f of fresh) this.recent.push(f);
    while (this.recent.length > 0 && this.recent[0].time < now - QUIET_MS) this.recent.shift();
    const makerAt = (side: "buy" | "sell", p: number | null) => (p !== null && book.ordersAt(side, p).some((o) => o.agentType === "marketMaker") ? 0.5 : 0);
    this.samples.push({ time: now, spread: mid === null ? null : ask! - bid!, makerAtBest: makerAt("buy", bid) + makerAt("sell", ask) });
    while (this.samples.length > 0 && this.samples[0].time <= now - QUIET_MS) this.samples.shift();

    this.headlines(now, mid);
    this.panic(fresh, now);
    this.vacuum(now, bid === null ? "BIDS" : ask === null ? "ASKS" : null);
    this.spread(now, mid === null ? null : ask! - bid!);
    this.impacts();
    if (this.queue.length === 0 && now - this.lastAny >= QUIET_MS) this.quiet(now);
    this.post(now);
  }

  private push(kind: ChatMessage["kind"], text: string, now: number): void {
    this.queue.push({ kind, text, created: now });
    this.lastAny = now;
    if (this.queue.length > MAX_QUEUE) {
      // Drop the least important, oldest first among equals.
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) if (PRIORITY[this.queue[i].kind] > PRIORITY[this.queue[worst].kind]) worst = i;
      this.queue.splice(worst, 1);
    }
  }

  private post(now: number): void {
    if (this.queue.length === 0) return;
    // A headline posts at once (headlines are already 3 s apart, D-051); everything else is paced.
    const headlineWaiting = this.queue.some((m) => m.kind === "headline");
    if (!headlineWaiting && now - this.lastPost < PACE_MS) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) if (PRIORITY[this.queue[i].kind] < PRIORITY[this.queue[best].kind]) best = i;
    const [m] = this.queue.splice(best, 1);
    this.out.push({ seq: this.nextSeq++, time: now, kind: m.kind, text: m.text });
    this.lastPost = now;
  }

  private headlines(now: number, mid: number | null): void {
    for (const s of this.sim.shocks) {
      if (s.seq < this.seenShock) continue;
      this.seenShock = s.seq + 1;
      const pct = (100 * s.shock.fairValuePct).toFixed(1);
      const sign = s.shock.fairValuePct > 0 ? "+" : "";
      this.push("headline", `${s.label} · fair value ${sign}${pct}%: value traders now price MLAB at ${price(s.fairValueAfter)}.`, now);
      this.watches.push({ seq: s.seq, time: s.time, label: s.label, m0: mid ?? s.fairValueBefore, down: s.fairValueAfter < s.fairValueBefore, extreme: mid ?? s.fairValueBefore, flowDone: false, recoveryDone: false, impactDone: false });
      this.panicSellers = new Set();
      this.panicAnnounced = 0;
      this.panicPeakDone = false;
      this.panicSince = s.time;
    }
    const v = this.sim.fundamental.value;
    for (const w of this.watches) {
      if (mid !== null && (w.down ? mid < w.extreme : mid > w.extreme)) w.extreme = mid;
      if (!w.flowDone && now >= w.time + FLOW_DELAY_MS) {
        w.flowDone = true;
        const side = w.down ? "sell" : "buy";
        const qty = this.recent.filter((f) => f.time >= w.time && f.time < w.time + FLOW_DELAY_MS && f.aggressor === side && (side === "sell" ? f.sell.agentType : f.buy.agentType) === "value").reduce((t, f) => t + f.qty, 0);
        if (qty > 0) this.push("flow", `Value traders ${w.down ? "sold" : "bought"} ${shares(qty)} shares in the first 5 s.`, now);
      }
      // Recovery: the price went at least 0.5% past fair value, then came back at least half way.
      const overshoot = w.down ? v - w.extreme : w.extreme - v;
      if (!w.recoveryDone && mid !== null && overshoot >= 0.005 * w.m0) {
        const back = w.down ? mid - w.extreme : w.extreme - mid;
        if (back >= 0.5 * overshoot) {
          w.recoveryDone = true;
          this.push("recovery", `Value traders ${w.down ? "bought the overshoot" : "sold into the spike"}: MLAB back to ${price(mid)}, fair value ${price(v)}.`, now);
        }
      }
    }
  }

  private impacts(): void {
    for (const imp of this.sim.shockImpacts) {
      const w = this.watches.find((x) => x.seq === imp.seq);
      if (w === undefined || w.impactDone || imp.pnlByType === null) continue;
      w.impactDone = true;
      const mm = imp.pnlByType.marketMaker ?? 0;
      const val = imp.pnlByType.value ?? 0;
      const mmText = mm < 0 ? `market makers lost ${dollars(mm)} to informed traders (adverse selection)` : `market makers made ${dollars(mm)}`;
      const valText = val >= 0 ? `value traders made ${dollars(val)}` : `value traders lost ${dollars(val)}`;
      this.push("impact", `First minute after ${w.label}: ${mmText}; ${valText}.`, this.sim.clock.now);
    }
    // Forget headlines whose messages are all done.
    for (let i = this.watches.length - 1; i >= 0; i--) {
      const w = this.watches[i];
      if (w.flowDone && w.impactDone && (w.recoveryDone || this.sim.clock.now > w.time + 600_000)) this.watches.splice(i, 1);
    }
  }

  private panic(fresh: readonly Fill[], now: number): void {
    const before = this.panicSellers.size;
    for (const f of fresh) if (f.aggressor === "sell" && f.sell.agentType === "panic" && f.time >= this.panicSince) this.panicSellers.add(f.sell.ownerId);
    const n = this.panicSellers.size;
    if (n > before) this.panicGrewAt = now;
    const total = this.sim.agentCountOfType("panic");
    if (n > 0 && this.panicAnnounced === 0) {
      this.panicAnnounced = n;
      this.push("panic", `Panic selling has started: ${n} of ${total} panic sellers triggered.`, now);
    } else if (!this.panicPeakDone && n > this.panicAnnounced && now - this.panicGrewAt >= PANIC_SETTLE_MS) {
      this.panicPeakDone = true;
      this.push("panic", `Panic peaked: ${n} of ${total} panic sellers sold into the drop.`, now);
    }
  }

  private vacuum(now: number, empty: "BIDS" | "ASKS" | null): void {
    if (empty !== null && this.vacuumSince === null) {
      this.vacuumSince = now;
      this.vacuumSide = empty;
    } else if (empty === null && this.vacuumSince !== null) {
      const secs = (now - this.vacuumSince) / 1000;
      if (secs >= 2) this.push("vacuum", `NO ${this.vacuumSide} · liquidity vacuum for ${secs.toFixed(1)} s.`, now);
      this.vacuumSince = null;
      this.vacuumSide = null;
    }
  }

  private spread(now: number, spread: number | null): void {
    if (spread === null || now - this.lastSpreadNote < 60_000) return;
    const two = (keep: (t: number) => boolean) => this.samples.filter((s) => keep(s.time) && s.spread !== null).map((s) => s.spread!);
    const before = two((t) => t <= now - 2_000);
    const recent = two((t) => t > now - 2_000);
    if (before.length < 100 || recent.length < 15) return;
    const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
    const was = avg(before);
    const is = avg(recent);
    if (is >= SPREAD_MIN_CENTS && is >= 3 * was) {
      this.lastSpreadNote = now;
      this.push("spread", `Spread widened from ${was.toFixed(1)}¢ to ${is.toFixed(1)}¢ over the last 2 s: market makers pulled back.`, now);
    }
  }

  private quiet(now: number): void {
    const two = this.samples.filter((s) => s.spread !== null);
    if (two.length === 0) return;
    const avg = two.reduce((t, s) => t + s.spread!, 0) / two.length;
    const atBest = this.samples.reduce((t, s) => t + s.makerAtBest, 0) / this.samples.length;
    const perSec = this.recent.length / (QUIET_MS / 1000);
    this.push("quiet", `Quiet market: spread ${avg.toFixed(1)}¢, ${perSec.toFixed(1)} trades a second, market makers at the best price ${Math.round(100 * atBest)}% of the time.`, now);
  }
}
