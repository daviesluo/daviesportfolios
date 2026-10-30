// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" (migration 0184; Davies, 2026-10-30: "怎么实现自动化？如果真的可以实现的话就做成实时纸面
// 测试加到testing里…", then "A 策略可以单独做吗还是只能做像你刚才说的和做市商抢生意的那个做法？"): the MMCOMP studies' strategy A as a real-time
// paper test in two arms, pre-registered in docs/agents/reviews/2026-10-30-xhedge-prereg.md (the studies:
// reviews/2026-10-30-revx-mm-competition.md, reviews/2026-10-30-mmcomp-2.md and backtests/mmcomp/scripts/xhedge_a2.py).
//
// THE RULE, each arm and each book (USDT-GBP and USDC-GBP) on its own two simulated accounts, every minute t:
//   - The turn is at t + 30 s, as LIVE's executor's. It reads Revolut X's book as the recorder last saw it (agent_book_levels,
//     dark unless seen within 75 s) and Coinbase's touch (cb_touch, read at :00; dark when over 60 s old).
//   - Where the order rests, the one thing the arms differ in:
//       "inside" (A1): bid = min(Revolut X's best bid + a tick, its ask − a tick, Coinbase's bid × (1 − 2 bps) floored to the
//         tick); the ask the same way round. One tick inside the other maker: it competes for its prints.
//       "behind" (A2): bid = min(Coinbase's mid × (1 − 10 bps) floored, Revolut X's best bid, its ask − a tick, Coinbase's bid
//         × (1 − 2 bps) floored); the ask the same way round. Never better than Revolut X's own touch: the other maker is
//         always ahead of it, and it takes only what goes through it. 10 bps is LIVE's 0.1 % rung and the replay's best
//         distance behind the maker (xhedge_a2.py).
//     One order a side, £100 (`XH_Q_GBP`) of coin at its price.
//   - A side quotes only while its two legs can carry a fill: a bid needs £100 of pounds on Revolut X AND £100 of coin on
//     Coinbase to sell; an ask needs £100 of coin on Revolut X AND £100 of pounds on Coinbase to buy back. NO transfer, ever:
//     a side whose inventory runs short stops, its minutes counted as blocked, until fills on the other side bring it back.
//   - Fills: a recorded Revolut X print in [turn, turn + 60 s) at or through our price when we are strictly inside the best
//     level (first in its queue); only strictly through it when we join the level or rest behind it. Up to what is left of
//     the order and of the inventory.
//   - The hedge: a Coinbase taker at the first Coinbase read at or after the fill + 30 s (the delay the study found harmless),
//     paying 0.45 bps (`XH_CB_FEE`, the dearest published stable-pair taker tier). A fill worth under £1 waits with others on its
//     side until they reach £1 (Coinbase's smallest order is £0.72): Revolut X's £0.10 prints fill us too.
//   - Orders: a placement when a side starts or its price moves or a fill emptied it, counted a UTC day for both books of an arm
//     together. Each arm models one Revolut X sub-account, which has no daily order limit (Revolut X's docs: "The daily limit
//     does not apply to sub-accounts"); `XH_ORDER_CAP_DAY` is a governor far above the need, and the count is recorded.
// The arms are paper and model separate accounts: neither sees the other's orders, so on the venue the inside arm would stand
// ahead of the behind arm's price, which the paper does not charge for. It reads only what the recorders keep; it calls no
// venue and holds no key. Its own tables (`agent_xhedge_*`, a row an arm and book), lease (`xhedge`) and call
// (`agents?action=xhedge`, a row of `edge_calls` under the watchdog, its beat first), both arms in one run on one read.
//
// Money: £600 a venue a book (£300 of pounds and £300 of coin on each venue), £1,200 a book, £2,400 an arm (`XH_VENUE_GBP`).
// Every round trip's pounds stay in the accounts, so what it realises is put back to work by itself; no other compounding.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

export const XH_ID = "xhedge";
export const XH_NAME = "Stablecoin quotes RX↔Coinbase hedge";
/** The behind arm's distance from Coinbase's mid, in bps. */
export const XH_BEHIND_BPS = 10;
/** The two arms: the page's id and name each, and where the order rests. */
export const XH_ARMS = [
  { arm: "inside", id: "xhedge", name: "Stablecoin quotes RX↔Coinbase hedge", dBps: 0 },
  { arm: "behind", id: "xhedgebehind", name: "Stablecoin quotes RX↔Coinbase hedge - 1", dBps: XH_BEHIND_BPS },
] as const;
export type XhArm = typeof XH_ARMS[number];
export type XhArmId = XhArm["arm"];
export const XH_BOOKS = ["USDT-GBP", "USDC-GBP"] as const;
export type XhBook = typeof XH_BOOKS[number];
/** A venue's money a book: half pounds, half coin at the start's price. */
export const XH_VENUE_GBP = 600;
/** One order's pounds. */
export const XH_Q_GBP = 100;
/** The bid at most Coinbase's bid less this, the ask at least Coinbase's ask plus it. */
export const XH_MARGIN = 0.0002;
/** Coinbase's taker fee on a stable pair: the dearest published tier, 0.45 bps. */
export const XH_CB_FEE = 0.000045;
/** The hedge goes at the first Coinbase read at or after the fill + this. */
export const XH_HEDGE_DELAY_MS = 30e3;
/** Coinbase's touch older than this at the turn: nothing rests on Revolut X. */
export const XH_CB_STALE_MS = 60e3;
/** Revolut X's book not seen by the recorder within this before the turn: nothing rests. */
export const XH_RX_FRESH_MS = 75e3;
/** A hedge smaller than this waits for more of its side (Coinbase's smallest order is £0.72). */
export const XH_MIN_HEDGE_GBP = 1;
/** The placements a UTC day an arm, both books together, past which nothing new is placed (a governor; the need is ~1,000). */
export const XH_ORDER_CAP_DAY = 2400;
/** The turn, into its minute. */
export const XH_TURN_MS = 30e3;
export const XH_TICK = 0.0001;
export const XH_MAX_MINUTES = 30;
export const XH_LEASE = "xhedge";
export const XH_LEASE_MS = 25e3;
export const XH_TABLES = { state: "agent_xhedge_state", minutes: "agent_xhedge_minutes", fills: "agent_xhedge_fills", trips: "agent_xhedge_trips", days: "agent_xhedge_days" } as const;

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const r9 = (x: number) => Number(x.toFixed(9));
const dayOf = (ms: number) => iso(ms).slice(0, 10);

export type Side = "bid" | "ask";
export type RxBook = { at: number; seenUntil: number; bid: number; ask: number };
export type CbRead = { at: number; bid: number; ask: number };
export type RxPrint = { id: string; ts: number; price: number; qty: number; side: "buy" | "sell" };
/** A hedge owed to Coinbase: `qty` coins, bought on Revolut X for `rxGbp` (a bid) or sold there for it (an ask). */
export type Owed = { side: Side; qty: number; rxGbp: number; firstFill: number; lastFill: number; fills: number };
export type Resting = { price: number; left: number };
export type XhBookState = {
  rxGbp: number; rxCoin: number; cbGbp: number; cbCoin: number;
  /** Fills waiting for their hedge's read, and each side's sub-£1 remainder. */
  owed: Owed[]; dust: Record<Side, Owed | null>;
  resting: Record<Side, Resting | null>;
  startMid: number;
};
export type XhState = { lastMinute: number; startedAt: number; books: Record<XhBook, XhBookState>; orders: { day: string | null; n: number }; fault?: { key: string; at: number } };

export type XhMinuteRow = {
  arm: XhArmId; book: XhBook; minute: string; rx_bid: number | null; rx_ask: number | null; cb_bid: number | null; cb_ask: number | null; cb_age_s: number | null;
  our_bid: number | null; our_ask: number | null; bid_block: string | null; ask_block: string | null; orders: number; fills: number;
  rx_gbp: number; rx_coin: number; cb_gbp: number; cb_coin: number;
};
export type XhFillRow = { arm: XhArmId; book: XhBook; print_id: string; ts: string; side: Side; price: number; qty: number; inside: boolean };
export type XhTripRow = {
  arm: XhArmId; book: XhBook; side: Side; t_fill: string; t_hedge: string; qty: number; rx_price: number; cb_price: number; fee_gbp: number; pnl_gbp: number; fills: number;
};

/** A new book at `startMid` (Revolut X's mid at the start) and Coinbase's mid: £300 of pounds and £300 of coin on each venue. */
export function xhNewBook(rxMid: number, cbMid: number): XhBookState {
  const half = XH_VENUE_GBP / 2;
  return {
    rxGbp: half, rxCoin: r9(half / rxMid), cbGbp: half, cbCoin: r9(half / cbMid),
    owed: [], dust: { bid: null, ask: null }, resting: { bid: null, ask: null }, startMid: rxMid,
  };
}

const capsOf = (cb: { bid: number; ask: number }) => ({
  b: Math.floor((cb.bid * (1 - XH_MARGIN)) / XH_TICK + 1e-9) * XH_TICK,
  a: Math.ceil((cb.ask * (1 + XH_MARGIN)) / XH_TICK - 1e-9) * XH_TICK,
});

/** The inside arm's prices: one tick inside Revolut X's touch, never crossing it, never past Coinbase's touch ± the margin. */
export function xhWant(rx: { bid: number; ask: number }, cb: { bid: number; ask: number }): { bid: number; ask: number } {
  const t = XH_TICK, cap = capsOf(cb);
  return { bid: r9(Math.min(rx.bid + t, rx.ask - t, cap.b)), ask: r9(Math.max(rx.ask - t, rx.bid + t, cap.a)) };
}

/** The behind arm's prices: Coinbase's mid ∓ `dBps`, never better than Revolut X's own touch, never past Coinbase's touch ± the margin. */
export function xhWantBehind(rx: { bid: number; ask: number }, cb: { bid: number; ask: number }, dBps = XH_BEHIND_BPS): { bid: number; ask: number } {
  const t = XH_TICK, cap = capsOf(cb), fair = (cb.bid + cb.ask) / 2;
  const b = Math.floor((fair * (1 - dBps / 1e4)) / t + 1e-9) * t, a = Math.ceil((fair * (1 + dBps / 1e4)) / t - 1e-9) * t;
  return { bid: r9(Math.min(b, rx.bid, rx.ask - t, cap.b)), ask: r9(Math.max(a, rx.ask, rx.bid + t, cap.a)) };
}

/** An arm's prices for the turn. */
export const xhWantFor = (arm: XhArm, rx: { bid: number; ask: number }, cb: { bid: number; ask: number }) =>
  arm.arm === "behind" ? xhWantBehind(rx, cb, arm.dBps) : xhWant(rx, cb);

/** What a side's inventory still has room for, in coins at `price`, beyond the hedges already owed. */
export function xhRoom(s: XhBookState, side: Side, price: number): number {
  const owedCoin = (sd: Side) => s.owed.filter((o) => o.side === sd).reduce((a, o) => a + o.qty, 0) + (s.dust[sd]?.qty ?? 0);
  if (side === "bid") return Math.max(0, Math.min(s.rxGbp / price, s.cbCoin - owedCoin("bid")));
  return Math.max(0, Math.min(s.rxCoin, (s.cbGbp - owedCoin("ask") * price) / price));
}

/** Why a side cannot quote at the turn, or null: it needs room for one whole order (`XH_Q_GBP`). */
export function xhBlock(s: XhBookState, side: Side, price: number): string | null {
  const q = XH_Q_GBP / price;
  if (side === "bid") {
    if (s.rxGbp < XH_Q_GBP) return "rx-gbp";
    if (xhRoom(s, side, price) < q - 1e-9) return "cb-coin";
  } else {
    if (s.rxCoin * price < XH_Q_GBP) return "rx-coin";
    if (xhRoom(s, side, price) < q - 1e-9) return "cb-gbp";
  }
  return null;
}

/** The newest element at or before `t` of a list in time order (`at`), or null. */
function lastAtOrBefore<T extends { at: number }>(xs: T[], t: number): T | null {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid].at <= t) lo = mid + 1; else hi = mid; }
  return lo > 0 ? xs[lo - 1] : null;
}
/** The first Coinbase read at or after `t`, or null. */
export function xhFirstReadFrom(reads: CbRead[], t: number): CbRead | null {
  let lo = 0, hi = reads.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (reads[mid].at < t) lo = mid + 1; else hi = mid; }
  return lo < reads.length ? reads[lo] : null;
}

function setBlock(row: XhMinuteRow, side: Side, why: string) {
  if (side === "bid") row.bid_block = why; else row.ask_block = why;
}

export type XhStepIn = { t: number; rx: RxBook[]; cb: CbRead[]; prints: RxPrint[]; ordersToday: number };
export type XhStepOut = { minute: XhMinuteRow; fills: XhFillRow[]; placed: number };

/**
 * One minute of one book of one arm (the inside arm when none is named): the turn at t + 30 s (prices, blocks, placements), then
 * the prints of [turn, turn + 60 s) against the orders, each fill owed to Coinbase. Mutates `s`. Hedges are settled apart
 * (`xhSettle`), once their read exists.
 */
export function xhStep(book: XhBook, s: XhBookState, inp: XhStepIn, arm: XhArm = XH_ARMS[0]): XhStepOut {
  const turn = inp.t + XH_TURN_MS;
  const rx = lastAtOrBefore(inp.rx, turn);
  const cb = lastAtOrBefore(inp.cb, turn);
  const rxOk = !!rx && turn - rx.seenUntil <= XH_RX_FRESH_MS && rx.ask > rx.bid;
  const cbOk = !!cb && turn - cb.at <= XH_CB_STALE_MS && cb.ask > cb.bid;
  const row: XhMinuteRow = {
    arm: arm.arm, book, minute: iso(inp.t), rx_bid: rx?.bid ?? null, rx_ask: rx?.ask ?? null, cb_bid: cb?.bid ?? null, cb_ask: cb?.ask ?? null,
    cb_age_s: cb ? Math.round((turn - cb.at) / 1e3) : null, our_bid: null, our_ask: null, bid_block: null, ask_block: null, orders: 0, fills: 0,
    rx_gbp: 0, rx_coin: 0, cb_gbp: 0, cb_coin: 0,
  };
  const fills: XhFillRow[] = [];
  let placed = 0;
  if (!rxOk || !cbOk) {
    s.resting = { bid: null, ask: null };
    const why = !rxOk ? "rx-stale" : "cb-stale";
    row.bid_block = why; row.ask_block = why;
  } else {
    const want = xhWantFor(arm, rx!, cb!);
    for (const side of ["bid", "ask"] as Side[]) {
      const price = want[side];
      const block = xhBlock(s, side, price);
      if (block) { s.resting[side] = null; setBlock(row, side, block); continue; }
      const r = s.resting[side];
      if (!r || Math.abs(r.price - price) > 1e-9 || r.left * price < XH_MIN_HEDGE_GBP) {
        if (inp.ordersToday + placed >= XH_ORDER_CAP_DAY) { setBlock(row, side, "order-cap"); continue; }
        s.resting[side] = { price, left: r9(XH_Q_GBP / price) };
        placed++;
      }
      if (side === "bid") row.our_bid = price; else row.our_ask = price;
    }
    // The prints of the minute the orders rest in.
    for (const p of inp.prints) {
      if (p.ts < turn || p.ts >= turn + M) continue;
      const side: Side = p.side === "sell" ? "bid" : "ask";
      const o = s.resting[side];
      if (!o || o.left <= 1e-12) continue;
      const inside = side === "bid" ? o.price > rx!.bid + 1e-12 : o.price < rx!.ask - 1e-12;
      const reaches = side === "bid" ? (inside ? p.price <= o.price + 1e-12 : p.price < o.price - 1e-12) : (inside ? p.price >= o.price - 1e-12 : p.price > o.price + 1e-12);
      if (!reaches) continue;
      const qty = r9(Math.min(o.left, p.qty, xhRoom(s, side, o.price)));
      if (qty <= 1e-9) continue;
      o.left = r9(o.left - qty);
      const gbp = qty * o.price;
      if (side === "bid") { s.rxGbp = r9(s.rxGbp - gbp); s.rxCoin = r9(s.rxCoin + qty); } else { s.rxCoin = r9(s.rxCoin - qty); s.rxGbp = r9(s.rxGbp + gbp); }
      const d = s.dust[side] ?? { side, qty: 0, rxGbp: 0, firstFill: p.ts, lastFill: p.ts, fills: 0 };
      d.qty = r9(d.qty + qty); d.rxGbp = r9(d.rxGbp + gbp); d.lastFill = p.ts; d.fills++;
      if (d.rxGbp >= XH_MIN_HEDGE_GBP) { s.owed.push(d); s.dust[side] = null; } else s.dust[side] = d;
      fills.push({ arm: arm.arm, book, print_id: p.id, ts: iso(p.ts), side, price: o.price, qty, inside });
    }
  }
  row.orders = placed; row.fills = fills.length;
  row.rx_gbp = s.rxGbp; row.rx_coin = s.rxCoin; row.cb_gbp = s.cbGbp; row.cb_coin = s.cbCoin;
  return { minute: row, fills, placed };
}

/**
 * Settle every owed hedge whose read exists: the first Coinbase read at or after its last fill + 30 s, at or before `upTo`. A bid's
 * coins are sold at the bid less the fee, an ask's bought back at the ask plus it. Mutates `s`; the trips it closed.
 */
export function xhSettle(book: XhBook, s: XhBookState, reads: CbRead[], upTo: number, arm: XhArmId = "inside"): XhTripRow[] {
  const trips: XhTripRow[] = [];
  const keep: Owed[] = [];
  for (const o of s.owed) {
    const r = xhFirstReadFrom(reads, o.lastFill + XH_HEDGE_DELAY_MS);
    if (!r || r.at > upTo || !(r.ask > r.bid)) { keep.push(o); continue; }
    const px = o.side === "bid" ? r.bid : r.ask;
    const gross = o.qty * px, fee = gross * XH_CB_FEE;
    let pnl: number;
    if (o.side === "bid") { s.cbCoin = r9(s.cbCoin - o.qty); s.cbGbp = r9(s.cbGbp + gross - fee); pnl = gross - fee - o.rxGbp; }
    else { s.cbCoin = r9(s.cbCoin + o.qty); s.cbGbp = r9(s.cbGbp - gross - fee); pnl = o.rxGbp - gross - fee; }
    trips.push({ arm, book, side: o.side, t_fill: iso(o.firstFill), t_hedge: iso(r.at), qty: o.qty, rx_price: r9(o.rxGbp / o.qty), cb_price: px, fee_gbp: r9(fee), pnl_gbp: r9(pnl), fills: o.fills });
  }
  s.owed = keep;
  return trips;
}

/** The record starts at the first 00:00 UTC after its first run. */
export const xhStart = (now: number) => Math.floor(now / DAY) * DAY + DAY;

export type XhReport = { minutes: number; from: number | null; to: number | null; fills: number; trips: number; orders: number; errors: string[]; report: boolean; skipped?: string };

type Inputs = { rx: RxBook[]; cb: CbRead[]; prints: RxPrint[] };

/** Every book's inputs for the minutes [from, to]: Revolut X's book, Coinbase's touch and Revolut X's prints. */
async function readInputs(db: Db, from: number, to: number): Promise<Record<XhBook, Inputs>> {
  const out = {} as Record<XhBook, Inputs>;
  for (const book of XH_BOOKS) {
    // The recorder writes a snapshot when the book changes and extends its `seen_until` while it does not, so a book that stood
    // still for an hour is one row an hour old: the newest snapshot stamped before the window is read with the window's.
    type Lv = { ts: string; seen_until: string | null; bids: Array<[number, number, number | null]>; asks: Array<[number, number, number | null]> };
    const before = await db.select<Lv>("agent_book_levels", `book=eq.${book}&ts=lt.${enc(from - 10 * M)}&select=ts,seen_until,bids,asks&order=ts.desc&limit=1`);
    const inWindow = await db.selectAll<Lv>("agent_book_levels",
      `book=eq.${book}&ts=gte.${enc(from - 10 * M)}&ts=lte.${enc(to + M)}&select=ts,seen_until,bids,asks&order=book.asc,ts.asc`);
    const rx: RxBook[] = [...before, ...inWindow].filter((r) => r.bids?.length && r.asks?.length)
      .map((r) => ({ at: msOf(r.ts), seenUntil: msOf(r.seen_until ?? r.ts), bid: Number(r.bids[0][0]), ask: Number(r.asks[0][0]) }));
    const cbRows = await db.selectAll<{ ts: string; bid: number; ask: number }>("cb_touch",
      `product=eq.${book}&ts=gte.${enc(from - 5 * M)}&ts=lte.${enc(to + 3 * M)}&select=ts,bid,ask&order=product.asc,ts.asc`);
    const cb: CbRead[] = cbRows.map((r) => ({ at: msOf(r.ts), bid: Number(r.bid), ask: Number(r.ask) }));
    const pRows = await db.selectAll<{ id: string; ts: string; price: number; qty: number; side: string }>("agent_quote_prints",
      `book=eq.${book}&ts=gte.${enc(from)}&ts=lt.${enc(to + 2 * M)}&select=id,ts,price,qty,side&order=ts.asc,id.asc`);
    const prints: RxPrint[] = pRows.map((r) => ({ id: r.id, ts: msOf(r.ts), price: Number(r.price), qty: Number(r.qty), side: r.side === "buy" ? "buy" : "sell" }));
    out[book] = { rx, cb, prints };
  }
  return out;
}

/**
 * Decide every minute of each arm from its last to three minutes before the clock (so a fill's hedge read exists), at most
 * `XH_MAX_MINUTES`, idempotent by natural keys; both arms on one read of the inputs. Before its start an arm only waits; at its
 * start it opens each book at the minute's mids.
 */
export async function runXhedge(d: { db: Db; now: number; holder: string }): Promise<XhReport> {
  const T = XH_TABLES;
  const report: XhReport = { minutes: 0, from: null, to: null, fills: 0, trips: 0, orders: 0, errors: [], report: false };
  const leased = await d.db.claim("agent_locks", `name=eq.${XH_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + XH_LEASE_MS), holder: d.holder });
  if (!leased.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const rows = await d.db.select<{ arm: string; state: XhState | Record<string, never> }>(T.state, "select=arm,state");
    const plan = XH_ARMS.map((arm) => {
      let st = rows.find((r) => r.arm === arm.arm)?.state as XhState | undefined;
      if (!st || !("lastMinute" in st)) {
        const start = xhStart(d.now);
        st = { lastMinute: start - M, startedAt: start, books: {} as XhState["books"], orders: { day: null, n: 0 } };
      }
      const first = st.lastMinute + M, horizon = Math.min(minuteOf(d.now) - 3 * M, st.lastMinute + XH_MAX_MINUTES * M);
      return { arm, st, first, horizon };
    });
    const due = plan.filter((p) => p.horizon >= p.first);
    if (!due.length) {
      for (const p of plan) await save(d, p.arm, p.st, [], report);
      return { ...report, skipped: d.now < plan[0].st.startedAt ? "waiting for its start" : "nothing new to decide" };
    }
    const from = Math.min(...due.map((p) => p.first)), to = Math.max(...due.map((p) => p.horizon));
    report.from = from; report.to = to; report.minutes = (to - from) / M + 1;
    let inputs: Record<XhBook, Inputs> | null = null;
    try { inputs = await readInputs(d.db, from, to); } catch (e) { report.errors.push(`inputs: ${msg(e)}`); }
    for (const p of plan) {
      const errs: string[] = inputs ? [] : [...report.errors];
      if (inputs && p.horizon >= p.first) {
        // An arm that fails keeps the state it had before this run: its next run decides the same minutes again.
        const before = structuredClone(p.st);
        try {
          const out = decideArm(p.arm, p.st, inputs, p.first, p.horizon);
          if (out.fills.length) await d.db.upsert(T.fills, out.fills, "arm,book,print_id");
          if (out.trips.length) await d.db.upsert(T.trips, out.trips, "arm,book,side,t_fill,t_hedge");
          if (out.minutes.length) await d.db.upsert(T.minutes, out.minutes, "arm,book,minute");
          p.st.lastMinute = p.horizon;
          report.fills += out.fills.length; report.trips += out.trips.length; report.orders += out.placed;
        } catch (e) {
          p.st = before;
          errs.push(`${p.arm.arm}: ${msg(e)}`);
          report.errors.push(`${p.arm.arm}: ${msg(e)}`);
        }
      }
      await save(d, p.arm, p.st, errs, report);
    }
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    report.report = true;
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${XH_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

/** One arm's minutes [first, horizon] in time order, both books inside each minute, so the day's order count is the arm's two books' together. Mutates `st`. */
function decideArm(arm: XhArm, st: XhState, inputs: Record<XhBook, Inputs>, first: number, horizon: number) {
  const fills: XhFillRow[] = [], trips: XhTripRow[] = [], minutes: XhMinuteRow[] = [];
  let placed = 0;
  for (let t = first; t <= horizon; t += M) {
    const day = dayOf(t);
    if (st.orders.day !== day) st.orders = { day, n: 0 };
    for (const book of XH_BOOKS) {
      const { rx, cb, prints } = inputs[book];
      if (!st.books[book]) {
        const a = lastAtOrBefore(rx, t + XH_TURN_MS), c = lastAtOrBefore(cb, t + XH_TURN_MS);
        if (!a || !c || !(a.ask > a.bid) || !(c.ask > c.bid)) continue;     // opens at its first minute with both books
        st.books[book] = xhNewBook((a.bid + a.ask) / 2, (c.bid + c.ask) / 2);
      }
      const s = st.books[book];
      const out = xhStep(book, s, { t, rx, cb, prints, ordersToday: st.orders.n }, arm);
      st.orders.n += out.placed;
      placed += out.placed;
      trips.push(...xhSettle(book, s, cb, t + 3 * M, arm.arm));
      out.minute.rx_gbp = s.rxGbp; out.minute.rx_coin = s.rxCoin; out.minute.cb_gbp = s.cbGbp; out.minute.cb_coin = s.cbCoin;
      minutes.push(out.minute);
      fills.push(...out.fills);
    }
  }
  return { fills, trips, minutes, placed };
}

async function save(d: { db: Db; now: number }, arm: XhArm, st: XhState, errors: string[], report: XhReport) {
  const key = faultKey(errors);
  const due = reportDue(st.fault ?? null, key, d.now);
  if (due) report.report = true;
  if (!key) delete st.fault; else if (due) st.fault = { key, at: d.now };
  await d.db.upsert(XH_TABLES.state, [{ arm: arm.arm, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: errors.length ? errors.join(" | ").slice(0, 500) : null }], "arm");
}

type TripDb = { arm: string; book: string; side: string; t_fill: string; t_hedge: string; qty: number; rx_price: number; cb_price: number; fee_gbp: number; pnl_gbp: number; fills: number };
type DayDb = { arm: string; book: string; day: string; orders: number; fills: number; trips: number; won: number; realised_gbp: number; bid_blocked: number; ask_blocked: number };
type MinDb = XhMinuteRow & { minute: string };

/** The rows a page lists of each table. */
export const XH_PAGE_ROWS = 60;

/**
 * An arm's page view, in the Stablecoin quotes pages' shape: the scoreboard (FUNDED £2,400; value the four accounts' pounds and
 * coin at Revolut X's mid; realised the trips'; unrealised the rest, which is the coin held moving with GBP/USD), BOOKS (each book's
 * two resting orders, Coinbase's mid as its fair), INVENTORY a venue and a currency, ROUND TRIPS (a Revolut X fill and its
 * Coinbase hedge), DAYS (with the minutes each side was blocked), and the resting orders. Pure: the reader passes the arm's rows.
 */
export function xhView(input: {
  arm?: XhArm;
  st: { state: XhState | Record<string, never>; last_minute: string | null; last_error: string | null } | null;
  trips: TripDb[]; days: DayDb[]; last: MinDb[]; lastPrints: Record<string, number | null>; nowMs: number; dayStartMs: number; gbpusd: number | null;
}) {
  const arm = input.arm ?? XH_ARMS[0];
  const st = input.st, s = st?.state as XhState | undefined;
  if (!st?.last_minute || !s || !("lastMinute" in s)) return null;
  const usd = (gbp: number) => (input.gbpusd ? gbp * input.gbpusd : 0);
  const capitalGbp = XH_VENUE_GBP * 2 * XH_BOOKS.length;
  const lastRow = (b: string) => input.last.find((m) => m.book === b) ?? null;
  const midOf = (b: string) => {
    const r = lastRow(b);
    return r?.rx_bid != null && r?.rx_ask != null ? (Number(r.rx_bid) + Number(r.rx_ask)) / 2 : (s.books[b as XhBook]?.startMid ?? null);
  };
  let valueGbp = 0;
  const assets: Array<Record<string, unknown>> = [];
  const venue = { rx: { gbp: 0 }, cb: { gbp: 0 } };
  for (const b of XH_BOOKS) {
    const bs = s.books[b];
    if (!bs) { valueGbp += XH_VENUE_GBP * 2; continue; }   // a book not open yet counts as its £1,200
    const mid = midOf(b) ?? bs.startMid;
    // A bid's coin owed to Coinbase is still on Coinbase until it is sold; an ask's pounds the same.
    valueGbp += bs.rxGbp + bs.cbGbp + (bs.rxCoin + bs.cbCoin) * mid;
    venue.rx.gbp += bs.rxGbp; venue.cb.gbp += bs.cbGbp;
    const coin = b.split("-")[0];
    assets.push({ asset: `${coin} · Revolut X`, amount: bs.rxCoin, price: mid, gbp: bs.rxCoin * mid, priceFrom: "last" });
    assets.push({ asset: `${coin} · Coinbase`, amount: bs.cbCoin, price: mid, gbp: bs.cbCoin * mid, priceFrom: "last" });
  }
  const trips = [...input.trips].sort((a, c) => Date.parse(c.t_hedge) - Date.parse(a.t_hedge));
  const realisedGbp = trips.reduce((a, t) => a + Number(t.pnl_gbp), 0);
  const todayGbp = trips.filter((t) => Date.parse(t.t_hedge) >= input.dayStartMs).reduce((a, t) => a + Number(t.pnl_gbp), 0);
  const feesGbp = trips.reduce((a, t) => a + Number(t.fee_gbp), 0);
  const unrealisedGbp = valueGbp - capitalGbp - realisedGbp;
  const lagMinutes = Math.round((input.nowMs - Date.parse(st.last_minute)) / M);
  const today = new Date(input.dayStartMs).toISOString().slice(0, 10);
  const k = arm.dBps / 1e4;
  const rungs: Array<Record<string, unknown>> = [];
  const orders: Array<Record<string, unknown>> = [];
  for (const b of XH_BOOKS) {
    const r = lastRow(b), bs = s.books[b];
    for (const side of ["bid", "ask"] as Side[]) {
      const price = r ? (side === "bid" ? r.our_bid : r.our_ask) : null;
      const left = bs?.resting?.[side]?.left ?? null;
      rungs.push({ book: b, side, k, order: price != null ? { price: Number(price), leg: "entry", state: "new" } : null, held: null });
      if (price != null) {
        orders.push({ id: `${b}|${side}|${r!.minute}`, ts: r!.minute, book: b, side, k, leg: "entry", venueSide: side === "bid" ? "buy" : "sell",
          price: Number(price), base: left, state: "new", reason: null });
      }
    }
  }
  const blockedToday = input.days.filter((x) => String(x.day).slice(0, 10) === today);
  const notes = XH_BOOKS.map((b) => {
    const x = blockedToday.find((d) => d.book === b);
    const r = lastRow(b);
    const why = (v: string | null | undefined) => (v === "rx-gbp" ? "no pounds on Revolut X" : v === "cb-coin" ? "no coin on Coinbase to sell" : v === "rx-coin" ? "no coin on Revolut X" : v === "cb-gbp" ? "no pounds on Coinbase" : v === "cb-stale" ? "Coinbase's price is stale" : v === "rx-stale" ? "Revolut X's book is stale" : v === "order-cap" ? "the day's order governor" : v ?? "");
    const now = r ? [r.bid_block ? `bid off (${why(r.bid_block)})` : "bid on", r.ask_block ? `ask off (${why(r.ask_block)})` : "ask on"].join(", ") : "not open yet";
    return `${b.replace("-", "/")}: ${now}; today blocked ${x ? Number(x.bid_blocked) : 0} min bid, ${x ? Number(x.ask_blocked) : 0} min ask`;
  });
  return {
    venue: "revx" as const, ccy: "GBP" as const,
    running: lagMinutes <= 6, lagMinutes, lastError: st.last_error,
    capitalGbp, costGbp: capitalGbp, valueGbp, unrealisedGbp, realisedGbp, todayGbp, feesGbp,
    capitalUsd: usd(capitalGbp), costUsd: usd(capitalGbp), valueUsd: usd(valueGbp), unrealisedUsd: usd(unrealisedGbp), realisedUsd: usd(realisedGbp),
    todayUsd: usd(todayGbp), feesUsd: usd(feesGbp),
    heldRungs: 0, openOrders: orders.length,
    detail: {
      books: XH_BOOKS.map((b) => {
        const r = lastRow(b), bt = trips.filter((t) => t.book === b);
        return {
          book: b, lastPrice: input.lastPrints[b] ?? null, fair: r?.cb_bid != null && r?.cb_ask != null ? (Number(r.cb_bid) + Number(r.cb_ask)) / 2 : null, index: null,
          realisedGbp: bt.reduce((a, t) => a + Number(t.pnl_gbp), 0), trips: bt.length, won: bt.filter((t) => Number(t.pnl_gbp) > 0).length,
        };
      }),
      rungs,
      inventory: { at: st.last_minute, assets: [
        { asset: "GBP · Revolut X", amount: venue.rx.gbp }, ...assets.filter((a) => String(a.asset).endsWith("Revolut X")),
        { asset: "GBP · Coinbase", amount: venue.cb.gbp }, ...assets.filter((a) => String(a.asset).endsWith("Coinbase")),
      ] },
      days: xhDays(input.days, today).map((x) => ({ ...x, realisedUsd: usd(x.realisedGbp) })),
      trips: trips.slice(0, XH_PAGE_ROWS).map((t) => ({
        book: t.book, side: t.side, k, tEntry: t.t_fill, tExit: t.t_hedge, entry: Number(t.rx_price), exit: Number(t.cb_price), qty: Number(t.qty),
        how: "maker", feesGbp: Number(t.fee_gbp), pnlGbp: Number(t.pnl_gbp), feesUsd: usd(Number(t.fee_gbp)), pnlUsd: usd(Number(t.pnl_gbp)),
      })),
      tripCount: trips.length, tripsWon: trips.filter((t) => Number(t.pnl_gbp) > 0).length,
      orders,
    },
    twin: { id: arm.id, arm: arm.arm, name: arm.name, startedAt: iso(s.startedAt), mode: "running", lastTurn: st.last_minute, converting: [], notes },
  };
}

/** The days of both books summed a day, newest first. */
export function xhDays(rows: DayDb[], today: string) {
  const by = new Map<string, { day: string; orders: number; fills: number; trips: number; won: number; realisedGbp: number; today: boolean }>();
  for (const x of rows) {
    const day = String(x.day).slice(0, 10);
    const a = by.get(day) ?? { day, orders: 0, fills: 0, trips: 0, won: 0, realisedGbp: 0, today: day === today };
    a.orders += Number(x.orders); a.fills += Number(x.fills); a.trips += Number(x.trips); a.won += Number(x.won); a.realisedGbp += Number(x.realised_gbp);
    by.set(day, a);
  }
  return [...by.values()].sort((a, c) => (a.day < c.day ? 1 : -1));
}

/** The page's reader: each arm's view (state, trips, days, each book's last minute), the inside arm first; an arm that has not decided a minute is left out. */
export async function readXhedge(d: Db, now: number, dayStartMs: number) {
  try {
    const T = XH_TABLES;
    const [sts, trips, days, fx] = await Promise.all([
      d.select<{ arm: string; state: XhState | Record<string, never>; last_minute: string | null; last_error: string | null }>(T.state, "select=arm,state,last_minute,last_error"),
      d.selectAll<TripDb>(T.trips, "select=arm,book,side,t_fill,t_hedge,qty,rx_price,cb_price,fee_gbp,pnl_gbp,fills&order=arm.asc,book.asc,side.asc,t_fill.asc,t_hedge.asc"),
      d.select<DayDb>(T.days, "select=arm,book,day,orders,fills,trips,won,realised_gbp,bid_blocked,ask_blocked&order=day.desc&limit=240"),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
    ]);
    const lastPrints: Record<string, number | null> = {};
    for (const b of XH_BOOKS) {
      const p = await d.select<{ price: number }>("agent_quote_prints", `book=eq.${b}&select=price&order=ts.desc&limit=1`);
      lastPrints[b] = p[0] ? Number(p[0].price) : null;
    }
    const out = [];
    for (const arm of XH_ARMS) {
      const st = sts.find((r) => r.arm === arm.arm);
      if (!st?.last_minute) continue;
      const lm = encodeURIComponent(new Date(Date.parse(st.last_minute)).toISOString());
      const last = await d.select<MinDb>(T.minutes, `arm=eq.${arm.arm}&minute=eq.${lm}&select=*`);
      const v = xhView({ arm, st, trips: trips.filter((t) => t.arm === arm.arm), days: days.filter((x) => x.arm === arm.arm), last, lastPrints, nowMs: now, dayStartMs,
        gbpusd: fx[0] ? Number(fx[0].value) : null });
      if (v) out.push(v);
    }
    return out;
  } catch { return []; }
}
