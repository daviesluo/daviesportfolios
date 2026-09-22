// The LAST KRAKEN AVENUE: the 84 coins §4.22's cost-and-book screen passed
// and could not test for lack of history. A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_kraken3.ts \
//     --csv  <dir of {ALT}_240.csv members, byte for byte from the bundle, + _members.json> \
//     --live <dir of {ALT}.json, the keyless OHLC endpoint's last 720 four-hour candles> \
//     --k422 <dir of §4.22's own tapes, {BASE}-USD_4h.json>   (optional: bar-for-bar tape check) \
//     --out  docs/agents/backtests
//
// Writes `<out>/kraken3.json` and NOTHING else.
//
// ── the question ──────────────────────────────────────────────────────
//
// §4.22 (reference, 2026-09-22) screened every Kraken USD pair for the two
// cases where Kraken could be the right venue — a coin where Kraken's round
// trip (80 bps of maker fee plus its spread) is CHEAPER than Revolut X's UK
// book (18 bps of taker fee plus its spread), and a coin Revolut X's UK book
// does not list at all — each with a Kraken book of at least $100k a day. It
// tested the 18 that had three years of Kraken's tape on disk and found, on
// SEEDED parameters, 2 two-window passes against 3.33 by chance. 84 more
// passed the same screens and were not tested: 17 Kraken-cheaper and 67
// Kraken-only. This asks the one question left: does any of THOSE clear
// §4.15's bar on Kraken's costs and Kraken's book?
//
// ── the data ──────────────────────────────────────────────────────────
//
// Kraken's free quarterly OHLCVT bundle, `Kraken_OHLCVT_Full_2026Q2.zip`
// (parts 00–04 concatenated, 8,972,380,104 bytes, 12,037 members: every pair
// from its first trade to 2026-06-30), the file `backtest_windows.ts` built
// window C from. Only the 240-minute members this study reads are extracted,
// byte for byte (CRC-32 checked on read; SHA-256 and size recorded in
// `_members.json` and carried into the output). Each is spliced with the last
// 720 four-hour candles of the keyless public OHLC endpoint the way §3.14's
// data step did it: the bundle's bars strictly BEFORE the endpoint's first
// bar, the endpoint's from there on, the endpoint's still-forming last row
// dropped. The overlap is compared bar for bar first, against the thresholds
// `backtest_windows.ts` wrote down before its own comparison (median ≤ 25 bps,
// p95 ≤ 100 bps on closes); a coin outside them would be dropped, not
// explained. A 4-hour bar the CSV omits because nothing traded is
// forward-filled flat at the previous close with zero volume.
//
// Reproducing the two input directories takes no key and a few lines:
//   --csv   `zipfile.ZipFile(<parts 00–04 concatenated>).read("<ALT>_240.csv")`
//           for each pair, written as-is, plus `_members.json` =
//           { "<SYM>/USD": { altname, member, bytes, crc32, sha256 } }
//           (`altname` from `GET /0/public/AssetPairs`; XBT is bitcoin);
//   --live  `GET https://api.kraken.com/0/public/OHLC?pair=<ALT>&interval=240`
//           per pair, saved as { symbol, altname, pairKey, last, fetchedAt,
//           rows } with `rows` exactly as returned.
// The grid ends at 2026-09-21 16:00 UTC whatever day the endpoint is read, so
// any fetch that still reaches back past the bundle's 2026-06-30 end (before
// ~2026-10-28) reproduces the same bars. A later fetch leaves a gap between the
// sources, and a coin with a gap is refused rather than forward-filled across it.
//
// ── declared BEFORE any return was computed ───────────────────────────
//
// * THE WINDOWS ARE §4.22's OWN CUT, ON THE CALENDAR. §4.22's tapes are the
//   three years every §3.14 pair shares — 6,571 bars, 2023-09-22 16:00 →
//   2026-09-21 16:00 UTC — cut in thirds: A scores the last third (the bear
//   year), B the middle third (the bull year). C is the first third and D the
//   year before the grid, as `backtest_windows.ts` extended them. A coin that
//   listed later is scored on a window only when its tape holds the WHOLE
//   window plus the rulebook's warm-up before it; a window is never shortened
//   to fit a coin, because a shorter window is a different draw and the null
//   below assumes every cell is the same draw.
// * WARM-UP: the largest slow average in the rulebook's grid plus 21 bars
//   (§4.22's own `usable` rule, so every grid point is usable in every scored
//   window) and never less than 32 days, so the 30-day momentum word is known
//   on the first scored bar: 192 bars for `trend-4h`, 321 for `trend-4h-wide`.
// * CONTINUITY: §3.14's "no more than 2 % of the 4-hour grid without a
//   trade", applied to each scored segment (warm-up included). A bar without a
//   trade is one the CSV omits OR one the endpoint returns with zero volume —
//   the endpoint fills empty intervals itself, so counting only omitted bars,
//   as §3.14 could on a tape that was almost all CSV, would wave through a
//   coin whose recent months are a fifth empty.
// * NOT ASSETS A TREND RULE IS ABOUT: §3.14's stablecoin / fiat and wrapped
//   sets, verbatim, plus Ethena's USDe, a dollar stablecoin §3.14's list
//   predates. They are listed, never scored.
// * SEEDED parameters are the headline — `DEFAULT_TREND` for `trend-4h` and
//   §3.12's slow-200 / breakout-100 / ATR-4 point for `trend-4h-wide`, the two
//   rulebooks §4.22 ran, with the shipped stops (8 % floor, no intra-bar
//   trail, two-bar cooldown). The grids exist for the plateau test. A
//   parameter SEARCH is reported beside it and counts for nothing (in-sample
//   choice measured worse than the seeded point in all four conditions here).
// * THE BAR: §4.15's four tests from Kraken's side, as §4.16 and §4.22 apply
//   them to a coin that would run on Kraken — out-of-sample return > 0 on
//   Kraken's costs, drawdown < 35 %, at least half the grid positive out of
//   sample on Kraken's costs, and positive on the other fee schedule (the REAL
//   Revolut X UK cost for a Kraken-cheaper coin; Revolut X's fees at Kraken's
//   spread for a Kraken-only one) — on BOTH windows A and B, and a Kraken book
//   of at least $100k a day. §4.22's own seeded count dropped the plateau
//   test; that three-test count is reported beside the four-test one.
// * THE NULL, stated before the count: for each rulebook, N coins scored on
//   both windows, pA and pB the observed per-window pass rates, N·pA·pB
//   expected two-window passes if a coin's two windows were independent draws
//   (§4.22's 3.33 is this, summed over the two rulebooks), N·p² with p pooled
//   over both windows beside it, and P(at least the observed count) under
//   Binomial(N, pA·pB).
// * FOLDS: §4.22's six consecutive six-month folds of the same grid, seeded,
//   nothing chosen, scored under the same history and continuity rules.
//   §4.22's written falsification needs positive in at least 4 of 6.
// * SENSITIVITY (counts for nothing): §3.8's split — each coin's OWN tape in
//   thirds when it holds at least 540 days, so each third is at least the
//   180-day floor — for the coins the calendar cut cannot reach.
//
// ── what is imported, and what is copied ──────────────────────────────
//
// `run`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf` and `resample` are
// IMPORTED from `backtest.ts`, `DEFAULT_TREND` from `_shared/agents_strategy.ts`.
// NOTHING IS COPIED: there is no wrapper that re-implements `run`. Every
// return below is `run` itself, called directly; the functions defined here
// only prepare its INPUTS (the tape, the index range, the cost table) or do
// arithmetic on its OUTPUTS (the four tests, the plateau share, the null).
// The cell-for-cell check is therefore against PUBLISHED numbers: this file's
// own pipeline — extraction, splice, fill, trim, costs, index arithmetic —
// re-derives §4.22's 72 seeded cells, its 216 fold returns and the live
// five's 120 fold returns, and `fidelity` records every mismatch (there must
// be none before anything else is read). A second check, `startInvariance`,
// re-runs every seeded cell on a tape cut to begin exactly `warm-up` bars
// before the window and compares: the answer must not depend on how much
// history lies beyond the warm-up.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall-clock field. Re-running over the same two directories writes
// `kraken3.json` byte for byte identical; `backtest.ts` is SHA-256'd at the
// start and end of the run and a run that straddles an edit throws.

import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";
import { DEFAULT_TREND, type Candle, type TrendParams } from "../_shared/agents_strategy.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]
type Group = "kraken-cheaper" | "kraken-only" | "fid-4.22" | "live-five";

// ───────────────────────────────────────────────────────── facts, typed in

/** The bundle, as read (reference §2b). */
const BUNDLE = { name: "Kraken_OHLCVT_Full_2026Q2.zip", parts: "part00–part04", bytes: 8_972_380_104, members: 12_037, coverage: "every pair from its first trade to 2026-06-30" };

/** The screen's own metadata (§4.22). */
const SCREEN_META = { takenAt: "2026-09-22T14:16:12Z .. 2026-09-22T14:32:12Z", snapshots: 9, revxActiveUsdPairs: 307, krakenOnlineUsdPairs: 622, sharedBases: 245 };

/**
 * The cost-and-book screen §4.22 ran, as it measured it: medians of 9 snapshots 120 s apart, 2026-09-22 14:16–14:32 UTC
 * (Revolut X UK `configuration/pairs` + tickers, 307 active USD pairs; Kraken `AssetPairs` + `Ticker`, 622 online USD pairs).
 * [symbol, group, Kraken full spread bps, Revolut X UK full spread bps (null = not on the UK book), Kraken 24 h quote volume USD]
 * `study` rows are the 84 the screen passed and §4.22 could not test; `fid` rows are §4.22's own 18 and the live five,
 * carried only so the fidelity step can re-derive §4.22's published cells from this file's own pipeline.
 */
const SCREEN_2026_09_22: [string, "kraken-cheaper" | "kraken-only" | "fid-4.22" | "live-five", number, number | null, number][] = [
  ["AIOZ/USD", "kraken-cheaper", 15.785319652723423, 78.36990595611293, 484278],
  ["AKE/USD", "kraken-only", 17.72944726911889, null, 4184124],
  ["AR/USD", "kraken-only", 36.79852805887768, null, 317052],
  ["ARX/USD", "kraken-only", 52.62923152401706, null, 302018],
  ["ASTER/USD", "kraken-only", 5.554012774230311, null, 1432105],
  ["AUD/USD", "kraken-only", 1.8285264186898393, null, 1840258],
  ["AUSD/USD", "kraken-only", 0.6999475039373496, null, 246988],
  ["AVA/USD", "kraken-only", 43.84362440628348, null, 199680],
  ["BABY/USD", "kraken-only", 7.877116975186761, null, 274386],
  ["BLUR/USD", "kraken-cheaper", 25.425883549452305, 126.87135244861722, 210628],
  ["CAKE/USD", "kraken-only", 11.926058437686796, null, 358008],
  ["CAP/USD", "kraken-only", 5.2802956965581815, null, 194169],
  ["CHIP/USD", "kraken-only", 15.45424439783654, null, 242591],
  ["CLOUD/USD", "kraken-only", 90.29345372460442, null, 317833],
  ["CPOOL/USD", "kraken-only", 46.97380307136464, null, 163339],
  ["DAI/USD", "kraken-only", 1.9001425106874263, null, 409572],
  ["DCR/USD", "kraken-only", 16.065146940697403, null, 139578],
  ["DGAI/USD", "kraken-only", 32.534865579636225, null, 470625],
  ["DOG/USD", "kraken-only", 16.835016835017246, null, 703161],
  ["DRV/USD", "kraken-only", 36.0739156921536, null, 1255136],
  ["ESPORTS/USD", "kraken-only", 98.52216748768583, null, 313128],
  ["ETHFI/USD", "kraken-only", 21.448487881603572, null, 407558],
  ["EUL/USD", "kraken-cheaper", 14.925373134328373, 82.50825082508173, 259733],
  ["EUR/USD", "kraken-only", 0.17470300489282864, null, 51327460],
  ["EURC/USD", "kraken-only", 2.446312184382551, null, 1323950],
  ["EVAA/USD", "kraken-only", 28.121861399397265, null, 127131],
  ["FARTCOIN/USD", "kraken-only", 9.905894006934409, null, 5088453],
  ["FLUX/USD", "kraken-only", 3.1565656565644327, null, 163644],
  ["G/USD", "kraken-only", 42.664916311125666, null, 131251],
  ["GBP/USD", "kraken-only", 0.6738317442145595, null, 10117234],
  ["GENIUS/USD", "kraken-only", 17.39634676717859, null, 237197],
  ["GWEI/USD", "kraken-only", 18.238500201472387, null, 184101],
  ["JTO/USD", "kraken-cheaper", 3.3640384291920067, 75.772681954137, 380230],
  ["KAITO/USD", "kraken-cheaper", 11.504170261720201, 83.0113067124664, 180755],
  ["KAS/USD", "kraken-only", 14.34377241214547, null, 2214371],
  ["KAT/USD", "kraken-only", 20.020020020020944, null, 200413],
  ["KTA/USD", "kraken-cheaper", 45.87155963302884, 166.40844666322295, 254886],
  ["LAPTOP/USD", "kraken-only", 13.413816230718023, null, 329134],
  ["LIGHTER/USD", "kraken-only", 8.507018290088388, null, 1172345],
  ["LIT/USD", "kraken-only", 59.23000987166909, null, 123758],
  ["MEGA/USD", "kraken-only", 6.566706796540507, null, 1154271],
  ["MNT/USD", "kraken-only", 13.622947097555619, null, 496522],
  ["MOG/USD", "kraken-cheaper", 16.353229762879398, 105.90631364562266, 319078],
  ["MUBARAK/USD", "kraken-only", 64.25828696810497, null, 630441],
  ["NIGHT/USD", "kraken-only", 12.612991381123502, null, 886824],
  ["NIL/USD", "kraken-only", 23.364485981307457, null, 533454],
  ["NOCK/USD", "kraken-only", 123.95709177592363, null, 134708],
  ["NOS/USD", "kraken-only", 95.93536985609758, null, 176569],
  ["NPC/USD", "kraken-only", 32.6596398956591, null, 417228],
  ["OOB/USD", "kraken-only", 50.78720162519015, null, 130890],
  ["PEAQ/USD", "kraken-only", 2.8165047176462648, null, 376918],
  ["PENDLE/USD", "kraken-cheaper", 24.71169686985267, 98.06325079676401, 884953],
  ["PLAY/USD", "kraken-only", 24.056787571788558, null, 171478],
  ["PONKE/USD", "kraken-cheaper", 85.52229688454565, 391.03869653767777, 139914],
  ["PROMPT/USD", "kraken-cheaper", 22.920009168002732, 118.46769582618744, 204572],
  ["PROVE/USD", "kraken-cheaper", 35.22677234698349, 119.0267810257308, 142784],
  ["PTB/USD", "kraken-only", 30.045067601401744, null, 409316],
  ["PUMP/USD", "kraken-only", 6.722689075631146, null, 3598133],
  ["RIVER/USD", "kraken-only", 23.781212841854078, null, 100131],
  ["RLS/USD", "kraken-cheaper", 72.46376811594222, 140.5152224824355, 109713],
  ["S/USD", "kraken-only", 45.87155963302884, null, 486808],
  ["SAGA/USD", "kraken-only", 18.241042345277034, null, 1113175],
  ["SHX/USD", "kraken-only", 2.7506532801532084, null, 165344],
  ["SKR/USD", "kraken-only", 11.981500563130869, null, 1102861],
  ["SN64/USD", "kraken-only", 40.11304585650514, null, 139356],
  ["SODA/USD", "kraken-only", 23.446658851114794, null, 366043],
  ["STRK/USD", "kraken-cheaper", 7.193382088479138, 72.02881152460857, 509240],
  ["SWELL/USD", "kraken-cheaper", 82.59587020648914, 203.06356006807962, 233010],
  ["TAC/USD", "kraken-only", 25.109855618330805, null, 118187],
  ["TAO/USD", "kraken-only", 6.718345691934411, null, 37295830],
  ["TRAC/USD", "kraken-cheaper", 59.87170349251577, 122.69938650306821, 231570],
  ["TREAD/USD", "kraken-only", 5.863383172091821, null, 228217],
  ["TRUST/USD", "kraken-only", 16.30257580697797, null, 145949],
  ["TURBO/USD", "kraken-cheaper", 18.6567164179109, 108.14842438933493, 152219],
  ["UAI/USD", "kraken-only", 22.87494220426828, null, 1916438],
  ["USDE/USD", "kraken-only", 2.000800320127831, null, 318694],
  ["USDG/USD", "kraken-only", 1.000050002500015, null, 1365316],
  ["USELESS/USD", "kraken-only", 34.471752314076774, null, 7254420],
  ["W/USD", "kraken-cheaper", 16.7785234899322, 89.69368759519394, 162643],
  ["WBTC/USD", "kraken-only", 27.243751515637072, null, 346963],
  ["ZBCN/USD", "kraken-only", 53.98773006135046, null, 298250],
  ["ZETA/USD", "kraken-only", 36.231884057970795, null, 262059],
  ["ZIG/USD", "kraken-only", 2.0010005002493494, null, 141676],
  ["ZRC/USD", "kraken-only", 254.45292620865203, null, 372112],
  ["BAT/USD", "fid-4.22", 12.809315866085921, 75.15754177024891, 197770],
  ["CFG/USD", "fid-4.22", 7.459903021259902, null, 215523],
  ["ENS/USD", "fid-4.22", 29.629629629629, 110.69293779056791, 157313],
  ["FLOW/USD", "fid-4.22", 32.00000000000092, 113.63636363636338, 117576],
  ["FLR/USD", "fid-4.22", 14.398848092152042, 81.90243551979398, 397234],
  ["KSM/USD", "fid-4.22", 21.668472372697263, 92.66242861760618, 252947],
  ["LSK/USD", "fid-4.22", 37.95110559858783, null, 589074],
  ["LUNA/USD", "fid-4.22", 12.840502613959027, null, 241049],
  ["MINA/USD", "fid-4.22", 14.27551748750735, 128.93982808023094, 1485190],
  ["NANO/USD", "fid-4.22", 153.2257063794412, null, 653531],
  ["PHA/USD", "fid-4.22", 34.078807241746624, null, 717916],
  ["RUNE/USD", "fid-4.22", 30.30303030303033, null, 317289],
  ["STORJ/USD", "fid-4.22", 15.39645881447311, 147.73776546629767, 154543],
  ["SUPER/USD", "fid-4.22", 19.537609899055337, 91.32420091324101, 190698],
  ["SYN/USD", "fid-4.22", 16.638935108153557, null, 544031],
  ["XCN/USD", "fid-4.22", 22.753128555177383, 159.63511972634117, 515115],
  ["XMR/USD", "fid-4.22", 10.348607761454385, null, 6795618],
  ["ZEC/USD", "fid-4.22", 4.177818395457275, null, 49860825],
  ["BTC/USD", "live-five", 0.011619253335837758, 1.8666104826200043, 326107894],
  ["ETH/USD", "live-five", 0.5459379486930827, 2.5427915492132533, 141953858],
  ["SOL/USD", "live-five", 1.7040129504980845, 3.327943203102793, 61261441],
  ["AVAX/USD", "live-five", 1.8193395797315486, 10.010465486644431, 15291078],
  ["SUI/USD", "live-five", 2.976338112009196, 11.909487892021536, 26866135],
];
/** §4.22's own grouping of its 18 (its `universe`), needed to rebuild its cost schedules exactly. */
const GROUP_4_22: Record<string, "kraken-cheaper" | "kraken-only"> = {"BAT/USD": "kraken-cheaper", "CFG/USD": "kraken-only", "ENS/USD": "kraken-cheaper", "FLOW/USD": "kraken-cheaper", "FLR/USD": "kraken-cheaper", "KSM/USD": "kraken-cheaper", "LSK/USD": "kraken-only", "LUNA/USD": "kraken-only", "MINA/USD": "kraken-cheaper", "NANO/USD": "kraken-only", "PHA/USD": "kraken-only", "RUNE/USD": "kraken-only", "STORJ/USD": "kraken-cheaper", "SUPER/USD": "kraken-cheaper", "SYN/USD": "kraken-only", "XCN/USD": "kraken-cheaper", "XMR/USD": "kraken-only", "ZEC/USD": "kraken-only"};
/**
 * §4.22's published SEEDED cells (`t1_seeded`, run 2026-09-22 14:34 UTC), typed in so this file can prove its own
 * pipeline reproduces them: [ret, maxDD, trades, otherRet] per coin × rulebook × window.
 */
const PUBLISHED_4_22_SEEDED: Record<string, Record<string, [number, number, number, number]>> = {
  "BAT/USD": { "trend-4h·A": [-0.2079, 0.2079, 8, -0.2055], "trend-4h·B": [-0.2932, 0.3348, 18, -0.2728], "trend-4h-wide·A": [-0.2412, 0.2412, 6, -0.2342], "trend-4h-wide·B": [0.2664, 0.2, 12, 0.2488] },
  "CFG/USD": { "trend-4h·A": [-0.0877, 0.0877, 2, -0.082], "trend-4h·B": [-0.2868, 0.2868, 10, -0.2643], "trend-4h-wide·A": [-0.0877, 0.0877, 2, -0.082], "trend-4h-wide·B": [-0.2794, 0.3433, 8, -0.2613] },
  "ENS/USD": { "trend-4h·A": [-0.2193, 0.2492, 10, -0.2205], "trend-4h·B": [0.0016, 0.2344, 10, 0.0002], "trend-4h-wide·A": [-0.0687, 0.1678, 4, -0.0685], "trend-4h-wide·B": [0.1064, 0.1737, 8, 0.1024] },
  "FLOW/USD": { "trend-4h·A": [-0.118, 0.1459, 4, -0.1215], "trend-4h·B": [-0.2243, 0.3373, 18, -0.2348], "trend-4h-wide·A": [-0.0966, 0.1295, 4, -0.1001], "trend-4h-wide·B": [0.4878, 0.1494, 8, 0.4762] },
  "FLR/USD": { "trend-4h·A": [-0.0723, 0.1035, 8, -0.0713], "trend-4h·B": [-0.022, 0.1491, 8, -0.0242], "trend-4h-wide·A": [-0.0339, 0.0961, 6, -0.0322], "trend-4h-wide·B": [0.1067, 0.2152, 6, 0.1049] },
  "KSM/USD": { "trend-4h·A": [0.0601, 0.1164, 8, 0.0563], "trend-4h·B": [0.0305, 0.178, 10, 0.0295], "trend-4h-wide·A": [-0.0365, 0.1629, 6, -0.0357], "trend-4h-wide·B": [-0.0968, 0.1922, 10, -0.1038] },
  "LSK/USD": { "trend-4h·A": [-0.0411, 0.0855, 8, -0.0171], "trend-4h·B": [-0.0779, 0.1581, 10, -0.0489], "trend-4h-wide·A": [-0.0311, 0.0687, 2, -0.0251], "trend-4h-wide·B": [0.3579, 0.1135, 6, 0.3834] },
  "LUNA/USD": { "trend-4h·A": [-0.0878, 0.1961, 6, -0.0707], "trend-4h·B": [-0.0104, 0.1682, 10, 0.0208], "trend-4h-wide·A": [-0.1785, 0.2091, 4, -0.1683], "trend-4h-wide·B": [-0.2506, 0.3298, 8, -0.2317] },
  "MINA/USD": { "trend-4h·A": [0.1316, 0.1321, 6, 0.1139], "trend-4h·B": [-0.2117, 0.2446, 14, -0.2321], "trend-4h-wide·A": [0.7203, 0.205, 4, 0.7023], "trend-4h-wide·B": [0.0197, 0.1719, 8, -0.1937] },
  "NANO/USD": { "trend-4h·A": [-0.0501, 0.0791, 4, -0.0382], "trend-4h·B": [-0.2605, 0.2605, 8, -0.2419], "trend-4h-wide·A": [-0.0084, 0.0467, 2, -0.0023], "trend-4h-wide·B": [0.6054, 0.3266, 8, 0.6457] },
  "PHA/USD": { "trend-4h·A": [-0.1142, 0.3149, 14, -0.0749], "trend-4h·B": [-0.2298, 0.2458, 12, -0.2006], "trend-4h-wide·A": [0.0076, 0.2534, 9, 0.0361], "trend-4h-wide·B": [-0.2014, 0.2326, 6, -0.1864] },
  "RUNE/USD": { "trend-4h·A": [-0.0937, 0.1498, 17, -0.0446], "trend-4h·B": [0.1322, 0.2147, 16, 0.1898], "trend-4h-wide·A": [-0.0144, 0.1699, 13, 0.0262], "trend-4h-wide·B": [0.1363, 0.2284, 12, 0.1794] },
  "STORJ/USD": { "trend-4h·A": [-0.0728, 0.0767, 6, -0.0922], "trend-4h·B": [0.1026, 0.3195, 12, 0.0641], "trend-4h-wide·A": [-0.0589, 0.0701, 4, -0.072], "trend-4h-wide·B": [-0.0885, 0.3718, 10, -0.109] },
  "SUPER/USD": { "trend-4h·A": [0.2182, 0.1128, 6, 0.2146], "trend-4h·B": [-0.0524, 0.245, 8, -0.0493], "trend-4h-wide·A": [0.1499, 0.217, 5, 0.1471], "trend-4h-wide·B": [-0.3089, 0.3366, 8, -0.3016] },
  "SYN/USD": { "trend-4h·A": [-0.0644, 0.1137, 4, -0.0528], "trend-4h·B": [-0.2097, 0.2186, 6, -0.1948], "trend-4h-wide·A": [-0.127, 0.127, 4, -0.1161], "trend-4h-wide·B": [-0.0736, 0.0736, 2, -0.0678] },
  "XCN/USD": { "trend-4h·A": [0, 0, 0, 0], "trend-4h·B": [-0.0167, 0.0387, 2, -0.0241], "trend-4h-wide·A": [0, 0, 0, 0], "trend-4h-wide·B": [-0.0558, 0.071, 2, -0.0628] },
  "XMR/USD": { "trend-4h·A": [-0.0899, 0.324, 28, -0.0073], "trend-4h·B": [0.3284, 0.2118, 22, 0.4222], "trend-4h-wide·A": [0.0349, 0.309, 22, 0.1079], "trend-4h-wide·B": [0.0934, 0.2193, 16, 0.149] },
  "ZEC/USD": { "trend-4h·A": [1.0656, 0.2461, 14, 1.1573], "trend-4h·B": [-0.1433, 0.2156, 18, -0.0941], "trend-4h-wide·A": [1.6671, 0.2494, 12, 1.7682], "trend-4h-wide·B": [-0.2889, 0.404, 16, -0.2528] },
};
/** §4.22's published six-fold returns (`t2_folds`), Kraken costs, seeded: per coin × rulebook. */
const PUBLISHED_4_22_FOLDS: Record<string, Record<string, number[]>> = {
  "BAT/USD": { "trend-4h": [-0.1611, -0.0782, -0.0441, -0.2606, -0.0879, -0.1315], "trend-4h-wide": [-0.3708, -0.0125, 0.5269, -0.1706, 0, -0.2412] },
  "CFG/USD": { "trend-4h": [-0.1677, -0.0735, -0.0877, -0.2182, -0.0877, 0], "trend-4h-wide": [-0.0877, -0.0848, 0, -0.2794, -0.0877, 0] },
  "ENS/USD": { "trend-4h": [-0.1852, 0, -0.0295, 0.032, 0, -0.2193], "trend-4h-wide": [-0.1695, 0, -0.0495, 0.164, 0, -0.0687] },
  "FLOW/USD": { "trend-4h": [0.1977, -0.128, -0.0597, -0.1751, 0, -0.118], "trend-4h-wide": [-0.0706, -0.1496, 0.5107, -0.0152, 0, -0.0966] },
  "FLR/USD": { "trend-4h": [-0.0233, 0, -0.0276, 0.0057, -0.088, 0.0172], "trend-4h-wide": [-0.0875, 0, -0.0341, 0.1458, -0.088, 0.0593] },
  "KSM/USD": { "trend-4h": [-0.0545, -0.1281, -0.0324, 0.065, -0.064, 0.1326], "trend-4h-wide": [-0.1561, -0.1432, -0.1572, 0.0716, 0, -0.0365] },
  "LSK/USD": { "trend-4h": [-0.1438, 0.0112, -0.0095, -0.069, 0, -0.0411], "trend-4h-wide": [0.3385, 0.0112, 0.4144, -0.0399, 0, -0.0311] },
  "LUNA/USD": { "trend-4h": [0.0558, -0.1659, 0.0598, -0.0662, 0.0925, -0.165], "trend-4h-wide": [-0.0415, -0.2146, -0.2283, -0.0289, 0, -0.1785] },
  "MINA/USD": { "trend-4h": [0.8138, -0.2007, -0.0448, -0.1747, 0, 0.1316], "trend-4h-wide": [-0.0768, -0.1682, -0.0317, 0.053, 0, 0.7203] },
  "NANO/USD": { "trend-4h": [0.5459, -0.2586, -0.1316, -0.1484, -0.076, 0.028], "trend-4h-wide": [0.1593, -0.2713, 0.9572, -0.1797, 0, -0.0084] },
  "PHA/USD": { "trend-4h": [-0.074, -0.0362, -0.1533, -0.0903, -0.071, -0.0293], "trend-4h-wide": [-0.0449, 0, -0.0889, -0.1234, -0.0332, 0.0002] },
  "RUNE/USD": { "trend-4h": [0.0609, -0.1241, -0.0187, 0.1538, -0.1206, -0.0222], "trend-4h-wide": [0.146, -0.1696, -0.0089, 0.1465, -0.1206, 0.071] },
  "STORJ/USD": { "trend-4h": [-0.048, -0.2862, 0.1867, -0.0709, -0.0447, -0.0295], "trend-4h-wide": [0.0048, -0.1699, 0.0057, -0.0936, -0.0501, -0.0093] },
  "SUPER/USD": { "trend-4h": [0.4816, 0, -0.0882, 0.0393, 0, 0.2182], "trend-4h-wide": [0, 0, -0.0882, -0.242, 0, 0.1858] },
  "SYN/USD": { "trend-4h": [-0.2462, 0, -0.1684, -0.0496, -0.0881, 0.0259], "trend-4h-wide": [-0.1684, 0, 0, -0.0736, -0.0881, -0.0427] },
  "XCN/USD": { "trend-4h": [0, 0, -0.0167, 0, 0, 0], "trend-4h-wide": [0, 0, -0.0558, 0, 0, 0] },
  "XMR/USD": { "trend-4h": [-0.126, -0.1223, -0.0941, 0.4664, -0.1363, 0.0537], "trend-4h-wide": [-0.1818, 0.0231, -0.1099, 0.2284, -0.0562, 0.0965] },
  "ZEC/USD": { "trend-4h": [-0.3756, -0.1632, -0.0784, -0.0703, -0.0533, 1.182], "trend-4h-wide": [-0.3657, 0.0391, -0.0358, -0.2625, -0.0708, 1.8704] },
};
/** §4.22's published six-fold returns for the live five (`kstudy3` rows): Revolut X taking the touch, and Kraken post-only. */
const PUBLISHED_4_22_LIVE5_FOLDS: Record<string, Record<string, number[]>> = {
  "BTC/USD": { "trend-4h·revx": [0.1678, -0.1699, 0.1942, 0.0103, -0.066, -0.005], "trend-4h·kraken": [0.0995, -0.2018, 0.1381, -0.0487, -0.0937, -0.0546], "trend-4h-wide·revx": [0.2073, -0.122, 0.034, 0.1617, -0.0831, -0.0554], "trend-4h-wide·kraken": [0.1574, -0.1404, -0.0088, 0.1273, -0.1049, -0.0971] },
  "ETH/USD": { "trend-4h·revx": [0.3596, 0.1951, 0.0695, 0.6344, -0.0991, 0.0682], "trend-4h·kraken": [0.3036, 0.1879, 0.0379, 0.5764, -0.1257, 0.0274], "trend-4h-wide·revx": [0.1881, 0.0773, 0.0418, 0.5582, -0.1386, 0.1159], "trend-4h-wide·kraken": [0.1528, 0.0708, 0.017, 0.5028, -0.1591, 0.0862] },
  "SOL/USD": { "trend-4h·revx": [0.4864, 0.0996, 0.2389, -0.1269, -0.2015, 0.3663], "trend-4h·kraken": [0.4246, 0.0701, 0.1948, -0.1733, -0.2253, 0.3459], "trend-4h-wide·revx": [0.5831, 0.1355, 0.3022, -0.0835, -0.0844, 0.3201], "trend-4h-wide·kraken": [0.5453, 0.1218, 0.271, -0.1215, -0.1008, 0.3003] },
  "AVAX/USD": { "trend-4h·revx": [1.4878, -0.0231, 0.0724, 0.074, 0, 0.1258], "trend-4h·kraken": [1.4338, -0.0464, 0.0552, 0.0343, 0, 0.1018], "trend-4h-wide·revx": [2.0373, -0.0898, 0.0627, 0.0648, 0, 0.3574], "trend-4h-wide·kraken": [1.9714, -0.1071, 0.0513, 0.0362, 0, 0.3392] },
  "SUI/USD": { "trend-4h·revx": [0.0668, -0.1105, 0, -0.0175, 0.0268, 0.2663], "trend-4h·kraken": [0.0612, -0.1203, 0, -0.0441, 0.016, 0.2359], "trend-4h-wide·revx": [0.0465, 0, 0, 0.0773, 0.0006, 0.5059], "trend-4h-wide·kraken": [0.0409, 0, 0, 0.0598, -0.0099, 0.4854] },
};

// ─────────────────────────────────────────── the rules, declared first

const BAR_S = 14_400;
/** §3.14's / §4.22's grid: 6,571 four-hour bars, first 2023-09-22 16:00 UTC, last 2026-09-21 16:00 UTC. */
const GRID_FIRST_S = 1_695_398_400;
const GRID_BARS = 6_571;
const GRID_LAST_S = GRID_FIRST_S + (GRID_BARS - 1) * BAR_S;
const T1 = Math.floor(GRID_BARS / 3), T2 = Math.floor(GRID_BARS * 2 / 3);
const FOLD_SEG = Math.floor(GRID_BARS / 6);
/** How far back a tape is kept: window D's start, less more warm-up than any rulebook needs. Nothing earlier is read. */
const TAPE_EARLIEST_S = GRID_FIRST_S - (T1 + 400) * BAR_S;

const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
const MAX_NO_TRADE_SHARE = 0.02;
const MIN_BOOK_USD = 100_000;
const MIN_IN_SAMPLE_DAYS = 180;
const OWN_THIRDS_MIN_DAYS = 540;
const MOMENTUM_WARMUP_BARS = 32 * 6;
const FOLDS_NEEDED = 4;

/** §3.14's sets, verbatim (`backtest_kraken2.ts`), plus USDe. A dollar is not something a trend rule is about. */
const STABLE_OR_FIAT = new Set(["USDTUSD", "USDCUSD", "USDGUSD", "AUSDUSD", "TGBPUSD", "EURCUSD", "EURUSD", "GBPUSD", "AUDUSD", "DAIUSD", "PYUSDUSD", "RLUSDUSD", "USDSUSD", "TUSDUSD", "USDQUSD", "USDEUSD"]);
const WRAPPED = new Set(["WBTCUSD", "WETHUSD", "WSTETHUSD", "TBTCUSD", "LSETHUSD", "EETHUSD"]);

type Segment = { name: string; from: number; to: number }; // grid indices, [from, to)
const WINDOWS: Segment[] = [
  { name: "A", from: T2, to: GRID_BARS },
  { name: "B", from: T1, to: T2 },
  { name: "C", from: 0, to: T1 },
  { name: "D", from: -T1, to: 0 },
];
const FOLDS: Segment[] = Array.from({ length: 6 }, (_, f) => ({ name: `F${f + 1}`, from: f * FOLD_SEG, to: Math.min(GRID_BARS, (f + 1) * FOLD_SEG) }));

type Rulebook = { id: "trend-4h" | "trend-4h-wide"; what: string; seeded: TrendParams; grid: TrendParams[]; warmup: number };
function rulebooks(): Rulebook[] {
  const shipped: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) shipped.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const wide: TrendParams[] = [];
  for (const slow of [200, 300]) for (const breakoutUp of [100, 200]) for (const atrStop of [4, 6]) {
    wide.push({ ...DEFAULT_TREND, slow, breakoutUp, breakoutDown: Math.round(breakoutUp / 2.75), atrStop });
  }
  const warm = (g: TrendParams[]) => Math.max(Math.max(...g.map((p) => p.slow)) + 21, MOMENTUM_WARMUP_BARS);
  return [
    { id: "trend-4h", what: "the shipped rule at its seeded point (DEFAULT_TREND); the shipped 27-point grid for the plateau", seeded: { ...DEFAULT_TREND }, grid: shipped, warmup: warm(shipped) },
    { id: "trend-4h-wide", what: "§3.12's one slow variant: slow 200, breakout 100/36, ATR 4; its 8-point grid for the plateau", seeded: { ...DEFAULT_TREND, slow: 200, breakoutUp: 100, breakoutDown: 36, atrStop: 4 }, grid: wide, warmup: warm(wide) },
  ];
}
const stopsOf = (p: TrendParams): StopParams => ({ ...stopsForKind("trend-4h", p), maxLossPct: SHIPPED_STOPS.maxLossPct });

// ────────────────────────────────────────────────────────── arithmetic

const r2 = (x: number) => Number.isFinite(x) ? Number(x.toFixed(2)) : 0;
const r3 = (x: number) => Number.isFinite(x) ? Number(x.toFixed(3)) : 0;
const r4 = (x: number) => Number.isFinite(x) ? Number(x.toFixed(4)) : 0;
const utc = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ");
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const score = (r: { ret: number; maxDD: number }) => r.ret / Math.max(0.05, r.maxDD);
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
/** P(X ≥ k) for X ~ Binomial(n, p), exact. */
function binomTail(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return k <= n ? 1 : 0;
  let cum = 0, c = 1;
  for (let i = 0; i < k; i++) {
    cum += c * Math.pow(p, i) * Math.pow(1 - p, n - i);
    c = c * (n - i) / (i + 1);
  }
  return Math.max(0, 1 - cum);
}
/** §4.15's four tests, from the running venue's side. Reads outputs of `run`; touches no price. */
function barTests(ownRet: number, ownDD: number, plateau: number, otherRet: number): { pass: boolean; passThreeTests: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(ownRet > 0)) failed.push("Kraken return not positive");
  if (!(ownDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau >= 0.5)) failed.push("plateau < 50 %");
  if (!(otherRet > 0)) failed.push("other-schedule return not positive");
  return { pass: failed.length === 0, passThreeTests: ownRet > 0 && ownDD < 0.35 && otherRet > 0, failed };
}
const roundTripBps = (c: Costs, s: string) => 2 * (c.fillFee === "taker" ? c.takerBps : c.makerBps) + 2 * spreadOf(c, s) * 1e4;

// ──────────────────────────────────────────────────────────── the tape

type LiveFile = { symbol: string; altname: string; pairKey: string; last: number; fetchedAt: string; rows: (string | number)[][] };
type Member = { altname: string | null; member: string | null; bytes?: number; crc32?: string; sha256?: string; note?: string };
type Tape = {
  c4h: Candle[]; daily: Candle[]; noTrade: Uint8Array; firstS: number; offset: number;
  prov: {
    altname: string | null; listedS: number; listed: string; firstKept: string; last: string; bars: number;
    bundleBars: number; liveBars: number; overlapBars: number; overlapMedianBps: number | null; overlapP95Bps: number | null;
    omittedBars: number; zeroVolumeBars: number; spliceOk: boolean; spliceNote: string;
  };
};

function parseCsv(text: string): Map<number, Raw> {
  const out = new Map<number, Raw>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const p = line.split(",");
    const t = Number(p[0]);
    out.set(t, [t, Number(p[1]), Number(p[2]), Number(p[3]), Number(p[4]), Number(p[5])]);
  }
  return out;
}
function parseLive(f: LiveFile): Map<number, Raw> {
  const out = new Map<number, Raw>();
  for (const r of f.rows.slice(0, -1)) {                  // the last row is the still-forming candle
    const t = Number(r[0]);
    out.set(t, [t, Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[6])]);
  }
  return out;
}

/** Splice (the bundle strictly before the endpoint's first bar), forward-fill, keep [max(listing, earliestS), GRID_LAST_S]. */
function buildTape(alt: string | null, csvText: string | null, live: LiveFile | null, earliestS: number): Tape | null {
  const bundle = csvText ? parseCsv(csvText) : new Map<number, Raw>();
  const lv = live ? parseLive(live) : new Map<number, Raw>();
  if (!bundle.size && !lv.size) return null;
  let liveFirst = Infinity;
  for (const t of lv.keys()) liveFirst = Math.min(liveFirst, t);
  const diffs: number[] = [];
  for (const [t, b] of lv) {
    const a = bundle.get(t);
    if (a && b[4] > 0) diffs.push(Math.abs(a[4] - b[4]) / b[4] * 1e4);
  }
  diffs.sort((x, y) => x - y);
  const med = diffs.length ? median(diffs) : null;
  const p95 = diffs.length ? diffs[Math.floor(0.95 * (diffs.length - 1))] : null;
  let bundleLast = -Infinity;
  for (const t of bundle.keys()) bundleLast = Math.max(bundleLast, t);
  // Two sources that do not touch would be forward-filled across the hole: a made-up flat stretch, refused.
  const gap = bundle.size > 0 && lv.size > 0 && bundleLast + BAR_S < liveFirst && diffs.length === 0;
  const spliceOk = !gap && (med == null || (med <= OVERLAP_MEDIAN_MAX_BPS && (p95 ?? 0) <= OVERLAP_P95_MAX_BPS));
  const merged = new Map<number, Raw>();
  for (const [t, b] of bundle) if (t < liveFirst) merged.set(t, b);
  for (const [t, b] of lv) merged.set(t, b);
  const ts = [...merged.keys()].sort((a, b) => a - b);
  const listedS = ts[0];
  if (listedS > GRID_LAST_S) return null;
  const firstS = Math.max(listedS, earliestS);
  const c4h: Candle[] = [];
  const flags: number[] = [];
  let prev: number | null = null, omitted = 0, zeroVol = 0;
  for (let t = listedS; t <= GRID_LAST_S; t += BAR_S) {
    const b = merged.get(t);
    let bar: Candle, empty: boolean;
    if (b) { bar = { start: t * 1000, open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] }; empty = !(b[5] > 0); prev = b[4]; }
    else { const c = prev as number; bar = { start: t * 1000, open: c, high: c, low: c, close: c, volume: 0 }; empty = true; }
    if (t >= firstS) {
      c4h.push(bar); flags.push(empty ? 1 : 0);
      if (!b) omitted++; else if (empty) zeroVol++;
    }
  }
  return {
    c4h, daily: resample(c4h, 24), noTrade: Uint8Array.from(flags), firstS, offset: (GRID_FIRST_S - firstS) / BAR_S,
    prov: {
      altname: alt, listedS, listed: day(listedS), firstKept: utc(firstS), last: utc(GRID_LAST_S), bars: c4h.length,
      bundleBars: bundle.size, liveBars: lv.size, overlapBars: diffs.length,
      overlapMedianBps: med == null ? null : r4(med), overlapP95Bps: p95 == null ? null : r4(p95),
      omittedBars: omitted, zeroVolumeBars: zeroVol, spliceOk,
      spliceNote: gap ? `the sources do not meet (bundle ends ${utc(bundleLast)}, endpoint starts ${utc(liveFirst)}): refused rather than forward-filled`
        : med == null ? "no overlap to compare (one source only)" : spliceOk ? "sources agree" : `overlap median ${r2(med)} / p95 ${r2(p95 ?? NaN)} bps outside the declared thresholds`,
    },
  };
}

/** A grid segment on a coin's tape, or why it is not scored. */
function place(t: Tape, seg: Segment, warmup: number): { from: number; to: number; noTradeShare: number } | { skip: string } {
  const from = seg.from + t.offset, to = seg.to + t.offset;
  if (from - warmup < 0) return { skip: t.firstS > GRID_FIRST_S + seg.from * BAR_S ? "listed after the window opened" : "listed inside the warm-up" };
  if (to > t.c4h.length) return { skip: "tape ends early" };
  let empty = 0;
  for (let i = from - warmup; i < to; i++) empty += t.noTrade[i];
  const share = empty / (to - (from - warmup));
  if (share > MAX_NO_TRADE_SHARE) return { skip: `${(share * 100).toFixed(1)} % of bars without a trade` };
  return { from, to, noTradeShare: r4(share) };
}

// ───────────────────────────────────────────────────────────── a cell

type Costed = { KC: Costs; OC: Costs; ZERO: Costs };
function costsFor(sym: string, group: Group, kFull: number, rFull: number | null): Costed {
  // §4.22 carried its universe's spreads rounded to 0.01 bps; this study does the same.
  const k = r2(kFull), o = rFull == null ? k : r2(rFull);
  return {
    KC: { ...COSTS.kraken, halfSpread: { [sym]: k / 2 / 1e4 } },
    OC: group === "kraken-cheaper" || group === "fid-4.22" && rFull != null
      ? { venue: "revx-uk", makerBps: 0, takerBps: 9, fillFee: "taker", halfSpread: { [sym]: o / 2 / 1e4 } }
      : { venue: "revx-fee-at-kraken-spread", makerBps: 0, takerBps: 9, fillFee: "taker", halfSpread: { [sym]: o / 2 / 1e4 } },
    ZERO: { venue: "gross", makerBps: 0, takerBps: 0, fillFee: "maker", halfSpread: { [sym]: 0 } },
  };
}

type CellOut = {
  symbol: string; group: Group; rulebook: string; segment: string; from: string; to: string;
  kraken: { ret: number; maxDD: number; trades: number; days: number; exposure: number };
  other: { schedule: string; ret: number }; gross: { ret: number; trades: number };
  plateau: number; gridPositive: string; pass: boolean; passThreeTests: boolean; failed: string[];
  noTradeShare: number; krakenRtBps: number; otherRtBps: number;
  search?: { chosen: string; inSampleDays: number; ret: number; maxDD: number; otherRet: number; pass: boolean } | { skip: string };
};

const label = (p: TrendParams) => `fast ${p.fast}/slow ${p.slow}/break ${p.breakoutUp}/${p.breakoutDown}/atr ${p.atrStop}`;
const pickRun = (r: RunResult) => ({ ret: r4(r.ret), maxDD: r4(r.maxDD), trades: r.trades, days: Math.round(r.days), exposure: r3(r.exposure) });

function cell(sym: string, group: Group, t: Tape, seg: Segment, from: number, to: number, noTradeShare: number, rb: Rulebook, c: Costed, withSearch: boolean): CellOut {
  const k = run("trend-4h", sym, t.c4h, t.daily, from, to, rb.seeded, c.KC, 4, stopsOf(rb.seeded));
  const o = run("trend-4h", sym, t.c4h, t.daily, from, to, rb.seeded, c.OC, 4, stopsOf(rb.seeded));
  const g = run("trend-4h", sym, t.c4h, t.daily, from, to, rb.seeded, c.ZERO, 4, stopsOf(rb.seeded));
  const gridK = rb.grid.map((p) => run("trend-4h", sym, t.c4h, t.daily, from, to, p, c.KC, 4, stopsOf(p)));
  const pos = gridK.filter((r) => r.ret > 0).length;
  const plateau = r3(pos / gridK.length);
  const tests = barTests(k.ret, k.maxDD, plateau, o.ret);
  const out: CellOut = {
    symbol: sym, group, rulebook: rb.id, segment: seg.name,
    from: utc(t.c4h[from].start / 1000), to: utc(t.c4h[to - 1].start / 1000),
    kraken: pickRun(k), other: { schedule: c.OC.venue, ret: r4(o.ret) }, gross: { ret: r4(g.ret), trades: g.trades },
    plateau, gridPositive: `${pos}/${gridK.length}`, pass: tests.pass, passThreeTests: tests.passThreeTests, failed: tests.failed,
    noTradeShare, krakenRtBps: r2(roundTripBps(c.KC, sym)), otherRtBps: r2(roundTripBps(c.OC, sym)),
  };
  if (withSearch) {
    // Reported beside the seeded cell and counted nowhere. The in-sample runs from the grid's first bar (or the coin's
    // listing, if later) to the window's opening bar, is chosen on Kraken's costs by return over drawdown (§4.22), and
    // must hold MIN_IN_SAMPLE_DAYS.
    const isFrom = Math.max(0, t.offset);
    const isDays = (from - isFrom) * 4 / 24;
    if (isDays < MIN_IN_SAMPLE_DAYS) out.search = { skip: `in-sample ${Math.round(isDays)} days < ${MIN_IN_SAMPLE_DAYS}` };
    else {
      let best = rb.grid[0], bestScore = -Infinity;
      for (const p of rb.grid) {
        if (from - Math.max(isFrom, p.slow + 1) < 20) continue;
        const s = score(run("trend-4h", sym, t.c4h, t.daily, isFrom, from, p, c.KC, 4, stopsOf(p)));
        if (s > bestScore) { bestScore = s; best = p; }
      }
      const bi = rb.grid.indexOf(best);
      const ko = gridK[bi];
      const oo = run("trend-4h", sym, t.c4h, t.daily, from, to, best, c.OC, 4, stopsOf(best));
      out.search = { chosen: label(best), inSampleDays: Math.round(isDays), ret: r4(ko.ret), maxDD: r4(ko.maxDD), otherRet: r4(oo.ret), pass: barTests(ko.ret, ko.maxDD, plateau, oo.ret).pass };
    }
  }
  return out;
}

/** The null for a set of coins each scored on both A and B (§4.22's form, and the pooled one beside it). */
function nullOf<T extends { symbol: string; segment: string }>(cells: T[], passOf: (c: T) => boolean) {
  const coins = [...new Set(cells.map((c) => c.symbol))].filter((s) =>
    cells.some((c) => c.symbol === s && c.segment === "A") && cells.some((c) => c.symbol === s && c.segment === "B")).sort();
  const n = coins.length;
  const passA = coins.filter((s) => cells.some((c) => c.symbol === s && c.segment === "A" && passOf(c))).length;
  const passB = coins.filter((s) => cells.some((c) => c.symbol === s && c.segment === "B" && passOf(c))).length;
  const both = coins.filter((s) => cells.some((c) => c.symbol === s && c.segment === "A" && passOf(c)) && cells.some((c) => c.symbol === s && c.segment === "B" && passOf(c)));
  const pA = n ? passA / n : 0, pB = n ? passB / n : 0, pooled = n ? (passA + passB) / (2 * n) : 0;
  return {
    coins: n, passA, passB, pA: r4(pA), pB: r4(pB),
    expectedIndependence: r2(n * pA * pB), expectedPooled: r2(n * pooled * pooled),
    observed: both.length, passers: both, pAtLeastObserved: r4(binomTail(n, pA * pB, both.length)),
  };
}

// ────────────────────────────────────────────────────────────── main

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const csvDir = String(args.csv ?? ""), liveDir = String(args.live ?? ""), outDir = String(args.out ?? "docs/agents/backtests");
  const k422Dir = args.k422 ? String(args.k422) : null;
  if (!csvDir || !liveDir) throw new Error("--csv <bundle members dir> and --live <OHLC endpoint dir> are both required");
  const t00 = Date.now();

  const btPath = new URL("./backtest.ts", import.meta.url);
  const sha = async (u: URL) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(u)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const btHashStart = await sha(btPath);

  const RB = rulebooks();
  const members = JSON.parse(await Deno.readTextFile(`${csvDir}/_members.json`)) as Record<string, Member>;
  const readLive = async (alt: string | null): Promise<LiveFile | null> => {
    if (!alt) return null;
    try { return JSON.parse(await Deno.readTextFile(`${liveDir}/${alt}.json`)) as LiveFile; } catch { return null; }
  };
  const tapeOf = async (sym: string, earliestS: number): Promise<Tape | null> => {
    const m = members[sym];
    const alt = m?.altname ?? null;
    const csv = m?.member ? await Deno.readTextFile(`${csvDir}/${m.member}`) : null;
    return buildTape(alt, csv, await readLive(alt), earliestS);
  };

  const study = SCREEN_2026_09_22.filter((r) => r[1] === "kraken-cheaper" || r[1] === "kraken-only");
  const cheaper = study.filter((r) => r[1] === "kraken-cheaper").length;
  if (study.length !== 84 || cheaper !== 17) throw new Error(`screen table is not the 84 (17 + 67): ${study.length} / ${cheaper}`);
  for (const r of study) {
    if (r[4] < MIN_BOOK_USD) throw new Error(`${r[0]}: book under the floor — not a screen pass`);
    if (r[1] === "kraken-cheaper" && !(r[3] != null && 80 + r[2] < 18 + r[3])) throw new Error(`${r[0]}: not Kraken-cheaper`);
    if (r[1] === "kraken-only" && r[3] != null) throw new Error(`${r[0]}: listed on the UK book`);
  }

  // ── fidelity 1: this pipeline's tapes against §4.22's own, bar for bar ──
  // Aligned by timestamp, prices and volume counted apart: `run` reads open, high, low and close and never volume, so
  // a price difference would move a result and a volume difference cannot — but both are reported, not waved through.
  const fid = SCREEN_2026_09_22.filter((r) => r[1] === "fid-4.22" || r[1] === "live-five");
  const gridTapes: Record<string, Tape> = {};
  const theirTapes: Record<string, { c4h: Candle[]; daily: Candle[] }> = {};
  const tapeCheck: Record<string, unknown> = {};
  let tapeShared = 0, tapePriceDiffer = 0, tapeVolumeDiffer = 0, tapeOnlyMine = 0, tapeOnlyTheirs = 0, tapeWorstVolRel = 0;
  for (const r of fid) {
    const t = await tapeOf(r[0], GRID_FIRST_S);
    if (!t || t.c4h.length !== GRID_BARS || t.firstS !== GRID_FIRST_S) throw new Error(`${r[0]}: cannot rebuild §4.22's grid (${t?.c4h.length ?? 0} bars)`);
    gridTapes[r[0]] = t;
    if (k422Dir) {
      const theirs = JSON.parse(await Deno.readTextFile(`${k422Dir}/${r[0].replace("/", "-")}_4h.json`)) as Raw[];
      const tc = theirs.map(([ts, o, h, l, c, v]) => ({ start: ts * 1000, open: o, high: h, low: l, close: c, volume: v }));
      theirTapes[r[0]] = { c4h: tc, daily: resample(tc, 24) };
      const mine = new Map(t.c4h.map((b) => [b.start, b] as const));
      let shared = 0, price = 0, vol = 0, onlyTheirs = 0, worstVolRel = 0;
      const volBars: string[] = [];
      for (const a of tc) {
        const b = mine.get(a.start);
        if (!b) { onlyTheirs++; continue; }
        shared++;
        if (a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close) price++;
        if (a.volume !== b.volume) {
          vol++; worstVolRel = Math.max(worstVolRel, Math.abs(a.volume - b.volume) / Math.max(1e-12, Math.abs(a.volume)));
          if (volBars.length < 6) volBars.push(utc(a.start / 1000));
        }
      }
      const onlyMine = t.c4h.length - shared;
      tapeShared += shared; tapePriceDiffer += price; tapeVolumeDiffer += vol; tapeOnlyMine += onlyMine; tapeOnlyTheirs += onlyTheirs;
      tapeWorstVolRel = Math.max(tapeWorstVolRel, worstVolRel);
      tapeCheck[r[0]] = {
        mine: t.c4h.length, theirs: tc.length, theirFirst: utc(tc[0].start / 1000), sharedBars: shared, onlyMine, onlyTheirs,
        priceDiffering: price, volumeDiffering: vol, worstVolumeRelDiff: Number(worstVolRel.toExponential(2)), volumeBars: volBars,
      };
    }
  }

  // ── fidelity 2: §4.22's published cells, re-derived through THIS pipeline (and, when given, from §4.22's own tapes) ──
  // Exactly §4.22's method: windows and folds cut on the tape's own length n (thirds; sixths), `run` from
  // max(from, slow + 1), a fold skipped when it holds fewer than slow + 20 bars. Only the costs and the tapes are this file's.
  type Rep = { seededCells: number; seededMismatch: string[]; foldCells: number; foldMismatch: string[]; pos18: number; scored18: number; posLiveRevx: number; posLiveKraken: number; scoredLive: number };
  const reproduce = (tapesBy: Record<string, { c4h: Candle[]; daily: Candle[] }>): Rep => {
    const rep: Rep = { seededCells: 0, seededMismatch: [], foldCells: 0, foldMismatch: [], pos18: 0, scored18: 0, posLiveRevx: 0, posLiveKraken: 0, scoredLive: 0 };
    const foldsOf = (sym: string, p: TrendParams, costs: Costs): number[] => {
      const t = tapesBy[sym], n = t.c4h.length, seg = Math.floor(n / 6), out: number[] = [];
      for (let f = 0; f < 6; f++) {
        const from = Math.max(f * seg, p.slow + 1), to = Math.min(n, (f + 1) * seg);
        if (to - from < p.slow + 20) { out.push(NaN); continue; }
        out.push(r4(run("trend-4h", sym, t.c4h, t.daily, from, to, p, costs, 4, stopsOf(p)).ret));
      }
      return out;
    };
    for (const [sym, pub] of Object.entries(PUBLISHED_4_22_SEEDED)) {
      const row = SCREEN_2026_09_22.find((r) => r[0] === sym)!;
      const grp = GROUP_4_22[sym];
      const c = costsFor(sym, grp, row[2], grp === "kraken-cheaper" ? row[3] : null);
      const t = tapesBy[sym], n = t.c4h.length, t1 = Math.floor(n / 3), t2 = Math.floor(n * 2 / 3);
      for (const rb of RB) {
        for (const [w, from, to] of [["A", t2, n], ["B", t1, t2]] as const) {
          const k = run("trend-4h", sym, t.c4h, t.daily, from, to, rb.seeded, c.KC, 4, stopsOf(rb.seeded));
          const o = run("trend-4h", sym, t.c4h, t.daily, from, to, rb.seeded, c.OC, 4, stopsOf(rb.seeded));
          const want = pub[`${rb.id}·${w}`];
          const got: [number, number, number, number] = [r4(k.ret), r4(k.maxDD), k.trades, r4(o.ret)];
          rep.seededCells++;
          if (got.some((x, i) => x !== want[i])) rep.seededMismatch.push(`${sym} ${rb.id}·${w}: published ${JSON.stringify(want)} rederived ${JSON.stringify(got)}`);
        }
      }
    }
    for (const [sym, pub] of Object.entries(PUBLISHED_4_22_FOLDS)) {
      const row = SCREEN_2026_09_22.find((r) => r[0] === sym)!;
      const grp = GROUP_4_22[sym];
      const c = costsFor(sym, grp, row[2], grp === "kraken-cheaper" ? row[3] : null);
      for (const rb of RB) {
        const got = foldsOf(sym, rb.seeded, c.KC);
        rep.pos18 += got.filter((x) => x > 0).length; rep.scored18 += got.filter((x) => Number.isFinite(x)).length;
        got.forEach((x, i) => { rep.foldCells++; if (x !== pub[rb.id][i]) rep.foldMismatch.push(`${sym} ${rb.id} F${i + 1}: published ${pub[rb.id][i]} rederived ${x}`); });
      }
    }
    for (const [sym, pub] of Object.entries(PUBLISHED_4_22_LIVE5_FOLDS)) {
      const row = SCREEN_2026_09_22.find((r) => r[0] === sym)!;
      // §4.22's live-five arm priced both venues at the measurement's FULL precision, as its `kstudy3` did.
      const KC: Costs = { ...COSTS.kraken, halfSpread: { [sym]: row[2] / 2 / 1e4 } };
      const RC: Costs = { ...COSTS.revx, halfSpread: { [sym]: (row[3] as number) / 2 / 1e4 } };
      for (const rb of RB) {
        for (const [vk, costs] of [["revx", RC], ["kraken", KC]] as const) {
          const got = foldsOf(sym, rb.seeded, costs);
          if (vk === "revx") { rep.posLiveRevx += got.filter((x) => x > 0).length; rep.scoredLive += got.length; }
          else rep.posLiveKraken += got.filter((x) => x > 0).length;
          got.forEach((x, i) => { rep.foldCells++; if (x !== pub[`${rb.id}·${vk}`][i]) rep.foldMismatch.push(`${sym} ${rb.id}·${vk} F${i + 1}: published ${pub[`${rb.id}·${vk}`][i]} rederived ${x}`); });
        }
      }
    }
    return rep;
  };
  const repMine = reproduce(gridTapes);
  const repTheirs = k422Dir ? reproduce(theirTapes) : null;
  const clean = (r: Rep | null) => r == null || (r.seededMismatch.length === 0 && r.foldMismatch.length === 0);
  const fidelityOk = clean(repMine) && clean(repTheirs) && (!k422Dir || tapePriceDiffer === 0);
  const seededCells = repMine.seededCells, foldCells = repMine.foldCells;
  const seededMismatch = repMine.seededMismatch, foldMismatch = repMine.foldMismatch;
  const pos422 = repMine.pos18, scored422 = repMine.scored18, posLiveRevx = repMine.posLiveRevx, posLiveKraken = repMine.posLiveKraken, scoredLive = repMine.scoredLive;
  console.log(`fidelity: this pipeline's tapes → seeded ${seededCells - seededMismatch.length}/${seededCells} exact, folds ${foldCells - foldMismatch.length}/${foldCells} exact` +
    (repTheirs ? `; §4.22's own tapes → seeded ${repTheirs.seededCells - repTheirs.seededMismatch.length}/${repTheirs.seededCells}, folds ${repTheirs.foldCells - repTheirs.foldMismatch.length}/${repTheirs.foldCells}` : "") +
    (k422Dir ? `; tapes: ${tapeShared} shared bars, ${tapePriceDiffer} with a price difference, ${tapeVolumeDiffer} with a volume difference (worst relative ${tapeWorstVolRel.toExponential(2)}), ${tapeOnlyMine} only in this pipeline's, ${tapeOnlyTheirs} only in §4.22's` : "") +
    `; aggregates: 18 coins ${pos422}/${scored422} positive folds, live five ${posLiveRevx}/${scoredLive} (Revolut X) ${posLiveKraken}/${scoredLive} (Kraken)`);
  if (!fidelityOk) console.log(`  FIDELITY FAILED — nothing below may be read\n  ${[...seededMismatch, ...foldMismatch, ...(repTheirs ? [...repTheirs.seededMismatch, ...repTheirs.foldMismatch] : [])].slice(0, 12).join("\n  ")}`);

  // ── the 84: tapes, the funnel, and which windows each can be scored on ──
  type CoinRow = {
    symbol: string; group: Group; altname: string | null; krakenFullBps: number; revxFullBps: number | null; krakenBookUsd: number;
    statusClass: string; status: string; listed: string | null; tape: Tape["prov"] | null;
    windows: Record<string, Record<string, string>>;
  };
  const coins: CoinRow[] = [];
  const tapes: Record<string, Tape> = {};
  for (const r of study) {
    const [sym, group, kFull, rFull, book] = r;
    const m = members[sym];
    const alt = m?.altname ?? null;
    const base: CoinRow = { symbol: sym, group, altname: alt, krakenFullBps: r2(kFull), revxFullBps: rFull == null ? null : r2(rFull), krakenBookUsd: book, statusClass: "", status: "", listed: null, tape: null, windows: {} };
    if (alt && (STABLE_OR_FIAT.has(alt) || WRAPPED.has(alt))) {
      base.statusClass = STABLE_OR_FIAT.has(alt) ? "not an asset: stablecoin or fiat" : "not an asset: wrapped duplicate";
      base.status = STABLE_OR_FIAT.has(alt) ? "not scored: stablecoin or fiat" : "not scored: wrapped duplicate of a coin Revolut X lists";
      const t = await tapeOf(sym, TAPE_EARLIEST_S);
      base.listed = t ? t.prov.listed : null;
      coins.push(base); continue;
    }
    const t = await tapeOf(sym, TAPE_EARLIEST_S);
    if (!t) { base.statusClass = base.status = "not scored: no tape"; coins.push(base); continue; }
    base.tape = t.prov; base.listed = t.prov.listed;
    if (!t.prov.spliceOk) { base.statusClass = "not scored: the splice was refused"; base.status = `not scored: ${t.prov.spliceNote}`; coins.push(base); continue; }
    tapes[sym] = t;
    for (const rb of RB) {
      base.windows[rb.id] = {};
      for (const seg of [...WINDOWS, ...FOLDS]) {
        const p = place(t, seg, rb.warmup);
        base.windows[rb.id][seg.name] = "skip" in p ? p.skip : "scored";
      }
    }
    // Classified on `trend-4h`'s warm-up (the shorter one); `windows` carries both rulebooks' verdicts per segment.
    const w = base.windows["trend-4h"];
    const has = (k: string) => w[k] === "scored";
    const continuity = (k: string) => w[k].includes("without a trade");
    base.statusClass = !m?.member ? "listed after the bundle closed (2026-06-30): under 120 days of tape"
      : has("A") && has("B") ? "two windows (A and B)"
      : has("A") ? "one window (A only)"
      : has("B") ? "one window (B only): A fails continuity"
      : continuity("A") ? "no full window: A fails continuity"
      : "no full window: listed too late";
    base.status = has("A") && has("B") ? `A and B scored${has("C") ? "; C scored" : ""}`
      : ["A", "B", "C"].map((k) => `${k}: ${w[k]}`).join("; ");
    coins.push(base);
  }
  coins.sort((a, b) => a.symbol.localeCompare(b.symbol));

  // ── the cells ──────────────────────────────────────────────────────────
  const windowCells: CellOut[] = [];
  const foldRows: { symbol: string; group: Group; rulebook: string; folds: (number | null)[]; otherFolds: (number | null)[]; scored: number; positive: number; otherPositive: number }[] = [];
  let invarianceCells = 0, invarianceDiffering = 0;
  const invarianceNotes: string[] = [];
  for (const cr of coins) {
    const t = tapes[cr.symbol];
    if (!t) continue;
    const row = study.find((r) => r[0] === cr.symbol)!;
    const c = costsFor(cr.symbol, cr.group, row[2], row[3]);
    for (const rb of RB) {
      for (const seg of WINDOWS) {
        const p = place(t, seg, rb.warmup);
        if ("skip" in p) continue;
        const out = cell(cr.symbol, cr.group, t, seg, p.from, p.to, p.noTradeShare, rb, c, seg.name === "A" || seg.name === "B");
        windowCells.push(out);
        // Start-invariance: the same cell on a tape cut to begin `warmup` bars before the window.
        const cut = p.from - rb.warmup;
        const tc = { c4h: t.c4h.slice(cut), daily: resample(t.c4h.slice(cut), 24) };
        const k2 = run("trend-4h", cr.symbol, tc.c4h, tc.daily, p.from - cut, p.to - cut, rb.seeded, c.KC, 4, stopsOf(rb.seeded));
        invarianceCells++;
        if (r4(k2.ret) !== out.kraken.ret || r4(k2.maxDD) !== out.kraken.maxDD || k2.trades !== out.kraken.trades) {
          invarianceDiffering++; invarianceNotes.push(`${cr.symbol} ${rb.id}·${seg.name}: ${out.kraken.ret} vs ${r4(k2.ret)}`);
        }
      }
      const folds: (number | null)[] = [], other: (number | null)[] = [];
      for (const seg of FOLDS) {
        const p = place(t, seg, rb.warmup);
        if ("skip" in p) { folds.push(null); other.push(null); continue; }
        folds.push(r4(run("trend-4h", cr.symbol, t.c4h, t.daily, p.from, p.to, rb.seeded, c.KC, 4, stopsOf(rb.seeded)).ret));
        other.push(r4(run("trend-4h", cr.symbol, t.c4h, t.daily, p.from, p.to, rb.seeded, c.OC, 4, stopsOf(rb.seeded)).ret));
      }
      const sc = folds.filter((x): x is number => x != null);
      foldRows.push({ symbol: cr.symbol, group: cr.group, rulebook: rb.id, folds, otherFolds: other, scored: sc.length, positive: sc.filter((x) => x > 0).length, otherPositive: other.filter((x): x is number => x != null && x > 0).length });
    }
  }

  // ── the null, then the count ────────────────────────────────────────────
  const perRulebook = RB.map((rb) => {
    const cs = windowCells.filter((c) => c.rulebook === rb.id && (c.segment === "A" || c.segment === "B"));
    return { rulebook: rb.id, fourTests: nullOf(cs, (c) => c.pass), threeTests: nullOf(cs, (c) => c.passThreeTests) };
  });
  const sum = (f: (x: typeof perRulebook[number]) => number) => r2(perRulebook.reduce((a, x) => a + f(x), 0));
  const headline = {
    nullStatedFirst: "for each rulebook, N·pA·pB expected two-window passes if a coin's two windows were independent draws at the observed per-window rates (§4.22's 3.33 is this sum); N·p² with p pooled over both windows beside it",
    expectedFourTests: sum((x) => x.fourTests.expectedIndependence),
    expectedFourTestsPooled: sum((x) => x.fourTests.expectedPooled),
    observedFourTests: perRulebook.reduce((a, x) => a + x.fourTests.observed, 0),
    expectedThreeTests: sum((x) => x.threeTests.expectedIndependence),
    observedThreeTests: perRulebook.reduce((a, x) => a + x.threeTests.observed, 0),
    passers: perRulebook.flatMap((x) => x.fourTests.passers.map((s) => `${x.rulebook}·${s}`)),
    passersThreeTests: perRulebook.flatMap((x) => x.threeTests.passers.map((s) => `${x.rulebook}·${s}`)),
    perRulebook,
  };

  // §4.22's written falsification, with only its history requirement relaxed: a two-window SEEDED pass AND ≥ 4 positive folds.
  const falsification = headline.passers.map((id) => {
    const [rbId, sym] = id.split("·");
    const f = foldRows.find((x) => x.symbol === sym && x.rulebook === rbId)!;
    return { id, positiveFolds: f.positive, scoredFolds: f.scored, clears: f.positive >= FOLDS_NEEDED };
  });

  // ── the coin-level count: a coin that passes on both rulebooks is ONE coin ──
  const eitherCells: { symbol: string; segment: string; pass: boolean }[] = [];
  for (const c of windowCells) {
    if (c.segment !== "A" && c.segment !== "B") continue;
    const e = eitherCells.find((x) => x.symbol === c.symbol && x.segment === c.segment);
    if (e) e.pass = e.pass || c.pass; else eitherCells.push({ symbol: c.symbol, segment: c.segment, pass: c.pass });
  }
  const coinLevel = nullOf(eitherCells, (c) => c.pass);

  // ── the one-window cohorts: A without B, and B without A ───────────────
  const oneWindow = RB.map((rb) => {
    const of = (seg: string) => windowCells.filter((c) => c.rulebook === rb.id && c.segment === seg);
    const hasSeg = (sym: string, seg: string) => windowCells.some((d) => d.rulebook === rb.id && d.segment === seg && d.symbol === sym);
    const onlyA = of("A").filter((c) => !hasSeg(c.symbol, "B")), onlyB = of("B").filter((c) => !hasSeg(c.symbol, "A"));
    return {
      rulebook: rb.id,
      aOnly: { coins: onlyA.length, pass: onlyA.filter((c) => c.pass).length, passers: onlyA.filter((c) => c.pass).map((c) => c.symbol) },
      bOnly: { coins: onlyB.length, pass: onlyB.filter((c) => c.pass).length, passers: onlyB.filter((c) => c.pass).map((c) => c.symbol) },
      passRateAllA: r4(of("A").filter((c) => c.pass).length / Math.max(1, of("A").length)),
      passRateAllB: r4(of("B").filter((c) => c.pass).length / Math.max(1, of("B").length)),
      note: "a one-window pass is not a qualification (§3.15: in all four stop × parameter conditions a coin that cleared window A was LESS likely to clear B); reported so nothing is hidden",
    };
  });

  // ── C and D where the history reaches ──────────────────────────────────
  const extraWindows = windowCells.filter((c) => c.segment === "C" || c.segment === "D").map((c) => ({
    symbol: c.symbol, rulebook: c.rulebook, segment: c.segment, ret: c.kraken.ret, maxDD: c.kraken.maxDD, plateau: c.plateau, otherRet: c.other.ret, pass: c.pass,
    passesAandB: windowCells.some((d) => d.symbol === c.symbol && d.rulebook === c.rulebook && d.segment === "A" && d.pass) && windowCells.some((d) => d.symbol === c.symbol && d.rulebook === c.rulebook && d.segment === "B" && d.pass),
  }));

  // ── folds, and the like-for-like comparators on the same six folds ─────
  const fid18Folds: { symbol: string; rulebook: string; folds: (number | null)[]; scored: number; positive: number }[] = [];
  const comparator = async () => {
    const out: Record<string, { cohort: string; schedule: string; perFold: { positive: number; scored: number }[]; positive: number; scored: number }> = {};
    const add = (key: string, cohort: string, schedule: string, fi: number, x: number | null) => {
      if (!out[key]) out[key] = { cohort, schedule, perFold: FOLDS.map(() => ({ positive: 0, scored: 0 })), positive: 0, scored: 0 };
      if (x == null) return;
      out[key].perFold[fi].scored++; out[key].scored++;
      if (x > 0) { out[key].perFold[fi].positive++; out[key].positive++; }
    };
    for (const r of fid) {
      const t = await tapeOf(r[0], TAPE_EARLIEST_S);
      if (!t) continue;
      const live = r[1] === "live-five";
      const grp: Group = live ? "live-five" : GROUP_4_22[r[0]];
      const c = costsFor(r[0], grp, r[2], grp === "kraken-cheaper" ? r[3] : null);
      const RC: Costs = { ...COSTS.revx, halfSpread: { [r[0]]: live ? (r[3] as number) / 2 / 1e4 : 0 } };
      for (const rb of RB) {
        const mine: (number | null)[] = [];
        FOLDS.forEach((seg, fi) => {
          const p = place(t, seg, rb.warmup);
          const k = "skip" in p ? null : run("trend-4h", r[0], t.c4h, t.daily, p.from, p.to, rb.seeded, live ? { ...COSTS.kraken, halfSpread: { [r[0]]: r[2] / 2 / 1e4 } } : c.KC, 4, stopsOf(rb.seeded)).ret;
          if (live) {
            add("live5-kraken", "live five", "Kraken post-only", fi, k);
            const rv = "skip" in p ? null : run("trend-4h", r[0], t.c4h, t.daily, p.from, p.to, rb.seeded, RC, 4, stopsOf(rb.seeded)).ret;
            add("live5-revx", "live five", "Revolut X taking the touch", fi, rv);
          } else { add("fid18-kraken", "§4.22's 18", "Kraken post-only", fi, k); mine.push(k == null ? null : r4(k)); }
        });
        if (!live) {
          const sc = mine.filter((x): x is number => x != null);
          fid18Folds.push({ symbol: r[0], rulebook: rb.id, folds: mine, scored: sc.length, positive: sc.filter((x) => x > 0).length });
        }
      }
    }
    for (const f of foldRows) f.folds.forEach((x, fi) => add("new-kraken", "this study's coins", "Kraken post-only", fi, x));
    return out;
  };
  const foldComparators = await comparator();

  // ── the own-thirds split (§3.8), for the coins the calendar cannot reach — counts for nothing ──
  const ownThirds: CellOut[] = [];
  for (const cr of coins) {
    const t = tapes[cr.symbol];
    if (!t) continue;
    const days = (t.c4h.length - 1) * 4 / 24;
    if (days < OWN_THIRDS_MIN_DAYS) continue;
    const row = study.find((r) => r[0] === cr.symbol)!;
    const c = costsFor(cr.symbol, cr.group, row[2], row[3]);
    // A coin with three years or more is cut on the last three, which IS the calendar split; shorter coins on their own tape.
    const start = Math.max(0, t.offset), n = t.c4h.length - start;
    const a = { name: "A", from: start + Math.floor(n * 2 / 3), to: start + n }, b = { name: "B", from: start + Math.floor(n / 3), to: start + Math.floor(n * 2 / 3) };
    for (const rb of RB) {
      for (const seg of [a, b]) {
        let empty = 0;
        for (let i = seg.from - rb.warmup; i < seg.to; i++) empty += t.noTrade[i];
        const share = empty / (seg.to - seg.from + rb.warmup);
        if (share > MAX_NO_TRADE_SHARE) continue;
        ownThirds.push(cell(cr.symbol, cr.group, t, { name: seg.name, from: 0, to: 0 }, seg.from, seg.to, r4(share), rb, c, false));
      }
    }
  }
  const ownThirdsNull = RB.map((rb) => ({ rulebook: rb.id, ...nullOf(ownThirds.filter((c) => c.rulebook === rb.id), (c) => c.pass) }));

  // ── the closing count: every Kraken-advantaged coin with two windows — §4.22's 18 and this study's — one rule set ──
  // §4.22's 18 are re-scored here under THIS file's declared rules (full tapes, the warm-up and continuity rules, all four
  // tests). §4.22's own seeded count used three tests (no plateau); `fourTestsOn422Grid` restores the plateau on
  // §4.22's exact tapes and cuts, so the two definitions can be told apart.
  const fidCells: CellOut[] = [];
  const fourTestsOn422Grid: CellOut[] = [];
  for (const r of fid.filter((x) => x[1] === "fid-4.22")) {
    const grp = GROUP_4_22[r[0]];
    const c = costsFor(r[0], grp, r[2], grp === "kraken-cheaper" ? r[3] : null);
    const t = await tapeOf(r[0], TAPE_EARLIEST_S);
    const g = gridTapes[r[0]];
    for (const rb of RB) {
      for (const seg of WINDOWS.slice(0, 2)) {
        if (t) {
          const p = place(t, seg, rb.warmup);
          if (!("skip" in p)) fidCells.push(cell(r[0], grp, t, seg, p.from, p.to, p.noTradeShare, rb, c, false));
        }
        fourTestsOn422Grid.push(cell(r[0], grp, g, seg, seg.from, seg.to, 0, rb, c, false));
      }
    }
  }
  const closing = {
    note: "§4.22's 18 plus this study's two-window coins, all four tests, seeded, one rule set",
    perRulebook: RB.map((rb) => ({ rulebook: rb.id, ...nullOf([...windowCells, ...fidCells].filter((c) => c.rulebook === rb.id && (c.segment === "A" || c.segment === "B")), (c) => c.pass) })),
    coinLevel: (() => {
      const e: { symbol: string; segment: string; pass: boolean }[] = [];
      for (const c of [...windowCells, ...fidCells]) {
        if (c.segment !== "A" && c.segment !== "B") continue;
        const x = e.find((y) => y.symbol === c.symbol && y.segment === c.segment);
        if (x) x.pass = x.pass || c.pass; else e.push({ symbol: c.symbol, segment: c.segment, pass: c.pass });
      }
      return nullOf(e, (c) => c.pass);
    })(),
    fourTestsOn422Grid: RB.map((rb) => ({
      rulebook: rb.id,
      fourTests: nullOf(fourTestsOn422Grid.filter((c) => c.rulebook === rb.id), (c) => c.pass),
      threeTests: nullOf(fourTestsOn422Grid.filter((c) => c.rulebook === rb.id), (c) => c.passThreeTests),
    })),
  };

  // ── continuity waived (counts for nothing): could the 2 % rule have thrown a winner away? ──
  const waivedCells: CellOut[] = [];
  for (const cr of coins) {
    const t = tapes[cr.symbol];
    if (!t) continue;
    const row = study.find((r) => r[0] === cr.symbol)!;
    const c = costsFor(cr.symbol, cr.group, row[2], row[3]);
    for (const rb of RB) {
      for (const seg of WINDOWS.slice(0, 2)) {
        const p = place(t, seg, rb.warmup);
        if (!("skip" in p) || !p.skip.includes("without a trade")) continue;
        const from = seg.from + t.offset, to = seg.to + t.offset;
        let empty = 0;
        for (let i = from - rb.warmup; i < to; i++) empty += t.noTrade[i];
        waivedCells.push(cell(cr.symbol, cr.group, t, seg, from, to, r4(empty / (to - from + rb.warmup)), rb, c, false));
      }
    }
  }
  const waivedNull = RB.map((rb) => ({ rulebook: rb.id, ...nullOf([...windowCells, ...waivedCells].filter((c) => c.rulebook === rb.id && (c.segment === "A" || c.segment === "B")), (c) => c.pass) }));

  // ── the gross edge: what the rule makes BEFORE any venue charges it ─────
  const gross = RB.map((rb) => {
    const per = (seg: string) => {
      const cs = windowCells.filter((c) => c.rulebook === rb.id && c.segment === seg && c.gross.trades > 0);
      const logSum = cs.reduce((a, c) => a + Math.log(1 + c.gross.ret), 0);
      const roundTrips = cs.reduce((a, c) => a + c.gross.trades / 2, 0);
      const perRt = roundTrips > 0 ? logSum / roundTrips : NaN;
      const beKraken = cs.filter((c) => Math.log(1 + c.gross.ret) / (c.gross.trades / 2) * 1e4 > c.krakenRtBps).length;
      return {
        cells: cs.length, grossPositive: cs.filter((c) => c.gross.ret > 0).length, roundTrips: r2(roundTrips),
        pooledGrossEdgePerRoundTripBps: r2(perRt * 1e4),
        medianCellEdgePerRoundTripBps: r2(median(cs.map((c) => Math.log(1 + c.gross.ret) / (c.gross.trades / 2) * 1e4))),
        medianKrakenRoundTripBps: r2(median(cs.map((c) => c.krakenRtBps))),
        cellsWhoseEdgeCoversKraken: beKraken,
      };
    };
    return { rulebook: rb.id, A: per("A"), B: per("B") };
  });
  // The same arithmetic for the live five and §4.22's 18, on the same windows and tapes built the same way: the yardstick.
  const grossYardstick: Record<string, Record<string, { cells: number; roundTrips: number; pooledGrossEdgePerRoundTripBps: number; medianCellEdgePerRoundTripBps: number }>> = {};
  for (const [cohort, grp] of [["live five", "live-five"], ["§4.22's 18", "fid-4.22"]] as const) {
    for (const rb of RB) {
      for (const seg of WINDOWS.slice(0, 2)) {
        const edges: number[] = [];
        let logSum = 0, rts = 0, n = 0;
        for (const r of fid.filter((x) => x[1] === grp)) {
          const t = await tapeOf(r[0], TAPE_EARLIEST_S);
          if (!t) continue;
          const p = place(t, seg, rb.warmup);
          if ("skip" in p) continue;
          const g = run("trend-4h", r[0], t.c4h, t.daily, p.from, p.to, rb.seeded, { venue: "gross", makerBps: 0, takerBps: 0, fillFee: "maker", halfSpread: { [r[0]]: 0 } }, 4, stopsOf(rb.seeded));
          if (g.trades === 0) continue;
          n++; logSum += Math.log(1 + g.ret); rts += g.trades / 2; edges.push(Math.log(1 + g.ret) / (g.trades / 2) * 1e4);
        }
        const key = `${cohort} · ${rb.id}`;
        if (!grossYardstick[key]) grossYardstick[key] = {};
        grossYardstick[key][seg.name] = { cells: n, roundTrips: r2(rts), pooledGrossEdgePerRoundTripBps: r2(rts > 0 ? logSum / rts * 1e4 : NaN), medianCellEdgePerRoundTripBps: r2(median(edges)) };
      }
    }
  }

  // ── what would reopen it: when each coin acquires two windows and three years ──
  const reopen = coins.filter((c) => c.listed && !c.statusClass.startsWith("not an asset")).map((c) => {
    const listedS = Date.parse(`${c.listed}T00:00:00Z`) / 1000;
    const warmDays = RB[0].warmup * 4 / 24;
    return { symbol: c.symbol, listed: c.listed, twoWindowsFrom: day(listedS + (2 * 365 + warmDays) * 86400), threeYearsFrom: day(listedS + 3 * 365 * 86400) };
  });
  const reopenBy = (iso: string) => reopen.filter((r) => r.twoWindowsFrom <= iso).length;

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart.slice(0, 12)} → ${btHashEnd.slice(0, 12)}); re-run it`);

  const liveFetched = new Set<string>();
  for (const r of SCREEN_2026_09_22) { const lf = await readLive(members[r[0]]?.altname ?? null); if (lf) liveFetched.add(lf.fetchedAt.slice(0, 16)); }
  const fetchedSorted = [...liveFetched].sort();

  const closingFalsification = closing.perRulebook.flatMap((x) => x.passers.map((sym) => {
    const f = foldRows.find((y) => y.symbol === sym && y.rulebook === x.rulebook) ?? fid18Folds.find((y) => y.symbol === sym && y.rulebook === x.rulebook);
    return { id: `${x.rulebook}·${sym}`, folds: f?.folds ?? null, positiveFolds: f?.positive ?? 0, scoredFolds: f?.scored ?? 0, clears: (f?.positive ?? 0) >= FOLDS_NEEDED };
  }));
  const statusCount: Record<string, number> = {};
  for (const c of coins) statusCount[c.statusClass] = (statusCount[c.statusClass] ?? 0) + 1;
  const passes = headline.observedFourTests;

  const report = {
    study: "The last Kraken avenue: the 84 coins §4.22's cost-and-book screen passed and could not test — does any clear §4.15's bar on Kraken's costs and Kraken's book, on SEEDED parameters, on both walk-forward windows?",
    declared: {
      grid: `${GRID_BARS} four-hour bars, ${utc(GRID_FIRST_S)} → ${utc(GRID_LAST_S)} UTC — §3.14's / §4.22's own`,
      windows: WINDOWS.map((w) => ({ name: w.name, outOfSample: `${utc(GRID_FIRST_S + w.from * BAR_S)} → ${utc(GRID_FIRST_S + (w.to - 1) * BAR_S)}` })),
      folds: FOLDS.map((w) => ({ name: w.name, span: `${utc(GRID_FIRST_S + w.from * BAR_S)} → ${utc(GRID_FIRST_S + (w.to - 1) * BAR_S)}` })),
      rulebooks: RB.map((r) => ({ id: r.id, what: r.what, seeded: label(r.seeded), gridPoints: r.grid.length, warmupBars: r.warmup })),
      stops: stopsOf(DEFAULT_TREND),
      bar: "§4.15's four tests from Kraken's side (§4.16): return > 0 on Kraken's costs, drawdown < 35 %, plateau ≥ 50 % of the grid positive on Kraken's costs, return > 0 on the other schedule — on BOTH A and B — and a Kraken book ≥ $100k a day",
      costs: "Kraken: 40 bps maker a side (post-only, as the loop rests there) plus half the screen's measured spread. Other schedule: the REAL Revolut X UK cost (9 bps taker plus half its measured UK spread) for a Kraken-cheaper coin; Revolut X's fees at Kraken's spread for a Kraken-only coin (§3.14's CHEAP schedule). Spreads are the screen's medians rounded to 0.01 bps, as §4.22 carried them.",
      continuity: `each scored segment, warm-up included, has at most ${MAX_NO_TRADE_SHARE * 100} % of its bars without a trade (omitted by the CSV, or zero volume from the endpoint)`,
      history: "a window is scored only when the coin's tape holds all of it plus the rulebook's warm-up before it; never shortened",
      null: "for each rulebook: N·pA·pB (independence at the observed per-window rates) and N·p² (pooled rate), with P(≥ observed) under Binomial(N, pA·pB)",
      search: `reported beside the seeded cells and counted nowhere; in-sample from the grid's first bar or the listing, ≥ ${MIN_IN_SAMPLE_DAYS} days, chosen on Kraken's costs by return over drawdown`,
      notAssets: "§3.14's stablecoin / fiat and wrapped sets, plus USDe",
    },
    data: {
      bundle: BUNDLE,
      liveEndpoint: { endpoint: "GET https://api.kraken.com/0/public/OHLC?pair=<alt>&interval=240 (keyless, 720 most recent candles; the forming last row dropped)", fetchedAtUtc: fetchedSorted.length ? `${fetchedSorted[0]} .. ${fetchedSorted[fetchedSorted.length - 1]}` : null },
      splice: `bundle bars strictly before the endpoint's first bar, the endpoint's from there on; overlap thresholds median ≤ ${OVERLAP_MEDIAN_MAX_BPS} bps, p95 ≤ ${OVERLAP_P95_MAX_BPS} bps on closes`,
      members: Object.fromEntries(Object.entries(members).sort((a, b) => a[0].localeCompare(b[0]))),
      screen: SCREEN_META,
    },
    fidelity: {
      ok: fidelityOk,
      tapes: k422Dir ? {
        coins: fid.length, sharedBars: tapeShared, priceDiffering: tapePriceDiffer, volumeDiffering: tapeVolumeDiffer,
        worstVolumeRelDiff: Number(tapeWorstVolRel.toExponential(2)), onlyInThisPipeline: tapeOnlyMine, onlyInTheirs: tapeOnlyTheirs, perCoin: tapeCheck,
        note: "this file's splice and fill, trimmed to §4.22's grid, against the tapes §4.22 read, aligned by timestamp. Prices must be identical; volume is reported apart because `run` never reads it (the seam bars take volume from whichever source a day's fetch window started on)",
      } : { skipped: "no --k422 directory given" },
      published422OnTheirTapes: repTheirs ? { seeded: `${repTheirs.seededCells - repTheirs.seededMismatch.length}/${repTheirs.seededCells}`, folds: `${repTheirs.foldCells - repTheirs.foldMismatch.length}/${repTheirs.foldCells}`, mismatches: [...repTheirs.seededMismatch, ...repTheirs.foldMismatch], note: "the same method on §4.22's own tapes: proof that the typed-in numbers are the ones those tapes produce" } : null,
      published422Seeded: { cells: seededCells, exact: seededCells - seededMismatch.length, mismatches: seededMismatch, note: "§4.22's t1_seeded: ret, maxDD, trades and the other schedule's ret, per coin × rulebook × window, re-derived from this file's tapes and costs by `run` itself" },
      published422Folds: { cells: foldCells, exact: foldCells - foldMismatch.length, mismatches: foldMismatch, note: "§4.22's 216 fold returns for its 18 coins and 120 for the live five (Revolut X taking the touch, and Kraken), re-derived the same way" },
      published422Aggregates: {
        folds18: `${pos422}/${scored422}`, published18: "49/216",
        live5Revx: `${posLiveRevx}/${scoredLive}`, publishedLive5Revx: "39/60",
        live5Kraken: `${posLiveKraken}/${scoredLive}`, publishedLive5Kraken: "36/60",
      },
      startInvariance: { cells: invarianceCells, differing: invarianceDiffering, notes: invarianceNotes.slice(0, 20), note: "every seeded window cell re-run on a tape cut to begin exactly warm-up bars before the window: the answer must not depend on older history" },
    },
    funnel: {
      screened: study.length, kraken_cheaper: cheaper, kraken_only: study.length - cheaper,
      byStatus: Object.fromEntries(Object.entries(statusCount).sort((a, b) => a[0].localeCompare(b[0]))),
    },
    coins,
    headline,
    falsification: {
      rule: "§4.22's written falsification with only its three-year requirement relaxed to the two windows: a two-window SEEDED pass on all four tests AND positive in at least 4 of the six folds",
      candidates: falsification, cleared: falsification.filter((f) => f.clears).map((f) => f.id),
    },
    coinLevel: { note: "one coin passing on both rulebooks is one coin: a window counts as passed when EITHER rulebook passes it", ...coinLevel },
    closing: { ...closing, falsification: closingFalsification },
    oneWindow,
    extraWindows,
    continuityWaived: {
      note: "every A or B segment the 2 % continuity rule dropped, scored anyway — SENSITIVITY, counts for nothing; answers whether the rule threw a winner away",
      cells: waivedCells.map((c) => ({ symbol: c.symbol, rulebook: c.rulebook, window: c.segment, noTradeShare: c.noTradeShare, ret: c.kraken.ret, maxDD: c.kraken.maxDD, plateau: c.plateau, otherRet: c.other.ret, pass: c.pass })),
      nullAndCountWithThem: waivedNull,
    },
    folds: {
      perCoin: foldRows,
      perCoin422: fid18Folds,
      comparators: foldComparators,
      note: "same six folds, same history and continuity rules, seeded, nothing chosen. The live five and §4.22's 18 are re-scored here on full tapes so every cohort's fold is the same calendar span; §4.22's own figures are the fidelity block's",
    },
    grossEdge: {
      note: "the SAME seeded cells at ZERO cost (no fee, no spread): the rule's edge before any venue charges it, per round trip (trades / 2), pooled as Σ ln(1 + ret) / Σ round trips over every A-scored (B-scored) cell of this study's coins. A venue whose round trip costs more than this cannot be the right venue for these coins at any fee tier it offers. `yardstick` is the same arithmetic for the live five and §4.22's 18",
      perRulebook: gross,
      yardstick: grossYardstick,
    },
    ownThirds: {
      note: "§3.8's split (each coin's own tape in thirds, ≥ 540 days) — SENSITIVITY, counts for nothing; a coin with three years or more is cut on its last three, which is the calendar split",
      nullAndCount: ownThirdsNull,
      cells: ownThirds.map((c) => ({ symbol: c.symbol, rulebook: c.rulebook, window: c.segment, from: c.from, to: c.to, ret: c.kraken.ret, maxDD: c.kraken.maxDD, plateau: c.plateau, otherRet: c.other.ret, pass: c.pass })),
    },
    reopen: {
      note: "when each coin will hold two full calendar windows (the two latest years plus warm-up) and three years of tape, if the windows roll forward with time",
      twoWindowsHistoryToday_2026_09_22: reopenBy("2026-09-22"), twoWindowsBy_2027_03_22: reopenBy("2027-03-22"), twoWindowsBy_2027_09_21: reopenBy("2027-09-21"), twoWindowsBy_2028_09_21: reopenBy("2028-09-21"),
      perCoin: reopen,
    },
    cells: windowCells,
    verdict: !fidelityOk ? "FIDELITY FAILED — no result"
      : falsification.some((f) => f.clears) ? `a coin clears §4.22's written falsification: ${falsification.filter((f) => f.clears).map((f) => f.id).join(", ")} — read its cells before anything else`
      : `NO coin clears the bar as written. ${passes} two-window seeded passes (${coinLevel.observed} coin${coinLevel.observed === 1 ? "" : "s"}: ${coinLevel.passers.join(", ") || "none"}) against ${headline.expectedFourTests} expected by chance (per rulebook P = ${perRulebook.map((x) => x.fourTests.pAtLeastObserved).join(" / ")}; coin level ${coinLevel.observed} against ${coinLevel.expectedIndependence}, P = ${coinLevel.pAtLeastObserved})` +
        (falsification.length ? `, and every passer fails the fold test (${falsification.map((f) => `${f.id} ${f.positiveFolds}/${f.scoredFolds}`).join("; ")}; ${FOLDS_NEEDED} positive needed)` : "") +
        `. Across every Kraken-advantaged coin with two windows (§4.22's 18 and these): ${closing.coinLevel.observed} coins against ${closing.coinLevel.expectedIndependence} by chance (P = ${closing.coinLevel.pAtLeastObserved}); fold test ${closingFalsification.filter((f) => f.clears).length} of ${closingFalsification.length} passers`,
    sourceIntegrity: { backtestTsSha256: btHashStart, stableAcrossRun: true },
  };
  await Deno.mkdir(outDir, { recursive: true });
  const path = `${outDir}/kraken3.json`;
  await Deno.writeTextFile(path, JSON.stringify(report, null, 1) + "\n");

  console.log(`funnel: ${JSON.stringify(report.funnel.byStatus)}`);
  for (const x of perRulebook) {
    const f = x.fourTests, h = x.threeTests;
    console.log(`${x.rulebook.padEnd(14)} N ${f.coins}  A ${f.passA}  B ${f.passB}  null ${f.expectedIndependence} (pooled ${f.expectedPooled})  observed ${f.observed} ${f.passers.join(",")}  P=${f.pAtLeastObserved}  | three tests: A ${h.passA} B ${h.passB} null ${h.expectedIndependence} observed ${h.observed} ${h.passers.join(",")}`);
  }
  console.log(`TOTAL four tests: observed ${headline.observedFourTests} vs null ${headline.expectedFourTests} (pooled ${headline.expectedFourTestsPooled}); three tests: ${headline.observedThreeTests} vs ${headline.expectedThreeTests}`);
  console.log(`coin level: N ${coinLevel.coins} A ${coinLevel.passA} B ${coinLevel.passB} null ${coinLevel.expectedIndependence} observed ${coinLevel.observed} ${coinLevel.passers.join(",")} P=${coinLevel.pAtLeastObserved}`);
  console.log(`falsification: ${JSON.stringify(falsification)}`);
  console.log(`closing (18 + this study): ${JSON.stringify(closing.perRulebook.map((x) => ({ rb: x.rulebook, N: x.coins, A: x.passA, B: x.passB, exp: x.expectedIndependence, obs: x.observed, passers: x.passers, P: x.pAtLeastObserved })))} coin level ${JSON.stringify({ N: closing.coinLevel.coins, exp: closing.coinLevel.expectedIndependence, obs: closing.coinLevel.observed, passers: closing.coinLevel.passers, P: closing.coinLevel.pAtLeastObserved })}`);
  console.log(`closing falsification: ${JSON.stringify(closingFalsification)}`);
  console.log(`§4.22's grid, four tests vs three: ${JSON.stringify(closing.fourTestsOn422Grid.map((x) => ({ rb: x.rulebook, four: [x.fourTests.observed, x.fourTests.expectedIndependence, x.fourTests.passers], three: [x.threeTests.observed, x.threeTests.expectedIndependence, x.threeTests.passers] })))}`);
  console.log(`one window: ${JSON.stringify(oneWindow.map((o) => ({ rb: o.rulebook, aOnly: o.aOnly, bOnly: o.bOnly })))}`);
  console.log(`continuity waived: ${waivedCells.length} cells, ${waivedCells.filter((c) => c.pass).length} pass (${waivedCells.filter((c) => c.pass).map((c) => `${c.rulebook}·${c.symbol}·${c.segment}`).join(", ")}); two-window with them: ${JSON.stringify(waivedNull.map((x) => ({ rb: x.rulebook, N: x.coins, exp: x.expectedIndependence, obs: x.observed, passers: x.passers })))}`);
  console.log(`extra windows (C/D): ${JSON.stringify(extraWindows)}`);
  console.log(`gross yardstick: ${JSON.stringify(grossYardstick)}`);
  for (const [k, v] of Object.entries(foldComparators)) console.log(`folds ${k.padEnd(14)} ${v.positive}/${v.scored}  per fold ${v.perFold.map((p) => `${p.positive}/${p.scored}`).join(" ")}`);
  console.log(`gross edge: ${JSON.stringify(gross)}`);
  console.log(`own thirds: ${JSON.stringify(ownThirdsNull.map((o) => ({ rb: o.rulebook, N: o.coins, A: o.passA, B: o.passB, exp: o.expectedIndependence, obs: o.observed, passers: o.passers })))}`);
  console.log(`start invariance: ${invarianceCells - invarianceDiffering}/${invarianceCells}; verdict: ${report.verdict}; wrote ${path} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
