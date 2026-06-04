// Supabase Edge Function: fundamentals (rev: Yahoo-crumb)
//
// Returns current TTM P/E + trailing EPS (+ P/S, PEG, ttmEpsHistory,
// ttmSalesHistory) for a list of tickers from two sources, picked by
// symbol:
//
//   1. Individual stocks → Yahoo `quoteSummary` (primary; pe / eps /
//      ps / forwardPE / earningsTrend, all USD-correct for ADRs),
//      with Finnhub `/stock/metric` as the fallback when Yahoo is
//      unreachable. Yahoo's quoteSummary now requires a crumb token
//      — see _yahoo.ts:getYahooCrumb for the cookie→crumb handshake.
//
//   2. Four big US indices (^GSPC / ^NDX / ^RUT / ^SOX) → Alpha
//      Vantage `OVERVIEW` against ETF proxies (SPY / QQQ / IWM /
//      SOXX), with a 24 h server-side cache in
//      `index_fundamentals_cache`. AV's free tier enforces a hard
//      "1 request per second" pace plus a 25 / day total — so the
//      cache + serial dispatch (1.2 s between calls in this Edge
//      Function invocation) keep us comfortably inside both ceilings
//      with a 4-ETF working set.
//
// Layered fallback for index P/E (newest → oldest data):
//   a. Fresh cache (< 24 h)               — almost every request
//   b. Live Alpha Vantage                 — once per ETF per 24 h
//   c. Stale cache (any age, last-known)  — when AV is rate-limited
//   d. Hardcoded INDEX_PE_FALLBACK        — first deploy / total outage
//
// 3-year-average P/E is hardcoded since AV's free tier doesn't
// expose historical annuals; refresh ~yearly.
//
// FMP was the primary source for individual-stock P/E during the ADR
// currency-fix saga, but FMP retired its `/v3/` endpoints for
// post-2025-08-31 keys and paywalled the `/stable/` replacements, so
// the whole FMP layer was removed — Yahoo quoteSummary (with crumb)
// is the only remaining free source for ADR-correct ratios + PEG.
//
// File layout: this file is the HTTP dispatcher + the small
// orchestration logic in `fetchStockFundamentals`. Everything else
// (cache layer, AV path, Yahoo path, Finnhub path, math helpers)
// lives in sibling `_*.ts` modules. Pure helpers are re-exported
// at the bottom so `index.test.ts` keeps importing them from here.
//
// Env:
//   FINNHUB_API_KEY            (individual-stock P/E fallback)
//   ALPHAVANTAGE_API_KEY       (index P/E)
//   SUPABASE_URL               (auto-injected; cache layer)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; cache layer)
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13, peg: 1.4, ps: 25 },
//     ^GSPC: { pe: 27.5,  eps: 0,    pe3yAvg: 25.0 }
//   }

import {
  CORS,
  INDEX_ETF_PROXY,
  isFundamentalsTicker,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  type Fundamentals,
} from "./_shared.ts";
import {
  readCachedStockFundamentals,
  writeCachedStockFundamentals,
  STOCK_CACHE_TTL_MS,
} from "./_caches.ts";
import { resolveIndexPe } from "./_alphavantage.ts";
import {
  fetchYahooQuoteSummary,
  fetchYahooChartPrice,
  fetchYahooTrailingEpsHistory,
  fetchYahooQuarterlyRevenue,
} from "./_yahoo.ts";
import { fetchFinnhub, fetchFinnhubEarningsHistory } from "./_finnhub.ts";
import {
  computePeg,
  pickPsFields,
  rollingTtmFromRawQuarterly,
  normalizeEpsHistoryToUsd,
} from "./_math.ts";

// Re-export the pure helpers + isFundamentalsTicker for index.test.ts
// (the test file imports them from "./index.ts" — keeping that surface
// stable means tests don't need to update with this refactor).
export {
  computeForwardGrowth,
  computePeg,
  pickPsFields,
  rollingTtmFromRawQuarterly,
  normalizeEpsHistoryToUsd,
  computePe3yAvg,
} from "./_math.ts";
export { isFundamentalsTicker } from "./_shared.ts";

/**
 * Combined fundamentals for a single stock symbol. Yahoo's
 * quoteSummary is the primary source for `pe` / `eps` / `ps` /
 * `forwardPE` / `epsGrowthFwd` because it handles ADR currency
 * normalization correctly (TSM/SFTBY return sane ~26 / ~15 instead
 * of Finnhub's 1.22 / 0.07). Finnhub runs in parallel for
 * `pe3yAvg` / `ps3yAvg` (its `series.annual.*` is the only free
 * historical-annual data we have) and as the whole-row fallback
 * when Yahoo's crumb handshake fails or it's rate-limited — which
 * is fine for US-listed stocks where Finnhub doesn't have the
 * currency-mismatch bug.
 */
export async function fetchStockFundamentals(
  symbol: string,
): Promise<Fundamentals | null> {
  const [yahoo, finn] = await Promise.all([
    fetchYahooQuoteSummary(symbol),
    fetchFinnhub(symbol),
  ]);
  if (yahoo) {
    // pe / eps both = 0 → loss-maker / no-earnings case. Surface the
    // row anyway so the client can show the P/S YTD view (ps still
    // populated) instead of hiding the chart entirely. `pickPsFields`
    // cross-checks Yahoo vs Finnhub P/S and drops Finnhub's
    // `ps3yAvg` reference line when they disagree (ADR currency
    // mismatch). PEG = Yahoo's forwardPE ÷ its blended forward EPS
    // growth — see computePeg.
    const { ps, ps3yAvg } = pickPsFields(yahoo.ps, finn?.ps, finn?.ps3yAvg);
    const peg = computePeg(yahoo.forwardPE, yahoo.epsGrowthFwd);
    return {
      pe: yahoo.pe,
      eps: yahoo.eps,
      price: yahoo.price,
      pe3yAvg: finn?.pe3yAvg ?? null,
      ps,
      ps3yAvg,
      peg: peg ?? undefined,
      sharesOutstanding: yahoo.sharesOutstanding > 0 ? yahoo.sharesOutstanding : undefined,
      // Only populate when Yahoo published a usable date — keeps the
      // payload compact for the (many) tickers without scheduled
      // earnings (newly listed, ETFs, indices) and lets the client
      // filter with a simple `if (f.earningsDate)`.
      earningsDate: yahoo.earningsDateSec > 0 ? yahoo.earningsDateSec : undefined,
      earningsTime: yahoo.earningsTime ?? undefined,
    };
  }
  return finn;
}

// ---- HTTP entry -----------------------------------------------------

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the top-level try/catch wrap so a runtime
// crash here becomes a row the admin ⚠ badge surfaces instead of a
// silent 500. Best-effort: never throws.
async function reportServerError(
  kind: string,
  opts: { message?: string; symbol?: string; context?: unknown } = {},
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ops_errors`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        kind,
        symbol: opts.symbol ?? null,
        message: opts.message ? opts.message.slice(0, 512) : null,
        context: opts.context ?? null,
        ip: "edge",
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (e) {
    console.error("reportServerError failed:", String(e));
  }
}

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS });
    }
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const param = url.searchParams.get("tickers") ?? "";
    // Opt-in flag — when "true" each entry also gets a `ttmEpsHistory`
    // array (Yahoo trailingDilutedEPS, 5+ yrs). Off by default since
    // every other caller (heatmap badges, etc.) just needs the current
    // TTM P/E and shouldn't pay the extra round-trip per ticker. The
    // flag name is intentionally distinct from #64's `epsHistory` so a
    // mixed-version state (new client + old Edge Function, or vice
    // versa, or a SW-cached old response) cleanly degrades to const-EPS
    // instead of mixing raw-quarterly and TTM semantics.
    const includeEpsHistory = url.searchParams.get("ttmEpsHistory") === "true";
    // Cap the fan-out — each stock can trigger several upstream calls
    // (Yahoo quoteSummary + chart + Finnhub), so an unbounded list is an
    // amplification vector. 100 is far above the app's working set.
    const MAX_TICKERS = 100;
    const tickers = param
      .split(",")
      .map((t) => t.trim())
      .filter(isFundamentalsTicker)
      .slice(0, MAX_TICKERS);
    if (tickers.length === 0) {
      return new Response(JSON.stringify({}), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Split into stocks (Finnhub, can run with parallelism 6) and
    // indices (AV, must be serial). Run them concurrently with each
    // other — they hit different vendors with independent rate caps.
    const indexSymbols = tickers.filter((t) => t in INDEX_ETF_PROXY);
    const stockSymbols = tickers.filter((t) => !(t in INDEX_ETF_PROXY));
    const out: Record<string, Fundamentals> = {};

    const stocksTask = (async () => {
      const queue = [...stockSymbols];
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length > 0) {
          const t = queue.shift();
          if (!t) break;
          // Cache-first: 2 h TTL for the full per-stock Fundamentals
          // payload. Without this, a 30-ticker page load with the P/E
          // chart open burns ~120 Yahoo calls (4/stock); with it, the
          // first call after expiry pays the cost and the next 2 h of
          // visitors share the cached row.
          const cached = await readCachedStockFundamentals(t, includeEpsHistory);
          if (cached && cached.ageMs < STOCK_CACHE_TTL_MS) {
            out[t] = cached.payload;
            continue;
          }
          const f = await fetchStockFundamentals(t);
          if (!f) continue;
          if (includeEpsHistory) {
            // Two TTM per-share histories for the ratio charts, from
            // Yahoo's fundamentals-timeseries, fetched in parallel:
            //   - trailingDilutedEPS    -> ttmEpsHistory   (P/E chart)
            //   - quarterlyTotalRevenue -> ttmSalesHistory (P/S chart)
            // EPS: `trailingDilutedEPS` is already a TTM series; on
            // Yahoo failure it falls back to Finnhub raw quarterly EPS
            // summed to a single TTM point. Sales: `quarterlyTotalRevenue`
            // is RAW quarterly, rolled into a TTM series here — the
            // revenue-side `trailingTotalRevenue` type ships too few /
            // inconsistently-placed points for the P/S chart to step
            // within a YTD window (see fetchYahooQuarterlyRevenue).
            const [epsHistRaw, quarterlyRev] = await Promise.all([
              fetchYahooTrailingEpsHistory(t),
              fetchYahooQuarterlyRevenue(t),
            ]);
            let hist = epsHistRaw;
            if (!hist) {
              const raw = await fetchFinnhubEarningsHistory(t);
              if (raw) hist = rollingTtmFromRawQuarterly(raw);
            }
            const salesHist = quarterlyRev ? rollingTtmFromRawQuarterly(quarterlyRev) : null;
            // USD price for rescaling BOTH histories. Priority:
            //   1. Yahoo quoteSummary `price` — USD-correct for ADRs
            //      (the consumer site has to show coherent numbers).
            //   2. Yahoo chart-endpoint `meta.regularMarketPrice` —
            //      needs no crumb, answers anon callers including ADRs;
            //      one extra HTTP call only when (1) is missing.
            // When neither is available the EPS rescale falls back to
            // f.eps (its ±20% guard then no-ops) and the sales history
            // is skipped — the client then uses the const-denominator
            // path for P/S, same as before this field existed.
            let usdPrice = (f.price && f.price > 0) ? f.price : 0;
            if (usdPrice === 0 && (f.pe > 0 || (f.ps && f.ps > 0))) {
              const chartPrice = await fetchYahooChartPrice(t);
              if (chartPrice > 0) usdPrice = chartPrice;
            }
            // TTM-EPS history -> USD: usdAnchor is the current USD TTM
            // EPS (price / pe), falling back to f.eps when no price/pe
            // pair is available.
            let usdAnchor = f.eps;
            if (usdPrice > 0 && f.pe > 0) usdAnchor = usdPrice / f.pe;
            if (hist) f.ttmEpsHistory = normalizeEpsHistoryToUsd(hist, usdAnchor);
            // TTM-sales history -> USD sales-per-share, same mechanism:
            // the rolled quarterly-revenue TTM series rescaled so the
            // latest point lands on the current USD sales-per-share
            // (price / ps). The relative quarterly revenue-growth shape
            // is what makes the P/S chart step on earnings instead of
            // tracking price 1:1. (Share count is assumed ~flat across
            // the window — fine within a YTD chart.)
            if (salesHist && usdPrice > 0 && f.ps && f.ps > 0) {
              f.ttmSalesHistory = normalizeEpsHistoryToUsd(salesHist, usdPrice / f.ps);
            }
          }
          // Strip the internal `price` field — used above as the USD
          // anchor source; not part of the public response contract.
          if ('price' in f) delete f.price;
          out[t] = f;
          // Best-effort cache write — fire-and-forget so the response
          // path isn't blocked on a slow PostgREST write.
          writeCachedStockFundamentals(t, includeEpsHistory, f).catch(() => {});
        }
      });
      await Promise.all(workers);
    })();

    const indicesTask = (async () => {
      const avBlocked = { value: false };
      const isFirstAvCall = { value: true };
      for (const t of indexSymbols) {
        const f = await resolveIndexPe(t, avBlocked, isFirstAvCall);
        if (f) out[t] = f;
      }
    })();

    await Promise.all([stocksTask, indicesTask]);

    return new Response(JSON.stringify(out), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("fundamentals.unhandled", { message: msg });
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
