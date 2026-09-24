// The paper test of RW (pmrw.ts): the port of the rule against rw_test.py's own numbers on RW's recorded day, and the
// driver against an in-memory database held to 0053's schema.
//
// The golden fixture (docs/agents/backtests/polymarket/results/rw_golden.json, from scripts/rw_golden.py) carries RW's
// committed input for the primary's ten markets and the ten best and worst of the every-market arm, the first row of all
// 2,821 markets, raw books with the rows rw_inputs.py made of them, and what rw_test.py wrote.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/polymarket/results/rw_golden.json" with { type: "json" };
import {
  accCapital, accStress, accTotal, choose, firstScore, newAcc, pyRound, quote, runPmrw, runPmrwSelect, rwPhase, sizeN, stepRw, summarize,
  type BookRow, type RwState,
} from "./pmrw.ts";
import { pmBooks, pmMarkets, pmPrints, pmRewardsCurrent, type PmLevel, type PmPrint } from "../_shared/polymarket_public.ts";
import { memDb, type Row } from "./testing.ts";

type GMarket = { rate: number; v: number; min_size: number; tick: number | null; series: Array<[number, BookRow | null]>; prints: Array<[number, "BUY" | "SELL", number, number, number]>; status: Record<string, unknown> | null };
const G = golden as unknown as {
  first_minute: number; window_s: number; primary: string[];
  firsts: Record<string, { rate: number; v: number; min_size: number; tick: number | null; first: [number, BookRow | null] | null }>;
  markets: Record<string, GMarket>;
  expect: Record<string, Record<string, number | boolean | null>>;
  sums: Record<"primary" | "stress" | "all", Record<string, number>>;
  raw_books: Array<{ cond: string; minute: number; v: number; min_size: number; book: { b: PmLevel[]; a: PmLevel[] } | null; row: BookRow | null }>;
};

/** rw_test.py's run_market, through the port's stepRw. */
function runMarket(mk: GMarket, windowEnd: number, tickWorse = 0, rewardMult = 1) {
  const acc = newAcc(), tick = mk.tick || 0.01, N = sizeN(mk.min_size);
  const prints: PmPrint[] = mk.prints.map(([ts, side, oi, price, size], i) => ({ id: String(i), ts, side, oi, price, size }));
  for (const [minute, row] of mk.series) stepRw(acc, minute, row, tick, mk.v, mk.rate, N, prints, tickWorse);
  let mark: number | null = acc.lastM, resolved = false;
  const st = mk.status ?? {};
  let op: number[] = [];
  try { op = (JSON.parse(String(st.outcomePrices ?? "[]")) as unknown[]).map(Number); } catch { op = []; }
  const ct = st.closedTime;
  if (st.closed && op.length && typeof ct === "string") {
    let s = ct.trim().replace(" ", "T");
    if (s.endsWith("+00")) s += ":00";
    const cts = Date.parse(s.replace("Z", "+00:00")) / 1000;
    if (Number.isFinite(cts) && cts <= windowEnd) { mark = op[0]; resolved = true; }
  }
  const fillPnl = acc.cash + acc.net * (mark ?? 0);
  return {
    reward: acc.reward * rewardMult, fill_pnl: fillPnl, total: acc.reward * rewardMult + fillPnl, fills: acc.fills, fill_shares: acc.fillShares,
    net_end: acc.net, resolved, mark, capital: accCapital(acc), first_cap: acc.firstCap ?? 0, quoted_minutes: acc.quotedMinutes,
  };
}
const windowEnd = G.first_minute + G.window_s;

Deno.test("pyRound is Python's round(): half to even on the exact binary value", () => {
  const cases: Array<[number, number]> = [
    [0.03125, 0.0312], [0.09375, 0.0938], [2.675, 2.675], [1.00005, 1.0001], [123.45675, 123.4567], [0.00005, 0.0001], [-0.03125, -0.0312],
    [7.99995, 8.0], [1e-7, 0.0], [3.14159265, 3.1416], [0.12345, 0.1235], [0.123450000001, 0.1235], [1234.56785, 1234.5678], [0, 0],
  ];
  for (const [x, want] of cases) assertEquals(pyRound(x, 4), want, `round(${x}, 4)`);
  assertEquals(pyRound(2.675, 2), 2.67);
});

Deno.test("summarize turns RW's recorded raw books into exactly the rows rw_inputs.py made of them", () => {
  let n = 0;
  for (const r of G.raw_books) {
    if (!r.book || !r.row) continue;
    assertEquals(summarize(r.book.b, r.book.a, r.v, r.min_size), r.row, `${r.cond.slice(0, 10)} @ ${r.minute}`);
    n++;
  }
  assert(n >= 50, `only ${n} raw books checked`);
});

Deno.test("the selection ranks all 2,821 markets by their first row and picks RW's primary, in order", () => {
  const scored: Array<{ cond: string; perDollar: number; cap: number }> = [];
  for (const [cond, f] of Object.entries(G.firsts)) {
    const fs = firstScore(f.first ? f.first[1] : null, f.tick || 0.01, f.v, f.min_size, f.rate);
    if (fs) scored.push({ cond, ...fs });
  }
  assertEquals(choose(scored).map((s) => s.cond), G.primary);
});

Deno.test("every golden market replays to rw_test.py's own numbers", () => {
  const close = (x: unknown, y: unknown, what: string) => assertAlmostEquals(Number(x), Number(y), 2e-6, what);
  for (const [cond, mk] of Object.entries(G.markets)) {
    const got = runMarket(mk, windowEnd), want = G.expect[cond];
    for (const k of ["reward", "fill_pnl", "total", "fill_shares", "net_end", "capital", "first_cap"]) close(got[k as keyof typeof got], want[k], `${cond.slice(0, 10)} ${k}`);
    assertEquals(got.fills, want.fills, `${cond.slice(0, 10)} fills`);
    assertEquals(got.quoted_minutes, want.quoted_minutes, `${cond.slice(0, 10)} quoted minutes`);
    assertEquals(got.resolved, want.resolved, `${cond.slice(0, 10)} resolved`);
    if (want.mark === null) assertEquals(got.mark, null); else close(got.mark, want.mark, `${cond.slice(0, 10)} mark`);
  }
});

Deno.test("the primary and its stress arm sum to rw_test.py's totals (+$46.61, stress +$13.78)", () => {
  const sum = (rows: ReturnType<typeof runMarket>[], k: "reward" | "fill_pnl" | "total" | "capital") => rows.reduce((s, r) => s + r[k], 0);
  const prim = G.primary.map((c) => runMarket(G.markets[c], windowEnd));
  const stress = G.primary.map((c) => runMarket(G.markets[c], windowEnd, 1, 0.5));
  for (const k of ["reward", "fill_pnl", "total", "capital"] as const) {
    assertAlmostEquals(sum(prim, k), G.sums.primary[k], 1e-5, `primary ${k}`);
    assertAlmostEquals(sum(stress, k), G.sums.stress[k], 1e-5, `stress ${k}`);
  }
  assertEquals(prim.reduce((s, r) => s + r.fills, 0), G.sums.primary.fills);
  assertAlmostEquals(G.sums.primary.total, 46.606921, 1e-6);
});

Deno.test("the run's phase: a warm-up before 2026-09-25 00:00 UTC, fourteen days, then after", () => {
  assertEquals(rwPhase(Date.UTC(2026, 8, 24, 23, 59, 59)), "warm-up");
  assertEquals(rwPhase(Date.UTC(2026, 8, 25)), "run");
  assertEquals(rwPhase(Date.UTC(2026, 9, 8, 23, 59, 59)), "run");
  assertEquals(rwPhase(Date.UTC(2026, 9, 9)), "after");
});

Deno.test("the paper engine's stress is RW's stress arm: halved rewards, a tick worse on every fill, and the touch", () => {
  // One market, a bid fill then a mark: the arm's cash is the rule's cash less a tick a share.
  const acc = newAcc();
  const row: BookRow = [0.45, 0.55, 0.45, 0.55, 100, 100];
  stepRw(acc, 1000, row, 0.01, 4.5, 144, 20, [{ id: "p", ts: 1030, side: "SELL", oi: 0, price: 0.40, size: 50 }]);
  assertEquals(acc.fills, 1);
  assertAlmostEquals(acc.net, 20, 1e-12);
  assertAlmostEquals(acc.cash, -20 * 0.46, 1e-12);
  assertAlmostEquals(accTotal(acc), acc.reward + acc.cash + 20 * 0.5, 1e-12);
  assertAlmostEquals(accStress(acc), acc.reward * 0.5 + acc.cash - 20 * 0.01 + 20 * 0.45, 1e-12);
  assertAlmostEquals(accCapital(acc), 20 * (0.46 + 1 - 0.54) + 20 * 0.46, 1e-12);
});

Deno.test("the rule reads a NO print at 1 − p, quotes no side past 3N, and never fills from a print at its own price", () => {
  const row: BookRow = [0.45, 0.55, 0.45, 0.55, 0, 0];
  const q = quote(row, 0.01)!;
  assertEquals([q.b, q.a], [0.46, 0.54]);
  // A NO BUY at 0.58 is a YES SELL at 0.42: it fills the bid. A YES SELL at exactly 0.46 does not (strictly through).
  const acc = newAcc();
  const out = stepRw(acc, 0, row, 0.01, 4.5, 100, 10, [
    { id: "a", ts: 10, side: "SELL", oi: 0, price: 0.46, size: 5 },
    { id: "b", ts: 20, side: "BUY", oi: 1, price: 0.58, size: 7 },
  ]);
  assertEquals(out.fills.map((f) => [f.side, f.size, f.printId]), [["bid", 7, "b"]]);
  // At 3N long the bid is not quoted, so the minute scores nothing (the reward needs both sides).
  const full = newAcc();
  full.net = 30;
  const o2 = stepRw(full, 60, row, 0.01, 4.5, 100, 10, []);
  assertEquals(o2.decision?.qb, false);
  assertEquals(o2.decision?.reward, 0);
});

// ------------------------------------------------------------------------------------------ the driver

const COND = "0xabc", YES = "111", NO = "222";
const T0 = Date.UTC(2026, 8, 30, 23, 57);            // three minutes before a UTC midnight inside the fourteen days

type World = {
  books: Record<string, { bids: PmLevel[]; asks: PmLevel[]; tick?: number }>; prints: Array<Record<string, unknown>>; closed: Array<Record<string, unknown>>;
  failPrints?: boolean; calls: string[]; now: number; cache: Map<string, { at: number; body: string }>;
};
/**
 * Polymarket's public endpoints as the engine meets them, CloudFront included: a GET to the data API or Gamma is
 * answered from the cache for 300 s after the same URL was last fetched (`cache-control: public, max-age=300`,
 * measured 2026-09-24), and the CLOB's POST /books is never cached.
 */
function fakeFetch(w: World): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    w.calls.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}`);
    const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname === "/books") {
      const want = JSON.parse(String(init?.body)) as Array<{ token_id: string }>;
      return ok(JSON.stringify(want.filter((x) => w.books[x.token_id]).map((x) => {
        const b = w.books[x.token_id];
        // The venue lists bids ascending and asks descending: the best level is LAST on both sides.
        return {
          asset_id: x.token_id, tick_size: String(b.tick ?? 0.01),
          bids: b.bids.slice().sort((p, q) => p[0] - q[0]).map(([p, s]) => ({ price: String(p), size: String(s) })),
          asks: b.asks.slice().sort((p, q) => q[0] - p[0]).map(([p, s]) => ({ price: String(p), size: String(s) })),
        };
      })));
    }
    const hit = w.cache.get(u.href);
    if (hit && w.now - hit.at < 300_000) return ok(hit.body);
    let body: string;
    if (u.pathname === "/v2/trades") {
      if (w.failPrints) return new Response("upstream", { status: 502 });
      body = JSON.stringify({ data: w.prints.filter((p) => Number(p.timestamp) * 1000 <= w.now).sort((p, q) => Number(q.timestamp) - Number(p.timestamp)), pagination: { next_cursor: "" } });
    } else if (u.pathname === "/markets/keyset") {
      body = JSON.stringify({ markets: u.searchParams.get("closed") === "true" ? w.closed : [] });
    } else return new Response("not found", { status: 404 });
    w.cache.set(u.href, { at: w.now, body });
    return ok(body);
  }) as typeof fetch;
}

function world(): World {
  return { books: { [YES]: { bids: [[0.48, 100], [0.47, 50]], asks: [[0.52, 100], [0.53, 50]] } }, prints: [], closed: [], calls: [], now: 0, cache: new Map() };
}
/** One run at `now`, with the world's clock at the same instant. */
const runAt = (db: ReturnType<typeof memDb>["db"], w: World, now: number, holder: string) => {
  w.now = now;
  return runPmrw({ db, now, holder, pm: { fetchImpl: fakeFetch(w), clock: () => now } });
};

const selRow = (day: string) => ({ day, cond: COND, rank: 1, yes: YES, tick: 0.01, v: 3, min_size: 20, rate: 144, per_dollar_day: 1, capital: 20, q: "a test market", cat: "politics_fees", end_date: null } as Row);
function seedDb(days = ["2026-09-30"]) {
  return memDb({
    agent_locks: [{ name: "pmrw", lease_until: new Date(0).toISOString(), holder: null } as Row, { name: "pmrw-select", lease_until: new Date(0).toISOString(), holder: null } as Row],
    pm_rw_state: [], pm_rw_minutes: [], pm_rw_prints: [], pm_rw_fills: [], pm_rw_days: [], pm_rw_settlements: [],
    pm_rw_selection: days.map(selRow),
  }, { now: () => Date.now() });
}
const sell = (tsSec: number, tx: string) => ({ side: "SELL", token_id: YES, size: 30, price: 0.45, timestamp: tsSec, outcome_index: 0, transaction_hash: tx, proxy_wallet: "0xw" });

Deno.test("the driver records a minute once, decides it two minutes later from its prints, and matches the rule", async () => {
  const { db, tables } = seedDb();
  const w = world();
  // Minute T0 is recorded; a SELL of YES at 0.45 inside it takes our bid (0.49) for 20 of its 30 shares.
  w.prints.push(sell(T0 / 1000 + 30, "0xt1"));
  let r = await runAt(db, w, T0 + 5_000, "h1");
  assertEquals(r.recorded, 1);
  assertEquals(r.phase, "run");
  // The same minute again: the book has moved, but a recorded minute is never rewritten.
  w.books[YES] = { bids: [[0.40, 100]], asks: [[0.60, 100]] };
  r = await runAt(db, w, T0 + 40_000, "h2");
  assertEquals(r.recorded, 0);
  assertEquals(tables.pm_rw_minutes.length, 1);
  assertEquals(Number(tables.pm_rw_minutes[0].bb), 0.48);
  w.books[YES] = { bids: [[0.48, 100], [0.47, 50]], asks: [[0.52, 100], [0.53, 50]] };
  r = await runAt(db, w, T0 + 65_000, "h3");
  assertEquals(r.minutes, 0, "a minute is not decided before it is two minutes old");
  r = await runAt(db, w, T0 + 125_000, "h4");
  assertEquals(r.errors, []);
  assertEquals(r.minutes, 1);
  // The closed form, from the same row through the rule itself.
  const row = summarize([[0.48, 100], [0.47, 50]], [[0.52, 100], [0.53, 50]], 3, 20)!;
  const acc = newAcc();
  const want = stepRw(acc, T0 / 1000, row, 0.01, 3, 144, 20, [{ id: "x", ts: T0 / 1000 + 30, side: "SELL", oi: 0, price: 0.45, size: 30 }]);
  const m0 = tables.pm_rw_minutes.find((x) => x.minute === new Date(T0).toISOString())!;
  assertAlmostEquals(Number(m0.b), want.decision!.b, 1e-12);
  assertAlmostEquals(Number(m0.reward), want.decision!.reward, 1e-12);
  assertEquals(tables.pm_rw_fills.map((f) => [f.side, Number(f.size), Number(f.price)]), [["bid", 20, 0.49]]);
  const st = tables.pm_rw_state[0].state as RwState;
  assertAlmostEquals(st.acc[COND].net, 20, 1e-12);
  assertAlmostEquals(st.acc[COND].cash, acc.cash, 1e-12);
  assertEquals(tables.pm_rw_prints.length, 1);
});

Deno.test("a print read is never answered by CloudFront's copy of an earlier one", async () => {
  // Each minute's print read is the same query; the data API's cache would answer the minute after next with the copy
  // it kept from this minute's read, which cannot hold that minute's prints.
  const { db, tables } = seedDb();
  const w = world();
  for (let k = 0; k <= 2; k++) await runAt(db, w, T0 + k * 60_000 + 5_000, `h${k}`);    // records T0 .. T0+2; decides T0
  w.prints.push(sell(T0 / 1000 + 150, "0xlate"));                                          // inside minute T0+2's window
  for (let k = 3; k <= 4; k++) await runAt(db, w, T0 + k * 60_000 + 5_000, `h${k}`);    // decides T0+1, then T0+2
  assertEquals(tables.pm_rw_fills.map((f) => [f.minute, f.side, Number(f.size)]), [[new Date(T0 + 120_000).toISOString(), "bid", 20]]);
});

Deno.test("the driver closes the UTC day with its totals, and settles a market at its payout", async () => {
  const { db, tables } = seedDb();
  const w = world();
  w.prints.push(sell(T0 / 1000 + 30, "0xt1"));
  for (let k = 0; k <= 5; k++) await runAt(db, w, T0 + k * 60_000 + 5_000, `h${k}`);
  // Minutes 23:57, 23:58 and 23:59 decided, then midnight: the day's row carries the running totals at its end.
  assertEquals(tables.pm_rw_days.map((d) => d.day), ["2026-09-30"]);
  const day = tables.pm_rw_days[0];
  assert(Number(day.reward) > 0);
  assertEquals(Number(day.fills), 1);
  assertEquals(Number(day.markets), 1);
  assertEquals((day.detail as { phase: string }).phase, "run");
  // 10-01 has no selection of its own, so the market quotes nothing; it is held, and its book is still read and marked.
  const after = tables.pm_rw_minutes.filter((m) => String(m.minute) >= "2026-10-01");
  assert(after.length > 0 && after.every((m) => m.quoting === false && m.b == null));
  // Gamma shows the market resolved YES: the 20 shares bought at 0.49 are worth 1 each from then on.
  w.closed = [{ conditionId: COND, clobTokenIds: JSON.stringify([YES, NO]), closed: true, closedTime: "2026-10-01 00:04:00+00", outcomePrices: JSON.stringify(["1", "0"]), question: "q" }];
  const r = await runAt(db, w, T0 + 20 * 60_000, "hz");
  assertEquals(r.settled, 1);
  const st2 = tables.pm_rw_state[0].state as RwState;
  assertEquals(st2.acc[COND].settled, 1);
  assertAlmostEquals(accTotal(st2.acc[COND]), st2.acc[COND].reward + st2.acc[COND].cash + 20, 1e-12);
  assertEquals(tables.pm_rw_settlements.map((s) => [s.cond, Number(s.payout), Number(s.net)]), [[COND, 1, 20]]);
});

Deno.test("the warm-up is closed at its marks, and the fourteen days start flat", async () => {
  const W0 = Date.UTC(2026, 8, 24, 23, 57);
  const { db, tables } = seedDb(["2026-09-24", "2026-09-25"]);
  const w = world();
  w.prints.push(sell(W0 / 1000 + 30, "0xw1"));
  let r = await runAt(db, w, W0 + 5_000, "w0");
  assertEquals(r.phase, "warm-up");
  for (let k = 1; k <= 5; k++) r = await runAt(db, w, W0 + k * 60_000 + 5_000, `w${k}`);
  assertEquals(r.phase, "run");
  const day = tables.pm_rw_days.find((d) => d.day === "2026-09-24")!;
  assertEquals((day.detail as { phase: string }).phase, "warm-up");
  assertEquals(Number(day.fills), 1);
  // Its 20 shares were in its total at the mark; on 09-25 the same market is quoted again, from nothing.
  const st = tables.pm_rw_state[0].state as RwState;
  assertEquals(st.acc[COND].net, 0);
  assertEquals(st.acc[COND].fills, 0);
  assert(st.acc[COND].reward > 0, "09-25's own minutes were quoted");
  assertEquals(st.acc[COND].firstCap, 20 * (0.49 + 1 - 0.51));
});

Deno.test("after the fourteen days' last minute and last day, nothing more is read, decided or selected", async () => {
  const E0 = Date.UTC(2026, 9, 8, 23, 57);
  const { db, tables } = seedDb(["2026-10-08", "2026-10-09"]);
  const w = world();
  for (let k = 0; k <= 4; k++) await runAt(db, w, E0 + k * 60_000 + 5_000, `e${k}`);
  // 10-09 00:01: 23:59 decided and 10-08 closed; no minute of 10-09 was read.
  assertEquals(tables.pm_rw_days.map((d) => d.day), ["2026-10-08"]);
  assertEquals(tables.pm_rw_minutes.filter((m) => String(m.minute) >= "2026-10-09").length, 0);
  assertEquals((tables.pm_rw_state[0].state as RwState).lastDecided, Date.UTC(2026, 9, 8, 23, 59));
  const calls = w.calls.length;
  assertEquals((await runAt(db, w, E0 + 10 * 60_000, "e9")).skipped, "the fourteen days are over");
  assertEquals(w.calls.length, calls);
  assertEquals((await runPmrwSelect({ db, now: Date.UTC(2026, 9, 9, 0, 5), holder: "s" })).skipped, "the fourteen days are over");

  // Down from 23:58 until 00:10: the run that catches up decides up to 23:59 and no further, and closes the day.
  const late = seedDb(["2026-10-08"]);
  await runAt(late.db, w, E0 + 5_000, "l0");
  const r = await runAt(late.db, w, E0 + 13 * 60_000 + 5_000, "l1");
  assertEquals([r.minutes, r.days], [3, 1]);                               // 23:57, 23:58, 23:59
  assertEquals((late.tables.pm_rw_state[0].state as RwState).lastDecided, Date.UTC(2026, 9, 8, 23, 59));
});

Deno.test("no minute is decided without its prints, and a held lease or no selection skips the run", async () => {
  const { db, tables } = seedDb();
  const w = world();
  await runAt(db, w, T0 + 5_000, "a");
  w.failPrints = true;
  const r = await runAt(db, w, T0 + 125_000, "b");
  assert(r.errors.some((e) => e.startsWith("prints")));
  assertEquals((tables.pm_rw_state[0].state as RwState).lastDecided, T0 - 60_000, "the minute stays undecided");
  assertEquals(tables.pm_rw_minutes.filter((m) => m.b != null).length, 0);
  // Someone else holds the lease.
  tables.agent_locks[0].lease_until = new Date(T0 + 10 * 60_000).toISOString();
  tables.agent_locks[0].holder = "other";
  assertEquals((await runAt(db, w, T0 + 185_000, "c")).skipped, "another run holds the pmrw lease");
  // A fresh database with no selection does nothing at all.
  const empty = memDb({ agent_locks: [{ name: "pmrw", lease_until: new Date(0).toISOString(), holder: null } as Row], pm_rw_state: [], pm_rw_selection: [] }, { now: () => Date.now() });
  assertEquals((await runAt(empty.db, w, T0, "d")).skipped, "no selection yet");
});

Deno.test("the selection ranks on the CLOB's tokens, takes only markets Gamma accepts, and is made once a day", async () => {
  const { db, tables } = seedDb(["2026-09-24"]);
  const calls: string[] = [], asked: string[] = [];
  // Five rewarded markets, every book the same, so the ranking is the pools': 0xa $100, 0xb $80 (sponsored), 0xd $60,
  // 0xe $40; 0xc's $5 is under the floor. The CLOB's short list lacks 0xd; Gamma shows 0xb not accepting orders, and
  // lists 0xe's tokens the other way round from the CLOB.
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(u.pathname);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const rw = (c: string, rate: number) => ({ condition_id: c, total_daily_rate: rate, rewards_max_spread: 3, rewards_min_size: 20 });
    if (u.pathname === "/rewards/markets/current") {
      return ok(u.searchParams.get("sponsored") === "false"
        ? { data: [rw("0xa", 100), rw("0xb", 50), rw("0xc", 5), rw("0xd", 60), rw("0xe", 40)], next_cursor: "LTE=" }
        : { data: [rw("0xb", 80)], next_cursor: "LTE=" });
    }
    if (u.pathname === "/sampling-simplified-markets") {
      return ok({ data: ["0xa", "0xb", "0xc", "0xe"].map((c) => ({ condition_id: c, tokens: [{ token_id: `y${c}` }, { token_id: `n${c}` }], accepting_orders: true, closed: false })), next_cursor: "LTE=" });
    }
    if (u.pathname === "/markets/keyset") {
      const ids = u.searchParams.getAll("condition_ids");
      asked.push(...ids);
      return ok({ markets: ids.map((c) => ({
        conditionId: c, clobTokenIds: JSON.stringify(c === "0xe" ? [`n${c}`, `y${c}`] : [`y${c}`, `n${c}`]), enableOrderBook: true,
        acceptingOrders: c !== "0xb", closed: false, orderPriceMinTickSize: 0.01, question: `market ${c}`, endDate: "2026-12-31T00:00:00Z",
      })) });
    }
    if (u.pathname === "/books") {
      const want = JSON.parse(String(init?.body)) as Array<{ token_id: string }>;
      return ok(want.map((x) => ({ asset_id: x.token_id, tick_size: "0.01", bids: [{ price: "0.47", size: "100" }, { price: "0.48", size: "100" }], asks: [{ price: "0.53", size: "100" }, { price: "0.52", size: "100" }] })));
    }
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
  const now = Date.UTC(2026, 8, 25, 0, 0, 20);
  const r = await runPmrwSelect({ db, now, holder: "s", pm: { fetchImpl: f } });
  assertEquals(r.errors, []);
  assertEquals([r.rewarded, r.booked, r.scored, r.checked, r.refused, r.mismatched, r.chosen], [4, 4, 4, 3, 1, 1, 2]);
  // Gamma was asked about the market the short list lacks, then about the three `choose` took — never the whole universe.
  assertEquals(asked.slice().sort(), ["0xa", "0xb", "0xd", "0xe"]);
  const today = tables.pm_rw_selection.filter((s) => s.day === "2026-09-25");
  assertEquals(today.map((s) => [s.cond, s.rank, Number(s.rate), s.yes, s.q]), [["0xa", 1, 100, "y0xa", "market 0xa"], ["0xd", 2, 60, "y0xd", "market 0xd"]]);
  assertAlmostEquals(r.capital, 2 * 20 * (0.49 + 1 - 0.51), 1e-9);
  const n = calls.length;
  assertEquals((await runPmrwSelect({ db, now: now + 5 * 60_000, holder: "s2", pm: { fetchImpl: f } })).skipped, "already selected today");
  assertEquals(calls.length, n, "a selected day reads nothing");
  assertEquals(tables.pm_rw_selection.filter((s) => s.day === "2026-09-25").length, 2);
});

Deno.test("choose over every market, then over what Gamma accepts, is choose over the accepted markets", () => {
  // The lazy check's claim, on random portfolios: dropping the refused markets `choose` took, until it takes none,
  // gives what `choose` would give on the accepted markets alone.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 200; trial++) {
    const all = Array.from({ length: 60 }, (_, i) => ({ cond: `c${i}`, perDollar: rnd(), cap: rnd() < 0.2 ? rnd() * 2 : 10 + rnd() * 20, ok: rnd() < 0.7 }));
    const out = new Set<string>();
    let chosen = choose(all);
    for (;;) {
      const drop = chosen.filter((x) => !x.ok);
      if (!drop.length) break;
      for (const x of drop) out.add(x.cond);
      chosen = choose(all.filter((x) => !out.has(x.cond)));
    }
    assertEquals(chosen.map((x) => x.cond), choose(all.filter((x) => x.ok)).map((x) => x.cond));
  }
});

// ------------------------------------------------------------------------------------------ the public client

Deno.test("the public client reaches only Polymarket's three hosts, and POSTs only to /books", async () => {
  const seen: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(`${init?.method} ${String(input)}`);
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  await pmBooks(["1"], { fetchImpl: f });
  assertEquals(seen, ["POST https://clob.polymarket.com/books"]);
  const trades = { data: [
    { side: "BUY", token_id: "999", size: 2, price: 0.3, timestamp: 200, outcome_index: 1, transaction_hash: "0x1", proxy_wallet: "0xa" },
    { side: "SELL", token_id: "999", size: 1, price: 0.7, timestamp: 150, outcome_index: 0, transaction_hash: "0x2", proxy_wallet: "0xb" },
    { side: "SELL", token_id: "999", size: 1, price: 0.7, timestamp: 90, outcome_index: 0, transaction_hash: "0x3", proxy_wallet: "0xb" },
  ], pagination: { next_cursor: "more" } };
  const g = (async () => new Response(JSON.stringify(trades), { status: 200 })) as typeof fetch;
  const got = await pmPrints("0xc", 100, { fetchImpl: g });
  assertEquals(got.complete, true, "the walk stops at the first page reaching past `since`");
  assertEquals(got.prints.map((p) => [p.ts, p.side, p.oi]), [[150, "SELL", 0], [200, "BUY", 1]]);
  const rw = await pmRewardsCurrent({ fetchImpl: (async (u: string | URL | Request) => new Response(JSON.stringify(String(u).includes("sponsored=false")
    ? { data: [{ condition_id: "0xz", total_daily_rate: 20, rewards_max_spread: 3.5, rewards_min_size: 50 }], next_cursor: "LTE=" }
    : { data: [{ condition_id: "0xz", total_daily_rate: 30, rewards_max_spread: 3.5, rewards_min_size: 50 }], next_cursor: "LTE=" }), { status: 200 })) as typeof fetch });
  assertEquals(rw, [{ cond: "0xz", rate: 30, v: 3.5, minSize: 50 }]);
  // A market settles as rw_test.py settled one: closed, with a payout and a closed time.
  const gm = (closedTime: string | null) => ({ conditionId: "0xm", clobTokenIds: JSON.stringify(["1", "2"]), closed: true, closedTime, outcomePrices: JSON.stringify(["0", "1"]) });
  const h = (async () => new Response(JSON.stringify({ markets: [gm("2026-09-25 10:00:00+00"), { ...gm(null), conditionId: "0xn" }] }), { status: 200 })) as typeof fetch;
  assertEquals((await pmMarkets(["0xm", "0xn"], true, { fetchImpl: h })).map((m) => [m.cond, m.payout]), [["0xm", 0], ["0xn", null]]);
});
