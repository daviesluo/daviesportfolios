// Supabase Edge Function: grokpm
//
// GROKPM's journal: the endpoint the outside Grok agent posts its decisions, its wakes and its daily summaries to (Davies,
// 2026-10-15: "每天的日志和汇总也都自动化…实时更新"; pre-registered in docs/agents/reviews/2026-10-15-grokpm-prereg.md, whose
// appendix is the contract). It stores what the agent SAYS. What the wallet actually holds is recorded apart, keylessly, by
// `agents?action=grokpmrec` (agents/grokpm_rec.ts), and the page's money is that record, never this journal.
//
//   POST  a JSON body of up to three lists, `decisions`, `cycles` and `daily` (`ingest.ts` checks every field): stored, a
//         row whose id is already stored counted as a duplicate. 200 with what was stored.
//   GET   a ping: 200 with the server's time and what is left of the hour's rows, so the agent can check its secret.
//
// Auth: `Authorization: Bearer <GROKPM_LOG_TOKEN>`, a Supabase Edge Function secret Davies creates and gives only to the
// agent, compared in constant time (`isAuthorised`). Without the secret (or with one shorter than 32 characters) every
// request is refused with 503. The function is deployed without the gateway's JWT check (the deploy workflow's
// PUBLIC_FNS), because its bearer is that secret and not a Supabase JWT; an `apikey` header is not needed and is ignored.
// The secret is never printed, logged or returned.
//
// Kept apart from `agents`: it imports nothing of that function or of any venue client, holds no key of any venue, and
// writes only its four tables (`grokpm_decisions`, `grokpm_cycles`, `grokpm_daily`, `grokpm_requests`, migration 0124).
// Every free-text field is untrusted: stored as text, never executed, never read as an instruction.

import { reportServerError } from "../_shared/ops.ts";
import {
  GROKPM_MAX_BODY_BYTES, GROKPM_MAX_ERRORS, GROKPM_MAX_ROWS_PER_HOUR, isAuthorised, rateVerdict, type RequestRow, tableRows, validateBatch,
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
export async function handle(req: Request, deps: { secret: string; db: IngestDb; now?: () => number; report?: typeof reportServerError }): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (!deps.secret || deps.secret.length < 32) return json(503, { error: "not configured", detail: "GROKPM_LOG_TOKEN is not set" });
  if (!(await isAuthorised(req.headers.get("authorization"), deps.secret))) return json(401, { error: "unauthorised" });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" }, { Allow: "GET, POST" });
  const t = now();
  const since = new Date(t - 3600e3).toISOString();
  const log = (status: number, rows: number, error: string | null) => deps.db.logRequest({ status, rows, error: error ? error.slice(0, 300) : null }).catch(() => {});
  try {
    const last = await deps.db.recentRequests(since);
    if (req.method === "GET") {
      const v = rateVerdict(last, 0, t);
      return json(200, { ok: true, now: new Date(t).toISOString(), rows_left_this_hour: v.rowsLeft, requests_this_hour: v.requests });
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

if (import.meta.main) {
  Deno.serve((req: Request) => handle(req, {
    secret: Deno.env.get("GROKPM_LOG_TOKEN") ?? "",
    db: makeIngestDb(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
  }));
}
