/* X call scoreboard. Separate from the paper book. Renders on #scoreboard. */
(function (root, factory) {
  const api = factory(root);
  root.StocktimusScoreboard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document) api.mount();
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const DESKS = [
    { id: "stocktimus", name: "Stocktimus", file: "./scoreboard/stocktimus.json" },
    { id: "compounder", name: "Compounder", file: "./scoreboard/compounder.json" },
    { id: "moonshot", name: "Moonshot", file: "./scoreboard/moonshot.json" },
    { id: "scout", name: "Scout", file: "./scoreboard/scout.json" },
  ];
  const DAY = 86400000;

  function dayUtc(value) {
    if (value == null || value === "") return null;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  function starCount(value) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  function isExample(call) {
    return !!(call && call.example === true);
  }

  function normHandle(call) {
    return String((call && call.handle) || "").trim().toLowerCase();
  }

  function normTicker(call) {
    return String((call && call.ticker) || "").trim().toUpperCase();
  }

  function normDir(call) {
    return String((call && call.direction) || "").trim().toLowerCase();
  }

  function gradedReturn(call) {
    if (!call || call.status !== "closed" || isExample(call)) return null;
    const v = call.signed_return;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  // First post is the call. Same handle + ticker + direction inside 7 days
  // adds stars and is not a second graded call. Window is [0, 7) calendar days.
  function collapseCalls(calls) {
    const list = Array.isArray(calls) ? calls : [];
    const groups = new Map();
    list.forEach((call, i) => {
      if (!call || typeof call !== "object") return;
      const key = normHandle(call) + "\0" + normTicker(call) + "\0" + normDir(call);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ call: call, i: i });
    });
    const kept = [];
    groups.forEach((items) => {
      items.sort((a, b) => {
        const ta = dayUtc(a.call.called_at);
        const tb = dayUtc(b.call.called_at);
        if (ta == null && tb == null) return a.i - b.i;
        if (ta == null) return 1;
        if (tb == null) return -1;
        if (ta !== tb) return ta - tb;
        return a.i - b.i;
      });
      let anchor = null;
      items.forEach(({ call }) => {
        const t = dayUtc(call.called_at);
        const stars = starCount(call.stars);
        if (
          anchor &&
          t != null &&
          anchor.t != null &&
          t >= anchor.t &&
          (t - anchor.t) / DAY < 7
        ) {
          anchor.call.stars = starCount(anchor.call.stars) + 1 + stars;
          return;
        }
        const copy = Object.assign({}, call, { stars: stars });
        anchor = { call: copy, t: t };
        kept.push(copy);
      });
    });
    kept.sort((a, b) => (dayUtc(b.called_at) || 0) - (dayUtc(a.called_at) || 0));
    return kept;
  }

  function rankHandles(calls) {
    const collapsed = collapseCalls(calls);
    const by = new Map();
    collapsed.forEach((call) => {
      const ret = gradedReturn(call);
      if (ret == null) return;
      const key = normHandle(call);
      if (!key) return;
      if (!by.has(key)) {
        by.set(key, {
          handle: String(call.handle).trim(),
          n: 0,
          sum: 0,
          hits: 0,
        });
      }
      const row = by.get(key);
      row.n += 1;
      row.sum += ret;
      if (ret > 0) row.hits += 1;
    });
    const rows = Array.from(by.values()).map((row) => ({
      handle: row.handle,
      n: row.n,
      avg: row.sum / row.n,
      hit: row.hits / row.n,
      hits: row.hits,
      provisional: row.n < 5,
    }));
    rows.sort((a, b) => b.avg - a.avg || b.n - a.n || a.handle.localeCompare(b.handle));
    return rows;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtPct(fraction) {
    if (fraction == null || !Number.isFinite(fraction)) return "—";
    const p = fraction * 100;
    const sign = p > 0 ? "+" : p < 0 ? "−" : "";
    return sign + Math.abs(p).toFixed(2) + "%";
  }

  function pctClass(fraction) {
    if (fraction == null || !Number.isFinite(fraction) || fraction === 0) return "flat";
    return fraction > 0 ? "up" : "dn";
  }

  function fmtStars(n) {
    const k = starCount(n);
    if (k <= 0) return "0";
    if (k <= 6) return "★".repeat(k);
    return "★×" + k;
  }

  function fmtWhen(value) {
    const t = dayUtc(value);
    if (t == null) return value ? String(value) : "—";
    const d = new Date(t);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function statusLabel(status) {
    if (status === "no_fill") return "no fill";
    if (status === "closed" || status === "open") return status;
    return status ? String(status) : "—";
  }

  function isScoreboardHash() {
    const h = (root.location && root.location.hash) || "";
    return h.replace(/^#/, "").toLowerCase() === "scoreboard";
  }

  function setView(on) {
    const doc = root.document;
    if (!doc) return;
    doc.documentElement.classList.toggle("view-scoreboard", on);
    if (doc.body) doc.body.classList.toggle("view-scoreboard", on);
    const view = doc.getElementById("scoreboard-view");
    if (view) view.hidden = !on;
  }

  function paintChrome() {
    const doc = root.document;
    if (!doc) return;
    const tab = doc.querySelector('.desk-tab[data-desk="scoreboard"]');
    doc.querySelectorAll(".desk-tab").forEach((a) => {
      a.classList.toggle("on", a === tab);
    });
    const name = doc.getElementById("desk-name");
    const sub = doc.getElementById("desk-sub");
    if (name) name.textContent = "Scoreboard";
    if (sub) sub.textContent = "X calls";
    doc.title = "Scoreboard · X calls";
    const pill = doc.getElementById("source-pill");
    if (pill) pill.textContent = "x log";
  }

  function renderRank(rows) {
    if (!rows.length) {
      return '<p class="sb-empty">No scored handles yet. Example rows are not ranked.</p>';
    }
    const body = rows.map((row, i) => {
      const flag = row.provisional ? '<span class="sb-pill prov">Provisional</span>' : "";
      return (
        "<tr>" +
        '<td class="num">' + (i + 1) + "</td>" +
        '<td class="sb-handle">@' + escapeHtml(row.handle) + flag + "</td>" +
        '<td class="num ' + pctClass(row.avg) + '">' + fmtPct(row.avg) + "</td>" +
        '<td class="num">' + fmtPct(row.hit) + " · " + row.hits + "/" + row.n + "</td>" +
        '<td class="num">' + row.n + "</td>" +
        "</tr>"
      );
    }).join("");
    return (
      '<div class="sb-wrap"><table class="sb-table">' +
      "<thead><tr>" +
      '<th class="num">#</th><th>Handle</th><th class="num">Avg return</th>' +
      '<th class="num">Hit rate</th><th class="num">n</th>' +
      "</tr></thead><tbody>" + body + "</tbody></table></div>"
    );
  }

  function renderCalls(calls) {
    if (!calls.length) return '<p class="sb-empty">No calls in this file.</p>';
    const body = calls.map((call) => {
      const ret = call.status === "closed" && typeof call.signed_return === "number"
        ? call.signed_return
        : null;
      const ex = isExample(call) ? '<span class="sb-pill ex">Example data</span>' : "";
      const st = String(call.status || "");
      const stars = starCount(call.stars);
      return (
        "<tr>" +
        "<td>" + ex + (ex ? " " : "") + '<span class="sb-handle">@' + escapeHtml(call.handle || "—") + "</span></td>" +
        '<td class="sb-ticker">' + escapeHtml(normTicker(call) || "—") + "</td>" +
        '<td class="sb-stars' + (stars ? "" : " is-zero") + '" title="Extra posts after the first call">' +
          fmtStars(stars) + "</td>" +
        "<td>" + escapeHtml(call.kind || "—") + "</td>" +
        "<td>" + escapeHtml(normDir(call) || "—") + "</td>" +
        '<td><span class="sb-pill st-' + escapeHtml(st) + '">' + escapeHtml(statusLabel(st)) + "</span></td>" +
        '<td class="num ' + pctClass(ret) + '">' + (ret == null ? "—" : fmtPct(ret)) + "</td>" +
        "<td>" + escapeHtml(fmtWhen(call.called_at)) + "</td>" +
        '<td class="sb-note-cell">' + escapeHtml(call.note || "") + "</td>" +
        "</tr>"
      );
    }).join("");
    return (
      '<div class="sb-wrap"><table class="sb-table">' +
      "<thead><tr>" +
      "<th>Handle</th><th>Ticker</th><th>Stars</th><th>Kind</th><th>Dir</th>" +
      "<th>Status</th><th class=\"num\">Return</th><th>Called</th><th>Note</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>"
    );
  }

  function countOf(calls, pred) {
    return calls.reduce((n, c) => n + (pred(c) ? 1 : 0), 0);
  }

  function renderBoard(desk, payload, error) {
    const name = escapeHtml(desk.name);
    if (error) {
      return (
        '<article class="sb-board" id="sb-' + desk.id + '">' +
        '<header class="sb-board-h"><h2><span class="sb-desk">' + name + "</span></h2></header>" +
        '<div class="sb-block"><p class="sb-err">' + escapeHtml(error) + "</p></div></article>"
      );
    }
    const calls = collapseCalls(payload && payload.calls);
    const ranks = rankHandles(payload && payload.calls);
    const closedN = countOf(calls, (c) => gradedReturn(c) != null);
    const openN = countOf(calls, (c) => !isExample(c) && c.status === "open");
    const nfN = countOf(calls, (c) => !isExample(c) && c.status === "no_fill");
    const exN = countOf(calls, isExample);
    const asOf = payload && payload.as_of ? String(payload.as_of) : "—";
    return (
      '<article class="sb-board" id="sb-' + desk.id + '">' +
      '<header class="sb-board-h"><div>' +
      "<h2><span class=\"sb-desk\">" + name + "</span>X calls</h2>" +
      '<p class="sb-meta">' + calls.length + " on the log" +
      (exN ? " · " + exN + " example" : "") +
      " · " + closedN + " closed scored" +
      " · " + openN + " open" +
      " · " + nfN + " no fill" +
      "</p></div>" +
      '<div class="sb-asof">as of ' + escapeHtml(asOf) + "</div></header>" +
      '<div class="sb-block"><p class="sb-k">Rank · closed graded calls</p>' + renderRank(ranks) + "</div>" +
      '<div class="sb-block"><p class="sb-k">Call log · includes open and no fill</p>' + renderCalls(calls) + "</div>" +
      "</article>"
    );
  }

  let loading = null;

  function show() {
    setView(true);
    paintChrome();
    const doc = root.document;
    const host = doc && doc.getElementById("scoreboard-boards");
    if (!host) return Promise.resolve();
    if (!loading) loading = loadInto(host);
    return loading;
  }

  function hide() {
    setView(false);
  }

  function loadInto(host) {
    host.innerHTML = '<p class="sb-empty">Loading call logs…</p>';
    return Promise.all(DESKS.map((desk) =>
      fetch(desk.file, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(desk.file + " · HTTP " + res.status);
          return res.json();
        })
        .then((data) => ({ desk: desk, data: data, error: null }))
        .catch((err) => ({ desk: desk, data: null, error: err && err.message ? err.message : "load failed" }))
    )).then((boards) => {
      host.innerHTML = boards.map((b) => renderBoard(b.desk, b.data, b.error)).join("");
      const times = boards
        .map((b) => b.data && b.data.as_of)
        .filter(Boolean)
        .sort();
      const asof = root.document.getElementById("asof");
      if (asof && times.length) {
        asof.textContent = times[times.length - 1];
        asof.setAttribute("datetime", times[times.length - 1]);
      }
    });
  }

  function mount() {
    if (isScoreboardHash()) show();
    root.addEventListener("hashchange", () => {
      if (isScoreboardHash()) show();
      else hide();
    });
  }

  return {
    collapseCalls: collapseCalls,
    rankHandles: rankHandles,
    gradedReturn: gradedReturn,
    isExample: isExample,
    show: show,
    hide: hide,
    mount: mount,
    DESKS: DESKS,
  };
});
