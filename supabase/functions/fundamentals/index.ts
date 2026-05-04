// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers from
// two sources, picked by symbol:
//
//   1. Individual stocks → Finnhub `/stock/metric` (free tier:
//      60 calls / minute, no payment info on free tier). Yahoo's
//      v7/quote and v10/quoteSummary were crumb-gated to a degree
//      Deno Deploy egress IPs couldn't reliably bootstrap.
//
//   2. Four big US indices (^GSPC / ^NDX / ^RUT / ^SOX) → Alpha
//      Vantage `OVERVIEW` against ETF proxies (SPY / QQQ / IWM /
//      SOXX), with a 24 h server-side cache in
//      `index_fundamentals_cache` so we never burn more than ~4
//      Alpha Vantage calls per day no matter how many clients hit
//      this Edge Function. Alpha Vantage free tier is 25 req / day,
//      so the cache headroom is ~6× even with refresh storms.
//      Tried in order before settling on AV: Finnhub free (zero
//      fundamentals on ETFs); FMP free /stable (paywalls QQQ/IWM and
//      lacks `pe` on SPY); Yahoo /v8/chart meta (no P/E in meta).
//
// 3-year-average P/E is hardcoded for indices (`INDEX_PE_3Y_AVG`)
// since it changes slowly — refresh once a year via a normal commit.
// Current trailing P/E is dynamic and comes from the Alpha Vantage
// path above.
//
// Env:
//   FINNHUB_API_KEY            (required for individual-stock P/E)
//   ALPHAVANTAGE_API_KEY       (required for index P/E)
//   SUPABASE_URL               (auto-injected; used by cache layer)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; used by cache layer)
//
// If a key is missing the Edge Function quietly skips the
// corresponding tickers — they're absent from the response and the
// client treats that as "no P/E available", hiding the button.
//
// Used by the ticker chart modal's "P/E YTD" view. Stocks divide each
// YTD daily-close by the EPS returned here. Indices return eps:0 and
// the client reconstructs an implied EPS from `lastClose / pe` so
// the historical price series can still be divided into P/E values.
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13 },
//     ^GSPC: { pe: 27.5,  eps: 0,    pe3yAvg: 25.0 }
//   }

const FINNHUB_API_KEY            = Deno.env.get("FINNHUB_API_KEY") ?? "";
const ALPHAVANTAGE_API_KEY       = Deno.env.get("ALPHAVANTAGE_API_KEY") ?? "";
const SUPABASE_URL               = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number; pe3yAvg: number | null };

// Index → ETF proxy. Alpha Vantage's OVERVIEW endpoint is
// company/security-scoped and doesn't accept index symbols directly,
// so we look up the ETF that tracks each index and use its P/E as a
// stand-in for the underlying basket. Response is keyed back under
// the original index symbol.
const INDEX_ETF_PROXY: Record<string, string> = {
  "^GSPC": "SPY",   // S&P 500
  "^NDX":  "QQQ",   // NASDAQ 100
  "^RUT":  "IWM",   // Russell 2000
  "^SOX":  "SOXX",  // PHLX Semiconductor
};

// 3Y-AVG P/E hardcoded since AV's OVERVIEW doesn't expose historical
// annuals on the free tier. These move slowly (single-digit % per
// year) so a yearly commit refresh is fine. LAST REFRESHED:
// 2026-05-04. Sources: macrotrends.net per-index PE history pages.
const INDEX_PE_3Y_AVG: Record<string, number> = {
  "^GSPC": 25.0,
  "^NDX":  30.0,
  "^RUT":  24.0,
  "^SOX":  35.0,
};

// Hardcoded current-PE fallback used only when both the cache table
// and Alpha Vantage are unavailable (e.g. AV rate-limited, cache
// schema not migrated, network blip). Same numbers can drift up to
// a couple of points over a quarter — refresh quarterly, but the
// Alpha Vantage path normally serves a fresher value anyway.
const INDEX_PE_FALLBACK: Record<string, number> = {
  "^GSPC": 27.5,
  "^NDX":  33.0,
  "^RUT":  28.0,
  "^SOX":  40.0,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---- Cache layer (Supabase REST against the table created in
// migration 0003_index_fundamentals_cache.sql) -------------------

async function readCachedPe(etfSymbol: string): Promise<number | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/index_fundamentals_cache` +
      `?symbol=eq.${encodeURIComponent(etfSymbol)}&select=pe,fetched_at`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    const fetchedAt = new Date(row?.fetched_at).getTime();
    if (!isFinite(fetchedAt) || (Date.now() - fetchedAt) > CACHE_TTL_MS) return null;
    const pe = Number(row?.pe);
    return isFinite(pe) && pe > 0 ? pe : null;
  } catch {
    return null;
  }
}

async function writeCachedPe(etfSymbol: string, pe: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/index_fundamentals_cache`;
    await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        // Upsert behaviour — overwrite the row keyed by `symbol`
        // instead of conflicting on the primary key.
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        symbol: etfSymbol,
        pe,
        fetched_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* best effort — cache miss next time is harmless */ }
}

// ---- Alpha Vantage --------------------------------------------------

async function fetchAlphaVantageEtfPe(etfSymbol: string): Promise<{ pe: number | null, debug?: any }> {
  if (!ALPHAVANTAGE_API_KEY) return { pe: null, debug: { stage: 'no-key' } };
  const url = `https://www.alphavantage.co/query?function=OVERVIEW` +
    `&symbol=${encodeURIComponent(etfSymbol)}` +
    `&apikey=${encodeURIComponent(ALPHAVANTAGE_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '<read failed>');
      return { pe: null, debug: { stage: 'av-not-ok', status: res.status, body: bodyText.slice(0, 300) } };
    }
    const data = await res.json();
    const pe = Number(data?.PERatio);
    if (isFinite(pe) && pe > 0) return { pe };
    // Couldn't extract a usable PE — surface the response shape so we
    // can tell whether AV returned an error envelope, a "None" string,
    // or a totally different field set for ETFs.
    return { pe: null, debug: { stage: 'av-no-pe', dataKeys: Object.keys(data ?? {}).slice(0, 30), peRaw: data?.PERatio, sample: typeof data === 'object' && data !== null ? Object.fromEntries(Object.entries(data).slice(0, 5)) : data } };
  } catch (e) {
    return { pe: null, debug: { stage: 'av-throw', err: String(e).slice(0, 200) } };
  }
}

async function fetchIndexPe(indexSymbol: string): Promise<any> {
  const etf = INDEX_ETF_PROXY[indexSymbol];
  if (!etf) return null;
  const cached = await readCachedPe(etf);
  if (cached) {
    return { pe: cached, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, _source: 'cache' };
  }
  const av = await fetchAlphaVantageEtfPe(etf);
  if (av.pe) {
    await writeCachedPe(etf, av.pe);
    return { pe: av.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, _source: 'av' };
  }
  const fallback = INDEX_PE_FALLBACK[indexSymbol];
  if (fallback) {
    return { pe: fallback, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, _source: 'fallback', _avDebug: av.debug };
  }
  return { _avDebug: av.debug };
}

// ---- Finnhub --------------------------------------------------------

async function fetchFinnhub(symbol: string): Promise<Fundamentals | null> {
  if (!FINNHUB_API_KEY) return null;
  const url =
    `https://finnhub.io/api/v1/stock/metric` +
    `?symbol=${encodeURIComponent(symbol)}&metric=all` +
    `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const m = data?.metric;
    if (!m) return null;
    const pe  = Number(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual);
    const eps = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    if (!isFinite(pe) || !isFinite(eps) || eps <= 0 || pe <= 0) return null;

    // 3-year-avg PE from the annual series. Pick the 3 most-recent
    // entries with a positive value so a single quirky year (loss-
    // maker turning around or a one-off charge) doesn't pin the
    // average to a meaningless number.
    let pe3yAvg: number | null = null;
    const annual = data?.series?.annual?.pe ?? [];
    if (Array.isArray(annual) && annual.length > 0) {
      const sorted = annual
        .map((p: any) => ({ period: String(p?.period ?? ""), v: Number(p?.v) }))
        .filter((p) => p.period && isFinite(p.v) && p.v > 0)
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .slice(0, 3);
      if (sorted.length > 0) {
        pe3yAvg = sorted.reduce((s, p) => s + p.v, 0) / sorted.length;
      }
    }
    return { pe, eps, pe3yAvg };
  } catch {
    return null;
  }
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  if (symbol in INDEX_ETF_PROXY) return fetchIndexPe(symbol);
  return fetchFinnhub(symbol);
}

// ---- HTTP entry -----------------------------------------------------

Deno.serve(async (req: Request) => {
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
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    // Skip categories that never have meaningful P/E. Indices are
    // kept iff they have an ETF proxy in INDEX_ETF_PROXY.
    .filter((t) =>
      !!t &&
      t !== "CASH" &&
      !/\.PVT$/i.test(t) &&
      !/^\d{6}$/.test(t) &&
      !/=F$/.test(t) &&             // futures
      (!t.startsWith("^") || (t in INDEX_ETF_PROXY)) &&
      !/[-]USD$/i.test(t) &&         // crypto
      !/=X$/.test(t)                 // forex
    );
  if (tickers.length === 0) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Cap parallelism at 6 — Finnhub free is 60/min, AV usage is
  // already cache-fronted, and Supabase REST handles the cache
  // queries fine in parallel.
  const out: Record<string, Fundamentals> = {};
  const queue = [...tickers];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      const f = await fetchFundamentals(t);
      if (f) out[t] = f;
    }
  });
  await Promise.all(workers);

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
