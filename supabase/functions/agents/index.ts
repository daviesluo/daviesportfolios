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
//   POST ?action=quotes     — PR5's paper quote test (quotes.ts, 0051), then
//                             its live executor on PR5's own sub-account
//                             (quotes_live.ts, 0052), in dry-run until
//                             `agent_quote_live_config` says otherwise.
//                             pg_cron every minute. Cron or admin.
//   POST ?action=quotesv    — "Stablecoin quotes variant-1" (quotes_variant.ts,
//                             0071): PR5's stored minutes replayed through
//                             the variant's rule in two arms, into its own
//                             tables. Reads the database only. Every minute,
//                             in the one job. Cron or admin.
//   POST ?action=quotesd    — "Stablecoin quotes variant-2" (quotes_ruled.ts,
//                             0072): the same decision function with rule D on
//                             variant-1's own rate, its own tables. Reads the
//                             database only. Every minute.
//   POST ?action=quotes-convert — the one-off GBP → USDC / USDT conversion
//                             that gives the ask rungs inventory: `{ book,
//                             gbp, send }`. Without `send: true` it returns
//                             the order it would send; with it, it sends
//                             only when the executor is live and armed.
//                             Operator only; never the minute loop's.
//   POST ?action=pmlive     — Polymarket's order path (pm_live.ts, 0074, 0076):
//                             every minute from eu-west-1, RW's quotes (as
//                             RW-E applies them) on the day's markets with a
//                             reward pool of $6 to under $10 (outside RW's
//                             universe), the formula reward of every minute,
//                             and once a day what Polymarket actually paid.
//                             A dry-run until `pm_live_config` says otherwise:
//                             sends are enabled in code and the key is loaded.
//                             Cron bearer only.
//   POST ?action=views      — the view-count recorder (views.ts, 0062):
//                             Polymarket's view markets, their YES books and
//                             the YouTube counters they resolve on, every
//                             minute and every second around each market's
//                             deadline. Reads only. pg_cron every minute.
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
//                             cost are on record. Polymarket (`only=polymarket`):
//                             the stored config, the private key's address
//                             against the stored signer, the CLOB's clock, the
//                             geoblock's answer for this region, and with L2
//                             the account's keys, closed-only flag, collateral,
//                             open orders; one public book. GETs only (reference
//                             §2d). YouTube (`only=youtube`): the channels behind
//                             the view markets and one video's counter read seven
//                             times 5 s apart. Places nothing anywhere. Cron or admin.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (pg_cron / pg_net, the same
// Vault secret every other scheduled function uses) OR an `x-app-token`
// (admin for everything, ro for the two reads). Deploys --no-verify-jwt,
// as snapshot-record does, because a cron bearer is not a Supabase JWT.
//
// Secrets: REVOLUT_X_API_KEY (the 64-char id; the store spells it
// `Revolut_X_API_kEY` — both spellings are read), REVOLUT_X_PRIVATE_KEY
// (and `Revolut_X_API_kEY_2` / REVOLUT_X_PRIVATE_KEY_2, PR5's own sub-account: the probe, and the quotes' live executor)
// (the Ed25519 private key in any pasted shape), KRAKEN_PRO_API_KEY +
// KRAKEN_PRO_PRIVATE_KEY (the base64 secret as issued), OPENROUTER_API_KEY
// / `openrouter_api_key`, TYPESAFE_API_KEY / `typesafe_API_KEY`, and the
// POLYMARKET_* set (`_shared/polymarket.ts`, read by the probe; the order
// path reads the L2 credentials, the two addresses and POLYMARKET_PRIVATE_KEY,
// kept only when it is the stored signer's: `_shared/polymarket_orders.ts`) and
// YOUTUBE_API_KEY (`youtube.ts`, public view counts; sent in a header). None is
// ever echoed: the probe reports the FORM of a private key, not a byte of
// it, and every upstream error is truncated. Market data needs no key on
// either venue, so a missing credential degrades a venue to paper-only
// rather than stopping the loop.

import { reportServerError } from "../_shared/ops.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { askJev, type JevEnv, type JevResult, type Questions } from "../_shared/jev.ts";
import { activeOrders, balances, candles, historicalOrders, loadPrivateKey, pairs, publicTickers, REVX_REGION, revxVenue, type RevxEnv } from "../_shared/revx.ts";
import {
  addOrder, balance as krakenBalance, balanceEx, cancelOrder as krakenCancel, closedOrders, krakenNonce, krakenVenue, ohlc, openOrders,
  krakenSupports, ticker as krakenTicker, tradeVolume, type KrakenEnv,
} from "../_shared/kraken.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { loadPolymarketEnv, polymarketProbe } from "../_shared/polymarket.ts";
import { loadPmLiveEnv, PM_ORDER_SENDS_ENABLED, pmVenue } from "../_shared/polymarket_orders.ts";
import { PM_LIVE_TIMEOUT_MS, runPmLive } from "./pm_live.ts";
import { JEV_QUESTION_VERSION, positionFromFills, unrealisedUsd, type CategoricalState, type Position, type StrategyKind } from "../_shared/agents_strategy.ts";
import type { Venue, VenueId } from "../_shared/venue.ts";
import { binancePaperVenue, binanceProbe, toBinanceSymbol } from "./binance.ts";
import { ALL_QUESTION_VERSIONS, isRowQuestionVersion, questionsFor, ROW_QUESTION_KIND, type AnyQuestionVersion } from "./jev_rows.ts";
import { makeDb, type Db } from "./db.ts";
import { deribitProbe } from "./deribit.ts";
import { youtubeProbe } from "./youtube.ts";
import { runViews } from "./views.ts";
import { QUOTE_BOOKS, QUOTE_RUNGS, QUOTE_TICK, runQuotes, type QuoteBook, type Side } from "./quotes.ts";
import {
  coinOf, markedGbp, QUOTE_LIVE_LOSS_FRACTION, rungBook, runQuotesConvert, runQuotesLive,
  type LiveLeg, type QuoteLiveDeps, type QuoteLiveReport, type RungBook, type RungFill,
} from "./quotes_live.ts";
import { runQuotesVariant, VARIANT_ARMS, VARIANT_KEYS, VARIANT_START, variantCapitalUsd, type VariantArmName } from "./quotes_variant.ts";
import { runQuotesRuled, RULED_ARMS } from "./quotes_ruled.ts";
import { runPmrw, runPmrwSelect, RW_INSTANCE, RWC_INSTANCE, type RwInstance } from "./pmrw.ts";
import { rwcSummary, rweArmSummary, rweSummary, rwSummary, rwxArmSummaries, type RwDayRow, type RweDaysRow, type RweStateRow, type RwFillRow, type RwMinuteRow, type RwSelRow, type RwxDaysRow, type RwStateRow } from "./pmrw_view.ts";
import type { RweSelRow } from "./pmrw_e.ts";
import { runPmrwE, RWCE_REPLAY } from "./pmrw_e.ts";
import { parseRwxSpecs, researchRwx, runPmrwX, RWCX_REPLAY } from "./pmrw_x.ts";
import { booksDelayMs, runBooks } from "./books.ts";
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

/**
 * The secrets that hold each Revolut X account's key. `revx` is the strategy rows' sub-account; `revx2` is a second
 * sub-account Davies opened on 2026-09-24 for the GBP stablecoin quotes (PR5), so their conversions and balances never
 * touch the rows' book. The probe reads `revx2`, and so does the quotes' live executor (`quotes_live.ts`): its balances
 * every minute, and its order endpoints only for live rows, which `dry_run` (on from `0052`) never writes.
 */
export const REVX_KEY_NAMES = {
  revx: { apiKey: ["REVOLUT_X_API_KEY", "Revolut_X_API_kEY", "REVOLUT_X_API_KEY_ID"], priv: ["REVOLUT_X_PRIVATE_KEY", "Revolut_X_Private_Key", "REVX_PRIVATE_KEY"] },
  revx2: { apiKey: ["REVOLUT_X_API_KEY_2", "Revolut_X_API_kEY_2"], priv: ["REVOLUT_X_PRIVATE_KEY_2", "Revolut_X_Private_Key_2"] },
} as const;

/** The books the second account is for: PR5's two GBP books, and the USD books its conversions would use. */
export const REVX2_PROBE_SYMBOLS = ["USDC/GBP", "USDT/GBP", "USDC/USD", "USDT/USD"] as const;

async function loadRevx(account: keyof typeof REVX_KEY_NAMES = "revx"): Promise<{ env: RevxEnv; keyForm: string } | { error: string }> {
  const names = REVX_KEY_NAMES[account];
  const apiKey = envAny([...names.apiKey]);
  const priv = envAny([...names.priv]);
  if (!apiKey) return { error: `${names.apiKey[0]} missing` };
  if (!priv) return { error: `${names.priv[0]} missing` };
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
  const paper = await runQuotes({ db: db(), now: Date.now(), holder: crypto.randomUUID() });
  // Then the live executor (`quotes_live.ts`), on the minute the paper engine just saved: the same decisions, carried to
  // PR5's own sub-account — in dry-run until `agent_quote_live_config` says otherwise. It runs after the paper engine has
  // finished and on its own lease, so nothing it does can change what the paper test decides or records.
  let live: QuoteLiveReport | { error: string };
  try {
    live = await runQuotesLive(await quotesLiveDeps());
    if (live.errors.length) await reportServerError("agents.quotes_live", tickErrorReport(live));
  } catch (e) {
    live = { error: e instanceof Error ? e.message : String(e) };
    await reportServerError("agents.quotes_live", { message: live.error.slice(0, 500), context: { at: new Date().toISOString() } });
  }
  return { ...paper, live };
}

/**
 * The stablecoin books' recorder (books.ts): its own cron job, called at the top of the minute like the tick. It waits
 * until `BOOKS_START_MS` into the minute, when the tick's and PR5's public reads are done, and then reads one book at a
 * time.
 */
async function runBooksAction(wait: boolean) {
  if (wait) await new Promise((r) => setTimeout(r, booksDelayMs(Date.now())));
  return await runBooks({ db: db() });
}

/** The live executor's dependencies: PR5's own sub-account (`revx2`) when its key loads, and nothing keyed otherwise. */
async function quotesLiveDeps(): Promise<QuoteLiveDeps> {
  const rx2 = await loadRevx("revx2");
  return {
    db: db(), now: Date.now(), holder: crypto.randomUUID(), uuid: () => crypto.randomUUID(),
    account: "error" in rx2 ? null : revxVenue(rx2.env), accountNote: "error" in rx2 ? rx2.error : null,
  };
}

/**
 * Polymarket's order path, one minute (`pm_live.ts`, 0074 and 0076). It reads the L2 credentials, the two addresses and
 * the signing key (`loadPmLiveEnv` keeps the key only when it is the stored signer's, in a field nothing prints, and
 * scrubs every spelling of it from whatever is returned). `PM_ORDER_SENDS_ENABLED` is true: the config's `dry_run` and
 * `live_confirmed_at` decide, behind every gate. Every fetch times out after 5 s. It never throws past here: a failure
 * is a report, and the turn's faults go to `ops_errors` (a market's own condition is state, not a fault).
 */
export async function runPmLiveAction(deps: { db?: Db; fetchImpl?: typeof fetch; read?: (n: string) => string | undefined; now?: number } = {}) {
  try {
    const env = loadPmLiveEnv(deps.read);
    const report = await runPmLive({
      db: deps.db ?? db(), now: deps.now ?? Date.now(), holder: crypto.randomUUID(),
      venue: pmVenue({ fetchImpl: deps.fetchImpl, creds: env.creds, address: env.signer, sigType: env.sigType ?? 1, scrub: (s) => env.scrub(s), timeoutMs: PM_LIVE_TIMEOUT_MS }),
      sbRegion: (deps.read ?? ((n: string) => Deno.env.get(n)))("SB_REGION") ?? null,
      sendsEnabled: PM_ORDER_SENDS_ENABLED,
      account: env.funder && env.signer ? { maker: env.funder, signer: env.signer } : null,
      signer: env.key,
      signerProblem: env.keyProblem,
    });
    if (env.check.problems.length) report.errors.push(`secrets: ${env.check.problems.join("; ")}`);
    const clean = env.scrub(report);
    if (clean.errors.length) await reportServerError("agents.pm_live", tickErrorReport(clean));
    return clean;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await reportServerError("agents.pm_live", { message: message.slice(0, 500), context: { at: new Date().toISOString() } });
    return { error: message.slice(0, 300) };
  }
}

export async function runTick(now = Date.now()) {
  const { venues, notes } = await loadVenues();
  const report = await tick({ db: db(), venues, jev: jevEnv(), now, uuid: () => crypto.randomUUID() });
  if (report.errors.length) await reportServerError("agents.tick", tickErrorReport(report));
  // JEV-DRIFT: an entry's answer outside the replies measured for its state (reviews/2026-09-28-jev-drift-monitor.md).
  if (report.jevDrift.length) await reportServerError("agents.jev-drift", tickErrorReport({ errors: report.jevDrift, at: report.at }));
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
  minutes_to_fill: number | null; follow_up: Record<string, unknown> | null;
};

/**
 * The maker probes (`0042`): how often, and how fast, the market came back to where a resting
 * order would have sat, and where it went after. Revolut X is 0 % maker and the loop crosses the
 * touch at 9 bps; a backtest could not say whether a resting order on the UK book fills, because
 * its bid is a synthetic offset on a Coinbase candle.
 *
 * `adverseBps`: for each FILLED probe, how far the market had moved past the price a resting
 * order would have taken, at +15 and +60 minutes, signed so that POSITIVE is against the fill (a
 * buy that filled and then fell, a sell that filled and then rose). It is NOT the number that
 * decides resting the rules' own orders (reference §3.13's correction, §3.43): once a resting buy
 * fills it holds the position the taker's buy has held since the decision, so drift after the
 * fill is the same for both. What decides is the fill rate within the time the rule can wait,
 * the saving when filled (the spread plus the fee) and the chase when not; the review's MX-1
 * reads those from the probes. `adverseBps` is the number for a quote that holds inventory it
 * did not want.
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
    if (typeof after !== "number" || !(maker > 0)) return [];
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
    /** Positive = the market moved against the fill: drift after it, not what resting saves or costs (§3.13). */
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
  qty?: number | string;
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
 * A paper round trip's P&L in pounds, the books' own currency (Davies, 2026-10-01: the stablecoin quotes' pages and rows
 * are in pounds; only the tabs' scoreboards add them up in dollars). `quotes.ts` (`close`) computes it in pounds,
 * qty × (exit − entry) for a bid and the other way for an ask, before its rate makes it `pnl_usd`; a row without the
 * prices to say it is `pnl_usd` at `x`.
 */
export function quoteTripGbp(t: QuoteTripRow, x: number | null): number {
  const qty = Number(t.qty), entry = Number(t.entry), exit = Number(t.exit);
  if ((t.side === "bid" || t.side === "ask") && t.qty != null && t.entry != null && t.exit != null && [qty, entry, exit].every(Number.isFinite)) {
    return t.side === "bid" ? qty * (exit - entry) : qty * (entry - exit);
  }
  return x ? Number(t.pnl_usd) / x : 0;
}

/** A day of the quote test as `agent_quote_days` (`0070`) counts it. */
export type QuoteDayRow = { day: string; orders: number | string; fills: number | string; trips: number | string; won: number | string; realised_usd: number | string };

/**
 * The quote test's DAYS table (Davies, 2026-09-28: Reward quotes' days table, for Stablecoin quotes too), newest first:
 * each UTC day's orders against the venue's 1,000, its entry fills, and the round trips that closed that day with what
 * they made. Today's row is the scoreboard's TODAY, and the rows add up to its REALIZED G/L: one set of trips.
 */
export function quoteDays(rows: QuoteDayRow[], dayStartMs: number, trips: QuoteTripRow[] = [], x: number | null = null) {
  const today = new Date(dayStartMs).toISOString().slice(0, 10);
  // A day's pounds: its closed trips' (`quoteTripGbp`), so the days add up to REALIZED in pounds as in dollars.
  const gbpOf = (day: string) => trips.filter((t) => new Date(t.t_exit).toISOString().slice(0, 10) === day).reduce((a, t) => a + quoteTripGbp(t, x), 0);
  return rows
    .map((r) => ({
      day: String(r.day).slice(0, 10), orders: Number(r.orders) || 0, fills: Number(r.fills) || 0,
      trips: Number(r.trips) || 0, won: Number(r.won) || 0, realisedUsd: Number(r.realised_usd) || 0,
      realisedGbp: gbpOf(String(r.day).slice(0, 10)),
    }))
    .map((r) => ({ ...r, today: r.day === today }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

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
    const unrealisedGbp = held && last != null && r.qty != null && r.entry != null
      ? (r.side === "bid" ? r.qty * (last - r.entry) : r.qty * (r.entry - last))
      : null;
    const unrealisedUsd = unrealisedGbp != null && x != null ? unrealisedGbp * x : null;
    return {
      side: r.side ?? null, k: r.k ?? null, mode: r.mode,
      price: r.o?.ticks != null ? r.o.ticks * QUOTE_TICK : null,
      entry: held ? r.entry ?? null : null, heldSince: held && r.tEntry != null ? new Date(r.tEntry).toISOString() : null,
      valueUsd: held ? (r.nq ?? 0) * (x ?? 0) : null, unrealisedUsd,
      valueGbp: held ? r.nq ?? 0 : null, unrealisedGbp,
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
    openGbp: heldRungs.reduce((a, r) => a + (r.valueGbp ?? 0), 0),
    unrealisedGbp: heldRungs.some((r) => r.unrealisedGbp == null) ? null : heldRungs.reduce((a, r) => a + (r.unrealisedGbp ?? 0), 0),
    realisedGbp: mine.reduce((a, t) => a + quoteTripGbp(t, x), 0),
  };
}

/**
 * The paper quote test (`quotes.ts`, reference §4 item 31) for the page: its P&L on the $1,200 it would lock, today's,
 * its round trips, what it holds, its orders today against Revolut X's 1,000 a day, and whether it is keeping up (it
 * decides one minute behind the clock, so a last minute more than five back means it has stopped).
 */
export function quotesSummary(st: QuoteStateRow | null, trips: QuoteTripRow[], today: Array<{ kind: string }>, startedAt: string | null, nowMs: number, dayStartMs: number, days: QuoteDayRow[] = [], capitalUsd = QUOTES_CAPITAL_USD) {
  if (!st || !st.last_minute) return null;
  const pnl = trips.reduce((a, t) => a + Number(t.pnl_usd), 0);
  const todayPnl = trips.filter((t) => Date.parse(t.t_exit) >= dayStartMs).reduce((a, t) => a + Number(t.pnl_usd), 0);
  const books = Object.keys(st.state.books ?? {}).sort().map((name) => quoteBookView(name, st.state.books![name], trips));
  const lagMinutes = Math.round((nowMs - Date.parse(st.last_minute)) / 60e3);
  // The books' last GBP/USD, as the live book's (`liveRateOf`): its capital, set in dollars, in pounds.
  const x = books.map((b) => b.lastX).find((v) => v != null && v > 0) ?? null;
  const recent = [...trips].sort((a, b) => Date.parse(b.t_exit) - Date.parse(a.t_exit)).slice(0, QUOTES_RECENT_TRIPS).map((t) => ({
    book: t.book, side: t.side ?? null, k: t.k != null ? Number(t.k) : null, tEntry: t.t_entry ?? null, tExit: t.t_exit,
    entry: t.entry != null ? Number(t.entry) : null, exit: t.exit != null ? Number(t.exit) : null, how: t.how ?? null,
    qty: t.qty != null ? Number(t.qty) : null, notionalUsd: Number(t.notional_usd), pnlUsd: Number(t.pnl_usd), pnlGbp: quoteTripGbp(t, x),
  }));
  const pnlGbp = trips.reduce((a, t) => a + quoteTripGbp(t, x), 0);
  const todayGbp = trips.filter((t) => Date.parse(t.t_exit) >= dayStartMs).reduce((a, t) => a + quoteTripGbp(t, x), 0);
  return {
    startedAt, lastMinute: st.last_minute, lagMinutes, running: lagMinutes <= 5, lastError: st.last_error,
    capitalUsd,
    realisedUsd: pnl, realisedPct: pnl / capitalUsd * 100,
    todayUsd: todayPnl, todayPct: todayPnl / capitalUsd * 100,
    trips: trips.length, won: trips.filter((t) => Number(t.pnl_usd) > 0).length,
    open: books.reduce((a, b) => a + b.held, 0), openUsd: books.reduce((a, b) => a + b.openUsd, 0),
    unrealisedUsd: books.some((b) => b.unrealisedUsd == null) ? null : books.reduce((a, b) => a + (b.unrealisedUsd ?? 0), 0),
    ordersToday: today.filter((e) => e.kind === "order").length, fillsToday: today.filter((e) => e.kind === "fill").length,
    books, recent, days: quoteDays(days, dayStartMs, trips, x),
    // In pounds (Davies, 2026-10-01): what the page and the row show. The capital is set in dollars, so in pounds it is
    // at the books' last rate.
    x, capitalGbp: x ? capitalUsd / x : null, realisedGbp: pnlGbp, todayGbp,
    openGbp: books.reduce((a, b) => a + b.openGbp, 0),
    unrealisedGbp: books.some((b) => b.unrealisedGbp == null) ? null : books.reduce((a, b) => a + (b.unrealisedGbp ?? 0), 0),
  };
}

/** A round trip of the quote variant (`agent_quotev_trips`, `0071`): PR5's row, with its arm. */
export type QuoteVariantTripRow = QuoteTripRow & { arm: string };
/** A day of one of the variant's arms as `agent_quotev_days` (`0071`) counts it. */
export type QuoteVariantDayRow = QuoteDayRow & { arm: string };
/** The variant's state (`quotes_variant.ts`): each arm's books, as PR5's are stored, and each key's POSTs today. */
type QuoteVariantStateRow = {
  state: { arms?: Partial<Record<string, { books?: Record<string, QuoteBookState>; gov?: { day?: number; counts?: Record<string, number> } }>> };
  last_minute: string | null; updated_at: string; last_error: string | null;
};

/**
 * "Stablecoin quotes - variant" (`quotes_variant.ts`, reference §4 item 45) for the page. Arm `main`, the one its
 * pre-registration judges, in exactly the shape of PR5's `quotes`, so its page can be PR5's: P&L on the $3,600 its
 * quotes lock, what it holds, its ladders, round trips and days, and its orders and fills today (from its days, as the
 * variant sends about 1,500 a day across four keys). Beside it, what PR5's page has no place for: each key's POSTs today
 * against the governor's 600 / 700, and arm `top5`'s totals on its $2,000. No live path (`live: null`). Null until the
 * engine has saved a state.
 */
export function quotesVariantSummary(input: { state: QuoteVariantStateRow | null; trips: QuoteVariantTripRow[]; days: QuoteVariantDayRow[]; nowMs: number; dayStartMs: number }) {
  const st = input.state;
  if (!st || !st.last_minute) return null;
  const arm = (a: VariantArmName) => {
    const row: QuoteStateRow = { state: { books: st.state.arms?.[a]?.books ?? {} }, last_minute: st.last_minute, updated_at: st.updated_at, last_error: st.last_error };
    const s = quotesSummary(row, input.trips.filter((t) => t.arm === a), [], new Date(VARIANT_START).toISOString(), input.nowMs, input.dayStartMs,
      input.days.filter((d) => d.arm === a), variantCapitalUsd(VARIANT_ARMS[a]))!;
    const today = s.days.find((d) => d.today);
    return { ...s, ordersToday: today?.orders ?? 0, fillsToday: today?.fills ?? 0 };
  };
  const main = arm("main"), top5 = arm("top5");
  const gov = st.state.arms?.main?.gov, day = Math.floor(input.dayStartMs / 86400e3);
  return {
    ...main,
    live: null,
    arm: "main" as const,
    /** Each key's POSTs today, stops included: what the governor counts. */
    postsToday: Object.fromEntries(VARIANT_KEYS.map((k) => [k, gov?.day === day ? Number(gov.counts?.[k] ?? 0) : 0])),
    governor: { entryAt: VARIANT_ARMS.main.entryAt, stopAt: VARIANT_ARMS.main.stopAt },
    top5: {
      capitalUsd: top5.capitalUsd, realisedUsd: top5.realisedUsd, realisedPct: top5.realisedPct, todayUsd: top5.todayUsd, todayPct: top5.todayPct,
      trips: top5.trips, won: top5.won, open: top5.open, openUsd: top5.openUsd, unrealisedUsd: top5.unrealisedUsd,
      ordersToday: top5.ordersToday, fillsToday: top5.fillsToday,
    },
  };
}

/** The ruled instance's state (`quotes_ruled.ts`): arm `d`'s books, and the deviation check kept on the state. */
type QuoteRuledStateRow = {
  state: {
    checkMaxUsd?: number; checkDays?: number;
    arms?: Partial<Record<string, { books?: Record<string, QuoteBookState>; gov?: { day?: number; counts?: Record<string, number> } }>>;
  };
  last_minute: string | null; updated_at: string; last_error: string | null;
};

/**
 * "Stablecoin quotes variant-2" (`quotes_ruled.ts`) for the page. Arm `d`, the one its pre-registration judges, in the
 * shape of PR5's `quotes`, on the $3,600 its quotes lock. Beside it, each key's POSTs today and the deviation check
 * against PR5V's arm `main` (`checkMaxUsd`, `checkDays`). Arm `v1` is not shown. Null until the engine has saved a state.
 */
export function quotesRuledSummary(input: { state: QuoteRuledStateRow | null; trips: QuoteVariantTripRow[]; days: QuoteVariantDayRow[]; nowMs: number; dayStartMs: number }) {
  const st = input.state;
  if (!st || !st.last_minute) return null;
  const row: QuoteStateRow = { state: { books: st.state.arms?.d?.books ?? {} }, last_minute: st.last_minute, updated_at: st.updated_at, last_error: st.last_error };
  const s = quotesSummary(row, input.trips.filter((t) => t.arm === "d"), [], new Date(VARIANT_START).toISOString(), input.nowMs, input.dayStartMs,
    input.days.filter((d) => d.arm === "d"), variantCapitalUsd(RULED_ARMS.d))!;
  const today = s.days.find((d) => d.today);
  const gov = st.state.arms?.d?.gov, day = Math.floor(input.dayStartMs / 86400e3);
  return {
    ...s,
    ordersToday: today?.orders ?? 0, fillsToday: today?.fills ?? 0,
    live: null,
    arm: "d" as const,
    postsToday: Object.fromEntries(VARIANT_KEYS.map((k) => [k, gov?.day === day ? Number(gov.counts?.[k] ?? 0) : 0])),
    governor: { entryAt: RULED_ARMS.d.entryAt, stopAt: RULED_ARMS.d.stopAt },
    checkMaxUsd: st.state.checkMaxUsd ?? null, checkDays: st.state.checkDays ?? null,
  };
}

/** A live executor order as the page reads it (`agent_quote_live_orders`, `0052`). */
export type QuoteLiveOrderView = {
  id: number; ts: string; mode: string; book: string; rung_side: string | null; k: number | string | null; leg: string; state: string;
  filled_base: number | string; avg_fill_price: number | string | null; price: number | string; fee_gbp: number | string; filled_at: string | null;
  /** The venue side, the size and a cancel sent and not yet confirmed: what the live page shows of an order. The LIVE row reads none of them. */
  side?: string; base_size?: number | string; cancel_requested_at?: string | null;
};
/** One of the newest live orders, with what says why it ended as it did: the cancel's reason, the venue's refusal. */
export type QuoteLiveRecentRow = QuoteLiveOrderView & {
  cancel_reason: string | null; cancelled_at: string | null; request: { marketable?: boolean } | null; response: unknown;
};
type QuoteLiveConfigRow = { dry_run: boolean; live_confirmed_at: string | null; capital_gbp: number | string };
/** The executor's last turn as it saved it (`quotes_live.ts`, step 7): only the fields the page reads. */
type QuoteLiveStateRow = {
  state: {
    entryBook?: string | null; why?: string; posts?: { dry_run?: number; live?: number }; lossStopped?: boolean;
    at?: string; minute?: string | null; account?: boolean; guards?: Record<string, string[]>; governor?: { dry_run?: string; live?: string };
    balances?: Record<string, number> | null;
  };
  updated_at: string; last_error: string | null;
};

/** A live order written before the venue was called and not heard back this long after: the outcome is a person's to settle. */
export const QUOTES_LIVE_PENDING_MS = 2 * 60e3;
/** The executor writes its state every minute: older than this, it has stopped. */
export const QUOTES_LIVE_STALE_MS = 3 * 60e3;
/** How many UTC days the live page's DAYS lists, newest first: as many as the paper test's. */
export const QUOTES_LIVE_PAGE_DAYS = 60;
/** How many of the newest live orders its ORDERS lists, a cancel that filled nothing left out. */
export const QUOTES_LIVE_PAGE_ROWS = 50;
/**
 * The newest orders' filter: a cancel that filled nothing is not shown (Davies, 2026-10-01: every re-price cancels one, a
 * few an hour a rung), so it is left out where the rows are read, and the page's 50 are 50 that say something.
 */
export const QUOTES_LIVE_ORDERS_FILTER = "or=(state.neq.cancelled,filled_base.gt.0)";
/** The columns of a live order the LIVE row's figures read: every live order, paged. */
export const QUOTE_LIVE_SUMMARY_COLUMNS = "id,ts,mode,book,rung_side,k,leg,state,filled_base,avg_fill_price,price,fee_gbp,filled_at";
/** The columns of a live order the live page reads for what rests on each rung. */
export const QUOTE_LIVE_ORDER_COLUMNS = "id,ts,mode,book,rung_side,k,leg,side,state,price,base_size,filled_base,avg_fill_price,fee_gbp,filled_at,cancel_requested_at";
/** …and for the newest orders, with what says why each ended as it did. */
export const QUOTE_LIVE_REASON_COLUMNS = `${QUOTE_LIVE_ORDER_COLUMNS},cancel_reason,cancelled_at,request,response`;

const LIVE_OPEN_STATES = ["pending", "new", "partially_filled"];
const isoOf = (ms: number) => new Date(ms).toISOString();

/** The account's balances as the executor's last turn read them, or null when it could not. */
function liveBalancesOf(state: QuoteLiveStateRow | null): Record<string, number> | null {
  const b = state?.state.balances;
  return b && typeof b === "object" ? b : null;
}

/** The paper books' last GBP/USD: how the live book's pounds become LIVE's dollars. */
function liveRateOf(paper: QuoteStateRow | null): number | null {
  const books = paper?.state.books ?? {};
  return QUOTE_BOOKS.map((b) => books[b]?.lastX).find((v) => v != null && v > 0) ?? null;
}

/**
 * One rung of the live book: its fills, the executor's own `rungBook` over them, and what it holds marked by the executor's
 * own `markedGbp` at the paper engine's last print of its book, as the paper rungs are marked. `costGbp` and `valueGbp`
 * are what it holds at its average entry and at that print (at its entry while the book has no print).
 */
export type LiveRung = {
  book: QuoteBook; side: Side; k: number; mark: number | null; fills: RungFill[]; rb: RungBook; marked: number;
  held: boolean; costGbp: number; valueGbp: number;
  /** The conversion fees its closed trips carry (`withConversionFees`), in its fills' fees and its realised. */
  convFeesGbp: number;
};

/**
 * The conversion fee each live ask entry carries (Davies, 2026-10-01: a round trip's fees are its own and the conversion
 * fee of the coins it used). `quotes-convert` buys a book's coin with pounds, at the taker's fee, so that its asks have
 * coins to sell. An ask entry sells coins it holds, and they come out of the conversions in the order they were bought
 * (first in, first out, per book), each coin carrying its conversion's fee per coin; a conversion bought after the fill
 * gave it nothing. Coins an ask's exit buys back carry none, and a bid buys before it sells, so it uses no conversion.
 * Once every converted coin has been sold, the shares add up to the conversions' fees. Keyed by the entry's order id,
 * in pounds; `liveRungs` books each on the fill that closes its trip.
 */
export function liveConversionShares(orders: QuoteLiveOrderView[]): Map<number, number> {
  const filled = orders.filter((o) => o.mode === "live" && Number(o.filled_base) > 0);
  const at = (o: QuoteLiveOrderView) => Date.parse(o.filled_at ?? o.ts);
  const byTime = (a: QuoteLiveOrderView, b: QuoteLiveOrderView) => at(a) - at(b) || a.id - b.id;
  const shares = new Map<number, number>();
  for (const b of QUOTE_BOOKS) {
    const lots = filled.filter((o) => o.book === b && o.leg === "convert").sort(byTime)
      .map((o) => ({ at: at(o), left: Number(o.filled_base), perCoin: Number(o.fee_gbp || 0) / Number(o.filled_base) }));
    for (const o of filled.filter((x) => x.book === b && x.rung_side === "ask" && x.leg === "entry").sort(byTime)) {
      let need = Number(o.filled_base), fee = 0;
      for (const lot of lots) {
        if (lot.at > at(o) || need <= 0) break;
        const take = Math.min(lot.left, need);
        lot.left -= take;
        need -= take;
        fee += take * lot.perCoin;
      }
      if (fee > 0) shares.set(o.id, fee);
    }
  }
  return shares;
}

/**
 * A rung's fills in time order, with the conversion fees of a trip's entries (`liveConversionShares`) added to the fee of
 * the fill that brings the rung back to flat, as `liveRungTrips` cuts its trips. A trip's fees and P&L carry the
 * conversion fee of the coins it sold, and so does the rung's realised on the day the trip closed; a trip still open
 * carries none yet, so while no rung has exited in part the round trips add up to REALIZED.
 */
export function withConversionFees(side: Side, fills: RungFill[], shares: Map<number, number>, dayStartMs: number): RungFill[] {
  const sorted = [...fills].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const out: RungFill[] = [];
  let from = 0, owed = 0;
  for (let j = 0; j < sorted.length; j++) {
    owed += shares.get(sorted[j].id) ?? 0;
    const f = { ...sorted[j] };
    if (rungBook(side, sorted.slice(from, j + 1), dayStartMs).held <= 0) {
      from = j + 1;
      f.feeGbp += owed;
      owed = 0;
    }
    out.push(f);
  }
  return out;
}

/**
 * The twelve rungs' live books, in one walk over the live fills. The LIVE row's totals (`quotesLiveSummary`) and its
 * page's books, days and round trips (`quotesLiveDetail`) are both this walk, so the page cannot show a figure the row
 * does not add up to. A trip that sold converted coins carries their conversion fee on its closing fill
 * (`withConversionFees`), so that fee is in the trip, its rung's realised and every total above them.
 */
export function liveRungs(orders: QuoteLiveOrderView[], paper: QuoteStateRow | null, dayStartMs: number): LiveRung[] {
  const live = orders.filter((o) => o.mode === "live");
  const shares = liveConversionShares(live);
  const books = paper?.state.books ?? {};
  const out: LiveRung[] = [];
  for (const b of QUOTE_BOOKS) {
    const mark = books[b]?.lastPrint?.ticks != null ? books[b].lastPrint!.ticks! * QUOTE_TICK : null;
    for (const side of ["bid", "ask"] as const) for (const k of QUOTE_RUNGS) {
      const own = live.filter((o) => o.book === b && o.rung_side === side && Number(o.k) === k && Number(o.filled_base) > 0).map((o): RungFill => ({
        id: o.id, ts: Date.parse(o.filled_at ?? o.ts), leg: o.leg as LiveLeg, base: Number(o.filled_base), price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp || 0),
      }));
      const fills = withConversionFees(side, own, shares, dayStartMs);
      const rb = rungBook(side, fills, dayStartMs);
      const held = rb.held > 0;
      out.push({
        book: b, side, k, mark, fills, rb, marked: markedGbp(side, rb, mark), held,
        costGbp: held ? rb.held * rb.avgEntry : 0, valueGbp: held ? rb.held * (mark ?? rb.avgEntry) : 0,
        convFeesGbp: fills.reduce((a, f) => a + f.feeGbp, 0) - own.reduce((a, f) => a + f.feeGbp, 0),
      });
    }
  }
  return out;
}

/** A book's coins in the account, against what they cost (`liveCoinBooks`). */
export type LiveCoinBook = { book: QuoteBook; coin: string; coins: number; mark: number | null; costGbp: number; valueGbp: number; unrealisedGbp: number | null };

/**
 * Each book's coins as the account holds them, against what they cost (Davies, 2026-10-01: his account page shows each
 * coin's unrealised P&L, which the page left out). The coins are the account's own: the executor's last read of its
 * balances, or, where it could not read them, the book's own count (what the conversions bought, plus what its bids
 * hold, less what its asks have sold). What they cost: the pounds the conversions paid, fee included, less the
 * conversion fees already booked to closed trips (`withConversionFees`), plus what the bids holding paid, less what the
 * asks holding sold for. Marked at the book's last print, as the rungs are, value less cost is the unrealised of every
 * coin the book holds: the rungs' marks, and the conversions' own (their price, their fee and the pound's moves since).
 * A book with no print is valued at its cost, its unrealised unknown.
 */
export function liveCoinBooks(orders: QuoteLiveOrderView[], rungs: LiveRung[], balances: Record<string, number> | null | undefined): LiveCoinBook[] {
  const conversions = orders.filter((o) => o.mode === "live" && o.leg === "convert" && Number(o.filled_base) > 0);
  return QUOTE_BOOKS.map((b) => {
    const mine = rungs.filter((r) => r.book === b);
    const lots = conversions.filter((o) => o.book === b);
    const signed = (r: LiveRung) => (r.side === "bid" ? 1 : -1) * r.rb.held;
    const ownCount = lots.reduce((a, o) => a + Number(o.filled_base), 0) + mine.reduce((a, r) => a + signed(r), 0);
    const paid = lots.reduce((a, o) => a + Number(o.filled_base) * Number(o.avg_fill_price ?? o.price) + Number(o.fee_gbp || 0), 0);
    const costGbp = paid - mine.reduce((a, r) => a + r.convFeesGbp, 0) + mine.reduce((a, r) => a + signed(r) * r.rb.avgEntry, 0);
    const read = balances?.[coinOf(b)];
    const coins = read != null && Number.isFinite(Number(read)) ? Number(read) : ownCount;
    const mark = mine[0]?.mark ?? null;
    const valueGbp = mark == null ? costGbp : coins * mark;
    return { book: b, coin: coinOf(b), coins, mark, costGbp, valueGbp, unrealisedGbp: mark == null ? null : valueGbp - costGbp };
  });
}

/**
 * The live book's totals in GBP: realised, fees and today added up rung by rung in the walk's order (TODAY is what the
 * executor's loss stop reads); what it holds — deployed, its cost and its unrealised — the coins of `liveCoinBooks`.
 */
export function liveBookGbp(rungs: LiveRung[], coins: LiveCoinBook[]) {
  let realised = 0, today = 0, fees = 0, heldRungs = 0, unmarked = 0;
  for (const r of rungs) {
    if (!r.fills.length) continue;
    realised += r.rb.realisedGbp;
    fees += r.fills.reduce((a, f) => a + f.feeGbp, 0);
    today += r.rb.realisedTodayGbp + r.marked;
    if (r.held) {
      heldRungs++;
      if (r.mark == null) unmarked++;
    }
  }
  const unrealised = coins.reduce((a, c) => a + (c.unrealisedGbp ?? 0), 0);
  const cost = coins.reduce((a, c) => a + c.costGbp, 0), value = coins.reduce((a, c) => a + c.valueGbp, 0);
  unmarked += coins.filter((c) => c.unrealisedGbp == null && c.coins > 0).length;
  return { realised, today, unrealised, cost, value, fees, heldRungs, unmarked };
}

/**
 * PR5's live executor (`quotes_live.ts`, `0052`) for the page. In dry-run it only says so, and what it would have sent
 * today. Once it has sent a real order, the book it trades: each rung's fills by the executor's own `rungBook`, marked by
 * its own `markedGbp` at the paper engine's last print, as the paper rungs are; TODAY is the figure the executor's own
 * daily loss stop reads (realised today plus what is held, marked), as a strategy row's is its own loss limit's, less
 * the conversion fees of the trips that closed today, which the stop leaves out (`withConversionFees`: a fee a person's
 * top-up paid, under a penny a rung). Its fees and realised carry those conversion fees too. GBP becomes USD at the
 * paper books' last GBP/USD, so LIVE can add it to the strategies.
 */
export function quotesLiveSummary(input: { config: QuoteLiveConfigRow | null; state: QuoteLiveStateRow | null; orders: QuoteLiveOrderView[]; paper: QuoteStateRow | null; nowMs: number; dayStartMs: number }) {
  const cfg = input.config;
  if (!cfg) return null;
  const live = input.orders.filter((o) => o.mode === "live");
  const x = liveRateOf(input.paper);
  const rungs = liveRungs(input.orders, input.paper, input.dayStartMs);
  const { realised, today, unrealised, cost, value, fees, heldRungs, unmarked } = liveBookGbp(rungs, liveCoinBooks(input.orders, rungs, liveBalancesOf(input.state)));
  const usd = (gbp: number) => (x == null ? null : gbp * x);
  const age = input.state ? input.nowMs - Date.parse(input.state.updated_at) : Infinity;
  const open = live.filter((o) => ["pending", "new", "partially_filled"].includes(o.state));
  return {
    dryRun: cfg.dry_run, armed: !!cfg.live_confirmed_at, armedAt: cfg.live_confirmed_at,
    entryBook: input.state?.state.entryBook ?? null, why: input.state?.state.why ?? "",
    running: age <= QUOTES_LIVE_STALE_MS, lagMinutes: Number.isFinite(age) ? Math.round(age / 60e3) : null, lastError: input.state?.last_error ?? null,
    postsToday: { dryRun: Number(input.state?.state.posts?.dry_run ?? 0), live: Number(input.state?.state.posts?.live ?? 0) },
    lossStopped: !!input.state?.state.lossStopped,
    capitalGbp: Number(cfg.capital_gbp), x, capitalUsd: usd(Number(cfg.capital_gbp)),
    // The executor's daily loss stop, in pounds: 1 % of the capital (`QUOTE_LIVE_LOSS_FRACTION`).
    lossStopGbp: -QUOTE_LIVE_LOSS_FRACTION * Number(cfg.capital_gbp),
    // Real money has moved once the executor has sent a live order, filled or not.
    tradedLive: live.length > 0,
    openOrders: open.length, heldRungs, unmarked,
    pending: live.filter((o) => o.state === "pending" && input.nowMs - Date.parse(o.ts) > QUOTES_LIVE_PENDING_MS).map((o) => ({ id: o.id, ts: o.ts })),
    fills: live.filter((o) => Number(o.filled_base) > 0).length,
    realisedUsd: usd(realised), todayUsd: usd(today), unrealisedUsd: usd(unrealised), costUsd: usd(cost), valueUsd: usd(value), feesUsd: usd(fees),
    // In pounds, the book's own currency: what its page and its LIVE row show (Davies, 2026-10-01); the dollars above are
    // what LIVE's scoreboard adds up.
    realisedGbp: realised, todayGbp: today, unrealisedGbp: unrealised, costGbp: cost, valueGbp: value, feesGbp: fees,
  };
}

/** A completed round trip of one live rung: from the fill that took it off flat to the one that brought it back. */
export type LiveTrip = {
  book: QuoteBook; side: Side; k: number; tEntry: string; tExit: string; entry: number; exit: number; qty: number;
  how: "exit" | "stop"; feesGbp: number; pnlGbp: number;
};

/**
 * A rung's completed round trips, each in the executor's own terms: `rungBook` over the trip's fills alone. The book is
 * flat between two trips and `rungBook` starts flat, so a trip's P&L is exactly what it adds to the rung's realised, its
 * fees taken off as `rungBook` takes them, and while a rung is flat its trips add up to its realised. A trip's entry is
 * the book's average entry before its closing fill, its exit its exits' average price. A rung still holding is in no
 * trip yet: the page shows what it holds.
 */
export function liveRungTrips(r: Pick<LiveRung, "book" | "side" | "k" | "fills">, dayStartMs: number): LiveTrip[] {
  const fills = [...r.fills].filter((f) => f.base > 0).sort((a, b) => a.ts - b.ts || a.id - b.id);
  const out: LiveTrip[] = [];
  let from = 0;
  for (let j = 0; j < fills.length; j++) {
    const trip = fills.slice(from, j + 1);
    const rb = rungBook(r.side, trip, dayStartMs);
    if (rb.held > 0) continue;                                         // still holding: the trip goes on
    from = j + 1;
    const entries = trip.filter((f) => f.leg === "entry"), exits = trip.filter((f) => f.leg === "exit" || f.leg === "stop");
    if (!entries.length || !exits.length) continue;                    // nothing was held between them: no trip
    out.push({
      book: r.book, side: r.side, k: r.k, tEntry: isoOf(entries[0].ts), tExit: isoOf(trip[trip.length - 1].ts),
      entry: rungBook(r.side, trip.slice(0, -1), dayStartMs).avgEntry,
      exit: exits.reduce((a, f) => a + f.price * f.base, 0) / exits.reduce((a, f) => a + f.base, 0),
      qty: entries.reduce((a, f) => a + f.base, 0), how: exits.some((f) => f.leg === "stop") ? "stop" : "exit",
      feesGbp: trip.reduce((a, f) => a + f.feeGbp, 0), pnlGbp: rb.realisedGbp,
    });
  }
  return out;
}

/**
 * Why a live order is where it is, in the page's words: the cancel's reason as the executor wrote it, the venue's
 * refusal, an IOC that met nothing at its limit, an answer still to come. Null for an order resting, or filled, as sent.
 */
export function liveOrderReason(o: QuoteLiveRecentRow, nowMs: number): string | null {
  if (o.state === "pending") {
    return nowMs - Date.parse(o.ts) > QUOTES_LIVE_PENDING_MS
      ? "never heard back, and the venue does not list it: a person settles it"
      : "sent; the venue's answer is read next turn";
  }
  if (LIVE_OPEN_STATES.includes(o.state)) return o.cancel_requested_at ? `cancel sent (${o.cancel_reason ?? "no reason recorded"}); not confirmed yet` : null;
  if (o.state === "cancelled") return o.cancel_reason ?? (o.request?.marketable ? "nothing filled at its limit" : "cancelled by the venue");
  if (o.state === "rejected") {
    const r = o.response && typeof o.response === "object" && !Array.isArray(o.response) ? o.response as Record<string, unknown> : null;
    if (Number(r?.status) === 429) return "turned away by the venue's rate limit; sent again next turn";
    const err = typeof r?.error === "string" && r.error.trim() ? r.error.trim().slice(0, 160) : null;
    return err ? `refused by the venue: ${err}` : "refused by the venue";
  }
  if (o.cancelled_at && Number(o.filled_base) < Number(o.base_size ?? 0)) return "filled in part; the rest was cancelled";
  return null;
}

/**
 * The live book's DAYS (Davies, 2026-10-01: the paper test's table on the live page, under INVENTORY), newest first, from
 * its first live order to today, `QUOTES_LIVE_PAGE_DAYS` at most: each UTC day's live orders (every POST the venue's
 * 1,000 a day counts, conversions included), its entry fills, the round trips that closed that day, and what the rungs
 * realised that day, conversion fees included (`liveRungs`). A day's realised is what the rungs realised from its start
 * less what they realised from the next day's, by the executor's own `rungBook`, so the days add up to REALIZED.
 */
export function liveDays(orders: QuoteLiveOrderView[], rungs: LiveRung[], trips: LiveTrip[], dayStartMs: number) {
  const live = orders.filter((o) => o.mode === "live");
  if (!live.length) return [];
  const D = 86400e3;
  const first = Math.floor(Math.min(...live.map((o) => Date.parse(o.ts))) / D) * D;
  const from = (t: number) => rungs.reduce((a, r) => a + (r.fills.length ? rungBook(r.side, r.fills, t).realisedTodayGbp : 0), 0);
  const inDay = (ms: number, d: number) => ms >= d && ms < d + D;
  const out = [];
  for (let d = dayStartMs; d >= first && out.length < QUOTES_LIVE_PAGE_DAYS; d -= D) {
    const closed = trips.filter((t) => inDay(Date.parse(t.tExit), d));
    out.push({
      day: isoOf(d).slice(0, 10), today: d === dayStartMs,
      orders: live.filter((o) => inDay(Date.parse(o.ts), d)).length,
      fills: live.filter((o) => o.leg === "entry" && Number(o.filled_base) > 0 && inDay(Date.parse(o.filled_at ?? o.ts), d)).length,
      trips: closed.length, won: closed.filter((t) => t.pnlGbp > 0).length,
      realisedGbp: from(d) - from(d + D),
    });
  }
  return out;
}

/**
 * PR5's live executor's own page (Davies, 2026-10-01: LIVE's "Stablecoin quotes" opened the paper test's page; then the
 * paper page's BOOKS and DAYS in place of its RUNGS, and no conversions or fills). The real-money book on its own
 * sub-account and nothing of the paper engine's record: each book's six rungs (its live order's price, or what it holds),
 * the account's coins, its days, its round trips and its newest orders. Every figure is the LIVE row's own walk
 * (`liveRungs`, `liveBookGbp`: a book's realised, the days and the trips add up to the row's) or the executor's own
 * record (its last turn, its orders); the paper engine gives only what it gives the row, the last print and the rate,
 * and its book's fair. Two reads of its own: what rests on each rung (`open`) and the newest `QUOTES_LIVE_PAGE_ROWS`
 * orders bar the cancels that filled nothing (`recent`); the round trips are the newest `QUOTES_RECENT_TRIPS`.
 */
export function quotesLiveDetail(input: {
  config: QuoteLiveConfigRow | null; state: QuoteLiveStateRow | null; orders: QuoteLiveOrderView[]; open: QuoteLiveOrderView[];
  recent: QuoteLiveRecentRow[]; paper: QuoteStateRow | null; nowMs: number; dayStartMs: number;
}) {
  const cfg = input.config;
  if (!cfg) return null;
  const x = liveRateOf(input.paper);
  const usd = (gbp: number | null) => (x == null || gbp == null ? null : gbp * x);
  const rungs = liveRungs(input.orders, input.paper, input.dayStartMs);
  const st = input.state?.state ?? {};
  const paperBooks = input.paper?.state.books ?? {};
  const open = input.open.filter((o) => o.mode === "live" && LIVE_OPEN_STATES.includes(o.state));
  const trips = rungs.flatMap((r) => liveRungTrips(r, input.dayStartMs))
    .sort((a, b) => Date.parse(b.tExit) - Date.parse(a.tExit) || Date.parse(b.tEntry) - Date.parse(a.tEntry));
  const balances = liveBalancesOf(input.state);
  const coinBooks = liveCoinBooks(input.orders, rungs, balances);
  return {
    books: QUOTE_BOOKS.map((b) => {
      const v = paperBooks[b] ? quoteBookView(b, paperBooks[b], []) : null;
      const mine = trips.filter((t) => t.book === b);
      return {
        book: b, lastPrice: v?.lastPrice ?? null, lastPrintAt: v?.lastPrintAt ?? null, fair: v?.fair ?? null,
        realisedGbp: rungs.filter((r) => r.book === b).reduce((a, r) => a + r.rb.realisedGbp, 0),
        realisedUsd: usd(rungs.filter((r) => r.book === b).reduce((a, r) => a + r.rb.realisedGbp, 0)),
        trips: mine.length, won: mine.filter((t) => t.pnlGbp > 0).length,
      };
    }),
    rungs: rungs.map((r) => {
      const o = open.find((q) => q.book === r.book && q.rung_side === r.side && Number(q.k) === r.k) ?? null;
      return {
        book: r.book, side: r.side, k: r.k,
        order: o && { id: o.id, leg: o.leg, price: Number(o.price), state: o.state },
        held: r.held
          ? {
            base: r.rb.held, avgEntry: r.rb.avgEntry, since: r.rb.openedAt != null ? isoOf(r.rb.openedAt) : null, costGbp: r.costGbp, valueGbp: r.valueGbp,
            // No print on its book yet: what it has made is unknown, not zero.
            unrealisedGbp: r.mark == null ? null : r.marked, unrealisedUsd: r.mark == null ? null : usd(r.marked),
          }
          : null,
        realisedGbp: r.rb.realisedGbp, realisedUsd: usd(r.rb.realisedGbp), fills: r.fills.length,
      };
    }),
    // The account as the executor last read it (its balances, totals: what rests in orders included), each coin also in
    // pounds at its book's last print and with its unrealised (`liveCoinBooks`): the coins add up to the row's deployed,
    // and their unrealised to its UNREALIZED.
    inventory: {
      at: st.at ?? input.state?.updated_at ?? null,
      assets: balances && [
        { asset: "GBP", amount: Number(balances.GBP ?? 0), gbp: Number(balances.GBP ?? 0), costGbp: null, unrealisedGbp: null, unrealisedUsd: null },
        ...coinBooks.map((c) => ({
          asset: c.coin, amount: c.coins, gbp: c.mark == null ? null : c.valueGbp, costGbp: c.costGbp,
          unrealisedGbp: c.unrealisedGbp, unrealisedUsd: usd(c.unrealisedGbp),
        })),
      ],
    },
    days: liveDays(input.orders, rungs, trips, input.dayStartMs).map(({ realisedGbp, ...d }) => ({ ...d, realisedGbp, realisedUsd: usd(realisedGbp) })),
    trips: trips.slice(0, QUOTES_RECENT_TRIPS).map((t) => ({ ...t, feesUsd: usd(t.feesGbp), pnlUsd: usd(t.pnlGbp) })),
    tripCount: trips.length, tripsWon: trips.filter((t) => t.pnlGbp > 0).length,
    orders: input.recent.map((o) => ({
      id: o.id, ts: o.ts, book: o.book, side: o.rung_side, k: o.k == null ? null : Number(o.k), leg: o.leg, venueSide: o.side ?? null,
      price: Number(o.price), base: Number(o.base_size ?? 0), state: o.state, filledBase: Number(o.filled_base),
      avgPrice: o.avg_fill_price == null ? null : Number(o.avg_fill_price), reason: liveOrderReason(o, input.nowMs),
    })),
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

const DECISION_SELECT = "select=id,ts,strategy_id,venue,symbol,mode,state,numbers,answers,provider,model,latency_ms,cost_usd,rule_action,rule_reason,final_action,final_reason,risk_allowed,risk_reason";

/**
 * Each row's newest decision, each by its own query on (strategy_id, ts). One window over all of them, the 120 newest, is
 * the hourly rows' alone by midday: a daily row's midnight decision fell out of it, and the row's dot read stale for half
 * of every day while it decided on time (2026-09-26). The tick reads its observations one pair at a time for the same
 * reason. A row whose query fails keeps what the window has for it.
 */
export async function newestDecisions<T>(ids: string[], newest: (id: string) => Promise<T[]>): Promise<Map<string, T>> {
  const got = await Promise.all(ids.map(async (id) => [id, (await newest(id).catch(() => [] as T[]))[0]] as const));
  return new Map(got.filter((x): x is readonly [string, T] => x[1] !== undefined));
}

async function dashboard(now: number) {
  const d = db();
  const dayStart = new Date(Math.floor(now / ONE_D) * ONE_D).toISOString();
  const since24h = new Date(now - ONE_D).toISOString();
  const [strategies, riskRows, filled, open, today, probeRows, decisions24h, recentDecisions, recentOrders, backtests, basis24h, { venues, notes }] = await Promise.all([
    // Retired rows are read too and filtered below: one that is FLAT leaves the page (`0038`), one
    // that still holds something stays on it, marked `windingDown`. `0043` retired three rows that
    // were still long, and a position nobody can see is a position nobody will notice is stuck.
    d.select<StrategyRow & { description: string; created_at: string; updated_at: string; retired_at: string | null }>("agent_strategies", "select=*&order=id.asc"),
    d.select<RiskRow & { updated_at: string }>("agent_risk", "id=eq.1&select=*"),
    d.selectAll<OrderRow>("agent_orders", "state=in.(filled,partially_filled)&select=*&order=ts.asc,id.asc"),   // the filled part of a working order is a position too; paged — PostgREST stops at 1,000 rows without a word
    d.select<OrderRow & { request: unknown }>("agent_orders", "state=in.(pending,new,partially_filled)&select=*&order=ts.desc"),
    d.select<{ id: number; strategy_id: string; venue: VenueId; state: string }>("agent_orders", `ts=gte.${dayStart}&select=id,strategy_id,venue,state`),
    // The maker probes (`0042`), summarised below. Read whole: they are a few rows a day and the
    // adverse-selection median needs all of them, not a window.
    d.selectAll<ProbeSummaryRow>("agent_maker_probes", "select=venue,symbol,side,state,maker_price,taker_price,minutes_to_fill,follow_up&order=ts.asc,id.asc").catch(() => [] as ProbeSummaryRow[]),
    d.select<{ strategy_id: string; provider: string; cost_usd: number | null; latency_ms: number | null }>("agent_decisions", `ts=gte.${since24h}&select=strategy_id,provider,cost_usd,latency_ms`),
    d.select<DecisionRow>("agent_decisions", `${DECISION_SELECT}&order=ts.desc&limit=120`),
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
  const lastDecisions = await newestDecisions(shown.map((s) => s.id), (id) =>
    d.select<DecisionRow>("agent_decisions", `strategy_id=eq.${encodeURIComponent(id)}&${DECISION_SELECT}&order=ts.desc&limit=1`));
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
    const last = lastDecisions.get(s.id) ?? recentDecisions.find(mine) ?? null;
    const barMs = decisionBarMs(s.kind);
    return {
      id: s.id, kind: s.kind, venue: s.venue, signalVenue: s.signal_venue, name: s.name, description: s.description, symbols: s.symbols, mode: s.mode,
      // When its test began, for the page's "tested 3d 14h" (Davies, 2026-09-28): the row's own creation.
      capitalUsd: Number(s.capital_usd), params: s.params, createdAt: s.created_at ?? null, updatedAt: s.updated_at,
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

  // "Stablecoin quotes - variant" (`0071`), read beside PR5's: its own tables; missing ones (before the migration), or no
  // state yet, leave it off the page, and a failed read leaves the rest of the page as it is.
  const quotesVariantRead = (async () => {
    try {
      const st = await d.select<QuoteVariantStateRow>("agent_quotev_state", "id=eq.1&select=state,last_minute,updated_at,last_error");
      if (!st[0]) return null;
      const [trips, days] = await Promise.all([
        d.selectAll<QuoteVariantTripRow>("agent_quotev_trips", "select=arm,book,side,k,t_entry,entry,exit,how,t_exit,pnl_usd,notional_usd,qty&order=id.asc"),
        d.select<QuoteVariantDayRow>("agent_quotev_days", "select=arm,day,orders,fills,trips,won,realised_usd&order=day.desc,arm.asc&limit=120"),
      ]);
      return quotesVariantSummary({ state: st[0], trips, days, nowMs: now, dayStartMs });
    } catch { return null; }
  })();

  // "Stablecoin quotes variant-2" (`0072`), read beside the variant: its own tables. A failed read leaves the page as it is.
  const quotesRuledRead = (async () => {
    try {
      const st = await d.select<QuoteRuledStateRow>("agent_quoted_state", "id=eq.1&select=state,last_minute,updated_at,last_error");
      if (!st[0]) return null;
      const [trips, days] = await Promise.all([
        d.selectAll<QuoteVariantTripRow>("agent_quoted_trips", "arm=eq.d&select=arm,book,side,k,t_entry,entry,exit,how,t_exit,pnl_usd,notional_usd,qty&order=id.asc"),
        d.select<QuoteVariantDayRow>("agent_quoted_days", "arm=eq.d&select=arm,day,orders,fills,trips,won,realised_usd&order=day.desc&limit=60"),
      ]);
      return quotesRuledSummary({ state: st[0], trips, days, nowMs: now, dayStartMs });
    } catch { return null; }
  })();

  // The paper quote test (`0051`). Its own tables; missing ones (before the migration) leave it off the page.
  const quotes = await (async () => {
    try {
      const [st, trips, today, first] = await Promise.all([
        d.select<QuoteStateRow>("agent_quote_state", "id=eq.1&select=state,last_minute,updated_at,last_error"),
        d.select<QuoteTripRow>("agent_quote_trips", "select=book,side,k,t_entry,entry,exit,how,t_exit,pnl_usd,notional_usd,qty&order=t_exit.desc&limit=1000"),
        d.selectAll<{ kind: string }>("agent_quote_events", `minute=gte.${encodeURIComponent(new Date(dayStartMs).toISOString())}&kind=in.(order,fill)&select=kind&order=book.asc,minute.asc,side.asc,k.asc,kind.asc`),
        d.select<{ minute: string }>("agent_quote_events", "select=minute&order=minute.asc&limit=1"),
      ]);
      // Its days (`0070`), read apart: before the view exists, the page shows the test without them.
      const days = await d.select<QuoteDayRow>("agent_quote_days", "select=day,orders,fills,trips,won,realised_usd&order=day.desc&limit=60").catch(() => [] as QuoteDayRow[]);
      const summary = quotesSummary(st[0] ?? null, trips, today, first[0]?.minute ?? null, now, dayStartMs, days);
      // Its live executor (`0052`): the real-money book it trades, once it trades one. Its own tables; before they
      // exist, the page shows the paper test alone.
      const live = await (async () => {
        try {
          const [cfg, lst, orders] = await Promise.all([
            d.select<QuoteLiveConfigRow>("agent_quote_live_config", "id=eq.1&select=dry_run,live_confirmed_at,capital_gbp"),
            d.select<QuoteLiveStateRow>("agent_quote_live_state", "id=eq.1&select=state,updated_at,last_error"),
            d.selectAll<QuoteLiveOrderView>("agent_quote_live_orders", `mode=eq.live&select=${QUOTE_LIVE_SUMMARY_COLUMNS}&order=id.asc`),
          ]);
          const base = { config: cfg[0] ?? null, state: lst[0] ?? null, orders, paper: st[0] ?? null, nowMs: now, dayStartMs };
          const summary = quotesLiveSummary(base);
          if (!summary) return null;
          // Its own page, once it is a row of LIVE (Davies, 2026-10-01: it opened the paper test's page), from the rows above
          // and two reads of its own: what rests on each rung, and the newest orders with their reasons. A read that fails
          // leaves the page without them, never the LIVE row without its figures.
          const detail = !summary.tradedLive && summary.entryBook !== "live" ? null : await (async () => {
            try {
              const [open, recent] = await Promise.all([
                d.select<QuoteLiveOrderView>("agent_quote_live_orders", `mode=eq.live&state=in.(pending,new,partially_filled)&select=${QUOTE_LIVE_ORDER_COLUMNS}&order=id.asc`),
                d.select<QuoteLiveRecentRow>("agent_quote_live_orders",
                  `mode=eq.live&${QUOTES_LIVE_ORDERS_FILTER}&select=${QUOTE_LIVE_REASON_COLUMNS}&order=id.desc&limit=${QUOTES_LIVE_PAGE_ROWS}`),
              ]);
              return quotesLiveDetail({ ...base, open, recent });
            } catch { return null; }
          })();
          return { ...summary, detail };
        } catch { return null; }
      })();
      return summary && { ...summary, live };
    } catch { return null; }
  })();

  // RW-C (`0069`): RW's engine run again, forward, into tables of its own (2026-10-09 → 10-23 UTC), the last row of
  // TESTING, with RW's page; read beside RW's. Off the page until its warm-up begins, 2026-10-08 00:00 UTC (Davies,
  // 2026-09-28), with nothing read before then; from then the row is there, saying when its fourteen days start.
  const rwcRead = (async () => {
    if (now < (RWC_INSTANCE.quietUntil ?? RWC_INSTANCE.runStart)) return null;
    try {
      const { st, selection, days, fills, latest } = await readRwRun(d, RWC_INSTANCE, dayStartMs);
      return rwcSummary({ state: st[0] ?? null, selection, latest, days, fills, nowMs: now });
    } catch { return null; }
  })();
  // RW's paper test on Polymarket (`0053`, reference §4 item 36): a row of TESTING STRATEGIES with a page of its own.
  // Its own tables; missing ones (before the migration) or no state yet leave it off the page. RW-E, the replay's other
  // arm (`0056`), is a row of its own beside it (Davies, 2026-09-26), read from the same records.
  const { rw, rwe, rwx } = await (async () => {
    try {
      const { st, selection, days, fills, first, latest } = await readRwRun(d, RW_INSTANCE, dayStartMs);
      const out = rwSummary({ state: st[0] ?? null, selection, latest, days, fills, firstMinute: first[0]?.minute ?? null, nowMs: now });
      // RW-E beside it (`0056`): its own tables; before they exist, or before its first run, the page shows RW alone.
      const reads = await (async () => {
        try {
          return await Promise.all([
            d.select<RweStateRow>("pm_rw_e_state", "id=eq.1&select=state,last_minute,last_error,updated_at"),
            d.select<RweDaysRow>("pm_rw_e_days", "select=day,arm,total,stress_total,reward,fills,capital,markets,detail&order=day.asc,arm.asc&limit=100"),
            // Every day's portfolio, for the market-days RW-E leaves out (the replay reads it the same way).
            d.select<RweSelRow>("pm_rw_selection", "select=day,cond,tick,v,min_size,rate,end_date,cat&order=day.asc,cond.asc&limit=1000"),
          ]);
        } catch { return null; }
      })();
      const e = reads ? rweSummary({ state: reads[0][0] ?? null, days: reads[1], selection, nowMs: now }) : null;
      const arm = reads
        ? rweArmSummary({ rwState: st[0] ?? null, eState: reads[0][0] ?? null, selectionAll: reads[2], today: selection, latest, days: reads[1], fills, nowMs: now })
        : null;
      // RW-E's variants (`0064`): rows of their own after it (Davies, 2026-09-27), read from their replay's own tables.
      const rwx = !reads ? [] : await (async () => {
        try {
          const [xs, xdays] = await Promise.all([
            d.select<RweStateRow>("pm_rw_x_state", "id=eq.1&select=state,last_minute,last_error,updated_at"),
            d.select<RwxDaysRow>("pm_rw_x_days", "select=day,arm,total,stress_total,reward,fills,capital,markets&order=day.asc,arm.asc&limit=200"),
          ]);
          return rwxArmSummaries({ rwState: st[0] ?? null, xState: xs[0] ?? null, selectionAll: reads[2], today: selection, latest, days: xdays, fills, nowMs: now });
        } catch { return []; }
      })();
      return { rw: out && { ...out, e }, rwe: arm && { ...arm, e }, rwx };
    } catch { return { rw: null, rwe: null, rwx: [] }; }
  })();
  const rwc = await rwcRead;
  const quotesVariant = await quotesVariantRead;
  const quotesRuled = await quotesRuledRead;

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
    /** "Stablecoin quotes variant-1" on paper (`0071`, reference §4 item 45): arm main in `quotes`' shape; null until it has run. */
    quotesVariant,
    /** "Stablecoin quotes variant-2" on paper (`0072`, reference §4 item 47): arm d in `quotes`' shape; null until it has run. */
    quotesRuled,
    /** RW's quotes for Polymarket's liquidity rewards, on paper (`0053`, reference §4 item 36); null until it has a state. */
    rw,
    rwe,
    rwx,
    /** RW-C, the same quotes forward on 2026-10-09 → 10-23 (`0069`); null until its tables exist. */
    rwc,
  };
}

/**
 * What the page reads of one run of RW's engine (`pmrw.ts`): its state row, the day's portfolio, its closed days, every
 * fill, its first stored minute and the rows of the last minute it decided. The state is read first: the engine saves
 * it after the fills and day rows it counts, so every read after it holds all of those, and `rwSummary` leaves out
 * anything a later run wrote.
 */
async function readRwRun(d: Db, inst: RwInstance, dayStartMs: number) {
  const T = inst.tables;
  const st = await d.select<RwStateRow>(T.state, "id=eq.1&select=state,last_minute,last_error,updated_at");
  const [selection, days, fills, first] = await Promise.all([
    d.select<RwSelRow>(T.selection, `day=eq.${new Date(dayStartMs).toISOString().slice(0, 10)}&select=day,cond,rank,rate,v,min_size,capital,q,cat,end_date&order=rank.asc`),
    d.select<RwDayRow>(T.days, "select=day,total,stress_total,reward,fills,capital,markets,detail&order=day.asc"),
    d.selectAll<RwFillRow>(T.fills, "select=cond,minute,ts,side,price,size,print_id&order=cond.asc,minute.asc,print_id.asc"),
    d.select<{ minute: string }>(T.minutes, "select=minute&order=minute.asc&limit=1"),
  ]);
  const last = st[0]?.last_minute;
  const latest = last ? await d.select<RwMinuteRow>(T.minutes, `minute=eq.${encodeURIComponent(last)}&select=cond,minute,b,a,m,ours,others,qb,qa`) : [];
  return { st, selection, days, fills, first, latest };
}

/**
 * How many newest orders the detail's "Load full history" asks for. `ordersMore`
 * on the chart is whether any of them, on this pair, is missing from the window
 * the table already shows. The page's `FULL_HISTORY_LIMIT` is the same number.
 */
export const FULL_HISTORY_LIMIT = 300;

/**
 * True when the log's newest orders include one on this pair that the chart
 * window did not return, so loading them would add a row to the table.
 */
export function ordersBeyondChart(shownIds: readonly number[], preview: readonly { id: number; symbol: string }[], symbol: string): boolean {
  const shown = new Set(shownIds.map((id) => Number(id)));
  return preview.some((o) => o.symbol === symbol && !shown.has(Number(o.id)));
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
  const [candles, orders, decisions, observations, preview] = await Promise.all([
    d.select<{ start: string; open: number; high: number; low: number; close: number; volume: number }>("agent_candles",
      `venue=eq.${s.signal_venue}&symbol=eq.${sym}&interval_min=eq.${intervalMin}&start=gte.${since}&select=start,open,high,low,close,volume&order=start.asc&limit=2000`),
    d.select<OrderRow & { cancelled_at: string | null }>("agent_orders", `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&ts=gte.${since}&select=*&order=ts.asc&limit=500`),
    d.select<{ id: number; ts: string; bar_start: string; final_action: string; rule_action: string; final_reason: string; provider: string; risk_allowed: boolean; numbers: Record<string, unknown> }>("agent_decisions",
      `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&ts=gte.${since}&select=id,ts,bar_start,final_action,rule_action,final_reason,provider,risk_allowed,numbers&order=ts.asc&limit=500`),
    d.select<ObservationRow>("agent_observations", latestObservationQuery(strategyId, symbol)),
    // The same newest rows the history button fetches, so the button is shown only when one of them would add a line.
    d.select<{ id: number; symbol: string }>("agent_orders",
      `strategy_id=eq.${encodeURIComponent(strategyId)}&select=id,symbol&order=ts.desc&limit=${FULL_HISTORY_LIMIT}`),
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
    ordersMore: ordersBeyondChart(orders.map((o) => o.id), preview, symbol),
    historyLimit: FULL_HISTORY_LIMIT,
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

/** The YouTube Data API key (`youtube.ts`), under any spelling the secrets store kept; empty when it is not set. */
export function youtubeKey(read?: (n: string) => string | undefined): string {
  return envAny(["YOUTUBE_API_KEY", "YouTube_API_KEY", "Youtube_API_KEY", "youtube_api_key"], read);
}

/** The probe's parts, each a credential of its own. `?only=binance,deribit` runs just those; anything unknown is dropped. */
export const PROBE_PARTS = ["revx", "revx2", "kraken", "jev", "binance", "deribit", "polymarket", "youtube"] as const;
export function probeParts(only: string | null): Set<string> | null {
  if (!only) return null;
  const picked = new Set(only.split(",").map((x) => x.trim().toLowerCase()).filter((x) => (PROBE_PARTS as readonly string[]).includes(x)));
  return picked.size ? picked : null;
}


/**
 * One Revolut X account, read-only: its balances, the config of the pairs it would trade, a signed call WITH a query,
 * the book those pairs quote on and the order fields the settlement path reads. Nothing here can place an order.
 */
async function probeRevxAccount(rx: { env: RevxEnv; keyForm: string }, symbols: string[], querySymbol: string, f: typeof fetch): Promise<Record<string, unknown>> {
  const r: Record<string, unknown> = { keyForm: rx.keyForm };
  const b = await balances(rx.env, f);
  r.balances = b.ok
    ? { status: b.status, rows: b.data }
    : { status: b.status, error: b.error };
  const p = await pairs(rx.env, f);
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
  const c = await candles(rx.env, querySymbol, 240, now - 5 * 240 * 60_000, now, f);
  r.candlesWithQuery = c.ok
    ? { status: c.status, count: c.data?.data?.length ?? 0, last: c.data?.data?.at(-1) ?? null }
    : { status: c.status, error: c.error };
  // The book this account trades on: the region every market-data call names, and what the filtered tickers say
  // (row count per symbol must be one — two rows would mean the filter is not being honoured, reference §2.2).
  const t = await publicTickers(symbols, f);
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
  const ao = await activeOrders(rx.env, f);
  r.activeOrders = ao.ok
    ? { status: ao.status, count: ao.data?.data?.length ?? 0, fields: Object.keys(ao.data?.data?.[0] ?? {}), clientReads: { documented: ["id", "status", "filled_quantity", "average_fill_price", "total_fee", "fee_currency", "client_order_id"], assumed: ["venue_order_id", "state", "filled_size", "fees"] } }
    : { status: ao.status, error: ao.error };
  // The history a lost reply is reconciled from (`findOrder`): its field names, on the book the account trades. A week back,
  // the longest window the venue serves in one call.
  const ho = await historicalOrders(rx.env, querySymbol, now - 7 * ONE_D + 60e3, now, "", f);
  r.historicalOrders = ho.ok
    ? { status: ho.status, symbol: querySymbol, count: ho.data?.data?.length ?? 0, fields: Object.keys(ho.data?.data?.[0] ?? {}) }
    : { status: ho.status, error: ho.error };
  return r;
}

export async function runProbe(only: Set<string> | null = null, f: typeof fetch = fetch, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<Record<string, unknown>> {
  const want = (part: string) => !only || only.has(part);
  const out: Record<string, unknown> = { at: new Date().toISOString(), parts: only ? [...only] : [...PROBE_PARTS] };
  // Every symbol an active row trades — AVAX and SUI joined by migration after the probe was written, and a pair the venue
  // has no config for would only show up as "no pair config" after a bar had been claimed.
  let symbols: string[] = [...SYMBOLS];
  try { symbols = probeSymbols(await db().select<{ symbols: unknown }>("agent_strategies", "mode=in.(paper,live)&retired_at=is.null&select=symbols")); }
  catch (e) { out.symbolsNote = `strategy rows unreadable (${e instanceof Error ? e.message : String(e)}); probing the three majors`; }
  out.symbols = symbols;

  // --- Revolut X: the strategy rows' account, and PR5's own ------------------
  const rx = want("revx") ? await loadRevx("revx") : null;
  if (rx) out.revx = "error" in rx ? { error: rx.error } : await probeRevxAccount(rx, symbols, "BTC/USD", f);
  const rx2 = want("revx2") ? await loadRevx("revx2") : null;
  if (rx2) out.revx2 = "error" in rx2 ? { error: rx2.error } : await probeRevxAccount(rx2, [...REVX2_PROBE_SYMBOLS], "USDC/GBP", f);

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

  // --- Polymarket: read-only until phase 2 (reference §2d). The report is scrubbed of every secret it could echo. ----
  if (want("polymarket")) out.polymarket = await polymarketProbe(loadPolymarketEnv(), { fetchImpl: f });

  // --- YouTube: public view counts behind Polymarket's view markets (youtube.ts). The key rides in a header, never a URL.
  if (want("youtube")) {
    const key = youtubeKey();
    out.youtube = key ? await youtubeProbe({ key, fetchImpl: f }, { sleep: opts.sleep }) : { error: "YOUTUBE_API_KEY is not set" };
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

export type ServeDeps = {
  authorise: (req: Request) => Promise<Who>;
  /** A cron call's beat (`_shared/beats.ts`): read by `edge-watchdog`, which runs a call again when it has none. */
  beat: (key: string) => Promise<unknown>;
  route: (req: Request, who: Exclude<Who, null>, url: URL, action: string) => Promise<Response>;
  report?: (kind: string, o: { message?: string; context?: unknown }) => Promise<void>;
};

/**
 * One request's way through the function: the caller, then a cron call's beat, then its action. A cron call writes its
 * beat before any of its work, so a call that started is told apart from one whose worker the platform never started
 * (0075); a beat that cannot be written stops nothing. Exported with its parts injectable so that order is pinned.
 */
export async function serveRequest(req: Request, deps: ServeDeps): Promise<Response> {
  let action = "";
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const who = await deps.authorise(req);
    if (!who) return json(401, { error: "unauthorised" });
    const url = new URL(req.url);
    action = url.searchParams.get("action") ?? "";
    if (who === "cron") await deps.beat(beatKeyOfRequest("agents", req.url)).catch(() => false);
    return await deps.route(req, who, url, action);
  } catch (e) {
    const report = crashReport(action, e);
    await (deps.report ?? reportServerError)("agents.crash", report);
    return json(500, { error: "agents crashed", message: report.message.slice(0, 200) });
  }
}

/** The actions, by `?action=`: what each one is, and who may call it, is in this file's header. */
async function route(req: Request, who: Exclude<Who, null>, url: URL, action: string): Promise<Response> {
  const operator = who === "cron" || who === "admin";
  if (action === "tick" && req.method === "POST" && operator) return json(200, await runTick());
  if (action === "quotes" && req.method === "POST" && operator) return json(200, await runQuotesAction(url.searchParams.get("wait") !== "0"));
  // "Stablecoin quotes variant-1" (quotes_variant.ts, 0071): PR5's stored minutes through the variant's rule. Database only.
  if (action === "quotesv" && req.method === "POST" && operator) return json(200, await runQuotesVariant({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  // "Stablecoin quotes variant-2" (quotes_ruled.ts, 0072): rule D on variant-1's rate, its own tables. Database only.
  if (action === "quotesd" && req.method === "POST" && operator) return json(200, await runQuotesRuled({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  // RW's paper test (pmrw.ts, 0053): keyless public reads of Polymarket only, from its own cron jobs.
  if (action === "pmrw" && req.method === "POST" && operator) return json(200, await runPmrw({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  if (action === "pmrw-select" && req.method === "POST" && operator) return json(200, await runPmrwSelect({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  if (action === "pmrw-e" && req.method === "POST" && operator) return json(200, await runPmrwE({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  if (action === "pmrw-x" && req.method === "POST" && operator) return json(200, await runPmrwX({ db: db(), now: Date.now(), holder: crypto.randomUUID() }));
  // RW-C (0069): the same engine and replays on RW-C's instance and tables; before its warm-up each returns at once.
  if (action === "pmrwc" && req.method === "POST" && operator) return json(200, await runPmrw({ db: db(), now: Date.now(), holder: crypto.randomUUID(), inst: RWC_INSTANCE }));
  if (action === "pmrwc-select" && req.method === "POST" && operator) return json(200, await runPmrwSelect({ db: db(), now: Date.now(), holder: crypto.randomUUID(), inst: RWC_INSTANCE }));
  if (action === "pmrwc-e" && req.method === "POST" && operator) return json(200, await runPmrwE({ db: db(), now: Date.now(), holder: crypto.randomUUID(), replay: RWCE_REPLAY }));
  if (action === "pmrwc-x" && req.method === "POST" && operator) return json(200, await runPmrwX({ db: db(), now: Date.now(), holder: crypto.randomUUID(), replay: RWCX_REPLAY }));
  // RW-E's variants (pmrw_x.ts): their arms over RW's days before RW-E's twelve, never past them. Reads only.
  if (action === "pmrw-x-research" && req.method === "POST" && operator) {
    const body = await req.json().catch(() => null);
    const until = typeof body?.until === "string" ? Date.parse(body.until) : NaN;
    return json(200, await researchRwx(db(), parseRwxSpecs(body), Number.isFinite(until) ? until : undefined));
  }
  if (action === "books" && req.method === "POST" && operator) return json(200, await runBooksAction(url.searchParams.get("wait") !== "0"));
  // Polymarket's order path (pm_live.ts, 0074): its dry-run, called from eu-west-1 by the one-minute job. Cron bearer only.
  if (action === "pmlive" && req.method === "POST" && who === "cron") return json(200, await runPmLiveAction());
  // The view-count recorder (views.ts, 0062): Polymarket's view markets and the YouTube counters they resolve on. Reads only.
  if (action === "views" && req.method === "POST" && operator) {
    const key = youtubeKey();
    return json(200, await runViews({ db: db(), holder: crypto.randomUUID(), yt: key ? { key } : null }));
  }
  if (action === "quotes-convert" && req.method === "POST" && operator) return json(200, await runQuotesConvert(await quotesLiveDeps(), await req.json().catch(() => null)));
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
}

if (import.meta.main) Deno.serve((req: Request) => serveRequest(req, {
  authorise: (r) => authorise(r, Deno.env.get("CRON_SECRET") ?? ""),
  beat: (key) => writeBeat(key),
  route,
}));
