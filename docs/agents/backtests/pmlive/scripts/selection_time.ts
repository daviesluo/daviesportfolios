// Keyless, 2026-10-01: the order path's own selection (`selectMarkets` in agents/pm_live.ts, which reads the reward
// listing through `rewardListing`) against the live venue, timed end to end the way the minute's turn runs it, with the
// turn's 40 s deadline. The universe it scores is [$6, $10): nothing of RW's universe is scored. Prints aggregates only:
// no market is named.
//   cd docs/agents/backtests/pmlive/scripts && npx --yes deno@1.46.3 run --allow-net --allow-env selection_time.ts 3 6 120 > ../results/selection_time_out.txt
import { PM_LIVE_SELECT_UNTIL_MS, rewardListing, selectMarkets } from "../../../../../supabase/functions/agents/pm_live.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";

const runs = Number(Deno.args[0] ?? 2), maxMarkets = Number(Deno.args[1] ?? 6), budget = Number(Deno.args[2] ?? 120);
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: 5000 });
const t0 = Date.now();
const l = await rewardListing(venue, { clock: () => Date.now(), until: t0 + PM_LIVE_SELECT_UNTIL_MS });
console.log(JSON.stringify({ at: new Date().toISOString(), listingAlone: { ms: Date.now() - t0, ok: l.ok, pages: l.pages, how: l.how, rewarded: l.rows.size, shiftsNonZero: l.shifts.length, maxShift: Math.max(0, ...l.shifts.map(Math.abs)), error: l.error ?? null } }));
for (let k = 0; k < runs; k++) {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const sel = await selectMarkets(venue, day, { maxMarkets, budget }, new Set(), { clock: () => Date.now(), until: now + PM_LIVE_SELECT_UNTIL_MS }, now);
  const ms = Date.now() - now;
  const { listing, universe, gammaReads, eligible, booksRead, booksGone, mismatched, oneSided, scored, chosen, capital, formulaDay, error } = sel.note as Record<string, unknown>;
  console.log(JSON.stringify({
    at: new Date().toISOString(), run: k + 1, maxMarkets, budget, ms, listing, universe, gammaReads, eligible, booksRead, booksGone, mismatched, oneSided, scored, chosen, capital, formulaDay,
    picks: sel.picks.map((p) => ({ rate: p.reward_rate, n: p.n_size, perDollarDay: Math.round(Number(p.per_dollar_day) * 1e4) / 1e4, capital: Math.round(Number(p.capital) * 100) / 100, formulaDay: Math.round(Number(p.formula_day) * 100) / 100, negRisk: p.neg_risk })),
    error: error ?? null,
  }));
}
