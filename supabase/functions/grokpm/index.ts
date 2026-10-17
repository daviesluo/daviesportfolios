// Supabase Edge Function: grokpm
//
// GROKPM's server (pre-registered in docs/agents/reviews/2026-10-15-grokpm-prereg.md, whose Appendix A is the contract):
// the outside Grok agent's journal, and since Deviation D2 (2026-10-16, Davies: "让grok用我们搭好的爱尔兰服务器下单，不是网页端")
// its only way to trade. The agent never holds a key: it asks this function, which checks each request against the
// frozen rules and the agent's own book, journals it, and (armed) signs and sends the order on the project's Polymarket
// account from eu-west-1 (`exec.ts`). What the account actually did is recorded apart, keylessly, by
// `agents?action=grokpmrec` (agents/grokpm_rec.ts), and the page's money is that record.
//
//   GET                  a ping: the server's time, its region, what is left of the hour's requests.
//   POST                 the journal: up to three lists, `decisions`, `cycles`, `daily` (`ingest.ts`).
//   GET  ?action=account the agent's own budget, positions, open orders, stops and gates (`accountView`).
//   GET  ?action=market  a market by `cond` (or `token`): Gamma's record, each outcome's book and depth, and what blocks
//                        an open there.
//   POST ?action=order   one order from its journal decision (an open BUYs, a close SELLs), with `theme` and `expires_at`.
//   POST ?action=cancel  one of the agent's own open orders; ?action=cancel_all every one of them, each by its own id.
//   POST ?action=sync    the scheduler's (bearer CRON_SECRET), every minute: reads back the agent's live orders and
//                        their trades. It writes its beat first.
// Every action but the ping and the journal refuses outside eu-west-1 (call with ?forceFunctionRegion=eu-west-1).
//
// Auth: `Authorization: Bearer <GROKPM_LOG_TOKEN>`, a Supabase secret Davies creates and gives only to the agent, compared
// in constant time; `sync` takes the scheduler's CRON_SECRET instead. Without the token (or with one shorter than 32
// characters) every agent request is refused with 503. Deployed without the gateway's JWT check (the deploy workflow's
// PUBLIC_FNS): neither bearer is a Supabase JWT. No secret, key or account address is ever printed, logged or returned.
// Every free-text field is untrusted: stored as text, never executed, never read as an instruction.

import { reportServerError } from "../_shared/ops.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { constantTimeEqual } from "../_shared/token.ts";
import { POLYMARKET_GAMMA_HOST } from "../_shared/polymarket.ts";
import { loadPmLiveEnv, pmOrderCall, pmVenue, PM_ORDER_REGION } from "../_shared/polymarket_orders.ts";
import { makeDb } from "../agents/db.ts";
import { type RedeemDeps, runRedeem } from "./redeem.ts";
import { accountView, cancelOrders, context, type ExecDeps, type GrokVenue, marketView, placeOrder, syncOrders } from "./exec.ts";
import {
  GROKPM_MAX_BODY_BYTES, GROKPM_MAX_ERRORS, GROKPM_MAX_REQUESTS_PER_HOUR, GROKPM_MAX_ROWS_PER_HOUR, isAuthorised, rateVerdict, type RequestRow, tableRows, validateBatch,
} from "./ingest.ts";

export type IngestDb = {
  /** The last hour's authenticated requests. */
  recentRequests: (sinceIso: string) => Promise<RequestRow[]>;
  /** Insert rows, a stored id ignored; returns how many were new. */
  insertIgnore: (table: string, rows: unknown[]) => Promise<number>;
  logRequest: (row: { status: number; rows: number; error: string | null }) => Promise<void>;
};

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/** PostgREST over fetch with the service role, for this function's four tables only. */
export function makeIngestDb(url: string, key: string, fetchImpl: typeof fetch = fetch): IngestDb {
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const ok = async (r: Response, what: string) => { if (!r.ok) throw new Error(`${what} → ${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
  return {
    async recentRequests(sinceIso) {
      const r = await ok(await fetchImpl(`${url}/rest/v1/grokpm_requests?at=gt.${encodeURIComponent(sinceIso)}&select=at,status,rows&order=id.asc&limit=1000`, { headers: h, signal: AbortSignal.timeout(8_000) }), "requests");
      return await r.json() as RequestRow[];
    },
    async insertIgnore(table, rows) {
      if (!rows.length) return 0;
      const r = await ok(await fetchImpl(`${url}/rest/v1/${table}?on_conflict=id&select=id`, {
        method: "POST", headers: { ...h, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rows), signal: AbortSignal.timeout(8_000),
      }), table);
      return (await r.json() as unknown[]).length;
    },
    async logRequest(row) {
      await ok(await fetchImpl(`${url}/rest/v1/grokpm_requests`, {
        method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(row), signal: AbortSignal.timeout(8_000),
      }), "log");
    },
  };
}

/**
 * One request, start to end. Exported with its parts injectable so the order is pinned: the secret first (nothing else
 * is read before it), then the hour's budget, then the body; nothing is stored unless every row passes.
 */
export type HandleDeps = {
  secret: string; db: IngestDb; now?: () => number; report?: typeof reportServerError;
  /** The runtime's region (`SB_REGION`): every action but the ping and the journal runs only in eu-west-1. */
  region?: string | null;
  /** The scheduler's bearer, for `sync` only. */
  cronSecret?: string;
  /** The order path's dependencies, built only when an action needs them (the key is loaded then, never for the journal). */
  exec?: (now: number) => Promise<ExecDeps>;
  beat?: (key: string) => Promise<unknown>;
  /** The redemption path's dependencies (Deviation D6), built only for `redeem`. */
  redeem?: (now: number) => Promise<RedeemDeps>;
};
/** The actions besides the journal, and the method each takes. */
export const ACTIONS: Record<string, "GET" | "POST"> = { account: "GET", market: "GET", order: "POST", cancel: "POST", cancel_all: "POST", sync: "POST" };

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  if (action === "sync") return await handleSync(req, deps, now());
  if (action === "redeem") return await handleRedeem(req, deps, now());
  if (!deps.secret || deps.secret.length < 32) return json(503, { error: "not configured", detail: "GROKPM_LOG_TOKEN is not set" });
  if (!(await isAuthorised(req.headers.get("authorization"), deps.secret))) return json(401, { error: "unauthorised" });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "GET, POST" });
  if (action && !(action in ACTIONS)) return json(404, { error: `unknown action '${action.slice(0, 40)}'`, actions: Object.keys(ACTIONS).filter((a) => a !== "sync") });
  if (action && req.method !== ACTIONS[action]) return json(405, { error: `${action} takes ${ACTIONS[action]}` }, { Allow: ACTIONS[action] });
  const t = now();
  const since = new Date(t - 3600e3).toISOString();
  const log = (status: number, rows: number, error: string | null) => deps.db.logRequest({ status, rows, error: error ? error.slice(0, 300) : null }).catch(() => {});
  try {
    const last = await deps.db.recentRequests(since);
    if (action) {
      if (deps.region !== PM_ORDER_REGION) {
        await log(403, 0, `region ${deps.region ?? "unknown"}`);
        return json(403, { error: "wrong region", detail: `this ran in ${deps.region ?? "an unknown region"}; call with ?forceFunctionRegion=${PM_ORDER_REGION}` });
      }
      const rate = rateVerdict(last, 0, t);
      if (rate.requests >= GROKPM_MAX_REQUESTS_PER_HOUR) {
        await log(429, 0, "rate");
        return json(429, { error: "rate limited", retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) });
      }
      if (!deps.exec) return json(503, { error: "the order path is not available" });
      const x = await deps.exec(t);
      let out: { status: number; body: unknown };
      if (action === "account") {
        const c = await context(x, { readGeo: true, sync: true });
        out = { status: 200, body: accountView(c, t) };
      } else if (action === "market") {
        const cond = url.searchParams.get("cond"), token = url.searchParams.get("token");
        out = cond && /^0x[0-9a-f]{64}$/.test(cond) ? await marketView(x, { cond }) : token && /^[0-9]{1,80}$/.test(token) ? await marketView(x, { token })
          : { status: 422, body: { error: "invalid", errors: ["cond (0x and 64 lower-case hex digits) or token (decimal) is required"] } };
      } else {
        const type = req.headers.get("content-type") ?? "";
        const text = await req.text();
        if (text.length > GROKPM_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${GROKPM_MAX_BODY_BYTES} bytes` }); }
        let body: unknown = {};
        if (text.trim()) {
          if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
          try { body = JSON.parse(text); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid JSON" }); }
        }
        out = action === "order" ? await placeOrder(x, body) : await cancelOrders(x, body, action === "cancel_all");
      }
      const o = out.body as { errors?: string[]; refusals?: Array<{ rule: string }> };
      await log(out.status, action === "order" && out.status === 200 ? 1 : 0,
        out.status === 200 ? null : `${action}: ${(o.refusals ?? []).map((r) => r.rule).join(",") || (o.errors ?? []).join("; ")}`);
      return json(out.status, out.body);
    }
    if (req.method === "GET") {
      const v = rateVerdict(last, 0, t);
      return json(200, { ok: true, now: new Date(t).toISOString(), region: deps.region ?? null, rows_left_this_hour: v.rowsLeft, requests_this_hour: v.requests });
    }
    const type = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > GROKPM_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${GROKPM_MAX_BODY_BYTES} bytes` }); }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > GROKPM_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${GROKPM_MAX_BODY_BYTES} bytes` }); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid UTF-8 JSON" }); }
    const v = validateBatch(body, t);
    // The budget before the rows: a refused row still counts as a request.
    const rate = rateVerdict(last, v.ok ? v.rows : 0, t);
    if (!rate.ok) {
      await log(429, 0, "rate");
      return json(429, { error: "rate limited", rows_left_this_hour: rate.rowsLeft, max_rows_per_hour: GROKPM_MAX_ROWS_PER_HOUR, retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) });
    }
    if (!v.ok) { await log(422, 0, v.errors.join("; ")); return json(422, { error: "invalid", errors: v.errors.slice(0, GROKPM_MAX_ERRORS) }); }
    const t2 = tableRows(v.batch, body);
    const stored = {
      decisions: await deps.db.insertIgnore("grokpm_decisions", t2.grokpm_decisions),
      cycles: await deps.db.insertIgnore("grokpm_cycles", t2.grokpm_cycles),
      daily: await deps.db.insertIgnore("grokpm_daily", t2.grokpm_daily),
    };
    const n = stored.decisions + stored.cycles + stored.daily;
    await log(200, n, null);
    return json(200, { ok: true, stored, duplicates: v.rows - n, rows_left_this_hour: Math.max(0, rate.rowsLeft - n) });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (deps.report ?? reportServerError)("grokpm.ingest", { message, context: { at: new Date(t).toISOString() } });
    await log(500, 0, message);
    return json(500, { error: "could not store; send again later" });
  }
}

/**
 * The scheduler's calls (`sync`, `redeem`): the bearer CRON_SECRET, POST, then the beat (under the call's own action), then
 * eu-west-1. A Response when the call stops there, null when it may run.
 */
async function cronGate(req: Request, deps: HandleDeps): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!deps.cronSecret || !presented || !constantTimeEqual(presented, deps.cronSecret)) return json(401, { error: "unauthorised" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "POST" });
  await (deps.beat ?? ((k: string) => writeBeat(k)))(beatKeyOfRequest("grokpm", req.url)).catch(() => false);
  if (deps.region !== PM_ORDER_REGION) return json(403, { error: "wrong region" });
  return null;
}

/**
 * The scheduler's hour (Deviation D6, migration 0128): the shared account's resolved positions redeemed (`redeem.ts`), or,
 * while `grokpm_config.redeem_enabled` is false, what would be. A fault goes to the errors box as `grokpm.redeem` when it
 * first appears and at most hourly while it lasts.
 */
async function handleRedeem(req: Request, deps: HandleDeps, t: number): Promise<Response> {
  const stop = await cronGate(req, deps);
  if (stop) return stop;
  if (!deps.redeem) return json(503, { error: "the redemption path is not available" });
  try {
    const d = await deps.redeem(t);
    const before = (await d.db.select<{ redeem_state: Record<string, unknown> | null }>("grokpm_exec_state", "id=eq.1&select=redeem_state"))[0]?.redeem_state ?? {};
    const r = await runRedeem(d);
    const key = r.errors.map((e) => e.replace(/\d+(\.\d+)?/g, "#").replace(/0x[0-9a-f…]+/gi, "0x…")).sort().join(" | ").slice(0, 400);
    const last = before.report as { key: string; at: number } | undefined;
    if (key && (!last || last.key !== key || t - last.at >= 3600e3)) {
      await (deps.report ?? reportServerError)("grokpm.redeem", { message: r.errors.join("; ").slice(0, 500) });
      const now = (await d.db.select<{ redeem_state: Record<string, unknown> | null }>("grokpm_exec_state", "id=eq.1&select=redeem_state"))[0]?.redeem_state ?? {};
      await d.db.update("grokpm_exec_state", "id=eq.1", { redeem_state: { ...now, report: { key, at: t } } });
    } else if (last) {
      const now = (await d.db.select<{ redeem_state: Record<string, unknown> | null }>("grokpm_exec_state", "id=eq.1&select=redeem_state"))[0]?.redeem_state ?? {};
      await d.db.update("grokpm_exec_state", "id=eq.1", { redeem_state: { ...now, report: last } });
    }
    return json(200, {
      ok: true, mode: r.mode, sent: r.sent, settled: r.settled, in_flight: r.inFlight, errors: r.errors.length, blocked_by: r.blockedBy,
      plan: r.plan.map((x) => ({ cond: x.cond, neg_risk: x.negRisk, size: x.size, payout_usd: x.payoutUsd })), skipped: r.skipped.length,
    });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (deps.report ?? reportServerError)("grokpm.redeem", { message });
    return json(500, { error: "redeem failed" });
  }
}

/** The scheduler's minute (bearer CRON_SECRET): its beat first, then the agent's live orders read back. */
async function handleSync(req: Request, deps: HandleDeps, t: number): Promise<Response> {
  const stop = await cronGate(req, deps);
  if (stop) return stop;
  if (!deps.exec) return json(503, { error: "the order path is not available" });
  try {
    const x = await deps.exec(t);
    const errors: string[] = [];
    const r = await syncOrders(x, errors);
    // The day's opening equity, the last good geoblock and the stops' latches are kept by the same reading every request makes.
    const c = await context(x, { readGeo: true, sync: false });
    // The kill switches reach what already rests (2026-10-17 audit): under the global pause, or once the path is disarmed
    // (0125's undo), the agent's LIVE orders are cancelled, each by its own id, rather than left resting up to 65 minutes.
    let cancelled = 0;
    if (c.gates.globalPause || c.mode === "dry_run") {
      if (c.mode === "dry_run" ? (await x.db.select<{ id: number }>("grokpm_orders", "mode=eq.live&state=in.(pending,live)&select=id&limit=1")).length : true) {
        const k = await cancelOrders(x, {}, true, true);
        cancelled = ((k.body.cancelled ?? []) as unknown[]).length;
        if (cancelled) errors.push(`${cancelled} live order(s) cancelled: ${c.gates.globalPause ? "the global pause is on" : "the path is disarmed"}`);
      }
    }
    // A fault goes to the errors box when it first appears and at most hourly while it lasts (digits do not make it new).
    const key = errors.map((e) => e.replace(/\d+(\.\d+)?/g, "#").replace(/0x[0-9a-f…]+/gi, "0x…")).sort().join(" | ").slice(0, 400);
    const st = (await x.db.select<{ state: Record<string, unknown> | null }>("grokpm_exec_state", "id=eq.1&select=state"))[0]?.state ?? {};
    const last = st.syncReport as { key: string; at: number } | undefined;
    let next: Record<string, unknown> | null = null;
    if (key && (!last || last.key !== key || t - last.at >= 3600e3)) {
      await (deps.report ?? reportServerError)("grokpm.sync", { message: errors.join("; ").slice(0, 500) });
      next = { ...st, syncReport: { key, at: t } };
    }
    // The total stop ends the test as a FAIL (the pre-registration's §3): said once, to the errors box, the moment it latches.
    if (c.totalStopAt && !st.totalStopReported) {
      await (deps.report ?? reportServerError)("grokpm.total_stop", { message: `GROKPM's total stop was reached at ${c.totalStopAt} (book ${c.ledger.totalUsd.toFixed(2)}): close-only to the end, and the test ends as a FAIL` });
      next = { ...(next ?? st), totalStopReported: t };
    }
    if (next) await x.db.update("grokpm_exec_state", "id=eq.1", { state: next });
    return json(200, { ok: true, ...r, cancelled, errors: errors.length });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (deps.report ?? reportServerError)("grokpm.sync", { message });
    return json(500, { error: "sync failed" });
  }
}

/**
 * The production order path's dependencies: the account's credentials and signing key as the order paths load them
 * (`loadPmLiveEnv`: the key is kept only when it is the stored signer's, and every message is scrubbed of them), the
 * venue over the order path's wire, Gamma by condition or token id with its tags, and the database. The account's
 * proxy wallet becomes `grokpm_config.wallet` for the keyless recorder the first time it is read; it is never returned.
 */
export async function productionExec(t: number): Promise<ExecDeps> {
  const env = loadPmLiveEnv();
  const db = makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const wire = { creds: env.creds, address: env.signer, scrub: (s: string) => env.scrub(s), timeoutMs: 6_000 };
  const base = pmVenue({ ...wire, sigType: env.sigType ?? 1 });
  const venue: GrokVenue = {
    ...base,
    gamma: (q) => {
      const qs = new URLSearchParams([["limit", "2"], ["closed", "false"], ["include_tag", "true"], q.cond ? ["condition_ids", q.cond] : ["clob_token_ids", q.token ?? ""]]);
      return pmOrderCall("GET", `${POLYMARKET_GAMMA_HOST}/markets/keyset?${qs}`, undefined, wire);
    },
  };
  if (env.funder) await db.update("grokpm_config", "id=eq.1&wallet=is.null", { wallet: env.funder.toLowerCase() }).catch(() => {});
  return {
    db, venue, now: t, region: Deno.env.get("SB_REGION") ?? null,
    signer: env.key, keyProblem: env.keyProblem ?? (env.creds ? null : "no L2 credentials"),
    account: env.funder && env.signer && env.creds ? { maker: env.funder, signer: env.signer } : null,
  };
}

/**
 * The redemption path's dependencies: the account's addresses and signing key as the order paths load them, and the
 * Relayer API key (Davies creates it at polymarket.com → Settings → API Keys → Relayer API Keys), which travels only in
 * the relayer's headers. Without both secrets the run plans and sends nothing.
 */
export async function productionRedeem(t: number): Promise<RedeemDeps> {
  const env = loadPmLiveEnv();
  const key = Deno.env.get("POLYMARKET_RELAYER_API_KEY") ?? "", address = Deno.env.get("POLYMARKET_RELAYER_API_KEY_ADDRESS") ?? "";
  return {
    db: makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""), now: t, region: Deno.env.get("SB_REGION") ?? null,
    wallet: env.funder, eoa: env.signer, signer: env.key, keyProblem: env.keyProblem ?? null,
    relayer: key.length >= 8 && /^0x[0-9a-fA-F]{40}$/.test(address) ? { key, address } : null,
  };
}

if (import.meta.main) {
  Deno.serve((req: Request) => handle(req, {
    secret: Deno.env.get("GROKPM_LOG_TOKEN") ?? "",
    db: makeIngestDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
    region: Deno.env.get("SB_REGION") ?? null, cronSecret: Deno.env.get("CRON_SECRET") ?? "", exec: productionExec, redeem: productionRedeem,
  }));
}
