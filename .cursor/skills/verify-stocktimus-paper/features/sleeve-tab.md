# Sleeve tab

Live Robinhood Agentic ledger. Header reads Sleeve / Agentic. Browser tab title is `Sleeve · Agentic`. The paper hero, return row, breakdowns, trade tables, and paper footer are hidden. The page uses Steel & Ember only while this tab is open.

## Sub-features

- Source pill reads `sleeve ledger`. The as-of time is the file `as_of`.
- Account value is `portfolio.total_value`. Cash is `portfolio.cash`. The page does not read `portfolio.pending_deposits` and does not parse deposits out of `notes`.
- Deployed is the sum of `open_positions.equity` `deployed_usd`. Sleeve budget is `sleeve_budget_usd`. Unrealized P&L is the sum of open equity `unrealized_pnl` when those marks are present. Realized P&L is the sum of `realized_trades`, or `$0.00` when that array is empty.
- Weekly income (the week containing `as_of`) and all-time income show covered-call net premium, dividends, scalps, assignment P&L, combined, return % vs deployed, and return % vs budget. Week figures come from `weekly_summary` (fallback `weeks`). All-time figures come from `income`. Return % vs deployed reads `week_return_pct_vs_capital`, then `week_return_pct`, and `income.roc_vs_deployed`. Return % vs budget reads `week_return_pct_vs_program` and `income.roc_vs_budget`. The page does not recompute those percents.
- Sub-nav is Open book and Trade blotter. Weekly summary appears when `weeks` or `weekly_summary` has rows and lists every Friday with the same buckets.
- Open book lists options above equity so active shorts are first. Within options, open shorts keep file order ahead of other sides. Each option row shows strike and, beside it, the underlying spot. Spot starts as the matching `open_positions.equity` `last`. A short call is marked ITM when that spot is at or above the strike, and OTM when it is below. **Price refresh** asks CNBC’s public quote endpoint for the open symbols and replaces spot and equity Last in memory. The line under the button reads `ledger marks · equity last` until then, and `live quotes · CNBC` after a quote lands. Unrealized and option credit stay the file’s marks. The page does not call Robinhood. Open covered calls come from `cc_trades`, then open orders. Dividends, scalps, and assignments stay in collapsed sections. Realized trades stay collapsed.
- Trade blotter is one row per `fills[]` entry. Desk is the file `desk_bucket` (`stocktimus`, `compounder`, `moonshot`, or `unknown_pre_ledger`).
- The masked account id in `account` may show. Rows are not invented.

## How to get to it (user POV)

Click **Sleeve** in the top bar. The address becomes `#sleeve`. The paper tables disappear and the ledger fills in. Account value and cash sit in the lead pair. Weekly income sits under that. Open book shows options above equity, with each strike’s underlying spot and an ITM or OTM mark on short calls. **Price refresh** updates those spots and equity Last from CNBC and labels the line `live quotes · CNBC`. **Weekly summary** lists every Friday. **Trade blotter** lists fills without reloading.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive sleeve-tab
```

The helper clicks `a.desk-tab[data-desk="sleeve"]` and waits until `#source-pill` reads `sleeve ledger`. It checks account value, cash, and the income buckets against `sleeve/trades.json`, the equity symbols and buckets, then clicks **Weekly summary** when weeks exist and checks each Friday. It then clicks **Trade blotter** and checks fill ids. It then clicks Stocktimus and waits for the paper book to return.

Screenshots: `evidence/sleeve-tab.png`, `evidence/sleeve-tab-summary.png`, `evidence/sleeve-tab-blotter.png`. Report: `evidence/sleeve-tab.json`.

## Gotchas

- Do not invent a mark, a cash balance, or an account value. Account value and cash are `portfolio.total_value` and `portfolio.cash` only. Income dollars and return percents are the file’s `income` and `weekly_summary` figures.
- Deployed capital is the sum of open equity `deployed_usd`, not `portfolio.equity_value`.
- `app.js` does not put `sleeve` in `DESKS`. Switching back to a paper tab calls `load()` again.
