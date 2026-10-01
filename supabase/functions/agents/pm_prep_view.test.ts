// "Reward quotes live-prep" as the Agents page shows it (pm_prep_view.ts), against a record worked out by hand at the
// browser sweep's clock (`src/e2e/prep_fixture.json`, which the sweep serves as the dashboard's `prep`: its `output`
// must be the function's own answer for its `input`).
//
// By hand: two markets, A (8 a day, the touch 0.46/0.48, mid 0.47) and B (7 a day, 0.200/0.230, mid 0.215). Fills: on
// 16 Sep A's bid 10 at 0.45 (YES) and A's ask 4 at 0.48 (a BUY of NO at 0.52); on 17 Sep B's bid 20 at 0.201 and, after
// a stop, A's close-only ask: a SELL of 5 YES at 0.50 (+0.25 realised). Held: A 5 YES at 0.45 and 4 NO at 0.52, B 20 YES
// at 0.201 — cost 8.35, at the mids 2.35 + 2.12 + 4.30 = 8.77, so +0.42 open; the fills' P&L +0.67, all of it today
// (realised today and every holding against its cost, as the path's stop reads it). Rewards: 1.20 on 16 Sep, 0.50 so
// far today: 1.70, and 0.68 at R = 0.40. A fifth fill, of a minute the state has not decided yet, is not counted.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/prep_fixture.json" with { type: "json" };
import { PREP_STALE_MINUTES, prepSummary } from "./pm_prep_view.ts";

// deno-lint-ignore no-explicit-any
const F = fixture as any;

Deno.test("the page's figures for the hand-worked record: the fixture the sweep serves is the function's own answer", () => {
  const out = prepSummary(F.input)!;
  assertEquals(JSON.parse(JSON.stringify(out)), F.output);
  const near = (x: number, want: number, what: string) => assertAlmostEquals(x, want, 1e-9, what);
  near(out.fillsPnlUsd, 0.67, "fills P&L"); near(out.heldUsd, 8.77, "held at the mid"); near(out.costUsd, 8.35, "cost");
  near(out.realisedUsd, 1.95, "realised: rewards 1.70 and the close-only sale's 0.25"); near(out.realisedFillsUsd, 0.25, "realised by fills");
  near(out.unrealisedUsd, 0.42, "unrealised"); near(out.rewardUsd, 1.7, "rewards"); near(out.rewardR40Usd, 0.68, "rewards at R = 0.40");
  near(out.totalUsd, 2.37, "total at the formula"); near(out.totalR40Usd, 1.35, "total at R = 0.40");
  near(out.todayUsd, 1.17, "today at the formula"); near(out.todayR40Usd, 0.87, "today at R = 0.40");
  assertEquals([out.open, out.quoting, out.running, out.lagMinutes], [2, 2, true, 2]);
  assertEquals(out.markets.map((m) => [m.q, m.bid, m.ask, m.yes, m.no, m.mark]), [["Will A happen?", 0.46, 0.48, 5, 4, 0.47], ["Will B happen?", 0.201, 0.229, 20, 0, 0.215]]);
  assertEquals(out.recent.map((f) => [f.tokenSide, f.outcome, f.size, f.tokenPrice]), [["SELL", "yes", 5, 0.5], ["BUY", "yes", 20, 0.201], ["BUY", "no", 4, 0.52], ["BUY", "yes", 10, 0.45]]);
  assertEquals(out.days.map((d) => [d.day, d.live, d.fills]), [["2026-09-17", true, 2], ["2026-09-16", false, 2]]);
  near(out.days[0].pnlR40Usd, 0.87, "today's row at R = 0.40"); near(out.days[1].pnlR40Usd, 0.18, "16 Sep at R = 0.40");
});

Deno.test("no state is no row; a last decided minute older than five minutes is not running; a stop is carried to the page", () => {
  assertEquals(prepSummary({ ...F.input, state: null }), null);
  assertEquals(prepSummary({ ...F.input, state: { ...F.input.state, last_minute: null } }), null);
  const late = prepSummary({ ...F.input, nowMs: Date.parse(F.input.state.last_minute) + (PREP_STALE_MINUTES + 1) * 60e3 })!;
  assertEquals([late.running, late.lagMinutes], [false, 6]);
  const stopped = prepSummary({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, stopDay: "2026-09-17" } } })!;
  assertEquals([stopped.stopDay, stopped.days[0].stop], ["2026-09-17", true]);
});
