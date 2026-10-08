// Supabase Edge Function: monitor
//
// The production monitor's half inside Supabase. Its caller is the Cloudflare Worker `daviesportfolios-monitor`
// (`workers/monitor`), every minute, from outside Supabase's scheduler: on 2026-10-02 the database thrashed from about
// 13:00 to 14:20 UTC, pg_cron's one-minute job barely ran, and nothing alerted (the GitHub health check asks for every
// 10 minutes and ran 9 times in 48 hours). Davies, the same day: "可以的，有问题开github issue吧并且也可以在网站中的error框发给我" —
// open a GitHub issue, and send it to the site's errors box as well.
//
// Three actions, POST only:
//   ?action=deadman  PR5's dead-man switch (`deadman.ts`): when its live executor has not finished a turn for three
//                    minutes, or its state cannot be read at all and no read in the last three minutes found it fresh
//                    (the body's `lastFreshAt`, which the Worker remembers), every resting order on its Revolut X
//                    sub-account is cancelled and read back. Fresh, or unreadable inside that grace, it touches nothing.
//                    It writes its call's beat beside the work (`edge_call_beats`, key `monitor?action=deadman`), so the
//                    Worker's minutes show in the database.
//   ?action=health   is Supabase's minute loop alive (`health.ts`): four read-only freshness readings with limits.
//   ?action=report   the Worker's alerts into `ops_errors`, which the site's errors box reads (`ops-error`'s summary):
//                    kinds `monitor.*` only. A report the database does not take answers 503, and the Worker keeps it
//                    queued until one does.
//
// Kept apart from `agents` on purpose: it imports nothing of that function, so a broken agents bundle cannot take the
// monitor down. It reads PR5's key by the executor's own names (`PR5_KEY_NAMES`), and the key never leaves Supabase.
//
// Auth: the gateway's (deployed WITH JWT verification; the Worker sends the public anon key as its bearer), then the
// shared secret `MONITOR_SECRET` in `x-monitor-secret`, compared in constant time as SHA-256 digests (equal lengths, so
// even the secret's length is not timed). Unset, every request is refused.

import { reportServerError } from "../_shared/ops.ts";
import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { loadPrivateKey } from "../_shared/revx.ts";
import { constantTimeEqual } from "../_shared/token.ts";
import {
  type DeadmanReport, type DeadmanVenue, pr5KeyFrom, readState, readStateOnce, revxDeadmanVenue, runDeadman, writeRecord,
} from "./deadman.ts";
import { type HealthReport, runHealth } from "./health.ts";

/** The header the Worker carries the shared secret in. */
export const SECRET_HEADER = "x-monitor-secret";
/** At most this many reports a call, and each field clipped as `ops-error` clips a client's. */
export const MAX_REPORTS = 50;
const MAX_MESSAGE = 512, MAX_SYMBOL = 32, MAX_CONTEXT = 2_048;
/** Only the monitor's own kinds: this is not a second way into the errors box for anything else. */
export const REPORT_KIND = /^monitor\.[a-z_]{1,40}$/;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The shared secret, compared in constant time as SHA-256 digests. A missing or empty secret on either side is a refusal. */
export async function isAuthorised(given: string | null, secret: string): Promise<boolean> {
  if (!secret || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(secret))]);
  return constantTimeEqual(hex(a), hex(b));
}

export type OpsRow = { kind: string; symbol: string | null; message: string | null; context: unknown; ip: string };

/** The Worker's reports as `ops_errors` rows, or why they are refused. */
export function reportRows(body: unknown): { ok: true; rows: OpsRow[] } | { ok: false; error: string } {
  const list = (body as { reports?: unknown } | null)?.reports;
  if (!Array.isArray(list) || !list.length) return { ok: false, error: "reports: a non-empty list" };
  if (list.length > MAX_REPORTS) return { ok: false, error: `reports: at most ${MAX_REPORTS}` };
  const rows: OpsRow[] = [];
  for (const r of list as Array<Record<string, unknown> | null>) {
    const kind = typeof r?.kind === "string" ? r.kind : "";
    if (!REPORT_KIND.test(kind)) return { ok: false, error: `kind ${JSON.stringify(kind).slice(0, 60)} is not one of the monitor's (monitor.<word>)` };
    const message = typeof r?.message === "string" ? r.message.slice(0, MAX_MESSAGE) : null;
    const symbol = typeof r?.check === "string" ? r.check.slice(0, MAX_SYMBOL) : null;
    let context: unknown = r?.context ?? null;
    try { if (context != null && JSON.stringify(context).length > MAX_CONTEXT) context = { _truncated: true }; } catch { context = { _unserializable: true }; }
    rows.push({ kind, symbol, message, context, ip: "monitor" });
  }
  return { ok: true, rows };
}

/** Insert the rows in one request; true when the database took them. */
export async function insertReports(rows: OpsRow[], sbUrl: string, key: string, f: typeof fetch = fetch, timeoutMs = 5_000): Promise<{ ok: boolean; error?: string }> {
  if (!sbUrl || !key) return { ok: false, error: "the function has no database URL or service key" };
  try {
    const res = await f(`${sbUrl}/rest/v1/ops_errors`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return res.ok ? { ok: true } : { ok: false, error: `${res.status} ${text.slice(0, 160)}` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * The dead-man call's body: `{ lastFreshAt }`, when a read last found PR5's executor fresh, as the Worker remembers it.
 * Anything else (no body, not JSON, not a time, too long) is null: no grace, as before 2026-10-07.
 */
export function lastFreshOf(body: unknown): string | null {
  const v = (body as { lastFreshAt?: unknown } | null)?.lastFreshAt;
  if (typeof v !== "string" || !v || v.length > 40 || !Number.isFinite(Date.parse(v))) return null;
  return v;
}

export type HandlerDeps = {
  secret: string;
  beat: (key: string) => Promise<unknown>;
  deadman: (lastFreshAt: string | null) => Promise<DeadmanReport>;
  health: () => Promise<HealthReport>;
  insert: (rows: OpsRow[]) => Promise<{ ok: boolean; error?: string }>;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A request's way through: POST, the shared secret, then its action. Exported so the order is pinned. */
export async function handle(req: Request, d: HandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!(await isAuthorised(req.headers.get(SECRET_HEADER), d.secret))) return json(401, { error: "unauthorised" });
  const action = new URL(req.url).searchParams.get("action");
  if (action === "deadman") {
    const lastFreshAt = lastFreshOf(await req.json().catch(() => null));
    // The beat beside the work, never before it: the database is the likeliest thing to be slow when this matters.
    const [, report] = await Promise.all([d.beat(beatKeyOfRequest("monitor", req.url)).catch(() => false), d.deadman(lastFreshAt)]);
    return json(200, report);
  }
  if (action === "health") return json(200, await d.health());
  if (action === "report") {
    let body: unknown;
    try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
    const parsed = reportRows(body);
    if (!parsed.ok) return json(400, { error: parsed.error });
    const r = await d.insert(parsed.rows);
    return r.ok ? json(200, { inserted: parsed.rows.length }) : json(503, { error: `the database did not take the reports: ${r.error ?? "unknown"}` });
  }
  return json(404, { error: "action: deadman, health or report" });
}

/** PR5's sub-account for the dead-man, or why there is none (the reason names a secret, never its value). */
async function pr5Venue(): Promise<{ venue: DeadmanVenue | null; note: string | null }> {
  const k = pr5KeyFrom((n) => Deno.env.get(n));
  if ("error" in k) return { venue: null, note: k.error };
  try {
    const { key } = await loadPrivateKey(k.priv);
    return { venue: revxDeadmanVenue({ apiKey: k.apiKey, privateKey: key }), note: null };
  } catch (e) {
    return { venue: null, note: `private key unreadable: ${msg(e)}` };
  }
}

if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    return await handle(req, {
      secret: Deno.env.get("MONITOR_SECRET") ?? "",
      beat: (k) => writeBeat(k),
      // One line a call in the function's log: what each minute found, without a venue or a database read to ask.
      deadman: async (lastFreshAt) => {
        const r = await runDeadman({
          now: () => Date.now(), pause, venue: pr5Venue, lastFreshAt,
          readState: () => readState(() => readStateOnce(sbUrl, key), pause),
          record: (rec) => writeRecord(rec, sbUrl, key),
        });
        console.log(`deadman ${r.verdict} age=${r.ageS ?? "-"}s lastFresh=${r.lastFreshAt ?? "-"}${r.grace ? ` grace=${r.grace.hold ? "hold" : "none"}` : ""} listed=${r.listed ?? "-"} outcomes=${r.orders.map((o) => o.outcome).join(",") || "-"}${r.error ? ` error=${r.error.slice(0, 120)}` : ""}`);
        return r;
      },
      health: async () => {
        const h = await runHealth(sbUrl, key, () => Date.now());
        const size = h.size?.ok ? `${(h.size.bytes / 1e9).toFixed(2)}GB${h.size.over ? "!" : ""}` : "?";
        console.log(`health ${h.ok ? "ok" : "stale"} ${Object.entries(h.checks).map(([n, c]) => `${n}=${c.ok ? c.ageS : `x${c.ageS ?? "?"}`}`).join(" ")} db=${size}`);
        return h;
      },
      insert: (rows) => insertReports(rows, sbUrl, key),
    });
  } catch (e) {
    await reportServerError("monitor.crash", { message: msg(e) });
    return json(500, { error: "monitor crashed", message: msg(e).slice(0, 200) });
  }
});
