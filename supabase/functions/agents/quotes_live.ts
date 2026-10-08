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
//   * It never prices an order the rule did not price.
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
//     all four the executor had read as crossing, 30 ms before, and none of the 465 it had not.
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
//     capital added.

import { ceilToStep, floorToStep, type PairConfig } from "../_shared/agents_strategy.ts";
import { revxPublic } from "../_shared/revx.ts";
import type { OrderView, Venue } from "../_shared/venue.ts";
import type { Db } from "./db.ts";
import {
  blocks, exitTicks, fairUAt, fxAt, QUOTE_BOOKS, QUOTE_FX_LOOKBACK_MS, QUOTE_REPRICE, QUOTE_REVX_GAP_MS, QUOTE_RUNGS, QUOTE_STOP_MS, QUOTE_TICK, QUOTE_USD_BOOK,
  quoteTicks, type Print, type QuoteBook, type QuoteState, type Rung, type Side,
} from "./quotes.ts";
import { bookLiveBuy, fillStamp, isUniqueViolation, withFeeNote, type FromAccount } from "./tick.ts";

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
};
/** The live account: PR5's own sub-account, the paper engine's own state, three rungs, one key. */
export const QUOTE_LIVE_INSTANCE: QuoteLiveInstance = {
  config: "agent_quote_live_config", orders: "agent_quote_live_orders", events: "agent_quote_live_events", state: "agent_quote_live_state",
  migration: "0052", paper: "agent_quote_state", lease: "quotes-live", rungs: QUOTE_RUNGS, exitReprice: QUOTE_REPRICE, govKey: () => "account",
};
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
/** A conversion resting at the bid (maker, 0 %) that has not filled in this long is cancelled; the operator sends another. */
export const QUOTE_LIVE_CONVERT_REST_MS = 24 * H;
/**
 * The asks' coin, topped up by the minute loop itself (Davies, 2026-10-02: "以后这种问题自动处理，用昨天新加的规则maker换币").
 * When an ask is skipped for want of coin, a maker conversion at the top of the bids buys the book back up to its three
 * asks' worth at the rule's prices and this much over, so the next few days of GBP rising leave every ask covered.
 */
export const QUOTE_LIVE_TOPUP_BUFFER = 0.02;
/** An automatic top-up resting unfilled this long is cancelled; a turn that still finds an ask short sends another at the book as it then stands. */
export const QUOTE_LIVE_TOPUP_REST_MS = 30 * M;
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
export type LiveConfig = { dry_run: boolean; live_confirmed_at: string | null; capital_gbp: number | string };
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

/** What a book's three ask rungs sell at the rule's prices (0.1 / 0.2 / 0.3 % over fair): the coin the design holds for them. */
export function asksNeedOf(fair: number, capitalGbp: number, pair: PairConfig, rungs: readonly number[] = QUOTE_RUNGS): number {
  return rungs.reduce((a, k) => a + Number(rungBase(rungGbp(capitalGbp, rungs), Math.ceil(fair * (1 + k) / QUOTE_TICK - 1e-9) * QUOTE_TICK, pair, "sell") ?? 0), 0);
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
 * GBP cannot cover, or that would pass the day's QUOTE_LIVE_TOPUP_MAX_GBP_DAY, is skipped with the reason.
 */
export function planTopUps(books: TopUpBook[], capitalGbp: number, freeGbp: number, rungs: readonly number[] = QUOTE_RUNGS): TopUpPlan[] {
  const out: TopUpPlan[] = [];
  const due: { b: TopUpBook; ticks: number; price: number; asksNeed: number; min: number; minCost: number; full: number; room: number }[] = [];
  for (const b of books) {
    if (b.bestBid == null || b.bestAsk == null) { out.push({ book: b.book, skip: "the order book is unreadable" }); continue; }
    const ticks = makerBuyTicks(b.bestBid, b.bestAsk, b.fair), price = ticks * QUOTE_TICK;
    const asksNeed = asksNeedOf(b.fair, capitalGbp, b.pair, rungs);
    const short = asksNeed - b.beyond;
    if (!(short > 1e-9)) { out.push({ book: b.book, skip: `it holds its ${rungsWord(rungs)} asks' worth` }); continue; }
    const min = Number(ceilToStep(Math.max(short, dustBase(b.pair, price)), b.pair.base_step)), minCost = pennyUp(min * price);
    const full = Math.max(min, Number(floorToStep(asksNeed * (1 + QUOTE_LIVE_TOPUP_BUFFER) - b.beyond, b.pair.base_step)));
    const room = Math.max(0, QUOTE_LIVE_TOPUP_MAX_GBP_DAY - b.spentTodayGbp);
    if (minCost > room + 1e-9) { out.push({ book: b.book, skip: `today's top-ups would pass £${QUOTE_LIVE_TOPUP_MAX_GBP_DAY}: £${b.spentTodayGbp.toFixed(2)} so far, £${minCost.toFixed(2)} short` }); continue; }
    due.push({ b, ticks, price, asksNeed, min, minCost, full, room });
  }
  // Every shortfall first, in the books' order, while the free GBP covers the pounds the venue will hold for it.
  let spare = freeGbp;
  const funded: typeof due = [];
  for (const x of due) {
    if (x.minCost > spare + 1e-9) { out.push({ book: x.b.book, skip: `its shortfall needs £${x.minCost.toFixed(2)} and £${Math.max(0, spare).toFixed(2)} of GBP is free: the account needs more GBP` }); continue; }
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

/** An automatic top-up (`request.auto`), as against an operator's `quotes-convert`. */
export const isAutoConvert = (o: { leg?: string; request?: unknown }) =>
  o.leg === "convert" && (o.request as { auto?: unknown } | null | undefined)?.auto === true;
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
 * Returns `base` itself when there is nothing to trim, or when the trim would leave more than `dust` or trade under it.
 */
export function pennyExit(exitSide: "buy" | "sell", base: string, price: number, pair: PairConfig, dust: number): string {
  const b = Number(base), n = b * price;
  if (!(b > 0) || !(price > 0)) return base;
  const pennies = Math.floor(n * 100 + 1e-9);
  if (Math.abs(n * 100 - Math.round(n * 100)) < 1e-6) return base;          // on a whole penny already: nothing rounds
  const trimmed = exitSide === "sell" ? ceilToStep(pennies / 100 / price, pair.base_step) : floorToStep(pennies / 100 / price, pair.base_step);
  const t = Number(trimmed);
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
}): Promise<LiveOrderRow | null> {
  const { d, report } = ctx;
  const label = o.rungSide ? rungLabel(o.book, o.rungSide, o.k!) : `${o.book}|convert`;
  const price = (o.ticks * QUOTE_TICK).toFixed(4);
  const seen = await ctx.bookSeen(o.book);
  const crosses = o.marketable ? null : crossesBook(o.side, Number(price), seen);
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
    if (!placed.ok && placed.status === 429) { retriedAfter429 = true; await ctx.pause(QUOTE_LIVE_429_WAIT_MS); placed = await send(); }
  } catch (e) {
    report.errors.push(`${label}: placement of ${clientOrderId} has no reply (${msg(e)}); left pending for the next turn to reconcile by client id`);
    done("pending");
    return row;
  }
  if (!placed.ok && !(placed.status >= 400 && placed.status < 500)) {
    await patchRow(ctx, row, { response: { status: placed.status, error: placed.error, response: placed.response, outcome: "unknown" } });
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
  await patchRow(ctx, row, { state: "new", venue_order_id: placed.venueOrderId, response: { ...replied, placedState: placed.state } });
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
async function paperView(d: QuoteLiveDeps, inst: QuoteLiveInstance): Promise<{ paper: QuoteState | null; T: number | null; inputs: Partial<Record<QuoteBook, BookInputs>> }> {
  const row = (await d.db.select<{ state: QuoteState | Record<string, never>; last_minute: string | null }>(inst.paper, "id=eq.1&select=state,last_minute"))[0];
  const paper = row && row.state && "books" in row.state ? row.state as QuoteState : null;
  const T = row?.last_minute ? Date.parse(row.last_minute) : null;
  const inputs: Partial<Record<QuoteBook, BookInputs>> = {};
  if (T == null) return { paper, T, inputs };
  const series = async (kind: string, from: number) => (await d.db.selectAll<{ t: string; value: number | string }>("agent_quote_inputs",
    `kind=eq.${enc(kind)}&t=gte.${enc(iso(from))}&t=lte.${enc(iso(T))}&select=t,value&order=kind.asc,t.asc`)).map((r) => [Date.parse(r.t), Number(r.value)] as [number, number]);
  const fx = await series("fx", T - QUOTE_FX_LOOKBACK_MS);
  for (const b of QUOTE_BOOKS) inputs[b] = bookInputs(T, fx, await series(`fair:${QUOTE_USD_BOOK[b]}`, T - 26 * H));
  return { paper, T, inputs };
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
  try { cfg = (await d.db.select<LiveConfig>(inst.config, "id=eq.1&select=dry_run,live_confirmed_at,capital_gbp"))[0]; }
  catch (e) {
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

  const { paper, T, inputs } = await paperView(d, inst);
  report.minute = T != null ? iso(T) : null;
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
        report.errors.push(`${label}: pending ${o.side} ${o.base_size} ${LIVE_SYMBOL[o.book]} (${o.client_order_id}) is neither among the venue's active orders nor in its history ${Math.round(ageMs / M)} min on — outcome unknown; it stays pending for a person to settle, and the rung places nothing`);
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
  // pause, whenever the executor is not live and armed, and once it has rested unfilled for QUOTE_LIVE_CONVERT_REST_MS. Its
  // fills are booked above, as every live order's are; a cancel already asked is asked again there.
  for (const o of open.filter((x) => x.mode === "live" && x.leg === "convert" && x.state !== "pending" && !x.cancel_requested_at && !unreadable.has(x.id))) {
    const why = globalPause ? "global pause" : entry.book !== "live" ? `not live and armed (${entry.why})`
      : isAutoConvert(o) ? (d.now - Date.parse(o.ts) >= QUOTE_LIVE_TOPUP_REST_MS ? "a top-up unfilled after 30 minutes: the next turn that finds an ask short sends another at the book as it stands" : null)
      : d.now - Date.parse(o.ts) >= QUOTE_LIVE_CONVERT_REST_MS ? "unfilled after 24 hours: send another conversion if it is still wanted" : null;
    if (!why) continue;
    try { await cancelConfirmed(o, why); } catch (e) { report.errors.push(`${o.book}|convert: cancel ${msg(e)}`); }
  }
  const openOf = (mode: LiveMode, r: { book: QuoteBook; side: Side; k: number }) =>
    open.find((o) => isOpen(o) && o.mode === mode && o.book === r.book && o.rung_side === r.side && Number(o.k) === r.k) ?? null;

  // ── 2. the live book, from its fills ─────────────────────────────────────────────────────────────────────────────
  const fills = await d.db.selectAll<LiveOrderRow>(inst.orders, "mode=eq.live&state=in.(filled,partially_filled)&select=*&order=id.asc");
  const recent = await d.db.selectAll<Pick<LiveOrderRow, "id" | "ts" | "mode" | "book" | "rung_side" | "k" | "leg" | "state" | "paper_oid" | "paper_live" | "response">>(
    inst.orders, `ts=gte.${enc(iso(d.now - 25 * H))}&select=id,ts,mode,book,rung_side,k,leg,state,paper_oid,paper_live,response&order=id.asc`);
  for (const r of recent) if (Date.parse(r.ts) >= dayStart && wasSent(r)) { report.posts[r.mode]++; countKey(ctx, r.mode, r.book, r.rung_side); }
  const lastPrintPx = (b: QuoteBook) => paper?.books?.[b]?.lastPrint?.ticks != null ? paper.books[b].lastPrint!.ticks * QUOTE_TICK : null;
  const rungs: RungNow[] = [];
  for (const b of QUOTE_BOOKS) for (const side of ["bid", "ask"] as Side[]) for (const k of inst.rungs) {
    const mine = fills.filter((o) => o.book === b && o.rung_side === side && Number(o.k) === k && Number(o.filled_base) > 0).map((o): RungFill => ({
      id: o.id, ts: Date.parse(o.filled_at ?? o.ts), leg: o.leg, base: Number(o.filled_base), price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp || 0),
    }));
    const pair = pairs[LIVE_SYMBOL[b]];
    const px = inputs[b]?.f ?? lastPrintPx(b) ?? 0;
    const dust = pair && px > 0 ? dustBase(pair, px) : 0;
    const live = rungBook(side, mine, dayStart, dust);
    const pr = paper?.books?.[b]?.rungs?.find((r) => r.side === side && r.k === k);
    rungs.push({ book: b, side, k, label: rungLabel(b, side, k), paper: paperEntryTarget(pr), paperRefused: paperRefused(pr), paperMode: pr?.mode ?? null, live, holding: live.held > dust, dust });
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
  /** A resting exit's size, trimmed to the penny the venue rounds to (`pennyExit`); a stop is never trimmed. */
  const trimExit = (r: RungNow, ticks: number, base: string | null): string | null => {
    const pair = pairs[LIVE_SYMBOL[r.book]];
    return base && pair ? pennyExit(venueSideOf(r.side, "exit"), base, ticks * QUOTE_TICK, pair, r.dust) : base;
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
        const ticks = exitTicks(fair, r.side);
        // An exit the venue refused waits as the rule's refused order waits: for a newer print, and one not through it.
        const prev = lastLeg(r, "exit");
        if (prev && prev.state === "rejected") {
          const request = (await d.db.select<{ request: { paperLastPrint?: SeenPrint | null } | null }>(inst.orders, `id=eq.${prev.id}&select=request`))[0]?.request ?? null;
          if (!exitMayGo({ ...prev, request }, r.live.openedAt, r.side === "bid" ? "ask" : "bid", ticks, lastPrint)) continue;
        }
        const base = trimExit(r, ticks, exitBase(r, ticks * QUOTE_TICK, null));
        if (base) sent(await placeOrder(ctx, { mode: "live", book: r.book, rungSide: r.side, k: r.k, leg: "exit", side: venueSideOf(r.side, "exit"), ticks, base, marketable: false, fair, lastPrint: seenPrint(lastPrint) }));
        continue;
      }
      // A resting exit follows fair by the rule's own step, on inputs that still stand; stale, it keeps its price.
      if (fair == null || staleBook(r.book) || o.fair == null || Math.abs(fair / Number(o.fair) - 1) <= inst.exitReprice) continue;
      const c = await cancelConfirmed(o, "the rule re-prices the exit");
      if (c !== "cancelled") continue;
      const ticks = exitTicks(fair, r.side);
      const base = trimExit(r, ticks, exitBase(r, ticks * QUOTE_TICK, null));
      if (base) sent(await placeOrder(ctx, { mode: "live", book: r.book, rungSide: r.side, k: r.k, leg: "exit", side: venueSideOf(r.side, "exit"), ticks, base, marketable: false, fair, lastPrint: seenPrint(lastPrint) }));
    } catch (e) {
      report.errors.push(`${r.label}: ${msg(e)}`);
    }
  }

  // ── 6. entries: the paper rung's order, in the book entries go to; withdrawn everywhere else ─────────────────────────
  takeStock();
  const gbpPerRung = rungGbp(capital, inst.rungs);
  const skipEvent = async (mode: LiveMode, r: RungNow, t: PaperTarget, reason: string, detail: Record<string, unknown>) => {
    report.skippedEntries.push({ mode, rung: r.label, reason });
    try {
      await d.db.upsert(inst.events, [{ mode, minute: iso(t.live - M), book: r.book, rung_side: r.side, k: r.k, kind: "skip",
        detail: { reason, paperOid: t.oid, paperLive: iso(t.live), ticks: t.ticks, ...detail } }], "mode,minute,book,rung_side,k,kind");
    } catch (e) { report.errors.push(`${r.label}: skip not recorded (${msg(e)})`); }
  };
  /** The books an ask of the live book was skipped on this turn for want of coin: step 6b tops their coin up. */
  const shortOf = new Set<QuoteBook>();
  // TAKE (docs/agents/reviews/2026-10-03-take-prereg.md), an instance's option from `take.from`. On a rung that may enter
  // in the live book (its turn's entry conditions, the rung holding nothing and quoting no exit, the paper rung in no
  // position of its own), the recorder's read of the book at most 90 s old (step 2) is checked against the rung's take
  // limit, k + the 0.09 % fee from this turn's fair (step 3). Through it, the rung's turn is the take's (step 4): its
  // entry is cancelled and read back (a frozen cancel waits), and one taker IOC goes out at the limit for the rung's
  // pounds, after the entry's own funds check, recorded as an entry with no paper order and `request.take`. The venue
  // fills it, or not; a fill is any entry's (step 5's exit, re-price and 24-hour stop).
  const takeOn = !!inst.take && d.now >= inst.take.from;
  const readsOf = new Map<QuoteBook, Promise<RecordedRead | null>>();
  const recordedOf = (b: QuoteBook) => {
    if (!readsOf.has(b)) {
      readsOf.set(b, (d.recordedBook ?? ((bk: QuoteBook, at: number) => recordedBookAt(d.db, bk, at)))(b, d.now)
        .catch((e) => { report.errors.push(`${b}: the recorded book is unreadable (${msg(e)}): no take this turn`); return null; }));
    }
    return readsOf.get(b)!;
  };
  /** Whether the rung's turn is the take's: false when the book is not through its limit, and then its paper entry goes on. */
  const takeTurn = async (r: RungNow, o: LiveOrderRow | null): Promise<boolean> => {
    const f = inputs[r.book]?.f ?? null;
    const read = f == null ? null : await recordedOf(r.book);
    if (f == null || !read) return false;
    const limit = takeLimitTicks(f, r.k, r.side), touch = readTouch(read);
    if (!takeTriggered(r.side, limit, touch)) return false;
    if (o && (await cancelConfirmed(o, "a take replaces the rung's entry")) !== "cancelled") return true;
    const pair = pairs[LIVE_SYMBOL[r.book]];
    const price = limit * QUOTE_TICK, side = venueSideOf(r.side, "entry");
    const base = rungBase(gbpPerRung, price, pair, side);
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
        const allowed = entry.book === mode && !report.guards[r.book].length && levelOf(mode, r.book, r.side) === "all" && !(mode === "live" && lossStopped) && !!bal;
        if (takeOn && mode === "live" && allowed && r.paperMode !== "position" && (await takeTurn(r, o))) continue;
        const target = allowed ? r.paper : null;
        if (!target) {
          if (o) {
            const why = entry.book !== mode ? `entries go ${entry.book ?? "nowhere"}: ${entry.why}`
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
        const base = rungBase(gbpPerRung, price, pair, side);
        if (!base) { await skipEvent(mode, r, target, "the rung's size is under the venue's minimum", { gbp: gbpPerRung, price }); continue; }
        if (side === "buy") {
          const need = pennyUp(Number(base) * price);
          if (!((free.GBP ?? 0) + 1e-9 >= need)) { await skipEvent(mode, r, target, "not enough free GBP", { needGbp: need, freeGbp: free.GBP ?? 0 }); continue; }
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
        const refused = today.filter((o) => o.book === book && isAutoConvert(o) && o.state === "rejected" && wasSent(o) && !wasRateLimited(o)).at(-1);
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
          spentTodayGbp: today.filter((o) => o.book === book && isAutoConvert(o))
            .reduce((a, o) => a + Number(isOpen(o as LiveOrderRow) ? o.base_size : o.filled_base) * Number(o.price), 0),
        });
      }
      for (const p of planTopUps(cases, capital, free.GBP ?? 0, inst.rungs)) {
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
    const prev = (await d.db.select<{ state: { guards?: Record<string, string[]> } }>(inst.state, "id=eq.1&select=state"))[0]?.state ?? {};
    // The errors box hears of a stopped dead-man switch once, on the turn its guard first appears; the guard's own
    // events below record when it came and went.
    const hadDeadman = Object.values(prev.guards ?? {}).some((rs) => Array.isArray(rs) && rs.some((r) => String(r).startsWith(DEADMAN_WATCH_REASON)));
    if (deadmanReason && !hadDeadman) report.errors.push(`DEAD-MAN SWITCH NOT RUNNING: ${deadmanReason}; exits and the 24-hour stops stay armed. Check the monitor Worker (workers/monitor).`);
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
        held: rungs.filter((r) => r.live.held > 0).map((r) => ({ rung: r.label, held: r.live.held, avgEntry: r.live.avgEntry, openedAt: r.live.openedAt != null ? iso(r.live.openedAt) : null })),
        // Each book's dust this turn (`dustBase` at its price): at or under it a rung is flat here, so the page closes a
        // round trip, and calls a rung empty, where this executor does (Davies, 2026-10-01: an exit trimmed to the penny
        // left 0.00102 USDT on its rung, and the page held its trip open).
        dust: Object.fromEntries(QUOTE_BOOKS.map((b) => [b, rungs.find((r) => r.book === b)?.dust ?? 0])),
      },
    }], "id");
  } catch (e) { report.errors.push(`state not recorded (${msg(e)})`); }
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
 * global pause, whenever the executor is not live and armed, and after QUOTE_LIVE_CONVERT_REST_MS unfilled. `taker: true`
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
  const capital = Number(cfg.capital_gbp), cap = capital * QUOTE_LIVE_CONVERT_MAX_FRACTION;
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
  const asksNeed = asksNeedOf(fair, capital, pair, inst.rungs);
  if (beyond + 1e-12 >= asksNeed) return { error: `the account already holds ${beyond} ${coin} beyond its longs, ${rungsWord(inst.rungs)} asks' worth (${asksNeed}) or more: nothing to convert` };
  const openBuys = open.filter((o) => o.side === "buy").reduce((a, o) => a + pennyUp(Math.max(0, Number(o.base_size) - Number(o.filled_base)) * Number(o.price)), 0);
  const needGbp = pennyUp(Number(base) * price * (taker ? 1.0009 : 1));
  if ((bal.GBP ?? 0) - openBuys < needGbp) return { error: `not enough free GBP: ${(bal.GBP ?? 0) - openBuys} free, ${needGbp} needed at the limit${taker ? " with the fee" : ""}` };
  // The governor's count for the conversion's key (`QuoteLiveInstance.govKey`; the live account's one key is every POST).
  const convKey = inst.govKey(book, null), multiKey = isMultiKey(inst);
  const today = (await d.db.selectAll<{ id: number; response: unknown; book?: QuoteBook; rung_side?: Side | null }>(inst.orders,
    `mode=eq.live&ts=gte.${enc(iso(Math.floor(d.now / DAY) * DAY))}&select=id,response${multiKey ? ",book,rung_side" : ""}&order=id.asc`))
    .filter(wasSent).filter((r) => !multiKey || inst.govKey(r.book!, r.rung_side ?? null) === convKey);
  if (governorLevel(today.length) !== "all") return { error: `the governor has closed entries: ${today.length} POSTs today` };
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
