// Cost control for /api/interpret (D-052). In-memory, so per serverless instance: best effort.
// The hard cap is the Anthropic workspace spend limit. Judges share one Wi-Fi network (one IP),
// so the per-visitor limits are generous.

export const LIMITS = {
  perIpPerMinute: 20,
  perIpPerHour: 100,
  perInstancePerHour: 300,
  cacheEntries: 500,
  cacheTtlMs: 3_600_000,
} as const;

/** Sliding-window limits per key plus one instance-wide hourly cap. `now` is injected for tests. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private instance: number[] = [];

  /** Records a request and says whether it is allowed. A refused request is not recorded. */
  allow(key: string, now: number): boolean {
    const mine = (this.hits.get(key) ?? []).filter((t) => t > now - 3_600_000);
    this.instance = this.instance.filter((t) => t > now - 3_600_000);
    const lastMinute = mine.filter((t) => t > now - 60_000).length;
    if (lastMinute >= LIMITS.perIpPerMinute || mine.length >= LIMITS.perIpPerHour || this.instance.length >= LIMITS.perInstancePerHour) {
      this.hits.set(key, mine);
      return false;
    }
    mine.push(now);
    this.hits.set(key, mine);
    this.instance.push(now);
    // Keep the map from growing without bound: forget idle keys.
    if (this.hits.size > 10_000) for (const [k, ts] of this.hits) if (ts.every((t) => t <= now - 3_600_000)) this.hits.delete(k);
    return true;
  }
}

/** Least-recently-used cache with a time to live, for identical headlines. */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; at: number }>();

  get(key: string, now: number): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined || now - hit.at > LIMITS.cacheTtlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // move to the newest position
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, now: number): void {
    this.map.delete(key);
    this.map.set(key, { value, at: now });
    while (this.map.size > LIMITS.cacheEntries) this.map.delete(this.map.keys().next().value!);
  }

  get size(): number {
    return this.map.size;
  }
}

/** The cache key: case and spacing do not make a different headline. */
export function normalizeHeadline(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}
