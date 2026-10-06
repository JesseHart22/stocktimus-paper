/**
 * stocktimus-drive — launch, doctor, drive, cleanup for the paper book.
 * Dollar figures are read from JSON at runtime. This file must not hardcode P&L or prices.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const HELPERS = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HELPERS, "..");
const REPO = resolve(SKILL_ROOT, "../../..");
const EVIDENCE = process.env.STOCKTIMUS_EVIDENCE
  ? resolve(process.env.STOCKTIMUS_EVIDENCE)
  : join(SKILL_ROOT, "evidence");
const RUN_DIR = join(EVIDENCE, ".run");
const SERVER_FILE = join(RUN_DIR, "server.json");

const PROXY_URL = "https://stock-prices-proxy.jessehartung.workers.dev";
const OPEN = new Set(["open", "proposed", "live", "taken", "yes"]);
const INV = new Set(["invalidated", "invalid", "killed"]);
const OUT = new Set(["out", "closed", "expired", "skipped", "no", "resolved"]);
const PILL_LABELS = {
  paper: "paper json",
  "data.json": "data.json",
  csv: "csv fallback",
  stub: "empty stub",
  summary: "summary json",
  compounder: "compounder",
};

const PAPER_DESKS = {
  "stocktimus-paper-book": {
    tab: "stocktimus",
    name: "Stocktimus",
    sub: "Paper book",
    title: "Stocktimus · Paper book",
    file: "data.json",
    summaryFile: "trade-tracker-summary.json",
    defaultAccount: 250000,
    defaultWeekly: 3750,
  },
  "moonshot-desk": {
    tab: "moonshot",
    name: "Moonshot",
    sub: "10x sleeve",
    title: "Moonshot · Paper book",
    file: "desks/moonshot.json",
    summaryFile: null,
    defaultAccount: 250000,
    defaultWeekly: 0,
  },
  "compounder-desk": {
    tab: "compounder",
    name: "Compounder",
    sub: "Long-term book",
    title: "Compounder · Paper book",
    file: "desks/compounder.json",
    summaryFile: null,
    defaultAccount: 250000,
    defaultWeekly: 0,
  },
};

const FEATURES = [
  "stocktimus-paper-book",
  "moonshot-desk",
  "compounder-desk",
  "scoreboard-tab",
  "delayed-mark-label",
  "jesse-tab",
  "sleeve-tab",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readText(rel) {
  return readFileSync(join(REPO, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(readText(rel));
}

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
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
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
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const p = Math.abs(n) <= 2 ? n * 100 : n;
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return sign + Math.abs(p).toFixed(2) + "%";
}

function asList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.trades)) return payload.trades;
  return [];
}

function bucket(status) {
  const s = str(status).toLowerCase();
  if (INV.has(s)) return "invalidated";
  if (OUT.has(s)) return "out";
  if (OPEN.has(s) || !s) return "open";
  return s;
}

function tradeStatus(t) {
  return str(pick(t, ["status", "state", "paper_status"])) || "open";
}

function tradeId(t, i) {
  const id = pick(t, ["id", "ticket_id"]);
  return String(id == null ? i + 1 : id);
}

function paperPnl(t) {
  return num(pick(t, ["paper_pnl", "paper_pl", "paperPnl", "pnl", "p_and_l"]));
}

function isClosedStatus(status) {
  const b = bucket(status);
  return b === "out" || b === "invalidated";
}

function footerFromIndex() {
  const html = readText("index.html");
  const m = html.match(/<footer class="foot">([\s\S]*?)<\/footer>/);
  if (!m) throw new Error("index.html has no footer.foot");
  return m[1].replace(/\s+/g, " ").trim();
}

function publishedMarkKind(payload) {
  const source = str(pick(payload, ["marks_source"])).toLowerCase();
  const quality = str(pick(payload, ["quote_quality"])).toLowerCase();
  if (source.includes("robinhood") || quality === "robinhood" || quality === "live" || quality === "robinhood_live") {
    return "robinhood";
  }
  if (quality.includes("delay") || source.includes("massive") || source.includes("polygon") || source.includes("stock-prices-proxy")) {
    return "delayed";
  }
  return null;
}

function pillBase(payload) {
  const trades = asList(payload);
  let source = "stub";
  if (trades.length) source = str(pick(payload, ["source"])) || "data.json";
  else source = str(pick(payload, ["source"])) || "stub";
  return PILL_LABELS[source] || source;
}

function accountWeekly(desk, payload, summary) {
  let account = num(pick(payload, ["account_size", "account", "equity"]));
  if (account == null) account = desk.defaultAccount;
  const w = num(pick(payload, ["weekly_target", "target"]));
  let weekly = w == null ? desk.defaultWeekly : w;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    const sa = num(pick(summary, ["account_size", "account"]));
    if (sa != null) account = sa;
    const sw = num(pick(summary, ["weekly_target", "target"]));
    if (sw != null) weekly = sw;
  }
  return { account, weekly };
}

function bookCounts(trades, summary) {
  const computed = { open: 0, invalidated: 0, out: 0 };
  for (const t of trades) {
    const b = bucket(tradeStatus(t));
    if (b === "invalidated") computed.invalidated += 1;
    else if (b === "out") computed.out += 1;
    else computed.open += 1;
  }
  if (summary && typeof summary === "object") {
    const over = {
      open: num(pick(summary, ["open", "n_open"])),
      invalidated: num(pick(summary, ["invalidated", "n_invalidated", "killed"])),
      out: num(pick(summary, ["out", "n_out", "closed"])),
    };
    for (const [k, v] of Object.entries(over)) {
      if (v == null) continue;
      if (k === "out" && computed.out > v) continue;
      computed[k] = v;
    }
  }
  return computed;
}

function closedPnlText(trades) {
  let pnl = 0;
  let marked = 0;
  for (const t of trades) {
    if (!isClosedStatus(tradeStatus(t))) continue;
    const p = paperPnl(t);
    if (p == null) continue;
    pnl += p;
    marked += 1;
  }
  if (!marked) return "—";
  return money(pnl);
}

function fileTotalText(trades, summary, live) {
  if (!live && summary && num(pick(summary, ["paper_pnl", "pnl", "total_pnl", "paper_pl"])) != null) {
    return money(num(pick(summary, ["paper_pnl", "pnl", "total_pnl", "paper_pl"])));
  }
  let pnl = 0;
  let marked = 0;
  for (const t of trades) {
    const p = paperPnl(t);
    if (p == null) continue;
    pnl += p;
    marked += 1;
  }
  return money(marked ? pnl : 0);
}

function ticketLine(n) {
  if (!n) return "No tickets loaded";
  return n + " ticket" + (n === 1 ? "" : "s") + " in view";
}

function confidenceCounts(trades) {
  const counts = { High: 0, Medium: 0, Low: 0 };
  for (const t of trades) {
    const c = str(pick(t, ["confidence", "conf"]));
    if (counts[c] != null) counts[c] += 1;
  }
  return counts;
}

function pillLabel(conf) {
  if (conf === "Medium") return "Med";
  return conf || "—";
}

function firstOpenTicker(trades) {
  for (const t of trades) {
    if (!OPEN.has(tradeStatus(t).toLowerCase())) continue;
    const ticker = str(pick(t, ["ticker", "symbol", "und"])).toUpperCase();
    if (ticker) return ticker;
  }
  return null;
}

function cashOf(payload) {
  return num(pick(payload, ["cash", "cash_balance", "buying_power"]));
}

function mergedSummary(payload, summaryFile) {
  const base = payload && payload.summary && typeof payload.summary === "object" ? payload.summary : null;
  if (!summaryFile) return base;
  if (!base) return summaryFile;
  // app.js: incomingSummary = { ...payload.summary, ...trade-tracker-summary.json }
  return { ...base, ...summaryFile };
}

function writeJson(name, data) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, name), JSON.stringify(data, null, 2) + "\n");
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function readServer() {
  if (!existsSync(SERVER_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SERVER_FILE, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHttp(url, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  return false;
}

async function launch() {
  const existing = readServer();
  if (existing && pidAlive(existing.pid) && (await waitForHttp(existing.url, 5))) {
    console.log("launch reuse " + existing.url + " pid " + existing.pid);
    return existing;
  }
  const port = await freePort();
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn(
    "python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: REPO, detached: true, stdio: "ignore" },
  );
  child.unref();
  const info = { pid: child.pid, url, port, startedAt: new Date().toISOString() };
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(SERVER_FILE, JSON.stringify(info, null, 2) + "\n");
  if (!(await waitForHttp(url))) {
    throw new Error("static server did not answer at " + url);
  }
  console.log("launch " + url + " pid " + info.pid);
  return info;
}

function requireServer() {
  const info = readServer();
  if (!info || !pidAlive(info.pid)) {
    throw new Error("no local server. Run: node helpers/drive.mjs launch");
  }
  return info;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH.");
  return found;
}

async function loadChromium() {
  try {
    const { chromium } = await import("playwright-core");
    return chromium;
  } catch {
    throw new Error(
      "playwright-core is not installed. Run: npm install --prefix " + HELPERS,
    );
  }
}

function hard(checks, name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || "" });
  if (!ok) console.log("FAIL " + name + (detail ? " — " + detail : ""));
  else console.log("ok   " + name);
  return !!ok;
}

async function proxyProbe(symbol) {
  const out = {
    url: PROXY_URL,
    symbol: symbol || null,
    ok: false,
    status: null,
    numericPricePresent: false,
    error: null,
  };
  if (!symbol) {
    out.error = "no open ticker in data.json";
    return out;
  }
  try {
    const res = await fetch(PROXY_URL + "?symbols=" + encodeURIComponent(symbol), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    out.status = res.status;
    out.ok = res.ok;
    if (!res.ok) return out;
    const body = await res.json();
    const quote = body && (body[symbol] || body[symbol.toUpperCase()] || (body.quotes && body.quotes[symbol]));
    const price = quote && typeof quote === "object" ? quote.price : body && body.price;
    out.numericPricePresent = typeof price === "number" && Number.isFinite(price);
  } catch (err) {
    out.ok = false;
    out.error = err && err.name ? err.name : "fetch failed";
  }
  return out;
}

async function doctor() {
  const checks = [];
  const server = requireServer();
  const app = readText("app.js");
  const index = readText("index.html");
  const scoreboardJs = readText("scoreboard.js");

  hard(checks, "app.js loads data.json first", app.includes('files: ["./data.json", "./trade-tracker-paper.json", "../trade-tracker-paper.json"]'));
  hard(checks, "app.js moonshot file", app.includes('files: ["./desks/moonshot.json"]'));
  hard(checks, "app.js compounder file", app.includes('files: ["./desks/compounder.json"]'));
  hard(checks, "massive delayed proxy url", app.includes('const MASSIVE_DELAYED_PROXY_URL = "' + PROXY_URL + '"'));
  hard(checks, "delayed pill suffix", app.includes('src += " · delayed"'));
  hard(checks, "robinhood pill suffix", app.includes('src += " · Robinhood live"'));
  hard(checks, "delayed MTM copy", app.includes("delayed MTM"));
  hard(checks, "massive fallback gate", app.includes("function needsMassiveFallback()"));
  hard(checks, "no default live poll", !app.includes("startLiveMtm"));
  hard(checks, "footer not advice", index.includes("Not advice"));
  hard(checks, "desk tabs", ["stocktimus", "moonshot", "compounder", "sleeve", "jesse", "scoreboard"].every((id) => index.includes('data-desk="' + id + '"')));
  hard(checks, "jesse tracker path", readText("jesse.js").includes('const FILE = "./jesse/cc-tracker.json"'));
  hard(checks, "sleeve ledger path", readText("sleeve.js").includes('const FILE = "./sleeve/trades.json"'));
  hard(checks, "scoreboard redirect", readText("scoreboard.html").includes('location.replace("./#scoreboard")'));
  hard(checks, "scoreboard.js desk files", ["stocktimus", "compounder", "moonshot", "scout"].every((id) => scoreboardJs.includes("./scoreboard/" + id + ".json")));

  const books = {};
  for (const rel of ["data.json", "desks/moonshot.json", "desks/compounder.json"]) {
    let payload;
    try {
      payload = readJson(rel);
    } catch (err) {
      hard(checks, rel + " parses", false, err.message);
      continue;
    }
    const trades = asList(payload);
    const ids = trades.map(tradeId);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    hard(checks, rel + " parses", true, trades.length + " tickets");
    hard(checks, rel + " unique ids", !dup, dup ? "duplicate " + dup : "");
    books[rel] = { tickets: trades.length };
  }
  try {
    JSON.parse(readText("trade-tracker-paper.json"));
    hard(checks, "trade-tracker-paper.json parses", true, "fallback, not the first file");
  } catch (err) {
    hard(checks, "trade-tracker-paper.json parses", false, err.message);
  }
  try {
    const summary = readJson("trade-tracker-summary.json");
    hard(checks, "summary has account and weekly_target", num(summary.account) != null && num(summary.weekly_target) != null);
  } catch (err) {
    hard(checks, "trade-tracker-summary.json parses", false, err.message);
  }

  for (const id of ["stocktimus", "moonshot", "compounder", "scout"]) {
    const rel = "scoreboard/" + id + ".json";
    try {
      const payload = readJson(rel);
      const calls = Array.isArray(payload.calls) ? payload.calls : null;
      hard(checks, rel + " desk field", payload.desk === id, "desk=" + payload.desk);
      hard(checks, rel + " calls array", !!calls, calls ? calls.length + " calls" : "missing calls");
      if (calls) {
        const ids = calls.map((c) => str(c.id));
        const dup = ids.find((x, i) => x && ids.indexOf(x) !== i);
        hard(checks, rel + " unique call ids", !dup, dup ? "duplicate " + dup : "");
      }
    } catch (err) {
      hard(checks, rel + " parses", false, err.message);
    }
  }

  try {
    const jesse = readJson("jesse/cc-tracker.json");
    const ids = (jesse.trades || []).map((t) => str(t.trade_id));
    const dup = ids.find((id, i) => id && ids.indexOf(id) !== i);
    hard(checks, "jesse/cc-tracker.json parses", true, (jesse.trades || []).length + " trades");
    hard(checks, "jesse desk field", jesse.desk === "jesse", "desk=" + jesse.desk);
    hard(checks, "jesse unique trade ids", !dup, dup ? "duplicate " + dup : "");
    hard(checks, "jesse weeks", Array.isArray(jesse.weeks) && jesse.weeks.length > 0, String((jesse.weeks || []).length));
    const board = jesse.dashboard || {};
    hard(checks, "jesse dashboard roc", num(board.roc_vs_covered) != null && num(board.roc_vs_program) != null);
    hard(checks, "jesse weekly summary", Array.isArray(jesse.weekly_summary) && jesse.weekly_summary.length > 0, String((jesse.weekly_summary || []).length));
  } catch (err) {
    hard(checks, "jesse/cc-tracker.json parses", false, err.message);
  }

  try {
    const sleeve = readJson("sleeve/trades.json");
    const fillIds = (sleeve.fills || []).map((f) => str(f.fill_id));
    const dup = fillIds.find((id, i) => id && fillIds.indexOf(id) !== i);
    const symbols = (sleeve.open_positions && sleeve.open_positions.equity || []).map((p) => str(p.symbol));
    hard(checks, "sleeve/trades.json parses", true, (sleeve.fills || []).length + " fills");
    hard(checks, "sleeve schema", str(sleeve.schema_version) === "1.0", str(sleeve.schema_version));
    hard(checks, "sleeve unique fill ids", !dup, dup ? "duplicate " + dup : "");
    hard(checks, "sleeve has equity book", symbols.length > 0, symbols.join(","));
  } catch (err) {
    hard(checks, "sleeve/trades.json parses", false, err.message);
  }

  const origin = server.url.replace(/\/$/, "");
  const routes = ["/", "/data.json", "/desks/moonshot.json", "/desks/compounder.json", "/app.js", "/scoreboard.js", "/scoreboard/stocktimus.json", "/scoreboard/scout.json", "/jesse/cc-tracker.json", "/jesse.js", "/jesse.css", "/sleeve/trades.json", "/sleeve.js", "/sleeve.css", "/shell.css"];
  for (const route of routes) {
    try {
      const res = await fetch(origin + route, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      const looksRight = route === "/"
        ? text.includes('id="desk-name"') && text.includes("Stocktimus")
        : res.ok && text.length > 0;
      hard(checks, "GET " + route, res.ok && looksRight, "HTTP " + res.status);
    } catch (err) {
      hard(checks, "GET " + route, false, err.message);
    }
  }

  let symbol = null;
  try {
    symbol = firstOpenTicker(asList(readJson("data.json")));
  } catch {
    symbol = null;
  }
  const proxy = await proxyProbe(symbol);
  console.log("proxy " + (proxy.ok ? "reachable" : "not reachable") + " numericPrice=" + proxy.numericPricePresent);

  const ok = checks.every((c) => c.ok);
  const report = {
    ok,
    at: new Date().toISOString(),
    url: server.url,
    books,
    proxy,
    numbersSource: "json-files",
    inventedPrices: false,
    checks,
  };
  writeJson("doctor.json", report);
  if (!ok) {
    console.log("doctor failed");
    process.exitCode = 1;
    return;
  }
  console.log("doctor ok -> " + join(EVIDENCE, "doctor.json"));
}

function settleProxy(page, ms = 2000) {
  return new Promise((resolveSettle) => {
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveSettle(why);
    };
    const timer = setTimeout(() => finish("timeout"), ms);
    const onResponse = (res) => {
      if (res.url().includes("stock-prices-proxy")) finish(res.ok() ? "ok" : "http-" + res.status());
    };
    const onFailed = (req) => {
      if (req.url().includes("stock-prices-proxy")) finish("failed");
    };
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
  });
}

async function paperSnapshot(page) {
  return page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    const foot = document.querySelector(".foot");
    const rows = [...document.querySelectorAll("tr[data-id]")].map((tr) => {
      const pill = tr.querySelector(".pill.conf");
      return {
        id: tr.getAttribute("data-id"),
        ticker: (tr.querySelector("td.tk") && tr.querySelector("td.tk").textContent.trim()) || "",
        conf: pill ? pill.textContent.trim() : "",
        confTitle: pill ? (pill.getAttribute("title") || "") : "",
      };
    });
    return {
      title: document.title,
      deskName: text("desk-name"),
      deskSub: text("desk-sub"),
      pill: text("source-pill"),
      bookSub: text("stat-book-sub"),
      pnl: text("stat-pnl"),
      pnlSub: text("stat-pnl-sub"),
      closedPnl: text("stat-closed-pnl"),
      openN: text("n-open"),
      invN: text("n-inv"),
      outN: text("n-out"),
      targetK: text("stat-target-k"),
      deployedSub: text("stat-deployed-sub"),
      footer: foot ? foot.textContent.trim().replace(/\s+/g, " ") : "",
      footerVisible: !!(foot && getComputedStyle(foot).display !== "none"),
      rows,
      tabOn: (document.querySelector(".desk-tab.on") && document.querySelector(".desk-tab.on").getAttribute("data-desk")) || "",
    };
  });
}

async function openPaperDesk(page, desk) {
  const payload = readJson(desk.file);
  const trades = asList(payload);
  const summary = desk.summaryFile ? readJson(desk.summaryFile) : (payload.summary || null);
  const expectedLine = ticketLine(trades.length);
  const proxyWait = settleProxy(page);
  await page.locator('a.desk-tab[data-desk="' + desk.tab + '"]').click();
  await page.waitForFunction((line) => {
    const book = document.getElementById("stat-book-sub");
    const pill = document.getElementById("source-pill");
    const loading = [...document.querySelectorAll("tbody")].some((tb) => (tb.textContent || "").includes("Loading book"));
    return book && book.textContent.trim() === line && pill && pill.textContent.trim() !== "loading" && !loading;
  }, expectedLine, { timeout: 20000 });
  const proxy = await proxyWait;
  if (proxy === "ok") {
    await page.waitForFunction(() => {
      const pill = document.getElementById("source-pill");
      return pill && pill.textContent.includes("delayed");
    }, null, { timeout: 5000 }).catch(() => {});
  }
  return { payload, trades, summary, proxy };
}

async function drivePaper(page, featureId) {
  const desk = PAPER_DESKS[featureId];
  const checks = [];
  const { payload, trades, summary, proxy } = await openPaperDesk(page, desk);
  const snap = await paperSnapshot(page);
  const proxyRemarked = proxy === "ok";
  const summaryObj = mergedSummary(payload, desk.summaryFile ? summary : null);
  const countsFixed = bookCounts(trades, summaryObj);
  const { account, weekly } = accountWeekly(desk, payload, desk.summaryFile ? summary : null);
  const footer = footerFromIndex();
  const base = pillBase(payload);
  const kind = publishedMarkKind(payload);
  let expectedPill = base;
  if (kind === "robinhood") expectedPill = base + " · Robinhood live";
  else if (kind === "delayed" || proxyRemarked) expectedPill = base + " · delayed";
  const ids = new Set(trades.map(tradeId));
  const seen = snap.rows.map((r) => r.id);

  hard(checks, "desk name", snap.deskName === desk.name, snap.deskName);
  hard(checks, "desk subtitle", snap.deskSub === desk.sub, snap.deskSub);
  hard(checks, "document title", snap.title === desk.title, snap.title);
  hard(checks, "active tab", snap.tabOn === desk.tab, snap.tabOn);
  hard(checks, "source pill", snap.pill === expectedPill, snap.pill + " expected " + expectedPill);
  hard(checks, "pill is not real-time", !/real-?time/i.test(snap.pill), snap.pill);
  hard(checks, "ticket line", snap.bookSub === ticketLine(trades.length), snap.bookSub);
  hard(checks, "row ids match file", seen.length === ids.size && seen.every((id) => ids.has(id)), seen.length + " rows / " + ids.size + " file");
  hard(checks, "footer text", snap.footer === footer, snap.footer);
  hard(checks, "footer visible", snap.footerVisible);
  hard(checks, "deployed subtitle names file account", snap.deployedSub.includes("of " + money(account) + " book"), snap.deployedSub);
  if (!weekly) {
    hard(checks, "no weekly goal tile", snap.targetK === "Return on avg deployed", snap.targetK);
  } else {
    hard(checks, "weekly goal label", snap.targetK === "Avg $/week vs " + money(weekly) + " goal", snap.targetK);
  }
  hard(checks, "open count", snap.openN === String(countsFixed.open), snap.openN + " vs " + countsFixed.open);
  hard(checks, "inv count", snap.invN === String(countsFixed.invalidated), snap.invN + " vs " + countsFixed.invalidated);
  hard(checks, "out count", snap.outN === String(countsFixed.out), snap.outN + " vs " + countsFixed.out);
  const expectedClosed = closedPnlText(trades);
  hard(checks, "closed P&L matches file", snap.closedPnl === expectedClosed, snap.closedPnl + " vs " + expectedClosed);
  if (!proxyRemarked) {
    const expectedTotal = fileTotalText(trades, summaryObj, false);
    hard(checks, "total P&L matches file", snap.pnl === expectedTotal, snap.pnl + " vs " + expectedTotal);
  } else {
    hard(checks, "proxy total is formatted money", /^(?:−\$|\$)[\d,]+\.\d{2}$/.test(snap.pnl), snap.pnl);
    hard(checks, "delayed MTM subtitle", snap.pnlSub.includes("delayed MTM"), snap.pnlSub);
  }
  if (kind === "delayed") {
    hard(checks, "file delayed subtitle", snap.pnlSub.includes("delayed MTM"), snap.pnlSub);
  }
  if (kind === "robinhood") {
    hard(checks, "robinhood subtitle", snap.pnlSub.includes("Robinhood live"), snap.pnlSub);
    hard(checks, "robinhood pill is not delayed", !snap.pill.includes("delayed"), snap.pill);
  }
  const cash = cashOf(payload);
  if (cash != null) {
    hard(checks, "cash subtitle", snap.pnlSub.startsWith("Cash " + money(cash)), snap.pnlSub);
  }

  const byId = new Map(trades.map((t, i) => [tradeId(t, i), t]));
  for (const row of snap.rows) {
    const t = byId.get(row.id);
    if (!t) continue;
    const conf = str(pick(t, ["confidence", "conf"]));
    const ticker = str(pick(t, ["ticker", "symbol", "und"])).toUpperCase();
    if (row.ticker !== ticker) {
      hard(checks, "ticker " + row.id, false, row.ticker + " vs " + ticker);
      break;
    }
    if (conf && row.conf !== pillLabel(conf)) {
      hard(checks, "confidence pill " + row.id, false, row.conf + " vs " + pillLabel(conf));
      break;
    }
  }
  if (!checks.some((c) => c.name.startsWith("ticker ") || c.name.startsWith("confidence pill "))) {
    hard(checks, "row tickers and confidence pills match file", true, snap.rows.length + " rows");
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  const heroPath = join(EVIDENCE, featureId + "-hero.png");
  await page.screenshot({ path: heroPath });

  const closedRow = page.locator("#tbody-closed tr[data-id]").first();
  const closedCount = await page.locator("#tbody-closed tr[data-id]").count();
  let drawer = null;
  if (!closedCount) {
    hard(checks, "closed row to open", false, "no closed tickets in " + desk.file);
  } else {
    const closedId = await closedRow.getAttribute("data-id");
    const fileTrade = byId.get(closedId);
    await closedRow.click();
    await page.waitForFunction(() => {
      const drawerEl = document.getElementById("drawer");
      return drawerEl && drawerEl.classList.contains("on") && drawerEl.getAttribute("aria-hidden") === "false";
    });
    await sleep(250);
    drawer = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#drawer-body .cell")];
      const cell = (k) => {
        const found = cells.find((c) => c.querySelector(".k") && c.querySelector(".k").textContent === k);
        return found && found.querySelector(".v") ? found.querySelector(".v").textContent.trim() : "";
      };
      return {
        title: document.getElementById("d-title").textContent.trim(),
        pnl: cell("Paper P&L"),
      };
    });
    const expectedTicker = fileTrade ? str(pick(fileTrade, ["ticker", "symbol", "und"])).toUpperCase() : "";
    const expectedPnl = fileTrade ? money(paperPnl(fileTrade)) : "";
    hard(checks, "drawer title", drawer.title === expectedTicker, drawer.title + " vs " + expectedTicker);
    hard(checks, "drawer closed P&L matches file", drawer.pnl === expectedPnl, drawer.pnl + " vs " + expectedPnl);
    const drawerPath = join(EVIDENCE, featureId + "-drawer.png");
    await page.screenshot({ path: drawerPath });
    await page.locator("#drawer-close").click();
    await page.waitForFunction(() => document.getElementById("drawer").getAttribute("aria-hidden") === "true");
  }

  const countsConf = confidenceCounts(trades);
  const chip = ["High", "Medium", "Low"].find((k) => countsConf[k] > 0);
  if (!chip) {
    hard(checks, "confidence chip", false, "no High/Medium/Low grades in " + desk.file);
  } else {
    await page.locator('.chip[data-filter="' + chip + '"]').click();
    await page.waitForFunction((name) => {
      const on = document.querySelector(".chip.on");
      return on && on.getAttribute("data-filter") === name;
    }, chip);
    const filtered = await paperSnapshot(page);
    const okRows = filtered.rows.every((row) => {
      const t = byId.get(row.id);
      return t && str(pick(t, ["confidence", "conf"])) === chip && row.conf === pillLabel(chip);
    });
    hard(checks, "confidence filter " + chip, okRows && filtered.rows.length === countsConf[chip], filtered.rows.length + " vs " + countsConf[chip]);
    await page.locator('.chip[data-filter="all"]').click();
    await page.waitForFunction((n) => document.querySelectorAll("tr[data-id]").length === n, trades.length);
  }

  await page.locator('.sh-view[data-paper-view="summary"]').click();
  await page.waitForFunction(() => {
    const summary = document.getElementById("paper-summary");
    const book = document.getElementById("paper-book");
    const roc = document.getElementById("stat-roc");
    return summary && summary.hidden === false && book && book.hidden === true && roc && roc.textContent.trim() !== "";
  });
  hard(checks, "summary pane shows return", true);
  await page.locator('.sh-view[data-paper-view="book"]').click();
  await page.waitForFunction((n) => {
    const book = document.getElementById("paper-book");
    const summary = document.getElementById("paper-summary");
    return book && book.hidden === false && summary && summary.hidden === true && document.querySelectorAll("tr[data-id]").length === n;
  }, trades.length);
  hard(checks, "open book pane restored", true);

  return {
    checks,
    proxySettle: proxy,
    observed: {
      title: snap.title,
      deskName: snap.deskName,
      deskSub: snap.deskSub,
      pill: snap.pill,
      bookSub: snap.bookSub,
      pnl: snap.pnl,
      pnlSub: snap.pnlSub,
      closedPnl: snap.closedPnl,
      openN: snap.openN,
      invN: snap.invN,
      outN: snap.outN,
      targetK: snap.targetK,
      deployedSub: snap.deployedSub,
      footer: snap.footer,
      rowCount: snap.rows.length,
      drawer,
    },
    files: [desk.file, desk.summaryFile].filter(Boolean),
  };
}

async function driveScoreboard(page) {
  const checks = [];
  await page.locator('a.desk-tab[data-desk="scoreboard"]').click();
  await page.waitForFunction(() => {
    const host = document.getElementById("scoreboard-boards");
    const text = host ? host.textContent : "";
    return document.documentElement.classList.contains("view-scoreboard")
      && host
      && !text.includes("Loading call logs");
  }, null, { timeout: 20000 });
  const snap = await page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    const hero = document.querySelector(".hero");
    const boards = ["stocktimus", "compounder", "moonshot", "scout"].map((id) => {
      const el = document.getElementById("sb-" + id);
      return { id, present: !!el, text: el ? el.textContent : "" };
    });
    return {
      title: document.title,
      deskName: text("desk-name"),
      deskSub: text("desk-sub"),
      pill: text("source-pill"),
      tabOn: (document.querySelector(".desk-tab.on") && document.querySelector(".desk-tab.on").getAttribute("data-desk")) || "",
      view: document.documentElement.classList.contains("view-scoreboard"),
      hidden: document.getElementById("scoreboard-view").hidden,
      heroDisplay: hero ? getComputedStyle(hero).display : "",
      banner: (document.querySelector(".sb-banner") && document.querySelector(".sb-banner").textContent.trim()) || "",
      note: (document.querySelector(".sb-note") && document.querySelector(".sb-note").textContent.trim()) || "",
      rule: (document.querySelector(".sb-rule") && document.querySelector(".sb-rule").textContent.trim()) || "",
      examplePills: document.querySelectorAll(".sb-pill.ex").length,
      boards,
    };
  });
  hard(checks, "scoreboard name", snap.deskName === "Scoreboard", snap.deskName);
  hard(checks, "scoreboard subtitle", snap.deskSub === "X calls", snap.deskSub);
  hard(checks, "scoreboard title", snap.title === "Scoreboard · X calls", snap.title);
  hard(checks, "scoreboard tab", snap.tabOn === "scoreboard", snap.tabOn);
  hard(checks, "source pill x log", snap.pill === "x log", snap.pill);
  hard(checks, "view class", snap.view && snap.hidden === false);
  hard(checks, "hero hidden", snap.heroDisplay === "none", snap.heroDisplay);
  hard(checks, "banner", snap.banner === "Sample rows are example data, not scored.", snap.banner);
  hard(checks, "weekly note", snap.note.includes("Call log refreshes weekly"));
  hard(checks, "first post rule", snap.rule.includes("First post is the call") && snap.rule.includes("Provisional"));

  let exampleRows = 0;
  for (const id of ["stocktimus", "compounder", "moonshot", "scout"]) {
    const payload = readJson("scoreboard/" + id + ".json");
    const calls = payload.calls || [];
    exampleRows += calls.filter((c) => c.example === true).length;
    const board = snap.boards.find((b) => b.id === id);
    hard(checks, "board " + id, !!(board && board.present));
    if (!calls.length) {
      hard(checks, id + " empty copy", board && board.text.includes("No calls in this file."));
    } else {
      const handles = [...new Set(calls.map((c) => str(c.handle)).filter(Boolean))];
      const missing = handles.filter((h) => !(board && board.text.includes("@" + h)));
      hard(checks, id + " handles", missing.length === 0, missing.join(","));
    }
  }
  hard(checks, "example pills match files", snap.examplePills === exampleRows, snap.examplePills + " vs " + exampleRows);

  const shot = join(EVIDENCE, "scoreboard-tab.png");
  await page.screenshot({ path: shot, fullPage: true });
  return {
    checks,
    observed: {
      title: snap.title,
      deskName: snap.deskName,
      pill: snap.pill,
      banner: snap.banner,
      examplePills: snap.examplePills,
      boards: snap.boards.map((b) => b.id),
    },
    files: ["scoreboard/stocktimus.json", "scoreboard/compounder.json", "scoreboard/moonshot.json", "scoreboard/scout.json"],
  };
}

function watchProxy(page) {
  const hits = [];
  const onRequest = (req) => {
    if (req.url().includes("stock-prices-proxy")) hits.push("request");
  };
  page.on("request", onRequest);
  return hits;
}

async function waitForBook(page, line) {
  await page.waitForFunction((expected) => {
    const book = document.getElementById("stat-book-sub");
    const pill = document.getElementById("source-pill");
    const loading = [...document.querySelectorAll("tbody")].some((tb) => (tb.textContent || "").includes("Loading book"));
    return book && book.textContent.trim() === expected && pill && pill.textContent.trim() !== "loading" && !loading;
  }, line, { timeout: 20000 });
}

async function fulfillJson(route, body) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function driveDelayed(page) {
  const checks = [];
  const hits = watchProxy(page);
  const desk = PAPER_DESKS["stocktimus-paper-book"];
  const payload = readJson(desk.file);
  const trades = asList(payload);
  const summary = readJson(desk.summaryFile);
  const summaryObj = mergedSummary(payload, summary);
  const expectedTotal = fileTotalText(trades, summaryObj, false);
  const line = ticketLine(trades.length);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForBook(page, line);
  await sleep(1500);
  const published = await paperSnapshot(page);
  const publishedKind = publishedMarkKind(payload);
  hard(checks, "book loaded", published.bookSub === line, published.bookSub);
  if (publishedKind === "robinhood") {
    hard(checks, "published pill says Robinhood live", published.pill.includes("Robinhood live") && !published.pill.includes("delayed"), published.pill);
  } else if (publishedKind === "delayed") {
    hard(checks, "published pill says delayed", published.pill.includes("delayed") && !published.pill.includes("Robinhood"), published.pill);
  } else {
    hard(checks, "published pill has no delayed suffix", !published.pill.includes("delayed"), published.pill);
    hard(checks, "published pill has no Robinhood suffix", !published.pill.includes("Robinhood"), published.pill);
  }
  hard(checks, "published book does not call Massive", hits.length === 0, String(hits.length));
  hard(checks, "published total matches file", published.pnl === expectedTotal, published.pnl + " vs " + expectedTotal);

  await page.route("**/data.json*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.marks_source = "robinhood";
    body.quote_quality = "robinhood_live";
    await fulfillJson(route, body);
  });
  const hitsBeforeRh = hits.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const pill = document.getElementById("source-pill");
    return pill && pill.textContent.includes("Robinhood");
  }, null, { timeout: 20000 });
  await sleep(1500);
  const rh = await paperSnapshot(page);
  hard(checks, "robinhood pill", rh.pill.includes("Robinhood live"), rh.pill);
  hard(checks, "robinhood pill is not delayed", !rh.pill.includes("delayed"), rh.pill);
  hard(checks, "robinhood subtitle", rh.pnlSub.includes("Robinhood live"), rh.pnlSub);
  hard(checks, "robinhood pill does not say real-time", !/real-?time/i.test(rh.pill), rh.pill);
  hard(checks, "robinhood book does not call Massive", hits.length === hitsBeforeRh, String(hits.length - hitsBeforeRh));
  hard(checks, "robinhood total stays on file marks", rh.pnl === expectedTotal, rh.pnl + " vs " + expectedTotal);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "robinhood-mark-label.png") });

  await page.unroute("**/data.json*");
  await page.route("**/data.json*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    delete body.marks_source;
    delete body.quote_quality;
    for (const t of asList(body)) {
      const status = tradeStatus(t).toLowerCase();
      if (!OPEN.has(status)) continue;
      t.paper_pnl = null;
      t.live_stock = null;
      t.live_option_mid = null;
      t.live_option_last = null;
    }
    await fulfillJson(route, body);
  });
  const hitsBeforeFallback = hits.length;
  const proxyWait = settleProxy(page, 8000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForBook(page, line);
  const proxy = await proxyWait;
  const fb = await paperSnapshot(page);
  const requested = hits.length > hitsBeforeFallback || proxy === "ok";
  hard(checks, "fallback requests Massive", requested, proxy);
  hard(checks, "fallback pill does not say real-time", !/real-?time/i.test(fb.pill), fb.pill);
  let outcome = "fallback-no-quote";
  if (proxy === "ok") {
    outcome = "fallback-delayed";
    hard(checks, "fallback pill says delayed", fb.pill.includes("delayed"), fb.pill);
    hard(checks, "fallback subtitle says delayed MTM", fb.pnlSub.includes("delayed MTM"), fb.pnlSub);
    hard(checks, "fallback pill is not Robinhood", !fb.pill.includes("Robinhood"), fb.pill);
  } else {
    hard(checks, "no delayed label without a quote", !fb.pill.includes("delayed"), fb.pill);
    hard(checks, "no Robinhood label on unmarked fallback", !fb.pill.includes("Robinhood"), fb.pill);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "delayed-mark-label.png") });
  return {
    checks,
    outcome,
    proxySettle: proxy,
    observed: {
      publishedPill: published.pill,
      publishedPnl: published.pnl,
      robinhoodPill: rh.pill,
      robinhoodPnlSub: rh.pnlSub,
      robinhoodPnl: rh.pnl,
      fallbackPill: fb.pill,
      fallbackPnlSub: fb.pnlSub,
    },
    files: ["data.json"],
  };
}

function ymdKey(v) {
  if (v == null || v === "") return null;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function addUtcDays(key, n) {
  const m = ymdKey(key);
  if (!m) return null;
  const [y, mo, d] = m.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function ymdInPT(iso) {
  if (!iso) return null;
  const bare = ymdKey(iso);
  if (bare && String(iso).trim() === bare) return bare;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return bare;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function jesseCoveredCost(p) {
  const sh = num(p.shares);
  const basis = num(p.cost_basis);
  const occ = num(p.open_cc_shares);
  if (sh == null || basis == null) return null;
  if (!(sh > 0)) return 0;
  return basis * Math.min(Math.max(occ || 0, 0), sh) / sh;
}

function jesseBook(data) {
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const tradeRows = Array.isArray(data.trades) ? data.trades : [];
  const weekRows = (Array.isArray(data.weeks) ? data.weeks : [])
    .filter((w) => ymdKey(w.week_ending))
    .slice()
    .sort((a, b) => ymdKey(a.week_ending).localeCompare(ymdKey(b.week_ending)));
  const fridays = weekRows.map((w) => ymdKey(w.week_ending));
  const asof = ymdInPT(data.as_of);
  let selected = fridays.length ? fridays[fridays.length - 1] : null;
  if (asof && fridays.length) {
    const containing = fridays.find((friday) => {
      const start = addUtcDays(friday, -6);
      return start && asof >= start && asof <= friday;
    });
    if (containing) selected = containing;
    else {
      const past = fridays.filter((friday) => friday <= asof);
      if (past.length) selected = past[past.length - 1];
      else selected = fridays[0];
    }
  }
  const program = positions.reduce((s, p) => s + (num(p.program_capital) || 0), 0);
  let covered = 0;
  let uncovered = 0;
  let coveredAny = false;
  for (const p of positions) {
    const cost = jesseCoveredCost(p);
    const programCap = num(p.program_capital);
    if (cost == null || programCap == null) continue;
    covered += cost;
    uncovered += Math.max(0, programCap - cost);
    coveredAny = true;
  }
  const openPrem = tradeRows.reduce((s, t) => {
    if (str(t.income_type) !== "Covered_Call" || str(t.called_away) !== "Open") return s;
    const v = num(t["premium_(net)"]);
    return v == null ? s : s + v;
  }, 0);
  const toDate = weekRows.reduce((s, w) => s + (num(w.total_week_pnl) || 0), 0);
  return {
    positions,
    tradeRows,
    weekRows,
    fridays,
    selected,
    program: positions.length ? program : null,
    covered: coveredAny ? covered : null,
    uncovered: coveredAny ? uncovered : null,
    openPrem: tradeRows.some((t) => str(t.income_type) === "Covered_Call" && str(t.called_away) === "Open") ? openPrem : null,
    toDate: weekRows.length ? toDate : null,
  };
}

function jesseWeekReturnVsCapital(w) {
  if (!w) return null;
  const vs = num(w.week_return_pct_vs_capital);
  return vs != null ? vs : num(w.week_return_pct);
}

function jesseWeekReturnVsProgram(w) {
  if (!w) return null;
  return num(w.week_return_pct_vs_program);
}

function jesseWeek(data, friday) {
  const week = (data.weeks || []).find((w) => ymdKey(w.week_ending) === friday) || null;
  const allocs = (data.allocations || [])
    .filter((a) => ymdKey(a.week_ending) === friday)
    .map((a) => str(a.trade_id))
    .sort();
  const start = addUtcDays(friday, -6);
  const sells = (data.trades || [])
    .filter((t) => {
      if (str(t.income_type) !== "Covered_Call") return false;
      const sold = ymdKey(t.cc_sell_date);
      return sold && start && sold >= start && sold <= friday;
    })
    .slice()
    .sort((a, b) => {
      const d = String(a.cc_sell_date || "").localeCompare(String(b.cc_sell_date || ""));
      if (d) return d;
      return String(a.trade_id || "").localeCompare(String(b.trade_id || ""));
    })
    .map((t) => str(t.trade_id));
  return { week, allocs, sells, start };
}

async function driveJesse(page) {
  const checks = [];
  const data = readJson("jesse/cc-tracker.json");
  const book = jesseBook(data);
  const title = str(data.title) || "Covered Call Income";
  await page.locator('a.desk-tab[data-desk="jesse"]').click();
  await page.waitForFunction(() => {
    const pill = document.getElementById("source-pill");
    const root = document.getElementById("jesse-root");
    const text = root ? root.textContent : "";
    return document.documentElement.classList.contains("view-jesse")
      && pill && pill.textContent.trim() === "cc tracker"
      && root && !text.includes("Loading covered-call");
  }, null, { timeout: 20000 });

  const snap = await page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    const hero = document.querySelector(".hero");
    const week = document.getElementById("js-week");
    const closed = document.getElementById("js-closed");
    const asof = document.getElementById("asof");
    return {
      title: document.title,
      deskName: text("desk-name"),
      deskSub: text("desk-sub"),
      pill: text("source-pill"),
      asof: asof ? asof.textContent.trim() : "",
      asofDate: asof ? asof.getAttribute("datetime") || "" : "",
      tabOn: (document.querySelector(".desk-tab.on") && document.querySelector(".desk-tab.on").getAttribute("data-desk")) || "",
      view: document.documentElement.classList.contains("view-jesse"),
      hidden: document.getElementById("jesse-view").hidden,
      heroDisplay: hero ? getComputedStyle(hero).display : "",
      hash: location.hash,
      program: text("js-program"),
      rocCovered: text("js-roc-covered"),
      rocProgram: text("js-roc-program"),
      rocCoveredLabel: (document.querySelector("#js-roc-covered") && document.querySelector("#js-roc-covered").parentElement
        ? document.querySelector("#js-roc-covered").parentElement.querySelector(".js-k").textContent.trim()
        : ""),
      rocProgramLabel: (document.querySelector("#js-roc-program") && document.querySelector("#js-roc-program").parentElement
        ? document.querySelector("#js-roc-program").parentElement.querySelector(".js-k").textContent.trim()
        : ""),
      rocCoveredSub: (document.querySelector("#js-roc-covered") && document.querySelector("#js-roc-covered").parentElement
        ? document.querySelector("#js-roc-covered").parentElement.querySelector(".js-s").textContent.trim()
        : ""),
      rocProgramSub: (document.querySelector("#js-roc-program") && document.querySelector("#js-roc-program").parentElement
        ? document.querySelector("#js-roc-program").parentElement.querySelector(".js-s").textContent.trim()
        : ""),
      covered: text("js-covered"),
      uncovered: text("js-uncovered"),
      openPrem: text("js-open-prem"),
      toDate: text("js-todate"),
      toDateSub: (document.querySelector("#js-todate") && document.querySelector("#js-todate").parentElement
        ? document.querySelector("#js-todate").parentElement.querySelector(".js-s").textContent.trim()
        : ""),
      weeks: [...document.querySelectorAll(".js-week")].map((b) => b.getAttribute("data-week")),
      weekOn: week ? week.getAttribute("data-week") : "",
      weekStart: week ? week.getAttribute("data-start") : "",
      weekEnd: week ? week.getAttribute("data-end") : "",
      kpiNet: text("js-kpi-net"),
      kpiRetCap: text("js-kpi-ret-capital"),
      kpiRetProg: text("js-kpi-ret-program"),
      allocs: [...document.querySelectorAll("#js-alloc tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      sells: [...document.querySelectorAll("#js-sells tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      openCcs: [...document.querySelectorAll("#js-open-ccs tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      closedIds: [...document.querySelectorAll("#js-closed-body tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      closedOpen: closed ? closed.open : null,
      tickers: [...document.querySelectorAll("#js-positions tr[data-ticker]")].map((tr) => tr.getAttribute("data-ticker")),
      bodyText: document.body.innerText,
    };
  });

  const expectWeek = jesseWeek(data, book.selected);
  const openIds = book.tradeRows.filter((t) => str(t.income_type) === "Covered_Call" && str(t.called_away) === "Open").map((t) => str(t.trade_id));
  const closedIds = book.tradeRows.filter((t) => str(t.called_away) === "Yes" || str(t.called_away) === "Expired").map((t) => str(t.trade_id));
  hard(checks, "jesse name", snap.deskName === title, snap.deskName);
  hard(checks, "jesse subtitle", snap.deskSub === "Jesse", snap.deskSub);
  hard(checks, "jesse title", snap.title === title + " · Jesse", snap.title);
  hard(checks, "jesse tab", snap.tabOn === "jesse", snap.tabOn);
  hard(checks, "source pill cc tracker", snap.pill === "cc tracker", snap.pill);
  hard(checks, "as_of datetime", snap.asofDate === String(data.as_of), snap.asofDate);
  hard(checks, "as_of visible", snap.asof !== "—" && snap.asof.includes("PT") && snap.asof.includes(String(ymdInPT(data.as_of)).slice(0, 4)), snap.asof);
  hard(checks, "view class", snap.view && snap.hidden === false);
  hard(checks, "hero hidden", snap.heroDisplay === "none", snap.heroDisplay);
  hard(checks, "hash jesse", snap.hash === "#jesse", snap.hash);
  const board = data.dashboard || {};
  hard(checks, "return on capital label", snap.rocCoveredLabel === "Return on capital", snap.rocCoveredLabel);
  hard(checks, "return on program label", snap.rocProgramLabel === "Return on program", snap.rocProgramLabel);
  hard(checks, "roc vs covered subtitle", snap.rocCoveredSub === "ROC vs Covered", snap.rocCoveredSub);
  hard(checks, "roc vs program subtitle", snap.rocProgramSub === "ROC vs Program", snap.rocProgramSub);
  hard(checks, "roc vs covered", snap.rocCovered === pct(num(board.roc_vs_covered)), snap.rocCovered + " vs " + pct(num(board.roc_vs_covered)));
  hard(checks, "roc vs program", snap.rocProgram === pct(num(board.roc_vs_program)), snap.rocProgram + " vs " + pct(num(board.roc_vs_program)));
  hard(checks, "program capital", snap.program === money(book.program), snap.program + " vs " + money(book.program));
  hard(checks, "covered cost", snap.covered === money(book.covered), snap.covered + " vs " + money(book.covered));
  hard(checks, "uncovered program", snap.uncovered === money(book.uncovered), snap.uncovered + " vs " + money(book.uncovered));
  hard(checks, "open premium net", snap.openPrem === money(book.openPrem), snap.openPrem + " vs " + money(book.openPrem));
  hard(checks, "to date week pnl", snap.toDate === money(book.toDate), snap.toDate + " vs " + money(book.toDate));
  hard(checks, "to date week count", snap.toDateSub.includes(book.weekRows.length + " weeks in file"), snap.toDateSub);
  hard(checks, "week buttons", snap.weeks.join(",") === book.fridays.join(","), snap.weeks.join(","));
  hard(checks, "default week", snap.weekOn === book.selected, snap.weekOn + " vs " + book.selected);
  hard(checks, "week window", snap.weekStart === expectWeek.start && snap.weekEnd === book.selected, snap.weekStart + "…" + snap.weekEnd);
  hard(checks, "week net income", snap.kpiNet === money(num(expectWeek.week && expectWeek.week.net_income)), snap.kpiNet);
  hard(checks, "week return vs capital", snap.kpiRetCap === pct(jesseWeekReturnVsCapital(expectWeek.week)), snap.kpiRetCap);
  hard(checks, "week return vs program", snap.kpiRetProg === pct(jesseWeekReturnVsProgram(expectWeek.week)), snap.kpiRetProg);
  hard(checks, "week allocations", snap.allocs.slice().sort().join(",") === expectWeek.allocs.join(","), snap.allocs.join(","));
  hard(checks, "week sells", snap.sells.join(",") === expectWeek.sells.join(","), snap.sells.join(","));
  hard(checks, "open covered calls", snap.openCcs.join(",") === openIds.join(","), snap.openCcs.join(","));
  hard(checks, "closed trades", snap.closedIds.join(",") === closedIds.join(","), snap.closedIds.join(","));
  hard(checks, "closed section collapsed", snap.closedOpen === false, String(snap.closedOpen));
  hard(checks, "position tickers", snap.tickers.join(",") === book.positions.map((p) => str(p.ticker)).join(","), snap.tickers.join(","));
  const account = data.rules && data.rules.account ? String(data.rules.account) : "";
  hard(checks, "account number not rendered", !account || !snap.bodyText.includes(account), account ? "hidden" : "no account field");

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "jesse-tab.png"), fullPage: true });

  const other = book.fridays.find((friday) => friday !== book.selected) || book.selected;
  const urlBefore = page.url();
  await page.locator('.js-week[data-week="' + other + '"]').click();
  await page.waitForFunction((week) => {
    const panel = document.getElementById("js-week");
    return panel && panel.getAttribute("data-week") === week;
  }, other);
  const switched = await page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    const week = document.getElementById("js-week");
    return {
      hash: location.hash,
      weekOn: week ? week.getAttribute("data-week") : "",
      weekStart: week ? week.getAttribute("data-start") : "",
      kpiNet: text("js-kpi-net"),
      kpiRetCap: text("js-kpi-ret-capital"),
      kpiRetProg: text("js-kpi-ret-program"),
      allocs: [...document.querySelectorAll("#js-alloc tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      sells: [...document.querySelectorAll("#js-sells tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
      openCcs: [...document.querySelectorAll("#js-open-ccs tr[data-trade]")].map((tr) => tr.getAttribute("data-trade")),
    };
  });
  const otherWeek = jesseWeek(data, other);
  hard(checks, "week click does not navigate", page.url() === urlBefore && switched.hash === "#jesse", page.url());
  hard(checks, "selected week", switched.weekOn === other, switched.weekOn);
  hard(checks, "switched window", switched.weekStart === otherWeek.start, switched.weekStart);
  hard(checks, "switched net income", switched.kpiNet === money(num(otherWeek.week && otherWeek.week.net_income)), switched.kpiNet);
  hard(checks, "switched return vs capital", switched.kpiRetCap === pct(jesseWeekReturnVsCapital(otherWeek.week)), switched.kpiRetCap);
  hard(checks, "switched return vs program", switched.kpiRetProg === pct(jesseWeekReturnVsProgram(otherWeek.week)), switched.kpiRetProg);
  hard(checks, "switched allocations", switched.allocs.slice().sort().join(",") === otherWeek.allocs.join(","), switched.allocs.join(","));
  hard(checks, "switched sells", switched.sells.join(",") === otherWeek.sells.join(","), switched.sells.join(","));
  hard(checks, "open book stays put", switched.openCcs.join(",") === openIds.join(","), switched.openCcs.join(","));
  await page.screenshot({ path: join(EVIDENCE, "jesse-tab-week.png"), fullPage: true });

  await page.locator('.js-view[data-view="summary"]').click();
  await page.waitForFunction(() => {
    const body = document.getElementById("js-weekly");
    return body && document.querySelector('.js-view[data-view="summary"].on') && location.hash === "#jesse";
  }, null, { timeout: 20000 });
  const summary = await page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    return {
      hash: location.hash,
      rocCovered: text("js-roc-covered"),
      rocProgram: text("js-roc-program"),
      weekPicker: !!document.getElementById("js-week"),
      note: (document.querySelector("#js-weekly-panel .js-note") && document.querySelector("#js-weekly-panel .js-note").textContent.trim()) || "",
      headers: [...document.querySelectorAll("#js-weekly-panel thead th")].map((th) => th.textContent.trim()),
      rows: [...document.querySelectorAll("#js-weekly tr[data-week]")].map((tr) => ({
        week: tr.getAttribute("data-week"),
        cells: [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
      })),
    };
  });
  const summaryRows = (Array.isArray(data.weekly_summary) ? data.weekly_summary : data.weeks || [])
    .filter((w) => ymdKey(w.week_ending))
    .slice()
    .sort((a, b) => ymdKey(a.week_ending).localeCompare(ymdKey(b.week_ending)));
  hard(checks, "weekly summary stays on jesse", summary.hash === "#jesse" && page.url() === urlBefore, summary.hash);
  hard(checks, "weekly summary hides week picker", summary.weekPicker === false);
  hard(checks, "roc stays on weekly summary", summary.rocCovered === pct(num(board.roc_vs_covered)) && summary.rocProgram === pct(num(board.roc_vs_program)), summary.rocCovered + " / " + summary.rocProgram);
  hard(checks, "weekly summary rows", summary.rows.map((row) => row.week).join(",") === summaryRows.map((w) => ymdKey(w.week_ending)).join(","), summary.rows.map((row) => row.week).join(","));
  hard(checks, "weekly summary return headers", summary.headers[7] === "Week return % (vs capital)" && summary.headers[8] === "Week return % (vs program)", (summary.headers[7] || "") + " | " + (summary.headers[8] || ""));
  hard(checks, "weekly summary denominators", summary.note.includes("combined ÷ capital deployed") && summary.note.includes("combined ÷ Dashboard program capital"), summary.note);
  summaryRows.forEach((w, i) => {
    const cells = summary.rows[i] ? summary.rows[i].cells : [];
    const friday = ymdKey(w.week_ending);
    hard(checks, "week " + friday + " premium", cells[1] === money(num(w.premium_allocated)), cells[1]);
    hard(checks, "week " + friday + " fees", cells[2] === money(num(w.fees_allocated)), cells[2]);
    hard(checks, "week " + friday + " net", cells[3] === money(num(w.net_income)), cells[3]);
    hard(checks, "week " + friday + " capital", cells[4] === money(num(w.capital_deployed)), cells[4]);
    hard(checks, "week " + friday + " assignment", cells[5] === money(num(w.assignment_pnl)), cells[5]);
    hard(checks, "week " + friday + " total", cells[6] === money(num(w.total_week_pnl)), cells[6]);
    hard(checks, "week " + friday + " return vs capital", cells[7] === pct(jesseWeekReturnVsCapital(w)), cells[7]);
    hard(checks, "week " + friday + " return vs program", cells[8] === pct(jesseWeekReturnVsProgram(w)), cells[8]);
    hard(checks, "week " + friday + " trades", cells[9] === String(w.trade_count), cells[9]);
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "jesse-tab-summary.png"), fullPage: true });

  const stock = readJson("data.json");
  const line = ticketLine(asList(stock).length);
  await page.locator('a.desk-tab[data-desk="stocktimus"]').click();
  await page.waitForFunction(() => {
    const name = document.getElementById("desk-name");
    return name
      && name.textContent.trim() === "Stocktimus"
      && !document.documentElement.classList.contains("view-jesse")
      && location.hash === "#stocktimus";
  }, null, { timeout: 20000 });
  await waitForBook(page, line);
  const back = await page.evaluate(() => {
    const hero = document.querySelector(".hero");
    return {
      name: (document.getElementById("desk-name") && document.getElementById("desk-name").textContent.trim()) || "",
      view: document.documentElement.classList.contains("view-jesse"),
      heroDisplay: hero ? getComputedStyle(hero).display : "",
      book: (document.getElementById("stat-book-sub") && document.getElementById("stat-book-sub").textContent.trim()) || "",
    };
  });
  hard(checks, "back to stocktimus", back.name === "Stocktimus" && back.view === false && back.heroDisplay !== "none", back.name + " hero=" + back.heroDisplay);
  hard(checks, "stocktimus book restored", back.book === line, back.book);

  return {
    checks,
    observed: {
      title: snap.title,
      deskName: snap.deskName,
      pill: snap.pill,
      asof: snap.asof,
      program: snap.program,
      rocCovered: snap.rocCovered,
      rocProgram: snap.rocProgram,
      summaryWeeks: summary.rows.map((row) => row.week),
      covered: snap.covered,
      uncovered: snap.uncovered,
      openPrem: snap.openPrem,
      toDate: snap.toDate,
      defaultWeek: snap.weekOn,
      switchedWeek: switched.weekOn,
      sells: snap.sells,
      switchedSells: switched.sells,
    },
    files: ["jesse/cc-tracker.json"],
  };
}

function sleeveEquity(data) {
  const book = data.open_positions || {};
  return Array.isArray(book.equity) ? book.equity : [];
}

function sleeveSum(rows, pick) {
  let total = 0;
  let any = false;
  for (const row of rows) {
    const v = num(pick(row));
    if (v == null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

function sleeveDeployed(data) {
  return sleeveSum(sleeveEquity(data), (row) => row.deployed_usd);
}

function sleeveUnrealized(data) {
  return sleeveSum(sleeveEquity(data), (row) => row.unrealized_pnl);
}

function sleeveOptionRank(row) {
  const side = str(row && row.side).toLowerCase();
  const status = str((row && row.status) || "open").toLowerCase();
  const active = status === "open" || status === "active" || status === "";
  const short = side === "short" || side === "sell" || side === "sto";
  if (active && short) return 0;
  if (short) return 1;
  if (active) return 2;
  return 3;
}

function sleeveShortCallCue(row, spot) {
  const side = str(row && row.side).toLowerCase();
  const type = str(row && row.option_type).toLowerCase();
  const strike = num(row && row.strike);
  const isShort = side === "short" || side === "sell" || side === "sto";
  if (!isShort || type !== "call" || spot == null || strike == null) return "";
  return spot >= strike ? "itm" : "otm";
}

function sleeveWeekRows(data) {
  const rows = Array.isArray(data.weekly_summary) ? data.weekly_summary : (Array.isArray(data.weeks) ? data.weeks : []);
  return rows.filter((row) => row && row.week_ending);
}

async function driveSleeve(page) {
  const checks = [];
  const data = readJson("sleeve/trades.json");
  const fills = Array.isArray(data.fills) ? data.fills : [];
  const equity = (data.open_positions && data.open_positions.equity) || [];
  const options = (data.open_positions && data.open_positions.options) || [];
  const orders = Array.isArray(data.orders_open) ? data.orders_open : [];
  const realized = Array.isArray(data.realized_trades) ? data.realized_trades : [];
  const weeks = Array.isArray(data.weekly_summary) ? data.weekly_summary : (Array.isArray(data.weeks) ? data.weeks : []);
  await page.locator('a.desk-tab[data-desk="sleeve"]').click();
  await page.waitForFunction(() => {
    const pill = document.getElementById("source-pill");
    const root = document.getElementById("sleeve-root");
    const text = root ? root.textContent : "";
    return document.documentElement.classList.contains("view-sleeve")
      && pill && pill.textContent.trim() === "sleeve ledger"
      && root && !text.includes("Loading sleeve");
  }, null, { timeout: 20000 });

  const snap = await page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : "";
    };
    const hero = document.querySelector(".hero");
    const tab = document.querySelector(".desk-tab.on");
    const value = document.querySelector("#sleeve-root .js-v");
    const realizedEl = document.getElementById("sl-realized");
    return {
      title: document.title,
      deskName: text("desk-name"),
      deskSub: text("desk-sub"),
      pill: text("source-pill"),
      asofDate: (document.getElementById("asof") && document.getElementById("asof").getAttribute("datetime")) || "",
      tabOn: tab ? tab.getAttribute("data-desk") : "",
      view: document.documentElement.classList.contains("view-sleeve"),
      hidden: document.getElementById("sleeve-view").hidden,
      heroDisplay: hero ? getComputedStyle(hero).display : "",
      hash: location.hash,
      pending: document.getElementById("sl-pending"),
      deployed: text("sl-deployed"),
      budget: text("sl-budget"),
      account: text("sl-account"),
      cash: text("sl-cash"),
      unreal: text("sl-unreal"),
      realized: text("sl-real"),
      roc: text("sl-roc"),
      rocBudget: text("sl-roc-budget"),
      weekCc: text("sl-week-cc"),
      weekDiv: text("sl-week-div"),
      weekScalps: text("sl-week-scalps"),
      weekAssign: text("sl-week-assign"),
      weekCombined: text("sl-week-combined"),
      weekRet: text("sl-week-ret"),
      weekRetBudget: text("sl-week-ret-budget"),
      weekOn: (document.querySelector("#sl-income .js-week.on") && document.querySelector("#sl-income .js-week.on").getAttribute("data-week")) || "",
      allCc: text("sl-all-cc"),
      allDiv: text("sl-all-div"),
      allScalps: text("sl-all-scalps"),
      allAssign: text("sl-all-assign"),
      allCombined: text("sl-all-combined"),
      openN: text("sl-open-n"),
      fillsN: text("sl-fills"),
      notes: text("sl-notes"),
      symbols: [...document.querySelectorAll("#sl-equity tr[data-symbol]")].map((tr) => tr.getAttribute("data-symbol")),
      buckets: [...document.querySelectorAll("#sl-equity tr[data-bucket]")].map((tr) => tr.getAttribute("data-bucket")),
      fillIds: [...document.querySelectorAll("#sl-fills tr[data-fill]")].map((tr) => tr.getAttribute("data-fill")),
      optionText: (document.getElementById("sl-options") && document.getElementById("sl-options").textContent.trim()) || "",
      optionsBeforeEquity: (() => {
        const opt = document.getElementById("sl-options");
        const eq = document.getElementById("sl-equity");
        return !!(opt && eq && (opt.compareDocumentPosition(eq) & Node.DOCUMENT_POSITION_FOLLOWING));
      })(),
      bookHeads: [...document.querySelectorAll("#sl-open-book h3")].map((h) => h.textContent.trim()),
      optionRows: [...document.querySelectorAll("#sl-options tr[data-symbol]")].map((tr) => ({
        symbol: tr.getAttribute("data-symbol"),
        side: tr.getAttribute("data-side"),
        spot: (tr.querySelector("[data-spot]") && tr.querySelector("[data-spot]").getAttribute("data-spot")) || "",
        source: (tr.querySelector("[data-spot]") && tr.querySelector("[data-spot]").getAttribute("data-price-source")) || "",
        cue: tr.getAttribute("data-cue") || "",
      })),
      refreshLabel: (document.getElementById("sl-price-refresh") && document.getElementById("sl-price-refresh").textContent.trim()) || "",
      quoteSrc: (document.getElementById("sl-quote-src") && document.getElementById("sl-quote-src").textContent.trim()) || "",
      openCc: [...document.querySelectorAll("#sl-open-ccs tr[data-symbol]")].map((tr) => tr.getAttribute("data-symbol")),
      orderText: (document.getElementById("sl-orders") && document.getElementById("sl-orders").textContent.trim()) || "",
      dividendCount: (document.querySelector("#sl-dividends .js-count") && document.querySelector("#sl-dividends .js-count").textContent.trim()) || "",
      scalpCount: (document.querySelector("#sl-scalps .js-count") && document.querySelector("#sl-scalps .js-count").textContent.trim()) || "",
      assignCount: (document.querySelector("#sl-assignments .js-count") && document.querySelector("#sl-assignments .js-count").textContent.trim()) || "",
      realizedOpen: realizedEl ? realizedEl.open : null,
      summaryBtn: !!document.querySelector('.js-view[data-view="summary"]'),
      tabBg: tab ? getComputedStyle(tab).backgroundColor : "",
      valueColor: value ? getComputedStyle(value).color : "",
      bodyText: document.body.innerText,
    };
  });

  const deployed = sleeveDeployed(data);
  const unreal = sleeveUnrealized(data);
  const port = data.portfolio || {};
  const income = data.income && typeof data.income === "object" ? data.income : {};
  const week = sleeveWeekRows(data).find((row) => String(row.week_ending) === snap.weekOn) || null;
  const weekNet = week ? num(week.net_income) : null;
  const weekRet = week ? (num(week.week_return_pct_vs_capital) != null ? num(week.week_return_pct_vs_capital) : num(week.week_return_pct)) : null;
  hard(checks, "sleeve name", snap.deskName === "Sleeve", snap.deskName);
  hard(checks, "sleeve subtitle", snap.deskSub === "Agentic", snap.deskSub);
  hard(checks, "sleeve title", snap.title === "Sleeve · Agentic", snap.title);
  hard(checks, "sleeve tab", snap.tabOn === "sleeve", snap.tabOn);
  hard(checks, "source pill sleeve ledger", snap.pill === "sleeve ledger", snap.pill);
  hard(checks, "as_of datetime", snap.asofDate === String(data.as_of), snap.asofDate);
  hard(checks, "view class", snap.view && snap.hidden === false);
  hard(checks, "hero hidden", snap.heroDisplay === "none", snap.heroDisplay);
  hard(checks, "hash sleeve", snap.hash === "#sleeve", snap.hash);
  hard(checks, "no pending tile", snap.pending == null, String(snap.pending));
  hard(checks, "no pending copy", !/pending deposit/i.test(snap.bodyText), "body");
  hard(checks, "account value", snap.account === money(num(port.total_value)), snap.account + " vs " + money(num(port.total_value)));
  hard(checks, "cash", snap.cash === money(num(port.cash)), snap.cash + " vs " + money(num(port.cash)));
  hard(checks, "deployed", snap.deployed === money(deployed), snap.deployed + " vs " + money(deployed));
  hard(checks, "sleeve budget", snap.budget === money(num(data.sleeve_budget_usd)), snap.budget);
  hard(checks, "unrealized from equity", snap.unreal === money(unreal), snap.unreal + " vs " + money(unreal));
  hard(checks, "return vs deployed", snap.roc === pct(num(income.roc_vs_deployed)), snap.roc);
  hard(checks, "return vs budget", snap.rocBudget === pct(num(income.roc_vs_budget)), snap.rocBudget);
  hard(checks, "week selected", !!week, snap.weekOn);
  hard(checks, "week cc premium net", snap.weekCc === money(weekNet), snap.weekCc);
  hard(checks, "week dividends", snap.weekDiv === money(week ? num(week.dividends) : null), snap.weekDiv);
  hard(checks, "week scalps", snap.weekScalps === money(week ? (num(week.scalps_daytrades_pnl) != null ? num(week.scalps_daytrades_pnl) : num(week.daytrade_pnl)) : null), snap.weekScalps);
  hard(checks, "week assignment", snap.weekAssign === money(week ? num(week.assignment_pnl) : null), snap.weekAssign);
  hard(checks, "week combined", snap.weekCombined === money(week ? num(week.total_week_pnl) : null), snap.weekCombined);
  hard(checks, "week return vs deployed", snap.weekRet === pct(weekRet), snap.weekRet);
  hard(checks, "week return vs budget", snap.weekRetBudget === pct(week ? num(week.week_return_pct_vs_program) : null), snap.weekRetBudget);
  hard(checks, "all-time cc premium net", snap.allCc === money(num(income.cc_premium_net)), snap.allCc);
  hard(checks, "all-time dividends", snap.allDiv === money(num(income.dividends)), snap.allDiv);
  hard(checks, "all-time scalps", snap.allScalps === money(num(income.scalps_daytrades_net)), snap.allScalps);
  hard(checks, "all-time assignment", snap.allAssign === money(num(income.assignment_pnl)), snap.allAssign);
  hard(checks, "all-time combined", snap.allCombined === money(num(income.combined_income)), snap.allCombined);
  const realizedTotal = realized.reduce((sum, row) => {
    const v = num(row.realized_pnl_usd != null ? row.realized_pnl_usd : row.realized_pnl);
    return v == null ? sum : sum + v;
  }, 0);
  hard(checks, "realized from ledger", snap.realized === money(realized.length ? realizedTotal : 0), snap.realized);
  hard(checks, "open positions", snap.openN === String(equity.length + options.length), snap.openN);
  hard(checks, "filled orders", snap.fillsN === String(fills.filter((f) => !f.status || str(f.status) === "filled").length), snap.fillsN);
  hard(checks, "notes rendered", snap.notes === (Array.isArray(data.notes) ? data.notes.join(" ") : String(data.notes || "")), snap.notes.slice(0, 80));
  hard(checks, "equity symbols", snap.symbols.join(",") === equity.map((p) => str(p.symbol)).join(","), snap.symbols.join(","));
  hard(checks, "equity buckets", snap.buckets.join(",") === equity.map((p) => str(p.desk_bucket)).join(","), snap.buckets.join(","));
  hard(checks, "options empty copy", options.length === 0 ? snap.optionText.includes("No open option positions") : snap.optionText.length > 0, snap.optionText);
  hard(checks, "options above equity", options.length === 0 || snap.optionsBeforeEquity, String(snap.optionsBeforeEquity));
  hard(checks, "options heading first", options.length === 0 || (snap.bookHeads[0] === "Options" && snap.bookHeads[1] === "Equity"), (snap.bookHeads || []).slice(0, 2).join(","));
  const lastBySymbol = {};
  equity.forEach((row) => { lastBySymbol[str(row.symbol).toUpperCase()] = num(row.last); });
  const expectedOptions = options
    .map((row, index) => ({ row, index, rank: sleeveOptionRank(row) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.row);
  const expectedOptionSymbols = expectedOptions.map((row) => str(row.symbol)).join(",");
  hard(checks, "active shorts first", (snap.optionRows || []).map((row) => row.symbol).join(",") === expectedOptionSymbols, (snap.optionRows || []).map((row) => row.symbol).join(","));
  expectedOptions.forEach((row) => {
    const seen = (snap.optionRows || []).find((item) => item.symbol === str(row.symbol) && item.side === str(row.side));
    const spot = lastBySymbol[str(row.symbol).toUpperCase()];
    const cue = sleeveShortCallCue(row, spot);
    const spotOk = seen && (spot == null ? seen.spot === "" : Math.abs(Number(seen.spot) - spot) < 1e-6);
    hard(checks, "spot " + str(row.symbol), !!spotOk && seen.source === "ledger" && seen.cue === cue, seen ? seen.spot + " " + seen.cue : "missing");
  });
  hard(checks, "price refresh button", snap.refreshLabel === "Price refresh", snap.refreshLabel);
  hard(checks, "ledger spot label", snap.quoteSrc === "ledger marks · equity last", snap.quoteSrc);
  const openCcSymbols = (Array.isArray(data.cc_trades) ? data.cc_trades : [])
    .filter((row) => {
      const flag = str(row.called_away || "Open");
      return flag === "Open" || flag === "open";
    })
    .map((row) => str(row.symbol || row.ticker));
  hard(checks, "open covered calls", snap.openCc.join(",") === openCcSymbols.join(","), snap.openCc.join(","));
  hard(checks, "dividend rows", snap.dividendCount === String((data.dividends || []).length), snap.dividendCount);
  hard(checks, "scalp rows", snap.scalpCount === String((data.scalps || data.daytrades || []).length), snap.scalpCount);
  hard(checks, "assignment rows", snap.assignCount === String((data.assignments || []).length), snap.assignCount);
  hard(checks, "orders empty or listed", orders.length === 0 ? snap.orderText.includes("No open orders") : true, snap.orderText);
  hard(checks, "realized collapsed", snap.realizedOpen === false, String(snap.realizedOpen));
  hard(checks, "weekly summary hidden when empty", weeks.length ? snap.summaryBtn : !snap.summaryBtn, String(snap.summaryBtn));
  hard(checks, "ember tab", snap.tabBg === "rgb(249, 115, 22)", snap.tabBg);
  hard(checks, "steel text", snap.valueColor === "rgb(226, 232, 240)", snap.valueColor);
  hard(checks, "no invented last", !snap.bodyText.includes("3.13"), "body");
  const allowed = new Set(equity.map((p) => str(p.symbol)));
  hard(checks, "no extra equity symbols", snap.symbols.every((s) => allowed.has(s)) && snap.symbols.length === equity.length, snap.symbols.join(","));

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "sleeve-tab.png"), fullPage: true });

  if (weeks.length) {
    await page.locator('.js-view[data-view="summary"]').click();
    await page.waitForFunction(() => document.getElementById("sl-weeks") && location.hash === "#sleeve");
    const summary = await page.evaluate(() => ({
      weeks: [...document.querySelectorAll("#sl-weeks tr[data-week]")].map((tr) => ({
        week: tr.getAttribute("data-week"),
        text: tr.textContent.trim(),
      })),
      equityGone: !document.getElementById("sl-equity"),
    }));
    const expectWeeks = sleeveWeekRows(data).map((row) => String(row.week_ending)).sort();
    hard(checks, "summary weeks", summary.weeks.map((row) => row.week).join(",") === expectWeeks.join(","), summary.weeks.map((row) => row.week).join(","));
    hard(checks, "summary hides open book", summary.equityGone);
    for (const row of sleeveWeekRows(data)) {
      const seen = summary.weeks.find((item) => item.week === String(row.week_ending));
      const combined = money(num(row.total_week_pnl));
      const ret = pct(num(row.week_return_pct_vs_capital) != null ? num(row.week_return_pct_vs_capital) : num(row.week_return_pct));
      hard(checks, "summary " + row.week_ending, !!seen && seen.text.includes(combined) && seen.text.includes(ret), seen ? seen.text : "missing");
    }
    await page.screenshot({ path: join(EVIDENCE, "sleeve-tab-summary.png"), fullPage: true });
  }

  await page.locator('.js-view[data-view="blotter"]').click();
  await page.waitForFunction(() => document.getElementById("sl-fills") && location.hash === "#sleeve");
  const blotter = await page.evaluate(() => ({
    hash: location.hash,
    fillIds: [...document.querySelectorAll("#sl-fills tr[data-fill]")].map((tr) => tr.getAttribute("data-fill")),
    buckets: [...document.querySelectorAll("#sl-fills tr[data-bucket]")].map((tr) => tr.getAttribute("data-bucket")),
    equityGone: !document.getElementById("sl-equity"),
  }));
  hard(checks, "blotter stays on sleeve", blotter.hash === "#sleeve");
  hard(checks, "blotter hides open book", blotter.equityGone);
  hard(checks, "blotter fill ids", blotter.fillIds.join(",") === fills.map((f) => str(f.fill_id)).join(","), blotter.fillIds.join(","));
  hard(checks, "blotter buckets", blotter.buckets.join(",") === fills.map((f) => str(f.desk_bucket)).join(","), blotter.buckets.join(","));
  await page.screenshot({ path: join(EVIDENCE, "sleeve-tab-blotter.png"), fullPage: true });

  const stock = readJson("data.json");
  const line = ticketLine(asList(stock).length);
  await page.locator('a.desk-tab[data-desk="stocktimus"]').click();
  await page.waitForFunction(() => {
    const name = document.getElementById("desk-name");
    return name
      && name.textContent.trim() === "Stocktimus"
      && !document.documentElement.classList.contains("view-sleeve")
      && location.hash === "#stocktimus";
  }, null, { timeout: 20000 });
  await waitForBook(page, line);
  const back = await page.evaluate(() => {
    const hero = document.querySelector(".hero");
    const book = document.getElementById("paper-book");
    return {
      name: (document.getElementById("desk-name") && document.getElementById("desk-name").textContent.trim()) || "",
      view: document.documentElement.classList.contains("view-sleeve"),
      heroDisplay: hero ? getComputedStyle(hero).display : "",
      bookHidden: book ? book.hidden : null,
      subOn: (document.querySelector(".sh-view.on") && document.querySelector(".sh-view.on").getAttribute("data-paper-view")) || "",
    };
  });
  hard(checks, "back to stocktimus", back.name === "Stocktimus" && back.view === false && back.heroDisplay !== "none", back.name + " hero=" + back.heroDisplay);
  hard(checks, "paper open book restored", back.bookHidden === false && back.subOn === "book", back.subOn);

  return {
    checks,
    observed: {
      title: snap.title,
      pill: snap.pill,
      account: snap.account,
      cash: snap.cash,
      week: snap.weekOn,
      weekCombined: snap.weekCombined,
      weekRet: snap.weekRet,
      deployed: snap.deployed,
      openN: snap.openN,
      fillsN: snap.fillsN,
      symbols: snap.symbols,
      fillIds: blotter.fillIds,
    },
    files: ["sleeve/trades.json"],
  };
}

async function drive(featureId) {
  if (!FEATURES.includes(featureId)) {
    throw new Error("unknown feature " + featureId + ". Choose: " + FEATURES.join(", "));
  }
  const server = requireServer();
  const chromium = await loadChromium();
  mkdirSync(EVIDENCE, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let result;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const pill = document.getElementById("source-pill");
      return pill && pill.textContent.trim() !== "loading";
    }, null, { timeout: 20000 });
    if (featureId === "scoreboard-tab") result = await driveScoreboard(page);
    else if (featureId === "delayed-mark-label") result = await driveDelayed(page);
    else if (featureId === "jesse-tab") result = await driveJesse(page);
    else if (featureId === "sleeve-tab") result = await driveSleeve(page);
    else result = await drivePaper(page, featureId);
  } finally {
    await browser.close();
  }
  const ok = result.checks.every((c) => c.ok);
  const report = {
    ok,
    feature: featureId,
    at: new Date().toISOString(),
    url: server.url,
    numbersSource: "json-files",
    inventedPrices: false,
    files: result.files,
    outcome: result.outcome || null,
    proxySettle: result.proxySettle || null,
    proxyNumericPricePresent: Object.prototype.hasOwnProperty.call(result, "proxyNumericPricePresent")
      ? result.proxyNumericPricePresent
      : null,
    observed: result.observed,
    checks: result.checks,
  };
  writeJson(featureId + ".json", report);
  console.log((ok ? "drive ok " : "drive failed ") + featureId);
  if (!ok) process.exitCode = 1;
}

function listEvidenceFiles() {
  if (!existsSync(EVIDENCE)) return [];
  return readdirSync(EVIDENCE)
    .filter((name) => name !== ".run" && name !== "cleanup.json")
    .sort();
}

async function cleanup() {
  const before = listEvidenceFiles();
  const info = readServer();
  if (info && pidAlive(info.pid)) {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 30; i += 1) {
      if (!pidAlive(info.pid)) break;
      await sleep(100);
    }
    if (pidAlive(info.pid)) {
      try {
        process.kill(info.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  let down = true;
  if (info && info.url) {
    try {
      await fetch(info.url, { signal: AbortSignal.timeout(1000) });
      down = false;
    } catch {
      down = true;
    }
  }
  if (existsSync(RUN_DIR)) rmSync(RUN_DIR, { recursive: true, force: true });
  const missing = before.filter((name) => !existsSync(join(EVIDENCE, name)));
  const survived = before.filter((name) => existsSync(join(EVIDENCE, name)));
  const report = {
    ok: missing.length === 0 && down,
    at: new Date().toISOString(),
    serverStopped: down,
    survived,
    missing,
  };
  writeJson("cleanup.json", report);
  if (!report.ok) {
    console.log("cleanup failed missing=" + missing.join(",") + " serverStopped=" + down);
    process.exitCode = 1;
    return;
  }
  console.log("cleanup ok evidence kept: " + survived.join(", "));
}

function usage() {
  console.log("Usage: node drive.mjs <launch|doctor|drive|cleanup> [feature-id]");
  console.log("Features: " + FEATURES.join(", "));
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "launch") await launch();
  else if (cmd === "doctor") await doctor();
  else if (cmd === "drive") await drive(arg);
  else if (cmd === "cleanup") await cleanup();
  else if (cmd === "features") console.log(FEATURES.join("\n"));
  else {
    usage();
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
}
