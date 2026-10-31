// mm_page.ts: the £600 arm on the page. Its scoreboard adds up (FUNDED + REALIZED + UNREALIZED is its pounds and its coin at the
// fair), TODAY is DAYS' today, DEPLOYED is the coin and the resting bid, and an arm with no decided minute is not on the page.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mmNew } from "./mm_core.ts";
import { type MmDayDb, mmDays, type MmTripDb, mmView, readMmPage } from "./mm_page.ts";
import { type ArmState, MM_ARMS, mmParamsOf } from "./mm_paper.ts";
import { memDb } from "./testing.ts";

const T = Date.UTC(2026, 10, 5, 10, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function arm(): ArmState {
  const core = mmNew(mmParamsOf(MM_ARMS[0]));
  // bought 300 XRP at 0.92 and 100 at 0.93 (the 100 still held, the 300 sold at 0.935), a bid resting at 0.928 for 150 XRP
  core.cash = 600 - 300 * 0.92 - 100 * 0.93 + 300 * 0.935;
  core.coin = 100;
  core.bid = { price: 0.928, left: 150, since: T / 1000 - 30 };
  core.ask = { price: 0.9312, left: 100, since: T / 1000 - 30 };
  core.c = -3.2;
  return { core, lots: [{ qty: 100, price: 0.93, sec: T / 1000 - 600 }], lastMinute: T, startAt: Date.UTC(2026, 10, 2), lastFair: 0.9301 };
}

const trips: MmTripDb[] = [
  { t_exit: iso(T - 3600e3 * 20), seq: 0, t_entry: iso(T - 3600e3 * 21), qty: 200, entry: 0.92, exit: 0.935, fee_gbp: 0, pnl_gbp: 3, how: "maker" },
  { t_exit: iso(T - 600e3), seq: 0, t_entry: iso(T - 900e3), qty: 100, entry: 0.92, exit: 0.935, fee_gbp: 0, pnl_gbp: 1.5, how: "maker" },
];
const days: MmDayDb[] = [
  { day: "2026-11-04", orders: 2000, fills: 40, stale_s: 0, pnl_gbp: 2.1, trips: 1, won: 1, realised_gbp: 3 },
  { day: "2026-11-05", orders: 900, fills: 12, stale_s: 4, pnl_gbp: 1.2, trips: 1, won: 1, realised_gbp: 1.5 },
];

Deno.test("mmView — the scoreboard adds up, TODAY is DAYS' today, DEPLOYED the coin at the fair and the resting bid", () => {
  const dayStart = Date.UTC(2026, 10, 5);
  const v = mmView({ st: { state: arm(), last_minute: iso(T), last_error: null }, trips, days, last: { minute: iso(T), fair: 0.9301, bid: 0.928, ask: 0.9312, cash: 0, coin: 100, cost: 93 },
    lastPrint: 0.93, nowMs: T + 2 * 60e3, dayStartMs: dayStart, gbpusd: 1.3 })!;
  const st = arm();
  assertAlmostEquals(v.capitalGbp + v.realisedGbp + v.unrealisedGbp, st.core.cash + st.core.coin * 0.9301, 1e-9);
  assertAlmostEquals(v.unrealisedGbp, 100 * 0.9301 - 93, 1e-9);
  assertAlmostEquals(v.valueGbp, 100 * 0.9301 + 0.928 * 150, 1e-9);
  assertEquals([v.todayGbp, v.detail.days[0].day, v.detail.days[0].realisedGbp, v.detail.days[0].today], [1.5, "2026-11-05", 1.5, true]);
  assertEquals([v.running, v.lagMinutes, v.venue, v.ccy, v.twin.id, v.twin.name], [true, 2, "revx", "GBP", "xrpgbp", "Crypto quotes XRP/GBP"]);
  assertEquals(v.detail.orders.map((o) => [o.side, o.leg, o.price]), [["bid", "entry", 0.928], ["ask", "exit", 0.9312]]);
  assertEquals(v.detail.inventory.assets.map((a) => a.asset), ["GBP", "XRP"]);
  assertAlmostEquals(v.capitalUsd, 600 * 1.3, 1e-9);
  assertEquals(v.detail.trips[0].tExit, iso(T - 600e3));                       // newest first
});

Deno.test("mmDays — newest first, the day marked at the fair beside the realised", () => {
  assertEquals(mmDays(days, "2026-11-05").map((d) => [d.day, d.realisedGbp, d.pnlGbp, d.today]), [["2026-11-05", 1.5, 1.2, true], ["2026-11-04", 3, 2.1, false]]);
});

Deno.test("readMmPage — nothing before the arm has decided a minute; its view once it has", async () => {
  assertEquals(await readMmPage(memDb({}, { now: () => T }).db, T, Date.UTC(2026, 10, 5)), []);
  const { db } = memDb({
    agent_mm_state: [{ arm: "p600", state: arm(), last_minute: iso(T), updated_at: iso(T), last_error: null }],
    agent_mm_trips: trips.map((t) => ({ arm: "p600", ...t })), agent_mm_days: days.map((x) => ({ arm: "p600", ...x })),
    agent_mm_minutes: [{ arm: "p600", minute: iso(T), fair: 0.9301, bid: 0.928, ask: 0.9312, cash: 0, coin: 100, cost: 93 }],
    agent_mm_prints: [{ book: "XRP-GBP", id: "a", ts: iso(T - 5e3), price: 0.9305, qty: 1, side: "buy" }],
    agent_quote_inputs: [{ kind: "fx", t: iso(T), value: 1.3 }],
  }, { now: () => T });
  const out = await readMmPage(db, T + 60e3, Date.UTC(2026, 10, 5));
  assertEquals([out.length, out[0].detail.books[0].lastPrice, out[0].detail.tripCount, out[0].todayGbp], [1, 0.9305, 2, 1.5]);
});
