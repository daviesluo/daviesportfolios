// The CROSS-SECTIONAL MOMENTUM study. Binance's one property Revolut X cannot
// match is BREADTH — hundreds of liquid USDT spot pairs with one-tick books —
// so the question is whether a long-only weekly rotation over a broad,
// point-in-time liquid Binance universe clears the project's bar where the
// four-coin rotation (reference §3.4) did not, and whether it adds to the
// Revolut X row (`trend-4h`) as a combination. Pre-registered, before any
// candidate arm ran, at
//   /tmp/claude-0/-home-user-daviesportfolios/1cf3fb75-5b0c-5fb3-9c44-48af6af85fed/scratchpad/research_bd/prereg_xsmom.md
// (its sha256 is written into the output). A study, not a rulebook: nothing
// here is read by the loop, and nothing here places, sizes or records an order.
//
// Run by hand (Deno 1.x, no network):
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_xsmom.ts \
//     --klines  <$XSMOM_WORK/binance_klines>     (daily/<SYM>.json + manifest.json, written by
//                                                 docs/agents/scripts/xsmom/fetch_klines.py from Binance's
//                                                 keyless bulk archive data.binance.vision)
//     --xinfo   <exchangeInfo.json>              (keyless GET /api/v3/exchangeInfo, 2026-09-23 02:02 UTC: gunzip
//                                                 docs/agents/backtests/inputs/binance_exchangeInfo_2026-09-23.json.gz)
//     --books   docs/agents/backtests/inputs/binance_books_2026-09-23
//     --data    <dir with BTC-USD_1h_3y.json …>  (Coinbase hourly — the incumbent, as backtest_jev.ts reads it)
//     --ext     <dir with BTC-USD_1h_kraken.json …>
//     --ktape   <dir with BTC-USD_4h_kraken.json …>
//     --set2    docs/agents/backtests/set2.json
//     --prereg  docs/agents/reviews/2026-09-23-binance-xsmom-prereg.md   (the string is copied into the output)
//     --out     docs/agents/backtests
//     [--stage data]   prints the data facts the pre-registration needed (universe, spans,
//                      delisted pairs, spreads, the incumbent's reproduction) and writes nothing
//
// Writes `<out>/xsmom.json` and NOTHING else. No wall clock is written; every
// random draw comes from `mulberry32(seedOf(...))`, so a re-run over the same
// inputs writes the file byte for byte.
//
// ── the universe (point in time, delisted pairs included) ─────────────
//
// Every *USDT symbol the archive has ever held (its folders survive
// delisting), minus stablecoins, fiat- and asset-pegged tokens, tokenised
// stocks and leveraged tokens (the lists below, fixed in the
// pre-registration). At a decision on the close of day d a pair is eligible
// when it has a daily kline on each of the 30 days d−29…d, its current
// segment is at least 100 days old, and it is not excluded; the universe is
// the 30 eligible pairs with the largest 30-day quote volume (ties by
// symbol). A gap of more than GAP_BRIDGE_DAYS missing days starts a new
// segment (a symbol re-used for a different token, or a delisting and a
// relisting); a position is sold at its segment's last close.
//
// ── the rule, the family, the walk-forward ────────────────────────────
//
// Weekly: decide on Sunday's close (UTC), fill at Monday's open; each run
// also forms its book on its first day. Hold the top k by L-day return,
// each at 1/k of equity; optional absolute filter (a pick is held only if
// its L-day return is positive, or only if it closes above its 100-day
// mean — a failing pick's slot is cash) and optional BTC regime filter
// (all cash while BTCUSDT closes below its 200-day mean). k ∈ {3, 5},
// L ∈ {7, 14, 28}. Seven candidates: six filter variants with (k, L)
// chosen in sample, and the whole 36-point family chosen in sample; the
// choice is `backtest.ts`'s — best in-sample return / max(0.05, drawdown),
// first in grid order on a tie. In-sample is everything from IS_START to
// the day before the window; out-of-sample is the project's window A–D.
//
// ── costs ──────────────────────────────────────────────────────────────
//
// 10 bps a side (7.5 with BNB, reported), plus half the measured Binance
// spread: the median of the 25 samples in the committed
// `binance_cost_bookticker_samples.jsonl` for the 25 pairs measured, and for
// every other pair the widest of those 25 medians. Every trade under $5 is
// skipped except a full exit; capital $100. Marked at daily closes; the last
// day is marked, not liquidated (`run`'s convention).
//
// ── the null, the bar, the chance count ───────────────────────────────
//
// The null a candidate is judged against copies its path's cash decisions
// and its turnover: at each rebalance it holds as many coins as the
// candidate does, keeps as many of its current holdings as the candidate
// keeps, and draws the rest at random from the same 30-pair universe —
// 1,000 draws per window. The bar: out-of-sample return positive on BOTH
// windows A and B, AND the candidate's worst window (of A–D) above the 95th
// percentile of the null's worst window. The chance count is exact: the
// share of null draws that would pass the same bar, summed over candidates.
//
// ── what is imported ──────────────────────────────────────────────────
//
// The incumbent is `backtest_jev.ts`'s exported machinery, unchanged
// (`loadMeasuredSeries`, `buildTrack`, `trackDecider`, `rulePolicy`,
// `runGated`, `stopsOf`, `sleeveStatsOf`, `dailyReturns`), checked against
// `set2.json`'s `equal` row on all four evaluations and the published
// primary numbers; `backtest.ts`'s `run` checks `runGated` cell by cell.
// The xsmom simulator is new — no existing rulebook trades a cross-section
// — and `fidelity` below checks its arithmetic by hand-computable cases.

import { DEFAULT_TREND } from "../_shared/agents_strategy.ts";
import { COSTS, run } from "./backtest.ts";
import {
  atLeast, BAR_HOURS, buildTrack, CONDITIONS, dailyReturns, loadMeasuredSeries, mulberry32, PRIMARY, rulePolicy, runGated,
  seedOf, sleeveStatsOf, SLOT_USD, stopsOf, trackDecider, WIN_NAMES,
  type GatedResult, type MeasuredSeries, type Tape, type Track, type WinName,
} from "./backtest_jev.ts";

// ───────────────────────────────────────────────── the pre-registered numbers

const CAPITAL_USD = 100;
const MIN_NOTIONAL_USD = 5;
const FEE_BPS = 10, FEE_BPS_BNB = 7.5;
const UNIVERSE_N = 30, UNIVERSE_N_SENS = [20, 50] as const;
const VOL_DAYS = 30;
const MIN_AGE_DAYS = 100;
/**
 * A run of more than this many missing days inside a symbol's series starts a new segment. Pre-registered as 7;
 * CORRECTED to 0 (pre-registration, correction 1, 2026-09-23 07:14 UTC) when the audit found that this
 * archive's short gaps are token redenominations — BNX ×0.01, BTCST ×0.1, COCOS ×1000, DREP ×100, QUICK ×0.001,
 * STRAX ×0.1, SUN ×0.001 across the gap — which bridging turns into fake price moves. The archive has no
 * one-day gaps, so 0 changes nothing else.
 */
const GAP_BRIDGE_DAYS = 0;
const KS = [3, 5] as const;
const LS = [7, 14, 28] as const;
const ABS = ["none", "ret", "ma"] as const;
const REGIMES = [false, true] as const;
const MA_DAYS = 100, BTC_MA_DAYS = 200;
const NULL_DRAWS = 1000;
const ALPHA = 0.05;
const DD_LIMIT = 0.35;
const EPS_USD = 1e-9;
const DAY_MS = 86400e3;
/** Monday is day-number ≡ 4 (mod 7): 1970-01-05 was a Monday. */
const MONDAY_MOD = 4;
const BTC = "BTCUSDT", USDC = "USDCUSDT";

/** The project's four windows, as `windowsOn` cuts them on BTC/USD (checked against `loadMeasuredSeries` at run time). */
const WINDOW_DAYS: Record<WinName, { from: string; to: string }> = {
  A: { from: "2025-09-10", to: "2026-09-19" },
  B: { from: "2024-08-31", to: "2025-09-09" },
  C: { from: "2023-08-22", to: "2024-08-30" },
  D: { from: "2022-08-22", to: "2023-08-21" },
};

/** Leveraged tokens: a base that is BULL / BEAR, or another listed base followed by UP / DOWN / BULL / BEAR. */
const LEVERAGED_BASES = [
  "1INCHDOWN", "1INCHUP", "AAVEDOWN", "AAVEUP", "ADADOWN", "ADAUP", "BCHDOWN", "BCHUP", "BEAR", "BNBBEAR", "BNBBULL", "BNBDOWN", "BNBUP",
  "BTCDOWN", "BTCUP", "BULL", "DOTDOWN", "DOTUP", "EOSBEAR", "EOSBULL", "EOSDOWN", "EOSUP", "ETHBEAR", "ETHBULL", "ETHDOWN", "ETHUP",
  "FILDOWN", "FILUP", "LINKDOWN", "LINKUP", "LTCDOWN", "LTCUP", "SUSHIDOWN", "SUSHIUP", "SXPDOWN", "SXPUP", "TRXDOWN", "TRXUP",
  "UNIDOWN", "UNIUP", "XLMDOWN", "XLMUP", "XRPBEAR", "XRPBULL", "XRPDOWN", "XRPUP", "XTZDOWN", "XTZUP", "YFIDOWN", "YFIUP",
];
/** Stablecoins, fiat tokens and tokens pegged to another asset (gold, BTC, ETH, SOL). */
const PEGGED_BASES: Record<string, string> = {
  AEUR: "EUR stablecoin", AUD: "fiat (AUD)", BFUSD: "USD stablecoin", BKRW: "KRW stablecoin", BUSD: "USD stablecoin", DAI: "USD stablecoin",
  EUR: "fiat (EUR)", EURI: "EUR stablecoin", FDUSD: "USD stablecoin", GBP: "fiat (GBP)", PAX: "USD stablecoin (USDP's old ticker)",
  RLUSD: "USD stablecoin", SUSD: "USD stablecoin", TUSD: "USD stablecoin", USD1: "USD stablecoin", USDC: "USD stablecoin",
  USDE: "USD stablecoin", USDP: "USD stablecoin", USDS: "USD stablecoin", USDSB: "USD stablecoin", USDSOLD: "USD stablecoin (old USDS)",
  UST: "USD stablecoin (TerraUSD, the pair traded 2021-12-24 → 2022-05-13)", U: "USD stablecoin (closes 0.9993–1.0017)", XUSD: "USD stablecoin",
  PAXG: "gold-pegged", XAUT: "gold-pegged", WBTC: "BTC-pegged (wrapped)", WBETH: "ETH-pegged (wrapped beacon ETH)",
  BETH: "ETH-pegged (staked ETH)", BNSOL: "SOL-pegged (staked SOL)",
};
/** Tokenised equities and equity ETFs (their price is a stock's, not a crypto asset's). */
const STOCK_BASES = [
  "AAOIB", "AAPLB", "ALABB", "AMATB", "AMDB", "AMZNB", "ARMB", "ASMLB", "ASTSB", "AVGOB", "AXTIB", "BABAB", "BMNRB", "CBRSB", "COHRB",
  "COINB", "CRCLB", "CRDOB", "CRWVB", "DELLB", "DJTB", "DRAMB", "EWYB", "FLNCB", "GLWB", "GMEB", "GOOGLB", "HOODB", "IBMB", "INTCB",
  "INTWB", "IRENB", "KORUB", "LITEB", "METAB", "MRVLB", "MSFTB", "MSTRB", "MUB", "MUUB", "MVLLB", "NBISB", "NFLXB", "NOKB", "NVDAB",
  "ORCLB", "PLTRB", "PYPLB", "QCOMB", "QNTB", "QQQB", "RKLBB", "SKHYB", "SMCIB", "SMHB", "SNDKB", "SNXXB", "SOXLB", "SOXSB", "SPCXB",
  "SPYB", "TQQQB", "TSLAB", "TSMB", "USARB", "WDCB",
];

// ───────────────────────────────────────────────────────────────── helpers

const r4 = (x: number) => Number(x.toFixed(4));
const r6 = (x: number) => Number(x.toFixed(6));
const isoDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
const dayOf = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
async function sha256(p: string | URL): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await Deno.readFile(p));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sha256Text(t: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)).then((h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""));
}
/** The q-quantile as `summarize` in backtest_jev.ts takes it: s[min(n − 1, floor(q·n))]. */
function quantile(xs: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function stats(xs: ArrayLike<number>) {
  const s = Float64Array.from(xs).sort();
  const n = s.length;
  let t = 0;
  for (let i = 0; i < n; i++) t += s[i];
  const q = (p: number) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean: r4(t / n), p05: r4(q(0.05)), p50: r4(q(0.5)), p95: r4(q(0.95)), min: r4(s[0]), max: r4(s[n - 1]) };
}
function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  const n = a.length;
  if (n < 3) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}
const score = (ret: number, dd: number) => ret / Math.max(0.05, dd);
/** P(at least x successes) among independent trials with success probabilities ps (the Poisson-binomial tail, exact). */
function poissonBinomialAtLeast(ps: number[], x: number): number {
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    for (let i = 0; i < dist.length; i++) { next[i] += dist[i] * (1 - p); next[i + 1] += dist[i] * p; }
    dist = next;
  }
  let t = 0;
  for (let i = x; i < dist.length; i++) t += dist[i];
  return Math.min(1, t);
}

// ───────────────────────────────────────────────────────────── the klines

type Row = [number, number, number, number, number, number, number, number]; // [t_sec, open, high, low, close, base vol, quote vol, trades]

type Book = {
  syms: string[]; day0: number; nDays: number; lastDay: number;
  open: Float64Array[]; close: Float64Array[]; cff: Float64Array[]; present: Uint8Array[];
  presPre: Int32Array[]; qvPre: Float64Array[]; segFirst: Int32Array[]; segEnd: Uint8Array[];
  segments: { first: number; last: number; rows: number }[][];
  excluded: (string | null)[];
};

async function loadBook(dir: string, manifest: { daily: Record<string, { sha256: string; rows: number }> }): Promise<Book> {
  const syms = Object.keys(manifest.daily).sort();
  const raw: Row[][] = [];
  let dmin = Infinity, dmax = -Infinity;
  for (const s of syms) {
    const path = `${dir}/daily/${s}.json`;
    const h = await sha256(path);
    if (h !== manifest.daily[s].sha256) throw new Error(`${s}: sha256 ${h} is not the manifest's ${manifest.daily[s].sha256}`);
    const rows = JSON.parse(await Deno.readTextFile(path)) as Row[];
    if (rows.length !== manifest.daily[s].rows) throw new Error(`${s}: ${rows.length} rows, manifest says ${manifest.daily[s].rows}`);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] % 86400 !== 0) throw new Error(`${s}: a daily kline not at 00:00 UTC (${rows[i][0]})`);
      if (i && rows[i][0] <= rows[i - 1][0]) throw new Error(`${s}: rows out of order`);
    }
    raw.push(rows);
    dmin = Math.min(dmin, rows[0][0] / 86400);
    dmax = Math.max(dmax, rows[rows.length - 1][0] / 86400);
  }
  const day0 = dmin, nDays = dmax - dmin + 1, lastDay = dmax;
  const book: Book = {
    syms, day0, nDays, lastDay, open: [], close: [], cff: [], present: [], presPre: [], qvPre: [], segFirst: [], segEnd: [], segments: [], excluded: [],
  };
  for (let i = 0; i < syms.length; i++) {
    const rows = raw[i];
    const open = new Float64Array(nDays).fill(NaN), close = new Float64Array(nDays).fill(NaN), cff = new Float64Array(nDays).fill(NaN);
    const present = new Uint8Array(nDays), segEnd = new Uint8Array(nDays);
    const segFirst = new Int32Array(nDays).fill(-1);
    const qv = new Float64Array(nDays);
    const segs: { first: number; last: number; rows: number }[] = [];
    let cur: { first: number; last: number; rows: number } | null = null;
    for (const r of rows) {
      const D = r[0] / 86400 - day0;
      open[D] = r[1]; close[D] = r[4]; present[D] = 1; qv[D] = r[6];
      if (!(r[1] > 0 && r[4] > 0)) throw new Error(`${syms[i]} ${isoDay(D + day0)}: a non-positive price`);
      if (cur && D - cur.last - 1 <= GAP_BRIDGE_DAYS) { cur.last = D; cur.rows++; } else { cur = { first: D, last: D, rows: 1 }; segs.push(cur); }
    }
    for (const g of segs) {
      let last = NaN;
      for (let D = g.first; D <= g.last; D++) {
        segFirst[D] = g.first;
        if (present[D]) last = close[D];
        cff[D] = last;
      }
      if (g.last + day0 < lastDay) segEnd[g.last] = 1;
    }
    const presPre = new Int32Array(nDays + 1), qvPre = new Float64Array(nDays + 1);
    for (let D = 0; D < nDays; D++) { presPre[D + 1] = presPre[D] + present[D]; qvPre[D + 1] = qvPre[D] + qv[D]; }
    book.open.push(open); book.close.push(close); book.cff.push(cff); book.present.push(present);
    book.presPre.push(presPre); book.qvPre.push(qvPre); book.segFirst.push(segFirst); book.segEnd.push(segEnd);
    book.segments.push(segs.map((g) => ({ first: g.first + day0, last: g.last + day0, rows: g.rows })));
    book.excluded.push(exclusionOf(syms[i], new Set(syms.map((x) => x.slice(0, -4)))));
  }
  return book;
}

/** Why a USDT pair is outside the universe by construction, or null. The lists are the pre-registration's. */
function exclusionOf(sym: string, allBases: Set<string>): string | null {
  if (!sym.endsWith("USDT")) return "not a USDT pair";
  const base = sym.slice(0, -4);
  if (LEVERAGED_BASES.includes(base)) return "leveraged token";
  if (base in PEGGED_BASES) return `stablecoin / pegged: ${PEGGED_BASES[base]}`;
  if (STOCK_BASES.includes(base)) return "tokenised equity";
  // The rule the leveraged list was written from must find nothing the list lacks.
  if (base === "BULL" || base === "BEAR") throw new Error(`${sym}: leveraged by rule, missing from LEVERAGED_BASES`);
  for (const suf of ["UP", "DOWN", "BULL", "BEAR"]) {
    if (base.endsWith(suf) && base.length > suf.length && allBases.has(base.slice(0, -suf.length))) {
      throw new Error(`${sym}: leveraged by rule (${base.slice(0, -suf.length)} + ${suf}), missing from LEVERAGED_BASES`);
    }
  }
  return null;
}

// ─────────────────────────────────────────────── universe and signals

type Ctx = {
  b: Book; btc: number; uni: Map<number, number[]>; btcOn: Map<number, boolean>;
  halfSpread: Float64Array; // per symbol, fraction of price, at spreadMult 1
};

/** Days are ABSOLUTE day numbers (days since 1970-01-01) everywhere outside `Book`'s arrays. */
function universeAt(c: Ctx, dAbs: number, N: number): number[] {
  const key = dAbs * 1000 + N;
  const hit = c.uni.get(key);
  if (hit) return hit;
  const b = c.b, d = dAbs - b.day0;
  const el: { i: number; vol: number }[] = [];
  if (d - VOL_DAYS + 1 >= 0) {
    for (let i = 0; i < b.syms.length; i++) {
      if (b.excluded[i]) continue;
      if (!b.present[i][d]) continue;
      const sf = b.segFirst[i][d];
      if (sf < 0 || d - sf + 1 < MIN_AGE_DAYS) continue;
      if (b.presPre[i][d + 1] - b.presPre[i][d + 1 - VOL_DAYS] !== VOL_DAYS) continue;
      el.push({ i, vol: b.qvPre[i][d + 1] - b.qvPre[i][d + 1 - VOL_DAYS] });
    }
  }
  el.sort((x, y) => y.vol - x.vol || x.i - y.i);
  const out = el.slice(0, N).map((x) => x.i);
  c.uni.set(key, out);
  return out;
}
/** One pair's eligibility on the close of day dAbs, by the universe rule's tests (volume rank aside). */
function eligibleOne(c: Ctx, i: number, dAbs: number): boolean {
  const b = c.b, d = dAbs - b.day0;
  if (d - VOL_DAYS + 1 < 0 || b.excluded[i] || !b.present[i][d]) return false;
  const sf = b.segFirst[i][d];
  if (sf < 0 || d - sf + 1 < MIN_AGE_DAYS) return false;
  return b.presPre[i][d + 1] - b.presPre[i][d + 1 - VOL_DAYS] === VOL_DAYS;
}
function eligibleCount(c: Ctx, dAbs: number): number {
  const b = c.b, d = dAbs - b.day0;
  if (d - VOL_DAYS + 1 < 0) return 0;
  let n = 0;
  for (let i = 0; i < b.syms.length; i++) {
    if (b.excluded[i] || !b.present[i][d]) continue;
    const sf = b.segFirst[i][d];
    if (sf < 0 || d - sf + 1 < MIN_AGE_DAYS) continue;
    if (b.presPre[i][d + 1] - b.presPre[i][d + 1 - VOL_DAYS] !== VOL_DAYS) continue;
    n++;
  }
  return n;
}
function retL(c: Ctx, i: number, dAbs: number, L: number): number {
  const d = dAbs - c.b.day0;
  const r = c.b.cff[i][d] / c.b.cff[i][d - L] - 1;
  if (!Number.isFinite(r)) throw new Error(`${c.b.syms[i]} ${isoDay(dAbs)}: no ${L}-day return`);
  return r;
}
function smaAt(c: Ctx, i: number, dAbs: number, n: number): number {
  const d = dAbs - c.b.day0;
  let s = 0;
  for (let x = d - n + 1; x <= d; x++) s += c.b.cff[i][x];
  if (!Number.isFinite(s)) throw new Error(`${c.b.syms[i]} ${isoDay(dAbs)}: no ${n}-day mean`);
  return s / n;
}
/** The regime filter's state: invested unless BTCUSDT closed below its 200-day mean. */
function btcInvested(c: Ctx, dAbs: number): boolean {
  const hit = c.btcOn.get(dAbs);
  if (hit !== undefined) return hit;
  const d = dAbs - c.b.day0;
  if (d - c.b.segFirst[c.btc][d] + 1 < BTC_MA_DAYS) throw new Error(`BTCUSDT has no ${BTC_MA_DAYS}-day mean on ${isoDay(dAbs)}`);
  const on = !(c.b.cff[c.btc][d] < smaAt(c, c.btc, dAbs, BTC_MA_DAYS));
  c.btcOn.set(dAbs, on);
  return on;
}

// ─────────────────────────────────────────────────────────── the simulator

type Cfg = { from: number; to: number; k: number; N: number; wd: number; feeBps: number; spreadMult: number; minUsd: number };
/** Target symbols at rebalance j (decision on the close of day d, universe U, current holdings), or null for "no rebalance". */
type Picker = (j: number, d: number, U: number[], held: number[]) => number[] | null;
type Out = {
  ret: number; maxDD: number; eq: Float64Array; n: number;
  tradedUsd: number; feeUsd: number; spreadUsd: number; fills: number; forcedExits: number; dustExits: number; skippedSmall: number;
  rebalances: number; m: number[]; keep: number[]; heldSlotDays: number; investedDays: number;
  heldEver: Set<number>;
};
const isRebalance = (D: number, wd: number) => ((D - MONDAY_MOD - wd) % 7 + 7) % 7 === 0;

function simulate(c: Ctx, cfg: Cfg, pick: Picker, eqBuf?: Float64Array): Out {
  const b = c.b, fee = cfg.feeBps / 1e4;
  const n = cfg.to - cfg.from + 1;
  const eq = eqBuf && eqBuf.length >= n ? eqBuf : new Float64Array(n);
  const hs: number[] = [], hu: number[] = [];   // holdings: symbol index, units
  let cash = CAPITAL_USD, peak = CAPITAL_USD, maxDD = 0;
  let traded = 0, feeUsd = 0, spreadUsd = 0, fills = 0, forced = 0, dust = 0, small = 0, j = 0, heldSlotDays = 0, investedDays = 0;
  const m: number[] = [], keep: number[] = [];
  const heldEver = new Set<number>();
  const minUsd = Math.max(cfg.minUsd, EPS_USD);
  const hsOf = (s: number) => c.halfSpread[s] * cfg.spreadMult;
  const sellUnits = (idx: number, u: number, px: number) => {
    const h = hsOf(hs[idx]);
    const gross = u * px * (1 - h);
    cash += gross * (1 - fee);
    traded += gross; feeUsd += gross * fee; spreadUsd += u * px * h; fills++;
    hu[idx] -= u;
  };
  const dropAt = (idx: number) => { hs.splice(idx, 1); hu.splice(idx, 1); };
  for (let D = cfg.from; D <= cfg.to; D++) {
    const Di = D - b.day0;
    if (D === cfg.from || isRebalance(D, cfg.wd)) {
      const d = D - 1;
      const U = universeAt(c, d, cfg.N);
      const held = hs.slice().sort((x, y) => x - y);
      const target = pick(j, d, U, held);
      if (target) {
        const tset = new Set(target);
        m.push(target.length);
        let kc = 0;
        for (const s of held) if (tset.has(s)) kc++;
        keep.push(kc);
        // 1. exits: every holding outside the target that trades today, sold whole at the open.
        for (let idx = hs.length - 1; idx >= 0; idx--) {
          const s = hs[idx];
          if (tset.has(s) || !b.present[s][Di]) continue;
          const px = b.open[s][Di];
          if (hu[idx] * px * (1 - hsOf(s)) < cfg.minUsd) dust++;
          sellUnits(idx, hu[idx], px);
          dropAt(idx);
        }
        // 2. equity at the open, and each slot's target value.
        let E = cash;
        for (let idx = 0; idx < hs.length; idx++) {
          const s = hs[idx];
          E += hu[idx] * (b.present[s][Di] ? b.open[s][Di] : b.cff[s][Di]);
        }
        const V = E / cfg.k;
        // 3. trims first (they raise cash), then buys, scaled down if the fees leave cash short.
        const buys: [number, number][] = [];
        for (const s of target) {
          if (!b.present[s][Di]) continue;
          const px = b.open[s][Di];
          const idx = hs.indexOf(s);
          const u = idx >= 0 ? hu[idx] : 0;
          const delta = V - u * px;
          if (idx >= 0) {
            if (Math.abs(delta) < minUsd) { if (Math.abs(delta) >= EPS_USD) small++; continue; }
            if (delta < 0) sellUnits(idx, -delta / px, px);
            else buys.push([s, delta]);
          } else {
            if (V < minUsd) { small++; continue; }
            buys.push([s, V]);
          }
        }
        let need = 0;
        for (const [, x] of buys) need += x * (1 + fee);
        const f = need > cash ? cash / need : 1;
        for (const [s, x0] of buys) {
          const x = x0 * f;
          let idx = hs.indexOf(s);
          if (idx < 0 && x < cfg.minUsd) { small++; continue; }
          const px = b.open[s][Di], h = hsOf(s);
          const u = x / (px * (1 + h));
          cash -= x * (1 + fee);
          traded += x; feeUsd += x * fee; spreadUsd += u * px * h; fills++;
          if (idx < 0) { hs.push(s); hu.push(0); idx = hs.length - 1; heldEver.add(s); }
          hu[idx] += u;
        }
        if (cash < -1e-9) throw new Error(`negative cash ${cash} on ${isoDay(D)}`);
        j++;
      }
    }
    // Forced exits: a holding whose segment ends today is sold at today's close.
    for (let idx = hs.length - 1; idx >= 0; idx--) {
      const s = hs[idx];
      if (!b.segEnd[s][Di]) continue;
      sellUnits(idx, hu[idx], b.close[s][Di]);
      forced++;
      dropAt(idx);
    }
    let e = cash;
    for (let idx = 0; idx < hs.length; idx++) e += hu[idx] * b.cff[hs[idx]][Di];
    if (!Number.isFinite(e)) throw new Error(`equity is not finite on ${isoDay(D)}`);
    eq[D - cfg.from] = e;
    peak = Math.max(peak, e); maxDD = Math.max(maxDD, 1 - e / peak);
    heldSlotDays += hs.length; if (hs.length) investedDays++;
  }
  return {
    ret: eq[n - 1] / CAPITAL_USD - 1, maxDD, eq, n, tradedUsd: traded, feeUsd, spreadUsd, fills, forcedExits: forced, dustExits: dust,
    skippedSmall: small, rebalances: j, m, keep, heldSlotDays, investedDays, heldEver,
  };
}

// ───────────────────────────────────────────────────────────── the pickers

type Params = { k: number; L: number; abs: typeof ABS[number]; regime: boolean };
const pkey = (p: Params) => `k${p.k}-L${p.L}-${p.abs}-${p.regime ? "on" : "off"}`;

function rulePicker(c: Ctx, p: Params): Picker {
  return (_j, d, U) => {
    if (p.regime && !btcInvested(c, d)) return [];
    const ranked = U.map((i) => [i, retL(c, i, d, p.L)] as [number, number]).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    const top = ranked.slice(0, p.k);
    if (p.abs === "none") return top.map(([i]) => i);
    if (p.abs === "ret") return top.filter(([, r]) => r > 0).map(([i]) => i);
    return top.filter(([i]) => c.b.cff[i][d - c.b.day0] > smaAt(c, i, d, MA_DAYS)).map(([i]) => i);
  };
}
function sample(xs: number[], n: number, rng: () => number): number[] {
  const a = xs.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const r = i + Math.floor(rng() * (a.length - i));
    const t = a[i]; a[i] = a[r]; a[r] = t;
  }
  return a.slice(0, k);
}
/**
 * THE NULL. At rebalance j it holds as many coins as the candidate's path held (m), keeps as many of its own
 * current holdings as the candidate kept (those still in the universe, chosen at random), and fills the rest
 * with coins drawn at random from the universe that it does not already hold. Same cash decisions, same
 * turnover, same mechanics and costs: only WHICH coins differs.
 */
function matchedNull(ev: { m: number[]; keep: number[] }, rng: () => number): Picker {
  return (j, _d, U, held) => {
    const mj = ev.m[j], kj = ev.keep[j];
    const inU = new Set(U);
    const A = held.filter((s) => inU.has(s));
    const nKeep = Math.min(kj, A.length, mj);
    const kept = sample(A, nKeep, rng);
    const heldSet = new Set(held);
    const need = mj - nKeep;
    let fill = sample(U.filter((s) => !heldSet.has(s)), need, rng);
    if (fill.length < need) {
      const keptSet = new Set(kept);
      fill = fill.concat(sample(A.filter((s) => !keptSet.has(s)), need - fill.length, rng));
    }
    return kept.concat(fill);
  };
}
/**
 * DESCRIPTIVE control, never a candidate: §3.4's four-coin rotation (top two of BTC / ETH / SOL / XRP by
 * 30-day return, only those above their 100-day mean) moved onto this engine — weekly, L = 28, k = 2, the
 * same costs and minimum — so that breadth is compared with four coins on identical mechanics.
 */
function fourCoinPicker(c: Ctx, four: number[]): Picker {
  return (_j, d) => {
    const U4 = four.filter((i) => eligibleOne(c, i, d));
    const ranked = U4.map((i) => [i, retL(c, i, d, 28)] as [number, number]).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    return ranked.slice(0, 2).filter(([i]) => c.b.cff[i][d - c.b.day0] > smaAt(c, i, d, MA_DAYS)).map(([i]) => i);
  };
}
/** The request's literal null, DESCRIPTIVE: k fresh random coins from the universe every week, always invested. */
function literalNull(k: number, rng: () => number): Picker {
  return (_j, _d, U) => sample(U, k, rng);
}

// ──────────────────────────────────────────────── the incumbent (imported)

type IncPath = { capital: number; members: number; days: number[]; pnl: Map<number, number>; ret: number; maxDD: number };

/** The sleeve's day-by-day P&L exactly as `combine` sums it: slot × each member's daily return, on the union of days. */
function incumbentPath(per: Record<string, GatedResult>): IncPath {
  const members = Object.keys(per).length;
  const capital = members * SLOT_USD;
  const rets = Object.values(per).map((g) => dailyReturns(g.marks));
  const days = [...new Set(rets.flatMap((r) => [...r.keys()]))].sort((a, b) => a - b);
  const pnl = new Map<number, number>();
  let eq = capital, peak = capital, maxDD = 0;
  for (const d of days) {
    let x = 0;
    for (const r of rets) x += SLOT_USD * (r.get(d) ?? 0);
    pnl.set(Math.round(d / DAY_MS), x);
    eq += x; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
  }
  return { capital, members, days: days.map((d) => Math.round(d / DAY_MS)), pnl, ret: (eq - capital) / capital, maxDD };
}

// ───────────────────────────────────────────────────────────────── the run

async function main(args: Record<string, string>): Promise<void> {
  const need = ["klines", "xinfo", "books", "data", "ext", "ktape", "set2", "prereg", "out"];
  for (const k of need) if (!args[k]) throw new Error(`needs --${k} (see the header)`);
  const stage = String(args.stage ?? "full");
  if (stage !== "full" && stage !== "data") throw new Error(`--stage ${stage}: expected full or data`);
  const t0 = Date.now();
  const say = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${s}`);

  const srcUrls = {
    backtestTs: new URL("./backtest.ts", import.meta.url),
    agentsStrategyTs: new URL("../_shared/agents_strategy.ts", import.meta.url),
    backtestJevTs: new URL("./backtest_jev.ts", import.meta.url),
    backtestXsmomTs: new URL("./backtest_xsmom.ts", import.meta.url),
  };
  const hashSources = async () => Object.fromEntries(await Promise.all(Object.entries(srcUrls).map(async ([k, u]) => [k, await sha256(u)]))) as Record<string, string>;
  const hashesStart = await hashSources();
  const inputPaths = { manifest: `${args.klines}/manifest.json`, exchangeInfo: args.xinfo, set2: args.set2, prereg: args.prereg, bookSamples: `${args.books}/binance_cost_bookticker_samples.jsonl` };
  const hashInputs = async () => Object.fromEntries(await Promise.all(Object.entries(inputPaths).map(async ([k, p]) => [k, await sha256(p)]))) as Record<string, string>;
  const inputsStart = await hashInputs();

  // ── the klines, checked against the manifest ────────────────────────
  const manifest = JSON.parse(await Deno.readTextFile(inputPaths.manifest)) as { listed_at: string; bucket: string; files_host: string; raw: Record<string, unknown>; daily: Record<string, { sha256: string; rows: number; first: string; last: string; zips: number }> };
  const b = await loadBook(args.klines, manifest);
  say(`klines: ${b.syms.length} USDT series, ${Object.keys(manifest.raw).length} archive zips, every derived file matches the manifest; calendar ${isoDay(b.day0)} → ${isoDay(b.lastDay)}`);
  const idx = new Map(b.syms.map((s, i) => [s, i]));
  const btc = idx.get(BTC);
  if (btc === undefined) throw new Error("no BTCUSDT");

  // ── spreads: the committed samples, recomputed ──────────────────────
  const sampleRows = (await Deno.readTextFile(inputPaths.bookSamples)).trim().split("\n").map((l) => JSON.parse(l) as { binance: Record<string, { bps: number | null } | undefined> });
  const measured: Record<string, { n: number; medianFullBps: number }> = {};
  for (const s of Object.keys(sampleRows[0].binance).sort()) {
    const v = sampleRows.map((r) => r.binance[s]?.bps).filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
    if (v.length === 0) continue;
    const sorted = v.slice().sort((a, b) => a - b);
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    measured[s] = { n: v.length, medianFullBps: med };
  }
  const measuredNames = Object.keys(measured);
  const unmeasuredFullBps = Math.max(...measuredNames.map((s) => measured[s].medianFullBps));
  const halfSpread = new Float64Array(b.syms.length);
  for (let i = 0; i < b.syms.length; i++) halfSpread[i] = (measured[b.syms[i]]?.medianFullBps ?? unmeasuredFullBps) / 2 / 1e4;
  say(`spreads: ${measuredNames.length} pairs measured (median full spread ${measuredNames.map((s) => `${s.replace("USDT", "")} ${measured[s].medianFullBps.toFixed(3)}`).join(", ")}); every other pair charged the widest, ${unmeasuredFullBps.toFixed(3)} bps`);
  const c: Ctx = { b, btc, uni: new Map(), btcOn: new Map(), halfSpread };

  // ── the windows, checked against the incumbent's own cut ────────────
  const { series, symbols } = await loadMeasuredSeries(args.data, args.ext, args.ktape);
  const btcWins = series["BTC/USD"].wins;
  const WIN: Record<WinName, { from: number; to: number; days: number }> = {} as Record<WinName, { from: number; to: number; days: number }>;
  for (const w of WIN_NAMES) {
    const win = btcWins.find((x) => x.name === w)!;
    const from = dayOf(win.oosFromIso.slice(0, 10));
    const lastBarEnd = Date.parse(win.oosToIso.replace("Z", ":00Z")) + BAR_HOURS * 3600e3;
    const to = Math.floor(lastBarEnd / DAY_MS) - 1;
    if (isoDay(from) !== WINDOW_DAYS[w].from || isoDay(to) !== WINDOW_DAYS[w].to) {
      throw new Error(`window ${w}: windowsOn gives ${isoDay(from)} → ${isoDay(to)}, the pre-registration says ${WINDOW_DAYS[w].from} → ${WINDOW_DAYS[w].to}`);
    }
    WIN[w] = { from, to, days: to - from + 1 };
  }
  say(`windows (BTC/USD's windowsOn, daily bars inclusive): ${WIN_NAMES.map((w) => `${w} ${isoDay(WIN[w].from)} → ${isoDay(WIN[w].to)} (${WIN[w].days} d)`).join(" | ")}`);

  // ── IS_START: the first Monday with a full universe and a BTC 200-day mean ──
  let isStart = -1;
  for (let D = b.day0 + VOL_DAYS; D < WIN.D.from; D++) {
    if (!isRebalance(D, 0)) continue;
    const d = D - 1, di = d - b.day0;
    if (b.segFirst[btc][di] < 0 || di - b.segFirst[btc][di] + 1 < BTC_MA_DAYS) continue;
    if (eligibleCount(c, d) >= UNIVERSE_N) { isStart = D; break; }
  }
  if (isStart < 0) throw new Error("no IS_START");
  // Every decision from IS_START on must see a full universe.
  let minU = Infinity;
  for (let D = isStart; D <= WIN.A.to; D++) if (isRebalance(D, 0) || Object.values(WIN).some((w) => w.from === D)) minU = Math.min(minU, universeAt(c, D - 1, UNIVERSE_N).length);
  if (minU < UNIVERSE_N) throw new Error(`a decision after IS_START saw ${minU} eligible pairs`);
  say(`IS_START ${isoDay(isStart)} (eligible pairs that day: ${eligibleCount(c, isStart - 1)}); every Monday decision from then to window A's end sees a full ${UNIVERSE_N}-pair universe`);

  // ── the universe's membership: pairs ever in it, and the delisted ones ──
  const xinfo = JSON.parse(await Deno.readTextFile(inputPaths.exchangeInfo)) as { symbols: { symbol: string; status: string }[] };
  const status = new Map(xinfo.symbols.map((s) => [s.symbol, s.status]));
  const everIn = new Map<number, { first: number; last: number; weeks: number }>();
  const perWindowMembers: Record<string, Set<number>> = { IS: new Set() };
  for (const w of WIN_NAMES) perWindowMembers[w] = new Set();
  const decisionDays: number[] = [];
  for (let D = isStart; D <= WIN.A.to; D++) if (isRebalance(D, 0) || Object.values(WIN).some((w) => w.from === D)) decisionDays.push(D);
  for (const D of decisionDays) {
    const U = universeAt(c, D - 1, UNIVERSE_N);
    const w = WIN_NAMES.find((x) => D >= WIN[x].from && D <= WIN[x].to);
    for (const i of U) {
      const e = everIn.get(i);
      if (e) { e.last = D; e.weeks++; } else everIn.set(i, { first: D, last: D, weeks: 1 });
      (w ? perWindowMembers[w] : perWindowMembers.IS).add(i);
    }
  }
  const delistedOf = (i: number) => {
    const st = status.get(b.syms[i]) ?? "absent";
    const lastRow = b.segments[i][b.segments[i].length - 1].last;
    return { status: st, lastRow: isoDay(lastRow), delisted: st !== "TRADING" || lastRow < b.lastDay - 1, reused: b.segments[i].length > 1 };
  };
  const everList = [...everIn.entries()].sort((x, y) => b.syms[x[0]] < b.syms[y[0]] ? -1 : 1).map(([i, e]) => ({
    symbol: b.syms[i], firstInUniverse: isoDay(e.first), lastInUniverse: isoDay(e.last), decisionsInUniverse: e.weeks,
    klines: b.segments[i].map((g) => ({ first: isoDay(g.first), last: isoDay(g.last), rows: g.rows })), ...delistedOf(i),
    halfSpreadBps: r4(halfSpread[i] * 1e4), spreadSource: measured[b.syms[i]] ? "measured" : "unmeasured (widest measured)",
  }));
  const delistedIn = everList.filter((e) => e.delisted);
  say(`universe membership ${isoDay(isStart)} → ${isoDay(WIN.A.to)}: ${everList.length} pairs ever in it, ${delistedIn.length} of them delisted since (not TRADING in exchangeInfo, or no kline in the archive's last two days): ${delistedIn.map((e) => e.symbol.replace("USDT", "")).join(" ")}`);
  for (const w of WIN_NAMES) {
    const mem = [...perWindowMembers[w]];
    say(`  window ${w}: ${mem.length} pairs pass through the universe, ${mem.filter((i) => delistedOf(i).delisted).length} of them since delisted`);
  }
  const excludedList = b.syms.map((s, i) => ({ s, why: b.excluded[i] })).filter((x) => x.why);
  say(`excluded by construction: ${excludedList.length} of ${b.syms.length} USDT series (${[...new Set(excludedList.map((x) => x.why!.split(":")[0]))].map((k) => `${k} ${excludedList.filter((x) => x.why!.startsWith(k)).length}`).join(", ")})`);
  const reusedEver = everList.filter((e) => e.reused);
  if (reusedEver.length) say(`  segments: ${reusedEver.map((e) => `${e.symbol} ${e.klines.map((g) => `${g.first}→${g.last}`).join(" + ")}`).join(" | ")}`);

  // USDT against USDC over each window (the book is in USDT; the incumbent in USD).
  const usdc = idx.get(USDC);
  const usdtCheck: Record<string, unknown> = {};
  if (usdc !== undefined) {
    for (const w of WIN_NAMES) {
      let mx = 0, at = "";
      for (let D = WIN[w].from; D <= WIN[w].to; D++) {
        const x = b.close[usdc][D - b.day0];
        if (Number.isFinite(x) && Math.abs(x - 1) > mx) { mx = Math.abs(x - 1); at = isoDay(D); }
      }
      usdtCheck[w] = { maxAbsUsdcUsdtCloseMinus1: r6(mx), on: at };
    }
    say(`USDC/USDT daily close, largest |x − 1| per window: ${WIN_NAMES.map((w) => `${w} ${((usdtCheck[w] as { maxAbsUsdcUsdtCloseMinus1: number }).maxAbsUsdcUsdtCloseMinus1 * 1e4).toFixed(1)} bps`).join(", ")}`);
  }

  // ── the incumbent, reproduced ────────────────────────────────────────
  const priced = (tape: Tape, w: WinName) => symbols.filter((s) => series[s].oos[tape][w] != null);
  const barsOf = (s: MeasuredSeries, tape: Tape) => tape === "coinbase" ? { bars: s.comb4h, daily: s.combDaily } : { bars: s.kTape, daily: s.kDaily };
  const incPer: Record<string, Partial<Record<WinName, Record<string, GatedResult>>>> = {};
  let runChecks = 0, runMismatches = 0;
  for (const cond of CONDITIONS) {
    incPer[cond.id] = {};
    for (const w of WIN_NAMES) {
      const per: Record<string, GatedResult> = {};
      for (const s of priced(cond.tape, w)) {
        const ser = series[s], span = ser.oos[cond.tape][w]!;
        const { bars, daily } = barsOf(ser, cond.tape);
        const t: Track = buildTrack(s, bars, daily, DEFAULT_TREND, span.from, span.to);
        const g = runGated(s, t.bars, t.from, t.to, t.warmup, trackDecider(t, rulePolicy), COSTS.revx, stopsOf(cond.stopRule, t.p));
        const rr = run("trend-4h", s, t.bars, t.daily, t.from, t.to, t.p, COSTS.revx, BAR_HOURS, stopsOf(cond.stopRule, t.p));
        runChecks++;
        if (rr.ret !== g.ret || rr.maxDD !== g.maxDD || rr.trades !== g.trades || rr.exposure !== g.exposure) runMismatches++;
        per[s] = g;
      }
      if (Object.keys(per).length) incPer[cond.id][w] = per;
    }
  }
  if (runMismatches) throw new Error(`runGated is not run on ${runMismatches} of ${runChecks} cells`);
  const PUBLISHED: Record<WinName, { ret: number; maxDD: number }> = {
    A: { ret: 0.0803, maxDD: 0.1128 }, B: { ret: 0.2008, maxDD: 0.1047 }, C: { ret: 0.5564, maxDD: 0.0735 }, D: { ret: -0.0781, maxDD: 0.1552 },
  };
  type Set2Rows = Record<string, { perWindow: Record<string, { ret: number; maxDD: number; members: number }> }>;
  const s2 = JSON.parse(await Deno.readTextFile(args.set2)) as { a2_theWeights: { rows: { arm: string; perCondition: Set2Rows }[] } };
  const set2Equal = s2.a2_theWeights.rows.find((r) => r.arm === "equal")?.perCondition;
  if (!set2Equal) throw new Error("set2.json has no `equal` row");
  let reproWorst = 0, pathWorst = 0;
  const reproduction: Record<string, Record<string, unknown>> = {};
  const incPath: Partial<Record<WinName, IncPath>> = {};
  for (const cond of CONDITIONS) {
    reproduction[cond.id] = {};
    for (const w of WIN_NAMES) {
      const per = incPer[cond.id][w];
      if (!per) continue;
      const st = sleeveStatsOf(per), ref = set2Equal[cond.id]?.perWindow?.[w];
      if (!ref) throw new Error(`set2.json has no ${cond.id} ${w}`);
      const pub = cond.id === PRIMARY.id ? PUBLISHED[w] : null;
      reproWorst = Math.max(reproWorst, Math.abs(st.ret - ref.ret), Math.abs(st.maxDD - ref.maxDD), st.members !== ref.members ? 1 : 0);
      if (pub) reproWorst = Math.max(reproWorst, Math.abs(st.ret - pub.ret), Math.abs(st.maxDD - pub.maxDD));
      const path = incumbentPath(per);
      pathWorst = Math.max(pathWorst, Math.abs(r4(path.ret) - st.ret), Math.abs(r4(path.maxDD) - st.maxDD));
      if (cond.id === PRIMARY.id) incPath[w] = path;
      reproduction[cond.id][w] = { here: { ret: st.ret, maxDD: st.maxDD, members: st.members }, set2: { ret: ref.ret, maxDD: ref.maxDD, members: ref.members }, published: pub };
    }
  }
  say(`incumbent: runGated ≡ run on ${runChecks} cells | against set2.json's equal row (four evaluations) and the published primary sleeve: worst |Δ| ${reproWorst} | the day-by-day path re-sums to the same return and drawdown: worst |Δ| ${pathWorst}`);
  say(`  primary (${PRIMARY.id}): ${WIN_NAMES.map((w) => `${w} ${(incPath[w]!.ret * 100).toFixed(2)} % (DD ${(incPath[w]!.maxDD * 100).toFixed(2)} %)`).join(" | ")}`);
  if (reproWorst !== 0 || pathWorst !== 0) throw new Error(`the incumbent does not reproduce: worst |Δ| ${reproWorst} / ${pathWorst}`);

  // ── the simulator's arithmetic, checked by hand-computable cases ────
  const fidelity = simulatorChecks(c, WIN);
  say(`simulator checks: ${fidelity.map((f) => `${f.id} ${f.ok ? "ok" : "FAIL"}`).join(", ")}`);
  if (fidelity.some((f) => !f.ok)) throw new Error("a simulator check failed");

  if (stage === "data") { say("stage data: no candidate arm, no benchmark, nothing written"); return; }

  // ═════════════════════════════════════════ the study (stage full) ═══════
  const cfgOf = (from: number, to: number, k: number, extra: Partial<Cfg> = {}): Cfg =>
    ({ from, to, k, N: UNIVERSE_N, wd: 0, feeBps: FEE_BPS, spreadMult: 1, minUsd: MIN_NOTIONAL_USD, ...extra });
  const GRID: Params[] = [];
  for (const abs of ABS) for (const regime of REGIMES) for (const k of KS) for (const L of LS) GRID.push({ k, L, abs, regime });
  const oosSpan = (w: WinName) => ({ from: WIN[w].from, to: WIN[w].to });
  const isSpan = (w: WinName) => ({ from: isStart, to: WIN[w].from - 1 });
  const summarizeOut = (o: Out, days: number) => ({
    ret: r4(o.ret), maxDD: r4(o.maxDD), retOverDD: r4(score(o.ret, o.maxDD)),
    tradedUsd: r4(o.tradedUsd), turnoverPerYear: r4(o.tradedUsd / CAPITAL_USD / (days / 365)), feeUsd: r4(o.feeUsd), spreadUsd: r4(o.spreadUsd),
    fills: o.fills, rebalances: o.rebalances, forcedExits: o.forcedExits, dustExits: o.dustExits, skippedUnderMinimum: o.skippedSmall,
    avgHeld: r4(o.heldSlotDays / o.n), investedShare: r4(o.investedDays / o.n), cashWeeks: o.m.filter((x) => x === 0).length,
    heldCoins: [...o.heldEver].map((i) => b.syms[i]).sort(),
  });

  // 1. The 36 grid points, in sample and out of sample, every window.
  type Cell = { p: Params; is: Record<WinName, Out>; oos: Record<WinName, Out> };
  const cells: Cell[] = GRID.map((p) => ({ p, is: {} as Record<WinName, Out>, oos: {} as Record<WinName, Out> }));
  for (const cell of cells) for (const w of WIN_NAMES) {
    cell.is[w] = simulate(c, cfgOf(isSpan(w).from, isSpan(w).to, cell.p.k), rulePicker(c, cell.p));
    cell.oos[w] = simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, cell.p.k), rulePicker(c, cell.p));
  }
  say(`grid: ${cells.length} points × ${WIN_NAMES.length} windows, in and out of sample`);

  // 2. The candidates: six filter variants choosing (k, L), and the whole family.
  type Cand = { id: string; filter: string; choices: Record<WinName, Cell> };
  const choose = (pool: Cell[], w: WinName): Cell => {
    let best: Cell | null = null, bs = -Infinity;
    for (const cell of pool) { const s = score(cell.is[w].ret, cell.is[w].maxDD); if (s > bs) { bs = s; best = cell; } }
    return best!;
  };
  const cands: Cand[] = [];
  let ci = 1;
  for (const abs of ABS) for (const regime of REGIMES) {
    const pool = cells.filter((x) => x.p.abs === abs && x.p.regime === regime);
    cands.push({ id: `C${ci++}`, filter: `abs=${abs}, regime=${regime ? "on" : "off"}`, choices: Object.fromEntries(WIN_NAMES.map((w) => [w, choose(pool, w)])) as Record<WinName, Cell> });
  }
  cands.push({ id: "C7", filter: "all 36 points (k, L, abs, regime) chosen in sample", choices: Object.fromEntries(WIN_NAMES.map((w) => [w, choose(cells, w)])) as Record<WinName, Cell> });

  // 3. Nulls: 1,000 matched draws per grid point per window (candidates use their chosen point's).
  const incDays = (w: WinName) => { const p = incPath[w]!; return { cap: p.capital, pnl: p.pnl }; };
  const comboOf = (eq: Float64Array, w: WinName) => {
    // $50 in the xsmom book, $50 in the incumbent (its $ path scaled to $50), no transfer between them.
    const { cap, pnl } = incDays(w);
    let inc = cap, peak = 100, dd = 0, v = 100;
    for (let t = 0; t < WIN[w].days; t++) {
      inc += pnl.get(WIN[w].from + t) ?? 0;
      v = 50 * eq[t] / CAPITAL_USD + 50 * inc / cap;
      peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak);
    }
    return { ret: v / 100 - 1, maxDD: dd };
  };
  type NullSet = { ret: Float64Array; dd: Float64Array; comboRet: Float64Array; comboDD: Float64Array };
  const nulls = new Map<string, NullSet>();
  const buf = new Float64Array(400);
  for (const cell of cells) for (const w of WIN_NAMES) {
    const ns: NullSet = { ret: new Float64Array(NULL_DRAWS), dd: new Float64Array(NULL_DRAWS), comboRet: new Float64Array(NULL_DRAWS), comboDD: new Float64Array(NULL_DRAWS) };
    const ev = { m: cell.oos[w].m, keep: cell.oos[w].keep };
    for (let j = 0; j < NULL_DRAWS; j++) {
      const o = simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, cell.p.k), matchedNull(ev, mulberry32(seedOf("xsmom-null", pkey(cell.p), w, j))), buf);
      ns.ret[j] = o.ret; ns.dd[j] = o.maxDD;
      const cb = comboOf(o.eq, w);
      ns.comboRet[j] = cb.ret; ns.comboDD[j] = cb.maxDD;
    }
    nulls.set(`${pkey(cell.p)}|${w}`, ns);
  }
  say(`nulls: ${nulls.size} × ${NULL_DRAWS} matched draws`);

  // 4. Benchmarks: the whole universe equal-weighted, and BTC bought and held.
  const bench = (w: WinName, N = UNIVERSE_N) => ({
    ew: simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, N, { N, minUsd: 0 }), (_j, _d, U) => { if (U.length !== N) throw new Error(`EW: ${U.length} pairs`); return U; }),
    btc: simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, 1, { minUsd: 0 }), (j) => j === 0 ? [btc] : null),
  });
  const benchmarks = Object.fromEntries(WIN_NAMES.map((w) => [w, bench(w)])) as Record<WinName, { ew: Out; btc: Out }>;
  const FOUR = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"].map((s) => { const i = idx.get(s); if (i === undefined) throw new Error(`no ${s}`); return i; });
  const fourCoin = Object.fromEntries(WIN_NAMES.map((w) => [w, simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, 2), fourCoinPicker(c, FOUR))])) as Record<WinName, Out>;

  // 5. The bar, per candidate — and the same bar applied to every grid point (descriptive).
  const judge = (choices: Record<WinName, Cell>) => {
    const armRet = Object.fromEntries(WIN_NAMES.map((w) => [w, choices[w].oos[w].ret])) as Record<WinName, number>;
    const armWorst = Math.min(...WIN_NAMES.map((w) => armRet[w]));
    const nullWorst = new Float64Array(NULL_DRAWS);
    let nullPasses = 0;
    for (let j = 0; j < NULL_DRAWS; j++) nullWorst[j] = Math.min(...WIN_NAMES.map((w) => nulls.get(`${pkey(choices[w].p)}|${w}`)!.ret[j]));
    const q95 = quantile(nullWorst, 1 - ALPHA);
    for (let j = 0; j < NULL_DRAWS; j++) {
      const a = nulls.get(`${pkey(choices.A.p)}|A`)!.ret[j], bb = nulls.get(`${pkey(choices.B.p)}|B`)!.ret[j];
      if (a > 0 && bb > 0 && nullWorst[j] > q95) nullPasses++;
    }
    const positiveAB = armRet.A > 0 && armRet.B > 0;
    const beatsNull = armWorst > q95;
    return {
      armRet, armWorst, worstWindow: WIN_NAMES.find((w) => armRet[w] === armWorst)!, q95, pNullWorstAtLeastArm: atLeast(nullWorst, armWorst),
      positiveAB, beatsNull, pass: positiveAB && beatsNull, pChance: nullPasses / NULL_DRAWS, nullWorst: stats(nullWorst),
      ddOverLimit: WIN_NAMES.filter((w) => choices[w].oos[w].maxDD > DD_LIMIT),
    };
  };
  const candOut = cands.map((cd) => {
    const j = judge(cd.choices);
    const perWindow = Object.fromEntries(WIN_NAMES.map((w) => {
      const cell = cd.choices[w], ns = nulls.get(`${pkey(cell.p)}|${w}`)!;
      return [w, {
        chosen: { k: cell.p.k, L: cell.p.L, abs: cell.p.abs, regime: cell.p.regime ? "on" : "off" },
        inSample: { from: isoDay(isSpan(w).from), to: isoDay(isSpan(w).to), ret: r4(cell.is[w].ret), maxDD: r4(cell.is[w].maxDD), score: r4(score(cell.is[w].ret, cell.is[w].maxDD)) },
        outOfSample: summarizeOut(cell.oos[w], WIN[w].days),
        null: { ret: stats(ns.ret), pNullAtLeastArm: r4(atLeast(ns.ret, cell.oos[w].ret)) },
      }];
    }));
    return { cd, j, perWindow };
  });
  const gridJudged = cells.map((cell) => ({ cell, j: judge(Object.fromEntries(WIN_NAMES.map((w) => [w, cell])) as Record<WinName, Cell>) }));
  for (const { cd, j } of candOut) {
    say(`${cd.id} (${cd.filter}): ${WIN_NAMES.map((w) => `${w} ${(j.armRet[w] * 100).toFixed(1)} % [${pkey(cd.choices[w].p)}]`).join(" | ")} → worst ${j.worstWindow} ${(j.armWorst * 100).toFixed(2)} % vs null p95 ${(j.q95 * 100).toFixed(2)} % (P ${j.pNullWorstAtLeastArm.toFixed(3)}); A>0 & B>0 ${j.positiveAB} → ${j.pass ? "PASS" : "fail"}`);
  }
  const expected = candOut.reduce((a, x) => a + x.j.pChance, 0);
  const pAnyIndep = 1 - candOut.reduce((a, x) => a * (1 - x.j.pChance), 1);
  const passes = candOut.filter((x) => x.j.pass).length;
  const pObservedIndep = passes > 0 ? poissonBinomialAtLeast(candOut.map((x) => x.j.pChance), passes) : 1;
  const gridPasses = gridJudged.filter((x) => x.j.pass).length;
  const gridExpected = gridJudged.reduce((a, x) => a + x.j.pChance, 0);
  const gridPObserved = gridPasses > 0 ? poissonBinomialAtLeast(gridJudged.map((x) => x.j.pChance), gridPasses) : 1;
  say(`bar: ${passes} of ${candOut.length} candidates pass; chance gives ${expected.toFixed(3)} (P(≥1) ${pAnyIndep.toFixed(3)} if independent, ${Math.max(...candOut.map((x) => x.j.pChance)).toFixed(3)} if identical; P(≥ observed) ${pObservedIndep.toFixed(3)}) | grid points: ${gridPasses} of ${gridJudged.length} pass, chance ${gridExpected.toFixed(2)} (P(≥ observed) ${gridPObserved.toFixed(3)})`);

  // 6. The combination with the incumbent, per candidate and benchmark.
  const combination = (label: string, outs: Record<WinName, Out>, nullSets: Record<WinName, NullSet> | null) => {
    const perWindow: Record<string, unknown> = {};
    const xsAll: number[] = [], incAll: number[] = [];
    const comboRet: Record<WinName, number> = {} as Record<WinName, number>, comboDD: Record<WinName, number> = {} as Record<WinName, number>;
    for (const w of WIN_NAMES) {
      const o = outs[w], { cap, pnl } = incDays(w);
      const xs: number[] = [], ic: number[] = [];
      let prevX = CAPITAL_USD, inc = cap, prevI = cap, incPeak = cap, incDD = 0, exposedDays = 0;
      const xsE: number[] = [], icE: number[] = [];
      for (let t = 0; t < WIN[w].days; t++) {
        const x = o.eq[t];
        inc += pnl.get(WIN[w].from + t) ?? 0;
        const rx = x / prevX - 1, ri = inc / prevI - 1;
        xs.push(rx); ic.push(ri);
        if (ri !== 0) { exposedDays++; xsE.push(rx); icE.push(ri); }
        prevX = x; prevI = inc; incPeak = Math.max(incPeak, inc); incDD = Math.max(incDD, 1 - inc / incPeak);
      }
      xsAll.push(...xs); incAll.push(...ic);
      const cb = comboOf(o.eq, w);
      comboRet[w] = cb.ret; comboDD[w] = cb.maxDD;
      perWindow[w] = {
        correlationDaily: pearson(xs, ic) === null ? null : r4(pearson(xs, ic)!), correlationOnIncumbentExposedDays: pearson(xsE, icE) === null ? null : r4(pearson(xsE, icE)!), incumbentExposedDays: exposedDays,
        xsmom: { ret: r4(o.ret), maxDD: r4(o.maxDD), retOverDD: r4(score(o.ret, o.maxDD)) },
        incumbentOnThisCalendar: { ret: r4(inc / cap - 1), maxDD: r4(incDD), retOverDD: r4(score(inc / cap - 1, incDD)), capitalUsd: cap },
        halfEach: { ret: r4(cb.ret), maxDD: r4(cb.maxDD), retOverDD: r4(score(cb.ret, cb.maxDD)) },
        nullHalfEach: nullSets ? { ret: stats(nullSets[w].comboRet), pNullAtLeast: r4(atLeast(nullSets[w].comboRet, cb.ret)) } : null,
      };
    }
    const incRetCal = (w: WinName) => { const { cap, pnl } = incDays(w); let inc = cap; for (let t = 0; t < WIN[w].days; t++) inc += pnl.get(WIN[w].from + t) ?? 0; return inc / cap - 1; };
    const incWorst = Math.min(...WIN_NAMES.map(incRetCal));
    const worstCombo = Math.min(...WIN_NAMES.map((w) => comboRet[w]));
    const worstComboScore = Math.min(...WIN_NAMES.map((w) => score(comboRet[w], comboDD[w])));
    let pNullCombo: number | null = null;
    if (nullSets) {
      const nw = new Float64Array(NULL_DRAWS);
      for (let j = 0; j < NULL_DRAWS; j++) nw[j] = Math.min(...WIN_NAMES.map((w) => nullSets[w].comboRet[j]));
      pNullCombo = r4(atLeast(nw, worstCombo));
    }
    return {
      label, perWindow, correlationDailyPooled: pearson(xsAll, incAll) === null ? null : r4(pearson(xsAll, incAll)!),
      worst: { halfEachRet: r4(worstCombo), halfEachScore: r4(worstComboScore), incumbentRetOnThisCalendar: r4(incWorst) },
      pNullHalfEachWorstAtLeast: pNullCombo,
    };
  };
  const incScoreWorst = Math.min(...WIN_NAMES.map((w) => { const { cap, pnl } = incDays(w); let inc = cap, pk = cap, dd = 0; for (let t = 0; t < WIN[w].days; t++) { inc += pnl.get(WIN[w].from + t) ?? 0; pk = Math.max(pk, inc); dd = Math.max(dd, 1 - inc / pk); } return score(inc / cap - 1, dd); }));
  const combos = candOut.map(({ cd, j }) => {
    const outs = Object.fromEntries(WIN_NAMES.map((w) => [w, cd.choices[w].oos[w]])) as Record<WinName, Out>;
    const ns = Object.fromEntries(WIN_NAMES.map((w) => [w, nulls.get(`${pkey(cd.choices[w].p)}|${w}`)!])) as Record<WinName, NullSet>;
    const cmb = combination(cd.id, outs, ns);
    const addsOnNumbers = cmb.worst.halfEachRet > cmb.worst.incumbentRetOnThisCalendar && cmb.worst.halfEachScore > incScoreWorst;
    return { ...cmb, addsOnNumbers, beatsNullCombination: cmb.pNullHalfEachWorstAtLeast !== null && cmb.pNullHalfEachWorstAtLeast < ALPHA, adds: j.pass && addsOnNumbers && cmb.pNullHalfEachWorstAtLeast !== null && cmb.pNullHalfEachWorstAtLeast < ALPHA };
  });
  const comboBench = {
    ew: combination("universe equal-weight", Object.fromEntries(WIN_NAMES.map((w) => [w, benchmarks[w].ew])) as Record<WinName, Out>, null),
    btc: combination("BTC buy-and-hold", Object.fromEntries(WIN_NAMES.map((w) => [w, benchmarks[w].btc])) as Record<WinName, Out>, null),
  };
  for (const cmb of combos) say(`combo ${cmb.label}: corr ${cmb.correlationDailyPooled} | half-each worst ${(cmb.worst.halfEachRet * 100).toFixed(2)} % (score ${cmb.worst.halfEachScore}) vs incumbent ${(cmb.worst.incumbentRetOnThisCalendar * 100).toFixed(2)} % (score ${incScoreWorst.toFixed(3)}); P(null combo ≥) ${cmb.pNullHalfEachWorstAtLeast} → adds ${cmb.adds}`);

  // 7. Descriptive: BNB fee, spreads doubled, the rebalance weekday, the literal null, the universe size.
  const reprice = (cd: Cand, extra: Partial<Cfg>) => Object.fromEntries(WIN_NAMES.map((w) => {
    const cell = cd.choices[w];
    return [w, r4(simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, cell.p.k, extra), rulePicker(c, cell.p)).ret)];
  }));
  const sensitivities = candOut.map(({ cd, j }) => {
    const weekday = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((wd) => [["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][wd], reprice(cd, { wd })]));
    for (const w of WIN_NAMES) if (weekday.Mon[w] !== r4(j.armRet[w])) throw new Error(`${cd.id} ${w}: the Monday re-run ${weekday.Mon[w]} is not the primary ${r4(j.armRet[w])}`);
    return { id: cd.id, bnbFee75: reprice(cd, { feeBps: FEE_BPS_BNB }), spreadDoubled: reprice(cd, { spreadMult: 2 }), weekday };
  });
  const literal: Record<string, Record<string, unknown>> = {};
  for (const k of KS) {
    literal[`k${k}`] = {};
    for (const w of WIN_NAMES) {
      const r = new Float64Array(NULL_DRAWS);
      for (let j = 0; j < NULL_DRAWS; j++) r[j] = simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, k), literalNull(k, mulberry32(seedOf("xsmom-literal", k, w, j))), buf).ret;
      literal[`k${k}`][w] = stats(r);
    }
  }
  const universeSize: Record<string, unknown> = {};
  for (const N of UNIVERSE_N_SENS) {
    const cellsN = GRID.map((p) => ({ p, is: {} as Record<WinName, Out>, oos: {} as Record<WinName, Out> }));
    for (const cell of cellsN) for (const w of WIN_NAMES) {
      cell.is[w] = simulate(c, cfgOf(isSpan(w).from, isSpan(w).to, cell.p.k, { N }), rulePicker(c, cell.p));
      cell.oos[w] = simulate(c, cfgOf(oosSpan(w).from, oosSpan(w).to, cell.p.k, { N }), rulePicker(c, cell.p));
    }
    universeSize[`N${N}`] = {
      c7: Object.fromEntries(WIN_NAMES.map((w) => { const ch = choose(cellsN, w); return [w, { chosen: pkey(ch.p), ret: r4(ch.oos[w].ret), maxDD: r4(ch.oos[w].maxDD) }]; })),
      gridPositiveShare: Object.fromEntries(WIN_NAMES.map((w) => [w, r4(cellsN.filter((x) => x.oos[w].ret > 0).length / cellsN.length)])),
      universeEqualWeight: Object.fromEntries(WIN_NAMES.map((w) => [w, r4(bench(w, N).ew.ret)])),
    };
  }
  say("sensitivities done");

  // ── the output ───────────────────────────────────────────────────────
  const hashesEnd = await hashSources();
  if (JSON.stringify(hashesStart) !== JSON.stringify(hashesEnd)) throw new Error("a source file changed while the study ran");
  const inputsEnd = await hashInputs();
  if (JSON.stringify(inputsStart) !== JSON.stringify(inputsEnd)) throw new Error("an input file changed while the study ran");
  const heldDelisted = new Set<number>();
  for (const { cd } of candOut) for (const w of WIN_NAMES) for (const s of cd.choices[w].oos[w].heldEver) if (delistedOf(s).delisted) heldDelisted.add(s);
  const out = {
    study: "long-only weekly cross-sectional momentum over a point-in-time top-30 Binance USDT universe (delisted pairs included), seven pre-registered candidates judged by the bar, against a turnover- and exposure-matched random-selection null; combined with the incumbent Revolut X row trend-4h",
    preRegistration: { path: args.prereg, sha256: inputsStart.prereg },
    bar: `a candidate passes when its out-of-sample return is positive on BOTH windows A and B, AND its worst window of A–D is above the 95th percentile (s[floor(0.95·n)], n = ${NULL_DRAWS}) of its matched null's worst window. §4.15's ${DD_LIMIT * 100} % drawdown limit is reported beside it.`,
    definitions: {
      capitalUsd: CAPITAL_USD, minNotionalUsd: MIN_NOTIONAL_USD, feeBps: FEE_BPS, feeBpsBnbVariant: FEE_BPS_BNB,
      universe: { n: UNIVERSE_N, volumeDays: VOL_DAYS, minAgeDays: MIN_AGE_DAYS, gapBridgeDays: GAP_BRIDGE_DAYS, rank: "30-day quote volume, ties by symbol" },
      rebalance: "weekly: decide on Sunday's close (UTC), fill at Monday's open; each run also forms on its first day",
      family: { k: KS, L: LS, abs: ABS, regime: ["off", "on"], maDays: MA_DAYS, btcMaDays: BTC_MA_DAYS, order: "abs × regime × k × L" },
      selection: "best in-sample return / max(0.05, drawdown); first in grid order on a tie",
      windows: Object.fromEntries(WIN_NAMES.map((w) => [w, { oos: `${isoDay(WIN[w].from)} → ${isoDay(WIN[w].to)}`, days: WIN[w].days, inSample: `${isoDay(isStart)} → ${isoDay(WIN[w].from - 1)}` }])),
      isStart: isoDay(isStart),
      spreads: { measured: Object.fromEntries(measuredNames.map((s) => [s, { n: measured[s].n, medianFullBps: r4(measured[s].medianFullBps) }])), unmeasuredFullBps: r4(unmeasuredFullBps), rule: "half the median full spread per side; unmeasured pairs the widest measured median" },
      nullDraws: NULL_DRAWS,
    },
    inputs: {
      klinesManifestSha256: inputsStart.manifest, archiveListedAt: manifest.listed_at, bucket: manifest.bucket, filesHost: manifest.files_host,
      archiveZips: Object.keys(manifest.raw).length, usdtSeries: b.syms.length, calendar: `${isoDay(b.day0)} → ${isoDay(b.lastDay)}`,
      exchangeInfoSha256: inputsStart.exchangeInfo, set2Sha256: inputsStart.set2, bookSamplesSha256: inputsStart.bookSamples,
      excluded: excludedList.map((x) => ({ symbol: x.s, why: x.why })),
      everInUniverse: everList, everInUniverseCount: everList.length, delistedEverInUniverse: delistedIn.map((e) => e.symbol),
      perWindowUniverse: Object.fromEntries(["IS", ...WIN_NAMES].map((w) => [w, { pairs: perWindowMembers[w].size, delisted: [...perWindowMembers[w]].filter((i) => delistedOf(i).delisted).map((i) => b.syms[i]).sort() }])),
      delistedHeldByACandidate: [...heldDelisted].map((i) => b.syms[i]).sort(),
      usdcUsdt: usdtCheck,
    },
    reproduction: { incumbent: reproduction, runGatedVsRun: { cells: runChecks, mismatches: runMismatches }, worstAbsDiff: reproWorst, pathWorstAbsDiff: pathWorst, simulatorChecks: fidelity },
    candidates: candOut.map(({ cd, j, perWindow }) => ({
      id: cd.id, filter: cd.filter, perWindow,
      verdict: {
        armRet: Object.fromEntries(WIN_NAMES.map((w) => [w, r4(j.armRet[w])])), worstWindow: j.worstWindow, armWorst: r4(j.armWorst),
        nullWorstP95: r4(j.q95), nullWorst: j.nullWorst, pNullWorstAtLeastArm: r4(j.pNullWorstAtLeastArm),
        positiveAB: j.positiveAB, beatsNull: j.beatsNull, pass: j.pass, windowsOverDrawdownLimit: j.ddOverLimit, pChancePass: r4(j.pChance),
      },
    })),
    grid: gridJudged.map(({ cell, j }) => ({
      point: pkey(cell.p),
      oos: Object.fromEntries(WIN_NAMES.map((w) => [w, { ret: r4(cell.oos[w].ret), maxDD: r4(cell.oos[w].maxDD), turnoverPerYear: r4(cell.oos[w].tradedUsd / CAPITAL_USD / (WIN[w].days / 365)), nullP95: r4(quantile(nulls.get(`${pkey(cell.p)}|${w}`)!.ret, 0.95)) }])),
      inSampleScore: Object.fromEntries(WIN_NAMES.map((w) => [w, r4(score(cell.is[w].ret, cell.is[w].maxDD))])),
      worst: r4(j.armWorst), nullWorstP95: r4(j.q95), pass: j.pass, pChancePass: r4(j.pChance),
    })),
    gridPositiveShare: Object.fromEntries(WIN_NAMES.map((w) => [w, r4(cells.filter((x) => x.oos[w].ret > 0).length / cells.length)])),
    benchmarks: Object.fromEntries(WIN_NAMES.map((w) => [w, { universeEqualWeight: summarizeOut(benchmarks[w].ew, WIN[w].days), btcBuyAndHold: summarizeOut(benchmarks[w].btc, WIN[w].days) }])),
    fourCoinControl: { rule: "descriptive, never a candidate: top 2 of BTC/ETH/SOL/XRP USDT by 28-day return, each held only above its 100-day mean, weekly, this engine and costs", perWindow: Object.fromEntries(WIN_NAMES.map((w) => [w, summarizeOut(fourCoin[w], WIN[w].days)])) },
    chance: {
      candidates: candOut.length, passes, expectedByChance: r4(expected), pAtLeastOneIfIndependent: r4(pAnyIndep), pAtLeastOneIfIdentical: r4(Math.max(...candOut.map((x) => x.j.pChance))),
      pAtLeastObservedIfIndependent: r4(pObservedIndep), beatsChance: passes > 0 && pObservedIndep < ALPHA,
      method: "for each candidate, the share of its 1,000 matched-null draws that pass the same bar (A > 0, B > 0, worst window above the candidate's own null p95); summed over candidates; P(≥ observed) is the exact Poisson-binomial tail over those shares",
      gridPoints: gridJudged.length, gridPasses, gridExpectedByChance: r4(gridExpected), gridPAtLeastObservedIfIndependent: r4(gridPObserved),
      looks: { candidateWindows: candOut.length * WIN_NAMES.length, gridOutOfSample: cells.length * WIN_NAMES.length, gridInSample: cells.length * WIN_NAMES.length },
    },
    combination: { rule: "$50 in the xsmom book and $50 in the incumbent (primary evaluation), each compounding in its own account, summed; on the xsmom window calendar", incumbentWorstScoreOnThisCalendar: r4(incScoreWorst), candidates: combos, benchmarks: comboBench },
    sensitivities: { perCandidate: sensitivities, literalNull: literal, universeSize, note: "descriptive only; none decides" },
    corrections: [{
      id: 1, at: "2026-09-23 07:14 UTC, after the first full run was seen",
      what: "GAP_BRIDGE_DAYS 7 → 0: the archive's 3–7-day gaps are token redenominations (BNX ×0.01, BTCST ×0.1, COCOS ×1000, DREP ×100, QUICK ×0.001, STRAX ×0.1, SUN ×0.001 across the gap); bridging them made fake price moves. Every missing day now starts a new segment (the archive has no one-day gap).",
      uncorrectedOutput: "the first run's output, kept in the session that ran it and not in the repository, sha256 08ac17d8202f788fb6027dfca9e461fc63f3f1ddb3f35c8f34d5fad580c6766d",
    }],
    determinism: "no wall-clock field; every draw is mulberry32(seedOf(purpose, point, window, draw))",
    sourceIntegrity: { start: hashesStart, end: hashesEnd, inputs: inputsStart },
  };
  const text = JSON.stringify(out, null, 1) + "\n";
  await Deno.writeTextFile(`${args.out}/xsmom.json`, text);
  say(`wrote ${args.out}/xsmom.json, sha256 ${await sha256Text(text)}`);
}

// ───────────────────────────────────────── hand-computable simulator checks

function simulatorChecks(c: Ctx, WIN: Record<WinName, { from: number; to: number; days: number }>): { id: string; ok: boolean; detail: string }[] {
  const b = c.b, out: { id: string; ok: boolean; detail: string }[] = [];
  const btc = c.btc;
  const from = WIN.A.from, to = WIN.A.to;
  // 1. BTC bought at the first open and held: the end equity is 100 / (1 + fee) / (open·(1 + hs)) × close_end.
  {
    const o = simulate(c, { from, to, k: 1, N: UNIVERSE_N, wd: 0, feeBps: FEE_BPS, spreadMult: 1, minUsd: 0 }, (j) => j === 0 ? [btc] : null);
    const px = b.open[btc][from - b.day0], hs = c.halfSpread[btc];
    const units = (CAPITAL_USD / (1 + FEE_BPS / 1e4)) / (px * (1 + hs));
    const want = units * b.cff[btc][to - b.day0] / CAPITAL_USD - 1;
    out.push({ id: "btcHold", ok: Math.abs(o.ret - want) < 1e-12 && o.fills === 1, detail: `ret ${o.ret} vs ${want}` });
  }
  // 2. Zero cost, no minimum: a fixed one-coin book re-bought every week equals holding it (no trades after the first).
  {
    const cfg = { from, to, k: 1, N: UNIVERSE_N, wd: 0, feeBps: 0, spreadMult: 0, minUsd: 0 };
    const hold = simulate(c, cfg, (j) => j === 0 ? [btc] : null);
    const weekly = simulate(c, cfg, () => [btc]);
    out.push({ id: "zeroCostWeekly", ok: Math.abs(hold.ret - weekly.ret) < 1e-12 && weekly.fills === 1, detail: `${hold.ret} vs ${weekly.ret}, fills ${weekly.fills}` });
  }
  // 3. A round trip costs exactly 2 × fee + the full spread: buy BTC on day 0, sell it on the next rebalance, compare.
  {
    const cfg = { from, to, k: 1, N: UNIVERSE_N, wd: 0, feeBps: FEE_BPS, spreadMult: 1, minUsd: 0 };
    const o = simulate(c, cfg, (j) => j === 0 ? [btc] : j === 1 ? [] : null);
    let d1 = from + 1;
    while (!isRebalance(d1, 0)) d1++;
    const f = FEE_BPS / 1e4, hs = c.halfSpread[btc];
    const units = (CAPITAL_USD / (1 + f)) / (b.open[btc][from - b.day0] * (1 + hs));
    const want = units * b.open[btc][d1 - b.day0] * (1 - hs) * (1 - f) / CAPITAL_USD - 1;
    out.push({ id: "roundTrip", ok: Math.abs(o.ret - want) < 1e-12 && o.fills === 2, detail: `${o.ret} vs ${want}` });
  }
  // 4. The matched null holds exactly the candidate's number of coins at every rebalance, and never keeps MORE
  //    than the candidate kept (it keeps fewer only when its own holdings left the universe; counted).
  {
    // A synthetic path, not a family point: the top m by 30-day volume, m cycling 5, 3, 0, 4 (cash weeks and partial books).
    const synth: Picker = (j, _d, U) => U.slice(0, [5, 3, 0, 4][j % 4]);
    const cand = simulate(c, { from, to, k: 5, N: UNIVERSE_N, wd: 0, feeBps: FEE_BPS, spreadMult: 1, minUsd: MIN_NOTIONAL_USD }, synth);
    const nl = simulate(c, { from, to, k: 5, N: UNIVERSE_N, wd: 0, feeBps: FEE_BPS, spreadMult: 1, minUsd: MIN_NOTIONAL_USD }, matchedNull({ m: cand.m, keep: cand.keep }, mulberry32(seedOf("xsmom-check", 1))));
    const sameM = JSON.stringify(cand.m) === JSON.stringify(nl.m);
    let over = 0, under = 0;
    for (let j = 0; j < cand.keep.length; j++) { if (nl.keep[j] > cand.keep[j]) over++; if (nl.keep[j] < cand.keep[j]) under++; }
    out.push({ id: "nullMatchesSlots", ok: sameM && over === 0, detail: `slots equal ${sameM} over ${cand.m.length} rebalances; kept more ${over}, kept fewer ${under}` });
  }
  return out;
}

if (import.meta.main) {
  const args: Record<string, string> = {};
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (a.startsWith("--")) { const nx = Deno.args[i + 1]; if (nx && !nx.startsWith("--")) { args[a.slice(2)] = nx; i++; } else args[a.slice(2)] = "true"; }
  }
  await main(args);
}
