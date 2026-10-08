// Pins the watchdog: the job's filter in code, the minute's due calls less its beats, the wait to 13 s, one retry per
// call and minute whoever asks, the call's own path and timeout, what is recorded and what is reported, the calls it
// never runs again, the late batch, and the request it sends. The database double holds the three tables with their
// keys, columns and the outcome CHECK, and refuses what PostgREST would (`Rest`).
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  activeBy, AFTER_ARRIVAL_MS, CHECK_AT_MS, checkAt, classify, type EdgeCall, handle, HOLD_MS, isCron, isDue, LATE_MS, makeCall, makeRest, MAX_RETRIES, plan,
  type Rest, retryUrl, runWatchdog, WATCHDOG_PATH, type WatchdogDeps, type WatchdogReport,
} from "./index.ts";
import { beatKeyOfPath, minuteOf } from "../_shared/beats.ts";

/** 0075's seed, in its order (src/cron_jobs.test.js pins it against the migration). */
const LIST: EdgeCall[] = [
  ["agents?action=tick", 50000, 1, 23, true], ["agents?action=quotes", 58000, 1, 23, true], ["agents?action=quotesv", 58000, 1, 23, true],
  ["agents?action=quotesd", 58000, 1, 23, true], ["agents?action=books", 58000, 1, 23, true], ["agents?action=pmrw", 58000, 1, 23, false],
  ["agents?action=pmrw-e", 58000, 1, 23, true], ["agents?action=pmrw-x", 58000, 1, 23, true], ["agents?action=pmrwc", 58000, 1, 23, false],
  ["agents?action=pmrwc-e", 58000, 1, 23, true], ["agents?action=pmrwc-x", 58000, 1, 23, true], ["agents?action=views", 59000, 1, 23, true],
  ["agents?action=pmlive&forceFunctionRegion=eu-west-1", 58000, 1, 23, true], ["agents?action=pmrw-select", 290000, 5, 23, true],
  ["agents?action=pmrwc-select", 290000, 5, 23, true], ["snapshot-record", 25000, 5, 23, true], ["overnight-record", 9000, 5, 9, true],
  ["edge-watchdog", 58000, 1, 23, false],
].map(([path, timeout_ms, every_minutes, last_utc_hour, retry]) => ({ path, timeout_ms, every_minutes, last_utc_hour, enabled: true, retry }) as EdgeCall);

const T = (iso: string) => Date.parse(iso);
const MINUTE = T("2026-10-01T15:01:00Z");                           // an ordinary minute: thirteen calls and the watchdog
const dueKeys = (minuteMs: number, calls = LIST) => calls.filter((c) => c.path !== WATCHDOG_PATH && isDue(c, minuteMs)).map((c) => beatKeyOfPath(c.path));

// ---------------------------------------------------------------------------------------------------- the doubles

type Row = Record<string, unknown>;
const COLS: Record<string, string[]> = {
  edge_calls: ["id", "path", "timeout_ms", "every_minutes", "last_utc_hour", "enabled", "retry", "active_from"],
  edge_call_beats: ["minute", "path", "ts"],
  edge_call_retries: ["minute", "path", "claimed_at", "outcome", "status", "ms", "detail"],
};
const KEYS: Record<string, string> = { edge_calls: "path", edge_call_beats: "minute,path", edge_call_retries: "minute,path" };
const OUTCOMES = ["sent", "ok", "failed", "running", "no_beat", "excluded", "held"];

/** The three tables, refusing an unknown table or column, a conflict target that is not the key, and an outcome the CHECK refuses. */
function fakeDb(calls: EdgeCall[] = LIST) {
  const t: Record<string, Row[]> = { edge_calls: calls.map((c, i) => ({ id: i + 1, ...c })), edge_call_beats: [], edge_call_retries: [] };
  let reads = 0, failSelect: string | null = null;
  const table = (name: string) => {
    if (!t[name]) throw new Error(`GET ${name} → 404: {"code":"PGRST205","message":"Could not find the table 'public.${name}'"}`);
    return t[name];
  };
  const col = (name: string, c: string) => { if (!COLS[name].includes(c)) throw new Error(`${name} → 400: column ${name}.${c} does not exist`); };
  const checkRow = (name: string, row: Row) => {
    for (const c of Object.keys(row)) col(name, c);
    if (name === "edge_call_retries" && "outcome" in row && !OUTCOMES.includes(String(row.outcome))) throw new Error(`23514: edge_call_retries_outcome_check (${row.outcome})`);
  };
  const parse = (name: string, query: string) => {
    const filters: { c: string; op: string; v: string }[] = [];
    let select: string[] | null = null, order: string | null = null, limit = Infinity;
    for (const part of query.split("&")) {
      const i = part.indexOf("="), k = part.slice(0, i), v = part.slice(i + 1);
      if (k === "select" && v === "*") select = null;                // every column the table has, as PostgREST
      else if (k === "select") { select = v.split(","); select.forEach((c) => col(name, c)); }
      else if (k === "order") { order = v.split(".")[0]; col(name, order); }
      else if (k === "limit") limit = Number(v);
      else { col(name, k); const j = v.indexOf("."); filters.push({ c: k, op: v.slice(0, j), v: decodeURIComponent(v.slice(j + 1)) }); }
    }
    return { filters, select, order, limit };
  };
  const match = (r: Row, f: { c: string; op: string; v: string }) => {
    if (f.op === "eq") return String(r[f.c]) === f.v;
    if (f.op === "gte") return String(r[f.c]) >= f.v;
    throw new Error(`operator ${f.op} not used here`);
  };
  const rest: Rest = {
    select: <X>(name: string, query: string) => {
      reads++;
      if (failSelect === name) return Promise.reject(new Error(`GET ${name} → 503: upstream`));
      try {
        const q = parse(name, query);
        let rows = table(name).filter((r) => q.filters.every((f) => match(r, f)));
        if (q.order) rows = [...rows].sort((a, b) => (Number(a[q.order!]) || 0) - (Number(b[q.order!]) || 0));
        return Promise.resolve(rows.slice(0, q.limit).map((r) => (q.select ? Object.fromEntries(q.select.map((c) => [c, r[c]])) : { ...r })) as X[]);
      } catch (e) { return Promise.reject(e); }
    },
    claim: <X>(name: string, row: Row, onConflict: string) => {
      try {
        table(name);
        if (onConflict !== KEYS[name]) throw new Error(`42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`);
        checkRow(name, row);
        const key = onConflict.split(",");
        if (t[name].some((r) => key.every((k) => r[k] === row[k]))) return Promise.resolve([] as X[]);
        const stored = { ...row };
        t[name].push(stored);
        return Promise.resolve([{ ...stored }] as X[]);
      } catch (e) { return Promise.reject(e); }
    },
    update: (name: string, query: string, patch: Row) => {
      try {
        const q = parse(name, query);
        checkRow(name, patch);
        for (const r of table(name)) if (q.filters.every((f) => match(r, f))) Object.assign(r, patch);
        return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    },
  };
  return { t, rest, reads: () => reads, failSelectOn: (name: string) => { failSelect = name; } };
}
type Db = ReturnType<typeof fakeDb>;

/** A beat as a function writes it. */
const beat = (db: Db, minuteMs: number, key: string) => {
  const minute = new Date(minuteOf(minuteMs)).toISOString();
  if (!db.t.edge_call_beats.some((r) => r.minute === minute && r.path === key)) db.t.edge_call_beats.push({ minute, path: key, ts: "" });
};

type Answer = (path: string, timeoutMs: number, x: { db: Db; now: () => number; advance: (ms: number) => void }) => Promise<{ status: number; body: string }>;
/** The retried function starting as it should: its beat first, then its work, then 200. */
const startsAndAnswers: Answer = (path, _t, x) => { beat(x.db, x.now(), beatKeyOfPath(path)); x.advance(800); return Promise.resolve({ status: 200, body: "{}" }); };

function world(o: { at: number; db?: Db; beats?: string[]; answer?: Answer; slept?: number[] }) {
  const db = o.db ?? fakeDb();
  let now = o.at;
  for (const k of o.beats ?? dueKeys(minuteOf(o.at))) beat(db, o.at, k);
  const sent: { path: string; timeoutMs: number; at: number }[] = [];
  const reports: { kind: string; message?: string; context?: unknown }[] = [];
  const x = { db, now: () => now, advance: (ms: number) => { now += ms; } };
  const d: WatchdogDeps = {
    rest: db.rest,
    now: x.now,
    sleep: (ms) => { o.slept?.push(ms); now += ms; return Promise.resolve(); },
    call: (path, timeoutMs) => { sent.push({ path, timeoutMs, at: now }); return (o.answer ?? startsAndAnswers)(path, timeoutMs, x); },
    report: (kind, r) => { reports.push({ kind, ...r }); return Promise.resolve(); },
  };
  return { d, db, sent, reports, x };
}
const outcomes = (db: Db) => db.t.edge_call_retries.map((r) => [r.path, r.outcome, r.status]);

// ------------------------------------------------------------------------------------------------------- the rules

Deno.test("isDue — the job's filter, row for row: every minute, every fifth, the overnight recorder to 09:55, a disabled row never", () => {
  const [tick, , , , , , , , , , , , , select, , snap, night] = LIST;
  assert(isDue(tick, MINUTE));
  assert(!isDue(select, MINUTE) && isDue(select, T("2026-10-01T15:05:00Z")) && isDue(snap, T("2026-10-01T00:00:00Z")));
  assert(isDue(night, T("2026-10-01T09:55:00Z")) && !isDue(night, T("2026-10-01T10:00:00Z")) && isDue(night, T("2026-10-01T00:00:00Z")));
  assert(!isDue({ ...tick, enabled: false }, MINUTE));
  // 13 calls in an ordinary minute, 16 at a five-minute mark from 10:00, 17 before: the job's own count, the watchdog aside.
  assertEquals([dueKeys(MINUTE).length, dueKeys(T("2026-10-01T15:05:00Z")).length, dueKeys(T("2026-10-01T05:05:00Z")).length], [13, 16, 17]);
});

Deno.test("plan — the due calls with no beat, those the list keeps from a retry apart, and never the watchdog", () => {
  const all = dueKeys(MINUTE);
  assertEquals(plan(LIST, all, MINUTE), { due: 13, retry: [], excluded: [] });
  const p = plan(LIST, all.filter((k) => !["agents?action=quotes", "agents?action=pmrw", "agents?action=pmlive"].includes(k)), MINUTE);
  assertEquals(p.retry.map((c) => c.path), ["agents?action=quotes", "agents?action=pmlive&forceFunctionRegion=eu-west-1"]);
  assertEquals(p.excluded.map((c) => c.path), ["agents?action=pmrw"]);
  // No beat at all for the watchdog's own row: still not a call to run again.
  assertEquals(plan(LIST, [], MINUTE).retry.some((c) => c.path === WATCHDOG_PATH), false);
  // A five-minute call with no beat in a minute it is not due: nothing.
  assertEquals(plan(LIST, all, MINUTE).retry.length, 0);
});

Deno.test("isDue — not before the row's active_from (0104): absent or null always, from the first minute that begins at or after it", () => {
  const [tick] = LIST;
  assert(isDue(tick, MINUTE));                                                              // absent: 0104 not applied yet
  assert(isDue({ ...tick, active_from: null }, MINUTE));                                    // every row before 0104
  assert(isDue({ ...tick, active_from: "2026-10-01T14:46:00.123456+00:00" }, MINUTE));      // past, as PostgREST writes it
  assert(isDue({ ...tick, active_from: "2026-10-01T15:01:00+00:00" }, MINUTE));             // the minute's own start
  assert(!isDue({ ...tick, active_from: "2026-10-01T15:01:00.25+00:00" }, MINUTE));         // inside it: from the next
  assert(isDue({ ...tick, active_from: "2026-10-01T15:01:00.25+00:00" }, MINUTE + 60_000));
  assert(!isDue({ ...tick, active_from: "2026-10-01T15:16:00+00:00" }, MINUTE));            // a new row's 15 minutes
  assert(!isDue({ ...tick, active_from: "not an instant" }, MINUTE));                       // unreadable: not yet
  assertEquals([activeBy({ ...tick, active_from: "2026-10-01T15:01:00Z" }, MINUTE - 1), activeBy({ ...tick, active_from: "2026-10-01T15:01:00Z" }, MINUTE)], [false, true]);
});

/** A call a migration added in the same push as its code: the job makes it from 15 minutes after its row was written. */
const ADDED_AT = T("2026-10-01T14:47:20Z");
const ADDED: EdgeCall = {
  path: "agents?action=newcall", timeout_ms: 55_000, every_minutes: 1, last_utc_hour: 23, enabled: true, retry: true,
  active_from: new Date(ADDED_AT + 15 * 60_000).toISOString(),                             // 15:02:20
};

Deno.test("a row the job holds back (0104) is not due: its missing beat is not missing, and nothing runs it early", async () => {
  // 15:01, the minute before its instant: the job did not call it, so no beat, and the watchdog must not either.
  const w = world({ at: MINUTE + 300, db: fakeDb([...LIST, ADDED]) });
  const r = await runWatchdog(w.d);
  assertEquals([r.due, r.missing, w.sent, w.db.t.edge_call_retries, w.reports], [13, [], [], [], []]);
  assertEquals(plan([...LIST, ADDED], [], MINUTE).retry.some((c) => c.path === ADDED.path), false);
  // 15:02: the job's now() is a fraction of a second in, before 15:02:20, so the job holds it back again, and so does this.
  const at = MINUTE + 60_000;
  const w2 = world({ at: at + 300, db: fakeDb([...LIST, ADDED]) });
  const r2 = await runWatchdog(w2.d);
  assertEquals([r2.due, r2.missing, w2.sent], [13, [], []]);
  // 15:03, the first minute that begins after it: due, and with no beat, run again like any call.
  const on = MINUTE + 120_000;
  const w3 = world({ at: on + 300, db: fakeDb([...LIST, ADDED]) });
  const r3 = await runWatchdog(w3.d);
  assertEquals([r3.due, r3.missing, w3.sent.map((s) => [s.path, s.timeoutMs])], [14, ["agents?action=newcall"], [["agents?action=newcall", 55_000]]]);
});

Deno.test("the list is read whole (select=*), so this function and the migration adding a column land in either order", async () => {
  const w = world({ at: MINUTE + 300 });
  const queries: string[] = [];
  const read = w.d.rest.select;
  w.d.rest = { ...w.d.rest, select: (table, query) => { if (table === "edge_calls") queries.push(query); return read(table, query); } };
  await runWatchdog(w.d);
  assertEquals(queries, ["select=*&order=id.asc"]);
  // A table as it was before 0104, with no active_from at all: read, and every row due by the job's filter.
  const before = fakeDb(LIST);
  for (const r of before.t.edge_calls) delete r.active_from;
  const w2 = world({ at: MINUTE + 300, db: before, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=tick") });
  assertEquals((await runWatchdog(w2.d)).retried.map((x) => [x.path, x.outcome]), [["agents?action=tick", "ok"]]);
});

Deno.test("checkAt — 13 s into the minute, and 12 s after a watchdog that started a few seconds late", () => {
  assertEquals([CHECK_AT_MS, AFTER_ARRIVAL_MS, LATE_MS, MAX_RETRIES, HOLD_MS], [13_000, 12_000, 8_000, 4, 600_000]);
  assertEquals(checkAt(MINUTE + 300) - MINUTE, 13_000);
  assertEquals(checkAt(MINUTE + 3_000) - MINUTE, 15_000);
  assertEquals(checkAt(MINUTE + 8_000) - MINUTE, 20_000);
});

Deno.test("classify — the answer and the beat", () => {
  assertEquals(classify(200, true), "ok");
  assertEquals(classify(200, null), "ok");
  assertEquals(classify(200, false), "no_beat");
  assertEquals(classify(503, true), "failed");
  assertEquals(classify(500, false), "failed");
  assertEquals(classify(null, true), "running");
  assertEquals(classify(null, false), "failed");
  assertEquals(classify(null, null), "failed");
});

// ---------------------------------------------------------------------------------------------------- one minute

Deno.test("a minute in which every due call wrote its beat: it waits to 13 s, reads, and runs nothing again", async () => {
  const slept: number[] = [];
  const w = world({ at: MINUTE + 412, slept });
  const r = await runWatchdog(w.d);
  assertEquals(slept, [13_000 - 412]);
  assertEquals([r.due, r.checkedMs, r.missing, w.sent], [13, 13_000, [], []]);
  assertEquals([w.db.t.edge_call_retries, w.reports], [[], []]);
});

Deno.test("a call with no beat is run again once, 13 s in, by its own path and its own timeout, and recorded ok", async () => {
  const w = world({ at: MINUTE + 300, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=pmlive") });
  const r = await runWatchdog(w.d);
  assertEquals(w.sent, [{ path: "agents?action=pmlive&forceFunctionRegion=eu-west-1", timeoutMs: 58_000, at: MINUTE + 13_000 }]);
  assertEquals(r.retried.map((x) => [x.path, x.outcome, x.status, x.ms]), [["agents?action=pmlive&forceFunctionRegion=eu-west-1", "ok", 200, 800]]);
  assertEquals(w.db.t.edge_call_retries, [{ minute: "2026-10-01T15:01:00.000Z", path: "agents?action=pmlive&forceFunctionRegion=eu-west-1", outcome: "ok", status: 200, ms: 800, detail: null }]);
  assertEquals(w.reports, []);
});

Deno.test("one retry a call and minute: a second run of the watchdog in the same minute sends nothing", async () => {
  const boot503: Answer = (_p, _t, x) => { x.advance(10_400); return Promise.resolve({ status: 503, body: '{"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}' }); };
  const db = fakeDb();
  const beats = dueKeys(MINUTE).filter((k) => k !== "agents?action=tick");
  const first = world({ at: MINUTE + 200, db, beats, answer: boot503 });
  await runWatchdog(first.d);
  assertEquals(first.sent.length, 1);
  const second = world({ at: MINUTE + 900, db, beats: [], answer: boot503 });
  const r2 = await runWatchdog(second.d);
  assertEquals(second.sent, []);
  assertEquals(r2.retried, []);
  assertEquals(outcomes(db), [["agents?action=tick", "failed", 503]]);
});

Deno.test("a retry that fails too is recorded with what it answered, and reported once", async () => {
  const boot503: Answer = (_p, _t, x) => { x.advance(10_082); return Promise.resolve({ status: 503, body: '{"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}' }); };
  const w = world({ at: MINUTE + 250, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=views"), answer: boot503 });
  await runWatchdog(w.d);
  assertEquals(w.db.t.edge_call_retries.map((r) => [r.path, r.outcome, r.status, r.ms, String(r.detail).includes("BOOT_ERROR")]), [["agents?action=views", "failed", 503, 10_082, true]]);
  assertEquals(w.reports.length, 1);
  assertEquals(w.reports[0].kind, "edge-watchdog.retry");
  assert(w.reports[0].message!.includes("agents?action=views failed 503"), w.reports[0].message);
});

Deno.test("a retry not answered within the call's own timeout: running when its beat shows it started, failed and reported when not", async () => {
  const startedThenSlow: Answer = (path, timeoutMs, x) => { beat(x.db, x.now(), beatKeyOfPath(path)); x.advance(timeoutMs); return Promise.reject(new DOMException("Signal timed out.", "TimeoutError")); };
  const a = world({ at: MINUTE + 100, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=books"), answer: startedThenSlow });
  await runWatchdog(a.d);
  assertEquals(outcomes(a.db), [["agents?action=books", "running", null]]);
  assertEquals(a.db.t.edge_call_retries[0].ms, 58_000);
  assertEquals(a.reports, []);
  const neverStarted: Answer = (_p, timeoutMs, x) => { x.advance(timeoutMs); return Promise.reject(new DOMException("Signal timed out.", "TimeoutError")); };
  const b = world({ at: MINUTE + 100, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=books"), answer: neverStarted });
  await runWatchdog(b.d);
  assertEquals(outcomes(b.db), [["agents?action=books", "failed", null]]);
  assertEquals(b.reports.map((x) => x.kind), ["edge-watchdog.retry"]);
});

Deno.test("a retry answered 200 that wrote no beat is reported, and the call is held for ten minutes, not run twice a minute", async () => {
  const noBeat: Answer = (_p, _t, x) => { x.advance(300); return Promise.resolve({ status: 200, body: "{}" }); };
  const db = fakeDb();
  const missing = (m: number) => dueKeys(m).filter((k) => k !== "agents?action=quotesd");
  const w1 = world({ at: MINUTE + 100, db, beats: missing(MINUTE), answer: noBeat });
  await runWatchdog(w1.d);
  assertEquals(outcomes(db), [["agents?action=quotesd", "no_beat", 200]]);
  assertEquals(w1.reports.map((x) => x.kind), ["edge-watchdog.retry"]);
  const next = MINUTE + 60_000;
  const w2 = world({ at: next + 100, db, beats: missing(next), answer: noBeat });
  const r2 = await runWatchdog(w2.d);
  assertEquals([w2.sent, r2.held], [[], ["agents?action=quotesd"]]);
  assertEquals(db.t.edge_call_retries.at(-1)!.outcome, "held");
  const later = MINUTE + HOLD_MS + 60_000;
  const w3 = world({ at: later + 100, db, beats: missing(later), answer: noBeat });
  await runWatchdog(w3.d);
  assertEquals(w3.sent.map((s) => s.path), ["agents?action=quotesd"]);
});

Deno.test("the calls run again go out at once, not one after another", async () => {
  let inFlight = 0, most = 0;
  const together: Answer = async (path, _t, x) => {
    inFlight++; most = Math.max(most, inFlight);
    beat(x.db, x.now(), beatKeyOfPath(path));
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { status: 200, body: "{}" };
  };
  const w = world({ at: MINUTE, beats: dueKeys(MINUTE).filter((k) => !["agents?action=tick", "agents?action=quotes"].includes(k)), answer: together });
  await runWatchdog(w.d);
  assertEquals([w.sent.length, most], [2, 2]);
});

Deno.test(`more than ${MAX_RETRIES} due calls with no beat is not a failed boot: nothing is run again, and it is reported`, async () => {
  const w = world({ at: MINUTE + 100, beats: dueKeys(MINUTE).slice(0, 8) });
  const r = await runWatchdog(w.d);
  assertEquals(w.sent, []);
  assertEquals(r.missing.length, 5);
  assertEquals(w.reports.map((x) => x.kind), ["edge-watchdog.beats"]);
  // Four is still a boot failure each: all four run again.
  const four = world({ at: MINUTE + 100, beats: dueKeys(MINUTE).filter((k) => !["agents?action=tick", "agents?action=quotes", "agents?action=books", "agents?action=views"].includes(k)) });
  await runWatchdog(four.d);
  assertEquals(four.sent.length, 4);
});

Deno.test("RW's and RW-C's paper engines with no beat are recorded excluded: never run again, never reported", async () => {
  const w = world({ at: MINUTE + 100, beats: dueKeys(MINUTE).filter((k) => k !== "agents?action=pmrw" && k !== "agents?action=pmrwc") });
  const r = await runWatchdog(w.d);
  assertEquals(w.sent, []);
  assertEquals(r.excluded, ["agents?action=pmrw", "agents?action=pmrwc"]);
  assertEquals(outcomes(w.db), [["agents?action=pmrw", "excluded", undefined], ["agents?action=pmrwc", "excluded", undefined]]);
  assertEquals(w.reports, []);
});

Deno.test("the five-minute calls are looked for at their minutes only, the overnight recorder until 09:55 UTC", async () => {
  const at = T("2026-10-01T09:55:00Z"), five = ["agents?action=pmrw-select", "agents?action=pmrwc-select", "snapshot-record", "overnight-record"];
  const w = world({ at: at + 100, beats: dueKeys(at).filter((k) => !five.includes(k)) });
  await runWatchdog(w.d);
  assertEquals(w.sent.map((s) => [s.path, s.timeoutMs]), [["agents?action=pmrw-select", 290_000], ["agents?action=pmrwc-select", 290_000], ["snapshot-record", 25_000], ["overnight-record", 9_000]]);
  const ten = T("2026-10-01T10:00:00Z");
  const w2 = world({ at: ten + 100, beats: dueKeys(ten).filter((k) => !five.includes(k)) });
  await runWatchdog(w2.d);
  assertEquals(w2.sent.map((s) => s.path), ["agents?action=pmrw-select", "agents?action=pmrwc-select", "snapshot-record"]);
});

Deno.test("a watchdog that starts more than 8 s into its minute reads nothing and runs nothing again", async () => {
  const slept: number[] = [];
  const w = world({ at: MINUTE + 8_001, beats: [], slept });
  const r = await runWatchdog(w.d);
  assert(r.skipped?.includes("late batch"), r.skipped);
  assertEquals([slept, w.db.reads(), w.sent], [[], 0, []]);
  const onTime = world({ at: MINUTE + 8_000 });
  assertEquals((await runWatchdog(onTime.d)).checkedMs, 20_000);
});

Deno.test("a list or beats it cannot read: nothing is run again, and it is reported", async () => {
  const w = world({ at: MINUTE + 100, beats: [] });
  w.db.failSelectOn("edge_call_beats");
  const r = await runWatchdog(w.d);
  assertEquals(w.sent, []);
  assert(r.errors[0].includes("unreadable"));
  assertEquals(w.reports.map((x) => x.kind), ["edge-watchdog.unreadable"]);
});

// ------------------------------------------------------------------------------------------------------------- I/O

Deno.test("makeCall — the job's request: POST, the cron bearer, JSON, {}, to the Edge host and the row's path", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const f: typeof fetch = (url, init) => { seen.push({ url: String(url), init: init! }); return Promise.resolve(new Response('{"ok":true}', { status: 200 })); };
  const call = makeCall("https://flmvxigozjuizpckllvk.supabase.co", "s3cret", f);
  assertEquals(await call("agents?action=pmlive&forceFunctionRegion=eu-west-1", 58_000), { status: 200, body: '{"ok":true}' });
  assertEquals(seen[0].url, "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=pmlive&forceFunctionRegion=eu-west-1");
  assertEquals(retryUrl("https://h", "snapshot-record"), "https://h/functions/v1/snapshot-record");
  assertEquals(seen[0].init.method, "POST");
  assertEquals(seen[0].init.headers, { Authorization: "Bearer s3cret", "Content-Type": "application/json" });
  assertEquals(seen[0].init.body, "{}");
});

Deno.test("makeCall — a retry is given up after the call's own timeout, and not before", async () => {
  const hung: typeof fetch = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)));
  const t0 = Date.now();
  await assertRejects(() => makeCall("https://h", "s", hung)("agents?action=tick", 60), DOMException);
  const took = Date.now() - t0;
  assert(took >= 55 && took < 1_000, `gave up after ${took} ms`);
  // A slower answer inside the timeout is awaited.
  const slow: typeof fetch = () => new Promise((res) => setTimeout(() => res(new Response("{}", { status: 200 })), 40));
  assertEquals((await makeCall("https://h", "s", slow)("agents?action=tick", 500)).status, 200);
});

Deno.test("makeRest — the claim inserts unless the key is taken and returns what it wrote; a refusal throws", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const f: typeof fetch = (url, init) => { seen.push({ url: String(url), init: init! }); return Promise.resolve(new Response(init?.method === "POST" ? "[]" : "", { status: 200 })); };
  const rest = makeRest("https://x.supabase.co", "k", f);
  assertEquals(await rest.claim("edge_call_retries", { minute: "m", path: "p", outcome: "sent" }, "minute,path"), []);
  assertEquals(seen[0].url, "https://x.supabase.co/rest/v1/edge_call_retries?on_conflict=minute,path");
  assertEquals((seen[0].init.headers as Record<string, string>).Prefer, "resolution=ignore-duplicates,return=representation");
  await rest.update("edge_call_retries", "minute=eq.m&path=eq.p", { outcome: "ok" });
  assertEquals([seen[1].init.method, (seen[1].init.headers as Record<string, string>).Prefer], ["PATCH", "return=minimal"]);
  const refused = makeRest("https://x.supabase.co", "k", () => Promise.resolve(new Response('{"code":"PGRST205"}', { status: 404 })));
  await assertRejects(() => refused.select("edge_calls", "select=path"), Error, "404");
});

Deno.test("handle — the bearer, then the watchdog's own beat, then the minute; 405 and 401 write no beat and run nothing", async () => {
  const order: string[] = [];
  const report: WatchdogReport = { minute: "", arrivedMs: 0, checkedMs: null, due: 0, beats: 0, missing: [], retried: [], excluded: [], held: [], errors: [] };
  const deps = {
    cronSecret: "s3cret",
    beat: (key: string) => { order.push(`beat ${key}`); return Promise.resolve(true); },
    run: () => { order.push("run"); return Promise.resolve(report); },
    keep: () => { order.push("keep"); },
  };
  const url = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/edge-watchdog";
  const ok = await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), deps);
  assertEquals([ok.status, order], [200, ["beat edge-watchdog", "run", "keep"]]);
  order.length = 0;
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer nope" } }), deps)).status, 401);
  assertEquals((await handle(new Request(url, { method: "GET", headers: { Authorization: "Bearer s3cret" } }), deps)).status, 405);
  assertEquals(order, []);
  // A beat that throws stops nothing.
  const thrown = await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), { ...deps, beat: () => Promise.reject(new Error("db down")) });
  assertEquals([thrown.status, order], [200, ["run", "keep"]]);
  assert(isCron(new Request(url, { headers: { Authorization: "Bearer s3cret" } }), "s3cret"));
  assert(!isCron(new Request(url, { headers: { Authorization: "Bearer s3cret" } }), ""));
});
