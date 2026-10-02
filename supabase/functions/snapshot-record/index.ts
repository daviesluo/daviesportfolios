// Supabase Edge Function: snapshot-record
//
// Cron-triggered every 5 min, 24/7 (migration 0026 schedules it, 0029
// owns the table it writes). One row per 5-minute bucket into
// `public.price_snapshots`: `{ ticker → native-currency price }` for
// every ticker on the board.
//
// This function records FACTS, not conclusions. It does not know what
// the portfolio is worth and must never learn: the book's value is
// computed in exactly one place, `computeAt` in `src/charts/ytd.js`, which the
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
// Once a day, at its 10:00 UTC call, it also audits the overnight recorder's
// last 24 hours and reports a shortfall to ops_errors
// (`_shared/recorder_watch.ts`; the overnight recorder audits this one).
//
// Each call writes its beat first (`_shared/beats.ts`, 0075): a call whose
// worker the platform never started has none, and `edge-watchdog` runs it
// again within its minute. A second run in a bucket writes the same row:
// its prices, read moments later in the same five minutes, replace the
// first run's (a ticker the second could not price drops from that one
// bucket, as it does from any bucket that run alone writes).
//
// Returns:
//   200 { ok: true, bucketTime, tickers }
//   200 { ok: true, skipped: "no-board" | "no-tickers" | "no-prices" }
//   403 — bad auth
//   500 — DB write failed

import { isUsMarketHolidayAt, usRegularCloseMinAt } from "../_shared/us_market_calendar.ts";
import { b64url, sign } from "../_shared/token.ts";
import { reportServerError } from "../_shared/ops.ts";
import { fetchT212Positions } from "../_shared/t212_positions.ts";
import { t212TickerToYahoo } from "../_shared/t212_tickers.ts";
import { auditRecorder, isAuditCall } from "../_shared/recorder_watch.ts";
import { shouldRecord } from "../_shared/us_overnight_session.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";

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

const BUCKET_MS = 5 * 60 * 1000;

// ---------------- Pure helpers (test-pinned) ----------------

// Trading 212's codes map to Yahoo tickers through `_shared/t212_tickers.ts`, the one map `trading212` and the
// overnight recorder read too; re-exported for this function's pins.
export { t212TickerToYahoo } from "../_shared/t212_tickers.ts";

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

/**
 * US cash session on a weekday that isn't a full holiday: 09:30 ET to its
 * close, 16:00, or 13:00 on an early close (the Friday after Thanksgiving,
 * July 3 / December 24 Monday to Thursday). Until 2026-09-30 it ran to 16:00
 * on those days too, so from 13:00 a Yahoo-priced holding was recorded at the
 * frozen 13:00 close while the late session traded, and a tick whose Trading
 * 212 fetch failed dropped every US holding to that close and the next lifted
 * them back: the overnight sawtooth's shape, three afternoons a year.
 */
export function isUsRegularSession(at: Date): boolean {
  if (isUsMarketHolidayAt(at)) return false;
  const { weekday, minutes } = etParts(at);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= 9 * 60 + 30 && minutes < usRegularCloseMinAt(at);
}

/**
 * The US OVERNIGHT session, 20:00-04:00 ET — the stretch Blue Ocean /
 * Trading 212 quote and Yahoo does not.
 *
 * Yahoo publishes no bars and no live quote here: its `lastPrice` and
 * `extPrice` are both a carry of the last regular / after-hours print,
 * and they do not move until 04:00 ET. That is why this window needs
 * naming — a number that never changes still LOOKS like a quote, and
 * `recordablePrice` has to know not to trust it.
 *
 * Spans midnight, so the test is an OR, not a range. Weekend and
 * holiday handling is deliberately absent: the overnight tape follows
 * the next session, and `recordablePrice` only ever uses this to REFUSE
 * a stale Yahoo quote, which is the safe answer on a closed day too.
 */
export function isUsOvernightSession(at: Date): boolean {
  const { minutes } = etParts(at);
  return minutes >= 20 * 60 || minutes < 4 * 60;
}

// The two listings outside the US whose price the board takes from Trading 212 at every hour: its own list is
// `T212_LIVE_PRICE_TICKERS` in `src/portfolio/trading212.js`, and the two must name the same tickers
// (`src/portfolio/trading212.test.js` holds them to each other).
const BOARD_T212_PRICED = new Set(["VUAA.L", "SAEM.L"]);

/**
 * Whether a holding is recorded at Trading 212's price: only where the board shows the broker's quote, so the 24H
 * chart's recorded points come from the same source as the board's live price and the chart's live right edge. That is
 * a US listing (no "." in its Yahoo ticker; a share class such as BRK-B counts), whose overnight quote on the board is
 * the broker's (`applyTrading212NightPrice` in `src/portfolio/trading212.js`), and the two ETFs above, whose Yahoo
 * feed lags. Every other holding is recorded from Yahoo, as the board shows it: a broker print there would stand apart
 * from the board's number, and a sample whose Trading 212 call failed would flip between the two sources.
 */
export function recordsT212Price(yahooTicker: string): boolean {
  return !yahooTicker.includes(".") || BOARD_T212_PRICED.has(yahooTicker);
}

/**
 * `{ yahooTicker → currentPrice }` for every Trading 212 position whose price is recorded (`recordsT212Price`). The
 * broker's own print is both fresher and correctly-currencied for the LSE ETFs, where Yahoo's free feed lags 15-20 min
 * at the open, and overnight it is the only live quote for a US listing.
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
    if (!yahoo || !recordsT212Price(yahoo)) continue;
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

/**
 * Whether two prices of one holding are in different units: one about 100 times the other (70 to 140, either way).
 * The prices function hands the board pounds for a London listing (it divides Yahoo's pence by 100); the broker quotes
 * an instrument in its own currency, which for a London stock is pence. A recorded price is permanent and the chart
 * values the book with it in the board's units, so a price whose units the board's own price contradicts is not
 * recorded (improvement plan item 6, 2026-10-02). No real move is 100-fold between two prices of the same moment.
 */
export function unitsDiffer(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  const r = a / b;
  return (r >= 70 && r <= 140) || (r >= 1 / 140 && r <= 1 / 70);
}
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
 *
 * Every price is checked for its units first (`unitsDiffer`) against the
 * board's own price for the holding (`boardPrice`, the last one the
 * browser saved: stale perhaps, but in the board's units), or, without one,
 * against the prices function's: a broker quote in pence for a holding the
 * board keeps in pounds is skipped, and so is a Yahoo price the board's own
 * contradicts. The next candidate is tried, and with none left nothing is
 * recorded.
 */
export function recordablePrice(
  quote: Quote | null | undefined,
  t212Price: number | undefined,
  at: Date,
  boardPrice?: number,
): number | null {
  const unitRef = typeof boardPrice === "number" && boardPrice > 0
    ? boardPrice
    : (typeof quote?.lastPrice === "number" && quote.lastPrice > 0 ? quote.lastPrice : null);
  const inUnits = (p: number) => unitRef === null || !unitsDiffer(p, unitRef);
  if (typeof t212Price === "number" && t212Price > 0 && inUnits(t212Price)) return t212Price;
  // Overnight, T212 is the ONLY live tape. Yahoo's quote here is the
  // last regular / after-hours print, frozen until 04:00 ET, so falling
  // through to it does exactly what the note above forbids: stamps a
  // stale figure with a fresh timestamp.
  //
  // And it does it to EVERY ticker at once, because T212 is one fetch
  // for the whole book: when that fetch times out, every holding in
  // that sample drops to its previous close together and the next
  // sample lifts them all back. On the 24H chart with Extended Hours on
  // that read as the portfolio line tearing up and down by more than a
  // percent, several times an hour, all night. The book had not moved;
  // the sample had.
  //
  // Recording nothing is the honest answer. A ticker absent from the
  // row leaves the chart on the overnight recorder's own series, which
  // is the authoritative overnight source anyway.
  if (isUsOvernightSession(at)) return null;
  const rth = isUsRegularSession(at);
  if (!rth && typeof quote?.extPrice === "number" && quote.extPrice > 0 && inUnits(quote.extPrice)) return quote.extPrice;
  if (typeof quote?.lastPrice === "number" && quote.lastPrice > 0 && inUnits(quote.lastPrice)) return quote.lastPrice;
  return null;
}

/**
 * The tickers whose broker or Yahoo price was skipped for its units (`recordablePrice`), with the prices, so a call
 * can say so.
 */
export function unitSkips(
  tickers: string[],
  quotes: Record<string, Quote>,
  t212Prices: Record<string, number>,
  boardPrices: Record<string, number>,
): { ticker: string; t212?: number; yahoo?: number; board?: number }[] {
  const out: { ticker: string; t212?: number; yahoo?: number; board?: number }[] = [];
  for (const t of tickers) {
    const board = boardPrices[t] > 0 ? boardPrices[t] : undefined;
    const yahoo = (quotes[t]?.lastPrice ?? 0) > 0 ? quotes[t].lastPrice : undefined;
    const ref = board ?? yahoo;
    const t212 = t212Prices[t] > 0 ? t212Prices[t] : undefined;
    if (ref === undefined) continue;
    if ((t212 !== undefined && unitsDiffer(t212, ref)) || (yahoo !== undefined && unitsDiffer(yahoo, ref))) {
      out.push({ ticker: t, t212, yahoo, board });
    }
  }
  return out;
}

/** The row body: every ticker we could price, in the board's units, and nothing else. */
export function buildPriceRow(
  tickers: string[],
  quotes: Record<string, Quote>,
  t212Prices: Record<string, number>,
  at: Date,
  boardPrices: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tickers) {
    const px = recordablePrice(quotes[t], t212Prices[t], at, boardPrices[t]);
    if (px != null) out[t] = px;
  }
  return out;
}

/** Each ticker's price as the board last saved it, for `recordablePrice`'s units. */
export function boardPricesOf(portfolio: Portfolio | null | undefined, tickers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tickers) {
    const p = Number(portfolio?.holdings?.[t]?.lastPrice);
    if (Number.isFinite(p) && p > 0) out[t] = p;
  }
  return out;
}

// ---------------- I/O ----------------

async function mintAdminToken(): Promise<string> {
  if (!APP_AUTH_SECRET) return "";
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 120_000 }));
  return `${payload}.${await sign(payload, APP_AUTH_SECRET)}`;
}

async function fetchAllT212Prices(): Promise<Record<string, number>> {
  const [invest, isa] = await Promise.all([
    fetchT212Positions(T212_API_KEY, T212_API_SECRET),
    T212_ISA_API_KEY ? fetchT212Positions(T212_ISA_API_KEY, T212_ISA_API_SECRET) : Promise.resolve(null),
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

/** One tick: price every ticker on the board and write the bucket's row. */
async function record(now: Date): Promise<Response> {
  const portfolio = await loadBoard();
  if (!portfolio) return json(200, { ok: true, skipped: "no-board" });

  const tickers = tickersToRecord(portfolio);
  if (tickers.length === 0) return json(200, { ok: true, skipped: "no-tickers" });

  const [quotes, t212Prices] = await Promise.all([
    fetchQuotes(tickers),
    fetchAllT212Prices(),
  ]);

  const boardPrices = boardPricesOf(portfolio, tickers);
  const prices = buildPriceRow(tickers, quotes, t212Prices, now, boardPrices);
  // A price skipped for its units is said once an hour (the hour's first bucket) while it lasts, not every 5 minutes.
  const skipped = unitSkips(tickers, quotes, t212Prices, boardPrices);
  if (skipped.length > 0 && now.getUTCMinutes() < 5) {
    await reportServerError("snapshot-record.units", {
      symbol: skipped[0].ticker,
      message: `prices in other units than the board's, not recorded: ${skipped.map((s) => `${s.ticker} (broker ${s.t212 ?? "-"}, Yahoo ${s.yahoo ?? "-"}, board ${s.board ?? "-"})`).join("; ")}`,
    });
  }
  // Nothing priced at all means the upstream is down, not that the
  // book is worthless. Write nothing; the next tick is 5 min away.
  if (Object.keys(prices).length === 0) return json(200, { ok: true, skipped: "no-prices" });

  const bucketTime = bucketTimeIso(now.getTime());
  const ok = await upsertPrices(bucketTime, prices);
  if (!ok) return json(500, { ok: false, error: "db-write-failed" });
  return json(200, { ok: true, bucketTime, tickers: Object.keys(prices).length });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------------- Server ----------------

/** One call's work: the bucket's prices, and at 10:00 UTC the overnight recorder's daily audit beside them. */
async function runOnce(now: Date): Promise<Response> {
  // Once a day this call also audits the overnight recorder's last 24 hours (`_shared/recorder_watch.ts`),
  // beside the recording and never in its way.
  const audit = isAuditCall(now, 10, 0)
    ? auditRecorder({
      recorder: "overnight-record", table: "overnight_intraday_points", column: "bucket_time",
      order: "bucket_time.asc,ticker.asc", now, owed: shouldRecord,
    })
    : Promise.resolve(null);
  const [res] = await Promise.all([record(now), audit]);
  return res;
}

/**
 * A request's way through: the bearer, then the call's beat (`_shared/beats.ts`), then its work. The beat comes first so
 * that a call whose worker the platform never started is told apart from one that started, and `edge-watchdog` runs
 * the first kind again (0075). A beat that cannot be written stops nothing. Exported so that order is pinned.
 */
export async function handle(req: Request, deps: {
  cronSecret: string; beat: (key: string) => Promise<unknown>; run: (now: Date) => Promise<Response>;
}): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const auth = req.headers.get("Authorization") ?? "";
    if (!deps.cronSecret || auth !== `Bearer ${deps.cronSecret}`) {
      return new Response("forbidden", { status: 403, headers: CORS });
    }

    const now = new Date();
    await deps.beat(beatKeyOfRequest("snapshot-record", req.url)).catch(() => false);
    return await deps.run(now);
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("snapshot-record.unhandled", { message: msg });
    return json(500, { ok: false, error: "internal" });
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, { cronSecret: CRON_SECRET, beat: (key) => writeBeat(key), run: runOnce }));
