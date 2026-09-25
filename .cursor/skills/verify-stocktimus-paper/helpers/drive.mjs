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
    defaultAccount: 50000,
    defaultWeekly: 750,
  },
  "moonshot-desk": {
    tab: "moonshot",
    name: "Moonshot",
    sub: "10x sleeve",
    title: "Moonshot · Paper book",
    file: "desks/moonshot.json",
    summaryFile: null,
    defaultAccount: 5000,
    defaultWeekly: 0,
  },
  "compounder-desk": {
    tab: "compounder",
    name: "Compounder",
    sub: "Long-term book",
    title: "Compounder · Paper book",
    file: "desks/compounder.json",
    summaryFile: null,
    defaultAccount: 25000,
    defaultWeekly: 0,
  },
};

const FEATURES = [
  "stocktimus-paper-book",
  "moonshot-desk",
  "compounder-desk",
  "scoreboard-tab",
  "delayed-mark-label",
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
  hard(checks, "price proxy url", app.includes('const PRICE_PROXY_URL = "' + PROXY_URL + '"'));
  hard(checks, "delayed pill suffix", app.includes('src += " · delayed"'));
  hard(checks, "delayed MTM copy", app.includes("delayed MTM"));
  hard(checks, "never label as real-time", app.includes("never label as real-time"));
  hard(checks, "footer not advice", index.includes("Not advice"));
  hard(checks, "four desk tabs", ["stocktimus", "moonshot", "compounder", "scoreboard"].every((id) => index.includes('data-desk="' + id + '"')));
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

  const origin = server.url.replace(/\/$/, "");
  const routes = ["/", "/data.json", "/desks/moonshot.json", "/desks/compounder.json", "/app.js", "/scoreboard.js", "/scoreboard/stocktimus.json", "/scoreboard/scout.json"];
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

function settleProxy(page, ms = 8000) {
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
  const live = snap.pill.includes("delayed");
  const summaryObj = mergedSummary(payload, desk.summaryFile ? summary : null);
  const countsFixed = bookCounts(trades, summaryObj);
  const { account, weekly } = accountWeekly(desk, payload, desk.summaryFile ? summary : null);
  const footer = footerFromIndex();
  const base = pillBase(payload);
  const ids = new Set(trades.map(tradeId));
  const seen = snap.rows.map((r) => r.id);

  hard(checks, "desk name", snap.deskName === desk.name, snap.deskName);
  hard(checks, "desk subtitle", snap.deskSub === desk.sub, snap.deskSub);
  hard(checks, "document title", snap.title === desk.title, snap.title);
  hard(checks, "active tab", snap.tabOn === desk.tab, snap.tabOn);
  hard(checks, "source pill", snap.pill === base || snap.pill === base + " · delayed", snap.pill + " expected " + base);
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
  if (!live) {
    const expectedTotal = fileTotalText(trades, summaryObj, false);
    hard(checks, "total P&L matches file while not delayed", snap.pnl === expectedTotal, snap.pnl + " vs " + expectedTotal);
  } else {
    hard(checks, "delayed total is formatted money", /^(?:−\$|\$)[\d,]+\.\d{2}$/.test(snap.pnl), snap.pnl);
    hard(checks, "delayed MTM subtitle", snap.pnlSub.includes("delayed MTM"), snap.pnlSub);
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

async function driveDelayed(page) {
  const checks = [];
  const desk = PAPER_DESKS["stocktimus-paper-book"];
  const { trades, proxy } = await openPaperDesk(page, desk);
  const snap = await paperSnapshot(page);
  let probe = { numericPricePresent: false, ok: false };
  const symbol = firstOpenTicker(trades);
  if (symbol) probe = await proxyProbe(symbol);
  const quoteLanded = probe.numericPricePresent || proxy === "ok";
  hard(checks, "book loaded", snap.bookSub === ticketLine(trades.length), snap.bookSub);
  hard(checks, "pill does not say real-time", !/real-?time/i.test(snap.pill), snap.pill);
  hard(checks, "subtitle does not say real-time", !/real-?time/i.test(snap.pnlSub), snap.pnlSub);
  let outcome = "delayed";
  if (quoteLanded) {
    hard(checks, "pill says delayed", snap.pill.includes("delayed"), snap.pill);
    hard(checks, "subtitle says delayed MTM", snap.pnlSub.includes("delayed MTM"), snap.pnlSub);
  } else {
    outcome = "file-marks-only";
    hard(checks, "no delayed suffix without a quote", !snap.pill.includes("delayed"), snap.pill);
    const ids = new Set(trades.map(tradeId));
    const seen = snap.rows.map((r) => r.id);
    hard(checks, "file tickets still listed", seen.length === ids.size && seen.every((id) => ids.has(id)));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(EVIDENCE, "delayed-mark-label.png") });
  return {
    checks,
    outcome,
    proxySettle: proxy,
    proxyNumericPricePresent: probe.numericPricePresent,
    observed: { pill: snap.pill, pnlSub: snap.pnlSub, bookSub: snap.bookSub },
    files: ["data.json"],
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
