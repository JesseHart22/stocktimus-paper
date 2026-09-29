# Sleeve tab

Live Robinhood Agentic ledger. Header reads Sleeve / Agentic. Browser tab title is `Sleeve · Agentic`. The paper hero, return row, breakdowns, trade tables, and paper footer are hidden. The page uses Steel & Ember only while this tab is open.

## Sub-features

- Source pill reads `sleeve ledger`. The as-of time is the file `as_of`.
- Pending deposits are parsed from `notes` (the phrase “Pending deposit” plus a dollar amount). Deployed is the sum of `open_positions.equity` and `open_positions.options` `deployed_usd`. Sleeve budget is `sleeve_budget_usd`. Realized P&L is the sum of `realized_trades`, or `$0.00` when that array is empty.
- Account value, cash, unrealized P&L, and return on deployed stay an em dash. This ledger does not carry marks.
- Sub-nav is Open book and Trade blotter. Weekly summary appears only when `weeks` or `weekly_summary` has rows.
- Open book lists equity, options, and open orders. Empty books say so. Realized trades stay in a collapsed section.
- Trade blotter is one row per `fills[]` entry. Desk is the file `desk_bucket` (`stocktimus`, `compounder`, `moonshot`, or `unknown_pre_ledger`).
- The masked account id in `account` may show. Rows are not invented.

## How to get to it (user POV)

Click **Sleeve** in the top bar. The address becomes `#sleeve`. The paper tables disappear and the ledger fills in. Pending deposits sit in the lead pair. **Trade blotter** lists fills without reloading.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive sleeve-tab
```

The helper clicks `a.desk-tab[data-desk="sleeve"]` and waits until `#source-pill` reads `sleeve ledger`. It checks the KPI strip against `sleeve/trades.json`, the equity symbols and buckets, then clicks **Trade blotter** and checks fill ids. It then clicks Stocktimus and waits for the paper book to return.

Screenshots: `evidence/sleeve-tab.png`, `evidence/sleeve-tab-blotter.png`. Report: `evidence/sleeve-tab.json`.

## Gotchas

- Do not invent a mark, a cash balance, or an account value. Those fields are not in `sleeve/trades.json`.
- Pending deposits are not a portfolio field. They come from `notes` only.
- `app.js` does not put `sleeve` in `DESKS`. Switching back to a paper tab calls `load()` again.
