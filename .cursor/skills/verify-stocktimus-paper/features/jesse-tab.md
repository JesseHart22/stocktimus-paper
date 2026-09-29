# Jesse tab

Covered-call income tracker. Header reads Covered Call Income / Jesse. Browser tab title is `Covered Call Income · Jesse`. The paper hero, return row, breakdowns, trade tables, and paper footer are hidden. The page uses the clay and sage theme only while this tab is open.

## Sub-features

- Source pill reads `cc tracker`. The as-of time is the file `as_of`.
- Dashboard uses position `program_capital`, covered cost derived from `cost_basis` and `open_cc_shares`, uncovered program capital (program minus that covered cost), open covered-call `premium_(net)`, and the sum of `weeks[].total_week_pnl`.
- Week buttons are `weeks[].week_ending`. The default week is the Saturday–Friday window that contains `as_of`. Choosing a week filters that week’s KPI row, allocation lines, and covered-call sells whose `cc_sell_date` falls in the window. It does not reload the page.
- Open book lists positions and covered calls with `called_away` Open.
- Closed and assigned (`Yes` and `Expired`) stay in a collapsed section.
- The file’s account id is not rendered.

## How to get to it (user POV)

Click **Jesse** in the top bar. The address becomes `#jesse`. The paper tables disappear and the covered-call book fills in. Pick another Friday to change the week tables.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive jesse-tab
```

The helper clicks `a.desk-tab[data-desk="jesse"]` and waits until `#source-pill` reads `cc tracker`. It checks the dashboard, the default week, then clicks a different `.js-week` and checks allocations and sells against `jesse/cc-tracker.json`. It then clicks Stocktimus and waits for the paper book to return.

Screenshots: `evidence/jesse-tab.png`, `evidence/jesse-tab-week.png`. Report: `evidence/jesse-tab.json`.

## Gotchas

- Do not invent a mark. Last, market value, premium, and week totals are copied from the file. Covered and uncovered dollars are cost-basis math from `shares`, `open_cc_shares`, `cost_basis`, and `program_capital`.
- `covered_capital`, `uncovered_shares`, and `uncovered_capital` on positions are not shown. In this export those three fields do not consistently mean shares or dollars.
- Open premium is the contracts still marked Open. Week totals already spread premium across `allocations`, so the two figures are not added together.
- `app.js` does not put `jesse` in `DESKS`. Switching back to a paper tab calls `load()` again.
