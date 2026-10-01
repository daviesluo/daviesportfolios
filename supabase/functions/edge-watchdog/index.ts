// Supabase Edge Function: edge-watchdog
//
// Runs a call of the one-minute job again, once, when the platform never started a worker for it (migration 0075).
//
// The fault. In the 24 hours to 2026-10-01 15:00 UTC, 19 of the ~19,700 calls `edge-calls-every-minute` makes answered
// 503 `{"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}`: all on `agents` in eu-west-2,
// each 10.1–10.9 s after the request, with no execution id and no boot error in the function's logs. About one call in
// a thousand, at random across the actions, at the top of the minute when 13–17 calls boot together. It is the
// platform's, and nothing here can stop it; what can be done is that no call is lost to it.
//
// How. Every function the job calls writes a beat as its first act (`_shared/beats.ts`): its key, under the minute the
// database stamps. This function is a row of the same job, so it starts with the others; it waits, without CPU, until 13 s
// into its minute (`CHECK_AT_MS`), when every call that started has written its beat, reads the minute's due calls from
// the job's own list (`edge_calls`, by the job's own filter, `isDue`) and the minute's beats, and runs each due call
// that has no beat again: the same URL, the same cron bearer, header and body, awaited within the call's own timeout.
//   * Once. A retry is claimed by inserting its row in `edge_call_retries` (key: minute and path) before it is sent, so
//     a call is run again at most once a minute whoever asks; the row then records the answer, its status and time.
//   * Only what is safe twice. Every call on the list was read for what a second run in the same minute does (0075's
//     table); the two that read a market's book for the minute it is in, RW's and RW-C's paper engines, are `retry`
//     false: their frozen specs say a minute whose book was not read quotes nothing, and a book read 13 s late would be
//     filled by prints from before it was read. A due call with `retry` false and no beat is recorded `excluded`.
//   * Only a few. More than `MAX_RETRIES` due calls with no beat is far likelier to be beats not being written (a deploy
//     in flight, the table refusing them) than workers not starting (the five failures the ledger recorded on 2026-10-01
//     fell in five different minutes): nothing is run again, and it is reported.
//   * A call whose retry answered and still wrote no beat under the key looked for would be run twice every minute; it is
//     reported, and not run again for `HOLD_MS`.
//   * A watchdog that starts more than `LATE_MS` into its minute is in a batch that began late (reference §4 item 39
//     measured batches beginning within 0.44 s of their minute), so it runs nothing again: a retry from past :20 would
//     run into the next minute's call. Its own boot failing loses only that minute's retries.
// It reports to `ops_errors` only what needs a person: a retry that failed too, a call whose retry wrote no beat, too
// many missing beats, and a list it could not read.
//
// It answers when its retries have answered, and asks the runtime to keep the worker until then (`waitUntil`): its own
// row's pg_net timeout (58 s, as the other minute calls) bounds how long it holds the job's batch, and a retry that runs
// past that still has its answer recorded. Each retry starts its own chain of nested calls, well inside the platform's
// 30 requests per trace in 60 s; over it, the platform refuses with a 429, recorded as a failed retry.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` only, POST only; deployed --no-verify-jwt (PUBLIC_FNS in
// edge-functions.yml), because that bearer is not a Supabase JWT.

import { reportServerError } from "../_shared/ops.ts";
import { constantTimeEqual } from "../_shared/token.ts";
import { BEAT_TABLE, beatKeyOfPath, beatKeyOfRequest, minuteOf, writeBeat } from "../_shared/beats.ts";

/** This function's own row of the list. It never runs itself again. */
export const WATCHDOG_PATH = "edge-watchdog";
/** The list the job queues from, and where each retry is claimed and recorded (0075). */
export const LIST_TABLE = "edge_calls";
export const RETRY_TABLE = "edge_call_retries";
/**
 * The beats are read this far into the minute. A worker that does not start answers 503 10.1–10.9 s after the request,
 * so one that starts has started by then, and its beat takes at most `BEAT_TIMEOUT_MS` (2 s) more.
 */
export const CHECK_AT_MS = 13_000;
/** And at least this long after the watchdog itself started, when its batch began a few seconds late. */
export const AFTER_ARRIVAL_MS = 12_000;
/** Started later than this into its minute, it runs nothing again (see the header). */
export const LATE_MS = 8_000;
/** More due calls than this with no beat (those the list excludes counted too), and nothing is run again: see the header. */
export const MAX_RETRIES = 4;
/** A call whose retry answered and wrote no beat is not run again for this long. */
export const HOLD_MS = 10 * 60_000;

/** A row of `edge_calls`, as the job reads it. */
export type EdgeCall = { path: string; timeout_ms: number; every_minutes: number; last_utc_hour: number; enabled: boolean; retry: boolean };
/**
 * What became of a call with no beat. `ok`: its retry answered 2xx. `failed`: its retry answered otherwise, or not at all
 * and wrote no beat. `running`: its retry did not answer within the call's timeout, but its beat shows it started.
 * `no_beat`: its retry answered 2xx and wrote no beat under the key looked for. `excluded`: not run again (`retry`
 * false). `held`: not run again, its retry having written no beat within `HOLD_MS`. `sent`: claimed, not yet answered.
 */
export type Outcome = "sent" | "ok" | "failed" | "running" | "no_beat" | "excluded" | "held";
export type RetryResult = { path: string; outcome: Outcome; status: number | null; ms: number | null; detail: string | null };
export type WatchdogReport = {
  minute: string; arrivedMs: number; checkedMs: number | null; due: number; beats: number;
  missing: string[]; retried: RetryResult[]; excluded: string[]; held: string[]; skipped?: string; errors: string[];
};

/** The database, as the watchdog uses it (PostgREST with the service key). */
export type Rest = {
  select: <T>(table: string, query: string) => Promise<T[]>;
  /** An insert that writes nothing when the row's key is taken, returning what it wrote: an empty list is a lost claim. */
  claim: <T>(table: string, row: Record<string, unknown>, onConflict: string) => Promise<T[]>;
  update: (table: string, query: string, patch: Record<string, unknown>) => Promise<void>;
};
export type WatchdogDeps = {
  rest: Rest;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The retry: POST the call's path with the cron bearer, given up after `timeoutMs`. */
  call: (path: string, timeoutMs: number) => Promise<{ status: number; body: string }>;
  report: (kind: string, o: { message?: string; context?: unknown }) => Promise<void>;
};

const iso = (ms: number) => new Date(ms).toISOString();
const enc = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const isOk = (status: number) => status >= 200 && status < 300;

/** Is the call due in the minute that starts at `minuteMs`? The job's own filter (0075), row for row. */
export function isDue(c: EdgeCall, minuteMs: number): boolean {
  const at = new Date(minuteMs);
  return c.enabled && at.getUTCMinutes() % c.every_minutes === 0 && at.getUTCHours() <= c.last_utc_hour;
}

/** The minute's due calls with no beat: those to run again, and those the list says not to. Never the watchdog. */
export function plan(calls: EdgeCall[], beats: Iterable<string>, minuteMs: number): { due: number; retry: EdgeCall[]; excluded: EdgeCall[] } {
  const have = new Set(beats);
  const due = calls.filter((c) => c.path !== WATCHDOG_PATH && isDue(c, minuteMs));
  const missing = due.filter((c) => !have.has(beatKeyOfPath(c.path)));
  return { due: due.length, retry: missing.filter((c) => c.retry), excluded: missing.filter((c) => !c.retry) };
}

/** When the beats are read: `CHECK_AT_MS` into the minute, and no sooner than `AFTER_ARRIVAL_MS` after starting. */
export function checkAt(arrivedMs: number): number {
  return Math.max(minuteOf(arrivedMs) + CHECK_AT_MS, arrivedMs + AFTER_ARRIVAL_MS);
}

/** A retry's outcome from its answer (null: none came) and whether its beat is there (null: unreadable). */
export function classify(status: number | null, beat: boolean | null): Outcome {
  if (status !== null) return !isOk(status) ? "failed" : beat === false ? "no_beat" : "ok";
  return beat === true ? "running" : "failed";
}

/** One call run again: claimed, sent, awaited within its own timeout, its beat read, and the outcome recorded. */
async function retryOne(d: WatchdogDeps, c: EdgeCall, minuteIso: string): Promise<RetryResult | null> {
  const where = `minute=eq.${enc(minuteIso)}&path=eq.${enc(c.path)}`;
  try {
    const claimed = await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "sent" }, "minute,path");
    if (!claimed.length) return null;                          // already run again this minute, by another run
  } catch (e) {
    return { path: c.path, outcome: "failed", status: null, ms: null, detail: `not sent: the retry could not be claimed (${msg(e)})` };
  }
  const t0 = d.now();
  let status: number | null = null, detail: string | null = null;
  try {
    const r = await d.call(c.path, c.timeout_ms);
    status = r.status;
    if (!isOk(r.status)) detail = r.body.slice(0, 300);
  } catch (e) {
    detail = msg(e);
  }
  const ms = d.now() - t0;
  let beat: boolean | null = null;
  try {
    beat = (await d.rest.select(BEAT_TABLE, `minute=eq.${enc(minuteIso)}&path=eq.${enc(beatKeyOfPath(c.path))}&select=path&limit=1`)).length > 0;
  } catch { /* unreadable: the answer alone decides */ }
  const out: RetryResult = { path: c.path, outcome: classify(status, beat), status, ms, detail };
  try {
    await d.rest.update(RETRY_TABLE, where, { outcome: out.outcome, status, ms, detail });
  } catch (e) {
    out.detail = `${detail ? `${detail}; ` : ""}its record could not be written (${msg(e)})`;
  }
  return out;
}

/** One minute of the watchdog. Never throws past its own reads: what fails is in `errors`, and reported. */
export async function runWatchdog(d: WatchdogDeps): Promise<WatchdogReport> {
  const arrived = d.now(), minute = minuteOf(arrived), minuteIso = iso(minute);
  const report: WatchdogReport = {
    minute: minuteIso, arrivedMs: arrived - minute, checkedMs: null, due: 0, beats: 0, missing: [], retried: [], excluded: [], held: [], errors: [],
  };
  if (arrived - minute > LATE_MS) return { ...report, skipped: `started ${((arrived - minute) / 1000).toFixed(1)} s into its minute: a late batch, nothing is run again` };
  const wait = checkAt(arrived) - d.now();
  if (wait > 0) await d.sleep(wait);
  const checkedMs = report.checkedMs = d.now() - minute;

  let calls: EdgeCall[], beats: string[];
  try {
    [calls, beats] = await Promise.all([
      d.rest.select<EdgeCall>(LIST_TABLE, "select=path,timeout_ms,every_minutes,last_utc_hour,enabled,retry&order=id.asc"),
      d.rest.select<{ path: string }>(BEAT_TABLE, `minute=eq.${enc(minuteIso)}&select=path`).then((rows) => rows.map((r) => r.path)),
    ]);
  } catch (e) {
    report.errors.push(`the list or the beats are unreadable (${msg(e)}); nothing is run again this minute`);
    await d.report("edge-watchdog.unreadable", { message: report.errors[0], context: { minute: minuteIso } });
    return report;
  }
  const p = plan(calls, beats, minute);
  report.due = p.due;
  report.beats = beats.length;
  report.missing = [...p.retry, ...p.excluded].map((c) => c.path);

  // Recorded, never run: the calls the list says not to run again.
  for (const c of p.excluded) {
    try {
      await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "excluded" }, "minute,path");
      report.excluded.push(c.path);
    } catch (e) { report.errors.push(`${c.path}: not recorded (${msg(e)})`); }
  }
  if (!p.retry.length) return report;
  // Counted over every missing beat, the excluded calls' too: that many at once is the beats, not a boot.
  if (report.missing.length > MAX_RETRIES) {
    report.errors.push(`${report.missing.length} of ${p.due} due calls wrote no beat by ${(checkedMs / 1000).toFixed(1)} s: beats are not being written (a deploy in flight, or the table refusing them), not a worker that failed to start; nothing is run again`);
    await d.report("edge-watchdog.beats", { message: report.errors.at(-1), context: { minute: minuteIso, missing: report.missing } });
    return report;
  }
  // A call whose retry wrote no beat in the last `HOLD_MS` is held: run again every minute, it would run twice every minute.
  let held = new Set<string>();
  try {
    held = new Set((await d.rest.select<{ path: string }>(RETRY_TABLE, `outcome=eq.no_beat&minute=gte.${enc(iso(minute - HOLD_MS))}&select=path`)).map((r) => r.path));
  } catch (e) { report.errors.push(`recent retries unreadable (${msg(e)}); none held`); }
  for (const c of p.retry.filter((x) => held.has(x.path))) {
    try { await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "held" }, "minute,path"); } catch { /* the report says it */ }
    report.held.push(c.path);
  }
  const results = await Promise.all(p.retry.filter((x) => !held.has(x.path)).map((c) => retryOne(d, c, minuteIso)));
  report.retried = results.filter((r): r is RetryResult => r !== null);
  const bad = report.retried.filter((r) => r.outcome === "failed" || r.outcome === "no_beat");
  if (bad.length) {
    const line = bad.map((r) => `${r.path} ${r.outcome}${r.status !== null ? ` ${r.status}` : ""}${r.detail ? `: ${r.detail.slice(0, 120)}` : ""}`).join(" | ");
    await d.report("edge-watchdog.retry", { message: `run again at ${minuteIso.slice(11, 16)} after no beat, and ${line}`.slice(0, 500), context: { minute: minuteIso, retries: bad } });
  }
  return report;
}

// ------------------------------------------------------------------------------------------------------------- I/O

/** The database over PostgREST with the service key: the three calls the watchdog makes, each with a timeout. */
export function makeRest(sbUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Rest {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const send = async (method: string, path: string, body?: unknown, prefer?: string) => {
    const res = await fetchImpl(`${sbUrl}/rest/v1/${path}`, {
      method, headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : [];
  };
  return {
    select: (table, query) => send("GET", `${table}?${query}`),
    claim: (table, row, onConflict) => send("POST", `${table}?on_conflict=${onConflict}`, row, "resolution=ignore-duplicates,return=representation"),
    update: async (table, query, patch) => { await send("PATCH", `${table}?${query}`, patch, "return=minimal"); },
  };
}

/** The URL a list row's call goes to: the job's own, the Edge host and the row's path. */
export const retryUrl = (sbUrl: string, path: string) => `${sbUrl}/functions/v1/${path}`;

/** The retry as the job sends the call: POST, the cron bearer, JSON, an empty object; given up after the call's own timeout. */
export function makeCall(sbUrl: string, cronSecret: string, fetchImpl: typeof fetch = fetch): WatchdogDeps["call"] {
  return async (path, timeoutMs) => {
    const res = await fetchImpl(retryUrl(sbUrl, path), {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  };
}

/** The cron bearer, compared in constant time. */
export function isCron(req: Request, cronSecret: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return cronSecret !== "" && auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7).trim(), cronSecret);
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A request's way through: the bearer, the beat, then the minute's work. Exported so the order is pinned: the watchdog
 * writes its own beat first, as every call of the job does, so a minute it did not start in shows.
 */
export async function handle(req: Request, deps: {
  cronSecret: string; beat: (key: string) => Promise<unknown>; run: () => Promise<WatchdogReport>; keep?: (p: Promise<unknown>) => void;
}): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!isCron(req, deps.cronSecret)) return json(401, { error: "unauthorised" });
  await deps.beat(beatKeyOfRequest("edge-watchdog", req.url)).catch(() => false);
  const work = deps.run();
  deps.keep?.(work.catch(() => {}));
  return json(200, await work);
}

/** `EdgeRuntime.waitUntil` where the runtime has it: the worker is kept until the minute's retries have answered. */
function keepAlive(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try { rt?.waitUntil?.(p); } catch { /* without it the request itself waits */ }
}

if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL") ?? "", cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    return await handle(req, {
      cronSecret,
      beat: (key) => writeBeat(key),
      run: () => runWatchdog({
        rest: makeRest(sbUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        call: makeCall(sbUrl, cronSecret),
        report: (kind, o) => reportServerError(kind, o),
      }),
      keep: keepAlive,
    });
  } catch (e) {
    await reportServerError("edge-watchdog.crash", { message: msg(e) });
    return json(500, { error: "edge-watchdog crashed", message: msg(e).slice(0, 200) });
  }
});
