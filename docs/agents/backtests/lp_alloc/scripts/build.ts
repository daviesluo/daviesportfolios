// LP-ALLOC (2026-10-10): the full-universe record from the pm-rec archive, LPRESEL6's builder (backtests/lpresel6/scripts/build.ts,
// itself LPSELF's with its window as arguments) with three additions and nothing else changed:
//   1. Markets whose N = max(minimum, 5) is over 20 and at most NMAX (default 200) are scored and kept too, the best KEEPX (40)
//      of each slot BESIDE the best KEEP (60) of N <= 20 that the old builder kept; so a rule that takes N <= 20 only sees the
//      old record's markets and the old record's rows (the run checks L1 against LPSELF's committed result).
//   2. Each kept market's reward programme through time (`progs`): every universe frame of its phase (each market every 15
//      minutes, the listing pm-rec reads every 15 minutes) gives [minute, rate, v, minSize], or [minute, null] where the
//      frame of its phase does not have it (the listing no longer shows it: its programme ended). Changes only.
//   3. From 2026-10-09 live-prep's own live orders rest in the books pm-rec records. Given the live orders
//      (sql/lp_orders_live.sql), each is taken out of the ladder (its price level, at most its size) for every frame read
//      while it rested, so every row is the book without our orders, as the live path's `othersLevels` reads it.
// Run from this folder:
// deno run --v8-flags=--max-old-space-size=12000 --allow-read --allow-write --no-check scripts/build.ts <pmrec dir> data/aux.json <out.json> 2026-10-05T00:00:00Z 2026-10-10T00:00:00Z data/lp_orders_live.json.gz 200
// Build a full-universe record from the pm-rec archive objects (books, universe, prints, the daily markets dump):
// every two hours from the window's start (2026-10-05 00:00 UTC by default), every candidate live-prep's rules admit (rate >= $10, N <= 20, accepting,
// not closed, no weather market, not ending that UTC day, no game within 48 h, a first-round formula of $2.50 a day)
// scored by RW's firstScore on that minute's book; the best KEEP of each slot are kept, and every book minute of a kept
// market from then on is written as RW's row (summarize under the market's programme of that minute), with its prints.
// deno run --allow-read --allow-write --no-check build.ts <pmrec_data dir> <aux.json> <out.json>
import { gunzipSync } from "node:zlib";
import { readFrames } from "../../../../../supabase/functions/agents/pm_book_rec.ts";
import { firstScore, sizeN, summarize } from "../../../../../supabase/functions/agents/pmrw.ts";

const [dir, auxFile, outFile, startArg, endArg, ordersFile, nmaxArg] = Deno.args;
const NMAX = nmaxArg ? Number(nmaxArg) : 200, KEEPX = 40;
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
// LP-ALLOC: each market's programme through time, changes only: [minute index, rate, v, minSize] or [minute index, null].
const tl = new Map<number, Array<Array<number | null>>>();
const tlPush = (id: number, mi: number, x: { rate: number; v: number; minSize: number } | null) => {
  const l = tl.get(id) ?? tl.set(id, []).get(id)!, last = l[l.length - 1];
  const e = x ? [mi, x.rate, x.v, x.minSize] : [mi, null];
  if (last && JSON.stringify(last.slice(1)) === JSON.stringify(e.slice(1))) return;
  l.push(e);
};
// LP-ALLOC: live-prep's live orders by condition, as YES-book levels: [placed s, ended s, 'bid' | 'ask', price, size].
const ordersBy = new Map<string, Array<[number, number, string, number, number]>>();
if (ordersFile) {
  const txt = ordersFile.endsWith(".gz") ? new TextDecoder().decode(gunzipSync(Deno.readFileSync(ordersFile))) : Deno.readTextFileSync(ordersFile);
  for (const line of String(JSON.parse(txt).orders).split(";")) {
    const [cond, outcome, side, price, size, , t0, t1] = line.split(",");
    const p = Number(price), yesBook = outcome === "yes" ? (side === "BUY" ? ["bid", p] : ["ask", p]) : (side === "BUY" ? ["ask", 1 - p] : ["bid", 1 - p]);
    (ordersBy.get(cond) ?? ordersBy.set(cond, []).get(cond)!).push([Number(t0), Number(t1), yesBook[0] as string, Math.round((yesBook[1] as number) * 1e4) / 1e4, Number(size)]);
  }
}
let oursRemoved = 0;
/** The ladder without our live orders resting when the frame was read (`atS`, epoch seconds). */
const withoutOurs = (cond: string, atS: number, bids: number[][], asks: number[][]) => {
  const os = ordersBy.get(cond);
  if (!os) return { bids, asks };
  const b = bids.map((x) => [x[0], x[1]]), a = asks.map((x) => [x[0], x[1]]);
  for (const [t0, t1, side, px, sz] of os) {
    if (!(t0 <= atS && atS < t1)) continue;
    const lv = (side === "bid" ? b : a).find((x) => Math.abs(x[0] - px) < 1e-6);
    if (lv) { const q = Math.min(lv[1], sz); lv[1] -= q; oursRemoved += q; }
  }
  return { bids: b.filter((x) => x[1] > 1e-9), asks: a.filter((x) => x[1] > 1e-9) };
};
// LPSELF_SEED=1 (the reproduction check only): LPSELF's seed and reading, the first day's dump and every archived hour before START.
const LPSELF_SEED = Deno.env.get("LPSELF_SEED") === "1";
for (const [id, r] of (LPSELF_SEED ? dumps.get(dumpDays[0])! : dumpFor(START))) prog.set(id, { rate: Number(r.rate), v: Number(r.max_spread), minSize: Number(r.min_size) });

const hours = index.filter((x) => x.kind === "books").map((x) => x.hour).filter((h) => (LPSELF_SEED || Date.parse(h) >= START - 3600e3) && Date.parse(h) < END).sort();
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
    if (u) {
      const seen = new Set<number>(), ph = Number(u.header.phase), phs = Number(u.header.phases);
      for (const r of u.rows as Any[]) { const p = { rate: Number(r.rate), v: Number(r.v), minSize: Number(r.min_size) }; prog.set(Number(r.id), p); seen.add(Number(r.id)); tlPush(Number(r.id), Math.floor(t / M), p); }
      // a market of this phase the listing no longer shows: its programme ended (pm-rec delists it)
      for (const id of tl.keys()) if (id % phs === ph && !seen.has(id)) tlPush(id, Math.floor(t / M), null);
    }
    if (t < START || t >= END) continue;
    frames++; lastMinute = t;
    const cday = new Date(t).toISOString().slice(0, 10);
    coverage[cday] = (coverage[cday] ?? 0) + 1;
    const dump = dumpFor(t);
    const atS = Date.parse(String(f.header.at ?? f.header.minute)) / 1000;
    // A slot: score every candidate on this minute's book.
    if (t >= nextSlot) {
      const T = nextSlot, dayStart = Math.floor(T / DAY) * DAY;
      const scored: Any[] = [];
      for (const r of f.rows as Any[]) {
        const id = Number(r.id), m = dump.get(id), p = prog.get(id);
        if (!m || !p || !(p.rate >= 10) || !(p.v > 0) || sizeN(p.minSize) > NMAX) continue;
        if (m.accepting === false || m.closed === true || m.fee_type === "weather_fees" || !m.yes || !m.no) continue;
        if (m.end_date && Date.parse(m.end_date) < dayStart + DAY) continue;
        if (m.game_start && Date.parse(m.game_start) < T + 48 * H) continue;
        const lad = withoutOurs(m.cond, atS, (r.bid_px ?? []).map((x: number, i: number) => [x, r.bid_sz[i]]), (r.ask_px ?? []).map((x: number, i: number) => [x, r.ask_sz[i]]));
        const row = summarize(lad.bids, lad.asks, p.v, p.minSize);
        const fs = firstScore(row, Number(r.tick) || 0.01, p.v, p.minSize, p.rate);
        if (!fs) continue;
        const perDay = fs.perDollar * 1440;
        if (perDay * fs.cap < FLOOR - 1e-9) continue;
        scored.push({ id, cond: m.cond, rate: p.rate, v: p.v, min_size: p.minSize, tick: Number(r.tick) || 0.01, end_date: m.end_date ?? null, cat: m.fee_type ?? null, q: m.question ?? "", per_dollar_day: perDay, capital: fs.cap });
      }
      scored.sort((a, b) => (b.per_dollar_day - a.per_dollar_day) || (a.cond < b.cond ? -1 : 1));
      // N <= 20 as the old builder kept them, then the best KEEPX of N over 20 (LP-ALLOC)
      const top = [...scored.filter((x) => sizeN(x.min_size) <= 20).slice(0, KEEP), ...scored.filter((x) => sizeN(x.min_size) > 20).slice(0, KEEPX)].map((x, i) => ({ ...x, rank: i + 1, day: new Date(dayStart).toISOString().slice(0, 10) }));
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
      const lad = withoutOurs(conds[ci], atS, (r.bid_px ?? []).map((x: number, i: number) => [x, r.bid_sz[i]]), (r.ask_px ?? []).map((x: number, i: number) => [x, r.ask_sz[i]]));
      const row = summarize(lad.bids, lad.asks, p.v, p.minSize);
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
const idOf = new Map<number, number>(); for (const [id, ci] of keep) idOf.set(ci, id);
const progs = conds.map((_, ci) => tl.get(idOf.get(ci)!) ?? []);
const out = { start: START, end: END, last: lastMinute, frames, coverage, conds, meta: metaOf, slots, rows, prints, settlements, progs, nmax: NMAX, oursRemoved };
Deno.writeTextFileSync(outFile, JSON.stringify(out));
console.error(`done: ${frames} minutes to ${new Date(lastMinute).toISOString()}, ${conds.length} markets, ${rows.length} rows, ${prints.length} prints, ${settlements.length} settlements`);
