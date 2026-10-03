# MarketLab

**An AI-native market laboratory for learning how markets and trading strategies actually work.**

**Live demo: [marketlab-nine.vercel.app](https://marketlab-nine.vercel.app)**

## Thesis

**Problem.** Finance students learn market mechanics (order books, liquidity, slippage, panics)
from textbooks and from charts of prices that have already happened. Neither lets them *touch*
the market. Coding platforms such as QuantConnect let them test strategies against history, but
only after they can program. Even there, the student's own trades can never move the price. So
students go from theory to code without ever seeing *why* prices move or *why* a strategy that
looks good on paper loses money when it actually executes.

**Thesis.** When prices emerge from a crowd of simulated traders in a real limit order book, a
student can see cause and effect. They can change one thing, such as a headline, a strategy, or
how much liquidity market makers provide, and watch the market respond. If every experiment can
also be opened up into its rules, formulas and code, students build real intuition for market
microstructure *before* they can code. They also arrive at quant platforms already understanding
what their code will do.

> Bloomberg shows students what markets did. QuantConnect teaches students to code strategies.
> MarketLab lets students experiment with how markets work before they can code — then exposes
> the math and code behind every experiment.

**Who it's for:** college finance and economics professors, trading labs, investment clubs, and
college students interested in quant or hedge fund careers.

**What it is not:** it does not predict real markets and does not trade real money.

## What it does

A crowd of simulated traders (market makers, noise traders, momentum and value traders, panic
sellers, whales) trades in a continuous double-auction order book. Prices are not scripted or
drawn from a formula. They come from those trades. On top of that market, a student can:

1. **Move the market with news.** Type any headline ("Fed surprise hike 75bps"). AI converts it
   into visible, editable parameter changes (sentiment, fair-value shock, volatility, liquidity),
   and the agents react.
2. **Trade a strategy written in plain English.** "Buy after a quick 3% drop because panic
   sellers overshoot" becomes a validated rule spec that trades live in the order book, with
   real slippage and P&L.
3. **Trade by hand** against the crowd.
4. **Open the glass box.** See the same strategy as English → rules → formulas (with the
   student's real numbers) → Python.
5. **Ask "what if?"** Rerun the same seeded scenario with one variable changed.

**What sets it apart:** the student's own orders move the price (market impact), they can
invent any counterfactual event, and the rules, formulas and code behind every experiment are
shown.

## Architecture

```
Browser UI (Next.js)
  ├─ Web Worker: Simulation Engine (pure TypeScript, no network)
  │    Sim Clock → Agents → MarketRegistry (one OrderBook per ticker) → Matching Engine
  │    → Event Stream (trades, quotes, fills) → Analytics
  └─ /api/interpret (Next.js route) → LLM → JSON validated with Zod → engine parameters
```

- **The whole simulation runs in the browser**, in a Web Worker. There is no simulation server.
- **The only network call is the AI interpret route**, which keeps the API key on the server.
- **The AI only produces data.** It never writes or runs code, and the engine never calls it.
  AI output must match a Zod schema; anything that doesn't is rejected.
- **The glass box is always accurate.** The Python shown to students is generated from the
  strategy spec using templates, never written by the AI, so it always matches what the engine
  ran.

### Engine design rules

| Rule | Why |
| --- | --- |
| Prices and cash are **integer cents**, never floats | Exact P&L and slippage; no rounding drift |
| **Price-time priority**, continuous double auction | How real exchanges match orders |
| **Seeded RNG** for all randomness | Same seed + same inputs = same result, which makes what-if reruns fair |
| One `OrderBook` per ticker in a `MarketRegistry` | Ready for more than one stock from day one |
| `src/engine` has **zero React/DOM imports** | Testable in isolation; **enforced by ESLint** |
| Every fill records each side's arrival quote and limit price | Slippage is exact: intended price (the arrival mid) vs executed price |

The engine boundary is checked automatically. An ESLint rule in `eslint.config.mjs` fails
`npm run lint` if anything in `src/engine/` imports React, React DOM, Next.js or UI code, or
uses `window`/`document`. A Vitest test (`src/engine/boundary.test.ts`) checks that the rule
itself keeps working.

## Project status

**Week 1 of 5 ✅ complete.** Week 2 is in progress: steps 1 (matching engine) and 2 (seeded
randomness and sim clock) are done; the goal for the week is a live market moving on its own at
page load. What exists today:

- [x] Next.js + TypeScript (strict) app with the terminal-style layout and placeholder panels,
      deployed on Vercel at [marketlab-nine.vercel.app](https://marketlab-nine.vercel.app)
- [x] `OrderBook`: integer-cent prices, tick size, price-time priority, add / cancel / partial
      fill, per-owner orders and cancel-all, best bid/ask, spread and depth. It is never crossed,
      and rejected orders come back with a reason code instead of throwing.
- [x] Matching engine: limit and market orders, sweeps across price levels, partial fills,
      self-trade prevention, and a frozen fill log recording both sides' agent type, limit price and
      arrival quote, so slippage (vs the arrival mid) and "who moved the price?" are exact
- [x] Seeded randomness: the same seed gives the same market **in every browser**. One seeded
      generator (xoshiro128\*\*, verified against the authors' reference C code), an independent
      named stream per agent, and our own deterministic `ln`/`exp`/`pow`, since browsers may
      compute `Math.log` and friends differently
- [x] Sim clock (100 ms ticks from 09:30:00.000) and Poisson order arrivals with exact timestamps
- [x] 405 tests, shadow-model comparison, and 96% mutation score (see [Testing](#testing))
- [x] Engine boundary and determinism rules, enforced by ESLint and checked at runtime

The panels in the UI say which week they go live. They show no fake market data.

## Testing

The judges are software engineers, so the engine is tested the way exchange software should be:
not just "does it work on my example" but "can any small bug slip past the tests?"

| Check | Result |
| --- | --- |
| Unit and property tests (Vitest) | **405 passing** across 12 files |
| Randomized shadow-model comparison | Order book and matching engine, 5 seeds × 3,000 operations each, full state compared after **every** step |
| Mutation score (Stryker) on `src/engine` | **96.40%**: 965 of 1,001 mutants detected |
| Same seed → same numbers in every browser | Random generator matches the reference C code exactly; `ln`/`exp` bits pinned over 226,000+ inputs; inexact `Math` functions banned by lint **and** by a runtime test |
| Throughput benchmark | **~1.5 million matching-engine operations per second** with real fills |

**Shadow models.** `src/engine/testing/shadow.ts` contains a deliberately naive reference order
book and matching engine: a flat array where every question is answered by filtering and
sorting from scratch. They share no code with the real engine, not even validation or limits,
so the two can only agree if both are correct. A seeded random generator drives the real and
shadow versions through the same operations and compares everything observable after each step:
every trade (price, size, both sides' agent types, limit prices and arrival quotes), best prices,
spread, depth, every queue in price-time order, every order ever created, and every owner's
orders.

**Randomized, but reproducible.** Every run uses fixed seeds, so a failure always reproduces. The
generator mixes normal orders with the cases that break exchanges: orders that cross the spread,
market orders that sweep several levels or drain a side completely, self-trades, every kind of
invalid order, cancels of orders that already filled or never existed, partial and full fills,
cancel-all, and maximum-size orders. After every order it also checks rules that must always
hold: shares in = filled + resting + cancelled, no trader ever trades with itself, limit prices
are respected, and the book is never crossed. A coverage guard fails the test if any case happens
fewer than 5 times per seed, or if the book or the trade count stays too small, so the random test
can never quietly stop testing anything. We also planted seven realistic bugs by hand (one in the order book, six in the
matching engine); every one was caught.

**Determinism across browsers.** The JavaScript spec lets each browser compute `Math.log`,
`Math.exp`, `Math.pow` and the trig functions slightly differently, so the same seed could give a
different market in Safari than in Chrome. The engine therefore uses its own `ln`, `exp` and `pow`
(ports of the fdlibm library, built only from operations every browser must compute exactly), and
the random generator is checked against the authors' reference C program
(`scripts/reference/xoshiro128ss.c`). Two layers keep it that way: an ESLint rule bans every route
to the inexact functions, the unseeded `Math.random` and the real clock; and a runtime test
replaces all of them with functions that throw, reruns the engine's full random workloads, and
requires identical results. We confirmed the runtime test catches code the lint rule cannot see.

**Mutation testing.** Stryker makes hundreds of small deliberate bugs in the engine (flipping `<`
to `<=`, deleting a line, changing a constant) and checks that some test fails for each one.
965 of 1,001 are caught. We reviewed the other 36 one by one: they are safety checks that can
only run if the engine is already broken, comparisons that only differ when a random time lands
exactly on a boundary (probability ≈ 0), or alternate math paths that give bit-identical results.

**Benchmark.** 100,000 operations per run on an Apple Silicon MacBook Air:

| Scenario | Operations / second |
| --- | --- |
| Matching engine: limit + market + cancel mix (~33,000 fills) | ~1.5 million |
| Order book: mixed add/cancel, ~200 price levels | ~4.3 million |
| Order book: mixed add/cancel, ~5,000 price levels | ~3.3 million |
| Order book: 100 market makers cancel and requote every tick | ~7.9 million |

A busy tick (hundreds of agents, about 1,000 orders through the matching engine) costs about
0.65 ms, roughly 25× headroom inside a 16 ms frame for a smooth 60 fps simulation.

## Getting started

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | ESLint, including the engine import boundary |
| `npm run typecheck` | Generate Next.js route types, then TypeScript type check (works on a fresh clone) |
| `npm run test:mutation` | Stryker mutation testing on `src/engine` (HTML report in `reports/`) |
| `npm run bench` | Order book throughput benchmark |
| `npm run build` | Production build |

## Project structure

```
src/
  app/          Next.js App Router: layout, page, global theme
  components/   UI components (Panel, …)
  engine/       Simulation engine: pure TypeScript, no React/DOM (lint-enforced)
    orderBook.ts                   Limit order book (price-time priority)
    matchingEngine.ts              Matching engine: limit/market orders, fills, arrival quotes
    marketRegistry.ts              One matching engine per ticker
    validation.ts                  Order validation shared by the book and the engine
    types.ts                       Shared types and reason codes
    rng.ts                         Seeded random numbers (xoshiro128**), named streams per agent
    detMath.ts                     Deterministic ln / exp / pow (same bits in every browser)
    simClock.ts                    Sim time: 100 ms ticks from 09:30:00.000
    arrivals.ts                    Poisson order arrivals per agent
    *.test.ts                      Unit, edge-case and limit tests
    *.shadow.test.ts               Randomized comparison against the naive reference models
    orderBook.bench.ts             Throughput benchmark
    boundary.test.ts               Checks the ESLint boundary and determinism rules themselves
    determinism.test.ts            Runtime backstop: reruns the workloads with banned globals stubbed
    testing/                       Test-only: shadow models, shared random workloads, fingerprints
scripts/reference/xoshiro128ss.c   Reference C generator the RNG tests are checked against
  lib/          Shared code, e.g. Zod schemas for AI contracts (coming in Week 4)
```

## Roadmap

Five weeks of building, then a week of rehearsal. Each week ends as a complete, working demo.

| When | Deliverables | Milestone |
| --- | --- | --- |
| **Week 1** ✅ Done | Repo, deploy, layout shell, OrderBook + 107 tests, 98% mutation score | |
| **Week 2** (Oct 2–10) | Matching engine + tests (market and limit orders, partial fills, fill log with agent types), seeded RNG + sim clock, worker + batched snapshots, Noise + MarketMaker (Avellaneda–Stoikov) + Momentum agents, live candlestick chart + tape, market alive on load, new layout and amber theme | A realistic market moves on its own at page load |
| **Week 3** (Oct 11–17) | Value, Panic (threshold cascade) and Whale agents; depth view; crowd panel; narrator v1; attribution ("who moved the price?"); realism panel; tuning; professor interviews | |
| **Week 4** (Oct 18–24) | Command bar; AI headline → clamped, editable parameters; your desk (manual trading, strategy agent, execution report with slippage); hover formulas; glass box reveal | The full 90-second demo works end to end |
| **Week 5** (Oct 25–31) | Missions 1, 3 and 5; Learn/Pro modes; rewind; what-if reruns; polish | |
| **Stretch** (only if ahead) | Multi-stock + macro + regime presets, Strategy Arena, option pricing | |
| **Nov 1–5** | Feature freeze, demo script, backup video, rehearsals | |

**Priority rule:** learning features (missions, narrator, Learn mode) beat breadth features
(multi-stock, options). Depth over breadth.

### The 90-second demo

1. **Idea.** A student types a strategy: *"Buy after a quick 3% drop because panic sellers
   overshoot."*
2. **Market.** A judge types any headline live, the crowd reacts, and the strategy trades
   through it.
3. **Reality check.** The execution report shows the intended price (the market's mid price when
   the order arrived) vs. the actual average fill (slippage), P&L, Sharpe ratio and max drawdown.
4. **Reveal.** "Show me what I built": English → rules → formulas with real numbers → Python.

---

Built for the Busch School AI Vibe Coding Contest.
