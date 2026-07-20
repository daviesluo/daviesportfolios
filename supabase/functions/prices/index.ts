// Supabase Edge Function: prices
// Routes ticker requests to the appropriate data source:
//   - 6-digit numeric tickers (e.g. 017731) → eastmoney 天天基金 (CN mutual funds)
//   - Everything else                       → Yahoo Finance v8/chart
// Returns a unified shape: { lastPrice, extPrice, prevClose, dayPct, extDayPct }
// Call: GET /functions/v1/prices?tickers=NVDA,017731,GBPUSD=X

import { reportServerError } from "../_shared/ops.ts";
import { isUsTradingDay } from "../_shared/us_market_calendar.ts";

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
    // Skip candles on non-trading days (weekend / holiday). A 24/7 crypto
    // has in-session-clock candles every day, but only a real trading
    // day's 16:00-ET bar is an actual close — without this the last/prev
    // close would come from a holiday's mid-day price.
    if (!isUsTradingDay(t, gmtOffsetSec)) continue;
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

// Crypto (BTC-USD, ETH-USD, …) trades 24/7 in UTC, but the app anchors its
// day change to the US equity session (the 16:00 ET close) so it reads
// exactly like a US stock. Yahoo's crypto gmtoffset is UTC and its
// regularMarketPreviousClose is a midnight-UTC boundary — neither is the
// US close — so for these we recompute the anchors against US ET hours
// from the intraday candles (cryptoUsSessionQuote below).
const CRYPTO_RE = /-USD$/i;

/**
 * America/New_York UTC offset in seconds for `nowMs`, DST-aware
 * (−14400 EDT / −18000 EST). Crypto has no native exchange tz, so we
 * derive the US-session offset here rather than trusting Yahoo's gmtoffset
 * (which is UTC for crypto). Exported for tests.
 */
export function etOffsetSec(nowMs: number): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(nowMs).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return -5 * 3600;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3] ?? "0", 10) * 60);
}

/**
 * US-session-anchored quote fields for a 24/7 crypto symbol, derived from
 * its intraday candles so it reads exactly like a US stock:
 *   - prevClose = the previous US regular close (16:00 ET of an earlier
 *                 day) — `rthSessionCloses().prev`.
 *   - lastPrice = today's 16:00 ET close once the US session is over
 *                 (`rthSessionCloses().last`, frozen like a stock's
 *                 regularMarketPrice after the close); the live price while
 *                 US RTH is in progress (a stock is live intraday too).
 *   - extPrice  = the live 24/7 price while OUTSIDE the live US session —
 *                 after-hours / overnight AND all day on weekends /
 *                 holidays (the market is closed, so a 24/7 asset is
 *                 off-session); null only during a real RTH session
 *                 (ignored then anyway — the client trusts extPrice only
 *                 off-session). "Off-session" is `isOutsideRth` OR a
 *                 non-trading day (isUsTradingDay), matching the client's
 *                 usMarketPhase which buckets weekends/holidays as
 *                 "overnight".
 * Falls back to `regularMarketPrice` / `prevCloseMeta` when no in-session
 * candle is available. Pure — exported for tests.
 */
export function cryptoUsSessionQuote(
  timestamps: number[],
  closes: (number | null)[],
  regularMarketPrice: number,
  prevCloseMeta: number,
  nowSec: number,
  etOff: number,
): { lastPrice: number; extPrice: number | null; prevClose: number } {
  const { last, prev } = rthSessionCloses(timestamps, closes, etOff);
  // "Outside the live US session" = outside 9:30-16:00 ET OR a non-trading
  // day (weekend / holiday). On a holiday the clock can read 13:45 ET but
  // the market is closed all day, so the 24/7 crypto is off-session and its
  // live price belongs in extPrice — matching the client's usMarketPhase
  // (which returns "overnight" then). Without the trading-day term the row
  // read extPrice=null / lastPrice=live and the day change collapsed to 0%.
  const afterClose = isOutsideRth(localMinOfDay(nowSec, etOff)) || !isUsTradingDay(nowSec, etOff);
  const prevClose = (prev != null && prev > 0) ? prev : prevCloseMeta;
  const lastPrice = afterClose
    ? ((last != null && last > 0) ? last : regularMarketPrice)
    : regularMarketPrice;
  const extPrice = afterClose ? regularMarketPrice : null;
  return { lastPrice, extPrice, prevClose };
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
  // Crypto is re-anchored to the US session (cryptoUsSessionQuote), so its
  // prevClose / lastPrice come from the last two 16:00-ET candles on TRADING
  // days (rthSessionCloses skips weekends/holidays). Yahoo's `range` counts
  // whole UTC calendar days, and a long holiday weekend can put the last
  // trading day 4-5 days back (e.g. Sun of a Fri-holiday weekend → Thu is
  // ~4 days back). A 3d window slid past it and left last/prev null, so
  // lastPrice fell back to the LIVE price (== extPrice → the client read
  // 0.00%). 7d guarantees the last two US trading-day closes stay in range
  // across any holiday+weekend cluster.
  const isCryptoSym = CRYPTO_RE.test(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=${isCryptoSym ? "7d" : (isOtcAdr ? "2d" : "1d")}&includePrePost=true&_=${nonce}`;

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

    // Crypto: re-anchor to the US session so BTC-USD reads exactly like a
    // US stock — prevClose = the previous 16:00-ET close, lastPrice =
    // today's 16:00-ET close once the session's over (live during RTH),
    // extPrice = the live 24/7 price while off-session. See
    // cryptoUsSessionQuote. USD-quoted, so penceFactor is 1. `cryptoExt`
    // feeds the extPrice slot below (the generic outside-RTH scan is
    // skipped for crypto — it would use Yahoo's UTC gmtoffset, wrong tz).
    let cryptoExt: number | null = null;
    if (isCryptoSym) {
      const q = cryptoUsSessionQuote(
        timestamps, closes, meta.regularMarketPrice, prevClose,
        Math.floor(Date.now() / 1000), etOffsetSec(Date.now()),
      );
      lastPrice = q.lastPrice;
      prevClose = q.prevClose;
      cryptoExt = q.extPrice;
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
    if (isCryptoSym) {
      // Crypto's ext quote is the live off-session price (from
      // cryptoUsSessionQuote), keyed to US hours — not the generic scan,
      // which reads Yahoo's UTC gmtoffset and would mis-bucket the candles.
      extPrice = cryptoExt;
    } else if (!symbol.includes(".") && !isOtcAdr) {
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
// Primary: fundgz JSONP (has the real-time intraday NAV estimate):
//   jsonpgz({"fundcode":"017731","name":"…","jzrq":"2026-04-23",
//            "dwjz":"1.2345","gsz":"1.2456","gszzl":"0.89","gztime":"…"});
//   dwjz  = 单位净值 (last published official NAV)        →  prevClose
//   gsz   = 估算净值 (real-time intraday estimate)        →  lastPrice
//   gszzl = 估算涨跌幅 % (informational; we recompute)
// Fallbacks: fundgz is intermittently geo-blocked from Deno Deploy
// egress IPs (observed 2026-07: EVERY prices response omitting the CN
// fund for hours, which stalled the client behind its slow CORS-proxy
// fallback). When it fails, take the latest two OFFICIAL NAVs from the
// same fallback hosts the chart function already uses — f10/lsjz, then
// danjuanapp — and price the fund off those. That loses the intraday
// estimate but matches how any US ticker reads on a weekend (last
// official close vs the one before), and above all keeps the fund from
// vanishing out of the response. fundgz + lsjz launch concurrently so
// the fallback costs no extra latency when fundgz is down (its reply
// simply wins); danjuanapp only runs if both fail.
// Funds have no extended-hours concept, so extPrice/extDayPct are always null.

/** Parse a fundgz jsonpgz(...) body into a PriceResult. Exported for tests. */
export function parseFundgz(text: string): PriceResult | null {
  // Strip the jsonpgz(…); wrapper. Some responses omit the trailing semicolon.
  const m = text.trim().match(/^jsonpgz\((.+?)\)\s*;?\s*$/s);
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
}

/**
 * Price a fund off its latest two official NAVs (newest first).
 * lastPrice = newest NAV, prevClose = the one before — the same
 * "last official close vs the previous one" reading a US ticker
 * gives outside market hours. Exported for tests.
 */
export function navPairToResult(navs: { nav: number }[]): PriceResult | null {
  const clean = navs.filter((n) => isFinite(n?.nav) && n.nav > 0);
  if (clean.length === 0) return null;
  const lastPrice = clean[0].nav;
  const prevClose = clean.length > 1 ? clean[1].nav : lastPrice;
  return {
    lastPrice,
    extPrice: null,
    prevClose,
    currency: "CNY",
    dayPct:    prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0,
    extDayPct: null,
  };
}

const CN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "*/*",
};

async function tryFundgz(code: string): Promise<PriceResult | null> {
  const url = `https://fundgz.1234567.com.cn/js/${encodeURIComponent(code)}.js?rt=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: { ...CN_HEADERS, "Referer": "https://fund.eastmoney.com/" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return parseFundgz(await res.text());
  } catch {
    return null;
  }
}

async function tryLsjz(code: string): Promise<PriceResult | null> {
  // f10/lsjz: official daily NAV history, newest first — 2 rows is all
  // the price endpoint needs.
  const url = `https://api.fund.eastmoney.com/f10/lsjz` +
    `?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=2&_=${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: {
        ...CN_HEADERS,
        "Referer": "https://fundf10.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json?.Data?.LSJZList;
    if (!Array.isArray(list)) return null;
    return navPairToResult(list.map((row) => ({ nav: parseFloat(row?.DWJZ) })));
  } catch {
    return null;
  }
}

async function tryDanjuan(code: string): Promise<PriceResult | null> {
  const url =
    `https://danjuanapp.com/djapi/fund/nav/history/${encodeURIComponent(code)}?size=2&page=1`;
  try {
    const res = await fetch(url, {
      headers: { ...CN_HEADERS, "Accept": "application/json,*/*" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data?.items;
    if (!Array.isArray(items)) return null;
    return navPairToResult(items.map((row) => ({ nav: parseFloat(row?.nav) })));
  } catch {
    return null;
  }
}

// How long a usable lsjz reply waits for the still-pending fundgz call
// before preempting it. Long enough that a merely-slower-than-lsjz but
// healthy fundgz still wins (keeping the intraday estimate), short
// enough that a geo-blocked fundgz hanging toward its 4 s timeout can't
// stall the whole batched /prices response behind it.
const FUNDGZ_GRACE_MS = 1_000;

/**
 * Pick between the two eastmoney sources without stalling on either
 * (Codex #202 P2). fundgz is PREFERRED, not merely raced: its intraday
 * estimate and lsjz's official-NAV day change read differently, so
 * letting whichever answers first win would flicker the fund's quote
 * between the two readings on every 30 s refresh while both are
 * healthy. Instead a usable lsjz reply gives the pending fundgz call
 * `graceMs` to answer, then preempts it. Resolution paths:
 *   - fundgz usable (within lsjz + grace)      → fundgz
 *   - fundgz hangs, lsjz usable                → lsjz after ~grace
 *   - fundgz settles null fast                 → lsjz as soon as it lands
 *   - both null                                → null (caller → danjuan)
 * Exported for tests (sources injected as promises).
 */
export async function raceCnSources(
  gzPromise: Promise<PriceResult | null>,
  lsjzPromise: Promise<PriceResult | null>,
  graceMs = FUNDGZ_GRACE_MS,
): Promise<PriceResult | null> {
  const PENDING = Symbol("gz-still-pending");
  // The grace timer must not outlive this call: clear it on every exit
  // path (fundgz winning inside the grace window used to strand it),
  // and never start it after the race has already settled (fundgz
  // winning while lsjz is still in flight). Deno's test sanitizer
  // rightly flags either as a leak.
  let settled = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const preempt: Promise<PriceResult | typeof PENDING> = lsjzPromise.then(async (ls) => {
    if (!ls || settled) return PENDING;   // useless lsjz never preempts fundgz
    await new Promise<void>((r) => { graceTimer = setTimeout(r, graceMs); });
    return ls;
  });
  try {
    const first = await Promise.race([gzPromise, preempt]);
    if (first === PENDING) return await gzPromise; // lsjz was useless; fundgz gets its full timeout
    if (first) return first;                       // usable fundgz, or lsjz preempting a hung fundgz
    return await lsjzPromise;                      // fundgz settled null → fall back to lsjz
  } finally {
    settled = true;
    if (graceTimer !== undefined) clearTimeout(graceTimer);
  }
}

async function fetchCNFund(code: string): Promise<PriceResult | null> {
  const pick = await raceCnSources(tryFundgz(code), tryLsjz(code));
  if (pick) return pick;
  return await tryDanjuan(code);
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
