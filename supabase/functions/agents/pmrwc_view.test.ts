// RW-C on the Agents page (pmrw_view.ts's `rwcSummary`): the dashboard's `rwc`, RW's own summary of RW-C's own engine
// run against its fourteen days, 2026-10-09 → 10-23 UTC — from before the engine has a state at all, through its
// warm-up, which counts nowhere, to after its end. And the variant rows (x1, tb1-skip, tb1-back), which read RW's replay
// until RW-C's first minute and RW-C's from it (`rwxPageReplay`, `readRwxRows`), pinned on both sides of that instant;
// and "Reward quotes" and "Reward quotes variant-1", which do the same with RW's engine run and RW-E's replay
// (`readRwPage`, `rwPageRun`, `rwePageReplay`; Davies, 2026-10-08: RW-C is RW's round 2, no row of its own).

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RWC_INSTANCE, RWC_RUN_END, RWC_RUN_START, RWC_WARM_UP } from "./pmrw.ts";
import { RW_FUNDED_USD, RW_PAGE_SWITCH, RWX_PAGE_SWITCH, rwcSummary, rwePageReplay, rwPageRun, rwSummary, rwxPageReplay, type RwFillRow } from "./pmrw_view.ts";
import { RWCX_REPLAY, RWX_REPLAY, RWX_START, RWX_STATE_VERSION } from "./pmrw_x.ts";
import { RWCE_REPLAY, RWE_REPLAY, RWE_STATE_VERSION } from "./pmrw_e.ts";
import { RW_INSTANCE } from "./pmrw.ts";
import { readRwPage, readRwxRows } from "./index.ts";
import { memDb, onlyTables, type Row } from "./testing.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const A = { cond: "0xaaa", yes: "101" };

Deno.test("rwcSummary before its warm-up is nothing; in it, before a state, a row that says when it starts, not running once late", () => {
  const empty = { state: null, selection: [], latest: [], days: [], fills: [] };
  // Off the page until its warm-up begins, 2026-10-08 00:00 UTC (Davies, 2026-09-28): no summary, so no row.
  assertEquals(rwcSummary({ ...empty, nowMs: Date.UTC(2026, 8, 28, 9) }), null);
  assertEquals(rwcSummary({ ...empty, nowMs: RWC_WARM_UP - 1 }), null);
  assertEquals(rwcSummary({ ...empty, state: { state: {}, last_minute: null, last_error: null }, nowMs: RWC_WARM_UP - M }), null);
  const now = RWC_WARM_UP + 5 * M;
  const r = rwcSummary({ ...empty, nowMs: now })!;
  assertEquals([r.notStarted, r.startsAt, r.running, r.finished, r.catchingUp, r.lastMinute, r.phase, r.fundedUsd],
    [true, "2026-10-09T00:00:00.000Z", true, false, false, null, "warm-up", RW_FUNDED_USD]);
  assertEquals([r.runStart, r.runEnd], ["2026-10-09T00:00:00.000Z", "2026-10-23T00:00:00.000Z"]);
  assertEquals([r.totalUsd, r.realisedUsd, r.unrealisedUsd, r.todayUsd, r.heldUsd, r.open, r.fills, r.quoting, r.markets, r.days, r.recent],
    [0, 0, 0, 0, 0, 0, 0, 0, [], [], []]);
  // Its warm-up begins 2026-10-08 00:00; ten minutes in, a state still missing is a run that has not started.
  assertEquals(rwcSummary({ ...empty, nowMs: RWC_WARM_UP + 9 * M })!.running, true);
  assertEquals(rwcSummary({ ...empty, nowMs: RWC_WARM_UP + 11 * M })!.running, false);
  // A state row the engine never filled reads the same as none.
  assertEquals(rwcSummary({ ...empty, state: { state: {}, last_minute: null, last_error: null }, nowMs: now })!.notStarted, true);
});

Deno.test("rwcSummary from RW-C's own records: nothing of the warm-up, its days from 10-09, today against its own yesterday", () => {
  const acc = (o: Record<string, number | null>) => ({ net: 0, cash: 0, reward: 0, fills: 0, fillShares: 0, tickCost: 0, firstCap: 20, maxInvCost: 0, lastM: 0.5, lastAb: 0.49, lastAa: 0.51, quotedMinutes: 1, settled: null, ...o });
  const fill = (minute: number, side: "bid" | "ask", price: number, id: string): RwFillRow => ({ cond: A.cond, minute: iso(minute), ts: iso(minute + 20e3), side, price, size: 20, print_id: id });
  // A warm-up round trip on 10-08 (its book closed at the start), and on 10-10 20 Yes bought at 49 ¢, marked at 50 ¢.
  const fills = [fill(RWC_WARM_UP + 3600e3, "bid", 0.40, "w1"), fill(RWC_WARM_UP + 7200e3, "ask", 0.60, "w2"), fill(RWC_RUN_START + DAY + 600e3, "bid", 0.49, "r1")];
  const days = [
    { day: "2026-10-08", total: 9, stress_total: 9, reward: 5, fills: 2, capital: 30, markets: 1, detail: { phase: "warm-up" } },
    { day: "2026-10-09", total: 3, stress_total: 2, reward: 3, fills: 0, capital: 20, markets: 1, detail: { phase: "run" } },
  ];
  const st = (dayOf: number, lastDecided: number) => ({
    state: { lastDecided, dayOf, statusAt: 0, dayActive: [A.cond], meta: { [A.cond]: { yes: A.yes, v: 3, minSize: 20, rate: 144, tick: 0.01, q: "market A", cat: null, day: "2026-10-10" } },
      acc: { [A.cond]: acc({ net: 20, cash: -9.8, reward: 3.5, fills: 1 }) } },
    last_minute: iso(lastDecided), last_error: null, updated_at: iso(lastDecided + 90e3),
  });
  const today = [{ day: "2026-10-10", cond: A.cond, rank: 1, rate: 144, v: 3, min_size: 20, capital: 20, q: "market A", cat: null, end_date: null }];
  const now = RWC_RUN_START + DAY + 3600e3;
  const r = rwcSummary({ state: st(RWC_RUN_START + DAY, now - 2 * M), selection: today, latest: [], days, fills, nowMs: now })!;
  // By hand: 3.50 of rewards, and 20 × (50 − 49) ¢ open: 3.70; 10-09 closed at 3, so today is 0.70.
  assertEquals([r.notStarted, r.phase, r.dayOfRun, r.running, r.startedAt], [false, "run", 2, true, "2026-10-09T00:00:00.000Z"]);
  assertAlmostEquals(r.totalUsd, 3.7, 1e-9);
  assertAlmostEquals(r.todayUsd, 0.7, 1e-9);
  assertAlmostEquals(r.unrealisedUsd, 0.2, 1e-9);
  assertAlmostEquals(r.realisedUsd, 3.5, 1e-9);
  assertEquals([r.fills, r.recent.map((f) => f.minute)], [1, [iso(RWC_RUN_START + DAY + 600e3)]]);
  assertEquals(r.days.map((d) => [d.day, d.phase, d.totalUsd]), [["2026-10-09", "run", 3]]);
  // The same records read as RW's page reads RW's give the same figures: it is RW's summary against RW-C's days.
  const same = rwSummary({ state: st(RWC_RUN_START + DAY, now - 2 * M), selection: today, latest: [], days, fills, firstMinute: null, nowMs: now, inst: RWC_INSTANCE });
  assertEquals([same?.totalUsd, same?.todayUsd, same?.fills], [r.totalUsd, r.todayUsd, r.fills]);
  // During its warm-up it says when it starts; after its fourteen days it is finished.
  const warm = rwcSummary({ state: st(RWC_WARM_UP, RWC_WARM_UP + 3600e3), selection: [], latest: [], days: [], fills, nowMs: RWC_WARM_UP + 3600e3 + 2 * M })!;
  assertEquals([warm.notStarted, warm.phase, warm.running, warm.startsAt, warm.totalUsd, warm.fills], [true, "warm-up", true, "2026-10-09T00:00:00.000Z", 0, 0]);
  const stalled = rwcSummary({ state: st(RWC_WARM_UP, RWC_WARM_UP + 3600e3), selection: [], latest: [], days: [], fills, nowMs: RWC_WARM_UP + 3600e3 + 30 * M })!;
  assertEquals([stalled.notStarted, stalled.running, stalled.lagMinutes], [true, false, 30]);
  const done = rwcSummary({ state: st(RWC_RUN_END, RWC_RUN_END - M), selection: [], latest: [], days, fills, nowMs: RWC_RUN_END + 3600e3 })!;
  assertEquals([done.finished, done.running, done.phase], [true, false, "after"]);
});

// ------------------------------------------------------------------------------------------------ the variant rows' replay


/**
 * Two worlds in one database: RW's replay (`pm_rw_x_*`, on RW's run) and RW-C's (`pm_rwc_x_*`, on RW-C's), each arm of the
 * page holding one market whose figure is its reward alone (nothing held, no fill), so a row's total is that reward by hand:
 * on RW's replay x1 $10, tb1-skip $4, tb1-back $5; on RW-C's x1 $0.70, tb1-skip $0.30, tb1-back $0.50. A row that read
 * the other replay, or both, would show another number.
 */
function twoReplays(rw: { lastDecided: number; dayOf: number } | null, rwc: { lastDecided: number; dayOf: number } | null) {
  const acc = (reward: number) => ({ net: 0, cash: 0, reward, fills: 0, fillShares: 0, tickCost: 0, firstCap: 20, maxInvCost: 0, lastM: 0.5, lastAb: 0.49, lastAa: 0.51, quotedMinutes: 1, settled: null });
  const arm = (reward: number | null) => ({ acc: reward == null ? {} : { [A.cond]: acc(reward) }, dayActive: [], diverged: [], pausedUntil: {}, lastMid: {}, base: {} });
  const engine = (w: { lastDecided: number; dayOf: number }) => [{ id: 1, state: { lastDecided: w.lastDecided, dayOf: w.dayOf, statusAt: 0, dayActive: [], meta: {}, acc: {} }, last_minute: iso(w.lastDecided), last_error: null, updated_at: iso(w.lastDecided + 60e3) }];
  const replay = (w: { lastDecided: number; dayOf: number }, r: [number, number, number]) => [{
    id: 1, last_minute: iso(w.lastDecided), last_error: null, updated_at: iso(w.lastDecided + 60e3),
    state: {
      version: RWX_STATE_VERSION, checkEMaxUsd: 0, checkEDays: 1, checkMaxUsd: 0, lastDecided: w.lastDecided, dayOf: w.dayOf,
      arms: { rw: arm(null), e: arm(null), x1: arm(r[0]), x2: arm(1), x3: arm(1), x4: arm(1), x5: arm(1), "tb1-skip": arm(r[1]), "tb1-back": arm(r[2]) },
    },
  }];
  const day = (d: string, arm: string, total: number) => ({ day: d, arm, total, stress_total: total, reward: total, fills: 0, capital: 20, markets: 1, detail: {} });
  const run = (p: string) => ({ [`${p}_selection`]: [] as Row[], [`${p}_minutes`]: [] as Row[], [`${p}_fills`]: [] as Row[], [`${p}_days`]: [] as Row[] });
  return memDb({
    ...run("pm_rw"), ...run("pm_rwc"),
    pm_rw_state: rw ? engine(rw) : [], pm_rw_x_state: rw ? replay(rw, [10, 4, 5]) : [],
    // RW's x1 closed 10-07 at $6 (its today is then $4); none of it may reach a row that reads RW-C.
    pm_rw_x_days: [day("2026-10-07", "x1", 6)],
    pm_rwc_state: rwc ? engine(rwc) : [], pm_rwc_x_state: rwc ? replay(rwc, [0.7, 0.3, 0.5]) : [],
    pm_rwc_x_days: [day("2026-10-09", "x1", 0.4), day("2026-10-09", "tb1-skip", 0.1), day("2026-10-09", "tb1-back", 0.2)],
  } as Record<string, Row[]>, { now: () => 0 });
}
const RW_TABLES = ["pm_rw_state", "pm_rw_selection", "pm_rw_minutes", "pm_rw_fills", "pm_rw_days", "pm_rw_x_state", "pm_rw_x_days"];
const RWC_TABLES = RW_TABLES.map((t) => t.replace("pm_rw_", "pm_rwc_"));
/** The page's rows at `now` as the dashboard reads them: the replay the clock picks, through `readRwxRows`. */
async function rowsAt(db: ReturnType<typeof twoReplays>, now: number) {
  const guarded = onlyTables(db.db, [...RW_TABLES, ...RWC_TABLES]);
  const rows = await readRwxRows(guarded, now, rwxPageReplay(now));
  return { rows, touched: [...guarded.touched].sort() };
}

Deno.test("the variant rows switch from RW's replay to RW-C's at RW-C's first minute, 2026-10-09 00:00 UTC, by the clock", () => {
  assertEquals(RWX_PAGE_SWITCH, Date.parse("2026-10-09T00:00:00Z"));
  assertEquals([RWX_PAGE_SWITCH, RWX_PAGE_SWITCH], [RWC_RUN_START, RWX_REPLAY.source.runEnd]);
  assertEquals(rwxPageReplay(Date.UTC(2026, 9, 8, 12)), RWX_REPLAY);
  assertEquals(rwxPageReplay(RWX_PAGE_SWITCH - 1), RWX_REPLAY);
  assertEquals(rwxPageReplay(RWX_PAGE_SWITCH), RWCX_REPLAY);
  assertEquals(rwxPageReplay(RWC_RUN_END + DAY), RWCX_REPLAY);
});

Deno.test("before the switch the rows are RW's replay's arms, read from RW's tables alone, and say they move to RW-C's", async () => {
  const now = RWX_PAGE_SWITCH - M;   // 10-08 23:59 UTC
  const world = { lastDecided: now - 3 * M, dayOf: Date.UTC(2026, 9, 8) };
  const { rows, touched } = await rowsAt(twoReplays(world, world), now);
  assertEquals(rows.map((r) => [r.id, r.name, r.source, r.startedAt, r.notStarted]), [
    ["x1", "Reward quotes variant-2", "RW", iso(RWX_START), false],
    ["tb1-skip", "Reward quotes variant-3", "RW", "2026-10-08T00:00:00.000Z", false],
    ["tb1-back", "Reward quotes variant-4", "RW", "2026-10-08T00:00:00.000Z", false],
  ]);
  assertEquals(rows.map((r) => r.totalUsd), [10, 4, 5]);
  assertEquals(rows.map((r) => r.sourceNext), Array(3).fill({ source: "RW-C", at: "2026-10-09T00:00:00.000Z" }));
  // RW's day row for x1 is its own; nothing of RW-C's was read.
  assertEquals(rows[0].days.map((d) => [d.day, d.totalUsd]), [["2026-10-07", 6]]);
  assert(touched.every((t) => RW_TABLES.includes(t)), touched.join());
});

Deno.test("from the switch the rows are RW-C's replay's arms, from zero at its first minute, read from RW-C's tables alone", async () => {
  // 10-10 12:00 UTC: RW-C's replay has closed 10-09; RW's records are all still there, and none of them is read.
  const now = Date.UTC(2026, 9, 10, 12);
  const rw = { lastDecided: RW_RUN_END_MINUS(), dayOf: Date.UTC(2026, 9, 8) };
  const rwc = { lastDecided: now - 3 * M, dayOf: Date.UTC(2026, 9, 10) };
  const { rows, touched } = await rowsAt(twoReplays(rw, rwc), now);
  assertEquals(rows.map((r) => [r.id, r.name, r.source, r.sourceNext, r.startedAt, r.runStart, r.notStarted, r.phase, r.dayOfRun]), [
    ["x1", "Reward quotes variant-2", "RW-C", null, "2026-10-09T00:00:00.000Z", "2026-10-09T00:00:00.000Z", false, "run", 2],
    ["tb1-skip", "Reward quotes variant-3", "RW-C", null, "2026-10-09T00:00:00.000Z", "2026-10-09T00:00:00.000Z", false, "run", 2],
    ["tb1-back", "Reward quotes variant-4", "RW-C", null, "2026-10-09T00:00:00.000Z", "2026-10-09T00:00:00.000Z", false, "run", 2],
  ]);
  // By hand: each total is its RW-C arm's reward, and today is that less its RW-C 10-09 close; RW's $10 / $4 / $5 and
  // x1's RW day are nowhere in them.
  rows.forEach((r, i) => assertAlmostEquals(r.totalUsd, [0.7, 0.3, 0.5][i], 1e-12));
  rows.forEach((r, i) => assertAlmostEquals(r.todayUsd, [0.3, 0.2, 0.3][i], 1e-12));
  assertEquals(rows.map((r) => r.days.map((d) => d.day)), [["2026-10-09"], ["2026-10-09"], ["2026-10-09"]]);
  assert(touched.every((t) => RWC_TABLES.includes(t)), touched.join());
  assert(touched.includes("pm_rwc_x_state") && touched.includes("pm_rwc_selection"), touched.join());
});

Deno.test("in RW-C's first minutes, before its replay has a state, the rows are there, empty, saying they start at 10-09 00:00", async () => {
  const rw = { lastDecided: RW_RUN_END_MINUS(), dayOf: Date.UTC(2026, 9, 8) };
  const early = await rowsAt(twoReplays(rw, null), RWX_PAGE_SWITCH + 5 * M);
  assertEquals(early.rows.map((r) => [r.id, r.name, r.source, r.notStarted, r.startsAt, r.running, r.totalUsd, r.fills, r.markets.length, r.days.length]), [
    ["x1", "Reward quotes variant-2", "RW-C", true, "2026-10-09T00:00:00.000Z", true, 0, 0, 0, 0],
    ["tb1-skip", "Reward quotes variant-3", "RW-C", true, "2026-10-09T00:00:00.000Z", true, 0, 0, 0, 0],
    ["tb1-back", "Reward quotes variant-4", "RW-C", true, "2026-10-09T00:00:00.000Z", true, 0, 0, 0, 0],
  ]);
  assert(early.touched.every((t) => RWC_TABLES.includes(t)), early.touched.join());
  // Still no state twelve minutes after its first minute could be decided: not running.
  const late = await rowsAt(twoReplays(rw, null), RWCX_REPLAY.quietUntil! + 13 * M);
  assertEquals(late.rows.map((r) => r.running), [false, false, false]);
  // RW's replay with no state keeps its rows off, as before.
  assertEquals((await rowsAt(twoReplays(null, null), RWX_PAGE_SWITCH - M)).rows, []);
});

/** RW's last decided minute, 2026-10-08 23:59 UTC. */
function RW_RUN_END_MINUS() { return RWC_RUN_START - M; }

// ------------------------------------------------------------------- "Reward quotes" and "Reward quotes variant-1"

/**
 * Two runs in one database: RW's (`pm_rw_*`, its RW-E replay `pm_rw_e_*`) and RW-C's (`pm_rwc_*`, `pm_rwc_e_*`). Each
 * engine holds one market whose figure is its reward alone (nothing held, no fill), and each RW-E arm another, so every
 * total is a reward by hand: RW $41, RW-E on RW $22.40; RW-C $0.70, RW-E on RW-C $0.30. RW's closed 10-07 at $30 and RW-C
 * 10-09 at $0.40 (RW-E on RW-C $0.10), so today is the total less that close. A row that read the other run, or both
 * added together, would show another number. `rwc: "warm"` is RW-C's engine in its warm-up's last minutes, its first
 * minute not yet decided; `null` a run with no state at all.
 */
function twoRuns(
  rw: { lastDecided: number; dayOf: number } | null,
  rwc: { lastDecided: number; dayOf: number } | null,
  rwce: { lastDecided: number; dayOf: number } | null,
) {
  const acc = (reward: number) => ({ net: 0, cash: 0, reward, fills: 0, fillShares: 0, tickCost: 0, firstCap: 20, maxInvCost: 0, lastM: 0.5, lastAb: 0.49, lastAa: 0.51, quotedMinutes: 1, settled: null });
  const engine = (w: { lastDecided: number; dayOf: number }, reward: number) => [{
    id: 1, state: { lastDecided: w.lastDecided, dayOf: w.dayOf, statusAt: 0, dayActive: [], meta: {}, acc: { "0xrun": acc(reward) } },
    last_minute: iso(w.lastDecided), last_error: null, updated_at: iso(w.lastDecided + 60e3),
  }];
  const replay = (w: { lastDecided: number; dayOf: number }, e: number) => [{
    id: 1, last_minute: iso(w.lastDecided), last_error: null, updated_at: iso(w.lastDecided + 60e3),
    state: {
      version: RWE_STATE_VERSION, lastDecided: w.lastDecided, dayOf: w.dayOf, diverged: [], checkMaxUsd: 0, base: {},
      arms: { rw: { acc: { "0xrun": acc(1) }, dayActive: [] }, e: { acc: { "0xe": acc(e) }, dayActive: [] } },
    },
  }];
  const day = (d: string, total: number, phase = "run") => ({ day: d, total, stress_total: total, reward: total, fills: 0, capital: 20, markets: 1, detail: { phase } });
  const eDay = (d: string, total: number) => ({ day: d, arm: "e", total, stress_total: total, reward: total, fills: 0, capital: 20, markets: 1, detail: null });
  const empty = (p: string) => ({ [`${p}_selection`]: [] as Row[], [`${p}_minutes`]: [] as Row[], [`${p}_fills`]: [] as Row[] });
  return memDb({
    ...empty("pm_rw"), ...empty("pm_rwc"),
    pm_rw_state: rw ? engine(rw, 41) : [], pm_rw_days: [day("2026-10-07", 30)],
    pm_rw_e_state: rw ? replay(rw, 22.4) : [], pm_rw_e_days: [eDay("2026-10-07", 15)],
    pm_rwc_state: rwc ? engine(rwc, rwc.lastDecided < RWC_RUN_START ? 3 : 0.7) : [],
    pm_rwc_days: [day("2026-10-08", 3, "warm-up"), ...(rwc && rwc.dayOf > RWC_RUN_START ? [day("2026-10-09", 0.4)] : [])],
    pm_rwc_e_state: rwce ? replay(rwce, 0.3) : [], pm_rwc_e_days: rwce && rwce.dayOf > RWC_RUN_START ? [eDay("2026-10-09", 0.1)] : [],
    // The variants' replays have no state here: their rows are pinned above, and these worlds are about the other two.
    pm_rw_x_state: [], pm_rw_x_days: [], pm_rwc_x_state: [], pm_rwc_x_days: [],
  } as Record<string, Row[]>, { now: () => 0 });
}
const RW_RUN_TABLES = ["pm_rw_state", "pm_rw_selection", "pm_rw_minutes", "pm_rw_fills", "pm_rw_days", "pm_rw_e_state", "pm_rw_e_days", "pm_rw_x_state", "pm_rw_x_days"];
const RWC_RUN_TABLES = RW_RUN_TABLES.map((t) => t.replace("pm_rw_", "pm_rwc_"));
/** The dashboard's `rw`, `rwe` and `rwx` at `now`, as it reads them: through `readRwPage`, which may touch either run's tables. */
async function pageAt(db: ReturnType<typeof twoRuns>, now: number) {
  const guarded = onlyTables(db.db, [...RW_RUN_TABLES, ...RWC_RUN_TABLES]);
  const page = await readRwPage(guarded, now, Math.floor(now / DAY) * DAY);
  return { ...page, touched: [...guarded.touched].sort() };
}

Deno.test("every Reward quotes row moves from RW's run to RW-C's at RW-C's first minute, 2026-10-09 00:00 UTC, by the clock", () => {
  assertEquals([RW_PAGE_SWITCH, RWX_PAGE_SWITCH], [Date.parse("2026-10-09T00:00:00Z"), RW_PAGE_SWITCH]);
  assertEquals(RW_PAGE_SWITCH, RW_INSTANCE.runEnd);
  assertEquals([rwPageRun(RW_PAGE_SWITCH - 1).name, rwPageRun(RW_PAGE_SWITCH).name, rwPageRun(RWC_RUN_END + DAY).name], ["RW", "RW-C", "RW-C"]);
  assertEquals([rwePageReplay(RW_PAGE_SWITCH - 1), rwePageReplay(RW_PAGE_SWITCH)], [RWE_REPLAY, RWCE_REPLAY]);
  assertEquals([rwxPageReplay(RW_PAGE_SWITCH - 1), rwxPageReplay(RW_PAGE_SWITCH)], [RWX_REPLAY, RWCX_REPLAY]);
});

Deno.test("before the switch \"Reward quotes\" is RW's run and variant-1 RW-E's replay of it, read from RW's tables alone", async () => {
  const now = RW_PAGE_SWITCH - M;   // 10-08 23:59 UTC
  const rw = { lastDecided: now - 3 * M, dayOf: Date.UTC(2026, 9, 8) };
  const rwc = { lastDecided: now - 2 * M, dayOf: Date.UTC(2026, 9, 8) };   // RW-C in its warm-up: none of it is read
  const p = await pageAt(twoRuns(rw, rwc, null), now);
  const next = { source: "RW-C", at: "2026-10-09T00:00:00.000Z" };
  assertEquals([p.rw!.source, p.rw!.sourceNext, p.rw!.runStart, p.rw!.phase, p.rw!.dayOfRun, p.rw!.notStarted], ["RW", next, "2026-09-25T00:00:00.000Z", "run", 14, false]);
  // By hand: RW's market's reward, and today that less RW's 10-07 close.
  assertAlmostEquals(p.rw!.totalUsd, 41, 1e-12);
  assertAlmostEquals(p.rw!.todayUsd, 11, 1e-12);
  assertEquals([p.rwe!.source, p.rwe!.sourceNext, p.rwe!.startedAt, p.rwe!.notStarted], ["RW", next, "2026-09-27T00:00:00.000Z", false]);
  assertAlmostEquals(p.rwe!.totalUsd, 22.4, 1e-12);
  assertAlmostEquals(p.rwe!.todayUsd, 7.4, 1e-12);
  assertEquals([p.rw!.e?.source, p.rwe!.e?.source], ["RW", "RW"]);
  assert(p.touched.every((t) => RW_RUN_TABLES.includes(t)), p.touched.join());
  assert(p.touched.includes("pm_rw_state") && p.touched.includes("pm_rw_e_state"), p.touched.join());
});

Deno.test("from the switch both rows are RW-C's run, from zero at its first minute, read from RW-C's tables alone", async () => {
  // 10-10 12:00 UTC: RW-C has closed 10-09; RW's records are all still there, and none of them is read.
  const now = Date.UTC(2026, 9, 10, 12);
  const rw = { lastDecided: RW_PAGE_SWITCH - M, dayOf: Date.UTC(2026, 9, 8) };
  const rwc = { lastDecided: now - 2 * M, dayOf: Date.UTC(2026, 9, 10) };
  const p = await pageAt(twoRuns(rw, rwc, { lastDecided: now - 4 * M, dayOf: Date.UTC(2026, 9, 10) }), now);
  const at = "2026-10-09T00:00:00.000Z";
  assertEquals([p.rw!.source, p.rw!.sourceNext, p.rw!.startedAt, p.rw!.runStart, p.rw!.runEnd, p.rw!.phase, p.rw!.dayOfRun, p.rw!.notStarted, p.rw!.running],
    ["RW-C", null, at, at, "2026-10-23T00:00:00.000Z", "run", 2, false, true]);
  // By hand: RW-C's $0.70, today $0.30 on its own 10-09 close; RW's $41, its 10-07 day and RW-C's warm-up are nowhere.
  assertAlmostEquals(p.rw!.totalUsd, 0.7, 1e-12);
  assertAlmostEquals(p.rw!.todayUsd, 0.3, 1e-12);
  assertEquals(p.rw!.days.map((d) => d.day), ["2026-10-09"]);
  assertEquals([p.rwe!.source, p.rwe!.sourceNext, p.rwe!.startedAt, p.rwe!.runStart, p.rwe!.dayOfRun, p.rwe!.notStarted], ["RW-C", null, at, at, 2, false]);
  assertAlmostEquals(p.rwe!.totalUsd, 0.3, 1e-12);
  assertAlmostEquals(p.rwe!.todayUsd, 0.2, 1e-12);
  assertEquals(p.rwe!.days.map((d) => d.day), ["2026-10-09"]);
  assertEquals([p.rw!.e?.source, p.rw!.e?.since, p.rw!.e?.started], ["RW-C", at, true]);
  assert(p.touched.every((t) => RWC_RUN_TABLES.includes(t)), p.touched.join());
  assert(p.touched.includes("pm_rwc_state") && p.touched.includes("pm_rwc_e_state") && p.touched.includes("pm_rwc_x_state"), p.touched.join());
});

Deno.test("just after 00:00, until RW-C and RW-E's replay of it write, both rows are there, empty and running, saying they start at 10-09 00:00", async () => {
  const rw = { lastDecided: RW_PAGE_SWITCH - M, dayOf: Date.UTC(2026, 9, 8) };
  // 00:01: RW-C has decided its warm-up's minutes up to 23:59 (it decides two minutes behind); its replay is quiet.
  const now = RW_PAGE_SWITCH + M;
  const warm = { lastDecided: RW_PAGE_SWITCH - M, dayOf: Date.UTC(2026, 9, 8) };
  const p = await pageAt(twoRuns(rw, warm, null), now);
  const at = "2026-10-09T00:00:00.000Z";
  for (const r of [p.rw!, p.rwe!]) {
    assertEquals([r.source, r.notStarted, r.startsAt, r.startedAt, r.running, r.totalUsd, r.todayUsd, r.fills, r.markets.length, r.days.length],
      ["RW-C", true, at, null, true, 0, 0, 0, 0, 0]);
  }
  assertEquals(p.rw!.e, null);
  assert(p.touched.every((t) => RWC_RUN_TABLES.includes(t)), p.touched.join());
  // RW-C's first minute decided (00:02), its replay still without a state: "Reward quotes" counts from zero, variant-1 waits.
  const first = await pageAt(twoRuns(rw, { lastDecided: RW_PAGE_SWITCH, dayOf: RW_PAGE_SWITCH }, null), RW_PAGE_SWITCH + 2 * M);
  assertEquals([first.rw!.notStarted, first.rw!.startedAt, first.rw!.running, first.rwe!.notStarted, first.rwe!.running], [false, at, true, true, true]);
  assertAlmostEquals(first.rw!.totalUsd, 0.7, 1e-12);
  // Still no state for the replay twelve minutes after it could first run: variant-1 reads not running.
  const late = await pageAt(twoRuns(rw, { lastDecided: RW_PAGE_SWITCH + 10 * M, dayOf: RW_PAGE_SWITCH }, null), RWCE_REPLAY.quietUntil! + 11 * M);
  assertEquals([late.rwe!.notStarted, late.rwe!.running, late.rw!.running], [true, false, true]);
  // Before the switch RW's replay with no state keeps variant-1 off, as before.
  assertEquals((await pageAt(twoRuns(rw, warm, null), RW_PAGE_SWITCH - M)).rwe!.source, "RW");
});
