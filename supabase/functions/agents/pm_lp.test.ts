// "Reward quotes live-prep" (pm_lp.ts, 0091): the order path and its paper layer on live-prep's instance, against the
// in-memory database held to 0091's rules (a band of $10 and over, $100 a market, no day stop, three configs of which one
// may be armed) and the fake Polymarket that answers the path, its public reads and the paper layer alike.
//
// What is pinned: the instance's names, tables, band and rules, and that mini-pool and mid-pool carry none of them; each
// rule alone, against the code it extends (`lpQuotes` is `rwQuotes` with nothing held, a sell of what is held at the same
// price in the one book, 5N, no near-certain buy past 8 % of the capital; `pauseAfterJump` is x2's; `lpCandidateOf` keeps what the end horizon alone passed over and
// nothing RW-E's rule or the game's start passes over, and no weather market; `lpLimits` is `effectiveLimits` but its two
// fields; `stepSides` is stepRw's fills; `decideLp` books each fill by its own order and sells no more than is held;
// `classifyLp` takes what the path rests); and simulated days of the path and its layer together: the selection, the
// sells once the paper holds N, 5N, the caps on what the paper holds, the pause, a carried market's exits, the stop on
// the fills and what was paid in its own mode, and, armed, the account's holdings and the live stop. Nothing of
// mini-pool's or mid-pool's tables is touched.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lpMarketType, lpQuotes, nearCertainBuyOk, PM_LP_EXCLUDE_AI, PM_LP_READOUT, PM_LP_REWARD_CHECK, PM_LP_BAND, PM_LP_CANDIDATE, PM_LP_CAP_MARKET_USD, PM_LP_INSTANCE, PM_LP_INV_CAP, PM_LP_NEAR_CERTAIN, PM_LP_PAUSE, PM_LP_TIGHT, PREP_LP_INSTANCE } from "./pm_lp.ts";
import { isTight } from "./pmrw_x.ts";
import {
  candidateOf, ctfApproval, effectiveLimits, gates, heldFromBalance, inUniverse, inYesBook, lpCandidateOf, lpLimits, onTick, PM_LIVE_MAX_POSTS_DAY, PM_LP_MAX_POSTS_DAY, pauseAfterJump, PM_LIVE_INSTANCE, PM_MINI_INSTANCE, pmLiveDbTables, pmLpDbTables,
  lpFunding, lpRewardVerdict, PM_LP_FUNDING, rewardConfigOf, runPmLive, rwQuotes, scoringStreak, type PmRewardNow, type PmBookNow, type PmIntent, type PmLiveConfig, type PmMarketRow, type PmPauseState, type PmRewardRow,
} from "./pm_live.ts";
import { classifyLp, decideLp, PREP_INSTANCE, prepDbTables, prepReads, runPmPrep, stepSides, type PrepOrder } from "./pm_prep.ts";
import { PM_MID_INSTANCE, PREP_MID_INSTANCE } from "./pm_mid.ts";
import { newAcc, quote, sizeN, stepRw, summarize, type BookRow } from "./pmrw.ts";
import { asTickSize, PmOrderKey, type PmTickSize } from "../_shared/polymarket_orders.ts";
import type { PmPrint } from "../_shared/polymarket_public.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tok = (n: number, outcome: "yes" | "no") => `${9000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;
/** A seeded generator (mulberry32), so every random world is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------------ the instance

Deno.test("the instance: live-prep's own tables, leases, band and rules; mini-pool and mid-pool carry none of them", () => {
  const T = Object.values(PM_LP_INSTANCE.tables), P = Object.values(PREP_LP_INSTANCE.tables);
  assert(T.every((t) => t.startsWith("pm_lp_")) && T.length === 9, T.join());
  assert(P.every((t) => t.startsWith("pm_lpprep_")) && P.length === 7, P.join());
  assertEquals([PM_LP_INSTANCE.name, PREP_LP_INSTANCE.name], ["Reward quotes live-prep", "Reward quotes live-prep"]);
  assertEquals([PM_LP_INSTANCE.lock, PREP_LP_INSTANCE.lock, PM_LP_INSTANCE.band, PM_LP_BAND.floor], ["pm-lp", "pm-lpprep", { floor: 10, ceiling: Infinity }, 10]);
  assertEquals([PM_LP_INSTANCE.readsPayouts, typeof PM_LP_INSTANCE.bookBatch, PM_LP_INSTANCE.exclusion, PM_LP_INSTANCE.bookQuality], [true, "function", undefined, undefined]);
  assertEquals([PM_LP_INSTANCE.action, PM_LP_INSTANCE.path, PM_LP_INSTANCE.errorKind], ["pmlp", "agents?action=pmlp&forceFunctionRegion=eu-west-1", "agents.pm_lp"]);
  assertEquals(PM_LP_INSTANCE.migrations, { tables: "0091", selection: "0091" });
  const lp = PM_LP_INSTANCE.lp!;
  assertEquals([lp.rule, lp.candidate, lp.capMarketCeiling, lp.pause], [lpQuotes, { endHorizon: false, excludeFeeTypes: ["weather_fees"], excludeQuestion: PM_LP_EXCLUDE_AI }, 100, { cents: 15, minutes: 60 }]);
  assertEquals(lp.paper, { fills: "pm_lpprep_fills", settlements: "pm_lpprep_settlements", days: "pm_lpprep_days" });
  assertEquals(lp.rewardCheck, { ...PM_LP_REWARD_CHECK });                                 // Addendum 9's check, live-prep's alone
  assertEquals([PM_LP_INV_CAP, PM_LP_CAP_MARKET_USD, PM_LP_PAUSE, PM_LP_CANDIDATE], [5, 100, { cents: 15, minutes: 60 }, lp.candidate]);
  assertEquals([PREP_LP_INSTANCE.lp, prepReads(PREP_LP_INSTANCE)], [true, ["pm_lp_config", "pm_lp_markets", "pm_lp_minutes", "pm_lp_orders"]]);
  // Every table either may touch is live-prep's own: nothing of mini-pool's, mid-pool's, RW's or RW-C's.
  for (const t of [...pmLpDbTables(PM_LP_INSTANCE), ...prepDbTables(PREP_LP_INSTANCE)]) assert(/^pm_(lp|lpprep)_|^agent_(risk|locks)$/.test(t), t);
  // The other instances set none of live-prep's rules, and touch nothing more than they did.
  for (const inst of [PM_LIVE_INSTANCE, PM_MINI_INSTANCE, PM_MID_INSTANCE]) {
    assertEquals(inst.lp, undefined);
    assertEquals(pmLpDbTables(inst), pmLiveDbTables(inst));
  }
  for (const inst of [PREP_INSTANCE, PREP_MID_INSTANCE]) assertEquals(inst.lp, undefined);
  // The name "Reward quotes live-prep" is this instance's alone: mini-pool's and mid-pool's are their own.
  assertEquals([PM_LIVE_INSTANCE.name, PM_MID_INSTANCE.name, PREP_INSTANCE.name, PREP_MID_INSTANCE.name].filter((n) => /live-prep/.test(n)), []);
});

// ------------------------------------------------------------------ the rules, each alone

/** A random two-sided book, its market row and a tick, as the path reads them. */
function randomBook(r: () => number): { market: PmMarketRow; book: PmBookNow } {
  const tick: PmTickSize = r() < 0.7 ? "0.01" : "0.001";
  const t = Number(tick), minSize = [5, 10, 20][Math.floor(r() * 3)], v = [2, 3, 4.5][Math.floor(r() * 3)];
  const mid = 0.1 + r() * 0.8, spread = t * (1 + Math.floor(r() * 4));
  const bb = onTick(Math.max(t, mid - spread / 2), tick), ba = onTick(Math.min(1 - t, bb + spread), tick);
  const bids: Array<[number, number]> = [], asks: Array<[number, number]> = [];
  for (let k = 0; k < 4; k++) {
    if (bb - k * t >= t) bids.push([onTick(bb - k * t, tick), Math.round(1 + r() * 60)]);
    if (ba + k * t <= 1 - t) asks.push([onTick(ba + k * t, tick), Math.round(1 + r() * 60)]);
  }
  const market = { day: "2026-10-05", kind: "standard", cond: cond(1), yes_token: "1", no_token: "2", neg_risk: false, tick: t, min_size: minSize, reward_rate: 20, rank: 1, question: "q", max_spread: v } as PmMarketRow;
  const book = { bestBid: bids[0]?.[0] ?? 0, bestAsk: asks[0]?.[0] ?? 1, tick, minSize: 5, negRisk: false, at: null, hash: null, levels: { bids, asks } } as PmBookNow;
  return { market, book };
}

/** Whether a book's raw touch, as RW's `summarize` reads it, is at most TB1's one tick (Addendum 2). */
const tightBook = (market: PmMarketRow, book: PmBookNow) =>
  isTight(summarize(book.levels.bids, book.levels.asks, Number(market.max_spread), Number(market.min_size)), Number(book.tick), PM_LP_TIGHT.maxTicks);

Deno.test("lpQuotes: with nothing held it is rwQuotes; held, a side sells first at the same price in the one book; a side stops at 5N, not RW's 3N", () => {
  const r = rng(20261004);
  let quoted = 0, sells = 0, tight = 0;
  for (let i = 0; i < 400; i++) {
    const { market, book } = randomBook(r);
    const N = sizeN(Number(market.min_size));
    const rw = rwQuotes({ market, book, held: { yes: 0, no: 0 } });
    // TB1's skip (Addendum 2): a one-tick touch rests nothing, whatever is held; its own test is below.
    if (tightBook(market, book)) {
      tight++;
      for (const held of [{ yes: 0, no: 0 }, { yes: N, no: 0 }, { yes: 0, no: N }, { yes: 5 * N, no: 0 }]) assertEquals(lpQuotes({ market, book, held }), [], `world ${i}`);
      continue;
    }
    assertEquals(lpQuotes({ market, book, held: { yes: 0, no: 0 } }), rw, `world ${i}`);
    if (rw.length !== 2) continue;
    quoted++;
    const bidAt = inYesBook(rw[0]), askAt = inYesBook(rw[1]);
    // NO held ≥ N: the bid is a SELL of NO, at the same bid in the one book; the ask is still RW's BUY of NO.
    const a = lpQuotes({ market, book, held: { yes: 0, no: N } });
    assertEquals(a.map((x) => [x.outcome, x.side, x.size]), [["no", "SELL", N], ["no", "BUY", N]]);
    assertAlmostEquals(inYesBook(a[0]).price, bidAt.price, 1e-9);
    assertEquals([inYesBook(a[0]).side, a[1]], ["bid", rw[1]]);
    // YES held ≥ N: the ask is a SELL of YES, at the same ask in the one book.
    const b = lpQuotes({ market, book, held: { yes: N, no: 0 } });
    assertEquals(b.map((x) => [x.outcome, x.side, x.size]), [["yes", "BUY", N], ["yes", "SELL", N]]);
    assertAlmostEquals(inYesBook(b[1]).price, askAt.price, 1e-9);
    assertEquals([b[0], inYesBook(b[1]).side], [rw[0], "ask"]);
    // Under N of either, a buy, as RW's.
    assertEquals(lpQuotes({ market, book, held: { yes: N - 1, no: 0 } }), rw);
    // 5N: at 5N of YES (net 5N) the bid rests nothing, the ask sells; at 3N (RW's cap) both still rest. NO alike.
    assertEquals(lpQuotes({ market, book, held: { yes: 5 * N, no: 0 } }).map((x) => `${x.outcome} ${x.side}`), ["yes SELL"]);
    assertEquals(lpQuotes({ market, book, held: { yes: 5 * N - 1, no: 0 } }).map((x) => `${x.outcome} ${x.side}`), ["yes BUY", "yes SELL"]);
    assertEquals(lpQuotes({ market, book, held: { yes: 3 * N, no: 0 } }).length, 2);
    assertEquals(rwQuotes({ market, book, held: { yes: 3 * N, no: 0 } }).length, 1);
    assertEquals(lpQuotes({ market, book, held: { yes: 0, no: 5 * N } }).map((x) => `${x.outcome} ${x.side}`), ["no SELL"]);
    sells += 2;
  }
  assert(quoted > 150 && sells > 300 && tight > 50, `${quoted} worlds quoted, ${tight} tight`);
});

Deno.test("TB1's skip (Addendum 2): where the raw touch is one tick, live-prep rests nothing, buys and sells alike; two ticks, RW's quote", () => {
  assertEquals(PM_LP_TIGHT, { maxTicks: 1 });
  for (const tick of ["0.01", "0.001"] as const) {
    const t = Number(tick);
    const mk = (spreadTicks: number) => {
      const bb = onTick(0.5 - t * Math.floor(spreadTicks / 2), tick), ba = onTick(bb + spreadTicks * t, tick);
      const bids: Array<[number, number]> = [[bb, 50], [onTick(bb - t, tick), 50], [onTick(bb - 2 * t, tick), 50]];
      const asks: Array<[number, number]> = [[ba, 50], [onTick(ba + t, tick), 50], [onTick(ba + 2 * t, tick), 50]];
      const market = { day: "2026-10-09", kind: "standard", cond: cond(1), yes_token: "1", no_token: "2", neg_risk: false, tick: t, min_size: 20, reward_rate: 50, rank: 1, question: "q", max_spread: 4.5 } as PmMarketRow;
      const book = { bestBid: bb, bestAsk: ba, tick, minSize: 5, negRisk: false, at: null, hash: null, levels: { bids, asks } } as PmBookNow;
      return { market, book };
    };
    const one = mk(1), two = mk(2);
    // Without the rule a one-tick book is quoted on both sides (RW's join), so this fails on the old code.
    assertEquals(rwQuotes({ ...one, held: { yes: 0, no: 0 } }).length, 2, tick);
    assert(tightBook(one.market, one.book) && !tightBook(two.market, two.book), tick);
    for (const held of [{ yes: 0, no: 0 }, { yes: 20, no: 0 }, { yes: 0, no: 20 }, { yes: 100, no: 0 }]) assertEquals(lpQuotes({ ...one, held }), [], `${tick} ${JSON.stringify(held)}`);
    assertEquals(lpQuotes({ ...two, held: { yes: 0, no: 0 } }), rwQuotes({ ...two, held: { yes: 0, no: 0 } }), tick);
    assertEquals(lpQuotes({ ...two, held: { yes: 0, no: 0 } }).length, 2, tick);
    // Our own resting orders are not the touch: a three-tick book whose touch is one tick only by our own two orders is
    // quoted, and the same levels with no order of ours are skipped.
    const three = mk(3), tb = three.book.levels.bids[0][0];
    const ownBb = onTick(tb + t, tick), ownBa = onTick(tb + 2 * t, tick);
    const withOwn = { ...three.book, levels: { bids: [[ownBb, 20], ...three.book.levels.bids] as Array<[number, number]>, asks: [[ownBa, 20], ...three.book.levels.asks] as Array<[number, number]> } };
    const own: PmIntent[] = [{ outcome: "yes", side: "BUY", price: ownBb, size: 20 }, { outcome: "no", side: "BUY", price: onTick(1 - ownBa, tick), size: 20 }];
    assertEquals(lpQuotes({ market: three.market, book: withOwn, held: { yes: 0, no: 0 }, own }).length, 2, `${tick} own`);
    assertEquals(lpQuotes({ market: three.market, book: withOwn, held: { yes: 0, no: 0 } }), [], `${tick} not own`);
  }
  // Mini-pool and mid-pool carry no such rule: their rule is rwQuotes, which quotes a one-tick book.
  for (const inst of [PM_LIVE_INSTANCE, PM_MINI_INSTANCE, PM_MID_INSTANCE]) assertEquals(inst.lp, undefined);
});

/** A near-certain market: YES at 0.96 / 0.98 (N = 20), or its mirror with NO the near-certain token (YES at 0.02 / 0.04). */
function nearCertain(expensive: "yes" | "no"): { market: PmMarketRow; book: PmBookNow } {
  const bids: Array<[number, number]> = expensive === "yes" ? [[0.96, 50], [0.95, 50], [0.94, 50]] : [[0.02, 50], [0.01, 50]];
  const asks: Array<[number, number]> = expensive === "yes" ? [[0.98, 50], [0.99, 50]] : [[0.04, 50], [0.05, 50], [0.06, 50]];
  const market = { day: "2026-10-09", kind: "standard", cond: cond(1), yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: 20, reward_rate: 200, rank: 1, question: "q", max_spread: 4.5 } as PmMarketRow;
  const book = { bestBid: bids[0][0], bestAsk: asks[0][0], tick: "0.01", minSize: 20, negRisk: false, at: null, hash: null, levels: { bids, asks } } as PmBookNow;
  return { market, book };
}
const legs = (xs: PmIntent[]) => xs.map((x) => `${x.outcome} ${x.side} ${x.price}`);

Deno.test("the near-certain limit (Addendum 7): a buy of a token at 0.95 or more rests only within 8 % of the path's capital, at the mark", () => {
  assertEquals(PM_LP_NEAR_CERTAIN, { minPrice: 0.95, share: 0.08 });
  // Under 0.95 a buy is never limited, whatever is held and whatever the capital, even none.
  assertEquals([nearCertainBuyOk(0.949, 20, 1000, 0.95, 320), nearCertainBuyOk(0.5, 20, 0, 0.5, undefined)], [true, true]);
  // At 0.95 it is: 20 × 0.95 = $19 fits 8 % of $320 ($25.60) with nothing held, and not 8 % of $200 ($16).
  assertEquals([nearCertainBuyOk(0.95, 20, 0, 0.95, 320), nearCertainBuyOk(0.95, 20, 0, 0.95, 200)], [true, false]);
  // No readable capital, no near-certain buy.
  for (const c of [undefined, 0, -1, NaN]) assertEquals(nearCertainBuyOk(0.96, 20, 0, 0.97, c), false, String(c));
  // The holding counts at the mark: 6 at 0.97 ($5.82) and 20 at 0.96 ($19.20) fit $25.60; 7 ($6.79) do not.
  assertEquals([nearCertainBuyOk(0.96, 20, 6, 0.97, 320), nearCertainBuyOk(0.96, 20, 7, 0.97, 320)], [true, false]);

  for (const expensive of ["yes", "no"] as const) {
    const cheap = expensive === "yes" ? "no" : "yes";
    const { market, book } = nearCertain(expensive);
    const N = sizeN(Number(market.min_size));
    const h = (exp: number, chp = 0) => (expensive === "yes" ? { yes: exp, no: chp } : { yes: chp, no: exp });
    const rw = rwQuotes({ market, book, held: h(0) });
    assertEquals([N, legs(rw)], [20, expensive === "yes" ? ["yes BUY 0.96", "no BUY 0.02"] : ["yes BUY 0.02", "no BUY 0.96"]]);
    // Nothing held, $320: both sides rest, as before.
    assertEquals(lpQuotes({ market, book, held: h(0), capital: 320 }), rw, expensive);
    // 7 held at the mark plus the order pass $25.60: the near-certain buy is not sent, the cheap side still rests. The old
    // rule (rwQuotes is what lpQuotes was with less than N held) sent both.
    assertEquals(legs(rwQuotes({ market, book, held: h(7) })).length, 2);
    assertEquals(legs(lpQuotes({ market, book, held: h(7), capital: 320 })), [`${cheap} BUY 0.02`], expensive);
    assertEquals(legs(lpQuotes({ market, book, held: h(6), capital: 320 })).length, 2, expensive);
    // N held: the cheap side's leg is a SELL of the near-certain token, which the limit never touches; the near-certain buy is not sent.
    const atN = lpQuotes({ market, book, held: h(N), capital: 320 });
    assertEquals(atN.map((x) => `${x.outcome} ${x.side}`), [`${expensive} SELL`], expensive);
    // A sell rests even with no readable capital, and the cheap buy too; held N of the cheap token, its sell rests beside them.
    assertEquals(lpQuotes({ market, book, held: h(N), capital: undefined }).map((x) => `${x.outcome} ${x.side}`), [`${expensive} SELL`]);
    assertEquals(legs(lpQuotes({ market, book, held: h(0, N - 1), capital: undefined })), [`${cheap} BUY 0.02`]);
    assertEquals(lpQuotes({ market, book, held: h(0, N), capital: undefined }).map((x) => `${x.outcome} ${x.side}`).sort(), [`${cheap} BUY`, `${cheap} SELL`].sort());
    // The limit is a share, so it scales with the capital: at $640 (8 % = $51.20) 32 held still rest a buy, 33 do not.
    assertEquals(legs(lpQuotes({ market, book, held: h(7), capital: 640 })).length, 2, expensive);
    assertEquals(lpQuotes({ market, book, held: h(32), capital: 640 }).some((x) => x.outcome === expensive && x.side === "BUY"), true, expensive);
    assertEquals(lpQuotes({ market, book, held: h(33), capital: 640 }).some((x) => x.outcome === expensive && x.side === "BUY"), false, expensive);
    // At $200 (8 % = $16) not even the first 20 at 0.96 fit: only the cheap side rests.
    assertEquals(legs(lpQuotes({ market, book, held: h(0), capital: 200 })), [`${cheap} BUY 0.02`], expensive);
  }
  // The paper layer takes what the path rests: the cheap side alone at RW's price is a matched minute, filled on that side.
  assertEquals(classifyLp([order(1, "no", "BUY", 0.02, 20)], { b: 0.96, a: 0.98, n: 20 }).cls, "matched");
  // A market under 0.95 on both sides is lpQuotes as before at any capital (the random worlds of the test above, at $0).
  const r = rng(20261009);
  for (let i = 0; i < 200; i++) {
    const { market, book } = randomBook(r);
    if (tightBook(market, book)) continue;
    const q = lpQuotes({ market, book, held: { yes: 0, no: 0 } });
    if (q.some((x) => x.side === "BUY" && x.price >= PM_LP_NEAR_CERTAIN.minPrice)) continue;
    assertEquals(lpQuotes({ market, book, held: { yes: 0, no: 0 }, capital: 0 }), q, `world ${i}`);
  }
});

Deno.test("pauseAfterJump is x2's rule: 15 ¢ or more between two minutes pauses that minute and the 59 after; a jump inside restarts it; no mid records nothing", () => {
  const s: PmPauseState = { lastMid: {}, pausedUntil: {} };
  const t0 = Date.parse("2026-10-05T10:00:00Z"), p = PM_LP_PAUSE;
  assertEquals(pauseAfterJump(s, "c", t0, 0.46, p), false);                          // the first mid: nothing to compare
  assertEquals(pauseAfterJump(s, "c", t0 + M, 0.6099, p), false);                    // 14.99 ¢
  assertEquals(pauseAfterJump(s, "c", t0 + 2 * M, 0.4599, p), true);                 // 15 ¢ exactly: paused
  assertEquals(s.pausedUntil.c, t0 + 2 * M + 60 * M);
  assertEquals(pauseAfterJump(s, "c", t0 + 3 * M, null, p), true);                  // no mid: still paused, nothing recorded
  assertEquals(s.lastMid.c, 0.4599);
  assertEquals(pauseAfterJump(s, "c", t0 + 61 * M, 0.46, p), true);                  // the 59th minute after
  assertEquals(pauseAfterJump(s, "c", t0 + 62 * M, 0.46, p), false);                 // the 60th: quoted again
  assertEquals(pauseAfterJump(s, "c", t0 + 70 * M, 0.30, p), true);                  // a further jump
  assertEquals(pauseAfterJump(s, "c", t0 + 100 * M, 0.46, p), true);                 // …a jump inside the pause restarts it
  assertEquals(s.pausedUntil.c, t0 + 160 * M);
  assertEquals(pauseAfterJump(s, "d", t0, 0.9, p), false);                           // markets apart
});

Deno.test("lpCandidateOf: no weather market; an end date within two days passes, unless it falls that UTC day (RW-E); a game within two days does not; no ceiling", () => {
  const now = Date.parse("2026-10-05T00:05:00Z");
  const listing = new Map<string, PmRewardRow>();
  const gm = (n: number, extra: Record<string, unknown> = {}) => {
    listing.set(cond(n), { rate: 12, v: 4.5, minSize: 5 });
    return { conditionId: cond(n), clobTokenIds: JSON.stringify([tok(n, "yes"), tok(n, "no")]), enableOrderBook: true, acceptingOrders: true, closed: false, question: "q", ...extra };
  };
  const band = PM_LP_INSTANCE.band, rules = PM_LP_CANDIDATE;
  const plain = gm(1), ends30h = gm(2, { endDate: "2026-10-06T06:00:00Z" }), endsToday = gm(3, { endDate: "2026-10-05T23:00:00Z" });
  const game = gm(4, { gameStartTime: "2026-10-06 18:00:00+00" }), weather = gm(5, { feeType: "weather_fees" }), sports = gm(6, { feeType: "sports_fees" });
  assertEquals(lpCandidateOf(plain, listing, now, band, rules), candidateOf(plain, listing, now, band));
  // The end within 48 hours: the default passes it over, live-prep keeps it, with its end date.
  assertEquals(candidateOf(ends30h, listing, now, band), null);
  assertEquals(lpCandidateOf(ends30h, listing, now, band, rules)?.endDate, "2026-10-06T06:00:00Z");
  // RW-E's same-day rule and the game's start still pass a market over; a weather market is passed over, another fee type not.
  assertEquals([endsToday, game, weather].map((m) => lpCandidateOf(m, listing, now, band, rules)), [null, null, null]);
  assert(lpCandidateOf(sports, listing, now, band, rules) !== null);
  // With the horizon on it is candidateOf, weather aside.
  assertEquals(lpCandidateOf(ends30h, listing, now, band, { endHorizon: true, excludeFeeTypes: [] }), null);
  // No ceiling: a $500 pool is in live-prep's universe and in neither mini-pool's nor mid-pool's.
  const big = { rate: 500, v: 4.5, minSize: 5 };
  assertEquals([inUniverse(big, PM_LP_INSTANCE.band), inUniverse(big, PM_MINI_INSTANCE.band), inUniverse(big, PM_MID_INSTANCE.band)], [true, false, false]);
  assertEquals(inUniverse({ rate: 9.99, v: 4.5, minSize: 5 }, PM_LP_INSTANCE.band), false);
  assertEquals(inUniverse({ rate: 12, v: 4.5, minSize: 21 }, PM_LP_INSTANCE.band), false);           // N over 20
});

Deno.test("lpLimits is effectiveLimits but its per-market ceiling ($100) and no day stop", () => {
  const c = (p: Partial<PmLiveConfig>): PmLiveConfig => ({
    dry_run: true, live_confirmed_at: null, ireland_attested_at: null, ireland_until: null, cap_total_usd: 320, cap_market_usd: 100, loss_day_usd: null as unknown as number,
    loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 10, select_budget_usd: 200, ...p,
  });
  for (const [cm, want] of [[100, 100], [150, 100], [60, 60], ["x", 100]] as const) {
    const l = lpLimits(c({ cap_market_usd: cm }), PM_LP_INSTANCE.lp!), e = effectiveLimits(c({ cap_market_usd: cm }));
    assertEquals(l.capMarket, want);
    assertEquals(l.lossDay, Infinity);
    assertEquals({ ...l, capMarket: 0, lossDay: 0 }, { ...e, capMarket: 0, lossDay: 0 });
  }
  // What effectiveLimits makes of the null day limit: 0, a stop at the first minute; live-prep never reads it.
  assertEquals(effectiveLimits(c({})).lossDay, 0);
  assertEquals(lpLimits(c({ cap_total_usd: 400, loss_total_usd: 90, max_markets: 20 }), PM_LP_INSTANCE.lp!).capTotal, 320);
});

/** A random minute: RW's row of a book, its prints, and an account inside stepRw's cap. */
function randomMinute(r: () => number) {
  const tick = r() < 0.7 ? 0.01 : 0.001, v = [3, 4.5][Math.floor(r() * 2)], minSize = [5, 20][Math.floor(r() * 2)], N = sizeN(minSize);
  const mid = 0.1 + r() * 0.8;
  const bids: Array<[number, number]> = [[Number((Math.round((mid - tick) / tick) * tick).toFixed(4)), 50], [Number((Math.round((mid - 3 * tick) / tick) * tick).toFixed(4)), 80]];
  const asks: Array<[number, number]> = [[Number((Math.round((mid + tick) / tick) * tick).toFixed(4)), 50], [Number((Math.round((mid + 3 * tick) / tick) * tick).toFixed(4)), 80]];
  const row = summarize(bids, asks, v, minSize);
  const tSec = 1_790_000_000 - (1_790_000_000 % 60);
  const prints: PmPrint[] = Array.from({ length: 8 }, (_, k) => {
    const oi = r() < 0.5 ? 0 : 1, side: "BUY" | "SELL" = r() < 0.5 ? "BUY" : "SELL";
    const yes = mid + (r() - 0.5) * 6 * tick;
    return { id: `p${k}`, ts: tSec + 1 + Math.floor(r() * 59), side, oi, price: Number((oi === 0 ? yes : 1 - yes).toFixed(4)), size: Math.round(1 + r() * 15) } as PmPrint;
  }).sort((a, b) => a.ts - b.ts);
  return { tick, v, N, row, tSec, prints, net: Math.round((r() * 4 - 2) * N) };
}

Deno.test("stepSides is stepRw's fills, side by side: both sides at RW's quote, N each, inside its cap; one side alone fills only that side", () => {
  const r = rng(77);
  let fills = 0;
  for (let i = 0; i < 300; i++) {
    const x = randomMinute(r);
    if (!x.row) continue;
    const q = quote(x.row, x.tick);
    if (!q) continue;
    const a = { ...newAcc(), net: x.net }, b = { ...newAcc(), net: x.net };
    const rw = stepRw(a, x.tSec, x.row, x.tick, x.v, 10, x.N, x.prints);
    const legs = { bid: rw.decision!.qb ? { price: q.b, size: x.N } : null, ask: rw.decision!.qa ? { price: q.a, size: x.N } : null };
    const ours = stepSides(b, x.tSec, x.row, x.tick, legs, x.prints);
    assertEquals(ours, rw.fills, `world ${i}`);
    assertEquals([b.net, b.cash, b.fills, b.fillShares, b.tickCost, b.maxInvCost], [a.net, a.cash, a.fills, a.fillShares, a.tickCost, a.maxInvCost]);
    fills += ours.length;
    // The bid alone: exactly the bid's fills of the two-sided minute.
    const c = { ...newAcc(), net: x.net };
    assertEquals(stepSides(c, x.tSec, x.row, x.tick, { bid: legs.bid, ask: null }, x.prints), rw.fills.filter((f) => f.side === "bid"));
  }
  assert(fills > 100, `${fills} fills`);
});

/** A dry-run order as the layer reads it. */
const order = (id: number, outcome: "yes" | "no", side: "BUY" | "SELL", price: number, size: number): PrepOrder =>
  ({ id, ts: "2026-10-05T10:00:01Z", cond: cond(1), token: tok(1, outcome), outcome, side, price, size, state: "live", cancelled_at: null, request: null, book_seen: null });

Deno.test("decideLp books each fill by its own order, a sell no further than the paper holds; classifyLp takes what the path rests, one side or two", () => {
  const row: BookRow = [0.45, 0.47, 0.45, 0.47, 100, 100];
  const tSec = Date.parse("2026-10-05T10:00:00Z") / 1000;
  const prints = [
    { id: "s1", ts: tSec + 10, side: "SELL", oi: 0, price: 0.44, size: 4 }, { id: "s2", ts: tSec + 20, side: "SELL", oi: 0, price: 0.44, size: 6 },
    { id: "b1", ts: tSec + 30, side: "BUY", oi: 1, price: 0.52, size: 9 },        // a BUY of NO at 0.52 is a SELL of YES at 0.48: not through our ask
    { id: "b2", ts: tSec + 40, side: "BUY", oi: 0, price: 0.48, size: 2 },
  ] as PmPrint[];
  const tokens = { yes: tok(1, "yes"), no: tok(1, "no") };
  // The bid a SELL of NO at 0.55 (0.45 in the one book), with 3 NO held: 3 sold, at 0.55, though 10 traded through it.
  const bid = order(1, "no", "SELL", 0.55, 5), ask = order(2, "no", "BUY", 0.53, 5);
  const acc = newAcc();
  const out = decideLp({ acc, t: tSec * 1000, row, tick: 0.01, bid, ask, tokens, held: { yes: 0, no: 3 }, prints, reward: 0.01, closeOnly: false });
  assertEquals(out.fills.map((f) => [f.side, f.size, f.token === tokens.no, f.tokenSide, f.tokenPrice]), [["bid", 3, true, "SELL", 0.55], ["ask", 2, true, "BUY", 0.53]]);
  assertEquals([out.reward, acc.reward, out.qb, out.qa, out.b, out.a], [0.01, 0.01, true, true, 0.45, 0.47]);
  // Nothing held: the sell rests and fills nothing.
  assertEquals(decideLp({ acc: newAcc(), t: tSec * 1000, row, tick: 0.01, bid, ask: null, tokens, held: { yes: 0, no: 0 }, prints, reward: 0, closeOnly: true }).fills, []);
  // The ask a SELL of YES at 0.47 with 10 held: 2 sold (the one print through it).
  const sellYes = decideLp({ acc: newAcc(), t: tSec * 1000, row, tick: 0.01, bid: null, ask: order(3, "yes", "SELL", 0.47, 5), tokens, held: { yes: 10, no: 0 }, prints, reward: 0, closeOnly: true });
  assertEquals(sellYes.fills.map((f) => [f.side, f.size, f.token === tokens.yes, f.tokenSide, f.tokenPrice, f.closeOnly]), [["ask", 2, true, "SELL", 0.47, true]]);

  const rule = { b: 0.45, a: 0.47, n: 5 };
  assertEquals(classifyLp([], rule).cls, "dark");
  assertEquals(classifyLp([order(1, "yes", "BUY", 0.45, 5), order(2, "no", "BUY", 0.53, 5)], rule).cls, "matched");
  assertEquals(classifyLp([order(1, "no", "SELL", 0.55, 5), order(2, "yes", "SELL", 0.47, 5)], rule).cls, "matched");
  const one = classifyLp([order(2, "yes", "SELL", 0.47, 3)], rule);                          // one side, a sell of less than N
  assertEquals([one.cls, one.bid, one.ask?.id], ["matched", null, 2]);
  assertEquals(classifyLp([order(1, "yes", "BUY", 0.44, 5)], rule).cls, "diverged");         // off RW's price
  assertEquals(classifyLp([order(1, "yes", "BUY", 0.45, 4)], rule).cls, "diverged");         // a buy that is not N
  assertEquals(classifyLp([order(1, "yes", "SELL", 0.47, 6)], rule).cls, "diverged");        // a sell of more than N
  assertEquals(classifyLp([order(1, "yes", "BUY", 0.45, 5), order(3, "no", "SELL", 0.55, 5)], rule).cls, "diverged");   // two bids
  assertEquals(classifyLp([order(1, "yes", "BUY", 0.45, 5)], null).cls, "diverged");
});

// ------------------------------------------------------------------ simulated days of the path and its layer

const T0 = Date.parse("2026-10-05T10:00:30Z");
const LP_CONFIG = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 100, loss_day_usd: null, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 10, select_budget_usd: 200,
  created_at: "2026-10-04T18:00:00.000Z", updated_at: "2026-10-04T18:00:00.000Z",
};
const OTHER_CONFIG = (({ created_at: _c, ...rest }) => ({ ...rest, cap_market_usd: 60, loss_day_usd: 25, max_markets: 8, select_budget_usd: 160 }))(LP_CONFIG);
const LP_TABLES = Object.values(PM_LP_INSTANCE.tables), LPPREP_TABLES = Object.values(PREP_LP_INSTANCE.tables);
type P = [number, "BUY" | "SELL", number, number, number];

/**
 * The world: L1 ($12 a day, 0.45 / 0.47, N 5), BIG ($500 a day: no ceiling), E30 (ends in 30 hours: the default's horizon
 * would pass it over), and four that live-prep never takes: WX (weather), TODAY (ends this UTC day), GAME (starts within
 * two days) and LOW ($8). Mini-pool's and mid-pool's tables sit beside its own, each with a row, as in production.
 */
function world(o: { config?: Record<string, unknown>; days?: Array<Record<string, unknown>>; onCost?: boolean; nearCertain?: boolean } = {}) {
  const clock = { now: T0 };
  // `onCost`: the day stop as the pre-registrations froze it (`dayStopOnCost`), which no action runs (2026-10-07).
  const inst = o.onCost ? { ...PM_LP_INSTANCE, dayStopOnCost: true } : PM_LP_INSTANCE, prepInst = o.onCost ? { ...PREP_LP_INSTANCE, dayStopOnCost: true } : PREP_LP_INSTANCE;
  const pm = new FakePolymarket(() => clock.now);
  const add = (n: number, rate: number, extra: Record<string, unknown> = {}) =>
    pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), rate, sponsoredRate: null, minSize: 5, depth: [[0, 50]], ...extra });
  // Thin books (5 shares at each touch): RW's quote joins the touch and takes about half of each pool, so every one of
  // the three clears the $2.50 formula floor.
  const L1 = add(1, 12, { depth: [[0, 5]] }), BIG = add(2, 500, { bid: 0.30, ask: 0.32 }), E30 = add(3, 20, { bid: 0.60, ask: 0.62, endDate: iso(T0 + 30 * H), depth: [[0, 5]] });
  const WX = add(4, 15, { feeType: "weather_fees" }), TODAY = add(5, 20, { endDate: "2026-10-05T23:00:00Z" });
  const GAME = add(6, 20, { gameStartTime: "2026-10-06 20:00:00+00" }), LOW = add(7, 8);
  // `nearCertain`: NC, YES at 0.96 / 0.98 (N 5), whose bid is a BUY of a token at 0.95 or more (Addendum 7's limit).
  const NC = o.nearCertain ? add(8, 50, { bid: 0.96, ask: 0.98, depth: [[0, 5]] }) : null;
  const mem = memDb({
    agent_locks: [{ name: "pm-lp", lease_until: iso(0), holder: null }, { name: "pm-lpprep", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_lp_config: [{ ...LP_CONFIG, ...o.config }],
    ...Object.fromEntries([...LP_TABLES.filter((t) => t !== "pm_lp_config"), ...LPPREP_TABLES].map((t) => [t, []])),
    ...(o.days ? { pm_lpprep_days: o.days } : {}),
    pm_live_config: [{ ...OTHER_CONFIG }], pm_live_markets: [{ day: "2026-10-05", cond: cond(1) }], pm_prep_fills: [{ cond: cond(1) }],
    pm_mid_config: [{ ...OTHER_CONFIG }], pm_mid_markets: [{ day: "2026-10-05", cond: cond(2) }], pm_midprep_fills: [{ cond: cond(2) }],
  }, { now: () => clock.now });
  const others = JSON.stringify(Object.entries(mem.tables).filter(([t]) => /^pm_(live|prep|mid|midprep)_/.test(t)));
  const db = onlyTables(mem.db, pmLpDbTables(PM_LP_INSTANCE), { lease: "pm-lp", readOnly: ["agent_risk", ...Object.values(PM_LP_INSTANCE.lp!.paper)] });
  const prepDb = onlyTables(mem.db, prepDbTables(PREP_LP_INSTANCE), { lease: "pm-lpprep", readOnly: prepReads(PREP_LP_INSTANCE) });
  const key = new PmOrderKey(PM_TEST_KEY);
  let salt = 1;
  const errors: string[] = [];
  const w = {
    clock, pm, mem, L1, BIG, E30, WX, TODAY, GAME, LOW, NC, errors,
    async turn(t: number) {
      clock.now = t;
      const r = await runPmLive({
        db, now: t, holder: `h${t}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true, account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
        signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now, inst, pm: { fetchImpl: pm.publicFetch },
      });
      errors.push(...r.errors.filter((e) => !/pUSD|LOSS STOP/.test(e)).map((e) => `${iso(t)} path: ${e}`));
      clock.now = t + 5e3;
      const p = await runPmPrep({ db: prepDb, now: t + 5e3, holder: `p${t}`, pm: { fetchImpl: pm.publicFetch, clock: () => clock.now }, inst: prepInst });
      errors.push(...p.errors.map((e) => `${iso(t)} layer: ${e}`));
      return r;
    },
    async run(from: number, minutes: number, before?: (t: number, k: number) => void) {
      for (let k = 0; k < minutes; k++) { const t = from + k * M; before?.(t, k); await w.turn(t); }
    },
    rows: (t: string) => w.mem.tables[t] as Row[],
    /** The orders resting in a market after the path's turn of minute `t` (ms, the minute's start). */
    restingAfter(c: string, t: number) {
      return w.rows("pm_lp_orders").filter((x) => x.cond === c && Date.parse(String(x.ts)) < t + M
        && (x.state === "live" || x.state === "pending" || (x.cancelled_at != null && Date.parse(String(x.cancelled_at)) >= t + M)));
    },
    othersUntouched: () => JSON.stringify(Object.entries(mem.tables).filter(([t]) => /^pm_(live|prep|mid|midprep)_/.test(t))) === others,
    setConfig(p: Record<string, unknown>) { Object.assign(w.rows("pm_lp_config")[0], p); },
  };
  return w;
}
const s0 = Math.floor(T0 / 1000) - 30;                                          // 10:00:00 UTC on 2026-10-05, in seconds
const at = (min: number, sec: number) => s0 + min * 60 + sec;

Deno.test("a dry-run day: the selection; the path sells what its paper holds, first, at RW's price; 5N; a pause after a jump; the paper books every sell", async () => {
  const w = world();
  // L1: a SELL of YES at 0.44 through our bid in each of the first seven minutes (5 a minute), then from 10:20 a BUY of
  // YES at 0.48 through our ask each minute. BIG: its book jumps 20 ¢ at 10:10.
  w.pm.prints.set(w.L1.cond, [
    ...Array.from({ length: 7 }, (_, k): P => [at(k, 10), "SELL", 0, 0.44, 5]),
    ...Array.from({ length: 8 }, (_, k): P => [at(20 + k, 20), "BUY", 0, 0.48, 5]),
  ]);
  await w.run(T0, 35, (_, k) => { if (k === 10) { w.BIG.bid = 0.50; w.BIG.ask = 0.52; } });
  assertEquals(w.errors, []);
  // The day's markets: L1, BIG (no ceiling) and E30 (no end horizon); never the weather market, one ending today, a game
  // within two days, or a pool under $10.
  assertEquals(w.rows("pm_lp_markets").map((m) => m.cond).sort(), [w.L1.cond, w.BIG.cond, w.E30.cond].sort());
  // At 10:00 L1 rests RW's quote: a BUY of YES at 0.45 and a BUY of NO at 0.53, N = 5 each.
  const first = w.restingAfter(w.L1.cond, T0 - 30e3).map((x) => `${x.outcome} ${x.side} ${x.price} × ${x.size}`).sort();
  assertEquals(first, ["no BUY 0.53 × 5", "yes BUY 0.45 × 5"]);
  // The paper fills the bid; from the turn whose holdings show 5 YES, the ask is a SELL of YES at 0.47, as a reduce.
  const sells = w.rows("pm_lp_orders").filter((x) => x.cond === w.L1.cond && x.side === "SELL");
  assert(sells.length > 0 && sells.every((x) => x.outcome === "yes" && Number(x.price) === 0.47 && Number(x.size) === 5 && x.gate === "reduce"), JSON.stringify(sells.slice(0, 2)));
  const firstSell = Math.min(...sells.map((x) => Date.parse(String(x.ts))));
  const heldAt = (t: number) => (w.rows("pm_lp_minutes").find((m) => m.cond === w.L1.cond && Date.parse(String(m.minute)) === Math.floor(t / M) * M)?.detail as any)?.lp?.held;
  assertEquals(heldAt(firstSell).yes >= 5, true);
  assertEquals(heldAt(firstSell - M).yes < 5, true);
  // 5N: every minute whose holdings the path decided on were 25 YES or more rests no BUY of YES; and that happened.
  const capped = w.rows("pm_lp_minutes").filter((m) => m.cond === w.L1.cond && (m.detail as any).lp.held.yes - (m.detail as any).lp.held.no >= 25);
  assert(capped.length > 0, "the paper reached 5N");
  for (const m of capped) assertEquals(w.restingAfter(w.L1.cond, Date.parse(String(m.minute))).filter((x) => x.outcome === "yes" && x.side === "BUY").length, 0);
  // The paper: its first fill is the bid's BUY of YES at 0.45; its sells are SELLs of YES at 0.47, booked as the path books them.
  const fills = w.rows("pm_lpprep_fills").filter((f) => f.cond === w.L1.cond);
  assertEquals([fills[0].token, fills[0].token_side, Number(fills[0].token_price)], [tok(1, "yes"), "BUY", 0.45]);
  const sold = fills.filter((f) => f.token_side === "SELL");
  assert(sold.length > 0 && sold.every((f) => f.token === tok(1, "yes") && Number(f.token_price) === 0.47 && f.side === "ask"), JSON.stringify(sold));
  // Every L1 minute the layer decided is matched or dark: nothing the path rested is anything but RW's price on its side.
  const classes = new Set(w.rows("pm_lpprep_minutes").filter((m) => m.cond === w.L1.cond).map((m) => m.class));
  assertEquals([...classes].filter((c) => c !== "matched" && c !== "dark"), []);
  // BIG's jump at 10:10: from that minute to 11:09 the minute records the pause and nothing rests; its quotes were cancelled for it.
  const big = w.rows("pm_lp_minutes").filter((m) => m.cond === w.BIG.cond);
  for (const m of big) {
    const t = Date.parse(String(m.minute)), paused = t >= T0 - 30e3 + 10 * M;
    assertEquals((m.detail as any).lp.state, paused ? "paused" : "quote", String(m.minute));
    if (paused) assertEquals(w.restingAfter(w.BIG.cond, t).length, 0);
  }
  assert(w.rows("pm_lp_orders").some((x) => x.cond === w.BIG.cond && x.cancel_gate === "pause"));
  assert(w.othersUntouched(), "mini-pool's and mid-pool's tables untouched");
});

Deno.test("the caps count what the paper holds: a buy that would pass $100 a market (here the config's $5) is withheld", async () => {
  const w = world({ config: { cap_market_usd: 5 } });
  w.pm.prints.set(w.L1.cond, Array.from({ length: 6 }, (_, k): P => [at(k, 10), "SELL", 0, 0.44, 5]));
  await w.run(T0, 10);
  assertEquals(w.errors, []);
  // 5 YES at 0.45 ($2.25) and a bid of 5 at 0.45 ($2.25) fit $5; 10 YES ($4.50) and a bid do not: every turn that
  // decided on 10 YES or more rests no BUY of YES, and says why. (The paper ends above 10: it fills two minutes ahead of
  // the holdings the dry-run decides on, the lag its pre-registration names; live, the account's holdings are current.)
  const mins = w.rows("pm_lp_minutes").filter((m) => m.cond === w.L1.cond && (m.detail as any).lp.held.yes >= 10);
  assert(mins.length > 0, "the paper reached 10 YES");
  for (const m of mins) assertEquals(w.restingAfter(w.L1.cond, Date.parse(String(m.minute))).filter((x) => x.outcome === "yes" && x.side === "BUY").length, 0, String(m.minute));
  const withheld = (w.rows("pm_lp_state")[0].state as any).withheld as Array<{ slot: string; gate: string }>;
  assert(withheld.some((x) => x.gate === "cap_market" && x.slot.endsWith("|BUY")), JSON.stringify(withheld));
  // Each minute records what the caps counted after its turn: in a minute that placed a buy, within $5 in the market.
  for (const m of w.rows("pm_lp_minutes").filter((x) => x.cond === w.L1.cond)) {
    const lp = (m.detail as any).lp, t = Date.parse(String(m.minute));
    assert(typeof lp.committed === "number" && typeof lp.committedMarket === "number");
    const bought = w.rows("pm_lp_orders").some((x) => x.cond === w.L1.cond && x.side === "BUY" && Math.floor(Number((x.request as any).timestamp) / M) * M === t);
    if (bought) assert(lp.committedMarket <= 5 + 1e-9, `${m.minute}: ${lp.committedMarket}`);
  }
});

Deno.test("the near-certain limit on the path (Addendum 7): its capital is the config's total cap; the paper fills only what rests", async () => {
  const runNc = async (capTotal: number) => {
    const w = world({ nearCertain: true, config: { cap_total_usd: capTotal } });
    const nc = w.NC!;
    // A SELL of YES at 0.95 through NC's bid (a BUY of YES at 0.96) in each of the first ten minutes, 5 a minute.
    w.pm.prints.set(nc.cond, Array.from({ length: 10 }, (_, k): P => [at(k, 10), "SELL", 0, 0.95, 5]));
    await w.run(T0, 14);
    assertEquals(w.errors, []);
    assert(w.rows("pm_lp_markets").some((m) => m.cond === nc.cond), "NC selected");
    const mins = w.rows("pm_lp_minutes").filter((m) => m.cond === nc.cond);
    const yesBuys = (m: Row) => w.restingAfter(nc.cond, Date.parse(String(m.minute))).filter((x) => x.outcome === "yes" && x.side === "BUY");
    return { w, nc, mins, yesBuys };
  };
  const held = (m: Row) => (m.detail as any).lp.held as { yes: number; no: number };
  // $100 of capital: 8 % is $8. Nothing held, 5 at 0.96 ($4.80) rests; from 4 YES held at the mark 0.97 ($3.88), the buy
  // would pass $8 and is not sent, while the cheap side's BUY of NO keeps resting, and from 5 held its SELL of YES.
  const a = await runNc(100);
  const first = a.mins.find((m) => held(m).yes === 0 && held(m).no === 0);
  assert(first && a.yesBuys(first).length === 1, "with nothing held the near-certain buy rests");
  const over = a.mins.filter((m) => held(m).yes >= 4);
  assert(over.length > 0, "the paper bought near-certain YES");
  for (const m of over) {
    assertEquals(a.yesBuys(m).length, 0, String(m.minute));
    assert(a.w.restingAfter(a.nc.cond, Date.parse(String(m.minute))).some((x) => x.outcome === (held(m).yes >= 5 ? "yes" : "no") && x.side === (held(m).yes >= 5 ? "SELL" : "BUY")), String(m.minute));
  }
  // The paper decides the same way: every NC minute it judged is matched or dark (one side resting is matched), and it
  // buys YES only while the path rests the buy. (It fills ahead of the holdings the dry-run decides on, the lag the cap
  // test above names, so it ends above $8; live, the account's holdings are current.)
  assertEquals([...new Set(a.w.rows("pm_lpprep_minutes").filter((m) => m.cond === a.nc.cond).map((m) => m.class))].filter((c) => c !== "matched" && c !== "dark"), []);
  const yesBought = (w: typeof a.w) => w.rows("pm_lpprep_fills").filter((f) => f.cond === a.nc.cond && f.token === tok(8, "yes") && f.token_side === "BUY");
  const lastRest = Math.max(...a.mins.filter((m) => a.yesBuys(m).length > 0).map((m) => Date.parse(String(m.minute))));
  assert(yesBought(a.w).length > 0 && yesBought(a.w).every((f) => Date.parse(String(f.minute)) <= lastRest), JSON.stringify(yesBought(a.w).map((f) => f.minute)));
  // $320 of capital (8 % = $25.60): the same holdings still rest the buy. The limit is a share of the capital the path reads.
  const b = await runNc(320);
  const between = b.mins.filter((m) => held(m).yes >= 4 && held(m).yes * 0.97 + 5 * 0.96 <= 25.6 && held(m).yes - held(m).no < 25);
  assert(between.length > 0, "the $320 paper held 4 or more YES under the limit");
  for (const m of between) assertEquals(b.yesBuys(m).length, 1, String(m.minute));
  const sum = (w: typeof a.w) => yesBought(w).reduce((t, f) => t + Number(f.size), 0);
  assert(sum(b.w) > sum(a.w), `${sum(b.w)} YES bought at $320, ${sum(a.w)} at $100`);
});

Deno.test("a carried market: the next day, not selected, it rests only the sells of what its paper holds, and its paper sells them for nothing of the pool", async () => {
  const w = world();
  w.pm.prints.set(w.L1.cond, [
    ...Array.from({ length: 2 }, (_, k): P => [at(k, 10), "SELL", 0, 0.44, 5]),
    ...Array.from({ length: 3 }, (_, k): P => [at(14 * 60 + 2 + k, 20), "BUY", 0, 0.48, 5]),      // day 2, 00:02 → 00:04
  ]);
  await w.run(T0, 6);
  const day2 = Date.parse("2026-10-06T00:00:30Z");
  w.L1.rate = 5;                                                                                 // out of the universe on day 2
  await w.run(day2, 8);
  assertEquals(w.errors, []);
  assert(!w.rows("pm_lp_markets").some((m) => m.day === "2026-10-06" && m.cond === w.L1.cond));
  const mins = w.rows("pm_lp_minutes").filter((m) => m.cond === w.L1.cond && String(m.minute) >= "2026-10-06");
  assert(mins.length > 0 && mins.every((m) => (m.detail as any).lp.state === "carried"), JSON.stringify(mins.map((m) => (m.detail as any).lp)));
  const day2Orders = w.rows("pm_lp_orders").filter((x) => x.cond === w.L1.cond && String(x.ts) >= "2026-10-06");
  assert(day2Orders.length > 0 && day2Orders.every((x) => x.side === "SELL" && x.outcome === "yes" && Number(x.price) === 0.47), JSON.stringify(day2Orders));
  const sold = w.rows("pm_lpprep_fills").filter((f) => f.cond === w.L1.cond && f.token_side === "SELL");
  assert(sold.length > 0 && sold.every((f) => f.close_only === true));
  const paid = w.rows("pm_lpprep_minutes").filter((m) => m.cond === w.L1.cond && String(m.minute) >= "2026-10-06" && m.class === "matched");
  assert(paid.length > 0 && paid.every((m) => Number(m.reward) === 0 && m.close_only === true));
  // Day 1 closed on the paper.
  assertEquals(w.rows("pm_lpprep_days").map((d) => d.day), ["2026-10-05"]);
});

Deno.test("the stop: on the paper's fills and what its closed days would have been paid, in the dry-run's own mode; no day stop", async () => {
  // L1 holds 10 YES at 0.45 by 10:05; then its book falls 8 ¢ (no pause): the paper's fills are −$0.70 at the mid.
  const fall = (w: ReturnType<typeof world>) => async () => {
    w.pm.prints.set(w.L1.cond, Array.from({ length: 2 }, (_, k): P => [at(k, 10), "SELL", 0, 0.44, 5]));
    await w.run(T0, 6);
    w.L1.bid = 0.37; w.L1.ask = 0.39;
    await w.run(T0 + 6 * M, 3);
  };
  const a = world({ config: { loss_total_usd: 0.5 } });
  await fall(a)();
  const ev = a.rows("pm_lp_events").filter((e) => e.kind === "loss_stop_total");
  assertEquals(ev.map((e) => [e.mode, (e.detail as any).paid]), [["dry_run", 0]]);
  assertAlmostEquals((ev[0].detail as any).totalPnl, -0.7, 1e-9);
  // From then on nothing opens: no BUY rests anywhere; L1 rests only its sell of YES.
  const stopAt = Date.parse(String(ev[0].minute));
  const after = a.rows("pm_lp_orders").filter((x) => Date.parse(String(x.ts)) > stopAt);
  assert(after.length > 0 && after.every((x) => x.side === "SELL"), JSON.stringify(after.map((x) => `${x.outcome} ${x.side}`)));
  assertEquals(a.rows("pm_lp_events").filter((e) => e.kind === "loss_stop_day").length, 0);
  // The same day with $1 of its paper's closed days at R = 0.40 behind it: −0.70 + 1 is above −0.50, so no stop.
  const b = world({ config: { loss_total_usd: 0.5 }, days: [{ day: "2026-10-04", reward: 2.5, reward_r40: 1 }] });
  await fall(b)();
  assertEquals(b.rows("pm_lp_events").filter((e) => e.kind === "loss_stop_total").length, 0);
  assertEquals((b.rows("pm_lp_state")[0].state as any).lp.paid, 1);
  assert(a.othersUntouched() && b.othersUntouched());
});

/**
 * The day stop of 2026-10-07 (Davies: "只算当天变化") is mini-pool's and mid-pool's: live-prep has none (its config's day
 * limit is null, `lpLimits` gives Infinity), so it is unchanged in behaviour. Pinned on a day that would show it: L1's
 * paper holds 10 YES at 0.45 from 10-05, carried into 10-06 at a loss (the book falls to 0.37 / 0.39 at 23:58), and the
 * days run on into 10-06 with L1 carried and its sells resting. The path and its layer as deployed, and the same on the
 * frozen day stop, write every table, send every request and body and report every turn the same; no day stop and no
 * opening marks appear in either; the turn's day figure is the frozen one.
 */
Deno.test("live-prep has no day stop: the change of 2026-10-07 leaves its path and layer the same, turn by turn, with a loss carried across 00:00", async () => {
  const now = world(), old = world({ onCost: true });
  const late = Date.parse("2026-10-05T23:55:30Z"), day2 = Date.parse("2026-10-06T00:00:30Z");
  const reports: Array<[number, string, string]> = [];
  for (const w of [now, old]) {
    w.pm.prints.set(w.L1.cond, Array.from({ length: 2 }, (_, k): P => [at(k, 10), "SELL", 0, 0.44, 5]));
    const turn = async (t: number) => { const r = await w.turn(t); reports.push([t, w === now ? "now" : "old", JSON.stringify(r)]); return r; };
    for (let k = 0; k < 6; k++) await turn(T0 + k * M);
    for (let k = 0; k < 2; k++) await turn(late + k * M);
    w.L1.bid = 0.37; w.L1.ask = 0.39;
    for (let k = 2; k < 5; k++) await turn(late + k * M);
    w.L1.rate = 5;                                                                             // out of the universe on 10-06
    for (let k = 0; k < 5; k++) await turn(day2 + k * M);
  }
  const of = (who: string) => reports.filter((r) => r[1] === who).map(([t, , r]) => [t, r]);
  assertEquals(of("now"), of("old"));
  assertEquals(JSON.stringify(now.mem.tables), JSON.stringify(old.mem.tables));
  assertEquals(now.pm.urls, old.pm.urls);
  assertEquals(now.pm.bodies, old.pm.bodies);
  assertEquals([now.errors, old.errors], [[], []]);
  // The day the record shows: 10 YES of L1 held into 10-06 below their cost, its sells resting; no day stop, no opening marks.
  assert(now.rows("pm_lpprep_fills").some((f) => f.cond === now.L1.cond && f.token_side === "BUY" && String(f.ts) < "2026-10-06"), "a paper buy on 10-05");
  assert(now.restingAfter(now.L1.cond, day2 + 4 * M - 30e3).some((x) => x.side === "SELL"), JSON.stringify(now.rows("pm_lp_orders").filter((x) => x.cond === now.L1.cond).map((x) => [x.ts, x.side, x.outcome, x.price, x.state])));
  const last = JSON.parse(of("now").at(-1)![1] as string);
  assert(last.pnl.total < 0 && last.pnl.day === last.pnl.total, JSON.stringify(last.pnl));         // the frozen figure: everything counts today
  assertEquals(now.rows("pm_lp_events").filter((e) => e.kind === "loss_stop_day").length, 0);
  const st = now.rows("pm_lp_state")[0].state as Record<string, unknown>;
  assertEquals([st.dayOpen, st.marks, st.marksAt], [undefined, undefined, undefined]);
  assertEquals((now.rows("pm_lpprep_state")[0].state as Record<string, unknown>).open, undefined);
});

Deno.test("armed: the account's holdings, not the paper's; a sell once it holds N; the live stop counts what the readout booked paid", async () => {
  const live = { dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z", loss_total_usd: 0.3 };
  const run = async (paid: number) => {
    const w = world({ config: live });
    // The paper holds 10 YES of L1: armed, the path never reads it.
    w.rows("pm_lpprep_fills").push({ cond: w.L1.cond, minute: "2026-10-05T09:00:00.000Z", print_id: "x", ts: "2026-10-05T09:00:10.000Z", side: "bid", price: 0.45, size: 10, token: tok(1, "yes"), token_side: "BUY", token_price: 0.45, close_only: false });
    if (paid) w.rows("pm_lp_reward_days").push({ mode: "live", day: "2026-10-04", cond: w.L1.cond, minutes: 10, minutes_two_sided: 10, minutes_scored: 10, formula_usd: 1, formula_scored_usd: 1, rate: 12, actual_usd: paid, actual_sponsored_usd: 0, rebate_usd: 0, read_at: "2026-10-05T01:00:00.000Z", detail: {} });
    await w.turn(T0);
    const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.cond === w.L1.cond && x.outcome === "yes" && x.side === "BUY" && x.state === "live");
    assert(yesBuy, "a live BUY of YES rests: the paper's 10 YES are not the account's");
    assertEquals(w.rows("pm_lp_orders").filter((x) => x.side === "SELL").length, 0);
    // The venue fills it, 5, CONFIRMED: the account holds 5 YES, and the next turn's ask is a SELL of YES at 0.47.
    w.pm.settle(w.pm.fill(String(yesBuy.hash), 5), "CONFIRMED");
    await w.turn(T0 + M);
    await w.turn(T0 + 2 * M);
    const sell = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.cond === w.L1.cond && x.side === "SELL");
    assertEquals([sell?.outcome, Number(sell?.price), Number(sell?.size), sell?.state], ["yes", 0.47, 5, "live"]);
    // The global pause takes every order off the book; then the book falls 8 ¢: 5 × (0.38 − 0.45) = −0.35 on the fills.
    (w.rows("agent_risk")[0]).global_pause = true;
    await w.turn(T0 + 3 * M);
    w.L1.bid = 0.37; w.L1.ask = 0.39;
    await w.turn(T0 + 4 * M);
    assertEquals(w.errors.filter((e) => !/global pause|cancel/.test(e)), []);
    return w.rows("pm_lp_events").filter((e) => e.kind === "loss_stop_total").map((e) => [e.mode, (e.detail as any).paid]);
  };
  assertEquals(await run(0), [["live", 0]]);
  assertEquals(await run(0.1), []);                                            // −0.35 + 0.10 = −0.25, inside −0.30
});

// ------------------------------------------------------------------ F1: the outcome tokens' approvals (2026-10-09)

const MAXU = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const CTF = "0xE111180000d2663C0091e4f400237545B87B996B", NEG = "0xe2222d279d744050d28e00520010520000310F59";

Deno.test("ctfApproval: both exchanges positive in every listing is true; either missing or 0 is false; no listing at all is null", () => {
  assertEquals(ctfApproval([{ [CTF]: MAXU, [NEG]: MAXU }, { [CTF.toLowerCase()]: "1", [NEG.toLowerCase()]: MAXU }]), true);
  assertEquals(ctfApproval([{ [CTF]: MAXU, [NEG]: "0" }]), false);
  assertEquals(ctfApproval([{ [CTF]: MAXU }]), false);
  assertEquals(ctfApproval([{ [CTF]: MAXU, [NEG]: MAXU }, { [CTF]: "0", [NEG]: MAXU }]), false);
  assertEquals(ctfApproval([undefined, {}, null, "x", []]), null);
  assertEquals(ctfApproval([]), null);
});

Deno.test("gates: an exchange not approved stops opening and names itself, never a sell; unread or not live-prep's, it stops nothing", () => {
  const base = {
    mode: "live" as const, globalPause: false, riskReadable: true, armed: true, sbRegion: "eu-west-1", geo: { ok: true, country: "IE", region: "L", blocked: true },
    closedOnly: false, attested: true, inventoryReadable: true, lossDay: false, lossTotal: false,
  };
  const no = gates({ ...base, ctfApproved: false });
  assertEquals([no.open, no.openBlockedBy, no.reduce, no.reduceBlockedBy, no.verdicts.ctf_approval], [false, "ctf_approval", true, null, false]);
  const unread = gates({ ...base, ctfApproved: null });
  assertEquals([unread.open, unread.verdicts.ctf_approval], [true, null]);
  // Not given (every other instance, and live-prep's dry-run): no such gate, and the verdicts are what they were.
  assertEquals("ctf_approval" in gates(base).verdicts, false);
  // A gate listed earlier still decides first.
  assertEquals(gates({ ...base, ctfApproved: false, attested: false }).openBlockedBy, "attestation");
});

Deno.test("armed, F1: with the Neg Risk CTF Exchange not approved nothing opens and it is said once; a sell of what is held still goes; dry-run unchanged", async () => {
  const live = { dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z" };
  const w = world({ config: live });
  w.pm.ctfAllowances = { [CTF]: MAXU, [NEG]: "0" };
  w.pm.tokens.set(tok(1, "yes"), 5);                                                 // the account holds 5 YES of L1
  const r = await w.turn(T0);
  const orders = w.rows("pm_lp_orders").filter((x) => x.mode === "live");
  assertEquals(orders.filter((x) => x.side === "BUY").length, 0);
  // L1 is a standard market: its sell goes through the CTF Exchange, which is approved, and the venue takes it.
  assertEquals(orders.filter((x) => x.side === "SELL").map((x) => [x.cond, x.outcome, Number(x.price), Number(x.size), x.state]), [[w.L1.cond, "yes", 0.47, 5, "live"]]);
  assertEquals([r.gates?.open, r.gates?.openBlockedBy, r.gates?.reduce], [false, "ctf_approval", true]);
  assertEquals(r.errors.filter((e) => e.includes("not approved")).length, 1);
  const r2 = await w.turn(T0 + M);
  assertEquals(r2.errors.filter((e) => e.includes("not approved")).length, 0);            // said once, on the turn it closed
  // Approved again: it opens.
  w.pm.ctfAllowances = { [CTF]: MAXU, [NEG]: MAXU };
  const r3 = await w.turn(T0 + 2 * M);
  assertEquals([r3.gates?.open, r3.gates?.verdicts.ctf_approval], [true, true]);
  assert(w.rows("pm_lp_orders").some((x) => x.mode === "live" && x.side === "BUY" && x.state === "live"));
  // The same account in dry-run: no such gate, and its buys are recorded as before.
  const d = world();
  d.pm.ctfAllowances = { [CTF]: MAXU, [NEG]: "0" };
  const rd = await d.turn(T0);
  assertEquals(["ctf_approval" in (rd.gates?.verdicts ?? {}), rd.gates?.open], [false, true]);
  assert(d.rows("pm_lp_orders").some((x) => x.side === "BUY"));
});

// ------------------------------------------------------------------ U1: the conditional balance, gross or net of our resting sells

Deno.test("heldFromBalance: H on either reading of the balance when the fills agree; where they disagree, what the venue enforces", () => {
  // H = 5 held, S = 5 of it resting in our sell, F = 5 from the fills.
  assertEquals(heldFromBalance(5, 5, 5), 5);              // gross: 5 + 5 > 5, so the balance
  assertEquals(heldFromBalance(0, 5, 5), 5);              // net: 0 + 5 ≤ 5, so 5
  assertEquals(heldFromBalance(12, 5, 12), 12);           // gross, part resting
  assertEquals(heldFromBalance(7, 5, 12), 12);            // net, part resting
  assertEquals(heldFromBalance(5, 0, 5), 5);              // nothing resting: the balance, either way
  assertEquals(heldFromBalance(3, 0, 9), 3);
  assertEquals(heldFromBalance(0, 5, 3), 0);              // net, but the fills explain less: the balance, as before
  assertEquals(heldFromBalance(5, 5, 10), 10);            // gross, the fills say more: a sell the venue would refuse, never fill
});

Deno.test("armed, U1: a sell of what is held keeps resting, and its side never flips to a buy, whether the venue's balance is gross or net of our resting sells", async () => {
  const live = { dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z" };
  const day = async (net: boolean) => {
    const w = world({ config: live });
    w.pm.conditionalNetOfOrders = net;
    await w.turn(T0);
    const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.cond === w.L1.cond && x.outcome === "yes" && x.side === "BUY" && x.state === "live");
    assert(yesBuy, "a live BUY of YES rests");
    w.pm.settle(w.pm.fill(String(yesBuy.hash), 5), "CONFIRMED");                     // the account holds 5 YES
    for (let k = 1; k <= 4; k++) await w.turn(T0 + k * M);
    const l1 = w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.cond === w.L1.cond && Date.parse(String(x.ts)) >= T0 + M);
    const sells = l1.filter((x) => x.side === "SELL");
    // One SELL of YES at 0.47 × 5, placed once and resting since: never cancelled for a buy, never replaced.
    assertEquals(sells.map((x) => [x.outcome, Number(x.price), Number(x.size), x.state, x.cancel_requested_at ?? null]), [["yes", 0.47, 5, "live", null]]);
    // The ask side stays a sell: no BUY of NO is placed while the 5 YES are held.
    assertEquals(l1.filter((x) => x.outcome === "no" && x.side === "BUY").length, 0);
    const held = (w.rows("pm_lp_state")[0].state as any).markets.find((m: { cond: string }) => m.cond === w.L1.cond).held;
    assertEquals(held.yes, 5);
    return w.pm.calls.filter((c) => c.startsWith("POST")).length;
  };
  const gross = await day(false), net = await day(true);
  assertEquals(net, gross);                                                        // the same orders sent either way
});

// ------------------------------------------------------------------ the governor: 12,000 POSTs a day for live-prep (2026-10-09)

Deno.test("lpLimits: live-prep's POSTs a day go to 12,000 by its config, never past; mini-pool's and mid-pool's stay at 6,000", () => {
  assertEquals([PM_LP_MAX_POSTS_DAY, PM_LIVE_MAX_POSTS_DAY], [12000, 6000]);
  const at = (max_posts_day: unknown) => lpLimits({ ...LP_CONFIG, max_posts_day } as unknown as PmLiveConfig, PM_LP_INSTANCE.lp!).maxPosts;
  assertEquals([at(12000), at(6000), at(99999), at(9000.7), at(0)], [12000, 6000, 12000, 9000, 0]);
  // The other instances' limits are effectiveLimits, which a config of 12,000 cannot lift past 6,000.
  assertEquals(effectiveLimits({ ...LP_CONFIG, max_posts_day: 12000 } as unknown as PmLiveConfig).maxPosts, 6000);
  for (const inst of [PM_LIVE_INSTANCE, PM_MINI_INSTANCE, PM_MID_INSTANCE]) assertEquals(inst.lp, undefined);
  // Every other field of live-prep's limits is as it was.
  const { maxPosts: _a, ...now } = lpLimits({ ...LP_CONFIG, max_posts_day: 12000 } as unknown as PmLiveConfig, PM_LP_INSTANCE.lp!);
  const { maxPosts: _b, ...was } = lpLimits({ ...LP_CONFIG, max_posts_day: 6000 } as unknown as PmLiveConfig, PM_LP_INSTANCE.lp!);
  assertEquals(now, was);
});

Deno.test("armed, the governor: with its config at 12,000 live-prep still posts after 6,001 POSTs today and stops at 12,000; at 6,000 it stops at 6,000", async () => {
  const live = { dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z" };
  /** A live day that has already sent `n` POSTs (ended orders in a market of nobody's), then one turn. */
  const day = async (n: number, max_posts_day: number) => {
    const w = world({ config: { ...live, max_posts_day } });
    const rows = w.rows("pm_lp_orders");
    for (let i = 0; i < n; i++) {
      rows.push({
        id: 1_000_000 + i, ts: "2026-10-05T00:00:01.000Z", mode: "live", cond: cond(99), token: tok(99, "yes"), outcome: "yes", side: "BUY", price: 0.4, size: 5,
        order_type: "GTD", post_only: true, expiration: 1, neg_risk: false, hash: `0x${(1_000_000 + i).toString(16).padStart(64, "0")}`, state: "cancelled",
        size_matched: 0, gate: "open", reason: "new", book_seen: null, request: null, response: null, cancel_requested_at: null, cancel_gate: null,
        cancel_reason: null, filled_at: null, cancelled_at: "2026-10-05T00:00:02.000Z", updated_at: "2026-10-05T00:00:02.000Z",
      });
    }
    const r = await w.turn(T0);
    return { posted: r.posts, governed: r.withheld.filter((x) => x.gate === "governor").length, limit: (w.rows("pm_lp_state")[0].state as any).limits.maxPosts };
  };
  const a = await day(6001, 12000);
  assert(a.posted > 0 && a.governed === 0, JSON.stringify(a));
  assertEquals(a.limit, 12000);
  const b = await day(12000, 12000);
  assert(b.posted === 0 && b.governed > 0, JSON.stringify(b));
  const c = await day(6000, 6000);
  assert(c.posted === 0 && c.governed > 0, JSON.stringify(c));
  assertEquals(c.limit, 6000);
});

// ------------------------------------------------------------------ the reward check (2026-10-10, Addendum 9)

Deno.test("rewardConfigOf: the CLOB's programme in force that day; none listed is a programme ended; any other shape is unread, never an end", () => {
  const c = "0x045fdf4be2f890a3f846357a5160834685bb7dfae65909d3d307e5547898e1ad";
  // GET /rewards/markets/0x045fdf4b… as it answered on 2026-10-10 00:20 UTC (the selection of 10-09 read 200 a day, minimum 20).
  const reply = { data: [{ condition_id: c, rewards_config: [{ asset_address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", start_date: "2026-10-09", end_date: "2500-12-31", id: 3326402, rate_per_day: 50, total_rewards: 0, total_days: 173209 }], rewards_max_spread: 6.5, rewards_min_size: 50 }], next_cursor: "LTE=", limit: 100, count: 1 };
  assertEquals(rewardConfigOf(reply, c, "2026-10-10"), { native: 50, v: 6.5, minSize: 50 });
  // A programme not yet started, or over, is not in force; two in force add up.
  assertEquals(rewardConfigOf(reply, c, "2026-10-08"), { native: 0, v: 6.5, minSize: 50 });
  const two = { data: [{ ...reply.data[0], rewards_config: [...reply.data[0].rewards_config, { start_date: "2026-10-01", end_date: "2026-10-10", rate_per_day: 7 }] }] };
  assertEquals([rewardConfigOf(two, c, "2026-10-10")?.native, rewardConfigOf(two, c, "2026-10-11")?.native], [57, 50]);
  // 0xf0503539… on 2026-10-10: no programme at all.
  assertEquals(rewardConfigOf({ data: [], next_cursor: "LTE=", limit: 100, count: 0 }, c, "2026-10-10"), { native: 0, v: null, minSize: null });
  // Unread: no data array, another market's row, a rate that is not a number.
  for (const bad of [null, {}, { data: "x" }, { data: [{ ...reply.data[0], condition_id: "0x1" }] }, { data: [{ ...reply.data[0], rewards_config: [{ rate_per_day: "n/a" }] }] }, { data: [{ ...reply.data[0], rewards_config: null }] }]) {
    assertEquals(rewardConfigOf(bad, c, "2026-10-10"), null, JSON.stringify(bad));
  }
});

Deno.test("lpRewardVerdict: in the universe it may enter; ended, under $10, a minimum past N = 20 it may not; a failed read keeps the last good one for five minutes, then none", () => {
  const band = PM_LP_INSTANCE.band, t = Date.parse("2026-10-09T05:00:00Z"), stale = PM_LP_REWARD_CHECK.staleMs;
  const cfg = (rate: number, minSize: number | null = 20, v: number | null = 6.5, at = iso(t)): PmRewardNow => ({ rate, native: rate, sponsored: 0, v, minSize, at });
  assertEquals(PM_LP_REWARD_CHECK, { staleMs: 5 * M, backstopMinutes: 3 });
  assertEquals(lpRewardVerdict(cfg(200), null, band, t, stale), { ok: true, why: null, cfg: cfg(200), fresh: true });
  const no = (x: PmRewardNow | null, last: PmRewardNow | null = null, now = t) => lpRewardVerdict(x, last, band, now, stale);
  assertEquals([no(cfg(0, null, null)).ok, no(cfg(0, null, null)).why], [false, "its reward programme has ended: the CLOB lists none for it"]);
  assertEquals(no(cfg(9.99)).why, "its reward rate is now 9.99 a day, under the floor of 10");
  assertEquals(no(cfg(10)).ok, true);
  // 0x045fdf4b… from 04:59 on 2026-10-09: 50 a day, minimum 50 against our 20.
  assertEquals(no(cfg(50, 50)).why, "its reward minimum is now 50 shares, more than the 20 it may quote");
  assertEquals(no(cfg(50, 19)).ok, true);
  // A failed read: the last good one stands for five minutes, whatever it said, then nothing enters until a read succeeds.
  assertEquals(no(null, cfg(200), t + 5 * M), { ok: true, why: null, cfg: cfg(200), fresh: false });
  const late = no(null, cfg(200), t + 5 * M + 1);
  assertEquals([late.ok, late.why], [false, `its reward programme has not been read since ${iso(t)}, over 5 minutes: no entry until a read succeeds`]);
  assertEquals(no(null, cfg(50, 50), t + M).ok, false);
  assertEquals([no(null).ok, no(null).why], [false, "its reward programme has not been read: no entry until it is"]);
});

Deno.test("scoringStreak: both sides read not scoring while the formula scores both adds one; either side scoring starts again; a minute that says neither changes nothing", () => {
  const not = { bid_scoring: false, ask_scoring: false }, both = { qBid: 3, qAsk: 2 };
  let n = 0;
  for (let k = 0; k < 2; k++) n = scoringStreak(n, not, both);
  assertEquals(n, 2);
  assertEquals(n + 1 >= PM_LP_REWARD_CHECK.backstopMinutes, true);                      // the third fires
  assertEquals(scoringStreak(2, { bid_scoring: true, ask_scoring: false }, both), 0);
  assertEquals(scoringStreak(2, { bid_scoring: false, ask_scoring: true }, both), 0);
  assertEquals(scoringStreak(2, { bid_scoring: null, ask_scoring: false }, both), 2);    // a side unread or with no order
  assertEquals(scoringStreak(2, not, { qBid: 3, qAsk: 0 }), 2);                           // the formula scores one side only
});

const LIVE = { dry_run: false, live_confirmed_at: "2026-10-05T09:00:00.000Z" };
const minuteOf = (w: ReturnType<typeof world>, c: string, t: number) => w.rows("pm_lp_minutes").find((m) => m.cond === c && Date.parse(String(m.minute)) === Math.floor(t / M) * M) as any;
const sentIn = (w: ReturnType<typeof world>, c: string, t: number, side: "BUY" | "SELL") => w.rows("pm_lp_orders").filter((x) => x.cond === c && x.side === side && Date.parse(String(x.ts)) >= t && Date.parse(String(x.ts)) < t + M);

Deno.test("the reward check, armed: a programme change seen in minute t stops entries in minute t itself; the formula follows the programme; the sells of what is held rest on", async () => {
  const w = world({ config: LIVE });
  await w.turn(T0);
  const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.cond === w.L1.cond && x.outcome === "yes" && x.side === "BUY" && x.state === "live");
  assert(yesBuy, "a live BUY of YES rests");
  w.pm.settle(w.pm.fill(String(yesBuy.hash), 5), "CONFIRMED");                       // the account holds 5 YES
  for (let k = 1; k <= 3; k++) await w.turn(T0 + k * M);
  const live = (side: "BUY" | "SELL") => w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.cond === w.L1.cond && x.side === side && x.state === "live");
  assertEquals([live("BUY").length, live("SELL").length], [1, 1]);
  // The rate rises from 12 to 30 a day: the next minute's formula of the same quotes on the same book is 30 / 12 of it.
  const f3 = minuteOf(w, w.L1.cond, T0 + 3 * M);
  w.L1.rate = 30;
  await w.turn(T0 + 4 * M);
  const f4 = minuteOf(w, w.L1.cond, T0 + 4 * M);
  assertEquals([Number(f3.rate), Number(f4.rate), f4.detail.reward.fresh], [12, 30, true]);
  assert(Number(f3.formula_usd) > 0);
  assertAlmostEquals(Number(f4.formula_usd), Number(f3.formula_usd) * 30 / 12, 1e-9);
  // Its minimum rises to 50, past the 20 it may quote: in THAT turn its buy is cancelled for the check and nothing is
  // bought; the sell of the 5 YES rests on; the minute is scored on the minimum as read (our 5 score nothing).
  w.L1.rewardsMinSize = 50;
  const r5 = await w.turn(T0 + 5 * M);
  const why = "its reward minimum is now 50 shares, more than the 20 it may quote";
  assertEquals(live("BUY").length, 0);
  assertEquals(sentIn(w, w.L1.cond, T0 + 5 * M, "BUY").length, 0);
  assertEquals([yesBuy.state === "cancelled" || w.rows("pm_lp_orders").some((x) => x.cond === w.L1.cond && x.side === "BUY" && x.cancel_gate === "reward" && x.cancel_reason === `no entry: ${why}`)], [true]);
  assertEquals(live("SELL").map((x) => [x.outcome, Number(x.price), Number(x.size)]), [["yes", 0.47, 5]]);
  const f5 = minuteOf(w, w.L1.cond, T0 + 5 * M);
  assertEquals([Number(f5.min_size), Number(f5.formula_usd), f5.detail.lp.state, f5.detail.lp.out], [50, 0, "carried", why]);
  assertEquals(r5.conditions[w.L1.cond], `no entry: ${why}`);
  assert(w.rows("pm_lp_events").some((e) => e.kind === "condition" && (e.detail as any).now[w.L1.cond] === `no entry: ${why}`));
  // The other markets quote on.
  assert(w.rows("pm_lp_orders").some((x) => x.mode === "live" && x.cond === w.BIG.cond && x.side === "BUY" && x.state === "live"));
  // Back in the universe the next minute: it buys again.
  w.L1.rewardsMinSize = 5;
  await w.turn(T0 + 6 * M);
  assertEquals(live("BUY").length, 1);
  // The programme ends (the CLOB lists none, nor does the sponsored listing): no entry, said so.
  w.L1.rate = null; w.L1.sponsoredRate = null;
  const r7 = await w.turn(T0 + 7 * M);
  assertEquals([live("BUY").length, r7.conditions[w.L1.cond]], [0, "no entry: its reward programme has ended: the CLOB lists none for it"]);
  assertEquals([Number(minuteOf(w, w.L1.cond, T0 + 7 * M).rate), Number(minuteOf(w, w.L1.cond, T0 + 7 * M).formula_usd)], [0, 0]);
  // Under the floor: 8 a day.
  w.L1.rate = 8;
  const r8 = await w.turn(T0 + 8 * M);
  assertEquals([live("BUY").length, r8.conditions[w.L1.cond]], [0, "no entry: its reward rate is now 8 a day, under the floor of 10"]);
  assertEquals(w.errors.filter((e) => /reward|minutes not recorded/.test(e)), []);
  assert(w.othersUntouched());
});

Deno.test("the reward check, dry-run too: a minimum past N stops the market's paper buys the minute it is read", async () => {
  const w = world();
  await w.turn(T0);
  assert(w.rows("pm_lp_orders").some((x) => x.cond === w.L1.cond && x.side === "BUY" && x.state === "live"));
  w.L1.rewardsMinSize = 25;
  await w.turn(T0 + M);
  assertEquals(w.rows("pm_lp_orders").filter((x) => x.cond === w.L1.cond && x.side === "BUY" && x.state === "live").length, 0);
  assertEquals(minuteOf(w, w.L1.cond, T0 + M).detail.lp.state, "carried");
});

Deno.test("the reward check: a failed read keeps the last good programme for five minutes, never as an end; past that no entry until a read succeeds", async () => {
  const w = world({ config: LIVE });
  await w.turn(T0);
  w.L1.rate = 30;
  await w.turn(T0 + M);                                                                  // read: 30 a day, at T0 + 1 min
  w.pm.down.rewardMarket = true;
  w.L1.rate = 8;                                                                         // under the floor, but no read sees it
  const buys = () => w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.cond === w.L1.cond && x.side === "BUY" && x.state === "live").length;
  const errs: string[][] = [];
  for (let k = 2; k <= 6; k++) {
    const r = await w.turn(T0 + k * M);
    errs.push(r.errors.filter((e) => /reward programme/.test(e)));
    const f = minuteOf(w, w.L1.cond, T0 + k * M);
    assertEquals([buys(), Number(f.rate), f.detail.reward.fresh, f.detail.lp.state], [2, 30, false, "quote"], `minute ${k}`);
  }
  assertEquals(errs.flat(), []);                                                        // a read inside five minutes fails quietly
  // Six minutes since the last good read: nothing enters until a read succeeds, and it is said.
  const r7 = await w.turn(T0 + 7 * M);
  assertEquals(buys(), 0);
  assert(r7.errors.some((e) => e.includes(`has not been read since ${iso(T0 + M)}, over 5 minutes`)), JSON.stringify(r7.errors));
  assertEquals(minuteOf(w, w.L1.cond, T0 + 7 * M).detail.lp.state, "carried");
  // Read again: 8 a day, under the floor; then 12, and it enters.
  w.pm.down.rewardMarket = false;
  const r8 = await w.turn(T0 + 8 * M);
  assertEquals([buys(), r8.conditions[w.L1.cond]], [0, "no entry: its reward rate is now 8 a day, under the floor of 10"]);
  w.L1.rate = 12;
  await w.turn(T0 + 9 * M);
  assertEquals(buys(), 2);
});

Deno.test("the backstop, armed: both sides read not scoring for three live minutes while the formula scores both takes the market out, in that minute, for the rest of the day; two do not", async () => {
  const w = world({ config: LIVE });
  w.pm.scoringDelayS = 1e9;                                                              // Polymarket reads nothing of ours scoring
  const buys = (c: string) => w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.cond === c && x.side === "BUY" && x.state === "live").length;
  await w.turn(T0);                                                                      // nothing rested when the book was read: no verdict
  assertEquals(minuteOf(w, w.L1.cond, T0).detail.reward.streak, 0);
  await w.turn(T0 + M);
  await w.turn(T0 + 2 * M);
  const m2 = minuteOf(w, w.L1.cond, T0 + 2 * M);
  assertEquals([m2.bid_scoring, m2.ask_scoring, m2.detail.reward.streak, m2.detail.lp.state, buys(w.L1.cond)], [false, false, 2, "quote", 2]);
  assert(m2.detail.qBid > 0 && m2.detail.qAsk > 0);
  const r3 = await w.turn(T0 + 3 * M);
  const why = "Polymarket read neither of its sides scoring for 3 live minutes running while the formula scored both";
  assertEquals([buys(w.L1.cond), r3.conditions[w.L1.cond], minuteOf(w, w.L1.cond, T0 + 3 * M).detail.lp.state], [0, `no entry: ${why}`, "carried"]);
  assertEquals(sentIn(w, w.L1.cond, T0 + 3 * M, "BUY").length, 0);
  assertEquals((w.rows("pm_lp_state")[0].state as any).lp.backstop.dropped[w.L1.cond], { at: iso(T0 + 3 * M), why });
  // It stays out for the day, whatever Polymarket reads after.
  w.pm.scoringDelayS = 0;
  await w.turn(T0 + 4 * M);
  assertEquals(buys(w.L1.cond), 0);
  // Scoring from the start, the same minutes take nothing out.
  const s = world({ config: LIVE });
  for (let k = 0; k <= 4; k++) await s.turn(T0 + k * M);
  assertEquals(s.rows("pm_lp_orders").filter((x) => x.cond === s.L1.cond && x.side === "BUY" && x.state === "live").length, 2);
  assertEquals((s.rows("pm_lp_state")[0].state as any).lp.backstop.dropped, {});
});

// ------------------------------------------------------------------ FUNDED and the early readout (2026-10-10, Addendum 10)

Deno.test("lpFunding: the money put in from the account's own figures, booked first as soon as the payout is read; a move books on two agreeing readings, never in the posting hours, before the payout is read, or with a fill settling", () => {
  assertEquals(PM_LP_FUNDING, { minMoveUsd: 1, agreeUsd: 0.01, freshMs: 5 * M, quietMs: 3 * H + 10 * M });
  // 2026-10-10 01:17 UTC on the record: pUSD 172.810385, the CONFIRMED fills' net 237.718788, paid 6.524180 and 1.976628.
  const residual = Math.round((172.810385 + 237.718788 - 6.52418030132400019 - 1.976628) * 1e6) / 1e6;
  assertEquals(residual, 402.028365);
  const day0 = Date.parse("2026-10-10T00:00:00Z"), t = day0 + 4 * H;
  const base = { nowMs: t, dayStartMs: day0, unsettledFills: 0, payoutRead: true };
  const first = lpFunding({ ...base, prev: null, residualUsd: residual });
  assertEquals([first.booked, first.next?.depositUsd], [{ moveUsd: 402.028365, depositUsd: 402.028365, first: true }, 402.028365]);
  // The first booking: at 02:20 UTC, yesterday's payout read, it books (no quiet hours for it, Davies 2026-10-10 02:18);
  // never before the payout is read, with a fill settling, or unread.
  assertEquals(lpFunding({ ...base, nowMs: day0 + 2 * H + 20 * M, prev: null, residualUsd: residual }).booked, { moveUsd: 402.028365, depositUsd: 402.028365, first: true });
  for (const [x, why] of [[{ payoutRead: false }, "payout is not read"], [{ unsettledFills: 1 }, "settling"]] as const) {
    const r = lpFunding({ ...base, ...x, prev: null, residualUsd: residual });
    assert(r.booked === null && r.next === null && r.why.includes(why), r.why);
  }
  // A later move still waits out the posting hours.
  const early = lpFunding({ ...base, nowMs: day0 + 3 * H, prev: first.next, residualUsd: residual + 100 });
  assert(early.booked === null && early.next?.candidate === null && early.why.includes("before 03:10"), early.why);
  assertEquals(lpFunding({ ...base, prev: first.next, residualUsd: null }).booked, null);
  // A drift under $1 moves nothing; a deposit of $100 books on the second agreeing reading, not the first.
  assertEquals(lpFunding({ ...base, prev: first.next, residualUsd: residual + 0.99 }).booked, null);
  const one = lpFunding({ ...base, prev: first.next, residualUsd: residual + 100 });
  assertEquals([one.booked, one.next?.candidate?.residualUsd], [null, residual + 100]);
  const two = lpFunding({ ...base, nowMs: t + M, prev: one.next, residualUsd: residual + 100 });
  assertEquals([two.booked?.moveUsd, two.next?.depositUsd, two.why], [100, 502.028365, "a deposit"]);
  // Two readings that disagree start again; one more than five minutes later does not agree with the first.
  const off = lpFunding({ ...base, nowMs: t + M, prev: one.next, residualUsd: residual + 50 });
  assertEquals([off.booked, off.next?.candidate?.residualUsd], [null, residual + 50]);
  assertEquals(lpFunding({ ...base, nowMs: t + 6 * M, prev: one.next, residualUsd: residual + 100 }).booked, null);
  // A withdrawal likewise.
  const w1 = lpFunding({ ...base, prev: first.next, residualUsd: residual - 40 }), w2 = lpFunding({ ...base, nowMs: t + M, prev: w1.next, residualUsd: residual - 40 });
  assertEquals([w2.booked?.moveUsd, w2.why], [-40, "a withdrawal"]);
});

Deno.test("armed, FUNDED: the first reading is the money put in; a deposit books as an event after two turns; a payout read is never a deposit", async () => {
  const w = world({ config: LIVE });
  await w.turn(T0);                                                                       // reads 10-04's payout (nothing: a zero after 03:00)
  const st = () => (w.rows("pm_lp_state")[0].state as any).lp.funding;
  const ev = () => w.rows("pm_lp_events").filter((e) => e.kind === "funding").map((e) => (e.detail as any));
  assertEquals([st().depositUsd, ev().map((e) => [e.first, e.moveUsd])], [1000, [[true, 1000]]]);
  // Davies adds $100: booked on the second turn that reads it, not the first.
  w.pm.pusd += 100;
  await w.turn(T0 + M);
  assertEquals([st().depositUsd, ev().length], [1000, 1]);
  await w.turn(T0 + 2 * M);
  assertEquals([st().depositUsd, ev().at(-1).moveUsd, ev().at(-1).why], [1100, 100, "a deposit"]);
  // Polymarket pays $5 and the readout books it: the residual does not move, nothing is booked.
  w.pm.pusd += 5;
  w.rows("pm_lp_reward_days").push({ mode: "live", day: "2026-10-04", cond: w.L1.cond, minutes: 10, minutes_two_sided: 10, minutes_scored: 10, formula_usd: 5, formula_scored_usd: 5, rate: 12, actual_usd: 5, actual_sponsored_usd: 0, rebate_usd: 0, read_at: iso(T0), detail: {} });
  await w.turn(T0 + 3 * M);
  await w.turn(T0 + 4 * M);
  assertEquals([st().depositUsd, ev().length], [1100, 2]);
  // The page's FUNDED is it.
  assertEquals(w.errors.filter((e) => /funding/.test(e)), []);
});

Deno.test("the early readout (Addendum 10): from 00:05 it waits for yesterday's payout to post, writes it once posted without counting it, and counts the read from 03:00; a zero is a zero from 03:00", async () => {
  assertEquals(PM_LP_READOUT, { fromMs: 5 * M, acceptZeroAfterMs: 3 * H });
  const day1 = Date.parse("2026-10-06T00:00:00Z");
  const paid = async (pay: boolean) => {
    const w = world({ config: LIVE });
    await w.turn(T0);                                                                     // a live day of 10-05 in L1
    const rows = () => w.rows("pm_lp_reward_days").filter((r) => r.day === "2026-10-05");
    const ro = () => (w.rows("pm_lp_state")[0].state as any).readouts["2026-10-05"];
    await w.turn(day1 + 4 * M);                                                           // 00:04: not yet
    assertEquals([rows().length, ro()], [0, undefined]);
    await w.turn(day1 + 6 * M);                                                           // 00:06: read, nothing posted
    assertEquals([rows().length, ro()], [0, undefined]);
    if (pay) w.pm.earnings["2026-10-05"] = { native: [{ cond: w.L1.cond, usd: 0.5 }], sponsored: [] };
    await w.turn(day1 + 17 * M);                                                          // ten minutes on: read again
    if (pay) {
      assertEquals([rows().map((r) => Number(r.actual_usd)).reduce((a, b) => a + b, 0), ro().reads, typeof ro().earlyAt], [0.5, 0, "string"]);
    } else assertEquals([rows().length, ro()], [0, undefined]);
    await w.turn(day1 + 3 * H + M);                                                       // 03:01: the read that counts
    assertEquals([rows().length > 0, rows().map((r) => Number(r.actual_usd)).reduce((a, b) => a + b, 0), ro().reads], [true, pay ? 0.5 : 0, 1]);
    return w;
  };
  await paid(true);
  await paid(false);
});

Deno.test("armed, FUNDED at 02:20 UTC: with yesterday's payout read the first turn books the money put in; before that the page has the reading, never the cap", async () => {
  const w = world({ config: LIVE });
  const at0220 = Date.parse("2026-10-06T02:20:30Z");
  await w.turn(T0);                                                                        // 10-05, booked at 1000
  // A fresh path (no booking yet), its 10-05 payout already read at 01:00 as live-prep's was on 10-10.
  const st = () => (w.rows("pm_lp_state")[0].state as any).lp;
  delete st().funding;
  (w.rows("pm_lp_state")[0].state as any).readouts["2026-10-05"] = { reads: 1, at: "2026-10-06T01:00:00.000Z" };
  await w.turn(at0220);
  assertEquals([st().funding?.depositUsd, st().fundingResidual?.usd], [1000, 1000]);
  assertEquals(w.rows("pm_lp_events").filter((e) => e.kind === "funding" && Date.parse(String(e.minute)) >= at0220 - 30e3).map((e) => (e.detail as any).first), [true]);
  // Not yet read: nothing booked, but the reading is kept for the page.
  delete st().funding;
  (w.rows("pm_lp_state")[0].state as any).readouts["2026-10-05"] = { reads: 0, at: "" };
  await w.turn(at0220 + M);
  assertEquals([st().funding, st().fundingResidual?.usd], [undefined, 1000]);
});

// ------------------------------------------------------------------ AI markets out (2026-10-10, Addendum 12)

Deno.test("lpMarketType is LP-ALLOC's typeOf: real questions of model releases, rankings and AI companies are AI; an earlier type claims what it matches first", () => {
  const ai = [
    "Gemini 4.0 released by October 16, 2026?", "Gemini Argon released by October 16, 2026?", "Will Gemini Argon be released on October 10, 2026?",
    "Will Anthropic have a #1 AI model by December 31, 2026?", "Will Claude Sonnet's output price be at or below $8 in 2026?",
    "Will Mistral Large 4 debut at a score of at least 1450 by June 30, 2027?",
    "Will the next Google Gemini Pro model added to the Arena Leaderboard debut at a score of at least 14",
    "Next Fable Model (5.2+) released by October 10, 2026?", "Will the next Meta Muse Spark model be released on October 7, 2026?",
    "Will OpenAI’s valuation be at least $1.30T at the end of November 2026?", "Will OpenAI not announce that it has resumed training by October 20, 2026?",
    "Another Vatican x Anthropic meeting by December 31?",
  ];
  for (const q of ai) { assertEquals(lpMarketType(q), "AI", q); assertEquals(PM_LP_EXCLUDE_AI.test(q), true, q); }
  // A question that merely touches the field, but an earlier type (or none) claims it, stays in, as LP-ALLOC's rule has it.
  const not: Array<[string, string]> = [
    ["Will Google have the highest OpenRouter market share the week of September 28?", "counts"],
    ["Will OpenRouter process between 165T and 170T tokens the week of September 28?", "counts"],
    ["Will SpaceXAI officially rename itself to SpaceXSI by October 31?", "other"],
    ["Will Elon Musk’s net worth be between $1.00T and $1.10T on October 31?", "macro/markets"],
    ["Will MrBeast's next video get between 215 and 223 million views on week 1?", "counts"],
    ["UBS announces move out of Switzerland by June 30, 2027?", "politics/geo"],
    ["Will Ethereum hit $4k by December 31, 2027?", "other"],
    ["Will \"Street Fighter\" score at least 40 on the Rotten Tomatoes Tomatometer?", "box office/reviews"],
  ];
  for (const [q, t] of not) { assertEquals(lpMarketType(q), t, q); assertEquals(PM_LP_EXCLUDE_AI.test(q), false, q); }
});

Deno.test("AI markets out (Addendum 12): a candidate list with an AI market and another leaves the AI market out and changes nothing else", () => {
  const listing = new Map<string, PmRewardRow>([[cond(1), { rate: 50, v: 4.5, minSize: 20 }], [cond(2), { rate: 50, v: 4.5, minSize: 20 }]]);
  const gm = (n: number, question: string) => ({ conditionId: cond(n), question, clobTokenIds: JSON.stringify([tok(n, "yes"), tok(n, "no")]), enableOrderBook: true, acceptingOrders: true, closed: false, negRisk: false });
  const now = Date.parse("2026-10-10T00:00:30Z");
  const ai = gm(1, "Will Claude Sonnet's output price be at or below $8 in 2026?"), other = gm(2, "Will the 30-year Treasury yield hit 5.73% in October?");
  assertEquals(lpCandidateOf(ai, listing, now, PM_LP_BAND, PM_LP_CANDIDATE), null);
  const without = { ...PM_LP_CANDIDATE, excludeQuestion: undefined };
  assertEquals(lpCandidateOf(other, listing, now, PM_LP_BAND, PM_LP_CANDIDATE), lpCandidateOf(other, listing, now, PM_LP_BAND, without));
  assert(lpCandidateOf(ai, listing, now, PM_LP_BAND, without) !== null, "without the rule it was a candidate");
});

Deno.test("AI markets out, at once: the selection never takes one; one selected before the rule takes no entry from the next turn, its sells resting", async () => {
  const w = world({ config: LIVE });
  w.E30.question = "Will Anthropic have a #1 AI model by December 31, 2026?";
  await w.turn(T0);
  assertEquals(w.rows("pm_lp_markets").map((m) => m.cond).sort(), [w.L1.cond, w.BIG.cond].sort());       // E30 is AI now: not taken
  // L1 selected as an ordinary market; the account holds 5 YES; then its question reads as AI (selected before the rule).
  const yesBuy = w.rows("pm_lp_orders").find((x) => x.mode === "live" && x.cond === w.L1.cond && x.outcome === "yes" && x.side === "BUY" && x.state === "live");
  w.pm.settle(w.pm.fill(String(yesBuy!.hash), 5), "CONFIRMED");
  for (let k = 1; k <= 2; k++) await w.turn(T0 + k * M);
  const live = (side: "BUY" | "SELL") => w.rows("pm_lp_orders").filter((x) => x.mode === "live" && x.cond === w.L1.cond && x.side === side && x.state === "live");
  assertEquals([live("BUY").length, live("SELL").length], [1, 1]);
  w.rows("pm_lp_markets").find((m) => m.cond === w.L1.cond)!.question = "Will Claude Sonnet's output price be at or below $8 in 2026?";
  const r = await w.turn(T0 + 3 * M);
  assertEquals([live("BUY").length, live("SELL").map((x) => [x.outcome, Number(x.price), Number(x.size)])], [0, [["yes", 0.47, 5]]]);
  assert(w.rows("pm_lp_orders").some((x) => x.cond === w.L1.cond && x.side === "BUY" && x.cancel_gate === "reward" && x.cancel_reason === `no entry: ${PM_LP_EXCLUDE_AI.why}`));
  assertEquals([minuteOf(w, w.L1.cond, T0 + 3 * M).detail.lp.state, minuteOf(w, w.L1.cond, T0 + 3 * M).detail.lp.out, r.conditions[w.L1.cond]], ["carried", PM_LP_EXCLUDE_AI.why, `no entry: ${PM_LP_EXCLUDE_AI.why}`]);
  // The other market quotes on.
  assert(w.rows("pm_lp_orders").some((x) => x.mode === "live" && x.cond === w.BIG.cond && x.side === "BUY" && x.state === "live"));
});

