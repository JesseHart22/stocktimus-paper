/* Scalp paper book. Figures come from scalp/scalp.json only.
   The summary is realized P&L. It does not read cash or paper_budget.
   Marks are rh_bid, rh_ask, fill, and minute_ts already stored on a ticket. */
(() => {
  const FILE = "./scalp/scalp.json";
  const TZ = "America/Los_Angeles";
  const TRADE_COLS = 14;

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

  function allTimeRealized(data) {
    const hasField = data && Object.prototype.hasOwnProperty.call(data, "all_time_realized_pnl");
    const direct = hasField ? num(data.all_time_realized_pnl) : null;
    if (direct != null) return { value: direct, sub: "all_time_realized_pnl" };
    const closed = rowsOf(data, "closed");
    if (closed.missing) return { value: null, sub: "Not in the file" };
    let sum = 0;
    let known = 0;
    for (const row of closed.rows) {
      const n = num(row && row.realized_pnl);
      if (n == null) continue;
      sum += n;
      known += 1;
    }
    if (!known) return { value: null, sub: "No realized_pnl on closed trades" };
    return { value: sum, sub: "Sum of closed realized_pnl" };
  }

  function winLoss(data) {
    const closed = rowsOf(data, "closed");
    if (closed.missing) return { text: "—", sub: "closed is not an array" };
    let wins = 0;
    let losses = 0;
    for (const row of closed.rows) {
      const n = num(row && row.realized_pnl);
      if (n == null || n === 0) continue;
      if (n > 0) wins += 1;
      else losses += 1;
    }
    return { text: String(wins) + " / " + String(losses), sub: "Closed trades" };
  }

  function tradePnl(row) {
    if (!row || typeof row !== "object") return null;
    if (row.realized_pnl != null && row.realized_pnl !== "") {
      const realized = num(row.realized_pnl);
      if (realized != null) return realized;
    }
    return num(row.pnl);
  }

  function laYmd(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const bag = {};
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(d);
    for (const part of parts) bag[part.type] = part.value;
    const year = Number(bag.year);
    const month = Number(bag.month);
    const day = Number(bag.day);
    if (!year || !month || !day || !bag.weekday) return null;
    return { year: year, month: month, day: day, weekday: bag.weekday };
  }

  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function fridayKey(ymd) {
    const dow = WEEKDAY_INDEX[ymd.weekday];
    if (dow == null) return null;
    const add = (5 - dow + 7) % 7;
    const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + add));
    const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const day = String(utc.getUTCDate()).padStart(2, "0");
    return utc.getUTCFullYear() + "-" + month + "-" + day;
  }

  function weekLabel(key) {
    const bits = key.split("-").map(Number);
    const utc = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    return utc.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function addMoney(sum, value) {
    return Math.round((sum + value) * 100) / 100;
  }

  function displayCents(n) {
    const sign = n < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(n) * 100);
  }

  function winPct(wins, trades) {
    if (!trades) return "—";
    const pct = Math.round((wins / trades) * 1000) / 10;
    const body = Math.abs(pct - Math.round(pct)) < 1e-9 ? String(Math.round(pct)) : pct.toFixed(1);
    return body + "%";
  }

  function trendMark(avg, prior) {
    if (avg == null || prior == null) return "";
    const diff = displayCents(avg) - displayCents(prior);
    if (!diff) return "";
    const up = diff > 0;
    const label = up ? "Up versus the prior week" : "Down versus the prior week";
    return '<span class="sc-trend ' + (up ? "up" : "dn") + '" title="' + label + '" aria-label="' + label + '">' + (up ? "↑" : "↓") + "</span>";
  }

  function weekBuckets(rows) {
    const map = new Map();
    for (const row of rows) {
      const exit = legOf(row, "exit");
      const minute = exit && exit.minute_ts;
      if (minute == null || minute === "") continue;
      const ymd = laYmd(minute);
      const key = ymd ? fridayKey(ymd) : null;
      if (!key) continue;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key: key,
          trades: 0,
          wins: 0,
          losses: 0,
          pnl: 0,
          aPnl: 0,
          aN: 0,
          bPnl: 0,
          bN: 0,
        };
        map.set(key, bucket);
      }
      bucket.trades += 1;
      const pnl = tradePnl(row);
      if (pnl != null) {
        bucket.pnl = addMoney(bucket.pnl, pnl);
        if (pnl > 0) bucket.wins += 1;
        else if (pnl < 0) bucket.losses += 1;
      }
      const tag = playbookOf(row, null);
      if (tag && tag.label === "A") {
        bucket.aN += 1;
        if (pnl != null) bucket.aPnl = addMoney(bucket.aPnl, pnl);
      } else if (tag && tag.label === "B") {
        bucket.bN += 1;
        if (pnl != null) bucket.bPnl = addMoney(bucket.bPnl, pnl);
      }
    }
    const list = Array.from(map.values()).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let cum = 0;
    for (let i = 0; i < list.length; i += 1) {
      cum = addMoney(cum, list[i].pnl);
      list[i].cum = cum;
      list[i].avg = list[i].trades ? list[i].pnl / list[i].trades : null;
      list[i].priorAvg = i === 0 ? null : list[i - 1].avg;
    }
    return list.reverse();
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
    const all = allTimeRealized(data);
    const daily = num(data.daily_pnl);
    const week = num(data.week_pnl);
    const record = winLoss(data);
    const dailySub = Object.prototype.hasOwnProperty.call(data, "daily_pnl") ? "daily_pnl" : "Not in the file";
    const weekSub = Object.prototype.hasOwnProperty.call(data, "week_pnl") ? "week_pnl" : "Not in the file";
    return '<section class="js-strip" id="sc-strip" aria-label="Scalp P&L">' +
      stat("sc-all", "All-time P&L", money(all.value), all.sub, pnlClass(all.value)) +
      stat("sc-week", "Week P&L", money(week), weekSub, pnlClass(week)) +
      stat("sc-daily", "Day P&L", money(daily), dailySub, pnlClass(daily)) +
      stat("sc-record", "Wins / losses", record.text, record.sub) +
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

  function legOf(row, key) {
    const leg = row && row[key];
    return leg && typeof leg === "object" ? leg : null;
  }

  function entryLeg(row) {
    const nested = legOf(row, "entry");
    if (nested) return nested;
    if (row && (row.rh_bid != null || row.rh_ask != null || row.fill != null || row.minute_ts)) return row;
    return lastFill(row);
  }

  function markCells(leg) {
    const source = leg && typeof leg === "object" ? leg : {};
    const minute = source.minute_ts ? fmtWhen(source.minute_ts) : "—";
    return td(escapeHtml(price(source.rh_bid)), true) +
      td(escapeHtml(price(source.rh_ask)), true) +
      td(escapeHtml(price(source.fill)), true) +
      td(escapeHtml(minute));
  }

  function realizedCell(row) {
    const n = num(row && row.realized_pnl);
    const cls = pnlClass(n);
    return '<td class="num' + (cls ? " " + cls : "") + '">' + escapeHtml(n == null ? "—" : money(n)) + "</td>";
  }

  function renderTradeRows(list, rules, empty) {
    if (!list.rows.length) {
      const msg = list.missing ? empty.missing : empty.empty;
      return '<tr class="js-empty-row"><td colspan="' + TRADE_COLS + '">' + escapeHtml(msg) + "</td></tr>";
    }
    return list.rows.map((row) => {
      const ticket = row || {};
      const entry = entryLeg(ticket);
      const side = pick(ticket, ["side"]) ?? pick(entry, ["side"]);
      const instrument = pick(ticket, ["instrument"]) ?? pick(entry, ["instrument"]);
      const symbol = pick(ticket, ["symbol", "ticker"]) ?? pick(entry, ["symbol", "ticker"]);
      return "<tr>" +
        playbookCell(ticket, rules) +
        td(symbol == null || symbol === "" ? "—" : escapeHtml(String(symbol))) +
        td(side == null || side === "" ? "—" : escapeHtml(String(side))) +
        td(instrument == null || instrument === "" ? "—" : escapeHtml(String(instrument))) +
        markCells(entry) +
        markCells(legOf(ticket, "exit")) +
        realizedCell(ticket) +
        td(noteOf(ticket)) +
        "</tr>";
    }).join("");
  }

  function tradeTable(id, body) {
    return '<div class="js-wrap"><table class="js-table"><thead>' +
      ths([
        { t: "Playbook" },
        { t: "Symbol" },
        { t: "Side" },
        { t: "Instrument" },
        { t: "Entry bid", num: true },
        { t: "Entry ask", num: true },
        { t: "Entry fill", num: true },
        { t: "Entry time" },
        { t: "Exit bid", num: true },
        { t: "Exit ask", num: true },
        { t: "Exit fill", num: true },
        { t: "Exit time" },
        { t: "Realized P&L", num: true },
        { t: "Note" },
      ]) +
      '</thead><tbody id="' + id + '">' + body + "</tbody></table></div>";
  }

  function pnlTd(n, extra) {
    if (n == null || !Number.isFinite(n)) return td("—", true);
    const cls = pnlClass(n);
    return '<td class="num' + (cls ? " " + cls : "") + '">' + escapeHtml(money(n)) + (extra || "") + "</td>";
  }

  function playPnlCell(sum, n) {
    if (!n) return td("—", true);
    return pnlTd(sum, " (" + n + ")");
  }

  function renderWeeks(closed) {
    const buckets = closed.missing ? [] : weekBuckets(closed.rows);
    const body = buckets.length
      ? buckets.map((bucket) => {
        return '<tr data-week="' + escapeHtml(bucket.key) + '">' +
          td(escapeHtml(weekLabel(bucket.key))) +
          td(escapeHtml(String(bucket.trades)), true) +
          td(escapeHtml(String(bucket.wins) + " / " + String(bucket.losses)), true) +
          td(escapeHtml(winPct(bucket.wins, bucket.trades)), true) +
          pnlTd(bucket.pnl) +
          pnlTd(bucket.avg, trendMark(bucket.avg, bucket.priorAvg)) +
          playPnlCell(bucket.aPnl, bucket.aN) +
          playPnlCell(bucket.bPnl, bucket.bN) +
          pnlTd(bucket.cum) +
          "</tr>";
      }).join("")
      : '<tr class="js-empty-row"><td colspan="9">' + escapeHtml(closed.missing ? "closed is not an array in the file." : "No closed trades.") + "</td></tr>";
    return '<section class="js-panel" id="sc-weeks-panel" aria-label="By week">' +
      "<h2>By week</h2>" +
      '<p class="js-note" id="sc-weeks-note">Weeks use the exit time in Pacific time and end on Friday. Saturday and Sunday roll forward to the next Friday. P&amp;L reads realized_pnl, then pnl. The arrow compares average P&amp;L per trade with the prior week.</p>' +
      '<div class="js-wrap"><table class="js-table" id="sc-weeks"><thead>' +
      ths([
        { t: "Week ending" },
        { t: "Trades", num: true },
        { t: "Wins/Losses", num: true },
        { t: "Win %", num: true },
        { t: "Realized P&L", num: true },
        { t: "Avg P&L per trade", num: true },
        { t: "Playbook A P&L (n)", num: true },
        { t: "Playbook B P&L (n)", num: true },
        { t: "Cumulative P&L", num: true },
      ]) +
      "</thead><tbody>" + body + "</tbody></table></div></section>";
  }

  function renderBook(data) {
    const rules = data && data.rules && typeof data.rules === "object" ? data.rules : {};
    const open = rowsOf(data, "open");
    const closed = rowsOf(data, "closed");
    const tries = rowsOf(data, "quote_tries");
    return '<section class="js-panel" id="sc-open-panel" aria-label="Open positions">' +
      "<h2>Open positions <span class=\"js-count\">" + open.rows.length + "</span></h2>" +
      '<p class="js-note">Entry and exit show the bid, ask, fill, and time stored on the ticket. Realized P&L is realized_pnl.</p>' +
      tradeTable("sc-open", renderTradeRows(open, rules, {
        empty: "No open positions.",
        missing: "open is not an array in the file.",
      })) +
      "</section>" +
      renderWeeks(closed) +
      '<section class="js-panel" id="sc-closed-panel" aria-label="Recent closed">' +
      "<h2>Recent closed <span class=\"js-count\">" + closed.rows.length + "</span></h2>" +
      '<p class="js-note">Playbook A or B is tagged only when the ticket has that field. The labels above are the ledger rules.</p>' +
      tradeTable("sc-closed", renderTradeRows(closed, rules, {
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
