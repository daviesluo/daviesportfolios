// How fast does the side that reduces a held position fill? RW's own rule on its own record: every quoting minute that
// began holding at least 5 shares, whether the reducing side filled in it and by how much.
import { loadRW } from "./rec.ts";
import { newAcc, sizeN, stepRw, type Acc } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const M = 60e3, DAY = 86400e3;
const dayStr = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
const prints = new Map<string, Map<number, ReturnType<typeof Array.prototype.slice>>>();
const idx = new Map<string, Array<{ ts: number }>>();
const accs = new Map<string, Acc>();
let minutes = 0, filledMin = 0, shares = 0;
const byHeld: Record<string, { min: number; filled: number; sh: number }> = {};
const printsAt = (c: string, t: number) => (rec.prints.get(c) ?? []).filter((p) => p.ts > t / 1000 && p.ts <= t / 1000 + 60);
for (let t = rec.start; t <= rec.last; t += M) {
  for (const r of rec.byMinute.get(t) ?? []) {
    const c = r.cond;
    if (!r.quoting && !accs.has(c)) continue;
    const acc = accs.get(c) ?? accs.set(c, newAcc()).get(c)!;
    if (acc.settled != null) continue;
    if (r.row && r.row[2] !== null && r.row[3] !== null) { acc.lastAb = r.row[2]; acc.lastAa = r.row[3]; }
    const mt = (rec.selection.get(dayStr(t)) ?? []).find((x) => x.cond === c);
    if (r.quoting && mt) {
      const net0 = acc.net, N = sizeN(mt.minSize);
      const out = stepRw(acc, t / 1000, r.row, r.tick, mt.v, mt.rate, N, printsAt(c, t));
      if (out.decision && Math.abs(net0) >= 5) {
        const red = out.fills.filter((f) => (net0 > 0 ? f.side === "ask" : f.side === "bid")).reduce((s, f) => s + f.size, 0);
        minutes++; if (red > 0) { filledMin++; shares += red; }
        const k = Math.abs(net0) < N ? "<N" : Math.abs(net0) < 2 * N ? "N-2N" : Math.abs(net0) < 3 * N ? "2N-3N" : ">=3N";
        const b = (byHeld[k] ??= { min: 0, filled: 0, sh: 0 }); b.min++; if (red > 0) { b.filled++; b.sh += red; }
      }
    } else if (r.row && r.row[2] !== null && r.row[3] !== null) acc.lastM = (r.row[2] + r.row[3]) / 2;
  }
  for (const x of rec.settle.get(t) ?? []) { const a = accs.get(x.cond); if (a && a.settled == null) a.settled = x.payout; }
}
console.log(`quoting minutes that began holding >= 5 shares: ${minutes}; the reducing side filled in ${filledMin} (${(100 * filledMin / minutes).toFixed(2)} %), ${shares.toFixed(0)} shares: ${(shares / minutes).toFixed(3)} shares a minute, ${(shares / minutes * 60).toFixed(1)} an hour`);
for (const [k, b] of Object.entries(byHeld)) console.log(`  holding ${k}: ${b.min} minutes, filled ${(100 * b.filled / b.min).toFixed(2)} %, ${(b.sh / b.min * 60).toFixed(1)} shares an hour`);
