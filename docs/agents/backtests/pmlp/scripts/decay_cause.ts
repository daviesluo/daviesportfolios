// Why does RW's reward per quoted minute fall through the day? RW's own rule re-run, each quoting minute classified.
import { loadRW } from "./rec.ts";
import { newAcc, othersOf, quote, scoreS, sizeN, stepRw, type Acc } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const M = 60e3, DAY = 86400e3;
const dayStr = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
const accs = new Map<string, Acc>();
const H = Array.from({ length: 24 }, () => ({ n: 0, rew: 0, inv: 0, band: 0, noq: 0, share: 0, shareN: 0, others: 0 }));
const printsAt = (c: string, t: number) => (rec.prints.get(c) ?? []).filter((p) => p.ts > t / 1000 && p.ts <= t / 1000 + 60);
for (let t = rec.start; t <= rec.last; t += M) {
  const h = new Date(t).getUTCHours();
  for (const r of rec.byMinute.get(t) ?? []) {
    const c = r.cond;
    if (!r.quoting && !accs.has(c)) continue;
    const acc = accs.get(c) ?? accs.set(c, newAcc()).get(c)!;
    if (acc.settled != null) continue;
    if (r.row && r.row[2] !== null && r.row[3] !== null) { acc.lastAb = r.row[2]; acc.lastAa = r.row[3]; }
    const mt = (rec.selection.get(dayStr(t)) ?? []).find((x) => x.cond === c);
    if (r.quoting && mt) {
      const q = r.row ? quote(r.row, r.tick) : null;
      const N = sizeN(mt.minSize);
      const x = H[h]; x.n++;
      if (!q) { x.noq++; stepRw(acc, t / 1000, r.row, r.tick, mt.v, mt.rate, N, printsAt(c, t)); continue; }
      const inv = !(acc.net < 3 * N && acc.net > -3 * N);
      const sb = scoreS(mt.v, (q.m - q.b) * 100), sa = scoreS(mt.v, (q.a - q.m) * 100);
      const out = stepRw(acc, t / 1000, r.row, r.tick, mt.v, mt.rate, N, printsAt(c, t));
      x.rew += out.decision?.reward ?? 0;
      if (inv) x.inv++; else if (!(sb > 0 && sa > 0)) x.band++;
      else { const ours = Math.min(sb, sa) * N, o = othersOf(q.m, q.q1, q.q2); x.share += ours / (ours + o); x.shareN++; x.others += o; }
    } else if (r.row && r.row[2] !== null && r.row[3] !== null) acc.lastM = (r.row[2] + r.row[3]) / 2;
  }
  for (const s of rec.settle.get(t) ?? []) { const a = accs.get(s.cond); if (a && a.settled == null) a.settled = s.payout; }
}
console.log("hour  reward/min  inv-stopped%  out-of-band/one-sided-book%  no-quote%  mean share when scoring  mean others");
H.forEach((x, h) => console.log(`${String(h).padStart(2)}   ${(x.rew / x.n).toFixed(4)}      ${(100 * x.inv / x.n).toFixed(1).padStart(5)}        ${(100 * x.band / x.n).toFixed(1).padStart(5)}               ${(100 * x.noq / x.n).toFixed(1).padStart(5)}     ${(x.share / x.shareN).toFixed(3)}         ${(x.others / x.shareN).toFixed(1)}`));
