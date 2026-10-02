// Keyless, 2026-10-02: mid-pool's own selection (`selectMarkets` in agents/pm_live.ts with `PM_MID_INSTANCE`'s band and
// exclusion, agents/pm_mid.ts) against the live venue, timed end to end the way the minute's turn runs it, with the
// turn's 40 s deadline. Prints counts, times and the exclusion's own counts only: no market is named and no market's
// figure is printed, so nothing here is a list of RW's picks or of mid-pool's. `batch` reads the candidates' books as
// mid-pool does (`PM_MID_INSTANCE.bookBatch`, a hundred a POST); `single` as small-pool does, one GET each. Its CPU is
// the process's, user and system, read around a run of N selections and a run of none (the imports alone) by
// `cpu_time.py`; their difference over N, every thread of the process counted, is an upper bound on what an Edge
// isolate is charged.
//   cd docs/agents/backtests/pmlive/scripts && python3 cpu_time.py deno run --allow-net --allow-env mid_selection_time.ts 0 batch
//   (then 3 batch and 3 single; Deno 1.46.3, e.g. `npx --yes deno@1.46.3`, appending each to ../results/mid_selection_time_out.txt)
import { PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_TIMEOUT_MS, selectMarkets } from "../../../../../supabase/functions/agents/pm_live.ts";
import { PM_MID_INSTANCE } from "../../../../../supabase/functions/agents/pm_mid.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";

const runs = Number(Deno.args[0] ?? 2), read = Deno.args[1] ?? "batch";
if (read !== "batch" && read !== "single") throw new Error("the second argument is batch or single");
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: PM_LIVE_TIMEOUT_MS, sendsEnabled: false });
for (let k = 0; k < runs; k++) {
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const sel = await selectMarkets(venue, day, {
    maxMarkets: 8, budget: 160, band: PM_MID_INSTANCE.band, exclusion: PM_MID_INSTANCE.exclusion, pm: { timeoutMs: PM_LIVE_TIMEOUT_MS },
    bookBatch: read === "batch" ? (tokens) => PM_MID_INSTANCE.bookBatch!(tokens, { timeoutMs: PM_LIVE_TIMEOUT_MS }) : undefined,
  },
    new Set(), { clock: () => Date.now(), until: now + PM_LIVE_SELECT_UNTIL_MS }, now);
  const ms = Date.now() - now;
  const { listing, exclusion, universe, gammaReads, eligible, booksRead, booksGone, mismatched, oneSided, scored, chosen, capital, formulaDay, error } = sel.note as Record<string, unknown>;
  console.log(JSON.stringify({
    at: new Date().toISOString(), read, run: k + 1, ms, listing, exclusion, universe, gammaReads, eligible, booksRead, booksGone, mismatched, oneSided, scored, chosen,
    capital, formulaDay, picks: sel.picks.length, inBand: sel.picks.every((p) => Number(p.reward_rate) >= 10 && Number(p.reward_rate) < 50), error: error ?? null,
  }));
}
