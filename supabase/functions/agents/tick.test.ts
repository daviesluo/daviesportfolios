// The loop, end to end, against an in-memory database and stub venues:
// a fresh closed bar becomes a decision and a resting paper order; a paper
// fill pays the venue's maker fee; a stale order is cancelled and
// re-quoted; a bar is decided once, and a second tick that reaches the
// same bar loses the claim; a live order is written down before the venue
// is called and reconciled by client id if the reply never landed; a live
// fill settles from the venue's own view; no model answer means no entry;
// the Revolut X rows read Kraken's candles; the rotation rule ranks the
// cross-section; the basis is recorded every turn; and today's P&L is
// measured from the day's open.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Candle } from "../_shared/agents_strategy.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import type { Db } from "./db.ts";
import { dayPnl, STALE_TICKS, tick, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

const FOUR_H = 4 * 3600e3, ONE_H = 3600e3, ONE_D = 86400e3, FIVE_M = 5 * 60e3;
const NOW = Date.parse("2026-09-20T04:05:00Z");
const PAIR = { base_step: "0.000001", quote_step: "0.01", min_order_size: "0.001", min_order_size_quote: "0.5" };

// A steady rise: every closed bar breaks the prior high, SMA20 sits well
// above SMA100, daily momentum is positive, volatility is tiny. `dailyRate`
// lets one symbol out-run another for the rotation rule.
function series(dailyRate = 1.01, barMs = FOUR_H): { bars: Candle[]; c1d: Candle[]; lastClose: number } {
  const lastBarStart = Math.floor(NOW / barMs) * barMs;      // the still-open bar
  const bars: Candle[] = [];
  for (let i = 0; i < 130; i++) {
    const close = 100 * Math.pow(1.002, i);
    bars.push({ start: lastBarStart - (129 - i) * barMs, open: close / 1.002, high: close * 1.0005, low: close / 1.002 * 0.9995, close, volume: 1 });
  }
  const lastDayStart = Math.floor(NOW / ONE_D) * ONE_D;
  const c1d: Candle[] = [];
  for (let i = 0; i < 130; i++) {
    const close = 100 * Math.pow(dailyRate, i);
    c1d.push({ start: lastDayStart - (129 - i) * ONE_D, open: close / dailyRate, high: close * 1.002, low: close / dailyRate * 0.998, close, volume: 1 });
  }
  return { bars, c1d, lastClose: bars[128].close };
}

type Row = Record<string, unknown>;

/** Enough of PostgREST's query syntax for what tick.ts asks, plus the one uniqueness the schema has. */
function memDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1000;
  const parse = (query: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; dir: "asc" | "desc" } | null = null, limit = Infinity, select: string[] | null = null;
    for (const part of query.split("&")) {
      const i = part.indexOf("=");
      const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === "select") { select = v === "*" ? null : v.split(","); continue; }
      if (k === "order") { const [col, dir] = v.split("."); order = { col, dir: dir === "desc" ? "desc" : "asc" }; continue; }
      if (k === "limit") { limit = Number(v); continue; }
      const m = v.match(/^(eq|in|gte)\.(.*)$/);
      if (!m) throw new Error(`stub db: unsupported filter ${part}`);
      const val = decodeURIComponent(m[2]);
      if (m[1] === "eq") filters.push((r) => String(r[k]) === val);
      if (m[1] === "in") { const set = val.slice(1, -1).split(","); filters.push((r) => set.includes(String(r[k]))); }
      if (m[1] === "gte") filters.push((r) => String(r[k]) >= val);
    }
    return { filters, order, limit, select };
  };
  const db: Db = {
    select: (table, query) => {
      const { filters, order, limit, select } = parse(query);
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, dir } = order;
        rows = rows.slice().sort((a, b) => ((a[col] as number) < (b[col] as number) ? -1 : (a[col] as number) > (b[col] as number) ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      rows = rows.slice(0, limit);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve((select ? rows.map((r) => Object.fromEntries(select!.map((c) => [c, r[c]]))) : rows.map((r) => ({ ...r }))) as any);
    },
    insert: (table, rows, returning = true) => {
      const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
      if (table === "agent_decisions") {
        for (const r of list) {
          const dup = (tables[table] ?? []).some((x) => x.strategy_id === r.strategy_id && x.symbol === r.symbol && x.bar_start === r.bar_start);
          if (dup) return Promise.reject(new Error("db POST agent_decisions → 409: duplicate key value violates unique constraint \"agent_decisions_one_per_bar\""));
        }
      }
      const out = list.map((r) => ({ id: nextId++, ts: new Date(NOW).toISOString(), ...r }));
      (tables[table] ??= []).push(...out);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve((returning ? out : []) as any);
    },
    upsert: (table, rows) => { (tables[table] ??= []).push(...(rows as Row[])); return Promise.resolve(); },
    update: (table, query, patch) => {
      const { filters } = parse(query);
      for (const r of tables[table] ?? []) if (filters.every((f) => f(r))) Object.assign(r, patch as Row);
      return Promise.resolve();
    },
  };
  return { db, tables };
}

type SeriesBySymbol = Record<string, { bars: Candle[]; c1d: Candle[]; bars1h?: Candle[] }>;

function stubVenue(id: VenueId, o: {
  series: SeriesBySymbol; c5m: Candle[]; quote: Quote; feeBps: { maker: number; taker: number }; canTrade: boolean;
  orderView?: OrderView; cancelOk?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>;
  onPlace?: () => void;
}) {
  const calls: string[] = [];
  const v: Venue = {
    id, canTrade: o.canTrade, feeBps: o.feeBps,
    candles: (sym, iv) => {
      calls.push(`candles ${sym} ${iv}`);
      const s = o.series[sym] ?? o.series["BTC/USD"];
      return Promise.resolve(iv === 240 ? s.bars : iv === 60 ? (s.bars1h ?? s.bars) : iv === 1440 ? s.c1d : o.c5m);
    },
    quotes: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, o.quote]))),
    pairs: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, PAIR]))),
    placeLimit: (req) => { o.onPlace?.(); calls.push(`place ${req.side} ${req.base}@${req.price}`); return Promise.resolve({ ok: true as const, venueOrderId: "V-1", state: "new" as const, response: { echo: req } }); },
    cancel: (vid) => { calls.push(`cancel ${vid}`); return Promise.resolve({ ok: o.cancelOk ?? true }); },
    order: (vid) => { calls.push(`order ${vid}`); return Promise.resolve(o.orderView ? { ok: true as const, view: o.orderView } : { ok: false as const, error: "no view" }); },
    balances: () => Promise.resolve({}),
    activeOrders: () => { calls.push("activeOrders"); return Promise.resolve({ ok: true as const, byClientId: o.active ?? {} }); },
  };
  return { v, calls };
}

/** Jev answering "healthy, calm, and yes that symbol" — or failing, when `fail` is set. */
function jevFetch(fail = false): typeof fetch {
  return (_url, init) => {
    if (fail) return Promise.resolve(new Response("down", { status: 503 }));
    const sym = JSON.parse(String(init?.body)).state.symbol;
    return Promise.resolve(new Response(JSON.stringify({
      model: "typesafe/jev-1.13-test",
      answers: {
        healthy_trend: { type: "noul", noul: 0.9 },
        caution: { type: "score", score: 0.1, probabilities: { "0": 0.9, "1": 0.1, "2": 0 }, confidence: 0.85, legend: { "0": "calm" } },
        _state: { type: "choice", choice: sym, probabilities: { [sym]: 1 }, confidence: 1 },
      },
      usage: { input_tokens: 400, output_tokens: 20, cost: 0.0000168 },
    })));
  };
}

const RISK: RiskRow & { id: number } = { id: 1, global_pause: false, max_order_usd: 20, max_exposure_usd: 100, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: null };
const strategy = (over: Partial<StrategyRow> = {}): StrategyRow => ({
  id: "trend-4h-kraken", kind: "trend-4h", venue: "kraken", signal_venue: "kraken", name: "Trend 4h · Kraken", symbols: ["BTC/USD"], mode: "paper", capital_usd: 60,
  params: { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42, enterMin: 0.6, exitMax: 0.3 }, ...over,
});

function world(opts: {
  strategies?: StrategyRow[]; orders?: Row[]; decisions?: Row[]; risk?: Partial<RiskRow>; fiveMin?: Partial<Candle>; canTrade?: boolean;
  orderView?: OrderView; jevDown?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>; onPlace?: () => void;
  series?: SeriesBySymbol;
} = {}) {
  const base = series();
  const ser: SeriesBySymbol = opts.series ?? { "BTC/USD": base };
  const quote = { bid: Math.round(base.lastClose * 100) / 100, ask: Math.round(base.lastClose * 100) / 100 + 0.1 };
  const m5start = Math.floor(NOW / FIVE_M) * FIVE_M - FIVE_M;
  const c5m: Candle[] = [{ start: m5start, open: quote.bid, high: quote.bid + 0.05, low: quote.bid - 0.05, close: quote.bid, volume: 1, ...opts.fiveMin }];
  const kraken = stubVenue("kraken", { series: ser, c5m, quote, feeBps: { maker: 40, taker: 80 }, canTrade: opts.canTrade ?? false, orderView: opts.orderView, active: opts.active, onPlace: opts.onPlace });
  const revx = stubVenue("revx", { series: ser, c5m, quote: { bid: quote.bid + 0.02, ask: quote.ask + 0.02 }, feeBps: { maker: 0, taker: 9 }, canTrade: false });
  const mem = memDb({
    agent_risk: [{ ...RISK, ...opts.risk }],
    agent_strategies: (opts.strategies ?? [strategy()]) as unknown as Row[],
    agent_orders: opts.orders ?? [],
    agent_decisions: opts.decisions ?? [],
  });
  const deps = { db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now: NOW, fetchImpl: jevFetch(opts.jevDown), uuid: () => "00000000-0000-4000-8000-000000000001" };
  return { deps, mem, kraken, revx, quote, lastClosedBarStart: base.bars[128].start, c5m };
}

const seedOrder = (over: Partial<OrderRow> & Row = {}): Row => ({
  id: 1, ts: new Date(NOW - FIVE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", side: "buy",
  price: 129.0, base_size: 0.155, client_order_id: "c1", venue_order_id: null, state: "new", filled_base: 0, avg_fill_price: null, fee_usd: 0, filled_at: null, ...over,
});

Deno.test("a fresh closed bar becomes one decision and one resting paper order at the bid, on the strategy's venue", async () => {
  const w = world();
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.length, 1);
  assertEquals(r.decisions[0], { strategy: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", action: "enter", reason: r.decisions[0].reason, provider: "openrouter", allowed: true });
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.venue, "kraken");
  assertEquals(dec.final_action, "enter");
  assertEquals(dec.bar_start, new Date(w.lastClosedBarStart).toISOString());
  assertEquals(w.mem.tables.agent_orders.length, 1);
  const o = w.mem.tables.agent_orders[0] as Row & { request: { postOnly: boolean } };
  assertEquals([o.venue, o.mode, o.side, o.state, o.symbol], ["kraken", "paper", "buy", "new", "BTC/USD"]);
  assertEquals(o.price, w.quote.bid);
  assertAlmostEquals(Number(o.base_size) * w.quote.bid, 20, 0.01);     // capital 60 over three slots, capped at max_order_usd
  assertEquals(o.request.postOnly, true);
  assert(!w.kraken.calls.some((c) => c.startsWith("place")));           // paper: the venue is never asked to place
  assert(w.mem.tables.agent_candles.length > 200);
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
});

Deno.test("the basis between the venues is recorded for every symbol, every turn", async () => {
  const w = world();
  const r = await tick(w.deps);
  const rows = w.mem.tables.agent_basis;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].symbol, "BTC/USD");
  assertEquals(rows[0].revx_bid, w.quote.bid + 0.02);
  assertEquals(rows[0].kraken_ask, w.quote.ask);
  const kMid = (w.quote.bid + w.quote.ask) / 2, rMid = kMid + 0.02;
  assertAlmostEquals(Number(rows[0].basis_bps), (rMid - kMid) / kMid * 1e4, 0.01);
  assertAlmostEquals(r.basis["BTC/USD"], Number(rows[0].basis_bps), 1e-9);
});

Deno.test("a Revolut X strategy reads Kraken's candles and quotes Revolut X's touch", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assert(w.kraken.calls.includes("candles BTC/USD 240") && w.kraken.calls.includes("candles BTC/USD 1440"), w.kraken.calls.join(","));
  assert(!w.kraken.calls.includes("candles BTC/USD 5"));
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.venue, o.price], ["revx", w.quote.bid + 0.02]);          // the order rests at Revolut X's own bid
  assertEquals((w.mem.tables.agent_decisions[0].numbers as { signalVenue: string }).signalVenue, "kraken");
});

Deno.test("trend-1h decides on the last closed hour, from 1-hour candles", async () => {
  const hourly = series(1.01, ONE_H);
  const w = world({ strategies: [strategy({ id: "trend-1h", kind: "trend-1h", venue: "revx", signal_venue: "kraken" })], series: { "BTC/USD": { bars: hourly.bars, c1d: hourly.c1d, bars1h: hourly.bars } } });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assert(w.kraken.calls.includes("candles BTC/USD 60"), w.kraken.calls.join(","));
  assertEquals(w.mem.tables.agent_decisions[0].bar_start, new Date(Math.floor(NOW / ONE_H) * ONE_H - ONE_H).toISOString());
});

Deno.test("a paper order fills when the venue's last 5-minute candle trades through it, and pays that venue's maker fee", async () => {
  const w = world({ orders: [seedOrder()], fiveMin: { low: 128.9 } });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 1, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals(o.state, "filled");
  assertEquals(o.avg_fill_price, 129.0);
  assertAlmostEquals(Number(o.fee_usd), 0.155 * 129.0 * 0.004, 1e-6);      // Kraken maker 40 bps
  assertEquals(r.decisions[0].action, "hold");                              // now long: the rule holds, no second order
  assertEquals(w.mem.tables.agent_orders.length, 1);

  const w2 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [seedOrder({ strategy_id: "trend-4h", venue: "revx" })], fiveMin: { low: 128.9 } });
  await tick(w2.deps);
  assertEquals(Number(w2.mem.tables.agent_orders[0].fee_usd), 0);           // Revolut X maker 0
});

Deno.test("an unfilled paper order is cancelled after STALE_TICKS turns and the pair is re-quoted", async () => {
  const w = world({ orders: [seedOrder({ id: 7, ts: new Date(NOW - STALE_TICKS * FIVE_M).toISOString(), price: 120, base_size: 0.1, client_order_id: "c7" })] });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 7, state: "cancelled" }]);
  assertEquals(w.mem.tables.agent_orders.map((o) => o.state), ["cancelled", "new"]);
});

Deno.test("a bar is decided once: the previous decision naming the same bar skips it", async () => {
  const w0 = world();
  const prev: Row = { id: 1, ts: new Date(NOW - FIVE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", bar_start: new Date(w0.lastClosedBarStart).toISOString() };
  const w = world({ decisions: [prev] });
  const r = await tick(w.deps);
  assertEquals(r.decisions, []);
  assert(r.skipped.some((s) => s.includes("already decided")), r.skipped.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
});

Deno.test("two ticks on the same bar: the second's claim fails on the unique index and it places nothing", async () => {
  const w0 = world();
  const bar = new Date(w0.lastClosedBarStart).toISOString();
  // Another tick claimed this bar; a still-later row for the previous bar means the fast path does not see it.
  const claimed: Row = { id: 1, ts: new Date(NOW - 10 * 60e3).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", bar_start: bar };
  const older: Row = { id: 2, ts: new Date(NOW - 5 * 60e3).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", bar_start: new Date(w0.lastClosedBarStart - FOUR_H).toISOString() };
  const w = world({ decisions: [claimed, older] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions, []);
  assert(r.skipped.some((s) => s.includes("claimed by another tick")), r.skipped.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assertEquals(w.mem.tables.agent_decisions.length, 2);
});

Deno.test("a live order is refused while live_confirmed_at is null, whatever the strategy row says", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true });
  const r = await tick(w.deps);
  assertEquals(r.decisions[0].allowed, true);                               // the gate allowed it …
  assert(r.errors.some((e) => e.includes("live_confirmed_at")), r.errors.join("; "));   // … the confirmation gate did not
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assert(!w.kraken.calls.some((c) => c.startsWith("place")));
});

Deno.test("a live order is refused without venue credentials, even when confirmed", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: false, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" } });
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("no kraken credentials")), r.errors.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
});

Deno.test("a live order is written down as pending BEFORE the venue is called, then carries the venue's id", async () => {
  let pendingAtPlacement: unknown = null;
  const w = world({
    strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    onPlace: () => { pendingAtPlacement = w.mem.tables.agent_orders.map((o) => o.state); },
  });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(pendingAtPlacement, ["pending"]);                            // durable intent first
  const base = (Math.floor(20 / w.quote.bid * 1e6) / 1e6).toFixed(6);
  assert(w.kraken.calls.includes(`place buy ${base}@${w.quote.bid.toFixed(2)}`), w.kraken.calls.join(","));
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.mode, o.state, o.venue_order_id], ["live", "new", "V-1"]);
});

Deno.test("a pending live order whose reply never landed is reconciled by client id next turn", async () => {
  const view: OrderView = { state: "new", filledBase: 0, avgPrice: null, feeUsd: 0, raw: { status: "open" } };
  const pending = seedOrder({ id: 5, mode: "live", state: "pending", client_order_id: "c-pend" });
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [pending], active: { "c-pend": { venueOrderId: "V-77", view } } });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 5, state: "reconciled:new" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.venue_order_id], ["new", "V-77"]);
  assert(r.skipped.some((s) => s.includes("order in flight")));            // the pair is busy, nothing new is placed
  assertEquals(w.mem.tables.agent_orders.length, 1);

  // Not at the venue: marked rejected and reported, never silently forgotten.
  const w2 = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [pending], active: {} });
  const r2 = await tick(w2.deps);
  assertEquals(r2.settled, [{ id: 5, state: "rejected" }]);
  assert(r2.errors.some((e) => e.includes("not found at kraken")), r2.errors.join("; "));
});

Deno.test("a live order settles from the venue's own view: filled volume, average price and fee", async () => {
  const live = seedOrder({ id: 3, mode: "live", client_order_id: "c3", venue_order_id: "V-9" });
  const view: OrderView = { state: "filled", filledBase: 0.155, avgPrice: 128.95, feeUsd: 0.08, raw: { status: "closed" } };
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live], orderView: view });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 3, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.filled_base, o.avg_fill_price, o.fee_usd], ["filled", 0.155, 128.95, 0.08]);
  assert(w.kraken.calls.includes("order V-9"));
});

Deno.test("no model answer means no entry: the rule's enter becomes a hold and nothing is placed", async () => {
  const w = world({ jevDown: true });
  const r = await tick(w.deps);
  assertEquals(r.decisions[0].action, "hold");
  assertEquals(r.decisions[0].provider, "none");
  assertEquals(w.mem.tables.agent_orders.length, 0);
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.rule_action, "enter");
  assert(String(dec.final_reason).includes("openrouter 503"));
});

Deno.test("the rotation rule ranks the cross-section: the strongest symbol is entered, the other is not", async () => {
  const strong = series(1.01), weak = series(1.0005);                       // +34 % vs +1.5 % over 30 days, both above their averages
  const w = world({
    strategies: [strategy({ id: "rotation-1d", kind: "rotation-1d", venue: "revx", signal_venue: "kraken", symbols: ["BTC/USD", "ETH/USD"], params: { lookbackDays: 30, topN: 1, slowDays: 100, bearFilter: true, minHoldDays: 0, enterMin: 0.6, exitMax: 0.3 } })],
    series: { "BTC/USD": strong, "ETH/USD": weak },
  });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  const byPair = Object.fromEntries(r.decisions.map((x) => [x.symbol, x]));
  assertEquals(byPair["BTC/USD"].action, "enter");
  assertEquals(byPair["ETH/USD"].action, "hold");
  assert(byPair["ETH/USD"].reason.includes("not in the top 1"), byPair["ETH/USD"].reason);
  const orders = w.mem.tables.agent_orders;
  assertEquals(orders.map((o) => o.symbol), ["BTC/USD"]);
  assertAlmostEquals(Number(orders[0].base_size) * Number(orders[0].price), 20, 0.02);   // one slot: capital 60 / topN 1, capped at max_order_usd
  const dec = w.mem.tables.agent_decisions.find((d) => d.symbol === "BTC/USD")!;
  assertEquals((dec.numbers as { rank: { rank: number; inTop: boolean } }).rank.inTop, true);
  assertEquals(dec.bar_start, new Date(Math.floor(NOW / ONE_D) * ONE_D - ONE_D).toISOString());   // decided on yesterday's close
});

Deno.test("dayPnl counts only today: realised since the day began plus the CHANGE in unrealised from the day's open", () => {
  const dayStart = Date.parse("2026-09-20T00:00:00Z");
  const old: OrderRow = { ...(seedOrder({ ts: "2026-09-10T00:00:00Z", filled_at: "2026-09-10T00:05:00Z", state: "filled", filled_base: 1, avg_fill_price: 100, base_size: 1, price: 100 }) as unknown as OrderRow) };
  // Opened at 100 last week; today opened at 110 and is now 105: today is −5 even though the position is +5 overall.
  assertAlmostEquals(dayPnl([old], { "BTC/USD": 105 }, { "BTC/USD": 110 }, dayStart), -5, 1e-9);
  // A sale today realises against the average cost, and the day-open mark of what was sold no longer counts.
  const sale: OrderRow = { ...(seedOrder({ id: 2, ts: "2026-09-20T03:00:00Z", filled_at: "2026-09-20T03:00:00Z", state: "filled", side: "sell", filled_base: 1, avg_fill_price: 108, base_size: 1, price: 108, fee_usd: 0.5 }) as unknown as OrderRow) };
  // Realised today: (108 − 100) − 0.5 = 7.5. Unrealised now: 0 (flat). Unrealised at day open: 1 × (110 − 100) = 10. Today = 7.5 + (0 − 10) = −2.5.
  assertAlmostEquals(dayPnl([old, sale], { "BTC/USD": 105 }, { "BTC/USD": 110 }, dayStart), -2.5, 1e-9);
});
