// Reusable determinism check (test-only). A run is reduced to a 64-bit FNV-1a fingerprint of its
// JSON, so "same seed → identical market" is one comparison, however large the run. Step 3 uses
// it on the full fill log.

const MASK64 = (1n << 64n) - 1n;

/** 64-bit FNV-1a hash of JSON.stringify(value), as 16 hex digits. */
export function fingerprint(value: unknown): string {
  const json = JSON.stringify(value);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < json.length; i++) {
    h ^= BigInt(json.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}
