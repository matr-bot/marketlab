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

**Date:** 2026-10-01 · **Status:** Accepted

**Decision.** `CLAUDE.md` is the builder's guide and holds the full project context, including
the Next.js agent-rules block. `AGENTS.md` is only for Codex: it makes Codex a read-only
reviewer that reads CLAUDE.md and this file for context. CLAUDE.md no longer imports AGENTS.md.

**Alternatives.**
- *Add the reviewer instructions to the existing AGENTS.md.* CLAUDE.md imported AGENTS.md, so the
  builder would also have been told "you are the reviewer, never modify files."
- *One shared file for both tools.* That would mix builder and reviewer roles.

**Why.** A second model reviewing the work gives an independent check, like the shadow book does
for the code, but only if the roles stay separate. `next dev` regenerates its rules block in
whichever file already contains it (`node_modules/next/dist/server/lib/generate-agent-files.js`).
With the block in CLAUDE.md and none in AGENTS.md, it updates CLAUDE.md and leaves AGENTS.md alone.
