// A worked world for the weekend variant's reading script (`replay_wk.py`): the arm's own driver (`runCbHold`) and the base test's
// (`runCbQuotes`) run on the same recorded prints across one closure, then the export `replay_wk.py` reads. Worked by hand:
//
//   GBP/USD 1.25, EUR/USD 1.1, every coin $1.00, so USDC-GBP's fair is £0.8000, its 0.1 % bid £0.7992 and its exit at fair. The
//   rate bars run every minute until Friday 2026-10-16 21:59 UTC and resume at Sunday 22:00 (the interbank closure). Three
//   round trips of £100 on USDC-GBP, each a seller at £0.7990 through the bid and, four minutes later, a buyer at £0.8001
//   through the exit: Friday 10:02 (both arms), Saturday 12:00 (in the closure: only the arm, which holds Friday's rate; the base
//   test withdrew its rungs at 22:10 on Friday) and Monday 02:00 (both). Each makes 100 × 0.0008 / 0.7992 = £0.1001001.
//
// The window starts at Friday 00:00 UTC (the arm's record is seeded there; the real one starts at the first 00:00 after its first
// run). Writes ../inputs/closure_world_export.json.gz.
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env docs/agents/backtests/cbwk/scripts/closure_world.ts

import { cbHoldNewState, runCbHold } from "../../../../../supabase/functions/agents/cb_hold.ts";
import { runCbQuotes } from "../../../../../supabase/functions/agents/cb_quotes.ts";
import { CB_PRODUCTS } from "../../../../../supabase/functions/agents/cb_rec.ts";
import { memDb, type Row } from "../../../../../supabase/functions/agents/testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const S = Date.UTC(2026, 9, 16);                        // Friday 00:00
const END = Date.UTC(2026, 9, 19, 6);                   // Monday 06:00
const LAST_BAR = Date.UTC(2026, 9, 16, 21, 59), REOPEN = Date.UTC(2026, 9, 18, 22, 0);

const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
for (let t = S - 20 * M; t <= END; t += M) {
  if (t > LAST_BAR && t < REOPEN) continue;
  fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 });
}
for (let h = S - 30 * H; h < END; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
let id = 7000000;
const trip = (at: number) => [
  { product: "USDC-GBP", trade_id: ++id, ts: iso(at + 5000), price: "0.79900000", size: "2000.00", side: "sell" },
  { product: "USDC-GBP", trade_id: ++id, ts: iso(at + 4 * M + 5000), price: "0.80010000", size: "10.00", side: "buy" },
];
const prints = [...trip(Date.UTC(2026, 9, 16, 10, 2)), ...trip(Date.UTC(2026, 9, 17, 12, 0)), ...trip(Date.UTC(2026, 9, 19, 2, 0))];
const zero = Object.fromEntries(CB_PRODUCTS.map((b) => [b, 0])) as Record<(typeof CB_PRODUCTS)[number], number>;
const { db, tables } = memDb({
  agent_locks: [{ name: "cb-hold", lease_until: iso(0), holder: null }, { name: "cb-quotes", lease_until: iso(0), holder: null }],
  agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
  cb_hold_state: [{ id: 1, state: cbHoldNewState(S, zero), last_minute: iso(S - M), updated_at: iso(0), last_error: null }],
  cb_hold_events: [], cb_hold_trips: [], cb_hold_minutes: [], cb_quote_state: [], cb_quote_events: [], cb_quote_trips: [], cb_quote_minutes: [],
  cb_trades: prints,
}, { now: () => END + 2 * M });
const cur = { from: 1, fromTs: iso(S - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: END + M + 1000 };
const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur])) };
const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as typeof fetch;
for (let i = 0; i < 90; i++) {
  const now = END + 2 * M + i * 1000;
  const a = await runCbHold({ db, now, holder: `h${i}`, rec });
  const b = await runCbQuotes({ db, now, holder: `b${i}`, fetchImpl, rec });
  if (a.errors.length || b.errors.length) throw new Error([...a.errors, ...b.errors].join(" | "));
  if (a.skipped && b.skipped) break;
}
const x = tables.cb_hold_minutes.find((m) => m.book === "USDC-EUR" && m.x != null)!.x;
const out = {
  about: "docs/agents/backtests/cbwk/scripts/closure_world.ts: runCbHold and runCbQuotes on one recorded world across a closure",
  start: iso(S), minutes: tables.cb_hold_minutes, trips: tables.cb_hold_trips, base_trips: tables.cb_quote_trips, eur_gbp: Number(x),
};
const gz = new Response(new Blob([JSON.stringify(out)]).stream().pipeThrough(new CompressionStream("gzip")));
await Deno.writeFile(new URL("../inputs/closure_world_export.json.gz", import.meta.url), new Uint8Array(await gz.arrayBuffer()));
console.log(JSON.stringify({ armTrips: tables.cb_hold_trips.length, baseTrips: tables.cb_quote_trips.length, minutes: tables.cb_hold_minutes.length }));
