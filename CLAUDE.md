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

## Design System (terminal-style; replaces the earlier "Look" and neon-green rules)
This section is the spec. The UI is built only once live engine data is flowing (Week 2 Step 8),
then grows week by week with the roadmap:

| Week | Design parts that ship |
| --- | --- |
| Week 2 (Step 8) | Theme (black / amber / white, flash rules), status bar, scrolling ticker, default-layout grid, `GP` (price chart), `TAPE`, `BOOK` basics (best bid/ask, top levels) |
| Week 3 | `CROWD`, `CHAT` (desk chat / narrator), full `BOOK` depth view, `WHO` (click a candle in `GP`) |
| Week 4 | Command bar (function codes, commands, headlines) and shortcut strip, `NEWS` input, `TKT`, `EXR`, `STRAT` + glass box reveal, `HELP`, hover explanations and formulas |
| Week 5 | Learn / Pro modes with the per-panel "On a professional terminal…" notes, rewind with the `REPLAY` label, `ASK` |

Until a function ships, its slot in the default layout is simply not drawn (the grid closes up);
there are no placeholder panels, so there is never a blank or fake state.

### Goal
MarketLab looks and feels like a professional trading terminal, so students who learn here can
move easily to real terminals on a trading floor. Terminal-style, but NEVER use any real
company's name, logo or exact screens.

### Colors and look
- Pure black background.
- AMBER (orange-gold) for labels, panel headers and UI text.
- WHITE for numbers and data.
- GREEN and RED ONLY for price direction (up / down). Nothing else is green or red, with one
  named exception: the bottom shortcut strip's key colors (see Layout), as on real terminal
  keyboards.
- Monospace font, small and dense; numbers right-aligned so digits line up.
- Thin, solid borders with sharp corners. No dashed lines, rounded corners, shadows or gradients.
- Dense rows and tight spacing; no big empty boxes.

### No "AI dashboard" tells
- No LIVE badge, glowing dot or "live" indicator anywhere. The moving numbers show it is live.
- The only status label is a small REPLAY label, shown during rewind.
- The market is ALREADY RUNNING when the page loads (calm regime, demo seed). Never show
  "engine not running" as a first impression.

### Layout
- **Top status bar:** ticker, last price, change and % change, volume, sim clock.
- **Scrolling ticker tape** under the status bar: one thin strip where every trade slides
  sideways, like an exchange ticker. Format: `SPY 1,340 @ 187.42 ▲`, green or red by whether the
  trade was up or down from the previous trade. Injected headlines scroll through it in amber. It
  speeds up when trading is busy and slows when it is quiet. The ticker is the ONE place smooth
  scrolling is allowed; the numbers inside it never animate.
- **Command bar:** typing a code such as `SPY GP` and pressing Enter opens that function in the
  active panel (see Command bar below).
- **A grid of numbered panels** (1, 2, 3, …). Each header shows its number and code, e.g.
  `1 GP · SPY PRICE`. Typing a code opens that function in the active panel; the default layout
  below is what every page load shows.
- **Bottom shortcut strip** with color-coded keys: yellow for market/function keys, green for
  GO/Enter, red for cancel/Esc.
- **Keyboard first.** The mouse still works, but everything can be done by typing.
- **Sim controls** (play/pause, speed 1x/4x, regime, seed, rerun, what-if, Learn/Pro) are
  command-bar commands and shortcut keys, not buttons scattered across panels. The seed is always
  visible so any run can be reproduced.
- The GLASS BOX is a full-screen reveal opened from STRAT ("Show me what I built"), not a
  permanent panel.

### Default layout (what the page shows on load)
It follows the demo story, cause → reaction → your result → reveal, and the whole 90-second demo
works from it without opening any panels.

```
┌ status bar: SPY  187.42  +0.35 +0.19%  VOL 1,204,300  09:41:27.300  SEED 187 ──────────────┐
├ ticker: … SPY 1,340 @ 187.42 ▲ … SPY 200 @ 187.41 ▼ … FED SURPRISE HIKE 75BPS … ──────────────┤
├ command bar: > _ ───────────────────────────────────────────────────────────────────────────┤
│ 1 GP · SPY PRICE                                          │ 5 BOOK · SPY DEPTH              │
│ (largest panel: ~2/3 width, ~half the height;            │                                 │
│  candles + headline and trade markers)                    ├─────────────────────────────────┤
│                                                           │ 6 TKT · ORDER TICKET            │
├─────────────────────────────┬─────────────────────────────┼─────────────────────────────────┤
│ 2 CROWD · WHO IS TRADING    │ 3 CHAT · DESK CHAT          │ 7 STRAT · STRATEGY              │
├─────────────────────────────┴─────────────────────────────┼─────────────────────────────────┤
│ 4 TAPE · TIME & SALES                                     │ 8 EXR · EXECUTION REPORT        │
└ shortcut strip: [F1 HELP] [F2 GP] [F3 BOOK] …  [GO] [CANCEL] ─────────────────────────────────┘
```

- **Left, cause → reaction:** `1 GP` is the largest element. `2 CROWD` and `3 CHAT` sit right under
  it, so when a headline hits, the price move, who is trading and the desk's commentary are all in
  view at once. `4 TAPE` is directly below them.
- **Right, the market and your desk:** `5 BOOK` (depth) on top, then the user's desk:
  `6 TKT` (manual buy/sell), `7 STRAT` (type a strategy; "Show me what I built" opens the glass
  box) and `8 EXR` (slippage, P&L, Sharpe, drawdown).
- **Demo path with no panels opened:** idea → type it in `7 STRAT`; market → type the headline in
  the command bar, watch `1 GP`, `2 CROWD`, `3 CHAT` and the ticker; reality check → `8 EXR`;
  reveal → "Show me what I built" in `7 STRAT`.
- `NEWS`, `WHO`, `ASK` and `HELP` open in the active panel on demand. Headlines entered in the
  command bar also scroll through the ticker in amber.

### Function codes
| Code | Function |
| --- | --- |
| `GP` | Price chart (candles, with event markers for headlines and user trades) |
| `BOOK` | Order book depth |
| `TAPE` | Time & sales |
| `NEWS` | Headline feed and headline input |
| `TKT` | Order ticket: buy/sell, limit/market |
| `EXR` | Execution report: slippage (spread + impact), P&L, Sharpe, drawdown |
| `STRAT` | Strategy builder and glass box |
| `WHO` | Who moved the price (attribution) |
| `ASK` | Ask a plain-English question, answered from real engine data (see AI contracts) |
| `CHAT` | Desk chat: the narrator's running commentary |
| `HELP` | List of all codes |
| `CROWD` | Each agent type's mood, position and activity (Week 3) |

### Desk chat panel (the narrator; deterministic, not AI)
The narrator posts short updates like a colleague on a trading desk, e.g. "Big seller hitting
bids, 62% of flow is panic selling." It is generated by our own code from engine events and the
fill log, so every number in it is true. In Learn mode it also says where to look.

### Learn mode and Pro mode
- LEARN mode (default): fewer panels, plain-English labels, the desk chat guides attention, and
  each panel carries a short note: "On a professional terminal, this is called ___. Traders use
  it to ___." That is the bridge to real trading.
- PRO mode: full dense terminal with every panel visible.
- Every metric and label has a plain-English hover explanation (e.g. SPREAD: "The gap between
  the best buy and sell price. Wider means it costs more to trade.").

### Numbers must move like a real market
- Price movement comes ONLY from engine trades, never from UI animation or fake data.
- The stock starts at a realistic price (around $187, penny ticks: tick size 1 cent).
- When a PRICE changes, it flashes green (up) or red (down) versus the previous price for a split
  second, then returns to white. Every other changing number (volume, sizes, the clock, counts)
  gets a brief neutral highlight, then returns to white, because green and red mean price
  direction only. No sliding or counting-up animations.
- The tape, ticker and order book update exactly when trades and orders happen, so busy moments
  look busy and quiet moments look quiet.
- Exact prices and sizes (e.g. 1,340 shares), never rounded.

## Command bar
Accepts function codes (`SPY GP`, `BOOK`, `HELP`, …), commands (`SHOCK <headline>`, `RUN`,
`PAUSE`, `REWIND`, `RERUN`, `WHATIF`) and plain words. Known codes and commands are matched
first; any other input is treated as a headline. Friendly errors, never crashes.

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
- AskQuery (for `ASK`): the LLM maps a plain-English question to one query from a
  fixed menu (e.g. "volume by agent type between t1 and t2", "spread now vs before the
  headline"), validated with Zod. Our code computes the answer from engine data and writes every
  number into the reply. The LLM never writes a number. Same `/api/interpret` route, so it stays
  the only network call.

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
- Every market number on screen comes from engine state. Nothing is faked. (UI values such as
  the seed, the sim clock and panel numbers are not market numbers.)

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
  Tuning target: trades arrive in uneven bursts, never at a steady rhythm, and big moves cluster
  together like a real market (volatility clustering).
- Week 4 (Oct 18–24): command bar; AI headline → clamped, editable parameters; your desk
  (manual trading, strategy agent, execution report with slippage); hover formulas; glass box
  reveal.
  Milestone: the full 90-second demo works end to end.
- Week 5 (Oct 25–31): missions 1, 3 and 5; Learn/Pro modes; rewind; what-if reruns; polish.
- Stretch only if ahead (after the contest essentials): multi-stock + macro + regime presets,
  Strategy Arena, option pricing, supply chain mapping, bonds.
- Nov 1–5: feature freeze, demo script, backup video, rehearsals.

Priority rule: learning features (missions, narrator, Learn mode) beat breadth features
(multi-stock, options). Depth over breadth.

## Conventions
- TypeScript strict mode. Small, focused commits with clear messages.
- Every engine change comes with Vitest tests. Run tests before committing.
- Plan before large changes: explain the plan, then implement.
- Visual style: see "Design System" above (black, amber labels, white numbers, green/red only
  for price direction, sharp borders, keyboard first). This replaces the earlier neon-green
  terminal aesthetic.
