// "Stablecoin quotes USDG/EUR - 1" (migration 0171; Davies, 2026-10-29: "okx usdg/eur可以按你说的做一个 -1"): the OKX USDG/EUR paper
// twin's rule (okx_quotes.ts, which this file imports and does not touch) with ONE change, its fair. Pre-registered in
// docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md, frozen at the commit that adds this file; the study that proposed it is
// docs/agents/reviews/2026-10-29-cb-okx-fair-price-study.md (§4, recommendation 2).
//
// THE ONE CHANGE. The USDG/EUR row's fair is par, 1 / EUR/USD euros a USDG. This one's is
//     fair(t) = par(t) × (1 + ½ × b(t)),
// b(t) the book's trailing basis known at the start of minute t: the median, over the minutes j in [t − 24 h, t − 1 min] in which
// USDG-EUR printed, of (the minute's last print ÷ par(j) − 1). One value a minute, whatever the prints' sizes or count; the last
// print is the one with the latest time (then the highest trade id); par(j) is 1 / the newest EUR/USD bar that started at or
// before j − 1 min, of any age (a closure holds the last). Fewer than five such minutes, and b is 0: the fair is par.
// `okxBasisAt` is that, pinned by hand in okx_basis.test.ts. It is the study's replay rule (`okx_replay_prep.py`, `hist.py`'s
// `rolling_basis`), but for one difference the pre-registration states: the replay carried the last median through a window of
// fewer than five minutes; this falls back to par.
//
// HOW, WITHOUT TOUCHING THE ENGINE. `stepOkxMinute` (frozen) prices USDG-EUR at 1 / its `eurusd` input. So a lit minute is given
// x' = EUR/USD ÷ (1 + ½ b) and the engine quotes around par × (1 + ½ b), as the replay did. Its rung, $100 in euros, is `rungUsd`
// ÷ x' inside the engine: `rungUsd` = $100 ÷ (1 + ½ b) makes it $100 ÷ EUR/USD euros, the USDG/EUR row's rung exactly. A dark
// minute is given no rate, so inside a closure the engine holds its last x' (and this its last b for the rung), as the replay
// did. Everything else is the USDG/EUR row's: LIVE's rungs, re-price, post-only against the recorded book, the "at" fill by the
// print's size, exits at fair, the 24-hour stop, the dark and de-peg guards (the de-peg guard reads the minute's fair, so this
// fair), $600 a book. Two things follow from passing x' that the reading does not use: the engine's pounds per euro (`gbpq`) is
// EUR/USD ÷ (1 + ½ b) ÷ GBP/USD, so a trip's `pnl_gbp` carries the factor 1 / (1 + ½ b) (a few bps of the P&L); the reading uses
// `pnl_quote`, in euros. The daily loss stop is this book's alone, its trips against 1 % of its own $600.
//
// Its own tables (`okx_basis_*`, the OKX twins' shapes with the minute's par, b and its count), lease (`okx-basis`) and call
// (`agents?action=okxbasis`, a row of `edge_calls`, its beat first). It reads the recorder's tables and the stored rates; it calls
// no venue and holds no key. An empty record starts at the first 00:00 UTC after its first run, flat; no backfill.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { fxBarAt } from "./quotes.ts";
import type { OkxRecState } from "./okx_rec.ts";
import {
  newOkxBookState, OKX_BOOK_USD, OKX_MAX_MINUTES, OKX_RUNG_USD, OKX_SPEC, OKX_TOUCH_MAX_AGE_MS, okxAccountMinute, okxAccountTrips, okxBookView,
  okxEventRow, okxStart, okxTouchAt, okxTripRow, stepOkxMinute, type OkxAccount, type OkxQuoteState, type OkxTapePrint, type OkxTouch,
} from "./okx_quotes.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const r9 = (x: number) => Number(x.toFixed(9));

/** The book it quotes: USDG-EUR alone. */
export const OKX_BASIS_BOOK = "USDG-EUR" as const;
/** Its twin id (ids name tables, never a variant number) and the page's name for it, right after "Stablecoin quotes USDG/EUR". */
export const OKX_BASIS_ID = "okxusdgb";
export const OKX_BASIS_NAME = "Stablecoin quotes USDG/EUR - 1";
/** The share of the trailing basis the fair moves by. */
export const OKX_BASIS_WEIGHT = 0.5;
/** The trailing window: the minutes j in [t − 24 h, t − 1 min]. */
export const OKX_BASIS_WINDOW_MS = DAY;
/** Fewer minutes with a print than this in the window, and the fair is par. */
export const OKX_BASIS_MIN_MINUTES = 5;
export const OKX_BASIS_LEASE = "okx-basis";
export const OKX_BASIS_LEASE_MS = 25e3;
export const OKX_BASIS_TABLES = { state: "okx_basis_state", events: "okx_basis_events", trips: "okx_basis_trips", minutes: "okx_basis_minutes", days: "okx_basis_days" } as const;

/** The newest bar that started at or before `t − 1 min`, of any age: the par of a past minute (a closure holds the last). */
export function okxBasisBarBefore(t: number, bars: Array<[number, number]>): number | null {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] <= t - M) lo = mid + 1; else hi = mid; }
  return lo > 0 ? bars[lo - 1][1] : null;
}

/**
 * The trailing basis known at the start of minute `t`: over the minutes j in [t − 24 h, t − 1 min] in which the book printed, the
 * median of (j's last print ÷ par(j) − 1), par(j) = 1 / `okxBasisBarBefore(j)`. `prints` in time order (then trade id), prices in
 * euros; `bars` the EUR/USD minutes in time order. `b` is 0 with fewer than `OKX_BASIS_MIN_MINUTES` such minutes; `n` is the count.
 */
export function okxBasisAt(t: number, prints: Array<{ ts: number; price: number; id: number }>, bars: Array<[number, number]>): { b: number; n: number } {
  const last = new Map<number, { ts: number; id: number; price: number }>();
  for (const p of prints) {
    if (p.ts < t - OKX_BASIS_WINDOW_MS || p.ts >= minuteOf(t)) continue;
    const j = minuteOf(p.ts), was = last.get(j);
    if (!was || p.ts > was.ts || (p.ts === was.ts && p.id > was.id)) last.set(j, p);
  }
  const vs: number[] = [];
  for (const [j, p] of last) {
    const x = okxBasisBarBefore(j, bars);
    if (x) vs.push(p.price * x - 1);                   // print ÷ (1 / EUR/USD) − 1
  }
  if (vs.length < OKX_BASIS_MIN_MINUTES) return { b: 0, n: vs.length };
  vs.sort((a, c) => a - c);
  const n = vs.length;
  return { b: n % 2 ? vs[(n - 1) / 2] : (vs[n / 2 - 1] + vs[n / 2]) / 2, n };
}

/** The inputs that make `stepOkxMinute` quote around par × (1 + ½ b) with the USDG/EUR row's rung: x' and the rung's dollars. */
export function okxBasisInputs(eurusd: number | null, b: number, bHeld: number): { x: number | null; rungUsd: number } {
  if (!eurusd) return { x: null, rungUsd: OKX_RUNG_USD / (1 + OKX_BASIS_WEIGHT * bHeld) };
  const k = 1 + OKX_BASIS_WEIGHT * b;
  return { x: eurusd / k, rungUsd: OKX_RUNG_USD / k };
}

export type OkxBasisState = OkxQuoteState & {
  /** The basis the last lit minute was quoted on: a closure's held rate goes with it. */
  lastB?: number;
};
export type OkxBasisReport = { minutes: number; from: number | null; to: number | null; prints: number; fills: number; exits: number; stops: number; orders: number; refused: number; errors: string[]; report: boolean; skipped?: string };

/** An empty record from `start`: flat, `fed` the newest trade id the book had, born at $100 a rung (`usdFrom` its start). */
export function okxBasisNewState(start: number, fed: number): OkxBasisState {
  return {
    lastMinute: start - M, startedAt: start, books: { [OKX_BASIS_BOOK]: newOkxBookState(OKX_BASIS_BOOK) } as OkxQuoteState["books"],
    fed: { [OKX_BASIS_BOOK]: fed } as OkxQuoteState["fed"], gbpusd: null, account: { day: null, dayGbp: 0, stopped: false },
    usdFrom: start, usdEurusd: undefined, usdFactor: 1, lastB: 0,
  };
}

/**
 * Decide every minute the recorder has covered on USDG-EUR and this record has not, at most `OKX_MAX_MINUTES`, one minute behind
 * that coverage, as `runOkxQuotes` does the USDG/EUR row's. Idempotent by natural keys.
 */
export async function runOkxBasis(d: { db: Db; now: number; holder: string; rec: OkxRecState | null }): Promise<OkxBasisReport> {
  const T = OKX_BASIS_TABLES, b = OKX_BASIS_BOOK, tick = OKX_SPEC[b].tick;
  const report: OkxBasisReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, errors: [], report: false };
  const leased = await d.db.claim("agent_locks", `name=eq.${OKX_BASIS_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + OKX_BASIS_LEASE_MS), holder: d.holder });
  if (!leased.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const cur = d.rec?.cursors?.[b];
    if (!cur || !(cur.top > 0)) return { ...report, skipped: "the recorder has not covered the book yet" };
    const horizonAll = minuteOf(cur.coveredTo) - M;
    const rows = await d.db.select<{ state: OkxBasisState | Record<string, never> }>(T.state, "id=eq.1&select=state");
    let st = rows[0]?.state as OkxBasisState | undefined;
    if (!st || !("books" in st)) {
      const top = await d.db.select<{ trade_id: number }>("okx_trades", `book=eq.${b}&select=trade_id&order=trade_id.desc&limit=1`);
      st = okxBasisNewState(okxStart(d.now), top[0] ? Number(top[0].trade_id) : 0);
    }
    const first = st.lastMinute + M, horizon = Math.min(horizonAll, st.lastMinute + OKX_MAX_MINUTES * M, minuteOf(d.now) - M);
    if (horizon < first) { await save(d, st, report); return { ...report, skipped: "nothing new to decide" }; }
    const from = first - OKX_BASIS_WINDOW_MS;
    const series = async (table: string, kind: string, a: number) => (await d.db.selectAll<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(a)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    // EUR/USD from a day before the first minute, with the newest bar before that as the anchor a closure's par holds.
    const anchor = await d.db.select<{ t: string; value: number }>("cb_quote_inputs", `kind=eq.fx%3AEURUSD&t=lt.${enc(from)}&select=t,value&order=t.desc&limit=1`);
    const eurBars: Array<[number, number]> = [...anchor.map((r) => [msOf(r.t), Number(r.value)] as [number, number]), ...await series("cb_quote_inputs", "fx:EURUSD", from)];
    const gbpBars = await series("agent_quote_inputs", "fx", first - 10 * M);
    const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("okx_trades",
      `book=eq.${b}&ts=gte.${enc(from)}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=book.asc,trade_id.asc`);
    const all = pRows.map((r) => ({ ts: msOf(r.ts), price: Number(r.price), id: Number(r.trade_id), qty: Number(r.size), side: r.side === "buy" ? "buy" as const : "sell" as const }))
      .sort((p, q) => p.ts - q.ts || p.id - q.id);
    const tape: OkxTapePrint[] = all.filter((p) => p.id > st!.fed[b] && p.ts >= first).map((p) => ({ ts: p.ts, ticks: Math.round(p.price / tick), qty: p.qty, side: p.side, id: p.id }));
    const touches: OkxTouch[] = (await d.db.selectAll<{ ts: string; bid: number; ask: number }>("okx_books",
      `book=eq.${b}&ts=gte.${enc(first - OKX_TOUCH_MAX_AGE_MS)}&ts=lt.${enc(horizon + M)}&select=ts,bid,ask&order=book.asc,ts.asc`)).map((r) => ({ at: msOf(r.ts), bid: Number(r.bid), ask: Number(r.ask) }));
    report.prints = tape.length;
    const trips: ReturnType<typeof okxTripRow>[] = [], events: ReturnType<typeof okxEventRow>[] = [], minutes: Array<Record<string, unknown>> = [];
    let gbpusd = st.gbpusd ?? null;
    let acct: OkxAccount = st.account ?? { day: null, dayGbp: 0, stopped: false };
    let j = 0;
    for (let t = first; t <= horizon; t += M) {
      const eb = fxBarAt(t, eurBars), gb = fxBarAt(t, gbpBars);
      if (gb) gbpusd = gb[1];
      acct = okxAccountMinute(acct, t);
      const mine: OkxTapePrint[] = [];
      while (j < tape.length && tape[j].ts < t + M) { mine.push(tape[j]); j++; }
      const { b: basis, n } = okxBasisAt(t, all, eurBars);
      const inp = okxBasisInputs(eb ? eb[1] : null, basis, st.lastB ?? 0);
      if (eb) st.lastB = basis;
      const out = stepOkxMinute(st.books[b], t, { eurusd: inp.x, gbpusd, prints: mine, touchStart: okxTouchAt(touches, t), touchEnd: okxTouchAt(touches, t + M - 1), stopped: acct.stopped, rungUsd: inp.rungUsd });
      acct = okxAccountTrips(acct, out.trips, gbpusd ? OKX_BOOK_USD / gbpusd : null);
      const last = st.books[b].lastPrint, ts = okxTouchAt(touches, t);
      minutes.push({
        book: b, minute: iso(t), x: eb ? eb[1] : null, x_held: out.held, fair: out.fair, gbp_per_quote: out.gbpq, guard: out.guard,
        prints_n: mine.length, vol: r9(mine.reduce((a, p) => a + p.qty * p.ticks * tick, 0)), last: last ? r9(last.ticks * tick) : null,
        bid: ts?.bid ?? null, ask: ts?.ask ?? null, par: eb ? 1 / eb[1] : null, basis: eb ? basis : null, basis_n: n,
      });
      for (const x of out.trips) trips.push(okxTripRow(x));
      events.push(...out.events.map(okxEventRow));
      report.orders += out.orders;
    }
    if (pRows.length) st.fed[b] = Math.max(st.fed[b], ...all.filter((p) => p.ts < horizon + M).map((p) => p.id));
    st.account = acct;
    st.gbpusd = gbpusd;
    report.minutes = (horizon - first) / M + 1; report.from = first; report.to = horizon;
    report.fills = events.filter((e) => e.kind === "fill").length;
    report.exits = events.filter((e) => e.kind === "exit").length;
    report.stops = events.filter((e) => e.kind === "stop").length;
    report.refused = events.filter((e) => e.kind === "refused").length;
    if (events.length) await d.db.upsert(T.events, events, "book,minute,side,k,kind");
    if (trips.length) await d.db.upsert(T.trips, trips, "book,side,k,t_entry");
    if (minutes.length) await d.db.upsert(T.minutes, minutes, "book,minute");
    st.lastMinute = horizon;
    await save(d, st, report);
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    report.report = true;
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${OKX_BASIS_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

async function save(d: { db: Db; now: number }, st: OkxBasisState, report: OkxBasisReport) {
  const key = faultKey(report.errors);
  report.report = reportDue(st.fault ?? null, key, d.now);
  if (!key) delete st.fault; else if (report.report) st.fault = { key, at: d.now };
  await d.db.upsert(OKX_BASIS_TABLES.state, [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null }], "id");
}

/**
 * The twin for the Agents page: the USDG/EUR row's own view (`okxBookView`) of this record, under its own id and name. Born at
 * $100 a rung, so nothing is scaled. null before it has decided a minute or when its tables are missing.
 */
export async function readOkxBasis(d: Db, now: number, dayStartMs: number) {
  try {
    const T = OKX_BASIS_TABLES;
    const [st, trips, days, events, fx, eurFx] = await Promise.all([
      d.select<{ state: OkxBasisState | Record<string, never>; last_minute: string | null; last_error: string | null }>(T.state, "id=eq.1&select=state,last_minute,last_error"),
      d.selectAll<{ book: string; side: string; k: number; t_entry: string; t_exit: string; entry: number; exit: number; qty: number; how: string; pnl_gbp: number; pnl_quote: number }>(T.trips,
        "select=book,side,k,t_entry,t_exit,entry,exit,qty,how,pnl_gbp,pnl_quote&order=book.asc,side.asc,k.asc,t_entry.asc"),
      d.select<{ book: string; day: string; orders: number; fills: number; trips: number; won: number; realised_gbp: number }>(T.days, "select=book,day,orders,fills,trips,won,realised_gbp&order=day.desc&limit=120"),
      d.select<{ book: string; minute: string; side: string; k: number; kind: string; ticks: number | null; detail: Record<string, unknown> }>(T.events,
        "kind=in.(order,refused)&select=book,minute,side,k,kind,ticks,detail&order=minute.desc&limit=60"),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
      d.select<{ value: number }>("cb_quote_inputs", "kind=eq.fx%3AEURUSD&select=value&order=t.desc&limit=1"),
    ]);
    if (!st[0]?.last_minute) return null;
    const mins = await d.select<{ book: string; minute: string; fair: number | null; last: number | null; gbp_per_quote: number | null }>(T.minutes,
      `minute=eq.${encodeURIComponent(new Date(Date.parse(st[0].last_minute)).toISOString())}&select=book,minute,fair,last,gbp_per_quote`);
    const v = okxBookView({ book: OKX_BASIS_BOOK, st: st[0], trips, days, events, minute: mins[0] ?? null, nowMs: now, dayStartMs,
      gbpusd: fx[0] ? Number(fx[0].value) : null, eurusd: eurFx[0] ? Number(eurFx[0].value) : null });
    return v ? { ...v, twin: { ...v.twin, id: OKX_BASIS_ID, name: OKX_BASIS_NAME } } : null;
  } catch { return null; }
}

/** The OKX rows in the page's order: this twin right after the USDG/EUR row, the rest as they come. */
export function okxRowsWithBasis<T extends { twin: { id: string } }>(okx: T[], basis: T | null): T[] {
  if (!basis) return okx;
  const i = okx.findIndex((q) => q.twin.id === OKX_SPEC[OKX_BASIS_BOOK].id);
  return i < 0 ? [...okx, basis] : [...okx.slice(0, i + 1), basis, ...okx.slice(i + 1)];
}
