@AGENTS.md

# MarketLab — Project Guide for Claude Code

## Repo layout (paths used in this guide)
- `/engine` in this guide = `src/engine/` (enforced by ESLint: no React/Next/DOM/UI imports)
- `/lib` = `src/lib/` (e.g. `src/lib/schemas.ts`)
- `/data` = `data/` at the repo root
- Commands: `npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`

## What this is
MarketLab is an AI-native market laboratory for learning how markets and trading strategies
actually work. A crowd of simulated traders trades stocks in a real limit order book. Prices are
NOT scripted or drawn by a formula — they emerge from agents trading.

Users can:
1. Type any news headline ("Fed surprise hike 75bps") → AI converts it into structured parameter
   changes → agents react → the market moves.
2. Describe a trading strategy in plain English → AI converts it into a validated rule spec →
   it trades live as an agent in the order book, with real slippage and a P&L.
3. Trade manually (buy/sell buttons) against the crowd.
4. Reveal the "glass box": the same strategy shown as English → rules → formulas → Python.
5. Rerun the same scenario with one variable changed ("what if market makers stayed liquid?").

It is a teaching/experimentation tool. It does NOT predict real markets and does NOT trade real
money.

## Positioning
- Target user: college finance/economics professors, trading labs, investment clubs, and
  students interested in quant/hedge fund careers. (Say "college students", never "kids".)
- MarketLab is the bridge between learning finance conceptually and coding quant strategies on
  platforms like QuantConnect or WorldQuant BRAIN.
- Pitch line: "Bloomberg shows students what markets did. QuantConnect teaches students to code
  strategies. MarketLab lets students experiment with how markets work before they can code —
  then exposes the math and code behind every experiment."
- Differentiators vs no-code trading tools (Composer, Capitalise.ai) and backtesters:
  (1) the user's own orders move the price (market impact), (2) arbitrary counterfactual events,
  (3) glass-box teaching of rules, formulas and code.

## Contest context
Busch School AI Vibe Coding Contest ("How Crazy Can You Get?"). Judges are software engineers:
correctness, robustness and clear architecture matter more than feature count. Anything shown on
screen must be true to what the engine actually did.

## The 90-second demo story (everything serves this)
1. IDEA — student types a strategy: "Buy after a quick 3% drop because panic sellers overshoot."
2. MARKET — a judge types any headline live; the crowd reacts; the strategy trades through it.
3. REALITY CHECK — execution report: intended price vs actual average fill (slippage), P&L,
   Sharpe ratio, max drawdown.
4. REVEAL — "Show me what I built": English → rules → formulas with real numbers → Python.

## Non-goals (do not build unless explicitly asked)
- Real-money trading, brokerage connections, live market data dependencies
- User accounts / login, multiplayer, mobile-first layout
- Full options market or implied-volatility surface (Tier 3 at most: simple option pricing)

## Architecture
```
Browser UI (Next.js)
  ├─ Web Worker: Simulation Engine (pure TypeScript, no network)
  │    Sim Clock → Agents → MarketRegistry (one OrderBook per ticker) → Matching Engine
  │    → Event Stream (trades, quotes, fills) → Analytics
  └─ /api/interpret (Next.js route) → LLM → JSON validated with Zod → engine parameters
```
- The ENTIRE simulation runs in the browser in a Web Worker. No simulation server.
- The ONLY network call is the AI interpret route (keeps the API key server-side).
- The engine never calls the LLM. The LLM never writes or runs code. The LLM only outputs data
  matching a Zod schema; invalid output is rejected and retried or shown as an error.

## Engine rules (important)
- Prices and cash are integers in cents (or ticks). Never use floats for money.
- Matching: continuous double auction, price-time priority. Order types: limit, market, cancel.
- Seeded random number generator for ALL randomness → same seed + same inputs = same result.
  Required for fair "what if" reruns, multi-seed robustness tests, and deterministic tests.
- Multi-stock ready from day one: MarketRegistry holds one OrderBook per ticker.
- /engine has zero React/DOM imports so it is testable in isolation.
- Every fill records intended price vs executed price so slippage can be reported exactly.

## Agents (Tier 1 set)
Common interface: `onTick(marketState, rng) → Order[]`.
- MarketMaker — quotes both sides; widens spread and cuts size under stress/inventory risk
- NoiseTrader — random small orders; baseline activity
- MomentumTrader — buys rising / sells falling prices
- ValueTrader — trades toward a belief about fair value
- PanicTrader — dumps on sharp drops; sentiment-sensitive
- Whale — occasional very large orders
- UserStrategyAgent — executes a validated StrategySpec

Most agents are cheap rule-based code. The LLM shifts their parameters (sentiment, fair value,
risk tolerance, liquidity, activity rate); it never decides individual trades.

## AI contracts (Zod schemas in /lib/schemas.ts)
- ScenarioParams: sentiment shift, fair-value shock %, volatility multiplier, market-maker
  liquidity multiplier, panic sensitivity, duration, severity (mild/severe/catastrophic), and a
  plain-English explanation of each change. UI shows these visibly and lets the user edit them.
- StrategySpec: hypothesis (text), entry rule, exit rules, position size, stop loss, take
  profit — from a fixed menu of rule types only.

## Glass box rules (must be exactly true)
- Python shown to users is GENERATED FROM THE StrategySpec USING TEMPLATES, never written by
  the LLM, so displayed code always matches what the engine ran.
- Formulas are shown with the user's actual numbers plugged in.
- Metric definitions are consistent everywhere: Sharpe = (mean return − risk-free rate) ÷
  std dev of returns, annualized using the SIM's actual clock (not a hardcoded 252 days).
  The formula, the displayed number and the displayed code must agree.
- Education levels (Tier 2): Beginner (plain words), Intermediate (formulas), Advanced (code).

## Data
- Historical daily prices for a few tickers (index ETF, NVDA, AAPL, etc.) bundled as static
  files in /data, used to calibrate each stock's volatility, drift, beta and correlation.
- Regime presets (e.g. 2008, 2020, 2022) load era-specific volatility and macro settings.
- No live data at demo time.

## Build order (components and dependencies)
1. OrderBook → 2. Matching Engine → 3. Seeded RNG + Sim Clock → 4. Basic agents →
5. Worker + event stream → 6. Chart / order book / trade feed UI → 7. Remaining agents + tuning →
8. Realism panel → 9. AI interpret route + ScenarioParams panel → 10. StrategySpec +
UserStrategyAgent + execution report → 11. Glass box → 12. Multi-stock + macro + regimes →
13. What-if reruns + Strategy Arena → 14. Polish.
Each step must work and be tested before the next depends on it.

## Roadmap (each tier must end as a complete, polished demo)
- Week 1 (due Oct 3): repo, skeleton app deployed on Vercel, layout with placeholder panels,
  OrderBook data structure + first tests, README (thesis, architecture, roadmap).
- Week 2 (Oct 4–10): matching engine + full tests, seeded RNG, sim clock, MarketMaker/Noise/
  Momentum agents, worker + live candlestick chart + trade feed.
  Milestone: price moves realistically with no input.
- Week 3 (Oct 11–17): Value/Panic/Whale agents, order book depth view, tuning, realism panel
  (fat tails, volatility clustering, spread vs stress). Professor interviews this week.
- Week 4 (Oct 18–24): /api/interpret for headlines + strategies, editable parameter panel,
  UserStrategyAgent, manual buy/sell, execution report (slippage, P&L, Sharpe, drawdown),
  glass box v1 (English → rules → formulas → Python).
  Milestone: the full 90-second demo story works end to end.
- Tier 2 (Oct 25–31): 3–5 correlated stocks calibrated from history, macro dashboard (Fed rate,
  inflation, recession, vol regime), regime presets, side-by-side what-if reruns, Strategy
  Arena (multi-seed robustness scoring + leaderboard), education level slider.
- Tier 3 (only if ahead): simple option pricing that reacts to simulated volatility.
- Nov 1–5: feature freeze, demo script, backup video, rehearsals.

## Conventions
- TypeScript strict mode. Small, focused commits with clear messages.
- Every engine change comes with Vitest tests. Run tests before committing.
- Plan before large changes: explain the plan, then implement.
- Dark "terminal" aesthetic: deep near-black background, neon green accents, sharp borders.
