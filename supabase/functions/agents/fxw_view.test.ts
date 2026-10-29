// Pins for the Agents page's "AUD weekend (FXW-AUD)" figures (fxw_view.ts), each worked by hand in its comment.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type FxwRow, fxwView } from "./fxw_view.ts";

const STATE = { last_run: "2026-11-09T07:58:00Z", last_error: null, name: "AUD weekend (FXW-AUD)", funded_gbp: 1000, stake_gbp: 1.5, start_at: "2026-10-30T21:35:00Z" };
const base: FxwRow = {
  friday: "", status: "closed", reason: null, epic: "CS.D.AUDUSD.TODAY.IP", fri_ts: null, fri_bid: null, fri_offer: null, fri_mid: 0.66,
  dec_ts: null, dec_bid: null, dec_offer: null, gap_bps: null, side: "long", stake_gbp: 1.5, entry_ts: null, entry_price: 0.658, margin_gbp: 493.5,
  exit_ts: null, exit_bid: null, exit_offer: null, exit_price: null, exit_reason: null, mark_ts: null, mark_price: null, midnight_ts: null,
  midnight_price: null, pnl_gbp: null, funding_gbp: 0, net_gbp: null, equity_before: 1000, updated_at: null,
};

Deno.test("fxw view: funded, equity, realised, unrealised on the margin, today since midnight, days run, in pounds and dollars", () => {
  const rows: FxwRow[] = [
    // Closed +GBP 30.00 on Sunday 1 November.
    { ...base, friday: "2026-10-30", entry_ts: "2026-11-01T21:00:05Z", exit_ts: "2026-11-01T23:10:00Z", exit_price: 0.66, pnl_gbp: 30, net_gbp: 30 },
    // Open since Sunday 8 November 21:00 (long 0.65800), GBP 0.22 of funding so far, marked at 0.65900 (+GBP 15, net 14.78);
    // its mark at Monday's midnight was 0.65700 (-10 pips x 1.5 = -GBP 15). Today: 14.78 - (-15) = +GBP 29.78.
    {
      ...base, friday: "2026-11-06", status: "open", equity_before: 1030, entry_ts: "2026-11-08T21:00:05Z", mark_ts: "2026-11-09T07:55:00Z", mark_price: 0.659,
      midnight_ts: "2026-11-08T23:59:00Z", midnight_price: 0.657, pnl_gbp: 15, funding_gbp: 0.22, net_gbp: 14.78,
    },
  ];
  const v = fxwView({ state: STATE, rows, gbpusd: 1.3, nowMs: Date.parse("2026-11-09T08:00:00Z"), dayStartMs: Date.parse("2026-11-09T00:00:00Z") })!;
  // Equity 1,000 + 30 + 14.78 = 1,044.78; deployed the open margin, 493.50.
  assertEquals([v.capitalGbp, v.equityGbp, v.realisedGbp, v.unrealisedGbp, v.valueGbp, v.todayGbp, v.feesGbp], [1000, 1044.78, 30, 14.78, 493.5, 29.78, 0]);
  // Dollars at 1.30: 1,300; 39; 19.21 (14.78 x 1.3 = 19.214); 641.55; 38.71 (29.78 x 1.3 = 38.714).
  assertEquals([v.capitalUsd, v.realisedUsd, v.unrealisedUsd, v.valueUsd, v.todayUsd], [1300, 39, 19.21, 641.55, 38.71]);
  // From Friday 30 October 21:35 to Monday 9 November 08:00: 9 whole days. One trade closed, two weekends, one open.
  assertEquals([v.daysRun, v.trades, v.weekends, v.running, v.started], [9, 1, 2, true, true]);
  assertEquals([v.open?.side, v.open?.entryPrice, v.open?.markPrice, v.nextText], ["long", 0.658, 0.659, "exit at Friday's mid, or +24 h"]);
  // The table is newest first.
  assertEquals(v.rows.map((r) => r.friday), ["2026-11-06", "2026-10-30"]);
});

Deno.test("fxw view: before its first run it is absent; before its start it is funded and idle; a stopped run is not running", () => {
  assertEquals(fxwView({ state: null, rows: [], gbpusd: 1.3, nowMs: 0, dayStartMs: 0 }), null);
  const idle = fxwView({ state: { ...STATE, last_run: "2026-10-29T12:00:00Z" }, rows: [], gbpusd: 1.3, nowMs: Date.parse("2026-10-29T12:05:00Z"), dayStartMs: Date.parse("2026-10-29T00:00:00Z") })!;
  assertEquals([idle.started, idle.running, idle.equityGbp, idle.trades, idle.daysRun, idle.nextText, idle.todayGbp], [false, true, 1000, 0, 0, "Friday 21:35 UK", 0]);
  const stopped = fxwView({ state: STATE, rows: [], gbpusd: null, nowMs: Date.parse("2026-11-09T08:14:00Z"), dayStartMs: 0 })!;
  assertEquals([stopped.running, stopped.lagMinutes, stopped.capitalUsd], [false, 16, 0]);
  // A trade closed today that opened after midnight counts whole; one closed yesterday counts nothing today.
  const rows: FxwRow[] = [
    { ...base, friday: "2026-10-30", entry_ts: "2026-11-01T21:00:05Z", exit_ts: "2026-11-01T23:10:00Z", pnl_gbp: 30, net_gbp: 30 },
    { ...base, friday: "2026-11-06", entry_ts: "2026-11-09T00:30:00Z", exit_ts: "2026-11-09T02:00:00Z", pnl_gbp: -12, net_gbp: -12 },
  ];
  const t = fxwView({ state: STATE, rows, gbpusd: 1.3, nowMs: Date.parse("2026-11-09T08:00:00Z"), dayStartMs: Date.parse("2026-11-09T00:00:00Z") })!;
  assertEquals([t.todayGbp, t.realisedGbp, t.equityGbp, t.open], [-12, 18, 1018, null]);
});
