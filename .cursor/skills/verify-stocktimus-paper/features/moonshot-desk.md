# Moonshot desk

Header reads Moonshot / 10x sleeve. Browser tab title is `Moonshot · Paper book` (the title suffix stays "Paper book" for every non-scoreboard desk).

## Sub-features

- Same hero, breakdowns, filters, open/closed tables, and ticket drawer as the Stocktimus book
- Weekly goal tile switches to **Return on avg deployed** because this file's `weekly_target` is 0
- P&L subtitle shows cash from the file when `cash` is set, plus `delayed MTM` only after a proxy quote
- Footer disclaimer stays visible

## How to get to it (user POV)

From the paper site, click **Moonshot** in the top bar. The address becomes `#moonshot`. The source pill changes when the desk file finishes loading. Open trades and closed trades list only this sleeve.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive moonshot-desk
```

The helper clicks `a.desk-tab[data-desk="moonshot"]`, waits until `#stat-book-sub` matches the ticket count in `desks/moonshot.json`, and checks:

- Name, subtitle, title, and the active tab
- Pill is `paper json` or `paper json · delayed`. The file's `source` is `"paper"`, and `app.js` maps that word to the label `paper json`. That label does not mean `trade-tracker-paper.json` loaded.
- Cash subtitle starts with the formatted file `cash`
- `#stat-target-k` is `Return on avg deployed`
- Closed P&L matches file `paper_pnl` on closed tickets
- Row ids match the file
- Drawer on the first closed row, then one confidence chip that the file contains

Screenshots: `evidence/moonshot-desk-hero.png`, `evidence/moonshot-desk-drawer.png`. Report: `evidence/moonshot-desk.json`.

## Gotchas

- This desk does not read `data.json` or the summary overlay. Account and weekly target come from `desks/moonshot.json` only. Defaults in `app.js` (`5000` / `0`) apply only if those fields are missing. The file currently sets its own account.
- There is no `summary` object, so the hero total before a delayed mark is the sum of ticket `paper_pnl`. After `delayed`, open stock lots are remarked from the proxy and the total can change. Closed lots stay on file `paper_pnl`.
- `marks_source` in the JSON points at the same delayed worker. `quote_quality` is a file note; the on-screen delayed wording is still the source pill, not this field.
- Cash subtitle replaces the "Open … · Closed …" line. Closed dollars stay in `#stat-closed-pnl`.
- Do not invent a moonshot fill. Entry and `paper_pnl` in the drawer must match the file for a closed row.
