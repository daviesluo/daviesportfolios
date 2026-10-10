// LP-REFILL (2026-10-10): a copy of LP-ALLOC's alloc_sim.ts (backtests/lp_alloc/scripts/alloc_sim.ts, below) with the refill
// made a family (`refill.source`: the 00:00 reserve or the freshest slot's ranking; a cap a day; a test a candidate must
// pass) and seven loss guards, each acting on BUYS only (a sell of what is held always rests): `midMove` (the adjusted mid
// moved k cents against the side over the last N minutes), `oneWay` (k fills running on one side with none on the other),
// `bandCap` (a smaller side cap while the mid is outside a band), `noBuyEndH` (no buy within H hours of the market's end),
// `marketLoss` (no buy once the market's fills are marked $Y down), and LP-ALLOC's `driftStop`; per-type exclusions are
// `skipMarket`. Counters: guard blocks a day. With every new option unset it is alloc_sim.ts's decisions line for line.
//
// LP-ALLOC (2026-10-10): a copy of LPCAP's cap_sim.ts (below) with two options and three counters, for the question
// how live-prep should use more money. Options: `liveProg` (each minute a chosen market is quoted under its reward
// programme AS THE RECORD READ IT THEN, the record's `progs`: its rate and maximum spread in the formula, N from its
// minimum; where the programme ended, its rate fell under `minRate` or its N passed `nMax`, the market takes no entry
// that minute and is worked as a carried market, close-only sells that earn nothing: the reward check of the
// lp-reward-refresh change, at the record's 15-minute reading of the listing); `nearCertain` (Addendum 7's limit,
// EXPENSIVE-SIDE's `usd`/`mark` lines of rwc_opt/scripts/exp_sim.ts copied as they are, with the dollars `share` x the
// minute's total cap). Counters, which change no decision: `heldClose` (holdings at cost at the day's last minute),
// `progOff` (chosen market-minutes the programme check took out), `progChanged` (chosen markets whose programme changed
// or ended inside the day). With both options unset every line is cap_sim.ts's, so L1 reproduces LPSELF's lp_pr.json
// (alloc_run.ts checks it before any arm runs).
//
// LPCAP (2026-10-09): a copy of LPSELF's sim2.ts (itself RWC-OPT's frozen sim.ts plus three options, as TB1-SELLS'
// tb1s_sim.ts copied it) with two counters and one option, for the capacity study of live-prep's capital. Counters, which
// change no decision: `posts` (an estimate of the POSTs a day: a side that starts resting, moves, changes from a buy to
// a sell, or has rested `postsRefreshMin` minutes, is one order sent, as the path refreshes an order of 600 s with 90 s
// left) and `pool` (the reward pools' rates over the minutes our quotes were in, so `reward / pool` is our share of the
// pools we sat in). The option, `equity`: the total cap follows the account's equity at cost, the starting cap plus
// what the fills realised plus R x the rewards of the days before today (a daily payout reinvested at once). Every
// other line is sim2.ts's, so L1 reproduces LPSELF's lp_rw.json / lp_pr.json byte for byte (cap_run.ts checks it).
// sim.ts, sim2.ts, tb1s_sim.ts and exp_sim.ts stay as frozen; nothing here is a rule of the live path.
// RWC-OPT's simulator (reviews/2026-10-09-rwc-optimised-arms-prereg.md): live-prep's Phase A simulator
// (backtests/pmlp/scripts/sim.ts) with one option added, TB1's tight-touch rule (`tight`: in a minute whose stored raw
// touch is at most `maxTicks` ticks wide, `skip` rests nothing and marks what is held at the mid, `back` rests each quote
// a tick further out by pmrw_x.ts's own `tightBack` and `restRow`). Every other line is that file's. A full
// re-simulation of a reward-quoting strategy on a stored paper record with RW's own rule functions, plus what a live
// account adds: caps on holdings at cost and resting buys, reduce-first sells, the loss stops, the exit models. With the
// defaults it is RW's engine minute for minute (checked against stepRw and the engine's day rows: scripts/check.ts).
import { accStress, accTotal, newAcc, othersOf, quote, RW_INV_CAP, scoreS, sizeN, stepRw, type Acc, type BookRow } from "../../../../../supabase/functions/agents/pmrw.ts";
import { restRow, restTicks, isTight, tightBack, type RwxRest } from "../../../../../supabase/functions/agents/pmrw_x.ts";
import type { PmPrint } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import type { Meta, Rec, Row } from "../../lpself/scripts/rec.ts";

const M = 60e3, DAY = 86400e3;
const dayStr = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);

export type Variant = {
  id: string;
  // ---- the day's markets, chosen from the record's own selection of that day
  rateMin?: number; rateMax?: number;            // the market's daily rate in [rateMin, rateMax)
  sameDayFrom?: number | null;                   // RW-E's rule from this minute (null: never); default: from the record's start
  noWeatherFrom?: number | null;                 // x1's rule from this minute (null: never); default: from the record's start
  skipMarket?: (m: Meta, at?: number) => boolean;   // any other class rule, on the market's selection row (LP-ALLOC: and the selection's minute)
  horizonH?: number;                             // nothing whose scheduled end is within H hours of the day's start
  midBand?: [number, number];                    // the day's first book: adjusted mid inside [lo, hi]
  touchOverV?: number;                           // the day's first book: (best ask - best bid) in cents <= x * v
  minFormulaDay?: number;                        // the day's first book: first-round formula at least this
  budget?: number; maxMarkets?: number;          // choose(budget) by first-round reward per dollar, at most maxMarkets; none = all
  // ---- the quotes
  k?: number;                                    // order size: k x N (N = max(reward minimum, 5))
  invCap?: number;                               // a side stops at invCap x (order size) of inventory its way (RW: 3)
  tight?: { mode: "skip" | "back"; maxTicks: number };   // TB1
  reselectEveryH?: number;                       // choose again every H hours inside the day, from the record's slot at that minute
  fillCooldownMin?: number;                      // after a fill on a side, that side rests nothing for this many minutes
  imbalance?: [number, number];                  // no quote while the others' bid score share q1 / (q1 + q2) is outside [lo, hi]
  rest?: RwxRest;                                // x4 ("wide", keep) or x5 ("lean")
  lateCutH?: number;                             // not quoted from H hours before the market's scheduled end
  pause?: { cents: number; minutes: number };    // x2's rule: not quoted for `minutes` after the adjusted mid moves `cents` between two recorded minutes
  third?: boolean;                               // our score: the docs' max(min, max/3) when the mid is in [0.10, 0.90]
  fillAtPrice?: boolean;                         // SENSITIVITY: a print AT our price fills us too (the paper's rule needs one strictly through)
  // ---- the account
  caps?: { total: number; market: number; reduceFirst: boolean };
  stops?: { day: number; total: number; basis?: "fills" | "r40" | "paid"; R?: number };   // paid: fills + R x the rewards of days before today (what a daily payout shows)   // the path's: fills alone; r40: fills + 0.40 x formula rewards
  redeemLagMin?: number;                         // a settled market's payout counts against the caps until redeemed, this many minutes later
  exitCarried?: boolean;
  exitTaker?: { afterMin: number; feeRate: number; onlyEndingWithinH?: number };
  exitPassiveModel?: { sharesPerMin: number; costPerShare: number };   // MODEL: a carried position is worked off by resting sells at this expected rate and cost against the mark   // a market held but not chosen today is sold at the touch (a tick worse) plus the taker fee, at the day's minute afterMin                         // a market held but not chosen today rests close-only sells (where the record has its prints)
  // ---- LPCAP
  equity?: { R: number };                        // the total cap is caps.total + what the fills realised + R x the rewards of the days before today
  // ---- LP-ALLOC
  liveProg?: { nMax: number; minRate: number; lookbackMin?: number };   // the minute's programme (rec.progs): rate, v and N from it; off (ended, under minRate, N over nMax): close-only, no reward. lookbackMin: the highest-rate reading of the last L minutes (the listing's readings flicker), ended only if every reading in them is
  nearCertain?: { thr: number; share: number };   // Addendum 7: a buy of a token at >= thr rests only while held x mark + N x price <= share x the total cap
  driftStop?: number;                              // cents: no BUY of a token held while its mark is this far under the holding's average cost (sells unaffected)
  refill?: { reserve: number; offMin: number; maxPerDay?: number; source?: "reserve" | "fresh" | "live"; rerankMin?: number; allOut?: boolean; liveTop?: number; maxHeld?: number; ok?: (m: Meta, t: number) => boolean };
  // ---- LP-REFILL's guards (buys only)
  midMove?: { minutes: number; cents: number };   // no BUY of YES (bid) while the mid fell >= cents over the last `minutes`; of NO (ask) while it rose
  oneWay?: { fills: number; holdMin: number };     // after `fills` fills running on one side with none on the other, that side buys nothing for holdMin minutes (or until the other side fills)
  bandCap?: { lo: number; hi: number; invCap: number };   // the side cap is invCap x N while the mid is outside [lo, hi]
  noBuyEndH?: number;                              // no BUY within H hours of the market's scheduled end
  marketLoss?: number;                             // no BUY in a market whose fills are marked this many dollars down (realised + at the mark)
  zeroBuy?: "side" | "market";                    // no BUY whose own score (side) or whose market's formula (market) is 0 that minute; sells of what is held rest    // a chosen market off (liveProg) for offMin minutes running leaves the day's list (its holdings go close-only) and the next of `reserve` markets ranked at 00:00 whose programme pays then takes its place
  postsRefreshMin?: number;                      // the posts counter's refresh age (default 9 minutes)
};

type Tok = { held: number; avg: number; realised: number; today: number };
type MS = { acc: Acc; yes: Tok; no: Tok; meta: Meta | null; capMin: number; invMin: number; sideMin: number; minutes: number; rewardThird: number };
export type DayOut = {
  day: string; total: number; stress: number; reward: number; fillsPnl: number; markets: number; quotedMinutes: number; capitalRW: number;
  committedMax: number; rewardMinutes: number; committedMean: number; carriedMean: number; capWithheld: number; invStopped: number; stopDay: boolean; stopTotal: boolean; fillsLow: number; r40Low: number; posts: number; pool: number; capTotal: number; heldClose: number; progOff: number; progChanged: number; refills: number; guardBlocks: number; activeMean: number; zeroSlotMin: number; perMarket: Record<string, { total: number; stress: number; reward: number }>;
};
export type SimOut = { id: string; days: DayOut[]; end: { total: number; stress: number; reward: number; fillsPnl: number }; perMarket: Record<string, { total: number; stress: number; reward: number; meta: Meta | null; capDays: number; carriedDays: number; quotedMin: number; firstDay: string | null; fills: number; fillShares?: number }>; chosen: Record<string, string[]>; exits?: { n: number; cost: number }; rebates?: number };

const newTok = (): Tok => ({ held: 0, avg: 0, realised: 0, today: 0 });
const buy = (t: Tok, q: number, px: number) => { t.avg = t.held + q > 0 ? (t.avg * t.held + px * q) / (t.held + q) : 0; t.held += q; };
const sell = (t: Tok, q: number, px: number) => { const r = q * (px - t.avg); t.realised += r; t.today += r; t.held -= q; if (t.held < 1e-9) { t.held = 0; } };

/** The day's first quotable row of each market (its selection-time book, as close as the record holds it). */
function firstRows(rec: Rec, day: string, at?: number): Map<string, Row> {
  const out = new Map<string, Row>();
  const t0 = at ?? Date.parse(`${day}T00:00:00Z`);
  for (let t = t0; t < t0 + 30 * M; t += M) for (const r of rec.byMinute.get(t) ?? []) if (r.quoting && r.row && !out.has(r.cond)) out.set(r.cond, r);
  return out;
}

/** First-round reward per dollar of a market at a row, at k x N (RW's firstScore, with the size multiple). */
export function firstScoreK(row: BookRow | null, tick: number, m: Meta, k: number): { perDollarDay: number; cap: number; formulaDay: number } | null {
  if (!row) return null;
  const q = quote(row, tick || 0.01);
  if (!q) return null;
  const N = sizeN(m.minSize) * k;
  const ours = Math.min(scoreS(m.v, (q.m - q.b) * 100) * N, scoreS(m.v, (q.a - q.m) * 100) * N);
  const cap = N * (q.b + 1 - q.a);
  if (ours <= 0 || cap <= 0) return null;
  const per = m.rate / 1440 * ours / (ours + othersOf(q.m, q.q1, q.q2)) / cap;
  return { perDollarDay: per * 1440, cap, formulaDay: per * 1440 * cap };
}

/** The variant's markets for a day, from the record's selection. */
export function chooseDay(rec: Rec, v: Variant, day: string, at?: number): Meta[] {
  const t0 = Date.parse(`${day}T00:00:00Z`);
  const sel = at !== undefined ? ((rec as Rec & { slots?: Map<number, Meta[]> }).slots?.get(at) ?? []) : rec.selection.get(day) ?? [];
  const first = firstRows(rec, day, at);
  const k = v.k ?? 1;
  const scored: Array<{ m: Meta; per: number; cap: number }> = [];
  for (const m of sel) {
    if (v.rateMin !== undefined && m.rate < v.rateMin) continue;
    if (v.rateMax !== undefined && m.rate >= v.rateMax) continue;
    const sdFrom = v.sameDayFrom === undefined ? rec.start : v.sameDayFrom;
    if (sdFrom !== null && t0 >= sdFrom && m.end && Date.parse(m.end) < t0 + DAY) continue;
    const nwFrom = v.noWeatherFrom === undefined ? rec.start : v.noWeatherFrom;
    if (nwFrom !== null && t0 >= nwFrom && m.cat === "weather_fees") continue;
    if (v.skipMarket && v.skipMarket(m, at ?? t0)) continue;
    if (v.horizonH !== undefined && m.end && Date.parse(m.end) < (at ?? t0) + v.horizonH * 3600e3) continue;
    const fr = first.get(m.cond);
    const row = fr?.row ?? null;
    if (v.midBand) {
      if (!row || row[2] === null || row[3] === null) continue;
      const mid = (row[2] + row[3]) / 2;
      if (mid < v.midBand[0] || mid > v.midBand[1]) continue;
    }
    if (v.touchOverV !== undefined) {
      if (!row) continue;
      if ((row[1] - row[0]) * 100 > v.touchOverV * m.v + 1e-9) continue;
    }
    const fs = firstScoreK(row, fr?.tick ?? m.tick, m, k);
    if (v.minFormulaDay !== undefined && (!fs || fs.formulaDay < v.minFormulaDay - 1e-9)) continue;
    // ranking: the record's own per-dollar figure at k = 1 (its selection's book), else the first row's at k x N
    const per = k === 1 && m.perDollarDay !== null ? m.perDollarDay : fs?.perDollarDay ?? 0;
    const cap = k === 1 && m.capital !== null ? m.capital : fs?.cap ?? Infinity;
    scored.push({ m, per, cap });
  }
  if (v.budget === undefined && v.maxMarkets === undefined) return scored.map((x) => x.m);
  const sorted = scored.slice().sort((x, y) => (y.per - x.per) || (x.m.cond < y.m.cond ? -1 : 1));
  const out: Meta[] = [];
  let used = 0;
  for (const s of sorted) {
    if (v.maxMarkets !== undefined && out.length >= v.maxMarkets) break;
    if (v.budget === undefined || used + s.cap <= v.budget + 1e-9) { out.push(s.m); used += s.cap; }
  }
  return out;
}

/** Prints by minute bucket, read back as (t, t + 60 s]. */
function printIndex(prints: Map<string, PmPrint[]>) {
  const idx = new Map<string, PmPrint[]>();
  for (const [c, l] of prints) for (const p of l) { const k = `${c}|${Math.floor(p.ts / 60)}`; (idx.get(k) ?? idx.set(k, []).get(k)!).push(p); }
  return (c: string, t: number) => { const k = Math.floor(t / M); return [...(idx.get(`${c}|${k}`) ?? []), ...(idx.get(`${c}|${k + 1}`) ?? [])]; };
}

/**
 * One minute of one market under the variant: RW's stepRw, with the sides the caps and the stops allow, the size k x N,
 * the variant's inventory cap, the quotes moved by its rest rule, and our score by RW's min or the docs' one-sided third.
 * With every option at RW's, the result is stepRw's exactly (pinned by `check`).
 */
function stepV(acc: Acc, tSec: number, rowIn: BookRow | null, tick: number, v: number, rate: number, N: number, prints: PmPrint[], o: {
  invCap: number; third: boolean; atPrice?: boolean; rest?: RwxRest; tightBackOn?: boolean; allow?: (side: "bid" | "ask", q: { b: number; a: number }) => boolean;
  zeroBuy?: { mode: "side" | "market"; isSell: (side: "bid" | "ask") => boolean };   // LP-ALLOC: no BUY that the formula scores 0
}): { reward: number; fills: Array<{ side: "bid" | "ask"; price: number; size: number }>; qb: boolean; qa: boolean; invStopped: boolean; capStopped: boolean; b: number; a: number } | null {
  let row = rowIn;
  if (o.tightBackOn && rowIn) {
    const r = tightBack(rowIn, tick, v);
    if (r && (r.out.bid > 0 || r.out.ask > 0)) row = restRow(rowIn, r.q, tick, r.out);
  } else if (o.rest && rowIn) {
    const r = restTicks(o.rest, rowIn, tick, v, N, acc.net);
    if (r && (r.out.bid > 0 || r.out.ask > 0)) row = restRow(rowIn, r.q, tick, r.out);
  }
  const q = row ? quote(row, tick) : null;
  if (!q) return null;
  const { m, b, a, q1, q2 } = q;
  acc.lastM = m;
  acc.lastAb = row![2]; acc.lastAa = row![3];
  acc.quotedMinutes++;
  if (acc.firstCap === null) acc.firstCap = N * (b + 1 - a);
  const invB = acc.net < o.invCap * N, invA = acc.net > -o.invCap * N;
  // LP-ALLOC: a BUY whose own score (side) or whose market's formula (market: the smaller side's) is 0 does not rest; a sell does
  let zB = false, zA = false;
  if (o.zeroBuy) {
    const s0b = invB ? scoreS(v, (m - b) * 100) : 0, s0a = invA ? scoreS(v, (a - m) * 100) : 0;
    const zeroB = o.zeroBuy.mode === "side" ? s0b <= 0 : Math.min(s0b, s0a) <= 0, zeroA = o.zeroBuy.mode === "side" ? s0a <= 0 : Math.min(s0b, s0a) <= 0;
    zB = zeroB && !o.zeroBuy.isSell("bid"); zA = zeroA && !o.zeroBuy.isSell("ask");
  }
  const capB = !zB && (o.allow ? o.allow("bid", { b, a }) : true), capA = !zA && (o.allow ? o.allow("ask", { b, a }) : true);
  const qb = invB && capB, qa = invA && capA;
  const sb = qb ? scoreS(v, (m - b) * 100) * N : 0, sa = qa ? scoreS(v, (a - m) * 100) * N : 0;
  let ours = Math.min(sb, sa);
  if (o.third && 0.10 <= m && m <= 0.90) ours = Math.max(ours, Math.max(sb, sa) / 3);
  const others = othersOf(m, q1, q2);
  let r = 0;
  if (ours > 0) { r = rate / 1440 * ours / (ours + others); acc.reward += r; }
  let bidLeft = qb ? N : 0, askLeft = qa ? N : 0;
  const fills: Array<{ side: "bid" | "ask"; price: number; size: number }> = [];
  for (const p of prints) {
    if (!(p.ts > tSec && p.ts <= tSec + 60)) continue;
    let ypx: number, dirn: "BUY" | "SELL";
    if (p.oi === 0) { ypx = p.price; dirn = p.side; } else if (p.oi === 1) { ypx = 1 - p.price; dirn = p.side === "BUY" ? "SELL" : "BUY"; } else continue;
    const eps = o.atPrice ? 1e-9 : -1e-12;
    if (dirn === "SELL" && bidLeft > 0 && ypx < b + eps) {
      const qf = Math.min(bidLeft, p.size); bidLeft -= qf;
      acc.net += qf; acc.cash -= qf * b; acc.fills++; acc.fillShares += qf; acc.tickCost += qf * tick;
      acc.maxInvCost = Math.max(acc.maxInvCost, acc.net * b);
      fills.push({ side: "bid", price: b, size: qf });
    } else if (dirn === "BUY" && askLeft > 0 && ypx > a - eps) {
      const qf = Math.min(askLeft, p.size); askLeft -= qf;
      acc.net -= qf; acc.cash += qf * a; acc.fills++; acc.fillShares += qf; acc.tickCost += qf * tick;
      acc.maxInvCost = Math.max(acc.maxInvCost, -acc.net * (1 - a));
      fills.push({ side: "ask", price: a, size: qf });
    }
  }
  return { reward: r, fills, qb, qa, invStopped: !(invB && invA), capStopped: !(capB && capA), b, a };
}

export function simulate(rec: Rec, v: Variant, opts: { from?: number; to?: number } = {}): SimOut {
  const from = opts.from ?? rec.start, to = Math.min(opts.to ?? rec.last, rec.last);
  const k = v.k ?? 1, invCap = v.invCap ?? RW_INV_CAP, third = !!v.third;
  const printsAt = printIndex(rec.prints);
  const S = new Map<string, MS>();
  const chosenToday = new Map<string, Meta>();
  const chosen: Record<string, string[]> = {};
  const days: DayOut[] = [];
  let dayOf = Math.floor(from / DAY) * DAY;
  let dayActive = new Set<string>();
  let stopDay = false, stopTotal = false, stopDayFlag = false, stopTotalFlag = false, rewardAtDay = 0;
  let rewardMinutes = 0;
  let committedMax = 0, committedSum = 0, carriedSum = 0, nMin = 0, capWithheld = 0, invStopped = 0, quotedMinutes = 0, fillsLow = Infinity, r40Low = Infinity;
  const lastRow = new Map<string, Row>();
  const lastFillAt = new Map<string, number>();
  const lastMid = new Map<string, number>(), pausedUntil = new Map<string, number>();
  const unredeemed: Array<{ cond: string; until: number; usd: number }> = [];
  let exitCost = 0, exits = 0, rebates = 0;
  // LPCAP's counters and the equity cap
  let posts = 0, pool = 0, capTotalNow = v.caps?.total ?? Infinity;
  const resting = new Map<string, { px: number; sell: boolean; since: number }>();
  const refreshMin = v.postsRefreshMin ?? 9;
  // LP-ALLOC: the programme each minute, the counters
  type Prog = [number, number | null, number, number];
  const progs = (rec as Rec & { progs?: Map<string, Prog[]> }).progs;
  if (v.liveProg && !progs) throw new Error("liveProg needs the record's progs");
  const progAt = (c: string, t: number): { rate: number; v: number; minSize: number } | null => {
    const l = progs!.get(c);
    if (!l || !l.length) return null;
    const mi = t / M;
    let lo = 0, hi = l.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (l[mid][0] <= mi) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    if (at < 0) return null;
    const L = v.liveProg?.lookbackMin ?? 0;
    // the latest reading in the window that lists a programme sets its spread and minimum (those changes are real); the
    // rate is the highest the window's readings give with that spread and minimum
    let best: Prog | null = null;
    for (let i = at; i >= 0; i--) {
      const e = l[i];
      if (e[1] !== null) {
        if (!best) best = e;
        else if (e[2] === best[2] && e[3] === best[3] && e[1] > (best[1] as number)) best = [best[0], e[1], best[2], best[3]];
      }
      if (e[0] <= mi - L) break;   // the reading in force at the window's start is the last one looked at
    }
    return best ? { rate: best[1] as number, v: best[2], minSize: best[3] } : null;
  };
  let progOff = 0, refills = 0, guardBlocks = 0, activeSum = 0;
  // LP-REFILL: each market's mid by minute (for midMove), its run of one-sided fills, and the side it blocks until when
  const midHist = new Map<string, Array<[number, number]>>();
  const oneWayRun = new Map<string, { side: "bid" | "ask"; n: number }>(), oneWayUntil = new Map<string, number>();
  // LP-ALLOC: the refill's reserve (ranked at 00:00 after the day's choice) and each chosen market's run of off minutes
  let reserveList: Meta[] = [], refillsToday = 0, liveRanked: Meta[] = [], liveRankedAt = -Infinity, zeroSlotMin = 0;
  // Every market the record holds, by condition (its latest slot row), for the live ranking.
  const allMeta = new Map<string, Meta>();
  for (const [, l] of [...(((rec as Rec & { slots?: Map<number, Meta[]> }).slots) ?? new Map<number, Meta[]>())].sort((a, b) => a[0] - b[0])) for (const m of l) allMeta.set(m.cond, m);
  /** The live ranking at t: every market the record holds, not left out by the variant, paying now, scored by RW's first round on its latest book at k x N under its programme then. */
  const liveRank = (tt: number): Meta[] => {
    const day = dayStr(tt), t0 = Math.floor(tt / DAY) * DAY, out: Array<{ m: Meta; per: number }> = [];
    for (const [c, m0] of allMeta) {
      if (v.skipMarket && v.skipMarket(m0, tt)) continue;
      if (m0.end && Date.parse(m0.end) < t0 + DAY) continue;                       // RW-E's same-day rule
      if (m0.cat === "weather_fees") continue;
      const p = progAt(c, tt);
      if (!p || !(p.rate >= v.liveProg!.minRate) || !(p.v > 0) || sizeN(p.minSize) > v.liveProg!.nMax) continue;
      const lr = lastRow.get(c);
      if (!lr || !lr.row || tt - (lastRowAt.get(c) ?? -Infinity) > 5 * M) continue;
      const m = { ...m0, day, rate: p.rate, v: p.v, minSize: p.minSize };
      const fs = firstScoreK(lr.row, lr.tick || 0.01, m, v.k ?? 1);
      if (!fs || fs.formulaDay < (v.minFormulaDay ?? 2.5) - 1e-9) continue;
      out.push({ m, per: fs.perDollarDay });
    }
    return out.sort((a, b) => b.per - a.per || (a.m.cond < b.m.cond ? -1 : 1)).map((x) => x.m);
  };
  const lastRowAt = new Map<string, number>();
  const usedToday = new Set<string>();
  const offRun = new Map<string, number>();
  const progOn = (c: string, t: number) => { const p = progAt(c, t); return !!p && p.rate >= v.liveProg!.minRate && p.v > 0 && sizeN(p.minSize) <= v.liveProg!.nMax; };
  const progChangedSet = new Set<string>(), progSeen = new Map<string, string>();
  const heldNow = () => { let u = 0; for (const s of S.values()) if (s.acc.settled == null) u += s.yes.held * s.yes.avg + s.no.held * s.no.avg; return u; };
  const ms = (c: string): MS => { let s = S.get(c); if (!s) { s = { acc: newAcc(), yes: newTok(), no: newTok(), meta: null, capMin: 0, invMin: 0, sideMin: 0, minutes: 0, rewardThird: 0 }; S.set(c, s); } return s; };
  const mark = (s: MS) => s.acc.settled ?? s.acc.lastM ?? 0;
  const fillsPnlTokens = () => {   // the path's book-keeping: realised + unrealised at the mark (YES at m, NO at 1 - m)
    let day = 0, total = 0;
    for (const s of S.values()) {
      const m = mark(s);
      for (const [t, px] of [[s.yes, m], [s.no, 1 - m]] as Array<[Tok, number]>) {
        const un = t.held > 0 ? t.held * (px - t.avg) : 0;
        day += t.today + un; total += t.realised + un;
      }
    }
    return { day, total };
  };
  const startDay = (d: number) => {
    chosenToday.clear();
    const day = dayStr(d);
    for (const m of chooseDay(rec, v, day)) { chosenToday.set(m.cond, m); ms(m.cond).meta = m; }
    chosen[day] = [...chosenToday.keys()];
    if (v.refill) {
      reserveList = chooseDay(rec, { ...v, maxMarkets: (v.maxMarkets ?? 10) + v.refill.reserve, budget: undefined }, day).filter((m) => !chosenToday.has(m.cond)).slice(0, v.refill.reserve);
      offRun.clear();
    }
    refillsToday = 0; usedToday.clear(); for (const c of chosenToday.keys()) usedToday.add(c); liveRanked = []; liveRankedAt = -Infinity;
    for (const s of S.values()) { s.yes.today = 0; s.no.today = 0; }
    stopDay = false;
    rewardAtDay = 0; for (const s of S.values()) rewardAtDay += s.acc.reward;
  };
  const closeDay = () => {
    let total = 0, stress = 0, reward = 0, capitalRW = 0;
    const perMarket: DayOut["perMarket"] = {};
    for (const [c, s] of S) {
      const t = accTotal(s.acc), st = accStress(s.acc);
      total += t; stress += st; reward += s.acc.reward;
      perMarket[c] = { total: t, stress: st, reward: s.acc.reward };
      if (dayActive.has(c)) capitalRW += (s.acc.firstCap ?? 0) + s.acc.maxInvCost;
    }
    days.push({ day: dayStr(dayOf), total, stress, reward, fillsPnl: total - reward, markets: dayActive.size, quotedMinutes, capitalRW, committedMax, rewardMinutes, committedMean: nMin ? committedSum / nMin : 0, carriedMean: nMin ? carriedSum / nMin : 0, capWithheld, invStopped, stopDay: stopDayFlag, stopTotal: stopTotalFlag, fillsLow, r40Low, posts, pool, capTotal: capTotalNow, heldClose: heldNow(), progOff, progChanged: progChangedSet.size, refills, guardBlocks, activeMean: nMin ? activeSum / nMin : 0, zeroSlotMin, perMarket });
    posts = 0; pool = 0; progOff = 0; progChangedSet.clear(); refills = 0; guardBlocks = 0; activeSum = 0; zeroSlotMin = 0;
    rewardMinutes = 0;
    committedMax = 0; committedSum = 0; carriedSum = 0; nMin = 0; capWithheld = 0; invStopped = 0; quotedMinutes = 0; stopDayFlag = false; stopTotalFlag = false; fillsLow = Infinity; r40Low = Infinity;
    dayActive = new Set([...S].filter(([, s]) => s.acc.settled == null && s.acc.net !== 0).map(([c]) => c));
    dayOf += DAY;
  };
  startDay(dayOf);
  for (let t = from; t <= to; t += M) {
    if (t >= dayOf + DAY) { closeDay(); startDay(dayOf); }
    // LP-REFILL: the refill. Each minute a chosen market off for offMin minutes running leaves the day's list (all of them at
    // once when every one is off and `allOut` is set); then every empty place, up to maxMarkets, takes the next candidate
    // that pays now and passes `ok`, at most maxPerDay a day. Candidates: the 00:00 reserve in its order ("reserve"), the
    // freshest 2-hour slot's ranking ("fresh"), or a LIVE ranking ("live") of every market the record holds, scored by RW's
    // first round on its latest book under its programme then, re-ranked every `rerankMin` minutes.
    if (v.refill && v.liveProg) {
      const offNow = [...chosenToday.keys()].map((c) => [c, progOn(c, t)] as const);
      const allOff = v.refill.allOut && offNow.length > 0 && offNow.every(([, on]) => !on);
      for (const [c, on] of offNow) {
        const n = on ? 0 : (offRun.get(c) ?? 0) + 1;
        offRun.set(c, n);
        if ((!on && n >= Math.max(1, v.refill.offMin)) || allOff) chosenToday.delete(c);
      }
      const want = (v.maxMarkets ?? 10) - chosenToday.size;
      // maxHeld: no refill while the inventory held (at cost) is above this many dollars, so a refill takes free money only.
      if (want > 0 && (v.refill.maxPerDay === undefined || refillsToday < v.refill.maxPerDay) && (v.refill.maxHeld === undefined || heldNow() <= v.refill.maxHeld)) {
        let pool: Meta[] = reserveList;
        if (v.refill.source === "fresh") {
          const slotT = [...((rec as Rec & { slots?: Map<number, Meta[]> }).slots?.keys() ?? [])].filter((x) => x <= t).sort((a, b) => b - a)[0];
          pool = slotT === undefined ? [] : chooseDay(rec, { ...v, maxMarkets: (v.maxMarkets ?? 10) + v.refill.reserve, budget: undefined }, dayStr(dayOf), slotT);
        } else if (v.refill.source === "live") {
          if (t - liveRankedAt >= (v.refill.rerankMin ?? 15) * M || !liveRanked.length) { liveRanked = liveRank(t); liveRankedAt = t; }
          pool = v.refill.liveTop ? liveRanked.filter((m) => !usedToday.has(m.cond)).slice(0, v.refill.liveTop) : liveRanked;   // liveTop: the deployed reserve keeps 30 past today's rows
        }
        let added = 0;
        for (const m of pool) {
          if (added >= want || (v.refill.maxPerDay !== undefined && refillsToday >= v.refill.maxPerDay)) break;
          if (chosenToday.has(m.cond) || usedToday.has(m.cond) || !progOn(m.cond, t) || (v.refill.ok && !v.refill.ok(m, t))) continue;
          chosenToday.set(m.cond, m); ms(m.cond).meta = m; offRun.set(m.cond, 0); refills++; refillsToday++; usedToday.add(m.cond); added++;
          (chosen[`${dayStr(dayOf)} refill`] ??= []).push(m.cond);
        }
      }
    }
    if (v.liveProg) { const on = [...chosenToday.keys()].filter((c) => progOn(c, t)).length; if (on === 0) zeroSlotMin++; }
    if (v.reselectEveryH && t > dayOf && (t - dayOf) % (v.reselectEveryH * 3600e3) === 0) {
      chosenToday.clear();
      const day = dayStr(dayOf), list = chooseDay(rec, v, day, t);
      for (const m of list) { chosenToday.set(m.cond, m); ms(m.cond).meta = m; }
      chosen[`${day}@${new Date(t).toISOString().slice(11, 16)}`] = [...chosenToday.keys()];
    }
    // the account's committed capital before this minute's buys: every holding at cost
    let committed = 0, carried = 0;
    const byMarket = new Map<string, number>();
    for (const [c, s] of S) if (s.acc.settled == null) { const u = s.yes.held * s.yes.avg + s.no.held * s.no.avg; committed += u; byMarket.set(c, u); if (!chosenToday.has(c)) carried += u; }
    for (let i = unredeemed.length - 1; i >= 0; i--) { if (unredeemed[i].until <= t) unredeemed.splice(i, 1); else committed += unredeemed[i].usd; }
    let rewardNow = 0;
    for (const s of S.values()) rewardNow += s.acc.reward;
    if (v.equity && v.caps) { let realised = 0; for (const s of S.values()) realised += s.yes.realised + s.no.realised; capTotalNow = v.caps.total + realised + v.equity.R * rewardAtDay; }
    const restedNow = new Set<string>();
    // the stops, on the path's token books (fills alone)
    {
      const p = fillsPnlTokens();
      const r40 = { day: p.day + 0.4 * (rewardNow - rewardAtDay), total: p.total + 0.4 * rewardNow };
      const paid = { day: p.day, total: p.total + (v.stops?.R ?? 0.4) * rewardAtDay };
      fillsLow = Math.min(fillsLow, p.total); r40Low = Math.min(r40Low, r40.total);
      if (v.stops && !stopTotal) {
        const x = v.stops.basis === "r40" ? r40 : v.stops.basis === "paid" ? paid : p;
        if (x.total <= -v.stops.total) { stopTotal = true; stopTotalFlag = true; }
        else if (!stopDay && x.day <= -v.stops.day) { stopDay = true; stopDayFlag = true; }
      }
    }
    if (v.exitTaker && t === dayOf + v.exitTaker.afterMin * M) {
      for (const [c, s] of S) {
        if (chosenToday.has(c) || s.acc.settled != null || Math.abs(s.acc.net) < 1e-9) continue;
        if (v.exitTaker.onlyEndingWithinH !== undefined && !(s.meta?.end && Date.parse(s.meta.end) < t + v.exitTaker.onlyEndingWithinH * 3600e3)) continue;
        const lr = lastRow.get(c);
        const row = lr?.row;
        if (!row || row[2] === null || row[3] === null) continue;
        const tick = lr!.tick || 0.01, q = Math.abs(s.acc.net);
        // sell YES held (net > 0) one tick under the size-adjusted bid; buy back (sell NO) one tick over the size-adjusted ask
        const px = s.acc.net > 0 ? Math.max(0.001, row[2] - tick) : Math.min(0.999, row[3] + tick);
        const fee = v.exitTaker.feeRate * px * (1 - px) * q;
        if (s.acc.net > 0) { s.acc.cash += q * px - fee; if (s.yes.held > 0) sell(s.yes, Math.min(q, s.yes.held), px - fee / q); }
        else { s.acc.cash -= q * px + fee; if (s.no.held > 0) sell(s.no, Math.min(q, s.no.held), 1 - px - fee / q); }
        exitCost += q * Math.abs(((row[2] + row[3]) / 2) - px) + fee; exits++;
        s.acc.net = 0;
      }
    }
    if (v.exitPassiveModel) {
      for (const [c, s] of S) {
        if (chosenToday.has(c) || s.acc.settled != null || Math.abs(s.acc.net) < 1e-9) continue;
        const lr = lastRow.get(c);
        const row = lr?.row;
        if (!row || row[2] === null || row[3] === null) continue;
        const m = (row[2] + row[3]) / 2, q = Math.min(Math.abs(s.acc.net), v.exitPassiveModel.sharesPerMin);
        if (s.acc.net > 0) { const px = m - v.exitPassiveModel.costPerShare; s.acc.cash += q * px; s.acc.net -= q; if (s.yes.held > 0) sell(s.yes, Math.min(q, s.yes.held), px); }
        else { const px = m + v.exitPassiveModel.costPerShare; s.acc.cash -= q * px; s.acc.net += q; if (s.no.held > 0) sell(s.no, Math.min(q, s.no.held), 1 - px); }
        s.acc.fills++; exitCost += q * v.exitPassiveModel.costPerShare;
        if (Math.abs(s.acc.net) < 1e-9) { s.acc.net = 0; exits++; }
      }
    }
    for (const r of rec.byMinute.get(t) ?? []) {
      const c = r.cond;
      if (r.row) { lastRow.set(c, r); lastRowAt.set(c, t); }
      if (v.midMove && r.row && r.row[2] !== null && r.row[3] !== null) {
        const h = midHist.get(c) ?? midHist.set(c, []).get(c)!;
        while (h.length && h[0][0] < t - v.midMove.minutes * M) h.shift();
        h.push([t, (r.row[2] + r.row[3]) / 2]);
      }
      let meta = chosenToday.get(c) ?? null;
      let quoting = !!meta && r.quoting;
      // a market held from an earlier day: close-only sells at RW's quote, where the record holds its prints (RW quoting it)
      let exiting = false;
      if (!quoting && v.exitCarried && r.quoting) { const h = S.get(c); if (h && h.acc.settled == null && Math.abs(h.acc.net) > 1e-9 && h.meta) { meta = h.meta; quoting = true; exiting = true; } }
      if (quoting && v.lateCutH !== undefined && meta!.end && t >= Date.parse(meta!.end) - v.lateCutH * 3600e3) quoting = false;
      if (v.pause && r.row && r.row[2] !== null && r.row[3] !== null) {
        const mid = (r.row[2] + r.row[3]) / 2, prev = lastMid.get(c);
        if (prev !== undefined && Math.abs(mid - prev) * 100 >= v.pause.cents - 1e-9) pausedUntil.set(c, t + v.pause.minutes * M);
        lastMid.set(c, mid);
        if ((pausedUntil.get(c) ?? 0) > t) quoting = false;
      }
      if (quoting && v.imbalance && r.row) {
        const q1 = r.row[4], q2 = r.row[5], sh = q1 + q2 > 0 ? q1 / (q1 + q2) : 0.5;
        if (sh < v.imbalance[0] || sh > v.imbalance[1]) quoting = false;
      }
      let tightNow = false;
      if (v.tight && quoting && isTight(r.row, r.tick || 0.01, v.tight.maxTicks)) { tightNow = true; if (v.tight.mode === "skip") quoting = false; }
      const have = S.get(c);
      if (!quoting && !have) continue;
      const s = ms(c);
      if (s.acc.settled != null) continue;
      const row = r.row;
      if (row && row[2] !== null && row[3] !== null) { s.acc.lastAb = row[2]; s.acc.lastAa = row[3]; }
      // LP-ALLOC: the reward check on the minute's programme (a chosen market only; a carried one is close-only already)
      let pRate = meta?.rate ?? 0, pV = meta?.v ?? 0, pMin = meta?.minSize ?? 0, progOffNow = false;
      if (quoting && meta && v.liveProg && !exiting) {
        const p = progAt(c, t);
        const key = p ? `${p.rate}|${p.v}|${p.minSize}` : "ended", was = progSeen.get(c);
        if (was !== undefined && was !== key) progChangedSet.add(c);
        progSeen.set(c, key);
        if (!p || !(p.rate >= v.liveProg.minRate) || !(p.v > 0) || sizeN(p.minSize) > v.liveProg.nMax) { progOffNow = true; progOff++; }
        else { pRate = p.rate; pV = p.v; pMin = p.minSize; }
      }
      if (quoting && meta) {
        const N = sizeN(pMin) * k;
        const closeOnly = stopDay || stopTotal || exiting || progOffNow;
        const yesHeld = s.yes.held, noHeld = s.no.held;
        const reduceFirst = v.caps?.reduceFirst ?? false;
        // which order each side is: a SELL of what is held (no collateral) or a BUY (collateral)
        const bidIsSell = reduceFirst && noHeld >= N - 1e-9, askIsSell = reduceFirst && yesHeld >= N - 1e-9;
        // LP-REFILL: the guards, buys only. The mid now (the record's adjusted mid), its history, the market's marked fills.
        const midNow = row && row[2] !== null && row[3] !== null ? (row[2] + row[3]) / 2 : null;
        const guardBuy = (side: "bid" | "ask"): boolean => {
          if (v.midMove && midNow !== null) {
            const h = midHist.get(c) ?? [];
            const old = h.find(([tt]) => tt >= t - v.midMove!.minutes * M);
            if (old) {
              const d = (midNow - old[1]) * 100;
              if (side === "bid" && d <= -v.midMove.cents + 1e-9) return true;
              if (side === "ask" && d >= v.midMove.cents - 1e-9) return true;
            }
          }
          if (v.oneWay && (oneWayUntil.get(`${c}|${side}`) ?? 0) > t) return true;
          if (v.noBuyEndH !== undefined && meta!.end && t >= Date.parse(meta!.end) - v.noBuyEndH * 3600e3) return true;
          if (v.marketLoss !== undefined) {
            const mk = s.acc.lastM ?? midNow ?? 0;
            const pnl = s.yes.realised + s.no.realised + s.yes.held * (mk - s.yes.avg) + s.no.held * (1 - mk - s.no.avg);
            if (pnl <= -v.marketLoss) return true;
          }
          return false;
        };
        const allow = (side: "bid" | "ask", q: { b: number; a: number }) => {
          if (v.fillCooldownMin && t - (lastFillAt.get(`${c}|${side}`) ?? -Infinity) < v.fillCooldownMin * M) return false;
          if (closeOnly) return side === "bid" ? s.acc.net < 0 : s.acc.net > 0;     // only what reduces, as sells
          const isSell = side === "bid" ? bidIsSell : askIsSell;
          if (isSell) return true;
          if (guardBuy(side)) { guardBlocks++; return false; }                      // LP-REFILL: the loss guards
          if (v.driftStop !== undefined) {                                            // LP-ALLOC: no buy into a holding marked k cents under its cost
            const tok = side === "bid" ? s.yes : s.no;
            if (tok.held > 1e-9) {
              const m0 = s.acc.lastM ?? (side === "bid" ? q.b : q.a), mk = side === "bid" ? m0 : 1 - m0;
              if (mk < tok.avg - v.driftStop / 100 - 1e-9) return false;
            }
          }
          if (v.nearCertain) {                                                        // Addendum 7, EXPENSIVE-SIDE's usd / mark lines
            const e = v.nearCertain, px = side === "bid" ? q.b : 1 - q.a, tok = side === "bid" ? s.yes : s.no;
            if (px >= e.thr - 1e-9) {
              const mk = side === "bid" ? (s.acc.lastM ?? px) : 1 - (s.acc.lastM ?? 1 - px);
              const have = tok.held * mk;
              if (have + N * px > e.share * capTotalNow + 1e-9) return false;
            }
          }
          const usd = side === "bid" ? N * q.b : N * (1 - q.a);
          if (v.caps && committed + usd > capTotalNow + 1e-9) return false;
          if (v.caps && (byMarket.get(c) ?? 0) + usd > v.caps.market + 1e-9) return false;
          committed += usd; byMarket.set(c, (byMarket.get(c) ?? 0) + usd);
          return true;
        };
        const invNow = v.bandCap && midNow !== null && (midNow < v.bandCap.lo || midNow > v.bandCap.hi) ? Math.min(invCap, v.bandCap.invCap) : invCap;
        if (!closeOnly) activeSum++;
        const out = stepV(s.acc, t / 1000, row, r.tick, pV, pRate, N, printsAt(c, t), { invCap: invNow, third, atPrice: v.fillAtPrice, rest: v.rest, tightBackOn: tightNow && v.tight?.mode === "back", allow,
          zeroBuy: v.zeroBuy && !closeOnly ? { mode: v.zeroBuy, isSell: (sd: "bid" | "ask") => (sd === "bid" ? bidIsSell : askIsSell) } : undefined });
        if (out) {
          quotedMinutes++;
          if (!closeOnly) pool += pRate / 1440;
          for (const [side, on, px, isSell] of [["bid", out.qb, out.b, bidIsSell], ["ask", out.qa, out.a, askIsSell]] as Array<["bid" | "ask", boolean, number, boolean]>) {
            if (!on) continue;
            const key = `${c}|${side}`, prev = resting.get(key);
            restedNow.add(key);
            if (!prev || Math.abs(prev.px - px) > 1e-9 || prev.sell !== isSell || t - prev.since >= refreshMin * M) { posts++; resting.set(key, { px, sell: isSell, since: t }); }
          }
          if (out.reward > 0) rewardMinutes++;
          if (closeOnly && out.reward > 0) { s.acc.reward -= out.reward; }          // close-only quotes earn nothing (the paper layer's rule)
          if (out.capStopped && !closeOnly) capWithheld++;
          if (out.invStopped) invStopped++;
          for (const f of out.fills) {
            lastFillAt.set(`${c}|${f.side}`, t);
            if (v.oneWay) {
              const run = oneWayRun.get(c);
              const n1 = run && run.side === f.side ? run.n + 1 : 1;
              oneWayRun.set(c, { side: f.side, n: n1 });
              if (run && run.side !== f.side) oneWayUntil.delete(`${c}|${run.side}`);   // the other side filled: that side's block lifts
              if (n1 >= v.oneWay.fills) oneWayUntil.set(`${c}|${f.side}`, t + v.oneWay.holdMin * M);
            }
            rebates += 0.25 * 0.05 * f.size * f.price * (1 - f.price);   // maker rebate: 25 % of the fee equivalent at the common 0.05 rate (upside, not in the totals)
            if (f.side === "bid") { if (bidIsSell || (closeOnly && s.no.held >= f.size - 1e-9)) sell(s.no, f.size, 1 - f.price); else buy(s.yes, f.size, f.price); }
            else { if (askIsSell || (closeOnly && s.yes.held >= f.size - 1e-9)) sell(s.yes, f.size, f.price); else buy(s.no, f.size, 1 - f.price); }
          }
          // without reduce-first, a YES and a NO held together are a pair the account cannot use until it resolves
        }
        dayActive.add(c);
        committedMax = Math.max(committedMax, committed);
      } else if (row && row[2] !== null && row[3] !== null) {
        s.acc.lastM = (row[2] + row[3]) / 2;
        if (s.acc.net !== 0) dayActive.add(c);
      }
    }
    for (const key of [...resting.keys()]) if (!restedNow.has(key)) resting.delete(key);
    committedSum += committed; carriedSum += carried; nMin++;
    for (const [c, u] of byMarket) { const s = S.get(c)!; s.capMin += u; if (!chosenToday.has(c)) s.invMin += u; }
    for (const x of rec.settle.get(t) ?? []) {
      const s = S.get(x.cond);
      if (s && s.acc.settled == null) {
        s.acc.settled = x.payout;
        if (v.redeemLagMin) { const usd = s.yes.held * x.payout + s.no.held * (1 - x.payout); if (usd > 0) unredeemed.push({ cond: x.cond, until: t + v.redeemLagMin * M, usd }); }
        if (s.yes.held > 0) sell(s.yes, s.yes.held, x.payout);
        if (s.no.held > 0) sell(s.no, s.no.held, 1 - x.payout);
      }
    }
  }
  closeDay();
  let total = 0, stress = 0, reward = 0;
  const perMarket: SimOut["perMarket"] = {};
  for (const [c, s] of S) { const tt = accTotal(s.acc), st = accStress(s.acc); total += tt; stress += st; reward += s.acc.reward; perMarket[c] = { total: tt, stress: st, reward: s.acc.reward, meta: s.meta, capDays: s.capMin / 1440, carriedDays: s.invMin / 1440, quotedMin: s.acc.quotedMinutes, firstDay: Object.entries(chosen).find(([, l]) => l.includes(c))?.[0] ?? null, fills: s.acc.fills, fillShares: s.acc.fillShares }; }
  return { id: v.id, days, end: { total, stress, reward, fillsPnl: total - reward }, perMarket, chosen, exits: { n: exits, cost: exitCost }, rebates };
}

/** The same record through RW's own stepRw, every quoting minute of the record's own selection: the engine's check. */
export function rwFullResim(rec: Rec): { total: number; stress: number; reward: number; accs: Map<string, Acc> } {
  const printsAt = printIndex(rec.prints);
  const accs = new Map<string, Acc>();
  const meta = new Map<string, Meta>();
  for (let t = rec.start; t <= rec.last; t += M) {
    if (t % DAY === 0) for (const m of rec.selection.get(dayStr(t)) ?? []) meta.set(m.cond, m);
    for (const r of rec.byMinute.get(t) ?? []) {
      const c = r.cond;
      if (!r.quoting && !accs.has(c)) continue;
      const acc = accs.get(c) ?? accs.set(c, newAcc()).get(c)!;
      if (acc.settled != null) continue;
      if (r.row && r.row[2] !== null && r.row[3] !== null) { acc.lastAb = r.row[2]; acc.lastAa = r.row[3]; }
      const mt = (rec.selection.get(dayStr(t)) ?? []).find((x) => x.cond === c) ?? meta.get(c);
      if (r.quoting && mt) stepRw(acc, t / 1000, r.row, r.tick, mt.v, mt.rate, sizeN(mt.minSize), printsAt(c, t));
      else if (r.row && r.row[2] !== null && r.row[3] !== null) acc.lastM = (r.row[2] + r.row[3]) / 2;
    }
    for (const x of rec.settle.get(t) ?? []) { const a = accs.get(x.cond); if (a && a.settled == null) a.settled = x.payout; }
  }
  let total = 0, stress = 0, reward = 0;
  for (const a of accs.values()) { total += accTotal(a); stress += accStress(a); reward += a.reward; }
  return { total, stress, reward, accs };
}
