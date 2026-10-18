# Later

Low-severity review findings, parked so they don't block the day's build. High and Medium
findings are fixed immediately instead (CLAUDE.md, Daily process). Each entry: date, source,
file and line, the finding, and why it can wait.

| Date | Source | Where | Finding | Why it can wait |
| --- | --- | --- | --- | --- |
| 2026-10-17 | Codex Sunday review | `src/engine/volatility.test.ts:120-163` | The shock-response pin exercises the estimator and `computeQuotes` with a synthetic mid, but does not exercise `MarketMaker.act` or the visible spread in a live book. | The formula and quoted-price response are pinned; a live headline scenario belongs with Monday's fair-value shock work. |
