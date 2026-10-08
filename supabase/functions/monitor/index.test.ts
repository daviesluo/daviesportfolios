// Pins the monitor function: PR5's dead-man (stale past three minutes, or unreadable with no fresh read in the last three
// minutes → every resting order cancelled and read back, nothing placed; fresh, or unreadable inside that grace → nothing
// at the venue), its record, the health readings and their limits, the
// reports into the errors box, and the shared secret. The venue is the fake Revolut X of `agents/testing.ts`, driven
// through the real client (`_shared/revx.ts`): it lands a cancel a read after its 204, as the venue was measured, and can
// lose a cancel. The database double serves PostgREST's paths and refuses what the schema refuses: 0052's columns and
// checks on `agent_quote_live_events`, the kinds 0086 allows read from the migration itself.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { FakeRevx } from "../agents/testing.ts";
import { QUOTE_LIVE_CANCEL_REREAD_MS } from "../agents/quotes_live.ts";
import { REVX_KEY_NAMES } from "../agents/index.ts";
import {
  ago, cancelEvery, DEADMAN_CANCEL_REREAD_MS, DEADMAN_DEADLINE_MS, DEADMAN_GRACE_AHEAD_MS, DEADMAN_GRACE_MS, DEADMAN_READ_RETRY_MS, DEADMAN_STALE_MS,
  type DeadmanReport, type DeadmanVenue, graceOf, judge,
  PR5_KEY_NAMES, pr5KeyFrom, readState, readStateOnce, recordRows, revxDeadmanVenue, runDeadman, type StateRead, summary, writeRecord,
} from "./deadman.ts";
import { DB_SIZE_PATH, DB_SIZE_WATCH_BYTES, HEALTH_LIMITS_S, HEALTH_NAMES, HEALTH_QUERIES, judgeHealth, type Reading, runHealth, TICK_BEAT_KEY } from "./health.ts";
import { handle, type HandlerDeps, insertReports, isAuthorised, lastFreshOf, reportRows, SECRET_HEADER } from "./index.ts";

const T0 = Date.parse("2026-10-02T13:05:02Z");
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const ENV = { apiKey: "k".repeat(64), privateKey: KEY.privateKey };
const SB = "https://db.test";

// ---------------------------------------------------------------------------------------------------- the doubles

/**
 * The kinds `agent_quote_live_events` takes: 0052's, and once 0086 is applied `deadman` too. The Edge tests run without
 * file access, so the lists are written here and `src/monitor_worker.test.js` holds them to the two migrations' own text.
 */
const KINDS_0052 = ["skip", "guard", "stop_unfilled", "loss_stop"];
const KINDS_0086 = ["skip", "guard", "stop_unfilled", "loss_stop", "deadman"];

type Row = Record<string, unknown>;
/**
 * PostgREST over the four tables the function touches, as the schema has them: an unknown column is a 400, and an events
 * row is held to 0052's checks and 0086's kinds. `down` makes every request throw, as a database that does not answer.
 */
function fakeRest(o: { state?: Row[]; locks?: Row[]; beats?: Row[]; decisions?: Row[]; dbBytes?: number } = {}) {
  const t: Record<string, Row[]> = {
    agent_quote_live_state: o.state ?? [], agent_locks: o.locks ?? [], edge_call_beats: o.beats ?? [], agent_decisions: o.decisions ?? [],
    agent_quote_live_events: [], ops_errors: [],
  };
  const COLS: Record<string, string[]> = {
    agent_quote_live_state: ["id", "state", "updated_at", "last_error"], agent_locks: ["name", "lease_until", "holder"],
    edge_call_beats: ["minute", "path", "ts"], agent_decisions: ["id", "ts", "strategy_id"],
    agent_quote_live_events: ["mode", "minute", "book", "rung_side", "k", "kind", "detail"],
    ops_errors: ["id", "created_at", "kind", "symbol", "message", "context", "ip"],
  };
  const s = { down: false, status: 0, calls: [] as string[], t };
  const refuse = (row: Row, table: string): string | null => {
    for (const c of Object.keys(row)) if (!COLS[table].includes(c)) return `Could not find the '${c}' column of '${table}' in the schema cache`;
    if (table === "ops_errors") return row.kind == null ? `null value in column "kind" of relation "ops_errors" violates not-null constraint` : null;
    if (table !== "agent_quote_live_events") return null;
    for (const c of ["mode", "minute", "book", "rung_side", "k", "kind", "detail"]) if (row[c] == null) return `null value in column "${c}" violates not-null constraint`;
    const chk = (c: string, ok: boolean) => ok ? null : `new row for relation "agent_quote_live_events" violates check constraint "agent_quote_live_events_${c}_check"`;
    return chk("mode", ["dry_run", "live"].includes(String(row.mode))) ?? chk("book", ["USDC-GBP", "USDT-GBP", "-"].includes(String(row.book)))
      ?? chk("rung_side", ["bid", "ask", "-"].includes(String(row.rung_side))) ?? chk("kind", KINDS_0086.includes(String(row.kind)));
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const u = new URL(String(input)), method = (init?.method ?? "GET").toUpperCase();
    s.calls.push(`${method} ${u.pathname.replace("/rest/v1/", "")}${u.search}`);
    if (s.down) throw new TypeError("error sending request: connection refused");
    if (s.status) return new Response(JSON.stringify({ message: "upstream" }), { status: s.status });
    const table = u.pathname.replace("/rest/v1/", "");
    // 0101's `db_size_bytes()`, as PostgREST answers a function returning a bigint: the bare number.
    if (table === "rpc/db_size_bytes" && method === "GET") return new Response(JSON.stringify(o.dbBytes ?? 1_160_000_000), { status: 200 });
    if (!(table in t)) return new Response(JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${table}'` }), { status: 404 });
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      const rows: Row[] = Array.isArray(body) ? body : [body];
      for (const r of rows) { const bad = refuse(r, table); if (bad) return new Response(JSON.stringify({ message: bad }), { status: 400 }); }
      t[table].push(...rows.map((r) => ({ ...r })));
      return new Response(null, { status: 201 });
    }
    // GET: `select` of known columns, `eq` filters, `order` and `limit`, as the function asks.
    let rows = [...t[table]];
    let cols: string[] = COLS[table];
    for (const [k, v] of u.searchParams) {
      if (k === "select") { cols = v.split(","); for (const c of cols) if (!COLS[table].includes(c)) return new Response(JSON.stringify({ message: `column ${table}.${c} does not exist` }), { status: 400 }); }
      else if (k === "order") { const [c, dir] = v.split("."); rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
      else if (k === "limit") rows = rows.slice(0, Number(v));
      else if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else return new Response(JSON.stringify({ message: `unexpected parameter ${k}` }), { status: 400 });
    }
    return new Response(JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))), { status: 200 });
  };
  return Object.assign(s, { fetch });
}

/** PR5's sub-account on the fake venue with orders resting: six bids, three asks and a conversion, on both books. */
async function restingWorld() {
  const clock = { now: T0 };
  const rx = new FakeRevx(() => clock.now);
  rx.postsPerSecond = null;                                       // the setup places ten at one instant
  rx.balances = { GBP: 120, USDC: 40, USDT: 40 };
  const place = revxVenue(ENV, rx.fetch, REVX_REGION, () => clock.now);
  const book = [
    ["USDC/GBP", "buy", "0.7540"], ["USDC/GBP", "buy", "0.7533"], ["USDC/GBP", "buy", "0.7525"],
    ["USDT/GBP", "buy", "0.7538"], ["USDT/GBP", "buy", "0.7531"], ["USDT/GBP", "buy", "0.7523"],
    ["USDC/GBP", "sell", "0.7560"], ["USDT/GBP", "sell", "0.7559"], ["USDT/GBP", "sell", "0.7566"],
    ["USDC/GBP", "buy", "0.7549"],                                // a conversion resting at the bid
  ] as const;
  for (const [symbol, side, price] of book) {
    const r = await place.placeLimit({ clientOrderId: crypto.randomUUID(), symbol, side, base: "10.00000", price });
    assert(r.ok, JSON.stringify(r));
  }
  assertEquals(rx.resting().length, 10);
  return { clock, rx, setupCalls: rx.calls.length };
}

/** A dead-man run with every dependency given, the pauses recorded. */
function deps(o: { read: StateRead | (() => Promise<StateRead>); venue?: DeadmanVenue | null; note?: string; rest?: ReturnType<typeof fakeRest>; clock?: { now: number }; lastFreshAt?: string | null }) {
  const pauses: number[] = [];
  const rest = o.rest ?? fakeRest();
  const clock = o.clock ?? { now: T0 };
  let venueLoads = 0;
  return {
    pauses, rest, venueLoads: () => venueLoads,
    d: {
      now: () => clock.now,
      readState: typeof o.read === "function" ? o.read : () => Promise.resolve(o.read as StateRead),
      lastFreshAt: o.lastFreshAt,
      venue: () => { venueLoads++; return Promise.resolve({ venue: o.venue ?? null, note: o.venue ? null : (o.note ?? "REVOLUT_X_API_KEY_2 missing") }); },
      record: (r: DeadmanReport) => writeRecord(r, SB, "service-key", rest.fetch),
      pause: (ms: number) => { pauses.push(ms); return Promise.resolve(); },
    },
  };
}
const posts = (rx: FakeRevx, from: number) => rx.calls.slice(from).filter((c) => c.startsWith("POST "));

// ---------------------------------------------------------------------------------------------------- the dead-man

Deno.test("judge: fresh up to three minutes, stale past them; no row, a bad time or a failed read is unreadable", () => {
  assertEquals(DEADMAN_STALE_MS, 180_000);
  const at = (ageMs: number): StateRead => ({ ok: true, updatedAt: iso(T0 - ageMs) });
  assertEquals(judge(at(35e3), T0).verdict, "fresh");                    // a turn at :27 of the minute before
  assertEquals(judge(at(155e3), T0).verdict, "fresh");                   // two turns missed
  assertEquals(judge(at(180e3), T0).verdict, "fresh");                   // the line itself
  assertEquals(judge(at(180e3 + 1), T0).verdict, "stale");               // three missed
  assertEquals(judge(at(-5e3), T0).verdict, "fresh");                    // a clock a little ahead is not stale
  const stale = judge(at(4 * 60e3 + 12e3), T0);
  assertEquals([stale.ageS, stale.stateAt], [252, iso(T0 - 252e3)]);
  assert(stale.why.includes("4 min 12 s ago") && stale.why.includes("13:00:50 UTC"), stale.why);
  assertEquals(judge({ ok: true, updatedAt: null }, T0).verdict, "unreadable");
  assertEquals(judge({ ok: true, updatedAt: "not a time" }, T0).verdict, "unreadable");
  assertEquals(judge({ ok: false, error: "timed out" }, T0).verdict, "unreadable");
  assertEquals([ago(35), ago(252), ago(3900)], ["35 s", "4 min 12 s", "1 h 05 min"]);
});

Deno.test("readState: one failed read is tried once more after a pause; two failures are 'cannot be read at all'", async () => {
  const answers: StateRead[] = [{ ok: false, error: "timed out" }, { ok: true, updatedAt: iso(T0 - 30e3) }];
  const pauses: number[] = [];
  const r = await readState(() => Promise.resolve(answers.shift()!), (ms) => { pauses.push(ms); return Promise.resolve(); });
  assertEquals([r, pauses], [{ ok: true, updatedAt: iso(T0 - 30e3) }, [DEADMAN_READ_RETRY_MS]]);
  let n = 0;
  const bad = await readState(() => { n++; return Promise.resolve({ ok: false, error: "503" }); }, () => Promise.resolve());
  assertEquals([bad.ok, n], [false, 2]);
  // Against the database double: the row as PostgREST serves it, a missing row, an error, and no answer at all.
  const rest = fakeRest({ state: [{ id: 1, updated_at: "2026-10-02T13:04:26.504+00:00", state: {}, last_error: null }] });
  assertEquals(await readStateOnce(SB, "service-key", rest.fetch), { ok: true, updatedAt: "2026-10-02T13:04:26.504+00:00" });
  assertEquals(rest.calls, ["GET agent_quote_live_state?id=eq.1&select=updated_at"]);
  assertEquals(await readStateOnce(SB, "service-key", fakeRest().fetch), { ok: true, updatedAt: null });
  rest.status = 503;
  assertEquals((await readStateOnce(SB, "service-key", rest.fetch)).ok, false);
  rest.status = 0; rest.down = true;
  assertEquals((await readStateOnce(SB, "service-key", rest.fetch)).ok, false);
  assertEquals((await readStateOnce("", "", rest.fetch)).ok, false);
});

Deno.test("fresh: nothing reaches the venue — no list, no cancel, not even the key — and nothing is recorded", async () => {
  const w = await restingWorld();
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 35e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.listed, r.orders, r.recorded], ["fresh", false, null, [], null]);
  assertEquals([w.rx.calls.length, x.venueLoads(), x.rest.calls], [w.setupCalls, 0, []]);
  assertEquals(w.rx.resting().length, 10);
});

Deno.test("stale: every resting order — bids, asks and a conversion, both books — is cancelled and read back cancelled; nothing is placed; it is recorded", async () => {
  const w = await restingWorld();
  assertEquals(w.rx.cancelLagReads, 1);                                   // the venue as measured: a cancel lands a read after its 204
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 252e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.listed, r.error], ["stale", true, 10, null]);
  assertEquals(r.orders.map((o) => o.outcome), Array(10).fill("cancelled"));
  assertEquals(w.rx.resting(), []);
  // Each read back straight after its DELETE still says `new`, so it is read again after the executor's first pause.
  assertEquals(x.pauses, Array(10).fill(DEADMAN_CANCEL_REREAD_MS[0]));
  assertEquals(posts(w.rx, w.setupCalls), []);                             // never an order placed
  assertEquals(w.rx.calls.slice(w.setupCalls).filter((c) => c.startsWith("DELETE ")).length, 10);
  // The record, as the schema takes it: one event row of kind `deadman` and one `monitor.deadman` row in the errors box.
  assertEquals(r.recorded, { events: true, ops: true });
  const [ev] = x.rest.t.agent_quote_live_events;
  assertEquals([ev.mode, ev.minute, ev.book, ev.rung_side, ev.k, ev.kind], ["live", "2026-10-02T13:05:00.000Z", "-", "-", 0, "deadman"]);
  assertEquals((ev.detail as { orders: unknown[] }).orders.length, 10);
  const [op] = x.rest.t.ops_errors;
  assertEquals([op.kind, op.symbol, op.ip], ["monitor.deadman", "pr5", "monitor"]);
  assertEquals(op.message, "PR5's executor last finished a turn 4 min 12 s ago (13:00:50 UTC); the dead-man cancelled 10 of 10 resting orders");
});

Deno.test("unreadable: a state that cannot be read at all cancels as a stale one does", async () => {
  const w = await restingWorld();
  const x = deps({ read: { ok: false, error: "AbortError: the signal timed out" }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length], ["unreadable", 10, 0]);
});

// The grace on an unreadable state (Davies, 2026-10-07, "读不到时看上次"), in the shapes of that day's stall: of the dead-man's
// 48 firings, 45 were "state could not be read (Signal timed out.)" while the executor had turned within two minutes, and
// 3 were a stale state that had been read (04:07, 17:03, 19:35: the last turn 3 min 31 s, 3 min 24 s, 3 min 36 s before).
const TIMED_OUT: StateRead = { ok: false, error: "Signal timed out." };

Deno.test("grace: an unreadable state is held only while the last fresh read is three minutes old or less, and not ahead of the clock", () => {
  assertEquals([DEADMAN_GRACE_MS, DEADMAN_GRACE_AHEAD_MS], [180_000, 5_000]);
  const g = (ageMs: number) => graceOf(iso(T0 - ageMs), T0);
  assertEquals([g(60e3).hold, g(120e3).hold, g(180e3).hold, g(180e3 + 1).hold, g(240e3).hold], [true, true, true, false, false]);
  assertEquals([g(0).hold, g(-5e3).hold, g(-5e3 - 1).hold], [true, true, false]);       // drift between two machines, not a minute ahead
  assertEquals(g(120e3), { hold: true, ageS: 120, why: "a read 2 min 00 s ago found it fresh (the grace is 3 min 00 s)" });
  assertEquals(g(240e3), { hold: false, ageS: 240, why: "no read in the last 3 min 00 s found it fresh (the last 4 min 00 s ago)" });
  assertEquals(graceOf(null, T0), { hold: false, ageS: null, why: "the monitor remembers no read that found it fresh" });
  assertEquals([graceOf(undefined, T0).hold, graceOf("", T0).hold, graceOf("not a time", T0).hold], [false, false, false]);
});

Deno.test("10-07: unreadable with a fresh read 2 min ago is held — nothing listed, cancelled or even keyed at the venue — and its reason is recorded", async () => {
  const w = await restingWorld();
  const x = deps({ read: TIMED_OUT, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt: iso(T0 - 120e3) });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.listed, r.orders, r.error], ["held", false, null, [], null]);
  assertEquals(r.why, "PR5's executor state could not be read (Signal timed out.); held, nothing cancelled: a read 2 min 00 s ago found it fresh (the grace is 3 min 00 s)");
  assertEquals([r.lastFreshAt, r.grace], [iso(T0 - 120e3), { hold: true, ageS: 120, why: "a read 2 min 00 s ago found it fresh (the grace is 3 min 00 s)" }]);
  assertEquals([w.rx.calls.length, x.venueLoads(), w.rx.resting().length], [w.setupCalls, 0, 10]);
  // Recorded in the errors box only: the events table is for what was done on the account, and nothing was.
  assertEquals([r.recorded, x.rest.t.agent_quote_live_events.length, x.rest.t.ops_errors.length], [{ events: false, ops: true }, 0, 1]);
  const [op] = x.rest.t.ops_errors;
  assertEquals([op.kind, op.symbol, op.message], ["monitor.deadman", "pr5", r.why]);
  assertEquals(op.context, { verdict: "held", stateAt: null, ageS: null, lastFreshAt: iso(T0 - 120e3), graceAgeS: 120, listed: null, outcomes: [] });
  assertEquals(summary(r), r.why);
});

Deno.test("10-07: unreadable with the last fresh read 4 min ago cancels every resting order, and says the grace had run out", async () => {
  const w = await restingWorld();
  const x = deps({ read: TIMED_OUT, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt: iso(T0 - 240e3) });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length], ["unreadable", true, 10, 0]);
  assertEquals(summary(r), "PR5's executor state could not be read (Signal timed out.); no read in the last 3 min 00 s found it fresh (the last 4 min 00 s ago); the dead-man cancelled 10 of 10 resting orders");
  const [ev] = x.rest.t.agent_quote_live_events;
  assertEquals([(ev.detail as Row).verdict, (ev.detail as Row).lastFreshAt, (ev.detail as Row).graceAgeS], ["unreadable", iso(T0 - 240e3), 240]);
});

Deno.test("10-07: unreadable and never found fresh (the Worker sent nothing) cancels, as before the grace", async () => {
  for (const lastFreshAt of [null, undefined]) {
    const w = await restingWorld();
    const r = await runDeadman(deps({ read: TIMED_OUT, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt }).d);
    assertEquals([r.verdict, r.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length], ["unreadable", 10, 0]);
    assert(r.why.endsWith("the monitor remembers no read that found it fresh"), r.why);
  }
});

Deno.test("10-07: a stale state that was read cancels at once, whatever the last fresh read; so do a missing row and a time that does not parse", async () => {
  // 17:03: the state read, the last turn 3 min 24 s before; a fresh read 60 s ago does not hold it.
  for (const read of [{ ok: true, updatedAt: iso(T0 - 204e3) }, { ok: true, updatedAt: null }, { ok: true, updatedAt: "not a time" }] as StateRead[]) {
    const w = await restingWorld();
    const r = await runDeadman(deps({ read, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt: iso(T0 - 60e3) }).d);
    assertEquals([r.grace, r.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length], [null, 10, 0], JSON.stringify(read));
    assert(r.verdict === "stale" || r.verdict === "unreadable", r.verdict);
  }
});

Deno.test("10-07: fresh does nothing, whatever the memory says", async () => {
  const w = await restingWorld();
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 35e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt: iso(T0 - 600e3) });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.grace, r.recorded, w.rx.calls.length, x.venueLoads(), x.rest.calls], ["fresh", false, null, null, w.setupCalls, 0, []]);
});

Deno.test("a long outage still ends in a cancel: fresh at :00, the database unreadable from the next minute — held three minutes, cancelled at the fourth", async () => {
  const w = await restingWorld();
  // The Worker's part, as it runs: it sends what it remembers and stores the `at` of each fresh answer.
  let remembered: string | null = null;
  const minute = async (n: number, read: StateRead) => {
    w.clock.now = T0 + n * 60e3;
    const r = await runDeadman(deps({ read, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock, lastFreshAt: remembered }).d);
    if (r.verdict === "fresh") remembered = r.at;
    return r;
  };
  const first = await minute(0, { ok: true, updatedAt: iso(T0 - 30e3) });
  assertEquals([first.verdict, remembered], ["fresh", iso(T0)]);
  const seen: string[] = [];
  for (let n = 1; n <= 4; n++) seen.push((await minute(n, TIMED_OUT)).verdict);
  assertEquals(seen, ["held", "held", "held", "unreadable"]);           // 60, 120 and 180 s held; 240 s cancels
  assertEquals(w.rx.resting().length, 0);
  // And on: nothing new is remembered while it cannot read, so every later minute cancels what the executor re-posted.
  assertEquals([(await minute(5, TIMED_OUT)).verdict, remembered], ["unreadable", iso(T0)]);
});

Deno.test("a cancel the venue does not carry out is reported open after both re-reads — never counted cancelled; the next minute asks again", async () => {
  const w = await restingWorld();
  w.rx.cancelMode = "lost";                                                // 204, and the order stays on the book
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 600e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals(r.orders.map((o) => o.outcome), Array(10).fill("open"));
  assertEquals(x.pauses, Array(10).fill([...DEADMAN_CANCEL_REREAD_MS]).flat());
  assert(summary(r).endsWith("the dead-man cancelled 0 of 10 resting orders, 10 still open on the venue"), summary(r));
  w.rx.cancelMode = "ok";
  const again = await runDeadman(deps({ read: { ok: true, updatedAt: iso(T0 - 660e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock }).d);
  assertEquals([again.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length], [10, 0]);
});

Deno.test("an order that part-filled before its cancel is read back filled, and the rest of the book cancelled", async () => {
  const w = await restingWorld();
  const first = w.rx.resting()[0];
  w.rx.fillResting(first.id, 4);                                           // a taker took 4 of its 10 while the executor was down
  const r = await runDeadman(deps({ read: { ok: true, updatedAt: iso(T0 - 400e3) }, venue: revxDeadmanVenue(ENV, w.rx.fetch), clock: w.clock }).d);
  const o = r.orders.find((x) => x.id === first.id)!;
  assertEquals([o.outcome, o.readState, o.readFilled], ["filled", "filled", 4]);
  assertEquals([r.orders.filter((x) => x.outcome === "cancelled").length, w.rx.resting().length], [9, 0]);
  assert(summary(r).includes("1 had filled"), summary(r));
});

Deno.test("a cancel the rate limit turns away (429) is sent once more after a second", async () => {
  const w = await restingWorld();
  let refuse = 1;
  const f: typeof fetch = (i, init) => {
    if ((init?.method ?? "GET") === "DELETE" && refuse-- > 0) return Promise.resolve(new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 }));
    return w.rx.fetch(i, init);
  };
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 400e3) }, venue: revxDeadmanVenue(ENV, f), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals([r.orders.filter((o) => o.outcome === "cancelled").length, w.rx.resting().length, x.pauses[0]], [10, 0, 1_000]);
});

Deno.test("without PR5's key nothing can be cancelled: it says so, and records nothing (the Worker alerts instead)", async () => {
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 400e3) }, venue: null, note: "REVOLUT_X_PRIVATE_KEY_2 missing" });
  const r = await runDeadman(x.d);
  assertEquals([r.verdict, r.acted, r.recorded], ["stale", false, null]);
  assertEquals(r.error, "PR5's Revolut X key is not loaded (REVOLUT_X_PRIVATE_KEY_2 missing): nothing can be cancelled");
  assertEquals(x.rest.calls, []);
});

Deno.test("an active list that cannot be read cancels nothing, and is recorded; one with nothing on it does nothing", async () => {
  const w = await restingWorld();
  const down: typeof fetch = (i, init) => new URL(String(i)).pathname === "/api/1.0/orders/active"
    ? Promise.resolve(new Response(JSON.stringify({ message: "Service unavailable" }), { status: 503 })) : w.rx.fetch(i, init);
  const x = deps({ read: { ok: true, updatedAt: iso(T0 - 400e3) }, venue: revxDeadmanVenue(ENV, down), clock: w.clock });
  const r = await runDeadman(x.d);
  assertEquals([r.acted, r.listed, r.orders.length, w.rx.resting().length], [true, null, 0, 10]);
  assertEquals(r.error, "the resting orders could not be listed (503 Service unavailable): nothing was cancelled");
  assertEquals([r.recorded, x.rest.t.ops_errors.length], [{ events: true, ops: true }, 1]);
  // Nothing resting: nothing to cancel and nothing to record.
  const empty = new FakeRevx(() => T0);
  const y = deps({ read: { ok: true, updatedAt: iso(T0 - 400e3) }, venue: revxDeadmanVenue(ENV, empty.fetch) });
  const e = await runDeadman(y.d);
  assertEquals([e.acted, e.listed, e.recorded, y.rest.calls], [false, 0, null, []]);
});

Deno.test("past its deadline no cancel is started; the rest are reported for the next minute", async () => {
  const w = await restingWorld();
  const v = revxDeadmanVenue(ENV, w.rx.fetch);
  const list = await v.listActive();
  assert(list.ok);
  let t = T0;
  const out = await cancelEvery(v, list.orders, { pause: () => Promise.resolve(), clock: () => (t += 9_000), deadline: T0 + DEADMAN_DEADLINE_MS });
  // The clock moves 9 s at each look: orders 1–4 start before 40 s, the rest after it.
  assertEquals(out.map((o) => o.outcome), [...Array(4).fill("cancelled"), ...Array(6).fill("skipped")]);
  assertEquals(w.rx.resting().length, 6);
});

Deno.test("with the database down the cancels are done all the same, and the report says nothing was recorded", async () => {
  const w = await restingWorld();
  const rest = fakeRest();
  rest.down = true;
  const r = await runDeadman(deps({ read: { ok: false, error: "connection refused" }, venue: revxDeadmanVenue(ENV, w.rx.fetch), rest, clock: w.clock }).d);
  assertEquals([r.verdict, w.rx.resting().length, r.recorded], ["unreadable", 0, { events: false, ops: false }]);
});

Deno.test("the record is what the schema takes: 0086 adds `deadman` to 0052's kinds and changes nothing else", () => {
  assertEquals(KINDS_0086, [...KINDS_0052, "deadman"]);
  const r: DeadmanReport = {
    verdict: "stale", ageS: 252, stateAt: iso(T0 - 252e3), why: "w", at: iso(T0), lastFreshAt: null, grace: null, acted: true, listed: 1, error: null, recorded: null,
    orders: [{ id: "rx-1", clientOrderId: "c", symbol: "USDC/GBP", side: "buy", price: "0.7540", quantity: "10", filled: "0", state: "new", outcome: "cancelled", readState: "cancelled", readFilled: 0, cancelAnswer: "204" }],
  };
  const { event, ops } = recordRows(r);
  assertEquals(Object.keys(event).sort(), ["book", "detail", "k", "kind", "minute", "mode", "rung_side"]);
  assertEquals(Object.keys(ops).sort(), ["context", "ip", "kind", "message", "symbol"]);
  assert(String(ops.message).length <= 512);
});

Deno.test("PR5's key is read by the executor's own names, as envAny reads them", () => {
  assertEquals(PR5_KEY_NAMES.apiKey, [...REVX_KEY_NAMES.revx2.apiKey]);
  assertEquals(PR5_KEY_NAMES.priv, [...REVX_KEY_NAMES.revx2.priv]);
  const env = (m: Record<string, string>) => (n: string) => m[n];
  assertEquals(pr5KeyFrom(env({ Revolut_X_API_kEY_2: " id ", REVOLUT_X_PRIVATE_KEY_2: " pem " })), { apiKey: "id", priv: "pem" });
  assertEquals(pr5KeyFrom(env({ REVOLUT_X_API_KEY_2: "  ", Revolut_X_API_kEY_2: "b", Revolut_X_Private_Key_2: "p" })), { apiKey: "b", priv: "p" });
  assertEquals(pr5KeyFrom(env({ REVOLUT_X_PRIVATE_KEY_2: "p" })), { error: "REVOLUT_X_API_KEY_2 missing" });
  assertEquals(pr5KeyFrom(env({ REVOLUT_X_API_KEY_2: "a" })), { error: "REVOLUT_X_PRIVATE_KEY_2 missing" });
});

Deno.test("a cancel is read again after the executor's own pauses", () => {
  assertEquals([...DEADMAN_CANCEL_REREAD_MS], [...QUOTE_LIVE_CANCEL_REREAD_MS]);
});

// ---------------------------------------------------------------------------------------------------- health

Deno.test("health: each reading against its limit — three minutes for the minute's, 75 for the decisions; a failed read fails", () => {
  assertEquals(HEALTH_LIMITS_S, { tickBeat: 180, tickTurn: 180, quotes: 180, decisions: 4500 });
  const ok: Record<string, Reading> = {
    tickBeat: { ok: true, at: iso(T0 - 62e3) }, tickTurn: { ok: true, at: iso(T0 + 50e3) },   // a turn in flight holds its lease ahead
    quotes: { ok: true, at: iso(T0 - 35e3) }, decisions: { ok: true, at: iso(T0 - 65 * 60e3) },
  };
  const h = judgeHealth(T0, ok as never);
  assertEquals([h.ok, h.checks.tickBeat.ageS, h.checks.tickTurn.ageS, h.checks.decisions.ageS], [true, 62, -50, 3900]);
  for (const name of HEALTH_NAMES) {
    const late = judgeHealth(T0, { ...ok, [name]: { ok: true, at: iso(T0 - (HEALTH_LIMITS_S[name] + 1) * 1e3) } } as never);
    assertEquals([late.ok, late.checks[name].ok], [false, false], name);
    const failed = judgeHealth(T0, { ...ok, [name]: { ok: false, error: "503" } } as never);
    assertEquals([failed.ok, failed.checks[name].error], [false, "503"], name);
    const none = judgeHealth(T0, { ...ok, [name]: { ok: true, at: null } } as never);
    assertEquals([none.ok, none.checks[name].error], [false, "nothing recorded"], name);
  }
});

Deno.test("health: the four reads go to the tick's beat, its lease, PR5's state and the newest decision, read-only", async () => {
  // 10-02, 13:05:02 UTC, inside the stall: the tick last started at 12:57, PR5's executor last finished at 12:57:27.
  const rest = fakeRest({
    beats: [{ minute: "2026-10-02T12:57:00+00:00", path: TICK_BEAT_KEY }, { minute: "2026-10-02T13:05:00+00:00", path: "monitor?action=deadman" }],
    locks: [{ name: "tick", lease_until: "2026-10-02T12:57:00.558+00:00", holder: null }, { name: "quotes-live", lease_until: "2026-10-02T13:04:00+00:00", holder: null }],
    state: [{ id: 1, updated_at: "2026-10-02T12:57:27.000+00:00" }],
    decisions: [{ id: 1440, ts: "2026-10-02T12:00:03.728+00:00" }, { id: 1441, ts: "2026-10-02T12:00:04.001+00:00" }],
  });
  const h = await runHealth(SB, "service-key", () => T0, rest.fetch);
  assertEquals(rest.calls.every((c) => c.startsWith("GET ")), true);
  assertEquals(rest.calls.sort(), [...Object.values(HEALTH_QUERIES).map((q) => `GET ${q.path}`), `GET ${DB_SIZE_PATH}`].sort());
  // 13:05:02 less 12:57:00, 12:57:00.558, 12:57:27 and 12:00:04.001 (the newest decision by id).
  assertEquals([h.checks.tickBeat.ageS, h.checks.tickTurn.ageS, h.checks.quotes.ageS, h.checks.decisions.ageS], [482, 481, 455, 3898]);
  assertEquals([h.ok, h.checks.tickBeat.ok, h.checks.quotes.ok, h.checks.decisions.ok], [false, false, false, true]);
  // The monitor's own beat is not the tick's: a fresh one beside a stale tick does not make the loop look alive.
  assertEquals(h.checks.tickBeat.at, "2026-10-02T12:57:00.000Z");
  rest.down = true;
  const down = await runHealth(SB, "service-key", () => T0, rest.fetch);
  assertEquals([down.ok, HEALTH_NAMES.every((n) => down.checks[n].error)], [false, true]);
});

// The database's size beside the four readings (review F4, 0101): shown, and never failing the loop's reading.
Deno.test("health: the database's size is read beside the four and never fails them, over its watch line or unread", async () => {
  const fresh = { beats: [{ minute: iso(T0 - 30e3), path: TICK_BEAT_KEY }], locks: [{ name: "tick", lease_until: iso(T0 + 20e3), holder: "x" }],
    state: [{ id: 1, updated_at: iso(T0 - 20e3) }], decisions: [{ id: 1, ts: iso(T0 - 600e3) }] };
  const small = await runHealth(SB, "service-key", () => T0, fakeRest({ ...fresh, dbBytes: 1_160_000_000 }).fetch);
  assertEquals([small.ok, small.size], [true, { ok: true, bytes: 1_160_000_000, limitBytes: DB_SIZE_WATCH_BYTES, over: false }]);
  const big = await runHealth(SB, "service-key", () => T0, fakeRest({ ...fresh, dbBytes: 4_200_000_000 }).fetch);
  assertEquals([big.ok, big.size?.ok && big.size.over], [true, true]);
  const refused = fakeRest(fresh);
  const f: typeof fetch = (input, init) => String(input).includes("/rpc/") ? Promise.resolve(new Response('{"message":"permission denied"}', { status: 401 })) : refused.fetch(input, init);
  const unread = await runHealth(SB, "service-key", () => T0, f);
  assertEquals([unread.ok, unread.size?.ok], [true, false]);
  assertEquals(DB_SIZE_WATCH_BYTES, 4_000_000_000);
});

// ---------------------------------------------------------------------------------------------------- reports and auth

Deno.test("reports: the monitor's own kinds only, each field clipped as ops-error clips a client's; the database's refusal is a 503", async () => {
  const ok = reportRows({ reports: [{ kind: "monitor.alert", check: "loop", message: "x".repeat(600), context: { at: "t" } }, { kind: "monitor.recovered", message: "back" }] });
  assert(ok.ok);
  assertEquals(ok.rows.map((r) => [r.kind, r.symbol, r.message?.length, r.ip]), [["monitor.alert", "loop", 512, "monitor"], ["monitor.recovered", null, 4, "monitor"]]);
  for (const bad of [{}, { reports: [] }, { reports: [{ kind: "agents.crash" }] }, { reports: [{ kind: "monitor." }] }, { reports: Array(51).fill({ kind: "monitor.alert" }) }]) {
    assertEquals(reportRows(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  }
  const big = reportRows({ reports: [{ kind: "monitor.alert", context: { blob: "y".repeat(3000) } }] });
  assert(big.ok);
  assertEquals(big.rows[0].context, { _truncated: true });
  const rest = fakeRest();
  assertEquals(await insertReports(ok.rows, SB, "service-key", rest.fetch), { ok: true });
  assertEquals(rest.t.ops_errors.length, 2);
  rest.down = true;
  assertEquals((await insertReports(ok.rows, SB, "service-key", rest.fetch)).ok, false);
});

Deno.test("isAuthorised: the shared secret, compared as SHA-256 digests; missing or empty on either side refuses", async () => {
  const secret = "a".repeat(64);
  assertEquals(await isAuthorised(secret, secret), true);
  assertEquals(await isAuthorised("a".repeat(63) + "b", secret), false);
  assertEquals(await isAuthorised("a".repeat(65), secret), false);
  assertEquals(await isAuthorised(null, secret), false);
  assertEquals(await isAuthorised("", ""), false);
  assertEquals(await isAuthorised(secret, ""), false);
});

Deno.test("handle: POST only, the secret before anything, the beat beside the dead-man, and each action's answer", async () => {
  const seen: string[] = [];
  const report = { verdict: "fresh" } as DeadmanReport;
  const d: HandlerDeps = {
    secret: "s3cret",
    beat: (k) => { seen.push(`beat ${k}`); return Promise.resolve(true); },
    deadman: (last) => { seen.push(`deadman ${last}`); return Promise.resolve(report); },
    health: () => { seen.push("health"); return Promise.resolve({ at: "t", ok: true, checks: {} as never }); },
    insert: (rows) => { seen.push(`insert ${rows.length}`); return Promise.resolve(rows.length > 1 ? { ok: false, error: "503" } : { ok: true }); },
  };
  const req = (action: string, o: { method?: string; secret?: string | null; body?: unknown } = {}) => new Request(`https://x.test/functions/v1/monitor?action=${action}`, {
    method: o.method ?? "POST",
    headers: o.secret === null ? {} : { [SECRET_HEADER]: o.secret ?? "s3cret" },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
  assertEquals((await handle(req("deadman", { method: "GET" }), d)).status, 405);
  assertEquals((await handle(req("deadman", { secret: null }), d)).status, 401);
  assertEquals((await handle(req("deadman", { secret: "wrong" }), d)).status, 401);
  assertEquals(seen, []);                                                  // refused before any work, and before the beat
  const r = await handle(req("deadman"), d);
  assertEquals([r.status, await r.json()], [200, report]);
  assertEquals(seen.splice(0).sort(), ["beat monitor?action=deadman", "deadman null"]);
  // The Worker's memory rides in the body; a body without it, or with something that is not a time, is no grace.
  await handle(req("deadman", { body: { lastFreshAt: "2026-10-07T17:01:00.512Z" } }), d);
  await handle(req("deadman", { body: {} }), d);
  await handle(req("deadman", { body: { lastFreshAt: "soon" } }), d);
  assertEquals(seen.splice(0).filter((x) => x.startsWith("deadman")), ["deadman 2026-10-07T17:01:00.512Z", "deadman null", "deadman null"]);
  assertEquals([lastFreshOf(null), lastFreshOf({ lastFreshAt: 5 }), lastFreshOf({ lastFreshAt: "x".repeat(41) })], [null, null, null]);
  assertEquals((await handle(req("health"), d)).status, 200);
  assertEquals(seen.splice(0), ["health"]);
  const one = await handle(req("report", { body: { reports: [{ kind: "monitor.alert", message: "m" }] } }), d);
  assertEquals([one.status, await one.json()], [200, { inserted: 1 }]);
  const two = await handle(req("report", { body: { reports: [{ kind: "monitor.alert" }, { kind: "monitor.recovered" }] } }), d);
  assertEquals(two.status, 503);                                           // the Worker keeps them queued
  assertEquals((await handle(req("report", { body: { reports: [{ kind: "ops.other" }] } }), d)).status, 400);
  assertEquals((await handle(req("nothing"), d)).status, 404);
});
