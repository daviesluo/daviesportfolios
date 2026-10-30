// "Stablecoin quotes with Euros - 2": the weekend variant of the Coinbase paper test (migration 0118; Davies, 2026-10-13:
// "周末变体写预注册然后上线paper trading 策略with Euros - 2"). Pre-registered in
// docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md, frozen at the commit that adds this file.
//
// ONE CHANGE from "Stablecoin quotes with Euros" (cb_quotes.ts, which this file does not touch, and whose decisions it
// leaves as they are): the interbank rates (GBP/USD, and for a EUR book EUR/USD) are HELD through a closure. The base test
// goes dark when its newest rate bar is older than ten minutes (`QUOTE_FX_LOOKBACK_MS`), so it quotes nothing from Friday
// ~22:00 to Sunday ~23:00 UTC, 29 % of the minutes; this arm uses the newest bar for up to `CB_HOLD_MS` = 60 hours. Nothing
// else differs: the same four books, `stepMinute` called unchanged on the same recorded prints, £100 a rung on a GBP book and
// €100 on a EUR book, the same fair hours, the same stop and the same pounds conversion. It is the "wkend" arm of
// docs/agents/backtests/cbreview/scripts/cbk.py, whose figures were seen (in sample) before the pre-registration.
//
// The driver below is `runCbQuotes`'s, the same steps in the same order, with four differences, each pinned in
// `cb_hold.test.ts` (and on a world with no closure the two arms write the same rows, the other tables aside):
//   * the rate bars: `cbHoldBarAt` is `fxBarAt` with the hold in place of the ten minutes, and the series carry the newest bar
//     BEFORE the ten-minute window as an anchor (one row), so a closure is held without reading 60 hours of bars every minute;
//   * its own tables (`cb_hold_*`, 0118) and lease (`cb-hold`);
//   * it reads EUR/USD from `cb_quote_inputs`, which the base test's call stores each minute, and does not fetch it;
//   * an empty record starts at the first 00:00 UTC after its first run (the window's start, the pre-registration's §3), not at
//     the recorder's first whole minute; and the prints are read from that start on (`ts>=first`), from the newest trade id
//     it saw when the record began.
//
// Since 2026-10-15 (Deviation 2 of the pre-registration; Davies: "目前的两个Coinbase 测试采用发布前后暂停的规则吧") it sits out the scheduled
// releases exactly as the base test does (`cb_releases.ts`): a second change, made to both arms alike, so their comparison is unaffected.
//
// Since 2026-10-29 (Deviation 3; Davies: "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整") a rung is $100 of the book's
// currency from the switch, as the base test's (its Deviation 4, `cbUsdSwitch` and `cbInUsd` from cb_quotes.ts): a third change,
// made to both arms alike.
//
// Since 2026-10-29 (Deviation 4; Davies: "目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的") the coin's dollar
// value is Coinbase's own from the switch, with the de-peg guard (`cbLiveSwitch`, `cbCoinFair` from cb_quotes.ts, the base test's
// Deviation 5): USDT's candles are read for ten minutes, as the study's weekend arm did; only the FX bar is held.
//
// Since 2026-10-29 (Deviation 6; Davies: "…把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks") the rates
// are read at second resolution from the switch (`cbFxSwitch`, `cbRatesAt` from cb_fx.ts, the base test's Deviation 7): in session
// the newest TrueFX (or Kraken's marked fallback) read arrived by t + 58 s while no more than 120 s old, else Yahoo's bar; in a
// closure the held bar's minutes stay the lit ones, holding the last fast read when it is no older than that bar, else the bar.
//
// Since 2026-10-30 (Deviation 7; Davies: "…“Stablecoin quotes with Euros”改为“Stablecoin quotes with Euros - 2”放在-1之后并且改为每档50")
// a rung is $50, not $100, from a second switch (`usd50From`, `cbHold50Switch`), as the USDC arm's Deviation 2 made its own: the
// engine still sizes a rung at its 100 (`stepMinute` is frozen), and is given every print's size × `CB_HOLD_FACTOR_50` (2) from that
// minute (`cbHoldFactorAt`), so every size, notional and P&L it writes comes back ÷ 2 (the trips, the events' money and the minutes'
// printed value; `cb_usdc.ts`' `cbUsdcPrint`, `cbUsdcTrip` and `cbUsdcEventDetail` do the same, and `cb_hold.test.ts` pins that they
// agree). A rung held across the switch keeps the coins it holds: its size and notional go × 2 in the engine's units. Before the
// switch the divisor is 1 and nothing differs.
//
// Since 2026-10-31 00:00 UTC (the compounding deviation, recorded apart in reviews/2026-10-30-compounding-deviation.md; Davies,
// 2026-10-30: "另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？如果不能请研究实现") what it realises is
// put back to work (cb_compound.ts): its divisor is ÷ its capital over its funded $1,200, set at each UTC day's first minute, and a
// run never decides past 23:59. The base test, this arm's weekend control, does not compound: the reading divides this arm's days
// by the day's multiplier (the deviation says how).
//
// Its call is its own (`agents?action=cbhold`, a row of `edge_calls`): a fault of this arm never touches the base test's call.

import type { Db } from "./db.ts";
import {
  CB_BOOK, CB_FAIR_KIND, CB_LEASE_MS, CB_MAX_MINUTES, CB_RUNG_USD, CB_USDT_KIND, cbCoinFair, cbEventRow, cbInUsd, cbLiveSwitch, cbMinuteInputs, cbMinuteRow, cbPrint, cbStopExit, cbTripInPounds, cbTripRow, cbUsdSwitch,
  type CbQuoteReport, type CbQuoteState,
} from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbProduct, type CbRecState } from "./cb_rec.ts";
import { cbInBlackout } from "./cb_releases.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { cbFxCount, cbFxSwitch, cbRatesAt, emptyFx, readCbFx } from "./cb_fx.ts";
import { fairHours, median, newBookState, QUOTE_FX_LOOKBACK_MS, stepMinute, type BookState, type MinuteInputs, type Print, type QuoteBook, type Trip } from "./quotes.ts";
import { cbCompoundAt, cbCompoundHorizon, cbCompoundMult, cbCompoundMultNow, cbCompoundTrip, type CbCompoundState } from "./cb_compound.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The page's name for it (TESTING's row, right after "Stablecoin quotes with Euros"). */
export const CB_HOLD_ROW_NAME = "Stablecoin quotes with Euros - 2";
/** The twin id its page payload carries (ids name tables, never a variant number: its tables are `cb_hold_*`). */
export const CB_HOLD_ID = "coinbasehold";
/** How long a rate bar is used after it started: a Friday close to a Monday morning. The base test's is ten minutes. */
export const CB_HOLD_MS = 60 * H;
export const CB_HOLD_LEASE = "cb-hold";
/** The tables of the arm, in the shape of 0112's. */
export const CB_HOLD_TABLES = { state: "cb_hold_state", events: "cb_hold_events", trips: "cb_hold_trips", minutes: "cb_hold_minutes", days: "cb_hold_days" } as const;

/** Deviation 7 (2026-10-30): $50 a rung from its switch, $1,200 on the four books; the engine's $100 ÷ this. */
export const CB_HOLD_FACTOR_50 = 2;
export const CB_HOLD_RUNG_USD_50 = CB_RUNG_USD / CB_HOLD_FACTOR_50;
/** Deviation 7: no minute before 2026-10-30 01:00 UTC is decided at $50 (the push lands after it is written). */
export const CB_HOLD_50_NOT_BEFORE = Date.UTC(2026, 9, 30, 1);

/** The arm's state: the base test's, with Deviation 7's switch (`usd50From`) and the factor the page shows what came before at. */
export type CbHoldState = CbQuoteState & { usd50From?: number; usd50Factor?: number; compound?: CbCompoundState };

/** The engine's divisor at minute `t`: 1 ($100 a rung) until Deviation 7's switch, 2 ($50) from it. */
export const cbHoldFactorAt = (st: CbHoldState, t: number) => (st.usd50From != null && t >= st.usd50From ? CB_HOLD_FACTOR_50 : 1);
/** The divisor the state's held rungs are kept at now: 2 once Deviation 7 has switched, 1 before. */
export const cbHoldFactorNow = (st: CbHoldState | null | undefined) => (st?.usd50From != null ? CB_HOLD_FACTOR_50 : 1) / cbCompoundMultNow(st);

/**
 * Deviation 7's switch, written once into the state at `first`, the run's first minute: when it is not before
 * `CB_HOLD_50_NOT_BEFORE` and Deviation 3's dollar switch has been made. A rung held across it keeps the coins it holds: the
 * engine keeps sizes × its divisor, so its size and notional go × 2. Resting orders carry no size (a fill sizes itself). The page
 * shows what came before × `usd50Factor`, the new rung over the old: 1/2.
 */
export function cbHold50Switch(st: CbHoldState, first: number): void {
  if (st.usd50From != null || st.usdFrom == null || first < st.usdFrom || first < CB_HOLD_50_NOT_BEFORE) return;
  for (const b of CB_PRODUCTS) for (const r of st.books[b]?.rungs ?? []) {
    if (r.mode !== "position") continue;
    if (r.qty != null) r.qty *= CB_HOLD_FACTOR_50;
    if (r.nq != null) r.nq *= CB_HOLD_FACTOR_50;
  }
  st.usd50From = first; st.usd50Factor = 1 / CB_HOLD_FACTOR_50;
}

/** A round trip the engine wrote at its (× f) size, back at this arm's: coins, notional and P&L ÷ `f`; prices as they are. */
export function cbHoldTrip(t: Trip, f: number): Trip {
  return f === 1 ? t : { ...t, qty: t.qty / f, nq: t.nq / f, notionalUsd: t.notionalUsd / f, pnlUsd: t.pnlUsd / f };
}

/** An event's sizes at this arm's: a fill's money, the minute's printed value and every print's size ÷ `f`. */
export function cbHoldEventDetail(detail: Record<string, unknown>, f: number): Record<string, unknown> {
  if (f === 1) return detail;
  const out: Record<string, unknown> = { ...detail };
  if (typeof out.usd === "number") out.usd = out.usd / f;
  if (typeof out.minuteGbp === "number") out.minuteGbp = out.minuteGbp / f;
  const p = out.print as { qty?: number } | undefined;
  if (p && typeof p.qty === "number") out.print = { ...p, qty: p.qty / f };
  return out;
}

/**
 * The rate bar the turn at `t` reads: the latest whose minute started in [t − hold, t − 1 min]; null means dark. With
 * `holdMs` = ten minutes it is `fxBarAt` (quotes.ts) exactly, pinned in `cb_hold.test.ts`.
 */
export function cbHoldBarAt(t: number, bars: Array<[number, number]>, holdMs: number = CB_HOLD_MS): [number, number] | null {
  let lo = 0, hi = bars.length;                       // the last bar starting at or before t − 1 min
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] <= t - M) lo = mid + 1; else hi = mid; }
  const k = lo - 1;
  return k >= 0 && bars[k][0] >= t - holdMs ? bars[k] : null;
}

/** The first 00:00 UTC strictly after `now`: where an empty record's window starts. */
export function cbHoldStart(now: number): number {
  return (Math.floor(now / DAY) + 1) * DAY;
}

/** An empty record starting at `start` (a whole minute): flat rungs, `fed` the newest trade id each book had. */
export function cbHoldNewState(start: number, fed: Record<CbProduct, number>): CbQuoteState {
  return {
    lastMinute: start - M, startedAt: start,
    books: Object.fromEntries(CB_PRODUCTS.map((b) => [b, newBookState(b as unknown as QuoteBook)])) as Record<CbProduct, BookState>,
    fed,
  };
}

/**
 * Decide every minute the recorder has covered for all four books and not yet decided, at most `CB_MAX_MINUTES`, one minute
 * behind that coverage, with the rates held through a closure. Idempotent by natural keys, as `runCbQuotes` is.
 */
export async function runCbHold(d: { db: Db; now: number; holder: string; rec: CbRecState | null }): Promise<CbQuoteReport> {
  const T = CB_HOLD_TABLES;
  const report: CbQuoteReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, errors: [], report: false };
  const held = await d.db.claim("agent_locks", `name=eq.${CB_HOLD_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + CB_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const curs = d.rec?.cursors ?? {};
    if (!CB_PRODUCTS.every((b) => curs[b])) return { ...report, skipped: "the recorder has not covered every book yet" };
    const covered = Math.min(...CB_PRODUCTS.map((b) => curs[b]!.coveredTo));
    const horizonAll = minuteOf(covered) - M;                    // the last minute every book's prints are complete for
    const rows = await d.db.select<{ state: CbHoldState | Record<string, never> }>(T.state, "id=eq.1&select=state");
    let st = rows[0]?.state as CbHoldState | undefined;
    if (!st || !("books" in st)) {
      // The window starts at the next 00:00 UTC; the record keeps nothing before it. The newest trade id seen now is a safe
      // floor for what is fed: every print of the window has a larger id.
      const fed = {} as Record<CbProduct, number>;
      for (const b of CB_PRODUCTS) {
        const top = await d.db.select<{ trade_id: number }>("cb_trades", `product=eq.${b}&select=trade_id&order=trade_id.desc&limit=1`);
        fed[b] = top[0] ? Number(top[0].trade_id) : 0;
      }
      st = cbHoldNewState(cbHoldStart(d.now), fed);
    }
    // The compounding (2026-10-31): a run never decides past the 23:59 of the day it starts in, so a day's capital is set first.
    const first = st.lastMinute + M, horizon = cbCompoundHorizon(CB_HOLD_LEASE, first, Math.min(horizonAll, st.lastMinute + CB_MAX_MINUTES * M, minuteOf(d.now) - M));
    if (horizon < first) { await save(d, st, report); return { ...report, skipped: "nothing new to decide" }; }
    const series = async (table: string, kind: string, from: number) => (await d.db.selectAll<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(from)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    // The ten-minute window's bars, and before them the newest bar within the hold: the one a closure is held on.
    const bars = async (table: string, kind: string) => {
      const win = await series(table, kind, first - QUOTE_FX_LOOKBACK_MS);
      const anchor = await d.db.select<{ t: string; value: number }>(table,
        `kind=eq.${encodeURIComponent(kind)}&t=lt.${enc(first - QUOTE_FX_LOOKBACK_MS)}&t=gte.${enc(first - CB_HOLD_MS)}&select=t,value&order=t.desc&limit=1`);
      return [...anchor.map((r) => [msOf(r.t), Number(r.value)] as [number, number]), ...win];
    };
    const gbpBars = await bars("agent_quote_inputs", "fx");
    const eurBars = await bars("cb_quote_inputs", "fx:EURUSD");
    const hours = { USDC: await series("agent_quote_inputs", CB_FAIR_KIND.USDC, first - DAY), USDT: await series("agent_quote_inputs", CB_FAIR_KIND.USDT, first - DAY) };
    // Deviation 3 (2026-10-29): $100 a rung from the switch, on the rates this run decides its first minute on.
    cbUsdSwitch(st, first, cbHoldBarAt(first, gbpBars)?.[1] ?? null, cbHoldBarAt(first, eurBars)?.[1] ?? null);
    // Deviation 7 (2026-10-30): $50 a rung from its switch (the engine's $100 ÷ 2).
    cbHold50Switch(st, first);
    // Deviation 4 (2026-10-29): Coinbase's own coin value from the switch, the base call's stored USDT-USD minutes.
    cbLiveSwitch(st, first);
    // Deviation 6 (2026-10-29): the rates at second resolution from the switch, the closures held as before (cb_fx.ts).
    cbFxSwitch(st, first);
    // The compounding (2026-10-31): the day's capital at its first minute, held rungs rescaled to keep their coins; the divisor ÷ it.
    cbCompoundAt(st, CB_HOLD_LEASE, first, CB_PRODUCTS);
    const fAt = (t: number) => cbHoldFactorAt(st!, t) / cbCompoundMult(st!, t);
    const fx = st.fxFrom != null ? await readCbFx(d.db, first, horizon, CB_HOLD_MS) : emptyFx();
    const usdtBars = await series("cb_quote_inputs", CB_USDT_KIND, first - QUOTE_FX_LOOKBACK_MS);
    const trips: ReturnType<typeof cbTripRow>[] = [], events: ReturnType<typeof cbEventRow>[] = [], minutes: Record<string, unknown>[] = [];
    for (const b of CB_PRODUCTS) {
      const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("cb_trades",
        `product=eq.${b}&trade_id=gt.${st.fed[b]}&ts=gte.${enc(first)}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=product.asc,trade_id.asc`);
      // Each print's size × the engine's divisor at its minute (Deviation 7: 1, then 2).
      const prints = pRows.map((r) => {
        const p = cbPrint(b, r), f = fAt(minuteOf(msOf(r.ts)));
        return f === 1 ? p : { ...p, qty: p.qty * f };
      }).filter((p) => p.ts >= first);
      report.prints += prints.length;
      let j = 0;
      for (let t = first; t <= horizon; t += M) {
        const f = fAt(t);
        const mine: Print[] = [];
        while (j < prints.length && prints[j].ts < t + M) { mine.push(prints[j]); j++; }
        const { bar, eb, gbpSrc, eurSrc } = cbRatesAt(st, t, gbpBars, eurBars, fx, cbHoldBarAt, true), window = fairHours(t, hours[CB_BOOK[b].coin]);
        const fxSrc = st.fxFrom != null && t >= st.fxFrom ? (CB_BOOK[b].quote === "GBP" ? gbpSrc : eurSrc) : undefined;
        if (fxSrc !== undefined) cbFxCount(st, fxSrc);
        const coinU = cbCoinFair(st, t, CB_BOOK[b].coin, median(window), usdtBars).fairU;
        const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, coinU, cbInUsd(st, t));
        // Deviation 2 (2026-10-15): the same release blackout as the base test's (cb_releases.ts): in the minutes around a scheduled release the fair is withheld.
        const inp: MinuteInputs = { ...io, fairU: cbInBlackout(t) ? null : io.fairU, prints: mine };
        const out = stepMinute(st.books[b], t, inp);
        // The minute's record at this arm's size: the printed value as recorded (the engine saw it × its divisor).
        const row = cbMinuteRow(b, t, bar, CB_BOOK[b].quote === "EUR" ? eb : null, window.length, inp, io.xGbp, fxSrc);
        minutes.push(f === 1 ? row : { ...row, vol: Number(row.vol) / f });
        // Pounds, as the base test: a trip closing at the book's last known pounds per unit, from the one its rung filled at.
        if (io.xGbp != null) st.xGbp = { ...st.xGbp, [b]: io.xGbp };
        const xNow = st.xGbp?.[b] ?? (CB_BOOK[b].quote === "GBP" ? 1 : null);
        const entered = (st.xEntry ??= {})[b] ??= {};
        for (const x0 of out.trips) {
          const x = cbHoldTrip(x0, f);
          const key = `${x.side}|${x.k}`;
          const xe = entered[key] ?? x.xEntry;
          delete entered[key];
          const c = cbStopExit(x, b);
          cbCompoundTrip(st, c);
          trips.push(cbTripRow(b, xNow == null ? c : cbTripInPounds(c, xNow, xe)));
        }
        for (const e of out.events) if (e.kind === "fill" && xNow != null) entered[`${e.side}|${e.k}`] = xNow;
        events.push(...out.events.map((e) => {
          const r = cbEventRow(b, e);
          return f === 1 ? r : { ...r, detail: cbHoldEventDetail(r.detail as Record<string, unknown>, f) };
        }));
        report.orders += out.orders;
      }
      if (pRows.length) st.fed[b] = Math.max(st.fed[b], ...pRows.filter((r) => msOf(r.ts) < horizon + M).map((r) => Number(r.trade_id)));
    }
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
    try { await d.db.update("agent_locks", `name=eq.${CB_HOLD_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

async function save(d: { db: Db; now: number }, st: CbQuoteState, report: CbQuoteReport) {
  const key = faultKey(report.errors);
  report.report = reportDue(st.fault ?? null, key, d.now);
  if (!key) delete st.fault; else if (report.report) st.fault = { key, at: d.now };
  const errors = report.errors;
  await d.db.upsert(CB_HOLD_TABLES.state, [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: errors.length ? errors.join(" | ").slice(0, 500) : null }], "id");
}
