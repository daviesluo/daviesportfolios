// Keyless, 2026-10-04: the books of mini-pool's whole universe, once a minute, for the selection's book-quality filter
// (Addendum 6 of reviews/2026-10-01-polymarket-live-prep-prereg.md). It reads what the path's selection reads, through the
// path's own code: the reward listing whole (`rewardListing`), Gamma's records of the band's markets (`candidateOf` at the
// first read's clock: accepting orders, two tokens, the 48-hour horizon, RW-E's same-day rule), then every eligible
// market's YES book once a minute (`bookReplies`, the CLOB's public POST /books, a hundred a request), and every
// fifteenth minute its NO book in the same request (the mirror check). It writes one JSON line a read to the file it is
// given, the levels within 12 cents of each side's best (RW's `summarize` keeps 10), and prints one line a read.
// Nothing is placed and no credential is read.
//   npx --yes deno@1.46.3 run --allow-net --allow-env --allow-write docs/agents/backtests/pmlive/scripts/mini_books.ts <minutes> <out.jsonl>
import { candidateOf, PM_LIVE_INSTANCE, PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_TIMEOUT_MS, rewardListing, inUniverse } from "../../../../../supabase/functions/agents/pm_live.ts";
import { bookReplies } from "../../../../../supabase/functions/agents/pm_mid.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";

const MINUTES = Number(Deno.args[0] ?? 120);
const OUT = Deno.args[1];
if (!OUT) throw new Error("usage: mini_books.ts <minutes> <out.jsonl>");
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: PM_LIVE_TIMEOUT_MS, sendsEnabled: false });
const file = await Deno.open(OUT, { write: true, create: true, truncate: true });
const enc = new TextEncoder();
const write = async (x: unknown) => { await file.write(enc.encode(JSON.stringify(x) + "\n")); };

const t0 = Date.now();
const l = await rewardListing(venue, { clock: () => Date.now(), until: t0 + PM_LIVE_SELECT_UNTIL_MS });
if (!l.ok) throw new Error(`listing: ${l.error}`);
const band = PM_LIVE_INSTANCE.band;
const universe = [...l.rows].filter(([, r]) => inUniverse(r, band)).map(([c]) => c).sort();
const gamma = new Map<string, Record<string, unknown>>();
for (let i = 0; i < universe.length; i += 50) {
  const g = await venue.gammaByConditions(universe.slice(i, i + 50), false);
  if (!g.ok) throw new Error(`gamma: ${g.status} ${g.error}`);
  for (const m of g.data?.markets ?? []) gamma.set(String(m.conditionId ?? "").toLowerCase(), m);
}
const meta: Record<string, unknown>[] = [];
for (const cond of universe) {
  const m = gamma.get(cond);
  const c = m ? candidateOf(m, l.rows, t0, band) : null;
  if (!c) continue;
  meta.push({
    cond, yes: c.yes, no: c.no, negRisk: c.negRisk, q: c.question, rate: c.rate, v: c.v, minSize: c.minSize, endDate: c.endDate, gameStart: c.gameStart,
    volume24hr: Number(m!.volume24hr ?? NaN), liquidity: Number(m!.liquidityNum ?? m!.liquidity ?? NaN), category: m!.category ?? null,
    competitive: Number(m!.competitive ?? NaN), spread: Number(m!.spread ?? NaN),
  });
}
await write({ kind: "meta", at: new Date(t0).toISOString(), listingRows: l.rows.size, universe: universe.length, eligible: meta.length, markets: meta });
console.log(JSON.stringify({ at: new Date(t0).toISOString(), listing: l.rows.size, universe: universe.length, eligible: meta.length }));

const trim = (xs: Array<{ price: string; size: string }> | undefined, side: "bid" | "ask") => {
  const lv = (xs ?? []).map((x) => [Number(x.price), Number(x.size)]).filter(([p, s]) => p > 0 && p < 1 && s > 0);
  lv.sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0]));
  const best = lv[0]?.[0];
  return best === undefined ? [] : lv.filter(([p]) => Math.abs(p - best) <= 0.12 + 1e-9);
};
for (let k = 0; k < MINUTES; k++) {
  // Each read 5 s into a minute, as the path's turn reads its books near the start of its minute.
  const next = Math.ceil((Date.now() - 5e3) / 60e3) * 60e3 + 5e3;
  if (k) await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
  const mirror = k % 15 === 0;
  const tokens = meta.flatMap((m) => (mirror ? [m.yes as string, m.no as string] : [m.yes as string]));
  const at = Date.now();
  let books: Awaited<ReturnType<typeof bookReplies>>;
  try { books = await bookReplies(tokens, { timeoutMs: 20_000 }); }
  catch (e) { console.log(JSON.stringify({ k, error: String(e).slice(0, 200) })); await write({ kind: "error", k, at: new Date(at).toISOString(), error: String(e).slice(0, 200) }); continue; }
  const out: Record<string, unknown> = {};
  for (const t of tokens) {
    const b = books.get(t);
    if (!b) continue;
    out[t] = { b: trim(b.bids, "bid"), a: trim(b.asks, "ask"), tick: b.tick_size ?? null, min: b.min_order_size ?? null, nr: b.neg_risk ?? null, ts: b.timestamp ?? null };
  }
  await write({ kind: "books", k, at: new Date(at).toISOString(), ms: Date.now() - at, mirror, books: out });
  console.log(JSON.stringify({ k, at: new Date(at).toISOString(), ms: Date.now() - at, books: Object.keys(out).length, of: tokens.length }));
}
file.close();
