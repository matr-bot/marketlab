// Deterministic math (D-019). The JavaScript spec lets every engine compute Math.log, Math.exp,
// Math.pow, ** and the trig functions slightly differently ("implementation-approximated"), so
// the same seed could produce a different market in Safari than in Chrome. Only + − × ÷,
// Math.sqrt and bit-level access are required to be exact. Everything here is built from those,
// so every browser computes identical bits.
//
// ln and exp are straight ports of fdlibm's e_log.c and e_exp.c (Sun Microsystems, 1993,
// "Freely Distributable LIBM"), which are accurate to under 1 ulp. ESLint forbids the inexact
// Math functions anywhere in src/engine (see eslint.config.mjs).

// Bit access to a double through a shared buffer (little-endian on every platform JS runs on;
// checked at startup).
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
f64[0] = 1;
if (u32[1] !== 0x3ff00000) throw new Error("detMath requires a little-endian platform");

function hiWord(x: number): number {
  f64[0] = x;
  return u32[1] | 0;
}
function loWord(x: number): number {
  f64[0] = x;
  return u32[0];
}
function withHiWord(x: number, hi: number): number {
  f64[0] = x;
  u32[1] = hi;
  return f64[0];
}

const LN2_HI = 6.93147180369123816490e-1; // 0x3fe62e42 fee00000
const LN2_LO = 1.90821492927058770002e-10; // 0x3dea39ef 35793c76
const TWO54 = 1.8014398509481984e16; // 2^54

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/**
 * Natural logarithm, bit-identical in every JavaScript engine.
 * ln(x) for x > 0; ln(0) = −Infinity; ln(negative or NaN) = NaN; ln(Infinity) = Infinity.
 */
export function ln(x: number): number {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022: zero, negative or subnormal
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= TWO54; // scale a subnormal up
    hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x; // Infinity or NaN
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHiWord(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2 into [sqrt(2)/2, sqrt(2))
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
    const r = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - r : k * LN2_HI - (r - k * LN2_LO - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const r = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + r)) : dk * LN2_HI - (hfsq - (s * (hfsq + r) + dk * LN2_LO) - f);
  }
  return k === 0 ? f - s * (f - r) : dk * LN2_HI - (s * (f - r) - dk * LN2_LO - f);
}

const O_THRESHOLD = 7.09782712893383973096e2; // above this exp overflows
const U_THRESHOLD = -7.45133219101941108420e2; // below this exp underflows to 0
const INV_LN2 = 1.44269504088896338700;
const TWOM1000 = 9.33263618503218878990e-302; // 2^-1000
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** e^x, bit-identical in every JavaScript engine. */
export function exp(x: number): number {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1; // sign bit
  hx &= 0x7fffffff; // high word of |x|

  if (hx >= 0x40862e42) {
    // |x| >= 709.78…: overflow, underflow, Infinity or NaN
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0; // exp(+Inf) = Inf, exp(-Inf) = 0
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }

  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2: reduce x = k·ln2 + r
    if (hx < 0x3ff0a2b2) {
      // and |x| < 1.5 ln2
      hi = xsb === 0 ? x - LN2_HI : x + LN2_HI;
      lo = xsb === 0 ? LN2_LO : -LN2_LO;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(INV_LN2 * x + (xsb === 0 ? 0.5 : -0.5));
      hi = x - k * LN2_HI; // exact here
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  }

  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - (lo - (x * c) / (2.0 - c) - hi);
  if (k >= -1021) return withHiWord(y, hiWord(y) + (k << 20)); // y · 2^k
  return withHiWord(y, hiWord(y) + ((k + 1000) << 20)) * TWOM1000;
}

/**
 * x^y for x > 0, computed as exp(y · ln x), so bit-identical everywhere. Relative error grows with
 * |y · ln x| (about that many ulps), which is negligible for the simulation's uses (for example
 * Pareto order sizes, Step 3). Throws for x ≤ 0 or non-finite input: the engine never needs those,
 * so seeing one is a bug.
 */
export function pow(x: number, y: number): number {
  if (!(x > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`pow is defined here only for finite x > 0 and finite y, got x=${x}, y=${y}`);
  }
  if (y === 1) return x; // exact; exp(ln x) could be off by an ulp
  return exp(y * ln(x));
}

/**
 * The smallest double strictly greater than x, for finite x ≥ 0 (exact bit arithmetic). Used to
 * keep event times strictly increasing when a tiny gap would round away at a large time.
 */
export function nextUp(x: number): number {
  if (!(x >= 0) || !Number.isFinite(x)) throw new RangeError(`nextUp needs a finite x >= 0, got ${x}`);
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  if (u32[0] === 0xffffffff) {
    u32[0] = 0;
    u32[1] += 1;
  } else {
    u32[0] += 1;
  }
  return f64[0];
}
