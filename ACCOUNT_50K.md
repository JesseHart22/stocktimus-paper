# Stocktimus paper book → $50,000

**When:** 2026-09-17 ~08:55 PT  
**Repo:** JesseHart22/stocktimus-paper  
**Branch:** main (GitHub Pages)

## New account settings

| Field | Old | New |
|-------|-----|-----|
| **Account** | $25,000 | **$50,000** |
| **Weekly target** | $375 (1.5% of 25k) | **$750** (1.5% of 50k) |
| Standing ops | — | **Fully deploy capital by default**; cash only with explicit strategic reason |

## Return % (unchanged rule)

All return % use **capital actually deployed** (never idle / never full book as denom):

- `weekly_return_% = week_PnL / week_avg_deployed`
- Cumul. ROC = compounded daily `PnL / daily_deployed`
- Avg $/week = `total_PnL / weeks` (dollars OK)
- Goal “% of capital” = `(Avg $/week) / avg_deployed`

## Current deployed (as of 2026-09-17, after $50k book)

| Field | Value |
|-------|-------|
| **Book** | **$50,000** |
| **Deployed now** | **~$13,070.50** |
| **Idle cash** | **~$36,929.50** |
| Weekly target | $750 |

Hero shows **Deployed now** prominently + idle vs $50k book.

## Example week (deployed denom)

**ISO week Mon 2026-09-14**

| Field | Value |
|-------|-------|
| Week PnL | **$57.61** |
| Week avg deployed | **$13,070.50** |
| Weekly return % | **0.44%** = 57.61 / 13070.50 |
| Wrong if / $50k | 0.12% (do **not** use) |

## Files touched

| File | Change |
|------|--------|
| `app.js` | `ACCOUNT=50000`, `WEEKLY=750`, Stocktimus desk defaults |
| `index.html` | $750 goal placeholders; deployed tile |
| `styles.css` | Deployed tile + weekly % dep columns |
| `data.json` | `account`, `weekly_target`, standing-ops `note` only — **no trade rows** |
| `trade-tracker-summary.json` | `account`, `weekly_target`, session_note floor text |
| `DEPLOYED_PCT_FIX.md` / this file | Formulas + numbers |

**Not touched:** trade row fills, desks Moonshot/Compounder sizes, x.com, live.

## Publish path

1. `/workspace/dashboard` → `C:\Users\jesse\stocktimus-paper\`
2. Same → `C:\Users\jesse\Projects\stocktimus-paper-push\`
3. Commit + push `origin main` (Pages from main)
