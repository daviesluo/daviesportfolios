// 2026-10-26 stablecoin quotes review: LIVE's and every realistic twin's figures by the page's own functions
// (agents/index.ts: liveRungs, liveRungTrips, liveDays, liveCoinBooks, liveBookGbp), from the orders `sql/pulls.sql` read.
// It writes results/raw.json, which holds the live account's pounds and is NOT committed (the repository is public);
// scripts/summary.py turns it into results/summary.json (LIVE in % of its capital, bps and per £100).
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check scripts/series.ts   (from this folder)
// Marks: each coin at the paper engine's fair (fairU / X, `agent_quote_minutes`) at the instants of data/fairs.txt; the
// last line is the read's own instant. The coins counted are each book's own count (conversions plus what the rungs hold).
import { liveCoinBooks, liveBookGbp, liveDays, liveRungs, liveRungTrips } from "../../../../../../supabase/functions/agents/index.ts";
import { RULED_ARMS } from "../../../../../../supabase/functions/agents/quotes_ruled.ts";
import { QUOTE_RUNGS } from "../../../../../../supabase/functions/agents/quotes.ts";

const here = new URL("..", import.meta.url).pathname;
const gunzip = async (p: string) => JSON.parse(await new Response((await Deno.open(p)).readable.pipeThrough(new DecompressionStream("gzip"))).text());
const live = await gunzip(`${here}data/live_orders.json.gz`);
const tw = await gunzip(`${here}data/twin_orders.json.gz`);
const marks = (await Deno.readTextFile(`${here}data/fairs.txt`)).trim().split("\n").map((l) => l.split(" "));
const NOW = Date.parse(marks[marks.length - 1][0]), D = 86400e3, TODAY = Math.floor(NOW / D) * D;
// LIVE's dust as its executor kept it at the read (agent_quote_live_state.state.dust).
const LIVE_DUST = { "USDC-GBP": 0.13395485998029305, "USDT-GBP": 0.1340219346685812 };
const srcs: Record<string, { orders: any[]; dust: any; rungs: readonly number[] }> = { LIVE: { orders: live, dust: LIVE_DUST, rungs: QUOTE_RUNGS } };
for (const t of ["pr5", "live", "p50", "take50", "take50wk", "d"]) {
  srcs[t] = { orders: tw.orders.filter((o: any) => o.t === t), dust: tw.dust[t], rungs: t === "d" ? RULED_ARMS.d.rungs : QUOTE_RUNGS };
}
const out: Record<string, unknown> = { now: new Date(NOW).toISOString() };
for (const [name, s] of Object.entries(srcs)) {
  const series = marks.map(([t, c, u]) => {
    const T = Date.parse(t);
    const orders = s.orders.filter((o: any) => Date.parse(o.filled_at ?? o.ts) <= T);
    const rungs = liveRungs(orders, null, Math.floor(T / D) * D, s.dust, s.rungs);
    const g = liveBookGbp(rungs, liveCoinBooks(orders, rungs, null, { "USDC-GBP": Number(c), "USDT-GBP": Number(u) }));
    return { t, realised: g.realised, unrealised: g.unrealised, total: g.realised + g.unrealised, coinsGbp: g.value, fees: g.fees };
  });
  const rungs = liveRungs(s.orders, null, TODAY, s.dust, s.rungs);
  const trips = rungs.flatMap((r) => liveRungTrips(r, TODAY)).map(({ ids: _ids, ...x }) => x);
  const days = liveDays(s.orders, rungs, rungs.flatMap((r) => liveRungTrips(r, TODAY)), TODAY)
    .map((d) => ({ day: d.day, fills: d.fills, trips: d.trips, won: d.won, realisedGbp: d.realisedGbp }));
  const entries = s.orders.filter((o: any) => o.leg === "entry");
  out[name] = { series, trips, days, entryFills: entries.length, takes: entries.filter((o: any) => o.take === true).length };
}
await Deno.writeTextFile(`${here}results/raw.json`, JSON.stringify(out));
console.log("results/raw.json");
