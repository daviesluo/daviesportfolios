// A SIMULATED Revolut X account, for the realistic twins of PR5's live executor (`quotes_twin.ts`; Davies, 2026-10-02:
// "一定要确保新架构真实"). The live executor's own code, and the live client's own code under it (`revxVenue` and
// `toOrderView` in _shared/revx.ts), run against this account exactly as they run against the venue: it answers the same
// endpoints in the venue's own fields. Nothing here calls a network, holds a key or reads a secret, and nothing it does
// can reach the venue: its `fetch` answers from memory and refuses every path it does not know.
//
// THE RULES, each the venue's as measured, and each pinned in revx_sim.test.ts with a counterfactual:
//   * A resting order fills only on a PUBLIC PRINT strictly through its price, by the print's own base quantity: an
//     aggressor that traded beyond our level would have taken us first, but only as much as it traded beyond us. Our
//     orders a print goes through share its quantity, the best price first (then the earlier order). A print AT our
//     price fills nothing: where we stood in its queue is unknown (QUEUE, ledger item 5a.4, measures it). Prints are
//     applied in time order, between the executor's turns, as the venue fills between them; an order fills only from
//     prints after it reached the venue, and not after its cancel landed.
//   * Money moves as Revolut X moves it (PR5's live fills 1154–1314): the pounds in whole pennies on an order's whole
//     notional so far, a sell's credit FLOORED and a buy's debit rounded UP; the reply's `filled_amount` is that amount and
//     its `average_fill_price` that amount over the coins, at the price step. A maker pays 0 %. A taker pays 0.09 %: a buy
//     in the coin, rounded up to the base step (1154: 0.03566 USDT on 39.61965), a sell in pounds, rounded up to the penny.
//   * A resting buy holds its pounds rounded UP to the penny, a resting sell its coin; an order the account cannot cover
//     is refused 422 "Not enough funds! Wanted … but has only …", as the venue words it (1521, 1635).
//   * A post-only order that would cross the book is taken and then `rejected`, `post_only_immediate_match` (1517, 1536).
//     The book is the one the turn met (`SimBookSource`); where none was read, the touch the last print implies, a tick
//     wide (a post-only order crosses it exactly when the paper rule's `blocks` says the market is through it).
//   * A marketable IOC (the 24-hour stop; the taker conversions of the live account's go-live, which the validation
//     replays) walks the levels of that book up to its limit and fills what they hold; the rest is cancelled. With only a
//     touch known (the last print's), it fills there, its depth unknown. The twins' own conversions are makers (rule 1).
//   * A take (TAKE, docs/agents/reviews/2026-10-03-take-prereg.md step 5; `markTake` names it by its client id before
//     its POST) is an IOC that walks instead the first RECORDED read of the book after its instant (`takeRead`: the read
//     the turn met when the recorder read it again after the turn, else the next read within 60 s), less what earlier
//     takes already took from that same read (the study's `taken`); with no such read nothing fills. Its fee and pennies
//     are any taker's.
//   * A cancel lands a read after its 204 (PR5's first live hour; FakeRevx's `cancelLagReads`).
//   * The dead-man (monitor/deadman.ts, live since 2026-10-02): `deadman(at)` cancels every resting order at `at`, the
//     driver's call when the executor's last turn is more than three minutes behind a print.
//   * Inside a turn the venue's clock stands at the turn's instant: what the executor places and cancels then happens
//     before every print after it, and after every print up to it, so no later print can contradict what the turn read.

import { ceilToStep, stepDecimals, type PairConfig } from "../_shared/agents_strategy.ts";
import { QUOTE_TICK, type Print, type QuoteBook } from "./quotes.ts";

// ------------------------------------------------------------------ the venue's money rules, shared with FakeRevx (testing.ts)

/** Revolut X's taker fee, 9 bps (reference §2). */
export const REVX_TAKER_RATE = 0.0009;
/**
 * The pounds Revolut X holds for a buy: its notional rounded UP to the penny (PR5's first top-ups, 2026-10-02 17:56 UTC:
 * "Not enough funds! Wanted £0.16 but has only £0.15" for £0.1503). Other quote currencies are held as the notional.
 */
export function revxHoldFor(quote: string, notional: number): number {
  return quote === "GBP" ? Math.ceil(notional * 100 - 1e-9) / 100 : notional;
}
/** What the account moves for a notional: a buy's debit rounded UP to the hundredth, a sell's credit FLOORED. */
export function revxHundredths(side: "buy" | "sell", notional: number): number {
  return side === "buy" ? Math.ceil(notional * 100 - 1e-9) / 100 : Math.floor(notional * 100 + 1e-9) / 100;
}
/** A taker's fee: a buy's in the coin, rounded up to the base step; a sell's in the quote currency, rounded up to the penny. */
export function revxTakerFee(side: "buy" | "sell", filledBase: number, moved: number, baseStep: string): number {
  return side === "buy" ? Number(ceilToStep(filledBase * REVX_TAKER_RATE, baseStep)) : Math.ceil(moved * REVX_TAKER_RATE * 100 - 1e-9) / 100;
}
/** A number as the venue writes one: to `decimals` places, without the trailing zeros ("30", "9.99", "0.758"). */
export const venueNumber = (x: number, decimals: number) => String(Number(x.toFixed(decimals)));
/** The venue's average fill price: what it moved over the coins, rounded to the pair's price step (1184: "9.99" / 13.18565 → "0.7576"). */
export function revxAveragePrice(moved: number, filledBase: number, priceStep: string): string {
  return filledBase > 0 && moved > 0 ? venueNumber(Math.round(moved / filledBase / Number(priceStep)) * Number(priceStep), stepDecimals(priceStep)) : "0";
}
/** Would a post-only order at `price` take from this touch? A buy at or above the ask, a sell at or below the bid. */
export function crossesTouch(side: "buy" | "sell", price: number, bid: number | null, ask: number | null): boolean {
  return side === "buy" ? ask != null && price >= ask - 1e-12 : bid != null && price <= bid + 1e-12;
}

// ------------------------------------------------------------------ the simulated account

/** Revolut X's configuration of PR5's two GBP books (public pair list, 2026-09-24 and 2026-10-02: unchanged). */
export const SIM_GBP_PAIR: PairConfig & { max_order_size: string; max_order_size_quote: string; status: string } = {
  base_step: "0.00001", quote_step: "0.0001", min_order_size: "0.00001", max_order_size: "4000000", min_order_size_quote: "0.1", max_order_size_quote: "1000000", status: "active",
};
const SYMBOLS: Record<string, QuoteBook> = { "USDC/GBP": "USDC-GBP", "USDT/GBP": "USDT-GBP" };
const symbolOf = (b: QuoteBook) => b.replace("-", "/");

/** A book level as the venue serves it: a price and the base quantity resting there. */
export type SimLevel = [number, number];
/** The book a simulated order meets: its levels where they were read, the touch at least, or nothing known. */
export type SimBook = { bids: SimLevel[]; asks: SimLevel[]; source: string; at: number };
/** Where the account's book comes from at an instant: the driver's stored reads (`quotes_twin.ts`). */
export type SimBookSource = (book: QuoteBook, at: number) => SimBook | null;

export type SimOrder = {
  id: string; client_order_id: string; symbol: string; side: "buy" | "sell";
  status: "new" | "partially_filled" | "filled" | "cancelled" | "rejected";
  price: string; quantity: string; tif: "gtc" | "ioc"; postOnly: boolean;
  /** When the venue took it (the turn's instant), and when it finished. */
  created: number; done: number | null;
  filled: number; notional: number; moved: number; fee: number; feeCurrency: string | null;
  rejectReason?: string;
  /** Why it was cancelled when not by the executor's DELETE: "ioc" (a marketable remainder), "deadman". */
  cancelledBy?: string;
  /** A DELETE taken and not yet carried out: when it was asked, and how many reads of the order still show it resting. */
  cancelAsked?: number; cancelReadsLeft?: number;
  /** The prints that filled it, as a record: when, which, how much. */
  fills: Array<{ ts: number; print: string; qty: number }>;
  /** A take (`markTake`): it met the recorded read after its instant. */
  take?: true;
};
export type SimState = {
  v: 1; seq: number;
  balances: Record<string, number>;
  /** Every order still open, and every finished one the executor may still read back (`prune` drops the rest). */
  orders: SimOrder[];
  /** The last print applied to each book: its time, id, price in ticks and aggressor (the paper rule's `Print`). */
  applied: Partial<Record<QuoteBook, Print | null>>;
  /** The executor's last finished turn (the dead-man's clock), and the dead-man's cancels so far. */
  lastTurnAt: number | null;
  deadmen: Array<{ at: number; cancelled: number }>;
  /**
   * What takes have taken from a recorded read, by book and side of the order (`USDT-GBP|buy`): the read (its first
   * instant) and the quantity taken at each price in ticks. Absent until a take fills.
   */
  taken?: Record<string, { at: number; used: Record<string, number> }>;
};
export function newSimState(balances: Record<string, number>, seeds: Partial<Record<QuoteBook, Print | null>> = {}): SimState {
  return { v: 1, seq: 1, balances: { ...balances }, orders: [], applied: { ...seeds }, lastTurnAt: null, deadmen: [] };
}

const isOpen = (o: SimOrder) => o.status === "new" || o.status === "partially_filled";
const ticksOf = (price: string | number) => Math.round(Number(price) / QUOTE_TICK);

/**
 * The account. `now` is the venue's clock (a turn's instant while the executor runs); `book` the book each order meets;
 * `takeRead` the recorded read a take meets (none: nothing fills). `fetch` answers the private endpoints the live client
 * calls, `publicFetch` the public ones the executor reads.
 */
export class SimRevx {
  /** The client ids of the takes the executor wrote and has not sent yet (`markTake`). */
  private takes = new Set<string>();
  constructor(public st: SimState, private now: () => number, private book: SimBookSource, private takeRead: SimBookSource = () => null) {}

  /** The executor wrote this order as a take (`request.take`): its IOC meets `takeRead`, not the book the turn met. */
  markTake(clientOrderId: string): void { this.takes.add(clientOrderId); }

  /** What open orders hold of an asset: a buy its pounds rounded up to the penny, a sell its coin. */
  reserved(asset: string): number {
    let n = 0;
    for (const o of this.st.orders) {
      if (!isOpen(o)) continue;
      const [base, quote] = o.symbol.split("/"), left = Number(o.quantity) - o.filled;
      if (o.side === "buy" && quote === asset) n += revxHoldFor(quote, left * Number(o.price));
      if (o.side === "sell" && base === asset) n += left;
    }
    return n;
  }
  private free(asset: string): number { return (this.st.balances[asset] ?? 0) - this.reserved(asset); }

  /** A cancel the venue took lands on a read of the order once its reads are used up (or, at a later instant, at once). */
  private landCancel(o: SimOrder, read = false): void {
    if (o.cancelAsked == null) return;
    if (!isOpen(o)) { o.cancelAsked = o.cancelReadsLeft = undefined; return; }
    if (this.now() - o.cancelAsked >= 1_000 || (read && (o.cancelReadsLeft ?? 0) <= 0)) {
      o.status = "cancelled"; o.done = this.now(); o.cancelAsked = o.cancelReadsLeft = undefined;
      return;
    }
    if (read) o.cancelReadsLeft = (o.cancelReadsLeft ?? 0) - 1;
  }

  /** `q` of a resting order trades at its own price (a maker's 0 %), the money moving as the venue moves it. */
  private fillAt(o: SimOrder, q: number, px: number, ts: number, printId: string): void {
    const [base, quote] = o.symbol.split("/");
    const before = o.moved;
    o.filled = Number((o.filled + q).toFixed(9));
    o.notional += q * px;
    o.moved = revxHundredths(o.side, o.notional);
    o.feeCurrency = o.side === "buy" ? base : quote;
    const cash = o.moved - before;
    if (o.side === "buy") { this.st.balances[quote] = (this.st.balances[quote] ?? 0) - cash; this.st.balances[base] = (this.st.balances[base] ?? 0) + q; }
    else { this.st.balances[base] = (this.st.balances[base] ?? 0) - q; this.st.balances[quote] = (this.st.balances[quote] ?? 0) + cash; }
    o.fills.push({ ts, print: printId, qty: q });
    if (o.filled >= Number(o.quantity) - 1e-12) { o.status = "filled"; o.done = ts; o.cancelAsked = o.cancelReadsLeft = undefined; }
    else o.status = "partially_filled";
  }

  /**
   * One public print of `book`, in time order: every resting order it goes STRICTLY through, placed before it and not
   * cancelled by then, fills by the print's base quantity, the best price first and then the earlier order. A print at
   * an order's price fills none of it. Returns the coins it filled.
   */
  applyPrint(book: QuoteBook, p: Print): number {
    const sym = symbolOf(book);
    const prev = this.st.applied[book];
    if (prev && (p.ts < prev.ts || (p.ts === prev.ts && p.id <= prev.id))) return 0;      // applied already
    const through = (o: SimOrder) => (o.side === "buy" ? p.ticks < ticksOf(o.price) : p.ticks > ticksOf(o.price));
    const cands = this.st.orders.filter((o) => {
      if (o.symbol !== sym || o.created >= p.ts) return false;
      if (o.cancelAsked != null && p.ts - o.cancelAsked >= 1_000) { o.status = "cancelled"; o.done = o.cancelAsked + 1_000; o.cancelAsked = o.cancelReadsLeft = undefined; }
      return isOpen(o) && through(o);
    }).sort((a, b) => (a.side === "buy" ? ticksOf(b.price) - ticksOf(a.price) : ticksOf(a.price) - ticksOf(b.price)) || a.created - b.created || (a.id < b.id ? -1 : 1));
    let left = p.qty, filled = 0;
    for (const o of cands) {
      if (left <= 1e-12) break;
      const q = Math.min(Number(o.quantity) - o.filled, left);
      if (!(q > 0)) continue;
      this.fillAt(o, Number(q.toFixed(9)), Number(o.price), p.ts, p.id);
      left -= q;
      filled += q;
    }
    this.st.applied[book] = p;
    return filled;
  }

  /** The dead-man: every resting order cancelled at `at`, as `monitor/deadman.ts` cancels the live account's. */
  deadman(at: number): number {
    let n = 0;
    for (const o of this.st.orders) if (isOpen(o)) { o.status = "cancelled"; o.done = at; o.cancelledBy = "deadman"; o.cancelAsked = o.cancelReadsLeft = undefined; n++; }
    this.st.deadmen.push({ at, cancelled: n });
    return n;
  }

  /** Drops finished orders the executor no longer reads (`keep`: the venue ids its open rows still name), once an hour old. */
  prune(keep: Set<string>): void {
    this.st.orders = this.st.orders.filter((o) => isOpen(o) || keep.has(o.id) || o.done == null || this.now() - o.done < 3600e3);
  }

  /**
   * The book an order meets now: the stored read the driver has for this instant, or else the touch the last print
   * implies, a tick wide on the side the aggressor did not take (a buyer lifted the ask at P: ask P, bid P − 1 tick; a
   * seller hit the bid at P: bid P, ask P + 1 tick), of unknown depth. Against that touch a post-only order crosses
   * exactly when the paper rule's own `blocks` says the market is through it. With no print either, nothing is known.
   */
  touch(book: QuoteBook): SimBook | null {
    const read = this.book(book, this.now());
    if (read && (read.bids.length || read.asks.length)) return read;
    const lp = this.st.applied[book];
    if (!lp) return null;
    const P = lp.ticks * QUOTE_TICK, tick = QUOTE_TICK, deep = Number.POSITIVE_INFINITY;
    return lp.side === "buy"
      ? { bids: [[Number((P - tick).toFixed(4)), deep]], asks: [[P, deep]], source: `last print ${lp.id}`, at: lp.ts }
      : { bids: [[P, deep]], asks: [[Number((P + tick).toFixed(4)), deep]], source: `last print ${lp.id}`, at: lp.ts };
  }

  /** An order as GET /orders/{id} answers it, in the venue's own fields (1154, 1184, 1517). */
  view(o: SimOrder): Record<string, unknown> {
    const body: Record<string, unknown> = {
      id: o.id, client_order_id: o.client_order_id, symbol: o.symbol, side: o.side, type: "limit", quantity: o.quantity,
      filled_quantity: venueNumber(o.filled, 5), leaves_quantity: venueNumber(Math.max(0, Number(o.quantity) - o.filled), 5), price: o.price,
      average_fill_price: revxAveragePrice(o.moved, o.filled, SIM_GBP_PAIR.quote_step), filled_amount: venueNumber(o.moved, 2),
      total_fee: venueNumber(o.fee, o.feeCurrency && o.feeCurrency !== "GBP" ? stepDecimals(SIM_GBP_PAIR.base_step) : 2),
      fee_currency: o.feeCurrency ?? (o.side === "buy" ? o.symbol.split("/")[0] : "GBP"), status: o.status, time_in_force: o.tif,
      execution_instructions: [o.postOnly ? "post_only" : "allow_taker"], created_date: o.created, updated_date: o.done ?? o.created,
    };
    if (o.rejectReason) body.reject_reason = o.rejectReason;
    return body;
  }

  private place(req: { client_order_id: string; symbol: string; side: "buy" | "sell"; order_configuration?: { limit?: { base_size: string; price: string; execution_instructions?: string[]; time_in_force?: string } } }): { status: number; body: unknown } {
    const at = this.now();
    const sym = String(req.symbol).replace("-", "/"), book = SYMBOLS[sym], lim = req.order_configuration?.limit;
    const bad = (message: string, status = 400) => ({ status, body: { error_id: "sim", message, timestamp: at } });
    if (!book || !lim) return bad(`the simulated account trades only USDC/GBP and USDT/GBP limit orders, not ${req.symbol}`);
    const tif = (lim.time_in_force ?? "gtc") as "gtc" | "ioc", postOnly = (lim.execution_instructions ?? []).includes("post_only");
    if (tif !== "gtc" && tif !== "ioc") return bad(`time_in_force ${tif} is not accepted on placement`);
    if (tif === "ioc" && postOnly) return bad("post_only cannot be combined with ioc");
    if (this.st.orders.some((o) => o.client_order_id === req.client_order_id)) return bad("duplicate client_order_id", 409);
    const price = Number(lim.price), size = Number(lim.base_size);
    if (!(price > 0) || !(size > 0)) return bad("price and base_size must be positive");
    const [base, quote] = sym.split("/");
    const o: SimOrder = {
      id: `sim-${this.st.seq++}`, client_order_id: req.client_order_id, symbol: sym, side: req.side, status: "new", price: lim.price, quantity: lim.base_size,
      tif, postOnly, created: at, done: null, filled: 0, notional: 0, moved: 0, fee: 0, feeCurrency: null, fills: [],
    };
    const shown = this.touch(book);
    const bid = shown?.bids.length ? Math.max(...shown.bids.map((l) => l[0])) : null, ask = shown?.asks.length ? Math.min(...shown.asks.map((l) => l[0])) : null;
    const notEnough = (asset: string, need: number) => {
      const has = Math.max(0, this.free(asset));
      return asset === "GBP" ? `Not enough funds! Wanted £${need.toFixed(2)} but has only £${has.toFixed(2)}` : `Not enough funds! Wanted ${venueNumber(need, 5)} ${asset} but has only ${venueNumber(has, 5)} ${asset}`;
    };
    if (tif === "ioc") {
      // Walk the levels the book shows, up to the limit: a read's own levels, or the last print's implied touch. A take
      // walks the recorded read after its instant instead, less what earlier takes took from that same read.
      const isTake = this.takes.delete(req.client_order_id);
      const met = isTake ? this.takeRead(book, at) : shown;
      const key = `${book}|${req.side}`;
      const before = isTake && met && this.st.taken?.[key]?.at === met.at ? this.st.taken[key].used : {};
      const used: Record<string, number> = { ...before };
      const levels: SimLevel[] = [...((req.side === "buy" ? met?.asks : met?.bids) ?? [])]
        .map(([px, q]): SimLevel => [px, isTake ? Math.max(0, q - (before[String(ticksOf(px))] ?? 0)) : q])
        .sort((a, b) => (req.side === "buy" ? a[0] - b[0] : b[0] - a[0]));
      let want = size, notional = 0, got = 0;
      for (const [px, q] of levels) {
        if (want <= 1e-12 || (req.side === "buy" ? px > price + 1e-12 : px < price - 1e-12)) break;
        const take = Math.min(want, q);
        got += take; notional += take * px; want -= take;
        if (isTake && take > 0) used[String(ticksOf(px))] = (used[String(ticksOf(px))] ?? 0) + take;
      }
      if (isTake) o.take = true;
      got = Number(got.toFixed(5));
      if (got > 0) {
        const moved = revxHundredths(req.side, notional);
        if (req.side === "buy" && this.free(quote) + 1e-9 < moved) return { status: 422, body: { message: notEnough(quote, moved), error_id: "sim", timestamp: at } };
        if (req.side === "sell" && this.free(base) + 1e-12 < got) return { status: 422, body: { message: notEnough(base, got), error_id: "sim", timestamp: at } };
        o.filled = got; o.notional = notional; o.moved = moved;
        o.fee = revxTakerFee(req.side, got, moved, SIM_GBP_PAIR.base_step);
        o.feeCurrency = req.side === "buy" ? base : quote;
        if (req.side === "buy") { this.st.balances[quote] = (this.st.balances[quote] ?? 0) - moved; this.st.balances[base] = (this.st.balances[base] ?? 0) + got - o.fee; }
        else { this.st.balances[base] = (this.st.balances[base] ?? 0) - got; this.st.balances[quote] = (this.st.balances[quote] ?? 0) + moved - o.fee; }
        o.fills.push({ ts: at, print: `book: ${met?.source ?? "none"}`, qty: got });
        if (isTake && met) (this.st.taken ??= {})[key] = { at: met.at, used };
      }
      o.status = got >= size - 1e-12 ? "filled" : "cancelled";
      if (o.status === "cancelled") o.cancelledBy = "ioc";
      o.done = at;
    } else {
      const crosses = crossesTouch(req.side, price, bid, ask);
      if (postOnly && crosses) { o.status = "rejected"; o.rejectReason = "post_only_immediate_match"; o.done = at; }
      else {
        const asset = req.side === "buy" ? quote : base, need = req.side === "buy" ? revxHoldFor(quote, size * price) : size;
        if (this.free(asset) + 1e-9 < need) return { status: 422, body: { message: notEnough(asset, need), error_id: "sim", timestamp: at } };
      }
    }
    this.st.orders.push(o);
    return { status: 200, body: { data: { venue_order_id: o.id, client_order_id: o.client_order_id, state: o.status } } };
  }

  /** The private endpoints the live client calls (`revxVenue`): the order POST, DELETE and GETs, the active list, the history, the balances. */
  fetch: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const p = url.pathname, m = (init?.method ?? "GET").toUpperCase();
    const json = (status: number, body: unknown) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
    if (url.host !== "revx.revolut.com") return Promise.reject(new Error(`simulated account: ${url.host} is not the venue`));
    if (p === "/api/1.0/orders" && m === "POST") {
      let req;
      try { req = JSON.parse(String(init?.body)); } catch { return json(400, { message: "unreadable order" }); }
      const r = this.place(req);
      return json(r.status, r.body);
    }
    if (p === "/api/1.0/orders/active" && m === "GET") {
      for (const o of this.st.orders) this.landCancel(o);
      return json(200, { data: this.st.orders.filter(isOpen).map((o) => this.view(o)), metadata: { timestamp: this.now() } });
    }
    if (p === "/api/1.0/orders/historical" && m === "GET") {
      // As the venue documents the list: no fee, no average price, no filled amount (only GET /orders/{id} carries them).
      const syms = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean).map((s) => s.replace("-", "/"));
      const start = Number(url.searchParams.get("start_date") ?? 0), end = Number(url.searchParams.get("end_date") ?? Number.MAX_SAFE_INTEGER);
      const done = this.st.orders.filter((o) => !isOpen(o) && (!syms.length || syms.includes(o.symbol)) && o.created >= start && o.created <= end);
      return json(200, { data: done.map((o) => { const v = this.view(o); delete v.total_fee; delete v.fee_currency; delete v.average_fill_price; delete v.filled_amount; return v; }), metadata: { timestamp: this.now() } });
    }
    if (p.startsWith("/api/1.0/orders/")) {
      const o = this.st.orders.find((x) => x.id === p.split("/").at(-1));
      if (!o) return json(404, { message: "Order not found" });
      if (m === "DELETE") {
        this.landCancel(o);
        if (!isOpen(o)) return json(404, { message: "Order is not active" });
        o.cancelAsked ??= this.now(); o.cancelReadsLeft ??= 1;
        return json(204, null);
      }
      if (m !== "GET") return json(405, { message: "method" });
      this.landCancel(o, true);
      return json(200, { data: this.view(o) });
    }
    if (p === "/api/1.0/balances" && m === "GET") {
      return json(200, Object.entries(this.st.balances).map(([currency, v]) => {
        const r = this.reserved(currency);
        return { currency, available: String(v - r), reserved: String(r), total: String(v) };
      }));
    }
    return json(404, { message: `simulated account: no route ${m} ${p}` });
  };

  /** The public endpoints the executor reads: the pairs' configuration, and the order book the turn meets. */
  publicFetch: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    const p = url.pathname, m = (init?.method ?? "GET").toUpperCase();
    const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.host !== "revx.revolut.com" || m !== "GET") return Promise.reject(new Error(`simulated account: ${m} ${url.host}${p} is not a public read`));
    if (p === "/api/1.0/public/configuration/pairs") {
      return json(200, Object.fromEntries(Object.keys(SYMBOLS).map((s) => [s, { base: s.split("/")[0], quote: "GBP", ...SIM_GBP_PAIR }])));
    }
    if (p.startsWith("/api/2.0/public/order-book/")) {
      const b = SYMBOLS[p.split("/").at(-1)!.replace("-", "/")];
      if (!b) return json(404, { message: "no book" });
      const shown = this.touch(b);
      // A level of unknown depth (the last print's implied touch) is served with no quantity.
      const lvl = (l: SimLevel) => ({ price: l[0].toFixed(4), quantity: Number.isFinite(l[1]) ? String(l[1]) : null, count: 1 });
      return json(200, { data: { bids: (shown?.bids ?? []).map(lvl), asks: (shown?.asks ?? []).map(lvl) } });
    }
    return json(404, { message: `simulated account: no public route ${p}` });
  };
}
