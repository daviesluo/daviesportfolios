// Supabase Edge Function: cxbot
//
// CXBOT's server, "Crypto analyst" (research docs/agents/reviews/2026-10-29-crypto-grok-bot-research.md; the audit
// docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md; the pre-registration, a DRAFT,
// docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md; the agent's prompt docs/agents/cxbot/GROK_PROMPT.md). An outside
// Grok agent forecasts and trades BTC, ETH and SOL perpetuals, long and short, ON PAPER, through this function: Grok
// proposes, the server enforces (`rules.ts`) and fills on paper against a venue's public tape (`engine.ts`). No key of any
// venue exists here: every read is public (`client.ts`).
//
//   GET                     a ping: the time, the mode, the tape's age, the hour's budget.
//   POST                    the journal: `decisions` (no_action shadow brackets), `cycles`, `daily` (`ingest.ts`).
//   GET  ?action=account    mode, gates, the paper budget and its room, positions, resting orders, the next releases.
//   GET  ?action=markets    each coin: the touch, depth, the last minute, volatility, funding now and predicted, open interest.
//   GET  ?action=context    Deribit's vol and forward vols, Polymarket's daily questions, Binance's spot, liquidations, flows.
//   GET  ?action=quote      the server's numbers for a bracket (m, costs, p*, the bar, the outcome under implied and realised
//                           vol, Polymarket and Deribit near its levels, size, leverage) and the rules it would break.
//   GET  ?action=questions  the open assigned questions; POST ?action=forecast their answers.
//   GET  ?action=calendar   the listed releases and their no-open windows.
//   POST ?action=order | close | amend | cancel | cancel_all   the paper book.
//   POST ?action=tick       the scheduler's (bearer CRON_SECRET), every minute: its beat first, then the recorder, the
//                           context, the paper engine, the questions and the snapshot.
//   POST ?action=reach      the scheduler's bearer, by hand: one public read of each venue and source from this region,
//                           into `cxbot_reach` (audit §2.2). It routes round nothing.
//
// Auth: `Authorization: Bearer <CXBOT_TOKEN>` (a Supabase secret Davies creates and gives only to the agent; 32 characters
// or more, compared in constant time); `tick` and `reach` take the scheduler's CRON_SECRET. Deployed without the gateway's
// JWT check (the deploy workflow's PUBLIC_FNS): neither bearer is a Supabase JWT. Every free-text field the agent sends is
// untrusted data, stored as text and never read as an instruction.

import { reportServerError } from "../_shared/ops.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { constantTimeEqual } from "../_shared/token.ts";
import { type Db, makeDb } from "../agents/db.ts";
import { reachAll } from "./client.ts";
import {
  accountView, amendPosition, calendarView, cancelOrders, closePosition, contextView, type Deps, forecast, lastRead, makeDeps, marketsView, placeOrder, questionsView,
  quoteView, readConfig, readState, tick, writeState,
} from "./engine.ts";
import { CXBOT_MAX_BODY_BYTES, CXBOT_MAX_ERRORS, CXBOT_MAX_ROWS_PER_HOUR, isAuthorised, isObj, rateVerdict, type RequestRow, TRADING_ACTIONS, validateAnswers, validateBatch } from "./ingest.ts";
import { bracketOf, COINS } from "./rules.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/** The agent's actions besides the journal, and the method each takes. */
export const ACTIONS: Record<string, "GET" | "POST"> = {
  account: "GET", markets: "GET", context: "GET", quote: "GET", questions: "GET", calendar: "GET",
  forecast: "POST", order: "POST", close: "POST", amend: "POST", cancel: "POST", cancel_all: "POST",
};

export type HandleDeps = {
  secret: string; db: Db; now?: () => number; report?: typeof reportServerError; cronSecret?: string;
  deps: (now: number) => Deps; beat?: (key: string) => Promise<unknown>; owner?: () => string; region?: string | null;
  /** The `reach` probe's fetch (the tests' double; production's global fetch). */
  fetchImpl?: typeof fetch;
};

export async function handle(req: Request, h: HandleDeps): Promise<Response> {
  const now = h.now ?? Date.now;
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";
  if (action === "tick" || action === "reach") return await handleCron(req, h, now(), action);
  if (!h.secret || h.secret.length < 32) return json(503, { error: "not configured", detail: "CXBOT_TOKEN is not set" });
  if (!(await isAuthorised(req.headers.get("authorization"), h.secret))) return json(401, { error: "unauthorised" });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "GET, POST" });
  if (action && !(action in ACTIONS)) return json(404, { error: `unknown action '${action.slice(0, 40)}'`, actions: Object.keys(ACTIONS) });
  if (action && req.method !== ACTIONS[action]) return json(405, { error: `${action} takes ${ACTIONS[action]}` }, { Allow: ACTIONS[action] });
  const t = now();
  const db = h.db;
  const log = (status: number, rows: number, error: string | null) =>
    db.insert("cxbot_requests", [{ status, rows, action: action || null, error: error ? error.slice(0, 300) : null }], false).catch(() => {});
  try {
    const last = await db.select<RequestRow>("cxbot_requests", `at=gt.${encodeURIComponent(new Date(t - 3600e3).toISOString())}&select=at,status,rows,action&order=id.asc&limit=1000`);
    if (action) {
      const rate = rateVerdict(last, 0, t, action);
      if (!rate.ok) { await log(429, 0, "rate"); return json(429, { error: "rate limited", retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) }); }
      const x = h.deps(t);
      const owner = (h.owner ?? (() => crypto.randomUUID()))();
      let out: { status: number; body: Record<string, unknown> };
      if (action === "account") out = { status: 200, body: await accountView(x) };
      else if (action === "markets") out = { status: 200, body: await marketsView(x) };
      else if (action === "context") out = { status: 200, body: await contextView(x) };
      else if (action === "questions") out = { status: 200, body: await questionsView(x) };
      else if (action === "calendar") out = { status: 200, body: calendarView(t) };
      else if (action === "quote") out = await quoteView(x, url.searchParams);
      else {
        const type = req.headers.get("content-type") ?? "";
        const text = await req.text();
        if (text.length > CXBOT_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${CXBOT_MAX_BODY_BYTES} bytes` }); }
        let body: unknown = {};
        if (text.trim()) {
          if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
          try { body = JSON.parse(text); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid JSON" }); }
        }
        const minuteTrades = last.filter((r) => r.action && TRADING_ACTIONS.has(r.action) && r.status !== 429 && Date.parse(r.at) > t - 60e3).length;
        if (action === "forecast") {
          const v = validateAnswers(body);
          out = v.ok ? await forecast(x, v.answers, (body as { answers: unknown[] }).answers) : { status: 422, body: { error: "invalid", errors: v.errors } };
        } else if (TRADING_ACTIONS.has(action) && minuteTrades >= 3) {
          out = { status: 422, body: { error: "refused", refusals: [{ rule: "orders_minute", why: "at most 3 trading requests a minute" }] } };
        } else {
          out = action === "order" ? await placeOrder(x, body, owner, minuteTrades)
            : action === "close" ? await closePosition(x, body, owner)
            : action === "amend" ? await amendPosition(x, body, owner)
            : await cancelOrders(x, body, action === "cancel_all", owner);
        }
      }
      const o = out.body as { errors?: string[]; refusals?: Array<{ rule: string }> };
      await log(out.status, 0, out.status === 200 ? null : `${action}: ${(o.refusals ?? []).map((r) => r.rule).join(",") || (o.errors ?? []).join("; ") || String(out.body.error ?? "")}`);
      return json(out.status, out.body);
    }
    if (req.method === "GET") {
      const v = rateVerdict(last, 0, t, null);
      const cfg = await readConfig(db);
      const r = await lastRead(db, cfg.venue, COINS[0]).catch(() => null);
      return json(200, {
        ok: true, now: new Date(t).toISOString(), mode: cfg.mode, venue: cfg.venue, started_at: cfg.started_at,
        tape_age_s: r?.fetched_at ? Math.round((t - Date.parse(r.fetched_at)) / 1000) : null, rows_left_this_hour: v.rowsLeft, requests_this_hour: v.requests,
      });
    }
    // The journal.
    const type = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(type)) { await log(415, 0, "content-type"); return json(415, { error: "content-type must be application/json" }); }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > CXBOT_MAX_BODY_BYTES) { await log(413, 0, "too large"); return json(413, { error: `body over ${CXBOT_MAX_BODY_BYTES} bytes` }); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { await log(400, 0, "not JSON"); return json(400, { error: "body is not valid UTF-8 JSON" }); }
    const v = validateBatch(body, t);
    const rate = rateVerdict(last, v.ok ? v.rows : 0, t, null);
    if (!rate.ok) {
      await log(429, 0, "rate");
      return json(429, { error: "rate limited", rows_left_this_hour: rate.rowsLeft, max_rows_per_hour: CXBOT_MAX_ROWS_PER_HOUR, retry_after_s: rate.retryAfterS }, { "Retry-After": String(rate.retryAfterS) });
    }
    if (!v.ok) { await log(422, 0, v.errors.join("; ")); return json(422, { error: "invalid", errors: v.errors.slice(0, CXBOT_MAX_ERRORS) }); }
    const raw = body as Record<string, unknown[]>;
    const stored = { decisions: 0, cycles: 0, daily: 0 };
    for (const [k, table] of [["decisions", "cxbot_decisions"], ["cycles", "cxbot_cycles"], ["daily", "cxbot_daily"]] as const) {
      const rows: Array<Record<string, unknown>> = (v.batch[k] as unknown as Array<Record<string, unknown>>).map((r, i) => {
        if (k !== "decisions") return { ...r, raw: raw[k][i] };
        // A shadow bracket carries its model-free m beside its p.
        const br = r.direction && r.entry && r.stop && r.limit ? bracketOf(r.direction as "long" | "short", r.entry as number, r.stop as number, r.limit as number) : null;
        const { limit, ...rest } = r;
        return { ...rest, limit_px: limit ?? null, m_base: br && br.ok ? Math.round(br.m * 1e4) / 1e4 : null, raw: raw[k][i] };
      });
      if (!rows.length) continue;
      const ids = rows.map((r) => String(r.id));
      const have = new Set((await db.select<{ id: string }>(table, `id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id`)).map((r) => r.id));
      const fresh = rows.filter((r) => !have.has(String(r.id)));
      if (fresh.length) await db.insert(table, fresh, false);
      stored[k] = fresh.length;
    }
    const total = stored.decisions + stored.cycles + stored.daily;
    await log(200, total, null);
    return json(200, { ok: true, stored, duplicates: v.rows - total, rows_left_this_hour: Math.max(0, rate.rowsLeft - total) });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (h.report ?? reportServerError)("cxbot.request", { message, context: { action: action || "journal" } });
    await log(500, 0, message);
    return json(500, { error: "failed; send again later (ids make a resend safe)" });
  }
}

/** The scheduler's calls: the bearer CRON_SECRET, POST; `tick` writes its beat first. A tick's faults are reported when they first appear and at most hourly. */
async function handleCron(req: Request, h: HandleDeps, t: number, action: string): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!h.cronSecret || !presented || !constantTimeEqual(presented, h.cronSecret)) return json(401, { error: "unauthorised" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "POST" });
  if (action === "reach") {
    const rows = await reachAll(h.fetchImpl ?? fetch, h.now ?? Date.now);
    const region = h.region ?? null;
    await h.db.insert("cxbot_reach", rows.map((r) => ({ ...r, region, ms: Math.round(r.ms) })), false).catch(() => {});
    return json(200, { region, reach: rows });
  }
  await (h.beat ?? ((k: string) => writeBeat(k)))(beatKeyOfRequest("cxbot", req.url)).catch(() => false);
  try {
    const x = h.deps(t);
    const r = await tick(x, (h.owner ?? (() => crypto.randomUUID()))());
    if (r.errors.length) {
      const key = r.errors.map((e) => e.replace(/\d+(\.\d+)?/g, "#")).sort().join(" | ").slice(0, 400);
      const st = await readState(x.db);
      const lastRep = st.tickReport as { key: string; at: number } | undefined;
      if (!lastRep || lastRep.key !== key || t - lastRep.at >= 3600e3) {
        await (h.report ?? reportServerError)("cxbot.tick", { message: r.errors.join("; ").slice(0, 500) });
        await writeState(x.db, { ...st, tickReport: { key, at: t } }, t);
      }
    }
    return json(200, { ok: !r.errors.length, busy: r.busy, ...r.did, errors: r.errors.length });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await (h.report ?? reportServerError)("cxbot.tick", { message });
    return json(500, { error: "tick failed" });
  }
}

if (import.meta.main) {
  const db = makeDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  Deno.serve((req: Request) => handle(req, {
    secret: Deno.env.get("CXBOT_TOKEN") ?? "", db, cronSecret: Deno.env.get("CRON_SECRET") ?? "", region: Deno.env.get("SB_REGION") ?? null,
    deps: (t: number) => makeDeps(db, t),
  }));
}

export { isObj };
