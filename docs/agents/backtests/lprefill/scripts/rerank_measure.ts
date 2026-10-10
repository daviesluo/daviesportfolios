// LPREFILL (2026-10-10, live-prep's Addendum 13): one full re-rank of the live reserve, measured against Polymarket itself
// (keyless public reads, nothing placed): its wall time and its requests by route, twice (cold, then warm caches).
// cd docs/agents/backtests/lprefill && deno run --allow-net --allow-env --allow-read --no-check scripts/rerank_measure.ts <today's conds…> > results/rerank_measure.txt
// It is `pm_lp_reserve.ts`'s re-rank: `selectMarkets` with no market to choose and a reserve of PM_LP_REFILL.reserveSize.
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";
import { selectMarkets } from "../../../../../supabase/functions/agents/pm_live.ts";
import { PM_LP_INSTANCE, PM_LP_REFILL } from "../../../../../supabase/functions/agents/pm_lp.ts";
const counts: Record<string, number> = {};
const fetchImpl: typeof fetch = (input, init) => {
  const u = new URL(String(input instanceof Request ? input.url : input)); const k = `${(init?.method ?? "GET")} ${u.host}${u.pathname.replace(/0x[0-9a-f]{64}/, "{id}")}`;
  counts[k] = (counts[k] ?? 0) + 1; return fetch(input, init);
};
const venue = pmVenue({ fetchImpl, sigType: 1, timeoutMs: 5000 });
const inst = PM_LP_INSTANCE;
const today = Deno.args;
for (let run = 0; run < 2; run++) {
  for (const k of Object.keys(counts)) delete counts[k];
  const t0 = Date.now();
  const sel = await selectMarkets(venue, new Date().toISOString().slice(0, 10), {
    maxMarkets: 0, budget: 200, band: inst.band, reserve: PM_LP_REFILL.reserveSize, bookBatch: (t) => inst.bookBatch!(t, { fetchImpl, timeoutMs: 5000 }), candidate: inst.lp!.candidate,
  }, new Set(today), { clock: () => Date.now(), until: Date.now() + 40e3 }, Date.now());
  const ms = Date.now() - t0;
  console.log(JSON.stringify({ run, ms, requests: Object.values(counts).reduce((a, b) => a + b, 0), counts, note: { ...sel.note }, reserve: (sel.reserve ?? []).slice(0, 5).map((r) => [r.cond.slice(0, 10), r.reward_rate, r.question?.slice(0, 50)]) }));
}
