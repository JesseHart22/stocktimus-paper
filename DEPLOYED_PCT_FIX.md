# Stocktimus: return % uses capital actually deployed

**When:** 2026-09-17 ~08:50 PT  
**Repo:** JesseHart22/stocktimus-paper  
**Branch:** main  
**Message:** Paper UI: all return % use deployed capital (never / $25k book)

## Bug / requirement
Return percentages on the paper site must use **capital actually deployed** (capital at risk), not the full **$25,000** book. Idle cash must be visible so Jesse sees ~$12k working vs idle.

## Formulas (UI-side in `app.js`; no invented fills)

| Metric | Formula |
|--------|---------|
| **Daily deployed** | Sum of open lots’ `capital` / `capital_at_risk` that day, capped at account size |
| **Daily return** | `daily_PnL / daily_deployed` (0 if deployed = 0) |
| **Cumul. return on avg deployed** | Compound product of `(1 + daily_return) − 1` over session days (`computeDeployedRoc`) |
| **Weekly avg deployed** | Mean of daily deployed over that ISO week (Mon start) |
| **Weekly return %** | `week_PnL / week_avg_deployed` — **NEVER** `/ 25000` |
| **Avg $/week** | `total_PnL / weeks_running` (dollars; unchanged) |
| **% of capital / goal compare** | `(Avg $/week) / avg_deployed` — labeled “of avg deployed” |
| **Deployed now** | Capital at risk on latest session day |
| **Idle** | `account − current_raw_deployed` (can show idle even if raw > account after cap) |

## Example week (from existing trade data / `computeDeployedRoc` curve)

**ISO week starting Mon 2026-09-07**

| Field | Value |
|-------|-------|
| Week PnL | **$760.90** |
| Week avg deployed | **$19,851.60** |
| Weekly return % | **3.83%** = 760.90 / 19851.60 |
| Same week if wrongly / $25k | 3.04% (do **not** use) |

## Current deployed (as of 2026-09-17 book)

| Field | Value |
|-------|-------|
| **Deployed now** | **~$13,070.50** |
| Idle cash | **~$11,929.50** of $25,000 book |
| Avg deployed (session mean) | ~$21,879 |

## UI changes

1. Hero tile **Deployed now** — large $ + “Idle $X of $25k book”.
2. Weekly table columns: **Week · $ PnL · Avg dep · % dep** (`% dep` = PnL / that week’s avg deployed).
3. Cumul. ROC + goal “% of capital” bits all labeled as **deployed** denom.
4. Moonshot / Compounder “% of capital” tile uses **avg deployed**, not full book.

## Files published (UI only)

- `app.js`
- `index.html`
- `styles.css`
- `DEPLOYED_PCT_FIX.md`

**Not touched:** `data.json` trade rows, desks JSON, x.com, live marks.

## Publish path (Jesse PC)

1. `/workspace/dashboard` → `C:\Users\jesse\stocktimus-paper\`
2. Same UI files → `C:\Users\jesse\Projects\stocktimus-paper-push\`
3. Commit + `git pull --rebase origin main` + `git push origin main`
