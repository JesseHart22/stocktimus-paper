# Jesse tab

Covered-call income tracker. Header reads Covered Call Income / Jesse. Browser tab title is `Covered Call Income · Jesse`. The paper hero, return row, breakdowns, trade tables, and paper footer are hidden. The page uses the clay and sage theme only while this tab is open.

## Sub-features

- Source pill reads `cc tracker`. The as-of time is the file `as_of`.
- Dashboard uses position `program_capital`, covered cost derived from `cost_basis` and `open_cc_shares`, uncovered program capital (program minus that covered cost), and open covered-call `premium_(net)`.
- Income total, Assignment P&L total, and Overall total are separate cards. Income reads `dashboard.income_total`, then `dashboard.net_premium_daytrades_dividends`, then the sum of week income. Assignment reads `dashboard.total_assignment_pnl`, then the sum of `weeks[].assignment_pnl`. Overall reads `dashboard.overall_total`, then `dashboard.combined_income`, then the sum of week overall (`overall_total`, else `total_week_pnl`).
- Return on capital, Return on program, and Return on active read `dashboard.income_roc_vs_covered`, `income_roc_vs_program`, and `income_roc_vs_active`. Each falls back to the legacy `roc_vs_*` field. Average cards read `avg_weekly_income_only`, `avg_weekly_income_return_pct`, `avg_weekly_income_roc_vs_covered`, and `avg_weekly_income_roc_vs_program`, falling back to `avg_weekly_income` and `avg_weekly_roc*`. When the income field is present the subtitle is `income only (excl. assignment)`. Legacy fallbacks keep the combined subtitle. The page does not recompute these rates.
- Week buttons are `weeks[].week_ending`. The default week is the Saturday–Friday window that contains `as_of`. Choosing a week filters that week’s KPI row, allocation lines, and covered-call sells whose `cc_sell_date` falls in the window. It does not reload the page.
- **Weekly summary** is a section toggle on this tab, next to Open book. It lists every `weekly_summary` Friday: premium, fees, net, capital, Income (`income_total`), Income return % (`income_return_pct_vs_capital`), Assignment P&L (`assignment_pnl`), Overall (`overall_total`, else `total_week_pnl`), cumulative income, cumulative assignment, cumulative overall, and trade count. Income falls back to net plus day trades plus dividends, then to total week P&L minus assignment. Income return % falls back to `week_return_pct_vs_capital`, then `week_return_pct`. Cumulative cells use the file cumulative fields, then a running sum. The note explains the income / assignment / overall split. It does not follow the single-Friday picker.
- The open-book week strip shows Income, Income return %, Assignment P&L, Overall, and Income return % (vs program) for the selected Friday. Vs program reads `income_return_pct_vs_program`, then `week_return_pct_vs_program`. Rates use the same percent format as Return on capital.
- Open book lists positions and covered calls with `called_away` Open.
- Closed and assigned (`Yes` and `Expired`) stay in a collapsed section.
- The file’s account id is not rendered.

## How to get to it (user POV)

Click **Jesse** in the top bar. The address becomes `#jesse`. The paper tables disappear and the covered-call book fills in. Return on capital and Return on program sit above Income, Assignment P&L, and Overall. Pick another Friday to change the week tables. **Weekly summary** lists every Friday in the file.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive jesse-tab
```

The helper clicks `a.desk-tab[data-desk="jesse"]` and waits until `#source-pill` reads `cc tracker`. It checks the dashboard, including Return on capital and Return on program against `dashboard` in the JSON, the default week, then clicks a different `.js-week` and checks allocations and sells. It then clicks **Weekly summary** and checks every Friday row. It then clicks Stocktimus and waits for the paper book to return.

Screenshots: `evidence/jesse-tab.png`, `evidence/jesse-tab-week.png`, `evidence/jesse-tab-summary.png`. Report: `evidence/jesse-tab.json`.

## Gotchas

- Do not invent a mark. Last, market value, premium, and week totals are copied from the file. Covered and uncovered dollars are cost-basis math from `shares`, `open_cc_shares`, `cost_basis`, and `program_capital`. Return on capital and Return on program are the dashboard income ROC percents, or the legacy `roc_vs_*` percents when those income fields are absent. Income return % uses `income_return_pct_vs_capital`, then `week_return_pct_vs_capital`, then `week_return_pct`. Income return % (vs program) uses `income_return_pct_vs_program`, then `week_return_pct_vs_program`. The page does not recompute those percents. Tracker rates are fractions, so a value above 1 still renders times 100.
- `covered_capital`, `uncovered_shares`, and `uncovered_capital` on positions are not shown. In this export those three fields do not consistently mean shares or dollars.
- Open premium is the contracts still marked Open. Week totals already spread premium across `allocations`, so the two figures are not added together.
- `app.js` does not put `jesse` in `DESKS`. Switching back to a paper tab calls `load()` again.
