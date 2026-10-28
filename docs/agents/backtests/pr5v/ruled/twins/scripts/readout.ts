// The 10-28 readouts of the three hidden twins, "Stablecoin quotes" (`pr5`, £1,200), the size twin (`p50`, £600) and
// rule D's twin (`d`, £1,800), by the page's own functions (agents/index.ts: liveRungs, liveRungTrips), from the orders
// sql/pull.sql read (data/orders_<id>.txt.gz). Descriptive: no pass bar (the twins' pre-registration §9, the size twin's §3).
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check scripts/readout.ts   (from ../twins)
// What it reads, by its pre-registrations:
// - every twin: per rung, round trips, won, realised, fees, bps of what the trips traded, what it holds at the cut;
//   the whole record, the backfill (closed before 2026-10-02 21:05, in sample) and the window (closed from 2026-10-04 00:00);
// - `pr5` beside PR5's paper trips by rung (data/pr5_paper_by_rung.json, dollars at $100 a rung);
// - `d` beside rule D's arm `d` paper trips (../data/trips.txt.gz, dollars at $100 a rung), its two spans apart (nine rungs
//   to 10-09 23:59, eight from 10-10 00:00, by entry), the eight common rungs over the whole span, the 0.03 % rungs before
//   10-10 alone, and the 0.03 % holdings open at 10-10 00:00 and how they closed (the twins' §15, proposed there);
// - `d` and `p50` over the window at the three rungs both quote and in total per pound of capital (the size twin's §3);
// - the buy-backs sized to the venue's minimum before and after F1's deploy (2026-10-09 17:41:36 UTC, the end of the
//   edge-functions run of d0c6f823, which carries 6ca18c9a): the twins' §14 and the size twin's §8.
import { liveRungs, liveRungTrips, type LiveTrip } from "../../../../../../../supabase/functions/agents/index.ts";
import { RULED_ARMS } from "../../../../../../../supabase/functions/agents/quotes_ruled.ts";
import { QUOTE_RUNGS } from "../../../../../../../supabase/functions/agents/quotes.ts";

const here = new URL("..", import.meta.url).pathname;
const gunzipText = async (p: string) => await new Response((await Deno.open(p)).readable.pipeThrough(new DecompressionStream("gzip"))).text();
const CUT = Date.parse("2026-10-28T00:00:00Z");
const CUT_DAY = CUT; // the readouts' cut is a UTC midnight
const BACKFILL_END = Date.parse("2026-10-02T21:05:00Z");
const WINDOW_FROM = Date.parse("2026-10-04T00:00:00Z");
const RETIRED_FROM = Date.parse("2026-10-10T00:00:00Z");
const F1_DEPLOYED = Date.parse("2026-10-09T17:41:36Z");
const meta = (await Deno.readTextFile(`${here}data/meta.txt`)).trim().split("\n").map((l) => JSON.parse(l));
const TWINS = { pr5: { capital: 1200, rungs: QUOTE_RUNGS }, p50: { capital: 600, rungs: QUOTE_RUNGS }, d: { capital: 1800, rungs: RULED_ARMS.d.rungs } } as const;
type Id = keyof typeof TWINS;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rungKey = (book: string, side: string, k: number) => `${book} ${side} ${Number((k * 100).toFixed(3))} %`;

function stats(ts: LiveTrip[]) {
  const notional = sum(ts.map((t) => t.qty * t.entry)), pnl = sum(ts.map((t) => t.pnlGbp));
  return {
    trips: ts.length, won: ts.filter((t) => t.pnlGbp > 0).length, stops: ts.filter((t) => t.how === "stop").length,
    realisedGbp: r4(pnl), feesGbp: r4(sum(ts.map((t) => t.feesGbp))), tradedGbp: r4(notional), bps: notional > 0 ? r4(1e4 * pnl / notional) : null,
  };
}

const out: Record<string, unknown> = {
  what: "The 10-28 readouts of the hidden twins pr5, p50 and d (descriptive; no pass bar). Not blind: the stablecoin quote reviews of 10-09, 10-14, 10-18, 10-21 and 10-26 read these twins' records, and no-peek rules were cancelled on 2026-10-04.",
  cut: new Date(CUT).toISOString(), health: meta.filter((m) => m.twin), fairsAtCut: meta.filter((m) => m.fair),
};
const tripsOf: Record<string, LiveTrip[]> = {};
for (const id of Object.keys(TWINS) as Id[]) {
  const spec = TWINS[id];
  const dust = meta.find((m) => m.twin === id).dust;
  const all = (await gunzipText(`${here}data/orders_${id}.txt.gz`)).trim().split("\n").map((l) => JSON.parse(l));
  const orders = all.filter((o) => Date.parse(o.ts) < CUT && Date.parse(o.filled_at ?? o.ts) <= CUT)
    .map((o) => (o.filled_at && Date.parse(o.filled_at) > CUT ? { ...o, filled_base: 0 } : o));
  const rungs = liveRungs(orders, null, CUT_DAY, dust, spec.rungs);
  const trips = rungs.flatMap((r) => liveRungTrips(r, CUT_DAY)).sort((a, b) => Date.parse(a.tExit) - Date.parse(b.tExit));
  tripsOf[id] = trips;
  const byRung: Record<string, unknown> = {};
  for (const r of rungs) {
    const ts = trips.filter((t) => t.book === r.book && t.side === r.side && t.k === r.k);
    byRung[rungKey(r.book, r.side, r.k)] = {
      all: stats(ts), window: stats(ts.filter((t) => Date.parse(t.tExit) >= WINDOW_FROM)),
      heldCoins: r.held ? r4(r.rb.held) : 0, heldCostGbp: r.held ? r4(r.costGbp) : 0, overCoins: r4(r.overCoins ?? 0),
    };
  }
  // F1: exit buy-backs whose pounds sit at the venue's minimum (£0.10 to £0.11), before and after its deploy.
  const minBuyBacks = orders.filter((o) => o.leg === "exit" && o.side === "buy" && Number(o.filled_base) > 0)
    .map((o) => ({ at: Date.parse(o.filled_at ?? o.ts), gbp: Number(o.filled_base) * Number(o.avg_fill_price ?? o.price) }))
    .filter((x) => x.gbp >= 0.0999 && x.gbp <= 0.1101);
  const f1 = (xs: typeof minBuyBacks) => ({ n: xs.length, gbp: r4(sum(xs.map((x) => x.gbp))) });
  const conv = orders.filter((o) => o.leg === "convert" && Number(o.filled_base) > 0);
  out[id] = {
    capitalGbp: spec.capital, rungs: rungs.length,
    all: stats(trips), backfill: stats(trips.filter((t) => Date.parse(t.tExit) < BACKFILL_END)),
    between: stats(trips.filter((t) => Date.parse(t.tExit) >= BACKFILL_END && Date.parse(t.tExit) < WINDOW_FROM)),
    window: stats(trips.filter((t) => Date.parse(t.tExit) >= WINDOW_FROM)),
    windowRealisedPerCapital: r4(sum(trips.filter((t) => Date.parse(t.tExit) >= WINDOW_FROM).map((t) => t.pnlGbp)) / spec.capital),
    heldRungsAtCut: rungs.filter((r) => r.held).length,
    conversions: conv.length, conversionFeesGbp: r4(sum(conv.map((o) => Number(o.fee_gbp)))),
    minBuyBacks: { beforeF1: f1(minBuyBacks.filter((x) => x.at < F1_DEPLOYED)), afterF1: f1(minBuyBacks.filter((x) => x.at >= F1_DEPLOYED)) },
    byRung,
  };
  const s = out[id] as { all: ReturnType<typeof stats>; window: ReturnType<typeof stats> };
  console.log(id.padEnd(4), "all", JSON.stringify(s.all), "\n     window", JSON.stringify(s.window));
}

// d beside rule D's arm d paper trips (dollars, $100 a rung), and its spans.
const paper = (await gunzipText(`${here}../data/trips.txt.gz`)).trim().split("\n").map((l) => l.split("|"))
  .filter((f) => f[0] === "d").map((f) => ({ book: f[2], side: f[3], k: Number(f[4]), tEntry: Number(f[5]), tExit: Number(f[13]), how: f[15], pnl: Number(f[19]) }))
  .filter((t) => t.tExit < CUT);
const pstats = (ts: typeof paper) => ({ trips: ts.length, won: ts.filter((t) => t.pnl > 0).length, takers: ts.filter((t) => t.how !== "maker").length, pnlUsd: r4(sum(ts.map((t) => t.pnl))) });
const dT = tripsOf.d;
const isK = (k: number, x: number) => Math.abs(k - x) < 1e-9;
const paperByRung: Record<string, unknown> = {};
for (const b of ["USDC-GBP", "USDT-GBP"]) for (const sd of ["bid", "ask"]) for (const k of RULED_ARMS.d.rungs) {
  paperByRung[rungKey(b, sd, k)] = pstats(paper.filter((t) => t.book === b && t.side === sd && isK(t.k, k)));
}
const open03 = dT.filter((t) => isK(t.k, 0.0003) && Date.parse(t.tEntry) < RETIRED_FROM && Date.parse(t.tExit) >= RETIRED_FROM);
out.d_beside_arm_d = {
  note: "arm d's paper trips (agent_quoted_trips, its nine rungs a side throughout, $100 a rung) closed before the cut, beside the twin (£50 a rung).",
  paper: { all: pstats(paper), byRung: paperByRung },
  twinSpans: {
    nineRungs_enteredTo_1009: stats(dT.filter((t) => Date.parse(t.tEntry) < RETIRED_FROM)),
    eightRungs_enteredFrom_1010: stats(dT.filter((t) => Date.parse(t.tEntry) >= RETIRED_FROM)),
  },
  paperSpans: {
    enteredTo_1009: pstats(paper.filter((t) => t.tEntry < RETIRED_FROM)),
    enteredFrom_1010: pstats(paper.filter((t) => t.tEntry >= RETIRED_FROM)),
  },
  eightCommonRungs_wholeSpan: { twin: stats(dT.filter((t) => !isK(t.k, 0.0003))), paper: pstats(paper.filter((t) => !isK(t.k, 0.0003))) },
  rung003_enteredBefore_1010: { twin: stats(dT.filter((t) => isK(t.k, 0.0003) && Date.parse(t.tEntry) < RETIRED_FROM)), paper: pstats(paper.filter((t) => isK(t.k, 0.0003) && t.tEntry < RETIRED_FROM)) },
  rung003_enteredFrom_1010: { twin: stats(dT.filter((t) => isK(t.k, 0.0003) && Date.parse(t.tEntry) >= RETIRED_FROM)), paper: pstats(paper.filter((t) => isK(t.k, 0.0003) && t.tEntry >= RETIRED_FROM)) },
  rung003_openAt_1010: open03.map((t) => ({ book: t.book, side: t.side, tEntry: t.tEntry, tExit: t.tExit, how: t.how, pnlGbp: r4(t.pnlGbp) })),
};

// d and p50 over the window, at the three rungs both quote, and in total per pound of capital.
const common = [0.001, 0.002, 0.003];
const win = (ts: LiveTrip[]) => ts.filter((t) => Date.parse(t.tExit) >= WINDOW_FROM);
const sizeCmp: Record<string, unknown> = {};
for (const b of ["USDC-GBP", "USDT-GBP"]) for (const sd of ["bid", "ask"]) for (const k of common) {
  const f = (ts: LiveTrip[]) => stats(win(ts).filter((t) => t.book === b && t.side === sd && isK(t.k, k)));
  sizeCmp[rungKey(b, sd, k)] = { d: f(dT), p50: f(tripsOf.p50) };
}
const threeOf = (ts: LiveTrip[]) => win(ts).filter((t) => common.some((k) => isK(t.k, k)));
out.d_vs_p50_window = {
  note: "trips closed 2026-10-04 00:00 -> 2026-10-28 00:00 UTC; both at £50 a rung; d quotes nine rungs a side (eight from 10-10), p50 three.",
  byRung: sizeCmp,
  threeCommonRungs: { d: stats(threeOf(dT)), p50: stats(threeOf(tripsOf.p50)) },
  total: {
    d: { ...stats(win(dT)), capitalGbp: 1800, realisedPerPound: r4(sum(win(dT).map((t) => t.pnlGbp)) / 1800) },
    p50: { ...stats(win(tripsOf.p50)), capitalGbp: 600, realisedPerPound: r4(sum(win(tripsOf.p50).map((t) => t.pnlGbp)) / 600) },
    pr5: { ...stats(win(tripsOf.pr5)), capitalGbp: 1200, realisedPerPound: r4(sum(win(tripsOf.pr5).map((t) => t.pnlGbp)) / 1200) },
  },
};
await Deno.writeTextFile(`${here}results/readout.json`, JSON.stringify(out, null, 1) + "\n");
console.log("results/readout.json");
