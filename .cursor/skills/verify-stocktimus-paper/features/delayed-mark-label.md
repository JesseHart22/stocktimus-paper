# Delayed-mark labeling

Open paper tickets can be remarked from the price proxy. The UI must call those marks delayed, never real-time.

## Sub-features

- `#source-pill` gains ` · delayed` when a proxy quote is applied
- `#stat-pnl-sub` gains `delayed MTM` on that same update (on the cash line when the desk JSON has `cash`, otherwise on the open/closed line)
- Closed tickets keep the file `paper_pnl` and file live mark is not replaced by a fresh quote for the hero closed total
- If the proxy errors, the pill stays on the file source and no price is invented

## How to get to it (user POV)

Open any paper desk that has a lot in status `open`, `proposed`, `live`, `taken`, or `yes`. Within a few seconds the source pill, which already names the file, adds `· delayed`, and the line under total P&L mentions `delayed MTM`. The as-of clock can move to the quote time. Refresh is every 30 seconds. If the worker is down, the book still shows file marks and the pill does not say delayed.

The scoreboard pill stays `x log`. It does not use this proxy.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive delayed-mark-label
```

The helper opens Stocktimus (the desk most likely to have open lots), waits for the proxy response or an 8 second timeout, and checks:

- The book loaded (`#stat-book-sub` matches `data.json`)
- `#source-pill` and `#stat-pnl-sub` do not contain `real-time` or `realtime`
- If the worker returned a numeric `price` for an open ticker, the pill contains `delayed` and the subtitle contains `delayed MTM`
- If it did not, the outcome is `file-marks-only`: the pill has no `delayed` suffix and the ticket ids still match the file

The price itself is not written to evidence. Screenshot: `evidence/delayed-mark-label.png`. Report: `evidence/delayed-mark-label.json`.

Read `evidence/doctor.json` `proxy.ok` before treating `file-marks-only` as a worker outage. Doctor records reachability without storing the price. A worker that returned a price plus a pill that never says `delayed` is a failure.

## Gotchas

- `leftover_shares` is not an open lot for the proxy. Only the open-status set is sent.
- The word `delayed` inside a ticket note is not the label. Judge `#source-pill` and `#stat-pnl-sub`.
- File fields `live_stock_source` / `quote_quality` can already say delayed-15m. Those strings are not what the pill shows. The pill suffix is only `state.liveOk`.
- Do not assert hero total or open P&L against `summary.paper_pnl` once the pill says `delayed`. Assert closed P&L against the file instead (the paper-book drives do this).
- The worker URL is `PRICE_PROXY_URL` in `app.js`: `https://stock-prices-proxy.jessehartung.workers.dev`.
