/* Sleeve live ledger. Figures come from sleeve/trades.json only. */
(() => {
  const FILE = "./sleeve/trades.json";
  const TZ = "America/Los_Angeles";
  const BUCKETS = ["stocktimus", "compounder", "moonshot", "unknown_pre_ledger"];

  const state = {
    data: null,
    error: null,
    pane: "book",
    loading: null,
  };

  const $ = (id) => document.getElementById(id);

  function num(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[$,%]/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }

  function money(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const n = Number(v);
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (n < 0) return "−$" + abs;
    if (Object.is(n, -0)) return "$0.00";
    return "$" + abs;
  }

  function shares(v) {
    const n = num(v);
    if (n == null) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  function price(v) {
    const n = num(v);
    if (n == null) return "—";
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    if (n < 0) return "−$" + abs;
    return "$" + abs;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || "—");
    const date = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: TZ,
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: TZ,
    });
    return date + ", " + time + " PT";
  }

  function sumNum(rows, fn) {
    let total = 0;
    let any = false;
    for (const row of rows || []) {
      const v = fn(row);
      if (v == null || !Number.isFinite(v)) continue;
      total += v;
      any = true;
    }
    return any ? total : null;
  }

  function notesText(data) {
    const notes = data && data.notes;
    if (Array.isArray(notes)) return notes.map((n) => String(n)).join(" ");
    if (notes == null) return "";
    return String(notes);
  }

  function pendingDeposits(data) {
    const text = notesText(data);
    const m = text.match(/pending deposit[^$0-9]*\$?\s*([\d,]+(?:\.\d+)?)/i);
    if (!m) return null;
    return num(m[1].replace(/,/g, ""));
  }

  function equityRows(data) {
    const book = data && data.open_positions;
    return book && Array.isArray(book.equity) ? book.equity : [];
  }

  function optionRows(data) {
    const book = data && data.open_positions;
    return book && Array.isArray(book.options) ? book.options : [];
  }

  function fills(data) {
    return Array.isArray(data && data.fills) ? data.fills : [];
  }

  function openOrders(data) {
    return Array.isArray(data && data.orders_open) ? data.orders_open : [];
  }

  function realizedRows(data) {
    return Array.isArray(data && data.realized_trades) ? data.realized_trades : [];
  }

  function weekRows(data) {
    const rows = Array.isArray(data && data.weekly_summary) ? data.weekly_summary : (data && data.weeks);
    return Array.isArray(rows) ? rows : [];
  }

  function deployed(data) {
    return sumNum(equityRows(data).concat(optionRows(data)), (p) => num(p.deployed_usd));
  }

  function realizedPnl(data) {
    const rows = realizedRows(data);
    if (!rows.length) return 0;
    const fromRows = sumNum(rows, (t) => num(t.realized_pnl_usd != null ? t.realized_pnl_usd : t.realized_pnl));
    return fromRows == null ? 0 : fromRows;
  }

  function bucketLabel(v) {
    const raw = v == null || v === "" ? "—" : String(v);
    return raw;
  }

  function isSleeveHash() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    return h === "sleeve";
  }

  function setView(on) {
    document.documentElement.classList.toggle("view-sleeve", on);
    if (document.body) document.body.classList.toggle("view-sleeve", on);
    const view = $("sleeve-view");
    if (view) view.hidden = !on;
  }

  function paintChrome(data) {
    const name = $("desk-name");
    const sub = $("desk-sub");
    if (name) name.textContent = "Sleeve";
    if (sub) sub.textContent = "Agentic";
    document.title = "Sleeve · Agentic";
    document.querySelectorAll(".desk-tab").forEach((a) => {
      a.classList.toggle("on", a.getAttribute("data-desk") === "sleeve");
    });
    const pill = $("source-pill");
    if (pill) {
      if (data) pill.textContent = "sleeve ledger";
      else if (state.error) pill.textContent = "sleeve ledger missing";
      else pill.textContent = "loading";
    }
    const asof = $("asof");
    if (!asof) return;
    if (data && data.as_of) {
      asof.textContent = fmtWhen(data.as_of);
      asof.setAttribute("datetime", String(data.as_of));
    } else {
      asof.textContent = "—";
      asof.removeAttribute("datetime");
    }
  }

  function stat(id, k, v, s, cls) {
    return '<article class="js-stat">' +
      '<div class="js-k">' + escapeHtml(k) + "</div>" +
      '<div class="js-v mono' + (cls ? " " + cls : "") + '" id="' + id + '">' + escapeHtml(v) + "</div>" +
      '<div class="js-s">' + escapeHtml(s) + "</div>" +
      "</article>";
  }

  function pnlClass(v) {
    if (v == null || !Number.isFinite(v) || v === 0) return "";
    return v > 0 ? "up" : "dn";
  }

  function renderDash(data) {
    const pending = pendingDeposits(data);
    const dep = deployed(data);
    const budget = num(data.sleeve_budget_usd);
    const realized = realizedPnl(data);
    const openN = equityRows(data).length + optionRows(data).length;
    const filledN = fills(data).filter((f) => !f.status || String(f.status) === "filled").length;
    const acct = data.account && typeof data.account === "object" ? data.account : {};
    const who = [acct.nickname, acct.account_number_masked, acct.venue].filter(Boolean).join(" · ");
    return '<section class="js-roc" aria-label="Sleeve funding">' +
      stat("sl-pending", "Pending deposits", money(pending), pending == null ? "Not in notes" : "Funding in flight · from notes") +
      stat("sl-deployed", "Deployed", money(dep), "Sum of open position deployed", "") +
      "</section>" +
      '<section class="js-strip sl-strip" aria-label="Sleeve book">' +
      stat("sl-budget", "Sleeve budget", money(budget), "sleeve_budget_usd") +
      stat("sl-account", "Account value", "—", "Not in the ledger") +
      stat("sl-cash", "Cash", "—", "Not in the ledger") +
      stat("sl-unreal", "Unrealized P&L", "—", "No marks in the ledger") +
      stat("sl-real", "Realized P&L", money(realized), realizedRows(data).length ? "Sum of realized trades" : "No realized trades in the ledger", pnlClass(realized)) +
      stat("sl-roc", "Return on deployed", "—", "No marks in the ledger") +
      stat("sl-open-n", "Open positions", String(openN), "Equity and options") +
      stat("sl-fills", "Filled orders", String(filledN), "Fills in the ledger") +
      "</section>" +
      '<p class="js-note" id="sl-who">' + escapeHtml(who || "Agentic") + "</p>" +
      '<p class="js-note" id="sl-notes">' + escapeHtml(notesText(data) || "No notes in the ledger.") + "</p>";
  }

  function renderSubnav(data, pane) {
    const bookOn = pane === "book" ? " on" : "";
    const blotOn = pane === "blotter" ? " on" : "";
    const weeks = weekRows(data);
    const sumBtn = weeks.length
      ? '<button type="button" class="js-view' + (pane === "summary" ? " on" : "") + '" data-view="summary" aria-pressed="' + (pane === "summary" ? "true" : "false") + '">Weekly summary</button>'
      : "";
    return '<nav class="js-subnav" aria-label="Sleeve sections">' +
      '<button type="button" class="js-view' + bookOn + '" data-view="book" aria-pressed="' + (pane === "book" ? "true" : "false") + '">Open book</button>' +
      '<button type="button" class="js-view' + blotOn + '" data-view="blotter" aria-pressed="' + (pane === "blotter" ? "true" : "false") + '">Trade blotter</button>' +
      sumBtn +
      "</nav>";
  }

  function ths(labels) {
    return "<tr>" + labels.map((label) => {
      const numCol = label.num ? ' class="num"' : "";
      return "<th" + numCol + ">" + escapeHtml(label.t) + "</th>";
    }).join("") + "</tr>";
  }

  function td(text, numCol) {
    return "<td" + (numCol ? ' class="num"' : "") + ">" + text + "</td>";
  }

  function emptyRow(cols, msg) {
    return '<tr class="js-empty-row"><td colspan="' + cols + '">' + escapeHtml(msg) + "</td></tr>";
  }

  function renderEquity(data) {
    const rows = equityRows(data);
    const body = rows.length
      ? rows.map((p) => {
        const bucket = bucketLabel(p.desk_bucket);
        const known = BUCKETS.indexOf(String(p.desk_bucket || "")) !== -1;
        return '<tr data-symbol="' + escapeHtml(p.symbol || "") + '" data-bucket="' + escapeHtml(p.desk_bucket || "") + '">' +
          td(escapeHtml(p.symbol || "—") + (known ? "" : ' <span class="js-tag">bucket</span>')) +
          td(escapeHtml(p.side || "—")) +
          td(escapeHtml(shares(p.quantity)), true) +
          td(escapeHtml(price(p.avg_cost)), true) +
          td(escapeHtml(money(num(p.deployed_usd))), true) +
          td(escapeHtml(p.structure || "—")) +
          td(escapeHtml(bucket)) +
          td(escapeHtml(p.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(8, "No open equity positions.");
    return "<h3>Equity</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Qty", num: true }, { t: "Avg cost", num: true },
        { t: "Deployed", num: true }, { t: "Structure" }, { t: "Desk" }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-equity">' + body + "</tbody></table></div>";
  }

  function renderOptions(data) {
    const rows = optionRows(data);
    const body = rows.length
      ? rows.map((p) => {
        return '<tr data-symbol="' + escapeHtml(p.symbol || "") + '" data-bucket="' + escapeHtml(p.desk_bucket || "") + '">' +
          td(escapeHtml(p.symbol || "—")) +
          td(escapeHtml(p.side || "—")) +
          td(escapeHtml(shares(p.contracts != null ? p.contracts : p.quantity)), true) +
          td(escapeHtml(price(p.strike)), true) +
          td(escapeHtml(p.expiry || "—")) +
          td(escapeHtml(money(num(p.deployed_usd))), true) +
          td(escapeHtml(bucketLabel(p.desk_bucket))) +
          td(escapeHtml(p.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(8, "No open option positions.");
    return "<h3>Options</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Contracts", num: true }, { t: "Strike", num: true },
        { t: "Expiry" }, { t: "Deployed", num: true }, { t: "Desk" }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-options">' + body + "</tbody></table></div>";
  }

  function renderOrders(data) {
    const rows = openOrders(data);
    const body = rows.length
      ? rows.map((o) => {
        return '<tr data-order="' + escapeHtml(o.order_id || o.id || "") + '">' +
          td(escapeHtml(o.symbol || "—")) +
          td(escapeHtml(o.side || "—")) +
          td(escapeHtml(shares(o.quantity)), true) +
          td(escapeHtml(price(o.limit_price)), true) +
          td(escapeHtml(bucketLabel(o.desk_bucket))) +
          td(escapeHtml(o.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(6, "No open orders.");
    return "<h3>Open orders</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Qty", num: true }, { t: "Limit", num: true },
        { t: "Desk" }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-orders">' + body + "</tbody></table></div>";
  }

  function renderRealized(data) {
    const rows = realizedRows(data);
    const body = rows.length
      ? rows.map((t) => {
        const pnl = num(t.realized_pnl_usd != null ? t.realized_pnl_usd : t.realized_pnl);
        return '<tr data-fill="' + escapeHtml(t.fill_id || t.id || "") + '">' +
          td(escapeHtml(t.symbol || "—")) +
          td(escapeHtml(t.side || "—")) +
          td(escapeHtml(bucketLabel(t.desk_bucket))) +
          td(escapeHtml(money(pnl)), true) +
          td(escapeHtml(t.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(5, "No realized trades in the ledger.");
    return '<details class="js-panel js-closed" id="sl-realized">' +
      '<summary>Realized <span class="js-count">' + rows.length + "</span></summary>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Desk" }, { t: "Realized", num: true }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-realized-body">' + body + "</tbody></table></div>" +
      "</details>";
  }

  function renderBook(data) {
    return '<section class="js-panel" id="sl-open-book" aria-label="Open book">' +
      "<h2>Open book</h2>" +
      '<p class="js-note">Positions and working orders from the ledger. No marks are filled in here.</p>' +
      renderEquity(data) +
      renderOptions(data) +
      renderOrders(data) +
      "</section>" +
      renderRealized(data);
  }

  function renderBlotter(data) {
    const rows = fills(data);
    const body = rows.length
      ? rows.map((f) => {
        const when = f.filled_at || f.created_at;
        const walk = f.walk && f.walk.note ? f.walk.note : "";
        return '<tr data-fill="' + escapeHtml(f.fill_id || "") + '" data-bucket="' + escapeHtml(f.desk_bucket || "") + '">' +
          td(escapeHtml(when ? fmtWhen(when) : "—")) +
          td(escapeHtml(f.symbol || "—")) +
          td(escapeHtml(f.side || "—")) +
          td(escapeHtml(f.structure || "—")) +
          td(escapeHtml(shares(f.quantity)), true) +
          td(escapeHtml(price(f.limit_price)), true) +
          td(escapeHtml(price(f.fill_price)), true) +
          td(escapeHtml(money(num(f.notional_usd))), true) +
          td(escapeHtml(money(num(f.fees))), true) +
          td(escapeHtml(bucketLabel(f.desk_bucket))) +
          td(escapeHtml(f.status || "—")) +
          td(escapeHtml(walk || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(12, "No fills in the ledger.");
    return '<section class="js-panel" id="sl-blotter" aria-label="Trade blotter">' +
      "<h2>Trade blotter</h2>" +
      '<p class="js-note">One row per fill. Desk is the file’s desk_bucket.</p>' +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Filled" }, { t: "Symbol" }, { t: "Side" }, { t: "Structure" },
        { t: "Qty", num: true }, { t: "Limit", num: true }, { t: "Fill", num: true },
        { t: "Notional", num: true }, { t: "Fees", num: true }, { t: "Desk" }, { t: "Status" }, { t: "Note" },
      ]) +
      '</thead><tbody id="sl-fills">' + body + "</tbody></table></div>" +
      "</section>";
  }

  function renderSummary(data) {
    const rows = weekRows(data);
    const body = rows.length
      ? rows.map((w) => {
        const label = w.week_ending || w.label || "—";
        return "<tr>" +
          td(escapeHtml(String(label))) +
          td(escapeHtml(w.trade_count == null ? "—" : String(w.trade_count)), true) +
          "</tr>";
      }).join("")
      : emptyRow(2, "No weeks in the ledger.");
    return '<section class="js-panel" id="sl-weekly-panel" aria-label="Weekly summary">' +
      "<h2>Weekly summary</h2>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([{ t: "Week" }, { t: "Trades", num: true }]) +
      "</thead><tbody id=\"sl-weeks\">" + body + "</tbody></table></div>" +
      "</section>";
  }

  function render() {
    const host = $("sleeve-root");
    if (!host) return;
    if (!state.data) {
      host.innerHTML = '<p class="js-empty">' + escapeHtml(state.error || "Loading sleeve ledger…") + "</p>";
      return;
    }
    const weeks = weekRows(state.data);
    let pane = state.pane === "blotter" ? "blotter" : state.pane === "summary" ? "summary" : "book";
    if (pane === "summary" && !weeks.length) pane = "book";
    const body = pane === "blotter"
      ? renderBlotter(state.data)
      : pane === "summary"
        ? renderSummary(state.data)
        : renderBook(state.data);
    host.innerHTML = renderDash(state.data) + renderSubnav(state.data, pane) + body +
      '<p class="js-foot">Read-only mirror of the Sleeve ledger. Rows are the file’s fills and positions. Not advice.</p>';
  }

  function load() {
    return fetch(FILE, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(FILE + " · HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        state.data = data;
        state.error = null;
        if (isSleeveHash()) paintChrome(data);
      })
      .catch((err) => {
        state.data = null;
        state.error = err && err.message ? err.message : "load failed";
        if (isSleeveHash()) paintChrome(null);
      });
  }

  function show() {
    setView(true);
    paintChrome(state.data);
    if (!state.loading) state.loading = load();
    return state.loading.then(() => {
      if (isSleeveHash()) {
        paintChrome(state.data);
        render();
      }
    });
  }

  function hide() {
    setView(false);
  }

  function bind() {
    const view = $("sleeve-view");
    if (!view || view.dataset.bound) return;
    view.dataset.bound = "1";
    view.addEventListener("click", (e) => {
      const viewBtn = e.target.closest(".js-view");
      if (!viewBtn || !view.contains(viewBtn)) return;
      const next = viewBtn.getAttribute("data-view") || "book";
      if (next === state.pane) return;
      state.pane = next;
      render();
    });
  }

  function mount() {
    bind();
    if (isSleeveHash()) show();
    window.addEventListener("hashchange", () => {
      if (isSleeveHash()) show();
      else hide();
    });
  }

  window.StocktimusSleeve = {
    show: show,
    hide: hide,
    mount: mount,
    FILE: FILE,
    pendingDeposits: pendingDeposits,
  };
  mount();
})();
