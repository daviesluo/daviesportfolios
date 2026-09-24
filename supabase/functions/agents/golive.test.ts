// The go-live audit's defects (reviews/2026-09-23-golive-audit.md), each pinned by the behaviour its fix promises. The
// audit reproduced every one of them on the code as it stood; each test here failed there and passes now.
//   D2 a rule exit whose IOC dies unfilled is tried again, not left long for the rest of its bar
//   D3 a placement answered 5xx stays pending, and the venue's order history settles it
//   D4 a buy fee taken in the coin is booked net, so the exit leaves the book flat
//   D5 the trail counts the high of the bar the entry filled in
//   D6 the re-entry cooldown is counted in the rule's own bars, as the backtester counts it
//   D8 a fill read back without total_fee / fee_currency settles with the schedule's fee, recorded as derived
//   D9 every marketable order records the touch it was priced from and that quote's age, paper and live
//   D10 a lease claim the database does not answer ends the turn with a note, not a crash
//   D11 a coin fee reported finer than the base step leaves no sub-step remainder in the book
//   D12 a coin fee the venue takes without reporting it is booked from the account's balance, never gross
// D11 and D12 were found by the $50 validation (reviews/2026-09-24-trend4h-golive-validation.md), after the audit.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { highWaterSince, positionFromFills, type Candle } from "../_shared/agents_strategy.ts";
import { krakenVenue } from "../_shared/kraken.ts";
import { orderViewProblem, revxVenue, toOrderView, type VenueOrder } from "../_shared/revx.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import { makeDb } from "./db.ts";
import { tickErrorReport } from "./index.ts";
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

Deno.test("D11 — a coin fee reported finer than the base step leaves no sub-step remainder in the book: flat after the exit, and the rule enters again", async () => {
  // D4's double rounds the coin fee to 8 decimals, the base step, so it never met the case the reference leaves open: a
  // 9 bps fee is not a whole number of steps, and a venue that reports it at full precision makes gross − fee fall
  // between two steps. The exit can sell only the step below; the remainder read "long" for good.
  const BAR0 = Date.parse("2026-09-23T04:00:00Z");
  let now = BAR0 + 5 * ONE_M;
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [{ ...LIVE, capital_usd: 12.5 } as unknown as Row], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  const inner = rx.fetch;
  rx.fetch = async (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    const before = new Set(rx.orders.keys());
    const res = await inner(input, init);
    if (p === "/api/1.0/orders" && m === "POST") {
      for (const [id, o] of rx.orders) if (!before.has(id) && o.side === "buy" && o.status === "filled" && o.avg) {
        const feeBase = Number(o.filled) * 0.0009;                      // full precision: 9 bps of the gross, as charged
        rx.balances.BTC = (rx.balances.BTC ?? 0) - feeBase; rx.balances.USD += o.fee;
        (o as unknown as { feeBase: number }).feeBase = feeBase;
      }
    }
    if (m === "GET" && p.startsWith("/api/1.0/orders/") && p !== "/api/1.0/orders/active" && p !== "/api/1.0/orders/historical") {
      const o = rx.orders.get(p.split("/").at(-1)!) as unknown as { side: string; feeBase?: number } | undefined;
      if (o?.side === "buy" && o.feeBase != null) {
        const j = await res.json();
        j.data.total_fee = o.feeBase.toFixed(12); j.data.fee_currency = "BTC";
        return new Response(JSON.stringify(j), { status: 200 });
      }
    }
    return res;
  };
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, rx.fetch), kraken: krakenVenue(null, kr.fetch) };
  const at = (t: number) => { now = t; return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({}), uuid: () => crypto.randomUUID() }); };
  await at(BAR0 + 5 * ONE_M);                                        // entry, a $12.50 slot
  await at(BAR0 + 6 * ONE_M);                                        // settled
  const buy = (mem.tables.agent_orders as Row[]).find((o) => o.side === "buy")!;
  const net = Number(buy.base_size) * (1 - 0.0009);
  assert(Math.abs(net * 1e8 - Math.round(net * 1e8)) > 1e-3, "the fee must fall between two steps for this test to mean anything");
  assertEquals(Number(buy.filled_base), Math.floor(net * 1e8) / 1e8);  // the book holds the sellable part
  rx.shock["BTC/USD"] = 0.9;                                         // the floor fires on the bid
  await at(BAR0 + 10 * ONE_M);
  await at(BAR0 + 11 * ONE_M);
  rx.shock["BTC/USD"] = 1;
  assert((rx.balances.BTC ?? 0) < 1e-8, `the venue keeps under one step, as dust: ${rx.balances.BTC}`);
  assertEquals(bookOf(mem.tables.agent_orders as Row[]).base, 0);    // the book is flat …
  const orders = mem.tables.agent_orders.length;
  for (const k of [3, 4, 5]) await at(BAR0 + k * FOUR_H + ONE_M);
  assert(mem.tables.agent_orders.length > orders, "… and the rule entered again");
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

// ── D8–D10, pinned 2026-09-23 ─────────────────────────────────────────────────────────────────────────

const LIVE_BAR = Date.parse("2026-09-23T04:00:00Z");

/**
 * The real Revolut X and Kraken clients over the fake venues, and the strict in-memory database, as D3 and D4 build them.
 * The client calls `rx.fetch` at call time, so a test may wrap the fake venue after building the world.
 */
async function realWorld(rows: StrategyRow[], o: { fetchImpl?: typeof fetch; clock?: () => number } = {}) {
  let now = LIVE_BAR + 5 * ONE_M;
  const mem = memDb({ agent_risk: [RISK], agent_strategies: rows as unknown as Row[], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, (input, init) => rx.fetch(input, init)), kraken: krakenVenue(null, kr.fetch) };
  const at = (t: number) => {
    now = t;
    return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: o.fetchImpl ?? jevFetch({}), uuid: () => crypto.randomUUID(), clock: o.clock });
  };
  return { rx, at, orders: () => mem.tables.agent_orders as Row[] };
}

Deno.test("D8 — a fill read back with no total_fee / fee_currency settles with the fee its schedule charges, recorded as derived — not refused for good with its pair in flight", async () => {
  const w = await realWorld([{ ...LIVE, capital_usd: 20 }]);
  // GET /orders/{id} carries `total_fee` and `fee_currency` "only when present" (the venue's reference), and the reference's own
  // filled orders carry neither. The venue still charges its 9 bps: the fake takes them from the dollars and does not say so.
  w.rx.dialect = "no-fee";
  await w.at(LIVE_BAR + 5 * ONE_M);                                   // the entry: an IOC at the touch, filled on arrival
  const [buy] = w.orders();
  const atVenue = w.rx.orders.get(String(buy.venue_order_id))!;
  assertEquals([buy.side, buy.state, atVenue.status, atVenue.tif], ["buy", "new", "filled", "ioc"]);
  const r = await w.at(LIVE_BAR + 6 * ONE_M);                         // the read-back: filled, and no fee field
  assertEquals(r.errors, [], JSON.stringify(r.errors));
  const b = w.orders().find((o) => o.id === buy.id)!;
  assertEquals([b.state, b.filled_base, b.avg_fill_price, b.fee_usd], ["filled", atVenue.filled, atVenue.avg, atVenue.fee]);   // 9 bps of the notional: what the venue charged
  assert(Number(b.fee_usd) > 0, String(b.fee_usd));
  const reply = b.response as Row;
  assertEquals([reply.status, reply.total_fee, reply.fee_currency], ["filled", undefined, undefined]);   // the reply as the venue sent it …
  assertEquals(reply.feeDerived, { bps: 9, notional: Math.round(atVenue.filled * atVenue.avg! * 1e8) / 1e8, basis: "time_in_force ioc: a taker fill" });   // … and how the fee was derived, beside it
  assertEquals(Math.round(bookOf(w.orders()).base * 1e8), Math.round((w.rx.balances.BTC ?? 0) * 1e8));   // the book holds what the venue holds
  // The pair is not held in flight by a read-back refused for good: the next bar is decided like any other.
  const r2 = await w.at(LIVE_BAR + FOUR_H + ONE_M);
  assert(!r2.skipped.some((x) => x.includes("order in flight")), JSON.stringify(r2.skipped));
  assertEquals(r2.decisions.map((d) => [d.symbol, d.kind]), [["BTC/USD", "bar"]]);
});

Deno.test("D8 — the venue's own documented replies: 9 bps of filled_amount on an IOC, 0 % on a post-only fill; a reported fee is never replaced, and a coin fee with no amount is still refused (D4)", () => {
  // GET /orders/historical's documented filled order (revolut-x-api-for-llm.md): an IOC, with no total_fee and no fee_currency.
  const ioc: VenueOrder = {
    id: "3f1c9d84-2b77-4a10-9c53-1e2f7a6b0d45", client_order_id: "b8e0c1a2-64d3-4f8e-9a71-5c2d3e4f6a70", symbol: "BTC/USD", side: "buy", type: "market",
    quantity: "0.002", filled_quantity: "0.002", leaves_quantity: "0", amount: "200", filled_amount: "197.49", price: "98745", average_fill_price: "98745",
    status: "filled", time_in_force: "ioc", execution_instructions: ["allow_taker"], created_date: 3318215482991, updated_date: 3318215482991,
  };
  assertEquals(orderViewProblem(ioc), null);
  const v = toOrderView(ioc);
  assertEquals([v.state, v.filledBase, v.avgPrice, v.feeUsd], ["filled", 0.002, 98745, Math.round(197.49 * 0.0009 * 1e8) / 1e8]);
  assertEquals(v.feeDerived, { bps: 9, notional: 197.49, basis: "time_in_force ioc: a taker fill" });
  // GET /orders/{id}'s documented filled post-only order (the `on_fill` example, its linked exit left out), with the schema's
  // optional average_fill_price: a maker fill, which Revolut X charges 0 %.
  const maker: VenueOrder = {
    id: "7a52e92e-8639-4fe1-abaa-68d3a2d5234b", client_order_id: "7a52e92e-8639-4fe1-abaa-68d3a2d5234b", symbol: "BTC/USD", side: "buy", type: "limit",
    quantity: "0.1", filled_quantity: "0.1", leaves_quantity: "0", price: "60000", average_fill_price: "60000", status: "filled", time_in_force: "gtc",
    execution_instructions: ["post_only"], created_date: 3318215482991, updated_date: 3318215482991,
  };
  assertEquals(orderViewProblem(maker), null);
  assertEquals([toOrderView(maker).feeUsd, toOrderView(maker).feeDerived], [0, { bps: 0, notional: 6000, basis: "post_only: a maker fill" }]);
  // A fee the venue reports is the fee: nothing is derived beside it.
  const reported = toOrderView({ ...ioc, total_fee: "0.18", fee_currency: "USD" });
  assertEquals([reported.feeUsd, reported.feeDerived], [0.18, undefined]);
  // D4 stays: a fee taken in the coin, WITH its amount, is booked net of the coins …
  assertEquals(toOrderView({ ...ioc, total_fee: "0.0000018", fee_currency: "BTC" }).filledBase, 0.0019982);
  // … and a reply that names the coin with no amount is still refused: a dollar fee derived there would book the gross coins
  // as held, and the rule would read itself long for good.
  const coinNoAmount = orderViewProblem({ ...ioc, fee_currency: "BTC" });
  assert(coinNoAmount?.includes("no total_fee/fees") && coinNoAmount.includes("names BTC as the fee's currency"), String(coinNoAmount));
  // A missing price is still a refusal, and says only what it is: a dollar fee left out is not the reason.
  const noPrice = orderViewProblem({ ...ioc, average_fill_price: undefined, fee_currency: "USD" });
  assert(noPrice?.includes("no average_fill_price (") && !noPrice.includes("fee's currency"), String(noPrice));
  // No fee, and nothing to derive one from: refused, never booked at 0.
  const nothingToDeriveFrom = orderViewProblem({ ...ioc, filled_amount: undefined, average_fill_price: "0" });
  assert(nothingToDeriveFrom?.includes("neither filled_amount nor average_fill_price gives a notional"), String(nothingToDeriveFrom));
});

Deno.test("D12 — a buy fee the venue takes in the coin WITHOUT reporting it is booked from the account, not gross: the book is flat after the exit, and the rule enters again", async () => {
  // The $50 validation's reproduction (reviews/2026-09-24-golive50-patches/p12_*), its assertions unchanged; red until the fix.
  // D8 settles a fill whose read-back carries no total_fee / fee_currency with a DOLLAR fee from the schedule, and its double
  // takes that fee from the dollars. If the venue instead takes a buy's fee in the coin (its reference calls a buy's
  // filled_quantity "gross, before fees") and reports nothing, the book holds the gross while the account holds gross − fee,
  // the floor's sell is capped at the account, and the whole fee stays in the book: D4's phantom position by another road.
  // No reply field tells the two venues apart; the account's balance does.
  const BAR0 = Date.parse("2026-09-23T04:00:00Z");
  let now = BAR0 + 5 * ONE_M;
  const mem = memDb({ agent_risk: [RISK], agent_strategies: [{ ...LIVE, capital_usd: 12.5 } as unknown as Row], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }] }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  rx.dialect = "no-fee";                                             // no total_fee, no fee_currency on the read-back
  const inner = rx.fetch;
  rx.fetch = async (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    const before = new Set(rx.orders.keys());
    const res = await inner(input, init);
    if (p === "/api/1.0/orders" && m === "POST") {
      for (const [id, o] of rx.orders) if (!before.has(id) && o.side === "buy" && o.status === "filled" && o.avg) {
        const feeBase = Math.round(o.fee / o.avg * 1e8) / 1e8;        // on the base step, so this is not D11's sub-step case
        rx.balances.BTC = Math.round(((rx.balances.BTC ?? 0) - feeBase) * 1e8) / 1e8; rx.balances.USD += o.fee;
      }
    }
    return res;
  };
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, rx.fetch), kraken: krakenVenue(null, kr.fetch) };
  const at = (t: number) => { now = t; return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({}), uuid: () => crypto.randomUUID() }); };
  await at(BAR0 + 5 * ONE_M);                                        // entry, a $12.50 slot
  await at(BAR0 + 6 * ONE_M);                                        // settled, with a derived dollar fee
  rx.shock["BTC/USD"] = 0.9;                                         // the floor fires on the bid
  await at(BAR0 + 10 * ONE_M);
  await at(BAR0 + 11 * ONE_M);
  rx.shock["BTC/USD"] = 1;
  assertEquals(rx.balances.BTC, 0);                                  // the venue is flat …
  assertEquals(bookOf(mem.tables.agent_orders as Row[]).base, 0);    // … and so must the book be (before the fix it kept the fee)
  const orders = mem.tables.agent_orders.length;
  for (const k of [3, 4, 5]) await at(BAR0 + k * FOUR_H + ONE_M);
  assert(mem.tables.agent_orders.length > orders, "the rule entered again");
});

/**
 * Revolut X as its reference allows it and nobody has yet seen it: a filled buy's fee taken in the COIN — the account gets
 * gross − fee while `filled_quantity` stays gross, "before fees" — at full precision (`decimals` null) or rounded to
 * `decimals`. The fake takes its fee from the dollars; this moves it into the coin. With `dialect = "no-fee"` the read-back
 * says nothing about it: D12's venue. `report` makes the read-back name it instead, as D11's venue does.
 */
function takeBuyFeesInTheCoin(rx: FakeRevx, decimals: number | null, report = false) {
  const inner = rx.fetch;
  const feeOf = new Map<string, number>();
  rx.fetch = async (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    const before = new Set(rx.orders.keys());
    const res = await inner(input, init);
    if (p === "/api/1.0/orders" && m === "POST") {
      for (const [id, o] of rx.orders) if (!before.has(id) && o.side === "buy" && o.status === "filled") {
        const asset = o.symbol.split("/")[0], exact = o.filled * 0.0009, scale = 10 ** (decimals ?? 0);
        const fee = decimals == null ? exact : Math.round(exact * scale) / scale;
        const left = (rx.balances[asset] ?? 0) - fee;
        rx.balances[asset] = decimals == null ? left : Math.round(left * scale) / scale; rx.balances.USD += o.fee;
        feeOf.set(id, fee);
      }
    }
    if (report && m === "GET" && p.startsWith("/api/1.0/orders/") && p !== "/api/1.0/orders/active" && p !== "/api/1.0/orders/historical") {
      const id = p.split("/").at(-1)!, fee = feeOf.get(id);
      if (fee != null && res.ok) {
        const j = await res.json();
        j.data.total_fee = fee.toFixed(12); j.data.fee_currency = rx.orders.get(id)!.symbol.split("/")[0];
        return new Response(JSON.stringify(j), { status: 200 });
      }
    }
    return res;
  };
}

Deno.test("D12 — the same fee at full precision, not reported: booked from the account in whole steps, and the exit leaves only dust at the venue", async () => {
  const w = await realWorld([{ ...LIVE, capital_usd: 12.5 }]);
  w.rx.dialect = "no-fee";
  takeBuyFeesInTheCoin(w.rx, null);
  await w.at(LIVE_BAR + 5 * ONE_M);                                  // the entry, a $12.50 slot
  const r = await w.at(LIVE_BAR + 6 * ONE_M);                        // settled from the account
  assertEquals(r.errors, [], JSON.stringify(r.errors));
  const buy = w.orders().find((o) => o.side === "buy")!;
  const held = w.rx.balances.BTC!, gross = w.rx.orders.get(String(buy.venue_order_id))!.filled;
  assert(Math.abs(held * 1e8 - Math.round(held * 1e8)) > 1e-3, "the fee must leave the account between two steps for this to mean anything");
  assertEquals([buy.state, Number(buy.filled_base)], ["filled", Math.floor(held * 1e8) / 1e8]);   // what the account holds, in whole steps
  assertEquals((buy.response as Row).fromAccount, { asset: "BTC", held, rest: 0, gross });          // and what that was read from
  assert((buy.response as Row).feeDerived, "the dollar fee is still the derived one");
  w.rx.shock["BTC/USD"] = 0.9;                                       // the floor fires on the bid
  await w.at(LIVE_BAR + 10 * ONE_M);
  await w.at(LIVE_BAR + 11 * ONE_M);
  w.rx.shock["BTC/USD"] = 1;
  const dust = w.rx.balances.BTC ?? 0;
  assert(dust >= 0 && dust < 1e-8, `the venue keeps under one step, as dust: ${dust}`);
  assertEquals(bookOf(w.orders()).base, 0);                          // the book is flat …
  const n = w.orders().length;
  for (const k of [3, 4, 5]) await w.at(LIVE_BAR + k * FOUR_H + ONE_M);
  assert(w.orders().length > n, "… and the rule entered again");
});

Deno.test("D12 — an account short by more than the fee explains (here a trade by hand) settles nothing: the buy says why, stays open, and the floor still sells what the account holds", async () => {
  const w = await realWorld([{ ...LIVE, capital_usd: 12.5 }]);
  w.rx.dialect = "no-fee";
  takeBuyFeesInTheCoin(w.rx, 8);
  await w.at(LIVE_BAR + 5 * ONE_M);                                  // the entry
  const buy = () => w.orders().find((o) => o.side === "buy")!;
  const gross = w.rx.orders.get(String(buy().venue_order_id))!.filled;
  w.rx.balances.BTC = w.rx.balances.BTC! - gross * 0.01;              // 1 % of the coins leave the account: no fee explains that
  const r = await w.at(LIVE_BAR + 6 * ONE_M);
  assert(r.errors.some((e) => e.includes("short of the gross by more than its 9 bps fee explains")), JSON.stringify(r.errors));
  assertEquals([buy().state, buy().filled_base], ["new", 0]);         // nothing booked on a guess
  w.rx.shock["BTC/USD"] = 0.9;                                       // the floor still covers the coins, at the account's balance
  const heldBefore = w.rx.balances.BTC!;
  await w.at(LIVE_BAR + 7 * ONE_M);
  w.rx.shock["BTC/USD"] = 1;
  const sell = w.orders().find((o) => o.side === "sell")!;
  const left = heldBefore - Number(sell.base_size);
  assert(left >= 0 && left < 1e-8, `it sells what the account holds, in whole steps: ${sell.base_size} of ${heldBefore}`);
  assertEquals(buy().state, "new");                                  // and the buy is still the person's to settle
});

Deno.test("D12 — the floor sold past the buy before it could be read back: the rest of the book is buys LESS sells, so the buy books what the sell took, and the book ends flat", async () => {
  // A buy whose read-back fails is counted by the floor at the account's balance, and the floor may sell it before the read-back
  // works (the `unreadable` path). Its coins are then gone from the account: read as a position, the book's sell would clamp to
  // flat and the buy would never find its coins; read as buys less sells, the sell accounts for them.
  const w = await realWorld([{ ...LIVE, capital_usd: 12.5 }]);
  w.rx.dialect = "no-fee";
  takeBuyFeesInTheCoin(w.rx, 8);
  let readBackDown = false;
  const inner = w.rx.fetch;
  w.rx.fetch = (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    if (readBackDown && m === "GET" && p.startsWith("/api/1.0/orders/") && p !== "/api/1.0/orders/active" && p !== "/api/1.0/orders/historical") {
      return Promise.resolve(new Response(JSON.stringify({ message: "Service unavailable" }), { status: 503 }));
    }
    return inner(input, init);
  };
  await w.at(LIVE_BAR + 5 * ONE_M);                                  // the entry
  const buy = () => w.orders().find((o) => o.side === "buy")!;
  const gross = w.rx.orders.get(String(buy().venue_order_id))!.filled, fee = Math.round(gross * 0.0009 * 1e8) / 1e8;
  readBackDown = true;
  w.rx.shock["BTC/USD"] = 0.9;
  await w.at(LIVE_BAR + 6 * ONE_M);                                  // the buy cannot be read; the floor sells what the account holds
  const sell = () => w.orders().find((o) => o.side === "sell")!;
  assertEquals([buy().state, Number(sell().base_size), w.rx.balances.BTC], ["new", Math.round((gross - fee) * 1e8) / 1e8, 0]);
  readBackDown = false;
  w.rx.shock["BTC/USD"] = 1;
  await w.at(LIVE_BAR + 7 * ONE_M);                                  // the buy is read before its sell settles: not yet bookable
  assertEquals([buy().state, sell().state], ["new", "filled"]);
  const r = await w.at(LIVE_BAR + 8 * ONE_M);                        // with the sell settled, the account accounts for it
  assertEquals(r.errors, [], JSON.stringify(r.errors));
  assertEquals([buy().state, Number(buy().filled_base)], ["filled", Number(sell().filled_base)]);
  assertEquals((buy().response as Row).fromAccount, { asset: "BTC", held: 0, rest: -Number(sell().filled_base), gross });
  assertEquals(bookOf(w.orders()).base, 0);
  const n = w.orders().length;
  for (const k of [3, 4, 5]) await w.at(LIVE_BAR + k * FOUR_H + ONE_M);
  assert(w.orders().length > n, "the rule entered again");
});

Deno.test("D11 — with no pair config at the settling minute a live buy waits a turn, rather than settle a base its exit may never sell", async () => {
  const w = await realWorld([{ ...LIVE, capital_usd: 12.5 }]);
  takeBuyFeesInTheCoin(w.rx, null, true);                           // D11's venue: the coin fee reported at full precision
  await w.at(LIVE_BAR + 5 * ONE_M);                                  // the entry
  const buy = () => w.orders().find((o) => o.side === "buy")!;
  w.rx.down.pairs = true;                                            // no base step this minute
  const r = await w.at(LIVE_BAR + 6 * ONE_M);
  w.rx.down.pairs = false;
  assert(r.errors.some((e) => e.includes("pair config is unreadable this turn") && e.includes("settles next turn")), JSON.stringify(r.errors));
  assertEquals([buy().state, buy().filled_base], ["new", 0]);
  await w.at(LIVE_BAR + 7 * ONE_M);
  const net = Number(buy().base_size) * (1 - 0.0009);
  assertEquals([buy().state, Number(buy().filled_base)], ["filled", Math.floor(net * 1e8) / 1e8]);   // floored, a turn late
});

Deno.test("D9 — every marketable order records the touch it was priced from and that quote's age, paper and live; a live fill keeps the venue's price beside it, so the shortfall is read off the record", async () => {
  const SYM = "BTC/USD";
  let wall = Date.parse("2026-09-23T04:05:03Z"), asked = 0;
  let rx: FakeRevx | null = null;
  const jev = jevFetch({});
  // Each model call takes 5 s of wall clock. By the second — the live row's — the UK book has moved up 2 bps.
  const slowJev: typeof fetch = (input, init) => { wall += 5000; if (++asked === 2) rx!.shock[SYM] = 1.0002; return jev(input, init); };
  // `trend-4h` (paper) sorts before `trend-4h-live`: the paper control decides the bar first, in the same turn.
  const w = await realWorld([{ ...LIVE, id: "trend-4h", mode: "paper", capital_usd: 20 }, { ...LIVE, capital_usd: 20 }], { fetchImpl: slowJev, clock: () => wall });
  rx = w.rx;
  const quoteAt = (shock: number) => { w.rx.shock[SYM] = shock; const q = w.rx.quote(SYM); w.rx.shock[SYM] = 1; return q; };
  const turnQuote = quoteAt(1), reread = quoteAt(1.0002), atArrival = quoteAt(1.0007);
  // … and when the live IOC arrives the book is 5 bps above what the order re-read: inside its 10 bps allowance, so it fills, 5 bps worse.
  w.rx.onPost = () => { w.rx.shock[SYM] = 1.0007; };
  const r1 = await w.at(LIVE_BAR + 5 * ONE_M);
  w.rx.onPost = undefined;
  w.rx.shock[SYM] = 1;
  assertEquals(r1.errors, [], JSON.stringify(r1.errors));
  const paper = () => w.orders().find((o) => o.strategy_id === "trend-4h")!;
  const live = () => w.orders().find((o) => o.strategy_id === "trend-4h-live")!;
  // The paper control's order is priced from the turn's quote, read 5 s (one model call) before the order was written …
  assertEquals((paper().request as Row).touch, { bid: turnQuote.bid, ask: turnQuote.ask, ageMs: 5000, reread: false });
  // … the live order from the touch it re-read on its way out.
  assertEquals((live().request as Row).touch, { bid: reread.bid, ask: reread.ask, ageMs: 0, reread: true });
  await w.at(LIVE_BAR + 6 * ONE_M);                                  // both settle
  const [p, l] = [paper(), live()];
  assertEquals([p.state, l.state], ["filled", "filled"]);
  // The venue's own fill price, kept beside the touch the order recorded: the fill-versus-touch shortfall comes from inputs alone.
  assertEquals([l.avg_fill_price, (l.response as Row).average_fill_price], [atArrival.ask, String(atArrival.ask)]);
  assertEquals((l.request as Row).touch, { bid: reread.bid, ask: reread.ask, ageMs: 0, reread: true });   // settling never overwrites it
  const shortfallBps = (o: Row) => { const t = (o.request as { touch: Quote }).touch; return (Number(o.avg_fill_price) - t.ask) / t.ask * 1e4; };
  assert(Math.abs(shortfallBps(l) - (atArrival.ask - reread.ask) / reread.ask * 1e4) < 1e-9 && shortfallBps(l) > 4, String(shortfallBps(l)));
  // The paper control fills at its own price, the touch it recorded: 0 by construction — the optimistic side of the comparison.
  assertEquals([p.avg_fill_price, shortfallBps(p)], [p.price, 0]);
});

Deno.test("D10 — a lease claim the database never answers ends the turn with a note, not a crash: nothing else is read and no venue is called", async () => {
  // The REAL database client over a transport that never answers: the client's own AbortSignal.timeout fires and rejects as it
  // did in production ("Signal timed out."), after 50 ms here rather than 8 s.
  const dbCalls: string[] = [];
  const silent: typeof fetch = (input, init) => {
    dbCalls.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
    return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  };
  const db = makeDb("https://db.invalid", "service-role", silent, 50);
  const venueCalls: string[] = [];
  const untouched = (id: VenueId): Venue => {
    const no = (what: string) => () => { venueCalls.push(`${id} ${what}`); return Promise.reject(new Error(`${id} ${what}: a turn without its lease calls no venue`)); };
    return { id, canTrade: true, feeBps: { maker: 0, taker: 9 }, candles: no("candles"), quotes: no("quotes"), pairs: no("pairs"), placeLimit: no("placeLimit"),
      cancel: no("cancel"), order: no("order"), balances: no("balances"), activeOrders: no("activeOrders") };
  };
  const r = await tick({ db, venues: { revx: untouched("revx"), kraken: untouched("kraken") }, jev: { openrouterKey: "k" }, now: NOW, fetchImpl: jevFetch({}), uuid: () => crypto.randomUUID() });
  assertEquals(dbCalls, ["PATCH /rest/v1/agent_locks"]);
  assertEquals(venueCalls, []);
  assertEquals([r.decisions, r.orders, r.settled, r.skipped], [[], [], [], []]);
  assertEquals(r.errors.length, 1, JSON.stringify(r.errors));
  assert(r.errors[0].startsWith("LEASE CLAIM FAILED") && r.errors[0].includes("Signal timed out."), r.errors[0]);
  // The note every caught failure leaves: `runTick` writes a turn's errors as one `agents.tick` row, and this is its message.
  assert(tickErrorReport(r).message.includes("LEASE CLAIM FAILED"), tickErrorReport(r).message);
});
