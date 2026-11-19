import { rng } from "./shadow";

// The detMath fingerprint's inputs (D-091), shared by detMath.test.ts and the cross-browser check
// (src/lib/determinism.ts). Built only from integer bit words and exact IEEE arithmetic, so every
// JavaScript engine produces the same inputs.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

// Builds a double from its high and low 32-bit words.
export const fromWords = (hi: number, lo: number) => {
  u32[1] = hi >>> 0;
  u32[0] = lo >>> 0;
  return f64[0];
};
// 2^k exactly, from its bits (normal or subnormal), never through pow or ** (D-091).
export const pow2 = (k: number) => {
  if (k >= -1022) return fromWords((k + 1023) << 20, 0);
  const bit = k + 1074; // subnormal: a single mantissa bit, 0 … 51
  return bit >= 32 ? fromWords(1 << (bit - 32), 0) : fromWords(0, 1 << bit);
};

// Every input is built from integer bit words and exact IEEE arithmetic (+, −, ×): nothing the
// JavaScript spec leaves implementation-approximated (Math.pow, **, log, exp, trig). A Math.pow
// with a fractional exponent here gave different inputs on Node 24 than on Node 22 (D-091).
export function detMathInputs() {
  const { next, int } = rng(2026);
  const lnIn: number[] = [];
  const expIn: number[] = [];
  for (let i = 0; i < 50_000; i++) lnIn.push(fromWords((int(23, 2023) << 20) | int(0, 0xfffff), int(0, 0xffffffff))); // whole range: 2^-1000 … 2^1001
  for (let i = 0; i < 20_000; i++) lnIn.push(1 + (next() - 0.5) * pow2(-19)); // |x − 1| < 2^-20 fast path
  for (let i = 0; i < 20_000; i++) lnIn.push(1 + (next() - 0.5) * 0.2); // near 1, main path
  for (let i = 0; i < 5_000; i++) lnIn.push(next() * 2.2e-308); // subnormals
  for (let k = -1074; k <= 1023; k++) lnIn.push(pow2(k)); // exact powers of two
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
  for (let i = 0; i < 20_000; i++) expIn.push((next() - 0.5) * pow2(-27)); // |x| < 2^-28
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
