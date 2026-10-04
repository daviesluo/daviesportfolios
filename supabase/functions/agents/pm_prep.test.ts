// "Reward quotes small-pool" (pm_prep.ts; live-prep until 2026-10-02) against the in-memory database held to 0074's, 0076's and 0077's schemas, the
// order path's tables read-only (`onlyTables`), and a fake of Polymarket's public reads (prints, books, Gamma).
//
// What is pinned: which of the path's orders rest after each of its turns (placed by the turn's own clock, ended by the
// turn that cancelled or expired them); RW's quote on the path's row against what the path rested (matched, dark,
// diverged); a hand-worked day of paper fills (prints through and not through, a print on the NO token, a GTD expiry, a
// cancel and re-quote, a divergence, a missing minute), its rewards by RW's formula, its P&L by the path's own
// book-keeping; a settlement; a loss stop and the close-only sells after it; a minute never decided without its prints;
// the replay of RW's golden day, market by market, to rw_test.py's own fills and rewards; and the order path's own
// dry-run, minute for minute, the same with this layer on and off.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/polymarket/results/rw_golden.json" with { type: "json" };
import { newAcc, quote, sizeN, stepRw, summarize, type BookRow } from "./pmrw.ts";
import type { PmLevel } from "../_shared/polymarket_public.ts";
import {
  classify, decideMinute, endedMinute, placedMinute, PREP_DB_TABLES, PREP_LOCK, PREP_READS, PREP_R_BREAK_EVEN, restingAfterTurn, ruleQuote, runPmPrep, twice,
  type PrepOrder, type PrepState,
} from "./pm_prep.ts";
import { onTick, PM_LIVE_DB_TABLES, runPmLive, rwQuotes, type PmBookNow, type PmLiveConfig, type PmMarketRow } from "./pm_live.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const T0 = Date.parse("2026-10-02T10:00:00Z");
const CONFIG: PmLiveConfig & { id: number } = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 320, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, max_markets: 2, select_budget_usd: 40,
};

// ------------------------------------------------------------------ a fake of the public reads

type Print = [ts: number, side: "BUY" | "SELL", oi: number, price: number, size: number];
type Pub = {
  prints: Map<string, Print[]>; books: Map<string, { bids: PmLevel[]; asks: PmLevel[] }>; closed: Map<string, { payout: number; yes: string; no: string }>;
  failPrints: boolean; calls: string[];
};
const newPub = (): Pub => ({ prints: new Map(), books: new Map(), closed: new Map(), failPrints: false, calls: [] });
/** Polymarket's data API, CLOB books and Gamma as `_shared/polymarket_public.ts` reads them, from `pub`. */
function pubFetch(pub: Pub): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    pub.calls.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}`);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (u.host === "data-api.polymarket.com" && u.pathname === "/v2/trades") {
      if (pub.failPrints) return json({ error: "down" }, 503);
      const c = u.searchParams.get("condition") ?? "";
      const rows = (pub.prints.get(c) ?? []).slice().sort((a, b) => b[0] - a[0]).map(([ts, side, oi, price, size], i) => ({
        timestamp: ts, side, outcome_index: oi, price, size, token_id: `${c.slice(-6)}${oi}`, transaction_hash: `0x${c.slice(-8)}${ts}${i}`, proxy_wallet: "0xabc",
      }));
      return json({ data: rows, pagination: { next_cursor: "" } });
    }
    if (u.host === "clob.polymarket.com" && u.pathname === "/books") {
      const want = JSON.parse(String(init?.body ?? "[]")) as Array<{ token_id: string }>;
      const out = want.filter((w) => pub.books.has(w.token_id)).map((w) => {
        const b = pub.books.get(w.token_id)!;
        return { asset_id: w.token_id, tick_size: "0.01", bids: b.bids.map(([p, s]) => ({ price: String(p), size: String(s) })), asks: b.asks.map(([p, s]) => ({ price: String(p), size: String(s) })) };
      });
      return json(out);
    }
    if (u.host === "gamma-api.polymarket.com" && u.pathname === "/markets/keyset") {
      const ids = u.searchParams.getAll("condition_ids");
      const closed = u.searchParams.get("closed") === "true";
      const markets = closed ? ids.filter((c) => pub.closed.has(c)).map((c) => {
        const x = pub.closed.get(c)!;
        return { conditionId: c, clobTokenIds: JSON.stringify([x.yes, x.no]), closed: true, closedTime: "2026-10-02 12:00:00+00", outcomePrices: JSON.stringify([String(x.payout), String(1 - x.payout)]) };
      }) : [];
      return json({ markets });
    }
    return json({ error: `not faked: ${u.href}` }, 404);
  };
}

// ------------------------------------------------------------------ a database with the path's record

type Seed = { minutes?: Row[]; orders?: Row[]; markets?: Row[]; state?: PrepState | null };
function makeDb(s: Seed) {
  const clock = { now: T0 };
  const mem = memDb({
    agent_locks: [{ name: PREP_LOCK, lease_until: iso(0), holder: null }, { name: "pm-live", lease_until: iso(0), holder: null }],
    pm_live_config: [{ ...CONFIG }], pm_live_markets: s.markets ?? [], pm_live_minutes: s.minutes ?? [], pm_live_orders: s.orders ?? [],
    pm_prep_state: s.state ? [{ id: 1, state: s.state, last_minute: null, updated_at: iso(0), last_error: null }] : [],
    pm_prep_minutes: [], pm_prep_prints: [], pm_prep_fills: [], pm_prep_days: [], pm_prep_settlements: [], pm_prep_events: [],
    // RW's and RW-C's tables exist beside it, as in production: this layer must never read them.
    pm_rw_minutes: [{ cond: cond(9), minute: iso(T0) }], pm_rwc_minutes: [{ cond: cond(9), minute: iso(T0) }],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, PREP_DB_TABLES, { lease: PREP_LOCK, readOnly: PREP_READS });
  return { clock, mem, db };
}
/** A state that starts deciding at minute `from` (its day's start the day of `from`). */
const startAt = (from: number): PrepState => ({
  version: 1, startedAt: iso(from), lastDecided: from - M, dayOf: Math.floor(from / DAY) * DAY, statusAt: 0, acc: {}, tokens: {}, marks: {},
  stopDay: null, stopTotal: null, day: { reward: 0, fills: 0, matched: 0, dark: 0, diverged: 0, missing: 0, markets: [] }, pnl: null,
});
const liveMinute = (t: number, c: string, row: BookRow | null, o: Partial<Row> = {}): Row => ({
  mode: "dry_run", minute: iso(t), cond: c, rate: 8, max_spread: 4.5, min_size: 5, tick: 0.01,
  bb: row?.[0] ?? null, ba: row?.[1] ?? null, ab: row?.[2] ?? null, aa: row?.[3] ?? null, q1: row?.[4] ?? null, q2: row?.[5] ?? null,
  bid_price: null, bid_size: null, ask_price: null, ask_size: null, bid_scoring: null, ask_scoring: null, ours: 0, others: 0, formula_usd: 0, pct: null, detail: {}, ...o,
});
let orderId = 1;
/** A dry-run order as the path writes it: placed by the turn of minute `placed` (its clock 1.5 s in), ended by the turn of `ended`. */
const order = (c: string, outcome: "yes" | "no", price: number, size: number, placed: number, ended: number | null, o: Partial<Row> = {}): Row => ({
  id: orderId++, ts: iso(placed + 2500), mode: "dry_run", cond: c, token: outcome === "yes" ? `${c}-Y` : `${c}-N`, outcome, side: "BUY", price, size, order_type: "GTD",
  post_only: true, expiration: Math.floor(placed / 1000) + 660, neg_risk: false, hash: `0x${String(orderId).padStart(64, "0")}`, state: ended === null ? "live" : "cancelled",
  size_matched: 0, gate: "open", reason: "new", book_seen: { minSize: 5 }, request: { timestamp: String(placed + 1500) }, response: { dryRun: true },
  cancel_requested_at: ended === null ? null : iso(ended + 1200), cancel_gate: ended === null ? null : "reprice", cancel_reason: null, filled_at: null,
  cancelled_at: ended === null ? null : iso(ended + 1200), updated_at: iso(placed), ...o,
});
const marketRow = (c: string, o: Partial<Row> = {}): Row => ({
  day: "2026-10-02", kind: "standard", cond: c, yes_token: `${c}-Y`, no_token: `${c}-N`, neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 8, rank: 1, question: null,
  detail: {}, selected_at: iso(T0 - 10 * 3600e3), max_spread: 4.5, n_size: 5, per_dollar_day: null, capital: null, formula_day: null, end_date: null, game_start: null, ...o,
});
/** RW's reward line, by hand: rate/1440 × ours/(ours + others), ours the smaller side's score × N. */
const rwReward = (rate: number, v: number, distCents: number, N: number, q1: number, q2: number, m: number) => {
  const s = ((v - distCents) / v) ** 2 * N;
  const others = 0.1 <= m && m <= 0.9 ? Math.max(Math.min(q1, q2), (q1 + q2) / 3) : Math.min(q1, q2);
  return rate / 1440 * s / (s + others);
};

// ------------------------------------------------------------------ the pure rules

Deno.test("an order rests from the turn that placed it (its signed clock) until the turn that ended it; open ones rest on", () => {
  const c = cond(1);
  const o = order(c, "yes", 0.45, 5, T0, T0 + 3 * M) as unknown as PrepOrder;
  assertEquals([placedMinute(o), endedMinute(o)], [T0, T0 + 3 * M]);
  assertEquals([T0 - M, T0, T0 + 2 * M, T0 + 3 * M].map((t) => restingAfterTurn([o], c, t).length), [0, 1, 1, 0]);
  const open = order(c, "no", 0.53, 5, T0 + M, null) as unknown as PrepOrder;
  assertEquals([endedMinute(open), restingAfterTurn([open], c, T0 + 99 * M).length, restingAfterTurn([open], cond(2), T0 + 2 * M).length], [null, 1, 0]);
  // No signed clock: the row's own time. An expired row ends with the turn that noticed it.
  assertEquals(placedMinute({ request: null, ts: iso(T0 + 59e3) }), T0);
  assertEquals(endedMinute({ state: "expired", cancelled_at: iso(T0 + 5 * M + 9e3), request: null, ts: iso(T0) }), T0 + 5 * M);
});

Deno.test("RW's quote on the path's row is the order path's own rwQuotes, price and size, on every recorded book of RW's golden day", () => {
  const G = golden as unknown as { raw_books: Array<{ cond: string; v: number; min_size: number; book: { b: PmLevel[]; a: PmLevel[] } | null }> };
  let n = 0;
  for (const g of G.raw_books.filter((x) => x.book && x.book.b.length && x.book.a.length)) {
    const levels = { bids: g.book!.b, asks: g.book!.a };
    const book: PmBookNow = { bestBid: levels.bids[0][0], bestAsk: levels.asks[0][0], tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels };
    const market = { day: "2026-10-02", kind: "standard", cond: g.cond, yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: g.min_size, reward_rate: 8, rank: 1, question: null, max_spread: g.v } as PmMarketRow;
    const intents = rwQuotes({ market, book, held: { yes: 0, no: 0 }, own: [] });
    const rq = ruleQuote(summarize(levels.bids, levels.asks, g.v, g.min_size), 0.01, g.v, g.min_size);
    if (!intents.length) { assertEquals(rq, null, g.cond); continue; }
    n++;
    assertEquals([intents[0].price, intents[0].size, Math.round((1 - intents[1].price) * 1e9) / 1e9, intents[1].size], [rq!.b, rq!.n, rq!.a, rq!.n], g.cond);
  }
  assert(n >= 40, `${n} books`);
  assertEquals(ruleQuote([0.45, 0.47, 0.45, 0.47, 10, 10], 0.01, 0, 5), null);                // no reward programme: the rule quotes nothing
});

Deno.test("classify: exactly RW's quote is matched; nothing is dark; one side, another price or another size is diverged", () => {
  const c = cond(1);
  const rule = { b: 0.45, a: 0.47, n: 5 };
  const bid = order(c, "yes", 0.45, 5, T0, null) as unknown as PrepOrder, ask = order(c, "no", 0.53, 5, T0, null) as unknown as PrepOrder;
  assertEquals(classify([bid, ask], rule).cls, "matched");
  assertEquals(classify([], rule).cls, "dark");
  assertEquals(classify([], null).cls, "dark");
  assertEquals(classify([bid], rule).cls, "diverged");
  assertEquals(classify([bid, { ...ask, price: 0.52 }], rule).cls, "diverged");
  assertEquals(classify([bid, { ...ask, size: 6 }], rule).cls, "diverged");
  assertEquals(classify([bid, ask], null).cls, "diverged");
  assert(String(classify([bid], rule).why).includes("1 bid(s) and 0 ask(s)"));
});

// ------------------------------------------------------------------ a hand-worked day

/**
 * One market at tick 0.01, N 5, $8 a day, max spread 4.5 ¢, the others' scores 10 and 10. The path's record:
 *   t0–t2  row 0.45/0.47: it rests BUY YES 0.45 × 5 and BUY NO 0.53 × 5 (an ask at 0.47): RW's quote. matched.
 *   t3     its orders expire at its turn and it rests nothing (dark).
 *   t4     row 0.46/0.48: it rests BUY YES 0.46 and BUY NO 0.52 (0.48). matched, at the new prices.
 *   t5     its ask is cancelled and the bid rests alone: diverged.
 *   t6     no row at all (its turn did not run): missing.
 * The prints: t0 a SELL of YES at 0.44 × 3 (through the bid: 3 at 0.45) and one at 0.45 × 2 (AT the bid: not through);
 * t1 a BUY of NO at 0.56 × 4 (a SELL of YES at 0.44: 4 at 0.45); t2 a BUY of YES at 0.48 × 6 (through the ask: 5, N, at
 * 0.47); t3 a SELL at 0.40 (nothing rests); t4 a SELL at 0.455 × 2 (through the new bid of 0.46, not the old 0.45: 2
 * at 0.46); t5 and t6 SELLs at 0.30 (no bid of RW's rests). By hand: YES 9 held at 4.07, NO 5 at 2.65, marked at the
 * last row's mid 0.47 (NO at 0.53): 9 × 0.47 − 4.07 + 5 × 0.53 − 2.65 = 0.16. Four matched minutes, each one tick
 * from its mid (1 ¢ of 4.5): RW's reward line four times.
 */
function handDay() {
  const c = cond(1);
  const r1: BookRow = [0.45, 0.47, 0.45, 0.47, 10, 10], r2: BookRow = [0.46, 0.48, 0.46, 0.48, 10, 10];
  const t = (k: number) => T0 + k * M;
  const minutes = [liveMinute(t(0), c, r1), liveMinute(t(1), c, r1), liveMinute(t(2), c, r1), liveMinute(t(3), c, r1), liveMinute(t(4), c, r2), liveMinute(t(5), c, r2)];
  const orders = [
    order(c, "yes", 0.45, 5, t(0), t(3), { state: "expired", cancel_gate: null }), order(c, "no", 0.53, 5, t(0), t(3), { state: "expired", cancel_gate: null }),
    order(c, "yes", 0.46, 5, t(4), t(6)), order(c, "no", 0.52, 5, t(4), t(5)),
  ];
  const pub = newPub();
  const s = (k: number, sec: number) => Math.floor(t(k) / 1000) + sec;
  pub.prints.set(c, [
    [s(0, 10), "SELL", 0, 0.44, 3], [s(0, 20), "SELL", 0, 0.45, 2], [s(1, 15), "BUY", 1, 0.56, 4], [s(2, 30), "BUY", 0, 0.48, 6],
    [s(3, 30), "SELL", 0, 0.40, 5], [s(4, 30), "SELL", 0, 0.455, 2], [s(5, 30), "SELL", 0, 0.30, 5], [s(6, 30), "SELL", 0, 0.30, 5],
  ]);
  const w = makeDb({ minutes, orders, markets: [marketRow(c)], state: startAt(t(0)) });
  return { c, t, pub, ...w };
}

Deno.test("a hand-worked day: the path's own orders filled by RW's rule, minute by minute, and booked as the path books its fills", async () => {
  const h = handDay();
  const r = await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(h.pub) } });
  assertEquals(r.errors, []);
  // Two minutes behind: the run decides up to t6, never t7 or t8.
  assertEquals([r.from, r.to, r.minutes], [iso(h.t(0)), iso(h.t(6)), 7]);
  const mins = (h.mem.tables.pm_prep_minutes as Row[]).sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  assertEquals(mins.map((m) => [String(m.minute).slice(11, 16), m.class, m.fills]), [
    ["10:00", "matched", 1], ["10:01", "matched", 1], ["10:02", "matched", 1], ["10:03", "dark", 0], ["10:04", "matched", 1], ["10:05", "diverged", 0],
  ]);
  assertEquals([r.matched, r.dark, r.diverged, r.missing], [4, 1, 1, 1]);
  const fills = (h.mem.tables.pm_prep_fills as Row[]).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  assertEquals(fills.map((f) => [f.side, Number(Number(f.price).toFixed(4)), f.size, f.token, f.token_side, f.token_price, f.close_only]), [
    ["bid", 0.45, 3, `${h.c}-Y`, "BUY", 0.45, false],
    ["bid", 0.45, 4, `${h.c}-Y`, "BUY", 0.45, false],                 // a BUY of NO at 0.56 is a SELL of YES at 0.44
    ["ask", 0.47, 5, `${h.c}-N`, "BUY", 0.53, false],                 // N at most, of the 6 through it
    ["bid", 0.46, 2, `${h.c}-Y`, "BUY", 0.46, false],                 // the re-quoted bid: 0.455 is not through the old 0.45
  ]);
  const st = (h.mem.tables.pm_prep_state as Row[])[0].state as PrepState;
  assertEquals(st.acc[h.c].net, 4);                                    // stepRw's inventory: YES 9 less NO 5
  assertAlmostEquals(st.pnl!.total, 0.16, 1e-9);
  assertAlmostEquals(st.pnl!.day, 0.16, 1e-9);
  const reward = 4 * rwReward(8, 4.5, 1, 5, 10, 10, 0.46);
  assertAlmostEquals(r.reward, reward, 1e-12);
  assertAlmostEquals(st.day.reward, reward, 1e-12);
  assert(mins.filter((m) => m.class !== "matched").every((m) => Number(m.reward) === 0));
  assertEquals(String((mins[5].detail as Record<string, unknown>).why).includes("1 bid(s) and 0 ask(s)"), true);
  // The prints that decided it are kept, and nothing of the path's or RW's was written or read.
  assertEquals((h.mem.tables.pm_prep_prints as Row[]).length, 8);
  assertEquals([...h.db.touched].filter((x) => !x.startsWith("pm_prep_") && !(PREP_READS as readonly string[]).includes(x) && x !== "agent_locks"), []);
  assertEquals(st.lastDecided, h.t(6));
  // The next run decides from t7 on; with nothing new it writes no fill.
  const r2 = await runPmPrep({ db: h.db, now: h.t(9) + 30e3, holder: "b", pm: { fetchImpl: pubFetch(h.pub) } });
  assertEquals([r2.from, r2.to, r2.fills], [iso(h.t(7)), iso(h.t(7)), 0]);
});

Deno.test("the reward of a matched minute is the path's own formula of the quotes it rested, with them in the book (detail.after); a minute recorded before the path kept it is paid RW's line; dark and diverged nothing", async () => {
  const h = handDay();
  // The path's record of each minute carries what rested after its turn, scored as the venue would hold it.
  const after = [0.0011, 0.0012, 0.0013, 0.9, 0.0014, 0.8];
  const mins0 = (h.mem.tables.pm_live_minutes as Row[]).sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  mins0.forEach((m, i) => { m.detail = { m: 0.46, mRw: 0.46, after: { formula: after[i], ours: 1, others: 1, m: 0.46, orders: 2 } }; });
  // The fourth matched minute (t4) keeps its old shape: recorded before the path kept `after`.
  mins0[4].detail = {};
  const r = await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(h.pub) } });
  assertEquals(r.errors, []);
  const mins = (h.mem.tables.pm_prep_minutes as Row[]).sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  assertEquals(mins.map((m) => [m.class, (m.detail as Record<string, unknown>).paid ?? null]), [
    ["matched", "venue"], ["matched", "venue"], ["matched", "venue"], ["dark", null], ["matched", "rw"], ["diverged", null],
  ]);
  const line = rwReward(8, 4.5, 1, 5, 10, 10, 0.46);
  const paid = mins.map((m) => Number(m.reward));
  assertEquals([paid[0], paid[1], paid[2], paid[3], paid[5]], [0.0011, 0.0012, 0.0013, 0, 0]);
  assertAlmostEquals(paid[4], line, 1e-15);
  // RW's own line is kept beside what was paid.
  for (const i of [0, 1, 2, 4]) assertAlmostEquals(Number((mins[i].detail as Record<string, unknown>).rw), line, 1e-12);
  const st = (h.mem.tables.pm_prep_state as Row[])[0].state as PrepState;
  assertAlmostEquals(st.day.reward, 0.0011 + 0.0012 + 0.0013 + line, 1e-12);
  assertAlmostEquals(st.acc[h.c].reward, st.day.reward, 1e-12);                            // the account's line is the same figure
  assertAlmostEquals(r.reward, st.day.reward, 1e-12);
  // The fills and the inventory are stepRw's, as before: the same as the hand-worked day's.
  assertEquals(st.acc[h.c].net, 4);
  assertEquals((h.mem.tables.pm_prep_fills as Row[]).length, 4);
});

Deno.test("decideMinute: a side the paper's inventory stops earns nothing, whatever the path's formula of both its quotes; with both quoted, the account's reward is the path's figure", () => {
  const row: BookRow = [0.45, 0.47, 0.45, 0.47, 10, 10];
  const bid = { id: 1, ts: iso(T0), cond: cond(1), token: "Y", outcome: "yes", side: "BUY", price: 0.45, size: 5, state: "live", cancelled_at: null, request: null, book_seen: null } as PrepOrder;
  const ask = { ...bid, id: 2, token: "N", outcome: "no", price: 0.53 } as PrepOrder;
  const base = { t: T0, row, tick: 0.01, v: 4.5, rate: 8, minSize: 5, venueMin: 5, bid, ask, tokens: { yes: "Y", no: "N" }, held: { yes: 0, no: 0 }, stopped: false, prints: [] };
  const a1 = newAcc();
  const both = decideMinute({ ...base, acc: a1, venueReward: 0.004 });
  assertEquals([both.reward, both.qb, both.qa], [0.004, true, true]);
  assertAlmostEquals(both.rwReward, rwReward(8, 4.5, 1, 5, 10, 10, 0.46), 1e-12);
  assertAlmostEquals(a1.reward, 0.004, 1e-12);
  const a2 = newAcc();
  a2.net = 15;                                                                                 // 3N its way: the bid stops
  const one = decideMinute({ ...base, acc: a2, venueReward: 0.004 });
  assertEquals([one.reward, one.rwReward, one.qb, one.qa, a2.reward], [0, 0, false, true, 0]);
  const a3 = newAcc();
  const old = decideMinute({ ...base, acc: a3 });                                              // no figure: RW's line, as before
  assertEquals([old.reward, a3.reward], [old.rwReward, old.rwReward]);
  assert(old.reward > 0);
});

Deno.test("a minute is never decided without its prints: a failed read decides nothing, and the next run decides from the same place", async () => {
  const h = handDay();
  h.pub.failPrints = true;
  const r = await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(h.pub) } });
  assert(r.errors.some((e) => e.startsWith("prints ")), r.errors.join(" | "));
  assertEquals([r.minutes, (h.mem.tables.pm_prep_fills as Row[]).length, (h.mem.tables.pm_prep_minutes as Row[]).length], [0, 0, 0]);
  assertEquals(((h.mem.tables.pm_prep_state as Row[])[0].state as PrepState).lastDecided, h.t(-1));
  h.pub.failPrints = false;
  const r2 = await runPmPrep({ db: h.db, now: h.t(8) + 31e3, holder: "b", pm: { fetchImpl: pubFetch(h.pub) } });
  assertEquals([r2.from, r2.fills], [iso(h.t(0)), 4]);
});

Deno.test("a public read that fails once is made again at once: one dropped request is no fault; two are", async () => {
  const h = handDay();
  let drops = 1;
  const flaky: typeof fetch = (input, init) => {
    if (String(input).includes("data-api.polymarket.com") && drops > 0) { drops--; return Promise.resolve(new Response('{"error":"bad gateway"}', { status: 502 })); }
    return pubFetch(h.pub)(input, init);
  };
  const r = await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: flaky } });
  assertEquals([r.errors, r.fills, r.from], [[], 4, iso(h.t(0))]);
  let n = 0;
  assertEquals(await twice(() => (++n === 1 ? Promise.reject(new Error("once")) : Promise.resolve(n))), 2);
  let m = 0;
  const err = await twice(() => { m++; return Promise.reject(new Error(`no ${m}`)); }).catch((e) => String(e));
  assertEquals([err, m], ["Error: no 2", 2]);
});

Deno.test("a held market Gamma shows resolved is settled at its payout, as the path settles its own: everything held sold at the payout", async () => {
  const h = handDay();
  await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(h.pub) } });
  h.pub.closed.set(h.c, { payout: 1, yes: `${h.c}-Y`, no: `${h.c}-N` });
  const r = await runPmPrep({ db: h.db, now: h.t(20) + 30e3, holder: "b", pm: { fetchImpl: pubFetch(h.pub) } });
  assertEquals(r.settled, 1);
  assertEquals((h.mem.tables.pm_prep_settlements as Row[]).map((s) => [s.cond, s.payout]), [[h.c, 1]]);
  // The run after it books the settlement: YES 9 paid 1 against 4.07, NO 5 paid 0 against 2.65.
  await runPmPrep({ db: h.db, now: h.t(21) + 30e3, holder: "c", pm: { fetchImpl: pubFetch(h.pub) } });
  const st = (h.mem.tables.pm_prep_state as Row[])[0].state as PrepState;
  assertAlmostEquals(st.pnl!.total, 9 - 4.07 - 2.65, 1e-9);
  assertEquals(st.acc[h.c].settled, 1);
  assertEquals((h.mem.tables.pm_prep_events as Row[]).map((e) => e.kind), ["settlement"]);
});

/**
 * The loss stop, by hand. N 20 at 0.45 / 0.47 (BUY YES 0.45, BUY NO 0.53). t0–t2: a SELL of YES at 0.44 × 20 each minute
 * fills the bid 20 each: YES 60 at 0.45 (27.00), RW's 3N. t3: the book falls to 0.01/0.03 (the path re-prices to BUY YES
 * 0.01 and BUY NO 0.97); at its mid 0.02 the 60 are worth 1.20: −25.80, past the −$25 day stop, which trips at t3.
 * t4: close-only. The bid would add (and 60 is 3N anyway); the ask, a BUY of NO at 0.97, becomes the path's SELL of YES
 * at 0.03 × 20 (`closeOnly`): a BUY of YES at 0.04 × 30 fills 20 at 0.03 (−8.40 realised), and a SELL at 0.005 finds no
 * bid. After it: YES 40 at 0.45 marked at 0.02 (−17.20) and −8.40: −25.60.
 */
Deno.test("the path's day stop acts on paper as it acts live: it trips on the paper's own P&L, and from the next minute only closeOnly's sells rest", async () => {
  const c = cond(2);
  const t = (k: number) => T0 + k * M, s = (k: number, sec: number) => Math.floor(t(k) / 1000) + sec;
  const hi: BookRow = [0.45, 0.47, 0.45, 0.47, 40, 40], lo: BookRow = [0.01, 0.03, 0.01, 0.03, 40, 40];
  const minutes = [0, 1, 2].map((k) => liveMinute(t(k), c, hi, { min_size: 20 })).concat([3, 4].map((k) => liveMinute(t(k), c, lo, { min_size: 20 })));
  const orders = [order(c, "yes", 0.45, 20, t(0), t(3)), order(c, "no", 0.53, 20, t(0), t(3)), order(c, "yes", 0.01, 20, t(3), null), order(c, "no", 0.97, 20, t(3), null)];
  const pub = newPub();
  pub.prints.set(c, [[s(0, 5), "SELL", 0, 0.44, 20], [s(1, 5), "SELL", 0, 0.44, 20], [s(2, 5), "SELL", 0, 0.44, 20], [s(4, 10), "BUY", 0, 0.04, 30], [s(4, 20), "SELL", 0, 0.005, 10]]);
  const w = makeDb({ minutes, orders, markets: [marketRow(c, { min_size: 20, n_size: 20 })], state: startAt(t(0)) });
  const r = await runPmPrep({ db: w.db, now: t(6) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(pub) } });
  assertEquals(r.errors, []);
  assertEquals(r.stops.length, 1);
  const ev = (w.mem.tables.pm_prep_events as Row[]);
  assertEquals(ev.map((e) => [e.kind, e.minute]), [["loss_stop_day", iso(t(3))]]);
  assertAlmostEquals(Number((ev[0].detail as Record<string, number>).dayPnl), -25.8, 1e-9);
  const mins = (w.mem.tables.pm_prep_minutes as Row[]).sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  assertEquals(mins.map((m) => [m.class, m.qb, m.qa, m.close_only, m.fills]), [
    ["matched", true, true, false, 1], ["matched", true, true, false, 1], ["matched", true, true, false, 1],
    ["matched", false, true, false, 0],                                // 3N held: the bid is not quoted (RW's rule), before the stop
    ["matched", false, true, true, 1],                                 // close-only: the SELL of YES alone
  ]);
  const fills = (w.mem.tables.pm_prep_fills as Row[]).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  assertEquals(fills.at(-1)!.token_side, "SELL");
  assertEquals([fills.at(-1)!.token, fills.at(-1)!.token_price, fills.at(-1)!.size, fills.at(-1)!.close_only], [`${c}-Y`, 0.03, 20, true]);
  const st = (w.mem.tables.pm_prep_state as Row[])[0].state as PrepState;
  assertAlmostEquals(st.pnl!.day, -25.6, 1e-9);
  assertEquals([st.acc[c].net, st.stopDay, st.stopTotal], [40, "2026-10-02", null]);
  assertEquals(mins.every((m) => m.class !== "matched" || !m.close_only || Number(m.reward) === 0), true);
});

Deno.test("each UTC day closes with its row: rewards at the formula and at R = 0.40, the path's P&L of its fills, minutes by class", async () => {
  const h = handDay();
  await runPmPrep({ db: h.db, now: h.t(8) + 30e3, holder: "a", pm: { fetchImpl: pubFetch(h.pub) } });
  // The day ends with nothing more recorded; the runs past its end (240 minutes a run, as a catch-up goes) close it.
  const end = Date.parse("2026-10-03T00:00:00Z");
  for (let k = 0; k < 10 && !(h.mem.tables.pm_prep_days as Row[]).length; k++) {
    const r = await runPmPrep({ db: h.db, now: end + 2 * M + 30e3 + k * 1e3, holder: `b${k}`, pm: { fetchImpl: pubFetch(h.pub) } });
    assertEquals(r.errors, []);
  }
  const day = (h.mem.tables.pm_prep_days as Row[])[0];
  const reward = 4 * rwReward(8, 4.5, 1, 5, 10, 10, 0.46);
  assertEquals([day.day, day.fills, day.minutes_matched, day.minutes_dark, day.minutes_diverged, day.markets, day.stop_day, day.stop_total], ["2026-10-02", 4, 4, 1, 1, 1, false, false]);
  assertAlmostEquals(Number(day.reward), reward, 1e-6);
  assertAlmostEquals(Number(day.reward_r40), reward * PREP_R_BREAK_EVEN, 1e-6);
  assertAlmostEquals(Number(day.fills_pnl_day), 0.16, 1e-6);
  assertAlmostEquals(Number(day.pnl_day_r40), 0.16 + reward * PREP_R_BREAK_EVEN, 1e-6);
  assertAlmostEquals(Number(day.held_value), 9 * 0.47 + 5 * 0.53, 1e-6);
  // Every minute from t6 to the day's end had no row of the path's: missing.
  assertEquals(day.minutes_missing, (end - h.t(6)) / M);
});

// ------------------------------------------------------------------ RW's golden day, through this layer

type GMarket = { rate: number; v: number; min_size: number; tick: number | null; series: Array<[number, BookRow | null]>; prints: Print[] };
const G = golden as unknown as { markets: Record<string, GMarket>; expect: Record<string, Record<string, number | boolean | null>> };

Deno.test("the replay of RW's golden day: the path resting RW's quote each minute, this layer fills every golden market exactly as rw_test.py did", async () => {
  let checked = 0, full = 0, stopped = 0;
  for (const [c, mk] of Object.entries(G.markets)) {
    const tick = mk.tick || 0.01, N = sizeN(mk.min_size), want = G.expect[c];
    // The path's record of the day, as its dry-run writes it: each minute's row, and RW's quote resting from the turn
    // that first quoted it until the turn whose quote differs.
    const minutes: Row[] = [], orders: Row[] = [];
    let cur: { b: number; a: number; at: number; ids: number[] } | null = null;
    const close = (at: number) => { if (!cur) return; for (const o of orders.filter((x) => cur!.ids.includes(Number(x.id)))) Object.assign(o, { state: "cancelled", cancelled_at: iso(at + 1200) }); cur = null; };
    for (const [sec, row] of mk.series) {
      const t = sec * 1000;
      minutes.push(liveMinute(t, c, row, { rate: Math.min(mk.rate, 9.99), max_spread: mk.v, min_size: mk.min_size, tick }));
      const q = row ? quote(row, tick) : null;
      const tk = tick === 0.001 ? "0.001" : "0.01";
      const b = q ? onTick(q.b, tk) : null, a = q ? onTick(q.a, tk) : null;
      if (cur && (b === null || cur.b !== b || cur.a !== a)) close(t);
      if (b !== null && a !== null && !cur) {
        const ob = order(c, "yes", b, N, t, null), oa = order(c, "no", onTick(1 - a, tk), N, t, null);
        orders.push(ob, oa);
        cur = { b, a, at: t, ids: [Number(ob.id), Number(oa.id)] };
      }
    }
    const first = mk.series[0][0] * 1000, last = mk.series.at(-1)![0] * 1000;
    const pub = newPub();
    pub.prints.set(c, mk.prints);
    const w = makeDb({ minutes, orders, markets: [marketRow(c, { day: iso(first).slice(0, 10) })], state: startAt(first) });
    // RW's rate is $10 and more: the path's record is seeded as is (its CHECK would refuse it), and the formula is
    // compared on the rate the record carries. Runs of 240 minutes, as a catch-up goes.
    let reward = 0, fills = 0;
    for (let now = first + 2 * M + 30e3; ; now += 240 * M) {
      const r = await runPmPrep({ db: w.db, now: Math.min(now, last + 2 * M + 30e3), holder: `h${now}`, pm: { fetchImpl: pubFetch(pub) } });
      assertEquals(r.errors, [], c);
      reward += r.reward; fills += r.fills;
      if (now >= last + 2 * M) break;
    }
    const st = (w.mem.tables.pm_prep_state as Row[])[0].state as PrepState;
    const got = (w.mem.tables.pm_prep_fills as Row[]).map((f) => [Date.parse(String(f.minute)) / 1000, f.side, Number(Number(f.price).toFixed(6)), Number(f.size)])
      .sort((x, y) => (x[0] as number) - (y[0] as number));
    assertEquals((w.mem.tables.pm_prep_minutes as Row[]).every((m) => m.class !== "diverged"), true, c);
    // RW's own run of the market (rw_test.py's run_market through stepRw, as pmrw.test.ts replays it), fill by fill.
    const acc = newAcc(), ref: Array<[number, string, number, number]> = [];
    const prints = mk.prints.map(([ts, side, oi, price, size], i) => ({ id: String(i), ts, side, oi, price, size }));
    for (const [sec, row] of mk.series) for (const f of stepRw(acc, sec, row, tick, mk.v, Math.min(mk.rate, 9.99), N, prints).fills) ref.push([sec, f.side, Number(f.price.toFixed(6)), f.size]);
    const stop = st.stopDay !== null || st.stopTotal !== null ? Date.parse(String((w.mem.tables.pm_prep_events as Row[]).find((e) => String(e.kind).startsWith("loss_stop"))!.minute)) / 1000 : null;
    if (stop === null) {
      // The whole day: rw_test.py's own numbers.
      assertEquals(fills, want.fills, `${c} fills`);
      assertEquals(got, ref, `${c} fill by fill`);
      assertAlmostEquals(got.reduce((s, f) => s + (f[3] as number), 0), Number(want.fill_shares), 1e-6, `${c} fill shares`);
      assertAlmostEquals(st.acc[c]?.net ?? 0, Number(want.net_end), 1e-6, `${c} net`);
      // The reward, at the rate the record carries (RW's own, held under $10 by the path's table): RW's line scales with it.
      assertAlmostEquals(reward, Number(want.reward) * Math.min(mk.rate, 9.99) / mk.rate, 1e-6, `${c} reward`);
      full++;
    } else {
      // The path's stop tripped on this market's paper P&L: every fill up to the minute it tripped is RW's own.
      assertEquals(got.filter((f) => (f[0] as number) <= stop), ref.filter((f) => f[0] <= stop), `${c} fills up to its stop`);
      stopped++;
    }
    checked++;
  }
  assert(checked >= 15 && full >= 12, `${checked} golden markets, ${full} whole, ${stopped} to their stop`);
});

// ------------------------------------------------------------------ the order path, with this layer on and off

Deno.test("the order path's dry-run is the same, minute for minute, with this layer running beside it and without it", async () => {
  const run = async (prep: boolean) => {
    const clock = { now: T0 + 30e3 };
    const pm = new FakePolymarket(() => clock.now);
    const add = (n: number, x: Record<string, unknown>) => pm.addMarket({ cond: cond(n), yes: `${7000 + n * 2}`, no: `${7001 + n * 2}`, depth: [[0, 5]], ...x });
    const A = add(5, { rate: 8, bid: 0.45, ask: 0.47, minSize: 5 });
    add(6, { rate: 7, negRisk: true, bid: 0.20, ask: 0.23, tick: "0.001", minSize: 20, depth: [[0, 20]] });
    const mem = memDb({
      agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }, { name: PREP_LOCK, lease_until: iso(0), holder: null }],
      agent_risk: [{ id: 1, global_pause: false }],
      pm_live_config: [{ ...CONFIG, gtd_lifetime_s: 300 }], pm_live_markets: [], pm_live_orders: [], pm_live_fills: [], pm_live_events: [], pm_live_state: [],
      pm_live_minutes: [], pm_live_reward_days: [], pm_live_settlements: [],
      pm_prep_state: [], pm_prep_minutes: [], pm_prep_prints: [], pm_prep_fills: [], pm_prep_days: [], pm_prep_settlements: [], pm_prep_events: [],
    }, { now: () => clock.now });
    const liveDb = onlyTables(mem.db, PM_LIVE_DB_TABLES, { lease: "pm-live", readOnly: ["agent_risk"] });
    const prepDb = onlyTables(mem.db, PREP_DB_TABLES, { lease: PREP_LOCK, readOnly: PREP_READS });
    const pub = newPub();
    // Prints through RW's bid of A each minute, so the paper layer fills and books.
    pub.prints.set(cond(5), Array.from({ length: 40 }, (_, k) => [Math.floor((T0 + k * M) / 1000) + 20, "SELL", 0, 0.40, 2] as Print));
    let salt = 1, prepFills = 0;
    const key = new PmOrderKey(PM_TEST_KEY);
    for (let k = 0; k < 40; k++) {
      clock.now = T0 + k * M + 30e3;
      if (k % 7 === 3) A.bid = A.bid === 0.45 ? 0.44 : 0.45;                     // the path re-prices now and then
      await runPmLive({
        db: liveDb, now: clock.now, holder: `h${k}`, venue: pm.venue(), sbRegion: "eu-west-1", sendsEnabled: true,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: key, salt: () => String(salt++), pause: () => Promise.resolve(), clock: () => clock.now,
      });
      if (prep) {
        if (k === 0) await mem.db.upsert("pm_prep_state", [{ id: 1, state: startAt(T0), last_minute: null, updated_at: iso(T0), last_error: null }], "id");
        const r = await runPmPrep({ db: prepDb, now: clock.now + 5e3, holder: `p${k}`, pm: { fetchImpl: pubFetch(pub) } });
        assertEquals(r.errors, []);
        prepFills += r.fills;
      }
    }
    const live = Object.fromEntries(Object.entries(mem.tables).filter(([t]) => t.startsWith("pm_live_")));
    return { live: JSON.stringify(live), prepFills, venueCalls: pm.calls.length };
  };
  const off = await run(false), on = await run(true);
  assert(on.prepFills > 0, "the layer ran and filled");
  assertEquals(on.live, off.live);
  assertEquals(on.venueCalls, off.venueCalls);
});
