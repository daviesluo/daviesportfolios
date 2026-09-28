// RW-C (`0069`; part 2 of the RW-NEXT pre-registration, `reviews/2026-09-27-testing-review-b-quote-tests.md` §4.4): RW's
// engine run again, forward, as a second instance with tables of its own, and RW-E's and the variants' replays run on
// its minutes. Pinned here: RW's instance is exactly the names and dates the engine had before it took one; RW-C's
// calls read nothing before its warm-up and do nothing after its fourteen days; RW-C writes RW-C's tables and never
// RW's (nor RW RW-C's); its warm-up counts nowhere; and the replays' `rw` arm equals RW-C's own day rows, the check that
// voids the result when it fails. The page's summary of it is pinned in pmrwc_view.test.ts. RW's own tests
// (pmrw.test.ts, pmrw_e.test.ts, pmrw_x.test.ts, pmrw_view.test.ts) run unchanged beside these.

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  accTotal, runPmrw, runPmrwSelect, RW_DECIDE_LAG_MS, RW_INSTANCE, RW_RUN_END, RW_RUN_START, RWC_INSTANCE, RWC_RUN_END, RWC_RUN_START,
  RWC_WARM_UP, rwPhase, type RwState,
} from "./pmrw.ts";
import { newRweState, runPmrwE, RWCE_REPLAY, RWE_CHECK_USD, RWE_REPLAY, RWE_START, type RweState } from "./pmrw_e.ts";
import { runPmrwX, RWCX_REPLAY, RWCX_SPECS, RWX_REPLAY, RWX_SPECS, type RwxStored } from "./pmrw_x.ts";
import { assertPagedOrder, type Db } from "./db.ts";
import { memDb, schemaRefusal, type Row } from "./testing.ts";
import type { PmLevel } from "../_shared/polymarket_public.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();

// ------------------------------------------------------------------------------------------------ the instances

Deno.test("RW's instance and its two replays are byte for byte the names and dates the engine and the replays had before", () => {
  assertEquals(RW_INSTANCE, {
    name: "RW",
    tables: {
      state: "pm_rw_state", selection: "pm_rw_selection", minutes: "pm_rw_minutes", prints: "pm_rw_prints", fills: "pm_rw_fills",
      days: "pm_rw_days", settlements: "pm_rw_settlements",
    },
    locks: { run: "pmrw", select: "pmrw-select" },
    runStart: Date.UTC(2026, 8, 25), runEnd: Date.UTC(2026, 9, 9), quietUntil: null,
  });
  assertEquals([RW_RUN_START, RW_RUN_END], [Date.parse("2026-09-25T00:00:00Z"), Date.parse("2026-10-09T00:00:00Z")]);
  assertEquals(RWE_REPLAY, { source: RW_INSTANCE, tables: { state: "pm_rw_e_state", days: "pm_rw_e_days" }, lock: "pmrw-e", from: Date.UTC(2026, 8, 27), quietUntil: null });
  assertEquals(RWX_REPLAY, {
    source: RW_INSTANCE, tables: { state: "pm_rw_x_state", days: "pm_rw_x_days" }, lock: "pmrw-x", specs: RWX_SPECS, eDays: "pm_rw_e_days", quietUntil: null,
  });
  // A replay's fresh state is RW's start, as it was.
  assertEquals([newRweState().lastDecided, newRweState().dayOf], [RW_RUN_START - M, RW_RUN_START]);
  assertEquals(rwPhase(Date.UTC(2026, 9, 8, 23, 59)), "run");
});

Deno.test("RW-C's instance: fourteen days from 2026-10-09 00:00 UTC, its warm-up the day before, tables and leases of its own", () => {
  assertEquals(RWC_INSTANCE, {
    name: "RW-C",
    tables: {
      state: "pm_rwc_state", selection: "pm_rwc_selection", minutes: "pm_rwc_minutes", prints: "pm_rwc_prints", fills: "pm_rwc_fills",
      days: "pm_rwc_days", settlements: "pm_rwc_settlements",
    },
    locks: { run: "pmrwc", select: "pmrwc-select" },
    runStart: Date.parse("2026-10-09T00:00:00Z"), runEnd: Date.parse("2026-10-23T00:00:00Z"), quietUntil: Date.parse("2026-10-08T00:00:00Z"),
  });
  assertEquals([RWC_RUN_START, RWC_RUN_END - RWC_RUN_START, RWC_WARM_UP], [RW_RUN_END, 14 * DAY, RWC_RUN_START - DAY]);
  assertEquals(RWCE_REPLAY, {
    source: RWC_INSTANCE, tables: { state: "pm_rwc_e_state", days: "pm_rwc_e_days" }, lock: "pmrwc-e", from: RWC_RUN_START, quietUntil: RWC_RUN_START + 2 * M,
  });
  assertEquals(RWCX_REPLAY, {
    source: RWC_INSTANCE, tables: { state: "pm_rwc_x_state", days: "pm_rwc_x_days" }, lock: "pmrwc-x", specs: RWCX_SPECS, eDays: "pm_rwc_e_days",
    quietUntil: RWC_RUN_START + RW_DECIDE_LAG_MS,
  });
  // Nothing of RW-C's is RW's: every table is `pm_rwc_…`, and no name, table or lease is shared.
  const rwNames = [...Object.values(RW_INSTANCE.tables), ...Object.values(RWE_REPLAY.tables), ...Object.values(RWX_REPLAY.tables),
    RW_INSTANCE.locks.run, RW_INSTANCE.locks.select, RWE_REPLAY.lock, RWX_REPLAY.lock];
  const rwcTables = [...Object.values(RWC_INSTANCE.tables), ...Object.values(RWCE_REPLAY.tables), ...Object.values(RWCX_REPLAY.tables), RWCX_REPLAY.eDays];
  assert(rwcTables.every((t) => t.startsWith("pm_rwc_")), rwcTables.join(","));
  const rwcNames = [...rwcTables, RWC_INSTANCE.locks.run, RWC_INSTANCE.locks.select, RWCE_REPLAY.lock, RWCX_REPLAY.lock];
  assertEquals(rwcNames.filter((n) => rwNames.includes(n)), []);
  // A fresh replay of RW-C starts at its first minute.
  assertEquals([newRweState(RWCE_REPLAY).lastDecided, newRweState(RWCE_REPLAY).dayOf], [RWC_RUN_START - M, RWC_RUN_START]);
  assertEquals([rwPhase(RWC_RUN_START - 1, RWC_INSTANCE), rwPhase(RWC_RUN_START, RWC_INSTANCE), rwPhase(RWC_RUN_END - 1, RWC_INSTANCE), rwPhase(RWC_RUN_END, RWC_INSTANCE)],
    ["warm-up", "run", "run", "after"]);
});

Deno.test("RW-C's replays run the frozen arms with every 'from' at RW-C's first minute, and nothing else changed", () => {
  assertEquals(RWCX_SPECS.map((s) => s.id), RWX_SPECS.map((s) => s.id));
  for (const [i, s] of RWCX_SPECS.entries()) {
    assertEquals([s.noSameDayFrom, s.from], [RWC_RUN_START, RWC_RUN_START], s.id);
    assertEquals({ ...s, noSameDayFrom: null, from: 0 }, { ...RWX_SPECS[i], noSameDayFrom: null, from: 0 }, s.id);
  }
  // RW's own arms are untouched by the mapping.
  assertEquals(RWX_SPECS[1], { id: "x1", noSameDayFrom: RWE_START, from: Date.UTC(2026, 8, 28), noCats: ["weather_fees"] });
});

Deno.test("RW-C's tables are held to RW's rules in the double, and its paged reads are total orders", () => {
  const fill = { cond: "0xa", minute: iso(RWC_RUN_START), ts: iso(RWC_RUN_START + 5e3), side: "bid", price: 0.49, size: 20, print_id: "p" };
  assertEquals(schemaRefusal("pm_rwc_fills", fill), null);
  assertEquals(schemaRefusal("pm_rwc_fills", { ...fill, side: "buy" }), `new row for relation "pm_rwc_fills" violates check constraint "pm_rwc_fills_side_check"`);
  assertEquals(schemaRefusal("pm_rwc_x_days", { day: "2026-10-09", arm: "x4", total: 0, stress_total: 0, reward: 0, fills: 0, capital: 0, markets: 0, detail: {} }),
    `new row for relation "pm_rwc_x_days" violates check constraint "pm_rwc_x_days_arm_check"`);
  assertEquals(schemaRefusal("pm_rwc_state", { id: 2, state: {} }), `new row for relation "pm_rwc_state" violates check constraint "pm_rwc_state_id_check"`);
  assert(schemaRefusal("pm_rwc_minutes", { cond: "0xa", minute: iso(RWC_RUN_START), quoting: true, tick: 0.01, nope: 1 })?.includes("'nope' column"));
  // The engine's and the replays' paged reads of RW-C's two tables with no `id`: ordered by their whole unique key.
  assertPagedOrder("pm_rwc_minutes", "select=cond&order=minute.asc,cond.asc");
  assertPagedOrder("pm_rwc_fills", "select=cond&order=cond.asc,minute.asc,print_id.asc");
  assertThrows(() => assertPagedOrder("pm_rwc_fills", "select=cond&order=cond.asc,minute.asc"), Error, "unique id last");
});

// ------------------------------------------------------------------------------------------------ the driver

const A = { cond: "0xaaa", yes: "101", no: "102" }, B = { cond: "0xbbb", yes: "201", no: "202" };
type World = { books: Record<string, { bids: PmLevel[]; asks: PmLevel[] }>; prints: Array<Record<string, unknown>>; closed: Array<Record<string, unknown>>; now: number; calls: string[]; cache: Map<string, { at: number; body: string }> };

/** Polymarket's public endpoints as the engine and the selection meet them: /books uncached, the data API and Gamma cached for 300 s. */
function fakeFetch(w: World): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    w.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
    const ok = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname === "/books") {
      const want = JSON.parse(String(init?.body)) as Array<{ token_id: string }>;
      return ok(want.filter((x) => w.books[x.token_id]).map((x) => {
        const b = w.books[x.token_id];
        return { asset_id: x.token_id, tick_size: "0.01",
          bids: b.bids.slice().sort((p, q) => p[0] - q[0]).map(([p, s]) => ({ price: String(p), size: String(s) })),
          asks: b.asks.slice().sort((p, q) => q[0] - p[0]).map(([p, s]) => ({ price: String(p), size: String(s) })) };
      }));
    }
    if (u.pathname === "/rewards/markets/current") {
      return ok(u.searchParams.get("sponsored") === "false"
        ? { data: [A, B].map((m, i) => ({ condition_id: m.cond, total_daily_rate: 144 - i, rewards_max_spread: 3, rewards_min_size: 20 })), next_cursor: "LTE=" }
        : { data: [], next_cursor: "LTE=" });
    }
    if (u.pathname === "/sampling-simplified-markets") {
      return ok({ data: [A, B].map((m) => ({ condition_id: m.cond, tokens: [{ token_id: m.yes }, { token_id: m.no }], accepting_orders: true, closed: false })), next_cursor: "LTE=" });
    }
    const hit = w.cache.get(u.href);
    if (hit && w.now - hit.at < 300_000) return ok(hit.body);
    let body: string;
    if (u.pathname === "/v2/trades") {
      const cond = u.searchParams.get("condition");
      body = JSON.stringify({ data: w.prints.filter((p) => p.market === cond && Number(p.timestamp) * 1000 <= w.now).sort((p, q) => Number(q.timestamp) - Number(p.timestamp)), pagination: { next_cursor: "" } });
    } else if (u.pathname === "/markets/keyset") {
      const ids = u.searchParams.getAll("condition_ids");
      body = JSON.stringify({ markets: u.searchParams.get("closed") === "true" ? w.closed.filter((m) => ids.includes(String(m.conditionId)))
        : ids.map((c) => {
          const m = c === A.cond ? A : B;
          return { conditionId: c, clobTokenIds: JSON.stringify([m.yes, m.no]), enableOrderBook: true, acceptingOrders: true, closed: false, orderPriceMinTickSize: 0.01, question: `market ${c}`, endDate: "2026-12-31T00:00:00Z" };
        }) });
    } else return new Response("not found", { status: 404 });
    w.cache.set(u.href, { at: w.now, body });
    return ok(body);
  }) as typeof fetch;
}
const book = () => ({ bids: [[0.48, 100], [0.47, 50]] as PmLevel[], asks: [[0.52, 100], [0.53, 50]] as PmLevel[] });
function world(): World {
  return { books: { [A.yes]: book(), [B.yes]: book() }, prints: [], closed: [], now: 0, calls: [], cache: new Map() };
}
const print = (m: typeof A, tsSec: number, side: "BUY" | "SELL", price: number, size: number, tx: string) =>
  ({ market: m.cond, side, token_id: m.yes, size, price, timestamp: tsSec, outcome_index: 0, transaction_hash: tx, proxy_wallet: "0xw" });

/** A day's portfolio: A (its end weeks away) and, when named, B, whose scheduled end is 20:00 on the day it is chosen. */
const sel = (day: string, withB = true): Row[] => [
  { day, cond: A.cond, rank: 1, yes: A.yes, tick: 0.01, v: 3, min_size: 20, rate: 144, per_dollar_day: 1, capital: 20, q: "market A", cat: "culture_fees", end_date: "2026-12-31T00:00:00.000Z", selected_at: `${day}T00:00:01.000Z` },
  ...(withB ? [{ day, cond: B.cond, rank: 2, yes: B.yes, tick: 0.01, v: 3, min_size: 20, rate: 143, per_dollar_day: 1, capital: 20, q: "market B", cat: "culture_fees", end_date: `${day}T20:00:00.000Z`, selected_at: `${day}T00:00:01.000Z` }] : []),
];
const LOCKS = ["pmrw", "pmrw-select", "pmrw-e", "pmrw-x", "pmrwc", "pmrwc-select", "pmrwc-e", "pmrwc-x"];
const RW_FAMILY = ["pm_rw_state", "pm_rw_selection", "pm_rw_minutes", "pm_rw_prints", "pm_rw_fills", "pm_rw_days", "pm_rw_settlements", "pm_rw_e_state", "pm_rw_e_days", "pm_rw_x_state", "pm_rw_x_days"];
const RWC_FAMILY = RW_FAMILY.map((t) => t.replace(/^pm_rw_/, "pm_rwc_"));
/** Both runs' tables, empty unless seeded, and every lease free. */
function seedDb(over: Record<string, Row[]> = {}) {
  const s: Record<string, Row[]> = { agent_locks: LOCKS.map((name) => ({ name, lease_until: iso(0), holder: null } as Row)) };
  for (const t of [...RW_FAMILY, ...RWC_FAMILY]) s[t] = [];
  return memDb({ ...s, ...over }, { now: () => Date.now() });
}
/** The database, every call it is asked for written down by table and, for a lease, by its name. */
function recording(db: Db, seen: string[]): Db {
  const lease = (t: string, q: string) => (t === "agent_locks" ? `agent_locks:${/name=eq\.([^&]+)/.exec(q)?.[1]}` : t);
  return {
    select: (t, q) => { seen.push(lease(t, q)); return db.select(t, q); },
    insert: (t, r, ret) => { seen.push(t); return db.insert(t, r, ret); },
    upsert: (t, r, k) => { seen.push(t); return db.upsert(t, r, k); },
    update: (t, q, p) => { seen.push(lease(t, q)); return db.update(t, q, p); },
    claim: (t, q, p) => { seen.push(lease(t, q)); return db.claim(t, q, p); },
    selectAll: (t, q) => { seen.push(t); return db.selectAll(t, q); },
  };
}
/** A database that refuses every call: what "reads nothing" means. */
const untouchable = (calls: string[]): Db => {
  const no = (what: string) => () => { calls.push(what); return Promise.reject(new Error(`db ${what} called`)); };
  return { select: no("select"), insert: no("insert"), upsert: no("upsert"), update: no("update"), claim: no("claim"), selectAll: no("selectAll") };
};

/** The engine minute by minute over [from, from + minutes), with the world's clock at each run's instant. */
async function runEngine(db: Db, w: World, from: number, minutes: number, inst = RWC_INSTANCE) {
  for (let k = 0; k < minutes; k++) {
    const now = from + k * M + 5_000;
    w.now = now;
    await runPmrw({ db, now, holder: `h${k}`, pm: { fetchImpl: fakeFetch(w), clock: () => now }, inst });
  }
}

Deno.test("before its warm-up RW-C's calls read nothing and fetch nothing, and its replays wait for its first decided minute", async () => {
  const calls: string[] = [];
  const w = world();
  const pm = { fetchImpl: fakeFetch(w), clock: () => 0 };
  for (const now of [Date.UTC(2026, 8, 28, 12), RWC_WARM_UP - 1]) {
    assertEquals((await runPmrw({ db: untouchable(calls), now, holder: "a", pm, inst: RWC_INSTANCE })).skipped, "before its warm-up");
    assertEquals((await runPmrwSelect({ db: untouchable(calls), now, holder: "b", pm, inst: RWC_INSTANCE })).skipped, "before its warm-up");
  }
  for (const now of [RWC_WARM_UP, RWC_RUN_START + RW_DECIDE_LAG_MS - 1]) {
    assertEquals((await runPmrwE({ db: untouchable(calls), now, holder: "c", replay: RWCE_REPLAY })).skipped, "before RW-C's first minute is decided");
    assertEquals((await runPmrwX({ db: untouchable(calls), now, holder: "d", replay: RWCX_REPLAY })).skipped, "before RW-C's first minute is decided");
  }
  assertEquals([calls, w.calls], [[], []]);
  // From its warm-up's first instant the selection runs, and on its lease alone.
  const { db, tables } = seedDb();
  const seen: string[] = [];
  const r = await runPmrwSelect({ db: recording(db, seen), now: RWC_WARM_UP, holder: "s", pm, inst: RWC_INSTANCE });
  assertEquals([r.errors, r.day, r.chosen], [[], "2026-10-08", 2]);
  assertEquals(tables.pm_rwc_selection.map((s) => [s.day, s.cond]), [["2026-10-08", A.cond], ["2026-10-08", B.cond]]);
  assertEquals(tables.pm_rw_selection, []);
  assertEquals([...new Set(seen)].sort(), ["agent_locks:pmrwc-select", "pm_rwc_selection"]);
  // RW's own instance has no quiet time: its calls are what they were (its end is the only thing that stops them).
  assertEquals((await runPmrwSelect({ db: untouchable(calls), now: RW_RUN_END, holder: "t", pm })).skipped, "the fourteen days are over");
});

Deno.test("RW-C writes RW-C's tables and never RW's, and RW never RW-C's", async () => {
  // Each run's tables hold a record the other must not touch.
  const rwRecord = { pm_rw_selection: sel("2026-10-08"), pm_rw_days: [{ day: "2026-09-25", total: 1, stress_total: 1, reward: 1, fills: 0, capital: 1, markets: 1, detail: {} }] };
  const rwcRecord = { pm_rwc_selection: sel("2026-09-30"), pm_rwc_days: [{ day: "2026-09-20", total: 2, stress_total: 2, reward: 2, fills: 0, capital: 2, markets: 1, detail: {} }] };
  for (const [inst, from, other] of [[RWC_INSTANCE, Date.UTC(2026, 9, 8, 23, 50), "pm_rw_"], [RW_INSTANCE, Date.UTC(2026, 8, 30, 23, 50), "pm_rwc_"]] as const) {
    const { db, tables } = seedDb({ ...rwRecord, ...rwcRecord, [inst.tables.selection]: [...sel(iso(from).slice(0, 10)), ...sel(iso(from + DAY).slice(0, 10))] as Row[] });
    const before = JSON.stringify(Object.fromEntries(Object.entries(tables).filter(([t]) => t.startsWith(other))));
    const seen: string[] = [];
    const w = world();
    w.prints.push(print(A, from / 1000 + 90, "SELL", 0.45, 30, "0x1"), print(B, from / 1000 + 700, "BUY", 0.56, 25, "0x2"), print(A, from / 1000 + 1300, "BUY", 0.57, 30, "0x3"));
    for (let k = 0; k < 25; k++) {
      const now = from + k * M + 5_000;
      w.now = now;
      const pm = { fetchImpl: fakeFetch(w), clock: () => now };
      if (k % 5 === 0) await runPmrwSelect({ db: recording(db, seen), now, holder: `s${k}`, pm, inst });
      await runPmrw({ db: recording(db, seen), now, holder: `h${k}`, pm, inst });
      const rwc = inst === RWC_INSTANCE;
      await runPmrwE({ db: recording(db, seen), now: now + 20e3, holder: `e${k}`, ...(rwc ? { replay: RWCE_REPLAY } : {}) });
      await runPmrwX({ db: recording(db, seen), now: now + 30e3, holder: `x${k}`, ...(rwc ? { replay: RWCX_REPLAY } : {}) });
    }
    // It ran: a day closed, fills made, both replays wrote days.
    assert(tables[inst.tables.fills].length > 0 && tables[inst.tables.days].length > 1, inst.name);
    const mine = inst === RWC_INSTANCE ? /^(pm_rwc_|agent_locks:pmrwc)/ : /^(pm_rw_|agent_locks:pmrw(-|$))/;
    assertEquals([...new Set(seen)].filter((t) => !mine.test(t)), [], `${inst.name} reached outside its own`);
    assertEquals(JSON.stringify(Object.fromEntries(Object.entries(tables).filter(([t]) => t.startsWith(other)))), before, `${inst.name} changed the other's record`);
  }
});

Deno.test("RW-C's warm-up counts nowhere: its fourteen days start flat at 2026-10-09 00:00 UTC", async () => {
  const W0 = Date.UTC(2026, 9, 8, 23, 57);
  const { db, tables } = seedDb({ pm_rwc_selection: [...sel("2026-10-08", false), ...sel("2026-10-09", false)] });
  const w = world();
  w.prints.push(print(A, W0 / 1000 + 30, "SELL", 0.45, 30, "0xw1"));
  await runEngine(db, w, W0, 6);
  const day = tables.pm_rwc_days.find((d) => d.day === "2026-10-08")!;
  assertEquals([(day.detail as { phase: string }).phase, Number(day.fills)], ["warm-up", 1]);
  const st = tables.pm_rwc_state[0].state as RwState;
  assertEquals([st.dayOf, st.acc[A.cond].net, st.acc[A.cond].fills], [RWC_RUN_START, 0, 0]);
  assert(st.acc[A.cond].reward > 0, "10-09's own minutes were quoted");
  assertEquals(tables.pm_rw_days, []);
});

Deno.test("after its fourteen days' last minute and last day, RW-C reads, decides and selects nothing more", async () => {
  const E0 = Date.UTC(2026, 9, 22, 23, 57);
  const { db, tables } = seedDb({ pm_rwc_selection: [...sel("2026-10-22", false), ...sel("2026-10-23", false)] });
  const w = world();
  await runEngine(db, w, E0, 5);
  assertEquals(tables.pm_rwc_days.map((d) => [d.day, (d.detail as { phase: string }).phase]), [["2026-10-22", "run"]]);
  assertEquals(tables.pm_rwc_minutes.filter((m) => String(m.minute) >= "2026-10-23").length, 0);
  assertEquals((tables.pm_rwc_state[0].state as RwState).lastDecided, RWC_RUN_END - M);
  const calls = w.calls.length;
  const after = RWC_RUN_END + 10 * M;
  assertEquals((await runPmrw({ db, now: after, holder: "z", pm: { fetchImpl: fakeFetch(w), clock: () => after }, inst: RWC_INSTANCE })).skipped, "the fourteen days are over");
  assertEquals((await runPmrwSelect({ db, now: RWC_RUN_END, holder: "s", pm: { fetchImpl: fakeFetch(w) }, inst: RWC_INSTANCE })).skipped, "the fourteen days are over");
  assertEquals(w.calls.length, calls);
  // The replays stop at the same place: fourteen days from RW-C's start at 720 minutes a run, the last day closed, then
  // nothing.
  for (let k = 0; k < 28; k++) {
    await runPmrwE({ db, now: after + k * M, holder: `e${k}`, replay: RWCE_REPLAY });
    await runPmrwX({ db, now: after + k * M, holder: `x${k}`, replay: RWCX_REPLAY });
  }
  const e = tables.pm_rwc_e_state[0].state as RweState, x = tables.pm_rwc_x_state[0].state as unknown as RwxStored;
  assertEquals([e.dayOf, e.lastDecided, x.dayOf, x.lastDecided], [RWC_RUN_END, RWC_RUN_END - M, RWC_RUN_END, RWC_RUN_END - M]);
  assertEquals(tables.pm_rwc_e_days.filter((d) => d.arm === "rw").length, 14);
  assert(e.checkMaxUsd < 1e-9 && x.checkMaxUsd < 1e-9 && x.checkEMaxUsd < 1e-9 && x.checkEDays === 14);
  assertEquals((await runPmrwE({ db, now: after + 30 * M, holder: "e9", replay: RWCE_REPLAY })).skipped, "the fourteen days are over");
  assertEquals((await runPmrwX({ db, now: after + 30 * M, holder: "x9", replay: RWCX_REPLAY })).skipped, "the fourteen days are over");
});

/** RW-C's first midnight: A all through, B on 10-09 (it ends at 20:00 that day), A alone on 10-10; fills in both. */
async function firstMidnight() {
  const T0 = Date.UTC(2026, 9, 9, 23, 40);
  const seeded = seedDb({ pm_rwc_selection: [...sel("2026-10-09"), ...sel("2026-10-10", false)] });
  const w = world();
  const s = T0 / 1000;
  w.prints.push(print(A, s + 30, "SELL", 0.45, 30, "0xa1"), print(A, s + 610, "BUY", 0.57, 50, "0xa2"), print(B, s + 90, "BUY", 0.56, 25, "0xb1"),
    print(A, s + 1330, "SELL", 0.44, 10, "0xa3"), print(B, s + 1400, "SELL", 0.44, 25, "0xb2"));
  await runEngine(seeded.db, w, T0, 35);
  return { ...seeded, w };
}
/** Replays until the replay has caught up with RW-C (720 minutes a run at most). */
async function catchUp(db: Db, now: number) {
  for (let k = 0; k < 5; k++) {
    await runPmrwE({ db, now: now + k * M, holder: `e${k}`, replay: RWCE_REPLAY });
    await runPmrwX({ db, now: now + k * M, holder: `x${k}`, replay: RWCX_REPLAY });
  }
}

Deno.test("the replays on RW-C's minutes: arm rw is RW-C's own days to under a cent, RW-E from RW-C's first minute, and a planted gap is caught", async () => {
  const { db, tables } = await firstMidnight();
  assertEquals(tables.pm_rwc_days.map((d) => d.day), ["2026-10-09"]);
  assert(tables.pm_rwc_fills.some((f) => f.cond === B.cond) && tables.pm_rwc_fills.some((f) => f.cond === A.cond));
  const seen: string[] = [];
  const rwLast = Date.parse(String(tables.pm_rwc_state[0].last_minute));
  await catchUp(recording(db, seen), rwLast + 3 * M);
  // They read RW-C's record and wrote their own, and nothing of RW's.
  assertEquals([...new Set(seen)].filter((t) => !/^(pm_rwc_|agent_locks:pmrwc-[ex]$)/.test(t)), []);
  const e = tables.pm_rwc_e_state[0].state as RweState, x = tables.pm_rwc_x_state[0].state as unknown as RwxStored;
  assertEquals([e.lastDecided, x.lastDecided], [rwLast, rwLast]);
  // The check: the rw arm is RW-C, day for day.
  assert(e.checkMaxUsd < 1e-9 && x.checkMaxUsd < 1e-9, `${e.checkMaxUsd} ${x.checkMaxUsd}`);
  const own = tables.pm_rwc_days[0], rwArm = tables.pm_rwc_e_days.find((d) => d.arm === "rw" && d.day === "2026-10-09")!;
  assertAlmostEquals(Number(rwArm.total), Number(own.total), 1e-9);
  assertEquals((rwArm.detail as { check: Record<string, number> }).check.total, 0);
  // The x replay's e arm is RW-E's replay of RW-C, the second check, over the day both closed.
  assert(x.checkEMaxUsd < 1e-9 && x.checkEDays === 1, `${x.checkEMaxUsd} over ${x.checkEDays}`);
  // RW-E's rule from RW-C's first minute: B, which ends on 10-09, is left out of that day, so the two arms differ by B.
  const eArm = tables.pm_rwc_e_days.find((d) => d.arm === "e" && d.day === "2026-10-09")!;
  assertEquals((eArm.detail as { excluded: string[] }).excluded, [B.cond]);
  assert(Math.abs(Number(eArm.total) - Number(rwArm.total)) > 0.01);
  assertEquals(e.arms.e.acc[B.cond], undefined);
  // Every arm's first minute is RW-C's: each kept its accounts as that minute began — nothing, as RW-C starts flat.
  assertEquals(e.base, {});
  for (const id of ["e", "x1", "x2", "x3"]) assertEquals(x.arms[id].base, {}, id);
  // A day row of RW-C's 5 ¢ off: the replay, run again from RW-C's start, says so, and its figures are void.
  tables.pm_rwc_days[0].total = Number(own.total) + 0.05;
  tables.pm_rwc_e_state.length = 0;
  tables.pm_rwc_e_days.length = 0;
  await catchUp(db, rwLast + 10 * M);
  const again = tables.pm_rwc_e_state[0].state as RweState;
  assertAlmostEquals(again.checkMaxUsd, 0.05, 1e-9);
  assert(again.checkMaxUsd >= RWE_CHECK_USD);
});

Deno.test("RW-C's replays of an arm equal RW-C's engine run without what the arm leaves out (RW-E: B on 10-09)", async () => {
  const { db, tables } = await firstMidnight();
  await catchUp(db, Date.parse(String(tables.pm_rwc_state[0].last_minute)) + 3 * M);
  // RW-E computed the other way: RW-C's engine run with B out of 10-09's portfolio.
  const truth = seedDb({ pm_rwc_selection: [...sel("2026-10-09", false), ...sel("2026-10-10", false)] });
  const w = world();
  const s = Date.UTC(2026, 9, 9, 23, 40) / 1000;
  w.prints.push(print(A, s + 30, "SELL", 0.45, 30, "0xa1"), print(A, s + 610, "BUY", 0.57, 50, "0xa2"), print(B, s + 90, "BUY", 0.56, 25, "0xb1"),
    print(A, s + 1330, "SELL", 0.44, 10, "0xa3"), print(B, s + 1400, "SELL", 0.44, 25, "0xb2"));
  await runEngine(truth.db, w, Date.UTC(2026, 9, 9, 23, 40), 35);
  const noB = truth.tables.pm_rwc_state[0].state as RwState, e = tables.pm_rwc_e_state[0].state as RweState;
  assertEquals(Object.keys(e.arms.e.acc).sort(), Object.keys(noB.acc).sort());
  for (const [c, a] of Object.entries(noB.acc)) assertAlmostEquals(accTotal(e.arms.e.acc[c]), accTotal(a), 1e-12, c);
  const eDay = tables.pm_rwc_e_days.find((d) => d.arm === "e" && d.day === "2026-10-09")!;
  assertAlmostEquals(Number(eDay.total), Number(truth.tables.pm_rwc_days[0].total), 1e-9);
  // And the variants' replay's e arm is the same RW-E.
  const xe = tables.pm_rwc_x_days.find((d) => d.arm === "e" && d.day === "2026-10-09")!;
  assertAlmostEquals(Number(xe.total), Number(eDay.total), 1e-12);
});
