// The paper layers' worst case at each day's start (`pm_prep_stress.ts`, 0094), against the in-memory database held to
// 0094's table and to the layers' own, the layers' and paths' tables read-only for it (`onlyTables`).
//
// What is pinned: the replay of a day's records, worked out by hand (rewards summed, fills applied at their minute's
// tick, the last minute with a full book, a settlement the turn at rest would have seen and one it would not); the state
// at rest at a day's end; the recorder's three sources, oldest day first, a few replays a run, a row a replay wrote
// replaced by the layer's own with its figure kept, a fill without a tick refused; and, the point of it all, that the
// replay IS the layer: mini-pool's layer (`pm_prep.ts` as it runs) over RW's golden record moved to straddle midnight,
// decided minute by minute across it, records its own state at rest, and the same record decided in catch-up runs that
// cross midnight inside a run is replayed to the same figure; at every run's end the replay from nothing reproduces the
// layer's stored accounts; and live-prep's path and layer together (its sells of what it holds) across midnight, likewise.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/polymarket/results/rw_golden.json" with { type: "json" };
import { accStress, newAcc, quote, sizeN, type Acc, type BookRow } from "./pmrw.ts";
import {
  firstMinuteOf, PREP_STRESS_TABLE, readReplayInputs, recordPrepStress, replayParts, restBaseline, stressOfParts, type ReplayInputs, type StressParts,
} from "./pm_prep_stress.ts";
import { PREP_DB_TABLES, PREP_INSTANCE, PREP_LOCK, PREP_READS, runPmPrep, type PrepInstance, type PrepState } from "./pm_prep.ts";
import { PM_LP_INSTANCE, PREP_LP_INSTANCE } from "./pm_lp.ts";
import { onTick, pmLpDbTables, runPmLive, type PmLiveConfig } from "./pm_live.ts";
import { prepDbTables, prepReads } from "./pm_prep.ts";
import { prepSummary } from "./pm_prep_view.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";
import fixture from "../../../src/e2e/prep_fixture.json" with { type: "json" };

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const near = (x: number, want: number, what: string, eps = 1e-9) => assertAlmostEquals(x, want, eps, what);

/** The recorder's database: its own table to write; the layer's state, minutes, fills and settlements and the path's minutes to read. */
const stressDb = (db: Parameters<typeof onlyTables>[0], inst: PrepInstance) => {
  const reads = [inst.tables.state, inst.tables.minutes, inst.tables.fills, inst.tables.settlements, inst.reads.minutes];
  return onlyTables(db, [...reads, PREP_STRESS_TABLE], { readOnly: reads });
};

// ------------------------------------------------------------------ by hand

const D0 = Date.parse("2026-10-05T00:00:00Z"), D1 = D0 + DAY;
const at = (hhmm: string, day = D0) => iso(day + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * M);
const part = (p: Partial<Acc>) => ({ reward: 0, cash: 0, net: 0, tickCost: 0, lastM: null, lastAb: null, lastAa: null, settled: null, ...p });

/**
 * By hand. At the day's start: A (rewards 1.00, cash −4.50, 10 YES, ticks 0.10, adjusted touch 0.45 / 0.47) 0.50 − 4.50
 * − 0.10 + 10 × 0.45 = 0.40; C (0.20, +1.00, short 2, 0.02, 0.48 / 0.50) 0.10 + 1.00 − 0.02 − 2 × 0.50 = 0.08; D (0, −0.60,
 * 2, 0.02, 0.29 / 0.31) −0.60 − 0.02 + 2 × 0.29 = −0.04: 0.44 in all. The day: A paid 0.20 and 0.30 and its ask filled 4 at
 * 0.48 (tick 0.01), its last full book 0.46 / 0.48 at 23:50 (23:55's has no adjusted bid; the next day's 00:00 is not
 * the day's); B, new, paid 0.10 and its bid filled 5 at 0.30 (tick 0.001), last full book 0.28 / 0.30; C settled at 1 a
 * minute after midnight (the turn at rest saw it), D at 0 three minutes after (it did not). At the next start: A 0.75 −
 * 2.58 − 0.14 + 6 × 0.46 = 0.79, B 0.05 − 1.50 − 0.005 + 5 × 0.28 = −0.055, C 0.10 + 1.00 − 0.02 − 2 × 1 = −0.92, D −0.04:
 * −0.225; the day's worst case −0.225 − 0.44 = −0.665.
 */
const HAND_BASE: StressParts = {
  A: part({ reward: 1, cash: -4.5, net: 10, tickCost: 0.1, lastM: 0.46, lastAb: 0.45, lastAa: 0.47 }),
  C: part({ reward: 0.2, cash: 1, net: -2, tickCost: 0.02, lastM: 0.49, lastAb: 0.48, lastAa: 0.5 }),
  D: part({ reward: 0, cash: -0.6, net: 2, tickCost: 0.02, lastM: 0.3, lastAb: 0.29, lastAa: 0.31 }),
};
const book = (cond: string, minute: string, tick: number, ab: number | null, aa: number | null) => ({ cond, minute, tick, bb: 0.2, ba: 0.6, ab, aa });
const HAND: ReplayInputs = {
  rewards: [{ cond: "A", minute: at("11:00"), reward: 0.3 }, { cond: "B", minute: at("12:00"), reward: "0.1" }, { cond: "A", minute: at("10:00"), reward: 0.2 }],
  fills: [
    { cond: "B", minute: at("12:00"), ts: at("12:00").replace(":00.000Z", ":30.000Z"), print_id: "p2", side: "bid", price: "0.3", size: "5" },
    { cond: "A", minute: at("10:00"), ts: at("10:00").replace(":00.000Z", ":20.000Z"), print_id: "p1", side: "ask", price: 0.48, size: 4 },
  ],
  minutes: [
    book("A", at("10:00"), 0.01, 0.45, 0.47), book("A", at("23:50"), 0.01, 0.46, 0.48), book("A", at("23:55"), 0.01, null, 0.48), book("A", iso(D1), 0.01, 0.99, 0.99),
    book("B", at("12:00"), 0.001, 0.29, 0.31), book("B", at("22:00"), 0.001, 0.28, 0.30),
  ],
  settlements: [{ cond: "C", payout: 1, settled_at: iso(D1 + M) }, { cond: "D", payout: "0", settled_at: iso(D1 + 3 * M) }],
};

Deno.test("a day replayed by hand: rewards summed, each fill at its minute's tick, the last full book, a settlement the turn at rest saw", () => {
  near(stressOfParts(HAND_BASE), 0.44, "the start: 0.40 + 0.08 − 0.04");
  const out = replayParts(HAND_BASE, D1, HAND);
  const s = (c: string) => accStress({ ...newAcc(), ...out[c] });
  near(s("A"), 0.79, "A: 0.75 − 2.58 − 0.14 + 6 × 0.46"); near(s("B"), -0.055, "B: 0.05 − 1.50 − 0.005 + 5 × 0.28");
  near(s("C"), -0.92, "C settled at 1"); near(s("D"), -0.04, "D's settlement came after the turn at rest");
  near(stressOfParts(out), -0.225, "the next start");
  assertEquals([out.A.net, out.B.net, out.C.settled, out.D.settled, out.A.lastAb, out.A.lastAa, out.B.lastAb], [6, 5, 1, null, 0.46, 0.48, 0.28]);
  // The base is not changed in place.
  assertEquals(HAND_BASE.A.net, 10);
  // A fill whose minute the path has no tick for is refused: no figure that cannot be reproduced.
  let threw = "";
  try { replayParts(HAND_BASE, D1, { ...HAND, minutes: HAND.minutes.filter((m) => m.cond !== "B") }); } catch (e) { threw = (e as Error).message; }
  assert(/no tick for the fill of B/.test(threw), threw);
});

Deno.test("the state at rest: its last decided minute is 23:59 UTC, so its accounts are the next day's start; at any other minute, none", () => {
  const st = (lastDecided: number) => ({ version: 1, lastDecided, acc: { A: { ...newAcc(), ...HAND_BASE.A }, D: { ...newAcc(), ...HAND_BASE.D } } }) as unknown as PrepState;
  const r = restBaseline(st(D1 - M))!;
  assertEquals(r.day, "2026-10-06");
  near(r.stress, 0.36, "A 0.40 and D −0.04");
  assertEquals(restBaseline(st(D1 - 2 * M)), null);
  assertEquals(restBaseline(st(D1)), null);
  // The first minute a layer decides: its state starts the lag and a minute behind the run that made it.
  assertEquals(iso(firstMinuteOf("2026-10-04T17:55:02.004Z")), "2026-10-04T17:53:00.000Z");
});

/** A layer's tables with a record: its state at `lastDecided`, and the minutes and fills of HAND moved to its names. */
function recorderWorld(lastDecided: number, startedAt: string, rows: Row[] = []) {
  const inst = PREP_INSTANCE;
  const acc = Object.fromEntries(Object.entries(replayParts(HAND_BASE, D1, HAND)).map(([c, p]) => [c, { ...newAcc(), ...p }]));
  const mem = memDb({
    [inst.tables.state]: [{ id: 1, state: { version: 1, startedAt, lastDecided, dayOf: Math.floor((lastDecided + M) / DAY) * DAY, acc }, last_minute: iso(lastDecided) }],
    [inst.tables.minutes]: HAND.rewards.map((r) => ({ minute: r.minute, cond: r.cond, class: "matched", reward: Number(r.reward) })),
    [inst.tables.fills]: HAND.fills.map((f) => ({ ...f, token: `${f.cond}-Y`, token_side: "BUY", token_price: 0.5, close_only: false })),
    [inst.tables.settlements]: HAND.settlements.map((s) => ({ ...s, yes_token: `${s.cond}-Y`, no_token: `${s.cond}-N` })),
    [inst.reads.minutes]: HAND.minutes.map((m) => ({ mode: "dry_run", rate: 8, ...m })),
    [PREP_STRESS_TABLE]: rows,
  }, { now: () => lastDecided + 3 * M });
  return { mem, db: stressDb(mem.db, inst), inst, rows: () => (mem.tables[PREP_STRESS_TABLE] as Row[]).slice().sort((a, b) => String(a.day).localeCompare(String(b.day))) };
}

Deno.test("the recorder: the first day's row, then each missing day replayed from the day before's, oldest first, a few a run", async () => {
  // Started on 10-03 at 12:00; at rest at 10-05's end. Nothing recorded yet: the start, 10-04, 10-05 (two replays this
  // run), and the layer's own state for 10-06.
  const w = recorderWorld(D1 - M, "2026-10-03T12:00:00.000Z");
  const r = await recordPrepStress(w.db, w.inst, 2);
  assertEquals(r.errors, []);
  assertEquals(r.wrote.map((x) => [x.day, x.source]), [["2026-10-06", "recorded"], ["2026-10-03", "start"], ["2026-10-04", "replay"], ["2026-10-05", "replay"]]);
  // The record has nothing before 10-05, so 10-04 and 10-05 start at 0; 10-06 is the day of HAND on nothing: its accounts
  // less HAND_BASE's, which the state here does carry (it was made as HAND on HAND_BASE).
  assertEquals(w.rows().map((x) => [x.day, x.source, Number(Number(x.stress).toFixed(6))]), [
    ["2026-10-03", "start", 0], ["2026-10-04", "replay", 0], ["2026-10-05", "replay", 0], ["2026-10-06", "recorded", -0.225],
  ]);
  // Its own table written; the layer's read. The path's minutes only for a market that filled or holds: none in these windows.
  assertEquals([...w.db.touched].sort(), [PREP_STRESS_TABLE, w.inst.tables.fills, w.inst.tables.minutes, w.inst.tables.settlements, w.inst.tables.state].sort());
  // A second run finds nothing to do.
  assertEquals((await recordPrepStress(w.db, w.inst, 2)).wrote, []);
});

Deno.test("a replayed day's row is replaced by the layer's own at rest, its figure kept beside it; a replay waits for the day before's row", async () => {
  // 10-05 replayed from a row of 10-04 that holds HAND_BASE: exactly the hand-worked day, −0.225.
  const prior = { layer: PREP_LOCK, day: "2026-10-04", stress: 9, parts: HAND_BASE, source: "recorded" };
  const w = recorderWorld(D1 + 10 * M, "2026-10-04T12:00:00.000Z", [{ layer: PREP_LOCK, day: "2026-10-04", stress: 0, parts: {}, source: "start" }, { ...prior, day: "2026-10-05", stress: 0.44 }]);
  const r = await recordPrepStress(w.db, w.inst, 5);
  assertEquals(r.wrote.map((x) => [x.day, x.source]), [["2026-10-06", "replay"]]);
  near(r.wrote[0].stress, -0.225, "HAND on HAND_BASE");
  // Then the layer at rest at 10-06's end with the same accounts: its own row replaces the replay's, which it keeps.
  const st = (w.mem.tables[w.inst.tables.state] as Row[])[0].state as PrepState;
  st.lastDecided = D1 + DAY - M;
  const r2 = await recordPrepStress(w.db, w.inst, 5);
  assertEquals(r2.wrote.map((x) => [x.day, x.source]), [["2026-10-07", "recorded"]]);
  // And with nothing for 10-06 (removed), the replay of 10-07 waits for it: 10-06 first, from 10-05.
  w.mem.tables[PREP_STRESS_TABLE] = (w.mem.tables[PREP_STRESS_TABLE] as Row[]).filter((x) => x.day !== "2026-10-06");
  st.lastDecided = D1 + DAY + 5 * M;
  const r3 = await recordPrepStress(w.db, w.inst, 1);
  assertEquals(r3.wrote.map((x) => [x.day, x.source]), [["2026-10-06", "replay"]]);
  // A row a replay wrote is replaced by the state at rest, its figure kept.
  const w2 = recorderWorld(D1 - M, "2026-10-04T12:00:00.000Z", [{ ...prior, day: "2026-10-06", stress: 1.5, source: "replay" }]);
  await recordPrepStress(w2.db, w2.inst, 0);
  const row = w2.rows().find((x) => x.day === "2026-10-06")!;
  assertEquals([row.source, Number(Number(row.stress).toFixed(6)), row.detail], ["recorded", -0.225, { replaced: { source: "replay", stress: 1.5 } }]);
});

Deno.test("the recorder never throws: a fill without its tick is an error and no row; a layer with no state writes nothing", async () => {
  const w = recorderWorld(D1 + 10 * M, "2026-10-04T12:00:00.000Z", [{ layer: PREP_LOCK, day: "2026-10-05", stress: 0.44, parts: HAND_BASE, source: "recorded" }, { layer: PREP_LOCK, day: "2026-10-04", stress: 0, parts: {}, source: "start" }]);
  w.mem.tables[w.inst.reads.minutes] = (w.mem.tables[w.inst.reads.minutes] as Row[]).filter((m) => m.cond !== "B");
  const r = await recordPrepStress(w.db, w.inst, 5);
  assertEquals(r.wrote, []);
  assert(/no tick for the fill of B/.test(r.errors.join()), r.errors.join());
  const none = memDb({ [PREP_INSTANCE.tables.state]: [], [PREP_STRESS_TABLE]: [] }, { now: () => D1 });
  assertEquals(await recordPrepStress(stressDb(none.db, PREP_INSTANCE), PREP_INSTANCE), { layer: PREP_LOCK, wrote: [], errors: [] });
});

Deno.test("the page's days: a day's worst case is the next start less its own, today's the running one less today's start; without both, a dash", () => {
  // deno-lint-ignore no-explicit-any
  const F = fixture as any;
  const view = (stressDays: Array<{ day: string; stress: number }>) => prepSummary({ ...F.input, stressDays })!;
  const full = view(F.input.stressDays);
  near(full.days[0].stressUsd!, 0.64, "16 Sep"); near(full.todayStressUsd!, 0.36, "today");
  // No row for 16 Sep's start: its day is a dash; today's still has its start.
  const noStart = view([{ day: "2026-09-17", stress: 0.64 }]);
  assertEquals([noStart.days[0].stressUsd, noStart.todayStressUsd], [null, 0.36]);
  // No row for today's start: today's is a dash, and so is 16 Sep's, which ends there.
  const noToday = view([{ day: "2026-09-16", stress: 0 }]);
  assertEquals([noToday.days[0].stressUsd, noToday.todayStressUsd], [null, null]);
  // None at all (the table not there yet): what the page showed before 0094, the running figure alone.
  const none = prepSummary({ ...F.input, stressDays: undefined })!;
  assertEquals([none.days[0].stressUsd, none.todayStressUsd, none.stressUsd], [null, null, 1]);
});

// ------------------------------------------------------------------ the replay is the layer: mini-pool's, on RW's golden record

type Print = [ts: number, side: "BUY" | "SELL", oi: number, price: number, size: number];
type GMarket = { rate: number; v: number; min_size: number; tick: number | null; series: Array<[number, BookRow | null]>; prints: Print[] };
const G = golden as unknown as { markets: Record<string, GMarket> };
/** RW's golden record (09-24 02:42 → 10:41 UTC) moved 17 h 18 min later: 20:00 on 09-24 → 03:59 on 09-25, across midnight. */
const SHIFT = (17 * 60 + 18) * M;
const MIDNIGHT = Date.parse("2026-09-25T00:00:00Z");
const CONFIG: PmLiveConfig & { id: number } = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 2, select_budget_usd: 40,
};

/** The public reads the layer makes, from the record: every market's prints (Polymarket's data API), Gamma's closed markets. */
function pubFetch(prints: Map<string, Print[]>, closed: Map<string, number>): typeof fetch {
  return (input: string | URL | Request) => {
    const u = new URL(String(input));
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (u.host === "data-api.polymarket.com" && u.pathname === "/v2/trades") {
      const c = u.searchParams.get("condition") ?? "";
      const rows = (prints.get(c) ?? []).slice().sort((a, b) => b[0] - a[0]).map(([ts, side, oi, price, size], i) => ({
        timestamp: ts, side, outcome_index: oi, price, size, token_id: `${c.slice(-6)}${oi}`, transaction_hash: `0x${c.slice(-8)}${ts}${i}`, proxy_wallet: "0xabc",
      }));
      return json({ data: rows, pagination: { next_cursor: "" } });
    }
    if (u.host === "gamma-api.polymarket.com" && u.pathname === "/markets/keyset") {
      const ids = u.searchParams.getAll("condition_ids");
      const markets = u.searchParams.get("closed") === "true" ? ids.filter((c) => closed.has(c)).map((c) => ({
        conditionId: c, clobTokenIds: JSON.stringify([`${c}-Y`, `${c}-N`]), closed: true, closedTime: "2026-09-25 01:00:00+00",
        outcomePrices: JSON.stringify([String(closed.get(c)), String(1 - closed.get(c)!)]),
      })) : [];
      return json({ markets });
    }
    return Promise.resolve(new Response(JSON.stringify({ error: `not faked: ${u.href}` }), { status: 404 }));
  };
}

/** The path's record of the golden markets, as its dry-run writes it: each minute's row, and RW's quote resting from the turn that placed it. */
function goldenRecord() {
  const minutes: Row[] = [], orders: Row[] = [], markets: Row[] = [], prints = new Map<string, Print[]>();
  let id = 1;
  for (const [c, mk] of Object.entries(G.markets)) {
    const tick = mk.tick || 0.01, N = sizeN(mk.min_size), tk = tick === 0.001 ? "0.001" : "0.01";
    let cur: number[] | null = null, curQ: { b: number; a: number } | null = null;
    const close = (t: number) => { for (const o of orders) if (cur?.includes(Number(o.id))) Object.assign(o, { state: "cancelled", cancelled_at: iso(t + 1200) }); cur = null; curQ = null; };
    for (const [sec, row] of mk.series) {
      const t = sec * 1000 + SHIFT;
      minutes.push({
        mode: "dry_run", minute: iso(t), cond: c, rate: Math.min(mk.rate, 9.99), max_spread: mk.v, min_size: mk.min_size, tick,
        bb: row?.[0] ?? null, ba: row?.[1] ?? null, ab: row?.[2] ?? null, aa: row?.[3] ?? null, q1: row?.[4] ?? null, q2: row?.[5] ?? null, detail: {},
      });
      const q = row ? quote(row, tick) : null;
      const b = q ? onTick(q.b, tk) : null, a = q ? onTick(q.a, tk) : null;
      if (curQ && (b === null || curQ.b !== b || curQ.a !== a)) close(t);
      if (b !== null && a !== null && !cur) {
        const mk1 = (outcome: "yes" | "no", price: number) => ({
          id: id++, ts: iso(t + 2500), mode: "dry_run", cond: c, token: `${c}-${outcome === "yes" ? "Y" : "N"}`, outcome, side: "BUY", price, size: N, state: "live",
          cancelled_at: null, request: { timestamp: String(t + 1500) }, book_seen: { minSize: mk.min_size },
        });
        const ob = mk1("yes", b), oa = mk1("no", onTick(1 - a, tk));
        orders.push(ob, oa);
        cur = [ob.id, oa.id]; curQ = { b, a };
      }
    }
    for (const day of ["2026-09-24", "2026-09-25"]) markets.push({ day, cond: c, yes_token: `${c}-Y`, no_token: `${c}-N` });
    prints.set(c, mk.prints.map(([ts, side, oi, price, size]) => [ts + SHIFT / 1000, side, oi, price, size] as Print));
  }
  return { minutes, orders, markets, prints };
}

function goldenWorld() {
  const rec = goldenRecord();
  const first = Date.parse("2026-09-24T20:00:00Z");
  const startedAt = iso(first + 2 * M + 30e3);              // its first decided minute is 20:00, as `newState` sets it
  const mem = memDb({
    agent_locks: [{ name: PREP_LOCK, lease_until: iso(0), holder: null }],
    pm_live_config: [{ ...CONFIG }], pm_live_markets: rec.markets, pm_live_minutes: rec.minutes, pm_live_orders: rec.orders,
    pm_prep_state: [], pm_prep_minutes: [], pm_prep_prints: [], pm_prep_fills: [], pm_prep_days: [], pm_prep_settlements: [], pm_prep_events: [],
    [PREP_STRESS_TABLE]: [],
  }, { now: () => Date.parse(startedAt) });
  const closed = new Map<string, number>();
  const layer = onlyTables(mem.db, PREP_DB_TABLES, { lease: PREP_LOCK, readOnly: PREP_READS });
  const rec2 = stressDb(mem.db, PREP_INSTANCE);
  const errors: string[] = [];
  let checked = 0;
  const w = {
    mem, closed, errors, startedAt, first,
    get checked() { return checked; },
    state: () => (mem.tables.pm_prep_state as Row[])[0]?.state as PrepState,
    /** One run of the layer at `now`, then the recorder, as the action runs them. */
    async turn(now: number) {
      const r = await runPmPrep({ db: layer, now, holder: `h${now}`, pm: { fetchImpl: pubFetch(rec.prints, closed) } });
      errors.push(...r.errors);
      const s = await recordPrepStress(rec2, PREP_INSTANCE, 10);
      errors.push(...s.errors);
      return r;
    },
    /** The replay from nothing over everything the layer has decided reproduces its stored accounts, market by market. */
    async check() {
      const st = w.state(), x = st.lastDecided + M, from = firstMinuteOf(st.startedAt);
      const parts = replayParts({}, x, await readReplayInputs(rec2, PREP_INSTANCE, {}, from, x));
      for (const c of new Set([...Object.keys(st.acc), ...Object.keys(parts)])) {
        const a = st.acc[c] ?? newAcc(), p = { ...newAcc(), ...parts[c] };
        for (const k of ["reward", "cash", "net", "tickCost"] as const) near(p[k], a[k], `${c.slice(0, 10)} ${k} at ${iso(x)}`);
        assertEquals(p.settled, a.settled ?? null, `${c.slice(0, 10)} settled`);
        // The touch where it counts: a market that holds something and has not settled (a settled one is at its payout).
        if (Math.abs(a.net) > 1e-12 && a.settled == null) assertEquals([p.lastAb, p.lastAa], [a.lastAb, a.lastAa], `${c.slice(0, 10)} touch at ${iso(x)}`);
        near(accStress(p), accStress(a), `${c.slice(0, 10)} worst case at ${iso(x)}`);
      }
      checked++;
    },
    rows: () => (mem.tables[PREP_STRESS_TABLE] as Row[]).slice().sort((a, b) => String(a.day).localeCompare(String(b.day))),
  };
  // The layer's state as `newState` makes it at `startedAt`.
  mem.tables.pm_prep_state = [{
    id: 1, state: { version: 1, startedAt, lastDecided: first - M, dayOf: Math.floor(first / DAY) * DAY, statusAt: 0, acc: {}, tokens: {}, marks: {}, stopDay: null, stopTotal: null,
      day: { reward: 0, fills: 0, matched: 0, dark: 0, diverged: 0, missing: 0, markets: [] }, pnl: null }, last_minute: null, updated_at: startedAt, last_error: null,
  }];
  return w;
}
const end = Date.parse("2026-09-25T04:00:00Z");
/** The run whose minute less the two-minute lag is `minute`: it decides up to `minute`. */
const runAt = (minute: number) => minute + 2 * M + 30e3;
/** The next run's last minute: `step` minutes at a time, but one a minute within `near` minutes of midnight. */
const nextMinute = (t: number, step: number, nearMin: number) =>
  t < MIDNIGHT - nearMin * M ? Math.min(t + step * M, MIDNIGHT - nearMin * M) : t < MIDNIGHT + nearMin * M ? t + M : Math.min(t + step * M, end);

Deno.test("mini-pool's layer across midnight, minute by minute: it records its own state at rest, and at every run the replay of its records is its accounts", async () => {
  const w = goldenWorld();
  // Runs of 37 minutes to 23:50, then one a minute to 00:10, then 37 again; a market settles at 01:00 (its YES at 1).
  let t = w.first - M;
  while (t < end) {
    t = nextMinute(t, 37, 10);
    if (t >= MIDNIGHT + 60 * M && !w.closed.size) w.closed.set(Object.keys(G.markets).find((c) => Math.abs(w.state().acc[c]?.net ?? 0) > 0)!, 1);
    await w.turn(runAt(t));
    await w.check();
  }
  assertEquals(w.errors, []);
  const st = w.state();
  assert(Object.values(st.acc).filter((a) => a.fills > 0).length >= 10, "the golden markets filled");
  assert(Object.values(st.acc).some((a) => a.settled === 1), "and one settled");
  assert((w.mem.tables.pm_prep_fills as Row[]).some((f) => f.close_only), "some after a stop, close-only");
  // Its rows: the first day's start, and the layer's own state at rest for the next.
  assertEquals(w.rows().map((r) => [r.day, r.source]), [["2026-09-24", "start"], ["2026-09-25", "recorded"]]);
  // The same day replayed from the start's row is the layer's own figure.
  const rec = w.rows()[1];
  const replay = replayParts({}, MIDNIGHT, await readReplayInputs(stressDb(w.mem.db, PREP_INSTANCE), PREP_INSTANCE, {}, w.first, MIDNIGHT));
  near(stressOfParts(replay), Number(rec.stress), "the replay of 09-24 is the layer's state at rest");
  assert(Math.abs(Number(rec.stress)) > 1, `a figure worth checking: ${rec.stress}`);
  assert(w.checked > 20);
});

Deno.test("the same record decided in catch-up runs that cross midnight inside a run: the day is replayed, to the layer's own figure at rest", async () => {
  const atRest = goldenWorld();
  for (let t = atRest.first - M; t < end;) { t = nextMinute(t, 45, 5); await atRest.turn(runAt(t)); }
  const caught = goldenWorld();
  // 240 minutes a run (a catch-up's most): 20:00–23:59 and 00:00 … in the same runs as the minutes either side.
  for (let t = caught.first - M; t < end;) { t = Math.min(t + 233 * M, end); await caught.turn(runAt(t)); await caught.check(); }
  assertEquals([...atRest.errors, ...caught.errors], []);
  assertEquals(caught.rows().map((r) => [r.day, r.source]), [["2026-09-24", "start"], ["2026-09-25", "replay"]]);
  assertEquals(atRest.rows().map((r) => [r.day, r.source]), [["2026-09-24", "start"], ["2026-09-25", "recorded"]]);
  near(Number(caught.rows()[1].stress), Number(atRest.rows()[1].stress), "replayed = recorded");
});

// ------------------------------------------------------------------ the replay is the layer: live-prep's path and layer together

const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${9000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
const LP_T0 = Date.parse("2026-10-05T10:00:30Z");
const LP_CONFIG = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 100, loss_day_usd: null, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 10, select_budget_usd: 200,
  created_at: "2026-10-04T18:00:00.000Z", updated_at: "2026-10-04T18:00:00.000Z",
};

Deno.test("live-prep's path and layer across midnight, its sells of what it holds among the fills: recorded at rest, and the replay is its accounts", async () => {
  const clock = { now: LP_T0 };
  const pm = new FakePolymarket(() => clock.now);
  const L1 = pm.addMarket({ cond: cond(1), yes: tok(1, "yes"), no: tok(1, "no"), rate: 12, sponsoredRate: null, minSize: 5, depth: [[0, 5]] });
  pm.addMarket({ cond: cond(2), yes: tok(2, "yes"), no: tok(2, "no"), rate: 40, sponsoredRate: null, minSize: 5, bid: 0.3, ask: 0.32, depth: [[0, 50]] });
  const mem = memDb({
    agent_locks: [{ name: "pm-lp", lease_until: iso(0), holder: null }, { name: "pm-lpprep", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_lp_config: [{ ...LP_CONFIG }],
    ...Object.fromEntries([...Object.values(PM_LP_INSTANCE.tables).filter((t) => t !== "pm_lp_config"), ...Object.values(PREP_LP_INSTANCE.tables)].map((t) => [t, []])),
    pm_live_config: [{ ...LP_CONFIG, cap_market_usd: 60, loss_day_usd: 25, max_markets: 8, select_budget_usd: 160 }], pm_mid_config: [{ ...LP_CONFIG, cap_market_usd: 60, loss_day_usd: 25 }],
    [PREP_STRESS_TABLE]: [],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, pmLpDbTables(PM_LP_INSTANCE), { lease: "pm-lp", readOnly: ["agent_risk", ...Object.values(PM_LP_INSTANCE.lp!.paper)] });
  const prepDb = onlyTables(mem.db, prepDbTables(PREP_LP_INSTANCE), { lease: "pm-lpprep", readOnly: prepReads(PREP_LP_INSTANCE) });
  const recDb = stressDb(mem.db, PREP_LP_INSTANCE);
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1;
  const errors: string[] = [];
  const turn = async (t: number) => {
    clock.now = t;
    const r = await runPmLive({
      db, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true, account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
      signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now, inst: PM_LP_INSTANCE, pm: { fetchImpl: pm.publicFetch },
    });
    errors.push(...r.errors.filter((e) => !/pUSD|LOSS STOP/.test(e)));
    clock.now = t + 5e3;
    const p = await runPmPrep({ db: prepDb, now: t + 5e3, holder: `p${t}`, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now }, inst: PREP_LP_INSTANCE });
    errors.push(...p.errors);
    errors.push(...(await recordPrepStress(recDb, PREP_LP_INSTANCE, 10)).errors);
  };
  // L1: SELLs of YES through our bid at 10:00–10:03 (the paper buys YES); at 23:55–00:04 BUYs of YES through our ask (it
  // sells them, live-prep's sell of what it holds, either side of midnight).
  const s0 = Math.floor(LP_T0 / 1000) - 30, mid = Date.parse("2026-10-06T00:00:00Z") / 1000;
  pm.prints.set(L1.cond, [
    ...Array.from({ length: 4 }, (_, k): Print => [s0 + k * 60 + 10, "SELL", 0, 0.44, 5]),
    ...Array.from({ length: 10 }, (_, k): Print => [mid + (k - 5) * 60 + 20, "BUY", 0, 0.48, 3]),
  ]);
  for (let k = 0; k < 6; k++) await turn(LP_T0 + k * M);
  for (let t = Date.parse("2026-10-05T23:48:30Z"); t <= Date.parse("2026-10-06T00:10:30Z"); t += M) await turn(t);
  assertEquals(errors, []);
  const rows = (mem.tables[PREP_STRESS_TABLE] as Row[]).slice().sort((a, b) => String(a.day).localeCompare(String(b.day)));
  assertEquals(rows.map((r) => [r.day, r.source]), [["2026-10-05", "start"], ["2026-10-06", "recorded"]]);
  const fills = mem.tables.pm_lpprep_fills as Row[];
  const sells = (day: string) => fills.filter((f) => f.token_side === "SELL" && String(f.minute).startsWith(day)).length;
  assert(fills.length > 0 && sells("2026-10-05") > 0 && sells("2026-10-06") > 0, `sells either side of midnight: ${sells("2026-10-05")} / ${sells("2026-10-06")}`);
  // The day replayed from its start's row is the layer's own state at rest.
  const st = (mem.tables.pm_lpprep_state as Row[])[0].state as PrepState, from = firstMinuteOf(st.startedAt);
  const day1 = Date.parse("2026-10-06T00:00:00Z");
  near(stressOfParts(replayParts({}, day1, await readReplayInputs(recDb, PREP_LP_INSTANCE, {}, from, day1))), Number(rows[1].stress), "replayed = recorded");
  // And to its last decided minute, the replay is its accounts.
  const x = st.lastDecided + M;
  const parts = replayParts({}, x, await readReplayInputs(recDb, PREP_LP_INSTANCE, {}, from, x));
  for (const [c, a] of Object.entries(st.acc)) near(accStress({ ...newAcc(), ...parts[c] }), accStress(a), `${c.slice(-4)} at ${iso(x)}`);
  near(stressOfParts(parts), stressOfParts(st.acc), "the running worst case");
  assert(Math.abs(stressOfParts(st.acc) - Number(rows[1].stress)) > 1e-6, "today moved it");
});
