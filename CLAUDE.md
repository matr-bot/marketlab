<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# MarketLab — Project Guide for Claude Code

## Repo layout (paths used in this guide)
- `/engine` in this guide = `src/engine/` (enforced by ESLint: no React/Next/DOM/UI imports)
- `/lib` = `src/lib/` (e.g. `src/lib/schemas.ts`)
- `/data` = `data/` at the repo root
- Commands: `npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`,
  `npm run test:mutation` (Stryker), `npm run bench`

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

## Product promise
"Learn how markets really work — the way traders and quants see them." Users should feel: "this
is helping me get into finance / become a quant."

Founder story for the pitch: an accounting student who wants to work at a hedge fund found
nothing that taught how markets actually work, so he built the market itself and made it teach.

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
3. REALITY CHECK — execution report: intended price (the arrival mid) vs actual average fill
   (slippage, split into spread cost and impact cost), P&L, Sharpe ratio, max drawdown.
4. REVEAL — "Show me what I built": English → rules → formulas with real numbers → Python.

## Non-goals (do not build unless explicitly asked)
- Real-money trading, brokerage connections, live market data dependencies
- User accounts / login, multiplayer, mobile-first layout
- Full options market or implied-volatility surface (stretch at most: simple option pricing)

## Look: Bloomberg-inspired, beginner-friendly
- Inspired by professional terminals, but NEVER copy Bloomberg's name, logo or exact screens.
- Black background, AMBER as the primary accent/text color, green/red ONLY for up/down moves,
  dense monospaced numbers, sharp panel borders.
- Two modes:
  - LEARN mode (default): fewer panels, plain-English labels, the narrator guides attention.
  - PRO mode: full dense terminal with every panel visible.
- Every metric/label has a plain-English hover explanation (e.g. SPREAD: "The gap between the
  best buy and sell price. Wider means it costs more to trade.").
- The market is ALREADY RUNNING when the page loads (calm regime, demo seed). Never show
  "engine not running" as a first impression.

## Layout (follows the demo story: cause → reaction → your result → reveal)
- Top: command bar (headline input, front and center), play/pause, speed (1x/4x), regime, seed,
  Rerun, What-if, Learn/Pro toggle.
- Center-left: PRICE CHART, the largest element, with event markers (headline hit, user trades).
- Center-left below chart: THE CROWD — each agent type's mood, position and activity, live.
- Bottom-left: NARRATOR feed and TAPE (time & sales), side by side or tabbed.
- Right column: DEPTH / ORDER BOOK on top; YOUR DESK below (strategy input, buy/sell, position,
  P&L, execution report).
- GLASS BOX is a full-screen reveal opened by "Show me what I built", not a permanent panel.

## Command bar
Accepts commands and plain words: `SHOCK <headline>`, `RUN`, `PAUSE`, `REWIND`, `RERUN`,
`WHATIF`, `HELP`. Unknown input is treated as a headline. Friendly errors, never crashes.

## Narrator (deterministic, not AI)
Plain-English commentary generated by our own code from engine events/metrics, so it is always
true. Examples: "Market makers widened spreads 4x." "Panic sellers triggered." "Liquidity is down
50%." In Learn mode it also says where to look.

## "Who moved the price?" (attribution)
The engine logs every fill with the agent type on each side. Clicking any candle shows buy and
sell volume by agent type for that interval ("62% of selling came from panic traders"). Must be
exact, computed from logged fills.

## Rewind
Because the engine is seeded and deterministic, the user can scrub back to any moment and replay
it exactly. Implement via periodic snapshots + deterministic re-simulation from the nearest
snapshot.

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
  Required for fair "what if" reruns, rewind, multi-seed robustness tests, and deterministic
  tests.
- Multi-stock ready from day one: MarketRegistry holds one OrderBook per ticker.
- /engine has zero React/DOM imports so it is testable in isolation.
- Every fill records, for both sides, the order's arrival quote (bid, ask, mid, touch), its limit
  price (null for market orders) and its agent type, next to the executed price. The intended
  price for slippage is the arrival mid (implementation shortfall, D-010), so slippage is exact and
  splits into spread cost (mid → touch) and impact cost (touch → average fill); the agent types
  make attribution exact.
- Rejections return reason codes instead of throwing. Order flow (anything an agent or user
  sends: add, cancel) returns `{ ok: false, reason, message }` with a `RejectReason` code, so
  callers branch on data. Only engine misuse throws (e.g. `reduce` beyond an order's qty, an
  invalid `depth` limit, a bad tick size in a constructor), because that is a bug in our code.
- The worker sends one batched snapshot per frame to React, never individual trades. The
  engine may produce thousands of events per second; the worker coalesces them and posts at
  most one message per animation frame (quotes, depth, new candles, fills since last frame).

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

## Agent algorithms (use published models; cite them in the glass box)
- Crowd overall: Chiarella–Iori fundamentalist–chartist–noise (FCN) framework.
- MarketMaker: Avellaneda–Stoikov — quotes around an inventory-adjusted reservation price;
  spread widens with volatility and risk aversion.
- NoiseTrader: zero-intelligence orders arriving as a Poisson process.
- ValueTrader: trades toward a fair value that follows a random walk and jumps on news.
- MomentumTrader: moving-average crossover signal.
- PanicTrader: heterogeneous threshold cascade — each has a different drawdown pain point, so
  one panic triggers the next.
- Whale: execution algorithm slicing a large order (TWAP or percent-of-volume). Scenario
  variant: sells a fixed % of volume regardless of price (2010 Flash Crash style).

## Analytics
Log returns, rolling volatility, kurtosis (fat tails), autocorrelation of absolute returns
(volatility clustering), Sharpe, max drawdown, slippage / implementation shortfall, VWAP.
Stretch: Cholesky decomposition for correlated multi-stock moves.

## AI contracts (Zod schemas in /lib/schemas.ts)
- ScenarioParams: sentiment shift, fair-value shock %, volatility multiplier, market-maker
  liquidity multiplier, panic sensitivity, duration, severity (mild/severe/catastrophic), and a
  plain-English explanation of each change. UI shows these visibly and lets the user edit them.
  Values are clamped to sensible ranges, so weird headlines still map to sensible parameters.
- StrategySpec: hypothesis (text), entry rule, exit rules, position size, stop loss, take
  profit — from a fixed menu of rule types only.

## Glass box rules (must be exactly true)
- Python shown to users is GENERATED FROM THE StrategySpec USING TEMPLATES, never written by
  the LLM, so displayed code always matches what the engine ran.
- Formulas are shown with the user's actual numbers plugged in.
- Metric definitions are consistent everywhere: Sharpe = (mean return − risk-free rate) ÷
  std dev of returns, annualized using the SIM's actual clock (not a hardcoded 252 days).
  The formula, the displayed number and the displayed code must agree.
- Depth of explanation is handled by Learn/Pro modes and on-demand math (below), replacing the
  earlier Beginner/Intermediate/Advanced education-level slider.

## Math and code: layered, on demand (never cluttering the screen)
- Hover any metric → its formula with the user's real numbers plugged in.
- Click any agent type → its rule and the published model behind it (the market itself is a
  glass box).
- Full-screen glass box for the user's strategy: English → rules → formulas → Python (Python
  generated from templates, never by the LLM).

## Missions (structured learning)
Each mission = preset scenario + goal + user attempt + debrief + a line connecting it to real
finance careers. Missions double as ready-made professor assignments. Contest build: missions 1,
3 and 5. The rest come after the contest.
1. Make your first trade — order book and price formation (every trading role)
2. Be the market maker — spreads, liquidity, inventory risk (market-making firms)
3. Survive the headline — news, fair value, overreaction (event-driven funds)
4. Stop the crash, or cause it — cascades, liquidity spirals (risk management)
5. Buy 50,000 shares quietly — market impact, slippage, TWAP (bank execution traders)
6. Build your first strategy — hypothesis → rules → test (quant researcher)
7. Skill or luck? — overfitting, multi-seed testing, Sharpe (quant researcher / PM)

## Data
- Historical daily prices for a few tickers (index ETF, NVDA, AAPL, etc.) bundled as static
  files in /data, used to calibrate each stock's volatility, drift, beta and correlation.
- Regime presets (e.g. 2008, 2020, 2022) load era-specific volatility and macro settings.
- No live data at demo time.

## Execution quality bar
- Smooth 60fps (one batched snapshot per frame from the worker).
- No blank or broken states; AI failures show a friendly message; weird headlines still map to
  sensible, clamped parameters.
- Demo mode with rehearsed preset seeds, plus live mode for judges.
- Every number on screen is computed from the engine. Nothing is faked.

## Build order (components and dependencies)
1. OrderBook → 2. Matching Engine → 3. Seeded RNG + Sim Clock → 4. Basic agents →
5. Worker + event stream → 6. Chart / order book / trade feed UI → 7. Remaining agents + tuning →
8. Realism panel → 9. AI interpret route + ScenarioParams panel → 10. StrategySpec +
UserStrategyAgent + execution report → 11. Glass box → 12. Multi-stock + macro + regimes →
13. What-if reruns + Strategy Arena → 14. Polish.
Each step must work and be tested before the next depends on it. Scheduling follows the Roadmap
below: multi-stock, macro, regime presets and Strategy Arena (parts of 12–13) are now stretch.

## Roadmap
- Week 1 ✅ Done: repo, deploy, layout shell, OrderBook + 107 tests, 98% mutation score.
- Week 2 (Oct 2–10): matching engine + tests (market and limit orders, partial fills, fill log
  with agent types), seeded RNG + sim clock, worker + batched snapshots, Noise + MarketMaker
  (Avellaneda–Stoikov) + Momentum agents, live candlestick chart + tape, market alive on load,
  new layout and amber theme.
  Milestone: a realistic market moves on its own at page load.
- Week 3 (Oct 11–17): Value, Panic (threshold cascade) and Whale agents; depth view; crowd
  panel; narrator v1; attribution ("who moved the price?"); realism panel; tuning. Professor
  interviews this week.
- Week 4 (Oct 18–24): command bar; AI headline → clamped, editable parameters; your desk
  (manual trading, strategy agent, execution report with slippage); hover formulas; glass box
  reveal.
  Milestone: the full 90-second demo works end to end.
- Week 5 (Oct 25–31): missions 1, 3 and 5; Learn/Pro modes; rewind; what-if reruns; polish.
- Stretch only if ahead: multi-stock + macro + regime presets, Strategy Arena, option pricing.
- Nov 1–5: feature freeze, demo script, backup video, rehearsals.

Priority rule: learning features (missions, narrator, Learn mode) beat breadth features
(multi-stock, options). Depth over breadth.

## Conventions
- TypeScript strict mode. Small, focused commits with clear messages.
- Every engine change comes with Vitest tests. Run tests before committing.
- Plan before large changes: explain the plan, then implement.
- Visual style: see "Look" above (black, amber primary, green/red only for up/down, sharp
  borders). This replaces the earlier neon-green terminal aesthetic.
