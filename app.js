/* Stocktimus paper book. Numbers come from files only — never invented. */
(() => {
  const ACCOUNT = 25000;
  const WEEKLY = 375;
  const TZ = "America/Los_Angeles";

  const DESKS = {
    stocktimus: {
      name: "Stocktimus",
      sub: "Paper book",
      files: ["./data.json", "./trade-tracker-paper.json", "../trade-tracker-paper.json"],
      csv: true,
      defaultAccount: 25000,
      defaultWeekly: 375,
    },
    moonshot: {
      name: "Moonshot",
      sub: "10x sleeve",
      files: ["./desks/moonshot.json"],
      csv: false,
      defaultAccount: 5000,
      defaultWeekly: 0,
    },
    compounder: {
      name: "Compounder",
      sub: "Long-term book",
      files: ["./desks/compounder.json"],
      csv: false,
      defaultAccount: 25000,
      defaultWeekly: 0,
    },
  };

  const PAPER_JSON = DESKS.stocktimus.files;
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
  const OUT = new Set(["out", "closed", "expired", "skipped", "no", "resolved"]);

  const PRICE_PROXY_URL = "https://stock-prices-proxy.jessehartung.workers.dev";
  // Polygon Starter/Developer quotes via this worker are DELAYED — never label as real-time.

  const state = {
    trades: [],
    summary: null,
    asOf: null,
    source: "stub",
    desk: "stocktimus",
    filter: "all",
    selected: null,
    account: ACCOUNT,
    weekly: WEEKLY,
    cash: null,
    incomingSummary: null,
    liveOk: false,
    liveAsOf: null,
    mtmTimer: null,
  };

  function deskFromHash() {
    const h = (location.hash || "").replace(/^#/, "").toLowerCase();
    return DESKS[h] ? h : "stocktimus";
  }


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
    // Bare YYYY-MM-DD → calendar date in PT (not UTC midnight, which shows as prior evening PT).
    const bare = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (bare) {
      return new Date(Date.UTC(+bare[1], +bare[2] - 1, +bare[3], 12, 0, 0));
    }
    // Full ISO with time/offset: trust the native parser.
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


  function isClosedBucket(status) {
    const b = bucket(status);
    return b === "out" || b === "invalidated";
  }

  function qtyDisplay(t) {
    if (!t) return "—";
    if (t.shares != null) {
      const n = Number(t.shares);
      if (!Number.isFinite(n)) return "—";
      return Number.isInteger(n) ? String(n) : String(n);
    }
    if (t.contracts != null) {
      const n = Number(t.contracts);
      if (!Number.isFinite(n)) return "—";
      return Number.isInteger(n) ? String(n) : String(n);
    }
    const q = num(pick(t.raw || {}, ["qty"]));
    if (q != null) return Number.isInteger(q) ? String(q) : String(q);
    return "—";
  }

  function exitDisplay(t) {
    if (!t) return "—";
    // Open tickets: always "—". Closed: money(exit || exit_price) or "—".
    if (bucket(t.status) === "open") return "—";
    return money(t.exit != null ? t.exit : t.exit_price);
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

  function preferLiveMark(t) {
    const struct = str(t.structure);
    if (/stock/i.test(struct)) {
      if (t.live_stock != null) return t.live_stock;
      if (t.spot != null) return t.spot;
      return null;
    }
    if (t.live_option_mid != null) return t.live_option_mid;
    if (t.live_option_last != null) return t.live_option_last;
    if (t.live_stock != null) return t.live_stock;
    return null;
  }

  function normalizeShares(raw, structure, contracts) {
    const sh = num(pick(raw, ["shares", "share_count", "qty_shares"]));
    if (sh != null) return sh;
    const struct = str(structure).toLowerCase();
    const n = contracts == null ? null : Number(contracts);
    // Pure equity: Moonshot/Compounder store share count in `contracts`.
    if (struct === "stock" || struct === "equity" || struct === "shares") {
      return n;
    }
    // stock+CC / CSP: contracts are option contracts → 100 shares each.
    if (/stock\s*\+\s*cc/.test(struct) || struct === "csp" || /\bcc\b/.test(struct)) {
      return (n == null ? 1 : n) * 100;
    }
    return null;
  }

  function normalizeTrade(raw, i) {
    if (!raw || typeof raw !== "object") return null;
    const status = str(pick(raw, ["status", "state", "paper_status"])) || "open";
    const paperPnl = num(pick(raw, ["paper_pnl", "paper_pl", "paperPnl", "pnl", "p_and_l"]));
    const paperPct = num(pick(raw, ["paper_pct", "paper_roc", "paper_roc_pct", "paperPct", "roc"]));
    const credit = num(pick(raw, ["credit_or_debit", "credit", "debit", "premium", "premium_total"]));
    const capital = num(pick(raw, ["capital", "capital_at_risk", "cap", "notional"]));
    const structure = str(pick(raw, ["structure", "type", "kind"])) || "—";
    const contracts = num(pick(raw, ["contracts", "qty", "lots"]));
    const spot = num(pick(raw, ["entry", "spot", "spot_at_idea", "spot_entry"]));
    const liveStock = num(pick(raw, ["live_stock"]));
    const liveOptMid = num(pick(raw, ["live_option_mid"]));
    const liveOptLast = num(pick(raw, ["live_option_last"]));
    const liveOptSym = str(pick(raw, ["live_option_symbol", "option_symbol", "occ"]));
    const shares = normalizeShares(raw, structure, contracts);
    const t = {
      id: pick(raw, ["id", "ticket_id"]) ?? i + 1,
      date: pick(raw, ["date", "date_proposed", "date_opened", "proposed"]),
      ticker: str(pick(raw, ["ticker", "symbol", "und"])).toUpperCase(),
      structure,
      strike: pick(raw, ["strike", "k"]),
      expiry: pick(raw, ["expiry", "expiration", "exp"]),
      credit_or_debit: credit,
      credit_or_debit_side: str(pick(raw, ["credit_or_debit_side", "side"])),
      capital,
      live_stock: liveStock,
      live_option_mid: liveOptMid,
      live_option_last: liveOptLast,
      live_option_symbol: liveOptSym || null,
      live_mark: null,
      paper_pnl: paperPnl,
      file_paper_pnl: paperPnl,
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
      spot,
      entry: spot,
      shares,
      contracts,
      dte: num(pick(raw, ["dte"])),
      taken: str(pick(raw, ["taken"])),
      confidence: str(pick(raw, ["confidence", "conf"])),
      confidence_reason: str(pick(raw, ["confidence_reason", "conf_reason"])),
      exit: num(pick(raw, ["exit", "exit_price"])),
      exit_price: num(pick(raw, ["exit_price", "exit"])),
      premium_per_share: num(pick(raw, ["premium_per_share"])),
      raw,
    };
    // Display mark: stock / stock+CC prefer live_stock; options prefer mid/last.
    const fileMark = num(pick(raw, ["live_mark", "mark", "live", "last", "live_premium", "mark_premium"]));
    t.live_mark = preferLiveMark(t);
    if (t.live_mark == null) t.live_mark = fileMark;
    return t;
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
    let openPnl = 0;
    let closedPnl = 0;
    let openMarked = 0;
    let closedMarked = 0;
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
          closedPnl += t.paper_pnl;
          closedMarked += 1;
          resolved += 1;
          if (t.paper_pnl > 0) wins += 1;
        } else {
          openPnl += t.paper_pnl;
          openMarked += 1;
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
      open_pnl: openMarked ? openPnl : 0,
      closed_pnl: closedMarked ? closedPnl : 0,
      open_marked: openMarked,
      closed_marked: closedMarked,
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
    // Soft-fix schema drift: expired lots hidden as out=1; resolved counting opens.
    const resolvedLooksWrong = over.resolved != null && over.resolved === trades.length;
    for (const [k, v] of Object.entries(over)) {
      if (v == null) continue;
      if (k === "out" && computed.out > v) continue;
      if ((k === "hit_rate" || k === "wins" || k === "resolved") && resolvedLooksWrong) continue;
      // After live MTM, always keep P&L summed from (re)marked trades.
      if (k === "paper_pnl" && state.liveOk) continue;
      if (k === "account_pct" && state.liveOk) continue;
      computed[k] = v;
    }
    if (!state.liveOk && incoming.by_structure && typeof incoming.by_structure === "object") {
      computed.by_structure = mergeBreak(computed.by_structure, incoming.by_structure);
    }
    if (!state.liveOk && incoming.by_creator && typeof incoming.by_creator === "object") {
      computed.by_creator = mergeBreak(computed.by_creator, incoming.by_creator);
    }
    if (!state.liveOk && incoming.by_confidence && typeof incoming.by_confidence === "object") {
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

  function isOpenLot(t) {
    return OPEN.has(str(t.status).toLowerCase());
  }

  function optionQuerySymbol(t) {
    const rawSym = str(t.live_option_symbol || (t.raw && t.raw.live_option_symbol));
    if (rawSym) return rawSym.startsWith("O:") ? rawSym : "O:" + rawSym;
    const struct = str(t.structure).toLowerCase();
    // Pure stock has no option leg.
    if (struct === "stock" || struct === "equity" || struct === "shares") return null;
    const ticker = str(t.ticker).toUpperCase();
    const expKey = dateKey(t.expiry);
    const strike = num(t.strike);
    if (!ticker || !expKey || strike == null) return null;
    const yymmdd = expKey.slice(2).replace(/-/g, "");
    let right = str(pick(t.raw || {}, ["right", "option_right", "call_put"])).toUpperCase();
    if (right === "CALL") right = "C";
    if (right === "PUT") right = "P";
    if (right !== "C" && right !== "P") {
      right = rightLetter(t.structure).toUpperCase() === "P" ? "P" : "C";
    }
    const k = String(Math.round(strike * 1000)).padStart(8, "0");
    return "O:" + ticker + yymmdd + right + k;
  }

  function entryPremiumPerShare(t) {
    if (t.premium_per_share != null) return t.premium_per_share;
    const fromRaw = num(pick(t.raw || {}, ["premium_per_share"]));
    if (fromRaw != null) return fromRaw;
    const c = t.credit_or_debit;
    if (c == null) return null;
    const n = Math.max(1, t.contracts == null ? 1 : t.contracts);
    // Stocktimus stores credit_or_debit as total $ premium; convert to per-share.
    if (Math.abs(c) > 5) return c / (100 * n);
    return c;
  }

  function collectLiveSymbols(trades) {
    const stocks = new Set();
    const opts = new Set();
    for (const t of trades) {
      if (!isOpenLot(t)) continue;
      if (t.ticker) stocks.add(t.ticker);
      const o = optionQuerySymbol(t);
      if (o) opts.add(o);
    }
    return [...stocks, ...opts];
  }

  async function fetchLiveQuotes(symbols) {
    if (!symbols.length) return null;
    const q = encodeURIComponent(symbols.join(","));
    const url = PRICE_PROXY_URL + "?symbols=" + q;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("proxy HTTP " + res.status);
    return res.json();
  }

  function recomputeOpenPaperPnl(t, quotes) {
    const struct = str(t.structure).toLowerCase();
    const liveStock = t.live_stock;
    const entryPx = t.spot != null ? t.spot : t.entry;
    const shares = t.shares;

    if (struct === "stock" || struct === "equity" || struct === "shares") {
      if (liveStock == null || entryPx == null || shares == null) return;
      t.paper_pnl = (liveStock - entryPx) * shares;
      return;
    }

    if (/stock\s*\+\s*cc/.test(struct)) {
      if (liveStock == null || entryPx == null || shares == null) return;
      const stockLeg = (liveStock - entryPx) * shares;
      const occ = optionQuerySymbol(t);
      const oq = occ && quotes ? quotes[occ] : null;
      const liveOpt = oq && num(oq.price);
      if (liveOpt == null) {
        t.paper_pnl = stockLeg;
        return;
      }
      let entryCredit = entryPremiumPerShare(t);
      if (entryCredit == null) {
        t.paper_pnl = stockLeg;
        return;
      }
      const side = str(t.credit_or_debit_side).toLowerCase();
      // Short call: credit received. Debit side flips to long-option style.
      const n = Math.max(1, t.contracts == null ? 1 : t.contracts);
      let shortCallPnl;
      if (side === "debit") {
        shortCallPnl = (liveOpt - Math.abs(entryCredit)) * 100 * n;
      } else {
        shortCallPnl = (Math.abs(entryCredit) - liveOpt) * 100 * n;
      }
      t.paper_pnl = stockLeg + shortCallPnl;
      t.live_option_mid = liveOpt;
      return;
    }

    // Other structures: mark safely when we have an option quote + entry premium.
    const occ = optionQuerySymbol(t);
    const oq = occ && quotes ? quotes[occ] : null;
    const liveOpt = oq && num(oq.price);
    let entryCredit = entryPremiumPerShare(t);
    if (liveOpt == null || entryCredit == null) return;
    const n = Math.max(1, t.contracts == null ? 1 : t.contracts);
    const side = str(t.credit_or_debit_side).toLowerCase();
    if (struct === "csp" || side === "credit") {
      t.paper_pnl = (Math.abs(entryCredit) - liveOpt) * 100 * n;
      t.live_option_mid = liveOpt;
    } else if (struct.includes("call") || side === "debit") {
      t.paper_pnl = (liveOpt - Math.abs(entryCredit)) * 100 * n;
      t.live_option_mid = liveOpt;
    }
  }

  function applyLiveMarks(quotes) {
    if (!quotes || typeof quotes !== "object") return false;
    let any = false;
    let maxAsOf = null;
    for (const t of state.trades) {
      if (!isOpenLot(t)) {
        // Closed lots keep file paper_pnl forever.
        if (t.file_paper_pnl != null) t.paper_pnl = t.file_paper_pnl;
        continue;
      }
      const q = t.ticker ? quotes[t.ticker] : null;
      if (q && num(q.price) != null) {
        t.live_stock = num(q.price);
        any = true;
        if (q.asOf != null && (maxAsOf == null || q.asOf > maxAsOf)) maxAsOf = q.asOf;
      }
      const occ = optionQuerySymbol(t);
      if (occ && quotes[occ] && num(quotes[occ].price) != null) {
        const op = num(quotes[occ].price);
        // Keep mid-ish field for display preference on option structures.
        if (t.live_option_mid == null) t.live_option_mid = op;
        else t.live_option_mid = op;
        any = true;
        if (quotes[occ].asOf != null && (maxAsOf == null || quotes[occ].asOf > maxAsOf)) {
          maxAsOf = quotes[occ].asOf;
        }
      }
      t.live_mark = preferLiveMark(t);
      recomputeOpenPaperPnl(t, quotes);
    }
    if (any) {
      state.liveOk = true;
      if (maxAsOf != null) state.liveAsOf = maxAsOf;
      state.summary = computeSummary(state.trades, state.incomingSummary);
    }
    return any;
  }

  async function refreshLiveMarks() {
    const symbols = collectLiveSymbols(state.trades);
    if (!symbols.length) return false;
    try {
      const quotes = await fetchLiveQuotes(symbols);
      return applyLiveMarks(quotes);
    } catch (err) {
      console.warn("live marks failed", err);
      // Do not invent prices — leave prior values.
      return false;
    }
  }

  function stopLiveMtm() {
    if (state.mtmTimer != null) {
      clearInterval(state.mtmTimer);
      state.mtmTimer = null;
    }
  }

  function startLiveMtm() {
    stopLiveMtm();
    state.mtmTimer = setInterval(() => {
      refreshLiveMarks().then((ok) => { if (ok) render(); }).catch(() => {});
    }, 30000);
  }

  async function load() {
    const deskId = state.desk || deskFromHash();
    const desk = DESKS[deskId] || DESKS.stocktimus;
    const paper = await fetchFirst(desk.files, "json");
    const summaryHit = deskId === "stocktimus" ? await fetchFirst(SUMMARY_JSON, "json") : null;

    let trades = [];
    let source = "stub";
    let asOf = null;
    let incomingSummary = null;
    let account = desk.defaultAccount;
    let weekly = desk.defaultWeekly;

    let cash = null;
    if (paper && paper.data) {
      const payload = paper.data;
      trades = asList(payload).map(normalizeTrade).filter(Boolean);
      asOf = pick(payload, ["as_of", "asOf", "updated", "generated_at", "timestamp"]) || null;
      incomingSummary = payload.summary || null;
      account = num(pick(payload, ["account_size", "account", "equity"]));
      if (account == null) account = desk.defaultAccount;
      const w = num(pick(payload, ["weekly_target", "target"]));
      weekly = w == null ? desk.defaultWeekly : w;
      cash = num(pick(payload, ["cash", "cash_balance", "buying_power"]));
      if (paper.url.endsWith("trade-tracker-paper.json")) source = "paper";
      else if (trades.length) source = pick(payload, ["source"]) || "data.json";
      else source = pick(payload, ["source"]) || "stub";
    }

    if (summaryHit && summaryHit.data) {
      const s = summaryHit.data;
      incomingSummary = incomingSummary ? { ...incomingSummary, ...s } : s;
      asOf = asOf || pick(s, ["as_of", "asOf", "updated", "generated_at"]);
      account = num(pick(s, ["account_size", "account"])) ?? account;
      const sw = num(pick(s, ["weekly_target", "target"]));
      if (sw != null) weekly = sw;
      if (source === "stub") source = "summary";
    }

    // Only fall back to CSV when the Stocktimus paper/data book is empty.
    if (!trades.length && desk.csv) {
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
    state.cash = cash;
    state.asOf = asOf;
    state.source = source;
    state.incomingSummary = incomingSummary;
    state.liveOk = false;
    state.liveAsOf = null;
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
    const pnlSub = $("stat-pnl-sub");
    if (state.cash != null) {
      pnlSub.textContent = "Cash " + money(state.cash, "$0.00") + (state.liveOk ? " · delayed MTM" : "");
    } else {
      pnlSub.textContent = s.marked
        ? s.marked + " ticket" + (s.marked === 1 ? "" : "s") + " with paper marks"
        : "No paper marks yet";
      if (state.liveOk) pnlSub.textContent += " · delayed MTM";
    }

    const openPnlEl = $("stat-open-pnl");
    if (openPnlEl) {
      const op = s.open_pnl;
      openPnlEl.textContent = (s.open_marked || op) ? money(op, "$0.00") : "—";
      openPnlEl.className = "stat-v mono " + clsPnL(op);
      const opSub = $("stat-open-pnl-sub");
      if (opSub) {
        opSub.textContent = s.open_marked
          ? s.open_marked + " open marked"
          : ((s.open || 0) + " open");
      }
    }
    const closedPnlEl = $("stat-closed-pnl");
    if (closedPnlEl) {
      const cp = s.closed_pnl;
      closedPnlEl.textContent = (s.closed_marked || cp) ? money(cp, "$0.00") : "—";
      closedPnlEl.className = "stat-v mono " + clsPnL(cp);
      const cpSub = $("stat-closed-pnl-sub");
      if (cpSub) {
        cpSub.textContent = s.closed_marked
          ? s.closed_marked + " closed marked"
          : (((s.out || 0) + (s.invalidated || 0)) + " closed");
      }
    }

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
    const kEl = $("stat-target-k");
    const bar = $("target-bar");
    if (!state.weekly) {
      if (kEl) kEl.textContent = "Account return";
      bar.style.width = "0%";
      bar.classList.remove("over");
      $("stat-target-sub").textContent =
        money(s.paper_pnl, "$0.00") + " · " + money(state.account, "$0.00") + " book · no weekly target";
    } else {
      if (kEl) kEl.textContent = "Account vs " + money(state.weekly, "$375.00") + " / week";
      const vs = (s.paper_pnl || 0) / state.weekly;
      const w = Math.max(0, Math.min(100, vs * 100));
      bar.style.width = w + "%";
      bar.classList.toggle("over", vs >= 1);
      $("stat-target-sub").textContent =
        money(s.paper_pnl, "$0.00") + " / " + money(state.weekly, "$375.00") +
        " · " + money(state.account, "$25,000.00") + " book";
    }

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

    const asofShow = state.liveAsOf != null ? state.liveAsOf : state.asOf;
    $("asof").textContent = asofShow != null ? fmtWhen(asofShow) : "—";
    $("asof").dateTime = asofShow != null ? String(asofShow) : "";
    const pill = $("source-pill");
    const labels = {
      paper: "paper json",
      "data.json": "data.json",
      csv: "csv fallback",
      stub: "empty stub",
      summary: "summary json",
      compounder: "compounder",
    };
    let src = labels[state.source] || state.source;
    if (state.liveOk) src += " · delayed";
    pill.textContent = src;
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

  function tradeRowHtml(t) {
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
        '<td class="num mono">' + money(t.entry != null ? t.entry : t.spot) + "</td>" +
        '<td class="num mono">' + escapeHtml(qtyDisplay(t)) + "</td>" +
        '<td class="num mono">' + exitDisplay(t) + "</td>" +
        '<td class="num mono">' + money(t.live_mark) + "</td>" +
        '<td class="num mono ' + clsPnL(t.paper_pnl) + '">' + money(t.paper_pnl) + "</td>" +
        '<td class="num mono ' + clsPnL(t.paper_pct != null ? t.paper_pct : t.paper_pnl) + '">' +
          pct(t.paper_pct) + "</td>" +
        "<td><span class=\"pill " + escapeHtml(st.toLowerCase()) + "\">" +
          escapeHtml(st) + "</span></td>" +
      "</tr>"
    );
  }

  function fillTradeBody(tb, rows, emptyMsg) {
    if (!tb) return;
    if (!rows.length) {
      tb.innerHTML = '<tr class="empty-row"><td colspan="14">' + emptyMsg + "</td></tr>";
      return;
    }
    tb.innerHTML = rows.map(tradeRowHtml).join("");
  }

  function renderTable() {
    const rows = filtered();
    const openRows = rows.filter((t) => !isClosedBucket(t.status));
    const closedRows = rows.filter((t) => isClosedBucket(t.status));

    $("table-sub").textContent = state.source === "csv"
      ? "CSV book — live mark and paper P&L stay blank until paper JSON exists."
      : state.trades.length
        ? openRows.length + " open · " + closedRows.length + " closed · " +
          rows.length + " of " + state.trades.length + " · click a row"
        : "Paper marks only — no demo book.";

    const emptyBook = state.trades.length
      ? "No tickets match this filter."
      : "Empty book. Waiting for trade-tracker-paper.json (or CSV fallback).";

    const openSub = $("open-sub");
    if (openSub) {
      openSub.textContent = openRows.length
        ? openRows.length + " open ticket" + (openRows.length === 1 ? "" : "s")
        : "No open tickets";
    }
    const closedSub = $("closed-sub");
    if (closedSub) {
      closedSub.textContent = closedRows.length
        ? closedRows.length + " closed ticket" + (closedRows.length === 1 ? "" : "s")
        : "No closed tickets";
    }

    fillTradeBody(
      $("tbody-open"),
      openRows,
      state.trades.length ? "No open tickets match this filter." : emptyBook
    );
    fillTradeBody(
      $("tbody-closed"),
      closedRows,
      state.trades.length ? "No closed tickets match this filter." : emptyBook
    );
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
        cell("Qty", qtyDisplay(t)) +
        cell("Entry", money(t.entry != null ? t.entry : t.spot)) +
        cell("Exit", exitDisplay(t)) +
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

  function syncDeskTabs() {
    const name = $("desk-name");
    const sub = $("desk-sub");
    const desk = DESKS[state.desk] || DESKS.stocktimus;
    if (name) name.textContent = desk.name;
    if (sub) sub.textContent = desk.sub;
    document.title = desk.name + " · Paper book";
    document.querySelectorAll(".desk-tab").forEach((a) => {
      a.classList.toggle("on", a.getAttribute("data-desk") === state.desk);
    });
  }

  function bind() {
    window.addEventListener("hashchange", () => {
      const next = deskFromHash();
      if (next === state.desk) return;
      state.desk = next;
      state.filter = "all";
      document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.getAttribute("data-filter") === "all"));
      syncDeskTabs();
      stopLiveMtm();
      load()
        .then(async () => {
          render();
          await refreshLiveMarks();
          render();
          startLiveMtm();
        })
        .catch((err) => {
          console.warn("desk load failed", err);
          render();
        });
    });
    document.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.getAttribute("data-filter") || "all";
        document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b === btn));
        renderTable();
      });
    });
    const books = document.querySelector(".books") || document;
    books.addEventListener("click", (e) => {
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
    state.desk = deskFromHash();
    bind();
    syncDeskTabs();
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
    try {
      await refreshLiveMarks();
      render();
    } catch (err) {
      console.warn("initial live marks failed", err);
    }
    startLiveMtm();
  }

  init();
})();
