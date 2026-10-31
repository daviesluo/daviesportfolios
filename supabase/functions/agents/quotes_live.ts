// PR5's quotes on their own Revolut X sub-account: the paper engine's decisions, carried out order for order, in DRY-RUN
// until Davies' word (reference §4 item 35; the design, its risk table and its build list are
// docs/agents/reviews/2026-09-24-pr5-live-design.md).
//
// WHAT IT EXECUTES: the paper engine's decisions, and none of its own. `quotes.ts` runs PR5's frozen rule every minute
// and stores its state (`agent_quote_state`). This module runs right after it, reads that state, and carries out what
// each of the twelve paper rungs is doing:
//   * A rung this book holds nothing on quotes exactly the paper rung's entry order: the same side and price (the paper's
//     ticks), and one POST per paper decision. A decision is a placement, a re-price or a re-placement, keyed by the paper
//     order's id and the minute it goes live. While the paper rung quotes nothing, the live rung quotes nothing either.
//     That covers dark, withdrawn, a paper position of its own, and an order the paper engine refused at go-live.
//   * A rung this book DOES hold exits at fair. A venue fill makes it held, whatever the paper rung did. The exit price is
//     the rule's own `exitTicks` on the paper engine's own fair for the minute, re-priced by the rule's own 0.05 % step.
//     After 24 hours the rung is stopped as the rule stops it, as a taker. Here the stop is an IOC bounded at fair ± 50 bps.
// So every entry order is a paper order: `paper_oid` and `paper_live` join it to `agent_quote_events`. The two books
// differ only where the VENUE decided differently from the paper engine: a post-only order it refused (or that crossed the
// book the executor met, which it refuses), a fill the paper's prints did not prove, or one they did prove that the venue
// did not give.
//
// WHAT IT NEVER DOES:
//   * It never prices an order the rule did not price, but one way: from 2026-10-29 an exit whose rule price the book it
//     meets shows crossing rests one tick inside the opposite best, a price better for us than the rule's (`exitTicksOnBook`).
//   * It never places a second order on a rung. The database's partial unique index refuses one, and a replacement waits
//     until the cancel is READ BACK as cancelled or filled, never on the DELETE's word. A rung whose cancel cannot be
//     confirmed is frozen and reported every minute.
//   * It never books a fill it has not read back from the venue. The read goes through the active list, then the history
//     by client id, then GET /orders/{id}, as the strategy rows' orders do. A buy settles by `bookLiveBuy`, the tick's own
//     D11/D12 rule: whole base steps, and the account's balance when the fee was not reported.
//   * It never marks an order the venue shows nowhere as rejected. That order stays `pending`, reported, for a person.
//   * It never sends an entry while `dry_run` is on. A dry-run order is a row: its price, size, client id and the book it
//     met. `dry_run` does not make it abandon a live book it already holds. After a live period it winds that book
//     down: live entries are cancelled, and exits and stops stay armed. Reading the sub-account's balances is a signed
//     GET, which the dry-run does when the key loads ("the dry-run on the real account").
//   * It never sends a post-only order the book it met shows crossing, in either mode. The row is recorded refused, as
//     the venue refuses it, and counts as no POST. Until 2026-10-02 a live one was sent all the same: the venue refused
//     all four the executor had read as crossing, 30 ms before, and none of the 465 it had not. From 2026-10-29 an exit
//     the book shows crossing is not refused but rests inside it, and one still crossing is a skip, not a row.
//
// ITS HARD LIMITS, each enforced here and pinned in quotes_live.test.ts:
//   * The order governor, on its own POSTs in a UTC day. At 900 the entry quotes are withdrawn, which costs DELETEs only,
//     and exits and stops go on. At 950 nothing is placed but the 24-hour stops.
//   * A refused exit waits as the rule's own refused order waits: it is sent again only once the paper engine holds a
//     newer print than it held at the refusal, and that print is not through the exit's price.
//   * The daily loss stop. At −1 % of capital, realised today plus marked, there are no entries for the rest of the UTC day.
//   * The de-peg guard. A book quotes no entry while its USD book's last hourly close is more than 50 bps from its 24-hour
//     median, or while the GBP book's last print is more than 50 bps from fair.
//   * Stale inputs. No entry quotes when the paper engine has not decided the minute just closed, when GBP/USD is older
//     than ten minutes (the rule makes that dark), or when the USD book's newest hour ended more than two hours before.
//     Exits keep their price.
//   * The 24-hour stop is an IOC bounded at fair ± 50 bps. If it comes back unfilled, that is an alert: the book quotes no
//     entries while it holds a position past its stop, and the stop is tried again an hour later, not every minute.
//   * The kill switch. `live_confirmed_at` cleared cancels every live entry and places none, and exits and stops stay
//     armed. `agent_risk.global_pause` cancels every open order, exits included, and places nothing.
//   * Inventory. A quote the account cannot cover is not placed. A bid needs free GBP. An ask needs free coin beyond what
//     the book's own longs will sell. With none, the ask is SKIPPED: an event, not an error, and the same turn tops the
//     book's coin up itself (Davies, 2026-10-02): a maker conversion at the top of the bids, back to three asks' worth
//     and 2 % over, out of the GBP the entries leave free, one at a time a book, at most £5 a book in a UTC day,
//     cancelled after 30 minutes unfilled (`planTopUps`). The operator's conversion, `runQuotesConvert`, stays for
//     capital added; on the live account it follows the bid while it rests (2026-10-28, `convertRepegDue`).
//   * The coin rebook (`rebookOn`, 2026-10-29): for three days after new weights come into force (LIVE's USDT-GBP alone
//     from QUOTE_LIVE_USDT_ONLY_FROM) a book's surplus coin is sold by a post-only order at the top of the asks and never
//     under fair (`planDrains`), and the book that is short is topped up with no £5 cap; makers only, no conversion loss.

import { ceilToStep, floorToStep, type PairConfig } from "../_shared/agents_strategy.ts";
import { revxPublic } from "../_shared/revx.ts";
import type { OrderView, Venue } from "../_shared/venue.ts";
import type { Db } from "./db.ts";
import {
  blocks, exitTicks, fairUAt, fxAt, QUOTE_BOOKS, QUOTE_FX_LOOKBACK_MS, QUOTE_REPRICE, QUOTE_REVX_GAP_MS, QUOTE_RUNGS, QUOTE_STOP_MS, QUOTE_TICK, QUOTE_USD_BOOK,
  quoteTicks, type Print, type QuoteBook, type QuoteState, type Rung, type Side,
} from "./quotes.ts";
import { bookLiveBuy, fillStamp, isUniqueViolation, withFeeNote, type FromAccount } from "./tick.ts";
import { inQuoteClosure, weekendInputs, type WeekendRule } from "./quotes_weekend.ts";
import { nudgedFair, type FairNudgeRule, type NudgeRec, type NudgeState } from "./quotes_nudge.ts";
/** The weekend rule as the live account's weekend source reads fair: in force at every closure minute it is used in. */
const LIVE_WEEKEND_RULE: WeekendRule = { from: 0 };

const M = 60e3, H = 3600e3, DAY = 86400e3;

/** The venue's name for each paper book (requests use the dash, the venue client takes the slash). */
export const LIVE_SYMBOL: Record<QuoteBook, "USDC/GBP" | "USDT/GBP"> = { "USDC-GBP": "USDC/GBP", "USDT-GBP": "USDT/GBP" };
/**
 * Where one instance of this executor keeps its record, which paper engine's decisions it carries out, and how its POSTs
 * are governed (2026-10-02, Davies: the TESTING rows are to be realistic, "确保真实"). The live account is
 * `QUOTE_LIVE_INSTANCE`, the code as it ran before instances existed (`quotes_live_instance.test.ts` runs it beside
 * `quotes_live_frozen.ts`, that file byte for byte, and finds every table, account and report the same); the realistic
 * twins (`quotes_twin.ts`) are two more, each on tables of its own against a SIMULATED Revolut X account, so every rule
 * of the live executor applies to them by construction.
 */
export type QuoteLiveInstance = {
  /** Its four tables, in 0052's shapes: the config row, the orders, the events and the turn's state. */
  config: string; orders: string; events: string; state: string;
  /** The migration that creates them, named when they are missing. */
  migration: string;
  /** The paper engine whose decisions it carries out: a table with `id` 1, `state` (a `QuoteState`) and `last_minute`. */
  paper: string;
  /** Its lease in `agent_locks`. */
  lease: string;
  /** Each rung's distance from fair, the same on both sides of both books, in the order the paper engine keeps them. */
  rungs: readonly number[];
  /** How far fair moves before a resting exit is re-priced: the rule's own step. */
  exitReprice: number;
  /**
   * The key a rung's POSTs count against, governed at QUOTE_LIVE_ENTRY_POSTS / QUOTE_LIVE_STOPS_ONLY_POSTS each: one for
   * the live account, whatever the rung; a conversion (no rung side) counts against its book's ask key.
   */
  govKey: (book: QuoteBook, rungSide: Side | null) => string;
  /**
   * TAKE (docs/agents/reviews/2026-10-03-take-prereg.md), from `from` (ms): before a rung's paper entry, a taker IOC when
   * the recorded book rests through the rung by its fee (`takeTriggered`). The live account's instance has none.
   */
  take?: { from: number };
  /**
   * Rungs that quote no entry from `from` (ms): their paper decisions are not carried out and a resting entry is
   * withdrawn, while a holding still exits and stops as any rung's, and the coin the asks hold leaves them out
   * (`asksNeedOf`). Each rung keeps its share of the capital over every rung. Rule D's twin, its 0.03 % rung from
   * 2026-10-10 (Davies, 2026-10-09: "…"规则 D 最内层的档位基本不赚钱"这个档删了"; the twins' pre-registration's deviation 4).
   * The live account's instance has none.
   */
  retired?: { ks: readonly number[]; from: number };
  /**
   * The exit `ticks` beyond the rule's own (`exitTicks`) in the position's favour, from `from` (ms): a long sells that many
   * ticks over fair rounded up, a short buys back that many under fair rounded down, both when the exit is placed and when
   * it is re-priced; the 24-hour stop is not moved. "Stablecoin quotes variant-3" (`p50x1`,
   * docs/agents/reviews/2026-10-09-p50x1-prereg.md) the first. The live account's instance has it, one tick, from
   * QUOTE_LIVE_EXIT_OFFSET_FROM (2026-10-30 00:00 UTC; offset 0, the rule's, before). The offset price is the rule's price
   * `exitTicksOnBook` meets the book with, so an exit it would put across the book still rests one tick inside it.
   */
  exitOffset?: { ticks: number; from: number };
  /**
   * PR5-W's weekend rule from `from` (ms; quotes_weekend.ts): inside an FX closure, a paper minute whose GBP/USD is dark is
   * read at the paper engine's last X (its book's `lastX`), so fair, the entry guards and the exits' re-pricing stand on the
   * rate the replica decided on, not dark. "Stablecoin quotes variant-3" (`take50wk`, 0130,
   * docs/agents/reviews/2026-10-18-revx-weekend-prereg.md) the first. The live account's instance has none: dark, PR5's.
   */
  weekend?: WeekendRule;
  /**
   * A twin's simulated account only (revx_sim.ts; the executor never reads it): from `from` (ms), a public print AT a resting
   * order's price, its aggressor on the other side, fills it as a print through it does, by the print's quantity. LIVE's own
   * record (2026-10-01 → 10-21, docs/agents/backtests/livesim/) filled 317 of its 502 filled maker orders with prints only at
   * their price; the through-only rule missed two in three of them. The live account's instance has none.
   */
  simFill?: { model: "at"; from: number };
  /**
   * The live account's switches (0131, `agent_quote_live_config.take_mode` and `weekend_mode`) and the table of its weekend
   * replica (`agents/quotes_live_weekend.ts`). The live account's instance alone has them: a twin's config has no such columns.
   */
  liveSwitches?: { wkPaper: string };
  /**
   * PR5-OPT's capital split (docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md), from `from` (ms): a rung's pounds are
   * the capital × w(book) × w(side) × w(k) ÷ the same summed over every rung of the instance (a weight not named is 1), in
   * place of the capital over every rung (`rungGbp`). A rung of weight 0 quotes no entry, as a retired rung, while a holding
   * still exits; its pounds go to the others. The asks' coin (`asksNeedOf`, `planTopUps`) and the operator's conversion cap
   * (`convertCapGbp`) follow each book's own asks. Equal weights are `rungGbp` exactly. The live account's instance has them
   * from QUOTE_LIVE_USDT_ONLY_FROM (USDC-GBP 0: USDT-GBP alone); weights from QUOTE_LIVE_REBOOK_SINCE or later rebook the coin
   * for QUOTE_LIVE_REBOOK_MS (`rebookOn`).
   */
  weights?: RungWeights;
  /**
   * PR5-OPT's holding line (the same pre-registration), from `from` (ms): a rung counts as holding only above max(the
   * venue's minimum, `gbp` of coin at fair), so a fill under it (the £0.10 prints on USDT-GBP since 2026-10-08) leaves the
   * rung's entry resting and its coin carried into the trip; over it, the exit sells the whole holding, and an exit once
   * resting runs to the venue's minimum. The 24-hour stop counts from the fill that crossed the line. The live account's
   * instance has it, £1, from QUOTE_LIVE_HOLD_MIN_FROM (2026-10-29 22:00 UTC; it had none before).
   */
  holdMin?: { from: number; gbp: number };
  /**
   * An operator's conversion follows the bid from `from` (ms; `convertRepegDue`; 2026-10-28, on Davies' word of 10-02): rested
   * QUOTE_LIVE_CONVERT_REPEG_MS under a best bid that has moved above it, it is cancelled and sent again at the top of the
   * bids for what it has not filled, under `runQuotesConvert`'s own checks, until QUOTE_LIVE_CONVERT_REST_MS from its
   * first send. The live account's instance alone: a twin's operator conversion rests as it did (no `TWIN_RULES` key).
   */
  convertRepeg?: { from: number };
  /**
   * When `exitTicksOnBook` starts for this instance: QUOTE_LIVE_EXIT_INSIDE_FROM, every instance's, when left out (the tests
   * move it to put the rule in force over their fixtures, or out of it).
   */
  exitInside?: { from: number };
  /**
   * When `rebookOn` starts counting weights as new for this instance: QUOTE_LIVE_REBOOK_SINCE, every instance's, when left
   * out (the tests move it to put a rebook over their fixtures). No twin rule sets it.
   */
  rebook?: { since: number };
  /** When the drain (`drainOn`) starts for this instance: QUOTE_LIVE_DRAIN_FROM, every instance's, when left out (the tests move it). No twin rule sets it. */
  drain?: { from: number };
  /**
   * The automatic top-ups' day (`planTopUps`): at most `maxGbpDay` a book in a UTC day (QUOTE_LIVE_TOPUP_MAX_GBP_DAY, £5, when
   * left out), and, with it set, a shortfall the free GBP cannot cover buys what that GBP buys. "Stablecoin quotes USDC/GBP"
   * (0180) buys its asks' first coin this way, by maker orders at the top of the bids, from an account that starts in pounds.
   */
  topUps?: { maxGbpDay: number };
  /**
   * REVX-FAIR's USDC-GBP nudge (quotes_nudge.ts; "Stablecoin quotes variant-7", 0169): from `from` (ms), the rule's book prices
   * its exits, its stop's bound and its guards off the fair its replica nudged for the minute carried out (`nudgedInputs`), as
   * the replica's own quotes do. A twin's rule alone: the live account's instance has none, and without it nothing changes.
   */
  fairNudge?: FairNudgeRule;
  /**
   * A twin booked in pounds and shown in dollars (0169; Davies: "做300美元funded"): `usd` its funded dollars, `gbpusd` the fixed
   * rate its spec row's pounds were set at (capital_gbp = usd ÷ gbpusd, to the penny). The page alone reads it (`twinInUsd`,
   * index.ts): FUNDED is `usd` exactly. The live account's instance has none.
   */
  usdCapital?: { usd: number; gbpusd: number };
};
/**
 * A book's inputs with its replica's nudge applied (`QuoteLiveInstance.fairNudge`): on the rule's book, from its instant, when
 * the replica's record is of the paper minute `T` this turn carries out and nudged it, fair is f × (1 + w × dev); otherwise
 * (no rule, another book, before `from`, a record of another minute, a fallback) the inputs as they are.
 */
export function nudgedInputs(i: BookInputs, book: QuoteBook, T: number, rule: FairNudgeRule | undefined, rec: NudgeRec | null | undefined): BookInputs {
  if (!rule || book !== rule.book || T < rule.from || i.f == null || !rec || rec.minute !== T) return i;
  const f = nudgedFair(i.f, rec, rule.w);
  return f === i.f ? i : { ...i, f };
}
/** The weights of `QuoteLiveInstance.weights`: by book, by side and by rung distance (the key is `String(k)`, "0.001"). */
export type RungWeights = { from: number; book?: Partial<Record<QuoteBook, number>>; side?: Partial<Record<Side, number>>; k?: Record<string, number> };
/**
 * From this instant the live account runs PR5-OPT's £1 holding line (`QuoteLiveInstance.holdMin`, variant-4's rule; Davies,
 * 2026-10-29: "如果基本可以肯定效果正面的话，加入实盘live的规则里和所有测试策略包括所有variant里", on the verdict of
 * docs/agents/reviews/2026-10-29-holdmin-verdict.md): a £0.10 print at a rung's price no longer makes it held and sends an exit
 * that loses pennies to the venue's rounding. Every running twin takes it at the same instant (migration 0176), so they keep
 * mirroring LIVE; recorded in docs/agents/reviews/2026-10-29-holdmin-deviation.md.
 */
export const QUOTE_LIVE_HOLD_MIN_FROM = Date.parse("2026-10-29T22:00:00Z");
/**
 * From this instant the live account quotes USDT-GBP alone (Davies, 2026-10-29: "…基本可以肯定效果正面的话，把live全换成只做USDT-GBP的
 * （live策略改名为Stablecoin quotes USDT/GBP）…（换币也用挂单不要有转换损失）", on docs/agents/reviews/2026-10-29-usdt-only.md):
 * `weights` give USDC-GBP's six rungs 0 and USDT-GBP's six the whole capital, a sixth each. USDC-GBP quotes no entry from
 * then; a USDC holding still exits and stops. Its coin is sold and USDT bought by maker orders alone (`rebookOn`). Every twin
 * on LIVE's rules takes the same weights at the same instant (migration 0178, its instant moved by 0179); recorded in
 * docs/agents/reviews/2026-10-29-usdt-only-deviation.md.
 */
export const QUOTE_LIVE_USDT_ONLY_FROM = Date.parse("2026-10-29T22:30:00Z");
/**
 * From this instant every exit of the live account rests a tick beyond the rule's price in the position's favour
 * (`QuoteLiveInstance.exitOffset`, variant-6's rule; Davies, 2026-10-29 ~23:00 UTC, "加进 LIVE", on
 * docs/agents/reviews/2026-10-29-usdt-no03.md: on USDT-GBP alone at £600, +1.49 % a year since 09-01, P(≤ 0) 0.048, out of
 * sample +4.63, P 0.000). Every twin on LIVE's rules takes it at the same instant (migration 0181); recorded in
 * docs/agents/reviews/2026-10-29-live-exit-tick-deviation.md.
 */
export const QUOTE_LIVE_EXIT_OFFSET_FROM = Date.parse("2026-10-30T00:00:00Z");
/**
 * The coin rebook (`rebookOn`): an instance whose weights come into force at this instant or later rebalances its coin to
 * them for QUOTE_LIVE_REBOOK_MS from that instant, by maker orders alone. Weights that came into force earlier (PR5-OPT's
 * twins of 2026-10-28) are as they were.
 */
export const QUOTE_LIVE_REBOOK_SINCE = Date.parse("2026-10-29T22:30:00Z");   // QUOTE_LIVE_USDT_ONLY_FROM's instant (the tests pin the two equal)
/**
 * How long a rebook runs from its weights' instant. By the rule each book's asks hold a quarter of the capital in coin (three
 * asks of £50 at £600): the switch sells about £150 of USDC and buys as much USDT, a few maker orders of each, re-sent every
 * 30 minutes at the book as it stands; three days leave room for a slow book and a weekend's thin one.
 */
export const QUOTE_LIVE_REBOOK_MS = 72 * H;
/** The live account: PR5's own sub-account, the paper engine's own state, three rungs, one key. */
export const QUOTE_LIVE_INSTANCE: QuoteLiveInstance = {
  config: "agent_quote_live_config", orders: "agent_quote_live_orders", events: "agent_quote_live_events", state: "agent_quote_live_state",
  migration: "0052", paper: "agent_quote_state", lease: "quotes-live", rungs: QUOTE_RUNGS, exitReprice: QUOTE_REPRICE, govKey: () => "account",
  liveSwitches: { wkPaper: "agent_quote_live_wkpaper" },
  convertRepeg: { from: Date.parse("2026-10-28T00:00:00Z") },
  holdMin: { from: QUOTE_LIVE_HOLD_MIN_FROM, gbp: 1 },
  weights: { from: QUOTE_LIVE_USDT_ONLY_FROM, book: { "USDC-GBP": 0, "USDT-GBP": 1 } },
  exitOffset: { ticks: 1, from: QUOTE_LIVE_EXIT_OFFSET_FROM },
};
/**
 * "Stablecoin quotes USDC/GBP" on Revolut X (Davies, 2026-10-29: "也上线一个revolut x的Stablecoin quotes USDC/GBP 策略，账户api用之前叫你退役的
 * 那个trend 4h的api，我把那个账户改为了120磅"; migration 0180; the rules RX-USDC's, docs/agents/reviews/2026-10-29-rx-usdc-live.md):
 * PR5's paper engine's decisions on USDC-GBP alone, on the sub-account the retired trend loop traded (`REVX_KEY_NAMES.revx` in
 * index.ts, never PR5's `_2`), £120 in its own config, its own tables and lease. LIVE's rules (its fills, the £1 holding line,
 * exits meeting the book, its weekend replica's decisions inside an FX closure while its own `weekend_mode` is 'live'), with
 * the 0.3 % rungs quoting nothing (£30 on each 0.1 % and 0.2 % rung) and every exit a tick beyond fair. Its asks' first coin
 * is bought by the top-ups, the day's cap its asks' pounds. Built dry-run and unarmed: its go is Davies' word
 * (docs/agents/reviews/2026-10-29-rx-usdc-live-design.md).
 */
export const QUOTE_RXU_INSTANCE: QuoteLiveInstance = {
  config: "agent_quote_rxu_config", orders: "agent_quote_rxu_orders", events: "agent_quote_rxu_events", state: "agent_quote_rxu_state",
  migration: "0180", paper: "agent_quote_state", lease: "quotes-live-rxu", rungs: QUOTE_RUNGS, exitReprice: QUOTE_REPRICE, govKey: () => "account",
  liveSwitches: { wkPaper: "agent_quote_live_wkpaper" },
  holdMin: { from: 0, gbp: 1 },
  weights: { from: 0, book: { "USDC-GBP": 1, "USDT-GBP": 0 }, k: { "0.003": 0 } },
  exitOffset: { ticks: 1, from: 0 },
  topUps: { maxGbpDay: 65 },
};
/** The currencies a LIVE page shows of its account (`venueBalancesOf`). */
export const VENUE_BALANCE_CCYS = ["GBP", "USDC", "USDT"] as const;
/**
 * The account's balances as the venue gave them this turn, for its LIVE page (Davies, 2026-10-29 22:20: the real venue
 * balances on the LIVE pages, "revolut也一样"): `{ at, ccy: { GBP|USDC|USDT: { available, hold } } }`, each currency the venue
 * listed. Written to the state as `venueBalances` (its `balances` stays the totals the page's coin books read); a turn that
 * read no balances writes none. A state write only: nothing the executor decides reads it.
 */
export function venueBalancesOf(at: string, detail: Record<string, { available: number; hold: number }> | null | undefined) {
  if (!detail) return null;
  const ccy: Record<string, { available: number; hold: number }> = {};
  for (const c of VENUE_BALANCE_CCYS) {
    const d = detail[c];
    if (d && Number.isFinite(d.available) && Number.isFinite(d.hold)) ccy[c] = { available: d.available, hold: d.hold };
  }
  return { at, ccy };
}
/** The rungs an instance has retired at `now` (`QuoteLiveInstance.retired`): none for the live account. */
export const retiredAt = (inst: QuoteLiveInstance, now: number): readonly number[] => (inst.retired && now >= inst.retired.from ? inst.retired.ks : []);
/** Does this instance govern more than one key? The live account's one key is every POST it sends. */
const isMultiKey = (inst: QuoteLiveInstance) => new Set(QUOTE_BOOKS.flatMap((b) => [inst.govKey(b, "bid"), inst.govKey(b, "ask"), inst.govKey(b, null)])).size > 1;
/** "three" for PR5's three rungs a side, as the messages always said; the count for any other. */
const rungsWord = (rungs: readonly number[]) => (rungs.length === 3 ? "three" : rungs.length === 9 ? "nine" : String(rungs.length));
/**
 * The order governor (design, "What it would send"): its own POSTs in a UTC day. Davies, 2026-10-01: entries go on to 900
 * (600 before), because `trend-4h-live` never sends 100 a day. Stops-only at 950 leaves 50 under the venue's 1,000 for the
 * stops, which are always sent, and for that row if the 1,000 is shared (undocumented, reference §2). On PR5's committed
 * prints from 2025-12-16, both books on one account (`backtests/pr5_live/go_live_120.json`), entries were withdrawn on 18
 * of 281 days, the exits after that took a median of 8 POSTs and reached 950 on one day, no day sent more than 3 stops,
 * and the venue's day bucket (1,000 tokens, refilled continuously) never fell below 555.
 */
export const QUOTE_LIVE_ENTRY_POSTS = 900;          // from here, no entry quotes: the resting ones are withdrawn
export const QUOTE_LIVE_STOPS_ONLY_POSTS = 950;     // from here, nothing but the 24-hour stops
export const QUOTE_LIVE_LOSS_FRACTION = 0.01;       // the daily loss stop: 1 % of capital, realised today plus marked
export const QUOTE_LIVE_DEPEG = 0.005;              // 50 bps: the quotes sit 10–30 bps from fair, so a 50 bps gap means fair is stale
export const QUOTE_LIVE_USD_STALE_MS = 2 * H;       // the USD book's newest hour may have ended at most this long before the minute
export const QUOTE_LIVE_STOP_BOUND = 0.005;         // the 24-hour stop's IOC: no worse than fair ± 50 bps
export const QUOTE_LIVE_STOP_RETRY_MS = H;          // an unfilled stop is tried again after this, not every minute
export const QUOTE_LIVE_LEASE_MS = 55e3;
export const QUOTE_LIVE_PENDING_GRACE_MS = 60e3;    // a `pending` row younger than this is the current turn's own
export const QUOTE_LIVE_CONVERT_MAX_FRACTION = 0.25; // one conversion buys at most three rungs' worth: the design's inventory for one coin
/**
 * A conversion resting at the bid (maker, 0 %) that has not filled in this long from its first send (`convertFirstAt`) is
 * cancelled; the operator sends another.
 */
export const QUOTE_LIVE_CONVERT_REST_MS = 24 * H;
/**
 * The asks' coin, topped up by the minute loop itself (Davies, 2026-10-02: "以后这种问题自动处理，用昨天新加的规则maker换币").
 * When an ask is skipped for want of coin, a maker conversion at the top of the bids buys the book back up to its three
 * asks' worth at the rule's prices and this much over, so the next few days of GBP rising leave every ask covered.
 */
export const QUOTE_LIVE_TOPUP_BUFFER = 0.02;
/** An automatic top-up resting unfilled this long is cancelled; a turn that still finds an ask short sends another at the book as it then stands. */
export const QUOTE_LIVE_TOPUP_REST_MS = 30 * M;
/**
 * An operator's conversion (`runQuotesConvert`, not a top-up) that has rested this long while the best bid moved above it
 * is no longer at the top of the bids: on an instance with `convertRepeg` the minute loop cancels it and sends what it has
 * not filled again at the top, at most what the asks still lack (2026-10-28, on Davies' standing word of 10-02 that coin
 * shortages are handled automatically; on 10-27 conversion 8823 sat a tick under a rising bid for its 24 hours, filled
 * nothing, and LIVE's USDC asks ran short for about 40 hours after the capital step to £600, which the £5-a-day top-ups
 * cannot cover). The top-ups' own 30 minutes (QUOTE_LIVE_TOPUP_REST_MS; the tests pin the two equal).
 */
export const QUOTE_LIVE_CONVERT_REPEG_MS = 30 * M;
/** How a conversion's cancel to follow the bid begins (`cancel_reason`): a later turn that reads a frozen one back sends its remainder. */
export const CONVERT_REPEG_REASON = "following the bid: under a best bid";
/** At most this many pounds of automatic top-ups a book in a UTC day: a shortfall past it is reported, never chased. */
export const QUOTE_LIVE_TOPUP_MAX_GBP_DAY = 5;
/**
 * Revolut X takes at most 10 order POSTs a second on a key (reference §2), and a turn that places or re-prices every rung
 * sends twelve (the PR5v study, 2026-09-28): the executor's own POSTs go out at least this far apart, 8 a second.
 */
export const QUOTE_LIVE_POST_GAP_MS = 125;
/** A POST the venue answers 429 was not taken: it is sent once more after this, the second's bucket refilled. */
export const QUOTE_LIVE_429_WAIT_MS = 1_000;
/**
 * A cancel the venue took is carried out a moment AFTER its 204: on PR5's first live hour (2026-10-01 16:37 and 16:41 UTC)
 * the read-back straight after the DELETE still showed 3 of 11, then 7 of 11 re-priced orders `new`, and every one read
 * back cancelled a minute later. Each froze its rung for that minute and wrote an error. So a cancel still open on its
 * read-back is read again after these pauses before its rung is frozen: about a second in all, at most twice per cancel.
 */
export const QUOTE_LIVE_CANCEL_REREAD_MS = [300, 700] as const;
/**
 * The dead-man switch (`monitor/deadman.ts`) runs from the monitor Worker every minute, outside Supabase, and is what
 * cancels this account's resting orders when this executor stops. Nothing watched the Worker itself (review F5,
 * 2026-10-08): had it stopped, the executor would have gone on quoting with its kill path silently gone. So the live
 * account's turn reads the dead-man's newest beat (`edge_call_beats`, key `monitor?action=deadman`, stamped by the
 * database each minute it runs) and quotes no new entry while that beat is older than this, or missing: exits and the
 * 24-hour stops stay armed, as under every other guard, and the first such turn writes an error for the errors box.
 * Five minutes is a few missed runs of a once-a-minute clock, not one late one.
 */
export const QUOTE_LIVE_DEADMAN_WATCH_MS = 5 * M;
/** How every guard reason the dead-man watch writes begins, so a turn can tell whether the last one carried it. */
export const DEADMAN_WATCH_REASON = "the dead-man switch";

/**
 * The errors box hears of a fault once, and again at most this often while it lasts, then once more when it is gone
 * (2026-10-20: two orders whose POSTs the venue answered 500 during its outage, never found after, and one whose cancel
 * it refused for six hours, wrote an `agents.quotes_live` row every minute, 606 in all). Each error is still in the turn's
 * report and in the state's `last_error`; only the box is spared the repeats.
 */
export const QUOTE_LIVE_ALERT_EVERY_MS = H;
/** A fault absent this long is over: the box hears it recovered. A shorter gap is the same fault coming back. */
export const QUOTE_LIVE_RECOVERED_AFTER_MS = 5 * M;
/**
 * A `pending` order the venue has shown nowhere (neither active nor in its history) for this long is PARKED: it stays
 * pending for a person, never rejected on a guess, and the venue is asked for it again only every
 * `QUOTE_LIVE_PARKED_EVERY_MS` instead of every minute.
 */
export const QUOTE_LIVE_PARK_AFTER_MS = H;
export const QUOTE_LIVE_PARKED_EVERY_MS = 15 * M;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** An error's identity in the errors box: the order ids it names, and its words with every other number dropped. */
export function faultLineKey(e: string): string {
  const ids = (e.match(UUID_RE) ?? []).map((x) => x.toLowerCase());
  return `${ids.join(",")}|${e.replace(UUID_RE, "<id>").replace(/\d+(\.\d+)?/g, "#")}`.slice(0, 300);
}
/** A fault the errors box has heard of: when it began, when the box last heard, when it was last seen, how many turns. */
export type LiveFault = { first: string; reported: string; seen: string; turns: number; sample: string };
/**
 * Which of a turn's errors go to the errors box, and the faults carried to the next turn: a new one at once, one that
 * lasts again each `QUOTE_LIVE_ALERT_EVERY_MS` (with when it began), and one gone `QUOTE_LIVE_RECOVERED_AFTER_MS` as
 * "recovered".
 */
export function liveAlerts(errors: string[], prev: Record<string, LiveFault> | undefined, now: number): { alerts: string[]; faults: Record<string, LiveFault> } {
  const nowIso = iso(now), alerts: string[] = [], faults: Record<string, LiveFault> = {};
  for (const e of errors) {
    const key = faultLineKey(e);
    if (faults[key]) continue;
    const p = prev?.[key];
    if (!p) { alerts.push(e); faults[key] = { first: nowIso, reported: nowIso, seen: nowIso, turns: 1, sample: e.slice(0, 300) }; continue; }
    const due = now - Date.parse(p.reported) >= QUOTE_LIVE_ALERT_EVERY_MS;
    if (due) alerts.push(`${e} [still, since ${p.first}, ${p.turns + 1} turns]`);
    faults[key] = { ...p, reported: due ? nowIso : p.reported, seen: nowIso, turns: p.turns + 1, sample: e.slice(0, 300) };
  }
  for (const [key, p] of Object.entries(prev ?? {})) {
    if (faults[key]) continue;
    if (now - Date.parse(p.seen) >= QUOTE_LIVE_RECOVERED_AFTER_MS) alerts.push(`recovered: ${p.sample} [from ${p.first} to ${p.seen}, ${p.turns} turns]`);
    else faults[key] = p;
  }
  // A bound on what the state keeps: the newest hundred.
  const keys = Object.keys(faults);
  if (keys.length > 100) for (const k of keys.sort((a, b) => faults[a].seen.localeCompare(faults[b].seen)).slice(0, keys.length - 100)) delete faults[k];
  return { alerts, faults };
}

/** The guard reason for the dead-man's newest beat (epoch ms, or null when none is stored), or null while it is fresh. */
export function deadmanWatchReason(beatAt: number | null, now: number): string | null {
  if (beatAt != null && Number.isFinite(beatAt) && now - beatAt <= QUOTE_LIVE_DEADMAN_WATCH_MS) return null;
  return beatAt != null && Number.isFinite(beatAt)
    ? `${DEADMAN_WATCH_REASON} has not run since ${iso(beatAt).slice(0, 16).replace("T", " ")} UTC: no entries until it does`
    : `${DEADMAN_WATCH_REASON} has never run: no entries until it does`;
}

export type LiveMode = "dry_run" | "live";
export type LiveLeg = "entry" | "exit" | "stop" | "convert";
export type LiveOrderState = "pending" | "new" | "partially_filled" | "filled" | "cancelled" | "rejected";
export type LiveOrderRow = {
  id: number; ts: string; mode: LiveMode; book: QuoteBook; rung_side: Side | null; k: number | string | null; leg: LiveLeg;
  side: "buy" | "sell"; price: number | string; base_size: number | string; client_order_id: string; venue_order_id: string | null;
  state: LiveOrderState; filled_base: number | string; avg_fill_price: number | string | null; fee_gbp: number | string;
  paper_oid: number | null; paper_live: string | null; fair: number | string | null;
  request: Record<string, unknown> | null; response: unknown; book_seen: unknown;
  cancel_requested_at: string | null; cancel_reason: string | null; filled_at: string | null; cancelled_at: string | null;
};
export type LiveConfig = {
  dry_run: boolean; live_confirmed_at: string | null; capital_gbp: number | string;
  /** The live account's switches (0131), each 'off' (the default), 'shadow' or 'live': TAKE's taker entry, PR5-W's weekend quoting. */
  take_mode?: SwitchMode; weekend_mode?: SwitchMode;
};
/** A live switch's mode (0131): off, shadow (record what it would send, send nothing), live. */
export type SwitchMode = "off" | "shadow" | "live";
/** A column the database does not have yet (PostgREST's 42703, or its schema cache's PGRST204). */
export const MISSING_COLUMN = /42703|PGRST204|column .* does not exist/i;
/**
 * JSON with every object's keys sorted. jsonb gives an object back with its keys in its own order (`k` before `side`), so a
 * detail read back never stringified equal to the one written: on 2026-10-18 the weekend shadow wrote a `weekend_shadow`
 * event every minute (1,794 of 1,802 repeats) where it meant to write one when the targets change.
 */
export const canonJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
/** A config's switch as the executor reads it: anything but 'shadow' or 'live', a missing column included, is off. */
export const switchMode = (v: unknown): SwitchMode => (v === "shadow" || v === "live" ? v : "off");
const OPEN_STATES: LiveOrderState[] = ["pending", "new", "partially_filled"];
const isOpen = (o: Pick<LiveOrderRow, "state">) => OPEN_STATES.includes(o.state);

const iso = (ms: number) => new Date(ms).toISOString();
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
/** USDC-GBP → USDC: the coin a book trades. */
export const coinOf = (b: QuoteBook) => b.split("-")[0];
export const rungLabel = (b: QuoteBook, side: Side, k: number | string) => `${b}|${side}|${Number(k)}`;
const ticksOf = (price: number | string) => Math.round(Number(price) / QUOTE_TICK);

// ------------------------------------------------------------------ pure rules, each pinned in quotes_live.test.ts

/** One rung's share of the capital, in GBP: £50 over twelve rungs is £4.17, as the frozen shape at $50 is twelve $4.17. */
export function rungGbp(capitalGbp: number, rungs: readonly number[] = QUOTE_RUNGS): number {
  return capitalGbp / (QUOTE_BOOKS.length * 2 * rungs.length);
}
/** Whether an instance's `weights` are in force at `now`: on the live account's instance from QUOTE_LIVE_USDT_ONLY_FROM. */
export const weightsOn = (inst: QuoteLiveInstance, now: number): boolean => !!inst.weights && now >= inst.weights.from;
/**
 * Whether the instance rebooks its coin at `now` (Davies, 2026-10-29: "换币也用挂单不要有转换损失", the coin switched by maker
 * orders, with no conversion loss): its weights came into force at QUOTE_LIVE_REBOOK_SINCE or later, under
 * QUOTE_LIVE_REBOOK_MS ago. Meanwhile a book holding more coin beyond its longs than its asks need (and the top-ups' buffer)
 * sells the surplus by a post-only order at the top of the asks and never under fair (`planDrains`), and a book short of it
 * is topped up with no daily cap but the capital (`planTopUps`' `maxDayGbp`). Weights that came into force earlier rebook
 * nothing.
 */
export const rebookOn = (inst: QuoteLiveInstance, now: number): boolean =>
  weightsOn(inst, now) && inst.weights!.from >= (inst.rebook?.since ?? QUOTE_LIVE_REBOOK_SINCE) && now < inst.weights!.from + QUOTE_LIVE_REBOOK_MS;
/**
 * THE DRAIN, for good (Davies, 2026-10-31 ~03:55 UTC, "同意", on the audit's N2: LIVE's rebook was a 72-hour window from 10-29 22:30,
 * so from 11-01 22:30 nothing could sell its surplus coin back to pounds and its bids could starve as Coinbase LIVE's 0.3 % bid
 * did from 10-29 20:34). From this instant an instance with weights in force (LIVE, the USDC/GBP executor, and every twin on
 * their rules) sells, outside a rebook, the coin a book holds beyond what its asks need (`planDrains`, the rebook's own sale:
 * post-only at the top of the asks, never under fair, the 2 % buffer kept), but only while a bid lacks pounds and no ask of the
 * book lacks coin, at most what the bids lack (rounded up a step and one step more), within QUOTE_LIVE_DRAIN_DAY_SHARE of the
 * capital a book a UTC day; a resting sale is cancelled the turn either stops being true. Inside a rebook the rebook's rule runs
 * as before. The Coinbase executor's drain (`planCbDrain`, cb_live.ts) is the same rule on its venue.
 */
export const QUOTE_LIVE_DRAIN_FROM = Date.parse("2026-10-31T08:00:00Z");
/** The drain's day, a book: at most this share of the capital sold back to pounds (£150 on £600; a rung is £100). */
export const QUOTE_LIVE_DRAIN_DAY_SHARE = 0.25;
/** Is the drain on for the instance at `now`: its weights in force, from QUOTE_LIVE_DRAIN_FROM, and not inside a rebook. */
export const drainOn = (inst: QuoteLiveInstance, now: number): boolean => weightsOn(inst, now) && now >= (inst.drain?.from ?? QUOTE_LIVE_DRAIN_FROM) && !rebookOn(inst, now);
/**
 * Pure: a drain's sale cut to what the bids lack and the day leaves: the least of the rebook's own plan (`base`, the coin beyond
 * the asks' need), what the bids lack at the sale's price (up a step, one step more) and the day's room; null under the venue's
 * minimum. `step` is the pair's base step.
 */
export function drainBase(planBase: string, price: number, gbpShort: number, roomGbp: number, pair: PairConfig): string | null {
  const step = Number(pair.base_step);
  const want = Math.ceil(gbpShort / price / step - 1e-9) * step + step;
  const base = floorToStep(Math.min(Number(planBase), want, Math.max(0, roomGbp) / price), pair.base_step);
  return Number(base) > 0 && Number(base) >= dustBase(pair, price) - 1e-12 ? base : null;
}
/** A rung's weight under `w`: the product of its book's, side's and distance's, each 1 when not named. */
export function rungWeight(w: RungWeights, book: QuoteBook, side: Side, k: number): number {
  const of = (m: Record<string, number | undefined> | undefined, key: string) => (m && Object.hasOwn(m, key) ? Number(m[key]) : 1);
  return of(w.book, book) * of(w.side, side) * of(w.k, String(k));
}
/** A rung's pounds: `rungGbp` unless the instance's weights are in force, then its weight's share of the capital. */
export function rungGbpOf(inst: QuoteLiveInstance, capitalGbp: number, book: QuoteBook, side: Side, k: number, now: number): number {
  if (!weightsOn(inst, now)) return rungGbp(capitalGbp, inst.rungs);
  const w = inst.weights!;
  let sum = 0;
  for (const b of QUOTE_BOOKS) for (const s of ["bid", "ask"] as Side[]) for (const kk of inst.rungs) sum += rungWeight(w, b, s, kk);
  // Floored to the penny: three rungs of a third of £200 must not ask for £200.01 between them (the bids' pounds are held
  // rounded up to the penny, `pennyUp`, and a book's GBP is exactly what the conversions leave).
  return sum > 0 ? Math.floor(capitalGbp * rungWeight(w, book, side, k) / sum * 100 + 1e-9) / 100 : 0;
}
/** Whether the instance's weights retire this rung at `now` (weight 0): it quotes no entry; a holding still exits. */
export const weightRetired = (inst: QuoteLiveInstance, now: number, book: QuoteBook, side: Side, k: number): boolean =>
  weightsOn(inst, now) && !(rungWeight(inst.weights!, book, side, k) > 0);
/**
 * The most one operator's conversion of a book may buy: a quarter of the capital (three asks' worth of equal rungs), or,
 * while the instance's weights are in force, what the book's own ask rungs sell.
 */
export function convertCapGbp(inst: QuoteLiveInstance, capitalGbp: number, book: QuoteBook, now: number): number {
  if (!weightsOn(inst, now)) return capitalGbp * QUOTE_LIVE_CONVERT_MAX_FRACTION;
  return inst.rungs.reduce((a, k) => a + rungGbpOf(inst, capitalGbp, book, "ask", k, now), 0);
}
/** The coin a rung must hold above to count as holding: the venue's minimum (`dustBase`), or the instance's `holdMin` line. */
export function holdLineBase(inst: QuoteLiveInstance, now: number, dust: number, price: number): number {
  return inst.holdMin && now >= inst.holdMin.from && price > 0 ? Math.max(dust, inst.holdMin.gbp / price) : dust;
}

/** The venue side of a rung's order: a bid rung buys to enter and sells to get out; an ask rung the reverse. */
export function venueSideOf(rungSide: Side, leg: "entry" | "exit" | "stop"): "buy" | "sell" {
  return (leg === "entry") === (rungSide === "bid") ? "buy" : "sell";
}

/** The paper decision a rung's entry carries out: its order's id and the minute it goes live, which change on every placement, re-price and re-placement. */
export type PaperTarget = { ticks: number; oid: number; live: number; fairAt: number };
/**
 * A refused paper order is not resting, and the rule re-prices it while it waits to be placed again — new ticks under the
 * same id and live minute, with no event and no order counted — so its ticks are no decision to carry out.
 */
export const paperRefused = (r: Rung | undefined) => !!r && r.mode === "quote" && r.o?.state === "rejected";
export function paperEntryTarget(r: Rung | undefined): PaperTarget | null {
  if (!r || r.mode !== "quote" || !r.o || r.o.side !== r.side || paperRefused(r)) return null;
  return { ticks: r.o.ticks, oid: r.o.oid, live: r.o.live, fairAt: r.o.fairAt };
}
/** Whether a recorded order carried out this paper decision. */
export function sameDecision(o: Pick<LiveOrderRow, "paper_oid" | "paper_live">, t: PaperTarget): boolean {
  return o.paper_oid != null && Number(o.paper_oid) === t.oid && o.paper_live != null && Date.parse(o.paper_live) === t.live;
}

/** A rung's order size at `price`: its share of the capital in coin, floored to the pair's step; null under the venue's minimums.
 *
 * A sell takes one base step more when that step carries its proceeds over a whole penny. Revolut X credits a sell's GBP
 * FLOORED to the penny and debits a buy's rounded up (PR5's first live hour, 2026-10-01: fill 1184 sold 13.18565 USDT at
 * 0.7584, £9.99999696, and was credited £9.99, the venue's average price 0.7576 derived from it; both conversions,
 * £29.999999, cost £30.00). Sized down to the step, a £10 rung's sell lands a hair under £10 and loses the penny, the
 * 0.1 % rung's whole edge; one step up (0.00001 of a coin, under £0.00001) lands it on £10.00. A buy sized down already
 * lands just under the pound it pays. Under any other rounding the extra step costs at most its own value.
 */
export function rungBase(gbp: number, price: number, pair: PairConfig, side: "buy" | "sell" = "buy"): string | null {
  if (!(gbp > 0) || !(price > 0)) return null;
  let base = floorToStep(gbp / price, pair.base_step);
  if (side === "sell") {
    const up = ceilToStep(gbp / price, pair.base_step);
    const pence = (b: string) => Math.floor(Number(b) * price * 100 + 1e-9);
    if (up !== base && pence(up) > pence(base)) base = up;
  }
  const b = Number(base);
  if (!(b >= Number(pair.min_order_size)) || !(b * price >= Number(pair.min_order_size_quote))) return null;
  return base;
}
/** The least the venue will take at `price`: under this, a holding is dust that no order can sell or buy back. */
export function dustBase(pair: PairConfig, price: number): number {
  return Math.max(Number(pair.min_order_size), price > 0 ? Number(pair.min_order_size_quote) / price : 0);
}

/**
 * The pounds Revolut X holds for a buy: its notional rounded UP to the penny. PR5's first automatic top-ups, 2026-10-02
 * 17:56 UTC: two buys of £0.1503 against £0.31 free, sized from exact pounds, and the second refused "Not enough funds!
 * Wanted £0.16 but has only £0.15". Every pound the executor counts as promised to a buy is counted this way.
 */
export const pennyUp = (gbp: number): number => Math.ceil(gbp * 100 - 1e-9) / 100;

/**
 * What a book's three ask rungs sell at the rule's prices (0.1 / 0.2 / 0.3 % over fair): the coin the design holds for them.
 * A retired rung (`QuoteLiveInstance.retired`, in `skip`) quotes no ask, so its coin is not held for it; each rung keeps
 * its share of the capital over every rung.
 */
export function asksNeedOf(fair: number, capitalGbp: number, pair: PairConfig, rungs: readonly number[] = QUOTE_RUNGS, skip: readonly number[] = [], gbpOfK?: (k: number) => number): number {
  return rungs.filter((k) => !skip.includes(k))
    .reduce((a, k) => a + Number(rungBase(gbpOfK ? gbpOfK(k) : rungGbp(capitalGbp, rungs), Math.ceil(fair * (1 + k) / QUOTE_TICK - 1e-9) * QUOTE_TICK, pair, "sell") ?? 0), 0);
}

/** A maker's price for a conversion: the top of the bids, one tick over the best bid when the ask stays a tick above it; never over fair + 50 bps. */
export function makerBuyTicks(bestBid: number, bestAsk: number, fair: number): number {
  const bid = Math.round(bestBid / QUOTE_TICK), ask = Math.round(bestAsk / QUOTE_TICK);
  return Math.min(ask - 1 >= bid + 1 ? bid + 1 : bid, Math.floor(fair * (1 + QUOTE_LIVE_STOP_BOUND) / QUOTE_TICK + 1e-9));
}

/** One book's case for an automatic top-up: its fair, its pair, the book the turn met, its coin beyond its longs and its top-ups today. */
export type TopUpBook = { book: QuoteBook; fair: number; pair: PairConfig; bestBid: number | null; bestAsk: number | null; beyond: number; spentTodayGbp: number };
export type TopUpPlan =
  | { book: QuoteBook; ticks: number; base: string; gbp: number; fair: number; asksNeed: number; beyond: number }
  | { book: QuoteBook; skip: string };
/**
 * The automatic top-ups of one turn, from the GBP the entries left free. Each book short of its asks' coin is owed its
 * shortfall first (at least the venue's minimum order), and the buffer (QUOTE_LIVE_TOPUP_BUFFER of its asks' worth) is
 * shared out of what is left, so one book's buffer never starves another's shortfall. A book whose shortfall the free
 * GBP cannot cover, or that would pass the day's cap (`maxDayGbp`, QUOTE_LIVE_TOPUP_MAX_GBP_DAY), is skipped with the reason;
 * while a rebook runs (`partial`, `rebookOn`) the cap is the capital and a shortfall the free GBP cannot cover buys what it can.
 */
export function planTopUps(books: TopUpBook[], capitalGbp: number, freeGbp: number, rungs: readonly number[] = QUOTE_RUNGS, skip: readonly number[] = [], gbpOf?: (book: QuoteBook, k: number) => number, maxDayGbp: number = QUOTE_LIVE_TOPUP_MAX_GBP_DAY, partial = false): TopUpPlan[] {
  const out: TopUpPlan[] = [];
  const due: { b: TopUpBook; ticks: number; price: number; asksNeed: number; min: number; minCost: number; full: number; room: number }[] = [];
  for (const b of books) {
    if (b.bestBid == null || b.bestAsk == null) { out.push({ book: b.book, skip: "the order book is unreadable" }); continue; }
    const ticks = makerBuyTicks(b.bestBid, b.bestAsk, b.fair), price = ticks * QUOTE_TICK;
    const asksNeed = asksNeedOf(b.fair, capitalGbp, b.pair, rungs, skip, gbpOf ? (k) => gbpOf(b.book, k) : undefined);
    const short = asksNeed - b.beyond;
    if (!(short > 1e-9)) { out.push({ book: b.book, skip: `it holds its ${rungsWord(rungs)} asks' worth` }); continue; }
    const min = Number(ceilToStep(Math.max(short, dustBase(b.pair, price)), b.pair.base_step)), minCost = pennyUp(min * price);
    const full = Math.max(min, Number(floorToStep(asksNeed * (1 + QUOTE_LIVE_TOPUP_BUFFER) - b.beyond, b.pair.base_step)));
    const room = Math.max(0, maxDayGbp - b.spentTodayGbp);
    if (minCost > room + 1e-9) { out.push({ book: b.book, skip: `today's top-ups would pass £${maxDayGbp}: £${b.spentTodayGbp.toFixed(2)} so far, £${minCost.toFixed(2)} short` }); continue; }
    due.push({ b, ticks, price, asksNeed, min, minCost, full, room });
  }
  // Every shortfall first, in the books' order, while the free GBP covers the pounds the venue will hold for it.
  let spare = freeGbp;
  const funded: typeof due = [];
  for (const x of due) {
    if (x.minCost > spare + 1e-9) {
      // While a rebook runs (`partial`), a shortfall the free GBP cannot cover buys what that GBP buys, at least the venue's
      // minimum: a coin switch frees its pounds a sale at a time, and the last pennies of the shortfall need not wait for all of them.
      const part = partial ? floorToStep(Math.floor(Math.max(0, spare) * 100 + 1e-9) / 100 / x.price, x.b.pair.base_step) : "0";
      if (partial && Number(part) >= dustBase(x.b.pair, x.price) - 1e-12 && pennyUp(Number(part) * x.price) <= spare + 1e-9) {
        const gbp = pennyUp(Number(part) * x.price);
        out.push({ book: x.b.book, ticks: x.ticks, base: part, gbp, fair: x.b.fair, asksNeed: x.asksNeed, beyond: x.b.beyond });
        spare -= gbp;
        continue;
      }
      out.push({ book: x.b.book, skip: `its shortfall needs £${x.minCost.toFixed(2)} and £${Math.max(0, spare).toFixed(2)} of GBP is free: the account needs more GBP` });
      continue;
    }
    spare -= x.minCost;
    funded.push(x);
  }
  // Then the buffers, an equal share in whole pennies of what is left, within the day's room; none while a book's
  // shortfall went unfunded, so the GBP left stays for it. A book buys what its pennies buy, so the venue's hold, the
  // notional rounded up, never passes them.
  const share = funded.length && funded.length === due.length ? Math.floor(Math.max(0, spare) * 100 / funded.length + 1e-9) / 100 : 0;
  for (const x of funded) {
    const budget = Math.min(x.minCost + share, Math.floor(x.room * 100 + 1e-9) / 100);
    const base = ceilToStep(Math.max(x.min, Math.min(x.full, Number(floorToStep(budget / x.price, x.b.pair.base_step)))), x.b.pair.base_step);
    out.push({ book: x.b.book, ticks: x.ticks, base, gbp: pennyUp(Number(base) * x.price), fair: x.b.fair, asksNeed: x.asksNeed, beyond: x.b.beyond });
  }
  // In the books' order.
  return books.map((b) => out.find((p) => p.book === b.book)!).filter(Boolean);
}

/**
 * A maker's price for a rebook's sale (`planDrains`): the top of the asks, one tick under the best ask when the bid stays a
 * tick below it; never under fair rounded up, so a sale is never at a loss to fair. Always over the best bid: it never crosses.
 */
export function makerSellTicks(bestBid: number, bestAsk: number, fair: number): number {
  const bid = Math.round(bestBid / QUOTE_TICK), ask = Math.round(bestAsk / QUOTE_TICK);
  return Math.max(bid + 1 <= ask - 1 ? ask - 1 : ask, Math.ceil(fair / QUOTE_TICK - 1e-9));
}
/** One book's case for a rebook's sale: as a top-up's, with the coin the account can sell now (beyond every open sell and long). */
export type DrainBook = { book: QuoteBook; fair: number; pair: PairConfig; bestBid: number | null; bestAsk: number | null; beyond: number; free: number };
export type DrainPlan =
  | { book: QuoteBook; ticks: number; base: string; fair: number; asksNeed: number; beyond: number }
  | { book: QuoteBook; skip: string };
/**
 * A rebook's sales (`rebookOn`): a book whose coin beyond its longs passes what its asks sell at the rule's prices and the
 * top-ups' buffer (QUOTE_LIVE_TOPUP_BUFFER) by more than the venue's minimum sells the surplus down to that, as much as it
 * holds free, at `makerSellTicks`, post-only. A surplus under the venue's minimum is carried: no order is sent for it. With
 * no surplus, nothing (the top-ups buy what a book lacks).
 */
export function planDrains(books: DrainBook[], capitalGbp: number, rungs: readonly number[] = QUOTE_RUNGS, skip: readonly number[] = [], gbpOf?: (book: QuoteBook, k: number) => number): DrainPlan[] {
  return books.map((b): DrainPlan => {
    if (b.bestBid == null || b.bestAsk == null) return { book: b.book, skip: "the order book is unreadable" };
    const asksNeed = asksNeedOf(b.fair, capitalGbp, b.pair, rungs, skip, gbpOf ? (k) => gbpOf(b.book, k) : undefined);
    const ticks = makerSellTicks(b.bestBid, b.bestAsk, b.fair), price = ticks * QUOTE_TICK;
    const surplus = b.beyond - asksNeed * (1 + QUOTE_LIVE_TOPUP_BUFFER);
    const base = floorToStep(Math.min(surplus, b.free), b.pair.base_step);
    if (!(Number(base) > 0) || Number(base) < dustBase(b.pair, price) - 1e-12) {
      return { book: b.book, skip: surplus > 1e-9 ? `its surplus of ${Math.max(0, surplus).toFixed(5)} ${coinOf(b.book)} (${Math.max(0, b.free).toFixed(5)} free) is under the venue's minimum: carried` : `it holds no more than its ${rungsWord(rungs)} asks' worth` };
    }
    return { book: b.book, ticks, base, fair: b.fair, asksNeed, beyond: b.beyond };
  });
}
/** A rebook's sale (`request.drain`, an automatic conversion that sells). */
export const isDrain = (o: { leg?: string; request?: unknown }) =>
  isAutoConvert(o) && (o.request as { drain?: unknown } | null | undefined)?.drain === true;

/** An automatic top-up (`request.auto`), as against an operator's `quotes-convert`; a rebook's sale is one too (`isDrain`). */
export const isAutoConvert = (o: { leg?: string; request?: unknown }) =>
  o.leg === "convert" && (o.request as { auto?: unknown } | null | undefined)?.auto === true;
/**
 * When a conversion was first sent: its own `ts`, or, for one that follows the bid, the first send's (`request.firstTs`,
 * which each re-peg carries on), so QUOTE_LIVE_CONVERT_REST_MS counts from the operator's send, not from each re-peg.
 */
export function convertFirstAt(o: { ts: string; request?: unknown }): number {
  const own = Date.parse(o.ts), f = (o.request as { firstTs?: unknown } | null | undefined)?.firstTs;
  const first = typeof f === "string" ? Date.parse(f) : NaN;
  return Number.isFinite(first) && first < own ? first : own;
}
/**
 * Is an operator's conversion due to follow the bid (`QuoteLiveInstance.convertRepeg`)? A live maker conversion the
 * operator sent (not a top-up, not an IOC), resting with no cancel asked, sent at least QUOTE_LIVE_CONVERT_REPEG_MS ago
 * and less than QUOTE_LIVE_CONVERT_REST_MS after its first send, under a best bid now above its price: no longer at the top.
 */
export function convertRepegDue(
  o: { mode: string; leg: string; state: string; ts: string; price: number | string; request?: unknown; cancel_requested_at?: string | null },
  bestBid: number | null, now: number,
): boolean {
  if (o.mode !== "live" || o.leg !== "convert" || isAutoConvert(o) || (o.state !== "new" && o.state !== "partially_filled") || o.cancel_requested_at) return false;
  if ((o.request as { marketable?: unknown } | null | undefined)?.marketable === true) return false;
  if (now - Date.parse(o.ts) < QUOTE_LIVE_CONVERT_REPEG_MS || now - convertFirstAt(o) >= QUOTE_LIVE_CONVERT_REST_MS) return false;
  return bestBid != null && Math.round(bestBid / QUOTE_TICK) > Math.round(Number(o.price) / QUOTE_TICK);
}
/**
 * A re-pegged conversion's size: what it has not filled, and never more than the asks still lack (`short`, in coin,
 * rounded up to the step: the least that covers it); null under the venue's minimum at `price`.
 */
export function repegBase(remainder: number, short: number, pair: PairConfig, price: number): string | null {
  if (!(remainder > 0) || !(short > 1e-9) || !(price > 0)) return null;
  const base = floorToStep(Math.min(remainder, Number(ceilToStep(short, pair.base_step))), pair.base_step);
  return Number(base) > 0 && Number(base) >= dustBase(pair, price) ? base : null;
}
/**
 * A resting exit sized to the penny the venue rounds to, the hair it rounds off kept on the rung as dust. Revolut X credits
 * a sell's GBP floored to the penny and debits a buy's rounded UP (PR5's first round trip, 2026-10-01: the ask sold
 * 13.18565 at 0.7584, £9.99999696, credited £9.99; its exit bought them back at 0.7578, £9.9920856, debited £10.00 — a
 * trip worth +0.79p came out at −1p). An exit trades what the rung holds, so its notional falls anywhere between pennies:
 *   * a sell (a bid rung's exit) is credited the floored penny whatever the hair above it: it sells only the least coin
 *     still credited that penny, and keeps the rest;
 *   * a buy (an ask rung's exit) pays the penny above: one penny less buys all but a hair, which the rung still owes.
 * Either way the rung gains the hair's worth or more, never less, and what it keeps (under a penny of coin, far under
 * `dust`) is carried into its next trip, as any dust is: the next exit trades it. The 24-hour stop is not trimmed.
 *
 * A buy-back the trim would take under the venue's minimum (a notional from £0.10 to £0.11: the trim's £0.10 of coin,
 * floored to the step, is worth a hair under £0.10) cannot pay the penny below, so it pays the one above whatever it
 * buys. It buys what that whole penny buys instead (`floorToStep(pennyUp(n) / price)`), the holding and a hair more,
 * which stays in the account as coin the asks use (the 2026-10-09 review's F1, Davies the same day: "修复 F1，应用所有
 * stablecoin quotes包括live的"). A £0.10 print that nibbles a resting entry leaves such a holding: live fills 3956
 * (0.13587 USDT at 0.7567), 4245 (0.13584 at 0.7545) and 4304 (0.13792 at 0.7543) each paid £0.11, £0.0207 together for
 * £0.3093 of coin, and would have bought 0.14536, 0.14579 and 0.14583 for the same pennies. A sell is not sized up: it
 * can sell no more than the rung holds. Nothing changes at £0.11 or more.
 *
 * Returns `base` itself when there is nothing to trim, or when the trim would leave more than `dust` or trade under it
 * (a buy that would trade under it: what its whole penny buys).
 */
export function pennyExit(exitSide: "buy" | "sell", base: string, price: number, pair: PairConfig, dust: number): string {
  const b = Number(base), n = b * price;
  if (!(b > 0) || !(price > 0)) return base;
  const pennies = Math.floor(n * 100 + 1e-9);
  if (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6) return base;          // on a whole penny already: nothing rounds
  const trimmed = exitSide === "sell" ? ceilToStep(pennies / 100 / price, pair.base_step) : floorToStep(pennies / 100 / price, pair.base_step);
  const t = Number(trimmed);
  if (exitSide === "buy" && t < b && !(t >= dustBase(pair, price))) {
    const whole = floorToStep(pennyUp(n) / price, pair.base_step);
    return Number(whole) > b ? whole : base;
  }
  if (!(t < b) || b - t > dust || !(t >= dustBase(pair, price))) return base;
  return trimmed;
}

/** One settled fill of a rung, for its book. */
export type RungFill = { id: number; ts: number; leg: LiveLeg; base: number; price: number; feeGbp: number };
/**
 * What a rung holds, from its own fills: entry fills add, exit and stop fills take away, at the average entry. P&L is
 * in GBP, the books' quote currency, and fees come off as they are paid. A bid rung that bought at 0.7392 and sold at
 * 0.7400 made 0.0008 a coin; an ask rung that sold at 0.7408 and bought back at 0.7400 made the same. `openedAt` is the
 * fill that took it over `dust` (the 24-hour stop counts from there); a holding at or under `dust` can be neither sold
 * nor bought back, so it is carried into the rung's next trip rather than held against a stop it could never meet.
 */
export type RungBook = { held: number; avgEntry: number; realisedGbp: number; realisedTodayGbp: number; openedAt: number | null };
export function rungBook(rungSide: Side, fills: RungFill[], dayStartMs: number, dust = 0): RungBook {
  let held = 0, avg = 0, realised = 0, today = 0, openedAt: number | null = null;
  for (const f of [...fills].sort((a, b) => a.ts - b.ts || a.id - b.id)) {
    if (!(f.base > 0)) continue;
    const isToday = f.ts >= dayStartMs;
    if (f.leg === "entry") {
      avg = held + f.base > 0 ? (avg * held + f.price * f.base) / (held + f.base) : 0;
      const was = held;
      held += f.base;
      if (was <= dust && held > dust) openedAt = f.ts;
    } else if (f.leg === "exit" || f.leg === "stop") {
      const q = Math.min(held, f.base);
      const pnl = rungSide === "bid" ? q * (f.price - avg) : q * (avg - f.price);
      realised += pnl;
      if (isToday) today += pnl;
      held = Math.max(0, Number((held - f.base).toPrecision(12)));
      if (held <= dust) openedAt = null;
      if (held === 0) avg = 0;
    }
    realised -= f.feeGbp;
    if (isToday) today -= f.feeGbp;
  }
  return { held, avgEntry: avg, realisedGbp: realised, realisedTodayGbp: today, openedAt };
}
/** What a rung's holding is worth against its entry, marked at `mark` (GBP). */
export function markedGbp(rungSide: Side, b: RungBook, mark: number | null): number {
  if (!(b.held > 0) || mark == null) return 0;
  return rungSide === "bid" ? b.held * (mark - b.avgEntry) : b.held * (b.avgEntry - mark);
}
export function lossStopHit(dayPnlGbp: number, capitalGbp: number): boolean {
  return dayPnlGbp <= -QUOTE_LIVE_LOSS_FRACTION * capitalGbp;
}

/** The inputs a book was priced from at the paper minute `T`, by the rule's own functions on the same stored rows. */
export type BookInputs = { f: number | null; fairU: number | null; x: number | null; usdLast: number | null; usdHourEnd: number | null };
export function bookInputs(T: number, fx: Array<[number, number]>, hours: Array<[number, number]>): BookInputs {
  const x = fxAt(T, fx), fairU = fairUAt(T, hours);
  const done = hours.filter(([s]) => s + H <= T).sort((a, b) => a[0] - b[0]);
  const last = done.at(-1) ?? null;
  return { f: x && fairU ? fairU / x : null, fairU, x, usdLast: last ? last[1] : null, usdHourEnd: last ? last[0] + H : null };
}

/**
 * Why a book may not quote a new entry this minute, from its inputs — empty when it may. The de-peg rule and the stale
 * rule are the design's, word for word: the USD book's last hourly close more than 50 bps from its 24-hour median, the
 * GBP book's last print more than 50 bps from fair, GBP/USD older than ten minutes, the USD hour older than two.
 */
export function entryGuards(T: number, i: BookInputs, lastPrintPx: number | null): string[] {
  const out: string[] = [];
  if (i.f == null) out.push(i.x == null ? "no GBP/USD minute in the last ten: dark" : "no USD-book hours in the last day: no fair value");
  if (i.usdHourEnd == null || T - i.usdHourEnd > QUOTE_LIVE_USD_STALE_MS) {
    out.push(`the USD book's newest hour ${i.usdHourEnd == null ? "is missing" : `ended ${Math.round((T - i.usdHourEnd) / M)} min before the minute`}: stale inputs`);
  }
  if (i.usdLast != null && i.fairU != null && Math.abs(i.usdLast / i.fairU - 1) > QUOTE_LIVE_DEPEG) {
    out.push(`de-peg: the USD book's last hourly close ${i.usdLast} is ${Math.round((i.usdLast / i.fairU - 1) * 1e4)} bps from its 24-hour median ${i.fairU}`);
  }
  if (lastPrintPx != null && i.f != null && Math.abs(lastPrintPx / i.f - 1) > QUOTE_LIVE_DEPEG) {
    out.push(`de-peg: the GBP book's last print ${lastPrintPx} is ${Math.round((lastPrintPx / i.f - 1) * 1e4)} bps from fair ${i.f.toFixed(5)}`);
  }
  return out;
}

/**
 * An order the venue's rate limit turned away (429, after one retry): never taken, so it is no refusal of the decision. Its
 * rung sends that decision again next turn, and a stop turned away is tried again next turn, not an hour later.
 */
export function wasRateLimited(o: { state?: unknown; response?: unknown }): boolean {
  return o.state === "rejected" && Number((o.response as { status?: unknown } | null | undefined)?.status) === 429;
}

/**
 * Did this order go to the venue (in dry-run: would it have)? Every row did but one refused at the book it met, which is
 * recorded refused without a POST (`wouldBeRefused`). The governor counts these rows, not the others.
 */
export function wasSent(o: { response?: unknown }): boolean {
  return (o.response as { wouldBeRefused?: unknown } | null | undefined)?.wouldBeRefused !== true;
}

/**
 * How many POSTs a row cost the governor (review A4): none when it was refused at the book it met (`wasSent`), two when the
 * rate limit turned the first away and the same order went again (`retriedAfter429`, kept on the row whatever the second
 * answered), and one otherwise.
 */
export function postsOf(o: { response?: unknown }): number {
  if (!wasSent(o)) return 0;
  return (o.response as { retriedAfter429?: unknown } | null | undefined)?.retriedAfter429 === true ? 2 : 1;
}

/** The paper engine's last print as an exit row records it (`request.paperLastPrint`): what a refused exit waits on. */
export type SeenPrint = { id: string; ticks: number; side: Print["side"] };
export const seenPrint = (p: Print | null | undefined): SeenPrint | null => (p ? { id: p.id, ticks: p.ticks, side: p.side } : null);

/**
 * May a rung send its exit now? A post-only exit the venue refused waits as the rule's own refused order waits
 * (`stepMinute` re-places one at the first turn whose last print is no longer through it): it goes again only once the paper
 * engine holds a NEWER print than it held when the refused exit was sent, and that print is not through the exit's price
 * (`blocks`, the rule's test). Before this the executor sent a refused exit again on every turn: on PR5's committed prints
 * that was 872 of 1,150 exit POSTs in the tightened market and 53,643 of 81,765 in the wide one, where it took the POSTs
 * past 900 on 63 days instead of 13 (`backtests/pr5_live/go_live_120.json`). A refusal of an earlier holding, or one the
 * rate limit turned away (`wasRateLimited`), holds nothing back.
 */
export function exitMayGo(
  prev: { ts: string; state: string; response?: unknown; request?: { paperLastPrint?: SeenPrint | null } | null } | null,
  heldSince: number | null, exitSide: Side, ticks: number, lastPrint: Print | null,
): boolean {
  if (!prev || prev.state !== "rejected" || wasRateLimited(prev)) return true;
  if (heldSince != null && Date.parse(prev.ts) < heldSince) return true;
  const seen = prev.request?.paperLastPrint?.id ?? null;
  if ((lastPrint?.id ?? null) === seen) return false;               // nothing has printed since the venue refused it
  return !blocks(exitSide, ticks, lastPrint);                      // the market is still through it
}

// ------------------------------------------------------------------ TAKE (docs/agents/reviews/2026-10-03-take-prereg.md)

/** Revolut X's taker fee, which a take keeps its rung's k after: its limit is k + this from fair (19 / 29 / 39 bps). */
export const TAKE_FEE = 0.0009;
/** A take decides on the recorder's last read of the book at or before the turn, seen at most this long before it (step 2). */
export const TAKE_BOOK_MAX_AGE_MS = 90e3;
/** A row of `agent_book_levels` (0057, 0058): the book first read at `ts`, read unchanged until `seen_until`; levels [price, quantity, orders], best first. */
export type RecordedRead = { ts: string; seen_until: string | null; bids: Array<[number, number, number | null]>; asks: Array<[number, number, number | null]> };
/** A read's last instant seen (a row written before 0058's code carries none: its `ts`). */
export const seenUntil = (r: Pick<RecordedRead, "ts" | "seen_until">): number => Date.parse(r.seen_until ?? r.ts);
/** Step 2: the last read at or before `at`, when it was seen at most TAKE_BOOK_MAX_AGE_MS before `at`; else none. */
export function takeBookRow(last: RecordedRead | null, at: number): RecordedRead | null {
  return last && Date.parse(last.ts) <= at && seenUntil(last) >= at - TAKE_BOOK_MAX_AGE_MS ? last : null;
}
/** The recorder's last read of `book` at or before `at`, as step 2 takes it: what the executor reads when no driver gives it one. */
export async function recordedBookAt(db: Db, book: QuoteBook, at: number): Promise<RecordedRead | null> {
  const [r] = await db.select<RecordedRead>("agent_book_levels", `book=eq.${book}&ts=lte.${enc(iso(at))}&select=ts,seen_until,bids,asks&order=ts.desc&limit=1`);
  return takeBookRow(r ?? null, at);
}
/** Step 3's limit, in ticks: a bid rung buys at most k + the fee under fair, an ask rung sells at least k + the fee over it. */
export const takeLimitTicks = (fair: number, k: number, side: Side): number => quoteTicks(fair, k + TAKE_FEE, side);
/** A read's touch, in ticks: its best bid and best ask (null when a side is empty). */
export function readTouch(r: Pick<RecordedRead, "bids" | "asks">): { bid: number | null; ask: number | null } {
  const px = (ls: RecordedRead["bids"]) => ls.map((l) => Number(l[0])).filter((p) => p > 0);
  const bids = px(r.bids), asks = px(r.asks);
  return { bid: bids.length ? Math.round(Math.max(...bids) / QUOTE_TICK) : null, ask: asks.length ? Math.round(Math.min(...asks) / QUOTE_TICK) : null };
}
/** Step 3: a bid rung takes when the best ask is at or under its limit; an ask rung when the best bid is at or over it. */
export function takeTriggered(side: Side, limitTicks: number, touch: { bid: number | null; ask: number | null }): boolean {
  return side === "bid" ? touch.ask != null && touch.ask <= limitTicks : touch.bid != null && touch.bid >= limitTicks;
}
/**
 * TAKE-DEPTH (Davies, 2026-10-31: "按照你推荐的来，确保效果最佳，你觉得需要改就改"; the take pre-registration's deviation
 * reviews/2026-10-31-take-depth-deviation.md): from this instant a take goes only when the read rests more coin through its
 * limit than the rung's holding line (`holdLineBase` at fair, `holdMin`'s £1 on LIVE and every twin on its rules). A take
 * that could fill only under the line left the rung unheld, and the next minute sent the rung's whole IOC again, each
 * fill paying the venue's pennies (a sell's fee is at least £0.01, a buy's pounds are rounded up). On the recorder's
 * USDT-GBP reads from 10-05 to 10-31 an ask rung's limit had £1 or less through it 132 times (69 on the 0.1 % rung, 63 on
 * the 0.2 %, all on 10-22 between 05:00 and 09:00 UTC), and each, taken, lost to fair: −£0.015 on average, the best
 * −£0.0089. No take the twin or the shadow recorded had so little through its limit (the least, 48.45 coins).
 */
export const TAKE_DEPTH_FROM = Date.parse("2026-10-31T04:00:00Z");
/** The coin a read rests through a take's limit: the asks at or under it for a bid rung's buy, the bids at or over it for an ask rung's sell. */
export function readDepthThrough(r: Pick<RecordedRead, "bids" | "asks">, side: Side, limitTicks: number): number {
  const levels = side === "bid" ? r.asks : r.bids;
  return levels.reduce((a, l) => {
    const t = Math.round(Number(l[0]) / QUOTE_TICK), q = Number(l[1]);
    return a + ((side === "bid" ? t <= limitTicks : t >= limitTicks) && q > 0 ? q : 0);
  }, 0);
}
/** Step 3 from TAKE_DEPTH_FROM: the read must rest more coin through the limit than `line` (the coin a holding must pass). */
export function takeDeep(now: number, depth: number, line: number): boolean {
  return now < TAKE_DEPTH_FROM || depth > line;
}

/** The governor's level for a count of today's POSTs. */
export function governorLevel(postsToday: number): "all" | "no-entries" | "stops-only" {
  return postsToday >= QUOTE_LIVE_STOPS_ONLY_POSTS ? "stops-only" : postsToday >= QUOTE_LIVE_ENTRY_POSTS ? "no-entries" : "all";
}

/** Is a holding past the rule's 24 hours? */
export function stopDue(openedAt: number | null, now: number): boolean {
  return openedAt != null && now >= openedAt + QUOTE_STOP_MS;
}
/** The 24-hour stop's IOC limit: a long sells no lower than fair − 50 bps, a short buys back no higher than fair + 50 bps. */
export function stopLimitTicks(fair: number, rungSide: Side): number {
  return rungSide === "bid" ? Math.ceil(fair * (1 - QUOTE_LIVE_STOP_BOUND) / QUOTE_TICK - 1e-9) : Math.floor(fair * (1 + QUOTE_LIVE_STOP_BOUND) / QUOTE_TICK + 1e-9);
}

/** The order book an order met: best bid and ask, where it came from, and the levels as served. */
export type BookSeen = { bestBid: number | null; bestAsk: number | null; source: "paper" | "public"; at: string; levels: unknown };
/** The venue's public book (`{ data: { bids, asks } }`, levels of `price` and `quantity`), or the paper engine's copy of it. */
export function parseBook(raw: unknown, source: BookSeen["source"], at: string): BookSeen | null {
  const top = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const d = top && "data" in top && top.data && typeof top.data === "object" ? top.data as Record<string, unknown> : top;
  if (!d || !Array.isArray(d.bids) || !Array.isArray(d.asks)) return null;
  const px = (l: unknown) => {
    const x = Array.isArray(l) ? l[0] : l && typeof l === "object" ? ((l as Record<string, unknown>).price ?? (l as Record<string, unknown>).p) : null;
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const bids = (d.bids as unknown[]).map(px).filter((x): x is number => x != null), asks = (d.asks as unknown[]).map(px).filter((x): x is number => x != null);
  return { bestBid: bids.length ? Math.max(...bids) : null, bestAsk: asks.length ? Math.min(...asks) : null, source, at, levels: { bids: d.bids, asks: d.asks } };
}
/** Would a post-only order at `price` have crossed this book? A buy at or above the best ask, a sell at or below the best bid; null when the book says nothing. */
/**
 * From this instant every instance's exits meet the book (`exitTicksOnBook`; an instance's `exitInside` moves it): LIVE and the
 * twins on its rules (`live600`, `live1200`, `live`, `take50`, and `n600*` from their start) together, so a twin keeps mirroring
 * LIVE (Davies, 2026-10-28, on the exits "rejected — not sent: its price crossed the book"). Before it the executor refused a
 * crossing exit as a row, and the rule's refused-exit wait (`exitMayGo`) held the rung's next exit back: on LIVE's record to
 * 2026-10-28, 21 exits in 16 turns, the next sent a median 58 minutes later (at most 297).
 */
export const QUOTE_LIVE_EXIT_INSIDE_FROM = Date.parse("2026-10-29T00:00:00Z");
/** Whether an instance's exits meet the book at `now` (`QuoteLiveInstance.exitInside`, else QUOTE_LIVE_EXIT_INSIDE_FROM). */
export const exitInsideOn = (inst: QuoteLiveInstance, now: number): boolean => now >= (inst.exitInside?.from ?? QUOTE_LIVE_EXIT_INSIDE_FROM);
/**
 * An exit's price on the book it meets. The rule's own (`ruleTicks`) when the book does not show it crossing, or says
 * nothing of the side it would cross. When it does cross (a buy at or over the best ask, a sell at or under the best bid,
 * which the venue refuses for a post-only order), one tick inside the opposite best: a buy at the best ask less a tick, a
 * sell at the best bid plus a tick. That price never crosses the same book and is always at least as good for us as the
 * rule's: a crossing buy's rule price is at or over the ask, so the ask less a tick is under it; a sell's the mirror. If it
 * were not, the rule's price stands and the crossing check refuses it.
 */
export function exitTicksOnBook(side: "buy" | "sell", ruleTicks: number, b: BookSeen | null): number {
  const touch = side === "buy" ? b?.bestAsk : b?.bestBid;
  if (touch == null) return ruleTicks;
  const t = Math.round(touch / QUOTE_TICK);
  if (side === "buy" ? ruleTicks < t : ruleTicks > t) return ruleTicks;           // rests where the rule put it
  const inside = side === "buy" ? t - 1 : t + 1;
  return (side === "buy" ? inside <= ruleTicks : inside >= ruleTicks) && inside > 0 ? inside : ruleTicks;
}
export function crossesBook(side: "buy" | "sell", price: number, b: BookSeen | null): boolean | null {
  if (!b) return null;
  const touch = side === "buy" ? b.bestAsk : b.bestBid;
  if (touch == null) return null;
  return side === "buy" ? price >= touch : price <= touch;
}

/**
 * Where new entries go this turn. The global pause outranks everything. `dry_run` sends nothing. Live needs `dry_run` off
 * AND `live_confirmed_at` set AND the key, and an unreadable `agent_risk` refuses entries, as it does for the strategy rows.
 */
export function entryBookOf(cfg: Pick<LiveConfig, "dry_run" | "live_confirmed_at">, o: { globalPause: boolean; riskReadable: boolean; canTrade: boolean }): { book: LiveMode | null; why: string } {
  if (o.globalPause) return { book: null, why: "agent_risk.global_pause: every open order is cancelled, exits included, and nothing is placed" };
  if (!o.riskReadable) return { book: null, why: "agent_risk is unreadable: no entries this turn; exits and stops run" };
  if (cfg.dry_run) return { book: "dry_run", why: "dry_run: every entry is recorded and none is sent" };
  if (!cfg.live_confirmed_at) return { book: null, why: "live_confirmed_at is null: no entries; exits and the 24-hour stops stay armed" };
  if (!o.canTrade) return { book: null, why: "PR5's Revolut X key is not loaded: nothing can be sent" };
  return { book: "live", why: "live: dry_run is off and live_confirmed_at is set" };
}

// ------------------------------------------------------------------ the executor

export type QuoteLiveDeps = {
  db: Db;
  now: number;
  holder: string;
  uuid: () => string;
  /** PR5's own sub-account (`revx2`), keyed: its balances and, for live rows only, its order endpoints. Null without its key. */
  account: Venue | null;
  /** Why `account` is null, when it is. */
  accountNote?: string | null;
  /** Keyless public reads (the pairs' configuration, the order book an order meets). */
  fetch?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  clock?: () => number;
  /** Which executor this is: the live account when left out (`QUOTE_LIVE_INSTANCE`), or a realistic twin's. */
  instance?: QuoteLiveInstance;
  /** An instance with `take`: the recorder's read of a book a take decides on (step 2); `recordedBookAt` on `db` when left out. */
  recordedBook?: (book: QuoteBook, at: number) => Promise<RecordedRead | null>;
  /**
   * When the dead-man switch last ran (its newest beat, epoch ms; null when none is stored). Given only for the live
   * account (`quotesLiveDeps` in index.ts): a stale or missing beat withdraws its entries (`QUOTE_LIVE_DEADMAN_WATCH_MS`).
   * Left out, nothing is watched: the realistic twins and the frozen-copy comparison run as they did.
   */
  deadmanBeatAt?: () => Promise<number | null>;
};

export type QuoteLiveReport = {
  at: string; skipped?: string;
  entryBook: LiveMode | null; why: string;
  minute: string | null;
  placed: Array<{ mode: LiveMode; rung: string; leg: LiveLeg; side: "buy" | "sell"; price: number; base: number; state: string }>;
  cancelled: Array<{ mode: LiveMode; rung: string; reason: string; outcome: string }>;
  settled: Array<{ id: number; state: string }>;
  skippedEntries: Array<{ mode: LiveMode; rung: string; reason: string }>;
  guards: Record<string, string[]>;
  posts: Record<LiveMode, number>;
  dayPnlGbp: number | null;
  errors: string[];
  /** The errors the errors box hears this turn (`liveAlerts`), where that differs from `errors`; unset, the box hears `errors`. */
  alerts?: string[];
  /** The live account's weekend quoting (0131) in force this turn: the decisions were its weekend replica's. */
  weekend?: { source: "weekend" };
  /** What the switches in shadow (0131) recorded this turn and did not send. */
  shadow?: { takes: number; weekend: number };
};

/** One place where an order row is written, sent (live) or not (dry-run), and brought up to date: the turn's and the conversion's. */
type Ctx = {
  d: QuoteLiveDeps; report: QuoteLiveReport; nowIso: string;
  inst: QuoteLiveInstance;
  holdLease: () => Promise<boolean>;
  pacePost: () => Promise<void>;
  pause: (ms: number) => Promise<void>;
  bookSeen: (b: QuoteBook) => Promise<BookSeen | null>;
  posts: Record<LiveMode, number>;
  /** Each governed key's POSTs today, by mode (`QuoteLiveInstance.govKey`): the live account's one key is every POST. */
  keyPosts: Record<LiveMode, Record<string, number>>;
};

/** The POSTs a rung's key has sent today: the governor's count for that rung. */
const keyCount = (ctx: Pick<Ctx, "inst" | "keyPosts">, mode: LiveMode, book: QuoteBook, rungSide: Side | null) => ctx.keyPosts[mode][ctx.inst.govKey(book, rungSide)] ?? 0;
const countKey = (ctx: Pick<Ctx, "inst" | "keyPosts">, mode: LiveMode, book: QuoteBook, rungSide: Side | null) => {
  const k = ctx.inst.govKey(book, rungSide);
  ctx.keyPosts[mode][k] = (ctx.keyPosts[mode][k] ?? 0) + 1;
};

async function patchRow(ctx: Ctx, o: LiveOrderRow, p: Partial<LiveOrderRow>): Promise<void> {
  await ctx.d.db.update(ctx.inst.orders, `id=eq.${o.id}`, { ...p, updated_at: ctx.nowIso });
  Object.assign(o, p);
}

/**
 * Place one order. The row is written `pending` BEFORE the venue is called, so a lost reply is reconciled by client id on
 * the next turn. The insert is also the rung's claim: the partial unique index refuses a second open row on a rung.
 * A post-only order the book it met shows crossing is not sent, in either mode: it is recorded `rejected` (the rule's
 * refused state, which the venue would give it) with `wouldBeRefused`, and is no POST. A dry-run row is not sent either;
 * it is recorded `new`. A 4xx is a refusal (`rejected`). A 5xx, or a reply that never came, says nothing about the
 * order, so the row stays `pending`.
 */
async function placeOrder(ctx: Ctx, o: {
  mode: LiveMode; book: QuoteBook; rungSide: Side | null; k: number | null; leg: LiveLeg; side: "buy" | "sell"; ticks: number; base: string;
  marketable: boolean; fair: number | null; paper?: PaperTarget | null;
  /** An exit's: the paper engine's last print as the order goes out, which a refusal waits past (`exitMayGo`). */
  lastPrint?: SeenPrint | null;
  /** Kept in the request beside the order: an automatic top-up's `auto` and the figures it was sized from. */
  extra?: Record<string, unknown>;
  /**
   * An exit that meets the book (`exitInsideOn`): when the book it met still shows it crossing, nothing is written and
   * nothing sent, and the turn's report says why; the next turn tries again. Otherwise a crossing order is a refused row.
   */
  skipIfCrossing?: boolean;
}): Promise<LiveOrderRow | null> {
  const { d, report } = ctx;
  const label = o.rungSide ? rungLabel(o.book, o.rungSide, o.k!) : `${o.book}|convert`;
  const price = (o.ticks * QUOTE_TICK).toFixed(4);
  const seen = await ctx.bookSeen(o.book);
  const crosses = o.marketable ? null : crossesBook(o.side, Number(price), seen);
  if (crosses && o.skipIfCrossing) {
    report.skippedEntries.push({ mode: o.mode, rung: label, reason: `${o.leg} ${o.side} at ${price} crosses the book it met (best bid ${seen?.bestBid ?? "none"}, best ask ${seen?.bestAsk ?? "none"}): not sent; the next turn tries again` });
    return null;
  }
  if (o.mode === "live" && !(await ctx.holdLease())) { report.errors.push(`${label}: live ${o.leg} not placed: the lease is lost`); return null; }
  const clientOrderId = d.uuid();
  const request = {
    clientOrderId, symbol: LIVE_SYMBOL[o.book], side: o.side, base: o.base, price, postOnly: !o.marketable, marketable: o.marketable,
    timeInForce: o.marketable ? "ioc" : "gtc", crossesBook: crosses, ...(o.lastPrint !== undefined ? { paperLastPrint: o.lastPrint } : {}),
    ...(o.extra ?? {}),
  };
  let row: LiveOrderRow;
  try {
    [row] = await d.db.insert<LiveOrderRow>(ctx.inst.orders, {
      mode: o.mode, book: o.book, rung_side: o.rungSide, k: o.k, leg: o.leg, side: o.side, price: Number(price), base_size: Number(o.base),
      client_order_id: clientOrderId, state: "pending", paper_oid: o.paper?.oid ?? null, paper_live: o.paper ? iso(o.paper.live) : null,
      fair: o.fair, request, book_seen: seen,
    }, true);
  } catch (e) {
    if (isUniqueViolation(e)) { report.errors.push(`${label}: another ${o.mode} order is open on this rung; nothing placed`); return null; }
    throw e;
  }
  const done = (state: string) => report.placed.push({ mode: o.mode, rung: label, leg: o.leg, side: o.side, price: Number(price), base: Number(o.base), state });
  if (crosses) {
    // Refused at the book it met, as the venue refuses it, and never sent: the venue's matching engine is not asked.
    await patchRow(ctx, row, { state: "rejected", cancelled_at: ctx.nowIso, response: { ...(o.mode === "dry_run" ? { dryRun: true } : {}), wouldBeRefused: true } });
    done(row.state);
    return row;
  }
  ctx.posts[o.mode]++;
  countKey(ctx, o.mode, o.book, o.rungSide);
  if (o.mode === "dry_run") {
    // Nothing is sent, and the book it met says the venue would have taken it.
    await patchRow(ctx, row, { state: "new", response: { dryRun: true, wouldBeRefused: crosses == null ? null : false } });
    done(row.state);
    return row;
  }
  let placed: Awaited<ReturnType<Venue["placeLimit"]>>;
  let retriedAfter429 = false;
  const send = async () => {
    await ctx.pacePost();
    return await d.account!.placeLimit({ clientOrderId, symbol: LIVE_SYMBOL[o.book], side: o.side, base: o.base, price, marketable: o.marketable });
  };
  try {
    placed = await send();
    // A 429 is the rate limit turning the order away before the book saw it: the same order, same client id, once more.
    // It is a second POST, and the governor counts it as one (A4).
    if (!placed.ok && placed.status === 429) {
      retriedAfter429 = true; ctx.posts[o.mode]++; countKey(ctx, o.mode, o.book, o.rungSide);
      await ctx.pause(QUOTE_LIVE_429_WAIT_MS); placed = await send();
    }
  } catch (e) {
    report.errors.push(`${label}: placement of ${clientOrderId} has no reply (${msg(e)}); left pending for the next turn to reconcile by client id`);
    done("pending");
    return row;
  }
  if (!placed.ok && !(placed.status >= 400 && placed.status < 500)) {
    await patchRow(ctx, row, { response: { status: placed.status, error: placed.error, response: placed.response, outcome: "unknown", ...(retriedAfter429 ? { retriedAfter429 } : {}) } });
    report.errors.push(`${label}: the venue answered ${placed.status} ${placed.error}: outcome unknown; ${clientOrderId} stays pending for the next turn to reconcile`);
    done("pending");
    return row;
  }
  if (!placed.ok) {
    await patchRow(ctx, row, { state: "rejected", cancelled_at: ctx.nowIso, response: { status: placed.status, error: placed.error, response: placed.response, retriedAfter429 } });
    if (placed.status === 429) report.errors.push(`${label}: the venue's rate limit turned ${clientOrderId} away twice; it is sent again next turn`);
    done("rejected");
    return row;
  }
  const replied = placed.response && typeof placed.response === "object" ? placed.response as Record<string, unknown> : { raw: placed.response };
  await patchRow(ctx, row, { state: "new", venue_order_id: placed.venueOrderId, response: { ...replied, placedState: placed.state, ...(retriedAfter429 ? { retriedAfter429 } : {}) } });
  done("new");
  return row;
}

function makeCtxHelpers(d: QuoteLiveDeps, report: QuoteLiveReport, inst: QuoteLiveInstance) {
  const clock = d.clock ?? (() => Date.now());
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const f = d.fetch ?? fetch;
  // Revolut X's public bucket is about a token a second, shared with the paper engine, which read it moments ago.
  let lastPublic = 0;
  const pub = async <T,>(path: string) => {
    const wait = lastPublic ? lastPublic + QUOTE_REVX_GAP_MS - clock() : QUOTE_REVX_GAP_MS;
    if (wait > 0) await pause(wait);
    lastPublic = clock();
    return await revxPublic<T>(path, f, 8_000, pause);
  };
  // The executor's own order POSTs: at most one each QUOTE_LIVE_POST_GAP_MS, under the venue's 10 a second on the key.
  let lastPost = 0;
  const pacePost = async () => {
    const wait = lastPost ? lastPost + QUOTE_LIVE_POST_GAP_MS - clock() : 0;
    if (wait > 0) await pause(wait);
    lastPost = clock();
  };
  let renewedAt = clock(), leaseLost = false;
  /** Keep, and check, the lease before every live order: a turn that lost it stops sending (the tick's rule). */
  const holdLease = async (): Promise<boolean> => {
    if (leaseLost) return false;
    const now = clock();
    if (now - renewedAt < QUOTE_LIVE_LEASE_MS / 2) return true;
    try {
      const rows = await d.db.claim<{ name: string }>("agent_locks", `name=eq.${inst.lease}&holder=eq.${enc(d.holder)}`, { lease_until: iso(now + QUOTE_LIVE_LEASE_MS) });
      if (!rows.length) { leaseLost = true; report.errors.push(`lease lost: another run holds ${inst.lease} now; this one stops sending`); return false; }
      renewedAt = now;
      return true;
    } catch (e) { report.errors.push(`lease renewal: ${msg(e)}`); return true; }
  };
  const seenBy = new Map<QuoteBook, Promise<BookSeen | null>>();
  /** The book an order meets: the paper engine's snapshot of this minute when it took one, else one public read, once a turn. */
  const bookSeen = (b: QuoteBook) => {
    if (!seenBy.has(b)) seenBy.set(b, (async () => {
      const minute = iso(minuteOf(d.now));
      try {
        const ev = await d.db.select<{ detail: { book?: unknown; at?: number } }>("agent_quote_events",
          `book=eq.${b}&minute=eq.${enc(minute)}&side=eq.-&k=eq.0&kind=eq.book&select=detail`);
        const got = ev[0] ? parseBook(ev[0].detail?.book, "paper", ev[0].detail?.at ? iso(Number(ev[0].detail.at)) : minute) : null;
        if (got) return got;
      } catch { /* the public read below stands in */ }
      try {
        const r = await pub<unknown>(`/api/2.0/public/order-book/${b}?region=UK&limit=5`);
        if (!r.ok) { report.errors.push(`order book ${b}: ${r.status} ${r.error}`); return null; }
        return parseBook(r.data, "public", iso(clock()));
      } catch (e) { report.errors.push(`order book ${b}: ${msg(e)}`); return null; }
    })());
    return seenBy.get(b)!;
  };
  const pairs = async (): Promise<Record<string, PairConfig>> => {
    const r = await pub<Record<string, PairConfig>>("/api/1.0/public/configuration/pairs");
    if (!r.ok) throw new Error(`pairs → ${r.status} ${r.error}`);
    const out: Record<string, PairConfig> = {};
    for (const s of Object.values(LIVE_SYMBOL)) {
      const p = r.data?.[s];
      if (p) out[s] = { base_step: p.base_step, quote_step: p.quote_step, min_order_size: p.min_order_size, min_order_size_quote: p.min_order_size_quote };
    }
    return out;
  };
  return { holdLease, bookSeen, pairs, clock, pacePost, pause };
}

/** The paper engine's decided minute and the inputs it priced each book from, read the way it reads them. */
async function paperView(d: QuoteLiveDeps, inst: QuoteLiveInstance, weekendLive = false): Promise<{ paper: QuoteState | null; T: number | null; inputs: Partial<Record<QuoteBook, BookInputs>>; source: "paper" | "weekend" }> {
  let row = (await d.db.select<{ state: QuoteState | Record<string, never>; last_minute: string | null }>(inst.paper, "id=eq.1&select=state,last_minute"))[0];
  // The live account's weekend quoting (0131, `weekend_mode` 'live'): inside an FX closure it carries out its weekend
  // replica's decisions (PR5's rule with PR5-W's weekend rule, `quotes_live_weekend.ts`), read as the paper engine is, at
  // fair on the replica's held X. A replica that has not decided the paper engine's minute is stale, as any paper engine.
  let source: "paper" | "weekend" = "paper";
  const t0 = row?.last_minute ? Date.parse(row.last_minute) : null;
  if (weekendLive && inst.liveSwitches && t0 != null && inQuoteClosure(t0)) {
    row = (await d.db.select<{ state: QuoteState | Record<string, never>; last_minute: string | null }>(inst.liveSwitches.wkPaper, "id=eq.1&select=state,last_minute"))[0];
    source = "weekend";
  }
  const paper = row && row.state && "books" in row.state ? row.state as QuoteState : null;
  const T = row?.last_minute ? Date.parse(row.last_minute) : null;
  const inputs: Partial<Record<QuoteBook, BookInputs>> = {};
  if (T == null) return { paper, T, inputs, source };
  const series = async (kind: string, from: number) => (await d.db.selectAll<{ t: string; value: number | string }>("agent_quote_inputs",
    `kind=eq.${enc(kind)}&t=gte.${enc(iso(from))}&t=lte.${enc(iso(T))}&select=t,value&order=kind.asc,t.asc`)).map((r) => [Date.parse(r.t), Number(r.value)] as [number, number]);
  const fx = await series("fx", T - QUOTE_FX_LOOKBACK_MS);
  for (const b of QUOTE_BOOKS) {
    const i = bookInputs(T, fx, await series(`fair:${QUOTE_USD_BOOK[b]}`, T - 26 * H));
    // The weekend rule, an instance's alone (none for the live account): a dark closure minute at the replica's last X.
    const rule = source === "weekend" ? LIVE_WEEKEND_RULE : inst.weekend;
    const wi = rule ? weekendInputs(i, T, paper?.books?.[b]?.lastX ?? null, rule) : i;
    // The USDC-GBP nudge, a twin's alone (`fairNudge`): the fair its replica priced the minute off. Without it, `wi` exactly.
    inputs[b] = inst.fairNudge ? nudgedInputs(wi, b, T, inst.fairNudge, (paper as { nudge?: NudgeState } | null)?.nudge?.last) : wi;
  }
  return { paper, T, inputs, source };
}

/**
 * One turn of the executor. It runs right after the paper engine's minute, from the same cron job (`agents?action=quotes`).
 * It never throws: a failed read ends the turn with its reason in `errors`.
 */
export async function runQuotesLive(d: QuoteLiveDeps): Promise<QuoteLiveReport> {
  const inst = d.instance ?? QUOTE_LIVE_INSTANCE;
  const report: QuoteLiveReport = {
    at: iso(d.now), entryBook: null, why: "", minute: null, placed: [], cancelled: [], settled: [], skippedEntries: [], guards: {},
    posts: { dry_run: 0, live: 0 }, dayPnlGbp: null, errors: [],
  };
  let held: { name: string }[];
  try {
    held = await d.db.claim<{ name: string }>("agent_locks", `name=eq.${inst.lease}&lease_until=lt.${enc(iso(d.now))}`, { lease_until: iso(d.now + QUOTE_LIVE_LEASE_MS), holder: d.holder });
  } catch (e) {
    report.errors.push(`LEASE CLAIM FAILED — agent_locks: ${msg(e)}; nothing done this minute`);
    return report;
  }
  if (!held.length) return { ...report, skipped: `another run holds the ${inst.lease} lease` };
  try {
    await turn(d, report, inst);
  } catch (e) {
    report.errors.push(`turn: ${msg(e)}`);
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${inst.lease}&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires on its own */ }
  }
  return report;
}

type RungNow = {
  book: QuoteBook; side: Side; k: number; label: string;
  paper: PaperTarget | null; paperRefused: boolean;
  /** What the paper rung is doing: a take waits while it holds a position of its own. */
  paperMode: Rung["mode"] | null;
  live: RungBook; holding: boolean; dust: number;
};

async function turn(d: QuoteLiveDeps, report: QuoteLiveReport, inst: QuoteLiveInstance): Promise<void> {
  const nowIso = iso(d.now), nowMinute = minuteOf(d.now), dayStart = Math.floor(d.now / DAY) * DAY;
  const h = makeCtxHelpers(d, report, inst);
  const ctx: Ctx = { d, report, nowIso, inst, holdLease: h.holdLease, bookSeen: h.bookSeen, posts: report.posts, keyPosts: { dry_run: {}, live: {} }, pacePost: h.pacePost, pause: h.pause };
  /** The governor's level for a rung's key (`QuoteLiveInstance.govKey`): the live account's is every POST of the mode. */
  const levelOf = (mode: LiveMode, book: QuoteBook, rungSide: Side | null) => governorLevel(keyCount(ctx, mode, book, rungSide));
  const multiKey = isMultiKey(inst);

  let cfg: LiveConfig | undefined;
  try {
    const cols = "id=eq.1&select=dry_run,live_confirmed_at,capital_gbp";
    try { cfg = (await d.db.select<LiveConfig>(inst.config, inst.liveSwitches ? `${cols},take_mode,weekend_mode` : cols))[0]; }
    catch (e) {
      // 0131's switches before its migration has run (the function and the migration deploy separately): both off.
      if (!inst.liveSwitches || !MISSING_COLUMN.test(msg(e))) throw e;
      cfg = (await d.db.select<LiveConfig>(inst.config, cols))[0];
    }
  } catch (e) {
    // The function can deploy a minute before its migration is applied: that is "not yet", not an error every minute.
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(msg(e))) { report.skipped = `the live tables are not in this database yet: migration ${inst.migration} has not run`; return; }
    throw e;
  }
  if (!cfg) { report.skipped = `no ${inst.config} row: migration ${inst.migration} has not run`; return; }
  const capital = Number(cfg.capital_gbp);
  let globalPause = false, riskReadable = true;
  try { globalPause = !!(await d.db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause"))[0]?.global_pause; }
  catch (e) { riskReadable = false; report.errors.push(`agent_risk unreadable (${msg(e)}): no entries this turn, exits still run`); }
  const acct = d.account?.canTrade ? d.account : null;
  const entry = entryBookOf(cfg, { globalPause, riskReadable, canTrade: !!acct });
  report.entryBook = entry.book; report.why = entry.why;

  // The live account's switches (0131): off unless its config says shadow or live; a twin has none.
  const takeMode = inst.liveSwitches ? switchMode(cfg.take_mode) : "off", weekendMode = inst.liveSwitches ? switchMode(cfg.weekend_mode) : "off";
  const { paper, T, inputs, source } = await paperView(d, inst, weekendMode === "live");
  report.minute = T != null ? iso(T) : null;
  if (source === "weekend") report.weekend = { source };
  const caughtUp = T != null && T === nowMinute - M;

  // Essential: what is open (the rungs' claims) — without it nothing may be placed or cancelled.
  const openAll = await d.db.selectAll<LiveOrderRow>(inst.orders, "state=in.(pending,new,partially_filled)&select=*&order=id.asc");
  let pairs: Record<string, PairConfig> = {};
  try { pairs = await h.pairs(); } catch (e) { report.errors.push(`pair config unreadable (${msg(e)}): nothing is placed and no buy settles this turn`); }

  // ── 1. what the venue did with our orders ─────────────────────────────────────────────────────────────────────────
  const unreadable = new Set<number>();
  /** What the account can still promise (step 4 fills it in), and what each open order holds of it. */
  const free: Record<string, number> = {};
  const promised = new Map<number, { asset: string; amount: number }>();
  let balancesP: Promise<Record<string, number>> | null = null;
  const balancesOnce = () => (balancesP ??= acct!.balances());
  let activeP: ReturnType<Venue["activeOrders"]> | null = null;
  const activeOnce = () => (activeP ??= acct!.activeOrders());
  const stopsUnfilled: LiveOrderRow[] = [];

  /** A buy's base, by the tick's own D11/D12 rule (`bookLiveBuy`); null when it cannot be booked this turn (reported). */
  const bookBuy = async (o: LiveOrderRow, view: OrderView, gross: number): Promise<{ base: number; fromAccount?: FromAccount } | null> => {
    const label = o.rung_side ? rungLabel(o.book, o.rung_side, o.k!) : `${o.book}|convert`;
    const step = pairs[LIVE_SYMBOL[o.book]]?.base_step;
    if (!step) { report.errors.push(`${label}: buy ${o.client_order_id} filled, but the pair config is unreadable this turn and its base step with it; it settles next turn`); return null; }
    if (!view.feeDerived) { const b = bookLiveBuy(gross, step, null); return b.ok ? { base: b.base } : null; }
    const asset = coinOf(o.book);
    let held: number;
    try { held = (await balancesOnce())[asset] ?? 0; }
    catch (e) { report.errors.push(`${label}: buy ${o.client_order_id} came back with no fee, so it is booked from the account, and the balances are unreadable (${msg(e)}); it settles next turn`); return null; }
    const settled = await d.db.selectAll<Pick<LiveOrderRow, "id" | "book" | "side" | "filled_base">>(inst.orders,
      "mode=eq.live&state=in.(filled,partially_filled)&select=id,book,side,filled_base&order=id.asc");
    const rest = settled.filter((r) => r.id !== o.id && coinOf(r.book) === asset).reduce((a, r) => a + (r.side === "buy" ? 1 : -1) * Number(r.filled_base), 0);
    const b = bookLiveBuy(gross, step, { asset, held, rest, feeBps: view.feeDerived.bps });
    if (!b.ok) {
      report.errors.push(`${label}: buy ${o.client_order_id} of ${gross} ${asset} came back with no fee; the account holds ${held} ${asset}, ${b.beyond} beyond the rest of the live book — short of the gross by more than its ${view.feeDerived.bps} bps fee explains (a sell in flight, or a trade by hand?); it settles when the account accounts for it`);
      return null;
    }
    return { base: b.base, fromAccount: b.fromAccount };
  };

  /** Write what the venue's read-back says: a fill (never on anything but this read), a cancel, a refusal, or nothing new. */
  const settleFromView = async (o: LiveOrderRow, view: OrderView): Promise<void> => {
    const gross = view.filledBase;
    if (gross > 0) {
      let base = gross, fromAccount: FromAccount | undefined;
      if (o.side === "buy") {
        const b = await bookBuy(o, view, gross);
        if (!b) { unreadable.add(o.id); return; }
        base = b.base; fromAccount = b.fromAccount;
      }
      // A cancelled order that filled in part is a fill of that part: an entry the venue part-filled before its cancel landed.
      const state: LiveOrderState = view.state === "partially_filled" ? "partially_filled" : "filled";
      if (state === o.state && Number(o.filled_base) === base) return;
      await patchRow(ctx, o, {
        state, filled_base: base, avg_fill_price: view.avgPrice, fee_gbp: view.feeUsd,
        filled_at: fillStamp({ filled_at: o.filled_at, ts: o.ts, request: { marketable: !!o.request?.marketable } }, nowIso),
        response: withFeeNote(view.raw, view, fromAccount), ...(view.state === "cancelled" ? { cancelled_at: nowIso } : {}),
      });
      report.settled.push({ id: o.id, state });
      if (o.leg === "stop" && state === "filled" && base < Number(o.base_size)) stopsUnfilled.push(o);
      return;
    }
    if (view.state === "cancelled" || view.state === "rejected") {
      await patchRow(ctx, o, { state: view.state, cancelled_at: nowIso, response: view.raw });
      report.settled.push({ id: o.id, state: view.state });
      if (o.leg === "stop") stopsUnfilled.push(o);
    }
  };

  const readBack = async (o: LiveOrderRow): Promise<void> => {
    const v = await acct!.order(o.venue_order_id!);
    if (!v.ok) { unreadable.add(o.id); report.errors.push(`${o.book}: order ${o.venue_order_id} unreadable (${v.error}); left as it is`); return; }
    await settleFromView(o, v.view);
  };

  /**
   * Take an order off the book, CONFIRMED: the DELETE, then the order read back. Only a read-back showing it cancelled
   * (or filled) confirms it. A 204 alone does not: a lost cancel followed by the replacement would put two orders on one
   * rung. The venue carries a cancel out a moment after its 204, so an order still open on its read-back is read again
   * (`QUOTE_LIVE_CANCEL_REREAD_MS`). Unconfirmed after that, the row keeps `cancel_requested_at`, the rung is frozen, and
   * every later turn asks again. A freeze is an error only from the turn after the cancel was first asked: one the venue
   * has not carried out within a minute is not the venue being a moment behind.
   */
  const cancelConfirmed = async (o: LiveOrderRow, reason: string): Promise<"cancelled" | "filled" | "frozen"> => {
    const label = o.rung_side ? rungLabel(o.book, o.rung_side, o.k!) : `${o.book}|convert`;
    const out = (outcome: "cancelled" | "filled" | "frozen") => {
      report.cancelled.push({ mode: o.mode, rung: label, reason, outcome });
      // A cancel read back as done gives back what the order held, so the replacement a re-price sends can be covered by it.
      const p = outcome === "cancelled" ? promised.get(o.id) : undefined;
      if (p) { free[p.asset] = (free[p.asset] ?? 0) + p.amount; promised.delete(o.id); }
      return outcome;
    };
    if (o.mode === "dry_run") {
      await patchRow(ctx, o, { state: "cancelled", cancel_requested_at: o.cancel_requested_at ?? nowIso, cancel_reason: o.cancel_reason ?? reason, cancelled_at: nowIso });
      return out("cancelled");
    }
    if (!acct || !o.venue_order_id) {
      report.errors.push(`${label}: cannot cancel ${o.client_order_id} (${!o.venue_order_id ? "the venue's id for it is not known yet" : "PR5's key is not loaded"}); the rung is frozen`);
      return out("frozen");
    }
    const askedBefore = !!o.cancel_requested_at && Date.parse(o.cancel_requested_at) < Date.parse(nowIso);
    if (!o.cancel_requested_at) await patchRow(ctx, o, { cancel_requested_at: nowIso, cancel_reason: reason });
    let refused: string | null = null;
    try { const c = await acct.cancel(o.venue_order_id); if (!c.ok) refused = c.error ?? "refused"; } catch (e) { refused = msg(e); }
    const venueOrderId = o.venue_order_id;
    const read = () => acct.order(venueOrderId).catch((e) => ({ ok: false as const, error: msg(e) }));
    const open = (state: string) => state === "new" || state === "partially_filled";
    let v = await read();
    for (const ms of QUOTE_LIVE_CANCEL_REREAD_MS) {
      if (!v.ok || !open(v.view.state)) break;
      await ctx.pause(ms);
      v = await read();
    }
    if (!v.ok) {
      report.errors.push(`${label}: cancel of ${o.venue_order_id} could not be read back (${v.error}); the rung is FROZEN until it is`);
      return out("frozen");
    }
    await settleFromView(o, v.view);
    if (o.state === "cancelled" || o.state === "rejected") return out("cancelled");
    if (o.state === "filled") return out("filled");
    if (askedBefore) report.errors.push(`${label}: cancel of ${o.venue_order_id} first asked at ${o.cancel_requested_at} and sent again${refused ? ` (${refused})` : ""}, and the venue still shows it ${v.view.state}; the rung is FROZEN: no replacement until the venue shows it cancelled`);
    return out("frozen");
  };

  // A dry-run row is written `pending` and brought to `new` or `rejected` in the same call. One left `pending` (that second
  // write failed) was never sent anywhere: it is closed, so it cannot hold its rung.
  for (const o of openAll) {
    if (o.mode === "dry_run" && o.state === "pending" && d.now - Date.parse(o.ts) >= QUOTE_LIVE_PENDING_GRACE_MS) {
      try { await patchRow(ctx, o, { state: "cancelled", cancelled_at: nowIso, cancel_reason: "a dry-run row left pending: nothing was sent" }); }
      catch (e) { report.errors.push(`dry-run row ${o.id}: ${msg(e)}`); }
    }
  }
  const liveOpen = openAll.filter((o) => o.mode === "live");
  if (liveOpen.length && !acct) report.errors.push(`${liveOpen.length} live order(s) open and PR5's Revolut X key is not loaded (${d.accountNote ?? "no key"}); none can be read, cancelled or settled`);
  // Sells first: a sell that has left the account must be on the book before a buy is booked from the balance (D12).
  for (const o of [...liveOpen].sort((a, b) => (a.side === b.side ? a.id - b.id : a.side === "sell" ? -1 : 1))) {
    if (!acct) break;
    const label = o.rung_side ? rungLabel(o.book, o.rung_side, o.k!) : `${o.book}|convert`;
    try {
      if (o.state === "pending") {
        const ageMs = d.now - Date.parse(o.ts);
        if (ageMs < QUOTE_LIVE_PENDING_GRACE_MS) continue;                  // the current turn's own
        const unknown = `${label}: pending ${o.side} ${o.base_size} ${LIVE_SYMBOL[o.book]} (${o.client_order_id}) is neither among the venue's active orders nor in its history ${Math.round(ageMs / M)} min on — outcome unknown; it stays pending for a person to settle, and the rung places nothing`;
        // Parked: an hour shown nowhere, it is looked for every quarter hour, not every minute (it stays pending all the same).
        if (ageMs >= QUOTE_LIVE_PARK_AFTER_MS && Math.floor(d.now / M) % Math.round(QUOTE_LIVE_PARKED_EVERY_MS / M) !== 0) { report.errors.push(unknown); continue; }
        const a = await activeOnce();
        if (!a.ok) { report.errors.push(`${label}: active orders unreadable (${a.error}); ${o.client_order_id} stays pending`); continue; }
        const act = a.byClientId[o.client_order_id];
        if (act) {
          await patchRow(ctx, o, { state: "new", venue_order_id: act.venueOrderId, response: { reconciled: "active", view: act.view.raw } });
          if (act.view.filledBase > 0) await readBack(o);
          continue;
        }
        if (acct.findOrder) {
          const hist = await acct.findOrder(o.client_order_id, LIVE_SYMBOL[o.book], Date.parse(o.ts));
          if (hist.ok && hist.found) {
            await patchRow(ctx, o, { venue_order_id: hist.found.venueOrderId });
            await settleFromView(o, hist.found.view);
            continue;
          }
          if (!hist.ok) report.errors.push(`${label}: order history unreadable (${hist.error})`);
        }
        report.errors.push(unknown);
        continue;
      }
      if (!o.venue_order_id) { report.errors.push(`${label}: ${o.state} with no venue id; left for a person`); continue; }
      if (o.cancel_requested_at) { await cancelConfirmed(o, o.cancel_reason ?? "an earlier cancel"); continue; }
      const a = await activeOnce();
      const act = a.ok ? a.byClientId[o.client_order_id] : undefined;
      if (act && act.view.state === "new" && !(act.view.filledBase > 0) && o.state === "new") continue;   // resting, untouched: nothing to read
      await readBack(o);
    } catch (e) {
      unreadable.add(o.id);
      report.errors.push(`${label}: settle ${msg(e)}`);
    }
  }
  const open = openAll.filter(isOpen);
  // A conversion resting at the bid (`quotes-convert`, maker by default) buys coin, as an entry does: it goes with the global
  // pause, whenever the executor is not live and armed, and once QUOTE_LIVE_CONVERT_REST_MS have passed since its first send
  // (`convertFirstAt`: a re-pegged one's 24 hours count from the operator's send, step 6b′). Its fills are booked above, as
  // every live order's are; a cancel already asked is asked again there.
  for (const o of open.filter((x) => x.mode === "live" && x.leg === "convert" && x.state !== "pending" && !x.cancel_requested_at && !unreadable.has(x.id))) {
    const why = globalPause ? "global pause" : entry.book !== "live" ? `not live and armed (${entry.why})`
      : isDrain(o) ? (d.now - Date.parse(o.ts) >= QUOTE_LIVE_TOPUP_REST_MS ? "a rebook's sale unfilled after 30 minutes: the next turn sends what is still surplus at the book as it stands" : null)
      : isAutoConvert(o) ? (d.now - Date.parse(o.ts) >= QUOTE_LIVE_TOPUP_REST_MS ? "a top-up unfilled after 30 minutes: the next turn that finds an ask short sends another at the book as it stands" : null)
      : d.now - convertFirstAt(o) >= QUOTE_LIVE_CONVERT_REST_MS ? "unfilled after 24 hours: send another conversion if it is still wanted" : null;
    if (!why) continue;
    try { await cancelConfirmed(o, why); } catch (e) { report.errors.push(`${o.book}|convert: cancel ${msg(e)}`); }
  }
  const openOf = (mode: LiveMode, r: { book: QuoteBook; side: Side; k: number }) =>
    open.find((o) => isOpen(o) && o.mode === mode && o.book === r.book && o.rung_side === r.side && Number(o.k) === r.k) ?? null;

  // ── 2. the live book, from its fills ─────────────────────────────────────────────────────────────────────────────
  const fills = await d.db.selectAll<LiveOrderRow>(inst.orders, "mode=eq.live&state=in.(filled,partially_filled)&select=*&order=id.asc");
  const recent = await d.db.selectAll<Pick<LiveOrderRow, "id" | "ts" | "mode" | "book" | "rung_side" | "k" | "leg" | "state" | "paper_oid" | "paper_live" | "response">>(
    inst.orders, `ts=gte.${enc(iso(d.now - 25 * H))}&select=id,ts,mode,book,rung_side,k,leg,state,paper_oid,paper_live,response&order=id.asc`);
  for (const r of recent) {
    if (Date.parse(r.ts) < dayStart) continue;
    for (let n = postsOf(r); n > 0; n--) { report.posts[r.mode]++; countKey(ctx, r.mode, r.book, r.rung_side); }
  }
  const lastPrintPx = (b: QuoteBook) => paper?.books?.[b]?.lastPrint?.ticks != null ? paper.books[b].lastPrint!.ticks * QUOTE_TICK : null;
  const rungs: RungNow[] = [];
  for (const b of QUOTE_BOOKS) for (const side of ["bid", "ask"] as Side[]) for (const k of inst.rungs) {
    const mine = fills.filter((o) => o.book === b && o.rung_side === side && Number(o.k) === k && Number(o.filled_base) > 0).map((o): RungFill => ({
      id: o.id, ts: Date.parse(o.filled_at ?? o.ts), leg: o.leg, base: Number(o.filled_base), price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp || 0),
    }));
    const pair = pairs[LIVE_SYMBOL[b]];
    const px = inputs[b]?.f ?? lastPrintPx(b) ?? 0;
    const dust = pair && px > 0 ? dustBase(pair, px) : 0;
    // `holdMin` (PR5-OPT's; the live account's from QUOTE_LIVE_HOLD_MIN_FROM, its line the venue's dust before): the line a holding
    // must pass to count, and once its exit or stop is open, the venue's dust again, so the exit runs to the end.
    const line = holdLineBase(inst, d.now, dust, px);
    const exiting = line > dust && open.some((o) => isOpen(o) && o.mode === "live" && o.book === b && o.rung_side === side && Number(o.k) === k && o.leg !== "entry");
    const live = rungBook(side, mine, dayStart, line);
    const pr = paper?.books?.[b]?.rungs?.find((r) => r.side === side && r.k === k);
    rungs.push({ book: b, side, k, label: rungLabel(b, side, k), paper: paperEntryTarget(pr), paperRefused: paperRefused(pr), paperMode: pr?.mode ?? null, live, holding: live.held > (exiting ? dust : line), dust });
  }
  const mark = (b: QuoteBook) => lastPrintPx(b) ?? inputs[b]?.f ?? null;
  const dayPnl = rungs.reduce((a, r) => a + r.live.realisedTodayGbp + markedGbp(r.side, r.live, mark(r.book)), 0);
  report.dayPnlGbp = Math.round(dayPnl * 1e8) / 1e8;

  // The loss stop: tripped once, it holds for the rest of the UTC day.
  let lossStopped = false;
  try {
    lossStopped = (await d.db.select(inst.events, `mode=eq.live&kind=eq.loss_stop&minute=gte.${enc(iso(dayStart))}&select=minute&limit=1`)).length > 0;
  } catch (e) { lossStopped = true; report.errors.push(`loss stop unreadable (${msg(e)}): no live entries this turn`); }
  if (!lossStopped && lossStopHit(dayPnl, capital)) {
    lossStopped = true;
    await d.db.upsert(inst.events, [{ mode: "live", minute: iso(nowMinute), book: "-", rung_side: "-", k: 0, kind: "loss_stop", detail: { dayPnlGbp: report.dayPnlGbp, limitGbp: -QUOTE_LIVE_LOSS_FRACTION * capital } }], "mode,minute,book,rung_side,k,kind");
    report.errors.push(`LOSS STOP: today's P&L ${report.dayPnlGbp} GBP is past −${QUOTE_LIVE_LOSS_FRACTION * capital}; no live entries until the next UTC day; exits and stops stay armed`);
  }

  // ── 3. what each book may quote ──────────────────────────────────────────────────────────────────────────────────
  const staleBook = (b: QuoteBook) => !caughtUp || !inputs[b] || inputs[b]!.usdHourEnd == null || T! - inputs[b]!.usdHourEnd! > QUOTE_LIVE_USD_STALE_MS;
  // The dead-man switch's own clock (`QUOTE_LIVE_DEADMAN_WATCH_MS`): a beat that could not be READ is not a stopped
  // Worker, so it costs nothing this turn but its note; a stale or missing one withdraws the entries.
  let deadmanReason: string | null = null;
  if (d.deadmanBeatAt) {
    try { deadmanReason = deadmanWatchReason(await d.deadmanBeatAt(), d.now); }
    catch (e) { report.errors.push(`the dead-man switch's beat is unreadable (${msg(e)}): entries go on this turn`); }
  }
  for (const b of QUOTE_BOOKS) {
    const reasons: string[] = [];
    if (deadmanReason) reasons.push(deadmanReason);
    if (!caughtUp) reasons.push(`the paper engine's last minute is ${T != null ? iso(T) : "none"}, not ${iso(nowMinute - M)}: stale inputs`);
    if (T != null && inputs[b]) reasons.push(...entryGuards(T, inputs[b]!, lastPrintPx(b)));
    if (!pairs[LIVE_SYMBOL[b]]) reasons.push("no pair config this turn");
    else if (Number(pairs[LIVE_SYMBOL[b]].quote_step) > QUOTE_TICK + 1e-12) reasons.push(`the venue's price step ${pairs[LIVE_SYMBOL[b]].quote_step} is coarser than the rule's tick`);
    if (rungs.some((r) => r.book === b && r.holding && stopDue(r.live.openedAt, d.now))) reasons.push("a position on this book is past its 24-hour stop");
    report.guards[b] = reasons;
  }

  // ── 4. the balances, and what is already promised out of them ────────────────────────────────────────────────────
  // The live account is read whenever its key loads — in dry-run too: "the dry-run on the real account". Without the key a
  // dry-run assumes the capital, all in GBP, as the account starts.
  let bal: Record<string, number> | null = null;
  if (acct) {
    try { bal = { ...(await balancesOnce()) }; }
    catch (e) { report.errors.push(`balances unreadable (${msg(e)}): no entries this turn; exits are not capped by the account`); }
  } else if (entry.book === "dry_run") bal = { GBP: capital };
  /** The orders step 5 sends this turn, as `placeOrder` returns them: they hold the account as any open order does. */
  const sentNow: LiveOrderRow[] = [];
  const sent = (row: LiveOrderRow | null) => { if (row) sentNow.push(row); };
  /**
   * What the account can still promise to the entries step 6 sizes: its balances, less every order still open (step 5's
   * own exits and stops included), and less a holding no exit holds yet. It is taken after step 5, from the orders as
   * they then stand. Taken before it, as until 2026-10-02, a re-priced exit gave its coin back when its cancel was read
   * back and its replacement never took it again, so the entries counted that coin twice: at 14:13 UTC that day the venue
   * refused a USDC ask, "Not enough funds! Wanted 13.20307 USDC but has only 13.11631 USDC".
   */
  const takeStock = () => {
    promised.clear();
    for (const a of Object.keys(free)) delete free[a];
    if (!bal) return;
    free.GBP = bal.GBP ?? 0;
    for (const b of QUOTE_BOOKS) free[coinOf(b)] = bal[coinOf(b)] ?? 0;
    const standing = [...open, ...sentNow].filter(isOpen);
    // The live book's open orders, and the book entries go to (a dry-run's rows promise the same pounds a live bid would).
    for (const o of standing) {
      if (o.mode !== "live" && o.mode !== entry.book) continue;
      const left = Math.max(0, Number(o.base_size) - (Number(o.filled_base) || 0));
      const p = o.side === "buy" ? { asset: "GBP", amount: pennyUp(left * Number(o.price)) } : { asset: coinOf(o.book), amount: left };
      free[p.asset] -= p.amount;
      promised.set(o.id, p);
    }
    // A holding with no exit resting has its coins (a long) or its pounds (a short) spoken for all the same.
    for (const r of rungs) {
      if (!(r.live.held > 0) || standing.some((o) => o.mode === "live" && o.book === r.book && o.rung_side === r.side && Number(o.k) === r.k && o.leg !== "entry")) continue;
      if (r.side === "bid") free[coinOf(r.book)] -= r.live.held;
      else free.GBP -= r.live.held * (inputs[r.book]?.f ?? r.live.avgEntry);
    }
  };

  // ── 5. the live book's positions: the entry's remainder, the 24-hour stop, the exit ─────────────────────────────────
  const lastLeg = (r: RungNow, leg: LiveLeg) => [...recent].reverse().find((o) => o.mode === "live" && o.leg === leg && o.book === r.book && o.rung_side === r.side && Number(o.k) === r.k && !wasRateLimited(o)) ?? null;
  /** What an exit or stop can trade: the whole holding, a sell capped at what the account holds beyond other open sells. */
  const exitBase = (r: RungNow, price: number, own: LiveOrderRow | null): string | null => {
    const pair = pairs[LIVE_SYMBOL[r.book]];
    if (!pair) return null;
    let q = r.live.held;
    if (bal && r.side === "bid") {
      const coin = coinOf(r.book);
      const otherSells = [...open, ...sentNow].filter((o) => o !== own && isOpen(o) && o.mode === "live" && o.side === "sell" && coinOf(o.book) === coin).reduce((a, o) => a + Math.max(0, Number(o.base_size) - (Number(o.filled_base) || 0)), 0);
      q = Math.min(q, Math.max(0, (bal[coin] ?? 0) - otherSells));
    }
    const base = floorToStep(q, pair.base_step);
    if (!(Number(base) >= dustBase(pair, price)) || !(Number(base) > 0)) {
      report.errors.push(`${r.label}: holds ${r.live.held} and can trade ${base}, under the venue's minimum at ${price.toFixed(4)}; no ${r.side === "bid" ? "sell" : "buy-back"} placed`);
      return null;
    }
    if (bal && r.side === "ask") {
      const otherBuys = [...open, ...sentNow].filter((o) => o !== own && isOpen(o) && o.mode === "live" && o.side === "buy").reduce((a, o) => a + pennyUp(Math.max(0, Number(o.base_size) - (Number(o.filled_base) || 0)) * Number(o.price)), 0);
      if ((bal.GBP ?? 0) - otherBuys + 1e-9 < pennyUp(Number(base) * price)) {
        report.errors.push(`${r.label}: buying back ${base} at ${price.toFixed(4)} needs more GBP than the account has free; not placed`);
        return null;
      }
    }
    return base;
  };
  /** The exit's price: the rule's (`exitTicks`), moved by the instance's `exitOffset` from its instant (the live account's from QUOTE_LIVE_EXIT_OFFSET_FROM). */
  const exitAt = (fair: number, side: Side): number => {
    const off = inst.exitOffset && d.now >= inst.exitOffset.from ? inst.exitOffset.ticks : 0;
    return exitTicks(fair, side) + (side === "bid" ? off : -off);
  };
  /** A resting exit's size, trimmed to the penny the venue rounds to (`pennyExit`); a stop is never trimmed. */
  const trimExit = (r: RungNow, ticks: number, base: string | null): string | null => {
    const pair = pairs[LIVE_SYMBOL[r.book]];
    return base && pair ? pennyExit(venueSideOf(r.side, "exit"), base, ticks * QUOTE_TICK, pair, r.dust) : base;
  };
  /**
   * Place a rung's exit at the rule's `ruleTicks`, or, while the instance's exits meet the book (`exitInsideOn`), where
   * `exitTicksOnBook` puts it on the book this turn met, sized and trimmed at that price; the rule's price is kept in the
   * request (`ruleTicks`) when it moved. One the book still shows crossing is a skip, not a refused row.
   */
  const meetBook = exitInsideOn(inst, d.now);
  const placeExit = async (r: RungNow, ruleTicks: number, fair: number, lastPrint: Print | null): Promise<void> => {
    const side = venueSideOf(r.side, "exit");
    const ticks = meetBook ? exitTicksOnBook(side, ruleTicks, await ctx.bookSeen(r.book)) : ruleTicks;
    const base = trimExit(r, ticks, exitBase(r, ticks * QUOTE_TICK, null));
    if (base) {
      sent(await placeOrder(ctx, { mode: "live", book: r.book, rungSide: r.side, k: r.k, leg: "exit", side, ticks, base, marketable: false, fair, lastPrint: seenPrint(lastPrint),
        ...(ticks !== ruleTicks ? { extra: { ruleTicks } } : {}), ...(meetBook ? { skipIfCrossing: true } : {}) }));
    }
  };
  for (const r of rungs) {
    const o = openOf("live", r);
    try {
      if (globalPause) { if (o && o.state !== "pending") await cancelConfirmed(o, "global pause"); continue; }
      if (o && (o.state === "pending" || unreadable.has(o.id))) continue;                          // in flight, or unread this turn
      if (o && o.cancel_requested_at) continue;                                                     // frozen: asked again above
      if (!r.holding) {
        if (o && o.leg !== "entry") await cancelConfirmed(o, "nothing left to exit");
        continue;
      }
      if (o && o.leg === "entry") { await cancelConfirmed(o, "the rung filled: the rest of its entry is withdrawn"); continue; }   // the exit goes out next turn, on the settled size
      if (o && o.leg === "stop") continue;                                                           // an IOC in flight: read back next turn
      const fair = inputs[r.book]?.f ?? null;
      const lastStop = lastLeg(r, "stop");
      if (stopDue(r.live.openedAt, d.now) && !(lastStop && d.now - Date.parse(lastStop.ts) < QUOTE_LIVE_STOP_RETRY_MS)) {
        if (o) { const c = await cancelConfirmed(o, "the 24-hour stop"); if (c !== "cancelled") continue; }
        const f0 = fair ?? (o?.fair != null ? Number(o.fair) : null) ?? r.live.avgEntry;
        const ticks = stopLimitTicks(f0, r.side);
        const base = exitBase(r, ticks * QUOTE_TICK, null);
        if (base) sent(await placeOrder(ctx, { mode: "live", book: r.book, rungSide: r.side, k: r.k, leg: "stop", side: venueSideOf(r.side, "stop"), ticks, base, marketable: true, fair: f0 }));
        continue;
      }
      if (levelOf("live", r.book, r.side) === "stops-only") continue;
      const lastPrint = paper?.books?.[r.book]?.lastPrint ?? null;
      if (!o) {
        if (fair == null) continue;                                                                   // the rule places an exit only at a fair
        const ticks = exitAt(fair, r.side);
        // An exit the venue refused waits as the rule's refused order waits: for a newer print, and one not through it. One
        // this executor refused for crossing the book, never sent, holds nothing back once exits meet the book (`meetBook`).
        const prev = lastLeg(r, "exit");
        if (prev && prev.state === "rejected" && !(meetBook && !wasSent(prev))) {
          const request = (await d.db.select<{ request: { paperLastPrint?: SeenPrint | null } | null }>(inst.orders, `id=eq.${prev.id}&select=request`))[0]?.request ?? null;
          if (!exitMayGo({ ...prev, request }, r.live.openedAt, r.side === "bid" ? "ask" : "bid", ticks, lastPrint)) continue;
        }
        await placeExit(r, ticks, fair, lastPrint);
        continue;
      }
      // A resting exit follows fair by the rule's own step, on inputs that still stand; stale, it keeps its price.
      if (fair == null || staleBook(r.book) || o.fair == null || Math.abs(fair / Number(o.fair) - 1) <= inst.exitReprice) continue;
      const c = await cancelConfirmed(o, "the rule re-prices the exit");
      if (c !== "cancelled") continue;
      await placeExit(r, exitAt(fair, r.side), fair, lastPrint);
    } catch (e) {
      report.errors.push(`${r.label}: ${msg(e)}`);
    }
  }

  // ── 6. entries: the paper rung's order, in the book entries go to; withdrawn everywhere else ─────────────────────────
  takeStock();
  const gbpPerRung = rungGbp(capital, inst.rungs);
  /** A rung's pounds: `gbpPerRung`, unless the instance's `weights` are in force (PR5-OPT's; the live account's from QUOTE_LIVE_USDT_ONLY_FROM). */
  const gbpOf = (r: { book: QuoteBook; side: Side; k: number }) => (weightsOn(inst, d.now) ? rungGbpOf(inst, capital, r.book, r.side, r.k, d.now) : gbpPerRung);
  const skipEvent = async (mode: LiveMode, r: RungNow, t: PaperTarget, reason: string, detail: Record<string, unknown>) => {
    report.skippedEntries.push({ mode, rung: r.label, reason });
    try {
      await d.db.upsert(inst.events, [{ mode, minute: iso(t.live - M), book: r.book, rung_side: r.side, k: r.k, kind: "skip",
        detail: { reason, paperOid: t.oid, paperLive: iso(t.live), ticks: t.ticks, ...detail } }], "mode,minute,book,rung_side,k,kind");
    } catch (e) { report.errors.push(`${r.label}: skip not recorded (${msg(e)})`); }
  };
  /** The books an ask of the live book was skipped on this turn for want of coin: step 6b tops their coin up. */
  const shortOf = new Set<QuoteBook>();
  /** What the live bids skipped for want of pounds needed this turn: the drain sells coin for what the free pounds leave of it. */
  let gbpLack = 0;
  // TAKE (docs/agents/reviews/2026-10-03-take-prereg.md), an instance's option from `take.from`. On a rung that may enter
  // in the live book (its turn's entry conditions, the rung holding nothing and quoting no exit, the paper rung in no
  // position of its own), the recorder's read of the book at most 90 s old (step 2) is checked against the rung's take
  // limit, k + the 0.09 % fee from this turn's fair (step 3), and from TAKE_DEPTH_FROM resting more coin through it than the
  // rung's holding line (`takeDeep`). Through it, the rung's turn is the take's (step 4): its
  // entry is cancelled and read back (a frozen cancel waits), and one taker IOC goes out at the limit for the rung's
  // pounds, after the entry's own funds check, recorded as an entry with no paper order and `request.take`. The venue
  // fills it, or not; a fill is any entry's (step 5's exit, re-price and 24-hour stop).
  const takeOn = (!!inst.take && d.now >= inst.take.from) || takeMode === "live";
  /**
   * No take inside an FX closure (2026-10-31, before Davies decides on LIVE's take): the paper minute in a closure is
   * decided on a held X (the live account's weekend replica, `weekend_mode` 'live', or an instance's own `weekend` rule),
   * and every take the rule was priced and tested on is a weekday's (variant-2's 14, LIVE's shadow's 2 opportunities;
   * variant-2 has no weekend). Neither the take nor its shadow runs then; the rung's weekend entry goes on. Variant-2's own
   * turns never see one: without a weekend rule a closure minute has no fair.
   */
  const takeClosed = T != null && inQuoteClosure(T);
  const readsOf = new Map<QuoteBook, Promise<RecordedRead | null>>();
  const recordedOf = (b: QuoteBook) => {
    if (!readsOf.has(b)) {
      readsOf.set(b, (d.recordedBook ?? ((bk: QuoteBook, at: number) => recordedBookAt(d.db, bk, at)))(b, d.now)
        .catch((e) => { report.errors.push(`${b}: the recorded book is unreadable (${msg(e)}): no take this turn`); return null; }));
    }
    return readsOf.get(b)!;
  };
  /**
   * The live account's take in shadow (0131, `take_mode` 'shadow'): the same test on the same read as `takeTurn`, and when the
   * book is through the limit, a `take_shadow` event with what the IOC would be (limit, size, whether the funds cover it, the
   * read) instead of the IOC. Nothing is sent, nothing is cancelled, no funds are promised: the rung's paper entry goes on.
   */
  const shadowTake = async (r: RungNow, o: LiveOrderRow | null): Promise<void> => {
    const f = takeClosed ? null : inputs[r.book]?.f ?? null;
    const read = f == null ? null : await recordedOf(r.book);
    if (f == null || !read) return;
    const limit = takeLimitTicks(f, r.k, r.side), touch = readTouch(read);
    if (!takeTriggered(r.side, limit, touch) || !takeDeep(d.now, readDepthThrough(read, r.side, limit), holdLineBase(inst, d.now, 0, f))) return;
    const pair = pairs[LIVE_SYMBOL[r.book]];
    const price = limit * QUOTE_TICK, side = venueSideOf(r.side, "entry");
    const base = pair ? rungBase(gbpOf(r), price, pair, side) : null;
    const need = base == null ? null : side === "buy" ? pennyUp(Number(base) * price) : Number(base);
    // The live take cancels the rung's entry first, and that cancel gives back what the entry held: so does the shadow's count.
    const asset = side === "buy" ? "GBP" : coinOf(r.book), back = o ? promised.get(o.id) : undefined;
    const have = (free[asset] ?? 0) + (back && back.asset === asset ? back.amount : 0);
    const px = (t: number | null) => (t == null ? null : Number((t * QUOTE_TICK).toFixed(4)));
    await d.db.upsert(inst.events, [{ mode: "live", minute: iso(nowMinute), book: r.book, rung_side: r.side, k: r.k, kind: "take_shadow", detail: {
      at: nowIso, paperMinute: T != null ? iso(T) : null, fair: f, limit: px(limit), side, base, gbp: gbpOf(r), fundsOk: need != null && have + 1e-9 >= need,
      replaces: o?.id ?? null, read: { ts: read.ts, seenUntil: read.seen_until, bestBid: px(touch.bid), bestAsk: px(touch.ask) },
    } }], "mode,minute,book,rung_side,k,kind");
    (report.shadow ??= { takes: 0, weekend: 0 }).takes++;
  };
  /** Whether the rung's turn is the take's: false when the book is not through its limit, and then its paper entry goes on. */
  const takeTurn = async (r: RungNow, o: LiveOrderRow | null): Promise<boolean> => {
    const f = takeClosed ? null : inputs[r.book]?.f ?? null;
    const read = f == null ? null : await recordedOf(r.book);
    if (f == null || !read) return false;
    const limit = takeLimitTicks(f, r.k, r.side), touch = readTouch(read);
    if (!takeTriggered(r.side, limit, touch)) return false;
    // TAKE-DEPTH: a read with no more coin through the limit than the holding line is no take (its paper entry goes on).
    if (!takeDeep(d.now, readDepthThrough(read, r.side, limit), holdLineBase(inst, d.now, 0, f))) return false;
    if (o && (await cancelConfirmed(o, "a take replaces the rung's entry")) !== "cancelled") return true;
    const pair = pairs[LIVE_SYMBOL[r.book]];
    const price = limit * QUOTE_TICK, side = venueSideOf(r.side, "entry");
    const base = rungBase(gbpOf(r), price, pair, side);
    const skip = (reason: string) => { report.skippedEntries.push({ mode: "live", rung: r.label, reason: `take: ${reason}` }); return true; };
    if (!base) return skip("the rung's size is under the venue's minimum");
    if (side === "buy") {
      const need = pennyUp(Number(base) * price);
      if (!((free.GBP ?? 0) + 1e-9 >= need)) return skip(`not enough free GBP: £${need.toFixed(2)} needed, £${Math.max(0, free.GBP ?? 0).toFixed(2)} free`);
      free.GBP -= need;
    } else {
      const coin = coinOf(r.book);
      if (!((free[coin] ?? 0) + 1e-9 >= Number(base))) { shortOf.add(r.book); return skip(`no ${coin} to sell beyond what its own longs will sell`); }
      free[coin] -= Number(base);
    }
    const px = (t: number | null) => (t == null ? null : Number((t * QUOTE_TICK).toFixed(4)));
    await placeOrder(ctx, {
      mode: "live", book: r.book, rungSide: r.side, k: r.k, leg: "entry", side, ticks: limit, base, marketable: true, fair: f, paper: null,
      extra: { take: true, takeRead: { ts: read.ts, seenUntil: read.seen_until, bestBid: px(touch.bid), bestAsk: px(touch.ask) } },
    });
    return true;
  };
  for (const r of rungs) {
    for (const mode of ["dry_run", "live"] as LiveMode[]) {
      const o = openOf(mode, r);
      try {
        if (mode === "live" && r.holding) continue;                                                  // step 5's
        if (o && o.leg !== "entry") continue;
        if (o && (o.state === "pending" || o.cancel_requested_at || unreadable.has(o.id))) continue;  // in flight or frozen: never a second order
        const retired = retiredAt(inst, d.now).includes(r.k) || weightRetired(inst, d.now, r.book, r.side, r.k);
        const allowed = !retired && entry.book === mode && !report.guards[r.book].length && levelOf(mode, r.book, r.side) === "all" && !(mode === "live" && lossStopped) && !!bal;
        if (takeOn && mode === "live" && allowed && r.paperMode !== "position" && (await takeTurn(r, o))) continue;
        if (takeMode === "shadow" && mode === "live" && allowed && r.paperMode !== "position") {
          try { await shadowTake(r, o); } catch (e) { report.errors.push(`${r.label} take shadow: ${msg(e)}`); }
        }
        const target = allowed ? r.paper : null;
        if (!target) {
          if (o) {
            const why = retired ? "the rung is retired: it quotes no entry (a holding still exits)"
              : entry.book !== mode ? `entries go ${entry.book ?? "nowhere"}: ${entry.why}`
              : report.guards[r.book].length ? `guard: ${report.guards[r.book].join("; ")}`
              : levelOf(mode, r.book, r.side) !== "all" ? `governor: ${keyCount(ctx, mode, r.book, r.side)} POSTs today${multiKey ? ` on ${inst.govKey(r.book, r.side)}` : ""}`
              : mode === "live" && lossStopped ? "the day's loss stop" : !bal ? "balances unreadable"
              : r.paperRefused ? "the paper engine refused its order: the rung quotes nothing until the rule places it again" : "the paper rung quotes nothing";
            await cancelConfirmed(o, why);
          }
          continue;
        }
        if (o) {
          if (ticksOf(o.price) === target.ticks) continue;                                            // resting at the rule's price
          const c = await cancelConfirmed(o, "the paper engine re-priced this rung");
          if (c !== "cancelled") continue;                                                            // filled (step 5 next turn) or frozen
        }
        // One POST per paper decision: a decision the venue refused, or whose outcome is unknown, is not sent again.
        const last = [...recent].reverse().find((x) => x.mode === mode && x.leg === "entry" && x.book === r.book && x.rung_side === r.side && Number(x.k) === r.k);
        if (last && sameDecision(last, target) && ((last.state === "rejected" && !wasRateLimited(last)) || last.state === "pending")) continue;
        const pair = pairs[LIVE_SYMBOL[r.book]];
        const price = target.ticks * QUOTE_TICK;
        const side = venueSideOf(r.side, "entry");
        const base = rungBase(gbpOf(r), price, pair, side);
        if (!base) { await skipEvent(mode, r, target, "the rung's size is under the venue's minimum", { gbp: gbpOf(r), price }); continue; }
        if (side === "buy") {
          const need = pennyUp(Number(base) * price);
          if (!((free.GBP ?? 0) + 1e-9 >= need)) {
            if (mode === "live") gbpLack += need;
            await skipEvent(mode, r, target, "not enough free GBP", { needGbp: need, freeGbp: free.GBP ?? 0 });
            continue;
          }
          free.GBP -= need;
        } else {
          const coin = coinOf(r.book);
          if (!((free[coin] ?? 0) + 1e-9 >= Number(base))) {
            if (mode === "live") shortOf.add(r.book);
            await skipEvent(mode, r, target, `no ${coin} to sell: the account holds none beyond what its own longs will sell`, { need: Number(base), free: free[coin] ?? 0, coin });
            continue;
          }
          free[coin] -= Number(base);
        }
        await placeOrder(ctx, { mode, book: r.book, rungSide: r.side, k: r.k, leg: "entry", side, ticks: target.ticks, base, marketable: false, fair: target.fairAt, paper: target });
      } catch (e) {
        report.errors.push(`${r.label} ${mode}: ${msg(e)}`);
      }
    }
  }

  // ── 6a. the live account's weekend quoting in shadow (0131, `weekend_mode` 'shadow'): inside an FX closure, the entries its
  // weekend replica (`quotes_live_weekend.ts`) would have it rest, each book's six rungs at the replica's prices, sized as
  // step 6 sizes them, with the guards that would stand on fair at the held X — written as a `weekend_shadow` event when
  // they differ from the book's last one. Nothing is sent: PR5's engine is dark, so step 6 has quoted nothing.
  if (weekendMode === "shadow" && inst.liveSwitches && T != null && inQuoteClosure(T)) {
    try {
      const wk = (await d.db.select<{ state: QuoteState | Record<string, never>; last_minute: string | null }>(inst.liveSwitches.wkPaper, "id=eq.1&select=state,last_minute"))[0];
      const wkState = wk?.state && "books" in wk.state ? wk.state as QuoteState : null;
      const wkT = wk?.last_minute ? Date.parse(wk.last_minute) : null;
      for (const b of QUOTE_BOOKS) {
        const lastX = wkState?.books?.[b]?.lastX ?? null, i = inputs[b];
        const wi = i ? weekendInputs(i, T, lastX, LIVE_WEEKEND_RULE) : null;
        const lp = wkState?.books?.[b]?.lastPrint?.ticks != null ? wkState.books[b].lastPrint!.ticks * QUOTE_TICK : null;
        const pair = pairs[LIVE_SYMBOL[b]];
        const targets = wkT === T && wkState ? rungs.filter((r) => r.book === b).map((r) => {
          const tgt = paperEntryTarget(wkState.books[b].rungs.find((x) => x.side === r.side && x.k === r.k));
          const side = venueSideOf(r.side, "entry"), price = tgt ? Number((tgt.ticks * QUOTE_TICK).toFixed(4)) : null;
          return { side: r.side, k: r.k, price, base: price != null && pair ? rungBase(gbpOf(r), price, pair, side) : null, holding: r.holding };
        }) : null;
        const guards = wi ? entryGuards(T, wi, lp) : ["no inputs"];
        if (wkT !== T) guards.push(`the weekend replica's last minute is ${wkT != null ? iso(wkT) : "none"}, not ${iso(T)}: stale`);
        const prev = (await d.db.select<{ detail: { targets?: unknown; guards?: unknown } }>(inst.events,
          `mode=eq.live&kind=eq.weekend_shadow&book=eq.${b}&select=detail&order=minute.desc&limit=1`))[0]?.detail ?? null;
        if (prev && canonJson(prev.targets ?? null) === canonJson(targets) && canonJson(prev.guards ?? null) === canonJson(guards)) continue;
        await d.db.upsert(inst.events, [{ mode: "live", minute: iso(nowMinute), book: b, rung_side: "-", k: 0, kind: "weekend_shadow", detail: {
          at: nowIso, paperMinute: iso(T), replicaMinute: wkT != null ? iso(wkT) : null, x: lastX, fair: wi?.f ?? null, lastPrint: lp, targets, guards,
        } }], "mode,minute,book,rung_side,k,kind");
        (report.shadow ??= { takes: 0, weekend: 0 }).weekend++;
      }
    } catch (e) { report.errors.push(`weekend shadow: ${msg(e)}`); }
  }

  // ── 6b′. an operator's conversion follows the bid (`QuoteLiveInstance.convertRepeg`, the live account's alone, from
  // 2026-10-28; Davies' standing word of 10-02: "以后这种问题自动处理"), before the top-ups, so a book whose conversion goes
  // again gets none beside it. One that has rested QUOTE_LIVE_CONVERT_REPEG_MS under a best bid that moved above it
  // (`convertRepegDue`) is cancelled, read back, and what it has not filled is sent again at the top of the bids, under
  // `runQuotesConvert`'s own checks: a fair no older than three minutes, the best ask within fair + 50 bps, a maker's price
  // that never crosses, the governor open, the GBP free beyond every open buy, and never more coin than the asks still lack
  // (`repegBase`). The replacement carries the first send's instant (`request.firstTs`), so step 1 still cancels it 24 hours
  // from the operator's send, and nothing is re-pegged after that. A check that fails leaves the conversion resting as it
  // is, and says why; once the asks hold their coin it is cancelled, since it would only buy what nothing needs. A re-peg
  // whose cancel the venue had not carried out (frozen) is sent once step 1 reads the cancel back. Entries, exits, stops
  // and top-ups are untouched.
  if (inst.convertRepeg && d.now >= inst.convertRepeg.from && entry.book === "live" && !globalPause && acct) {
    const resting = (book: QuoteBook) => [...open, ...sentNow].some((x) => isOpen(x) && x.mode === "live" && x.leg === "convert" && x.book === book);
    // A re-peg's cancel left frozen on an earlier turn and read back cancelled by step 1 on this one: its remainder is sent now.
    const confirmedNow = (x: LiveOrderRow) => !isOpen(x) && x.cancelled_at === nowIso && String(x.cancel_reason ?? "").startsWith(CONVERT_REPEG_REASON);
    for (const o of openAll.filter((x) => x.mode === "live" && x.leg === "convert" && !isAutoConvert(x) && !unreadable.has(x.id) && (isOpen(x) || confirmedNow(x)))) {
      const label = `${o.book}|convert`, already = !isOpen(o);
      const leave = (reason: string) => {
        report.skippedEntries.push({ mode: "live", rung: label, reason: already ? `conversion ${o.id}'s re-peg is not sent: ${reason}` : `conversion ${o.id} is under the bid and rests where it is: ${reason}` });
      };
      try {
        const seen = await ctx.bookSeen(o.book);
        if (already ? d.now - convertFirstAt(o) >= QUOTE_LIVE_CONVERT_REST_MS || resting(o.book) : !convertRepegDue(o, seen?.bestBid ?? null, d.now)) continue;
        const fair = inputs[o.book]?.f ?? null, pair = pairs[LIVE_SYMBOL[o.book]];
        if (T == null || fair == null) { leave("no fair value for the book: nothing to bound the price by"); continue; }
        if (d.now - T > 3 * M) { leave(`the paper engine's last minute is ${iso(T)}: its fair is stale`); continue; }
        if (!pair) { leave("no pair config"); continue; }
        if (!bal) { leave("balances unreadable"); continue; }
        // What the asks still lack, as `runQuotesConvert` reckons it: their coin at the rule's prices, less the coin held beyond the longs.
        const asksNeed = asksNeedOf(fair, capital, pair, inst.rungs, retiredAt(inst, d.now), weightsOn(inst, d.now) ? (k) => rungGbpOf(inst, capital, o.book, "ask", k, d.now) : undefined);
        const held = (side: Side) => rungs.filter((r) => r.book === o.book && r.side === side).reduce((a, r) => a + Math.max(0, r.live.held), 0);
        const short = asksNeed - ((bal[coinOf(o.book)] ?? 0) - held("bid") + held("ask"));
        if (!(short > 1e-9)) {
          if (!already) await cancelConfirmed(o, `the asks hold their ${rungsWord(inst.rungs)} asks' worth (${asksNeed}): nothing left to convert`);
          continue;
        }
        const limitTicks = Math.floor(fair * (1 + QUOTE_LIVE_STOP_BOUND) / QUOTE_TICK + 1e-9);
        if (seen?.bestBid == null || seen.bestAsk == null) { leave("the order book is unreadable"); continue; }
        if (seen.bestAsk > limitTicks * QUOTE_TICK + 1e-12) { leave(`the best ask ${seen.bestAsk} is more than 50 bps over fair ${fair.toFixed(5)}`); continue; }
        const ticks = makerBuyTicks(seen.bestBid, seen.bestAsk, fair), price = ticks * QUOTE_TICK;
        if (!already && !(ticks > ticksOf(o.price))) { leave(`the top of the bids it may rest at, ${price.toFixed(4)}, is not above its price`); continue; }
        if (levelOf("live", o.book, null) !== "all") { leave(`the governor has closed entries: ${keyCount(ctx, "live", o.book, null)} POSTs today`); continue; }
        const filledBefore = Number(o.filled_base) || 0;
        const base0 = repegBase(Number(o.base_size) - filledBefore, short, pair, price);
        if (!base0) { leave("what it has left to buy is under the venue's minimum"); continue; }
        const own = already ? undefined : promised.get(o.id), need0 = pennyUp(Number(base0) * price);
        const free0 = (free.GBP ?? 0) + (own?.asset === "GBP" ? own.amount : 0);
        if (free0 + 1e-9 < need0) { leave(`not enough free GBP: £${need0.toFixed(2)} needed, £${Math.max(0, free0).toFixed(2)} free`); continue; }
        if (!already) {
          const c = await cancelConfirmed(o, `${CONVERT_REPEG_REASON} of ${seen.bestBid} for ${Math.round((d.now - Date.parse(o.ts)) / M)} min: what it has not filled goes again at the top of the bids`);
          // A cancel that lands on a part-filled order books it `filled` with what it filled: the rest is the remainder to send.
          if (c === "frozen" || (c === "filled" && !(Number(o.base_size) - (Number(o.filled_base) || 0) > 1e-9))) continue;
          if (c === "filled") { const p = promised.get(o.id); if (p) { free[p.asset] = (free[p.asset] ?? 0) + p.amount; promised.delete(o.id); } }
        }
        const filled = Number(o.filled_base) || 0;
        const base = repegBase(Number(o.base_size) - filled, short - Math.max(0, filled - filledBefore), pair, price);
        if (!base) { report.skippedEntries.push({ mode: "live", rung: label, reason: `conversion ${o.id} filled as it was cancelled: what is left is under the venue's minimum, or not needed` }); continue; }
        const needGbp = pennyUp(Number(base) * price);
        if ((free.GBP ?? 0) + 1e-9 < needGbp) { report.errors.push(`${label}: conversion ${o.id} was cancelled to follow the bid and not sent again: £${needGbp.toFixed(2)} needed, £${Math.max(0, free.GBP ?? 0).toFixed(2)} free`); continue; }
        const row = await placeOrder(ctx, { mode: "live", book: o.book, rungSide: null, k: null, leg: "convert", side: "buy", ticks, base, marketable: false, fair,
          extra: { firstTs: iso(convertFirstAt(o)), repegOf: o.id, asksNeed, short } });
        sent(row);
        free.GBP = (free.GBP ?? 0) - needGbp;
        if (row?.state === "rejected" && wasSent(row) && !wasRateLimited(row)) {
          report.errors.push(`${label}: the venue refused conversion ${o.id}'s re-peg of ${base} at ${price.toFixed(4)}: ${(row.response as { error?: string } | null)?.error ?? "no reason given"}`);
        }
      } catch (e) { report.errors.push(`${label}: following the bid ${msg(e)}`); }
    }
  }

  // ── 6b″. the coin rebook's sales (`rebookOn`; Davies, 2026-10-29: "换币也用挂单不要有转换损失"). While an instance's new weights
  // rebook its coin, a book holding more coin beyond its longs than its asks need sells the surplus (`planDrains`): one
  // post-only sale at the top of the asks and never under fair, at a time a book, under the top-ups' own conditions (live and
  // armed, no global pause, no loss stop, the book unguarded, the governor open, a fair no older than three minutes). Step 1
  // cancels it after QUOTE_LIVE_TOPUP_REST_MS unfilled and the next turn sends what is still surplus at the book as it then
  // stands. Its pounds go to the top-ups of the book that is short (step 6b, its daily cap lifted to the capital meanwhile).
  const rebooking = rebookOn(inst, d.now), draining = drainOn(inst, d.now);
  const gbpShort = Math.max(0, gbpLack - Math.max(0, free.GBP ?? 0));
  // The drain's resting sale goes the turn it is no longer wanted: an ask of its book lacks coin, or no bid lacks pounds.
  if (draining) {
    for (const o of open.filter((o) => o.mode === "live" && isDrain(o) && !o.cancel_requested_at && !unreadable.has(o.id))) {
      if (shortOf.has(o.book) || !(gbpShort > 0)) {
        try { await cancelConfirmed(o, shortOf.has(o.book) ? "drain: an ask of the book lacks coin" : "drain: no bid lacks pounds"); } catch (e) { report.errors.push(`drain cancel: ${msg(e)}`); }
      }
    }
  }
  if ((rebooking || (draining && gbpShort > 0)) && entry.book === "live" && !globalPause && !lossStopped && bal && T != null && d.now - T <= 3 * M) {
    try {
      const resting = new Set([...open, ...sentNow].filter((o) => isOpen(o) && o.mode === "live" && o.leg === "convert").map((o) => o.book));
      const recentDrains = await d.db.selectAll<Pick<LiveOrderRow, "ts" | "book" | "leg" | "state" | "request" | "response">>(inst.orders,
        `mode=eq.live&leg=eq.convert&ts=gte.${enc(iso(d.now - QUOTE_LIVE_TOPUP_REST_MS))}&select=ts,book,leg,state,request,response&order=id.asc`);
      const cases: DrainBook[] = [];
      // The drain's day: what each book's drains sold or still offer since 00:00 UTC.
      const dayStart = Math.floor(d.now / DAY) * DAY;
      const soldToday = (book: QuoteBook) => recentDay.filter((o) => o.book === book && isDrain(o))
        .reduce((a, o) => a + Number(isOpen(o as LiveOrderRow) ? o.base_size : o.filled_base) * Number(o.price), 0);
      const recentDay = draining ? await d.db.selectAll<Pick<LiveOrderRow, "ts" | "book" | "leg" | "price" | "base_size" | "filled_base" | "state" | "request">>(inst.orders,
        `mode=eq.live&leg=eq.convert&ts=gte.${enc(iso(dayStart))}&select=ts,book,leg,price,base_size,filled_base,state,request&order=id.asc`) : [];
      for (const book of QUOTE_BOOKS) {
        if (resting.has(book) || report.guards[book].length || levelOf("live", book, null) !== "all") continue;
        // The drain sells only for a book none of whose asks lacks coin (the rebook sells regardless, as it always did).
        if (!rebooking && shortOf.has(book)) continue;
        // A sale the venue refused is not sent again for QUOTE_LIVE_TOPUP_REST_MS, as a top-up is not.
        if (recentDrains.some((o) => o.book === book && isDrain(o) && o.state === "rejected" && wasSent(o) && !wasRateLimited(o))) {
          report.skippedEntries.push({ mode: "live", rung: `${book}|convert`, reason: "rebook: the venue refused the last sale; the next waits 30 minutes from it" });
          continue;
        }
        const fair = inputs[book]?.f ?? null, pair = pairs[LIVE_SYMBOL[book]];
        if (fair == null || !pair) continue;
        const seen = await ctx.bookSeen(book);
        const held = (side: Side) => rungs.filter((r) => r.book === book && r.side === side).reduce((a, r) => a + Math.max(0, r.live.held), 0);
        cases.push({ book, fair, pair, bestBid: seen?.bestBid ?? null, bestAsk: seen?.bestAsk ?? null,
          beyond: (bal[coinOf(book)] ?? 0) - held("bid") + held("ask"), free: free[coinOf(book)] ?? 0 });
      }
      let shortLeft = gbpShort;
      for (const p of planDrains(cases, capital, inst.rungs, retiredAt(inst, d.now), (b, k) => rungGbpOf(inst, capital, b, "ask", k, d.now))) {
        const why = rebooking ? "rebook" : "drain";
        if ("skip" in p) { report.skippedEntries.push({ mode: "live", rung: `${p.book}|convert`, reason: `${why}: ${p.skip}` }); continue; }
        let base = p.base;
        if (!rebooking) {
          if (!(shortLeft > 0)) continue;
          const price = p.ticks * QUOTE_TICK, pair = pairs[LIVE_SYMBOL[p.book]]!;
          const cut = drainBase(p.base, price, shortLeft, QUOTE_LIVE_DRAIN_DAY_SHARE * capital - soldToday(p.book), pair);
          if (!cut) { report.skippedEntries.push({ mode: "live", rung: `${p.book}|convert`, reason: "drain: what the bids lack, or the day leaves, is under the venue's minimum" }); continue; }
          base = cut;
          shortLeft -= Number(base) * price;
        }
        const row = await placeOrder(ctx, { mode: "live", book: p.book, rungSide: null, k: null, leg: "convert", side: "sell", ticks: p.ticks, base,
          marketable: false, fair: p.fair, extra: { auto: true, drain: true, asksNeed: p.asksNeed, coinBeyondLongs: p.beyond, ...(rebooking ? {} : { gbpShort, permanent: true }) } });
        sent(row);
        free[coinOf(p.book)] = (free[coinOf(p.book)] ?? 0) - Number(base);
        if (row?.state === "rejected" && wasSent(row) && !wasRateLimited(row)) {
          report.errors.push(`${p.book}|convert: the venue refused a rebook's sale of ${p.base} at ${(p.ticks * QUOTE_TICK).toFixed(4)}: ${(row.response as { error?: string } | null)?.error ?? "no reason given"}`);
        }
      }
    } catch (e) { report.errors.push(`rebook: ${msg(e)}`); }
  }

  // ── 6b. the asks' coin, topped up when an ask ran short (Davies, 2026-10-02: "以后这种问题自动处理，用昨天新加的规则maker换币")
  // An ask skipped for want of coin means the book holds less than its three asks sell: GBP has risen since its coin was
  // bought, so each £10 ask needs more of it. A maker conversion at the top of the bids buys it back (`planTopUps`), one
  // at a time a book, under the entries' own conditions; step 1 cancels it after QUOTE_LIVE_TOPUP_REST_MS unfilled.
  if (shortOf.size && entry.book === "live" && !globalPause && !lossStopped && bal && [...shortOf].some((b) => levelOf("live", b, null) === "all")) {
    try {
      const resting = new Set([...open, ...sentNow].filter((o) => isOpen(o) && o.mode === "live" && o.leg === "convert").map((o) => o.book));
      const books = [...shortOf].filter((b) => !resting.has(b) && !report.guards[b].length && levelOf("live", b, null) === "all");
      const today = books.length ? await d.db.selectAll<Pick<LiveOrderRow, "ts" | "book" | "leg" | "price" | "base_size" | "filled_base" | "state" | "request" | "response">>(inst.orders,
        `mode=eq.live&leg=eq.convert&ts=gte.${enc(iso(Math.floor(d.now / DAY) * DAY))}&select=ts,book,leg,price,base_size,filled_base,state,request,response&order=id.asc`) : [];
      const cases: TopUpBook[] = [];
      for (const book of books) {
        // A top-up the venue refused is not sent again for QUOTE_LIVE_TOPUP_REST_MS: refused every minute, it would spend
        // the day's POSTs (2026-10-02 17:57–18:04 UTC: eight refusals of USDT's in a row, before the penny holds).
        const refused = today.filter((o) => o.book === book && isAutoConvert(o) && !isDrain(o) && o.state === "rejected" && wasSent(o) && !wasRateLimited(o)).at(-1);
        if (refused && d.now - Date.parse(refused.ts) < QUOTE_LIVE_TOPUP_REST_MS) {
          report.skippedEntries.push({ mode: "live", rung: `${book}|convert`, reason: `top-up: the venue refused the last one at ${refused.ts}; the next waits 30 minutes from it` });
          continue;
        }
        const fair = inputs[book]?.f ?? null, pair = pairs[LIVE_SYMBOL[book]];
        if (fair == null || !pair) continue;
        const seen = await ctx.bookSeen(book);
        const held = (side: Side) => rungs.filter((r) => r.book === book && r.side === side).reduce((a, r) => a + Math.max(0, r.live.held), 0);
        cases.push({
          book, fair, pair, bestBid: seen?.bestBid ?? null, bestAsk: seen?.bestAsk ?? null,
          beyond: (bal[coinOf(book)] ?? 0) - held("bid") + held("ask"),
          // What today's top-ups of the book bought or still hold the pounds for: a cancel that filled nothing spent none.
          spentTodayGbp: today.filter((o) => o.book === book && isAutoConvert(o) && !isDrain(o))
            .reduce((a, o) => a + Number(isOpen(o as LiveOrderRow) ? o.base_size : o.filled_base) * Number(o.price), 0),
        });
      }
      const topUpGbpOf = weightsOn(inst, d.now) ? (b: QuoteBook, k: number) => rungGbpOf(inst, capital, b, "ask", k, d.now) : undefined;
      // While a rebook runs (`rebookOn`), a book short of its asks' coin is bought up to it in one go: the day's cap is the capital.
      // An instance's own day (`topUps`, "Stablecoin quotes USDC/GBP") buys part of a shortfall too.
      const maxDay = rebookOn(inst, d.now) ? capital : inst.topUps?.maxGbpDay ?? QUOTE_LIVE_TOPUP_MAX_GBP_DAY;
      for (const p of planTopUps(cases, capital, free.GBP ?? 0, inst.rungs, retiredAt(inst, d.now), topUpGbpOf, maxDay, rebookOn(inst, d.now) || !!inst.topUps)) {
        if ("skip" in p) { report.skippedEntries.push({ mode: "live", rung: `${p.book}|convert`, reason: `top-up: ${p.skip}` }); continue; }
        const row = await placeOrder(ctx, { mode: "live", book: p.book, rungSide: null, k: null, leg: "convert", side: "buy", ticks: p.ticks, base: p.base,
          marketable: false, fair: p.fair, extra: { auto: true, asksNeed: p.asksNeed, coinBeyondLongs: p.beyond } });
        sent(row);
        free.GBP = (free.GBP ?? 0) - p.gbp;
        // The page's order tables leave conversions out, so a top-up the venue refuses goes to the error box.
        if (row?.state === "rejected" && wasSent(row) && !wasRateLimited(row)) {
          report.errors.push(`${p.book}|convert: the venue refused a top-up of ${p.base} at ${(p.ticks * QUOTE_TICK).toFixed(4)}: ${(row.response as { error?: string } | null)?.error ?? "no reason given"}`);
        }
      }
    } catch (e) { report.errors.push(`top-up: ${msg(e)}`); }
  }

  // ── 7. the record: an unfilled stop's alert, the guards when they change, and this turn's summary ──────────────────
  for (const s of stopsUnfilled) {
    report.errors.push(`${rungLabel(s.book, s.rung_side!, s.k!)}: the 24-hour stop came back ${Number(s.filled_base) > 0 ? `with ${s.filled_base} of ${s.base_size} filled` : "unfilled"} at its limit ${s.price}; the book quotes no entries while the position is past its stop, and the stop is tried again in an hour`);
    try {
      await d.db.upsert(inst.events, [{ mode: "live", minute: iso(nowMinute), book: s.book, rung_side: s.rung_side, k: Number(s.k), kind: "stop_unfilled",
        detail: { orderId: s.id, limit: Number(s.price), base: Number(s.base_size), filled: Number(s.filled_base) } }], "mode,minute,book,rung_side,k,kind");
    } catch (e) { report.errors.push(`stop alert not recorded (${msg(e)})`); }
  }
  try {
    const prev = (await d.db.select<{ state: { guards?: Record<string, string[]>; faults?: Record<string, LiveFault> } }>(inst.state, "id=eq.1&select=state"))[0]?.state ?? {};
    // The errors box hears of a stopped dead-man switch once, on the turn its guard first appears; the guard's own
    // events below record when it came and went.
    const hadDeadman = Object.values(prev.guards ?? {}).some((rs) => Array.isArray(rs) && rs.some((r) => String(r).startsWith(DEADMAN_WATCH_REASON)));
    if (deadmanReason && !hadDeadman) report.errors.push(`DEAD-MAN SWITCH NOT RUNNING: ${deadmanReason}; exits and the 24-hour stops stay armed. Check the monitor Worker (workers/monitor).`);
    // What the errors box hears: each fault once, hourly while it lasts, and when it is over (`liveAlerts`).
    const { alerts, faults } = liveAlerts(report.errors, prev.faults, d.now);
    for (const b of QUOTE_BOOKS) {
      if (JSON.stringify(prev.guards?.[b] ?? []) === JSON.stringify(report.guards[b])) continue;
      await d.db.upsert(inst.events, [{ mode: entry.book ?? (cfg.dry_run ? "dry_run" : "live"), minute: iso(nowMinute), book: b, rung_side: "-", k: 0, kind: "guard",
        detail: { reasons: report.guards[b], before: prev.guards?.[b] ?? [] } }], "mode,minute,book,rung_side,k,kind");
    }
    await d.db.upsert(inst.state, [{
      id: 1, updated_at: nowIso, last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null,
      state: {
        at: nowIso, minute: report.minute, entryBook: entry.book, why: entry.why, dryRun: cfg.dry_run, armed: !!cfg.live_confirmed_at, account: !!acct,
        guards: report.guards, posts: report.posts, governor: { dry_run: governorLevel(report.posts.dry_run), live: governorLevel(report.posts.live) },
        // An instance with several keys (rule D's four, a book and a side each) also keeps each key's count and level.
        ...(multiKey ? { keyPosts: ctx.keyPosts, keyGovernor: Object.fromEntries(Object.entries(ctx.keyPosts.live).map(([k, n]) => [k, governorLevel(n)])) } : {}),
        dayPnlGbp: report.dayPnlGbp, lossStopped, balances: bal, capitalGbp: capital,
        // The venue's own available and on-hold amounts, for the LIVE page (`venueBalancesOf`), when this turn read them.
        ...(bal && acct?.balanceDetail ? { venueBalances: venueBalancesOf(nowIso, acct.balanceDetail()) } : {}),
        held: rungs.filter((r) => r.live.held > 0).map((r) => ({ rung: r.label, held: r.live.held, avgEntry: r.live.avgEntry, openedAt: r.live.openedAt != null ? iso(r.live.openedAt) : null })),
        // Each book's dust this turn (`dustBase` at its price): at or under it a rung is flat here, so the page closes a
        // round trip, and calls a rung empty, where this executor does (Davies, 2026-10-01: an exit trimmed to the penny
        // left 0.00102 USDT on its rung, and the page held its trip open).
        dust: Object.fromEntries(QUOTE_BOOKS.map((b) => [b, rungs.find((r) => r.book === b)?.dust ?? 0])),
        ...(Object.keys(faults).length ? { faults } : {}),
      },
    }], "id");
    // Set only where the box hears something other than the turn's errors (the index reports the errors when it is unset).
    if (JSON.stringify(alerts) !== JSON.stringify(report.errors)) report.alerts = alerts;
  } catch (e) { report.errors.push(`state not recorded (${msg(e)})`); report.alerts = undefined; }
}

// ------------------------------------------------------------------ the one-off conversion

/**
 * `POST ?action=quotes-convert` `{ book, gbp, send, taker }`: buy one book's coin with GBP, so the ask rungs have
 * something to sell. The account starts with GBP only, and the design's inventory is three asks' worth of each coin. It
 * is an operator's call and never the minute loop's. Without `send: true` it returns the order it WOULD send and writes
 * nothing. With it, the order goes out only when the executor is live and armed (`dry_run` off, `live_confirmed_at` set,
 * no global pause), and only within bounds:
 *   * at most a quarter of the capital (three rungs' worth);
 *   * none when the account already holds that much of the coin beyond its own longs, or a conversion of the book rests;
 *   * refused when the ask is more than 50 bps over fair (the 24-hour stop's bound), or the governor has closed entries.
 * By default it RESTS at the top of the bids, post-only, a maker's 0 % (Davies, 2026-10-02: the go-live's two IOC
 * conversions paid the 0.09 % taker fee, £0.027 each, which the first ask trips then carried): one tick over the best
 * bid when the spread leaves room, else at it. The minute loop books its fills as every live order's, and cancels it on a
 * global pause, whenever the executor is not live and armed, and after QUOTE_LIVE_CONVERT_REST_MS unfilled. On an instance
 * with `convertRepeg` (the live account's) it also follows the bid: under a best bid that has moved above it for
 * QUOTE_LIVE_CONVERT_REPEG_MS, what it has not filled goes again at the top of the bids under these same checks, at most
 * what the asks still lack, and the 24 hours count from this send (step 6b′). `taker: true`
 * sends the IOC buy limited to fair + 50 bps instead, for coin wanted at once. The row is written `pending` first, and
 * the coins it bought count in the book the account is checked against (D8/D11/D12).
 */
export async function runQuotesConvert(d: QuoteLiveDeps, body: unknown): Promise<Record<string, unknown>> {
  const b = (body && typeof body === "object" ? body : {}) as { book?: unknown; gbp?: unknown; send?: unknown; taker?: unknown };
  const taker = b.taker === true;
  const book = b.book === "USDC-GBP" || b.book === "USDT-GBP" ? b.book : null;
  if (!book) return { error: "book: USDC-GBP or USDT-GBP" };
  const inst = d.instance ?? QUOTE_LIVE_INSTANCE;
  const cfg = (await d.db.select<LiveConfig>(inst.config, "id=eq.1&select=dry_run,live_confirmed_at,capital_gbp"))[0];
  if (!cfg) return { error: `no ${inst.config} row: migration ${inst.migration} has not run` };
  const capital = Number(cfg.capital_gbp), cap = convertCapGbp(inst, capital, book, d.now);
  // A book whose weights give its asks no pounds (a twin's USDT-only rule) needs no coin: the operator's "already holds" is
  // its answer, which marks the book done. Without weights the cap is a quarter of the capital, never 0.
  if (weightsOn(inst, d.now) && !(cap > 0)) return { error: `the account already holds what ${book}'s asks need (0: its weights give them no pounds): nothing to convert` };
  const gbp = Number(b.gbp);
  if (!(gbp > 0) || gbp > cap + 1e-9) return { error: `gbp: more than 0 and at most ${cap} (${rungsWord(inst.rungs)} rungs' worth of ${capital})` };
  const send = b.send === true;
  const risk = (await d.db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause"))[0];
  if (risk?.global_pause) return { error: "agent_risk.global_pause is set: nothing is sent" };
  if (send && cfg.dry_run) return { error: "dry_run is on: nothing is sent while it is" };
  if (send && !cfg.live_confirmed_at) return { error: "live_confirmed_at is null: nothing is sent until it is set" };
  if (!d.account?.canTrade) return { error: `PR5's Revolut X key is not loaded (${d.accountNote ?? "no key"})` };
  const report: QuoteLiveReport = { at: iso(d.now), entryBook: null, why: "", minute: null, placed: [], cancelled: [], settled: [], skippedEntries: [], guards: {}, posts: { dry_run: 0, live: 0 }, dayPnlGbp: null, errors: [] };
  const h = makeCtxHelpers(d, report, inst);
  const { T, inputs } = await paperView(d, inst);
  const fair = inputs[book]?.f ?? null;
  if (T == null || fair == null) return { error: "no fair value for the book (GBP/USD dark, or no USD-book hours): nothing to bound the price by" };
  if (d.now - T > 3 * M) return { error: `the paper engine's last minute is ${iso(T)}: its fair is stale` };
  const seen = await h.bookSeen(book);
  const limitTicks = Math.floor(fair * (1 + QUOTE_LIVE_STOP_BOUND) / QUOTE_TICK + 1e-9);
  if (seen?.bestAsk == null) return { error: "the order book is unreadable: no ask to buy at" };
  if (seen.bestAsk > limitTicks * QUOTE_TICK + 1e-12) return { error: `the best ask ${seen.bestAsk} is more than 50 bps over fair ${fair.toFixed(5)}: not converting at that price` };
  const pairs = await h.pairs();
  const pair = pairs[LIVE_SYMBOL[book]];
  if (!pair) return { error: "no pair config" };
  // A maker's price: the top of the bids, one tick over the best bid when that still leaves the ask a tick above it.
  if (!taker && seen.bestBid == null) return { error: "the order book is unreadable: no bid to rest at" };
  const bidTicks = seen.bestBid == null ? null : Math.round(seen.bestBid / QUOTE_TICK), askTicks = Math.round(seen.bestAsk / QUOTE_TICK);
  const ticks = taker ? limitTicks : Math.min(askTicks - 1 >= bidTicks! + 1 ? bidTicks! + 1 : bidTicks!, limitTicks);
  const price = ticks * QUOTE_TICK;
  // A taker is sized at the ask it will meet, so £12.50 buys three asks' worth (the limit only bounds how far up the book
  // it may go); a maker at its own price.
  const base = rungBase(gbp, taker ? seen.bestAsk : price, pair);
  if (!base) return { error: "under the venue's minimum" };
  const coin = coinOf(book);
  const bal = await d.account.balances();
  const open = await d.db.selectAll<LiveOrderRow>(inst.orders, "state=in.(pending,new,partially_filled)&select=*&order=id.asc");
  const resting = open.find((o) => o.mode === "live" && o.leg === "convert" && o.book === book);
  if (resting) return { error: `a conversion of ${book} already rests (order ${resting.id}, ${resting.state}): it fills, or the minute loop cancels it after 24 hours` };
  const fills = await d.db.selectAll<LiveOrderRow>(inst.orders, "mode=eq.live&state=in.(filled,partially_filled)&select=*&order=id.asc");
  // The asks' inventory as it stands: the coin held, less what the book's longs will sell back, plus what its shorts will
  // buy back. A resting ask's coins are still the asks' own.
  const heldBy = (side: Side) => Math.max(0, fills.filter((o) => o.book === book && o.rung_side === side).reduce((a, o) => a + (o.leg === "entry" ? 1 : -1) * Number(o.filled_base), 0));
  const beyond = (bal[coin] ?? 0) - heldBy("bid") + heldBy("ask");
  // What the book's three ask rungs sell at the rule's prices (0.1 / 0.2 / 0.3 % over fair): once held, nothing to convert.
  const asksNeed = asksNeedOf(fair, capital, pair, inst.rungs, retiredAt(inst, d.now), weightsOn(inst, d.now) ? (k) => rungGbpOf(inst, capital, book, "ask", k, d.now) : undefined);
  if (beyond + 1e-12 >= asksNeed) return { error: `the account already holds ${beyond} ${coin} beyond its longs, ${rungsWord(inst.rungs)} asks' worth (${asksNeed}) or more: nothing to convert` };
  const openBuys = open.filter((o) => o.side === "buy").reduce((a, o) => a + pennyUp(Math.max(0, Number(o.base_size) - Number(o.filled_base)) * Number(o.price)), 0);
  const needGbp = pennyUp(Number(base) * price * (taker ? 1.0009 : 1));
  if ((bal.GBP ?? 0) - openBuys < needGbp) return { error: `not enough free GBP: ${(bal.GBP ?? 0) - openBuys} free, ${needGbp} needed at the limit${taker ? " with the fee" : ""}` };
  // The governor's count for the conversion's key (`QuoteLiveInstance.govKey`; the live account's one key is every POST).
  const convKey = inst.govKey(book, null), multiKey = isMultiKey(inst);
  const today = (await d.db.selectAll<{ id: number; response: unknown; book?: QuoteBook; rung_side?: Side | null }>(inst.orders,
    `mode=eq.live&ts=gte.${enc(iso(Math.floor(d.now / DAY) * DAY))}&select=id,response${multiKey ? ",book,rung_side" : ""}&order=id.asc`))
    .filter(wasSent).filter((r) => !multiKey || inst.govKey(r.book!, r.rung_side ?? null) === convKey);
  const postsToday = today.reduce((a, r) => a + postsOf(r), 0);
  if (governorLevel(postsToday) !== "all") return { error: `the governor has closed entries: ${postsToday} POSTs today` };
  const order = {
    book, side: "buy", base, limit: price.toFixed(4), timeInForce: taker ? "ioc" : "gtc", postOnly: !taker, fair, bestBid: seen.bestBid, bestAsk: seen.bestAsk,
    coinBeyondLongs: beyond, asksNeed,
  };
  if (!send) return { wouldSend: order, note: "nothing sent: pass send: true, with the executor live and armed, to send it" };
  const held = await d.db.claim<{ name: string }>("agent_locks", `name=eq.${inst.lease}&lease_until=lt.${enc(iso(d.now))}`, { lease_until: iso(d.now + QUOTE_LIVE_LEASE_MS), holder: d.holder });
  if (!held.length) return { error: `the minute loop holds the ${inst.lease} lease: try again in a few seconds` };
  try {
    const ctx: Ctx = { d, report, nowIso: iso(d.now), inst, holdLease: h.holdLease, bookSeen: h.bookSeen, posts: report.posts, keyPosts: { dry_run: {}, live: {} }, pacePost: h.pacePost, pause: h.pause };
    const row = await placeOrder(ctx, { mode: "live", book, rungSide: null, k: null, leg: "convert", side: "buy", ticks, base, marketable: taker, fair });
    return {
      sent: order, row: row ? { id: row.id, state: row.state, client_order_id: row.client_order_id, venue_order_id: row.venue_order_id } : null, errors: report.errors,
      ...(taker ? {} : { note: "it rests at the bid, post-only (a maker's 0 %): the minute loop books its fills, and cancels it after 24 hours unfilled" }),
    };
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${inst.lease}&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}
