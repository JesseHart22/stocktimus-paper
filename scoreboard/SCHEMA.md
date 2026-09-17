# X scoreboard JSON

Each desk writes **one file**. The paper site reads these on the **Scoreboard** tab (`#scoreboard`). This is not the paper book. Do not put trades in `data.json` or `desks/*.json`.

| Desk | Path |
| --- | --- |
| Stocktimus | `scoreboard/stocktimus.json` |
| Compounder | `scoreboard/compounder.json` |
| Moonshot | `scoreboard/moonshot.json` |
| Scout | `scoreboard/scout.json` |

## File

```json
{
  "desk": "stocktimus",
  "as_of": "2026-09-17T16:00:00-07:00",
  "calls": []
}
```

- `desk` must match the filename (`stocktimus` | `compounder` | `moonshot` | `scout`).
- `as_of` is when this file was written, with a timezone offset.

## Call

```json
{
  "id": "unique-within-file",
  "handle": "example_handle",
  "ticker": "EXAMPLE",
  "kind": "trade",
  "status": "closed",
  "direction": "long",
  "stars": 0,
  "signed_return": 0.05,
  "called_at": "2026-09-01",
  "note": "optional",
  "example": false
}
```

| Field | Required | Values |
| --- | --- | --- |
| `id` | yes | Stable id inside this file. |
| `handle` | yes | X handle, without a leading `@`. |
| `ticker` | yes | Symbol the call named. |
| `kind` | yes | `trade` \| `zone` \| `theme` |
| `status` | yes | `closed` \| `open` \| `no_fill` |
| `direction` | yes | `long` \| `short` |
| `stars` | yes | Integer. Extra posts **after** the first. `0` if the first post is the only one. |
| `signed_return` | closed only | Number as a fraction. `0.05` = +5%. Omit or `null` unless `status` is `closed`. |
| `called_at` | yes | `YYYY-MM-DD` of the **first** post (the call). |
| `note` | no | Short text. Shown as written. |
| `example` | no | `true` means sample data. Labeled **Example data** and **excluded from rankings and averages**. |

## Conviction and the 7-day rule

The **first post is the call**. Each later post by that **same handle**, naming the **same ticker**, in the **same direction**, adds **one star**. Stars are not extra scored calls.

**7-day rule:** a new pump inside 7 days of `called_at` adds a star and does **not** create a second graded call. "Inside 7 days" means the later calendar date is at least 0 and fewer than 7 days after the call (`Sep 1` + `Sep 7` collapses; `Sep 8` is a new graded call).

Write **one row per graded call** with `stars` already counted. The page also collapses extra rows that share handle + ticker + direction inside that window (each extra row adds `1 + stars`). Do not emit both the collapsed row and the raw pumps or stars will double-count.

`kind` of `zone` or `theme` follows the same rules. A `no_fill` stays on the log. It is not dropped.

## What gets ranked

Real rows only (`example` is not `true`), after the 7-day collapse:

- Rank handles by **average** `signed_return` of `status: "closed"` calls that have a numeric `signed_return`.
- Hit rate = count of those with `signed_return > 0` / that same count.
- Sample size `n` = that closed count.
- `n < 5` is marked **Provisional**.
- `open` calls are listed and left out of the average and the hit rate.
- `no_fill` stays visible and is left out of the average and the hit rate.
- A `signed_return` on a non-closed row is ignored.

## Refresh

Call log refreshes **weekly** (replace these JSON files). Rank rerate is **monthly**, when Chief of Staff asks on the 1st. There is no cron in this repo.
