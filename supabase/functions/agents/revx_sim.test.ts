// The simulated Revolut X account of the realistic twins (revx_sim.ts), rule by rule, each with figures worked out by hand
// and driven through the live client's own `revxVenue`, as the executor drives it. Each pin fails without its rule; the
// counterfactuals run in the pre-registration (docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md) are named
// beside them.

import { assert, assertAlmostEquals, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { QUOTE_TICK, type Print, type QuoteBook } from "./quotes.ts";
import { crossesTouch, newSimState, revxAveragePrice, revxHoldFor, revxHundredths, revxTakerFee, SimRevx, type SimBook } from "./revx_sim.ts";

const T = Date.parse("2026-10-02T10:00:25Z");
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const USDC: QuoteBook = "USDC-GBP";
const print = (id: string, ts: number, price: number, qty: number, side: Print["side"]): Print => ({ id, ts, ticks: Math.round(price / QUOTE_TICK), qty, side });
/** A book the turn read: bids and asks of [price, quantity]. */
const read = (bids: Array<[number, number]>, asks: Array<[number, number]>): SimBook => ({ bids, asks, source: "test read", at: T });

/** An account with `balances`, the live client over it, and a book source that serves `book` (or nothing). */
function account(balances: Record<string, number>, book: SimBook | null = read([[0.7549, 500]], [[0.7552, 500]]), seeds: Partial<Record<QuoteBook, Print | null>> = {}) {
  const clock = { now: T };
  const st = newSimState(balances, seeds);
  const sim = new SimRevx(st, () => clock.now, () => book);
  const venue = revxVenue({ apiKey: "simulated", privateKey: KEY }, sim.fetch, REVX_REGION, () => clock.now);
  const place = async (side: "buy" | "sell", base: string, price: string, marketable = false) => {
    const r = await venue.placeLimit({ clientOrderId: crypto.randomUUID(), symbol: "USDC/GBP", side, base, price, marketable });
    return r;
  };
  const view = async (id: string) => {
    const r = await venue.order(id);
    if (!r.ok) throw new Error(r.error);
    return r.view.raw as Record<string, string>;
  };
  return { clock, st, sim, venue, place, view };
}

Deno.test("a resting bid fills only by the prints strictly through it, by their quantity: 132 with 20 and 30 through fills 50, one at its price 0", async () => {
  const a = account({ GBP: 200 });
  const r = await a.place("buy", "132", "0.7550");
  assert(r.ok, JSON.stringify(r));
  const id = r.venueOrderId;
  // A seller at 0.7549 traded beyond our 0.7550: it would have taken us first, as much as it traded. One at 0.7550
  // traded at our level, where our place in its queue is unknown: nothing.
  assertEquals(a.sim.applyPrint(USDC, print("p1", T + 10e3, 0.7549, 20, "sell")), 20);
  assertEquals(a.sim.applyPrint(USDC, print("p2", T + 20e3, 0.7550, 100, "sell")), 0);
  assertEquals(a.sim.applyPrint(USDC, print("p3", T + 30e3, 0.7548, 30, "sell")), 30);
  a.clock.now = T + 40e3;
  const v = await a.view(id);
  assertEquals([v.status, v.filled_quantity, v.leaves_quantity], ["partially_filled", "50", "82"]);
  // 50 × 0.7550 = £37.75 moved; £200 − £37.75 left, of which 82 × 0.7550 = £61.91 is held for the rest.
  assertEquals([v.filled_amount, v.average_fill_price, v.total_fee, v.fee_currency], ["37.75", "0.755", "0", "USDC"]);
  assertAlmostEquals(a.st.balances.GBP, 162.25, 1e-9);
  assertAlmostEquals(a.st.balances.USDC, 50, 1e-12);
  assertAlmostEquals(a.sim.reserved("GBP"), 61.91, 1e-9);
  // A print at the instant the order reached the venue, or before, fills nothing: it traded before we were there.
  const b = account({ GBP: 200 });
  const r2 = await b.place("buy", "132", "0.7550");
  assert(r2.ok);
  assertEquals(b.sim.applyPrint(USDC, print("q1", T, 0.7540, 500, "sell")), 0);
  // A print is applied once: the same one again, or an older one, fills nothing more.
  assertEquals(a.sim.applyPrint(USDC, print("p3", T + 30e3, 0.7548, 30, "sell")), 0);
  assertEquals(a.sim.applyPrint(USDC, print("p0", T + 5e3, 0.7540, 30, "sell")), 0);
});

Deno.test("an ask fills by the buyers strictly over it; the orders a print goes through share it, the best price first", async () => {
  const a = account({ GBP: 0, USDC: 300 });
  const hi = await a.place("sell", "100", "0.7556"), lo = await a.place("sell", "100", "0.7554");
  assert(hi.ok && lo.ok);
  // A buyer at 0.7557 for 150 goes through both: the 0.7554 ask takes its 100 first, the 0.7556 ask the other 50.
  assertEquals(a.sim.applyPrint(USDC, print("b1", T + 5e3, 0.7557, 150, "buy")), 150);
  const vLo = await a.view(lo.venueOrderId), vHi = await a.view(hi.venueOrderId);
  assertEquals([vLo.status, vLo.filled_quantity, vHi.status, vHi.filled_quantity], ["filled", "100", "partially_filled", "50"]);
  // Sells credit the pounds floored: 100 × 0.7554 = £75.54, 50 × 0.7556 = £37.78.
  assertAlmostEquals(a.st.balances.GBP, 75.54 + 37.78, 1e-9);
  assertAlmostEquals(a.st.balances.USDC, 150, 1e-9);
});

Deno.test("the money moves as Revolut X moves it: a buy's debit rounded up to the penny, a sell's credit floored, on the whole notional", async () => {
  // PR5's fill 1184: 13.18565 USDC at 0.7576 is £9.989448…, and the venue moved £9.99, reported as the average 0.7576.
  assertEquals([revxHundredths("buy", 13.18565 * 0.7576), revxHundredths("sell", 13.18565 * 0.7576)], [9.99, 9.98]);
  assertEquals(revxAveragePrice(9.99, 13.18565, "0.0001"), "0.7576");
  assertEquals(revxAveragePrice(9.98, 13.18565, "0.0001"), "0.7569");
  const a = account({ GBP: 50, USDC: 50 }, read([[0.7575, 500]], [[0.7578, 500]]));
  const buy = await a.place("buy", "13.18565", "0.7576"), sell = await a.place("sell", "13.18565", "0.7577");
  assert(buy.ok && sell.ok);
  a.sim.applyPrint(USDC, print("s1", T + 1e3, 0.7575, 20, "sell"));
  a.sim.applyPrint(USDC, print("b1", T + 2e3, 0.7578, 20, "buy"));
  const vb = await a.view(buy.venueOrderId), vs = await a.view(sell.venueOrderId);
  assertEquals([vb.filled_amount, vb.average_fill_price], ["9.99", "0.7576"]);
  // 13.18565 × 0.7577 = £9.99076… floored: £9.99.
  assertEquals([vs.filled_amount, vs.average_fill_price], ["9.99", "0.7576"]);
  assertAlmostEquals(a.st.balances.GBP, 50 - 9.99 + 9.99, 1e-9);
  // On the WHOLE notional so far, not fill by fill: two fills of 10 at 0.7551 are £15.102, so £15.11 moves, where each
  // rounded up on its own would make £7.56 + £7.56 = £15.12.
  const c = account({ GBP: 50 });
  const r = await c.place("buy", "20", "0.7551");
  assert(r.ok);
  c.sim.applyPrint(USDC, print("s1", T + 1e3, 0.7550, 10, "sell"));
  assertAlmostEquals(c.st.balances.GBP, 50 - 7.56, 1e-9);
  c.sim.applyPrint(USDC, print("s2", T + 2e3, 0.7550, 10, "sell"));
  assertAlmostEquals(c.st.balances.GBP, 50 - 15.11, 1e-9);
  assertEquals((await c.view(r.venueOrderId)).filled_amount, "15.11");
});

Deno.test("a resting buy holds its pounds rounded up to the penny; an order the account cannot cover is refused 422 in the venue's words", async () => {
  assertEquals([revxHoldFor("GBP", 0.15028), revxHoldFor("GBP", 0.15), revxHoldFor("USD", 0.15028)], [0.16, 0.15, 0.15028]);
  // PR5's top-up of 2026-10-02 17:56 UTC: 0.19853 USDT at 0.7570 is £0.150287…, held as £0.16 against £0.15 free.
  const a = account({ GBP: 0.15 }, read([[0.7568, 500]], [[0.7572, 500]]));
  const r = await a.place("buy", "0.19853", "0.7570");
  assert(!r.ok);
  assertEquals(r.status, 422);
  assert(/Not enough funds! Wanted £0\.16 but has only £0\.15/.test(JSON.stringify(r.response) + r.error), JSON.stringify(r));
  const s = await account({ GBP: 0, USDC: 1 }).place("sell", "1.5", "0.7560");
  assert(!s.ok && s.status === 422 && /Wanted 1\.5 USDC but has only 1 USDC/.test(JSON.stringify(s.response) + s.error), JSON.stringify(s));
  // What rests is held: a second buy that the first's hold leaves uncovered is refused.
  const b = account({ GBP: 100 });
  assert((await b.place("buy", "100", "0.7550")).ok);                       // £75.50 held
  const second = await b.place("buy", "40", "0.7550");                      // £30.20 more than the £24.50 left
  assert(!second.ok && second.status === 422);
});

Deno.test("a post-only order that would cross the book it met is taken and then rejected, post_only_immediate_match", async () => {
  assertEquals([crossesTouch("buy", 0.7552, 0.7549, 0.7552), crossesTouch("buy", 0.7551, 0.7549, 0.7552), crossesTouch("sell", 0.7549, 0.7549, 0.7552), crossesTouch("sell", 0.7550, 0.7549, 0.7552)], [true, false, true, false]);
  const a = account({ GBP: 100, USDC: 100 });
  const cross = await a.place("buy", "10", "0.7552");
  assert(cross.ok, "the venue takes it, then refuses it");
  const v = await a.view(cross.venueOrderId);
  assertEquals([v.status, v.reject_reason], ["rejected", "post_only_immediate_match"]);
  const under = await a.place("buy", "10", "0.7551");
  assert(under.ok);
  assertEquals((await a.view(under.venueOrderId)).status, "new");
  // With no read for the instant, the touch the last print implies, a tick wide: a buyer lifted 0.7552, so the ask is
  // 0.7552 and the bid 0.7551.
  const b = account({ GBP: 100, USDC: 100 }, null, { [USDC]: print("lp", T - 5e3, 0.7552, 10, "buy") });
  const b1 = await b.place("buy", "10", "0.7552"), b2 = await b.place("buy", "10", "0.7551");
  assert(b1.ok && b2.ok);
  assertEquals([(await b.view(b1.venueOrderId)).status, (await b.view(b2.venueOrderId)).status], ["rejected", "new"]);
  // A seller hit 0.7550: the bid is 0.7550 and the ask 0.7551.
  const c = account({ GBP: 100, USDC: 100 }, null, { [USDC]: print("lp", T - 5e3, 0.7550, 10, "sell") });
  const c1 = await c.place("sell", "10", "0.7550"), c2 = await c.place("sell", "10", "0.7551");
  assert(c1.ok && c2.ok);
  assertEquals([(await c.view(c1.venueOrderId)).status, (await c.view(c2.venueOrderId)).status], ["rejected", "new"]);
});

Deno.test("a marketable IOC walks the book's levels to its limit, a taker's 0.09 % in the coin; what the levels lack is cancelled", async () => {
  // The live account's go-live conversions (the validation replays them): 396 USDC up to 0.7580 against 200 at 0.7570 and
  // 300 at 0.7575 is 200 × 0.7570 + 196 × 0.7575 = £151.40 + £148.47 = £299.87, its fee 396 × 0.0009 = 0.3564 USDC.
  assertEquals(revxTakerFee("buy", 396, 299.87, "0.00001"), 0.3564);
  assertEquals(revxTakerFee("sell", 10, 7.55, "0.00001"), 0.01);              // a sell's in pounds, rounded up to the penny
  const a = account({ GBP: 400 }, read([[0.7565, 500]], [[0.7570, 200], [0.7575, 300]]));
  const r = await a.place("buy", "396", "0.7580", true);
  assert(r.ok && r.state === "filled", JSON.stringify(r));
  const v = await a.view(r.venueOrderId);
  assertEquals([v.status, v.filled_quantity, v.filled_amount, v.total_fee, v.fee_currency, v.average_fill_price], ["filled", "396", "299.87", "0.3564", "USDC", "0.7572"]);
  assertAlmostEquals(a.st.balances.GBP, 400 - 299.87, 1e-9);
  assertAlmostEquals(a.st.balances.USDC, 395.6436, 1e-9);
  // Deeper than the book: 100 at 0.7570 within the limit 0.7572, the rest cancelled.
  const b = account({ GBP: 400 }, read([[0.7565, 500]], [[0.7570, 100], [0.7575, 300]]));
  const r2 = await b.place("buy", "396", "0.7572", true);
  assert(r2.ok);
  const v2 = await b.view(r2.venueOrderId);
  assertEquals([v2.status, v2.filled_quantity, v2.filled_amount], ["cancelled", "100", "75.7"]);
  // With only the last print's touch known, of unknown depth, it fills there whole.
  const c = account({ GBP: 400 }, null, { [USDC]: print("lp", T - 5e3, 0.7552, 10, "buy") });
  const r3 = await c.place("buy", "396", "0.7580", true);
  assert(r3.ok);
  const v3 = await c.view(r3.venueOrderId);
  assertEquals([v3.status, v3.filled_quantity, v3.average_fill_price], ["filled", "396", "0.7552"]);
});

Deno.test("a cancel lands a read after its 204; a print a second after it is asked finds the order gone", async () => {
  const a = account({ GBP: 100 });
  const r = await a.place("buy", "100", "0.7550");
  assert(r.ok);
  assertEquals((await a.venue.cancel(r.venueOrderId)).ok, true);
  // The first read after the 204 still shows it resting (PR5's first live hour); the second shows it cancelled.
  assertEquals((await a.view(r.venueOrderId)).status, "new");
  assertEquals((await a.view(r.venueOrderId)).status, "cancelled");
  // A cancel asked at T: a print 0.5 s later still fills the order; one 1 s or more later does not.
  const b = account({ GBP: 200 });
  const r1 = await b.place("buy", "100", "0.7550"), r2 = await b.place("buy", "100", "0.7550");
  assert(r1.ok && r2.ok);
  b.clock.now = T + 10e3;
  await b.venue.cancel(r1.venueOrderId);
  await b.venue.cancel(r2.venueOrderId);
  assertEquals(b.sim.applyPrint(USDC, print("s1", T + 10_500, 0.7549, 30, "sell")), 30);
  assertEquals(b.sim.applyPrint(USDC, print("s2", T + 11_000, 0.7549, 30, "sell")), 0);
  assertEquals(b.st.orders.map((o) => [o.status, o.filled]), [["cancelled", 30], ["cancelled", 0]]);
});

Deno.test("the dead-man cancels every resting order at its instant", async () => {
  const a = account({ GBP: 200, USDC: 100 });
  assert((await a.place("buy", "100", "0.7550")).ok && (await a.place("sell", "50", "0.7556")).ok);
  assertEquals(a.sim.deadman(T + 180e3), 2);
  assertEquals(a.st.orders.map((o) => [o.status, o.done, o.cancelledBy]), [["cancelled", T + 180e3, "deadman"], ["cancelled", T + 180e3, "deadman"]]);
  assertEquals(a.sim.applyPrint(USDC, print("s1", T + 200e3, 0.7540, 500, "sell")), 0);
  assertEquals(a.st.deadmen, [{ at: T + 180e3, cancelled: 2 }]);
  assertEquals(a.sim.reserved("GBP"), 0);
});

Deno.test("nothing reaches a network: the account answers from memory, and refuses every host and route that is not the venue's", async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((i: string | URL | Request) => { calls.push(String(i)); return Promise.reject(new Error("no network in this test")); }) as typeof fetch;
  try {
    const a = account({ GBP: 100, USDC: 10 });
    const r = await a.place("buy", "10", "0.7550");
    assert(r.ok);
    await a.view(r.venueOrderId);
    await a.venue.cancel(r.venueOrderId);
    assertEquals(Object.keys(await a.venue.balances()).sort(), ["GBP", "USDC"]);
    const active = await a.venue.activeOrders();
    assert(active.ok);
    const pairs = await (await a.sim.publicFetch("https://revx.revolut.com/api/1.0/public/configuration/pairs")).json();
    assertEquals(Object.keys(pairs).sort(), ["USDC/GBP", "USDT/GBP"]);
    await assertRejects(() => a.sim.fetch("https://example.com/api/1.0/orders", { method: "POST", body: "{}" }));
    await assertRejects(() => a.sim.publicFetch("https://revx.revolut.com/api/1.0/orders", { method: "POST" }));
    assertEquals((await a.sim.fetch("https://revx.revolut.com/api/1.0/withdrawals", { method: "POST" })).status, 404);
    assertEquals(calls, []);
  } finally { globalThis.fetch = real; }
});
