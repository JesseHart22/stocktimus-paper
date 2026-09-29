# Mark labeling

Published JSON is the mark source. The pill says `Robinhood live` only when the payload says so. It says `delayed` for a delayed file, or after the Massive fallback returns a quote. It does not say real-time.

## Sub-features

- The published pill follows top-level `marks_source` / `quote_quality` in `data.json`. When those fields name Robinhood, the pill says `Robinhood live` and the page does not call the proxy. When they are absent, the pill has no `delayed` or `Robinhood` suffix. When they name a delayed quote, the pill says `delayed`.
- A payload with `marks_source` containing `robinhood`, or `quote_quality` of `robinhood`, `live`, or `robinhood_live`, appends ` · Robinhood live` to `#source-pill` and `Robinhood live` to `#stat-pnl-sub`. The hero total stays on the file.
- `#source-pill` gains ` · delayed` and `#stat-pnl-sub` gains `delayed MTM` when the file's mark fields are delayed, or when `needsMassiveFallback` gets a proxy quote.
- The fallback runs only when an open lot has no `paper_pnl`, `live_stock`, or `live_option_mid`, and the payload is not a Robinhood success. There is no 30 second poll.
- Closed tickets keep the file `paper_pnl`.

## How to get to it (user POV)

Open Stocktimus. The current file shows file marks and a pill of `stocktimus-paper`. Moonshot and Compounder already carry delayed `quote_quality`, so their pills say `delayed` without a proxy call. After Paperwright pushes `marks_source=robinhood` and `quote_quality=robinhood_live`, Stocktimus shows `Robinhood live`.

The scoreboard pill stays `x log`. It does not use this proxy.

## Driving it with stocktimus-drive

```bash
node .cursor/skills/verify-stocktimus-paper/helpers/drive.mjs drive delayed-mark-label
```

The helper reloads Stocktimus, then routes two copies of `data.json` without editing the file on disk.

- Published load. No proxy request. Pill matches the file’s mark fields. Hero total matches the file.
- Routed `marks_source=robinhood` and `quote_quality=robinhood_live`. Pill contains `Robinhood live` and not `delayed`. No proxy request. Hero total unchanged. Screenshot `evidence/robinhood-mark-label.png`.
- Routed copy with open-lot marks cleared. The page requests the Massive worker. If a quote lands, the pill says `delayed`. If it does not, the pill stays unlabeled. Screenshot `evidence/delayed-mark-label.png`.

The price itself is not written to evidence. Report: `evidence/delayed-mark-label.json`.

## Gotchas

- `leftover_shares` is not an open lot for the proxy. Only the open-status set is sent.
- The word `delayed` inside a ticket note is not the label. Judge `#source-pill` and `#stat-pnl-sub`.
- Per-ticket `quote_quality` does not set the pill. Only the top-level fields do, plus a fallback quote that actually arrived.
- A file that already says `delayed` still uses `summary.paper_pnl` until a fallback quote lands (`liveOk`).
- The worker URL is `MASSIVE_DELAYED_PROXY_URL` in `app.js`: `https://stock-prices-proxy.jessehartung.workers.dev`.
