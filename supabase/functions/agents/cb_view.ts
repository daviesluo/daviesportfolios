// "Stablecoin quotes with Euros" for the Agents page (cb_quotes.ts, 0112): the paper test's record in the shape a realistic
// twin's has (`readQuotesTwin`: `quotesLiveSummary`'s figures and its `detail`), so its TESTING row and its page are the
// twins' own (Davies, 2026-10-10: "子页面仿照目前Revolut X的，测试名字就叫Stablecoin quotes - with Euro吧，列表里放在Stablecoin
// quotes variant-3 后面，每一档100磅/100欧元", then "策略名字也改为Stablecoin quotes with Euros"; "Stablecoin quotes Coinbase"
// until then). Money in pounds, each EUR book's at its pounds per euro (£100 a rung on a GBP book, €100 on a EUR book:
// the capital is £1,200 + €1,200 at the last EUR/GBP); prices in each book's own currency; dollars only for the TESTING scoreboard, at PR5's last stored GBP/USD. A paper
// test has no account and holds no coin of its own (a rung's position is in BOOKS), so it has no INVENTORY.

import { CB_BOOK, CB_RUNG, cbCapitalGbp, type CbQuoteState } from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbProduct } from "./cb_rec.ts";
import { QUOTE_TICK } from "./quotes.ts";

export const CB_ROW_NAME = "Stablecoin quotes with Euros";
const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
/** A price from the rule's ticks, in the book's currency, without the float's tail (0.86581, not 0.8658100000000001). */
const px = (ticks: number, scale: number) => Number((ticks * QUOTE_TICK / scale).toFixed(8));

export type CbStateRow = { state: CbQuoteState | Record<string, never>; last_minute: string | null; updated_at: string; last_error: string | null };
export type CbTripRow = { book: string; side: string; k: number | string; t_entry: string; t_exit: string; entry: number | string; exit: number | string; qty: number | string; how: string; pnl_gbp: number | string };
export type CbDayRow = { day: string; orders: number; fills: number; trips: number; won: number; realised_gbp: number | string };
export type CbEventRow = { book: string; minute: string; side: string; k: number | string; kind: string; ticks: number | null; detail: Record<string, unknown> };
export type CbMinuteRow = { book: string; minute: string; fair: number | string | null; x: number | string | null; last: number | string | null };

/** How many round trips and orders the page lists, newest first. */
export const CB_PAGE_ROWS = 30;

/**
 * The paper test for the page, or null before it has decided a minute. `minutes` are the books' last decided minute
 * (their fair, X and last print); `gbpusd` PR5's last GBP/USD, for the scoreboard's dollars.
 */
export function cbQuotesView(input: {
  st: CbStateRow | null; trips: CbTripRow[]; days: CbDayRow[]; events: CbEventRow[]; minutes: CbMinuteRow[]; nowMs: number; dayStartMs: number; gbpusd: number | null;
  /** The last stored EUR/USD (`cb_quote_inputs`): the capital's EUR/GBP with `gbpusd` while no minute has had both rates. */
  eurusd?: number | null;
}) {
  const st = input.st;
  const s = st?.state as CbQuoteState | undefined;
  if (!st?.last_minute || !s || !("books" in s)) return null;
  const last = Object.fromEntries(input.minutes.map((m) => [m.book, m]));
  const usd = (gbp: number) => (input.gbpusd ? gbp * input.gbpusd : 0);
  const trips = [...input.trips].sort((a, b) => Date.parse(b.t_exit) - Date.parse(a.t_exit) || Date.parse(b.t_entry) - Date.parse(a.t_entry));
  const realisedGbp = trips.reduce((a, t) => a + Number(t.pnl_gbp), 0);
  const todayGbp = trips.filter((t) => Date.parse(t.t_exit) >= input.dayStartMs).reduce((a, t) => a + Number(t.pnl_gbp), 0);
  // Each book's pounds per unit: its last decided minute's (0112's `x`), else the last the engine kept (`xGbp`), else the
  // last stored rates (a weekend: every minute dark, Yahoo's FX closed); a state from before Deviation 1 kept it as the
  // rule's X. A GBP book's is 1.
  const stored = input.eurusd && input.gbpusd ? input.eurusd / input.gbpusd : null;
  const xOf = (b: CbProduct): number | null => {
    if (CB_BOOK[b].quote === "GBP") return 1;
    const v = Number(last[b]?.x ?? s.xGbp?.[b] ?? stored ?? s.books[b]?.lastX);
    return Number.isFinite(v) && v > 0 && v !== 1 ? v : null;
  };
  const eurGbp = xOf("USDC-EUR") ?? xOf("USDT-EUR");
  const capitalGbp = cbCapitalGbp(eurGbp ?? 0);
  // Each rung: its resting order (price in the book's currency), or what it holds, marked at the book's last print.
  const rungs: Array<Record<string, unknown>> = [];
  let held = 0, quoting = 0, costGbp = 0, unrealisedGbp = 0, quotingGbp = 0;
  for (const b of CB_PRODUCTS) {
    const bs = s.books[b];
    if (!bs) continue;
    const sc = CB_BOOK[b].scale;
    const lastPx = last[b]?.last != null ? Number(last[b].last) : bs.lastPrint ? px(bs.lastPrint.ticks, sc) : null;
    const x = xOf(b);
    for (const r of bs.rungs) {
      if (r.mode === "position") {
        held++;
        // Its cost in pounds at the pounds per unit it filled at (`xEntry`; a rung held from before Deviation 1 kept it).
        const xe = s.xEntry?.[b]?.[`${r.side}|${r.k}`] ?? (r.xEntry != null && r.xEntry !== 1 ? r.xEntry : x ?? 1);
        const entry = r.entry! / sc, qty = r.qty! * sc, cost = r.nq! * xe;
        costGbp += cost;
        const made = lastPx == null || x == null ? null : (r.side === "bid" ? qty * (lastPx - entry) : qty * (entry - lastPx)) * x;
        if (made != null) unrealisedGbp += made;
        rungs.push({ book: b, side: r.side, k: r.k, order: r.o ? { price: px(r.o.ticks, sc), leg: "exit", state: r.o.state } : null,
          held: { base: qty, avgEntry: entry, since: r.tEntry != null ? iso(r.tEntry) : null, costGbp: cost, unrealisedGbp: made } });
      } else if (r.mode === "quote" && r.o) {
        quoting++;
        quotingGbp += CB_RUNG * (x ?? 0);
        rungs.push({ book: b, side: r.side, k: r.k, order: { price: px(r.o.ticks, sc), leg: "entry", state: r.o.state }, held: null });
      } else rungs.push({ book: b, side: r.side, k: r.k, order: null, held: null });
    }
  }
  const valueGbp = costGbp + quotingGbp;
  const lagMinutes = Math.round((input.nowMs - Date.parse(st.last_minute)) / M);
  const today = new Date(input.dayStartMs).toISOString().slice(0, 10);
  const days = input.days.map((d) => ({ day: String(d.day).slice(0, 10), orders: Number(d.orders), fills: Number(d.fills), trips: Number(d.trips), won: Number(d.won),
    realisedGbp: Number(d.realised_gbp), today: String(d.day).slice(0, 10) === today })).sort((a, b) => (a.day < b.day ? 1 : -1));
  return {
    venue: "coinbase" as const,
    running: lagMinutes <= 5, lagMinutes, lastError: st.last_error,
    capitalGbp, eurGbp, costGbp, valueGbp, unrealisedGbp, realisedGbp, todayGbp, feesGbp: 0,
    capitalUsd: usd(capitalGbp), costUsd: usd(costGbp), valueUsd: usd(valueGbp), unrealisedUsd: usd(unrealisedGbp), realisedUsd: usd(realisedGbp),
    todayUsd: usd(todayGbp), feesUsd: 0,
    heldRungs: held, openOrders: quoting,
    detail: {
      books: CB_PRODUCTS.map((b) => {
        const mine = trips.filter((t) => t.book === b);
        const bs = s.books[b];
        return {
          book: b, lastPrice: last[b]?.last != null ? Number(last[b].last) : bs?.lastPrint ? px(bs.lastPrint.ticks, CB_BOOK[b].scale) : null,
          fair: last[b]?.fair != null ? Number(last[b].fair) : null, index: null,
          realisedGbp: mine.reduce((a, t) => a + Number(t.pnl_gbp), 0), trips: mine.length, won: mine.filter((t) => Number(t.pnl_gbp) > 0).length,
        };
      }),
      rungs, inventory: null, days,
      trips: trips.slice(0, CB_PAGE_ROWS).map((t) => ({
        book: t.book, side: t.side, k: Number(t.k), tEntry: t.t_entry, tExit: t.t_exit, entry: Number(t.entry), exit: Number(t.exit), qty: Number(t.qty),
        how: t.how === "taker" ? "stop" : "maker", feesGbp: 0, pnlGbp: Number(t.pnl_gbp),
      })),
      tripCount: trips.length, tripsWon: trips.filter((t) => Number(t.pnl_gbp) > 0).length,
      // Its newest orders and refusals, as the rule placed them on paper (an order is a placement, re-price or re-placement).
      orders: input.events.filter((e) => e.kind === "order" || e.kind === "refused").slice(0, CB_PAGE_ROWS).map((e) => {
        const sc = CB_BOOK[e.book as CbProduct]?.scale ?? 1, leg = String(e.detail?.leg ?? "entry");
        const venueSide = (e.side === "bid") === (leg !== "exit") ? "buy" : "sell";
        return {
          id: `${e.book}|${e.minute}|${e.side}|${e.k}|${e.kind}`, ts: e.minute, book: e.book, side: e.side, k: Number(e.k), leg, venueSide,
          price: e.ticks == null ? null : px(e.ticks, sc), base: null,
          state: e.kind === "refused" ? "rejected" : "new", reason: e.kind === "refused" ? "post-only: the market was already through it" : null,
        };
      }),
    },
    twin: { id: "coinbase", name: CB_ROW_NAME, startedAt: s.startedAt ? iso(s.startedAt) : null, mode: "running", lastTurn: st.last_minute, converting: [] },
  };
}
