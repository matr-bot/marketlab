import { describe, expect, it } from "vitest";
import { exp, ln, nextUp, pow } from "./detMath";
import { fingerprint } from "./testing/fingerprint";
import { rng } from "./testing/shadow";

// Bits of a double as a hex string, so golden values pin the exact result.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const bits = (x: number) => {
  f64[0] = x;
  return `0x${u32[1].toString(16).padStart(8, "0")}${u32[0].toString(16).padStart(8, "0")}`;
};
// Distance between two doubles in units in the last place.
const i64 = new BigInt64Array(f64.buffer);
const ulps = (a: number, b: number) => {
  f64[0] = a;
  const x = i64[0];
  f64[0] = b;
  const y = i64[0];
  return Number(x > y ? x - y : y - x);
};

describe("detMath: golden values (exact bits, the same in every browser)", () => {
  // Generated once by this implementation (a straight port of fdlibm) and pinned here, so any
  // change in a later edit, or a platform that computes differently, fails loudly.
  it.each([
    [2, "0x3fe62e42fefa39ef"],
    [10, "0x40026bb1bbb55516"],
    [0.5, "0xbfe62e42fefa39ef"],
    [187.42, "0x4014eef3d9846ccf"],
    [1e-300, "0xc085963447f87fb5"],
    [5e-324, "0xc0874385446d71c3"], // smallest subnormal
    [1.0000001, "0x3e7ad7f2847b6492"], // |x − 1| < 2^-20 path
  ])("ln(%s)", (x, expected) => {
    expect(bits(ln(x))).toBe(expected);
  });

  it.each([
    [1, "0x4005bf0a8b14576a"], // 2.7182818284590455, one ulp above Math.E, as in fdlibm / Java StrictMath
    [-1, "0x3fd78b56362cef38"],
    [0.25, "0x3ff48b5e3c3e8186"],
    [10, "0x40d5829dcf950560"],
    [-700, "0x00d14f2b0fb9307f"],
    [-740, "0x0000000000000055"], // subnormal result
    [1e-10, "0x3ff000000006df38"],
  ])("exp(%s)", (x, expected) => {
    expect(bits(exp(x))).toBe(expected);
  });

  it.each([
    [0.37, -1 / 1.5, "0x3fff0b683e033317"], // a Pareto-style draw
    [2, 0.5, "0x3ff6a09e667f3bcc"],
    [10, 3, "0x408f400000000006"], // 1000.0000000000007: pow is not exact for integers; never use it for exact math
  ])("pow(%s, %s)", (x, y, expected) => {
    expect(bits(pow(x, y))).toBe(expected);
  });
});

describe("detMath: accuracy against the built-in Math functions", () => {
  // Built-ins are only "implementation-approximated", but both they and fdlibm are within 1 ulp
  // of the true value, so they can differ from each other by at most a few ulps.
  it("ln is within 1 ulp of Math.log over 100,000 values spanning the whole double range", () => {
    const { next } = rng(1);
    let worst = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = Math.pow(2, (next() - 0.5) * 2_000) * (1 + next());
      worst = Math.max(worst, ulps(ln(x), Math.log(x)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("ln is within 1 ulp of Math.log near 1 and on subnormals", () => {
    const { next } = rng(2);
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      const near1 = 1 + (next() - 0.5) * 1e-5;
      const sub = next() * 2.2e-308;
      worst = Math.max(worst, ulps(ln(near1), Math.log(near1)));
      if (sub > 0) worst = Math.max(worst, ulps(ln(sub), Math.log(sub)));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("exp is within 1 ulp of Math.exp over 100,000 values from −745 to 709", () => {
    const { next } = rng(3);
    let worst = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = -745 + next() * 1_454;
      const m = Math.exp(x);
      if (m > 2.3e-308) worst = Math.max(worst, ulps(exp(x), m)); // compare normal results
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("exp is within 1 ulp of Math.exp for tiny and medium arguments (every reduction branch)", () => {
    const { next } = rng(4);
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      for (const x of [(next() - 0.5) * 1e-9, (next() - 0.5) * 2, (next() - 0.5) * 60]) {
        worst = Math.max(worst, ulps(exp(x), Math.exp(x)));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("pow agrees with Math.pow to 1e-13 relative error for the simulation's ranges", () => {
    const { next } = rng(5);
    let worst = 0;
    for (let i = 0; i < 50_000; i++) {
      const x = next() * 1_000 + 1e-9;
      const y = (next() - 0.5) * 6;
      worst = Math.max(worst, Math.abs(pow(x, y) / Math.pow(x, y) - 1));
    }
    expect(worst).toBeLessThan(1e-13);
  });

  it("exp(ln x) returns x to within a few ulps", () => {
    const { next } = rng(6);
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      const x = next() * 1e6 + 1e-6;
      worst = Math.max(worst, ulps(exp(ln(x)), x));
    }
    expect(worst).toBeLessThanOrEqual(16);
  });
});

describe("detMath: special values", () => {
  it("ln", () => {
    expect(ln(1)).toBe(0);
    expect(Object.is(ln(1), 0)).toBe(true);
    expect(ln(0)).toBe(-Infinity);
    expect(ln(-0)).toBe(-Infinity);
    expect(ln(-1)).toBeNaN();
    expect(ln(-Infinity)).toBeNaN();
    expect(ln(NaN)).toBeNaN();
    expect(ln(Infinity)).toBe(Infinity);
    expect(ln(Number.MAX_VALUE)).toBe(Math.log(Number.MAX_VALUE));
    expect(ln(4)).toBe(2 * ln(2)); // exact powers of two: k·ln2 path
    expect(ln(2 ** -20)).toBe(-20 * ln(2));
  });

  it("exp", () => {
    expect(exp(0)).toBe(1);
    expect(exp(-0)).toBe(1);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(NaN)).toBeNaN();
    expect(exp(709.78)).toBeLessThan(Infinity);
    expect(exp(709.79)).toBe(Infinity); // overflow threshold
    expect(exp(-745.2)).toBe(0); // underflow threshold
    expect(exp(-745.1)).toBeGreaterThan(0);
    expect(exp(1e-30)).toBe(1); // |x| < 2^-28 path
    expect(exp(1e-9)).toBe(Math.exp(1e-9));
  });

  it("pow", () => {
    expect(pow(5, 0)).toBe(1);
    expect(pow(1, 123.4)).toBe(1);
    expect(pow(7.5, 1)).toBe(7.5);
    expect(pow(4, 0.5)).toBe(2);
    expect(pow(2, -1)).toBe(0.5);
  });

  it.each([
    [0, 2],
    [-2, 2],
    [NaN, 1],
    [Infinity, 1],
    [2, NaN],
    [2, Infinity],
  ])("pow(%s, %s) throws: the engine never needs it, so it is a bug", (x, y) => {
    expect(() => pow(x, y)).toThrow(`pow is defined here only for finite x > 0 and finite y, got x=${x}, y=${y}`);
  });
});

describe("detMath: bit fingerprint over every branch region", () => {
  // Builds a double from its high and low 32-bit words.
  const fromWords = (hi: number, lo: number) => {
    u32[1] = hi >>> 0;
    u32[0] = lo >>> 0;
    return f64[0];
  };

  function inputs() {
    const { next, int } = rng(2026);
    const lnIn: number[] = [];
    const expIn: number[] = [];
    for (let i = 0; i < 50_000; i++) lnIn.push(Math.pow(2, (next() - 0.5) * 2_000) * (1 + next())); // whole range
    for (let i = 0; i < 20_000; i++) lnIn.push(1 + (next() - 0.5) * 2 ** -19); // |x − 1| < 2^-20 fast path
    for (let i = 0; i < 20_000; i++) lnIn.push(1 + (next() - 0.5) * 0.2); // near 1, main path
    for (let i = 0; i < 5_000; i++) lnIn.push(next() * 2.2e-308); // subnormals
    for (let k = -1074; k <= 1023; k++) lnIn.push(2 ** k); // exact powers of two
    for (let i = 0; i < 5_000; i++) lnIn.push(fromWords(0x3ff00000 + int(0, 0xfffff), int(0, 0xffffffff))); // every mantissa top bit pattern in [1, 2)
    lnIn.push(fromWords(0x00100000, 0), fromWords(0x000fffff, 0xffffffff), fromWords(0x7ff00000, 1), fromWords(0x3ff00000, 1));
    // Mantissa top bits at the edges of the |f| < 2^-20 shortcut (hx = 0, 1, 2 and the wrap-around
    // just below 2: 0xffffd … 0xfffff), across several exponents.
    for (const top of [0, 1, 2, 3, 0xffffc, 0xffffd, 0xffffe, 0xfffff]) {
      for (const exponent of [0x3fe, 0x3ff, 0x400, 0x401, 0x3f0, 0x410]) {
        for (let i = 0; i < 50; i++) lnIn.push(fromWords((exponent << 20) | top, i === 0 ? 0 : int(0, 0xffffffff)));
      }
    }

    for (let i = 0; i < 50_000; i++) expIn.push(-745 + next() * 1_454.8); // whole range
    for (let i = 0; i < 20_000; i++) expIn.push((next() - 0.5) * 2 ** -27); // |x| < 2^-28
    for (let i = 0; i < 20_000; i++) expIn.push((next() < 0.5 ? -1 : 1) * (0.34 + next() * 0.72)); // 0.5 ln2 … 1.5 ln2 and around it
    for (let i = 0; i < 20_000; i++) expIn.push((next() - 0.5) * 0.69); // |x| < 0.5 ln2
    for (let i = 0; i < 10_000; i++) expIn.push(-745.2 + next() * 37.5); // subnormal results (k < −1021)
    // Inputs whose high word sits exactly on each branch boundary, both signs, random low words.
    for (const hi of [0x40862e42, 0x3fd62e42, 0x3ff0a2b2, 0x3e300000, 0x7ff00000]) {
      for (let i = 0; i < 200; i++) {
        const lo = i === 0 ? 0 : int(0, 0xffffffff);
        expIn.push(fromWords(hi, lo), fromWords(hi | 0x80000000, lo));
        expIn.push(fromWords(hi - 1, lo), fromWords((hi - 1) | 0x80000000, lo));
      }
    }
    expIn.push(7.09782712893383973096e2, -7.45133219101941108420e2, 709.782712893384, -745.1332191019411);
    return { lnIn, expIn };
  }

  it("ln and exp give exactly the pinned bits for more than 225,000 inputs", () => {
    const { lnIn, expIn } = inputs();
    expect(lnIn.length + expIn.length).toBeGreaterThan(225_000);
    const lnBits = fingerprint(lnIn.map((x) => bits(ln(x))));
    const expBits = fingerprint(expIn.map((x) => bits(exp(x))));
    expect([lnBits, expBits]).toEqual(PINNED);
  });

  it("stays within 1 ulp of the built-ins on those same inputs (where the built-in is finite)", () => {
    const { lnIn, expIn } = inputs();
    let worst = 0;
    for (const x of lnIn) if (x > 0 && Number.isFinite(x)) worst = Math.max(worst, ulps(ln(x), Math.log(x)));
    for (const x of expIn) {
      const m = Math.exp(x);
      if (Number.isFinite(m) && m > 2.3e-308) worst = Math.max(worst, ulps(exp(x), m));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("handles the exact overflow and underflow thresholds", () => {
    expect(Number.isFinite(exp(7.09782712893383973096e2))).toBe(true);
    expect(exp(7.09782712893383973096e2)).toBe(Math.exp(7.09782712893383973096e2));
    expect(exp(-7.45133219101941108420e2)).toBe(5e-324);
    expect(exp(fromWords(0x7ff00000, 1))).toBeNaN(); // NaN whose payload is only in the low word
  });
});

// FNV-1a fingerprints of every result's bits, generated once by this implementation.
const PINNED: string[] = ["f5f6a921c5d58dec", "34d8d8fb92f2678e"];

describe("detMath: nextUp", () => {
  it.each([
    [0, Number.MIN_VALUE],
    [1, 1 + Number.EPSILON],
    [1e9, 1e9 + 2 ** -23],
    [Number.MIN_VALUE, 2 * Number.MIN_VALUE],
  ])("nextUp(%s) = %s", (x, expected) => {
    expect(nextUp(x)).toBe(expected);
  });

  it("carries from the low word into the high word", () => {
    const x = 1 + (2 ** 32 - 1) * 2 ** -52; // low word all ones
    expect(nextUp(x)).toBe(1 + 2 ** 32 * 2 ** -52);
  });

  it("is the very next double: nothing fits between x and nextUp(x)", () => {
    for (const x of [3, 187.42, 1e-300, 1e300]) {
      const up = nextUp(x);
      expect(up).toBeGreaterThan(x);
      expect((x + up) / 2 === x || (x + up) / 2 === up).toBe(true);
    }
  });

  it.each([-1, NaN, Infinity])("throws for %s", (x) => {
    expect(() => nextUp(x)).toThrow(`nextUp needs a finite x >= 0, got ${x}`);
  });
});
