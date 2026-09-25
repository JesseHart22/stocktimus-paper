# Stocktimus paper book

Default desk. Browser tab title becomes `Stocktimus · Paper book`. The header reads Stocktimus / Paper book.

## Sub-features

- Hero snapshot: total, open, and closed paper P&L, weeks running, deployed now with idle cash, average dollars per week versus the file weekly goal, open / inv / out counts, hit rate
- Cumulative return on average deployed, with a weekly table (week, $ P&L, avg dep, % dep)
- Breakdown panels: by structure, by creator, by confidence
- Trade filters: All, This week, High, Medium, Low
- Open trades and closed trades tables. A row click opens the ticket drawer (notes, invalidation, paper P&L). Close with ×, the shade, or Escape
- Footer: paper marks assume fill at the recommended premium, not actual fills, not advice

## How to get to it (user POV)

Open the site. The Stocktimus tab is already selected when the address has no hash. Click **Stocktimus** in the top bar to return from another desk. The source pill leaves `loading` and names the file source. The book line under the counts says how many tickets are in view. Open and closed tables replace `Loading book…`.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive stocktimus-paper-book
```

The helper serves nothing by itself; run `launch` first. It then:

1. Opens the local origin and clicks `a.desk-tab[data-desk="stocktimus"]`.
2. Waits until `#stat-book-sub` matches the ticket count in `data.json` and the proxy request has settled or timed out.
3. Checks `#desk-name`, `#desk-sub`, document title, `#source-pill`, footer text, deployed-now subtitle account, weekly-goal label, closed P&L, and that every `tr[data-id]` is a ticket id from `data.json`.
4. Screenshots the viewport to `evidence/stocktimus-paper-book-hero.png`.
5. Clicks the first `#tbody-closed tr[data-id]`, checks `#d-title` and the drawer Paper P&L against that row's file `paper_pnl`, screenshots `evidence/stocktimus-paper-book-drawer.png`, then clicks `#drawer-close`.
6. Clicks the first confidence chip (High, then Medium, then Low) that `data.json` actually contains, and checks the visible rows.

Observations and pass/fail checks: `evidence/stocktimus-paper-book.json`.

## Gotchas

- `data.json` wins over `trade-tracker-paper.json`. The pill shows the JSON `source` string when it is not one of the built-in labels. Current files use `stocktimus-paper`, so the pill reads `stocktimus-paper` or `stocktimus-paper · delayed`. It does not read `data.json` unless the `source` field is missing.
- `trade-tracker-summary.json` overrides `account` and `weekly_target` for this desk only. Hero idle cash and the goal label follow that overlay, not the `$50,000` / `$750` defaults in `app.js`.
- Hero **open** and **inv** prefer `summary.open` and `summary.invalidated` when those fields exist. **Out** keeps the larger of `summary.out` and the counted closed buckets. Expired tickets are closed (`out`), not their own hero number. `leftover_shares` stays in the open table.
- Closed P&L is the sum of file `paper_pnl` on closed tickets. After a delayed mark, open P&L and the hero total can move. Do not "fix" a mismatch by typing a price.
- When `summary.resolved` equals the trade count, the page recomputes hit rate from closed marked tickets instead of `summary.hit_rate`.
- Medium confidence is painted as **Med**.
- **This week** is the current Monday–Sunday in `America/Los_Angeles`, compared to the ticket date. The helper does not drive that chip because the set depends on the clock.
- The `$750` string in `index.html` is placeholder copy before `app.js` runs.
