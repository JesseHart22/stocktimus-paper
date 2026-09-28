# Paper marks

The page renders marks from the desk JSON. Robinhood stays on Paperwright. The public site has no Robinhood key, and this repo does not store one.

## Robinhood publish

Paperwright (Grok Bot) pulls Robinhood equity and option quotes through MCP on weekday MTM at about 13:20 PT, and when someone asks for a mark. It then writes the desk file and pushes.

1. Write `live_stock`, `live_option_mid`, and `paper_pnl` on each open lot.
2. Write `summary` from those lots. Closed lots keep their existing `paper_pnl`.
3. Set `marks_source` to `robinhood`.
4. Set `quote_quality` to `robinhood_live`.
5. Push the JSON.

The source pill and the line under total P&L then read `Robinhood live`.

## Massive fallback

If that Robinhood publish fails, Paperwright can fill the same lot fields from the Massive delayed proxy and set `quote_quality` to a delayed value. Current desk files use `delayed_15m_polygon`. The page labels those marks `delayed`.

The browser calls `https://stock-prices-proxy.jessehartung.workers.dev` only when an open lot has no `paper_pnl`, `live_stock`, or `live_option_mid`, and the payload is not a Robinhood success. That response is delayed. The page does not poll the worker.

If `marks_source` and `quote_quality` are absent, the page leaves them absent. It shows the file marks with no live or delayed suffix.
