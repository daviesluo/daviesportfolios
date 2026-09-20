// The loop, end to end, against an in-memory database and stub venues:
// a fresh closed bar becomes a decision and a resting paper order; a paper
// fill pays the venue's maker fee; a stale order is cancelled and
// re-quoted; a bar is decided once; a live order needs Davies' go AND
// venue credentials; a live fill settles from the venue's own view; and
// no model answer means no entry.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Candle } from "../_shared/agents_strategy.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import type { Db } from "./db.ts";
import { STALE_TICKS, tick, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

const FOUR_H = 4 * 3600e3, ONE_D = 86400e3, FIVE_M = 5 * 60e3;
const NOW = Date.parse("2026-09-20T04:05:00Z");
const PAIR = { base_step: "0.000001", quote_step: "0.01", min_order_size: "0.001", min_order_size_quote: "0.5" };

// A steady rise: every closed 4h bar breaks the prior high, SMA20 sits
// well above SMA100, daily momentum is positive, volatility is tiny.
function series(): { c4h: Candle[]; c1d: Candle[]; lastClose: number } {
  const last4hStart = Math.floor(NOW / FOUR_H) * FOUR_H;      // the still-open bar
  const c4h: Candle[] = [];
  for (let i = 0; i < 130; i++) {
    const close = 100 * Math.pow(1.002, i);
    c4h.push({ start: last4hStart - (129 - i) * FOUR_H, open: close / 1.002, high: close * 1.0005, low: close / 1.002 * 0.9995, close, volume: 1 });
  }
  const lastDayStart = Math.floor(NOW / ONE_D) * ONE_D;
  const c1d: Candle[] = [];
  for (let i = 0; i < 40; i++) {
    const close = 100 * Math.pow(1.01, i);
    c1d.push({ start: lastDayStart - (39 - i) * ONE_D, open: close / 1.01, high: close * 1.002, low: close / 1.01 * 0.998, close, volume: 1 });
  }
  return { c4h, c1d, lastClose: c4h[128].close };
}

type Row = Record<string, unknown>;

/** Enough of PostgREST's query syntax for what tick.ts asks. */
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

function stubVenue(id: VenueId, o: {
  c4h: Candle[]; c1d: Candle[]; c5m: Candle[]; quote: Quote; feeBps: { maker: number; taker: number }; canTrade: boolean;
  orderView?: OrderView; cancelOk?: boolean;
}) {
  const calls: string[] = [];
  const v: Venue = {
    id, canTrade: o.canTrade, feeBps: o.feeBps,
    candles: (_s, iv) => Promise.resolve(iv === 240 ? o.c4h : iv === 1440 ? o.c1d : o.c5m),
    quotes: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, o.quote]))),
    pairs: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, PAIR]))),
    placeLimit: (req) => { calls.push(`place ${req.side} ${req.base}@${req.price}`); return Promise.resolve({ ok: true as const, venueOrderId: "V-1", state: "new" as const, response: { echo: req } }); },
    cancel: (vid) => { calls.push(`cancel ${vid}`); return Promise.resolve({ ok: o.cancelOk ?? true }); },
    order: (vid) => { calls.push(`order ${vid}`); return Promise.resolve(o.orderView ? { ok: true as const, view: o.orderView } : { ok: false as const, error: "no view" }); },
    balances: () => Promise.resolve({}),
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
  id: "trend-4h-kraken", kind: "trend-4h", venue: "kraken", name: "Trend 4h · Kraken", symbols: ["BTC/USD"], mode: "paper", capital_usd: 60,
  params: { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42, enterMin: 0.6, exitMax: 0.3 }, ...over,
});

function world(opts: { strategies?: StrategyRow[]; orders?: Row[]; decisions?: Row[]; risk?: Partial<RiskRow>; fiveMin?: Partial<Candle>; canTrade?: boolean; orderView?: OrderView; jevDown?: boolean } = {}) {
  const { c4h, c1d, lastClose } = series();
  const quote = { bid: Math.round(lastClose * 100) / 100, ask: Math.round(lastClose * 100) / 100 + 0.1 };
  const m5start = Math.floor(NOW / FIVE_M) * FIVE_M - FIVE_M;
  const c5m: Candle[] = [{ start: m5start, open: quote.bid, high: quote.bid + 0.05, low: quote.bid - 0.05, close: quote.bid, volume: 1, ...opts.fiveMin }];
  const kraken = stubVenue("kraken", { c4h, c1d, c5m, quote, feeBps: { maker: 40, taker: 80 }, canTrade: opts.canTrade ?? false, orderView: opts.orderView });
  const revx = stubVenue("revx", { c4h, c1d, c5m, quote, feeBps: { maker: 0, taker: 9 }, canTrade: false });
  const mem = memDb({
    agent_risk: [{ ...RISK, ...opts.risk }],
    agent_strategies: (opts.strategies ?? [strategy()]) as unknown as Row[],
    agent_orders: opts.orders ?? [],
    agent_decisions: opts.decisions ?? [],
  });
  const deps = { db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now: NOW, fetchImpl: jevFetch(opts.jevDown), uuid: () => "00000000-0000-4000-8000-000000000001" };
  return { deps, mem, kraken, revx, quote, lastClosedBarStart: c4h[128].start, c5m };
}

Deno.test("a fresh closed bar becomes one decision and one resting paper order at the bid, on the strategy's venue", async () => {
  const w = world();
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.length, 1);
  assertEquals(r.decisions[0], { strategy: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", action: "enter", reason: r.decisions[0].reason, provider: "openrouter", allowed: true });
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.venue, "kraken");
  assertEquals(dec.final_action, "enter");
  assertEquals((dec.numbers as { barStart: number }).barStart, w.lastClosedBarStart);
  assertEquals(w.mem.tables.agent_orders.length, 1);
  const o = w.mem.tables.agent_orders[0] as Row & { request: { postOnly: boolean } };
  assertEquals([o.venue, o.mode, o.side, o.state, o.symbol], ["kraken", "paper", "buy", "new", "BTC/USD"]);
  assertEquals(o.price, w.quote.bid);
  assertAlmostEquals(Number(o.base_size) * w.quote.bid, 20, 0.01);     // capital 60 over three symbols, capped at max_order_usd
  assertEquals(o.request.postOnly, true);
  assertEquals(w.kraken.calls, []);                                    // paper: the venue is never asked to place
  assert(w.mem.tables.agent_candles.length > 100);
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
});

Deno.test("a paper order fills when the venue's last 5-minute candle trades through it, and pays that venue's maker fee", async () => {
  const seedOrder = (venue: VenueId, price: number): Row => ({
    id: 1, ts: new Date(NOW - FIVE_M).toISOString(), strategy_id: venue === "kraken" ? "trend-4h-kraken" : "trend-4h", venue, symbol: "BTC/USD", mode: "paper", side: "buy",
    price, base_size: 0.155, client_order_id: "c1", venue_order_id: null, state: "new", filled_base: 0, avg_fill_price: null, fee_usd: 0, filled_at: null,
  });
  const w = world({ orders: [seedOrder("kraken", 129.0)], fiveMin: { low: 128.9 } });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 1, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals(o.state, "filled");
  assertEquals(o.avg_fill_price, 129.0);
  assertAlmostEquals(Number(o.fee_usd), 0.155 * 129.0 * 0.004, 1e-6);      // Kraken maker 40 bps
  assertEquals(r.decisions[0].action, "hold");                              // now long: the rule holds, no second order
  assertEquals(w.mem.tables.agent_orders.length, 1);

  const w2 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [seedOrder("revx", 129.0)], fiveMin: { low: 128.9 } });
  await tick(w2.deps);
  assertEquals(Number(w2.mem.tables.agent_orders[0].fee_usd), 0);           // Revolut X maker 0
});

Deno.test("an unfilled paper order is cancelled after STALE_TICKS turns and the pair is re-quoted", async () => {
  const stale: Row = {
    id: 7, ts: new Date(NOW - STALE_TICKS * FIVE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", side: "buy",
    price: 120, base_size: 0.1, client_order_id: "c7", venue_order_id: null, state: "new", filled_base: 0, avg_fill_price: null, fee_usd: 0, filled_at: null,
  };
  const w = world({ orders: [stale] });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 7, state: "cancelled" }]);
  assertEquals(w.mem.tables.agent_orders.map((o) => o.state), ["cancelled", "new"]);
});

Deno.test("a bar is decided once: the previous decision naming the same barStart skips it", async () => {
  const w0 = world();
  const prev: Row = { id: 1, ts: new Date(NOW - FIVE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", numbers: { barStart: w0.lastClosedBarStart } };
  const w = world({ decisions: [prev] });
  const r = await tick(w.deps);
  assertEquals(r.decisions, []);
  assert(r.skipped.some((s) => s.includes("already decided")), r.skipped.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
});

Deno.test("a live order is refused while live_confirmed_at is null, whatever the strategy row says", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true });
  const r = await tick(w.deps);
  assertEquals(r.decisions[0].allowed, true);                               // the gate allowed it …
  assert(r.errors.some((e) => e.includes("live_confirmed_at")), r.errors.join("; "));   // … the confirmation gate did not
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assertEquals(w.kraken.calls, []);
});

Deno.test("a live order is refused without venue credentials, even when confirmed", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: false, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" } });
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("no kraken credentials")), r.errors.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
});

Deno.test("a live order goes to the venue as a post-only limit once confirmed, and the venue's id is kept", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" } });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  const base = (Math.floor(20 / w.quote.bid * 1e6) / 1e6).toFixed(6);       // $20 at the bid, floored to the lot step
  assertEquals(w.kraken.calls, [`place buy ${base}@${w.quote.bid.toFixed(2)}`]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.mode, o.state, o.venue_order_id], ["live", "new", "V-1"]);
});

Deno.test("a live order settles from the venue's own view: filled volume, average price and fee", async () => {
  const live: Row = {
    id: 3, ts: new Date(NOW - FIVE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "live", side: "buy",
    price: 129, base_size: 0.155, client_order_id: "c3", venue_order_id: "V-9", state: "new", filled_base: 0, avg_fill_price: null, fee_usd: 0, filled_at: null,
  };
  const view: OrderView = { state: "filled", filledBase: 0.155, avgPrice: 128.95, feeUsd: 0.08, raw: { status: "closed" } };
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live], orderView: view });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 3, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.filled_base, o.avg_fill_price, o.fee_usd], ["filled", 0.155, 128.95, 0.08]);
  assertEquals(w.kraken.calls, ["order V-9"]);
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
