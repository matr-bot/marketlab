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
