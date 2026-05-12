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
  auth:          'dp.auth',   // { lockoutUntil, attempts }
  prefs:         'dp.prefs',  // { hideValues: boolean, ... }
  // Last-known market-data snapshot from the live `fetchTickers`
  // reply. Hydrated on app mount as the initial value of
  // `marketData` so the first metrics compute uses real cross-rates
  // (~yesterday's, well within a percent of live) instead of the
  // silent 1:1 USD fallback that was inflating CNY-denominated
  // holdings by ~7x for ~500 ms during cold start. Also covers MC
  // cards (^GSPC / ^VIX / BZ=F / etc.) so they no longer flash
  // "Loading…" on cold start — they paint the last-known values
  // immediately and refresh once the live tick lands.
  marketCache:   'dp.marketCache', // { ts, data: { ticker: { lastPrice, prevClose?, dayPct?, ... }, ... } }
  // Chart caches (dp.tickerChart / dp.maCache / dp.ytd) live in
  // IndexedDB now (chart_store.js). chart_store's hydrate() owns
  // the legacy-localStorage migration so these names are referenced
  // there, not here.
};
const CURRENT_SCHEMA_VERSION = 1;
// Market-cache freshness — accept rows up to 7 days old. FX moves
// <1 % over a typical week and index / futures levels move a few
// percent at most, so the cold-start render is still well within
// noise; older than that we'd rather fall back to the empty
// initial state than render values that could be several percent
// off (and trigger spurious FX MISSING / stale-price warnings).
const MARKET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}

// localStorage write with quota-fallback. Browsers throw
// QuotaExceededError when the per-origin quota (~5-10 MB) is hit;
// the previous version swallowed that silently, which meant a full
// cache stopped accepting any new entries — the user reported
// "switch ranges and back, still loads" because no chart entry
// could persist. Now: on quota failure, halve the largest dp.* row
// (the chart cache typically) and retry once. If THAT still fails
// we give up — the worst case is one cold fetch, not silent
// permanent breakage.
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Detect quota: name varies by browser ('QuotaExceededError' /
    // 'NS_ERROR_DOM_QUOTA_REACHED'); code 22 / 1014 also possible.
    const isQuota = e && (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014
    );
    if (!isQuota) return false;
    // Free space: halve the entries on the cache rows that grow
    // unboundedly. Keep the freshest half by ts.
    try {
      for (const k of ['dp.tickerChart', 'dp.maCache']) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const entries = parsed?.entries || {};
        const keys = Object.keys(entries);
        if (keys.length === 0) continue;
        const half = Math.max(1, Math.floor(keys.length / 2));
        const sorted = keys
          .map((kk) => ({ kk, ts: entries[kk]?.ts || 0 }))
          .sort((a, b) => b.ts - a.ts)
          .slice(0, half);
        const trimmed = {};
        for (const { kk } of sorted) trimmed[kk] = entries[kk];
        parsed.entries = trimmed;
        try { localStorage.setItem(k, JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      // Retry the original write now that we've freed space.
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch { return false; }
  }
}

function migrateStorage() {
  // Chart caches now live in IndexedDB (chart_store.js). Their
  // module's hydrate() handles a one-shot localStorage→IDB migration
  // for any legacy dp.tickerChart / dp.maCache / dp.ytd rows the
  // user still has from older deploys. Pruning lives there too,
  // since IDB's quota is so much higher (100+ MB) that the trim is
  // bounded by a soft cap rather than browser quota pressure.
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
  loadPrefs: () => readJSON(STORAGE_KEYS.prefs, { hideValues: false }),
  savePrefs: (p) => writeJSON(STORAGE_KEYS.prefs, p),
  // Market-data seed: returns a marketData-shaped object containing
  // every ticker from the most recent successful live tick. Initial
  // render uses these for both (a) FX-conversion in metrics (so CNY
  // / GBP / HKD holdings get correct USD conversions instead of
  // the silent 1:1 fallback that briefly inflated/deflated the
  // portfolio total) and (b) MC card display (so ^GSPC / ^VIX /
  // BZ=F / GBPUSD=X paint last-known values instead of "Loading…").
  // Returns `{}` when the cache is missing, older than 7 days, or
  // malformed. Entries with non-positive lastPrice are dropped to
  // keep the seed clean.
  loadMarketCache: () => {
    const row = readJSON(STORAGE_KEYS.marketCache, null);
    if (!row || typeof row !== 'object') return {};
    const ts = Number(row.ts);
    if (!isFinite(ts) || Date.now() - ts > MARKET_CACHE_MAX_AGE_MS) return {};
    const data = row.data;
    if (!data || typeof data !== 'object') return {};
    /** @type {Record<string, any>} */
    const out = {};
    for (const [t, v] of Object.entries(data)) {
      if (!v || typeof v !== 'object') continue;
      const lp = Number(/** @type {any} */ (v).lastPrice);
      if (!isFinite(lp) || lp <= 0) continue;
      out[t] = v;
    }
    return out;
  },
  // Persist a fresh marketData tick (filtered to entries with a
  // usable lastPrice). Called after every successful setMarketData
  // so the next cold start has a recent snapshot to seed with.
  saveMarketCache: (marketData) => {
    if (!marketData || typeof marketData !== 'object') return false;
    /** @type {Record<string, any>} */
    const data = {};
    for (const [t, v] of Object.entries(marketData)) {
      if (!v || typeof v !== 'object') continue;
      const lp = Number(/** @type {any} */ (v).lastPrice);
      if (!isFinite(lp) || lp <= 0) continue;
      data[t] = v;
    }
    if (Object.keys(data).length === 0) return false;
    return writeJSON(STORAGE_KEYS.marketCache, { ts: Date.now(), data });
  },
  // dp.tickerChart / dp.maCache / dp.ytd moved to IndexedDB
  // (chart_store.js — ChartStore / MaStore / YtdStore). See that
  // module for the read/write API. localStorage now only holds
  // small, low-churn rows: auth token + prefs + schema version,
  // staying well clear of the per-origin ~5 MB quota.
};

// Formatters + the hidden-values mask moved to ./formatters.js. Kept
// re-exported here so existing callers don't break — prefer importing
// from './formatters.js' directly in new code.
export { maskDigits, fmtMoney, fmtPct, fmtPrice, pctColor, formatAgo } from './formatters.js';

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

// formatAgo moved to ./formatters.js — see the re-export block above.

// Currency detection + FX moved to ./fx.js. Re-exported for back-compat.
// Prefer importing from './fx.js' in new code.
export { detectCurrency, currencySymbol, fxRateToUSD, fxToUSD } from './fx.js';

// Portfolio rollup + formation detection moved to ./metrics.js. Re-
// exported for back-compat. Prefer importing from './metrics.js' in
// new code so the dep graph (formatters / fx / metrics / utils) stays
// readable.
export { computeMetrics, detectFormation } from './metrics.js';

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
    // Edge Function first — it covers CN funds (eastmoney / lsjz /
    // danjuanapp fallback chain server-side) so the happy path needs
    // zero CORS-proxy traffic. Previous version fired the proxy chain
    // in parallel "in case Edge missed some", but browsers don't
    // cancel in-flight requests when the Promise short-circuits, so
    // every 30 s auto-refresh burned through `corsproxy.io` /
    // `api.cors.lol` rate limits and littered the Network tab with
    // 403 / 429 / cancelled rows. Serial: only fire CORS proxies for
    // CN funds the Edge call actually missed.
    const edgeResult = normalizeEdgeResult(await fetchViaEdge(liveTickers));
    if (edgeResult && cnFunds.every(t => edgeResult[t])) return edgeResult;
    const missingCn = cnFunds.filter(t => !edgeResult?.[t]);
    const cnFromProxy = (await Promise.all(
      missingCn.map(async t => [t, await fetchOneCNFund(t)])
    )).reduce((acc, [t, r]) => { if (r) acc[t] = r; return acc; }, /** @type {Record<string, any>} */ ({}));
    const out = { ...(edgeResult || {}) };
    for (const t of cnFunds) if (!out[t] && cnFromProxy[t]) out[t] = cnFromProxy[t];
    return Object.keys(out).length > 0 ? out : null;
  }

  // Edge Function first — it batches all tickers in one server-side
  // request and is the source of truth when healthy. Only fall back to
  // the per-ticker CORS-proxy chain for tickers the Edge missed; the
  // proxies have aggressive rate limits so racing them on every refresh
  // (the previous Promise.any approach) burned through their daily
  // quota even when the Edge Function was working fine.
  const edgeResult = await fetchViaEdge(liveTickers).then(normalizeEdgeResult).catch(() => null);
  const haveEverything = edgeResult && liveTickers.every(t => edgeResult[t]);
  if (haveEverything) return edgeResult;
  // If the Edge Function returned anything at all (even a partial set),
  // trust it — the tickers it omitted genuinely failed server-side
  // (Yahoo doesn't have them, .PVT placeholder, geo-blocked CN fund,
  // etc.). Re-trying the same upstreams through browser CORS proxies
  // wastes the proxies' rate limits with no realistic chance of
  // different data. Only fall back to proxies when the Edge call
  // ITSELF failed (no result whatsoever).
  if (edgeResult) return edgeResult;
  const missing = liveTickers;
  // Edge call totally failed — proxy fallback for everything.
  const proxyPairs = await Promise.all(missing.map(async (t) => [t, await fetchOneYahooChart(t)]));
  const out = { ...(edgeResult || {}) };
  for (const [t, r] of proxyPairs) if (r) out[t] = r;
  return Object.keys(out).length > 0 ? out : null;
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

// Returns { ticker: <close at the most recent 16:00 ET bar in the
// fetched series> } — the user's mental model of "today's % move" is
// "since the most recent 16:00 ET regular close that has occurred",
// which during AH/PM is today's close but overnight / pre-market is
// yesterday's. Used by the MC cards (futures) so they share an anchor
// with the perf chart legend and the ticker-drill modal.
//
// Implementation: pull a 5-day intraday window (so we're sure to have
// at least one regular-close bar even at 3am ET pre-market) and walk
// backwards for the latest bar at exactly closeHh:closeMm UTC. The
// previous "must be today's UTC date" restriction broke the lookup at
// every BST 8am refresh — todayUtc was the new day, no 16:00 ET bar
// existed on it yet, and the cards silently fell back to dayPct.
//
// Falls through silently when no close bar can be found (cold weekend,
// fetch failure) — caller should fall back to marketData.prevClose.
export async function fetchTodayRegularClose(tickers) {
  const list = Array.from(new Set((tickers || []).filter(Boolean)));
  if (list.length === 0) return {};
  const batch = await fetchHistoricalBatch(list, "5d", "5m", true);
  const mh = usMarketHoursUtc(new Date());
  /** @type {Record<string, number>} */
  const out = {};
  for (const t of list) {
    const series = batch[t];
    if (!Array.isArray(series) || series.length === 0) continue;
    for (let i = series.length - 1; i >= 0; i--) {
      const d = series[i].date;
      if (typeof d !== "string" || d.length < 16 || d[10] !== "T") continue;
      const hh = parseInt(d.slice(11, 13), 10);
      const mm = parseInt(d.slice(14, 16), 10);
      if (hh === mh.closeHh && mm === mh.closeMm) { out[t] = series[i].close; break; }
    }
  }
  return out;
}

// Fetch current TTM P/E + EPS for the given tickers via the
// `fundamentals` Edge Function. Returns
//   { NVDA: { pe: 30.5, eps: 6.5 }, … }
// with tickers that have no meaningful fundamentals (futures /
// indices / ETFs / crypto / .PVT / 6-digit CN funds) simply absent.
//
// Pass `{ ttmEpsHistory: true }` to also receive
// `ttmEpsHistory: [{date, eps:<TTM diluted EPS>}, …]` on each entry —
// pre-summed TTM at each quarter end, sourced from Yahoo's
// fundamentals-timeseries (5+ yrs). Used by the P/E chart modal so
// the historical P/E line steps when an earnings report changes the
// denominator, instead of being a 1:1 scaled copy of the price chart.
// The contract name is deliberately distinct from #64's earlier
// `epsHistory` (which returned RAW quarterly EPS) — a stale Edge
// Function deploy, or a SW-cached old response, would otherwise feed
// raw quarterly numbers into the TTM lookup and inflate P/E ~4x.
export async function fetchFundamentals(symbols, opts = {}) {
  const list = Array.from(new Set((symbols || []).filter(Boolean)));
  if (list.length === 0) return {};
  try {
    const qs = `?tickers=${encodeURIComponent(list.join(","))}`
      + (opts && opts.ttmEpsHistory ? "&ttmEpsHistory=true" : "");
    const url =
      `${EDGE_PRICES_URL.replace(/\/prices$/, "/fundamentals")}${qs}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${EDGE_ANON_KEY}`, apikey: EDGE_ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
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
    // Volume is per-bar and only meaningful on intraday intervals.
    // Kept in lockstep with the Edge Function path so the proxy
    // fallback also feeds the modal's VWAP overlay — otherwise
    // any time Yahoo's Edge call dropped a ticker the 1D chart
    // would silently lose its VWAP line until the next refetch.
    const volumes = result?.indicators?.quote?.[0]?.volume;
    if (!timestamps || !closes) return null;
    const meta = result?.meta;
    const penceFactor = (meta?.currency === "GBp" || meta?.currency === "GBX") ? 100 : 1;
    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const iso = new Date(timestamps[i] * 1000).toISOString();
      const date = isIntraday ? iso.slice(0, 16) : iso.slice(0, 10);
      const v = isIntraday ? volumes?.[i] : null;
      const point = { date, close: closes[i] / penceFactor };
      if (typeof v === "number" && isFinite(v) && v >= 0) point.volume = v;
      points.push(point);
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

  // Edge Function first (single batched request, server-side direct
  // Yahoo fetch — fast and CORS-clean). Per-ticker CORS-proxy chain is
  // ONLY consulted for tickers the Edge missed; firing it concurrently
  // with the Edge call (the previous Promise-based race) burned through
  // the free proxies' rate limits on every refresh even when the Edge
  // Function was healthy.
  const ipp = includePrePost ? "&includePrePost=true" : "";

  let edgeSucceeded = false;
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
        edgeSucceeded = true;
        for (const [t, pts] of Object.entries(data)) {
          if (Array.isArray(pts) && pts.length > 0) out[t] = pts;
        }
      }
    }
  } catch (_) { /* fall through to proxy-fallback */ }

  const missing = list.filter((t) => !out[t]);
  if (missing.length === 0) return out;

  // If the Edge Function ran successfully and just didn't return some
  // tickers, those tickers genuinely failed server-side — the Edge
  // already exhausts all sensible upstreams server-side (Yahoo with
  // .PVT-strip fallback for stocks; eastmoney → lsjz → danjuanapp for
  // CN funds). Re-trying via the same Yahoo / xueqiu endpoints through
  // browser CORS proxies just burns the proxies' rate limits without
  // any chance of a different outcome. Skip them quietly.
  //
  // Only fall back to proxies when the Edge Function call ITSELF failed
  // (network error, gateway 5xx, function not deployed). In that case
  // proxies are the only way to get any data for the page.
  if (edgeSucceeded) return out;

  await Promise.all(missing.map(async (s) => {
    const data = await (CN_FUND_RE.test(s)
      ? fetchCnFundHistoryViaProxy(s, range)
      : fetchHistorical(s, range, interval, includePrePost)).catch(() => null);
    if (data && data.length > 0) out[s] = data;
  }));
  return out;
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

