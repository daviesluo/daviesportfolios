// The Agents page's read of one Coinbase paper arm (the base test, "Stablecoin quotes with Euros", the weekend variant,
// "Stablecoin quotes with Euros - 1", cb_hold.ts, and the USDC arm, "- 2", cb_usdc.ts): the arm's state, trips, days, newest orders and last minute from its own
// tables, through `cbQuotesView` (cb_view.ts). The dashboard (index.ts) and the browser test's fixture (testing.ts) both call it.

import type { Db } from "./db.ts";
import { cbQuotesView, CB_PAGE_ROWS, type CbDayRow, type CbEventRow, type CbMinuteRow, type CbStateRow, type CbTripRow } from "./cb_view.ts";
import { CB_BOOK, type CbQuoteState } from "./cb_quotes.ts";
import type { CbProduct } from "./cb_rec.ts";

export type CbArmTables = { state: string; trips: string; days: string; events: string; minutes: string };

/**
 * The weekend variant's page name since 0142 (Davies, 2026-10-26: "目前的Stablecoin quotes with Euros - 2改为-1"): "with Euros - 1".
 * cb_hold.ts (frozen with its pre-registration) still names it "- 2" (`CB_HOLD_ROW_NAME`); the page reads this. Its id, tables,
 * call and reading are unchanged, and "with Euros - 2" is now the USDC arm's (cb_usdc.ts).
 */
export const CB_HOLD_PAGE_NAME = "Stablecoin quotes with Euros - 1";

/** What one arm's read gives beside its view: the state row, every round trip, and the last stored GBP/USD and EUR/USD. */
type CbArmLoad = { v: ReturnType<typeof cbQuotesView>; st: CbStateRow; trips: CbTripRow[]; gbpusd: number | null; eurusd: number | null };

async function loadCoinbaseArm(d: Db, now: number, dayStartMs: number, t: CbArmTables, as: { id: string; name: string } | null): Promise<CbArmLoad | null> {
  const [st, trips, days, events, fx, eurFx] = await Promise.all([
    d.select<CbStateRow>(t.state, "id=eq.1&select=state,last_minute,updated_at,last_error"),
    d.selectAll<CbTripRow>(t.trips, "select=book,side,k,t_entry,t_exit,entry,exit,qty,how,pnl_gbp&order=book.asc,side.asc,k.asc,t_entry.asc"),
    d.select<CbDayRow>(t.days, "select=day,orders,fills,trips,won,realised_gbp&order=day.desc&limit=60"),
    d.select<CbEventRow>(t.events, `kind=in.(order,refused)&select=book,minute,side,k,kind,ticks,detail&order=minute.desc&limit=${CB_PAGE_ROWS}`),
    d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
    d.select<{ value: number }>("cb_quote_inputs", "kind=eq.fx%3AEURUSD&select=value&order=t.desc&limit=1"),
  ]);
  if (!st[0]?.last_minute) return null;
  const minutes = await d.select<CbMinuteRow>(t.minutes, `minute=eq.${encodeURIComponent(new Date(Date.parse(st[0].last_minute)).toISOString())}&select=book,minute,fair,x,last`);
  const gbpusd = fx[0] ? Number(fx[0].value) : null, eurusd = eurFx[0] ? Number(eurFx[0].value) : null;
  const v = cbQuotesView({ st: st[0], trips, days, events, minutes, nowMs: now, dayStartMs, gbpusd, eurusd });
  return { v: v && as ? { ...v, twin: { ...v.twin, id: as.id, name: as.name } } : v, st: st[0], trips, gbpusd, eurusd };
}

/**
 * One Coinbase paper arm for the Agents page: its state, trips, days, newest orders and last minute from the arm's own tables,
 * through `cbQuotesView`; `as` renames the twin it sends (the weekend variant's id and name). Missing tables (before the
 * migration), or no decided minute yet, leave it off the page (null). In pounds, as the record is (the browser test's fixture).
 */
export async function readCoinbaseArm(d: Db, now: number, dayStartMs: number, t: CbArmTables, as: { id: string; name: string } | null) {
  try { return (await loadCoinbaseArm(d, now, dayStartMs, t, as))?.v ?? null; } catch { return null; }
}

/** How an arm is shown in dollars: its rung, its books, and its own shape over the base view (the USDC arm's `cbUsdcView`). */
// deno-lint-ignore no-explicit-any
export type CbUsdArm = { rungUsd: number; books: number; shape?: (v: any) => any };

/**
 * One Coinbase arm for the Agents page in DOLLARS (`readCoinbaseArm`, then `coinbaseInUsd` on the arm's own state and every
 * round trip). null as `readCoinbaseArm` is.
 */
export async function readCoinbaseUsd(d: Db, now: number, dayStartMs: number, t: CbArmTables, as: { id: string; name: string } | null, arm: CbUsdArm) {
  try {
    const l = await loadCoinbaseArm(d, now, dayStartMs, t, as);
    if (!l?.v) return null;
    const v = arm.shape ? arm.shape(l.v) : l.v;
    return coinbaseInUsd(v, { state: l.st.state as CbQuoteState, trips: l.trips, gbpusd: l.gbpusd, eurusd: l.eurusd, dayStartMs, ...arm });
  } catch { return null; }
}

/** A trip's day as the days view counts it: its close's UTC day. */
const dayOf = (ts: string) => new Date(Date.parse(ts)).toISOString().slice(0, 10);

/**
 * A Coinbase arm's page in WHOLE DOLLARS (Davies, 2026-10-29: "C，coinbase的也是改用美元", then "Coinbase策略中funded数字怎么那么奇怪，
 * 都改成整数调整"): `ccy` "USD", FUNDED the arm's rungs × its dollar rung (`rungUsd` × 6 × `books`: $2,400, or $300 for the USDC
 * arm), and every money figure in dollars at PR5's last stored GBP/USD (`gbpusd`).
 *
 * The record before the switch (`usdFrom` in the arm's state: the base test's Deviation 4, the weekend variant's 3, the USDC
 * arm's 1) was made at 100 (or 25) of each book's currency a rung. It is shown at the dollar size, × its book's factor (`usdFactor`
 * in the state: 1 / GBP/USD on a GBP book, 1 / EUR/USD on a EUR book, at the switch; the latest rates until the arm has switched):
 * a round trip by its entry, a held rung by when it filled, in P&L, cost and size. Nothing from the switch on is scaled; prices,
 * counts and percentages never are. The stored rows are not touched. Each pound field is the dollar one ÷ `gbpusd`, so a pound
 * reader of the payload agrees. null stays null.
 */
export function coinbaseInUsd(
  // deno-lint-ignore no-explicit-any
  v: any,
  b: CbUsdArm & { state: CbQuoteState | null; trips: CbTripRow[]; gbpusd: number | null; eurusd: number | null; dayStartMs: number },
) {
  if (!v) return v;
  const R = b.gbpusd && b.gbpusd > 0 ? b.gbpusd : Number(v.capitalGbp) > 0 ? Number(v.capitalUsd) / Number(v.capitalGbp) : 0;
  const s = b.state ?? ({} as Partial<CbQuoteState>);
  const from = s.usdFrom ?? null;
  const fac = s.usdFactor ?? { GBP: R ? 1 / R : 1, EUR: b.eurusd ? 1 / b.eurusd : 1 };
  // A book's scale for an amount entered at `at`: its factor before the switch, 1 from it.
  const k = (book: string, at: string | number | null | undefined) => {
    const ms = typeof at === "number" ? at : at ? Date.parse(at) : NaN;
    if (from != null && Number.isFinite(ms) && ms >= from) return 1;
    return CB_BOOK[book as CbProduct]?.quote === "EUR" ? fac.EUR : fac.GBP;
  };
  const usd = (gbp: unknown, book: string, at: string | number | null | undefined) => (gbp == null ? null : Number(gbp) * R * k(book, at));
  const gbp = (x: number | null) => (x == null ? null : R ? x / R : 0);
  const books = new Set((v.detail?.books ?? []).map((x: { book: string }) => x.book));
  const trips = b.trips.filter((t) => !books.size || books.has(t.book)).map((t) => ({ ...t, usd: usd(t.pnl_gbp, t.book, t.t_entry)! }));
  const realisedUsd = trips.reduce((a, t) => a + t.usd, 0);
  const todayUsd = trips.filter((t) => Date.parse(t.t_exit) >= b.dayStartMs).reduce((a, t) => a + t.usd, 0);
  const byDay = new Map<string, number>();
  for (const t of trips) byDay.set(dayOf(t.t_exit), (byDay.get(dayOf(t.t_exit)) ?? 0) + t.usd);
  const d = v.detail ?? {};
  // deno-lint-ignore no-explicit-any
  const rungs = (d.rungs ?? []).map((r: any) => {
    if (!r.held) return r;
    const f = k(r.book, r.held.since);
    const costUsd = usd(r.held.costGbp, r.book, r.held.since), unrealisedUsd = usd(r.held.unrealisedGbp, r.book, r.held.since);
    return { ...r, held: { ...r.held, base: r.held.base * f, costUsd, unrealisedUsd, costGbp: gbp(costUsd), unrealisedGbp: gbp(unrealisedUsd) } };
  });
  // deno-lint-ignore no-explicit-any
  const held = rungs.filter((r: any) => r.held);
  // deno-lint-ignore no-explicit-any
  const costUsd = held.reduce((a: number, r: any) => a + (r.held.costUsd ?? 0), 0);
  // deno-lint-ignore no-explicit-any
  const unrealisedUsd = held.reduce((a: number, r: any) => a + (r.held.unrealisedUsd ?? 0), 0);
  const capitalUsd = b.rungUsd * 6 * b.books;
  const valueUsd = costUsd + b.rungUsd * (Number(v.openOrders) || 0);
  return {
    ...v, ccy: "USD" as const,
    rungUsd: b.rungUsd, usdFrom: from == null ? null : new Date(from).toISOString(), usdFactor: fac,
    capitalUsd, costUsd, valueUsd, unrealisedUsd, realisedUsd, todayUsd, feesUsd: 0,
    capitalGbp: gbp(capitalUsd), costGbp: gbp(costUsd), valueGbp: gbp(valueUsd), unrealisedGbp: gbp(unrealisedUsd), realisedGbp: gbp(realisedUsd), todayGbp: gbp(todayUsd), feesGbp: 0,
    detail: {
      ...d,
      // deno-lint-ignore no-explicit-any
      books: (d.books ?? []).map((x: any) => {
        const r = trips.filter((t) => t.book === x.book).reduce((a, t) => a + t.usd, 0);
        return { ...x, realisedUsd: r, realisedGbp: gbp(r) };
      }),
      rungs,
      // deno-lint-ignore no-explicit-any
      days: (d.days ?? []).map((x: any) => {
        const r = byDay.get(x.day) ?? 0;
        return { ...x, realisedUsd: r, realisedGbp: gbp(r) };
      }),
      // deno-lint-ignore no-explicit-any
      trips: (d.trips ?? []).map((t: any) => {
        const pnlUsd = usd(t.pnlGbp, t.book, t.tEntry);
        return { ...t, qty: t.qty * k(t.book, t.tEntry), pnlUsd, feesUsd: 0, pnlGbp: gbp(pnlUsd), feesGbp: 0 };
      }),
    },
  };
}
