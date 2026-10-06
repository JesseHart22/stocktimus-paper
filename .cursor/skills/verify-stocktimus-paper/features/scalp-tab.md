# Scalp tab

Paper scalp book. Header reads Scalp / Paper only. Browser tab title is `Scalp · Paper`. The paper hero, return row, breakdowns, trade tables, and paper footer are hidden. The page uses the clay and sage theme only while this tab is open. A banner reads `Paper only · never live · never Sleeve`.

## Sub-features

- Source pill reads `paper ledger`. The as-of time is the file `as_of`, in the header and in the summary strip.
- Paper equity is ledger cash plus capital still in open tickets. Capital is a dollar field on the ticket (`capital`, `capital_usd`, `deployed_usd`, `cost_basis`, `notional_usd`, `risk_usd`, `open_risk`, `premium_usd`, `debit_usd`, `credit_usd`). With no open tickets, equity is cash. The subtitle names the paper budget when that field is present. Bid, ask, and fill are not turned into dollars.
- Cash is `cash`. Open risk is $0.00 when `open` is empty. Daily P&L is `daily_pnl`. Week P&L is `week_pnl`.
- Playbook A and Playbook B copy `rules.playbook_a` and `rules.playbook_b`. A row is tagged A or B only when that row has `playbook`, `playbook_id`, `book`, or `setup`.
- Open positions list `open`. Recent closed lists `closed`. Quote tries list `quote_tries`. Empty arrays show an empty state.
- A row's mark columns are `rh_bid`, `rh_ask`, `fill`, and `minute_ts` on the ticket, or on its last `fills` entry when the ticket itself has none. Missing cells stay blank. The page does not call the quote proxy.

## How to get to it (user POV)

Click **Scalp** in the top bar. The address becomes `#scalp`. The paper tables disappear and the scalp book fills in. The banner says the book is paper only.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive scalp-tab
```

The helper clicks `a.desk-tab[data-desk="scalp"]` and waits until `#source-pill` reads `paper ledger`. It checks the summary against `scalp/scalp.json`, the playbook rule text, and the empty states. It then clicks Stocktimus and waits for the paper book to return.

Screenshot: `evidence/scalp-tab.png`. Report: `evidence/scalp-tab.json`.

## Gotchas

- Do not invent a mark. Do not add the bid and ask and divide. Do not call Robinhood or the Massive proxy from this tab.
- This file is not Sleeve. Sleeve stays on `#sleeve` and reads `sleeve/trades.json`.
- `app.js` does not put `scalp` in `DESKS`. Switching back to a paper tab calls `load()` again.
