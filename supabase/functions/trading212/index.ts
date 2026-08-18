// Supabase Edge Function: trading212
//
// Mirrors a small slice of the owner's Trading 212 portfolio — just
// `quantity` and `averagePricePaid` for a hard-coded allow-list of tickers
// the user DCAs through T212 (currently `VUAA.L` and `SAEM.L`, the
// two USD-denominated UCITS ETFs the user buys daily — T212's
// cashback + Spare-Change auto-invest both settle in USD, which is
// why the previous GBP-denominated VUAG.L / SEGM.L were swapped out
// to avoid an avoidable round-trip FX hit on every micro-buy). Lets
// the app pick up new T212 buys without the user typing each lot
// into the EditTickerModal.
//
//   GET /functions/v1/trading212
//     →  { holdings: { 'VUAA.L': { shares, cost }, 'SAEM.L': { ... } },
//          prices:   { 'VUAA.L': 98.4, 'AAPL': 234.5, ... },
//          updatedAt: ISO-string,
//          source: 'cache' | 'live' | 'stale' | 'disabled' }
//
// Two maps, two purposes:
//
//   `holdings` — the auto-sync ALLOW-LIST only (VUAA.L / SAEM.L). Each
//     is `{ shares, cost }`; `cost` is per-share AC in the instrument's
//     settle currency (USD — these are USD-denominated UCITS ETFs on
//     LSE, so `averagePricePaid` passes through unchanged, NOT the
//     GBp/pence Yahoo uses for GBP-side LSE listings). `shares` is
//     T212's `quantity`. The client folds each into
//     `holding.lots = [{ date: today, shares, cost }]` (a single
//     synthetic lot) + sets shares/cost. lot.cost / h.cost is per-share
//     AC everywhere; metrics.js multiplies `h.shares * h.cost`.
//
//   `prices` — EVERY recognised T212 holding (generic ticker map, e.g.
//     `AAPL_US_EQ → AAPL`), `ticker → currentPrice` (USD). The client
//     uses these as overnight "night market" quotes: for a US equity it
//     ALSO holds, during the overnight window (20:00–04:00 ET) with the
//     Extended Hours toggle on, it shows T212's price instead of the
//     stale Yahoo close. Regular / pre / post hours keep Yahoo. These
//     never touch shares/cost — display only. The two DCA ETFs appear
//     here too but the client ignores them (they're not US equities and
//     have no overnight session).
//
// All visitors call this on every doRefresh, so the response is
// cached server-side at `public.trading212_cache` for 1 s. T212's
// `/equity/positions` rate limit is 1 req / 1 s, applied per account
// (not per IP / key), so a 1 s TTL is the floor that stays within the
// limit while letting a manual refresh feel instant — a click lands
// fresh data unless the last upstream call was under a second ago. To
// kill the boundary race entirely — two workers racing past the
// freshness check on a stale row and both firing live T212 calls in
// the same rate-limit window — refresh is also gated by an atomic
// Postgres claim (`try_claim_t212_refresh` RPC, conditional UPSERT).
// Only the worker that successfully updates `updated_at` calls T212;
// losers serve whatever the winner already wrote.
//
// `T212_API_KEY` env var is required for live calls — T212's
// documented public API auth is a single key passed as the raw
// `Authorization` header value (no `Bearer ` prefix, no Basic
// encoding; see https://t212public-api-docs.redoc.ly/). The
// optional `T212_API_SECRET` is used as a fallback HTTP Basic Auth
// password in case the account / API version actually requires the
// two-key scheme. When `T212_API_KEY` is absent the function
// returns `source: 'disabled'` + empty holdings so the client can
// no-op. T212 errors fall back to stale cache up to STALE_OK_MS old.
//
// `T212_ISA_API_KEY` (+ optional `T212_ISA_API_SECRET`) is the SECOND
// account. T212 scopes its public API per account, so ISA holdings —
// and crucially their live overnight prices — are only reachable with
// the ISA key. When set, the ISA portfolio is fetched in parallel and
// merged in (prices union'd; shares/cost summed for any allow-list
// ticker held in both). Best-effort: an ISA fetch failure degrades to
// invest-only. Absent → invest-only, exactly as before.
//
// Token-gated by the same HMAC-signed `x-app-token` the `data` /
// `ops-error` functions use — admin OR ro is accepted, since the
// read-only "screenshot" mode is supposed to see synced holdings
// the same way it sees the rest of the portfolio. Holdings are PII
// and an anonymous endpoint would leak the owner's share counts
// and average cost to anyone with the function URL. Requires the
// `APP_AUTH_SECRET` env var (same value as the `auth` function).

// Yahoo ticker → T212 internal ticker. The T212 convention for LSE is
// `<TICKER>l_EQ` (lowercase 'l' exchange suffix + `_EQ`). This explicit
// map is the **holdings auto-sync allow-list** — only these tickers get
// their shares/cost mirrored into the portfolio (the user's DCA ETFs).
// Both entries are USD-denominated UCITS ETFs on LSE — see fx.js
// TICKER_CURRENCY_OVERRIDES for the client-side currency override that
// stops the suffix-based `detectCurrency` mis-detecting them as GBP.
import { reportServerError } from "../_shared/ops.ts";
import { verifyToken } from "../_shared/token.ts";

// Re-exported so this function's index.test.ts keeps pinning the exact
// implementation the token gate below trusts.
export { b64url, constantTimeEqual, sign, verifyToken } from "../_shared/token.ts";

const T212_TO_YAHOO: Record<string, string> = {
  "VUAAl_EQ": "VUAA.L",
  "SAEMl_EQ": "SAEM.L",
};

// Renamed / merged US tickers. T212 assigns an instrument's internal
// ticker at first listing and DOESN'T rewrite it through a corporate
// rename, ticker swap, or SPAC merger — so the API keeps returning the
// ORIGINAL symbol long after the stock trades under a new one. The
// generic `_US_EQ` rule below would map these to the stale symbol
// (`FB_US_EQ → FB`), which never matches the board's current ticker, so
// the overnight price silently never lands. This explicit alias table
// maps the stale T212 code → the current Yahoo ticker.
//
// IMPORTANT: this is the PRICE-map alias only — distinct from
// `T212_TO_YAHOO` above, which doubles as the shares/cost auto-sync
// allow-list. Entries here feed `prices` (overnight quotes) ONLY; they
// never sync shares/cost (the user manages those holdings manually).
//   FB   → META   (Facebook renamed to Meta, 2022)
//   YNDX → NBIS   (Yandex N.V. → Nebius Group, relisted 2024)
//   IIVI → COHR   (II-VI Incorporated → Coherent Corp, 2022)
//   VACQ → RKLB   (Vector Acquisition SPAC → Rocket Lab, 2021)
//   LOKB → NVTS   (Live Oak Acq. II SPAC → Navitas, 2021)
//   GOOGL→ GOOG   (T212 lists Alphabet's class-A line; the board tracks
//                  the class-C GOOG ticker — the two track within a
//                  fraction of a % so it's a faithful overnight proxy)
const T212_US_ALIASES: Record<string, string> = {
  "FB_US_EQ": "META",
  "YNDX_US_EQ": "NBIS",
  "IIVI_US_EQ": "COHR",
  "VACQ_US_EQ": "RKLB",
  "LOKB_US_EQ": "NVTS",
  "GOOGL_US_EQ": "GOOG",
};

// Generic T212-internal → Yahoo ticker mapping, used to build the
// `prices` map for EVERY T212 holding (not just the allow-list above).
// The client uses these as overnight ("night market") quotes for any
// US equity it also holds — so a US stock the user buys in T212 picks
// up the broker's overnight price automatically, no allow-list edit.
//   AAPL_US_EQ → AAPL   (US: strip the _US_EQ suffix)
//   VUAAl_EQ   → VUAA.L (LSE: lowercase-l suffix → .L)
//   FB_US_EQ   → META   (renamed/merged: via T212_US_ALIASES)
// Returns null for shapes we don't recognise (other exchanges) so they
// simply don't get a price entry.
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

// Executed-fill history. Unlike `/equity/positions` (a snapshot of what
// is held) this carries the DATES — which is the one thing the position
// endpoint can't tell us and the whole reason the lot ledger has been
// guessing. Rate limited far harder than positions, so it's backfilled
// one page at a time into `t212_orders` and read from there afterwards.
export const T212_ORDERS_URL = "https://live.trading212.com/api/v0/equity/history/orders";

/**
 * Normalise one row of T212's order history into a lot-shaped record.
 *
 * Defensive about field names on purpose: this endpoint has never been
 * exercised here, the shape isn't pinned by anything we control, and a
 * silently-dropped fill is a hole in someone's purchase history. Reads
 * the filled quantity in preference to the ordered one (a partial fill
 * bought what it bought), derives the price from `fillCost` when
 * `fillPrice` is absent, and takes the earliest of the execution
 * timestamps that is actually present.
 *
 * The published payload is nested `{ fill, order }` (fill.id / price /
 * quantity / filledAt, order.instrument.ticker / order.side) — not the
 * flat ticker/filledQuantity row the first shaper expected. A page of
 * that nested shape parsed to 0 rows while the cursor still advanced,
 * so the backfill walked the history storing nothing. `flattenT212OrderItem`
 * unwraps it; the original flat fixtures still round-trip.
 *
 * Returns null for anything that isn't a completed fill with a real
 * quantity and price — an open, cancelled or rejected order didn't move
 * any money and has no place in the ledger.
 */
export function flattenT212OrderItem(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fill = (o.fill && typeof o.fill === "object") ? o.fill as Record<string, unknown> : null;
  const order = (o.order && typeof o.order === "object") ? o.order as Record<string, unknown> : null;
  if (!fill && !order) return o;

  const ord = order ?? {};
  const fl = fill ?? {};
  const instrument = (ord.instrument && typeof ord.instrument === "object")
    ? ord.instrument as Record<string, unknown>
    : {};
  const wallet = (fl.walletImpact && typeof fl.walletImpact === "object")
    ? fl.walletImpact as Record<string, unknown>
    : {};
  const ticker = (typeof instrument.ticker === "string" && instrument.ticker)
    || (typeof ord.ticker === "string" && ord.ticker)
    || (typeof o.ticker === "string" && o.ticker)
    || "";
  return {
    ticker,
    status: ord.status ?? o.status,
    side: ord.side ?? o.side,
    filledQuantity: fl.quantity ?? ord.filledQuantity ?? o.filledQuantity,
    fillPrice: fl.price ?? o.fillPrice ?? ord.limitPrice,
    fillCost: wallet.netValue ?? ord.filledValue ?? o.fillCost,
    fillId: fl.id ?? o.fillId,
    id: ord.id ?? o.id,
    dateExecuted: fl.filledAt ?? o.dateExecuted,
    dateCreated: ord.createdAt ?? o.dateCreated,
    dateModified: ord.modifiedAt ?? o.dateModified,
  };
}

/** True when a page arrived but nothing in it could be stored. */
export function ordersPageShapeMismatch(itemCount: number, parsedCount: number): boolean {
  return itemCount > 0 && parsedCount === 0;
}

export function shapeT212Order(raw: unknown, account: string): {
  id: string;
  account: string;
  t212_ticker: string;
  ticker: string | null;
  executed_at: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
} | null {
  const o = flattenT212OrderItem(raw);
  if (!o) return null;
  const num = (v: unknown): number | null =>
    (typeof v === "number" && isFinite(v)) ? v
      : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

  // A status field only rules a row OUT — absent means we can't tell, and
  // dropping every row of an unfamiliar shape would silently produce an
  // empty history rather than an error anyone would notice.
  const status = typeof o.status === "string" ? o.status.toUpperCase() : "";
  if (status && !/FILL|EXECUT|COMPLET/.test(status)) return null;

  const t212Ticker = typeof o.ticker === "string" ? o.ticker : "";
  if (!t212Ticker) return null;

  const qty = num(o.filledQuantity) ?? num(o.orderedQuantity) ?? num(o.quantity);
  if (qty == null || qty === 0) return null;

  // Nested history reports `order.side` (BUY/SELL) with a positive
  // quantity. The older flat payload signed a sale negative. Either
  // witness is enough; a sale that broke even still has a side.
  const declared = typeof o.side === "string" ? o.side.toUpperCase() : "";
  const side: "buy" | "sell" = qty < 0 || declared === "SELL" ? "sell" : "buy";
  const shares = Math.abs(qty);

  const cost = num(o.fillCost) ?? num(o.filledValue) ?? num(o.orderedValue);
  const price = num(o.fillPrice) ?? num(o.limitPrice)
    ?? (cost != null && shares > 0 ? Math.abs(cost) / shares : null);
  if (price == null || !(price > 0)) return null;

  const when = [o.dateExecuted, o.dateModified, o.dateCreated]
    .find((d) => typeof d === "string" && !isNaN(Date.parse(d as string)));
  if (!when) return null;

  // Prefer the FILL id: one order can fill in several parts, and keying
  // on the order id would collapse them into one row and lose shares.
  const id = String(o.fillId ?? o.id ?? `${account}:${t212Ticker}:${when}:${qty}`);

  return {
    id: `${account}:${id}`,
    account,
    t212_ticker: t212Ticker,
    ticker: t212TickerToYahoo(t212Ticker),
    executed_at: new Date(when as string).toISOString(),
    side,
    shares,
    price: Math.abs(price),
  };
}

/**
 * The cursor for the next page, or null at the end of the history.
 *
 * T212 hands back a whole path (`/api/v0/equity/history/orders?cursor=…`)
 * rather than a bare cursor, and some wrappers expose `nextPagePath` as
 * an object. Pull the parameter out of whichever shape arrived; null
 * means the walk is finished, which is what latches `complete`.
 */
export function nextOrdersCursor(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const raw = b.nextPagePath ?? b.nextPage ?? b.next;
  const path = typeof raw === "string" ? raw
    : (raw && typeof raw === "object" ? String((raw as Record<string, unknown>).path ?? "") : "");
  if (!path) return null;
  const m = path.match(/[?&]cursor=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The `items` array, whatever the envelope calls it. */
export function ordersItemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  for (const k of ["items", "data", "orders", "results"]) {
    if (Array.isArray(b[k])) return b[k] as unknown[];
  }
  return [];
}

// 1 s cache. `/equity/positions` allows 1 req / second, so this is the
// floor that keeps us within the limit while making a manual refresh
// feel instant (a click lands fresh data unless the last call was <1 s
// ago). The auto-refresh tick (30 s regular / overnight) easily clears
// it. The atomic claim (`try_claim_t212_refresh`, gated on this same
// TTL) still coordinates devices so concurrent refreshes can't burst
// past 1 call / s. (Was 30 s back when the endpoint was the
// harder-limited `/equity/portfolio`.)
const CACHE_TTL_MS = 1_000;
const STALE_OK_MS  = 5 * 60_000;    // serve stale up to 5 min on upstream error

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_AUTH_SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";
const T212_API_KEY    = Deno.env.get("T212_API_KEY") ?? "";
const T212_API_SECRET = Deno.env.get("T212_API_SECRET") ?? "";
// Second T212 account (ISA). Same shape as the invest keys above —
// T212 scopes its public API per account, so the ISA holdings (and
// their live overnight prices) are only reachable with the ISA key.
// Optional: absent → invest-only, exactly as before.
const T212_ISA_API_KEY    = Deno.env.get("T212_ISA_API_KEY") ?? "";
const T212_ISA_API_SECRET = Deno.env.get("T212_ISA_API_SECRET") ?? "";

// `/equity/positions` (T212's current endpoint; the older
// `/equity/portfolio` it replaced is rate-limited far harder). Same
// base + raw-key auth. Returns an array of position objects shaped
// `{ instrument: { ticker, … }, quantity, averagePricePaid,
// currentPrice, … }` — note the ticker is nested under `instrument`
// and the cost field is `averagePricePaid` (the old endpoint used a
// flat `ticker` + `averagePrice`); shapeT212Portfolio reads both
// shapes. Documented rate limit: 1 req / second.
const T212_POSITIONS_URL = "https://live.trading212.com/api/v0/equity/positions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

// HMAC-signed token verification lives in ../_shared/token.ts
// (imported + re-exported at the top of this file) — the canonical
// copy this function used to duplicate inline. The shared module reads
// APP_AUTH_SECRET itself; the verifyToken call below passes no secret.

/**
 * Extract T212's internal ticker from one position object, tolerating
 * both endpoint shapes. `/equity/positions` (current) nests it under an
 * `instrument` object — `{ instrument: { ticker: "AAPL_US_EQ", name,
 * isin, currency }, … }`. The older `/equity/portfolio` had a flat
 * top-level `ticker`. A couple of community wrappers also expose
 * `instrument` as a bare ticker string, so accept that too. Returns
 * null for anything that isn't a non-empty string ticker.
 */
function positionTicker(p: object): string | null {
  const inst = (p as { instrument?: unknown }).instrument;
  if (typeof inst === "string" && inst) return inst;
  if (inst && typeof inst === "object") {
    const t = (inst as { ticker?: unknown }).ticker;
    if (typeof t === "string" && t) return t;
  }
  const flat = (p as { ticker?: unknown }).ticker;
  if (typeof flat === "string" && flat) return flat;
  return null;
}

/**
 * Normalise a raw T212 `/equity/positions` response into two maps:
 *
 *   - `holdings` — the **auto-sync allow-list** only (VUAA.L / SAEM.L):
 *     `{ shares, cost }` per ticker. `cost` comes from `averagePricePaid`
 *     (`/equity/positions`; the old `/equity/portfolio` called it
 *     `averagePrice`) — taken verbatim, in the instrument's settle
 *     currency (USD per share — these are USD-denominated UCITS, not
 *     pence). `cost` is per-share AC; computeMetrics multiplies by
 *     `shares`. This is what overwrites the portfolio's lots/shares/cost.
 *
 *   - `prices` — EVERY recognised T212 holding (generic ticker map):
 *     `ticker → currentPrice` (USD). The client uses these as overnight
 *     "night market" quotes for any US equity it also holds; they never
 *     touch shares/cost, only the displayed price during the overnight
 *     window. Non-positive / missing currentPrice → no entry.
 *
 * Reads the ticker via `positionTicker` so the nested-`instrument` and
 * flat shapes both work. Pure function so `index.test.ts` can pin the
 * mapping + filtering without needing the network.
 */
export function shapeT212Portfolio(
  positions: unknown,
): {
  holdings: Record<string, { shares: number; cost: number }>;
  prices: Record<string, number>;
} {
  const holdings: Record<string, { shares: number; cost: number }> = {};
  const prices: Record<string, number> = {};
  if (!Array.isArray(positions)) return { holdings, prices };
  for (const p of positions) {
    if (!p || typeof p !== "object") continue;
    const t212Ticker = positionTicker(p);
    if (!t212Ticker) continue;
    const yahooTicker = t212TickerToYahoo(t212Ticker);
    if (!yahooTicker) continue;

    // Price map: every recognised holding with a positive currentPrice.
    const currentPrice = Number((p as { currentPrice?: unknown }).currentPrice);
    if (isFinite(currentPrice) && currentPrice > 0) {
      prices[yahooTicker] = currentPrice;
    }

    // Holdings (shares/cost) sync: allow-list only. Cost field is
    // `averagePricePaid` on `/equity/positions`, `averagePrice` on the
    // legacy `/equity/portfolio` — accept whichever is present.
    if (T212_TO_YAHOO[t212Ticker]) {
      const quantity = Number((p as { quantity?: unknown }).quantity);
      const cost = Number(
        (p as { averagePricePaid?: unknown }).averagePricePaid ??
          (p as { averagePrice?: unknown }).averagePrice,
      );
      if (isFinite(quantity) && quantity > 0 && isFinite(cost) && cost > 0) {
        holdings[yahooTicker] = { shares: quantity, cost };
      }
    }
  }
  return { holdings, prices };
}

/**
 * Cache-shape compat unpacker. The cached `data` is `{ holdings, prices }`
 * since this version; older rows stored the holdings map directly. Treat
 * a row without a `holdings` key as the legacy shape so a deploy doesn't
 * blank the response between the migration and the first live refresh.
 */
export function unpackCache(
  data: unknown,
): { holdings: Record<string, unknown>; prices: Record<string, number> } {
  if (data && typeof data === "object" && !Array.isArray(data) && "holdings" in (data as object)) {
    const d = data as { holdings?: Record<string, unknown>; prices?: Record<string, number> };
    return { holdings: d.holdings ?? {}, prices: d.prices ?? {} };
  }
  return { holdings: (data as Record<string, unknown>) ?? {}, prices: {} };
}

/**
 * Merge two shaped portfolios (e.g. invest + ISA accounts) into one.
 * `prices` is a plain union — a ticker held in both accounts is the same
 * instrument with the same `currentPrice`, so either wins. `holdings`
 * (the shares/cost auto-sync allow-list) is summed when a ticker appears
 * in both: total shares + share-weighted average cost, so a position
 * split across accounts mirrors its combined size. Pure, for testing.
 */
export function mergeShaped(
  a: { holdings: Record<string, { shares: number; cost: number }>; prices: Record<string, number> },
  b: { holdings: Record<string, { shares: number; cost: number }>; prices: Record<string, number> },
): { holdings: Record<string, { shares: number; cost: number }>; prices: Record<string, number> } {
  const prices = { ...a.prices, ...b.prices };
  const holdings: Record<string, { shares: number; cost: number }> = { ...a.holdings };
  for (const [t, h] of Object.entries(b.holdings)) {
    const ex = holdings[t];
    if (ex) {
      const totalShares = ex.shares + h.shares;
      const cost = totalShares > 0 ? (ex.shares * ex.cost + h.shares * h.cost) / totalShares : 0;
      holdings[t] = { shares: totalShares, cost };
    } else {
      holdings[t] = h;
    }
  }
  return { holdings, prices };
}

/**
 * Pure freshness predicate so the test suite can pin TTL behaviour
 * without faking Date. Returns true when the cache row was written
 * `ttlMs` or fewer ms ago.
 */
export function cacheIsFresh(updatedAt: string | null, nowMs: number, ttlMs: number): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (!isFinite(t)) return false;
  return nowMs - t < ttlMs;
}

/**
 * Build the HTTP Basic Auth header value for T212. T212's current
 * scheme uses two keys — API key id and secret — concatenated with
 * a colon and base64 encoded, same as standard HTTP Basic.
 *
 * Pure function so the test suite can pin the encoding without
 * exposing real secrets.
 */
export function basicAuthHeader(keyId: string, secret: string): string {
  return "Basic " + btoa(`${keyId}:${secret}`);
}

async function readCacheRow(): Promise<{ data: unknown; updated_at: string } | null> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/trading212_cache?id=eq.1&select=data,updated_at`, {
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch {
    return null;
  }
}

/**
 * Atomic refresh claim. Returns true iff this worker won the right
 * to call T212 for this window. Implemented as a Postgres RPC
 * (`try_claim_t212_refresh`, added in migration 0008) that does a
 * conditional UPSERT — bumps `updated_at` only when the existing
 * row is older than ttl_ms (or no row exists), and returns whether
 * the row was actually written. `INSERT ... ON CONFLICT DO UPDATE
 * WHERE` is atomic, so two workers racing the call see at most one
 * true return value. RPC failures (network, missing migration, bad
 * permissions) log to Supabase Functions logs but don't surface in
 * the client response — the loser branch is the right behaviour
 * either way.
 */
async function claimRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/try_claim_t212_refresh`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_ms: CACHE_TTL_MS }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      // Loud detection of the two "missing migration" symptoms we've
      // hit before: 42P01 (relation does not exist → 0007 not applied)
      // and 42883 (function does not exist → 0008 not applied). Without
      // this hint the loser-branch silently swallows the cause and the
      // UI shows "T212 just stopped working" with no pointer.
      if (snippet.includes("42P01") || snippet.includes("42883")) {
        console.error(
          `T212 claim RPC ${res.status} — Postgres reports a missing table or function. ` +
          `Re-apply migrations 0007 (trading212_cache) and 0008 (try_claim_t212_refresh) ` +
          `via Supabase SQL Editor. Raw: ${snippet}`,
        );
      } else {
        console.error(`T212 claim RPC ${res.status}: ${snippet}`);
      }
      return false;
    }
    const body = await res.json();
    return body === true;
  } catch (e) {
    console.error("T212 claim RPC error:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function writeCacheRow(data: unknown): Promise<void> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/trading212_cache`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: 1, data, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
    // Check the HTTP status too — previously only thrown errors (network /
    // timeout) hit the catch; a 4xx/5xx PostgREST response was silently
    // dropped. That's the scenario that walks into the T212 ban-storm: if
    // RLS / migration / quota fails the row never lands, every subsequent
    // visitor passes the staleness check, claims the refresh, and calls
    // T212 again — burning through the 1-req-per-second rate limit.
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      // Loud detection of the missing-migration smell we hit during the T212
      // rollout — surfaces the specific Postgres error code in the function
      // logs so the maintainer can see which migration to re-apply.
      const hint = (snippet.includes("42P01") || snippet.includes("42883"))
        ? " — re-apply migration 0007 (trading212_cache table) and/or 0008 (try_claim_t212_refresh RPC) via Supabase SQL Editor."
        : "";
      console.error(`T212 cache write ${res.status} ${res.statusText}: ${snippet}${hint}`);
    }
  } catch (e) {
    // Cache write failures are non-fatal — next visitor will refetch.
    // Log so a chronic outage doesn't silently mean every refresh hits T212.
    console.error("T212 cache write failed:", e instanceof Error ? e.message : e);
  }
}

async function fetchT212Portfolio(apiKey: string, apiSecret: string): Promise<unknown> {
  // Auth scheme. T212's two-key accounts authenticate with HTTP Basic
  // (`base64(key:secret)`); single-key accounts pass the raw API key as
  // the Authorization value. When a secret is configured we go STRAIGHT
  // to Basic — empirically these accounts 401 the raw-key attempt, so
  // trying it first just burned a doomed round-trip AND fired a second
  // request inside the same second, which risks T212's 1-req/s rate
  // limit (a 429 on the real call). The OTHER scheme is kept as a 401
  // fallback so a single-key account (no secret) still works and a
  // mis-paired key/secret still gets a second chance. Parameterised by
  // key/secret so the same path serves both the invest and ISA accounts
  // (T212 scopes its API per account).
  const attempts = apiSecret
    ? [basicAuthHeader(apiKey, apiSecret), apiKey] // two-key account: Basic first
    : [apiKey];                                    // single-key account: raw only
  let res!: Response;
  for (const authorization of attempts) {
    res = await fetch(T212_POSITIONS_URL, {
      headers: { authorization, accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status !== 401) break; // success or a non-auth error → don't burn the fallback
  }
  if (!res.ok) {
    // Include a short body snippet so the catch-path's `error` field
    // can show what T212 actually said — without it `stale` is opaque
    // and you can't tell auth-fail from rate-limit from endpoint-404.
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`T212 ${res.status} ${res.statusText} :: ${snippet}`);
  }
  return await res.json();
}

/**
 * One page of executed-fill history for one account.
 *
 * Same auth dance as the positions call — Basic first when a secret is
 * configured, raw key as the 401 fallback. A 403 is called out
 * separately because it means something a retry will never fix: T212
 * scopes its API keys, and a key generated without the History
 * permission authenticates fine and then refuses this endpoint. Without
 * the distinction that reads as "the sync is broken" rather than "tick
 * the box and regenerate the key".
 */
async function fetchT212OrdersPage(
  apiKey: string,
  apiSecret: string,
  cursor: string | null,
  limit = 50,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const url = new URL(T212_ORDERS_URL);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  const attempts = apiSecret ? [basicAuthHeader(apiKey, apiSecret), apiKey] : [apiKey];
  let res!: Response;
  for (const authorization of attempts) {
    res = await fetch(url.toString(), {
      headers: { authorization, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 401) break;
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    const hint = res.status === 403
      ? " — the API key authenticates but is not permitted to read history. " +
        "Regenerate it in Trading 212 with the History scope enabled."
      : res.status === 429
      ? " — rate limited; this endpoint allows only a few calls a minute. Try again shortly."
      : "";
    return { ok: false, status: res.status, message: `T212 ${res.status} ${res.statusText}${hint} :: ${snippet}` };
  }
  return { ok: true, body: await res.json() };
}

/** Upsert a batch of shaped fills. Idempotent on the fill id. */
async function writeOrders(rows: unknown[]): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/t212_orders`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      const hint = snippet.includes("42P01")
        ? " — apply migration 0023 (t212_orders) via Supabase SQL Editor."
        : "";
      console.error(`T212 orders write ${res.status}: ${snippet}${hint}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("T212 orders write error:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function readOrdersSync(account: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_orders_sync?account=eq.${encodeURIComponent(account)}&select=*`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, accept: "application/json" },
        signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch {
    return null;
  }
}

async function writeOrdersSync(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/t212_orders_sync`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.error("T212 orders sync-state write error:", e instanceof Error ? e.message : e);
  }
}

/** Every stored fill, oldest first, for the client to rebuild lots from. */
async function readOrders(): Promise<unknown[]> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_orders?select=ticker,executed_at,side,shares,price,account&order=executed_at.asc&limit=5000`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, accept: "application/json" },
        signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`T212 orders read ${res.status}: ${snippet}`);
      return [];
    }
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Advance the backfill by ONE page for one account.
 *
 * One page per invocation because the history endpoint allows only a
 * handful of calls a minute — walking the whole history inside a single
 * request would spend most of it rate limited and time out. The cursor
 * is remembered between calls, so the client just keeps asking until
 * `complete` comes back true.
 */
async function syncOrdersOnce(
  account: string,
  apiKey: string,
  apiSecret: string,
): Promise<Record<string, unknown>> {
  const state = await readOrdersSync(account);
  const done = state?.complete === true;
  // Once the walk has finished, keep re-reading the FIRST page rather
  // than stopping for good: it holds the newest fills, and the upsert
  // makes re-reading it free. Without this a completed backfill would
  // never notice another purchase.
  const cursor = done ? null : (typeof state?.cursor === "string" ? state.cursor : null);
  const page = await fetchT212OrdersPage(apiKey, apiSecret, cursor);
  if (!page.ok) {
    await writeOrdersSync({ account, cursor, complete: done, fetched: state?.fetched ?? 0, last_error: page.message });
    // `scopeDenied` is the one failure a retry can never fix, so the
    // caller can stop rather than grind against it.
    return {
      account, error: page.message, status: page.status,
      complete: done, added: 0, scopeDenied: page.status === 403,
    };
  }
  const items = ordersItemsOf(page.body);
  const rows = items
    .map((it) => shapeT212Order(it, account))
    .filter((r): r is NonNullable<ReturnType<typeof shapeT212Order>> => r !== null);
  // A page that arrived but parsed to nothing is a shape bug, not an
  // empty history. Advancing the cursor here walked the real nested
  // `{ fill, order }` payload into the void (fetched stayed 0).
  if (ordersPageShapeMismatch(items.length, rows.length)) {
    const sampleKeys = items[0] && typeof items[0] === "object"
      ? Object.keys(items[0] as object).sort().join(",")
      : "";
    const msg = `shape mismatch: ${items.length} items, 0 parsed`
      + (sampleKeys ? ` (top-level keys: ${sampleKeys})` : "");
    console.error(`T212 orders ${account}: ${msg}`);
    await writeOrdersSync({
      account, cursor, complete: false,
      fetched: state?.fetched ?? 0, last_error: msg,
    });
    return {
      account, added: 0, skipped: items.length,
      fetched: state?.fetched ?? 0, complete: false, error: msg,
    };
  }
  const wrote = await writeOrders(rows);
  const next = nextOrdersCursor(page.body);
  // A finished walk stays finished — the top-up pass above deliberately
  // re-reads page one, and letting its `next` cursor restart the walk
  // would loop the whole history forever.
  const complete = done || (wrote && next === null);
  const fetched = done
    ? (typeof state?.fetched === "number" ? state.fetched : rows.length)
    : (typeof state?.fetched === "number" ? state.fetched : 0) + rows.length;
  await writeOrdersSync({
    account,
    cursor: done ? null : next,
    // Only latch complete once the page landed — otherwise a failed
    // write would end the walk having stored nothing.
    complete,
    fetched,
    last_error: wrote ? null : "storage write failed",
  });
  return {
    account,
    added: rows.length,
    skipped: items.length - rows.length,
    fetched,
    complete,
    ...(wrote ? {} : { error: "storage write failed — apply migration 0023" }),
  };
}

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the outer try/catch wrap so a runtime crash
// here becomes a row the admin ⚠ badge surfaces instead of a silent
// 500. Best-effort: never throws.
// reportServerError now lives in ../_shared/ops.ts (imported above).

if (import.meta.main) {
  // Missing-secret check: verifyToken fails closed (every request 401s)
  // when APP_AUTH_SECRET is unset — safe, but silent. Log loudly so the
  // wall of 401s is explainable from the function logs.
  if (!APP_AUTH_SECRET) {
    console.error(
      "[trading212] APP_AUTH_SECRET is not set — every request will be " +
      "rejected with 401. Set it in Supabase Dashboard → Edge Functions → Secrets.",
    );
  }
  Deno.serve(async (req: Request) => {
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS });
      }
      if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "method not allowed" }), {
          status: 405, headers: { ...CORS, "content-type": "application/json" },
        });
      }

      // Token gate. Either admin or ro is fine — read-only viewers
      // should see the synced holdings the same as the rest of the
      // portfolio. Anonymous callers get 401 so the holdings aren't
      // world-readable through the function URL.
      const verified = await verifyToken(req.headers.get("x-app-token") ?? "");
      if (!verified) {
        return new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401, headers: { ...CORS, "content-type": "application/json" },
        });
      }

      if (!T212_API_KEY) {
        return new Response(JSON.stringify({
          holdings: {},
          prices: {},
          updatedAt: new Date().toISOString(),
          source: "disabled",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }

      const action = new URL(req.url).searchParams.get("action") ?? "";

      // Executed-fill history. `orders` is a plain read of what's been
      // backfilled; `orders-sync` advances the backfill by one page per
      // account and is admin-only, because it writes and because it
      // spends a rate-limited upstream budget a viewer has no business
      // spending.
      if (action === "orders") {
        return new Response(JSON.stringify({ orders: await readOrders() }), {
          headers: { ...CORS, "content-type": "application/json" },
        });
      }
      if (action === "orders-sync") {
        if (verified.role !== "admin") {
          return new Response(JSON.stringify({ error: "admin only" }), {
            status: 403, headers: { ...CORS, "content-type": "application/json" },
          });
        }
        const accounts: Array<[string, string, string]> = [["invest", T212_API_KEY, T212_API_SECRET]];
        if (T212_ISA_API_KEY) accounts.push(["isa", T212_ISA_API_KEY, T212_ISA_API_SECRET]);
        // Sequential, not parallel: the two accounts share one upstream
        // rate limit and firing both at once is the fastest way to a 429.
        const results: Record<string, unknown>[] = [];
        for (const [name, key, secret] of accounts) {
          results.push(await syncOrdersOnce(name, key, secret));
        }
        return new Response(JSON.stringify({
          accounts: results,
          complete: results.every((r) => r.complete === true),
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }

      const now = Date.now();
      const cached = await readCacheRow();
      if (cached && cacheIsFresh(cached.updated_at, now, CACHE_TTL_MS)) {
        const { holdings, prices } = unpackCache(cached.data);
        return new Response(JSON.stringify({
          holdings,
          prices,
          updatedAt: cached.updated_at,
          source: "cache",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }

      // Stale (or cold). Atomically claim the right to refresh. Only the
      // winner calls T212; losers re-read the cache (winner may have
      // written between our SELECT and our claim attempt) and serve
      // whatever's there. Worst case for a loser on cold cache: empty
      // holdings for one tick until the winner's write lands.
      const claimed = await claimRefresh();
      if (!claimed) {
        const refreshed = await readCacheRow();
        const row = refreshed || cached;
        if (row) {
          const { holdings, prices } = unpackCache(row.data);
          return new Response(JSON.stringify({
            holdings,
            prices,
            updatedAt: row.updated_at,
            source: "cache",
          }), { headers: { ...CORS, "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          holdings: {},
          prices: {},
          updatedAt: new Date().toISOString(),
          source: "stale",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }

      try {
        // Fetch both T212 accounts in parallel (rate limits are
        // per-account, so each key has its own bucket — this is one call
        // per account per claimed window). Invest is primary: if it throws, fall through to
        // the stale-cache path below. ISA is best-effort — a bad/expired
        // ISA key logs and degrades to invest-only rather than blanking
        // everything.
        const [investResult, isaResult] = await Promise.allSettled([
          fetchT212Portfolio(T212_API_KEY, T212_API_SECRET),
          T212_ISA_API_KEY
            ? fetchT212Portfolio(T212_ISA_API_KEY, T212_ISA_API_SECRET)
            : Promise.resolve(null),
        ]);
        if (investResult.status === "rejected") throw investResult.reason;
        if (isaResult.status === "rejected") {
          console.error("T212 ISA fetch failed (using invest-only):",
            isaResult.reason instanceof Error ? isaResult.reason.message : isaResult.reason);
        }
        const investShaped = shapeT212Portfolio(investResult.value);
        const isaShaped = (isaResult.status === "fulfilled" && isaResult.value != null)
          ? shapeT212Portfolio(isaResult.value)
          : { holdings: {}, prices: {} };
        const shaped = mergeShaped(investShaped, isaShaped);
        await writeCacheRow(shaped);
        return new Response(JSON.stringify({
          holdings: shaped.holdings,
          prices: shaped.prices,
          updatedAt: new Date().toISOString(),
          source: "live",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      } catch (e) {
        // T212 errored after we claimed the refresh slot. Log to
        // Supabase Functions logs for forensics, then serve stale
        // cache (within 5 min grace) so a transient 429 / 500 doesn't
        // blank the lots out client-side.
        console.error("T212 upstream error:", e instanceof Error ? e.message : e);
        if (cached && cacheIsFresh(cached.updated_at, now, STALE_OK_MS)) {
          const { holdings, prices } = unpackCache(cached.data);
          return new Response(JSON.stringify({
            holdings,
            prices,
            updatedAt: cached.updated_at,
            source: "stale",
          }), { headers: { ...CORS, "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          holdings: {},
          prices: {},
          updatedAt: new Date().toISOString(),
          source: "stale",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }
    } catch (e) {
      // The outer net — anything not caught by the upstream-error
      // branch above (token verification crash, cache RPC throw,
      // etc.). Same shape as the silent-500 the runtime would return
      // anyway, but now visible in ops_errors.
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      await reportServerError("trading212.unhandled", { message: msg });
      return new Response(JSON.stringify({ error: "internal" }), {
        status: 500, headers: { ...CORS, "content-type": "application/json" },
      });
    }
  });
}
