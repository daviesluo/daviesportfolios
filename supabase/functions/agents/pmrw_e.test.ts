// RW-E's replay (pmrw_e.ts) against RW's own engine: drive the engine over a UTC midnight with two markets, one of which
// ends that day, then replay what it stored. The rw arm must be RW to the last bit, and the e arm must be what the
// engine itself does when the market that ends that day is left out of the day's selection — the pre-registration's
// definition of RW-E, computed two independent ways.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accStress, accTotal, runPmrw, type RwState } from "./pmrw.ts";
import { excludedByDay, newRweState, replayMinutes, runPmrwE, RWE_START, RWE_STATE_VERSION, type RweState } from "./pmrw_e.ts";
import { newRwxState, replayArms, runPmrwX, RWX_SPECS, RWX_STATE_VERSION, type RwxStored } from "./pmrw_x.ts";
import { rweArmSummary, rweSummary, rwSummary, rwxArmSummaries, type RwMinuteRow, type RwSelRow } from "./pmrw_view.ts";
import type { PmLevel } from "../_shared/polymarket_public.ts";
import { memDb, type Row } from "./testing.ts";

const A = { cond: "0xaaa", yes: "101", no: "102" }, B = { cond: "0xbbb", yes: "201", no: "202" };
// C ends at noon on 10-01: quoted on 09-30 (it does not end that day) and, when chosen again, left out by RW-E on 10-01.
const C = { cond: "0xccc", yes: "301", no: "302" };
// D is a weather market that ends weeks away, quoted on both days when named: RW-E quotes it, its no-weather variants never.
const D = { cond: "0xddd", yes: "401", no: "402" };
const T0 = Date.UTC(2026, 8, 30, 23, 50);              // ten minutes before a UTC midnight inside the fourteen days

type World = {
  books: Record<string, { bids: PmLevel[]; asks: PmLevel[] }>; prints: Array<Record<string, unknown>>; closed: Array<Record<string, unknown>>;
  now: number; cache: Map<string, { at: number; body: string }>;
};
/** Polymarket's public endpoints as the engine meets them: /books uncached, /v2/trades by market and Gamma cached for 300 s. */
function fakeFetch(w: World): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname === "/books") {
      const want = JSON.parse(String(init?.body)) as Array<{ token_id: string }>;
      return ok(JSON.stringify(want.filter((x) => w.books[x.token_id]).map((x) => {
        const b = w.books[x.token_id];
        return {
          asset_id: x.token_id, tick_size: "0.01",
          bids: b.bids.slice().sort((p, q) => p[0] - q[0]).map(([p, s]) => ({ price: String(p), size: String(s) })),
          asks: b.asks.slice().sort((p, q) => q[0] - p[0]).map(([p, s]) => ({ price: String(p), size: String(s) })),
        };
      })));
    }
    const hit = w.cache.get(u.href);
    if (hit && w.now - hit.at < 300_000) return ok(hit.body);
    let body: string;
    if (u.pathname === "/v2/trades") {
      const cond = u.searchParams.get("condition");
      body = JSON.stringify({ data: w.prints.filter((p) => p.market === cond && Number(p.timestamp) * 1000 <= w.now).sort((p, q) => Number(q.timestamp) - Number(p.timestamp)), pagination: { next_cursor: "" } });
    } else if (u.pathname === "/markets/keyset") {
      const want = u.searchParams.getAll("condition_ids");
      body = JSON.stringify({ markets: u.searchParams.get("closed") === "true" ? w.closed.filter((m) => want.includes(String(m.conditionId))) : [] });
    } else return new Response("not found", { status: 404 });
    w.cache.set(u.href, { at: w.now, body });
    return ok(body);
  }) as typeof fetch;
}

const book = () => ({ bids: [[0.48, 100], [0.47, 50]] as PmLevel[], asks: [[0.52, 100], [0.53, 50]] as PmLevel[] });
const print = (m: typeof A, tsSec: number, side: "BUY" | "SELL", price: number, size: number, tx: string) =>
  ({ market: m.cond, side, token_id: m.yes, size, price, timestamp: tsSec, outcome_index: 0, transaction_hash: tx, proxy_wallet: "0xw" });

/** A's scheduled end is weeks away; B's is 20:00 on the day it is chosen. */
function selection(withB: boolean): Row[] {
  const row = (m: typeof A, rank: number, end: string) =>
    ({ day: "2026-09-30", cond: m.cond, rank, yes: m.yes, tick: 0.01, v: 3, min_size: 20, rate: 144, per_dollar_day: 1, capital: 20, q: `market ${m.cond}`, cat: "weather_fees", end_date: end, selected_at: "2026-09-30T00:00:01.000Z" } as Row);
  return [row(A, 1, "2026-10-20T00:00:00.000Z"), ...(withB ? [row(B, 2, "2026-09-30T20:00:00.000Z")] : [])];
}
/**
 * A portfolio over the midnight: 09-30's A (and B, C), and 10-01's A (and C) when named. Every market is a weather one
 * unless `aCat` names A's category: RW's engine and RW-E never read it; RW-E's variants that leave weather out do.
 */
function portfolio(o: { b: boolean; c: "none" | "first" | "both"; aCat?: string; d?: boolean }): Row[] {
  const row = (day: string, m: typeof A, rank: number, end: string) =>
    ({ day, cond: m.cond, rank, yes: m.yes, tick: 0.01, v: 3, min_size: 20, rate: 144, per_dollar_day: 1, capital: 20, q: `market ${m.cond}`, cat: "weather_fees", end_date: end, selected_at: `${day}T00:00:01.000Z` } as Row);
  const cEnd = "2026-10-01T12:00:00.000Z";
  const out = [
    ...selection(o.b),
    ...(o.c !== "none" ? [row("2026-09-30", C, 3, cEnd)] : []),
    row("2026-10-01", A, 1, "2026-10-20T00:00:00.000Z"),
    ...(o.c === "both" ? [row("2026-10-01", C, 2, cEnd)] : []),
    ...(o.d ? [row("2026-09-30", D, 4, "2026-10-20T00:00:00.000Z"), row("2026-10-01", D, 3, "2026-10-20T00:00:00.000Z")] : []),
  ];
  return o.aCat ? out.map((r) => (r.cond === A.cond ? { ...r, cat: o.aCat } : r)) : out;
}
function seed(withB: boolean | Row[]) {
  return memDb({
    agent_locks: ["pmrw", "pmrw-select", "pmrw-e", "pmrw-x"].map((name) => ({ name, lease_until: new Date(0).toISOString(), holder: null } as Row)),
    pm_rw_state: [], pm_rw_minutes: [], pm_rw_prints: [], pm_rw_fills: [], pm_rw_days: [], pm_rw_settlements: [], pm_rw_e_state: [], pm_rw_e_days: [],
    pm_rw_x_state: [], pm_rw_x_days: [],
    pm_rw_selection: typeof withB === "boolean" ? selection(withB) : withB,
  }, { now: () => Date.now() });
}
function world(): World {
  const w: World = { books: { [A.yes]: book(), [B.yes]: book(), [C.yes]: book(), [D.yes]: book() }, prints: [], closed: [], now: 0, cache: new Map() };
  const s = T0 / 1000;
  // A: a SELL through the bid (0.49) twice, then a BUY through the ask (0.51). B: a BUY through the ask, then the same
  // again after midnight, when it is no longer selected.
  w.prints.push(print(A, s + 30, "SELL", 0.45, 30, "0xa1"), print(A, s + 150, "SELL", 0.44, 10, "0xa2"), print(A, s + 400, "BUY", 0.57, 50, "0xa3"));
  w.prints.push(print(B, s + 90, "BUY", 0.56, 25, "0xb1"), print(B, s + 330, "BUY", 0.58, 5, "0xb2"));
  // C: a SELL through the bid before midnight, then after it a BUY through the ask and a SELL through the bid again.
  // A market nobody selects is never read, so the tests without C do not see these.
  w.prints.push(print(C, s + 60, "SELL", 0.45, 20, "0xc1"), print(C, s + 900, "BUY", 0.57, 20, "0xc2"), print(C, s + 1260, "SELL", 0.44, 20, "0xc3"));
  // D: a BUY through the ask after midnight.
  w.prints.push(print(D, s + 780, "BUY", 0.57, 20, "0xd1"));
  return w;
}
/** The engine minute by minute from T0 to `minutes` later; B resolves NO at 00:12, which the run at 00:20 reads. */
async function runEngine(withB: boolean | Row[], minutes = 32) {
  const { db, tables } = seed(withB);
  const w = world();
  for (let k = 0; k <= minutes; k++) {
    const now = T0 + k * 60_000 + 5_000;
    if (now >= Date.UTC(2026, 9, 1, 0, 12)) w.closed = [{ conditionId: B.cond, clobTokenIds: JSON.stringify([B.yes, B.no]), closed: true, closedTime: "2026-10-01 00:12:00+00", outcomePrices: JSON.stringify(["0", "1"]), question: "b" }];
    w.now = now;
    await runPmrw({ db, now, holder: `h${k}`, pm: { fetchImpl: fakeFetch(w), clock: () => now } });
  }
  return { db, tables };
}

Deno.test("the replay is RW itself in its rw arm, and RW-E in its e arm is the engine run without the market that ends that day", async () => {
  const withB = await runEngine(true), withoutB = await runEngine(false);
  const rw = withB.tables;
  // The world did what the test needs: both markets filled, a day closed, B settled.
  assert(rw.pm_rw_fills.some((f) => f.cond === A.cond) && rw.pm_rw_fills.some((f) => f.cond === B.cond));
  assertEquals(rw.pm_rw_days.map((d) => d.day), ["2026-09-30"]);
  assertEquals(rw.pm_rw_settlements.map((s) => [s.cond, Number(s.payout)]), [[B.cond, 0]]);

  // Replay what the engine stored, from a state that already holds nothing before T0 (RW's own start is a warm-up away).
  const st: RweState = { ...newRweState(), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30) };
  const rwState = rw.pm_rw_state[0].state as RwState;
  const out = replayMinutes(st, rwState.lastDecided, {
    rows: rw.pm_rw_minutes as never, fills: rw.pm_rw_fills as never, prints: rw.pm_rw_prints as never, selection: rw.pm_rw_selection as never,
    settlements: rw.pm_rw_settlements as never, rwDays: rw.pm_rw_days as never,
  });
  assertEquals(st.lastDecided, rwState.lastDecided);
  // The rw arm is RW: every market's account to the last bit, and the day's row.
  for (const [c, a] of Object.entries(rwState.acc)) {
    const r = st.arms.rw.acc[c];
    assertEquals([r.net, r.fills, r.settled, r.quotedMinutes, r.firstCap], [a.net, a.fills, a.settled, a.quotedMinutes, a.firstCap], c);
    assertAlmostEquals(r.cash, a.cash, 1e-12);
    assertAlmostEquals(r.reward, a.reward, 1e-12);
    assertAlmostEquals(accStress(r), accStress(a), 1e-12);
  }
  const day = out.days.find((d) => d.day === "2026-09-30" && d.arm === "rw")!;
  const own = rw.pm_rw_days[0];
  assertAlmostEquals(day.total, Number(own.total), 1e-9);
  assertAlmostEquals(day.stress_total, Number(own.stress_total), 1e-9);
  assertEquals([day.fills, day.markets], [Number(own.fills), Number(own.markets)]);
  assert(st.checkMaxUsd < 1e-9, `the replay missed RW by ${st.checkMaxUsd}`);

  // The e arm is the engine without B in 09-30's selection: B's rewards, fills and settlement are nowhere in it.
  const noB = withoutB.tables.pm_rw_state[0].state as RwState;
  assertEquals(Object.keys(st.arms.e.acc).sort(), Object.keys(noB.acc).sort());
  for (const [c, a] of Object.entries(noB.acc)) {
    const e = st.arms.e.acc[c];
    assertAlmostEquals(accTotal(e), accTotal(a), 1e-12);
    assertAlmostEquals(accStress(e), accStress(a), 1e-12);
  }
  const eDay = out.days.find((d) => d.day === "2026-09-30" && d.arm === "e")!;
  const noBDay = withoutB.tables.pm_rw_days[0];
  assertAlmostEquals(eDay.total, Number(noBDay.total), 1e-9);
  assertAlmostEquals(eDay.capital, Number(noBDay.capital), 1e-9);
  assertEquals(eDay.detail.excluded, [B.cond]);
  assertEquals(st.diverged, []);
  // And they differ by exactly B: RW made money and lost it in B, RW-E never quoted it.
  assert(Math.abs(day.total - eDay.total) > 0.01);

  // The variants' replay (pmrw_x.ts) with RW-E's rule as its one arm is this replay: the same accounts, the same days.
  const specs = [{ id: "e", noSameDayFrom: Date.UTC(2026, 8, 27), from: Date.UTC(2026, 8, 27) }];
  const sx = { ...newRwxState(specs), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30) };
  const outX = replayArms(sx, rwState.lastDecided, {
    rows: rw.pm_rw_minutes as never, fills: rw.pm_rw_fills as never, prints: rw.pm_rw_prints as never, selection: rw.pm_rw_selection as never,
    settlements: rw.pm_rw_settlements as never, rwDays: rw.pm_rw_days as never,
  }, specs);
  for (const arm of ["rw", "e"] as const) {
    assertEquals(Object.keys(sx.arms[arm].acc).sort(), Object.keys(st.arms[arm].acc).sort());
    for (const [c, a] of Object.entries(st.arms[arm].acc)) assertEquals(sx.arms[arm].acc[c], a, `${arm} ${c}`);
    const dx = outX.days.find((d) => d.day === "2026-09-30" && d.arm === arm)!, de = out.days.find((d) => d.day === "2026-09-30" && d.arm === arm)!;
    assertEquals([dx.total, dx.stress_total, dx.reward, dx.fills, dx.capital, dx.markets], [de.total, de.stress_total, de.reward, de.fills, de.capital, de.markets]);
  }
  assertEquals(sx.checkMaxUsd, st.checkMaxUsd);
  assertEquals(sx.arms.e.diverged, []);
});

Deno.test("the driver replays only what RW has decided, writes both arms' days, and is idempotent run after run", async () => {
  const { db, tables } = await runEngine(true);
  // Seeded for the test's own midnight: the replay starts where this RW started.
  tables.pm_rw_e_state.push({ id: 1, state: { ...newRweState(), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30) }, last_minute: null } as Row);
  const rwLast = Date.parse(String(tables.pm_rw_state[0].last_minute));
  const r1 = await runPmrwE({ db, now: rwLast + 125_000, holder: "e1" });
  assertEquals(r1.errors, []);
  assertEquals(r1.to, rwLast);
  assertEquals(tables.pm_rw_e_days.map((d) => `${d.day}|${d.arm}`).sort(), ["2026-09-30|e", "2026-09-30|rw"]);
  const st = tables.pm_rw_e_state[0].state as RweState;
  assertEquals(st.lastDecided, rwLast);
  assert(st.checkMaxUsd < 1e-9);
  // Nothing new from RW: nothing replayed, nothing rewritten.
  const r2 = await runPmrwE({ db, now: rwLast + 400_000, holder: "e2" });
  assertEquals(r2.skipped, "nothing new from RW");
  // Another run holding the lease.
  tables.agent_locks.find((l) => l.name === "pmrw-e")!.lease_until = new Date(rwLast + 10 * 60_000).toISOString();
  tables.agent_locks.find((l) => l.name === "pmrw-e")!.holder = "other";
  assertEquals((await runPmrwE({ db, now: rwLast + 450_000, holder: "e3" })).skipped, "another run holds the pmrw-e lease");
});

Deno.test("a market is left out on the days its scheduled end falls inside, and only those", () => {
  const sel = [
    { day: "2026-09-27", cond: "x", tick: 0.01, v: 3, min_size: 20, rate: 50, end_date: "2026-09-27T23:59:00Z" },   // ends that day
    { day: "2026-09-27", cond: "y", tick: 0.01, v: 3, min_size: 20, rate: 50, end_date: "2026-09-28T00:00:00Z" },   // ends at the next midnight: not inside
    { day: "2026-09-28", cond: "y", tick: 0.01, v: 3, min_size: 20, rate: 50, end_date: "2026-09-28T00:00:00Z" },   // chosen again after its end
    { day: "2026-09-27", cond: "z", tick: 0.01, v: 3, min_size: 20, rate: 50, end_date: null },                     // no scheduled end
  ];
  const ex = excludedByDay(sel);
  assertEquals([...(ex.get("2026-09-27") ?? [])], ["x"]);
  assertEquals([...(ex.get("2026-09-28") ?? [])], ["y"]);
});

Deno.test("RW-E's own row: the replay's e arm, summarised as RW's row is, equals RW's summary of the engine run without the left-out market-days", async () => {
  // RW as it ran: A throughout, B on 09-30 (it ends that day), C on 09-30 and again on 10-01 (it ends at noon that day).
  const all = await runEngine(portfolio({ b: true, c: "both" }));
  // What RW-E is, computed the other way: the engine run with B out of 09-30 and C out of 10-01, and nothing else changed.
  const truth = await runEngine(portfolio({ b: false, c: "first" }));
  // This world begins after RW-E's first minute (09-27 00:00), so RW-E had passed it holding nothing.
  all.tables.pm_rw_e_state.push({ id: 1, state: { ...newRweState(), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30), base: {} }, last_minute: null } as Row);
  const rwLast = Date.parse(String(all.tables.pm_rw_state[0].last_minute));
  const run = await runPmrwE({ db: all.db, now: rwLast + 125_000, holder: "e" });
  assertEquals(run.errors, []);
  assertEquals(Date.parse(String(truth.tables.pm_rw_state[0].last_minute)), rwLast);

  // The world does what the test needs: RW traded C again on 10-01, on a day RW-E holds C without quoting it.
  assert(all.tables.pm_rw_fills.some((f) => f.cond === C.cond && String(f.minute) >= "2026-10-01"));
  assert(all.tables.pm_rw_fills.some((f) => f.cond === C.cond && String(f.minute) < "2026-10-01"));

  const nowMs = rwLast + 180_000;
  const on = (t: Row[], day: string) => t.filter((x) => String(x.day).slice(0, 10) === day) as unknown as RwSelRow[];
  const latestOf = (t: Record<string, Row[]>) => t.pm_rw_minutes.filter((r) => Date.parse(String(r.minute)) === rwLast) as unknown as RwMinuteRow[];
  const e = rweArmSummary({
    rwState: all.tables.pm_rw_state[0] as never, eState: all.tables.pm_rw_e_state[0] as never, selectionAll: all.tables.pm_rw_selection as never,
    today: on(all.tables.pm_rw_selection, "2026-10-01"), latest: latestOf(all.tables), days: all.tables.pm_rw_e_days as never,
    fills: all.tables.pm_rw_fills as never, nowMs,
  })!;
  const t = rwSummary({
    state: truth.tables.pm_rw_state[0] as never, selection: on(truth.tables.pm_rw_selection, "2026-10-01"), latest: latestOf(truth.tables),
    days: truth.tables.pm_rw_days as never, fills: truth.tables.pm_rw_fills as never, firstMinute: null, nowMs,
  })!;
  for (const k of ["totalUsd", "stressUsd", "rewardUsd", "fillsPnlUsd", "realisedUsd", "unrealisedUsd", "heldUsd", "todayUsd", "capitalUsd"] as const) {
    assertAlmostEquals(Number(e[k]), Number(t[k]), 1e-9, k);
  }
  assertEquals([e.open, e.fills, e.quoting], [t.open, t.fills, t.quoting]);
  assertAlmostEquals(e.mismatchUsd, 0, 1e-9);
  const book = (x: typeof e) => x.markets.map((m) => [m.cond, m.net, m.quoting, m.fills, m.avgCost == null ? null : Number(Number(m.avgCost).toFixed(12)), Number(Number(m.totalUsd).toFixed(9))]);
  assertEquals(book(e), book(t));
  assertEquals(e.days.map((d) => [d.day, d.fills, Number(d.totalUsd.toFixed(9))]), t.days.map((d) => [d.day, d.fills, Number(d.totalUsd.toFixed(9))]));
  // C is RW-E's held position on 10-01, not quoted there; B is nowhere in it.
  assert(e.markets.some((m) => m.cond === C.cond && m.net !== 0 && !m.quoting));
  assert(!e.markets.some((m) => m.cond === B.cond));
});

Deno.test("RW-E's variants' rows: x1 is the engine run without its weather markets, x2 with no jump to pause on is RW-E, x3 is x1, x2 and x3 off the page", async () => {
  // RW as it ran: A (culture) throughout, B (weather) on 09-30 and ending that day, C (weather) on 09-30 and 10-01, and
  // D (weather, ending weeks away) on both days.
  const all = await runEngine(portfolio({ b: true, c: "both", aCat: "culture_fees", d: true }));
  // x1 computed the other way: past RW-X's first day it never quotes a weather market, so it is the engine run on A alone.
  const truth = await runEngine(portfolio({ b: false, c: "none", aCat: "culture_fees" }));
  // RW-E, and the variants' replay, from this RW's own start. The world begins after every arm's first minute (09-27 and
  // 09-28 00:00), so each had passed it holding nothing.
  all.tables.pm_rw_e_state.push({ id: 1, state: { ...newRweState(), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30), base: {} }, last_minute: null } as Row);
  const xs: RwxStored = { ...newRwxState(RWX_SPECS), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30), version: RWX_STATE_VERSION, checkEMaxUsd: 0 };
  for (const id of ["e", "x1", "x2", "x3"]) xs.arms[id].base = {};
  all.tables.pm_rw_x_state.push({ id: 1, state: xs, last_minute: null } as unknown as Row);
  const rwLast = Date.parse(String(all.tables.pm_rw_state[0].last_minute));
  assertEquals((await runPmrwE({ db: all.db, now: rwLast + 125_000, holder: "e" })).errors, []);
  assertEquals((await runPmrwX({ db: all.db, now: rwLast + 125_000, holder: "x" })).errors, []);
  // Both checks hold: the replay's rw arm is RW and its e arm is RW-E, day for day.
  const stored = all.tables.pm_rw_x_state[0].state as unknown as RwxStored;
  assert(stored.checkMaxUsd < 1e-9 && stored.checkEMaxUsd < 1e-9 && stored.checkEDays === 1, JSON.stringify([stored.checkMaxUsd, stored.checkEMaxUsd, stored.checkEDays]));
  // The world does what the test needs: RW made fills in A, and in weather markets on both days (C's before midnight,
  // on a day it does not end, is left out of x1 by its category alone), and quotes D today.
  assert(all.tables.pm_rw_fills.some((f) => f.cond === A.cond));
  assert(all.tables.pm_rw_fills.some((f) => f.cond === C.cond && String(f.minute) < "2026-10-01"));
  assert(all.tables.pm_rw_fills.some((f) => f.cond === D.cond && String(f.minute) >= "2026-10-01"));

  const nowMs = rwLast + 180_000;
  const on = (t: Row[], day: string) => t.filter((x) => String(x.day).slice(0, 10) === day) as unknown as RwSelRow[];
  const latestOf = (t: Record<string, Row[]>) => t.pm_rw_minutes.filter((r) => Date.parse(String(r.minute)) === rwLast) as unknown as RwMinuteRow[];
  const pageInput = {
    rwState: all.tables.pm_rw_state[0] as never, xState: all.tables.pm_rw_x_state[0] as never, selectionAll: all.tables.pm_rw_selection as never,
    today: on(all.tables.pm_rw_selection, "2026-10-01"), latest: latestOf(all.tables), days: all.tables.pm_rw_x_days as never,
    fills: all.tables.pm_rw_fills as never, nowMs,
  };
  // x3 is not a row of the page (Davies, 2026-09-28: it repeats x1 and x2 market by market), nor x2 since 2026-10-02 (the
  // pause did worst); the replay still runs both, and x4 and x5 since 2026-10-07. Variant-3 and -4 are TB1's two, which
  // the replay has not started before 2026-10-08 00:00 UTC: rows that say when they start.
  assertEquals(rwxArmSummaries(pageInput).map((r) => [r.id, r.name, r.notStarted]),
    [["x1", "Reward quotes variant-2", false], ["tb1-skip", "Reward quotes variant-3", true], ["tb1-back", "Reward quotes variant-4", true]]);
  // x2's row as it read while it was on the page, to pin that it is RW-E when there is no jump to pause on.
  const rows = rwxArmSummaries({ ...pageInput, offPage: new Set(["x3", "x4", "x5", "tb1-skip", "tb1-back"]) });
  assertEquals(rows.map((r) => r.id), ["x1", "x2"]);
  // With no jump to pause on, x3's two rules are x1's one: its accounts and its days are x1's to the bit. Before their
  // own minute, 10-03, x4 and x5 are x1 too.
  assertEquals(stored.arms.x3.acc, stored.arms.x1.acc);
  assertEquals([stored.arms.x4.acc, stored.arms.x5.acc], [stored.arms.x1.acc, stored.arms.x1.acc]);
  const armDays = (arm: string) => all.tables.pm_rw_x_days.filter((d) => d.arm === arm).map((d) => [d.day, d.total, d.stress_total, d.reward, d.fills, d.capital, d.markets]);
  assert(armDays("x3").length > 0);
  assertEquals(armDays("x3"), armDays("x1"));
  assertEquals([armDays("x4"), armDays("x5")], [armDays("x1"), armDays("x1")]);
  assert(rows.every((r) => r.checks.ok && r.checks.eDays === 1));
  const t = rwSummary({
    state: truth.tables.pm_rw_state[0] as never, selection: on(truth.tables.pm_rw_selection, "2026-10-01"), latest: latestOf(truth.tables),
    days: truth.tables.pm_rw_days as never, fills: truth.tables.pm_rw_fills as never, firstMinute: null, nowMs,
  })!;
  const e = rweArmSummary({
    rwState: all.tables.pm_rw_state[0] as never, eState: all.tables.pm_rw_e_state[0] as never, selectionAll: all.tables.pm_rw_selection as never,
    today: on(all.tables.pm_rw_selection, "2026-10-01"), latest: latestOf(all.tables), days: all.tables.pm_rw_e_days as never,
    fills: all.tables.pm_rw_fills as never, nowMs,
  })!;
  const keys = ["totalUsd", "stressUsd", "rewardUsd", "fillsPnlUsd", "realisedUsd", "unrealisedUsd", "heldUsd", "todayUsd", "capitalUsd"] as const;
  const book = (x: { markets: Array<Record<string, unknown>> }) => x.markets.map((m) => [m.cond, m.net, m.quoting, m.fills, m.avgCost == null ? null : Number(Number(m.avgCost).toFixed(12)), Number(Number(m.totalUsd).toFixed(9))]);
  for (const [id, want] of [["x1", t], ["x2", e]] as const) {
    const r = rows.find((x) => x.id === id)!;
    for (const k of keys) assertAlmostEquals(Number(r[k]), Number(want[k]), 1e-9, `${id} ${k}`);
    assertEquals([r.open, r.fills, r.quoting], [want.open, want.fills, want.quoting], id);
    assertAlmostEquals(r.mismatchUsd, 0, 1e-9);
    assertEquals(book(r), book(want), id);
    assertEquals(r.days.map((d) => [d.day, d.fills, Number(d.totalUsd.toFixed(9))]), want.days.map((d) => [d.day, d.fills, Number(d.totalUsd.toFixed(9))]), id);
    // The fills its page lists are the ones it made.
    const fl = (x: { recent: Array<{ cond: string; minute: string; side: string; price: number; size: number }> }) => x.recent.map((f) => [f.cond, f.minute, f.side, f.price, f.size]);
    assertEquals(fl(r), fl(want), id);
  }
  // And x1 is not RW-E: the weather markets RW-E quoted, D today among them, are nowhere in it.
  assert(Math.abs(Number(rows[0].totalUsd) - Number(e.totalUsd)) > 0.01);
  assert(e.markets.some((m) => m.cond === D.cond && m.quoting));
  assert(!rows[0].markets.some((m) => [B.cond, C.cond, D.cond].includes(String(m.cond))));
});

// Deviation found 2026-09-27: the pre-registration says RW-E "removes nothing before 2026-09-27 00:00, so RW-E enters
// the twelve days holding exactly what RW held", and replay version 1 removed the same-day markets from RW's first
// minute. Before its twelve days RW-E is RW; a state replayed under version 1 is replayed again from RW's start.
Deno.test("before its twelve days RW-E is RW: a market that ends the day it is quoted is quoted, and held into them", () => {
  const Y = "0xyyy";
  const t = (k: number) => Date.UTC(2026, 8, 25) + k * 60_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const rows = Array.from({ length: 5 }, (_, k) => ({
    cond: Y, minute: iso(t(k)), quoting: true, tick: 0.01, bb: 0.48, ba: 0.52, ab: 0.48, aa: 0.52, q1: 10, q2: 10, m: 0.5, b: 0.49, a: 0.51, reward: 0.1,
  }));
  const fills = [{ cond: Y, minute: iso(t(1)), ts: iso(t(1) + 30e3), side: "bid" as const, price: 0.49, size: 20, print_id: "p1" }];
  const prints = [{ id: "p1", cond: Y, ts: iso(t(1) + 30e3), side: "SELL" as const, oi: 0, price: 0.47, size: 20 }];
  const selection = [{ day: "2026-09-25", cond: Y, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-09-25T20:00:00Z", q: "Y", cat: "weather_fees" }];
  assertEquals(excludedByDay(selection).get("2026-09-25"), new Set([Y]));
  const st = newRweState();
  replayMinutes(st, t(4), { rows, fills, prints, selection, settlements: [], rwDays: [] });
  assertEquals(st.arms.e.acc[Y], st.arms.rw.acc[Y]);
  assertEquals([st.arms.e.acc[Y].net, st.arms.e.acc[Y].fills], [20, 1]);
  assertAlmostEquals(st.arms.e.acc[Y].reward, 0.5, 1e-12);
});

Deno.test("a replay state of an older rule version is replayed again from RW's start", async () => {
  const { db, tables } = await runEngine(true);
  // A version-1 state (no version) that had got as far as T0: the driver must not continue from it.
  tables.pm_rw_e_state.push({ id: 1, state: { lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30), arms: { rw: { acc: {}, dayActive: [] }, e: { acc: {}, dayActive: [] } }, diverged: [], checkMaxUsd: 0 }, last_minute: null } as Row);
  const out = await runPmrwE({ db, now: Date.UTC(2026, 9, 1, 0, 10), holder: "h" });
  assertEquals(out.errors, []);
  assertEquals(out.from, Date.UTC(2026, 8, 25));
  assertEquals((tables.pm_rw_e_state[0].state as RweState).version, RWE_STATE_VERSION);
  // And a version-2 state, which had passed RW-E's first minute without keeping its accounts, is replayed again too.
  tables.pm_rw_e_state[0] = { id: 1, state: { ...newRweState(), version: 2, lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30) }, last_minute: null } as Row;
  tables.agent_locks.find((l) => l.name === "pmrw-e")!.lease_until = new Date(0).toISOString();
  assertEquals((await runPmrwE({ db, now: Date.UTC(2026, 9, 1, 0, 11), holder: "h2" })).from, Date.UTC(2026, 8, 25));
});

// Davies, 2026-09-27: "只从自己rules下的记录才显示" — RW-E's row shows only what it did from its first minute. Y is held
// across it: bought 20 at 49 ¢ at 23:59 with the mid at 50 ¢, sold 20 at 53 ¢ at 00:01; a 0.1 reward each minute.
function acrossRweStart() {
  const Y = "0xyyy";
  const t = (k: number) => RWE_START + k * 60_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const mid = (k: number) => (k < 1 ? 0.5 : 0.52);
  const rows = [-2, -1, 0, 1].map((k) => ({
    cond: Y, minute: iso(t(k)), quoting: true, tick: 0.01, bb: mid(k) - 0.02, ba: mid(k) + 0.02, ab: mid(k) - 0.02, aa: mid(k) + 0.02, q1: 10, q2: 10,
    m: mid(k), b: mid(k) - 0.01, a: mid(k) + 0.01, reward: 0.1,
  }));
  const fills = [
    { cond: Y, minute: iso(t(-1)), ts: iso(t(-1) + 30e3), side: "bid" as const, price: 0.49, size: 20, print_id: "s1" },
    { cond: Y, minute: iso(t(1)), ts: iso(t(1) + 30e3), side: "ask" as const, price: 0.53, size: 20, print_id: "b1" },
  ];
  const prints = [
    { id: "s1", cond: Y, ts: iso(t(-1) + 30e3), side: "SELL" as const, oi: 0, price: 0.47, size: 20 },
    { id: "b1", cond: Y, ts: iso(t(1) + 30e3), side: "BUY" as const, oi: 0, price: 0.55, size: 20 },
  ];
  const selection = ["2026-09-26", "2026-09-27"].map((day) => ({ day, cond: Y, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: "Y", cat: "culture_fees" }));
  return { Y, t, iso, inputs: { rows, fills, prints, selection, settlements: [], rwDays: [] } };
}

Deno.test("RW-E keeps its accounts as its twelve days begin, and its row counts only from there", () => {
  const { Y, t, iso, inputs } = acrossRweStart();
  // The accounts at 23:59's end, replayed on their own: the base must be exactly these.
  const before = { ...newRweState(), lastDecided: t(-3), dayOf: RWE_START - 86400e3 };
  replayMinutes(before, t(-1), inputs);
  const st = { ...newRweState(), lastDecided: t(-3), dayOf: RWE_START - 86400e3 };
  const out = replayMinutes(st, t(1), inputs);
  assertEquals(st.base, before.arms.e.acc);
  assertEquals([st.base![Y].net, st.base![Y].fills, st.base![Y].lastM], [20, 1, 0.5]);
  // The variants' replay keeps the same accounts for its own `e` arm, RW-E being RW-E in both.
  const xs = { ...newRwxState(RWX_SPECS), lastDecided: t(-3), dayOf: RWE_START - 86400e3 };
  replayArms(xs, t(1), inputs, RWX_SPECS);
  assertEquals(xs.arms.e.base, st.base);
  assertEquals(xs.arms.x1.base, undefined);   // its own first minute is a day later

  const sel = (day: string) => inputs.selection.filter((x) => x.day === day).map((x) => ({ ...x, rank: 1, capital: 20 }));
  const row = rweArmSummary({
    rwState: { state: { acc: {}, meta: {} }, last_minute: iso(t(1)), last_error: null },
    eState: { state: st, last_minute: iso(t(1)), last_error: null }, selectionAll: inputs.selection, today: sel("2026-09-27"),
    latest: [{ cond: Y, minute: iso(t(1)), b: 0.51, a: 0.53, m: 0.52, ours: 5, others: 5, qb: true, qa: true }],
    days: out.days as never, fills: inputs.fills, nowMs: t(2),
  })!;
  // By hand, from 00:00: two rewards (0.20), and the 20 it held, carried in at 23:59's 50 ¢ mid and sold at 53 ¢ (0.60).
  assertEquals(row.notStarted, false);
  assertAlmostEquals(row.totalUsd, 0.8, 1e-9);
  assertAlmostEquals(row.rewardUsd, 0.2, 1e-9);
  assertAlmostEquals(row.realisedUsd, 0.8, 1e-9);
  assertAlmostEquals(row.unrealisedUsd, 0, 1e-9);
  assertAlmostEquals(row.todayUsd, 0.8, 1e-9);
  assertEquals([row.fills, row.recent.map((f) => f.minute), row.days.length], [1, [iso(t(1))], 0]);
  assertEquals(row.markets.map((m) => [m.cond, m.fills, Number(Number(m.totalUsd).toFixed(9)), Number(Number(m.rewardUsd).toFixed(9))]), [[Y, 1, 0.8, 0.2]]);
  // One number two ways: the pre-registration's own reading of RW-E, its running total less the close of 09-26.
  const reading = rweSummary({ state: { state: st, last_minute: iso(t(1)), last_error: null }, days: out.days as never, selection: sel("2026-09-27"), nowMs: t(2) })!;
  assertAlmostEquals(reading.e!.totalUsd, row.totalUsd, 1e-12);
  assertAlmostEquals(reading.e!.rewardUsd, row.rewardUsd, 1e-12);
  assertAlmostEquals(reading.e!.stressUsd, row.stressUsd, 1e-12);
  assertEquals(reading.e!.fills, row.fills);

  // Before its first minute, and while a replay has not kept its accounts, the row has nothing in it yet.
  const early = { ...newRweState(), lastDecided: t(-3), dayOf: RWE_START - 86400e3 };
  replayMinutes(early, t(-1), inputs);
  for (const state of [early, { ...st, base: undefined }]) {
    const r = rweArmSummary({
      rwState: { state: { acc: {}, meta: {} }, last_minute: iso(state.lastDecided), last_error: null },
      eState: { state, last_minute: iso(state.lastDecided), last_error: null }, selectionAll: inputs.selection, today: sel("2026-09-27"),
      latest: [], days: out.days as never, fills: inputs.fills, nowMs: state.lastDecided + 60_000,
    })!;
    assertEquals([r.notStarted, r.startsAt, r.totalUsd, r.fills, r.markets.length, r.days.length, r.recent.length], [true, iso(RWE_START), 0, 0, 0, 0, 0]);
    assertEquals(r.catchingUp, false);
  }
  assertEquals(row.catchingUp, false);
  // A replay replaying from RW's start (a new version) is days behind the clock but wrote its state a minute ago: it is
  // catching up, not stopped, before its first minute and after it. Written ten minutes ago, it has stopped.
  const nowMs = RWE_START + 2 * 86400e3;
  for (const [state, wroteAgo, catching] of [[early, 1, true], [st, 1, true], [st, 10, false]] as const) {
    const r = rweArmSummary({
      rwState: { state: { acc: {}, meta: {} }, last_minute: iso(state.lastDecided), last_error: null },
      eState: { state, last_minute: iso(state.lastDecided), last_error: null, updated_at: iso(nowMs - wroteAgo * 60_000) },
      selectionAll: inputs.selection, today: sel("2026-09-27"), latest: [], days: out.days as never, fills: inputs.fills, nowMs,
    })!;
    assertEquals([r.running, r.catchingUp], [false, catching], `${wroteAgo} min`);
  }
});
