// "Stablecoin quotes with Euros - 2" (migration 0142; Davies, 2026-10-26: "…然后-2改为你说的这个新策略在-1（含周末）的基础上做"):
// the weekend variant's rule ("Stablecoin quotes with Euros - 1", cb_hold.ts, which this file does not touch) on Coinbase's two
// USDC books alone, USDC-GBP and USDC-EUR, at 25 of the book's currency a rung: £25 on the GBP book, €25 on the EUR book, six a
// book. Pre-registered in docs/agents/reviews/2026-10-26-cb-usdc-prereg.md, frozen at the commit that adds this file.
//
// The driver is `runCbHold`'s, the same steps in the same order, with three differences, each pinned in `cb_usdc.test.ts`:
//   * Its books: `CB_USDC_PRODUCTS`, the two USDC books. Nothing of the USDT books is read or decided.
//   * Its rung, 25 not 100, without touching `stepMinute` (quotes.ts, frozen: its rung is `QUOTE_SIZE_USD`, 100 of the book's
//     currency, capped at 10 % of the minute's printed value). `stepMinute` is given every print's size × `CB_USDC_FACTOR` (4),
//     so its cap min(100, 10 % × 4 × value) is 4 × min(25, 10 % × value), and every size, notional and P&L it writes comes back
//     ÷ 4. Its decisions (prices, fills, exits, stops) are the same as on the unscaled prints wherever the cap does not bind;
//     where it does, the rung fills its own 10 % of the minute, as the engine's rule says. The state the engine keeps is in its
//     own (×4) units; the page's shape (`cbUsdcView`) takes them back.
//   * Its tables (`cb_usdc_*`, 0142), lease (`cb-usdc`) and call (`agents?action=cbusdc`).
// Since 2026-10-29 (its Deviation 1; Davies: "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整") the engine's 100 is dollars from
// the switch (`cbUsdSwitch`, `cbInUsd`, as the base test's Deviation 4 and the weekend variant's Deviation 3), so a rung is $25.
// Everything else is the weekend variant's, imported from it: the rate bars held through a closure (`cbHoldBarAt`, 60 hours),
// the start at the first 00:00 UTC after its first run (`cbHoldStart`), the release blackout (`cbInBlackout`), the stop's
// Coinbase cost (`cbStopExit`) and the pounds of a trip (`cbTripInPounds`).

import type { Db } from "./db.ts";
import {
  CB_BOOK, CB_FAIR_KIND, CB_LEASE_MS, CB_MAX_MINUTES, CB_RUNG, CB_RUNG_USD, cbEventRow, cbInUsd, cbMinuteInputs, cbMinuteRow, cbPrint, cbStopExit, cbTripInPounds, cbTripRow, cbUsdSwitch,
  type CbQuoteReport, type CbQuoteState,
} from "./cb_quotes.ts";
import { CB_HOLD_MS, cbHoldBarAt, cbHoldStart } from "./cb_hold.ts";
import type { CbProduct, CbRecState } from "./cb_rec.ts";
import { cbInBlackout } from "./cb_releases.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { fairHours, median, newBookState, QUOTE_FX_LOOKBACK_MS, stepMinute, type BookState, type MinuteInputs, type Print, type QuoteBook, type Trip } from "./quotes.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The page's name for it, right after "Stablecoin quotes with Euros - 1". */
export const CB_USDC_ROW_NAME = "Stablecoin quotes with Euros - 2";
/** The twin id its page payload carries (ids name tables, never a variant number). */
export const CB_USDC_ID = "coinbaseusdc";
/** Its books: the two USDC books. */
export const CB_USDC_PRODUCTS = ["USDC-GBP", "USDC-EUR"] as const satisfies readonly CbProduct[];
/** 25 of the book's currency a rung: £25 on USDC-GBP, €25 on USDC-EUR. */
export const CB_USDC_RUNG = 25;
/** What `stepMinute`'s 100 is divided by to make its rung 25: prints go in × this, sizes and P&L come out ÷ it. */
export const CB_USDC_FACTOR = CB_RUNG / CB_USDC_RUNG;
/** Six rungs a book (three a side), as every arm. */
export const CB_USDC_RUNGS_A_BOOK = 6;
/**
 * Deviation 1 (2026-10-29; Davies: "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整"): $25 a rung from the switch, the
 * base's $100 (`CB_RUNG_USD`) ÷ `CB_USDC_FACTOR`, so the arm stays a quarter of the others' size; $300 on the two books.
 */
export const CB_USDC_RUNG_USD = CB_RUNG_USD / CB_USDC_FACTOR;
export const CB_USDC_LEASE = "cb-usdc";
export const CB_USDC_TABLES = { state: "cb_usdc_state", events: "cb_usdc_events", trips: "cb_usdc_trips", minutes: "cb_usdc_minutes", days: "cb_usdc_days" } as const;

/** Its capital in pounds: £25 × 6 on the GBP book and €25 × 6 on the EUR book at `eurGbp` pounds a euro (≈ £281 at 0.875). */
export const cbUsdcCapitalGbp = (eurGbp: number) => CB_USDC_RUNG * CB_USDC_RUNGS_A_BOOK * (1 + eurGbp);

/** A print as the engine reads it at this arm's size: `cbPrint`'s, its size × `CB_USDC_FACTOR`. */
export function cbUsdcPrint(book: CbProduct, r: { trade_id: number | string; ts: string; price: number | string; size: number | string; side: string }): Print {
  const p = cbPrint(book, r);
  return { ...p, qty: p.qty * CB_USDC_FACTOR };
}

/** A round trip the engine wrote at its (×4) size, back at this arm's: coins, notional and P&L ÷ `CB_USDC_FACTOR`; prices as they are. */
export function cbUsdcTrip(t: Trip): Trip {
  const f = CB_USDC_FACTOR;
  return { ...t, qty: t.qty / f, nq: t.nq / f, notionalUsd: t.notionalUsd / f, pnlUsd: t.pnlUsd / f };
}

/** An event's sizes at this arm's: a fill's pounds, the minute's printed value and every print's size ÷ `CB_USDC_FACTOR`. */
export function cbUsdcEventDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const f = CB_USDC_FACTOR, out: Record<string, unknown> = { ...detail };
  if (typeof out.usd === "number") out.usd = out.usd / f;
  if (typeof out.minuteGbp === "number") out.minuteGbp = out.minuteGbp / f;
  const p = out.print as { qty?: number } | undefined;
  if (p && typeof p.qty === "number") out.print = { ...p, qty: p.qty / f };
  return out;
}

/** An empty record starting at `start`: flat rungs on the two books, `fed` the newest trade id each had. */
export function cbUsdcNewState(start: number, fed: Record<string, number>): CbQuoteState {
  return {
    lastMinute: start - M, startedAt: start,
    books: Object.fromEntries(CB_USDC_PRODUCTS.map((b) => [b, newBookState(b as unknown as QuoteBook)])) as unknown as Record<CbProduct, BookState>,
    fed: fed as Record<CbProduct, number>,
  };
}

/**
 * Decide every minute the recorder has covered for the two USDC books and not yet decided, at most `CB_MAX_MINUTES`, one
 * minute behind that coverage, with the rates held through a closure. Idempotent by natural keys, as `runCbHold` is.
 */
export async function runCbUsdc(d: { db: Db; now: number; holder: string; rec: CbRecState | null }): Promise<CbQuoteReport> {
  const T = CB_USDC_TABLES;
  const report: CbQuoteReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, errors: [], report: false };
  const held = await d.db.claim("agent_locks", `name=eq.${CB_USDC_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + CB_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const curs = d.rec?.cursors ?? {};
    if (!CB_USDC_PRODUCTS.every((b) => curs[b])) return { ...report, skipped: "the recorder has not covered every book yet" };
    const covered = Math.min(...CB_USDC_PRODUCTS.map((b) => curs[b]!.coveredTo));
    const horizonAll = minuteOf(covered) - M;
    const rows = await d.db.select<{ state: CbQuoteState | Record<string, never> }>(T.state, "id=eq.1&select=state");
    let st = rows[0]?.state as CbQuoteState | undefined;
    if (!st || !("books" in st)) {
      const fed: Record<string, number> = {};
      for (const b of CB_USDC_PRODUCTS) {
        const top = await d.db.select<{ trade_id: number }>("cb_trades", `product=eq.${b}&select=trade_id&order=trade_id.desc&limit=1`);
        fed[b] = top[0] ? Number(top[0].trade_id) : 0;
      }
      st = cbUsdcNewState(cbHoldStart(d.now), fed);
    }
    const first = st.lastMinute + M, horizon = Math.min(horizonAll, st.lastMinute + CB_MAX_MINUTES * M, minuteOf(d.now) - M);
    if (horizon < first) { await save(d, st, report); return { ...report, skipped: "nothing new to decide" }; }
    const series = async (table: string, kind: string, from: number) => (await d.db.selectAll<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(from)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    const bars = async (table: string, kind: string) => {
      const win = await series(table, kind, first - QUOTE_FX_LOOKBACK_MS);
      const anchor = await d.db.select<{ t: string; value: number }>(table,
        `kind=eq.${encodeURIComponent(kind)}&t=lt.${enc(first - QUOTE_FX_LOOKBACK_MS)}&t=gte.${enc(first - CB_HOLD_MS)}&select=t,value&order=t.desc&limit=1`);
      return [...anchor.map((r) => [msOf(r.t), Number(r.value)] as [number, number]), ...win];
    };
    const gbpBars = await bars("agent_quote_inputs", "fx");
    const eurBars = await bars("cb_quote_inputs", "fx:EURUSD");
    const hours = await series("agent_quote_inputs", CB_FAIR_KIND.USDC, first - DAY);
    // Deviation 1 (2026-10-29): $25 a rung from the switch (the engine's $100 ÷ 4), on the rates this run decides its first minute on.
    cbUsdSwitch(st, first, cbHoldBarAt(first, gbpBars)?.[1] ?? null, cbHoldBarAt(first, eurBars)?.[1] ?? null);
    const trips: ReturnType<typeof cbTripRow>[] = [], events: ReturnType<typeof cbEventRow>[] = [], minutes: ReturnType<typeof cbMinuteRow>[] = [];
    for (const b of CB_USDC_PRODUCTS) {
      const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("cb_trades",
        `product=eq.${b}&trade_id=gt.${st.fed[b]}&ts=gte.${enc(first)}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=product.asc,trade_id.asc`);
      const prints = pRows.map((r) => cbUsdcPrint(b, r)).filter((p) => p.ts >= first);
      report.prints += prints.length;
      let j = 0;
      for (let t = first; t <= horizon; t += M) {
        const mine: Print[] = [];
        while (j < prints.length && prints[j].ts < t + M) { mine.push(prints[j]); j++; }
        const bar = cbHoldBarAt(t, gbpBars), eb = cbHoldBarAt(t, eurBars), window = fairHours(t, hours);
        const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, median(window), cbInUsd(st, t));
        const inp: MinuteInputs = { ...io, fairU: cbInBlackout(t) ? null : io.fairU, prints: mine };
        const out = stepMinute(st.books[b], t, inp);
        // The minute's record at this arm's size: the printed value as recorded (the engine saw it × 4).
        const row = cbMinuteRow(b, t, bar, CB_BOOK[b].quote === "EUR" ? eb : null, window.length, inp, io.xGbp);
        minutes.push({ ...row, vol: Number(row.vol) / CB_USDC_FACTOR });
        if (io.xGbp != null) st.xGbp = { ...st.xGbp, [b]: io.xGbp };
        const xNow = st.xGbp?.[b] ?? (CB_BOOK[b].quote === "GBP" ? 1 : null);
        const entered = (st.xEntry ??= {})[b] ??= {};
        for (const x0 of out.trips) {
          const x = cbUsdcTrip(x0);
          const key = `${x.side}|${x.k}`;
          const xe = entered[key] ?? x.xEntry;
          delete entered[key];
          const c = cbStopExit(x, b);
          trips.push(cbTripRow(b, xNow == null ? c : cbTripInPounds(c, xNow, xe)));
        }
        for (const e of out.events) if (e.kind === "fill" && xNow != null) entered[`${e.side}|${e.k}`] = xNow;
        events.push(...out.events.map((e) => {
          const r = cbEventRow(b, e);
          return { ...r, detail: cbUsdcEventDetail(r.detail as Record<string, unknown>) };
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
    try { await d.db.update("agent_locks", `name=eq.${CB_USDC_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

async function save(d: { db: Db; now: number }, st: CbQuoteState, report: CbQuoteReport) {
  const key = faultKey(report.errors);
  report.report = reportDue(st.fault ?? null, key, d.now);
  if (!key) delete st.fault; else if (report.report) st.fault = { key, at: d.now };
  const errors = report.errors;
  await d.db.upsert(CB_USDC_TABLES.state, [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: errors.length ? errors.join(" | ").slice(0, 500) : null }], "id");
}

/**
 * The arm's own shape for the Agents page, over `readCoinbaseArm`'s view (cbQuotesView, frozen: four books at 100 a rung); the
 * dashboard reads it through `readCoinbaseUsd` (cb_page.ts), in dollars, since its Deviation 1. Its two books alone; its capital `cbUsdcCapitalGbp` at the view's pounds a euro; what its rungs hold and quote (`costGbp`,
 * `valueGbp`, `unrealisedGbp`, each held rung's base, cost and unrealised) ÷ `CB_USDC_FACTOR`, since the engine's state keeps
 * them at its ×4 size; realised and today as the trips table has them (already at this arm's size). Dollars at the view's
 * own rate. null as `readCoinbaseArm` is.
 */
// deno-lint-ignore no-explicit-any
export function cbUsdcView(v: any) {
  const f = CB_USDC_FACTOR, mine = (b: string) => (CB_USDC_PRODUCTS as readonly string[]).includes(b);
  const rate = v.capitalGbp > 0 ? v.capitalUsd / v.capitalGbp : 0;
  const capitalGbp = cbUsdcCapitalGbp(Number(v.eurGbp) || 0);
  const costGbp = v.costGbp / f, valueGbp = v.valueGbp / f, unrealisedGbp = v.unrealisedGbp / f;
  return {
    ...v,
    capitalGbp, costGbp, valueGbp, unrealisedGbp,
    capitalUsd: capitalGbp * rate, costUsd: costGbp * rate, valueUsd: valueGbp * rate, unrealisedUsd: unrealisedGbp * rate,
    detail: {
      ...v.detail,
      books: v.detail.books.filter((x: { book: string }) => mine(x.book)),
      // deno-lint-ignore no-explicit-any
      rungs: v.detail.rungs.filter((r: any) => mine(r.book)).map((r: any) => (r.held
        ? { ...r, held: { ...r.held, base: r.held.base / f, costGbp: r.held.costGbp / f, unrealisedGbp: r.held.unrealisedGbp == null ? null : r.held.unrealisedGbp / f } }
        : r)),
    },
  };
}
