// The USDG/EUR basis fair re-tested on the OKX twins' OWN engine and fill model (Davies, 2026-10-29: "…你先按okx的研究下，还成立的话
// 再上线"): `stepOkxMinute` (supabase/functions/agents/okx_quotes.ts, imported read-only and called unchanged) on every recorded
// USDG-EUR print since 2026-02-23 (okx_usdg_basis_prep.py), minute by minute, three arms:
//   par           the USDG/EUR row's rule: x = the minute's EUR/USD (`fxBarAt`, the newest bar of the last ten minutes), $100 a rung;
//   basis         fair = par × (1 + ½ b): x' = EUR/USD ÷ (1 + ½ b) and the rung $100 ÷ (1 + ½ b), so the euros a rung are the par
//                 arm's; b the median over the minutes j in [t − 24 h, t − 1 min] with a print of (j's last print ÷ par(j) − 1),
//                 par(j) = 1 / the newest EUR/USD bar that started at or before j − 1 min; fewer than five such minutes, b = 0
//                 (the rule a "- 1" row would run);
//   basis_carry   the same, but with fewer than five minutes the last median is carried (the fair-price study's replay rule).
// A dark minute is passed no rate in every arm, so inside a closure the engine holds its last x (`okxXAt`). LIVE's "at" fill by the
// print's size, post-only against the recorded book where one exists (from 2026-10-28 19:53) and else the last print, exits at
// fair, the 24-hour stop, the dark and de-peg guards: all the engine's. The daily loss stop is left out of every arm and counted
// apart (`lossDays`: UTC days whose closed trips lost 1 % of $600). The incremental median is checked against a direct scan
// every 997th minute.
// usage (repository root): deno run --allow-read --allow-write docs/agents/backtests/fair_price_cb_okx/scripts/okx_usdg_basis_replay.ts IN.json OUT.json
import { newOkxBookState, OKX_RUNG_USD, okxTouchAt, stepOkxMinute, type OkxTapePrint, type OkxTouch } from "../../../../../supabase/functions/agents/okx_quotes.ts";
import { fxBarAt } from "../../../../../supabase/functions/agents/quotes.ts";

const M = 60e3, DAY = 86400e3, W = 0.5, MIN = 5;
type In = { t0: number; t1: number; prints: Array<[number, number, number, string, number]>; eur: Array<[number, number]>; touches: OkxTouch[] };
const [inPath, outPath] = Deno.args;
const d = JSON.parse(await Deno.readTextFile(inPath)) as In;
const prints: OkxTapePrint[] = d.prints.map(([ts, ticks, qty, side, id]) => ({ ts, ticks, qty, side: side === "buy" ? "buy" : "sell", id }));
const bars = d.eur;

/** The newest bar that started at or before t − 1 min, any age. */
function barBefore(t: number): number | null {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] <= t - M) lo = mid + 1; else hi = mid; }
  return lo > 0 ? bars[lo - 1][1] : null;
}
// each minute's last print and its basis value
const lastOf = new Map<number, OkxTapePrint>();
for (const p of prints) { const j = Math.floor(p.ts / M) * M, w = lastOf.get(j); if (!w || p.ts > w.ts || (p.ts === w.ts && p.id > w.id)) lastOf.set(j, p); }
const vOf = new Map<number, number>();
for (const [j, p] of lastOf) { const x = barBefore(j); if (x) vOf.set(j, p.ticks * 1e-4 * x - 1); }
const vMinutes = [...vOf.keys()].sort((a, c) => a - c);
const median = (s: number[]) => { const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function directB(t: number): { b: number; n: number } {
  const vs = vMinutes.filter((j) => j >= t - DAY && j < t).map((j) => vOf.get(j)!).sort((a, c) => a - c);
  return vs.length < MIN ? { b: 0, n: vs.length } : { b: median(vs), n: vs.length };
}

type Arm = "par" | "basis" | "basis_carry";
const arms: Arm[] = ["par", "basis", "basis_carry"];
const state = Object.fromEntries(arms.map((a) => [a, { s: newOkxBookState("USDG-EUR"), trips: [] as unknown[], lastB: 0, carry: 0, orders: 0, refused: 0, fills: 0, guards: {} as Record<string, number> }]));
const sorted: number[] = [];
let lo = 0, hi = 0, j = 0, checked = 0;
const bStats: number[] = [];
for (let t = d.t0, i = 0; t < d.t1; t += M, i++) {
  while (hi < vMinutes.length && vMinutes[hi] < t) { const v = vOf.get(vMinutes[hi])!; let a = 0, z = sorted.length; while (a < z) { const m = (a + z) >> 1; if (sorted[m] < v) a = m + 1; else z = m; } sorted.splice(a, 0, v); hi++; }
  while (lo < hi && vMinutes[lo] < t - DAY) { const v = vOf.get(vMinutes[lo])!; let a = 0, z = sorted.length; while (a < z) { const m = (a + z) >> 1; if (sorted[m] < v) a = m + 1; else z = m; } sorted.splice(a, 1); lo++; }
  const n = sorted.length, med = n ? median(sorted) : 0, b = n >= MIN ? med : 0;
  if (i % 997 === 0) { const r = directB(t); if (Math.abs(r.b - b) > 1e-15 || r.n !== n) throw new Error(`basis mismatch at ${t}: ${r.b} ${b} ${r.n} ${n}`); checked++; }
  const mine: OkxTapePrint[] = [];
  while (j < prints.length && prints[j].ts < t + M) { if (prints[j].ts >= t) mine.push(prints[j]); j++; }
  const eb = fxBarAt(t, bars);
  const touchStart = okxTouchAt(d.touches, t), touchEnd = okxTouchAt(d.touches, t + M - 1);
  if (eb && n >= MIN) bStats.push(b);
  for (const a of arms) {
    const A = state[a];
    if (a === "basis_carry" && n >= MIN) A.carry = med;
    const bb = a === "par" ? 0 : a === "basis" ? b : A.carry;
    const k = 1 + W * (eb ? bb : A.lastB);
    if (eb) A.lastB = a === "par" ? 0 : bb;
    const out = stepOkxMinute(A.s, t, { eurusd: eb ? eb[1] / k : null, gbpusd: null, prints: mine, touchStart, touchEnd, rungUsd: OKX_RUNG_USD / k });
    A.orders += out.orders;
    A.refused += out.events.filter((e) => e.kind === "refused").length;
    A.fills += out.events.filter((e) => e.kind === "fill").length;
    if (out.guard) A.guards[out.guard] = (A.guards[out.guard] ?? 0) + 1;
    for (const x of out.trips) A.trips.push([x.tEntry, x.tExit, x.side, x.k, x.entry, x.qty, x.exit, x.how, x.pnlQuote]);
  }
}
const q = (p: number) => { const s = [...bStats].sort((a, c) => a - c); return s[Math.floor(p * (s.length - 1))]; };
const res = {
  t0: d.t0, t1: d.t1, prints: prints.length, minutesChecked: checked,
  basis: { lit_minutes_with_5: bStats.length, p10: q(0.1), median: q(0.5), p90: q(0.9) },
  arms: Object.fromEntries(arms.map((a) => [a, { trips: state[a].trips, orders: state[a].orders, refused: state[a].refused, fills: state[a].fills, guards: state[a].guards,
    open: state[a].s.rungs.filter((r) => r.mode === "position").length }])),
};
await Deno.writeTextFile(outPath, JSON.stringify(res));
console.log(JSON.stringify({ prints: res.prints, checked, basis: res.basis, arms: Object.fromEntries(arms.map((a) => [a, { trips: state[a].trips.length, fills: state[a].fills,
  pnl: Number((state[a].trips as Array<unknown[]>).reduce((s, x) => s + (x[8] as number), 0).toFixed(4)) }])) }));
