// "Stablecoin quotes USDC/GBP" on LIVE: "Stablecoin quotes with Euros - 2"'s decisions, carried out order for order with real
// money on Coinbase Advanced Trade (migration 0177; Davies, 2026-10-29: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线",
// then "目前没有太多钱，我刚往我这个coinbase账户转了120磅，先把"with Euros - 2"用120磅资金上限，上线后live策略名字叫Stablecoin quotes USDC/GBP").
// Its capital is £120 in pounds: six rungs of £20 on USDC-GBP, the three bids from GBP and the three asks from USDC.
// BUILT INERT: its config row is `dry_run` true and `armed_at` null, and only Davies arms it, in the conversation where he
// says go (docs/agents/reviews/2026-10-29-cb-live-design.md has the go statement, its undo and his checklist). Modelled on
// PR5 LIVE's executor (quotes_live.ts), smaller: one book, USDC-GBP.
//
// WHAT IT EXECUTES: a paper arm's decisions, and none of its own. The arm is a row of `CB_LIVE_PAPERS` named by the config
// (`paper`, "coinbasenudge" by default), so a better rule is a new paper arm and a one-word config change, not a change here.
// Every minute, after the arm has decided its minute, the executor reads the arm's state (each rung's resting order, the
// rule's `stepMinute` book) and its newest minute record (the fair the minute was decided on), and for each of the six rungs:
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
  CB_DONE, cbClientFromEnv, type CbCreateBody, type CbFill, type CbOrder, type CbOrderStatus, type CbProductInfo, type CbSide,
} from "../_shared/coinbase.ts";
import type { Db } from "./db.ts";
import { exitTicks, QUOTE_REPRICE, QUOTE_STOP_MS, QUOTE_TICK, type BookState, type Rung, type Side } from "./quotes.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

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
/** The arm's newest decided minute older than this: no entries. */
export const CB_LIVE_STALE_MS = 4 * M;
/** The 24-hour stop's IOC: at most this far through fair. */
export const CB_LIVE_STOP_BAND = 0.005;
/** A stop that came back unfilled is tried again this much later. */
export const CB_LIVE_STOP_RETRY_MS = H;
/** A USDC top-up rests this long. */
export const CB_LIVE_CONVERT_MS = 30 * M;
/** Fills older than this are not read back into the turn: the 24-hour stop closes every trip well inside it. */
export const CB_LIVE_TRIP_WINDOW_MS = 7 * DAY;
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

export type CbLiveConfig = {
  id: number; paper: string; dry_run: boolean; armed_at: string | null; rung_gbp: number; capital_gbp: number; daily_loss_pct: number;
  gov_entry_posts: number; gov_stops_only_posts: number; convert_max_gbp_day: number;
};
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
  skipped?: string; mode: "dry_run" | "live" | "wind_down" | "paused"; armed: boolean; posts: number; placed: number; cancelled: number; would: Record<string, unknown>;
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
  let stateRow: { fault?: { key: string; at: number } } = {};
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

    // 2. The paper arm, the product, the touch and the account.
    const pRow = (await d.db.select<{ state: { books?: Record<string, BookState> }; last_minute: string | null }>(paper.state, "id=eq.1&select=state,last_minute"))[0];
    const book = pRow?.state?.books?.[paper.book] ?? null;
    const lastMinute = pRow?.last_minute ? msOf(pRow.last_minute) : null;
    const mRow = lastMinute == null ? null
      : (await d.db.select<{ fair: number | null }>(paper.minutes, `book=eq.${paper.book}&minute=eq.${enc(lastMinute)}&select=fair`))[0] ?? null;
    const fair = mRow?.fair != null ? Number(mRow.fair) : null;
    const stale = lastMinute == null || now - lastMinute > CB_LIVE_STALE_MS + M;
    const x = book?.lastX ?? null;
    rep.gbpUsd = x;                                                          // the page's dollars; the rule's money is pounds
    let product = CB_LIVE_PRODUCT_FALLBACK, touch: { bid: number | null; ask: number | null } = { bid: null, ask: null };
    let gbp: number | null = null, usdc: number | null = null;
    if (client) {
      try { product = await client.product(CB_LIVE_PRODUCT); } catch (e) { rep.errors.push(`product: ${msg(e)}`); }
      try { touch = await client.bestBidAsk(CB_LIVE_PRODUCT); } catch (e) { rep.errors.push(`touch: ${msg(e)}`); }
      try {
        const acc = await client.accounts();
        const av = (c: string) => acc.filter((a) => a.currency === c).reduce((s, a) => s + Number(a.available_balance?.value ?? 0), 0);
        gbp = av("GBP"); usdc = av("USDC");
      } catch (e) { rep.errors.push(`accounts: ${msg(e)}`); }
    }
    const step = Number(product.base_increment), minSize = Number(product.base_min_size);
    if (product.trading_disabled || product.cancel_only) ev("product_not_trading", { trading_disabled: product.trading_disabled ?? null, cancel_only: product.cancel_only ?? null });

    // 3. The trips, the day's P&L and the limits.
    const trips = tripsOf(fills);
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
    const entriesOk = !paused && tradable && fair != null && !stale && !rep.lossStopped && !govEntries && (live ? armed : true);

    // 4. What each rung should have resting.
    const openTrips = [...trips.values()].filter((t) => !isDust(tripHeld(t), fair ?? t.entryAvg, minSize));
    const wants = new Map<string, Want | null>();
    for (const r of book?.rungs ?? []) {
      const key = rungKey(r.side, r.k);
      const t = openTrips.find((x) => x.rungSide === r.side && x.k === r.k);
      if (paused) { wants.set(key, null); continue; }
      if (t) {
        rep.held[key] = tripHeld(t);
        const closeSide: Side = r.side === "bid" ? "ask" : "bid";
        const qty = floorTo(tripHeld(t), step);
        // The 24-hour stop; one that came back unfilled leaves the exit resting until it is tried again an hour later.
        const tried = orders.filter((o) => o.trip === t.trip && o.leg === "stop" && o.mode === "live").map((o) => msOf(o.created_at));
        if (now >= t.firstFill + QUOTE_STOP_MS && !(tried.length && now - Math.max(...tried) < CB_LIVE_STOP_RETRY_MS)) {
          if (tried.length) ev("stop_retry", { trip: t.trip, held: tripHeld(t) });
          const ref = fair ?? t.entryAvg;
          const px = closeSide === "ask" ? Math.floor(ref * (1 - CB_LIVE_STOP_BAND) / QUOTE_TICK) * QUOTE_TICK : Math.ceil(ref * (1 + CB_LIVE_STOP_BAND) / QUOTE_TICK) * QUOTE_TICK;
          wants.set(key, { leg: "stop", rungSide: r.side, k: r.k, side: sideOf(closeSide), price: Number(px.toFixed(4)), size: qty, trip: t.trip, paperKey: null, fair, ioc: true });
          continue;
        }
        const cur = orders.filter((o) => o.trip === t.trip && o.leg === "exit" && o.mode === "live" && (o.state === "open" || o.state === "pending")).at(-1);
        let ruleFair = fair;
        if (cur && cur.fair != null && (fair == null || Math.abs(fair / cur.fair - 1) <= QUOTE_REPRICE)) ruleFair = cur.fair;
        if (ruleFair == null) { if (cur) wants.set(key, { leg: "exit", rungSide: r.side, k: r.k, side: cur.side, price: cur.price, size: qty, trip: t.trip, paperKey: null, fair: cur.fair, ioc: false }); else wants.set(key, null); continue; }
        const px = exitPrice(exitTicks(ruleFair, r.side), closeSide, touch);
        wants.set(key, { leg: "exit", rungSide: r.side, k: r.k, side: sideOf(closeSide), price: px, size: qty, trip: t.trip, paperKey: null, fair: ruleFair, ioc: false });
        continue;
      }
      const pe = paperEntry(r);
      if (!pe || !entriesOk) { wants.set(key, null); continue; }
      const px = pe.ticks * QUOTE_TICK, qty = rungQty(cfg.rung_gbp, px, step);
      if (qty < minSize) { wants.set(key, null); ev("entry_below_min", { key, qty }); continue; }
      const refusedBefore = orders.some((o) => o.paper_key === pe.key && o.rung_side === r.side && o.k === r.k && (o.state === "refused" || o.state === "rejected"));
      if (refusedBefore) { wants.set(key, null); continue; }
      const cur = orders.filter((o) => o.leg === "entry" && o.rung_side === r.side && o.k === r.k && o.paper_key === pe.key && (o.state === "open" || o.state === "pending" || o.state === "dry")).at(-1);
      wants.set(key, { leg: "entry", rungSide: r.side, k: r.k, side: sideOf(r.side), price: Number(px.toFixed(4)), size: qty, trip: cur?.trip ?? uuid(), paperKey: pe.key, fair, ioc: false });
    }
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
    // live fills alone).
    const place = async (w: Want) => {
      const mode: OrderRow["mode"] = w.leg === "exit" || w.leg === "stop" ? "live" : armed ? "live" : "dry_run";
      const id = uuid(), endMs = w.ioc ? null : now + (w.leg === "convert" ? CB_LIVE_CONVERT_MS : CB_LIVE_GTD_MS);
      const body = orderBody({ client_order_id: id, side: w.side, price: w.price, size: w.size, endMs, ioc: w.ioc }, product);
      const row: OrderRow = { client_order_id: id, venue_order_id: null, mode, leg: w.leg, trip: w.leg === "convert" ? null : w.leg === "entry" ? id : w.trip, rung_side: w.leg === "convert" ? null : w.rungSide,
        k: w.leg === "convert" ? null : w.k, side: w.side, price: w.price, base_size: w.size, end_time: endMs == null ? null : iso(endMs), state: mode === "live" ? "pending" : "dry",
        paper_key: w.paperKey, fair: w.fair, filled_size: 0, avg_price: null, fees_gbp: 0, reason: null, request: body, response: null, created_at: iso(now), updated_at: iso(now) };
      if (!w.ioc && crosses(w.side, w.price, touch)) {
        row.state = "refused"; row.reason = "the touch it met shows it crossing: post-only, not sent";
        await d.db.insert(T.orders, [row], false); orders.push(row);
        ev("refused_crossing", { leg: w.leg, side: w.side, price: w.price, touch }); return;
      }
      if (mode === "dry_run") { await d.db.insert(T.orders, [row], false); orders.push(row); return; }
      if (govStopsOnly && w.leg !== "stop") { ev("governor_skip", { leg: w.leg }); return; }
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
        // A lost reply or a 5xx is an unknown, not a rejection: the row stays pending and is reconciled by its client id.
        await save(row, { reason: `unknown: ${msg(e)}` });
        rep.errors.push(`create ${id}: ${msg(e)}`);
      }
    };

    for (const r of book?.rungs ?? []) {
      const key = rungKey(r.side, r.k), w = wants.get(key) ?? null;
      const cur = orders.filter((o) => o.rung_side === r.side && o.k === r.k && (o.state === "open" || o.state === "pending" || o.state === "cancelling" || o.state === "dry")).at(-1) ?? null;
      if (cur?.state === "cancelling" || (cur?.state === "pending" && cur.mode === "live")) {
        if (cur.state === "cancelling" && client) await cancelLive(cur, cur.reason ?? "cancel");
        continue;                                                              // nothing new on a rung until its order is final
      }
      // An entry is the paper decision at its price (its size was fixed when it was placed); an exit its price and what is left.
      const same = cur && w && cur.leg === w.leg && cur.side === w.side && Math.abs(cur.price - w.price) < 1e-9 &&
        (w.leg === "entry" ? cur.paper_key === w.paperKey : Math.abs(cur.base_size - cur.filled_size - w.size) < 1e-9);
      const expiring = cur && cur.mode === "live" && cur.end_time != null && msOf(cur.end_time) - now < CB_LIVE_REFRESH_MS;
      if (cur && same && !expiring) continue;
      if (cur) {
        if (cur.mode === "dry_run") await save(cur, { state: "dry_withdrawn", reason: w ? "replaced" : "withdrawn" });
        else if (!(await cancelLive(cur, !w ? "withdrawn" : expiring && same ? "refresh" : "replaced"))) continue;
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
    const convOpen = orders.filter((o) => o.leg === "convert" && (o.state === "open" || o.state === "pending" || o.state === "dry" || o.state === "cancelling"));
    if (paused) for (const o of convOpen) if (o.mode === "live") await cancelLive(o, "global pause");
    if (!paused && usdcShort > 0 && !convOpen.length && touch.bid != null) {
      const spent = orders.filter((o) => o.leg === "convert" && msOf(o.created_at) >= dayStart && o.mode === (armed ? "live" : "dry_run")).reduce((s, o) => s + o.price * o.base_size, 0);
      // The asks' shortfall and 2 % over, at most what the pounds the bids leave free and the day's cap allow.
      const px = touch.bid;
      const room = Math.min(cfg.convert_max_gbp_day - spent, freeGbp ?? Infinity) / px;
      const size = floorTo(Math.min(Math.ceil(usdcShort * 1.02 / step) * step, room), step);
      if (size >= minSize && size * px >= CB_LIVE_DUST_GBP && (armed || (cfg.dry_run && !hasLiveBook))) {
        await place({ leg: "convert", rungSide: "bid", k: 0, side: "BUY", price: px, size, trip: "", paperKey: null, fair, ioc: false });
      } else ev("convert_skipped", { short: usdcShort, spent, cap: cfg.convert_max_gbp_day, freeGbp });
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
      await d.db.upsert(CB_LIVE_TABLES.state, [{ id: 1, state: { fault, lastReport: { ...rep, events: rep.events.slice(0, 50) } }, updated_at: iso(now), last_error: rep.errors.length ? rep.errors.join(" | ").slice(0, 500) : null }], "id");
    } catch { /* the lease still expires */ }
    try { await d.db.update("agent_locks", `name=eq.${CB_LIVE_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(now), holder: null }); } catch { /* it expires */ }
  }
}

/**
 * LIVE's row of it (`cbLive` on the dashboard): from its own tables alone, null-safe, never a call to Coinbase. In pounds
 * (its capital is £120) with GBP/USD (`gbpUsd`, the paper arm's last rate) for the page's dollars. `tradedLive` is true from
 * its first live order; the page shows the row from then, or while it is armed.
 */
export async function readCbLive(db: Db, now: number) {
  const T = CB_LIVE_TABLES;
  try {
    const cfg = (await db.select<CbLiveConfig>(T.config, "id=eq.1&select=*"))[0];
    if (!cfg) return null;
    const st = (await db.select<{ updated_at: string | null; state: { lastReport?: CbLiveReport } }>(T.state, "id=eq.1&select=updated_at,state"))[0] ?? null;
    const live = await db.select<OrderRow>(T.orders, "mode=eq.live&select=client_order_id,leg,state,created_at&order=id.desc&limit=200");
    const fills = await db.selectAll<FillRow>(T.fills, "select=*&order=entry_id.asc");
    const paper = CB_LIVE_PAPERS[cfg.paper];
    const pRow = paper ? (await db.select<{ state: { books?: Record<string, BookState> }; last_minute: string | null }>(paper.state, "id=eq.1&select=state,last_minute"))[0] : undefined;
    const x = pRow?.state?.books?.[paper!.book]?.lastX ?? null;
    const fair = pRow?.last_minute
      ? (await db.select<{ fair: number | null }>(paper!.minutes, `book=eq.${paper!.book}&minute=eq.${enc(msOf(pRow.last_minute))}&select=fair`))[0]?.fair ?? null : null;
    const trips = [...tripsOf(fills).values()];
    const dayStart = Date.parse(`${dayOf(now)}T00:00:00Z`);
    let realised = 0, unrealised = 0, today = 0, cost = 0, fees = 0, held = 0;
    for (const t of trips) {
      const p = tripPnl(t, fair == null ? null : Number(fair));
      realised += p.realised; unrealised += p.marked; fees += t.fees;
      if (t.lastFill >= dayStart || tripHeld(t) > 0) today += p.realised + p.marked;
      if (tripHeld(t) > 0) { cost += tripHeld(t) * t.entryAvg; held++; }
    }
    const updated = st?.updated_at ? msOf(st.updated_at) : null;
    return {
      name: CB_LIVE_NAME, paper: cfg.paper, dryRun: cfg.dry_run, armed: !cfg.dry_run && cfg.armed_at != null, armedAt: cfg.armed_at,
      tradedLive: live.length > 0, running: updated != null && now - updated < 3 * M, lagMinutes: updated == null ? null : Math.round((now - updated) / M),
      capitalGbp: Number(cfg.capital_gbp), rungGbp: Number(cfg.rung_gbp), gbpUsd: x,
      realisedGbp: realised, unrealisedGbp: unrealised, todayGbp: today, costGbp: cost, feesGbp: fees, heldRungs: held,
      openOrders: live.filter((o) => o.state === "open" || o.state === "pending" || o.state === "cancelling").length,
      lossStopped: !!st?.state?.lastReport?.lossStopped,
    };
  } catch {
    return null;
  }
}
