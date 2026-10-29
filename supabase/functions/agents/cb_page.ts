// The Agents page's read of one Coinbase paper arm (the base test, "Stablecoin quotes with Euros", the weekend variant,
// "Stablecoin quotes with Euros - 1", cb_hold.ts, and the USDC arm, "- 2", cb_usdc.ts): the arm's state, trips, days, newest orders and last minute from its own
// tables, through `cbQuotesView` (cb_view.ts). The dashboard (index.ts) and the browser test's fixture (testing.ts) both call it.

import type { Db } from "./db.ts";
import { cbQuotesView, CB_PAGE_ROWS, type CbDayRow, type CbEventRow, type CbMinuteRow, type CbStateRow, type CbTripRow } from "./cb_view.ts";

export type CbArmTables = { state: string; trips: string; days: string; events: string; minutes: string };

/**
 * The weekend variant's page name since 0142 (Davies, 2026-10-26: "目前的Stablecoin quotes with Euros - 2改为-1"): "with Euros - 1".
 * cb_hold.ts (frozen with its pre-registration) still names it "- 2" (`CB_HOLD_ROW_NAME`); the page reads this. Its id, tables,
 * call and reading are unchanged, and "with Euros - 2" is now the USDC arm's (cb_usdc.ts).
 */
export const CB_HOLD_PAGE_NAME = "Stablecoin quotes with Euros - 1";

/**
 * One Coinbase paper arm for the Agents page: its state, trips, days, newest orders and last minute from the arm's own tables,
 * through `cbQuotesView`; `as` renames the twin it sends (the weekend variant's id and name). Missing tables (before the
 * migration), or no decided minute yet, leave it off the page (null).
 */
export async function readCoinbaseArm(d: Db, now: number, dayStartMs: number, t: CbArmTables, as: { id: string; name: string } | null) {
  try {
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
    const v = cbQuotesView({ st: st[0], trips, days, events, minutes, nowMs: now, dayStartMs, gbpusd: fx[0] ? Number(fx[0].value) : null, eurusd: eurFx[0] ? Number(eurFx[0].value) : null });
    return v && as ? { ...v, twin: { ...v.twin, id: as.id, name: as.name } } : v;
  } catch { return null; }
}

/**
 * A Coinbase arm's page in DOLLARS (Davies, 2026-10-29: "C，coinbase的也是改用美元"): the same view with `ccy` "USD", and each
 * figure the detail shows in pounds given beside it in dollars (a trip's P&L and fees, a day's and a book's realised, a held
 * rung's cost and unrealised), at the view's own GBP/USD (its `capitalUsd` over its `capitalGbp`, PR5's last stored rate, as
 * the scoreboard's dollars already are). Only the page's currency changes: sizes, prices, the rule and its record are as they
 * were. Applied after `cbUsdcView`, so the USDC arm's sizes are already its own. null stays null.
 */
// deno-lint-ignore no-explicit-any
export function coinbaseInUsd(v: any) {
  if (!v) return v;
  const rate = Number(v.capitalGbp) > 0 ? Number(v.capitalUsd) / Number(v.capitalGbp) : 0;
  const usd = (gbp: unknown) => (gbp == null ? null : Number(gbp) * rate);
  const d = v.detail ?? {};
  return {
    ...v, ccy: "USD" as const,
    detail: {
      ...d,
      // deno-lint-ignore no-explicit-any
      books: (d.books ?? []).map((b: any) => ({ ...b, realisedUsd: usd(b.realisedGbp) })),
      // deno-lint-ignore no-explicit-any
      rungs: (d.rungs ?? []).map((r: any) => (r.held ? { ...r, held: { ...r.held, costUsd: usd(r.held.costGbp), unrealisedUsd: usd(r.held.unrealisedGbp) } } : r)),
      // deno-lint-ignore no-explicit-any
      days: (d.days ?? []).map((x: any) => ({ ...x, realisedUsd: usd(x.realisedGbp) })),
      // deno-lint-ignore no-explicit-any
      trips: (d.trips ?? []).map((t: any) => ({ ...t, pnlUsd: usd(t.pnlGbp), feesUsd: usd(t.feesGbp) })),
    },
  };
}
