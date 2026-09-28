// RW-C on the Agents page (pmrw_view.ts's `rwcSummary`): the dashboard's `rwc`, RW's own summary of RW-C's own engine
// run against its fourteen days, 2026-10-09 → 10-23 UTC — from before the engine has a state at all, through its
// warm-up, which counts nowhere, to after its end.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RWC_INSTANCE, RWC_RUN_END, RWC_RUN_START, RWC_WARM_UP } from "./pmrw.ts";
import { RW_FUNDED_USD, rwcSummary, rwSummary, type RwFillRow } from "./pmrw_view.ts";

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
