// "Reward quotes small-pool" as the Agents page shows it (pm_prep_view.ts), against a record worked out by hand at the
// browser sweep's clock (`src/e2e/prep_fixture.json`, which the sweep serves as the dashboard's `prep`: its `output`
// must be the function's own answer for its `input`).
//
// By hand: two markets, A (8 a day, the touch 0.46/0.48, mid 0.47) and B (7 a day, 0.200/0.230, mid 0.215). Fills: on
// 16 Sep A's bid 10 at 0.45 (YES) and A's ask 4 at 0.48 (a BUY of NO at 0.52); on 17 Sep B's bid 20 at 0.201 and, after
// a stop, A's close-only ask: a SELL of 5 YES at 0.50 (+0.25 realised). Held: A 5 YES at 0.45 and 4 NO at 0.52, B 20 YES
// at 0.201 — cost 8.35, at the mids 2.35 + 2.12 + 4.30 = 8.77, so +0.42 open; the fills' P&L +0.67. Rewards: 1.20 on
// 16 Sep (A 0.70, B 0.50) and 0.50 so far today (A 0.30, B 0.20): 1.70, A's 1.00 and B's 0.70. A fifth fill, of a minute
// the state has not decided yet, is not counted.
//
// RW's page from it. By market, A made 1.00 + 0.25 + 5 × 0.02 + 4 × 0.01 = 1.39 and B 0.70 + 20 × 0.014 = 0.98, which add
// up to the total 2.37; the top share is 1.39 / 2.37, 59 %. The worst case is RW's on each account (rewards halved, every
// fill a tick worse, inventory at the adjusted touch): A 0.50 − 0.08 − 0.19 + 1 × 0.46 = 0.69 (net 1 YES, cash −4.50 +
// 1.92 + 2.50, ticks of 0.01 on 19 shares), B 0.35 − 4.02 − 0.02 + 20 × 0.200 = 0.31, so 1.00. 16 Sep closed with the
// fills at −0.30, so that day made −0.30 + 1.20 = 0.90 and today 2.37 − 0.90 = 1.47. Costs are the selections'
// N × (b + 1 − a): 4.90 + 19.40 on 16 Sep, 4.90 + 19.44 today. The shares at the last minute: A earned 0.0002 of a pool
// of 8 a day, 0.0002 × 1440 / 8 = 3.6 %; B 0.00014 of 7, 2.88 %.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/prep_fixture.json" with { type: "json" };
import midFixture from "../../../src/e2e/mid_fixture.json" with { type: "json" };
import { PREP_STALE_MINUTES, prepSummary } from "./pm_prep_view.ts";
import { readPrepSummary } from "./index.ts";
import { PREP_INSTANCE, type PrepInstance } from "./pm_prep.ts";
import { PREP_MID_INSTANCE } from "./pm_mid.ts";
import { memDb, onlyTables } from "./testing.ts";

// deno-lint-ignore no-explicit-any
const F = fixture as any;
const near = (x: number, want: number, what: string) => assertAlmostEquals(x, want, 1e-9, what);

Deno.test("the page's figures for the hand-worked record: the fixture the sweep serves is the function's own answer", () => {
  const out = prepSummary(F.input)!;
  assertEquals(JSON.parse(JSON.stringify(out)), F.output);
  near(out.fillsPnlUsd, 0.67, "fills P&L"); near(out.heldUsd, 8.77, "held at the mid"); near(out.costUsd, 8.35, "cost");
  near(out.realisedUsd, 1.95, "realised: rewards 1.70 and the close-only sale's 0.25"); near(out.realisedFillsUsd, 0.25, "realised by fills");
  near(out.unrealisedUsd, 0.42, "unrealised"); near(out.rewardUsd, 1.7, "rewards"); near(out.totalUsd, 2.37, "total");
  assertEquals([out.open, out.quoting, out.running, out.lagMinutes, out.fills], [2, 2, true, 2, 4]);
  assertEquals(out.markets.map((m) => [m.q, m.bid, m.ask, m.yes, m.no, m.mark]), [["Will A happen?", 0.46, 0.48, 5, 4, 0.47], ["Will B happen?", 0.201, 0.229, 20, 0, 0.215]]);
  assertEquals(out.recent.map((f) => [f.tokenSide, f.outcome, f.size, f.tokenPrice]), [["SELL", "yes", 5, 0.5], ["BUY", "yes", 20, 0.201], ["BUY", "no", 4, 0.52], ["BUY", "yes", 10, 0.45]]);
});

Deno.test("RW's page from the layer's records: each market's part, the worst case, the top share, the days and their costs", () => {
  const out = prepSummary(F.input)!;
  const [a, b] = out.markets as Array<Record<string, number>>;
  near(a.rewardUsd, 1, "A's rewards"); near(a.fillsPnlUsd, 0.39, "A's fills: 0.25 realised, 0.10 on its YES, 0.04 on its NO"); near(a.totalUsd, 1.39, "A");
  near(b.rewardUsd, 0.7, "B's rewards"); near(b.fillsPnlUsd, 0.28, "B's fills: 20 × 0.014"); near(b.totalUsd, 0.98, "B");
  near(a.totalUsd + b.totalUsd, out.totalUsd, "the markets add up to the total"); near(out.mismatchUsd, 0, "and say so");
  near(out.bestMarketUsd!, 1.39, "the best market"); near(out.stressUsd, 1, "RW's worst case on the two accounts: 0.69 + 0.31");
  near(a.share, 0.036, "A's share of its pool"); near(b.share, 0.0288, "B's");
  // Today against the last close, as RW's: the closed day and today add up to the total.
  near(out.todayUsd, 1.47, "today"); near(out.days[0].totalUsd, 0.9, "16 Sep: −0.30 + 1.20");
  near(out.todayUsd + out.days[0].totalUsd, out.totalUsd, "today and the closed days are the total");
  assertEquals(out.days.map((d) => [d.day, d.live, d.fills, d.rewardUsd, d.stressUsd, d.capitalUsd]), [["2026-09-16", false, 2, 1.2, null, 24.3]]);
  near(out.capitalUsd!, 24.34, "today's costs: 4.90 + 19.44");
  assertEquals([out.phase, out.notStarted, out.finished, out.catchingUp], ["run", false, false, false]);
});

Deno.test("a closed day is its change since the close before, so the days add up to the total", () => {
  // The same record a day later: the fill of 22:59 is decided now (B holds 40 YES, the fills' P&L 0.95), 17 Sep closed
  // with the fills at 0.95 and its 0.50 of rewards, and nothing has moved since.
  const next = Date.parse("2026-09-18T01:00:00Z"), dayOf = Date.parse("2026-09-18T00:00:00Z");
  const input = {
    ...F.input, nowMs: next,
    state: { ...F.input.state, last_minute: "2026-09-18T00:58:00.000Z", state: { ...F.input.state.state, lastDecided: next - 2 * 60e3, dayOf, day: { ...F.input.state.state.day, reward: 0, fills: 0 } } },
    days: [...F.input.days, { day: "2026-09-17", reward: 0.5, fills_pnl_total: 0.95, fills: 3, stop_day: false, stop_total: false }],
  };
  const out = prepSummary(input)!;
  assertEquals(out.days.map((d) => d.day), ["2026-09-17", "2026-09-16"]);
  near(out.fillsPnlUsd, 0.95, "the fills, the 22:59 one included"); near(out.totalUsd, 2.65, "and the total");
  near(out.days[0].totalUsd, 1.75, "17 Sep: 0.95 − (−0.30) + 0.50"); near(out.todayUsd, 0, "nothing since its close");
  near(out.days[0].totalUsd + out.days[1].totalUsd + out.todayUsd, out.totalUsd, "the days are the total");
  // No selection on the 18th yet: nothing quoting and no costs; what is held is still listed, from an earlier day.
  assertEquals([out.quoting, out.capitalUsd, out.markets.map((m) => m.quoting)], [0, null, [false, false]]);
  // Held from an earlier day, each is still named by its question, never by its id (2026-10-04: "0x2764…" on the page).
  const named = new Map(F.input.markets.map((m: { cond: string; question: string | null }) => [m.cond, m.question]));
  for (const m of out.markets) { assert(String(m.q).length > 0 && !/^0x[0-9a-f]{16,}$/i.test(String(m.q)), `${m.cond} unnamed`); assertEquals(m.q, named.get(String(m.cond))); }
  near(out.days[0].capitalUsd!, 24.34, "17 Sep's costs");
});

Deno.test("no state is no row; a last decided minute older than five minutes is not running; a stop is carried to the page", () => {
  assertEquals(prepSummary({ ...F.input, state: null }), null);
  assertEquals(prepSummary({ ...F.input, state: { ...F.input.state, last_minute: null } }), null);
  const late = prepSummary({ ...F.input, nowMs: Date.parse(F.input.state.last_minute) + (PREP_STALE_MINUTES + 1) * 60e3 })!;
  assertEquals([late.running, late.lagMinutes], [false, 6]);
  const stop = (stopDay: string | null, stopTotal: string | null = null) =>
    prepSummary({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, stopDay, stopTotal } } })!;
  assertEquals([stop("2026-09-17").stopDay, stop(null, "2026-09-16T10:00:00.000Z").stopTotal], ["2026-09-17", "2026-09-16T10:00:00.000Z"]);
  // A day stop holds for its own UTC day: the path quotes again the next, so the page no longer says it has tripped.
  assertEquals(stop("2026-09-16").stopDay, null);
});

// "Reward quotes mid-pool" (0081), the same view of its own layer's records (`src/e2e/mid_fixture.json`, which the sweep
// serves as the dashboard's `prepMid`: its `output` must be the function's own answer for its `input`).
//
// By hand: two markets of its band, C (20 a day, its quote 0.40 / 0.43, mid 0.415, N 20) and D (36 a day, 0.70 / 0.72,
// mid 0.71, N 10). Fills: on 16 Sep C's bid 20 at 0.40 (YES); on 17 Sep D's ask 10 at 0.72, a BUY of NO at 0.28. A third,
// of 22:59, a minute the state has not decided, is not counted. Held: 20 YES at 0.40 and 10 NO at 0.28, cost 10.80; at
// the mids 20 × 0.415 + 10 × 0.29 = 8.30 + 2.90 = 11.20, so +0.40 open, nothing realised by a fill. Rewards: 5.00 on 16
// Sep and 4.00 so far today, 9.00 (C 3.50, D 5.50), all realised. Total 9.40: C 3.50 + 0.30 = 3.80, D 5.50 + 0.10 = 5.60,
// the top share 5.60 / 9.40 = 60 %. 16 Sep closed with the fills at −0.20: −0.20 + 5.00 = 4.80, so today 9.40 − 4.80 =
// 4.60. RW's worst case: C 1.75 − 8.00 − 0.20 + 20 × 0.40 = 1.55, D 2.75 + 7.20 − 0.10 − 10 × 0.72 = 2.65, so 4.20. Costs
// N × (b + 1 − a): C 20 × 0.97 = 19.40, D 10 × 0.98 = 9.80, 29.20 each day, which are also what its quotes tie up. The
// shares at the last minute: C 0.0025 × 1440 / 20 = 18 %, D 0.006 × 1440 / 36 = 24 %.

// deno-lint-ignore no-explicit-any
const MF = midFixture as any;

Deno.test("mid-pool's page figures for its hand-worked record: the fixture the sweep serves is the function's own answer", () => {
  const out = prepSummary(MF.input)!;
  assertEquals(JSON.parse(JSON.stringify(out)), MF.output);
  near(out.heldUsd, 11.2, "held at the mids"); near(out.costUsd, 10.8, "cost"); near(out.unrealisedUsd, 0.4, "unrealised");
  near(out.rewardUsd, 9, "rewards"); near(out.realisedUsd, 9, "realised: the rewards alone"); near(out.realisedFillsUsd, 0, "no closing fill");
  near(out.totalUsd, 9.4, "total"); near(out.todayUsd, 4.6, "today: 9.40 − 4.80"); near(out.days[0].totalUsd, 4.8, "16 Sep: −0.20 + 5.00");
  near(out.stressUsd, 4.2, "RW's worst case: 1.55 + 2.65"); near(out.bestMarketUsd!, 5.6, "D");
  near(out.quotedUsd, 29.2, "what its quotes tie up: 20 × 0.40 + 20 × 0.57 + 10 × 0.70 + 10 × 0.28"); near(out.capitalUsd!, 29.2, "today's costs");
  assertEquals(out.markets.map((m) => [m.q, m.ratePerDay, m.yes, m.no, m.share, m.totalUsd]), [["Will C happen?", 20, 20, 0, 0.18, 3.8], ["Will D happen?", 36, 0, 10, 0.24, 5.6]]);
  assertEquals(out.recent.map((f) => [f.q, f.tokenSide, f.outcome, f.size, f.tokenPrice]), [["Will D happen?", "BUY", "no", 10, 0.28], ["Will C happen?", "BUY", "yes", 20, 0.4]]);
  assertEquals([out.open, out.quoting, out.running, out.lagMinutes, out.fills, out.capUsd], [2, 2, true, 2, 2, 320]);
  // Every rate of its record is in mid-pool's band, [$10, $50).
  for (const r of [...MF.input.rates, ...MF.input.markets.map((m: { reward_rate: number }) => ({ rate: m.reward_rate }))]) assertEquals(r.rate >= 10 && r.rate < 50, true);
});

Deno.test("the dashboard reads each paper layer from its own instance's tables: small-pool's from 0077's and its path's, mid-pool's from 0081's", async () => {
  // Each fixture's record as the rows its tables hold, side by side in one database.
  // deno-lint-ignore no-explicit-any
  const rowsOf = (input: any, inst: PrepInstance, cap: number) => ({
    [inst.tables.state]: [{ id: 1, ...input.state }],
    [inst.tables.days]: input.days,
    [inst.tables.minutes]: input.latest,
    [inst.reads.minutes]: input.rates.map((r: { cond: string; rate: number }) => ({ mode: "dry_run", minute: input.state.last_minute, ...r })),
    [inst.tables.fills]: input.fills,
    [inst.tables.settlements]: input.settlements,
    [inst.reads.markets]: input.markets,
    [inst.reads.config]: [{ id: 1, cap_total_usd: cap }],
  });
  const mem = memDb({ ...rowsOf(F.input, PREP_INSTANCE, 320), ...rowsOf(MF.input, PREP_MID_INSTANCE, 320) }, { now: () => F.input.nowMs });
  const dayStart = Date.parse("2026-09-17T00:00:00Z");
  for (const [inst, fixture] of [[PREP_INSTANCE, F], [PREP_MID_INSTANCE, MF]] as const) {
    const reads = [inst.tables.state, inst.tables.days, inst.tables.minutes, inst.tables.fills, inst.tables.settlements, inst.reads.minutes, inst.reads.markets, inst.reads.config];
    const db = onlyTables(mem.db, reads, { readOnly: reads });
    const out = await readPrepSummary(db, inst, fixture.input.nowMs, dayStart);
    assertEquals(JSON.parse(JSON.stringify(out)), fixture.output, inst.name);
    assertEquals([...db.touched].sort(), [...reads].sort(), inst.name);
  }
  // A layer that has decided nothing yet is no row.
  const empty = memDb({ ...rowsOf(F.input, PREP_INSTANCE, 320), pm_midprep_state: [] }, { now: () => F.input.nowMs });
  assertEquals(await readPrepSummary(empty.db, PREP_MID_INSTANCE, F.input.nowMs, dayStart), null);
});
