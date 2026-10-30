// The other maker's watch (maker_watch.ts, 0185): its order recognised on the books the recorder stored, the minute that a
// snapshot stands for, its distance from LIVE's fair, the events a run of minutes makes (and the ones a flicker must not),
// and a watch cut into runs writing what one pass writes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MW_BACK_MIN, MW_CHAIN_MS, MW_FROM, MW_GONE_MIN, MW_RUN_CHUNKS, MW_TABLES, MW_WIDTH_MIN, mwFair, mwMemo0, mwSide, mwSnapFor, mwStatusOf,
  mwStep, runMakerWatch, type MwLevel, type MwMemo, type MwSnap,
} from "./maker_watch.ts";
import { memDb } from "./testing.ts";

const M = 60e3;
const lv = (s: string): MwLevel[] => s.split(";").map((z) => { const [p, q, n] = z.split(":"); return [Number(p), Number(q), n ? Number(n) : null] as MwLevel; });

// Books as the recorder stored them (agent_book_levels, docs/agents/backtests/fair_price/data and mmcomp/data):
/** USDC-GBP 2026-09-26 18:56 UTC: the maker 5 ticks wide, one order of 5,000.35 / 5,000.38 coins each side. */
const W5 = { bids: lv("0.7543:5000.35002:1;0.7538:6526.40187:1;0.7531:4835.48001:1;0.753:115017.25:1;0.7529:315047.26:1"), asks: lv("0.7548:5000.37502:1;0.755:1478.527:1;0.7552:21627.95529:2;0.7561:430064.51:2;0.7562:585087.77:1") };
/** USDC-GBP 2026-10-15 09:00 UTC: 12 ticks wide; a 26-coin bid of ours ahead of its bid. */
const W12 = { bids: lv("0.7538:26.45263:2;0.7531:5000.6087:1;0.753:13.28021:1;0.7527:445066.78561:3;0.7526:585087.77:1"), asks: lv("0.7543:5000.6087:1;0.7548:15001.8261:1;0.7556:115017.25:1;0.7557:900135.03:2;0.7562:13.22402:1") };
/** USDC-GBP 2026-10-15 09:03 UTC: its bid shares 0.7530 with another order (5,014.04 coins in two). */
const SHARED = { bids: lv("0.7538:26.45263:2;0.753:5014.03861:2;0.7527:430064.51:2;0.7526:600090.04522:2;0.7523:13.29256:1"), asks: lv("0.7542:5000.7584:1;0.7547:15002.27522:1;0.7554:115017.25:1;0.7555:900135.03:2;0.7562:13.22402:1") };
/** USDT-GBP 2026-10-30 02:44 UTC: gone; the touch 19 ticks wide, our rungs' 134-coin bids near it. */
const GONE = { bids: lv("0.7457:264.97253:2;0.7454:133.63295:1;0.745:134.22818:1;0.7443:134.35442:1;0.7435:134.49899:1"), asks: lv("0.7476:1379.26479:1;0.7477:1402552.6907:3;0.7483:601094.0103:1;0.75:13333.33333:1;0.7505:2742.41:1") };
/** USDT-GBP 2026-09-27: its ask at 0.7559 part-filled from 5,000.18 to 4,693.14 coins, the price unchanged. */
const PART_BEFORE = { bids: lv("0.7556:5000.125:1;0.7551:16377.91502:2;0.7544:500:1"), asks: lv("0.7559:5000.175:1;0.756:5110.735:2;0.7565:15000.37501:1") };
const PART_AFTER = { bids: lv("0.7556:5000.125:1;0.7551:16377.91502:2;0.7544:500:1"), asks: lv("0.7559:4693.14:1;0.756:5110.735:2;0.7565:15000.37501:1") };

Deno.test("mwSide finds its order on the stored books: one order of its size, a shared level, nothing on a book it left", () => {
  assertEquals(mwSide(W5.bids, 5000.5, null, 0), { price: 0.7543, qty: 5000.35002, kind: "one" });
  assertEquals(mwSide(W5.asks, 5000.5, null, 0), { price: 0.7548, qty: 5000.37502, kind: "one" });
  // Behind our 26-coin bid: the best level that is its order, not the best level.
  assertEquals(mwSide(W12.bids, 5000.5, null, 0)?.price, 0.7531);
  assertEquals(mwSide(SHARED.bids, 5000.5, null, 0), { price: 0.753, qty: 5014.03861, kind: "shared" });
  assertEquals(mwSide(GONE.bids, 5000.5, null, 0), null);
  // The 1.4 million coins in three orders at 0.7477 are not its level, nor the 13,333 coins in one at 0.75.
  assertEquals(mwSide(GONE.asks, 5000.5, null, 0), null);
  // Counterfactual: a lone 5,200-coin order is not its size; the size it follows moves the band (5,019.6 on 10-22).
  assertEquals(mwSide(lv("0.75:5200:1"), 5000.5, null, 0), null);
  assertEquals(mwSide(lv("0.75:5019.6:1"), 5019.6, null, 0)?.kind, "one");
  assertEquals(mwSide(lv("0.75:5080:1"), 5019.6, null, 0), null);
});

Deno.test("mwSide follows a part-filled order from the one last seen on its side, and only that one", () => {
  const prev = { price: 0.7559, qty: 5000.175, at: 0 };
  assertEquals(mwSide(PART_AFTER.asks, 5000.5, prev, M), { price: 0.7559, qty: 4693.14, kind: "partial" });
  // Without it, 4,693 coins are just an order, and the next level of 5,110.7 coins in two is read as its shared one.
  assertEquals(mwSide(PART_AFTER.asks, 5000.5, null, M), { price: 0.756, qty: 5110.735, kind: "shared" });
  // 2026-10-27's night: 3,733.70 coins at 0.7497, then 3,732.89 at 0.7487 (it moved ten ticks at its smaller size).
  const night = { price: 0.7497, qty: 3733.69661, at: 0 };
  assertEquals(mwSide(lv("0.7484:49.31854:1;0.7487:3732.89:1;0.7488:464.67071:2"), 5000.5, night, M)?.kind, "partial");
  // Counterfactuals: too long ago, grown, moved too far, or filled by more than 1,500 coins since.
  assertEquals(mwSide(lv("0.7487:3732.89:1"), 5000.5, night, MW_CHAIN_MS + M), null);
  assertEquals(mwSide(lv("0.7487:3800:1"), 5000.5, night, M), null);
  assertEquals(mwSide(lv("0.7472:3732.89:1"), 5000.5, night, M), null);
  assertEquals(mwSide(lv("0.7497:2000:1"), 5000.5, night, M), null);
});

Deno.test("mwSnapFor: the newest snapshot stored before the minute's end, while a reading has found it within a minute", () => {
  const m = Date.parse("2026-10-15T09:00:00Z");
  const s = (ts: number, seen: number): MwSnap => ({ ts, seen, ...W12 });
  assertEquals(mwSnapFor([s(m - 3 * M, m - 10e3), s(m + 45e3, m + 45e3), s(m + 70e3, m + 70e3)], m)?.ts, m + 45e3);
  // Unchanged books extend `seen_until`: still standing.
  assertEquals(mwSnapFor([s(m - 30 * M, m - 15e3)], m)?.ts, m - 30 * M);
  // Two readings missed: unseen, not absent.
  assertEquals(mwSnapFor([s(m - 30 * M, m - 61e3)], m), null);
  assertEquals(mwSnapFor([], m), null);
});

Deno.test("mwStep: each side's distance from LIVE's fair in bps, the width in ticks, the touch; the held X when a minute has none", () => {
  const x = 1.3300, fu = 0.99995;          // fair 0.75184…
  const r = mwStep("USDC-GBP", 0, { ts: 0, seen: 0, ...W12 }, fu, x, mwMemo0());
  const fair = fu / x;
  assertEquals(r.row.present, "both");
  assertEquals(r.row.width_ticks, 12);
  assertEquals(r.row.bid_bps, Math.round((fair - 0.7531) / fair * 1e6) / 100);
  assertEquals(r.row.ask_bps, Math.round((0.7543 - fair) / fair * 1e6) / 100);
  assertEquals([r.row.touch_bid, r.row.touch_ask], [0.7538, 0.7543]);
  // A minute with no X (an FX closure) prices at the last X seen.
  assertEquals(mwFair(fu, null, x).fair, fair);
  assertEquals(mwStep("USDC-GBP", M, { ts: M, seen: M, ...W12 }, fu, null, r.memo).row.fair, fair);
  assertEquals(mwFair(fu, null, null).fair, null);
  // One side only is still there.
  assertEquals(mwStep("USDT-GBP", 0, { ts: 0, seen: 0, bids: W5.bids, asks: GONE.asks }, null, null, mwMemo0()).row.present, "bid");
  assertEquals(mwStep("USDT-GBP", 0, null, null, null, mwMemo0()).row.present, "unseen");
});

/** Minutes from t0, each with the book `f(i)` returns (null: unseen). */
function play(t0: number, books: Array<{ bids: MwLevel[]; asks: MwLevel[] } | null>, memo: MwMemo = mwMemo0()) {
  const events = [];
  for (const [i, b] of books.entries()) {
    const m = t0 + i * M;
    const r = mwStep("USDC-GBP", m, b ? { ts: m + 45e3, seen: m + 45e3, ...b } : null, null, null, memo);
    memo = r.memo;
    events.push(...r.events);
  }
  return { events, memo };
}
const rep = <T>(n: number, x: T) => Array.from({ length: n }, () => x);

Deno.test("events: appeared, gone after 15 seen minutes, back after 3, and its width moving 5 -> 12 once 20 two-sided minutes agree", () => {
  const t0 = Date.parse("2026-10-12T20:00:00Z");
  const books = [...rep(30, W5), ...rep(MW_GONE_MIN + 5, GONE), ...rep(40, W12)];
  const { events: all, memo } = play(t0, books);
  const events = all.filter((e) => e.kind !== "size");
  const at = (i: number) => new Date(t0 + i * M).toISOString();
  assertEquals(events.map((e) => [e.kind, e.ts, e.from_value, e.to_value]), [
    ["appeared", at(0), null, null],
    ["width", at(MW_WIDTH_MIN - 1), null, 5],
    ["disappeared", at(30), null, null],
    ["appeared", at(30 + MW_GONE_MIN + 5), null, null],
    // The window was emptied by the absence: the new width is judged on the new minutes alone.
    ["width", at(30 + MW_GONE_MIN + 5 + MW_WIDTH_MIN - 1), 5, 12],
  ]);
  assertEquals(events[2].detail.top, { bids: GONE.bids.slice(0, 2), asks: GONE.asks.slice(0, 2) });
  assertEquals(memo.status, "present");
  assertEquals(memo.since, t0 + (30 + MW_GONE_MIN + 5) * M);
  assertEquals(memo.width, 12);
});

Deno.test("events: a flicker is none — 14 minutes without it, 2 back, unseen minutes between, a one-tick wobble", () => {
  const t0 = Date.parse("2026-10-27T00:00:00Z");
  const quiet = play(t0, [...rep(30, W5), ...rep(MW_GONE_MIN - 1, GONE), ...rep(30, W5)]);
  const kinds = (es: Array<{ kind: string }>) => es.filter((e) => e.kind !== "size").map((e) => e.kind);
  assertEquals(kinds(quiet.events), ["appeared", "width"]);
  // Unseen minutes neither count towards an absence nor end one.
  const gaps = play(t0, [...rep(30, W5), ...rep(10, GONE), ...rep(20, null), ...rep(MW_GONE_MIN - 10, GONE), ...rep(30, W5)]);
  assertEquals(kinds(gaps.events), ["appeared", "width", "disappeared", "appeared"]);
  assertEquals(gaps.events.find((e) => e.kind === "disappeared")?.ts, new Date(t0 + 30 * M).toISOString());
  // Back for fewer than MW_BACK_MIN minutes is not back.
  const blip = play(t0, [...rep(30, W5), ...rep(MW_GONE_MIN, GONE), ...rep(MW_BACK_MIN - 1, W5), ...rep(10, GONE)]);
  assertEquals(kinds(blip.events), ["appeared", "width", "disappeared"]);
  // Its 4-5 tick wobble is one regime: two 4-tick minutes in three for an hour move nothing.
  const W4 = { bids: lv("0.7544:5000.35002:1"), asks: W5.asks };
  const wobble = play(t0, [...rep(30, W5), ...Array.from({ length: 90 }, (_, i) => (i % 3 === 2 ? W5 : W4))]);
  assertEquals(kinds(wobble.events), ["appeared", "width"]);
  assertEquals(wobble.memo.width, 5);
  // The numbers the debounce rests on (the head of maker_watch.ts says why each): a change here is a change of what the
  // events table records, and the history in docs/agents/backtests/mmcomp/results/maker_history.json is re-run with it.
  assertEquals([MW_GONE_MIN, MW_BACK_MIN, MW_WIDTH_MIN], [15, 3, 20]);
});

/** A recorder's table for one book from t0: a snapshot a minute, as `runBooks` stores them. */
function recorded(book: string, t0: number, books: Array<{ bids: MwLevel[]; asks: MwLevel[] }>) {
  return books.map((b, i) => ({ book, ts: new Date(t0 + i * M + 45e3).toISOString(), seen_until: new Date(t0 + i * M + 45e3).toISOString(), bids: b.bids, asks: b.asks, reads: 1 }));
}

Deno.test("runMakerWatch fills the history from MW_FROM a chunk at a time, and runs cut anywhere write what one pass writes", async () => {
  const t0 = MW_FROM;
  const usdc = [...rep(200, W5), ...rep(60, GONE), ...rep(500, W12), ...rep(100, SHARED)];
  const seed = () => ({
    agent_book_levels: [...recorded("USDC-GBP", t0, usdc), ...recorded("USDT-GBP", t0, rep(860, W5))],
    agent_quote_minutes: Array.from({ length: 860 }, (_, i) => ({ book: "USDC-GBP", minute: new Date(t0 + i * M).toISOString(), x: i % 300 === 0 ? null : 1.33, fair_u: 0.99995 })),
    [MW_TABLES.state]: [], [MW_TABLES.minutes]: [], [MW_TABLES.events]: [],
  });
  const end = t0 + 860 * M;
  // One pass with all the time it wants…
  let now = end + 10e3;
  const oneW = memDb(seed(), { now: () => now }), one = oneW.db;
  let r;
  do { r = await runMakerWatch({ db: one, clock: () => now, deadline: Infinity }); } while (r.behind);
  // …and the same minutes in many runs of a clock moving on.
  const manyW = memDb(seed(), { now: () => now }), many = manyW.db;
  let runs = 0;
  for (let t = t0 + 7 * M; t <= end + 10e3; t += 97 * M) { now = t; await runMakerWatch({ db: many, clock: () => now, deadline: Infinity }); runs++; }
  now = end + 10e3;
  do { r = await runMakerWatch({ db: many, clock: () => now, deadline: Infinity }); runs++; } while (r.behind);
  assert(runs > 5);
  // The stored rows, every one (a select stops at PostgREST's page), in one order.
  const rows = (w: ReturnType<typeof memDb>, t: string) => w.tables[t].map((x) => JSON.stringify(x)).sort();
  assertEquals(rows(oneW, MW_TABLES.minutes).length, 2 * 860);
  assertEquals(rows(manyW, MW_TABLES.minutes), rows(oneW, MW_TABLES.minutes));
  assertEquals(rows(manyW, MW_TABLES.events), rows(oneW, MW_TABLES.events));
  const kinds = (await one.select<{ book: string; kind: string; to_value: number | null }>(MW_TABLES.events, "book=eq.USDC-GBP&order=ts.asc")).map((e) => `${e.kind}${e.kind === "width" ? e.to_value : ""}`);
  assertEquals(kinds, ["appeared", "size", "width5", "disappeared", "appeared", "width12"]);
  // The page's view.
  const st = mwStatusOf(await one.select(MW_TABLES.state, "select=book,cursor,memo,last"));
  assertEquals(st["USDC-GBP"]?.status, "present");
  assertEquals(st["USDC-GBP"]?.width, 12);
  assertEquals(st["USDC-GBP"]?.since, new Date(t0 + 260 * M).toISOString());
  assertEquals(st["USDT-GBP"]?.width, 5);
});

Deno.test("runMakerWatch stops at its deadline or after MW_RUN_CHUNKS chunks, and says it is behind", async () => {
  const t0 = MW_FROM;
  const now = t0 + 3 * 24 * 60 * M;
  const db = memDb({ agent_book_levels: [], agent_quote_minutes: [], [MW_TABLES.state]: [], [MW_TABLES.minutes]: [], [MW_TABLES.events]: [] }, { now: () => now }).db;
  const r = await runMakerWatch({ db, clock: () => now, deadline: Infinity });
  assertEquals(r.behind, true);
  const st = await db.select<{ book: string; cursor: string }>(MW_TABLES.state, "order=book.asc");
  // USDT-GBP first: it took every chunk of the run; its minutes with no book are unseen.
  assertEquals(st.map((s) => s.book), ["USDT-GBP"]);
  assertEquals(st[0].cursor, new Date(t0 + (MW_RUN_CHUNKS * 360 - 1) * M).toISOString());
  const late = await runMakerWatch({ db, clock: () => now, deadline: now - 1 });
  assertEquals([late.behind, Object.keys(late.books).length], [true, 0]);
});
