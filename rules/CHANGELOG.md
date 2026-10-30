# Stocktimus rules changelog

Each trade is tagged with the rules version in effect on its entry date. Versions before v0.5 were reconstructed from desk notes on 2026-10-19.

## v0.7 beta (effective 2026-11-02)
Why: Oct 26-30 self-score. The paper book fell about 1.4% on the week, and the SLV leftover stock lot (about a fifth of the book at risk) lost more than the whole book did. Stock lots have carried the weekly loss three weeks running (SE, GOOGL, SLV), while every CSP and call that resolved this week was green.
- No single stock lot, leftover lots included, may carry more than ~10% of the book in capital at risk. Above that, trim toward the cap at the next brief while the name is at or above its out; a lot over the cap is Low until trimmed.
- An ETF or proxy lot standing in for a creator's thesis on another asset (SLV for silver) follows the same cap and gets its numeric out on the proxy, not the underlying.
- Unchanged: v0.6 CSP strike/out rules, hold rule, LIVE GATE, cluster exclusions.

## v0.6 beta (effective 2026-10-26)
Why: Oct 19-23 self-score. The paper book fell about 4.6% on the week. The SE cut, the SLV leftover, and two Danny mega-cap CSPs (GOOGL, AMZN) did most of the damage. Small OTM CSPs (UNH, UPS, ASTS) and the call rolls all came in green.
- A CSP's daily-close out must sit at or below its strike. If the source's invalidation sits above the strike, choose a lower strike or label it Low. (AMZN's $250 put had a $255.22 out, so it behaved like long stock.)
- When Fear & Greed is under 30, mega-cap CSPs need a strike at least ~7% out of the money to stay Medium. Otherwise they are Low.
- When earnings fall inside the expiry, a CSP stays Medium only with a strike at least ~8% out of the money, or at or below the bottom of the source's zone. Otherwise it is Low, or it waits until after the print.
- Every stock lot, leftover lots included, needs a numeric daily-close out. A thesis-only out ("leave TLI silver thesis") is Low and gets a numeric out at the next brief. SLV gets one on Oct 26.
- When the hold rule applies, the cut line is a close more than 5% under the out. A close 3-5% under the out does not start a hold; it is a cut.
- Unchanged: v0.5 hold rule, CSP-over-stock preference, LIVE GATE, momentum-cluster exclusions.

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
