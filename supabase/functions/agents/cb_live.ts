// "Stablecoin quotes USDC/GBP" on LIVE: "Stablecoin quotes with Euros - 2"'s decisions, carried out order for order with real
// money on Coinbase Advanced Trade (migration 0177; Davies, 2026-10-29: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线",
// then "目前没有太多钱，我刚往我这个coinbase账户转了120磅，先把"with Euros - 2"用120磅资金上限，上线后live策略名字叫Stablecoin quotes USDC/GBP").
// Its capital is £120 in pounds: six rungs of £20 on USDC-GBP, the three bids from GBP and the three asks from USDC.
// BUILT INERT: its config row is `dry_run` true and `armed_at` null, and only Davies arms it, in the conversation where he
// says go (docs/agents/reviews/2026-10-29-cb-live-design.md has the go statement, its undo and his checklist). Modelled on
// PR5 LIVE's executor (quotes_live.ts), smaller: one book, USDC-GBP.
//
// WHO DECIDES (`cb_live_config.decide`, 0182; Davies, 2026-10-30: "要做"). 'paper', the default, is the follower below: a paper
// arm's decisions and none of its own. 'self' decides every minute with that arm's own rule and code on its own copy of the
// rule's state (`cbLiveSelfStep`: the fair of `cbLiveMinuteFair`, PR5's frozen `stepMinute`, two minutes behind the clock), the
// same shared inputs, and its own fills for which rungs are held; it reads nothing of the paper arm's orders or state. Its
// difference from the follower: a rung the account does not hold quotes the rule's entry whatever the paper rung is doing
// (held, refused, its run lost), and a post-only refusal is tried again the next turn, as the rule re-places a refused
// order the next minute. While 'paper' decides, 'self' runs beside it as the shadow (`cb_live_shadow`): what it would rest
// on each rung, what the follower wanted and what rested, a row a rung a turn.
//
// WHAT THE FOLLOWER EXECUTES: a paper arm's decisions, and none of its own. The arm is a row of `CB_LIVE_PAPERS` named by the
// config (`paper`, "coinbasenudge" by default), so a better rule is a new paper arm and a one-word config change, not a change
// here. Every minute, after the arm has decided its minute, the executor reads the arm's state (each rung's resting order, the
// rule's `stepMinute` book) and its newest minute record (the fair the minute was decided on), and for each of the six rungs
// ('self': its own book and fair in their place):
//   * A rung the account holds nothing on quotes exactly the paper rung's entry: its side and price (the paper's ticks), at
//     the config's size in pounds (`rung_gbp`, £20 a rung of £120). While the paper rung quotes nothing (dark, withdrawn, its own position, a
//     refused order) the live rung quotes nothing. A paper decision is keyed by the paper order's id and the minute it goes
//     live (`paper_key`); one the venue refused post-only is not sent again until the paper decides anew.
//   * A rung the account DOES hold exits at the rule's own price on the paper's fair (`exitTicks`), re-priced when fair moves
//     more than 0.05 % (`QUOTE_REPRICE`), never worse than that price: where the book it meets shows that price crossing, it
//     rests a tick inside the opposite best instead. After 24 hours it is stopped as the rule stops it, as a taker: an IOC
//     limit at fair ∓ 50 bps (`CB_LIVE_STOP_BAND`), tried again an hour later if it comes back unfilled.
//   * Positions are never kept in its state: each turn derives them from the fills it has read back from Coinbase
//     (`cb_live_fills`), trip by trip (a trip is an entry order and every exit and stop sent for what it filled). A partial
//     entry fill makes the rung held at once and its entry is withdrawn. A remainder worth less than £1 (`CB_LIVE_DUST_GBP`),
//     or under the product's minimum size, is carried, not exited (CB-LIVE-RULES: 5 of 1,785 fills): the trip closes and the
//     coin or pounds stay in the account, where the next quotes use them.
//
// WHAT IT NEVER DOES:
//   * It never POSTs in dry-run (`dry_run` true): every order it would send is a row (`state` 'dry'), written when the
//     decision changes, and the turn's report says what each rung would quote. Its client is built read-only: a POST
//     throws before any request is made. A dry-run still reads the account (balances, the touch) when the key is stored.
//     `dry_run` does not make it abandon a live book it already holds: live trips keep their exits and stops.
//   * It never sends an entry unless armed (`armed_at`). Clearing `armed_at` is the kill switch: live entries are
//     cancelled, exits and stops stay armed. `agent_risk.global_pause` cancels every open order, exits included, and
//     places nothing.
//   * It never sends a taker order but the 24-hour stop. Entries and exits are post-only.
//   * It never books a fill it has not read back (`GET …/orders/historical/fills`), never marks an order the venue shows
//     nowhere as rejected (it stays `pending`, reported), and never places a second order on a rung (a partial unique
//     index refuses one, and a replacement waits until the cancel is read back final).
//   * It never leaves an order resting longer than `CB_LIVE_GTD_MS` without its say: every order is good-til-date, re-placed
//     as its end nears. If the executor stops, Coinbase itself takes every order off within 20 minutes: its dead-man.
//
// ITS LIMITS (config, scaled to its £120): the POST governor (entries withdrawn at `gov_entry_posts` in a UTC day,
// only stops at `gov_stops_only_posts`); the daily loss stop (realised and marked over the day's trips at −`daily_loss_pct`
// of capital: no entries for the rest of the UTC day); stale inputs (the arm's newest minute older than four minutes, or
// its fair dark: no entries, exits keep their price); inventory (a bid needs free GBP, an ask free USDC: one the account
// cannot cover is skipped, and an armed account tops its USDC up itself with a post-only buy at the bid, at most
// `convert_max_gbp_day` a UTC day, good for 30 minutes: no conversion at a loss, Davies' rule for Revolut X).

import {
  CB_DONE, cbClientFromEnv, CbHttpError, type CbCreateBody, type CbFill, type CbOrder, type CbOrderStatus, type CbProductInfo, type CbSide,
} from "../_shared/coinbase.ts";
import type { Db } from "./db.ts";
import { exitTicks, newBookState, QUOTE_REPRICE, QUOTE_STOP_MS, QUOTE_TICK, stepMinute, type BookState, type Rung, type Side } from "./quotes.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { CB_USDC_ARM, cbUsdcArmNewState, type CbUsdcArm, type CbUsdcFair, type CbUsdcState } from "./cb_usdc.ts";
import { CB_NUDGE_ARM } from "./cb_nudge.ts";
import { CB_HOLD_MS, cbHoldBarAt } from "./cb_hold.ts";
import { cbFxCount, cbRatesAt, readCbFx, type CbFxPair, type CbFxReads } from "./cb_fx.ts";
import { CB_BOOK, CB_FAIR_KIND, cbCoinFair, cbInUsd, cbMinuteInputs } from "./cb_quotes.ts";
import { cbInBlackout } from "./cb_releases.ts";
import { fairHours, median, QUOTE_FX_LOOKBACK_MS } from "./quotes.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const dayOf = (ms: number) => iso(ms).slice(0, 10);

export const CB_LIVE_TABLES = { config: "cb_live_config", state: "cb_live_state", orders: "cb_live_orders", fills: "cb_live_fills", events: "cb_live_events" } as const;
export const CB_LIVE_LEASE = "cb-live";
export const CB_LIVE_LEASE_MS = 50e3;
export const CB_LIVE_PRODUCT = "USDC-GBP";
/** Every order is good-til-date: it ends this long after it is placed … */
export const CB_LIVE_GTD_MS = 20 * M;
/** … and is re-placed when less than this is left. */
export const CB_LIVE_REFRESH_MS = 5 * M;
/**
 * The arm's newest decided minute older than this: no entries. The paper decides minute t at about t + 2 min, one minute
 * behind the recorder's coverage, and this call may run before it in the same minute, so its newest minute is normally 3–4
 * minutes old when the executor reads it; one paper run lost (2026-10-29 20:25, "Signal timed out") made it 5 min 0.8 s
 * against the old limit of 5, and every entry was withdrawn and posted again a minute later. Seven minutes allows two lost
 * runs.
 */
export const CB_LIVE_STALE_MS = 7 * M;
/** After Coinbase refuses an order with 401 or 403, that paper decision (or a top-up) is not sent again for this long. */
export const CB_LIVE_DENIED_MS = 15 * M;
/** The 24-hour stop's IOC: at most this far through fair. */
export const CB_LIVE_STOP_BAND = 0.005;
/** A stop that came back unfilled is tried again this much later. */
export const CB_LIVE_STOP_RETRY_MS = H;
/** A USDC top-up rests this long. */
export const CB_LIVE_CONVERT_MS = 30 * M;
/** Fills older than this are not read back into the turn: the 24-hour stop closes every trip well inside it. */
export const CB_LIVE_TRIP_WINDOW_MS = 7 * DAY;
/**
 * The venue's balances as a LIVE page shows them, the shape every live executor's reader passes on as `balances` (Coinbase's
 * here; the Revolut X executors' in quotes_live.ts): when they were read, and per currency what is available and what is on
 * hold in orders (Davies, 2026-10-29: "都加上吧，revolut也一样": INVENTORY shows the account, not the book's own count).
 */
export type VenueBalances = { at: string; ccy: Record<string, { available: number; hold: number }> };
/** The currencies the Coinbase executor keeps in its state: the book's two and the euros the account may hold. */
export const CB_LIVE_BALANCE_CCYS = ["GBP", "USDC", "EUR"] as const;
/** Pure: the balances of `ccys` from Coinbase's accounts (summed across accounts of a currency), read at `nowMs`. */
export function venueBalances(acc: Array<{ currency: string; available_balance?: { value: string }; hold?: { value: string } }>, ccys: readonly string[], nowMs: number): VenueBalances {
  const sum = (c: string, k: "available_balance" | "hold") => acc.filter((a) => a.currency === c).reduce((s, a) => s + (Number(a[k]?.value ?? 0) || 0), 0);
  return { at: iso(nowMs), ccy: Object.fromEntries(ccys.map((c) => [c, { available: sum(c, "available_balance"), hold: sum(c, "hold") }])) };
}
/** A remainder worth less than this is carried, not exited. */
export const CB_LIVE_DUST_GBP = 1;
/** Its name on LIVE (Davies, 2026-10-29); the paper arm keeps its own on TESTING. */
export const CB_LIVE_NAME = "Stablecoin quotes USDC/GBP";
/** An order the venue shows nowhere is reported after this. */
export const CB_LIVE_UNKNOWN_MS = 2 * M;

/** A paper arm the executor can carry out: its state row (a `stepMinute` book per product) and its minute record. */
export type CbLivePaper = { id: string; state: string; minutes: string; book: typeof CB_LIVE_PRODUCT };
export const CB_LIVE_PAPERS: Record<string, CbLivePaper> = {
  coinbasenudge: { id: "coinbasenudge", state: "cb_nudge_state", minutes: "cb_nudge_minutes", book: CB_LIVE_PRODUCT },
  coinbaseusdc: { id: "coinbaseusdc", state: "cb_usdc_state", minutes: "cb_usdc_minutes", book: CB_LIVE_PRODUCT },
  coinbasehold: { id: "coinbasehold", state: "cb_hold_state", minutes: "cb_hold_minutes", book: CB_LIVE_PRODUCT },
};

/**
 * Who decides what the rungs rest (migration 0182; Davies, 2026-10-30: "要做"): 'paper', the follower, carries the paper arm's
 * decisions as above; 'self' decides every minute with that arm's own rule and code on its own inputs and its own fills, and
 * reads nothing of the paper arm's orders or state. Missing (before 0182) is 'paper'.
 */
export type CbLiveDecide = "paper" | "self";
export type CbLiveConfig = {
  id: number; paper: string; dry_run: boolean; armed_at: string | null; rung_gbp: number; capital_gbp: number; daily_loss_pct: number;
  gov_entry_posts: number; gov_stops_only_posts: number; convert_max_gbp_day: number; decide?: CbLiveDecide;
};

/**
 * The rule each paper arm decides with, which 'self' runs on its own: the arm's own driver pieces (cb_usdc.ts' `CbUsdcArm`, its
 * fair `fairOf`: "with Euros - 3"'s nudge for `coinbasenudge`). `coinbasehold` (cb_hold.ts) has no such arm and cannot decide
 * for itself; with it, 'self' is an error and places no entry.
 */
export const CB_LIVE_RULES: Record<string, CbUsdcArm> = { coinbasenudge: CB_NUDGE_ARM, coinbaseusdc: CB_USDC_ARM };
/**
 * The minute 'self' decides at a turn at `now`: two whole minutes back. The fast-rate recorder writes minute t's reads at
 * about t + 58 s and the rule reads only what arrived by then (cb_fx.ts), so t = the current minute − 1 would race the
 * recorder; − 2 never does. The paper arm's newest minute is normally 3–4 minutes old when the follower reads it.
 */
export const CB_LIVE_SELF_LAG_MS = 2 * M;
/** At most this many minutes are stepped in one turn (a turn after a gap starts this far back: the nudge's EMA decays by time). */
export const CB_LIVE_SELF_MAX_MINUTES = 10;
/** 'self''s own record of the rule, kept in `cb_live_state.state.self`: the arm it runs, the minute and fair it last decided, and the rule's state (a `stepMinute` book on USDC-GBP, the nudge's EMA, the fast-rate counts). */
export type CbLiveSelf = { rule: string; lastMinute: number; fair: number | null; extra?: Record<string, unknown>; st: CbUsdcState };

/** The stored inputs the rule prices minutes on: GBP/USD's and EUR/USD's bars, the coin's hourly closes. */
export type CbLiveBars = { gbpBars: Array<[number, number]>; eurBars: Array<[number, number]>; hours: Array<[number, number]> };
/**
 * The stored bars for deciding [first, horizon], read as the paper arms' driver reads them (`runCbUsdcArm` in cb_usdc.ts, frozen
 * by its pre-registration, so its reads are not exported from it but repeated here, and pinned equal by the minute-for-minute
 * test in cb_live.test.ts): each rate's window from ten minutes before `first` and its newest bar inside the 60-hour hold
 * before that (the anchor a closure holds); the coin's hourly closes from a day before `first`.
 */
export async function readCbLiveBars(db: Db, first: number, horizon: number): Promise<CbLiveBars> {
  const series = async (table: string, kind: string, from: number) => (await db.selectAll<{ t: string; value: number }>(table,
    `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(from)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
  const bars = async (table: string, kind: string) => {
    const win = await series(table, kind, first - QUOTE_FX_LOOKBACK_MS);
    const anchor = await db.select<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=lt.${enc(first - QUOTE_FX_LOOKBACK_MS)}&t=gte.${enc(first - CB_HOLD_MS)}&select=t,value&order=t.desc&limit=1`);
    return [...anchor.map((r) => [msOf(r.t), Number(r.value)] as [number, number]), ...win];
  };
  return { gbpBars: await bars("agent_quote_inputs", "fx"), eurBars: await bars("cb_quote_inputs", "fx:EURUSD"), hours: await series("agent_quote_inputs", CB_FAIR_KIND.USDC, first - DAY) };
}

/**
 * Minute `t`'s fair on USDC-GBP under a USDC arm's rule, composed of the very functions its driver calls for a minute, in its
 * order (`runCbUsdcArm`'s loop): the rates held through closures (`cbRatesAt` with `cbHoldBarAt`), the coin's dollar value
 * (`cbCoinFair`: USDC 1 under the de-peg guard), X and fairU (`cbMinuteInputs`), the arm's own fair on top (`fairOf`, "- 3"'s
 * nudge, which moves its EMA in `st`), none in a release blackout. `fairU` is what `stepMinute` is given; `fxSrc` the source
 * that priced GBP/USD (the caller counts it).
 */
export function cbLiveMinuteFair(st: CbUsdcState, t: number, ins: CbLiveBars & { fx: Record<CbFxPair, CbFxReads> }, fairOf: CbUsdcFair | null) {
  const b = CB_LIVE_PRODUCT;
  const { bar, eb, gbpSrc, eurSrc } = cbRatesAt(st, t, ins.gbpBars, ins.eurBars, ins.fx, cbHoldBarAt, true), window = fairHours(t, ins.hours);
  const fxSrc = st.fxFrom != null && t >= st.fxFrom ? (CB_BOOK[b].quote === "GBP" ? gbpSrc : eurSrc) : undefined;
  const coinU = cbCoinFair(st, t, CB_BOOK[b].coin, median(window), []).fairU;
  const io = cbMinuteInputs(b, bar ? bar[1] : null, eb ? eb[1] : null, coinU, cbInUsd(st, t));
  const own = fairOf ? fairOf(st, t, b, io) : { fairU: io.fairU, extra: {} };
  return { fxSrc, io, own, fairU: cbInBlackout(t) ? null : own.fairU };
}

/** A fresh record of `rule` whose first decided minute is `first`: every switch of the arm's history on from it (dollars, Coinbase's own coin value, fast rates). */
export function cbLiveSelfNew(rule: string, first: number): CbLiveSelf {
  const arm = CB_LIVE_RULES[rule];
  if (!arm) throw new Error(`"${rule}" has no rule the executor can run itself (${Object.keys(CB_LIVE_RULES).join(", ")})`);
  const st = cbUsdcArmNewState({ ...arm, products: [CB_LIVE_PRODUCT] }, first, { [CB_LIVE_PRODUCT]: 0 });
  st.usdFrom = first; st.liveFrom = first; st.fxFrom = first;
  return { rule, lastMinute: first - M, fair: null, st };
}

/**
 * 'self''s decision for the turn at `now`: the paper rule stepped on the executor's own copy of its state, minute by minute up to
 * `minuteOf(now) − CB_LIVE_SELF_LAG_MS`, with the arm's own code (`cbLiveMinuteFair`: the rates held through closures, USDC 1
 * under the de-peg guard, the arm's nudge; `stepMinute`, PR5's frozen rule) and no prints: it is told nothing of fills but
 * the rungs the account holds (`held`, keys `rungKey`), which it does not quote (each is put back idle after every minute, so
 * when its trip closes the rung places afresh at the minute's fair, as the paper's does after an exit). A rung never fills
 * here and is never refused here: the venue does both. `seedNudge`, the paper arm's EMA, is taken once when the record has
 * none and only while the follower decides (the shadow), so the comparison starts level. Returns the new record; `prev`
 * is not changed.
 */
export async function cbLiveSelfStep(db: Db, now: number, prev: CbLiveSelf | null, rule: string, held: ReadonlySet<string>, seedNudge: { ema: number | null; last: number | null } | null = null): Promise<CbLiveSelf> {
  const arm = CB_LIVE_RULES[rule];
  if (!arm) throw new Error(`"${rule}" has no rule the executor can run itself (${Object.keys(CB_LIVE_RULES).join(", ")})`);
  const target = Math.floor(now / M) * M - CB_LIVE_SELF_LAG_MS;
  const s: CbLiveSelf = prev && prev.rule === rule && prev.st?.books?.[CB_LIVE_PRODUCT] ? structuredClone(prev) : cbLiveSelfNew(rule, target);
  const first = Math.max(s.lastMinute + M, target - (CB_LIVE_SELF_MAX_MINUTES - 1) * M);
  if (target < first) return s;
  if (seedNudge && s.st.nudge == null && seedNudge.last != null && seedNudge.last < first) s.st.nudge = { ...seedNudge };
  const bars = await readCbLiveBars(db, first, target);
  const fx = await readCbFx(db, first, target, CB_HOLD_MS);
  const fairOf = arm.fairOf ? await arm.fairOf(db, first, target) : null;
  const book = s.st.books[CB_LIVE_PRODUCT];
  const rest = () => { for (const r of book.rungs) if (held.has(rungKey(r.side, r.k)) || r.mode === "position") { r.mode = "idle"; r.o = null; } };
  rest();
  for (let t = first; t <= target; t += M) {
    const m = cbLiveMinuteFair(s.st, t, { ...bars, fx }, fairOf);
    if (m.fxSrc !== undefined) cbFxCount(s.st, m.fxSrc);
    stepMinute(book, t, { x: m.io.x, fairU: m.fairU, prints: [] });
    rest();
    s.fair = m.io.x && m.fairU ? m.fairU / m.io.x : null;
    s.extra = m.own.extra;
  }
  s.lastMinute = target; s.st.lastMinute = target;
  return s;
}

/** The shadow (0182): one row a rung a turn while the follower decides, what 'self' would rest beside what the follower wanted and what rested. */
export const CB_LIVE_SHADOW_TABLE = "cb_live_shadow";
export type Leg = "entry" | "exit" | "stop" | "convert";
export type OrderRow = {
  id?: number; client_order_id: string; venue_order_id: string | null; mode: "live" | "dry_run"; leg: Leg; trip: string | null;
  rung_side: Side | null; k: number | null; side: CbSide; price: number; base_size: number; end_time: string | null;
  state: "pending" | "open" | "cancelling" | "filled" | "cancelled" | "expired" | "rejected" | "refused" | "dry" | "dry_withdrawn";
  paper_key: string | null; fair: number | null; filled_size: number; avg_price: number | null; fees_gbp: number; reason: string | null;
  request: unknown; response: unknown; created_at: string; updated_at: string;
};
export type FillRow = {
  entry_id: string; trade_id: string; order_id: string; client_order_id: string; trip: string | null; leg: Leg; rung_side: Side | null; k: number | null;
  side: CbSide; price: number; size: number; commission: number; liquidity: string | null; trade_time: string;
};
/** A trip as the fills give it: what its entry filled, what its exits and stops filled, its fees and P&L in pounds. */
export type Trip = {
  trip: string; rungSide: Side; k: number; entryQty: number; entryAvg: number; exitQty: number; exitAvg: number; fees: number; firstFill: number; lastFill: number;
};
export type CbLiveReport = {
  skipped?: string; mode: "dry_run" | "live" | "wind_down" | "paused"; armed: boolean; decide?: CbLiveDecide; self?: { minute: number; fair: number | null } | null;
  posts: number; placed: number; cancelled: number; would: Record<string, unknown>;
  held: Record<string, number>; gbpUsd: number | null; realisedTodayGbp: number; markedGbp: number; lossStopped: boolean; errors: string[]; events: string[]; report: boolean;
};
export type CbLiveDeps = { db: Db; now: number; holder: string; read: (n: string) => string | undefined; fetchImpl?: typeof fetch; uuid?: () => string };

// ------------------------------------------------------------------------------------------------------------ pure

export const rungKey = (side: Side, k: number) => `${side}|${k}`;
/** The paper rung's entry as a decision, or null when it quotes nothing. */
export function paperEntry(r: Rung): { side: Side; ticks: number; key: string } | null {
  if (r.mode !== "quote" || !r.o || r.o.state === "rejected") return null;
  return { side: r.side, ticks: r.o.ticks, key: `${r.o.oid}|${r.o.live}` };
}
const sideOf = (s: Side): CbSide => (s === "bid" ? "BUY" : "SELL");
/** Pure: a size floored to the product's step, as a plain decimal. */
export function floorTo(x: number, step: number): number {
  const d = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.floor(x / step + 1e-9) * step).toFixed(d));
}
/** Pure: the coin a rung of `gbp` pounds buys or sells at `px` pounds a coin, on the product's step. */
export function rungQty(gbp: number, px: number, step: number): number {
  return floorTo(gbp / px, step);
}
/** Pure: is what a trip still holds a remainder to carry (under the product's minimum, or worth less than £1 at `px`)? */
export const isDust = (held: number, px: number, minSize: number) => held < minSize || held * px < CB_LIVE_DUST_GBP;
const fmt = (x: number, step: number) => x.toFixed(Math.max(0, Math.round(-Math.log10(step))));

/** Pure: the trips the fills make, by trip id. */
export function tripsOf(fills: FillRow[]): Map<string, Trip> {
  const out = new Map<string, Trip>();
  for (const f of [...fills].sort((a, b) => msOf(a.trade_time) - msOf(b.trade_time))) {
    if (!f.trip || f.leg === "convert" || !f.rung_side) continue;
    const t = out.get(f.trip) ?? { trip: f.trip, rungSide: f.rung_side, k: Number(f.k), entryQty: 0, entryAvg: 0, exitQty: 0, exitAvg: 0, fees: 0, firstFill: msOf(f.trade_time), lastFill: 0 };
    const px = Number(f.price), sz = Number(f.size);
    if (f.leg === "entry") { t.entryAvg = (t.entryAvg * t.entryQty + px * sz) / (t.entryQty + sz); t.entryQty += sz; }
    else { t.exitAvg = (t.exitAvg * t.exitQty + px * sz) / (t.exitQty + sz); t.exitQty += sz; }
    t.fees += Number(f.commission) || 0;
    t.lastFill = msOf(f.trade_time);
    out.set(f.trip, t);
  }
  return out;
}
/** Pure: what a trip still holds, in coin. */
export const tripHeld = (t: Trip) => Math.max(0, t.entryQty - t.exitQty);
/** Pure: a trip's realised pounds (its exits against its entry price, less every fee) and its open part marked at `fair`. */
export function tripPnl(t: Trip, fair: number | null): { realised: number; marked: number } {
  const dir = t.rungSide === "bid" ? 1 : -1;
  const realised = dir * t.exitQty * (t.exitAvg - t.entryAvg) - t.fees;
  const marked = fair == null ? 0 : dir * tripHeld(t) * (fair - t.entryAvg);
  return { realised, marked };
}

/** Pure: an exit's price, never worse than the rule's: inside the opposite best when the rule's price would cross it. */
export function exitPrice(ruleTicks: number, closeSide: Side, touch: { bid: number | null; ask: number | null }): number {
  const rule = ruleTicks * QUOTE_TICK;
  if (closeSide === "ask") return touch.bid != null && touch.bid >= rule - 1e-12 ? Number((touch.bid + QUOTE_TICK).toFixed(4)) : rule;
  return touch.ask != null && touch.ask <= rule + 1e-12 ? Number((touch.ask - QUOTE_TICK).toFixed(4)) : rule;
}
/** Pure: would a post-only order at `px` cross the touch? */
export function crosses(side: CbSide, px: number, touch: { bid: number | null; ask: number | null }): boolean {
  return side === "BUY" ? touch.ask != null && px >= touch.ask - 1e-12 : touch.bid != null && px <= touch.bid + 1e-12;
}

/** Pure: the order body. A post-only good-til-date limit, or the stop's IOC limit. */
export function orderBody(o: { client_order_id: string; side: CbSide; price: number; size: number; endMs: number | null; ioc: boolean }, product: CbProductInfo): CbCreateBody {
  const base = Number(product.base_increment), quote = Number(product.quote_increment);
  const size = fmt(o.size, base), price = fmt(o.price, quote);
  return {
    client_order_id: o.client_order_id, product_id: product.product_id, side: o.side,
    order_configuration: o.ioc ? { sor_limit_ioc: { base_size: size, limit_price: price } }
      : { limit_limit_gtd: { base_size: size, limit_price: price, end_time: iso(o.endMs!).replace(/\.\d{3}Z$/, "Z"), post_only: true } },
  };
}
/**
 * What a top-up spent of the day's cap, in pounds: a live one only once Coinbase has it (a venue id), resting at its whole
 * size, ended at what filled; a refused, rejected or unseen one nothing (2026-10-29 21:45: a 403-rejected £60 top-up left
 * £10 of the £70 cap, less than one ask). A dry one at its size, as dry-run spends it.
 */
export function convertSpentGbp(o: Pick<OrderRow, "mode" | "state" | "venue_order_id" | "price" | "base_size" | "filled_size" | "avg_price">): number {
  if (o.mode === "dry_run") return o.state === "dry" || o.state === "dry_withdrawn" ? Number(o.price) * Number(o.base_size) : 0;
  if (!o.venue_order_id) return 0;
  if (o.state === "open" || o.state === "cancelling") return Number(o.price) * Number(o.base_size);
  if (o.state === "filled" || o.state === "cancelled" || o.state === "expired") return Number(o.filled_size) * Number(o.avg_price ?? o.price);
  return 0;
}
/** Was a row refused by Coinbase with 401 or 403 (its reason as `place` writes it)? */
export const isDenied = (o: { state: string; reason: string | null }) => o.state === "rejected" && /^http 40[13]\b/.test(o.reason ?? "");
/** The venue's status as an order row's. */
export function rowState(s: CbOrderStatus): OrderRow["state"] {
  return s === "FILLED" ? "filled" : s === "CANCELLED" ? "cancelled" : s === "EXPIRED" ? "expired" : s === "FAILED" ? "rejected" : "open";
}

/** The product as this book is known to trade, used in dry-run without a key and in the pins (the probe reads the live one). */
export const CB_LIVE_PRODUCT_FALLBACK: CbProductInfo = { product_id: CB_LIVE_PRODUCT, base_increment: "0.01", quote_increment: "0.0001", base_min_size: "1" };

// ------------------------------------------------------------------------------------------------------------ the turn

type Want = { leg: Leg; rungSide: Side; k: number; side: CbSide; price: number; size: number; trip: string; paperKey: string | null; fair: number | null; ioc: boolean };

/** One turn. Lease-held; idempotent by client order id; never throws (errors go to the report and the state row). */
export async function runCbLive(d: CbLiveDeps): Promise<CbLiveReport> {
  const T = CB_LIVE_TABLES, now = d.now;
  const uuid = d.uuid ?? (() => crypto.randomUUID());
  const rep: CbLiveReport = { mode: "dry_run", armed: false, posts: 0, placed: 0, cancelled: 0, would: {}, held: {}, gbpUsd: null, realisedTodayGbp: 0, markedGbp: 0, lossStopped: false, errors: [], events: [], report: false };
  const held = await d.db.claim("agent_locks", `name=eq.${CB_LIVE_LEASE}&lease_until=lt.${enc(now)}`, { lease_until: iso(now + CB_LIVE_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...rep, skipped: "another run holds the lease" };
  const evs: Array<{ at: string; kind: string; detail: Record<string, unknown> }> = [];
  const ev = (kind: string, detail: Record<string, unknown> = {}) => { evs.push({ at: iso(now), kind, detail }); rep.events.push(kind); };
  let stateRow: { fault?: { key: string; at: number }; balances?: VenueBalances; self?: CbLiveSelf | null } = {};
  let self: CbLiveSelf | null = null;
  let balances: VenueBalances | null = null;
  try {
    const cfg = (await d.db.select<CbLiveConfig>(T.config, "id=eq.1&select=*"))[0];
    if (!cfg) return { ...rep, skipped: "no config row (migration 0177)" };
    stateRow = ((await d.db.select<{ state: typeof stateRow }>(T.state, "id=eq.1&select=state"))[0]?.state) ?? {};
    const paper = CB_LIVE_PAPERS[cfg.paper];
    if (!paper) throw new Error(`config.paper "${cfg.paper}" is not a paper arm (${Object.keys(CB_LIVE_PAPERS).join(", ")})`);
    let paused = false;
    try { paused = !!(await d.db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause"))[0]?.global_pause; }
    catch (e) { paused = true; rep.errors.push(`agent_risk unreadable, treated as paused: ${msg(e)}`); }

    // The record: this turn's orders of the last two days, and the fills of the trip window.
    const orders = await d.db.selectAll<OrderRow>(T.orders, `created_at=gte.${enc(now - 2 * DAY)}&select=*&order=id.asc`);
    const fills = await d.db.selectAll<FillRow>(T.fills, `trade_time=gte.${enc(now - CB_LIVE_TRIP_WINDOW_MS)}&select=*&order=entry_id.asc`);
    const liveOpen = () => orders.filter((o) => o.mode === "live" && (o.state === "pending" || o.state === "open" || o.state === "cancelling"));
    const hasLiveBook = liveOpen().length > 0 || [...tripsOf(fills).values()].some((t) => tripHeld(t) > 0);
    const live = !cfg.dry_run, armed = live && cfg.armed_at != null;
    rep.armed = armed;
    rep.mode = paused ? "paused" : live ? "live" : hasLiveBook ? "wind_down" : "dry_run";
    const post = live || hasLiveBook;
    const { client, why } = await cbClientFromEnv(d.read, post, d.fetchImpl, () => d.now);
    if (post && !client) throw new Error(`no Coinbase client for a live book: ${why}`);
    if (!client) ev("no_key", { why });

    const save = async (o: OrderRow, patch: Partial<OrderRow>) => {
      Object.assign(o, patch, { updated_at: iso(now) });
      await d.db.update(T.orders, `client_order_id=eq.${o.client_order_id}`, { ...patch, updated_at: iso(now) });
    };

    // 1. Reconcile every live order still in flight, and read back the fills of those that filled.
    if (client) {
      const unseen = liveOpen().filter((o) => !o.venue_order_id);
      let listed: CbOrder[] | null = null;
      if (unseen.length) {
        try { listed = await client.listOrders(CB_LIVE_PRODUCT, { since: Math.min(...unseen.map((o) => msOf(o.created_at))) - M }); }
        catch (e) { rep.errors.push(`list orders: ${msg(e)}`); }
      }
      const toFill: OrderRow[] = [];
      for (const o of liveOpen()) {
        try {
          if (!o.venue_order_id) {
            const m = listed?.find((x) => x.client_order_id === o.client_order_id);
            if (!m) {
              if (listed && now - msOf(o.created_at) > CB_LIVE_UNKNOWN_MS) ev("unknown_order", { client_order_id: o.client_order_id, leg: o.leg });
              continue;
            }
            await save(o, { venue_order_id: m.order_id });
          }
          const v = await client.getOrder(o.venue_order_id!);
          const st = CB_DONE.includes(v.status) ? rowState(v.status) : o.state === "cancelling" ? "cancelling" : "open";
          const filled = Number(v.filled_size ?? 0);
          await save(o, { state: st, filled_size: filled, avg_price: v.average_filled_price ? Number(v.average_filled_price) : null, fees_gbp: Number(v.total_fees ?? 0), reason: v.reject_reason || v.cancel_message || o.reason });
          if (filled > 0) toFill.push(o);
        } catch (e) { rep.errors.push(`reconcile ${o.client_order_id}: ${msg(e)}`); }
      }
      // Orders that ended in the last ten minutes are read again for fills a final status can carry.
      for (const o of orders) if (o.mode === "live" && o.venue_order_id && o.filled_size > 0 && !toFill.includes(o) && now - msOf(o.updated_at) < 10 * M) toFill.push(o);
      if (toFill.length) {
        try {
          const got: CbFill[] = await client.fills(toFill.map((o) => o.venue_order_id!));
          const rows: FillRow[] = [];
          for (const f of got) {
            const o = toFill.find((x) => x.venue_order_id === f.order_id);
            if (!o || (f.trade_type && f.trade_type !== "FILL")) continue;
            rows.push({ entry_id: f.entry_id, trade_id: f.trade_id, order_id: f.order_id, client_order_id: o.client_order_id, trip: o.trip, leg: o.leg, rung_side: o.rung_side, k: o.k,
              side: f.side, price: Number(f.price), size: Number(f.size), commission: Number(f.commission) || 0, liquidity: f.liquidity_indicator ?? null, trade_time: f.trade_time });
          }
          if (rows.length) {
            await d.db.upsert(T.fills, rows, "entry_id");
            for (const r of rows) if (!fills.some((x) => x.entry_id === r.entry_id)) fills.push(r);
          }
        } catch (e) { rep.errors.push(`fills: ${msg(e)}`); }
      }
    }

    // 2. The decision source, the product, the touch and the account. The follower ('paper') reads the paper arm's state and
    // its newest minute's fair; 'self' reads neither (`cbLiveSelfStep`, below, once the fills say what the account holds).
    const decideSelf = cfg.decide === "self";
    rep.decide = decideSelf ? "self" : "paper";
    const pRow = decideSelf ? undefined
      : (await d.db.select<{ state: { books?: Record<string, BookState>; nudge?: { ema: number | null; last: number | null } }; last_minute: string | null }>(paper.state, "id=eq.1&select=state,last_minute"))[0];
    const book = pRow?.state?.books?.[paper.book] ?? null;
    const lastMinute = pRow?.last_minute ? msOf(pRow.last_minute) : null;
    const mRow = lastMinute == null ? null
      : (await d.db.select<{ fair: number | null }>(paper.minutes, `book=eq.${paper.book}&minute=eq.${enc(lastMinute)}&select=fair`))[0] ?? null;
    const paperFair = mRow?.fair != null ? Number(mRow.fair) : null;
    const paperStale = lastMinute == null || now - lastMinute > CB_LIVE_STALE_MS;
    let product = CB_LIVE_PRODUCT_FALLBACK, touch: { bid: number | null; ask: number | null } = { bid: null, ask: null };
    let gbp: number | null = null, usdc: number | null = null;
    if (client) {
      try { product = await client.product(CB_LIVE_PRODUCT); } catch (e) { rep.errors.push(`product: ${msg(e)}`); }
      try { touch = await client.bestBidAsk(CB_LIVE_PRODUCT); } catch (e) { rep.errors.push(`touch: ${msg(e)}`); }
      try {
        const acc = await client.accounts();
        const av = (c: string) => acc.filter((a) => a.currency === c).reduce((s, a) => s + Number(a.available_balance?.value ?? 0), 0);
        gbp = av("GBP"); usdc = av("USDC");
        balances = venueBalances(acc, CB_LIVE_BALANCE_CCYS, now);
      } catch (e) { rep.errors.push(`accounts: ${msg(e)}`); }
    }
    const step = Number(product.base_increment), minSize = Number(product.base_min_size);
    if (product.trading_disabled || product.cancel_only) ev("product_not_trading", { trading_disabled: product.trading_disabled ?? null, cancel_only: product.cancel_only ?? null });

    // 'self''s minute: the paper rule on the executor's own record, told only which rungs the account's fills hold (judged
    // against each trip's entry price, as no fair is known yet). While the follower decides it runs as the shadow, its EMA
    // seeded once from the paper arm's; a failure there is an event, never the follower's error.
    const trips = tripsOf(fills);
    const heldKeys = new Set([...trips.values()].filter((t) => !isDust(tripHeld(t), t.entryAvg, minSize)).map((t) => rungKey(t.rungSide, t.k)));
    const prevSelf = stateRow.self ?? null;
    if (CB_LIVE_RULES[cfg.paper] || decideSelf) {
      try {
        self = await cbLiveSelfStep(d.db, now, prevSelf, cfg.paper, heldKeys, decideSelf ? null : pRow?.state?.nudge ?? null);
      } catch (e) {
        if (decideSelf) rep.errors.push(`self decision: ${msg(e)}`); else ev("shadow_error", { error: msg(e) });
        self = prevSelf && prevSelf.rule === cfg.paper ? prevSelf : null;
      }
    }
    const selfStale = !self || now - self.lastMinute > CB_LIVE_STALE_MS;
    rep.self = self ? { minute: self.lastMinute, fair: self.fair } : null;
    const fair = decideSelf ? (selfStale ? null : self!.fair) : paperFair;
    const stale = decideSelf ? selfStale : paperStale;
    const x = decideSelf ? self?.st.books[CB_LIVE_PRODUCT]?.lastX ?? null : book?.lastX ?? null;
    rep.gbpUsd = x;                                                          // the page's dollars; the rule's money is pounds

    // 3. The trips, the day's P&L and the limits.
    const today = dayOf(now), dayStart = Date.parse(`${today}T00:00:00Z`);
    for (const t of trips.values()) {
      if (t.lastFill < dayStart && tripHeld(t) <= 0) continue;
      const p = tripPnl(t, fair);
      rep.realisedTodayGbp += p.realised; rep.markedGbp += p.marked;
    }
    const lossLimit = -cfg.daily_loss_pct * cfg.capital_gbp;
    rep.lossStopped = rep.realisedTodayGbp + rep.markedGbp <= lossLimit;
    if (rep.lossStopped) ev("loss_stop", { realised: rep.realisedTodayGbp, marked: rep.markedGbp, limit: lossLimit });
    // A POST is a live row the venue was called for (a crossing refused before the call is not one).
    const postsToday = orders.filter((o) => o.mode === "live" && msOf(o.created_at) >= dayStart && !(o.state === "refused" && o.response == null)).length;
    rep.posts = postsToday;
    const govEntries = postsToday >= cfg.gov_entry_posts, govStopsOnly = postsToday >= cfg.gov_stops_only_posts;
    if (govEntries) ev("governor", { posts: postsToday, entries: false, stopsOnly: govStopsOnly });
    const tradable = !product.trading_disabled && !product.cancel_only;
    /** Why no entry may rest under a fair `f` (`st`ale or not), or null when one may: the follower's gate and 'self''s alike. */
    const gateOf = (f: number | null, st: boolean) => paused ? "paused" : !tradable ? "not_tradable" : f == null ? "dark" : st ? "stale"
      : rep.lossStopped ? "loss_stop" : govEntries ? "governor" : live && !armed ? "unarmed" : null;

    // 4. What each rung should have resting, under a decision source: its rungs, its fair and staleness, and its entry for a
    // rung not held. A `shadow` pass has no side effect (no event, no id, nothing in the report) and says why for each rung.
    type Src = { rungs: Rung[]; fair: number | null; stale: boolean; self: boolean; shadow: boolean };
    const decideRungs = (src: Src) => {
      const wants = new Map<string, Want | null>(), why = new Map<string, string>();
      const gate = gateOf(src.fair, src.stale);
      const openTrips = [...trips.values()].filter((t) => !isDust(tripHeld(t), src.fair ?? t.entryAvg, minSize));
      for (const r of src.rungs) {
        const key = rungKey(r.side, r.k);
        const set = (w: Want | null, y: string) => { wants.set(key, w); why.set(key, y); };
        const t = openTrips.find((x) => x.rungSide === r.side && x.k === r.k);
        if (paused) { set(null, "paused"); continue; }
        if (t) {
          if (!src.shadow) rep.held[key] = tripHeld(t);
          const closeSide: Side = r.side === "bid" ? "ask" : "bid";
          const qty = floorTo(tripHeld(t), step);
          // The 24-hour stop; one that came back unfilled leaves the exit resting until it is tried again an hour later.
          const tried = orders.filter((o) => o.trip === t.trip && o.leg === "stop" && o.mode === "live").map((o) => msOf(o.created_at));
          if (now >= t.firstFill + QUOTE_STOP_MS && !(tried.length && now - Math.max(...tried) < CB_LIVE_STOP_RETRY_MS)) {
            if (tried.length && !src.shadow) ev("stop_retry", { trip: t.trip, held: tripHeld(t) });
            const ref = src.fair ?? t.entryAvg;
            const px = closeSide === "ask" ? Math.floor(ref * (1 - CB_LIVE_STOP_BAND) / QUOTE_TICK) * QUOTE_TICK : Math.ceil(ref * (1 + CB_LIVE_STOP_BAND) / QUOTE_TICK) * QUOTE_TICK;
            set({ leg: "stop", rungSide: r.side, k: r.k, side: sideOf(closeSide), price: Number(px.toFixed(4)), size: qty, trip: t.trip, paperKey: null, fair: src.fair, ioc: true }, "stop");
            continue;
          }
          const cur = orders.filter((o) => o.trip === t.trip && o.leg === "exit" && o.mode === "live" && (o.state === "open" || o.state === "pending")).at(-1);
          let ruleFair = src.fair;
          if (cur && cur.fair != null && (src.fair == null || Math.abs(src.fair / cur.fair - 1) <= QUOTE_REPRICE)) ruleFair = cur.fair;
          if (ruleFair == null) {
            if (cur) set({ leg: "exit", rungSide: r.side, k: r.k, side: cur.side, price: cur.price, size: qty, trip: t.trip, paperKey: null, fair: cur.fair, ioc: false }, "exit_kept");
            else set(null, "no_exit_fair");
            continue;
          }
          const px = exitPrice(exitTicks(ruleFair, r.side), closeSide, touch);
          set({ leg: "exit", rungSide: r.side, k: r.k, side: sideOf(closeSide), price: px, size: qty, trip: t.trip, paperKey: null, fair: ruleFair, ioc: false }, "exit");
          continue;
        }
        const pe = paperEntry(r);
        if (!pe) { set(null, r.mode === "position" ? "rung_held" : r.o?.state === "rejected" ? "rung_refused" : "no_quote"); continue; }
        if (gate) { set(null, gate); continue; }
        const ek = src.self ? `self|${pe.key}` : pe.key;
        const px = pe.ticks * QUOTE_TICK, qty = rungQty(cfg.rung_gbp, px, step);
        if (qty < minSize) { set(null, "below_min"); if (!src.shadow) ev("entry_below_min", { key, qty }); continue; }
        // The follower: a paper decision refused (post-only or otherwise) is not sent again until the paper decides anew, a
        // 401/403 for 15 minutes. 'self': a post-only refusal is tried again the next turn (the paper rule re-places a refused
        // order the next minute); any other rejection waits for the rule's next decision (a fair move), a 401/403 15 minutes.
        const refusedBefore = orders.some((o) => o.paper_key === ek && o.rung_side === r.side && o.k === r.k
          && (src.self ? o.state === "rejected" : o.state === "refused" || o.state === "rejected")
          && (!isDenied(o) || now - msOf(o.created_at) < CB_LIVE_DENIED_MS));
        if (refusedBefore) { set(null, "refused_before"); continue; }
        const cur = orders.filter((o) => o.leg === "entry" && o.rung_side === r.side && o.k === r.k && o.paper_key === ek && (o.state === "open" || o.state === "pending" || o.state === "dry")).at(-1);
        set({ leg: "entry", rungSide: r.side, k: r.k, side: sideOf(r.side), price: Number(px.toFixed(4)), size: qty, trip: cur?.trip ?? (src.shadow ? "" : uuid()), paperKey: ek, fair: src.fair, ioc: false }, "quote");
      }
      return { wants, why };
    };
    // 'self' with no record (its first turn failed) still manages what the account holds: six rungs that quote nothing.
    const rungs = decideSelf ? self?.st.books[CB_LIVE_PRODUCT]?.rungs ?? newBookState(CB_LIVE_PRODUCT).rungs : book?.rungs ?? [];
    const main = decideRungs({ rungs, fair, stale, self: decideSelf, shadow: false });
    const wants = main.wants;
    for (const [k, w] of wants) rep.would[k] = w && { leg: w.leg, side: w.side, price: w.price, size: w.size };

    // 5. Each rung's resting order against what it should be: cancel what differs, then place what is missing.
    let freeGbp = gbp, freeUsdc = usdc;
    const covered = (w: Want) => {
      if (w.leg === "stop") return true;
      if (w.side === "BUY") { if (freeGbp == null) return true; if (freeGbp < w.price * w.size) return false; freeGbp -= w.price * w.size; return true; }
      if (freeUsdc == null) return true; if (freeUsdc < w.size) return false; freeUsdc -= w.size; return true;
    };
    let usdcShort = 0;
    const cancelLive = async (o: OrderRow, why: string): Promise<boolean> => {
      if (!client) return false;
      try {
        if (o.venue_order_id) await client.cancel([o.venue_order_id]);
        rep.cancelled++;
        const v = o.venue_order_id ? await client.getOrder(o.venue_order_id) : null;
        const done = !!v && CB_DONE.includes(v.status);
        const before = o.filled_size, filled = v ? Number(v.filled_size ?? 0) : o.filled_size;
        await save(o, { state: done ? rowState(v!.status) : "cancelling", reason: why, filled_size: filled });
        if (!done) { ev("cancel_unconfirmed", { client_order_id: o.client_order_id, status: v?.status ?? null }); return false; }
        // What the order held is free again for this turn's placements.
        const left = Math.max(0, o.base_size - filled);
        if (o.side === "SELL" && freeUsdc != null) freeUsdc += left;
        if (o.side === "BUY" && freeGbp != null) freeGbp += left * o.price;
        return filled === before;
      } catch (e) { rep.errors.push(`cancel ${o.client_order_id}: ${msg(e)}`); return false; }
    };
    // An entry or a top-up is live only when armed; an exit or a stop belongs to a live trip, so it is live (trips come from
    // live fills alone). A resting order of the other mode is never a rung's order: armed, a dry row is withdrawn and the live
    // order placed in the same turn (2026-10-29 20:51, the go: the dry rows matched the paper's decisions and nothing went out
    // for two turns); back in dry-run, a live entry is cancelled.
    const wantMode = (w: Want): OrderRow["mode"] => (w.leg === "exit" || w.leg === "stop" ? "live" : armed ? "live" : "dry_run");
    // Coinbase refused with 401 or 403 this turn: nothing more is sent until the next (2026-10-29 20:54, "User is not allowed to
    // buy crypto" on all four POSTs).
    let denied: string | null = null;
    const place = async (w: Want) => {
      const mode = wantMode(w);
      const id = uuid(), endMs = w.ioc ? null : now + (w.leg === "convert" ? CB_LIVE_CONVERT_MS : CB_LIVE_GTD_MS);
      const body = orderBody({ client_order_id: id, side: w.side, price: w.price, size: w.size, endMs, ioc: w.ioc }, product);
      const row: OrderRow = { client_order_id: id, venue_order_id: null, mode, leg: w.leg, trip: w.leg === "convert" ? null : w.leg === "entry" ? id : w.trip, rung_side: w.leg === "convert" ? null : w.rungSide,
        k: w.leg === "convert" ? null : w.k, side: w.side, price: w.price, base_size: w.size, end_time: endMs == null ? null : iso(endMs), state: mode === "live" ? "pending" : "dry",
        paper_key: w.paperKey, fair: w.fair, filled_size: 0, avg_price: null, fees_gbp: 0, reason: null, request: body, response: null, created_at: iso(now), updated_at: iso(now) };
      if (!w.ioc && crosses(w.side, w.price, touch)) {
        // 'self' tries a refused entry again each turn: while the touch still crosses the same price, the refusal already
        // written stands for it (no row a minute).
        const last = decideSelf && w.leg === "entry" ? orders.filter((o) => o.rung_side === w.rungSide && o.k === w.k).at(-1) : undefined;
        if (last && last.state === "refused" && last.response == null && last.leg === "entry" && Math.abs(last.price - w.price) < 1e-9) return;
        row.state = "refused"; row.reason = "the touch it met shows it crossing: post-only, not sent";
        await d.db.insert(T.orders, [row], false); orders.push(row);
        ev("refused_crossing", { leg: w.leg, side: w.side, price: w.price, touch }); return;
      }
      if (mode === "dry_run") { await d.db.insert(T.orders, [row], false); orders.push(row); return; }
      if (govStopsOnly && w.leg !== "stop") { ev("governor_skip", { leg: w.leg }); return; }
      if (denied) { ev("denied_skip", { leg: w.leg, side: w.side }); return; }
      await d.db.insert(T.orders, [row], false); orders.push(row);              // the claim, before the venue is called
      rep.placed++; rep.posts++;
      try {
        const res = await client!.create(body);
        if (res.success && res.success_response?.order_id) await save(row, { venue_order_id: res.success_response.order_id, state: "open", response: res });
        else {
          const why = res.error_response?.new_order_failure_reason || res.error_response?.preview_failure_reason || res.error_response?.error || "UNKNOWN";
          await save(row, { state: why === "INVALID_LIMIT_PRICE_POST_ONLY" ? "refused" : "rejected", reason: why, response: res });
          ev("venue_refused", { leg: w.leg, reason: why });
        }
      } catch (e) {
        if (e instanceof CbHttpError && e.status >= 400 && e.status < 500) {
          // A 4xx with Coinbase's error body is its answer: the order was refused, not lost (2026-10-29 20:54: four 403s were
          // left pending as unknowns). 401 and 403 stop this turn's placing and go to the errors box.
          const reason = `http ${e.status}: ${msg(e).replace(/^coinbase POST \S+ → \d+: /, "")}`;
          await save(row, { state: "rejected", reason, response: { status: e.status } });
          ev("venue_rejected", { leg: w.leg, side: w.side, status: e.status, reason: reason.slice(0, 200) });
          if (e.status === 401 || e.status === 403 || /PERMISSION_DENIED/.test(reason)) {
            denied = reason;
            rep.errors.push(`coinbase refused to place (${reason.slice(0, 160)}): nothing more is sent this turn`);
          }
          return;
        }
        // A lost reply, a timeout or a 5xx is an unknown, not a rejection: the row stays pending and is reconciled by its client id.
        await save(row, { reason: `unknown: ${msg(e)}` });
        rep.errors.push(`create ${id}: ${msg(e)}`);
      }
    };

    for (const r of rungs) {
      const key = rungKey(r.side, r.k), w = wants.get(key) ?? null;
      const cur = orders.filter((o) => o.rung_side === r.side && o.k === r.k && (o.state === "open" || o.state === "pending" || o.state === "cancelling" || o.state === "dry")).at(-1) ?? null;
      if (cur?.state === "cancelling" || (cur?.state === "pending" && cur.mode === "live")) {
        if (cur.state === "cancelling" && client) await cancelLive(cur, cur.reason ?? "cancel");
        continue;                                                              // nothing new on a rung until its order is final
      }
      // An entry is the paper decision at its price (its size was fixed when it was placed); an exit its price and what is left.
      // 'self''s entry is its price alone: a re-decision at the same price (or the switch from the follower) moves nothing.
      const same = cur && w && cur.mode === wantMode(w) && cur.leg === w.leg && cur.side === w.side && Math.abs(cur.price - w.price) < 1e-9 &&
        (w.leg === "entry" ? decideSelf || cur.paper_key === w.paperKey : Math.abs(cur.base_size - cur.filled_size - w.size) < 1e-9);
      const expiring = cur && cur.mode === "live" && cur.end_time != null && msOf(cur.end_time) - now < CB_LIVE_REFRESH_MS;
      if (cur && same && !expiring) continue;
      if (cur) {
        if (cur.mode === "dry_run") await save(cur, { state: "dry_withdrawn", reason: armed ? "armed" : w ? "replaced" : "withdrawn" });
        else if (!(await cancelLive(cur, !w ? "withdrawn" : expiring && same ? "refresh" : w && wantMode(w) === "dry_run" ? "dry-run" : "replaced"))) continue;
      }
      if (!w) continue;
      if (!covered(w)) {
        if (w.leg === "entry" && w.side === "SELL") usdcShort += w.size;
        ev("skip_inventory", { key, leg: w.leg, side: w.side, need: w.side === "SELL" ? w.size : w.size * w.price, have: w.side === "SELL" ? freeUsdc : freeGbp });
        continue;
      }
      await place(w);
    }

    // 6. Live and paused alike: an order on no rung (a top-up) is cancelled under the pause; an armed account tops its USDC up.
    // A top-up of the other mode is not this mode's: armed, a dry one is withdrawn; disarmed, a live one is cancelled.
    const convMode: OrderRow["mode"] = armed ? "live" : "dry_run";
    for (const o of orders.filter((o) => o.leg === "convert" && (o.state === "open" || o.state === "pending" || o.state === "dry" || o.state === "cancelling"))) {
      if (o.mode === convMode && !paused) continue;
      if (o.mode === "dry_run") await save(o, { state: "dry_withdrawn", reason: armed ? "armed" : "withdrawn" });
      else if (o.state !== "pending") await cancelLive(o, paused ? "global pause" : "disarmed");
    }
    const convOpen = orders.filter((o) => o.leg === "convert" && o.mode === convMode && (o.state === "open" || o.state === "pending" || o.state === "dry" || o.state === "cancelling"));
    const convDenied = orders.some((o) => o.leg === "convert" && o.mode === "live" && isDenied(o) && now - msOf(o.created_at) < CB_LIVE_DENIED_MS);
    if (!paused && usdcShort > 0 && !convOpen.length && !convDenied && touch.bid != null) {
      const spent = orders.filter((o) => o.leg === "convert" && msOf(o.created_at) >= dayStart && o.mode === (armed ? "live" : "dry_run")).reduce((s, o) => s + convertSpentGbp(o), 0);
      // The asks' shortfall and 2 % over, at most what the pounds the bids leave free and the day's cap allow.
      const px = touch.bid;
      const room = Math.min(cfg.convert_max_gbp_day - spent, freeGbp ?? Infinity) / px;
      const size = floorTo(Math.min(Math.ceil(usdcShort * 1.02 / step) * step, room), step);
      if (size >= minSize && size * px >= CB_LIVE_DUST_GBP && (armed || (cfg.dry_run && !hasLiveBook))) {
        await place({ leg: "convert", rungSide: "bid", k: 0, side: "BUY", price: px, size, trip: "", paperKey: null, fair, ioc: false });
      } else ev("convert_skipped", { short: usdcShort, spent, cap: cfg.convert_max_gbp_day, freeGbp });
    }
    // 7. The shadow (0182), only while the follower decides: what 'self' would rest on each rung, beside what the follower
    // wanted and what rests after this turn, one row a rung a turn, so the two can be compared before the switch. It moves no
    // order; its failure is an event.
    if (!decideSelf && self) {
      try {
        const sh = decideRungs({ rungs: self.st.books[CB_LIVE_PRODUCT].rungs, fair: selfStale ? null : self.fair, stale: selfStale, self: true, shadow: true });
        const minute = iso(Math.floor(now / M) * M), out: Record<string, unknown>[] = [];
        for (const r of newBookState(CB_LIVE_PRODUCT).rungs) {
          const key = rungKey(r.side, r.k), sw = sh.wants.get(key) ?? null, pw = wants.get(key) ?? null;
          const rest = orders.filter((o) => o.rung_side === r.side && o.k === r.k && (o.state === "open" || o.state === "pending" || o.state === "cancelling" || o.state === "dry")).at(-1) ?? null;
          out.push({
            minute, at: iso(now), rung_side: r.side, k: r.k,
            self_leg: sw?.leg ?? null, self_side: sw?.side ?? null, self_price: sw?.price ?? null, self_size: sw?.size ?? null, self_why: sh.why.get(key) ?? "no_rung",
            self_crosses: sw && !sw.ioc ? crosses(sw.side, sw.price, touch) : null, self_fair: self.fair, self_minute: iso(self.lastMinute),
            paper_leg: pw?.leg ?? null, paper_side: pw?.side ?? null, paper_price: pw?.price ?? null, paper_size: pw?.size ?? null, paper_why: main.why.get(key) ?? "no_paper_rung",
            paper_fair: paperFair, paper_minute: lastMinute == null ? null : iso(lastMinute),
            rested_leg: rest?.leg ?? null, rested_side: rest?.side ?? null, rested_price: rest?.price ?? null, rested_mode: rest?.mode ?? null, rested_state: rest?.state ?? null,
          });
        }
        await d.db.upsert(CB_LIVE_SHADOW_TABLE, out, "minute,rung_side,k");
      } catch (e) { ev("shadow_error", { error: msg(e) }); }
    }
    if (evs.length) await d.db.insert(T.events, evs, false);
    return rep;
  } catch (e) {
    rep.errors.push(msg(e));
    return rep;
  } finally {
    try {
      const key = faultKey(rep.errors);
      rep.report = reportDue(stateRow.fault ?? null, key, now);
      const fault = !key ? undefined : rep.report ? { key, at: now } : stateRow.fault;
      // The account as this turn read it (`balances`); a turn that could not read it keeps the last reading, its `at` saying when.
      const bal = balances ?? stateRow.balances ?? null;
      // 'self''s record, or the last one when this turn did not reach it.
      const keep = self ?? stateRow.self ?? null;
      await d.db.upsert(CB_LIVE_TABLES.state, [{ id: 1, state: { fault, lastReport: { ...rep, events: rep.events.slice(0, 50) }, ...(bal ? { balances: bal } : {}), ...(keep ? { self: keep } : {}) }, updated_at: iso(now), last_error: rep.errors.length ? rep.errors.join(" | ").slice(0, 500) : null }], "id");
    } catch { /* the lease still expires */ }
    try { await d.db.update("agent_locks", `name=eq.${CB_LIVE_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(now), holder: null }); } catch { /* it expires */ }
  }
}

// ------------------------------------------------------------------------------------------------------------ the page

/** Its page's DAYS go back this far, its ORDERS list this many of the newest, its ROUND TRIPS this many: PR5 LIVE's page's. */
export const CB_LIVE_PAGE_DAYS = 60;
export const CB_LIVE_PAGE_ROWS = 50;
export const CB_LIVE_PAGE_TRIPS = 20;
/** The columns of a live order its row and page read for every order, and for the newest, what says why each ended so. */
export const CB_LIVE_ORDER_COLUMNS = "id,client_order_id,leg,trip,rung_side,k,side,price,base_size,filled_size,avg_price,state,created_at";
export const CB_LIVE_RECENT_COLUMNS = `${CB_LIVE_ORDER_COLUMNS},reason`;

/** A live order as the page reads it. */
export type CbLivePageOrder = Pick<OrderRow, "client_order_id" | "leg" | "trip" | "rung_side" | "k" | "side" | "price" | "base_size" | "filled_size" | "avg_price" | "state" | "created_at">
  & { id: number; reason?: string | null };

const IN_FLIGHT: ReadonlyArray<OrderRow["state"]> = ["pending", "open", "cancelling"];
const D = 86400e3;

/** Pure: the realised pounds of every trip the fills make (`tripPnl`), the figure DAYS splits by the day. */
const realisedOf = (fills: FillRow[]) => [...tripsOf(fills).values()].reduce((a, t) => a + tripPnl(t, null).realised, 0);

/**
 * Pure: a live order in the words PR5 LIVE's page uses (`orderStateText`, its state pills): resting is "new" (open), resting
 * with a part filled "partially_filled", a good-til-date that ran out "cancelled" as a cancel is; and why it is where it is,
 * or null for an order resting or filled as sent.
 */
export function cbLiveOrderView(o: CbLivePageOrder) {
  const filled = Number(o.filled_size) || 0, size = Number(o.base_size) || 0;
  const state = o.state === "open" || o.state === "cancelling" ? (filled > 0 ? "partially_filled" : "new")
    : o.state === "expired" ? "cancelled" : o.state;
  const reason = o.state === "pending" ? "sent; the venue's answer is read next turn"
    : o.state === "cancelling" ? `cancel sent (${o.reason || "no reason recorded"}); not confirmed yet`
    : (o.state === "cancelled" || o.state === "expired") && filled > 0 && filled < size
      ? `filled in part; the rest ${o.state === "expired" ? "ran out at its good-til-date" : "was cancelled"}` : null;
  return {
    id: o.id, ts: o.created_at, book: CB_LIVE_PRODUCT, side: o.rung_side, k: o.k == null ? null : Number(o.k), leg: o.leg,
    venueSide: String(o.side).toLowerCase(), price: Number(o.price), base: size, state, filledBase: filled,
    avgPrice: o.avg_price == null ? null : Number(o.avg_price), reason,
  };
}

/**
 * Pure: "Stablecoin quotes USDC/GBP"'s figures and its page, in the shape of PR5 LIVE's (`quotesLiveDetail` in index.ts), so the
 * same page draws both (Davies, 2026-10-29: "网页中live的coinbase策略子页面打不开，点了没反应"). Everything is from its own record:
 *   * Trips from the fills read back from Coinbase (`tripsOf`); one is still held while its remainder is not dust (`isDust`, at
 *     fair, as the executor judges it), and is a ROUND TRIP once it has exited and holds no more than dust.
 *   * The coins (USDC) are what every live fill bought less what it sold, its top-up conversions included, and they cost what
 *     the conversions paid (fee included) and what the trips holding paid or took in: valued at the arm's fair (else its last
 *     print), value less cost is UNREALIZED, the held trips' marks and the conversions' own. DEPLOYED is that value and the
 *     pounds resting in live buys.
 *   * Its pounds are its capital as its own record moves them (the fills' pounds and fees), not a balance read from the venue.
 *   * DAYS: each UTC day from its first live order, the orders sent (an order refused at the touch it met, never sent, is not
 *     one), the entries that filled, the round trips that closed and what the trips realised that day; the days add up to
 *     REALIZED.
 *   * ORDERS: the newest, its top-up conversions among them (the page lists them apart, CONVERSIONS), less what the venue refused (a post-only
 *     price that crossed, the 403s of its first night) or the executor refused before sending, less a cancel that filled
 *     nothing, and less the orders of a round trip already closed (ROUND TRIPS has them).
 * TODAY is the figure its daily loss stop reads (the trips touched today, realised and marked), as PR5's is.
 */
export function cbLiveDetail(input: {
  capitalGbp: number; orders: CbLivePageOrder[]; recent: CbLivePageOrder[]; notSent: ReadonlySet<number>; fills: FillRow[];
  book: BookState | null; fair: number | null; now: number; at: string | null; minSize?: number;
}) {
  const { now, fills } = input;
  const minSize = input.minSize ?? Number(CB_LIVE_PRODUCT_FALLBACK.base_min_size);
  const lastPrice = input.book?.lastPrint?.ticks != null ? Number((input.book.lastPrint.ticks * QUOTE_TICK).toFixed(6)) : null;
  const mark = input.fair ?? lastPrice;
  const dayStart = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const all = [...tripsOf(fills).values()];
  const stopped = new Set(fills.filter((f) => f.leg === "stop" && f.trip).map((f) => f.trip!));
  const open = all.filter((t) => !isDust(tripHeld(t), input.fair ?? t.entryAvg, minSize));
  const closed = all.filter((t) => !open.includes(t) && t.exitQty > 0).sort((a, b) => b.lastFill - a.lastFill || b.firstFill - a.firstFill);
  const pnl = new Map(all.map((t) => [t.trip, tripPnl(t, input.fair)]));
  let realised = 0, today = 0, fees = 0;
  for (const t of all) {
    const p = pnl.get(t.trip)!;
    realised += p.realised; fees += t.fees;
    if (t.lastFill >= dayStart || tripHeld(t) > 0) today += p.realised + p.marked;
  }
  // The coins: what every fill bought less what it sold; their cost, the conversions' pounds and the trips' signed holdings.
  const conv = fills.filter((f) => f.leg === "convert");
  const coins = fills.reduce((a, f) => a + (f.side === "BUY" ? 1 : -1) * Number(f.size), 0);
  const cost = conv.reduce((a, f) => a + (f.side === "BUY" ? 1 : -1) * Number(f.size) * Number(f.price) + (Number(f.commission) || 0), 0)
    + all.reduce((a, t) => a + (t.rungSide === "bid" ? 1 : -1) * (t.entryQty - t.exitQty) * t.entryAvg, 0);
  const coinsValue = mark == null ? cost : coins * mark;
  const unrealised = mark == null ? 0 : coinsValue - cost;
  const restingBuys = input.orders.filter((o) => o.side === "BUY" && IN_FLIGHT.includes(o.state))
    .reduce((a, o) => a + Math.max(0, Number(o.base_size) - Number(o.filled_size || 0)) * Number(o.price), 0);
  const pounds = input.capitalGbp + fills.reduce((a, f) => a + (f.side === "SELL" ? 1 : -1) * Number(f.size) * Number(f.price) - (Number(f.commission) || 0), 0);

  const onRung = (o: CbLivePageOrder, side: Side, k: number) => o.rung_side === side && Number(o.k) === k;
  const rungs = (input.book?.rungs ?? []).map((r) => {
    const t = open.filter((x) => x.rungSide === r.side && x.k === r.k).at(-1) ?? null;
    const o = input.orders.filter((x) => onRung(x, r.side, r.k) && IN_FLIGHT.includes(x.state)).at(-1) ?? null;
    const held = t && tripHeld(t), dir = r.side === "bid" ? 1 : -1;
    return {
      book: CB_LIVE_PRODUCT, side: r.side, k: r.k,
      order: o && { id: o.id, leg: o.leg, price: Number(o.price), state: cbLiveOrderView(o).state },
      held: t && held != null ? {
        base: held, avgEntry: t.entryAvg, since: iso(t.firstFill), costGbp: held * t.entryAvg, valueGbp: held * (mark ?? t.entryAvg),
        unrealisedGbp: mark == null ? null : dir * held * (mark - t.entryAvg),
      } : null,
      realisedGbp: all.filter((x) => x.rungSide === r.side && x.k === r.k).reduce((a, x) => a + pnl.get(x.trip)!.realised, 0),
    };
  });

  // DAYS, newest first, from the first live order's day.
  const sent = input.orders.filter((o) => !input.notSent.has(o.id));
  const firstMs = Math.min(...input.orders.map((o) => msOf(o.created_at)), ...fills.map((f) => msOf(f.trade_time)));
  const days = [];
  const upTo = (t: number) => realisedOf(fills.filter((f) => msOf(f.trade_time) < t));
  for (let d = dayStart; Number.isFinite(firstMs) && d >= Math.floor(firstMs / D) * D && days.length < CB_LIVE_PAGE_DAYS; d -= D) {
    const inDay = (ms: number) => ms >= d && ms < d + D;
    const shut = closed.filter((t) => inDay(t.lastFill));
    days.push({
      day: iso(d).slice(0, 10), today: d === dayStart,
      orders: sent.filter((o) => inDay(msOf(o.created_at))).length,
      fills: new Set(fills.filter((f) => f.leg === "entry" && inDay(msOf(f.trade_time))).map((f) => f.client_order_id)).size,
      trips: shut.length, won: shut.filter((t) => pnl.get(t.trip)!.realised > 0).length,
      realisedGbp: upTo(d + D) - upTo(d),
    });
  }

  const shutIds = new Set(closed.map((t) => t.trip));
  const orders = input.recent
    .filter((o) => o.state !== "rejected" && o.state !== "refused" && !input.notSent.has(o.id) && !(o.trip && shutIds.has(o.trip)))
    .filter((o) => !((o.state === "cancelled" || o.state === "expired") && !(Number(o.filled_size) > 0)))
    .map(cbLiveOrderView);
  return {
    realisedGbp: realised, unrealisedGbp: unrealised, todayGbp: today, costGbp: cost, valueGbp: coinsValue + restingBuys, feesGbp: fees, heldRungs: open.length,
    detail: {
      books: [{
        book: CB_LIVE_PRODUCT, lastPrice, fair: input.fair, index: null, realisedGbp: realised,
        trips: closed.length, won: closed.filter((t) => pnl.get(t.trip)!.realised > 0).length,
      }],
      rungs,
      inventory: {
        at: input.at,
        assets: [
          { asset: "GBP", amount: pounds, gbp: pounds, price: null, priceFrom: null, costGbp: null, unrealisedGbp: null },
          { asset: "USDC", amount: coins, gbp: mark == null ? null : coinsValue, price: mark, priceFrom: input.fair != null ? "fair" : mark != null ? "last trade" : null, costGbp: cost, unrealisedGbp: mark == null ? null : unrealised },
        ],
      },
      days,
      trips: closed.slice(0, CB_LIVE_PAGE_TRIPS).map((t) => ({
        book: CB_LIVE_PRODUCT, side: t.rungSide, k: t.k, tEntry: iso(t.firstFill), tExit: iso(t.lastFill), entry: t.entryAvg, exit: t.exitAvg, qty: t.entryQty,
        how: stopped.has(t.trip) ? "stop" : "exit", feesGbp: t.fees, pnlGbp: pnl.get(t.trip)!.realised,
      })),
      tripCount: closed.length, tripsWon: closed.filter((t) => pnl.get(t.trip)!.realised > 0).length,
      orders,
    },
  };
}

/**
 * LIVE's row of it and its page (`cbLive` on the dashboard): from its own tables alone, null-safe, never a call to Coinbase. In
 * pounds (its capital is £120) with GBP/USD (`gbpUsd`, the paper arm's last rate) for the page's dollars. `tradedLive` is true
 * from its first live order; the page shows the row from then, or while it is armed. Its figures and its page are one walk
 * (`cbLiveDetail`), so the page cannot show a figure the row does not add up to.
 */
export async function readCbLive(db: Db, now: number) {
  const T = CB_LIVE_TABLES;
  try {
    const cfg = (await db.select<CbLiveConfig>(T.config, "id=eq.1&select=*"))[0];
    if (!cfg) return null;
    const st = (await db.select<{ updated_at: string | null; last_error?: string | null; state: { lastReport?: CbLiveReport; balances?: VenueBalances } }>(T.state, "id=eq.1&select=updated_at,last_error,state"))[0] ?? null;
    const [live, recent, notSent, fills] = await Promise.all([
      db.selectAll<CbLivePageOrder>(T.orders, `mode=eq.live&select=${CB_LIVE_ORDER_COLUMNS}&order=id.asc`),
      db.select<CbLivePageOrder>(T.orders, `mode=eq.live&select=${CB_LIVE_RECENT_COLUMNS}&order=id.desc&limit=${CB_LIVE_PAGE_ROWS}`),
      // Refused at the touch it met and never sent (no venue answer): not a POST, not one of the day's orders.
      db.select<{ id: number }>(T.orders, "mode=eq.live&state=eq.refused&response=is.null&select=id&order=id.asc"),
      db.selectAll<FillRow>(T.fills, "select=*&order=entry_id.asc"),
    ]);
    const paper = CB_LIVE_PAPERS[cfg.paper];
    const pRow = paper ? (await db.select<{ state: { books?: Record<string, BookState> }; last_minute: string | null }>(paper.state, "id=eq.1&select=state,last_minute"))[0] : undefined;
    const book = pRow?.state?.books?.[paper!.book] ?? null;
    const x = book?.lastX ?? null;
    const fair = pRow?.last_minute
      ? (await db.select<{ fair: number | null }>(paper!.minutes, `book=eq.${paper!.book}&minute=eq.${enc(msOf(pRow.last_minute))}&select=fair`))[0]?.fair ?? null : null;
    const v = cbLiveDetail({ capitalGbp: Number(cfg.capital_gbp), orders: live, recent, notSent: new Set(notSent.map((r) => Number(r.id))), fills, book,
      fair: fair == null ? null : Number(fair), now, at: st?.updated_at ?? null });
    const updated = st?.updated_at ? msOf(st.updated_at) : null;
    return {
      name: CB_LIVE_NAME, paper: cfg.paper, dryRun: cfg.dry_run, armed: !cfg.dry_run && cfg.armed_at != null, armedAt: cfg.armed_at,
      tradedLive: live.length > 0, running: updated != null && now - updated < 3 * M, lagMinutes: updated == null ? null : Math.round((now - updated) / M),
      lastError: st?.last_error ?? null,
      capitalGbp: Number(cfg.capital_gbp), rungGbp: Number(cfg.rung_gbp), gbpUsd: x,
      // Its daily loss stop in pounds (the config's share of its capital), beside TODAY as PR5 LIVE's page shows its own.
      lossStopGbp: -Number(cfg.daily_loss_pct) * Number(cfg.capital_gbp),
      realisedGbp: v.realisedGbp, unrealisedGbp: v.unrealisedGbp, todayGbp: v.todayGbp, costGbp: v.costGbp, valueGbp: v.valueGbp, feesGbp: v.feesGbp, heldRungs: v.heldRungs,
      openOrders: live.filter((o) => IN_FLIGHT.includes(o.state)).length,
      lossStopped: !!st?.state?.lastReport?.lossStopped,
      detail: v.detail,
      // The venue's own balances as the last turn that could read them saw them (the LIVE pages' INVENTORY; Davies, 2026-10-29).
      balances: st?.state?.balances ?? null,
    };
  } catch {
    return null;
  }
}
