// Live-price fetch path. The Supabase Edge Function
// (/functions/v1/prices) is the primary route — server-side direct
// Yahoo, no CORS proxy, single batched request for all tickers. The
// per-ticker CORS-proxy chain falls in only for tickers the Edge
// dropped, so the public proxies aren't burned through on every
// 30 s refresh tick when the Edge Function is healthy.
//
// Pulled out of utils.js along with proxy_chain / historical / etc.
// when that barrel was retired; consumers now import this module
// (refreshPrices / fetchTickers / fetchFundamentals) directly.

import {
  PROXIES,
  proxyIsAvailable,
  markProxyDead,
  clearProxyBackoff,
  mapWithConcurrency,
} from './proxy_chain.js';
import { isUsEquity, hasOvernightSession } from './ticker_class.js';
import { SB_URL, SB_ANON } from './supabase_config.js';

// OTC ADRs like SoftBank (SFTBY) quote ONLY their regular US session —
// no pre-market, no after-hours, no overnight. Yahoo nonetheless ships a
// `postMarketPrice` for them (the RTH close re-stamped as an "after-hours"
// quote), which slipped past the ±5% / 3% trust heuristics and surfaced
// as a phantom overnight move (the recurring "SFTBY 又抽风" bug). They get
// NO extPrice — the same treatment dotted non-US listings (.L / .HK) get,
// and exactly the `NO_OVERNIGHT_SESSION` set `hasOvernightSession` encodes
// among US-shaped tickers. So the price reads flat outside the RTH session
// and live (regularMarketPrice) during it.
export function quotesRegularSessionOnly(ticker) {
  return isUsEquity(ticker) && !hasOvernightSession(ticker);
}

// Derived from the shared project constants rather than re-typed: a
// second hardcoded copy of the URL and anon key meant rotating the key
// (or pointing at another project) silently missed the entire live-price
// path while auth/data kept working.
const EDGE_PRICES_URL = `${SB_URL}/functions/v1/prices`;
const EDGE_ANON_KEY   = SB_ANON;

// Regular US session in exchange-local minutes-of-day — the same
// 9:30-16:00 window the prices Edge Function buckets candles by.
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

/**
 * Most recent candle close that sits OUTSIDE the regular session —
 * i.e. the current pre-market / after-hours price — or null when the
 * series has no extended-hours candle.
 *
 * This is how the proxy fallback recovers `extPrice`. It used to read
 * `meta.preMarketPrice ?? meta.postMarketPrice`, but Yahoo's v8/chart
 * `meta` no longer ships either field (verified 2026-08 across every
 * interval/range combination), so that expression was hard-null for
 * EVERY ticker. With the Extended Hours toggle on, a null extPrice
 * makes `extPriceIsRealAh` return false, and computeMetrics' ext
 * branch then forces the row to exactly 0.00 % — so whenever the app
 * fell back to the proxies, the whole US side of the board flatlined
 * at +0.00 % while crypto / non-US rows (which never take the ext
 * path) kept showing real moves. Deriving it from the candles instead
 * mirrors what the Edge Function does server-side.
 *
 * @param {number[]} timestamps unix seconds
 * @param {(number|null)[]} closes
 * @param {number} gmtOffsetSec exchange UTC offset, from `meta.gmtoffset`
 */
export function extPriceFromCandles(timestamps, closes, gmtOffsetSec) {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (close == null || !isFinite(close) || close <= 0) continue;
    const localMin = Math.floor(((((timestamps[i] + gmtOffsetSec) % 86400) + 86400) % 86400) / 60);
    if (localMin < RTH_OPEN_MIN || localMin >= RTH_CLOSE_MIN) return close;
  }
  return null;
}

// Parse one proxy's chart response into the quote shape fetchOneYahooChart
// returns, or null if the response isn't usable (bad status, non-chart
// body, or Yahoo has nothing for this symbol). Pulled out of the fetch
// loop so it can be shared verbatim between a losing and winning racer.
function parseOneYahooChart(res, symbol, proxyIdx) {
  if (!res.ok) return null;
  return res.json().then((data) => {
    // 200 + parseable JSON that isn't Yahoo's chart envelope — the proxy
    // substituted its own body (some free proxies serve their rate-limit /
    // error JSON with a 200). Bench it briefly so it doesn't keep winning
    // an attempt slot in every future race. (`chart` present but
    // result/meta missing is Yahoo itself answering "no data for this
    // symbol" — not the proxy's fault, so that path stays backoff-free.)
    if (!data?.chart) {
      markProxyDead(proxyIdx, 60_000);
      return null;
    }
    const result = data.chart.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    let lastPrice = meta.regularMarketPrice;
    if (lastPrice == null) return null;
    // `regularMarketPreviousClose` is absent from v8/chart meta (2026-08),
    // so the real source is `previousClose` — present on the intraday
    // request this path now makes. `chartPreviousClose` is the LAST
    // resort deliberately: on the old `interval=1d&range=5d` request it
    // was the close from the START of the 5-day window (NVDA: 195.04 vs
    // the correct 211.94), which silently turned every proxy-served
    // dayPct into a multi-day move.
    let prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? lastPrice;
    // Extended hours price: pre-market or after-hours (null if not
    // available), read off the intraday candles — see
    // extPriceFromCandles for why meta can't supply it.
    // For non-US tickers (any dotted-suffix symbol like `.L`, `.HK`, `.SS`,
    // `.DE`, etc.) the exchange-local 9:30-16:00 window is meaningless —
    // an LSE ticker's whole session would read as "extended hours" and
    // the ext-hours pct would show real LSE movement when the user
    // expects 0 (those exchanges have no US-style pre/after session).
    // Suppress, same as the Edge Function does.
    let extPrice  = (symbol.includes('.') || quotesRegularSessionOnly(symbol))
      ? null
      : extPriceFromCandles(
          result.timestamp,
          result.indicators?.quote?.[0]?.close,
          meta.gmtoffset ?? 0,
        );
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
  });
}

// Races every available proxy IN PARALLEL and resolves with the first
// usable quote — mirrors historical.js's fetchHistorical race. The
// previous version fell through the proxy list SEQUENTIALLY (one 8 s
// timeout at a time), so a single ticker's worst case was
// PROXIES.length × 8 s (≈40 s for 5 proxies) whenever the first few tried
// happened to be dead — the dominant contributor to "first refresh after
// opening the app takes tens of seconds" (proxy_chain.js's dead-proxy
// backoff is in-memory and resets on every page load, so a fresh tab
// always starts blind). Racing in parallel drops the worst case to
// ≈ the timeout of the slowest live proxy (8 s), matching the chart
// fallback's already-parallel design. Losing requests are aborted the
// moment a winner lands so they don't keep burning the proxies' rate
// limits in the background.
async function fetchOneYahooChart(symbol, { skipIfAllDead = false } = {}) {
  const nonce = Date.now();
  // 5m/1d, NOT 1d/5d. Daily candles carry no pre/post bars, so the
  // ext-hours price can't be recovered from them (and `meta` no longer
  // ships preMarketPrice/postMarketPrice at any interval). The daily
  // request also had no usable `previousClose` — only
  // `chartPreviousClose`, which on a 5-day window is the close from
  // FIVE sessions ago, so every proxy-served dayPct was a multi-day
  // move. The intraday request fixes both: real pre/post candles for
  // extPriceFromCandles, and a correct `previousClose`.
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=true&_=${nonce}`;

  // If every proxy is currently in backoff, race all of them anyway
  // rather than unconditionally returning null — the alternative freezes
  // this ticker's price for the rest of the session. EXCEPT inside a
  // multi-ticker fan-out (skipIfAllDead): there, "all proxies just got
  // benched" means an earlier wave of the same batch already proved
  // them dead moments ago, and re-racing them for every remaining
  // ticker turns one 8 s timeout wave into ceil(N/pool) sequential
  // ones — the batch caller passes skipIfAllDead so doomed waves fail
  // over to null instantly instead.
  const liveIndices = PROXIES.map((_, i) => i).filter((i) => proxyIsAvailable(i));
  if (liveIndices.length === 0 && skipIfAllDead) return null;
  const idxs = liveIndices.length > 0 ? liveIndices : PROXIES.map((_, i) => i);

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = idxs.length;
    /** @type {AbortController[]} */
    const controllers = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];

    const cleanup = () => {
      for (const c of controllers) {
        try { c.abort(); } catch (_) { /* already settled */ }
      }
      for (const t of timers) clearTimeout(t);
    };

    const settle = (quote, winnerIdx) => {
      if (resolved) return;
      if (quote) {
        resolved = true;
        if (winnerIdx != null) clearProxyBackoff(winnerIdx);
        cleanup();
        resolve(quote);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };

    for (const i of idxs) {
      const makeProxy = PROXIES[i];
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 8000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(makeProxy(yahooUrl), { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          if (!res.ok && (res.status === 429 || res.status === 403 || res.status >= 500)) {
            markProxyDead(i);
          }
          settle(await parseOneYahooChart(res, symbol, i), i);
        } catch (e) {
          clearTimeout(tid);
          // A winner elsewhere already called cleanup(), which aborts
          // every other in-flight request — that abort lands here too
          // and must NOT be mistaken for a genuine timeout/network error.
          // Without this guard, a perfectly healthy proxy that simply
          // lost the race gets blacklisted for a minute (Codex #201 P2).
          if (resolved) return;
          // Timeouts / network errors → shorter backoff (1 min); the proxy
          // may be transiently slow rather than rate-limiting us.
          markProxyDead(i, 60_000);
          settle(null);
        }
      })();
    }
  });
}

// Parse one proxy's eastmoney fundgz response into a quote, or null.
// Benches the proxy (via the returned 'bench' marker) when the body is
// a proxy-substituted HTML error page. Pulled out of the race loop so
// winning and losing racers share it verbatim.
function parseOneCNFund(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
  if (!m) {
    // eastmoney always answers in the jsonpgz(...) JSONP wrapper.
    // An HTML body here is a proxy's own error page served with a
    // 200 — bench it briefly (same rationale as the Yahoo-envelope
    // check above). A non-HTML mismatch could be eastmoney itself
    // misbehaving, so that stays backoff-free.
    return trimmed.startsWith("<") ? "bench" : null;
  }
  let obj;
  try { obj = JSON.parse(m[1]); } catch { return null; }
  const dwjz = parseFloat(obj.dwjz);
  if (!isFinite(dwjz) || dwjz <= 0) return null;
  const gsz = parseFloat(obj.gsz);
  const lastPrice = isFinite(gsz) && gsz > 0 ? gsz : dwjz;
  return {
    lastPrice, extPrice: null, prevClose: dwjz,
    currency: "CNY",
    dayPct: ((lastPrice - dwjz) / dwjz) * 100, extDayPct: null,
  };
}

// Fetch a single CN mutual fund (6-digit code) from eastmoney via CORS
// proxies, racing every available proxy in parallel — same shape as
// fetchOneYahooChart above. The previous SEQUENTIAL fall-through was
// the root cause of the "first refresh after opening takes ~20 s" bug:
// the prices Edge Function's fundgz upstream is intermittently
// geo-blocked from Deno egress IPs, so every response omitted the CN
// fund, and this fallback then walked the proxy list one 8 s timeout
// at a time (free Western proxies rarely reach eastmoney at all). On a
// fresh page the in-memory backoff is empty, so every cold open paid
// the full gauntlet again — exactly matching "reopen = slow again,
// in-page refresh = fast" (in-page runs skip the already-benched
// proxies).
async function fetchOneCNFund(code, { skipIfAllDead = false } = {}) {
  const eastmoneyUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;
  const liveIndices = PROXIES.map((_, i) => i).filter((i) => proxyIsAvailable(i));
  if (liveIndices.length === 0 && skipIfAllDead) return null;
  const idxs = liveIndices.length > 0 ? liveIndices : PROXIES.map((_, i) => i);

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = idxs.length;
    /** @type {AbortController[]} */
    const controllers = [];
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];

    const cleanup = () => {
      for (const c of controllers) {
        try { c.abort(); } catch (_) { /* already settled */ }
      }
      for (const t of timers) clearTimeout(t);
    };

    const settle = (quote, winnerIdx) => {
      if (resolved) return;
      if (quote) {
        resolved = true;
        if (winnerIdx != null) clearProxyBackoff(winnerIdx);
        cleanup();
        resolve(quote);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };

    for (const i of idxs) {
      const makeProxy = PROXIES[i];
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 8000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(makeProxy(eastmoneyUrl), { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          if (!res.ok) {
            if (res.status === 429 || res.status === 403 || res.status >= 500) markProxyDead(i);
            settle(null);
            return;
          }
          const parsed = parseOneCNFund(await res.text());
          if (parsed === "bench") {
            markProxyDead(i, 60_000);
            settle(null);
            return;
          }
          settle(parsed, i);
        } catch {
          clearTimeout(tid);
          // A winner's cleanup() aborts the other in-flight racers —
          // don't mistake that for a genuine timeout (same guard as
          // fetchOneYahooChart above).
          if (resolved) return;
          markProxyDead(i, 60_000);
          settle(null);
        }
      })();
    }
  });
}

// Last-good CN-fund quotes from the background proxy fallback, keyed by
// fund code. A mutual fund NAV changes once per trading day, so a
// 20-minute-old quote is effectively live — plenty fresh to bridge the
// gap while the Edge Function's fundgz upstream is geo-blocked.
const CN_FUND_QUOTE_TTL_MS = 20 * 60_000;
/** @type {Map<string, {ts: number, quote: any}>} */
const cnFundQuoteCache = new Map();
/** @type {Map<string, Promise<any>>} */
const cnFundInflight = new Map();
// Cooldown between background attempts per fund. The race falls back
// to probing even benched proxies (same as fetchOneYahooChart), so
// without this the 30 s auto-tick would re-hammer all five proxies
// every tick for as long as the Edge response stays fund-less.
const CN_FUND_RETRY_COOLDOWN_MS = 60_000;
/** @type {Map<string, number>} */
const cnFundLastAttempt = new Map();

// Kick off (or join) a background proxy fetch for a CN fund the Edge
// response omitted. Deliberately NOT awaited by the refresh path — the
// whole point is that one unreachable fund must never hold the other
// 29 fresh quotes (and the refresh spinner) hostage. A success lands in
// cnFundQuoteCache and is merged into the NEXT refresh tick's result.
function refreshCNFundInBackground(code) {
  if (cnFundInflight.has(code)) return;
  if (Date.now() - (cnFundLastAttempt.get(code) || 0) < CN_FUND_RETRY_COOLDOWN_MS) return;
  cnFundLastAttempt.set(code, Date.now());
  // skipIfAllDead: this fetch is opportunistic — when every proxy is
  // benched, skip the doomed race and let the cooldown retry once the
  // benches start expiring.
  const p = fetchOneCNFund(code, { skipIfAllDead: true })
    .then((quote) => {
      if (quote) cnFundQuoteCache.set(code, { ts: Date.now(), quote });
    })
    .catch(() => { /* proxies exhausted — keep whatever cache we have */ })
    .finally(() => { cnFundInflight.delete(code); });
  cnFundInflight.set(code, p);
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
    // SFTBY-shape OTC ADRs: drop the Edge's raw Yahoo postMarketPrice so
    // the phantom "after-hours" move can't reach the scoreboard / cards /
    // modal. The proxy fallback path (fetchOneYahooChart) suppresses it
    // the same way; this covers the primary Edge path.
    if (quotesRegularSessionOnly(t)) { r.extPrice = null; r.extDayPct = null; }
    if (/^\d{6}$/.test(t) && r.currency == null) r.currency = "CNY";
    else if (/\.L$/i.test(t)) {
      // Legacy-deploy compatibility: the current prices Edge Function
      // tags every quote with `currency` and already converts GBp→GBP
      // server-side, so this branch is dead against a current deploy.
      // A currency-less .L quote can only come from a pre-currency
      // Edge build (or a rollback), where values are raw Yahoo pence —
      // /100 unconditionally; most London listings trade at hundreds
      // of pence so treating them as GBP would be off by 100×.
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
  const cnFunds = liveTickers.filter(t => /^\d{6}$/.test(t));
  const hasCNFund = cnFunds.length > 0;
  if (hasCNFund) {
    // Edge Function first — it covers CN funds (fundgz with lsjz /
    // danjuanapp fallbacks server-side) so the happy path needs zero
    // CORS-proxy traffic. When the Edge response still omits a CN fund
    // (every server upstream failed), the proxy fallback runs in the
    // BACKGROUND: the refresh returns the fresh quotes it has right
    // away and the fund's quote (if a proxy ever gets one) is cached
    // and merged into the next tick. Awaiting the proxies here is what
    // used to stall the whole first refresh ~20 s — one geo-blocked
    // fund held 29 live quotes and the spinner hostage, on every cold
    // open (the in-memory proxy backoff resets per page load, so only
    // in-page refreshes were fast).
    const edgeResult = normalizeEdgeResult(await fetchViaEdge(liveTickers));
    if (edgeResult && cnFunds.every(t => edgeResult[t])) return edgeResult;
    const missingCn = cnFunds.filter(t => !edgeResult?.[t]);
    const out = { ...(edgeResult || {}) };
    for (const t of missingCn) {
      const cached = cnFundQuoteCache.get(t);
      if (cached && Date.now() - cached.ts < CN_FUND_QUOTE_TTL_MS) out[t] = cached.quote;
      refreshCNFundInBackground(t);
    }
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
  // Partial Edge response — narrow the proxy retry to JUST the tickers
  // Edge omitted, instead of either trusting the omissions (the old
  // policy, which produced the recurring "FX MISSING" pill the user
  // hit whenever Yahoo dropped GBPUSD=X for a single tick) or
  // re-fetching everything via proxy (which would shred the proxy
  // chain's rate limits). The proxies hit the same Yahoo upstream so
  // a non-transient miss still won't recover, but Yahoo's per-ticker
  // drops are mostly transient (the next refresh tick already has
  // them back) and a quick retry catches them before the silent 1:1
  // USD fallback in fxRateToUSD propagates into the portfolio total.
  const missing = edgeResult
    ? liveTickers.filter(t => !edgeResult[t])
    : liveTickers;
  if (missing.length === 0 && edgeResult) return edgeResult;
  const proxyPairs = await mapWithConcurrency(missing, 6, async (t) =>
    [t, await fetchOneYahooChart(t, { skipIfAllDead: missing.length > 1 })]);
  const out = { ...(edgeResult || {}) };
  for (const [t, r] of proxyPairs) if (r) out[t] = r;
  return Object.keys(out).length > 0 ? out : null;
}

// A tick that came back with only a fraction of the requested quotes is
// an outage, not a live refresh. Below this share of the requested
// tickers we report `error` so the header pill shows the failure and
// the caller's 3 s retry kicks in.
const LIVE_COVERAGE_MIN = 0.5;

export async function refreshPrices(portfolio) {
  const tickers = Object.keys(portfolio.holdings);
  const result = await fetchYahoo(tickers);
  if (!result || Object.keys(result).length === 0) {
    return { updates: {}, source: "error", coverage: { got: 0, wanted: 0 } };
  }
  // Tickers fetchYahoo actually tries — the same filter it applies
  // internally, so cash / `.PVT` placeholders don't count as misses.
  const wanted = tickers.filter(
    (t) => !t.endsWith(".PVT") && t !== "CASH" && !portfolio.holdings[t]?.isCash,
  );
  const got = wanted.filter((t) => result[t]).length;
  // Surfaced in the sidebar footer. "How many of my holdings actually
  // got a quote this tick" is the single number that separates "the
  // market is flat" from "the fetch is broken" — without it a board
  // full of 0.00 % is unattributable from the outside.
  const coverage = { got, wanted: wanted.length };
  // Why this exists: with a CN fund in the book, a totally unreachable
  // Edge Function still produced a "successful" tick — the fund's
  // background proxy cache supplied ONE quote, `fetchYahoo` returned
  // that single-entry object, and the board went LIVE / "Last updated
  // 2 s" while all 25 other holdings silently kept their previous
  // values. The prices looked frozen but nothing surfaced the outage.
  if (wanted.length > 0 && got / wanted.length < LIVE_COVERAGE_MIN) {
    return { updates: result, source: "error", coverage };
  }
  return { updates: result, source: "live", coverage };
}

export async function fetchTickers(tickers) {
  return fetchYahoo(tickers.filter(Boolean));
}

// Fetch current TTM P/E + EPS for the given tickers via the
// `fundamentals` Edge Function. Returns
//   { NVDA: { pe: 30.5, eps: 6.5 }, … }
// with tickers that have no meaningful fundamentals (futures /
// indices / ETFs / crypto / .PVT / 6-digit CN funds) simply absent.
//
// Pass `{ ttmEpsHistory: true }` to also receive `ttmEpsHistory` AND
// `ttmSalesHistory` on each entry — `[{date, eps:<TTM value>}, …]`,
// pre-summed TTM at each quarter end from Yahoo's
// fundamentals-timeseries (5+ yrs): diluted EPS for the P/E chart,
// revenue rescaled to sales-per-share for the P/S chart. Used by the
// ratio chart modals so the historical P/E and P/S lines step when
// an earnings report changes the denominator, instead of being a 1:1
// scaled copy of the price chart.
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

// Exported for historical.js so it can build the Edge `/chart` URL
// off the same base + anon key without duplicating constants.
export { EDGE_PRICES_URL, EDGE_ANON_KEY };
