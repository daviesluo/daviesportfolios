// Supabase Edge Function: prices
// Routes ticker requests to the appropriate data source:
//   - 6-digit numeric tickers (e.g. 017731) → eastmoney 天天基金 (CN mutual funds)
//   - Everything else                       → Yahoo Finance v8/chart
// Returns a unified shape: { lastPrice, extPrice, prevClose, dayPct, extDayPct }
// Call: GET /functions/v1/prices?tickers=NVDA,017731,GBPUSD=X

import { reportServerError } from "../_shared/ops.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Auto-injected by the Supabase runtime — used only by the
// reportServerError helper at the bottom of this file to surface
// unhandled exceptions in the admin ⚠ badge. No new secrets required.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Regular session boundaries in exchange-local minutes-of-day
const MARKET_OPEN_MIN  = 9 * 60 + 30;  // 9:30 AM
const MARKET_CLOSE_MIN = 16 * 60;       // 4:00 PM

// 6-digit numeric → assume Chinese mutual fund code
const CN_FUND_RE = /^\d{6}$/;

// Thin OTC ADRs (SoftBank SFTBY / Murata MRAAY) whose Yahoo
// `regularMarketPrice` + `regularMarketPreviousClose` revert to the session
// OPEN (bogus) — the row then reads 0.00 % and the holding is valued at that
// stale price. For these we override last / prev close with the REAL
// regular-session candles (`rthSessionCloses`). Mirror of the client's
// `NO_OVERNIGHT_SESSION` set (ticker_class.js); add OTC ADRs here as they
// enter the book.
const OTC_ADR_BOGUS_QUOTE = new Set(["SFTBY", "MRAAY"]);

/**
 * Convert a unix-seconds UTC timestamp + an exchange's UTC offset
 * (also in seconds, can be negative) to the exchange's local
 * minute-of-day in [0, 1440). Pure helper, exported for tests.
 */
export function localMinOfDay(utcSec: number, gmtOffsetSec: number): number {
  const localSecInDay = ((utcSec + gmtOffsetSec) % 86400 + 86400) % 86400;
  return Math.floor(localSecInDay / 60);
}

/**
 * "Is this minute-of-day outside the regular US equity session?" —
 * matches the predicate used to detect extended-hours candles.
 * Exported for tests.
 */
export function isOutsideRth(localMin: number): boolean {
  return localMin < MARKET_OPEN_MIN || localMin >= MARKET_CLOSE_MIN;
}

/**
 * Exchange-local day number (whole days since the Unix epoch) — lets us tell
 * candles on different local calendar dates apart. Exported for tests.
 */
export function localDayNumber(utcSec: number, gmtOffsetSec: number): number {
  return Math.floor((utcSec + gmtOffsetSec) / 86400);
}

/**
 * Real regular-session closes for the thin OTC ADRs whose Yahoo
 * `regularMarketPrice` is unreliable (it reverts to the session open). Walks
 * the 5-min candles backward and returns the close of the last candle INSIDE
 * the 09:30-16:00 ET regular session (`last` — the real price at the 16:00 ET
 * close) plus the last in-session candle on an EARLIER local day (`prev` — the
 * real previous close, hence the 2-day fetch). Skips null / non-positive and
 * out-of-session (pre / post-market) candles. Either field is null when no
 * in-session candle is found, so the caller keeps the meta value. Exported for
 * tests.
 */
export function rthSessionCloses(
  timestamps: number[],
  closes: (number | null)[],
  gmtOffsetSec: number,
): { last: number | null; prev: number | null } {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return { last: null, prev: null };
  let last: number | null = null;
  let lastDay = NaN;
  let prev: number | null = null;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    const t = timestamps[i];
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    const m = localMinOfDay(t, gmtOffsetSec);
    if (m < MARKET_OPEN_MIN || m > MARKET_CLOSE_MIN) continue;
    const day = localDayNumber(t, gmtOffsetSec);
    if (last == null) { last = c; lastDay = day; continue; }
    if (day !== lastDay) { prev = c; break; }
  }
  return { last, prev };
}

/**
 * Percent change from `prev` to `curr` ("day pct"). Returns 0 when
 * `prev` isn't a positive number — same shape the price quote
 * exposes when prevClose is missing.
 */
export function pctChange(curr: number, prev: number): number {
  return prev > 0 ? ((curr - prev) / prev) * 100 : 0;
}

type PriceResult = {
  lastPrice: number;
  extPrice: number | null;
  prevClose: number;
  dayPct: number;
  extDayPct: number | null;
  // Native currency the price is quoted in. Frontend converts to USD via live FX.
  // London tickers come through as "GBP" because we pre-divide GBp (pence) by 100.
  currency: string | null;
};

// ---------------- Yahoo Finance ----------------
async function fetchYahoo(symbol: string): Promise<PriceResult | null> {
  const nonce = Date.now();
  // 5-minute candles with pre+post — lets us read extended-hours prices
  // directly from candle closes rather than unreliable meta fields. The
  // bogus-quote OTC ADRs (SFTBY / MRAAY) need a 2-day window: their
  // prevClose is rebuilt from the PREVIOUS session's real candles (the meta
  // field is bogus too — see the override below), which a 1-day fetch can't
  // reach. Everything else (crypto included) uses the standard 1-day window
  // and is anchored at Yahoo's regularMarketPreviousClose.
  const isOtcAdr = OTC_ADR_BOGUS_QUOTE.has(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=${isOtcAdr ? "2d" : "1d"}&includePrePost=true&_=${nonce}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    let lastPrice: number = meta.regularMarketPrice;
    // regularMarketPreviousClose = most recent completed regular session close.
    // chartPreviousClose = session before the chart's range start — with range=1d
    // on a pre-market morning that can be two sessions back, so use it last.
    let prevClose: number =
      meta.regularMarketPreviousClose ??
      meta.previousClose ??
      meta.chartPreviousClose ??
      lastPrice;

    // London-listed securities are quoted in pence (GBp/GBX). Normalize to GBP
    // so the frontend can apply a single GBP→USD FX rate without special-casing.
    let currency: string | null = meta.currency ?? null;
    let penceFactor = 1;
    if (currency === "GBp" || currency === "GBX") {
      penceFactor = 100;
      currency = "GBP";
      lastPrice  /= penceFactor;
      prevClose  /= penceFactor;
    }

    // gmtoffset is the exchange's offset from UTC in seconds (e.g. EDT = -14400).
    // We use it to convert each candle's UTC timestamp to local time-of-day so
    // we can tell whether it falls inside or outside the regular session.
    const gmtOffset: number = meta.gmtoffset ?? -14400;
    const timestamps: number[]       = result?.timestamp ?? [];
    const closes: (number | null)[]  = result?.indicators?.quote?.[0]?.close ?? [];

    // OTC ADRs (SFTBY / MRAAY): Yahoo's regularMarketPrice AND previousClose
    // both revert to the session open (bogus), so the row reads 0.00 % and the
    // holding is valued at that stale price. Use the REAL regular-session
    // closes from the intraday candles instead — `last` is the price at the
    // 16:00 ET close (the user's "actual 21:00" price), `prev` the previous
    // session's close. Falls back to the meta values when no in-session
    // candle is present (e.g. a holiday). USD-quoted, so penceFactor is 1.
    if (isOtcAdr) {
      const { last, prev } = rthSessionCloses(timestamps, closes, gmtOffset);
      if (last != null && last > 0) lastPrice = last / penceFactor;
      if (prev != null && prev > 0) prevClose = prev / penceFactor;
    }

    // Walk backwards to find the most recent candle that sits outside regular
    // market hours — that is the current extended-hours price.
    //
    // `isOutsideRth` is hardcoded to 9:30-16:00 (US RTH). For non-US
    // tickers (anything with a dotted suffix like `.L`, `.HK`, `.SS`,
    // `.DE` …), Yahoo returns candles in the local exchange's tz, so
    // the same minute-of-day boundary doesn't match — LSE pre-auction
    // candles at 08:30 UK end up flagged as "extended hours" and the
    // last live LSE intraday bar gets written as `extPrice` during US
    // pre-market. Those exchanges don't have a US-style pre/post
    // session anyway, so skip the scan entirely for them and let
    // extPrice stay null. US-index pseudo-symbols (`^GSPC` etc.) have
    // no dot so they're correctly NOT skipped. The bogus-quote OTC ADRs
    // are skipped too (`isOtcAdr`): they have no real pre/post session,
    // and their post-RTH candle is the same bogus open value, so extPrice
    // stays null rather than a stale fake quote.
    let extPrice: number | null = null;
    if (!symbol.includes(".") && !isOtcAdr) {
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const close = closes[i];
        if (close == null) continue;
        if (isOutsideRth(localMinOfDay(timestamps[i], gmtOffset))) {
          extPrice = close / penceFactor;
          break;
        }
      }
    }

    return {
      lastPrice,
      extPrice,
      prevClose,
      currency,
      dayPct:    pctChange(lastPrice, prevClose),
      extDayPct: extPrice != null ? pctChange(extPrice, prevClose) : null,
    };
  } catch {
    return null;
  }
}

// ---------------- Eastmoney 天天基金 ----------------
// JSONP endpoint, returns:
//   jsonpgz({"fundcode":"017731","name":"…","jzrq":"2026-04-23",
//            "dwjz":"1.2345","gsz":"1.2456","gszzl":"0.89","gztime":"…"});
//   dwjz  = 单位净值 (last published official NAV)        →  prevClose
//   gsz   = 估算净值 (real-time intraday estimate)        →  lastPrice
//   gszzl = 估算涨跌幅 % (informational; we recompute)
// Funds have no extended-hours concept, so extPrice/extDayPct are always null.
async function fetchCNFund(code: string): Promise<PriceResult | null> {
  const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://fund.eastmoney.com/",
        "Accept": "*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const text = (await res.text()).trim();
    // Strip the jsonpgz(…); wrapper. Some responses omit the trailing semicolon.
    const m = text.match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
    if (!m) return null;

    let obj: Record<string, string>;
    try { obj = JSON.parse(m[1]); } catch { return null; }

    const dwjz = parseFloat(obj.dwjz);
    if (!isFinite(dwjz) || dwjz <= 0) return null;

    // gsz may be empty/missing on weekends, holidays, or before estimate is published.
    // In that case, treat the fund as flat at its last NAV (no day change).
    const gsz = parseFloat(obj.gsz);
    const lastPrice = isFinite(gsz) && gsz > 0 ? gsz : dwjz;

    return {
      lastPrice,
      extPrice: null,
      prevClose: dwjz,
      currency: "CNY",
      dayPct:    ((lastPrice - dwjz) / dwjz) * 100,
      extDayPct: null,
    };
  } catch {
    return null;
  }
}

// ---------------- Router ----------------
function fetchPrice(ticker: string): Promise<PriceResult | null> {
  if (CN_FUND_RE.test(ticker)) return fetchCNFund(ticker);
  return fetchYahoo(ticker);
}

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the top-level try/catch wrap so a runtime
// crash here becomes a row the admin ⚠ badge surfaces instead of a
// silent 500. Best-effort: never throws.
// reportServerError now lives in ../_shared/ops.ts (imported above).

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS });
    }

    const url   = new URL(req.url);
    const param = url.searchParams.get("tickers") ?? "";
    // Cap the fan-out. Each ticker spawns one upstream Yahoo / Eastmoney
    // fetch inside the Promise.all below, so an unbounded `tickers` list
    // (any caller with the bundle's anon key) could open hundreds of
    // concurrent upstream connections — a free amplification vector that
    // risks an upstream IP ban. 100 is well above the app's ~47-ticker
    // working set.
    const MAX_TICKERS = 100;
    const tickers = param
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !t.endsWith(".PVT") && t !== "CASH")
      .slice(0, MAX_TICKERS);

    if (!tickers.length) {
      return new Response(JSON.stringify({ error: "tickers required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Fetch all tickers in parallel — Yahoo and Eastmoney happen concurrently
    // because they're awaited inside the Promise.all callback.
    const entries = await Promise.all(
      tickers.map(async (t) => [t, await fetchPrice(t)] as const)
    );

    const out: Record<string, unknown> = {};
    for (const [t, r] of entries) {
      if (r) out[t] = r;
    }

    return new Response(JSON.stringify(out), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("prices.unhandled", { message: msg });
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
