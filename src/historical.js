// Historical-data fetch: daily / intraday closes for chart rendering.
// The Supabase Edge Function /functions/v1/chart batches everything
// server-side; the per-ticker CORS-proxy chain only kicks in when
// Edge itself errored out (function not deployed, network blip).
//
// 6-digit numeric tickers (Chinese mutual funds) take a different
// path entirely — eastmoney / pingzhongdata aren't on Yahoo, so the
// proxy fallback races danjuanapp.com + xueqiu.com endpoints instead.
//
// Split from utils.js to keep the chart-data pipeline together with
// its CN-fund variants; consumers still import from utils.js for now
// via the barrel re-exports.

import {
  PROXIES,
  proxyIsAvailable,
  markProxyDead,
  clearProxyBackoff,
} from './proxy_chain.js';
import { usMarketHoursUtc } from './market_hours.js';
import { EDGE_PRICES_URL, EDGE_ANON_KEY } from './yahoo_fetch.js';

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

  // Skip backed-off proxies; fall back to all if every one is dead
  // (better to retry a maybe-recovered host than freeze CN-fund history
  // until the user reloads).
  const liveIndices = PROXIES.map((_, i) => i).filter((i) => proxyIsAvailable(i));
  const idxs = liveIndices.length > 0 ? liveIndices : PROXIES.map((_, i) => i);
  const attempts = [];
  for (const i of idxs) {
    attempts.push({ proxyIdx: i, url: PROXIES[i](djUrl), parse: parseDanjuan });
    attempts.push({ proxyIdx: i, url: PROXIES[i](xqUrl), parse: parseXueqiu });
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
    const settle = (data, winnerIdx) => {
      if (resolved) return;
      if (data) {
        resolved = true;
        if (winnerIdx != null) clearProxyBackoff(winnerIdx);
        cleanup();
        resolve(data);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };
    for (const { proxyIdx, url, parse } of attempts) {
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 4000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(url, { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          if (!res.ok && (res.status === 429 || res.status === 403 || res.status >= 500)) {
            markProxyDead(proxyIdx);
          }
          settle(await parse(res), proxyIdx);
        } catch (_) {
          clearTimeout(tid);
          markProxyDead(proxyIdx, 60_000);
          settle(null);
        }
      })();
    }
  });
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

  // Filter out proxies currently in backoff. If they're all dead, fall
  // back to ALL of them — the alternative is unconditionally returning
  // null, which would freeze chart data across the whole session.
  const liveIndices = PROXIES.map((_, i) => i).filter((i) => proxyIsAvailable(i));
  const idxs = liveIndices.length > 0 ? liveIndices : PROXIES.map((_, i) => i);

  return new Promise((resolve) => {
    let resolved = false;
    let remaining = idxs.length;
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

    const settle = (data, winnerIdx) => {
      if (resolved) return;
      if (data) {
        resolved = true;
        if (winnerIdx != null) clearProxyBackoff(winnerIdx);
        cleanup();
        resolve(data);
      } else if (--remaining === 0) {
        resolve(null);
      }
    };
    for (const i of idxs) {
      const makeProxy = PROXIES[i];
      const controller = new AbortController();
      controllers.push(controller);
      const tid = setTimeout(() => controller.abort(), 4000);
      timers.push(tid);
      (async () => {
        try {
          const res = await fetch(makeProxy(yahooUrl), { cache: "no-store", signal: controller.signal });
          clearTimeout(tid);
          if (!res.ok && (res.status === 429 || res.status === 403 || res.status >= 500)) {
            markProxyDead(i);
          }
          settle(await parseResponse(res), i);
        } catch (_) {
          clearTimeout(tid);
          markProxyDead(i, 60_000);
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
