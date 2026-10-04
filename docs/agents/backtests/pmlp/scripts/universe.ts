// Scratch only, never committed: a keyless cross-section of Polymarket's rewarded universe, scored by RW's own code
// (summarize, quote, firstScore, othersOf) on books read now. Public reads only (CLOB listing, short list, books; Gamma).
import { pmBooks, pmMarkets, pmRewardsCurrent, pmSimplifiedMarkets } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import { firstScore, othersOf, quote, sizeN, summarize } from "../../../../../supabase/functions/agents/pmrw.ts";

const OUT = Deno.args[0] ?? "data/universe.json";
const t0 = Date.now();
const rewards = (await pmRewardsCurrent({ timeoutMs: 30e3 })).filter((r) => r.v > 0 && r.rate > 0);
console.error(`listing: ${rewards.length} rewarded markets in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
const simple = await pmSimplifiedMarkets({ timeoutMs: 30e3 });
console.error(`short list: ${simple.size}`);
const want = rewards.filter((r) => r.rate >= 1);
const yesOf = new Map<string, string>();
for (const r of want) { const y = simple.get(r.cond)?.yes; if (y) yesOf.set(r.cond, y); }
// A fetch that waits and asks again on a 429 (Cloudflare's rate limit), up to six times.
const politeFetch: typeof fetch = async (input, init) => {
  for (let i = 0; ; i++) {
    const r = await fetch(input, init);
    if (r.status !== 429 || i >= 6) return r;
    await r.body?.cancel();
    await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
  }
};
const books = await pmBooks([...yesOf.values()], { timeoutMs: 30e3, concurrency: 4, fetchImpl: politeFetch });
console.error(`books: ${books.size} of ${yesOf.size} in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
// Gamma only for the markets whose book scores (question, category, end, accepting), politely
const scoredConds = want.filter((r) => { const y = yesOf.get(r.cond), bk = y ? books.get(y) : undefined; if (!bk) return false; const fs = firstScore(summarize(bk.bids, bk.asks, r.v, r.minSize), bk.tick ?? 0.01, r.v, r.minSize, r.rate); return !!fs && fs.perDollar * 1440 * fs.cap >= 0.25; }).map((r) => r.cond);
const gamma = new Map<string, Awaited<ReturnType<typeof pmMarkets>>[number]>();
for (const m of await pmMarkets(scoredConds, false, { timeoutMs: 30e3, concurrency: 2, fetchImpl: politeFetch })) gamma.set(m.cond, m);
console.error(`gamma: ${gamma.size} of ${scoredConds.length} scored in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
const rows: Record<string, unknown>[] = [];
for (const r of want) {
  const yes = yesOf.get(r.cond), bk = yes ? books.get(yes) : undefined, g = gamma.get(r.cond);
  const base = { cond: r.cond, rate: r.rate, v: r.v, minSize: r.minSize, N: sizeN(r.minSize), q: g?.q ?? null, cat: g?.cat ?? null, end: g?.end ?? null, accepting: g?.accepting ?? null, closed: g?.closed ?? null };
  if (!bk) { rows.push({ ...base, book: false }); continue; }
  const tick = bk.tick ?? g?.tick ?? 0.01;
  const row = summarize(bk.bids, bk.asks, r.v, r.minSize);
  const q = row ? quote(row, tick) : null;
  const fs = firstScore(row, tick, r.v, r.minSize, r.rate);
  const depth = (lv: [number, number][], from: number, cents: number, side: 1 | -1) => lv.filter(([p]) => side * (from - p) <= cents / 100 + 1e-9).reduce((s, [, z]) => s + z, 0);
  rows.push({
    ...base, book: true, tick, bb: row?.[0] ?? null, ba: row?.[1] ?? null, ab: row?.[2] ?? null, aa: row?.[3] ?? null, q1: row?.[4] ?? null, q2: row?.[5] ?? null,
    m: q?.m ?? null, b: q?.b ?? null, a: q?.a ?? null, others: q ? othersOf(q.m, q.q1, q.q2) : null,
    perDollarDay: fs ? fs.perDollar * 1440 : null, cap: fs?.cap ?? null, formulaDay: fs ? fs.perDollar * 1440 * fs.cap : null,
    bidDepth5: bk.bids.length ? depth(bk.bids, bk.bids[0][0], 5, 1) : 0, askDepth5: bk.asks.length ? depth(bk.asks, bk.asks[0][0], 5, -1) : 0,
    levels: bk.bids.length + bk.asks.length,
  });
}
Deno.writeTextFileSync(OUT, JSON.stringify({ readAt: new Date().toISOString(), seconds: (Date.now() - t0) / 1e3, rows }));
console.error(`wrote ${rows.length} rows to ${OUT} in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
