# Stocktimus paper book → $250,000

**When:** 2026-09-28  
**Repo:** JesseHart22/stocktimus-paper  
**Branch:** main (GitHub Pages)

Paper desks (Stocktimus, Moonshot, Compounder) use a **$250,000** book. The live Agentic sleeve stays $25k outside this repo.

## Current account settings

| Field | Prior (2026-09-17) | Current |
|-------|--------------------|---------|
| **Account default** | $50,000 | **$250,000** |
| **Weekly target default** | $750 (1.5% of 50k) | **$3,750** (1.5% of 250k) |
| Standing ops | Fully deploy by default | **Unchanged** — cash only with an explicit strategic reason |

Published Stocktimus equity is still `starting_account + summary.paper_pnl` (250000 + 3022.72 = **$253,022.72**). The published weekly target is 1.5% of that equity (**$3,795.34**), not the $3,750 default. Moonshot and Compounder keep `weekly_target: 0`.

## Return % (unchanged rule)

All return % use **capital actually deployed** (never idle / never full book as denom):

- `weekly_return_% = week_PnL / week_avg_deployed`
- Cumul. ROC = compounded daily `PnL / daily_deployed`
- Avg $/week = `total_PnL / weeks` (dollars OK)
- Goal “% of capital” = `(Avg $/week) / avg_deployed`

## Deployed snapshot (2026-09-17, when the book was $50,000)

Historical only. These dollars are not the current book.

| Field | Value |
|-------|-------|
| **Book then** | **$50,000** |
| **Deployed now** | **~$13,070.50** |
| **Idle cash** | **~$36,929.50** |
| Weekly target then | $750 |

Hero shows **Deployed now** plus idle versus the current book. Return % never divide by the full book.

## Example week (deployed denom)

**ISO week Mon 2026-09-14**

| Field | Value |
|-------|-------|
| Week PnL | **$57.61** |
| Week avg deployed | **$13,070.50** |
| Weekly return % | **0.44%** = 57.61 / 13070.50 |
| Wrong if / full book (then $50k) | 0.12% (do **not** use) |

## Files touched

| File | Change |
|------|--------|
| `app.js` | `ACCOUNT=250000`, `WEEKLY=3750`, all three paper desks `defaultAccount=250000` |
| `index.html` | Weekly-goal placeholders have no dollar literal; `app.js` fills them from the file or `WEEKLY` |
| `styles.css` | Deployed tile + weekly % dep columns |
| `data.json` | `starting_account`, `account`, `weekly_target`, `max_per_trade`, note, and summary `account_pct` — **no trade rows** |
| `trade-tracker-summary.json` | `account`, `starting_account`, `weekly_target`, `max_per_trade`, session_note floor text |
| `desks/moonshot.json`, `desks/compounder.json` | `account`, note, and cash (undeployed remainder). Positions not resized |
| `DEPLOYED_PCT_FIX.md` / this file | Current book is $250k; 2026-09-17 figures stay historical |

**Not touched:** trade row fills and P&L, per-trade `paper_acct_pct`, live Agentic sleeve.

## Publish path

1. `/workspace/dashboard` → `C:\Users\jesse\stocktimus-paper\`
2. Same → `C:\Users\jesse\Projects\stocktimus-paper-push\`
3. Commit + push `origin main` (Pages from main)
