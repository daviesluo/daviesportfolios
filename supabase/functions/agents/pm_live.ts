// Polymarket's order path: the executor. Built inert on 2026-10-01 during RW-C (Option 1 of
// docs/agents/reviews/2026-10-01-polymarket-live-prestudy.md, on Davies' word; design
// docs/agents/reviews/2026-10-01-polymarket-order-path.md, migration 0074), and made ready the same day for a LIVE
// CALIBRATION of what Polymarket's liquidity rewards actually pay (docs/agents/reviews/2026-10-01-polymarket-live-
// calibration.md, migration 0076): R = actual rewards / formula rewards for the same quotes, the one thing no paper test
// can show.
//
// WHAT RUNS: every minute, from Supabase's Ireland region (`agents?action=pmlive`). The strategy is RW's quoting rule as
// RW-E applies it (`agents/pmrw.ts`, `agents/pmrw_e.ts`, both frozen and only imported here), on rewarded markets OUTSIDE
// RW's universe: a total daily reward rate of at least $6 and under $10 (RW's universe is $10 and over, so these are
// never RW's or RW-C's markets), ranked each UTC day by RW's own first-round reward per dollar. It is a DRY-RUN until
// Davies says go: the code can send (`PM_ORDER_SENDS_ENABLED` is true and the action loads the signing key), and the
// config row keeps it home (`dry_run` true, `live_confirmed_at` null). Going live is one statement, which also sets the
// total cap from the pUSD balance this path read (`state.pusd`, within five minutes) less the total stop and $5, and
// fails if that balance is unread, stale or too small (0076's header and the design's checklist hold it word for word).
//
// It reads and writes only its own tables (its instance's: `PM_LIVE_TABLES` for the default), the global pause in
// `agent_risk` and its lease. Nothing of RW's or RW-C's (`pm_rw_*`, `pm_rwc_*`) is read.
//
// WHAT IT DOES, each turn, in order:
//   1. The day's markets (`selectMarkets`), once a UTC day, retried every five minutes until one lands: the reward
//      listing read whole (`rewardListing`: its pages concurrently, overlapping, proved complete), the markets in the
//      universe, Gamma's word on each (accepting orders, two tokens, nothing ending or starting within 48 hours, RW-E's
//      same-day rule), each one's book, RW's `firstScore` on it, a floor on the formula reward a day (so a payout can
//      clear Polymarket's $1 minimum), and RW's `choose` within the config's budget and number of markets; an instance
//      with a book-quality rule (mini-pool's, since 2026-10-04) ranks the books that pass it first.
//   2. What the venue says: each market's book (today's, and any held from an earlier day), the geoblock (a good answer
//      kept for ten minutes), the account's closed-only flag and what it holds; in live mode every open order read back
//      by its hash and its trades until CONFIRMED or FAILED.
//   3. The gates (`gates`): the global pause, `live_confirmed_at` (live only), the region, the geoblock's country, the
//      closed-only flag, Davies' Ireland attestation, the inventory read, the loss stops. While any of them stops
//      opening, the path is close-only exactly as RW-NEXT Part 4 words it (`closeOnly`). Since 2026-10-07 the day stop
//      counts only the day's change (`sinceOpenPnl`, Davies: "只算当天变化"): each holding from its mark as the UTC day
//      began, or its cost if bought today, plus the day's realised trades; the total stop counts everything from cost.
//   4. The quotes (`rwQuotes`): RW's bid and ask on the book WITHOUT our own orders, at N = max(the reward minimum, 5),
//      a side stopped at 3N of inventory its way; then close-only, the venue's rules, post-only, the caps, the governor.
//   5. The orders: a slot whose order is right is left alone; one that must change is cancelled and its replacement sent
//      only once the cancel is READ BACK. In live mode every order is written `pending`, keyed by its hash, before the POST.
//      A quote the venue refused goes again only on new information (`refusalWait`), and an order that would take one of
//      our own still in the book is withheld.
//   6. The minute's formula (`minuteFormula`, `pm_live_minutes`): for each market, RW's reward formula on the quotes that
//      rested when the turn read the book, against the book as the venue holds them, with them in it (since 2026-10-04:
//      the venue's size-cutoff midpoint is the whole book's, ours included), and the same formula of what rests after the
//      turn (`detail.after`, the paper layer's reward); in live mode beside whether the venue says each order is scoring,
//      and its live share of the pool.
//   7. Once a UTC day after 01:00, the readout (`pm_live_reward_days`): for the two days before, what the account was
//      paid per market (`/rewards/user`, native and sponsored), its day's total, the maker rebates, and the formula sums
//      of those days' minutes. R is a query: Σ actual / Σ formula over the live rows. A payout is booked only for a
//      market this path's own minutes show it quoting live that day: the account is shared by two paths (2026-10-04).
//
// A TURN'S TIME: it shares the one-minute cron job's batch, so it stays inside its call's 58 s and its 55 s lease. Every
// venue request gives up after 5 s; no selection or readout read starts later than 40 s into the turn and no order is
// sent later than 40 s, and a live order is sent only while the turn still holds its lease, renewed once half of it is
// gone (PR5's executor's rule, `quotes_live.ts`).
//
// INSTANCES (2026-10-02, Davies: "把目前Reward quotes live-prep改名为Reward quotes small-pool，再做一个Reward quotes mid-pool只做
// 10-50，同时也不打扰其他的Reward quotes，也是400美元funded测试"). One path, run as one of two instances (`PmLiveInstance`), the
// way RW's engine runs as RW and RW-C (`RwInstance`, pmrw.ts): an instance is its tables, its lease, its band of daily
// reward rates, the migrations that made it, and an optional exclusion its selection applies. `PM_LIVE_INSTANCE` is the
// path as it ran before instances, name for name ("Reward quotes small-pool": $6 to under $10); a turn given no instance
// runs it, and `pm_instance.test.ts` runs it beside the pre-registered code (`pm_live_frozen.ts`) minute by minute and
// finds every table, request and report the same but the fields the formula of 2026-10-04 makes. The second, mid-pool
// ($10 to under $50; since 0084 the same order path, held in dry-run by its config row), is `PM_MID_INSTANCE` in
// `pm_mid.ts`. Mini-pool's action runs `PM_MINI_INSTANCE` (2026-10-04, Addendum 6 of its pre-registration): the default
// with a book-quality rule its selection applies. Nothing of the rule, the gates, the caps or the stops differs by
// instance, but what one reads of the account's earnings (`readsPayouts`) and where an instance sets `lp`: "Reward
// quotes live-prep" (`PM_LP_INSTANCE`, `pm_lp.ts`, 2026-10-04) is the one that does, with its own rule, candidate rules,
// per-market cap, pause after a jump, exits from markets it carries, its stop, and in dry-run its paper layer's holdings
// in place of the account's (`PmLpOptions`). Every branch it adds runs only for it, so mini-pool and mid-pool make the
// same decisions with or without it (`pm_instance.test.ts`, `pm_mid_formula.test.ts`).

import {
  asTickSize, buildOrder, newSalt, orderProblems, PM_GTD_EARLY_S, PM_ORDER_REGION, type PmBookReply, type PmOpenOrder, type PmOrder, type PmReply,
  type PmRebate, type PmSendReply, type PmSigner, type PmTickSize, type PmTrade, type PmUserEarning, type PmVenue,
} from "../_shared/polymarket_orders.ts";
import type { PmLevel, PmPublicOpts } from "../_shared/polymarket_public.ts";
import { choose, firstScore, othersOf, pyRound, quote, RW_INV_CAP, RW_LEVEL_WINDOW, scoreS, sizeN, summarize, type BookRow } from "./pmrw.ts";
import { excludedByDay } from "./pmrw_e.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;

/** The tables this path owns. It also reads `agent_risk` (the global pause) and holds its lease in `agent_locks`. */
export const PM_LIVE_TABLES = [
  "pm_live_config", "pm_live_markets", "pm_live_orders", "pm_live_fills", "pm_live_events", "pm_live_state", "pm_live_minutes", "pm_live_reward_days",
  "pm_live_settlements",
] as const;
export const PM_LIVE_DB_TABLES: readonly string[] = [...PM_LIVE_TABLES, "agent_risk", "agent_locks"];

// The code's ceilings: a config row may lower each, never raise it.
/**
 * The most the live test may commit, buys' collateral and holdings at cost together: Davies' deposit of about $400
 * (2026-10-01, ~17:00 UTC: "polymarket的策略我决定还是听你的转400美元进去追求最优效果") less the −$75 total stop less a $5
 * margin. The config's cap is set at go time from the balance that arrived (balance − 75 − 5) and only this clamps it:
 * a balance above the $400 he named leaves the cap here, because committing more is a decision of his, not a side
 * effect of loose change. 0074 had $300, the pre-study's figure.
 */
export const PM_LIVE_CAP_TOTAL_USD = 320;
export const PM_LIVE_CAP_MARKET_USD = 60;
export const PM_LIVE_LOSS_DAY_USD = 25;
export const PM_LIVE_LOSS_TOTAL_USD = 75;
export const PM_LIVE_MAX_POSTS_DAY = 6000;
/** The most markets a day the config may ask for. */
export const PM_LIVE_MAX_MARKETS = 12;
/**
 * A GTD order's effective life, in seconds: it is sent with expiration now + 60 + this. The venue refuses an expiration
 * less than 3 minutes ahead, so the floor is 180, not the docs' "about two minutes": an order sent as late as
 * `PM_LIVE_SEND_UNTIL_MS` into its turn, and answered only at its timeout, still reaches the venue with 3 minutes left.
 */
export const PM_LIVE_LIFETIME_S = { min: 180, max: 600 } as const;
/** Each venue request gives up after this long (the action hands it to the client). */
export const PM_LIVE_TIMEOUT_MS = 5e3;
/**
 * No selection or readout read starts later than this into a turn. The reward listing is 39 pages of 500 (19,037 rows on
 * 2026-10-01): one after another it took 30.6 s and 36.6 s from eu-west-1, and 39.7 s from this repository's container;
 * read eight at a time it took 4.1–5.4 s from the container (`rewardListing`).
 */
export const PM_LIVE_SELECT_UNTIL_MS = 40e3;
/** No order is sent later than this into a turn: it reaches the venue with its 3 minutes, and the turn ends inside its lease. */
export const PM_LIVE_SEND_UNTIL_MS = 40e3;
/** A resting order is replaced when less than this is left of its effective life (its expiration less the venue's minute). */
export const PM_LIVE_REFRESH_S = 90;
/** RW's universe is a daily reward rate of $10 and over: this path quotes only below it. */
export const PM_LIVE_REWARD_RATE_MAX = 10;
/**
 * The universe's floor: a total daily rate of at least $6. A pool pays a market's makers at most its rate between them,
 * and the scan of 2026-10-01 (every book from $5 to $10, 4,466 of them) put RW's eight best markets by first-round reward
 * per dollar at $6–$9: the same six chosen with a $5 floor as with this one, from 750 books instead of 4,466.
 */
export const PM_LIVE_REWARD_FLOOR = 6;
/**
 * A market is taken only if RW's first-round formula, on the book read at the selection, pays it at least this a day:
 * Polymarket pays nothing below $1 ("The minimum reward payout is $1"), and at RW's break-even ratio of actual to formula
 * (R ≈ 0.40, the pre-study) $2.50 of formula is that dollar. The docs do not say whether the minimum is per market or per
 * address; this keeps it cleared either way, so a day's payout is never cut to nothing by the minimum.
 */
export const PM_LIVE_MIN_FORMULA_DAY_USD = 2.5;
/**
 * The largest order size a market may need, N = max(its reward minimum, 5): RW's rule stops a side at 3N of inventory,
 * so a market at N = 20 commits at most 3N shares at $1 plus the other side's bid, $60 — the per-market ceiling. At N
 * of 20 the cap is a backstop and never RW's rule; 2,375 of the 2,746 scorable markets from $5 to $10 had N ≤ 20.
 */
export const PM_LIVE_MAX_N = 20;
/**
 * A market whose game starts, or which ends, within this of the selection is passed over: one that resolves while it is
 * selected leaves no book. The first day's standard pick, a China Open match chosen at 05:31 UTC on 2026-10-01, had an
 * `endDate` a week on but a `gameStartTime` of 03:05 that day, and closed at 06:27. It also holds RW-E's rule (a market
 * ending on the day it is quoted is not quoted that day) many times over.
 */
export const PM_LIVE_MIN_HORIZON_MS = 2 * DAY;
/**
 * The reward listing's pages are read this many rows over each other (offsets 0, 480, 960, … for pages of 500): a page
 * that begins inside the one before it proves no row fell between them. The listing moves while it is read: on
 * 2026-10-01, of 38 boundaries per read, up to 16 were 1–4 rows from where they were expected.
 */
export const PM_LISTING_OVERLAP = 20;
/** The listing's pages read at once (Cloudflare allows the CLOB 9,000 requests in 10 s). */
export const PM_LISTING_CONCURRENCY = 8;
const GAMMA_CHUNK = 50, GAMMA_CONCURRENCY = 6, BOOK_CONCURRENCY = 12, REWARD_PAGES = 200, EARNING_PAGES = 20;
const SELECT_RETRY_MS = 5 * M;
/** A good geoblock answer stands for this long when a read fails; past it the gate closes, reported once. */
export const PM_LIVE_GEO_CACHE_MS = 10 * M;
/** The day's readout runs from this far into the UTC day (Polymarket pays at midnight), for the two days before it. */
export const PM_LIVE_READOUT_AFTER_MS = 3600e3;
export const PM_LIVE_READOUT_DAYS = 2;
const READOUT_RETRY_MS = 10 * M;
/** The turn's lease on `agent_locks` (its instance's row: pm-live for the default), as the other minute loops hold theirs. */
export const PM_LIVE_LEASE_MS = 55e3;
/**
 * A cancel the venue took can be carried out a moment AFTER it is answered: on PR5's first live hour (Revolut X,
 * 2026-10-01 16:37 and 16:41 UTC) the read-back straight after the DELETE still showed 3 of 11, then 7 of 11 re-priced
 * orders resting, and every one read back cancelled on the next turn (reference §4 item 35). Polymarket's docs word a
 * cancel's reply as its outcome ("it identifies the orders that were canceled", trading/manage-orders), which suggests
 * the CLOB carries a cancel out before it answers; they say nothing of when `GET /data/order/{id}` shows it. So an order
 * still open on its read-back is read again after each of these pauses, about a second in all, before its slot is
 * frozen; and a freeze is an error only from the turn after the cancel was first asked.
 */
export const PM_LIVE_CANCEL_REREAD_MS = [300, 700] as const;
const PENDING_GRACE_MS = 60e3;
/** Blocked completely, on the frontend and the API (api-reference/geoblock): nothing may be placed from there, not even a sell. */
const OFAC_COUNTRIES = new Set(["IR", "SY", "CU", "KP"]);
const OFAC_REGIONS = new Set(["UA-43", "UA-14", "UA-09"]);

/**
 * An instance's exclusion: given the reward listing its selection has just read whole, the markets its universe must
 * leave out that day, with a note of counts for the selection's record (never a market's id); or why it could not say,
 * which fails the selection like any read that fails (tried again five minutes later): a day is never chosen without it.
 */
export type PmExclusion = (listing: Map<string, PmRewardRow>, ctx: { dl: PmDeadline; nowMs: number; pm?: PmPublicOpts }) =>
  Promise<{ excluded: Set<string>; note: Record<string, unknown> } | { error: string }>;
/** One instance of the path: everything that differs between the two (the header's INSTANCES), and nothing else. */
export type PmLiveInstance = {
  /** The row's name on the Agents page. */
  name: string;
  /** Its nine tables, in 0074's and 0076's shapes. */
  tables: {
    config: string; markets: string; orders: string; fills: string; events: string; state: string; minutes: string; rewardDays: string;
    settlements: string;
  };
  /** Its row of `agent_locks`. */
  lock: string;
  /** The daily reward rates its universe takes: at least `floor`, under `ceiling`. */
  band: { floor: number; ceiling: number };
  /** The migrations that create its tables and its config's selection columns, named in the turn's skip messages. */
  migrations: { tables: string; selection: string };
  /** Applied by its selection once the listing is read; the default has none. */
  exclusion?: PmExclusion;
  /**
   * How its selection reads its candidates' books: all of them at once, each as GET /book serves it (a token with no book
   * absent); the default has none and reads them one GET at a time, twelve at once. For about a thousand candidates a day
   * one GET each cost about a second of CPU in all, half of what an Edge request may use (mid-pool's, pm_mid.ts).
   */
  bookBatch?: (tokens: string[], pm?: PmPublicOpts) => Promise<Map<string, PmBookReply>>;
  /**
   * A book-quality rule its selection applies to every candidate RW's first round scores (`bookQualityOf`): one whose
   * book fails it is passed over, and the ranking takes the next that passes; those it passed over come back, in RW's
   * order, only for the slots and the budget the others leave. Mini-pool's since 2026-10-04 (`PM_MINI_QUALITY`);
   * mid-pool's instance has none.
   */
  bookQuality?: PmBookQualityRule;
  /**
   * Whether it reads what the account earns in dry-run as well: its live share of each pool every minute, and once a day
   * what it was paid. The default does, as it always has. One that does not (mid-pool's) reads them only once it is
   * live: the share in a live turn, and the payouts of a day its own minutes show it quoting live; in dry-run its minutes
   * keep no share and its readout the formula's sums of its own minutes. The account is one and Polymarket pays the
   * account, so every instance books a payout only for a market its own minutes show it quoting live that day
   * (`readout`): what the venue pays for one path's quotes never lands in the other's tables (2026-10-04).
   */
  readsPayouts: boolean;
  /** Its action, its row of `public.edge_calls`, and the kind its faults are reported to `ops_errors` as. */
  action: string;
  path: string;
  errorKind: string;
  /** Live-prep's rules (`PmLpOptions`); absent for every other instance, whose turns it changes in nothing. */
  lp?: PmLpOptions;
  /**
   * The day stop as the pre-registrations froze it: every holding's whole unrealised P&L against its cost counts as the
   * day's (`bookPnl`'s `day`). No action runs an instance with it. Since 2026-10-07 (Davies, asked whether the day stop
   * should count every holding's whole loss or only the day's change: "只算当天变化") the day stop counts the change since
   * 00:00 UTC (`sinceOpenPnl`); the comparisons with the frozen copies (`pm_instance.test.ts`, `pm_mid_formula.test.ts`)
   * set this to run today's code on the frozen rule, and `pm_daystop.test.ts` shows what the change alone does.
   */
  dayStopOnCost?: boolean;
};
/**
 * What a selection's candidate must satisfy beyond the band, the listing and Gamma's word that it accepts orders. With
 * none given (mini-pool, mid-pool) a market ending within 48 hours is passed over and no fee type is.
 */
export type PmCandidateRules = {
  /** Whether a market whose Gamma `endDate` falls within `PM_LIVE_MIN_HORIZON_MS` is passed over (RW-E's same-day rule holds either way). */
  endHorizon: boolean;
  /** Gamma's `feeType` values whose markets are passed over (RW-X's `noCats`: RW's `cat` is that field). */
  excludeFeeTypes: readonly string[];
};
/**
 * "Reward quotes live-prep"'s rules (2026-10-04; `pm_lp.ts`, its pre-registration
 * `reviews/2026-10-04-polymarket-lp-prereg.md`). Only `PM_LP_INSTANCE` sets them.
 */
export type PmLpOptions = {
  /** Its quoting rule (`lpQuotes`): RW's prices, each side a sell of what is held before a buy, 5N of inventory its way. */
  rule: PmQuoteRule;
  /** Its selection's candidate rules: no 48-hour end horizon, weather markets left out. */
  candidate: PmCandidateRules;
  /** The code's ceiling on its config's per-market cap (the default's is `PM_LIVE_CAP_MARKET_USD`). */
  capMarketCeiling: number;
  /**
   * x2's pause, frozen 2026-09-27 (`reviews/2026-09-27-polymarket-rw-variants-prereg.md`, `pmrw_x.ts`'s `armQuotes`):
   * when the rest of the market's adjusted mid moves `cents` or more between two of the turns that read its book, nothing
   * rests in it that minute and the `minutes − 1` after; a further jump starts the pause again (`pauseAfterJump`).
   */
  pause: { cents: number; minutes: number };
  /**
   * Its paper layer's tables (`pm_lpprep_*`), read in dry-run only: the paper's fills and settlements are the holdings
   * the dry-run decides on (the account's are a real account's, which a dry-run never fills), and its closed days the
   * rewards its stop counts at R = 0.40.
   */
  paper: { fills: string; settlements: string; days: string };
};
/**
 * Mini-pool's book-quality rule (Addendum 6 of `reviews/2026-10-01-polymarket-live-prep-prereg.md`, 2026-10-04): books
 * with depth first. Its own record keeps no book's levels, so it was chosen on a keyless sample of its whole universe,
 * every book once a minute for two hours, replayed through this code (`backtests/pmlive/scripts/mini_books.ts`,
 * `mini_books_read.ts`; their output in `results/mini_books_out.txt`), beside that record's market-days.
 */
export const PM_MINI_QUALITY: PmBookQualityRule = { name: "two levels a side holding the reward minimum within 10 ¢ of the touch", levels: 2 };
/** The path as it ran before instances, name for name: "Reward quotes small-pool", $6 to under $10 a day (0074, 0076). */
export const PM_LIVE_INSTANCE: PmLiveInstance = {
  name: "Reward quotes small-pool",
  tables: {
    config: "pm_live_config", markets: "pm_live_markets", orders: "pm_live_orders", fills: "pm_live_fills", events: "pm_live_events", state: "pm_live_state",
    minutes: "pm_live_minutes", rewardDays: "pm_live_reward_days", settlements: "pm_live_settlements",
  },
  lock: "pm-live",
  band: { floor: PM_LIVE_REWARD_FLOOR, ceiling: PM_LIVE_REWARD_RATE_MAX },
  migrations: { tables: "0074", selection: "0076" },
  readsPayouts: true,
  action: "pmlive",
  path: "agents?action=pmlive&forceFunctionRegion=eu-west-1",
  errorKind: "agents.pm_live",
};
/**
 * "Reward quotes mini-pool" from Addendum 6 (2026-10-04): the default instance, its tables, lease, band and everything
 * else, with its selection's book-quality rule (`PM_MINI_QUALITY`). Its action (`runPmLiveAction`) runs it; the default
 * stays the path its pre-registration froze, which `pm_instance.test.ts` runs beside the frozen code.
 */
export const PM_MINI_INSTANCE: PmLiveInstance = { ...PM_LIVE_INSTANCE, bookQuality: PM_MINI_QUALITY };
/** The tables an instance's turn may touch: its own nine, `agent_risk` (read) and `agent_locks` (its lease). */
export const pmLiveDbTables = (inst: PmLiveInstance): readonly string[] => [...Object.values(inst.tables), "agent_risk", "agent_locks"];
/** What live-prep's turn may touch beside those: its paper layer's fills, settlements and days, which its dry-run reads. */
export const pmLpDbTables = (inst: PmLiveInstance): readonly string[] => [...pmLiveDbTables(inst), ...(inst.lp ? Object.values(inst.lp.paper) : [])];

export type PmLiveMode = "dry_run" | "live";
export type PmLiveConfig = {
  dry_run: boolean; live_confirmed_at: string | null; ireland_attested_at: string | null; ireland_until: string | null;
  cap_total_usd: number | string; cap_market_usd: number | string; loss_day_usd: number | string; loss_total_usd: number | string;
  max_posts_day: number | string; gtd_lifetime_s: number | string;
  /** The day's markets at most, and the first-quote capital they may take (0076). */
  max_markets?: number | string; select_budget_usd?: number | string;
};
export type PmMarketRow = {
  day: string; kind: "standard" | "neg_risk"; cond: string; yes_token: string; no_token: string; neg_risk: boolean;
  tick: number | string; min_size: number | string; reward_rate: number | string | null; rank: number; question: string | null;
  /** The reward programme's maximum spread (cents), its N, and RW's first-round reading at the selection (0076). */
  max_spread?: number | string | null; n_size?: number | string | null; per_dollar_day?: number | string | null; capital?: number | string | null;
  formula_day?: number | string | null; end_date?: string | null; game_start?: string | null;
};
export type PmOrderRow = {
  id: number; ts: string; mode: PmLiveMode; cond: string; token: string; outcome: "yes" | "no"; side: "BUY" | "SELL";
  price: number | string; size: number | string; order_type: "GTD"; post_only: boolean; expiration: number | string; neg_risk: boolean;
  hash: string; state: "pending" | "live" | "filled" | "cancelled" | "expired" | "rejected"; size_matched: number | string;
  gate: "open" | "reduce"; reason: string | null; book_seen: unknown; request: unknown; response: unknown;
  cancel_requested_at: string | null; cancel_gate: string | null; cancel_reason: string | null; filled_at: string | null; cancelled_at: string | null;
};
type FillRow = { trade_id: string; hash: string; cond: string; token: string; side: "BUY" | "SELL"; price: number | string; size: number | string; status: string; match_time: string | null };
/** A paper fill as live-prep's dry-run reads its layer's (`pm_lpprep_fills`): the path's booking of it. */
type PaperFillRow = { cond: string; token: string; token_side: "BUY" | "SELL"; token_price: number | string; size: number | string; ts: string };
/** One market's minute as `pm_live_minutes` keeps it: the inputs of RW's formula and its answer. */
export type PmMinuteRow = {
  mode: PmLiveMode; minute: string; cond: string; rate: number; max_spread: number; min_size: number; tick: number;
  bb: number | null; ba: number | null; ab: number | null; aa: number | null; q1: number | null; q2: number | null;
  bid_price: number | null; bid_size: number | null; ask_price: number | null; ask_size: number | null;
  bid_scoring: boolean | null; ask_scoring: boolean | null; ours: number; others: number; formula_usd: number; pct: number | null;
  detail: Record<string, unknown>;
};

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const enc = encodeURIComponent;
const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const dayOf = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);

/** `f` over `items`, at most `n` at a time; it stops taking new items once `stop()` says so. */
async function pool<T>(items: T[], n: number, f: (x: T, i: number) => Promise<void>, stop: () => boolean = () => false): Promise<void> {
  let i = 0;
  const worker = async () => { while (i < items.length && !stop()) { const k = i++; await f(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// ------------------------------------------------------------------ pure rules, each pinned in pm_live.test.ts

/** The config's caps, each at most the code's ceiling; the GTD lifetime inside its bounds; the day's markets and budget. */
export function effectiveLimits(c: PmLiveConfig) {
  const lower = (v: number | string | undefined, ceiling: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, ceiling) : ceiling; };
  const life = Number(c.gtd_lifetime_s);
  const capTotal = lower(c.cap_total_usd, PM_LIVE_CAP_TOTAL_USD);
  return {
    capTotal,
    capMarket: lower(c.cap_market_usd, PM_LIVE_CAP_MARKET_USD),
    lossDay: lower(c.loss_day_usd, PM_LIVE_LOSS_DAY_USD),
    lossTotal: lower(c.loss_total_usd, PM_LIVE_LOSS_TOTAL_USD),
    maxPosts: Math.floor(lower(c.max_posts_day, PM_LIVE_MAX_POSTS_DAY)),
    lifetimeS: Number.isFinite(life) ? Math.min(PM_LIVE_LIFETIME_S.max, Math.max(PM_LIVE_LIFETIME_S.min, Math.floor(life))) : PM_LIVE_LIFETIME_S.min,
    // A missing or unreadable count or budget selects nothing: only a row that names them chooses markets.
    maxMarkets: Math.floor(lower(c.max_markets ?? 0, PM_LIVE_MAX_MARKETS)),
    budget: Math.min(lower(c.select_budget_usd ?? 0, PM_LIVE_CAP_TOTAL_USD), capTotal),
  };
}

/**
 * Live-prep's limits (`PmLpOptions`): `effectiveLimits`, with its own per-market ceiling in place of the default's, and
 * no day stop at all (`lossDay` Infinity, so no day's P&L ever reaches it; its config's day limit is null, which
 * `effectiveLimits` would read as 0). The other instances' are `effectiveLimits` itself, untouched.
 */
export function lpLimits(c: PmLiveConfig, lp: Pick<PmLpOptions, "capMarketCeiling">): ReturnType<typeof effectiveLimits> {
  const n = Number(c.cap_market_usd);
  return { ...effectiveLimits(c), capMarket: Number.isFinite(n) && n >= 0 ? Math.min(n, lp.capMarketCeiling) : lp.capMarketCeiling, lossDay: Infinity };
}

/**
 * Davies' Ireland attestation is current from `ireland_attested_at` until `ireland_until`; with no `ireland_until` it
 * stands (his word, 2026-10-01: until he says otherwise). An unreadable timestamp is no attestation.
 */
export function attestationCurrent(c: Pick<PmLiveConfig, "ireland_attested_at" | "ireland_until">, now: number): boolean {
  const at = c.ireland_attested_at ? Date.parse(c.ireland_attested_at) : NaN;
  if (!Number.isFinite(at) || at > now) return false;
  if (c.ireland_until == null) return true;
  const until = Date.parse(c.ireland_until);
  return Number.isFinite(until) && now < until;
}

export type GateInputs = {
  mode: PmLiveMode; globalPause: boolean; riskReadable: boolean; armed: boolean; sbRegion: string | null;
  geo: { ok: boolean; country: string | null; region: string | null; blocked: boolean | null };
  /** The account's closed-only flag; null when it could not be read. */
  closedOnly: boolean | null;
  attested: boolean; inventoryReadable: boolean; lossDay: boolean; lossTotal: boolean;
};
export type Gates = {
  /** May an order that opens or enlarges a position be placed? */
  open: boolean;
  /** May a sell of tokens held be placed? */
  reduce: boolean;
  /** The global pause: cancel every open order, place nothing. */
  cancelAll: boolean;
  openBlockedBy: string | null;
  reduceBlockedBy: string | null;
  verdicts: Record<string, boolean | null>;
};
/** The order the gates are listed and reported in: the first that fails is the one that decided. */
export const PM_OPEN_GATES = ["global_pause", "risk_readable", "armed", "region", "geoblock", "closed_only", "attestation", "inventory", "loss_day", "loss_total"] as const;

/**
 * Every gate's verdict, and what they allow together. Opening needs all of them. Reducing (a sell of what is held, which
 * the UK's close-only rule and the account's closed-only mode both allow) needs no global pause, the region (every POST
 * leaves from eu-west-1 or not at all), a country the geoblock does not block completely, and the inventory read that
 * sizes it. `armed` is the live switch: in a dry-run it decides nothing, and the dry-run shows what live and armed would
 * send (PR5's dry-run did the same).
 */
export function gates(i: GateInputs): Gates {
  const v: Record<string, boolean | null> = {
    global_pause: !i.globalPause,
    risk_readable: i.riskReadable,
    armed: i.mode === "dry_run" ? null : i.armed,
    region: i.sbRegion === PM_ORDER_REGION,
    // From eu-west-1 the geoblock answered `blocked: true, country IE` (reference §6): it answers for polymarket.com's
    // frontend, where Ireland is close-only, while "the API itself is not restricted". So the gate is the country.
    geoblock: i.geo.ok && i.geo.country === "IE",
    closed_only: i.closedOnly === false,
    attestation: i.attested,
    inventory: i.inventoryReadable,
    loss_day: !i.lossDay,
    loss_total: !i.lossTotal,
  };
  const openBlockedBy = PM_OPEN_GATES.find((k) => v[k] === false) ?? null;
  const country = i.geo.country ?? "", region = i.geo.region ?? "";
  const ofac = i.geo.ok && (OFAC_COUNTRIES.has(country) || OFAC_REGIONS.has(`${country}-${region}`) || OFAC_REGIONS.has(region));
  const reduceBlockedBy = i.globalPause ? "global_pause" : !v.region ? "region" : ofac ? "geoblock" : !i.inventoryReadable ? "inventory" : null;
  return { open: !openBlockedBy, reduce: !reduceBlockedBy, cancelAll: i.globalPause, openBlockedBy, reduceBlockedBy, verdicts: v };
}

/** One market's book, best level first on each side, prices in (0, 1). */
export type PmLevels = { bids: PmLevel[]; asks: PmLevel[] };
/** A book's touch, its levels and the market's trading constraints, as the order path reads them. */
export type PmBookNow = {
  bestBid: number; bestAsk: number; tick: PmTickSize; minSize: number; negRisk: boolean; at: string | null; hash: string | null; levels: PmLevels;
};
/** GET /book as served, reduced to its touch and levels; null unless it is two-sided with both prices inside [tick, 1 − tick]. */
export function bookNow(raw: unknown): PmBookNow | null {
  const b = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!b) return null;
  // The CLOB lists bids low to high and asks high to low (reference §2d): the best of each is found, not assumed.
  const lv = (xs: unknown): PmLevel[] => (Array.isArray(xs) ? xs : [])
    .map((l) => [Number((l as Record<string, unknown>)?.price), Number((l as Record<string, unknown>)?.size)] as PmLevel)
    .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s) && s > 0 && p > 0 && p < 1);
  const bids = lv(b.bids).sort((x, y) => y[0] - x[0]), asks = lv(b.asks).sort((x, y) => x[0] - y[0]);
  const tick = asTickSize(b.tick_size), minSize = Number(b.min_order_size);
  if (!tick || !(minSize > 0) || !bids.length || !asks.length) return null;
  const bestBid = bids[0][0], bestAsk = asks[0][0], t = Number(tick);
  if (!(bestBid < bestAsk) || bestBid < t - 1e-12 || bestAsk > 1 - t + 1e-12) return null;
  const ts = Number(b.timestamp);
  return {
    bestBid, bestAsk, tick, minSize, negRisk: b.neg_risk === true, at: Number.isFinite(ts) && ts > 0 ? iso(ts) : null, hash: typeof b.hash === "string" ? b.hash : null,
    levels: { bids, asks },
  };
}

/** `x` on the tick, as a clean decimal: 1 − 0.53 is 0.47, not 0.47000000000000003. */
export function onTick(x: number, tick: PmTickSize): number {
  const decimals = tick.split(".")[1].length;
  return Number((Math.round(x / Number(tick)) * Number(tick)).toFixed(decimals));
}

/** One order the rule wants resting: on the market's YES or NO token. */
export type PmIntent = { outcome: "yes" | "no"; side: "BUY" | "SELL"; price: number; size: number };
/** One of our orders resting at the venue (or, in a dry-run, recorded as resting): its token, side, price and remaining size. */
export type PmOwnOrder = PmIntent;
export type PmQuoteInput = {
  market: PmMarketRow; book: PmBookNow; held: { yes: number; no: number };
  /** Our orders the book just read contains (live mode: those resting at the venue; a dry-run's are in no book). */
  own?: PmOwnOrder[];
};
/** The pluggable quoting rule: a market's book and holdings in, the orders it wants resting out. */
export type PmQuoteRule = (m: PmQuoteInput) => PmIntent[];

/**
 * Where an order rests in the market's one book, as the YES token's book shows it. A market has one book: its NO book is
 * the YES book's mirror, NO's bids at 1 − YES's asks with the same sizes (verified keylessly on ten markets, 2026-10-01).
 * So a BUY of YES and a SELL of NO are bids; a SELL of YES and a BUY of NO (at p, so 1 − p in YES) are asks.
 */
export function inYesBook(o: Pick<PmOwnOrder, "outcome" | "side" | "price">): { side: "bid" | "ask"; price: number } {
  const price = o.outcome === "yes" ? o.price : Math.round((1 - o.price) * 1e9) / 1e9;
  return { side: (o.outcome === "yes") === (o.side === "BUY") ? "bid" : "ask", price };
}

/** The book as the rest of the market made it: our own resting orders taken out of the levels they sit in. */
export function othersLevels(l: PmLevels, own: PmOwnOrder[] = []): PmLevels {
  const bids = l.bids.map(([p, s]) => [p, s] as PmLevel), asks = l.asks.map(([p, s]) => [p, s] as PmLevel);
  for (const o of own) {
    const at = inYesBook(o), side = at.side === "bid" ? bids : asks;
    const lvl = side.find(([p]) => Math.abs(p - at.price) < 1e-9);
    if (lvl) lvl[1] -= Math.max(0, o.size);
  }
  const keep = (xs: PmLevel[]) => xs.filter(([, s]) => s > 1e-9);
  return { bids: keep(bids), asks: keep(asks) };
}

/**
 * The book as the venue holds it with our orders resting in it, `othersLevels`' inverse: each order added to the level
 * at its price in the one book (a YES bid or a NO sell a bid, a YES sell or a NO bid an ask at 1 − p), best level first.
 * A dry-run's orders are in no book, so the formula puts them here, where the venue would hold them (2026-10-04).
 */
export function withOwnLevels(l: PmLevels, own: PmOwnOrder[] = []): PmLevels {
  const bids = l.bids.map(([p, s]) => [p, s] as PmLevel), asks = l.asks.map(([p, s]) => [p, s] as PmLevel);
  for (const o of own) {
    if (!(o.size > 0)) continue;
    const at = inYesBook(o), side = at.side === "bid" ? bids : asks;
    const lvl = side.find(([p]) => Math.abs(p - at.price) < 1e-9);
    if (lvl) lvl[1] += o.size; else side.push([at.price, o.size]);
  }
  return { bids: bids.sort((x, y) => y[0] - x[0]), asks: asks.sort((x, y) => x[0] - y[0]) };
}

/**
 * The PLACEHOLDER rule the path was built and first dry-run with: join the touch at the market's minimum size, a bid as
 * BUY YES at the best bid and an ask as BUY NO at 1 − the best ask. It is no strategy; the tests of the plumbing use it.
 */
export const placeholderQuotes: PmQuoteRule = ({ book }) => [
  { outcome: "yes", side: "BUY", price: book.bestBid, size: book.minSize },
  { outcome: "no", side: "BUY", price: onTick(1 - book.bestAsk, book.tick), size: book.minSize },
];

/**
 * RW's quoting rule, the path's rule since 2026-10-01: RW's own `summarize` and `quote` on the book WITHOUT our orders
 * (the book RW's paper engine read never held any; with ours in it, a bid a tick above the best would chase itself up a
 * tick a minute), N = RW's `sizeN` of the market's reward minimum, and RW's inventory rule: a side is not quoted while
 * the inventory is RW_INV_CAP × N its way. The bid is a BUY of YES at b; the ask a BUY of NO at 1 − a, which is RW's ask
 * in the one book. The inventory is YES held less NO held: a pair of one each is $1, no exposure, as RW's `net` counts.
 */
export const rwQuotes: PmQuoteRule = ({ market, book, held, own }) => {
  const v = Number(market.max_spread), minSize = Number(market.min_size);
  if (!(v > 0) || !(minSize >= 0)) return [];
  const o = othersLevels(book.levels, own ?? []);
  const row = summarize(o.bids, o.asks, v, minSize);
  const q = row ? quote(row, Number(book.tick)) : null;
  if (!q) return [];
  const N = sizeN(minSize), net = held.yes - held.no, out: PmIntent[] = [];
  if (net < RW_INV_CAP * N) out.push({ outcome: "yes", side: "BUY", price: onTick(q.b, book.tick), size: N });
  if (net > -RW_INV_CAP * N) out.push({ outcome: "no", side: "BUY", price: onTick(1 - q.a, book.tick), size: N });
  return out;
};

/** RW's formula on one minute: the reward a market's pool pays the quotes that rested, against everyone else's. */
export type PmMinuteFormula = {
  /** RW's row of the REST of the market (the book less our orders): what the rule reads, and what the minute records. */
  row: BookRow | null;
  /** The size-cutoff-adjusted midpoint the formula scored against: the venue's, with our resting quotes in its book. */
  m: number | null;
  /** RW's adjusted midpoint of the rest of the market alone (the row's), which the formula used until 2026-10-04. */
  mRw: number | null;
  ours: number; others: number; formula: number;
  bid: { price: number; size: number } | null; ask: { price: number; size: number } | null; qBid: number; qAsk: number;
};

/**
 * The others' scores at the midpoint `m`, exactly as `summarize` scores a book (its q1, q2): the levels of `l` within
 * 10 ¢ of the touch `bb` / `ba` (RW's recorder), each holding at least the minimum, within `v` of `m`, rounded as RW
 * stored them. With the touch and the midpoint `l`'s own, it is `summarize(l)`'s q1 and q2, digit for digit.
 */
export function scoresAt(l: PmLevels, bb: number, ba: number, m: number, v: number, minSize: number): [number, number] {
  let q1 = 0, q2 = 0;
  for (const [p, s] of l.bids) {
    if (p < bb - RW_LEVEL_WINDOW - 1e-9) continue;
    const d = (m - p) * 100;
    if (s >= minSize && 0 <= d && d < v) q1 += ((v - d) / v) ** 2 * s;
  }
  for (const [p, s] of l.asks) {
    if (p > ba + RW_LEVEL_WINDOW + 1e-9) continue;
    const d = (p - m) * 100;
    if (s >= minSize && 0 <= d && d < v) q2 += ((v - d) / v) ** 2 * s;
  }
  return [pyRound(q1, 4), pyRound(q2, 4)];
}

/**
 * RW's reward line (`stepRw`: `rate / 1440 × Q / (Q + others)`) on the quotes as they rested, not as the rule would have
 * placed them, against the book AS THE VENUE HOLDS IT (2026-10-04): the market's one book with our resting quotes in it.
 * Polymarket scores every order "vs the size-cutoff-adjusted midpoint" of the market's book (docs, liquidity rewards),
 * one midpoint for every maker, and ours are in that book at N ≥ the minimum, so where our quotes are the best levels
 * holding the minimum, the venue's midpoint is ours. `levels` is the book as read and `inBook` our orders in it (live:
 * the ones resting at the venue; a dry-run's are in no book): the rest of the market is `levels` less `inBook` (RW's
 * row, the others' scores), and the venue's book is the rest plus `quotes`, so a live book that already holds them is
 * never counted twice. A quote the rest of the market has crossed since it was placed is not resting (the venue would
 * have matched it; the paper layer fills it from the prints): it is neither in that book nor scored. Our score is the
 * smaller side's (RW's `min`), each side's sum over our orders on it at least the reward minimum in size; the others'
 * are `scoresAt` the venue's midpoint. Until 2026-10-04 the midpoint was the rest of the market's alone (`mRw`): in a
 * dry-run whose book had moved since its quotes were placed, it put them outside the spread they would have set live.
 */
export function minuteFormula(p: { rate: number; v: number; minSize: number; levels: PmLevels; inBook: PmOwnOrder[]; quotes: PmOwnOrder[] }): PmMinuteFormula {
  const o = othersLevels(p.levels, p.inBook);
  const row = summarize(o.bids, o.asks, p.v, p.minSize);
  const best = { bid: null as { price: number; size: number } | null, ask: null as { price: number; size: number } | null };
  for (const q of p.quotes) {
    const at = inYesBook(q), cur = best[at.side];
    if (!cur || (at.side === "bid" ? at.price > cur.price : at.price < cur.price)) best[at.side] = { price: at.price, size: q.size };
  }
  const mRw = row && row[2] !== null && row[3] !== null ? (row[2] + row[3]) / 2 : null;
  const oBid = o.bids[0]?.[0] ?? -Infinity, oAsk = o.asks[0]?.[0] ?? Infinity;
  const resting = p.quotes.filter((q) => {
    const at = inYesBook(q);
    return q.size > 0 && (at.side === "bid" ? at.price < oAsk - 1e-9 : at.price > oBid + 1e-9);
  });
  const venue = withOwnLevels(o, resting);
  const vrow = summarize(venue.bids, venue.asks, p.v, p.minSize);
  const none = { row, m: null, mRw, ours: 0, others: 0, formula: 0, bid: best.bid, ask: best.ask, qBid: 0, qAsk: 0 };
  if (!vrow || vrow[2] === null || vrow[3] === null) return none;
  const m = (vrow[2] + vrow[3]) / 2;
  let qBid = 0, qAsk = 0;
  for (const q of resting) {
    if (!(q.size >= p.minSize - 1e-9)) continue;                       // under the size cutoff an order scores nothing
    const at = inYesBook(q);
    const s = scoreS(p.v, (at.side === "bid" ? m - at.price : at.price - m) * 100) * q.size;
    if (at.side === "bid") qBid += s; else qAsk += s;
  }
  const [q1, q2] = scoresAt(o, vrow[0], vrow[1], m, p.v, p.minSize);
  const ours = Math.min(qBid, qAsk), others = othersOf(m, q1, q2);
  const formula = ours > 0 ? p.rate / 1440 * ours / (ours + others) : 0;
  return { row, m, mRw, ours, others, formula, bid: best.bid, ask: best.ask, qBid, qAsk };
}

/**
 * A book-quality rule for a selection: what the rest of the market's book must hold at the selection for a candidate
 * to be taken (mini-pool's, 2026-10-04, Addendum 6 of its pre-registration). `levels`: on each side, at least this many
 * levels holding the reward minimum within RW's 10 ¢ of the touch. `spreadOverV`, when given: with the best of them
 * taken away on either side, the size-cutoff spread (the gap between the best bid and the best ask holding the minimum)
 * at most this many times the reward's maximum spread. `mid`, when given: the size-cutoff midpoint inside this band.
 * Mini-pool's rule is `levels` alone; the other two are the candidates its evidence weighed and passed over
 * (`backtests/pmlive/scripts/mini_books_read.ts` runs every candidate through this one function).
 */
export type PmBookQualityRule = { name: string; levels: number; spreadOverV?: number; mid?: [number, number] };
/**
 * Why a candidate's book fails `rule`, or null when it passes. The book is the rest of the market's (RW's view, our own
 * orders taken out), read at the selection: the sides' levels holding the minimum within 10 ¢ of the touch, as RW's
 * `summarize` keeps them.
 */
export function bookQualityOf(x: { v: number; minSize: number; levels: PmLevels; tick: number }, rule: PmBookQualityRule): string | null {
  const { bids, asks } = x.levels;
  if (!bids.length || !asks.length) return "one-sided";
  const qb = bids.filter(([p, s]) => p >= bids[0][0] - RW_LEVEL_WINDOW - 1e-9 && s >= x.minSize).map(([p]) => p);
  const qa = asks.filter(([p, s]) => p <= asks[0][0] + RW_LEVEL_WINDOW + 1e-9 && s >= x.minSize).map(([p]) => p);
  if (qb.length < rule.levels || qa.length < rule.levels) return "depth";
  const mid = (qb[0] + qa[0]) / 2;
  if (rule.mid && (mid < rule.mid[0] - 1e-9 || mid > rule.mid[1] + 1e-9)) return "mid";
  const k = Math.max(0, rule.levels - 1);
  const worst = Math.max(qa[0] - qb[k], qa[k] - qb[0]) * 100;
  if (rule.spreadOverV !== undefined && worst > rule.spreadOverV * x.v + 1e-9) return "spread";
  return null;
}

/** Down to the size's two decimals, through integers (a binary float like 19.99 × 100 is 1998.9999…). */
const floorSize = (x: number) => Math.floor(Math.round(x * 1e6) / 1e4 + 1e-9) / 100;

/**
 * Close-only, exactly as RW-NEXT Part 4 words it. No buy at all, so every quote that would open or enlarge a position on
 * either side is cancelled. A market may rest only a sell of tokens it holds, for at most what it holds: our bid (a BUY
 * YES at b) becomes a SELL of NO at 1 − b if NO is held, our ask (a BUY NO at 1 − a) a SELL of YES at a if YES is held,
 * and a sell the rule already wanted stays, capped at the holding. A flat market rests nothing. A sell under the
 * market's minimum size cannot be placed and is dropped.
 */
export function closeOnly(intents: PmIntent[], held: { yes: number; no: number }, book: Pick<PmBookNow, "tick" | "minSize">): PmIntent[] {
  const out: PmIntent[] = [];
  const left = { yes: Math.max(0, held.yes), no: Math.max(0, held.no) };
  for (const x of intents) {
    const sell: PmIntent | null = x.side === "SELL" ? x
      : x.outcome === "yes" ? { outcome: "no", side: "SELL", price: onTick(1 - x.price, book.tick), size: x.size }
      : { outcome: "yes", side: "SELL", price: onTick(1 - x.price, book.tick), size: x.size };
    if (out.some((o) => o.outcome === sell.outcome)) continue;                     // one sell per token
    const size = floorSize(Math.min(sell.size, left[sell.outcome]));
    if (!(size > 0) || size < book.minSize) continue;
    left[sell.outcome] -= size;
    out.push({ ...sell, size });
  }
  return out;
}

/** Each market's last adjusted mid and the minute its pause ends (ms), as x2's arm keeps them (`RwxArmState`). */
export type PmPauseState = { lastMid: Record<string, number>; pausedUntil: Record<string, number> };
/**
 * x2's pause, word for word as `pmrw_x.ts`'s `armQuotes` applies it (frozen 2026-09-27): when market `cond`'s adjusted
 * mid `mid` is `cents` or more from the last one recorded, the market is paused from minute `t` (ms) for `minutes`; the
 * mid is recorded whenever there is one; and the market is paused while that end is after `t`. A minute without a mid
 * (a side holding no level of the minimum) starts nothing and records nothing. Mutates `s`; returns whether it is paused.
 */
export function pauseAfterJump(s: PmPauseState, cond: string, t: number, mid: number | null, rule: { cents: number; minutes: number }): boolean {
  if (mid !== null) {
    const prev = s.lastMid[cond];
    if (prev !== undefined && Math.abs(mid - prev) * 100 >= rule.cents - 1e-9) s.pausedUntil[cond] = t + rule.minutes * M;
    s.lastMid[cond] = mid;
  }
  return (s.pausedUntil[cond] ?? 0) > t;
}

/** Would a post-only order at `price` take? A buy at or over the token's best ask, a sell at or under its best bid. */
export function crosses(x: Pick<PmIntent, "outcome" | "side" | "price">, b: Pick<PmBookNow, "bestBid" | "bestAsk">): boolean {
  // The NO book is the YES book's mirror: NO's best bid is 1 − YES's best ask, NO's best ask 1 − YES's best bid.
  const bid = x.outcome === "yes" ? b.bestBid : 1 - b.bestAsk, ask = x.outcome === "yes" ? b.bestAsk : 1 - b.bestBid;
  return x.side === "BUY" ? x.price >= ask - 1e-9 : x.price <= bid + 1e-9;
}

/** One trade's fill of one of our orders. */
export type PmFill = { token: string; side: "BUY" | "SELL"; price: number; size: number; ts: number };
/**
 * Each token's holding from CONFIRMED fills, at its average cost, and the P&L realised by its sells (all of it, and
 * today's). Fills only: a reconstruction of a balance is not a record (the working-with-davies skill).
 */
export function tokenBooks(fills: PmFill[], dayStart: number): Record<string, { held: number; avgCost: number; realised: number; realisedToday: number }> {
  const out: Record<string, { held: number; avgCost: number; realised: number; realisedToday: number }> = {};
  for (const f of [...fills].sort((a, b) => a.ts - b.ts)) {
    const t = (out[f.token] ??= { held: 0, avgCost: 0, realised: 0, realisedToday: 0 });
    if (f.side === "BUY") {
      t.avgCost = t.held + f.size > 0 ? (t.avgCost * t.held + f.price * f.size) / (t.held + f.size) : 0;
      t.held += f.size;
    } else {
      const q = Math.min(t.held, f.size), pnl = q * (f.price - t.avgCost);
      t.realised += pnl;
      if (f.ts >= dayStart) t.realisedToday += pnl;
      t.held = Math.max(0, Number((t.held - f.size).toPrecision(12)));
      if (t.held === 0) t.avgCost = 0;
    }
  }
  return out;
}

/** A market Gamma shows resolved: YES pays `payout`, NO 1 − `payout` (`pm_live_settlements`). */
export type PmSettlement = { cond: string; yes_token: string; no_token: string; payout: number | string; settled_at: string };
/**
 * A settlement as the fills it amounts to: each token sold at its payout, whatever is held, at the moment it settled. So
 * `tokenBooks` realises a resolved market's holding at its payout and holds nothing more of it, as RW's paper settles a
 * market (`accTotal` at `settled`); the tokens left on chain until they are redeemed are capital, not exposure.
 */
export function settlementFills(s: PmSettlement[]): PmFill[] {
  return s.flatMap((x) => {
    const p = Number(x.payout), ts = Date.parse(x.settled_at);
    return [{ token: x.yes_token, side: "SELL" as const, price: p, size: 1e12, ts }, { token: x.no_token, side: "SELL" as const, price: 1 - p, size: 1e12, ts }];
  });
}

/** The day's and the run's P&L: realised plus every holding marked against its cost (all of it counts today: stricter). */
export function bookPnl(books: ReturnType<typeof tokenBooks>, marks: Record<string, number | null>): { day: number; total: number } {
  let day = 0, total = 0;
  for (const [token, t] of Object.entries(books)) {
    const m = marks[token];
    const unrealised = t.held > 0 && m != null ? t.held * (m - t.avgCost) : 0;
    day += t.realisedToday + unrealised;
    total += t.realised + unrealised;
  }
  return { day: Math.round(day * 1e8) / 1e8, total: Math.round(total * 1e8) / 1e8 };
}

/**
 * The day stop's figure since 2026-10-07 (Davies, asked whether the day stop should count every holding's whole loss or
 * only the day's change, chose "只算当天变化"): the book's value now less its value as the UTC day began, plus the day's
 * realised trades. A token held at `dayStart` starts the day at its opening mark (`open`), one bought today at its cost,
 * and a sell today realises against that basis (average cost, as `tokenBooks`); so the figure is today's sells and
 * settlements + what is held now at `marks` − what was held at 00:00 at `open` − today's buys. A token held at 00:00
 * with no opening mark starts at its cost, which counts its whole unrealised P&L today, as `bookPnl` did (stricter);
 * with no opening marks at all this is `bookPnl(tokenBooks(fills, dayStart), marks).day` exactly. The total stop is not
 * this: it keeps counting every holding from its cost, the carried loss included (`bookPnl`'s `total`).
 */
export function sinceOpenPnl(fills: PmFill[], dayStart: number, open: Record<string, number | null | undefined>, marks: Record<string, number | null>): number {
  const out: Record<string, { held: number; cost: number; today: number }> = {};
  let opened = false;
  const openDay = () => {
    opened = true;
    for (const [token, t] of Object.entries(out)) {
      const m = open[token];
      if (t.held > 0 && typeof m === "number" && Number.isFinite(m)) t.cost = m;
    }
  };
  for (const f of [...fills].sort((a, b) => a.ts - b.ts)) {
    if (!opened && f.ts >= dayStart) openDay();
    const t = (out[f.token] ??= { held: 0, cost: 0, today: 0 });
    if (f.side === "BUY") {
      t.cost = t.held + f.size > 0 ? (t.cost * t.held + f.price * f.size) / (t.held + f.size) : 0;
      t.held += f.size;
    } else {
      const q = Math.min(t.held, f.size);
      if (f.ts >= dayStart) t.today += q * (f.price - t.cost);
      t.held = Math.max(0, Number((t.held - f.size).toPrecision(12)));
      if (t.held === 0) t.cost = 0;
    }
  }
  if (!opened) openDay();
  let day = 0;
  for (const [token, t] of Object.entries(out)) {
    const m = marks[token];
    day += t.today + (t.held > 0 && m != null ? t.held * (m - t.cost) : 0);
  }
  return Math.round(day * 1e8) / 1e8;
}

/**
 * The marks the path's book held as the UTC day `day` began (`sinceOpenPnl`'s `open`), kept in its state as `dayOpen`.
 * Once kept for the day, they stand. Otherwise, at the day's first turn: each token's last mark read before 00:00 (the
 * previous turn's, kept as `marks` with `marksAt`), and where there is none, this turn's, the first read of the day. A
 * token held at 00:00 that has neither stays out, and starts the day at its cost. A state that kept no marks at all (the
 * first turn after the deploy of 2026-10-07, or a new instance's) says nothing of 00:00: that day keeps no opening mark,
 * and counts as before.
 */
export function dayOpenMarks(
  prev: { dayOpen?: unknown; marks?: unknown; marksAt?: unknown }, day: string, dayStart: number, marks: Record<string, number | null>, at: string,
): { day: string; at: string; marks: Record<string, number> } {
  const numbers = (x: unknown): Record<string, number> => Object.fromEntries(Object.entries(x && typeof x === "object" ? x as Record<string, unknown> : {})
    .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])));
  const kept = prev.dayOpen as { day?: unknown; at?: unknown; marks?: unknown } | null | undefined;
  if (kept && kept.day === day && typeof kept.at === "string") return { day, at: kept.at, marks: numbers(kept.marks) };
  if (typeof prev.marksAt !== "string" || !(Date.parse(prev.marksAt) < dayStart)) return { day, at, marks: {} };
  return { day, at, marks: { ...numbers(marks), ...numbers(prev.marks) } };
}

/** A trade's status in the docs' words: the OpenAPI writes TRADE_STATUS_CONFIRMED, the clients and the lifecycle page CONFIRMED. */
export function tradeStatus(s: unknown): "MATCHED" | "MINED" | "CONFIRMED" | "RETRYING" | "FAILED" | null {
  const x = String(s ?? "").toUpperCase().replace(/^TRADE_STATUS_/, "");
  return x === "MATCHED" || x === "MINED" || x === "CONFIRMED" || x === "RETRYING" || x === "FAILED" ? x : null;
}

/** A market's daily reward rate as `/rewards/markets/current` lists it: the total, else native plus sponsored. */
export function rewardRate(r: Record<string, unknown>): number {
  const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
  return n(r.total_daily_rate) || n(r.native_daily_rate) + n(r.sponsored_daily_rate);
}

const jsonList = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
};

/**
 * A time as Gamma writes it, in milliseconds, or null: ISO (`endDate`, "2026-10-08T02:00:00Z") or Postgres-style
 * (`gameStartTime`, "2026-10-01 03:05:00+00", whose bare-hour offset `Date.parse` does not read).
 */
export function pmTime(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim().replace(" ", "T");
  if (/\d{2}:\d{2}/.test(s)) s = s.replace(/([+-]\d{2})$/, "$1:00");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** A market's reward programme as the listing gives it: its total daily rate, maximum spread (cents) and minimum size. */
export type PmRewardRow = { rate: number; v: number; minSize: number };
/**
 * In the universe by its reward programme alone: a rate in the instance's band ([$6, $10) for the default), a spread to
 * score in, and N small enough for its cap.
 */
export function inUniverse(r: PmRewardRow, band: PmLiveInstance["band"] = PM_LIVE_INSTANCE.band): boolean {
  return r.rate >= band.floor && r.rate < band.ceiling && r.v > 0 && sizeN(r.minSize) <= PM_LIVE_MAX_N;
}

/**
 * RW-E's rule, in RW-E's own code (`excludedByDay`): a market whose scheduled end is before the end of UTC day `day` is
 * not quoted on `day`. The 48-hour horizon holds it already; it is kept, by the function the RW-E replay runs, so the
 * rule is RW-E's whatever becomes of the horizon.
 */
export function rweSameDay(day: string, endDate: string | null): boolean {
  if (!endDate) return false;
  return excludedByDay([{ day, cond: "m", tick: 0, v: 0, min_size: 0, rate: 0, end_date: endDate }]).get(day)?.has("m") === true;
}

export type PmCandidate = {
  cond: string; yes: string; no: string; negRisk: boolean; question: string; rate: number; v: number; minSize: number;
  endDate: string | null; gameStart: string | null;
};
/**
 * Gamma's market as a candidate, or null: in the universe by its listed reward programme (`inUniverse`; a market the
 * listing does not show is not rewarded and is never taken), accepting orders (`enableOrderBook`, `acceptingOrders`, not
 * closed), two tokens and a condition id. Given the clock, a market whose game starts or which ends within
 * `PM_LIVE_MIN_HORIZON_MS` is passed over, and one RW-E would not quote that UTC day; a time Gamma does not give, or one
 * it gives unreadably, passes nothing over. `band` is the instance's (the default's unless given).
 */
export function candidateOf(m: Record<string, unknown>, listing: Map<string, PmRewardRow>, nowMs?: number, band: PmLiveInstance["band"] = PM_LIVE_INSTANCE.band): PmCandidate | null {
  if (m.enableOrderBook !== true || m.acceptingOrders !== true || m.closed === true) return null;
  const cond = String(m.conditionId ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(cond)) return null;
  const r = listing.get(cond);
  if (!r || !inUniverse(r, band)) return null;
  const endDate = typeof m.endDate === "string" ? m.endDate : null, gameStart = typeof m.gameStartTime === "string" ? m.gameStartTime : null;
  if (nowMs !== undefined) {
    const soon = (v: unknown) => { const t = pmTime(v); return t !== null && t < nowMs + PM_LIVE_MIN_HORIZON_MS; };
    if (soon(gameStart) || soon(endDate)) return null;
    if (pmTime(endDate) !== null && rweSameDay(dayOf(nowMs), endDate)) return null;
  }
  const toks = jsonList(m.clobTokenIds);
  if (toks.length !== 2 || toks.some((t) => typeof t !== "string" || !/^\d+$/.test(t))) return null;
  return {
    cond, yes: toks[0] as string, no: toks[1] as string, negRisk: m.negRisk === true, question: String(m.question ?? "").slice(0, 100),
    rate: r.rate, v: r.v, minSize: r.minSize, endDate, gameStart,
  };
}

/**
 * A candidate by live-prep's rules (`PmCandidateRules`): a market of a fee type they name is passed over; with the end
 * horizon off, `candidateOf` judges it as if Gamma gave no end date (so only the game's start can pass it over by the
 * horizon), then RW-E's same-day rule is applied to the end date it does give, in RW-E's own code, and the end date is
 * kept on the candidate. With the horizon on it is `candidateOf` itself. `candidateOf` is not changed by it.
 */
export function lpCandidateOf(m: Record<string, unknown>, listing: Map<string, PmRewardRow>, nowMs: number | undefined, band: PmLiveInstance["band"], rules: PmCandidateRules): PmCandidate | null {
  if (typeof m.feeType === "string" && rules.excludeFeeTypes.includes(m.feeType)) return null;
  if (rules.endHorizon) return candidateOf(m, listing, nowMs, band);
  const c = candidateOf({ ...m, endDate: null }, listing, nowMs, band);
  if (!c) return null;
  const endDate = typeof m.endDate === "string" ? m.endDate : null;
  if (nowMs !== undefined && pmTime(endDate) !== null && rweSameDay(dayOf(nowMs), endDate)) return null;
  return { ...c, endDate };
}

/** A clock in milliseconds and the instant on it after which no further read starts. */
export type PmDeadline = { clock: () => number; until: number };
const NO_DEADLINE: PmDeadline = { clock: () => 0, until: Infinity };
const pastDeadline = (dl: PmDeadline) => dl.clock() > dl.until;

/** The row offset a listing cursor carries ("NTAw" is base64 of "500"), or null for one that is not that. */
export function cursorOffset(cursor: string): number | null {
  try { const s = atob(cursor); return /^\d+$/.test(s) ? Number(s) : null; } catch { return null; }
}
const offsetCursor = (offset: number) => btoa(String(offset));
const condOf = (r: Record<string, unknown>) => String(r.condition_id ?? "").toLowerCase();
const sortedById = (rows: Array<Record<string, unknown>>) => rows.every((r, i) => i === 0 || condOf(rows[i - 1]) < condOf(r));

type ListingPages = { ok: boolean; pages: Array<Array<Record<string, unknown>>>; reads: number; how: "concurrent" | "sequential" | "one page"; shifts: number[]; error?: string };

/** One listing (native or sponsored), page after page by the venue's own cursors: the way it was read before 2026-10-01. */
async function listingSequential(venue: PmVenue, sponsored: boolean, first: Array<Record<string, unknown>>, next: string, dl: PmDeadline, reads: number): Promise<ListingPages> {
  const pages = [first];
  let cursor = next;
  for (let page = 1; page < REWARD_PAGES && cursor && cursor !== "LTE="; page++) {
    if (pastDeadline(dl)) return { ok: false, pages, reads, how: "sequential", shifts: [], error: `time budget: the reward listing was not read to its end (${reads} pages) by the deadline` };
    const r = await venue.rewardsPage(sponsored, cursor);
    reads++;
    if (!r.ok) return { ok: false, pages, reads, how: "sequential", shifts: [], error: `rewards/markets/current (sponsored ${sponsored}): ${r.status} ${r.error}` };
    const rows = Array.isArray(r.data?.data) ? r.data!.data! : [];
    pages.push(rows);
    cursor = typeof r.data?.next_cursor === "string" ? r.data.next_cursor : "";
    if (!rows.length) break;
  }
  return { ok: true, pages, reads, how: "sequential", shifts: [] };
}

/**
 * One listing read whole. The CLOB's cursor is base64 of a row offset ("MA==" is 0, "NTAw" 500, "LTE=" −1: the end), so
 * once the first page shows that, the rest are read `PM_LISTING_CONCURRENCY` at a time at offsets `stride` apart, each
 * page `PM_LISTING_OVERLAP` rows over the one before. The listing is in condition-id order (every page read on
 * 2026-10-01 was), so a page whose first row is not after the previous page's last proves no row fell between them,
 * and the read is complete only when every boundary shows that, the last page is short or says END, and every page
 * between is full. A read that fails the proof is made again once, its first page included (a proof is over one read's
 * pages, never a stale first page against fresh ones); a listing whose cursor or order is not what was measured is read
 * page after page by its own cursors instead.
 */
async function listingPages(venue: PmVenue, sponsored: boolean, dl: PmDeadline): Promise<ListingPages> {
  let reads = 0, lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (pastDeadline(dl)) {
      return { ok: false, pages: [], reads, how: attempt ? "concurrent" : "one page", shifts: [], error: `time budget: the reward listing was not read${attempt ? " to its end" : ""} by the deadline` };
    }
    const r0 = await venue.rewardsPage(sponsored, "");
    reads++;
    if (!r0.ok) return { ok: false, pages: [], reads, how: "one page", shifts: [], error: `rewards/markets/current (sponsored ${sponsored}): ${r0.status} ${r0.error}` };
    const first = Array.isArray(r0.data?.data) ? r0.data!.data! : [];
    const next0 = typeof r0.data?.next_cursor === "string" ? r0.data.next_cursor : "";
    const size = Number(r0.data?.limit) > 0 ? Number(r0.data!.limit) : first.length;
    if (!next0 || next0 === "LTE=" || first.length < size || !first.length) return { ok: true, pages: [first], reads, how: "one page", shifts: [] };
    const overlap = Math.min(PM_LISTING_OVERLAP, Math.floor(size / 2)), stride = size - overlap;
    if (cursorOffset(next0) !== first.length || stride < 1 || !sortedById(first)) return await listingSequential(venue, sponsored, first, next0, dl, reads);
    const pages: Array<Array<Record<string, unknown>> | undefined> = [first];
    const nexts: string[] = [next0];
    let end = Infinity, failed = "", late = false, nextIdx = 1;
    const worker = async () => {
      for (;;) {
        const i = nextIdx++;
        if (i > end || i >= REWARD_PAGES || failed) return;
        if (pastDeadline(dl)) { late = true; return; }
        const r = await venue.rewardsPage(sponsored, offsetCursor(i * stride));
        reads++;
        if (!r.ok) { failed ||= `rewards/markets/current (sponsored ${sponsored}): ${r.status} ${r.error}`; return; }
        const rows = Array.isArray(r.data?.data) ? r.data!.data! : [];
        const next = typeof r.data?.next_cursor === "string" ? r.data.next_cursor : "";
        pages[i] = rows; nexts[i] = next;
        if (rows.length < size || !next || next === "LTE=") end = Math.min(end, i);
      }
    };
    await Promise.all(Array.from({ length: PM_LISTING_CONCURRENCY }, worker));
    if (failed) return { ok: false, pages: [], reads, how: "concurrent", shifts: [], error: failed };
    if (late || !Number.isFinite(end)) return { ok: false, pages: [], reads, how: "concurrent", shifts: [], error: `time budget: the reward listing was not read to its end (${reads} pages) by the deadline` };
    // The proof: every page up to the end is there, sorted, full before the last, its cursor the next offset, and each
    // begins inside the one before it.
    const got = pages.slice(0, end + 1);
    if (got.some((p) => !p)) { lastError = "a page of the reward listing is missing"; continue; }
    const ps = got as Array<Array<Record<string, unknown>>>;
    if (ps.some((p) => !sortedById(p))) return await listingSequential(venue, sponsored, first, next0, dl, reads);
    const shifts: number[] = [];
    let proof = "";
    for (let i = 1; i <= end && !proof; i++) {
      const prev = ps[i - 1], cur = ps[i];
      if (prev.length < size) proof = `page ${i - 1} is short but the listing went on`;
      else if (nexts[i - 1] !== "LTE=" && cursorOffset(nexts[i - 1]) !== (i - 1) * stride + prev.length) proof = `page ${i - 1}'s cursor is not the next offset`;
      // A page after a full one starts inside it, so it cannot be empty unless rows left between the two reads.
      else if (!cur.length) proof = `page ${i} is empty after a full page: the listing moved more than ${overlap} rows between their reads`;
      else if (!(condOf(cur[0]) <= condOf(prev[prev.length - 1]))) proof = `a gap between pages ${i - 1} and ${i}: the listing moved more than ${overlap} rows between their reads`;
      else { const at = prev.findIndex((x) => condOf(x) === condOf(cur[0])); shifts.push(at < 0 ? -1 : at - stride); }
    }
    if (!proof) return { ok: true, pages: ps, reads, how: "concurrent", shifts: shifts.filter((s) => s !== 0) };
    lastError = proof;
  }
  return { ok: false, pages: [], reads, how: "concurrent", shifts: [], error: `the reward listing could not be proved complete twice: ${lastError}` };
}

export type PmListing = { ok: boolean; rows: Map<string, PmRewardRow>; pages: number; how: string; shifts: number[]; error?: string };
/**
 * Every rewarded market's programme, from both listings (native and sponsored), each read whole (`listingPages`); a
 * market listed twice keeps its larger rate, as RW's `pmRewardsCurrent` keeps it. (On 2026-10-01 each of the sponsored
 * listing's 33 rows was in the native one with the same total.) A listing not read whole by the deadline is a failure.
 */
export async function rewardListing(venue: PmVenue, dl: PmDeadline = NO_DEADLINE): Promise<PmListing> {
  const [nat, spo] = await Promise.all([listingPages(venue, false, dl), listingPages(venue, true, dl)]);
  const rows = new Map<string, PmRewardRow>();
  const pages = nat.reads + spo.reads, how = `${nat.how}+${spo.how}`;
  if (!nat.ok || !spo.ok) return { ok: false, rows, pages, how, shifts: [], error: nat.error ?? spo.error };
  for (const page of [...nat.pages, ...spo.pages]) {
    for (const r of page) {
      const cond = condOf(r);
      if (!cond) continue;
      const rate = rewardRate(r), cur = rows.get(cond);
      if (!cur || rate > cur.rate) rows.set(cond, { rate, v: num(r.rewards_max_spread), minSize: num(r.rewards_min_size) });
    }
  }
  return { ok: true, rows, pages, how, shifts: [...nat.shifts, ...spo.shifts] };
}

/** One market RW's first round scored at the selection. */
type Scored = { cond: string; perDollar: number; cap: number; c: PmCandidate; book: PmBookNow; formulaDay: number };
export type PmSelectOpts = {
  maxMarkets: number; budget: number;
  /** Our own orders resting at the venue as the selection reads the books (live only: yesterday's, until withdrawn), by market. */
  own?: Map<string, PmOwnOrder[]>;
  /** The instance's band of daily reward rates; the default's when absent. */
  band?: PmLiveInstance["band"];
  /** The instance's exclusion, applied once the listing is read, and the options of the public reads it makes. */
  exclusion?: PmExclusion;
  pm?: PmPublicOpts;
  /** The instance's batch read of its candidates' books (`PmLiveInstance.bookBatch`); one GET each when absent. */
  bookBatch?: (tokens: string[]) => Promise<Map<string, PmBookReply>>;
  /** The instance's book-quality rule (`PmLiveInstance.bookQuality`); none when absent. */
  bookQuality?: PmBookQualityRule;
  /** Live-prep's candidate rules (`PmLpOptions.candidate`); the default's 48-hour horizon and no fee type when absent. */
  candidate?: PmCandidateRules;
};

/**
 * The day's markets, by RW's rule on this path's universe: every market in the reward listing with a total daily rate
 * in [$6, $10), a maximum spread and N ≤ 20 (`inUniverse`); Gamma's word that it accepts orders with two tokens and
 * neither ends nor starts within 48 hours (`candidateOf`); its YES book read now, two-sided and agreeing with Gamma about
 * `neg_risk`; RW's `firstScore` on it, less our own orders resting there (`opts.own`), and a formula reward of at least
 * $2.50 a day; then RW's `choose` within the budget, at most `maxMarkets` of them in its order. RW's ranking is never
 * run on RW's universe: nothing at $10 or more is scored. Any read that fails, or a deadline that comes before every
 * candidate's book is read, takes nothing: RW's ranking is over the whole universe or not at all, and the day is tried
 * again five minutes later. An instance's band replaces [$6, $10), and its exclusion, given the listing just read, takes
 * its markets out of the universe before anything else is read; one that cannot say fails the selection too, and only
 * how many markets of the universe it took out is recorded (`note.exclusion.excluded`), never which.
 */
export async function selectMarkets(venue: PmVenue, day: string, opts: PmSelectOpts, exclude: Set<string>, dl: PmDeadline = NO_DEADLINE, nowMs: number = Date.parse(`${day}T00:00:00Z`)): Promise<{ picks: PmMarketRow[]; note: Record<string, unknown> }> {
  const note: Record<string, unknown> = {};
  const fail = (error: string) => ({ picks: [] as PmMarketRow[], note: { ...note, error } });
  const listing = await rewardListing(venue, dl);
  note.listing = { pages: listing.pages, how: listing.how, rewarded: listing.rows.size, shifts: listing.shifts };
  if (!listing.ok) return fail(listing.error ?? "the reward listing could not be read");
  const band = opts.band ?? PM_LIVE_INSTANCE.band;
  let out: Set<string> | null = null;
  if (opts.exclusion) {
    const ex = await opts.exclusion(listing.rows, { dl, nowMs, pm: opts.pm });
    if ("error" in ex) return fail(`exclusion: ${ex.error}`);
    out = ex.excluded;
    note.exclusion = { ...ex.note, excluded: [...listing.rows].filter(([cond, r]) => inUniverse(r, band) && !exclude.has(cond) && out!.has(cond)).length };
  }
  const universe = [...listing.rows].filter(([cond, r]) => inUniverse(r, band) && !exclude.has(cond) && !out?.has(cond)).map(([cond]) => cond).sort();
  note.universe = universe.length;
  // Gamma, fifty markets a read: accepting orders, the two tokens, the horizon.
  const chunks: string[][] = [];
  for (let i = 0; i < universe.length; i += GAMMA_CHUNK) chunks.push(universe.slice(i, i + GAMMA_CHUNK));
  const gamma = new Map<string, Record<string, unknown>>();
  let gammaError = "", late = false;
  await pool(chunks, GAMMA_CONCURRENCY, async (chunk) => {
    if (pastDeadline(dl)) { late = true; return; }
    const g = await venue.gammaByConditions(chunk, false);
    if (!g.ok) { gammaError ||= `gamma markets/keyset: ${g.status} ${g.error}`; return; }
    for (const m of Array.isArray(g.data?.markets) ? g.data!.markets! : []) gamma.set(String(m.conditionId ?? "").toLowerCase(), m);
  }, () => !!gammaError || late);
  note.gammaReads = chunks.length;
  if (gammaError) return fail(gammaError);
  if (late) return fail("time budget: the deadline came before Gamma was read for every candidate");
  const eligible = universe.map((cond) => gamma.get(cond))
    .map((m) => (m ? (opts.candidate ? lpCandidateOf(m, listing.rows, nowMs, band, opts.candidate) : candidateOf(m, listing.rows, nowMs, band)) : null))
    .filter((c): c is PmCandidate => !!c);
  note.eligible = eligible.length;
  // Each eligible market's book, and RW's first round on it.
  const scored: Scored[] = [];
  const passedOver: Record<string, number> = {};
  /** The candidates the instance's book-quality rule passed over: taken only for the slots and budget the rest leave. */
  const behind: Scored[] = [];
  let bookError = "", booksRead = 0, gone = 0, mismatched = 0, oneSided = 0;
  // An instance that reads its candidates' books at once has them all before the first is scored; a token the batch has
  // no book for is one the CLOB has none for, as a GET's 404 says. A batch that fails takes nothing, as any read here.
  let batch: Map<string, PmBookReply> | null = null;
  if (opts.bookBatch && eligible.length) {
    if (pastDeadline(dl)) return fail("time budget: the deadline came before every candidate's book was read");
    try { batch = await opts.bookBatch(eligible.map((c) => c.yes)); } catch (e) { return fail(`books (batch): ${msg(e)}`); }
  }
  await pool(eligible, BOOK_CONCURRENCY, async (c) => {
    if (pastDeadline(dl)) { late = true; return; }
    let r: PmReply<PmBookReply>;
    if (batch) {
      const got = batch.get(c.yes);
      r = got ? { ok: true, status: 200, ms: 0, data: got } : { ok: false, status: 404, ms: 0, error: "not in the batch's answer: no book" };
      booksRead++;
    } else {
      r = await venue.book(c.yes);
      booksRead++;
      if (!r.ok && r.status !== 404) { r = await venue.book(c.yes); booksRead++; }                    // once more, then it decides
    }
    if (!r.ok) { if (r.status === 404) gone++; else bookError ||= `book of ${c.cond.slice(0, 10)}…: ${r.status} ${r.error}`; return; }
    const b = bookNow(r.data);
    if (!b) { oneSided++; return; }
    if (b.negRisk !== c.negRisk) { mismatched++; return; }
    const tick = Number(b.tick);
    // RW's first round on the book as the rest of the market made it: our own orders still resting from the day before
    // are taken out, as the rule takes them out every minute (with them in, a market we quoted would rank against itself).
    const lv = othersLevels(b.levels, opts.own?.get(c.cond) ?? []);
    const fs = firstScore(summarize(lv.bids, lv.asks, c.v, c.minSize), tick, c.v, c.minSize, c.rate);
    if (!fs) return;
    const formulaDay = fs.perDollar * 1440 * fs.cap;
    if (formulaDay < PM_LIVE_MIN_FORMULA_DAY_USD - 1e-9) return;
    // The instance's book-quality rule, on the same book: a candidate it fails is passed over, and RW's ranking takes the
    // next that passes; it comes back only for the slots and the budget those leave (below).
    const why = opts.bookQuality ? bookQualityOf({ v: c.v, minSize: c.minSize, levels: lv, tick }, opts.bookQuality) : null;
    const x = { cond: c.cond, perDollar: fs.perDollar, cap: fs.cap, c, book: b, formulaDay };
    if (why) { passedOver[why] = (passedOver[why] ?? 0) + 1; behind.push(x); return; }
    scored.push(x);
  }, () => !!bookError || late);
  Object.assign(note, { booksRead, booksGone: gone, mismatched, oneSided, scored: scored.length });
  const quality = opts.bookQuality ? { rule: opts.bookQuality.name, passedOver: Object.values(passedOver).reduce((s, n) => s + n, 0), why: passedOver } : null;
  if (quality) note.bookQuality = quality;
  if (bookError) return fail(bookError);
  if (late) return fail("time budget: the deadline came before every candidate's book was read");
  const first = choose(scored, opts.budget).slice(0, Math.max(0, opts.maxMarkets));
  // The books the rule passed over fill what those leave, in RW's order within the budget left: the rule ranks a day's
  // markets, books with depth first, and a day with too few of them still quotes the rest.
  const left = opts.budget - first.reduce((s, x) => s + x.cap, 0);
  const filled = first.length < opts.maxMarkets ? choose(behind, left).slice(0, Math.max(0, opts.maxMarkets - first.length)) : [];
  const chosen = [...first, ...filled];
  if (quality) note.bookQuality = { ...quality, filled: filled.length };
  note.chosen = chosen.length;
  note.capital = Math.round(chosen.reduce((s, x) => s + x.cap, 0) * 100) / 100;
  note.formulaDay = Math.round(chosen.reduce((s, x) => s + x.formulaDay, 0) * 100) / 100;
  const picks: PmMarketRow[] = chosen.map((x, i) => ({
    day, kind: x.c.negRisk ? "neg_risk" : "standard", cond: x.cond, yes_token: x.c.yes, no_token: x.c.no, neg_risk: x.c.negRisk,
    tick: Number(x.book.tick), min_size: x.c.minSize, reward_rate: x.c.rate, rank: i + 1, question: x.c.question,
    max_spread: x.c.v, n_size: sizeN(x.c.minSize), per_dollar_day: x.perDollar * 1440, capital: x.cap, formula_day: x.formulaDay,
    end_date: x.c.endDate, game_start: x.c.gameStart,
  }));
  return { picks, note };
}

/** What a read-back's status makes of our row: LIVE rests, MATCHED filled, CANCELED (the market resolving too) cancelled, INVALID refused. */
export function stateOfStatus(s: unknown): PmOrderRow["state"] | null {
  const x = String(s ?? "").toUpperCase();
  if (x === "LIVE") return "live";
  if (x === "MATCHED") return "filled";
  if (x === "CANCELED" || x === "CANCELLED" || x === "CANCELED_MARKET_RESOLVED") return "cancelled";
  if (x === "INVALID") return "rejected";
  return null;
}

/**
 * How a POST's reply settles its pending row. A reply the venue accepted rests (`live`); an explicit refusal is
 * `rejected` (a 4xx with its error, a 200 with `success: false`, or a refusal made here before any request left; a 425
 * restart or a 429 says the order was not taken, and is sent again as a new order); anything else — a 5xx, a timeout, a
 * reply that never came — says nothing about the order, which stays `pending` until a read-back by its hash settles it.
 */
export function postOutcome(r: PmReply<PmSendReply>, hash: string): { state: "live" | "rejected" | "pending"; why: string; retry?: boolean } {
  if (r.refused) return { state: "rejected", why: `refused before sending: ${r.error}` };
  if (r.ok) {
    if (r.data?.success === false) return { state: "rejected", why: String(r.data.errorMsg ?? "success: false") };
    const id = String(r.data?.orderID ?? "").toLowerCase();
    if (id && id !== hash) return { state: "pending", why: `the venue named it ${id}, not its hash ${hash}: settled by read-back` };
    return { state: "live", why: String(r.data?.status ?? "accepted") };
  }
  if (r.status === 425 || r.status === 429) return { state: "rejected", why: `${r.status} ${r.error ?? ""}: not taken`, retry: true };
  if (r.status >= 400 && r.status < 500 && r.error) return { state: "rejected", why: `${r.status} ${r.error}` };
  return { state: "pending", why: `${r.status || "no reply"} ${r.error ?? ""}: outcome unknown` };
}

/** A slot's newest order today, as `refusalWait` reads it. */
export type PmLastOrder = Pick<PmOrderRow, "state" | "price" | "size" | "response" | "book_seen">;
/**
 * Why a quote the venue refused is not sent again now, or null when it may go. A refusal that says to retry (a 425
 * restart, a 429) holds nothing back; nor does one at another price or size (the rule moved: new information). The same
 * quote refused as crossing the book ("invalid post-only order: order crosses book") goes again only once the level it
 * faced has moved (its price or size, the rest of the market's, as read now against as read then): the book the venue
 * matched against was not the one the turn read, and only a new reading of that level says it may have changed. Any
 * other refusal of the same quote (its balance, its parameters) waits for the rule's price or size to change. So in a
 * quiet book a refused quote is sent once, not every minute, and nothing here leans on the venue's rate limit.
 */
export function refusalWait(last: PmLastOrder | undefined, w: { price: number; size: number; facing: PmLevel | null }): string | null {
  if (last?.state !== "rejected") return null;
  const resp = (last.response ?? {}) as { retry?: boolean; why?: string };
  if (resp.retry) return null;
  if (Math.abs(Number(last.price) - w.price) >= 1e-9 || Math.abs(Number(last.size) - w.size) >= 1e-9) return null;
  const why = String(resp.why ?? "rejected");
  if (/crosses book/i.test(why)) {
    const seen = ((last.book_seen ?? {}) as { facing?: PmLevel | null }).facing ?? null;
    const same = seen === null ? w.facing === null
      : w.facing !== null && Math.abs(seen[0] - w.facing[0]) < 1e-9 && Math.abs(seen[1] - w.facing[1]) < 1e-9;
    return same ? `the venue refused this quote as crossing (${why}); it goes again once the level it faces moves (${JSON.stringify(seen)} as refused) or the rule's price or size changes` : null;
  }
  return `the venue refused this quote (${why}); it is not sent again until the rule's price or size changes`;
}

/**
 * The geoblock's answer for this turn. A good read is used and kept; a failed one is answered by the last good read while
 * it is at most `PM_LIVE_GEO_CACHE_MS` old, with no fault reported; past that the gate closes (an unread country is no
 * permission) and the fault is reported once, on the turn it went stale, not every minute after.
 */
export function geoOf(r: PmReply<{ blocked?: boolean; country?: string; region?: string }>, now: number, prev: { geoGood?: { at: string; country: string | null; region: string | null; blocked: boolean | null } | null; geoStaleReported?: boolean }): {
  geo: GateInputs["geo"] & { cachedFrom: string | null }; good: { at: string; country: string | null; region: string | null; blocked: boolean | null } | null; staleReported: boolean; fault: string | null;
} {
  if (r.ok) {
    const good = { at: iso(now), country: r.data?.country ?? null, region: r.data?.region ?? null, blocked: r.data?.blocked ?? null };
    return { geo: { ok: true, country: good.country, region: good.region, blocked: good.blocked, cachedFrom: null }, good, staleReported: false, fault: null };
  }
  const g = prev.geoGood ?? null;
  const age = g ? now - Date.parse(g.at) : Infinity;
  if (g && age >= 0 && age <= PM_LIVE_GEO_CACHE_MS) {
    return { geo: { ok: true, country: g.country, region: g.region, blocked: g.blocked, cachedFrom: g.at }, good: g, staleReported: false, fault: null };
  }
  const fault = prev.geoStaleReported ? null
    : `geoblock unreadable (${r.status} ${r.error ?? ""}) and no good answer from the last ${PM_LIVE_GEO_CACHE_MS / M} minutes: the gate is closed until it reads again`;
  return { geo: { ok: false, country: null, region: null, blocked: null, cachedFrom: null }, good: g, staleReported: true, fault };
}

// ------------------------------------------------------------------ the executor

export type PmLiveDeps = {
  db: Db;
  now: number;
  holder: string;
  venue: PmVenue;
  /** The runtime's `SB_REGION`, as the action read it. */
  sbRegion: string | null;
  /** `PM_ORDER_SENDS_ENABLED` in production (true since 2026-10-01); false keeps the path a dry-run whatever its config says. */
  sendsEnabled: boolean;
  /** The account's addresses from the secrets: the proxy wallet (an order's maker) and the EOA (its signer). */
  account: { maker: string; signer: string } | null;
  /** What signs an order: the loaded key, only when it is the stored signer's; null otherwise. */
  signer: PmSigner | null;
  /** Why no signer was loaded, as the env loader said it (never a byte of the key). */
  signerProblem?: string | null;
  rule?: PmQuoteRule;
  salt?: () => string;
  /** Milliseconds, for the turn's deadlines and its lease's renewal only; nothing recorded is read from it. Date.now by default. */
  clock?: () => number;
  /** Waits between a cancel's read-backs (`PM_LIVE_CANCEL_REREAD_MS`); a timer by default, a recorder in the tests. */
  pause?: (ms: number) => Promise<void>;
  /** The instance this turn runs: `PM_LIVE_INSTANCE` (small-pool) when absent. */
  inst?: PmLiveInstance;
  /** The options of the keyless public reads an instance's exclusion makes (`_shared/polymarket_public.ts`). */
  pm?: PmPublicOpts;
};

export type PmLiveReport = {
  at: string; skipped?: string; mode: PmLiveMode | null; why: string; sbRegion: string | null; gates: Gates | null;
  markets: Array<{ kind: string; cond: string; quoting: boolean; book: Omit<PmBookNow, "levels"> | null; held: { yes: number; no: number } | null }>;
  placed: Array<{ mode: PmLiveMode; slot: string; side: string; price: number; size: number; hash: string; state: string }>;
  cancelled: Array<{ mode: PmLiveMode; slot: string; gate: string; outcome: string }>;
  withheld: Array<{ slot: string; gate: string; reason: string }>;
  settled: Array<{ hash: string; state: string }>;
  /** Each market's minute under RW's formula, as `pm_live_minutes` records it. */
  minutes: Array<{ cond: string; formula: number; ours: number; others: number; bid: number | null; ask: number | null }>;
  /** What the markets are doing that is no fault of the path's: a one-sided book, a market that left the book. State only. */
  conditions: Record<string, string>;
  readout: Array<{ day: string; markets: number; actual: number; formula: number }>;
  posts: number; pnl: { day: number; total: number } | null; errors: string[];
};

type Slot = { cond: string; token: string; outcome: "yes" | "no"; side: "BUY" | "SELL"; negRisk: boolean; tick: PmTickSize; minSize: number; book: PmBookNow };
/**
 * `facing`: the best level of the REST of the market on the side the order would meet, in the one book (an ask level for
 * a bid, a bid level for an ask; null when that side is empty): what a post-only refusal for crossing is about.
 */
type Want = Slot & { price: number; size: number; gate: "open" | "reduce"; facing: PmLevel | null };
/** A market the turn reads: today's (quoted) or one held from an earlier day (marked, never quoted: RW holds it). */
type TurnMarket = PmMarketRow & { quoting: boolean };
const slotKey = (x: { cond: string; token: string; side: string }) => `${x.cond}|${x.token}|${x.side}`;
const isOpenRow = (o: Pick<PmOrderRow, "state">) => o.state === "pending" || o.state === "live";
const ownOf = (o: Pick<PmOrderRow, "outcome" | "side" | "price" | "size" | "size_matched">): PmOwnOrder => ({
  outcome: o.outcome, side: o.side, price: Number(o.price), size: Math.max(0, Number(o.size) - Number(o.size_matched ?? 0)),
});

/** One turn of the path. It never throws: whatever fails ends in `errors`, and the lease is always given back. */
export async function runPmLive(d: PmLiveDeps): Promise<PmLiveReport> {
  const report: PmLiveReport = {
    at: iso(d.now), mode: null, why: "", sbRegion: d.sbRegion, gates: null, markets: [], placed: [], cancelled: [], withheld: [], settled: [],
    minutes: [], conditions: {}, readout: [], posts: 0, pnl: null, errors: [],
  };
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  const inst = d.inst ?? PM_LIVE_INSTANCE;
  let held: unknown[];
  try {
    held = await d.db.claim("agent_locks", `name=eq.${inst.lock}&lease_until=lt.${enc(iso(d.now))}`, { lease_until: iso(d.now + PM_LIVE_LEASE_MS), holder: d.holder });
  } catch (e) {
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(msg(e))) return { ...report, skipped: "agent_locks is not there" };
    report.errors.push(`LEASE CLAIM FAILED — agent_locks: ${msg(e)}; nothing done this minute`);
    return report;
  }
  if (!held.length) return { ...report, skipped: `another run holds the ${inst.lock} lease (or migration ${inst.migrations.tables} has not run)` };
  try {
    await turn(d, inst, report, clock, t0);
  } catch (e) {
    report.errors.push(`turn: ${msg(e)}`);
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${inst.lock}&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires on its own */ }
  }
  return report;
}

async function turn(d: PmLiveDeps, inst: PmLiveInstance, report: PmLiveReport, clock: () => number, t0: number): Promise<void> {
  const { db, venue } = d;
  const T = inst.tables;
  const nowIso = iso(d.now), nowS = Math.floor(d.now / 1000), minute = iso(Math.floor(d.now / M) * M);
  const dayStart = Math.floor(d.now / DAY) * DAY, day = nowIso.slice(0, 10);
  const elapsed = () => clock() - t0;
  const pause = d.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline: PmDeadline = { clock, until: t0 + PM_LIVE_SELECT_UNTIL_MS };
  let renewedAt = t0, leaseLost = false;
  /**
   * Keep, and check, the lease before every live order: a turn that lost it sends nothing more (PR5's executor's rule).
   * Stricter than PR5's in one way: a renewal that cannot be confirmed stops the sending too.
   */
  const holdLease = async (): Promise<boolean> => {
    if (leaseLost) return false;
    const at = clock();
    if (at - renewedAt < PM_LIVE_LEASE_MS / 2) return true;
    try {
      const rows = await db.claim("agent_locks", `name=eq.${inst.lock}&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now + (at - t0) + PM_LIVE_LEASE_MS) });
      if (!rows.length) { leaseLost = true; report.errors.push(`lease lost: another run holds ${inst.lock} now; this one sends nothing more`); return false; }
      renewedAt = at;
      return true;
    } catch (e) { leaseLost = true; report.errors.push(`lease renewal failed (${msg(e)}): this run sends nothing more`); return false; }
  };

  // ── the config, the last turn, the global pause, the mode ─────────────────────────────────────────────────────────
  let cfg: PmLiveConfig | undefined;
  try { cfg = (await db.select<PmLiveConfig>(T.config, "id=eq.1&select=*"))[0]; }
  catch (e) {
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(msg(e))) {
      report.skipped = `the ${T.config.replace(/_config$/, "")} tables are not in this database yet: migration ${inst.migrations.tables} has not run`;
      return;
    }
    throw e;
  }
  if (!cfg) { report.skipped = `no ${T.config} row: migration ${inst.migrations.tables} has not run`; return; }
  // The day's markets, the minutes and the readout are 0076's: until it has run, the turn does nothing (it was a dry-run).
  if (cfg.max_markets === undefined) { report.skipped = `the ${T.config} row has no max_markets: migration ${inst.migrations.selection} has not run`; return; }
  const lim = inst.lp ? lpLimits(cfg, inst.lp) : effectiveLimits(cfg);
  const prev = ((await db.select<{ state: Record<string, unknown> }>(T.state, "id=eq.1&select=state"))[0]?.state ?? {}) as Record<string, any>;
  let globalPause = false, riskReadable = true;
  try { globalPause = !!(await db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause"))[0]?.global_pause; }
  catch (e) { riskReadable = false; report.errors.push(`agent_risk unreadable (${msg(e)}): nothing that opens this turn`); }
  const keyed = !!d.signer && !!d.account && d.signer.address().toLowerCase() === d.account.signer.toLowerCase();
  const mode: PmLiveMode = d.sendsEnabled && !cfg.dry_run && keyed ? "live" : "dry_run";
  report.mode = mode;
  report.why = mode === "live" ? "live: sends enabled in code, dry_run off, the key loaded and matching the signer"
    : !d.sendsEnabled ? "dry-run: PM_ORDER_SENDS_ENABLED is false in code" : cfg.dry_run ? `dry-run: ${T.config}.dry_run is on`
    : `dry-run: no signing key loaded for the stored signer${d.signerProblem ? ` (${d.signerProblem})` : ""}`;

  // ── 1. the day's markets ──────────────────────────────────────────────────────────────────────────────────────────
  // A market whose book answered 404 today left the book while it was selected (it closed or resolved): it is dropped
  // for the rest of the day and read no more. As in RW's spec, a day is quoted on its own selection: nothing replaces it.
  const goneToday = new Set<string>(prev.goneDay === day && Array.isArray(prev.gone) ? (prev.gone as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const openAll = await db.selectAll<PmOrderRow>(T.orders, "state=in.(pending,live)&select=*&order=id.asc");
  // Our orders at the venue as the selection reads the books: the live rows recorded resting (a dry-run's are in no book).
  const ownAtVenue = new Map<string, PmOwnOrder[]>();
  for (const o of openAll) if (o.mode === "live" && o.state === "live") ownAtVenue.set(o.cond, [...(ownAtVenue.get(o.cond) ?? []), ownOf(o)]);
  const todayRows = await db.select<PmMarketRow>(T.markets, `day=eq.${day}&select=*&order=rank.asc`);
  let selected = todayRows.filter((m) => !goneToday.has(m.cond));
  let selectionTriedAt = prev.selectionDay === day ? (prev.selectionTriedAt as string | undefined) ?? null : null;
  // Written once the books are read, so a market found gone this turn is recorded in the same minute's row.
  let selectionEvent: Record<string, unknown> | null = null;
  if (!todayRows.length && lim.maxMarkets > 0 && (!selectionTriedAt || d.now - Date.parse(selectionTriedAt) >= SELECT_RETRY_MS)) {
    selectionTriedAt = nowIso;
    try {
      const began = clock();
      const sel = await selectMarkets(venue, day, {
        maxMarkets: lim.maxMarkets, budget: lim.budget, own: ownAtVenue, band: inst.band, exclusion: inst.exclusion, pm: d.pm,
        bookBatch: inst.bookBatch ? (tokens: string[]) => inst.bookBatch!(tokens, d.pm) : undefined, bookQuality: inst.bookQuality,
        ...(inst.lp ? { candidate: inst.lp.candidate } : {}),
      }, goneToday, deadline, d.now);
      sel.note.ms = Math.round(clock() - began);
      if (sel.picks.length) {
        await db.upsert(T.markets, sel.picks.map((p) => ({ ...p, detail: { note: sel.note }, selected_at: nowIso })), "day,cond");
        selected = sel.picks;
      }
      selectionEvent = { day, picked: sel.picks.map((p) => ({ cond: p.cond, rate: p.reward_rate, rank: p.rank, perDollarDay: p.per_dollar_day, capital: p.capital, formulaDay: p.formula_day })), ...sel.note };
      if (sel.note.error) report.errors.push(`selection: ${sel.note.error}`);
    } catch (e) { report.errors.push(`selection: ${msg(e)}`); }
  }

  // ── what is held: the markets CONFIRMED fills (live only) left tokens in, from an earlier day too ──────────────────
  // A market Gamma has shown resolved is settled at its payout (`pm_live_settlements`) and holds nothing more; its tokens
  // left on chain until Davies redeems them are watched as capital (`unredeemed`), not marked as exposure.
  // Live-prep's DRY-RUN decides on its paper layer's holdings instead (`PmLpOptions.paper`): the paper's fills of the
  // orders this path rested, and the paper's settlements. A dry-run never fills, and the account's balances are a real
  // account's, so with them its sells, its 5N rule, its caps on what is held, its exits and its stop would never run
  // before it is live. The layer decides a minute two minutes after it (`RW_DECIDE_LAG_MS`), so the holdings a turn
  // decides on are its paper's of two minutes before; a sell the paper cannot cover fills no further than it holds.
  const paper = mode === "dry_run" && inst.lp ? inst.lp.paper : null;
  const settlements = await db.selectAll<PmSettlement>(paper?.settlements ?? T.settlements, "select=cond,yes_token,no_token,payout,settled_at&order=cond.asc");
  const fillsBook = async (extra: PmSettlement[] = []): Promise<{ rows: Array<Pick<FillRow, "cond" | "token">>; tb: ReturnType<typeof tokenBooks>; all: PmFill[] }> => {
    if (paper) {
      const rows = await db.selectAll<PaperFillRow>(paper.fills, "select=cond,token,token_side,token_price,size,ts&order=cond.asc,minute.asc,print_id.asc");
      const fills = rows.map((f): PmFill => ({ token: f.token, side: f.token_side, price: Number(f.token_price), size: Number(f.size), ts: Date.parse(f.ts) }));
      const all = [...fills, ...settlementFills([...settlements, ...extra])];
      return { rows, tb: tokenBooks(all, dayStart), all };
    }
    const rows = await db.selectAll<FillRow>(T.fills, "status=eq.CONFIRMED&select=*&order=trade_id.asc,hash.asc");
    // `match_time` is to the second and the rows come in `trade_id` order, so a sell matched in the same second as the buy it
    // sells could be counted first, find nothing held, and leave the buy standing as a holding (review A6). A buy goes first
    // at a tie, as the loop's `positionFromFills` orders them; `tokenBooks` and `sinceOpenPnl` keep it (their sort is stable).
    const fills = rows.map((f): PmFill => ({ token: f.token, side: f.side, price: Number(f.price), size: Number(f.size), ts: f.match_time ? Date.parse(f.match_time) : d.now }))
      .sort((a, b) => a.ts - b.ts || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
    const all = [...fills, ...settlementFills([...settlements, ...extra])];
    return { rows, tb: tokenBooks(all, dayStart), all };
  };
  const before = await fillsBook();
  const settled = new Set(settlements.map((s) => s.cond));
  const heldConds = [...new Set(before.rows.filter((f) => (before.tb[f.token]?.held ?? 0) > 0).map((f) => f.cond))].filter((c) => !selected.some((m) => m.cond === c) && !settled.has(c));
  const heldMarkets: TurnMarket[] = [];
  for (const c of heldConds) {
    const row = (await db.select<PmMarketRow>(T.markets, `cond=eq.${enc(c)}&select=*&order=day.desc&limit=1`))[0];
    if (row) heldMarkets.push({ ...row, quoting: false });
  }
  const markets: TurnMarket[] = [...selected.map((m) => ({ ...m, quoting: true })), ...heldMarkets];
  // Fail-safe: a settled market is watched until a turn reads both its balances at 0, and only then left out.
  const redeemed = new Set<string>(Array.isArray(prev.redeemed) ? (prev.redeemed as unknown[]).filter((x): x is string => typeof x === "string") : []);
  // A paper settlement leaves no token on chain: nothing of it waits to be redeemed.
  const unredeemed = paper ? [] : settlements.filter((s) => !redeemed.has(s.cond));

  // ── 2. what the venue says ────────────────────────────────────────────────────────────────────────────────────────
  const g0 = geoOf(await venue.geoblock(), d.now, prev);
  const geo = { ok: g0.geo.ok, country: g0.geo.country, region: g0.geo.region, blocked: g0.geo.blocked };
  if (g0.fault) report.errors.push(g0.fault);
  const coR = await venue.closedOnly();
  const closedOnly = coR.ok && typeof coR.data?.closed_only === "boolean" ? coR.data.closed_only : null;
  if (closedOnly === null) report.errors.push(`closed-only flag unreadable: ${coR.status} ${coR.error ?? "no closed_only in the reply"}`);
  // The account's pUSD, read in either mode and recorded (`state.pusd`): the go-time statement sets the total cap from
  // it. In live mode a buy is sent only while what the resting buys reserve leaves room for it, so the venue never
  // refuses one for collateral (an unread balance is none); a dry-run is no claim on it and is held to nothing.
  let pusd: number | null = null;
  const cr = await venue.collateral();
  const units = cr.ok ? Number(cr.data?.balance) : NaN;
  if (Number.isFinite(units) && units >= 0) pusd = units / 1e6;
  else report.errors.push(`pUSD balance unreadable (${cr.status} ${cr.error ?? "no balance"})${mode === "live" ? ": no new buy is sent this turn; the funded ones resting stay" : ""}`);
  const books = new Map<string, PmBookNow | null>();
  const heldOf = new Map<string, number>();
  let inventoryReadable = true;
  const goneNow: Array<{ cond: string; status: number; error: string }> = [];
  const conditions: Record<string, string> = {};
  for (const m of markets) {
    const r = await venue.book(m.yes_token);
    // A 404 is the CLOB saying the book no longer exists ("No orderbook exists for the requested token id"): the market
    // left it. That is a condition of the market, recorded once, never a fault.
    const gone = !r.ok && r.status === 404;
    if (gone && m.quoting) goneNow.push({ cond: m.cond, status: r.status, error: String(r.error ?? "").slice(0, 120) });
    const b = r.ok ? bookNow(r.data) : null;
    books.set(m.cond, b && b.negRisk === m.neg_risk ? b : null);
    if (gone) conditions[m.cond] = "left the book (404)";
    else if (!r.ok) report.errors.push(`${m.cond.slice(0, 10)}…: book unreadable (${r.status} ${r.error})`);
    else if (!b) conditions[m.cond] = "one-sided book";
    else if (b.negRisk !== m.neg_risk) conditions[m.cond] = `the book's neg_risk is ${b.negRisk}, the selection's ${m.neg_risk}`;
    for (const token of [m.yes_token, m.no_token]) {
      const br = await venue.conditionalBalance(token);
      const units = br.ok ? Number(br.data?.balance) : NaN;
      if (Number.isFinite(units) && units >= 0) heldOf.set(token, units / 1e6);
      else { inventoryReadable = false; report.errors.push(`balance of ${token.slice(0, 10)}… unreadable: ${br.status} ${br.error ?? "no balance"}`); }
    }
  }
  // Settled markets' tokens still on chain: capital until Davies redeems them, read until both balances are 0.
  for (const s of unredeemed) {
    for (const token of [s.yes_token, s.no_token]) {
      const br = await venue.conditionalBalance(token);
      const units = br.ok ? Number(br.data?.balance) : NaN;
      if (Number.isFinite(units) && units >= 0) heldOf.set(token, units / 1e6);
      else { inventoryReadable = false; report.errors.push(`balance of ${token.slice(0, 10)}… unreadable: ${br.status} ${br.error ?? "no balance"}`); }
    }
  }
  // Live-prep's dry-run holds what its paper holds; the account's balances above decide the inventory gate alone.
  if (paper) for (const m of markets) for (const token of [m.yes_token, m.no_token]) heldOf.set(token, before.tb[token]?.held ?? 0);
  // A held market whose book is gone is settled at Gamma's payout once Gamma shows it closed with one and a closed time
  // (RW's condition, `pmMarkets`); until then it is held at its cost. A paper holding is settled by the paper layer.
  const newSettlements: PmSettlement[] = [];
  const goneHeld = heldMarkets.filter((m) => conditions[m.cond] === "left the book (404)");
  if (goneHeld.length && !paper) {
    const g = await venue.gammaByConditions(goneHeld.map((m) => m.cond), true);
    if (!g.ok) report.errors.push(`gamma (closed markets): ${g.status} ${g.error}`);
    const closedTime = new Map<string, string>();
    for (const gm of g.ok && Array.isArray(g.data?.markets) ? g.data!.markets! : []) {
      const m = goneHeld.find((x) => x.cond === String(gm.conditionId ?? "").toLowerCase());
      const p0 = Number(jsonList(gm.outcomePrices)[0]);
      if (!m || gm.closed !== true || typeof gm.closedTime !== "string" || !Number.isFinite(p0) || p0 < 0 || p0 > 1) continue;
      newSettlements.push({ cond: m.cond, yes_token: m.yes_token, no_token: m.no_token, payout: p0, settled_at: nowIso });
      closedTime.set(m.cond, gm.closedTime);
    }
    if (newSettlements.length) {
      try { await db.upsert(T.settlements, newSettlements.map((s) => ({ ...s, closed_time: closedTime.get(s.cond) ?? null, detail: {} })), "cond"); }
      catch (e) { report.errors.push(`settlement not recorded (${msg(e)})`); newSettlements.length = 0; }
    }
  }
  if (goneNow.length) selectionEvent = { ...(selectionEvent ?? { day }), gone: goneNow };
  if (selectionEvent) {
    try { await db.upsert(T.events, [{ mode, minute, kind: "selection", detail: selectionEvent }], "mode,minute,kind"); }
    catch (e) { report.errors.push(`selection not recorded (${msg(e)})`); }
  }

  // ── live orders read back by hash, and their trades ───────────────────────────────────────────────────────────────
  const unreadable = new Set<number>();
  const patch = async (o: PmOrderRow, p: Partial<PmOrderRow>) => {
    await db.update(T.orders, `id=eq.${o.id}`, { ...p, updated_at: nowIso });
    Object.assign(o, p);
  };
  const recordTrades = async (o: PmOrderRow, ids: string[]) => {
    for (const id of ids) {
      const r = await venue.trade(id);
      const t: PmTrade | undefined = r.ok ? (r.data?.data ?? []).find((x) => x.id === id) : undefined;
      if (!t) { report.errors.push(`trade ${id} of ${o.hash.slice(0, 12)}… unreadable: ${r.status} ${r.error ?? "not in the reply"}`); continue; }
      const mine = (t.maker_orders ?? []).find((x) => String(x.order_id ?? "").toLowerCase() === o.hash);
      const size = Number(mine?.matched_amount), price = Number(mine?.price ?? o.price), status = tradeStatus(t.status);
      if (!mine || !(size > 0) || !status) { report.errors.push(`trade ${id}: no fill of ${o.hash.slice(0, 12)}… in it, or an unknown status ${t.status}; left for a person`); continue; }
      await db.upsert(T.fills, [{
        trade_id: id, hash: o.hash, cond: o.cond, token: o.token, side: o.side, price, size, status,
        match_time: Number(t.match_time) > 0 ? iso(Number(t.match_time) * 1000) : null, tx_hash: t.transaction_hash ?? null, detail: { trade: t }, updated_at: nowIso,
      }], "trade_id,hash");
    }
  };
  /** Apply what GET /data/order/{hash} says. Never a guess: a status it does not know leaves the row as it is. */
  const applyReadBack = async (o: PmOrderRow, v: PmOpenOrder) => {
    const state = stateOfStatus(v.status);
    const matched = Number(v.size_matched ?? 0);
    if (!state) { report.errors.push(`${o.hash.slice(0, 12)}…: the venue says ${v.status}, which this path does not know; left for a person`); return; }
    const p: Partial<PmOrderRow> = {};
    if (state !== o.state) p.state = state;
    if (Number.isFinite(matched) && matched !== Number(o.size_matched)) p.size_matched = matched;
    if (state === "filled" && !o.filled_at) p.filled_at = nowIso;
    if ((state === "cancelled" || state === "rejected") && !o.cancelled_at) p.cancelled_at = nowIso;
    if (Object.keys(p).length) { await patch(o, { ...p, response: { ...(o.response as object ?? {}), readBack: v } }); report.settled.push({ hash: o.hash, state: o.state }); }
    if (matched > 0 && Array.isArray(v.associate_trades) && v.associate_trades.length) await recordTrades(o, v.associate_trades.map(String));
  };
  /**
   * An order read back after a cancel was asked: one the venue still shows resting is read again after each pause in
   * `PM_LIVE_CANCEL_REREAD_MS` (the venue may carry a cancel out a moment after it answers), unless the turn is already
   * past the moment after which it sends nothing, when nothing waits on the answer.
   */
  const readAfterCancel = async (o: PmOrderRow): Promise<PmReply<PmOpenOrder>> => {
    let r = await venue.order(o.hash);
    for (const ms of PM_LIVE_CANCEL_REREAD_MS) {
      if (!r.ok || !r.data || stateOfStatus(r.data.status) !== "live" || elapsed() > PM_LIVE_SEND_UNTIL_MS) break;
      await pause(ms);
      r = await venue.order(o.hash);
    }
    return r;
  };
  const readBack = async (o: PmOrderRow, afterCancel = false): Promise<boolean> => {
    const r = afterCancel ? await readAfterCancel(o) : await venue.order(o.hash);
    if (r.status === 404) {
      report.errors.push(o.state === "pending"
        ? `${o.hash.slice(0, 12)}… (pending ${Math.round((d.now - Date.parse(o.ts)) / M)} min) is shown nowhere by the venue: outcome unknown; it stays pending for a person to settle, and its slot places nothing`
        : `${o.hash.slice(0, 12)}…: the venue no longer finds an order it accepted; left for a person`);
      unreadable.add(o.id);
      return false;
    }
    if (!r.ok || !r.data) { unreadable.add(o.id); report.errors.push(`${o.hash.slice(0, 12)}…: read-back failed (${r.status} ${r.error}); left as it is`); return false; }
    await applyReadBack(o, r.data);
    return true;
  };
  for (const o of openAll.filter((x) => x.mode === "live")) {
    try {
      if (o.state === "pending" && d.now - Date.parse(o.ts) < PENDING_GRACE_MS) { unreadable.add(o.id); continue; }
      await readBack(o);
    } catch (e) { unreadable.add(o.id); report.errors.push(`${o.hash.slice(0, 12)}…: ${msg(e)}`); }
  }
  // Trades not yet final are read again until CONFIRMED or FAILED.
  const fillRows = await db.selectAll<FillRow>(T.fills, "select=*&order=trade_id.asc,hash.asc");
  for (const f of fillRows.filter((x) => x.status !== "CONFIRMED" && x.status !== "FAILED")) {
    const o = openAll.find((x) => x.hash === f.hash) ?? (await db.select<PmOrderRow>(T.orders, `hash=eq.${f.hash}&select=*`))[0];
    if (o) { try { await recordTrades(o, [f.trade_id]); } catch (e) { report.errors.push(`trade ${f.trade_id}: ${msg(e)}`); } }
  }
  // A dry-run row left pending (its second write failed) was never sent anywhere: closed, so it cannot hold its slot.
  for (const o of openAll.filter((x) => x.mode === "dry_run" && x.state === "pending" && d.now - Date.parse(x.ts) >= PENDING_GRACE_MS)) {
    try { await patch(o, { state: "cancelled", cancelled_at: nowIso, cancel_reason: "a dry-run row left pending: nothing was sent" }); } catch (e) { report.errors.push(`dry-run row ${o.id}: ${msg(e)}`); }
  }
  // A dry-run order the venue would have expired by now (its expiration less the venue's minute) is expired.
  for (const o of openAll.filter((x) => x.mode === "dry_run" && x.state === "live" && Number(x.expiration) - PM_GTD_EARLY_S <= nowS)) {
    try { await patch(o, { state: "expired", cancelled_at: nowIso }); } catch (e) { report.errors.push(`dry-run row ${o.id}: ${msg(e)}`); }
  }

  // ── the minute's formula: what rested when the book was read, scored by RW's formula ─────────────────────────────
  // Our orders in the venue's book are the live ones the read-back left resting; a dry-run's are in no book. The quotes
  // scored are this mode's resting orders in each market.
  const resting = (cond: string, m: PmLiveMode) => openAll.filter((o) => o.mode === m && o.cond === cond && o.state === "live");
  const scoring = new Map<string, boolean>();
  let pct: Record<string, number> | null = null;
  if (mode === "live") {
    for (const o of openAll.filter((x) => x.mode === "live" && x.state === "live" && markets.some((m) => (m.quoting || !!inst.lp) && m.cond === x.cond))) {
      if (pastDeadline(deadline)) break;
      const r = await venue.orderScoring(o.hash);
      if (r.ok && typeof r.data?.scoring === "boolean") scoring.set(o.hash, r.data.scoring);
    }
  }
  // The account's live share of each pool is what the account earns: read by an instance that reads its payouts in
  // dry-run too, and by any instance in a live turn. Each records only the shares of its own markets.
  if ((inst.readsPayouts || mode === "live") && markets.some((m) => m.quoting) && !pastDeadline(deadline)) {
    const r = await venue.rewardPercentages();
    if (r.ok && r.data && typeof r.data === "object") pct = Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k.toLowerCase(), Number(v)]));
  }
  const minuteRows: PmMinuteRow[] = [];
  // Our orders in each book as this turn read it, for the formula of what rests after the turn (`detail.after`).
  // Live-prep records the markets it carries from an earlier day too: its exits rest there, and its paper layer fills
  // them from those minutes.
  const inBookAtRead = new Map<string, PmOwnOrder[]>();
  for (const m of markets.filter((x) => x.quoting || !!inst.lp)) {
    const b = books.get(m.cond);
    if (!b) continue;
    const rows = resting(m.cond, mode);
    const quotes = rows.map(ownOf), inBook = mode === "live" ? quotes : [];
    inBookAtRead.set(m.cond, inBook);
    const rate = num(m.reward_rate), v = num(m.max_spread), minSize = num(m.min_size);
    const f = minuteFormula({ rate, v, minSize, levels: b.levels, inBook, quotes });
    if (f.row && (f.row[2] === null || f.row[3] === null)) conditions[m.cond] ??= "no adjusted midpoint: a side has no level of the reward minimum";
    const sideScoring = (side: "bid" | "ask") => {
      const hs = rows.filter((o) => inYesBook(ownOf(o)).side === side).map((o) => scoring.get(o.hash));
      return mode !== "live" || !hs.length || hs.some((x) => x === undefined) ? null : hs.some((x) => x === true);
    };
    const row = f.row;
    minuteRows.push({
      mode, minute, cond: m.cond, rate, max_spread: v, min_size: minSize, tick: Number(b.tick),
      bb: row?.[0] ?? null, ba: row?.[1] ?? null, ab: row?.[2] ?? null, aa: row?.[3] ?? null, q1: row?.[4] ?? null, q2: row?.[5] ?? null,
      bid_price: f.bid?.price ?? null, bid_size: f.bid?.size ?? null, ask_price: f.ask?.price ?? null, ask_size: f.ask?.size ?? null,
      bid_scoring: sideScoring("bid"), ask_scoring: sideScoring("ask"), ours: f.ours, others: f.others, formula_usd: f.formula,
      pct: pct ? (pct[m.cond] ?? 0) : null, detail: { qBid: f.qBid, qAsk: f.qAsk, m: f.m, mRw: f.mRw, orders: rows.length },
    });
    report.minutes.push({ cond: m.cond, formula: f.formula, ours: f.ours, others: f.others, bid: f.bid?.price ?? null, ask: f.ask?.price ?? null });
  }

  // ── P&L from CONFIRMED live fills (this turn's read-backs and settlements included), and the loss stops ─────────────
  const { tb, all: allFills } = await fillsBook(newSettlements);
  const marks: Record<string, number | null> = {};
  for (const m of markets) {
    const b = books.get(m.cond);
    const mid = b ? (b.bestBid + b.bestAsk) / 2 : null;
    marks[m.yes_token] = mid; marks[m.no_token] = mid == null ? null : 1 - mid;
  }
  const onCost = bookPnl(tb, marks);
  // The day stop counts only the day's change since 2026-10-07 (`sinceOpenPnl`, Davies: "只算当天变化"): each holding from
  // its mark as the UTC day began (`dayOpenMarks`, kept in the state), or its cost if bought today. The total keeps every
  // holding from its cost. An instance with no day stop (live-prep's) and one run on the frozen rule (`dayStopOnCost`)
  // keep `bookPnl`'s day, and their state, as before.
  const dayOpen = !inst.dayStopOnCost && Number.isFinite(lim.lossDay) ? dayOpenMarks(prev, day, dayStart, marks, nowIso) : null;
  const pnl = dayOpen ? { day: sinceOpenPnl(allFills, dayStart, dayOpen.marks, marks), total: onCost.total } : onCost;
  report.pnl = pnl;
  // Live-prep's stops (`PmLpOptions`): each mode's own, so a stop its dry-run tripped on paper never holds the live path,
  // nor the reverse; no day stop (`lossDay` is Infinity); and the total counts what was paid beside the fills: live, what
  // Polymarket paid as its readout booked it (`pm_lp_reward_days`, live rows); in dry-run, its paper's closed days at
  // R = 0.40. Until the first payout is read, the fills alone. The other instances' stops read and write `live` alone.
  const stopMode: PmLiveMode = inst.lp ? mode : "live";
  const hasEvent = async (kind: string, since: string | null) => (await db.select(T.events, `mode=eq.${stopMode}&kind=eq.${kind}${since ? `&minute=gte.${enc(since)}` : ""}&select=minute&limit=1`)).length > 0;
  let lossDay = false, lossTotal = false;
  try {
    lossDay = await hasEvent("loss_stop_day", iso(dayStart));
    lossTotal = await hasEvent("loss_stop_total", null);
  } catch (e) { lossDay = lossTotal = true; report.errors.push(`loss stops unreadable (${msg(e)}): nothing that opens this turn`); }
  let paid: number | null = null;
  if (inst.lp && !lossTotal) {
    try {
      const rows = paper
        ? (await db.selectAll<{ reward_r40: number | string | null }>(paper.days, "select=reward_r40&order=day.asc")).map((r) => num(r.reward_r40))
        : (await db.selectAll<{ actual_usd: number | string | null; actual_sponsored_usd: number | string | null }>(T.rewardDays, "mode=eq.live&select=actual_usd,actual_sponsored_usd&order=mode.asc,day.asc,cond.asc"))
          .map((r) => num(r.actual_usd) + num(r.actual_sponsored_usd));
      paid = Math.round(rows.reduce((s, x) => s + x, 0) * 1e8) / 1e8;
    } catch (e) { lossTotal = true; report.errors.push(`what was paid is unreadable (${msg(e)}): the stop cannot be judged; nothing that opens this turn`); }
  }
  if (!lossDay && pnl.day <= -lim.lossDay) {
    lossDay = true;
    await db.upsert(T.events, [{
      mode: stopMode, minute, kind: "loss_stop_day",
      detail: dayOpen ? { dayPnl: pnl.day, limit: -lim.lossDay, since: dayOpen.at, onCost: onCost.day } : { dayPnl: pnl.day, limit: -lim.lossDay },
    }], "mode,minute,kind");
    report.errors.push(`LOSS STOP (day): ${pnl.day} USD is past −${lim.lossDay}; nothing opens until the next UTC day; sells of what is held stay armed`);
  }
  if (!lossTotal && pnl.total + (paid ?? 0) <= -lim.lossTotal) {
    lossTotal = true;
    const basis = Math.round((pnl.total + (paid ?? 0)) * 1e8) / 1e8;
    await db.upsert(T.events, [{
      mode: stopMode, minute, kind: "loss_stop_total",
      detail: inst.lp ? { totalPnl: pnl.total, paid, basis, limit: -lim.lossTotal } : { totalPnl: pnl.total, limit: -lim.lossTotal },
    }], "mode,minute,kind");
    report.errors.push(inst.lp
      ? `LOSS STOP (all): fills ${pnl.total} and paid ${paid ?? 0} USD, ${basis} in all, is past −${lim.lossTotal}; nothing opens again until a person clears the stop; sells stay armed`
      : `LOSS STOP (all): ${pnl.total} USD is past −${lim.lossTotal}; nothing opens again until a person clears the stop; sells stay armed`);
  }

  // ── 3. the gates ──────────────────────────────────────────────────────────────────────────────────────────────────
  const attested = attestationCurrent(cfg, d.now);
  const g = gates({
    mode, globalPause, riskReadable, armed: !!cfg.live_confirmed_at, sbRegion: d.sbRegion, geo, closedOnly, attested, inventoryReadable, lossDay, lossTotal,
  });
  report.gates = g;

  // ── 4. what each slot should hold ─────────────────────────────────────────────────────────────────────────────────
  const rule = d.rule ?? inst.lp?.rule ?? rwQuotes;
  const wants = new Map<string, Want>();
  const withheld = new Map<string, string>();
  const withhold = (slot: string, gate: string, reason: string) => { withheld.set(slot, gate); report.withheld.push({ slot, gate, reason }); };
  const lifetime = lim.lifetimeS;
  // Live-prep's pause after a jump (`pauseAfterJump`), kept from turn to turn for the markets it reads, and what each of
  // its markets' minutes records of the turn's decision (`detail.lp`), which its paper layer reads.
  const lpPrev = (prev.lp ?? {}) as Partial<PmPauseState>;
  const pauseState: PmPauseState = { lastMid: { ...(lpPrev.lastMid ?? {}) }, pausedUntil: { ...(lpPrev.pausedUntil ?? {}) } };
  const lpDetail = new Map<string, Record<string, unknown>>();
  for (const m of markets) {
    const b = books.get(m.cond);
    const held = { yes: heldOf.get(m.yes_token) ?? 0, no: heldOf.get(m.no_token) ?? 0 };
    report.markets.push({ kind: m.kind, cond: m.cond, quoting: m.quoting, book: b ? (({ levels: _l, ...rest }) => rest)(b) : null, held: inventoryReadable ? held : null });
    let paused = false;
    if (inst.lp) {
      // Judged on every book a turn reads, whatever the gates say, as x2's arm judges every minute it has a book for: the
      // rest of the market's adjusted mid (RW's row of the book without our orders).
      if (b) {
        const own0 = mode === "live" ? openAll.filter((o) => o.mode === "live" && o.cond === m.cond && o.state === "live").map(ownOf) : [];
        const o0 = othersLevels(b.levels, own0);
        const row0 = summarize(o0.bids, o0.asks, num(m.max_spread), num(m.min_size));
        const mid = row0 && row0[2] !== null && row0[3] !== null ? (row0[2] + row0[3]) / 2 : null;
        paused = pauseAfterJump(pauseState, m.cond, Math.floor(d.now / M) * M, mid, inst.lp.pause);
      } else paused = (pauseState.pausedUntil[m.cond] ?? 0) > Math.floor(d.now / M) * M;
      lpDetail.set(m.cond, {
        state: paused ? "paused" : !m.quoting ? "carried" : g.open ? "quote" : "close", held, n: sizeN(num(m.min_size)),
        pausedUntil: paused ? iso(pauseState.pausedUntil[m.cond]) : null, stopTotal: lossTotal, paid,
      });
    }
    if (!b || g.cancelAll) continue;
    // Our own orders in the book this turn read (live): the rule and the post-only check judge the rest of the book.
    const own = mode === "live" ? openAll.filter((o) => o.mode === "live" && o.cond === m.cond && o.state === "live").map(ownOf) : [];
    const others = othersLevels(b.levels, own);
    const touch = { bestBid: others.bids[0]?.[0] ?? 0, bestAsk: others.asks[0]?.[0] ?? 1 };
    let intents: PmIntent[] = [];
    // A market held from an earlier day is not quoted: RW holds what a market it left still holds. Live-prep works it
    // off instead: the rule's quote on it, close-only, so only the sells of what it holds rest, at the rule's prices.
    if (m.quoting) {
      try { intents = rule({ market: m, book: b, held, own }); } catch (e) { report.errors.push(`${m.cond.slice(0, 10)}…: the rule threw (${msg(e)}); nothing quoted`); continue; }
    } else if (inst.lp) {
      try { intents = closeOnly(rule({ market: m, book: b, held, own }), held, b); } catch (e) { report.errors.push(`${m.cond.slice(0, 10)}…: the rule threw (${msg(e)}); nothing quoted`); continue; }
    }
    const tokenOf = (o: "yes" | "no") => (o === "yes" ? m.yes_token : m.no_token);
    // Paused (live-prep): nothing rests in the market this minute; what is held is held.
    if (paused && intents.length) {
      for (const x of intents) withhold(slotKey({ cond: m.cond, token: tokenOf(x.outcome), side: x.side }), "pause", `the adjusted mid jumped ${inst.lp!.pause.cents} ¢ or more: not quoted until ${iso(pauseState.pausedUntil[m.cond])}`);
      intents = [];
    }
    // Sells a rule wants are capped at what is held, whatever the mode; while opening is stopped, buys become close-only sells.
    const sellsCapped = closeOnly(intents.filter((x) => x.side === "SELL"), held, b);
    const list = g.open ? [...intents.filter((x) => x.side === "BUY"), ...sellsCapped] : g.reduce ? closeOnly(intents, held, b) : [];
    for (const x of intents) {
      const slot = slotKey({ cond: m.cond, token: tokenOf(x.outcome), side: x.side });
      if (!list.some((y) => y.outcome === x.outcome && y.side === x.side)) {
        withhold(slot, g.cancelAll ? "global_pause" : x.side === "BUY" ? g.openBlockedBy ?? "rule" : g.reduceBlockedBy ?? "rule", x.side === "BUY" ? "nothing that opens" : "nothing held to sell");
      }
    }
    for (const x of list) {
      const slot = slotKey({ cond: m.cond, token: tokenOf(x.outcome), side: x.side });
      const expiration = nowS + PM_GTD_EARLY_S + lifetime;
      const problems = orderProblems({ price: x.price, size: x.size, expiration }, { tick: b.tick, minSize: b.minSize, nowS });
      if (problems.length) { withhold(slot, "venue_rules", problems.join("; ")); continue; }
      if (crosses(x, touch)) { withhold(slot, "post_only", `${x.side} ${x.outcome} at ${x.price} would take the book (${touch.bestBid}/${touch.bestAsk})`); continue; }
      if (wants.has(slot)) continue;
      const facing = (inYesBook(x).side === "bid" ? others.asks[0] : others.bids[0]) ?? null;
      wants.set(slot, {
        cond: m.cond, token: tokenOf(x.outcome), outcome: x.outcome, side: x.side, negRisk: m.neg_risk, tick: b.tick, minSize: b.minSize, book: b, price: x.price, size: x.size,
        gate: x.side === "BUY" ? "open" : "reduce", facing: facing ? [facing[0], facing[1]] : null,
      });
    }
  }

  // The caps, on what would rest after this turn: buys' collateral (N × b for a YES bid, N × (1 − a) for a NO bid) plus
  // what the holdings cost. Rows this turn cannot touch (pending, frozen, unread) keep their collateral.
  const open = openAll.filter(isOpenRow);
  const untouchable = (o: PmOrderRow) => o.state === "pending" || !!o.cancel_requested_at || unreadable.has(o.id);
  const byMarket = new Map<string, number>();
  let committed = 0;
  const commit = (cond: string | null, usd: number) => { committed += usd; if (cond) byMarket.set(cond, (byMarket.get(cond) ?? 0) + usd); };
  const condOfToken = new Map<string, string>();
  for (const m of markets) { condOfToken.set(m.yes_token, m.cond); condOfToken.set(m.no_token, m.cond); }
  const settledHere = [...unredeemed, ...newSettlements], settledConds = new Set(settledHere.map((s) => s.cond));
  // Every holding the fills explain, in any market, at its cost; and what the turn's markets hold beyond their fills (no
  // fill to price it, so counted at $1 a share, the most a share can be worth).
  for (const [token, t] of Object.entries(tb)) commit(condOfToken.get(token) ?? null, t.held * t.avgCost);
  for (const [token, cond] of condOfToken) if (!settledConds.has(cond)) commit(cond, Math.max(0, (heldOf.get(token) ?? 0) - (tb[token]?.held ?? 0)));
  // A settled market's tokens still on chain are its payout's worth of capital that has not come back as pUSD: counted
  // until they are redeemed, so no buy is ever sent that the account's pUSD could not cover.
  for (const s of settledHere) {
    committed += (heldOf.get(s.yes_token) ?? 0) * Number(s.payout) + (heldOf.get(s.no_token) ?? 0) * (1 - Number(s.payout));
  }
  // The pUSD the buys after this turn may reserve: the balance less what the buys this turn cannot touch reserve already,
  // and less what the buys it keeps as they are reserve. A want its slot's resting order already is (same price and size,
  // life enough left) sends nothing: the venue took its collateral when it accepted it, so the pUSD check judges only what
  // would be SENT, and a balance that cannot be read stops new buys without cancelling the funded ones that rest.
  let pusdLeft = pusd ?? 0;
  for (const o of open) {
    if (o.mode === mode && o.side === "BUY" && untouchable(o)) {
      const usd = Number(o.price) * Math.max(0, Number(o.size) - Number(o.size_matched));
      commit(o.cond, usd);
      pusdLeft -= usd;
    }
  }
  const keptAsIs = new Map<string, PmOrderRow>();
  for (const o of open) {
    const w = wants.get(slotKey(o));
    if (o.mode !== mode || o.state !== "live" || untouchable(o) || !w) continue;
    if (Math.abs(Number(o.price) - w.price) < 1e-9 && Math.abs(Number(o.size) - w.size) < 1e-9 && Number(o.expiration) - PM_GTD_EARLY_S - nowS > PM_LIVE_REFRESH_S) keptAsIs.set(slotKey(o), o);
  }
  for (const o of keptAsIs.values()) if (o.side === "BUY") pusdLeft -= Number(o.price) * Math.max(0, Number(o.size) - Number(o.size_matched));
  // A live buy this turn cancels (its slot withdrawn or re-priced) rests until the cancel is read back, after these caps
  // (section 5), and a cancel the venue never carries out leaves it there (review A7). So the caps count it until then: in
  // full where its slot is withdrawn, and where the slot is re-priced the larger of the old and the new order, which never
  // rest together (the new one waits for the read-back). A dry-run's cancels are the database's own and always land.
  const leaving = new Map<string, number>();
  if (mode === "live") {
    for (const o of open) {
      if (o.mode !== mode || o.side !== "BUY" || o.state !== "live" || untouchable(o) || keptAsIs.has(slotKey(o))) continue;
      const usd = Number(o.price) * Math.max(0, Number(o.size) - Number(o.size_matched));
      leaving.set(slotKey(o), usd);
      commit(o.cond, usd);
    }
  }
  for (const [slot, w] of [...wants.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (w.side !== "BUY") continue;
    const usd = w.price * w.size, more = Math.max(0, usd - (leaving.get(slot) ?? 0));   // what the caps count it beyond its slot's old buy
    if (committed + more > lim.capTotal + 1e-9) { wants.delete(slot); withhold(slot, "cap_total", `${(committed + more).toFixed(2)} USD would pass the cap of ${lim.capTotal}`); continue; }
    if ((byMarket.get(w.cond) ?? 0) + more > lim.capMarket + 1e-9) { wants.delete(slot); withhold(slot, "cap_market", `${((byMarket.get(w.cond) ?? 0) + more).toFixed(2)} USD in one market would pass ${lim.capMarket}`); continue; }
    if (mode === "live" && !keptAsIs.has(slot) && usd > pusdLeft + 1e-9) { wants.delete(slot); withhold(slot, "collateral", pusd === null ? "the pUSD balance could not be read" : `${usd.toFixed(2)} USD more than the ${Math.max(0, pusdLeft).toFixed(2)} of pUSD the resting buys leave`); continue; }
    commit(w.cond, more);
    if (!keptAsIs.has(slot)) pusdLeft -= usd;
  }

  // ── 5. the orders ─────────────────────────────────────────────────────────────────────────────────────────────────
  const today = await db.selectAll<Pick<PmOrderRow, "id" | "mode" | "cond" | "token" | "side" | "price" | "size" | "state" | "response" | "book_seen">>(T.orders,
    `ts=gte.${enc(iso(dayStart))}&select=id,mode,cond,token,side,price,size,state,response,book_seen&order=id.asc`);
  let posts = today.filter((o) => o.mode === mode).length;
  /** Each slot's newest order today: one the venue refused is not sent again at the same price and size. */
  const lastInSlot = new Map<string, (typeof today)[number]>();
  for (const o of today) if (o.mode === mode) lastInSlot.set(slotKey(o), o);
  const slotLabel = (o: { cond: string; outcome: string; side: string }) => `${o.cond.slice(0, 6)}…${o.cond.slice(-4)}|${o.outcome}|${o.side}`;

  /** Take an order off the book, CONFIRMED by a read-back; a dry-run row is simply closed. */
  const cancel = async (o: PmOrderRow, gate: string, reason: string): Promise<"cancelled" | "filled" | "frozen"> => {
    const done = (outcome: "cancelled" | "filled" | "frozen") => { report.cancelled.push({ mode: o.mode, slot: slotLabel(o), gate, outcome }); return outcome; };
    if (o.mode === "dry_run") {
      await patch(o, { state: "cancelled", cancel_requested_at: o.cancel_requested_at ?? nowIso, cancel_gate: gate, cancel_reason: reason, cancelled_at: nowIso });
      return done("cancelled");
    }
    // A cancel first asked on an earlier turn and still not carried out is a fault; one asked this turn is the venue a
    // moment behind, as far as anyone can tell (`PM_LIVE_CANCEL_REREAD_MS`).
    const askedBefore = !!o.cancel_requested_at && Date.parse(o.cancel_requested_at) < Date.parse(nowIso);
    if (!o.cancel_requested_at) await patch(o, { cancel_requested_at: nowIso, cancel_gate: gate, cancel_reason: reason });
    // The DELETE's own word decides nothing, a lost reply included: only the read-back below does.
    try {
      const c = await venue.cancelOrder(o.hash);
      if (!c.ok) report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… ${c.refused ? `refused here (${c.error})` : `answered ${c.status} ${c.error}`}`);
    } catch (e) { report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… has no reply (${msg(e)}); read back`); }
    const r = await readAfterCancel(o);
    if (!r.ok || !r.data) { report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… could not be read back (${r.status} ${r.error}); the slot is FROZEN until it is`); return done("frozen"); }
    await applyReadBack(o, r.data);
    if (o.state === "cancelled" || o.state === "rejected") return done("cancelled");
    if (o.state === "filled") return done("filled");
    // Never replaced before the venue shows it gone: the slot is frozen, and every later turn asks again.
    if (askedBefore) {
      report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… first asked at ${o.cancel_requested_at} and sent again, and the venue still shows it ${r.data.status}; the slot is FROZEN: no replacement until the venue shows it cancelled`);
    }
    return done("frozen");
  };

  /** The rows this turn wrote, as `patch` leaves them: with `openAll`'s, what rests after the turn (`detail.after`). */
  const posted: PmOrderRow[] = [];
  /** Write the order `pending` (the slot's claim), then send it (live) or record what the venue would say (dry-run). */
  const post = async (w: Want, reason: string) => {
    const label = slotLabel(w);
    if (elapsed() > PM_LIVE_SEND_UNTIL_MS) { withhold(slotKey(w), "time", `${Math.round(elapsed() / 1000)} s into the turn, past the ${PM_LIVE_SEND_UNTIL_MS / 1000} s after which nothing is sent; next minute`); return; }
    if (posts >= lim.maxPosts) { withhold(slotKey(w), "governor", `${posts} POSTs today, the limit is ${lim.maxPosts}`); return; }
    // A quote the venue refused is not sent again without new information (PR5's live verification, 2026-10-01, found its
    // refused post-only exits re-sent every turn: 872 of 1,150 exit POSTs in a calm market).
    const wait = refusalWait(lastInSlot.get(slotKey(w)), w);
    if (wait) { withhold(slotKey(w), "refused", wait); return; }
    // Post-only, against the venue's whole book: our own orders still there (a cancel not confirmed, a POST not settled)
    // are in it, and an order that would take one of them is refused as crossing. Withheld here instead of sent.
    const at = inYesBook(w);
    const ours = openAll.find((o) => o.mode === mode && isOpenRow(o) && o.cond === w.cond && slotKey(o) !== slotKey(w) && (() => {
      const y = inYesBook(ownOf(o));
      return y.side !== at.side && (at.side === "bid" ? y.price <= at.price + 1e-9 : y.price >= at.price - 1e-9);
    })());
    if (ours) { withhold(slotKey(w), "post_only", `${w.side} ${w.outcome} at ${w.price} would take our own ${ours.state} order ${ours.hash.slice(0, 12)}… (${ours.outcome} ${ours.side} at ${Number(ours.price)}), still in the book`); return; }
    const maker = d.account?.maker ?? null, signer = d.account?.signer ?? null;
    if (!maker || !signer) { withhold(slotKey(w), "account", "no stored funder and signer: an order's hash needs both"); return; }
    if (mode === "live" && !(await holdLease())) { withhold(slotKey(w), "lease", `this run no longer holds the ${inst.lock} lease: it sends nothing more`); return; }
    const expiration = nowS + PM_GTD_EARLY_S + lifetime;
    const built = buildOrder({
      tokenId: w.token, side: w.side, price: w.price, size: w.size, tick: w.tick, negRisk: w.negRisk, maker, signer,
      salt: (d.salt ?? newSalt)(), timestampMs: d.now, expiration,
    });
    const request: PmOrder & { exchange: string; orderType: "GTD"; postOnly: true } = { ...built.order, exchange: built.exchange, orderType: "GTD", postOnly: true };
    const bookSeen = { bestBid: w.book.bestBid, bestAsk: w.book.bestAsk, tick: w.tick, minSize: w.minSize, negRisk: w.negRisk, at: w.book.at, hash: w.book.hash, facing: w.facing };
    let row: PmOrderRow;
    try {
      [row] = await db.insert<PmOrderRow>(T.orders, {
        mode, cond: w.cond, token: w.token, outcome: w.outcome, side: w.side, price: w.price, size: w.size, order_type: "GTD", post_only: true,
        expiration, neg_risk: w.negRisk, hash: built.hash, state: "pending", gate: w.gate, reason, book_seen: bookSeen, request,
      }, true);
    } catch (e) {
      if (/duplicate key|23505|409/.test(msg(e))) { report.errors.push(`${label}: another open order holds this slot, or this hash exists; nothing sent`); return; }
      throw e;
    }
    posted.push(row);
    posts++;
    report.posts++;
    if (mode === "dry_run") {
      await patch(row, { state: "live", response: { dryRun: true, wouldRest: true } });
      report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: "live" });
      return;
    }
    let reply: PmReply<PmSendReply>;
    try {
      const signature = d.signer!.signDigest(built.hash);
      reply = await venue.postOrder({ ...built.order, signature }, "GTD", true);
    } catch (e) {
      report.errors.push(`${label}: ${built.hash.slice(0, 12)}… has no reply (${msg(e)}); left pending, to be settled by its hash`);
      report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: "pending" });
      return;
    }
    const out = postOutcome(reply, built.hash);
    const response = { status: reply.status, ok: reply.ok, data: reply.data ?? null, error: reply.error ?? null, refused: reply.refused ?? null, retryAfterS: reply.retryAfterS ?? null, why: out.why, retry: out.retry ?? false };
    if (out.state === "pending") {
      await patch(row, { response });
      report.errors.push(`${label}: ${built.hash.slice(0, 12)}… — ${out.why}; it stays pending for the read-back`);
    } else await patch(row, out.state === "rejected" ? { state: "rejected", cancelled_at: nowIso, response } : { state: "live", response });
    report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: row.state });
  };

  // The global pause: everything open is cancelled (the kill switch, one request for the lot), nothing is placed.
  if (g.cancelAll) {
    // Each live order is marked as asked to cancel, so the turn after can tell a cancel-all the venue is a moment behind
    // on (no fault) from one it has not carried out (a fault), as for a single cancel.
    const live = open.filter((o) => o.mode === "live");
    const askedBefore = new Set(live.filter((o) => o.cancel_requested_at && Date.parse(o.cancel_requested_at) < Date.parse(nowIso)).map((o) => o.id));
    if (live.length) {
      for (const o of live) {
        try { if (!o.cancel_requested_at) await patch(o, { cancel_requested_at: nowIso, cancel_gate: "global_pause", cancel_reason: "agent_risk.global_pause" }); }
        catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
      }
      try {
        const c = await venue.cancelAll();
        if (!c.ok) report.errors.push(`cancel-all ${c.refused ? `refused here (${c.error})` : `answered ${c.status} ${c.error}`}`);
      } catch (e) { report.errors.push(`cancel-all has no reply (${msg(e)}); every order is read back`); }
    }
    for (const o of open) {
      try {
        if (o.mode === "dry_run") await cancel(o, "global_pause", "agent_risk.global_pause");
        else if (await readBack(o, true) && isOpenRow(o) && askedBefore.has(o.id)) {
          report.errors.push(`${slotLabel(o)}: still ${o.state} after the global pause's cancel-all, first asked at ${o.cancel_requested_at}; it is asked again next minute`);
        }
      } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
  } else {
    // Rows of the other mode: the dry-run's give way to a live path; a live path that went back to dry-run cancels its own.
    for (const o of open.filter((x) => x.mode !== mode)) {
      try { if (!untouchable(o)) await cancel(o, "mode", `the path is ${mode === "live" ? "live" : "in dry-run"}`); } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
    const mine = open.filter((x) => x.mode === mode && isOpenRow(x));
    const replace: Want[] = [];
    // Cancels first, so their collateral is free before anything new is sent.
    for (const o of mine) {
      try {
        if (o.state === "pending" || unreadable.has(o.id)) continue;                            // in flight or unread: never a second order
        if (o.cancel_requested_at) { await cancel(o, o.cancel_gate ?? "cancel", o.cancel_reason ?? "an earlier cancel"); continue; }
        const slot = slotKey(o);
        const w = wants.get(slot);
        if (!w) {
          // Live-prep manages the markets it carries as well (its exits rest there).
          const managed = markets.some((m) => m.cond === o.cond && (m.quoting || !!inst.lp));
          await cancel(o, withheld.get(slot) ?? (!managed ? "selection" : books.get(o.cond) ? "rule" : "book"),
            !managed ? "the market is not in today's selection" : books.get(o.cond) ? "the rule wants nothing resting here" : "the book is unreadable or one-sided");
          continue;
        }
        const samePrice = Math.abs(Number(o.price) - w.price) < 1e-9 && Math.abs(Number(o.size) - w.size) < 1e-9;
        const lifeLeft = Number(o.expiration) - PM_GTD_EARLY_S - nowS;
        if (samePrice && lifeLeft > PM_LIVE_REFRESH_S) { wants.delete(slot); continue; }   // resting as wanted
        const c = await cancel(o, samePrice ? "refresh" : "reprice", samePrice ? `${lifeLeft} s left of its life` : `the rule's price is ${w.price} × ${w.size}`);
        wants.delete(slot);
        if (c === "cancelled") replace.push(w);
      } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
    const blocked = new Set(mine.filter((o) => isOpenRow(o) && (o.state === "pending" || unreadable.has(o.id) || !!o.cancel_requested_at)).map(slotKey));
    for (const w of [...replace, ...wants.values()]) {
      try {
        if (blocked.has(slotKey(w))) continue;
        await post(w, replace.includes(w) ? "replacement" : "new");
      } catch (e) { report.errors.push(`${slotLabel(w)}: ${msg(e)}`); }
    }
  }

  // ── 6. the minute's record ────────────────────────────────────────────────────────────────────────────────────────
  // Beside each minute's formula (the quotes that rested when the book was read), the formula of what rests AFTER this
  // turn against the same book with those quotes in it, as the venue would hold them (`detail.after`, 2026-10-04): the
  // reward of the minute those quotes start, which is what the paper layer pays a minute where it rests RW's quote.
  for (const r of minuteRows) {
    const m = markets.find((x) => x.cond === r.cond), b = books.get(r.cond);
    if (!m || !b) continue;
    const after = [...openAll, ...posted].filter((o) => o.mode === mode && o.cond === r.cond && o.state === "live").map(ownOf);
    const fa = minuteFormula({ rate: r.rate, v: r.max_spread, minSize: r.min_size, levels: b.levels, inBook: inBookAtRead.get(r.cond) ?? [], quotes: after });
    r.detail.after = { formula: fa.formula, ours: fa.ours, others: fa.others, m: fa.m, orders: after.length };
    // Live-prep: what the turn decided the market on (its state, the holdings, N), for its paper layer; and what the caps
    // counted after the turn (holdings at cost and resting buys, in all and in this market), for its pre-registration's
    // check.
    if (inst.lp) {
      r.detail.lp = { ...(lpDetail.get(r.cond) ?? {}), committed: Math.round(committed * 1e6) / 1e6, committedMarket: Math.round((byMarket.get(r.cond) ?? 0) * 1e6) / 1e6 };
    }
  }
  if (minuteRows.length) {
    try { await db.upsert(T.minutes, minuteRows, "mode,minute,cond"); } catch (e) { report.errors.push(`minutes not recorded (${msg(e)})`); }
  }

  // ── 7. the readout: once a UTC day, after Polymarket's midnight payout ───────────────────────────────────────────
  const readouts: Record<string, { reads: number; at: string }> = { ...(prev.readouts ?? {}) };
  let readoutTriedAt: string | null = prev.readoutTriedAt ?? null;
  if (d.now - dayStart >= PM_LIVE_READOUT_AFTER_MS && (!readoutTriedAt || d.now - Date.parse(readoutTriedAt) >= READOUT_RETRY_MS)) {
    // Yesterday once, the day before a second time (a late posting); never a day twice on one UTC day.
    const due = Array.from({ length: PM_LIVE_READOUT_DAYS }, (_, k) => dayOf(dayStart - (k + 1) * DAY))
      .filter((dd, k) => (readouts[dd]?.reads ?? 0) < k + 1 && readouts[dd]?.at?.slice(0, 10) !== day);
    const done: Array<Record<string, unknown>> = [];
    for (const dd of due) {
      if (pastDeadline(deadline)) break;
      readoutTriedAt = nowIso;
      try {
        const r = await readout(d, inst, dd, nowIso, deadline);
        if (r.error) { report.errors.push(`readout of ${dd}: ${r.error}`); break; }
        readouts[dd] = { reads: (readouts[dd]?.reads ?? 0) + 1, at: nowIso };
        report.readout.push({ day: dd, markets: r.markets, actual: r.actual, formula: r.formula });
        done.push({ day: dd, read: readouts[dd].reads, ...r });
      } catch (e) { report.errors.push(`readout of ${dd}: ${msg(e)}`); break; }
    }
    if (done.length) {
      try { await db.upsert(T.events, [{ mode, minute, kind: "readout", detail: { days: done } }], "mode,minute,kind"); }
      catch (e) { report.errors.push(`readout not recorded as an event (${msg(e)})`); }
    }
  }
  for (const k of Object.keys(readouts)) if (k < dayOf(dayStart - 7 * DAY)) delete readouts[k];

  // ── the record: the gates and the market conditions when they change, the governor, and this turn ────────────────
  for (const c of goneToday) conditions[c] ??= "left the book (404)";
  report.conditions = conditions;
  const gateKey = JSON.stringify({ v: g.verdicts, region: d.sbRegion, country: geo.country, mode });
  const conditionKey = JSON.stringify(Object.entries(conditions).sort());
  try {
    if (prev.gateKey !== gateKey) {
      await db.upsert(T.events, [{ mode, minute, kind: "gates", detail: { verdicts: g.verdicts, openBlockedBy: g.openBlockedBy, reduceBlockedBy: g.reduceBlockedBy, sbRegion: d.sbRegion, geo, closedOnly, attested, before: prev.gates ?? null } }], "mode,minute,kind");
    }
    if ((prev.conditionKey ?? "[]") !== conditionKey) {
      await db.upsert(T.events, [{ mode, minute, kind: "condition", detail: { now: conditions, before: prev.conditions ?? {} } }], "mode,minute,kind");
    }
    if (posts >= lim.maxPosts && prev.governorDay !== day) {
      await db.upsert(T.events, [{ mode, minute, kind: "governor", detail: { posts, limit: lim.maxPosts } }], "mode,minute,kind");
    }
    await db.upsert(T.state, [{
      id: 1, updated_at: nowIso, last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null,
      state: {
        at: nowIso, minute, mode, why: report.why, sbRegion: d.sbRegion, sendsEnabled: d.sendsEnabled, dryRun: cfg.dry_run, armed: !!cfg.live_confirmed_at,
        // Whether a signing key for the stored signer is loaded, read before the go-time statement: `why` names it only once
        // dry_run is off. Never the key itself: `signerProblem` is one of the loader's fixed sentences.
        keyed, signerProblem: keyed ? null : (d.signerProblem ?? null),
        attested, gates: g.verdicts, openBlockedBy: g.openBlockedBy, reduceBlockedBy: g.reduceBlockedBy, gateKey, geo, geoCachedFrom: g0.geo.cachedFrom,
        geoGood: g0.good, geoStaleReported: g0.staleReported, closedOnly, pusd,
        limits: lim, posts: { day, [mode]: posts }, governorDay: posts >= lim.maxPosts ? day : prev.governorDay ?? null, pnl,
        // The day stop's opening marks, and this turn's marks for the next day's (`dayOpenMarks`).
        ...(dayOpen ? { dayOpen, marks: Object.fromEntries(Object.entries(marks).filter((e) => e[1] != null)), marksAt: nowIso } : {}),
        selectionDay: day, selectionTriedAt, goneDay: day, gone: [...goneToday, ...goneNow.map((x) => x.cond)],
        conditions, conditionKey, readouts, readoutTriedAt,
        // Settled markets whose tokens a turn has read gone from the chain: redeemed, no longer watched.
        redeemed: [...redeemed, ...[...unredeemed, ...newSettlements].filter((s) => [s.yes_token, s.no_token].every((t) => heldOf.has(t) && heldOf.get(t) === 0)).map((s) => s.cond)],
        markets: report.markets, minutes: report.minutes, withheld: report.withheld,
        open: (await db.select<{ id: number }>(T.orders, "state=in.(pending,live)&select=id&limit=50")).length,
        // Live-prep's pause (`pauseAfterJump`): the markets this turn read, a pause only while it lasts; and what its stop
        // counted as paid.
        ...(inst.lp ? {
          lp: {
            lastMid: Object.fromEntries(Object.entries(pauseState.lastMid).filter(([c]) => markets.some((m) => m.cond === c))),
            pausedUntil: Object.fromEntries(Object.entries(pauseState.pausedUntil).filter(([c, u]) => u > Math.floor(d.now / M) * M && markets.some((m) => m.cond === c))),
            paid, holdings: paper ? "paper" : "account",
          },
        } : {}),
      },
    }], "id");
  } catch (e) { report.errors.push(`state not recorded (${msg(e)})`); }
}

type ReadoutResult = { markets: number; actual: number; sponsored: number; formula: number; formulaScored: number; rebates: number; total: number | null; error?: string };

/**
 * One UTC day's readout, written whole or not at all: what Polymarket paid the account per market (`/rewards/user`,
 * native, then sponsored only, every page from "MA==" as the official clients page it), the day's total over both
 * (`/rewards/user/total?sponsored=true`), the maker rebates paid to the proxy wallet (`/rebates/current`), and the day's
 * minutes from `pm_live_minutes`: per market and mode, the minutes with a quote, with both sides scored by RW's formula,
 * with both sides the venue called scoring, and the formula's sums.
 *
 * TOLD APART PER PATH (2026-10-04). Polymarket pays the account, and two paths quote from it (mini-pool and mid-pool,
 * never both armed), so a path books what was paid only for the markets its own minutes show it quoting live that day:
 * R = Σ actual / Σ formula over its own live rows, and a market the other path quoted is never its. A paid market no live
 * minute of this path shows is no row of its (until then it was a live row with no minutes, which put every payout of
 * the account in mini-pool's readout); the account's own day total stays on every row (`detail.total`) and in the
 * readout's event, so what neither path's rows hold can still be seen. An instance that reads no payouts in dry-run
 * (`readsPayouts` false) reads them only for a day its own minutes show it quoting live; otherwise its rows are its own
 * minutes' formula sums and nothing of the account is read.
 */
async function readout(d: PmLiveDeps, inst: PmLiveInstance, dd: string, nowIso: string, dl: PmDeadline): Promise<ReadoutResult> {
  const { db, venue } = d;
  const T = inst.tables;
  const empty: ReadoutResult = { markets: 0, actual: 0, sponsored: 0, formula: 0, formulaScored: 0, rebates: 0, total: null };
  const earnings = async (sponsored: boolean): Promise<{ rows: PmUserEarning[]; error?: string }> => {
    const rows: PmUserEarning[] = [];
    let cursor = "MA==";
    for (let page = 0; page < EARNING_PAGES; page++) {
      if (pastDeadline(dl)) return { rows, error: "time budget: the earnings were not read to their end" };
      const r = await venue.userEarnings(dd, sponsored, cursor);
      if (!r.ok) return { rows, error: `rewards/user (sponsored ${sponsored}): ${r.status} ${r.error}` };
      rows.push(...(Array.isArray(r.data?.data) ? r.data!.data! : []));
      cursor = typeof r.data?.next_cursor === "string" ? r.data.next_cursor : "LTE=";
      if (!cursor || cursor === "LTE=") return { rows };
    }
    return { rows, error: `rewards/user (sponsored ${sponsored}): more than ${EARNING_PAGES} pages` };
  };
  type Paid = { nat: PmUserEarning[]; spo: PmUserEarning[]; tot: PmReply<PmUserEarning[]> | null; reb: PmReply<PmRebate[] | null> | null };
  /** What the account was paid that day: both earnings lists read whole, the day's total and the maker rebates; or why not. */
  const payouts = async (): Promise<Paid | { error: string }> => {
    const nat = await earnings(false);
    if (nat.error) return { error: nat.error };
    const spo = await earnings(true);
    if (spo.error) return { error: spo.error };
    const tot = await venue.userEarningsTotal(dd, true);
    if (!tot.ok) return { error: `rewards/user/total: ${tot.status} ${tot.error}` };
    const maker = d.account?.maker ?? null;
    const reb = maker ? await venue.rebates(dd, maker) : null;
    if (reb && !reb.ok) return { error: `rebates/current: ${reb.status} ${reb.error}` };
    return { nat: nat.rows, spo: spo.rows, tot, reb };
  };
  let got: Paid = { nat: [], spo: [], tot: null, reb: null };
  // The default reads them first, every day, in either mode, as it always has.
  if (inst.readsPayouts) {
    const p = await payouts();
    if ("error" in p) return { ...empty, error: p.error };
    got = p;
  }
  const usd = (e: PmUserEarning) => num(e.earnings) * (Number(e.asset_rate) > 0 ? Number(e.asset_rate) : 1);
  const paid = (rows: PmUserEarning[]) => {
    const out = new Map<string, number>();
    for (const e of rows) { const c = String(e.condition_id ?? "").toLowerCase(); if (c) out.set(c, (out.get(c) ?? 0) + usd(e)); }
    return out;
  };
  const start = `${dd}T00:00:00.000Z`, end = iso(Date.parse(start) + DAY);
  const mins = await db.selectAll<PmMinuteRow>(T.minutes, `minute=gte.${enc(start)}&minute=lt.${enc(end)}&select=mode,minute,cond,rate,bid_size,ask_size,bid_scoring,ask_scoring,ours,formula_usd&order=mode.asc,minute.asc,cond.asc`);
  type Agg = { mode: PmLiveMode; cond: string; minutes: number; two: number; scored: number; formula: number; formulaScored: number; rate: number };
  const agg = new Map<string, Agg>();
  for (const r of mins) {
    const k = `${r.mode}|${r.cond}`;
    const a = agg.get(k) ?? { mode: r.mode, cond: r.cond, minutes: 0, two: 0, scored: 0, formula: 0, formulaScored: 0, rate: num(r.rate) };
    if (r.bid_size != null || r.ask_size != null) a.minutes++;
    if (num(r.ours) > 0) a.two++;
    const both = r.bid_scoring === true && r.ask_scoring === true;
    if (both) { a.scored++; a.formulaScored += num(r.formula_usd); }
    a.formula += num(r.formula_usd);
    agg.set(k, a);
  }
  // One that reads no payouts in dry-run reads them for a day its own minutes show it quoting live.
  if (!inst.readsPayouts && [...agg.values()].some((a) => a.mode === "live")) {
    const p = await payouts();
    if ("error" in p) return { ...empty, error: p.error };
    got = p;
  }
  // A payout is booked on this path's own live rows only: a market its live minutes do not show is not its to count.
  const native = paid(got.nat), sponsored = paid(got.spo);
  const rebates = new Map<string, number>();
  for (const x of Array.isArray(got.reb?.data) ? got.reb!.data! : []) { const c = String(x.condition_id ?? "").toLowerCase(); if (c) rebates.set(c, (rebates.get(c) ?? 0) + num(x.rebated_fees_usdc)); }
  const rows = [...agg.values()].map((a) => ({
    mode: a.mode, day: dd, cond: a.cond, minutes: a.minutes, minutes_two_sided: a.two, minutes_scored: a.scored,
    formula_usd: Math.round(a.formula * 1e6) / 1e6, formula_scored_usd: Math.round(a.formulaScored * 1e6) / 1e6, rate: a.rate,
    actual_usd: a.mode === "live" ? native.get(a.cond) ?? 0 : null, actual_sponsored_usd: a.mode === "live" ? sponsored.get(a.cond) ?? 0 : null,
    rebate_usd: a.mode === "live" ? rebates.get(a.cond) ?? 0 : null, read_at: nowIso,
    detail: { total: got.tot?.data ?? null, rebatesRead: got.reb ? got.reb.status : null },
  }));
  if (rows.length) await db.upsert(T.rewardDays, rows, "mode,day,cond");
  const live = rows.filter((r) => r.mode === "live");
  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1e6) / 1e6;
  return {
    markets: rows.length, actual: sum(live.map((r) => (r.actual_usd ?? 0) + (r.actual_sponsored_usd ?? 0))), sponsored: sum(live.map((r) => r.actual_sponsored_usd ?? 0)),
    formula: sum(live.map((r) => r.formula_usd)), formulaScored: sum(live.map((r) => r.formula_scored_usd)), rebates: sum(live.map((r) => r.rebate_usd ?? 0)),
    total: Array.isArray(got.tot?.data) ? sum(got.tot!.data.map(usd)) : null,
  };
}
