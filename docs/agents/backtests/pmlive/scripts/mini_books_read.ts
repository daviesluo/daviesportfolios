// Reads what mini_books.ts recorded (2026-10-04): for every market of mini-pool's universe, the order path's dry-run
// replayed minute by minute through the path's own code on the books it read: at each minute the formula of the quotes
// RW's rule rested the minute before, against this minute's book (`minuteFormula`, today's, with our quotes in the book
// as the venue holds them, and the code before 2026-10-04 from `pm_live_frozen.ts`, the rest of the market alone), then
// RW's quote on this book (`rwQuotes`), nothing held, as the dry-run holds nothing. A minute whose book is one-sided or
// missing records nothing and cancels what rested, as the path does. A market's share is its minutes with a formula
// above zero over the minutes it recorded, from the minute after its first (its selection minute, where nothing rests).
//
// Then the selection, as the path makes it at a read (`selectMarkets`' ranking without its reads: RW's `firstScore` on
// the book, the $2.50 a day floor, RW's `choose` within $160, eight markets at most), with and without each candidate
// book-quality rule, each scored by its picks' shares over the next 60 minutes (`HORIZON`), a selection every five
// minutes of the record that has them; and each rule's separation over every
// market the ranking scored: the share of the markets it keeps against the share of the markets it passes over.
//   npx --yes deno@1.46.3 run --allow-read docs/agents/backtests/pmlive/scripts/mini_books_read.ts docs/agents/backtests/pmlive/results/mini_books.jsonl.gz
import { bookNow, minuteFormula, rwQuotes, type PmBookNow, type PmLevels, type PmMarketRow, type PmOwnOrder } from "../../../../../supabase/functions/agents/pm_live.ts";
import { minuteFormula as minuteFormulaOld } from "../../../../../supabase/functions/agents/pm_live_frozen.ts";
import { choose, firstScore, sizeN, summarize } from "../../../../../supabase/functions/agents/pmrw.ts";
import { bookQualityOf, PM_MINI_QUALITY } from "../../../../../supabase/functions/agents/pm_live.ts";

const FILE = Deno.args[0];
/** Each selection's picks are scored over this many minutes after it (60 unless given). */
const HORIZON = Number(Deno.args[1] ?? 60);
/**
 * Mini-pool's own record, when given: each market-day it quoted from 2026-10-01 to 10-04, its minutes and those with a
 * formula above zero with our quotes in the book (`results/mini_history_days.json`, read from `pm_live_minutes`).
 */
const HISTORY = Deno.args[2];
if (!FILE) throw new Error("usage: mini_books_read.ts <books.jsonl> [horizon] [history.json]");
type Meta = { cond: string; yes: string; no: string; negRisk: boolean; q: string; rate: number; v: number; minSize: number; volume24hr: number | null; liquidity: number | null; competitive: number | null };
type Raw = { b: number[][]; a: number[][]; tick: string | null; min: string | null; nr: boolean | null; ts: string | null };
// The record as mini_books.ts wrote it, or gzipped (results/mini_books.jsonl.gz, as committed).
const text = FILE.endsWith(".gz")
  ? await new Response((await Deno.open(FILE)).readable.pipeThrough(new DecompressionStream("gzip"))).text()
  : await Deno.readTextFile(FILE);
const lines = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const meta = lines.find((l) => l.kind === "meta") as { at: string; markets: Meta[]; universe: number; eligible: number };
const reads = lines.filter((l) => l.kind === "books") as Array<{ k: number; at: string; books: Record<string, Raw> }>;
reads.sort((x, y) => x.k - y.k);
const K = reads.length;
const asReply = (r: Raw) => ({
  bids: r.b.map(([p, s]) => ({ price: String(p), size: String(s) })), asks: r.a.map(([p, s]) => ({ price: String(p), size: String(s) })),
  tick_size: r.tick ?? undefined, min_order_size: r.min ?? undefined, neg_risk: r.nr ?? undefined, timestamp: r.ts ?? undefined,
});
const bookAt = (k: number, token: string): PmBookNow | null => { const r = reads[k]?.books[token]; return r ? bookNow(asReply(r)) : null; };
const MKT = (m: Meta, tick: number): PmMarketRow => ({
  day: "", kind: m.negRisk ? "neg_risk" : "standard", cond: m.cond, yes_token: m.yes, no_token: m.no, neg_risk: m.negRisk, tick, min_size: m.minSize,
  reward_rate: m.rate, rank: 0, question: m.q, max_spread: m.v,
});

// ── the mirror: every fifteenth read holds both tokens' books from one request ──────────────────────────────────────
let mirrorPairs = 0, mirrorSame = 0;
const mirrorDiff: string[] = [];
for (const r of reads) {
  for (const m of meta.markets) {
    const y = r.books[m.yes], n = r.books[m.no];
    if (!y || !n) continue;
    mirrorPairs++;
    const flip = (xs: number[][]) => xs.map(([p, s]) => [Math.round((1 - p) * 1e6) / 1e6, s]);
    const key = (xs: number[][]) => JSON.stringify(xs.map(([p, s]) => [Math.round(p * 1e6) / 1e6, s]).sort((a, b) => a[0] - b[0]));
    // NO's bids are 1 − YES's asks and NO's asks 1 − YES's bids, size for size (only the levels within 12 ¢ were kept,
    // so the comparison is over the levels both kept: the touch and what lies within 12 ¢ of it on each side).
    const same = key(flip(y.a)) === key(n.b) && key(flip(y.b)) === key(n.a);
    if (same) mirrorSame++; else if (mirrorDiff.length < 5) mirrorDiff.push(`${m.cond.slice(0, 10)} read ${r.k}`);
  }
}

// ── each market replayed ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * One minute of a market: whether the path recorded it, the formula of what rested the minute before against this book
 * (`old`: the rest of the market's midpoint, the code before 2026-10-04; `now`: the venue's, our quotes in the book), the
 * minute's category, and the paper layer's reward of the quotes RW places on this book, at placement (`placeOld`: RW's
 * line, stepRw's midpoint; `placeNew`: the path's `detail.after`, the venue's).
 */
type MinuteOut = { k: number; rec: boolean; old: number; now: number; cat: string; placeOld: number; placeNew: number };
function replay(m: Meta, from: number, to: number): MinuteOut[] {
  const out: MinuteOut[] = [];
  let resting: PmOwnOrder[] = [];
  for (let k = from; k <= to && k < K; k++) {
    const b = bookAt(k, m.yes);
    if (!b || b.negRisk !== m.negRisk) { resting = []; out.push({ k, rec: false, old: 0, now: 0, cat: "no book", placeOld: 0, placeNew: 0 }); continue; }
    const intents = rwQuotes({ market: MKT(m, Number(b.tick)), book: b, held: { yes: 0, no: 0 }, own: [] });
    const placed = intents.filter((x) => x.size >= b.minSize - 1e-9);
    const q = { rate: m.rate, v: m.v, minSize: m.minSize, levels: b.levels, inBook: [] as PmOwnOrder[], quotes: placed };
    const placeOld = placed.length === 2 ? minuteFormulaOld(q).formula : 0, placeNew = placed.length === 2 ? minuteFormula(q).formula : 0;
    if (k > from) {
      const p = { rate: m.rate, v: m.v, minSize: m.minSize, levels: b.levels, inBook: [], quotes: resting };
      const fo = minuteFormulaOld(p).formula, fn = minuteFormula(p).formula;
      const row = summarize(b.levels.bids, b.levels.asks, m.v, m.minSize);
      const cat = fn > 0 ? (fo > 0 ? "scored" : "scored with ours in the book") : resting.length < 2 ? "fewer than two quotes" : !row || row[2] === null ? "no size-cutoff touch" : "quotes wider than the spread";
      out.push({ k, rec: true, old: fo, now: fn, cat, placeOld, placeNew });
    }
    resting = placed;
  }
  return out;
}
const share = (xs: MinuteOut[], f: (x: MinuteOut) => number) => { const r = xs.filter((x) => x.rec); return r.length ? r.filter((x) => f(x) > 0).length / r.length : null; };
const money = (xs: MinuteOut[], f: (x: MinuteOut) => number) => xs.reduce((s, x) => s + f(x), 0);

// ── features at a read, and RW's first round ──────────────────────────────────────────────────────────────────────
type Feat = {
  cond: string; perDollar: number; cap: number; formulaDay: number; mid: number; touchOverV: number; cutOverV: number; q1: number; q2: number;
  quality: string | null; volume24hr: number | null; liquidity: number | null; competitive: number | null;
  /** The book at the read, for the parametrised rules. */
  book: { v: number; minSize: number; levels: PmLevels; tick: number };
};
function featuresAt(m: Meta, k: number): Feat | null {
  const b = bookAt(k, m.yes);
  if (!b || b.negRisk !== m.negRisk) return null;
  const tick = Number(b.tick);
  const row = summarize(b.levels.bids, b.levels.asks, m.v, m.minSize);
  const fs = firstScore(row, tick, m.v, m.minSize, m.rate);
  if (!fs || !row || row[2] === null || row[3] === null) return null;
  const formulaDay = fs.perDollar * 1440 * fs.cap;
  if (formulaDay < 2.5 - 1e-9) return null;
  return {
    cond: m.cond, perDollar: fs.perDollar, cap: fs.cap, formulaDay, mid: (row[2] + row[3]) / 2, touchOverV: (row[1] - row[0]) * 100 / m.v,
    cutOverV: (row[3] - row[2]) * 100 / m.v, q1: row[4], q2: row[5], quality: bookQualityOf({ v: m.v, minSize: m.minSize, levels: b.levels, tick }, PM_MINI_QUALITY),
    volume24hr: m.volume24hr, liquidity: m.liquidity, competitive: m.competitive, book: { v: m.v, minSize: m.minSize, levels: b.levels, tick },
  };
}

/** `fill`: the markets the rule keeps first, then, while slots and budget are left, the ranking's next of the rest. */
type Rule = { name: string; keep: (f: Feat) => boolean; fill?: boolean };
/** The selection under a rule: RW's `choose` within $160, eight markets at most, as `selectMarkets` makes it. */
function selectUnder(rule: Rule, feats: Feat[]): Feat[] {
  const kept = feats.filter(rule.keep);
  const chosen = choose(kept, 160).slice(0, 8);
  if (!rule.fill || chosen.length >= 8) return chosen;
  const left = 160 - chosen.reduce((s, x) => s + x.cap, 0);
  return [...chosen, ...choose(feats.filter((f) => !rule.keep(f)), left).slice(0, 8 - chosen.length)];
}
/** A candidate of the form the path ships (`PmBookQualityRule`), run through the path's own `bookQualityOf`. */
const shaped = (levels: number, spreadOverV?: number, mid?: [number, number]): Rule => ({
  name: `levels ${levels}${spreadOverV === undefined ? "" : `, spread without the best${levels > 1 ? "" : " (the size-cutoff spread)"} <= ${spreadOverV} v`}${mid ? `, mid in [${mid[0].toFixed(2)}, ${mid[1].toFixed(2)}]` : ""}`,
  keep: (f) => bookQualityOf(f.book, { name: "", levels, spreadOverV, mid }) === null,
});
const RULES: Rule[] = [
  { name: "none (the path's selection today)", keep: () => true },
  // The rule as `selectMarkets` applies it: the books that pass first, the rest only for the slots and budget left.
  { name: `the rule shipped (${PM_MINI_QUALITY.name}; the rest only for what is left)`, keep: (f) => f.quality === null, fill: true },
  // What the minute record of 2026-10-01 → 10-04 also holds at a selection (it keeps no book's levels).
  { name: "mid in [0.05, 0.95]", keep: (f) => f.mid >= 0.05 && f.mid <= 0.95 },
  { name: "mid in [0.10, 0.90]", keep: (f) => f.mid >= 0.10 && f.mid <= 0.90 },
  { name: "mid in [0.15, 0.85]", keep: (f) => f.mid >= 0.15 && f.mid <= 0.85 },
  { name: "size-cutoff spread <= 1.0 v", keep: (f) => f.cutOverV <= 1.0 + 1e-9 },
  { name: "size-cutoff spread <= 1.5 v", keep: (f) => f.cutOverV <= 1.5 + 1e-9 },
  { name: "touch spread <= 1.5 v", keep: (f) => f.touchOverV <= 1.5 + 1e-9 },
  { name: "others quote within v on both sides (q1, q2 > 0)", keep: (f) => f.q1 > 0 && f.q2 > 0 },
  // Gamma's own figures for the market.
  { name: "volume24hr >= 100", keep: (f) => (f.volume24hr ?? 0) >= 100 },
  { name: "liquidity >= 500", keep: (f) => (f.liquidity ?? 0) >= 500 },
  // The book's depth: levels holding the minimum within 10 ¢ of the touch, and the spread with either best taken away.
  shaped(1, 1.5), shaped(1, 2),
  shaped(2), shaped(2, 1.5), shaped(2, 2), shaped(2, 2.5), shaped(2, 3), shaped(2, 4),
  shaped(3), shaped(3, 2), shaped(3, 3),
  shaped(2, undefined, [0.05, 0.95]), shaped(2, 3, [0.05, 0.95]), shaped(2, undefined, [0.10, 0.90]), shaped(2, 3, [0.10, 0.90]),
  shaped(1, 2, [0.10, 0.90]),
  // The same ranking (those that pass first, the rest for what is left) under other rules.
  { ...shaped(2, undefined, [0.05, 0.95]), name: "levels 2, mid in [0.05, 0.95]; the rest only for what is left", fill: true },
  { ...shaped(2, 3), name: "levels 2, spread without the best <= 3 v; the rest only for what is left", fill: true },
  { ...shaped(3), name: "levels 3; the rest only for what is left", fill: true },
  { name: "mid in [0.05, 0.95]; the rest only for what is left", keep: (f) => f.mid >= 0.05 && f.mid <= 0.95, fill: true },
];

const out: Record<string, unknown>[] = [];
out.push({ at: meta.at, universe: meta.universe, eligible: meta.eligible, reads: K, firstRead: reads[0]?.at, lastRead: reads[K - 1]?.at, horizon: HORIZON });
out.push({ mirror: { pairs: mirrorPairs, same: mirrorSame, notSame: mirrorPairs - mirrorSame, examples: mirrorDiff } });

// Every market over the whole record, from its first read.
const whole = new Map<string, MinuteOut[]>();
for (const m of meta.markets) whole.set(m.cond, replay(m, 0, K - 1));
const all = [...whole.values()].flat();
const cats: Record<string, number> = {};
for (const x of all.filter((x) => x.rec)) cats[x.cat] = (cats[x.cat] ?? 0) + 1;
out.push({ everyMarketWhole: { minutes: all.filter((x) => x.rec).length, scoredOld: all.filter((x) => x.rec && x.old > 0).length, scoredNew: all.filter((x) => x.rec && x.now > 0).length, cats } });

// Selections at several reads, each scored over the next 60 minutes.
const STARTS = Array.from({ length: 30 }, (_, i) => i * 5).filter((k) => k + HORIZON < K);
for (const rule of RULES) {
  let picks = 0, mins = 0, scoredOld = 0, scoredNew = 0, usdNew = 0, usdOld = 0, passedOver = 0, scoredMarkets = 0, droppedPicks = 0, fday = 0, paperOld = 0, paperNew = 0;
  for (const k0 of STARTS) {
    const feats = meta.markets.map((m) => featuresAt(m, k0)).filter((f): f is Feat => !!f);
    scoredMarkets += feats.length;
    const base = new Set(choose(feats, 160).slice(0, 8).map((x) => x.cond));
    const kept = feats.filter(rule.keep);
    passedOver += feats.length - kept.length;
    const chosen = selectUnder(rule, feats);
    droppedPicks += [...base].filter((c) => !chosen.some((x) => x.cond === c)).length;
    for (const x of chosen) {
      const m = meta.markets.find((y) => y.cond === x.cond)!;
      const r = replay(m, k0, k0 + HORIZON).filter((y) => y.rec);
      picks++; mins += r.length; fday += x.formulaDay;
      scoredOld += r.filter((y) => y.old > 0).length; scoredNew += r.filter((y) => y.now > 0).length;
      usdOld += money(r, (y) => y.old); usdNew += money(r, (y) => y.now);
      paperOld += money(r, (y) => y.placeOld); paperNew += money(r, (y) => y.placeNew);
    }
  }
  out.push({
    rule: rule.name, selections: STARTS.length, picks, scoredMarkets, passedOver, droppedOfTheUnfilteredPicks: droppedPicks,
    pickMinutes: mins, sharedOld: mins ? Math.round((1000 * scoredOld) / mins) / 10 : null, sharedNew: mins ? Math.round((1000 * scoredNew) / mins) / 10 : null,
    formulaUsdOld60: Math.round(usdOld * 1e4) / 1e4, formulaUsdNew60: Math.round(usdNew * 1e4) / 1e4, firstRoundFormulaDay: Math.round(fday * 100) / 100,
    paperRewardRwLine60: Math.round(paperOld * 1e4) / 1e4, paperRewardVenue60: Math.round(paperNew * 1e4) / 1e4,
  });
}

// How many markets each rule leaves the selection at every read of the record (not only the five-minute starts): the
// candidates the ranking scored, those the rule keeps, and the markets `choose` takes of them; the fewest, the median and
// the most over the reads. A rule that leaves fewer than eight quotes fewer markets, and none fails (b1).
const perRead = new Map<string, { kept: number[]; chosen: number[] }>(RULES.map((r) => [r.name, { kept: [], chosen: [] }]));
const candidates: number[] = [];
for (let k = 0; k < K; k++) {
  const feats = meta.markets.map((m) => featuresAt(m, k)).filter((f): f is Feat => !!f);
  candidates.push(feats.length);
  for (const rule of RULES) {
    const kept = feats.filter(rule.keep);
    perRead.get(rule.name)!.kept.push(kept.length);
    perRead.get(rule.name)!.chosen.push(selectUnder(rule, feats).length);
  }
}
const spread3 = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return [s[0], s[Math.floor(s.length / 2)], s[s.length - 1]]; };
out.push({ candidatesPerRead: spread3(candidates) });
for (const rule of RULES) {
  const x = perRead.get(rule.name)!;
  out.push({ perRead: rule.name, keptMinMedianMax: spread3(x.kept), chosenMinMedianMax: spread3(x.chosen), readsWithFewerThan8Kept: x.kept.filter((n) => n < 8).length, readsWithFewerThan8Chosen: x.chosen.filter((n) => n < 8).length });
}

// Each rule's separation over every market the ranking scored at the first read: the share of those it keeps and of
// those it passes over, over the whole record, and over its second half alone (an hour and more after that read: a
// selection is made once a day, so what a rule reads must last).
const f0 = meta.markets.map((m) => featuresAt(m, 0)).filter((f): f is Feat => !!f);
const half = Math.floor(K / 2);
for (const rule of RULES.slice(1)) {
  const kept = f0.filter(rule.keep), over = f0.filter((f) => !rule.keep(f));
  const sh = (fs: Feat[], from = 0) => {
    const xs = fs.map((f) => share(whole.get(f.cond)!.filter((y) => y.k >= from), (y) => y.now)).filter((x): x is number => x !== null);
    const xo = fs.map((f) => share(whole.get(f.cond)!.filter((y) => y.k >= from), (y) => y.old)).filter((x): x is number => x !== null);
    const mean = (a: number[]) => (a.length ? Math.round((1000 * a.reduce((s, x) => s + x, 0)) / a.length) / 10 : null);
    const med = (a: number[]) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return Math.round(1000 * s[Math.floor(s.length / 2)]) / 10; };
    const ge75 = xs.filter((x) => x >= 0.75).length;
    return { n: fs.length, meanNew: mean(xs), medianNew: med(xs), meanOld: mean(xo), atLeast75New: ge75 };
  };
  out.push({ separation: rule.name, scoredAtFirstRead: f0.length, kept: sh(kept), passedOver: sh(over), keptLate: sh(kept, half), passedOverLate: sh(over, half) });
}
// Dropping a market after a stretch that scores nothing (the alternative to a selection rule): over every market the
// ranking scored at the first read, after the first run of `RUN` recorded minutes with no formula, how much of the rest
// of its record scored. A drop is worth it only if a market that went dark for that long stays dark.
for (const RUN of [15, 30, 60]) {
  let markets = 0, dropped = 0, afterMinutes = 0, afterScored = 0;
  for (const f of f0) {
    const r = whole.get(f.cond)!.filter((y) => y.rec);
    markets++;
    let run = 0, at = -1;
    for (let i = 0; i < r.length; i++) { run = r[i].now > 0 ? 0 : run + 1; if (run >= RUN) { at = i; break; } }
    if (at < 0) continue;
    dropped++;
    const rest = r.slice(at + 1);
    afterMinutes += rest.length; afterScored += rest.filter((y) => y.now > 0).length;
  }
  out.push({ dropAfterDarkRun: RUN, markets, wouldDrop: dropped, minutesAfter: afterMinutes, scoredAfter: afterScored, shareAfter: afterMinutes ? Math.round((1000 * afterScored) / afterMinutes) / 10 : null });
}
// The bridge to the record: every market mini-pool quoted from 2026-10-01 to 10-04 that is still in its universe, its
// book under the rule at every read of this sample, beside the share of its minutes that scored on the days it was
// quoted. A rule read off a market's book today says something of its record only as far as a book keeps its shape.
if (HISTORY) {
  type Day = { day: string; cond: string; n: number; s_old: number; s_new: number };
  const days = JSON.parse(await Deno.readTextFile(HISTORY)) as Day[];
  const byCond = new Map<string, Day[]>();
  for (const d of days) byCond.set(d.cond, [...(byCond.get(d.cond) ?? []), d]);
  const rows: Array<{ cond: string; days: number; historyShare: number; reads: number; passReads: number; firstRead: string | null; sampleShare: number | null }> = [];
  for (const [c, ds] of byCond) {
    const m = meta.markets.find((x) => x.cond === c);
    const historyShare = Math.round((1000 * ds.reduce((s, d) => s + d.s_new, 0)) / ds.reduce((s, d) => s + d.n, 0)) / 10;
    if (!m) { rows.push({ cond: c.slice(0, 10), days: ds.length, historyShare, reads: 0, passReads: 0, firstRead: "not in the universe", sampleShare: null }); continue; }
    let reads = 0, passReads = 0, first: string | null | undefined;
    for (let k = 0; k < K; k++) {
      const b = bookAt(k, m.yes);
      if (!b || b.negRisk !== m.negRisk) continue;
      reads++;
      const why = bookQualityOf({ v: m.v, minSize: m.minSize, levels: b.levels, tick: Number(b.tick) }, PM_MINI_QUALITY);
      if (why === null) passReads++;
      if (first === undefined) first = why ?? "passes";
    }
    const sh = share(whole.get(c)!, (y) => y.now);
    rows.push({ cond: c.slice(0, 10), days: ds.length, historyShare, reads, passReads, firstRead: first ?? null, sampleShare: sh === null ? null : Math.round(1000 * sh) / 10 });
  }
  rows.sort((a, b) => a.historyShare - b.historyShare);
  for (const r of rows) out.push({ bridge: r });
  const inU = rows.filter((r) => r.reads > 0);
  const mostly = (r: (typeof rows)[number]) => r.passReads * 2 > r.reads;
  const mean = (xs: number[]) => (xs.length ? Math.round((10 * xs.reduce((s, x) => s + x, 0)) / xs.length) / 10 : null);
  out.push({
    bridgeSummary: PM_MINI_QUALITY.name, marketsQuoted: rows.length, stillInTheUniverse: inU.length,
    passMostReads: { n: inU.filter(mostly).length, historyShareMean: mean(inU.filter(mostly).map((r) => r.historyShare)) },
    failMostReads: { n: inU.filter((r) => !mostly(r)).length, historyShareMean: mean(inU.filter((r) => !mostly(r)).map((r) => r.historyShare)) },
  });
}
for (const x of out) console.log(JSON.stringify(x));
