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
//   - A market held from an earlier day and not selected rests only the sells of what it holds, at the rule's prices.
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
/** Its candidate rules: no 48-hour end-date horizon (RW-E's same-day rule only), weather markets out (RW-X's x1). */
export const PM_LP_CANDIDATE: PmCandidateRules = { endHorizon: false, excludeFeeTypes: ["weather_fees"] };

/**
 * Live-prep's quoting rule. RW's `summarize` and `quote` on the book WITHOUT our orders, as `rwQuotes`, at N = RW's
 * `sizeN`; then each side rests a sell of what is held before a buy: the bid (b in the one book) is a SELL of NO at
 * 1 − b while NO is held ≥ N, else a BUY of YES at b; the ask (a) a SELL of YES at a while YES is held ≥ N, else a BUY of
 * NO at 1 − a. A side stops at `PM_LP_INV_CAP` × N of inventory its way, the inventory being YES held less NO held as
 * RW's `net` counts it. With nothing held it is `rwQuotes` exactly (pinned in pm_lp.test.ts), but where the raw touch is
 * at most `PM_LP_TIGHT.maxTicks` ticks wide: there it rests nothing (TB1's skip, Addendum 2).
 */
export const lpQuotes: PmQuoteRule = ({ market, book, held, own }) => {
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
    out.push(held.no >= N - 1e-9 ? { outcome: "no", side: "SELL", price: onTick(1 - bYes, book.tick), size: N } : { outcome: "yes", side: "BUY", price: bYes, size: N });
  }
  if (net > -PM_LP_INV_CAP * N) {
    out.push(held.yes >= N - 1e-9 ? { outcome: "yes", side: "SELL", price: onTick(1 - aNo, book.tick), size: N } : { outcome: "no", side: "BUY", price: aNo, size: N });
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
