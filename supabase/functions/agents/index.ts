// Supabase Edge Function: agents
//
// The server half of the Agents feature: strategies that trade crypto on
// two venue accounts — a Revolut X sub-account and a Kraken account — with
// TypeSafe's Jev as a decision node inside a deterministic rulebook. Read
// docs/agents/reference.md before changing anything here; every rule in
// CLAUDE.md's Agents section is a consequence of what is measured there.
//
//   POST ?action=tick       — one turn of the loop (tick.ts). pg_cron every
//                             minute (migration 0037). Cron or admin.
//   GET  ?action=dashboard  — everything the Agents page shows: strategies
//                             with positions and P&L derived from fills,
//                             the latest observation per symbol, the caps,
//                             venue health, Jev spend, recent decisions and
//                             orders. Admin or read-only. Before migration
//                             0037 has run it answers `{ notReady: true }`
//                             rather than a 500, so the page can say so.
//   GET  ?action=chart      — one strategy × symbol for the detail page:
//                             the signal venue's candles over the window the
//                             rule works in, every fill and open order on it,
//                             the decisions and the latest observation
//                             (`&strategy=<id>&symbol=<sym>`). Admin or ro.
//   GET  ?action=log        — more history for one strategy
//                             (`&strategy=<id>&limit=<n>`). Admin or ro.
//   POST ?action=jev        — read-only measurement: ask the decision model about a batch of states from
//                             the closed vocabulary and return what the gate would read (operator only)
//   GET  ?action=probe      — read-only self-check of every credential and
//                             transport. Revolut X: signs one balances call
//                             (which account does this key see?), reads the
//                             three pairs' config, makes one candles call
//                             with a query string (query signing exercised).
//                             Kraken: balances, the account's own fee tier
//                             (TradeVolume), open orders, and one AddOrder
//                             with `validate=true` — the venue checks the
//                             request and places NOTHING; it is the only way
//                             to prove a key's trading permission without an
//                             order. Then asks Jev one trivial question on
//                             EACH transport so the answer shape, latency and
//                             cost are on record. Places nothing anywhere.
//                             Cron or admin.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (pg_cron / pg_net, the same
// Vault secret every other scheduled function uses) OR an `x-app-token`
// (admin for everything, ro for the two reads). Deploys --no-verify-jwt,
// as snapshot-record does, because a cron bearer is not a Supabase JWT.
//
// Secrets: REVOLUT_X_API_KEY (the 64-char id; the store spells it
// `Revolut_X_API_kEY` — both spellings are read), REVOLUT_X_PRIVATE_KEY
// (the Ed25519 private key in any pasted shape), KRAKEN_PRO_API_KEY +
// KRAKEN_PRO_PRIVATE_KEY (the base64 secret as issued), OPENROUTER_API_KEY
// / `openrouter_api_key`, TYPESAFE_API_KEY / `typesafe_API_KEY`. None is
// ever echoed: the probe reports the FORM of a private key, not a byte of
// it, and every upstream error is truncated. Market data needs no key on
// either venue, so a missing credential degrades a venue to paper-only
// rather than stopping the loop.

import { reportServerError } from "../_shared/ops.ts";
import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { askJev, type JevEnv, type JevResult, type Questions } from "../_shared/jev.ts";
import { activeOrders, balances, candles, loadPrivateKey, pairs, publicTickers, REVX_REGION, revxVenue, type RevxEnv } from "../_shared/revx.ts";
import {
  addOrder, balance as krakenBalance, balanceEx, cancelOrder as krakenCancel, closedOrders, krakenNonce, krakenVenue, ohlc, openOrders,
  krakenSupports, ticker as krakenTicker, tradeVolume, type KrakenEnv,
} from "../_shared/kraken.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { JEV_QUESTION_VERSION, positionFromFills, unrealisedUsd, type CategoricalState, type Position, type StrategyKind } from "../_shared/agents_strategy.ts";
import type { Venue, VenueId } from "../_shared/venue.ts";
import { binancePaperVenue, binanceProbe, toBinanceSymbol } from "./binance.ts";
import { ALL_QUESTION_VERSIONS, isRowQuestionVersion, questionsFor, ROW_QUESTION_KIND, type AnyQuestionVersion } from "./jev_rows.ts";
import { makeDb, type Db } from "./db.ts";
import { deribitProbe } from "./deribit.ts";
import { QUOTE_TICK, runQuotes } from "./quotes.ts";
import { dayOpenOf, dayPnl, decisionBarMs, isOffBook, jevViewOf, resolveBook, stateBarMs, tick, toFill, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

export { constantTimeEqual, verifyToken } from "../_shared/token.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** First non-empty of several spellings — the secrets store keeps whatever case a person typed. */
export function envAny(names: string[], read: (n: string) => string | undefined = (n) => Deno.env.get(n)): string {
  for (const n of names) { const v = read(n); if (v && v.trim()) return v.trim(); }
  return "";
}

export const SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"] as const;

/** The symbols the probe checks: every symbol on an active strategy row (so a coin added by migration is probed too), or the three majors when the rows cannot be read. */
export function probeSymbols(rows: { symbols?: unknown }[], fallback: readonly string[] = SYMBOLS): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const sym of Array.isArray(r.symbols) ? r.symbols : []) if (typeof sym === "string" && sym.includes("/")) out.add(sym);
  return out.size ? [...out].sort() : [...fallback];
}
const ONE_D = 86400e3, ONE_H = 3600e3;

/**
 * The newest observation for ONE strategy and symbol. A single window over
 * all of them cannot do this job: observations are written only when the
 * state CHANGES, so a pair whose words have been steady for hours is pushed
 * out of any fixed limit by the busy pairs, and the page then says "no
 * reading yet" about a symbol the loop is reading every minute. That is
 * exactly what AVAX did on 2026-09-21 — its last change was 13:12 UTC and
 * the newest 400 rows reached back only to 15:53. The tick has always read
 * these one pair at a time, for the same reason; the dashboard does now too.
 */
export function latestObservationQuery(strategyId: string, symbol: string): string {
  return `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${encodeURIComponent(symbol)}&select=strategy_id,symbol,ts,bar_start,state,numbers&order=ts.desc&limit=1`;
}

/** PostgREST's way of saying the schema is not there yet: the tables arrive with migration 0037 on merge. */
export function isNotReady(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(m);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export type Who = "cron" | "admin" | "ro" | null;

/** Cron bearer (constant-time) or an app token with its role. */
export async function authorise(req: Request, cronSecret: string): Promise<Who> {
  const auth = req.headers.get("authorization") ?? "";
  if (cronSecret && auth.startsWith("Bearer ")) {
    const presented = auth.slice(7).trim();
    if (constantTimeEqual(presented, cronSecret)) return "cron";
  }
  const token = req.headers.get("x-app-token") ?? "";
  if (token) {
    const v = await verifyToken(token);
    if (v?.role === "admin") return "admin";
    if (v?.role === "ro") return "ro";
  }
  return null;
}

async function loadRevx(): Promise<{ env: RevxEnv; keyForm: string } | { error: string }> {
  const apiKey = envAny(["REVOLUT_X_API_KEY", "Revolut_X_API_kEY", "REVOLUT_X_API_KEY_ID"]);
  const priv = envAny(["REVOLUT_X_PRIVATE_KEY", "Revolut_X_Private_Key", "REVX_PRIVATE_KEY"]);
  if (!apiKey) return { error: "REVOLUT_X_API_KEY missing" };
  if (!priv) return { error: "REVOLUT_X_PRIVATE_KEY missing" };
  try {
    const { key, form } = await loadPrivateKey(priv);
    return { env: { apiKey, privateKey: key }, keyForm: form };
  } catch (e) {
    return { error: `private key unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function loadKraken(): { env: KrakenEnv; secretBytes: number } | { error: string } {
  const apiKey = envAny(["KRAKEN_PRO_API_KEY", "KRAKEN_API_KEY", "Kraken_Pro_API_Key"]);
  const secret = envAny(["KRAKEN_PRO_PRIVATE_KEY", "KRAKEN_PRIVATE_KEY", "KRAKEN_PRO_SECRET", "KRAKEN_API_SECRET"]);
  if (!apiKey) return { error: "KRAKEN_PRO_API_KEY missing" };
  if (!secret) return { error: "KRAKEN_PRO_PRIVATE_KEY missing" };
  let secretBytes = 0;
  try { secretBytes = b64ToBytes(secret).length; } catch { return { error: "KRAKEN_PRO_PRIVATE_KEY is not base64" }; }
  return { env: { apiKey, secret, nonce: krakenNonce }, secretBytes };   // ONE sequence per isolate: a tick and a dashboard in the same isolate must not both mint the same nonce
}

function jevEnv() {
  return {
    openrouterKey: envAny(["OPENROUTER_API_KEY", "openrouter_api_key"]) || undefined,
    typesafeKey: envAny(["TYPESAFE_API_KEY", "typesafe_API_KEY", "typesafe_api_key"]) || undefined,
  };
}

/** Kraken's fee tier moves with 30-day volume, not with the minute: read once an hour per isolate, not on every page load. */
let feeTier: { at: number; feeBps: { maker: number; taker: number } } | null = null;
const FEE_TIER_TTL_MS = 3600e3;

/**
 * Every venue: Revolut X and Kraken with credentials when the store has them and keyless market data when it does not,
 * and Binance, which runs paper rows only and reads public market data (`binancePaperVenue`) — it holds no key.
 */
async function loadVenues(): Promise<{ venues: Record<VenueId, Venue>; notes: Record<VenueId, string | null> }> {
  const rx = await loadRevx();
  const kk = loadKraken();
  const revx = revxVenue("error" in rx ? null : rx.env);
  const kraken = krakenVenue("error" in kk ? null : kk.env);
  let kkNote: string | null = null;
  if (!("error" in kk)) {                                 // the account's own tier, not the published table
    if (feeTier && Date.now() - feeTier.at < FEE_TIER_TTL_MS) Object.assign(kraken.feeBps, feeTier.feeBps);
    else {
      // Kraken is a signal venue only since 0046: its fee tier prices nothing the tick does. A private call that fails at
      // the network level (the "Signal timed out." of production's agents.crash rows, 2026-09-22/23) used to throw out of
      // here before `tick()` began — no lease, no reconcile, no floor on any Revolut X position — and, the cache staying
      // cold, again every minute of the outage. It is now a note, retried in five minutes.
      try { await kraken.refreshFees(); feeTier = { at: Date.now(), feeBps: { ...kraken.feeBps } }; }
      catch (e) {
        feeTier = { at: Date.now() - FEE_TIER_TTL_MS + 5 * 60e3, feeBps: { ...kraken.feeBps } };
        kkNote = `kraken fee tier unreadable (${e instanceof Error ? e.message : String(e)}); the default schedule stands in`;
      }
    }
  }
  return {
    venues: { revx, kraken, binance: binancePaperVenue() },
    notes: { revx: "error" in rx ? rx.error : null, kraken: "error" in kk ? kk.error : kkNote, binance: null },
  };
}

/** The venues the page's VENUES section shows, in order: Revolut X, and Binance with its paper rows (`0049`). */
export const PAGE_VENUES = ["revx", "binance"] as const;

function db(): Db {
  return makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

// ------------------------------------------------------------------- tick

/**
 * One `ops_errors` row for a turn's errors. `message` is the joined list cut to what the column keeps, so a turn with a
 * few long errors used to lose every later one — a refusal naming its constraint included. The whole list goes in
 * `context.errors` as well, each error kept whole up to a generous cap.
 */
export function tickErrorReport(report: { errors: string[]; at: string }) {
  return {
    message: report.errors.join(" | ").slice(0, 500),
    context: { at: report.at, count: report.errors.length, errors: report.errors.slice(0, 40).map((e) => e.slice(0, 800)) },
  };
}

/**
 * The paper quote test (quotes.ts): its own cron job, called at the top of the minute like the tick. It waits until
 * `QUOTES_START_MS` into the minute before reading Revolut X, so its public reads do not land on the tick's, and then
 * decides the minute that just closed.
 */
export const QUOTES_START_MS = 25e3;
export function quotesDelayMs(nowMs: number): number {
  const into = nowMs % 60e3;
  return into < QUOTES_START_MS ? QUOTES_START_MS - into : 0;
}
async function runQuotesAction(wait: boolean) {
  if (wait) await new Promise((r) => setTimeout(r, quotesDelayMs(Date.now())));
  return await runQuotes({ db: db(), now: Date.now(), holder: crypto.randomUUID() });
}

export async function runTick(now = Date.now()) {
  const { venues, notes } = await loadVenues();
  const report = await tick({ db: db(), venues, jev: jevEnv(), now, uuid: () => crypto.randomUUID() });
  if (report.errors.length) await reportServerError("agents.tick", tickErrorReport(report));
  return { ...report, venues: { revx: { canTrade: venues.revx.canTrade, note: notes.revx }, kraken: { canTrade: venues.kraken.canTrade, note: notes.kraken, feeBps: venues.kraken.feeBps }, binance: { canTrade: venues.binance.canTrade, note: notes.binance, feeBps: venues.binance.feeBps } } };
}

// -------------------------------------------------------------- dashboard

type DecisionRow = {
  id: number; ts: string; strategy_id: string; venue: VenueId; symbol: string; mode: string; state: unknown; numbers: Record<string, unknown>;
  answers: unknown; provider: string; model: string | null; latency_ms: number | null; cost_usd: number | null;
  rule_action: string; rule_reason: string; final_action: string; final_reason: string; risk_allowed: boolean; risk_reason: string;
};

export function jevStats(rows: { provider: string; cost_usd: number | null; latency_ms: number | null }[]) {
  const providers: Record<string, number> = {};
  let cost = 0, lat = 0, n = 0;
  for (const r of rows) {
    providers[r.provider] = (providers[r.provider] ?? 0) + 1;
    cost += Number(r.cost_usd ?? 0);
    if (r.latency_ms) { lat += Number(r.latency_ms); n++; }
  }
  return { calls: rows.length, costUsd: cost, avgLatencyMs: n ? Math.round(lat / n) : null, providers };
}

export type ProbeSummaryRow = {
  venue: string; symbol: string; side: string; state: string;
  maker_price: string | number; taker_price: string | number;
  minutes_to_fill: number | null; follow_up: Record<string, number> | null;
};

/**
 * The maker probes (`0042`), read the only way they answer anything: a fill RATE and an
 * adverse-selection number. Revolut X is 0 % maker and the loop crosses the touch, and §3.13
 * put the break-even for resting instead at 10–20 bps of adverse move through the bid — a band
 * a backtest could not measure, because its bid is a synthetic offset on a Coinbase candle.
 *
 * `adverseBps` is the answer: for each FILLED probe, how far the market had moved past the
 * price a resting order would have taken, at +15 and +60 minutes, signed so that POSITIVE is
 * against the fill (a buy that filled and then fell, a sell that filled and then rose). Read
 * the median against 10–20 bps: above it, resting loses more to selection than the 9 bps taker
 * fee costs; below it, the fee is the bigger number and resting is worth testing for real.
 *
 * Every figure is null until probes exist, and the counts say how thin the evidence is.
 */
export function probeSummary(rows: ProbeSummaryRow[]) {
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y), i = a.length >> 1;
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  };
  const filled = rows.filter((r) => r.state === "filled");
  const adverse = (key: string) => med(filled.flatMap((r) => {
    const after = r.follow_up?.[key];
    const maker = Number(r.maker_price);
    if (after == null || !(maker > 0)) return [];
    // A buy that filled and then fell has moved AGAINST the fill; so has a sell that then rose.
    const bps = (r.side === "buy" ? maker - after : after - maker) / maker * 1e4;
    return [bps];
  }));
  const resolved = filled.length + rows.filter((r) => r.state === "expired").length;
  return {
    total: rows.length,
    resting: rows.filter((r) => r.state === "resting").length,
    filled: filled.length,
    expired: rows.filter((r) => r.state === "expired").length,
    /** Of the probes that RESOLVED, the share that the market came back to. Null while none has. */
    fillRate: resolved ? filled.length / resolved : null,
    medianMinutesToFill: med(filled.map((r) => r.minutes_to_fill).filter((x): x is number => x != null)),
    /** Positive = the market moved against the fill. Compare with §3.13's 10–20 bps break-even. */
    adverseBps: { m15: adverse("m15"), m60: adverse("m60") },
    bySymbol: [...new Set(rows.map((r) => r.symbol))].sort().map((symbol) => {
      const mine = rows.filter((r) => r.symbol === symbol);
      const f = mine.filter((r) => r.state === "filled");
      const res = f.length + mine.filter((r) => r.state === "expired").length;
      return { symbol, total: mine.length, filled: f.length, fillRate: res ? f.length / res : null };
    }),
  };
}

export type QuoteTripRow = {
  book: string; t_exit: string; pnl_usd: number | string; notional_usd: number | string;
  side?: string; k?: number | string; t_entry?: string; entry?: number | string; exit?: number | string; how?: string;
};
/** A rung as `quotes.ts` stores it (`Rung`): only the fields the page reads. */
type QuoteRungState = { side?: string; k?: number; mode: string; nq?: number; qty?: number; entry?: number; tEntry?: number; o?: { ticks?: number; fairAt?: number } | null };
type QuoteBookState = { rungs?: QuoteRungState[]; lastX?: number | null; lastPrint?: { ts?: number; ticks?: number } | null };
type QuoteStateRow = { state: { books?: Record<string, QuoteBookState> }; last_minute: string | null; updated_at: string; last_error: string | null };

/** The capital PR5's quotes lock: 2 books × 2 sides × 3 rungs × $100. */
export const QUOTES_CAPITAL_USD = 1200;

/** How many of the latest round trips the quote test's page lists. */
export const QUOTES_RECENT_TRIPS = 20;

/**
 * One book of the quote test for its page: each rung's state and price (GBP a coin), what a held rung is worth and has
 * made, and the book's round trips. A held rung is marked at the book's last print, the same price a trip's P&L would
 * use (`quotes.ts`: qty × (exit − entry) for a bid, the other way for an ask, in USD at the book's last rate).
 */
export function quoteBookView(name: string, b: QuoteBookState, trips: QuoteTripRow[]) {
  const x = b.lastX ?? null;
  const last = b.lastPrint?.ticks != null ? b.lastPrint.ticks * QUOTE_TICK : null;
  const rungs = (b.rungs ?? []).map((r) => {
    const held = r.mode === "position";
    const unrealisedUsd = held && last != null && x != null && r.qty != null && r.entry != null
      ? (r.side === "bid" ? r.qty * (last - r.entry) : r.qty * (r.entry - last)) * x
      : null;
    return {
      side: r.side ?? null, k: r.k ?? null, mode: r.mode,
      price: r.o?.ticks != null ? r.o.ticks * QUOTE_TICK : null,
      entry: held ? r.entry ?? null : null, heldSince: held && r.tEntry != null ? new Date(r.tEntry).toISOString() : null,
      valueUsd: held ? (r.nq ?? 0) * (x ?? 0) : null, unrealisedUsd,
    };
  });
  const mine = trips.filter((t) => t.book === name);
  const heldRungs = rungs.filter((r) => r.mode === "position");
  return {
    book: name, lastX: x, lastPrice: last, lastPrintAt: b.lastPrint?.ts != null ? new Date(b.lastPrint.ts).toISOString() : null,
    fair: (b.rungs ?? []).map((r) => r.o?.fairAt).find((f) => f != null) ?? null,
    rungs,
    quoting: rungs.filter((r) => r.mode === "quote").length, held: heldRungs.length,
    openUsd: heldRungs.reduce((a, r) => a + (r.valueUsd ?? 0), 0),
    unrealisedUsd: heldRungs.some((r) => r.unrealisedUsd == null) ? null : heldRungs.reduce((a, r) => a + (r.unrealisedUsd ?? 0), 0),
    trips: mine.length, won: mine.filter((t) => Number(t.pnl_usd) > 0).length, realisedUsd: mine.reduce((a, t) => a + Number(t.pnl_usd), 0),
  };
}

/**
 * The paper quote test (`quotes.ts`, reference §4 item 31) for the page: its P&L on the $1,200 it would lock, today's,
 * its round trips, what it holds, its orders today against Revolut X's 1,000 a day, and whether it is keeping up (it
 * decides one minute behind the clock, so a last minute more than five back means it has stopped).
 */
export function quotesSummary(st: QuoteStateRow | null, trips: QuoteTripRow[], today: Array<{ kind: string }>, startedAt: string | null, nowMs: number, dayStartMs: number) {
  if (!st || !st.last_minute) return null;
  const pnl = trips.reduce((a, t) => a + Number(t.pnl_usd), 0);
  const todayPnl = trips.filter((t) => Date.parse(t.t_exit) >= dayStartMs).reduce((a, t) => a + Number(t.pnl_usd), 0);
  const books = Object.keys(st.state.books ?? {}).sort().map((name) => quoteBookView(name, st.state.books![name], trips));
  const lagMinutes = Math.round((nowMs - Date.parse(st.last_minute)) / 60e3);
  const recent = [...trips].sort((a, b) => Date.parse(b.t_exit) - Date.parse(a.t_exit)).slice(0, QUOTES_RECENT_TRIPS).map((t) => ({
    book: t.book, side: t.side ?? null, k: t.k != null ? Number(t.k) : null, tEntry: t.t_entry ?? null, tExit: t.t_exit,
    entry: t.entry != null ? Number(t.entry) : null, exit: t.exit != null ? Number(t.exit) : null, how: t.how ?? null,
    notionalUsd: Number(t.notional_usd), pnlUsd: Number(t.pnl_usd),
  }));
  return {
    startedAt, lastMinute: st.last_minute, lagMinutes, running: lagMinutes <= 5, lastError: st.last_error,
    capitalUsd: QUOTES_CAPITAL_USD,
    realisedUsd: pnl, realisedPct: pnl / QUOTES_CAPITAL_USD * 100,
    todayUsd: todayPnl, todayPct: todayPnl / QUOTES_CAPITAL_USD * 100,
    trips: trips.length, won: trips.filter((t) => Number(t.pnl_usd) > 0).length,
    open: books.reduce((a, b) => a + b.held, 0), openUsd: books.reduce((a, b) => a + b.openUsd, 0),
    unrealisedUsd: books.some((b) => b.unrealisedUsd == null) ? null : books.reduce((a, b) => a + (b.unrealisedUsd ?? 0), 0),
    ordersToday: today.filter((e) => e.kind === "order").length, fillsToday: today.filter((e) => e.kind === "fill").length,
    books, recent,
  };
}

/**
 * Everything the Agents page shows, computed here and nowhere else:
 * positions and P&L come from `positionFromFills` over the filled orders,
 * marked at each venue's current mid. Money is USD throughout.
 */
type ObservationRow = { strategy_id: string; symbol: string; ts: string; bar_start: string; state: Record<string, unknown>; numbers: Record<string, unknown> };

type Totals = { costUsd: number; valueUsd: number; unrealisedUsd: number; realisedUsd: number; feesUsd: number; todayUsd: number };
const zeroTotals = (): Totals => ({ costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0 });
const addTotals = (t: Totals, x: Totals) => { t.costUsd += x.costUsd; t.valueUsd += x.valueUsd; t.unrealisedUsd += x.unrealisedUsd; t.realisedUsd += x.realisedUsd; t.feesUsd += x.feesUsd; t.todayUsd += x.todayUsd; };

/**
 * One strategy row's books, resolved exactly as the tick resolves them — `resolveBook` and `isOffBook` are the tick's
 * own functions, not a copy. `positions` are the books the loop MANAGES, one per coin: what the page draws. Every OTHER
 * book the row has fills in — a live book it was relabelled away from once flat, a paper position stranded by a flip —
 * is still money made, lost or held, so it counts in `agg` and in `byMode` under its OWN mode, and is listed in
 * `otherBooks`. Until 2026-09-22 only the resolved books counted: a flat live row relabelled `paper` or `paused` took its
 * realised real-money P&L off the page's live total, while the tick's loss breaker, which reads every fill, still had it.
 * `todayByBook` is therefore the same per-book figure the breaker gates on.
 */
export function strategyBooks(
  s: { id: string; mode: string; symbols: string[]; retired_at?: string | null },
  filled: OrderRow[], marks: Record<string, number>, dayOpens: Record<string, number>, dayStartMs: number,
) {
  const byBook = new Map<string, OrderRow[]>();                     // `${symbol}|${mode}` → this row's fills in that book
  for (const o of filled) {
    if (o.strategy_id !== s.id) continue;
    const k = `${o.symbol}|${o.mode}`;
    if (!byBook.has(k)) byBook.set(k, []);
    byBook.get(k)!.push(o);
  }
  const line = (symbol: string, book: "paper" | "live") => {
    const rows = byBook.get(`${symbol}|${book}`) ?? [];
    const pos: Position = positionFromFills(rows.map(toFill));
    const mark = marks[symbol] ?? pos.avgCost;
    return {
      symbol, book, base: pos.base, avgCost: pos.avgCost, mark,
      costUsd: pos.base * pos.avgCost, valueUsd: pos.base * mark, unrealisedUsd: unrealisedUsd(pos, mark),
      realisedUsd: pos.realisedUsd, feesUsd: pos.feesUsd, openedAt: pos.openedAt, highWater: pos.highWater, fills: rows.length,
      todayUsd: rows.length ? dayPnl(rows, marks, dayOpens, dayStartMs) : 0,
    };
  };
  const liveBase = (symbol: string) => positionFromFills((byBook.get(`${symbol}|live`) ?? []).map(toFill)).base;
  const positions = s.symbols.map((symbol) => line(symbol, resolveBook(s.mode, liveBase(symbol))));
  const shownKeys = new Set(positions.map((p) => `${p.symbol}|${p.book}`));
  const otherBooks = [...byBook.keys()].filter((k) => !shownKeys.has(k)).sort().map((k) => {
    const [symbol, book] = k.split("|");
    return line(symbol, book as "paper" | "live");
  });
  const byMode: Record<"paper" | "live", Totals> = { paper: zeroTotals(), live: zeroTotals() };
  for (const l of [...positions, ...otherBooks]) addTotals(byMode[l.book], l);
  const agg = zeroTotals();
  addTotals(agg, byMode.paper); addTotals(agg, byMode.live);
  const all = [...positions, ...otherBooks];
  return {
    positions, otherBooks, agg, byMode,
    todayByBook: { paper: byMode.paper.todayUsd, live: byMode.live.todayUsd },
    // The tick's own winding-down rule, on the tick's own books: retired and still holding in the book it resolves to, or
    // holding a book the row no longer trades. A paper position stranded under a retired LIVE label is in no book the tick
    // manages (review R, #15 — paper only), so the page must not say the loop is running its exits; `holdsAnything` still
    // keeps the row, and that position, on the page.
    windingDown: (!!s.retired_at && positions.some((l) => l.base > 0)) || positions.some((l) => isOffBook(s.mode, l.book, l.base)),
    holdsAnything: all.some((l) => l.base > 0),
    /** Real coins anywhere under this row, whatever it is called: what the live alerts must count. */
    holdsLive: all.some((l) => l.book === "live" && l.base > 0),
  };
}

/** The detail chart's position: the book the loop manages for this coin — the same rule as the page and the tick, never a blend of both books. */
export function chartBook(rowMode: string, fills: OrderRow[]): { book: "paper" | "live"; position: Position } {
  const live = positionFromFills(fills.filter((o) => o.mode === "live").map(toFill));
  const book = resolveBook(rowMode, live.base);
  return { book, position: book === "live" ? live : positionFromFills(fills.filter((o) => o.mode === "paper").map(toFill)) };
}

/** Today's open per venue and symbol from cached daily candles, by the tick's own `dayOpenOf` — today's open, else yesterday's close. */
export function dayOpensFrom(rows: { venue: string; symbol: string; open: number | string; close: number | string; start: string }[], dayStartMs: number): Record<string, Record<string, number>> {
  const series = new Map<string, { start: number; open: number; close: number }[]>();
  for (const r of rows) {
    const k = `${r.venue}|${r.symbol}`;
    if (!series.has(k)) series.set(k, []);
    series.get(k)!.push({ start: Date.parse(r.start), open: Number(r.open), close: Number(r.close) });
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [k, c1d] of series) {
    const [venue, symbol] = k.split("|");
    const open = dayOpenOf(c1d.sort((a, b) => a.start - b.start), dayStartMs);
    if (open != null) (out[venue] ??= {})[symbol] = open;
  }
  return out;
}

export async function runDashboard(now = Date.now()) {
  try {
    return await dashboard(now);
  } catch (e) {
    if (isNotReady(e)) return { at: new Date(now).toISOString(), notReady: true, reason: "the agents tables are not in this database yet (migration 0037 runs on merge)" };
    throw e;
  }
}

async function dashboard(now: number) {
  const d = db();
  const dayStart = new Date(Math.floor(now / ONE_D) * ONE_D).toISOString();
  const since24h = new Date(now - ONE_D).toISOString();
  const [strategies, riskRows, filled, open, today, probeRows, decisions24h, recentDecisions, recentOrders, backtests, basis24h, { venues, notes }] = await Promise.all([
    // Retired rows are read too and filtered below: one that is FLAT leaves the page (`0038`), one
    // that still holds something stays on it, marked `windingDown`. `0043` retired three rows that
    // were still long, and a position nobody can see is a position nobody will notice is stuck.
    d.select<StrategyRow & { description: string; updated_at: string; retired_at: string | null }>("agent_strategies", "select=*&order=id.asc"),
    d.select<RiskRow & { updated_at: string }>("agent_risk", "id=eq.1&select=*"),
    d.selectAll<OrderRow>("agent_orders", "state=in.(filled,partially_filled)&select=*&order=ts.asc,id.asc"),   // the filled part of a working order is a position too; paged — PostgREST stops at 1,000 rows without a word
    d.select<OrderRow & { request: unknown }>("agent_orders", "state=in.(pending,new,partially_filled)&select=*&order=ts.desc"),
    d.select<{ id: number; strategy_id: string; venue: VenueId; state: string }>("agent_orders", `ts=gte.${dayStart}&select=id,strategy_id,venue,state`),
    // The maker probes (`0042`), summarised below. Read whole: they are a few rows a day and the
    // adverse-selection median needs all of them, not a window.
    d.selectAll<ProbeSummaryRow>("agent_maker_probes", "select=venue,symbol,side,state,maker_price,taker_price,minutes_to_fill,follow_up&order=ts.asc,id.asc").catch(() => [] as ProbeSummaryRow[]),
    d.select<{ strategy_id: string; provider: string; cost_usd: number | null; latency_ms: number | null }>("agent_decisions", `ts=gte.${since24h}&select=strategy_id,provider,cost_usd,latency_ms`),
    d.select<DecisionRow>("agent_decisions", "select=id,ts,strategy_id,venue,symbol,mode,state,numbers,answers,provider,model,latency_ms,cost_usd,rule_action,rule_reason,final_action,final_reason,risk_allowed,risk_reason&order=ts.desc&limit=120"),
    d.select<OrderRow & { request: unknown; response: unknown; cancelled_at: string | null; decision_id: number | null }>("agent_orders", "select=*&order=ts.desc&limit=120"),
    d.select<{ id: string; strategy_id: string; ran_at: string; method: string; summary: unknown }>("agent_backtests", "select=id,strategy_id,ran_at,method,summary&order=ran_at.desc"),
    d.select<{ ts: string; symbol: string; basis_bps: number; revx_bid: number; revx_ask: number; kraken_bid: number; kraken_ask: number }>("agent_basis", `ts=gte.${since24h}&select=ts,symbol,basis_bps,revx_bid,revx_ask,kraken_bid,kraken_ask&order=ts.desc&limit=2000`),
    loadVenues(),
  ]);
  // Today's opening price per VENUE and symbol, from the cached daily candles: each strategy is marked from its own signal
  // venue's day open, exactly as the tick's loss breaker marks it, so the page's "today" and the loop's are one figure.
  const dayStartMs = Math.floor(now / ONE_D) * ONE_D;
  // Yesterday's candle is read too: until the venue publishes today's, today opened at yesterday's CLOSE (`dayOpenOf`,
  // the tick's own rule — this read only today's candle, fell back to the mark, and put 0 where the breaker had a figure).
  const dayOpenBy = dayOpensFrom(await d.select<{ venue: string; symbol: string; open: number; close: number; start: string }>("agent_candles",
    `interval_min=eq.1440&start=gte.${new Date(dayStartMs - ONE_D).toISOString()}&select=venue,symbol,open,close,start&order=start.asc`), dayStartMs);
  // The latest observation per strategy × symbol: what the rule sees on the forming bar, right now. One tiny
  // indexed query each, never one window over all of them — see `latestObservationQuery`.
  const latestObs = new Map<string, ObservationRow>();
  await Promise.all(strategies.flatMap((s) => (s.symbols ?? []).map(async (sym) => {
    const rows = await d.select<ObservationRow>("agent_observations", latestObservationQuery(s.id, sym));
    if (rows[0]) latestObs.set(`${s.id}|${sym}`, rows[0]);
  })));

  // Marks: each venue's mid for every symbol any strategy or position touches.
  const symbolsByVenue = new Map<VenueId, Set<string>>();
  const want = (v: VenueId, s: string) => { if (!symbolsByVenue.has(v)) symbolsByVenue.set(v, new Set()); symbolsByVenue.get(v)!.add(s); };
  for (const s of strategies) for (const sym of s.symbols) want(s.venue, sym);
  for (const o of filled) want(o.venue, o.symbol);
  const marks: Record<string, Record<string, number>> = {};
  const venueErrors: Record<string, string | null> = { revx: notes.revx, kraken: notes.kraken, binance: notes.binance };
  for (const [vid, syms] of symbolsByVenue) {
    try {
      const q = await venues[vid].quotes([...syms]);
      marks[vid] = Object.fromEntries(Object.entries(q).map(([s, x]) => [s, (x.bid + x.ask) / 2]));
    } catch (e) { venueErrors[vid] = `quotes: ${e instanceof Error ? e.message : String(e)}`; marks[vid] = {}; }
  }
  // Balances for the venues the page shows that the loop trades on. Kraken is the signal venue only since `0046`: its
  // candles are read, its account is not shown, so its balances are no longer fetched for the page.
  const balancesByVenue: Record<string, Record<string, number> | null> = {};
  for (const vid of ["revx"] as VenueId[]) {
    try { balancesByVenue[vid] = venues[vid].canTrade ? await venues[vid].balances() : null; }
    catch (e) { balancesByVenue[vid] = null; venueErrors[vid] = `balances: ${e instanceof Error ? e.message : String(e)}`; }
  }

  // Positions per strategy × symbol, from fills — the one implementation, resolved by the tick's own rule (`strategyBooks`).
  const totals = zeroTotals();
  const byMode: Record<"paper" | "live", Totals> = { paper: zeroTotals(), live: zeroTotals() };
  const books = new Map(strategies.map((s) => [s.id, strategyBooks(s, filled, marks[s.venue] ?? {}, dayOpenBy[s.signal_venue] ?? {}, dayStartMs)]));
  // Which retired rows are still on the page: only the ones still holding something, in any book. Decided BEFORE the map,
  // so a retired row that is already flat contributes nothing to `totals` or `byMode` — the page's aggregates keep the
  // meaning they had when a retired row simply disappeared (`0038`).
  const shown = strategies.filter((s) => !s.retired_at || books.get(s.id)!.holdsAnything);
  const out = shown.map((s) => {
    const b = books.get(s.id)!;
    const positions = b.positions.map((p) => {
      const obs = latestObs.get(`${s.id}|${p.symbol}`) ?? null;
      return { ...p, observation: obs ? { ts: obs.ts, barStart: obs.bar_start, state: obs.state, numbers: obs.numbers } : null };
    });
    addTotals(totals, b.agg);
    addTotals(byMode.paper, b.byMode.paper);
    addTotals(byMode.live, b.byMode.live);
    const agg = b.agg;
    const mine = (r: { strategy_id: string }) => r.strategy_id === s.id;
    const last = recentDecisions.find(mine) ?? null;
    const barMs = decisionBarMs(s.kind);
    return {
      id: s.id, kind: s.kind, venue: s.venue, signalVenue: s.signal_venue, name: s.name, description: s.description, symbols: s.symbols, mode: s.mode,
      capitalUsd: Number(s.capital_usd), params: s.params, updatedAt: s.updated_at,
      retiredAt: s.retired_at ?? null,
      // Retired and still holding, or holding a book it no longer trades (paused, or relabelled away from real coins): its
      // exits run and it can never buy — the tick's own rule, so the page cannot call a row stuck that the loop is covering.
      windingDown: b.windingDown,
      holdsLive: b.holdsLive,
      todayByBook: b.todayByBook,
      otherBooks: b.otherBooks,
      nextDecisionAt: new Date(Math.floor(now / barMs) * barMs + barMs).toISOString(),   // the next bar close
      costUsd: agg.costUsd, valueUsd: agg.valueUsd, unrealisedUsd: agg.unrealisedUsd, realisedUsd: agg.realisedUsd, feesUsd: agg.feesUsd, todayUsd: agg.todayUsd,
      positions,
      openOrders: open.filter(mine).length, ordersToday: today.filter(mine).length,
      jev24h: jevStats(decisions24h.filter(mine)),
      lastDecision: last ? { ts: last.ts, symbol: last.symbol, action: last.final_action, ruleAction: last.rule_action, reason: last.final_reason, provider: last.provider, riskAllowed: last.risk_allowed, riskReason: last.risk_reason } : null,
      backtest: backtests.find(mine) ?? null,
      recentDecisions: recentDecisions.filter(mine).slice(0, 30),
      recentOrders: recentOrders.filter(mine).slice(0, 30),
    };
  });

  // The book by venue: what each account holds and has made, live and paper apart.
  const byVenue: Record<string, { costUsd: number; valueUsd: number; unrealisedUsd: number; realisedUsd: number; feesUsd: number; todayUsd: number; capitalUsd: number; strategies: number; live: number }> = {};
  for (const s of out) {
    const v = (byVenue[s.venue] ??= { costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0, capitalUsd: 0, strategies: 0, live: 0 });
    v.costUsd += s.costUsd; v.valueUsd += s.valueUsd; v.unrealisedUsd += s.unrealisedUsd; v.realisedUsd += s.realisedUsd; v.feesUsd += s.feesUsd; v.todayUsd += s.todayUsd;
    v.capitalUsd += s.capitalUsd; v.strategies += 1; if (s.mode === "live") v.live += 1;
  }
  // The cross-venue basis over the last 24 h, per symbol: the arbitrage question, kept answered.
  const basisBySymbol: Record<string, { latest: number | null; latestAt: string | null; n: number; absP50: number | null; absP95: number | null; absMax: number | null; over20: number; over40: number; over80: number }> = {};
  const grouped = new Map<string, number[]>();
  for (const b of basis24h) {
    if (!grouped.has(b.symbol)) { grouped.set(b.symbol, []); basisBySymbol[b.symbol] = { latest: Number(b.basis_bps), latestAt: b.ts, n: 0, absP50: null, absP95: null, absMax: null, over20: 0, over40: 0, over80: 0 }; }
    grouped.get(b.symbol)!.push(Math.abs(Number(b.basis_bps)));
  }
  for (const [sym, abs] of grouped) {
    abs.sort((a, b) => a - b);
    const q = (p: number) => abs[Math.min(abs.length - 1, Math.floor(p * abs.length))];
    Object.assign(basisBySymbol[sym], { n: abs.length, absP50: q(0.5), absP95: q(0.95), absMax: abs[abs.length - 1], over20: abs.filter((x) => x > 20).length, over40: abs.filter((x) => x > 40).length, over80: abs.filter((x) => x > 80).length });
  }

  // The paper quote test (`0051`). Its own tables; missing ones (before the migration) leave it off the page.
  const quotes = await (async () => {
    try {
      const [st, trips, today, first] = await Promise.all([
        d.select<QuoteStateRow>("agent_quote_state", "id=eq.1&select=state,last_minute,updated_at,last_error"),
        d.select<QuoteTripRow>("agent_quote_trips", "select=book,side,k,t_entry,entry,exit,how,t_exit,pnl_usd,notional_usd&order=t_exit.desc&limit=1000"),
        d.selectAll<{ kind: string }>("agent_quote_events", `minute=gte.${encodeURIComponent(new Date(dayStartMs).toISOString())}&kind=in.(order,fill)&select=kind&order=book.asc,minute.asc,side.asc,k.asc,kind.asc`),
        d.select<{ minute: string }>("agent_quote_events", "select=minute&order=minute.asc&limit=1"),
      ]);
      return quotesSummary(st[0] ?? null, trips, today, first[0]?.minute ?? null, now, dayStartMs);
    } catch { return null; }
  })();

  return {
    at: new Date(now).toISOString(),
    dayStart: new Date(dayStartMs).toISOString(),
    risk: riskRows[0] ?? null,
    totals: { ...totals, byMode },
    byVenue,
    basis: basisBySymbol,
    // The accounts' real balances are not shown any more (Davies, 2026-09-23): every row trades paper. Revolut X's are still
    // read for the payload; Binance's paper venue holds no key, so its card is its rows' book, its fee and its quote faults.
    venues: PAGE_VENUES.map((vid) => ({ id: vid, canTrade: venues[vid].canTrade, feeBps: venues[vid].feeBps, balances: balancesByVenue[vid] ?? null, note: venueErrors[vid] ?? null, marks: marks[vid] ?? {} })),
    strategies: out,
    openOrders: open,
    /** The adverse-selection notebook (`0042`, reference §3.13): is 0 % maker actually free here? */
    makerProbes: probeSummary(probeRows),
    jev24h: jevStats(decisions24h),
    /** PR5's quotes on paper (`0051`, reference §4 item 31); null until its tables exist and it has run. */
    quotes,
  };
}

/** The window the detail chart shows, by the rule's own bar: a minute rule shows the last 12 hours, an hourly one a week, a 4-hour one a month. */
export function chartWindow(kind: StrategyRow["kind"]): { intervalMin: number; spanMs: number } {
  if (kind === "dislocation-1m") return { intervalMin: 1, spanMs: 12 * ONE_H };
  const barMs = stateBarMs(kind);
  return barMs === ONE_H ? { intervalMin: 60, spanMs: 7 * ONE_D } : { intervalMin: 240, spanMs: 30 * ONE_D };
}

/**
 * One strategy × symbol for the detail page: the signal venue's candles
 * over the rule's window, every order on the pair in that window (fills
 * become the buy/sell marks, resting orders the dashed lines), its
 * decisions, and the latest observation. Candles come from the cache the
 * tick keeps, so this costs the venue nothing.
 */
export async function runChart(strategyId: string, symbol: string, now = Date.now()) {
  try { return await chart(strategyId, symbol, now); } catch (e) {
    if (isNotReady(e)) return { at: new Date(now).toISOString(), notReady: true, reason: "the agents tables are not in this database yet (migration 0037 runs on merge)" };
    throw e;
  }
}

async function chart(strategyId: string, symbol: string, now: number) {
  const d = db();
  const [s] = await d.select<StrategyRow>("agent_strategies", `id=eq.${encodeURIComponent(strategyId)}&select=*`);
  if (!s) return { error: "unknown strategy" };
  if (!s.symbols.includes(symbol)) return { error: "symbol not in strategy" };
  const { intervalMin, spanMs } = chartWindow(s.kind);
  const since = new Date(now - spanMs).toISOString();
  const sym = encodeURIComponent(symbol);
  const [candles, orders, decisions, observations] = await Promise.all([
    d.select<{ start: string; open: number; high: number; low: number; close: number; volume: number }>("agent_candles",
      `venue=eq.${s.signal_venue}&symbol=eq.${sym}&interval_min=eq.${intervalMin}&start=gte.${since}&select=start,open,high,low,close,volume&order=start.asc&limit=2000`),
    d.select<OrderRow & { cancelled_at: string | null }>("agent_orders", `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&ts=gte.${since}&select=*&order=ts.asc&limit=500`),
    d.select<{ id: number; ts: string; bar_start: string; final_action: string; rule_action: string; final_reason: string; provider: string; risk_allowed: boolean; numbers: Record<string, unknown> }>("agent_decisions",
      `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&ts=gte.${since}&select=id,ts,bar_start,final_action,rule_action,final_reason,provider,risk_allowed,numbers&order=ts.asc&limit=500`),
    d.select<ObservationRow>("agent_observations", latestObservationQuery(strategyId, symbol)),
  ]);
  const allFilled = await d.selectAll<OrderRow>("agent_orders", `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&state=in.(filled,partially_filled)&select=*&order=ts.asc,id.asc`);
  const { book, position: pos } = chartBook(s.mode, allFilled);
  return {
    strategyId, symbol, venue: s.venue, signalVenue: s.signal_venue, kind: s.kind, mode: s.mode, intervalMin, since, at: new Date(now).toISOString(),
    candles: candles.map((c) => [Date.parse(c.start), Number(c.open), Number(c.high), Number(c.low), Number(c.close)] as [number, number, number, number, number]),
    fills: orders.filter((o) => o.state === "filled" || (o.state === "partially_filled" && Number(o.filled_base) > 0)).map((o) => ({
      id: o.id, ts: o.filled_at ?? o.ts, side: o.side, price: Number(o.avg_fill_price ?? o.price), base: Number(o.filled_base || o.base_size), feeUsd: Number(o.fee_usd || 0),
      venue: o.venue, mode: o.mode, marketable: !!o.request?.marketable, decisionId: o.decision_id,
    })),
    orders: orders.map((o) => ({
      id: o.id, ts: o.ts, side: o.side, price: Number(o.price), base: Number(o.base_size), state: o.state, venue: o.venue, mode: o.mode, requotes: Number(o.requotes ?? 0),
      marketable: !!o.request?.marketable, filledAt: o.filled_at, cancelledAt: o.cancelled_at ?? null, decisionId: o.decision_id,
    })),
    decisions: decisions.map((x) => ({ id: x.id, ts: x.ts, barStart: x.bar_start, action: x.final_action, ruleAction: x.rule_action, reason: x.final_reason, provider: x.provider, riskAllowed: x.risk_allowed, kind: (x.numbers?.kind as string) ?? "bar", mark: Number(x.numbers?.mark ?? 0) || null })),
    position: { book, base: pos.base, avgCost: pos.avgCost, realisedUsd: pos.realisedUsd, feesUsd: pos.feesUsd, openedAt: pos.openedAt },
    observation: observations[0] ? { ts: observations[0].ts, barStart: observations[0].bar_start, state: observations[0].state, numbers: observations[0].numbers } : null,
  };
}

export async function runLog(strategyId: string, limit: number) {
  try { return await log(strategyId, limit); } catch (e) {
    if (isNotReady(e)) return { strategyId, notReady: true, decisions: [], orders: [] };
    throw e;
  }
}

async function log(strategyId: string, limit: number) {
  const d = db();
  const n = Math.max(1, Math.min(500, limit || 100));
  const q = `strategy_id=eq.${encodeURIComponent(strategyId)}&select=*&order=ts.desc&limit=${n}`;
  const [decisions, orders] = await Promise.all([d.select("agent_decisions", q), d.select("agent_orders", q)]);
  return { strategyId, decisions, orders };
}

// ------------------------------------------------------------------ probe

/** The read-only probe. Nothing here can place an order. */
// ------------------------------------------------------------ jev (measure)

/**
 * The closed vocabulary of a categorical state — every word the model can ever be shown. `?action=jev` forwards a
 * state only if every field is present and every value is one of these words, so nothing free-form reaches the
 * model through it. `satisfies` pins each word to the state's own type, so a word the type does not allow cannot
 * be added here.
 */
export const STATE_VOCAB = {
  trend_4h: ["up", "down", "flat"],
  trend_strength: ["weak", "moderate", "strong"],
  breakout_4h: ["above_range", "inside_range", "below_range"],
  volatility: ["low", "normal", "high", "extreme"],
  momentum_30d: ["positive", "negative", "unknown"],
  position: ["flat", "long"],
  unrealised: ["none", "small_gain", "gain", "small_loss", "loss"],
  time_in_position: ["none", "hours", "days", "weeks"],
  drawdown_from_high: ["none", "small", "notable", "large"],
} as const satisfies { [K in Exclude<keyof CategoricalState, "symbol">]: readonly CategoricalState[K][] };

/** A state from a request body, or null: a USD pair, every field present, every value from the closed set, no extra keys. */
export function parseState(x: unknown): CategoricalState | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.symbol !== "string" || !/^[A-Z0-9]{2,10}\/USD$/.test(o.symbol)) return null;
  const out: Record<string, string> = { symbol: o.symbol };
  for (const [k, words] of Object.entries(STATE_VOCAB)) {
    const v = o[k];
    if (typeof v !== "string" || !(words as readonly string[]).includes(v)) return null;
    out[k] = v;
  }
  if (Object.keys(o).length !== Object.keys(out).length) return null;
  return out as unknown as CategoricalState;
}

/** `fn` over `items` with at most `limit` in flight, results in input order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export const JEV_BATCH_MAX_CALLS = 500;
/** The rules the model is asked for: the ones that ask it about an entry. */
export const JEV_KINDS: readonly StrategyKind[] = ["trend-4h", "trend-1h", "momentum-1d"];
export const JEV_BATCH_CONCURRENCY = 6;

/**
 * `POST ?action=jev` — ask the decision model about a batch of states and return what the loop's gate would read
 * from each reply (`jevViewOf`, the same function the tick gates on). Read-only: it places nothing, writes nothing
 * and touches no book. Operator-only, capped at `JEV_BATCH_MAX_CALLS` model calls a request (~$0.01), one
 * transport per request so a measurement never silently mixes the two, and every state validated against the closed
 * vocabulary.
 *
 * Why it exists: every backtest here prices the RULEBOOK, the account runs the rulebook AND this model's entry veto,
 * and the model is in no historical data. The state it sees on an entry has only 90 possible values, so asking the
 * real model about every one of them, several times, turns a historical replay into an exact lookup instead of an
 * inference from a dozen recorded answers (reference §4.21).
 */
export async function runJevBatch(
  body: unknown,
  env: JevEnv = jevEnv(),
  ask: (state: Record<string, unknown>, q: Questions, e: JevEnv) => Promise<JevResult> = (st, q, e) => askJev(st, q, e),
): Promise<Record<string, unknown>> {
  const b = (body && typeof body === "object" ? body : {}) as { states?: unknown; repeats?: unknown; transport?: unknown; version?: unknown; kind?: unknown };
  if (!Array.isArray(b.states) || b.states.length === 0) return { error: "states: a non-empty array is required" };
  // Which wording to ask — v1, v2, or a row's own (`jev_rows.ts`) — and for which rule: a wording can be measured before
  // the loop is switched to it. A row wording describes one rule and is refused for any other.
  const version = (b.version ?? JEV_QUESTION_VERSION) as AnyQuestionVersion;
  if (!ALL_QUESTION_VERSIONS.includes(version)) return { error: `version: one of ${ALL_QUESTION_VERSIONS.join(", ")}` };
  const kind = (b.kind ?? (isRowQuestionVersion(version) ? ROW_QUESTION_KIND[version] : "trend-4h")) as StrategyKind;
  if (!JEV_KINDS.includes(kind)) return { error: `kind: one of ${JEV_KINDS.join(", ")}` };
  if (isRowQuestionVersion(version) && ROW_QUESTION_KIND[version] !== kind) return { error: `version ${version} is written for ${ROW_QUESTION_KIND[version]}, not ${kind}` };
  const states = b.states.map(parseState);
  const bad = states.findIndex((x) => x == null);
  if (bad >= 0) return { error: `states[${bad}] is not a state in the closed vocabulary` };
  const repeats = Math.max(1, Math.min(5, Math.floor(Number(b.repeats ?? 1)) || 1));
  const calls = states.length * repeats;
  if (calls > JEV_BATCH_MAX_CALLS) return { error: `${calls} calls > ${JEV_BATCH_MAX_CALLS}; split the batch` };
  const transport = b.transport === "typesafe" ? "typesafe" : "openrouter";
  const one: JevEnv = transport === "typesafe" ? { typesafeKey: env.typesafeKey } : { openrouterKey: env.openrouterKey };
  if (!one.openrouterKey && !one.typesafeKey) return { error: `no ${transport} key configured` };
  const jobs = states.flatMap((st, i) => Array.from({ length: repeats }, () => ({ st: st!, i })));
  const replies = await mapPool(jobs, JEV_BATCH_CONCURRENCY, async ({ st }) => {
    const jr = await ask(st as unknown as Record<string, unknown>, questionsFor(st, version, kind) as unknown as Questions, one);
    const v = jevViewOf(jr, st.symbol);
    return { healthy: v.healthy, caution: v.caution, echoOk: v.echoOk, provider: jr.provider, model: jr.model, latencyMs: jr.latencyMs, costUsd: jr.costUsd, errors: jr.errors };
  });
  const results = states.map((st, i) => ({ state: st, replies: replies.filter((_, j) => jobs[j].i === i) }));
  const costUsd = replies.reduce((a, r) => a + (r.costUsd || 0), 0);
  return { at: new Date().toISOString(), transport, version, kind, calls, repeats, costUsd, results };
}

/** The probe's parts, each a credential of its own. `?only=binance,deribit` runs just those; anything unknown is dropped. */
export const PROBE_PARTS = ["revx", "kraken", "jev", "binance", "deribit"] as const;
export function probeParts(only: string | null): Set<string> | null {
  if (!only) return null;
  const picked = new Set(only.split(",").map((x) => x.trim().toLowerCase()).filter((x) => (PROBE_PARTS as readonly string[]).includes(x)));
  return picked.size ? picked : null;
}


export async function runProbe(only: Set<string> | null = null): Promise<Record<string, unknown>> {
  const want = (part: string) => !only || only.has(part);
  const out: Record<string, unknown> = { at: new Date().toISOString(), parts: only ? [...only] : [...PROBE_PARTS] };
  // Every symbol an active row trades — AVAX and SUI joined by migration after the probe was written, and a pair the venue
  // has no config for would only show up as "no pair config" after a bar had been claimed.
  let symbols: string[] = [...SYMBOLS];
  try { symbols = probeSymbols(await db().select<{ symbols: unknown }>("agent_strategies", "mode=in.(paper,live)&retired_at=is.null&select=symbols")); }
  catch (e) { out.symbolsNote = `strategy rows unreadable (${e instanceof Error ? e.message : String(e)}); probing the three majors`; }
  out.symbols = symbols;

  // --- Revolut X -----------------------------------------------------------
  const rx = want("revx") ? await loadRevx() : null;
  if (!rx) {
    // not asked for
  } else if ("error" in rx) {
    out.revx = { error: rx.error };
  } else {
    const r: Record<string, unknown> = { keyForm: rx.keyForm };
    const b = await balances(rx.env);
    r.balances = b.ok
      ? { status: b.status, rows: b.data }
      : { status: b.status, error: b.error };
    const p = await pairs(rx.env);
    if (p.ok) {
      const cfg: Record<string, unknown> = {};
      for (const s of symbols) cfg[s] = p.data?.[s] ?? null;
      r.pairs = { status: p.status, count: Object.keys(p.data ?? {}).length, config: cfg };
    } else {
      r.pairs = { status: p.status, error: p.error };
    }
    // A call WITH a query string, signed the way the reference specifies
    // (query without its "?"). Balances above has no query, so a 200 there
    // and a 401 here would isolate the query signing as the fault.
    const now = Date.now();
    const c = await candles(rx.env, "BTC/USD", 240, now - 5 * 240 * 60_000, now);
    r.candlesWithQuery = c.ok
      ? { status: c.status, count: c.data?.data?.length ?? 0, last: c.data?.data?.at(-1) ?? null }
      : { status: c.status, error: c.error };
    // The book this account trades on: the region every market-data call names, and what the filtered tickers say
    // (row count per symbol must be one — two rows would mean the filter is not being honoured, reference §2.2).
    const t = await publicTickers(symbols);
    r.region = {
      requested: REVX_REGION,
      tickers: t.ok
        ? (t.data?.data ?? []).map((x) => ({ symbol: x.symbol, region: x.region ?? null, bid: x.bid, ask: x.ask, spreadBps: Math.round(((Number(x.ask) - Number(x.bid)) / ((Number(x.ask) + Number(x.bid)) / 2)) * 1e4 * 10) / 10 }))
        : { status: t.status, error: t.error },
    };
    // The order reads the live settlement path depends on (`GET /1.0/orders/active`; the single-order read shares its row
    // shape). Reference §2 never verified either, so the probe reports the FIELD NAMES the venue actually returns — the
    // client reads `filled_size`, `average_fill_price`, `fees`, and a filled order without them is refused, never settled
    // at fee 0. Reads only; nothing is placed.
    const ao = await activeOrders(rx.env);
    r.activeOrders = ao.ok
      ? { status: ao.status, count: ao.data?.data?.length ?? 0, fields: Object.keys(ao.data?.data?.[0] ?? {}), clientReads: { documented: ["id", "status", "filled_quantity", "average_fill_price", "total_fee", "fee_currency", "client_order_id"], assumed: ["venue_order_id", "state", "filled_size", "fees"] } }
      : { status: ao.status, error: ao.error };
    out.revx = r;
  }

  // --- Kraken ----------------------------------------------------------------
  const kk = want("kraken") ? loadKraken() : null;
  if (!kk) {
    // not asked for
  } else if ("error" in kk) {
    out.kraken = { error: kk.error };
  } else {
    const k: Record<string, unknown> = { secretBytes: kk.secretBytes };   // a Kraken secret decodes to 64 bytes
    const b = await krakenBalance(kk.env);
    k.balance = b.ok ? { status: b.status, rows: b.data } : { status: b.status, error: b.error };
    const bx = await balanceEx(kk.env);
    k.balanceEx = bx.ok ? { status: bx.status, rows: bx.data } : { status: bx.status, error: bx.error };
    const tv = await tradeVolume(kk.env, symbols.filter(krakenSupports));
    k.tradeVolume = tv.ok
      ? { status: tv.status, currency: tv.data?.currency, volume: tv.data?.volume, fees: tv.data?.fees, fees_maker: tv.data?.fees_maker }
      : { status: tv.status, error: tv.error };
    const oo = await openOrders(kk.env);
    k.openOrders = oo.ok ? { status: oo.status, count: Object.keys(oo.data?.open ?? {}).length } : { status: oo.status, error: oo.error };
    // The settled shape a live order will have, and whether the venue echoes our client id on it (the reconciliation key).
    const co = await closedOrders(kk.env);
    if (co.ok) {
      const first = Object.values(co.data?.closed ?? {})[0] as Record<string, unknown> | undefined;
      k.closedOrders = { status: co.status, count: co.data?.count ?? Object.keys(co.data?.closed ?? {}).length, fields: Object.keys(first ?? {}), hasClOrdId: first ? "cl_ord_id" in first : null };
    } else {
      k.closedOrders = { status: co.status, error: co.error };
    }
    // validate=true: the venue checks pair/volume/price/flags/permission
    // and returns the order description WITHOUT a txid; nothing reaches the
    // matching engine. Priced far below market and post-only anyway. If a
    // txid ever came back it would be cancelled on the spot and flagged.
    const val = await addOrder(kk.env, {
      pair: "XBTUSD", type: "buy", ordertype: "limit", volume: "0.0001", price: "10000.0",
      oflags: "post", timeinforce: "GTC", cl_ord_id: crypto.randomUUID(), validate: true,
    });
    if (val.ok) {
      const txid = val.data?.txid ?? [];
      const rec: Record<string, unknown> = { status: val.status, descr: val.data?.descr ?? null, txid: txid.length ? txid : null };
      if (txid.length) {
        const cancelled = await Promise.all(txid.map((t) => krakenCancel(kk.env, t)));
        rec.UNEXPECTED_TXID = txid;
        rec.cancelled = cancelled.map((c) => (c.ok ? c.data : c.error));
      }
      k.validateOnlyOrder = rec;
    } else {
      k.validateOnlyOrder = { status: val.status, error: val.error };
    }
    const oh = await ohlc("BTC/USD", 240);
    if (oh.ok) {
      const key = Object.keys(oh.data ?? {}).find((x) => x !== "last");
      const rows = key ? (oh.data[key] as unknown[]) : [];
      k.ohlc = { status: oh.status, count: rows.length, first: rows[0] ?? null, last: rows.at(-1) ?? null };
    } else {
      k.ohlc = { status: oh.status, error: oh.error };
    }
    const tk = await krakenTicker(symbols.filter(krakenSupports));
    if (tk.ok) {
      const spreads: Record<string, number> = {};
      for (const [key, t] of Object.entries(tk.data ?? {})) {
        const a = Number(t.a[0]), bb = Number(t.b[0]);
        spreads[key] = Math.round((a - bb) / ((a + bb) / 2) * 1e4 * 100) / 100;
      }
      k.spreadBps = spreads;
    }
    out.kraken = k;
  }

  // --- Jev, each transport on its own --------------------------------------
  const questions: Questions = {
    positive: {
      type: "noul",
      instructions: "Does the state describe an uptrend?",
      criteria: { true: "The trend is up.", false: "The trend is not up." },
    },
    regime: { type: "choice", instructions: "Which regime?", criteria: { calm: null, volatile: "Large moves." } },
    caution: { type: "score", instructions: "How cautious should a trader be?", criteria: ["calm", "elevated", "extreme"] },
  };
  const state = { symbol: "BTC/USD", trend_4h: "up", trend_strength: "strong", volatility: "normal", momentum_30d: "positive" };
  if (want("jev")) {
    const { openrouterKey, typesafeKey } = jevEnv();
    const jev: Record<string, unknown> = { openrouterKey: !!openrouterKey, typesafeKey: !!typesafeKey };
    if (openrouterKey) jev.openrouter = await askJev(state, questions, { openrouterKey });
    if (typesafeKey) jev.typesafe = await askJev(state, questions, { typesafeKey });
    out.jev = jev;
  }

  // --- Binance and Deribit: read-only, data venues until an account holds money (reference §6) -----------------------
  if (want("binance")) {
    const apiKey = envAny(["Binance_API_KEY", "BINANCE_API_KEY"]);
    const secret = envAny(["Binance_SECRET_KEY", "BINANCE_SECRET_KEY", "BINANCE_API_SECRET"]);
    out.binance = apiKey && secret
      ? { keyChars: apiKey.length, ...(await binanceProbe({ apiKey, secret }, symbols.map(toBinanceSymbol).filter((b): b is string => b != null))) }
      : { error: "Binance_API_KEY / Binance_SECRET_KEY are not set" };
  }
  if (want("deribit")) {
    const clientId = envAny(["Deribit_CLIENT_ID", "DERIBIT_CLIENT_ID"]);
    const clientSecret = envAny(["Deribit_CLIENT_SECRET", "DERIBIT_CLIENT_SECRET"]);
    out.deribit = clientId && clientSecret
      ? await deribitProbe({ clientId, clientSecret })
      : { error: "Deribit_CLIENT_ID / Deribit_CLIENT_SECRET are not set" };
  }
  return out;
}

/**
 * The `agents.crash` row for a request that threw. The message alone could not say WHICH await threw: D1's four "Signal
 * timed out." rows (go-live audit, 2026-09-23) fitted the Kraken fee refresh and the lease claim equally. The action and
 * the top of the stack do.
 */
export function crashReport(action: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 12).join("\n").slice(0, 2000) : null;
  return { message, context: { action: action || null, name: e instanceof Error ? e.name : typeof e, stack } };
}

// ------------------------------------------------------------------ serve

if (import.meta.main) Deno.serve(async (req: Request) => {
  let action = "";
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const who = await authorise(req, Deno.env.get("CRON_SECRET") ?? "");
    if (!who) return json(401, { error: "unauthorised" });
    const url = new URL(req.url);
    action = url.searchParams.get("action") ?? "";
    const operator = who === "cron" || who === "admin";
    if (action === "tick" && req.method === "POST" && operator) return json(200, await runTick());
    if (action === "quotes" && req.method === "POST" && operator) return json(200, await runQuotesAction(url.searchParams.get("wait") !== "0"));
    if (action === "probe" && req.method === "GET" && operator) return json(200, await runProbe(probeParts(url.searchParams.get("only"))));
    if (action === "jev" && req.method === "POST" && operator) return json(200, await runJevBatch(await req.json().catch(() => null)));
    if (action === "dashboard" && req.method === "GET") return json(200, await runDashboard());
    if (action === "chart" && req.method === "GET") {
      const strategy = url.searchParams.get("strategy") ?? "", symbol = url.searchParams.get("symbol") ?? "";
      if (!strategy || !symbol) return json(400, { error: "strategy and symbol required" });
      return json(200, await runChart(strategy, symbol));
    }
    if (action === "log" && req.method === "GET") {
      const strategy = url.searchParams.get("strategy") ?? "";
      if (!strategy) return json(400, { error: "strategy required" });
      return json(200, await runLog(strategy, Number(url.searchParams.get("limit") ?? 100)));
    }
    return json(operator ? 404 : 403, { error: `unknown action '${action}'` });
  } catch (e) {
    const report = crashReport(action, e);
    await reportServerError("agents.crash", report);
    return json(500, { error: "agents crashed", message: report.message.slice(0, 200) });
  }
});
