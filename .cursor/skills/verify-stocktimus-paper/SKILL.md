---
name: verify-stocktimus-paper
description: >-
  Prove the Stocktimus paper book static site the way a user does: serve the
  repo root, doctor the desk JSON, drive a hash tab in headless Chrome, and
  keep evidence. Use when verifying jessehart22.github.io/stocktimus-paper,
  app.js desks, the scoreboard tab, or published paper marks. Never invent
  prices or P&L.
---

# Verify Stocktimus paper

Prove the site from the repo, not from memory. Every dollar figure comes from the JSON files loaded at run time, or from a delayed quote the Massive proxy actually returned on the fallback path. Do not invent prices or P&L, do not hardcode this week's totals into the skill, and do not treat a proxy quote as a fill.

Public site: https://jessehart22.github.io/stocktimus-paper/

The UI is one static page: `index.html`, `app.js`, `styles.css`, plus `scoreboard.js` / `scoreboard.css`. There is no bundler and no documented start script. `scoreboard.html` only redirects to `./#scoreboard`.

Hash tabs in `nav.desk-tabs`:

| Tab | Hash | What loads |
| --- | --- | --- |
| Stocktimus | `#stocktimus` (also the default when the hash is empty or unknown) | `./data.json`, then `./trade-tracker-paper.json`, then `../trade-tracker-paper.json`. Summary overlay: `./trade-tracker-summary.json`. CSV only if that book has zero tickets. |
| Moonshot | `#moonshot` | `./desks/moonshot.json` |
| Compounder | `#compounder` | `./desks/compounder.json` |
| Sleeve | `#sleeve` | `./sleeve/trades.json`. Robinhood Agentic live ledger. Not a paper book. Steel & Ember while this tab is open. Account value is `portfolio.total_value` and cash is `portfolio.cash`. Deployed is the sum of open equity `deployed_usd`. Weekly income reads `weekly_summary` (CC premium net, dividends, scalps, assignment, combined, return vs deployed). |
| Jesse | `#jesse` | `./jesse/cc-tracker.json`. Covered-call income tracker. Not a paper book. Clay & sage while this tab is open. Return on capital and Return on program come from `dashboard`. Weekly summary is a section on this tab, not a desk tab. |
| Scoreboard | `#scoreboard` | `./scoreboard/stocktimus.json`, `compounder.json`, `moonshot.json`, `scout.json`. This is the X call log, not the paper book. |

Paper marks assume fill at the recommended premium. The footer in `index.html` says so, and that it is not Jesse's actual fills and not advice. Published marks are the source of truth. See `MARKS.md`. When top-level `marks_source` contains `robinhood`, or `quote_quality` is `robinhood`, `live`, or `robinhood_live`, the pill and P&L subtitle say `Robinhood live`. When those fields name Massive or a delayed quote, the pill says `delayed` and the subtitle says `delayed MTM`. The page does not invent either field. It calls `MASSIVE_DELAYED_PROXY_URL` (`https://stock-prices-proxy.jessehartung.workers.dev`) only from `needsMassiveFallback`, when an open lot has no file mark and the payload is not a Robinhood success. That worker is delayed. Closed lots keep file `paper_pnl`.

Feature map: `features/README.md`.

## Launch

Serve the repo root over HTTP. `file://` leaves the book empty: `fetch` of the JSON fails and `app.js` tries the next path until the source pill stays `empty stub`.

From the repo root:

```bash
npm install --prefix .cursor/skills/verify-stocktimus-paper/helpers
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs launch
```

`launch` binds `python3 -m http.server` to `127.0.0.1` on a free port, writes `evidence/.run/server.json` (`pid`, `url`), and waits until `GET /` returns HTML. Run it again and it reuses a live server.

Chrome must be installed (`google-chrome` or `CHROME_PATH`). The driver uses `playwright-core` against that binary. It does not download a browser.

## Doctor

Doctor checks the tree and the local server before any click. It does not invent a book.

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs doctor
```

Hard failures (exit 1, written to `evidence/doctor.json`):

- Missing or unparseable `index.html`, `app.js`, `scoreboard.js`, `jesse.js`, `sleeve.js`, desk JSON, scoreboard JSON, `jesse/cc-tracker.json`, or `sleeve/trades.json`
- Desk file lists in `app.js` no longer match the paths above, the Jesse tab no longer fetches `./jesse/cc-tracker.json`, or the Sleeve tab no longer fetches `./sleeve/trades.json`
- Scoreboard `desk` field does not match its filename
- Duplicate ticket or call ids inside one file
- The mark contract is gone from `app.js` (`MASSIVE_DELAYED_PROXY_URL`, ` · delayed`, ` · Robinhood live`, `delayed MTM`, `needsMassiveFallback`, and no `startLiveMtm` poll)
- The footer no longer contains `Not advice`
- The local server is down, or `GET /` is not the paper page
- A desk or scoreboard URL on that server is not HTTP 200

Proxy reachability is recorded and is not a hard failure. The book still renders from JSON when the worker errors. `doctor.json` stores `proxy.ok`, the probed symbol (an open ticker from `data.json`), HTTP status, and whether a numeric `price` field was present. It does not store the price.

## Drive

Harness name: **stocktimus-drive** (`helpers/drive.mjs`).

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive stocktimus-paper-book
```

Other feature ids: `moonshot-desk`, `compounder-desk`, `scoreboard-tab`, `delayed-mark-label`, `jesse-tab`, `sleeve-tab`.

The driver opens the launched origin in headless Chrome, clicks the desk tab, waits until the loading copy is gone, and checks the DOM against the JSON it just read. It never types a price. Expectations that can move are computed in the helper from those files:

- Ticket ids on screen are exactly the ids in that desk file (scoreboard: handles and board files, after the page finishes fetching).
- Closed P&L text matches the sum of file `paper_pnl` on closed buckets (`out`, `closed`, `expired`, `skipped`, `no`, `resolved`, `invalidated`, `invalid`, `killed`). Live marks do not replace closed file P&L.
- Hero total matches file `summary.paper_pnl` unless the Massive fallback actually returned a quote in that drive. A `delayed` or `Robinhood live` suffix that came from the file still uses the file total. Do not overwrite the file number with a guessed quote.
- Account and weekly goal text use the file `account` / `weekly_target` (Stocktimus summary JSON overrides those two fields when present). The `$250,000` / `$3,750` constants in `app.js` apply only when a file omits them.
- Confidence chip: the helper clicks the first of High, Medium, Low that the file actually contains. Medium is displayed as `Med`.

`delayed-mark-label` reloads Stocktimus three times. The published pill follows the file’s top-level mark fields and does not call the proxy. A routed copy with `marks_source=robinhood` and `quote_quality=robinhood_live` shows `Robinhood live`, keeps the file total, and still does not call the proxy. A routed copy that clears those fields and the open-lot file marks requests the proxy. If that quote lands, the pill says `delayed`. If it does not, the pill stays unlabeled. Neither pill says real-time. The drive does not store the proxy price.

## Evidence

Proof files live in `.cursor/skills/verify-stocktimus-paper/evidence/` and are meant to be committed. Runtime pid and port stay in `evidence/.run/` (gitignored).

| File | When |
| --- | --- |
| `evidence/doctor.json` | After doctor |
| `evidence/<feature-id>.json` | After a drive. Checks, observed strings, file paths. No proxy price. |
| `evidence/<feature-id>-hero.png` | Paper desks, viewport of the loaded book |
| `evidence/<feature-id>-drawer.png` | Paper desks, ticket drawer open |
| `evidence/<feature-id>.png` | Scoreboard, the Massive fallback label, or a Sleeve screenshot |
| `evidence/sleeve-tab-summary.png` | Sleeve weekly summary |
| `evidence/sleeve-tab-blotter.png` | Sleeve trade blotter |
| `evidence/robinhood-mark-label.png` | Routed Robinhood live pill |
| `evidence/cleanup.json` | After cleanup. Lists files that were present and still present |

A drive writes its JSON and screenshots even when a check fails, then exits 1. Replace them by re-running after a fix. Do not hand-edit expected dollars into these files.

## Cleanup

Stop the static server. Leave evidence in place.

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs cleanup
```

Then confirm the proof files from the drive still exist and `evidence/.run/server.json` is gone. Cleanup exits 1 if a file it saw before stopping the server disappeared.

## Helpers

- `helpers/drive.mjs` — `launch`, `doctor`, `drive <feature-id>`, `cleanup`
- `helpers/package.json` — `playwright-core` only. Install with `npm install` in that directory. `node_modules` is gitignored.
- `features/*.md` — user-facing map. Selectors and copy in those files are from `index.html`, `app.js`, and `scoreboard.js`.

When selectors, desk paths, or the delayed-mark wording change, update the feature notes and re-run doctor plus the affected drive. Use `/maintain-verification-skill` for that upkeep. Do not paste the current P&L into the feature files.
