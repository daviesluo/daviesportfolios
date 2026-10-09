// 2026-10-09 stablecoin quotes review: each instance's figures as the Agents page computes them, from the orders
// `sql/pull_orders.sql` read (data/<table>.json) and the state `data/meta.json` holds. It calls the page's own functions
// (agents/index.ts: liveRungs, liveRungTrips, liveCoinBooks, liveBookGbp) and nothing of its own for the money.
// npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/page_pnl.ts   (from this folder)
import { liveRungs, liveRungTrips, liveCoinBooks, liveBookGbp, liveIndexPrices, type QuoteLiveOrderView } from "../../../../../supabase/functions/agents/index.ts";

const here = new URL("..", import.meta.url).pathname;
const meta = JSON.parse(await Deno.readTextFile(`${here}data/meta.json`));
const TABLE: Record<string, string> = {
  live: "agent_quote_live_orders", pr5: "agent_quote_twin_pr5_orders", p50: "agent_quote_twin_p50_orders",
  take50: "agent_quote_twin_take50_orders", d: "agent_quote_twin_d_orders",
};
const NOW = Date.parse(meta.now);
const DAY0 = Date.parse("2026-10-09T00:00:00Z");
const WEEK_FROM = Date.parse("2026-10-02T16:00:00Z"); // the last 7 days: trips closed from 10-02 16:00 UTC
const iso = (ms: number) => new Date(ms).toISOString();

function ordersOf(id: string): Array<QuoteLiveOrderView & Record<string, unknown>> {
  const p = JSON.parse(Deno.readTextFileSync(`${here}data/${TABLE[id]}.json`));
  return p.rows.map((r: unknown[]) => ({
    id: r[0], ts: r[1], mode: r[2], book: r[3], rung_side: r[4], k: r[5], leg: r[6], side: r[7], state: r[8], base_size: r[9],
    filled_base: r[10], avg_fill_price: r[11], price: r[12], fee_gbp: r[13], filled_at: r[14], not_sent: r[15],
    paper_oid: r[16], paper_live: r[17], fair: r[18], take: r[19] === true,
  }));
}

const out: Record<string, unknown> = {};
for (const id of Object.keys(TABLE)) {
  const I = meta.inst[id];
  const orders = ordersOf(id);
  const paper = { state: I.paper } as never;
  const rungs = liveRungs(orders, paper, DAY0, I.state.dust, I.rungs);
  const coins = liveCoinBooks(orders, rungs, I.state.balances, liveIndexPrices(meta.tickers, NOW));
  const book = liveBookGbp(rungs, coins);
  const trips = rungs.flatMap((r) => liveRungTrips({ ...r, dust: r.dust }, DAY0)).sort((a, b) => Date.parse(a.tExit) - Date.parse(b.tExit));
  const fills = orders.filter((o) => Number(o.filled_base) > 0);
  const conv = fills.filter((o) => o.leg === "convert");
  const takeIds = new Set(orders.filter((o) => o.take).map((o) => o.id));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const tripStats = (ts: typeof trips) => ({
    trips: ts.length, won: ts.filter((t) => t.pnlGbp > 0).length, lost: ts.filter((t) => t.pnlGbp < 0).length,
    stops: ts.filter((t) => t.how === "stop").length, pnlGbp: sum(ts.map((t) => t.pnlGbp)), feesGbp: sum(ts.map((t) => t.feesGbp)),
    notionalGbp: sum(ts.map((t) => t.qty * t.entry)),
    bps: sum(ts.map((t) => t.qty * t.entry)) > 0 ? 1e4 * sum(ts.map((t) => t.pnlGbp)) / sum(ts.map((t) => t.qty * t.entry)) : null,
  });
  const week = trips.filter((t) => Date.parse(t.tExit) >= WEEK_FROM);
  const byRung: Record<string, unknown> = {};
  for (const r of rungs) {
    const ts = trips.filter((t) => t.book === r.book && t.side === r.side && t.k === r.k);
    const wk = ts.filter((t) => Date.parse(t.tExit) >= WEEK_FROM);
    byRung[`${r.book}|${r.side}|${r.k}`] = { all: tripStats(ts), week: tripStats(wk), held: r.held ? r.rb.held : 0, realisedGbp: r.rb.realisedGbp };
  }
  const byDay: Record<string, unknown> = {};
  for (const t of trips) {
    const d = t.tExit.slice(0, 10);
    const cur = (byDay[d] ?? { trips: 0, won: 0, pnlGbp: 0 }) as { trips: number; won: number; pnlGbp: number };
    cur.trips++; if (t.pnlGbp > 0) cur.won++; cur.pnlGbp += t.pnlGbp;
    byDay[d] = cur;
  }
  out[id] = {
    capitalGbp: I.config.capital_gbp, orderRows: orders.length, fills: fills.length,
    entryFills: fills.filter((o) => o.leg === "entry").length, exitFills: fills.filter((o) => o.leg === "exit").length,
    stopFills: fills.filter((o) => o.leg === "stop").length, takeFills: fills.filter((o) => takeIds.has(o.id)).length,
    conversions: conv.map((o) => ({ ts: o.ts, book: o.book, base: Number(o.filled_base), price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp) })),
    conversionFeesGbp: sum(conv.map((o) => Number(o.fee_gbp))),
    page: { realisedGbp: book.realised, unrealisedGbp: book.unrealised, feesGbp: book.fees, todayGbp: book.today, costGbp: book.cost, coinsValueGbp: book.value, heldRungs: book.heldRungs },
    coins, all: tripStats(trips), week: tripStats(week), byRung, byDay,
    firstTrip: trips[0]?.tEntry ?? null,
    trips: trips.map((t) => ({ book: t.book, side: t.side, k: t.k, tEntry: t.tEntry, tExit: t.tExit, entry: t.entry, exit: t.exit, qty: t.qty, how: t.how, feesGbp: t.feesGbp, pnlGbp: t.pnlGbp, ids: t.ids })),
  };
  const s = out[id] as { all: ReturnType<typeof tripStats>; week: ReturnType<typeof tripStats>; page: Record<string, number> };
  console.log(id.padEnd(7), "trips", s.all.trips, "won", s.all.won, "stops", s.all.stops, "P&L £", s.all.pnlGbp.toFixed(4),
    "bps", s.all.bps?.toFixed(1), "| 7d trips", s.week.trips, "£", s.week.pnlGbp.toFixed(4), "| page realised £", s.page.realisedGbp.toFixed(4),
    "unrealised £", s.page.unrealisedGbp.toFixed(4), "fees £", s.page.feesGbp.toFixed(4));
}
await Deno.writeTextFile(`${here}results/page_pnl.json`, JSON.stringify({ at: meta.now, dayStart: iso(DAY0), weekFrom: iso(WEEK_FROM), ...out }, null, 1));
