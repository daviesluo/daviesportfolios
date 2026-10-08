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
//          complete: boolean,   // the map is every account's answer (`everyAccountRead`)
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
// `?action=orders-sync` also takes the cron bearer (it stands in for the
// admin who otherwise drives it), and `?action=probe` is the other exception to that gate: a read-only check of
// what the stored keys can read (account currency, the orders page's
// currency fields, dividends, instrument metadata), fired from the
// database through pg_net with the Vault `cron_secret`, or by an admin.
//
// Token-gated by the same HMAC-signed `x-app-token` the `data` /
// `ops-error` functions use — admin OR ro is accepted, since the
// read-only "screenshot" mode is supposed to see synced holdings
// the same way it sees the rest of the portfolio. Holdings are PII
// and an anonymous endpoint would leak the owner's share counts
// and average cost to anyone with the function URL. Requires the
// `APP_AUTH_SECRET` env var (same value as the `auth` function).

import { reportServerError } from "../_shared/ops.ts";
import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { T212_DCA_ETFS, t212TickerToYahoo } from "../_shared/t212_tickers.ts";

// Re-exported so this function's index.test.ts keeps pinning the exact
// implementation the token gate below trusts.
export { b64url, constantTimeEqual, sign, verifyToken } from "../_shared/token.ts";

// Trading 212's codes map to the board's Yahoo tickers through
// `_shared/t212_tickers.ts`, the one map the two price recorders read too
// (`AAPL_US_EQ → AAPL`, `VUAAl_EQ → VUAA.L`, a renamed `FB_US_EQ → META`;
// null for a code nothing reads, which then gets no entry). Re-exported
// so index.test.ts pins that this function uses that map, not a copy.
export { t212TickerToYahoo };

// Executed-fill history. Unlike `/equity/positions` (a snapshot of what
// is held) this carries the DATES — which is the one thing the position
// endpoint can't tell us and the whole reason the lot ledger has been
// guessing. Rate limited far harder than positions, so it's backfilled
// one page at a time into `t212_orders` and read from there afterwards.
export const T212_ORDERS_URL = "https://live.trading212.com/api/v0/equity/history/orders";
export const T212_TRANSACTIONS_URL = "https://live.trading212.com/api/v0/equity/history/transactions";

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
 * unwraps it; the original flat fixtures still round-trip. ISA also
 * sends `{ order }` with no fill (cancelled / never filled); those
 * must skip and advance, not freeze the cursor.
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
    hasExplicitFill: fill !== null,
    explicitFillQuantity: fill?.quantity,
    explicitFillPrice: fill?.price,
    explicitFilledAt: fill?.filledAt,
    ticker,
    // The instrument's trading currency as T212 states it on the fill (GBX for a pence line). The flat legacy row has
    // no instrument, and its `currency` could mean the account's, so it gets none.
    instrumentCurrency: instrument.currency ?? instrument.currencyCode ?? null,
    status: ord.status ?? o.status,
    side: ord.side ?? o.side,
    filledQuantity: fl.quantity ?? ord.filledQuantity ?? o.filledQuantity,
    quantity: fl.quantity ?? ord.quantity ?? o.quantity,
    orderedQuantity: ord.quantity ?? o.orderedQuantity,
    fillPrice: fl.price ?? o.fillPrice ?? ord.limitPrice,
    // The wallet impact is what the fill actually moved — a real
    // execution figure, unlike `limitPrice` / `filledValue`. Kept on its
    // own key so a nested fill can fall back to it for price without
    // ever reaching the order-level estimates beside it.
    explicitFillValue: wallet.netValue,
    fillCost: wallet.netValue ?? ord.filledValue ?? o.fillCost ?? o.filledValue,
    filledValue: ord.filledValue ?? o.filledValue,
    fillId: fl.id ?? o.fillId,
    id: ord.id ?? o.id,
    dateExecuted: fl.filledAt ?? o.dateExecuted,
    dateCreated: ord.createdAt ?? o.dateCreated,
    dateModified: ord.modifiedAt ?? o.dateModified,
  };
}

/**
 * True when the item is a T212 history-order envelope we know how to
 * read — nested `{ fill, order }`, order-only (cancelled / never
 * filled have no fill), or the older flat ticker row. A page of these
 * that stores nothing is skipped fills, not a shape we don't
 * recognise.
 */
export function t212OrderItemRecognized(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.order && typeof o.order === "object") return true;
  if (o.fill && typeof o.fill === "object") return true;
  return typeof o.ticker === "string" && o.ticker.length > 0;
}

export function t212FillEnvelope(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const fill = (raw as Record<string, unknown>).fill;
  return !!fill && typeof fill === "object";
}

export function t212MalformedFillEnvelope(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return "fill" in o && o.fill != null && typeof o.fill !== "object";
}

export function ordersPageEnvelopeRecognized(body: unknown): boolean {
  if (Array.isArray(body)) return true;
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  for (const key of ["items", "data", "orders", "results", "transactions"]) {
    if (key in b) return Array.isArray(b[key]);
  }
  return false;
}

/**
 * True when a page arrived in an envelope we cannot read, so the
 * cursor must not advance. A page of recognised orders that were all
 * cancelled / never filled / value-only is NOT this — advancing is
 * what unsticks the ISA walk that parked on `{ order }` with no fill
 * and blocked cash history from ever starting.
 *
 * A page where SOME fills shaped and others didn't is not this either,
 * and treating it as such is what parked both walks in production: one
 * unreadable fill per page held the cursor still forever, so the ISA
 * account stored nothing at all and the invest account stopped a month
 * back and never returned for newer fills. Freezing the walk to protect
 * one row costs the entire history — the trade only makes sense when
 * NOTHING on the page parsed, which is the signal that the shaper, not
 * the row, is what's wrong.
 *
 * A `fill` that isn't an object at all still freezes unconditionally:
 * that is a shape nobody has ever read, not a row we chose to skip.
 */
export function ordersPageShapeMismatch(
  itemCount: number,
  parsedCount: number,
  recognizedCount: number | null = null,
  malformedFillCount = 0,
  unreadableFillCount = 0,
): boolean {
  if (unreadableFillCount > 0) return true;
  if (recognizedCount != null && recognizedCount < itemCount) return true;
  if (itemCount <= 0 || parsedCount > 0) return false;
  if (malformedFillCount > 0) return true;
  if (recognizedCount != null && recognizedCount >= itemCount) return false;
  return true;
}

export function shapeT212Order(raw: unknown, account: string, skips?: string[]): {
  id: string;
  account: string;
  t212_ticker: string;
  ticker: string | null;
  executed_at: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  currency: string | null;
} | null {
  const o = flattenT212OrderItem(raw);
  // `skips` is a diagnostic sink, not control flow: every `return null`
  // below names itself in it. A page that stores nothing then says WHY
  // instead of only how many, which is the difference between "the walk
  // is stuck" and "the walk is stuck because the older pages carry no
  // `order.side`". Without it the only way to find out is to guess at
  // someone else's schema.
  const skip = (reason: string): null => { skips?.push(reason); return null; };
  if (!o) return skip("not-an-object");
  const num = (v: unknown): number | null =>
    (typeof v === "number" && isFinite(v)) ? v
      : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

  // A status field only rules a row OUT — absent means we can't tell, and
  // dropping every row of an unfamiliar shape would silently produce an
  // empty history rather than an error anyone would notice.
  const status = typeof o.status === "string" ? o.status.toUpperCase() : "";
  const nestedFill = o.hasExplicitFill === true;
  // A partially-filled order can end CANCELLED after a real fill. The
  // fill is authoritative; final order status only gates legacy flat
  // rows that have no nested fill witness.
  if (!nestedFill && status && !/FILL|EXECUT|COMPLET/.test(status)) return skip("status:" + status);

  const t212Ticker = typeof o.ticker === "string" ? o.ticker : "";
  if (!t212Ticker) return skip("no-ticker");

  // Deposited is built from REAL fills. An order-only envelope can say
  // FILLED and carry a limit / aggregate value, but it has neither the
  // execution price nor the execution time (price improvement makes
  // `limitPrice` observably wrong). Recognise-and-skip it so pagination
  // advances; persist only nested fills or the legacy flat fill shape.
  const explicitFill = nestedFill
    || (o.fillId != null && typeof o.dateExecuted === "string");
  if (!explicitFill) return skip("no-explicit-fill");

  // A nested fill prices itself off `fill.price`, or failing that off
  // `walletImpact.netValue` — the cash the fill actually moved. Order-level
  // `limitPrice` / `filledValue` stay out of reach here: they are what was
  // ASKED for, and price improvement makes them observably wrong.
  const cost = nestedFill ? num(o.explicitFillValue) : (num(o.fillCost) ?? num(o.filledValue));
  const statedPrice = nestedFill ? num(o.explicitFillPrice) : num(o.fillPrice);
  const qty = nestedFill ? num(o.explicitFillQuantity) : num(o.filledQuantity);
  if (qty == null || qty === 0) return skip("no-quantity");

  // Which way the trade went. `order.side` is the authority when T212
  // states it; the sign of the quantity only decides when it doesn't.
  //
  // A negative nested quantity used to be dropped outright, on the
  // reading that nested history always signs sales positive and states
  // the side. Production disagreed: real pages carry negative fill
  // quantities, and dropping them cost far more than the row — a
  // dropped fill counted as an unreadable page, which parked the whole
  // backfill (see `ordersPageShapeMismatch`). Reading the sign as a
  // sale, with the declared side overriding it, keeps every fill.
  const declared = typeof o.side === "string" ? o.side.toUpperCase() : "";
  if (nestedFill && declared !== "BUY" && declared !== "SELL") return skip("no-side:" + (declared || "missing"));
  const side: "buy" | "sell" = declared === "SELL" ? "sell"
    : declared === "BUY" ? "buy"
      : (qty < 0 ? "sell" : "buy");
  const shares = Math.abs(qty);

  const price = statedPrice
    ?? (cost != null && shares > 0 ? Math.abs(cost) / shares : null);
  if (price == null || !(price > 0)) return skip("no-price");

  const when = nestedFill
    ? (typeof o.explicitFilledAt === "string" && !isNaN(Date.parse(o.explicitFilledAt))
      ? o.explicitFilledAt
      : null)
    : (typeof o.dateExecuted === "string" && !isNaN(Date.parse(o.dateExecuted))
      ? o.dateExecuted
      : null);
  if (!when) return skip("no-fill-time");

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
    // The price's currency, stored as T212 states it (GBX kept, the client divides). Null when the item does not say;
    // `backfillOrderCurrencies` then fills it from the instrument metadata.
    currency: normCurrency(o.instrumentCurrency),
  };
}

/** True when an Authorization header carries the cron secret as its bearer (constant-time; never with an empty secret). */
export function bearerIsCron(authorization: string | null, cronSecret: string): boolean {
  const auth = authorization ?? "";
  return cronSecret !== "" && auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7).trim(), cronSecret);
}

/** A currency code as stored: three letters, upper case (GBX stays GBX); anything else is null. */
export function normCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Yahoo's spelling of pence, should it ever arrive: upper-cased it would read as pounds, a hundred times too much.
  if (v.trim() === "GBp") return "GBX";
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/** The currency a holding is kept in for an instrument's trading currency: pence lines are kept in pounds. */
export function holdingCurrencyFor(instrumentCurrency: string | null): string | null {
  if (!instrumentCurrency) return null;
  return instrumentCurrency === "GBX" ? "GBP" : instrumentCurrency;
}

/**
 * Split shaped fills for the upsert: rows that state a currency, and rows that don't. PostgREST's bulk upsert sends
 * one column set for the batch, and `merge-duplicates` overwrites every column it is sent, so a row without a currency
 * must leave the key out — sent as null, a re-read page would erase a currency the metadata backfill had filled in.
 */
export function splitByCurrency<T extends { currency: string | null }>(rows: T[]): { withCurrency: T[]; without: Omit<T, "currency">[] } {
  const withCurrency: T[] = [];
  const without: Omit<T, "currency">[] = [];
  for (const r of rows) {
    if (r.currency) withCurrency.push(r);
    else {
      const { currency: _drop, ...rest } = r;
      without.push(rest);
    }
  }
  return { withCurrency, without };
}

/**
 * One row of `/api/v0/history/dividends`, as stored. Read 2026-10-07 by the probe: `{ type, amount, paidOn, ticker,
 * currency, quantity, reference, instrument: { isin, name, ticker, currency }, amountInEuro, grossAmountPerShare }`.
 * `amount` is the NET cash credited in the account's currency (`currency`); `grossAmountPerShare` is in the
 * instrument's. A row without a reference, a ticker, a paid time or an amount is not stored (and named in `skips`).
 * The conversion into the holding's currency is not done here (`amount_holding` stays null until `fillDividendFx`),
 * except when the account pays in the holding's own currency, where it is the amount itself.
 */
export function shapeT212Dividend(raw: unknown, account: string, skips?: string[]): {
  id: string; account: string; t212_ticker: string; ticker: string | null; paid_on: string;
  quantity: number | null; amount: number; currency: string; instrument_currency: string | null;
  gross_per_share: number | null; type: string | null;
  amount_holding: number | null; holding_currency: string | null; fx_rate: number | null; fx_source: string | null;
} | null {
  const skip = (reason: string): null => { skips?.push(reason); return null; };
  if (!raw || typeof raw !== "object") return skip("not-an-object");
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    (typeof v === "number" && isFinite(v)) ? v
      : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
  const inst = (o.instrument && typeof o.instrument === "object") ? o.instrument as Record<string, unknown> : {};
  const t212Ticker = (typeof o.ticker === "string" && o.ticker) || (typeof inst.ticker === "string" && inst.ticker) || "";
  if (!t212Ticker) return skip("no-ticker");
  const reference = typeof o.reference === "string" && o.reference ? o.reference : (o.id != null ? String(o.id) : "");
  if (!reference) return skip("no-reference");
  const amount = num(o.amount);
  if (amount == null) return skip("no-amount");
  const when = typeof o.paidOn === "string" && !isNaN(Date.parse(o.paidOn)) ? o.paidOn : null;
  if (!when) return skip("no-paid-on");
  const currency = normCurrency(o.currency);
  if (!currency) return skip("no-currency");
  const instrumentCurrency = normCurrency(inst.currency);
  const holdingCurrency = holdingCurrencyFor(instrumentCurrency);
  const same = holdingCurrency !== null && holdingCurrency === currency;
  return {
    id: `${account}:${reference}`,
    account,
    t212_ticker: t212Ticker,
    ticker: t212TickerToYahoo(t212Ticker),
    paid_on: new Date(when).toISOString(),
    quantity: num(o.quantity),
    amount,
    currency,
    instrument_currency: instrumentCurrency,
    gross_per_share: num(o.grossAmountPerShare),
    type: typeof o.type === "string" ? o.type : null,
    amount_holding: same ? amount : null,
    holding_currency: holdingCurrency,
    fx_rate: same ? 1 : null,
    fx_source: same ? "same" : null,
  };
}

/**
 * The close of a daily FX series on the day a dividend was paid: the last bar that opened at or before `atMs` and has
 * a close. A payment before the series' first bar has none (null), and the caller leaves the row for a later call.
 */
export function dailyCloseAt(timestamps: number[], closes: (number | null)[], atMs: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (timestamps[i] * 1000 > atMs) break;
    if (typeof c === "number" && isFinite(c) && c > 0) best = c;
  }
  return best;
}

/**
 * The `nextPagePath` T212 returned, or null at the end of the history.
 *
 * T212's own pagination rule is to request that path as-is. Orders
 * historically stored only the `cursor=` query value; transactions
 * require `cursorId` *and* `time` together, so stripping the path
 * down to `cursor=` 400s the next page ("Both or none of cursorId
 * and time must be provided") after the first 50 rows.
 */
export function nextPagePathOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const raw = b.nextPagePath ?? b.nextPage ?? b.next;
  const path = typeof raw === "string" ? raw
    : (raw && typeof raw === "object" ? String((raw as Record<string, unknown>).path ?? "") : "");
  return path || null;
}

/**
 * The cursor for the next ORDERS page, or null at the end of the history.
 *
 * T212 hands back a whole path (`/api/v0/equity/history/orders?cursor=…`)
 * rather than a bare cursor, and some wrappers expose `nextPagePath` as
 * an object. Pull the parameter out of whichever shape arrived; null
 * means the walk is finished, which is what latches `complete`.
 */
export function nextOrdersCursor(body: unknown): string | null {
  const path = nextPagePathOf(body);
  if (!path) return null;
  const m = path.match(/[?&]cursor=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Store the whole transactions nextPagePath — cursorId and time travel together. */
export function nextTransactionsCursor(body: unknown): string | null {
  return nextPagePathOf(body);
}

/**
 * URL for one transactions page. A leftover bare `cursor=` token from
 * the orders shaper is ignored: sending it without `time` is the 400
 * that parked both accounts after the first page.
 */
export function transactionsPageUrl(stored: string | null, limit = 50): string {
  const s = (stored || "").trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return `https://live.trading212.com${s}`;
  if (s.startsWith("?")) return `${T212_TRANSACTIONS_URL}${s}`;
  // Production also returns JUST the query string (no leading "?"):
  // `limit=50&cursor=…&time=…`. Treat it as a page path only when the
  // required cursor + time pair is present. The previous code mistook
  // it for a legacy bare token, silently requested page one again, and
  // incremented `fetched` forever while the stored row count stayed 50.
  if (s.includes("=")) {
    const params = new URLSearchParams(s);
    const hasCursor = params.has("cursor") || params.has("cursorId");
    if (hasCursor && params.has("time")) {
      return `${T212_TRANSACTIONS_URL}?${s}`;
    }
  }
  const url = new URL(T212_TRANSACTIONS_URL);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

export function transactionCursorAdvanced(
  current: string | null,
  next: string | null,
): boolean {
  if (!next || !current) return true;
  return transactionsPageUrl(current) !== transactionsPageUrl(next);
}

/** The `items` array, whatever the envelope calls it. */
export function ordersItemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  for (const k of ["items", "data", "orders", "results", "transactions"]) {
    if (Array.isArray(b[k])) return b[k] as unknown[];
  }
  return [];
}

/**
 * One cash-movement row from `/equity/history/transactions`.
 *
 * Published fields are `amount`, `currency`, `dateTime`, `reference`,
 * `type` (DEPOSIT / WITHDRAW / FEE / TRANSFER / INTEREST_ON_FREE_CASH /
 * LENDING_INTEREST). Defensive about aliases the same way the order
 * shaper is: a silently-dropped deposit is a hole in "money paid in".
 * Unknown types are stored, not dropped — the deposit line ignores
 * everything except deposit/withdraw, and a later reading can use the
 * rest without re-fetching.
 */
export function shapeT212Transaction(raw: unknown, account: string): {
  id: string;
  account: string;
  type: string;
  amount: number;
  currency: string;
  occurred_at: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    (typeof v === "number" && isFinite(v)) ? v
      : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

  const typeRaw = typeof o.type === "string" ? o.type
    : (typeof o.transactionType === "string" ? o.transactionType : "");
  const type = typeRaw.trim().toLowerCase();
  if (!type) return null;

  const amount = num(o.amount);
  if (amount == null || amount === 0) return null;

  const currencyRaw = typeof o.currency === "string" ? o.currency.trim() : "";
  const currency = (currencyRaw || "USD").toUpperCase();

  const when = [o.dateTime, o.time, o.date, o.createdAt]
    .find((d) => typeof d === "string" && !isNaN(Date.parse(d as string)));
  if (!when) return null;

  const reference = String(o.reference ?? o.id ?? `${type}:${when}:${amount}`);
  return {
    id: `${account}:${reference}`,
    account,
    type,
    amount,
    currency,
    occurred_at: new Date(when as string).toISOString(),
  };
}

/**
 * The read-only probe's summary of one orders page: which currency fields T212 sends on a fill, and what they say, per
 * instrument. No price, quantity or amount leaves here: what the probe answers lands in `net._http_response`.
 */
export function probeOrderCurrencies(items: unknown[]): {
  keys: { item: string[]; order: string[]; instrument: string[]; fill: string[]; walletImpact: string[] };
  instruments: Record<string, { instrumentCurrency: unknown; orderCurrency: unknown; walletCurrency: unknown; fxRate: string }>;
} {
  const keys = { item: new Set<string>(), order: new Set<string>(), instrument: new Set<string>(), fill: new Set<string>(), walletImpact: new Set<string>() };
  const instruments: Record<string, { instrumentCurrency: unknown; orderCurrency: unknown; walletCurrency: unknown; fxRate: string }> = {};
  const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : null);
  for (const it of items) {
    const o = obj(it);
    if (!o) continue;
    Object.keys(o).forEach((k) => keys.item.add(k));
    const ord = obj(o.order), fill = obj(o.fill);
    const inst = obj(ord?.instrument), wallet = obj(fill?.walletImpact);
    Object.keys(ord ?? {}).forEach((k) => keys.order.add(k));
    Object.keys(inst ?? {}).forEach((k) => keys.instrument.add(k));
    Object.keys(fill ?? {}).forEach((k) => keys.fill.add(k));
    Object.keys(wallet ?? {}).forEach((k) => keys.walletImpact.add(k));
    const ticker = typeof inst?.ticker === "string" ? inst.ticker : (typeof ord?.ticker === "string" ? ord.ticker : "");
    if (!ticker || !fill || instruments[ticker]) continue;
    instruments[ticker] = {
      instrumentCurrency: inst?.currency ?? inst?.currencyCode ?? null,
      orderCurrency: ord?.currency ?? null,
      walletCurrency: wallet?.currency ?? null,
      fxRate: typeof wallet?.fxRate,
    };
  }
  const sorted = (x: Set<string>) => [...x].sort();
  return {
    keys: { item: sorted(keys.item), order: sorted(keys.order), instrument: sorted(keys.instrument), fill: sorted(keys.fill), walletImpact: sorted(keys.walletImpact) },
    instruments,
  };
}

export const T212_DIVIDENDS_URL = "https://live.trading212.com/api/v0/history/dividends";
export const T212_INSTRUMENTS_URL = "https://live.trading212.com/api/v0/equity/metadata/instruments";
export const T212_ACCOUNT_SUMMARY_URL = "https://live.trading212.com/api/v0/equity/account/summary";

/**
 * `?action=probe`: read-only. One GET per endpoint the fill-currency and dividend work needs, per account, reporting
 * each one's status (a 403's body names what the key lacks) and the SHAPE of what came back: the orders page's
 * currency fields per instrument, the dividends page's keys and its first items, the account's currency, and the
 * instruments' `currencyCode` for the codes asked about (`&tickers=`). It writes nothing and places nothing.
 */
async function runProbe(tickers: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  const read = async (url: string, key: string, secret: string) => {
    const attempts = secret ? [basicAuthHeader(key, secret), key] : [key];
    const got = await historyPageRequest(url, attempts, fetch, 25_000);
    if (!got.ok) return { status: 0, error: got.message };
    if (!got.res.ok) return { status: got.res.status, error: (await got.res.text().catch(() => "")).slice(0, 300) };
    return { status: got.res.status, body: got.body };
  };
  for (const [name, key, secret] of t212HistoryAccounts()) {
    const acct: Record<string, unknown> = {};
    const summary = await read(T212_ACCOUNT_SUMMARY_URL, key, secret);
    const sb = summary.body && typeof summary.body === "object" ? summary.body as Record<string, unknown> : null;
    acct.summary = { status: summary.status, error: summary.error, currency: sb?.currency ?? sb?.currencyCode ?? null, keys: sb ? Object.keys(sb).sort() : [] };
    const orders = await read(`${T212_ORDERS_URL}?limit=50`, key, secret);
    acct.orders = { status: orders.status, error: orders.error, ...(orders.body ? probeOrderCurrencies(ordersItemsOf(orders.body)) : {}) };
    const divs = await read(`${T212_DIVIDENDS_URL}?limit=50`, key, secret);
    const divItems = divs.body ? ordersItemsOf(divs.body) : [];
    const divKeys = new Set<string>();
    for (const it of divItems) if (it && typeof it === "object") Object.keys(it).forEach((k) => divKeys.add(k));
    acct.dividends = {
      status: divs.status, error: divs.error, count: divItems.length,
      envelope: divs.body && typeof divs.body === "object" && !Array.isArray(divs.body) ? Object.keys(divs.body as object).sort() : [],
      keys: [...divKeys].sort(), next: nextPagePathOf(divs.body), sample: divItems.slice(0, 3),
    };
    out[name] = acct;
  }
  const [, key, secret] = t212HistoryAccounts()[0];
  const meta = await read(T212_INSTRUMENTS_URL, key, secret);
  const list = Array.isArray(meta.body) ? meta.body as Record<string, unknown>[] : [];
  const want = new Set(tickers);
  out.instruments = {
    status: meta.status, error: meta.error, count: list.length,
    keys: list[0] ? Object.keys(list[0]).sort() : [],
    asked: list.filter((r) => want.has(String(r.ticker))).map((r) => ({ ticker: r.ticker, currencyCode: r.currencyCode, type: r.type, isin: r.isin })),
  };
  return out;
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
type T212HoldingSlice = {
  shares: number;
  cost: number;
  previousShares?: number;
  previousCost?: number;
};

export function shapeT212Portfolio(
  positions: unknown,
): {
  holdings: Record<string, T212HoldingSlice>;
  prices: Record<string, number>;
  valid: boolean;
} {
  const holdings: Record<string, T212HoldingSlice> = {};
  const prices: Record<string, number> = {};
  if (!Array.isArray(positions)) return { holdings, prices, valid: false };
  const structurallyValid = positions.length === 0 || positions.every((p) => {
    if (!p || typeof p !== "object" || positionTicker(p) === null) return false;
    const quantity = Number((p as { quantity?: unknown }).quantity);
    const cost = Number(
      (p as { averagePricePaid?: unknown }).averagePricePaid
        ?? (p as { averagePrice?: unknown }).averagePrice,
    );
    const currentPrice = Number((p as { currentPrice?: unknown }).currentPrice);
    return isFinite(quantity) && quantity > 0
      && isFinite(cost) && cost > 0
      && isFinite(currentPrice) && currentPrice > 0;
  });
  if (!structurallyValid) return { holdings, prices, valid: false };
  // Seed every allow-list ETF (`T212_DCA_ETFS`) at zero so a position that
  // has been sold out entirely still arrives as an explicit 0 rather than
  // silently vanishing from the map (which the client would read as "no
  // data"). Tickers outside the allow-list are only emitted when the broker
  // actually reports them — seeding those would need a list of every
  // ticker the account has ever held.
  for (const ticker of new Set(Object.values(T212_DCA_ETFS))) {
    holdings[ticker] = { shares: 0, cost: 0 };
  }
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

    // Holdings (shares/cost) sync: EVERY position the broker reports, not
    // just the two DCA'd ETFs.
    //
    // The allow-list existed because the first merge treated the T212
    // slice as the whole position and overwrote the user's ledger with
    // it — so it was kept to the two tickers that only ever live at
    // T212. The client's merge no longer does that: it never touches
    // lots or sells, tags the broker's slice as `t212Shares` /
    // `t212Cost`, and applies only that slice's delta afterwards. With
    // that in place, narrowing the map hides real positions instead of
    // protecting anything — the account held 55 shares of PLTR that the
    // board had recorded as sold out, and 22 of GOOG against a board
    // reading 24, because neither was on the list.
    //
    // Only tickers the board already carries are affected: the client
    // skips anything it doesn't already hold.
    //
    // Cost field is `averagePricePaid` on `/equity/positions`,
    // `averagePrice` on the legacy `/equity/portfolio` — accept
    // whichever is present.
    {
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
  return { holdings, prices, valid: true };
}

/**
 * Cache-shape compat unpacker. The cached `data` is `{ holdings, prices }`
 * since this version; older rows stored the holdings map directly. Treat
 * a row without a `holdings` key as the legacy shape so a deploy doesn't
 * blank the response between the migration and the first live refresh.
 */
export function unpackCache(
  data: unknown,
): { holdings: Record<string, unknown>; prices: Record<string, number>; complete: boolean } {
  if (data && typeof data === "object" && !Array.isArray(data) && "holdings" in (data as object)) {
    const d = data as { holdings?: Record<string, unknown>; prices?: Record<string, number>; complete?: unknown };
    return { holdings: d.holdings ?? {}, prices: d.prices ?? {}, complete: d.complete === true };
  }
  return { holdings: (data as Record<string, unknown>) ?? {}, prices: {}, complete: false };
}

/**
 * Whether one positions answer covers every account the function reads: the Invest account (read, or the call threw
 * before getting here) and, when an ISA key is set, an ISA answer that parsed. When the ISA read fails,
 * `mergeShapedWithFallback` answers with the previous combined map, which is not this minute's account; so the answer
 * says it is not complete, and the client then never takes a ticker's absence as the broker's word that it was sold.
 * Stored with the cache row, so a cached answer says what the call that wrote it read. A row written before this flag
 * existed reads false. Pure, for testing.
 */
export function everyAccountRead(isaRequired: boolean, isaShaped: unknown): boolean {
  return !isaRequired || isaShaped != null;
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
  a: { holdings: Record<string, T212HoldingSlice>; prices: Record<string, number> },
  b: { holdings: Record<string, T212HoldingSlice>; prices: Record<string, number> },
): { holdings: Record<string, T212HoldingSlice>; prices: Record<string, number> } {
  const prices = { ...a.prices, ...b.prices };
  const holdings: Record<string, T212HoldingSlice> = { ...a.holdings };
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
 * Preserve combined position authority when the optional second account
 * fails. Invest-only prices can still refresh, but its smaller position
 * map must not erase the ISA slice.
 */
export function mergeShapedWithFallback(
  invest: { holdings: Record<string, T212HoldingSlice>; prices: Record<string, number> },
  isa: { holdings: Record<string, T212HoldingSlice>; prices: Record<string, number> } | null,
  previous: { holdings: Record<string, unknown>; prices: Record<string, number> } | null,
  isaRequired: boolean,
): { holdings: Record<string, unknown>; prices: Record<string, number> } {
  if (isaRequired && !isa) {
    return {
      holdings: previous?.holdings ?? {},
      prices: { ...(previous?.prices ?? {}), ...invest.prices },
    };
  }
  return mergeShaped(
    invest,
    isa ?? { holdings: {}, prices: {} },
  );
}

export function attachPreviousHoldingSlices(
  current: Record<string, T212HoldingSlice>,
  previous: Record<string, unknown> | null | undefined,
): Record<string, T212HoldingSlice> {
  const out: Record<string, T212HoldingSlice> = {};
  for (const [ticker, row] of Object.entries(current)) {
    const old = previous?.[ticker];
    const oldRow = old && typeof old === "object"
      ? old as Partial<T212HoldingSlice>
      : {};
    const previousShares = Number(oldRow.previousShares ?? oldRow.shares);
    const previousCost = Number(oldRow.previousCost ?? oldRow.cost);
    out[ticker] = {
      ...row,
      ...(isFinite(previousShares) && previousShares >= 0
        ? { previousShares }
        : {}),
      ...(isFinite(previousCost) && previousCost >= 0
        ? { previousCost }
        : {}),
    };
  }
  return out;
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
 * One history page's request, with the auth dance (the first header that is not refused with a 401) and the body read.
 * A timeout or a dropped connection is an upstream failure like a 5xx, not a crash: it comes back as `{ ok: false }`
 * with status 0, so the walk records it and tries again next time. Thrown instead, it escaped to the handler's outer
 * catch and was filed as `trading212.unhandled` (2026-09-23 16:00 UTC: T212 took longer than ten seconds on an
 * orders-sync). `fetchImpl` is the test's seam.
 */
export async function historyPageRequest(
  url: string,
  attempts: string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<{ ok: true; res: Response; body?: unknown } | { ok: false; status: 0; message: string }> {
  const failed = (e: unknown) => ({
    ok: false as const, status: 0 as const,
    message: e instanceof Error && e.name === "TimeoutError"
      ? `T212 did not answer within ${timeoutMs / 1000} s`
      : `T212 request failed: ${e instanceof Error ? e.message : String(e)}`,
  });
  let res!: Response;
  try {
    for (const authorization of attempts) {
      res = await fetchImpl(url, { headers: { authorization, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 401) break;
    }
    // The same signal also bounds the body, so a slow body times out here and not in the caller.
    return res.ok ? { ok: true, res, body: await res.json() } : { ok: true, res };
  } catch (e) {
    return failed(e);
  }
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
  const got = await historyPageRequest(url.toString(), attempts);
  if (!got.ok) return got;
  const res = got.res;
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
  return { ok: true, body: got.body };
}

/**
 * One page of cash movements for one account. Same auth dance and 403
 * distinction as the orders page — History: transactions is a separate
 * T212 scope, but a key that already reads orders almost always has it.
 */
async function fetchT212TransactionsPage(
  apiKey: string,
  apiSecret: string,
  cursor: string | null,
  limit = 50,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const url = transactionsPageUrl(cursor, limit);
  const attempts = apiSecret ? [basicAuthHeader(apiKey, apiSecret), apiKey] : [apiKey];
  const got = await historyPageRequest(url.toString(), attempts);
  if (!got.ok) return got;
  const res = got.res;
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    const hint = res.status === 403
      ? " — the API key authenticates but is not permitted to read transactions. " +
        "Regenerate it in Trading 212 with History: transactions enabled."
      : res.status === 429
      ? " — rate limited; this endpoint allows only a few calls a minute. Try again shortly."
      : "";
    return { ok: false, status: res.status, message: `T212 ${res.status} ${res.statusText}${hint} :: ${snippet}` };
  }
  return { ok: true, body: got.body };
}

/** Upsert a batch of shaped fills. Idempotent on the fill id; a fill without a currency leaves the stored one alone. */
async function writeOrders(rows: NonNullable<ReturnType<typeof shapeT212Order>>[]): Promise<boolean> {
  const { withCurrency, without } = splitByCurrency(rows);
  const a = await writeOrdersBatch(withCurrency);
  const b = await writeOrdersBatch(without);
  return a && b;
}

async function writeOrdersBatch(rows: unknown[]): Promise<boolean> {
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

async function writeOrdersSync(row: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/t212_orders_sync`, {
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
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`T212 orders sync-state write ${res.status}: ${snippet}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("T212 orders sync-state write error:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Every stored fill, oldest first, for the client to rebuild lots from. */
async function readOrders(): Promise<{ rows: unknown[]; ok: boolean }> {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 50_000; offset += pageSize) {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/t212_orders`
          + "?select=id,ticker,executed_at,side,shares,price,account,currency"
          + `&order=executed_at.asc,id.asc&limit=${pageSize}&offset=${offset}`,
        {
          headers: {
            apikey: SERVICE_KEY,
            authorization: `Bearer ${SERVICE_KEY}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 200);
        console.error(`T212 orders read ${res.status}: ${snippet}`);
        return { rows: [], ok: false };
      }
      const page = await res.json();
      if (!Array.isArray(page)) return { rows: [], ok: false };
      rows.push(...page);
      if (page.length < pageSize) return { rows, ok: true };
    } catch {
      return { rows: [], ok: false };
    }
  }
  // Hitting the safety cap is truncation, not a complete snapshot.
  return { rows: [], ok: false };
}

async function readOrdersSyncSnapshot(): Promise<{
  complete: boolean;
  fingerprint: string;
}> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_orders_sync`
        + "?select=account,complete,fetched,cursor,updated_at&order=account.asc",
      {
        headers: {
          apikey: SERVICE_KEY,
          authorization: `Bearer ${SERVICE_KEY}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return { complete: false, fingerprint: "" };
    const rows = await res.json();
    const expected = T212_ISA_API_KEY ? 2 : 1;
    const complete = Array.isArray(rows) && rows.length === expected
      && rows.every((row) => row?.complete === true);
    return { complete, fingerprint: JSON.stringify(rows) };
  } catch {
    return { complete: false, fingerprint: "" };
  }
}

async function readStableOrders(): Promise<{ orders: unknown[]; complete: boolean }> {
  const before = await readOrdersSyncSnapshot();
  let read = await readOrders();
  const after = await readOrdersSyncSnapshot();
  if (before.fingerprint !== after.fingerprint) {
    // A page landed during the read. Re-read after that write, and only
    // call it complete if the sync state stayed still around this copy.
    read = await readOrders();
    const final = await readOrdersSyncSnapshot();
    return {
      orders: read.rows,
      complete: read.ok && after.complete && after.fingerprint === final.fingerprint,
    };
  }
  return {
    orders: read.rows,
    complete: read.ok && before.complete && after.complete,
  };
}

const sbHeaders = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  accept: "application/json",
  ...extra,
});

/**
 * Fill the currency of stored fills that have none, from T212's instrument metadata (`currencyCode`, GBX kept). The
 * fills written before 0095 carry none, and an item that omits `order.instrument.currency` stores none. Runs only while
 * such rows exist and at most once in 15 minutes (the metadata endpoint allows one call in 50 s), stamped on the invest
 * account's sync row. Writes only rows still null, so a currency a fill stated is never overwritten.
 *
 * The null rows are read a thousand at a time to the end: PostgREST caps a read at 1,000 rows whatever `limit` says,
 * and the first pass (2026-10-07 23:39) read one page, saw 59 of the 69 tickers and left the other ten without one.
 */
async function backfillOrderCurrencies(apiKey: string, apiSecret: string): Promise<Record<string, unknown> | null> {
  try {
    const seen = new Set<string>();
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const page = await fetch(
        `${SB_URL}/rest/v1/t212_orders?currency=is.null&select=t212_ticker&order=id.asc&limit=1000&offset=${offset}`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(5_000) },
      );
      if (!page.ok) return null;
      const rows = (await page.json()) as { t212_ticker: string }[];
      for (const r of rows) seen.add(r.t212_ticker);
      if (rows.length < 1000) break;
    }
    const tickers = [...seen];
    if (tickers.length === 0) return null;
    const state = await readOrdersSync("invest");
    const last = Date.parse(String(state?.currency_backfill_at ?? ""));
    if (isFinite(last) && Date.now() - last < 15 * 60_000) return { pending: tickers.length, skipped: "recent" };
    await fetch(`${SB_URL}/rest/v1/t212_orders_sync?account=eq.invest`, {
      method: "PATCH", headers: sbHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ currency_backfill_at: new Date().toISOString() }), signal: AbortSignal.timeout(5_000),
    });
    const attempts = apiSecret ? [basicAuthHeader(apiKey, apiSecret), apiKey] : [apiKey];
    const got = await historyPageRequest(T212_INSTRUMENTS_URL, attempts, fetch, 25_000);
    if (!got.ok || !got.res.ok || !Array.isArray(got.body)) {
      return { pending: tickers.length, error: got.ok ? `metadata ${got.res.status}` : got.message };
    }
    const codes = metadataCurrencies(got.body, tickers);
    let filled = 0;
    for (const [t212Ticker, currency] of Object.entries(codes)) {
      const res = await fetch(
        `${SB_URL}/rest/v1/t212_orders?t212_ticker=eq.${encodeURIComponent(t212Ticker)}&currency=is.null`,
        { method: "PATCH", headers: sbHeaders({ "content-type": "application/json" }), body: JSON.stringify({ currency }), signal: AbortSignal.timeout(5_000) },
      );
      if (res.ok) filled++;
    }
    return { pending: tickers.length, filled, unknown: tickers.filter((t) => !codes[t]) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The metadata's `currencyCode` for each asked T212 code it lists, normalised (GBX kept). */
export function metadataCurrencies(list: unknown[], tickers: string[]): Record<string, string> {
  const want = new Set(tickers);
  const out: Record<string, string> = {};
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const t = typeof row.ticker === "string" ? row.ticker : "";
    const c = normCurrency(row.currencyCode);
    if (want.has(t) && c) out[t] = c;
  }
  return out;
}

async function readDividendsSync(account: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/t212_dividends_sync?account=eq.${encodeURIComponent(account)}&select=*`, {
      headers: sbHeaders(), signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch {
    return null;
  }
}

async function upsertRows(table: string, rows: unknown | unknown[]): Promise<boolean> {
  if (Array.isArray(rows) && rows.length === 0) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: sbHeaders({ "content-type": "application/json", prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      const hint = snippet.includes("42P01") || snippet.includes("PGRST205") ? " — migration 0095 has not run yet." : "";
      console.error(`T212 ${table} write ${res.status}: ${snippet}${hint}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`T212 ${table} write error:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Advance the dividends walk by one page for one account, then top up page one once it has finished, as the orders
 * walk does. `/history/dividends` pages with `nextPagePath` (`?limit=50&cursor=…`) like the orders endpoint.
 */
async function syncDividendsOnce(account: string, apiKey: string, apiSecret: string): Promise<Record<string, unknown>> {
  const state = await readDividendsSync(account);
  const done = state?.complete === true;
  const cursor = done ? null : (typeof state?.cursor === "string" ? state.cursor : null);
  const url = new URL(T212_DIVIDENDS_URL);
  url.searchParams.set("limit", "50");
  if (cursor) url.searchParams.set("cursor", cursor);
  const attempts = apiSecret ? [basicAuthHeader(apiKey, apiSecret), apiKey] : [apiKey];
  const got = await historyPageRequest(url.toString(), attempts);
  const fetched = typeof state?.fetched === "number" ? state.fetched : 0;
  if (!got.ok || !got.res.ok) {
    const message = got.ok ? `T212 ${got.res.status} ${(await got.res.text().catch(() => "")).slice(0, 200)}` : got.message;
    await upsertRows("t212_dividends_sync", { account, cursor, complete: done, fetched, last_error: message, updated_at: new Date().toISOString() });
    return { account, stream: "dividends", error: message, complete: done, added: 0 };
  }
  if (!ordersPageEnvelopeRecognized(got.body)) {
    const msg = "shape mismatch: unrecognised dividends envelope";
    await upsertRows("t212_dividends_sync", { account, cursor, complete: false, fetched, last_error: msg, updated_at: new Date().toISOString() });
    return { account, stream: "dividends", error: msg, complete: false, added: 0 };
  }
  const items = ordersItemsOf(got.body);
  const skips: string[] = [];
  const rows = items.map((it) => shapeT212Dividend(it, account, skips))
    .filter((r): r is NonNullable<ReturnType<typeof shapeT212Dividend>> => r !== null);
  if (items.length > 0 && rows.length === 0) {
    // Nothing on the page read: the shaper is what is wrong, so the cursor stays and the reasons are recorded.
    const msg = `shape mismatch: ${items.length} dividends, 0 parsed [${[...new Set(skips)].slice(0, 4).join(", ")}]`;
    await upsertRows("t212_dividends_sync", { account, cursor, complete: false, fetched, last_error: msg, updated_at: new Date().toISOString() });
    return { account, stream: "dividends", error: msg, complete: false, added: 0 };
  }
  // A row whose conversion is already known (paid in the holding's currency) is sent with it; the rest leave the
  // conversion columns out, so a re-read page never erases a rate `fillDividendFx` stored.
  const known = rows.filter((r) => r.amount_holding !== null);
  const open = rows.filter((r) => r.amount_holding === null).map(({ amount_holding: _a, fx_rate: _r, fx_source: _s, ...rest }) => rest);
  const wrote = (await upsertRows("t212_dividends", known)) && (await upsertRows("t212_dividends", open));
  const next = nextOrdersCursor(got.body);
  const complete = wrote && (done || next === null);
  await upsertRows("t212_dividends_sync", {
    account,
    cursor: wrote ? (done ? null : next) : cursor,
    complete,
    fetched: wrote && !done ? fetched + rows.length : fetched,
    last_error: wrote ? (skips.length ? `skipped ${skips.length}: ${[...new Set(skips)].join(", ")}` : null) : "storage write failed",
    updated_at: new Date().toISOString(),
  });
  return { account, stream: "dividends", added: rows.length, skipped: items.length - rows.length, complete };
}

/**
 * Convert the stored dividends whose holding currency differs from the account's: the net amount at the close of the
 * account→holding pair (Yahoo's `<FROM><TO>=X` daily series) on the day it was paid. Up to 200 rows a call; a row
 * whose day has no close stays null and is tried again on a later call.
 */
async function fillDividendFx(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_dividends?amount_holding=is.null&holding_currency=not.is.null`
        + "&select=id,paid_on,amount,currency,holding_currency&order=paid_on.asc&limit=200",
      { headers: sbHeaders(), signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const rows = await res.json() as { id: string; paid_on: string; amount: number; currency: string; holding_currency: string }[];
    if (rows.length === 0) return null;
    const byPair = new Map<string, typeof rows>();
    for (const r of rows) {
      const pair = `${r.currency}${r.holding_currency}=X`;
      byPair.set(pair, [...(byPair.get(pair) ?? []), r]);
    }
    let filled = 0;
    for (const [pair, list] of byPair) {
      const times = list.map((r) => Date.parse(r.paid_on));
      const from = Math.floor(Math.min(...times) / 1000) - 10 * 86400;
      const to = Math.floor(Math.max(...times) / 1000) + 86400;
      const y = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair)}?period1=${from}&period2=${to}&interval=1d`,
        { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) },
      ).catch(() => null);
      if (!y || !y.ok) continue;
      const body = await y.json().catch(() => null);
      const result = body?.chart?.result?.[0];
      const ts: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
      for (const r of list) {
        const rate = dailyCloseAt(ts, closes, Date.parse(r.paid_on));
        if (rate == null) continue;
        const ok = await fetch(`${SB_URL}/rest/v1/t212_dividends?id=eq.${encodeURIComponent(r.id)}`, {
          method: "PATCH", headers: sbHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ amount_holding: r.amount * rate, fx_rate: rate, fx_source: `yahoo:${pair}:1d-close` }),
          signal: AbortSignal.timeout(5_000),
        });
        if (ok.ok) filled++;
      }
    }
    return { pending: rows.length, filled };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function readDividends(): Promise<{ rows: unknown[]; complete: boolean }> {
  try {
    // A thousand at a time: PostgREST caps a read at 1,000 rows whatever `limit` asks for.
    const rows: unknown[] = [];
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const res = await fetch(
        `${SB_URL}/rest/v1/t212_dividends?select=id,account,ticker,paid_on,quantity,amount,currency,instrument_currency,`
          + `gross_per_share,type,amount_holding,holding_currency,fx_rate,fx_source&order=paid_on.asc,id.asc&limit=1000&offset=${offset}`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) return { rows: [], complete: false };
      const page = await res.json();
      if (!Array.isArray(page)) return { rows: [], complete: false };
      rows.push(...page);
      if (page.length < 1000) break;
    }
    const states = await Promise.all(t212HistoryAccounts().map(([name]) => readDividendsSync(name)));
    return { rows, complete: states.every((st) => st?.complete === true) };
  } catch {
    return { rows: [], complete: false };
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
  if (!ordersPageEnvelopeRecognized(page.body)) {
    const msg = "shape mismatch: unrecognised page envelope";
    await writeOrdersSync({
      account, cursor, complete: false,
      fetched: state?.fetched ?? 0, last_error: msg,
    });
    return {
      account, added: 0, skipped: 0,
      fetched: state?.fetched ?? 0, complete: false, error: msg,
    };
  }
  const skips: string[] = [];
  const shapedItems = items.map((it) => shapeT212Order(it, account, skips));
  const rows = shapedItems
    .filter((r): r is NonNullable<ReturnType<typeof shapeT212Order>> => r !== null);
  // A page that arrived in an UNKNOWN envelope must not advance —
  // that's how the nested `{ fill, order }` payload walked the
  // history into the void. A page of recognised `{ order }` rows
  // that were all cancelled / never filled is the opposite: skip
  // and advance, or the walk parks forever and cash history never
  // starts.
  const recognized = items.filter(t212OrderItemRecognized).length;
  // A fill envelope we recognised but couldn't shape. On a page where
  // nothing parsed this is the shaper failing; on a page where other
  // fills came through it is one skipped row, and the walk goes on.
  const malformedFills = items.filter((item, index) =>
    t212FillEnvelope(item) && shapedItems[index] === null
  ).length;
  // A `fill` that isn't an object — a shape no reader here has ever
  // seen. This one always stops the walk.
  const unreadableFills = items.filter(t212MalformedFillEnvelope).length;
  if (ordersPageShapeMismatch(items.length, rows.length, recognized, malformedFills, unreadableFills)) {
    const sampleKeys = items[0] && typeof items[0] === "object"
      ? Object.keys(items[0] as object).sort().join(",")
      : "";
    // Why each item was dropped, most common first. One run of this then
    // says which field the page is missing instead of leaving the next
    // reader to guess at T212's schema for an older page.
    const tally = new Map<string, number>();
    for (const r of skips) tally.set(r, (tally.get(r) ?? 0) + 1);
    const why = [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, n]) => `${reason} x${n}`)
      .join(", ");
    const msg = `shape mismatch: ${items.length} items, ${rows.length} parsed`
      + (sampleKeys ? ` (top-level keys: ${sampleKeys})` : "")
      + (why ? ` [${why}]` : "");
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
  const complete = wrote && (done || next === null);
  const previousFetched = typeof state?.fetched === "number" ? state.fetched : 0;
  const fetched = !wrote
    ? previousFetched
    : done
    ? (typeof state?.fetched === "number" ? state.fetched : rows.length)
    : previousFetched + rows.length;
  const stateWrote = await writeOrdersSync({
    account,
    cursor: wrote ? (done ? null : next) : cursor,
    // Only latch complete once the page landed — otherwise a failed
    // write would end the walk having stored nothing.
    complete,
    fetched,
    last_error: wrote ? null : "storage write failed",
  });
  const reportedComplete = complete && stateWrote;
  return {
    account,
    added: rows.length,
    skipped: items.length - rows.length,
    fetched,
    complete: reportedComplete,
    ...(!wrote
      ? { error: "storage write failed — apply migration 0023" }
      : !stateWrote
      ? { error: "sync-state write failed" }
      : {}),
  };
}

async function writeTransactions(rows: unknown[]): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/t212_transactions`, {
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
        ? " — apply migration 0025 (t212_transactions) via supabase db push."
        : "";
      console.error(`T212 transactions write ${res.status}: ${snippet}${hint}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("T212 transactions write error:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function readTransactionsSync(account: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_transactions_sync?account=eq.${encodeURIComponent(account)}&select=*`,
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

async function writeTransactionsSync(row: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/t212_transactions_sync`, {
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
    console.error("T212 transactions sync-state write error:", e instanceof Error ? e.message : e);
  }
}

async function readTransactions(): Promise<unknown[]> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/t212_transactions?select=type,amount,currency,occurred_at,account&order=occurred_at.asc&limit=5000`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, accept: "application/json" },
        signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`T212 transactions read ${res.status}: ${snippet}`);
      return [];
    }
    return await res.json();
  } catch {
    return [];
  }
}

async function transactionsSyncComplete(): Promise<boolean> {
  const invest = await readTransactionsSync("invest");
  if (invest?.complete !== true) return false;
  if (T212_ISA_API_KEY) {
    const isa = await readTransactionsSync("isa");
    if (isa?.complete !== true) return false;
  }
  return true;
}

async function ordersSyncComplete(): Promise<boolean> {
  const invest = await readOrdersSync("invest");
  if (invest?.complete !== true) return false;
  if (T212_ISA_API_KEY) {
    const isa = await readOrdersSync("isa");
    if (isa?.complete !== true) return false;
  }
  return true;
}

async function syncTransactionsOnce(
  account: string,
  apiKey: string,
  apiSecret: string,
): Promise<Record<string, unknown>> {
  const state = await readTransactionsSync(account);
  const done = state?.complete === true;
  const cursor = done ? null : (typeof state?.cursor === "string" ? state.cursor : null);
  const page = await fetchT212TransactionsPage(apiKey, apiSecret, cursor);
  if (!page.ok) {
    await writeTransactionsSync({ account, cursor, complete: done, fetched: state?.fetched ?? 0, last_error: page.message });
    return {
      account, error: page.message, status: page.status,
      complete: done, added: 0, scopeDenied: page.status === 403,
    };
  }
  const items = ordersItemsOf(page.body);
  if (!ordersPageEnvelopeRecognized(page.body)) {
    const msg = "shape mismatch: unrecognised page envelope";
    await writeTransactionsSync({
      account, cursor, complete: false,
      fetched: state?.fetched ?? 0, last_error: msg,
    });
    return {
      account, added: 0, skipped: 0,
      fetched: state?.fetched ?? 0, complete: false, error: msg,
    };
  }
  const rows = items
    .map((it) => shapeT212Transaction(it, account))
    .filter((r): r is NonNullable<ReturnType<typeof shapeT212Transaction>> => r !== null);
  const recognized = items.filter((it) => {
    if (!it || typeof it !== "object") return false;
    const o = it as Record<string, unknown>;
    return typeof o.type === "string" || typeof o.amount === "number"
      || typeof o.dateTime === "string";
  }).length;
  if (ordersPageShapeMismatch(items.length, rows.length, recognized)) {
    const sampleKeys = items[0] && typeof items[0] === "object"
      ? Object.keys(items[0] as object).sort().join(",")
      : "";
    const msg = `shape mismatch: ${items.length} items, ${rows.length} parsed`
      + (sampleKeys ? ` (top-level keys: ${sampleKeys})` : "");
    console.error(`T212 transactions ${account}: ${msg}`);
    await writeTransactionsSync({
      account, cursor, complete: false,
      fetched: state?.fetched ?? 0, last_error: msg,
    });
    return {
      account, added: 0, skipped: items.length,
      fetched: state?.fetched ?? 0, complete: false, error: msg,
    };
  }
  const wrote = await writeTransactions(rows);
  const next = nextTransactionsCursor(page.body);
  if (!done && wrote && next && !transactionCursorAdvanced(cursor, next)) {
    const msg = "pagination cursor did not advance";
    await writeTransactionsSync({
      account,
      cursor,
      complete: false,
      fetched: state?.fetched ?? 0,
      last_error: msg,
    });
    return {
      account,
      added: 0,
      skipped: items.length,
      fetched: state?.fetched ?? 0,
      complete: false,
      error: msg,
    };
  }
  const complete = done || (wrote && next === null);
  const fetched = done
    ? (typeof state?.fetched === "number" ? state.fetched : rows.length)
    : (typeof state?.fetched === "number" ? state.fetched : 0) + rows.length;
  await writeTransactionsSync({
    account,
    cursor: done ? null : next,
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
    ...(wrote ? {} : { error: "storage write failed — apply migration 0025" }),
  };
}

/**
 * What this account should do on this history-sync tick.
 *
 * Orders still go first *for that account* — cash history must not
 * replace the deposit line until fills are in, or ISA lots get counted
 * twice. A finished account does not steal the rate-limit slot while
 * another account is still backfilling (that was parking cash history
 * behind ISA cancelled-order pages, and topping up invest page one
 * every 20 s).
 */
export function nextHistoryKind(
  ordersComplete: boolean,
  txComplete: boolean,
  anyBackfillOpen: boolean,
): "orders" | "transactions" | "skip" | "topup" {
  if (!ordersComplete) return "orders";
  if (!txComplete) return "transactions";
  if (anyBackfillOpen) return "skip";
  return "topup";
}

export function pickAccountTopUp(ordersUpdatedAt: unknown, txUpdatedAt: unknown): "orders" | "transactions" {
  const oAt = Date.parse(String(ordersUpdatedAt || 0)) || 0;
  const tAt = Date.parse(String(txUpdatedAt || 0)) || 0;
  return oAt <= tAt ? "orders" : "transactions";
}

function t212HistoryAccounts(): Array<[string, string, string]> {
  const accounts: Array<[string, string, string]> = [["invest", T212_API_KEY, T212_API_SECRET]];
  if (T212_ISA_API_KEY) accounts.push(["isa", T212_ISA_API_KEY, T212_ISA_API_SECRET]);
  return accounts;
}

async function syncHistoryAccounts(
  kind: "orders" | "transactions",
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for (const [name, key, secret] of t212HistoryAccounts()) {
    results.push({
      ...(kind === "orders"
        ? await syncOrdersOnce(name, key, secret)
        : await syncTransactionsOnce(name, key, secret)),
      stream: kind,
    });
  }
  return results;
}

async function syncHistoryPerAccount(): Promise<Record<string, unknown>[]> {
  const accounts = t212HistoryAccounts();
  const states: Array<{
    name: string; key: string; secret: string;
    oDone: boolean; tDone: boolean;
    oAt: unknown; tAt: unknown;
  }> = [];
  for (const [name, key, secret] of accounts) {
    const o = await readOrdersSync(name);
    const t = await readTransactionsSync(name);
    states.push({
      name, key, secret,
      oDone: o?.complete === true,
      tDone: t?.complete === true,
      oAt: o?.updated_at, tAt: t?.updated_at,
    });
  }
  const anyOpen = states.some((s) => !s.oDone || !s.tDone);
  const results: Record<string, unknown>[] = [];
  for (const s of states) {
    const kind = nextHistoryKind(s.oDone, s.tDone, anyOpen);
    if (kind === "skip") {
      results.push({ account: s.name, stream: "skip", complete: true, added: 0 });
      continue;
    }
    const stream = kind === "topup" ? pickAccountTopUp(s.oAt, s.tAt) : kind;
    const row = stream === "orders"
      ? await syncOrdersOnce(s.name, s.key, s.secret)
      : await syncTransactionsOnce(s.name, s.key, s.secret);
    results.push({ ...row, stream });
  }
  return results;
}

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the outer try/catch wrap so a runtime crash
// here becomes a row the admin ⚠ badge surfaces instead of a silent
// 500. Best-effort: never throws.
// reportServerError now lives in ../_shared/ops.ts (imported above).

// Trading 212's own failures, reported (review F16, 2026-10-08). Until then a refused or timed-out positions read, or
// an answer of the wrong shape, reached only the function's logs: the page went on with the cache, then with nothing,
// and the client's read returns null without a word, so the sync could stop for days unnoticed. Now each becomes an
// `ops_errors` row, the errors box's: `trading212.upstream` when the invest account's read fails (the refresh fails,
// the board keeps what it had), `trading212.isa` when only the ISA's does (the answer is the invest account's alone,
// and not `complete`). The table is read first, so a fault that lasts is reported once an hour, not once a request
// (the cache lives a second, so every open tab's 30 s refresh reaches Trading 212), and a different fault at once.

/** How often a fault that lasts is reported again. */
export const T212_FAULT_REPORT_EVERY_MS = 60 * 60_000;
/** A fault's identity: its message without what Trading 212's answer said (after ` :: `), which can carry an id or a
 *  time that would make every request's fault a new one. The status stays: a 401 is not the 429 reported before it. */
export function t212FaultKey(message: string): string {
  return message.split(" :: ")[0].slice(0, 300);
}
/** Whether a fault is due a row: none of its kind's rows of the last hour (`recent`) reports the same fault. */
export function t212FaultReportDue(recent: unknown, message: string): boolean {
  if (!Array.isArray(recent)) return true;
  const key = t212FaultKey(message);
  return !recent.some((r) => typeof r?.message === "string" && t212FaultKey(r.message) === key);
}
/** Reports a fault unless its kind's rows of the last hour already say it. Best-effort: never throws. */
async function reportT212Fault(kind: "trading212.upstream" | "trading212.isa", message: string): Promise<void> {
  let recent: unknown = null;
  try {
    const since = new Date(Date.now() - T212_FAULT_REPORT_EVERY_MS).toISOString();
    const res = await fetch(
      `${SB_URL}/rest/v1/ops_errors?kind=eq.${kind}&created_at=gte.${encodeURIComponent(since)}&select=message&order=created_at.desc&limit=20`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, accept: "application/json" }, signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) recent = await res.json();
  } catch { /* the table unread: report anyway, a row too many rather than none */ }
  if (!t212FaultReportDue(recent, message)) return;
  await reportServerError(kind, { message, context: { at: new Date().toISOString() } });
}
/** A fault reported while the answer goes out, not before it: `EdgeRuntime.waitUntil` keeps the worker until the
 *  report is done. The positions read may already have spent its 8 s, and the page gives up at 10. */
function reportInBackground(p: Promise<unknown>): void {
  const work = p.catch(() => {});
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try { rt?.waitUntil?.(work); } catch { /* the report still runs; without the runtime's hold it may be cut short */ }
}

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

      // The read-only probe: pg_net with the Vault `cron_secret` (or an admin token). Before the app-token gate so
      // the cron bearer reaches it; nothing in it writes or trades.
      const reqUrl = new URL(req.url);
      const isCron = bearerIsCron(req.headers.get("authorization"), Deno.env.get("CRON_SECRET") ?? "");
      if (reqUrl.searchParams.get("action") === "probe") {
        const admin = isCron ? null : await verifyToken(req.headers.get("x-app-token") ?? "");
        if (!isCron && admin?.role !== "admin") {
          return new Response(JSON.stringify({ error: "unauthorised" }), {
            status: 401, headers: { ...CORS, "content-type": "application/json" },
          });
        }
        if (!T212_API_KEY) {
          return new Response(JSON.stringify({ error: "T212_API_KEY not set" }), { headers: { ...CORS, "content-type": "application/json" } });
        }
        const tickers = (reqUrl.searchParams.get("tickers") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        return new Response(JSON.stringify(await runProbe(tickers)), { headers: { ...CORS, "content-type": "application/json" } });
      }

      // Token gate. Either admin or ro is fine — read-only viewers
      // should see the synced holdings the same as the rest of the
      // portfolio. Anonymous callers get 401 so the holdings aren't
      // world-readable through the function URL.
      // `orders-sync` also answers the cron bearer, as the admin it stands in for: the fills, dividends and currency
      // backfills it advances can then be driven from the database (pg_net with the Vault `cron_secret`), not only by
      // an open admin page. Every other action keeps the app token alone.
      const cronSync = isCron && reqUrl.searchParams.get("action") === "orders-sync";
      const verified = cronSync ? { role: "admin" as const } : await verifyToken(req.headers.get("x-app-token") ?? "");
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

      // History backfill. `orders` / `transactions` are plain reads of
      // what's been stored; `orders-sync` / `history-sync` advance a
      // page and are admin-only (they write, and they spend a
      // rate-limited upstream budget a viewer has no business spending).
      //
      // `history-sync` walks each account independently: that account's
      // orders first, then its cash movements. A finished account does
      // not consume a rate-limit slot while another is still
      // backfilling. After both walks latch, a later session tops up
      // the staler stream.
      if (action === "orders") {
        const snapshot = await readStableOrders();
        return new Response(JSON.stringify({
          orders: snapshot.orders,
          complete: snapshot.complete,
        }), {
          headers: { ...CORS, "content-type": "application/json" },
        });
      }
      if (action === "dividends") {
        const read = await readDividends();
        return new Response(JSON.stringify({ dividends: read.rows, complete: read.complete }), {
          headers: { ...CORS, "content-type": "application/json" },
        });
      }
      if (action === "transactions") {
        const rows = await readTransactions();
        return new Response(JSON.stringify({
          transactions: rows,
          complete: await transactionsSyncComplete(),
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }
      if (action === "orders-sync" || action === "history-sync") {
        if (verified.role !== "admin") {
          return new Response(JSON.stringify({ error: "admin only" }), {
            status: 403, headers: { ...CORS, "content-type": "application/json" },
          });
        }
        // Sequential, not parallel: two accounts on one endpoint already
        // sit on the 6/min ceiling. history-sync picks the next page
        // *per account* so a finished invest walk can start cash
        // history while ISA is still chewing cancelled orders.
        const results = action === "history-sync"
          ? await syncHistoryPerAccount()
          : await syncHistoryAccounts("orders");
        // The dividends walk rides on the same call, one page per account (its own endpoint, its own rate limit),
        // then the two backfills that fill in what a page could not: fill currencies from the instrument metadata,
        // and dividends paid in another currency than the holding's at that day's close.
        const dividends = action === "orders-sync"
          ? await Promise.all(t212HistoryAccounts().map(([name, key, secret]) => syncDividendsOnce(name, key, secret)))
          : [];
        const currencyBackfill = action === "orders-sync" ? await backfillOrderCurrencies(T212_API_KEY, T212_API_SECRET) : null;
        const dividendFx = action === "orders-sync" ? await fillDividendFx() : null;
        const ordersStateComplete = await ordersSyncComplete();
        const ordersComplete = action === "orders-sync"
          ? ordersStateComplete && results.every((row) => row.complete === true && !row.error)
          : ordersStateComplete;
        const transactionsComplete = action === "history-sync"
          ? await transactionsSyncComplete()
          : false;
        const bothComplete = action === "history-sync"
          ? (ordersComplete && transactionsComplete)
          : results.every((r) => r.complete === true);
        const stream = results.find((r) => r.stream && r.stream !== "skip")?.stream
          ?? (action === "history-sync" ? "none" : "orders");
        return new Response(JSON.stringify({
          stream,
          accounts: results,
          complete: bothComplete,
          ordersComplete,
          transactionsComplete,
          dividends,
          dividendsComplete: dividends.length > 0 ? dividends.every((d) => d.complete === true) : undefined,
          currencyBackfill,
          dividendFx,
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }

      const now = Date.now();
      const cached = await readCacheRow();
      if (cached && cacheIsFresh(cached.updated_at, now, CACHE_TTL_MS)) {
        const { holdings, prices, complete } = unpackCache(cached.data);
        return new Response(JSON.stringify({
          holdings,
          prices,
          complete,
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
          const { holdings, prices, complete } = unpackCache(row.data);
          return new Response(JSON.stringify({
            holdings,
            prices,
            complete,
            updatedAt: row.updated_at,
            source: "cache",
          }), { headers: { ...CORS, "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          holdings: {},
          prices: {},
          complete: false,
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
          const why = isaResult.reason instanceof Error ? isaResult.reason.message : String(isaResult.reason);
          console.error("T212 ISA fetch failed (using invest-only):", why);
          reportInBackground(reportT212Fault("trading212.isa", `The ISA's positions read failed, so the answer is the invest account's alone: ${why}`));
        }
        const investShaped = shapeT212Portfolio(investResult.value);
        if (!investShaped.valid) throw new Error("T212 invest positions returned an invalid shape");
        let isaShaped = (isaResult.status === "fulfilled" && isaResult.value != null)
          ? shapeT212Portfolio(isaResult.value)
          : null;
        if (isaShaped && !isaShaped.valid) {
          console.error("T212 ISA positions returned an invalid shape; preserving cached combined holdings");
          reportInBackground(reportT212Fault("trading212.isa", "The ISA's positions answered in a shape this function does not read, so its holdings are the cache's"));
          isaShaped = null;
        }
        const previous = cached ? unpackCache(cached.data) : null;
        const merged = mergeShapedWithFallback(
          investShaped,
          isaShaped,
          previous,
          !!T212_ISA_API_KEY,
        );
        const shaped = {
          ...merged,
          holdings: attachPreviousHoldingSlices(
            merged.holdings as Record<string, T212HoldingSlice>,
            previous?.holdings,
          ),
          // Whether this map is every account's answer of this call (`everyAccountRead`): the one thing that lets the
          // client read a tagged ticker's absence as a sale.
          complete: everyAccountRead(!!T212_ISA_API_KEY, isaShaped),
        };
        await writeCacheRow(shaped);
        return new Response(JSON.stringify({
          holdings: shaped.holdings,
          prices: shaped.prices,
          complete: shaped.complete,
          updatedAt: new Date().toISOString(),
          source: "live",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      } catch (e) {
        // T212 errored after we claimed the refresh slot. Log to
        // Supabase Functions logs for forensics, then serve stale
        // cache (within 5 min grace) so a transient 429 / 500 doesn't
        // blank the lots out client-side.
        const why = e instanceof Error ? e.message : String(e);
        console.error("T212 upstream error:", why);
        const served = cached && cacheIsFresh(cached.updated_at, now, STALE_OK_MS) ? "the cache, under five minutes old" : "no holdings";
        reportInBackground(reportT212Fault("trading212.upstream", `The positions read failed, so the page was sent ${served}: ${why}`));
        if (cached && cacheIsFresh(cached.updated_at, now, STALE_OK_MS)) {
          const { holdings, prices, complete } = unpackCache(cached.data);
          return new Response(JSON.stringify({
            holdings,
            prices,
            complete,
            updatedAt: cached.updated_at,
            source: "stale",
          }), { headers: { ...CORS, "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          holdings: {},
          prices: {},
          complete: false,
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
