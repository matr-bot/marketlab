import { ln } from "./detMath";

// Seeded random numbers for the whole simulation (D-017 to D-021). Same seed → same numbers →
// same market, in every browser. Nothing in src/engine may use Math.random (lint-enforced).
//
// Generator: xoshiro128** (Blackman & Vigna, "Scrambled Linear Pseudorandom Number Generators",
// ACM TOMS 2021): four 32-bit state words, period 2^128 − 1. Seeding: SplitMix64 (Steele, Lea &
// Flood, OOPSLA 2014) expands the seed into the state, exactly as the reference C program in
// scripts/reference/xoshiro128ss.c does.

const MASK64 = (1n << 64n) - 1n;
const TWO32 = 4294967296;

/** One SplitMix64 step: advances `state` and returns the next 64-bit output. */
function splitMix64(state: { z: bigint }): bigint {
  state.z = (state.z + 0x9e3779b97f4a7c15n) & MASK64;
  let z = state.z;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return z ^ (z >> 31n);
}

/** 64-bit FNV-1a hash of a string's UTF-16 code units. */
function fnv1a64(text: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(
    /** The user-visible seed this generator belongs to. */
    private readonly seed: number,
    /** Stream path from the root, e.g. ["arrivals", "noise-3"]; empty for the root itself. */
    private readonly labels: readonly string[],
  ) {
    // The root is seeded straight from the seed, exactly as the reference C program does. A
    // stream is seeded from a hash of the seed and its whole path (D-018), so every path gives a
    // different generator and order matters: a/b ≠ b/a, a/a ≠ the root. JSON encoding keeps the
    // path unambiguous whatever characters labels contain ("a/b" as one label ≠ a then b).
    const sm = { z: labels.length === 0 ? BigInt(seed) : fnv1a64(JSON.stringify([seed, ...labels])) };
    const a = splitMix64(sm);
    const b = splitMix64(sm);
    this.s0 = Number(a & 0xffffffffn);
    this.s1 = Number(a >> 32n);
    this.s2 = Number(b & 0xffffffffn);
    this.s3 = Number(b >> 32n);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      throw new Error("Rng invariant broken: all-zero xoshiro state");
    }
  }

  /** A generator for a user-visible seed: an integer 0 … 4,294,967,295 (D-022). */
  static fromSeed(seed: number): Rng {
    if (!Number.isInteger(seed) || seed < 0 || seed >= TWO32) {
      throw new RangeError(`seed must be an integer in 0..4294967295, got ${seed}`);
    }
    return new Rng(seed, []);
  }

  /**
   * An independent named sub-stream (D-018), e.g. `rng.stream("noise-3")`. Its numbers depend
   * only on the seed and the full path of labels from the root, never on how many numbers anyone
   * has drawn, so adding, removing or changing one agent never shifts another agent's numbers.
   */
  stream(label: string): Rng {
    if (typeof label !== "string" || label === "") {
      throw new RangeError(`stream label must be a non-empty string, got ${JSON.stringify(label)}`);
    }
    return new Rng(this.seed, [...this.labels, label]);
  }

  /** The stream's path for display and debugging, e.g. "arrivals/noise-3" ("" for the root). */
  get path(): string {
    return this.labels.join("/");
  }

  /** Next raw 32-bit output, 0 … 2^32 − 1 (xoshiro128**). */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1), in steps of 2^-32. */
  uniform(): number {
    return this.nextU32() / TWO32;
  }

  /**
   * Uniform strictly inside (0, 1): never 0 and never 1, so its logarithm is finite and strictly
   * negative. Uses the midpoint of each of the 2^32 steps: (n + ½) / 2^32.
   */
  uniformOpen(): number {
    return (this.nextU32() + 0.5) / TWO32;
  }

  /** A uniformly random integer in [lo, hi], with no modulo bias (rejection sampling). */
  int(lo: number, hi: number): number {
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo || hi - lo >= TWO32) {
      throw new RangeError(`int(lo, hi) needs safe integers with lo <= hi and hi - lo < 2^32, got ${lo}, ${hi}`);
    }
    const n = hi - lo + 1;
    // Accept only below the largest multiple of n that fits in 32 bits, so every value is equally
    // likely. (For n = 2^32 the limit is 2^32, so nothing is rejected.)
    const limit = TWO32 - (TWO32 % n);
    let r = this.nextU32();
    while (r >= limit) r = this.nextU32();
    return lo + (r % n);
  }

  /**
   * Standard normal (mean 0, variance 1) by Marsaglia's polar method (Marsaglia & Bray 1964):
   * pick a point in the square [-1,1]², keep it if it lands inside the unit circle, then scale.
   * Uses only ln and sqrt, both deterministic. The method yields two values; the second is
   * discarded so the generator's state stays just its four words (simpler snapshots for rewind).
   */
  normal(): number {
    for (;;) {
      const x = 2 * this.uniform() - 1;
      const y = 2 * this.uniform() - 1;
      const s = x * x + y * y;
      if (s > 0 && s < 1) return x * Math.sqrt((-2 * ln(s)) / s);
    }
  }

  /**
   * Exponential waiting time with the given rate (mean 1/rate): −ln(U) / rate with U strictly
   * inside (0, 1), so the result is always finite and strictly positive (never a zero gap).
   */
  exponential(rate: number): number {
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw new RangeError(`rate must be a positive finite number, got ${rate}`);
    }
    return -ln(this.uniformOpen()) / rate;
  }
}
