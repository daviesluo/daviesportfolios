// "Reward quotes live-prep" (pm_lp.ts, 0091): the order path and its paper layer on live-prep's instance, against the
// in-memory database held to 0091's rules (a band of $10 and over, $100 a market, no day stop, three configs of which one
// may be armed) and the fake Polymarket that answers the path, its public reads and the paper layer alike.
//
// What is pinned: the instance's names, tables, band and rules, and that mini-pool and mid-pool carry none of them; each
// rule alone, against the code it extends (`lpQuotes` is `rwQuotes` with nothing held, a sell of what is held at the same
// price in the one book, 5N; `pauseAfterJump` is x2's; `lpCandidateOf` keeps what the end horizon alone passed over and
// nothing RW-E's rule or the game's start passes over, and no weather market; `lpLimits` is `effectiveLimits` but its two
// fields; `stepSides` is stepRw's fills; `decideLp` books each fill by its own order and sells no more than is held;
// `classifyLp` takes what the path rests); and simulated days of the path and its layer together: the selection, the
// sells once the paper holds N, 5N, the caps on what the paper holds, the pause, a carried market's exits, the stop on
// the fills and what was paid in its own mode, and, armed, the account's holdings and the live stop. Nothing of
// mini-pool's or mid-pool's tables is touched.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lpQuotes, PM_LP_BAND, PM_LP_CANDIDATE, PM_LP_CAP_MARKET_USD, PM_LP_INSTANCE, PM_LP_INV_CAP, PM_LP_PAUSE, PM_LP_TIGHT, PREP_LP_INSTANCE } from "./pm_lp.ts";
import { isTight } from "./pmrw_x.ts";
import {
  candidateOf, ctfApproval, effectiveLimits, gates, inUniverse, inYesBook, lpCandidateOf, lpLimits, onTick, pauseAfterJump, PM_LIVE_INSTANCE, PM_MINI_INSTANCE, pmLiveDbTables, pmLpDbTables,
  runPmLive, rwQuotes, type PmBookNow, type PmIntent, type PmLiveConfig, type PmMarketRow, type PmPauseState, type PmRewardRow,
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
  assertEquals([lp.rule, lp.candidate, lp.capMarketCeiling, lp.pause], [lpQuotes, { endHorizon: false, excludeFeeTypes: ["weather_fees"] }, 100, { cents: 15, minutes: 60 }]);
  assertEquals(lp.paper, { fills: "pm_lpprep_fills", settlements: "pm_lpprep_settlements", days: "pm_lpprep_days" });
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
function world(o: { config?: Record<string, unknown>; days?: Array<Record<string, unknown>>; onCost?: boolean } = {}) {
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
    clock, pm, mem, L1, BIG, E30, WX, TODAY, GAME, LOW, errors,
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
