// Utilities: price fetch, formatting, formation detection, position coords.


// -------- localStorage schema -----------------------------------------
// All persisted state lives under the `dp.` namespace and is gated on a
// single integer schema version. Bumping CURRENT_SCHEMA_VERSION + adding
// a migration step inside migrateStorage() lets us evolve the on-disk
// format without scattering versioned cache keys (e.g. `ytd-perf-cache-v12`)
// around the codebase. Call `migrateStorage()` exactly once on app startup
// before reading any persisted state.
const STORAGE_KEYS = {
  schemaVersion: 'dp.schema',
  auth:          'dp.auth',         // { lockoutUntil, attempts }
  ytd:           'dp.ytd',          // { year, entries: { ticker: { ts, data } } }
  prefs:         'dp.prefs',        // { hideValues: boolean, ... }
  tickerChart:   'dp.tickerChart',  // { entries: { "ticker|range|variant|phase": { ts, data } } }
};
const CURRENT_SCHEMA_VERSION = 1;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function migrateStorage() {
  const stored = parseInt(localStorage.getItem(STORAGE_KEYS.schemaVersion) || '0', 10);
  if (stored === CURRENT_SCHEMA_VERSION) return;

  if (stored < 1) {
    // v0 → v1: drop the per-feature keys that pre-date the unified schema.
    // Auth state and YTD cache will rebuild themselves on first use; we
    // don't try to preserve them since the auth state is short-lived and
    // the YTD cache is just a fetch optimisation.
    const legacy = ['auth_token', 'auth_lockout_until', 'auth_attempts'];
    // Old per-version YTD cache keys (we got up to v12 before the rewrite).
    for (let i = 1; i <= 20; i++) legacy.push('ytd-perf-cache-v' + i);
    legacy.push('ytd-perf-cache-v2'); // alias kept for safety
    for (const k of legacy) localStorage.removeItem(k);
  }
  // Future migrations: if (stored < 2) { ... }

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
}

// Typed helpers — call these instead of touching localStorage directly so
// the keys stay centralised and migrations stay possible.
export const Storage = {
  migrate: migrateStorage,
  loadAuth:  () => readJSON(STORAGE_KEYS.auth, { lockoutUntil: 0, attempts: 0 }),
  saveAuth:  (s) => writeJSON(STORAGE_KEYS.auth, s),
  clearAuth: () => { try { localStorage.removeItem(STORAGE_KEYS.auth); } catch (_) {} },
  loadYtd:   () => readJSON(STORAGE_KEYS.ytd, null),
  saveYtd:   (d) => writeJSON(STORAGE_KEYS.ytd, d),
  loadPrefs: () => readJSON(STORAGE_KEYS.prefs, { hideValues: false }),
  savePrefs: (p) => writeJSON(STORAGE_KEYS.prefs, p),
  loadTickerChart: () => readJSON(STORAGE_KEYS.tickerChart, { entries: {} }),
  saveTickerChart: (d) => writeJSON(STORAGE_KEYS.tickerChart, d),
};

// -------- Hidden-values mask --------
// Replaces each digit in a formatted string with a centred bullet so
// the masked text stays vertically aligned with neighbouring real
// numbers ("$129,341.49" → "$•••,•••.••"). Bullet is preferred over
// asterisk because `*` sits high in the x-height of our mono font and
// makes masked rows look elevated. Single source of truth — was
// duplicated as `mask` / `maskDigits` / inline `.replace(...)` across
// header_sidebar / modals / pitch.
export function maskDigits(s) {
  return typeof s === 'string' ? s.replace(/\d/g, '•') : s;
}

// -------- Formatting --------
export const fmtMoney = (n, opts = {}) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : (opts.signed && n > 0 ? "+" : "");
  if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return sign + "$" + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return sign + "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const fmtPct = (n) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
};
export const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(2);
};
export const pctColor = (n) => {
  if (n == null || isNaN(n) || Math.abs(n) < 0.005) return "var(--chalk-dim)";
  return n >= 0 ? "var(--gain)" : "var(--loss)";
};

// -------- London time + US market phase --------
// Returns { hh, mm, ss } of Europe/London right now.
export function londonTimeParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")   parts.hh = p.value;
    if (p.type === "minute") parts.mm = p.value;
    if (p.type === "second") parts.ss = p.value;
  }
  return parts;
}

// US market phase, based on NY local time.
// RTH: 09:30–16:00, Premarket: 04:00–09:30, Afterhours: 16:00–20:00, Overnight: 20:00–04:00.
// Weekends → overnight.
export function usMarketPhase(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  let hh = 0, mm = 0, wd = "Mon";
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")    hh = parseInt(p.value, 10) % 24;
    if (p.type === "minute")  mm = parseInt(p.value, 10);
    if (p.type === "weekday") wd = p.value;
  }
  const mins = hh * 60 + mm;
  if (wd === "Sat" || wd === "Sun") return "overnight";
  if (mins >= 570 && mins < 960) return "regular";      // 9:30–16:00
  if (mins >= 240 && mins < 570) return "premarket";    // 4:00–9:30
  if (mins >= 960 && mins < 1200) return "afterhours";  // 16:00–20:00
  return "overnight";                                     // 20:00–4:00
}

// UK time-zone short name ('GMT' or 'BST') for the given moment.
// Uses Intl so DST transitions (last Sun Mar / last Sun Oct) are
// resolved by the runtime — no manual cutover dates to maintain.
export function ukTzAbbr(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).formatToParts(now);
  const tz = parts.find(p => p.type === 'timeZoneName')?.value;
  return tz === 'BST' || tz === 'GMT' ? tz : 'GMT';
}

// US regular-market open / close in UTC for the given moment, accounting
// for whether the date lands in EDT (UTC-4, March 2nd Sun → Nov 1st Sun)
// or EST (UTC-5). Returned as hh/mm pairs so the chart code can compare
// against the UTC-string slice of each intraday bar.
//
//   EDT: open 13:30 UTC (= 9:30 ET), close 20:00 UTC (= 16:00 ET)
//   EST: open 14:30 UTC,             close 21:00 UTC
//
// Detection: ask the runtime for the NY hour, compare to the UTC hour;
// the offset is 4 (EDT) or 5 (EST). Avoids hard-coded DST cutover
// dates.
export function usMarketHoursUtc(now = new Date()) {
  const utcHour = now.getUTCHours();
  const nyHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(now), 10) % 24;
  let diff = utcHour - nyHour;
  if (diff > 12)  diff -= 24;
  if (diff < -12) diff += 24;
  const edt = diff === 4;
  return edt
    ? { openHh: 13, openMm: 30, closeHh: 20, closeMm: 0, edt: true }
    : { openHh: 14, openMm: 30, closeHh: 21, closeMm: 0, edt: false };
}

// e.g. 1m 24s / 12s / 1h 03m
export function formatAgo(ms) {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m ${String(rs).padStart(2, "0")}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m`;
}

// -------- Currency --------
// Each holding has a native currency. We store price + cost in that native
// currency and convert to USD on the fly using FX rates from marketData.
// Detection rules (ticker-pattern based so it works without a live fetch):
//   6-digit numeric     → CNY (Chinese mutual fund)
//   ticker ends in .L   → GBP (London Stock Exchange)
//   ticker ends in .HK  → HKD (Hong Kong)
//   everything else     → USD
export function detectCurrency(ticker) {
  if (/^\d{6}$/.test(ticker)) return "CNY";
  if (/\.L$/i.test(ticker))   return "GBP";
  if (/\.HK$/i.test(ticker))  return "HKD";
  return "USD";
}

// Symbol + decimal rules for the avg-cost field (what the user typed).
// We keep 4 decimals for GBP/CNY so sub-penny precision isn't lost.
const CURRENCY_SYMBOLS = { USD: "$", GBP: "£", CNY: "¥", HKD: "HK$" };
export function currencySymbol(cur) { return CURRENCY_SYMBOLS[cur] || "$"; }

// FX rate: how many USD one unit of `currency` is worth, given current market data.
// Yahoo's GBPUSD=X is quoted GBP→USD directly.
// Yahoo's USDCNY=X is USD→CNY, so we invert.
// USDHKD=X same inversion.
export function fxToUSD(currency, marketData) {
  if (!currency || currency === "USD") return 1;
  if (currency === "GBP") return marketData?.["GBPUSD=X"]?.lastPrice ?? 1;
  if (currency === "CNY") {
    const r = marketData?.["USDCNY=X"]?.lastPrice;
    return r > 0 ? 1 / r : 1;
  }
  if (currency === "HKD") {
    const r = marketData?.["USDHKD=X"]?.lastPrice;
    return r > 0 ? 1 / r : 1;
  }
  return 1;
}

// -------- Portfolio math --------
export const computeMetrics = (portfolio, opts = {}) => {
  const ext = !!opts.extended;
  const marketData = opts.marketData || {};
  let marketValue = 0, totalCost = 0, dayChange = 0;
  const positionsOut = {};
  for (const [posKey, pos] of Object.entries(portfolio.positions)) {
    let posMV = 0, posPrev = 0, posCost = 0;
    const players = [];
    for (const t of pos.tickers) {
      const h = portfolio.holdings[t];
      if (!h) continue;
      // Cash entries: MV = lastPrice (held as dollar amount); no P/L, no day change.
      const isCash = !!h.isCash;
      // In extended mode use the extended price if available; cash always uses lastPrice.
      const priceNative = isCash ? h.lastPrice : ((ext && h.extPrice != null) ? h.extPrice : h.lastPrice);
      const pct   = (ext && h.extDayPct != null) ? h.extDayPct : (h.dayPct ?? 0);
      // Convert native → USD (cash is already USD; treat missing currency as USD)
      const fx = isCash ? 1 : fxToUSD(h.currency, marketData);
      const priceUSD = priceNative * fx;
      const mv = isCash ? h.lastPrice : h.shares * priceUSD;
      // In extended-hours mode the baseline is today's RTH close (lastPrice), not yesterday's close.
      // This makes position + scoreboard day change reflect the after-hours move since 16:00 ET.
      const baselinePrice = ext ? (h.lastPrice ?? h.prevClose ?? priceNative) : (h.prevClose ?? priceNative);
      const prevMV = isCash ? mv : h.shares * baselinePrice * fx;
      const costUSD = isCash ? mv : h.shares * h.cost * fx;
      posMV += mv; posPrev += prevMV; posCost += costUSD;
      // Player object: marketValue / dayChange / cost in USD; lastPrice
      // stays native so modals can render it with the correct currency
      // symbol. dayChange = mv − prevMV in the same units (USD).
      players.push({
        ticker: t, ...h,
        marketValue: mv,
        dayChange: mv - prevMV,
        lastPrice: priceNative,
        lastPriceUSD: priceUSD,
        fx,
        dayPct: pct,
      });
    }
    marketValue += posMV; totalCost += posCost;
    const dayDelta = posMV - posPrev;
    dayChange += dayDelta;
    positionsOut[posKey] = {
      ...pos,
      marketValue: posMV,
      dayChange: dayDelta,
      dayPct: posPrev > 0 ? (dayDelta / posPrev) * 100 : 0,
      unrlGL: posMV - posCost,
      unrlPct: posCost > 0 ? ((posMV - posCost) / posCost) * 100 : 0,
      players,
    };
  }
  return {
    marketValue,
    totalCost,
    dayChange,
    dayPct: (marketValue - dayChange) > 0 ? (dayChange / (marketValue - dayChange)) * 100 : 0,
    unrlGL: marketValue - totalCost,
    unrlPct: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
    tickerCount: Object.keys(portfolio.holdings).filter(t => t !== "CASH" && !(portfolio.holdings[t] && portfolio.holdings[t].isCash)).length,
    positions: positionsOut,
  };
};

// -------- Formation detection --------
export const detectFormation = (portfolio) => {
  const counts = { DEF: 0, MID: 0, FWD: 0 };
  for (const pos of Object.values(portfolio.positions)) {
    if (pos.role !== "GK") {
      counts[pos.role] = (counts[pos.role] || 0) + 1;
    }
  }
  return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
};

// -------- Live price fetch --------
// Primary path: Supabase Edge Function (server-side direct Yahoo fetch — no CORS proxy).
// Fallback: CORS proxies for when the edge function is not yet deployed.
const EDGE_PRICES_URL = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/prices";
const EDGE_ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";

const PROXIES = [
  (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://cors.eu.org/${url}`,
];

async function fetchOneYahooChart(symbol) {
  const nonce = Date.now();
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true&_=${nonce}`;
  for (const makeProxy of PROXIES) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(makeProxy(yahooUrl), { cache: "no-store", signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta) continue;
      let lastPrice = meta.regularMarketPrice;
      if (lastPrice == null) continue;
      let prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? lastPrice;
      // Extended hours price: pre-market or after-hours (null if not available).
      let extPrice  = meta.preMarketPrice ?? meta.postMarketPrice ?? null;
      // Yahoo returns London-listed prices in pence (currency "GBp"). Normalize
      // to GBP (divide by 100) so downstream math never has to special-case pence.
      let currency = meta.currency || null;
      if (currency === "GBp" || currency === "GBX") {
        lastPrice /= 100;
        prevClose /= 100;
        if (extPrice != null) extPrice /= 100;
        currency = "GBP";
      }
      return {
        lastPrice,
        extPrice,
        prevClose,
        currency,
        dayPct: prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
        extDayPct: (extPrice != null && lastPrice > 0) ? ((extPrice - lastPrice) / lastPrice) * 100 : null,
      };
    } catch (e) {
      clearTimeout(tid);
    }
  }
  return null;
}

// Fetch a single CN mutual fund (6-digit code) from eastmoney via CORS proxies.
// Used as a fallback when the Edge Function is not yet updated to handle CN funds.
async function fetchOneCNFund(code) {
  const eastmoneyUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;
  for (const makeProxy of PROXIES) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(makeProxy(eastmoneyUrl), { cache: "no-store", signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      const m = text.match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
      if (!m) continue;
      let obj;
      try { obj = JSON.parse(m[1]); } catch { continue; }
      const dwjz = parseFloat(obj.dwjz);
      if (!isFinite(dwjz) || dwjz <= 0) continue;
      const gsz = parseFloat(obj.gsz);
      const lastPrice = isFinite(gsz) && gsz > 0 ? gsz : dwjz;
      return {
        lastPrice, extPrice: null, prevClose: dwjz,
        currency: "CNY",
        dayPct: ((lastPrice - dwjz) / dwjz) * 100, extDayPct: null,
      };
    } catch { clearTimeout(tid); }
  }
  return null;
}

async function fetchViaEdge(liveTickers) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(
      `${EDGE_PRICES_URL}?tickers=${liveTickers.map(encodeURIComponent).join(",")}`,
      {
        headers: {
          "Authorization": `Bearer ${EDGE_ANON_KEY}`,
          "apikey": EDGE_ANON_KEY,
        },
        cache: "no-store",
        signal: controller.signal,
      }
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data === "object" && !data.error && Object.keys(data).length > 0) {
      return data;
    }
    return null;
  } catch (e) {
    clearTimeout(tid);
    return null;
  }
}

// Normalize Edge Function results: it returns raw Yahoo values, so London
// tickers come through in pence. Convert to GBP and tag currency so the app
// can convert to USD consistently. Safe to call on any result map.
function normalizeEdgeResult(result) {
  if (!result) return result;
  for (const [t, r] of Object.entries(result)) {
    if (!r) continue;
    if (/^\d{6}$/.test(t) && r.currency == null) r.currency = "CNY";
    else if (/\.L$/i.test(t)) {
      // Edge doesn't report currency; assume London GBp unless values already look like GBP (<50).
      // Most London ETFs/stocks trade at hundreds of pence, so /100 is the safe default.
      if (r.currency == null) {
        r.lastPrice /= 100;
        if (r.prevClose != null) r.prevClose /= 100;
        if (r.extPrice != null) r.extPrice /= 100;
        r.currency = "GBP";
      }
    }
  }
  return result;
}

async function fetchYahoo(tickers) {
  const liveTickers = tickers.filter(t => !t.endsWith(".PVT") && t !== "CASH");
  if (!liveTickers.length) return {};

  // 6-digit numeric tickers are Chinese mutual funds.
  // Start Edge Function and direct CORS-proxy CN fund fetches in parallel.
  // If Edge returns everything (newer deployment), return immediately and
  // don't wait for the slower CORS proxy. Otherwise merge proxy results.
  const cnFunds = liveTickers.filter(t => /^\d{6}$/.test(t));
  const hasCNFund = cnFunds.length > 0;
  if (hasCNFund) {
    const edgeP = fetchViaEdge(liveTickers);
    const cnProxyP = Promise.all(cnFunds.map(async t => [t, await fetchOneCNFund(t)]))
      .then(pairs => { const o = {}; for (const [t, r] of pairs) if (r) o[t] = r; return o; });
    const edgeResult = normalizeEdgeResult(await edgeP);
    // Short-circuit: Edge covers every CN fund → return without waiting for proxy.
    if (edgeResult && cnFunds.every(t => edgeResult[t])) return edgeResult;
    const cnFromProxy = await cnProxyP;
    const out = { ...(edgeResult || {}) };
    for (const t of cnFunds) if (!out[t] && cnFromProxy[t]) out[t] = cnFromProxy[t];
    return Object.keys(out).length > 0 ? out : null;
  }

  // Race edge function (batch, fast) vs CORS proxy (per-ticker, fallback).
  // Both start immediately; whichever returns valid data first wins.
  const edgeP = fetchViaEdge(liveTickers).then(normalizeEdgeResult);
  const proxyP = Promise.all(liveTickers.map(async (t) => [t, await fetchOneYahooChart(t)]))
    .then(pairs => {
      const out = {};
      for (const [t, r] of pairs) if (r) out[t] = r;
      return Object.keys(out).length > 0 ? out : null;
    });

  const result = await Promise.any(
    [edgeP, proxyP].map(p => p.then(r => {
      if (r && Object.keys(r).length > 0) return r;
      return Promise.reject(new Error("no data"));
    }))
  ).catch(() => null);

  return result;
}

// Gentle random walk fallback
function simulateTicks(holdings) {
  const out = {};
  for (const [t, h] of Object.entries(holdings)) {
    const vol = t === "BTC-USD" ? 0.003 : 0.0015;
    const drift = (Math.random() - 0.5) * 2 * vol;
    const newPrice = Math.max(0.01, h.lastPrice * (1 + drift));
    const prev = h.prevClose ?? h.lastPrice;
    out[t] = {
      lastPrice: newPrice,
      prevClose: prev,
      dayPct: ((newPrice - prev) / prev) * 100,
    };
  }
  return out;
}

export async function refreshPrices(portfolio, mode = "live") {
  const tickers = Object.keys(portfolio.holdings);
  const result = await fetchYahoo(tickers);
  if (!result || Object.keys(result).length === 0) {
    return { updates: {}, source: "error" };
  }
  return { updates: result, source: "live" };
}

export async function fetchTickers(tickers) {
  return fetchYahoo(tickers.filter(Boolean));
}

// Fetch daily historical closes for a single symbol via the CORS proxy chain.
// Tries proxies in randomised order to spread load across them on bursty
// multi-ticker calls. Returns [{date,close}, …] or null on total failure.
export async function fetchHistorical(symbol, range = "ytd", interval = "1d", includePrePost = false) {
  const nonce = Date.now();
  const ipp = includePrePost ? "&includePrePost=true" : "";
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}${ipp}&_=${nonce}`;

  // Race ALL proxies in parallel — the previous serial fall-through
  // could take 50 s in the worst case (5 proxies × 10 s timeout each)
  // when the first few in random order were dead. Now total wall time
  // ≈ fastest live proxy. First success wins, others get cancelled.
  const isIntraday = !/^\d+d$|^\dwk$|^\dmo$/.test(interval);

  const parseResponse = async (res) => {
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes) return null;
    const meta = result?.meta;
    const penceFactor = (meta?.currency === "GBp" || meta?.currency === "GBX") ? 100 : 1;
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const iso = new Date(timestamps[i] * 1000).toISOString();
      const date = isIntraday ? iso.slice(0, 16) : iso.slice(0, 10);
      points.push({ date, close: closes[i] / penceFactor });
    }
    return points.length > 0 ? points : null;
  };

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = PROXIES.length;
    /** @type {AbortController[]} */
    const controllers = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];

    // When the race produces a winner (or all losers), tear down the
    // remaining in-flight requests so they don't keep eating bandwidth
    // and rate-limit budget against the proxy hosts. Codex P2 review
    // (#48) — without this, every losing proxy ran out its full 7 s
    // timeout, multiplied across every ticker in a 30-symbol portfolio.
    const cleanup = () => {
      for (const c of controllers) {
        try { c.abort(); } catch (_) {}
      }
      for (const t of timers) clearTimeout(t);
    };

    const settle = (data) => {
      if (resolved) return;
      if (data) {
        resolved = true;
        cleanup();
        resolve(data);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };
    for (const makeProxy of PROXIES) {
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 4000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(makeProxy(yahooUrl), { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          settle(await parseResponse(res));
        } catch (_) {
          clearTimeout(tid);
          settle(null);
        }
      })();
    }
  });
}

// 6-digit numeric tickers are CN mutual funds (天天基金 / pingzhongdata) —
// they don't exist on Yahoo, so the CORS-proxy Yahoo fetch is guaranteed
// to fail. The Edge Function routes them to eastmoney/danjuanapp, but
// Deno Deploy's egress IPs sometimes get geo-blocked from those Chinese
// hosts. The fetchCnFundHistoryViaProxy helper below races public CORS
// proxies in parallel as a fallback — those proxies' egress IPs are
// different (Cloudflare / various) and have a separate chance of
// reaching the data hosts.
const CN_FUND_RE = /^\d{6}$/;

// Trim a fetched CN-fund history to the requested chart range. Both the
// danjuanapp and xueqiu endpoints return ~500 daily bars regardless of
// range; without this trim, picking 1M / 3M / YTD all renders multi-year
// data — the user noticed because the chart looked identical across
// range buttons. (The Edge Function applies the same trim server-side
// for the eastmoney path; this is the client-side equivalent.)
function trimCnFundToRange(points, range) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const now = Date.now();
  let cutoffMs = 0;
  if (range === "ytd") {
    cutoffMs = new Date(new Date().getFullYear(), 0, 1).getTime() - 7 * 86_400_000;
  } else if (range === "1y" || range === "1Y") {
    cutoffMs = now - 380 * 86_400_000;
  } else if (range === "6mo") {
    cutoffMs = now - 200 * 86_400_000;
  } else if (range === "3mo") {
    cutoffMs = now - 100 * 86_400_000;
  } else if (range === "1mo") {
    cutoffMs = now - 35 * 86_400_000;
  } else {
    return points; // unknown range → keep everything
  }
  const filtered = points.filter(p => new Date(p.date).getTime() >= cutoffMs);
  return filtered.length > 0 ? filtered : points;
}

// Race CORS proxies × 2 alternative NAV-history endpoints. Returns
// `[{date,close}, …]` (trimmed to `range`) on first success, null if
// every (proxy, endpoint) combination fails. Endpoints we try:
//   - danjuanapp.com (Snowball/雪球 旗下蛋卷基金)
//   - stock.xueqiu.com kline.json (Snowball public API, F-prefixed code)
// Both are globally accessible (Cloudflare/AWS) and have a separate IP-
// path chance vs. the Edge Function reaching eastmoney directly.
async function fetchCnFundHistoryViaProxy(code, range) {
  const djUrl =
    `https://danjuanapp.com/djapi/fund/nav/history/${encodeURIComponent(code)}` +
    `?size=500&page=1&_=${Date.now()}`;
  // Snowball klines for a fund use the F-prefixed symbol. count=-500 = last 500 daily bars.
  const xqUrl =
    `https://stock.xueqiu.com/v5/stock/chart/kline.json` +
    `?symbol=F${encodeURIComponent(code)}&period=day&type=before&count=-500` +
    `&indicator=kline&_=${Date.now()}`;

  const parseDanjuan = async (res) => {
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data?.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    /** @type {{date:string, close:number}[]} */
    const points = [];
    for (const row of items) {
      const close = parseFloat(row?.nav);
      if (!isFinite(close) || close <= 0) continue;
      const date = String(row?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      points.push({ date, close });
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.date.localeCompare(b.date));
    return trimCnFundToRange(points, range);
  };
  const parseXueqiu = async (res) => {
    if (!res.ok) return null;
    const json = await res.json();
    // Response: { data: { column: ["timestamp","volume","open","high","low","close",…], item: [[ts,vol,open,…]] } }
    const cols = json?.data?.column;
    const rows = json?.data?.item;
    if (!Array.isArray(cols) || !Array.isArray(rows)) return null;
    const tsIdx = cols.indexOf("timestamp");
    const closeIdx = cols.indexOf("close");
    if (tsIdx < 0 || closeIdx < 0) return null;
    /** @type {{date:string, close:number}[]} */
    const points = [];
    for (const row of rows) {
      const ts = Number(row?.[tsIdx]);
      const close = Number(row?.[closeIdx]);
      if (!isFinite(ts) || !isFinite(close) || close <= 0) continue;
      points.push({ date: new Date(ts).toISOString().slice(0, 10), close });
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.date.localeCompare(b.date));
    return trimCnFundToRange(points, range);
  };

  const attempts = [];
  for (const makeProxy of PROXIES) {
    attempts.push({ url: makeProxy(djUrl), parse: parseDanjuan });
    attempts.push({ url: makeProxy(xqUrl), parse: parseXueqiu });
  }

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = attempts.length;
    /** @type {AbortController[]} */
    const controllers = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];
    const cleanup = () => {
      for (const c of controllers) {
        try { c.abort(); } catch (_) {}
      }
      for (const t of timers) clearTimeout(t);
    };
    const settle = (data) => {
      if (resolved) return;
      if (data) {
        resolved = true;
        cleanup();
        resolve(data);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };
    for (const { url, parse } of attempts) {
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 4000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(url, { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          settle(await parse(res));
        } catch (_) {
          clearTimeout(tid);
          settle(null);
        }
      })();
    }
  });
}

// Batch fetch YTD historical closes for multiple symbols.
// Strategy:
//   1. Try the Supabase Edge Function (server-side fetch, no CORS proxies — much
//      more reliable than browser-side proxies under concurrent load).
//   2. For any tickers the Edge Function didn't return (function not deployed
//      yet, or specific symbols that Yahoo refused), fall back to per-symbol
//      fetchHistorical via the CORS proxy chain.
// Returns { ticker: [{date,close}, …], … } — failed tickers are simply absent.
export async function fetchHistoricalBatch(symbols, range = "ytd", interval = "1d", includePrePost = false) {
  const out = {};
  const list = Array.from(new Set(symbols.filter(Boolean)));
  if (list.length === 0) return out;

  // Race the Edge Function (one batched request for all tickers) against
  // per-ticker CORS-proxy fetches in parallel. Resolve as soon as either
  //   (a) every requested ticker has data in `out`, OR
  //   (b) both paths have finished (so we resolve with whatever we got).
  // Concretely: when Edge returns the full batch fast, we don't sit and
  // wait for the slower proxy chain to complete — the Promise resolves
  // the moment the last ticker is filled. (Codex P1 review on PR #47.)
  const ipp = includePrePost ? "&includePrePost=true" : "";

  return new Promise((resolve) => {
    let resolved = false;
    let edgeDone = false;
    let proxiesRemaining = list.length;

    const check = () => {
      if (resolved) return;
      const allFilled = list.every((t) => out[t]);
      if (allFilled || (edgeDone && proxiesRemaining === 0)) {
        resolved = true;
        resolve(out);
      }
    };

    // Edge Function (batched) ----------------------------------------------
    (async () => {
      try {
        const edgeUrl =
          `${EDGE_PRICES_URL.replace(/\/prices$/, "/chart")}` +
          `?tickers=${encodeURIComponent(list.join(","))}` +
          `&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}${ipp}`;
        const res = await fetch(edgeUrl, {
          headers: { Authorization: `Bearer ${EDGE_ANON_KEY}`, apikey: EDGE_ANON_KEY },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === "object") {
            for (const [t, pts] of Object.entries(data)) {
              if (Array.isArray(pts) && pts.length > 0 && !out[t]) out[t] = pts;
            }
          }
        }
      } catch (_) { /* proxy path may still succeed */ }
      edgeDone = true;
      check();
    })();

    // Per-ticker CORS-proxy fetches ----------------------------------------
    // CN fund codes route to danjuanapp via CORS proxies (different
    // egress IPs from Deno Deploy, so they can succeed when the Edge
    // Function's eastmoney path is geo-blocked). Yahoo proxy doesn't
    // know these symbols so we don't bother trying it.
    for (const s of list) {
      const promise = CN_FUND_RE.test(s)
        ? fetchCnFundHistoryViaProxy(s, range)
        : fetchHistorical(s, range, interval, includePrePost);
      promise
        .then((data) => { if (data && data.length > 0 && !out[s]) out[s] = data; })
        .catch(() => {})
        .finally(() => { proxiesRemaining--; check(); });
    }
  });
}

// -------- Position coordinates on 100x100 pitch (home team attacks UP; GK at bottom) --------
export const POSITION_COORDS = {
  GK:  { x: 50, y: 91 },
  CB1: { x: 38, y: 76 },
  CB2: { x: 62, y: 76 },
  LB:  { x: 15, y: 70 },
  RB:  { x: 85, y: 70 },
  CDM: { x: 50, y: 58 },
  CM:  { x: 30, y: 44 },
  CAM: { x: 70, y: 44 },
  LW:  { x: 15, y: 22 },
  ST:  { x: 50, y: 15 },
  RW:  { x: 85, y: 22 },
};

