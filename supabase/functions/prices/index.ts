// Supabase Edge Function: prices
// Routes ticker requests to the appropriate data source:
//   - 6-digit numeric tickers (e.g. 017731) → eastmoney 天天基金 (CN mutual funds)
//   - Everything else                       → Yahoo Finance v8/chart
// Returns a unified shape: { lastPrice, extPrice, prevClose, dayPct, extDayPct }
// Call: GET /functions/v1/prices?tickers=NVDA,017731,GBPUSD=X

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Regular session boundaries in exchange-local minutes-of-day
const MARKET_OPEN_MIN  = 9 * 60 + 30;  // 9:30 AM
const MARKET_CLOSE_MIN = 16 * 60;       // 4:00 PM

// 6-digit numeric → assume Chinese mutual fund code
const CN_FUND_RE = /^\d{6}$/;

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
  // 5-minute candles for today with pre+post market — lets us read extended
  // hours prices directly from candle closes rather than unreliable meta fields.
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=1d&includePrePost=true&_=${nonce}`;

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

    // Walk backwards to find the most recent candle that sits outside regular
    // market hours — that is the current extended-hours price.
    let extPrice: number | null = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const close = closes[i];
      if (close == null) continue;
      // Convert UTC timestamp → local seconds-in-day (handles negative offsets)
      const localSecInDay = ((timestamps[i] + gmtOffset) % 86400 + 86400) % 86400;
      const localMin      = Math.floor(localSecInDay / 60);
      if (localMin < MARKET_OPEN_MIN || localMin >= MARKET_CLOSE_MIN) {
        extPrice = close / penceFactor;
        break;
      }
    }

    const pc = prevClose;
    return {
      lastPrice,
      extPrice,
      prevClose: pc,
      currency,
      dayPct:    pc > 0 ? ((lastPrice  - pc) / pc) * 100 : 0,
      extDayPct: (extPrice != null && pc > 0) ? ((extPrice - pc) / pc) * 100 : null,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url   = new URL(req.url);
  const param = url.searchParams.get("tickers") ?? "";
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !t.endsWith(".PVT") && t !== "CASH");

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
});
