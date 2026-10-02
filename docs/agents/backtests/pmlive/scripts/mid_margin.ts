// Keyless, 2026-10-02: the margin of mid-pool's exclusion (`PM_MID_EXCLUSION_MARGIN`, agents/pm_mid.ts). Takes N snapshots
// of RW's frozen selection recomputed from public data by the production function (`rwSelectionNow`, on the listing read
// by the path's own `rewardListing`), about 72 s apart, and reports, in counts and ratios only:
//   * for each minute to the next, every market that joined RW's picks, and where it stood the minute before: its rank,
//     and its score as a share of that minute's last pick (null: not scorable then);
//   * for each pair of snapshots and each margin tau: mid-pool's picks at the first (a market of its band, N <= 20, a
//     first-round formula of $2.50 a day, scoring under (1 - tau) of RW's last pick and not one of RW's picks; RW's
//     `choose` within $160, at most eight: the selection's ranking and budget without its Gamma, horizon and own book
//     reads, which only take markets out), how many of them are among RW's picks at the second, and how many markets of
//     the band the margin leaves out.
// No market is named and no market's rate, score or capital is printed: nothing here is a list of RW's picks.
//   cd docs/agents/backtests/pmlive/scripts && npx --yes deno@1.46.3 run --allow-net --allow-env mid_margin.ts 14 > ../results/mid_margin_out.txt
import { PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_TIMEOUT_MS, rewardListing, type PmRewardRow } from "../../../../../supabase/functions/agents/pm_live.ts";
import { leftOut, PM_MID_BAND, rwSelectionNow, type RwScored } from "../../../../../supabase/functions/agents/pm_mid.ts";
import { choose, sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";

const N = Number(Deno.args[0] ?? 14);
const TAUS = [0, 0.25, 0.5, 0.67, 0.8];
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: PM_LIVE_TIMEOUT_MS, sendsEnabled: false });
type Snap = { at: number; listing: Map<string, PmRewardRow>; scored: RwScored[]; taken: RwScored[]; L: number };
const snaps: Snap[] = [];
for (let k = 0; k < N; k++) {
  if (k) await new Promise((r) => setTimeout(r, 60e3));
  const t0 = Date.now(), dl = { clock: () => Date.now(), until: t0 + PM_LIVE_SELECT_UNTIL_MS };
  const l = await rewardListing(venue, dl);
  if (!l.ok) { console.log(JSON.stringify({ k, error: l.error })); continue; }
  const r = await rwSelectionNow(l.rows, { dl, nowMs: t0, pm: { timeoutMs: 15000 } });
  if ("error" in r) { console.log(JSON.stringify({ k, error: r.error })); continue; }
  const L = Math.min(...r.taken.map((x) => x.perDollar));
  snaps.push({ at: Date.now(), listing: l.rows, scored: r.scored, taken: r.taken, L });
  console.log(JSON.stringify({ k, at: new Date().toISOString(), ms: Date.now() - t0, universe: r.universe, scored: r.scored.length, taken: r.taken.length }));
}
const ranked = (s: Snap) => s.scored.slice().sort((x, y) => (y.perDollar - x.perDollar) || (x.cond < y.cond ? -1 : 1));
for (let k = 1; k < snaps.length; k++) {
  const a = snaps[k - 1], b = snaps[k];
  const was = new Set(a.taken.map((x) => x.cond));
  const rankA = new Map(ranked(a).map((x, i) => [x.cond, i + 1])), pdA = new Map(a.scored.map((x) => [x.cond, x.perDollar]));
  const entered = b.taken.filter((x) => !was.has(x.cond)).map((x) => ({
    rankBefore: rankA.get(x.cond) ?? null, shareOfLastPickBefore: pdA.has(x.cond) ? Math.round((pdA.get(x.cond)! / a.L) * 1000) / 1000 : null,
  }));
  console.log(JSON.stringify({ minuteToNext: k, joinedRwPicks: entered.length, leftRwPicks: a.taken.filter((x) => !b.taken.some((y) => y.cond === x.cond)).length, entered }));
}
const inBand = (s: Snap, c: string) => {
  const r = s.listing.get(c);
  return !!r && r.rate >= PM_MID_BAND.floor && r.rate < PM_MID_BAND.ceiling && sizeN(r.minSize) <= 20;
};
const midPicks = (s: Snap, tau: number) => {
  const out = leftOut(s, tau);
  const cand = s.scored.filter((x) => inBand(s, x.cond) && !out.has(x.cond) && x.perDollar * 1440 * x.cap >= 2.5 - 1e-9);
  return { picks: choose(cand, 160).slice(0, 8).map((x) => x.cond), left: s.scored.filter((x) => inBand(s, x.cond) && out.has(x.cond)).length };
};
const rows: Record<string, { pairs: number; picks: number; overlaps: number; pairsWithOverlap: number; leftOutOfBand: number }> = {};
for (let i = 0; i < snaps.length; i++) {
  for (let j = i + 1; j < snaps.length; j++) {
    const gap = Math.round((snaps[j].at - snaps[i].at) / 60e3), bucket = gap <= 2 ? "<=2 min" : gap <= 6 ? "3-6 min" : "7+ min";
    const later = new Set(snaps[j].taken.map((x) => x.cond));
    for (const tau of TAUS) {
      const r = (rows[`${bucket} tau=${tau}`] ??= { pairs: 0, picks: 0, overlaps: 0, pairsWithOverlap: 0, leftOutOfBand: 0 });
      const m = midPicks(snaps[i], tau), ov = m.picks.filter((c) => later.has(c)).length;
      r.pairs++; r.picks += m.picks.length; r.overlaps += ov; if (ov) r.pairsWithOverlap++; r.leftOutOfBand += m.left;
    }
  }
}
for (const [k, r] of Object.entries(rows)) console.log(JSON.stringify({ k, ...r, leftOutOfBandPerPair: Math.round((r.leftOutOfBand / r.pairs) * 10) / 10 }));
