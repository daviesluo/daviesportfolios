// Scratch only: every 30 minutes, the books of every rewarded market of $10 a day or more, scored by RW's firstScore, to see
// how fast a selection's best pools fill with other makers (POOLAGE) and how much the top of the ranking turns over.
// Public reads only: the CLOB reward listing and books. Questions, categories and ends come from the 15:21 read.
import { pmBooks, pmRewardsCurrent, pmSimplifiedMarkets } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import { firstScore, othersOf, quote, summarize } from "../../../../../supabase/functions/agents/pmrw.ts";

const N_READS = Number(Deno.args[0] ?? 7), EVERY_MS = Number(Deno.args[1] ?? 30 * 60e3);
const politeFetch: typeof fetch = async (input, init) => {
  for (let i = 0; ; i++) {
    const r = await fetch(input, init);
    if (r.status !== 429 || i >= 6) return r;
    await r.body?.cancel();
    await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
  }
};
const simple = await pmSimplifiedMarkets({ timeoutMs: 30e3, fetchImpl: politeFetch });
for (let k = 0; k < N_READS; k++) {
  const t0 = Date.now();
  try {
    const rewards = (await pmRewardsCurrent({ timeoutMs: 30e3, fetchImpl: politeFetch })).filter((r) => r.v > 0 && r.rate >= 10);
    const yes = new Map<string, string>();
    for (const r of rewards) { const y = simple.get(r.cond)?.yes; if (y) yes.set(r.cond, y); }
    const books = await pmBooks([...yes.values()], { timeoutMs: 30e3, concurrency: 4, fetchImpl: politeFetch });
    const rows = [];
    for (const r of rewards) {
      const y = yes.get(r.cond), bk = y ? books.get(y) : undefined;
      if (!bk) continue;
      const tick = bk.tick ?? 0.01;
      const row = summarize(bk.bids, bk.asks, r.v, r.minSize);
      const q = row ? quote(row, tick) : null;
      const fs = firstScore(row, tick, r.v, r.minSize, r.rate);
      rows.push({ cond: r.cond, rate: r.rate, v: r.v, minSize: r.minSize, tick, m: q?.m ?? null, others: q ? othersOf(q.m, q.q1, q.q2) : null, perDollarDay: fs ? fs.perDollar * 1440 : null, cap: fs?.cap ?? null, bb: row?.[0] ?? null, ba: row?.[1] ?? null });
    }
    const at = new Date().toISOString();
    Deno.writeTextFileSync(`data/track_${k}.json`, JSON.stringify({ at, rows }));
    console.error(`${at} read ${k}: ${rows.length} books in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
  } catch (e) { console.error(`read ${k} failed: ${e instanceof Error ? e.message : e}`); }
  if (k < N_READS - 1) await new Promise((res) => setTimeout(res, Math.max(0, EVERY_MS - (Date.now() - t0))));
}
