// "Stablecoin quotes OKX USDG" and "Stablecoin quotes OKX EURC": PR5's rule as LIVE carries it out, on paper, on OKX's two
// stablecoin books that OTHERVENUES ranked first (docs/agents/reviews/2026-10-27-other-coins-venues.md), from the prints and
// books `okx_rec.ts` records. Davies, 2026-10-27: "…可以的话就加盘口记录器和开testings策略（目前live的rules？）". Pre-registered
// in docs/agents/reviews/2026-10-27-okx-paper-prereg.md, frozen at the commit that adds this file.
//
// WHY A FILE OF ITS OWN, NOT `stepMinute`. PR5's paper engine (quotes.ts, frozen) prices on a 0.0001 grid, sizes a fill at 10 %
// of the minute's printed value and fills only through a quote. LIVE does not: the live executor rests the engine's orders
// on the venue, a print fills them by its own quantity, and since 2026-10-21 a print AT a resting price from the other side
// fills it too (`simFill` "at", quotes_twin.ts; docs/agents/backtests/livesim/). Neither can be had from `stepMinute`
// unchanged, and EURC-USDC's price step is 0.001. So this file carries PR5's rule out as LIVE does, on each book's own grid,
// and leaves every frozen file as it is; `okx_quotes.test.ts` pins each rule below on a made-up world, and pins that with
// PR5's grid and nothing filling it places, re-prices and withdraws exactly as `stepMinute` does.
//
// THE RULE, each book, each minute t (decided one minute behind the recorder's coverage, from what was known at t):
//   1. Fair. Both books are EUR/USD books (OKX unifies EUR with EURC and USD with USDC and USDG): USDG-EUR's fair is 1 / EUR/USD
//      euros a USDG, EURC-USDC's EUR/USD dollars a EURC, each coin taken at exactly 1 EUR or 1 USD. EUR/USD is the Coinbase
//      test's stored minute (`cb_quote_inputs`), read as PR5 reads GBP/USD (`fxBarAt`: the latest bar that started in
//      [t − 10 min, t − 1 min]). Inside an FX closure (PR5-W's, `inQuoteClosure`: Friday 21:00 → Sunday 21:00 UTC and the two
//      holidays) a dark minute takes the book's last EUR/USD, as LIVE's weekend rule does (`weekendX`); outside one it is dark.
//   2. Quotes. Six rungs a book, a bid and an ask 0.1 / 0.2 / 0.3 % from fair (`OKX_RUNGS`), each worth €50 (`OKX_RUNG_EUR`: on
//      EURC-USDC €50 at the minute's EUR/USD), in whole lots, a bid rounded down to the grid and an ask up. Twelve rungs on the
//      two books: the capital is €600 and a rung its twelfth, as LIVE's is (£600, £50). A quote moves when fair has moved more
//      than 0.05 % since it was priced. An order decided at t reaches the book at t + 1 min (PR5's).
//   3. Post-only. An order going live that would cross the book the recorder read last (a bid at or above its best ask, an ask
//      at or below its best bid, the read at most two minutes old) is refused, as LIVE's venue refuses it; with no read, the
//      touch the last print implies (`blocks`, quotes.ts). A refused order is sent again when the market has left it.
//   4. Fills, LIVE's "at" rule. A resting order fills from a print strictly through its price, or AT its price from the other
//      side (a seller at our bid, a buyer at our ask), by the print's own quantity, shared best price first. An entry's first
//      fill makes the rung a position of what filled; the rest of the entry is withdrawn. Its exit rests at fair (a long's
//      rounded up, a short's down) for what is held, and fills the same way, in parts.
//   5. The 24-hour stop. A position held 24 hours is closed as a taker at the end of that minute: a long sells at the recorded
//      best bid, a short buys at the best ask (the read at most two minutes old; else the last print), paying `OKX_TAKER`.
//   6. LIVE's guards. No entry is quoted (resting ones are withdrawn) while fair is dark; while the book's last print is more than
//      50 bps from fair (`OKX_DEPEG`, LIVE's de-peg); and, on both books, for the rest of a UTC day once the trips closed that
//      day on the two together have lost 1 % of the capital (`OKX_LOSS_STOP`, LIVE's daily loss stop on its one account; the
//      driver keeps it, `okxAccountTrips`). Exits and the stop always run.
//   Maker fee 0 % (`OKX_MAKER`: OKX's EEA spot-only stablecoin rate; and OKX's "Spot Stablecoins" group; a UK account's is Davies' to read in
//   the app, the pre-registration's §1). Money in
//   pounds: a trip's quote-currency P&L at the book's pounds per unit when it closed (EUR/USD ÷ GBP/USD, or 1 ÷ GBP/USD), GBP/USD
//   PR5's stored minute.
//
// DEVIATION 2 (2026-10-29; Davies: "OKX每个策略为什么是250usd？改成600吧？正好6个档每个50，目前的数字按倍率乘", then "C，coinbase的也是
// 改用美元"): from the first minute this code decides (`usdFrom`, written into the state with the EUR/USD of that minute and the
// factor $600 ÷ (€300 × EUR/USD)), each rung is $100 (`OKX_RUNG_USD`: on USDG-EUR $100 in euros at the minute's EUR/USD, on
// EURC-USDC 100 USDC), six a book, $600 a book; an entry resting at the old size is re-sized once. The page counts these rows
// in dollars, and everything entered before `usdFrom` is shown × the factor (`okxBookView`), assuming fills and fees scale with
// size. The pre-registration's §8 has it.
//
// THE COMPOUNDING (2026-10-31 00:00 UTC; Davies, 2026-10-30: "…你觉得需要做的话就做"; recorded apart in
// docs/agents/reviews/2026-10-30-okx-compounding-deviation.md): each book's rung is its $100 × its capital over its $600, the capital
// set at each UTC day's first minute from what that book has realised since (okx_compound.ts, LIVE's rule), and the loss stop counts
// against the two books' capitals. Before the instant nothing differs.
//
// One call a minute (`agents?action=okxquotes`, 0150, a row of `edge_calls` under the watchdog), both books, its own tables
// (`okx_quote_*`) and lease (`okx-quotes`). It reads the recorder's tables and the stored rates; it calls no venue and holds no
// key. An empty record starts at the first 00:00 UTC after its first run.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { fxBarAt } from "./quotes.ts";
import { inQuoteClosure } from "./quotes_weekend.ts";
import { OKX_BOOKS, type OkxBook, type OkxRecState } from "./okx_rec.ts";
import { okxCompoundMinute, okxCompoundTrip, type OkxCompound } from "./okx_compound.ts";

const M = 60e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const dayOf = (ms: number) => iso(ms).slice(0, 10);
const r9 = (x: number) => Number(x.toFixed(9));

export const OKX_RUNGS = [0.001, 0.002, 0.003];
export const OKX_REPRICE = 0.0005;
/** One rung, in euros, on either book (€50 on USDG-EUR; on EURC-USDC €50 at the minute's EUR/USD): the capital, €600, ÷ 12. */
export const OKX_RUNG_EUR = 50;
export const OKX_CAPITAL_EUR = 12 * OKX_RUNG_EUR;
/** Deviation 2: one rung, in dollars, from `usdFrom` on: six a book, $600 a book (Davies, 2026-10-29). */
export const OKX_RUNG_USD = 100;
export const OKX_BOOK_USD = 6 * OKX_RUNG_USD;
/** An entry resting at a size this far from its rung's is re-sized (once, at Deviation 2's switch; EUR/USD rarely moves 5 %). */
export const OKX_RESIZE = 0.05;
/** Dollars a unit of the book's quote currency: EUR/USD for euros, 1 for USDC. */
export const okxUsdPerQuote = (book: OkxBook, eurusd: number | null) => (OKX_SPEC[book].quote === "EUR" ? eurusd : 1);
/** Deviation 2's factor: $600 over the €300 book's dollar value at EUR/USD. */
export const okxUsdFactor = (eurusd: number) => OKX_BOOK_USD / (6 * OKX_RUNG_EUR * eurusd);
export const OKX_STOP_MS = DAY;
/** LIVE's de-peg guard (`QUOTE_LIVE_DEPEG`, quotes_live.ts): 50 bps between the last print and fair. */
export const OKX_DEPEG = 0.005;
/** LIVE's daily loss stop: −1 % of the capital (both books) on a UTC day's closed trips. */
export const OKX_LOSS_STOP = 0.01;
/** The maker fee the paper books (OKX's EEA spot-only stablecoin rate); the stop's taker fee (OKX's standard spot taker). */
export const OKX_MAKER = 0;
export const OKX_TAKER = 0.001;
/** A recorded book read older than this is not the book an order meets. */
export const OKX_TOUCH_MAX_AGE_MS = 2 * M;
export const OKX_MAX_MINUTES = 120;
export const OKX_LEASE = "okx-quotes";
export const OKX_LEASE_MS = 25e3;
export const OKX_TABLES = { state: "okx_quote_state", events: "okx_quote_events", trips: "okx_quote_trips", minutes: "okx_quote_minutes", days: "okx_quote_days" } as const;

/** Each book: its quote currency, its coin, its price step and lot (OKX's instrument list, 2026-10-27), its page row. */
export const OKX_SPEC: Record<OkxBook, { quote: "EUR" | "USDC"; coin: "USDG" | "EURC"; tick: number; lot: number; minQty: number; id: string; name: string }> = {
  "USDG-EUR": { quote: "EUR", coin: "USDG", tick: 1e-4, lot: 1e-4, minQty: 1, id: "okxusdg", name: "Stablecoin quotes OKX USDG" },
  "EURC-USDC": { quote: "USDC", coin: "EURC", tick: 1e-3, lot: 1e-3, minQty: 1, id: "okxeurc", name: "Stablecoin quotes OKX EURC" },
};

/** Fair, in the book's quote currency a coin, from EUR/USD. */
export function okxFair(book: OkxBook, eurusd: number): number {
  return book === "USDG-EUR" ? 1 / eurusd : eurusd;
}
/** Pounds a unit of the book's quote currency: EUR/USD ÷ GBP/USD for euros, 1 ÷ GBP/USD for dollars. */
export function okxGbpPerQuote(book: OkxBook, eurusd: number | null, gbpusd: number | null): number | null {
  if (!gbpusd) return null;
  return OKX_SPEC[book].quote === "EUR" ? (eurusd ? eurusd / gbpusd : null) : 1 / gbpusd;
}
/** A rung in the book's quote currency: €50, or €50 in dollars at EUR/USD. */
export const okxRungQuote = (book: OkxBook, eurusd: number) => (OKX_SPEC[book].quote === "EUR" ? OKX_RUNG_EUR : OKX_RUNG_EUR * eurusd);
/** The capital in pounds at EUR/GBP (EUR/USD ÷ GBP/USD): a book's six rungs, or both books' twelve. */
export const okxCapitalGbp = (eurGbp: number, rungs = 6) => rungs * OKX_RUNG_EUR * eurGbp;

export type OkxSide = "bid" | "ask";
/** A print as the engine reads it: time (ms), price in the book's steps, quantity, the aggressor, the venue's id. */
export type OkxTapePrint = { ts: number; ticks: number; qty: number; side: "buy" | "sell"; id: number };
export type OkxOrder = { side: OkxSide; ticks: number; qty: number; fairAt: number; live: number; state: "pending" | "live" | "rejected"; oid: number };
export type OkxRung = {
  side: OkxSide; k: number; mode: "idle" | "quote" | "position"; o: OkxOrder | null;
  /** A position: what is still held, what was entered, at what price, when, from which print; what its exit fills made so far. */
  qty?: number; filled?: number; entry?: number; tEntry?: number; fillTs?: number; fillId?: number; exitValue?: number; xEntry?: number | null;
};
export type OkxBookState = { book: OkxBook; rungs: OkxRung[]; lastX: number | null; lastPrint: OkxTapePrint | null; nextOid: number };
/** The account's daily loss stop, both books: the UTC day it counts, that day's closed trips in pounds, whether it has stopped. */
export type OkxAccount = { day: string | null; dayGbp: number; stopped: boolean };
export type OkxTouch = { bid: number; ask: number; at: number };
export type OkxMinuteInputs = {
  eurusd: number | null; gbpusd: number | null; prints: OkxTapePrint[]; touchStart: OkxTouch | null; touchEnd: OkxTouch | null;
  /** The account's loss stop has stopped today's entries (`okxAccountTrips`). */
  stopped?: boolean;
  /** Deviation 2: the rung in dollars from `usdFrom` on; absent, the €50 rung. */
  rungUsd?: number | null;
};
export type OkxTrip = {
  book: OkxBook; side: OkxSide; k: number; tEntry: number; fillTs: number; fillId: number; entry: number; qty: number;
  tExit: number; exit: number; how: "maker" | "taker"; xEntry: number | null; notionalGbp: number; pnlQuote: number; pnlGbp: number;
};
export type OkxEvent = { book: OkxBook; minute: number; side: OkxSide | "-"; k: number; kind: string; ticks: number | null; detail: Record<string, unknown> };

export function newOkxBookState(book: OkxBook): OkxBookState {
  const rungs: OkxRung[] = [];
  for (const side of ["bid", "ask"] as OkxSide[]) for (const k of OKX_RUNGS) rungs.push({ side, k, mode: "idle", o: null });
  return { book, rungs, lastX: null, lastPrint: null, nextOid: 1 };
}

/** The account at minute `t`: a new UTC day starts at zero and quotes again. */
export function okxAccountMinute(a: OkxAccount, t: number): OkxAccount {
  const day = dayOf(t);
  return a.day === day ? a : { day, dayGbp: 0, stopped: false };
}
/** A minute's closed trips on the account: their pounds added to the day's; at −1 % of `capitalGbp` it stops the day's entries. */
export function okxAccountTrips(a: OkxAccount, trips: Array<{ pnlGbp: number }>, capitalGbp: number | null): OkxAccount {
  const dayGbp = a.dayGbp + trips.reduce((x, t) => x + t.pnlGbp, 0);
  return { ...a, dayGbp, stopped: a.stopped || (capitalGbp != null && capitalGbp > 0 && dayGbp <= -OKX_LOSS_STOP * capitalGbp) };
}

/** An entry k from fair on the book's grid: a bid down, an ask up (PR5's `quoteTicks` with the book's step). */
export function okxQuoteTicks(fair: number, k: number, side: OkxSide, tick: number): number {
  return side === "bid" ? Math.floor(fair * (1 - k) / tick + 1e-9) : Math.ceil(fair * (1 + k) / tick - 1e-9);
}
/** The exit at fair: a long sells at fair rounded up, a short buys it back rounded down (PR5's `exitTicks`). */
export function okxExitTicks(fair: number, positionSide: OkxSide, tick: number): number {
  return positionSide === "bid" ? Math.ceil(fair / tick - 1e-9) : Math.floor(fair / tick + 1e-9);
}
/** The X a minute is decided on: live, else inside a closure the book's last, else none (PR5-W's rule, `weekendX`). */
export function okxXAt(t: number, live: number | null, lastX: number | null): { x: number | null; held: boolean } {
  if (live) return { x: live, held: false };
  if (lastX && inQuoteClosure(t)) return { x: lastX, held: true };
  return { x: null, held: false };
}

/**
 * Would a post-only order at `ticks` be refused when it goes live? Against the recorded book when one is fresh (a bid at or
 * above its best ask, an ask at or below its best bid); else the touch the last print implies, PR5's `blocks`.
 */
export function okxCrosses(side: OkxSide, ticks: number, tick: number, touch: OkxTouch | null, lp: OkxTapePrint | null): boolean {
  if (touch) {
    const px = ticks * tick;
    return side === "bid" ? px >= touch.ask - 1e-12 : px <= touch.bid + 1e-12;
  }
  if (!lp) return false;
  return side === "bid" ? lp.ticks < ticks || (lp.ticks === ticks && lp.side === "buy") : lp.ticks > ticks || (lp.ticks === ticks && lp.side === "sell");
}

/** Does a print fill a resting order, LIVE's "at" rule: strictly through it, or at it from the other side. */
export function okxFills(side: OkxSide, ticks: number, p: OkxTapePrint): boolean {
  return side === "bid" ? p.ticks < ticks || (p.ticks === ticks && p.side === "sell") : p.ticks > ticks || (p.ticks === ticks && p.side === "buy");
}

const lotFloor = (x: number, lot: number) => Math.floor(x / lot + 1e-9) * lot;

/**
 * One minute of the rule for one book, mutating `s`: completed trips, the order log, and how many orders it placed (every
 * placement, re-price and re-placement counts one). The account's loss stop comes in as `inp.stopped`.
 */
export function stepOkxMinute(s: OkxBookState, t: number, inp: OkxMinuteInputs): { trips: OkxTrip[]; events: OkxEvent[]; orders: number; x: number | null; held: boolean; fair: number | null; guard: string | null; gbpq: number | null } {
  const spec = OKX_SPEC[s.book], tick = spec.tick;
  const trips: OkxTrip[] = [], events: OkxEvent[] = [];
  const evKey = new Map<string, OkxEvent>();
  let orders = 0;
  const ev = (r: OkxRung | null, kind: string, ticks: number | null, detail: Record<string, unknown> = {}) => {
    const key = `${r ? r.side : "-"}|${r ? r.k : 0}|${kind}`;
    const was = evKey.get(key);
    if (was && kind === "exit") { was.detail = { ...was.detail, qty: r9(Number(was.detail.qty ?? 0) + Number(detail.qty ?? 0)), parts: Number(was.detail.parts ?? 1) + 1 }; return; }
    const e: OkxEvent = { book: s.book, minute: t, side: r ? r.side : "-", k: r ? r.k : 0, kind, ticks, detail };
    if (was) Object.assign(was, e); else { evKey.set(key, e); events.push(e); }
  };
  const { x, held } = okxXAt(t, inp.eurusd, s.lastX);
  if (inp.eurusd) s.lastX = inp.eurusd;
  const f = x ? okxFair(s.book, x) : null;
  const gbpq = okxGbpPerQuote(s.book, x, inp.gbpusd);
  const lp = s.lastPrint;
  const guard = f === null ? "dark" : inp.stopped ? "loss stop" : lp && Math.abs(lp.ticks * tick / f - 1) > OKX_DEPEG ? "de-peg" : null;
  const newOrder = (side: OkxSide, ticks: number, qty: number, fairAt: number): OkxOrder => ({ side, ticks, qty, fairAt, live: t + M, state: "pending", oid: s.nextOid++ });
  const rungQuote = inp.rungUsd ? (spec.quote === "EUR" ? (x ? inp.rungUsd / x : 0) : inp.rungUsd) : okxRungQuote(s.book, x ?? 0);
  const entryQty = (ticks: number) => r9(lotFloor(rungQuote / (ticks * tick), spec.lot));
  // Deviation 2: an entry resting at a size more than 5 % from its rung's is re-sized (the switch to $100 rungs, once).
  const offSize = (o: OkxOrder) => inp.rungUsd != null && entryQty(o.ticks) > 0 && Math.abs(o.qty / entryQty(o.ticks) - 1) > OKX_RESIZE;
  // 1. the turn at the start of minute t
  for (const r of s.rungs) {
    if (r.mode === "idle" || r.mode === "quote") {
      const o = r.o;
      if (guard) {
        if (r.mode === "quote") { ev(r, "withdraw", o?.ticks ?? null, { why: guard }); r.mode = "idle"; r.o = null; }
        continue;
      }
      const fair = f!;
      if (r.mode === "idle" || !o) {
        const tk = okxQuoteTicks(fair, r.k, r.side, tick), q = entryQty(tk);
        if (q < spec.minQty) continue;
        r.o = newOrder(r.side, tk, q, fair); r.mode = "quote"; orders++;
        ev(r, "order", tk, { what: "place", leg: "entry", oid: r.o.oid, qty: q, fair, x, held });
        continue;
      }
      if (o.state === "rejected") {
        if (Math.abs(fair / o.fairAt - 1) > OKX_REPRICE) { o.ticks = okxQuoteTicks(fair, r.k, r.side, tick); o.qty = entryQty(o.ticks); o.fairAt = fair; }
        if (offSize(o)) o.qty = entryQty(o.ticks);
        if (!okxCrosses(o.side, o.ticks, tick, inp.touchStart, lp)) { o.live = t + M; o.state = "pending"; orders++; ev(r, "order", o.ticks, { what: "replace", leg: "entry", oid: o.oid, qty: o.qty, fair, x, held }); }
        continue;
      }
      if (Math.abs(fair / o.fairAt - 1) > OKX_REPRICE) {
        o.ticks = okxQuoteTicks(fair, r.k, r.side, tick); o.qty = entryQty(o.ticks); o.fairAt = fair; o.live = t + M; o.state = "pending"; orders++;
        ev(r, "order", o.ticks, { what: "reprice", leg: "entry", oid: o.oid, qty: o.qty, fair, x, held });
      } else if (offSize(o)) {
        o.qty = entryQty(o.ticks); o.live = t + M; o.state = "pending"; orders++;
        ev(r, "order", o.ticks, { what: "resize", leg: "entry", oid: o.oid, qty: o.qty, fair, x, held });
      }
    } else {
      const o = r.o;                                   // the exit, null until a fair exists
      const xs: OkxSide = r.side === "bid" ? "ask" : "bid";
      if (!o) {
        if (f !== null) { r.o = newOrder(xs, okxExitTicks(f, r.side, tick), r.qty!, f); orders++; ev(r, "order", r.o.ticks, { what: "place", leg: "exit", oid: r.o.oid, qty: r.qty, fair: f, x, held }); }
      } else if (o.state === "rejected") {
        if (f !== null && Math.abs(f / o.fairAt - 1) > OKX_REPRICE) { o.ticks = okxExitTicks(f, r.side, tick); o.fairAt = f; }
        if (!okxCrosses(o.side, o.ticks, tick, inp.touchStart, lp)) { o.live = t + M; o.state = "pending"; orders++; ev(r, "order", o.ticks, { what: "replace", leg: "exit", oid: o.oid, qty: o.qty, fair: f, x, held }); }
      } else if (f !== null && Math.abs(f / o.fairAt - 1) > OKX_REPRICE) {
        o.ticks = okxExitTicks(f, r.side, tick); o.fairAt = f; o.live = t + M; o.state = "pending"; orders++;
        ev(r, "order", o.ticks, { what: "reprice", leg: "exit", oid: o.oid, qty: o.qty, fair: f, x, held });
      }
    }
  }
  // 2. go-live at the start of minute t: a post-only order that would cross the book it meets is refused
  for (const r of s.rungs) {
    const o = r.o;
    if (o && o.state === "pending" && o.live === t) {
      o.state = okxCrosses(o.side, o.ticks, tick, inp.touchStart, lp) ? "rejected" : "live";
      if (o.state === "rejected") ev(r, "refused", o.ticks, { oid: o.oid, touch: inp.touchStart, lastPrint: lp && { id: lp.id, ticks: lp.ticks, side: lp.side, ts: lp.ts } });
    }
  }
  const close = (r: OkxRung, how: "maker" | "taker", minute: number) => {
    const filled = r.filled!, entry = r.entry!, ev2 = r.exitValue!;
    const pnlQuote = r.side === "bid" ? ev2 - entry * filled : entry * filled - ev2;
    const g = gbpq ?? r.xEntry ?? null;
    const trip: OkxTrip = {
      book: s.book, side: r.side, k: r.k, tEntry: r.tEntry!, fillTs: r.fillTs!, fillId: r.fillId!, entry, qty: filled,
      tExit: minute, exit: r9(ev2 / filled), how, xEntry: r.xEntry ?? null, notionalGbp: entry * filled * (r.xEntry ?? g ?? 0),
      pnlQuote: r9(pnlQuote), pnlGbp: g == null ? 0 : pnlQuote * g,
    };
    trips.push(trip);
    r.mode = "idle"; r.o = null;
    for (const key of ["qty", "filled", "entry", "tEntry", "fillTs", "fillId", "exitValue", "xEntry"] as const) delete r[key];
  };
  // 3. the prints of minute t, in time order, each shared by the orders it fills, best price first
  for (const p of inp.prints) {
    let avail = p.qty;
    const hit = s.rungs.filter((r) => r.o && r.o.state === "live" && okxFills(r.o.side, r.o.ticks, p))
      .sort((a, b) => (a.o!.side === "bid" ? b.o!.ticks - a.o!.ticks : a.o!.ticks - b.o!.ticks) || a.o!.oid - b.o!.oid);
    for (const r of hit) {
      if (avail <= 1e-12) break;
      const o = r.o!;
      const q = r9(Math.min(o.qty, avail));
      if (q <= 0) continue;
      avail = r9(avail - q);
      const px = o.ticks * tick;
      if (r.mode === "quote") {
        Object.assign(r, { mode: "position", o: null, qty: q, filled: q, entry: px, tEntry: t, fillTs: p.ts, fillId: p.id, exitValue: 0, xEntry: gbpq });
        ev(r, "fill", o.ticks, { oid: o.oid, qty: q, of: o.qty, print: p.id, printTicks: p.ticks, printSide: p.side });
      } else {
        r.qty = r9(r.qty! - q); r.exitValue = r9(r.exitValue! + q * px); o.qty = r9(o.qty - q);
        ev(r, "exit", o.ticks, { oid: o.oid, qty: q, print: p.id, parts: 1 });
        if (r.qty < spec.lot / 2) close(r, "maker", t);
      }
    }
    s.lastPrint = p;
  }
  // 4. the 24-hour stop at the end of minute t; a position entered this minute is not checked (PR5's)
  for (const r of s.rungs) {
    if (r.mode !== "position" || r.tEntry === t || t < r.tEntry! + OKX_STOP_MS) continue;
    const touch = inp.touchEnd;
    const base = touch ? (r.side === "bid" ? touch.bid : touch.ask) : s.lastPrint ? s.lastPrint.ticks * tick : null;
    if (base == null) continue;
    const px = r.side === "bid" ? base * (1 - OKX_TAKER) : base * (1 + OKX_TAKER);
    ev(r, "stop", Math.round(base / tick), { qty: r.qty, px, from: touch ? "book" : "last print" });
    r.exitValue = r9(r.exitValue! + r.qty! * px); r.qty = 0;
    close(r, "taker", t);
  }
  return { trips, events, orders, x, held, fair: f, guard, gbpq };
}

// ------------------------------------------------------------------------------------------------------------- driver

export type OkxQuoteState = {
  lastMinute: number; startedAt: number;
  books: Record<OkxBook, OkxBookState>;
  /** The newest trade id each book's tape has been read past. */
  fed: Record<OkxBook, number>;
  /** The last GBP/USD a minute had (pounds only: a trip that closes while it is dark is counted at it). */
  gbpusd?: number | null;
  /** The account's daily loss stop, both books. */
  account?: OkxAccount;
  /** Deviation 2: the first minute decided at $100 a rung, the EUR/USD it was switched at, and the factor before it. */
  usdFrom?: number;
  usdEurusd?: number;
  usdFactor?: number;
  /** The compounding (2026-10-31): each book's capital, what it has realised since, and each day's capital (okx_compound.ts). */
  compound?: OkxCompound;
  fault?: { key: string; at: number };
};
export type OkxQuoteReport = { minutes: number; from: number | null; to: number | null; prints: number; fills: number; exits: number; stops: number; orders: number; refused: number; errors: string[]; report: boolean; skipped?: string };

/** The first 00:00 UTC strictly after `now`: where an empty record's window starts. */
export const okxStart = (now: number) => (Math.floor(now / DAY) + 1) * DAY;

export function okxNewState(start: number, fed: Record<OkxBook, number>): OkxQuoteState {
  return {
    lastMinute: start - M, startedAt: start, books: Object.fromEntries(OKX_BOOKS.map((b) => [b, newOkxBookState(b)])) as Record<OkxBook, OkxBookState>, fed, gbpusd: null,
    account: { day: null, dayGbp: 0, stopped: false },
  };
}

/** The recorded read the minute meets: the latest at or before `at`, at most `OKX_TOUCH_MAX_AGE_MS` old. */
export function okxTouchAt(rows: OkxTouch[], at: number): OkxTouch | null {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].at <= at) lo = mid + 1; else hi = mid; }
  const k = lo - 1;
  return k >= 0 && rows[k].at >= at - OKX_TOUCH_MAX_AGE_MS ? rows[k] : null;
}

/**
 * Decide every minute the recorder has covered on both books and not yet decided, at most `OKX_MAX_MINUTES`, one minute behind
 * that coverage. Idempotent by natural keys: events, trips and minutes are upserted, and the state moves only after them.
 */
export async function runOkxQuotes(d: { db: Db; now: number; holder: string; rec: OkxRecState | null }): Promise<OkxQuoteReport> {
  const T = OKX_TABLES;
  const report: OkxQuoteReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, errors: [], report: false };
  const leased = await d.db.claim("agent_locks", `name=eq.${OKX_LEASE}&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + OKX_LEASE_MS), holder: d.holder });
  if (!leased.length) return { ...report, skipped: "another run holds the lease" };
  try {
    const curs = d.rec?.cursors ?? {};
    if (!OKX_BOOKS.every((b) => curs[b] && curs[b]!.top > 0)) return { ...report, skipped: "the recorder has not covered every book yet" };
    const covered = Math.min(...OKX_BOOKS.map((b) => curs[b]!.coveredTo));
    const horizonAll = minuteOf(covered) - M;
    const rows = await d.db.select<{ state: OkxQuoteState | Record<string, never> }>(T.state, "id=eq.1&select=state");
    let st = rows[0]?.state as OkxQuoteState | undefined;
    if (!st || !("books" in st)) {
      const fed = {} as Record<OkxBook, number>;
      for (const b of OKX_BOOKS) {
        const top = await d.db.select<{ trade_id: number }>("okx_trades", `book=eq.${b}&select=trade_id&order=trade_id.desc&limit=1`);
        fed[b] = top[0] ? Number(top[0].trade_id) : 0;
      }
      st = okxNewState(okxStart(d.now), fed);
    }
    const first = st.lastMinute + M, horizon = Math.min(horizonAll, st.lastMinute + OKX_MAX_MINUTES * M, minuteOf(d.now) - M);
    if (horizon < first) { await save(d, st, report); return { ...report, skipped: "nothing new to decide" }; }
    const bars = async (table: string, kind: string) => (await d.db.selectAll<{ t: string; value: number }>(table,
      `kind=eq.${encodeURIComponent(kind)}&t=gte.${enc(first - 10 * M)}&t=lte.${enc(horizon)}&select=t,value&order=kind.asc,t.asc`)).map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    const eurBars = await bars("cb_quote_inputs", "fx:EURUSD");
    const gbpBars = await bars("agent_quote_inputs", "fx");
    const trips: ReturnType<typeof okxTripRow>[] = [], events: ReturnType<typeof okxEventRow>[] = [], minutes: Array<Record<string, unknown>> = [];
    // Each book's tape and book reads for the span, then the minutes in order, both books a minute: the loss stop is the account's.
    const tape = {} as Record<OkxBook, { prints: OkxTapePrint[]; touches: OkxTouch[]; j: number; maxId: number }>;
    for (const b of OKX_BOOKS) {
      const tick = OKX_SPEC[b].tick;
      const pRows = await d.db.selectAll<{ trade_id: number; ts: string; price: number; size: number; side: string }>("okx_trades",
        `book=eq.${b}&trade_id=gt.${st.fed[b]}&ts=gte.${enc(first)}&ts=lt.${enc(horizon + M)}&select=trade_id,ts,price,size,side&order=book.asc,trade_id.asc`);
      const prints: OkxTapePrint[] = pRows.map((r) => ({ ts: msOf(r.ts), ticks: Math.round(Number(r.price) / tick), qty: Number(r.size), side: r.side === "buy" ? "buy" as const : "sell" as const, id: Number(r.trade_id) }))
        .sort((p, q) => p.ts - q.ts || p.id - q.id);
      const tRows = await d.db.selectAll<{ ts: string; bid: number; ask: number }>("okx_books",
        `book=eq.${b}&ts=gte.${enc(first - OKX_TOUCH_MAX_AGE_MS)}&ts=lt.${enc(horizon + M)}&select=ts,bid,ask&order=book.asc,ts.asc`);
      tape[b] = { prints, touches: tRows.map((r) => ({ at: msOf(r.ts), bid: Number(r.bid), ask: Number(r.ask) })), j: 0, maxId: Math.max(0, ...pRows.map((r) => Number(r.trade_id))) };
      report.prints += prints.length;
    }
    let gbpusd = st.gbpusd ?? null;
    let acct: OkxAccount = st.account ?? { day: null, dayGbp: 0, stopped: false };
    // Deviation 2: the first minute this code decides is the switch to $100 rungs, at its EUR/USD (the latest bar at or
    // before it, else the books' last); with no rate yet it waits for one.
    if (st.usdFrom == null) {
      const before = eurBars.filter(([at]) => at <= first).at(-1)?.[1] ?? st.books["EURC-USDC"].lastX ?? st.books["USDG-EUR"].lastX;
      if (before) { st.usdFrom = first; st.usdEurusd = before; st.usdFactor = okxUsdFactor(before); }
    }
    for (let t = first; t <= horizon; t += M) {
      const eb = fxBarAt(t, eurBars), gb = fxBarAt(t, gbpBars);
      if (gb) gbpusd = gb[1];
      acct = okxAccountMinute(acct, t);
      const usd = st.usdFrom != null && t >= st.usdFrom;
      // The compounding (2026-10-31): each book's capital over its funded, set at the day's first minute (1 before the start).
      const mult = Object.fromEntries(OKX_BOOKS.map((b) => [b, okxCompoundMinute(st!, b, t)])) as Record<OkxBook, number>;
      for (const b of OKX_BOOKS) {
        const tp = tape[b], tick = OKX_SPEC[b].tick;
        const mine: OkxTapePrint[] = [];
        while (tp.j < tp.prints.length && tp.prints[tp.j].ts < t + M) { mine.push(tp.prints[tp.j]); tp.j++; }
        const out = stepOkxMinute(st.books[b], t, { eurusd: eb ? eb[1] : null, gbpusd, prints: mine, touchStart: okxTouchAt(tp.touches, t), touchEnd: okxTouchAt(tp.touches, t + M - 1), stopped: acct.stopped,
          rungUsd: usd ? OKX_RUNG_USD * mult[b] : null });
        const eurGbp = out.x && gbpusd ? out.x / gbpusd : null;            // EUR/USD ÷ GBP/USD
        const capGbp = usd ? (gbpusd ? OKX_BOOK_USD * (mult["USDG-EUR"] + mult["EURC-USDC"]) / gbpusd : null) : eurGbp == null ? null : okxCapitalGbp(eurGbp, 12);
        acct = okxAccountTrips(acct, out.trips, capGbp);
        const last = st.books[b].lastPrint, ts = okxTouchAt(tp.touches, t);
        minutes.push({
          book: b, minute: iso(t), x: out.x, x_held: out.held, fair: out.fair, gbp_per_quote: out.gbpq, guard: out.guard,
          prints_n: mine.length, vol: r9(mine.reduce((a, p) => a + p.qty * p.ticks * tick, 0)), last: last ? r9(last.ticks * tick) : null,
          bid: ts?.bid ?? null, ask: ts?.ask ?? null,
        });
        for (const x of out.trips) {
          trips.push(okxTripRow(x));
          okxCompoundTrip(st, b, x.tExit, x.pnlQuote * (okxUsdPerQuote(b, out.x) ?? NaN));
        }
        events.push(...out.events.map(okxEventRow));
        report.orders += out.orders;
      }
    }
    for (const b of OKX_BOOKS) if (tape[b].maxId) st.fed[b] = Math.max(st.fed[b], tape[b].maxId);
    st.account = acct;
    st.gbpusd = gbpusd;
    report.minutes = (horizon - first) / M + 1; report.from = first; report.to = horizon;
    report.fills = events.filter((e) => e.kind === "fill").length;
    report.exits = events.filter((e) => e.kind === "exit").length;
    report.stops = events.filter((e) => e.kind === "stop").length;
    report.refused = events.filter((e) => e.kind === "refused").length;
    if (events.length) await d.db.upsert(T.events, events, "book,minute,side,k,kind");
    if (trips.length) await d.db.upsert(T.trips, trips, "book,side,k,t_entry");
    if (minutes.length) await d.db.upsert(T.minutes, minutes, "book,minute");
    st.lastMinute = horizon;
    await save(d, st, report);
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    report.report = true;
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${OKX_LEASE}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
}

export function okxTripRow(x: OkxTrip) {
  return {
    book: x.book, side: x.side, k: x.k, t_entry: iso(x.tEntry), fill_ts: iso(x.fillTs), fill_trade_id: x.fillId, entry: x.entry, qty: x.qty,
    x_entry: x.xEntry, t_exit: iso(x.tExit), exit: x.exit, how: x.how, notional_gbp: r9(x.notionalGbp), pnl_quote: x.pnlQuote, pnl_gbp: r9(x.pnlGbp),
  };
}
export function okxEventRow(e: OkxEvent) {
  return { book: e.book, minute: iso(e.minute), side: e.side, k: e.k, kind: e.kind, ticks: e.ticks, detail: e.detail };
}

async function save(d: { db: Db; now: number }, st: OkxQuoteState, report: OkxQuoteReport) {
  const key = faultKey(report.errors);
  report.report = reportDue(st.fault ?? null, key, d.now);
  if (!key) delete st.fault; else if (report.report) st.fault = { key, at: d.now };
  await d.db.upsert(OKX_TABLES.state, [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null }], "id");
}

// ------------------------------------------------------------------------------------------------------------- page

/** How many round trips and orders a page lists, newest first. */
export const OKX_PAGE_ROWS = 30;

type TripRow = { book: string; side: string; k: number | string; t_entry: string; t_exit: string; entry: number | string; exit: number | string; qty: number | string; how: string; pnl_gbp: number | string; pnl_quote: number | string };
type DayRow = { book: string; day: string; orders: number; fills: number; trips: number; won: number; realised_gbp: number | string };
type EventRow = { book: string; minute: string; side: string; k: number | string; kind: string; ticks: number | null; detail: Record<string, unknown> };
type MinuteRow = { book: string; minute: string; fair: number | string | null; last: number | string | null; gbp_per_quote: number | string | null };

/**
 * One book's twin for the Agents page, in the shape Coinbase's arms have (`cbQuotesView`), so TESTING's row and its page are
 * theirs, prices in the book's own currency, `venue` "okx". Since Deviation 2 its money is in DOLLARS (`ccy` "USD"): $600 a
 * book, each trip's P&L in its quote currency at the dollars a unit (EUR/USD for euros, 1 for USDC), and everything entered
 * before `usdFrom` (trips, held rungs, order sizes) × `usdFactor`. Pounds beside them at the last GBP/USD. Prices, counts and
 * percentages are not scaled. null before the record has decided a minute.
 */
export function okxBookView(input: {
  book: OkxBook; st: { state: OkxQuoteState | Record<string, never>; last_minute: string | null; last_error: string | null } | null;
  trips: TripRow[]; days: DayRow[]; events: EventRow[]; minute: MinuteRow | null; nowMs: number; dayStartMs: number; gbpusd: number | null; eurusd: number | null;
}) {
  const st = input.st, s = st?.state as OkxQuoteState | undefined;
  if (!st?.last_minute || !s || !("books" in s)) return null;
  const b = input.book, spec = OKX_SPEC[b], bs = s.books[b];
  if (!bs) return null;
  const upq = okxUsdPerQuote(b, input.eurusd) ?? 0;
  const from = s.usdFrom ?? Infinity, factor = s.usdFactor ?? 1;
  const scale = (tEntryMs: number) => (tEntryMs < from ? factor : 1);
  const gbp = (usd: number) => (input.gbpusd ? usd / input.gbpusd : 0);
  const tripUsd = (t: TripRow) => Number(t.pnl_quote) * upq * scale(Date.parse(t.t_entry));
  const trips = input.trips.filter((t) => t.book === b).sort((a, c) => Date.parse(c.t_exit) - Date.parse(a.t_exit) || Date.parse(c.t_entry) - Date.parse(a.t_entry));
  const realisedUsd = trips.reduce((a, t) => a + tripUsd(t), 0);
  const todayUsd = trips.filter((t) => Date.parse(t.t_exit) >= input.dayStartMs).reduce((a, t) => a + tripUsd(t), 0);
  const capitalUsd = OKX_BOOK_USD;
  const lastPx = input.minute?.last != null ? Number(input.minute.last) : bs.lastPrint ? bs.lastPrint.ticks * spec.tick : null;
  const px = (ticks: number) => Number((ticks * spec.tick).toFixed(6));
  const rungs: Array<Record<string, unknown>> = [];
  let held = 0, quoting = 0, costUsd = 0, unrealisedUsd = 0, quotingUsd = 0;
  for (const r of bs.rungs) {
    if (r.mode === "position") {
      held++;
      const k = scale(r.tEntry ?? 0);
      const cost = r.entry! * r.qty! * upq * k;
      costUsd += cost;
      const made = lastPx == null ? null : (r.side === "bid" ? r.qty! * (lastPx - r.entry!) : r.qty! * (r.entry! - lastPx)) * upq * k;
      if (made != null) unrealisedUsd += made;
      rungs.push({ book: b, side: r.side, k: r.k, order: r.o ? { price: px(r.o.ticks), leg: "exit", state: r.o.state } : null,
        held: { base: r.qty! * k, avgEntry: r.entry, since: r.tEntry != null ? iso(r.tEntry) : null, costUsd: cost, unrealisedUsd: made, costGbp: gbp(cost), unrealisedGbp: made == null ? null : gbp(made) } });
    } else if (r.mode === "quote" && r.o) {
      quoting++;
      quotingUsd += OKX_RUNG_USD;
      rungs.push({ book: b, side: r.side, k: r.k, order: { price: px(r.o.ticks), leg: "entry", state: r.o.state }, held: null });
    } else rungs.push({ book: b, side: r.side, k: r.k, order: null, held: null });
  }
  const valueUsd = costUsd + quotingUsd;
  const lagMinutes = Math.round((input.nowMs - Date.parse(st.last_minute)) / M);
  const today = new Date(input.dayStartMs).toISOString().slice(0, 10);
  const dayUsd = (day: string) => trips.filter((t) => t.t_exit.slice(0, 10) === day || new Date(Date.parse(t.t_exit)).toISOString().slice(0, 10) === day).reduce((a, t) => a + tripUsd(t), 0);
  const days = input.days.filter((d) => d.book === b).map((d) => {
    const day = String(d.day).slice(0, 10), usd = dayUsd(day);
    return { day, orders: Number(d.orders), fills: Number(d.fills), trips: Number(d.trips), won: Number(d.won), realisedUsd: usd, realisedGbp: gbp(usd), today: day === today };
  }).sort((a, c) => (a.day < c.day ? 1 : -1));
  return {
    venue: "okx" as const, ccy: "USD" as const,
    running: lagMinutes <= 5, lagMinutes, lastError: st.last_error,
    capitalUsd, costUsd, valueUsd, unrealisedUsd, realisedUsd, todayUsd, feesUsd: 0,
    capitalGbp: gbp(capitalUsd), costGbp: gbp(costUsd), valueGbp: gbp(valueUsd), unrealisedGbp: gbp(unrealisedUsd), realisedGbp: gbp(realisedUsd),
    todayGbp: gbp(todayUsd), feesGbp: 0,
    usdFrom: Number.isFinite(from) ? iso(from) : null, usdFactor: s.usdFactor ?? null,
    heldRungs: held, openOrders: quoting,
    detail: {
      books: [{ book: b, lastPrice: lastPx, fair: input.minute?.fair != null ? Number(input.minute.fair) : null, index: null,
        realisedUsd, realisedGbp: gbp(realisedUsd), trips: trips.length, won: trips.filter((t) => Number(t.pnl_gbp) > 0).length }],
      rungs, inventory: null, days,
      trips: trips.slice(0, OKX_PAGE_ROWS).map((t) => {
        const k = scale(Date.parse(t.t_entry)), usd = tripUsd(t);
        return {
          book: t.book, side: t.side, k: Number(t.k), tEntry: t.t_entry, tExit: t.t_exit, entry: Number(t.entry), exit: Number(t.exit), qty: Number(t.qty) * k,
          how: t.how === "taker" ? "stop" : "maker", feesUsd: 0, feesGbp: 0, pnlUsd: usd, pnlGbp: gbp(usd),
        };
      }),
      tripCount: trips.length, tripsWon: trips.filter((t) => Number(t.pnl_gbp) > 0).length,
      orders: input.events.filter((e) => e.book === b && (e.kind === "order" || e.kind === "refused")).slice(0, OKX_PAGE_ROWS).map((e) => {
        const leg = String(e.detail?.leg ?? "entry");
        return {
          id: `${e.book}|${e.minute}|${e.side}|${e.k}|${e.kind}`, ts: e.minute, book: e.book, side: e.side, k: Number(e.k), leg,
          venueSide: (e.side === "bid") === (leg !== "exit") ? "buy" : "sell",
          price: e.ticks == null ? null : px(e.ticks), base: e.detail?.qty != null ? Number(e.detail.qty) * scale(Date.parse(e.minute)) : null,
          state: e.kind === "refused" ? "rejected" : "new", reason: e.kind === "refused" ? "post-only: it would have crossed the book" : null,
        };
      }),
    },
    twin: { id: spec.id, name: spec.name, startedAt: s.startedAt ? iso(s.startedAt) : null, mode: "running", lastTurn: st.last_minute, converting: [] },
  };
}

/** Both books for the Agents page, from the twin's own tables: `[USDG, EURC]`, each null-filtered. Missing tables leave none. */
export async function readOkxQuotes(d: Db, now: number, dayStartMs: number) {
  try {
    const [st, trips, days, events, fx, eurFx] = await Promise.all([
      d.select<{ state: OkxQuoteState | Record<string, never>; last_minute: string | null; last_error: string | null }>(OKX_TABLES.state, "id=eq.1&select=state,last_minute,last_error"),
      d.selectAll<TripRow>(OKX_TABLES.trips, "select=book,side,k,t_entry,t_exit,entry,exit,qty,how,pnl_gbp,pnl_quote&order=book.asc,side.asc,k.asc,t_entry.asc"),
      d.select<DayRow>(OKX_TABLES.days, "select=book,day,orders,fills,trips,won,realised_gbp&order=day.desc&limit=120"),
      d.select<EventRow>(OKX_TABLES.events, `kind=in.(order,refused)&select=book,minute,side,k,kind,ticks,detail&order=minute.desc&limit=${OKX_PAGE_ROWS * 2}`),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
      d.select<{ value: number }>("cb_quote_inputs", "kind=eq.fx%3AEURUSD&select=value&order=t.desc&limit=1"),
    ]);
    if (!st[0]?.last_minute) return [];
    const mins = await d.select<MinuteRow>(OKX_TABLES.minutes, `minute=eq.${encodeURIComponent(new Date(Date.parse(st[0].last_minute)).toISOString())}&select=book,minute,fair,last,gbp_per_quote`);
    return OKX_BOOKS.map((book) => okxBookView({
      book, st: st[0], trips, days, events, minute: mins.find((m) => m.book === book) ?? null, nowMs: now, dayStartMs,
      gbpusd: fx[0] ? Number(fx[0].value) : null, eurusd: eurFx[0] ? Number(eurFx[0].value) : null,
    })).filter((v) => v != null);
  } catch { return []; }
}
