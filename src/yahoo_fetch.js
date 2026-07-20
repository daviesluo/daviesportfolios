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
} from './proxy_chain.js';
import { isUsEquity, hasOvernightSession } from './ticker_class.js';

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

const EDGE_PRICES_URL = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/prices";
const EDGE_ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";

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
    let prevClose = meta.regularMarketPreviousClose ?? meta.previousClose ?? meta.chartPreviousClose ?? lastPrice;
    // Extended hours price: pre-market or after-hours (null if not available).
    // For non-US tickers (any dotted-suffix symbol like `.L`, `.HK`, `.SS`,
    // `.DE`, etc.) Yahoo's `preMarketPrice` / `postMarketPrice` reflect the
    // local exchange's live intraday quote rather than a US-style ext-hours
    // session — for example a .L ticker during US pre-market still has LSE
    // open, so `preMarketPrice` is the live LSE price and the ext-hours pct
    // shows real LSE movement when the user expects 0 (those exchanges
    // don't have an after-hours / pre-market session). Suppress.
    let extPrice  = (symbol.includes('.') || quotesRegularSessionOnly(symbol))
      ? null
      : (meta.preMarketPrice ?? meta.postMarketPrice ?? null);
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
async function fetchOneYahooChart(symbol) {
  const nonce = Date.now();
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true&_=${nonce}`;

  // If every proxy is currently in backoff, race all of them anyway
  // rather than unconditionally returning null — the alternative freezes
  // this ticker's price for the rest of the session.
  const liveIndices = PROXIES.map((_, i) => i).filter((i) => proxyIsAvailable(i));
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

// Fetch a single CN mutual fund (6-digit code) from eastmoney via CORS proxies.
// Used as a fallback when the Edge Function is not yet updated to handle CN funds.
async function fetchOneCNFund(code) {
  const eastmoneyUrl = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;
  for (let i = 0; i < PROXIES.length; i++) {
    if (!proxyIsAvailable(i)) continue;
    const makeProxy = PROXIES[i];
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(makeProxy(eastmoneyUrl), { cache: "no-store", signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) {
        if (res.status === 429 || res.status === 403 || res.status >= 500) markProxyDead(i);
        continue;
      }
      const text = (await res.text()).trim();
      const m = text.match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
      if (!m) {
        // eastmoney always answers in the jsonpgz(...) JSONP wrapper.
        // An HTML body here is a proxy's own error page served with a
        // 200 — bench it briefly (same rationale as the Yahoo-envelope
        // check above). A non-HTML mismatch could be eastmoney itself
        // misbehaving, so that stays backoff-free.
        if (text.startsWith("<")) markProxyDead(i, 60_000);
        continue;
      }
      let obj;
      try { obj = JSON.parse(m[1]); } catch { continue; }
      const dwjz = parseFloat(obj.dwjz);
      if (!isFinite(dwjz) || dwjz <= 0) continue;
      const gsz = parseFloat(obj.gsz);
      const lastPrice = isFinite(gsz) && gsz > 0 ? gsz : dwjz;
      clearProxyBackoff(i);
      return {
        lastPrice, extPrice: null, prevClose: dwjz,
        currency: "CNY",
        dayPct: ((lastPrice - dwjz) / dwjz) * 100, extDayPct: null,
      };
    } catch {
      clearTimeout(tid);
      markProxyDead(i, 60_000);
    }
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
  const proxyPairs = await Promise.all(missing.map(async (t) => [t, await fetchOneYahooChart(t)]));
  const out = { ...(edgeResult || {}) };
  for (const [t, r] of proxyPairs) if (r) out[t] = r;
  return Object.keys(out).length > 0 ? out : null;
}

export async function refreshPrices(portfolio) {
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
