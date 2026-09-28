# Compounder desk

Header reads Compounder / Long-term book. Browser tab title is `Compounder · Paper book`.

## Sub-features

- Same hero, breakdowns, filters, tables, and ticket drawer as the other paper desks
- **Return on avg deployed** when `weekly_target` is 0
- Cash subtitle from file `cash`
- Source pill label `compounder` (the file's `source` value, which is in the label map)

## How to get to it (user POV)

Click **Compounder** in the top bar. The address becomes `#compounder`. Wait until the ticket line and tables leave the previous desk's rows.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive compounder-desk
```

The helper clicks `a.desk-tab[data-desk="compounder"]` and checks the DOM against `desks/compounder.json` the same way as Moonshot:

- Name `Compounder`, subtitle `Long-term book`, title `Compounder · Paper book`
- Pill `compounder · delayed` because top-level `quote_quality` is `delayed_15m_polygon`
- Cash line, return-on-deployed label, closed file P&L, row ids, footer
- Drawer on the first closed row, then a confidence chip the file contains

Screenshots: `evidence/compounder-desk-hero.png`, `evidence/compounder-desk-drawer.png`. Report: `evidence/compounder-desk.json`.

## Gotchas

- This file has a `summary`. Hero total P&L prefers `summary.paper_pnl`. The delayed label comes from `quote_quality`. Open lots already have file marks, so the proxy does not replace that total.
- Closed P&L is not taken from `summary`. It stays the sum of file `paper_pnl` on closed buckets.
- `app.js` default account for this desk is `25000` only when the JSON omits `account`. The file sets `account` itself. Do not expect the default.
- Marks are the file's delayed quote. Drawer Paper P&L for a closed row matches that row's file `paper_pnl`.
- The note in the JSON is not the footer. The footer is the shared disclaimer in `index.html`.
