// The OKX paper twins' compounding (okx_compound.ts; the deviation reviews/2026-10-30-okx-compounding-deviation.md). Pins: (1) each
// book's rule ($600 funded, a dollar a rung, half to twice, from 2026-10-31 00:00 UTC); (2) the day's capital at the day's first
// minute, once a day, each day's capital kept, a trip counted from the start only; (3) the USDG/EUR twin across a midnight: the day
// before's $12.30 makes the next day's rung $102, its trip 2 % larger than the same world's before the start (the counterfactual);
// (4) "USDG/EUR - 1" the same on its own record.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OKX_COMPOUND_FROM, OKX_COMPOUND_RULE, okxCompoundMinute, okxCompoundMult, okxCompoundTrip, type OkxCompound } from "./okx_compound.ts";
import { okxNewState, runOkxQuotes } from "./okx_quotes.ts";
import { okxBasisNewState, runOkxBasis } from "./okx_basis.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const EU = 1.1172, GU = 1.3337;

Deno.test("each OKX book's rule: from 2026-10-31 00:00 UTC, $600 funded, a dollar a rung, between half and twice", () => {
  assertEquals(OKX_COMPOUND_FROM, Date.UTC(2026, 9, 31));
  assertEquals(OKX_COMPOUND_RULE, { from: OKX_COMPOUND_FROM, base: 600, unit: 6, floor: 300, cap: 1200 });
});

Deno.test("the day's capital at the day's first minute, once a day, each day kept; a trip counts from the start only", () => {
  const st: { compound?: OkxCompound } = {};
  assertEquals([okxCompoundMinute(st, "USDG-EUR", OKX_COMPOUND_FROM - M), st.compound], [1, undefined]);
  assertEquals(okxCompoundMinute(st, "USDG-EUR", OKX_COMPOUND_FROM), 1);
  okxCompoundTrip(st, "USDG-EUR", OKX_COMPOUND_FROM - M, 50);                 // before the start: not counted
  okxCompoundTrip(st, "USDG-EUR", OKX_COMPOUND_FROM + 3600e3, 12.3);
  okxCompoundTrip(st, "EURC-USDC", OKX_COMPOUND_FROM + 3600e3, 99);          // no record for this book yet: not counted
  assertEquals(okxCompoundMinute(st, "USDG-EUR", OKX_COMPOUND_FROM + 5 * M), 1); // the same day: unchanged
  assertAlmostEquals(okxCompoundMinute(st, "USDG-EUR", OKX_COMPOUND_FROM + DAY), 1.02, 1e-12);
  assertEquals(st.compound!["USDG-EUR"].days, { "2026-10-31": 600, "2026-11-01": 612 });
  assertEquals(okxCompoundMult(st, "EURC-USDC"), 1);
  // A losing day shrinks it: −$6.01 → 605.29 → $600 the day after.
  okxCompoundTrip(st, "USDG-EUR", OKX_COMPOUND_FROM + DAY + 3600e3, -6.99);
  assertEquals(okxCompoundMinute(st, "USDG-EUR", OKX_COMPOUND_FROM + 2 * DAY), 1);
});

/** A world from `mid` (a midnight; the record decides from it, so its entries are placed at the day's size): EUR/USD and GBP/USD flat, a recorded book, a seller at the 0.1 % bid at mid + 2 min, a buyer at fair at mid + 4 min. */
function world(mid: number, lease: string, stateTable: string, state: unknown) {
  const eur: Row[] = [], fx: Row[] = [], books: Row[] = [];
  for (let t = mid - DAY - 20 * M; t <= mid + 12 * M; t += M) { eur.push({ kind: "fx:EURUSD", t: iso(t), value: EU }); fx.push({ kind: "fx", t: iso(t), value: GU }); }
  for (let t = mid - 3 * M; t <= mid + 10 * M; t += M) {
    books.push({ book: "USDG-EUR", ts: iso(t + 40e3), bid: 0.8948, ask: 0.8958 });
    books.push({ book: "EURC-USDC", ts: iso(t + 40e3), bid: 1.117, ask: 1.119 });
  }
  const trades = [
    { book: "USDG-EUR", trade_id: 7000001, ts: iso(mid + 2 * M + 5e3), price: 0.8941, size: 500, side: "sell" },
    { book: "USDG-EUR", trade_id: 7000002, ts: iso(mid + 4 * M + 5e3), price: 0.8951, size: 500, side: "buy" },
  ];
  const prefix = stateTable.replace(/_state$/, "");
  return memDb({
    agent_locks: [{ name: lease, lease_until: iso(0), holder: null }],
    agent_quote_inputs: fx, cb_quote_inputs: eur, okx_trades: trades, okx_books: books,
    [stateTable]: [{ id: 1, state, last_minute: iso(mid - M), updated_at: iso(0), last_error: null }],
    [`${prefix}_events`]: [], [`${prefix}_trips`]: [], [`${prefix}_minutes`]: [], [`${prefix}_days`]: [],
  }, { now: () => mid + 11 * M });
}
const cur = (coveredTo: number) => ({ from: 1, hi: 7000003, top: 7000003, topAt: coveredTo, hole: null, coveredTo });
const compounded = () => ({ "USDG-EUR": { ...OKX_COMPOUND_RULE, capital: 600, realisedUsd: 12.3, onDay: "2026-10-31" } });

Deno.test("the USDG/EUR twin across a midnight: the day before's $12.30 makes the next day's rung $102; before the start (the counterfactual), $100", async () => {
  const qty: Record<string, number> = {};
  for (const after of [true, false]) {
    const mid = after ? OKX_COMPOUND_FROM + DAY : OKX_COMPOUND_FROM - 2 * DAY;
    const seed = { ...okxNewState(mid, { "USDG-EUR": 0, "EURC-USDC": 0 }), usdFrom: mid - DAY, usdEurusd: EU, usdFactor: 1, ...(after ? { compound: compounded() } : {}) };
    const { db, tables } = world(mid, "okx-quotes", "okx_quote_state", seed);
    const r = await runOkxQuotes({ db, now: mid + 11 * M, holder: "h", rec: { cursors: { "USDG-EUR": cur(mid + 10 * M + 30e3), "EURC-USDC": cur(mid + 10 * M + 30e3) } } });
    assertEquals(r.errors, []);
    const st = tables.okx_quote_state[0].state as { compound?: OkxCompound };
    if (after) {
      assertEquals([st.compound!["USDG-EUR"].capital, st.compound!["USDG-EUR"].days?.["2026-11-01"], st.compound!["EURC-USDC"].capital], [612, 612, 600]);
      assert(st.compound!["USDG-EUR"].realisedUsd > 12.3, "the day's trip is counted for the next");
    } else assertEquals(st.compound, undefined);
    assertEquals(tables.okx_quote_trips.length, 1);
    qty[String(after)] = Number(tables.okx_quote_trips[0].qty);
  }
  assertAlmostEquals(qty["true"] / qty["false"], 1.02, 1e-4);
});

Deno.test("\"USDG/EUR - 1\" compounds the same way on its own record", async () => {
  const qty: Record<string, number> = {};
  for (const after of [true, false]) {
    const mid = after ? OKX_COMPOUND_FROM + DAY : OKX_COMPOUND_FROM - 2 * DAY;
    const seed = { ...okxBasisNewState(mid, 0), ...(after ? { compound: compounded() } : {}) };
    const { db, tables } = world(mid, "okx-basis", "okx_basis_state", seed);
    const r = await runOkxBasis({ db, now: mid + 11 * M, holder: "h", rec: { cursors: { "USDG-EUR": cur(mid + 10 * M + 30e3) } } as never });
    assertEquals(r.errors, []);
    const st = tables.okx_basis_state[0].state as { compound?: OkxCompound };
    assertEquals(st.compound?.["USDG-EUR"]?.capital ?? null, after ? 612 : null);
    assertEquals(tables.okx_basis_trips.length, 1);
    qty[String(after)] = Number(tables.okx_basis_trips[0].qty);
  }
  assertAlmostEquals(qty["true"] / qty["false"], 1.02, 1e-4);
});
