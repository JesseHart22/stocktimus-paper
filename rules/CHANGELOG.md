# Stocktimus rules changelog

Each trade is tagged with the rules version in effect on its entry date. Versions before v0.5 were reconstructed from desk notes on 2026-10-19.

## v0.5 beta (effective 2026-10-19)
Why: Oct 12-16 drawdown week (paper about -4%) and the Oct 17 backtests (`/workspace/briefs/backtest_hold_avgdown_2026-10-17.csv`, `backtest_breakeven_scan_2026-10-17.csv`).
- Prefer a CSP at or below the bottom of a source's stated zone over buying stock. TLI zones are CSP strikes at the zone bottom.
- High no longer earns bigger size. It needs a CSP structure or an out within ~5%. Medium still needs an out within ~7%.
- Danny momentum names are CSP-only or Low. Sandeman is demoted. Lucas and ZeroSum are watch-only.
- Extreme Fear (F&G under 25) or high SKEW: wider CSP strikes, smaller size, stage entries.
- Paper hold rule: if a name closes <3% under its out during a real market drop (SPY and QQQ both -1%+ on the week, or F&G <30), hold up to 5 trading days for break-even and keep selling calls at or above cost. Never add an averaging-down put. Cut at >5% under the out, at day 5, or on stock-specific news.
- LIVE GATE: never momentum-cluster names (ASTS, RKLB, NBIS, INTC, DRAM, HOOD, MRAM, EOSE) or names sources disagree on. Sleeve exits stay strict.
- Rejected after backtest: hold plus average-down with no break-depth limit (it would have lost about $2.8k more on paper and $3.6k more on Sleeve).

## v0.4 (effective 2026-10-14)
- Strict daily-close outs, plus an hourly Sleeve exit-flag watch (6:47 AM-12:47 PM PT) that forwards trips to Sleeve.
- Briefs moved to chat only, with no email.

## v0.3 (effective 2026-10-07)
- Scout high-juice 50 list used for CSP/CC paper plus LIVE GATE.
- Oct 9 lessons: Medium needs an out within ~7% of entry, buy TLI ranges in the lower half, cap the space/semis/crypto-beta cluster at ~35% of the book, keep ~10% cash.

## v0.2 (effective 2026-09-30)
- Ticket % = credit / cash to expiry, never annualized.
- Oct 2 lessons: High needs TLI+Danny overlap, a zone and a size cap. Prefer stock+CC/CSP over long calls. Size down single-feed Mediums in Extreme Fear.

## v0.1 (effective 2026-08-13, book start)
- Weekly covered stock+CC and occasional long calls from Danny, TLI and the X handles. Exit on a daily close under the stated out.
