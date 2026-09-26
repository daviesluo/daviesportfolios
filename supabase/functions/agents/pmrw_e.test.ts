// RW-E's replay (pmrw_e.ts) against RW's own engine: drive the engine over a UTC midnight with two markets, one of which
// ends that day, then replay what it stored. The rw arm must be RW to the last bit, and the e arm must be what the
// engine itself does when the market that ends that day is left out of the day's selection — the pre-registration's
// definition of RW-E, computed two independent ways.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accStress, accTotal, runPmrw, type RwState } from "./pmrw.ts";
import { excludedByDay, newRweState, replayMinutes, runPmrwE, type RweState } from "./pmrw_e.ts";
import { rweArmSummary, rwSummary, type RwMinuteRow, type RwSelRow } from "./pmrw_view.ts";
import type { PmLevel } from "../_shared/polymarket_public.ts";
import { memDb, type Row } from "./testing.ts";

const A = { cond: "0xaaa", yes: "101", no: "102" }, B = { cond: "0xbbb", yes: "201", no: "202" };
// C ends at noon on 10-01: quoted on 09-30 (it does not end that day) and, when chosen again, left out by RW-E on 10-01.
const C = { cond: "0xccc", yes: "301", no: "302" };
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
/** A portfolio over the midnight: 09-30's A (and B, C), and 10-01's A (and C) when named. */
function portfolio(o: { b: boolean; c: "none" | "first" | "both" }): Row[] {
  const row = (day: string, m: typeof A, rank: number, end: string) =>
    ({ day, cond: m.cond, rank, yes: m.yes, tick: 0.01, v: 3, min_size: 20, rate: 144, per_dollar_day: 1, capital: 20, q: `market ${m.cond}`, cat: "weather_fees", end_date: end, selected_at: `${day}T00:00:01.000Z` } as Row);
  const cEnd = "2026-10-01T12:00:00.000Z";
  return [
    ...selection(o.b),
    ...(o.c !== "none" ? [row("2026-09-30", C, 3, cEnd)] : []),
    row("2026-10-01", A, 1, "2026-10-20T00:00:00.000Z"),
    ...(o.c === "both" ? [row("2026-10-01", C, 2, cEnd)] : []),
  ];
}
function seed(withB: boolean | Row[]) {
  return memDb({
    agent_locks: ["pmrw", "pmrw-select", "pmrw-e"].map((name) => ({ name, lease_until: new Date(0).toISOString(), holder: null } as Row)),
    pm_rw_state: [], pm_rw_minutes: [], pm_rw_prints: [], pm_rw_fills: [], pm_rw_days: [], pm_rw_settlements: [], pm_rw_e_state: [], pm_rw_e_days: [],
    pm_rw_selection: typeof withB === "boolean" ? selection(withB) : withB,
  }, { now: () => Date.now() });
}
function world(): World {
  const w: World = { books: { [A.yes]: book(), [B.yes]: book(), [C.yes]: book() }, prints: [], closed: [], now: 0, cache: new Map() };
  const s = T0 / 1000;
  // A: a SELL through the bid (0.49) twice, then a BUY through the ask (0.51). B: a BUY through the ask, then the same
  // again after midnight, when it is no longer selected.
  w.prints.push(print(A, s + 30, "SELL", 0.45, 30, "0xa1"), print(A, s + 150, "SELL", 0.44, 10, "0xa2"), print(A, s + 400, "BUY", 0.57, 50, "0xa3"));
  w.prints.push(print(B, s + 90, "BUY", 0.56, 25, "0xb1"), print(B, s + 330, "BUY", 0.58, 5, "0xb2"));
  // C: a SELL through the bid before midnight, then after it a BUY through the ask and a SELL through the bid again.
  // A market nobody selects is never read, so the tests without C do not see these.
  w.prints.push(print(C, s + 60, "SELL", 0.45, 20, "0xc1"), print(C, s + 900, "BUY", 0.57, 20, "0xc2"), print(C, s + 1260, "SELL", 0.44, 20, "0xc3"));
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
  all.tables.pm_rw_e_state.push({ id: 1, state: { ...newRweState(), lastDecided: T0 - 60_000, dayOf: Date.UTC(2026, 8, 30) }, last_minute: null } as Row);
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
