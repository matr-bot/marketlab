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
  `npm run test:mutation` (Stryker), `npm run test:e2e` (Playwright, after `npm run build`),
  `npm run bench`

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
   (slippage, split into spread cost and impact cost) and P&L.
4. REVEAL — BACKTEST in STRAT: English → rules → formulas with real numbers → Python.

## Non-goals (do not build unless explicitly asked)
- Real-money trading, brokerage connections, live market data dependencies
- User accounts / login, multiplayer, mobile-first layout
- Full options market or implied-volatility surface (stretch at most: simple option pricing)

## Design System (professional terminal; the UI overhaul, D-068 onward)
This section is the spec. It replaces the earlier amber-label design. The overhaul ships in steps
(✅ = shipped):

| Step | What ships |
| --- | --- |
| 1 ✅ | Color tokens (one file), amber in three places only, PAUSED badge (D-068) |
| 2 ✅ | Type hierarchy; panel numbers dropped (D-070) |
| 2b ✅ | Code-only panel titles, no panel scrollbars or fades, BOOK without SIDE, GP active (D-071) |
| 3 ✅ | Learn mode (`?learn=1`), abbreviation dictionary; ticker crawl, hint text and default-view sentences removed (D-072) |
| 4a ✅ | Status strip + playback + SESSION popover (D-073) |
| 4b / 4c | 65-35 grid + drawer / ticket tabs + code routing |
| 5 | Panel content (WHO table, TAPE B/S, BOOK tints, ticket one-line estimate) |
| 5.5 | Detail pass (self-hosted mono font, decimal alignment, chart crosshair, keymap) |
| 6 | Session launcher at `/`; the terminal at `/terminal` |

Functions that have not shipped are not drawn: no placeholder panels, never a blank or fake state.

### Principle
The terminal shows data. Explanation lives in HELP, tooltips and Learn mode. No sentences in the
default view; honest status and error replies (AI unavailable, values capped) are the exception.
MarketLab looks like a professional trading terminal so students move easily to real ones, but it
never uses a real company's name, logo or exact screens.

### Colors (`src/components/terminal/tokens.ts`, the only place a color may be written)
- Background `#000000`; panels `#0A0A0A`; borders `#1F1F1F`.
- Data `#E6E6E6`: all numbers. Labels `#7A7A7A`: panel titles, column headers, units, secondary text.
- Up `#26A65B` / down `#E5484D`: price direction (candles, last price and its flash, change, the TAPE
  price and arrow by tick). Also, as the side of the book: BOOK depth bars in muted tints, and the TKT
  BUY/SELL toggle when selected. TAPE's side column is a neutral gray B/S (D-067, refined by D-068).
- Accent amber `#F5A623`: ONLY the active panel's border, the one primary action on a screen (TKT
  SEND; START SESSION on the launcher) and the command-line cursor. `tokens.test.ts` enforces it.
- PAUSED: a white-on-red `● PAUSED` badge (`alert`), never amber and never the price-down red.
- Buttons (D-069): primary = amber fill, one per screen; secondary = outlined (transparent, 1px
  `#E6E6E6` border and text, square, `#1F1F1F` hover) for STRAT START, BACKTEST, the launcher's
  secondary actions, and STOP while a strategy runs; everything else a quiet gray chip. No filled
  white buttons.
- Focus ring white; text selection gray; hover rows `#141414`.

### Look
- One monospace font everywhere, tabular figures; numbers right-aligned so digits line up.
- 1px solid hairlines, sharp corners, no shadows, gradients or glow; dense rows, no big empty boxes.
- No LIVE badge or glowing dot; the moving numbers show it is live. Status labels: a permanent
  SIMULATED badge, and PAUSED while paused.
- Fictional ticker MLAB (D-041), never a real symbol.
- The market is already running when the terminal opens (calm regime, demo seed); a brief "OPENING
  MARKET" state covers a slow warm-up.

### Layout (target, D-068 onward)
```
┌ MLAB 186.93 −0.02 (−0.01%) │ BID 186.93 × 6,342  ASK 186.94 × 113 │ VOL 221.5K │ 09:40:20 │ ● PAUSED │ SIMULATED │ RUN 1X 2X 4X 8X RERUN LINK SESSION HELP ┐
├ > command line ───────────────────────────────────────────────────────────────────────────────────────────┤
│ CHART (~65% width, ~60% height)                                  │ BOOK                                   │
│                                                                  │                                        │
├──────────────────────────────┬───────────────────────────────────┼────────────────────────────────────────┤
│ TAPE                         │ WHO                               │ TICKET  [ORDER | FILLS | OPEN]          │
├──────────────────────────────┴───────────────────────────────────┴────────────────────────────────────────┤
│ drawer [STRATEGY | DESK | NEWS]  (collapsed by default)                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Panel titles are 11px gray uppercase (`TAPE`, `WHO · 60S`); no numbered boxes.
- EXR is the ticket's FILLS tab. STRAT, CHAT and NEWS share the bottom drawer: it opens on its code
  or a click, when a strategy starts, on a headline / panic / vacuum desk message, and (NEWS) when a
  non-free-play scenario loads. Once collapsed it stays shut until the next headline.
- Function codes: `GP`, `BOOK`, `TAPE`, `WHO` focus their panel; `TKT`, `EXR` select the ticket tab;
  `STRAT`, `CHAT`, `NEWS` open their drawer tab (replaces D-066's panel swapping).
- Playback (RUN / 1X 2X 4X 8X / RERUN / LINK) is a compact segmented control on the status strip;
  the selected speed is white on `#1F1F1F`. Scenario and seed are in the SESSION popover and on the
  launcher, so any run can still be reproduced.
- The GLASS BOX is a full-screen reveal opened from STRAT (`BACKTEST`), not a permanent panel.
- No scrolling ticker crawl and no bottom hint bar: TAPE and the command line cover them.
- Keyboard first: every primary action has a key (shown inside the control in label gray, e.g.
  `SEND ↵`); HELP lists the keymap. The mouse still works.

### Learn mode
`?learn=1` (a checkbox on the launcher). Every sentence removed from the default view lives in
`src/lib/explain.ts` and shows through `<Explain id>` only in Learn mode, together with HELP and the
hover explanations. Pro (the default) shows data only.

### Launcher (`/`)
Not a marketing page: no hero, gradients, adjectives, feature cards or emoji. Same tokens and font,
anchored top-left, keyboard-driven (arrows + Enter). Scenario list, seed (random by default,
editable), Learn mode, START SESSION (the one amber element). Footer: agents · limit order book ·
deterministic replay, version and short git SHA, HELP. Selections pass to `/terminal` as URL params;
old `/?scn=&seed=` links redirect there.

### Numbers must move like a real market
- Price movement comes ONLY from engine trades, never from UI animation or fake data.
- The stock starts around $187 with penny ticks.
- The tick flash (last price, changed book levels, ~150ms, up/down) is the only animation in the
  app. Other changing numbers get a brief neutral highlight. No sliding, counting-up, fades or
  transitions; the drawer and tabs open instantly.
- The tape and book update exactly when trades and orders happen; exact prices and sizes, never
  rounded.

### Desk chat (the narrator; deterministic, not AI)
Short desk-style updates generated by our code from engine events and the fill log, so every number
in them is true. It lives in the drawer's DESK tab.

## Command bar
Accepts function codes (`MLAB GP`, `BOOK`, `HELP`, …), commands (`SHOCK <headline>`, `RUN`,
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
- The real clock only decides HOW MANY ticks run, never what happens in them. A test pins it:
  two runs of the worker's tick loop with different frame timings give the identical fill log
  for the same number of ticks.

## Agents (Tier 1 set)
Common interface (D-023): an agent acts only at its own Poisson arrival times, never on a fixed
rhythm. `act(ctx)` receives the time, a read-only book view, the last trade price, the opening
price, its position, the mid's realized volatility (D-029 to D-032) and its own resting orders
(oldest first), and may `submit` or `cancel`; the simulation
stamps its owner id and agent type on every order. Each agent draws arrival times from
`arrivals/<id>` and decisions from `decisions/<id>`, so a behavior change never moves arrival
times. Computed prices become cents only through `toTick` (buys round down, sells up).
- MarketMaker — quotes both sides; widens spread and cuts size under stress/inventory risk
  (Avellaneda–Stoikov, D-033 to D-036; k = 1.5 from fill rates, D-049; skew and half-spread
  capped at 25¢, D-047)
- NoiseTrader — random small orders; baseline activity
- MomentumTrader — buys rising / sells falling prices
- ValueTrader — trades toward a belief about fair value (D-044)
- PanicTrader — dumps on sharp drops; sentiment-sensitive; rebuilds when calm (D-045)
- Whale — occasional very large orders
- UserStrategyAgent — executes a validated StrategySpec

Most agents are cheap rule-based code. The LLM shifts their parameters (sentiment, fair value,
risk tolerance, liquidity, activity rate); it never decides individual trades.

Tuning done Sun 10/18: noise traders spread out and widen with volatility (D-046: 4× volatility
now widens the visible spread from 1.43¢ to about 5¢); k recalibrated from fill rates (D-049).
What did not meet its target is in docs/LATER.md.

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
finance careers. Missions double as ready-made professor assignments. Contest build: cut unless
ahead of the roadmap (Mission 5 first, then 1 and 3). The rest come after the contest.
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
Done: Week 1 (repo, deploy, layout shell, OrderBook), Steps 1–3 (matching engine, seeded RNG +
sim clock, noise traders + simulation loop), Steps 4–5 (realized volatility + Avellaneda–Stoikov
market makers).

New priority: everything visible. The engine is strong; judges can only grade what they can see.

- **Sun 10/18 ✅ (done Sat 10/17):** Web Worker + terminal UI (status bar, ticker, `GP` chart, `TAPE`, `BOOK` basics)
  + market alive on load. Milestone: prices moving on the live site.
- **Mon 10/19 ✅ (done Sun 10/18, D-043 to D-049):** value traders (fair value), panic sellers
  (threshold cascade), headline shock = a fair-value jump; offline presets FED / CEO / BEAT /
  DOWNGRADE from the command bar; noise retune; k = 1.5 from fill rates. Open items in
  docs/LATER.md.
- **Tue 10/20 ✅ (done Sun 10/18, D-052 to D-055):** `/api/interpret` for headlines
  (claude-haiku-5-5) → clamped, editable parameters; `NEWS` input; `CHAT` narrator
  (deterministic); `WHO` attribution.
- **Added ahead of schedule (D-056 to D-061):** `TKT` manual trading through a deterministic
  command queue, `EXR` execution report (slippage split into spread and impact, P&L on the desk),
  `NEWS` scenario panel (slot 7 until `STRAT` ships), six assignable scenarios with `?scn=&seed=`
  links, PAUSE / RUN / SPEED / SEED / RERUN / LINK, `HELP` overlay, a bottom control strip.
- **Wed 10/21 ✅ (D-062 to D-066):** strategy agent from a fixed rule menu (StrategySpec via the same
  route, offline parser labelled offline), STRAT in slot 7, glass box (English → rules → formulas
  with real numbers → template-generated Python, proved equal to the engine by running it), Sharpe
  annualized with the sim clock and max drawdown, function codes in the active panel (NEWS by code).
  `TKT` ✅ done early.
- **Thu 10/22:** tuning; `EXR` ✅ done early. Open items in docs/LATER.md (GP trade markers, EXR
  subtotals by source, the live strategy-prompt check).
- **Fri 10/23:** feature freeze, bug bash, demo script, backup video.
- **Cut unless ahead:** momentum, whale, missions, full depth view, realism panel, Learn/Pro,
  rewind, what-if, `ASK`, shortcut strip.
- **If time:** Sharpe and max drawdown in `EXR` (they exist for the strategy, in STRAT and the glass
  box); a Limit Up–Limit Down band (±5% around the
  5-minute average price, the real rule for large stocks: a 15 s limit state, then a short trading
  pause), with CEO as the halt demo (D-051). When it is built, check FED on the demo seed (187) so
  the main demo never halts unexpectedly.

Never cut: the market moving on screen, the headline reaction, "who moved the price?", the
strategy agent + glass box, the execution report.

### Daily process
- One short plan per day. Build, then one Codex review at the end of the day.
- Fix High/Medium review findings immediately; list Low findings in `docs/LATER.md`.
- Mutation testing: engine code only, once per day before committing.
- UI: a Playwright smoke test (page loads, prices change within 5 seconds, no console errors)
  runs in CI next to typecheck, lint and unit tests.
- Never break the live site: check the Vercel deploy after every push.

## Conventions
- TypeScript strict mode. Small, focused commits with clear messages.
- Every engine change comes with Vitest tests. Run tests before committing.
- Plan before large changes: explain the plan, then implement.
- Visual style: see "Design System" above (tokens only, gray labels, white numbers, amber only for
  the active panel / primary action / cursor, sharp borders, keyboard first).
