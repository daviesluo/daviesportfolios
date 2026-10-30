// The Coinbase paper arms' compounding (cb_compound.ts; the deviation reviews/2026-10-30-compounding-deviation.md). Pins: (1) each
// arm's rule (its funded dollars, a dollar a rung, half to twice); (2) the day's capital at a run's first minute, once a day, held
// rungs rescaled to keep their coins; (3) a run never decides past 23:59 once the rule's start has come; (4) the USDC/GBP LIVE
// twin across a midnight: its trips of the day before make the next day's rung bigger by the same share, and before the start
// (the counterfactual) the rung is its $50.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CB_COMPOUND_FROM, CB_COMPOUND_RULES, cbCompoundAt, cbCompoundHorizon, cbCompoundMult, cbCompoundTrip, type CbCompoundState } from "./cb_compound.ts";
import { CB_NUDGE_ARM, CB_NUDGE_PRODUCTS, runCbNudge } from "./cb_nudge.ts";
import { cbUsdcArmNewState } from "./cb_usdc.ts";
import { newBookState } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("each Coinbase arm's rule: from 2026-10-31 00:00 UTC, its funded dollars, a dollar a rung, between half and twice", () => {
  assertEquals(CB_COMPOUND_FROM, Date.UTC(2026, 9, 31));
  assertEquals(CB_COMPOUND_RULES["cb-nudge"], { from: CB_COMPOUND_FROM, base: 300, unit: 6, floor: 150, cap: 600 });
  assertEquals(CB_COMPOUND_RULES["cb-usdc"], { from: CB_COMPOUND_FROM, base: 600, unit: 12, floor: 300, cap: 1200 });
  assertEquals(CB_COMPOUND_RULES["cb-hold"], { from: CB_COMPOUND_FROM, base: 1200, unit: 24, floor: 600, cap: 2400 });
  assertEquals(CB_COMPOUND_RULES["cb-quotes"], undefined);                  // the weekend reading's control does not compound
});

Deno.test("the day's capital at a run's first minute, once a day, held rungs rescaled to keep their coins; a run stops at 23:59", () => {
  const st = { books: { "USDC-GBP": newBookState("USDC-GBP") } } as { compound?: CbCompoundState; books: Record<string, ReturnType<typeof newBookState>> };
  // Before the start: nothing written, the multiplier 1.
  assertEquals(cbCompoundAt(st, "cb-nudge", CB_COMPOUND_FROM - M, ["USDC-GBP"]), null);
  assertEquals([st.compound, cbCompoundMult(st, CB_COMPOUND_FROM - M)], [undefined, 1]);
  // From it: written at $300, nothing to add on its first day.
  assertEquals(cbCompoundAt(st, "cb-nudge", CB_COMPOUND_FROM, ["USDC-GBP"]), null);
  assertEquals([st.compound!.capital, st.compound!.onDay], [300, "2026-10-31"]);
  // $12.40 realised in the day (a trip before the start does not count) → $312 the next day; a held rung keeps its coins.
  cbCompoundTrip(st, { tExit: CB_COMPOUND_FROM - M, pnlUsd: 100 });
  cbCompoundTrip(st, { tExit: CB_COMPOUND_FROM + H, pnlUsd: 12.4 });
  const r = st.books["USDC-GBP"].rungs[0];
  Object.assign(r, { mode: "position", qty: 125, nq: 100 });                 // 62.5 coins at the old divisor 2
  assertEquals(cbCompoundAt(st, "cb-nudge", CB_COMPOUND_FROM + DAY, ["USDC-GBP"]), { from: 300, to: 312 });
  assertAlmostEquals(cbCompoundMult(st, CB_COMPOUND_FROM + DAY), 1.04, 1e-12);
  assertEquals(st.compound!.days, { "2026-10-31": 300, "2026-11-01": 312 });
  const f = 2 / 1.04;                                                        // the new divisor
  assertAlmostEquals(r.qty! / f, 62.5, 1e-9);
  assertAlmostEquals(r.nq! / f, 50, 1e-9);
  // Once a day.
  cbCompoundTrip(st, { tExit: CB_COMPOUND_FROM + DAY + H, pnlUsd: 50 });
  assertEquals(cbCompoundAt(st, "cb-nudge", CB_COMPOUND_FROM + DAY + 5 * M, ["USDC-GBP"]), null);
  // A run's horizon: cut at 23:59 from the start's day on; before, and for an arm with no rule, as it was.
  assertEquals(cbCompoundHorizon("cb-nudge", CB_COMPOUND_FROM + DAY - 2 * M, CB_COMPOUND_FROM + DAY + 30 * M), CB_COMPOUND_FROM + DAY - M);
  assertEquals(cbCompoundHorizon("cb-nudge", CB_COMPOUND_FROM - 2 * M, CB_COMPOUND_FROM + 30 * M), CB_COMPOUND_FROM - M);
  assertEquals(cbCompoundHorizon("cb-nudge", CB_COMPOUND_FROM - 2 * DAY, CB_COMPOUND_FROM - 2 * DAY + 30 * M), CB_COMPOUND_FROM - 2 * DAY + 30 * M);
  assertEquals(cbCompoundHorizon("cb-quotes", CB_COMPOUND_FROM + DAY - 2 * M, CB_COMPOUND_FROM + DAY + 30 * M), CB_COMPOUND_FROM + DAY + 30 * M);
});

/** The USDC/GBP LIVE twin's world from `t0`: GBP/USD 1.25, the coin $1.00 (fair £0.80), its state at `t0` with `compound`, the prints given. */
function world(t0: number, now: number, prints: Array<[number, number, string, string, "buy" | "sell"]>, compound?: CbCompoundState) {
  const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
  for (let t = t0 - 20 * M; t <= t0 + 20 * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < t0; h += H) fair.push({ kind: "fair:USDC-USD", t: iso(h), value: 1.0 });
  const st = { ...cbUsdcArmNewState(CB_NUDGE_ARM, t0, { "USDC-GBP": 0 }), usdFrom: t0 - DAY, liveFrom: t0 - DAY, fxFrom: t0 - DAY, ...(compound ? { compound } : {}) };
  return memDb({
    agent_locks: [{ name: "cb-nudge", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
    cb_nudge_state: [{ id: 1, state: st, last_minute: iso(t0 - M), updated_at: iso(0), last_error: null }], cb_nudge_events: [], cb_nudge_trips: [], cb_nudge_minutes: [], cb_nudge_days: [],
    agent_book_levels: [], cb_trades: prints.map(([id, at, price, size, side]) => ({ product: "USDC-GBP", trade_id: id, ts: iso(at), price, size, side })),
  }, { now: () => now });
}
const rec = (to: number) => ({ cursors: { "USDC-GBP": { from: 1, fromTs: iso(0), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: to } } }) as never;

Deno.test("the USDC/GBP LIVE twin across a midnight: the day before's $12 makes the next day's rung $52; before the start, $50", async () => {
  for (const after of [true, false]) {
    // 23:58 the day before; a sell through the 0.1 % bid (£0.7992) at 00:01, its exit at fair (£0.8000) filled at 00:03.
    const mid = after ? CB_COMPOUND_FROM + DAY : CB_COMPOUND_FROM - DAY, t0 = mid - 2 * M;
    const compound = after ? { ...CB_COMPOUND_RULES["cb-nudge"], capital: 300, realisedUsd: 12.4, onDay: "2026-10-31" } : undefined;
    const prints: Array<[number, number, string, string, "buy" | "sell"]> = [[1, mid + M + 5000, "0.79900000", "2000.00", "sell"], [2, mid + 3 * M + 5000, "0.80010000", "10.00", "buy"]];
    const { db, tables } = world(t0, mid + 7 * M, prints, compound);
    // The first run stops at 23:59; the second sets the day's capital and decides on.
    const a = await runCbNudge({ db, now: mid + 7 * M, holder: "a", rec: rec(mid + 6 * M + 1000) });
    assertEquals([a.errors, a.to], [[], after ? mid - M : mid + 5 * M]);
    if (after) {
      const b = await runCbNudge({ db, now: mid + 7 * M + 1, holder: "b", rec: rec(mid + 6 * M + 1000) });
      assertEquals([b.errors, b.from, b.to], [[], mid, mid + 5 * M]);
    }
    const st = tables.cb_nudge_state[0].state as { compound?: CbCompoundState };
    assertEquals(st.compound?.capital ?? null, after ? 312 : null);
    // The trip's size: $50 a rung at the funded size, × 1.04 from the day the capital is $312 (£41.60 at 1.25).
    assertEquals(tables.cb_nudge_trips.length, 1);
    assertAlmostEquals(Number(tables.cb_nudge_trips[0].notional_gbp), after ? 52 / 1.25 : 40, 1e-9);
    if (after) assert(st.compound!.realisedUsd > 12.4, "the trip is counted for the next day");
  }
});
