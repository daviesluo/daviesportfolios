// The SIZING-AND-FILTERS study: three changes to the live candidate row,
// pre-registered before any of them was run, each judged against the
// incumbent by the bar §3.19 set and §4.21 applied. A study, not a rulebook.
// Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_sizing.ts \
//     --data    <dir with BTC-USD_1h_3y.json …>          (Coinbase Exchange hourly)
//     --ext     <dir with BTC-USD_1h_kraken.json …>      (Kraken quarterly bundle, hourly)
//     --ktape   <dir with BTC-USD_4h_kraken.json …>      (Kraken's own 4h tape)
//     --dvol    <deribit_dvol_1D_full.json>              (Deribit DVOL, daily candles, BTC and ETH)
//     --funding <binance_funding_daily.json>             (Binance USDⓈ-M funding, summed per UTC day)
//     --set2    docs/agents/backtests/set2.json          (the incumbent on all four evaluations)
//     --out     docs/agents/backtests
//     [--stage definitions]
//
// Writes `<out>/sizing.json` and NOTHING else. `--stage definitions` runs
// no hypothesis at all: it prints the incumbent's reproduction, H1's target,
// the filters' coverage and H1's placebo donors — the numbers the
// pre-registration needed before any arm ran — and writes nothing.
//
// ── the incumbent ─────────────────────────────────────────────────────
//
// `trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots,
// seeded parameters, Revolut X's costs (the touch plus 9 bps taker), on the
// four windows `backtest_windows.ts` cuts and under the four evaluations
// §3.19 requires (Coinbase-spliced tape and Kraken's own 4h tape × the
// shipped 8 % floor and the retired 3×ATR(14) intra-bar trail). It is the
// rule arm of `backtest_jev.ts`'s measured study, rebuilt from that file's
// own exported machinery, and it must equal `set2.json`'s `equal` row on
// every evaluation and window before anything else runs.
//
// ── the three hypotheses (the pre-registration's definitions) ─────────
//
//   H1  volatility-targeted entries. Each entry deploys
//       min(1, TARGET / vol) of the slot's cash; the rest waits in cash for
//       the trade to close. `vol` is `realisedVol` — the rulebook's own
//       function — over the last 30 daily log returns of the evaluated
//       tape's COMPLETED daily candles at the decision (the rule `run`
//       applies to daily candles), annualised with 365. TARGET is one
//       number: the median of that same measure pooled over the five coins
//       and every day of window A's in-sample span (each coin's Coinbase
//       series from its first day), cut at the earliest window-A start among
//       the five. Revolut X's minimum order ($0.10, reference §4 item 19) is
//       checked on every entry.
//   H2  a DVOL entry filter. An entry is refused while the Deribit DVOL
//       (BTC's; ETH's for ETH) of the last COMPLETED UTC day is strictly
//       above the 244th of the 365 daily closes ending on that day — the top
//       third. The rulebook asks again next bar, as it does today.
//   H3  a funding entry filter. An entry is refused while the coin's Binance
//       perpetual funding, summed per UTC day and averaged over the last
//       seven completed days, is strictly above the 292nd of the 365 such
//       averages ending on that day — the top fifth.
//
// ── the nulls ─────────────────────────────────────────────────────────
//
//   H1  a PLACEBO volatility: the same sizing driven by the same coin's
//       volatility 365–730 days earlier (another coin's when the coin's own
//       history cannot reach a year back over the whole window), a fresh
//       donor and shift per coin per draw, 2,000 draws. A second null is
//       reported and never decides: the arm's own multipliers permuted among
//       the coin's entries, which keeps the amount of scaling exactly and
//       destroys only its timing.
//   H2, H3  a random refusal of the SAME NUMBER of entries: whole breakout
//       episodes refused at random (`backtest_jev.ts`'s `episodeNullPolicy`,
//       imported), the refusal probability calibrated by bisection, and a
//       draw kept only when its entries over the window's coins equal the
//       arm's exactly. 1,000 kept draws per evaluation × window.
//
// ── the bar ───────────────────────────────────────────────────────────
//
// In EACH of the four evaluations, on the windows a hypothesis may be
// judged on: the arm's worst-window return must beat the incumbent's
// worst-window return, and the null must do as well or better on its own
// worst window in at most 5 % of draws (the arm above the null's 95th
// percentile). Pass only if all four evaluations pass. Return over drawdown
// (`score`) is reported beside it under the same test and never decides.
//
// ── what is imported and what is not ──────────────────────────────────
//
// `run`, `COSTS` come from `backtest.ts`; `realisedVol` and `DEFAULT_TREND`
// from the rulebook; the windows, both tapes, `runGated`, the flat-bar cache
// (`buildTrack` / `trackDecider`), the policies, the seeds, the sleeve
// arithmetic (`sleeveStatsOf`, `combine`, `dailyReturns`) and the summaries
// from `backtest_jev.ts`, which exports them for this. Nothing that fills,
// charges or stops is re-implemented.
//
// H1 needs one thing `runGated` cannot express — an entry that deploys less
// than the whole slot — and it is NOT a copy of the simulator. It is exact
// arithmetic on `runGated`'s own marks: every fee and spread is a fraction
// of the notional, and no decision, stop or cooldown reads the position's
// SIZE (`ruleFor` and the stops read only whether it is open, its average
// cost and its high-water mark), so a fractional entry takes the same trades
// and its slot equity is C′·(1 − f + f·E/C), with C and C′ the all-in and
// the scaled slot equity at the entry and E the all-in equity since.
// `fidelity.h1IdentityAtF1` proves the arithmetic returns the incumbent with
// f ≡ 1 on every cell; `fidelity.h1TradeProduct` recomputes every scaled
// slot's end equity as the product of its trades.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall clock is written. Every draw comes from `mulberry32` seeded by
// `seedOf(purpose, evaluation, window, coin, draw)`, so a re-run over the
// same inputs writes `sizing.json` byte for byte. `backtest.ts`, the
// rulebook and `backtest_jev.ts` are hashed at the start and the end and a
// run that straddles an edit throws; the DVOL and funding files are hashed
// into the output.

import { DEFAULT_TREND, realisedVol, type Candle } from "../_shared/agents_strategy.ts";
import { COSTS, run } from "./backtest.ts";
import {
  atLeast, BAR_HOURS, buildTrack, CONDITIONS, counting, dailyReturns, episodeNullPolicy, LIVE_CANDIDATE, loadMeasuredSeries,
  meanOf, mulberry32, PRIMARY, r3, r4, rulePolicy, runGated, score, seedOf, sleeveStatsOf, SLOT_USD, stopsOf, summarize,
  trackDecider, WIN_NAMES,
  type Condition, type Decide, type EntryPolicy, type GatedResult, type MeasuredSeries, type SleeveStats, type Tally,
  type Tape, type Track, type WinName,
} from "./backtest_jev.ts";

// ───────────────────────────────────────────────────────── the fixed numbers

const DAY_MS = 86400e3;
/** Revolut X `min_order_size_quote` for all five coins, read from the public pairs endpoint (reference §4, item 19). */
const VENUE_MIN_ORDER_USD = 0.10;
/** H1: thirty daily log returns, annualised with 365 (crypto trades every day). */
const VOL_DAYS = 30, DAYS_PER_YEAR = 365;
/** H1's placebo: the donor's volatility one to two years before the decision. */
const SHIFT_MIN_DAYS = 365, SHIFT_MAX_DAYS = 730;
/** H2 and H3: the trailing distribution, and the share at its top that switches a filter on. */
const TRAIL_DAYS = 365;
const DVOL_TOP = { num: 1, den: 3 };
const FUNDING_TOP = { num: 1, den: 5 };
const FUNDING_MEAN_DAYS = 7;
/** Draw counts. H1's nulls cost no simulation, so they get more draws than the filters'. */
/** Pre-registered: 2,000 and 1,000. `--h1-draws` / `--null-draws` exist for smoke runs only, and the output records what was used. */
const H1_DRAWS_DEFAULT = 2000, FILTER_NULL_DRAWS_DEFAULT = 1000, CAL_DRAWS = 100, CAL_ITERS = 10, MAX_ATTEMPTS = 50000;
const ALPHA = 0.05;
const HYPOTHESES = 3;
/** Which DVOL index gates which coin: ETH's for ETH, BTC's for the other four. */
const DVOL_INDEX: Record<string, "BTC" | "ETH"> = { "BTC/USD": "BTC", "ETH/USD": "ETH", "SOL/USD": "BTC", "AVAX/USD": "BTC", "SUI/USD": "BTC" };
const FUNDING_SYMBOL: Record<string, string> = { "BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT", "AVAX/USD": "AVAXUSDT", "SUI/USD": "SUIUSDT" };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoMin = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";

async function sha256(path: string | URL): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ───────────────────────────────────────────────────────────── daily inputs

/** The last UTC day that has CLOSED at decision time `T` — the same rule `run` applies to daily candles (start + 1 day ≤ T). */
function refDayStart(T: number): number {
  return Math.floor(T / DAY_MS) * DAY_MS - DAY_MS;
}
/** A 4h bar is decided at its close. */
const decisionTime = (t: Track, i: number) => t.bars[i].start + BAR_HOURS * 3600e3;

type DailyMap = Map<number, number>;

/** Deribit DVOL daily candles `[ts, open, high, low, close]`; the close is the index at the day's end. A day still forming when the file was fetched is dropped. */
function loadDvol(text: string): { maps: Record<"BTC" | "ETH", DailyMap>; provenance: Record<string, unknown> } {
  const j = JSON.parse(text) as { fetched_at: string } & Record<"BTC" | "ETH", { rows: number[][] }>;
  const fetchedAt = Date.parse(j.fetched_at);
  const maps = { BTC: new Map(), ETH: new Map() } as Record<"BTC" | "ETH", DailyMap>;
  const provenance: Record<string, unknown> = { fetchedAt: j.fetched_at };
  for (const k of ["BTC", "ETH"] as const) {
    let dropped = 0;
    for (const row of j[k].rows) {
      const [ts, , , , close] = row;
      if (ts % DAY_MS !== 0) throw new Error(`DVOL ${k}: a row at ${ts} is not a UTC day`);
      if (ts + DAY_MS > fetchedAt) { dropped++; continue; }
      if (maps[k].has(ts)) throw new Error(`DVOL ${k}: ${isoDay(ts)} twice`);
      maps[k].set(ts, close);
    }
    const days = [...maps[k].keys()].sort((a, b) => a - b);
    provenance[k] = { days: days.length, first: isoDay(days[0]), last: isoDay(days[days.length - 1]), droppedFormingDays: dropped };
  }
  return { maps, provenance };
}

/** Binance funding summed per UTC day: `{ data: { BTCUSDT: { "YYYY-MM-DD": [sum, prints] } } }`. */
function loadFunding(text: string): { maps: Record<string, DailyMap>; provenance: Record<string, unknown> } {
  const j = JSON.parse(text) as { source: string; note: string; data: Record<string, Record<string, [number, number]>> };
  const maps: Record<string, DailyMap> = {};
  const provenance: Record<string, unknown> = { source: j.source, note: j.note };
  for (const symbol of LIVE_CANDIDATE.symbols) {
    const rows = j.data[FUNDING_SYMBOL[symbol]];
    if (!rows) throw new Error(`funding: no ${FUNDING_SYMBOL[symbol]}`);
    const m: DailyMap = new Map();
    for (const [day, [sum]] of Object.entries(rows)) {
      const ts = Date.parse(`${day}T00:00:00Z`);
      if (!Number.isFinite(ts) || !Number.isFinite(sum)) throw new Error(`funding ${symbol}: bad row ${day}`);
      m.set(ts, sum);
    }
    const days = [...m.keys()].sort((a, b) => a - b);
    maps[symbol] = m;
    provenance[symbol] = { symbol: FUNDING_SYMBOL[symbol], days: days.length, first: isoDay(days[0]), last: isoDay(days[days.length - 1]) };
  }
  return { maps, provenance };
}

/** The mean of the `n` daily values ending on each day, where all `n` exist. */
function trailingMean(x: DailyMap, n: number): DailyMap {
  const out: DailyMap = new Map();
  for (const D of [...x.keys()].sort((a, b) => a - b)) {
    let s = 0, ok = true;
    for (let q = 0; q < n && ok; q++) { const v = x.get(D - q * DAY_MS); if (v == null) ok = false; else s += v; }
    if (ok) out.set(D, s / n);
  }
  return out;
}

/**
 * On for day D when X_D is STRICTLY above the k-th smallest of the `n` values
 * ending on D (D included), k = ⌈n·(den − num)/den⌉ — so at most ⌊n·num/den⌋
 * values can be on. Undefined where any of the `n` is missing. Ties are the
 * reason for "strictly": funding sits on its 0.01 %-a-print floor for weeks,
 * and a floor that ties with the threshold is not "in the top fifth".
 */
function topShareFilter(x: DailyMap, n: number, top: { num: number; den: number }): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const k = Math.ceil((n * (top.den - top.num)) / top.den);
  for (const D of [...x.keys()].sort((a, b) => a - b)) {
    const vals: number[] = [];
    for (let q = 0; q < n; q++) { const v = x.get(D - q * DAY_MS); if (v == null) break; vals.push(v); }
    if (vals.length < n) continue;
    vals.sort((a, b) => a - b);
    out.set(D, x.get(D)! > vals[k - 1]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────── H1: volatility

type VolBook = { starts: number[]; vol: (number | null)[]; firstDefinedT: number };
/** `realisedVol` at every daily candle; `firstDefinedT` is the first decision time at which a value exists. */
function volBook(daily: Candle[]): VolBook {
  const closes = daily.map((c) => c.close);
  const vol = daily.map((_, j) => realisedVol(closes, j, VOL_DAYS, DAYS_PER_YEAR));
  const j0 = vol.findIndex((v) => v != null);
  if (j0 < 0) throw new Error("a daily series too short for a 30-day volatility");
  return { starts: daily.map((c) => c.start), vol, firstDefinedT: daily[j0].start + DAY_MS };
}
/** The volatility known at `T`: the last daily candle that has closed (start + 1 day ≤ T). */
function volAt(b: VolBook, T: number): number | null {
  let lo = 0, hi = b.starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b.starts[mid] + DAY_MS <= T) lo = mid + 1; else hi = mid; }
  return lo > 0 ? b.vol[lo - 1] : null;
}

// ─────────────────────────────────────────────────────────── running arms

/** One coin's run, with what H1's arithmetic needs: the bars it entered on and whether it was long after each bar. */
type CoinRun = { symbol: string; t: Track; g: GatedResult; entryBars: number[]; longAt: Uint8Array; refused: number; signals: number };

function runCoin(t: Track, cond: Condition, policy: EntryPolicy): CoinRun {
  const tally: Tally = { signals: 0, refused: 0, coinFlip: 0, coinFlipRefused: 0 };
  const log = new Map<number, "enter" | "hold">();
  const d = trackDecider(t, counting(policy, tally, log));
  const nMarks = Math.max(0, t.to - 1 - t.start);
  const longAt = new Uint8Array(nMarks);
  // `runGated` hands each decision the position as the previous bar left it, so the call at bar i says whether the
  // mark written for bar i − 1 was long. The last mark is read from the legs: an odd count leaves a trade open.
  const wrapped: Decide = (i, pos, coolingDown) => {
    if (i > t.start) longAt[i - 1 - t.start] = pos.base > 0 ? 1 : 0;
    return d(i, pos, coolingDown);
  };
  const g = runGated(t.symbol, t.bars, t.from, t.to, t.warmup, wrapped, COSTS.revx, stopsOf(cond.stopRule, t.p));
  if (g.marks.length !== nMarks) throw new Error(`${t.symbol}: ${g.marks.length} marks, expected ${nMarks}`);
  if (nMarks > 0) longAt[nMarks - 1] = g.tradedWeight % 2 === 1 ? 1 : 0;
  const entryBars = [...log.entries()].filter(([, a]) => a === "enter").map(([i]) => i).sort((a, b) => a - b);
  if (entryBars.length !== g.entries) throw new Error(`${t.symbol}: ${entryBars.length} entries let through, ${g.entries} taken`);
  for (const e of entryBars) if (!longAt[e - t.start]) throw new Error(`${t.symbol}: not long after its entry at bar ${e}`);
  for (let j = 1; j < nMarks; j++) {
    if (!longAt[j] && !longAt[j - 1] && g.marks[j][1] !== g.marks[j - 1][1]) throw new Error(`${t.symbol}: equity moved on a flat bar (${j})`);
  }
  return { symbol: t.symbol, t, g, entryBars, longAt, refused: tally.refused, signals: tally.signals };
}

/**
 * H1's arithmetic on a run's own marks (the header says why it is exact). `f[k]` is the share of the slot's cash
 * the k-th entry deploys. Returns the scaled run in `GatedResult`'s shape, so the sleeve goes through the imported
 * `sleeveStatsOf` unchanged, plus the scaled slot's idle share, the smallest order it placed and a second
 * computation of its end equity as the product of its trades.
 */
type Scaled = { g: GatedResult; idleShare: number; meanF: number; minOrderUsd: number; belowMin: number; productAbsDiff: number };
function scaleCoin(r: CoinRun, f: ArrayLike<number>): Scaled {
  const { g, entryBars, longAt, t } = r;
  if (f.length !== entryBars.length) throw new Error(`${r.symbol}: ${f.length} multipliers for ${entryBars.length} entries`);
  const n = g.marks.length;
  const marks: [number, number][] = new Array(n);
  let e = 0, C = 1, Cp = 1, fk = 1, started = false;
  let prevEq = 1, prevEqP = 1, peak = 1, maxDD = 0, idle = 0, longW = 0, minOrder = Infinity, belowMin = 0;
  const factors: number[] = [];
  for (let j = 0; j < n; j++) {
    const i = t.start + j;
    if (e < entryBars.length && entryBars[e] === i) {
      if (started) factors.push(1 - fk + (fk * prevEq) / C);
      C = prevEq; Cp = prevEqP; fk = f[e]; started = true;
      const orderUsd = SLOT_USD * Cp * fk;
      minOrder = Math.min(minOrder, orderUsd);
      if (orderUsd < VENUE_MIN_ORDER_USD) belowMin++;
      e++;
    }
    const eq = g.marks[j][1];
    if (!started && eq !== 1) throw new Error(`${r.symbol}: equity moved before the first entry`);
    const eqP = started ? Cp * (1 - fk + (fk * eq) / C) : eq;
    const open = longAt[j] ? (fk * Cp * eq) / C : 0;
    marks[j] = [g.marks[j][0], eqP];
    peak = Math.max(peak, eqP); maxDD = Math.max(maxDD, 1 - eqP / peak);
    idle += (eqP - open) / eqP;
    if (longAt[j]) longW += fk;
    prevEq = eq; prevEqP = eqP;
  }
  if (started) factors.push(1 - fk + (fk * prevEq) / C);
  const eqEnd = n ? marks[n - 1][1] : 1;
  const product = factors.reduce((a, b) => a * b, 1);
  let legs = 0;
  for (let k = 0; k < entryBars.length; k++) {
    legs += f[k];
    if (k < entryBars.length - 1 || g.tradedWeight % 2 === 0) legs += f[k];   // closed: an exit leg as well
  }
  return {
    g: { ...g, marks, equity: marks, ret: eqEnd - 1, maxDD, exposure: longW / Math.max(1, t.to - t.from), tradedWeight: legs },
    idleShare: n ? idle / n : 1, meanF: f.length ? meanOf(f) : NaN, minOrderUsd: minOrder, belowMin, productAbsDiff: Math.abs(product - eqEnd),
  };
}

/**
 * The sleeve's daily returns by `combine`'s own arithmetic — `combine` does not return them, and Sharpe needs
 * them. The loop must land on `combine`'s return and drawdown to the digit it rounds to, or the run throws.
 */
function sleeveSharpe(per: Record<string, GatedResult>, stats: SleeveStats, tally: { checks: number }): number | null {
  const sl = Object.values(per).map((g) => dailyReturns(g.marks));
  const capital = SLOT_USD * sl.length;
  const days = [...new Set(sl.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  let eq = capital, peak = capital, maxDD = 0;
  const rets: number[] = [];
  for (const d of days) {
    let pnl = 0;
    for (const m of sl) pnl += SLOT_USD * (m.get(d) ?? 0);
    rets.push(pnl / eq);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
  }
  tally.checks++;
  if (r4((eq - capital) / capital) !== stats.ret || r4(maxDD) !== stats.maxDD) {
    throw new Error(`the daily loop is not combine's: ret ${(eq - capital) / capital} vs ${stats.ret}, maxDD ${maxDD} vs ${stats.maxDD}`);
  }
  if (rets.length < 2) return null;
  const mu = meanOf(rets);
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mu) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? r3((mu / sd) * Math.sqrt(DAYS_PER_YEAR)) : null;
}

/** Share of `nulls` whose worst window is at least the arm's — ties count against the arm (`atLeast`). */
function worstPerDraw(perWindow: Float64Array[]): Float64Array {
  const n = Math.min(...perWindow.map((x) => x.length));
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = Math.min(...perWindow.map((x) => x[k]));
  return out;
}

// ───────────────────────────────────────────────────────────────── the run

async function main(args: Record<string, string>): Promise<void> {
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const dvolPath = String(args.dvol ?? ""), fundingPath = String(args.funding ?? "");
  const set2Path = String(args.set2 ?? "docs/agents/backtests/set2.json");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const stage = String(args.stage ?? "full");
  const H1_DRAWS = Number(args["h1-draws"] ?? H1_DRAWS_DEFAULT), FILTER_NULL_DRAWS = Number(args["null-draws"] ?? FILTER_NULL_DRAWS_DEFAULT);
  if (!(H1_DRAWS >= 10 && FILTER_NULL_DRAWS >= 10)) throw new Error("--h1-draws and --null-draws must be at least 10");
  const preregisteredDraws = H1_DRAWS === H1_DRAWS_DEFAULT && FILTER_NULL_DRAWS === FILTER_NULL_DRAWS_DEFAULT;
  if (!dataDir || !extDir || !kDir || !dvolPath || !fundingPath) throw new Error("needs --data, --ext, --ktape, --dvol and --funding (see the header)");
  if (stage !== "full" && stage !== "definitions") throw new Error(`--stage ${stage}: expected full or definitions`);

  const srcUrls = {
    backtestTs: new URL("./backtest.ts", import.meta.url),
    agentsStrategyTs: new URL("../_shared/agents_strategy.ts", import.meta.url),
    backtestJevTs: new URL("./backtest_jev.ts", import.meta.url),
  };
  const hashSources = async () => ({
    backtestTs: await sha256(srcUrls.backtestTs), agentsStrategyTs: await sha256(srcUrls.agentsStrategyTs), backtestJevTs: await sha256(srcUrls.backtestJevTs),
  });
  const hashesStart = await hashSources();
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

  // ── data: the measured study's tapes and windows, by import ─────────
  const { series, dataRows, symbols } = await loadMeasuredSeries(dataDir, extDir, kDir);
  const priced = (tape: Tape, w: WinName) => symbols.filter((s) => series[s].oos[tape][w] != null);
  const scoredWindows = (cond: Condition) => WIN_NAMES.filter((w) => priced(cond.tape, w).length > 0);
  const barsOf = (s: MeasuredSeries, tape: Tape) => tape === "coinbase" ? { bars: s.comb4h, daily: s.combDaily } : { bars: s.kTape, daily: s.kDaily };
  const trackCache = new Map<string, Track>();
  const track = (tape: Tape, symbol: string, w: WinName): Track => {
    const key = `${tape}|${symbol}|${w}`;
    let t = trackCache.get(key);
    if (!t) {
      const s = series[symbol], span = s.oos[tape][w];
      if (!span) throw new Error(`${symbol} ${w} is not priced on the ${tape} tape`);
      const { bars, daily } = barsOf(s, tape);
      t = buildTrack(symbol, bars, daily, DEFAULT_TREND, span.from, span.to);
      trackCache.set(key, t);
    }
    return t;
  };
  say(`data: ${symbols.join(" ")} | coinbase ${WIN_NAMES.map((w) => `${w}${priced("coinbase", w).length}`).join(" ")} | kraken ${WIN_NAMES.map((w) => `${w}${priced("kraken", w).length}`).join(" ")}`);

  const dvolText = await Deno.readTextFile(dvolPath), fundingText = await Deno.readTextFile(fundingPath);
  const inputsHash = { dvolJson: await sha256(dvolPath), fundingJson: await sha256(fundingPath), set2Json: await sha256(set2Path) };
  const dvol = loadDvol(dvolText), funding = loadFunding(fundingText);

  type ArmRun = { per: Record<string, CoinRun>; stats: SleeveStats; entries: number; refused: number; signals: number };
  type PolicyAt = (symbol: string, t: Track) => EntryPolicy;
  const runArm = (cond: Condition, w: WinName, policyAt: PolicyAt): ArmRun => {
    const per: Record<string, CoinRun> = {};
    let entries = 0, refused = 0, signals = 0;
    for (const s of priced(cond.tape, w)) {
      const t = track(cond.tape, s, w);
      const r = runCoin(t, cond, policyAt(s, t));
      per[s] = r; entries += r.g.entries; refused += r.refused; signals += r.signals;
    }
    const stats = sleeveStatsOf(Object.fromEntries(Object.entries(per).map(([s, r]) => [s, r.g])));
    return { per, stats, entries, refused, signals };
  };
  /** A null's run: the sleeve and its entries, nothing else. */
  const runLight = (cond: Condition, w: WinName, policyAt: PolicyAt): { ret: number; maxDD: number; entries: number } => {
    const per: Record<string, GatedResult> = {};
    let entries = 0;
    for (const s of priced(cond.tape, w)) {
      const t = track(cond.tape, s, w);
      const g = runGated(s, t.bars, t.from, t.to, t.warmup, trackDecider(t, policyAt(s, t)), COSTS.revx, stopsOf(cond.stopRule, t.p));
      per[s] = g; entries += g.entries;
    }
    const st = sleeveStatsOf(per);
    return { ret: st.ret, maxDD: st.maxDD, entries };
  };
  const sharpeTally = { checks: 0 };
  const idleOf = (per: Record<string, CoinRun>) => meanOf(Object.values(per).map((r) => r.longAt.length ? 1 - meanOf(r.longAt) : 1));
  const rowOf = (stats: SleeveStats, sharpe: number | null, idleShare: number) => ({
    ret: stats.ret, maxDD: stats.maxDD, retOverDD: stats.retOverDD, sharpe, avgIdleShare: r3(idleShare), avgIdleUsd: r4(idleShare * stats.capitalUsd),
    capitalUsd: stats.capitalUsd, deployment: stats.deployment, turnoverPerYear: stats.turnoverPerYear, from: stats.from, to: stats.to,
  });

  // ── the incumbent, and the reproduction ───────────────────────────────
  const inc: Record<string, Partial<Record<WinName, ArmRun>>> = {};
  for (const cond of CONDITIONS) {
    inc[cond.id] = {};
    for (const w of scoredWindows(cond)) inc[cond.id][w] = runArm(cond, w, () => rulePolicy);
  }
  // `runGated` through the cache against `run`, every coin × window × evaluation.
  let runChecks = 0, runMismatches = 0;
  for (const cond of CONDITIONS) for (const w of scoredWindows(cond)) for (const [s, r] of Object.entries(inc[cond.id][w]!.per)) {
    const t = r.t;
    const rr = run("trend-4h", s, t.bars, t.daily, t.from, t.to, t.p, COSTS.revx, BAR_HOURS, stopsOf(cond.stopRule, t.p));
    runChecks++;
    if (rr.ret !== r.g.ret || rr.maxDD !== r.g.maxDD || rr.trades !== r.g.trades || rr.exposure !== r.g.exposure) runMismatches++;
  }
  if (runMismatches) throw new Error(`runGated is not run on ${runMismatches} of ${runChecks} cells`);
  const PUBLISHED: Record<WinName, { ret: number; maxDD: number }> = {
    A: { ret: 0.0803, maxDD: 0.1128 }, B: { ret: 0.2008, maxDD: 0.1047 }, C: { ret: 0.5564, maxDD: 0.0735 }, D: { ret: -0.0781, maxDD: 0.1552 },
  };
  type Set2Rows = Record<string, { perWindow: Record<string, { ret: number; maxDD: number; members: number }> }>;
  const s2 = JSON.parse(await Deno.readTextFile(set2Path)) as { a2_theWeights: { rows: { arm: string; perCondition: Set2Rows }[] } };
  const set2Equal = s2.a2_theWeights.rows.find((r) => r.arm === "equal")?.perCondition;
  if (!set2Equal) throw new Error("set2.json has no `equal` row");
  let reproWorst = 0;
  const reproduction: Record<string, unknown> = {};
  for (const cond of CONDITIONS) {
    const perW: Record<string, unknown> = {};
    for (const w of scoredWindows(cond)) {
      const st = inc[cond.id][w]!.stats, ref = set2Equal[cond.id]?.perWindow?.[w];
      if (!ref) throw new Error(`set2.json has no ${cond.id} ${w}`);
      const pub = cond.id === PRIMARY.id ? PUBLISHED[w] : null;
      reproWorst = Math.max(reproWorst, Math.abs(st.ret - ref.ret), Math.abs(st.maxDD - ref.maxDD), st.members !== ref.members ? 1 : 0);
      if (pub) reproWorst = Math.max(reproWorst, Math.abs(st.ret - pub.ret), Math.abs(st.maxDD - pub.maxDD));
      perW[w] = { here: { ret: st.ret, maxDD: st.maxDD, members: st.members }, set2: { ret: ref.ret, maxDD: ref.maxDD, members: ref.members }, published: pub };
    }
    reproduction[cond.id] = perW;
  }
  say(`incumbent: runGated ≡ run on ${runChecks} cells | against set2.json's equal row (all four evaluations) and the published sleeve: worst |Δ| ${reproWorst}`);
  for (const cond of CONDITIONS) say(`  ${cond.id}: ${scoredWindows(cond).map((w) => `${w} ${(inc[cond.id][w]!.stats.ret * 100).toFixed(2)}% (DD ${(inc[cond.id][w]!.stats.maxDD * 100).toFixed(2)}%)`).join(" | ")}`);
  if (reproWorst !== 0) throw new Error(`the incumbent does not reproduce: worst |Δ| ${reproWorst}`);

  // ── H1's target: one number, from window A's in-sample span ───────────
  const winA = Object.fromEntries(symbols.map((s) => {
    const a = series[s].wins.find((x) => x.name === "A" && x.scored);
    if (!a) throw new Error(`${s} has no scored window A`);
    return [s, { oosStart: series[s].comb4h[a.oosFrom].start, cbStart: series[s].cb4h[0].start }];
  }));
  const cutoff = Math.min(...symbols.map((s) => winA[s].oosStart));
  const volBooks: Record<Tape, Record<string, VolBook>> = { coinbase: {}, kraken: {} };
  for (const s of symbols) { volBooks.coinbase[s] = volBook(series[s].combDaily); volBooks.kraken[s] = volBook(series[s].kDaily); }
  const pooled: number[] = [];
  const perCoinMedian: Record<string, unknown> = {};
  for (const s of symbols) {
    const b = volBooks.coinbase[s], firstDay = Math.floor(winA[s].cbStart / DAY_MS) * DAY_MS;
    const vs: number[] = [];
    b.starts.forEach((st, j) => { const v = b.vol[j]; if (st >= firstDay && st + DAY_MS <= cutoff && v != null) vs.push(v); });
    vs.sort((a, c) => a - c);
    perCoinMedian[s] = { days: vs.length, from: isoDay(firstDay), median: r4(vs[Math.floor((vs.length - 1) / 2)] / 2 + vs[Math.ceil((vs.length - 1) / 2)] / 2) };
    pooled.push(...vs);
  }
  pooled.sort((a, b) => a - b);
  const TARGET = pooled.length % 2 ? pooled[(pooled.length - 1) / 2] : (pooled[pooled.length / 2 - 1] + pooled[pooled.length / 2]) / 2;
  const targetBlock = {
    value: TARGET, rounded: r4(TARGET), pooledCoinDays: pooled.length, lastDayUsed: isoDay(cutoff - DAY_MS), cutoffIsEarliestWindowAStart: isoMin(cutoff),
    perCoin: perCoinMedian,
    rule: "median of realisedVol(daily closes, 30, 365) on the Coinbase-spliced tape, pooled over the five coins and every UTC day from each coin's Coinbase series start to the day before the earliest window-A out-of-sample start among the five",
  };
  say(`H1 target: ${(TARGET * 100).toFixed(2)} % annualised (median of ${pooled.length} coin-days, ${Object.values(perCoinMedian).map((x) => (x as { from: string }).from).join("/")} → ${isoDay(cutoff - DAY_MS)})`);

  // ── H2 / H3: the filters, and which windows they cover ─────────────────
  const dvolFilter = { BTC: topShareFilter(dvol.maps.BTC, TRAIL_DAYS, DVOL_TOP), ETH: topShareFilter(dvol.maps.ETH, TRAIL_DAYS, DVOL_TOP) };
  const fundingMean: Record<string, DailyMap> = {}, fundingFilter: Record<string, Map<number, boolean>> = {};
  for (const s of symbols) { fundingMean[s] = trailingMean(funding.maps[s], FUNDING_MEAN_DAYS); fundingFilter[s] = topShareFilter(fundingMean[s], TRAIL_DAYS, FUNDING_TOP); }
  const filterFor = (h: "h2" | "h3", symbol: string) => h === "h2" ? dvolFilter[DVOL_INDEX[symbol]] : fundingFilter[symbol];
  const span = (m: Map<number, boolean>) => { const ks = [...m.keys()].sort((a, b) => a - b); return { firstDay: isoDay(ks[0]), lastDay: isoDay(ks[ks.length - 1]), days: ks.length }; };
  const coverage: Record<"h2" | "h3", { perWindow: Record<string, unknown>; counted: WinName[] }> = { h2: { perWindow: {}, counted: [] }, h3: { perWindow: {}, counted: [] } };
  for (const h of ["h2", "h3"] as const) {
    for (const w of WIN_NAMES) {
      const perCoin: Record<string, unknown> = {};
      let covered = true, any = false;
      for (const tape of ["coinbase", "kraken"] as Tape[]) for (const s of priced(tape, w)) {
        any = true;
        const t = track(tape, s, w), m = filterFor(h, s);
        let missing = 0, firstMissing = "";
        for (let i = t.start; i < t.to - 1; i++) {
          const D = refDayStart(decisionTime(t, i));
          if (!m.has(D)) { missing++; if (!firstMissing) firstMissing = isoDay(D); }
        }
        if (missing) covered = false;
        perCoin[`${tape}·${s}`] = { decisions: t.to - 1 - t.start, firstReferenceDay: isoDay(refDayStart(decisionTime(t, t.start))), lastReferenceDay: isoDay(refDayStart(decisionTime(t, t.to - 2))), uncovered: missing, firstUncovered: firstMissing || null };
      }
      coverage[h].perWindow[w] = { covered: any && covered, perCoin };
      if (any && covered) coverage[h].counted.push(w);
    }
  }
  const filterSpans = {
    h2: { BTC: span(dvolFilter.BTC), ETH: span(dvolFilter.ETH) },
    h3: Object.fromEntries(symbols.map((s) => [s, span(fundingFilter[s])])),
  };
  say(`coverage: H2 (DVOL) counts ${coverage.h2.counted.join("") || "nothing"} — filter defined ${filterSpans.h2.BTC.firstDay}…${filterSpans.h2.BTC.lastDay} | H3 (funding) counts ${coverage.h3.counted.join("") || "nothing"} — ${symbols.map((s) => `${s.split("/")[0]} ${filterSpans.h3[s].firstDay}…${filterSpans.h3[s].lastDay}`).join(", ")}`);
  for (const h of ["h2", "h3"] as const) for (const w of WIN_NAMES) {
    const pw = coverage[h].perWindow[w] as { covered: boolean; perCoin: Record<string, { firstReferenceDay: string; lastReferenceDay: string; uncovered: number; firstUncovered: string | null }> };
    say(`  ${h} ${w}: ${pw.covered ? "covered" : "NOT covered"} — ${Object.entries(pw.perCoin).map(([k, v]) => `${k} ${v.firstReferenceDay}…${v.lastReferenceDay}${v.uncovered ? ` (${v.uncovered} uncovered from ${v.firstUncovered})` : ""}`).join("; ")}`);
  }

  // ── H1's placebo donors: how far back each coin's own history reaches ─
  const firstT = (t: Track) => decisionTime(t, t.start);
  const sMax = (tape: Tape, donor: string, T: number) => Math.floor((T - volBooks[tape][donor].firstDefinedT) / DAY_MS);
  const donorsFor = (tape: Tape, symbol: string, w: WinName): string[] => {
    const T = firstT(track(tape, symbol, w));
    if (sMax(tape, symbol, T) >= SHIFT_MIN_DAYS) return [symbol];
    return symbols.filter((c) => c !== symbol && sMax(tape, c, T) >= SHIFT_MIN_DAYS);
  };
  const donorTable: Record<string, unknown> = {};
  for (const tape of ["coinbase", "kraken"] as Tape[]) for (const w of WIN_NAMES) for (const s of priced(tape, w)) {
    const T = firstT(track(tape, s, w));
    const ds = donorsFor(tape, s, w);
    if (!ds.length) throw new Error(`${tape} ${w} ${s}: no donor reaches a year back`);
    donorTable[`${tape}·${w}·${s}`] = { firstDecision: isoMin(T), ownHistoryDays: sMax(tape, s, T), donors: ds.map((d) => ({ donor: d, shiftDays: [SHIFT_MIN_DAYS, Math.min(SHIFT_MAX_DAYS, sMax(tape, d, T))] })) };
  }
  say(`H1 target per coin (context only): ${Object.entries(perCoinMedian).map(([s, v]) => `${s.split("/")[0]} median ${((v as { median: number }).median * 100).toFixed(1)} % over ${(v as { days: number }).days} days`).join(", ")}`);
  say(`H1 placebo: own history short of a year on ${Object.entries(donorTable).filter(([, v]) => (v as { ownHistoryDays: number }).ownHistoryDays < SHIFT_MIN_DAYS).map(([k]) => k).join(", ") || "no cell"}`);
  for (const [k, v] of Object.entries(donorTable)) {
    const d = v as { ownHistoryDays: number; donors: { donor: string; shiftDays: number[] }[] };
    say(`  ${k}: own history ${d.ownHistoryDays} d → ${d.donors.map((x) => `${x.donor.split("/")[0]} ${x.shiftDays[0]}–${x.shiftDays[1]} d`).join(", ")}`);
  }
  say(`venue minimum order: $${VENUE_MIN_ORDER_USD.toFixed(2)} on all five coins`);

  if (stage === "definitions") {
    say("definitions stage: no hypothesis was run and nothing was written");
    return;
  }

  // ══════════════════════════════════════════════════════════ the arms
  const incRow: Record<string, Record<string, unknown>> = {};
  const incStats = (cond: Condition, w: WinName) => inc[cond.id][w]!.stats;
  for (const cond of CONDITIONS) {
    incRow[cond.id] = {};
    for (const w of scoredWindows(cond)) {
      const a = inc[cond.id][w]!;
      incRow[cond.id][w] = { ...rowOf(a.stats, sleeveSharpe(Object.fromEntries(Object.entries(a.per).map(([s, r]) => [s, r.g])), a.stats, sharpeTally), idleOf(a.per)), entries: a.entries };
    }
  }

  /** The verdict in one evaluation: worst window against the incumbent's, and against the null's worst, on return and on `score`. */
  const verdictOf = (cond: Condition, ws: WinName[], arm: Record<string, { ret: number; maxDD: number }>, nullRet: Record<string, Float64Array>, nullDD: Record<string, Float64Array>) => {
    const worst = (f: (w: WinName) => number) => { let wn = ws[0], v = Infinity; for (const w of ws) { const x = f(w); if (x < v) { v = x; wn = w; } } return { window: wn, value: v }; };
    const incW = worst((w) => incStats(cond, w).ret), armW = worst((w) => arm[w].ret);
    const nw = worstPerDraw(ws.map((w) => nullRet[w]));
    const incS = worst((w) => score(incStats(cond, w))), armS = worst((w) => score(arm[w]));
    const nws = worstPerDraw(ws.map((w) => { const r = nullRet[w], d = nullDD[w]; const o = new Float64Array(r.length); for (let k = 0; k < r.length; k++) o[k] = score({ ret: r[k], maxDD: d[k] }); return o; }));
    const pNull = atLeast(nw, armW.value), pNullS = atLeast(nws, armS.value);
    return {
      windows: ws,
      onReturn: {
        incumbentWorst: { window: incW.window, ret: r4(incW.value) }, armWorst: { window: armW.window, ret: r4(armW.value) },
        nullWorst: summarize(nw), beatsIncumbentWorst: armW.value > incW.value, pNullWorstAtLeastArmWorst: r3(pNull), beatsNull: pNull <= ALPHA,
      },
      onRetOverDD: {
        incumbentWorst: { window: incS.window, score: r3(incS.value) }, armWorst: { window: armS.window, score: r3(armS.value) },
        nullWorstP95: r3(summarize(nws).p95), beatsIncumbentWorst: armS.value > incS.value, pNullWorstAtLeastArmWorst: r3(pNullS), beatsNull: pNullS <= ALPHA,
      },
      passes: armW.value > incW.value && pNull <= ALPHA,
    };
  };
  const nullRow = (rets: Float64Array, armRet: number) => ({ ret: summarize(rets), pNullAtLeastArm: r3(atLeast(rets, armRet)) });

  // ── H1 ────────────────────────────────────────────────────────────────
  const fidelityH1 = { cells: 0, maxAbsMarkDiffAtF1: 0, sleeveMismatchesAtF1: 0, productChecks: 0, maxProductAbsDiff: 0 };
  const h1: Record<string, unknown> = {};
  let h1BelowMin = 0, h1MinOrder = Infinity;
  const h1Verdicts: Record<string, ReturnType<typeof verdictOf>> = {};
  const h1PermVerdicts: Record<string, ReturnType<typeof verdictOf>> = {};
  for (const cond of CONDITIONS) {
    const ws = scoredWindows(cond);
    const armStats: Record<string, SleeveStats> = {};
    const perWindow: Record<string, unknown> = {};
    const nullRet: Record<string, Float64Array> = {}, nullDD: Record<string, Float64Array> = {};
    const permRet: Record<string, Float64Array> = {}, permDD: Record<string, Float64Array> = {};
    for (const w of ws) {
      const base = inc[cond.id][w]!;
      // The identity: f ≡ 1 must give back the incumbent.
      const ones: Record<string, GatedResult> = {};
      for (const [s, r] of Object.entries(base.per)) {
        const sc = scaleCoin(r, new Float64Array(r.entryBars.length).fill(1));
        fidelityH1.cells++;
        for (let j = 0; j < sc.g.marks.length; j++) fidelityH1.maxAbsMarkDiffAtF1 = Math.max(fidelityH1.maxAbsMarkDiffAtF1, Math.abs(sc.g.marks[j][1] - r.g.marks[j][1]));
        ones[s] = sc.g;
      }
      const oneStats = sleeveStatsOf(ones);
      if (oneStats.ret !== base.stats.ret || oneStats.maxDD !== base.stats.maxDD) fidelityH1.sleeveMismatchesAtF1++;
      // The arm.
      const arm: Record<string, GatedResult> = {};
      const fArm: Record<string, Float64Array> = {};
      let idle = 0, fAll: number[] = [];
      for (const [s, r] of Object.entries(base.per)) {
        const vb = volBooks[cond.tape][s];
        const f = Float64Array.from(r.entryBars.map((i) => { const v = volAt(vb, decisionTime(r.t, i)); if (v == null) throw new Error(`${s}: no volatility at bar ${i}`); return Math.min(1, TARGET / v); }));
        const sc = scaleCoin(r, f);
        fidelityH1.productChecks++; fidelityH1.maxProductAbsDiff = Math.max(fidelityH1.maxProductAbsDiff, sc.productAbsDiff);
        h1BelowMin += sc.belowMin; if (r.entryBars.length) h1MinOrder = Math.min(h1MinOrder, sc.minOrderUsd);
        arm[s] = sc.g; fArm[s] = f; idle += sc.idleShare; fAll = fAll.concat([...f]);
      }
      if (h1BelowMin) throw new Error(`${h1BelowMin} H1 entries fall under the venue minimum; skipping them changes the path, which this arithmetic cannot price`);
      const st = sleeveStatsOf(arm);
      armStats[w] = st;
      // The placebo null and the permutation null.
      const nr = new Float64Array(H1_DRAWS), nd = new Float64Array(H1_DRAWS), pr = new Float64Array(H1_DRAWS), pd = new Float64Array(H1_DRAWS);
      const meanFNull = new Float64Array(H1_DRAWS);
      for (let k = 0; k < H1_DRAWS; k++) {
        const per: Record<string, GatedResult> = {}, perP: Record<string, GatedResult> = {};
        let fSum = 0, fN = 0;
        for (const [s, r] of Object.entries(base.per)) {
          const rng = mulberry32(seedOf("h1-placebo", cond.id, w, s, k));
          const ds = donorsFor(cond.tape, s, w);
          const donor = ds[Math.floor(rng() * ds.length)];
          const hi = Math.min(SHIFT_MAX_DAYS, sMax(cond.tape, donor, firstT(r.t)));
          const shift = SHIFT_MIN_DAYS + Math.floor(rng() * (hi - SHIFT_MIN_DAYS + 1));
          const vb = volBooks[cond.tape][donor];
          const f = Float64Array.from(r.entryBars.map((i) => { const v = volAt(vb, decisionTime(r.t, i) - shift * DAY_MS); if (v == null) throw new Error(`placebo ${donor}: no volatility ${shift} days before bar ${i}`); return Math.min(1, TARGET / v); }));
          const sc = scaleCoin(r, f);
          if (sc.belowMin) throw new Error("a placebo entry falls under the venue minimum");
          per[s] = sc.g; for (const x of f) { fSum += x; fN++; }
          const rngP = mulberry32(seedOf("h1-perm", cond.id, w, s, k));
          const fp = Float64Array.from(fArm[s]);
          for (let q = fp.length - 1; q > 0; q--) { const z = Math.floor(rngP() * (q + 1)); const tmp = fp[q]; fp[q] = fp[z]; fp[z] = tmp; }
          perP[s] = scaleCoin(r, fp).g;
        }
        const a = sleeveStatsOf(per), b = sleeveStatsOf(perP);
        nr[k] = a.ret; nd[k] = a.maxDD; pr[k] = b.ret; pd[k] = b.maxDD; meanFNull[k] = fN ? fSum / fN : NaN;
      }
      nullRet[w] = nr; nullDD[w] = nd; permRet[w] = pr; permDD[w] = pd;
      perWindow[w] = {
        incumbent: incRow[cond.id][w],
        arm: { ...rowOf(st, sleeveSharpe(arm, st, sharpeTally), idle / Object.keys(arm).length), entries: base.entries, entriesBelowVenueMinimum: 0, meanMultiplier: r3(meanOf(fAll)), minMultiplier: fAll.length ? r3(Math.min(...fAll)) : null, entriesScaled: fAll.filter((x) => x < 1).length },
        placeboNull: { ...nullRow(nr, st.ret), meanMultiplier: r3(meanOf(meanFNull)) },
        permutationNull: nullRow(pr, st.ret),
      };
    }
    const armFor = Object.fromEntries(ws.map((w) => [w, armStats[w]]));
    h1Verdicts[cond.id] = verdictOf(cond, ws, armFor, nullRet, nullDD);
    h1PermVerdicts[cond.id] = verdictOf(cond, ws, armFor, permRet, permDD);
    h1[cond.id] = { perWindow, verdict: h1Verdicts[cond.id], permutationNullVerdict: h1PermVerdicts[cond.id] };
    say(`H1 ${cond.id}: ${ws.map((w) => `${w} inc ${(incStats(cond, w).ret * 100).toFixed(1)} arm ${(armStats[w].ret * 100).toFixed(1)} null p95 ${(summarize(nullRet[w]).p95 * 100).toFixed(1)}`).join(" | ")} → worst ${h1Verdicts[cond.id].onReturn.armWorst.window} ${(h1Verdicts[cond.id].onReturn.armWorst.ret * 100).toFixed(2)} vs inc ${(h1Verdicts[cond.id].onReturn.incumbentWorst.ret * 100).toFixed(2)}, P(null ≥) ${h1Verdicts[cond.id].onReturn.pNullWorstAtLeastArmWorst}`);
  }
  if (fidelityH1.sleeveMismatchesAtF1 || fidelityH1.maxAbsMarkDiffAtF1 > 1e-12 || fidelityH1.maxProductAbsDiff > 1e-12) throw new Error(`H1's arithmetic failed its own checks: ${JSON.stringify(fidelityH1)}`);

  // ── H2 and H3 ─────────────────────────────────────────────────────────
  const filterPolicy = (h: "h2" | "h3"): PolicyAt => (symbol, t) => {
    const m = filterFor(h, symbol);
    return (i) => {
      const on = m.get(refDayStart(decisionTime(t, i)));
      if (on == null) throw new Error(`${h} ${symbol}: no filter value at bar ${i}`);
      return on ? "hold" : "enter";
    };
  };
  const filterStudy = (h: "h2" | "h3") => {
    const out: Record<string, unknown> = {};
    const verdicts: Record<string, ReturnType<typeof verdictOf>> = {};
    for (const cond of CONDITIONS) {
      const ws = coverage[h].counted.filter((w) => priced(cond.tape, w).length > 0);
      const perWindow: Record<string, unknown> = {};
      const armStats: Record<string, SleeveStats> = {};
      const nullRet: Record<string, Float64Array> = {}, nullDD: Record<string, Float64Array> = {};
      for (const w of ws) {
        const base = inc[cond.id][w]!;
        const arm = runArm(cond, w, filterPolicy(h));
        armStats[w] = arm.stats;
        const target = arm.entries, baseEntries = base.entries;
        // Calibrate the episode refusal so the null's MEAN lands on the arm's entries (`backtest_jev.ts`'s bisection) …
        let lo = 0, hi = 1;
        const path: { pEp: number; meanEntries: number }[] = [];
        if (target < baseEntries) {
          for (let it = 0; it < CAL_ITERS; it++) {
            const mid = (lo + hi) / 2;
            let tot = 0;
            for (let k = 0; k < CAL_DRAWS; k++) tot += runLight(cond, w, (s) => episodeNullPolicy(mid, mulberry32(seedOf("cal", h, cond.id, w, s, k)))).entries;
            path.push({ pEp: r4(mid), meanEntries: r3(tot / CAL_DRAWS) });
            if (tot / CAL_DRAWS > target) lo = mid; else hi = mid;
          }
        }
        const pEp = target < baseEntries ? (lo + hi) / 2 : 0;
        // … and keep only the draws that land on it EXACTLY.
        const nr: number[] = [], nd: number[] = [];
        let attempts = 0;
        if (target <= baseEntries) {
          while (nr.length < FILTER_NULL_DRAWS && attempts < MAX_ATTEMPTS) {
            const o = runLight(cond, w, (s) => episodeNullPolicy(pEp, mulberry32(seedOf("null", h, cond.id, w, s, attempts))));
            attempts++;
            if (o.entries === target) { nr.push(o.ret); nd.push(o.maxDD); }
          }
        }
        nullRet[w] = Float64Array.from(nr); nullDD[w] = Float64Array.from(nd);
        perWindow[w] = {
          incumbent: incRow[cond.id][w],
          arm: {
            ...rowOf(arm.stats, sleeveSharpe(Object.fromEntries(Object.entries(arm.per).map(([s, r]) => [s, r.g])), arm.stats, sharpeTally), idleOf(arm.per)),
            entries: target, incumbentEntries: baseEntries, entriesRemovedNet: baseEntries - target, signalsRefused: arm.refused, signalsSeen: arm.signals,
          },
          null: {
            ...(nr.length ? nullRow(nullRet[w], arm.stats.ret) : { ret: null, pNullAtLeastArm: null }),
            entriesEveryDraw: target, pEpisodeRefusal: r4(pEp), calibration: path, drawsKept: nr.length, attempts,
            note: target > baseEntries ? "the arm takes MORE entries than the incumbent; no refusal can match it, so the arm cannot pass here" : nr.length < FILTER_NULL_DRAWS ? `only ${nr.length} draws landed on the count in ${attempts} attempts` : "",
          },
        };
        say(`${h} ${cond.id} ${w}: inc ${(base.stats.ret * 100).toFixed(1)}% (${baseEntries} entries) | arm ${(arm.stats.ret * 100).toFixed(1)}% (${target} entries, ${arm.refused} signals refused) | null p95 ${nr.length ? (summarize(nullRet[w]).p95 * 100).toFixed(1) : "—"}% (pEp ${pEp.toFixed(3)}, kept ${nr.length}/${attempts})`);
      }
      if (ws.some((w) => nullRet[w].length === 0)) {
        verdicts[cond.id] = { ...verdictOf(cond, ws, Object.fromEntries(ws.map((w) => [w, armStats[w]])), Object.fromEntries(ws.map((w) => [w, new Float64Array([Infinity])])), Object.fromEntries(ws.map((w) => [w, new Float64Array([0])]))), passes: false };
      } else {
        verdicts[cond.id] = verdictOf(cond, ws, Object.fromEntries(ws.map((w) => [w, armStats[w]])), nullRet, nullDD);
      }
      out[cond.id] = { perWindow, verdict: verdicts[cond.id] };
      say(`${h} ${cond.id}: worst ${verdicts[cond.id].onReturn.armWorst.window} ${(verdicts[cond.id].onReturn.armWorst.ret * 100).toFixed(2)} vs inc ${(verdicts[cond.id].onReturn.incumbentWorst.ret * 100).toFixed(2)}, P(null ≥) ${verdicts[cond.id].onReturn.pNullWorstAtLeastArmWorst}`);
    }
    return { out, verdicts };
  };
  const h2 = filterStudy("h2");
  const h3 = filterStudy("h3");

  // ── verdicts and the multiple-comparison context ──────────────────────
  const summarizeVerdict = (vs: Record<string, ReturnType<typeof verdictOf>>) => {
    const perCondition = Object.fromEntries(CONDITIONS.map((c) => [c.id, {
      beatsIncumbentWorst: vs[c.id].onReturn.beatsIncumbentWorst, pNull: vs[c.id].onReturn.pNullWorstAtLeastArmWorst, beatsNull: vs[c.id].onReturn.beatsNull, passes: vs[c.id].passes,
      onRetOverDD: { beatsIncumbentWorst: vs[c.id].onRetOverDD.beatsIncumbentWorst, pNull: vs[c.id].onRetOverDD.pNullWorstAtLeastArmWorst, beatsNull: vs[c.id].onRetOverDD.beatsNull },
    }]));
    const passes = CONDITIONS.every((c) => vs[c.id].passes);
    const passesOnRetOverDD = CONDITIONS.every((c) => vs[c.id].onRetOverDD.beatsIncumbentWorst && vs[c.id].onRetOverDD.beatsNull);
    const worstP = Math.max(...CONDITIONS.map((c) => vs[c.id].onReturn.pNullWorstAtLeastArmWorst));
    return { passes, passesOnRetOverDD, largestPNullAcrossEvaluations: worstP, perCondition };
  };
  const verdicts = { h1: summarizeVerdict(h1Verdicts), h1PermutationNull: summarizeVerdict(h1PermVerdicts), h2: summarizeVerdict(h2.verdicts), h3: summarizeVerdict(h3.verdicts) };
  say(`VERDICTS (return, all four evaluations): H1 ${verdicts.h1.passes ? "PASSES" : "fails"} | H2 ${verdicts.h2.passes ? "PASSES" : "fails"} | H3 ${verdicts.h3.passes ? "PASSES" : "fails"} — ${JSON.stringify({ h1: verdicts.h1.perCondition, h2: verdicts.h2.perCondition, h3: verdicts.h3.perCondition })}`);

  const hashesEnd = await hashSources();
  if (JSON.stringify(hashesStart) !== JSON.stringify(hashesEnd)) throw new Error("a source file changed while the study ran");
  if (JSON.stringify(inputsHash) !== JSON.stringify({ dvolJson: await sha256(dvolPath), fundingJson: await sha256(fundingPath), set2Json: await sha256(set2Path) })) throw new Error("an input file changed while the study ran");

  const report = {
    study: "three pre-registered changes to the live row trend-4h (Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots): H1 volatility-targeted entry size, H2 a Deribit DVOL entry filter, H3 a Binance funding entry filter — each against the incumbent on four windows × four evaluations and against its own null",
    preRegistration: "written before any arm ran, in the session scratchpad (research_bd/prereg_sizing_filters.md); the definitions below are its definitions",
    bar: `in EACH of the four evaluations (${CONDITIONS.map((c) => c.id).join(", ")}): the arm's worst-window return beats the incumbent's worst-window return on the windows the hypothesis is judged on, AND the null does as well or better on its own worst window in at most ${ALPHA * 100} % of draws (ties count against the arm). Pass only if all four evaluations pass. Return over drawdown (ret / max(0.05, maxDD)) is reported under the same test and never decides.`,
    definitions: {
      incumbent: { row: LIVE_CANDIDATE.row, venue: LIVE_CANDIDATE.venue, symbols: LIVE_CANDIDATE.symbols, slotUsd: SLOT_USD, params: DEFAULT_TREND, costs: "Revolut X: the touch (half the measured spread) plus 9 bps taker per fill (backtest.ts COSTS.revx)", windowsAndEvaluations: "backtest_jev.ts loadMeasuredSeries / CONDITIONS, unchanged" },
      decisionTime: "the close of the 4h bar (bar start + 4 h); a daily input is read from the last UTC day that has closed at that instant (day start + 24 h ≤ decision time), the rule run applies to daily candles",
      h1: {
        size: "each entry deploys min(1, TARGET / vol) of the slot's cash; the rest stays in cash until the trade closes; exits, stops and the cooldown are the incumbent's",
        vol: `realisedVol(daily closes, ${VOL_DAYS}, ${DAYS_PER_YEAR}) — population stdev of the last ${VOL_DAYS} daily log returns of the evaluated tape's completed daily candles, annualised with √${DAYS_PER_YEAR}`,
        target: targetBlock,
        venueMinimumOrderUsd: VENUE_MIN_ORDER_USD,
        placeboNull: `per draw and coin: the same coin's vol ${SHIFT_MIN_DAYS}–${SHIFT_MAX_DAYS} days before each decision (shift uniform, capped by the history), or, where the coin's own history cannot reach ${SHIFT_MIN_DAYS} days before the window's first decision, a donor drawn uniformly from the coins whose history can; ${H1_DRAWS} draws`,
        permutationNull: `reported, never decides: the arm's multipliers permuted at random among the coin's own entries, ${H1_DRAWS} draws`,
        donors: donorTable,
      },
      h2: { index: "Deribit DVOL daily close; BTC's for BTC, SOL, AVAX and SUI, ETH's for ETH", rule: `refuse an entry while DVOL of the reference day is strictly above the ${Math.ceil((TRAIL_DAYS * (DVOL_TOP.den - DVOL_TOP.num)) / DVOL_TOP.den)}th smallest of the ${TRAIL_DAYS} daily closes ending on that day (top third)`, filterDefined: filterSpans.h2, coverage: coverage.h2 },
      h3: { index: "Binance USDⓈ-M perpetual funding, the coin's own, summed per UTC day", rule: `refuse an entry while the ${FUNDING_MEAN_DAYS}-day mean of the daily sums ending on the reference day is strictly above the ${Math.ceil((TRAIL_DAYS * (FUNDING_TOP.den - FUNDING_TOP.num)) / FUNDING_TOP.den)}th smallest of the ${TRAIL_DAYS} such means ending on that day (top fifth)`, filterDefined: filterSpans.h3, coverage: coverage.h3 },
      filterNull: `per evaluation × window: whole breakout episodes refused at random (backtest_jev.ts episodeNullPolicy), the episode probability bisected (${CAL_ITERS} steps × ${CAL_DRAWS} draws) so the mean entries match the arm's, then only draws whose entries over the window's coins EQUAL the arm's are kept, up to ${FILTER_NULL_DRAWS} (at most ${MAX_ATTEMPTS} attempts)`,
    },
    inputs: { tapes: dataRows, dvol: { sha256: inputsHash.dvolJson, ...dvol.provenance }, funding: { sha256: inputsHash.fundingJson, ...funding.provenance }, set2Sha256: inputsHash.set2Json },
    fidelity: {
      runGatedVsRun: { cells: runChecks, mismatches: runMismatches, what: "the incumbent through backtest_jev.ts's flat-bar cache against backtest.ts's run: return, drawdown, trades and exposure on every coin × window × evaluation" },
      incumbentReproduction: { worstAbsDiff: reproWorst, perCondition: reproduction, what: "the incumbent sleeve against set2.json's equal row on all four evaluations and the published go-live sleeve on the primary one" },
      h1IdentityAtF1: { cells: fidelityH1.cells, maxAbsMarkDiff: fidelityH1.maxAbsMarkDiffAtF1, sleeveMismatches: fidelityH1.sleeveMismatchesAtF1, what: "H1's arithmetic with every multiplier 1 against the incumbent's own marks and sleeve" },
      h1TradeProduct: { checks: fidelityH1.productChecks, maxAbsDiff: fidelityH1.maxProductAbsDiff, what: "each scaled slot's end equity recomputed as the product over its trades of (1 − f + f·G)" },
      sharpeLoopAgainstCombine: { checks: sharpeTally.checks, mismatches: 0, what: "the daily loop Sharpe is computed from lands on combine's return and drawdown on every sleeve it is computed for" },
      smallestH1OrderUsd: Number.isFinite(h1MinOrder) ? r4(h1MinOrder) : null,
    },
    incumbent: incRow,
    h1: { perCondition: h1, entriesBelowVenueMinimum: h1BelowMin },
    h2: { perCondition: h2.out },
    h3: { perCondition: h3.out },
    verdicts,
    multipleComparisons: {
      hypotheses: HYPOTHESES,
      nominalAlpha: ALPHA, bonferroniAlpha: r4(ALPHA / HYPOTHESES),
      largestPNull: { h1: verdicts.h1.largestPNullAcrossEvaluations, h2: verdicts.h2.largestPNullAcrossEvaluations, h3: verdicts.h3.largestPNullAcrossEvaluations },
      passes: { h1: verdicts.h1.passes, h2: verdicts.h2.passes, h3: verdicts.h3.passes },
      note: "a hypothesis passes only if its worst-window null test clears 5 % in all four evaluations; with three hypotheses the family-wise chance of at least one false pass is at most 3 × 5 % = 15 % (Bonferroni), less because the four evaluations must all pass, more if one counts the ideas this repository already priced (per-entry volatility scaling in §3.10, §3.11 and §3.19; 33 entry gates in §3.17; the BTC-regime gate in §3.9 and §3.15)",
    },
    seeds: "mulberry32 seeded by seedOf(purpose, evaluation, window, coin, draw) — purposes h1-placebo, h1-perm, cal, null",
    draws: { h1: H1_DRAWS, filterNullKept: FILTER_NULL_DRAWS, calibration: `${CAL_ITERS} × ${CAL_DRAWS}`, maxAttempts: MAX_ATTEMPTS, preregistered: preregisteredDraws },
    sourceIntegrity: { ...hashesStart, note: "SHA-256 of backtest.ts, agents_strategy.ts and backtest_jev.ts at the start of the run; the run throws if any changed before it finished" },
  };
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(`${outDir}/sizing.json`, JSON.stringify(report, null, 1));
  say(`wrote ${outDir}/sizing.json`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  await main(args);
}
