// The go-live audit's defects (reviews/2026-09-23-golive-audit.md), each pinned by the behaviour its fix promises. The
// audit reproduced every one of them on the code as it stood; each test here failed there and passes now.
//   D2 a rule exit whose IOC dies unfilled is tried again, not left long for the rest of its bar
//   D3 a placement answered 5xx stays pending, and the venue's order history settles it
//   D4 a buy fee taken in the coin is booked net, so the exit leaves the book flat
//   D5 the trail counts the high of the bar the entry filled in
//   D6 the re-entry cooldown is counted in the rule's own bars, as the backtester counts it
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { highWaterSince, positionFromFills, type Candle } from "../_shared/agents_strategy.ts";
import { krakenVenue } from "../_shared/kraken.ts";
import { revxVenue } from "../_shared/revx.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import { FakeKraken, FakeRevx, jevFetch, memDb, type Row } from "./testing.ts";
import { fromItsBar, MAX_MARKETABLE_ATTEMPTS, tick, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

const FOUR_H = 4 * 3600e3, ONE_D = 86400e3, ONE_M = 60e3;
const NOW = Date.parse("2026-09-20T04:05:00Z");
const PAIR = { base_step: "0.000001", quote_step: "0.01", min_order_size: "0.001", min_order_size_quote: "0.5" };

/** A rising 4-hour series whose last CLOSED bar (index 128) can be made to close where a test says, and a daily one. */
function series(lastClosedClose?: number): { bars: Candle[]; c1d: Candle[]; lastClose: number } {
  const count = 130, lastBarStart = Math.floor(NOW / FOUR_H) * FOUR_H;
  const bars: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 * Math.pow(1.002, i);
    bars.push({ start: lastBarStart - (count - 1 - i) * FOUR_H, open: close / 1.002, high: close * 1.0005, low: close / 1.002 * 0.9995, close, volume: 1 });
  }
  if (lastClosedClose != null) {
    const b = bars[128];
    bars[128] = { ...b, close: lastClosedClose, low: Math.min(b.low, lastClosedClose) };
  }
  const lastDayStart = Math.floor(NOW / ONE_D) * ONE_D;
  const c1d: Candle[] = [];
  for (let i = 0; i < 130; i++) {
    const close = 100 * Math.pow(1.01, i);
    c1d.push({ start: lastDayStart - (129 - i) * ONE_D, open: close / 1.01, high: close * 1.002, low: close / 1.01 * 0.998, close, volume: 1 });
  }
  return { bars, c1d, lastClose: bars[128].close };
}

/** A venue that serves fixed candles and one quote, records every call, and answers each read-back with `orderView`. */
function stubVenue(id: VenueId, o: { bars: Candle[]; c1d: Candle[]; quote: Quote; feeBps: { maker: number; taker: number }; canTrade: boolean; orderView?: OrderView; balances?: Record<string, number> }) {
  const calls: string[] = [];
  const c1m: Candle[] = [{ start: Math.floor(NOW / ONE_M) * ONE_M - ONE_M, open: o.quote.bid, high: o.quote.bid, low: o.quote.bid, close: o.quote.bid, volume: 1 }];
  const v: Venue = {
    id, canTrade: o.canTrade, feeBps: o.feeBps,
    candles: (_s, iv) => Promise.resolve(iv === 240 ? o.bars : iv === 1440 ? o.c1d : iv === 60 ? o.bars : c1m),
    quotes: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, o.quote]))),
    pairs: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, PAIR]))),
    placeLimit: (req) => { calls.push(`place ${req.side} ${req.base}@${req.price}${req.marketable ? " ioc" : ""}`); return Promise.resolve({ ok: true as const, venueOrderId: `V-${calls.length}`, state: "new" as const, response: {} }); },
    cancel: (vid) => { calls.push(`cancel ${vid}`); return Promise.resolve({ ok: false, error: "404 Order is not active" }); },
    order: (vid) => { calls.push(`order ${vid}`); return Promise.resolve(o.orderView ? { ok: true as const, view: o.orderView } : { ok: false as const, error: "no view" }); },
    balances: () => Promise.resolve({ ...(o.balances ?? {}) }),
    activeOrders: () => Promise.resolve({ ok: true as const, byClientId: {} }),
  };
  return { v, calls };
}

const LIVE: StrategyRow = {
  id: "trend-4h-live", kind: "trend-4h", venue: "revx", signal_venue: "kraken", name: "t", symbols: ["BTC/USD"], mode: "live", capital_usd: 25,
  params: { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42, enterMin: 0.45, exitMax: 0.3 },
};
const RISK: RiskRow & { id: number } = { id: 1, global_pause: false, max_exposure_usd: 150, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: "2026-09-20T00:00:00Z" };

const bookOf = (orders: Row[]) => positionFromFills((orders as unknown as OrderRow[]).filter((o) => o.state === "filled").map((o) => ({
  ts: Date.parse(String(o.filled_at ?? o.ts)), side: o.side, base: Number(o.filled_base), price: Number(o.avg_fill_price ?? o.price), feeUsd: Number(o.fee_usd),
})));

Deno.test("D2 — a rule exit whose IOC dies unfilled is sent again, up to MAX_MARKETABLE_ATTEMPTS in all", async () => {
  const s = series(120);                                             // the last closed bar closes far below the 20-bar low: a rule exit
  const quote = { bid: 126.0, ask: 126.02 };                         // above the 8 % floor of a 125 entry, so only the RULE exits
  const kraken = stubVenue("kraken", { bars: s.bars, c1d: s.c1d, quote, feeBps: { maker: 40, taker: 80 }, canTrade: false });
  // Every read-back of a sell is an IOC that found nothing at its limit: cancelled, nothing filled.
  const revx = stubVenue("revx", { bars: s.bars, c1d: s.c1d, quote, feeBps: { maker: 0, taker: 9 }, canTrade: true, balances: { BTC: 0.2, USD: 0 },
    orderView: { state: "cancelled", filledBase: 0, avgPrice: null, feeUsd: 0, raw: { status: "cancelled", filled_quantity: "0" } } });
  const long: Row = { id: 50, ts: new Date(NOW - 2 * ONE_D).toISOString(), filled_at: new Date(NOW - 2 * ONE_D).toISOString(), strategy_id: LIVE.id, venue: "revx",
    symbol: "BTC/USD", mode: "live", side: "buy", price: 125, base_size: 0.2, filled_base: 0.2, avg_fill_price: 125, fee_usd: 0.0225, state: "filled",
    client_order_id: "00000000-0000-4000-8000-000000000050", venue_order_id: "V-0", decision_id: null, requotes: 0, request: { marketable: true } };
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [LIVE as unknown as Row], agent_orders: [long], agent_decisions: [], agent_observations: [], agent_maker_probes: [],
    agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => NOW });
  let n = 0;
  const deps = { db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now: NOW, fetchImpl: jevFetch({}), uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
  const r1 = await tick(deps);
  assertEquals(r1.decisions.map((d) => [d.action, d.allowed, d.kind]), [["exit", true, "bar"]], JSON.stringify(r1));
  const sells = () => revx.calls.filter((c) => c.startsWith("place sell")).length;
  assertEquals(sells(), 1);
  // Each later minute reads the dead IOC back and sends the exit again, while the bar is still the one decided.
  for (let k = 1; k <= 2 * MAX_MARKETABLE_ATTEMPTS; k++) { deps.now = NOW + k * ONE_M; await tick(deps); }
  assertEquals(sells(), MAX_MARKETABLE_ATTEMPTS, revx.calls.join(" | "));
  const attempts = (mem.tables.agent_orders as Row[]).filter((o) => o.side === "sell").map((o) => Number(o.requotes));
  assertEquals(attempts, [...Array(MAX_MARKETABLE_ATTEMPTS).keys()]);   // 0, 1, 2 … one row per attempt, numbered
  deps.now = NOW + (2 * MAX_MARKETABLE_ATTEMPTS + 1) * ONE_M;
  const done = await tick(deps);
  assert(done.skipped.some((x) => x.includes("already decided")), JSON.stringify(done.skipped));   // and then it stops
});

Deno.test("D3 — a buy the venue executed but answered 503 stays pending, and its history (read back by id) settles it", async () => {
  const BAR0 = Date.parse("2026-09-23T04:00:00Z");
  let now = BAR0 + 5 * ONE_M;
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [{ ...LIVE, capital_usd: 20 } as unknown as Row], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  const inner = rx.fetch;
  let fail503 = true;
  // The venue takes the order (it fills at the touch), then its gateway answers 503: a reply that says nothing about the order.
  rx.fetch = async (input, init) => {
    const res = await inner(input, init);
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    if (p === "/api/1.0/orders" && m === "POST" && fail503) { fail503 = false; return new Response(JSON.stringify({ message: "Something went wrong!" }), { status: 503 }); }
    return res;
  };
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, rx.fetch), kraken: krakenVenue(null, kr.fetch) };
  const at = (t: number) => { now = t; return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({}), uuid: () => crypto.randomUUID() }); };
  const r1 = await at(BAR0 + 5 * ONE_M);
  const first = mem.tables.agent_orders[0];
  assertEquals([first.side, first.state], ["buy", "pending"], JSON.stringify(r1.errors));   // never `rejected` on a 5xx
  assert((rx.balances.BTC ?? 0) > 0, "the venue executed it");
  await at(BAR0 + 6 * ONE_M);                                        // under a minute old: still this turn's, left alone
  assertEquals(mem.tables.agent_orders[0].state, "pending");
  await at(BAR0 + 7 * ONE_M);                                        // not resting, so the history finds it; GET /orders/{id} settles it
  const settled = mem.tables.agent_orders[0];
  assertEquals(settled.state, "filled");
  assert(Number(settled.avg_fill_price) > 0 && Number(settled.fee_usd) > 0, JSON.stringify(settled));   // the fields the list does not carry
  assert(rx.calls.some((c) => c === "GET /api/1.0/orders/historical"), rx.calls.join(" | "));
  // The book now equals the venue, and the next bar does not buy the coin a second time.
  await at(BAR0 + FOUR_H + ONE_M);
  await at(BAR0 + FOUR_H + 2 * ONE_M);
  const book = bookOf(mem.tables.agent_orders as Row[]);
  assertEquals(Math.round(book.base * 1e8), Math.round((rx.balances.BTC ?? 0) * 1e8));
  assertEquals((mem.tables.agent_orders as Row[]).filter((o) => o.side === "buy").length, 1);
});

Deno.test("D4 — a buy fee taken in BTC is booked net: the floor's exit leaves the book flat, and the rule can enter again", async () => {
  const BAR0 = Date.parse("2026-09-23T04:00:00Z");
  let now = BAR0 + 5 * ONE_M;
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [{ ...LIVE, capital_usd: 20 } as unknown as Row], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  const inner = rx.fetch;
  // The venue as its reference allows: a buy's `filled_quantity` is GROSS ("before fees"), the fee is charged in the base
  // currency, `fee_currency` says so, and the account receives filled − fee.
  rx.fetch = async (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    const before = new Set(rx.orders.keys());
    const res = await inner(input, init);
    if (p === "/api/1.0/orders" && m === "POST") {
      for (const [id, o] of rx.orders) if (!before.has(id) && o.side === "buy" && o.status === "filled" && o.avg) {
        const feeBase = Math.round(o.fee / o.avg * 1e8) / 1e8;
        rx.balances.BTC = Math.round(((rx.balances.BTC ?? 0) - feeBase) * 1e8) / 1e8; rx.balances.USD += o.fee;
        (o as unknown as { feeBase: number }).feeBase = feeBase;
      }
    }
    if (m === "GET" && p.startsWith("/api/1.0/orders/") && p !== "/api/1.0/orders/active" && p !== "/api/1.0/orders/historical") {
      const o = rx.orders.get(p.split("/").at(-1)!) as unknown as { side: string; feeBase?: number } | undefined;
      if (o?.side === "buy" && o.feeBase != null) {
        const j = await res.json();
        j.data.total_fee = String(o.feeBase); j.data.fee_currency = "BTC";
        return new Response(JSON.stringify(j), { status: 200 });
      }
    }
    return res;
  };
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, rx.fetch), kraken: krakenVenue(null, kr.fetch) };
  const at = (t: number) => { now = t; return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({}), uuid: () => crypto.randomUUID() }); };
  await at(BAR0 + 5 * ONE_M);                                        // entry
  await at(BAR0 + 6 * ONE_M);                                        // settled: filled_base = gross − fee
  const buy = (mem.tables.agent_orders as Row[]).find((o) => o.side === "buy")!;
  assertEquals(Math.round(Number(buy.filled_base) * 1e8), Math.round((rx.balances.BTC ?? 0) * 1e8));   // the book holds what the account holds
  rx.shock["BTC/USD"] = 0.9;                                         // the floor fires on the bid
  await at(BAR0 + 10 * ONE_M);
  await at(BAR0 + 11 * ONE_M);
  rx.shock["BTC/USD"] = 1;
  assertEquals(rx.balances.BTC, 0);                                  // the venue is flat …
  assertEquals(bookOf(mem.tables.agent_orders as Row[]).base, 0);    // … and so is the book
  // Two bars of cooldown later the rule is free to enter again; it is not stuck reading itself long.
  const orders = mem.tables.agent_orders.length;
  for (const k of [3, 4, 5]) await at(BAR0 + k * FOUR_H + ONE_M);
  assert(mem.tables.agent_orders.length > orders, "the rule entered again");
});

Deno.test("D5 — the trail counts the high of the bar the entry filled in, as the backtester does", () => {
  const t0 = Date.parse("2026-09-23T04:00:00Z");
  const bars: Candle[] = [
    { start: t0, open: 100, high: 110, low: 99, close: 104, volume: 1 },          // the entry bar: filled at 04:00:07, spikes to 110
    { start: t0 + FOUR_H, open: 104, high: 105, low: 101, close: 102, volume: 1 },
  ];
  const pos = positionFromFills([{ ts: t0 + 7_000, side: "buy", base: 1, price: 100, feeUsd: 0 }]);
  assertEquals(highWaterSince(pos, bars, 1), 105);                    // the fill's own timestamp skips its bar …
  assertEquals(highWaterSince(fromItsBar(pos, bars), bars, 1), 110);  // … from the start of that bar, the tick counts it
  assertEquals(fromItsBar({ ...pos, openedAt: null }, bars).openedAt, null);
});

Deno.test("D6 — after an exit filled at a bar's open, the next bar is still cooling down: two of the rule's own bars", async () => {
  const s = series();
  const quote = { bid: Math.round(s.lastClose * 100) / 100, ask: Math.round(s.lastClose * 100) / 100 + 0.02 };
  const kraken = stubVenue("kraken", { bars: s.bars, c1d: s.c1d, quote, feeBps: { maker: 40, taker: 80 }, canTrade: false });
  const revx = stubVenue("revx", { bars: s.bars, c1d: s.c1d, quote, feeBps: { maker: 0, taker: 9 }, canTrade: false });
  // The exit filled at 20:00:04 the day before, in the bar that opened 20:00; the bar decided now opened at 00:00, one later.
  const exitAt = Date.parse("2026-09-19T20:00:04Z");
  const buy: Row = { id: 40, ts: new Date(exitAt - ONE_D).toISOString(), filled_at: new Date(exitAt - ONE_D).toISOString(), strategy_id: "trend-4h", venue: "revx", symbol: "BTC/USD",
    mode: "paper", side: "buy", price: 120, base_size: 0.1, filled_base: 0.1, avg_fill_price: 120, fee_usd: 0, state: "filled", client_order_id: "00000000-0000-4000-8000-000000000040",
    venue_order_id: null, decision_id: null, requotes: 0, request: { marketable: true } };
  const sell: Row = { ...buy, id: 41, side: "sell", ts: new Date(exitAt).toISOString(), filled_at: new Date(exitAt).toISOString(), client_order_id: "00000000-0000-4000-8000-000000000041" };
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [{ ...LIVE, id: "trend-4h", mode: "paper" } as unknown as Row], agent_orders: [buy, sell], agent_decisions: [],
    agent_observations: [], agent_maker_probes: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => NOW });
  let n = 0;
  const r = await tick({ db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now: NOW, fetchImpl: jevFetch({}), uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  assertEquals(r.decisions.map((d) => d.action), ["hold"], JSON.stringify(r));
  const d = (mem.tables.agent_decisions as Row[]).at(-1)!;
  assert(String(d.rule_reason).startsWith("cooling down"), String(d.rule_reason));
});
