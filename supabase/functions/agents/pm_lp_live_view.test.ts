// "Reward quotes live-prep"'s real-money book as the Agents page shows it (pm_lp_live_view.ts), against a record worked
// out by hand at the browser sweep's clock (`src/e2e/lp_live_fixture.json`, which the sweep serves as the dashboard's
// `lpLive`: its `output` must be the function's own answer for its `input`).
//
// By hand: live since 16 Sep 01:32 UTC, cap $320, the total stop at −$75. Three markets, their last turn's books G
// 0.44/0.46 (mid 0.45), H 0.70/0.72 (0.71), J 0.30/0.32 (0.31). CONFIRMED fills: on 16 Sep G 20 YES bought at 0.40 and H
// 10 NO at 0.28; on 17 Sep G's 20 YES sold at 0.43 (+0.60, today's) and J 10 YES bought at 0.30. A fifth, J 5 YES at 0.30,
// is MATCHED only: listed, not counted. Held: H 10 NO at 0.28 (cost 2.80, at 1 − 0.71 = 0.29, +0.10) and J 10 YES at 0.30
// (cost 3.00, at 0.31, +0.10): cost 5.80, unrealised +0.20, the fills' P&L +0.80, all of it today's (bookPnl's day counts
// every holding against its cost). Resting: G buys 20 YES at 0.44 (8.80) and 20 NO at 0.54 (10.80), J 15 YES at 0.30 with 5
// matched (10 × 0.30 = 3.00) and a pending 10 NO at 0.68 (6.80), and H's sell of its 10 NO (no collateral): 29.40, so
// deployed 29.40 + 5.80 = 35.20. Polymarket paid for 16 Sep G 0.80 + 0.20 sponsored and H 1.20, 2.20 against a formula of
// 2.00 + 3.00 = 5.00 (R 0.44), and a maker rebate of 0.05. Realised 0.60 + 2.20 + 0.05 = 2.85; today 0.80 (nothing paid
// for 17 Sep yet). The stop reads 0.80 + 2.20 = 3.00 (rebates not), 78.00 from −75. Three markets at work, five orders open.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/lp_live_fixture.json" with { type: "json" };
import { lpLiveConds, lpLiveSummary } from "./pm_lp_live_view.ts";
import { readLpLive } from "./index.ts";
import { PM_LP_INSTANCE } from "./pm_lp.ts";
import { memDb, onlyTables } from "./testing.ts";

// deno-lint-ignore no-explicit-any
const F = fixture as any;
const near = (x: number, want: number, what: string) => assertAlmostEquals(x, want, 1e-9, what);
const T = PM_LP_INSTANCE.tables;

Deno.test("live-prep's live figures for the hand-worked record: the fixture the sweep serves is the function's own answer", () => {
  const out = lpLiveSummary(F.input)!;
  assertEquals(JSON.parse(JSON.stringify(out)), F.output);
  near(out.capUsd, 320, "funded: the config's total cap");
  near(out.restingBuysUsd, 29.4, "8.80 + 10.80 + 3.00 + 6.80"); near(out.costUsd, 5.8, "2.80 + 3.00"); near(out.valueUsd, 35.2, "deployed");
  near(out.unrealisedUsd, 0.2, "0.10 + 0.10"); near(out.realisedFillsUsd, 0.6, "G's 20 YES sold at 0.43, bought at 0.40");
  near(out.paidUsd, 2.2, "0.80 + 0.20 + 1.20"); near(out.rebateUsd, 0.05, "G's rebate"); near(out.realisedUsd, 2.85, "0.60 + 2.20 + 0.05");
  near(out.todayUsd, 0.8, "today's sell and every holding against its cost"); near(out.totalUsd, 3.05, "realised + unrealised");
  near(out.formulaUsd, 5, "the formula, apart"); near(out.r!, 0.44, "R = 2.20 / 5.00"); assertEquals(out.feesUsd, 0);
  assertEquals([out.stop.basisUsd, out.stop.roomUsd, out.stop.limitUsd, out.stop.trippedAt], [3, 78, 75, null]);
  assertEquals([out.openOrders, out.markets, out.fills, out.armed, out.running, out.lagMinutes, out.liveSince], [5, 3, 4, true, true, 1, "2026-09-16T01:32:21.000Z"]);
  assertEquals(out.held.map((h) => [h.q, h.outcome, h.shares, h.avgCost, h.mark, h.unrealisedUsd]), [["Will H happen?", "no", 10, 0.28, 0.29, 0.1], ["Will J happen?", "yes", 10, 0.3, 0.31, 0.1]]);
  assertEquals(out.days.map((d) => [d.day, d.markets, d.formulaUsd, d.paidUsd, d.r, d.rebateUsd]), [["2026-09-16", 2, 5, 2.2, 0.44, 0.05]]);
  // Newest first, everywhere; the MATCHED fill listed and not counted.
  assertEquals(out.resting.map((o) => o.id), [109, 108, 107, 106, 105]);
  assertEquals(out.recent.map((o) => [o.id, o.state]), [[104, "filled"], [103, "filled"], [102, "expired"], [101, "filled"], [100, "cancelled"], [99, "filled"]]);
  assertEquals(out.recentFills.map((f) => [f.tradeId, f.counted]), [["t-5", false], ["t-4", true], ["t-3", true], ["t-2", true], ["t-1", true]]);
  // The parts add up: realised + unrealised is the total, and the stop's reading is the fills' P&L plus what was paid.
  near(out.realisedUsd + out.unrealisedUsd, out.totalUsd, "realised + unrealised");
  near(out.stop.fillsPnlUsd + out.stop.paidUsd, out.stop.basisUsd, "the stop's basis");
});

Deno.test("live-prep's live book is no row until it is armed or has sent a live order, and stays one once it has", () => {
  const never = { ...F.input, config: { ...F.input.config, dry_run: true, live_confirmed_at: null }, open: [], recent: [], fills: [], rewardDays: [] };
  assertEquals(lpLiveSummary(never), null);
  assertEquals(lpLiveSummary({ ...F.input, config: null }), null);
  // Armed with nothing sent yet: a row, empty.
  const armed = lpLiveSummary({ ...never, config: F.input.config })!;
  assertEquals([armed.armed, armed.tradedLive, armed.valueUsd, armed.realisedUsd, armed.openOrders], [true, false, 0, 0, 0]);
  // Disarmed after trading: still real money's record.
  const disarmed = lpLiveSummary({ ...F.input, config: { ...F.input.config, dry_run: true, live_confirmed_at: null } })!;
  assertEquals([disarmed.armed, disarmed.tradedLive, disarmed.realisedUsd], [false, true, 2.85]);
});

Deno.test("live-prep's live stop: tripped by its event, and a settlement realised at its payout", () => {
  const tripped = lpLiveSummary({ ...F.input, stop: { minute: "2026-09-17T20:00:00.000Z", detail: {} } })!;
  assertEquals(tripped.stop.trippedAt, "2026-09-17T20:00:00.000Z");
  // J resolves NO: its 10 YES bought at 0.30 realise −3.00 and leave the book; H still held.
  const J = F.input.markets.find((m: { question: string }) => m.question === "Will J happen?");
  const settled = lpLiveSummary({ ...F.input, settlements: [{ cond: J.cond, yes_token: J.yes_token, no_token: J.no_token, payout: 0, settled_at: "2026-09-17T22:00:00.000Z" }] })!;
  near(settled.realisedFillsUsd, 0.6 - 3, "G's +0.60 and J's −3.00"); near(settled.costUsd, 2.8, "H alone"); near(settled.unrealisedUsd, 0.1, "H's");
  assertEquals(settled.held.map((h) => h.q), ["Will H happen?"]);
  near(settled.stop.basisUsd, 0.6 - 3 + 0.1 + 2.2, "the stop moves with it");
  // A held token whose market the last turn did not read is held at cost: no unrealised, never a guess.
  const unread = lpLiveSummary({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, markets: [] } } })!;
  assertEquals([unread.unrealisedUsd, unread.costUsd, unread.held.map((h) => h.mark)], [0, 5.8, [null, null]]);
});

Deno.test("the dashboard reads live-prep's live book from its live rows only: no dry-run row, no paper layer, nothing written", async () => {
  const I = F.input;
  // The fixture's rows, beside dry-run rows that would move every figure if any leaked: a resting dry-run buy, a dry-run
  // reward day, and the paper layer's own fills and days.
  const dryOrder = { ...I.open[3], id: 50, ts: "2026-09-17T22:30:00.000Z", size: 1000 };
  const mem = memDb({
    [T.config]: [{ id: 1, ...I.config }],
    [T.state]: [{ id: 1, ...I.state }],
    [T.orders]: [...[...I.open, ...I.recent].map((o: Record<string, unknown>) => ({ mode: "live", ...o })), { ...dryOrder, mode: "dry_run" }],
    [T.fills]: I.fills,
    [T.settlements]: I.settlements,
    [T.rewardDays]: [...I.rewardDays.map((r: Record<string, unknown>) => ({ mode: "live", ...r })), { mode: "dry_run", day: "2026-09-16", cond: I.rewardDays[0].cond, minutes: 1, minutes_scored: 1, formula_usd: 500, actual_usd: null, actual_sponsored_usd: null, rebate_usd: null }],
    [T.markets]: I.markets,
    [T.events]: [{ mode: "dry_run", minute: "2026-09-17T12:00:00.000Z", kind: "loss_stop_total", detail: {} }],
    pm_lpprep_fills: [{ cond: I.markets[0].cond, token: "x", token_side: "BUY", token_price: 0.5, size: 1000 }],
    pm_lpprep_days: [{ day: "2026-09-16", reward: 999 }],
  }, { now: () => I.nowMs });
  const reads = [T.config, T.state, T.orders, T.fills, T.settlements, T.rewardDays, T.markets, T.events];
  const db = onlyTables(mem.db, reads, { readOnly: reads });
  const out = await readLpLive(db, I.nowMs);
  assertEquals(JSON.parse(JSON.stringify(out)), F.output);
  assertEquals([...db.touched].sort(), [...reads].sort());
  // Never armed and no live order (a dry-run one aside): no row.
  const quiet = memDb({ [T.config]: [{ id: 1, ...I.config, dry_run: true, live_confirmed_at: null }], [T.state]: [], [T.orders]: [{ ...dryOrder, mode: "dry_run" }] }, { now: () => I.nowMs });
  assertEquals(await readLpLive(quiet.db, I.nowMs), null);
  // A read that fails leaves the row off, never the page.
  const broken: typeof mem.db = { ...mem.db, select: (t, q) => (t === T.markets ? Promise.reject(new Error(`db GET ${t} → 500`)) : mem.db.select(t, q)) };
  assertEquals(await readLpLive(broken, I.nowMs), null);
});

Deno.test("the conditions a live summary names: every fill's and every order's, once each", () => {
  assertEquals(lpLiveConds({ fills: [{ cond: "b" }, { cond: "a" }], open: [{ cond: "b" }], recent: [{ cond: "c" }] }), ["a", "b", "c"]);
  assert(lpLiveConds({ fills: [], open: [], recent: [] }).length === 0);
});
