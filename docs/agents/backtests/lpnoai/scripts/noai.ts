// LPNOAI (2026-10-10, live-prep's Addendum 12): what leaving AI markets out does, on the records there are.
// deno run --allow-read --no-check scripts/noai.ts data/lp_record.json ../lp_alloc/results/raw > results/noai.txt
//   1. The classifier (`lpMarketType`, LP-ALLOC's `typeOf` in agents/pm_lp.ts) on every live-prep selection since 10-05:
//      which markets of each day it calls AI (the hit lists).
//   2. The share of the formula reward AI markets carried on live-prep's own paper record (pm_lpprep_minutes' reward, the
//      formula at R = 1 of what the path rested; the dry-run ran until 10-09 01:32 UTC), by day and over the five days.
//   3. LP-ALLOC's trade-off on its five-day full-universe replay (at-price fills, R = 0.47 in the simulator's units, the
//      live 0.81): today's rule against the same rule without AI markets, day by day: the formula reward given up (net of
//      the places other markets take), the fills' P&L saved, and the net with the rewards counted.
import { gunzipSync } from "node:zlib";
import { lpMarketType } from "../../../../../supabase/functions/agents/pm_lp.ts";

const [recPath, rawDir] = Deno.args;
const rec = JSON.parse(Deno.readTextFileSync(recPath)) as {
  paper: Array<{ day: string; cond: string; reward: number; minutes: number; question: string | null }>;
  selections: Array<{ day: string; cond: string; rank: number; rate: number; question: string | null }>;
};
const out: string[] = [];
const P = (s = "") => out.push(s);
const f2 = (x: number) => x.toFixed(2);

P("== 1. the hit lists: each live-prep selection since 10-05, the markets lpMarketType calls AI");
const days = [...new Set(rec.selections.map((s) => s.day))].sort();
for (const d of days) {
  const sel = rec.selections.filter((s) => s.day === d);
  const hits = sel.filter((s) => lpMarketType(s.question ?? "") === "AI");
  P(`  ${d}: ${hits.length} of ${sel.length}`);
  for (const h of hits) P(`    #${h.rank} ${h.cond.slice(0, 10)} ${h.rate}/day  ${h.question}`);
}
P();
P("== 2. AI markets' share of the formula reward on live-prep's paper record (R = 1, the path's own formula)");
let ta = 0, tt = 0;
for (const d of [...new Set(rec.paper.map((r) => r.day))].sort()) {
  const rows = rec.paper.filter((r) => r.day === d);
  const all = rows.reduce((a, r) => a + Number(r.reward), 0), ai = rows.filter((r) => lpMarketType(r.question ?? "") === "AI").reduce((a, r) => a + Number(r.reward), 0);
  ta += ai; tt += all;
  P(`  ${d}: AI ${f2(ai)} of ${f2(all)} (${all > 0 ? ((100 * ai) / all).toFixed(1) : "-"} %)${d === "2026-10-09" ? "  (the dry-run's last 93 minutes)" : ""}`);
}
P(`  the five days: AI ${f2(ta)} of ${f2(tt)} (${((100 * ta) / tt).toFixed(1)} %)`);
P();
P("== 3. LP-ALLOC's replay, $330, today's rule against it without AI markets (at-price fills, R = 0.47 sim units = live 0.81)");
const load = (lb: string, file: string, key: string) => (JSON.parse(new TextDecoder().decode(gunzipSync(Deno.readFileSync(`${rawDir}/${lb}/${file}`)))) as Record<string, { daily: Array<{ day: string; tot: number; rew: number }> }>)[key];
for (const lb of ["lb0", "lb120"]) {
  const a = load(lb, "grid_atprice.json.gz", "C330 M10 k1 n20 cm100"), b = load(lb, "risk_atprice.json.gz", "C330 M10 k1 n20 cm100 noAI");
  const R = 0.47;
  P(`  listing read ${lb === "lb0" ? "as it stood" : "two hours late"} (${lb}):`);
  P(`    day         formula given up  fills saved  net change at R  (today's rule's net -> without AI)`);
  let dr = 0, df = 0, dn = 0;
  a.daily.forEach((x, i) => {
    const y = b.daily[i];
    const rx = x.rew, ry = y.rew, fx = x.tot - x.rew, fy = y.tot - y.rew, nx = x.tot - (1 - R) * x.rew, ny = y.tot - (1 - R) * y.rew;
    dr += rx - ry; df += fy - fx; dn += ny - nx;
    P(`    ${x.day}  ${f2(rx - ry).padStart(8)} (${((100 * (rx - ry)) / rx).toFixed(1)} %)  ${f2(fy - fx).padStart(8)}  ${f2(ny - nx).padStart(8)}  (${f2(nx)} -> ${f2(ny)})`);
  });
  const sumR = a.daily.reduce((s, x) => s + x.rew, 0);
  P(`    five days   ${f2(dr)} of ${f2(sumR)} (${((100 * dr) / sumR).toFixed(1)} %)  fills ${f2(df)}  net ${f2(dn)}, ${f2(dn / 5)} a day; at R: ${f2(R * dr)} of reward given up for ${f2(df)} of fills`);
}
console.log(out.join("\n"));
