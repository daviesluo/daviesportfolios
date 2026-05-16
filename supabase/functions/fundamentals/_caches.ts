// Cache layer for the fundamentals function. Two flavours of cache:
//
//   - `index_fundamentals_cache` keyed by ETF symbol (SPY/QQQ/...)
//     for the 4 big US indices. 24 h TTL — Alpha Vantage's free
//     tier hands out 25 calls/day, so a 24 h cache makes us fit
//     comfortably under that cap regardless of visitor count.
//
//   - `stock_fundamentals_cache` keyed by (symbol, includeEpsHistory)
//     for individual stocks. 2 h TTL — fundamentals shift quarterly
//     but the market re-rates them intraday, and 2 h is the sweet
//     spot between freshness and Yahoo mercy.
//
// Each pair (`readCachedX` + `writeCachedX`) silently no-ops when
// the SUPABASE_URL / SERVICE_ROLE_KEY env vars are missing, so the
// function still works in env-vars-not-yet-configured environments
// — just cache-bypass mode.

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  type Fundamentals,
} from "./_shared.ts";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const STOCK_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export async function readCachedPe(etfSymbol: string): Promise<{ pe: number; ageMs: number } | null> {
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
    if (!isFinite(fetchedAt)) return null;
    const pe = Number(row?.pe);
    if (!isFinite(pe) || pe <= 0) return null;
    return { pe, ageMs: Date.now() - fetchedAt };
  } catch {
    return null;
  }
}

export async function writeCachedPe(etfSymbol: string, pe: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/index_fundamentals_cache`;
    await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        symbol: etfSymbol,
        pe,
        fetched_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* best effort */ }
}

// Per-stock Fundamentals cache. `includeEpsHistory` is part of the
// key because the history-on payload contains arrays the lighter
// shape doesn't — sharing a row would have the lighter version
// overwrite the heavier mid-window.
export async function readCachedStockFundamentals(
  symbol: string,
  includeEpsHistory: boolean,
): Promise<{ payload: Fundamentals; ageMs: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/stock_fundamentals_cache` +
      `?symbol=eq.${encodeURIComponent(symbol)}` +
      `&include_eps_hist=eq.${includeEpsHistory}` +
      `&select=payload,fetched_at`;
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
    if (!isFinite(fetchedAt)) return null;
    const payload = row?.payload;
    if (!payload || typeof payload !== "object") return null;
    return { payload: payload as Fundamentals, ageMs: Date.now() - fetchedAt };
  } catch {
    return null;
  }
}

export async function writeCachedStockFundamentals(
  symbol: string,
  includeEpsHistory: boolean,
  payload: Fundamentals,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/stock_fundamentals_cache`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        symbol,
        include_eps_hist: includeEpsHistory,
        payload,
        fetched_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* best effort */ }
}
