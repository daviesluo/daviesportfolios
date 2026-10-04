// Scratch: why x4 ("wide") equals x1. For every minute x4 quotes from its rule's first minute, RW-X's own wideTicks and
// the reward share one whole tick further out on both sides, against the share at RW's quotes (the pool's rate cancels).
import { RWX_REST_START, RWX_WIDE_KEEP, wideTicks } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_x.ts";
import { othersOf, quote, scoreS, sizeN } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw.ts";
import { bookRow, excludedByDay, metaFor } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_e.ts";
import { load } from "./load.ts";

const DAY = 86400e3;
const { inputs, L } = load();
const excluded = excludedByDay(inputs.selection);
const inBand = (v: number, s: number) => s >= 0 && s < v - 1e-9;
type Rec = { c: string; t: number; tick: number; v: number; N: number; others: number; ours0: number; share0: number; ok1: boolean; share1: number; score1: number; ratio: number; j: number; sb0: number; sa0: number };
const recs: Rec[] = [];
const qOf = new Map(inputs.selection.map((s) => [s.cond, String(s.q ?? "")]));
for (const r of inputs.rows) {
  const t = Date.parse(r.minute);
  if (t < RWX_REST_START || t > L || !r.quoting) continue;
  const day = new Date(Math.floor(t / DAY) * DAY).toISOString().slice(0, 10);
  if (excluded.get(day)?.has(r.cond)) continue;
  const meta = metaFor(inputs.selection, r.cond, t);
  if (!meta || meta.cat === "weather_fees") continue;
  const row = bookRow(r);
  if (!row) continue;
  const tick = Number(r.tick) || 0.01;
  const q = quote(row, tick);
  if (!q) continue;
  const v = Number(meta.v), N = sizeN(Number(meta.min_size));
  const others = othersOf(q.m, q.q1, q.q2);
  const kb = Math.round(q.b / tick), ka = Math.round(q.a / tick), top = Math.round(1 / tick);
  const sb = (j: number) => (q.m - (kb - j) * tick) * 100, sa = (j: number) => ((ka + j) * tick - q.m) * 100;
  const ours = (j: number) => Math.min(scoreS(v, sb(j)) * N, scoreS(v, sa(j)) * N);
  const share = (j: number) => { const o = ours(j); return o > 0 ? o / (o + others) : 0; };
  const ok1 = kb - 1 >= 1 && ka + 1 <= top - 1 && inBand(v, sb(1)) && inBand(v, sa(1));
  const s0 = share(0), s1 = ok1 ? share(1) : 0;
  recs.push({
    c: r.cond, t, tick, v, N, others, ours0: ours(0), share0: s0, ok1, share1: s1, score1: ok1 && ours(0) > 0 ? ours(1) / ours(0) : 0,
    ratio: s0 > 0 && ok1 ? s1 / s0 : 0, j: wideTicks(q.m, q.b, q.a, others, tick, v, N, RWX_WIDE_KEEP), sb0: sb(0), sa0: sa(0),
  });
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const earning = recs.filter((x) => x.share0 > 0);
console.log(`x4's quoting minutes ${new Date(RWX_REST_START).toISOString()} → ${new Date(L).toISOString()}: ${recs.length} market-minutes, ${new Set(recs.map((x) => x.c)).size} markets; earning a reward at RW's quotes: ${earning.length}`);
const byTick = (xs: Rec[]) => Object.entries(xs.reduce((m, x) => { (m[String(x.tick)] ??= []).push(x); return m; }, {} as Record<string, Rec[]>));
for (const [tick, xs] of byTick(earning)) {
  const moved = xs.filter((x) => x.j >= 1);
  console.log(`  tick ${tick}: ${xs.length} minutes, ${new Set(xs.map((x) => x.c)).size} markets; one tick out allowed in ${xs.filter((x) => x.ok1).length}; v median ${pct(xs.map((x) => x.v), 0.5)} (min ${pct(xs.map((x) => x.v), 0)}, max ${pct(xs.map((x) => x.v), 1)}); distance of RW's quotes from the mid, cents: median ${pct(xs.map((x) => Math.min(x.sb0, x.sa0)), 0.5).toFixed(3)}`);
  const ok = xs.filter((x) => x.ok1);
  console.log(`    our score one tick out / at RW's quotes: median ${pct(ok.map((x) => x.score1), 0.5).toFixed(3)}, p90 ${pct(ok.map((x) => x.score1), 0.9).toFixed(3)}, max ${pct(ok.map((x) => x.score1), 1).toFixed(3)}`);
  console.log(`    reward share one tick out / at RW's quotes: median ${pct(ok.map((x) => x.ratio), 0.5).toFixed(3)}, p75 ${pct(ok.map((x) => x.ratio), 0.75).toFixed(3)}, p90 ${pct(ok.map((x) => x.ratio), 0.9).toFixed(3)}, p99 ${pct(ok.map((x) => x.ratio), 0.99).toFixed(3)}, max ${pct(ok.map((x) => x.ratio), 1).toFixed(3)}`);
  console.log(`    our share of the pool at RW's quotes: median ${pct(xs.map((x) => x.share0), 0.5).toFixed(3)}, p90 ${pct(xs.map((x) => x.share0), 0.9).toFixed(3)}; others' score 0 in ${xs.filter((x) => x.others === 0).length} minutes`);
  console.log(`    wideTicks ≥ 1 at keep 0.9: ${moved.length} minutes${moved.length ? `, in ${[...new Set(moved.map((x) => x.c.slice(0, 10)))].join(", ")}; share there median ${pct(moved.map((x) => x.share0), 0.5).toFixed(3)}, others' score median ${pct(moved.map((x) => x.others), 0.5).toFixed(2)}` : ""}`);
  for (const k of [0.8, 0.7, 0.6, 0.5, 0.4]) console.log(`    keep ${k}: would move in ${ok.filter((x) => x.ratio >= k).length} of ${xs.length} minutes (${(100 * ok.filter((x) => x.ratio >= k).length / xs.length).toFixed(1)} %)`);
}
const moved = recs.filter((x) => x.j >= 1);
console.log(`moved minutes by day: ${JSON.stringify(moved.reduce((m, x) => { const d = new Date(x.t).toISOString().slice(0, 13); m[d] = (m[d] ?? 0) + 1; return m; }, {} as Record<string, number>))}`);
const per = moved.reduce((m, x) => { (m[x.c] ??= []).push(x); return m; }, {} as Record<string, Rec[]>);
for (const [c, xs] of Object.entries(per)) console.log(`  ${c.slice(0, 10)} tick ${xs[0].tick} v ${xs[0].v}: ${xs.length} minutes moved, j max ${Math.max(...xs.map((x) => x.j))}, share0 median ${pct(xs.map((x) => x.share0), 0.5).toFixed(3)} | ${qOf.get(c)?.slice(0, 70)}`);
// the score ratio one whole tick out, as the quadratic gives it, at a 1-cent tick from half a tick off the mid
console.log("quadratic score one 1-cent tick out from 0.5 c, by max spread v: " + [3.5, 4.5, 5.5, 6.5, 8.5].map((v) => `v ${v}: ${(((v - 1.5) / (v - 0.5)) ** 2).toFixed(3)}`).join(", "));
console.log("v a 1-cent tick needs for 0.9 from 0.5 c: " + (0.5 + 1 / (1 - Math.sqrt(0.9))).toFixed(1) + " c; for 0.1-cent ticks from 0.05 c the ratio at v 4.5 is " + (((4.5 - 0.15) / (4.5 - 0.05)) ** 2).toFixed(3));
