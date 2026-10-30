// "Reward quotes live-prep"'s real-money book as the Agents page shows it (pm_lp_live_view.ts), against a record worked
// out by hand at the browser sweep's clock (`src/e2e/lp_live_fixture.json`, which the sweep serves as the dashboard's
// `lpLive`: its `output` must be the function's own answer for its `input`, and `noPayout` its answer before any payout
// is read). On LIVE the row is called "Reward quotes" and its page's STATUS is the TESTING page's, R (ACTUAL) in place of
// the worst case.
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
// for 17 Sep yet). The stop reads the page's TOTAL since Addendum 18: 0.80 + 2.20 + 0.05 − 0 = 3.05, 78.05 from −75 (3.00 and
// 78.00 before it, rebates not counted). Three markets at work, five orders open.
// STATUS: G made 1.05 paid + 0.60 = 1.65, the largest part (TOP SHARE 1.65 / 3.05, 54 %); three markets chosen today, two
// still held. Before any payout: R none, realised 0.60, G's 0.60 the largest of a total of 0.80.
// QUOTES: G rests a buy of YES at 0.44 and of NO at 0.54 (an ask of 0.46), H a sell of its NO at 0.30 (a bid of 0.70), J a
// buy of YES at 0.30 and a pending buy of NO at 0.68 (an ask of 0.32). Shares at the last live minute: G 0.005 × 1440 / 20
// = 36 %, H 0.002 × 1440 / 120 = 2.4 %, J none (the formula paid it nothing). By market G 1.05 + 0.60 = 1.65, H 1.20 +
// 0.10 = 1.30, J 0.10: they add up to the total, 3.05.
// REWARDS TODAY (EST.), at 23:00 UTC with 60 minutes left: today's live hours give G 0.30 at 21:00 and 22:00, H 0.12 and
// 0.18, J 0 at 22:00 (and G's 0.50 at 23:00 the day before, which is not today's): 0.90 of formula so far. R: one day
// read, 2.20 / 5.00 = 0.44; on the log scale its mean is shrunk towards the prior's ln √0.2 = −0.804719 as two days,
// (2 × −0.804719 + ln 0.44) / 3 = −0.810139, its σ the prior's ln 5 / (2 × 1.281552) = 0.627926 (one day has no spread),
// so the band is exp(−0.810139 ± 0.804719) = 0.198919 to 0.994594. G's own day read 1.00 / 2.00: (2 × −0.810139 + ln 0.5)
// / 3 = −0.771142, its band 0.206818 to 1.034147; H's 1.20 / 3.00: −0.845524, 0.192002 to 0.960016. So far: G 0.60 × each
// end + H 0.30 × each end = 0.181699 to 0.908493. The rest of the day: 60 minutes at the lowest and highest of the newest
// hour's 0.48 / 60 = 0.008 a minute, today's 0.90 / 120 = 0.0075 and the earlier day's 5.00 / 1440 = 0.003472: 0.208333 to
// 0.48, so the day's formula is 1.108333 to 1.38. Low: G (0.60 × 1.108333 / 0.90) × 0.206818 = 0.152816 and H's 0.070934
// are each under the $1 minimum, so 0; high: 0.60 × 1.38 / 0.90 × 1.034147 + 0.30 × 1.38 / 0.90 × 0.960016 = 1.393023.
// DAYS' Orders (2026-10-11), each day's fills marked to market: the live minutes at 16 Sep 23:59 read G's book as the
// others' 0.41 / 0.45 with our own ask at 0.43 (so 0.41 / 0.43, mid 0.42; G's 23:57 minute, 0.30 / 0.32, is older and not
// read) and H's as 0.68 / 0.72 with our own bid at 0.70 (0.70 / 0.72, mid 0.71, its NO at 0.29). 16 Sep closes holding G's
// 20 YES at 0.40 (+0.40 at 0.42) and H's 10 NO at 0.28 (+0.10 at 0.29): +0.50. 17 Sep: G's 20 sold at 0.43 from 0.42
// (+0.20), H's NO 0.29 to 0.29 (0), J's 10 YES bought at 0.30 and at 0.31 now (+0.10): +0.30. The two add up to the
// fills' +0.80 (realised 0.60 + unrealised 0.20), and 17 Sep, not yet read, is a row with its Orders alone.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/lp_live_fixture.json" with { type: "json" };
import readout109 from "../../../docs/agents/backtests/lpcfg/data/readout_2026-10-09.json" with { type: "json" };
import rewardDays1011 from "../../../docs/agents/backtests/lpobsdeep/data/reward_days.json" with { type: "json" };
import { atLiveR, LP_LIVE_HOURS_VIEW, LP_R_DAY_CORRECTIONS, lpLivePrice, wholeFormulaOf, lpCloseMinutes, lpDayOrders, lpLiveR, lpLiveSince, lpLiveSummary, lpMinuteMid, lpRewardEstimate, restartStopOf, type LpLiveCloseRow, type LpLiveHourRow, type LpLiveRewardDayRow } from "./pm_lp_live_view.ts";
import { settlementFills, type PmFill } from "./pm_live.ts";
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
  assertEquals(JSON.parse(JSON.stringify(lpLiveSummary({ ...F.input, rewardDays: [] }))), F.noPayout);
  assertEquals([out.status, F.noPayout.status, F.noPayout.r, F.noPayout.realisedUsd], [{ bestMarketUsd: 1.65, quoting: 3, held: 2 }, { bestMarketUsd: 0.6, quoting: 3, held: 2 }, null, 0.6]);
  // Before any payout is read, DAYS holds the fills' days alone: their Orders, the readout's cells empty.
  assertEquals(F.noPayout.days.map((d: Record<string, unknown>) => [d.day, d.read, d.markets, d.paidUsd, d.r, d.ordersUsd]), [["2026-09-17", false, null, null, null, 0.3], ["2026-09-16", false, null, null, null, 0.5]]);
  near(out.capUsd, 320, "funded: the config's total cap");
  near(out.restingBuysUsd, 29.4, "8.80 + 10.80 + 3.00 + 6.80"); near(out.costUsd, 5.8, "2.80 + 3.00"); near(out.valueUsd, 35.2, "deployed");
  near(out.unrealisedUsd, 0.2, "0.10 + 0.10"); near(out.realisedFillsUsd, 0.6, "G's 20 YES sold at 0.43, bought at 0.40");
  near(out.paidUsd, 2.2, "0.80 + 0.20 + 1.20"); near(out.rebateUsd, 0.05, "G's rebate"); near(out.realisedUsd, 2.85, "0.60 + 2.20 + 0.05");
  near(out.todayUsd, 0.8, "today's sell and every holding against its cost"); near(out.totalUsd, 3.05, "realised + unrealised");
  near(out.formulaUsd, 5, "the formula, apart"); near(out.r!, 0.44, "R = 2.20 / 5.00"); assertEquals(out.feesUsd, 0);
  assertEquals([out.stop.basisUsd, out.stop.roomUsd, out.stop.limitUsd, out.stop.trippedAt], [3.05, 78.05, 75, null]);
  assertEquals([out.stop.rebateUsd, out.stop.feesUsd, out.stop.basisUsd], [0.05, 0, out.totalUsd]);
  assertEquals([out.openOrders, out.markets, out.fills, out.armed, out.running, out.lagMinutes, out.liveSince], [5, 3, 4, true, true, 1, "2026-09-16T01:32:21.000Z"]);
  // What it holds is QUOTES' held column (its HELD table went, 2026-10-09): H 10 NO, J 10 YES.
  assertEquals(out.quotes.map((x) => [x.q, x.yes, x.no, x.mark]), [["Will G happen?", 0, 0, 0.45], ["Will H happen?", 0, 10, 0.71], ["Will J happen?", 10, 0, 0.31]]);
  // LIVE's Rewards (est.) and Total (est.) (Davies, 2026-10-09, in place of Avg cost): what was paid plus today's formula,
  // not yet read, at each market's point R: G 1.05 + 0.60 × exp(−0.771142) = 1.05 + 0.277491; H 1.20 + 0.30 ×
  // exp(−0.845524) = 1.20 + 0.128800; J nothing paid and no formula. Total (est.) adds the orders: 1.927491, 1.428800, 0.10.
  assertEquals(out.quotes.map((x) => [x.q, x.rewardEstUsd, x.totalEstUsd]), [["Will G happen?", 1.327491, 1.927491], ["Will H happen?", 1.3288, 1.4288], ["Will J happen?", 0, 0.1]]);
  assertEquals(out.quotes.map((x) => "yesCost" in x || "noCost" in x), [false, false, false]);
  // DAYS, newest first: 17 Sep not yet read (its Orders alone), 16 Sep read; Orders +0.30 and +0.50 (the header's arithmetic),
  // adding up to the fills' P&L, realised less fees plus unrealised.
  assertEquals(out.days.map((d) => [d.day, d.read, d.markets, d.ordersUsd, d.formulaUsd, d.paidUsd, d.r, d.rebateUsd]), [
    ["2026-09-17", false, null, 0.3, null, null, null, null], ["2026-09-16", true, 2, 0.5, 5, 2.2, 0.44, 0.05],
  ]);
  near(out.days.reduce((s, d) => s + d.ordersUsd, 0), out.realisedFillsUsd + out.unrealisedUsd, "the days' Orders add up to the fills' P&L");
  // Newest first, everywhere; the MATCHED fill listed and not counted.
  assertEquals(out.quotes.map((x) => [x.q, x.quoting, x.ratePerDay, x.bid, x.ask, x.share, x.yes, x.no, x.rewardUsd, x.fillsPnlUsd, x.totalUsd]), [
    ["Will G happen?", true, 20, 0.44, 0.46, 0.36, 0, 0, 1.05, 0.6, 1.65],
    ["Will H happen?", true, 120, 0.7, null, 0.024, 0, 10, 1.2, 0.1, 1.3],
    ["Will J happen?", true, 15, 0.3, 0.32, null, 10, 0, 0, 0.1, 0.1],
  ]);
  near(out.quotes.reduce((s, x) => s + Number(x.totalUsd), 0), out.totalUsd, "the markets add up to the total");
  assertEquals(out.recentFills.map((f) => [f.tradeId, f.tokenSide, f.outcome, f.size, f.tokenPrice, f.counted]), [
    ["t-5", "BUY", "yes", 5, 0.3, false], ["t-4", "BUY", "yes", 10, 0.3, true], ["t-3", "SELL", "yes", 20, 0.43, true], ["t-2", "BUY", "no", 10, 0.28, true], ["t-1", "BUY", "yes", 20, 0.4, true],
  ]);
  // A market held from an earlier day, no longer chosen, is a QUOTES row of its own, quoted only to sell.
  const carried = lpLiveSummary({ ...F.input, markets: F.input.markets.filter((m: { day: string; question: string }) => !(m.day === "2026-09-17" && m.question === "Will H happen?")) })!;
  assertEquals(carried.quotes.map((x) => [x.q, x.quoting, x.ratePerDay, x.bid, x.share]), [["Will G happen?", true, 20, 0.44, 0.36], ["Will J happen?", true, 15, 0.3, null], ["Will H happen?", false, null, 0.7, null]]);
  assertEquals([carried.status.quoting, carried.status.held], [2, 2]);
  // The parts add up: realised + unrealised is the total, and the stop's reading (Addendum 18) is the fills' P&L plus what
  // was paid plus the rebates less the fees: the total itself.
  near(out.realisedUsd + out.unrealisedUsd, out.totalUsd, "realised + unrealised");
  near(out.stop.fillsPnlUsd + out.stop.paidUsd + out.stop.rebateUsd - out.stop.feesUsd, out.stop.basisUsd, "the stop's basis");
  near(out.stop.basisUsd, out.totalUsd, "the stop and the page are one number");
});

Deno.test("live-prep's live book is no row until it is armed or has sent a live order, and stays one once it has", () => {
  const never = { ...F.input, config: { ...F.input.config, dry_run: true, live_confirmed_at: null }, open: [], firstLive: null, fills: [], rewardDays: [] };
  assertEquals(lpLiveSummary(never), null);
  assertEquals(lpLiveSummary({ ...F.input, config: null }), null);
  // Armed with nothing sent yet: a row, empty.
  const armed = lpLiveSummary({ ...never, config: F.input.config })!;
  assertEquals([armed.armed, armed.tradedLive, armed.valueUsd, armed.realisedUsd, armed.openOrders], [true, false, 0, 0, 0]);
  // Disarmed after trading: still real money's record, live since its first live order; and with nothing resting and
  // no fill, its first live order alone keeps it a row.
  const off = { ...F.input.config, dry_run: true, live_confirmed_at: null };
  const disarmed = lpLiveSummary({ ...F.input, config: off })!;
  assertEquals([disarmed.armed, disarmed.tradedLive, disarmed.realisedUsd, disarmed.liveSince], [false, true, 2.85, F.input.firstLive]);
  assertEquals(lpLiveSummary({ ...never, firstLive: F.input.firstLive })?.tradedLive, true);
  assertEquals([lpLiveSince(off, "x"), lpLiveSince(F.input.config, "x"), lpLiveSince(null, null)], ["x", F.input.config.live_confirmed_at, null]);
});

Deno.test("live-prep's live stop: tripped by its event, and a settlement realised at its payout", () => {
  const tripped = lpLiveSummary({ ...F.input, stop: { minute: "2026-09-17T20:00:00.000Z", detail: {} } })!;
  assertEquals(tripped.stop.trippedAt, "2026-09-17T20:00:00.000Z");
  // J resolves NO: its 10 YES bought at 0.30 realise −3.00 and leave the book; H still held.
  const J = F.input.markets.find((m: { question: string }) => m.question === "Will J happen?");
  const settled = lpLiveSummary({ ...F.input, settlements: [{ cond: J.cond, yes_token: J.yes_token, no_token: J.no_token, payout: 0, settled_at: "2026-09-17T22:00:00.000Z" }] })!;
  near(settled.realisedFillsUsd, 0.6 - 3, "G's +0.60 and J's −3.00"); near(settled.costUsd, 2.8, "H alone"); near(settled.unrealisedUsd, 0.1, "H's");
  assertEquals(settled.quotes.map((x) => [x.q, x.yes, x.no]), [["Will G happen?", 0, 0], ["Will H happen?", 0, 10], ["Will J happen?", 0, 0]]);
  near(settled.stop.basisUsd, 0.6 - 3 + 0.1 + 2.2 + 0.05, "the stop moves with it");
  // A held token whose market the last turn did not read is held at cost: no unrealised, never a guess.
  const unread = lpLiveSummary({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, markets: [] } } })!;
  assertEquals([unread.unrealisedUsd, unread.costUsd, unread.quotes.map((x) => x.mark)], [0, 5.8, [null, null, null]]);
});

Deno.test("the dashboard reads live-prep's live book from its live rows only: no dry-run row, no paper layer, nothing written", async () => {
  const I = F.input;
  // The fixture's rows, beside dry-run rows that would move every figure if any leaked: a resting dry-run buy, a dry-run
  // reward day, and the paper layer's own fills and days.
  // The dry-run order is older than the first live one: were it read as live, it would move "live since" and the days.
  const dryOrder = { ...I.open[3], id: 50, ts: "2026-09-15T22:30:00.000Z", size: 1000 };
  const mem = memDb({
    [T.config]: [{ id: 1, ...I.config }],
    [T.state]: [{ id: 1, ...I.state }],
    [T.orders]: [{ ...dryOrder, mode: "dry_run" }, { ...I.open[0], id: 60, ts: I.firstLive, mode: "live", state: "cancelled" }, ...I.open.map((o: Record<string, unknown>) => ({ mode: "live", ...o }))],
    // Each fill as the table holds it: its trade record's side for us and fee rate inside `detail.trade`.
    [T.fills]: I.fills.map(({ trader_side, fee_rate_bps, ...f }: Record<string, unknown>) => ({ ...f, detail: { trade: { trader_side, fee_rate_bps } } })),
    [T.settlements]: I.settlements,
    [T.rewardDays]: [...I.rewardDays.map((r: Record<string, unknown>) => ({ mode: "live", ...r })), { mode: "dry_run", day: "2026-09-16", cond: I.rewardDays[0].cond, minutes: 1, minutes_scored: 1, formula_usd: 500, actual_usd: null, actual_sponsored_usd: null, rebate_usd: null }],
    [T.markets]: [...I.markets, { ...I.markets[0], day: "2026-09-15", question: "dry-run only" }],
    [T.events]: [{ mode: "dry_run", minute: "2026-09-17T12:00:00.000Z", kind: "loss_stop_total", detail: {} }],
    // The last turn's live minute, and the live minutes before 16 Sep's midnight that DAYS' Orders marks the day's close at;
    // a dry-run minute at the same midnight and a live one 20 minutes before it would move 16 Sep's Orders were either read.
    [T.minutes]: [
      ...I.minutes.map((x: Record<string, unknown>) => ({ mode: "live", minute: I.state.state.minute, ...x })), { mode: "dry_run", minute: I.state.state.minute, cond: I.minutes[2].cond, rate: 15, formula_usd: 9 },
      ...I.closes.map((x: Record<string, unknown>) => ({ mode: "live", ...x })),
      { mode: "dry_run", minute: "2026-09-16T23:59:00.000Z", cond: I.closes[1].cond, bb: 0.9, ba: 0.92, bid_price: null, ask_price: null },
      { mode: "live", minute: "2026-09-16T23:40:00.000Z", cond: I.closes[2].cond, bb: 0.1, ba: 0.12, bid_price: null, ask_price: null },
    ],
    pm_lpprep_fills: [{ cond: I.markets[0].cond, token: "x", token_side: "BUY", token_price: 0.5, size: 1000 }],
    pm_lpprep_days: [{ day: "2026-09-16", reward: 999 }],
    // 0107's view: the live hours of the last two days, as the database sums them.
    [LP_LIVE_HOURS_VIEW]: I.hours,
  }, { now: () => I.nowMs });
  const reads = [T.config, T.state, T.orders, T.fills, T.settlements, T.rewardDays, T.markets, T.events, T.minutes, LP_LIVE_HOURS_VIEW];
  const db = onlyTables(mem.db, reads, { readOnly: reads });
  const out = await readLpLive(db, I.nowMs);
  assertEquals(JSON.parse(JSON.stringify(out)), F.output);
  assertEquals([...db.touched].sort(), [...reads].sort());
  // Disarmed (here never armed, a dry-run order aside): off alone, and nothing of its book is read (2026-10-30: the page lists it
  // only while armed, so its fills, markets, minutes and hours view were read every minute for no row).
  const quiet = memDb({ [T.config]: [{ id: 1, ...I.config, dry_run: true, live_confirmed_at: null }], [T.state]: [], [T.orders]: [{ ...dryOrder, mode: "dry_run" }] }, { now: () => I.nowMs });
  const quietDb = onlyTables(quiet.db, [T.config], { readOnly: [T.config] });
  assertEquals(await readLpLive(quietDb, I.nowMs), { armed: false, dryRun: true, off: true });
  assertEquals([...quietDb.touched], [T.config]);
  // A read that fails leaves the row off, never the page.
  const broken: typeof mem.db = { ...mem.db, select: (t, q) => (t === T.markets ? Promise.reject(new Error(`db GET ${t} → 500`)) : mem.db.select(t, q)), selectAll: (t, q) => (t === T.markets ? Promise.reject(new Error(`db GET ${t} → 500`)) : mem.db.selectAll(t, q)) };
  assertEquals(await readLpLive(broken, I.nowMs), null);
});

Deno.test("the dashboard's live-hours read pages to the end: today's formula past the first thousand rows still counts", async () => {
  // 2026-10-13 on production: the view's 48 hours held 1,555 rows (an hour for every market worked, carried ones too),
  // so one page of a thousand, ordered hour ascending, stopped at 05:00 today — every scored minute of the day came
  // after it, and REWARDS TODAY (EST.) read $0 – $0. Here 1,005 of yesterday's rows stand before the fixture's hours.
  const I = F.input;
  const filler = Array.from({ length: 1005 }, (_, i) => ({ hour: "2026-09-16T01:00:00.000Z", cond: `filler-${String(i).padStart(4, "0")}`, minutes: 60, formula_usd: 0, formula_scored_usd: 0 }));
  const mem = memDb({
    [T.config]: [{ id: 1, ...I.config }],
    [T.state]: [{ id: 1, ...I.state }],
    [T.orders]: I.open.map((o: Record<string, unknown>) => ({ mode: "live", ...o })),
    [T.fills]: I.fills.map(({ trader_side, fee_rate_bps, ...f }: Record<string, unknown>) => ({ ...f, detail: { trade: { trader_side, fee_rate_bps } } })),
    [T.settlements]: I.settlements,
    [T.rewardDays]: I.rewardDays.map((r: Record<string, unknown>) => ({ mode: "live", ...r })),
    [T.markets]: I.markets,
    [T.events]: [],
    [T.minutes]: [...I.minutes.map((x: Record<string, unknown>) => ({ mode: "live", minute: I.state.state.minute, ...x })), ...I.closes.map((x: Record<string, unknown>) => ({ mode: "live", ...x }))],
    [LP_LIVE_HOURS_VIEW]: [...filler, ...I.hours],
  }, { now: () => I.nowMs });
  const out = await readLpLive(mem.db, I.nowMs);
  assertEquals(out && !("off" in out) ? out.estimate.soFar : null, F.output.estimate.soFar);
});

// ------------------------------------------------------------------ DAYS' Orders

Deno.test("DAYS' Orders: each day's fills marked to market, a settlement on its day, the days adding up to the fills' P&L", () => {
  // Two markets, A (YES ay, NO an) and B (YES by, NO bn), live from 9 Oct; now 11 Oct 12:00 UTC.
  //   9 Oct  buys 100 A YES at 0.30 and 50 B NO at 0.60. At 23:59 A's book is 0.31 / 0.33 (mid 0.32; its 23:56 minute,
  //          0.89 / 0.91, is outside the three minutes read) and B's the others' 0.40 / 0.46 with our bid at 0.44, so
  //          0.44 / 0.46, mid 0.45, its NO at 0.55: 100 × 0.02 + 50 × −0.05 = −0.50.
  //   10 Oct sells 40 A YES at 0.35 (+2.00, and a taker's fee of 0.10); A resolves NO at 18:05, its 60 YES realised at
  //          0 (−18.00); B's 23:59 minute has no book, so its 23:58 is read, 0.37 / 0.39, mid 0.38, its NO at 0.62
  //          (+1.00 on cost). The close is −16.00 + 1.00 = −15.00, so −15.00 − (−0.50) − 0.10 = −14.60; as cash, the
  //          day's 14.00 in, its 31.00 held at the close and 59.50 at the open: 14 + 31 − 59.5 − 0.10 = −14.60.
  //   11 Oct buys 50 B NO at 0.50 (100 at 0.55) and B's mid is 0.40 now (NO 0.60): −16.00 + 5.00 = −11.00, so +4.00
  //          (−25 + 60 − 31).
  // The days add up to −11.10: realised −16.00 less the 0.10 fee, plus unrealised +5.00.
  const t = (s: string) => Date.parse(s);
  const A = { cond: "A", yes_token: "ay", no_token: "an" }, B = { cond: "B", yes_token: "by", no_token: "bn" };
  const fills: PmFill[] = [
    { token: "ay", side: "BUY", price: 0.3, size: 100, ts: t("2026-10-09T10:00:00Z") }, { token: "bn", side: "BUY", price: 0.6, size: 50, ts: t("2026-10-09T11:00:00Z") },
    { token: "ay", side: "SELL", price: 0.35, size: 40, ts: t("2026-10-10T09:00:00Z") }, { token: "bn", side: "BUY", price: 0.5, size: 50, ts: t("2026-10-11T08:00:00Z") },
  ];
  const all = [...fills, ...settlementFills([{ ...A, payout: 0, settled_at: "2026-10-10T18:05:00Z" }])];
  const close = (minute: string, cond: string, bb: number | null, ba: number | null, bid_price: number | null = null, ask_price: number | null = null): LpLiveCloseRow => ({ minute, cond, bb, ba, bid_price, ask_price });
  const closes = [
    close("2026-10-09T23:56:00Z", "A", 0.89, 0.91), close("2026-10-09T23:59:00Z", "A", 0.31, 0.33), close("2026-10-09T23:59:00Z", "B", 0.4, 0.46, 0.44),
    close("2026-10-10T23:58:00Z", "B", 0.37, 0.39), close("2026-10-10T23:59:00Z", "B", null, null, 0.5),
  ];
  const nowMs = t("2026-10-11T12:00:00Z"), marksNow = { ay: null, an: null, by: 0.4, bn: 0.6 };
  const fees = [{ ts: t("2026-10-10T09:00:00Z"), usd: 0.1 }];
  const days = lpDayOrders({ fills: all, fees, markets: [A, B], closes, marksNow, nowMs });
  assertEquals([...days], [["2026-10-09", -0.5], ["2026-10-10", -14.6], ["2026-10-11", 4]]);
  // The page's own figures for the same record: the days add up to its fills' P&L, realised less fees plus unrealised.
  near([...days.values()].reduce((a, b) => a + b, 0), -16 - 0.1 + 5, "the days' sum");
  // A midnight with no book read holds what is held at cost there: 10 Oct's close is −16.00, so the split moves (−15.60,
  // +5.00) and the sum does not.
  const unmarked = lpDayOrders({ fills: all, fees, markets: [A, B], closes: closes.filter((c) => !c.minute.startsWith("2026-10-10")), marksNow, nowMs });
  assertEquals([...unmarked], [["2026-10-09", -0.5], ["2026-10-10", -15.6], ["2026-10-11", 5]]);
  // No fill, no day; a fill today alone, today alone.
  assertEquals(lpDayOrders({ fills: [], fees: [], markets: [A, B], closes, marksNow, nowMs }).size, 0);
  assertEquals([...lpDayOrders({ fills: [fills[3]], fees: [], markets: [A, B], closes, marksNow, nowMs })], [["2026-10-11", 5]]);
});

Deno.test("DAYS' Orders reads a midnight's mark as the page reads the book: the others' touch or our own quote where it is better", () => {
  const r = (bb: number | string | null, ba: number | string | null, bid_price: number | string | null = null, ask_price: number | string | null = null) => lpMinuteMid({ bb, ba, bid_price, ask_price });
  near(r(0.4, 0.46)!, 0.43, "the others' touch alone");
  near(r(0.4, 0.46, 0.44, 0.45)!, 0.445, "our bid at 0.44 and ask at 0.45 are the touch");
  near(r(0.4, 0.46, 0.3, 0.5)!, 0.43, "our quotes behind the others' are not");
  near(r("0.48", "0.56", null, "0.54")!, 0.51, "as PostgREST returns numerics, text");
  assertEquals([r(null, null, 0.5), r(0.5, 0.5), r(null, 0.4)], [null, null, null]);
  // The minutes read: the three before each midnight that has passed since the first fill's day.
  assertEquals(lpCloseMinutes(Date.parse("2026-10-09T10:00:00Z"), Date.parse("2026-10-11T00:00:00Z")), [
    "2026-10-09T23:57:00.000Z", "2026-10-09T23:58:00.000Z", "2026-10-09T23:59:00.000Z", "2026-10-10T23:57:00.000Z", "2026-10-10T23:58:00.000Z", "2026-10-10T23:59:00.000Z",
  ]);
  assertEquals(lpCloseMinutes(Date.parse("2026-10-11T00:10:00Z"), Date.parse("2026-10-11T12:00:00Z")), []);
});

Deno.test("funded is the cap the last turn held its buys to (since Addendum 8 it follows the equity); without one, the config's", () => {
  const withCap = lpLiveSummary({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, limits: { capTotal: 370 } } } })!;
  near(withCap.capUsd, 370, "the turn's cap");
  near(lpLiveSummary(F.input)!.capUsd, 320, "no turn's figure: the config's");
});

Deno.test("a live fill's fee is its trade record's: a taker pays its rate by the docs' formula, a maker nothing", () => {
  // Every fill so far is a maker's (post-only): no fee, nothing off realised.
  assertEquals(lpLiveSummary(F.input)!.feesUsd, 0);
  // Were G's sell of 20 YES at 0.43 a taker's at 400 bps: 20 × 0.04 × 0.43 × 0.57 = 0.19608, off realised and the total.
  const taker = lpLiveSummary({ ...F.input, fills: F.input.fills.map((f: { trade_id: string }) => (f.trade_id === "t-3" ? { ...f, trader_side: "TAKER", fee_rate_bps: "400" } : f)) })!;
  near(taker.feesUsd, 0.19608, "the taker's fee");
  near(taker.realisedUsd, 2.85 - 0.19608, "realised, less the fee"); near(taker.totalUsd, 3.05 - 0.19608, "the total too");
  near(taker.realisedUsd + taker.unrealisedUsd, taker.totalUsd, "still adding up");
});

// ------------------------------------------------------------------ REWARDS TODAY (EST.)

Deno.test("today's rewards, estimated: the hand-worked record (the header's arithmetic), and before any payout the prior's band", () => {
  const e = lpLiveSummary(F.input)!.estimate;
  assertEquals([e.day, e.minutesLeft, e.r.days, e.r.basis], ["2026-09-17", 60, 1, "live"]);
  near(e.soFar.formulaUsd, 0.9, "G 0.60 + H 0.30 + J 0, yesterday's hour left out");
  assertAlmostEquals(e.r.point, 0.444796, 1e-6); assertAlmostEquals(e.r.low, 0.198919, 1e-6); assertAlmostEquals(e.r.high, 0.994594, 1e-6);
  assertAlmostEquals(e.soFar.lowUsd, 0.181699, 1e-6); assertAlmostEquals(e.soFar.highUsd, 0.908493, 1e-6);
  assertEquals([e.rates.recent, e.rates.today], [0.008, 0.0075]); assertAlmostEquals(e.rates.days!, 0.003472, 1e-6);
  assertAlmostEquals(e.fullDay.formulaLowUsd, 1.108333, 1e-6); near(e.fullDay.formulaHighUsd, 1.38, "0.90 + 60 × 0.008");
  assertEquals(e.fullDay.lowUsd, 0);                                                       // both markets' lows under $1
  assertAlmostEquals(e.fullDay.highUsd, 1.393023, 1e-6);
  // No payout read: the prior alone, 0.2 to 1 around √0.2; the earlier days' rate is unknown, so the rest of the day runs
  // at 0.0075 to 0.008 a minute.
  const p = F.noPayout.estimate;
  assertEquals([p.r.basis, p.r.days, p.r.low, p.r.high, p.r.point], ["prior", 0, 0.2, 1, 0.447214]);
  assertEquals([p.soFar.lowUsd, p.soFar.highUsd, p.fullDay.formulaLowUsd, p.fullDay.formulaHighUsd], [0.18, 0.9, 1.35, 1.38]);
});

const G = F.input.markets[0].cond, H = F.input.markets[1].cond;
const DAY0 = Date.parse("2026-10-10T00:00:00Z");
/** `n` hours of G from 00:00 at `f` a full hour, the last one `lastMin` minutes long. */
const hoursOf = (n: number, f: number, lastMin = 60): LpLiveHourRow[] =>
  Array.from({ length: n }, (_, i) => { const x = i === n - 1 ? (f * lastMin) / 60 : f; return { hour: new Date(DAY0 + i * 3600e3).toISOString(), cond: G, minutes: i === n - 1 ? lastMin : 60, formula_usd: x, formula_scored_usd: x }; });
const paid = (day: string, formula: number, paidUsd: number, cond = G) => ({ day, cond, minutes: 1440, minutes_scored: 1400, formula_usd: formula, formula_scored_usd: formula, actual_usd: paidUsd, actual_sponsored_usd: 0, rebate_usd: 0 });

Deno.test("today's estimate grows as the day's minutes accrue, every dashboard read, and starts again from nothing at 00:00 UTC", () => {
  const days = [paid("2026-10-09", 100, 40)];
  let last = -1;
  for (let m = 1; m <= 23 * 60; m += 37) {
    const now = DAY0 + m * 60e3, h = Math.floor(m / 60), part = m % 60;
    const hours = part ? hoursOf(h + 1, 6, part) : hoursOf(h, 6);
    const e = lpRewardEstimate({ rewardDays: days, hours, nowMs: now });
    near(e.soFar.formulaUsd, (6 * m) / 60, `formula so far at minute ${m}`);
    assert(e.soFar.highUsd > last, `minute ${m}: ${e.soFar.highUsd} after ${last}`);
    last = e.soFar.highUsd;
  }
  // 23:59 with the day's hours, then 00:00 of the next: yesterday's rows are no part of it, and nothing has accrued.
  const full = hoursOf(24, 6, 59);
  const before = lpRewardEstimate({ rewardDays: days, hours: full, nowMs: DAY0 + DAY_MS - 60e3 });
  assert(before.soFar.highUsd > 50, JSON.stringify(before.soFar));
  const after = lpRewardEstimate({ rewardDays: days, hours: full, nowMs: DAY0 + DAY_MS });
  assertEquals([after.day, after.soFar.formulaUsd, after.soFar.lowUsd, after.soFar.highUsd, after.minutesLeft], ["2026-10-11", 0, 0, 0, 1440]);
  // Its day is the projection alone, at the earlier days' rate: 100 a day, the 10th to the 90th percentile of R.
  near(after.fullDay.formulaHighUsd, 100, "1440 minutes at 100 / 1440");
});
const DAY_MS = 86400e3;

Deno.test("a payout read moves R's band by itself: none, one day, two days, as the algorithm says", () => {
  const hours = hoursOf(12, 6), now = DAY0 + 12 * 3600e3;
  const none = lpRewardEstimate({ rewardDays: [], hours, nowMs: now }).r;
  assertEquals([none.low, none.point, none.high, none.days, none.basis], [0.2, 0.447214, 1, 0, "prior"]);
  // One day at 0.44: the mean moves, the spread is still the prior's (exp(−0.810139 ± 0.804719)).
  const one = lpRewardEstimate({ rewardDays: [paid("2026-10-08", 5, 2.2)], hours, nowMs: now }).r;
  assertEquals([one.low, one.point, one.high, one.days, one.basis], [0.198919, 0.444796, 0.994594, 1, "live"]);
  // A second at 0.30: mean (2 ln √0.2 + ln 0.44 + ln 0.30) / 4 = −0.908598; their spread's variance 0.073338 weighs two days
  // against the prior's two: σ = √((2 × 0.394291 + 2 × 0.073338) / 4) = 0.483545; exp(−0.908598 ± 1.281552 × 0.483545).
  const two = lpRewardEstimate({ rewardDays: [paid("2026-10-08", 5, 2.2), paid("2026-10-09", 10, 3)], hours, nowMs: now }).r;
  assertEquals([two.low, two.point, two.high, two.days], [0.216907, 0.403089, 0.74908, 2]);
  // A day whose formula is under $1 says nothing of R; today's own row, before its payout is read, is not a day read.
  assertEquals(lpRewardEstimate({ rewardDays: [paid("2026-10-08", 0.5, 0.5)], hours, nowMs: now }).r.days, 0);
  assertEquals(lpRewardEstimate({ rewardDays: [paid("2026-10-10", 5, 5)], hours, nowMs: now }).r.days, 0);
  // A market read before has its own: G paid 0.80 of 2.00 and H 0.10 of 2.00 the same day (0.225 overall): G's band sits
  // above H's, and today's G alone is estimated on G's.
  const mixed = [paid("2026-10-09", 2, 0.8, G), paid("2026-10-09", 2, 0.1, H)];
  const g = lpRewardEstimate({ rewardDays: mixed, hours, nowMs: now }).soFar;
  const h = lpRewardEstimate({ rewardDays: mixed, hours: hours.map((x) => ({ ...x, cond: H })), nowMs: now }).soFar;
  assert(g.lowUsd > h.lowUsd && g.highUsd > h.highUsd, JSON.stringify({ g, h }));
});

Deno.test("QUOTES' Rewards (est.): paid plus the unread days' formula at the market's point R; grows in a day, carries yesterday over 00:00 until it is read", () => {
  const C = "2026-10-10T", h = (hour: string, f: number, cond = G): LpLiveHourRow => ({ hour: `${hour}:00:00.000Z`, cond, minutes: 60, formula_usd: f, formula_scored_usd: f });
  const read8 = [paid("2026-10-08", 5, 2.2, G)];                                // one day read, G at 0.44
  // 10-09 not read yet: its 10 of formula and today's count at G's point R, exp((2 μ + ln 0.44) / 3) with μ the overall
  // shrunk mean (2 ln √0.2 + ln 0.44) / 3 = −0.810139 → G's (2 × −0.810139 + ln 0.44) / 3 = −0.813753, R 0.443192.
  const at = (now: string, hours: LpLiveHourRow[], days = read8) => lpRewardEstimate({ rewardDays: days, hours, nowMs: Date.parse(now) }).markets[G];
  const y = [h("2026-10-09T10", 4), h("2026-10-09T20", 6)];
  const a = at(`${C}06:30:00Z`, [...y, h(`${C}05`, 1)]), b = at(`${C}09:30:00Z`, [...y, h(`${C}05`, 1), h(`${C}08`, 2)]);
  assertAlmostEquals(a.r, 0.443192, 1e-6);
  near(a.unreadFormulaUsd, 11, "yesterday's 10 and today's 1"); assertAlmostEquals(a.estUsd, 11 * 0.443192, 1e-5);
  assert(b.estUsd > a.estUsd, "it grows as the day's formula does");
  // 00:00 UTC on 10-11: 10-10 rolls into the unread days beside 10-09; nothing of 10-11 yet.
  const c = at("2026-10-11T00:00:00Z", [...y, h(`${C}05`, 1), h(`${C}08`, 2)]);
  near(c.unreadFormulaUsd, 13, "10-09 and 10-10, both unread");
  // 10-09's payout read (paid 3.00 of 10): it leaves the estimate, its money now paid; G's R moves with it.
  const d = lpRewardEstimate({ rewardDays: [...read8, paid("2026-10-09", 10, 3, G)], hours: [...y, h(`${C}05`, 1), h(`${C}08`, 2)], nowMs: Date.parse("2026-10-11T01:30:00Z") }).markets[G];
  near(d.unreadFormulaUsd, 3, "10-10 alone");
  assert(d.r < a.r, `R falls with a day at 0.30: ${d.r} after ${a.r}`);
  // In the summary: Rewards (est.) = what was paid + this, Total (est.) = that + the orders.
  const q = lpLiveSummary(F.input)!.quotes[0];
  near(Number(q.rewardEstUsd), Number(q.rewardUsd) + 0.277491, "G"); near(Number(q.totalEstUsd), Number(q.rewardEstUsd) + Number(q.fillsPnlUsd), "adds up");
});

Deno.test("Addendum 9: R and today's estimate rest on the minutes Polymarket read scoring, not on the whole formula (10-09: 153.90 counted, 19.80 scored, 6.53 paid)", () => {
  // 2026-10-09's live day as the readout books it, in one market: R over the scored formula, not over the whole.
  const day = { day: "2026-10-09", cond: G, minutes: 1347, minutes_scored: 500, formula_usd: 153.9, formula_scored_usd: 19.8, actual_usd: 6.53, actual_sponsored_usd: 0, rebate_usd: 0 };
  const now = Date.parse("2026-10-10T06:00:00Z");
  const e = lpRewardEstimate({ rewardDays: [day], hours: [], nowMs: now });
  // One day of ln(6.53 / 19.80) against the prior's two days of ln 0.447: exp((2 ln 0.447214 + ln 0.329798) / 3).
  assertAlmostEquals(e.r.point, Math.exp((2 * Math.log(Math.sqrt(0.2)) + Math.log(6.53 / 19.8)) / 3), 1e-6, "R's point on the scored formula (to six places)");
  assert(e.r.point > 0.39, `on the whole formula it would be exp((2 ln 0.447 + ln 0.0424) / 3) = 0.203; it is ${e.r.point}`);
  // Today: an hour whose formula is 1.00 of which Polymarket scored 0.25 counts 0.25.
  const h = { hour: "2026-10-10T05:00:00.000Z", cond: G, minutes: 60, formula_usd: 1, formula_scored_usd: 0.25 };
  const t = lpRewardEstimate({ rewardDays: [day], hours: [h], nowMs: now });
  near(t.soFar.formulaUsd, 0.25, "today so far: the scored formula");
  near(t.markets[G].unreadFormulaUsd, 0.25, "the unread days' formula: scored");
  // The summary's R (ACTUAL) and DAYS: paid over the scored formula, the whole formula beside it.
  const s = lpLiveSummary({ ...F.input, rewardDays: [day], hours: [] })!;
  assertAlmostEquals(s.r!, 6.53 / 19.8, 1e-6, "R (ACTUAL), to six places");
  // (the fixture's fills, in September, are days of their own: Orders alone)
  assertEquals(s.days.filter((d) => d.read).map((d) => [d.formulaUsd, d.formulaAllUsd, d.r]), [[19.8, 153.9, Math.round((6.53 / 19.8) * 1e6) / 1e6]]);
});

Deno.test("lpLiveR is the one live R: the estimate's R is its, from the readout rows alone, the prior until a day is read", () => {
  const day = { day: "2026-10-09", cond: G, minutes: 1347, minutes_scored: 500, formula_usd: 153.9, formula_scored_usd: 19.8, actual_usd: 6.53, actual_sponsored_usd: 0, rebate_usd: 0 };
  const now = Date.parse("2026-10-10T06:00:00Z");
  const R = lpLiveR([day], now), e = lpRewardEstimate({ rewardDays: [day], hours: [], nowMs: now });
  assertEquals({ point: R.point, low: R.low, high: R.high, days: R.days, basis: R.basis, formula: "scored" }, e.r);
  assertEquals([R.days, R.basis], [1, "live"]);
  // Today's row is not yet a day of R; with none read it is the prior's.
  assertEquals([lpLiveR([{ ...day, day: "2026-10-10" }], now).basis, lpLiveR([], now).point], ["prior", 0.447214]);
});

Deno.test("Addendum 10: 10-09 enters R at its like-for-like figure (0.807, rtrue.py), by market, and its rows are not rewritten; other days stand as read", () => {
  const ro = readout109 as { rows: Array<Record<string, unknown>> };
  const rows = ro.rows.map((r) => ({ ...r, day: "2026-10-09" })) as unknown as LpLiveRewardDayRow[];
  const c = LP_R_DAY_CORRECTIONS["2026-10-09"].formulaScoredUsd;
  assertEquals(Object.keys(c).sort(), rows.map((r) => r.cond).sort());
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum(Object.values(c)), 8.081876, 1e-6);
  const paid = sum(rows.map((r) => Number(r.actual_usd) + Number(r.actual_sponsored_usd)));
  assertAlmostEquals(paid / sum(Object.values(c)), 0.807261, 1e-6);
  // One read day: R's point is the prior's two days and 10-09's ln 0.807261, not ln 0.33.
  const R = lpLiveR(rows, Date.parse("2026-10-10T06:00:00Z"));
  assertAlmostEquals(R.point, Math.exp((2 * Math.log(Math.sqrt(0.2)) + Math.log(paid / 8.081876)) / 3), 1e-6);
  // The summary's R (ACTUAL) and DAYS read the same figure; the whole formula is beside it.
  const s = lpLiveSummary({ ...F.input, rewardDays: rows, hours: [], nowMs: Date.parse("2026-10-10T06:00:00Z") })!;
  assertAlmostEquals(s.r!, paid / 8.081876, 1e-6);
  assertEquals(s.days.filter((d) => d.read).map((d) => [d.day, d.formulaUsd, d.formulaAllUsd]), [["2026-10-09", 8.081875, 153.897992]]);
  // A day with no correction stands as read.
  const later = rows.map((r) => ({ ...r, day: "2026-10-10" }));
  assertAlmostEquals(lpLiveR(later, Date.parse("2026-10-11T06:00:00Z")).point, Math.exp((2 * Math.log(Math.sqrt(0.2)) + Math.log(paid / 19.801095)) / 3), 1e-5);
});

Deno.test("Addendum 10, FUNDED: the money put in as booked; before a booking the path's reading of it; never the cap", () => {
  const withLp = (lp: unknown) => ({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, lp } } });
  const booked = lpLiveSummary(withLp({ funding: { depositUsd: 402.028365, at: "x", residualUsd: 402.03, candidate: null }, fundingResidual: { usd: 402.03, at: "x" } }))!;
  assertEquals([booked.fundedUsd, booked.fundedBasis, booked.capUsd], [402.028365, "booked", 320]);
  const reading = lpLiveSummary(withLp({ fundingResidual: { usd: 402.028365, at: "x" } }))!;
  assertEquals([reading.fundedUsd, reading.fundedBasis], [402.028365, "reading"]);
  // Neither: no figure, and never the cap's 320.
  assertEquals([lpLiveSummary(withLp({}))!.fundedUsd, lpLiveSummary(withLp({}))!.fundedBasis], [null, null]);
});

Deno.test("atLiveR: a paper Reward quotes summary priced at the live R, its worst case at the band's low; fills, holdings and capital unmoved", () => {
  const R = { point: 0.5, low: 0.2, high: 1.2, days: 1, basis: "live" as const };
  const s = {
    totalUsd: 10, rewardUsd: 8, fillsPnlUsd: 2, realisedUsd: 9, unrealisedUsd: 1, mismatchUsd: 0, stressUsd: 4, todayUsd: 3, capitalUsd: 50, bestMarketUsd: 7, todayStressUsd: 1,
    days: [{ day: "2026-10-09", totalUsd: 4, rewardUsd: 3, stressUsd: 1, runningUsd: 4 }, { day: "2026-10-08", totalUsd: 3, rewardUsd: 2, stressUsd: 0.5, runningUsd: 0 }],
    markets: [{ cond: "a", rewardUsd: 6, totalUsd: 7 }, { cond: "b", rewardUsd: 2, totalUsd: 3 }],
  };
  // deno-lint-ignore no-explicit-any
  const o = atLiveR(s, R) as any;
  // Rewards 8 → 4; the total and realised lose 4; the worst case trades half of 8 for 0.2 of it: 4 − 4 + 1.6.
  assertEquals([o.rewardUsd, o.totalUsd, o.realisedUsd, o.stressUsd, o.fillsPnlUsd, o.unrealisedUsd, o.capitalUsd, o.mismatchUsd], [4, 6, 5, 1.6, 2, 1, 50, 0]);
  // Today: 8 less the closed days' 5 is 3 of reward, at 0.5: 3 − 1.5; its worst case 1 − 1.5 + 0.6.
  assertEquals([o.todayUsd, o.todayStressUsd], [1.5, 0.1]);
  // Each day; the running total at each close loses its rewards to that day (10-08's 2, then 10-09's 5).
  assertEquals(o.days.map((d: Record<string, number>) => [d.rewardUsd, d.totalUsd, d.stressUsd, d.runningUsd]), [[1.5, 2.5, 0.1, 1.5], [1, 2, -0.1, -1]]);
  assertEquals(o.markets.map((m: Record<string, number>) => [m.rewardUsd, m.totalUsd]), [[3, 4], [1, 2]]);
  assertEquals([o.bestMarketUsd, o.rPricing], [4, { point: 0.5, low: 0.2, high: 1.2, days: 1, basis: "live", stressAt: "low" }]);
  // At R = 1 and a low of 0.5 it is the summary as it was; null stays null.
  // deno-lint-ignore no-explicit-any
  const same = atLiveR(s, { point: 1, low: 0.5, high: 1, days: 0, basis: "prior" }) as any;
  assertEquals([same.totalUsd, same.stressUsd, same.todayUsd, same.days[0].runningUsd], [10, 4, 3, 4]);
  assertEquals(atLiveR(null, R), null);
});

Deno.test("Addendum 19: restarted, the page's stop is the path's own reading from the restart, the stop of before is history, and today's markets are those selected since", () => {
  assertEquals([restartStopOf(null), restartStopOf({ lp: { stop: { since: null, limit: 75, basis: 1 } } }), restartStopOf({ lp: {} })], [null, null, null]);
  const today = new Date(Math.floor(F.input.nowMs / 86400e3) * 86400e3).toISOString().slice(0, 10);
  const since = `${today}T02:31:00.000Z`;
  const stop = { since, limit: 25, fills: -2, paid: 0.5, rebates: null, fees: 0, basis: -1.5, room: 23.5, trippedAt: null };
  assertEquals(restartStopOf({ lp: { stop } }), { since, limit: 25, fills: -2, paid: 0.5, rebates: 0, fees: 0, basis: -1.5, room: 23.5, trippedAt: null });
  const withStop = (s: unknown, markets = F.input.markets) =>
    ({ ...F.input, markets, state: { ...F.input.state, state: { ...F.input.state.state, lp: { ...(F.input.state.state.lp ?? {}), stop: s } } }, stop: { minute: "2026-09-16T05:00:00.000Z", detail: {} } });
  const s = lpLiveSummary(withStop(stop))!;
  // The stop of 16 Sep is before the restart: the room shows, from the restart, at $25.
  assertEquals(s.stop, { limitUsd: 25, fillsPnlUsd: -2, paidUsd: 0.5, rebateUsd: 0, feesUsd: 0, basisUsd: -1.5, roomUsd: 23.5, trippedAt: null, since });
  // Without a restart the page's own figure, the old stop tripped, as before.
  assertEquals(lpLiveSummary(withStop({ ...stop, since: null }))!.stop.trippedAt, "2026-09-16T05:00:00.000Z");
  // Today's rows written before the restart are not today's selection: QUOTES lists only those written since (the
  // fixture's carry no time, so none of them), and one written after it is.
  const todays = F.input.markets.filter((m: { day: string }) => String(m.day).slice(0, 10) === today);
  assert(todays.length > 0);
  assertEquals(s.quotes.filter((q: Record<string, unknown>) => q.quoting).length, 0);
  const marked = F.input.markets.map((m: { day: string; cond: string }) => (m.cond === todays[0].cond && String(m.day).slice(0, 10) === today ? { ...m, selected_at: `${today}T02:32:00.000Z` } : m));
  assertEquals(lpLiveSummary(withStop(stop, marked))!.quotes.filter((q: Record<string, unknown>) => q.quoting).map((q: Record<string, unknown>) => q.cond), [todays[0].cond]);
});

Deno.test("Addendum 13: QUOTING TODAY is the current set, today's markets less those the last turn had out", () => {
  const out = F.input.markets.filter((m: { day: string }) => String(m.day).slice(0, 10) === new Date(Math.floor(F.input.nowMs / 86400e3) * 86400e3).toISOString().slice(0, 10)).map((m: { cond: string }) => m.cond);
  const withOut = (outNow: string[]) => ({ ...F.input, state: { ...F.input.state, state: { ...F.input.state.state, lp: { ...(F.input.state.state.lp ?? {}), outNow } } } });
  const all = lpLiveSummary(F.input)!.status.quoting;
  assertEquals(all, out.length);
  assertEquals(lpLiveSummary(withOut([out[0]]))!.status.quoting, all - 1);
  assertEquals(lpLiveSummary(withOut(out))!.status.quoting, 0);
});


// LP-OBS-DEEP (`reviews/2026-10-11-lp-observations-deep.md`, item 4, `backtests/lpobsdeep/`): one R. The page's headline is
// paid ÷ the whole formula, every live quoted minute, 10-09 like for like; the scored figure beside it; TESTING's paper
// rows, whose formula is whole, priced at `lpLiveR` on the whole formula (defect 2: the scored R priced them high).
Deno.test("LP-OBS-DEEP: the whole formula takes 10-09 like for like and every other day as read", () => {
  const G9 = Object.keys(LP_R_DAY_CORRECTIONS["2026-10-09"].formulaScoredUsd)[0];
  near(wholeFormulaOf({ day: "2026-10-09", cond: G9, formula_usd: 23.294995 }), 0.879838, "10-09: rtrue.py's like-for-like figure, not the readout's 23.29");
  near(wholeFormulaOf({ day: "2026-10-10", cond: G9, formula_usd: 23.294995 }), 23.294995, "a later day: the readout's whole formula");
  near(wholeFormulaOf({ day: "2026-10-09", cond: "0xnot-in-the-table", formula_usd: 4 }), 4, "a market the table does not name stands as read");
});

Deno.test("LP-OBS-DEEP on the live record of 10-11 01:19 UTC: R 0.7366 over the whole formula, 0.7633 over the scored, the paper rows' R its whole point", () => {
  const rows = rewardDays1011 as unknown as LpLiveRewardDayRow[];
  const now = Date.parse("2026-10-11T01:30:00Z");
  const s = lpLiveSummary({ ...F.input, rewardDays: rows, hours: [], nowMs: now })!;
  // By hand (results/r_bases.txt: 10-10 0.7179 whole and 0.7511 scored, 10-09 0.8072 on both): paid 28.4143; whole 8.081876 (10-09 like for like) + 30.493357 (10-10) = 38.575233;
  // scored 8.081876 + 29.144150 = 37.226026.
  assertAlmostEquals(s.formulaWholeUsd, 38.575233, 2e-6, "the whole formula, 10-09 like for like");
  assertAlmostEquals(s.rWhole!, 0.7366, 1e-4, "R (paid ÷ formula)");
  assertAlmostEquals(s.r!, 0.7633, 1e-4, "R on the scored minutes, beside it");
  assertEquals(s.days.filter((d) => d.read).map((d) => [d.day, d.rWhole, d.r]), [["2026-10-10", 0.717886, 0.75112], ["2026-10-09", 0.807182, 0.807182]]);
  // The prior-weighted points (prior 0.2–1 as two days, two days read): scored 0.5901, whole 0.5835.
  assertAlmostEquals(s.estimate.r.point, 0.5901, 1e-4, "the estimate's: the scored formula");
  assertAlmostEquals(s.rWholeLive.point, 0.5835, 1e-4, "the paper rows': the whole formula");
  assertEquals([s.rWholeLive.formula, s.estimate.r.formula], ["whole", "scored"]);
  // Defect 2, by hand: RW-C's 78.99 of programme formula on 10-10 is $46.09 at the whole point, not the $46.61 the scored
  // point gave (+$0.52).
  const row = { rewardUsd: 78.99, totalUsd: 78.99, realisedUsd: 78.99, stressUsd: 39.495, todayUsd: 0, days: [{ day: "2026-10-10", rewardUsd: 78.99, totalUsd: 78.99, stressUsd: 39.495 }] };
  assertAlmostEquals(atLiveR(row, s.rWholeLive).rewardUsd, 46.09, 0.005);
  assertAlmostEquals(atLiveR(row, lpLivePrice(lpLiveR(rows, now))).rewardUsd, 46.61, 0.005);
  // deno-lint-ignore no-explicit-any
  assertEquals((atLiveR(row, s.rWholeLive) as any).rPricing.formula, "whole");
});
