// The BINANCE-COST study: what the live row's coins, SUI's seat and §4.15's
// screen become if the same orders were executed at Binance spot's cost
// instead of Revolut X UK's — the same rule, windows, tapes, stops and
// evaluations the project already uses, with ONLY the cost changed.
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_binance.ts \
//     --data   <dir with BTC-USD_1h_3y.json …>       (Coinbase Exchange hourly, 3 y)
//     --ext    <dir with BTC-USD_1h_kraken.json …>   (Kraken quarterly bundle, hourly)
//     --ktape  <dir with BTC-USD_4h_kraken.json …>   (Kraken's own 4 h tape, full span)
//     --tape   docs/agents/backtests/tape.json       (cross-check: every §4.15 cell, both venues)
//     --set2   docs/agents/backtests/set2.json       (cross-check: the live sleeve, four windows)
//     --sui    docs/agents/backtests/sui.json        (cross-check: §3.20's folds and its primary test)
//     --books  <dir with the raw book samples>       (optional: re-derives the book constants below)
//     --prereg <the pre-registration file>           (optional: its SHA-256 is written into the output)
//     --arms   revx,revxMedian,binance,binanceBnb    (optional: the cost arms priced; revx is always priced)
//     --out    docs/agents/backtests
//
// Writes `<out>/binance.json` and NOTHING else.
//
// ── the question ──────────────────────────────────────────────────────
//
// Davies holds a Binance spot account (UK retail, unfunded): 0.10 % maker and
// 0.10 % taker at his tier, 0.075 % with the BNB discount. Revolut X is 0 %
// maker / 0.09 % taker and the loop takes the touch there. Three questions:
// (1) each live coin's result at Binance's cost, on the same windows, tapes,
// stops and evaluations; (2) SUI's seat — §3.20's pre-registered rank test —
// re-run with the row priced at Binance's cost; (3) §3.8's two-window screen
// and §4.15's bar over the whole universe at Binance's cost, against chance.
// Whether Binance may serve a UK account is NOT this file's question.
//
// ── the cost arms ─────────────────────────────────────────────────────
//
//   `revx`       — `COSTS.revx`, untouched: the reproduction. Every published
//                  number below is re-derived from it before any other arm is read.
//   `binance`    — 10 bps a side (maker = taker at the tier), the order takes the
//                  touch as the loop does on Revolut X (`fillFee: "taker"`), plus
//                  half of Binance's MEASURED median full spread a side.
//   `binanceBnb` — the same at 7.5 bps a side (the BNB fee discount).
//   `kraken`     — `COSTS.kraken`, untouched: the second fee schedule §4.15's
//                  fourth test prices every arm against.
//   `revxMedian` — DESCRIPTIVE ONLY: `revx` with SUI charged §3.20's measured
//                  median UK spread (14.877 bps) instead of `COSTS.revx`'s 23.94.
//                  Reported beside the others for SUI, the sleeve and SUI's seat;
//                  never a venue in the screen, never read for a verdict.
// A round trip is therefore 2 × fee + the full spread. What no arm models: the
// USDT/USD basis (Binance quotes USDT; every tape here is USD), converting GBP
// to USDT, the price risk of holding BNB for the discount, and depth beyond the
// touch (a $20 order is far inside it on every pair priced).
//
// ── what is imported, what is copied, and what is NOT copied ──────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf` are IMPORTED. Nothing that costs money is re-implemented and NO
// copy of `run` exists in this file: a Binance arm is a `Costs` object handed to
// `run`, exactly as `COSTS.revx` is. The arithmetic on outputs — `median` …
// `rankSumTest`, `windowsOn`, `tapeAgreement`, `runDaily`, `prefixCheck` — is
// copied VERBATIM from `backtest_sui.ts` (which copied it from `backtest_set2.ts`
// / `backtest_tape.ts`), and `hyper` / `intersectionDistribution` from
// `backtest_tape.ts`; none of those files export them, and none touches a price,
// a fee or a fill. The series, windows, coverage rule, grid and `studyVenue` are
// `backtest_tape.ts`'s, with the venue list widened; `judgeFive`, the spans and
// the folds are `backtest_sui.ts`'s, with the cost arm as a parameter.
//
// ── fidelity: the reproduction comes first ────────────────────────────
//
// `fidelity.vsTape`: every §4.15 cell in `tape.json` (27 coins, both venues,
// both tapes, both stop rules), recomputed and compared field by field.
// `fidelity.vsSet2`: the live sleeve on four windows × four conditions.
// `fidelity.vsSui`: §3.20's seven folds, its primary rank test and its span
// contributions. `fidelity.runDaily`: every daily mark checked against `run`'s
// own curve. `fidelity.bookConstants`: the book constants below re-derived from
// the raw samples when `--books` is given.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall-clock or runtime field is written. Re-running over the same inputs
// reproduces this file byte for byte. Every null is enumerated exactly, never
// sampled. `backtest.ts` is SHA-256'd at the start and the end of the run.

import { DEFAULT_TREND, type Candle, type StrategyKind, type TrendParams } from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────────── facts, not guesses

/** Revolut X UK-book 24 h quote volume, reference §3.8 — the figures `tape.json` carries (copied from `backtest_tape.ts`). */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "XRP/USD": 2_600_000,
  "AAVE/USD": 54_000, "DOGE/USD": 199_000, "LINK/USD": 693_000, "UNI/USD": 159_000, "ADA/USD": 122_000,
  "LTC/USD": 44_000, "BNB/USD": 19_000, "AVAX/USD": 1_900_000, "HBAR/USD": 114_000, "SHIB/USD": 11_000,
  "XLM/USD": 176_000, "PEPE/USD": 102_000, "DOT/USD": 769_000, "ALGO/USD": 180_000, "BCH/USD": 928_000,
  "ATOM/USD": 17_000, "SUI/USD": 942_000, "HYPE/USD": 123_000, "NEAR/USD": 2_800_000, "ICP/USD": 171_000,
  "ETC/USD": 8_000, "POL/USD": 11_000, "TON/USD": 8_000,
};
/** Kraken 24 h quote volume, reference §3.12 — the figures `tape.json` carries (copied from `backtest_tape.ts`). */
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 415_926_026, "ETH/USD": 211_257_776, "SOL/USD": 89_808_255, "XRP/USD": 115_479_491,
  "DOGE/USD": 26_124_284, "LINK/USD": 13_164_095, "ADA/USD": 15_830_445, "AVAX/USD": 19_643_858,
  "BNB/USD": 2_563_680, "HYPE/USD": 18_493_063, "XLM/USD": 7_721_199, "UNI/USD": 14_812_551,
  "NEAR/USD": 35_996_883, "BCH/USD": 3_924_414, "LTC/USD": 13_486_524, "SUI/USD": 36_150_670,
  "DOT/USD": 1_422_526, "HBAR/USD": 3_495_175, "TON/USD": 1_200_158, "SHIB/USD": 1_771_678,
  "PEPE/USD": 15_044_906, "AAVE/USD": 5_518_518, "ETC/USD": 326_847, "ALGO/USD": 2_194_523,
  "ICP/USD": 2_156_769, "POL/USD": 2_300_203, "ATOM/USD": 665_938,
};
const MIN_BOOK_USD = 100_000;

/** The live row as the go-live draft writes it. */
const LIVE_ROW = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100 };
const SUI = "SUI/USD";
const SLOT_USD = LIVE_ROW.capitalUsd / LIVE_ROW.symbols.length; // $20

/** The acceptance tests §3.15 declared before comparing the sources, and the floors set2 declared; identical here. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
const MIN_IN_SAMPLE_DAYS = 180;
/** The stop rule §3.7 / §3.8 / §3.10 / §3.11 were computed under: the floor PLUS the intra-bar 3×ATR trail. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };
const MAX_LOOKBACK = 301;
/** The fold length aimed at; the span is tiled by the whole number of folds nearest to it (§3.20). */
const FOLD_TARGET_DAYS = 182;

// ───────────────────────────────────────────── Binance, measured (keyless, public market data only)

/** Davies' tier as stated for this study: maker = taker. Per side, in bps. */
const BINANCE_FEE_BPS = { standard: 10, bnb: 7.5 } as const;

type BookStat = { n: number; median: number; p10: number; p90: number; min: number; max: number };

/**
 * The five live coins, from the paired sampler already on disk (`paired_samples.jsonl`): Revolut X's public UK
 * order book (`/api/2.0/public/order-book/{SYM}?region=UK`) and Binance's `bookTicker` in the same half-minute,
 * 20 samples ~30 s apart. Full spread in bps, (ask − bid) / mid × 1e4, as the sampler recorded it. The Binance
 * side is what the arms charge the five; the Revolut X side is REPORTED beside `COSTS.revx`, never charged.
 */
const PAIRED_FIVE: { source: string; window: string; samples: number; binance: Record<string, BookStat>; revxUk: Record<string, BookStat> } = {
  source: "paired_samples.jsonl — Revolut X GET /api/2.0/public/order-book/{SYM}?region=UK&limit=5 and Binance GET data-api.binance.vision/api/v3/ticker/bookTicker (both keyless), same half-minute",
  window: "2026-09-23 02:21:32 → 02:31:10 UTC",
  samples: 20,
  binance: {
    "AVAX/USD": { n: 20, median: 0.898, p10: 0.897, p90: 0.9, min: 0.894, max: 1.796 },
    "BTC/USD": { n: 20, median: 0.001, p10: 0.001, p90: 0.001, min: 0.001, max: 0.001 },
    "ETH/USD": { n: 20, median: 0.036, p10: 0.036, p90: 0.036, min: 0.036, max: 0.036 },
    "SOL/USD": { n: 20, median: 0.844, p10: 0.844, p90: 0.845, min: 0.844, max: 0.845 },
    "SUI/USD": { n: 20, median: 0.979, p10: 0.977, p90: 0.982, min: 0.976, max: 0.982 },
  },
  revxUk: {
    "AVAX/USD": { n: 20, median: 8.988, p10: 7.177, p90: 10.762, min: 7.152, max: 10.792 },
    "BTC/USD": { n: 20, median: 1.628, p10: 1.101, p90: 1.939, min: 0.857, max: 2.446 },
    "ETH/USD": { n: 20, median: 1.758, p10: 1.269, p90: 2.247, min: 1.232, max: 2.5 },
    "SOL/USD": { n: 20, median: 3.632, p10: 3.122, p90: 4.643, min: 2.873, max: 4.9 },
    "SUI/USD": { n: 20, median: 23.561, p10: 22.555, p90: 25.463, min: 21.55, max: 44.012 },
  },
};

/**
 * Every other coin, sampled for this study: `GET https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=[…]`
 * (keyless), the <COIN>USDT pair of every coin in `COSTS`, every 60 s on a monotonic clock. Full spread in bps.
 */
const BINANCE_BOOK_OWN: { source: string; window: string; samples: number; fullSpreadBps: Record<string, BookStat>; noBook: Record<string, string>; notListed: Record<string, string> } = {
  source: "binance_cost_bookticker_samples.jsonl — GET https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=[…] (keyless), 26 USDT pairs, every 60 s",
  window: "2026-09-23 02:44:08 → 03:08:08 UTC",
  samples: 25,
  fullSpreadBps: {
    "AAVE/USD": { n: 25, median: 0.675, p10: 0.674, p90: 0.678, min: 0.673, max: 0.68 },
    "ADA/USD": { n: 25, median: 3.916, p10: 3.902, p90: 3.924, min: 3.901, max: 3.929 },
    "ALGO/USD": { n: 25, median: 8.846, p10: 8.83, p90: 8.846, min: 8.83, max: 17.699 },
    "ATOM/USD": { n: 25, median: 5.436, p10: 5.427, p90: 5.46, min: 5.419, max: 10.917 },
    "AVAX/USD": { n: 25, median: 0.888, p10: 0.887, p90: 0.891, min: 0.887, max: 0.891 },
    "BCH/USD": { n: 25, median: 2.933, p10: 2.918, p90: 2.952, min: 2.912, max: 2.966 },
    "BNB/USD": { n: 25, median: 0.126, p10: 0.126, p90: 0.126, min: 0.126, max: 0.126 },
    "BTC/USD": { n: 25, median: 0.001, p10: 0.001, p90: 0.001, min: 0.001, max: 0.001 },
    "DOGE/USD": { n: 25, median: 0.976, p10: 0.965, p90: 0.981, min: 0.964, max: 0.983 },
    "DOT/USD": { n: 25, median: 8.282, p10: 8.254, p90: 8.316, min: 8.247, max: 8.323 },
    "ETC/USD": { n: 25, median: 10.521, p10: 10.477, p90: 10.565, min: 10.466, max: 10.576 },
    "ETH/USD": { n: 25, median: 0.036, p10: 0.036, p90: 0.036, min: 0.036, max: 0.036 },
    "HBAR/USD": { n: 25, median: 0.996, p10: 0.99, p90: 0.998, min: 0.987, max: 1.985 },
    "ICP/USD": { n: 25, median: 3.332, p10: 3.321, p90: 3.339, min: 3.321, max: 6.678 },
    "LINK/USD": { n: 25, median: 0.766, p10: 0.764, p90: 0.767, min: 0.764, max: 0.768 },
    "LTC/USD": { n: 25, median: 1.593, p10: 1.589, p90: 1.596, min: 1.588, max: 1.596 },
    "NEAR/USD": { n: 25, median: 2.313, p10: 2.303, p90: 2.327, min: 2.3, max: 2.33 },
    "PEPE/USD": { n: 25, median: 20.429, p10: 20.305, p90: 20.471, min: 20.305, max: 20.471 },
    "POL/USD": { n: 25, median: 0.914, p10: 0.912, p90: 1.831, min: 0.912, max: 2.744 },
    "SHIB/USD": { n: 25, median: 16.273, p10: 16.221, p90: 16.327, min: 16.221, max: 16.353 },
    "SOL/USD": { n: 25, median: 0.845, p10: 0.844, p90: 0.846, min: 0.844, max: 0.846 },
    "SUI/USD": { n: 25, median: 0.975, p10: 0.973, p90: 0.977, min: 0.971, max: 0.977 },
    "UNI/USD": { n: 25, median: 0.938, p10: 0.925, p90: 0.945, min: 0.922, max: 1.866 },
    "XLM/USD": { n: 25, median: 4.578, p10: 4.557, p90: 4.588, min: 4.557, max: 4.595 },
    "XRP/USD": { n: 25, median: 0.628, p10: 0.625, p90: 0.629, min: 0.625, max: 0.63 },
  },
  noBook: {"TON/USD": "pair listed in status BREAK; bid = ask = 0 in 25 of 25 samples"},
  notListed: {"HYPE/USD": "no <COIN>USDT, USDC or USD spot pair in keyless exchangeInfo (permissions=SPOT) at 2026-09-23 02:43 UTC"},
};

/** Binance's own 24 h quote volume on each <COIN>USDT pair (keyless `ticker/24hr`), at the start and the end of the sampling window. The START reading is the book leg; the end one is the check. */
const BINANCE_24H_QUOTE_USD: { source: string; start: { fetchedAt: string; usd: Record<string, number> }; end: { fetchedAt: string; usd: Record<string, number> }; status: Record<string, string> } = {
  source: "GET https://data-api.binance.vision/api/v3/ticker/24hr?symbols=[…] (keyless) — quoteVolume of <COIN>USDT; status from GET /api/v3/exchangeInfo?permissions=SPOT (keyless)",
  start: { fetchedAt: "2026-09-23 02:44:07 UTC", usd: { "AAVE": 20618180, "ADA": 72797370, "ALGO": 3978169, "ATOM": 4185642, "AVAX": 60570318, "BCH": 115660521, "BNB": 125490422, "BTC": 1761789889, "DOGE": 203173266, "DOT": 11978002, "ETC": 10695346, "ETH": 794873329, "HBAR": 33390649, "ICP": 9626937, "LINK": 39323143, "LTC": 40834194, "NEAR": 268431559, "PEPE": 105881522, "POL": 7264712, "SHIB": 13296103, "SOL": 340045854, "SUI": 110355522, "TON": 7717352, "UNI": 221257311, "XLM": 33063571, "XRP": 466553687 } },
  end: { fetchedAt: "2026-09-23 03:08:09 UTC", usd: { "AAVE": 20745314, "ADA": 72272829, "ALGO": 3916596, "ATOM": 4226278, "AVAX": 60547384, "BCH": 116781682, "BNB": 124153430, "BTC": 1748607131, "DOGE": 206366592, "DOT": 11892780, "ETC": 10664304, "ETH": 789660523, "HBAR": 33024347, "ICP": 9509097, "LINK": 39201413, "LTC": 40294579, "NEAR": 265622833, "PEPE": 104886818, "POL": 7288489, "SHIB": 13276765, "SOL": 330811159, "SUI": 108312003, "TON": 7717352, "UNI": 223048916, "XLM": 32953525, "XRP": 467948846 } },
  status: {"AAVE": "TRADING", "ADA": "TRADING", "ALGO": "TRADING", "ATOM": "TRADING", "AVAX": "TRADING", "BCH": "TRADING", "BNB": "TRADING", "BTC": "TRADING", "DOGE": "TRADING", "DOT": "TRADING", "ETC": "TRADING", "ETH": "TRADING", "HBAR": "TRADING", "ICP": "TRADING", "LINK": "TRADING", "LTC": "TRADING", "NEAR": "TRADING", "PEPE": "TRADING", "POL": "TRADING", "SHIB": "TRADING", "SOL": "TRADING", "SUI": "TRADING", "TON": "BREAK", "UNI": "TRADING", "XLM": "TRADING", "XRP": "TRADING"},
};

/** Half of the median full spread, per side, as a fraction of price — the five from the paired sampler, the rest from this study's own. */
const BINANCE_HALF_SPREAD: Record<string, number> = Object.fromEntries([
  ...Object.entries(BINANCE_BOOK_OWN.fullSpreadBps).filter(([s]) => !(s in PAIRED_FIVE.binance)).map(([s, b]) => [s, b.median / 2 / 1e4]),
  ...Object.entries(PAIRED_FIVE.binance).map(([s, b]) => [s, b.median / 2 / 1e4]),
].sort((a, b) => (a[0] as string) < (b[0] as string) ? -1 : 1));

const BINANCE: Costs = { venue: "binance", makerBps: BINANCE_FEE_BPS.standard, takerBps: BINANCE_FEE_BPS.standard, fillFee: "taker", halfSpread: BINANCE_HALF_SPREAD };
const BINANCE_BNB: Costs = { venue: "binanceBnb", makerBps: BINANCE_FEE_BPS.bnb, takerBps: BINANCE_FEE_BPS.bnb, fillFee: "taker", halfSpread: BINANCE_HALF_SPREAD };
/**
 * DESCRIPTIVE ONLY — added by the pre-registration's addendum (2026-09-23 03:14:36 UTC), before any Binance arm ran.
 * `revx` with SUI's half-spread set to §3.20's measured median UK-book spread: 14.877 bps, the 60-sample median
 * `backtest_sui.ts` records in `SAMPLED_UK_BOOK` (2026-09-22 18:29:53 → 18:59:23 UTC; printed in §3.20 as 14.9),
 * halved. `COSTS.revx` charges SUI 23.94 bps, which §3.20 places at SUI's p90. This IS `backtest_sui.ts`'s S5
 * `sampled` arm (`fidelity.vsSuiS5`); the other four coins are `revx` by construction; no verdict reads it.
 */
const SUI_UK_MEDIAN_FULL_BPS = 14.877;
const REVX_MEDIAN: Costs = { ...COSTS.revx, venue: "revxMedian", halfSpread: { ...COSTS.revx.halfSpread, [SUI]: SUI_UK_MEDIAN_FULL_BPS / 2 / 1e4 } };
const COST_ARMS: Record<string, Costs> = { revx: COSTS.revx, revxMedian: REVX_MEDIAN, binance: BINANCE, binanceBnb: BINANCE_BNB };
const ARM_IDS_ALL = ["revx", "revxMedian", "binance", "binanceBnb"];
/** Binance's book leg: the pair must be TRADING, and its 24 h quote volume at the start reading is the book. */
function binanceBookUsd(symbol: string): number {
  const coin = symbol.split("/")[0];
  return BINANCE_24H_QUOTE_USD.status[coin] === "TRADING" ? (BINANCE_24H_QUOTE_USD.start.usd[coin] ?? 0) : 0;
}

// ───────────────────────────────────────── arithmetic on outputs (copied VERBATIM from backtest_set2.ts)

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
const r4 = (x: number) => Number(x.toFixed(4));
const r3 = (x: number) => Number(x.toFixed(3));
const r2 = (x: number) => Number(x.toFixed(2));

/** Pearson correlation. Copied from `backtest_portfolio.ts`. */
function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
/** Copied from `backtest_tape.ts` / `backtest_windows.ts`. */
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: r3(s.filter((r) => r > 0).length / s.length),
    median: r4(s[Math.floor(s.length / 2)]),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §4.15's four tests on ONE window on ONE venue. Copied from `backtest_tape.ts`'s `barTests`. */
function barTests(own: RunResult, other: RunResult, plateau: Plateau): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(own.ret > 0)) failed.push("own-venue return not positive");
  if (!(own.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(other.ret > 0)) failed.push("other-venue return not positive");
  return { pass: failed.length === 0, failed };
}

function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
function pick(r: RunResult) {
  return {
    ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
    trades: r.trades, days: Math.round(r.days), exposure: r3(r.exposure), stopsHit: r.stopsHit ?? 0,
  };
}

/** The last mark of each UTC day. Copied from `backtest_portfolio.ts`. */
function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}
/** A sleeve's daily FRACTIONAL returns — what a live row earns on a fixed slot. */
function dailyReturns(equity: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  let prev = 1;
  for (const { day, eq } of dailyMarks(equity)) { out.set(day, prev > 0 ? eq / prev - 1 : 0); prev = eq; }
  return out;
}

type Sleeve = { id: string; symbol: string; slotUsd: number; rets: Map<number, number>; ret: number; maxDD: number; trades: number; exposure: number; tradedUsd: number };
type SleeveStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; maxOrderUsd: number;
};
/** Combine sleeves at their slot sizes. Copied from `backtest_tape.ts` / `backtest_portfolio.ts`. */
function combine(sleeves: Sleeve[]): SleeveStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const maxOrder = r2(Math.max(0, ...sleeves.map((s) => s.slotUsd)));
  if (days.length === 0) {
    return {
      members: sleeves.length, capitalUsd: r2(capital), pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0,
      days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0,
      peakOpenUsd: r2(capital), maxOrderUsd: maxOrder,
    };
  }
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  for (const d of days) {
    let pnl = 0;
    for (const s of sleeves) pnl += s.slotUsd * (s.rets.get(d) ?? 0);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
  }
  const years = Math.max(1e-9, (days[days.length - 1] - days[0]) / 86400e3 / 365);
  const deployment = capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0;
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: r2(capital), pnlUsd: r2(eq - capital),
    ret: r4(ret), maxDD: r4(maxDD), retOverDD: r2(ret / Math.max(0.05, maxDD)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: r3(deployment), turnoverPerYear: r2(sleeves.reduce((a, s) => a + s.tradedUsd, 0) / capital / years),
    bestDayUsd: r2(best), worstDayUsd: r2(worst), peakOpenUsd: r2(sleeves.reduce((a, s) => a + s.slotUsd, 0)),
    maxOrderUsd: maxOrder,
  };
}

/** log C(n, k). Copied from `backtest_windows.ts`. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/** P(X ≥ k) for X ~ Binomial(n, p). Copied from `backtest_execution.ts`. */
function binomTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  let tail = 0;
  for (let j = k; j <= n; j++) tail += Math.exp(logChoose(n, j) + j * Math.log(p) + (n - j) * Math.log(1 - p));
  return Math.min(1, tail);
}
/** The exact two-sided sign test. Copied from `backtest_tape.ts`. */
function signTest(pos: number, neg: number): { positives: number; negatives: number; pTwoSided: number } {
  const m = pos + neg;
  if (m === 0) return { positives: pos, negatives: neg, pTwoSided: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  return { positives: pos, negatives: neg, pTwoSided: Number(Math.min(1, 2 * tail).toPrecision(3)) };
}

// ─────────────────────────────────────────────── arithmetic this study adds (on outputs only)

/** `combine`, plus the dollar path it walks, so drawdown can be measured in dollars and attributed to members. */
type SleevePath = {
  stats: SleeveStats; days: number[]; equityUsd: number[]; pnlUsd: number[]; perMemberPnlUsd: Record<string, number[]>;
  ddUsd: number; ddFraction: number; troughDay: string; peakDay: string; episodeLossBy: Record<string, number>;
};
function combinePath(sleeves: Sleeve[]): SleevePath {
  const stats = combine(sleeves);
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const equityUsd: number[] = [], pnlUsd: number[] = [];
  const perMemberPnlUsd: Record<string, number[]> = Object.fromEntries(sleeves.map((s) => [s.symbol, [] as number[]]));
  let eq = capital, peak = capital, ddUsd = 0, ddFrac = 0, peakIdx = -1, bestPeakIdx = -1, troughIdx = -1;
  for (let i = 0; i < days.length; i++) {
    let p = 0;
    for (const s of sleeves) { const x = s.slotUsd * (s.rets.get(days[i]) ?? 0); p += x; perMemberPnlUsd[s.symbol].push(x); }
    eq += p; equityUsd.push(eq); pnlUsd.push(p);
    if (eq > peak) { peak = eq; peakIdx = i; }
    ddUsd = Math.max(ddUsd, peak - eq);
    const f = 1 - eq / peak;
    if (f > ddFrac) { ddFrac = f; troughIdx = i; bestPeakIdx = peakIdx; }
  }
  // Who lost the money between the peak and the trough of the deepest fractional drawdown.
  const episodeLossBy: Record<string, number> = {};
  if (troughIdx >= 0) for (const s of sleeves) {
    let sum = 0;
    for (let i = bestPeakIdx + 1; i <= troughIdx; i++) sum += perMemberPnlUsd[s.symbol][i];
    episodeLossBy[s.symbol] = r2(sum);
  }
  const dayIso = (i: number) => i >= 0 && i < days.length ? new Date(days[i]).toISOString().slice(0, 10) : "start";
  return { stats, days, equityUsd, pnlUsd, perMemberPnlUsd, ddUsd, ddFraction: ddFrac, troughDay: dayIso(troughIdx), peakDay: dayIso(bestPeakIdx), episodeLossBy };
}

/**
 * Two-sided P(|T| ≥ |t|) for Student's t with an integer number of degrees of
 * freedom, in closed form (the finite series for P(|T| < t) with θ = atan(|t|/√ν)),
 * so the fold error bar's p is exact rather than read off a table.
 */
function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df < 1) return NaN;
  const th = Math.atan(Math.abs(t) / Math.sqrt(df)), c2 = Math.cos(th) ** 2, sn = Math.sin(th);
  let inside: number;
  if (df % 2 === 0) {
    let term = 1, sum = 1;
    for (let k = 2; k <= df - 2; k += 2) { term *= (k - 1) / k * c2; sum += term; }
    inside = sn * sum;
  } else if (df === 1) {
    inside = 2 * th / Math.PI;
  } else {
    let term = 1, sum = 1;
    for (let k = 3; k <= df - 2; k += 2) { term *= (k - 1) / k * c2; sum += term; }
    inside = 2 / Math.PI * (th + sn * Math.cos(th) * sum);
  }
  return Math.min(1, Math.max(0, 1 - inside));
}

/** Mid-ranks, 1 = best for the sleeve; ties share the average rank. */
function midRanks(xs: number[], higherIsBetter: boolean): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => (higherIsBetter ? xs[b] - xs[a] : xs[a] - xs[b]) || a - b);
  const ranks = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && Math.abs(xs[idx[j + 1]] - xs[idx[i]]) <= 1e-12) j++;
    for (let k = i; k <= j; k++) ranks[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}
/**
 * The exact exchangeability test for one member across independent units. Under
 * "this member's seat is like any other member's", its rank in each unit is
 * equally likely to be any of that unit's ranks, independently across units. The
 * null distribution of the rank SUM is enumerated exactly (mid-ranks doubled to
 * integers), so every p below is a probability and not a simulation. A HIGH sum
 * means the member is WORSE for the sleeve than the others.
 */
function rankSumTest(unitRanks: number[][], member: number) {
  let dist = new Map<number, number>([[0, 1]]);
  let obs = 0, expd = 0;
  for (const rs of unitRanks) {
    const next = new Map<number, number>();
    for (const [s, pr] of dist) for (const r of rs) { const k = s + Math.round(r * 2); next.set(k, (next.get(k) ?? 0) + pr / rs.length); }
    dist = next;
    obs += Math.round(rs[member] * 2);
    expd += rs.reduce((a, b) => a + b, 0) / rs.length * 2;
  }
  let worse = 0, better = 0, two = 0;
  for (const [s, pr] of dist) {
    if (s >= obs) worse += pr;
    if (s <= obs) better += pr;
    if (Math.abs(s - expd) >= Math.abs(obs - expd) - 1e-9) two += pr;
  }
  const n = unitRanks.length;
  return {
    units: n, ranks: unitRanks.map((rs) => rs[member]), meanRank: n ? r3(obs / 2 / n) : NaN, expectedMeanRank: n ? r3(expd / 2 / n) : NaN,
    pWorse: Number(Math.min(1, worse).toPrecision(4)), pBetter: Number(Math.min(1, better).toPrecision(4)), pTwoSided: Number(Math.min(1, two).toPrecision(4)),
    smallestAttainableOneSidedP: n ? Number(Math.pow(1 / 5, n).toPrecision(3)) : 1,
  };
}

// ───────────────────────────────────────────────────────────── tape plumbing (copied from backtest_set2.ts)

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

/** The bar at or after `ts`, or the array length when there is none. Copied from `backtest_windows.ts`. */
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type WinName = "A" | "B" | "C" | "D";
type Win = {
  name: WinName;
  isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};
const YEAR_MS = 365 * 86400e3;

/** The four windows, identical to `backtest_windows.ts` / `backtest_tape.ts` / `backtest_set2.ts`. */
function windowsOn(comb: Candle[], cb: Candle[], maxLookbackBars: number): Win[] {
  const nCb = cb.length, t1 = Math.floor(nCb / 3), t2 = Math.floor(nCb * 2 / 3);
  const z = indexAtOrAfter(comb, cb[0].start);
  const T1 = indexAtOrAfter(comb, cb[t1].start);
  const T2 = indexAtOrAfter(comb, cb[t2].start);
  const N = comb.length;
  const Zc = indexAtOrAfter(comb, cb[0].start - 2 * YEAR_MS);
  const Zd1 = indexAtOrAfter(comb, cb[0].start - 1 * YEAR_MS);
  const Zd3 = indexAtOrAfter(comb, cb[0].start - 3 * YEAR_MS);
  const days = (a: number, b: number) => b > a ? (comb[b - 1].start - comb[a].start) / 86400e3 : 0;
  const mk = (name: WinName, isSeries: Win["isSeries"], isFrom: number, isTo: number, oosFrom: number, oosTo: number): Win => {
    const arr = isSeries === "coinbase" ? cb : comb;
    const isDays = isTo > isFrom ? (arr[isTo - 1].start - arr[isFrom].start) / 86400e3 : 0;
    const oosDays = days(oosFrom, oosTo);
    let why = "";
    if (isTo - isFrom <= maxLookbackBars + 2) why = `in-sample is ${isTo - isFrom} bars, shorter than the widest lookback (${maxLookbackBars})`;
    else if (isDays < MIN_IN_SAMPLE_DAYS) why = `in-sample is ${isDays.toFixed(0)} days, under the ${MIN_IN_SAMPLE_DAYS}-day floor`;
    else if (oosTo - oosFrom <= maxLookbackBars + 2) why = `out-of-sample is ${oosTo - oosFrom} bars, shorter than the widest lookback`;
    return {
      name, isSeries, isFrom, isTo, oosFrom, oosTo,
      isDays: Number(isDays.toFixed(1)), oosDays: Number(oosDays.toFixed(1)),
      isFromIso: isTo > isFrom ? iso(arr[isFrom].start) : "", oosFromIso: oosTo > oosFrom ? iso(comb[oosFrom].start) : "",
      oosToIso: oosTo > oosFrom ? iso(comb[oosTo - 1].start) : "",
      scored: why === "", why,
    };
  };
  return [
    mk("A", "coinbase", 0, t2, T2, N), mk("B", "coinbase", 0, t1, T1, T2),
    mk("C", "combined", Zc, z, z, T1), mk("D", "combined", Zd3, Zd1, Zd1, z),
  ];
}

/** |Δclose| in bps between two series over every bar they share. Copied from `backtest_tape.ts`. */
function tapeAgreement(a: Candle[], b: Candle[], fromTs: number, toTs: number) {
  const byTs = new Map(b.map((c) => [c.start, c]));
  const diffs: number[] = [];
  for (const c of a) {
    if (c.start < fromTs || c.start >= toTs) continue;
    const k = byTs.get(c.start);
    if (k && c.close > 0) diffs.push(Math.abs(k.close / c.close - 1) * 1e4);
  }
  return diffs.length
    ? { sharedBars: diffs.length, medianBps: Number(median(diffs).toFixed(3)), p95Bps: Number(quantile(diffs, 0.95).toFixed(3)), maxBps: Number(Math.max(...diffs).toFixed(3)) }
    : { sharedBars: 0, medianBps: null, p95Bps: null, maxBps: null };
}

// ─────────────────────────────────────────── `run`, asked for a day's close — NOT a copy of it

type Mark = { t: number; eq: number; trades: number };
type DailyRun = { res: RunResult; marks: Mark[]; rets: Map<number, number>; from: number; to: number; start: number };

/**
 * `run`, asked for the equity at the close of every UTC day's last bar — one
 * `run` per day-end. `run(from, k + 1)` stops after bar k: its loop bound is the
 * only thing `to` changes, and its end-of-run equity is marked at bar k's close,
 * which is exactly the mark a per-bar copy of the loop would have pushed at k.
 * The trade count at each day-end comes free and brackets every fill to a day.
 * The mark set is the one `dailyMarks` keeps from a per-bar curve: the LAST bar
 * that starts on each UTC day, from the first bar `run` marks to the last.
 */
function runDaily(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], from: number, to: number,
  p: TrendParams, costs: Costs, stops: StopParams | null,
): DailyRun {
  const res = run(kind, symbol, bars, daily, from, to, p, costs, 4, stops);
  const start = Math.max(from, p.slow + 1);
  const marks: Mark[] = [];
  for (let k = start + 1; k <= to - 1; k++) {
    if (k < to - 1 && Math.floor(bars[k + 1].start / 86400e3) === Math.floor(bars[k].start / 86400e3)) continue;
    const r = k === to - 1 ? res : run(kind, symbol, bars, daily, from, k + 1, p, costs, 4, stops);
    marks.push({ t: bars[k].start, eq: 1 + r.ret, trades: r.trades });
  }
  return { res, marks, rets: dailyReturns(marks.map((m) => [m.t, m.eq] as [number, number])), from, to, start };
}

/**
 * The check `runDaily` owes: its marks against `run`'s OWN curve. `run` pushes
 * `[bar start, equity rounded to 5 dp]` every sixth bar; for evenly spaced
 * samples of that curve, `run` is asked again with `to` = that bar + 1, and the
 * two must agree to the rounding (≤ 5e-6). A property violation — anything in
 * `run` that read `to` — would show up here as a real difference.
 */
function prefixCheck(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], from: number, p: TrendParams, costs: Costs,
  stops: StopParams | null, res: RunResult, samples: number,
): { checks: number; worst: number } {
  const eqs = res.equity;
  if (!eqs.length) return { checks: 0, worst: 0 };
  let worst = 0, checks = 0;
  for (let s = 0; s < samples; s++) {
    const [t, e] = eqs[Math.min(eqs.length - 1, Math.floor((s + 0.5) * eqs.length / samples))];
    const k = indexAtOrAfter(bars, t);
    const r = run(kind, symbol, bars, daily, from, k + 1, p, costs, 4, stops);
    worst = Math.max(worst, Math.abs(1 + r.ret - e)); checks++;
  }
  return { checks, worst };
}

/** P(|S ∩ T| = j) when S (|S| = a) and T (|T| = b) are drawn uniformly from n items — hypergeometric. */
function hyper(n: number, a: number, b: number, j: number): number {
  if (j > Math.min(a, b) || j < Math.max(0, a + b - n)) return 0;
  return Math.exp(logChoose(a, j) + logChoose(n - a, b - j) - logChoose(n, b));
}
/** The exact distribution of how many of `n` coins clear ALL windows whose pass counts are `ks`. */
function intersectionDistribution(n: number, ks: number[]): number[] {
  let dist = new Array<number>(n + 1).fill(0);
  dist[ks[0]] = 1;
  for (let w = 1; w < ks.length; w++) {
    const next = new Array<number>(n + 1).fill(0);
    for (let cur = 0; cur <= n; cur++) {
      if (dist[cur] === 0) continue;
      for (let j = 0; j <= Math.min(cur, ks[w]); j++) next[j] += dist[cur] * hyper(n, cur, ks[w], j);
    }
    dist = next;
  }
  return dist;
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const tapePath = args.tape ? String(args.tape) : "";
  const set2Path = args.set2 ? String(args.set2) : "";
  const suiPath = args.sui ? String(args.sui) : "";
  const booksDir = args.books ? String(args.books) : "";
  const preregPath = args.prereg ? String(args.prereg) : "";
  const armIds = String(args.arms ?? ARM_IDS_ALL.join(",")).split(",").map((x) => x.trim()).filter(Boolean);
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  for (const a of armIds) if (!(a in COST_ARMS)) throw new Error(`unknown cost arm ${a}`);
  if (!armIds.includes("revx")) throw new Error("the revx arm is the reproduction and is always priced");
  const binanceArms: string[] = armIds.filter((a) => a === "binance" || a === "binanceBnb");
  /** Reported beside the others for SUI, the sleeve and SUI's seat; never a venue in the screen, never read for a verdict. */
  const descriptiveArms: string[] = armIds.filter((a) => a === "revxMedian");
  if (binanceArms.length && !(Object.keys(BINANCE_HALF_SPREAD).length > 0)) throw new Error("the Binance book constants are not filled in");
  await Deno.mkdir(outDir, { recursive: true });
  const T0 = Date.now();
  const lap = (what: string) => console.log(`${what} — ${((Date.now() - T0) / 1000).toFixed(0)} s`);

  const shaBytes = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = async (u: URL | string) => shaBytes(await Deno.readFile(u));
  const btPath = new URL("./backtest.ts", import.meta.url);
  const btHashStart = await sha(btPath);
  const readRaw = async (p: string): Promise<{ raw: Raw[]; sha256: string }> => {
    const b = await Deno.readFile(p);
    return { raw: JSON.parse(new TextDecoder().decode(b)) as Raw[], sha256: await shaBytes(b) };
  };

  // ── the tapes, built exactly as `backtest_tape.ts` builds them ─────────
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null).sort();
  const haveData = new Set<string>(), haveExt = new Set<string>(), haveK = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/); if (m) haveData.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(extDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_kraken\.json$/); if (m) haveExt.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(kDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_kraken\.json$/); if (m) haveK.add(`${m[1]}/USD`); }
  const candidates = priced.filter((s) => haveData.has(s) && haveExt.has(s) && haveK.has(s));

  type Arm = { c4h: Candle[]; daily: Candle[]; is4h: Candle[]; isDaily: Candle[] };
  type Series = { coinbase: Arm; kraken: Arm; cb4h: Candle[]; wins: Win[]; krakenCoverage: Record<string, { covered: boolean; why: string }> };
  const series: Record<string, Series> = {};
  const symbols: string[] = [];
  const provenance: Record<string, unknown>[] = [];
  for (const symbol of candidates) {
    const base = symbol.replace("/", "-");
    const fCb = await readRaw(`${dataDir}/${base}_1h_3y.json`), fExt = await readRaw(`${extDir}/${base}_1h_kraken.json`), fK = await readRaw(`${kDir}/${base}_4h_kraken.json`);
    const cbH = toCandles(fCb.raw), kH = toCandles(fExt.raw), kTape = toCandles(fK.raw);
    const spliceAt = cbH[0].start;
    const cb4h = resample(cbH, 4);
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const cbDaily = resample(cbH, 24);
    const zK = indexAtOrAfter(kTape, spliceAt);
    const kIs4h = kTape.slice(zK);
    const kDaily = resample(kTape, 24);
    const kIsDaily = kDaily.filter((c) => c.start >= (kIs4h.length ? kIs4h[0].start : Infinity));
    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    // The Kraken-tape coverage rule `backtest_tape.ts` declared: a window is priced only where Kraken's own tape spans all of it.
    const krakenCoverage: Record<string, { covered: boolean; why: string }> = {};
    for (const w of wins) {
      if (!w.scored) { krakenCoverage[w.name] = { covered: false, why: `not scored on the published arm either: ${w.why}` }; continue; }
      const isArrCb = w.isSeries === "coinbase" ? cb4h : comb4h;
      const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
      const isFromTs = isArrCb[w.isFrom].start, isToTs = endTs(isArrCb, w.isTo);
      const oosFromTs = comb4h[w.oosFrom].start, oosToTs = endTs(comb4h, w.oosTo);
      const kIsArr = w.isSeries === "coinbase" ? kTape.slice(indexAtOrAfter(kTape, spliceAt)) : kTape;
      const kIsBars = indexAtOrAfter(kIsArr, isToTs) - indexAtOrAfter(kIsArr, isFromTs);
      const kOosBars = indexAtOrAfter(kTape, oosToTs) - indexAtOrAfter(kTape, oosFromTs);
      let why = "";
      if (kTape[0].start > isFromTs) why = `Kraken's tape starts ${iso(kTape[0].start)}, after this window's in-sample begins (${iso(isFromTs)})`;
      else if (kTape[kTape.length - 1].start + 4 * 3600e3 < oosToTs) why = `Kraken's tape ends ${iso(kTape[kTape.length - 1].start)}, before this window's out-of-sample ends (${iso(oosToTs)})`;
      else if (kIsBars <= MAX_LOOKBACK + 2) why = `Kraken in-sample is ${kIsBars} bars, shorter than the widest lookback (${MAX_LOOKBACK})`;
      else if (kOosBars <= MAX_LOOKBACK + 2) why = `Kraken out-of-sample is ${kOosBars} bars, shorter than the widest lookback (${MAX_LOOKBACK})`;
      krakenCoverage[w.name] = { covered: why === "", why };
    }
    const ov4h = tapeAgreement(cb4h, kTape, cb4h[0].start, cb4h[cb4h.length - 1].start + 4 * 3600e3);
    const rejected: string[] = [];
    if (!ov4h.sharedBars || ov4h.sharedBars < 100) rejected.push(`overlap is ${ov4h.sharedBars} 4h bars — too few to verify`);
    else {
      if ((ov4h.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${ov4h.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if ((ov4h.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${ov4h.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    series[symbol] = {
      coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily },
      kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily },
      cb4h, wins, krakenCoverage,
    };
    provenance.push({
      symbol, accepted: rejected.length === 0, rejected,
      files: { coinbaseSha256: fCb.sha256, extSha256: fExt.sha256, krakenTapeSha256: fK.sha256 },
      coinbase: { bars4h: cb4h.length, first: iso(cb4h[0].start), last: iso(cb4h[cb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start) },
      windowsPriced: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowCalendar: wins.map((w) => ({ window: w.name, oosFrom: w.oosFromIso, oosTo: w.oosToIso, isDays: w.isDays, scored: w.scored })),
    });
    if (rejected.length === 0) symbols.push(symbol);
  }
  console.log(`accepted (${symbols.length}): ${symbols.join(", ")}`);
  lap("tapes built");

  // ── the grid, the tapes, the stop rules, the venues ────────────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const TAPES = ["coinbase", "kraken"] as const;
  type Tape = typeof TAPES[number];
  const STOP_RULES = ["shipped", "trail"] as const;
  type StopRule = typeof STOP_RULES[number];
  const stopsOf = (reg: StopRule, p: TrendParams): StopParams => reg === "shipped" ? stopsForKind("trend-4h", p) : { ...PINNED_STOPS, atrStop: p.atrStop };
  const CONDITIONS: { reg: StopRule; tape: Tape; id: string }[] = STOP_RULES.flatMap((reg) => TAPES.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  const LIVE_WINDOWS: WinName[] = ["A", "B", "C", "D"];
  /** Every venue priced in the per-coin bar: the two published ones, then the Binance arms. */
  const VENUES: string[] = ["revx", "kraken", ...binanceArms];
  const COST_OF: Record<string, Costs> = { revx: COSTS.revx, kraken: COSTS.kraken, binance: BINANCE, binanceBnb: BINANCE_BNB, revxMedian: REVX_MEDIAN };
  /** §4.15's fourth test prices the rule on a SECOND fee schedule: Kraken's for every arm but Kraken's own, whose second is Revolut X's (§4.16). */
  const OTHER_OF: Record<string, string> = { revx: "kraken", kraken: "revx", binance: "kraken", binanceBnb: "kraken", revxMedian: "kraken" };
  const isBinance = (v: string) => v === "binance" || v === "binanceBnb";
  const hasBook = (v: string, s: string) => isBinance(v) ? BINANCE_HALF_SPREAD[s] != null : true;
  const bookUsd = (v: string, s: string): number => v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : v === "kraken" ? (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0) : binanceBookUsd(s);
  const windowsPricedOn = (symbol: string): Win[] => series[symbol].wins.filter((w) => w.scored && series[symbol].krakenCoverage[w.name].covered);

  /** A window's calendar span, resolved by TIMESTAMP and never by bar index. Copied from `backtest_tape.ts`. */
  function spanOf(symbol: string, w: Win) {
    const { coinbase, cb4h } = series[symbol];
    const comb = coinbase.c4h;
    const isArr = w.isSeries === "coinbase" ? cb4h : comb;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    return { isFromTs: isArr[w.isFrom].start, isToTs: endTs(isArr, w.isTo), oosFromTs: comb[w.oosFrom].start, oosToTs: endTs(comb, w.oosTo) };
  }
  function boundsOn(symbol: string, w: Win, tape: Tape) {
    const arm = series[symbol][tape];
    const sp = spanOf(symbol, w);
    const isArr = w.isSeries === "coinbase" ? arm.is4h : arm.c4h;
    const isDaily = w.isSeries === "coinbase" ? arm.isDaily : arm.daily;
    return {
      isArr, isDaily, oosArr: arm.c4h, oosDaily: arm.daily,
      isFrom: indexAtOrAfter(isArr, sp.isFromTs), isTo: indexAtOrAfter(isArr, sp.isToTs),
      oosFrom: indexAtOrAfter(arm.c4h, sp.oosFromTs), oosTo: indexAtOrAfter(arm.c4h, sp.oosToTs),
    };
  }

  // ── §4.15's cells: every coin × priced window × tape × stop rule × venue ──
  type Picked = ReturnType<typeof pick>;
  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: Picked; chosenOther: Picked; seededOwn: Picked; seededOther: Picked;
    plateau: Plateau; chosenPass: boolean; chosenFailed: string[]; seededPass: boolean; seededFailed: string[];
    /** Binance arms only: the fourth test priced on Revolut X's costs instead of Kraken's — a SECONDARY reading. */
    vsRevx?: { chosenOther: Picked; seededOther: Picked; chosenPass: boolean; seededPass: boolean };
  };
  /** Choose in sample on the venue's own costs, report the chosen point and the whole grid out of sample. `backtest_tape.ts`'s `studyVenue`, the venue list widened. */
  function studyVenue(v: string, inSample: (p: TrendParams, c: Costs) => RunResult, outOfSample: (p: TrendParams, c: Costs) => RunResult): Cell {
    const own = COST_OF[v], oth = COST_OF[OTHER_OF[v]];
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < TREND_GRID.length; i++) { const s = score(inSample(TREND_GRID[i], own)); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    const oosOwn = TREND_GRID.map((p) => outOfSample(p, own));
    const plateau = plateauOf(oosOwn.map((r) => r.ret), oosOwn[bestIdx].ret);
    const chosenOther = outOfSample(TREND_GRID[bestIdx], oth);
    const seededOther = outOfSample(TREND_GRID[SEEDED_IDX], oth);
    const chosen = barTests(oosOwn[bestIdx], chosenOther, plateau);
    const seeded = barTests(oosOwn[SEEDED_IDX], seededOther, plateau);
    const cell: Cell = {
      chosen: { fast: TREND_GRID[bestIdx].fast, slow: TREND_GRID[bestIdx].slow, atrStop: TREND_GRID[bestIdx].atrStop },
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther),
      seededOwn: pick(oosOwn[SEEDED_IDX]), seededOther: pick(seededOther),
      plateau, chosenPass: chosen.pass, chosenFailed: chosen.failed, seededPass: seeded.pass, seededFailed: seeded.failed,
    };
    if (isBinance(v)) {
      const cR = outOfSample(TREND_GRID[bestIdx], COSTS.revx), sR = outOfSample(TREND_GRID[SEEDED_IDX], COSTS.revx);
      cell.vsRevx = { chosenOther: pick(cR), seededOther: pick(sR), chosenPass: barTests(oosOwn[bestIdx], cR, plateau).pass, seededPass: barTests(oosOwn[SEEDED_IDX], sR, plateau).pass };
    }
    return cell;
  }

  const cells: Record<string, Record<string, Record<string, Record<string, Record<string, Cell>>>>> = {};
  let gridPoints = 0;
  for (const reg of STOP_RULES) {
    cells[reg] = {};
    for (const tape of TAPES) {
      cells[reg][tape] = {};
      for (const symbol of symbols) {
        cells[reg][tape][symbol] = {};
        for (const w of windowsPricedOn(symbol)) {
          const b = boundsOn(symbol, w, tape);
          const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, p, c, 4, stopsOf(reg, p));
          const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, p, c, 4, stopsOf(reg, p));
          cells[reg][tape][symbol][w.name] = {};
          for (const v of [...VENUES, ...(symbol === SUI ? descriptiveArms : [])]) {
            if (!hasBook(v, symbol)) continue;
            cells[reg][tape][symbol][w.name][v] = studyVenue(v, isRun, oosRun);
            gridPoints += 2 * TREND_GRID.length;
          }
        }
      }
      lap(`grid ${reg}·${tape}`);
    }
  }

  // ── fidelity 1: every §4.15 cell `tape.json` publishes, both venues ─────
  const fid: Record<string, unknown> = {};
  // deno-lint-ignore no-explicit-any
  let tapeJson: Record<string, any> | null = null;
  if (tapePath) {
    tapeJson = JSON.parse(await Deno.readTextFile(tapePath));
    const rows: Record<string, unknown>[] = [];
    let compared = 0, cellsCompared = 0;
    const pcv = tapeJson?.t3_theBar?.perCoinVerdicts ?? {};
    for (const reg of STOP_RULES) for (const symbol of Object.keys(pcv[reg] ?? {}).sort()) for (const w of LIVE_WINDOWS) for (const v of ["revx", "kraken"]) for (const tape of TAPES) {
      const pub = pcv[reg]?.[symbol]?.[w]?.[v]?.[tape];
      const here = cells[reg]?.[tape]?.[symbol]?.[w]?.[v];
      if (!pub && !here) continue;
      cellsCompared++;
      if (!pub || !here) { rows.push({ stopRule: reg, symbol, window: w, venue: v, tape, field: "presence", published: !!pub, here: !!here }); continue; }
      const book = bookUsd(v, symbol) >= MIN_BOOK_USD;
      const pairs: [string, unknown, unknown][] = [
        ["seededPass", pub.seededPass, here.seededPass && book], ["chosenPass", pub.chosenPass, here.chosenPass && book], ["plateau", pub.plateau, here.plateau.positiveShare],
        ["chosen.fast", pub.chosen?.fast, here.chosen.fast], ["chosen.slow", pub.chosen?.slow, here.chosen.slow], ["chosen.atrStop", pub.chosen?.atrStop, here.chosen.atrStop],
        ["seededOwn.ret", pub.seededOwn?.ret, here.seededOwn.ret], ["seededOwn.maxDD", pub.seededOwn?.maxDD, here.seededOwn.maxDD], ["seededOwn.trades", pub.seededOwn?.trades, here.seededOwn.trades],
        ["chosenOwn.ret", pub.chosenOwn?.ret, here.chosenOwn.ret], ["chosenOwn.maxDD", pub.chosenOwn?.maxDD, here.chosenOwn.maxDD], ["chosenOwn.trades", pub.chosenOwn?.trades, here.chosenOwn.trades],
        ["seededFailed", JSON.stringify(pub.seededFailed), JSON.stringify(here.seededFailed)],
      ];
      for (const [f, a, b] of pairs) {
        compared++;
        const differs = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b;
        if (differs) rows.push({ stopRule: reg, symbol, window: w, venue: v, tape, field: f, published: a, here: b });
      }
    }
    fid.vsTape = {
      note: "every §4.15 cell `tape.json` §T3 publishes (`perCoinVerdicts`: 27 coins, two stop rules, two tapes, both venues, every priced window) recomputed here and compared field by field: both pass flags (with the book), the plateau share, the chosen point, the seeded and chosen out-of-sample return / drawdown / trade count, and the failed-test list. Zero differences means this harness IS the published one, and every Binance cell below differs from its Revolut X twin by the cost alone.",
      file: tapePath, sha256: await sha(tapePath), cellsCompared, fieldsCompared: compared, differences: rows.length, rows: rows.slice(0, 40),
    };
    console.log(`vsTape: ${cellsCompared} cells, ${compared} fields, ${rows.length} differences`);
  }
  lap("fidelity vs tape.json");

  // ── `runDaily`, memoised, with its check against `run` on every cell (copied from `backtest_sui.ts`) ──
  const memo = new Map<string, DailyRun>();
  let prefixChecks = 0, prefixWorst = 0, runDailyCells = 0;
  function daily(symbol: string, tape: Tape, reg: StopRule, from: number, to: number, costs: Costs, costKey: string): DailyRun {
    const key = `${symbol}|${tape}|${reg}|${from}|${to}|${costKey}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const arm = series[symbol][tape];
    const st = stopsOf(reg, DEFAULT_TREND);
    const dr = runDaily("trend-4h", symbol, arm.c4h, arm.daily, from, to, DEFAULT_TREND, costs, st);
    const pc = prefixCheck("trend-4h", symbol, arm.c4h, arm.daily, from, DEFAULT_TREND, costs, st, dr.res, 6);
    prefixChecks += pc.checks; prefixWorst = Math.max(prefixWorst, pc.worst); runDailyCells++;
    memo.set(key, dr);
    return dr;
  }
  /** `revxMedian` differs from `revx` in SUI's half-spread alone, so every other coin's run IS the `revx` run and is shared with it. */
  const armFor = (arm: string, symbol: string) => arm === "revxMedian" && symbol !== SUI ? "revx" : arm;
  function windowDaily(symbol: string, w: WinName, reg: StopRule, tape: Tape, arm: string): DailyRun | null {
    const win = windowsPricedOn(symbol).find((x) => x.name === w);
    if (!win) return null;
    const b = boundsOn(symbol, win, tape);
    const a = armFor(arm, symbol);
    return daily(symbol, tape, reg, b.oosFrom, b.oosTo, COST_ARMS[a], a);
  }
  function spanDaily(symbol: string, tape: Tape, reg: StopRule, fromTs: number, toTs: number, arm: string): DailyRun | null {
    const s = series[symbol][tape];
    const from = indexAtOrAfter(s.c4h, fromTs), to = indexAtOrAfter(s.c4h, toTs);
    if (to - from < 30) return null;
    const a = armFor(arm, symbol);
    return daily(symbol, tape, reg, from, to, COST_ARMS[a], a);
  }

  // ── sleeve helpers (copied from `backtest_sui.ts`) ──────────────────────
  const asSleeve = (symbol: string, dr: DailyRun, slotUsd: number): Sleeve => ({
    id: `trend-4h·${symbol.split("/")[0]}`, symbol, slotUsd, rets: dr.rets,
    ret: dr.res.ret, maxDD: dr.res.maxDD, trades: dr.res.trades, exposure: dr.res.exposure,
    tradedUsd: dr.res.trades * slotUsd,
  });
  const contributionOf = (dr: DailyRun) => [...dr.rets.values()].reduce((a, b) => a + b, 0);
  function worstOf(per: Partial<Record<WinName, SleeveStats>>, only: WinName[] = LIVE_WINDOWS) {
    let best: { window: WinName | null; retOverDD: number; ret: number } = { window: null, retOverDD: Infinity, ret: Infinity };
    for (const w of only) { const s = per[w]; if (!s) continue; if (s.retOverDD < best.retOverDD) best = { window: w, retOverDD: s.retOverDD, ret: s.ret }; }
    return best.window == null ? { window: null, retOverDD: NaN, ret: NaN } : best;
  }
  /** `backtest_sui.ts`'s `judgeFive`: what each member adds, what removing it does to ret/DD at the same capital, and what its $20 does to the others' dollar drawdown. */
  function judgeFive(runs: Record<string, DailyRun>) {
    const five = combinePath(LIVE_ROW.symbols.map((s) => asSleeve(s, runs[s], SLOT_USD)));
    const perCoin: Record<string, Record<string, unknown>> = {};
    const contrib: number[] = [], looDelta: number[] = [], marginalDD: number[] = [];
    for (const x of LIVE_ROW.symbols) {
      const others = LIVE_ROW.symbols.filter((s) => s !== x);
      const rescaled = combinePath(others.map((s) => asSleeve(s, runs[s], LIVE_ROW.capitalUsd / others.length)));
      const idle = combinePath(others.map((s) => asSleeve(s, runs[s], SLOT_USD)));
      const c = contributionOf(runs[x]);
      const d = rescaled.stats.retOverDD - five.stats.retOverDD;
      const m = five.ddUsd - idle.ddUsd;
      contrib.push(c); looDelta.push(d); marginalDD.push(m);
      perCoin[x] = {
        own: pick(runs[x].res), slotPnlPerDollar: r4(c), slotPnlUsd: r2(c * SLOT_USD),
        withoutIt: { ret: rescaled.stats.ret, maxDD: rescaled.stats.maxDD, retOverDD: rescaled.stats.retOverDD, deltaRetOverDD: r2(d), deltaRet: r4(rescaled.stats.ret - five.stats.ret), deltaMaxDD: r4(rescaled.stats.maxDD - five.stats.maxDD) },
        marginalDollarDD: r2(m),
      };
    }
    const idx = LIVE_ROW.symbols.indexOf(SUI);
    const rank = { contribution: midRanks(contrib, true), looDeltaRetOverDD: midRanks(looDelta, false), marginalDollarDD: midRanks(marginalDD, false) };
    return {
      five, perCoin,
      fiveStats: { ret: five.stats.ret, maxDD: five.stats.maxDD, retOverDD: five.stats.retOverDD, pnlUsd: five.stats.pnlUsd, ddUsd: r2(five.ddUsd) },
      ranks: rank,
      suiRank: { contribution: rank.contribution[idx], looDeltaRetOverDD: rank.looDeltaRetOverDD[idx], marginalDollarDD: rank.marginalDollarDD[idx] },
    };
  }

  // ── PART 1 — the live coins, window by window, and the live sleeve on four windows ──
  const cores: Record<string, Record<string, Record<string, Record<string, Partial<Record<WinName, DailyRun>>>>>> = {};
  for (const a of armIds) {
    cores[a] = {};
    for (const reg of STOP_RULES) {
      cores[a][reg] = {};
      for (const tape of TAPES) {
        cores[a][reg][tape] = {};
        for (const s of LIVE_ROW.symbols) {
          cores[a][reg][tape][s] = {};
          for (const w of windowsPricedOn(s)) cores[a][reg][tape][s][w.name] = windowDaily(s, w.name, reg, tape, a) ?? undefined;
        }
      }
    }
    lap(`window cores ${a}`);
  }
  function windowSleeve(a: string, coinSet: string[], w: WinName, reg: StopRule, tape: Tape): SleevePath | null {
    const members = coinSet.filter((s) => cores[a][reg][tape][s]?.[w]);
    if (members.length < 2) return null;
    const slot = LIVE_ROW.capitalUsd / coinSet.length;
    return combinePath(members.map((s) => asSleeve(s, cores[a][reg][tape][s][w]!, slot)));
  }
  const sleeves: Record<string, Record<string, Partial<Record<WinName, SleeveStats>>>> = {};
  for (const a of armIds) {
    sleeves[a] = {};
    for (const c of CONDITIONS) {
      sleeves[a][c.id] = {};
      for (const w of LIVE_WINDOWS) { const p = windowSleeve(a, LIVE_ROW.symbols, w, c.reg, c.tape); if (p) sleeves[a][c.id][w] = p.stats; }
    }
  }
  if (set2Path) {
    // deno-lint-ignore no-explicit-any
    const sj = JSON.parse(await Deno.readTextFile(set2Path)) as Record<string, any>;
    const base = sj.a1_theCoins?.baseline?.perCondition ?? {};
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    for (const c of CONDITIONS) for (const w of LIVE_WINDOWS) {
      const pub = base[c.id]?.perWindow?.[w], here = sleeves.revx[c.id][w];
      if (!pub && !here) continue;
      if (!pub || !here) { compared++; rows.push({ condition: c.id, window: w, field: "presence", published: !!pub, here: !!here }); continue; }
      for (const f of ["ret", "maxDD", "retOverDD", "pnlUsd", "capitalUsd", "members"] as const) {
        compared++;
        const d = (here[f] as number) - (pub[f] as number);
        if (Math.abs(d) > 1e-9) rows.push({ condition: c.id, window: w, field: f, published: pub[f], here: here[f] });
      }
    }
    fid.vsSet2 = { note: "the live sleeve (five $20 slots, seeded, Revolut X costs) on every window × condition, against `set2.json`'s A1 baseline — built by a different runner.", file: set2Path, sha256: await sha(set2Path), fieldsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
    console.log(`vsSet2: ${compared} fields, ${rows.length} differences`);
  }
  lap("part 1 sleeves");

  // ── PART 2 — SUI's seat: the span where all five exist, and §3.20's folds ──
  const COMMON = (() => {
    const starts = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[Math.min(a.length - 1, DEFAULT_TREND.slow + 1)].start; });
    const ends = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[a.length - 1].start; });
    return { fromTs: Math.max(...starts), toTs: Math.min(...ends) + 4 * 3600e3 };
  })();
  const spanMs = COMMON.toTs - COMMON.fromTs;
  const K = Math.max(2, Math.round(spanMs / 86400e3 / FOLD_TARGET_DAYS));
  const foldMs = spanMs / K;
  const folds = [...Array(K)].map((_, k) => ({ id: k + 1, fromTs: COMMON.fromTs + Math.round(k * foldMs), toTs: COMMON.fromTs + Math.round((k + 1) * foldMs) }));
  const part2: Record<string, Record<string, unknown>> = {};
  const primaryByArm: Record<string, Record<string, ReturnType<typeof rankSumTest>>> = {};
  for (const a of armIds) {
    const spanBy: Record<string, unknown> = {}, foldBy: Record<string, unknown> = {};
    primaryByArm[a] = {};
    for (const c of CONDITIONS) {
      // S2's S_full: one continuous seeded run per coin over the span.
      const runs: Record<string, DailyRun> = {};
      for (const s of LIVE_ROW.symbols) { const dr = spanDaily(s, c.tape, c.reg, COMMON.fromTs, COMMON.toTs, a); if (dr) runs[s] = dr; }
      if (Object.keys(runs).length === LIVE_ROW.symbols.length) {
        const j = judgeFive(runs);
        const order = [...LIVE_ROW.symbols].sort((x, y) => (j.perCoin[y].slotPnlPerDollar as number) - (j.perCoin[x].slotPnlPerDollar as number));
        // `backtest_sui.ts`'s S2 account arithmetic, copied: the five $20 slots on the whole $100 account.
        const acct = (p: SleevePath, idleUsd: number) => {
          const eqAcct = p.equityUsd.map((e) => e + idleUsd);
          let peak = LIVE_ROW.capitalUsd, dd = 0;
          for (const e of eqAcct) { peak = Math.max(peak, e); dd = Math.max(dd, 1 - e / peak); }
          const ret = p.stats.pnlUsd / LIVE_ROW.capitalUsd;
          return { pnlUsd: p.stats.pnlUsd, ret: r4(ret), maxDD: r4(dd), retOverDD: r2(ret / Math.max(0.05, dd)), ddUsd: r2(p.ddUsd) };
        };
        spanBy[c.id] = {
          five: acct(j.five, 0), sleeveStats: { ret: j.fiveStats.ret, maxDD: j.fiveStats.maxDD, retOverDD: j.fiveStats.retOverDD }, suiRank: j.suiRank,
          slotPnlPerDollar: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, j.perCoin[s].slotPnlPerDollar])),
          ownReturn: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, (j.perCoin[s].own as Picked).ret])),
          trades: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, (j.perCoin[s].own as Picked).trades])),
          contributionOrder: order.map((s) => s.split("/")[0]),
          suiLastOfFive: order[order.length - 1] === SUI,
          perCoin: j.perCoin,
        };
      }
      // S3: the folds, and the pre-registered test.
      const rows: Record<string, unknown>[] = [];
      const units: ReturnType<typeof judgeFive>[] = [];
      for (const f of folds) {
        const fr: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = spanDaily(s, c.tape, c.reg, f.fromTs, f.toTs, a); if (dr) fr[s] = dr; }
        if (Object.keys(fr).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(fr);
        units.push(j);
        const without = j.perCoin[SUI] as { withoutIt: { ret: number; maxDD: number; retOverDD: number }; slotPnlPerDollar: number; own: { trades: number } };
        rows.push({
          fold: f.id, from: iso(f.fromTs), to: iso(f.toTs),
          five: { ret: j.fiveStats.ret, maxDD: j.fiveStats.maxDD, retOverDD: j.fiveStats.retOverDD, ddUsd: j.fiveStats.ddUsd },
          withoutSui: without.withoutIt,
          deltaRet: r4(without.withoutIt.ret - j.fiveStats.ret), deltaMaxDD: r4(without.withoutIt.maxDD - j.fiveStats.maxDD), deltaRetOverDD: r2(without.withoutIt.retOverDD - j.fiveStats.retOverDD),
          suiSlotPnlPerDollar: without.slotPnlPerDollar, suiTrades: without.own.trades,
          suiRank: j.suiRank,
          removalCostRanksOfAllFive: Object.fromEntries(LIVE_ROW.symbols.map((s, i) => [s, j.ranks.looDeltaRetOverDD[i]])),
          deltaRetOverDDWithoutEach: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, (j.perCoin[s].withoutIt as { deltaRetOverDD: number }).deltaRetOverDD])),
        });
      }
      const idx = LIVE_ROW.symbols.indexOf(SUI);
      const dRet = rows.map((r) => r.deltaRet as number), dDD = rows.map((r) => r.deltaMaxDD as number), dRD = rows.map((r) => r.deltaRetOverDD as number);
      const n = dRet.length, m = mean(dRet), sd = n > 1 ? Math.sqrt(dRet.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (n - 1)) : NaN;
      const rs = {
        looDeltaRetOverDD: rankSumTest(units.map((u) => u.ranks.looDeltaRetOverDD), idx),
        contribution: rankSumTest(units.map((u) => u.ranks.contribution), idx),
        marginalDollarDD: rankSumTest(units.map((u) => u.ranks.marginalDollarDD), idx),
      };
      primaryByArm[a][c.id] = rs.looDeltaRetOverDD;
      const worstFive = Math.min(...units.map((u) => u.fiveStats.retOverDD));
      const worstWithout: Record<string, number> = {};
      for (const x of LIVE_ROW.symbols) worstWithout[x] = Math.min(...units.map((u) => (u.perCoin[x] as { withoutIt: { retOverDD: number } }).withoutIt.retOverDD));
      foldBy[c.id] = {
        folds: rows,
        summary: {
          folds: rows.length,
          primary_exchangeability_looDeltaRetOverDD: rs.looDeltaRetOverDD,
          exchangeability_contribution: rs.contribution,
          exchangeability_marginalDollarDD: rs.marginalDollarDD,
          dropSuiBetterOnReturn: signTest(dRet.filter((x) => x > 0).length, dRet.filter((x) => x < 0).length),
          dropSuiLowerDrawdown: signTest(dDD.filter((x) => x < 0).length, dDD.filter((x) => x > 0).length),
          dropSuiBetterOnRetOverDD: signTest(dRD.filter((x) => x > 0).length, dRD.filter((x) => x < 0).length),
          errorBarOnTheReturnDelta: { meanDeltaRet: r4(m), sdAcrossFolds: r4(sd), standardError: r4(sd / Math.sqrt(Math.max(1, n))), tStatistic: r2(m / (sd / Math.sqrt(Math.max(1, n)))), degreesOfFreedom: n - 1, pTwoSided: Number(tTwoSidedP(m / (sd / Math.sqrt(Math.max(1, n))), n - 1).toPrecision(3)) },
          worstFoldRule: { fiveWorstRetOverDD: worstFive, withoutEachCoinWorstRetOverDD: worstWithout, dropsThatImproveTheWorstFold: LIVE_ROW.symbols.filter((x) => worstWithout[x] > worstFive) },
        },
      };
    }
    // S1's per-window judgement on the windows SUI has (A, B): what removing SUI does to each window's sleeve at this arm's cost.
    const windowsBy: Record<string, unknown> = {};
    for (const c of CONDITIONS) {
      const per: Record<string, unknown> = {};
      for (const w of ["A", "B"] as WinName[]) {
        const runs: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = cores[a][c.reg][c.tape][s]?.[w]; if (dr) runs[s] = dr; }
        if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(runs);
        const sui = j.perCoin[SUI] as { own: Picked; slotPnlPerDollar: number; withoutIt: { ret: number; maxDD: number; retOverDD: number; deltaRetOverDD: number; deltaRet: number } };
        per[w] = { five: { ret: j.fiveStats.ret, maxDD: j.fiveStats.maxDD, retOverDD: j.fiveStats.retOverDD }, suiOwn: sui.own, suiSlotPnlPerDollar: sui.slotPnlPerDollar, withoutSui: sui.withoutIt, suiRank: j.suiRank };
      }
      windowsBy[c.id] = per;
    }
    const pr = TAPES.map((t) => primaryByArm[a][`shipped·${t}`]);
    part2[a] = {
      verdict: descriptiveArms.includes(a) ? "descriptive only — the pre-registration's addendum: this arm decides nothing" : pr.every((x) => x.pWorse < 0.05) ? "drop — pWorse < 0.05 on both tapes" : pr.every((x) => x.pBetter < 0.05) ? "keep, supported — pBetter < 0.05 on both tapes" : "undecided — the pre-registered test cannot tell SUI's seat from any other member's",
      windowsSuiHas: windowsBy,
      primaryPerTape: Object.fromEntries(TAPES.map((t, i) => [t, { meanRank: pr[i].meanRank, expectedMeanRank: pr[i].expectedMeanRank, pWorse: pr[i].pWorse, pBetter: pr[i].pBetter, ranks: pr[i].ranks, folds: pr[i].units }])),
      spanWhereAllFiveExist: spanBy,
      folds: foldBy,
    };
    lap(`part 2 ${a}`);
  }
  if (suiPath) {
    // deno-lint-ignore no-explicit-any
    const sj = JSON.parse(await Deno.readTextFile(suiPath)) as Record<string, any>;
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const cmp = (where: string, published: unknown, here: unknown) => {
      compared++;
      const differs = typeof published === "number" && typeof here === "number" ? Math.abs(published - here) > 1e-9 : JSON.stringify(published) !== JSON.stringify(here);
      if (differs) rows.push({ where, published: published ?? null, here: here ?? null });
    };
    const mine = part2.revx as { folds: Record<string, { folds: Record<string, unknown>[]; summary: Record<string, Record<string, unknown>> }>; spanWhereAllFiveExist: Record<string, { five: Record<string, unknown>; suiRank: Record<string, unknown>; slotPnlPerDollar: Record<string, unknown> }> };
    cmp("s3.foldCount", sj.s3_folds?.foldCount, K);
    for (const c of CONDITIONS) {
      const pub = sj.s3_folds?.byCondition?.[c.id], here = mine.folds[c.id];
      for (let i = 0; i < Math.max(pub?.folds?.length ?? 0, here?.folds?.length ?? 0); i++) {
        const p = pub?.folds?.[i], h = here?.folds?.[i] as Record<string, unknown> | undefined;
        for (const f of ["fold", "from", "to", "five", "withoutSui", "deltaRet", "deltaMaxDD", "deltaRetOverDD", "suiSlotPnlPerDollar", "suiTrades", "suiRank"]) cmp(`s3.${c.id}.fold${i + 1}.${f}`, p?.[f], h?.[f]);
      }
      for (const k of ["primary_exchangeability_looDeltaRetOverDD", "exchangeability_contribution", "exchangeability_marginalDollarDD", "dropSuiBetterOnReturn", "dropSuiLowerDrawdown", "dropSuiBetterOnRetOverDD", "errorBarOnTheReturnDelta"]) {
        const p = pub?.summary?.[k], h = here?.summary?.[k];
        for (const f of Object.keys(p ?? {})) if (f !== "note") cmp(`s3.${c.id}.${k}.${f}`, p?.[f], (h as Record<string, unknown> | undefined)?.[f]);
      }
      const ps = sj.s2_theSpanWhereAllFiveExist?.spans?.S_full?.byCondition?.[c.id], hs = mine.spanWhereAllFiveExist[c.id];
      for (const f of ["ret", "maxDD", "retOverDD", "pnlUsd", "ddUsd"]) cmp(`s2.S_full.${c.id}.five.${f}`, ps?.fiveAt20?.[f], hs?.five?.[f]);
      cmp(`s2.S_full.${c.id}.suiRank`, ps?.suiRank, hs?.suiRank);
      for (const s of LIVE_ROW.symbols) cmp(`s2.S_full.${c.id}.${s}.slotPnlPerDollar`, ps?.perCoin?.[s]?.slotPnlPerDollar, hs?.slotPnlPerDollar?.[s]);
    }
    // `backtest_sui.ts`'s S5: the five-coin sleeve with only SUI's half-spread changed. `assumed` is `revx`; `sampled` is `revxMedian`.
    const s5 = sj.s5_theSpreadSuiTradesAt?.units ?? {};
    const s5rows: Record<string, unknown>[] = [];
    let s5compared = 0;
    const cmp5 = (where: string, published: unknown, here: unknown) => {
      s5compared++;
      const differs = typeof published === "number" && typeof here === "number" ? Math.abs(published - here) > 1e-9 : JSON.stringify(published) !== JSON.stringify(here);
      if (differs) s5rows.push({ where, published: published ?? null, here: here ?? null });
    };
    for (const [pubArm, myArm] of [["assumed", "revx"], ["sampled", "revxMedian"]] as const) {
      if (!armIds.includes(myArm)) continue;
      const p2 = part2[myArm] as { windowsSuiHas: Record<string, Record<string, { five: Record<string, number>; suiOwn: Picked; suiSlotPnlPerDollar: number; withoutSui: { deltaRet: number; deltaRetOverDD: number } }>>; spanWhereAllFiveExist: Record<string, { sleeveStats: Record<string, number>; perCoin: Record<string, { own: Picked; slotPnlPerDollar: number; withoutIt: { deltaRet: number; deltaRetOverDD: number } }> }> };
      for (const c of CONDITIONS) {
        for (const w of ["A", "B"] as const) {
          const pub = s5[`window ${w}`]?.[c.id]?.[pubArm], here = p2.windowsSuiHas[c.id]?.[w];
          for (const f of ["ret", "maxDD", "retOverDD"]) cmp5(`${pubArm}.window ${w}.${c.id}.five.${f}`, pub?.five?.[f], here?.five?.[f]);
          cmp5(`${pubArm}.window ${w}.${c.id}.suiOwn`, pub?.suiOwn, here?.suiOwn);
          cmp5(`${pubArm}.window ${w}.${c.id}.suiSlotPnlPerDollar`, pub?.suiSlotPnlPerDollar, here?.suiSlotPnlPerDollar);
          cmp5(`${pubArm}.window ${w}.${c.id}.dropSuiDelta.ret`, pub?.dropSuiDelta?.ret, here?.withoutSui?.deltaRet);
          cmp5(`${pubArm}.window ${w}.${c.id}.dropSuiDelta.retOverDD`, pub?.dropSuiDelta?.retOverDD, here?.withoutSui?.deltaRetOverDD);
        }
        const pub = s5["S_full"]?.[c.id]?.[pubArm], here = p2.spanWhereAllFiveExist[c.id];
        for (const f of ["ret", "maxDD", "retOverDD"]) cmp5(`${pubArm}.S_full.${c.id}.five.${f}`, pub?.five?.[f], here?.sleeveStats?.[f]);
        cmp5(`${pubArm}.S_full.${c.id}.suiOwn`, pub?.suiOwn, here?.perCoin?.[SUI]?.own);
        cmp5(`${pubArm}.S_full.${c.id}.suiSlotPnlPerDollar`, pub?.suiSlotPnlPerDollar, here?.perCoin?.[SUI]?.slotPnlPerDollar);
        cmp5(`${pubArm}.S_full.${c.id}.dropSuiDelta.ret`, pub?.dropSuiDelta?.ret, here?.perCoin?.[SUI]?.withoutIt?.deltaRet);
        cmp5(`${pubArm}.S_full.${c.id}.dropSuiDelta.retOverDD`, pub?.dropSuiDelta?.retOverDD, here?.perCoin?.[SUI]?.withoutIt?.deltaRetOverDD);
      }
    }
    fid.vsSuiS5 = { note: "`backtest_sui.ts`'s S5 re-priced the sleeve with only SUI's half-spread changed. Its `assumed` arm is this file's `revx` and its `sampled` arm (§3.20's measured median, 14.877 bps) is this file's descriptive `revxMedian`: windows A and B and the whole span, all four conditions — the sleeve, SUI's own run, its slot and the drop-SUI deltas.", fieldsCompared: s5compared, differences: s5rows.length, rows: s5rows.slice(0, 40) };
    console.log(`vsSuiS5: ${s5compared} fields, ${s5rows.length} differences`);
    fid.vsSui = { note: "§3.20's machinery on the Revolut X arm against the committed `sui.json`: every fold row of S3 (ranks, deltas, SUI's slot and trades) under all four conditions, every exact test in the fold summaries (the primary rank test included), and the S_full span's sleeve, SUI's ranks and every member's slot P&L.", file: suiPath, sha256: await sha(suiPath), fieldsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
    console.log(`vsSui: ${compared} fields, ${rows.length} differences`);
  }

  // ── PART 3 — §4.15's bar over the universe, per venue, against chance ───
  type How = "seeded" | "chosen";
  type TapeRule = "coinbase" | "kraken" | "both";
  const HOWS: How[] = ["seeded", "chosen"];
  const TAPE_RULES: TapeRule[] = ["both", "coinbase", "kraken"];
  /** A coin-window clears when the four tests pass on every tape the rule names AND the venue's book is ≥ $100k a day. null = not priced. */
  function passOn(reg: StopRule, v: string, how: How, tr: TapeRule, s: string, w: WinName, test4: "primary" | "vsRevx" = "primary"): boolean | null {
    const tl: Tape[] = tr === "both" ? [...TAPES] : [tr];
    const cs = tl.map((t) => cells[reg]?.[t]?.[s]?.[w]?.[v]);
    if (cs.some((c) => !c)) return null;
    const book = bookUsd(v, s) >= MIN_BOOK_USD;
    return book && cs.every((c) => test4 === "vsRevx" && c!.vsRevx ? (how === "seeded" ? c!.vsRevx.seededPass : c!.vsRevx.chosenPass) : (how === "seeded" ? c!.seededPass : c!.chosenPass));
  }
  function screen(reg: StopRule, v: string, how: How, tr: TapeRule, test4: "primary" | "vsRevx" = "primary") {
    const pop = symbols.filter((s) => passOn(reg, v, how, tr, s, "A", test4) != null && passOn(reg, v, how, tr, s, "B", test4) != null);
    const clearsA = pop.filter((s) => passOn(reg, v, how, tr, s, "A", test4) === true), clearsB = pop.filter((s) => passOn(reg, v, how, tr, s, "B", test4) === true);
    const both = pop.filter((s) => clearsA.includes(s) && clearsB.includes(s));
    const n = pop.length, kA = clearsA.length, kB = clearsB.length;
    const dist = n > 0 ? intersectionDistribution(n, [kA, kB]) : [1];
    let cellsPriced = 0, cellsClear = 0;
    for (const s of symbols) for (const w of LIVE_WINDOWS) { const p = passOn(reg, v, how, tr, s, w, test4); if (p == null) continue; cellsPriced++; if (p) cellsClear++; }
    const pooled = cellsPriced ? cellsClear / cellsPriced : 0;
    return {
      population: n, clearsA: kA, clearsB: kB, twoWindow: both, oneWindowA: clearsA.filter((s) => !both.includes(s)), oneWindowB: clearsB.filter((s) => !both.includes(s)),
      notScored: symbols.filter((s) => !pop.includes(s)),
      chance: {
        section312: { expected: r2(n > 0 ? n * (kA / n) * (kB / n) : 0), formula: "coins × (share clearing A) × (share clearing B) — §3.12's control" },
        exactNull: { pAtLeastObserved: r4(dist.slice(both.length).reduce((x, y) => x + y, 0)), distribution: dist.slice(0, 6).map(r4), note: "each window's clearers an independent uniform subset of the population, of the size that window produced — the hypergeometric intersection of §3.15 / §T3, exact" },
        section415Pooled: { cellsPriced, cellsClear, perWindowPassRate: r3(pooled), expected: r2(pooled * pooled * n), formula: "(clear coin-windows ÷ priced coin-windows, all of A–D)² × coins with A and B — §4.15's correction" },
      },
    };
  }
  const part3: Record<string, unknown> = {};
  const condIds: string[] = [];
  for (const reg of STOP_RULES) for (const how of HOWS) for (const tr of TAPE_RULES) {
    const id = `${reg}·${how}·${tr}`;
    condIds.push(id);
    const perVenue: Record<string, ReturnType<typeof screen>> = {};
    for (const v of VENUES) perVenue[v] = screen(reg, v, how, tr);
    const incumbents = new Set([...perVenue.revx.twoWindow, ...perVenue.kraken.twoWindow]);
    const newAt: Record<string, string[]> = {};
    for (const v of binanceArms) newAt[v] = perVenue[v].twoWindow.filter((s) => !incumbents.has(s));
    const vsRevxVariant: Record<string, unknown> = {};
    for (const v of binanceArms) { const sc = screen(reg, v, how, tr, "vsRevx"); vsRevxVariant[v] = { twoWindow: sc.twoWindow, clearsA: sc.clearsA, clearsB: sc.clearsB, population: sc.population, expectedSection312: sc.chance.section312.expected, pAtLeastObserved: sc.chance.exactNull.pAtLeastObserved, newVsRevxOrKraken: sc.twoWindow.filter((s) => !incumbents.has(s)) }; }
    part3[id] = { perVenue, newAtBinanceCost: newAt, secondary_test4OnRevolutXCosts: vsRevxVariant };
  }
  // The bar's per-coin verdicts for the Binance arms, window by window (the raw material above).
  const perCoinBinance: Record<string, unknown> = {};
  for (const reg of STOP_RULES) {
    const bySym: Record<string, unknown> = {};
    for (const s of symbols) {
      const byW: Record<string, unknown> = {};
      for (const w of windowsPricedOn(s)) {
        const byV: Record<string, unknown> = {};
        for (const v of VENUES) {
          const byT: Record<string, unknown> = {};
          for (const tape of TAPES) {
            const c = cells[reg][tape][s]?.[w.name]?.[v];
            if (!c) continue;
            byT[tape] = { chosen: c.chosen, chosenOwn: { ret: c.chosenOwn.ret, maxDD: c.chosenOwn.maxDD, trades: c.chosenOwn.trades }, chosenOther: c.chosenOther.ret, seededOwn: { ret: c.seededOwn.ret, maxDD: c.seededOwn.maxDD, trades: c.seededOwn.trades }, seededOther: c.seededOther.ret, plateau: c.plateau.positiveShare, seededPass: c.seededPass, chosenPass: c.chosenPass, seededFailed: c.seededFailed, chosenFailed: c.chosenFailed, bookUsd: bookUsd(v, s), ...(c.vsRevx ? { vsRevx: { seededOther: c.vsRevx.seededOther.ret, chosenOther: c.vsRevx.chosenOther.ret, seededPass: c.vsRevx.seededPass, chosenPass: c.vsRevx.chosenPass } } : {}) };
          }
          if (Object.keys(byT).length) byV[v] = byT;
        }
        byW[w.name] = byV;
      }
      bySym[s] = byW;
    }
    perCoinBinance[reg] = bySym;
  }
  lap("part 3");

  // ── PART 1's per-coin table for the five, read off the cells ──────────
  const part1Coins: Record<string, unknown> = {};
  for (const c of CONDITIONS) {
    const bySym: Record<string, unknown> = {};
    for (const s of LIVE_ROW.symbols) {
      const byW: Record<string, unknown> = {};
      for (const w of windowsPricedOn(s)) {
        const row: Record<string, unknown> = {};
        for (const v of [...VENUES, ...descriptiveArms]) {
          const cell = cells[c.reg][c.tape][s]?.[w.name]?.[v];
          if (!cell) continue;
          row[v] = { seeded: { ret: cell.seededOwn.ret, maxDD: cell.seededOwn.maxDD, retOverDD: cell.seededOwn.retOverDD, trades: cell.seededOwn.trades }, chosen: { params: cell.chosen, ret: cell.chosenOwn.ret, maxDD: cell.chosenOwn.maxDD, trades: cell.chosenOwn.trades }, plateau: cell.plateau.positiveShare, seededPass: cell.seededPass && bookUsd(v, s) >= MIN_BOOK_USD, chosenPass: cell.chosenPass && bookUsd(v, s) >= MIN_BOOK_USD };
        }
        byW[w.name] = row;
      }
      bySym[s] = byW;
    }
    part1Coins[c.id] = bySym;
  }
  const part1Sleeve: Record<string, unknown> = {};
  for (const c of CONDITIONS) {
    const byArm: Record<string, unknown> = {};
    for (const a of armIds) {
      const per = sleeves[a][c.id];
      const wst = worstOf(per);
      byArm[a] = { perWindow: Object.fromEntries(LIVE_WINDOWS.filter((w) => per[w]).map((w) => [w, { ret: per[w]!.ret, maxDD: per[w]!.maxDD, retOverDD: per[w]!.retOverDD, pnlUsd: per[w]!.pnlUsd, members: per[w]!.members, capitalUsd: per[w]!.capitalUsd, turnoverPerYear: per[w]!.turnoverPerYear }])), worstOfFour: wst };
    }
    part1Sleeve[c.id] = byArm;
  }

  // ── the books: what each arm charges, and how it compares with what the project measured ──
  const roundTripBps = (v: string, s: string) => { const c = COST_OF[v]; const fee = c.fillFee === "taker" ? c.takerBps : c.makerBps; return r2(2 * fee + 2 * spreadOf(c, s) * 1e4); };
  const books = {
    fees: { revx: { makerBps: COSTS.revx.makerBps, takerBps: COSTS.revx.takerBps, fillFee: COSTS.revx.fillFee }, binance: { makerBps: BINANCE.makerBps, takerBps: BINANCE.takerBps, fillFee: BINANCE.fillFee }, binanceBnb: { makerBps: BINANCE_BNB.makerBps, takerBps: BINANCE_BNB.takerBps, fillFee: BINANCE_BNB.fillFee }, kraken: { makerBps: COSTS.kraken.makerBps, takerBps: COSTS.kraken.takerBps, fillFee: COSTS.kraken.fillFee } },
    pairedFive: PAIRED_FIVE,
    binanceOwnSample: BINANCE_BOOK_OWN,
    binance24hQuoteUsd: BINANCE_24H_QUOTE_USD,
    binanceBookLeg: Object.fromEntries(symbols.map((s) => {
      const coin = s.split("/")[0];
      const st = BINANCE_24H_QUOTE_USD.status[coin] ?? "not listed";
      const a = BINANCE_24H_QUOTE_USD.start.usd[coin] ?? 0, e = BINANCE_24H_QUOTE_USD.end.usd[coin] ?? 0;
      return [s, { status: st, startUsd: a, endUsd: e, passesAtStart: binanceBookUsd(s) >= MIN_BOOK_USD, passesAtEnd: st === "TRADING" && e >= MIN_BOOK_USD }];
    })),
    halfSpreadCharged: Object.fromEntries(Object.entries(BINANCE_HALF_SPREAD).map(([s, h]) => [s, { halfSpreadBps: r3(h * 1e4), source: s in PAIRED_FIVE.binance ? "paired sampler" : "this study's sampler" }])),
    roundTripBps: Object.fromEntries(symbols.map((s) => [s, Object.fromEntries(["revx", ...(s === SUI ? descriptiveArms : []), "kraken", ...binanceArms].filter((v) => hasBook(v, s)).map((v) => [v, roundTripBps(v, s)]))])),
    liveFiveRevolutXCompared: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, {
      chargedByCOSTS: { fullSpreadBps: r3(2 * spreadOf(COSTS.revx, s) * 1e4), roundTripBps: roundTripBps("revx", s) },
      pairedMedianTonight: PAIRED_FIVE.revxUk[s] ? { fullSpreadBps: PAIRED_FIVE.revxUk[s].median, roundTripBps: r2(PAIRED_FIVE.revxUk[s].median + 2 * COSTS.revx.takerBps) } : null,
    }])),
  };

  // ── fidelity: the book constants against the raw samples ───────────────
  if (booksDir) {
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const tol = 0.0005 + 1e-9;
    const chk = (where: string, embedded: number, here: number) => { compared++; if (!(Math.abs(embedded - here) <= tol)) rows.push({ where, embedded, here }); };
    const stat = (xs: number[]) => ({ n: xs.length, median: median(xs), p10: quantile(xs, 0.1), p90: quantile(xs, 0.9), min: Math.min(...xs), max: Math.max(...xs) });
    const files: Record<string, string> = {};
    const pairedTxt = await Deno.readTextFile(`${booksDir}/paired_samples.jsonl`);
    files["paired_samples.jsonl"] = await sha(`${booksDir}/paired_samples.jsonl`);
    // deno-lint-ignore no-explicit-any
    const paired = pairedTxt.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) as any[];
    for (const s of LIVE_ROW.symbols) {
      const coin = s.split("/")[0];
      const rv = paired.map((r) => r.revx?.[`${coin}-USD`]?.bps).filter((x) => typeof x === "number") as number[];
      const bn = paired.map((r) => r.binance?.[`${coin}USDT`]?.bps).filter((x) => typeof x === "number") as number[];
      const a = stat(rv), b = stat(bn);
      for (const f of ["median", "p10", "p90", "min", "max"] as const) { chk(`paired.revxUk.${s}.${f}`, PAIRED_FIVE.revxUk[s]?.[f] ?? NaN, a[f]); chk(`paired.binance.${s}.${f}`, PAIRED_FIVE.binance[s]?.[f] ?? NaN, b[f]); }
      chk(`paired.revxUk.${s}.n`, PAIRED_FIVE.revxUk[s]?.n ?? NaN, a.n); chk(`paired.binance.${s}.n`, PAIRED_FIVE.binance[s]?.n ?? NaN, b.n);
    }
    const ownTxt = await Deno.readTextFile(`${booksDir}/binance_cost_bookticker_samples.jsonl`);
    files["binance_cost_bookticker_samples.jsonl"] = await sha(`${booksDir}/binance_cost_bookticker_samples.jsonl`);
    // deno-lint-ignore no-explicit-any
    const own = ownTxt.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) as any[];
    chk("own.samples", BINANCE_BOOK_OWN.samples, own.length);
    for (const [s, st] of Object.entries(BINANCE_BOOK_OWN.fullSpreadBps)) {
      const coin = s.split("/")[0];
      const xs = own.map((r) => r.binance?.[`${coin}USDT`]?.bps).filter((x) => typeof x === "number") as number[];
      const a = stat(xs);
      for (const f of ["n", "median", "p10", "p90", "min", "max"] as const) chk(`own.${s}.${f}`, st[f], a[f]);
    }
    for (const tag of ["start", "end"] as const) {
      const p = `${booksDir}/binance_cost_24hr_${tag}.json`;
      files[`binance_cost_24hr_${tag}.json`] = await sha(p);
      const j = JSON.parse(await Deno.readTextFile(p)) as { rows: { symbol: string; quoteVolume: string }[] };
      for (const r of j.rows) chk(`24hr.${tag}.${r.symbol}`, BINANCE_24H_QUOTE_USD[tag].usd[r.symbol.replace(/USDT$/, "")] ?? NaN, Math.round(Number(r.quoteVolume)));
    }
    fid.bookConstants = { note: "every book constant this file charges or reports, re-derived from the raw keyless samples with this file's own `median` / `quantile` (tolerance 0.0005 bps: the constants are written to 3 dp)", files, fieldsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
    console.log(`bookConstants: ${compared} fields, ${rows.length} differences`);
  }

  // ── the reproduction, stated as numbers ────────────────────────────────
  const reproduction = {
    note: "published numbers this run re-derives on the Revolut X arm BEFORE any Binance arm is read; `fidelity` has the cell-by-cell comparisons",
    section320PrimaryTest: Object.fromEntries(TAPES.map((t) => [t, { meanRank: primaryByArm.revx[`shipped·${t}`].meanRank, pWorse: primaryByArm.revx[`shipped·${t}`].pWorse, published: t === "coinbase" ? { meanRank: 3.571, pWorse: 0.1782 } : { meanRank: 3.429, pWorse: 0.2557 } }])),
    liveSleeveShippedCoinbase: Object.fromEntries(LIVE_WINDOWS.map((w) => [w, sleeves.revx["shipped·coinbase"][w] ? { ret: sleeves.revx["shipped·coinbase"][w]!.ret, maxDD: sleeves.revx["shipped·coinbase"][w]!.maxDD, retOverDD: sleeves.revx["shipped·coinbase"][w]!.retOverDD } : null])),
    barBaseRate: (() => { const sc = screen("shipped", "revx", "seeded", "both"); return { ...sc.chance.section415Pooled, coinsWithAAndB: sc.population, published: { cells: 93, clear: 26, perWindowPassRate: 0.28, expected: 1.8, coins: 23 } }; })(),
  };

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error("backtest.ts changed during the run — every number above is from two different files");
  const report: Record<string, unknown> = {
    study: "Binance's cost instead of Revolut X UK's: the live row's five coins, SUI's seat (§3.20's pre-registered test) and §3.8 / §4.15's two-window screen, re-priced with ONLY the cost changed — same rule, windows, tapes, stop rules, grid and evaluations.",
    ownersQuestion: "Binance spot at 0.10 % maker / 0.10 % taker (0.075 % with BNB) against Revolut X at 0 % / 0.09 %, the loop taking the touch: what does each result become?",
    preRegistration: preregPath ? { file: preregPath.split("/").pop(), sha256: await sha(preregPath) } : { note: "not supplied" },
    costArms: {
      revx: { ...COSTS.revx, what: "`COSTS.revx` untouched — the reproduction" },
      revxMedian: { makerBps: REVX_MEDIAN.makerBps, takerBps: REVX_MEDIAN.takerBps, fillFee: REVX_MEDIAN.fillFee, suiHalfSpread: REVX_MEDIAN.halfSpread[SUI], suiFullSpreadBps: SUI_UK_MEDIAN_FULL_BPS, what: "DESCRIPTIVE ONLY (pre-registration addendum): `revx` with SUI charged §3.20's measured median UK spread, 14.877 bps, instead of 23.94 — `backtest_sui.ts`'s S5 `sampled` arm; every other coin is `revx`; no verdict reads it" },
      binance: { ...BINANCE, what: "10 bps a side, takes the touch, plus half the measured median Binance full spread a side" },
      binanceBnb: { ...BINANCE_BNB, what: "7.5 bps a side (BNB discount), takes the touch, same half-spreads" },
      kraken: { ...COSTS.kraken, what: "`COSTS.kraken` untouched — §4.15's fourth test for every arm but Kraken's own" },
      notModelled: ["the USDT/USD basis — Binance quotes USDT, every tape here is USD", "converting GBP into USDT (a one-off, not per trade)", "the price risk of holding BNB to pay fees at the discount", "depth beyond the touch — a $20 order is far inside the touch on every pair priced", "whether Binance may serve this UK account"],
      armsPriced: armIds,
    },
    reproduction,
    part1_theLiveCoins: {
      question: "each of the five coins, and the five-coin sleeve, on windows A–D at each cost arm — seeded parameters unless it says chosen",
      perCoin: part1Coins,
      sleeve: part1Sleeve,
    },
    part2_suiSeat: {
      test: "§3.20's pre-registered test, unchanged: SUI's rank among the five on the cost of removing it (Δ ret/DD of the sleeve without it, capital rescaled), fold by fold, with an exact rank-sum null; drop only if p(worse) < 0.05 on BOTH tapes; supported only if p(better) < 0.05 on both; otherwise undecided. Under each arm the whole row is priced at that arm's cost.",
      span: { from: iso(COMMON.fromTs), to: iso(COMMON.toTs), years: r2(spanMs / YEAR_MS), folds: K, foldDays: r2(foldMs / 86400e3), foldCalendar: folds.map((f) => ({ id: f.id, from: iso(f.fromTs), to: iso(f.toTs) })) },
      perArm: part2,
    },
    part3_theScreen: {
      bar: "§4.15: the four tests — positive out of sample on the running venue's costs, max drawdown < 35 %, at least half of the 27-point grid positive out of sample, positive on the second fee schedule (Kraken's; Revolut X's for Kraken itself) — on BOTH walk-forward windows (A: parameters on the first two thirds, the last third out; B: parameters on the first third, the middle third out), plus a book on the running venue of at least $100k a day (Revolut X UK; Kraken; Binance's <COIN>USDT 24 h quote volume, status TRADING).",
      conditions: condIds,
      headline: "shipped·seeded·both",
      perCondition: part3,
      perCoinVerdicts: perCoinBinance,
    },
    books,
    multipleComparisons: {
      gridPointsEvaluated: gridPoints,
      note: "Nothing is chosen by a result here: the rule, the grid, the windows and the coins are the published ones, and the only thing that varies is the cost. The screen is a search over coins, so its control is the chance column in every `perVenue` block; the SUI test is the one pre-registered test §3.20 fixed. Twelve screen conditions × four venues are reported; one is the headline, written down before the run.",
    },
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear)",
      B: "parameters on the first third, the MIDDLE third out of sample (bull)",
      C: "parameters on the 24 months of extended history before the series, the FIRST third out of sample (strong bull)",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample (sideways)",
    },
    stopRules: { shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS } }, trail: { stops: { ...PINNED_STOPS } } },
    fidelity: {
      runDaily: { cells: runDailyCells, checks: prefixChecks, worstAbsDiff: Number(prefixWorst.toPrecision(3)), tolerance: 5e-6, pass: prefixWorst <= 5.0000001e-6 },
      ...fid,
    },
    data: { symbols, perSymbol: provenance },
    sourceIntegrity: { backtestTsSha256: btHashStart, stableAcrossRun: true, note: "`backtest.ts` is hashed at the start and the end of the run; a run that straddles an edit throws." },
    determinism: "No wall-clock or runtime field is written. Re-running over the same inputs reproduces this file byte for byte.",
  };
  await Deno.writeTextFile(`${outDir}/binance.json`, JSON.stringify(report, null, 1));
  lap(`wrote ${outDir}/binance.json`);
}
