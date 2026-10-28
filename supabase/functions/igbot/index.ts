// Supabase Edge Function: igbot
//
// IGBOT's server, "IG analyst (Grok)" (research: docs/agents/reviews/2026-10-29-igbot-research.md; pre-registration, a
// DRAFT: docs/agents/reviews/2026-10-29-igbot-prereg.md; the agent's prompt: docs/agents/igbot/GROK_PROMPT.md). An outside
// Grok agent trades IG spread bets through this function on IG's DEMO environment and never holds a credential: Grok
// proposes, the server enforces (`rules.ts`), as GROKPM does on Polymarket (`grokpm/`).
//
//   GET                    a ping: the server's time, whether IG is configured (missing secrets by name), the hour's budget.
//   POST                   the journal: up to three lists, `decisions` (no_action only), `cycles`, `daily` (`ingest.ts`).
//   GET  ?action=account   the mode, the gates, the budget and its room, positions and working orders at their stops, the
//                          whitelist, the next releases and their blackout windows.
//   GET  ?action=markets   every whitelisted market's quote and dealing rules, in one IG request.
//   GET  ?action=market    one market by `epic`.
//   GET  ?action=calendar  the listed releases ahead and their blackout windows (no IG read).
//   POST ?action=order     an open from its decision: `entry` market (the level is the worst fill), limit or stop (a working
//                          order with `good_till`); always a guaranteed stop and a limit.
//   POST ?action=close     close a position (`decision.deal_id`, whole or `size`).
//   POST ?action=amend     move a position's stop toward the price, or its limit.
//   POST ?action=cancel    one working order (`deal_id`); ?action=cancel_all every one.
//   POST ?action=sync      the scheduler's (bearer CRON_SECRET), every minute: its beat first, then IG's lists read back
//                          into the book, the server's own closes and cancels, a snapshot each five minutes and IG's hour
//                          bars for the reading; its IG requests are a row of `igbot_requests` (action `sync`).
//
// IG's allowance is held for the whole function: every request's IG calls are written on its `igbot_requests` row
// (`ig_calls`, 0159), and an action that could take the last minute's total over `IGBOT_IG_CALLS_PER_MINUTE` is answered
// 429 before it reads anything.
//
// Auth: `Authorization: Bearer <IGBOT_TOKEN>` (a Supabase secret Davies creates and gives only to the agent; 32 characters
// or more, compared in constant time); `sync` takes the scheduler's CRON_SECRET. Deployed without the gateway's JWT check
// (the deploy workflow's PUBLIC_FNS): neither bearer is a Supabase JWT. IG's demo credentials are four secrets
// (`client.ts`, IGBOT_SECRET_NAMES); none is ever printed, logged or returned, and every free-text field the agent sends is
// untrusted data, stored as text and never read as an instruction.

import { reportServerError } from "../_shared/ops.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { constantTimeEqual } from "../_shared/token.ts";
import { igErrorCode } from "../ig/client.ts";
import { type Db, makeDb } from "../agents/db.ts";
import { IGBOT_ENVIRONMENT, type IgbotAnswer, IgbotClient, igbotCreds } from "./client.ts";
import {
  accountView, amendPosition, cancelOrders, closePosition, context, type ExecDeps, type IgApi, type IgSend, marketOf, marketOut, placeOrder, syncAll,
} from "./exec.ts";
import {
  IGBOT_ACTION_IG_COST, IGBOT_IG_CALLS_PER_MINUTE, IGBOT_MAX_BODY_BYTES, IGBOT_MAX_ERRORS, IGBOT_MAX_ROWS_PER_HOUR, igCallsLastMinute, isAuthorised, isObj, rateVerdict,
  type RequestRow, validateBatch,
} from "./ingest.ts";
import { bracketOf, IGBOT_RELEASE_MS, IGBOT_RULES } from "./rules.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/** The actions besides the journal, and the method each takes. */
export const ACTIONS: Record<string, "GET" | "POST"> = {
  account: "GET", markets: "GET", market: "GET", calendar: "GET", order: "POST", close: "POST", amend: "POST", cancel: "POST", cancel_all: "POST", sync: "POST",
};

export type HandleDeps = {
  secret: string; db: Db; now?: () => number; report?: typeof reportServerError; cronSecret?: string;
  /** The order path's dependencies for a moment (IG built only when an action needs it). */
  exec: (now: number) => ExecDeps;
  beat?: (key: string) => Promise<unknown>;
  owner?: () => string;
};

export async function handle(req: Request, deps: HandleDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  if (action === "sync") return await handleSync(req, deps, now());
  if (!deps.secret || deps.secret.length < 32) return json(503, { error: "not configured", detail: "IGBOT_TOKEN is not set" });
  if (!(await isAuthorised(req.headers.get("authorization"), deps.secret))) return json(401, { error: "unauthorised" });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "GET, POST" });
  if (action && !(action in ACTIONS)) return json(404, { error: `unknown action '${action.slice(0, 40)}'`, actions: Object.keys(ACTIONS).filter((a) => a !== "sync") });
  if (action && req.method !== ACTIONS[action]) return json(405, { error: `${action} takes ${ACTIONS[action]}` }, { Allow: ACTIONS[action] });
  const t = now();
  const db = deps.db;
  let igCalls: () => number = () => 0;
  const log = (status: number, rows: number, error: string | null) =>
    db.insert("igbot_requests", [{ status, rows, action: action || null, error: error ? error.slice(0, 300) : null, ig_calls: igCalls() }], false).catch(() => {});
  try {
    const last = await db.select<RequestRow>("igbot_requests", `at=gt.${encodeURIComponent(new Date(t - 3600e3).toISOString())}&select=at,status,rows,action,ig_calls&order=id.asc&limit=1000`);
    if (action) {
      const rate = rateVerdict(last, 0, t, true);
      if (!rate.ok) { await log(429, 0, "rate"); return json(429, { error: "rate limited", retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) }); }
      const used = igCallsLastMinute(last, t), cost = IGBOT_ACTION_IG_COST[action] ?? 0;
      if (cost > 0 && used + cost > IGBOT_IG_CALLS_PER_MINUTE) {
        await log(429, 0, "ig allowance");
        return json(429, { error: "rate limited", detail: `IG's allowance: ${used} IG requests in the last minute, this action may take ${cost} more, at most ${IGBOT_IG_CALLS_PER_MINUTE}`, retry_after_s: 20 }, { "Retry-After": "20" });
      }
      const x = { ...deps.exec(t), igBudget: IGBOT_IG_CALLS_PER_MINUTE - used };
      igCalls = () => x.igCalls?.() ?? 0;
      const owner = (deps.owner ?? (() => crypto.randomUUID()))();
      let out: { status: number; body: Record<string, unknown> };
      if (action === "calendar") {
        out = { status: 200, body: { now: new Date(t).toISOString(), releases: IGBOT_RELEASE_MS.filter((r) => r > t - IGBOT_RULES.blackoutTrailMs).map((r) => ({ at: new Date(r).toISOString(), no_open_from: new Date(r - IGBOT_RULES.blackoutLeadMs).toISOString(), no_open_until: new Date(r + IGBOT_RULES.blackoutTrailMs).toISOString() })), listed_until: "2026-12-31" } };
      } else if (action === "account") {
        out = { status: 200, body: accountView(await context(x), t) };
      } else if (action === "markets" || action === "market") {
        if (!x.ig) out = { status: 503, body: { error: "IG is not configured", detail: x.credsProblem } };
        else {
          const wl = (await db.select<{ epic: string }>("igbot_instruments", "enabled=is.true&select=epic&order=epic.asc")).map((i) => i.epic);
          const epic = (url.searchParams.get("epic") ?? "").trim();
          if (action === "market" && !/^[A-Za-z0-9._]{6,30}$/.test(epic)) out = { status: 422, body: { error: "invalid", errors: ["epic: an IG epic (6–30 of A–Z a–z 0–9 . _)"] } };
          else {
            try {
              if (action === "market") {
                const m = marketOf(await x.ig.market(epic));
                out = m ? { status: 200, body: marketOut(m, wl, t) } : { status: 404, body: { error: "IG has no such market" } };
              } else {
                const raw = await x.ig.markets(wl);
                const list = isObj(raw) && Array.isArray(raw.marketDetails) ? raw.marketDetails : [];
                out = { status: 200, body: { markets: list.map(marketOf).filter((m) => m !== null).map((m) => marketOut(m!, wl, t)) } };
              }
            } catch (e) {
              out = { status: 502, body: { error: "IG unreadable", detail: (e as Error).message.slice(0, 200) } };
            }
          }
        }
      } else {
        const type = req.headers.get("content-type") ?? "";
        const text = await req.text();
        if (text.length > IGBOT_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${IGBOT_MAX_BODY_BYTES} bytes` }); }
        let body: unknown = {};
        if (text.trim()) {
          if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
          try { body = JSON.parse(text); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid JSON" }); }
        }
        out = action === "order" ? await placeOrder(x, body, owner)
          : action === "close" ? await closePosition(x, body, owner)
          : action === "amend" ? await amendPosition(x, body, owner)
          : await cancelOrders(x, body, action === "cancel_all", owner);
      }
      const o = out.body as { errors?: string[]; refusals?: Array<{ rule: string }> };
      await log(out.status, 0, out.status === 200 ? null : `${action}: ${(o.refusals ?? []).map((r) => r.rule).join(",") || (o.errors ?? []).join("; ") || String(out.body.error ?? "")}`);
      return json(out.status, out.body);
    }
    if (req.method === "GET") {
      const v = rateVerdict(last, 0, t, false);
      const x = deps.exec(t);
      return json(200, { ok: true, now: new Date(t).toISOString(), environment: IGBOT_ENVIRONMENT, ig_configured: !!x.ig, ig_missing: x.credsProblem, rows_left_this_hour: v.rowsLeft, requests_this_hour: v.requests });
    }
    // The journal.
    const type = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > IGBOT_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${IGBOT_MAX_BODY_BYTES} bytes` }); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid UTF-8 JSON" }); }
    const v = validateBatch(body, t);
    const rate = rateVerdict(last, v.ok ? v.rows : 0, t, false);
    if (!rate.ok) {
      await log(429, 0, "rate");
      return json(429, { error: "rate limited", rows_left_this_hour: rate.rowsLeft, max_rows_per_hour: IGBOT_MAX_ROWS_PER_HOUR, retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) });
    }
    if (!v.ok) { await log(422, 0, v.errors.join("; ")); return json(422, { error: "invalid", errors: v.errors.slice(0, IGBOT_MAX_ERRORS) }); }
    const raw = body as Record<string, unknown[]>;
    const rowsOf = (k: "decisions" | "cycles" | "daily"): Array<Record<string, unknown>> => (v.batch[k] as Array<Record<string, unknown>>).map((r, i) => {
      const extra: Record<string, unknown> = {};
      // A shadow forecast carries the bracket's driftless m beside its p, as an open's order row does.
      if (k === "decisions" && r.direction && r.level && r.stop_level && r.limit_level) {
        const br = bracketOf(r.direction as "BUY" | "SELL", r.level as number, r.stop_level as number, r.limit_level as number, (r.p_target as number | null) ?? null);
        extra.m_base = br.ok ? br.m : null;
      }
      return { ...r, ...extra, raw: raw[k][i] };
    });
    const stored = { decisions: 0, cycles: 0, daily: 0 };
    for (const [k, table] of [["decisions", "igbot_decisions"], ["cycles", "igbot_cycles"], ["daily", "igbot_daily"]] as const) {
      const rows = rowsOf(k);
      if (!rows.length) continue;
      const ids = rows.map((r) => String(r.id));
      const have = new Set((await db.select<{ id: string }>(table, `id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id`)).map((r) => r.id));
      const fresh = rows.filter((r) => !have.has(String(r.id)));
      if (fresh.length) await db.insert(table, fresh, false);
      stored[k] = fresh.length;
    }
    const n = stored.decisions + stored.cycles + stored.daily;
    await log(200, n, null);
    return json(200, { ok: true, stored, duplicates: v.rows - n, rows_left_this_hour: Math.max(0, rate.rowsLeft - n) });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (deps.report ?? reportServerError)("igbot.request", { message, context: { action: action || "journal" } });
    await log(500, 0, message);
    return json(500, { error: "failed; send again later (ids make a resend safe)" });
  }
}

/** The scheduler's minute: the bearer CRON_SECRET, POST, the beat, then the sync. A fault is reported when it first appears and at most hourly. */
async function handleSync(req: Request, deps: HandleDeps, t: number): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!deps.cronSecret || !presented || !constantTimeEqual(presented, deps.cronSecret)) return json(401, { error: "unauthorised" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "POST" });
  await (deps.beat ?? ((k: string) => writeBeat(k)))(beatKeyOfRequest("igbot", req.url)).catch(() => false);
  let x: ExecDeps | null = null;
  // The sync's IG requests are a row like any other (action `sync`, which no agent limit counts), so the minute's budget sees them.
  const logSync = (status: number, error: string | null) =>
    x?.ig ? x.db.insert("igbot_requests", [{ status, rows: 0, action: "sync", error: error ? error.slice(0, 300) : null, ig_calls: x.igCalls?.() ?? 0 }], false).catch(() => {}) : Promise.resolve();
  try {
    const base = deps.exec(t);
    const last = base.ig
      ? await base.db.select<RequestRow>("igbot_requests", `at=gt.${encodeURIComponent(new Date(t - 60e3).toISOString())}&select=at,status,rows,action,ig_calls&order=id.asc&limit=1000`)
      : [];
    // Its reads of the book always run (the kill switch and the stops rest on them); what is optional fits in what is left.
    x = { ...base, igBudget: Math.max(3, IGBOT_IG_CALLS_PER_MINUTE - igCallsLastMinute(last, t)) };
    const r = await syncAll(x, (deps.owner ?? (() => crypto.randomUUID()))());
    await logSync(200, r.errors.length ? r.errors.join("; ") : null);
    if (r.errors.length) {
      const key = r.errors.map((e) => e.replace(/\d+(\.\d+)?/g, "#")).sort().join(" | ").slice(0, 400);
      const st = (await x.db.select<{ state: Record<string, unknown> | null }>("igbot_exec_state", "id=eq.1&select=state"))[0]?.state ?? {};
      const last = st.syncReport as { key: string; at: number } | undefined;
      if (!last || last.key !== key || t - last.at >= 3600e3) {
        await (deps.report ?? reportServerError)("igbot.sync", { message: r.errors.join("; ").slice(0, 500) });
        await x.db.update("igbot_exec_state", "id=eq.1", { state: { ...st, syncReport: { key, at: t } } });
      }
    }
    return json(200, { ok: r.ok, configured: r.configured, busy: r.busy ?? false, ...r.did, errors: r.errors.length });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await logSync(500, message);
    await (deps.report ?? reportServerError)("igbot.sync", { message });
    return json(500, { error: "sync failed" });
  }
}

const sent = (a: IgbotAnswer): IgSend => ({
  status: a.status, dealReference: isObj(a.body) && typeof a.body.dealReference === "string" ? a.body.dealReference : null,
  error: a.status === 200 ? null : (igErrorCode(a.body) || JSON.stringify(a.body).slice(0, 200)),
});

/** IG over the demo-only client (`client.ts`): every call this path makes, and nothing else. */
export function igApiOf(client: IgbotClient): IgApi {
  return {
    accounts: () => client.get("/accounts", 1),
    market: (epic) => client.get(`/markets/${epic}`, 3),
    markets: (epics) => client.get("/markets", 2, { epics: epics.join(",") }),
    positions: () => client.get("/positions", 2),
    working: () => client.get("/workingorders", 2),
    confirm: (ref) => client.get(`/confirms/${ref}`, 1),
    activity: (q) => client.get("/history/activity", 3, { from: q.fromIso.slice(0, 19), ...(q.dealId ? { dealId: q.dealId, pageSize: "50" } : { pageSize: "500" }), detailed: "true" }),
    prices: (epic, max) => client.get(`/prices/${epic}`, 3, { resolution: "HOUR", max: String(max), pageSize: "0" }),
    open: async (body) => sent(await client.call("POST", "/positions/otc", { version: 2, body })),
    // IG's documented form for a DELETE with a body: a POST carrying `_method: DELETE`.
    close: async (body) => sent(await client.call("POST", "/positions/otc", { version: 1, body, override: "DELETE" })),
    amend: async (dealId, body) => sent(await client.call("PUT", `/positions/otc/${dealId}`, { version: 2, body })),
    placeWorking: async (body) => sent(await client.call("POST", "/workingorders/otc", { version: 2, body })),
    deleteWorking: async (dealId) => sent(await client.call("DELETE", `/workingorders/otc/${dealId}`, { version: 2 })),
  };
}

/** The production dependencies: the database, and IG's demo client when its four secrets are set. */
export function productionExec(t: number): ExecDeps {
  const db = makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const creds = igbotCreds(Deno.env.toObject());
  if ("missing" in creds) return { db, now: t, ig: null, credsProblem: `IG's demo secrets are not set: ${creds.missing.join(", ")}`, accountId: null };
  const client = new IgbotClient({ creds });
  return { db, now: t, ig: igApiOf(client), credsProblem: null, accountId: creds.accountId, igCalls: () => client.requests };
}

if (import.meta.main) {
  Deno.serve((req: Request) => handle(req, {
    secret: Deno.env.get("IGBOT_TOKEN") ?? "",
    db: makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
    cronSecret: Deno.env.get("CRON_SECRET") ?? "", exec: productionExec,
  }));
}
