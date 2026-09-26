// The Agents page's view of RW's paper test (pmrw_view.ts): the split of fill P&L by average cost must sum to the
// engine's own figure, the day's change is measured from the day before in the same phase, and the list is today's
// portfolio first, then what is only held.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accTotal, newAcc, RW_RUN_START, stepRw, summarize, type Acc, type RwState } from "./pmrw.ts";
import { rwFillBook, rwSummary, type RwFillRow } from "./pmrw_view.ts";
import type { PmPrint } from "../_shared/polymarket_public.ts";

Deno.test("rwFillBook: average cost, and realised + net × (mark − cost) is the engine's cash + net × mark for any mark", () => {
  const book = rwFillBook([{ side: "bid", price: 0.49, size: 20 }, { side: "ask", price: 0.51, size: 20 }]);
  assertEquals(book.net, 0);
  assertAlmostEquals(book.realised, 0.4, 1e-12);
  const flip = rwFillBook([{ side: "bid", price: 0.49, size: 20 }, { side: "ask", price: 0.51, size: 30 }]);
  assertEquals(flip.net, -10);
  assertAlmostEquals(flip.avgCost, 0.51, 1e-12);
  assertAlmostEquals(flip.realised, 0.4, 1e-12);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 300; trial++) {
    const fills = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => ({ side: (rnd() < 0.5 ? "bid" : "ask") as "bid" | "ask", price: Math.round(rnd() * 98 + 1) / 100, size: 5 + Math.floor(rnd() * 40) }));
    let cash = 0, net = 0;
    for (const f of fills) { const d = f.side === "bid" ? 1 : -1; net += d * f.size; cash -= d * f.size * f.price; }
    const b = rwFillBook(fills), mark = rnd();
    assertAlmostEquals(b.net, net, 1e-9);
    assertAlmostEquals(b.realised + b.net * (mark - b.avgCost), cash + net * mark, 1e-9);
  }
});

const COND = "0xaaa", OTHER = "0xbbb", HELD = "0xccc";
const T = Date.UTC(2026, 8, 27, 10, 0);                  // a minute on day 3 of the fourteen

/** One market run through the engine's own step for a few minutes, with the fill rows the driver would have written. */
function runMarket(cond: string, prints: PmPrint[], minutes = 3) {
  const acc = newAcc(), rows: RwFillRow[] = [];
  const row = summarize([[0.48, 100], [0.47, 50]], [[0.52, 100], [0.53, 50]], 3, 20)!;
  for (let k = 0; k < minutes; k++) {
    const t = T + k * 60e3;
    const out = stepRw(acc, t / 1000, row, 0.01, 3, 144, 20, prints);
    for (const f of out.fills) rows.push({ cond, minute: new Date(t).toISOString(), ts: new Date(f.ts * 1000).toISOString(), side: f.side, price: f.price, size: f.size, print_id: f.printId });
  }
  return { acc, rows };
}
const p = (ts: number, side: "BUY" | "SELL", price: number, size: number, id: string): PmPrint => ({ id, ts: ts / 1000, side, oi: 0, price, size });

function world(dayOf = Date.UTC(2026, 8, 27)) {
  // COND: bought 20 at 0.49, then sold 10 at 0.51 — 10 left, and 10 closed for +$0.20. OTHER: nothing filled.
  const a = runMarket(COND, [p(T + 30e3, "SELL", 0.45, 30, "x1"), p(T + 90e3, "BUY", 0.55, 10, "x2")]);
  const b = runMarket(OTHER, []);
  // HELD: yesterday's market, no longer selected, still short 20 YES from a fill at 0.51.
  const h = runMarket(HELD, [p(T + 30e3, "BUY", 0.60, 20, "y1")], 1);
  const st: RwState = { lastDecided: T + 2 * 60e3, acc: { [COND]: a.acc, [OTHER]: b.acc, [HELD]: h.acc }, statusAt: 0, dayOf, dayActive: [COND, OTHER, HELD],
    meta: { [HELD]: { yes: "9", v: 3, minSize: 20, rate: 50, tick: 0.01, q: "yesterday's market", cat: null, day: "2026-09-26" } } as RwState["meta"] };
  const sel = (cond: string, rank: number) => ({ day: "2026-09-27", cond, rank, rate: 144, v: 3, min_size: 20, capital: 19.6, q: `market ${cond}`, cat: "weather", end_date: null });
  return { st, fills: [...a.rows, ...b.rows, ...h.rows], selection: [sel(OTHER, 2), sel(COND, 1)] };
}

Deno.test("rwSummary: realised and unrealised sum to the engine's total, and the list is today's portfolio by rank, then what is held", () => {
  const w = world();
  const days = [
    { day: "2026-09-25", total: 3, stress_total: 1, reward: 3.5, fills: 2, capital: 290, markets: 15, detail: { phase: "run" } },
    { day: "2026-09-26", total: 5, stress_total: 2, reward: 6, fills: 3, capital: 295, markets: 16, detail: { phase: "run" } },
    { day: "2026-09-24", total: 40, stress_total: 20, reward: 41, fills: 1, capital: 280, markets: 16, detail: { phase: "warm-up" } },
  ];
  const latest = [{ cond: COND, minute: new Date(T + 2 * 60e3).toISOString(), b: 0.49, a: 0.51, m: 0.5, ours: 1, others: 3, qb: true, qa: true }];
  const r = rwSummary({ state: { state: w.st, last_minute: new Date(T + 2 * 60e3).toISOString(), last_error: null }, selection: w.selection, latest, days, fills: w.fills, firstMinute: "2026-09-24T19:31:00Z", nowMs: T + 5 * 60e3 })!;
  const total = Object.values(w.st.acc).reduce((s, a) => s + accTotal(a as Acc), 0);
  assertAlmostEquals(r.totalUsd, total, 1e-12);
  assertAlmostEquals(r.realisedUsd + r.unrealisedUsd, total, 1e-9);
  assertAlmostEquals(r.mismatchUsd, 0, 1e-9);
  // COND closed 10 of its 20 for +$0.20 (sold at 0.51 against 0.49); the rest is marked at the mid, 0.50.
  const m0 = r.markets.find((m) => m.cond === COND)!;
  assertEquals([m0.rank, m0.quoting, m0.net, m0.bid, m0.ask], [1, true, 10, 0.49, 0.51]);
  assertAlmostEquals(Number(m0.share), 0.25, 1e-12);
  assertEquals(r.markets.map((m) => m.cond), [COND, OTHER, HELD]);
  assertEquals([r.markets[2].quoting, r.markets[2].q, r.markets[2].net], [false, "yesterday's market", -20]);
  assertEquals([r.open, r.quoting, r.phase, r.dayOfRun, r.running, r.finished], [2, 2, "run", 3, true, false]);
  // Held: 10 YES at the 0.50 mid, and 20 short YES — 20 NO at 1 − 0.50.
  assertAlmostEquals(r.heldUsd, 10 * 0.5 + 20 * 0.5, 1e-12);
  // Today is measured from the day before in the same phase: 09-26's running total, not the warm-up's.
  assertAlmostEquals(r.todayUsd, total - 5, 1e-12);
  // Day rows newest first, each against the day before it in its own phase; the warm-up starts at nothing.
  assertEquals(r.days.map((d) => [d.day, d.phase, d.totalUsd, d.fills]), [["2026-09-26", "run", 2, 1], ["2026-09-25", "run", 3, 2], ["2026-09-24", "warm-up", 40, 1]]);
  assertEquals(r.recent.map((f) => [f.cond, f.side, f.size]), [[COND, "ask", 10], [HELD, "ask", 20], [COND, "bid", 20]]);
});

Deno.test("rwSummary: the warm-up's fills stay out of the fourteen days, a split that disagrees says so, and stale, over or absent is shown as such", () => {
  const w = world();
  const early = { cond: COND, minute: new Date(RW_RUN_START - 60e3).toISOString(), ts: new Date(RW_RUN_START - 30e3).toISOString(), side: "bid" as const, price: 0.3, size: 20, print_id: "w" };
  const args = { state: { state: w.st, last_minute: new Date(T + 2 * 60e3).toISOString(), last_error: null }, selection: w.selection, latest: [], days: [], firstMinute: null };
  const r = rwSummary({ ...args, fills: [...w.fills, early], nowMs: T + 5 * 60e3 })!;
  assertAlmostEquals(r.mismatchUsd, 0, 1e-9);
  // A fill the state never saw is a disagreement the page can show, not a silent second number.
  const odd = rwSummary({ ...args, fills: [...w.fills, { ...early, minute: new Date(T).toISOString() }], nowMs: T + 5 * 60e3 })!;
  assert(Math.abs(odd.mismatchUsd) > 0.01);
  assertEquals(rwSummary({ ...args, fills: w.fills, nowMs: T + 12 * 60e3 })!.running, false);
  const done = rwSummary({ ...args, state: { ...args.state, state: { ...w.st, dayOf: Date.UTC(2026, 9, 9) } }, fills: w.fills, nowMs: Date.UTC(2026, 9, 9, 1) })!;
  assertEquals([done.phase, done.finished, done.running], ["after", true, false]);
  assertEquals(rwSummary({ ...args, state: null, fills: [], nowMs: T }), null);
  assertEquals(rwSummary({ ...args, state: { state: {}, last_minute: null, last_error: null }, fills: [], nowMs: T }), null);
});

Deno.test("rwSummary: what a run wrote after the state the page read stays out — a later minute's fill, the row of a day it has not closed", () => {
  const w = world();
  // A run writes the fills of the minutes it decides, and a closing day's row, before it saves the state that counts them.
  const ahead = { cond: COND, minute: new Date(T + 3 * 60e3).toISOString(), ts: new Date(T + 3 * 60e3 + 20e3).toISOString(), side: "bid" as const, price: 0.49, size: 20, print_id: "z" };
  const closing = { day: "2026-09-27", total: 99, stress_total: 9, reward: 99, fills: 9, capital: 300, markets: 16, detail: { phase: "run" } };
  const r = rwSummary({ state: { state: w.st, last_minute: new Date(T + 2 * 60e3).toISOString(), last_error: null }, selection: w.selection, latest: [], days: [closing], fills: [...w.fills, ahead], firstMinute: null, nowMs: T + 5 * 60e3 })!;
  assertAlmostEquals(r.mismatchUsd, 0, 1e-9);
  assertEquals(r.recent.filter((f) => f.minute === ahead.minute), []);
  assertEquals(r.days, []);
});
