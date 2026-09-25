# Scoreboard tab

X call log. Header reads Scoreboard / X calls. Browser tab title is `Scoreboard · X calls`. The paper hero, return row, breakdowns, trade tables, and footer are hidden.

## Sub-features

- Amber banner: sample rows are example data and are not scored
- Note: call log refreshes weekly; rank rerate is monthly when asked on the 1st
- Rule: first post is the call; a later same-handle, same-ticker, same-direction post inside 7 days adds a star and is not a second graded call; rank is the average signed return of closed graded calls; n < 5 is Provisional; open calls and no-fills stay on the log and out of the average
- One board per file: Stocktimus, Compounder, Moonshot, Scout. Each board has a rank table and a call log
- Rows with `example: true` show an **Example data** pill and are excluded from rank
- Source pill reads `x log`

## How to get to it (user POV)

Click **Scoreboard** in the top bar, or open `scoreboard.html` (it redirects to `./#scoreboard`). The paper tables disappear. Boards fill in under the rules. An empty file says there are no calls. A board with no closed graded calls says no scored handles yet.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive scoreboard-tab
```

The helper clicks `a.desk-tab[data-desk="scoreboard"]` and waits until `#scoreboard-boards` no longer says `Loading call logs…`. It then checks:

- `html` has class `view-scoreboard`, `#scoreboard-view` is not hidden, and `.hero` is `display: none`
- `#desk-name` / `#desk-sub` / title / `#source-pill` (`x log`)
- Banner, weekly-refresh note, and the "First post is the call" rule are visible
- Boards `#sb-stocktimus`, `#sb-compounder`, `#sb-moonshot`, `#sb-scout` exist
- Each file's handles appear as `@handle` on that board
- An empty `calls` array shows `No calls in this file.`
- The number of `.sb-pill.ex` elements equals the number of `example: true` calls across the four files

Screenshot: `evidence/scoreboard-tab.png`. Report: `evidence/scoreboard-tab.json`.

## Gotchas

- Scoreboard numbers are signed returns in the scoreboard JSON, not paper-book P&L. Do not compare a board to `data.json`.
- The amber banner is static HTML. It stays up even when every row has `example: false`. The **Example data** pill is per row.
- The page collapses same handle + ticker + direction inside 7 days before ranking. The "on the log" count can be lower than the raw array length. The driver checks handles, not a hardcoded call count.
- `open` and `no_fill` stay on the log and out of the average. Rank copy for no closed graded calls is `No scored handles yet. Example rows are not ranked.`
- `app.js` does not put `scoreboard` in `DESKS`. Switching back to a paper tab calls `load()` again.
- There is no cron in this repo. Schema text says the log is refreshed by replacing the JSON files.
