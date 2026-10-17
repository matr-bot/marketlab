# Design decisions

A short record of every real design decision: what we chose, what else we considered, and why.
Newest at the bottom. If a decision is later reversed, add a new entry that supersedes it
rather than editing the old one.

---

## D-001 · Money and prices are integer cents

**Date:** 2026-09-30 · **Status:** Accepted

**Decision.** Every price, cash amount and P&L is an integer number of cents. Quantities are
integer shares. Order size and price are capped (`MAX_ORDER_QTY` = 10,000,000 shares,
`MAX_PRICE_CENTS` = $1,000,000) so that price × quantity always stays an exact integer.

**Alternatives.**
- *Floating-point dollars* (`100.25`). This is the simplest option, but `0.1 + 0.2 !== 0.3`, so
  P&L and slippage would drift by fractions of a cent and wouldn't add up exactly.
- *A decimal library* (decimal.js, big.js). It's exact, but it's slower and every arithmetic
  operation becomes a method call, which matters in an engine running millions of operations.
- *BigInt.* It's exact with no size limit, but it's slower, can't be mixed with ordinary numbers,
  and doesn't serialize to JSON for the worker messages.

**Why.** The glass box promises that every number on screen is exactly what the engine did. That
promise only holds if the arithmetic is exact. Integers are exact up to 2^53, and the caps
guarantee we never get near that limit.

---

## D-002 · Order rejections return reason codes, not exceptions

**Date:** 2026-09-30 · **Status:** Accepted

**Decision.** When the order book refuses an order, it returns
`{ ok: false, reason, message }` with a code (`WOULD_CROSS`, `DUPLICATE_ID`, `OFF_TICK`, …).
Exceptions are reserved for bugs in our own code: `reduce` beyond an order's size, an invalid
`depth` limit, a bad tick size in the constructor.

**Alternatives.**
- *Throw on every rejection.* This was the original Week 1 design. Every caller then needs
  try/catch and has to parse the error message to find out *why* an order was refused.
- *Return `null` or `false`.* Simple, but the caller learns nothing about the reason.

**Why.** Rejections are normal market events. Agents send stale, crossing and badly priced
orders all the time. With reason codes the matching engine and the narrator can branch on data
("Order rejected: would cross the spread"), the compiler checks that every case is handled, and
we avoid paying the cost of exceptions on a hot path.

---

## D-003 · The engine may not import UI code (enforced by lint)

**Date:** 2026-09-30 · **Status:** Accepted

**Decision.** Nothing in `src/engine/` may import React, React DOM, Next.js or UI code, or use
`window`/`document`. An ESLint rule fails `npm run lint` if it does, and a Vitest test
(`boundary.test.ts`) checks that the rule itself keeps working.

**Alternatives.**
- *A convention written in the README.* Easy to break by accident, and nothing would notice.
- *A separate npm package or monorepo workspace for the engine.* Stronger isolation, but too
  much setup for a five-week project.

**Why.** The engine has to run in three places: a Web Worker, Vitest in Node, and the mutation
tester. None of them has a DOM. Keeping the engine pure also makes it easy to show judges:
the simulation is a self-contained, tested library, and the UI only displays what it produces.

---

## D-004 · Test the order book against a naive "shadow" order book

**Date:** 2026-09-30 · **Status:** Accepted

**Decision.** `orderBook.shadow.test.ts` contains a deliberately simple reference order book.
It keeps every order in one flat array and answers each question by filtering and sorting from
scratch. Seeded random sequences of operations (5 seeds × 3,000 steps) run on both books, and
the full observable state is compared after every step. A coverage guard fails the test if any
case (crossing orders, duplicate IDs, invalid orders, fills, cancel-all) happens too rarely, or if
the book stays too small.

**Alternatives.**
- *Hand-written example tests only.* They only check the cases we thought of.
- *Invariant checks* (for example, "level totals equal the sum of their orders"). This was the
  original approach, but it recounted the book using the book's own functions, so a bug shared
  by both would go unnoticed.
- *A property-testing library* (fast-check). Powerful, but it's one more dependency, and the
  shadow model is still the hard part either way.

**Why.** Two independent implementations that agree on thousands of random operations give
much stronger evidence than examples alone. We confirmed it works by planting a bookkeeping bug,
which failed on every seed. Together with mutation testing (98.26%), this lets us tell judges
that any small change to the logic gets caught.

---

## D-005 · The whole simulation runs in the browser, in a Web Worker

**Date:** 2026-09-30 · **Status:** Accepted

**Decision.** The simulation engine runs client-side in a Web Worker. The only server code is the
AI interpret route, which keeps the API key secret. The worker sends one batched snapshot per
animation frame to React, never individual trades.

**Alternatives.**
- *Server-side simulation streaming over WebSockets.* Needs a long-running server (a poor fit
  for Vercel's serverless functions), adds network delay, costs money per user, and the demo
  would fail if conference Wi-Fi did.
- *Run it on the main thread.* Simpler, but a busy simulation tick would freeze the UI and make
  the chart stutter.
- *WebAssembly (Rust).* Faster, but it adds a second language and build chain, and the
  TypeScript engine already handles 4–11 million book operations per second.

**Why.** It costs nothing to host, works offline, has no network lag, and every visitor gets their
own market. Running in a worker keeps the UI at 60fps. Sending batched snapshots instead of
individual trades keeps the messages from the worker to React small and steady however busy
the market gets. Because the engine is deterministic, any run can be reproduced from its seed
on any machine.

---

## D-006 · Separate instruction files: Claude Code builds, Codex reviews

**Date:** 2026-10-01 · **Status:** Accepted (corrected 2026-10-01 after Codex review)

**Decision.**
- `CLAUDE.md` is the builder's guide. It holds the full project context, and at the top the
  Next.js agent-rules block (between `<!-- BEGIN/END:nextjs-agent-rules -->` markers). It does
  not import AGENTS.md.
- `AGENTS.md` is only for Codex. It contains no Next.js markers. It makes Codex a reviewer that
  never modifies files, reads CLAUDE.md and this file for context, and overrides CLAUDE.md's
  builder instructions (plan, build, commit, push) through an explicit precedence line.
- Codex may run `npm test`, `npm run lint` and `npm run typecheck`. These were verified by
  recording every file in the repo before and after a cold run. Nothing tracked changes; the
  only writes are two gitignored caches, `node_modules/.vite/vitest/<hash>/results.json` and
  `tsconfig.tsbuildinfo`. For a read-only sandbox, `npx vitest run --no-cache` and
  `npx tsc --noEmit --incremental false` write nothing (also verified).
- `src/agentFiles.test.ts` fails if AGENTS.md gains the Next.js markers or loses its
  precedence line, or if CLAUDE.md imports AGENTS.md or loses the markers.

**Alternatives.**
- *Add the reviewer instructions to the existing AGENTS.md.* CLAUDE.md imported AGENTS.md, so the
  builder would also have been told "you are the reviewer, never modify files."
- *One shared file for both tools.* That would mix builder and reviewer roles.
- *Tell Codex not to run any commands.* Safest, but a reviewer that can't run the tests can't
  confirm a suspected bug.

**Why.** A second model reviewing the work gives an independent check, like the shadow book does
for the code, but only if the roles stay separate.

How Next.js maintains the block (from `node_modules/next/dist/server/lib/generate-agent-files.js`,
confirmed by running its `writeAgentFiles` on copies of both files):
- It writes to AGENTS.md if AGENTS.md contains the block, or if CLAUDE.md does not. Otherwise it
  writes to CLAUDE.md. With today's files the result is "AGENTS.md skipped, CLAUDE.md unchanged".
- In the file it writes to, it first deletes any block between the *legacy* markers
  `<!-- NEXT-AGENTS-MD-START -->` / `<!-- NEXT-AGENTS-MD-END -->`, along with the whitespace
  around it (`stripLegacyAgentRulesBlock`). It then replaces the text between the current
  `BEGIN/END:nextjs-agent-rules` markers, or appends a fresh block at the end of the file.
  Apart from those two marked regions, it does not delete anything. Neither file contains the
  legacy markers, and the guard test fails if either one ever does.
- So even if the block were removed from CLAUDE.md and Next appended one to AGENTS.md, the
  reviewer rules would survive. The guard test would flag that state so it can be fixed.

---

## D-007 · A market order's unfilled part is cancelled, never rested

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** A market order trades through as many price levels as it needs. If the opposite
side runs out, whatever is left is cancelled and reported as `cancelledQty`. It never rests in
the book. (Limit orders do rest their remainder, at their limit price.)

**Alternatives.**
- *Rest the remainder at the last fill price.* That turns a market order into a hidden limit
  order the user never asked for.
- *Turn the remainder into a limit order at some offset.* An arbitrary rule that would be hard to
  explain in the glass box.

**Why.** This matches how real market orders behave (immediate-or-cancel), and the execution
report can say exactly "you asked for 30, got 20, 10 cancelled: there was no one left to sell."

---

## D-008 · Self-trade prevention: cancel the resting order

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** If an incoming order would trade with a resting order from the same owner, the
engine cancels the resting order (reported in `selfTradeCancelled`) and keeps matching against
everyone else. No fill ever has the same owner on both sides.

**Alternatives.**
- *Cancel the incoming order.* This penalizes the owner's newest intent and leaves their stale
  quote in the book.
- *Allow self-trades.* That creates fake volume and fake price prints, which would corrupt
  attribution ("who moved the price?") and the realism statistics.

**Why.** When an agent trades against its own quote, the quote is almost always stale. A market
maker repricing is the typical case. Real exchanges offer this rule ("cancel resting" self-trade
prevention), and it keeps every printed trade a genuine trade between two different traders.

---

## D-009 · Every order carries its agent type

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** `agentType` (`noise`, `marketMaker`, `momentum`, `value`, `panic`, `whale`, `user`)
is a required, validated field on every order. Resting orders keep it, and every fill copies it
for both sides. All seven types are defined now, so later agents don't change the fill format.

**Alternatives.**
- *A separate owner → agent-type registry looked up when a fill happens.* This is less data per
  order, but the lookup can fail or get out of sync, and attribution would then be wrong.

**Why.** "Who moved the price?" must be exact and computed from logged fills. With the type on
the order, no fill can be missing its attribution.

---

## D-010 · Slippage is measured against the arrival mid (implementation shortfall)

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** When an order arrives, the engine records an `ArrivalQuote`: best `bid`, best `ask`,
the mid price, and the `touch` (best opposite price: the ask for a buy, the bid for a sell). Each
fill carries, for both parties, the arrival quote and the order's `limitPrice` (its worst
acceptable price; `null` for a market order; for a resting order, its price). If a side is empty
at arrival it is recorded as `null`, and anything that depends on it (the mid, or a touch on that
side) is `null` too.

**"Intended price" means the arrival mid**, everywhere: in CLAUDE.md, the README, the execution
report and the glass box. The limit price is recorded separately because it answers a different
question ("how bad a price would this trader accept?"), not "what did slippage cost?".

Slippage is implementation shortfall against the mid, and splits exactly into two parts. For a
buy of Q shares with fills (pᵢ, qᵢ):
- shortfall = Σ pᵢqᵢ − mid·Q
- spread cost = (touch − mid)·Q, the cost of crossing from the mid to the best price
- impact cost = Σ pᵢqᵢ − touch·Q, the cost of eating deeper into the book
- shortfall = spread cost + impact cost (signs flip for a sell)

**How the mid stays an integer.** It's stored doubled as `midX2 = bid + ask`, so a half-cent mid
(bid 100, ask 101 → 100.5) is the exact integer 201. All slippage math is done in half-cents and
divided by two only for display. Example tested in `matchingEngine.test.ts`: buying 12 against
bid 99 and ask 100 gives shortfall 17¢, made of 6¢ spread cost and 11¢ impact cost.

**Alternatives.**
- *Measure only against the touch.* Simpler, but it hides the spread cost, which is exactly what
  beginners pay without noticing.
- *Store the mid as a float.* Exact in practice for half-cents, but it breaks the integer-cents rule
  (D-001), and later sums would not be exact.

**Why.** Implementation shortfall is the professional standard (Perold, 1988). Splitting it into
spread cost and impact cost teaches the two lessons separately: crossing the spread costs money,
and trading big moves the price against you.

---

## D-011 · A market order into an empty side is rejected with `NO_LIQUIDITY`

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** If the opposite side is empty when a market order arrives, it is rejected with
reason `NO_LIQUIDITY` and nothing changes. If there was liquidity on arrival but all of it
belonged to the submitter (and so was cancelled by D-008), the order is accepted with zero fills
and its whole quantity cancelled.

**Alternatives.**
- *Accept with zero fills.* Technically fine, but an empty-book market order is a distinct event
  worth naming.

**Why.** A reason code lets the narrator and the UI say what happened ("No sellers: the order
could not trade") instead of showing an empty fill list.

---

## D-012 · No price protection on market orders (for now)

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** Market orders have no price band. A large market sell into a thin book can sweep
many levels down.

**Alternatives.**
- *A fixed band* (for example, never fill more than 10% from the arrival price). Safer, but it
  would hide exactly the behavior the crash scenarios are meant to show.

**Why.** Liquidity spirals and flash crashes (the 2010 whale scenario) are a core teaching goal,
and they only happen when orders can sweep a thin book. **Planned:** circuit breakers and price
bands (limit up / limit down, trading halts) as a future scenario setting. That would let a
student run the same crash with and without them, which is a natural what-if experiment.

---

## D-013 · The engine is the only writer and keeps arrival quotes beside the book

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** `MatchingEngine` owns its `OrderBook` privately and exposes `book`: a separate,
frozen `BookView` object holding only query functions (best prices, depth, queues, lookups). It is
not the OrderBook itself, so not even a type cast can reach `add`, `cancel` or `reduce`. Every
change (submit, cancel, cancel-all) goes through the engine. Fill records, their parties and
arrival quotes are frozen, and `engine.fills` returns a copy, so no caller can rewrite history. The engine keeps
each resting order's arrival quote in a map and removes it the moment the order leaves the book,
whether by fill, cancel, cancel-all or self-trade prevention. Tests check after every random step
that the map holds exactly the orders in the book.

**Alternatives.**
- *Expose the OrderBook typed as a read-only interface.* This was the first version. TypeScript
  hides the write methods, but a cast still reaches them at runtime (found in Codex review).
- *Store the arrival quote on the book's resting orders.* No map to keep in sync, but it adds a
  matching-engine concept to the order book and changes its API for everyone.
- *Keep the arrival quote of every order ever submitted.* Memory would grow without bound over a
  long session.

**Why.** The order book stays a pure price-time data structure, memory stays proportional to
the book, and the "no leak, no gap" invariant is tested directly.

**Trade-offs measured.**
- Moving validation into one shared function used by both the book and the engine, and adding
  agent types, made plain book operations about 20% slower (measured back to back against the
  previous commit: about 5.4M → 4.3M operations per second). We kept one validator rather than
  two copies that could drift apart.
- Freezing fill records costs about 6% of engine throughput (1.66M → 1.56M operations per
  second, measured back to back).
- The engine benchmark (limit, market and cancel mix, about 33,000 fills per 100,000 operations)
  runs at about 1.56M operations per second, so a busy 1,000-operation tick costs about 0.64 ms.
  That is well within a 16 ms frame.

---

## D-014 · The engine assigns order ids from a counter; ids are never reused

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** Callers no longer supply an order id. Each market numbers the orders it accepts:
`SPY-1`, `SPY-2`, `SPY-3`, … The id comes back in the submit result, and agents use it to cancel.
Rejected orders do not use up a number. Because the counter only goes up, an id is never reused,
even after its order fills or is cancelled.

**Alternatives.**
- *Caller-chosen ids, unique only among resting orders* (the Week 1 rule). Then one id could appear
  in the fill log for two different orders over time, which makes the history ambiguous.
- *Remember every id ever submitted and reject repeats.* That is unique too, but it needs a set
  that grows forever and gives callers one more way to be rejected.
- *Random ids (UUIDs).* Unique, but they would break determinism unless drawn from the seeded RNG,
  and they are unreadable in the glass box and the tape.

**Why.** The fill log is history, and every id in it must refer to exactly one order. A counter
guarantees that for free, is deterministic (same seed, same ids), and gives readable ids. The
ticker prefix keeps ids unique across markets in the registry.

---

## D-015 · The fill log will be capped and snapshotted when rewind is built

**Date:** 2026-10-02 · **Status:** Planned (Week 5, with rewind)

**Decision (planned).** Today the fill log is an in-memory array that grows for the whole session.
That is fine for a demo session. Measured: about 450 bytes of heap per fill in the worst case,
where every fill comes from a different pair of orders (100,000 fills ≈ 45 MB). Fills from one
sweeping order share that order's records, so they cost less.
When rewind is built (Week 5), the log gets an upper limit:
- **Periodic snapshots** of engine state (book, arrival quotes, counters, RNG state), as
  CLAUDE.md's rewind design already calls for.
- **A cap on the log.** Fills older than the retained window are folded into per-interval
  aggregates (candles and per-agent-type volume for "who moved the price?") before they are
  dropped, so charts and attribution stay exact for the whole session.
- **Rewind** restores the nearest snapshot and re-simulates deterministically to the chosen moment,
  regenerating any dropped fills exactly.

**Alternatives.**
- *Cap the log now.* Premature: the snapshot format depends on the agents and the clock (Steps 2–3),
  which don't exist yet.
- *Never cap it.* A long classroom session with a busy market could grow without bound.

**Why.** Determinism means old fills can always be regenerated from a snapshot, so they don't need
to stay in memory. The aggregates keep every on-screen number exact without them.


---

## D-016 · A terminal-style design system: amber, keyboard first, no "live" badges

**Date:** 2026-10-02 · **Status:** Accepted (spec; the UI ships week by week from Week 2 Step 8,
per the table in CLAUDE.md "Design System")

**Decision.** MarketLab looks like a professional trading terminal: a pure black background, amber
labels and headers, white numbers, and green/red only for price direction. It uses a dense
monospace grid of numbered panels opened by function codes (`SPY GP`, `BOOK`, `TAPE`, …) from a
command bar, with a scrolling trade ticker and a color-coded shortcut strip. In Learn mode each
panel says what it is called on a professional terminal and what traders use it for. It never
uses a real company's name, logo or exact screens. Full spec in CLAUDE.md, "Design System".

**Why amber over green.** On real trading terminals amber is the color of the interface (labels,
headers, text) and green/red are reserved for meaning: up or down. If the interface itself is
green (as in the Week 1 neon-green shell), a student can't tell decoration from a price going
up. Keeping green and red for direction only means every green or red pixel on screen tells the
student something true about the market. The one named exception is the shortcut strip's
GO/cancel keys, as on real terminal keyboards.

**Why no LIVE badge.** A pulsing "LIVE" dot is decoration that claims activity instead of showing
it, and it is a recognizable tell of generic AI-built dashboards. Real terminals show that a
market is live by numbers changing, the tape printing and the ticker moving. Our numbers change
only when the engine trades, so the screen proves it is live on its own. The only status label is
REPLAY during rewind, because then the screen is *not* showing live state and the user must know.

**Why keyboard first with function codes.** Professionals drive terminals by typing codes, not by
hunting through menus, and the codes become muscle memory that transfers to a trading desk. It
also suits the demo: a judge types `SPY GP` or a headline and sees the result instantly. The mouse
still works, so a first-time user is never stuck.

**Why Learn mode names each panel's real-world equivalent.** The product promise is "learn how
markets really work, the way traders and quants see them." The note on each panel ("On a
professional terminal, this is called ___. Traders use it to ___.") turns every panel into a
lesson that carries over to a real job, which is the reason a student or professor would choose
MarketLab over a toy simulator.

**Alternatives.**
- *A modern web-app dashboard* (cards, rounded corners, charts with gradients). Friendlier at
  first sight, but it teaches nothing about real tools and looks like every AI-generated demo.
- *A faithful copy of a specific commercial terminal.* That would be the most realistic, but it
  is not ours to copy, and the contest rules and good practice both rule it out.
- *Keep the Week 1 neon-green look.* Its green was decoration, which clashes with green meaning
  "price up".

**Consequences.**
- Only prices flash green or red (up or down versus the previous price). Other changing numbers
  get a brief neutral highlight. Nothing slides or counts up; smooth motion is allowed only in the
  scrolling ticker.
- The default layout keeps the demo story's flow (chart largest, crowd and desk chat beside it,
  the user's desk on the right), so the 90-second demo needs no panel switching.
- Every market number on screen comes from engine state. UI values such as the seed, the sim
  clock and panel numbers are not market numbers.
- The `ASK` function must not let the AI invent numbers: the AI only picks a query from a fixed
  menu (the AskQuery schema in CLAUDE.md), and our code computes and writes every number.

---

## D-017 · Random numbers come from xoshiro128\*\*, seeded by SplitMix64

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** All randomness in the engine comes from `Rng` (`src/engine/rng.ts`). It uses the
xoshiro128\*\* generator (Blackman & Vigna, "Scrambled Linear Pseudorandom Number Generators,"
*ACM TOMS* 2021): four 32-bit state words, period 2¹²⁸ − 1, passes the standard statistical test
batteries, and uses only 32-bit operations, which JavaScript does quickly (`Math.imul`, shifts).
The seed is expanded into the state by SplitMix64 (Steele, Lea & Flood, OOPSLA 2014), using
BigInt once per stream. `tsconfig` targets ES2020 for BigInt literals; every browser Next.js
supports has had BigInt since 2020.

**How we know it is right.** `scripts/reference/xoshiro128ss.c` is the authors' reference code
plus our seeding scheme. Compiled and run locally, its output is pasted into `rng.test.ts`, and
our TypeScript must match it exactly: state words, the first 8 outputs and the 1,000th, for 4 seeds.

**Alternatives.**
- *mulberry32.* Tiny, but its sequence repeats after 2³² ≈ 4.3 billion numbers, which a long, busy
  session could actually use up, and it fails some statistical tests.
- *sfc32.* Fine, but less studied.
- *PCG32.* Excellent, but needs 64-bit multiplication, which is slow in JavaScript.
- *`Math.random`.* Cannot be seeded, so no reruns or reproducible demos.

---

## D-018 · Every agent draws from its own named random stream

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** `rng.stream("noise-3")` returns an independent generator. Streams can be nested
(`root.stream("arrivals").stream("noise-3")`, path `arrivals/noise-3`). A stream is seeded by
SplitMix64 from a 64-bit FNV-1a hash of the seed and its **whole path**, encoded as JSON
(`[187, "arrivals", "noise-3"]`). So:
- every distinct path gives a different generator, and order matters (`a/b` ≠ `b/a`);
- a stream never equals its parent or the root (`a/a` ≠ root);
- a label containing "/" is not confused with a nested path;
- a stream depends only on the seed and its path, never on how many numbers anyone has drawn.
The root itself is seeded straight from the seed, exactly as the reference C program does. The
arrival scheduler gives each source the stream `arrivals/<id>`.

**Correction (Codex review).** The first version derived a stream's seed by XOR:
`rootSeed ⊕ hash(label)`. Because XOR cancels itself, `stream("a").stream("a")` was *exactly the
root generator*, and `a/b` equalled `b/a`, so streams could silently share numbers. Hashing the
full path fixes both; tests check nested, reordered, repeated and look-alike paths all differ.
The remaining risk is a 64-bit hash collision between two paths, about 1 in 10¹⁹ per pair.

**Alternatives.**
- *One shared stream for everything.* If a what-if changes one agent (say, the market maker's risk
  aversion), that agent draws a different number of random numbers, and every later draw by every
  other agent shifts. The rerun then differs everywhere instead of only where the change matters,
  which defeats the point of a what-if.
- *xoshiro's jump function to split streams.* Guarantees non-overlap, but the streams then depend
  on the order they are created in, which is fragile.
- *XOR of the seed and a label hash.* The first version; it aliases (see the correction above).

**Why.** "Change one variable and rerun" is a core feature, so randomness must be stable per agent.
Tested: adding a whale stream that draws 1,000 numbers leaves the noise trader's numbers
unchanged; adding an arrival source leaves other sources' arrival times unchanged.

---

## D-019 · Deterministic math in the engine, enforced by lint

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** Engine code computes `ln`, `exp` and `pow` with `src/engine/detMath.ts`, never with
`Math.log`, `Math.exp`, `Math.pow`, `**` or the trig and hyperbolic functions. `ln` and `exp` are
straight ports of fdlibm's `e_log.c` and `e_exp.c` (Sun Microsystems, 1993), built only from
+ − × ÷ and bit access through typed arrays. `pow(x, y)` is `exp(y · ln x)` for x > 0; it is for
things like Pareto order sizes (Step 3), not exact math (`pow(10, 3)` is 1000.0000000000007).

**Enforced in two layers.**
1. **ESLint, in engine source** (tests and benchmarks are exempt):
   - Any reference to `Math` is an error unless it is `Math.<member>` written out directly with an
     exact member: `sqrt`, `abs`, `floor`, `ceil`, `trunc`, `round`, `min`, `max`, `imul`, `sign`,
     `fround`, `clz32`. This blocks `Math.log`, `Math["log"]`, `const m = Math`,
     `const { log } = Math`, `f(Math)`, `(0, Math).log`, `Reflect.get(Math, …)`, `Math?.log` …
   - `Date`, `performance`, `crypto`, `globalThis`, `self` and `global` may not be referenced at
     all, which catches aliases too. `**`, `**=`, `eval`, `new Function` and string timers are blocked.
   - `boundary.test.ts` tests the rule against every bypass above, and that UI code is unaffected.
2. **A runtime backstop** (`determinism.test.ts`) replaces every banned global (the inexact `Math`
   functions, `Math.random`, `Date`, `performance.now`, `crypto.getRandomValues`) with a stub that
   throws, reruns the engine's full random workloads (the order book and matching engine shadow
   workloads for all 5 seeds, plus a workload exercising every random distribution, `detMath`,
   the clock and the scheduler), and requires an identical result to a normal run. Static analysis
   cannot see code that builds names at runtime; this can. Verified by planting
   `Function.prototype.constructor("return this")()["Ma" + "th"]["lo" + "g"]` in `rng.normal()`:
   it passes lint and fails the backstop. (`**` cannot be stubbed at runtime; lint covers it.)

**Correction (Codex review).** The first version of the rule only matched `Math.log` written
literally, so `globalThis.Math.log(x)`, `const m = Math; m.log(x)` and `const { log } = Math` got
past it, and "lint-enforced" overstated the guarantee. Both layers above replace it.

**Integer money stays integer.** Prices, quantities and cash are integer cents and shares
(D-001). `ln`, `exp` and `pow` return non-integers, so:
- the price and cash files (`orderBook.ts`, `matchingEngine.ts`, `validation.ts`,
  `marketRegistry.ts`, `types.ts`) may not import `detMath` (ESLint);
- every order is validated at the boundary: a non-integer price or quantity is rejected
  (`INVALID_PRICE`, `INVALID_QTY`), never rounded silently;
- the engine's random workload checks that every fill's price, size and price × size are exact
  integers after every order;
- agents that compute a price from floating-point math (Step 3 on) must convert it with one
  explicit round-to-tick step before submitting; that conversion is the only place a float
  becomes a price.

**Why.** The JavaScript spec calls `Math.log`, `Math.exp`, `Math.pow`, `**` and the trig
functions "implementation-approximated": each engine may return slightly different last bits.
Chrome's V8, Safari's JavaScriptCore and Firefox's SpiderMonkey use different math libraries, so
the same seed could produce a *different market* in Safari than in Chrome, and a judge on a Mac
would not see the rehearsed demo. Only + − × ÷ and `Math.sqrt` are required to be exact.

**How we know it is right.**
- **Accuracy:** within 1 ulp of Chrome's built-ins over more than 225,000 inputs covering every
  branch of both algorithms, including the exact branch boundaries and subnormals. (`exp(1)` is
  one ulp above `Math.E`, the same as fdlibm and Java's `StrictMath`.)
- **Exact bits:** a fingerprint of every result's bits over those inputs is pinned, plus golden
  values for named inputs. A change of a single coefficient in the 6th digit, which stays within
  1 ulp, is caught only by the fingerprint.

**Alternatives.**
- *Use `Math.log` and accept per-browser markets.* Determinism would hold only within one browser.
- *Avoid logarithms entirely.* Not possible: exponential waiting times and normal draws need them.

---

## D-020 · Normal random numbers by Marsaglia's polar method

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** `rng.normal()` uses the polar method (Marsaglia & Bray, *SIAM Review* 1964). Pick a
point uniformly in the square [−1, 1]², keep it if it lies inside the unit circle
(0 < s = x² + y² < 1), and return `x · √(−2 ln s / s)`. The method yields two independent values;
we discard the second so the generator's whole state stays its four words, which keeps snapshots
for rewind simple.

**Alternatives.**
- *Box–Muller.* Needs `cos`, another browser-dependent function.
- *Ziggurat.* Faster, but it needs large lookup tables and is harder to verify.

**Why.** It needs only `ln` and `sqrt`, both deterministic here. Tested: mean 0, variance 1, skew 0
and kurtosis 3 on 1,000,000 draws for 5 seeds, and a Kolmogorov–Smirnov test against the bell curve.
Fat tails in the market must come from the agents' behavior, not from the random numbers.

---

## D-021 · Sim time: 100 ms ticks, Poisson arrivals with exact millisecond timestamps

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.**
- **Clock (`simClock.ts`):** integer milliseconds since the 09:30:00.000 open, advanced in fixed
  ticks of 100 ms. Tick k covers the half-open window [100k, 100k + 100), so an event exactly on a
  boundary belongs to exactly one tick. The engine never reads the wall clock; how fast ticks play
  on screen (1x, 4x) is the worker's job (Step 7).
- **Arrivals (`arrivals.ts`):** each order source is a Poisson process. Gaps between its orders
  are exponential, `Δ = −ln(U) / λ`, with U strictly inside (0, 1), so every gap is finite and
  strictly positive. Arrivals keep their exact time for ordering and get the timestamp ⌊t⌋ ms.
  Ties on exact time go to the source registered first.
- **Strictly increasing per source:** if a gap is smaller than the spacing between doubles at the
  current time (very high rates late in a session), the next representable time is used instead,
  so a source's time always moves forward.
- **Changing rates:** `setRate` changes a source's rate from a given time on by redrawing its
  pending gap. That is exact for a piecewise-constant rate because exponential gaps are memoryless
  (cf. Lewis & Shedler 1979). It is the hook for Week 3's bursts.

**Correction (Codex review).** The first version drew U from (0, 1], so U = 1 gave a gap of exactly
0 and two arrivals at the same instant. Worse, at very high rates a tiny gap can round away when
added to a large time; then a source's time never advances and `drain` loops forever. Removing the
new guard makes the high-rate test crash the test worker out of memory, which is how we know the
guard is load-bearing. Both are fixed and tested.

**Alternatives.**
- *1-second ticks.* Too coarse: bursts within a second would disappear.
- *Fully event-driven with no ticks.* Purer, but harder to batch into one snapshot per frame (Step 7).
- *A fixed number of orders per tick.* That is the steady rhythm we must avoid.

**Why.** Real order flow is irregular. Even plain Poisson arrivals clump: the pinned schedule for
seed 187 has orders at 1866, 1883 and 1888 ms, then a gap. Exact millisecond timestamps keep the
tape and ticker honest about when each trade happened. Tested: count per second has mean =
variance = λ, gaps have standard deviation = mean, ticked and unticked draining give identical
schedules, and rate changes take effect exactly at the change time.

---

## D-022 · The seed is a whole number from 0 to 4,294,967,295; the demo seed is 187

**Date:** 2026-10-02 · **Status:** Accepted

**Decision.** The user-visible seed is an unsigned 32-bit integer, always shown in the status bar
(D-016). The demo seed is `187`, matching the stock's ~$187 starting price, which makes it easy to
say on stage. `Rng.fromSeed` rejects anything else with a clear error.

**Alternatives.**
- *A text seed* ("fed-hike-demo"). Friendlier, but it needs a hashing step that is one more thing
  to explain and test.
- *A 64-bit seed.* More seeds than anyone needs, and awkward to type and to represent exactly in
  JavaScript.

**Why.** A short number is easy to read aloud, type and share ("try seed 4021"), and 4.3 billion
seeds are plenty.

---

## D-023 · Agents act at their own random arrival times, through a context, with separate streams

**Date:** 2026-10-03 · **Status:** Accepted (replaces CLAUDE.md's original `onTick(marketState, rng) → Order[]`)

**Decision.**
- An agent acts only when its Poisson arrival comes up (D-021), never every tick.
- `act(ctx)` receives the arrival time, a read-only book view, the last trade price, the opening
  price and the agent's own resting orders, and may call `submit` and `cancel`. Orders execute
  immediately, so the next agent sees the market the previous one left.
- The simulation stamps the agent's owner id and agent type on every order, and refuses to
  cancel anyone else's order (`UNKNOWN_ORDER`), so an agent cannot act as another.
- Each agent has two random streams: `arrivals/<id>` for *when* it acts and `decisions/<id>`
  for *what* it does. A what-if that changes how an agent decides never moves anyone's arrival
  times. Tested: changing noise-3's behavior changes the market but leaves all 12,000+ arrivals
  at exactly the same times; adding a trader leaves the others' arrival times unchanged.

**Alternatives.**
- *Act every tick (`onTick`).* That gives every agent a steady 100 ms rhythm, the opposite of
  real order flow (D-016's "uneven bursts").
- *Return a list of orders.* Then an agent can't learn its new order ids, so it can't cancel later.
- *One stream per agent for both timing and decisions.* A behavior change would shift timing too.

---

## D-024 · Noise traders price limit orders around the mid: δ = μ·E − θ

**Date:** 2026-10-03 · **Status:** Accepted

**Decision.** The reference price is the mid, or the last trade if a side is empty, or the opening
price ($187.00) before any trade. A buy is placed at `toTick(m − δ, down)` and a sell at
`toTick(m + δ, up)`, with `δ = μ·E − θ`, `E ~ Exp(1)`, `μ = 8¢`, `θ = 2¢`. So
`P(δ < 0) = 1 − e^(−θ/μ) ≈ 22%` of limits land at or through the mid (aggressive; they may trade
immediately) and the rest rest a few cents away (mean δ = 6¢). Market orders are 10% of orders.

**Sources.** Zero-intelligence traders: Gode & Sunder (1993); placement relative to the best prices
and Poisson cancellation: Smith, Farmer, Gillemot & Krishnamurthy (2003), Farmer, Patelli & Zovko
(2005); limit orders cluster near the best prices: Bouchaud, Mézard & Potters (2002).

**Alternatives.** A fixed offset (every order at the same distance, unrealistic); uniform within a
band (no clustering near the mid).

---

## D-025 · Noise order sizes: capped Pareto, with a much smaller cap for market orders

**Date:** 2026-10-03 · **Status:** Accepted

**Decision.** Sizes are `min(cap, ⌊100 · U^(−1/1.5)⌋)` shares: Pareto with tail exponent α = 1.5
(share volume's empirical tail, Gopikrishnan, Plerou, Gabaix & Stanley 2000), minimum 100.
- **Limit orders:** capped at 25,000 shares.
- **Market orders:** capped at **2,000 shares**. Huge sweeps belong to the Week 3 whale and panic
  agents, not to background noise.

**Evidence (seed 187, one sim-hour, 40 traders at 0.5 arrivals/s).**

| | Market cap 25,000 | **Market cap 2,000** |
|---|---|---|
| Either book side empty | 0% of ticks | 0% of ticks |
| Average / median spread | 1.46¢ / 1¢ | 1.43¢ / 1¢ |
| Average orders resting per side | 52.5 / 52.7 | 52.6 / 53.2 |
| Largest price span within one order | **38¢** | **10¢** |
| Largest mid move from one order | 7¢ | 3.5¢ |
| Orders sweeping more than 3 price levels | 84 | 59 |
| Price range over the hour | $186.74–$187.29 | $186.74–$187.13 |
| Market orders over 2,000 shares | 57 | 0 |

The feared failure, a side wiped out, did not happen: 40 traders keep about 52 orders on each
side. But the uncapped tail produced the hour's extremes: one noise order swept 38¢, nearly 4× any
other. A 2,000 cap removes that while leaving depth, spread and volume essentially unchanged; a
1,000 cap gained little more. These are sanity checks, not realism claims; realism tuning is Week 3.

**Testing note.** Tail exponent: the Hill (1975) estimator on 500,000 uncapped draws is within
0.06 of 1.5 (about 4 standard errors). Estimating on capped sizes with the capped values dropped
biases it upward (1.66 versus 1.58 on one sample), so the trader's own sizes are checked through
tail probabilities instead: P(q > 1,000) ≈ 3.2%, P(q > 5,000) ≈ 0.28%.

---

## D-026 · Cancellations: a random own order, chosen from an explicitly ordered list

**Date:** 2026-10-03 · **Status:** Accepted

**Decision.** On each arrival, a noise trader with resting orders cancels one of them with
probability 35%, chosen uniformly from its orders **sorted oldest first by the book's sequence
number** (`oldestFirst`). Otherwise it places an order, first cancelling its oldest if it already
has 5 resting.

**Why the explicit sort.** The choice "pick the 3rd order" is only deterministic if the list order
is. Today the book happens to return an owner's orders oldest first (an insertion-ordered `Map`),
but relying on a container's iteration order is fragile. Sorting by sequence number makes the order
part of the contract. Engine ids would sort wrongly as text ("SPY-12" < "SPY-9"). Tested: the same
seed gives the same choice when the book lists the orders shuffled. Planting the bug (using the
book's order directly) leaves the pinned demo market unchanged, so only that test catches it.

**Alternatives.** Timed expiry (needs a timer per order); always cancel the oldest (then orders
never get lucky and stay, which thins the book unrealistically).

---

## D-027 · `toTick`: the only place a computed price becomes cents

**Date:** 2026-10-03 · **Status:** Accepted

**Decision.** Agents compute prices with floating-point math (a half-cent mid, an exponential
offset). They convert them to cents only with `toTick(x, tick, "down" | "up")`. Buys round **down**
and sells round **up**, so rounding never makes an order more aggressive than the trader intended.
The result is clamped to [one tick, the highest tick within the price cap] and is always an exact
integer. `price.ts` is one of the integer-money files that may not import `detMath` (D-019).

**Correction (Codex review).** The clamp computed the highest valid tick as
⌊MAX_PRICE_CENTS / tick⌋, which is 0 for a tick larger than the price cap, so `toTick` could return
0, not a valid price. The order book now rejects such a tick size in its constructor, and `toTick`
keeps its own guard (it throws rather than return 0); both are tested.

**Alternatives.** Rounding inside each agent: scattered, easy to get wrong (round-to-nearest would
let a buy pay up to half a tick more than it meant).

---

## D-028 · Mutation runs leave out whole-market workloads (they still run on every commit)

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** Stryker uses its own Vitest config, `vitest.stryker.config.mts`, which:
- excludes `determinism.test.ts` (the runtime backstop reruns every random workload twice with the
  banned globals stubbed, so it touches nearly every engine line);
- sets `MARKETLAB_MUTATION=1`, so the one-hour whole-market tests in `simulation.test.ts`
  (invariants and conservation over an hour, the sanity-band report, the speed check) skip
  themselves. Their hour-long runs moved into `beforeAll`, so a skipped block runs nothing.

Everything still runs in the normal suite (`npm test`) on every commit; only mutation runs change.
Per-test coverage analysis (`coverageAnalysis: "perTest"`) was already on, so each mutant only
reruns the tests that touch it. That is exactly why the backstop was so expensive: it touches
almost every mutant. The full mutation suite now runs once per step, right before committing.

**Measured on the same code (Step 3, 1,189 mutants):**

| | Before | After |
| --- | --- | --- |
| Wall time | about 23 minutes | **6 min 31 s** |
| Mutation score | 97.22% | **97.22%** |
| Killed / timed out | 1,073 / 83 | 1,109 / 47 |

Two mutants went from "timed out" to "survived": the little-endian startup check in `detMath`
(can never fire) and an `ln` branch boundary already shown to give bit-identical results. They
only timed out because the backstop made every run slow, and Stryker counts timeouts as caught;
their true status is "equivalent". Three went the other way: one genuinely (`simulation.ts:85`,
caught by a new `run(0)` test added in the same change), two by the same timeout effect. No real
detection was lost.

**Alternatives.**
- *Run mutation on changed files only.* Faster still, but a change in one file can leave
  another file's mutants alive (shared validation, the simulation loop), so the final run before
  committing stays whole-engine.
- *Shorter versions of the whole-market tests under mutation.* Possible if a future score drop
  shows they are the only tests catching some mutants; not needed now.

---

## D-029 · Volatility is measured from the mid price, never from trade prices

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** The volatility estimator reads the mid, (best bid + best ask) / 2, on a fixed
sim-time grid. Trade prices are never used.

**Why.** Trades alternate between the bid and the ask ("bid-ask bounce", Roll 1984), which looks
like movement even when the market is still. Measured on the seed-187 noise market: consecutive
trade-price returns have lag-1 autocorrelation −0.17, and volatility from trade prices is **2.3×**
the mid-based value over the same hour. A test checks this on the live market.

---

## D-030 · Sample every 5 seconds of sim time

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** The mid is sampled at every 5,000 ms of sim time (tick ends on the grid).

**Evidence (volatility signature plot, seed 187, one hour, σ in ¢ per √second).**

| Interval | 0.1 s | 1 s | 5 s | 10 s | 30 s |
|---|---|---|---|---|---|
| Noise traders only | 1.23 | 1.03 | 0.81 | 0.73 | 0.61 |
| Noise + 2 market makers | 0.92 | 0.89 | 0.75 | 0.67 | 0.59 |

Short intervals overstate volatility because the mid itself flickers: noise orders placed inside
the spread and then cancelled or hit make it bounce back and forth (1-second mid returns have
autocorrelation −0.19). Sampling every second would overstate it by about 1.7×; sampling every
30 seconds reacts too slowly to a headline. 5 s is the compromise; the market makers flatten the
short end, as real liquidity providers do. (Zhang, Mykland & Aït-Sahalia 2005; Andersen, Bollerslev,
Diebold & Labys 2000.)

---

## D-031 · Two EWMAs, fast (30 s) and slow (120 s); users take the larger

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** Each 5-second sample updates two exponentially weighted moving averages
(RiskMetrics 1996) of the per-second squared log return: `v ← λv + (1 − λ)·r²/Δt`, with
`λ = 2^(−Δt/H)`, H = 30 s (fast) and 120 s (slow). Decay uses the real elapsed time, so a skipped
sample weighs the old estimate correctly. The market maker uses `σ = √max(v_fast, v_slow)`: it
reacts quickly when volatility jumps and stays steady when it falls. All math uses `detMath`.

**Why two (your review of the plan).** With only the 120 s average, one shock sample carries under
3% weight, so a sudden regime change takes minutes to show.

**Measured shock response** (calm regime, then exactly 4× volatility, sampled every 5 s; seconds
until the market maker's spread doubles; pinned in `volatility.test.ts`):

| | max(fast 30 s, slow) | slow 120 s alone | (fast 15 s, for comparison) |
|---|---|---|---|
| Formula spread δ | **30 s** | 95 s | 15 s |
| Quoted spread (rounded to whole cents) | **30–50 s** | 110–175 s | 20–25 s |

The quoted spread is slower than the formula spread because rounding away from the market adds up
to 2¢ to the calm spread, so doubling the quoted spread needs more of the shock absorbed. A 15-second
fast half-life would show a headline within about 20–25 s at the cost of a noisier estimate; it is
one parameter if we want it.

---

## D-032 · Volatility units, warm-up and missing samples

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.**
- **Units:** log return per √second of sim time. In cents per √second: σ × mid. Per minute: ×√60;
  per hour: ×60. No annualizing (CLAUDE.md: use the sim's own clock, never 252 trading days).
- **Warm-up:** both averages start at σ₀ = 4.3×10⁻⁵/√s (measured: ≈ 0.8¢/√s at $187) and the
  estimate reports `ready` after 24 returns. The first sample (at 5 s) only sets the baseline mid,
  so with no skipped samples it is ready at **125 s** of sim time: one baseline sample plus 24
  returns. (Corrected after Codex review; this said "24 samples (2 minutes)". Pinned on the live
  market in `volatility.test.ts`.)
- **Missing mid** (a side of the book empty at a sample): the sample is skipped; the next return is
  taken from the last good mid and divided by the real elapsed time, so it stays a fair per-second
  rate. Repeating the last mid instead would fake "no movement" and bias volatility down.

---

## D-033 · Avellaneda–Stoikov market maker, with k = 1.0 after a P&L investigation

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** Two market makers quote around a reservation price with an Avellaneda–Stoikov spread
(Avellaneda & Stoikov 2008):
- reservation `r = s − q·γ·σc²·τ` (s: others' mid; q: inventory in lots of 100; σc = σ × s, in
  ¢/√s): long → quotes lean lower so others buy from it; short → higher;
- spread `δ = γ·σc²·τ + (2/γ)·ln(1 + γ/k)`: an inventory-risk part that grows with volatility²
  and a competitive part set by how fast fills fall off with distance;
- quotes `toTick(r − δ/2, down)` and `toTick(r + δ/2, up)`;
- γ = 0.010 (mm-1) and 0.015 (mm-2) per cent; **k = 1.0 per cent** (plan: 1.5).

**The P&L investigation (your review: "if it's negative, investigate before committing").** At
k = 1.5 the market makers lost money on 5 of 6 runs (two market makers × three seeds). Breaking
every market-maker fill into edge and markout (seed 187):
- edge at the fill against the mid just before: **+0.77¢ per share**, about half its spread, as expected;
- the mid then moved against it by **0.81¢ per share within 5 seconds and never came back**
  (0.82¢ after 2 minutes); the loss came almost entirely from market orders.

Uninformed traders still beat it because this market has **no fair-value anchor**: price is the sum
of past order flow, so every order's impact is permanent and order flow predicts the future price.
Real market makers survive because value traders pull prices back (Week 3). Sweeping k:

| k (per cent) | P&L positive (of 6 runs) | MM fills per hour | MM at best price | Market spread |
|---|---|---|---|---|
| 1.5 | 1 | ≈ 3,700 | 50% | 1.27¢ |
| **1.0** | **6** | ≈ 2,500 | 34% | 1.35¢ |
| 0.75 | 6 | ≈ 1,600 | 21% | 1.38¢ |
| 0.5 | 6 | ≈ 570 | 7% | 1.40¢ |

k = 1.0 is the tightest setting that is profitable on every run while still at the best price a third
of the time. It was chosen from this sweep, not from a fill-rate calibration; calibrating k from
fill rates belongs with Week 3's tuning, once value traders anchor the price. A test requires
positive P&L marked to the mid for both market makers on three seeds.

**Out-of-sample check (Codex review).** Those three seeds (187, 1, 2) are the ones k was chosen on,
so that test guards against regressions but does not independently show profitability. Seeds 3, 4
and 5 were fixed in advance and run once at k = 1.0 (one sim-hour, P&L marked to the final mid):

| Seed | mm-1 | mm-2 |
| --- | --- | --- |
| 3 | +$151.48 | +$234.86 |
| 4 | +$158.15 | +$123.64 |
| 5 | +$223.44 | +$183.45 |
| *In sample (187, 1, 2)* | *+$197 to +$271* | *+$112 to +$159* |

Profitable on 6 of 6 out-of-sample runs, in the same range as in sample. A second test pins them.
k is still provisional: the fill-rate recalibration once value traders exist is unchanged
(CLAUDE.md, Open tuning).

---

## D-034 · A rolling 60-second horizon instead of a session end

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.** Avellaneda–Stoikov assumes trading stops at a time T and uses T − t. Our market runs
continuously, so the market maker always uses τ = 60 s, as if the session ended a minute from now.

**Alternatives.** Time to the 16:00 close: quotes would drift wider, then narrower, over the day for
no market reason, which would be confusing to explain and to see.

---

## D-035 · Post-only quotes, inventory limits and size rules

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.**
- **Post-only:** a market maker's bid is never at or above another trader's best ask, and its ask
  never at or below another's best bid (clamped one tick away), so it always provides liquidity and
  never takes it. Its own quotes are excluded when finding the best prices (`othersBest`), so it never
  prices off itself. Tested: in an hour of live market, every market-maker fill has it as the resting side.
- **Inventory:** lots of 100 shares; limit ±5,000 shares. On the side that would grow its position,
  size shrinks linearly with the position and stops at the limit, and no quote can take it past the
  limit (tested over the whole range).
- **Size under stress:** `500 × max(0.25, min(1, σ₀/σ))`, rounded down to whole lots: at 2× calm
  volatility a quote is 200 shares, at 4× or more it is 100.

---

## D-036 · Requote only on change; two market makers; who sets the visible spread

**Date:** 2026-10-10 · **Status:** Accepted

**Decision.**
- **Requote only on change (your review):** each arrival (Poisson, about 5 per second per market
  maker), a side is replaced only if its computed price or size differs from what is resting.
  Unchanged quotes keep their time priority. Changed sides are cancelled first, then placed, so a
  market maker never briefly crosses itself. Tested with a fake market: five identical arrivals in a
  row produce no orders at all.
- **Two market makers** (mm-1, mm-2) with slightly different risk aversion, so they compete at the
  best price.

**How the market changes with them** (seed 187, one hour):

| | Noise only | Noise + 2 MMs | Noise + 2 MMs that see 4× volatility (stub) |
|---|---|---|---|
| Average / median spread | 1.43¢ / 1¢ | 1.35¢ / 1¢ | 1.43¢ / 1¢ |
| Orders per side | 52.6 / 53.2 | 55.5 / 55.9 | 55.1 / 55.1 |
| Price range | $186.74–$187.13 | $186.65–$187.07 | $186.62–$187.09 |
| Orders sweeping more than 3 levels | 59 | 12 | 49 |
| Largest sweep / largest mid move | 10¢ / 3.5¢ | 6¢ / 3¢ | 8¢ / 5¢ |
| A market maker at best bid / ask | — | 35% / 33% | 1% / 1% |
| MM share of shares at the best prices | — | 17% | 0.1% |
| MM P&L (mm-1 / mm-2), marked to mid | — | +$197 / +$154 | +$31 / +$23 |

**Who sets the visible spread (your review).** At 4× volatility the market makers withdraw almost
completely (34% → 1% at the best price), but the market spread only moves from 1.35¢ to 1.43¢:
noise traders keep posting one-cent quotes and hold 83% of the shares at the best prices. The
withdrawal shows in sweeps (12 → 49) and mid moves (3¢ → 5¢), not in the spread, so "market makers
widened spreads 4×" would not show on screen today. **Proposed Week 3 tuning (not done now):**
1. make noise limit orders less aggressive (μ ≈ 15¢, θ = 0), so market makers set the best prices
   most of the time;
2. let noise traders' limit offsets widen with volatility too, as real limit-order traders do.
Both to be measured against this same report.

---

## D-037 · The page pulls one coalesced frame per animation frame from the worker

**Date:** 2026-10-17 · **Status:** Accepted

**Decision.** The simulation runs in a Web Worker (`src/worker/sim.worker.ts`). The page sends
`start` once, then one `frame` request per animation frame, and only after the previous frame has
arrived. The worker answers each request with one `Frame` (`src/engine/feed.ts`): status-bar
numbers (last, open, volume, clock, seed), best bid/ask, 20 book levels per side, the trades since
the last frame and the candles they touched. So the worker never posts more than once per
animation frame and frames never queue up, however busy the market is.

- At most 500 trades wait for the next frame (the newest); older ones are counted in
  `droppedTrades` but still counted in volume and candles. At 1× speed a frame carries 0–2 trades.
- The feed only reads the simulation, so taking frames cannot change the market (tested).
- A hidden tab gets no animation frames, so the market pauses with it.

**Alternatives.** *Worker pushes on its own timer:* simpler, but messages can pile up behind a
busy main thread. *SharedArrayBuffer:* needs cross-origin isolation headers on Vercel; not worth
it at one message per frame.

---

## D-038 · Demo market, 10-minute warm-up and 10-second candles

**Date:** 2026-10-17 · **Status:** Accepted

**Decision.** Every page load opens `createDemoMarket()`: seed 187, SPY from $187.00, 40 noise
traders and the two market makers. The worker first simulates 10 minutes (6,000 ticks), so the
page opens at 09:40 already trading, with the volatility estimate ready (125 s, D-032), a full
tape and about 60 candles. Candles are 10 seconds of sim time.

**Measured.** 10 minutes of this market simulate in 45 ms in Node; in headless Chromium the first
frame is on screen 125–130 ms after navigation, page load included. Every 10-second interval of
the warm-up has at least 32 fills, so the chart has no gaps. The "OPENING MARKET" state is shown
only if the warm-up takes longer than about 1 s (a CSS animation delay, no timer), so on a normal
machine it never appears.

**Alternatives.** *One-minute candles:* only 10 candles on load and a slow-moving chart at 1×.
*No warm-up:* an empty chart and tape on load, which reads as "not running".

---

## D-039 · The real clock decides only how many ticks run

**Date:** 2026-10-17 · **Status:** Accepted

**Decision.** `TickPacer` turns real elapsed milliseconds into whole 100 ms ticks (carrying the
remainder), times the speed. The worker is the only code that reads the real clock
(`performance.now()`), and only to ask the pacer how many ticks are due. What happens in a tick
depends only on the seed and the tick count. After a long gap (a hidden tab) at most 10 ticks run
and the rest is dropped, so the page never freezes simulating a backlog; sim time then lags wall
time, which is fine because the sim clock is its own.

**Tested (your requirement).** The worker's loop driven by smooth 60 fps frames, by random
0–250 ms frames, and at 4× speed gives a byte-identical fill log and book for the same number of
ticks, identical to a plain `sim.run`; the page ends up with the same trades and candles even
though the frames slice them differently.

---

## D-040 · Ticker tape, tick direction and panel numbers

**Date:** 2026-10-17 · **Status:** Accepted

**Decision.**
- **Tick direction:** a trade is "up" if its price is above the previous trade's, "down" if
  below; an unchanged price keeps the last direction (the zero-plus/zero-minus tick convention).
  The session's first trade counts as up. TAPE and the ticker use the same direction.
- **Ticker:** one item per trade (`SPY 1,340 @ 187.42 ▲`). It scrolls at 50 px/s when quiet,
  faster as items queue (up to 260 px/s). The demo market trades about 5 times a second, more
  than any readable strip can show, so when more than two strip-widths are waiting, the oldest
  waiting items are skipped and the strip shows recent trades. TAPE lists every trade. On load the
  strip starts already full, since the market is already running.
- **Panel numbers** follow the default layout (1 GP, 4 TAPE, 5 BOOK); panels that have not shipped
  are not drawn and the grid closes up, so today's numbers stay valid as panels 2, 3, 6–8 arrive.
