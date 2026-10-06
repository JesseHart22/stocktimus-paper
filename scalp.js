/* Scalp paper book. Figures come from scalp/scalp.json only.
   Marks are rh_bid, rh_ask, fill, and minute_ts already stored on a ticket. */
(() => {
  const FILE = "./scalp/scalp.json";
  const TZ = "America/Los_Angeles";
  const CAPITAL_KEYS = [
    "capital",
    "capital_usd",
    "deployed_usd",
    "cost_basis",
    "notional_usd",
    "risk_usd",
    "open_risk",
    "premium_usd",
    "debit_usd",
    "credit_usd",
  ];

  const state = {
    data: null,
    error: null,
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

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return undefined;
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
    }
    return undefined;
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

  function pnlClass(v) {
    if (v == null || !Number.isFinite(v) || v === 0) return "";
    return v > 0 ? "up" : "dn";
  }

  function rowsOf(data, key) {
    if (!data || !Object.prototype.hasOwnProperty.call(data, key) || !Array.isArray(data[key])) {
      return { rows: [], missing: true };
    }
    return { rows: data[key], missing: false };
  }

  function ticketCapital(row) {
    if (!row || typeof row !== "object") return null;
    for (const key of CAPITAL_KEYS) {
      const n = num(row[key]);
      if (n != null) return n;
    }
    return null;
  }

  function openRisk(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { value: 0, complete: true, count: 0 };
    let total = 0;
    let known = 0;
    for (const row of list) {
      const capital = ticketCapital(row);
      if (capital == null) continue;
      total += capital;
      known += 1;
    }
    if (known !== list.length) return { value: null, complete: false, count: list.length };
    return { value: total, complete: true, count: list.length };
  }

  function paperEquity(data) {
    const cash = num(data && data.cash);
    const budget = num(data && data.paper_budget);
    const open = rowsOf(data, "open");
    const risk = openRisk(open.rows);
    if (open.missing || !risk.complete) {
      return {
        value: null,
        sub: cash == null ? "Cash not in the file" : "Cash is in the file. Open capital is not on every ticket.",
      };
    }
    if (cash != null) {
      const budgetBit = budget == null ? "" : " · paper budget " + money(budget);
      const sub = risk.count === 0 ? "Cash" + budgetBit : "Cash + open capital";
      return { value: cash + risk.value, sub };
    }
    const closed = rowsOf(data, "closed");
    if (budget != null && risk.count === 0 && !closed.missing && closed.rows.length === 0) {
      return { value: budget, sub: "Paper budget · cash not in the file" };
    }
    return { value: null, sub: "Cash not in the file" };
  }

  function lastFill(row) {
    const fills = row && Array.isArray(row.fills) ? row.fills : [];
    for (let i = fills.length - 1; i >= 0; i -= 1) {
      const fill = fills[i];
      if (fill && typeof fill === "object") return fill;
    }
    return null;
  }

  function rhOf(row) {
    const fill = lastFill(row);
    const source = (row && (row.rh_bid != null || row.rh_ask != null || row.fill != null || row.minute_ts)) ? row : (fill || row || {});
    return {
      rh_bid: source ? source.rh_bid : null,
      rh_ask: source ? source.rh_ask : null,
      fill: source ? source.fill : null,
      minute_ts: source ? source.minute_ts : null,
      side: pick(row, ["side"]) ?? pick(fill, ["side"]),
      instrument: pick(row, ["instrument"]) ?? pick(fill, ["instrument"]),
      symbol: pick(row, ["symbol", "ticker"]) ?? pick(fill, ["symbol", "ticker"]),
    };
  }

  function playbookOf(row, rules) {
    const raw = pick(row, ["playbook", "playbook_id", "book", "setup"]);
    if (raw == null || raw === "") return null;
    const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
    if (key === "a" || key === "playbook_a" || key === "playbook a") {
      return { label: "A", title: rules && rules.playbook_a ? String(rules.playbook_a) : "" };
    }
    if (key === "b" || key === "playbook_b" || key === "playbook b") {
      return { label: "B", title: rules && rules.playbook_b ? String(rules.playbook_b) : "" };
    }
    return { label: String(raw).trim(), title: "" };
  }

  function isScalpHash() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    return h === "scalp";
  }

  function setView(on) {
    document.documentElement.classList.toggle("view-scalp", on);
    if (document.body) document.body.classList.toggle("view-scalp", on);
    const view = $("scalp-view");
    if (view) view.hidden = !on;
  }

  function paintChrome(data) {
    const name = $("desk-name");
    const sub = $("desk-sub");
    if (name) name.textContent = "Scalp";
    if (sub) sub.textContent = "Paper only";
    document.title = "Scalp · Paper";
    document.querySelectorAll(".desk-tab").forEach((a) => {
      a.classList.toggle("on", a.getAttribute("data-desk") === "scalp");
    });
    const pill = $("source-pill");
    if (pill) {
      if (data) pill.textContent = "paper ledger";
      else if (state.error) pill.textContent = "paper ledger missing";
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

  function ths(labels) {
    return "<tr>" + labels.map((label) => {
      const numCol = label.num ? ' class="num"' : "";
      return "<th" + numCol + ">" + escapeHtml(label.t) + "</th>";
    }).join("") + "</tr>";
  }

  function td(text, numCol) {
    return "<td" + (numCol ? ' class="num"' : "") + ">" + text + "</td>";
  }

  function ruleLine(rules) {
    if (!rules || typeof rules !== "object") return "";
    const bits = [];
    if (rules.never_live === true) bits.push("never live");
    if (rules.never_sleeve === true) bits.push("never Sleeve");
    if (rules.never_invent_marks === true) bits.push("never invent marks");
    if (!bits.length) return "";
    return "Ledger rules: " + bits.join(" · ") + ".";
  }

  function renderStrip(data) {
    const equity = paperEquity(data);
    const cash = num(data.cash);
    const open = rowsOf(data, "open");
    const risk = openRisk(open.rows);
    const daily = num(data.daily_pnl);
    const week = num(data.week_pnl);
    let riskText = "—";
    let riskSub = "No capital field on every open ticket";
    if (open.missing) riskSub = "open is not an array in the file";
    else if (risk.complete && risk.count === 0) {
      riskText = money(0);
      riskSub = "No open positions";
    } else if (risk.complete) {
      riskText = money(risk.value);
      riskSub = "Capital on " + risk.count + " open ticket" + (risk.count === 1 ? "" : "s");
    }
    const dailySub = Object.prototype.hasOwnProperty.call(data, "daily_pnl") ? "daily_pnl" : "Not in the file";
    const weekSub = Object.prototype.hasOwnProperty.call(data, "week_pnl") ? "week_pnl" : "Not in the file";
    const asofText = data.as_of ? fmtWhen(data.as_of) : "—";
    return '<section class="js-strip" id="sc-strip" aria-label="Scalp summary">' +
      stat("sc-equity", "Paper equity", money(equity.value), equity.sub) +
      stat("sc-cash", "Cash", money(cash), "Ledger cash") +
      stat("sc-risk", "Open risk", riskText, riskSub) +
      stat("sc-daily", "Daily P&L", money(daily), dailySub, pnlClass(daily)) +
      stat("sc-week", "Week P&L", money(week), weekSub, pnlClass(week)) +
      stat("sc-asof", "As of", asofText, "Ledger as_of") +
      "</section>";
  }

  function renderPlays(data) {
    const rules = data && data.rules && typeof data.rules === "object" ? data.rules : {};
    const a = rules.playbook_a ? String(rules.playbook_a) : "Not in the file";
    const b = rules.playbook_b ? String(rules.playbook_b) : "Not in the file";
    const line = ruleLine(rules);
    return '<section class="js-panel" id="sc-plays" aria-label="Playbooks">' +
      "<h2>Playbooks</h2>" +
      '<div class="sc-plays">' +
        '<article class="sc-play"><span class="js-tag">A</span><p id="sc-play-a">' + escapeHtml(a) + "</p></article>" +
        '<article class="sc-play"><span class="js-tag">B</span><p id="sc-play-b">' + escapeHtml(b) + "</p></article>" +
      "</div>" +
      (line ? '<p class="js-note" id="sc-rules">' + escapeHtml(line) + "</p>" : "") +
      "</section>";
  }

  function playbookCell(row, rules) {
    const tag = playbookOf(row, rules);
    if (!tag) return td("—");
    const title = tag.title ? ' title="' + escapeHtml(tag.title) + '"' : "";
    if (tag.label === "A" || tag.label === "B") {
      return td('<span class="js-tag"' + title + ">Playbook " + escapeHtml(tag.label) + "</span>");
    }
    return td(escapeHtml(tag.label));
  }

  function noteOf(row) {
    const v = pick(row, ["note", "reason", "result", "status", "skip", "error"]);
    if (v == null || v === "") return "—";
    return escapeHtml(String(v));
  }

  function renderRows(list, rules, empty) {
    if (!list.rows.length) {
      const msg = list.missing ? empty.missing : empty.empty;
      return '<tr class="js-empty-row"><td colspan="9">' + escapeHtml(msg) + "</td></tr>";
    }
    return list.rows.map((row) => {
      const rh = rhOf(row || {});
      const minute = rh.minute_ts ? fmtWhen(rh.minute_ts) : "—";
      return "<tr>" +
        playbookCell(row, rules) +
        td(rh.symbol == null || rh.symbol === "" ? "—" : escapeHtml(String(rh.symbol))) +
        td(rh.side == null || rh.side === "" ? "—" : escapeHtml(String(rh.side))) +
        td(rh.instrument == null || rh.instrument === "" ? "—" : escapeHtml(String(rh.instrument))) +
        td(escapeHtml(price(rh.rh_bid)), true) +
        td(escapeHtml(price(rh.rh_ask)), true) +
        td(escapeHtml(price(rh.fill)), true) +
        td(escapeHtml(minute)) +
        td(noteOf(row)) +
        "</tr>";
    }).join("");
  }

  function table(id, body) {
    return '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Playbook" },
        { t: "Symbol" },
        { t: "Side" },
        { t: "Instrument" },
        { t: "RH bid", num: true },
        { t: "RH ask", num: true },
        { t: "Fill", num: true },
        { t: "Minute" },
        { t: "Note" },
      ]) +
      '</thead><tbody id="' + id + '">' + body + "</tbody></table></div>";
  }

  function renderBook(data) {
    const rules = data && data.rules && typeof data.rules === "object" ? data.rules : {};
    const open = rowsOf(data, "open");
    const closed = rowsOf(data, "closed");
    const tries = rowsOf(data, "quote_tries");
    return '<section class="js-panel" id="sc-open-panel" aria-label="Open positions">' +
      "<h2>Open positions <span class=\"js-count\">" + open.rows.length + "</span></h2>" +
      '<p class="js-note">Capital in the summary is a dollar field on the ticket. Bid, ask, and fill stay prices.</p>' +
      table("sc-open", renderRows(open, rules, {
        empty: "No open positions.",
        missing: "open is not an array in the file.",
      })) +
      "</section>" +
      '<section class="js-panel" id="sc-closed-panel" aria-label="Recent closed">' +
      "<h2>Recent closed <span class=\"js-count\">" + closed.rows.length + "</span></h2>" +
      '<p class="js-note">Playbook A or B is tagged only when the ticket has that field. The labels above are the ledger rules.</p>' +
      table("sc-closed", renderRows(closed, rules, {
        empty: "No closed trades.",
        missing: "closed is not an array in the file.",
      })) +
      "</section>" +
      '<section class="js-panel" id="sc-tries-panel" aria-label="Quote tries">' +
      "<h2>Quote tries <span class=\"js-count\">" + tries.rows.length + "</span></h2>" +
      '<p class="js-note" id="sc-marks-note">Each row shows rh_bid, rh_ask, fill, and minute_ts stored on that try. This page does not fetch quotes.</p>' +
      table("sc-tries", renderRows(tries, rules, {
        empty: "No quote tries.",
        missing: "quote_tries is not an array in the file.",
      })) +
      "</section>" +
      '<p class="js-foot">Paper only. Marks are the bid, ask, and fill already stored on each ticket. Not advice.</p>';
  }

  function render() {
    const host = $("scalp-root");
    if (!host) return;
    if (!state.data) {
      host.innerHTML = '<p class="js-empty">' + escapeHtml(state.error || "Loading scalp ledger…") + "</p>";
      return;
    }
    host.innerHTML = '<p class="sc-banner" id="sc-banner">Paper only · never live · never Sleeve</p>' +
      renderStrip(state.data) +
      renderPlays(state.data) +
      renderBook(state.data);
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
        if (isScalpHash()) paintChrome(data);
      })
      .catch((err) => {
        state.data = null;
        state.error = err && err.message ? err.message : "load failed";
        if (isScalpHash()) paintChrome(null);
      });
  }

  function show() {
    setView(true);
    paintChrome(state.data);
    if (!state.loading) state.loading = load();
    return state.loading.then(() => {
      if (isScalpHash()) {
        paintChrome(state.data);
        render();
      }
    });
  }

  function hide() {
    setView(false);
  }

  function mount() {
    if (isScalpHash()) show();
    window.addEventListener("hashchange", () => {
      if (isScalpHash()) show();
      else hide();
    });
  }

  window.StocktimusScalp = {
    show: show,
    hide: hide,
    mount: mount,
    FILE: FILE,
  };
  mount();
})();
