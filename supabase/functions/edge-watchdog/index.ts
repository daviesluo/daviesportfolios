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
//   * Only what the job sent. A row the job holds back until its `active_from` (0104: a call added in the same push as
//     the code it calls waits 15 minutes for the deploy) is not due here either, so it is never missing, and never run
//     again on code that may not know it yet.
//   * Only a few, unless the minute shows the beats are being written. More than `MAX_RETRIES` due calls with no beat,
//     and not one due call with a beat, is beats not being written (a deploy in flight, the table refusing them), not
//     workers not starting: nothing is run again, and it is reported. The five failures the ledger recorded on 2026-10-01
//     fell in five different minutes; from about 06:00 UTC on 2026-10-26 the platform has served several of the minute's
//     `agents` calls from one worker in eu-west-2 (workers per call fell from about 0.6 to 0.25), and a worker that fails
//     to start now answers 503 BOOT_ERROR to 5–9 calls at once, in 5–11 minutes an hour. The other calls' beats in the
//     same minute show the table takes them, so those calls are run again (`beatsUnwritten`): before, each such minute
//     was lost whole, PR5's live executor (`agents?action=quotes`) with it in 74 of 1,128 minutes to 2026-10-27 00:47.
//   * A call whose retry answered and still wrote no beat under the key looked for would be run twice every minute; it is
//     reported, and not run again for `HOLD_MS`.
//   * A watchdog that starts more than `LATE_MS` into its minute is in a batch that began late (reference §4 item 39
//     measured batches beginning within 0.44 s of their minute), so it runs nothing again: a retry from past :20 would
//     run into the next minute's call. Its own boot failing loses only that minute's retries.
//
// It also SENDS the calls whose row has a second over 0 (`offset_s`, 0191; Davies, 2026-10-31: "做"). pg_net 0.20's worker
// takes a batch whole and reads its queue again only when every request of it has answered (0063), so a second job queuing
// at :10 would wait behind `books`' 45 s: spreading the minute's calls over seconds cannot be done from SQL. This function is
// in the job's batch at :00 and holds no pg_net slot while it waits, so it sends each such row at its second, by the same
// request the job makes (`makeCall`: URL, cron bearer, JSON, `{}`, the row's own timeout), and awaits it; and it looks for
// that row's beat `CHECK_AT_MS` after its second (`checkAtFor`), not at 13 s, so the retry still comes once, keyed to the
// minute, after the row's own start. A row whose beat is already there when its second comes (the job sent it: a job older
// than 0191, or a request by hand) is not sent again. A watchdog that starts late sends what is within `DISPATCH_GRACE_MS`
// of its second and runs nothing again. If the watchdog itself does not start, that minute's rows with a second over 0 are
// not sent (its beat was missing in 4 of 4,235 minutes to 2026-10-31 08:30 UTC). A row's second is a migration's
// (`update public.edge_calls set offset_s = …`), and the table keeps every row inside its minute
// (`offset_s * 1000 + timeout_ms < 60000`).
//
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
/**
 * More due calls than this with no beat (those the list excludes counted too), when no due call wrote one, and nothing
 * is run again: see the header and `beatsUnwritten`.
 */
export const MAX_RETRIES = 4;
/** A call whose retry answered and wrote no beat is not run again for this long. */
export const HOLD_MS = 10 * 60_000;

/**
 * A row of `edge_calls`, as the job reads it. `active_from` (0104): the job makes the call from that instant; null, or
 * absent while 0104 is not yet applied, is always.
 */
export type EdgeCall = {
  path: string; timeout_ms: number; every_minutes: number; last_utc_hour: number; enabled: boolean; retry: boolean;
  active_from?: string | null;
  /** 0191: the second of its minute it is sent at; 0 or absent, the job's own request (`offsetOf`). */
  offset_s?: number | null;
};
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
  /** 0191: the calls it sent at their seconds, or did not and why. */
  dispatched?: DispatchResult[];
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

/**
 * Is the call due in the minute that starts at `minuteMs`? The job's own filter (0075), row for row, and from 0104 not
 * before the row's `active_from`. The job compares it with its own `now()`, a fraction of a second into the minute; this
 * with the minute's start, so a row is due here from the first minute that begins at or after it: never a minute the
 * job held the call back (a row added in the same push as its function, held 15 minutes for the deploy), at most its
 * first minute counted out when its instant falls in that fraction. An instant that cannot be read is not yet due.
 */
export function isDue(c: EdgeCall, minuteMs: number): boolean {
  const at = new Date(minuteMs);
  return c.enabled && activeBy(c, minuteMs) && at.getUTCMinutes() % c.every_minutes === 0 && at.getUTCHours() <= c.last_utc_hour;
}

/** Whether the job makes the call by `ms`: from its `active_from` on, and always when it has none (0104). */
export function activeBy(c: EdgeCall, ms: number): boolean {
  if (c.active_from === null || c.active_from === undefined) return true;
  const from = Date.parse(c.active_from);
  return Number.isFinite(from) && from <= ms;
}

/** The minute's due calls with no beat: those to run again, and those the list says not to. Never the watchdog. */
export function plan(calls: EdgeCall[], beats: Iterable<string>, minuteMs: number): { due: number; retry: EdgeCall[]; excluded: EdgeCall[] } {
  const have = new Set(beats);
  const due = calls.filter((c) => c.path !== WATCHDOG_PATH && isDue(c, minuteMs));
  const missing = due.filter((c) => !have.has(beatKeyOfPath(c.path)));
  return { due: due.length, retry: missing.filter((c) => c.retry), excluded: missing.filter((c) => !c.retry) };
}

/**
 * Whether the minute's missing beats are beats not being written rather than workers that did not start: more than
 * `MAX_RETRIES` missing and no due call's beat at all. One due call's beat in the minute is the table taking them, and
 * then any number missing is a boot failure, run again.
 */
export function beatsUnwritten(due: number, missing: number): boolean {
  return missing > MAX_RETRIES && missing >= due;
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

/**
 * A retry's claim: its row in `edge_call_retries` before anything is sent. `true`: claimed, to be sent; null: already run
 * again this minute, by another run; a result: not sent, the claim having failed.
 */
async function claimRetry(d: WatchdogDeps, c: EdgeCall, minuteIso: string): Promise<true | null | RetryResult> {
  try {
    const claimed = await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "sent" }, "minute,path");
    return claimed.length ? true : null;
  } catch (e) {
    return { path: c.path, outcome: "failed", status: null, ms: null, detail: `not sent: the retry could not be claimed (${msg(e)})` };
  }
}

/**
 * The minute's retries of one second: claimed together (awaited, so they go out at the check's instant), then sent together,
 * the promise of their results returned without waiting on them.
 */
async function startRetries(d: WatchdogDeps, cs: EdgeCall[], minuteIso: string): Promise<{ done: Promise<(RetryResult | null)[]> }> {
  const claims = await Promise.all(cs.map((c) => claimRetry(d, c, minuteIso)));
  // Wrapped: an async function's promise of a promise would wait on the retries themselves.
  return {
    done: Promise.all(cs.map((c, i) => {
      const k = claims[i];
      return k === true ? sendRetry(d, c, minuteIso) : Promise.resolve(k);
    })),
  };
}

/** One call run again once claimed: sent, awaited within its own timeout, its beat read, and the outcome recorded. */
async function sendRetry(d: WatchdogDeps, c: EdgeCall, minuteIso: string): Promise<RetryResult> {
  const where = `minute=eq.${enc(minuteIso)}&path=eq.${enc(c.path)}`;
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

/**
 * A row's second (0191): how far into its minute it is sent. 0, or absent while 0191 is not applied, is the job's own
 * request at the top of the minute; more is this function's (`runWatchdog`), so the minute's `agents` calls do not all
 * boot in one second. The table holds it to `offset_s * 1000 + timeout_ms < 60 000`.
 */
export const offsetOf = (c: EdgeCall): number => {
  const s = Math.trunc(Number(c.offset_s ?? 0));
  return Number.isFinite(s) && s > 0 ? s : 0;
};
/**
 * A row sent at its second is sent up to this long after it, when the watchdog itself started late; later than that it
 * is not sent this minute (`late` in the answer), so a call never starts far from where its minute and timeout put it.
 */
export const DISPATCH_GRACE_MS = 5_000;
/** When a row's own missing beat is looked for: `CHECK_AT_MS` after its second, and `AFTER_ARRIVAL_MS` after the watchdog started. */
export const checkAtFor = (arrivedMs: number, offsetS: number): number =>
  Math.max(minuteOf(arrivedMs) + offsetS * 1_000 + CHECK_AT_MS, arrivedMs + AFTER_ARRIVAL_MS);

/** The minute's due calls the watchdog sends at their seconds: offset over 0, never itself, in their seconds' order, then the list's. */
export function dispatchPlan(calls: EdgeCall[], minuteMs: number): EdgeCall[] {
  return calls.map((c, i) => ({ c, i })).filter(({ c }) => c.path !== WATCHDOG_PATH && offsetOf(c) > 0 && isDue(c, minuteMs))
    .sort((a, b) => offsetOf(a.c) - offsetOf(b.c) || a.i - b.i).map(({ c }) => c);
}

/** What became of a call sent at its second: its answer (null when none came), or why it was not sent. */
export type DispatchResult = { path: string; offsetS: number; sentMs: number | null; status: number | null; ms: number | null; detail: string | null };

/** One call sent at its second, as the job would send it, awaited within its own timeout. Its beat says it started; nothing is recorded. */
async function dispatchOne(d: WatchdogDeps, c: EdgeCall, minute: number): Promise<DispatchResult> {
  const t0 = d.now();
  const out: DispatchResult = { path: c.path, offsetS: offsetOf(c), sentMs: t0 - minute, status: null, ms: null, detail: null };
  try {
    const r = await d.call(c.path, c.timeout_ms);
    out.status = r.status;
    if (!isOk(r.status)) out.detail = r.body.slice(0, 300);
  } catch (e) {
    out.detail = msg(e);
  }
  out.ms = d.now() - t0;
  return out;
}

/**
 * One minute of the watchdog. Never throws past its own reads: what fails is in `errors`, and reported.
 *
 * Its minute is one line of events in time order (0191): each row with a second over 0 is SENT at it (`dispatchPlan`),
 * and each second's rows are CHECKED for a beat `CHECK_AT_MS` later (`checkAtFor`), the job's own rows (second 0) at
 * 13 s as before. A call sent is not awaited before the next event; every answer is, before the watchdog answers.
 */
export async function runWatchdog(d: WatchdogDeps): Promise<WatchdogReport> {
  const arrived = d.now(), minute = minuteOf(arrived), minuteIso = iso(minute);
  const report: WatchdogReport = {
    minute: minuteIso, arrivedMs: arrived - minute, checkedMs: null, due: 0, beats: 0, missing: [], retried: [], excluded: [], held: [], errors: [],
  };
  const late = arrived - minute > LATE_MS;
  const lateLine = `started ${((arrived - minute) / 1000).toFixed(1)} s into its minute: a late batch, nothing is run again`;

  // The list, read once as the watchdog starts: the calls it sends at their seconds, and those it looks for.
  let calls: EdgeCall[];
  try {
    // Every column, not a list: a column named that the table does not have yet is PostgREST's 400, and this function
    // and the migration that adds one (0104's `active_from`, 0191's `offset_s`) land in either order.
    calls = await d.rest.select<EdgeCall>(LIST_TABLE, "select=*&order=id.asc");
  } catch (e) {
    if (late) return { ...report, skipped: lateLine, errors: [`the list is unreadable (${msg(e)}); nothing is sent at its second this minute`] };
    report.errors.push(`the list or the beats are unreadable (${msg(e)}); nothing is run again this minute`);
    await d.report("edge-watchdog.unreadable", { message: report.errors[0], context: { minute: minuteIso } });
    return report;
  }
  const toSend = dispatchPlan(calls, minute);
  if (late) {
    report.skipped = lateLine;
    if (!toSend.length) return report;
  }

  type Ev = { at: number; kind: "send"; call: EdgeCall } | { at: number; kind: "check"; offsetS: number };
  const events: Ev[] = toSend.map((call) => ({ at: minute + offsetOf(call) * 1_000, kind: "send" as const, call }));
  if (!late) {
    const seconds = [...new Set([0, ...toSend.map(offsetOf)])];
    for (const s of seconds) events.push({ at: checkAtFor(arrived, s), kind: "check", offsetS: s });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === "send" ? -1 : 1));

  const sent: Promise<DispatchResult>[] = [], skippedSends: DispatchResult[] = [], retries: Promise<(RetryResult | null)[]>[] = [];
  let beatsBefore: Set<string> | null = null, unwritten = false, held: Set<string> | null = null, firstCheck = true;
  const readBeats = () => d.rest.select<{ path: string }>(BEAT_TABLE, `minute=eq.${enc(minuteIso)}&select=path`).then((rows) => rows.map((r) => r.path));

  for (const ev of events) {
    const wait = ev.at - d.now();
    if (wait > 0) await d.sleep(wait);
    if (ev.kind === "send") {
      const c = ev.call, none = { path: c.path, offsetS: offsetOf(c), sentMs: null, status: null, ms: null };
      if (d.now() > ev.at + DISPATCH_GRACE_MS) { skippedSends.push({ ...none, detail: `late: ${((d.now() - minute) / 1000).toFixed(1)} s into its minute, not sent` }); continue; }
      // A call the job sent itself this minute (a job older than 0191, a request fired by hand) has its beat: not sent twice.
      if (beatsBefore === null) beatsBefore = new Set(await readBeats().catch(() => [] as string[]));
      if (beatsBefore.has(beatKeyOfPath(c.path))) { skippedSends.push({ ...none, detail: "its beat is there already: the job sent it" }); continue; }
      sent.push(dispatchOne(d, c, minute));
      continue;
    }
    // A check: the due rows of one second with no beat, run again once as ever.
    const rows = calls.filter((c) => offsetOf(c) === ev.offsetS);
    const checkedMs = d.now() - minute;
    if (firstCheck) report.checkedMs = checkedMs;
    let beats: string[];
    try {
      beats = await readBeats();
    } catch (e) {
      report.errors.push(`the list or the beats are unreadable (${msg(e)}); nothing is run again this minute`);
      if (firstCheck) await d.report("edge-watchdog.unreadable", { message: report.errors.at(-1), context: { minute: minuteIso } });
      firstCheck = false;
      continue;
    }
    const p = plan(rows, beats, minute);
    report.due += p.due;
    report.beats = beats.length;
    const missing = [...p.retry, ...p.excluded].map((c) => c.path);
    report.missing.push(...missing);
    // Recorded, never run: the calls the list says not to run again.
    for (const c of p.excluded) {
      try {
        await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "excluded" }, "minute,path");
        report.excluded.push(c.path);
      } catch (e) { report.errors.push(`${c.path}: not recorded (${msg(e)})`); }
    }
    // Counted over every missing beat, the excluded calls' too: that many at once, with no due call's beat, is the beats, not
    // a boot. With one, it is a worker that served several calls and did not start, and they are run again (the header).
    // Judged on the job's own rows, the many; a later second's few are run again unless that judgement was made.
    if (firstCheck && p.retry.length && beatsUnwritten(p.due, missing.length)) {
      unwritten = true;
      report.errors.push(`${missing.length} of ${p.due} due calls wrote no beat by ${(checkedMs / 1000).toFixed(1)} s: beats are not being written (a deploy in flight, or the table refusing them), not a worker that failed to start; nothing is run again`);
      await d.report("edge-watchdog.beats", { message: report.errors.at(-1), context: { minute: minuteIso, missing } });
    }
    firstCheck = false;
    if (!p.retry.length || unwritten) continue;
    // A call whose retry wrote no beat in the last `HOLD_MS` is held: run again every minute, it would run twice every minute.
    if (held === null) {
      try {
        held = new Set((await d.rest.select<{ path: string }>(RETRY_TABLE, `outcome=eq.no_beat&minute=gte.${enc(iso(minute - HOLD_MS))}&select=path`)).map((r) => r.path));
      } catch (e) { held = new Set(); report.errors.push(`recent retries unreadable (${msg(e)}); none held`); }
    }
    const h = held;
    for (const c of p.retry.filter((x) => h.has(x.path))) {
      try { await d.rest.claim(RETRY_TABLE, { minute: minuteIso, path: c.path, outcome: "held" }, "minute,path"); } catch { /* the report says it */ }
      report.held.push(c.path);
    }
    retries.push((await startRetries(d, p.retry.filter((x) => !h.has(x.path)), minuteIso)).done);
  }

  report.retried = (await Promise.all(retries)).flat().filter((r): r is RetryResult => r !== null);
  const dispatched = [...(await Promise.all(sent)), ...skippedSends];
  if (dispatched.length) report.dispatched = dispatched;
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
