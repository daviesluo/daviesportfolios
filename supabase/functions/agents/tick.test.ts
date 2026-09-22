// The one-minute loop, end to end, against an in-memory database and stub
// venues: a fresh closed bar becomes a decision and a resting paper order,
// and the state on the forming bar becomes an observation that is written
// once per change; the basis is recorded on every fifth minute; a paper
// fill pays the venue's maker fee and a marketable one the taker fee; a
// resting order the touch has walked away from is re-quoted, then dropped;
// a bar is decided once, and a second tick that reaches the same bar loses
// the claim; a live order is written down before the venue is called and
// reconciled by client id if the reply never landed; a live fill settles
// from the venue's own view; no model answer means no entry; the Revolut X
// rows read Kraken's candles; the rotation rule ranks the cross-section;
// the protective stop sells between bars without asking the model, and
// takes a resting exit off the book first; a live order the venue filled
// on arrival settles from the venue's own view, fee included; a partial
// fill is a position; the dislocation rule lifts the ask, rests its exit
// at the reference, and takes a resting exit off the book when a stop
// fires; one tick at a time, by lease; and today's P&L is measured from
// the day's open.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Candle } from "../_shared/agents_strategy.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import { PAGE_ROWS, type Db } from "./db.ts";
import { dayPnl, LEASE_MS, MAX_ORDER_AGE_MS, MAX_REQUOTES, PROBE_FOLLOW_UP_MS, PROBE_TTL_MS, probeFilled, probeFollowUpDue, PROTECTIVE_CLAIM_OFFSET_MS, REQUOTE_AFTER_MS, tick, TURN_BUDGET_MS, type OrderRow, type RiskRow, type StrategyRow } from "./tick.ts";

const FOUR_H = 4 * 3600e3, ONE_H = 3600e3, ONE_D = 86400e3, ONE_M = 60e3;
const NOW = Date.parse("2026-09-20T04:05:00Z");                 // minute 245 of the day: a fifth minute, so the basis is recorded
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

/**
 * Enough of PostgREST's query syntax for what tick.ts asks, plus the two
 * uniquenesses the schema has (one decision per bar, one order per decision
 * attempt) and PostgREST's silent cap: a select with no `limit` returns at
 * most `PAGE_ROWS` rows, exactly as Supabase's `max-rows` does.
 */
function memDb(seed: Record<string, Row[]>, hooks: { beforeDecisionInsert?: (tables: Record<string, Row[]>, row: Row) => void; beforeOrderInsert?: (tables: Record<string, Row[]>, row: Row) => void } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1000;
  const parse = (query: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; dir: "asc" | "desc" } | null = null, limit = PAGE_ROWS, offset = 0, select: string[] | null = null;
    for (const part of query.split("&")) {
      const i = part.indexOf("=");
      const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === "select") { select = v === "*" ? null : v.split(","); continue; }
      if (k === "order") { const [col, dir] = v.split("."); order = { col, dir: dir === "desc" ? "desc" : "asc" }; continue; }
      if (k === "limit") { limit = Math.min(Number(v), PAGE_ROWS); continue; }
      if (k === "offset") { offset = Number(v); continue; }
      const m = v.match(/^(eq|in|gte|lt|is)\.(.*)$/);
      if (!m) throw new Error(`stub db: unsupported filter ${part}`);
      const val = decodeURIComponent(m[2]);
      if (m[1] === "is") { if (val !== "null" && val !== "not.null") throw new Error(`stub db: unsupported filter ${part}`); filters.push((r) => (r[k] == null) === (val === "null")); }
      if (m[1] === "eq") filters.push((r) => String(r[k]) === val);
      if (m[1] === "in") { const set = val.slice(1, -1).split(","); filters.push((r) => set.includes(String(r[k]))); }
      if (m[1] === "gte") filters.push((r) => String(r[k]) >= val);
      if (m[1] === "lt") filters.push((r) => String(r[k]) < val);
    }
    return { filters, order, limit, offset, select };
  };
  const db: Db = {
    select: (table, query) => {
      const { filters, order, limit, offset, select } = parse(query);
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, dir } = order;
        rows = rows.slice().sort((a, b) => ((a[col] as number) < (b[col] as number) ? -1 : (a[col] as number) > (b[col] as number) ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      rows = rows.slice(offset, offset + limit);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve((select ? rows.map((r) => Object.fromEntries(select!.map((c) => [c, r[c]]))) : rows.map((r) => ({ ...r }))) as any);
    },
    insert: (table, rows, returning = true) => {
      const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
      if (table === "agent_decisions") {
        for (const r of list) {
          hooks.beforeDecisionInsert?.(tables, r);
          const dup = (tables[table] ?? []).some((x) => x.strategy_id === r.strategy_id && x.symbol === r.symbol && x.bar_start === r.bar_start);
          if (dup) return Promise.reject(new Error("db POST agent_decisions → 409: duplicate key value violates unique constraint \"agent_decisions_one_per_bar\""));
        }
      }
      if (table === "agent_orders") {
        for (const r of list) {
          hooks.beforeOrderInsert?.(tables, r);
          if (r.decision_id == null) continue;
          const dup = (tables[table] ?? []).some((x) => x.decision_id === r.decision_id && Number(x.requotes ?? 0) === Number(r.requotes ?? 0));
          if (dup) return Promise.reject(new Error("db POST agent_orders → 409: duplicate key value violates unique constraint \"agent_orders_one_per_decision_attempt\""));
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
    claim: (table, query, patch) => {
      const { filters } = parse(query);
      const hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, patch as Row);
      // deno-lint-ignore no-explicit-any
      return Promise.resolve(hit.map((r) => ({ ...r })) as any);
    },
    selectAll: async (table, query) => {
      const out: unknown[] = [];
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const page = await db.select(table, `${query}&limit=${PAGE_ROWS}&offset=${offset}`);
        out.push(...page);
        if (page.length < PAGE_ROWS) break;
      }
      // deno-lint-ignore no-explicit-any
      return out as any;
    },
  };
  return { db, tables };
}

type SeriesBySymbol = Record<string, { bars: Candle[]; c1d: Candle[]; bars1h?: Candle[] }>;

function stubVenue(id: VenueId, o: {
  series: SeriesBySymbol; c1m: Candle[]; quote: Quote; feeBps: { maker: number; taker: number }; canTrade: boolean;
  orderView?: OrderView; cancelOk?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>;
  onPlace?: () => void; placedState?: "new" | "filled"; noQuote?: boolean;
}) {
  const calls: string[] = [];
  const v: Venue = {
    id, canTrade: o.canTrade, feeBps: o.feeBps,
    candles: (sym, iv) => {
      calls.push(`candles ${sym} ${iv}`);
      const s = o.series[sym] ?? o.series["BTC/USD"];
      return Promise.resolve(iv === 240 ? s.bars : iv === 60 ? (s.bars1h ?? s.bars) : iv === 1440 ? s.c1d : o.c1m);
    },
    quotes: (syms) => Promise.resolve(o.noQuote ? {} : Object.fromEntries(syms.map((s) => [s, o.quote]))),
    pairs: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, PAIR]))),
    placeLimit: (req) => { o.onPlace?.(); calls.push(`place ${req.side} ${req.base}@${req.price}${req.marketable ? " taker" : ""}`); return Promise.resolve({ ok: true as const, venueOrderId: "V-1", state: o.placedState ?? "new" as const, response: { echo: req } }); },
    cancel: (vid) => { calls.push(`cancel ${vid}`); return Promise.resolve({ ok: o.cancelOk ?? true }); },
    order: (vid) => { calls.push(`order ${vid}`); return Promise.resolve(o.orderView ? { ok: true as const, view: o.orderView } : { ok: false as const, error: "no view" }); },
    balances: () => Promise.resolve({}),
    activeOrders: () => { calls.push("activeOrders"); return Promise.resolve({ ok: true as const, byClientId: o.active ?? {} }); },
  };
  return { v, calls };
}

/** Jev answering "healthy, calm, and yes that symbol" — or failing, when `fail` is set. */
function jevFetch(fail = false, log: string[] = []): typeof fetch {
  return (_url, init) => {
    if (fail) return Promise.resolve(new Response("down", { status: 503 }));
    const sym = JSON.parse(String(init?.body)).state.symbol;
    log.push(sym);
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

const RISK: RiskRow & { id: number } = { id: 1, global_pause: false, max_order_usd: 20, max_exposure_usd: 100, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: null };
const strategy = (over: Partial<StrategyRow> = {}): StrategyRow => ({
  id: "trend-4h-kraken", kind: "trend-4h", venue: "kraken", signal_venue: "kraken", name: "Trend 4h · Kraken", symbols: ["BTC/USD"], mode: "paper", capital_usd: 60,
  params: { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42, enterMin: 0.6, exitMax: 0.3 }, ...over,
});
const dislocation = (over: Partial<StrategyRow> = {}): StrategyRow => strategy({
  id: "dislocation-1m", kind: "dislocation-1m", venue: "revx", signal_venue: "kraken", name: "Dislocation · Revolut X", symbols: ["BTC/USD"], capital_usd: 40,
  params: { entryBps: 15, exitBps: -2, maxHoldMin: 30, stopBps: 40, sharpMoveBps: 15, cooldownMin: 3, enterMin: 0.6, exitMax: 0.3 }, ...over,
});

function world(opts: {
  strategies?: StrategyRow[]; orders?: Row[]; decisions?: Row[]; observations?: Row[]; risk?: Partial<RiskRow>; oneMin?: Partial<Candle>; canTrade?: boolean;
  orderView?: OrderView; jevDown?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>; onPlace?: () => void;
  series?: SeriesBySymbol; revxQuote?: Quote; now?: number; krakenMinutes?: Candle[]; leaseUntil?: string; raceClaim?: boolean; placedState?: "new" | "filled";
  krakenNoQuote?: boolean; raceOrder?: boolean; takeover?: boolean; probes?: Row[];
} = {}) {
  const now = opts.now ?? NOW;
  const base = series();
  const ser: SeriesBySymbol = opts.series ?? { "BTC/USD": base };
  const quote = { bid: Math.round(base.lastClose * 100) / 100, ask: Math.round(base.lastClose * 100) / 100 + 0.1 };
  const m1start = Math.floor(now / ONE_M) * ONE_M - ONE_M;
  const c1m: Candle[] = [{ start: m1start, open: quote.bid, high: quote.bid + 0.05, low: quote.bid - 0.05, close: quote.bid, volume: 1, ...opts.oneMin }];
  const jevLog: string[] = [];
  const kraken = stubVenue("kraken", { series: ser, c1m: opts.krakenMinutes ?? c1m, quote, feeBps: { maker: 40, taker: 80 }, canTrade: opts.canTrade ?? false, orderView: opts.orderView, active: opts.active, onPlace: opts.onPlace, placedState: opts.placedState, noQuote: opts.krakenNoQuote });
  const revxQuote = opts.revxQuote ?? { bid: quote.bid + 0.02, ask: quote.ask + 0.02 };
  const revx = stubVenue("revx", { series: ser, c1m, quote: revxQuote, feeBps: { maker: 0, taker: 9 }, canTrade: false });
  const mem = memDb({
    agent_risk: [{ ...RISK, ...opts.risk }],
    agent_strategies: (opts.strategies ?? [strategy()]) as unknown as Row[],
    agent_orders: opts.orders ?? [],
    agent_decisions: opts.decisions ?? [],
    agent_observations: opts.observations ?? [],
    agent_maker_probes: opts.probes ?? [],
    agent_locks: [{ name: "tick", lease_until: opts.leaseUntil ?? "1970-01-01T00:00:00.000Z", holder: null }],
  }, {
    // The race: another tick claims the same bar between this tick's fast check and its insert — or, with `takeover`, the next
    // turn takes the LEASE over while this one is still running (as it would once this one's lease had expired).
    beforeDecisionInsert: opts.raceClaim ? (tables, row) => { (tables.agent_decisions ??= []).push({ id: 1, ts: new Date(NOW - 1000).toISOString(), strategy_id: row.strategy_id, symbol: row.symbol, bar_start: row.bar_start }); }
      : opts.takeover ? (tables) => { tables.agent_locks = [{ name: "tick", lease_until: new Date(NOW + 90e3).toISOString(), holder: "the next turn" }]; }
      : undefined,
    // Another turn places this decision's order between this turn's check and its insert.
    beforeOrderInsert: opts.raceOrder ? (tables, row) => { if (row.decision_id != null) (tables.agent_orders ??= []).push({ id: 1, ts: new Date(NOW - 1000).toISOString(), strategy_id: row.strategy_id, venue: row.venue, symbol: row.symbol, mode: row.mode, side: row.side, price: row.price, base_size: row.base_size, client_order_id: "racer", decision_id: row.decision_id, requotes: row.requotes, state: "new", filled_base: 0, fee_usd: 0, request: row.request }); } : undefined,
  });
  const deps = { db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch(opts.jevDown, jevLog), uuid: () => "00000000-0000-4000-8000-000000000001" };
  return { deps, mem, kraken, revx, quote, revxQuote, lastClosedBarStart: base.bars[128].start, c1m, jevLog };
}

const seedOrder = (over: Partial<OrderRow> & Row = {}): Row => ({
  id: 1, ts: new Date(NOW - 5 * ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", side: "buy",
  price: 129.0, base_size: 0.155, client_order_id: "c1", venue_order_id: null, state: "new", filled_base: 0, avg_fill_price: null, fee_usd: 0, filled_at: null, requotes: 0, request: null, ...over,
});
/** A filled buy on record: the strategy is long `base` at `price`, since `agoMs`. */
const longSince = (agoMs: number, price: number, base = 0.155, over: Partial<OrderRow> & Row = {}): Row => seedOrder({
  id: 50, ts: new Date(NOW - agoMs).toISOString(), filled_at: new Date(NOW - agoMs).toISOString(), state: "filled", price, avg_fill_price: price, base_size: base, filled_base: base, ...over,
});

Deno.test("a fresh closed bar becomes one decision and one resting paper order at the bid, on the strategy's venue", async () => {
  const w = world();
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.length, 1);
  assertEquals(r.decisions[0], { strategy: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", action: "enter", reason: r.decisions[0].reason, provider: "openrouter", allowed: true, kind: "bar" });
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.venue, "kraken");
  assertEquals(dec.final_action, "enter");
  assertEquals(dec.bar_start, new Date(w.lastClosedBarStart).toISOString());
  assertEquals(w.mem.tables.agent_orders.length, 1);
  const o = w.mem.tables.agent_orders[0] as Row & { request: { postOnly: boolean; marketable: boolean } };
  assertEquals([o.venue, o.mode, o.side, o.state, o.symbol], ["kraken", "paper", "buy", "new", "BTC/USD"]);
  assertEquals(o.price, w.quote.bid);
  assertAlmostEquals(Number(o.base_size) * w.quote.bid, 20, 0.01);     // capital 60 over three slots, capped at max_order_usd
  assertEquals([o.request.postOnly, o.request.marketable], [true, false]);
  assert(!w.kraken.calls.some((c) => c.startsWith("place")));           // paper: the venue is never asked to place
  assert(w.mem.tables.agent_candles.length > 200);
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
  assert(!w.kraken.calls.includes("candles BTC/USD 1"));                // no paper order rests, so the execution venue's minute — whose one reader is a resting paper fill — is not fetched
  const lock = w.mem.tables.agent_locks[0];
  assertEquals([lock.lease_until, lock.holder], [new Date(NOW).toISOString(), null]);   // the lease was taken and given back
});

Deno.test("a retired strategy row is never ticked, whatever its mode says: its records stay, its turn does not come (0038)", async () => {
  const live = strategy();
  const retired = { ...strategy(), id: "trend-4h-retired", retired_at: new Date(NOW - 60_000).toISOString() };
  const w = world({ strategies: [retired, live] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.map((d) => d.strategy), ["trend-4h-kraken"]);
  assert(w.mem.tables.agent_decisions.every((d) => d.strategy_id !== "trend-4h-retired"));
  assert(w.mem.tables.agent_orders.every((o) => o.strategy_id !== "trend-4h-retired"));
  assert(w.mem.tables.agent_observations.every((o) => o.strategy_id !== "trend-4h-retired"));
});

Deno.test("one tick at a time: a turn that finds the lease held does nothing, and a turn that ran holds it for the cron minute at most", async () => {
  const w = world({ leaseUntil: new Date(NOW + 20e3).toISOString() });      // another turn is still running
  const r = await tick(w.deps);
  assertEquals([r.decisions.length, r.observations, w.mem.tables.agent_orders.length], [0, 0, 0]);
  assert(r.skipped.some((s) => s.includes("lease")), r.skipped.join("; "));
  assertEquals(w.kraken.calls, []);                                        // not a single venue call
  const w2 = world({ leaseUntil: new Date(NOW - 1).toISOString() });       // an expired lease from a turn that died: taken over
  const r2 = await tick(w2.deps);
  assertEquals(r2.decisions.length, 1);
  assert(LEASE_MS < 60e3);
});

Deno.test("the state on the forming bar is an observation, written when it changes and not otherwise", async () => {
  const w = world();
  const r1 = await tick(w.deps);
  assertEquals(r1.observations, 1);
  const obs = w.mem.tables.agent_observations;
  assertEquals(obs.length, 1);
  assertEquals([obs[0].strategy_id, obs[0].symbol], ["trend-4h-kraken", "BTC/USD"]);
  assertEquals((obs[0].state as { trend_4h: string }).trend_4h, "up");
  assertEquals(obs[0].bar_start, new Date(Math.floor(NOW / FOUR_H) * FOUR_H).toISOString());    // the FORMING bar, not the closed one
  // A minute later the resting bid has filled: the position is long, and that IS a change worth a row.
  const r2 = await tick({ ...w.deps, now: NOW + ONE_M });
  assertEquals(r2.settled.map((x) => x.state), ["filled"]);
  assertEquals(r2.observations, 1);
  assertEquals((w.mem.tables.agent_observations[1].state as { position: string }).position, "long");
  // Another minute, the same words: nothing to write.
  const r3 = await tick({ ...w.deps, now: NOW + 2 * ONE_M });
  assertEquals(r3.observations, 0);
  assertEquals(w.mem.tables.agent_observations.length, 2);
});

Deno.test("an observation read back with its keys in the database's order is still the same state: nothing is re-written", async () => {
  // jsonb returns keys in its own order. The first tick's row is handed back reversed; the second tick must see no change.
  const w = world({ oneMin: { low: 130, high: 130.1 } });
  await tick(w.deps);
  const row = w.mem.tables.agent_observations[0];
  row.state = Object.fromEntries(Object.entries(row.state as Record<string, unknown>).reverse());
  const r2 = await tick({ ...w.deps, now: NOW + ONE_M });
  assertEquals(r2.observations, 0);
  assertEquals(w.mem.tables.agent_observations.length, 1);
});

Deno.test("the basis between the venues is recorded for every symbol on every fifth minute, and reported every turn", async () => {
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
  const w2 = world({ now: NOW + ONE_M });
  const r2 = await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_basis ?? [], []);                      // minute 246: measured, not stored
  assert(r2.basis["BTC/USD"] != null);
});

Deno.test("a Revolut X strategy reads Kraken's candles and quotes Revolut X's touch", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assert(w.kraken.calls.includes("candles BTC/USD 240") && w.kraken.calls.includes("candles BTC/USD 1440"), w.kraken.calls.join(","));
  assert(!w.kraken.calls.includes("candles BTC/USD 1"));                 // Kraken is not the execution venue here …
  assert(!w.revx.calls.includes("candles BTC/USD 1"));                   // … Revolut X is, and with no paper order resting its minute is not needed either
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
  const o = w.mem.tables.agent_orders[0] as Row & { request: { marketable: boolean; timeInForce: string } };
  assertEquals([o.venue, o.price], ["revx", w.quote.ask + 0.02]);          // Revolut X takes its own ask: the backtest's fill, 9 bps
  assertEquals([o.request.marketable, o.request.timeInForce], [true, "ioc"]);
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

Deno.test("a paper order fills when the venue's last minute trades through it and pays that venue's maker fee; a marketable one fills at once at the taker fee", async () => {
  const w = world({ orders: [seedOrder()], oneMin: { low: 128.9 } });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 1, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals(o.state, "filled");
  assertEquals(o.avg_fill_price, 129.0);
  assertAlmostEquals(Number(o.fee_usd), 0.155 * 129.0 * 0.004, 1e-6);      // Kraken maker 40 bps
  assertEquals(o.filled_at, new Date(w.c1m[0].start + ONE_M).toISOString());
  assertEquals(r.decisions[0].action, "hold");                              // now long: the rule holds, no second order
  assertEquals(w.mem.tables.agent_orders.length, 1);

  const w2 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [seedOrder({ strategy_id: "trend-4h", venue: "revx" })], oneMin: { low: 128.9 } });
  await tick(w2.deps);
  assertEquals(Number(w2.mem.tables.agent_orders[0].fee_usd), 0);           // Revolut X maker 0

  // Marketable: the minute did NOT trade through the price, and it fills anyway, at the taker fee.
  const w3 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [seedOrder({ strategy_id: "trend-4h", venue: "revx", price: 129.2, request: { marketable: true } })], oneMin: { low: 129.0, high: 129.1 } });
  const r3 = await tick(w3.deps);
  assertEquals(r3.settled, [{ id: 1, state: "filled" }]);
  assertAlmostEquals(Number(w3.mem.tables.agent_orders[0].fee_usd), 0.155 * 129.2 * 0.0009, 1e-6);   // Revolut X taker 9 bps
});

Deno.test("a resting order the touch has walked away from is re-quoted at the new touch, a bounded number of times, and dropped after an hour", async () => {
  // Three minutes old, resting 7 % under the bid: cancelled and re-quoted at the bid with the count up one.
  const w = world({ orders: [seedOrder({ id: 7, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 120, base_size: 0.1, client_order_id: "c7", requotes: 2 })] });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 7, state: "cancelled" }]);
  assertEquals(w.mem.tables.agent_orders.map((o) => o.state), ["cancelled", "new"]);
  const re = w.mem.tables.agent_orders[1];
  assertEquals([re.price, re.base_size, re.requotes], [w.quote.bid, 0.1, 3]);
  assertEquals(r.decisions, []);                                            // the same decision, one more try — not a new decision

  // Three minutes old but the touch is still within 5 bps: left alone.
  const bid = world().quote.bid;
  const w2 = world({ orders: [seedOrder({ id: 8, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: bid, client_order_id: "c8" })], oneMin: { low: bid + 0.01, high: bid + 0.2 } });
  const r2 = await tick(w2.deps);
  assertEquals(r2.settled, []);
  assert(r2.skipped.some((s) => s.includes("order in flight")));

  // Already re-quoted MAX_REQUOTES times: cancelled and NOT re-quoted; the decision lapses until the next bar.
  const w3 = world({ orders: [seedOrder({ id: 9, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 120, client_order_id: "c9", requotes: MAX_REQUOTES })] });
  const r3 = await tick(w3.deps);
  assertEquals(r3.settled, [{ id: 9, state: "cancelled" }]);
  assertEquals(w3.mem.tables.agent_orders.map((o) => o.state), ["cancelled", "new"]);   // the bar is still undecided, so the rule decides afresh …
  assertEquals(r3.decisions.length, 1);                                                  // … as a NEW decision, not a re-quote
  assertEquals(w3.mem.tables.agent_orders[1].requotes, 0);

  // An hour old at the touch: too old, dropped.
  const w4 = world({ orders: [seedOrder({ id: 10, ts: new Date(NOW - MAX_ORDER_AGE_MS).toISOString(), price: bid, client_order_id: "c10" })], oneMin: { low: bid + 0.01, high: bid + 0.2 } });
  const r4 = await tick(w4.deps);
  assertEquals(r4.settled, [{ id: 10, state: "cancelled" }]);
  assertEquals((w4.mem.tables.agent_orders[0].response as { cancelled: string }).cancelled, "too old");
});

Deno.test("a bar is decided once: the previous decision naming the same bar skips it", async () => {
  const w0 = world();
  const prev: Row = { id: 1, ts: new Date(NOW - 5 * ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", bar_start: new Date(w0.lastClosedBarStart).toISOString() };
  const w = world({ decisions: [prev] });
  const r = await tick(w.deps);
  assertEquals(r.decisions, []);
  assert(r.skipped.some((s) => s.includes("already decided")), r.skipped.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
});

Deno.test("two ticks on the same bar: the second's claim fails on the unique index and it places nothing", async () => {
  // Another tick claims the bar between this one's check and its insert: the insert is a 409 and nothing is placed.
  const w = world({ raceClaim: true });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions, []);
  assert(r.skipped.some((s) => s.includes("claimed by another tick")), r.skipped.join("; "));
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assertEquals(w.mem.tables.agent_decisions.length, 1);                   // the other tick's row, not ours
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

Deno.test("a live order the venue filled on arrival is written as new and settled next turn from the venue's view, fee and all", async () => {
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, placedState: "filled" });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.venue_order_id, o.filled_base ?? 0, o.fee_usd ?? 0], ["new", "V-1", 0, 0]);   // nothing invented from the placement reply
  assert(r.orders[0].state.includes("filled on arrival"));
  // Next turn the venue says what filled, at what price, for what fee.
  const view: OrderView = { state: "filled", filledBase: Number(o.base_size), avgPrice: Number(o.price) + 0.01, feeUsd: 0.016, raw: { status: "closed" } };
  const w2 = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [w.mem.tables.agent_orders[0]], orderView: view, now: NOW + ONE_M });
  const r2 = await tick(w2.deps);
  assertEquals(r2.settled.map((x) => x.state), ["filled"]);
  const o2 = w2.mem.tables.agent_orders[0];
  assertEquals([o2.state, o2.filled_base, o2.avg_fill_price, o2.fee_usd], ["filled", Number(o.base_size), Number(o.price) + 0.01, 0.016]);
});

Deno.test("a partially filled live order is a position: the stop sees it and the observation says long", async () => {
  // 0.05 filled of 0.155 at 200, the market at ~129: 35 % under cost. The rest is still working at the venue.
  const partial = seedOrder({ id: 6, mode: "live", state: "partially_filled", client_order_id: "c6", venue_order_id: "V-6", price: 200, base_size: 0.155, filled_base: 0.05, avg_fill_price: 200, strategy_id: "trend-4h", venue: "revx" });
  const view: OrderView = { state: "partially_filled", filledBase: 0.05, avgPrice: 200, feeUsd: 0.01, raw: {} };
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [partial], orderView: view });
  const r = await tick(w.deps);
  assertEquals((w.mem.tables.agent_observations[0].state as { position: string }).position, "long");
  // The stop fires; the working buy cannot be cancelled without credentials in this world, so the turn says so rather than selling under it.
  assert(r.skipped.some((s) => s.includes("stop wants out")), [...r.skipped, ...r.errors].join("; "));
  assert(r.errors.some((e) => e.includes("no revx credentials")), r.errors.join("; "));
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

  // Not at the venue: the outcome is UNKNOWN — a marketable order fills or dies inside the turn, a post-only bid can be lifted
  // seconds after it rests — so the row STAYS pending, keeps the pair in flight, and is reported with the venue's balance
  // beside what the record holds. Never marked rejected on a guess: a real position nobody protects is the worst outcome.
  const w2 = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [pending], active: {} });
  const r2 = await tick(w2.deps);
  assertEquals(r2.settled, []);
  assertEquals(w2.mem.tables.agent_orders[0].state, "pending");
  assert(r2.errors.some((e) => e.includes("outcome unknown") && e.includes("kraken holds 0 BTC against 0 on record")), r2.errors.join("; "));
  assert(r2.skipped.some((s) => s.includes("order in flight")));
  assertEquals(w2.mem.tables.agent_orders.length, 1);
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

Deno.test("a live order the venue cancelled after a partial fill settles as a fill of what filled; one with nothing filled settles as cancelled", async () => {
  const live = seedOrder({ id: 4, mode: "live", client_order_id: "c4", venue_order_id: "V-4" });
  const partial: OrderView = { state: "cancelled", filledBase: 0.05, avgPrice: 129.01, feeUsd: 0.03, raw: { status: "cancelled", filled: "0.05" } };
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live], orderView: partial });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 4, state: "filled" }]);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.filled_base, o.avg_fill_price, o.fee_usd], ["filled", 0.05, 129.01, 0.03]);
  assert(o.cancelled_at != null);
  const none: OrderView = { state: "cancelled", filledBase: 0, avgPrice: null, feeUsd: 0, raw: { status: "cancelled" } };
  const w2 = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live], orderView: none });
  const r2 = await tick(w2.deps);
  assertEquals(r2.settled, [{ id: 4, state: "cancelled" }]);
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

Deno.test("after an exit the rule waits two of its own bars before buying again", async () => {
  // Sold four hours ago (one 4h bar): the breakout would re-enter; the cooldown holds it.
  const sale = longSince(FOUR_H, 129.0, 0.155, { id: 61, side: "sell" });
  const w = world({ orders: [longSince(3 * ONE_D, 120, 0.155), sale] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals([r.decisions[0].action, r.decisions[0].kind], ["hold", "bar"]);
  assert(r.decisions[0].reason.includes("cooling down"), r.decisions[0].reason);
  assertEquals(w.mem.tables.agent_orders.length, 2);
  // Sold nine hours ago (past two bars): the rule is free to enter.
  const w2 = world({ orders: [longSince(3 * ONE_D, 120, 0.155), longSince(9 * 3600e3, 129.0, 0.155, { id: 61, side: "sell" })] });
  const r2 = await tick(w2.deps);
  assertEquals(r2.decisions[0].action, "enter");
});

Deno.test("paper twins are capped by their own exposure number, so they do not crowd each other out", async () => {
  const w = world({ risk: { max_exposure_usd: 10, paper_exposure_usd: 300 } });   // the live cap would refuse a $20 paper order
  const r = await tick(w.deps);
  assertEquals(r.decisions[0].allowed, true);
  assertEquals(w.mem.tables.agent_orders.length, 1);
  const w2 = world({ risk: { max_exposure_usd: 10, paper_exposure_usd: null } });  // no paper number: the live cap applies
  const r2 = await tick(w2.deps);
  assertEquals(r2.decisions[0].allowed, false);
  assert(String(w2.mem.tables.agent_decisions[0].risk_reason).includes("exposure"));
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

Deno.test("the protective floor sells between bars, without the model: marketable on Revolut X, resting on Kraken", async () => {
  // Long from 200 with the market at ~129: 35 % under cost, far through the 8 % floor. A "hold" bar decision would have kept it.
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.length, 1);
  assertEquals([r.decisions[0].action, r.decisions[0].kind, r.decisions[0].provider], ["exit", "protective", "rule"]);
  assertEquals(w.jevLog, []);                                              // the model is not asked on the way out
  assert(r.decisions[0].reason.includes("protective floor"), r.decisions[0].reason);
  const sell = w.mem.tables.agent_orders[1] as Row & { request: { marketable: boolean } };
  assertEquals([sell.side, sell.venue, sell.price, sell.base_size, sell.request.marketable], ["sell", "revx", w.revxQuote.bid, 0.1, true]);
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.bar_start, new Date(Math.floor(NOW / ONE_M) * ONE_M + PROTECTIVE_CLAIM_OFFSET_MS).toISOString());   // claimed one second INTO the minute: a stop that lapses is tried again next minute, and a bar start (always on the minute) is never taken
  assertEquals((dec.numbers as { kind: string }).kind, "protective");

  // The same on Kraken rests at the ASK, post-only: a post-only sell at the bid would cross and be rejected.
  const w2 = world({ orders: [longSince(2 * ONE_D, 200, 0.1)] });
  await tick(w2.deps);
  const sell2 = w2.mem.tables.agent_orders[1] as Row & { request: { marketable: boolean } };
  assertEquals([sell2.side, sell2.venue, sell2.request.marketable], ["sell", "kraken", false]);
  assertAlmostEquals(Number(sell2.price), w2.quote.ask, 1e-9);            // at the ask, on the venue's grid
  // … and while that ask rests the stop leaves it alone rather than churning it every minute.
  const r2b = await tick({ ...w2.deps, now: NOW + ONE_M });
  assertEquals(w2.mem.tables.agent_orders.length, 2);
  assert(r2b.skipped.some((s) => s.includes("stop wants out")), r2b.skipped.join("; "));

  // A healthy position is left to the bar decision.
  const w3 = world({ orders: [longSince(2 * ONE_D, 128, 0.1)] });
  const r3 = await tick(w3.deps);
  assertEquals([r3.decisions[0].action, r3.decisions[0].kind], ["hold", "bar"]);
  assertEquals(w3.mem.tables.agent_orders.length, 1);

  // On Revolut X a resting exit does not outrank the stop: it is cancelled first, then the position is sold at the bid.
  const restingAsk = seedOrder({ id: 71, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", side: "sell", price: 129.5, base_size: 0.1, client_order_id: "c71" });
  const w4 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" }), restingAsk] });
  const r4 = await tick(w4.deps);
  assertEquals(r4.settled, [{ id: 71, state: "cancelled" }]);
  assertEquals([r4.decisions[0].action, r4.decisions[0].kind], ["exit", "protective"]);
  const sell4 = w4.mem.tables.agent_orders[2] as Row & { request: { marketable: boolean } };
  assertEquals([sell4.side, sell4.request.marketable], ["sell", true]);
  assertAlmostEquals(Number(sell4.price), w4.revxQuote.bid, 1e-9);
});

Deno.test("one pair's failure is one pair's failure: a throwing venue call on BTC leaves ETH its decision", async () => {
  const w = world({ strategies: [strategy({ symbols: ["BTC/USD", "ETH/USD"] })] });
  const origInsert = w.mem.db.insert;
  w.mem.db.insert = (table, rows, returning) => {
    const r = (Array.isArray(rows) ? rows[0] : rows) as Row;
    if (table === "agent_observations" && r.symbol === "BTC/USD") return Promise.reject(new Error("db POST agent_observations → 500: boom"));
    return origInsert(table, rows, returning);
  };
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.startsWith("trend-4h-kraken|BTC/USD: ")), r.errors.join("; "));
  assertEquals(r.decisions.map((d) => d.symbol), ["ETH/USD"]);
});

// The dislocation rule: Kraken's mid is the reference; Revolut X's quote is set per test.
const cheap = (q: Quote, bps: number): Quote => { const mid = (q.bid + q.ask) / 2, f = 1 - bps / 1e4; return { bid: Math.round((mid * f - 0.05) * 100) / 100, ask: Math.round((mid * f + 0.05) * 100) / 100 }; };

Deno.test("dislocation: Revolut X 20 bps under Kraken lifts the ask at once, with the model's yes, and writes the state down", async () => {
  const w0 = world();
  const w = world({ strategies: [dislocation()], revxQuote: cheap(w0.quote, 20) });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.observations, 1);
  const obs = w.mem.tables.agent_observations[0];
  assertEquals((obs.state as { basis: string; basis_size: string; reference_move_5m: string }).basis, "revx_cheap");
  assertEquals((obs.state as { basis_size: string }).basis_size, "medium");
  assertAlmostEquals(Number((obs.numbers as { basisBps: number }).basisBps), -20, 0.5);
  assertEquals(r.decisions.length, 1);
  assertEquals([r.decisions[0].action, r.decisions[0].kind, r.decisions[0].provider, r.decisions[0].allowed], ["enter", "bar", "openrouter", true]);
  assertEquals(w.jevLog, ["BTC/USD"]);                                      // an entry asks the model
  const o = w.mem.tables.agent_orders[0] as Row & { request: { marketable: boolean; timeInForce: string; postOnly: boolean } };
  assertEquals([o.venue, o.side, o.price, o.state], ["revx", "buy", w.revxQuote.ask, "new"]);
  assertEquals([o.request.marketable, o.request.timeInForce, o.request.postOnly], [true, "ioc", false]);
  assertAlmostEquals(Number(o.base_size) * Number(o.price), 20, 0.02);      // capital 40 over one symbol, capped at max_order_usd
  assertEquals(w.mem.tables.agent_decisions[0].bar_start, new Date(Math.floor(NOW / ONE_M) * ONE_M).toISOString());   // the minute is the bar
  assert(w.kraken.calls.includes("candles BTC/USD 1"));                     // Kraken's minutes, for the reference move
});

Deno.test("dislocation: a fair basis, a sharp reference move, or a fresh exit means no entry and no decision row", async () => {
  const w0 = world();
  const w = world({ strategies: [dislocation()] });                          // Revolut X 1.5 bps over Kraken: fair
  const r = await tick(w.deps);
  assertEquals(r.decisions, []);
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assertEquals(r.observations, 1);                                          // the state is still written down
  // Kraken fell 30 bps in five minutes: the cheap print is the front of a move, not a stale quote.
  const m1start = Math.floor(NOW / ONE_M) * ONE_M;
  const minutes: Candle[] = Array.from({ length: 8 }, (_, i) => { const c = 129.4 - i * 0.05; return { start: m1start - (8 - i) * ONE_M, open: c, high: c + 0.01, low: c - 0.01, close: c, volume: 1 }; });
  const w2 = world({ strategies: [dislocation()], revxQuote: cheap(w0.quote, 20), krakenMinutes: minutes });
  const r2 = await tick(w2.deps);
  assertEquals(r2.decisions, []);
  assertEquals((w2.mem.tables.agent_observations[0].state as { reference_move_5m: string }).reference_move_5m, "sharp_down");
  // Sold a minute ago: cooling down.
  const exit = longSince(ONE_M, 129.0, 0.155, { id: 60, strategy_id: "dislocation-1m", venue: "revx", side: "sell" });
  const w3 = world({ strategies: [dislocation()], revxQuote: cheap(w0.quote, 20), orders: [longSince(10 * ONE_M, 129.0, 0.155, { strategy_id: "dislocation-1m", venue: "revx" }), exit] });
  const r3 = await tick(w3.deps);
  assertEquals(r3.decisions, []);
  assertEquals(w3.mem.tables.agent_orders.length, 2);
});

Deno.test("dislocation: once the basis has closed the exit rests an ask at the reference, without asking the model", async () => {
  const w0 = world();
  // Long from 128.85 for ten minutes; Revolut X is back at Kraken's price.
  const w = world({ strategies: [dislocation()], orders: [longSince(10 * ONE_M, 128.85, 0.155, { strategy_id: "dislocation-1m", venue: "revx" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals([r.decisions[0].action, r.decisions[0].kind, r.decisions[0].provider], ["exit", "bar", "rule"]);
  assertEquals(w.jevLog, []);
  const o = w.mem.tables.agent_orders[1] as Row & { request: { marketable: boolean } };
  const fair = (w0.quote.bid + w0.quote.ask) / 2, mid = (w.revxQuote.bid + w.revxQuote.ask) / 2, hs = (w.revxQuote.ask - w.revxQuote.bid) / 2 / mid;
  assertEquals([o.side, o.request.marketable, o.base_size], ["sell", false, 0.155]);
  assertAlmostEquals(Number(o.price), Math.max(w.revxQuote.ask, fair * (1 + hs)), 0.005);
});

Deno.test("dislocation: the loss stop and the time stop sell at the bid, and take a resting exit off the book first", async () => {
  // 40 bps under cost: the loss stop, marketable, recorded as a protective decision.
  const w0 = world();
  const cost = Math.round(w0.quote.bid * (1 + 0.0045) * 100) / 100;
  const w = world({ strategies: [dislocation()], revxQuote: { bid: w0.quote.bid, ask: w0.quote.ask }, orders: [longSince(5 * ONE_M, cost, 0.155, { strategy_id: "dislocation-1m", venue: "revx" })] });
  const r = await tick(w.deps);
  assertEquals([r.decisions[0].action, r.decisions[0].kind], ["exit", "protective"]);
  assert(r.decisions[0].reason.includes("dislocation stop"), r.decisions[0].reason);
  const o = w.mem.tables.agent_orders[1] as Row & { request: { marketable: boolean } };
  assertEquals([o.side, o.price, o.request.marketable], ["sell", w0.quote.bid, true]);

  // Forty-five minutes in, an ask resting two minutes (not yet stale) and the basis still open: the time stop cancels the ask and sells at the bid.
  const resting = seedOrder({ id: 70, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "dislocation-1m", venue: "revx", side: "sell", price: 129.5, base_size: 0.155, client_order_id: "c70" });
  const w2 = world({ strategies: [dislocation()], revxQuote: cheap(w0.quote, 5), orders: [longSince(45 * ONE_M, 128.85, 0.155, { strategy_id: "dislocation-1m", venue: "revx" }), resting] });
  const r2 = await tick(w2.deps);
  assertEquals(r2.errors, []);
  assertEquals(r2.settled, [{ id: 70, state: "cancelled" }]);
  assert(String((w2.mem.tables.agent_orders[1].response as { cancelled: string }).cancelled).includes("time stop"));
  assertEquals([r2.decisions[0].action, r2.decisions[0].kind], ["exit", "protective"]);
  const o2 = w2.mem.tables.agent_orders[2] as Row & { request: { marketable: boolean } };
  assertEquals([o2.side, o2.price, o2.request.marketable], ["sell", w2.revxQuote.bid, true]);

  // The same resting ask with the position healthy and young: left alone, the pair is busy.
  const w3 = world({ strategies: [dislocation()], revxQuote: cheap(w0.quote, 5), orders: [longSince(5 * ONE_M, 128.85, 0.155, { strategy_id: "dislocation-1m", venue: "revx" }), resting] });
  const r3 = await tick(w3.deps);
  assertEquals(r3.settled, []);
  assertEquals(r3.decisions, []);
  assert(r3.skipped.some((s) => s.includes("order in flight")));
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

// ------------------------------------------------------------ the pre-live review's findings, pinned (docs/agents/reviews/2026-09-21-prelive-review.md)

Deno.test("a live order cancelled but not readable afterwards stays OPEN: the cancel is done, what filled is the venue's to say, the next turn settles it", async () => {
  // An hour old at the touch, so the turn cancels it; the venue's order read fails both before and after the cancel.
  const live = seedOrder({ id: 12, ts: new Date(NOW - MAX_ORDER_AGE_MS).toISOString(), mode: "live", client_order_id: "c12", venue_order_id: "V-12" });
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live] });
  const r = await tick(w.deps);
  assert(w.kraken.calls.includes("cancel V-12"), w.kraken.calls.join(","));
  assertEquals(r.settled, []);
  assertEquals(w.mem.tables.agent_orders.map((o) => o.state), ["new"]);            // not "cancelled, nothing filled" on a guess
  assert(r.errors.some((e) => e.includes("could not read it back")), r.errors.join("; "));
  assert(r.skipped.some((s) => s.includes("order in flight")));
});

Deno.test("a book of more than a thousand fills is read whole: PostgREST's page is not the position", async () => {
  // 1,001 tiny buys earlier today — 1.001 BTC at 100. One page holds 1.000, and a book built from it would be wrong from then on.
  const fills: Row[] = [];
  for (let k = 0; k < PAGE_ROWS + 1; k++) fills.push(longSince(3 * ONE_H + k * 1000, 100, 0.001, { id: 5000 + k, client_order_id: `f${k}` }));
  const w = world({ orders: fills });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  const dec = w.mem.tables.agent_decisions.find((d) => (d.numbers as { kind: string }).kind === "bar")!;
  const n = dec.numbers as { exposureUsd: number; mark: number };
  assertAlmostEquals(n.exposureUsd, 1.001 * n.mark, 1e-6);
});

Deno.test("a re-quote is an order like any other: the global pause and the order-count cap refuse it, and the resting order is still taken off", async () => {
  const stale = () => seedOrder({ id: 13, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 120, base_size: 0.1, client_order_id: "c13", requotes: 1 });
  const w = world({ orders: [stale()], risk: { global_pause: true } });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 13, state: "cancelled" }]);
  assertEquals(w.mem.tables.agent_orders.map((o) => o.state), ["cancelled"]);       // nothing re-placed under the pause
  assert(r.skipped.some((s) => s.includes("re-quote refused") && s.includes("global pause")), r.skipped.join("; "));
  // The day's order budget spent (the resting order itself is today's one order): no re-quote either.
  const w2 = world({ orders: [stale()], risk: { max_orders_per_day: 1 } });
  const r2 = await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders.map((o) => o.state), ["cancelled"]);
  assert(r2.skipped.some((s) => s.includes("re-quote refused") && s.includes("orders today")), r2.skipped.join("; "));
});

Deno.test("a decision whose order never reached the book is placed on a later turn; one with an order, or one the gate now refuses, is not; two turns place once", async () => {
  // Long and healthy; an EXIT decided on this very bar, allowed, with no order row behind it (no pair config that minute, say).
  const barStart = new Date(world().lastClosedBarStart).toISOString();
  const orphan: Row = { id: 900, ts: new Date(NOW - ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", bar_start: barStart, state: {}, numbers: { orderUsd: 0, kind: "bar" }, provider: "rule", rule_action: "exit", rule_reason: "4h trend turned down", final_action: "exit", final_reason: "x", risk_allowed: true, risk_reason: "within limits" };
  const w = world({ orders: [longSince(2 * ONE_D, 128, 0.1)], decisions: [orphan] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions, []);                                                       // no new decision: the bar's claim stands with the old one
  assert(r.skipped.some((s) => s.includes("had no order; placing it now")), r.skipped.join("; "));
  const sell = w.mem.tables.agent_orders.find((o) => o.side === "sell")!;
  assertEquals([sell.decision_id, sell.requotes, sell.state], [900, 0, "new"]);
  // Next minute the order exists, so the bar is simply decided (and the pair in flight).
  const r2 = await tick({ ...w.deps, now: NOW + ONE_M });
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell").length, 1);
  assert(r2.skipped.some((s) => s.includes("already decided") || s.includes("order in flight")), r2.skipped.join("; "));
  // An orphaned ENTER meets the gate again; one the gate refuses is closed for good.
  const enter: Row = { ...orphan, id: 901, rule_action: "enter", final_action: "enter", numbers: { orderUsd: 20, kind: "bar" } };
  const w3 = world({ decisions: [enter], risk: { global_pause: true } });
  const r3 = await tick(w3.deps);
  assertEquals(w3.mem.tables.agent_orders.length, 0);
  assertEquals(w3.mem.tables.agent_decisions[0].risk_allowed, false);
  assert(r3.skipped.some((s) => s.includes("the gate now refuses it")), r3.skipped.join("; "));
  // Two turns on the same orphan: the order insert is the claim on the attempt (0041), so the second places nothing and does not throw.
  const w4 = world({ orders: [longSince(2 * ONE_D, 128, 0.1)], decisions: [orphan], raceOrder: true });
  const r4 = await tick(w4.deps);
  assertEquals(r4.errors, []);
  assertEquals(w4.mem.tables.agent_orders.filter((o) => o.decision_id === 900).map((o) => o.client_order_id), ["racer"]);
  assert(r4.skipped.some((s) => s.includes("already placed by another turn")), r4.skipped.join("; "));
});

Deno.test("a turn releases only the lease it holds: one that ran long cannot free the lease the next turn has taken", async () => {
  const w = world({ takeover: true });
  await tick(w.deps);
  const lock = w.mem.tables.agent_locks[0];
  assertEquals([lock.holder, lock.lease_until], ["the next turn", new Date(NOW + 90e3).toISOString()]);
});

Deno.test("a turn past its budget opens no new bar decision, and still runs the stops", async () => {
  // The clock jumps past the budget once the turn has started: BTC's stop (35 % under cost) still fires; ETH's bar waits a minute.
  let reads = 0;
  const clock = () => NOW + (reads++ === 0 ? 0 : TURN_BUDGET_MS + 1);
  const w = world({ strategies: [strategy({ symbols: ["BTC/USD", "ETH/USD"] })], orders: [longSince(2 * ONE_D, 200, 0.1)], series: { "BTC/USD": series(), "ETH/USD": series(1.02) } });
  const r = await tick({ ...w.deps, clock });
  assertEquals(r.decisions.map((d) => [d.symbol, d.kind, d.action]), [["BTC/USD", "protective", "exit"]]);
  assert(r.skipped.some((s) => s.includes("ETH/USD") && s.includes("over its budget")), r.skipped.join("; "));
});

Deno.test("the state's drawdown word reads the high since entry, trailed with the market — not the entry price", async () => {
  // Long from 100 two days ago; one bar inside the position's life spiked to 200; the market is near 129: 36 % off that high.
  const s = series();
  s.bars[120] = { ...s.bars[120], high: 200 };
  const w = world({ orders: [longSince(2 * ONE_D, 100, 0.1)], series: { "BTC/USD": s } });
  const r = await tick(w.deps);
  const obs = w.mem.tables.agent_observations[0].state as { drawdown_from_high: string; position: string };
  assertEquals([obs.position, obs.drawdown_from_high], ["long", "large"]);         // from the fills alone the high is 100 and the word "none"
  // The high-water IS trailed — that is what the word above proves — but since 2026-09-21 nothing sells on it between
  // bars: the intra-bar ATR trail was the rulebook's own trail read on wicks instead of closes (§3.13), so 36 % off the
  // high is now a state the rulebook decides on at the next close, not a per-minute exit. The floor is 8 % under COST,
  // and at a mark of ~129 against a cost of 100 the position is well clear of it.
  assertEquals(r.decisions.filter((d) => d.kind === "protective"), []);
});

Deno.test("no quote and no minute candle means no mark — not a mark of 0: no stop fires on it and no day loss is made of it", async () => {
  const w = world({ orders: [longSince(2 * ONE_D, 128, 0.1)], krakenNoQuote: true, krakenMinutes: [] });
  const r = await tick(w.deps);
  assertEquals(r.decisions.filter((d) => d.kind === "protective"), []);            // a mark of 0 would read as 100 % under cost
  // Against the same world WITH a quote: the missing mark costs nothing beyond the day's own move (a 0 would have added the
  // whole $12.80 position as a loss and tripped the $5 daily limit).
  const control = world({ orders: [longSince(2 * ONE_D, 128, 0.1)] });
  await tick(control.deps);
  const pnl = (w0: typeof w) => (w0.mem.tables.agent_decisions[0].numbers as { pnlToday: number }).pnlToday;
  assert(Math.abs(pnl(w) - pnl(control)) < 1, `${pnl(w)} vs ${pnl(control)}`);
});

Deno.test("a stop in the first minute of a bar does not take the bar's claim: the bar is still decided when it closes", async () => {
  const boundary = Math.floor(NOW / FOUR_H) * FOUR_H;                                 // 04:00 — the forming bar began here
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })], now: boundary + 30e3 });
  const r = await tick(w.deps);
  assertEquals([r.decisions[0].kind, r.decisions[0].action], ["protective", "exit"]);
  assertEquals(w.mem.tables.agent_decisions[0].bar_start, new Date(boundary + PROTECTIVE_CLAIM_OFFSET_MS).toISOString());
  // Four hours on, flat again (the marketable paper sell filled): the bar that began at the boundary has closed, and it is decided.
  const r2 = await tick({ ...w.deps, now: boundary + FOUR_H + 30e3 });
  const bar = w.mem.tables.agent_decisions.find((d) => (d.numbers as { kind: string }).kind === "bar");
  assert(bar, [...r2.skipped, ...r2.errors].join("; "));
  assertEquals(bar!.bar_start, new Date(boundary).toISOString());
});

Deno.test("a bid resting at the venue is exposure now: the cap counts it before it fills", async () => {
  // ETH has a $289 paper bid resting under the market; the paper cap is $300; BTC's $20 entry would take the book past it.
  const restingEth = seedOrder({ id: 14, ts: new Date(NOW - ONE_M).toISOString(), symbol: "ETH/USD", price: 128.5, base_size: 2.25, client_order_id: "c14" });
  const w = world({ strategies: [strategy({ symbols: ["BTC/USD", "ETH/USD"] })], orders: [restingEth], series: { "BTC/USD": series(), "ETH/USD": series() } });
  const r = await tick(w.deps);
  const btc = r.decisions.find((d) => d.symbol === "BTC/USD")!;
  assertEquals([btc.action, btc.allowed], ["enter", false]);
  assert(w.mem.tables.agent_decisions.some((d) => String(d.risk_reason).includes("exposure")), JSON.stringify(w.mem.tables.agent_decisions.map((d) => d.risk_reason)));
  assertEquals(w.mem.tables.agent_orders.length, 1);                                  // the resting bid only
});

Deno.test("the execution venue's minute candle is fetched only where a paper order rests, never for a marketable one", async () => {
  const w = world({ orders: [seedOrder({ price: 120 })] });
  await tick(w.deps);
  assert(w.kraken.calls.includes("candles BTC/USD 1"), w.kraken.calls.join(","));
  const w2 = world({ orders: [seedOrder({ request: { marketable: true } })] });
  await tick(w2.deps);
  assert(!w2.kraken.calls.includes("candles BTC/USD 1"), w2.kraken.calls.join(","));
  assertEquals(w2.mem.tables.agent_orders[0].state, "filled");                        // a marketable paper order fills without it
});


// ── the maker probe (migration 0042) ────────────────────────────────────────
// Revolut X is 0 % maker and the loop crosses the touch, so "why not rest everything" is the
// standing question. §3.13 could not answer it because a backtest on Coinbase candles with a
// synthetic bid says a resting order fills instantly. The probe answers it on the real book
// without resting anything: it records where an order WOULD have sat, whether the market came
// back, and where price went after it did. It must never become an order or reach any book.

Deno.test("probeFilled: a resting buy fills when the minute traded through it, a sell when it traded up to it", () => {
  const c = (low: number, high: number): Candle => ({ start: 0, open: low, high, low, close: high, volume: 1 });
  assert(probeFilled("buy", 100, c(99.5, 101)));           // the minute dipped to the bid
  assert(probeFilled("buy", 100, c(100, 101)));            // touching counts, as it does for a paper order
  assert(!probeFilled("buy", 100, c(100.1, 101)));         // never came back
  assert(probeFilled("sell", 100, c(99, 100.5)));
  assert(!probeFilled("sell", 100, c(98, 99.9)));
  assertEquals(probeFilled("buy", 100, null), false);      // no minute candle is not a fill
});

Deno.test("probeFollowUpDue: the earliest outstanding offset, one per turn, and nothing before it is due", () => {
  const [m15, m60] = PROBE_FOLLOW_UP_MS;
  assertEquals(probeFollowUpDue(0, null, m15 - 1), null);           // not yet
  assertEquals(probeFollowUpDue(0, null, m15), "m15");
  assertEquals(probeFollowUpDue(0, null, m60), "m15");              // catches up one at a time, earliest first
  assertEquals(probeFollowUpDue(0, { m15: 1 }, m60), "m60");
  assertEquals(probeFollowUpDue(0, { m15: 1 }, m60 - 1), null);
  assertEquals(probeFollowUpDue(0, { m15: 1, m60: 2 }, m60 * 10), null);   // finished
});

Deno.test("a marketable Revolut X order opens a probe at the OTHER side's touch, and the probe is not an order", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.probes.opened, 1);
  const p = w.mem.tables.agent_maker_probes[0] as Row;
  assertEquals([p.venue, p.symbol, p.side, p.state, p.watching], ["revx", "BTC/USD", "buy", "resting", true]);
  // The order crossed to the ask; the probe records the bid it would have rested at instead.
  assertEquals(p.taker_price, w.mem.tables.agent_orders[0].price);
  assertEquals(p.maker_price, w.revxQuote.bid);
  assert(Number(p.maker_price) < Number(p.taker_price), `${p.maker_price} !< ${p.taker_price}`);
  assertEquals(p.expires_at, new Date(NOW + PROBE_TTL_MS).toISOString());
  // It is a notebook, not an order: one order on record, and the venue was never asked twice.
  assertEquals(w.mem.tables.agent_orders.length, 1);
  assert(!w.revx.calls.some((c) => c.startsWith("place")));
});

Deno.test("a resting probe resolves against the minute: filled when the market came back, expired when it did not", async () => {
  const seed = (over: Record<string, unknown> = {}) => ({
    id: 7, ts: new Date(NOW - 30 * 60e3).toISOString(), strategy_id: "trend-4h-kraken", order_id: null,
    venue: "kraken", symbol: "BTC/USD", side: "buy", mode: "paper", taker_price: 200, maker_price: 100,
    base_size: 0.1, state: "resting", resolved_at: null, minutes_to_fill: null, mark_at_resolve: null,
    follow_up: {}, expires_at: new Date(NOW + PROBE_TTL_MS).toISOString(), watching: true, ...over,
  });
  // The minute traded down through 100 → filled, with the wait recorded.
  const hit = world({ probes: [seed()], oneMin: { low: 99 } });
  const r1 = await tick(hit.deps);
  assertEquals(r1.errors, []);
  assertEquals([r1.probes.filled, r1.probes.expired], [1, 0]);
  const f = hit.mem.tables.agent_maker_probes[0];
  assertEquals([f.state, f.minutes_to_fill], ["filled", 30]);
  assert(f.resolved_at != null && f.mark_at_resolve != null);

  // Same probe, but the market never came back and its four hours are up.
  const dead = world({ probes: [seed({ expires_at: new Date(NOW - 1).toISOString() })], oneMin: { low: 128 } });
  const r2 = await tick(dead.deps);
  assertEquals([r2.probes.filled, r2.probes.expired], [0, 1]);
  const e = dead.mem.tables.agent_maker_probes[0];
  assertEquals([e.state, e.minutes_to_fill], ["expired", null]);

  // Neither one touched a position, an order or the book.
  for (const w of [hit, dead]) assertEquals(w.mem.tables.agent_orders.filter((o) => o.id === 7).length, 0);
});

Deno.test("a resolved probe collects its follow-up marks, and the last one stops it being watched", async () => {
  const [m15, m60] = PROBE_FOLLOW_UP_MS;
  const base = {
    id: 8, ts: new Date(NOW - 120 * 60e3).toISOString(), strategy_id: "trend-4h-kraken", order_id: null,
    venue: "kraken", symbol: "BTC/USD", side: "buy", mode: "paper", taker_price: 200, maker_price: 100,
    base_size: 0.1, state: "filled", minutes_to_fill: 5, mark_at_resolve: 100,
    expires_at: new Date(NOW).toISOString(), watching: true,
  };
  const first = world({ probes: [{ ...base, resolved_at: new Date(NOW - m15).toISOString(), follow_up: {} }] });
  const r1 = await tick(first.deps);
  assertEquals(r1.probes.followedUp, 1);
  const a = first.mem.tables.agent_maker_probes[0] as Row & { follow_up: Record<string, number> };
  assertEquals(Object.keys(a.follow_up), ["m15"]);
  assertEquals(a.watching, true);                      // m60 is still to come

  const second = world({ probes: [{ ...base, resolved_at: new Date(NOW - m60).toISOString(), follow_up: { m15: 101 } }] });
  const r2 = await tick(second.deps);
  assertEquals(r2.probes.followedUp, 1);
  const b = second.mem.tables.agent_maker_probes[0] as Row & { follow_up: Record<string, number> };
  assertEquals(Object.keys(b.follow_up).sort(), ["m15", "m60"]);
  assertEquals(b.watching, false);                     // finished: never read again
});

// ── winding down: a retired row that still holds something ─────────────────────────────────
// `0038` retired `dislocation-1m` flat and nothing was left behind, which is why nobody noticed.
// `0043` retired three rows that were still long, and under the old rule their positions had
// nowhere to go: the tick skipped the row, so no floor and no rule exit ran, and the page hid it.
// A position does not stop being a position because its row was switched off.

Deno.test("a retired row that still holds a position keeps its floor: the stop fires and the row is reported winding down", async () => {
  const retired = strategy({ id: "rotation-1d", kind: "rotation-1d", mode: "paused", retired_at: new Date(NOW - ONE_D).toISOString() });
  // Long at 200 against a mark near 129: ~35 % under cost, far through the 8 % floor.
  const w = world({ strategies: [retired], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "rotation-1d" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.windingDown, ["rotation-1d"]);
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals(protective.length, 1);
  assertEquals([protective[0].strategy, protective[0].action], ["rotation-1d", "exit"]);
  assert(protective[0].reason.startsWith("protective floor"), protective[0].reason);
  // It sold. That is the whole point: the position had somewhere to go.
  const o = w.mem.tables.agent_orders.find((x) => x.id !== 50);
  assertEquals([o?.strategy_id, o?.side], ["rotation-1d", "sell"]);
});

Deno.test("a retired row can never buy again, however good the bar looks", async () => {
  // The same world that makes a live row enter — but the row is retired and flat.
  const retired = strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken", mode: "paused", retired_at: new Date(NOW - ONE_D).toISOString() });
  const w = world({ strategies: [retired] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.windingDown, []);                                  // flat: nothing to wind down
  assertEquals(r.decisions, []);                                    // and nothing decided at all
  assertEquals(w.mem.tables.agent_orders, []);

  // And when it DOES hold something, the entry is still refused while the exits run.
  const holding = world({
    strategies: [retired],
    orders: [longSince(2 * ONE_D, 128, 0.1, { strategy_id: "trend-4h", venue: "revx" })],
  });
  const r2 = await tick(holding.deps);
  assertEquals(r2.windingDown, ["trend-4h"]);
  assertEquals(r2.decisions.filter((d) => d.action === "enter"), []);
  assert(!holding.mem.tables.agent_orders.some((o) => o.id !== 50 && o.side === "buy"),
    JSON.stringify(holding.mem.tables.agent_orders.map((o) => [o.id, o.side])));
});

Deno.test("a retired row that is flat costs a turn nothing: it is skipped before any decision work", async () => {
  const flat = strategy({ id: "dislocation-1m", mode: "paused", retired_at: new Date(NOW - ONE_D).toISOString() });
  const live = strategy({ id: "trend-4h-kraken" });
  const w = world({ strategies: [flat, live] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.windingDown, []);
  // The live row still did its work; the retired one contributed nothing.
  assertEquals(r.decisions.map((d) => d.strategy), ["trend-4h-kraken"]);
  assertEquals(w.mem.tables.agent_observations.every((o) => o.strategy_id === "trend-4h-kraken"), true);
});
