/* Stocktimus paper book. Numbers come from files only — never invented. */
(() => {
  const ACCOUNT = 25000;
  const WEEKLY = 250;
  const TZ = "America/Los_Angeles";

  const PAPER_JSON = [
    "./data.json",
    "./trade-tracker-paper.json",
    "../trade-tracker-paper.json",
  ];
  const SUMMARY_JSON = [
    "./trade-tracker-summary.json",
    "../trade-tracker-summary.json",
  ];
  const CSV_PATHS = [
    "./trade-tracker.csv",
    "../trade-tracker.csv",
  ];

  const OPEN = new Set(["open", "proposed", "live", "taken", "yes"]);
  const INV = new Set(["invalidated", "invalid", "killed"]);
  const OUT = new Set(["out", "closed", "expired", "skipped", "no"]);

  const state = {
    trades: [],
    summary: null,
    asOf: null,
    source: "stub",
    filter: "all",
    selected: null,
    account: ACCOUNT,
    weekly: WEEKLY,
  };

  const $ = (id) => document.getElementById(id);

  function num(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[$,%]/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  function str(v) {
    if (v == null) return "";
    return String(v).trim();
  }
  function pick(obj, keys) {
    if (!obj) return undefined;
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
    }
    return undefined;
  }
  function money(v, empty) {
    if (v == null || Number.isNaN(v)) return empty == null ? "—" : empty;
    const n = Number(v);
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (n < 0) return "−$" + abs;
    if (Object.is(n, -0)) return "$0.00";
    return "$" + abs;
  }
  function pct(v, empty) {
    if (v == null || Number.isNaN(v)) return empty == null ? "—" : empty;
    const n = Number(v);
    // Accept either 0.05 or 5 meaning 5%
    const p = Math.abs(n) <= 2 ? n * 100 : n;
    const sign = p > 0 ? "+" : p < 0 ? "−" : "";
    return sign + Math.abs(p).toFixed(2) + "%";
  }
  function clsPnL(v) {
    if (v == null || Number.isNaN(v) || v === 0) return "flat";
    return v > 0 ? "up" : "dn";
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = parseDate(iso);
    if (!d) return String(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: TZ,
    });
  }
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      return new Date(s.length === 10 ? n * 1000 : n);
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dateKey(v) {
    if (!v) return null;
    const s = String(v).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  function nextDateKey(key) {
    const d = parseDate(key);
    if (!d) return null;
    return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
  }
  function isSessionDay(key) {
    const d = parseDate(key);
    if (!d) return false;
    const wd = d.getUTCDay();
    return wd !== 0 && wd !== 6;
  }
  function sessionKeys(from, to) {
    const out = [];
    if (!from || !to || from > to) return out;
    for (let k = from; k <= to; k = nextDateKey(k)) {
      if (isSessionDay(k)) out.push(k);
    }
    return out;
  }
  function moneyShort(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const n = Number(v);
    const abs = Math.abs(n);
    if (abs >= 1000) {
      const k = abs / 1000;
      const t = k >= 10 ? k.toFixed(0) : k.toFixed(1);
      return (n < 0 ? "−$" : "$") + t + "k";
    }
    return money(n);
  }

  function lotOpened(t) {
    return dateKey(t.date_opened || t.date);
  }
  function lotClosed(t) {
    // Live inclusive through the earlier of date_closed and first_invalidation_date.
    const a = dateKey(t.date_closed);
    const b = dateKey(t.first_invalidation_date);
    if (a && b) return a < b ? a : b;
    return a || b || null;
  }

  function pathSessionDates(t, openK, closeK) {
    const raw = t.daily_closes_completed;
    const path = (raw && raw.length) ? raw : t.stock_path;
    const dates = [];
    if (!Array.isArray(path)) return dates;
    for (const p of path) {
      if (p == null) continue;
      let k = null;
      if (typeof p === "string" || typeof p === "number") k = dateKey(p);
      else if (Array.isArray(p)) k = dateKey(p[0]);
      else k = dateKey(pick(p, ["date", "t", "ts", "time", "label"]));
      if (!k) continue;
      if (openK && k < openK) continue;
      if (closeK && k > closeK) continue;
      dates.push(k);
    }
    return [...new Set(dates)];
  }

  /*
   * Daily P&L rule (no invented marks):
   * - A ticket contributes only its file paper_pnl. Nothing is priced here.
   * - If daily_closes_completed (or path) lists session dates, spread that paper_pnl
   *   equally across those dates inside the lot's live window. The path is a calendar,
   *   not a source of extra P&L.
   * - If there is only a terminal paper_pnl, assign it to date_closed /
   *   first_invalidation_date, or the as-of session day if the lot is still open.
   */
  function allocateTicketPnl(t, asOfKey) {
    const pnl = t.paper_pnl;
    if (pnl == null) return [];
    const openK = lotOpened(t);
    const closedK = lotClosed(t);
    const endK = closedK || asOfKey;
    const pathDays = pathSessionDates(t, openK, endK);
    if (pathDays.length) {
      const share = pnl / pathDays.length;
      return pathDays.map((k) => [k, share]);
    }
    const lump = closedK || asOfKey;
    return lump ? [[lump, pnl]] : [];
  }

  function computeDeployedRoc(trades, account, asOfRaw) {
    const acct = account || ACCOUNT;
    const asOfKey = dateKey(asOfRaw) || dateKey(new Date().toISOString());
    let first = null;
    let last = asOfKey;
    for (const t of trades) {
      const o = lotOpened(t);
      if (o && (!first || o < first)) first = o;
      if (o && o > last) last = o;
      const c = lotClosed(t);
      if (c && c > last) last = c;
    }
    if (!first) {
      return {
        roc: null, avgDeployed: 0, currentDeployed: 0, currentRaw: 0,
        idle: acct, curve: [], days: [],
      };
    }
    const days = sessionKeys(first, last);
    const rawByDay = {};
    const pnlByDay = {};
    for (const k of days) {
      rawByDay[k] = 0;
      pnlByDay[k] = 0;
    }
    for (const t of trades) {
      const cap = t.capital;
      const o = lotOpened(t);
      const c = lotClosed(t);
      if (cap != null && o) {
        for (const k of days) {
          if (k < o) continue;
          if (c && k > c) continue;
          rawByDay[k] += cap;
        }
      }
      for (const [k, v] of allocateTicketPnl(t, asOfKey)) {
        if (pnlByDay[k] == null) pnlByDay[k] = 0;
        pnlByDay[k] += v;
      }
    }
    const deployedOf = (k) => Math.min(acct, rawByDay[k] || 0);
    let cum = 1;
    const curve = [];
    let sumDep = 0;
    for (const k of days) {
      const deployed = deployedOf(k);
      sumDep += deployed;
      const dp = pnlByDay[k] || 0;
      const r = deployed ? dp / deployed : 0;
      cum *= 1 + r;
      curve.push({ date: k, deployed, dailyPnl: dp, r, cum: cum - 1 });
    }
    const lastK = days[days.length - 1];
    const currentRaw = rawByDay[lastK] || 0;
    const currentDeployed = Math.min(acct, currentRaw);
    return {
      roc: days.length ? cum - 1 : null,
      avgDeployed: days.length ? sumDep / days.length : 0,
      currentDeployed,
      currentRaw,
      idle: Math.max(0, acct - currentRaw),
      curve,
      days,
    };
  }

  function fmtWhen(v) {
    if (!v) return "—";
    const d = parseDate(v);
    if (!d) return String(v);
    return d.toLocaleString("en-US", {
      timeZone: TZ,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " PT";
  }

  function bucket(status) {
    const s = str(status).toLowerCase();
    if (INV.has(s)) return "invalidated";
    if (OUT.has(s)) return "out";
    if (OPEN.has(s) || !s) return "open";
    return s;
  }

  function rightLetter(structure) {
    const s = str(structure).toLowerCase();
    if (s === "csp" || s.includes("put")) return "p";
    return "c";
  }

  function strikeExp(t) {
    const strike = t.strike == null || t.strike === "" ? "" : String(t.strike);
    const letter = strike ? rightLetter(t.structure) : "";
    const exp = t.expiry ? fmtDate(t.expiry) : "";
    if (strike && exp) return strike + letter + " · " + exp;
    if (strike) return strike + letter;
    if (exp) return "— · " + exp;
    return "—";
  }

  function weekBounds(now) {
    // Monday 00:00 PT → next Monday
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
    const y = +parts.year, m = +parts.month, d = +parts.day;
    const utc = Date.UTC(y, m - 1, d);
    const mondayOffset = wd === 0 ? -6 : 1 - wd;
    const start = new Date(utc + mondayOffset * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    return { start, end };
  }

  function inThisWeek(t, now) {
    const d = parseDate(t.date);
    if (!d) return false;
    const { start, end } = weekBounds(now);
    return d >= start && d < end;
  }

  async function fetchFirst(urls, kind) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text || !text.trim()) continue;
        if (kind === "json") {
          try {
            return { data: JSON.parse(text), url };
          } catch {
            continue;
          }
        }
        return { data: text, url };
      } catch {
        /* file:// or missing — try next */
      }
    }
    return null;
  }

  function asList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.trades)) return payload.trades;
    if (Array.isArray(payload.tickets)) return payload.tickets;
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.book)) return payload.book;
    return [];
  }

  function normalizeTrade(raw, i) {
    if (!raw || typeof raw !== "object") return null;
    const status = str(pick(raw, ["status", "state", "paper_status"])) || "open";
    const paperPnl = num(pick(raw, ["paper_pnl", "paper_pl", "paperPnl", "pnl", "p_and_l"]));
    const paperPct = num(pick(raw, ["paper_pct", "paper_roc", "paper_roc_pct", "paperPct", "roc"]));
    const live = num(pick(raw, ["live_mark", "live_option_mid", "live_option_last", "mark", "live", "last", "live_premium", "mark_premium", "live_stock"]));
    const credit = num(pick(raw, ["credit_or_debit", "credit", "debit", "premium", "premium_total"]));
    const capital = num(pick(raw, ["capital", "capital_at_risk", "cap", "notional"]));
    return {
      id: pick(raw, ["id", "ticket_id"]) ?? i + 1,
      date: pick(raw, ["date", "date_proposed", "date_opened", "proposed"]),
      ticker: str(pick(raw, ["ticker", "symbol", "und"])).toUpperCase(),
      structure: str(pick(raw, ["structure", "type", "kind"])) || "—",
      strike: pick(raw, ["strike", "k"]),
      expiry: pick(raw, ["expiry", "expiration", "exp"]),
      credit_or_debit: credit,
      capital,
      live_mark: live,
      paper_pnl: paperPnl,
      paper_pct: paperPct,
      status,
      creator: str(pick(raw, ["creator", "source", "from", "author"])),
      invalidation: str(pick(raw, ["invalidation", "kill", "invalid"])),
      notes: str(pick(raw, ["notes", "note", "thesis", "why"])),
      stock_path: pick(raw, ["stock_path", "path", "price_path", "spot_path"]) || [],
      daily_closes_completed: pick(raw, ["daily_closes_completed"]) || [],
      date_opened: pick(raw, ["date_opened", "date", "date_proposed", "proposed"]),
      date_closed: pick(raw, ["date_closed", "closed", "exit_date"]),
      first_invalidation_date: pick(raw, ["first_invalidation_date"]),
      flags: pick(raw, ["flags", "tags", "labels"]) || [],
      spot: num(pick(raw, ["spot", "spot_at_idea", "spot_entry"])),
      contracts: num(pick(raw, ["contracts", "qty", "lots"])),
      dte: num(pick(raw, ["dte"])),
      taken: str(pick(raw, ["taken"])),
      confidence: str(pick(raw, ["confidence", "conf"])),
      confidence_reason: str(pick(raw, ["confidence_reason", "conf_reason"])),
      raw,
    };
  }

  function parseCsv(text) {
    const rows = [];
    let i = 0, field = "", row = [], inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = []; i++; continue;
      }
      field += c; i++;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1).map((cols) => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = cols[idx] == null ? "" : cols[idx]; });
      return o;
    });
  }

  function computeSummary(trades, incoming) {
    const byS = {};
    const byC = {};
    const byConf = {
      High: { n: 0, pnl: 0, cap: 0, wins: 0 },
      Medium: { n: 0, pnl: 0, cap: 0, wins: 0 },
      Low: { n: 0, pnl: 0, cap: 0, wins: 0 },
    };
    let pnl = 0;
    let cap = 0;
    let marked = 0;
    let open = 0, invalidated = 0, out = 0;
    let wins = 0, resolved = 0;

    for (const t of trades) {
      const b = bucket(t.status);
      if (b === "invalidated") invalidated++;
      else if (b === "out") out++;
      else open++;

      const s = t.structure || "—";
      byS[s] = byS[s] || { n: 0, pnl: 0, cap: 0 };
      byS[s].n += 1;
      const c = t.creator || "—";
      byC[c] = byC[c] || { n: 0, pnl: 0, cap: 0 };
      byC[c].n += 1;
      const conf = t.confidence;
      if (byConf[conf]) byConf[conf].n += 1;

      if (t.paper_pnl != null) {
        pnl += t.paper_pnl;
        marked += 1;
        byS[s].pnl += t.paper_pnl;
        byC[c].pnl += t.paper_pnl;
        if (byConf[conf]) {
          byConf[conf].pnl += t.paper_pnl;
          if (t.paper_pnl > 0) byConf[conf].wins += 1;
        }
        if (b === "out" || b === "invalidated") {
          resolved += 1;
          if (t.paper_pnl > 0) wins += 1;
        }
      }
      if (t.capital != null) {
        cap += t.capital;
        byS[s].cap += t.capital;
        byC[c].cap += t.capital;
        if (byConf[conf]) byConf[conf].cap += t.capital;
      }
    }

    const computed = {
      paper_pnl: marked ? pnl : 0,
      paper_roc: cap ? pnl / cap : null,
      account_pct: pnl / (state.account || ACCOUNT),
      open, invalidated, out,
      hit_rate: resolved ? wins / resolved : null,
      wins, resolved, marked,
      by_structure: byS,
      by_creator: byC,
      by_confidence: byConf,
    };
    for (const row of Object.values(byConf)) {
      row.hit_rate = row.n ? row.wins / row.n : null;
      row.avg_pnl = row.n ? row.pnl / row.n : null;
    }

    if (!incoming || typeof incoming !== "object") return computed;

    const over = {
      paper_pnl: num(pick(incoming, ["paper_pnl", "pnl", "total_pnl", "paper_pl"])),
      // paper_roc from files is SUM(pnl)/SUM(every lot's capital) — not used for the hero.
      account_pct: num(pick(incoming, ["account_pct", "acct_pct", "account_return"])),
      open: num(pick(incoming, ["open", "n_open"])),
      invalidated: num(pick(incoming, ["invalidated", "n_invalidated", "killed"])),
      out: num(pick(incoming, ["out", "n_out", "closed"])),
      hit_rate: num(pick(incoming, ["hit_rate", "win_rate"])),
      wins: num(pick(incoming, ["wins", "hit_wins"])),
      resolved: num(pick(incoming, ["resolved", "hit_n", "n_resolved"])),
    };
    for (const [k, v] of Object.entries(over)) {
      if (v != null) computed[k] = v;
    }
    if (incoming.by_structure && typeof incoming.by_structure === "object") {
      computed.by_structure = mergeBreak(computed.by_structure, incoming.by_structure);
    }
    if (incoming.by_creator && typeof incoming.by_creator === "object") {
      computed.by_creator = mergeBreak(computed.by_creator, incoming.by_creator);
    }
    if (incoming.by_confidence && typeof incoming.by_confidence === "object") {
      computed.by_confidence = mergeConf(computed.by_confidence, incoming.by_confidence);
    }
    return computed;
  }

  function mergeBreak(base, extra) {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      if (v && typeof v === "object") {
        out[k] = {
          n: num(v.n ?? v.count) ?? (out[k] && out[k].n) ?? 0,
          pnl: num(v.pnl ?? v.paper_pnl ?? v.total) ?? (out[k] && out[k].pnl) ?? 0,
          cap: num(v.cap ?? v.capital) ?? (out[k] && out[k].cap) ?? 0,
        };
      }
    }
    return out;
  }

  function mergeConf(base, extra) {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      if (v && typeof v === "object") {
        const n = num(v.n ?? v.count) ?? (out[k] && out[k].n) ?? 0;
        const wins = num(v.wins) ?? (out[k] && out[k].wins) ?? 0;
        const pnl = num(v.pnl ?? v.sum_pnl ?? v.paper_pnl) ?? (out[k] && out[k].pnl) ?? 0;
        out[k] = {
          n,
          wins,
          pnl,
          cap: num(v.cap ?? v.capital) ?? (out[k] && out[k].cap) ?? 0,
          hit_rate: num(v.hit_rate) ?? (n ? wins / n : null),
          avg_pnl: num(v.avg_pnl) ?? (n ? pnl / n : null),
        };
      }
    }
    return out;
  }

  async function load() {
    const paper = await fetchFirst(PAPER_JSON, "json");
    const summaryHit = await fetchFirst(SUMMARY_JSON, "json");

    let trades = [];
    let source = "stub";
    let asOf = null;
    let incomingSummary = null;
    let account = ACCOUNT;
    let weekly = WEEKLY;

    if (paper && paper.data) {
      const payload = paper.data;
      trades = asList(payload).map(normalizeTrade).filter(Boolean);
      asOf = pick(payload, ["as_of", "asOf", "updated", "generated_at", "timestamp"]) || null;
      incomingSummary = payload.summary || null;
      account = num(pick(payload, ["account_size", "account", "equity"])) || ACCOUNT;
      weekly = num(pick(payload, ["weekly_target", "target"])) || WEEKLY;
      if (paper.url.endsWith("trade-tracker-paper.json")) source = "paper";
      else if (trades.length) source = pick(payload, ["source"]) || "data.json";
      else source = pick(payload, ["source"]) || "stub";
    }

    if (summaryHit && summaryHit.data) {
      const s = summaryHit.data;
      incomingSummary = incomingSummary ? { ...incomingSummary, ...s } : s;
      asOf = asOf || pick(s, ["as_of", "asOf", "updated", "generated_at"]);
      account = num(pick(s, ["account_size", "account"])) || account;
      weekly = num(pick(s, ["weekly_target", "target"])) || weekly;
      if (source === "stub") source = "summary";
    }

    // Only fall back to CSV when the paper/data book is empty.
    if (!trades.length) {
      const csv = await fetchFirst(CSV_PATHS, "text");
      if (csv) {
        const rows = parseCsv(csv.data).map(normalizeTrade).filter(Boolean);
        if (rows.length) {
          trades = rows;
          source = "csv";
          // CSV has no paper marks — leave P&L null, do not derive it.
          for (const t of trades) {
            t.paper_pnl = null;
            t.paper_pct = null;
            t.live_mark = null;
          }
        }
      }
    }

    state.trades = trades;
    state.account = account;
    state.weekly = weekly;
    state.asOf = asOf;
    state.source = source;
    state.summary = computeSummary(trades, incomingSummary);
    state.deployed = computeDeployedRoc(trades, account, asOf);
  }

  function filtered() {
    const now = new Date();
    return state.trades.filter((t) => {
      if (state.filter === "all") return true;
      if (state.filter === "week") return inThisWeek(t, now);
      if (state.filter === "High" || state.filter === "Medium" || state.filter === "Low") {
        return t.confidence === state.filter;
      }
      return bucket(t.status) === state.filter;
    });
  }

  function renderHero() {
    const s = state.summary || computeSummary([]);
    const marked = s.marked > 0 || (s.paper_pnl != null && state.source === "paper");
    const pnlEl = $("stat-pnl");
    pnlEl.textContent = marked || s.paper_pnl ? money(s.paper_pnl, "$0.00") : "—";
    pnlEl.className = "stat-v mono " + clsPnL(s.paper_pnl);
    $("stat-pnl-sub").textContent = s.marked
      ? s.marked + " ticket" + (s.marked === 1 ? "" : "s") + " with paper marks"
      : "No paper marks yet";

    const roc = state.deployed || computeDeployedRoc([], state.account, state.asOf);
    const rocEl = $("stat-roc");
    rocEl.textContent = pct(roc.roc);
    rocEl.className = "stat-v mono " + clsPnL(roc.roc);
    const idle = roc.idle;
    $("stat-roc-sub").textContent =
      "Avg deployed " + moneyShort(roc.avgDeployed) +
      " · now " + moneyShort(roc.currentDeployed) +
      " · idle " + moneyShort(idle);
    const sparkHost = $("roc-spark");
    if (sparkHost) {
      const pts = (roc.curve || []).map((p, i) => ({ x: i, y: p.cum, label: p.date }));
      sparkHost.innerHTML = pts.length >= 2 ? sparkSvg(pts) : "";
    }

    const acct = s.account_pct;
    const acctEl = $("stat-acct");
    acctEl.textContent = pct(acct, "0.00%");
    acctEl.className = "stat-v mono " + clsPnL(s.paper_pnl);
    const vs = (s.paper_pnl || 0) / (state.weekly || WEEKLY);
    const bar = $("target-bar");
    const w = Math.max(0, Math.min(100, vs * 100));
    bar.style.width = w + "%";
    bar.classList.toggle("over", vs >= 1);
    $("stat-target-sub").textContent =
      money(s.paper_pnl, "$0.00") + " / " + money(state.weekly, "$250.00") +
      " · $25k book";

    $("n-open").textContent = s.open || 0;
    $("n-inv").textContent = s.invalidated || 0;
    $("n-out").textContent = s.out || 0;
    $("stat-book-sub").textContent = state.trades.length
      ? state.trades.length + " ticket" + (state.trades.length === 1 ? "" : "s") + " in view"
      : "No tickets loaded";

    $("stat-hit").textContent = s.hit_rate == null ? "—" : pct(s.hit_rate);
    $("stat-hit-sub").textContent = s.resolved
      ? (s.wins || 0) + " / " + s.resolved + " resolved"
      : "Resolved paper tickets";

    $("asof").textContent = state.asOf ? fmtWhen(state.asOf) : "—";
    $("asof").dateTime = state.asOf ? String(state.asOf) : "";
    const pill = $("source-pill");
    const labels = {
      paper: "paper json",
      "data.json": "data.json",
      csv: "csv fallback",
      stub: "empty stub",
      summary: "summary json",
    };
    pill.textContent = labels[state.source] || state.source;
  }

  function confPill(c, reason) {
    const raw = str(c);
    if (!raw) return '<span class="pill conf none">—</span>';
    const short = raw === "Medium" ? "Med" : raw;
    const title = reason ? escapeHtml(raw + " — " + reason) : escapeHtml(raw);
    return (
      '<span class="pill conf ' + escapeHtml(raw.toLowerCase()) + '" title="' + title + '">' +
        escapeHtml(short) +
      "</span>"
    );
  }

  function renderConf(el, map) {
    const keys = ["High", "Medium", "Low"];
    if (!map || !keys.some((k) => map[k] && map[k].n)) {
      el.innerHTML = '<div class="empty-mini">No thesis grades yet.</div>';
      return;
    }
    const maxN = Math.max(1, ...keys.map((k) => (map[k] && map[k].n) || 0));
    el.innerHTML = keys.map((k) => {
      const row = map[k] || { n: 0, pnl: 0, wins: 0, hit_rate: null };
      const n = row.n || 0;
      const wins = row.wins || 0;
      const hit = row.hit_rate != null ? row.hit_rate : (n ? wins / n : null);
      const width = Math.round((n / maxN) * 100);
      const pnlCls = clsPnL(row.pnl);
      return (
        '<div class="rowb rowb-conf">' +
          '<div class="nm">' + escapeHtml(k) + "</div>" +
          '<div class="mini"><i class="' + (row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "") +
            '" style="width:' + width + '%"></i></div>' +
          '<div class="n">' + wins + "/" + n + "</div>" +
          '<div class="hit">' + (hit == null ? "—" : (hit * 100).toFixed(0) + "%") + "</div>" +
          '<div class="px ' + pnlCls + '">' + (n ? money(row.pnl) : "—") + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function renderBreak(el, map, prefer) {
    const keys = prefer
      ? [...prefer, ...Object.keys(map || {}).filter((k) => !prefer.includes(k))]
      : Object.keys(map || {});
    if (!keys.length) {
      el.innerHTML = '<div class="empty-mini">Nothing to break down yet.</div>';
      return;
    }
    const maxN = Math.max(1, ...keys.map((k) => (map[k] && map[k].n) || 0));
    el.innerHTML = keys.map((k) => {
      const row = map[k] || { n: 0, pnl: 0 };
      const has = row.pnl != null && (row.n || row.pnl);
      const width = Math.round(((row.n || 0) / maxN) * 100);
      const pnlCls = clsPnL(row.pnl);
      return (
        '<div class="rowb">' +
          '<div class="nm">' + escapeHtml(k) + "</div>" +
          '<div class="mini"><i class="' + (row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "") +
            '" style="width:' + width + '%"></i></div>' +
          '<div class="n">' + (row.n || 0) + "</div>" +
          '<div class="px ' + pnlCls + '">' + (has && row.pnl ? money(row.pnl) : "—") + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTable() {
    const rows = filtered();
    const tb = $("tbody");
    $("table-sub").textContent = state.source === "csv"
      ? "CSV book — live mark and paper P&L stay blank until paper JSON exists."
      : state.trades.length
        ? rows.length + " of " + state.trades.length + " · click a row"
        : "Paper marks only — no demo book.";

    if (!rows.length) {
      const msg = state.trades.length
        ? "No tickets match this filter."
        : "Empty book. Waiting for trade-tracker-paper.json (or CSV fallback).";
      tb.innerHTML = '<tr class="empty-row"><td colspan="11">' + msg + "</td></tr>";
      return;
    }
    tb.innerHTML = rows.map((t) => {
      const st = str(t.status) || "open";
      const active = state.selected != null && String(state.selected) === String(t.id) ? " active" : "";
      return (
        '<tr data-id="' + escapeHtml(t.id) + '" class="' + active + '">' +
          "<td>" + escapeHtml(fmtDate(t.date)) + "</td>" +
          '<td class="tk">' + escapeHtml(t.ticker || "—") + "</td>" +
          "<td>" + confPill(t.confidence, t.confidence_reason) + "</td>" +
          "<td><span class=\"struct\">" + escapeHtml(t.structure) + "</span></td>" +
          "<td>" + escapeHtml(strikeExp(t)) + "</td>" +
          '<td class="num mono">' + money(t.credit_or_debit) + "</td>" +
          '<td class="num mono">' + money(t.capital) + "</td>" +
          '<td class="num mono">' + money(t.live_mark) + "</td>" +
          '<td class="num mono ' + clsPnL(t.paper_pnl) + '">' + money(t.paper_pnl) + "</td>" +
          '<td class="num mono ' + clsPnL(t.paper_pct != null ? t.paper_pct : t.paper_pnl) + '">' +
            pct(t.paper_pct) + "</td>" +
          "<td><span class=\"pill " + escapeHtml(st.toLowerCase()) + "\">" +
            escapeHtml(st) + "</span></td>" +
        "</tr>"
      );
    }).join("");
  }

  function pathPoints(path) {
    if (!path) return [];
    if (typeof path === "string") return [];
    if (!Array.isArray(path)) return [];
    return path.map((p, i) => {
      if (typeof p === "number") return { x: i, y: p, label: String(i) };
      if (Array.isArray(p)) return { x: i, y: num(p[1]), label: String(p[0]) };
      const y = num(pick(p, ["px", "price", "close", "spot", "y", "value"]));
      const label = pick(p, ["t", "ts", "date", "time", "label"]) ?? i;
      return { x: i, y, label: String(label) };
    }).filter((p) => p.y != null);
  }

  function sparkSvg(points) {
    if (points.length < 2) return "";
    const w = 380, h = 72, pad = 6;
    const ys = points.map((p) => p.y);
    const min = Math.min.apply(null, ys);
    const max = Math.max.apply(null, ys);
    const span = max - min || 1;
    const coords = points.map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p.y - min) / span) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const last = points[points.length - 1].y;
    const first = points[0].y;
    const color = last >= first ? "#3dcf8e" : "#f07178";
    return (
      '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
        '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" points="' +
        coords.join(" ") + '"/>' +
      "</svg>"
    );
  }

  function flagsOf(t) {
    let f = t.flags;
    if (typeof f === "string") f = f.split(/[|,]/).map((x) => x.trim()).filter(Boolean);
    if (!Array.isArray(f)) f = [];
    return f.map((x) => (typeof x === "string" ? x : (x && x.label) || String(x)));
  }

  function openDrawer(id) {
    const t = state.trades.find((x) => String(x.id) === String(id));
    if (!t) return;
    state.selected = t.id;
    const body = $("drawer-body");
    $("d-kicker").textContent = (t.structure || "Ticket") + (t.creator ? " · " + t.creator : "");
    $("d-title").textContent = t.ticker || "Ticket " + t.id;
    const pts = pathPoints(t.stock_path);
    const flags = flagsOf(t);
    const pathHtml = pts.length
      ? sparkSvg(pts) + '<div class="path-meta">' + pts.length + " prints · last " +
        (pts[pts.length - 1].y != null ? pts[pts.length - 1].y : "—") + "</div>"
      : (typeof t.stock_path === "string" && t.stock_path
          ? '<p class="txt">' + escapeHtml(t.stock_path) + "</p>"
          : '<p class="txt">No stock path recorded.</p>');
    body.innerHTML =
      '<div class="dl">' +
        cell("Date", fmtDate(t.date)) +
        cell("Status", t.status || "—") +
        cell("Confidence", t.confidence || "—") +
        cell("Why", t.confidence_reason || "—") +
        cell("Strike / exp", strikeExp(t)) +
        cell("Credit / debit", money(t.credit_or_debit)) +
        cell("Capital", money(t.capital)) +
        cell("Live mark", money(t.live_mark)) +
        cell("Paper P&L", money(t.paper_pnl)) +
        cell("Paper %", pct(t.paper_pct)) +
      "</div>" +
      '<div class="block"><h3>Notes</h3><p class="txt">' +
        escapeHtml(t.notes || "No notes.") + "</p></div>" +
      '<div class="block"><h3>Invalidation</h3><p class="txt">' +
        escapeHtml(t.invalidation || "None listed.") + "</p></div>" +
      '<div class="block"><h3>Stock path</h3>' + pathHtml + "</div>" +
      '<div class="block"><h3>Flags</h3>' +
        (flags.length
          ? '<div class="flags">' + flags.map((f) => '<span class="flag">' + escapeHtml(f) + "</span>").join("") + "</div>"
          : '<p class="txt">No flags.</p>') +
      "</div>";
    $("drawer").classList.add("on");
    $("drawer").setAttribute("aria-hidden", "false");
    $("shade").hidden = false;
    renderTable();
  }

  function cell(k, v) {
    return '<div class="cell"><div class="k">' + escapeHtml(k) + '</div><div class="v">' +
      escapeHtml(v) + "</div></div>";
  }

  function closeDrawer() {
    state.selected = null;
    $("drawer").classList.remove("on");
    $("drawer").setAttribute("aria-hidden", "true");
    $("shade").hidden = true;
    renderTable();
  }

  function bind() {
    document.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.getAttribute("data-filter") || "all";
        document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b === btn));
        renderTable();
      });
    });
    $("tbody").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      openDrawer(tr.getAttribute("data-id"));
    });
    $("shade").addEventListener("click", closeDrawer);
    $("drawer-close").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawer();
    });
  }

  function render() {
    renderHero();
    const preferS = ["CSP", "stock+CC", "long call"];
    renderBreak($("by-structure"), (state.summary && state.summary.by_structure) || {}, preferS);
    renderBreak($("by-creator"), (state.summary && state.summary.by_creator) || {}, null);
    renderConf($("by-confidence"), (state.summary && state.summary.by_confidence) || {});
    renderTable();
  }

  async function init() {
    bind();
    try {
      await load();
    } catch (err) {
      console.warn("load failed", err);
      state.trades = [];
      state.summary = computeSummary([]);
      state.deployed = computeDeployedRoc([], state.account, state.asOf);
      state.source = "stub";
    }
    render();
  }

  init();
})();
