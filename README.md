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
| Every fill records intended vs executed price | Slippage is reported exactly, not estimated |

The engine boundary is checked automatically. An ESLint rule in `eslint.config.mjs` fails
`npm run lint` if anything in `src/engine/` imports React, React DOM, Next.js or UI code, or
uses `window`/`document`. A Vitest test (`src/engine/boundary.test.ts`) checks that the rule
itself keeps working.

## Project status

**Week 1 ✅ complete.** Week 2 (matching engine and a live market on page load) is next.
What exists today:

- [x] Next.js + TypeScript (strict) app with the terminal-style layout and placeholder panels,
      deployed on Vercel at [marketlab-nine.vercel.app](https://marketlab-nine.vercel.app)
- [x] `OrderBook`: integer-cent prices, tick size, price-time priority, add / cancel / partial
      fill, per-owner orders and cancel-all, best bid/ask, spread and depth. It is never crossed,
      and rejected orders come back with a reason code instead of throwing.
- [x] 107 tests, shadow-model comparison, and 98% mutation score (see [Testing](#testing))
- [x] ESLint-enforced engine boundary

The panels in the UI say which week they go live. They show no fake market data.

## Testing

The judges are software engineers, so the engine is tested the way exchange software should be:
not just "does it work on my example" but "can any small bug slip past the tests?"

| Check | Result |
| --- | --- |
| Unit and property tests (Vitest) | **107 passing** across 3 files |
| Randomized shadow-model comparison | 5 seeds × 3,000 operations, full state compared after **every** step |
| Mutation score (Stryker) on `orderBook.ts` | **98.26%**: 282 of 287 mutants detected |
| Throughput benchmark | **4–11 million order-book operations per second** |

**Shadow model.** `src/engine/orderBook.shadow.test.ts` contains a deliberately naive reference
order book: a flat array where every query is answered by filtering and sorting from scratch.
It shares no code with the real `OrderBook`, so the two can only agree if both are correct. A
seeded random generator drives both books through the same operations and compares
everything observable after each step: best prices, spread, depth, every queue in
price-time order, every order ever created, and every owner's orders.

**Randomized, but reproducible.** Every run uses fixed seeds, so a failure always reproduces. The
generator mixes normal orders with the cases that break order books: orders that would cross
the spread, reused and duplicate IDs, invalid prices and quantities, cancels of orders that
no longer exist, partial and full fills, cancel-all, and maximum-size orders. A coverage guard
fails the test if any of those cases happens fewer than 5 times per seed, or if the book never
grows past 100 resting orders, so the random test can never quietly stop testing anything.

**Mutation testing.** Stryker makes hundreds of small deliberate bugs in the engine (flipping `<`
to `<=`, deleting a line, changing a constant) and checks that some test fails for each one.
Only 5 of 287 survive, and none of them can be killed by any test. Three produce identical
behavior (for example, `>` versus `>=` when the two values can never be equal), and two sit in
a safety check that can only run if the book is already corrupted.

**Benchmark.** 100,000 add and cancel operations per run on an Apple Silicon MacBook Air:

| Scenario | Operations / second |
| --- | --- |
| Mixed add/cancel, ~200 price levels | ~5.8 million |
| Mixed add/cancel, ~5,000 price levels | ~4.3 million |
| 100 market makers cancel and requote every tick | ~11 million |

A busy tick (hundreds of agents, about 1,000 book operations) costs about 0.2 ms, so the order
book has roughly 40× headroom for a smooth 60 fps simulation.

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
| `npm run typecheck` | TypeScript type check |
| `npm run test:mutation` | Stryker mutation testing on `src/engine` (HTML report in `reports/`) |
| `npm run bench` | Order book throughput benchmark |
| `npm run build` | Production build |

## Project structure

```
src/
  app/          Next.js App Router: layout, page, global theme
  components/   UI components (Panel, …)
  engine/       Simulation engine: pure TypeScript, no React/DOM (lint-enforced)
    orderBook.ts              Limit order book (price-time priority)
    orderBook.test.ts         Unit and edge-case tests
    orderBook.shadow.test.ts  Randomized comparison against a naive reference book
    orderBook.bench.ts        Throughput benchmark
    boundary.test.ts          Checks the ESLint engine-boundary rule itself
    types.ts
  lib/          Shared code, e.g. Zod schemas for AI contracts (coming in Week 4)
```

## Roadmap

Each stage ends as a complete, working demo.

| When | Deliverables | Milestone |
| --- | --- | --- |
| **Week 1** ✅ Done | Repo, skeleton app on Vercel, layout, OrderBook + 107 tests (98% mutation score), README | Foundation |
| **Week 2** (Oct 4–10) | Matching engine, seeded RNG, sim clock, market maker / noise / momentum agents, Web Worker, live candlestick chart + trade feed | Price moves realistically with no input |
| **Week 3** (Oct 11–17) | Value / panic / whale agents, order book depth view, tuning, realism panel (fat tails, volatility clustering, spread vs. stress), professor interviews | Market behaves like a market |
| **Week 4** (Oct 18–24) | AI interpret route for headlines and strategies, editable parameter panel, user strategy agent, manual trading, execution report (slippage, P&L, Sharpe, drawdown), glass box v1 | Full 90-second demo works end to end |
| **Tier 2** (Oct 25–31) | 3–5 correlated stocks calibrated from historical data, macro dashboard, regime presets (2008 / 2020 / 2022), side-by-side what-if reruns, Strategy Arena, education-level slider | |
| **Tier 3** (if ahead) | Simple option pricing that reacts to simulated volatility | |
| **Nov 1–5** | Feature freeze, demo script, backup video, rehearsals | |

### The 90-second demo

1. **Idea.** A student types a strategy: *"Buy after a quick 3% drop because panic sellers
   overshoot."*
2. **Market.** A judge types any headline live, the crowd reacts, and the strategy trades
   through it.
3. **Reality check.** The execution report shows intended vs. actual fill price (slippage),
   P&L, Sharpe ratio and max drawdown.
4. **Reveal.** "Show me what I built": English → rules → formulas with real numbers → Python.

---

Built for the Busch School AI Vibe Coding Contest.
