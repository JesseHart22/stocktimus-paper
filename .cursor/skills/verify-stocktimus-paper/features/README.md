# Features

User-facing surfaces on the Stocktimus paper site. Drive them with **stocktimus-drive** (`helpers/drive.mjs`) after Launch and Doctor in `../SKILL.md`.

Numbers on screen come from the JSON files listed here. A `delayed` suffix is either those files' `marks_source` / `quote_quality`, or a Massive fallback quote the page actually received. Do not hardcode prices or P&L into these notes.

| Feature | Id | How a user opens it | Data |
| --- | --- | --- | --- |
| [Stocktimus paper book](stocktimus-paper-book.md) | `stocktimus-paper-book` | Site root, or the Stocktimus tab | `data.json` (summary overlay `trade-tracker-summary.json`) |
| [Moonshot desk](moonshot-desk.md) | `moonshot-desk` | Moonshot tab | `desks/moonshot.json` |
| [Compounder desk](compounder-desk.md) | `compounder-desk` | Compounder tab | `desks/compounder.json` |
| [Scoreboard tab](scoreboard-tab.md) | `scoreboard-tab` | Scoreboard tab, or `scoreboard.html` | `scoreboard/*.json` |
| [Jesse tab](jesse-tab.md) | `jesse-tab` | Jesse tab | `jesse/cc-tracker.json` |
| [Sleeve tab](sleeve-tab.md) | `sleeve-tab` | Sleeve tab | `sleeve/trades.json` |
| [Scalp tab](scalp-tab.md) | `scalp-tab` | Scalp tab | `scalp/scalp.json` |
| [Mark labeling](delayed-mark-label.md) | `delayed-mark-label` | Stocktimus, then the same book with routed mark fields | `data.json` as published, plus two routed copies. See `MARKS.md`. |

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive <id>
```
