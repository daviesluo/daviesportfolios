// "Stablecoin quotes USDC/GBP"'s page (cb_live.ts `cbLiveDetail`, through `readCbLive`; Davies, 2026-10-29: "网页中live的coinbase策略
// 子页面打不开，点了没反应"), pinned against a record worked out by hand at the browser sweep's clock (`src/e2e/cb_live_fixture.json`,
// which the sweep serves as the dashboard's `cbLive`): the fixture's `output` is the function's answer for its `input`.
//
// The record by hand. Capital £120. 15 Sep: four 403 refusals (three entries and a top-up; the account could not buy crypto
// yet), then a top-up of 80 USDC at 0.7473, a maker, no fee. Trip A, bid 0.1 %: 26.78 bought at 0.7466 on 16 Sep, sold at 0.7481:
// +26.78 × 0.0015 = +£0.04017. Trip B, ask 0.2 %: 26.68 sold at 0.7495 on 16 Sep, its exit replaced unfilled, bought back by the
// 24-hour stop at 0.7510 on 17 Sep with a £0.01 fee: −26.68 × 0.0015 − 0.01 = −£0.05002. Trip C, bid 0.2 %: 26.81 bought at 0.7459
// on 17 Sep, held, its exit resting at 0.7474. Fair 0.7477. REALIZED −£0.00985; the coins 80 + 26.81 = 106.81 USDC costing
// 80 × 0.7473 + 26.81 × 0.7459 = £79.781579, worth 106.81 × 0.7477 = £79.861837: UNREALIZED +£0.080258 (the top-up's
// 80 × 0.0004 and C's 26.81 × 0.0018). DEPLOYED: that and the bid resting at 0.7451 for 26.84 (£19.998484), £99.860321. TODAY
// (the loss stop's figure): B's −0.05002 and C's marked +0.048258, −£0.001762. Pounds: 120 − 59.784 − 19.993948 + 20.034118
// + 19.99666 − 20.03668 − 0.01 − 19.997579 = £40.208571.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../src/e2e/cb_live_fixture.json" with { type: "json" };
import { cbLiveDetail, cbLiveOrderView, readCbLive, type CbLivePageOrder, type FillRow } from "./cb_live.ts";
import { memDb } from "./testing.ts";

const NOW = Date.parse(fixture.now);
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
// deno-lint-ignore no-explicit-any
const read = async (input: any = fixture.input) => (await readCbLive(memDb(structuredClone(input), { now: () => NOW }).db, NOW))!;

Deno.test("its page's fixture is readCbLive's answer for its tables", async () => {
  assertEquals(await read() as unknown, fixture.output);
});

Deno.test("its figures match the record worked by hand, and the page's parts add up to the row's", async () => {
  const o = await read();
  close(o.realisedGbp, 26.78 * 0.0015 - (26.68 * 0.0015 + 0.01));
  close(o.unrealisedGbp, 80 * 0.0004 + 26.81 * 0.0018);
  close(o.costGbp, 80 * 0.7473 + 26.81 * 0.7459);
  close(o.valueGbp, 106.81 * 0.7477 + 26.84 * 0.7451);
  // TODAY is today's realised, B's stop on 17 Sep (Davies, 2026-10-30): the figure DAYS shows for today, never C's mark as well
  // (it was -(26.68 × 0.0015 + 0.01) + 26.81 × 0.0018, the loss stop's reading; C's mark is UNREALIZED's).
  close(o.todayGbp, -(26.68 * 0.0015 + 0.01));
  close(o.todayGbp, o.detail.days.find((x) => x.today)!.realisedGbp);
  assertEquals([o.feesGbp, o.heldRungs, o.openOrders, o.lossStopGbp, o.capitalGbp, o.running, o.tradedLive, o.armed], [0.01, 1, 4, -1.2, 120, true, true, true]);
  const d = o.detail;
  // BOOKS: one book, its six rungs: C held with its exit resting, three entries quoting, two idle.
  assertEquals(d.books.map((b) => [b.book, b.lastPrice, b.fair, b.trips, b.won]), [["USDC-GBP", 0.7476, 0.7477, 2, 1]]);
  assertEquals(d.rungs.map((r) => [r.side, r.k, r.order?.leg ?? null, r.order?.price ?? null, r.held?.base ?? null]), [
    ["bid", 0.001, null, null, null], ["bid", 0.002, "exit", 0.7474, 26.81], ["bid", 0.003, "entry", 0.7451, null],
    ["ask", 0.001, "entry", 0.7487, null], ["ask", 0.002, null, null, null], ["ask", 0.003, "entry", 0.7502, null],
  ]);
  close(d.rungs[1].held!.unrealisedGbp, 26.81 * 0.0018);
  // The rungs' realised add up to REALIZED; the days' too; the coins' unrealised is UNREALIZED.
  close(d.rungs.reduce((a, r) => a + r.realisedGbp, 0), o.realisedGbp);
  close(d.days.reduce((a, x) => a + x.realisedGbp, 0), o.realisedGbp);
  close(d.inventory.assets[1].unrealisedGbp, o.unrealisedGbp);
  // INVENTORY: its pounds as its own record moves them, and the coins at fair.
  assertEquals(d.inventory.assets.map((a) => a.asset), ["GBP", "USDC"]);
  close(d.inventory.assets[0].amount, 120 - 80 * 0.7473 - 26.78 * 0.7466 + 26.78 * 0.7481 + 26.68 * 0.7495 - 26.68 * 0.751 - 0.01 - 26.81 * 0.7459);
  assertEquals([d.inventory.assets[1].amount, d.inventory.assets[1].price, d.inventory.assets[1].priceFrom], [106.81, 0.7477, "fair"]);
  // DAYS: 15 Sep's five POSTs (the four 403s and the top-up); 16 Sep's four; 17 Sep's eight, the order refused at the touch
  // before it was sent not among them.
  assertEquals(d.days.map((x) => [x.day, x.today, x.orders, x.fills, x.trips, x.won]), [
    ["2026-09-17", true, 8, 1, 1, 0], ["2026-09-16", false, 4, 2, 1, 1], ["2026-09-15", false, 5, 0, 0, 0],
  ]);
  close(d.days[1].realisedGbp, 26.78 * 0.0015);
  // ROUND TRIPS, newest first: B by its 24-hour stop, then A.
  assertEquals(d.trips.map((t) => [t.side, t.k, t.how, t.entry, t.exit, t.qty, t.feesGbp]), [["ask", 0.002, "stop", 0.7495, 0.751, 26.68, 0.01], ["bid", 0.001, "exit", 0.7466, 0.7481, 26.78, 0]]);
  // ORDERS: what rests, C's entry that filled and the top-up conversion (the page lists it under CONVERSIONS); no refusal (the 403s, the post-only one, the one never sent),
  // no cancel that filled nothing, nothing of a closed trip.
  assertEquals(d.orders.map((x) => [x.id, x.leg, x.venueSide, x.state]), [[18, "entry", "buy", "new"], [17, "entry", "sell", "new"], [16, "entry", "sell", "new"], [12, "exit", "sell", "new"], [11, "entry", "buy", "filled"], [5, "convert", "buy", "filled"]]);
});

Deno.test("its first night as production has it: one top-up filled, four 403s, nothing else to list", async () => {
  // 2026-10-29: 13.37 USDC bought at 0.7473 as a maker, no commission; four orders refused 403 at 20:54. Fair 0.7477.
  const input = structuredClone(fixture.input);
  const keep = new Set([1, 2, 3, 4, 5]);
  input.cb_live_orders = input.cb_live_orders.filter((o) => keep.has(o.id)).map((o) => (o.id === 5 ? { ...o, base_size: 13.37, filled_size: 13.37 } : o));
  input.cb_live_fills = input.cb_live_fills.filter((f) => f.leg === "convert").map((f) => ({ ...f, size: 13.37 }));
  const o = await read(input);
  assertEquals([o.realisedGbp, o.feesGbp, o.heldRungs, o.openOrders, o.detail.trips.length], [0, 0, 0, 0, 0]);
  // Its one order listed is the top-up, filled; the four 403s are not.
  assertEquals(o.detail.orders.map((x) => [x.leg, x.venueSide, x.base, x.state]), [["convert", "buy", 13.37, "filled"]]);
  close(o.unrealisedGbp, 13.37 * 0.0004);
  close(o.valueGbp, 13.37 * 0.7477);
  assertEquals(o.detail.inventory.assets[1].amount, 13.37);
  assertEquals(o.detail.days.map((x) => [x.day, x.orders]), [["2026-09-17", 0], ["2026-09-16", 0], ["2026-09-15", 5]]);
});

Deno.test("an order's state and reason in PR5 LIVE's page's words", () => {
  const base = { id: 1, client_order_id: "c", leg: "entry", trip: "t", rung_side: "bid", k: 0.001, side: "BUY", price: 0.7466, base_size: 20, filled_size: 0, avg_price: null, created_at: "2026-09-17T22:00:00Z" } as CbLivePageOrder;
  const v = (o: Partial<CbLivePageOrder>) => { const x = cbLiveOrderView({ ...base, ...o } as CbLivePageOrder); return [x.state, x.reason]; };
  assertEquals(v({ state: "open" }), ["new", null]);
  assertEquals(v({ state: "open", filled_size: 5 }), ["partially_filled", null]);
  assertEquals(v({ state: "pending" }), ["pending", "sent; the venue's answer is read next turn"]);
  assertEquals(v({ state: "cancelling", reason: "replaced" }), ["new", "cancel sent (replaced); not confirmed yet"]);
  assertEquals(v({ state: "cancelled", filled_size: 5 }), ["cancelled", "filled in part; the rest was cancelled"]);
  assertEquals(v({ state: "expired", filled_size: 5 }), ["cancelled", "filled in part; the rest ran out at its good-til-date"]);
  assertEquals(v({ state: "filled", filled_size: 20 }), ["filled", null]);
  assertEquals(cbLiveOrderView({ ...base, state: "open", side: "SELL" } as CbLivePageOrder).venueSide, "sell");
});

Deno.test("a remainder worth under £1 closes its trip: a round trip, the coins carried in INVENTORY", () => {
  const f = (leg: FillRow["leg"], side: FillRow["side"], size: number, price: number, at: string): FillRow =>
    ({ entry_id: `${leg}${at}`, trade_id: "t", order_id: "o", client_order_id: "c", trip: "T", leg, rung_side: "bid", k: 0.001, side, price, size, commission: 0, liquidity: "MAKER", trade_time: at });
  const v = cbLiveDetail({ capitalGbp: 120, orders: [], recent: [], notSent: new Set(), fills: [f("entry", "BUY", 20, 0.75, "2026-09-17T10:00:00Z"), f("exit", "SELL", 19.5, 0.751, "2026-09-17T11:00:00Z")],
    book: null, fair: 0.7505, now: Date.parse("2026-09-17T23:00:00Z"), at: null });
  assertEquals([v.heldRungs, v.detail.trips.length, v.detail.inventory.assets[1].amount], [0, 1, 0.5]);
  close(v.unrealisedGbp, 0.5 * 0.0005);
});
