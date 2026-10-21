// Round trips and realised pounds, by the page's own functions (`liveRungs`, `liveRungTrips` of the agents function), for
// LIVE's own orders (data/live_orders.txt) and a simulation's (results/runs/<name>.json.gz), over the same span, each book's
// dust as the simulation's executor left it. Writes results/trips_<name>.json.
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env scripts/trips.ts <name>
const REPO = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const IX = await import(`${REPO}/supabase/functions/agents/index.ts`);
const HERE = `${REPO}/docs/agents/backtests/livesim`;
const [name] = Deno.args;
const T0 = Date.parse("2026-10-01T16:29:53Z"), T1 = Date.parse("2026-10-21T15:09:00Z");
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
const gz = await Deno.readFile(`${HERE}/results/runs/${name}.json.gz`);
const run = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
const dust = run.dust as Record<string, number>;
const gunzip = async (f: string) => await new Response(new Blob([await Deno.readFile(f)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
const live = (await gunzip(`${HERE}/data/live_orders.txt.gz`)).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.ts >= T0 && o.ts < T1);
const viewL = live.map((o: any) => ({ id: o.id, ts: iso(o.ts)!, mode: "live", book: o.book, rung_side: o.rung_side, k: o.k, leg: o.leg, state: o.state, filled_base: Number(o.filled_base ?? 0),
  avg_fill_price: o.avg_fill_price == null ? null : Number(o.avg_fill_price), price: Number(o.price), fee_gbp: Number(o.fee_gbp ?? 0), filled_at: iso(o.filled_at), side: o.side,
  base_size: Number(o.base_size), not_sent: !!o.not_sent }));
const viewS = (run.orders as any[]).filter((r) => r[1] >= T0 && r[1] < T1).map((r) => ({ id: r[0], ts: iso(r[1])!, mode: "live", book: r[2], rung_side: r[3], k: r[4], leg: r[5], side: r[6], state: r[7],
  price: r[8], base_size: r[9], filled_base: r[10], avg_fill_price: r[11], fee_gbp: r[12], filled_at: iso(r[13]), not_sent: r[14] }));
const dayStart = Math.floor(T1 / 864e5) * 864e5;
const tripsOf = (v: any[]) => {
  const rungs = IX.liveRungs(v, null, dayStart, dust);
  const trips = rungs.flatMap((rg: any) => IX.liveRungTrips({ ...rg, dust: rg.dust }, dayStart));
  return { rungs, trips, realised: rungs.reduce((a: number, rg: any) => a + rg.rb.realisedGbp, 0), fees: v.reduce((a, o) => a + Number(o.fee_gbp || 0), 0) };
};
const L = tripsOf(viewL), S = tripsOf(viewS);
const day = (t: any) => String(t.tExit ?? t.exitAt ?? t.closedAt ?? "").slice(5, 10);
const byDay = (ts: any[]) => { const o: Record<string, number> = {}; for (const t of ts) { const d = String(t.closed ?? t.exitTs ?? t.tExit ?? t.exit?.ts ?? "").slice(5, 10) || "?"; o[d] = +((o[d] ?? 0) + t.pnlGbp).toFixed(4); } return o; };
const out = {
  name, live: { trips: L.trips.length, won: L.trips.filter((t: any) => t.pnlGbp > 0).length, stops: L.trips.filter((t: any) => t.how === "stop").length, realisedGbp: +L.realised.toFixed(4), feesGbp: +L.fees.toFixed(4) },
  sim: { trips: S.trips.length, won: S.trips.filter((t: any) => t.pnlGbp > 0).length, stops: S.trips.filter((t: any) => t.how === "stop").length, realisedGbp: +S.realised.toFixed(4), feesGbp: +S.fees.toFixed(4) },
  tripKeys: Object.keys(L.trips[0] ?? {}),
};
await Deno.writeTextFile(`${HERE}/results/trips_${name}.json`, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out));
