// The KRAKEN STANDALONE study: reference §3.12 asked whether Kraken earns
// its place on the SEVEN rulebooks that already exist over the 27 coins
// whose spreads `COSTS` carries, and answered no — 12 two-window passes
// where chance gives 14.6, Revolut X ahead in 18 of 18 paired comparisons,
// a fee tier needing 15.6× the turnover. Davies asked for that to be pushed
// rather than left there. This study pushes it in the two directions §3.12
// could not reach:
//
//   K1a — rulebooks BUILT for an 80 bps round trip rather than borrowed
//         from a venue that charges 20: a 200-day moving-average regime
//         hold, a wide daily Donchian, buy-and-hold with a crash stop, a
//         monthly-rebalanced trend filter, and §3.12's one exception
//         (`trend-4h-wide`, the only rulebook whose mean round trip cleared
//         a Kraken one at t > 2) carried onto coins it has never seen;
//   K1b — a WIDER COIN SEARCH. §3.12 tested the 27 coins in `COSTS`,
//         which are the 27 Revolut X lists. Kraken lists 622 online USD
//         pairs. This study measures all 622 keylessly, keeps the ones whose
//         book clears §4.15's $100k a day, and runs the rulebooks over every
//         one with three years of Kraken's own history — including ZEC, XMR
//         and TRX, the three coins §4.16 named as untestable on Revolut X.
//
// It also answers the two questions the dashboard's new LIVE / TESTING split
// raised: K2, what each TESTING row is worth, and K3, what is worth adding.
// Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest_kraken2.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --kdata <dir with BTC-USD_4h.json …> \
//       --out docs/agents/backtests
//
// Writes `<out>/kraken2.json` and nothing else. `latest.json`, `summary.json`,
// `kraken.json`, `allocation.json`, `portfolio.json` and every other study's
// output are NOT touched.
//
// ── what is imported, and what is copied ──────────────────────────────
//
// `backtest.ts`'s `run`, `runRotation`, `resample`, `COSTS`, `SHIPPED_STOPS`,
// `stopsForKind` and `spreadOf`, and the live rulebooks and indicators in
// `_shared/agents_strategy.ts`, are IMPORTED, never re-implemented. Every
// candidate below is therefore charged the same fee, filled at the same
// touch, stopped by the same protective exits read against each bar's low,
// and held back by the same two-bar cooldown as the rows the loop runs. Since
// `eff6ca8` (reference §3.13) those protective exits are the 8 % floor under
// cost ALONE — `stopsForKind` returns `atrStop: null` for every rulebook, the
// intra-bar trail having duplicated the trail `ruleDecision` already applies
// to the close. This study imports that decision rather than restating it, so
// a later change to it moves these numbers; every table in the report says
// which stop configuration produced it.
// `run` carries `barHours`, so the shipped trend rulebook on 4-hour, daily
// and weekly bars needs no copy at all, and neither does the rotation.
//
// The ONE copy is `runLogged`: `run` with the rulebook replaced by a
// callback (the four new rulebooks and the null control are not `run`
// `kind`s) and a per-trade log added (the hold distribution and the
// break-even drift are read off it). Everything in it that costs money is
// copied from `run` line by line — the touch at the next bar's open, the
// venue's `fillFee`, the floor under average cost, the ATR trail from the
// high since entry read against the next bar's low where a rulebook still
// carries one, the gap fill at the open, the high-water advance, the two-bar
// cooldown, and the return /
// drawdown / trade-count / exposure / day arithmetic. Driven by the shipped
// decider it must BE `run`, and `fidelity` in the report is the check, not
// the claim: 288 cells, with the maximum difference in return, drawdown and
// trade count reported for each. The regime gate of K3 is checked the same
// way — switched OFF it must reproduce `run` exactly.
//
// `median`, `quantile`, `mean`, `plateauOf`, `barTests`, `pick`, `score`,
// `dailyMarks`, `dailyReturns`, `dailyOpen` and `combine` are copied from
// `backtest_kraken.ts` / `backtest_allocation.ts` / `backtest_portfolio.ts`,
// which do not export them; none of them touches a price, a fee or a fill.
//
// ── method, identical to §3.7 / §3.8 / §3.10 / §3.11 / §3.12 ──────────
//
//   * TWO walk-forward windows, both reported, NEVER averaged:
//       A — parameters on the first two thirds, the LAST third out of
//           sample (the bear year);
//       B — parameters on the first third, the MIDDLE third out of sample
//           (the bull year);
//   * parameters are chosen ONCE, in sample, by return over drawdown, and
//     the chosen rule is then priced on both fee schedules, so the two
//     figures differ by costs alone. K1's arms choose on KRAKEN's costs,
//     because a rulebook for Kraken that is selected on somebody else's fee
//     is not a rulebook for Kraken; `trend-4h` is additionally reported
//     chosen on Revolut X costs, which is how §3.12 chose it, so the two
//     studies' anchors are comparable;
//   * the PLATEAU is the whole grid run out of sample on each venue's own
//     costs: an edge has neighbours, a fit does not;
//   * the BAR is §4.15's, applied from Kraken's point of view as §4.16
//     requires for a single-venue coin: positive out of sample on Kraken
//     costs, max drawdown < 35 %, at least half the grid positive out of
//     sample on Kraken costs, positive on the cheaper fee schedule — on
//     BOTH windows — and a Kraken book of at least $100k a day;
//   * RANKED BY THE WORSE WINDOW, never by an average of the two.
//
// ── the control that matters most ─────────────────────────────────────
//
// This study is a search over many rulebooks and many coins, so the number
// that decides what it means is not any arm's return but how many arms a
// rule with NO edge would have produced. Two controls are reported for
// every search:
//
//   1. the independence product §3.12 used — coins × P(clears A) ×
//      P(clears B) — which says what chance gives if a coin's two windows
//      are independent draws;
//   2. a NULL RULEBOOK run through the identical machinery: entries drawn
//      from a deterministic hash at a fixed rate, exits after a fixed
//      number of bars, the same stops, the same in-sample selection over a
//      12-point grid, the same bar. It has no edge by construction, and
//      whatever share of coins it "passes" is the share this method
//      manufactures out of a long-only rule in a rising market. Where the
//      two controls disagree the null is the one to believe, because it
//      carries the selection pressure the product does not.
//
// ── what is measured rather than assumed ──────────────────────────────
//
// `KRAKEN_BOOK_2026_09_21` is a real measurement taken for this study from
// Kraken's PUBLIC, keyless endpoints (`GET /0/public/AssetPairs` once and
// `GET /0/public/Ticker` twelve times, 60 s apart, 22:09–22:20 UTC on
// 2026-09-21): 622 online USD pairs sampled, the 199 whose median rolling
// 24-hour quote volume clears $100k a day listed here. No private endpoint
// was called and no key was touched.
//
// The price series for the widened universe is KRAKEN'S OWN, which no study
// in this repository has ever used: Kraken's quarterly OHLCVT bundle
// (`https://support.kraken.com/.../downloadable-historical-ohlcvt-data`,
// 8.97 GB, 4-hour `<PAIR>_240.csv`, complete to 2026-06-30) spliced with the
// last 720 four-hour candles from the keyless `GET /0/public/OHLC`. The
// splice overlaps by ~223 bars on every pair and the two sources agree to
// 0.000 bps there — they are the same tape — and the join is reported per
// pair in `series`. §3.12 named this bundle as "the right source for the
// next round"; this is that round. The core 27 keep Coinbase's series for
// K2 and K3 so those answers stay comparable with §3.11 and §3.12, and the
// two sources are compared head to head in `sourceCheck`.

import {
  applyFill, atrAt, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, priorRange, ruleFor, sma,
  type Action, type Candle, type Position, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, runRotation, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────── facts, not guesses

/**
 * Kraken's public book, measured for this study on 2026-09-21 22:09–22:20
 * UTC: `GET /0/public/AssetPairs` once (622 online USD pairs, `.d` and
 * dotted altnames dropped) and `GET /0/public/Ticker` twelve times, 60 s
 * apart. Keyless, read-only, nothing placed. Listed here are the 199 pairs
 * whose MEDIAN rolling 24-hour quote volume (`v[1] × p[1]`) clears §4.15's
 * $100k a day; the other 423 are counted in the funnel and dropped.
 *
 * [altname, symbol, quoteVolUsd, spreadBps, spreadMinBps, spreadMaxBps,
 *  ordermin (base), orderminUsd (at the median mid), costmin (quote),
 *  trades24h]
 *
 * `spreadBps` is the median of the twelve full spreads: HALVED it is the
 * half-spread this study charges a widened coin per side. The 27 coins
 * `COSTS` already carries keep `COSTS`' own half-spreads so that their
 * figures stay comparable with every earlier study, and the two
 * measurements sit beside each other in `books`.
 */
type BookRow = [string, string, number, number, number, number, number, number, number, number, string | null];
const KRAKEN_USD_PAIRS_SAMPLED = 622;
const KRAKEN_BOOK_SAMPLES = 12;
const KRAKEN_BOOK_2026_09_21: BookRow[] = [
  ["XBTUSD", "BTC/USD", 420113435, 0.012, 0.012, 0.012, 5e-05, 4.3305, 0.5, 177542, "2013-10-06"],
  ["USDTUSD", "USDT/USD", 347230868, 0.1, 0.1, 0.1, 5.0, 4.9992, 0.5, 61834, "2017-03-29"],
  ["ETHUSD", "ETH/USD", 210773931, 0.036, 0.036, 1.552, 0.001, 2.7769, 0.5, 96848, "2015-08-07"],
  ["XRPUSD", "XRP/USD", 137644227, 1.346, 0.064, 11.074, 1.65, 2.5819, 0.5, 69065, "2017-05-18"],
  ["USDCUSD", "USDC/USD", 120498154, 1.0, 1.0, 1.0, 5.0, 4.9992, 0.5, 22797, "2020-01-08"],
  ["SOLUSD", "SOL/USD", 89155140, 0.837, 0.835, 2.506, 0.06, 7.1691, 0.5, 64639, "2021-06-17"],
  ["EURUSD", "EUR/USD", 50940592, 0.087, 0.087, 0.523, 4.0, 4.5857, 0.5, 106220, "2020-03-12"],
  ["ZECUSD", "ZEC/USD", 43325453, 2.179, 0.477, 6.719, 0.01, 14.6643, 0.5, 26214, "2016-10-29"],
  ["NEARUSD", "NEAR/USD", 36650153, 5.785, 2.89, 10.359, 4.0, 16.6051, 0.5, 52506, "2022-06-16"],
  ["SUIUSD", "SUI/USD", 35760194, 1.459, 0.971, 2.913, 5.0, 5.1478, 0.5, 42141, "2023-05-03"],
  ["TAOUSD", "TAO/USD", 31562883, 8.252, 3.646, 11.943, 0.02, 6.073, 0.5, 51293, "2024-06-25"],
  ["XDGUSD", "DOGE/USD", 26833031, 1.34, 0.01, 4.272, 50.0, 5.0368, 0.5, 27547, "2019-12-19"],
  ["AVAXUSD", "AVAX/USD", 19974194, 1.78, 0.89, 2.682, 0.5, 5.6199, 0.5, 21165, "2021-12-21"],
  ["HYPEUSD", "HYPE/USD", 18189005, 1.072, 1.07, 2.147, 0.1, 9.3285, 0.5, 24969, "2026-01-28"],
  ["ADAUSD", "ADA/USD", 15707364, 3.516, 1.259, 6.108, 20.0, 4.9291, 0.5, 24843, "2018-09-28"],
  ["PEPEUSD", "PEPE/USD", 15475086, 5.154, 2.057, 16.454, 1500000.0, 7.2851, 0.5, 30373, "2023-05-16"],
  ["UNIUSD", "UNI/USD", 15088613, 6.484, 3.525, 12.566, 1.5, 13.2111, 0.5, 24582, "2020-10-15"],
  ["LTCUSD", "LTC/USD", 14937501, 1.618, 1.612, 6.466, 0.1, 6.1918, 0.5, 22631, "2013-10-24"],
  ["LINKUSD", "LINK/USD", 13252816, 5.84, 0.008, 7.472, 0.55, 7.2447, 0.5, 18184, "2019-09-25"],
  ["GBPUSD", "GBP/USD", 10977022, 0.449, 0.075, 0.748, 4.0, 5.3465, 0.5, 20426, "2020-03-12"],
  ["XMRUSD", "XMR/USD", 9823471, 18.309, 5.714, 29.374, 0.01, 5.9556, 0.5, 17341, "2017-01-02"],
  ["ENAUSD", "ENA/USD", 8522289, 9.533, 4.765, 9.574, 30.0, 6.2895, 0.5, 18662, "2024-05-30"],
  ["VVVUSD", "VVV/USD", 8290002, 10.859, 6.736, 21.464, 0.3, 9.7999, 0.5, 26004, "2025-02-27"],
  ["XLMUSD", "XLM/USD", 8284216, 6.891, 2.298, 13.883, 30.0, 6.5657, 0.5, 18677, "2017-01-17"],
  ["CRVUSD", "CRV/USD", 7479993, 12.401, 9.496, 16.102, 20.0, 7.3583, 0.5, 12576, "2020-09-17"],
  ["USELESSUSD", "USELESS/USD", 7366242, 27.747, 18.099, 39.102, 50.0, 14.1483, 0.5, 24903, "2025-08-13"],
  ["ONDOUSD", "ONDO/USD", 6534398, 6.486, 1.553, 12.089, 15.0, 6.8217, 0.5, 13926, "2024-04-11"],
  ["ARBUSD", "ARB/USD", 5565622, 4.483, 4.465, 8.957, 50.0, 11.1687, 0.5, 9494, "2023-03-23"],
  ["AAVEUSD", "AAVE/USD", 5527457, 4.506, 0.69, 7.624, 0.05, 7.2183, 0.5, 7802, "2020-12-15"],
  ["AKEUSD", "AKE/USD", 5094783, 28.356, 13.727, 74.044, 100.0, 5.5196, 0.5, 18224, "2025-08-22"],
  ["PENGUUSD", "PENGU/USD", 4427269, 3.413, 2.276, 9.13, 700.0, 6.1673, 0.5, 13386, "2025-01-28"],
  ["BCHUSD", "BCH/USD", 4333432, 0.551, 0.366, 16.524, 0.01, 2.7139, 0.5, 9092, "2017-08-01"],
  ["PUMPUSD", "PUMP/USD", 3790837, 5.787, 2.313, 13.915, 1100.0, 4.7523, 0.5, 5704, "2025-07-14"],
  ["INJUSD", "INJ/USD", 3599792, 5.779, 3.843, 7.717, 1.0, 7.7995, 0.5, 12128, "2021-08-10"],
  ["HBARUSD", "HBAR/USD", 3517974, 3.228, 1.075, 5.403, 55.0, 5.1161, 0.5, 9687, "2025-07-10"],
  ["FARTCOINUSD", "FARTCOIN/USD", 3380694, 10.433, 5.191, 20.931, 30.0, 5.7585, 0.5, 4366, "2025-01-23"],
  ["PAXGUSD", "PAXG/USD", 3221703, 0.506, 0.023, 1.726, 0.001, 4.3455, 0.5, 3801, "2019-10-29"],
  ["RENDERUSD", "RENDER/USD", 3121229, 5.433, 5.416, 10.887, 2.5, 4.6025, 0.5, 8822, "2024-08-06"],
  ["ZAMAUSD", "ZAMA/USD", 3120268, 13.154, 4.366, 53.672, 100.0, 9.1493, 0.5, 16948, "2026-02-02"],
  ["USDGUSD", "USDG/USD", 3008964, 1.0, 1.0, 1.0, 5.0, 4.9997, 0.5, 1281, "2024-11-04"],
  ["SEIUSD", "SEI/USD", 2946645, 3.39, 1.692, 5.08, 100.0, 5.9005, 0.5, 13316, "2023-08-15"],
  ["BNBUSD", "BNB/USD", 2510661, 1.8, 0.621, 2.232, 0.007, 5.6395, 0.5, 10874, "2025-04-22"],
  ["WLDUSD", "WLD/USD", 2487272, 13.053, 2.186, 15.236, 11.0, 5.0526, 0.5, 6632, "2025-03-05"],
  ["UAIUSD", "UAI/USD", 2482689, 16.607, 2.52, 34.071, 11.0, 4.3667, 0.5, 20040, "2025-11-06"],
  ["JUPUSD", "JUP/USD", 2471532, 16.759, 14.232, 19.661, 23.0, 6.7954, 0.5, 7036, "2024-01-31"],
  ["KASUSD", "KAS/USD", 2465143, 6.866, 4.579, 13.696, 200.0, 8.747, 0.5, 6805, "2024-11-19"],
  ["AUDUSD", "AUD/USD", 2429265, 1.124, 0.422, 1.967, 7.0, 4.9825, 0.5, 4579, "2020-06-16"],
  ["CCUSD", "CC/USD", 2352448, 4.761, 0.869, 6.072, 40.0, 4.6154, 0.5, 11113, "2025-11-10"],
  ["POLUSD", "POL/USD", 2243802, 9.809, 5.362, 22.257, 50.0, 5.6102, 0.5, 3870, "2023-12-21"],
  ["ALGOUSD", "ALGO/USD", 2121550, 8.921, 3.576, 12.442, 41.0, 4.5973, 0.5, 10148, "2020-01-22"],
  ["ICPUSD", "ICP/USD", 2115010, 3.346, 3.339, 6.707, 2.0, 5.977, 0.5, 4289, "2022-03-18"],
  ["DRVUSD", "DRV/USD", 1986378, 8.388, 0.245, 36.613, 35.0, 14.1962, 0.5, 6921, "2025-01-15"],
  ["FETUSD", "FET/USD", 1839505, 19.536, 14.545, 33.923, 18.0, 3.7004, 0.5, 5746, "2022-05-06"],
  ["SHIBUSD", "SHIB/USD", 1834197, 4.95, 3.26, 11.49, 770000.0, 4.6966, 0.5, 5721, "2021-11-30"],
  ["MINAUSD", "MINA/USD", 1830055, 16.948, 7.856, 32.163, 70.0, 8.8879, 0.5, 4992, "2021-06-01"],
  ["WIFUSD", "WIF/USD", 1821193, 16.539, 4.18, 25.0, 25.0, 6.0038, 0.5, 9451, "2024-02-01"],
  ["BONKUSD", "BONK/USD", 1801741, 2.981, 2.948, 5.914, 1500000.0, 5.0377, 0.5, 8048, "2023-12-22"],
  ["TRXUSD", "TRX/USD", 1775993, 0.363, 0.029, 0.959, 16.0, 5.5086, 0.5, 5851, "2020-03-05"],
  ["EURCUSD", "EURC/USD", 1745387, 5.495, 2.879, 10.814, 4.0, 4.5855, 0.5, 3507, "2025-09-23"],
  ["DASHUSD", "DASH/USD", 1562654, 6.275, 4.238, 8.814, 0.11, 6.4864, 0.5, 4693, "2017-04-12"],
  ["XPLUSD", "XPL/USD", 1516158, 10.283, 10.251, 20.492, 60.0, 5.841, 0.5, 7556, "2025-09-25"],
  ["SPXUSD", "SPX/USD", 1480919, 24.599, 19.654, 37.376, 9.0, 4.5754, 0.5, 4368, "2024-12-11"],
  ["APTUSD", "APT/USD", 1461298, 12.77, 7.644, 24.323, 9.0, 7.0547, 0.5, 5850, "2022-10-19"],
  ["SAGAUSD", "SAGA/USD", 1452845, 25.504, 12.711, 33.466, 350.0, 13.6675, 0.5, 11402, "2024-07-16"],
  ["DOTUSD", "DOT/USD", 1448395, 2.501, 0.831, 5.836, 3.9, 4.6761, 0.5, 8232, "2020-08-18"],
  ["NIGHTUSD", "NIGHT/USD", 1431770, 14.39, 8.214, 20.589, 250.0, 6.0831, 0.5, 7418, "2025-12-09"],
  ["PHAUSD", "PHA/USD", 1344961, 34.987, 26.013, 44.053, 200.0, 10.004, 0.5, 5560, "2021-10-08"],
  ["FILUSD", "FIL/USD", 1336918, 10.106, 10.076, 20.305, 7.0, 6.9265, 0.5, 4647, "2020-10-15"],
  ["STRKUSD", "STRK/USD", 1319022, 6.812, 4.541, 20.485, 200.0, 8.806, 0.5, 4829, "2024-02-20"],
  ["RAYUSD", "RAY/USD", 1276793, 19.015, 5.469, 37.951, 6.0, 11.0685, 0.5, 4684, "2021-09-28"],
  ["ASTERUSD", "ASTER/USD", 1268971, 4.393, 2.836, 12.417, 7.0, 5.1776, 0.5, 2296, "2025-10-20"],
  ["AKTUSD", "AKT/USD", 1268122, 14.867, 4.503, 25.462, 10.0, 6.6695, 0.5, 10134, "2022-02-01"],
  ["MONUSD", "MON/USD", 1240024, 9.651, 7.716, 15.432, 200.0, 5.1785, 0.5, 5480, "2025-11-24"],
  ["LIGHTERUSD", "LIGHTER/USD", 1206040, 10.591, 6.346, 16.964, 1.3, 6.136, 0.5, 5325, null],
  ["TRUMPUSD", "TRUMP/USD", 1114164, 4.56, 4.549, 9.145, 2.0, 4.386, 0.5, 2010, "2025-01-18"],
  ["OPUSD", "OP/USD", 1113178, 7.943, 7.915, 15.924, 50.0, 6.2988, 0.5, 3188, "2023-09-29"],
  ["XDCUSD", "XDC/USD", 1084630, 3.279, 3.262, 13.11, 180.0, 5.4941, 0.5, 5058, "2025-09-02"],
  ["TONUSD", "TON/USD", 1054543, 6.897, 6.875, 13.812, 3.5, 5.0794, 0.5, 4290, "2024-10-11"],
  ["PTBUSD", "PTB/USD", 1042161, 32.776, 24.341, 96.618, 7000.0, 8.5435, 0.5, 5356, "2025-09-03"],
  ["STXUSD", "STX/USD", 930955, 5.785, 2.898, 20.222, 20.0, 6.9135, 0.5, 2738, "2022-10-12"],
  ["AEROUSD", "AERO/USD", 927034, 7.262, 4.347, 17.411, 10.0, 6.901, 0.5, 2064, "2025-03-05"],
  ["MEGAUSD", "MEGA/USD", 914480, 4.491, 2.247, 8.973, 130.0, 5.7944, 0.5, 12385, "2026-04-30"],
  ["MANAUSD", "MANA/USD", 879013, 3.515, 1.172, 7.015, 70.0, 5.9741, 0.5, 4480, "2020-12-15"],
  ["PENDLEUSD", "PENDLE/USD", 870768, 19.964, 11.983, 28.062, 3.0, 7.5112, 0.5, 5112, "2024-06-06"],
  ["SKRUSD", "SKR/USD", 790149, 9.538, 4.764, 16.62, 200.0, 4.1956, 0.5, 5714, "2026-01-21"],
  ["GRASSUSD", "GRASS/USD", 777100, 21.251, 14.218, 100.432, 15.0, 6.3495, 0.5, 1998, "2025-01-27"],
  ["ZROUSD", "ZRO/USD", 771724, 16.92, 16.878, 25.37, 5.0, 5.9125, 0.5, 2790, "2024-06-21"],
  ["XCNUSD", "XCN/USD", 768119, 22.548, 22.497, 45.249, 1500.0, 6.6525, 0.5, 3190, "2022-08-26"],
  ["DGAIUSD", "DGAI/USD", 763321, 33.867, 27.956, 43.523, 7.0, 7.4061, 0.5, 2586, null],
  ["XAUTUSD", "XAUT/USD", 743988, 0.23, 0.23, 0.69, 0.0012, 5.2195, 0.5, 1368, "2025-09-12"],
  ["LDOUSD", "LDO/USD", 732168, 23.121, 23.068, 23.229, 15.0, 6.4875, 0.5, 2321, "2022-05-05"],
  ["DOGUSD", "DOG/USD", 707467, 91.325, 69.505, 146.615, 4000.0, 4.6, 0.5, 3797, "2025-06-27"],
  ["VIRTUALUSD", "VIRTUAL/USD", 700390, 24.274, 18.074, 37.477, 7.0, 5.037, 0.5, 2482, "2025-02-12"],
  ["QNTUSD", "QNT/USD", 668987, 10.352, 1.479, 35.651, 0.08, 5.411, 0.5, 4958, "2022-03-29"],
  ["ATOMUSD", "ATOM/USD", 663152, 13.524, 7.694, 21.452, 3.5, 6.3616, 0.5, 4351, "2019-04-22"],
  ["COTIUSD", "COTI/USD", 601929, 23.224, 6.642, 33.124, 400.0, 6.031, 0.5, 3936, "2022-06-09"],
  ["JTOUSD", "JTO/USD", 576905, 10.336, 6.968, 26.258, 12.0, 6.2098, 0.5, 6382, "2023-12-20"],
  ["PEAQUSD", "PEAQ/USD", 571184, 12.516, 8.341, 30.492, 220.0, 7.9112, 0.5, 4326, "2025-07-02"],
  ["XTZUSD", "XTZ/USD", 570847, 5.666, 3.486, 12.755, 13.0, 4.475, 0.5, 2861, "2018-10-16"],
  ["TIAUSD", "TIA/USD", 547884, 2.315, 2.304, 6.929, 15.0, 6.4991, 0.5, 7506, "2023-10-31"],
  ["MORPHOUSD", "MORPHO/USD", 544867, 10.56, 3.547, 35.006, 2.0, 5.3027, 0.5, 1937, "2024-11-21"],
  ["SYRUPUSD", "SYRUP/USD", 535007, 14.743, 10.84, 24.253, 25.0, 5.7652, 0.5, 2398, "2024-11-13"],
  ["ETHFIUSD", "ETHFI/USD", 530274, 16.793, 8.416, 26.461, 9.0, 6.44, 0.5, 1595, "2024-05-30"],
  ["NANOUSD", "NANO/USD", 529630, 40.848, 9.628, 85.91, 12.0, 4.6237, 0.5, 5355, "2019-11-06"],
  ["ZETAUSD", "ZETA/USD", 523431, 49.793, 33.167, 66.335, 150.0, 9.03, 0.5, 3302, "2024-05-30"],
  ["PLAYUSD", "PLAY/USD", 503271, 23.711, 9.207, 30.546, 130.0, 3.6755, 0.5, 6831, "2025-09-11"],
  ["SKYUSD", "SKY/USD", 487860, 8.344, 5.575, 13.9, 70.0, 5.0281, 0.5, 1826, "2024-10-02"],
  ["NPCUSD", "NPC/USD", 473448, 39.204, 28.454, 55.749, 300.0, 7.3844, 0.5, 6655, "2025-06-25"],
  ["LUNAUSD", "LUNA/USD", 471462, 10.873, 7.257, 12.675, 100000.0, 5.5223, 0.5, 1854, "2021-12-16"],
  ["LSKUSD", "LSK/USD", 460306, 19.907, 11.932, 45.147, 50.0, 18.3143, 0.5, 3088, "2019-11-19"],
  ["SYNUSD", "SYN/USD", 457458, 19.216, 11.536, 26.918, 60.0, 15.6585, 0.5, 2340, "2022-09-29"],
  ["KTAUSD", "KTA/USD", 442518, 57.372, 11.581, 117.509, 60.0, 5.2305, 0.5, 2135, "2025-08-05"],
  ["EIGENUSD", "EIGEN/USD", 435337, 8.33, 4.157, 12.539, 25.0, 6.0081, 0.5, 2702, "2024-10-01"],
  ["FLRUSD", "FLR/USD", 423619, 14.493, 14.316, 28.986, 800.0, 5.554, 0.5, 2380, "2023-01-10"],
  ["CFGUSD", "CFG/USD", 399996, 7.249, 7.244, 7.275, 45.0, 6.2078, 0.5, 5033, "2022-04-29"],
  ["GRTUSD", "GRT/USD", 396790, 15.094, 8.632, 17.279, 300.0, 6.9495, 0.5, 3183, "2020-12-18"],
  ["ARUSD", "AR/USD", 394973, 17.881, 11.162, 29.08, 2.2, 9.8505, 0.5, 3605, "2025-04-28"],
  ["DYDXUSD", "DYDX/USD", 390688, 13.02, 10.149, 17.389, 45.0, 6.2243, 0.5, 904, "2021-09-14"],
  ["PYTHUSD", "PYTH/USD", 383693, 12.67, 9.562, 15.858, 100.0, 6.2888, 0.5, 2777, "2023-12-05"],
  ["WBTCUSD", "WBTC/USD", 380214, 30.927, 21.475, 35.63, 6e-05, 5.1959, 0.5, 360, "2021-08-03"],
  ["NILUSD", "NIL/USD", 374225, 14.652, 14.588, 29.369, 100.0, 6.825, 0.5, 2068, "2025-03-26"],
  ["PROVEUSD", "PROVE/USD", 373416, 37.221, 28.944, 49.669, 30.0, 7.2548, 0.5, 2642, "2025-08-29"],
  ["CLOUDUSD", "CLOUD/USD", 371528, 114.025, 68.415, 159.272, 200.0, 8.775, 0.5, 2065, "2024-07-18"],
  ["CAKEUSD", "CAKE/USD", 361249, 9.812, 3.924, 35.412, 2.5, 6.3669, 0.5, 1010, "2025-05-02"],
  ["AIOZUSD", "AIOZ/USD", 346872, 96.151, 50.125, 376.113, 90.0, 13.104, 0.5, 3543, "2025-07-11"],
  ["MNTUSD", "MNT/USD", 339419, 12.33, 9.229, 24.615, 10.0, 6.4992, 0.5, 1896, "2024-07-03"],
  ["SUSD", "S/USD", 335228, 50.761, 25.413, 76.239, 180.0, 7.0875, 0.5, 1704, "2025-05-05"],
  ["POPCATUSD", "POPCAT/USD", 332219, 36.331, 18.1, 54.299, 100.0, 5.505, 0.5, 2524, "2024-09-19"],
  ["SUSHIUSD", "SUSHI/USD", 322517, 7.871, 3.949, 7.902, 25.0, 6.3475, 0.5, 1460, "2021-05-24"],
  ["FLOWUSD", "FLOW/USD", 307066, 60.606, 30.349, 60.79, 200.0, 6.595, 0.5, 1449, "2021-01-27"],
  ["HNTUSD", "HNT/USD", 295275, 34.115, 29.536, 56.908, 8.0, 3.7526, 0.5, 2754, "2024-03-14"],
  ["MOGUSD", "MOG/USD", 293295, 16.793, 8.372, 16.849, 45000000.0, 5.3595, 0.5, 966, "2024-08-29"],
  ["ETCUSD", "ETC/USD", 284902, 19.691, 14.621, 26.837, 0.7, 6.2298, 0.5, 890, "2016-07-27"],
  ["ZBCNUSD", "ZBCN/USD", 283093, 46.167, 33.727, 82.584, 2500.0, 5.1594, 0.5, 3590, "2025-10-15"],
  ["CELRUSD", "CELR/USD", 276413, 73.871, 63.325, 90.47, 2300.0, 7.5888, 0.5, 2748, "2022-08-26"],
  ["SHXUSD", "SHX/USD", 269654, 2.794, 2.787, 8.388, 1500.0, 5.3693, 0.5, 2116, "2025-10-22"],
  ["WUSD", "W/USD", 263440, 16.964, 8.478, 25.456, 500.0, 5.8875, 0.5, 1255, "2024-04-03"],
  ["CHIPUSD", "CHIP/USD", 254483, 17.484, 4.372, 23.952, 110.0, 5.0413, 0.5, 1454, "2026-04-22"],
  ["DCRUSD", "DCR/USD", 238822, 16.831, 16.831, 16.831, 0.35, 6.2384, 0.5, 1334, "2026-05-22"],
  ["PLUMEUSD", "PLUME/USD", 236662, 13.351, 6.687, 26.72, 350.0, 5.2334, 0.5, 3436, "2025-04-23"],
  ["BATUSD", "BAT/USD", 231515, 4.159, 2.378, 17.803, 70.0, 5.8933, 0.5, 2014, "2019-08-22"],
  ["AUSDUSD", "AUSD/USD", 229126, 0.2, 0.2, 0.6, 5.0, 4.9994, 0.5, 404, "2026-01-08"],
  ["GUSD", "G/USD", 227199, 31.316, 21.916, 43.928, 1400.0, 8.9348, 0.5, 2778, "2025-01-22"],
  ["CROUSD", "CRO/USD", 226087, 39.562, 18.212, 77.738, 90.0, 5.9076, 0.5, 2617, "2025-01-29"],
  ["FLOKIUSD", "FLOKI/USD", 224499, 15.502, 3.46, 24.026, 200000.0, 5.8005, 0.5, 1038, "2024-07-16"],
  ["WLFIUSD", "WLFI/USD", 222747, 17.498, 17.437, 34.904, 90.0, 5.1525, 0.5, 820, "2025-09-01"],
  ["VETUSD", "VET/USD", 221226, 12.916, 6.51, 18.435, 700.0, 6.4985, 0.5, 2100, "2026-01-02"],
  ["LAPTOPUSD", "LAPTOP/USD", 211193, 35.273, 35.149, 35.273, 25.0, 2.1263, 0.5, 2974, null],
  ["ATHUSD", "ATH/USD", 210233, 35.778, 17.873, 53.619, 1000.0, 5.5925, 0.5, 1441, "2024-11-12"],
  ["SRMUSD", "SRM/USD", 204692, 218.341, 170.94, 302.812, 600.0, 4.1655, 0.5, 2414, "2021-06-17"],
  ["CPOOLUSD", "CPOOL/USD", 202894, 78.056, 28.09, 113.314, 250.0, 7.0581, 0.5, 2145, "2024-08-13"],
  ["TREADUSD", "TREAD/USD", 201774, 32.64, 2.046, 79.551, 5.0, 2.451, 0.5, 5697, null],
  ["RUNEUSD", "RUNE/USD", 191797, 46.476, 30.864, 62.112, 11.0, 7.117, 0.5, 668, "2022-05-06"],
  ["CVXUSD", "CVX/USD", 190688, 16.97, 9.709, 24.313, 2.0, 4.1225, 0.5, 896, "2022-03-29"],
  ["ZRCUSD", "ZRC/USD", 190215, 176.521, 41.457, 1101.482, 6000.0, 10.1955, 0.5, 3252, "2025-10-29"],
  ["ENSUSD", "ENS/USD", 187044, 29.455, 14.76, 44.215, 0.8, 5.424, 0.5, 1317, "2022-02-25"],
  ["GENIUSUSD", "GENIUS/USD", 183789, 21.373, 17.084, 34.178, 18.0, 6.3189, 0.5, 1180, "2026-05-15"],
  ["GALAUSD", "GALA/USD", 183742, 47.962, 47.733, 48.193, 3000.0, 6.255, 0.5, 815, "2022-02-25"],
  ["LITUSD", "LIT/USD", 182733, 64.83, 51.881, 84.279, 35.0, 5.3909, 0.5, 996, "2024-08-29"],
  ["COMPUSD", "COMP/USD", 178905, 8.919, 4.451, 26.798, 0.25, 5.6063, 0.5, 850, "2020-07-15"],
  ["CAPUSD", "CAP/USD", 176351, 5.463, 3.056, 20.582, 70.0, 3.2017, 0.5, 3394, "2026-06-26"],
  ["NOSUSD", "NOS/USD", 174592, 39.095, 13.91, 50.251, 18.0, 6.4494, 0.5, 2096, "2024-06-04"],
  ["SANDUSD", "SAND/USD", 174476, 47.733, 23.895, 47.962, 120.0, 5.016, 0.5, 787, "2021-05-20"],
  ["JASMYUSD", "JASMY/USD", 173218, 45.924, 22.91, 45.977, 1000.0, 4.3525, 0.5, 1270, "2022-04-01"],
  ["ZIGUSD", "ZIG/USD", 172819, 21.737, 1.974, 21.737, 120.0, 6.0726, 0.5, 2363, "2025-09-04"],
  ["KIIUSD", "KII/USD", 171568, 19.142, 13.591, 22.23, 86.0, 6.9626, 0.5, 405, null],
  ["SWELLUSD", "SWELL/USD", 170698, 132.457, 71.392, 220.0, 6000.0, 5.907, 0.5, 3050, "2024-11-07"],
  ["STGUSD", "STG/USD", 158131, 8.241, 8.207, 16.502, 30.0, 3.6405, 0.5, 2430, "2022-09-29"],
  ["SODAUSD", "SODA/USD", 157813, 6.882, 6.828, 6.885, 400.0, 5.812, 0.5, 3282, null],
  ["KSMUSD", "KSM/USD", 153874, 21.622, 21.622, 21.668, 1.4, 6.475, 0.5, 1169, "2020-09-17"],
  ["GIGAUSD", "GIGA/USD", 151915, 27.202, 4.24, 231.628, 2000.0, 4.76, 0.5, 2049, "2024-10-29"],
  ["TGBPUSD", "TGBP/USD", 148453, 1.496, 0.449, 2.095, 4.0, 5.3465, 0.5, 214, "2025-11-11"],
  ["SN64USD", "SN64/USD", 145445, 59.914, 58.904, 125.698, 0.3, 6.3534, 0.5, 2861, null],
  ["MYXUSD", "MYX/USD", 144193, 124.224, 124.224, 124.224, 70.0, 5.635, 0.5, 1187, "2025-10-13"],
  ["OOBUSD", "OOB/USD", 143041, 97.161, 10.178, 102.249, 500.0, 4.89, 0.5, 2939, "2025-11-12"],
  ["ESPORTSUSD", "ESPORTS/USD", 140605, 97.561, 97.561, 97.561, 300.0, 3.075, 0.5, 633, "2025-11-28"],
  ["ARXUSD", "ARX/USD", 140519, 34.119, 22.92, 66.043, 40.0, 8.031, 0.5, 869, "2026-06-22"],
  ["MOODENGUSD", "MOODENG/USD", 133039, 13.662, 8.412, 21.03, 130.0, 6.2081, 0.5, 505, "2024-12-18"],
  ["RLCUSD", "RLC/USD", 131600, 20.328, 11.618, 29.095, 15.0, 5.1641, 0.5, 693, "2022-05-05"],
  ["TACUSD", "TAC/USD", 126975, 18.547, 6.182, 24.752, 2000.0, 3.235, 0.5, 199, "2025-07-15"],
  ["ARKMUSD", "ARKM/USD", 126713, 15.955, 7.984, 16.013, 45.0, 5.6374, 0.5, 544, "2024-05-30"],
  ["BABYUSD", "BABY/USD", 126471, 16.267, 8.133, 16.34, 400.0, 4.912, 0.5, 3440, "2025-04-17"],
  ["PONKEUSD", "PONKE/USD", 125531, 17.596, 15.631, 145.641, 250.0, 6.3906, 0.5, 1746, "2024-10-15"],
  ["TURBOUSD", "TURBO/USD", 124335, 19.148, 9.565, 28.888, 5000.0, 5.2125, 0.5, 1033, "2024-08-13"],
  ["MUBARAKUSD", "MUBARAK/USD", 124141, 34.341, 25.175, 41.03, 250.0, 10.9231, 0.5, 852, "2025-04-30"],
  ["TRACUSD", "TRAC/USD", 123823, 59.282, 38.813, 99.01, 15.0, 5.4413, 0.5, 1359, "2024-06-25"],
  ["RARIUSD", "RARI/USD", 123278, 146.373, 106.762, 230.292, 60.0, 6.771, 0.5, 2051, "2021-05-17"],
  ["NOCKUSD", "NOCK/USD", 122744, 63.526, 2.639, 134.82, 250.0, 9.4731, 0.5, 288, "2026-06-25"],
  ["FLOCKUSD", "FLOCK/USD", 121843, 77.111, 72.845, 93.275, 150.0, 11.0951, 0.5, 2268, "2026-01-09"],
  ["KNTQUSD", "KNTQ/USD", 120879, 8.169, 0.323, 84.391, 30.0, 9.391, 0.5, 1101, "2026-05-27"],
  ["STORJUSD", "STORJ/USD", 120764, 55.616, 46.361, 129.31, 150.0, 4.8544, 0.5, 1130, "2020-07-15"],
  ["DRIFTUSD", "DRIFT/USD", 117979, 59.172, 58.997, 118.343, 400.0, 6.77, 0.5, 759, "2024-06-20"],
  ["B2USD", "B2/USD", 117466, 22.541, 16.393, 32.847, 12.0, 5.8557, 0.5, 513, "2025-10-07"],
  ["BICOUSD", "BICO/USD", 113460, 22.08, 8.822, 30.967, 250.0, 5.66, 0.5, 1061, "2022-02-25"],
  ["KAITOUSD", "KAITO/USD", 107408, 11.554, 8.697, 14.44, 15.0, 5.1863, 0.5, 450, "2025-02-20"],
  ["IMXUSD", "IMX/USD", 104147, 19.987, 19.953, 26.649, 40.0, 6.006, 0.5, 810, "2022-02-25"],
  ["ACHUSD", "ACH/USD", 103403, 33.812, 33.727, 33.841, 1100.0, 6.5065, 0.5, 336, "2022-05-31"],
  ["SUPERUSD", "SUPER/USD", 102353, 20.053, 13.351, 26.774, 50.0, 7.48, 0.5, 624, "2022-05-19"],
  ["PIEVERSEUSD", "PIEVERSE/USD", 100162, 20.621, 15.78, 69.849, 5.0, 9.22, 0.5, 440, "2026-05-20"],
];

/**
 * Revolut X UK-book 24-hour quote volume, reference §3.8 (medians of 21
 * samples a minute apart on 2026-09-21), as `backtest_kraken.ts` embeds it.
 * A coin under §4.15's $100k a day here may still run on Kraken alone
 * (§4.16) — which is what the widened search is looking for.
 */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "XRP/USD": 2_600_000,
  "AAVE/USD": 54_000, "DOGE/USD": 199_000, "LINK/USD": 693_000, "UNI/USD": 159_000, "ADA/USD": 122_000,
  "LTC/USD": 44_000, "BNB/USD": 19_000, "AVAX/USD": 1_900_000, "HBAR/USD": 114_000, "SHIB/USD": 11_000,
  "XLM/USD": 176_000, "PEPE/USD": 102_000, "DOT/USD": 769_000, "ALGO/USD": 180_000, "BCH/USD": 928_000,
  "ATOM/USD": 17_000, "SUI/USD": 942_000, "HYPE/USD": 123_000, "NEAR/USD": 2_800_000, "ICP/USD": 171_000,
  "ETC/USD": 8_000, "POL/USD": 11_000, "TON/USD": 8_000,
};
const MIN_BOOK_USD = 100_000;

/** The 27 coins every earlier study tested — the coins Revolut X lists and `COSTS` prices. */
const CORE_27 = Object.keys(COSTS.revx.halfSpread);

/**
 * Pairs dropped from the widened universe before any return was looked at,
 * and why. Stablecoins and fiat are not an asset a trend rule can be about;
 * a wrapped coin is a coin already in the list; tokenised gold is neither
 * crypto nor excluded — PAXG stays in and is FLAGGED, because "a coin
 * Kraken has and Revolut X does not" is exactly what K1b is looking for and
 * hiding it would be choosing the answer.
 */
const STABLE_OR_FIAT = new Set(["USDTUSD", "USDCUSD", "USDGUSD", "AUSDUSD", "TGBPUSD", "EURCUSD", "EURUSD", "GBPUSD", "AUDUSD", "DAIUSD", "PYUSDUSD", "RLUSDUSD", "USDSUSD", "TUSDUSD", "USDQUSD"]);
const WRAPPED = new Set(["WBTCUSD", "WETHUSD", "WSTETHUSD", "TBTCUSD", "LSETHUSD", "EETHUSD"]);
const NON_CRYPTO_FLAG = new Set(["PAXG/USD", "XAUT/USD"]);

/** §4.15's history test as this study applies it: three years of Kraken's own 4-hour tape, so each third is a year. */
const MIN_HISTORY_FIRST_BAR = "2023-09-21";
/**
 * Kraken's CSV omits a bar in which nothing traded. Those bars are
 * forward-filled to a complete 4-hour grid (flat bar, zero volume) so that
 * "the prior 55 bars" means the same span of time on every coin, and a pair
 * missing more than 2 % of the grid is dropped as not continuously traded.
 * The threshold was set after looking at the distribution of MISSING BARS
 * and before looking at any return: the median pair is missing 0.05 % and
 * six pairs are over 2 %.
 */
const MAX_FILLED_SHARE = 0.02;

/** `agent_risk` (migration 0037), per venue account and per mode. */
const MAX_ORDER_USD = 20;
const MAX_EXPOSURE_USD_LIVE = 100;

/** Kraken's fee schedule at this account's tier and the next (§2b, live `TradeVolume` 2026-09-20). */
const KRAKEN_TIER2_VOLUME_USD = 2_500;
const COSTS_KRAKEN_T2_BASE: Costs = { ...COSTS.kraken, venue: "kraken-tier2", makerBps: 30, takerBps: 60 };

/** §3.11's measured median holds, the numbers every arm here is read against. */
const SHIPPED_MEDIAN_HOLD_DAYS = { "trend-4h": 2.29, "momentum-1d": 3.42, "trend-1h": 0.60 };

/** The live rows (migrations 0037 / 0039 / 0040) and §3.11's recommendation. */
const RECOMMENDED_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"];
const TREND_1H_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"];
const MOMENTUM_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"];
const BASKET = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];

// ──────────────────────────────────────────────────────────── the windows

/** §4.15's two walk-forward windows on a series of `n` bars, as §3.12 cuts them. */
type Window = { name: "A" | "B"; isFrom: number; isTo: number; oosFrom: number; oosTo: number };
function windowsFor(n: number): Window[] {
  const t1 = Math.floor(n / 3), t2 = Math.floor(n * 2 / 3);
  return [
    { name: "A", isFrom: 0, isTo: t2, oosFrom: t2, oosTo: n },
    { name: "B", isFrom: 0, isTo: t1, oosFrom: t1, oosTo: t2 },
  ];
}

// ──────────────────────────────────────────── the logged simulator (a copy)

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => Action;

/** One round trip as the fills happened. `gross` is the raw price move before any spread or fee. */
type Trade = { entryBar: number; exitBar: number; holdBars: number; gross: number; net: number; stop: boolean };

type LoggedResult = RunResult & {
  tradeLog: Trade[];
  /** [bar start, equity] every bar — `run` samples every sixth, which is too coarse for a daily combine. */
  equityEveryBar: [number, number][];
  /** [bar start, 1 when a position was held over that bar] — what the exposure cap sees. */
  openFlags: [number, number][];
};

/**
 * `backtest.ts`'s `run` with the rulebook replaced by a callback and a
 * per-trade log added. Everything that costs money is COPIED FROM `run`
 * LINE BY LINE; the log and the per-bar samples are recording only. With
 * the shipped decider this must BE `run` — `fidelity` in the report is the
 * check.
 */
function runLogged(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, stops: StopParams | null,
): LoggedResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  const tradeLog: Trade[] = [];
  let entryBar = -1, entryRaw = 0, entryNet = 0;       // bookkeeping only — no price, fee or level reads it
  const equity: [number, number][] = [], equityEveryBar: [number, number][] = [], openFlags: [number, number][] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const action = decide(i, pos);
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++;
      entryBar = i + 1; entryRaw = next.open; entryNet = price * (1 + fill);
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; lastExitBar = i + 1;
      tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: next.open / entryRaw - 1, net: price * (1 - fill) / entryNet - 1, stop: false });
    } else if (stops && pos.base > 0) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
      const floor = pos.avgCost * (1 - stops.maxLossPct);
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (next.low <= level) {
        const price = Math.min(level, next.open) * (1 - hs);
        const fee = pos.base * price * stopFee;
        cash = pos.base * price - fee;
        pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
        trades++; stopsHit++; lastExitBar = i + 1;
        tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: Math.min(level, next.open) / entryRaw - 1, net: price * (1 - stopFee) / entryNet - 1, stop: true });
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    if (i % 6 === 0) equity.push([next.start, Number(eq.toFixed(5))]);
    equityEveryBar.push([next.start, eq]);
    openFlags.push([next.start, pos.base > 0 ? 1 : 0]);
  }
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradeLog, equityEveryBar, openFlags,
  };
}

/**
 * The SHIPPED decision at each bar as a callback: `buildSnapshot` +
 * `ruleFor`, the pair `run` itself calls, with `lookbackDays` exposed.
 * Copied from `backtest_kraken.ts` / `backtest_ideas.ts`, which do not
 * export it.
 */
function shippedDecider(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number, lookbackDays = 30,
): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365, lookbackDays);
    return ruleFor(kind, snap, pos, p).action;
  };
}

// ───────────────────────────────── the rulebooks built for an 80 bps fee
// Each is a RULE, not a simulator: it returns enter / exit / hold and the
// imported machinery does everything that costs money. §3.6's finding is
// the reason they all decide on daily or 4-hour closes and none faster.

/**
 * K1a-1 — the 200-day moving-average regime hold. In while the close is
 * above its `n`-day average, out below it (optionally only once it is
 * `buffer` under, so a day of noise does not pay a round trip). The
 * crudest rule that is in a bull market and out of a bear, it trades a
 * handful of times a year by construction, which is the shape 80 bps
 * needs. Nothing in `run`'s rulebooks is this simple: the shipped trend
 * rule also wants a breakout, a momentum sign and a volatility regime.
 */
function maRegimeHold(bars: Candle[], n: number, buffer: number): Decide {
  const ma = sma(bars.map((c) => c.close), n);
  return (i, pos) => {
    const m = ma[i];
    if (m == null) return "hold";
    if (pos.base > 0) return bars[i].close < m * (1 - buffer) ? "exit" : "hold";
    return bars[i].close > m ? "enter" : "hold";
  };
}

/**
 * K1a-2 — a bare Donchian channel: long on a close above the prior `n`-bar
 * high, out on a close below the prior `m`-bar low. The same definition
 * `backtest_ideas.ts` (idea 2) and `backtest_kraken.ts` tested; what is new
 * here is the width — 100 / 200-day entries with 50 / 100-day exits, and a
 * floor wide enough not to be the exit.
 */
function donchian(bars: Candle[], n: number, m: number): Decide {
  return (i, pos) => {
    if (pos.base > 0) {
      const r = priorRange(bars, i, m);
      return r && bars[i].close < r.low ? "exit" : "hold";
    }
    const r = priorRange(bars, i, n);
    return r && bars[i].close > r.high ? "enter" : "hold";
  };
}

/**
 * K1a-3 — buy and hold with a crash stop. Long all the time except after
 * the close has fallen `ddPct` below its highest close of the last `hiN`
 * days; back in when the close is above its `reN`-day average (`reN` 0 =
 * as soon as the drawdown condition clears). One or two round trips a year
 * on a three-year window, so the fee is arithmetically irrelevant — which
 * makes it the cleanest test of whether Kraken's cost is the binding
 * constraint or an excuse.
 */
function crashStopHold(bars: Candle[], ddPct: number, hiN: number, reN: number): Decide {
  const closes = bars.map((c) => c.close);
  const ma = reN > 0 ? sma(closes, reN) : null;
  const hi: number[] = [];                      // the highest close of the last hiN bars, inclusive
  for (let i = 0; i < closes.length; i++) {
    let h = -Infinity;
    for (let k = Math.max(0, i - hiN + 1); k <= i; k++) h = Math.max(h, closes[k]);
    hi.push(h);
  }
  return (i, pos) => {
    const crashed = closes[i] <= hi[i] * (1 - ddPct);
    if (pos.base > 0) return crashed ? "exit" : "hold";
    if (crashed) return "hold";
    if (ma) { const m = ma[i]; return m != null && closes[i] > m ? "enter" : "hold"; }
    return "enter";
  };
}

/**
 * K1a-4 — a monthly-rebalanced trend filter. The rule looks at the market
 * on the first bar of each UTC calendar month and at no other time: long
 * if the close is above its `n`-day average (`sma`) or above its close `n`
 * days ago (`tsmom`), flat otherwise. Twelve decision points a year is the
 * slowest cadence a daily series can carry, and it is how every published
 * time-series-momentum result is run.
 */
function monthlyTrend(bars: Candle[], mode: "sma" | "tsmom", n: number): Decide {
  const closes = bars.map((c) => c.close);
  const ma = mode === "sma" ? sma(closes, n) : null;
  const month = bars.map((c) => new Date(c.start).getUTCFullYear() * 12 + new Date(c.start).getUTCMonth());
  return (i, pos) => {
    if (i === 0 || month[i] === month[i - 1]) return "hold";     // not a rebalance bar
    const long = mode === "sma"
      ? (ma![i] != null && closes[i] > ma![i]!)
      : (i >= n && closes[i] > closes[i - n]);
    if (pos.base > 0) return long ? "hold" : "exit";
    return long ? "enter" : "hold";
  };
}

/**
 * THE NULL. Entries drawn from a deterministic hash at a fixed rate, exits
 * after a fixed number of the rule's own bars, everything else — the
 * stops, the cooldown, the fills, the fee, the in-sample selection over its
 * own grid, the bar — identical to every real arm. It has no edge by
 * construction. Whatever share of coins it clears the bar on is the share
 * this METHOD manufactures from a long-only rule in a market that rose, and
 * it is the control the search has to beat. FNV-1a keeps it reproducible:
 * the same coin and bar draw the same number on every run and on every
 * machine.
 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function nullRule(symbol: string, bars: Candle[], rate: number, holdBars: number, barHours: number, salt: string): Decide {
  const holdMs = holdBars * barHours * 3600e3;
  return (i, pos) => {
    if (pos.base > 0) return bars[i].start - (pos.openedAt ?? bars[i].start) >= holdMs ? "exit" : "hold";
    return hash32(`${salt}|${symbol}|${i}`) / 4294967296 < rate ? "enter" : "hold";
  };
}

/**
 * K3's candidate — §3.9's idea 1 and §3.10's point 6: the shipped trend
 * rule with every ENTRY gated by BTC's daily close being above its `n`-day
 * average. Exits are untouched. `enabled` exists so the fidelity check can
 * switch the new behaviour off and see `run` reproduced exactly; the
 * definition is `backtest_ideas.ts`'s, which does not export it.
 */
type BtcRegime = { daily: Candle[]; sma: Record<number, (number | null)[]> };
function regimeFiltered(base: Decide, bars: Candle[], btc: BtcRegime, n: number, barHours: number, enabled: boolean): Decide {
  let j = -1;
  return (i, pos) => {
    const action = base(i, pos);
    const nowMs = bars[i].start + barHours * 3600e3;
    while (j + 1 < btc.daily.length && btc.daily[j + 1].start + 86400e3 <= nowMs) j++;
    if (!enabled || action !== "enter" || j < 0) return action;
    const ma = btc.sma[n][j];
    if (ma == null) return action;                   // the average cannot be computed yet — it does not block
    return btc.daily[j].close > ma ? "enter" : "hold";
  };
}

// ────────────────────────────────── arithmetic on OUTPUTS (copies)
// (from backtest_kraken.ts / backtest_allocation.ts / backtest_portfolio.ts,
//  which do not export them; none of these touches a price, a fee or a fill.)

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN; }
function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
function r4(x: number): number { return Number.isFinite(x) ? Number(x.toFixed(4)) : 0; }
function r2(x: number): number { return Number.isFinite(x) ? Number(x.toFixed(2)) : 0; }

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: Number((s.filter((r) => r > 0).length / Math.max(1, s.length)).toFixed(3)),
    median: r4(s[Math.floor(s.length / 2)]),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §3.7 / §4.15's four tests on one segment, from one venue's point of view (`backtest_kraken.ts`'s own). */
function barTests(ownRet: number, ownDD: number, plateauShare: number, otherRet: number): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(ownRet > 0)) failed.push("own-venue return not positive");
  if (!(ownDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateauShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(otherRet > 0)) failed.push("other-venue return not positive");
  return { pass: failed.length === 0, failed };
}

/** A venue's round-trip cost in bps for one symbol: two fills at `fillFee` plus two half-spreads. */
function roundTripBps(costs: Costs, symbol: string): number {
  const feeBps = costs.fillFee === "taker" ? costs.takerBps : costs.makerBps;
  return 2 * feeBps + 2 * spreadOf(costs, symbol) * 1e4;
}

/**
 * The number K1 asks for beside every arm: the constant annual drift at
 * which a median hold pays for one round trip. 80 bps over a 2.29-day hold
 * needs 127 % a year; over 100 days it needs 2.9 %. It is a scale, not a
 * forecast — trend returns are not a drift — and it is the fastest way to
 * see whether an arm is arithmetically possible on Kraken at all.
 */
function breakEvenDriftPerYear(rtBps: number, holdDays: number): number {
  return holdDays > 0 ? (rtBps / 1e4) * 365 / holdDays : NaN;
}

function pick(r: RunResult) {
  return {
    ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}
function fmt(r: RunResult) { return `${(r.ret * 100).toFixed(1)}% (DD ${(r.maxDD * 100).toFixed(0)}%, ${r.trades} trades)`; }

/** The last equity sample of each UTC day — a sleeve's daily mark. */
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
/** A day's flag per sleeve: 1 when it held a position at any point that day. */
function dailyOpen(flags: [number, number][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const [t, f] of flags) {
    const d = Math.floor(t / 86400e3) * 86400e3;
    m.set(d, Math.max(m.get(d) ?? 0, f));
  }
  return m;
}
type Sleeve = { id: string; slotUsd: number; exposure: number; rets: Map<number, number>; open: Map<number, number>; tradedPerSlot: number; fills: number };
type SetStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; fills: number; fillsPer90Days: number;
};
/** Combine sleeves at their slot sizes (`backtest_allocation.ts`'s `combine`, with the fill count added). */
function combine(sleeves: Sleeve[]): SetStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  if (!days.length) {
    return { members: 0, capitalUsd: 0, pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0, days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, peakOpenUsd: 0, fills: 0, fillsPer90Days: 0 };
  }
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  const opens: number[] = [];
  for (const d of days) {
    let pnl = 0, open = 0;
    for (const s of sleeves) { pnl += s.slotUsd * (s.rets.get(d) ?? 0); open += s.slotUsd * (s.open.get(d) ?? 0); }
    opens.push(open);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
  }
  const spanDays = Math.max(1, (days[days.length - 1] - days[0]) / 86400e3);
  const tradedUsd = sleeves.reduce((a, s) => a + s.tradedPerSlot * s.slotUsd, 0);
  const fills = sleeves.reduce((a, s) => a + s.fills, 0);
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: r2(capital), pnlUsd: r2(eq - capital), ret: r4(ret), maxDD: r4(maxDD),
    retOverDD: r2(ret / Math.max(0.05, maxDD)), days: days.length,
    from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: Number((capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0).toFixed(3)),
    turnoverPerYear: r2(tradedUsd / Math.max(1e-9, capital) / (spanDays / 365)),
    bestDayUsd: r2(best), worstDayUsd: r2(worst), peakOpenUsd: r2(Math.max(...opens)),
    fills, fillsPer90Days: r2(fills / spanDays * 90),
  };
}

// ─────────────────────────────────────────────── the candidate rulebooks

/**
 * A candidate is a bar size and a grid of points; a point is either one of
 * `run`'s own `kind`s (no copy at all) or a decider run through
 * `runLogged`. `lookback` is how many of its own bars the rule needs before
 * it can decide, which is what says whether a window is long enough to mean
 * anything.
 */
type Point = {
  label: string; kind: StrategyKind | null; trend: TrendParams; stops: StopParams;
  decider?: (symbol: string, bars: Candle[], daily: Candle[]) => Decide;
  lookback: number;
};
type Candidate = { id: string; what: string; barHours: number; grid: Point[]; isNull: boolean };

/** A floor of 99 % is no floor: the position is left to the rulebook's own exits, and the cooldown still applies. */
const NO_FLOOR = 0.99;

function trendPoint(t: Partial<TrendParams>, maxLossPct: number, kind: StrategyKind = "trend-4h"): Point {
  const trend: TrendParams = { ...DEFAULT_TREND, ...t };
  return {
    label: `fast ${trend.fast}/slow ${trend.slow}/break ${trend.breakoutUp}/atr ${trend.atrStop}/floor ${(maxLossPct * 100).toFixed(0)}%`,
    trend, stops: { ...stopsForKind(kind, trend), maxLossPct }, kind,
    lookback: trend.slow + 1,                 // exactly where `run` starts, so the copy and the original agree
  };
}
function decidedPoint(label: string, floor: number, lookback: number, decider: Point["decider"]): Point {
  return { label, kind: null, trend: DEFAULT_TREND, stops: { ...SHIPPED_STOPS, atrStop: null, maxLossPct: floor }, decider, lookback };
}

function CANDIDATES(): Candidate[] {
  const out: Candidate[] = [];

  // The anchor: the shipped 4-hour rule on its shipped grid, so everything
  // slower is read against the rule that is actually running.
  const shipped: Point[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) {
    shipped.push(trendPoint({ fast, slow, atrStop }, SHIPPED_STOPS.maxLossPct));
  }
  out.push({ id: "trend-4h", what: "the shipped rule on 4h bars, the shipped grid — the anchor, and §3.12's median 3.2-day hold", barHours: 4, grid: shipped, isNull: false });

  // §3.12's one exception: the only rulebook whose mean round trip cleared a
  // Kraken one at t > 2. Here it meets 46 coins it has never seen.
  const wide: Point[] = [];
  for (const slow of [200, 300]) for (const breakoutUp of [100, 200]) for (const atrStop of [4, 6]) {
    wide.push(trendPoint({ slow, breakoutUp, breakoutDown: Math.round(breakoutUp / 2.75), atrStop }, SHIPPED_STOPS.maxLossPct));
  }
  out.push({ id: "trend-4h-wide", what: "the shipped rule on 4h bars with slow 200/300, breakout 100/200, a 4/6×ATR trail — §3.12's one exception, on a wider universe", barHours: 4, grid: wide, isNull: false });

  // K1a-1: the 200-day regime hold.
  const ma: Point[] = [];
  for (const n of [100, 150, 200]) for (const buffer of [0, 0.03]) for (const floor of [SHIPPED_STOPS.maxLossPct, NO_FLOOR]) {
    ma.push(decidedPoint(`ma ${n}d/buffer ${(buffer * 100).toFixed(0)}%/floor ${(floor * 100).toFixed(0)}%`, floor, n + 1, (_s, bars) => maRegimeHold(bars, n, buffer)));
  }
  out.push({ id: "ma-regime-1d", what: "in while the daily close is above its 100/150/200-day average, out below it (0 / 3 % buffer) — the simplest rule that is in a bull and out of a bear", barHours: 24, grid: ma, isNull: false });

  // K1a-2: the wide daily Donchian.
  const don: Point[] = [];
  for (const n of [100, 200]) for (const m of [50, 100]) for (const floor of [SHIPPED_STOPS.maxLossPct, NO_FLOOR]) {
    don.push(decidedPoint(`donchian ${n}/${m}/floor ${(floor * 100).toFixed(0)}%`, floor, n + 1, (_s, bars) => donchian(bars, n, m)));
  }
  out.push({ id: "donchian-wide-1d", what: "a bare Donchian on daily closes — 100/200-day entries, 50/100-day exits, no MA, momentum or volatility gate", barHours: 24, grid: don, isNull: false });

  // K1a-3: buy and hold with a crash stop.
  const crash: Point[] = [];
  for (const dd of [0.25, 0.35]) for (const reN of [0, 50, 100]) for (const floor of [0.20, NO_FLOOR]) {
    crash.push(decidedPoint(`crash ${(dd * 100).toFixed(0)}% off the 252d high/re-entry ${reN === 0 ? "when clear" : `above the ${reN}d average`}/floor ${(floor * 100).toFixed(0)}%`, floor, 253, (_s, bars) => crashStopHold(bars, dd, 252, reN)));
  }
  out.push({ id: "crash-stop-hold", what: "buy and hold, out only after a 25/35 % fall from the 252-day high, back in when clear or above the 50/100-day average — one or two round trips a year", barHours: 24, grid: crash, isNull: false });

  // K1a-4: the monthly rebalance.
  const mon: Point[] = [];
  for (const [mode, n] of [["sma", 100], ["sma", 200], ["tsmom", 126], ["tsmom", 252]] as const) {
    for (const floor of [SHIPPED_STOPS.maxLossPct, NO_FLOOR]) {
      mon.push(decidedPoint(`monthly ${mode} ${n}d/floor ${(floor * 100).toFixed(0)}%`, floor, n + 1, (_s, bars) => monthlyTrend(bars, mode, n)));
    }
  }
  out.push({ id: "monthly-trend", what: "a decision on the first bar of each calendar month and at no other time: long above the 100/200-day average, or on a positive 6/12-month return", barHours: 24, grid: mon, isNull: false });

  // THE NULL, at the same cadence and a comparable grid size.
  const nul: Point[] = [];
  for (const rate of [0.01, 0.02, 0.04, 0.08]) for (const hold of [5, 10, 20, 40]) {
    nul.push(decidedPoint(`null p ${rate}/hold ${hold}d`, SHIPPED_STOPS.maxLossPct, 1, (s, bars) => nullRule(s, bars, rate, hold, 24, "kraken2-null")));
  }
  out.push({ id: "null-hold-1d", what: "THE CONTROL: entries from a deterministic hash at a fixed rate, exits after 10/20/40 days, everything else identical — no edge by construction", barHours: 24, grid: nul, isNull: true });

  return out;
}

// ───────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");      // Coinbase 1h, the core 27 — K2 and K3
  const kdataDir = String(args.kdata ?? "");    // Kraken's own 4h tape — K1
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir || !kdataDir) throw new Error("--data <coinbase 1h dir> and --kdata <kraken 4h dir> are both required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  // ── the book, and the funnel from 622 pairs to the universe ───────────
  type Book = {
    altname: string; symbol: string; quoteVolUsd: number; spreadBps: number; spreadMinBps: number; spreadMaxBps: number;
    ordermin: number; orderminUsd: number; costmin: number; trades24h: number; historyFirstBar: string | null;
  };
  const book: Record<string, Book> = {};
  for (const [altname, symbol, quoteVolUsd, spreadBps, spreadMinBps, spreadMaxBps, ordermin, orderminUsd, costmin, trades24h, historyFirstBar] of KRAKEN_BOOK_2026_09_21) {
    book[symbol] = { altname, symbol, quoteVolUsd, spreadBps, spreadMinBps, spreadMaxBps, ordermin, orderminUsd, costmin, trades24h, historyFirstBar: historyFirstBar ?? null };
  }
  /** The spliced Kraken series' provenance, written by the data step beside the candles. */
  type Prov = { altname: string; core: boolean; bars: number; filled: number; filledShare: number; first: string; last: string; historyFirst: string };
  const prov: Record<string, Prov> = JSON.parse(await Deno.readTextFile(`${kdataDir}/_series.json`));

  const funnel = {
    onlineUsdPairsSampled: KRAKEN_USD_PAIRS_SAMPLED,
    bookAtLeast100kADay: Object.keys(book).length,
    droppedStablecoinOrFiat: [] as string[],
    droppedWrapped: [] as string[],
    droppedNoOrShortHistory: [] as string[],
    droppedNotContinuouslyTraded: [] as string[],
    universe: [] as string[],
    universeCore: [] as string[],
    universeNew: [] as string[],
    flaggedNonCrypto: [] as string[],
  };
  for (const b of Object.values(book).sort((x, y) => y.quoteVolUsd - x.quoteVolUsd)) {
    if (STABLE_OR_FIAT.has(b.altname)) { funnel.droppedStablecoinOrFiat.push(b.symbol); continue; }
    if (WRAPPED.has(b.altname)) { funnel.droppedWrapped.push(b.symbol); continue; }
    if (!b.historyFirstBar || b.historyFirstBar > MIN_HISTORY_FIRST_BAR) { funnel.droppedNoOrShortHistory.push(b.symbol); continue; }
    const p = prov[b.symbol];
    if (!p) { funnel.droppedNoOrShortHistory.push(b.symbol); continue; }
    if (p.filledShare > MAX_FILLED_SHARE) { funnel.droppedNotContinuouslyTraded.push(b.symbol); continue; }
    funnel.universe.push(b.symbol);
    (CORE_27.includes(b.symbol) ? funnel.universeCore : funnel.universeNew).push(b.symbol);
    if (NON_CRYPTO_FLAG.has(b.symbol)) funnel.flaggedNonCrypto.push(b.symbol);
  }
  const UNIVERSE = funnel.universe;
  console.log(`universe: ${UNIVERSE.length} pairs (${funnel.universeCore.length} of the core 27, ${funnel.universeNew.length} new) from ${KRAKEN_USD_PAIRS_SAMPLED} online USD pairs`);

  // ── costs: `COSTS`' spreads where they exist, this study's measurement otherwise ──
  const measuredHalf: Record<string, number> = {};
  for (const sym of UNIVERSE) if (!(sym in COSTS.kraken.halfSpread)) measuredHalf[sym] = book[sym].spreadBps / 2 / 1e4;
  const KCOSTS: Costs = { ...COSTS.kraken, halfSpread: { ...COSTS.kraken.halfSpread, ...measuredHalf } };
  const KT2: Costs = { ...COSTS_KRAKEN_T2_BASE, halfSpread: KCOSTS.halfSpread };
  /**
   * The cheaper fee schedule: Revolut X's 0 % maker / 9 bps taker at the
   * SAME spread. For a coin Revolut X does not list this is not a twin — it
   * is the fee-schedule half of the bar's fourth test, which asks whether a
   * result survives a different fee. For the core 27 the REAL Revolut X
   * twin (`COSTS.revx`, its own UK-book spread) is reported as well, and
   * that is the one the "beaten by its own twin" comparison uses.
   */
  const CHEAP: Costs = { venue: "revx-fee-at-kraken-spread", makerBps: 0, takerBps: 9, fillFee: "taker", halfSpread: KCOSTS.halfSpread };
  const otherCostsFor = (symbol: string): Costs => CORE_27.includes(symbol) ? COSTS.revx : CHEAP;

  // ── the series ────────────────────────────────────────────────────────
  type Series = { c4h: Candle[]; daily: Candle[]; weekly: Candle[]; hourly?: Candle[] };
  const kser: Record<string, Series> = {};
  for (const sym of UNIVERSE) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${kdataDir}/${sym.replace("/", "-")}_4h.json`));
    const c4h: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    kser[sym] = { c4h, daily: resample(c4h, 24), weekly: resample(c4h, 168) };
  }
  const COINBASE_SYMBOLS = [...new Set([...RECOMMENDED_SYMBOLS, ...TREND_1H_SYMBOLS, ...MOMENTUM_SYMBOLS, ...BASKET, "LINK/USD", "NEAR/USD", "ALGO/USD"])].sort();
  const cser: Record<string, Series> = {};
  for (const sym of COINBASE_SYMBOLS) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${sym.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    cser[sym] = { hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24), weekly: resample(hourly, 168) };
  }
  const barsOf = (s: Series, barHours: number): Candle[] => barHours === 1 ? s.hourly! : barHours === 4 ? s.c4h : barHours === 24 ? s.daily : s.weekly;

  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    study: "kraken standalone — is there a rulebook built for 80 bps, or a coin Kraken alone carries, that clears the bar on both windows on Kraken's costs? And what are the TESTING rows worth?",
    source: "K1: Kraken's OWN 4-hour tape — the quarterly OHLCVT bundle (complete to 2026-06-30) spliced with the last 720 candles of the keyless public OHLC endpoint, forward-filled to a complete 4-hour grid and trimmed to the three years every pair shares. K2 and K3: Coinbase 1h → 4h/1d, as §3.10–§3.12, so those answers stay comparable. Two walk-forward windows (A: parameters on the first two thirds, last third out; B: parameters on the first third, middle third out), never averaged, ranked by the worse. Fills, fees, stops and the two-bar cooldown are backtest.ts's own: Kraken rests post-only (40 bps maker + half-spread), Revolut X takes the touch (9 bps taker + half-spread). The model is not in the backtest.",
    bar: "docs/agents/reference.md §4.15, applied from Kraken's point of view as §4.16 requires for a single-venue coin: positive out of sample on Kraken costs, max drawdown < 35 %, at least half the grid positive out of sample on Kraken costs, positive on the cheaper fee schedule — on BOTH windows — and a Kraken book of at least $100k a day.",
    choiceNote: "K1's parameters are chosen in sample on KRAKEN's costs (§3.12 chose on Revolut X's, which is the right choice when the question is 'the same rule on both venues' and the wrong one when the question is 'a rulebook for Kraken'). `trend-4h` is reported chosen BOTH ways so the two studies' anchors line up.",
    universeRule: `Kraken online USD pairs, dotted altnames dropped; median rolling 24-hour quote volume over ${KRAKEN_BOOK_SAMPLES} samples ≥ $${MIN_BOOK_USD.toLocaleString()}; not a stablecoin, fiat pair or wrapped duplicate; at least three years of Kraken's own 4-hour history (first bar on or before ${MIN_HISTORY_FIRST_BAR}); and no more than ${(MAX_FILLED_SHARE * 100).toFixed(0)} % of the 4-hour grid forward-filled for want of a trade. Tokenised gold (PAXG) is kept and flagged, because "a coin Kraken has and Revolut X does not" is what this search is for.`,
    caps: { maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLivePerVenue: MAX_EXPOSURE_USD_LIVE },
    costs: { kraken: KCOSTS, krakenTier2: KT2, cheaperFeeSchedule: CHEAP, revx: COSTS.revx },
    krakenBookMeasured: `GET /0/public/AssetPairs once and GET /0/public/Ticker ${KRAKEN_BOOK_SAMPLES} times, 60 s apart, 2026-09-21 22:09–22:20 UTC. Keyless, read-only, nothing placed. ${KRAKEN_USD_PAIRS_SAMPLED} online USD pairs sampled; the ${Object.keys(book).length} clearing $${MIN_BOOK_USD.toLocaleString()} a day are listed.`,
    books: Object.values(book).sort((x, y) => y.quoteVolUsd - x.quoteVolUsd).map((b) => ({
      ...b,
      krakenRoundTripBps: r2(2 * KCOSTS.makerBps + (b.symbol in KCOSTS.halfSpread ? 2 * spreadOf(KCOSTS, b.symbol) * 1e4 : b.spreadBps)),
      ukBookUsd: UK_BOOK_USD_PER_DAY[b.symbol] ?? null,
      krakenOnly: !(UK_BOOK_USD_PER_DAY[b.symbol] >= MIN_BOOK_USD),
      slotPlaceable: b.orderminUsd <= MAX_ORDER_USD && b.costmin <= MAX_ORDER_USD,
      inCore27: CORE_27.includes(b.symbol),
      inUniverse: UNIVERSE.includes(b.symbol),
    })),
    funnel,
    series: prov,
    seriesNote: "Kraken's CSV omits a 4-hour bar in which nothing traded; `filled` counts the bars forward-filled to a complete grid (flat bar, zero volume). `overlap` in the data step showed the bundle and the live endpoint agreeing to 0.000 bps on every pair over ~223 shared bars — they are the same tape.",
  };

  // ── fidelity: the copy IS `run`, and the regime gate off IS `run` ─────
  const fid = { checks: 0, worstRet: 0, worstDD: 0, worstTrades: 0 };
  const fidCells: { symbol: string; window: string; kind: string; barHours: number; venue: string; params: string; dRet: number; dDD: number; dTrades: number }[] = [];
  const WIDE_POINT: TrendParams = { ...DEFAULT_TREND, fast: 30, slow: 200, breakoutUp: 100, breakoutDown: 36, atrStop: 4 };
  const WEEKLY_POINT: TrendParams = { ...DEFAULT_TREND, fast: 4, slow: 26, breakoutUp: 13, breakoutDown: 4, atrStop: 3 };
  /** Each case is a rulebook, a bar size, and the parameter points that bar size can carry. */
  const FID_CASES: { kind: StrategyKind; barHours: number; points: TrendParams[] }[] = [
    { kind: "trend-4h", barHours: 4, points: [DEFAULT_TREND, WIDE_POINT] },
    { kind: "momentum-1d", barHours: 24, points: [DEFAULT_TREND, WIDE_POINT] },
    { kind: "trend-4h", barHours: 24, points: [DEFAULT_TREND, WIDE_POINT] },
    { kind: "trend-4h", barHours: 168, points: [WEEKLY_POINT] },
  ];
  for (const symbol of ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD", "XRP/USD"]) {
    const s = cser[symbol];
    for (const w of windowsFor(s.c4h.length)) {
      for (const { kind, barHours, points } of FID_CASES) {
        const bars = barsOf(s, barHours);
        const scale = barHours / 4;
        const wFrom = Math.min(bars.length - 2, Math.floor(w.oosFrom / scale));
        const wTo = Math.min(bars.length, Math.floor(w.oosTo / scale));
        for (const costs of [COSTS.revx, KCOSTS, CHEAP]) {
          for (const p of points) {
            const st = stopsForKind(kind, p);
            const a = run(kind, symbol, bars, s.daily, wFrom, wTo, p, costs, barHours, st);
            const b = runLogged(symbol, bars, wFrom, wTo, p.slow + 1, shippedDecider(kind, symbol, bars, s.daily, p, barHours), costs, st);
            const dRet = Math.abs(a.ret - b.ret), dDD = Math.abs(a.maxDD - b.maxDD), dTrades = Math.abs(a.trades - b.trades);
            fid.worstRet = Math.max(fid.worstRet, dRet); fid.worstDD = Math.max(fid.worstDD, dDD); fid.worstTrades = Math.max(fid.worstTrades, dTrades);
            fid.checks++;
            if (dRet > 0 || dDD > 0 || dTrades > 0) fidCells.push({ symbol, window: w.name, kind, barHours, venue: costs.venue, params: `${p.fast}/${p.slow}`, dRet, dDD, dTrades });
          }
        }
      }
    }
  }
  // The K3 gate, switched off: `regimeFiltered(..., enabled=false)` must also BE `run`.
  const btcDaily = cser["BTC/USD"].daily;
  const btcCloses = btcDaily.map((c) => c.close);
  const BTC_REGIME: BtcRegime = { daily: btcDaily, sma: Object.fromEntries([100, 150, 200].map((n) => [n, sma(btcCloses, n)])) };
  const gateOff = { checks: 0, worstRet: 0, worstDD: 0, worstTrades: 0 };
  for (const symbol of ["BTC/USD", "ETH/USD", "SOL/USD", "LINK/USD", "NEAR/USD", "ALGO/USD", "SUI/USD"]) {
    const s = cser[symbol];
    for (const w of windowsFor(s.c4h.length)) {
      for (const costs of [COSTS.revx, KCOSTS]) {
        const st = stopsForKind("trend-4h", DEFAULT_TREND);
        const a = run("trend-4h", symbol, s.c4h, s.daily, w.oosFrom, w.oosTo, DEFAULT_TREND, costs, 4, st);
        const base = shippedDecider("trend-4h", symbol, s.c4h, s.daily, DEFAULT_TREND, 4);
        const b = runLogged(symbol, s.c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, regimeFiltered(base, s.c4h, BTC_REGIME, 200, 4, false), costs, st);
        gateOff.worstRet = Math.max(gateOff.worstRet, Math.abs(a.ret - b.ret));
        gateOff.worstDD = Math.max(gateOff.worstDD, Math.abs(a.maxDD - b.maxDD));
        gateOff.worstTrades = Math.max(gateOff.worstTrades, Math.abs(a.trades - b.trades));
        gateOff.checks++;
      }
    }
  }
  report.fidelity = {
    runLoggedVsRun: { ...fid, disagreements: fidCells,
      note: "runLogged (the one copy) driven by shippedDecider against backtest.ts's run: 6 coins × 2 windows × {trend-4h on 4h bars, momentum-1d on daily, the trend rule on daily, the trend rule on weekly} × 3 fee schedules × 2 parameter points. Largest absolute difference in return, drawdown and trade count." },
    regimeGateOffVsRun: { ...gateOff,
      note: "K3's BTC regime gate with the new behaviour SWITCHED OFF, against run: 7 coins × 2 windows × 2 fee schedules. With the gate off the candidate must be the shipped rule exactly." },
  };
  console.log(`fidelity: runLogged ${fid.checks} checks worst |Δret| ${fid.worstRet.toExponential(2)} |ΔmaxDD| ${fid.worstDD.toExponential(2)} |Δtrades| ${fid.worstTrades}; gate-off ${gateOff.checks} checks worst |Δret| ${gateOff.worstRet.toExponential(2)} |Δtrades| ${gateOff.worstTrades}`);

  // ── K1: the arms, over every coin in the universe, both windows ───────
  const candidates = CANDIDATES();
  const armById = Object.fromEntries(candidates.map((c) => [c.id, c]));

  function runPoint(symbol: string, cand: Candidate, p: Point, from: number, to: number, costs: Costs, s: Series): RunResult {
    const bars = barsOf(s, cand.barHours);
    if (p.kind && !p.decider) return run(p.kind, symbol, bars, s.daily, from, to, p.trend, costs, cand.barHours, p.stops);
    return runLogged(symbol, bars, from, to, p.lookback, p.decider!(symbol, bars, s.daily), costs, p.stops);
  }
  /** The same point again through the copy, for the trade log alone — identical to `run` by `fidelity`. */
  function logFor(symbol: string, cand: Candidate, p: Point, from: number, to: number, costs: Costs, s: Series): LoggedResult {
    const bars = barsOf(s, cand.barHours);
    const decide = p.decider ? p.decider(symbol, bars, s.daily) : shippedDecider(p.kind ?? "trend-4h", symbol, bars, s.daily, p.trend, cand.barHours);
    return runLogged(symbol, bars, from, to, p.lookback, decide, costs, p.stops);
  }
  /** A point is usable when the out-of-sample segment opens after its warm-up and the in-sample segment leaves 20 of its own bars to choose on. */
  function usablePoints(grid: Point[], w: Window): Point[] {
    return grid.filter((p) => w.oosFrom >= p.lookback && w.isTo >= p.lookback + 20);
  }

  type Cell = {
    arm: string; symbol: string; window: "A" | "B"; barHours: number; core: boolean; krakenOnly: boolean;
    bars: number; oosBars: number; gridUsable: number; chosen: string;
    kraken: ReturnType<typeof pick>; other: ReturnType<typeof pick>; tier2: ReturnType<typeof pick>;
    otherIsRealRevx: boolean; plateauKraken: number; plateauOther: number; gridMedianKraken: number;
    passKraken: boolean; failedKraken: string[];
    trades: number; medianHoldDays: number; meanHoldDays: number; breakEvenDriftPerYear: number;
    chosenFloorPct: number; closedRoundTrips: number; openAtEnd: boolean;
    krakenRoundTripBps: number; otherRoundTripBps: number; tradedPerSlotPerYear: number;
    grossBps: { n: number; mean: number; median: number; p25: number; p75: number; p90: number; winRate: number; clearsOwnCost: number } | null;
  };
  const cells: Cell[] = [];
  const grossByArm: Record<string, number[]> = {};
  let oosEvaluations = 0, inSampleEvaluations = 0;

  for (const cand of candidates) {
    const t0 = Date.now();
    for (const symbol of UNIVERSE) {
      const s = kser[symbol];
      const bars = barsOf(s, cand.barHours);
      const other = otherCostsFor(symbol);
      const rtK = roundTripBps(KCOSTS, symbol), rtO = roundTripBps(other, symbol);
      for (const w of windowsFor(bars.length)) {
        const usable = usablePoints(cand.grid, w);
        if (!usable.length) continue;
        let best = usable[0], bestScore = -Infinity;
        for (const p of usable) {
          const sc = score(runPoint(symbol, cand, p, w.isFrom, w.isTo, KCOSTS, s));
          inSampleEvaluations++;
          if (sc > bestScore) { bestScore = sc; best = p; }
        }
        const gridK = usable.map((p) => runPoint(symbol, cand, p, w.oosFrom, w.oosTo, KCOSTS, s));
        const gridO = usable.map((p) => runPoint(symbol, cand, p, w.oosFrom, w.oosTo, other, s));
        oosEvaluations += gridK.length + gridO.length;
        const bi = usable.indexOf(best);
        const oosK = gridK[bi], oosO = gridO[bi];
        const oosT2 = runPoint(symbol, cand, best, w.oosFrom, w.oosTo, KT2, s);
        const plK = plateauOf(gridK.map((r) => r.ret), oosK.ret), plO = plateauOf(gridO.map((r) => r.ret), oosO.ret);
        const t = barTests(oosK.ret, oosK.maxDD, plK.positiveShare, oosO.ret);
        const tl = logFor(symbol, cand, best, w.oosFrom, w.oosTo, KCOSTS, s).tradeLog;
        const gross = tl.map((x) => x.gross * 1e4);
        const holdDays = tl.length ? median(tl.map((x) => x.holdBars)) * cand.barHours / 24 : NaN;
        const years = Math.max(1e-9, oosK.days / 365);
        const tradedPerSlot = tl.reduce((a, x) => a + 2 + x.net, 0) + (oosK.trades > tl.length * 2 ? 1 : 0);
        cells.push({
          arm: cand.id, symbol, window: w.name, barHours: cand.barHours,
          core: CORE_27.includes(symbol), krakenOnly: !((UK_BOOK_USD_PER_DAY[symbol] ?? 0) >= MIN_BOOK_USD),
          bars: bars.length, oosBars: w.oosTo - w.oosFrom, gridUsable: usable.length, chosen: best.label,
          kraken: pick(oosK), other: pick(oosO), tier2: pick(oosT2), otherIsRealRevx: other.venue === "revx",
          plateauKraken: plK.positiveShare, plateauOther: plO.positiveShare, gridMedianKraken: plK.median,
          passKraken: t.pass, failedKraken: t.failed,
          trades: oosK.trades,
          chosenFloorPct: r2(best.stops.maxLossPct * 100),
          closedRoundTrips: tl.length,
          openAtEnd: oosK.trades > tl.length * 2,      // an entry that never closed inside the window
          medianHoldDays: Number.isNaN(holdDays) ? 0 : r2(holdDays),
          meanHoldDays: tl.length ? r2(mean(tl.map((x) => x.holdBars)) * cand.barHours / 24) : 0,
          breakEvenDriftPerYear: Number.isNaN(holdDays) ? 0 : r4(breakEvenDriftPerYear(rtK, holdDays)),
          krakenRoundTripBps: r2(rtK), otherRoundTripBps: r2(rtO), tradedPerSlotPerYear: r2(tradedPerSlot / years),
          grossBps: tl.length
            ? {
              n: tl.length, mean: r2(mean(gross)), median: r2(median(gross)), p25: r2(quantile(gross, 0.25)),
              p75: r2(quantile(gross, 0.75)), p90: r2(quantile(gross, 0.90)),
              winRate: Number((gross.filter((g) => g > 0).length / gross.length).toFixed(3)),
              clearsOwnCost: Number((gross.filter((g) => g > rtK).length / gross.length).toFixed(3)),
            }
            : null,
        });
        (grossByArm[cand.id] ??= []).push(...gross);
      }
    }
    const mine = cells.filter((c) => c.arm === cand.id);
    const a = new Set(mine.filter((c) => c.window === "A" && c.passKraken).map((c) => c.symbol));
    const b = new Set(mine.filter((c) => c.window === "B" && c.passKraken).map((c) => c.symbol));
    console.log(`${cand.id.padEnd(17)} ${((Date.now() - t0) / 1000).toFixed(1)}s — median hold ${median(mine.map((c) => c.medianHoldDays).filter((x) => x > 0)).toFixed(1)} d; median trades ${median(mine.map((c) => c.trades)).toFixed(0)}; clears A ${a.size} B ${b.size} BOTH ${[...a].filter((x) => b.has(x)).length}`);
  }
  report.cells = cells;

  // ── per arm: the hold, the break-even drift, the bar, and the two controls ──
  const armRows = candidates.map((cand) => {
    const mine = cells.filter((c) => c.arm === cand.id);
    const byW = (n: "A" | "B") => mine.filter((c) => c.window === n);
    const passA = new Set(byW("A").filter((c) => c.passKraken).map((c) => c.symbol));
    const passB = new Set(byW("B").filter((c) => c.passKraken).map((c) => c.symbol));
    const both = [...passA].filter((x) => passB.has(x)).sort();
    const coins = new Set(mine.map((c) => c.symbol)).size;
    const g = grossByArm[cand.id] ?? [];
    const sd = g.length > 1 ? Math.sqrt(g.reduce((a, x) => a + (x - mean(g)) ** 2, 0) / (g.length - 1)) : NaN;
    const se = sd / Math.sqrt(Math.max(1, g.length));
    const holds = mine.map((c) => c.medianHoldDays).filter((x) => x > 0);
    const rtMedian = median(mine.map((c) => c.krakenRoundTripBps));
    return {
      id: cand.id, what: cand.what, isNull: cand.isNull, barHours: cand.barHours, gridPoints: cand.grid.length, coins,
      medianHoldDays: r2(median(holds)),
      medianBreakEvenDriftPerYear: r4(median(mine.map((c) => c.breakEvenDriftPerYear).filter((x) => x > 0))),
      medianKrakenRoundTripBps: r2(rtMedian),
      medianTradesPerWindow: r2(median(mine.map((c) => c.trades))),
      zeroTradeCells: mine.filter((c) => c.trades === 0).length,
      A: {
        medianKrakenRet: r4(median(byW("A").map((c) => c.kraken.ret))), medianOtherRet: r4(median(byW("A").map((c) => c.other.ret))),
        medianDD: r4(median(byW("A").map((c) => c.kraken.maxDD))), medianPlateau: r4(median(byW("A").map((c) => c.plateauKraken))),
        positiveOnKraken: byW("A").filter((c) => c.kraken.ret > 0).length, clears: [...passA].sort(), coins: byW("A").length,
      },
      B: {
        medianKrakenRet: r4(median(byW("B").map((c) => c.kraken.ret))), medianOtherRet: r4(median(byW("B").map((c) => c.other.ret))),
        medianDD: r4(median(byW("B").map((c) => c.kraken.maxDD))), medianPlateau: r4(median(byW("B").map((c) => c.plateauKraken))),
        positiveOnKraken: byW("B").filter((c) => c.kraken.ret > 0).length, clears: [...passB].sort(), coins: byW("B").length,
      },
      clearsBothWindows: both,
      passesRestingOnAnUnclosedEntry: mine.filter((c) => c.passKraken && (c.openAtEnd || c.closedRoundTrips <= 1)).length,
      cellsThatTraded: mine.filter((c) => c.trades > 0).length,
      expectedBothWindowsByChance: r2(coins * (passA.size / Math.max(1, byW("A").length)) * (passB.size / Math.max(1, byW("B").length))),
      expectedBothWindowsByChanceAmongTraded: r2((() => {
        const ta = byW("A").filter((c) => c.trades > 0), tb = byW("B").filter((c) => c.trades > 0);
        const n = new Set([...ta.map((c) => c.symbol)].filter((x) => tb.some((c) => c.symbol === x))).size;
        return n * (passA.size / Math.max(1, ta.length)) * (passB.size / Math.max(1, tb.length));
      })()),
      krakenBeatsCheaperFeeCells: mine.filter((c) => c.kraken.ret > c.other.ret).length,
      cells: mine.length,
      grossPooledBps: g.length
        ? {
          n: g.length, mean: r2(mean(g)), median: r2(median(g)), p75: r2(quantile(g, 0.75)), p90: r2(quantile(g, 0.90)),
          sd: r2(sd), seMean: r2(se), tVsKrakenRoundTrip: r2((mean(g) - rtMedian) / se),
          shareClearingOwnCost: Number((g.filter((x) => x > rtMedian).length / g.length).toFixed(3)),
        }
        : null,
    };
  });
  report.arms = armRows;

  // The controls, side by side: the independence product, and what the null actually produced.
  const real = armRows.filter((a) => !a.isNull);
  const nullArm = armRows.find((a) => a.isNull)!;
  const k1 = {
    rulebooksSearched: real.length,
    coins: UNIVERSE.length,
    armsLookedAt: real.length * UNIVERSE.length,
    gridPointsTotal: real.reduce((a, r) => a + r.gridPoints, 0),
    inSampleEvaluations, oosEvaluations,
    observedTwoWindowPasses: real.reduce((a, r) => a + r.clearsBothWindows.length, 0),
    expectedByIndependence: r2(real.reduce((a, r) => a + r.expectedBothWindowsByChance, 0)),
    nullTwoWindowPasses: nullArm.clearsBothWindows.length,
    nullPassRateA: r4(nullArm.A.clears.length / Math.max(1, nullArm.A.coins)),
    nullPassRateB: r4(nullArm.B.clears.length / Math.max(1, nullArm.B.coins)),
    nullExpectedAcrossSixRulebooks: r2(nullArm.clearsBothWindows.length * real.length),
    passesByArm: Object.fromEntries(real.map((r) => [r.id, r.clearsBothWindows])),
    note: "`nullExpectedAcrossSixRulebooks` is what the null rulebook's own two-window pass count implies if each real rulebook were as informative as the null — the empirical version of the independence product, and the one that carries the in-sample selection pressure.",
  };
  report.k1Control = k1;
  console.log(`K1: ${k1.observedTwoWindowPasses} two-window passes over ${k1.armsLookedAt} arms; independence product ${k1.expectedByIndependence}; the NULL rulebook alone passes ${k1.nullTwoWindowPasses} (${(k1.nullPassRateA * 100).toFixed(0)} % of coins in A, ${(k1.nullPassRateB * 100).toFixed(0)} % in B)`);

  // Every two-window pass, priced against its own cheaper-fee twin — K1's answer in one table.
  report.k1Passes = cells.filter((c) => c.passKraken).map((c) => c).filter((c) => {
    const other = cells.find((x) => x.arm === c.arm && x.symbol === c.symbol && x.window !== c.window);
    return other?.passKraken;
  }).map((c) => ({
    arm: c.arm, symbol: c.symbol, window: c.window, core: c.core, krakenOnly: c.krakenOnly, chosen: c.chosen,
    krakenRet: c.kraken.ret, krakenDD: c.kraken.maxDD, cheaperFeeRet: c.other.ret, otherIsRealRevx: c.otherIsRealRevx,
    beatenByCheaperFee: c.other.ret > c.kraken.ret, trades: c.trades, medianHoldDays: c.medianHoldDays,
    breakEvenDriftPerYear: c.breakEvenDriftPerYear, plateauKraken: c.plateauKraken,
    krakenBookUsd: book[c.symbol].quoteVolUsd, ukBookUsd: UK_BOOK_USD_PER_DAY[c.symbol] ?? null,
  }));

  // ── does Coinbase's tape stand in for Kraken's own? ───────────────────
  // §3.12 compared 720 closes. This compares the thing that matters — the
  // same rulebook's RETURN — over the same calendar span on both tapes.
  const bothTapes = COINBASE_SYMBOLS.filter((s) => UNIVERSE.includes(s)).sort();
  const spanFrom = kser[UNIVERSE[0]].c4h[0].start, spanTo = kser[UNIVERSE[0]].c4h[kser[UNIVERSE[0]].c4h.length - 1].start;
  const sourceRows: Record<string, unknown>[] = [];
  for (const symbol of bothTapes) {
    const cbH = cser[symbol].hourly!.filter((c) => c.start >= spanFrom && c.start <= spanTo);
    const cb: Series = { c4h: resample(cbH, 4), daily: resample(cbH, 24), weekly: resample(cbH, 168), hourly: cbH };
    const kr = kser[symbol];
    for (const w of windowsFor(kr.c4h.length)) {
      const wc = windowsFor(cb.c4h.length).find((x) => x.name === w.name)!;
      const st = stopsForKind("trend-4h", DEFAULT_TREND);
      const a = run("trend-4h", symbol, kr.c4h, kr.daily, w.oosFrom, w.oosTo, DEFAULT_TREND, KCOSTS, 4, st);
      const b = run("trend-4h", symbol, cb.c4h, cb.daily, wc.oosFrom, wc.oosTo, DEFAULT_TREND, KCOSTS, 4, st);
      const maPt = armById["ma-regime-1d"].grid.find((p) => p.label.startsWith("ma 200d/buffer 0%/floor 8"))!;
      const wd = windowsFor(kr.daily.length).find((x) => x.name === w.name)!, wcd = windowsFor(cb.daily.length).find((x) => x.name === w.name)!;
      const c = runLogged(symbol, kr.daily, wd.oosFrom, wd.oosTo, maPt.lookback, maPt.decider!(symbol, kr.daily, kr.daily), KCOSTS, maPt.stops);
      const d = runLogged(symbol, cb.daily, wcd.oosFrom, wcd.oosTo, maPt.lookback, maPt.decider!(symbol, cb.daily, cb.daily), KCOSTS, maPt.stops);
      sourceRows.push({
        symbol, window: w.name, krakenBars: kr.c4h.length, coinbaseBars: cb.c4h.length,
        "trend-4h": { kraken: pick(a), coinbase: pick(b), dRet: r4(a.ret - b.ret), dDD: r4(a.maxDD - b.maxDD), dTrades: a.trades - b.trades },
        "ma-regime-1d": { kraken: pick(c), coinbase: pick(d), dRet: r4(c.ret - d.ret), dDD: r4(c.maxDD - d.maxDD), dTrades: c.trades - d.trades },
      });
    }
  }
  const dRets = sourceRows.flatMap((r) => [(r["trend-4h"] as { dRet: number }).dRet, (r["ma-regime-1d"] as { dRet: number }).dRet]);
  report.sourceCheck = {
    note: "The SEEDED trend-4h rule and the ma-200 regime hold, Kraken costs, run over the same calendar span on Kraken's own 4-hour tape and on the Coinbase series every earlier study used. A difference here is what the tape is worth, not what the rule is worth.",
    coins: bothTapes.length, comparisons: dRets.length,
    medianAbsDReturn: r4(median(dRets.map(Math.abs))), maxAbsDReturn: r4(Math.max(...dRets.map(Math.abs))),
    signFlips: sourceRows.filter((r) => {
      const t = r["trend-4h"] as { kraken: { ret: number }; coinbase: { ret: number } };
      return (t.kraken.ret > 0) !== (t.coinbase.ret > 0);
    }).length,
    rows: sourceRows,
  };
  console.log(`source check: ${dRets.length} comparisons, median |Δreturn| ${(median(dRets.map(Math.abs)) * 100).toFixed(2)} pts, max ${(Math.max(...dRets.map(Math.abs)) * 100).toFixed(1)} pts`);

  // ── K2: the TESTING rows — keep, optimise or delete ───────────────────
  type Variant = { label: string; trend: TrendParams; floor: number; lookbackDays: number; symbols: string[]; rotation: RotationParams | null };
  type RowSpec = {
    id: string; label: string; kind: StrategyKind; venue: "revx" | "kraken"; costs: Costs; barHours: number;
    symbols: string[]; capitalUsd: number; slotUsd: number; seeded: Variant; variants: Variant[]; twin: string | null;
    status: "LIVE" | "TESTING"; job: string;
  };
  const subsetsOf = (xs: string[]): string[][] => [xs, ...xs.map((drop) => xs.filter((x) => x !== drop))];
  function trendVariants(symbols: string[]): Variant[] {
    const out: Variant[] = [];
    for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) {
      for (const syms of subsetsOf(symbols)) {
        out.push({ label: `fast ${fast}/slow ${slow}/atr ${atrStop} on ${syms.length === symbols.length ? "all" : `all but ${symbols.filter((s) => !syms.includes(s))[0]}`}`, trend: { ...DEFAULT_TREND, fast, slow, atrStop }, floor: SHIPPED_STOPS.maxLossPct, lookbackDays: 30, symbols: syms, rotation: null });
      }
    }
    return out;
  }
  function momentumVariants(symbols: string[]): Variant[] {
    const out: Variant[] = [];
    for (const lookbackDays of [20, 30, 60, 90]) for (const floor of [0.08, 0.20]) {
      for (const syms of subsetsOf(symbols)) {
        out.push({ label: `lookback ${lookbackDays}d/floor ${(floor * 100).toFixed(0)}% on ${syms.length === symbols.length ? "all" : `all but ${symbols.filter((s) => !syms.includes(s))[0]}`}`, trend: DEFAULT_TREND, floor, lookbackDays, symbols: syms, rotation: null });
      }
    }
    return out;
  }
  function rotationVariants(): Variant[] {
    const out: Variant[] = [];
    for (const lookbackDays of [30, 60, 90]) for (const topN of [1, 2, 3]) for (const minHoldDays of [0, 7, 30]) for (const bearFilter of [true, false]) {
      out.push({ label: `lookback ${lookbackDays}/top ${topN}/minHold ${minHoldDays}/bear ${bearFilter}`, trend: DEFAULT_TREND, floor: SHIPPED_STOPS.maxLossPct, lookbackDays, symbols: BASKET, rotation: { ...DEFAULT_ROTATION, lookbackDays, topN, minHoldDays, bearFilter } });
    }
    return out;
  }
  const seededTrend = (symbols: string[]): Variant => ({ label: "seeded", trend: DEFAULT_TREND, floor: SHIPPED_STOPS.maxLossPct, lookbackDays: 30, symbols, rotation: null });
  const seededRotation = (minHoldDays: number): Variant => ({ label: `seeded (minHold ${minHoldDays})`, trend: DEFAULT_TREND, floor: SHIPPED_STOPS.maxLossPct, lookbackDays: 30, symbols: BASKET, rotation: { ...DEFAULT_ROTATION, minHoldDays } });

  // `barHours` is the bar the row TRADES on, not the bar it decides from:
  // `backtest.ts` runs `momentum-1d` on 4-hour bars with the daily closes
  // passed in for the 30-day momentum state, so its stops are read against
  // 4-hour lows and its windows are thirds of the 4-hour series. Running it
  // on daily bars instead moves every number (momentum-1d·revx window B
  // reads +67.7 % rather than §3.11's +62.4 %), which is why this is
  // matched rather than re-decided.
  const ROWS: RowSpec[] = [
    { id: "trend-4h·revx", label: "Trend 4h · Revolut X (the LIVE row, for scale)", kind: "trend-4h", venue: "revx", costs: COSTS.revx, barHours: 4, symbols: RECOMMENDED_SYMBOLS, capitalUsd: 100, slotUsd: 20, seeded: seededTrend(RECOMMENDED_SYMBOLS), variants: trendVariants(RECOMMENDED_SYMBOLS), twin: "trend-4h·kraken", status: "LIVE", job: "the recommended live row" },
    { id: "trend-1h·revx", label: "Trend 1h · Revolut X", kind: "trend-1h", venue: "revx", costs: COSTS.revx, barHours: 1, symbols: TREND_1H_SYMBOLS, capitalUsd: 40, slotUsd: 40 / 3, seeded: seededTrend(TREND_1H_SYMBOLS), variants: trendVariants(TREND_1H_SYMBOLS), twin: null, status: "TESTING", job: "feedback speed: fills fast enough to judge the loop in days rather than weeks" },
    { id: "momentum-1d·revx", label: "Momentum 30d · Revolut X", kind: "momentum-1d", venue: "revx", costs: COSTS.revx, barHours: 4, symbols: MOMENTUM_SYMBOLS, capitalUsd: 40, slotUsd: 40 / 3, seeded: { ...seededTrend(MOMENTUM_SYMBOLS), label: "seeded" }, variants: momentumVariants(MOMENTUM_SYMBOLS), twin: "momentum-1d·kraken", status: "TESTING", job: "a second, slower rulebook on the same coins — the set's biggest bull-year contributor" },
    { id: "momentum-1d·kraken", label: "Momentum 30d · Kraken", kind: "momentum-1d", venue: "kraken", costs: KCOSTS, barHours: 4, symbols: MOMENTUM_SYMBOLS, capitalUsd: 40, slotUsd: 40 / 3, seeded: { ...seededTrend(MOMENTUM_SYMBOLS), label: "seeded" }, variants: momentumVariants(MOMENTUM_SYMBOLS), twin: "momentum-1d·revx", status: "TESTING", job: "measuring Kraken's post-only FILL behaviour on a slow rule, not its return" },
    { id: "trend-4h·kraken", label: "Trend 4h · Kraken", kind: "trend-4h", venue: "kraken", costs: KCOSTS, barHours: 4, symbols: RECOMMENDED_SYMBOLS, capitalUsd: 100, slotUsd: 20, seeded: seededTrend(RECOMMENDED_SYMBOLS), variants: trendVariants(RECOMMENDED_SYMBOLS), twin: "trend-4h·revx", status: "TESTING", job: "measuring Kraken's post-only FILL behaviour on the live rulebook, not its return" },
    { id: "rotation-1d·revx", label: "Rotation · Revolut X", kind: "rotation-1d", venue: "revx", costs: COSTS.revx, barHours: 24, symbols: BASKET, capitalUsd: 60, slotUsd: 40, seeded: seededRotation(0), variants: rotationVariants(), twin: "rotation-1w·kraken", status: "TESTING", job: "the only cross-sectional rule in the set" },
    { id: "rotation-1w·kraken", label: "Rotation · Kraken (7-day minimum hold)", kind: "rotation-1d", venue: "kraken", costs: KCOSTS, barHours: 24, symbols: BASKET, capitalUsd: 60, slotUsd: 40, seeded: seededRotation(7), variants: rotationVariants(), twin: "rotation-1d·revx", status: "TESTING", job: "the damped rotation twin on the expensive venue" },
  ];

  /**
   * One row priced over one segment of one window: the sleeves at their slot
   * size, combined the way a live row earns (a fixed slot re-sized at every
   * entry, not a compounding curve). Each sleeve splits on ITS OWN bar
   * count and the basket on its own aligned days — §3.10's, §3.11's and
   * §3.12's convention, so these numbers are comparable with theirs rather
   * than nearly comparable.
   */
  type Seg = "is" | "oos";
  function priceRow(row: RowSpec, v: Variant, windowName: "A" | "B", seg: Seg, costs: Costs): SetStats {
    if (v.rotation) {
      const daily: Record<string, Candle[]> = {};
      const common = BASKET.map((s) => new Set(cser[s].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
      for (const s of BASKET) daily[s] = cser[s].daily.filter((c) => common.has(c.start));
      const w = windowsFor(daily[BASKET[0]].length).find((x) => x.name === windowName)!;
      const f = seg === "is" ? w.isFrom : w.oosFrom, t = seg === "is" ? w.isTo : w.oosTo;
      const r = runRotation(daily, f, t, v.rotation, costs, stopsForKind("rotation-1d", DEFAULT_TREND));
      const rets = dailyReturns(r.equity);
      const marks = dailyMarks(r.equity);
      const open = new Map<number, number>();
      for (let i = 1; i < marks.length; i++) open.set(marks[i].day, marks[i].eq !== marks[i - 1].eq ? 1 : 0);   // proxy, as §3.11's
      return combine([{ id: row.id, slotUsd: row.slotUsd, exposure: r.exposure, rets, open, tradedPerSlot: r.turnover * Math.max(1e-9, r.days / 365), fills: r.trades }]);
    }
    const sleeves: Sleeve[] = v.symbols.map((symbol) => {
      const s = cser[symbol];
      const bars = barsOf(s, row.barHours);
      const w = windowsFor(bars.length).find((x) => x.name === windowName)!;
      const f = seg === "is" ? w.isFrom : w.oosFrom, t = seg === "is" ? w.isTo : w.oosTo;
      const stops = { ...stopsForKind(row.kind, v.trend), maxLossPct: v.floor };
      const r = runLogged(symbol, bars, f, t, v.trend.slow + 1, shippedDecider(row.kind, symbol, bars, s.daily, v.trend, row.barHours, v.lookbackDays), costs, stops);
      return {
        id: `${row.id}·${symbol}`, slotUsd: row.capitalUsd / v.symbols.length > MAX_ORDER_USD ? MAX_ORDER_USD : row.capitalUsd / v.symbols.length,
        exposure: r.exposure, rets: dailyReturns(r.equityEveryBar), open: dailyOpen(r.openFlags),
        tradedPerSlot: r.tradeLog.reduce((a, x) => a + 2 + x.net, 0) + (r.trades > r.tradeLog.length * 2 ? 1 : 0), fills: r.trades,
      };
    });
    return combine(sleeves);
  }

  /** The row's daily dollar P&L, for the twin correlations §3.11 measured. */
  function rowDailyPnl(row: RowSpec, v: Variant, windowName: "A" | "B", costs: Costs): Map<number, number> {
    const out = new Map<number, number>();
    if (v.rotation) {
      const daily: Record<string, Candle[]> = {};
      const common = BASKET.map((x) => new Set(cser[x].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
      for (const x of BASKET) daily[x] = cser[x].daily.filter((c) => common.has(c.start));
      const w = windowsFor(daily[BASKET[0]].length).find((x) => x.name === windowName)!;
      const r = runRotation(daily, w.oosFrom, w.oosTo, v.rotation, costs, stopsForKind("rotation-1d", DEFAULT_TREND));
      for (const [d, x] of dailyReturns(r.equity)) out.set(d, (out.get(d) ?? 0) + row.slotUsd * x);
      return out;
    }
    for (const symbol of v.symbols) {
      const st = cser[symbol];
      const bars = barsOf(st, row.barHours);
      const w = windowsFor(bars.length).find((x) => x.name === windowName)!;
      const stops = { ...stopsForKind(row.kind, v.trend), maxLossPct: v.floor };
      const r = runLogged(symbol, bars, w.oosFrom, w.oosTo, v.trend.slow + 1, shippedDecider(row.kind, symbol, bars, st.daily, v.trend, row.barHours, v.lookbackDays), costs, stops);
      const slot = Math.min(row.capitalUsd / v.symbols.length, MAX_ORDER_USD);
      for (const [d, x] of dailyReturns(r.equityEveryBar)) out.set(d, (out.get(d) ?? 0) + slot * x);
    }
    return out;
  }
  function corrOf(a: Map<number, number>, b: Map<number, number>): number {
    const days = [...a.keys()].filter((d) => b.has(d));
    if (days.length < 3) return NaN;
    const xs = days.map((d) => a.get(d)!), ys = days.map((d) => b.get(d)!);
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  const rowRows = ROWS.map((row) => {
    const seededBy: Record<string, SetStats> = { A: priceRow(row, row.seeded, "A", "oos", row.costs), B: priceRow(row, row.seeded, "B", "oos", row.costs) };
    // The clean walk-forward: choose on the FIRST third, score on the MIDDLE third, then score the SAME
    // variant on the LAST third — a window it has never seen and that played no part in choosing it.
    let bestB: Variant = row.seeded, bestScoreB = -Infinity;
    for (const v of row.variants) {
      const sc = priceRow(row, v, "B", "is", row.costs).retOverDD;
      if (sc > bestScoreB) { bestScoreB = sc; bestB = v; }
    }
    const chosenOnFirstThird = {
      variant: bestB.label,
      middleThird: priceRow(row, bestB, "B", "oos", row.costs),
      lastThird: priceRow(row, bestB, "A", "oos", row.costs),
    };
    // The contaminated direction, reported because leaving it out would flatter the clean one: window A's
    // in-sample is the first TWO thirds, which contains window B's out-of-sample third.
    let bestA: Variant = row.seeded, bestScoreA = -Infinity;
    for (const v of row.variants) {
      const sc = priceRow(row, v, "A", "is", row.costs).retOverDD;
      if (sc > bestScoreA) { bestScoreA = sc; bestA = v; }
    }
    const chosenOnFirstTwoThirds = {
      variant: bestA.label,
      lastThird: priceRow(row, bestA, "A", "oos", row.costs),
      middleThirdContaminated: priceRow(row, bestA, "B", "oos", row.costs),
    };
    return {
      id: row.id, label: row.label, status: row.status, venue: row.venue, kind: row.kind, symbols: row.symbols,
      capitalUsd: row.capitalUsd, statedJob: row.job, twin: row.twin, variantsSearched: row.variants.length,
      seeded: { A: seededBy.A, B: seededBy.B, worseRetOverDD: r2(Math.min(seededBy.A.retOverDD, seededBy.B.retOverDD)) },
      optimisation: { chosenOnFirstThird, chosenOnFirstTwoThirds },
    };
  });
  report.k2Rows = rowRows;
  for (const r of rowRows) {
    console.log(`${r.id.padEnd(20)} A ${(r.seeded.A.ret * 100).toFixed(1)}% (DD ${(r.seeded.A.maxDD * 100).toFixed(1)}%, ${r.seeded.A.fills} fills) | B ${(r.seeded.B.ret * 100).toFixed(1)}% (DD ${(r.seeded.B.maxDD * 100).toFixed(1)}%) | best-on-first-third "${r.optimisation.chosenOnFirstThird.variant}" middle ${(r.optimisation.chosenOnFirstThird.middleThird.ret * 100).toFixed(1)}% last ${(r.optimisation.chosenOnFirstThird.lastThird.ret * 100).toFixed(1)}%`);
  }

  // The twins, measured again: correlation of daily dollar P&L, and what the Kraken side gives up.
  report.k2Twins = ROWS.filter((r) => r.twin).map((row) => {
    const other = ROWS.find((x) => x.id === row.twin)!;
    const per: Record<string, unknown> = { id: row.id, twin: row.twin };
    for (const w of ["A", "B"] as const) {
      const a = rowDailyPnl(row, row.seeded, w, row.costs), b = rowDailyPnl(other, other.seeded, w, other.costs);
      const mine = rowRows.find((x) => x.id === row.id)!.seeded[w], theirs = rowRows.find((x) => x.id === row.twin)!.seeded[w];
      per[w] = { correlation: r4(corrOf(a, b)), ret: mine.ret, twinRet: theirs.ret, costDragPoints: r2((theirs.ret - mine.ret) * 100), pnlUsd: mine.pnlUsd, twinPnlUsd: theirs.pnlUsd };
    }
    return per;
  });

  // Every pair of rows, both windows: a row whose P&L is another row's P&L
  // is not a second measurement of anything. §3.10 measured this for the
  // Revolut X rows; K2 needs it for the Kraken ones.
  report.k2Correlations = ["A", "B"].map((w) => ({
    window: w,
    pairs: ROWS.flatMap((x, i) => ROWS.slice(i + 1).map((y) => ({
      a: x.id, b: y.id,
      correlation: r4(corrOf(rowDailyPnl(x, x.seeded, w as "A" | "B", x.costs), rowDailyPnl(y, y.seeded, w as "A" | "B", y.costs))),
    }))).sort((m, n) => (n.correlation || 0) - (m.correlation || 0)),
  }));

  /**
   * §3.11's published per-row numbers, as its report prints them. The
   * harness has to reproduce them before its own verdicts mean anything:
   * [A return, A drawdown, B return, B drawdown].
   */
  const PUBLISHED_3_11: Record<string, [number, number, number, number]> = {
    "trend-4h·revx": [-0.003, 0.118, 0.126, 0.102],
    "trend-1h·revx": [0.005, 0.204, 0.040, 0.173],
    "momentum-1d·revx": [-0.081, 0.410, 0.624, 0.171],
    "momentum-1d·kraken": [-0.201, 0.513, 0.536, 0.194],
    "trend-4h·kraken": [-0.004, 0.143, 0.048, 0.117],
    "rotation-1d·revx": [-0.133, 0.370, 1.285, 0.225],
    "rotation-1w·kraken": [-0.098, 0.415, 0.770, 0.268],
  };
  report.k2Reproduction = {
    note: "§3.11's own table against this harness's, same rows, same slots, same windows. A study that cannot reproduce the numbers it is arguing with has not earned its own.",
    rows: rowRows.map((r) => {
      const pub = PUBLISHED_3_11[r.id];
      return pub
        ? {
          id: r.id, publishedA: pub[0], computedA: r.seeded.A.ret, dA: r4(r.seeded.A.ret - pub[0]),
          publishedDDA: pub[1], computedDDA: r.seeded.A.maxDD, publishedB: pub[2], computedB: r.seeded.B.ret,
          dB: r4(r.seeded.B.ret - pub[2]), publishedDDB: pub[3], computedDDB: r.seeded.B.maxDD,
        }
        : { id: r.id, publishedA: null };
    }),
  };

  // The twins' actual job: how many FILLS a quarter, and how much of it duplicates the Revolut X row's.
  const fillJob = ROWS.map((row) => {
    const A = rowRows.find((r) => r.id === row.id)!.seeded.A, B = rowRows.find((r) => r.id === row.id)!.seeded.B;
    return {
      id: row.id, venue: row.venue, twin: row.twin,
      fillsPer90DaysA: A.fillsPer90Days, fillsPer90DaysB: B.fillsPer90Days,
      daysToTenFillsA: r2(A.fillsPer90Days > 0 ? 900 / A.fillsPer90Days : Infinity),
      daysToTenFillsB: r2(B.fillsPer90Days > 0 ? 900 / B.fillsPer90Days : Infinity),
      turnoverA: A.turnoverPerYear, turnoverB: B.turnoverPerYear,
    };
  });
  report.k2FillJob = {
    note: "A Kraken paper twin's stated job is measuring whether a post-only order at the touch FILLS — which the backtest assumes and cannot see. The only currency of that job is fills per unit of time, so it is counted here. A twin that duplicates its Revolut X row's signal produces no extra RETURN information (the correlations are 0.96–1.00, §3.11) but it does produce its own fills.",
    rows: fillJob,
  };

  // ── K3: what is worth ADDING to TESTING ───────────────────────────────
  // Each candidate is priced on the venue it is proposed for (Revolut X —
  // K1 answers whether anything belongs on Kraken), over both windows, with
  // its own plateau and the same bar. The coins are the five the live row
  // runs plus the four §3.10 point 6 named for the regime filter.
  const K3_COINS = [...new Set([...RECOMMENDED_SYMBOLS, "LINK/USD", "NEAR/USD", "ALGO/USD"])].sort();
  type K3Cell = {
    candidate: string; symbol: string; window: "A" | "B"; chosen: string;
    revx: ReturnType<typeof pick>; kraken: ReturnType<typeof pick>; plateauRevx: number;
    pass: boolean; failed: string[]; trades: number; medianHoldDays: number; baselineRevxRet: number;
  };
  const k3Cells: K3Cell[] = [];
  const REGIME_GRID: { n: number; p: TrendParams }[] = [];
  for (const n of [100, 150, 200]) for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) REGIME_GRID.push({ n, p: { ...DEFAULT_TREND, fast, slow } });
  const BASE_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) BASE_GRID.push({ ...DEFAULT_TREND, fast, slow });

  type K3Def = { id: string; what: string; barHours: number; points: { label: string; lookback: number; stops: StopParams; make: (symbol: string, bars: Candle[], daily: Candle[]) => Decide }[] };
  const K3: K3Def[] = [
    {
      id: "regime-trend-4h", what: "the shipped trend rule with every ENTRY gated by BTC's daily close being above its 100/150/200-day average (§3.9 idea 1, §3.10 point 6)", barHours: 4,
      points: REGIME_GRID.map(({ n, p }) => ({
        label: `btc ${n}d/fast ${p.fast}/slow ${p.slow}`, lookback: p.slow + 1, stops: stopsForKind("trend-4h", p),
        make: (symbol, bars, daily) => regimeFiltered(shippedDecider("trend-4h", symbol, bars, daily, p, 4), bars, BTC_REGIME, n, 4, true),
      })),
    },
    {
      id: "trend-4h-wide", what: "the shipped rule with slow 200/300, breakout 100/200 and a 4/6×ATR trail — §3.12's one exception, on Revolut X where its 20 bps round trip is affordable", barHours: 4,
      points: armById["trend-4h-wide"].grid.map((p) => ({
        label: p.label, lookback: p.lookback, stops: p.stops,
        make: (symbol: string, bars: Candle[], daily: Candle[]) => shippedDecider("trend-4h", symbol, bars, daily, p.trend, 4),
      })),
    },
    {
      id: "ma-regime-1d", what: "in while the daily close is above its 100/150/200-day average, out below — K1a's slowest rulebook, on the cheap venue", barHours: 24,
      points: armById["ma-regime-1d"].grid.map((p) => ({
        label: p.label, lookback: p.lookback, stops: p.stops,
        make: (symbol: string, bars: Candle[], daily: Candle[]) => p.decider!(symbol, bars, daily),
      })),
    },
  ];
  let k3Evaluations = 0;
  for (const def of K3) {
    for (const symbol of K3_COINS) {
      const s = cser[symbol];
      const bars = barsOf(s, def.barHours);
      for (const w of windowsFor(bars.length)) {
        const usable = def.points.filter((p) => w.oosFrom >= p.lookback && w.isTo >= p.lookback + 20);
        if (!usable.length) continue;
        let best = usable[0], bestScore = -Infinity;
        for (const p of usable) {
          const r = runLogged(symbol, bars, w.isFrom, w.isTo, p.lookback, p.make(symbol, bars, s.daily), COSTS.revx, p.stops);
          if (score(r) > bestScore) { bestScore = score(r); best = p; }
        }
        const gridR = usable.map((p) => runLogged(symbol, bars, w.oosFrom, w.oosTo, p.lookback, p.make(symbol, bars, s.daily), COSTS.revx, p.stops));
        k3Evaluations += gridR.length + usable.length;
        const bi = usable.indexOf(best);
        const oosR = gridR[bi];
        const oosK = runLogged(symbol, bars, w.oosFrom, w.oosTo, best.lookback, best.make(symbol, bars, s.daily), KCOSTS, best.stops);
        const pl = plateauOf(gridR.map((r) => r.ret), oosR.ret);
        const t = barTests(oosR.ret, oosR.maxDD, pl.positiveShare, oosK.ret);
        const baseline = run("trend-4h", symbol, s.c4h, s.daily, windowsFor(s.c4h.length).find((x) => x.name === w.name)!.oosFrom, windowsFor(s.c4h.length).find((x) => x.name === w.name)!.oosTo, DEFAULT_TREND, COSTS.revx, 4, stopsForKind("trend-4h", DEFAULT_TREND));
        k3Cells.push({
          candidate: def.id, symbol, window: w.name, chosen: best.label, revx: pick(oosR), kraken: pick(oosK),
          plateauRevx: pl.positiveShare, pass: t.pass, failed: t.failed, trades: oosR.trades,
          medianHoldDays: oosR.tradeLog.length ? r2(median(oosR.tradeLog.map((x) => x.holdBars)) * def.barHours / 24) : 0,
          baselineRevxRet: r4(baseline.ret),
        });
      }
    }
  }
  report.k3Cells = k3Cells;
  report.k3 = K3.map((def) => {
    const mine = k3Cells.filter((c) => c.candidate === def.id);
    const a = new Set(mine.filter((c) => c.window === "A" && c.pass).map((c) => c.symbol));
    const b = new Set(mine.filter((c) => c.window === "B" && c.pass).map((c) => c.symbol));
    const coins = new Set(mine.map((c) => c.symbol)).size;
    return {
      id: def.id, what: def.what, gridPoints: def.points.length, coins,
      clearsA: [...a].sort(), clearsB: [...b].sort(), clearsBoth: [...a].filter((x) => b.has(x)).sort(),
      expectedBothByChance: r2(coins * (a.size / Math.max(1, coins)) * (b.size / Math.max(1, coins))),
      medianRetA: r4(median(mine.filter((c) => c.window === "A").map((c) => c.revx.ret))),
      medianRetB: r4(median(mine.filter((c) => c.window === "B").map((c) => c.revx.ret))),
      medianPlateau: r4(median(mine.map((c) => c.plateauRevx))),
      medianHoldDays: r2(median(mine.map((c) => c.medianHoldDays).filter((x) => x > 0))),
      medianTrades: r2(median(mine.map((c) => c.trades))),
      beatsBaselineCells: mine.filter((c) => c.revx.ret > c.baselineRevxRet).length,
      cells: mine.length,
    };
  });
  for (const r of report.k3 as { id: string; clearsBoth: string[]; expectedBothByChance: number; medianRetA: number; medianRetB: number }[]) {
    console.log(`K3 ${r.id.padEnd(18)} median A ${(r.medianRetA * 100).toFixed(1)}% B ${(r.medianRetB * 100).toFixed(1)}% — clears both: ${r.clearsBoth.join(", ") || "nothing"} (chance ${r.expectedBothByChance})`);
  }

  report.feeTier = {
    tier1: { makerBps: KCOSTS.makerBps, takerBps: KCOSTS.takerBps },
    tier2: { makerBps: KT2.makerBps, takerBps: KT2.takerBps, needs30dVolumeUsd: KRAKEN_TIER2_VOLUME_USD },
    note: "Traded notional at five $20 slots, from each arm's own measured turnover: an entry trades one slot and its exit trades that slot grown by the trade's own net return. §3.12 asked this of the shipped rules; a rulebook built to trade LESS can only be further from the tier, and the table says how much further.",
    rows: candidates.map((cand) => {
      const mine = cells.filter((c) => c.arm === cand.id && c.trades > 0);
      const perSlotPerYear = median(mine.map((c) => c.tradedPerSlotPerYear));
      const vol30d = perSlotPerYear * MAX_ORDER_USD * 5 / 365 * 30;
      return {
        id: cand.id, tradedPerSlotPerYear: r2(perSlotPerYear), volume30dAtFiveTwentyDollarSlots: r2(vol30d),
        reachesTier2: vol30d >= KRAKEN_TIER2_VOLUME_USD, turnoverMultipleNeeded: r2(KRAKEN_TIER2_VOLUME_USD / Math.max(1e-9, vol30d)),
        capitalNeededForTier2Usd: Math.round(KRAKEN_TIER2_VOLUME_USD / Math.max(1e-9, vol30d) * 100),
        feePaidPerYearAtTier1PerDollarOfSlot: r4(perSlotPerYear * KCOSTS.makerBps / 1e4),
      };
    }),
  };

  report.searchAccounting = {
    note: "Every look this study took, so a reader can price the passes. An 'arm' is one rulebook on one coin; an evaluation is one parameter point run over one segment on one fee schedule.",
    k1: { rulebooks: k1.rulebooksSearched, coins: k1.coins, arms: k1.armsLookedAt, windows: 2, inSampleEvaluations, oosEvaluations },
    k2: { rows: ROWS.length, variantsPerRow: Object.fromEntries(ROWS.map((r) => [r.id, r.variants.length])), selections: ROWS.reduce((a, r) => a + r.variants.length, 0) * 2 },
    k3: { candidates: K3.length, coins: K3_COINS.length, evaluations: k3Evaluations },
    nullControlPassRate: { A: k1.nullPassRateA, B: k1.nullPassRateB, bothWindows: k1.nullTwoWindowPasses, ofCoins: UNIVERSE.length },
  };

  report.runtimeSeconds = Number(((Date.now() - t00) / 1000).toFixed(1));
  await Deno.writeTextFile(`${outDir}/kraken2.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/kraken2.json in ${report.runtimeSeconds}s`);
}
