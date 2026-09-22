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
import { askJev, type Questions } from "../_shared/jev.ts";
import { activeOrders, balances, candles, loadPrivateKey, pairs, publicTickers, REVX_REGION, revxVenue, type RevxEnv } from "../_shared/revx.ts";
import {
  addOrder, balance as krakenBalance, balanceEx, cancelOrder as krakenCancel, closedOrders, krakenNonce, krakenVenue, ohlc, openOrders,
  krakenSupports, ticker as krakenTicker, tradeVolume, type KrakenEnv,
} from "../_shared/kraken.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { positionFromFills, unrealisedUsd, type Position } from "../_shared/agents_strategy.ts";
import type { Venue, VenueId } from "../_shared/venue.ts";
import { makeDb, type Db } from "./db.ts";
import { dayPnl, decisionBarMs, stateBarMs, tick, toFill, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

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

/** Both venues, each with credentials when the store has them and keyless market data when it does not. */
async function loadVenues(): Promise<{ venues: Record<VenueId, Venue>; notes: Record<VenueId, string | null> }> {
  const rx = await loadRevx();
  const kk = loadKraken();
  const revx = revxVenue("error" in rx ? null : rx.env);
  const kraken = krakenVenue("error" in kk ? null : kk.env);
  if (!("error" in kk)) {                                 // the account's own tier, not the published table
    if (feeTier && Date.now() - feeTier.at < FEE_TIER_TTL_MS) Object.assign(kraken.feeBps, feeTier.feeBps);
    else { await kraken.refreshFees(); feeTier = { at: Date.now(), feeBps: { ...kraken.feeBps } }; }
  }
  return {
    venues: { revx, kraken },
    notes: { revx: "error" in rx ? rx.error : null, kraken: "error" in kk ? kk.error : null },
  };
}

function db(): Db {
  return makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

// ------------------------------------------------------------------- tick

export async function runTick(now = Date.now()) {
  const { venues, notes } = await loadVenues();
  const report = await tick({ db: db(), venues, jev: jevEnv(), now, uuid: () => crypto.randomUUID() });
  if (report.errors.length) await reportServerError("agents.tick", { message: report.errors.join(" | ").slice(0, 500), context: { at: report.at } });
  return { ...report, venues: { revx: { canTrade: venues.revx.canTrade, note: notes.revx }, kraken: { canTrade: venues.kraken.canTrade, note: notes.kraken, feeBps: venues.kraken.feeBps } } };
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

/**
 * Everything the Agents page shows, computed here and nowhere else:
 * positions and P&L come from `positionFromFills` over the filled orders,
 * marked at each venue's current mid. Money is USD throughout.
 */
type ObservationRow = { strategy_id: string; symbol: string; ts: string; bar_start: string; state: Record<string, unknown>; numbers: Record<string, unknown> };

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
    d.selectAll<OrderRow>("agent_orders", "state=in.(filled,partially_filled)&select=*&order=ts.asc"),   // the filled part of a working order is a position too; paged — PostgREST stops at 1,000 rows without a word
    d.select<OrderRow & { request: unknown }>("agent_orders", "state=in.(pending,new,partially_filled)&select=*&order=ts.desc"),
    d.select<{ id: number; strategy_id: string; venue: VenueId; state: string }>("agent_orders", `ts=gte.${dayStart}&select=id,strategy_id,venue,state`),
    // The maker probes (`0042`), summarised below. Read whole: they are a few rows a day and the
    // adverse-selection median needs all of them, not a window.
    d.selectAll<ProbeSummaryRow>("agent_maker_probes", "select=venue,symbol,side,state,maker_price,taker_price,minutes_to_fill,follow_up&order=ts.asc").catch(() => [] as ProbeSummaryRow[]),
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
  const dayOpenBy: Record<string, Record<string, number>> = {};
  for (const c of await d.select<{ venue: string; symbol: string; open: number; start: string }>("agent_candles", `interval_min=eq.1440&start=eq.${new Date(dayStartMs).toISOString()}&select=venue,symbol,open,start`)) {
    (dayOpenBy[c.venue] ??= {})[c.symbol] = Number(c.open);
  }
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
  const venueErrors: Record<string, string | null> = { revx: notes.revx, kraken: notes.kraken };
  for (const [vid, syms] of symbolsByVenue) {
    try {
      const q = await venues[vid].quotes([...syms]);
      marks[vid] = Object.fromEntries(Object.entries(q).map(([s, x]) => [s, (x.bid + x.ask) / 2]));
    } catch (e) { venueErrors[vid] = `quotes: ${e instanceof Error ? e.message : String(e)}`; marks[vid] = {}; }
  }
  const balancesByVenue: Record<string, Record<string, number> | null> = {};
  for (const vid of ["revx", "kraken"] as VenueId[]) {
    try { balancesByVenue[vid] = venues[vid].canTrade ? await venues[vid].balances() : null; }
    catch (e) { balancesByVenue[vid] = null; venueErrors[vid] = `balances: ${e instanceof Error ? e.message : String(e)}`; }
  }

  // Positions per strategy × symbol, from fills — the one implementation.
  const byKey = new Map<string, OrderRow[]>();
  for (const o of filled) { const k = `${o.strategy_id}|${o.symbol}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(o); }
  const totals = { costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0 };
  const byMode: Record<string, typeof totals> = { paper: { ...totals }, live: { ...totals } };
  // Which retired rows are still on the page: only the ones still holding something. Decided BEFORE
  // the map, so a retired row that is already flat contributes nothing to `totals` or `byMode` —
  // the page's aggregates keep the meaning they had when a retired row simply disappeared (`0038`).
  const stillHolds = (s: { id: string; symbols: string[] }) =>
    s.symbols.some((sym) => positionFromFills((byKey.get(`${s.id}|${sym}`) ?? []).map(toFill)).base > 0);
  const shown = strategies.filter((s) => !s.retired_at || stillHolds(s));
  const out = shown.map((s) => {
    const positions = s.symbols.map((sym) => {
      const rows = byKey.get(`${s.id}|${sym}`) ?? [];
      const pos: Position = positionFromFills(rows.map(toFill));
      const mark = marks[s.venue]?.[sym] ?? pos.avgCost;
      const obs = latestObs.get(`${s.id}|${sym}`) ?? null;
      return {
        symbol: sym, base: pos.base, avgCost: pos.avgCost, mark,
        costUsd: pos.base * pos.avgCost, valueUsd: pos.base * mark, unrealisedUsd: unrealisedUsd(pos, mark),
        realisedUsd: pos.realisedUsd, feesUsd: pos.feesUsd, openedAt: pos.openedAt, highWater: pos.highWater, fills: rows.length,
        observation: obs ? { ts: obs.ts, barStart: obs.bar_start, state: obs.state, numbers: obs.numbers } : null,
      };
    });
    const sum = (k: "costUsd" | "valueUsd" | "unrealisedUsd" | "realisedUsd" | "feesUsd") => positions.reduce((a, p) => a + p[k], 0);
    // Today: realised since 00:00 UTC plus the change in unrealised from the day's open — the tick's own `dayPnl`, per strategy.
    const mine0 = filled.filter((o) => o.strategy_id === s.id);
    const todayUsd = dayPnl(mine0, marks[s.venue] ?? {}, dayOpenBy[s.signal_venue] ?? {}, dayStartMs);
    const agg = { costUsd: sum("costUsd"), valueUsd: sum("valueUsd"), unrealisedUsd: sum("unrealisedUsd"), realisedUsd: sum("realisedUsd"), feesUsd: sum("feesUsd"), todayUsd };
    for (const k of Object.keys(agg) as (keyof typeof agg)[]) {
      totals[k] += agg[k];
      const m = s.mode === "live" ? "live" : "paper";
      byMode[m][k] += agg[k];
    }
    const mine = (r: { strategy_id: string }) => r.strategy_id === s.id;
    const last = recentDecisions.find(mine) ?? null;
    const barMs = decisionBarMs(s.kind);
    return {
      id: s.id, kind: s.kind, venue: s.venue, signalVenue: s.signal_venue, name: s.name, description: s.description, symbols: s.symbols, mode: s.mode,
      capitalUsd: Number(s.capital_usd), params: s.params, updatedAt: s.updated_at,
      retiredAt: s.retired_at ?? null,
      // A retired row still holding something: its exits run, it can never buy, and it is on the
      // page precisely so the position is visible until it is gone (tick.ts, `windingDown`).
      windingDown: !!s.retired_at && positions.some((p) => p.base > 0),
      nextDecisionAt: new Date(Math.floor(now / barMs) * barMs + barMs).toISOString(),   // the next bar close
      ...agg, positions,
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

  return {
    at: new Date(now).toISOString(),
    dayStart: new Date(dayStartMs).toISOString(),
    risk: riskRows[0] ?? null,
    totals: { ...totals, byMode },
    byVenue,
    basis: basisBySymbol,
    venues: (["revx", "kraken"] as VenueId[]).map((vid) => ({
      id: vid, canTrade: venues[vid].canTrade, feeBps: venues[vid].feeBps, balances: balancesByVenue[vid], note: venueErrors[vid], marks: marks[vid] ?? {},
    })),
    strategies: out,
    openOrders: open,
    /** The adverse-selection notebook (`0042`, reference §3.13): is 0 % maker actually free here? */
    makerProbes: probeSummary(probeRows),
    jev24h: jevStats(decisions24h),
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
  const allFilled = await d.select<OrderRow>("agent_orders", `strategy_id=eq.${encodeURIComponent(strategyId)}&symbol=eq.${sym}&state=in.(filled,partially_filled)&select=*&order=ts.asc`);
  const pos = positionFromFills(allFilled.map(toFill));
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
    position: { base: pos.base, avgCost: pos.avgCost, realisedUsd: pos.realisedUsd, feesUsd: pos.feesUsd, openedAt: pos.openedAt },
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
export async function runProbe(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  // Every symbol an active row trades — AVAX and SUI joined by migration after the probe was written, and a pair the venue
  // has no config for would only show up as "no pair config" after a bar had been claimed.
  let symbols: string[] = [...SYMBOLS];
  try { symbols = probeSymbols(await db().select<{ symbols: unknown }>("agent_strategies", "mode=in.(paper,live)&retired_at=is.null&select=symbols")); }
  catch (e) { out.symbolsNote = `strategy rows unreadable (${e instanceof Error ? e.message : String(e)}); probing the three majors`; }
  out.symbols = symbols;

  // --- Revolut X -----------------------------------------------------------
  const rx = await loadRevx();
  if ("error" in rx) {
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
      ? { status: ao.status, count: ao.data?.data?.length ?? 0, fields: Object.keys(ao.data?.data?.[0] ?? {}), clientReads: ["filled_size", "average_fill_price", "fees", "state", "client_order_id", "venue_order_id"] }
      : { status: ao.status, error: ao.error };
    out.revx = r;
  }

  // --- Kraken ----------------------------------------------------------------
  const kk = loadKraken();
  if ("error" in kk) {
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
  const { openrouterKey, typesafeKey } = jevEnv();
  const jev: Record<string, unknown> = { openrouterKey: !!openrouterKey, typesafeKey: !!typesafeKey };
  if (openrouterKey) jev.openrouter = await askJev(state, questions, { openrouterKey });
  if (typesafeKey) jev.typesafe = await askJev(state, questions, { typesafeKey });
  out.jev = jev;
  return out;
}

// ------------------------------------------------------------------ serve

if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const who = await authorise(req, Deno.env.get("CRON_SECRET") ?? "");
    if (!who) return json(401, { error: "unauthorised" });
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const operator = who === "cron" || who === "admin";
    if (action === "tick" && req.method === "POST" && operator) return json(200, await runTick());
    if (action === "probe" && req.method === "GET" && operator) return json(200, await runProbe());
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
    const message = e instanceof Error ? e.message : String(e);
    await reportServerError("agents.crash", { message });
    return json(500, { error: "agents crashed", message: message.slice(0, 200) });
  }
});
