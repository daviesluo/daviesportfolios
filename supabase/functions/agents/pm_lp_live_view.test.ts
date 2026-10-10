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
// for 17 Sep yet). The stop reads 0.80 + 2.20 = 3.00 (rebates not), 78.00 from −75. Three markets at work, five orders open.
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

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/lp_live_fixture.json" with { type: "json" };
import { LP_LIVE_HOURS_VIEW, lpLiveR, lpLiveSince, lpLiveSummary, lpRewardEstimate, type LpLiveHourRow } from "./pm_lp_live_view.ts";
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
  assertEquals([out.status, F.noPayout.status, F.noPayout.r, F.noPayout.realisedUsd, F.noPayout.days], [{ bestMarketUsd: 1.65, quoting: 3, held: 2 }, { bestMarketUsd: 0.6, quoting: 3, held: 2 }, null, 0.6, []]);
  near(out.capUsd, 320, "funded: the config's total cap");
  near(out.restingBuysUsd, 29.4, "8.80 + 10.80 + 3.00 + 6.80"); near(out.costUsd, 5.8, "2.80 + 3.00"); near(out.valueUsd, 35.2, "deployed");
  near(out.unrealisedUsd, 0.2, "0.10 + 0.10"); near(out.realisedFillsUsd, 0.6, "G's 20 YES sold at 0.43, bought at 0.40");
  near(out.paidUsd, 2.2, "0.80 + 0.20 + 1.20"); near(out.rebateUsd, 0.05, "G's rebate"); near(out.realisedUsd, 2.85, "0.60 + 2.20 + 0.05");
  near(out.todayUsd, 0.8, "today's sell and every holding against its cost"); near(out.totalUsd, 3.05, "realised + unrealised");
  near(out.formulaUsd, 5, "the formula, apart"); near(out.r!, 0.44, "R = 2.20 / 5.00"); assertEquals(out.feesUsd, 0);
  assertEquals([out.stop.basisUsd, out.stop.roomUsd, out.stop.limitUsd, out.stop.trippedAt], [3, 78, 75, null]);
  assertEquals([out.openOrders, out.markets, out.fills, out.armed, out.running, out.lagMinutes, out.liveSince], [5, 3, 4, true, true, 1, "2026-09-16T01:32:21.000Z"]);
  // What it holds is QUOTES' held column (its HELD table went, 2026-10-09): H 10 NO, J 10 YES.
  assertEquals(out.quotes.map((x) => [x.q, x.yes, x.no, x.mark]), [["Will G happen?", 0, 0, 0.45], ["Will H happen?", 0, 10, 0.71], ["Will J happen?", 10, 0, 0.31]]);
  // LIVE's Rewards (est.) and Total (est.) (Davies, 2026-10-09, in place of Avg cost): what was paid plus today's formula,
  // not yet read, at each market's point R: G 1.05 + 0.60 × exp(−0.771142) = 1.05 + 0.277491; H 1.20 + 0.30 ×
  // exp(−0.845524) = 1.20 + 0.128800; J nothing paid and no formula. Total (est.) adds the orders: 1.927491, 1.428800, 0.10.
  assertEquals(out.quotes.map((x) => [x.q, x.rewardEstUsd, x.totalEstUsd]), [["Will G happen?", 1.327491, 1.927491], ["Will H happen?", 1.3288, 1.4288], ["Will J happen?", 0, 0.1]]);
  assertEquals(out.quotes.map((x) => "yesCost" in x || "noCost" in x), [false, false, false]);
  assertEquals(out.days.map((d) => [d.day, d.markets, d.formulaUsd, d.paidUsd, d.r, d.rebateUsd]), [["2026-09-16", 2, 5, 2.2, 0.44, 0.05]]);
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
  // The parts add up: realised + unrealised is the total, and the stop's reading is the fills' P&L plus what was paid.
  near(out.realisedUsd + out.unrealisedUsd, out.totalUsd, "realised + unrealised");
  near(out.stop.fillsPnlUsd + out.stop.paidUsd, out.stop.basisUsd, "the stop's basis");
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
  near(settled.stop.basisUsd, 0.6 - 3 + 0.1 + 2.2, "the stop moves with it");
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
    [T.minutes]: [...I.minutes.map((x: Record<string, unknown>) => ({ mode: "live", minute: I.state.state.minute, ...x })), { mode: "dry_run", minute: I.state.state.minute, cond: I.minutes[2].cond, rate: 15, formula_usd: 9 }],
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
  // Never armed and no live order (a dry-run one aside): no row.
  const quiet = memDb({ [T.config]: [{ id: 1, ...I.config, dry_run: true, live_confirmed_at: null }], [T.state]: [], [T.orders]: [{ ...dryOrder, mode: "dry_run" }] }, { now: () => I.nowMs });
  assertEquals(await readLpLive(quiet.db, I.nowMs), null);
  // A read that fails leaves the row off, never the page.
  const broken: typeof mem.db = { ...mem.db, select: (t, q) => (t === T.markets ? Promise.reject(new Error(`db GET ${t} → 500`)) : mem.db.select(t, q)) };
  assertEquals(await readLpLive(broken, I.nowMs), null);
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
  assertEquals(s.days.map((d) => [d.formulaUsd, d.formulaAllUsd, d.r]), [[19.8, 153.9, Math.round((6.53 / 19.8) * 1e6) / 1e6]]);
});

Deno.test("lpLiveR is the one live R: the estimate's R is its, from the readout rows alone, the prior until a day is read", () => {
  const day = { day: "2026-10-09", cond: G, minutes: 1347, minutes_scored: 500, formula_usd: 153.9, formula_scored_usd: 19.8, actual_usd: 6.53, actual_sponsored_usd: 0, rebate_usd: 0 };
  const now = Date.parse("2026-10-10T06:00:00Z");
  const R = lpLiveR([day], now), e = lpRewardEstimate({ rewardDays: [day], hours: [], nowMs: now });
  assertEquals({ point: R.point, low: R.low, high: R.high, days: R.days, basis: R.basis }, e.r);
  assertEquals([R.days, R.basis], [1, "live"]);
  // Today's row is not yet a day of R; with none read it is the prior's.
  assertEquals([lpLiveR([{ ...day, day: "2026-10-10" }], now).basis, lpLiveR([], now).point], ["prior", 0.447214]);
});

