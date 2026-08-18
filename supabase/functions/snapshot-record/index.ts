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
// Skip (200, recorded nothing) when live FX is missing or a priced
// ticker has no usable print — a 1:1 FX fallback writes a permanent
// spike. Leftover closed lots that still net long are included in
// Value so cron matches the scoreboard heal without writing board_data.
// Incomplete T212 history writes Value with deposit_usd NULL.
// The next tick is five minutes away.
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
  closed?: boolean;
  shares?: number;
  cost?: number;
  lastPrice?: number;
  currency?: string;
  t212Shares?: number;
  t212Cost?: number;
  lots?: Array<{ date?: string; shares?: number; cost?: number; source?: string }>;
  sells?: Array<{ date?: string; shares?: number; price?: number }>;
};

type Portfolio = {
  holdings?: Record<string, Holding>;
  positions?: Record<string, { tickers?: string[] }>;
  depositFxRates?: Record<string, number>;
};

export function positionedTickers(portfolio: Portfolio | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const pos of Object.values(portfolio?.positions || {})) {
    for (const t of pos?.tickers || []) out.add(t);
  }
  return out;
}

function leftoverLotShares(h: Holding | null | undefined): number {
  let shares = 0;
  for (const lot of h?.lots || []) {
    const n = Number(lot?.shares);
    if (Number.isFinite(n) && n > 0) shares += n;
  }
  for (const sell of h?.sells || []) {
    const n = Number(sell?.shares);
    if (Number.isFinite(n) && n > 0) shares -= n;
  }
  if (Math.abs(shares) < 1e-9) shares = 0;
  return shares;
}

export function quoteTickersNeeded(portfolio: Portfolio | null | undefined): string[] {
  const positioned = positionedTickers(portfolio);
  const tickers = new Set<string>();
  for (const [t, h] of Object.entries(portfolio?.holdings || {})) {
    if (!h || h.isCash || t === "CASH") continue;
    const boardShares = Number(h.shares);
    const onBoard = positioned.has(t) && Number.isFinite(boardShares) && boardShares > 0;
    if (!onBoard && leftoverLotShares(h) <= 1e-6) continue;
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
  if (!scopeAll) {
    for (const [t, h] of Object.entries(holdings)) {
      if (!h || h.isCash || t === "CASH" || positioned.has(t)) continue;
      if (leftoverLotShares(h) > 1e-6) keys.push(t);
    }
  }
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
    let shares = Number(h.shares);
    if (!Number.isFinite(shares) || shares <= 0) {
      shares = leftoverLotShares(h);
    }
    if (!Number.isFinite(shares) || shares <= 0) continue;
    value += shares * price * fx.rate;
  }
  return { value, fxMissing, missingPrice };
}

type DepositLot = { date?: string; shares?: number; cost?: number; source?: string };
type DepositSell = { date?: string; shares?: number; price?: number };
type DepositLedger = { lots: DepositLot[]; sells: DepositSell[] };

function ledgerPosition(lots: DepositLot[], sells: DepositSell[]): {
  shares: number;
  netCash: number;
} {
  let shares = 0;
  let netCash = 0;
  for (const l of lots) {
    const n = Number(l?.shares);
    const cost = Number(l?.cost);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(cost)) continue;
    shares += n;
    netCash += n * cost;
  }
  for (const s of sells) {
    const n = Number(s?.shares);
    const price = Number(s?.price);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(price)) continue;
    shares -= n;
    netCash -= n * price;
  }
  if (Math.abs(shares) < 1e-9) shares = 0;
  return { shares, netCash };
}

function residualLotCost(h: Holding, missingShares: number, existingNetCash: number): number {
  const cost = Number(h?.cost);
  const px = Number(h?.lastPrice);
  const shares = Number(h?.shares);
  if (Number.isFinite(cost) && Number.isFinite(shares) && missingShares > 0) {
    return (shares * cost - existingNetCash) / missingShares;
  }
  if (Number.isFinite(cost) && cost !== 0) return cost;
  if (Number.isFinite(px) && px > 0) return px;
  return Number.isFinite(cost) ? cost : 0;
}

export function historyLedgerFor(h: Holding): DepositLedger {
  const lots = Array.isArray(h?.lots) ? h.lots : [];
  const sells = Array.isArray(h?.sells) ? h.sells : [];
  const shares = Number(h?.shares);
  const hasLots = lots.some((l) => Number(l?.shares) > 0);
  if (h?.closed || !Number.isFinite(shares) || shares <= 0) {
    return { lots, sells };
  }
  if (!hasLots) {
    const cost = Number(h?.cost);
    const px = Number(h?.lastPrice);
    return {
      lots: [{
        date: "1970-01-01",
        shares,
        cost: Number.isFinite(cost) && cost > 0 ? cost : (Number.isFinite(px) && px > 0 ? px : 0),
      }],
      sells: [],
    };
  }
  const pos = ledgerPosition(lots, sells);
  const missingShares = shares - pos.shares;
  if (missingShares <= 1e-6) return { lots, sells };
  return {
    lots: [
      ...lots,
      {
        date: "1970-01-01",
        shares: missingShares,
        cost: residualLotCost(h, missingShares, pos.netCash),
        source: "opening-residual",
      },
    ],
    sells,
  };
}

function t212FillTickers(orders: Array<{ ticker?: string | null }> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(orders)) return out;
  for (const o of orders) {
    if (typeof o?.ticker === "string" && o.ticker) out.add(o.ticker);
  }
  return out;
}

export type T212Cash = {
  complete?: boolean;
  orders?: Array<{
    ticker?: string | null;
    executed_at?: string;
    side?: string;
    shares?: number;
    price?: number;
  }>;
};

function frozenDepositFxRate(
  currency: string | null | undefined,
  rates: Record<string, number> | null | undefined,
): number | null {
  if (!currency || currency === "USD") return 1;
  const rate = rates?.[currency];
  return typeof rate === "number" && rate > 0 ? rate : null;
}

function freezeDepositFxFromQuotes(
  existing: Record<string, number> | null | undefined,
  quotes: Record<string, Quote>,
): Record<string, number> {
  const out: Record<string, number> = { USD: 1, ...(existing || {}) };
  for (const currency of ["GBP", "EUR", "CNY", "HKD"] as const) {
    if (typeof out[currency] === "number" && out[currency] > 0) continue;
    const fx = fxRateToUSD(currency, quotes);
    if (!fx.missing && fx.rate > 0) out[currency] = fx.rate;
  }
  return out;
}

export function snapshotDepositFxMissing(
  portfolio: Portfolio | null | undefined,
): boolean {
  for (const [ticker, h] of Object.entries(portfolio?.holdings || {})) {
    if (h?.isCash || ticker === "CASH") continue;
    const currency = detectCurrency(ticker, h?.currency);
    if (currency === "USD") continue;
    const rate = portfolio?.depositFxRates?.[currency];
    if (!(typeof rate === "number" && rate > 0)) return true;
  }
  return false;
}

function t212LedgerForTicker(
  orders: T212Cash["orders"],
  ticker: string,
): DepositLedger {
  const lots: DepositLot[] = [];
  const sells: DepositSell[] = [];
  for (const o of orders || []) {
    if (o?.ticker !== ticker) continue;
    const executedAt = String(o?.executed_at || "");
    const date = executedAt.length >= 16
      ? executedAt.slice(0, 16)
      : executedAt.slice(0, 10);
    const shares = Number(o?.shares);
    const price = Number(o?.price);
    if (!date || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) continue;
    if (o?.side === "sell") sells.push({ date, shares, price });
    else lots.push({ date, shares, cost: price });
  }
  return { lots, sells };
}

export function depositLedgerForHolding(h: Holding, t212Ledger: DepositLedger): DepositLedger {
  if (t212Ledger.lots.length === 0) return historyLedgerFor(h);
  const rowKey = (row: DepositLot | DepositSell, field: "cost" | "price"): string => {
    const value = field === "cost"
      ? (row as DepositLot).cost
      : (row as DepositSell).price;
    return `${String(row?.date || "").slice(0, 10)}|${Number(row?.shares)}|${Number(value)}`;
  };
  const lotCounts = new Map<string, number>();
  const sellCounts = new Map<string, number>();
  for (const l of t212Ledger.lots) {
    const k = rowKey(l, "cost");
    lotCounts.set(k, (lotCounts.get(k) || 0) + 1);
  }
  for (const s of t212Ledger.sells) {
    const k = rowKey(s, "price");
    sellCounts.set(k, (sellCounts.get(k) || 0) + 1);
  }
  const unmatched = <T extends DepositLot | DepositSell>(
    rows: T[],
    counts: Map<string, number>,
    field: "cost" | "price",
  ): T[] => rows.filter((row) => {
    const k = rowKey(row, field);
    const n = counts.get(k) || 0;
    if (n <= 0) return true;
    counts.set(k, n - 1);
    return false;
  });
  const otherLots = unmatched(Array.isArray(h?.lots) ? h.lots : [], lotCounts, "cost");
  const otherSells = unmatched(Array.isArray(h?.sells) ? h.sells : [], sellCounts, "price");
  const exactOther = ledgerPosition(otherLots, otherSells);
  const combinedExact = {
    lots: [...otherLots, ...t212Ledger.lots],
    sells: [...otherSells, ...t212Ledger.sells],
  };

  const boardShares = Number(h?.shares);
  const boardCost = Number(h?.cost);
  if (!Number.isFinite(boardShares) || boardShares <= 0 || !Number.isFinite(boardCost)) {
    if (Math.abs(exactOther.shares) <= 1e-6) return combinedExact;
    const syntheticIndex = otherLots.findIndex((lot) =>
      Math.abs(Number(lot?.shares) - exactOther.shares) <= 1e-6
      && (lot?.source === "t212-synthetic" || String(lot?.date || "").startsWith("1970-"))
    );
    if (syntheticIndex >= 0) {
      const preservedLots = otherLots.filter((_, index) => index !== syntheticIndex);
      const preserved = ledgerPosition(preservedLots, otherSells);
      if (Math.abs(preserved.shares) <= 1e-6) {
        return {
          lots: [...preservedLots, ...t212Ledger.lots],
          sells: [...otherSells, ...t212Ledger.sells],
        };
      }
    }
    return t212Ledger;
  }
  const taggedShares = Number(h?.t212Shares);
  const t212Shares = Number.isFinite(taggedShares) && taggedShares >= 0
    ? taggedShares
    : Math.max(0, ledgerPosition(t212Ledger.lots, t212Ledger.sells).shares);
  const residualShares = Math.max(0, boardShares - t212Shares);
  const tolerance = Math.max(1e-6, residualShares * 1e-6);
  if (Math.abs(exactOther.shares - residualShares) <= tolerance) {
    return combinedExact;
  }
  const t212Position = ledgerPosition(t212Ledger.lots, t212Ledger.sells);
  const taggedCost = Number(h?.t212Cost);
  const t212CashForSplit = Number.isFinite(taggedShares) && taggedShares >= 0
      && Number.isFinite(taggedCost)
    ? taggedShares * taggedCost
    : t212Position.netCash;
  let otherCash = boardShares * boardCost - t212CashForSplit;
  if (!Number.isFinite(otherCash)) otherCash = residualShares * boardCost;
  const missingShares = residualShares - exactOther.shares;
  if (missingShares > 1e-6) {
    const missingCash = otherCash - exactOther.netCash;
    return {
      lots: [
        ...otherLots,
        ...t212Ledger.lots,
        {
          date: "1970-01-01",
          shares: missingShares,
          cost: Number.isFinite(missingCash) ? missingCash / missingShares : boardCost,
          source: "opening-residual",
        },
      ],
      sells: [...otherSells, ...t212Ledger.sells],
    };
  }
  if (residualShares <= 1e-6) return combinedExact;
  return {
    lots: [
      {
        date: "1970-01-01",
        shares: residualShares,
        cost: residualShares > 0 ? otherCash / residualShares : 0,
        source: "opening-residual",
      },
      ...t212Ledger.lots,
    ],
    sells: t212Ledger.sells,
  };
}

/**
 * Net deposited as of now — same question `netDepositNow` answers on
 * the client. T212 contributes actual fill quantity × price, net of
 * sells; account/card cash transactions never enter this figure.
 */
export function snapshotDeposit(
  portfolio: Portfolio | null | undefined,
  quotes: Record<string, Quote>,
  t212Cash: T212Cash | null | undefined,
): number {
  if (snapshotDepositFxMissing(portfolio)) return Number.NaN;
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
    const ledger = depositLedgerForHolding(
      h || {},
      t212LedgerForTicker(
        t212Cash?.complete === true ? t212Cash?.orders : [],
        ticker,
      ),
    );
    const depositFx = frozenDepositFxRate(
      detectCurrency(ticker, h?.currency),
      portfolio?.depositFxRates,
    );
    if (depositFx == null) return Number.NaN;
    for (const l of ledger.lots) {
      const n = Number(l.shares);
      const c = Number(l.cost);
      if (!Number.isFinite(n) || n <= 0) continue;
      // Same rule as the client: deposit is not revalued at live FX.
      if (Number.isFinite(c)) netDeposit += n * c * depositFx;
    }
    for (const sl of ledger.sells) {
      const n = Number(sl?.shares);
      const px = Number(sl?.price);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (Number.isFinite(px)) netDeposit -= n * px * depositFx;
    }
  }
  return netDeposit + cashUSD;
}

export function skipReason(v: SnapshotValue): "fx-missing" | "no-price" | "no-value" | null {
  if (v.fxMissing) return "fx-missing";
  if (v.missingPrice) return "no-price";
  if (!Number.isFinite(v.value) || v.value < 0) return "no-value";
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

type TxRow = {
  id?: string;
  ticker?: string | null;
  executed_at?: string;
  side?: string;
  shares?: number;
  price?: number;
};

async function loadJsonArray(path: string): Promise<{ rows: unknown[]; ok: boolean }> {
  if (!SB_URL || !SERVICE_KEY) return { rows: [], ok: false };
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
      if (!res.ok) return { rows: [], ok: false };
      const body = await res.json();
      if (!Array.isArray(body)) return { rows: [], ok: false };
      const rows = body;
      all.push(...rows);
      if (rows.length < PAGE) return { rows: all, ok: true };
      offset += PAGE;
      if (offset >= 50_000) return { rows: [], ok: false };
    }
  } catch {
    return { rows: [], ok: false };
  }
}

async function loadT212Cash(): Promise<T212Cash> {
  const syncPath = "t212_orders_sync"
    + "?select=account,complete,fetched,cursor,updated_at&order=account.asc";
  const before = await loadJsonArray(syncPath);
  let orderRead = await loadJsonArray(
    "t212_orders?select=id,ticker,executed_at,side,shares,price"
      + "&order=executed_at.asc,id.asc",
  );
  const after = await loadJsonArray(syncPath);
  let stableSync = after;
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
    orderRead = await loadJsonArray(
      "t212_orders?select=id,ticker,executed_at,side,shares,price"
        + "&order=executed_at.asc,id.asc",
    );
    const final = await loadJsonArray(syncPath);
    stableSync = JSON.stringify(after.rows) === JSON.stringify(final.rows)
      ? final
      : { rows: [], ok: false };
  }
  const expectedAccounts = T212_ISA_API_KEY ? 2 : 1;
  const complete = before.ok && after.ok && stableSync.ok && orderRead.ok
    && stableSync.rows.length === expectedAccounts
    && stableSync.rows.every((row) => (row as { complete?: boolean })?.complete === true);
  return {
    complete,
    orders: orderRead.rows as TxRow[],
  };
}

async function upsertSnapshot(
  bucketTime: string,
  valueUsd: number,
  depositUsd: number | null,
): Promise<boolean> {
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

      let portfolioForDeposit = portfolio;
      if (snapshotDepositFxMissing(portfolio)) {
        const frozen = freezeDepositFxFromQuotes(portfolio.depositFxRates, quotes);
        portfolioForDeposit = { ...portfolio, depositFxRates: frozen };
      }
      if (snapshotDepositFxMissing(portfolioForDeposit)) {
        return json(200, { ok: true, skipped: "deposit-fx-missing" });
      }
      const ordersReady = t212Cash.complete === true;
      const depositUsd = ordersReady
        ? snapshotDeposit(portfolioForDeposit, quotes, t212Cash)
        : null;
      if (ordersReady && !Number.isFinite(depositUsd)) {
        return json(200, { ok: true, skipped: "no-value" });
      }

      const bucketTime = bucketTimeIso(now.getTime());
      const ok = await upsertSnapshot(bucketTime, valued.value, depositUsd);
      if (!ok) return json(500, { ok: false, error: "db-write-failed" });
      return json(200, {
        ok: true,
        bucketTime,
        valueUsd: valued.value,
        depositUsd,
        depositComplete: ordersReady,
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      await reportServerError("snapshot-record.unhandled", { message: msg });
      return json(500, { ok: false, error: "internal" });
    }
  });
}
