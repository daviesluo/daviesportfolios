// "Reward quotes live-prep" as the Agents page shows it (pm_prep_view.ts), against a record worked out by hand at the
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

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/prep_fixture.json" with { type: "json" };
import { PREP_STALE_MINUTES, prepSummary } from "./pm_prep_view.ts";

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
