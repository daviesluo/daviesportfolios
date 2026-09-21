// The KRAKEN study: the allocation study (reference §3.11) asked whether
// Kraken should run the SAME rules as Revolut X and answered no. This asks
// the different question — **is there a rulebook, a holding period, a coin
// or a fee tier at which Kraken earns its place on its own terms?** A
// study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest_kraken.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Writes `<out>/kraken.json` (distilled numbers only). `latest.json`,
// `summary.json`, `allocation.json`, `portfolio.json` and every other
// study's output are NOT touched.
//
// ── why this study exists ─────────────────────────────────────────────
//
// Two operational blockers went away on 2026-09-21: the Kraken account
// holds USD rather than GBP, and the key carries a nonce window (§2b,
// §4.18). Kraken CAN now trade. What is left is the arithmetic. A Kraken
// round trip is 80 bps of maker fee plus two half-spreads — 80.01 bps on
// BTC, 95.93 on POL — against Revolut X's 19.50–53.52, and it is paid back
// only after ~9.7 days at a 30 %-a-year drift where the rules that run hold
// 0.6–3.4 days (§3.11 question 3). The allocation study stopped there,
// having priced only the rules that already exist. Three ways out of that
// arithmetic remain untested, and this study tests all three:
//
//   1. a SLOWER rulebook — fewer round trips, longer holds, so 80 bps is
//      spread over weeks instead of days (§3.6 went the other way and found
//      nothing below four hours survives 20 bps; §3.9 rejected weekly bars
//      for the 4-hour rule's parameters, on one or two trades a year);
//   2. a BIGGER per-trade move — the distribution of gross round trips, not
//      its median and mean, because a rule whose 60th-percentile trade
//      clears 96 bps is a different proposition from one whose 90th does;
//   3. a CHEAPER fee — tier 2 is 0.30 / 0.60 at $2,500 of 30-day volume
//      (§2b), and the question is whether any configuration this account
//      can run generates that much;
//   and one more the allocation study could not reach:
//   4. a COIN Revolut X's UK book cannot carry (§4.16), which needed
//      Kraken's 24-hour book measured — done here, for all 27 coins.
//
// ── what is imported, and what is copied ──────────────────────────────
//
// `backtest.ts`'s `run`, `runRotation`, `resample`, `COSTS`,
// `SHIPPED_STOPS`, `stopsForKind` and `spreadOf`, and the live rulebooks and
// indicators in `_shared/agents_strategy.ts`, are IMPORTED, never
// re-implemented — so every candidate below is charged the same fee, filled
// at the same touch, stopped by the same floor and trail read against each
// bar's low, and held back by the same two-bar cooldown as the rows the loop
// actually runs. `run` carries `barHours`, so the trend rulebook on DAILY
// and WEEKLY bars, and the rotation rulebook at any lookback, need no copy
// at all: they are the shipped functions with different arguments.
//
// One thing `run` cannot express is a rulebook that is not one of its
// `kind`s — the Donchian channels and the long-lookback momentum rule — and
// one thing it does not record is the per-TRADE log that question 2 reads.
// Both live in `runLogged`, COPIED FROM `run` LINE BY LINE the way
// `backtest_ideas.ts` and `backtest_allocation.ts` copy it: the entry and
// rule exit at the next bar's open ± the half-spread paying `fillFee`; the
// floor under average cost and the ATR trail from the high since entry, read
// against the next bar's low and filled at the level (or the open when the
// bar gaps through it); the high-water mark advanced by each bar's high; the
// cooldown after ANY exit; and the same return, drawdown, trade-count,
// exposure and day arithmetic. With the shipped decider it must reproduce
// `run` to the digit, and the report's `fidelity` block is the proof rather
// than the claim.
//
// Helpers that do arithmetic on OUTPUTS rather than on fills — `dailyMarks`,
// `dailyReturns`, `dailyOpen`, `combine`, `median`, `plateauOf`, `barTests`,
// `pick`, `score` — are copied from `backtest_portfolio.ts` /
// `backtest_allocation.ts`, which do not export them; `quantile`, `mean` and
// `roundTripBps` are new here. None of them touches a price, a fee or a fill.
//
// ── method, identical to §3.3a / §3.7 / §3.8 / §3.10 / §3.11 ──────────
//
//   * three years of Coinbase hourly candles → 4h / daily / weekly bars;
//   * TWO walk-forward windows, both reported, NEVER averaged:
//       A — parameters on the first two thirds, the LAST third out of
//           sample (2025-09 → 2026-09, a bear year);
//       B — parameters on the first third, the MIDDLE third out of sample
//           (2024-09 → 2025-09, a bull year);
//     each coin split on its OWN bar count, as §3.7 / §3.8 / §3.11 split it;
//   * parameters are chosen ONCE, in sample, on Revolut X costs by return
//     over drawdown — `backtest.ts`'s own rule — and the chosen rule is then
//     priced on BOTH venues, so the two figures differ by costs alone;
//   * the PLATEAU is the whole grid run out of sample, on each venue's own
//     costs: the share of it positive. An edge has neighbours, a fit does
//     not, and a plateau on Revolut X costs is not a plateau on Kraken's;
//   * the BAR is §4.15's, written before the numbers, applied here from
//     KRAKEN's point of view as §4.16 requires for a single-venue coin:
//     positive out of sample on Kraken costs, drawdown < 35 %, at least half
//     the grid positive out of sample on Kraken costs, positive on the other
//     venue's costs — on BOTH windows — and a book on Kraken of at least
//     $100k a day. Every candidate is stated as cleared or not.
//
// ── the stop is a row parameter, and a slow rule needs its own ────────
//
// `tick.ts` reads `maxLossPct` from the row's own params (`num(s.params
// ?.maxLossPct, 0.08)`) and `atrStop` from its trend params, so a floor and
// a trail are part of a rulebook's definition, not a change to the risk
// layer. §3.9 found weekly bars losing their whole return to an 8 % floor
// "sized for 4-hour bars, hit intra-bar almost by construction", so every
// slow rulebook here carries the floor in its grid (8 % and 20 %) and the
// report says what the floor did to the chosen point. `reentryBars` is NOT
// a row parameter — it is `REENTRY_BARS` in `tick.ts`, two bars of the
// rule's own bar — so it is fixed at two everywhere here.
//
// ── what is measured rather than assumed ──────────────────────────────
//
// `KRAKEN_BOOK` below is a real measurement taken for this study from
// Kraken's PUBLIC, keyless endpoints (`GET /0/public/AssetPairs` and
// `GET /0/public/Ticker`, medians of 11 snapshots 60 s apart): no private
// endpoint was called and no key was touched. It is what lets §4.16's
// $100k-a-day test be applied on Kraken for the first time — the allocation
// study could not apply it to any coin but the three majors. The half-
// spreads the backtests charge are still `COSTS`' (reference §3.8's medians
// of 21 samples), so this study's fills are comparable with every other
// study's; the spreads measured here sit beside them as a check.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, priorRange, ruleFor,
  type Action, type Candle, type Position, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, runRotation, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v] (Coinbase)

// ───────────────────────────────────────────────────── facts, not guesses

/**
 * Kraken's public book for every coin in `COSTS`, measured for this study
 * on 2026-09-21 20:47–20:57 UTC: `GET /0/public/AssetPairs` for the pair
 * config and eleven `GET /0/public/Ticker` snapshots 60 s apart for the
 * touch and the rolling 24-hour volume. `spreadBps` is the MEDIAN of the
 * eleven full spreads, `quoteVolUsd` the median of the eleven rolling
 * 24-hour quote volumes (`v[1] × p[1]`). `ordermin` is in base units and
 * `orderminUsd` is it at the median mid — the number that says whether a
 * $20 slot is placeable. `costmin` is Kraken's minimum order value in quote.
 * A coin Kraken does not list against USD is `null`.
 *
 * This is §4.16's liquidity half, which reference §3.11 could not apply to
 * any coin but BTC / ETH / SOL because nothing else had ever been measured.
 */
type KrakenPair = {
  altname: string; spreadBps: number; spreadMinBps: number; spreadMaxBps: number; quoteVolUsd: number;
  ordermin: number; orderminUsd: number; costmin: number;
};
const KRAKEN_BOOK: Record<string, KrakenPair | null> = {
  "BTC/USD": { altname: "XBTUSD", spreadBps: 0.011, spreadMinBps: 0.011, spreadMaxBps: 0.012, quoteVolUsd: 415_926_026, ordermin: 5e-05, orderminUsd: 4.348, costmin: 0.5 },
  "ETH/USD": { altname: "ETHUSD", spreadBps: 0.036, spreadMinBps: 0.036, spreadMaxBps: 0.504, quoteVolUsd: 211_257_776, ordermin: 0.001, orderminUsd: 2.7824, costmin: 0.5 },
  "SOL/USD": { altname: "SOLUSD", spreadBps: 0.84, spreadMinBps: 0.839, spreadMaxBps: 0.843, quoteVolUsd: 89_808_255, ordermin: 0.06, orderminUsd: 7.1409, costmin: 0.5 },
  "XRP/USD": { altname: "XRPUSD", spreadBps: 0.522, spreadMinBps: 0.065, spreadMaxBps: 2.218, quoteVolUsd: 115_479_491, ordermin: 1.65, orderminUsd: 2.5285, costmin: 0.5 },
  "DOGE/USD": { altname: "XDGUSD", spreadBps: 4.587, spreadMinBps: 0.01, spreadMaxBps: 9.286, quoteVolUsd: 26_124_284, ordermin: 50, orderminUsd: 5.0039, costmin: 0.5 },
  "LINK/USD": { altname: "LINKUSD", spreadBps: 3.028, spreadMinBps: 0.008, spreadMaxBps: 5.883, quoteVolUsd: 13_164_095, ordermin: 0.55, orderminUsd: 7.2366, costmin: 0.5 },
  "ADA/USD": { altname: "ADAUSD", spreadBps: 4.309, spreadMinBps: 3.414, spreadMaxBps: 6.119, quoteVolUsd: 15_830_445, ordermin: 20, orderminUsd: 4.9206, costmin: 0.5 },
  "AVAX/USD": { altname: "AVAXUSD", spreadBps: 2.696, spreadMinBps: 0.899, spreadMaxBps: 5.403, quoteVolUsd: 19_643_858, ordermin: 0.5, orderminUsd: 5.5553, costmin: 0.5 },
  "BNB/USD": { altname: "BNBUSD", spreadBps: 0.872, spreadMinBps: 0.497, spreadMaxBps: 1.492, quoteVolUsd: 2_563_680, ordermin: 0.007, orderminUsd: 5.6292, costmin: 0.5 },
  "HYPE/USD": { altname: "HYPEUSD", spreadBps: 1.071, spreadMinBps: 1.069, spreadMaxBps: 3.207, quoteVolUsd: 18_493_063, ordermin: 0.1, orderminUsd: 9.342, costmin: 0.5 },
  "XLM/USD": { altname: "XLMUSD", spreadBps: 3.326, spreadMinBps: 2.393, spreadMaxBps: 5.455, quoteVolUsd: 7_721_199, ordermin: 30, orderminUsd: 6.4296, costmin: 0.5 },
  "UNI/USD": { altname: "UNIUSD", spreadBps: 4.31, spreadMinBps: 2.724, spreadMaxBps: 7.844, quoteVolUsd: 14_812_551, ordermin: 1.5, orderminUsd: 13.2062, costmin: 0.5 },
  "NEAR/USD": { altname: "NEARUSD", spreadBps: 3.924, spreadMinBps: 0.248, spreadMaxBps: 9.187, quoteVolUsd: 35_996_883, ordermin: 4, orderminUsd: 16.2594, costmin: 0.5 },
  "BCH/USD": { altname: "BCHUSD", spreadBps: 7.47, spreadMinBps: 5.256, spreadMaxBps: 11.198, quoteVolUsd: 3_924_414, ordermin: 0.01, orderminUsd: 2.6735, costmin: 0.5 },
  "LTC/USD": { altname: "LTCUSD", spreadBps: 3.212, spreadMinBps: 1.602, spreadMaxBps: 6.423, quoteVolUsd: 13_486_524, ordermin: 0.1, orderminUsd: 6.24, costmin: 0.5 },
  "SUI/USD": { altname: "SUIUSD", spreadBps: 2.943, spreadMinBps: 0.978, spreadMaxBps: 5.884, quoteVolUsd: 36_150_670, ordermin: 5, orderminUsd: 5.1093, costmin: 0.5 },
  "DOT/USD": { altname: "DOTUSD", spreadBps: 3.377, spreadMinBps: 0.845, spreadMaxBps: 5.93, quoteVolUsd: 1_422_526, ordermin: 3.9, orderminUsd: 4.6143, costmin: 0.5 },
  "HBAR/USD": { altname: "HBARUSD", spreadBps: 4.349, spreadMinBps: 3.259, spreadMaxBps: 4.373, quoteVolUsd: 3_495_175, ordermin: 55, orderminUsd: 5.0562, costmin: 0.5 },
  "TON/USD": { altname: "TONUSD", spreadBps: 6.866, spreadMinBps: 6.866, spreadMaxBps: 13.755, quoteVolUsd: 1_200_158, ordermin: 3.5, orderminUsd: 5.0978, costmin: 0.5 },
  "SHIB/USD": { altname: "SHIBUSD", spreadBps: 3.348, spreadMinBps: 1.677, spreadMaxBps: 6.678, quoteVolUsd: 1_771_678, ordermin: 770000, orderminUsd: 4.6007, costmin: 0.5 },
  "PEPE/USD": { altname: "PEPEUSD", spreadBps: 4.105, spreadMinBps: 4.064, spreadMaxBps: 8.142, quoteVolUsd: 15_044_906, ordermin: 1.5e+06, orderminUsd: 7.3718, costmin: 0.5 },
  "AAVE/USD": { altname: "AAVEUSD", spreadBps: 8.863, spreadMinBps: 4.756, spreadMaxBps: 12.908, quoteVolUsd: 5_518_518, ordermin: 0.05, orderminUsd: 7.352, costmin: 0.5 },
  "ETC/USD": { altname: "ETCUSD", spreadBps: 17.048, spreadMinBps: 15.895, spreadMaxBps: 22.732, quoteVolUsd: 326_847, ordermin: 0.7, orderminUsd: 6.1617, costmin: 0.5 },
  "ALGO/USD": { altname: "ALGOUSD", spreadBps: 6.245, spreadMinBps: 2.676, spreadMaxBps: 9.822, quoteVolUsd: 2_194_523, ordermin: 41, orderminUsd: 4.5992, costmin: 0.5 },
  "ICP/USD": { altname: "ICPUSD", spreadBps: 6.757, spreadMinBps: 6.734, spreadMaxBps: 10.103, quoteVolUsd: 2_156_769, ordermin: 2, orderminUsd: 5.938, costmin: 0.5 },
  "POL/USD": { altname: "POLUSD", spreadBps: 8.963, spreadMinBps: 8.056, spreadMaxBps: 16.992, quoteVolUsd: 2_300_203, ordermin: 50, orderminUsd: 5.5877, costmin: 0.5 },
  "ATOM/USD": { altname: "ATOMUSD", spreadBps: 11.061, spreadMinBps: 7.218, spreadMaxBps: 12.173, quoteVolUsd: 665_938, ordermin: 3.5, orderminUsd: 6.3222, costmin: 0.5 },
};

/**
 * Does Coinbase's series stand in for KRAKEN's price? `backtest.ts`'s header
 * answers that for Revolut X (a median 1.6–2.7 bps over the year both cover)
 * and nothing had ever answered it for Kraken. Measured for this study on
 * 2026-09-21 from `GET /0/public/OHLC?interval=240` — 720 candles is all
 * Kraken serves, so the overlap is the most recent ~710–719 four-hour bars
 * (≈120 days) — against the same bars resampled from this study's Coinbase
 * data: the absolute difference between the two closes, in bps.
 *
 * The majors agree to about a basis point and the alts to 3–6, against a
 * Kraken round trip of 80–96 bps. The substitution costs far less than the
 * thing being measured; the maxima (0.6–3.7 % on AVAX, SUI and NEAR) are
 * single bars where one venue printed a wick the other did not, and they are
 * the reason a single coin's single trade is never the evidence here.
 */
const COINBASE_VS_KRAKEN_4H_BPS: Record<string, { bars: number; medianBps: number; p95Bps: number; maxBps: number }> = {
  "BTC/USD": { bars: 710, medianBps: 0.93, p95Bps: 3.24, maxBps: 17.33 },
  "ETH/USD": { bars: 710, medianBps: 1.09, p95Bps: 4.10, maxBps: 15.96 },
  "SOL/USD": { bars: 710, medianBps: 1.33, p95Bps: 5.48, maxBps: 61.52 },
  "AVAX/USD": { bars: 719, medianBps: 5.33, p95Bps: 17.03, maxBps: 365.29 },
  "SUI/USD": { bars: 719, medianBps: 4.15, p95Bps: 15.29, maxBps: 214.10 },
  "XRP/USD": { bars: 711, medianBps: 1.16, p95Bps: 4.96, maxBps: 31.83 },
  "LINK/USD": { bars: 719, medianBps: 3.42, p95Bps: 12.10, maxBps: 46.38 },
  "NEAR/USD": { bars: 719, medianBps: 6.11, p95Bps: 22.94, maxBps: 219.64 },
};

/**
 * Revolut X UK-book 24 h quote volume, reference §3.8 (medians of 21
 * samples a minute apart, 13:35–13:55 UTC on 2026-09-21). §4.15's liquidity
 * test needs $100k a day; a coin under it on Revolut X may still run on
 * Kraken alone under §4.16, which is the point of question 4.
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

/** `agent_risk` (migration 0037), per venue account and per mode. */
const MAX_ORDER_USD = 20;
const MAX_EXPOSURE_USD_LIVE = 100;

/**
 * Kraken's fee schedule at this account's tier and the next one
 * (reference §2b, `TradeVolume` with `fee-info`, live 2026-09-20): tier 1
 * is 0.40 / 0.80 and tier 2 is 0.30 / 0.60 at $2,500 of 30-day volume;
 * maker reaches 0 % only at $10M. The loop rests post-only on Kraken, so
 * an ordinary round trip pays twice the MAKER fee plus two half-spreads.
 * `krakenT2` is `COSTS.kraken` re-priced at tier 2 and nothing else.
 */
const KRAKEN_TIER2_VOLUME_USD = 2_500;
const COSTS_KRAKEN_T2: Costs = { ...COSTS.kraken, venue: "kraken-tier2", makerBps: 30, takerBps: 60 };

/** The live rows that matter to question 5 (migrations 0037 / 0039 / 0040) and §3.11's recommendation. */
const RECOMMENDED_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"];
const RECOMMENDED_SLOT_USD = 20;

/** The rotation basket the loop runs (`rotation-1d`, `rotation-1w-kraken`). */
const BASKET = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];

// ──────────────────────────────────────────────────────────── the windows

/**
 * The two walk-forward windows of §4.15 on a series of `n` bars. Each coin
 * is split on its OWN bar count, which is how §3.7, §3.8, §3.10 and §3.11
 * split it — a short history therefore gets short thirds, and the report
 * says which coins those are rather than averaging them in.
 */
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

/** One round trip, as the fills happened. `gross` is the raw price move the rule
 *  caught before any spread or fee — what question 2's distribution is made of;
 *  `net` is what the sleeve kept after both. */
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
 * LINE BY LINE — the touch at the next bar's open, the venue's `fillFee`,
 * the floor under average cost, the ATR trail from the high since entry
 * read against the next bar's low, the gap fill at the open, the high-water
 * advance, the two-bar cooldown and the return / drawdown / trade-count /
 * exposure / day arithmetic. The log and the per-bar samples are recording
 * only: with the shipped decider this must BE `run`, and `fidelity` in the
 * report is the check.
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
 * `ruleFor`, the pair `run` itself calls, with `lookbackDays` exposed so the
 * long-lookback momentum rule of question 1 can move the momentum window
 * (`buildSnapshot` takes it; `run` does not pass it). The one difference
 * from `run` is bookkeeping, not arithmetic — the daily closes are pushed
 * onto a growing array instead of `daily.slice(0, dk)` per bar, same
 * contents, no copy. Copied from `backtest_ideas.ts` / `backtest_allocation.ts`,
 * which do not export it.
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

/**
 * A bare Donchian channel: long on a close above the prior `n`-bar high,
 * out on a close below the prior `m`-bar low, no moving-average, momentum or
 * volatility gate. §3.9 tested this at four hours on Revolut X costs and it
 * cleared the bar nowhere; the question here is whether it survives at a
 * daily or weekly cadence where it fires a handful of times a year. Copied
 * from `backtest_ideas.ts`'s idea 2, which does not export it.
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

// ────────────────────────────────── daily arithmetic on outputs (copies)
// (from backtest_portfolio.ts / backtest_allocation.ts, which do not export
//  them; none of these touches a price, a fee or a fill.)

/** The last equity sample of each UTC day — a sleeve's daily mark. */
function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}

/**
 * A sleeve's daily FRACTIONAL returns. Applied to a fixed slot in dollars
 * this is exactly what a live row earns: it re-sizes every entry to the same
 * dollars, so its P&L is the rule's return on a constant notional.
 */
function dailyReturns(equity: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  let prev = 1;
  for (const { day, eq } of dailyMarks(equity)) { out.set(day, prev > 0 ? eq / prev - 1 : 0); prev = eq; }
  return out;
}

/** A day's flag per sleeve: 1 when it held a position at any point that day — what the exposure cap sees. */
function dailyOpen(flags: [number, number][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const [t, f] of flags) {
    const d = Math.floor(t / 86400e3) * 86400e3;
    m.set(d, Math.max(m.get(d) ?? 0, f));
  }
  return m;
}

type Sleeve = {
  id: string; slotUsd: number; exposure: number;
  rets: Map<number, number>; open: Map<number, number>;
  /** Traded notional per $1 of slot over the window, from the trade log. */
  tradedPerSlot: number;
};

type SetStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; p95OpenUsd: number; medianOpenUsd: number;
  /** 30-day traded notional at the p50 rate — what Kraken's fee tier is read off. */
  volumePer30dUsd: number;
};

/**
 * Combine sleeves at their slot sizes: each day's dollar P&L is the sum of
 * slot × that sleeve's fractional return, the equity curve is the capital
 * plus the running total, and the drawdown is read off it. A day a sleeve
 * has no mark for contributes nothing — which is what an idle row
 * contributes. Copied from `backtest_allocation.ts`'s `combine`, with the
 * 30-day volume added because question 3 needs it.
 */
function combine(sleeves: Sleeve[]): SetStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  if (!days.length) {
    return { members: 0, capitalUsd: 0, pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0, days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, peakOpenUsd: 0, p95OpenUsd: 0, medianOpenUsd: 0, volumePer30dUsd: 0 };
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
  const years = spanDays / 365;
  const tradedUsd = sleeves.reduce((a, s) => a + s.tradedPerSlot * s.slotUsd, 0);
  const deployment = capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0;
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: Number(capital.toFixed(2)), pnlUsd: Number((eq - capital).toFixed(2)),
    ret: Number(ret.toFixed(4)), maxDD: Number(maxDD.toFixed(4)), retOverDD: Number((ret / Math.max(0.05, maxDD)).toFixed(2)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: Number(deployment.toFixed(3)), turnoverPerYear: Number((tradedUsd / Math.max(1e-9, capital) / years).toFixed(2)),
    bestDayUsd: Number(best.toFixed(2)), worstDayUsd: Number(worst.toFixed(2)),
    peakOpenUsd: Number(Math.max(...opens).toFixed(2)),
    p95OpenUsd: Number(opens.slice().sort((a, b) => a - b)[Math.floor(opens.length * 0.95)].toFixed(2)),
    medianOpenUsd: Number(median(opens).toFixed(2)),
    volumePer30dUsd: Number((tradedUsd / spanDays * 30).toFixed(2)),
  };
}

// ───────────────────────────────────────────────────────── small arithmetic

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i];
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN; }
function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: Number((s.filter((r) => r > 0).length / s.length).toFixed(3)),
    median: Number(s[Math.floor(s.length / 2)].toFixed(4)),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §3.7 / §4.15's four tests on one segment, from one venue's point of view. */
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

function pick(r: RunResult) {
  return {
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), retOverDD: Number(score(r).toFixed(2)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}
function fmt(r: RunResult) {
  return `${(r.ret * 100).toFixed(1)}% (DD ${(r.maxDD * 100).toFixed(0)}%, ${r.trades} trades)`;
}

// ─────────────────────────────────────────────── the candidate rulebooks

/**
 * A candidate is a bar size, a grid of parameter points, and a way of
 * turning a point into a decision — either one of `run`'s own `kind`s (no
 * copy at all) or a `Decide` through `runLogged`. `slowestLookback` is the
 * number of its own bars the rule needs before it can decide, which is what
 * says whether a window is long enough to mean anything.
 */
type Point = {
  label: string; trend: TrendParams; stops: StopParams;
  /** null → the point runs through `run` with this `kind`; otherwise a decider factory. */
  kind: StrategyKind | null;
  decider?: (symbol: string, bars: Candle[], daily: Candle[]) => Decide;
  lookback: number;
};
type Candidate = { id: string; what: string; barHours: number; grid: Point[] };

function trendPoint(t: Partial<TrendParams>, maxLossPct: number, kind: StrategyKind = "trend-4h"): Point {
  const trend: TrendParams = { ...DEFAULT_TREND, ...t };
  return {
    label: `fast ${trend.fast}/slow ${trend.slow}/break ${trend.breakoutUp}/atr ${trend.atrStop}/floor ${(maxLossPct * 100).toFixed(0)}%`,
    trend, stops: { ...stopsForKind(kind, trend), maxLossPct }, kind,
    lookback: Math.max(trend.slow, trend.breakoutUp) + 1,
  };
}

function CANDIDATES(): Candidate[] {
  const out: Candidate[] = [];

  // The anchor: the shipped 4-hour trend rule on its shipped grid, so every
  // slower candidate is read against the rule that is actually running.
  const shipped: Point[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) {
    shipped.push(trendPoint({ fast, slow, atrStop }, SHIPPED_STOPS.maxLossPct));
  }
  out.push({ id: "trend-4h", what: "the shipped rule, 4h bars, the shipped grid — the anchor everything slower is read against", barHours: 4, grid: shipped });

  // Same rule, same bars, parameters wide enough to hold weeks: the cheapest
  // way to slow a rule down is to make it decide less often, not to make its
  // bar longer.
  const wide: Point[] = [];
  for (const slow of [200, 300]) for (const breakoutUp of [100, 200]) for (const atrStop of [4, 6]) {
    wide.push(trendPoint({ slow, breakoutUp, breakoutDown: Math.round(breakoutUp / 2.75), atrStop }, SHIPPED_STOPS.maxLossPct));
  }
  out.push({ id: "trend-4h-wide", what: "the shipped rule on 4h bars with slow 200/300, breakout 100/200 and a 4/6×ATR trail — same rule, weeks instead of days", barHours: 4, grid: wide });

  // The same rule on DAILY bars — `run` takes `barHours`, so this is the
  // shipped rulebook with a different argument. slow 200 is the 200-day
  // trend the question asks for.
  const d1: Point[] = [];
  for (const fast of [10, 20, 50]) for (const slow of [100, 200]) for (const atrStop of [3, 4, 6]) for (const floor of [0.08, 0.20]) {
    d1.push(trendPoint({ fast, slow, breakoutUp: 55, breakoutDown: 20, atrStop }, floor));
  }
  out.push({ id: "trend-1d", what: "the shipped trend rule on DAILY bars (slow 100/200 — the 200-day trend), floor 8 %/20 %", barHours: 24, grid: d1 });

  // Weekly bars. §3.9 ran the 4-hour rule's shape on weekly bars with
  // fast 4/8, slow 13/26 and found one or two trades a year; this adds the
  // wider floor a weekly bar needs and asks whether the answer changes.
  const w1: Point[] = [];
  for (const fast of [4, 8]) for (const slow of [13, 26]) for (const atrStop of [3, 4, 6]) for (const floor of [0.08, 0.20]) {
    w1.push(trendPoint({ fast, slow, breakoutUp: Math.round(slow / 2), breakoutDown: Math.max(4, Math.round(slow / 5)), atrStop }, floor));
  }
  out.push({ id: "trend-1w", what: "the shipped trend rule on WEEKLY bars (fast 4/8, slow 13/26), floor 8 %/20 % — §3.9's test with a floor a weekly bar can carry", barHours: 168, grid: w1 });

  // A bare Donchian on daily and weekly closes: no MA, momentum or
  // volatility gate. §3.9 rejected it at four hours; a long-lookback
  // version fires a handful of times a year, which is the shape 80 bps
  // needs.
  for (const [id, hours, entries, exits] of [
    ["donchian-1d", 24, [50, 100, 200], [20, 50]] as const,
    ["donchian-1w", 168, [8, 13, 26], [4, 8]] as const,
  ]) {
    const grid: Point[] = [];
    for (const n of entries) for (const m of exits) for (const floor of [0.08, 0.20]) {
      grid.push({
        label: `donchian ${n}/${m}/floor ${(floor * 100).toFixed(0)}%`,
        trend: DEFAULT_TREND, stops: { ...SHIPPED_STOPS, atrStop: null, maxLossPct: floor }, kind: null,
        decider: (_s, bars) => donchian(bars, n, m), lookback: n + 1,
      });
    }
    out.push({ id, what: `a bare Donchian channel on ${hours === 24 ? "daily" : "weekly"} closes — entry ${entries.join("/")}, exit ${exits.join("/")}, no MA / momentum / volatility gate`, barHours: hours, grid });
  }

  // Long-lookback time-series momentum: the shipped `momentum-1d` rulebook
  // with its window moved to 3, 6 and 12 months. `buildSnapshot` takes
  // `lookbackDays` and `run` does not pass it, so this is the one shipped
  // rule that needs the decider callback.
  const mo: Point[] = [];
  for (const lookbackDays of [90, 180, 365]) for (const floor of [0.08, 0.20]) {
    mo.push({
      label: `momentum ${lookbackDays}d/floor ${(floor * 100).toFixed(0)}%`,
      trend: DEFAULT_TREND, stops: { ...SHIPPED_STOPS, atrStop: null, maxLossPct: floor }, kind: null,
      decider: (symbol, bars, daily) => shippedDecider("momentum-1d", symbol, bars, daily, DEFAULT_TREND, 24, lookbackDays),
      lookback: lookbackDays + 1,
    });
  }
  out.push({ id: "momentum-long", what: "the shipped momentum rulebook with a 3 / 6 / 12-month lookback instead of 30 days, floor 8 %/20 %", barHours: 24, grid: mo });

  return out;
}

/** The slow rotation grid — `runRotation` itself, at lookbacks and minimum holds the shipped row does not use. */
function ROTATION_GRID(): RotationParams[] {
  const out: RotationParams[] = [];
  for (const lookbackDays of [60, 90, 180]) for (const topN of [1, 2]) for (const minHoldDays of [30, 60, 90]) {
    out.push({ ...DEFAULT_ROTATION, lookbackDays, topN, minHoldDays });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  // Every coin in COSTS that Kraken lists against USD — question 4's universe,
  // and the only coins whose half-spread has been measured on both venues
  // (`spreadOf` throws on purpose for anything else).
  const ALL_SYMBOLS = Object.keys(COSTS.revx.halfSpread);
  const SYMBOLS = ALL_SYMBOLS.filter((s) => KRAKEN_BOOK[s] != null);

  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[]; weekly: Candle[]; years: number };
  const series: Record<string, Series> = {};
  for (const symbol of SYMBOLS) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    series[symbol] = {
      hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24), weekly: resample(hourly, 168),
      years: Number(((hourly[hourly.length - 1].start - hourly[0].start) / 86400e3 / 365).toFixed(2)),
    };
  }
  console.log(`symbols: ${SYMBOLS.length} of ${ALL_SYMBOLS.length} in COSTS are listed on Kraken against USD (${ALL_SYMBOLS.filter((s) => KRAKEN_BOOK[s] == null).join(", ") || "none missing"})`);

  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    study: "kraken — is there a rulebook, a holding period, a coin or a fee tier at which Kraken earns real money on its own terms?",
    source: "Coinbase Exchange 1h → 4h / 1d / 1w. Two walk-forward windows (A: parameters on the first two thirds, last third out; B: parameters on the first third, middle third out), each coin split on its own bar count. Fills, fees, stops and the two-bar cooldown are backtest.ts's own: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread; tier 2 re-prices that at 30). Parameters are chosen in sample on Revolut X costs and the same rule is then priced on both venues, so the two figures differ by costs alone. The model is not in the backtest.",
    bar: "docs/agents/reference.md §4.15, applied from Kraken's point of view as §4.16 requires for a single-venue coin: positive out of sample on Kraken costs, max drawdown < 35 %, at least half the grid positive out of sample on Kraken costs, positive on the other venue's costs — on BOTH windows — and a Kraken book of at least $100k a day.",
    stopsNote: "tick.ts reads maxLossPct from the row's own params (default 0.08) and atrStop from its trend params, so the floor and the trail are part of a candidate rulebook's definition. reentryBars is the code constant REENTRY_BARS (two bars of the rule's own bar) and is fixed at two everywhere here.",
    caps: { maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLivePerVenue: MAX_EXPOSURE_USD_LIVE, note: "agent_risk caps are per venue account and per mode (§4.8), so a Kraken row's $100 is the Kraken account's own money, not the Revolut X row's" },
    costs: { revx: COSTS.revx, kraken: COSTS.kraken, krakenTier2: COSTS_KRAKEN_T2 },
    krakenBook: KRAKEN_BOOK, ukBookUsdPerDay: UK_BOOK_USD_PER_DAY, minBookUsd: MIN_BOOK_USD,
    coinbaseVsKraken4hBps: COINBASE_VS_KRAKEN_4H_BPS,
    coinbaseVsKrakenMeasured: "GET /0/public/OHLC?interval=240 (720 candles is the ceiling, §2b) against the same bars resampled from this study's Coinbase data, 2026-09-21: |close difference| in bps over the ~710–719 overlapping 4-hour bars.",
    krakenBookMeasured: "GET /0/public/AssetPairs once and GET /0/public/Ticker eleven times, 60 s apart, 2026-09-21 20:47–20:57 UTC. Keyless, read-only, nothing placed. Spread is the median of the eleven full spreads; the book is the median of the eleven rolling 24-hour quote volumes (v[1] × p[1]).",
    historyYears: Object.fromEntries(SYMBOLS.map((s) => [s, series[s].years])),
  };

  // ── fidelity: the copy with the shipped decider IS `run`. Checked. ─────
  const fid = { checks: 0, worstRet: 0, worstDD: 0, worstTrades: 0 };
  for (const symbol of RECOMMENDED_SYMBOLS) {
    const { c4h, daily } = series[symbol];
    for (const w of windowsFor(c4h.length)) {
      for (const [kind, bars, barHours] of [["trend-4h", c4h, 4], ["momentum-1d", daily, 24], ["trend-4h", daily, 24]] as const) {
        for (const costs of [COSTS.revx, COSTS.kraken]) {
          const st = stopsForKind(kind, DEFAULT_TREND);
          const wFrom = Math.min(bars.length - 2, Math.floor(w.oosFrom / (barHours / 4)));
          const wTo = Math.min(bars.length, Math.floor(w.oosTo / (barHours / 4)));
          const a = run(kind, symbol, bars, daily, wFrom, wTo, DEFAULT_TREND, costs, barHours, st);
          const b = runLogged(symbol, bars, wFrom, wTo, DEFAULT_TREND.slow + 1, shippedDecider(kind, symbol, bars, daily, DEFAULT_TREND, barHours), costs, st);
          fid.worstRet = Math.max(fid.worstRet, Math.abs(a.ret - b.ret));
          fid.worstDD = Math.max(fid.worstDD, Math.abs(a.maxDD - b.maxDD));
          fid.worstTrades = Math.max(fid.worstTrades, Math.abs(a.trades - b.trades));
          fid.checks++;
        }
      }
    }
  }
  report.fidelity = {
    ...fid,
    note: "runLogged (the copy that carries the trade log and the per-bar samples) driven by shippedDecider, against backtest.ts's run: five coins × two windows × {trend-4h on 4h bars, momentum-1d on daily bars, the trend rule on daily bars} × both venues' costs. Largest absolute difference in return, drawdown and trade count.",
  };
  console.log(`fidelity: ${fid.checks} checks, worst |Δret| ${fid.worstRet.toExponential(2)}, |ΔmaxDD| ${fid.worstDD.toExponential(2)}, |Δtrades| ${fid.worstTrades}`);

  // ── question 4 first: which coins Kraken's book can carry at all ───────
  const bookRows = ALL_SYMBOLS.map((symbol) => {
    const k = KRAKEN_BOOK[symbol];
    const uk = UK_BOOK_USD_PER_DAY[symbol] ?? null;
    return {
      symbol, listedOnKraken: k != null, altname: k?.altname ?? null,
      krakenBookUsd: k?.quoteVolUsd ?? null, krakenPassesBook: k != null && k.quoteVolUsd >= MIN_BOOK_USD,
      ukBookUsd: uk, ukPassesBook: uk != null && uk >= MIN_BOOK_USD,
      krakenOnlyCandidate: k != null && k.quoteVolUsd >= MIN_BOOK_USD && !(uk != null && uk >= MIN_BOOK_USD),
      measuredSpreadBps: k?.spreadBps ?? null, measuredSpreadMinBps: k?.spreadMinBps ?? null, measuredSpreadMaxBps: k?.spreadMaxBps ?? null,
      costsSpreadBps: symbol in COSTS.kraken.halfSpread ? Number((spreadOf(COSTS.kraken, symbol) * 2 * 1e4).toFixed(3)) : null,
      ordermin: k?.ordermin ?? null, orderminUsd: k?.orderminUsd ?? null, costmin: k?.costmin ?? null,
      slotPlaceable: k != null && k.orderminUsd <= MAX_ORDER_USD && k.costmin <= MAX_ORDER_USD,
      krakenRoundTripBps: symbol in COSTS.kraken.halfSpread ? Number(roundTripBps(COSTS.kraken, symbol).toFixed(2)) : null,
      krakenRoundTripBpsTier2: symbol in COSTS.kraken.halfSpread ? Number(roundTripBps(COSTS_KRAKEN_T2, symbol).toFixed(2)) : null,
      revxRoundTripBps: symbol in COSTS.revx.halfSpread ? Number(roundTripBps(COSTS.revx, symbol).toFixed(2)) : null,
    };
  });
  report.books = bookRows;
  const krakenOnly = bookRows.filter((r) => r.krakenOnlyCandidate).map((r) => r.symbol);
  console.log(`Kraken book ≥ $${MIN_BOOK_USD.toLocaleString()}/day: ${bookRows.filter((r) => r.krakenPassesBook).length}/${bookRows.length}; Kraken-only candidates (UK book under the floor): ${krakenOnly.join(", ") || "none"}`);

  // ── questions 1 and 2: the rulebooks, per coin, both windows, both venues ──

  /** What one parameter point does over one segment on one venue. */
  function runPoint(symbol: string, cand: Candidate, p: Point, from: number, to: number, costs: Costs): LoggedResult | RunResult {
    const s = series[symbol];
    const bars = cand.barHours === 4 ? s.c4h : cand.barHours === 24 ? s.daily : s.weekly;
    if (p.kind && !p.decider) return run(p.kind, symbol, bars, s.daily, from, to, p.trend, costs, cand.barHours, p.stops);
    const decide = p.decider!(symbol, bars, s.daily);
    return runLogged(symbol, bars, from, to, p.lookback, decide, costs, p.stops);
  }
  function barsOf(symbol: string, cand: Candidate): Candle[] {
    const s = series[symbol];
    return cand.barHours === 4 ? s.c4h : cand.barHours === 24 ? s.daily : s.weekly;
  }

  /**
   * A grid point is usable in a window when the out-of-sample segment opens
   * AFTER its warm-up (so it can decide from the window's first bar — the
   * indicators are precomputed over the whole continuous series, so this is
   * a start-index test, not a sample-size one) and the in-sample segment
   * leaves at least 20 of its own bars after that warm-up to choose on.
   * Both halves of a window therefore score the same set of points, which
   * is what makes the plateau share comparable.
   */
  function usablePoints(grid: Point[], w: Window): Point[] {
    return grid.filter((p) => w.oosFrom >= p.lookback && w.isTo >= p.lookback + 20);
  }

  type Cell = {
    candidate: string; symbol: string; window: "A" | "B"; barHours: number;
    bars: number; oosBars: number; gridUsable: number; enoughBars: boolean;
    chosen: string;
    revx: ReturnType<typeof pick>; kraken: ReturnType<typeof pick>; krakenT2: ReturnType<typeof pick>;
    plateauRevx: number; plateauKraken: number; gridMedianKraken: number;
    passKraken: boolean; failedKraken: string[]; passRevx: boolean; failedRevx: string[];
    trades: number; medianHoldDays: number; meanHoldDays: number;
    /** question 2: the gross per-round-trip distribution, before any spread or fee. */
    grossBps: { n: number; mean: number; median: number; p10: number; p25: number; p75: number; p90: number; winRate: number } | null;
    clears: { ownKrakenCost: number; twiceOwnKrakenCost: number; bps96: number; bps192: number; revxCost: number } | null;
    krakenRoundTripBps: number; revxRoundTripBps: number;
    /** traded notional per $1 of slot per year — what question 3's volume is built from. */
    tradedPerSlotPerYear: number;
    floorEffect: { floor8: number; floor20: number } | null;
  };
  /** Every closed round trip's gross move in bps, per cell — pooled per rulebook below, because a
   *  median of per-coin medians on one or two trades a coin is not a distribution. */
  const grossByCandidate: Record<string, number[]> = {};

  const cells: Cell[] = [];
  const candidates = CANDIDATES();
  for (const cand of candidates) {
    const t0 = Date.now();
    for (const symbol of SYMBOLS) {
      const bars = barsOf(symbol, cand);
      const rtK = roundTripBps(COSTS.kraken, symbol), rtR = roundTripBps(COSTS.revx, symbol);
      for (const w of windowsFor(bars.length)) {
        const oosBars = w.oosTo - w.oosFrom;
        const usable = usablePoints(cand.grid, w);
        if (!usable.length) {
          const zero = pick({ ret: 0, maxDD: 0, trades: 0, days: 0, exposure: 0, equity: [], realised: 0, fees: 0 });
          cells.push({
            candidate: cand.id, symbol, window: w.name, barHours: cand.barHours, bars: bars.length, oosBars,
            gridUsable: 0, enoughBars: false,
            chosen: "none — this coin's history is shorter than the rulebook's warm-up",
            revx: zero, kraken: zero, krakenT2: zero,
            plateauRevx: 0, plateauKraken: 0, gridMedianKraken: 0,
            passKraken: false, failedKraken: ["history shorter than the rulebook's warm-up"],
            passRevx: false, failedRevx: ["history shorter than the rulebook's warm-up"],
            trades: 0, medianHoldDays: NaN, meanHoldDays: NaN, grossBps: null, clears: null,
            krakenRoundTripBps: Number(rtK.toFixed(2)), revxRoundTripBps: Number(rtR.toFixed(2)),
            tradedPerSlotPerYear: 0, floorEffect: null,
          });
          continue;
        }
        // The parameters are chosen ONCE, in sample, on Revolut X costs — backtest.ts's own rule.
        let best: Point = usable[0], bestScore = -Infinity;
        for (const p of usable) {
          const sc = score(runPoint(symbol, cand, p, w.isFrom, w.isTo, COSTS.revx));
          if (sc > bestScore) { bestScore = sc; best = p; }
        }
        const oosR = runPoint(symbol, cand, best, w.oosFrom, w.oosTo, COSTS.revx);
        const oosK = runPoint(symbol, cand, best, w.oosFrom, w.oosTo, COSTS.kraken);
        const oosK2 = runPoint(symbol, cand, best, w.oosFrom, w.oosTo, COSTS_KRAKEN_T2);
        const gridR = usable.map((p) => runPoint(symbol, cand, p, w.oosFrom, w.oosTo, COSTS.revx).ret);
        const gridK = usable.map((p) => runPoint(symbol, cand, p, w.oosFrom, w.oosTo, COSTS.kraken).ret);
        const plR = plateauOf(gridR, oosR.ret), plK = plateauOf(gridK, oosK.ret);
        const tk = barTests(oosK.ret, oosK.maxDD, plK.positiveShare, oosR.ret);
        const tr = barTests(oosR.ret, oosR.maxDD, plR.positiveShare, oosK.ret);

        // The trade log on KRAKEN's costs — the venue whose round trip is the question.
        const logged = "tradeLog" in oosK ? oosK as LoggedResult : runLogged(
          symbol, bars, w.oosFrom, w.oosTo, best.lookback,
          shippedDecider(best.kind ?? "trend-4h", symbol, bars, series[symbol].daily, best.trend, cand.barHours), COSTS.kraken, best.stops,
        );
        const tl = logged.tradeLog;
        const gross = tl.map((t) => t.gross * 1e4);   // bps
        const years = Math.max(1e-9, logged.days / 365);
        // A live row re-sizes every entry to a fixed slot: an entry trades one slot and its exit trades
        // one slot grown by the trade's own net return. An open position at the end traded its entry only.
        const tradedPerSlot = tl.reduce((a, t) => a + 2 + t.net, 0) + (logged.trades > tl.length * 2 ? 1 : 0);

        // What the floor did to the chosen point, where the grid carries one.
        let floorEffect: { floor8: number; floor20: number } | null = null;
        if (cand.grid.some((p) => p.stops.maxLossPct === 0.20)) {
          const at = (f: number) => runPoint(symbol, cand, { ...best!, stops: { ...best!.stops, maxLossPct: f } }, w.oosFrom, w.oosTo, COSTS.kraken).ret;
          floorEffect = { floor8: Number(at(0.08).toFixed(4)), floor20: Number(at(0.20).toFixed(4)) };
        }

        cells.push({
          candidate: cand.id, symbol, window: w.name, barHours: cand.barHours, bars: bars.length, oosBars,
          gridUsable: usable.length,
          // A cell counts once the window is at least 52 of the rule's own bars — a year of weekly, two
          // months of daily, nine days of 4-hour. Shorter than that is not a record, it is a coincidence.
          enoughBars: oosBars >= 52,
          chosen: best.label,
          revx: pick(oosR), kraken: pick(oosK), krakenT2: pick(oosK2),
          plateauRevx: plR.positiveShare, plateauKraken: plK.positiveShare, gridMedianKraken: plK.median,
          passKraken: tk.pass, failedKraken: tk.failed, passRevx: tr.pass, failedRevx: tr.failed,
          trades: oosK.trades,
          medianHoldDays: tl.length ? Number((median(tl.map((t) => t.holdBars)) * cand.barHours / 24).toFixed(2)) : NaN,
          meanHoldDays: tl.length ? Number((mean(tl.map((t) => t.holdBars)) * cand.barHours / 24).toFixed(2)) : NaN,
          grossBps: tl.length
            ? {
              n: tl.length, mean: Number(mean(gross).toFixed(1)), median: Number(median(gross).toFixed(1)),
              p10: Number(quantile(gross, 0.10).toFixed(1)), p25: Number(quantile(gross, 0.25).toFixed(1)),
              p75: Number(quantile(gross, 0.75).toFixed(1)), p90: Number(quantile(gross, 0.90).toFixed(1)),
              winRate: Number((gross.filter((g) => g > 0).length / gross.length).toFixed(3)),
            }
            : null,
          clears: tl.length
            ? {
              ownKrakenCost: Number((gross.filter((g) => g > rtK).length / gross.length).toFixed(3)),
              twiceOwnKrakenCost: Number((gross.filter((g) => g > 2 * rtK).length / gross.length).toFixed(3)),
              bps96: Number((gross.filter((g) => g > 96).length / gross.length).toFixed(3)),
              bps192: Number((gross.filter((g) => g > 192).length / gross.length).toFixed(3)),
              revxCost: Number((gross.filter((g) => g > rtR).length / gross.length).toFixed(3)),
            }
            : null,
          krakenRoundTripBps: Number(rtK.toFixed(2)), revxRoundTripBps: Number(rtR.toFixed(2)),
          tradedPerSlotPerYear: Number((tradedPerSlot / years).toFixed(2)),
          floorEffect,
        });
        if (oosBars >= 52) (grossByCandidate[cand.id] ??= []).push(...gross);
      }
    }
    const mine = cells.filter((c) => c.candidate === cand.id && c.enoughBars);
    const inB = new Set(mine.filter((c) => c.passKraken && c.window === "B").map((c) => c.symbol));
    const passBoth = [...new Set(mine.filter((c) => c.passKraken && c.window === "A").map((c) => c.symbol))].filter((s) => inB.has(s));
    console.log(
      `${cand.id.padEnd(15)} ${((Date.now() - t0) / 1000).toFixed(1)}s — median Kraken OOS A ${(median(mine.filter((c) => c.window === "A").map((c) => c.kraken.ret)) * 100).toFixed(1)}% / B ${(median(mine.filter((c) => c.window === "B").map((c) => c.kraken.ret)) * 100).toFixed(1)}%; ` +
      `median hold ${median(mine.map((c) => c.medianHoldDays).filter((x) => !Number.isNaN(x))).toFixed(1)} d; median trades/window ${median(mine.map((c) => c.trades)).toFixed(0)}; ` +
      `clears the bar on Kraken on BOTH windows: ${passBoth.join(", ") || "nothing"}`,
    );
  }
  report.cells = cells;

  // Per candidate, the summary the report's first table is made of.
  report.rulebooks = candidates.map((cand) => {
    const mine = cells.filter((c) => c.candidate === cand.id && c.enoughBars);
    const byWindow = (n: "A" | "B") => mine.filter((c) => c.window === n);
    const bothA = new Set(byWindow("A").filter((c) => c.passKraken).map((c) => c.symbol));
    const bothB = new Set(byWindow("B").filter((c) => c.passKraken).map((c) => c.symbol));
    const bothARevx = new Set(byWindow("A").filter((c) => c.passRevx).map((c) => c.symbol));
    const bothBRevx = new Set(byWindow("B").filter((c) => c.passRevx).map((c) => c.symbol));
    const g = mine.map((c) => c.grossBps).filter((x): x is NonNullable<typeof x> => x != null);
    return {
      id: cand.id, what: cand.what, barHours: cand.barHours, gridPoints: cand.grid.length,
      coinsTested: new Set(mine.map((c) => c.symbol)).size,
      A: {
        medianKrakenRet: Number(median(byWindow("A").map((c) => c.kraken.ret)).toFixed(4)),
        medianRevxRet: Number(median(byWindow("A").map((c) => c.revx.ret)).toFixed(4)),
        medianDD: Number(median(byWindow("A").map((c) => c.kraken.maxDD)).toFixed(4)),
        medianTrades: Number(median(byWindow("A").map((c) => c.trades)).toFixed(1)),
        medianPlateauKraken: Number(median(byWindow("A").map((c) => c.plateauKraken)).toFixed(3)),
        positiveOnKraken: byWindow("A").filter((c) => c.kraken.ret > 0).length,
        coins: byWindow("A").length,
      },
      B: {
        medianKrakenRet: Number(median(byWindow("B").map((c) => c.kraken.ret)).toFixed(4)),
        medianRevxRet: Number(median(byWindow("B").map((c) => c.revx.ret)).toFixed(4)),
        medianDD: Number(median(byWindow("B").map((c) => c.kraken.maxDD)).toFixed(4)),
        medianTrades: Number(median(byWindow("B").map((c) => c.trades)).toFixed(1)),
        medianPlateauKraken: Number(median(byWindow("B").map((c) => c.plateauKraken)).toFixed(3)),
        positiveOnKraken: byWindow("B").filter((c) => c.kraken.ret > 0).length,
        coins: byWindow("B").length,
      },
      medianHoldDays: Number(median(mine.map((c) => c.medianHoldDays).filter((x) => !Number.isNaN(x))).toFixed(2)),
      meanHoldDays: Number(median(mine.map((c) => c.meanHoldDays).filter((x) => !Number.isNaN(x))).toFixed(2)),
      medianGrossBps: Number(median(g.map((x) => x.median)).toFixed(1)),
      meanGrossBps: Number(median(g.map((x) => x.mean)).toFixed(1)),
      medianShareClearingOwnKrakenCost: Number(median(mine.map((c) => c.clears?.ownKrakenCost).filter((x): x is number => x != null)).toFixed(3)),
      medianShareClearing96bps: Number(median(mine.map((c) => c.clears?.bps96).filter((x): x is number => x != null)).toFixed(3)),
      medianShareClearing192bps: Number(median(mine.map((c) => c.clears?.bps192).filter((x): x is number => x != null)).toFixed(3)),
      medianTradedPerSlotPerYear: Number(median(mine.map((c) => c.tradedPerSlotPerYear)).toFixed(2)),
      clearsKrakenBarWindowA: [...bothA], clearsKrakenBarWindowB: [...bothB],
      clearsKrakenBarBothWindows: [...bothA].filter((s) => bothB.has(s)),
      clearsRevxBarBothWindows: [...bothARevx].filter((s) => bothBRevx.has(s)),
      // The control every one of these tables needs: if a coin's two windows were independent draws,
      // the number of coins clearing BOTH is (coins × the share that cleared A × the share that cleared B).
      // A rulebook whose observed both-window count is at or under that number has found nothing.
      expectedBothWindowsByChance: Number((new Set(mine.map((c) => c.symbol)).size
        * (bothA.size / Math.max(1, byWindow("A").length)) * (bothB.size / Math.max(1, byWindow("B").length))).toFixed(2)),
      zeroTradeCells: mine.filter((c) => c.trades === 0).length,
      // Every closed round trip of every coin-window pooled — the distribution question 2 asks for.
      grossPooledBps: (() => {
        const xs = grossByCandidate[cand.id] ?? [];
        if (!xs.length) return null;
        const clears = (t: number) => Number((xs.filter((g) => g > t).length / xs.length).toFixed(3));
        return {
          n: xs.length, mean: Number(mean(xs).toFixed(1)), median: Number(median(xs).toFixed(1)),
          p10: Number(quantile(xs, 0.10).toFixed(1)), p25: Number(quantile(xs, 0.25).toFixed(1)),
          p60: Number(quantile(xs, 0.60).toFixed(1)), p75: Number(quantile(xs, 0.75).toFixed(1)),
          p90: Number(quantile(xs, 0.90).toFixed(1)), p95: Number(quantile(xs, 0.95).toFixed(1)),
          winRate: clears(0), clears96bps: clears(96), clears192bps: clears(192), clears20bps: clears(20),
          // Is "the mean round trip beats a Kraken round trip" knowledge or noise? The standard error of
          // the mean and the t against an 82 bps round trip (the median coin's) say which. A fat-tailed
          // distribution needs many more trades than these rules make for its mean to be estimated.
          sd: Number(Math.sqrt(xs.reduce((a, g) => a + (g - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1)).toFixed(1)),
          seMean: Number((Math.sqrt(xs.reduce((a, g) => a + (g - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1)) / Math.sqrt(xs.length)).toFixed(1)),
          tVsKrakenRoundTrip: Number(((mean(xs) - 82) / (Math.sqrt(xs.reduce((a, g) => a + (g - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1)) / Math.sqrt(xs.length))).toFixed(2)),
          tVsRevxRoundTrip: Number(((mean(xs) - 20) / (Math.sqrt(xs.reduce((a, g) => a + (g - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1)) / Math.sqrt(xs.length))).toFixed(2)),
        };
      })(),
    };
  });

  // ── the slow rotation: `runRotation` itself, longer lookbacks, longer holds ──
  const basketDaily: Record<string, Candle[]> = {};
  const common = BASKET.map((s) => new Set(series[s].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  for (const s of BASKET) basketDaily[s] = series[s].daily.filter((c) => common.has(c.start));
  const nd = basketDaily[BASKET[0]].length;
  const rotStops = stopsForKind("rotation-1d", DEFAULT_TREND);
  const rotation: Record<string, unknown>[] = [];
  for (const w of windowsFor(nd)) {
    let bestP: RotationParams | null = null, bestScore = -Infinity;
    for (const p of ROTATION_GRID()) {
      const r = runRotation(basketDaily, w.isFrom, w.isTo, p, COSTS.revx, rotStops);
      if (score(r) > bestScore) { bestScore = score(r); bestP = p; }
    }
    const oosR = runRotation(basketDaily, w.oosFrom, w.oosTo, bestP!, COSTS.revx, rotStops);
    const oosK = runRotation(basketDaily, w.oosFrom, w.oosTo, bestP!, COSTS.kraken, rotStops);
    const oosK2 = runRotation(basketDaily, w.oosFrom, w.oosTo, bestP!, COSTS_KRAKEN_T2, rotStops);
    const gridK = ROTATION_GRID().map((p) => runRotation(basketDaily, w.oosFrom, w.oosTo, p, COSTS.kraken, rotStops).ret);
    const plK = plateauOf(gridK, oosK.ret);
    const seedK = runRotation(basketDaily, w.oosFrom, w.oosTo, { ...DEFAULT_ROTATION, minHoldDays: 7 }, COSTS.kraken, rotStops);
    const t = barTests(oosK.ret, oosK.maxDD, plK.positiveShare, oosR.ret);
    rotation.push({
      window: w.name, chosen: bestP, basket: BASKET, days: nd,
      revx: pick(oosR), kraken: pick(oosK), krakenT2: pick(oosK2),
      turnoverKraken: Number(oosK.turnover.toFixed(2)), plateauKraken: plK.positiveShare, gridMedianKraken: plK.median,
      shippedKrakenSeed7dHold: pick(seedK), passKraken: t.pass, failedKraken: t.failed,
    });
    console.log(`rotation-slow ${w.name}: chosen ${JSON.stringify(bestP)} — Kraken ${fmt(oosK)} turnover ${oosK.turnover.toFixed(1)}×/y | Revolut X ${fmt(oosR)} | shipped 7-day seed on Kraken ${fmt(seedK)} | clears the bar on Kraken: ${t.pass ? "yes" : "no (" + t.failed.join("; ") + ")"}`);
  }
  report.rotationSlow = rotation;

  // ── question 4, finished: the Kraken-only coins on the parameters a ROW would run ──
  // §4.16 has a single-venue coin joining `trend-4h-kraken` by its own migration, which means it runs
  // that ROW's parameters — the seeded ones — not a set chosen for it. §3.11 made the same distinction
  // about POL and it is what turned a pass into a fail there. Both are reported.
  const krakenOnlySeeded = bookRows.filter((r) => r.krakenOnlyCandidate).map((r) => {
    const symbol = r.symbol;
    const { c4h, daily } = series[symbol];
    const st = stopsForKind("trend-4h", DEFAULT_TREND);
    const per: Record<string, unknown> = { symbol, years: series[symbol].years, krakenBookUsd: r.krakenBookUsd, ukBookUsd: r.ukBookUsd };
    for (const w of windowsFor(c4h.length)) {
      const k = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, st);
      const rx = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, st);
      const grid = usablePoints(candidates.find((c) => c.id === "trend-4h")!.grid, w)
        .map((pt) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, pt.trend, COSTS.kraken, 4, pt.stops).ret);
      const pl = plateauOf(grid, k.ret);
      const t = barTests(k.ret, k.maxDD, pl.positiveShare, rx.ret);
      per[w.name] = { seededKraken: pick(k), seededRevx: pick(rx), plateauKraken: pl.positiveShare, passKraken: t.pass, failedKraken: t.failed };
    }
    return per;
  });
  report.krakenOnlySeeded = {
    note: "The eight coins whose Revolut X UK book is under §4.15's $100k a day but whose Kraken book is not — §4.16's candidates, now that Kraken's book has been measured. Priced on the SEEDED trend-4h parameters, which is what a coin joining `trend-4h-kraken` by migration would run.",
    rows: krakenOnlySeeded,
  };
  for (const r of krakenOnlySeeded) {
    const a = r.A as { seededKraken: { ret: number }; passKraken: boolean }, b = r.B as { seededKraken: { ret: number }; passKraken: boolean };
    console.log(`kraken-only seeded ${String(r.symbol).padEnd(9)} A ${(a.seededKraken.ret * 100).toFixed(1)}% (${a.passKraken ? "clears" : "fails"}) | B ${(b.seededKraken.ret * 100).toFixed(1)}% (${b.passKraken ? "clears" : "fails"})`);
  }

  // ── question 3: the fee tier ──────────────────────────────────────────
  // What 30-day volume does a Kraken row actually generate, and what would
  // it take to reach $2,500? Volume is read off each candidate's own
  // measured turnover at the live slot size.
  const tierRows = candidates.map((cand) => {
    const mine = cells.filter((c) => c.candidate === cand.id && c.enoughBars && RECOMMENDED_SYMBOLS.includes(c.symbol));
    const perSlotPerYear = median(mine.map((c) => c.tradedPerSlotPerYear));
    const vol30dFiveSlots = perSlotPerYear * MAX_ORDER_USD * 5 / 365 * 30;
    return {
      id: cand.id,
      tradedPerSlotPerYear: Number(perSlotPerYear.toFixed(2)),
      volume30dAtFiveTwentyDollarSlots: Number(vol30dFiveSlots.toFixed(2)),
      reachesTier2: vol30dFiveSlots >= KRAKEN_TIER2_VOLUME_USD,
      capitalNeededForTier2Usd: Number((KRAKEN_TIER2_VOLUME_USD / Math.max(1e-9, vol30dFiveSlots) * 100).toFixed(0)),
      turnoverMultipleNeeded: Number((KRAKEN_TIER2_VOLUME_USD / Math.max(1e-9, vol30dFiveSlots)).toFixed(1)),
      feePaidPerYearAtTier1: Number((perSlotPerYear * COSTS.kraken.makerBps / 1e4).toFixed(4)),
      feePaidPerYearAtTier2: Number((perSlotPerYear * COSTS_KRAKEN_T2.makerBps / 1e4).toFixed(4)),
      feePaidPerYearIfTurnoverRaisedToTier2: Number((perSlotPerYear * (KRAKEN_TIER2_VOLUME_USD / Math.max(1e-9, vol30dFiveSlots)) * COSTS_KRAKEN_T2.makerBps / 1e4).toFixed(4)),
    };
  });
  report.feeTier = {
    tier1: { makerBps: COSTS.kraken.makerBps, takerBps: COSTS.kraken.takerBps },
    tier2: { makerBps: COSTS_KRAKEN_T2.makerBps, takerBps: COSTS_KRAKEN_T2.takerBps, needs30dVolumeUsd: KRAKEN_TIER2_VOLUME_USD },
    note: "Volume is traded notional: an entry trades one slot and its exit trades that slot grown by the trade's own net return, which is what a live row (re-sized to a fixed slot every entry) actually sends to the venue. `capitalNeededForTier2Usd` scales the recommended five-$20-slot row until its own turnover reaches $2,500 of 30-day volume; `feePaidPerYearIfTurnoverRaisedToTier2` is what trading that much more costs at the CHEAPER tier, per $1 of slot — the number that says whether reaching a tier by trading more is a strategy or a bill.",
    rows: tierRows,
  };
  for (const r of tierRows) {
    console.log(`fee tier ${r.id.padEnd(15)} 30-day volume on 5×$20 = $${r.volume30dAtFiveTwentyDollarSlots.toFixed(0)} — tier 2 needs $${KRAKEN_TIER2_VOLUME_USD} (${r.turnoverMultipleNeeded}× more, or $${r.capitalNeededForTier2Usd} of capital)`);
  }

  // ── question 5: does anything on Kraken improve the SET? ───────────────
  // The recommended live set is trend-4h · Revolut X · BTC/ETH/SOL/AVAX/SUI,
  // five equal $20 slots. Every candidate addition is priced beside it, with
  // the set ranked by the WORSE of its two windows (ret/DD), the only
  // ranking an all-or-nothing decision can use (§3.11 question 2).
  /** One coin's sleeve: the rule's own daily returns and open-flags, sized at a fixed live slot. */
  function sleeveFor(id: string, symbol: string, cand: Candidate, point: Point, windowName: "A" | "B", costs: Costs, slotUsd: number): Sleeve {
    const bars = barsOf(symbol, cand);
    const s = series[symbol];
    const w = windowsFor(bars.length).find((x) => x.name === windowName)!;
    const decide = point.decider ? point.decider(symbol, bars, s.daily) : shippedDecider(point.kind ?? "trend-4h", symbol, bars, s.daily, point.trend, cand.barHours);
    const r = runLogged(symbol, bars, w.oosFrom, w.oosTo, point.lookback, decide, costs, point.stops);
    return {
      id, slotUsd, exposure: r.exposure,
      rets: dailyReturns(r.equityEveryBar), open: dailyOpen(r.openFlags),
      // Traded notional per $1 of slot over the window: an entry trades one slot, its exit trades that
      // slot grown by the trade's own net return, and a position still open at the end traded its entry.
      tradedPerSlot: r.tradeLog.reduce((a, t) => a + 2 + t.net, 0) + (r.trades > r.tradeLog.length * 2 ? 1 : 0),
    };
  }

  const trendCand = candidates.find((c) => c.id === "trend-4h")!;
  const shippedTrendPoint = trendPoint({}, SHIPPED_STOPS.maxLossPct);   // the seeded parameters the live row runs

  /** A Kraken row as a plan would run it: a rulebook, and per coin the point chosen in sample. */
  type KrakenRow = { candidate: Candidate; label: string; legs: { symbol: string; point: Point }[]; slotUsd: number };
  type Plan = {
    id: string; what: string; A: SetStats; B: SetStats; worse: number;
    needsOrderCapUsd: number; needsExposureCapUsdPerVenue: Record<string, number>;
  };
  const plans: Plan[] = [];

  function planSleeves(windowName: "A" | "B", extra: KrakenRow | null, includeRevx: boolean, extraCosts: Costs = COSTS.kraken): Sleeve[] {
    const out: Sleeve[] = [];
    if (includeRevx) {
      for (const symbol of RECOMMENDED_SYMBOLS) {
        out.push(sleeveFor(`revx·trend-4h·${symbol}`, symbol, trendCand, shippedTrendPoint, windowName, COSTS.revx, RECOMMENDED_SLOT_USD));
      }
    }
    if (extra) {
      for (const leg of extra.legs) {
        out.push(sleeveFor(`${extraCosts.venue}·${extra.candidate.id}·${leg.symbol}`, leg.symbol, extra.candidate, leg.point, windowName, extraCosts, extra.slotUsd));
      }
    }
    return out;
  }

  function pricePlan(id: string, what: string, extra: KrakenRow | null, includeRevx: boolean, extraCosts: Costs = COSTS.kraken): Plan {
    const A = combine(planSleeves("A", extra, includeRevx, extraCosts));
    const B = combine(planSleeves("B", extra, includeRevx, extraCosts));
    const perVenue: Record<string, number> = {};
    if (includeRevx) perVenue.revx = RECOMMENDED_SYMBOLS.length * RECOMMENDED_SLOT_USD;
    if (extra) perVenue[extraCosts.venue] = extra.legs.length * extra.slotUsd;
    return {
      id, what, A, B, worse: Math.min(A.retOverDD, B.retOverDD),
      needsOrderCapUsd: Math.max(RECOMMENDED_SLOT_USD, extra?.slotUsd ?? 0),
      needsExposureCapUsdPerVenue: perVenue,
    };
  }

  plans.push(pricePlan("recommended (nothing on Kraken)", "trend-4h · Revolut X · BTC/ETH/SOL/AVAX/SUI · five equal $20 slots — §3.11's answer, unchanged", null, true));

  // Every candidate that cleared the Kraken bar on BOTH windows on at least one coin is priced as an
  // addition, coin by coin and all together; plus the shipped Kraken twin, so the table shows the line
  // §3.11 already drew. The point a live row would run is the one chosen in sample on window A — the
  // most recent parameters it could have had — and each coin carries its own.
  const krakenRows: KrakenRow[] = [];
  const pointFor = (cand: Candidate, symbol: string): Point | null => {
    const cellA = cells.find((c) => c.candidate === cand.id && c.symbol === symbol && c.window === "A");
    return cellA ? cand.grid.find((p) => p.label === cellA.chosen) ?? null : null;
  };
  for (const cand of candidates) {
    const summary = (report.rulebooks as { id: string; clearsKrakenBarBothWindows: string[] }[]).find((r) => r.id === cand.id)!;
    const clearers = summary.clearsKrakenBarBothWindows;
    if (!clearers.length) continue;
    for (const symbol of clearers) {
      const point = pointFor(cand, symbol);
      if (point) krakenRows.push({ candidate: cand, label: `${cand.id}·${symbol}`, legs: [{ symbol, point }], slotUsd: RECOMMENDED_SLOT_USD });
    }
    if (clearers.length > 1) {
      const legs = clearers.map((symbol) => ({ symbol, point: pointFor(cand, symbol)! })).filter((l) => l.point);
      krakenRows.push({ candidate: cand, label: `${cand.id}·all ${legs.length} clearers`, legs, slotUsd: RECOMMENDED_SLOT_USD });
    }
  }
  krakenRows.push({
    candidate: trendCand, label: "trend-4h-kraken, the shipped twin",
    legs: RECOMMENDED_SYMBOLS.map((symbol) => ({ symbol, point: shippedTrendPoint })), slotUsd: RECOMMENDED_SLOT_USD,
  });

  for (const row of krakenRows) {
    plans.push(pricePlan(`+ ${row.label}`, `the recommended set plus a Kraken row: ${row.candidate.id} on ${row.legs.map((l) => l.symbol).join(", ")} at $${row.slotUsd} a slot`, row, true));
    plans.push(pricePlan(`Kraken alone: ${row.label}`, `the Kraken row on its own, on the Kraken account's own $${row.slotUsd * row.legs.length}`, row, false));
    // THE decisive comparison: the identical rulebook, coins and parameters on the cheaper venue. A coin
    // whose UK book is under §4.15's $100k a day has no Revolut X alternative and is marked as such — that
    // is the only circumstance in which "on Kraken" is a choice rather than a handicap.
    const noUkBook = row.legs.filter((l) => (UK_BOOK_USD_PER_DAY[l.symbol] ?? 0) < MIN_BOOK_USD).map((l) => l.symbol);
    plans.push(pricePlan(
      `+ ${row.label} — BUT ON REVOLUT X${noUkBook.length ? ` (hypothetical: ${noUkBook.join(", ")} under $100k a day on the UK book)` : ""}`,
      `the same rulebook, coins and parameters on Revolut X costs instead of Kraken's — what the Kraken row gives up by being on Kraken`,
      row, true, COSTS.revx,
    ));
  }
  plans.sort((x, y) => y.worse - x.worse);
  report.plans = plans;
  for (const p of plans) {
    console.log(`${p.id.padEnd(38)} A ${(p.A.ret * 100).toFixed(1)}% (DD ${(p.A.maxDD * 100).toFixed(1)}%, ${p.A.retOverDD}) | B ${(p.B.ret * 100).toFixed(1)}% (DD ${(p.B.maxDD * 100).toFixed(1)}%, ${p.B.retOverDD}) | worse ${p.worse.toFixed(2)} | peak open A $${p.A.peakOpenUsd} B $${p.B.peakOpenUsd}`);
  }

  report.runtimeSeconds = Number(((Date.now() - t00) / 1000).toFixed(1));
  await Deno.writeTextFile(`${outDir}/kraken.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/kraken.json in ${report.runtimeSeconds}s`);
}
