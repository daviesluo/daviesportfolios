// Supabase Edge Function: snapshot-record
//
// Cron-triggered every 5 min, 24/7 (see migration 0026). Computes the
// live portfolio USD market value + net deposited and upserts one row
// into `public.portfolio_snapshots`, keyed by the current 5-min bucket.
// The Investment Performance chart then reads those via `data?action=
// snapshots` and overlays them onto the vs-S&P grid so recorded samples
// progressively replace ledger-derived history.
//
// Why server-side: the original sampler only ran while an admin tab was
// in the foreground, so a day of "every 5 minutes" produced a handful
// of clusters around the hours the page was actually open. Overnight
// US prices already had this treatment (`overnight-record`); the
// portfolio total needs the same — the book still moves when nobody is
// looking (T212 overnight, crypto, FX).
//
// Auth: caller MUST present `Authorization: Bearer <CRON_SECRET>`.
// Deploy with `--no-verify-jwt` (PUBLIC_FNS in edge-functions.yml) —
// CRON_SECRET is not a Supabase JWT, so the platform gate would 401
// the cron call before this check ran.
//
// Skip (200, recorded nothing) when FX is missing or a positioned
// ticker has no usable price — a 1:1 FX fallback or a zeroed holding
// writes a permanent spike. The next tick is five minutes away.
//
// Returns:
//   200 { ok: true, bucketTime, valueUsd, depositUsd }
//   200 { ok: true, skipped: "fx-missing" | "no-price" | "no-value" | "no-board" }
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

const TICKER_CURRENCY_OVERRIDES: Record<string, string> = {
  "VUAA.L": "USD",
  "SAEM.L": "USD",
};

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

// Density bands matching the chart's RANGE_BUCKET_SECONDS. Only the
// trailing ~26 h keeps every 5-minute sample (the 24H window, plus a
// little overlap). Older rows are coarsened in-table to the last sample
// per 30 min / 1 h / 4 h / 1 day, then dropped after ~400 days. A
// 30-day wipe like overnight-points would erase the real series the
// 1M / 3M / YTD charts are supposed to replace derived history with.
export const SNAPSHOT_KEEP_5M_MS = 26 * 3600 * 1000;
export const SNAPSHOT_KEEP_30M_MS = 8 * 24 * 3600 * 1000;
export const SNAPSHOT_KEEP_1H_MS = 35 * 24 * 3600 * 1000;
export const SNAPSHOT_KEEP_4H_MS = 100 * 24 * 3600 * 1000;
export const SNAPSHOT_KEEP_1D_MS = 400 * 24 * 3600 * 1000;

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
  return { weekday, minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(mm) ? mm : 0) };
}

/** US cash-session 09:30–16:00 ET on a weekday that is not a full holiday. */
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
 * { yahooTicker → currentPrice } for every recognised T212 position.
 * Unlike overnight-record this is NOT limited to US overnight names —
 * LSE ETFs and the rest of the book still have a live broker print.
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

export function detectCurrency(ticker: string, holdingCurrency?: string): string {
  if (typeof holdingCurrency === "string" && holdingCurrency) return holdingCurrency;
  if (ticker in TICKER_CURRENCY_OVERRIDES) return TICKER_CURRENCY_OVERRIDES[ticker];
  if (/^\d{6}$/.test(ticker)) return "CNY";
  if (/\.L$/i.test(ticker)) return "GBP";
  if (/\.HK$/i.test(ticker)) return "HKD";
  if (/\.(PA|AS|BR|LS|IR|MI|MC|DE|F|SG|BE|DU|HM|HA|MU|VI|HE|AT)$/i.test(ticker)) return "EUR";
  return "USD";
}

export function fxPairFor(currency: string): string | null {
  if (currency === "GBP") return "GBPUSD=X";
  if (currency === "EUR") return "EURUSD=X";
  if (currency === "CNY") return "USDCNY=X";
  if (currency === "HKD") return "USDHKD=X";
  return null;
}

export function fxRateToUSD(
  currency: string | undefined,
  marketData: Record<string, { lastPrice?: number }> | null | undefined,
): { rate: number; missing: boolean } {
  if (!currency || currency === "USD") return { rate: 1, missing: false };
  if (currency === "GBP") {
    const r = marketData?.["GBPUSD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0) ? { rate: r, missing: false } : { rate: 1, missing: true };
  }
  if (currency === "EUR") {
    const r = marketData?.["EURUSD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0) ? { rate: r, missing: false } : { rate: 1, missing: true };
  }
  if (currency === "CNY") {
    const r = marketData?.["USDCNY=X"]?.lastPrice;
    return (typeof r === "number" && r > 0) ? { rate: 1 / r, missing: false } : { rate: 1, missing: true };
  }
  if (currency === "HKD") {
    const r = marketData?.["USDHKD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0) ? { rate: 1 / r, missing: false } : { rate: 1, missing: true };
  }
  return { rate: 1, missing: false };
}

type Quote = { lastPrice?: number; extPrice?: number };

/**
 * Native-currency live print. T212 currentPrice wins (overnight US +
 * LSE open). Outside US RTH, Yahoo's extPrice is the after-hours /
 * crypto-off-session print. During RTH, lastPrice is the live tape —
 * yesterday's extPrice must not leak into a daytime sample.
 */
export function pickLivePrice(
  quote: Quote | null | undefined,
  t212Price: number | undefined,
  holdingLast: number | undefined,
  at: Date,
): number | null {
  if (typeof t212Price === "number" && t212Price > 0) return t212Price;
  const rth = isUsRegularSession(at);
  if (!rth && typeof quote?.extPrice === "number" && quote.extPrice > 0) return quote.extPrice;
  if (typeof quote?.lastPrice === "number" && quote.lastPrice > 0) return quote.lastPrice;
  if (typeof holdingLast === "number" && holdingLast > 0) return holdingLast;
  return null;
}

type Holding = {
  isCash?: boolean;
  shares?: number;
  cost?: number;
  lastPrice?: number;
  currency?: string;
  lots?: Array<{ date?: string; shares?: number; cost?: number }>;
  sells?: Array<{ date?: string; shares?: number; price?: number }>;
};

type Portfolio = {
  holdings?: Record<string, Holding>;
  positions?: Record<string, { tickers?: string[] }>;
};

export function positionedTickers(portfolio: Portfolio | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const pos of Object.values(portfolio?.positions || {})) {
    for (const t of pos?.tickers || []) out.add(t);
  }
  return out;
}

export function quoteTickersNeeded(portfolio: Portfolio | null | undefined): string[] {
  const positioned = positionedTickers(portfolio);
  const tickers = new Set<string>();
  for (const t of positioned) {
    const h = portfolio?.holdings?.[t];
    if (!h || h.isCash || t === "CASH") continue;
    tickers.add(t);
    const cur = detectCurrency(t, h.currency);
    const pair = fxPairFor(cur);
    if (pair) tickers.add(pair);
  }
  return [...tickers];
}

export type SnapshotValue = {
  value: number;
  fxMissing: boolean;
  missingPrice: boolean;
};

/**
 * Board-scoped market value (same holdings computeMetrics sums). Cash
 * is the dollar amount on the cash row. A missing FX pair or a
 * positioned ticker with no print flags the tick as unrecordable.
 */
export function snapshotMarketValue(
  portfolio: Portfolio | null | undefined,
  quotes: Record<string, Quote>,
  t212Prices: Record<string, number>,
  at: Date,
): SnapshotValue {
  const positioned = positionedTickers(portfolio);
  const scopeAll = positioned.size === 0;
  let value = 0;
  let fxMissing = false;
  let missingPrice = false;
  const holdings = portfolio?.holdings || {};
  const keys = scopeAll ? Object.keys(holdings) : [...positioned];
  for (const t of keys) {
    const h = holdings[t];
    if (!h) continue;
    if (h.isCash || t === "CASH") {
      const cash = Number(h.lastPrice);
      if (typeof cash === "number" && cash > 0) value += cash;
      continue;
    }
    const fx = fxRateToUSD(detectCurrency(t, h.currency), quotes);
    if (fx.missing) fxMissing = true;
    const price = pickLivePrice(quotes[t], t212Prices[t], h.lastPrice, at);
    if (price == null) {
      missingPrice = true;
      continue;
    }
    const shares = Number(h.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    value += shares * price * fx.rate;
  }
  return { value, fxMissing, missingPrice };
}

function historyLotsFor(h: Holding): Array<{ date: string; shares: number; cost: number }> {
  const lots = Array.isArray(h?.lots) ? h.lots : [];
  if (lots.some((l) => Number(l?.shares) > 0)) {
    return lots.map((l) => ({
      date: String(l?.date || ""),
      shares: Number(l?.shares),
      cost: Number(l?.cost),
    }));
  }
  const shares = Number(h?.shares);
  if (!Number.isFinite(shares) || shares <= 0) return [];
  const cost = Number(h?.cost);
  const px = Number(h?.lastPrice);
  return [{
    date: "1970-01-01",
    shares,
    cost: Number.isFinite(cost) && cost > 0 ? cost : (Number.isFinite(px) && px > 0 ? px : 0),
  }];
}

function t212FillTickers(orders: Array<{ ticker?: string | null }> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(orders)) return out;
  for (const o of orders) {
    if (typeof o?.ticker === "string" && o.ticker) out.add(o.ticker);
  }
  return out;
}

export function t212CashIsReady(t212Cash: {
  complete?: boolean;
  transactions?: unknown[];
} | null | undefined): boolean {
  if (!t212Cash || t212Cash.complete !== true) return false;
  const txs = t212Cash.transactions;
  if (!Array.isArray(txs) || txs.length === 0) return false;
  return txs.some((tx) => {
    const t = String((tx as { type?: string })?.type || "").toLowerCase();
    return t === "deposit" || t === "withdraw";
  });
}

export function t212MoneyInNow(
  transactions: Array<{ type?: string; amount?: number; currency?: string }> | null | undefined,
): number {
  if (!Array.isArray(transactions) || transactions.length === 0) return 0;
  let sum = 0;
  for (const tx of transactions) {
    const type = String(tx?.type || "").toLowerCase();
    const amount = Number(tx?.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (type === "deposit") sum += Math.abs(amount);
    else if (type === "withdraw") sum -= Math.abs(amount);
  }
  return sum;
}

export type T212Cash = {
  complete?: boolean;
  transactions?: Array<{ type?: string; amount?: number; currency?: string }>;
  orders?: Array<{ ticker?: string | null }>;
};

/**
 * Net deposited as of now — same question `netDepositNow` answers on
 * the client. T212 cash history, once complete, is money paid in;
 * otherwise lot costs minus sale proceeds plus board cash.
 */
export function snapshotDeposit(
  portfolio: Portfolio | null | undefined,
  quotes: Record<string, Quote>,
  t212Cash: T212Cash | null | undefined,
): number {
  const useT212 = t212CashIsReady(t212Cash);
  const t212Tickers = useT212 ? t212FillTickers(t212Cash?.orders) : new Set<string>();
  const positioned = positionedTickers(portfolio);
  const scopeAllCash = positioned.size === 0;
  let netDeposit = 0;
  let cashUSD = 0;
  for (const [ticker, h] of Object.entries(portfolio?.holdings || {})) {
    if (h?.isCash || ticker === "CASH") {
      if (!scopeAllCash && !positioned.has(ticker)) continue;
      const cash = Number(h?.lastPrice);
      if (Number.isFinite(cash) && cash > 0) cashUSD += cash;
      continue;
    }
    const skipLotDeposit = useT212 && t212Tickers.has(ticker);
    for (const l of historyLotsFor(h || {})) {
      const n = Number(l.shares);
      const c = Number(l.cost);
      if (!Number.isFinite(n) || n <= 0) continue;
      // Same rule as the client: deposit is not revalued at live FX.
      if (!skipLotDeposit && Number.isFinite(c)) netDeposit += n * c;
    }
    for (const sl of (Array.isArray(h?.sells) ? h.sells : [])) {
      const n = Number(sl?.shares);
      const px = Number(sl?.price);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!skipLotDeposit && Number.isFinite(px)) netDeposit -= n * px;
    }
  }
  if (useT212) return netDeposit + t212MoneyInNow(t212Cash?.transactions);
  return netDeposit + cashUSD;
}

export function skipReason(v: SnapshotValue): "fx-missing" | "no-price" | "no-value" | null {
  if (v.fxMissing) return "fx-missing";
  if (v.missingPrice) return "no-price";
  if (!(v.value > 0) || !Number.isFinite(v.value)) return "no-value";
  return null;
}

type PruneBand = { minAgeMs: number; maxAgeMs: number; bucketSec: number };

const PRUNE_BANDS: PruneBand[] = [
  { minAgeMs: SNAPSHOT_KEEP_5M_MS, maxAgeMs: SNAPSHOT_KEEP_30M_MS, bucketSec: 30 * 60 },
  { minAgeMs: SNAPSHOT_KEEP_30M_MS, maxAgeMs: SNAPSHOT_KEEP_1H_MS, bucketSec: 60 * 60 },
  { minAgeMs: SNAPSHOT_KEEP_1H_MS, maxAgeMs: SNAPSHOT_KEEP_4H_MS, bucketSec: 4 * 60 * 60 },
  { minAgeMs: SNAPSHOT_KEEP_4H_MS, maxAgeMs: SNAPSHOT_KEEP_1D_MS, bucketSec: 24 * 60 * 60 },
];

/** Last timestamp in each `bucketSec` slice. */
export function lastPerBucket(timestamps: number[], bucketSec: number): number[] {
  const last = new Map<number, number>();
  for (const t of timestamps) {
    if (!Number.isFinite(t)) continue;
    const b = Math.floor(t / 1000 / bucketSec);
    const prev = last.get(b);
    if (prev == null || t > prev) last.set(b, t);
  }
  return [...last.values()].sort((a, b) => a - b);
}

/**
 * Which sample timestamps survive a prune at `nowMs`. Keep every
 * 5-minute point inside 26 h; last-per-bucket after that; nothing
 * older than 400 days. Matches `public.prune_portfolio_snapshots`.
 */
export function pruneSnapshotTimestamps(timestamps: number[], nowMs: number): number[] {
  const sorted = timestamps.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const keep = new Set<number>();
  const keepAllAfter = nowMs - SNAPSHOT_KEEP_5M_MS;
  for (const t of sorted) {
    if (t >= keepAllAfter) keep.add(t);
  }
  for (const band of PRUNE_BANDS) {
    const lo = nowMs - band.maxAgeMs;
    const hi = nowMs - band.minAgeMs;
    const pts = sorted.filter((t) => t >= lo && t < hi);
    for (const t of lastPerBucket(pts, band.bucketSec)) keep.add(t);
  }
  return [...keep].sort((a, b) => a - b);
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
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
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
    const url = `${SB_URL}/functions/v1/prices?tickers=${encodeURIComponent(tickers.slice(0, 100).join(","))}`;
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

type TxRow = { type?: string; amount?: number; currency?: string; ticker?: string | null };

async function loadJsonArray(path: string): Promise<unknown[] | null> {
  if (!SB_URL || !SERVICE_KEY) return null;
  const PAGE = 1000;
  const all: unknown[] = [];
  let offset = 0;
  try {
    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(
        `${SB_URL}/rest/v1/${path}${sep}limit=${PAGE}&offset=${offset}`,
        {
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) return offset === 0 ? null : all;
      const body = await res.json();
      const rows = Array.isArray(body) ? body : [];
      all.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
      if (offset >= 50_000) break;
    }
    return all;
  } catch {
    return offset === 0 ? null : all;
  }
}

async function loadT212Cash(): Promise<T212Cash> {
  const [tx, orders, txSync] = await Promise.all([
    loadJsonArray("t212_transactions?select=type,amount,currency"),
    loadJsonArray("t212_orders?select=ticker"),
    loadJsonArray("t212_transactions_sync?select=complete"),
  ]);
  const complete = Array.isArray(txSync)
    && txSync.length > 0
    && txSync.every((r) => (r as { complete?: boolean })?.complete === true);
  return {
    complete,
    transactions: (tx || []) as TxRow[],
    orders: (orders || []) as TxRow[],
  };
}

async function upsertSnapshot(bucketTime: string, valueUsd: number, depositUsd: number): Promise<boolean> {
  if (!SB_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/portfolio_snapshots`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ts: bucketTime,
        value_usd: valueUsd,
        deposit_usd: depositUsd,
      }),
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

      const needed = quoteTickersNeeded(portfolio);
      const [quotes, t212Prices, t212Cash] = await Promise.all([
        fetchQuotes(needed),
        fetchAllT212Prices(),
        loadT212Cash(),
      ]);

      const valued = snapshotMarketValue(portfolio, quotes, t212Prices, now);
      const skip = skipReason(valued);
      if (skip) return json(200, { ok: true, skipped: skip });

      const depositUsd = snapshotDeposit(portfolio, quotes, t212Cash);
      if (!Number.isFinite(depositUsd)) {
        return json(200, { ok: true, skipped: "no-value" });
      }

      const bucketTime = bucketTimeIso(now.getTime());
      const ok = await upsertSnapshot(bucketTime, valued.value, depositUsd);
      if (!ok) return json(500, { ok: false, error: "db-write-failed" });
      return json(200, { ok: true, bucketTime, valueUsd: valued.value, depositUsd });
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      await reportServerError("snapshot-record.unhandled", { message: msg });
      return json(500, { ok: false, error: "internal" });
    }
  });
}
