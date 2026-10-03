/*
 * Reference values for src/engine/rng.ts.
 *
 * xoshiro128** and SplitMix64 below are the authors' public-domain reference algorithms
 * (Blackman & Vigna, https://prng.di.unimi.it/xoshiro128starstar.c and splitmix64.c), with the
 * seeding scheme MarketLab uses: the 32-bit seed is the SplitMix64 starting state, and two
 * SplitMix64 outputs fill the four 32-bit state words (low word first).
 *
 * Regenerate:  cc -O2 -o /tmp/xoshiro128ss scripts/reference/xoshiro128ss.c && /tmp/xoshiro128ss
 * The output is pasted into src/engine/rng.test.ts ("matches the reference C implementation").
 */
#include <stdint.h>
#include <stdio.h>

static uint64_t sm_state;
static uint64_t splitmix64(void) {
  uint64_t z = (sm_state += 0x9e3779b97f4a7c15ULL);
  z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
  z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
  return z ^ (z >> 31);
}

static uint32_t s[4];
static inline uint32_t rotl(const uint32_t x, int k) { return (x << k) | (x >> (32 - k)); }
static uint32_t next(void) {
  const uint32_t result = rotl(s[1] * 5, 7) * 9;
  const uint32_t t = s[1] << 9;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result;
}

static void seed_from_u64(uint64_t seed) {
  sm_state = seed;
  uint64_t a = splitmix64(), b = splitmix64();
  s[0] = (uint32_t)a; s[1] = (uint32_t)(a >> 32);
  s[2] = (uint32_t)b; s[3] = (uint32_t)(b >> 32);
}

int main(void) {
  sm_state = 0;
  printf("splitmix64 from state 0:");
  for (int i = 0; i < 3; i++) printf(" %llu", (unsigned long long)splitmix64());
  printf("\n");

  const uint64_t seeds[] = {0, 1, 187, 4294967295ULL};
  for (int k = 0; k < 4; k++) {
    seed_from_u64(seeds[k]);
    printf("seed %llu: state %u %u %u %u | first:", (unsigned long long)seeds[k], s[0], s[1], s[2], s[3]);
    for (int i = 0; i < 8; i++) printf(" %u", next());
    for (int i = 8; i < 999; i++) next();
    printf(" | #1000: %u\n", next());
  }
  return 0;
}
