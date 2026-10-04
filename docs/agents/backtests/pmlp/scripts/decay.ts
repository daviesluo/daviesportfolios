// How much of a selection's first-round formula (rate x share at one book, a day) the quotes then earn, market-day by market-day.
import { loadPool, loadRW, type Rec } from "./rec.ts";
const DAY = 86400e3;
function decay(rec: Rec, rewardOf: (r: { cond: string }, t: number) => number) {
  let first = 0, got = 0, n = 0;
  const per: number[] = [];
  for (const [day, sel] of rec.selection) {
    const t0 = Date.parse(`${day}T00:00:00Z`);
    if (t0 < rec.start || t0 + DAY - 60e3 > rec.last) continue;      // whole days only
    const rew = new Map<string, number>();
    for (let t = t0; t < t0 + DAY; t += 60e3) for (const r of rec.byMinute.get(t) ?? []) rew.set(r.cond, (rew.get(r.cond) ?? 0) + rewardOf(r, t));
    for (const m of sel) {
      if (m.perDollarDay === null || m.capital === null) continue;
      const f = m.perDollarDay * m.capital, g = rew.get(m.cond) ?? 0;
      first += f; got += g; n++; per.push(f > 0 ? g / f : 0);
    }
  }
  per.sort((a, b) => a - b);
  const q = (p: number) => per[Math.floor(p * (per.length - 1))];
  return { marketDays: n, firstRound: first, realised: got, ratio: got / first, p25: q(0.25), median: q(0.5), p75: q(0.75) };
}
const rw = loadRW();
const rRW = decay(rw, (r) => (r as { rec?: { reward: number | null } }).rec?.reward ?? 0);
console.log("RW (whole days 09-25..10-03; recorded minute rewards):", JSON.stringify(rRW, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
// pools: the path's own minute formula (pm_live_minutes.formula_usd) — re-read from the dumps
for (const name of ["mini", "mid"] as const) {
  const p = JSON.parse(Deno.readTextFileSync(`data/${name}.json`));
  const f = new Map<string, number>();
  for (const line of (p.data as string).split(";")) {
    const [ci, m0, n, t] = [line.slice(0, line.indexOf(",")), ...line.slice(line.indexOf(",") + 1).split(",", 3)];
    const x = t.split("|"); const fu = Number(x[16] || 0);
    for (let k = 0; k < Number(n); k++) f.set(`${p.conds[Number(ci)]}|${(Number(m0) + k) * 60e3}`, fu);
  }
  const rec = loadPool(name);
  console.log(`${name} (whole days; the path's minute formula):`, JSON.stringify(decay(rec, (r, t) => f.get(`${r.cond}|${t}`) ?? 0), (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
}
