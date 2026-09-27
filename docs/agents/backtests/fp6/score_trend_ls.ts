// fp6 phase 2 — H4 TREND-LS, scored exactly as frozen.
// Pre-registration: docs/agents/reviews/2026-09-26-fp6-prereg-trend-ls.md (frozen on main by d856fd2e).
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write docs/agents/backtests/fp6/score_trend_ls.ts \
//     --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> --ktape <dir with BTC-USD_4h_kraken.json …>
//
// Before anything is priced it (1) checks the sha256 of the prereg, of trend_ls.ts, of the fifteen tapes, of
// funding.json.gz, of trend_ls_counts.json and of btc_regime.json; (2) reproduces the incumbent through
// `runGated` + `combine` exactly as btc_regime.json published it (return, drawdown, entries, entries per coin) in all
// four evaluations and windows A–D; (3) prices the long leg `simulate` gives with the short leg off, at Revolut X's
// costs, and stops unless its marks equal `runGated`'s bar for bar; (4) recomputes phase 1's counts and stops unless
// they equal trend_ls_counts.json. It writes backtests/fp6/trend_ls.json with sorted keys, fixed rounding and no
// clock. Run twice: byte-identical.
//
// Readings the prereg left open, taken once here and named in the study:
// * A stop fills inside the bar after its decision; for funding its exit time is that bar's start (as a rule exit's).
// * A settlement bucket that starts no 4-hour bar (SOL's 2-hourly settlements) is marked at the open of the bar that
//   contains it.
// * A null episode must end inside the scored span (its exit decision before the last bar), or it is drawn again.
// * The null's per-window contributions for condition 4 are the same draws' window terms; the 5th percentile is the
//   house's `summarize` quantile (sorted value at floor(0.05 n)).

import { applyFill, atrAt, DEFAULT_TREND, FLAT, type Candle, type Position } from "../../../../supabase/functions/_shared/agents_strategy.ts";
import { COSTS, type StopParams } from "../../../../supabase/functions/agents/backtest.ts";
import {
  BAR_HOURS, buildTrack, combine, CONDITIONS, dailyReturns, loadMeasuredSeries, mulberry32, rulePolicy, runGated,
  seedOf, stopsOf, trackDecider, type Condition, type WinName,
} from "../../../../supabase/functions/agents/backtest_jev.ts";
import { PERP_HALF_SPREAD, simulate, spanOf, SYMBOLS, type Trade, WINDOWS } from "./trend_ls.ts";

const HERE = "docs/agents/backtests/fp6";
const FROZEN: Record<string, string> = {
  "docs/agents/reviews/2026-09-26-fp6-prereg-trend-ls.md": "9251145e63edb3cc1026007138272ef4f61eebc5f9d1b2cdffeb30d16ddab317",
  [`${HERE}/trend_ls.ts`]: "37fdb9c93d07296100f872be284d9f119c6122cc8683f1f5c309e204435ea9cc",
  [`${HERE}/trend_ls_counts.json`]: "fe966d60e4ce9f909430ffa300efa7771d849c7fc111628fa2baff7c44ed8c40",
  "docs/agents/backtests/btc_regime/btc_regime.json": "c30e5826052598d0bc3dfe184574dca9fafdb6f529595ac87322598e6d7deea0",
};
const DRAWS = 2000;
const MAX_TRIES = 10_000;
const SLOT_USD = 25;
const BAR_MS = BAR_HOURS * 3600e3;
const PERP_FEE = 0.0005;            // USDⓈ-M taker, regular tier, no BNB
const PERP_SYMBOL: Record<string, string> = { "BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT", "AVAX/USD": "AVAXUSDT" };

async function sha256(path: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const r6 = (x: number) => Number(x.toFixed(6));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

// ── funding ─────────────────────────────────────────────────────────────────
type Fund = { b: number[]; r: number[] };
async function loadFunding(path: string): Promise<Record<string, Fund>> {
  const stream = new Blob([await Deno.readFile(path)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const all = JSON.parse(await new Response(stream).text()) as Record<string, [number, number | null, string][]>;
  const out: Record<string, Fund> = {};
  for (const sym of Object.values(PERP_SYMBOL)) {
    const byB = new Map<number, number>();
    for (const [t, , rate] of all[sym]) {
      const b = Math.floor(t / 3600e3) * 3600e3;
      if (t - b > 120_000) throw new Error(`${sym}: settlement ${t} is not within two minutes after an hour`);
      byB.set(b, parseFloat(rate));
    }
    const bs = [...byB.keys()].sort((a, c) => a - c);
    out[sym] = { b: bs, r: bs.map((x) => byB.get(x)!) };
  }
  return out;
}
function upperBound(xs: number[], v: number): number { // first index with xs[i] > v
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

// ── pricing a trade list the way runGated prices a long, and its mirror for a short ──────────────
type Leg = { fee: number; hs: number; funding: boolean };
type Priced = { marks: [number, number][]; fundingUsd: number; barsIn: number; fills: number };
const unaligned = { count: 0 };

function makeMark(bars: Candle[]) {
  const byStart = new Map<number, number>();
  for (const c of bars) byStart.set(c.start, c.open);
  const starts = bars.map((c) => c.start);
  return (bucket: number): number => {
    const o = byStart.get(bucket);
    if (o !== undefined) return o;
    unaligned.count++;
    const i = upperBound(starts, bucket) - 1;
    return bars[i].open;
  };
}

function replay(
  bars: Candle[], from: number, to: number, trades: Trade[], stops: StopParams,
  legOf: (side: "long" | "short") => Leg, fund: Fund, markOf: (bucket: number) => number,
): Priced {
  const start = Math.max(from, DEFAULT_TREND.slow + 1);
  const byEntry = new Map<number, Trade>();
  for (const t of trades) {
    if (byEntry.has(t.entryBar)) throw new Error("two trades on one bar");
    byEntry.set(t.entryBar, t);
  }
  let cash = 1.0, pos: Position = FLAT, side: "long" | "short" | null = null, cur: Trade | null = null;
  let q = 0, pe = 0, margin = 0, avgS = 0, lowWater: number | null = null;
  let fillTs = 0, fAcc = 0, fj = 0, fundingUsd = 0, barsIn = 0, fills = 0;
  const marks: [number, number][] = [];
  const accrue = (upTo: number, inclusive: boolean, qty: number, sign: number) => {
    while (fj < fund.b.length && (inclusive ? fund.b[fj] <= upTo : fund.b[fj] < upTo)) {
      fAcc += sign * qty * markOf(fund.b[fj]) * fund.r[fj];
      fj++;
    }
  };
  for (let i = start; i < to - 1; i++) {
    const next = bars[i + 1];
    if (side === null) {
      const t = byEntry.get(i);
      if (t) {
        const c = legOf(t.side);
        if (t.side === "long") {
          const price = next.open * (1 + c.hs);
          const base = cash / (price * (1 + c.fee));
          const fee = base * price * c.fee;
          pos = applyFill(FLAT, { ts: next.start, side: "buy", base, price, feeUsd: fee });
          cash = 0;
        } else {
          pe = next.open * (1 - c.hs);
          q = cash / (pe * (1 + c.fee));
          const fee = q * pe * c.fee;
          margin = cash - fee;
          avgS = pe; lowWater = pe;
          cash = 0;
        }
        side = t.side; cur = t; fillTs = next.start; fAcc = 0; fills++;
        fj = upperBound(fund.b, fillTs);
      }
    } else if (cur!.exitBar === i && cur!.how !== "end") {
      const c = legOf(side);
      if (c.funding) accrue(next.start, true, side === "long" ? pos.base : q, side === "long" ? -1 : 1);
      if (side === "long") {
        let price: number;
        if (cur!.how === "rule") price = next.open * (1 - c.hs);
        else {
          const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
          const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
          const floor = pos.avgCost * (1 - stops.maxLossPct);
          const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
          const level = Math.max(floor, trail);
          if (!(next.low <= level)) throw new Error(`long stop at bar ${i} does not trigger in the replay`);
          price = Math.min(level, next.open) * (1 - c.hs);
        }
        const fee = pos.base * price * c.fee;
        cash = pos.base * price - fee + fAcc;
        pos = FLAT;
      } else {
        let px: number;
        if (cur!.how === "rule") px = next.open * (1 + c.hs);
        else {
          const lw = Math.min(lowWater ?? avgS, avgS);
          const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
          const floor = avgS * (1 + stops.maxLossPct);
          const trail = stops.atrStop != null && atr != null ? lw + stops.atrStop * atr : Infinity;
          const level = Math.min(floor, trail);
          if (!(next.high >= level)) throw new Error(`short stop at bar ${i} does not trigger in the replay`);
          px = Math.max(level, next.open) * (1 + c.hs);
        }
        const fee = q * px * c.fee;
        cash = margin + q * (pe - px) - fee + fAcc;
        q = 0; lowWater = null;
      }
      fundingUsd += fAcc; fAcc = 0;
      side = null; cur = null; fills++;
    }
    if (side === "long") pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) };
    if (side === "short") lowWater = Math.min(lowWater ?? next.low, next.low);
    let eq: number;
    if (side === "long") {
      barsIn++;
      if (legOf("long").funding) accrue(next.start + BAR_MS, false, pos.base, -1);
      eq = cash + pos.base * next.close + fAcc;
    } else if (side === "short") {
      barsIn++;
      if (legOf("short").funding) accrue(next.start + BAR_MS, false, q, 1);
      eq = margin + q * (pe - next.close) + fAcc;
    } else eq = cash;
    marks.push([next.start, eq]);
  }
  fundingUsd += fAcc;
  return { marks, fundingUsd, barsIn, fills };
}

type Sleeves = { ret: number; maxDD: number };
function sleeve(per: { sym: string; marks: [number, number][]; barsIn: number; span: number; fills: number }[]): Sleeves {
  const st = combine(per.map((x) => ({
    id: `fp6·${x.sym}`, symbol: x.sym, slotUsd: SLOT_USD, rets: dailyReturns(x.marks), ret: 0, maxDD: 0,
    trades: x.fills, exposure: x.barsIn / Math.max(1, x.span), tradedUsd: x.fills * SLOT_USD,
  })));
  return { ret: st.ret, maxDD: st.maxDD };
}

// ── main ───────────────────────────────────────────────────────────────────
const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const dataDir = String(args.data), extDir = String(args.ext), kDir = String(args.ktape);
const manifest = JSON.parse(await Deno.readTextFile(`${HERE}/manifest.json`));
const hashes: Record<string, string> = {};
for (const [rel, want] of Object.entries(FROZEN)) {
  const got = await sha256(rel);
  if (got !== want) throw new Error(`${rel} is ${got}, frozen as ${want}: stop`);
  hashes[rel] = got;
}
for (const [name, want] of Object.entries(manifest.sources.tapes as Record<string, string>)) {
  if (name === "note") continue;
  const dir = name.endsWith("_1h_3y.json") ? dataDir : name.endsWith("_1h_kraken.json") ? extDir : kDir;
  const got = await sha256(`${dir}/${name}`);
  if (got !== want) throw new Error(`tape ${name} is ${got}, the manifest says ${want}: stop`);
  hashes[`tape ${name}`] = got;
}
{
  const got = await sha256(`${HERE}/inputs/funding.json.gz`);
  if (got !== manifest.inputs["funding.json.gz"].sha256) throw new Error("funding.json.gz does not match the manifest: stop");
  hashes["inputs/funding.json.gz"] = got;
}
for (const f of ["supabase/functions/agents/backtest_jev.ts", "supabase/functions/agents/backtest.ts", "supabase/functions/_shared/agents_strategy.ts"]) {
  hashes[f] = await sha256(f);
}

const { series } = await loadMeasuredSeries(dataDir, extDir, kDir);
const regime = JSON.parse(await Deno.readTextFile("docs/agents/backtests/btc_regime/btc_regime.json"));
const phase1 = JSON.parse(await Deno.readTextFile(`${HERE}/trend_ls_counts.json`));
const funding = await loadFunding(`${HERE}/inputs/funding.json.gz`);

const revx = (sym: string): Leg => ({ fee: COSTS.revx.takerBps / 1e4, hs: COSTS.revx.halfSpread[sym], funding: false });
const perp = (sym: string): Leg => ({ fee: PERP_FEE, hs: PERP_HALF_SPREAD[sym], funding: true });

// 1. the incumbent through runGated + combine, against btc_regime.json; 2. simulate's long leg priced at Revolut X's
// costs against runGated's marks, bar for bar; 3. phase 1's counts.
const counts: Record<string, unknown> = {};
let checkedCells = 0;
const inc: Record<string, Record<string, Sleeves & { entries: number; entriesByCoin: Record<string, number> }>> = {};
for (const cond of CONDITIONS) {
  const stops = stopsOf(cond.stopRule, DEFAULT_TREND);
  inc[cond.id] = {};
  const perW: Record<string, unknown> = {};
  for (const w of WINDOWS) {
    const per: { sym: string; marks: [number, number][]; barsIn: number; span: number; fills: number }[] = [];
    const entriesByCoin: Record<string, number> = {};
    const perCoin: Record<string, unknown> = {};
    let entries = 0, longOnlyEntries = 0;
    for (const sym of SYMBOLS) {
      const sp = spanOf(series[sym], cond, w)!;
      const t = buildTrack(sym, sp.bars, sp.daily, DEFAULT_TREND, sp.from, sp.to);
      const g = runGated(sym, t.bars, t.from, t.to, t.warmup, trackDecider(t, rulePolicy), COSTS.revx, stops);
      entries += g.entries; entriesByCoin[sym] = g.entries;
      per.push({ sym, marks: g.marks, barsIn: 0, span: sp.to - sp.from, fills: g.trades });
      // simulate's long leg, priced here, must give runGated's marks bar for bar
      const hsL = COSTS.revx.halfSpread[sym], hsS = PERP_HALF_SPREAD[sym];
      const incT = simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, false, hsL, hsS);
      const mine = replay(sp.bars, sp.from, sp.to, incT, stops, () => revx(sym), funding[PERP_SYMBOL[sym]], makeMark(sp.bars));
      if (mine.marks.length !== g.marks.length) throw new Error(`${cond.id} ${w} ${sym}: ${mine.marks.length} marks against runGated's ${g.marks.length}`);
      for (let k = 0; k < g.marks.length; k++) {
        if (mine.marks[k][0] !== g.marks[k][0] || mine.marks[k][1] !== g.marks[k][1]) {
          throw new Error(`${cond.id} ${w} ${sym}: mark ${k} is ${mine.marks[k]} against runGated's ${g.marks[k]}: stop`);
        }
      }
      checkedCells++;
      // phase 1's counts, recomputed exactly as trend_ls.ts's counts stage computed them
      const ls = simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, true, hsL, hsS);
      const shorts = ls.filter((x) => x.side === "short"), longs = ls.filter((x) => x.side === "long");
      longOnlyEntries += incT.length;
      const lo = Math.max(sp.from, DEFAULT_TREND.slow + 1);
      const rets: number[] = [];
      for (let k = lo + 1; k < sp.to; k++) rets.push(Math.log(sp.bars[k].close / sp.bars[k - 1].close));
      const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
      const published = regime.perCondition?.[cond.id]?.[w]?.incumbent?.entriesByCoin?.[sym];
      perCoin[sym] = {
        sd4h: Number(sd.toFixed(6)), scoredBars: sp.to - 1 - Math.max(sp.from, DEFAULT_TREND.slow + 1),
        incumbentEntries: incT.length, incumbentEntriesPublished: published ?? null,
        lsLongEntries: longs.length, lsShortEntries: shorts.length,
        shortBarsHeld: shorts.reduce((a, x) => a + x.bars, 0), shortStops: shorts.filter((x) => x.how === "stop").length,
        shortLengthsBars: shorts.map((x) => x.bars),
      };
    }
    perW[w] = { longOnlyEntries, perCoin };
    const st = sleeve(per);
    const pub = regime.perCondition[cond.id][w].incumbent;
    if (st.ret !== pub.ret || st.maxDD !== pub.maxDD || entries !== pub.entries || JSON.stringify(entriesByCoin) !== JSON.stringify(pub.entriesByCoin)) {
      throw new Error(`${cond.id} ${w}: the incumbent gives ${JSON.stringify({ ...st, entries, entriesByCoin })}, btc_regime.json ${JSON.stringify(pub)}: stop`);
    }
    inc[cond.id][w] = { ...st, entries, entriesByCoin };
  }
  counts[cond.id] = perW;
}
if (JSON.stringify(sortKeys(counts)) !== JSON.stringify(sortKeys(phase1.counts)) || phase1.mismatchesAgainstPublishedIncumbentEntries !== 0) {
  throw new Error("phase 1's counts do not reproduce: stop");
}
console.log(`checks: incumbent = btc_regime.json in 16 cells; simulate's long leg = runGated's marks in ${checkedCells} coin cells; phase-1 counts equal`);

// 4. the arms
type Cell = { sym: string; bars: Candle[]; from: number; to: number; stops: StopParams; fund: Fund; markOf: (b: number) => number };
const out: Record<string, unknown> = {};
const verdict: Record<string, unknown> = {};
let hMax = 0;
for (const cond of CONDITIONS) {
  const stops = stopsOf(cond.stopRule, DEFAULT_TREND);
  const cells: Record<string, Record<string, Cell>> = {};
  const arms: Record<string, Record<string, Sleeves & Record<string, unknown>>> = { "LS-PERP": {}, "L-PERP": {}, "LS-MIX": {} };
  const lperpTrades: Record<string, Record<string, Trade[]>> = {};
  const lperpPriced: Record<string, Record<string, Priced>> = {};
  const lsShorts: Record<string, Record<string, Trade[]>> = {};
  for (const w of WINDOWS) {
    cells[w] = {}; lperpTrades[w] = {}; lperpPriced[w] = {}; lsShorts[w] = {};
    const per: Record<string, { sym: string; marks: [number, number][]; barsIn: number; span: number; fills: number }[]> = { "LS-PERP": [], "L-PERP": [], "LS-MIX": [] };
    const info: Record<string, Record<string, unknown>> = { "LS-PERP": {}, "L-PERP": {}, "LS-MIX": {} };
    for (const sym of SYMBOLS) {
      const sp = spanOf(series[sym], cond, w)!;
      const cell: Cell = { sym, bars: sp.bars, from: sp.from, to: sp.to, stops, fund: funding[PERP_SYMBOL[sym]], markOf: makeMark(sp.bars) };
      cells[w][sym] = cell;
      const hsP = PERP_HALF_SPREAD[sym], hsR = COSTS.revx.halfSpread[sym];
      const runs: Record<string, { trades: Trade[]; leg: (s: "long" | "short") => Leg }> = {
        "LS-PERP": { trades: simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, true, hsP, hsP), leg: () => perp(sym) },
        "L-PERP": { trades: simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, false, hsP, hsP), leg: () => perp(sym) },
        "LS-MIX": { trades: simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, true, hsR, hsP), leg: (s) => s === "long" ? revx(sym) : perp(sym) },
      };
      for (const [arm, run] of Object.entries(runs)) {
        const p = replay(sp.bars, sp.from, sp.to, run.trades, stops, run.leg, cell.fund, cell.markOf);
        per[arm].push({ sym, marks: p.marks, barsIn: p.barsIn, span: sp.to - sp.from, fills: p.fills });
        const sh = run.trades.filter((x) => x.side === "short");
        info[arm][sym] = {
          longs: run.trades.filter((x) => x.side === "long").length, shorts: sh.length,
          shortStops: sh.filter((x) => x.how === "stop").length, fundingOfSlot: r6(p.fundingUsd),
        };
        if (arm === "L-PERP") { lperpTrades[w][sym] = run.trades; lperpPriced[w][sym] = p; }
        if (arm === "LS-PERP") lsShorts[w][sym] = sh;
      }
    }
    for (const arm of Object.keys(arms)) arms[arm][w] = { ...sleeve(per[arm]), perCoin: info[arm] };
  }
  // the statistic: the short leg's contribution summed over the four windows
  const contrib: Record<string, number> = {};
  let S = 0;
  for (const w of WINDOWS) { contrib[w] = arms["LS-PERP"][w].ret - arms["L-PERP"][w].ret; S += contrib[w]; }
  // the null: LS-PERP's short episodes re-placed at random flat, not-cooling-down bars of L-PERP's run
  const nullS: number[] = [];
  const nullW: Record<string, number[]> = Object.fromEntries(WINDOWS.map((w) => [w, [] as number[]]));
  let dropped = 0;
  for (let draw = 0; draw < DRAWS; draw++) {
    const rng = mulberry32(seedOf("fp6-trend-ls", cond.id, draw));
    const placed: Record<string, Record<string, Trade[]>> = {};
    let ok = true;
    for (const w of WINDOWS) {
      placed[w] = {};
      for (const sym of SYMBOLS) {
        const cell = cells[w][sym];
        const longs = lperpTrades[w][sym];
        const start = Math.max(cell.from, DEFAULT_TREND.slow + 1);
        const blocked = new Uint8Array(cell.to);      // decision bars a long occupies, [entryBar, exitBar]
        const cooling = new Uint8Array(cell.to);      // flat but cooling down after an L-PERP exit
        for (const t of longs) {
          for (let k = t.entryBar; k <= Math.min(t.exitBar, cell.to - 1); k++) blocked[k] = 1;
          for (let k = t.exitBar + 1; k < Math.min(cell.to, t.exitBar + 1 + stops.reentryBars); k++) cooling[k] = 1;
        }
        const cands: number[] = [];
        for (let i = start; i < cell.to - 1; i++) if (!blocked[i] && !cooling[i]) cands.push(i);
        const eps: Trade[] = [];
        const taken = new Uint8Array(cell.to);
        for (const s of lsShorts[w][sym]) {
          const L = s.bars;
          let tries = 0, put = false;
          while (tries < MAX_TRIES) {
            tries++;
            const i = cands[Math.floor(rng() * cands.length)];
            if (i + L >= cell.to - 1) continue;
            let clash = false;
            for (let k = i; k <= i + L; k++) if (blocked[k] || taken[k]) { clash = true; break; }
            if (clash) continue;
            for (let k = i; k <= i + L; k++) taken[k] = 1;
            eps.push({ side: "short", entryBar: i, exitBar: i + L, how: "rule", bars: L });
            put = true;
            break;
          }
          if (!put) { ok = false; break; }
        }
        if (!ok) break;
        placed[w][sym] = eps;
      }
      if (!ok) break;
    }
    if (!ok) { dropped++; continue; }
    let sStar = 0;
    for (const w of WINDOWS) {
      const per = SYMBOLS.map((sym) => {
        const cell = cells[w][sym];
        const eps = placed[w][sym];
        const p = eps.length === 0
          ? lperpPriced[w][sym]
          : replay(cell.bars, cell.from, cell.to, [...lperpTrades[w][sym], ...eps], cell.stops, () => perp(sym), cell.fund, cell.markOf);
        return { sym, marks: p.marks, barsIn: p.barsIn, span: cell.to - cell.from, fills: p.fills };
      });
      const d = sleeve(per).ret - arms["L-PERP"][w].ret;
      nullW[w].push(d);
      sStar += d;
    }
    nullS.push(sStar);
  }
  const valid = nullS.length;
  const pEval = (1 + nullS.filter((x) => x >= S - 1e-12).length) / (1 + valid);
  hMax = Math.max(hMax, pEval);
  const q05 = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.05 * s.length))]; };
  const c4: Record<string, unknown> = {};
  let c4ok = true;
  for (const w of WINDOWS) {
    const p5 = q05(nullW[w]);
    const holds = contrib[w] > p5;
    c4ok &&= holds;
    c4[w] = { contribution: r6(contrib[w]), nullP05: r6(p5), holds };
  }
  const worst = (m: Record<string, Sleeves>) => WINDOWS.reduce((a, w) => Math.min(a, m[w].ret), Infinity);
  const incW = worst(inc[cond.id]), lsW = worst(arms["LS-PERP"]);
  const c1 = lsW > incW;
  const c3 = arms["LS-PERP"]["D"].ret > inc[cond.id]["D"].ret;
  const c5 = WINDOWS.every((w) => arms["LS-PERP"][w].maxDD < 0.35);
  verdict[cond.id] = {
    c1_worstWindowImproves: { incumbentWorst: incW, lsPerpWorst: lsW, holds: c1 },
    c2_shortTimingBeatsRandom: { S: r6(S), p: r6(pEval), validDraws: valid, droppedDraws: dropped,
                                 nullMean: r6(nullS.reduce((a, b) => a + b, 0) / Math.max(1, valid)) },
    c3_windowDImproves: { incumbent: inc[cond.id]["D"].ret, lsPerp: arms["LS-PERP"]["D"].ret, holds: c3 },
    c4_noWindowCostsBeyondChance: { perWindow: c4, holds: c4ok },
    c5_drawdownUnder35pct: { worst: WINDOWS.reduce((a, w) => Math.max(a, arms["LS-PERP"][w].maxDD), 0), holds: c5 },
  };
  out[cond.id] = { incumbent: inc[cond.id], arms };
  console.log(`${cond.id}: INC ${WINDOWS.map((w) => inc[cond.id][w].ret).join(" / ")} | LS-PERP ${WINDOWS.map((w) => arms["LS-PERP"][w].ret).join(" / ")} | L-PERP ${WINDOWS.map((w) => arms["L-PERP"][w].ret).join(" / ")} | S ${r6(S)} p ${r6(pEval)} (dropped ${dropped})`);
}
const conds = ["c1_worstWindowImproves", "c3_windowDImproves", "c4_noWindowCostsBeyondChance", "c5_drawdownUnder35pct"];
const allOther = CONDITIONS.every((c) => conds.every((k) => ((verdict[c.id] as Record<string, { holds: boolean }>)[k]).holds));
const result = {
  hypothesis: "fp6-H4 TREND-LS",
  pForHolm: r6(hMax),
  passesOtherThanHolm: allOther,
  verdictByEvaluation: verdict,
  perEvaluation: out,
  checks: {
    incumbentEqualsBtcRegimeJson: "16 of 16 evaluation × window cells: return, drawdown, entries, entries per coin",
    simulateLongLegEqualsRunGatedMarks: `${checkedCells} of 64 coin cells, every mark`,
    phase1CountsEqual: true,
    fundingBucketsThatStartNo4hBar: Object.fromEntries(Object.entries(funding).map(([s, f]) => [s, f.b.filter((b) => b % BAR_MS !== 0).length])),
  },
  inputs: hashes,
  draws: DRAWS,
};
await Deno.writeTextFile(`${HERE}/trend_ls.json`, JSON.stringify(sortKeys(result), null, 1) + "\n");
console.log(`H4 p for Holm ${r6(hMax)}; other conditions ${allOther ? "hold" : "fail"}`);
