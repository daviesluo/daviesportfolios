// LPRESEL6: the full-universe record from the pm-rec archive, the copy of LPSELF's builder (backtests/lpself/scripts/build.ts)
// with its window as arguments, the programmes seeded from the window's first day's dump, and each day's coverage kept.
// Run from this folder:
// deno run --v8-flags=--max-old-space-size=12000 --allow-read --allow-write --no-check scripts/build.ts data/pmrec data/aux.json data/pr_record.json 2026-10-09T00:00:00Z 2026-10-23T00:00:00Z
// Build a full-universe record from the pm-rec archive objects (books, universe, prints, the daily markets dump):
// every two hours from the window's start (2026-10-05 00:00 UTC by default), every candidate live-prep's rules admit (rate >= $10, N <= 20, accepting,
// not closed, no weather market, not ending that UTC day, no game within 48 h, a first-round formula of $2.50 a day)
// scored by RW's firstScore on that minute's book; the best KEEP of each slot are kept, and every book minute of a kept
// market from then on is written as RW's row (summarize under the market's programme of that minute), with its prints.
// deno run --allow-read --allow-write --no-check build.ts <pmrec_data dir> <aux.json> <out.json>
import { gunzipSync } from "node:zlib";
import { readFrames } from "../../../../../supabase/functions/agents/pm_book_rec.ts";
import { firstScore, sizeN, summarize } from "../../../../../supabase/functions/agents/pmrw.ts";

const [dir, auxFile, outFile, startArg, endArg] = Deno.args;
const M = 60e3, H = 3600e3, DAY = 86400e3;
const START = startArg ? Date.parse(startArg) : Date.UTC(2026, 9, 5), END = endArg ? Date.parse(endArg) : Infinity, SLOT_H = 2, KEEP = 60, FLOOR = 2.5;
// deno-lint-ignore no-explicit-any
type Any = any;
const index: Array<{ kind: string; hour: string }> = JSON.parse(Deno.readTextFileSync(`${dir}/index.json`));
const fileOf = (kind: string, hour: string) => `${dir}/${kind}_${hour.slice(0, 13).replace(":", "").replace(" ", "T")}.gz`;
const read = async (f: string) => readFrames(new TextDecoder().decode(gunzipSync(await Deno.readFile(f))));

// The daily dumps: id -> market, by day.
const dumps = new Map<string, Map<number, Any>>();
for (const o of index.filter((x) => x.kind === "markets")) {
  const fr = await read(fileOf("markets", o.hour));
  const day = String(fr[0].header.day);
  dumps.set(day, new Map(fr[0].rows.map((r: Any) => [Number(r.id), r])));
}
const dumpDays = [...dumps.keys()].sort();
const dumpFor = (t: number) => { const d = new Date(t).toISOString().slice(0, 10); let best = dumpDays[0]; for (const x of dumpDays) if (x <= d) best = x; return dumps.get(best)!; };
const closedEver = new Set<number>();
for (const m of dumps.values()) for (const [id, r] of m) if (r.closed === true) closedEver.add(id);

// Programmes, kept fresh from the universe lines (each market every 15 minutes); the first dump seeds them.
const prog = new Map<number, { rate: number; v: number; minSize: number }>();
for (const [id, r] of dumpFor(START)) prog.set(id, { rate: Number(r.rate), v: Number(r.max_spread), minSize: Number(r.min_size) });

const hours = index.filter((x) => x.kind === "books").map((x) => x.hour).filter((h) => Date.parse(h) >= START - 3600e3 && Date.parse(h) < END).sort();
const coverage: Record<string, number> = {};
const keep = new Map<number, number>();   // id -> index in conds
const conds: string[] = [], metaOf: Any[] = [];
const slots: Record<string, Any[]> = {};
const rows: number[][] = [];
const prints: Any[] = [];
const lastMid = new Map<number, { t: number; m: number }>();
let nextSlot = START, frames = 0, lastMinute = 0;

for (const hour of hours) {
  const [books, uni, pr] = await Promise.all([read(fileOf("books", hour)), read(fileOf("universe", hour)), read(fileOf("prints", hour))]);
  const uniBy = new Map(uni.map((f) => [Date.parse(String(f.header.minute)), f]));
  const prBy = new Map(pr.map((f) => [Date.parse(String(f.header.minute)), f]));
  for (const f of books) {
    const t = Date.parse(String(f.header.minute));
    const u = uniBy.get(t);
    if (u) for (const r of u.rows as Any[]) prog.set(Number(r.id), { rate: Number(r.rate), v: Number(r.v), minSize: Number(r.min_size) });
    if (t < START || t >= END) continue;
    frames++; lastMinute = t;
    const cday = new Date(t).toISOString().slice(0, 10);
    coverage[cday] = (coverage[cday] ?? 0) + 1;
    const dump = dumpFor(t);
    // A slot: score every candidate on this minute's book.
    if (t >= nextSlot) {
      const T = nextSlot, dayStart = Math.floor(T / DAY) * DAY;
      const scored: Any[] = [];
      for (const r of f.rows as Any[]) {
        const id = Number(r.id), m = dump.get(id), p = prog.get(id);
        if (!m || !p || !(p.rate >= 10) || !(p.v > 0) || sizeN(p.minSize) > 20) continue;
        if (m.accepting === false || m.closed === true || m.fee_type === "weather_fees" || !m.yes || !m.no) continue;
        if (m.end_date && Date.parse(m.end_date) < dayStart + DAY) continue;
        if (m.game_start && Date.parse(m.game_start) < T + 48 * H) continue;
        const bids = (r.bid_px ?? []).map((x: number, i: number) => [x, r.bid_sz[i]]), asks = (r.ask_px ?? []).map((x: number, i: number) => [x, r.ask_sz[i]]);
        const row = summarize(bids, asks, p.v, p.minSize);
        const fs = firstScore(row, Number(r.tick) || 0.01, p.v, p.minSize, p.rate);
        if (!fs) continue;
        const perDay = fs.perDollar * 1440;
        if (perDay * fs.cap < FLOOR - 1e-9) continue;
        scored.push({ id, cond: m.cond, rate: p.rate, v: p.v, min_size: p.minSize, tick: Number(r.tick) || 0.01, end_date: m.end_date ?? null, cat: m.fee_type ?? null, q: m.question ?? "", per_dollar_day: perDay, capital: fs.cap });
      }
      scored.sort((a, b) => (b.per_dollar_day - a.per_dollar_day) || (a.cond < b.cond ? -1 : 1));
      const top = scored.slice(0, KEEP).map((x, i) => ({ ...x, rank: i + 1, day: new Date(dayStart).toISOString().slice(0, 10) }));
      slots[new Date(T).toISOString()] = top;
      for (const x of top) if (!keep.has(x.id)) { keep.set(x.id, conds.length); conds.push(x.cond); metaOf.push(x); }
      console.error(`${new Date(T).toISOString()} candidates ${scored.length}, kept ${keep.size}`);
      nextSlot += SLOT_H * H;
    }
    const mi = Math.floor(t / M);
    for (const r of f.rows as Any[]) {
      const ci = keep.get(Number(r.id));
      if (ci === undefined) continue;
      const p = prog.get(Number(r.id))!;
      const bids = (r.bid_px ?? []).map((x: number, i: number) => [x, r.bid_sz[i]]), asks = (r.ask_px ?? []).map((x: number, i: number) => [x, r.ask_sz[i]]);
      const row = summarize(bids, asks, p.v, p.minSize);
      if (!row) continue;
      rows.push([mi, ci, Number(r.tick) || 0.01, ...row.map((x) => (x === null ? NaN : x))]);
      if (row[2] !== null && row[3] !== null) lastMid.set(Number(r.id), { t, m: (row[2] + row[3]) / 2 });
    }
    const pf = prBy.get(t);
    if (pf) for (const p of pf.rows as Any[]) { const ci = keep.get(Number(p.id)); if (ci !== undefined) prints.push({ cond: conds[ci], id: `${p.id}|${p.ts}|${p.side}|${p.oi}|${p.price}|${p.size}|${prints.length}`, ts: new Date(Number(p.ts) * 1000).toISOString(), side: p.side, oi: Number(p.oi), price: Number(p.price), size: Number(p.size) }); }
  }
  console.error(`hour ${hour}: rows ${rows.length}, prints ${prints.length}`);
}

// Settlements: a payout the paper records hold; else a market the dumps show closed, at its last mid when it is past 0.97 or under 0.03.
const aux = JSON.parse(Deno.readTextFileSync(auxFile));
const known = new Map((aux.settlements as Any[]).map((s) => [s.cond, s]));
const settlements: Any[] = [];
for (const [id, ci] of keep) {
  const c = conds[ci], k = known.get(c);
  if (k) { settlements.push({ cond: c, payout: Number(k.payout), settled_at: k.settled_at, source: "paper" }); continue; }
  const lm = lastMid.get(id);
  if (closedEver.has(id) && lm && (lm.m >= 0.97 || lm.m <= 0.03)) settlements.push({ cond: c, payout: lm.m >= 0.97 ? 1 : 0, settled_at: new Date(lm.t + 5 * M).toISOString(), source: "closed, last mid" });
}
const out = { start: START, end: END, last: lastMinute, frames, coverage, conds, meta: metaOf, slots, rows, prints, settlements };
Deno.writeTextFileSync(outFile, JSON.stringify(out));
console.error(`done: ${frames} minutes to ${new Date(lastMinute).toISOString()}, ${conds.length} markets, ${rows.length} rows, ${prints.length} prints, ${settlements.length} settlements`);
