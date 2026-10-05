/* Sleeve live ledger. Figures come from sleeve/trades.json only.
   Twice-daily refresh writes portfolio.total_value and portfolio.cash from
   Robinhood get_portfolio, and rolls fills into income, weeks, weekly_summary,
   and cc_trades. Leave dividends and scalps empty until activity exists.
   Deposits are not shown. */
(() => {
  const FILE = "./sleeve/trades.json";
  const TZ = "America/Los_Angeles";
  const BUCKETS = ["stocktimus", "compounder", "moonshot", "unknown_pre_ledger"];

  const state = {
    data: null,
    error: null,
    pane: "book",
    week: null,
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

  function pct(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const n = Number(v);
    const p = Math.abs(n) <= 2 ? n * 100 : n;
    const sign = p > 0 ? "+" : p < 0 ? "−" : "";
    return sign + Math.abs(p).toFixed(2) + "%";
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

  function ymd(v) {
    if (v == null || v === "") return null;
    const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  function ymdInPT(iso) {
    if (!iso) return null;
    const bare = ymd(iso);
    if (bare && String(iso).trim() === bare) return bare;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return bare;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  function addDays(key, n) {
    const m = ymd(key);
    if (!m) return null;
    const [y, mo, d] = m.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
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

  function fmtDay(key) {
    const m = ymd(key);
    if (!m) return "—";
    const [y, mo, d] = m.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, 12));
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
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

  function sortedWeeks(data) {
    return weekRows(data)
      .filter((w) => ymd(w && w.week_ending))
      .slice()
      .sort((a, b) => ymd(a.week_ending).localeCompare(ymd(b.week_ending)));
  }

  function incomeOf(data) {
    const inc = data && data.income;
    return inc && typeof inc === "object" ? inc : {};
  }

  function portfolioOf(data) {
    const book = data && data.portfolio;
    return book && typeof book === "object" ? book : {};
  }

  function ccTrades(data) {
    return Array.isArray(data && data.cc_trades) ? data.cc_trades : [];
  }

  function dividendsOf(data) {
    return Array.isArray(data && data.dividends) ? data.dividends : [];
  }

  function scalpsOf(data) {
    if (Array.isArray(data && data.scalps)) return data.scalps;
    if (Array.isArray(data && data.daytrades)) return data.daytrades;
    return [];
  }

  function assignmentsOf(data) {
    if (Array.isArray(data && data.assignments)) return data.assignments;
    return ccTrades(data).filter((t) => {
      const flag = String(t && t.called_away || "");
      return flag === "Yes" || flag === "Expired";
    });
  }

  function deployed(data) {
    return sumNum(equityRows(data), (p) => num(p.deployed_usd));
  }

  function unrealized(data) {
    return sumNum(equityRows(data), (p) => num(p.unrealized_pnl));
  }

  function realizedPnl(data) {
    const rows = realizedRows(data);
    if (!rows.length) return 0;
    const fromRows = sumNum(rows, (t) => num(t.realized_pnl_usd != null ? t.realized_pnl_usd : t.realized_pnl));
    return fromRows == null ? 0 : fromRows;
  }

  function weekCcNet(w) {
    if (!w) return null;
    const net = num(w.net_income);
    if (net != null) return net;
    const prem = num(w.premium_allocated);
    const fees = num(w.fees_allocated);
    if (prem == null) return null;
    return fees == null ? prem : prem - fees;
  }

  function weekScalps(w) {
    if (!w) return null;
    const named = num(w.scalps_daytrades_pnl);
    return named != null ? named : num(w.daytrade_pnl);
  }

  function weekReturnVsCapital(w) {
    if (!w) return null;
    const vs = num(w.week_return_pct_vs_capital);
    return vs != null ? vs : num(w.week_return_pct);
  }

  function weekReturnVsBudget(w) {
    if (!w) return null;
    return num(w.week_return_pct_vs_program);
  }

  function fieldOrWeeks(data, key, fn) {
    const inc = incomeOf(data);
    if (Object.prototype.hasOwnProperty.call(inc, key) && num(inc[key]) != null) return num(inc[key]);
    return fn ? sumNum(sortedWeeks(data), fn) : null;
  }

  function weekFridays(data) {
    return sortedWeeks(data).map((w) => ymd(w.week_ending));
  }

  function defaultWeek(data) {
    const list = weekFridays(data);
    if (!list.length) return null;
    const named = ymd(data && data.current_week_ending);
    const asof = ymdInPT(data && data.as_of);
    if (named && list.indexOf(named) !== -1 && asof) {
      const start = addDays(named, -6);
      if (start && asof >= start && asof <= named) return named;
    }
    const containing = list.find((friday) => {
      const start = addDays(friday, -6);
      return start && asof && asof >= start && asof <= friday;
    });
    if (containing) return containing;
    if (!asof) return list[list.length - 1];
    const past = list.filter((friday) => friday <= asof);
    if (past.length) return past[past.length - 1];
    return list[0];
  }

  function selectedWeek(data) {
    const list = weekFridays(data);
    if (!list.length) return null;
    if (!state.week || list.indexOf(state.week) === -1) state.week = defaultWeek(data);
    return state.week;
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
      pill.title = pill.textContent;
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

  function ccSubtitle(prem, fees) {
    if (prem == null) return "STO credits − BTC debits − fees";
    const feeBit = fees == null ? "" : " − fees " + money(fees);
    return "STO − BTC " + money(prem) + feeBit;
  }

  function zeroSub(n, emptyLabel) {
    if (n == null) return "Not in the ledger";
    if (n === 0) return emptyLabel;
    return "From the ledger";
  }

  function renderAccount(data) {
    const book = portfolioOf(data);
    const total = num(book.total_value);
    const cash = num(book.cash);
    return '<section class="js-roc" aria-label="Account">' +
      stat("sl-account", "Account value", money(total), total == null ? "Not in portfolio" : "portfolio.total_value") +
      stat("sl-cash", "Cash", money(cash), cash == null ? "Not in portfolio" : "portfolio.cash") +
      "</section>";
  }

  function weekButtons(data, friday) {
    const list = weekFridays(data);
    if (!list.length) return "";
    return '<div class="js-weeks" role="tablist" aria-label="Week ending">' +
      list.map((key) => {
        const on = key === friday ? " on" : "";
        return '<button type="button" class="js-week' + on + '" data-week="' + escapeHtml(key) + '">' +
          escapeHtml(fmtDay(key)) + "</button>";
      }).join("") +
      "</div>";
  }

  function renderWeekStats(data, row) {
    const net = weekCcNet(row);
    const div = row ? num(row.dividends) : null;
    const scalps = weekScalps(row);
    const assign = row ? num(row.assignment_pnl) : null;
    const combined = row ? num(row.total_week_pnl) : null;
    const capital = row ? num(row.capital_deployed) : null;
    const ret = weekReturnVsCapital(row);
    const retBudget = weekReturnVsBudget(row);
    const budget = num(data.sleeve_budget_usd);
    return stat("sl-week-cc", "CC premium net", money(net), row ? ccSubtitle(num(row.premium_allocated), num(row.fees_allocated)) : "No week in the ledger", pnlClass(net)) +
      stat("sl-week-div", "Dividends", money(div), zeroSub(div, "No dividends in the ledger"), pnlClass(div)) +
      stat("sl-week-scalps", "Scalps", money(scalps), zeroSub(scalps, "No scalps in the ledger"), pnlClass(scalps)) +
      stat("sl-week-assign", "Assignment P&L", money(assign), zeroSub(assign, "No called-away P&L"), pnlClass(assign)) +
      stat("sl-week-combined", "Combined", money(combined), "CC + dividends + scalps + assignment", pnlClass(combined)) +
      stat("sl-week-ret", "Week return % vs deployed", pct(ret), capital == null ? "Combined ÷ capital deployed" : "Combined ÷ " + money(capital), pnlClass(ret)) +
      stat("sl-week-ret-budget", "Week return % vs budget", pct(retBudget), budget == null ? "Combined ÷ sleeve budget" : "Combined ÷ " + money(budget) + " budget", pnlClass(retBudget));
  }

  function renderAllTime(data) {
    const inc = incomeOf(data);
    const cc = fieldOrWeeks(data, "cc_premium_net", weekCcNet);
    const div = fieldOrWeeks(data, "dividends", (w) => num(w.dividends));
    const scalps = fieldOrWeeks(data, "scalps_daytrades_net", weekScalps);
    const assign = fieldOrWeeks(data, "assignment_pnl", (w) => num(w.assignment_pnl));
    const combined = fieldOrWeeks(data, "combined_income", (w) => num(w.total_week_pnl));
    const capital = fieldOrWeeks(data, "capital_deployed", (w) => num(w.capital_deployed));
    const ret = fieldOrWeeks(data, "roc_vs_deployed", weekReturnVsCapital);
    const retBudget = fieldOrWeeks(data, "roc_vs_budget", weekReturnVsBudget);
    const shownCapital = capital != null ? capital : deployed(data);
    return stat("sl-all-cc", "CC premium net", money(cc), ccSubtitle(num(inc.cc_premium_gross), num(inc.cc_fees)), pnlClass(cc)) +
      stat("sl-all-div", "Dividends", money(div), zeroSub(div, "No dividends in the ledger"), pnlClass(div)) +
      stat("sl-all-scalps", "Scalps", money(scalps), zeroSub(scalps, "No scalps in the ledger"), pnlClass(scalps)) +
      stat("sl-all-assign", "Assignment P&L", money(assign), zeroSub(assign, "No called-away P&L"), pnlClass(assign)) +
      stat("sl-all-combined", "Combined", money(combined), "CC + dividends + scalps + assignment", pnlClass(combined)) +
      stat("sl-roc", "Return % vs deployed", pct(ret), shownCapital == null ? "Combined ÷ open equity deployed" : "Combined ÷ " + money(shownCapital), pnlClass(ret)) +
      stat("sl-roc-budget", "Return % vs budget", pct(retBudget), "Combined ÷ sleeve budget", pnlClass(retBudget));
  }

  function renderIncome(data) {
    const friday = selectedWeek(data);
    const row = friday ? sortedWeeks(data).find((w) => ymd(w.week_ending) === friday) || null : null;
    const start = friday ? addDays(friday, -6) : null;
    const windowText = friday ? fmtDay(start) + " – " + fmtDay(friday) : "No weeks in the ledger";
    return '<section class="js-panel" id="sl-income" aria-label="Weekly income">' +
      '<header class="js-panel-h">' +
        "<div><h2>Weekly income</h2>" +
        '<p class="js-note">Covered-call net premium is STO credits minus BTC debits and fees. Week return % vs deployed is combined ÷ capital deployed that week. Capital deployed is the sum of open equity deployed_usd.</p></div>' +
        weekButtons(data, friday) +
      "</header>" +
      '<p class="js-window" id="sl-week-window">' + escapeHtml(windowText) + "</p>" +
      '<div class="js-strip" id="sl-week-kpis">' + renderWeekStats(data, row) + "</div>" +
      "<h3>All-time</h3>" +
      '<div class="js-strip" id="sl-all-kpis">' + renderAllTime(data) + "</div>" +
      "</section>";
  }

  function renderDash(data) {
    const dep = deployed(data);
    const budget = num(data.sleeve_budget_usd);
    const realized = realizedPnl(data);
    const unreal = unrealized(data);
    const openN = equityRows(data).length + optionRows(data).length;
    const filledN = fills(data).filter((f) => !f.status || String(f.status) === "filled").length;
    const acct = data.account && typeof data.account === "object" ? data.account : {};
    const who = [acct.nickname, acct.account_number_masked, acct.venue].filter(Boolean).join(" · ");
    return renderAccount(data) +
      renderIncome(data) +
      '<section class="js-strip sl-strip" aria-label="Sleeve book">' +
      stat("sl-deployed", "Deployed", money(dep), "Sum of open equity deployed_usd") +
      stat("sl-budget", "Sleeve budget", money(budget), "sleeve_budget_usd") +
      stat("sl-unreal", "Unrealized P&L", money(unreal), unreal == null ? "No unrealized_pnl on open equity" : "Sum of open equity unrealized_pnl", pnlClass(unreal)) +
      stat("sl-real", "Realized P&L", money(realized), realizedRows(data).length ? "Sum of realized trades" : "No realized trades in the ledger", pnlClass(realized)) +
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
        const unreal = num(p.unrealized_pnl);
        const unrealCls = pnlClass(unreal);
        const unrealHtml = unrealCls
          ? '<span class="' + unrealCls + '">' + escapeHtml(money(unreal)) + "</span>"
          : escapeHtml(money(unreal));
        return '<tr data-symbol="' + escapeHtml(p.symbol || "") + '" data-bucket="' + escapeHtml(p.desk_bucket || "") + '">' +
          td(escapeHtml(p.symbol || "—") + (known ? "" : ' <span class="js-tag">bucket</span>')) +
          td(escapeHtml(p.side || "—")) +
          td(escapeHtml(shares(p.quantity)), true) +
          td(escapeHtml(price(p.avg_cost)), true) +
          td(escapeHtml(price(p.last)), true) +
          td(escapeHtml(money(num(p.deployed_usd))), true) +
          td(unrealHtml, true) +
          td(escapeHtml(p.structure || "—")) +
          td(escapeHtml(bucket)) +
          td(escapeHtml(p.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(10, "No open equity positions.");
    return "<h3>Equity</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Qty", num: true }, { t: "Avg cost", num: true },
        { t: "Last", num: true }, { t: "Deployed", num: true }, { t: "Unrealized", num: true },
        { t: "Structure" }, { t: "Desk" }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-equity">' + body + "</tbody></table></div>";
  }

  function renderOptions(data) {
    const rows = optionRows(data);
    const body = rows.length
      ? rows.map((p) => {
        const credit = num(p.credit_usd);
        return '<tr data-symbol="' + escapeHtml(p.symbol || "") + '" data-bucket="' + escapeHtml(p.desk_bucket || "") + '">' +
          td(escapeHtml(p.symbol || "—")) +
          td(escapeHtml(p.side || "—")) +
          td(escapeHtml(shares(p.contracts != null ? p.contracts : p.quantity)), true) +
          td(escapeHtml(price(p.strike)), true) +
          td(escapeHtml(p.expiry || "—")) +
          td(escapeHtml(money(credit)), true) +
          td(escapeHtml(bucketLabel(p.desk_bucket))) +
          td(escapeHtml(p.status || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(8, "No open option positions.");
    return "<h3>Options</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Side" }, { t: "Contracts", num: true }, { t: "Strike", num: true },
        { t: "Expiry" }, { t: "Credit", num: true }, { t: "Desk" }, { t: "Status" },
      ]) +
      '</thead><tbody id="sl-options">' + body + "</tbody></table></div>";
  }

  function renderOpenCcs(data) {
    const rows = ccTrades(data).filter((t) => {
      const flag = String(t && t.called_away || "Open");
      return flag === "Open" || flag === "open";
    });
    const body = rows.length
      ? rows.map((t) => {
        const sym = t.symbol || t.ticker || "—";
        return '<tr data-trade="' + escapeHtml(t.trade_id || "") + '" data-symbol="' + escapeHtml(sym) + '">' +
          td(escapeHtml(t.trade_id || "—")) +
          td(escapeHtml(sym)) +
          td(escapeHtml(ymd(t.cc_sell_date) || "—")) +
          td(escapeHtml(ymd(t.expiry) || "—")) +
          td(escapeHtml(price(t.strike)), true) +
          td(escapeHtml(shares(t.contracts)), true) +
          td(escapeHtml(money(num(t.premium_net))), true) +
          td(escapeHtml(money(num(t.capital_invested))), true) +
          td(escapeHtml(pct(num(t.weekly_roc_pct))), true) +
          td(escapeHtml(bucketLabel(t.desk_bucket))) +
          "</tr>";
      }).join("")
      : emptyRow(10, "No open covered calls.");
    return "<h3>Open covered calls</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Trade" }, { t: "Symbol" }, { t: "Sold" }, { t: "Exp" },
        { t: "Strike", num: true }, { t: "Contracts", num: true },
        { t: "Premium net", num: true }, { t: "Capital", num: true },
        { t: "Weekly ROC", num: true }, { t: "Desk" },
      ]) +
      '</thead><tbody id="sl-open-ccs">' + body + "</tbody></table></div>";
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

  function symbolOf(row) {
    return row.symbol || row.ticker || "—";
  }

  function renderDividends(data) {
    const rows = dividendsOf(data);
    const body = rows.length
      ? rows.map((row) => {
        return "<tr data-trade=\"" + escapeHtml(row.trade_id || "") + "\">" +
          td(escapeHtml(symbolOf(row))) +
          td(escapeHtml(ymd(row.pay_date) || "—")) +
          td(escapeHtml(money(num(row.amount))), true) +
          td(escapeHtml(bucketLabel(row.desk_bucket))) +
          td(escapeHtml(row.notes || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(5, "No dividends in the ledger.");
    return '<details class="js-panel js-closed" id="sl-dividends">' +
      '<summary>Dividends <span class="js-count">' + rows.length + "</span></summary>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Paid" }, { t: "Amount", num: true }, { t: "Desk" }, { t: "Notes" },
      ]) +
      "</thead><tbody id=\"sl-dividends-body\">" + body + "</tbody></table></div>" +
      "</details>";
  }

  function renderScalps(data) {
    const rows = scalpsOf(data);
    const body = rows.length
      ? rows.map((row) => {
        const net = num(row.net_pnl);
        return "<tr data-trade=\"" + escapeHtml(row.trade_id || "") + "\">" +
          td(escapeHtml(symbolOf(row))) +
          td(escapeHtml(ymd(row.trade_date) || "—")) +
          td(escapeHtml(row.option_symbol || "—")) +
          td(escapeHtml(money(num(row.gross))), true) +
          td(escapeHtml(money(num(row.fees))), true) +
          td(escapeHtml(money(net)), true) +
          td(escapeHtml(bucketLabel(row.desk_bucket))) +
          "</tr>";
      }).join("")
      : emptyRow(7, "No scalps in the ledger.");
    return '<details class="js-panel js-closed" id="sl-scalps">' +
      '<summary>Scalps <span class="js-count">' + rows.length + "</span></summary>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Date" }, { t: "Option" },
        { t: "Gross", num: true }, { t: "Fees", num: true }, { t: "Net", num: true }, { t: "Desk" },
      ]) +
      "</thead><tbody id=\"sl-scalps-body\">" + body + "</tbody></table></div>" +
      "</details>";
  }

  function renderAssignments(data) {
    const rows = assignmentsOf(data);
    const body = rows.length
      ? rows.map((row) => {
        const pnl = num(row.assignment_pnl != null ? row.assignment_pnl : row["assign_p&l_total"]);
        return "<tr data-trade=\"" + escapeHtml(row.trade_id || "") + "\">" +
          td(escapeHtml(symbolOf(row))) +
          td(escapeHtml(ymd(row.called_away_date || row.expiry) || "—")) +
          td(escapeHtml(price(row.strike)), true) +
          td(escapeHtml(money(num(row.premium_net))), true) +
          td(escapeHtml(money(pnl)), true) +
          td(escapeHtml(row.called_away || "—")) +
          "</tr>";
      }).join("")
      : emptyRow(6, "No assignments in the ledger.");
    return '<details class="js-panel js-closed" id="sl-assignments">' +
      '<summary>Assignment <span class="js-count">' + rows.length + "</span></summary>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Symbol" }, { t: "Called away" }, { t: "Strike", num: true },
        { t: "Premium net", num: true }, { t: "Assignment P&L", num: true }, { t: "Status" },
      ]) +
      "</thead><tbody id=\"sl-assignments-body\">" + body + "</tbody></table></div>" +
      "</details>";
  }

  function renderBook(data) {
    return '<section class="js-panel" id="sl-open-book" aria-label="Open book">' +
      "<h2>Open book</h2>" +
      '<p class="js-note">Positions and working orders from the ledger. Last, unrealized, and option credit are the file’s marks.</p>' +
      renderEquity(data) +
      renderOptions(data) +
      renderOpenCcs(data) +
      renderOrders(data) +
      "</section>" +
      renderDividends(data) +
      renderScalps(data) +
      renderAssignments(data) +
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
    const rows = sortedWeeks(data);
    const body = rows.length
      ? rows.map((w) => {
        const friday = ymd(w.week_ending);
        const scalps = weekScalps(w);
        return "<tr data-week=\"" + escapeHtml(friday) + "\">" +
          td(escapeHtml(fmtDay(friday))) +
          td(escapeHtml(money(num(w.premium_allocated))), true) +
          td(escapeHtml(money(num(w.fees_allocated))), true) +
          td(escapeHtml(money(weekCcNet(w))), true) +
          td(escapeHtml(money(num(w.dividends))), true) +
          td(escapeHtml(money(scalps)), true) +
          td(escapeHtml(money(num(w.assignment_pnl))), true) +
          td(escapeHtml(money(num(w.total_week_pnl))), true) +
          td(escapeHtml(money(num(w.capital_deployed))), true) +
          td(escapeHtml(pct(weekReturnVsCapital(w))), true) +
          td(escapeHtml(pct(weekReturnVsBudget(w))), true) +
          td(escapeHtml(w.trade_count == null ? "—" : String(w.trade_count)), true) +
          "</tr>";
      }).join("")
      : emptyRow(12, "No weeks in the ledger.");
    return '<section class="js-panel" id="sl-weekly-panel" aria-label="Weekly summary">' +
      "<h2>Weekly summary</h2>" +
      '<p class="js-note">Every Friday in the ledger. Week return % vs deployed is combined ÷ capital deployed. Week return % vs budget is combined ÷ sleeve budget.</p>' +
      '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Week ending" },
        { t: "CC premium", num: true },
        { t: "Fees", num: true },
        { t: "CC premium net", num: true },
        { t: "Dividends", num: true },
        { t: "Scalps", num: true },
        { t: "Assignment P&L", num: true },
        { t: "Combined", num: true },
        { t: "Capital deployed", num: true },
        { t: "Week return % vs deployed", num: true },
        { t: "Week return % vs budget", num: true },
        { t: "Trades", num: true },
      ]) +
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
      '<p class="js-foot">Read-only mirror of the Sleeve ledger. Account value and cash are portfolio fields. Income buckets are the file’s weeks. Not advice.</p>';
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
      const weekBtn = e.target.closest(".js-week");
      if (weekBtn && view.contains(weekBtn)) {
        const nextWeek = weekBtn.getAttribute("data-week");
        if (!nextWeek || nextWeek === state.week) return;
        state.week = nextWeek;
        render();
        return;
      }
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
  };
  mount();
})();
