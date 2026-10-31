// "Crypto quotes XRP/GBP" (0192, mm_paper.ts) on the Agents page: the £600 arm, the one the pre-registration judges, in the
// Stablecoin quotes pages' shape, so its row and page read as the twins' do and its money adds into TESTING and Revolut X's card.
// The engine (mm_core.ts, mm_paper.ts) is frozen by the pre-registration; this file is not: it only reads the arm's tables.
//   - FUNDED: the arm's capital, £600;
//   - DEPLOYED: what is at work, the page's definition for every Stablecoin quotes row: the coin it holds at the fair it last knew
//     and the pounds resting in its bid;
//   - REALIZED: its round trips (each sale against the oldest coin bought, mm_paper.ts), the stop's taker fee inside;
//   - UNREALIZED: the coin held at the fair less what that coin cost;
//   - TODAY: the round trips closed today, the figure DAYS shows for today (one number on one screen, as xhedge_page.ts).
// FUNDED + REALIZED + UNREALIZED is the arm's pounds plus its coin at the fair, to the rounding of the rows.
import type { Db } from "./db.ts";
import { MM_CARD } from "./mm_core.ts";
import { MM_ARMS, MM_BOOK, MM_ID, MM_NAME, MM_TABLES, type ArmState } from "./mm_paper.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();

export type MmTripDb = { t_exit: string; seq: number; t_entry: string; qty: number; entry: number; exit: number; fee_gbp: number; pnl_gbp: number; how: string };
export type MmDayDb = { day: string; orders: number; fills: number; stale_s: number; pnl_gbp: number; trips: number; won: number; realised_gbp: number };
export type MmMinuteDb = { minute: string; fair: number | null; bid: number | null; ask: number | null; cash: number; coin: number; cost: number };

/** The rows a page lists of each table. */
export const MM_PAGE_ROWS = 60;

/** The arm's page view, pure: the reader passes its rows. Null before it has decided a minute. */
export function mmView(input: {
  st: { state: ArmState | Record<string, never>; last_minute: string | null; last_error: string | null } | null;
  trips: MmTripDb[]; days: MmDayDb[]; last: MmMinuteDb | null; lastPrint: number | null; nowMs: number; dayStartMs: number; gbpusd: number | null;
}) {
  const st = input.st, s = st?.state as ArmState | undefined;
  if (!st?.last_minute || !s || !("core" in s)) return null;
  const arm = MM_ARMS[0];
  const usd = (gbp: number) => (input.gbpusd ? gbp * input.gbpusd : 0);
  const last = input.last;
  const fair = last?.fair != null ? Number(last.fair) : s.lastFair;
  const cash = s.core.cash, coin = s.core.coin;
  const costHeld = s.lots.reduce((a, l) => a + l.qty * l.price, 0);
  const coinGbp = fair != null ? coin * fair : 0;
  const bid = s.core.bid, ask = s.core.ask;
  const restingGbp = bid ? bid.price * bid.left : 0;
  const trips = [...input.trips].sort((a, b) => Date.parse(b.t_exit) - Date.parse(a.t_exit) || Number(b.seq) - Number(a.seq));
  const realisedGbp = trips.reduce((a, t) => a + Number(t.pnl_gbp), 0);
  const todayGbp = trips.filter((t) => Date.parse(t.t_exit) >= input.dayStartMs).reduce((a, t) => a + Number(t.pnl_gbp), 0);
  const feesGbp = trips.reduce((a, t) => a + Number(t.fee_gbp), 0);
  const unrealisedGbp = coinGbp - costHeld;
  const capitalGbp = arm.capGbp, valueGbp = coinGbp + restingGbp;
  const lagMinutes = Math.round((input.nowMs - Date.parse(st.last_minute)) / M);
  const today = iso(input.dayStartMs).slice(0, 10);
  const k = MM_CARD.dBps / 1e4;
  const orders: Array<Record<string, unknown>> = [];
  const rungs: Array<Record<string, unknown>> = [];
  for (const [side, q] of [["bid", bid], ["ask", ask]] as const) {
    rungs.push({ book: MM_BOOK, side, k, order: q ? { price: q.price, leg: "entry", state: "new" } : null, held: null });
    if (q) {
      orders.push({ id: `${side}|${q.since}`, ts: iso(q.since * 1000), book: MM_BOOK, side, k, leg: side === "bid" ? "entry" : "exit",
        venueSide: side === "bid" ? "buy" : "sell", price: q.price, base: q.left, state: "new", reason: null });
    }
  }
  const started = input.nowMs >= s.startAt;
  const notes = [
    started ? `Quoting since ${iso(s.startAt).slice(0, 16).replace("T", " ")} UTC` : `Recording; quotes from ${iso(s.startAt).slice(0, 16).replace("T", " ")} UTC (the basis needs three hours of prints first)`,
    `${MM_CARD.dBps} bps either side of the fair (Binance × USDT/USD ÷ GBP/USD × the book's 3-hour basis${s.core.c != null ? `, now ${s.core.c.toFixed(1)} bps` : ""}), a third of its money a quote, re-priced on a ${MM_CARD.thetaBps} bps move; a ${MM_CARD.stopBps} bps stop`,
  ];
  return {
    venue: "revx" as const, ccy: "GBP" as const,
    running: lagMinutes <= 6, lagMinutes, lastError: st.last_error,
    capitalGbp, costGbp: costHeld, valueGbp, unrealisedGbp, realisedGbp, todayGbp, feesGbp,
    capitalUsd: usd(capitalGbp), costUsd: usd(costHeld), valueUsd: usd(valueGbp), unrealisedUsd: usd(unrealisedGbp), realisedUsd: usd(realisedGbp),
    todayUsd: usd(todayGbp), feesUsd: usd(feesGbp),
    heldRungs: 0, openOrders: orders.length,
    books: [MM_BOOK],
    detail: {
      books: [{ book: MM_BOOK, lastPrice: input.lastPrint, fair, index: null, realisedGbp, trips: trips.length, won: trips.filter((t) => Number(t.pnl_gbp) > 0).length }],
      rungs,
      inventory: { at: st.last_minute, assets: [
        { asset: "GBP", amount: cash },
        { asset: "XRP", amount: coin, price: fair, gbp: coinGbp, priceFrom: "fair", unrealisedGbp },
      ] },
      days: mmDays(input.days, today).map((x) => ({ ...x, realisedUsd: usd(x.realisedGbp) })),
      trips: trips.slice(0, MM_PAGE_ROWS).map((t) => ({
        book: MM_BOOK, side: "bid", k, tEntry: t.t_entry, tExit: t.t_exit, entry: Number(t.entry), exit: Number(t.exit), qty: Number(t.qty),
        how: t.how, feesGbp: Number(t.fee_gbp), pnlGbp: Number(t.pnl_gbp), feesUsd: usd(Number(t.fee_gbp)), pnlUsd: usd(Number(t.pnl_gbp)),
      })),
      tripCount: trips.length, tripsWon: trips.filter((t) => Number(t.pnl_gbp) > 0).length,
      orders,
    },
    twin: { id: MM_ID, arm: arm.arm, name: MM_NAME, startedAt: iso(s.startAt), mode: "running", lastTurn: st.last_minute, converting: [], notes },
  };
}

/** DAYS newest first: placements, fills, round trips, won and realised; `pnlGbp` the day marked at the fair (the bar's). */
export function mmDays(rows: MmDayDb[], today: string) {
  return rows.map((x) => {
    const day = String(x.day).slice(0, 10);
    return { day, orders: Number(x.orders), fills: Number(x.fills), trips: Number(x.trips), won: Number(x.won), realisedGbp: Number(x.realised_gbp),
      pnlGbp: Number(x.pnl_gbp), staleS: Number(x.stale_s), today: day === today };
  }).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** The page's reader: the £600 arm's view, in a list (empty before it has decided a minute, or when a read fails). */
export async function readMmPage(d: Db, now: number, dayStartMs: number) {
  try {
    const T = MM_TABLES, arm = MM_ARMS[0].arm;
    const [sts, trips, days, fx, lp] = await Promise.all([
      d.select<{ arm: string; state: ArmState | Record<string, never>; last_minute: string | null; last_error: string | null }>(T.state, `arm=eq.${arm}&select=arm,state,last_minute,last_error`),
      d.selectAll<MmTripDb>(T.trips, `arm=eq.${arm}&select=t_exit,seq,t_entry,qty,entry,exit,fee_gbp,pnl_gbp,how&order=arm.asc,t_exit.asc,seq.asc`),
      d.select<MmDayDb>(T.days, `arm=eq.${arm}&select=day,orders,fills,stale_s,pnl_gbp,trips,won,realised_gbp&order=day.desc&limit=240`),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
      d.select<{ price: number }>(T.prints, `book=eq.${MM_BOOK}&select=price&order=ts.desc&limit=1`),
    ]);
    const st = sts[0];
    if (!st?.last_minute) return [];
    const lm = encodeURIComponent(new Date(Date.parse(st.last_minute)).toISOString());
    const last = await d.select<MmMinuteDb>(T.minutes, `arm=eq.${arm}&minute=eq.${lm}&select=minute,fair,bid,ask,cash,coin,cost`);
    const v = mmView({ st, trips, days, last: last[0] ?? null, lastPrint: lp[0] ? Number(lp[0].price) : null, nowMs: now, dayStartMs,
      gbpusd: fx[0] ? Number(fx[0].value) : null });
    return v ? [v] : [];
  } catch { return []; }
}
