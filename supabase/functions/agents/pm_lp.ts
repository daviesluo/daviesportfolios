// "Reward quotes live-prep": the best Polymarket reward strategy the record supports, run through the order path and
// its paper layer as a third instance, beside mini-pool and mid-pool. Davies, 2026-10-04, verbatim:
//
//   以现在知道的所有信息，选出来一个最佳的reward区间+市场+rules等一切最优的策略，不考虑其他一切因素，做出一个策略组合加到测试列表中叫它
//   Reward quotes live-prep，然后你验证后确保一切都没问题后做上线准备
//
// and, the same afternoon: "验证没问题就直接落地TESTING STRATEGIES列表，把mini-pool的检验窗口全关了，目前上线live的最大candidate是这个
// live-prep策略". In English: with everything known now, choose the best reward band, markets and rules, considering
// nothing else; make it a strategy on the testing list called "Reward quotes live-prep", verify it, make sure all is
// well, and prepare it to go live; then: once verified, land it on TESTING STRATEGIES, close mini-pool's check windows;
// live-prep is now the lead candidate to go live.
//
// WHAT IT IS (S2 of the study, `docs/agents/backtests/pmlp/`; reference §4 item 54; its pre-registration
// `reviews/2026-10-04-polymarket-lp-prereg.md`): RW's own quoting rule on RW's own universe, sized to the $400 account.
//   - Universe: every rewarded market of $10 a day and over (RW's floor, no ceiling), N = max(minimum, 5) ≤ 20, Gamma's
//     word that it accepts orders, RW-E's same-day rule and the 48-hour game-start horizon; NOT the 48-hour end-date
//     horizon, and no weather market (Gamma's fee type `weather_fees`, RW-X's x1). No book-quality filter. Markets RW and
//     RW-C quote are not left out: "不考虑其他一切因素" is the basis for that (the pre-registration says what it means).
//   - Selection: once a UTC day, RW's first round on each book (`firstScore`), a formula floor of $2.50 a day, RW's
//     `choose`: ten markets at most, $200 of first quotes.
//   - Quoting (`lpQuotes`): RW's prices (`summarize`, `quote`) at N; each side a SELL of what is held before a BUY (the
//     bid is a SELL of NO at 1 − b while NO is held ≥ N, else a BUY of YES at b; the ask a SELL of YES at a while YES
//     is held ≥ N, else a BUY of NO at 1 − a); a side stops at 5N of inventory its way (RW's 3N held capital that a
//     sell frees); x2's pause after a jump of 15 ¢ in the adjusted mid, for 60 minutes (`pauseAfterJump`).
//   - TB1's skip (Davies, 2026-10-08: "给 live-prep 加上 TB1 的 variant-3 规则：盘口只差 1 tick 时不挂单"; the pre-registration's
//     Addendum 2): in a minute whose raw touch, the book without our orders, is at most one tick wide, nothing rests in
//     that market, buys and sells alike (`PM_LP_TIGHT`, `pmrw_x.ts`'s own `isTight`).
//   - The near-certain side (Davies, 2026-10-09; Addendum 7): a BUY of a token at 0.95 or more rests only while that
//     token's holding at the mark plus the order stays within 8 % of the path's capital (`PM_LP_NEAR_CERTAIN`).
//   - A market held from an earlier day and not selected rests only the sells of what it holds, at the rule's prices.
//   - The reward check (Davies, 2026-10-10: "策略每分钟读的时候都检查奖励配置，避免再次出现这种白挂了并且承担风险并且没奖励的事情";
//     the pre-registration's Addendum 9): every turn, before anything is posted or kept, each market quoted today has its
//     reward programme read again from the CLOB (`PM_LP_REWARD_CHECK`); one whose programme ended, whose rate fell under
//     $10 a day or whose minimum passed N ≤ 20 takes no entry and is worked as a carried market, and the minute's formula
//     uses the programme as read. Polymarket's own word backs it: both sides read not scoring for three live minutes
//     running while the formula scores both, and the market takes no entry for the rest of the UTC day.
//   - Caps: $320 in all and $100 a market (holdings at cost and resting buys); a total stop of −$75 on the fills plus what
//     was paid (live: the readout's payouts; in dry-run: its paper's closed days at R = 0.40); no day stop.
//
// WHERE IT LIVES: the order path (`pm_live.ts`) and the paper layer (`pm_prep.ts`) as they are, given this file's
// instances. `PM_LP_INSTANCE` names its tables (`pm_lp_*`, migration 0091), its lease (`pm-lp`), its band, mid-pool's
// batch read of the books (`bookReplies`) and its rules (`PmLpOptions`); `PREP_LP_INSTANCE` the layer's (`pm_lpprep_*`,
// `pm-lpprep`), which fills the path's own orders, sells included (`classifyLp`, `decideLp`). Every rule above that the
// other instances lack is a branch only this instance's options reach. The account is the one $400 account: the trigger
// of 0091 lets one of the three configs be armed at a time, and only Davies arms one, in the conversation where he
// says go (the design doc's step 8lp).

import { onTick, othersLevels, type PmCandidateRules, type PmIntent, type PmLiveInstance, type PmQuoteRule } from "./pm_live.ts";
import { bookReplies } from "./pm_mid.ts";
import { quote, RW_MIN_RATE, sizeN, summarize } from "./pmrw.ts";
import { isTight } from "./pmrw_x.ts";
import type { PrepInstance } from "./pm_prep.ts";

/** Its band of total daily reward rates: RW's floor ($10, `RW_MIN_RATE`) and no ceiling. */
export const PM_LP_BAND = { floor: RW_MIN_RATE, ceiling: Infinity } as const;
/**
 * A side stops at this many N of inventory its way (RW's is 3). With sells first, inventory is capital a fill frees;
 * on RW's record 5N earned more than 3N and 4N with the same fills per share (the study's round 4), and N ≤ 20
 * (`PM_LIVE_MAX_N`) keeps 5N inside the $100 a market.
 */
export const PM_LP_INV_CAP = 5;
/** The code's ceiling on its per-market cap: 5N at N = 20 is 100 shares, $100 at most. */
export const PM_LP_CAP_MARKET_USD = 100;
/** x2's pause, frozen 2026-09-27: 15 ¢ between two minutes, 60 minutes. */
export const PM_LP_PAUSE = { cents: 15, minutes: 60 } as const;
/**
 * TB1's skip (`reviews/2026-10-07-polymarket-rw-tb1-prereg.md`, arm tb1-skip; adopted for live-prep by Davies on
 * 2026-10-08, the pre-registration's Addendum 2): a market whose raw touch (best ask less best bid of the book without
 * our orders, RW's `summarize`) is at most this many ticks wide rests nothing that minute.
 */
export const PM_LP_TIGHT = { maxTicks: 1 } as const;
/**
 * The near-certain side (Davies, 2026-10-09: "加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值";
 * the pre-registration's Addendum 7; the study `backtests/rwc_opt/results/expensive_limit.txt`): a BUY of a token at
 * `minPrice` or more rests only while that token's holding in the market, at the minute's mark, plus the order at its
 * price stays within `share` of the path's capital (`PmQuoteInput.capital`, its total cap). A share, not dollars, so it
 * follows the capital: 8 % of $320 is $25.60, room for one order of N = 20 at up to 0.99 with up to six shares held. It
 * is the share least short of the best under every weight on a single hit and every estimate of the tail the study read
 * (at most $1.85 a month); lower shares stop the first order and cost reward, higher ones hold more and earn no more.
 */
export const PM_LP_NEAR_CERTAIN = { minPrice: 0.95, share: 0.08 } as const;

/**
 * Whether a BUY of `size` at `price` of a token held `held` and marked `mark` may rest under the near-certain limit with
 * `capital` the path's: a buy under `PM_LP_NEAR_CERTAIN.minPrice` always may; one at or over it while the holding at the
 * mark plus the order stays within `share` × capital. No readable capital, no near-certain buy.
 */
export function nearCertainBuyOk(price: number, size: number, held: number, mark: number, capital: number | undefined): boolean {
  if (price < PM_LP_NEAR_CERTAIN.minPrice - 1e-9) return true;
  const c = Number(capital);
  if (!(Number.isFinite(c) && c > 0)) return false;
  return Math.max(0, held) * Math.max(0, mark) + size * price <= PM_LP_NEAR_CERTAIN.share * c + 1e-9;
}

/**
 * The reward check (`PmLpOptions.rewardCheck`, Addendum 9). `staleMs`: how long the last good read of a programme stands
 * when this turn's read fails (Davies' brief, 2026-10-10: five minutes, then no entry until a read succeeds).
 * `backstopMinutes`: on the live record of 2026-10-09 the five markets whose programme stayed in the universe never had
 * both sides read not scoring, while the formula scored both, for more than 2 minutes running (0xeee73848…, once), and
 * the shortest run that never fires on them is 3 (`backtests/lpcfg/`); the markets whose programme changed ran to 465
 * and more.
 */
export const PM_LP_REWARD_CHECK = { staleMs: 5 * 60e3, backstopMinutes: 3 } as const;

/**
 * Its readout's timing (`PmLpOptions.readout`, Addendum 10; Davies saw "rewards paid $0" and R unchanged after midnight):
 * from 00:05 UTC, yesterday read again every ten minutes while its day total reads nothing, a zero taken as one only
 * from 03:00 UTC. Polymarket pays at 00:00 (docs, Liquidity Rewards: "distributed directly to maker addresses daily at
 * midnight UTC"); on 2026-10-10 the rewards were in the account by 00:05 and the maker rebates between 00:27 and 01:17.
 */
export const PM_LP_READOUT = { fromMs: 5 * 60e3, acceptZeroAfterMs: 3 * 3600e3 } as const;

/** Its candidate rules: no 48-hour end-date horizon (RW-E's same-day rule only), weather markets out (RW-X's x1). */
export const PM_LP_CANDIDATE: PmCandidateRules = { endHorizon: false, excludeFeeTypes: ["weather_fees"] };

/**
 * Live-prep's quoting rule. RW's `summarize` and `quote` on the book WITHOUT our orders, as `rwQuotes`, at N = RW's
 * `sizeN`; then each side rests a sell of what is held before a buy: the bid (b in the one book) is a SELL of NO at
 * 1 − b while NO is held ≥ N, else a BUY of YES at b; the ask (a) a SELL of YES at a while YES is held ≥ N, else a BUY of
 * NO at 1 − a. A side stops at `PM_LP_INV_CAP` × N of inventory its way, the inventory being YES held less NO held as
 * RW's `net` counts it. With nothing held it is `rwQuotes` exactly (pinned in pm_lp.test.ts), but where the raw touch is
 * at most `PM_LP_TIGHT.maxTicks` ticks wide: there it rests nothing (TB1's skip, Addendum 2). A BUY of a near-certain token
 * rests only inside `PM_LP_NEAR_CERTAIN`'s share of the path's capital (`nearCertainBuyOk`, Addendum 7), the token marked
 * at RW's adjusted mid (YES at m, NO at 1 − m); a sell is never limited by it.
 */
export const lpQuotes: PmQuoteRule = ({ market, book, held, own, capital }) => {
  const v = Number(market.max_spread), minSize = Number(market.min_size);
  if (!(v > 0) || !(minSize >= 0)) return [];
  const o = othersLevels(book.levels, own ?? []);
  const row = summarize(o.bids, o.asks, v, minSize);
  if (isTight(row, Number(book.tick), PM_LP_TIGHT.maxTicks)) return [];
  const q = row ? quote(row, Number(book.tick)) : null;
  if (!q) return [];
  const N = sizeN(minSize), net = held.yes - held.no, out: PmIntent[] = [];
  const bYes = onTick(q.b, book.tick), aNo = onTick(1 - q.a, book.tick);
  if (net < PM_LP_INV_CAP * N) {
    if (held.no >= N - 1e-9) out.push({ outcome: "no", side: "SELL", price: onTick(1 - bYes, book.tick), size: N });
    else if (nearCertainBuyOk(bYes, N, held.yes, q.m, capital)) out.push({ outcome: "yes", side: "BUY", price: bYes, size: N });
  }
  if (net > -PM_LP_INV_CAP * N) {
    if (held.yes >= N - 1e-9) out.push({ outcome: "yes", side: "SELL", price: onTick(1 - aNo, book.tick), size: N });
    else if (nearCertainBuyOk(aNo, N, held.no, 1 - q.m, capital)) out.push({ outcome: "no", side: "BUY", price: aNo, size: N });
  }
  return out;
};

/** "Reward quotes live-prep"'s order path: its tables (0091), its lease, its band and its rules. */
export const PM_LP_INSTANCE: PmLiveInstance = {
  name: "Reward quotes live-prep",
  tables: {
    config: "pm_lp_config", markets: "pm_lp_markets", orders: "pm_lp_orders", fills: "pm_lp_fills", events: "pm_lp_events", state: "pm_lp_state",
    minutes: "pm_lp_minutes", rewardDays: "pm_lp_reward_days", settlements: "pm_lp_settlements",
  },
  lock: "pm-lp",
  band: { ...PM_LP_BAND },
  migrations: { tables: "0091", selection: "0091" },
  // About 1,400 markets of $10 and over (1,379 on the listing of 2026-10-04 15:21 UTC with N ≤ 20): one POST a hundred
  // books, as mid-pool reads its thousand, so the selection stays inside an Edge request's CPU.
  bookBatch: bookReplies,
  // It is the candidate to go live: its readout reads what the account was paid, as mini-pool's always has.
  readsPayouts: true,
  action: "pmlp",
  path: "agents?action=pmlp&forceFunctionRegion=eu-west-1",
  errorKind: "agents.pm_lp",
  lp: {
    rule: lpQuotes,
    candidate: PM_LP_CANDIDATE,
    capMarketCeiling: PM_LP_CAP_MARKET_USD,
    pause: PM_LP_PAUSE,
    rewardCheck: { ...PM_LP_REWARD_CHECK },
    readout: { ...PM_LP_READOUT },
    paper: { fills: "pm_lpprep_fills", settlements: "pm_lpprep_settlements", days: "pm_lpprep_days" },
  },
};

/** Its paper layer: the tables it writes (0091), the path's it reads, its lease, and the sells it fills (`lp`). */
export const PREP_LP_INSTANCE: PrepInstance = {
  name: "Reward quotes live-prep",
  tables: {
    state: "pm_lpprep_state", minutes: "pm_lpprep_minutes", prints: "pm_lpprep_prints", fills: "pm_lpprep_fills", days: "pm_lpprep_days",
    settlements: "pm_lpprep_settlements", events: "pm_lpprep_events",
  },
  reads: { config: "pm_lp_config", markets: "pm_lp_markets", minutes: "pm_lp_minutes", orders: "pm_lp_orders" },
  lock: "pm-lpprep",
  migration: "0091",
  lp: true,
};
