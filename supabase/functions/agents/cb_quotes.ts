// The forward PAPER test of PR5's frozen rule on Coinbase's four stablecoin books (USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR),
// TESTING's "Stablecoin quotes with Euros" ("Stablecoin quotes Coinbase" until 2026-10-10). Davies, 2026-10-10:
// "先建起来吧，并且和Revolute X对比看哪个更好，投入的话资金该如何安排". Pre-registered in
// docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md; the venue screen that chose it is
// docs/agents/reviews/2026-10-09-stablecoin-venues.md. It never calls an order endpoint and holds no key: its inputs are the
// recorder's prints (`cb_rec.ts`, 0112), PR5's own stored GBP/USD minutes and USD-book hourly closes (`agent_quote_inputs`,
// what PR5's paper engine and its twins decide on), and Yahoo's EURUSD=X minutes, which it stores itself.
//
// THE RULE IS PR5's, NOT A COPY: each minute of each book is `stepMinute` from quotes.ts, the function PR5's paper engine
// and its realistic twins' replicas run, called unchanged (its freeze line, PR5-W's, forbids editing it). What differs
// between the venues is passed through its inputs alone, exactly:
//   * Each book's own currency. A book's X, as `stepMinute` is given it, is 1, and its fairU is the book's own fair (the
//     stablecoin's dollar fair over its currency's dollar rate: GBP/USD, or Yahoo's EUR/USD for the EUR books). So one
//     rung is `QUOTE_SIZE_USD` = 100 of the book's currency, £100 on a GBP book and €100 on a EUR book, the 10 % volume
//     cap is in that currency, and every P&L `stepMinute` writes (`pnlUsd`) is too. The driver turns a round trip into
//     pounds at the book's pounds per unit (`xGbp`: 1, or EUR/USD ÷ GBP/USD) when it closes, and keeps the pounds per
//     unit each position was entered at (`xEntry` in its state). Deviation 1 of the pre-registration (2026-10-10, before
//     the window opened; Davies: "每一档100磅/100欧元"): until then a EUR book's X was its pounds per euro, so its rung was
//     £100's worth of euros. A minute with either rate older than ten minutes is dark, as PR5's is.
//   * The price step. `stepMinute` prices in 0.0001 steps; USDT-EUR's is 0.00001, so that book's prices go in ×10 and its
//     sizes ÷10 (`CB_BOOK.scale`): every price, size and P&L comes back the same once scaled back (pinned).
//   * The stop's cost. `stepMinute` charges PR5's 0.09 % + 0.0067 %; Coinbase's stable pairs charge a taker 0.0045 %, plus
//     half the book's touch (read 2026-10-09). A stopped trip's exit is moved from PR5's cost to Coinbase's afterwards,
//     from the same last print (`cbStopExit`), and nothing else depends on it.
// Fills therefore need a print strictly THROUGH a resting quote, as PR5's do. The driver runs one minute behind the
// recorder's coverage, so a minute's prints are complete before it is decided.

import type { Db } from "./db.ts";
import {
  fairHours, fetchFx, fxBarAt, median, newBookState, QUOTE_FEE, QUOTE_FX_LOOKBACK_MS, QUOTE_HALF_SPREAD, QUOTE_TICK, stepMinute,
  type BookState, type MinuteInputs, type Print, type QuoteBook, type QuoteEvent, type Trip,
} from "./quotes.ts";
import { CB_PRODUCTS, type CbProduct, type CbRecState } from "./cb_rec.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Coinbase's taker fee on its `fx_stablecoin` pairs: the 24-hour stop pays it (Coinbase Exchange's fees page, 0.0045 %). */
export const CB_TAKER = 0.000045;
/**
 * Each book: its quote currency, its coin, its price step, how its prices are scaled into `stepMinute`'s 0.0001 grid, and
 * half its touch (read keyless 2026-10-09 ~22:25 UTC, five reads 20 s apart: 1.323, 1.324, 1.12 and 0.224 bps;
 * docs/agents/backtests/scq_venues/inputs/touch.json), what a stop crossing it pays beside the fee.
 */
export const CB_BOOK: Record<CbProduct, { quote: "GBP" | "EUR"; coin: "USDC" | "USDT"; tick: number; scale: number; halfSpread: number }> = {
  "USDC-GBP": { quote: "GBP", coin: "USDC", tick: 1e-4, scale: 1, halfSpread: 0.0000662 },
  "USDT-GBP": { quote: "GBP", coin: "USDT", tick: 1e-4, scale: 1, halfSpread: 0.0000662 },
  "USDC-EUR": { quote: "EUR", coin: "USDC", tick: 1e-4, scale: 1, halfSpread: 0.000056 },
  "USDT-EUR": { quote: "EUR", coin: "USDT", tick: 1e-5, scale: 10, halfSpread: 0.0000112 },
};
/** 100 of the book's currency a rung (£100 on a GBP book, €100 on a EUR book; Deviation 1), six a book. */
export const CB_RUNG = 100;
/** The capital in each currency: £1,200 on the two GBP books, €1,200 on the two EUR books. */
export const CB_CAPITAL = { GBP: CB_RUNG * 6 * 2, EUR: CB_RUNG * 6 * 2 } as const;
/** The capital in pounds, the euros at `eurGbp` pounds a euro. */
export const cbCapitalGbp = (eurGbp: number) => CB_CAPITAL.GBP + CB_CAPITAL.EUR * eurGbp;
/** The USD book PR5 reads each coin's fair from (its stored hourly closes, `agent_quote_inputs`). */
export const CB_FAIR_KIND: Record<"USDC" | "USDT", string> = { USDC: "fair:USDC-USD", USDT: "fair:USDT-USD" };
/** Minutes decided in one call at most (a call's 30 s), and where an empty record starts at the latest. */
export const CB_MAX_MINUTES = 60;
export const CB_LEASE = "cb-quotes";
export const CB_LEASE_MS = 25e3;

// -------------------------------------------------------------------------------------------------------- the inputs

/** A recorded print as `stepMinute` reads it: ticks on its 0.0001 grid, and the size scaled the other way (`CB_BOOK.scale`). */
export function cbPrint(book: CbProduct, r: { trade_id: number | string; ts: string | number; price: number | string; size: number | string; side: string }): Print {
  const s = CB_BOOK[book].scale;
  return { id: String(r.trade_id), ts: msOf(r.ts), ticks: Math.round(Number(r.price) * s / QUOTE_TICK), qty: Number(r.size) / s, side: r.side === "buy" ? "buy" : "sell" };
}

/**
 * A minute's X and fairU for `stepMinute`, from GBP/USD (`gbp`), EUR/USD (`eur`) and the coin's dollar fair (`fairU`), and
 * the book's pounds per unit (`xGbp`). X is 1 (Deviation 1: the rule's money is the book's own currency) and fairU the
 * book's fair, the dollar fair over the book's currency's dollar rate, scaled with its prices, so that fairU / X is the
 * book's fair on `stepMinute`'s grid. `xGbp` is 1 for a GBP book and EUR/USD ÷ GBP/USD for a EUR book. Either rate dark,
 * the minute is dark: every book needs GBP/USD (its pounds), a EUR book EUR/USD too.
 */
export function cbMinuteInputs(book: CbProduct, gbp: number | null, eur: number | null, fairU: number | null): { x: number | null; fairU: number | null; xGbp: number | null } {
  const b = CB_BOOK[book];
  const xGbp = !gbp ? null : b.quote === "GBP" ? 1 : eur ? eur / gbp : null;
  if (xGbp == null) return { x: null, fairU: null, xGbp: null };
  const own = b.quote === "GBP" ? gbp! : eur!;
  return { x: 1, fairU: fairU ? (fairU / own) * b.scale : null, xGbp };
}

/**
 * A closed round trip in pounds: `stepMinute` wrote its notional and P&L in its X's money (`notionalUsd / nq` is the X it
 * closed at: 1 from Deviation 1, a EUR book's pounds per euro before it), so each is turned back into the book's currency
 * and then into pounds at `xGbp`, the book's pounds per unit when it closed; `xEntry` is the pounds per unit it was
 * entered at. A GBP book's trip is unchanged.
 */
export function cbTripInPounds(t: Trip, xGbp: number, xEntry: number): Trip {
  const xr = t.nq > 0 ? t.notionalUsd / t.nq : 1;
  return { ...t, xEntry, notionalUsd: (t.notionalUsd / xr) * xGbp, pnlUsd: (t.pnlUsd / xr) * xGbp };
}

/**
 * A stopped trip moved from PR5's stop cost to Coinbase's: the same last print `c`, recovered from the exit `stepMinute`
 * wrote (c × (1 ∓ PR5's cost)), crossed at Coinbase's taker fee and half the book's touch. Its P&L moves by the size times
 * the difference, in pounds at the rate it closed at. A maker exit is unchanged.
 */
export function cbStopExit(t: Trip, book: CbProduct): Trip {
  if (t.how !== "taker") return t;
  const pr5 = QUOTE_FEE + QUOTE_HALF_SPREAD, cb = CB_TAKER + CB_BOOK[book].halfSpread;
  const c = t.side === "bid" ? t.exit / (1 - pr5) : t.exit / (1 + pr5);
  const exit = t.side === "bid" ? c * (1 - cb) : c * (1 + cb);
  const xr = t.nq > 0 ? t.notionalUsd / t.nq : 1;
  const d = t.side === "bid" ? t.qty * (exit - t.exit) : t.qty * (t.exit - exit);
  return { ...t, exit, pnlUsd: t.pnlUsd + d * xr };
}

// ------------------------------------------------------------------------------------------------------------ rows

/** A round trip as `cb_quote_trips` keeps it: prices in the book's currency, size in coins, money in pounds. */
export function cbTripRow(book: CbProduct, t: Trip) {
  const s = CB_BOOK[book].scale;
  return {
    book, side: t.side, k: t.k, t_entry: iso(t.tEntry), fill_ts: iso(t.fillTs), fill_trade_id: Number(t.fillId), entry: Number((t.entry / s).toFixed(10)), qty: t.qty * s,
    x_entry: t.xEntry, fair_entry: t.fairEntry == null ? null : t.fairEntry / s, entry_oid: t.entryOid, t_exit: iso(t.tExit), exit: Number((t.exit / s).toFixed(10)),
    how: t.how, exit_trade_id: t.exitPrintId == null ? null : Number(t.exitPrintId), exit_oid: t.exitOid, notional_gbp: t.notionalUsd, pnl_gbp: t.pnlUsd,
  };
}

/** An event as `cb_quote_events` keeps it: its fair and prices back in the book's currency. */
export function cbEventRow(book: CbProduct, e: QuoteEvent) {
  const s = CB_BOOK[book].scale;
  const detail: Record<string, unknown> = { ...e.detail };
  for (const k of ["fair", "px"]) if (typeof detail[k] === "number") detail[k] = (detail[k] as number) / s;
  return { book, minute: iso(e.minute), side: e.side, k: e.k, kind: e.kind, ticks: e.ticks, detail };
}

/**
 * The minute's record (`cb_quote_minutes`): what it was decided on — X, the book's fair, how many closes made fairU — and
 * its prints as a bar (each aggressor side's lowest and highest price, the last print and its aggressor, the minute's
 * volume in the book's currency), all PR5's simulator reads of a minute (docs/agents/backtests/scq_venues/scripts/bars.py,
 * proven equal to the prints), so the test can be replayed after the prints are pruned.
 */
export function cbMinuteRow(book: CbProduct, t: number, bar: [number, number] | null, eurBar: [number, number] | null, hoursN: number, inp: MinuteInputs, xGbp: number | null) {
  const s = CB_BOOK[book].scale, tick = CB_BOOK[book].tick;
  const ps = inp.prints;
  const px = (p: Print) => Number((p.ticks * tick).toFixed(8));
  const ext = (side: "buy" | "sell", f: (a: number, b: number) => number) => {
    const xs = ps.filter((p) => p.side === side).map(px);
    return xs.length ? xs.reduce(f) : null;
  };
  const last = ps.at(-1) ?? null;
  return {
    // `x` is the book's pounds per unit (0112's column), not the rule's X (1 from Deviation 1).
    book, minute: iso(t), x: xGbp, x_t: bar ? iso(bar[0]) : null, eur_t: eurBar ? iso(eurBar[0]) : null,
    fair: inp.x && inp.fairU ? inp.fairU / inp.x / s : null, hours_n: hoursN, prints_n: ps.length,
    vol: ps.reduce((a, p) => a + p.qty * s * px(p), 0),
    sell_lo: ext("sell", Math.min), sell_hi: ext("sell", Math.max), buy_lo: ext("buy", Math.min), buy_hi: ext("buy", Math.max),
    last: last ? px(last) : null, last_side: last?.side ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------- driver

export type CbQuoteState = {
  lastMinute: number;
  books: Record<CbProduct, BookState>;
  /** The newest trade id each book has fed to the rule. */
  fed: Record<CbProduct, number>;
  startedAt: number;
  /** The fault last reported to `ops_errors`, at most hourly while it lasts. */
  fault?: { key: string; at: number };
  /** Each book's pounds per unit at its last lit minute (Deviation 1): what a round trip closing is turned into pounds at. */
  xGbp?: Partial<Record<CbProduct, number>>;
  /** Each held rung's pounds per unit when it filled, by `side|k` (Deviation 1): its entry's cost in pounds. */
  xEntry?: Partial<Record<CbProduct, Record<string, number>>>;
};
export type CbQuoteReport = {
  skipped?: string; minutes: number; from: number | null; to: number | null; prints: number; fills: number; exits: number; stops: number;
  orders: number; refused: number; errors: string[];
  /** Whether this run's faults are due at `ops_errors` (`agents.cb_rec`): new, or an hour since they were last reported. */
  report: boolean;
};
export type CbQuoteDeps = { db: Db; now: number; holder: string; fetchImpl?: typeof fetch; rec: CbRecState | null };

/**
 * Decide every minute the recorder has covered for all four books and not yet decided, at most `CB_MAX_MINUTES`, one
 * minute behind that coverage. An empty record starts at the first whole minute every book's record covers. Idempotent by
 * natural keys: a run that dies after writing re-decides the same minutes the same way.
 */
export async function runCbQuotes(d: CbQuoteDeps): Promise<CbQuoteReport> {
  const report: CbQuoteReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, errors: [], report: false };
  const f = d.fetchImpl ?? fetch;
  const held = await d.db.claim("agent_locks", `name=eq.${CB_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + CB_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const curs = d.rec?.cursors ?? {};
    if (!CB_PRODUCTS.every((b) => curs[b])) return { ...report, skipped: "the recorder has not covered every book yet" };
    const covered = Math.min(...CB_PRODUCTS.map((b) => curs[b]!.coveredTo));
    const horizonAll = minuteOf(covered) - M;                    // the last minute every book's prints are complete for
    // EUR/USD: Yahoo's minutes, stored as the test reads them (as PR5's paper engine stores GBP/USD).
    try {
      const fx = await fetchFx(d.now, f, "EURUSD=X");
      if (fx.length) await d.db.upsert("cb_quote_inputs", fx.map(([t, v]) => ({ kind: "fx:EURUSD", t: iso(t), value: v })), "kind,t");
    } catch (e) { report.errors.push(`eurusd: ${msg(e)}`); }
    const rows = await d.db.select<{ state: CbQuoteState | Record<string, never> }>("cb_quote_state", "id=eq.1&select=state");
    let st = rows[0]?.state as CbQuoteState | undefined;
    if (!st || !("books" in st)) {
      const start = Math.max(...CB_PRODUCTS.map((b) => minuteOf(Date.parse(curs[b]!.fromTs)) + M));
      st = {
        lastMinute: start - M, startedAt: start,
        books: Object.fromEntries(CB_PRODUCTS.map((b) => [b, newBookState(b as unknown as QuoteBook)])) as Record<CbProduct, BookState>,
        fed: Object.fromEntries(CB_PRODUCTS.map((b) => [b, 0])) as Record<CbProduct, number>,
      };
    }
    const first = st.lastMinute + M, horizon = Math.min(horizonAll, st.lastMinute + CB_MAX_MINUTES * M, minuteOf(d.now) - M);
    if (horizon < first) { await save(d, st, report); return { ...report, skipped: "nothing new to decide" }; }
    const series = async (table: string, kind: string, from: number) => (await d.db.selectAll<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(from)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    const gbpBars = await series("agent_quote_inputs", "fx", first - QUOTE_FX_LOOKBACK_MS);
    const eurBars = await series("cb_quote_inputs", "fx:EURUSD", first - QUOTE_FX_LOOKBACK_MS);
    const hours = { USDC: await series("agent_quote_inputs", CB_FAIR_KIND.USDC, first - DAY), USDT: await series("agent_quote_inputs", CB_FAIR_KIND.USDT, first - DAY) };
    const trips: ReturnType<typeof cbTripRow>[] = [], events: ReturnType<typeof cbEventRow>[] = [], minutes: ReturnType<typeof cbMinuteRow>[] = [];
    for (const b of CB_PRODUCTS) {
      const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("cb_trades",
        `product=eq.${b}&trade_id=gt.${st.fed[b]}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=product.asc,trade_id.asc`);
      const prints = pRows.map((r) => cbPrint(b, r)).filter((p) => p.ts >= first);
      report.prints += prints.length;
      let j = 0;
      for (let t = first; t <= horizon; t += M) {
        const mine: Print[] = [];
        while (j < prints.length && prints[j].ts < t + M) { mine.push(prints[j]); j++; }
        const bar = fxBarAt(t, gbpBars), eb = fxBarAt(t, eurBars), window = fairHours(t, hours[CB_BOOK[b].coin]);
        const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, median(window));
        const inp: MinuteInputs = { ...io, prints: mine };
        const out = stepMinute(st.books[b], t, inp);
        minutes.push(cbMinuteRow(b, t, bar, CB_BOOK[b].quote === "EUR" ? eb : null, window.length, inp, io.xGbp));
        // Pounds (Deviation 1): a trip closing at the book's last known pounds per unit, from the one its rung filled at.
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
    if (events.length) await d.db.upsert("cb_quote_events", events, "book,minute,side,k,kind");
    if (trips.length) await d.db.upsert("cb_quote_trips", trips, "book,side,k,t_entry");
    if (minutes.length) await d.db.upsert("cb_quote_minutes", minutes, "book,minute");
    st.lastMinute = horizon;
    await save(d, st, report);
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    report.report = true;
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${CB_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

async function save(d: CbQuoteDeps, st: CbQuoteState, report: CbQuoteReport) {
  const key = faultKey(report.errors);
  report.report = reportDue(st.fault ?? null, key, d.now);
  if (!key) delete st.fault; else if (report.report) st.fault = { key, at: d.now };
  const errors = report.errors;
  await d.db.upsert("cb_quote_state", [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: errors.length ? errors.join(" | ").slice(0, 500) : null }], "id");
}

