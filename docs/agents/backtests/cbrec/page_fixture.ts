// The browser test's "Stablecoin quotes Coinbase" fixture (src/e2e/quotes_coinbase_fixture.json): the paper test's own
// driver (`runCbQuotes`) run on a small recorded world, then the dashboard's own view of it (`cbQuotesView`), so the page
// is checked against what the function would send. `cb_quotes.test.ts` builds it again and asserts the committed file.
// The world, at the browser test's clock (2026-09-17 23:00 UTC), from 30 hours before it: GBP/USD 1.32, EUR/USD 1.155,
// every coin worth $1.00 (fair £0.75758 and €0.86580). On USDC-GBP a bid fills and exits yesterday, an ask fills and exits
// today; on USDC-EUR a bid fills and exits today; on USDT-EUR a bid fills and is still held; USDT-GBP never trades.
//
//   cd docs/agents/backtests/cbrec && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env page_fixture.ts

import { runCbQuotes } from "../../../../supabase/functions/agents/cb_quotes.ts";
import { cbQuotesView } from "../../../../supabase/functions/agents/cb_view.ts";
import { CB_PRODUCTS } from "../../../../supabase/functions/agents/cb_rec.ts";
import { memDb, type Row } from "../../../../supabase/functions/agents/testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
export const NOW = Date.parse("2026-09-17T23:00:00Z"), DAY0 = Date.parse("2026-09-17T00:00:00Z");
const T0 = NOW - 30 * H;

/** The recorded prints: [book, id, minutes after T0 (+ seconds), price, size, aggressor]. */
const PRINTS: Array<[string, number, number, string, string, "buy" | "sell"]> = [
  ["USDC-GBP", 7000001, 60 + 0.1, "0.75670", "2000", "sell"],     // through the 0.1 % bid (£0.7568)
  ["USDC-GBP", 7000002, 63 + 0.1, "0.75770", "10", "buy"],        // through its exit at fair (£0.7576)
  ["USDC-GBP", 7000003, 1700 + 0.1, "0.75850", "2000", "buy"],    // through the 0.1 % ask (£0.7584), today
  ["USDC-GBP", 7000004, 1703 + 0.1, "0.75740", "10", "sell"],     // through its exit at fair (£0.7575)
  ["USDC-EUR", 7000001, 1500 + 0.1, "0.86480", "2000", "sell"],   // through the 0.1 % bid (€0.8649)
  ["USDC-EUR", 7000002, 1503 + 0.1, "0.86600", "10", "buy"],      // through its exit (€0.8659)
  ["USDT-EUR", 7000001, 1750 + 0.1, "0.86480", "2000", "sell"],   // through the 0.1 % bid (€0.86493): still held
  ["USDT-EUR", 7000002, 1770 + 0.1, "0.86500", "5", "sell"],      // the last print it is marked at
];

export async function buildCoinbasePageFixture() {
  const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
  for (let t = T0 - 20 * M; t <= NOW; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.32 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.155 }); }
  for (let h = T0 - 30 * H; h < NOW; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const { db, tables } = memDb({
    agent_locks: [{ name: "cb-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur, cb_quote_state: [], cb_quote_events: [], cb_quote_trips: [], cb_quote_minutes: [],
    cb_trades: PRINTS.map(([book, id, min, price, size, side]) => ({ product: book, trade_id: id, ts: iso(T0 + min * M), price, size, side })),
  }, { now: () => NOW });
  const cur = { from: 1, fromTs: iso(T0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: NOW - 30e3 };
  const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur])) };
  const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as typeof fetch;
  // The driver decides an hour a call: the calls a day and a half of minutes take, each at the clock.
  for (let i = 0; i < 40; i++) {
    // A second apart: a call's lease runs to its own instant, so the next must come after it.
    const r = await runCbQuotes({ db, now: NOW + i * 1000, holder: `h${i}`, fetchImpl, rec });
    if (r.skipped) break;
    if (r.errors.length) throw new Error(r.errors.join(" | "));
  }
  const st = tables.cb_quote_state[0];
  const days = new Map<string, { day: string; orders: number; fills: number; trips: number; won: number; realised_gbp: number }>();
  const day = (ms: string) => ms.slice(0, 10);
  const of = (d: string) => days.get(d) ?? (days.set(d, { day: d, orders: 0, fills: 0, trips: 0, won: 0, realised_gbp: 0 }), days.get(d)!);
  for (const e of tables.cb_quote_events) { if (e.kind === "order") of(day(String(e.minute))).orders++; if (e.kind === "fill") of(day(String(e.minute))).fills++; }
  for (const t of tables.cb_quote_trips) { const d = of(day(String(t.t_exit))); d.trips++; if (Number(t.pnl_gbp) > 0) d.won++; d.realised_gbp += Number(t.pnl_gbp); }
  const events = [...tables.cb_quote_events].filter((e) => e.kind === "order" || e.kind === "refused")
    .sort((a, b) => (String(a.minute) < String(b.minute) ? 1 : -1)).slice(0, 30);
  const view = cbQuotesView({
    st: st as never, trips: tables.cb_quote_trips as never, days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)), events: events as never,
    minutes: tables.cb_quote_minutes.filter((m) => m.minute === st.last_minute) as never, nowMs: NOW, dayStartMs: DAY0, gbpusd: 1.32,
  });
  return { about: "docs/agents/backtests/cbrec/page_fixture.ts: runCbQuotes on a recorded world, then cbQuotesView, at the browser test's clock", nowMs: NOW, dayStartMs: DAY0, quotesCoinbase: view };
}

if (import.meta.main) {
  const out = await buildCoinbasePageFixture();
  await Deno.writeTextFile(new URL("../../../../src/e2e/quotes_coinbase_fixture.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ realisedGbp: out.quotesCoinbase?.realisedGbp, held: out.quotesCoinbase?.heldRungs, trips: out.quotesCoinbase?.detail.tripCount }));
}
