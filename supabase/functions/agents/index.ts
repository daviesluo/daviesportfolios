// Supabase Edge Function: agents
//
// The server half of the Agents feature: strategies that trade crypto on
// two venue accounts — a Revolut X sub-account and a Kraken account — with
// TypeSafe's Jev as a decision node inside a deterministic rulebook. Read
// docs/agents/reference.md before changing anything here; every rule in
// CLAUDE.md's Agents section is a consequence of what is measured there.
//
//   POST ?action=tick       — one turn of the loop (tick.ts). pg_cron every
//                             five minutes (migration 0037). Cron or admin.
//   GET  ?action=dashboard  — everything the Agents page shows: strategies
//                             with positions and P&L derived from fills,
//                             the caps, venue health, Jev spend, recent
//                             decisions and orders. Admin or read-only.
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
import { balances, candles, loadPrivateKey, pairs, revxVenue, type RevxEnv } from "../_shared/revx.ts";
import {
  addOrder, balance as krakenBalance, balanceEx, cancelOrder as krakenCancel, krakenVenue, makeNonce, ohlc, openOrders,
  ticker as krakenTicker, tradeVolume, type KrakenEnv,
} from "../_shared/kraken.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { positionFromFills, unrealisedUsd, type Position } from "../_shared/agents_strategy.ts";
import type { Venue, VenueId } from "../_shared/venue.ts";
import { makeDb, type Db } from "./db.ts";
import { tick, toFill, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

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
const ONE_D = 86400e3;

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
  return { env: { apiKey, secret, nonce: makeNonce() }, secretBytes };
}

function jevEnv() {
  return {
    openrouterKey: envAny(["OPENROUTER_API_KEY", "openrouter_api_key"]) || undefined,
    typesafeKey: envAny(["TYPESAFE_API_KEY", "typesafe_API_KEY", "typesafe_api_key"]) || undefined,
  };
}

/** Both venues, each with credentials when the store has them and keyless market data when it does not. */
async function loadVenues(): Promise<{ venues: Record<VenueId, Venue>; notes: Record<VenueId, string | null> }> {
  const rx = await loadRevx();
  const kk = loadKraken();
  const revx = revxVenue("error" in rx ? null : rx.env);
  const kraken = krakenVenue("error" in kk ? null : kk.env);
  if (!("error" in kk)) await kraken.refreshFees();     // the account's own tier, not the published table
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

function jevStats(rows: { provider: string; cost_usd: number | null; latency_ms: number | null }[]) {
  const providers: Record<string, number> = {};
  let cost = 0, lat = 0, n = 0;
  for (const r of rows) {
    providers[r.provider] = (providers[r.provider] ?? 0) + 1;
    cost += Number(r.cost_usd ?? 0);
    if (r.latency_ms) { lat += Number(r.latency_ms); n++; }
  }
  return { calls: rows.length, costUsd: cost, avgLatencyMs: n ? Math.round(lat / n) : null, providers };
}

/**
 * Everything the Agents page shows, computed here and nowhere else:
 * positions and P&L come from `positionFromFills` over the filled orders,
 * marked at each venue's current mid. Money is USD throughout.
 */
export async function runDashboard(now = Date.now()) {
  const d = db();
  const dayStart = new Date(Math.floor(now / ONE_D) * ONE_D).toISOString();
  const since24h = new Date(now - ONE_D).toISOString();
  const [strategies, riskRows, filled, open, today, decisions24h, recentDecisions, recentOrders, backtests, { venues, notes }] = await Promise.all([
    d.select<StrategyRow & { description: string; updated_at: string }>("agent_strategies", "select=*&order=id.asc"),
    d.select<RiskRow & { updated_at: string }>("agent_risk", "id=eq.1&select=*"),
    d.select<OrderRow>("agent_orders", "state=eq.filled&select=*&order=ts.asc"),
    d.select<OrderRow & { request: unknown }>("agent_orders", "state=in.(new,partially_filled)&select=*&order=ts.desc"),
    d.select<{ id: number; strategy_id: string; venue: VenueId; state: string }>("agent_orders", `ts=gte.${dayStart}&select=id,strategy_id,venue,state`),
    d.select<{ strategy_id: string; provider: string; cost_usd: number | null; latency_ms: number | null }>("agent_decisions", `ts=gte.${since24h}&select=strategy_id,provider,cost_usd,latency_ms`),
    d.select<DecisionRow>("agent_decisions", "select=id,ts,strategy_id,venue,symbol,mode,state,numbers,answers,provider,model,latency_ms,cost_usd,rule_action,rule_reason,final_action,final_reason,risk_allowed,risk_reason&order=ts.desc&limit=120"),
    d.select<OrderRow & { request: unknown; response: unknown; cancelled_at: string | null; decision_id: number | null }>("agent_orders", "select=*&order=ts.desc&limit=120"),
    d.select<{ id: string; strategy_id: string; ran_at: string; method: string; summary: unknown }>("agent_backtests", "select=id,strategy_id,ran_at,method,summary&order=ran_at.desc"),
    loadVenues(),
  ]);

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
  const totals = { costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0 };
  const byMode: Record<string, typeof totals> = { paper: { ...totals }, live: { ...totals } };
  const out = strategies.map((s) => {
    const positions = s.symbols.map((sym) => {
      const rows = byKey.get(`${s.id}|${sym}`) ?? [];
      const pos: Position = positionFromFills(rows.map(toFill));
      const mark = marks[s.venue]?.[sym] ?? pos.avgCost;
      return {
        symbol: sym, base: pos.base, avgCost: pos.avgCost, mark,
        costUsd: pos.base * pos.avgCost, valueUsd: pos.base * mark, unrealisedUsd: unrealisedUsd(pos, mark),
        realisedUsd: pos.realisedUsd, feesUsd: pos.feesUsd, openedAt: pos.openedAt, highWater: pos.highWater, fills: rows.length,
      };
    });
    const sum = (k: "costUsd" | "valueUsd" | "unrealisedUsd" | "realisedUsd" | "feesUsd") => positions.reduce((a, p) => a + p[k], 0);
    const agg = { costUsd: sum("costUsd"), valueUsd: sum("valueUsd"), unrealisedUsd: sum("unrealisedUsd"), realisedUsd: sum("realisedUsd"), feesUsd: sum("feesUsd") };
    for (const k of Object.keys(agg) as (keyof typeof agg)[]) {
      totals[k] += agg[k];
      const m = s.mode === "live" ? "live" : "paper";
      byMode[m][k] += agg[k];
    }
    const mine = (r: { strategy_id: string }) => r.strategy_id === s.id;
    const last = recentDecisions.find(mine) ?? null;
    return {
      id: s.id, kind: s.kind, venue: s.venue, name: s.name, description: s.description, symbols: s.symbols, mode: s.mode,
      capitalUsd: Number(s.capital_usd), params: s.params, updatedAt: s.updated_at,
      ...agg, positions,
      openOrders: open.filter(mine).length, ordersToday: today.filter(mine).length,
      jev24h: jevStats(decisions24h.filter(mine)),
      lastDecision: last ? { ts: last.ts, symbol: last.symbol, action: last.final_action, ruleAction: last.rule_action, reason: last.final_reason, provider: last.provider, riskAllowed: last.risk_allowed, riskReason: last.risk_reason } : null,
      backtest: backtests.find(mine) ?? null,
      recentDecisions: recentDecisions.filter(mine).slice(0, 30),
      recentOrders: recentOrders.filter(mine).slice(0, 30),
    };
  });

  return {
    at: new Date(now).toISOString(),
    risk: riskRows[0] ?? null,
    totals: { ...totals, byMode },
    venues: (["revx", "kraken"] as VenueId[]).map((vid) => ({
      id: vid, canTrade: venues[vid].canTrade, feeBps: venues[vid].feeBps, balances: balancesByVenue[vid], note: venueErrors[vid], marks: marks[vid] ?? {},
    })),
    strategies: out,
    openOrders: open,
    jev24h: jevStats(decisions24h),
  };
}

export async function runLog(strategyId: string, limit: number) {
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
      for (const s of SYMBOLS) cfg[s] = p.data?.[s] ?? null;
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
    const tv = await tradeVolume(kk.env, [...SYMBOLS]);
    k.tradeVolume = tv.ok
      ? { status: tv.status, currency: tv.data?.currency, volume: tv.data?.volume, fees: tv.data?.fees, fees_maker: tv.data?.fees_maker }
      : { status: tv.status, error: tv.error };
    const oo = await openOrders(kk.env);
    k.openOrders = oo.ok ? { status: oo.status, count: Object.keys(oo.data?.open ?? {}).length } : { status: oo.status, error: oo.error };
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
    const tk = await krakenTicker([...SYMBOLS]);
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
