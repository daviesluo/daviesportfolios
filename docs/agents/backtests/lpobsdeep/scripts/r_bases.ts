// LP-OBS-DEEP, item 4: live-prep's R on each basis, through the page's own functions (`lpLiveR`, `lpLiveSummary`'s r),
// and what a mixed basis costs where it is used. Input: data/reward_days.json (pm_lp_reward_days, live rows, read
// 2026-10-11 01:19 UTC). Run from the repository root:
//   deno run --allow-read docs/agents/backtests/lpobsdeep/scripts/r_bases.ts > docs/agents/backtests/lpobsdeep/results/r_bases.txt
import { lpLiveR, scoredFormulaOf, type LpLiveRewardDayRow } from "../../../../../supabase/functions/agents/pm_lp_live_view.ts";

const rows: LpLiveRewardDayRow[] = JSON.parse(await Deno.readTextFile(new URL("../data/reward_days.json", import.meta.url)));
const now = Date.parse("2026-10-11T01:30:00Z");
const n = (x: unknown) => Number(x ?? 0);
const paid = rows.reduce((a, r) => a + n(r.actual_usd) + n(r.actual_sponsored_usd), 0);
const rebates = rows.reduce((a, r) => a + n(r.rebate_usd), 0);
const scored = rows.reduce((a, r) => a + scoredFormulaOf(r), 0);                       // the page's denominator
const wholeLfl = rows.reduce((a, r) => a + (r.day === "2026-10-09" ? scoredFormulaOf(r) : n(r.formula_usd)), 0); // LP-RULES' 0.737
const wholeRaw = rows.reduce((a, r) => a + n(r.formula_usd), 0);                         // lp_readout.sql's
const f = (x: number, d = 4) => x.toFixed(d);

console.log("Pooled R (sum paid / sum formula), paid = rewards native + sponsored, rebates apart");
console.log(`  paid ${f(paid)}  rebates ${f(rebates)}`);
console.log(`  scored formula, 10-09 like for like (the page: lpLiveSummary.r, DAYS)   ${f(scored)}  R ${f(paid / scored)}`);
console.log(`  whole formula, 10-09 like for like (LP-RULES' 0.737)                    ${f(wholeLfl)}  R ${f(paid / wholeLfl)}`);
console.log(`  whole formula as the readout wrote it (lp_readout.sql: the end rule)    ${f(wholeRaw)}  R ${f(paid / wholeRaw)}`);
for (const day of ["2026-10-09", "2026-10-10"]) {
  const d = rows.filter((r) => r.day === day);
  const p = d.reduce((a, r) => a + n(r.actual_usd) + n(r.actual_sponsored_usd), 0);
  const s = d.reduce((a, r) => a + scoredFormulaOf(r), 0), w = d.reduce((a, r) => a + n(r.formula_usd), 0);
  console.log(`  ${day}: paid ${f(p)}  scored ${f(s)} (R ${f(p / s)})  whole ${f(w)} (R ${f(p / w)})`);
}

// lpLiveR, the shrunk log-mean every "live R" figure reads (estimate, TESTING rows), on each basis.
const asWhole = rows.map((r) => ({ ...r, formula_scored_usd: r.formula_usd }));      // 10-09 stays like for like: scoredFormulaOf overrides it
const Rs = lpLiveR(rows, now), Rw = lpLiveR(asWhole, now);
console.log("\nlpLiveR at 2026-10-11 01:30 UTC (prior 0.2-1 weighing two days; point = exp of the shrunk mean; band 10th-90th)");
console.log(`  scored basis (deployed)  point ${f(Rs.point)}  band ${f(Rs.low)}-${f(Rs.high)}  days ${Rs.days}`);
console.log(`  whole basis              point ${f(Rw.point)}  band ${f(Rw.low)}-${f(Rw.high)}  days ${Rw.days}`);
console.log(`  ratio scored/whole point ${f(Rs.point / Rw.point)}`);

// TESTING's paper rows: atLiveR multiplies each row's programme-corrected formula (pm_prog_factors.formula_true, every
// quoted minute, no scoring flag: a whole-basis figure) by lpLiveR's point. The overstatement is (point_s - point_w) x F.
const prog = { "rwc 10-10": 78.99, "rwc 10-09..10-11": 183.31, "midprep 10-10": 12.64 };
console.log("\nTESTING rows priced at the scored R but on a whole-basis formula: overstatement (point_s - point_w) x formula");
for (const [k, F] of Object.entries(prog)) console.log(`  ${k.padEnd(18)} formula_true ${f(F, 2)}  at scored ${f(Rs.point * F, 2)}  at whole ${f(Rw.point * F, 2)}  over ${f((Rs.point - Rw.point) * F, 2)}`);

// The end rule (pre-registration, "Live: what is read"): after 7 live days with >= 40 market-days, stop if R < 0.20,
// R as lp_readout.sql reads it (whole formula as written, 10-09 at 153.90). Days 3..7 at a daily formula F and a true R:
const d09 = rows.filter((r) => r.day === "2026-10-09"), d10 = rows.filter((r) => r.day === "2026-10-10");
const sum = (xs: LpLiveRewardDayRow[], g: (r: LpLiveRewardDayRow) => number) => xs.reduce((a, r) => a + g(r), 0);
const P0 = sum([...d09, ...d10], (r) => n(r.actual_usd) + n(r.actual_sponsored_usd));
const Fraw = sum([...d09, ...d10], (r) => n(r.formula_usd)), Flfl = sum(d09, scoredFormulaOf) + sum(d10, (r) => n(r.formula_usd));
console.log("\nThe 7-day end rule's R (days 1-2 as read; days 3-7 at formula F a day and true R), frozen script vs 10-09 like for like");
console.log("  F/day  R_true  frozen  like-for-like  frozen trips?  lfl trips?");
for (const F of [10, 15, 20, 30]) for (const R of [0.25, 0.3, 0.4, 0.74]) {
  const a = (P0 + 5 * R * F) / (Fraw + 5 * F), b = (P0 + 5 * R * F) / (Flfl + 5 * F);
  console.log(`  ${String(F).padStart(5)}  ${f(R, 2).padStart(6)}  ${f(a, 3)}   ${f(b, 3)}          ${a < 0.2 ? "YES" : "no "}            ${b < 0.2 ? "YES" : "no"}`);
}
// The R below which the frozen script trips at day 7, by F: (P0 + 5RF)/(Fraw + 5F) < 0.2  <=>  R < (0.2(Fraw + 5F) - P0)/(5F)
console.log("  trip threshold on the true R, frozen / like for like:");
for (const F of [10, 15, 20, 30]) console.log(`    F ${F}: ${f((0.2 * (Fraw + 5 * F) - P0) / (5 * F), 3)} / ${f((0.2 * (Flfl + 5 * F) - P0) / (5 * F), 3)}`);
