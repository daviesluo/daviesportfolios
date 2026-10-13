// The Agents page's read of one Coinbase paper arm (the base test, "Stablecoin quotes with Euros", and the weekend variant,
// "Stablecoin quotes with Euros - 2", cb_hold.ts): the arm's state, trips, days, newest orders and last minute from its own
// tables, through `cbQuotesView` (cb_view.ts). The dashboard (index.ts) and the browser test's fixture (testing.ts) both call it.

import type { Db } from "./db.ts";
import { cbQuotesView, CB_PAGE_ROWS, type CbDayRow, type CbEventRow, type CbMinuteRow, type CbStateRow, type CbTripRow } from "./cb_view.ts";

export type CbArmTables = { state: string; trips: string; days: string; events: string; minutes: string };

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
