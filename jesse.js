/* Jesse covered-call income. Figures come from jesse/cc-tracker.json only. */
(() => {
  const FILE = "./jesse/cc-tracker.json";
  const TZ = "America/Los_Angeles";

  const state = {
    data: null,
    error: null,
    week: null,
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
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
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
    if (Number.isNaN(d.getTime())) return String(iso);
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

  function positions(data) {
    return Array.isArray(data && data.positions) ? data.positions : [];
  }

  function trades(data) {
    return Array.isArray(data && data.trades) ? data.trades : [];
  }

  function weeks(data) {
    return (Array.isArray(data && data.weeks) ? data.weeks : [])
      .filter((w) => ymd(w && w.week_ending))
      .slice()
      .sort((a, b) => ymd(a.week_ending).localeCompare(ymd(b.week_ending)));
  }

  function summaryWeeks(data) {
    const rows = Array.isArray(data && data.weekly_summary) ? data.weekly_summary : (data && data.weeks);
    return (Array.isArray(rows) ? rows : [])
      .filter((w) => ymd(w && w.week_ending))
      .slice()
      .sort((a, b) => ymd(a.week_ending).localeCompare(ymd(b.week_ending)));
  }

  function dashboard(data) {
    const board = data && data.dashboard;
    return board && typeof board === "object" ? board : null;
  }

  function allocations(data) {
    return Array.isArray(data && data.allocations) ? data.allocations : [];
  }

  function coveredCost(p) {
    const sh = num(p.shares);
    const basis = num(p.cost_basis);
    const occ = num(p.open_cc_shares);
    if (sh == null || basis == null) return null;
    if (!(sh > 0)) return 0;
    const coveredShares = Math.min(Math.max(occ || 0, 0), sh);
    return basis * coveredShares / sh;
  }

  function coveredShares(p) {
    const sh = num(p.shares);
    const occ = num(p.open_cc_shares);
    if (sh == null) return null;
    return Math.min(Math.max(occ || 0, 0), Math.max(sh, 0));
  }

  function isCoveredCall(t) {
    return String(t && t.income_type || "") === "Covered_Call";
  }

  function called(t) {
    return String(t && t.called_away || "");
  }

  function weekFridays(data) {
    return weeks(data).map((w) => ymd(w.week_ending));
  }

  function defaultWeek(data) {
    const list = weekFridays(data);
    if (!list.length) return null;
    const asof = ymdInPT(data.as_of);
    if (!asof) return list[list.length - 1];
    const containing = list.find((friday) => {
      const start = addDays(friday, -6);
      return start && asof >= start && asof <= friday;
    });
    if (containing) return containing;
    const past = list.filter((friday) => friday <= asof);
    if (past.length) return past[past.length - 1];
    return list[0];
  }

  function weekRecord(data, friday) {
    return weeks(data).find((w) => ymd(w.week_ending) === friday) || null;
  }

  function weekReturnVsCapital(w) {
    if (!w) return null;
    const vs = num(w.week_return_pct_vs_capital);
    return vs != null ? vs : num(w.week_return_pct);
  }

  function weekReturnVsProgram(w) {
    if (!w) return null;
    return num(w.week_return_pct_vs_program);
  }

  function allocsFor(data, friday) {
    return allocations(data)
      .filter((a) => ymd(a.week_ending) === friday)
      .slice()
      .sort((a, b) => String(a.trade_id || "").localeCompare(String(b.trade_id || "")));
  }

  function sellsFor(data, friday) {
    const start = addDays(friday, -6);
    if (!start) return [];
    return trades(data)
      .filter((t) => {
        if (!isCoveredCall(t)) return false;
        const sold = ymd(t.cc_sell_date);
        return sold && sold >= start && sold <= friday;
      })
      .slice()
      .sort((a, b) => {
        const d = String(a.cc_sell_date || "").localeCompare(String(b.cc_sell_date || ""));
        if (d) return d;
        return String(a.trade_id || "").localeCompare(String(b.trade_id || ""));
      });
  }

  function isJesseHash() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    return h === "jesse";
  }

  function setView(on) {
    document.documentElement.classList.toggle("view-jesse", on);
    if (document.body) document.body.classList.toggle("view-jesse", on);
    const view = $("jesse-view");
    if (view) view.hidden = !on;
  }

  function paintChrome(data) {
    const title = (data && data.title) || "Covered Call Income";
    const name = $("desk-name");
    const sub = $("desk-sub");
    if (name) name.textContent = title;
    if (sub) sub.textContent = "Jesse";
    document.title = title + " · Jesse";
    document.querySelectorAll(".desk-tab").forEach((a) => {
      a.classList.toggle("on", a.getAttribute("data-desk") === "jesse");
    });
    const pill = $("source-pill");
    if (pill) {
      if (data) pill.textContent = "cc tracker";
      else if (state.error) pill.textContent = "cc tracker missing";
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
    const rows = positions(data);
    const program = sumNum(rows, (p) => num(p.program_capital));
    const covered = sumNum(rows, coveredCost);
    const uncovered = sumNum(rows, (p) => {
      const programCap = num(p.program_capital);
      const cost = coveredCost(p);
      if (programCap == null || cost == null) return null;
      return Math.max(0, programCap - cost);
    });
    const coveredSh = sumNum(rows, coveredShares);
    const openPrem = sumNum(trades(data), (t) => {
      if (!isCoveredCall(t) || called(t) !== "Open") return null;
      return num(t["premium_(net)"]);
    });
    const fileWeeks = weeks(data);
    const toDate = sumNum(fileWeeks, (w) => num(w.total_week_pnl));
    const net = sumNum(fileWeeks, (w) => num(w.net_income));
    const assign = sumNum(fileWeeks, (w) => num(w.assignment_pnl));
    const toSub = fileWeeks.length
      ? fileWeeks.length + " weeks in file · net " + money(net) + " · assignment " + money(assign)
      : "No weeks in the file";
    const coveredSub = (coveredSh == null ? "—" : shares(coveredSh) + " shares") +
      " · cost basis on open CC shares";
    const board = dashboard(data);
    const rocCovered = board ? num(board.roc_vs_covered) : null;
    const rocProgram = board ? num(board.roc_vs_program) : null;
    return '<section class="js-roc" aria-label="Return">' +
      stat("js-roc-covered", "Return on capital", pct(rocCovered), "ROC vs Covered", pnlClass(rocCovered)) +
      stat("js-roc-program", "Return on program", pct(rocProgram), "ROC vs Program", pnlClass(rocProgram)) +
      "</section>" +
      '<section class="js-strip" aria-label="Program">' +
      stat("js-program", "Program capital", money(program), "Sum of position program capital") +
      stat("js-covered", "Covered", money(covered), coveredSub) +
      stat("js-uncovered", "Uncovered", money(uncovered), "Program capital minus covered cost") +
      stat("js-open-prem", "Open premium net", money(openPrem), "Open covered calls · premium net", pnlClass(openPrem)) +
      stat("js-todate", "To date", money(toDate), toSub, pnlClass(toDate)) +
      "</section>";
  }

  function renderSubnav(pane) {
    const bookOn = pane === "book" ? " on" : "";
    const sumOn = pane === "summary" ? " on" : "";
    return '<nav class="js-subnav" aria-label="Jesse sections">' +
      '<button type="button" class="js-view' + bookOn + '" data-view="book" aria-pressed="' + (pane === "book" ? "true" : "false") + '">Open book</button>' +
      '<button type="button" class="js-view' + sumOn + '" data-view="summary" aria-pressed="' + (pane === "summary" ? "true" : "false") + '">Weekly summary</button>' +
      "</nav>";
  }

  function renderSummary(data) {
    const rows = summaryWeeks(data);
    const body = rows.length
      ? rows.map((w) => {
        const friday = ymd(w.week_ending);
        const retCap = weekReturnVsCapital(w);
        const retProg = weekReturnVsProgram(w);
        return "<tr data-week=\"" + escapeHtml(friday) + "\">" +
          td(escapeHtml(fmtDay(friday))) +
          td(escapeHtml(money(num(w.premium_allocated))), true) +
          td(escapeHtml(money(num(w.fees_allocated))), true) +
          td(escapeHtml(money(num(w.net_income))), true) +
          td(escapeHtml(money(num(w.capital_deployed))), true) +
          td(escapeHtml(money(num(w.assignment_pnl))), true) +
          td(escapeHtml(money(num(w.total_week_pnl))), true) +
          td(escapeHtml(pct(retCap)), true) +
          td(escapeHtml(pct(retProg)), true) +
          td(escapeHtml(w.trade_count == null ? "—" : String(w.trade_count)), true) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="10">No weeks in the file.</td></tr>';
    return '<section class="js-panel" id="js-weekly-panel" aria-label="Weekly summary">' +
      "<h2>Weekly summary</h2>" +
      '<p class="js-note">Every Friday on the Excel Weekly Summary. Week return % (vs capital) is combined ÷ capital deployed. Week return % (vs program) is combined ÷ Dashboard program capital.</p>' +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Week ending" },
          { t: "Premium allocated", num: true },
          { t: "Fees", num: true },
          { t: "Net income", num: true },
          { t: "Capital deployed", num: true },
          { t: "Assignment P&L", num: true },
          { t: "Total week P&L", num: true },
          { t: "Week return % (vs capital)", num: true },
          { t: "Week return % (vs program)", num: true },
          { t: "Trades", num: true },
        ]) +
      '</thead><tbody id="js-weekly">' + body + "</tbody></table></div>" +
      "</section>" +
      '<p class="js-foot">Read-only view of the published Excel export. Last, premium, and week totals are the file’s figures. Not advice.</p>';
  }

  function ths(labels) {
    return "<tr>" + labels.map((label) => {
      const numCol = label.num ? ' class="num"' : "";
      return "<th" + numCol + ">" + escapeHtml(label.t) + "</th>";
    }).join("") + "</tr>";
  }

  function td(text, numCol, attrs) {
    return "<td" + (numCol ? ' class="num"' : "") + (attrs || "") + ">" + text + "</td>";
  }

  function renderWeek(data) {
    const list = weekFridays(data);
    if (!state.week || list.indexOf(state.week) === -1) state.week = defaultWeek(data);
    const friday = state.week;
    if (!friday) {
      return '<section class="js-panel"><h2>Week</h2><p class="js-empty">No weeks in the file.</p></section>';
    }
    const start = addDays(friday, -6);
    const row = weekRecord(data, friday);
    const allocRows = allocsFor(data, friday);
    const derivedPrem = sumNum(allocRows, (a) => num(a.allocated_premium));
    const derivedFees = sumNum(allocRows, (a) => num(a.allocated_fees));
    const prem = row ? num(row.premium_allocated) : derivedPrem;
    const fees = row ? num(row.fees_allocated) : derivedFees;
    const net = row ? num(row.net_income) : (prem != null && fees != null ? prem - fees : null);
    const capital = row ? num(row.capital_deployed) : null;
    const assign = row ? num(row.assignment_pnl) : null;
    const total = row ? num(row.total_week_pnl) : net;
    const retCap = weekReturnVsCapital(row);
    const retProg = weekReturnVsProgram(row);
    const buttons = list.map((key) => {
      const on = key === friday ? " on" : "";
      return '<button type="button" class="js-week' + on + '" data-week="' + escapeHtml(key) + '">' +
        escapeHtml(fmtDay(key)) + "</button>";
    }).join("");
    const allocBody = allocRows.length
      ? allocRows.map((a) => {
        return "<tr data-trade=\"" + escapeHtml(a.trade_id || "") + "\">" +
          td(escapeHtml(a.trade_id || "—")) +
          td(escapeHtml(a.ticker || "—")) +
          td(escapeHtml(a["week_#"] == null ? "—" : String(a["week_#"])), true) +
          td(escapeHtml(money(num(a.allocated_premium))), true) +
          td(escapeHtml(money(num(a.allocated_fees))), true) +
          td(escapeHtml(money(num(a.capital_invested))), true) +
          td(escapeHtml(pct(num(a.weekly_roc_pct))), true) +
          td(escapeHtml(a.called_away || "—")) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="8">No allocations for this week.</td></tr>';
    const sellRows = sellsFor(data, friday);
    const sellBody = sellRows.length
      ? sellRows.map((t) => {
        return "<tr data-trade=\"" + escapeHtml(t.trade_id || "") + "\">" +
          td(escapeHtml(t.trade_id || "—")) +
          td(escapeHtml(t.ticker || "—")) +
          td(escapeHtml(ymd(t.cc_sell_date) || "—")) +
          td(escapeHtml(ymd(t.expiration) || "—")) +
          td(escapeHtml(price(t.strike)), true) +
          td(escapeHtml(money(num(t["premium_(net)"]))), true) +
          td(escapeHtml(called(t) || "—")) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="7">No covered-call sells in this Saturday–Friday window.</td></tr>';
    return '<section class="js-panel" id="js-week" data-week="' + escapeHtml(friday) +
      '" data-start="' + escapeHtml(start || "") + '" data-end="' + escapeHtml(friday) + '">' +
      '<header class="js-panel-h">' +
        "<div><h2>Week</h2>" +
        '<p class="js-note">Sells are covered calls with a sell date from Saturday through Friday. Allocations use the file’s week ending.</p></div>' +
        '<div class="js-weeks" role="tablist" aria-label="Week ending">' + buttons + "</div>" +
      "</header>" +
      '<p class="js-window" id="js-week-window">' + escapeHtml(fmtDay(start) + " – " + fmtDay(friday)) + "</p>" +
      '<div class="js-kpis" id="js-week-kpis">' +
        stat("js-kpi-premium", "Premium allocated", money(prem), row ? "From weeks" : "Sum of allocations") +
        stat("js-kpi-fees", "Fees allocated", money(fees), row ? "From weeks" : "Sum of allocations") +
        stat("js-kpi-net", "Net income", money(net), row ? "From weeks" : "Premium minus fees", pnlClass(net)) +
        stat("js-kpi-capital", "Capital deployed", money(capital), row ? "From weeks" : "Not in allocations") +
        stat("js-kpi-assign", "Assignment P&L", money(assign), row ? "From weeks" : "Not in allocations", pnlClass(assign)) +
        stat("js-kpi-total", "Week P&L", money(total), row ? "From weeks" : "Net income", pnlClass(total)) +
        stat("js-kpi-ret-capital", "Week return % (vs capital)", pct(retCap), row ? "From weeks" : "Not in weeks", pnlClass(retCap)) +
        stat("js-kpi-ret-program", "Week return % (vs program)", pct(retProg), row ? "From weeks" : "Not in weeks", pnlClass(retProg)) +
      "</div>" +
      "<h3>Allocations</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Trade" }, { t: "Ticker" }, { t: "Wk", num: true },
          { t: "Premium", num: true }, { t: "Fees", num: true }, { t: "Capital", num: true },
          { t: "Weekly ROC", num: true }, { t: "Called away" },
        ]) +
      '</thead><tbody id="js-alloc">' + allocBody + "</tbody></table></div>" +
      "<h3>Sells this week</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Trade" }, { t: "Ticker" }, { t: "Sold" }, { t: "Exp" },
          { t: "Strike", num: true }, { t: "Premium net", num: true }, { t: "Called away" },
        ]) +
      '</thead><tbody id="js-sells">' + sellBody + "</tbody></table></div>" +
      "</section>";
  }

  function renderOpen(data) {
    const rows = positions(data);
    const body = rows.length
      ? rows.map((p) => {
        const outside = num(p.program_capital) === 0 && (num(p.shares) || 0) > 0;
        return "<tr data-ticker=\"" + escapeHtml(p.ticker || "") + "\">" +
          td(escapeHtml(p.ticker || "—") + (outside ? ' <span class="js-tag">outside program</span>' : "")) +
          td(escapeHtml(shares(p.shares)), true) +
          td(escapeHtml(price(p.cost_per_share)), true) +
          td(escapeHtml(money(num(p.cost_basis))), true) +
          td(escapeHtml(price(p.last)), true) +
          td(escapeHtml(money(num(p.market_value))), true) +
          td(escapeHtml(shares(p.open_cc_shares)), true) +
          td(escapeHtml(money(num(p.program_capital))), true) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="8">No positions in the file.</td></tr>';
    const open = trades(data).filter((t) => isCoveredCall(t) && called(t) === "Open");
    const openBody = open.length
      ? open.map((t) => {
        return "<tr data-trade=\"" + escapeHtml(t.trade_id || "") + "\">" +
          td(escapeHtml(t.trade_id || "—")) +
          td(escapeHtml(t.ticker || "—")) +
          td(escapeHtml(ymd(t.cc_sell_date) || "—")) +
          td(escapeHtml(ymd(t.expiration) || "—")) +
          td(escapeHtml(price(t.strike)), true) +
          td(escapeHtml(shares(t.shares)), true) +
          td(escapeHtml(money(num(t["premium_(net)"]))), true) +
          td(escapeHtml(money(num(t.capital_invested))), true) +
          td(escapeHtml(pct(num(t.weekly_roc_pct))), true) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="9">No open covered calls.</td></tr>';
    return '<section class="js-panel" id="js-open-book" aria-label="Open book">' +
      "<h2>Open book</h2>" +
      "<h3>Positions</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Ticker" }, { t: "Shares", num: true }, { t: "Cost/sh", num: true },
          { t: "Cost basis", num: true }, { t: "Last", num: true }, { t: "Market value", num: true },
          { t: "Open CC sh", num: true }, { t: "Program capital", num: true },
        ]) +
      '</thead><tbody id="js-positions">' + body + "</tbody></table></div>" +
      "<h3>Open covered calls</h3>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Trade" }, { t: "Ticker" }, { t: "Sold" }, { t: "Exp" },
          { t: "Strike", num: true }, { t: "Shares", num: true },
          { t: "Premium net", num: true }, { t: "Capital", num: true }, { t: "Weekly ROC", num: true },
        ]) +
      '</thead><tbody id="js-open-ccs">' + openBody + "</tbody></table></div>" +
      "</section>";
  }

  function renderClosed(data) {
    const closed = trades(data).filter((t) => called(t) === "Yes" || called(t) === "Expired");
    const body = closed.length
      ? closed.map((t) => {
        return "<tr data-trade=\"" + escapeHtml(t.trade_id || "") + "\">" +
          td(escapeHtml(t.trade_id || "—")) +
          td(escapeHtml(t.ticker || "—")) +
          td(escapeHtml(ymd(t.cc_sell_date) || "—")) +
          td(escapeHtml(ymd(t.expiration) || "—")) +
          td(escapeHtml(price(t.strike)), true) +
          td(escapeHtml(money(num(t["premium_(net)"]))), true) +
          td(escapeHtml(money(num(t["assign_p&l_total"]))), true) +
          td(escapeHtml(called(t) || "—")) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="8">No expired or assigned trades in the file.</td></tr>';
    return '<details class="js-panel js-closed" id="js-closed">' +
      "<summary>Closed and assigned <span class=\"js-count\">" + closed.length + "</span></summary>" +
      '<div class="js-wrap"><table class="js-table"><thead>' +
        ths([
          { t: "Trade" }, { t: "Ticker" }, { t: "Sold" }, { t: "Exp" },
          { t: "Strike", num: true }, { t: "Premium net", num: true },
          { t: "Assign P&L", num: true }, { t: "Called away" },
        ]) +
      '</thead><tbody id="js-closed-body">' + body + "</tbody></table></div>" +
      "</details>" +
      '<p class="js-foot">Read-only view of the published Excel export. Last, premium, and week totals are the file’s figures. Not advice.</p>';
  }

  function render() {
    const host = $("jesse-root");
    if (!host) return;
    if (!state.data) {
      host.innerHTML = '<p class="js-empty">' + escapeHtml(state.error || "Loading covered-call book…") + "</p>";
      return;
    }
    const pane = state.pane === "summary" ? "summary" : "book";
    const body = pane === "summary"
      ? renderSummary(state.data)
      : renderWeek(state.data) + renderOpen(state.data) + renderClosed(state.data);
    host.innerHTML = renderDash(state.data) + renderSubnav(pane) + body;
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
        if (!state.week) state.week = defaultWeek(data);
        if (isJesseHash()) paintChrome(data);
      })
      .catch((err) => {
        state.data = null;
        state.error = err && err.message ? err.message : "load failed";
        if (isJesseHash()) paintChrome(null);
      });
  }

  function show() {
    setView(true);
    paintChrome(state.data);
    if (!state.loading) state.loading = load();
    return state.loading.then(() => {
      if (isJesseHash()) {
        paintChrome(state.data);
        render();
      }
    });
  }

  function hide() {
    setView(false);
  }

  function bind() {
    const view = $("jesse-view");
    if (!view || view.dataset.bound) return;
    view.dataset.bound = "1";
    view.addEventListener("click", (e) => {
      const viewBtn = e.target.closest(".js-view");
      if (viewBtn && view.contains(viewBtn)) {
        const next = viewBtn.getAttribute("data-view") === "summary" ? "summary" : "book";
        if (next === state.pane) return;
        state.pane = next;
        render();
        return;
      }
      const btn = e.target.closest(".js-week");
      if (!btn || !view.contains(btn)) return;
      const next = btn.getAttribute("data-week");
      if (!next || next === state.week) return;
      state.week = next;
      render();
    });
  }

  function mount() {
    bind();
    if (isJesseHash()) show();
    window.addEventListener("hashchange", () => {
      if (isJesseHash()) show();
      else hide();
    });
  }

  const api = {
    show: show,
    hide: hide,
    mount: mount,
    FILE: FILE,
  };
  window.StocktimusJesse = api;
  mount();
})();
