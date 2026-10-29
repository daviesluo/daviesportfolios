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
// Its call is its own (`agents?action=cbhold`, a row of `edge_calls`): a fault of this arm never touches the base test's call.

import type { Db } from "./db.ts";
import {
  CB_BOOK, CB_FAIR_KIND, CB_LEASE_MS, CB_MAX_MINUTES, CB_USDT_KIND, cbCoinFair, cbEventRow, cbInUsd, cbLiveSwitch, cbMinuteInputs, cbMinuteRow, cbPrint, cbStopExit, cbTripInPounds, cbTripRow, cbUsdSwitch,
  type CbQuoteReport, type CbQuoteState,
} from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbProduct, type CbRecState } from "./cb_rec.ts";
import { cbInBlackout } from "./cb_releases.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { fairHours, median, newBookState, QUOTE_FX_LOOKBACK_MS, stepMinute, type BookState, type MinuteInputs, type Print, type QuoteBook } from "./quotes.ts";

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
    const rows = await d.db.select<{ state: CbQuoteState | Record<string, never> }>(T.state, "id=eq.1&select=state");
    let st = rows[0]?.state as CbQuoteState | undefined;
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
    const first = st.lastMinute + M, horizon = Math.min(horizonAll, st.lastMinute + CB_MAX_MINUTES * M, minuteOf(d.now) - M);
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
    // Deviation 4 (2026-10-29): Coinbase's own coin value from the switch, the base call's stored USDT-USD minutes.
    cbLiveSwitch(st, first);
    const usdtBars = await series("cb_quote_inputs", CB_USDT_KIND, first - QUOTE_FX_LOOKBACK_MS);
    const trips: ReturnType<typeof cbTripRow>[] = [], events: ReturnType<typeof cbEventRow>[] = [], minutes: ReturnType<typeof cbMinuteRow>[] = [];
    for (const b of CB_PRODUCTS) {
      const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("cb_trades",
        `product=eq.${b}&trade_id=gt.${st.fed[b]}&ts=gte.${enc(first)}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=product.asc,trade_id.asc`);
      const prints = pRows.map((r) => cbPrint(b, r)).filter((p) => p.ts >= first);
      report.prints += prints.length;
      let j = 0;
      for (let t = first; t <= horizon; t += M) {
        const mine: Print[] = [];
        while (j < prints.length && prints[j].ts < t + M) { mine.push(prints[j]); j++; }
        const bar = cbHoldBarAt(t, gbpBars), eb = cbHoldBarAt(t, eurBars), window = fairHours(t, hours[CB_BOOK[b].coin]);
        const coinU = cbCoinFair(st, t, CB_BOOK[b].coin, median(window), usdtBars).fairU;
        const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, coinU, cbInUsd(st, t));
        // Deviation 2 (2026-10-15): the same release blackout as the base test's (cb_releases.ts): in the minutes around a scheduled release the fair is withheld.
        const inp: MinuteInputs = { ...io, fairU: cbInBlackout(t) ? null : io.fairU, prints: mine };
        const out = stepMinute(st.books[b], t, inp);
        minutes.push(cbMinuteRow(b, t, bar, CB_BOOK[b].quote === "EUR" ? eb : null, window.length, inp, io.xGbp));
        // Pounds, as the base test: a trip closing at the book's last known pounds per unit, from the one its rung filled at.
        if (io.xGbp != null) st.xGbp = { ...st.xGbp, [b]: io.xGbp };
        const xNow = st.xGbp?.[b] ?? (CB_BOOK[b].quote === "GBP" ? 1 : null);
        const entered = (st.xEntry ??= {})[b] ??= {};
        for (const x of out.trips) {
          const key = `${x.side}|${x.k}`;
          const xe = entered[key] ?? x.xEntry;
          delete entered[key];
          const c = cbStopExit(x, b);
          trips.push(cbTripRow(b, xNow == null ? c : cbTripInPounds(c, xNow, xe)));
        }
        for (const e of out.events) if (e.kind === "fill" && xNow != null) entered[`${e.side}|${e.k}`] = xNow;
        events.push(...out.events.map((e) => cbEventRow(b, e)));
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
