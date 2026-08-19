// Supabase Edge Function: snapshot-record
//
// Cron-triggered every 5 min, 24/7 (migration 0026 schedules it, 0029
// owns the table it writes). One row per 5-minute bucket into
// `public.price_snapshots`: `{ ticker → native-currency price }` for
// every ticker on the board.
//
// This function records FACTS, not conclusions. It does not know what
// the portfolio is worth and must never learn: the book's value is
// computed in exactly one place, `computeAt` in `src/ytd.js`, which the
// vs-S&P chart and the Investment Performance chart both call. The
// previous version of this file computed a USD value and a net-deposit
// figure server-side, which meant a full second implementation of the
// ledger maths living beside the browser's — and the two disagreed in
// production, writing a `deposit_usd` that moved between 71k, 76k, 129k
// and 132k in two days without a penny changing hands. Recording the
// prices instead makes that class of bug unreachable rather than
// carefully avoided.
//
// Why server-side at all: Yahoo will not sell 5-minute bars going back a
// month, has none at all for a CN fund or a `.PVT` holding, and stops
// entirely overnight for most listings. The book still moves when nobody
// is looking — T212 overnight, crypto, FX — and the original client-side
// sampler only ran while an admin tab was in the foreground, so "every
// five minutes" recorded the hours the page was open. Overnight prices
// already got this treatment (`overnight-record`); everything else needs
// it too.
//
// Auth: caller MUST present `Authorization: Bearer <CRON_SECRET>`.
// Deploy with `--no-verify-jwt` (PUBLIC_FNS in edge-functions.yml) —
// CRON_SECRET is not a Supabase JWT, so the platform gate would 401 the
// cron call before this check ran.
//
// Returns:
//   200 { ok: true, bucketTime, tickers }
//   200 { ok: true, skipped: "no-board" | "no-tickers" | "no-prices" }
//   403 — bad auth
//   500 — DB write failed

import { isUsMarketHolidayAt } from "../_shared/us_market_calendar.ts";
import { b64url, sign } from "../_shared/token.ts";
import { reportServerError } from "../_shared/ops.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const APP_AUTH_SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";
const T212_API_KEY = Deno.env.get("T212_API_KEY") ?? "";
const T212_API_SECRET = Deno.env.get("T212_API_SECRET") ?? "";
const T212_ISA_API_KEY = Deno.env.get("T212_ISA_API_KEY") ?? "";
const T212_ISA_API_SECRET = Deno.env.get("T212_ISA_API_SECRET") ?? "";

const T212_POSITIONS_URL = "https://live.trading212.com/api/v0/equity/positions";
const BUCKET_MS = 5 * 60 * 1000;

const T212_TO_YAHOO: Record<string, string> = {
  "VUAAl_EQ": "VUAA.L",
  "SAEMl_EQ": "SAEM.L",
};
const T212_US_ALIASES: Record<string, string> = {
  "FB_US_EQ": "META",
  "YNDX_US_EQ": "NBIS",
  "IIVI_US_EQ": "COHR",
  "VACQ_US_EQ": "RKLB",
  "LOKB_US_EQ": "NVTS",
  "GOOGL_US_EQ": "GOOG",
};

// ---------------- Pure helpers (test-pinned) ----------------

/** UTC ISO of the 5-min bucket the given epoch-ms falls into. */
export function bucketTimeIso(now: number): string {
  return new Date(Math.floor(now / BUCKET_MS) * BUCKET_MS).toISOString();
}

export function etParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[wdStr] ?? 0;
  const hour = hh === 24 ? 0 : hh;
  return {
    weekday,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(mm) ? mm : 0),
  };
}

/** US cash session 09:30–16:00 ET on a weekday that isn't a full holiday. */
export function isUsRegularSession(at: Date): boolean {
  if (isUsMarketHolidayAt(at)) return false;
  const { weekday, minutes } = etParts(at);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function t212TickerToYahoo(t212Ticker: string): string | null {
  if (typeof t212Ticker !== "string" || !t212Ticker) return null;
  if (T212_TO_YAHOO[t212Ticker]) return T212_TO_YAHOO[t212Ticker];
  if (T212_US_ALIASES[t212Ticker]) return T212_US_ALIASES[t212Ticker];
  const us = t212Ticker.match(/^([A-Za-z]+)_US_EQ$/);
  if (us) return us[1].toUpperCase();
  const lse = t212Ticker.match(/^([A-Za-z]+)l_EQ$/);
  if (lse) return lse[1].toUpperCase() + ".L";
  return null;
}

/**
 * `{ yahooTicker → currentPrice }` for every recognised T212 position.
 * The broker's own print is both fresher and correctly-currencied for
 * the LSE ETFs, where Yahoo's free feed lags 15-20 min at the open.
 */
export function extractT212Prices(positions: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(positions)) return out;
  for (const raw of positions) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    let t212 = typeof p.ticker === "string" ? p.ticker : null;
    if (!t212 && p.instrument && typeof p.instrument === "object") {
      const inst = p.instrument as Record<string, unknown>;
      if (typeof inst.ticker === "string") t212 = inst.ticker;
    }
    if (!t212) continue;
    const yahoo = t212TickerToYahoo(t212);
    if (!yahoo) continue;
    const cp = Number(p.currentPrice);
    if (Number.isFinite(cp) && cp > 0) out[yahoo] = cp;
  }
  return out;
}

export function mergePriceMaps(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  return { ...b, ...a };
}

type Quote = { lastPrice?: number; extPrice?: number };

type Holding = { isCash?: boolean; shares?: number; lastPrice?: number };
type Portfolio = {
  holdings?: Record<string, Holding>;
  positions?: Record<string, { tickers?: string[] }>;
};

/**
 * Which tickers to record. Board scope — the same set `computeAt` values
 * — so a row carries a price for every holding the chart will ask about
 * and nothing it won't.
 */
export function tickersToRecord(portfolio: Portfolio | null | undefined): string[] {
  const positioned = new Set<string>();
  for (const pos of Object.values(portfolio?.positions || {})) {
    for (const t of (pos?.tickers || [])) positioned.add(t);
  }
  const scopeAll = positioned.size === 0;
  const out = new Set<string>();
  for (const [ticker, h] of Object.entries(portfolio?.holdings || {})) {
    if (h?.isCash || ticker === "CASH") continue;
    if (!scopeAll && !positioned.has(ticker)) continue;
    out.add(ticker);
  }
  return [...out].sort();
}

/**
 * The price to record for one ticker, in its NATIVE currency.
 *
 * T212's `currentPrice` wins when we have it (overnight US prints, and
 * the LSE ETFs Yahoo lags). Outside the US cash session, Yahoo's
 * `extPrice` is the after-hours / crypto-off-session print; during it,
 * `lastPrice` is the live tape and last night's ext price must not leak
 * into a daytime sample.
 *
 * Deliberately does NOT fall back to the holding's stored `lastPrice`.
 * That number is whatever the browser last wrote to `board_data`, which
 * could be hours or days old; recording it would stamp a stale figure
 * with a fresh timestamp and make a flat stretch look like real data.
 * A ticker with no live quote is simply absent from the row, and the
 * chart falls back to Yahoo's bars for it exactly as it does today.
 */
export function recordablePrice(
  quote: Quote | null | undefined,
  t212Price: number | undefined,
  at: Date,
): number | null {
  if (typeof t212Price === "number" && t212Price > 0) return t212Price;
  const rth = isUsRegularSession(at);
  if (!rth && typeof quote?.extPrice === "number" && quote.extPrice > 0) return quote.extPrice;
  if (typeof quote?.lastPrice === "number" && quote.lastPrice > 0) return quote.lastPrice;
  return null;
}

/** The row body: every ticker we could price, and nothing else. */
export function buildPriceRow(
  tickers: string[],
  quotes: Record<string, Quote>,
  t212Prices: Record<string, number>,
  at: Date,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tickers) {
    const px = recordablePrice(quotes[t], t212Prices[t], at);
    if (px != null) out[t] = px;
  }
  return out;
}

// ---------------- I/O ----------------

async function mintAdminToken(): Promise<string> {
  if (!APP_AUTH_SECRET) return "";
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 120_000 }));
  return `${payload}.${await sign(payload, APP_AUTH_SECRET)}`;
}

async function fetchPositions(apiKey: string, apiSecret: string): Promise<unknown> {
  if (!apiKey) return null;
  const authHeader = apiSecret ? `Basic ${btoa(`${apiKey}:${apiSecret}`)}` : apiKey;
  try {
    const res = await fetch(T212_POSITIONS_URL, {
      headers: { Authorization: authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchAllT212Prices(): Promise<Record<string, number>> {
  const [invest, isa] = await Promise.all([
    fetchPositions(T212_API_KEY, T212_API_SECRET),
    T212_ISA_API_KEY ? fetchPositions(T212_ISA_API_KEY, T212_ISA_API_SECRET) : Promise.resolve(null),
  ]);
  return mergePriceMaps(extractT212Prices(invest), extractT212Prices(isa));
}

async function loadBoard(): Promise<Portfolio | null> {
  if (!SB_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/board_data?id=eq.1&select=data`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const data = Array.isArray(rows) ? rows[0]?.data : null;
    if (!data || typeof data !== "object") return null;
    return data as Portfolio;
  } catch {
    return null;
  }
}

async function fetchQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  if (tickers.length === 0) return out;
  const token = await mintAdminToken();
  if (!token || !SB_URL || !SERVICE_KEY) return out;
  try {
    const url = `${SB_URL}/functions/v1/prices?tickers=${
      encodeURIComponent(tickers.slice(0, 100).join(","))
    }`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "X-App-Token": token,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return out;
    const body = await res.json();
    if (!body || typeof body !== "object") return out;
    for (const [t, row] of Object.entries(body as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const r = row as Quote;
      out[t] = {
        lastPrice: typeof r.lastPrice === "number" ? r.lastPrice : undefined,
        extPrice: typeof r.extPrice === "number" ? r.extPrice : undefined,
      };
    }
  } catch { /* next tick retries */ }
  return out;
}

async function upsertPrices(bucketTime: string, prices: Record<string, number>): Promise<boolean> {
  if (!SB_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/price_snapshots`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ ts: bucketTime, prices }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------- Server ----------------

if (import.meta.main) {
  Deno.serve(async (req) => {
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

      const auth = req.headers.get("Authorization") ?? "";
      if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
        return new Response("forbidden", { status: 403, headers: CORS });
      }

      const now = new Date();
      const portfolio = await loadBoard();
      if (!portfolio) return json(200, { ok: true, skipped: "no-board" });

      const tickers = tickersToRecord(portfolio);
      if (tickers.length === 0) return json(200, { ok: true, skipped: "no-tickers" });

      const [quotes, t212Prices] = await Promise.all([
        fetchQuotes(tickers),
        fetchAllT212Prices(),
      ]);

      const prices = buildPriceRow(tickers, quotes, t212Prices, now);
      // Nothing priced at all means the upstream is down, not that the
      // book is worthless. Write nothing; the next tick is 5 min away.
      if (Object.keys(prices).length === 0) return json(200, { ok: true, skipped: "no-prices" });

      const bucketTime = bucketTimeIso(now.getTime());
      const ok = await upsertPrices(bucketTime, prices);
      if (!ok) return json(500, { ok: false, error: "db-write-failed" });
      return json(200, { ok: true, bucketTime, tickers: Object.keys(prices).length });
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      await reportServerError("snapshot-record.unhandled", { message: msg });
      return json(500, { ok: false, error: "internal" });
    }
  });
}
