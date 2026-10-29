// The Coinbase arms' rate at second resolution (cb_fx.ts; Deviation 7 of the base test, 6 of the weekend variant, 5 of "- 1",
// 4 of "- 2"). Pins: (1) the constants: the switch's floor, the cap at t + 58 s and the 120 s freshness, the recorder's own
// `FX_STALE_MS`; (2) the reads: every TrueFX read and only Kraken's MARKED reads, at the source's own mid; (3) the cap: a read
// that arrived at t + 58 s prices minute t, one at t + 59 s does not; (4) the order: TrueFX, or Kraken's marked read when it is
// newer, never an unmarked one; (5) freshness and the fallbacks: no fresh read → Yahoo's bar (`fxBarAt`) → dark, or for a
// held arm its held bar, holding the last fast read when it is no older than that bar; (6) the switch, once, never before the
// floor, and before it the arm's own lookup exactly; (7) through the base driver on the 10-29 world: each minute's fair on the
// read the rule picks, its source recorded and counted; an empty `fx_ticks` gives today's Yahoo minutes; a world before the
// floor reads no `fx_ticks` and writes no source; (8) through all four arms on a Friday close: in session the fast read, then
// Yahoo's last bar for its ten minutes, then the base test dark and every held arm on the last fast read for 60 hours, across
// two calls; and the minutes each arm leaves lit are exactly those it lit with no `fx_ticks` at all.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CB_FX_CUTOFF_MS, CB_FX_FRESH_MS, CB_FX_NOT_BEFORE, cbFastAt, cbFxAt, cbFxCount, cbFxLive, cbFxReadsOf, cbFxSwitch, cbRatesAt, emptyFx,
  type CbFxReads, type FxTickRow,
} from "./cb_fx.ts";
import { FX_STALE_MS } from "./fx_rec.ts";
import { fxBarAt } from "./quotes.ts";
import { CB_HOLD_MS, cbHoldBarAt, cbHoldNewState, runCbHold } from "./cb_hold.ts";
import { runCbQuotes, type CbQuoteState } from "./cb_quotes.ts";
import { CB_USDC_PRODUCTS, cbUsdcNewState, runCbUsdc } from "./cb_usdc.ts";
import { CB_NUDGE_PRODUCTS, runCbNudge } from "./cb_nudge.ts";
import { CB_PRODUCTS, type CbCursor, type CbProduct } from "./cb_rec.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, S = 1e3;
const iso = (ms: number) => new Date(ms).toISOString();

type Tick = { source: "truefx" | "kraken"; pair: "GBPUSD" | "EURUSD"; at: number; mid: number; fallback?: boolean };
/** `fx_ticks` rows as the recorder (0172) stores them: a row per source, pair and minute, its reads as parallel arrays. */
function tickRows(ticks: Tick[]): FxTickRow[] {
  const by = new Map<string, FxTickRow & Row>();
  for (const k of [...ticks].sort((a, b) => a.at - b.at)) {
    const minute = Math.floor(k.at / M) * M, key = `${k.source}|${k.pair}|${minute}`;
    if (!by.has(key)) by.set(key, { source: k.source, pair: k.pair, minute: iso(minute), recv_ms: [], src_ms: null, bid: [], ask: [], mid: [], fallback: [], reads: 0, failed: 0, last_error: null });
    const r = by.get(key)!, mid = Math.round(k.mid * 1e6);
    r.recv_ms.push(k.at - minute); (r.bid as number[]).push(mid - 3); (r.ask as number[]).push(mid + 3); r.mid.push(mid); r.fallback.push(k.fallback ?? false);
    r.reads = Number(r.reads) + 1;
  }
  return [...by.values()];
}
const tf = (pair: Tick["pair"], at: number, mid: number): Tick => ({ source: "truefx", pair, at, mid });
const kr = (pair: Tick["pair"], at: number, mid: number, fallback = true): Tick => ({ source: "kraken", pair, at, mid, fallback });

Deno.test("the constants: no minute before 2026-10-29 10:00 UTC, the cap at t + 58 s, fresh for 120 s (the recorder's own staleness)", () => {
  assertEquals([CB_FX_NOT_BEFORE, CB_FX_CUTOFF_MS, CB_FX_FRESH_MS], [Date.UTC(2026, 9, 29, 10), 58_000, 120_000]);
  assertEquals(CB_FX_FRESH_MS, FX_STALE_MS);
});

Deno.test("the reads: every TrueFX read, only Kraken's marked reads, at the source's own mid, oldest first", () => {
  const t = Date.UTC(2026, 9, 29, 10, 0);
  const r = cbFxReadsOf(tickRows([tf("GBPUSD", t + 1500, 1.33123), tf("GBPUSD", t + 700, 1.33121), kr("GBPUSD", t + 2000, 1.4, false), kr("GBPUSD", t + 4000, 1.3313),
    tf("EURUSD", t + 900, 1.16)]));
  assertEquals(r.GBPUSD.truefx.map((x) => [x.at - t, x.mid]), [[700, 1.33121], [1500, 1.33123]]);
  assertEquals(r.GBPUSD.kraken.map((x) => [x.at - t, x.mid, x.source]), [[4000, 1.3313, "kraken"]]);
  assertEquals(r.EURUSD.truefx.map((x) => x.mid), [1.16]);
  assertEquals(r.EURUSD.kraken, []);
});

Deno.test("the cap: a read that arrived at t + 58 s prices minute t, one that arrived at t + 59 s does not", () => {
  const t = Date.UTC(2026, 9, 29, 11, 0);
  const r = cbFxReadsOf(tickRows([tf("GBPUSD", t + 10 * S, 1.3301), tf("GBPUSD", t + 58 * S, 1.3302), tf("GBPUSD", t + 59 * S, 1.3399)])).GBPUSD;
  assertEquals(cbFastAt(r, t)?.mid, 1.3302);
  assertEquals(cbFxAt(t, r, [], null), { x: 1.3302, at: t + 58 * S, src: "truefx" });
  const later = cbFxReadsOf(tickRows([tf("GBPUSD", t + 10 * S, 1.3301), tf("GBPUSD", t + 59 * S, 1.3399)])).GBPUSD;
  assertEquals(cbFxAt(t, later, [], null), { x: 1.3301, at: t + 10 * S, src: "truefx" });
  assertEquals(cbFxAt(t + M, later, [], null).x, 1.3399);                    // the next minute's cap reaches it
});

Deno.test("the order: TrueFX; Kraken's marked read when it is newer (TrueFX failed or froze since); an unmarked Kraken read never", () => {
  const t = Date.UTC(2026, 9, 29, 11, 0);
  const both = cbFxReadsOf(tickRows([tf("GBPUSD", t + 20 * S, 1.33), kr("GBPUSD", t + 10 * S, 1.31)])).GBPUSD;
  assertEquals(cbFxAt(t, both, [], null).src, "truefx");
  const krNewer = cbFxReadsOf(tickRows([tf("GBPUSD", t - 30 * S, 1.33), kr("GBPUSD", t + 40 * S, 1.31)])).GBPUSD;
  assertEquals(cbFxAt(t, krNewer, [], null), { x: 1.31, at: t + 40 * S, src: "kraken" });
  const unmarked = cbFxReadsOf(tickRows([tf("GBPUSD", t - 30 * S, 1.33), kr("GBPUSD", t + 40 * S, 1.31, false)])).GBPUSD;
  assertEquals(cbFxAt(t, unmarked, [], null), { x: 1.33, at: t - 30 * S, src: "truefx" });
});

Deno.test("fresh and the fallbacks: a read 120 s before the cap still counts, older falls to Yahoo's bar (fxBarAt), and with no bar the base test is dark", () => {
  const t = Date.UTC(2026, 9, 29, 11, 0);
  const bars: Array<[number, number]> = [[t - 2 * M, 1.25], [t - M, 1.26]];
  const edge = cbFxReadsOf(tickRows([tf("GBPUSD", t + CB_FX_CUTOFF_MS - CB_FX_FRESH_MS, 1.33)])).GBPUSD;
  assertEquals(cbFxAt(t, edge, bars, null), { x: 1.33, at: t - 62 * S, src: "truefx" });
  const stale = cbFxReadsOf(tickRows([tf("GBPUSD", t + CB_FX_CUTOFF_MS - CB_FX_FRESH_MS - 1, 1.33)])).GBPUSD;
  assertEquals(cbFxAt(t, stale, bars, null), { x: 1.26, at: t - M, src: "yahoo" });
  // Nothing in `fx_ticks` at all: today's rule, bar t − 1, exactly.
  assertEquals(cbFxAt(t, emptyFx().GBPUSD, bars, null), { x: 1.26, at: t - M, src: "yahoo" });
  assertEquals(cbFxAt(t, emptyFx().GBPUSD, bars, null).at, fxBarAt(t, bars)![0]);
  // No fresh read and no bar in ten minutes: dark.
  assertEquals(cbFxAt(t + 12 * M, stale, bars, null), { x: null, at: null, src: null });
});

Deno.test("a held arm in a closure: lit exactly where its held bar is, on the last fast read when it is no older than that bar, else the bar", () => {
  const close = Date.UTC(2026, 9, 30, 21, 0);                      // a Friday
  const bars: Array<[number, number]> = [[close - 2 * M, 1.25], [close - M, 1.251]];
  const hold = (u: number) => cbHoldBarAt(u, bars);
  const r = cbFxReadsOf(tickRows([tf("GBPUSD", close - 40 * S, 1.3301), tf("GBPUSD", close - 5 * S, 1.3302)])).GBPUSD;
  const sat = close + 20 * H;
  assertEquals(cbFxAt(sat, r, bars, hold), { x: 1.3302, at: close - 5 * S, src: "held:truefx" });
  assertEquals(cbFxAt(sat, r, bars, null), { x: null, at: null, src: null });                    // the base test: dark, as before
  // TrueFX's last read older than Yahoo's last bar: the bar is held, as before.
  const old = cbFxReadsOf(tickRows([tf("GBPUSD", close - 3 * M, 1.3301)])).GBPUSD;
  assertEquals(cbFxAt(sat, old, bars, hold), { x: 1.251, at: close - M, src: "held:yahoo" });
  // Kraken's marked read, last before the close: held as Kraken's.
  const k = cbFxReadsOf(tickRows([tf("GBPUSD", close - 5 * M, 1.33), kr("GBPUSD", close - 20 * S, 1.3305)])).GBPUSD;
  assertEquals(cbFxAt(sat, k, bars, hold).src, "held:kraken");
  // Past the hold, no bar: dark however recent the fast read (the lit minutes are the held bar's).
  assertEquals(cbFxAt(close - M + CB_HOLD_MS + M, r, bars, hold), { x: null, at: null, src: null });
});

Deno.test("the switch: written once, at the first minute at or after the floor; before it the arm's own lookup, exactly", () => {
  const st: { fxFrom?: number; fxCount?: Record<string, number> } = {};
  cbFxSwitch(st, CB_FX_NOT_BEFORE - M);
  assertEquals(st.fxFrom, undefined);
  cbFxSwitch(st, CB_FX_NOT_BEFORE + 7 * M);
  cbFxSwitch(st, CB_FX_NOT_BEFORE + 9 * M);
  assertEquals(st.fxFrom, CB_FX_NOT_BEFORE + 7 * M);
  assertEquals([cbFxLive(st, CB_FX_NOT_BEFORE + 6 * M), cbFxLive(st, CB_FX_NOT_BEFORE + 7 * M)], [false, true]);
  const t = CB_FX_NOT_BEFORE + 6 * M, gbp: Array<[number, number]> = [[t - 3 * M, 1.25]], eur: Array<[number, number]> = [[t - 2 * M, 1.1]];
  const fx = { GBPUSD: cbFxReadsOf(tickRows([tf("GBPUSD", t + 5 * S, 1.3)])).GBPUSD, EURUSD: { truefx: [], kraken: [] } as CbFxReads };
  assertEquals(cbRatesAt(st, t, gbp, eur, fx, fxBarAt, false), { bar: fxBarAt(t, gbp), eb: fxBarAt(t, eur), gbpSrc: null, eurSrc: null });
  assertEquals(cbRatesAt(st, t + M, gbp, eur, fx, fxBarAt, false), { bar: [t + 5 * S, 1.3], eb: [t - 2 * M, 1.1], gbpSrc: "truefx", eurSrc: "yahoo" });
  cbFxCount(st, "truefx"); cbFxCount(st, "truefx"); cbFxCount(st, null);
  assertEquals(st.fxCount, { truefx: 2, dark: 1 });
});

// ------------------------------------------------------------------------------------------------- through the drivers

const fetchNothing = ((url: string) => Promise.resolve(new Response(String(url).includes("/candles") ? "[]"
  : JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as unknown as typeof fetch;

/** Every Coinbase arm's tables on one world: Yahoo's bars at 1.25 / 1.10 until `ratesUntil`, the coins at $1, the ticks given. */
function world(t0: number, o: { ratesUntil: number; coveredTo: number; ticks: Tick[]; base?: boolean }) {
  const fx: Row[] = [], fair: Row[] = [], inputs: Row[] = [];
  for (let t = t0 - 20 * M; t <= o.ratesUntil; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); inputs.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let t = t0 - 20 * M; t <= o.coveredTo; t += M) inputs.push({ kind: "cb:USDT-USD", t: iso(t), value: 1.0 });
  for (let h = t0 - 30 * H; h < t0 + 3 * H; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const zero = Object.fromEntries(CB_PRODUCTS.map((b) => [b, 0])) as Record<CbProduct, number>;
  const usdc = (books: readonly string[]) => [{ id: 1, state: { ...cbUsdcNewState(t0, Object.fromEntries(books.map((b) => [b, 0]))),
    books: Object.fromEntries(Object.entries(cbUsdcNewState(t0, { "USDC-GBP": 0, "USDC-EUR": 0 }).books).filter(([b]) => books.includes(b))) }, last_minute: iso(t0 - M), updated_at: iso(0), last_error: null }];
  const { db, tables } = memDb({
    agent_locks: ["cb-quotes", "cb-hold", "cb-usdc", "cb-nudge"].map((name) => ({ name, lease_until: iso(0), holder: null })),
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: inputs, fx_ticks: tickRows(o.ticks),
    cb_quote_state: [], cb_quote_events: [], cb_quote_trips: [], cb_quote_minutes: [],
    cb_hold_state: [{ id: 1, state: cbHoldNewState(t0, zero), last_minute: iso(t0 - M), updated_at: iso(0), last_error: null }],
    cb_hold_events: [], cb_hold_trips: [], cb_hold_minutes: [], cb_hold_days: [],
    cb_usdc_state: usdc(CB_USDC_PRODUCTS), cb_usdc_events: [], cb_usdc_trips: [], cb_usdc_minutes: [], cb_usdc_days: [],
    cb_nudge_state: usdc(CB_NUDGE_PRODUCTS), cb_nudge_events: [], cb_nudge_trips: [], cb_nudge_minutes: [], cb_nudge_days: [],
    agent_book_levels: [], cb_trades: [],
  }, { now: () => t0 });
  // The base test starts at the recorder's first whole minute (t0); the other arms at their seeded state's.
  const cur = (): CbCursor => ({ from: 1, fromTs: iso(t0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: o.coveredTo });
  const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur()])) };
  return { db, tables, rec };
}
const minute = (rows: Row[], book: string, t: number) => rows.find((x) => x.book === book && x.minute === iso(t))!;

Deno.test("the base test on the 10-29 world: each minute priced on the read the rule picks, its source recorded and counted", async () => {
  const t0 = Date.UTC(2026, 9, 29, 10, 0);
  const ticks = [
    tf("GBPUSD", t0 - 30 * S, 1.26), tf("GBPUSD", t0 + M + 20 * S, 1.265), tf("GBPUSD", t0 + 2 * M + 58 * S, 1.27), tf("GBPUSD", t0 + 3 * M + 59 * S, 1.28),
    tf("EURUSD", t0 - 10 * S, 1.12), kr("EURUSD", t0 + M + 30 * S, 1.13), kr("EURUSD", t0 + 3 * M + 10 * S, 1.5, false),
  ];
  const w = world(t0, { ratesUntil: t0 + 10 * M, coveredTo: t0 + 5 * M + 1000, ticks });
  const r = await runCbQuotes({ db: w.db, now: t0 + 6 * M, holder: "b", fetchImpl: fetchNothing, rec: w.rec });
  assertEquals([r.errors, r.from, r.to], [[], t0, t0 + 4 * M]);
  const st = w.tables.cb_quote_state[0].state as CbQuoteState;
  assertEquals(st.fxFrom, t0);
  // USDC-GBP: the cap keeps 1.28 (arrived at t + 3 min 59 s) out of minute t + 3 and in minute t + 4.
  const gbp = [1.26, 1.265, 1.27, 1.27, 1.28], gbpAt = [t0 - 30 * S, t0 + M + 20 * S, t0 + 2 * M + 58 * S, t0 + 2 * M + 58 * S, t0 + 3 * M + 59 * S];
  for (let i = 0; i < 5; i++) {
    const m = minute(w.tables.cb_quote_minutes, "USDC-GBP", t0 + i * M);
    assertAlmostEquals(Number(m.fair), 1 / gbp[i], 1e-12, `minute ${i}`);
    assertEquals([m.fx_src, m.x_t], ["truefx", iso(gbpAt[i])], `minute ${i}`);
  }
  // USDC-EUR: TrueFX; then Kraken's marked read, newer, for as long as it is fresh (88 s before minute 2's cap, 148 s before
  // minute 3's); then Yahoo's 1.10 (the unmarked 1.5 never).
  const eur = [[1.12, "truefx"], [1.13, "kraken"], [1.13, "kraken"], [1.1, "yahoo"], [1.1, "yahoo"]] as const;
  for (let i = 0; i < 5; i++) {
    const m = minute(w.tables.cb_quote_minutes, "USDC-EUR", t0 + i * M);
    assertAlmostEquals(Number(m.fair), 1 / eur[i][0], 1e-12, `minute ${i}`);
    assertEquals(m.fx_src, eur[i][1], `minute ${i}`);
  }
  assertEquals(st.fxCount, { truefx: 12, kraken: 4, yahoo: 4 });
});

Deno.test("the base test with fx_ticks empty: today's Yahoo minutes, each recorded as yahoo; before the floor no fx_ticks read and no source", async () => {
  const t0 = Date.UTC(2026, 9, 29, 10, 0);
  const w = world(t0, { ratesUntil: t0 + 10 * M, coveredTo: t0 + 5 * M + 1000, ticks: [] });
  await runCbQuotes({ db: w.db, now: t0 + 6 * M, holder: "b", fetchImpl: fetchNothing, rec: w.rec });
  assertEquals(new Set(w.tables.cb_quote_minutes.map((m) => m.fx_src)), new Set(["yahoo"]));
  assertAlmostEquals(Number(minute(w.tables.cb_quote_minutes, "USDC-GBP", t0 + 2 * M).fair), 1 / 1.25, 1e-12);
  assertEquals(minute(w.tables.cb_quote_minutes, "USDC-GBP", t0 + 2 * M).x_t, iso(t0 + M));
  // Ten minutes before the floor, ticks or not: Yahoo, no `fx_ticks` read, no source column, no switch.
  const t1 = CB_FX_NOT_BEFORE - 10 * M;
  const v = world(t1, { ratesUntil: t1 + 10 * M, coveredTo: t1 + 5 * M + 1000, ticks: [tf("GBPUSD", t1 + 30 * S, 1.3)] });
  const reads: string[] = [];
  const sa = v.db.selectAll, se = v.db.select;
  v.db.selectAll = (t, q) => { reads.push(t); return sa(t, q); };
  v.db.select = (t, q) => { reads.push(t); return se(t, q); };
  const r = await runCbQuotes({ db: v.db, now: t1 + 6 * M, holder: "b", fetchImpl: fetchNothing, rec: v.rec });
  assertEquals([r.errors, r.to], [[], t1 + 4 * M]);
  assert(!reads.includes("fx_ticks"));
  assertEquals((v.tables.cb_quote_state[0].state as CbQuoteState).fxFrom, undefined);
  assert(v.tables.cb_quote_minutes.every((m) => !("fx_src" in m)));
  assertAlmostEquals(Number(minute(v.tables.cb_quote_minutes, "USDC-GBP", t1).fair), 1 / 1.25, 1e-12);
});

Deno.test("a Friday close through all four arms: the fast read, Yahoo's last bar ten minutes, then the base test dark and every held arm on the last fast read", async () => {
  const t0 = Date.UTC(2026, 9, 30, 20, 50);                                      // a Friday; Yahoo's last bar starts at t0 + 9 min
  const ticks: Tick[] = [];
  for (let at = t0 - 5 * M; at <= t0 + 10 * M; at += 20 * S) ticks.push(tf("GBPUSD", at, 1.26), tf("EURUSD", at, 1.12));
  // Kraken's routine reads go on through the weekend, unmarked: never used.
  for (let at = t0 + 30 * M; at <= t0 + 70 * M; at += 5 * S) ticks.push(kr("GBPUSD", at, 1.4, false), kr("EURUSD", at, 1.4, false));
  const run = async (ticks: Tick[]) => {
    const w = world(t0, { ratesUntil: t0 + 9 * M, coveredTo: t0 + 70 * M + 1000, ticks });
    // Two calls each: the second decides minutes whose `fx_ticks` window holds no TrueFX read, so it reads the newest row before it.
    for (const now of [t0 + 72 * M, t0 + 72 * M + 1000]) {
      const rs = [await runCbQuotes({ db: w.db, now, holder: "b", fetchImpl: fetchNothing, rec: w.rec }), await runCbHold({ db: w.db, now, holder: "h", rec: w.rec }),
        await runCbUsdc({ db: w.db, now, holder: "u", rec: w.rec }), await runCbNudge({ db: w.db, now, holder: "n", rec: w.rec })];
      assertEquals(rs.map((r) => r.errors), [[], [], [], []]);
    }
    return w;
  };
  const w = await run(ticks), y = await run([]);
  const at = (tbl: string, book: string, i: number) => minute(w.tables[tbl], book, t0 + i * M);
  for (const tbl of ["cb_quote_minutes", "cb_hold_minutes", "cb_usdc_minutes", "cb_nudge_minutes"]) {
    assertEquals(w.tables[tbl].filter((m) => m.book === "USDC-GBP").length, 70, tbl);
    // In session: TrueFX. After its last read (t0 + 10 min) is two minutes old: Yahoo's last bar, for ten minutes from its start.
    assertEquals([at(tbl, "USDC-GBP", 5).fx_src, at(tbl, "USDC-GBP", 11).fx_src, at(tbl, "USDC-GBP", 12).fx_src, at(tbl, "USDC-GBP", 19).fx_src], ["truefx", "truefx", "yahoo", "yahoo"], tbl);
    assertAlmostEquals(Number(at(tbl, "USDC-GBP", 5).fair), 1 / 1.26, 1e-12, tbl);
    assertAlmostEquals(Number(at(tbl, "USDC-GBP", 12).fair), 1 / 1.25, 1e-12, tbl);
    // The minutes lit are exactly the ones lit with no `fx_ticks` at all (the closure rules unchanged).
    const lit = (x: typeof w, b: string) => x.tables[tbl].filter((m) => m.book === b && m.fair != null).map((m) => m.minute).sort();
    for (const b of new Set(w.tables[tbl].map((m) => String(m.book)))) assertEquals(lit(w, b), lit(y, b), `${tbl} ${b}`);
  }
  // The base test: dark from ten minutes after the last bar, recorded as dark.
  assertEquals([at("cb_quote_minutes", "USDC-GBP", 20).fair, at("cb_quote_minutes", "USDC-GBP", 20).fx_src], [null, "dark"]);
  assertEquals(at("cb_quote_minutes", "USDC-GBP", 65).fx_src, "dark");
  // Every held arm: TrueFX's last read held through the closure, in the first call's minutes and the second's, never Kraken's 1.4.
  for (const tbl of ["cb_hold_minutes", "cb_usdc_minutes", "cb_nudge_minutes"]) for (const i of [20, 59, 60, 69]) {
    const m = at(tbl, "USDC-GBP", i);
    assertEquals([m.fx_src, m.x_t], ["held:truefx", iso(t0 + 10 * M)], `${tbl} ${i}`);
    assertAlmostEquals(Number(tbl === "cb_nudge_minutes" ? m.fair_raw ?? m.fair : m.fair), 1 / 1.26, 1e-12, `${tbl} ${i}`);
  }
  for (const tbl of ["cb_hold_minutes", "cb_usdc_minutes"]) assertEquals(at(tbl, "USDC-EUR", 30).fx_src, "held:truefx");
  // With no `fx_ticks`: the held arms hold Yahoo's last bar, as before the switch.
  assertEquals([minute(y.tables.cb_hold_minutes, "USDC-GBP", t0 + 30 * M).fx_src, minute(y.tables.cb_hold_minutes, "USDC-GBP", t0 + 30 * M).x_t], ["held:yahoo", iso(t0 + 9 * M)]);
  // The counts: the held arm's USDC-GBP and three other books, 70 minutes each.
  const hc = (w.tables.cb_hold_state[0].state as CbQuoteState).fxCount!;
  assertEquals(Object.values(hc).reduce((a, b) => a + b, 0), 4 * 70);
  assertEquals(hc, { truefx: 4 * 12, yahoo: 4 * 8, "held:truefx": 4 * 50 });
  const bc = (w.tables.cb_quote_state[0].state as CbQuoteState).fxCount!;
  assertEquals(bc, { truefx: 4 * 12, yahoo: 4 * 8, dark: 4 * 50 });
});
