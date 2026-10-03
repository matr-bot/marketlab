import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

// All statistical checks below run on fixed seeds, so they are deterministic: each one either
// always passes or always fails. Thresholds are set at about 4–5 standard errors (or p = 0.001 for
// chi-square), so a correct generator passes with a wide margin and a broken one fails clearly.

const N = 1_000_000;
const SEEDS = [1, 2, 3, 187, 4_294_967_295];

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const bits = (x: number) => {
  f64[0] = x;
  return `0x${u32[1].toString(16).padStart(8, "0")}${u32[0].toString(16).padStart(8, "0")}`;
};

function moments(xs: Float64Array) {
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= xs.length;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= xs.length;
  m3 /= xs.length;
  m4 /= xs.length;
  return { mean, variance: m2, skew: m3 / m2 ** 1.5, kurtosis: m4 / (m2 * m2) };
}

/** Kolmogorov–Smirnov statistic of a sample against a continuous CDF. */
function ksStatistic(xs: Float64Array, cdf: (x: number) => number): number {
  const sorted = Float64Array.from(xs).sort();
  let d = 0;
  for (let i = 0; i < sorted.length; i++) {
    const F = cdf(sorted[i]);
    d = Math.max(d, (i + 1) / sorted.length - F, F - i / sorted.length);
  }
  return d;
}
/** KS critical value at p = 0.001: 1.95 / √n. */
const ksCritical = (n: number) => 1.95 / Math.sqrt(n);

/** Standard normal CDF via erf (Abramowitz & Stegun 7.1.26, error < 1.5e-7: far below KS resolution). */
function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

describe("Rng: matches the reference C implementation (scripts/reference/xoshiro128ss.c)", () => {
  // Output of the authors' reference xoshiro128** + SplitMix64 code, compiled and run locally.
  const reference: Array<[number, number[], number]> = [
    [0, [3737715805, 2584255861, 2876756834, 3286328325, 1553311962, 1625202774, 3260698944, 2754151956], 2387201604],
    [1, [1695105466, 1423115009, 634581793, 1068227753, 716759206, 4186505319, 3777694425, 2710820970], 1665077326],
    [187, [886303186, 1914074747, 3557440113, 1925500159, 3966965116, 1104124834, 2914171274, 3948463363], 2237365388],
    [4294967295, [331202089, 2303545133, 2732085799, 1755962312, 20464611, 435992899, 115300070, 2552219694], 3851643116],
  ];

  it.each(reference)("seed %i: first 8 outputs and the 1,000th", (seed, first, thousandth) => {
    const r = Rng.fromSeed(seed);
    expect(Array.from({ length: 8 }, () => r.nextU32())).toEqual(first);
    for (let i = 8; i < 999; i++) r.nextU32();
    expect(r.nextU32()).toBe(thousandth);
  });
});

describe("Rng: golden values (pin the exact bits of every distribution)", () => {
  it("seed 187", () => {
    const r = Rng.fromSeed(187);
    expect([r.uniform(), r.uniform(), r.uniform()]).toEqual([0.20635854126885533, 0.44565525534562767, 0.8282810712698847]);
    expect([r.normal(), r.normal(), r.normal()].map(bits)).toEqual(["0xbfb8acc13f4351c7", "0xbff257a801d1a924", "0x3fe2b3d2d3502786"]);
    expect([r.exponential(5), r.exponential(5), r.exponential(5)].map(bits)).toEqual([
      "0x3fb067490c6ed8be",
      "0x3f9d585948493e26",
      "0x3fcab7ee603f1c53",
    ]);
    expect(Array.from({ length: 10 }, () => r.int(1, 6))).toEqual([4, 2, 4, 3, 3, 4, 6, 3, 3, 4]);
  });

  it("stream \"noise-3\" of seed 187", () => {
    const s = Rng.fromSeed(187).stream("noise-3");
    expect([s.nextU32(), s.nextU32(), s.nextU32()]).toEqual([1971455232, 762929774, 2365454848]);
  });
});

describe("Rng: determinism and named streams (D-018)", () => {
  it("the same seed gives the same sequence; different seeds differ", () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const c = Rng.fromSeed(43);
    const seqA = Array.from({ length: 1_000 }, () => a.nextU32());
    expect(Array.from({ length: 1_000 }, () => b.nextU32())).toEqual(seqA);
    expect(Array.from({ length: 1_000 }, () => c.nextU32())).not.toEqual(seqA);
  });

  it("a stream depends only on the seed and its label, not on draws made before", () => {
    const fresh = Rng.fromSeed(7).stream("mm-1");
    const used = Rng.fromSeed(7);
    for (let i = 0; i < 500; i++) used.nextU32();
    const later = used.stream("mm-1");
    expect(Array.from({ length: 100 }, () => later.nextU32())).toEqual(Array.from({ length: 100 }, () => fresh.nextU32()));
  });

  it("adding a new stream never changes an existing one (the what-if property)", () => {
    const run = (extraAgent: boolean) => {
      const root = Rng.fromSeed(187);
      const noise = root.stream("noise-1");
      if (extraAgent) {
        const whale = root.stream("whale-1");
        for (let i = 0; i < 1_000; i++) whale.normal();
      }
      return Array.from({ length: 100 }, () => noise.nextU32());
    };
    expect(run(true)).toEqual(run(false));
  });

  it("every stream path is unique: nested, reordered, repeated and look-alike paths all differ", () => {
    const first = (r: Rng) => Array.from({ length: 4 }, () => r.nextU32()).join(",");
    const root = () => Rng.fromSeed(187);
    const generators = [
      root(),
      root().stream("a"),
      root().stream("b"),
      root().stream("ab"),
      root().stream("a").stream("b"),
      root().stream("b").stream("a"), // order matters
      root().stream("a").stream("a"), // with XOR this was the root again
      root().stream("a/b"), // one label containing "/" ≠ the path a then b
      root().stream("a").stream("a").stream("a"), // with XOR this equalled stream("a")
      Rng.fromSeed(188).stream("a"),
      Rng.fromSeed(188), // a different seed's root
    ];
    expect(new Set(generators.map(first)).size).toBe(generators.length);
  });

  it("a nested stream depends only on its path, not on draws from its parents", () => {
    const parent = Rng.fromSeed(5).stream("agents");
    for (let i = 0; i < 300; i++) parent.normal();
    const a = parent.stream("noise-1");
    const b = Rng.fromSeed(5).stream("agents").stream("noise-1");
    expect(Array.from({ length: 50 }, () => a.nextU32())).toEqual(Array.from({ length: 50 }, () => b.nextU32()));
  });

  it("reports its path", () => {
    expect(Rng.fromSeed(1).path).toBe("");
    expect(Rng.fromSeed(1).stream("arrivals").stream("noise-3").path).toBe("arrivals/noise-3");
  });

  it("streams are uncorrelated with each other", () => {
    const a = Rng.fromSeed(187).stream("noise-1");
    const b = Rng.fromSeed(187).stream("noise-2");
    let sab = 0;
    for (let i = 0; i < N; i++) sab += (a.uniform() - 0.5) * (b.uniform() - 0.5);
    const corr = sab / N / (1 / 12);
    expect(Math.abs(corr)).toBeLessThan(5 / Math.sqrt(N));
  });
});

describe("Rng: uniform numbers", () => {
  it.each(SEEDS)("pass a 100-bin chi-square test on 1,000,000 draws (seed %i)", (seed) => {
    const r = Rng.fromSeed(seed);
    const bins = new Uint32Array(100);
    for (let i = 0; i < N; i++) bins[Math.floor(r.uniform() * 100)]++;
    let chi2 = 0;
    for (const observed of bins) chi2 += (observed - N / 100) ** 2 / (N / 100);
    expect(chi2).toBeLessThan(148.23); // chi-square, 99 degrees of freedom, p = 0.001
  });

  it.each(SEEDS)("have mean 1/2, variance 1/12 and no lag-1 correlation (seed %i)", (seed) => {
    const r = Rng.fromSeed(seed);
    const xs = new Float64Array(N);
    for (let i = 0; i < N; i++) xs[i] = r.uniform();
    const m = moments(xs);
    expect(Math.abs(m.mean - 0.5)).toBeLessThan(5 * Math.sqrt(1 / 12 / N));
    expect(Math.abs(m.variance - 1 / 12)).toBeLessThan(0.0005);
    let lag = 0;
    for (let i = 1; i < N; i++) lag += (xs[i] - 0.5) * (xs[i - 1] - 0.5);
    expect(Math.abs(lag / (N - 1) / (1 / 12))).toBeLessThan(5 / Math.sqrt(N));
  });

  it("set every one of the 32 output bits about half the time", () => {
    const r = Rng.fromSeed(187);
    const ones = new Uint32Array(32);
    for (let i = 0; i < N; i++) {
      const x = r.nextU32();
      for (let b = 0; b < 32; b++) ones[b] += (x >>> b) & 1;
    }
    for (const count of ones) expect(Math.abs(count / N - 0.5)).toBeLessThan(5 * 0.5 / Math.sqrt(N));
  });

  it("map raw outputs exactly: uniform = n / 2^32, uniformOpen = (n + ½) / 2^32", () => {
    const raw = Rng.fromSeed(187).nextU32();
    expect(Rng.fromSeed(187).uniform()).toBe(raw / 4294967296);
    expect(Rng.fromSeed(187).uniformOpen()).toBe((raw + 0.5) / 4294967296);
  });

  it("stay in [0, 1) and strictly inside (0, 1) even at the extreme raw values", () => {
    // Force the two extreme raw outputs, 0 and 2^32 − 1.
    for (const raw of [0, 4_294_967_295]) {
      const r = Rng.fromSeed(1);
      r.nextU32 = () => raw;
      const u = r.uniform();
      const open = r.uniformOpen();
      expect(u >= 0 && u < 1).toBe(true);
      expect(open > 0 && open < 1).toBe(true);
    }
  });
});

describe("Rng: integers", () => {
  it.each([
    [1, 6],
    [0, 2], // 3 values: 2^32 is not a multiple of 3, so bias would show without rejection
    [-3, 3], // 7 values
    [10, 10],
  ])("int(%i, %i) hits every value equally often", (lo, hi) => {
    const r = Rng.fromSeed(187);
    const n = hi - lo + 1;
    const counts = new Map<number, number>();
    for (let i = 0; i < 600_000; i++) {
      const v = r.int(lo, hi);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => lo + i));
    let chi2 = 0;
    for (const c of counts.values()) chi2 += (c - 600_000 / n) ** 2 / (600_000 / n);
    expect(chi2).toBeLessThan(25); // well above the p = 0.001 critical value for ≤ 6 degrees of freedom (22.5)
  });

  it("redraws exactly the raw values that would cause bias", () => {
    // n = 2^31 + 1: 2^32 mod n = 2^31 − 1, so raw values ≥ 2^31 + 1 are rejected, about half of
    // all draws. Replaying the raw stream shows int() skips exactly those and keeps the rest.
    const n = 2 ** 31 + 1;
    const limit = 4_294_967_296 - (4_294_967_296 % n);
    expect(limit).toBe(2 ** 31 + 1);
    const r = Rng.fromSeed(187);
    const raw = Rng.fromSeed(187);
    let rejected = 0;
    for (let i = 0; i < 10_000; i++) {
      let x = raw.nextU32();
      while (x >= limit) {
        rejected++;
        x = raw.nextU32();
      }
      expect(r.int(100, 100 + n - 1)).toBe(100 + (x % n));
    }
    expect(rejected).toBeGreaterThan(4_000); // the rejection path really ran
  });

  it("rejects a draw exactly equal to the limit (>= limit, not > limit)", () => {
    // For n > 2^31 the limit equals n. Seed 0's first raw output is 3,737,715,805, so with
    // n = 3,737,715,805 that first draw sits exactly on the limit and must be redrawn; the
    // second raw output (2,584,255,861) is accepted.
    expect(Rng.fromSeed(0).int(0, 3_737_715_804)).toBe(2_584_255_861);
  });

  it("covers the full 32-bit range when asked", () => {
    const a = Rng.fromSeed(187);
    const b = Rng.fromSeed(187);
    expect(a.int(0, 4_294_967_295)).toBe(b.nextU32());
    expect(Rng.fromSeed(187).int(-10, 4_294_967_285)).toBe(Rng.fromSeed(187).nextU32() - 10);
  });

  it.each([
    [5, 4],
    [0.5, 3],
    [0, 4_294_967_296],
    [NaN, 3],
    [0, 2 ** 60],
    [-5, 4_294_967_291], // exactly 2^32 + 1 values: one too many
  ])("int(%s, %s) throws", (lo, hi) => {
    expect(() => Rng.fromSeed(1).int(lo, hi)).toThrow(/int\(lo, hi\) needs safe integers/);
  });
});

describe("Rng: normal numbers (polar method)", () => {
  it.each(SEEDS)("have mean 0, variance 1, skew 0, kurtosis 3 (seed %i)", (seed) => {
    const r = Rng.fromSeed(seed);
    const xs = new Float64Array(N);
    for (let i = 0; i < N; i++) xs[i] = r.normal();
    const m = moments(xs);
    expect(Math.abs(m.mean)).toBeLessThan(0.005);
    expect(Math.abs(m.variance - 1)).toBeLessThan(0.007);
    expect(Math.abs(m.skew)).toBeLessThan(0.012); // ~5 × √(6/N)
    expect(Math.abs(m.kurtosis - 3)).toBeLessThan(0.025); // ~5 × √(24/N): no fat tails from the RNG itself
  });

  it("pass a Kolmogorov–Smirnov test against the true bell curve", () => {
    const r = Rng.fromSeed(187);
    const xs = new Float64Array(200_000);
    for (let i = 0; i < xs.length; i++) xs[i] = r.normal();
    expect(ksStatistic(xs, normalCdf)).toBeLessThan(ksCritical(xs.length));
  });
});

describe("Rng: exponential waiting times", () => {
  it.each([0.5, 5, 200])("have mean 1/rate and pass a KS test (rate %s)", (rate) => {
    const r = Rng.fromSeed(187);
    const xs = new Float64Array(200_000);
    for (let i = 0; i < xs.length; i++) xs[i] = r.exponential(rate);
    const m = moments(xs);
    expect(Math.abs(m.mean * rate - 1)).toBeLessThan(5 / Math.sqrt(xs.length));
    expect(ksStatistic(xs, (x) => 1 - Math.exp(-rate * x))).toBeLessThan(ksCritical(xs.length));
    expect(Math.min(...xs.subarray(0, 10_000))).toBeGreaterThanOrEqual(0);
  });

  it("are memoryless: having already waited does not change the remaining wait", () => {
    const r = Rng.fromSeed(11);
    const rate = 2;
    const remaining: number[] = [];
    for (let i = 0; i < 500_000; i++) {
      const x = r.exponential(rate);
      if (x > 1) remaining.push(x - 1); // waited 1 s already
    }
    const mean = remaining.reduce((s, x) => s + x, 0) / remaining.length;
    expect(Math.abs(mean * rate - 1)).toBeLessThan(5 / Math.sqrt(remaining.length));
  });

  it("are strictly positive and finite even at the extreme raw values (never a zero gap)", () => {
    for (const raw of [0, 4_294_967_295]) {
      for (const rate of [1e-6, 1, 1e6, Number.MAX_VALUE]) {
        const r = Rng.fromSeed(1);
        r.nextU32 = () => raw;
        const gap = r.exponential(rate);
        expect(gap > 0 && Number.isFinite(gap)).toBe(true);
      }
    }
  });

  it.each([0, -1, NaN, Infinity])("exponential(%s) throws", (rate) => {
    expect(() => Rng.fromSeed(1).exponential(rate)).toThrow(`rate must be a positive finite number, got ${rate}`);
  });
});

describe("Rng: seeds and labels", () => {
  it.each([0, 1, 187, 4_294_967_295])("accepts seed %i", (seed) => {
    expect(() => Rng.fromSeed(seed)).not.toThrow();
  });

  it.each([-1, 4_294_967_296, 1.5, NaN, Infinity])("rejects seed %s", (seed) => {
    expect(() => Rng.fromSeed(seed)).toThrow(`seed must be an integer in 0..4294967295, got ${seed}`);
  });

  it.each(["", 5, null])("rejects stream label %j", (label) => {
    expect(() => Rng.fromSeed(1).stream(label as string)).toThrow(/stream label must be a non-empty string/);
  });
});
