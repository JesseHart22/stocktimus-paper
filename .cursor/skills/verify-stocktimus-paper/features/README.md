# Features

User-facing surfaces on the Stocktimus paper site. Drive them with **stocktimus-drive** (`helpers/drive.mjs`) after Launch and Doctor in `../SKILL.md`.

Numbers on screen come from the JSON files listed here, or from a delayed proxy quote when the source pill says `delayed`. Do not hardcode prices or P&L into these notes.

| Feature | Id | How a user opens it | Data |
| --- | --- | --- | --- |
| [Stocktimus paper book](stocktimus-paper-book.md) | `stocktimus-paper-book` | Site root, or the Stocktimus tab | `data.json` (summary overlay `trade-tracker-summary.json`) |
| [Moonshot desk](moonshot-desk.md) | `moonshot-desk` | Moonshot tab | `desks/moonshot.json` |
| [Compounder desk](compounder-desk.md) | `compounder-desk` | Compounder tab | `desks/compounder.json` |
| [Scoreboard tab](scoreboard-tab.md) | `scoreboard-tab` | Scoreboard tab, or `scoreboard.html` | `scoreboard/*.json` |
| [Delayed-mark labeling](delayed-mark-label.md) | `delayed-mark-label` | Any paper desk after quotes load; the driver uses Stocktimus | Price proxy named in `app.js`. File marks stay if the proxy fails. |

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive <id>
```
