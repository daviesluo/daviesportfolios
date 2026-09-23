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
import { JEV_QUESTION_VERSION, jevQuestions, positionFromFills, type Candle, type CategoricalState } from "../_shared/agents_strategy.ts";
import type { OrderView, Quote, Venue, VenueId } from "../_shared/venue.ts";
import { orderViewProblem, toOrderView, type VenueOrder } from "../_shared/revx.ts";
import { PAGE_ROWS } from "./db.ts";
import { jevFetch, memDb, schemaRefusal } from "./testing.ts";
import { rowQuestions } from "./jev_rows.ts";
import { dayOpenOf, dayPnl, entryTooLate, fillStamp, isUniqueViolation, LEASE_MS, MAX_ORDER_AGE_MS, MAX_REQUOTES, PROBE_FOLLOW_UP_MS, PROBE_TTL_MS, probeFilled, probeFollowUpDue, PROTECTIVE_CLAIM_OFFSET_MS, REQUOTE_AFTER_MS, tick, toFill, TURN_BUDGET_MS, type OrderRow, type RiskRow, type StrategyRow, exitMark, spreadBps, WIDE_SPREAD_BPS, slotUsdOf, ORDER_SLOT_TOLERANCE } from "./tick.ts";

const FOUR_H = 4 * 3600e3, ONE_H = 3600e3, ONE_D = 86400e3, ONE_M = 60e3;
const NOW = Date.parse("2026-09-20T04:05:00Z");                 // minute 245 of the day: a fifth minute, so the basis is recorded
const PAIR = { base_step: "0.000001", quote_step: "0.01", min_order_size: "0.001", min_order_size_quote: "0.5" };

// A steady rise: every closed bar breaks the prior high, SMA20 sits well
// above SMA100, daily momentum is positive, volatility is tiny. `dailyRate`
// lets one symbol out-run another for the rotation rule.
function series(dailyRate = 1.01, barMs = FOUR_H, count = 130): { bars: Candle[]; c1d: Candle[]; lastClose: number } {
  const lastBarStart = Math.floor(NOW / barMs) * barMs;      // the still-open bar
  const bars: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 * Math.pow(1.002, i - (count - 130));    // the last 130 bars are the same whatever the count
    bars.push({ start: lastBarStart - (count - 1 - i) * barMs, open: close / 1.002, high: close * 1.0005, low: close / 1.002 * 0.9995, close, volume: 1 });
  }
  const lastDayStart = Math.floor(NOW / ONE_D) * ONE_D;
  const c1d: Candle[] = [];
  for (let i = 0; i < 130; i++) {
    const close = 100 * Math.pow(dailyRate, i);
    c1d.push({ start: lastDayStart - (129 - i) * ONE_D, open: close / dailyRate, high: close * 1.002, low: close / dailyRate * 0.998, close, volume: 1 });
  }
  return { bars, c1d, lastClose: bars[count - 2].close };
}

type Row = Record<string, unknown>;

// The in-memory database is `testing.ts`'s: ONE double, shared with every agents test, holding the schema's rules on
// INSERT and UPDATE alike (see there for why that is not optional).

type SeriesBySymbol = Record<string, { bars: Candle[]; c1d: Candle[]; bars1h?: Candle[] }>;

function stubVenue(id: VenueId, o: {
  series: SeriesBySymbol; c1m: Candle[]; quote: Quote; feeBps: { maker: number; taker: number }; canTrade: boolean;
  orderView?: OrderView; orderViews?: OrderView[]; cancelOk?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>;
  /** The venue's raw order JSON: read back through the REAL Revolut X `orderViewProblem` / `toOrderView`, exactly as `revxVenue.order` does. */
  orderReply?: VenueOrder;
  onPlace?: () => void; placedState?: "new" | "filled"; noQuote?: boolean; candlesDown?: () => boolean; balances?: Record<string, number>;
}) {
  const calls: string[] = [];
  const v: Venue = {
    id, canTrade: o.canTrade, feeBps: o.feeBps,
    candles: (sym, iv) => {
      calls.push(`candles ${sym} ${iv}`);
      if (o.candlesDown?.()) return Promise.reject(new Error(`${id} OHLC ${iv}m → EService:Unavailable`));
      const s = o.series[sym] ?? o.series["BTC/USD"];
      return Promise.resolve(iv === 240 ? s.bars : iv === 60 ? (s.bars1h ?? s.bars) : iv === 1440 ? s.c1d : o.c1m);
    },
    quotes: (syms) => Promise.resolve(o.noQuote ? {} : Object.fromEntries(syms.map((s) => [s, o.quote]))),
    pairs: (syms) => Promise.resolve(Object.fromEntries(syms.map((s) => [s, PAIR]))),
    placeLimit: (req) => { o.onPlace?.(); calls.push(`place ${req.side} ${req.base}@${req.price}${req.marketable ? " taker" : ""}`); return Promise.resolve({ ok: true as const, venueOrderId: "V-1", state: o.placedState ?? "new" as const, response: { echo: req } }); },
    cancel: (vid) => { calls.push(`cancel ${vid}`); return Promise.resolve({ ok: o.cancelOk ?? true }); },
    order: (vid) => {
      calls.push(`order ${vid}`);
      if (o.orderReply) {
        const problem = orderViewProblem(o.orderReply);
        return Promise.resolve(problem ? { ok: false as const, error: problem } : { ok: true as const, view: toOrderView(o.orderReply) });
      }
      const view = o.orderViews?.length ? o.orderViews.shift() : o.orderView;   // a sequence, one view per read, when a test needs the venue to change its mind
      return Promise.resolve(view ? { ok: true as const, view } : { ok: false as const, error: "no view" });
    },
    balances: () => { calls.push("balances"); return Promise.resolve({ ...(o.balances ?? {}) }); },
    activeOrders: () => { calls.push("activeOrders"); return Promise.resolve({ ok: true as const, byClientId: o.active ?? {} }); },
  };
  return { v, calls };
}

// Jev is `testing.ts`'s double: "healthy, calm, and yes that symbol" to exactly the questions asked — or a 503, with `fail`.

const RISK: RiskRow & { id: number } = { id: 1, global_pause: false, max_exposure_usd: 100, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: null };
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
  orderView?: OrderView; orderViews?: OrderView[]; jevDown?: boolean; active?: Record<string, { venueOrderId: string; view: OrderView }>; onPlace?: () => void;
  series?: SeriesBySymbol; revxQuote?: Quote; now?: number; krakenMinutes?: Candle[]; leaseUntil?: string; raceClaim?: boolean; placedState?: "new" | "filled";
  krakenNoQuote?: boolean; raceOrder?: boolean; takeover?: boolean; probes?: Row[]; krakenCandlesDown?: () => boolean;
  /** A LIVE-capable Revolut X stub: credentials, the venue's balances, one order view, what a placement replies. */
  revxCanTrade?: boolean; revxBalances?: Record<string, number>; revxOrderView?: OrderView; revxPlacedState?: "new" | "filled"; revxNoQuote?: boolean;
  revxOrderReply?: VenueOrder;
} = {}) {
  const now = opts.now ?? NOW;
  const base = series();
  const ser: SeriesBySymbol = opts.series ?? { "BTC/USD": base };
  const quote = { bid: Math.round(base.lastClose * 100) / 100, ask: Math.round(base.lastClose * 100) / 100 + 0.1 };
  const m1start = Math.floor(now / ONE_M) * ONE_M - ONE_M;
  const c1m: Candle[] = [{ start: m1start, open: quote.bid, high: quote.bid + 0.05, low: quote.bid - 0.05, close: quote.bid, volume: 1, ...opts.oneMin }];
  const jevLog: string[] = [];
  const kraken = stubVenue("kraken", { series: ser, c1m: opts.krakenMinutes ?? c1m, quote, feeBps: { maker: 40, taker: 80 }, canTrade: opts.canTrade ?? false, orderView: opts.orderView, orderViews: opts.orderViews, active: opts.active, onPlace: opts.onPlace, placedState: opts.placedState, noQuote: opts.krakenNoQuote, candlesDown: opts.krakenCandlesDown });
  const revxQuote = opts.revxQuote ?? { bid: quote.bid + 0.02, ask: quote.ask + 0.02 };
  const revx = stubVenue("revx", { series: ser, c1m, quote: revxQuote, feeBps: { maker: 0, taker: 9 }, canTrade: opts.revxCanTrade ?? false, balances: opts.revxBalances, orderView: opts.revxOrderView, orderReply: opts.revxOrderReply, placedState: opts.revxPlacedState, noQuote: opts.revxNoQuote });
  const mem = memDb({
    agent_risk: [{ ...RISK, ...opts.risk }],
    agent_strategies: (opts.strategies ?? [strategy()]) as unknown as Row[],
    agent_orders: opts.orders ?? [],
    agent_decisions: opts.decisions ?? [],
    agent_observations: opts.observations ?? [],
    agent_maker_probes: opts.probes ?? [],
    agent_locks: [{ name: "tick", lease_until: opts.leaseUntil ?? "1970-01-01T00:00:00.000Z", holder: null }],
  }, { now: () => NOW, hooks: {
    // The race: another tick claims the same bar between this tick's fast check and its insert — or, with `takeover`, the next
    // turn takes the LEASE over while this one is still running (as it would once this one's lease had expired).
    beforeDecisionInsert: opts.raceClaim ? (tables, row) => { (tables.agent_decisions ??= []).push({ id: 1, ts: new Date(NOW - 1000).toISOString(), strategy_id: row.strategy_id, symbol: row.symbol, bar_start: row.bar_start }); }
      : opts.takeover ? (tables) => { tables.agent_locks = [{ name: "tick", lease_until: new Date(NOW + 90e3).toISOString(), holder: "the next turn" }]; }
      : undefined,
    // Another turn places this decision's order between this turn's check and its insert.
    beforeOrderInsert: opts.raceOrder ? (tables, row) => { if (row.decision_id != null) (tables.agent_orders ??= []).push({ id: 1, ts: new Date(NOW - 1000).toISOString(), strategy_id: row.strategy_id, venue: row.venue, symbol: row.symbol, mode: row.mode, side: row.side, price: row.price, base_size: row.base_size, client_order_id: "racer", decision_id: row.decision_id, requotes: row.requotes, state: "new", filled_base: 0, fee_usd: 0, request: row.request }); } : undefined,
  } });
  // A fresh uuid per call, as `crypto.randomUUID` gives production: `client_order_id` is unique (0037), and the double
  // holds the loop to it — every order in a world used to carry the same id, so no test could tell two apart by it.
  let uuidN = 0;
  const deps = { db: mem.db, venues: { kraken: kraken.v, revx: revx.v }, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({ fail: opts.jevDown, log: jevLog }), uuid: () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}` };
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
  assertAlmostEquals(Number(o.base_size) * w.quote.bid, 60, 0.01);     // capital 60 over one symbol: the slot is the row (under the old $20 cap, 20)
  assertEquals([o.request.postOnly, o.request.marketable], [true, false]);
  assert(!w.kraken.calls.some((c) => c.startsWith("place")));           // paper: the venue is never asked to place
  assert(w.mem.tables.agent_candles.length > 200);
  assertEquals(w.mem.tables.agent_candles[0].venue, "kraken");
  assert(!w.kraken.calls.includes("candles BTC/USD 1"));                // no paper order rests, so the execution venue's minute — whose one reader is a resting paper fill — is not fetched
  const lock = w.mem.tables.agent_locks[0];
  assertEquals([lock.lease_until, lock.holder], [new Date(NOW).toISOString(), null]);   // the lease was taken and given back
});

Deno.test("an entry decision records which wording of the question the model was asked, and asks it for the rule's own kind", async () => {
  const asked: string[] = [];
  const w = world();
  const inner = w.deps.fetchImpl;
  w.deps.fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    asked.push(String((JSON.parse(String(init?.body)) as { questions: { healthy_trend: { instructions: string } } }).questions.healthy_trend.instructions));
    return inner(url, init);
  }) as typeof fetch;
  const r = await tick(w.deps);
  assertEquals(r.decisions.map((d) => d.action), ["enter"]);
  assertEquals((w.mem.tables.agent_decisions[0].numbers as { jevQuestion: string }).jevQuestion, JEV_QUESTION_VERSION);
  assertEquals(asked.length, 1);
  assertEquals(asked[0], jevQuestions(w.mem.tables.agent_decisions[0].state as unknown as CategoricalState, { kind: "trend-4h" }).healthy_trend.instructions);
});

Deno.test("a row asks its OWN wording only when params.jevQuestion names one written for its rule, and records which it asked", async () => {
  // trend-1h with its row wording (jev_rows.ts): the model is asked that text and the decision says so. The same row
  // without the name, and a trend-4h row naming trend-1h's wording, both ask v2 — a wording is never put to another rule.
  const hourly = series(1.01, ONE_H);
  const run = async (row: StrategyRow) => {
    const asked: string[] = [];
    const w = world({ strategies: [row], series: { "BTC/USD": { bars: hourly.bars, c1d: hourly.c1d, bars1h: hourly.bars } } });
    const inner = w.deps.fetchImpl;
    w.deps.fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      asked.push(String((JSON.parse(String(init?.body)) as { questions: { healthy_trend: { instructions: string } } }).questions.healthy_trend.instructions));
      return inner(url, init);
    }) as typeof fetch;
    const r = await tick(w.deps);
    assertEquals(r.errors, []);
    const dec = w.mem.tables.agent_decisions[0];
    return { asked, version: (dec.numbers as { jevQuestion: string }).jevQuestion, state: dec.state as unknown as CategoricalState };
  };
  const base = strategy({ id: "trend-1h", kind: "trend-1h", venue: "revx", signal_venue: "kraken" });
  const own = await run({ ...base, params: { ...base.params, jevQuestion: "v3-trend-1h" } });
  assertEquals(own.version, "v3-trend-1h");
  assertEquals(own.asked, [rowQuestions(own.state, "v3-trend-1h").healthy_trend.instructions]);
  const plain = await run(base);
  assertEquals(plain.version, JEV_QUESTION_VERSION);
  assertEquals(plain.asked, [jevQuestions(plain.state, { kind: "trend-1h" }).healthy_trend.instructions]);
  const wrongRule = await run({ ...strategy(), params: { ...strategy().params, jevQuestion: "v3-trend-1h" } });
  assertEquals(wrongRule.version, JEV_QUESTION_VERSION);
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
  // Three minutes old, resting 7 % under the bid: cancelled and re-quoted at the bid with the count up one. (It carries the
  // decision it came from, as every order the loop places does; a decisionless one is not re-quoted — see below.)
  const w = world({ orders: [seedOrder({ id: 7, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 120, base_size: 0.1, client_order_id: "c7", requotes: 2, decision_id: 77 })] });
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

Deno.test("a live entry is refused while live_confirmed_at is null — RECORDED as refused, and not retried every minute", async () => {
  // Until 2026-09-22 this test pinned the dishonest record: the gate "allowed" the entry, `place()` refused it with an
  // error, and the retry path — seeing an allowed decision with no order — tried again every minute for the rest of the bar.
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true });
  const r = await tick(w.deps);
  assertEquals([r.decisions[0].action, r.decisions[0].allowed], ["enter", false]);
  const dec = w.mem.tables.agent_decisions[0];
  assertEquals(dec.risk_allowed, false);
  assert(String(dec.risk_reason).includes("live_confirmed_at"), String(dec.risk_reason));
  assertEquals(r.errors, []);                                                // a refusal on the record, not an error every minute
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assert(!w.kraken.calls.some((c) => c.startsWith("place")));
  // The next minute: the bar is decided and refused, so nothing is retried, placed or reported.
  const r2 = await tick({ ...w.deps, now: NOW + ONE_M });
  assertEquals([r2.decisions.length, r2.errors.length, w.mem.tables.agent_orders.length], [0, 0, 0]);
  assert(r2.skipped.some((s) => s.includes("already decided")), r2.skipped.join("; "));
});

Deno.test("the retry of an entry that never reached the book passes the SAME gates as a fresh one: the confirmation and the thin-book guard", async () => {
  // Decided and allowed while the confirmation was set; no order came of it (no pair config that minute, say).
  const barStart = new Date(world().lastClosedBarStart).toISOString();
  const orphan = (id: number): Row => ({ id, ts: new Date(NOW - ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "live", bar_start: barStart, state: {}, numbers: { orderUsd: 20, kind: "bar" }, provider: "openrouter", rule_action: "enter", rule_reason: "breakout", final_action: "enter", final_reason: "x", risk_allowed: true, risk_reason: "within limits" });
  // (a) The confirmation is cleared before the retry: the decision is closed with the reason, nothing is placed.
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, decisions: [orphan(910)] });
  const r = await tick(w.deps);
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assertEquals(w.mem.tables.agent_decisions[0].risk_allowed, false);
  assert(String(w.mem.tables.agent_decisions[0].risk_reason).includes("live_confirmed_at"), String(w.mem.tables.agent_decisions[0].risk_reason));
  assertEquals(r.errors, []);
  // (b) Confirmed, but the book it would cross is 150 bps wide: the fresh path would have held; so does the retry.
  const wide = { bid: 100, ask: 100 * (1 + WIDE_SPREAD_BPS / 1e4 * 3) };
  const w2 = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "paper" })], decisions: [{ ...orphan(911), strategy_id: "trend-4h", venue: "revx", mode: "paper" }], revxQuote: wide });
  await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders.length, 0);
  assert(String(w2.mem.tables.agent_decisions[0].risk_reason).includes("book too wide"), String(w2.mem.tables.agent_decisions[0].risk_reason));
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
  const base = (Math.floor(60 / w.quote.bid * 1e6) / 1e6).toFixed(6);   // one slot: capital 60 over one symbol
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
  // The stop fires. The working BUY cannot be cancelled in this world, and since 2026-09-22 that is no longer a
  // reason to stand down: a buy is not the exit, so the stop says what it is stepping past and sells what is held.
  // (Here the sell fails too, for the same missing credentials — the turn reports both rather than going quiet.)
  assert(r.errors.some((e) => e.includes("stopping out past a buy in flight")), r.errors.join("; "));
  assert(r.errors.some((e) => e.includes("no revx credentials")), r.errors.join("; "));
  assert(!r.skipped.some((s) => s.includes("stop wants out")), r.skipped.join("; "));
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

Deno.test("the cooldown is the rulebook's, not a book's: a row set to paper right after its LIVE exit does not buy on paper the next bar", async () => {
  // Bought for real three days ago, sold for real four hours ago, and the row has since been set to `paper`. Its paper book
  // is empty, so a cooldown read from the resolved book alone saw no exit at all and bought on the next bar (review R, #15).
  const liveBuy = longSince(3 * ONE_D, 120, 0.155, { mode: "live" });
  const liveSale = longSince(FOUR_H, 129.0, 0.155, { id: 61, side: "sell", mode: "live" });
  const w = world({ strategies: [strategy({ mode: "paper" })], orders: [liveBuy, liveSale] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals([r.decisions[0].action, r.decisions[0].kind, w.mem.tables.agent_decisions[0].mode], ["hold", "bar", "paper"]);
  assert(r.decisions[0].reason.includes("cooling down"), r.decisions[0].reason);
  assertEquals(w.mem.tables.agent_orders.length, 2);                                   // no paper buy beside the live exit
  // The other way too: a paper exit four hours ago holds the first entry of a row switched to live in place.
  const w2 = world({
    strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(3 * ONE_D, 120, 0.155), longSince(FOUR_H, 129.0, 0.155, { id: 61, side: "sell" })],
  });
  const r2 = await tick(w2.deps);
  assertEquals([r2.decisions[0].action, w2.mem.tables.agent_decisions[0].mode], ["hold", "live"]);
  assert(r2.decisions[0].reason.includes("cooling down"), r2.decisions[0].reason);
  assertEquals(w2.mem.tables.agent_orders.length, 2);
});

Deno.test("paper twins are capped by their own exposure number, so they do not crowd each other out", async () => {
  const w = world({ risk: { max_exposure_usd: 10, paper_exposure_usd: 300 } });   // the live cap would refuse a $60 paper order
  const r = await tick(w.deps);
  assertEquals(r.decisions[0].allowed, true);
  assertEquals(w.mem.tables.agent_orders.length, 1);
  const w2 = world({ risk: { max_exposure_usd: 10, paper_exposure_usd: null } });  // no paper number: the live cap applies
  const r2 = await tick(w2.deps);
  assertEquals(r2.decisions[0].allowed, false);
  assert(String(w2.mem.tables.agent_decisions[0].risk_reason).includes("exposure"));
});

Deno.test("an entry is one slot of its row — its capital over the positions it can hold — with no fixed cap on top", async () => {
  // Four coins on $100 is four $25 slots. Until 2026-09-23 a fixed per-order cap (`agent_risk.max_order_usd`, $20) sat on
  // top, so every slot came out at $20 whatever the row's capital said, and this row placed four $20 orders.
  const syms = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"];
  const w = world({ strategies: [strategy({ symbols: syms, capital_usd: 100 })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.map((x) => [x.symbol, x.action, x.allowed]), syms.map((s) => [s, "enter", true]));
  assertEquals(w.mem.tables.agent_orders.length, 4);
  for (const o of w.mem.tables.agent_orders) assertAlmostEquals(Number(o.base_size) * Number(o.price), 25, 0.01);
  // The positions a row can hold at once: its symbols, or the rotation's topN.
  assertEquals(slotUsdOf({ kind: "trend-4h", symbols: syms, capital_usd: 100, params: {} }), 25);
  assertEquals(slotUsdOf({ kind: "rotation-1d", symbols: syms, capital_usd: 40, params: { topN: 2 } }), 20);
});

Deno.test("an entry more than ORDER_SLOT_TOLERANCE over its row's slot is refused; a re-quote's drift inside it is not", async () => {
  // (a) Decided at $60 with no order behind it, and the row cut to $30 since: the retry carries its recorded size into the
  // gate, twice the new slot, and the decision is closed instead of placed. Nothing else stands between a sizing bug and the book.
  const barStart = new Date(world().lastClosedBarStart).toISOString();
  const orphan = (id: number, orderUsd: number): Row => ({ id, ts: new Date(NOW - ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", bar_start: barStart, state: {}, numbers: { orderUsd, kind: "bar" }, provider: "rule", rule_action: "enter", rule_reason: "x", final_action: "enter", final_reason: "x", risk_allowed: true, risk_reason: "within limits" });
  const w = world({ strategies: [strategy({ capital_usd: 30 })], decisions: [orphan(930, 60)] });
  await tick(w.deps);
  assertEquals(w.mem.tables.agent_orders.length, 0);
  assert(String(w.mem.tables.agent_decisions[0].risk_reason).includes(`order 60.00 > max ${30 * ORDER_SLOT_TOLERANCE}`), String(w.mem.tables.agent_decisions[0].risk_reason));
  // (b) $32 against the same $30 slot is inside the tolerance: placed, at its recorded size.
  const w2 = world({ strategies: [strategy({ capital_usd: 30 })], decisions: [orphan(931, 32)] });
  await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders.length, 1);
  assertAlmostEquals(Number(w2.mem.tables.agent_orders[0].base_size) * Number(w2.mem.tables.agent_orders[0].price), 32, 0.02);
  // (c) A full $20 slot resting 50 bps under a touch that has moved up is re-quoted at the touch: $20.10 now. With the cap
  // equal to the slot, as the fixed $20 made it on every $20 row, the gate refused exactly this re-quote.
  const bid = world().quote.bid;
  const w3 = world({ strategies: [strategy({ capital_usd: 20 })], orders: [seedOrder({ id: 12, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 128.5, base_size: Math.floor(20 / 128.5 * 1e6) / 1e6, client_order_id: "c12", decision_id: 78 })] });
  const r3 = await tick(w3.deps);
  assertEquals(r3.settled, [{ id: 12, state: "cancelled" }]);
  const re = w3.mem.tables.agent_orders.find((o) => o.requotes === 1);
  assert(re, `no re-quote: ${r3.skipped.join("; ")}`);
  assertEquals(re.price, bid);
  assert(Number(re.base_size) * bid > 20, String(Number(re.base_size) * bid));
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
  assertAlmostEquals(Number(orders[0].base_size) * Number(orders[0].price), 60, 0.02);   // one slot: capital 60 / topN 1
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
  assertAlmostEquals(Number(o.base_size) * Number(o.price), 40, 0.02);      // capital 40 over one symbol
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

// ── the thin-book guard (ledger item 0b) ───────────────────────────────────────────────────
// Two halves, and they point opposite ways on purpose. A stop judges itself on the BID, because
// that is the only price a long position can actually be closed at — judging on the mid says a
// position is above its floor while the money available for it is below. An ENTRY is refused when
// the book is too wide to cross, because every Revolut X entry pays the ask. Never the reverse: a
// stop exists for exactly the minute the book is ugly.

Deno.test("exitMark: a long position's stop is judged at the bid, and falls back to the candle mark", () => {
  assertEquals(exitMark({ mark: 100.5, quote: { bid: 100, ask: 101 } }), 100);   // the mid flatters by half a spread
  assertEquals(exitMark({ mark: 99 }), 99);                                      // no quote: the candle stands
  assertEquals(exitMark({ mark: null }), null);
});

Deno.test("spreadBps: the book's width, and null when there is nothing to measure", () => {
  assertAlmostEquals(spreadBps({ bid: 100, ask: 100.1 })!, 9.995, 1e-3);   // 0.1 over the 100.05 MID, not the bid
  assertEquals(Math.round(spreadBps({ bid: 100, ask: 102 })!), 198);
  assertEquals(spreadBps(undefined), null);
  assertEquals(spreadBps({ bid: 0, ask: 1 }), null);
});

Deno.test("a book too wide to cross refuses the ENTRY and records its width; the stop is never refused", async () => {
  // The world that normally enters, with the book blown out well past the ceiling.
  const wide = { bid: 100, ask: 100 * (1 + WIDE_SPREAD_BPS / 1e4 * 3) };
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })], revxQuote: wide });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions[0].action, "hold");
  assert(r.decisions[0].reason.includes("book too wide to cross"), r.decisions[0].reason);
  assertEquals(w.mem.tables.agent_orders, []);
  // The width is on the decision row, so the refusal is auditable rather than invisible.
  const n = w.mem.tables.agent_decisions[0].numbers as { bookBps: number };
  assertEquals(Math.round(n.bookBps), Math.round(spreadBps(wide)!));

  // Same blown-out book, but the position is 35 % under cost: the stop still fires.
  const held = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })],
    revxQuote: wide,
    orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })],
  });
  const r2 = await tick(held.deps);
  const protective = r2.decisions.filter((d) => d.kind === "protective");
  assertEquals(protective.length, 1);
  assertEquals(protective[0].action, "exit");
  assert(protective[0].reason.startsWith("protective floor"), protective[0].reason);
});

Deno.test("a row switched from paper to live starts FLAT: it never sells, for real, coins it only ever bought on paper", async () => {
  // Long at 200 on PAPER against a mark near 129 — 35 % under cost, far through the 8 % floor. The row is
  // live now. Until 2026-09-22 a position was keyed on strategy|symbol alone, so the live row read itself
  // long, would never have bought the coin for real, and the first time the floor fired would have placed a
  // REAL sell at Revolut X for base the account never held. The mode is part of the key: the paper book is
  // the paper book.
  // (The venue is beside the point here — this is the stub that holds credentials.)
  const live = strategy({ mode: "live" });
  const w = world({
    strategies: [live], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "paper" })],
  });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.decisions.filter((d) => d.kind === "protective"), []);          // nothing to protect: it holds nothing live
  assert(!w.mem.tables.agent_orders.some((o) => o.id !== 50 && o.side === "sell"),
    JSON.stringify(w.mem.tables.agent_orders.map((o) => [o.id, o.side, o.mode])));
  // Reading flat is not the same as doing nothing: the fresh bar is its own to enter, with live money.
  const buys = w.mem.tables.agent_orders.filter((o) => o.id !== 50 && o.side === "buy");
  assertEquals(buys.length, 1);
  assertEquals(buys[0].mode, "live");
  // And the paper position is billed to the paper cap, never the live one — the bucket used to be read off
  // the FIRST fill's mode, which for a blended position was whichever came first.
  const dec = w.mem.tables.agent_decisions.find((d) => d.symbol === "BTC/USD")!;
  assertEquals((dec.numbers as { exposureUsd: number }).exposureUsd, 0);
});

Deno.test("a paused row still sees the book it was trading: the mode in the key did not take its exits away again", async () => {
  // `0043`'s lesson, re-pinned against the keying change. The row is paused; its fills are paper; the floor
  // must still fire. A key that read the STRATEGY's mode literally would find nothing here and quietly strand it.
  const paused = strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken", mode: "paused", retired_at: new Date(NOW - ONE_D).toISOString() });
  const w = world({ strategies: [paused], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx", mode: "paper" })] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.windingDown, ["trend-4h"]);
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals(protective.length, 1);
  assertEquals([protective[0].strategy, protective[0].action], ["trend-4h", "exit"]);
  assertEquals(w.mem.tables.agent_orders.find((o) => o.id !== 50)?.side, "sell");
});

Deno.test("clearing live_confirmed_at stops the BUYING, not the selling: the kill switch leaves the exits armed", async () => {
  // The documented emergency procedure is `update agent_risk set live_confirmed_at = null`. Until 2026-09-22
  // the check in place() was side-agnostic, so the one lever the operator is told to pull refused the
  // protective sell too — real coins with no way out, while the decision row said the exit was allowed.
  const live = strategy({ mode: "live" });
  const w = world({
    strategies: [live], canTrade: true, risk: { live_confirmed_at: null },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "live" })],   // ~35 % under cost: through the 8 % floor
  });
  const r = await tick(w.deps);
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals([protective.length, protective[0]?.action], [1, "exit"]);
  const sells = w.mem.tables.agent_orders.filter((o) => o.id !== 50 && o.side === "sell");
  assertEquals(sells.length, 1);
  assertEquals([sells[0].mode, sells[0].state !== "rejected"], ["live", true]);
  assertEquals(r.errors, []);

  // And the buying really is stopped: the same world, flat, on a bar that would otherwise enter. The refusal is the
  // decision's own record (`risk_allowed: false`, the confirmation named) — not an error raised a line after the gate
  // said yes, which is what this assertion pinned until 2026-09-22.
  const w2 = world({ strategies: [live], canTrade: true, risk: { live_confirmed_at: null } });
  const r2 = await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders.filter((o) => o.side === "buy"), []);
  const refused = w2.mem.tables.agent_decisions.find((d) => d.final_action === "enter")!;
  assertEquals(refused.risk_allowed, false);
  assert(String(refused.risk_reason).includes("live_confirmed_at is null"), String(refused.risk_reason));
  assertEquals(r2.errors, []);
});

Deno.test("real coins outrank the row's label: a live book under a row set to paper keeps its floor, and the order is written live", async () => {
  // Demoting a live row to `paper` was offered as an undo. Read literally it made the row flat, so the real
  // coins at the venue lost their floor and their rule exit while the row cheerfully started buying on paper.
  const demoted = strategy({ mode: "paper" });
  const w = world({
    strategies: [demoted], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "live" })],
  });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals(r.windingDown, ["trend-4h-kraken"]);                       // it holds a book it does not trade
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals([protective.length, protective[0]?.action], [1, "exit"]);
  const others = w.mem.tables.agent_orders.filter((o) => o.id !== 50);
  assertEquals(others.length, 1);
  assertEquals([others[0].side, others[0].mode], ["sell", "live"]);        // the REAL book, sold as live
  assertEquals(r.decisions.filter((d) => d.action === "enter"), []);       // and it may not buy beside them
});

Deno.test("a buy in flight does not disarm the stop; a sell in flight does", async () => {
  // The failure this pins: an order that cannot be read back — which is exactly what an unverified settlement
  // reply (B4) or a venue timeout produces — used to block its pair's protective stop every minute, for good.
  const pendingBuy = seedOrder({ id: 7, mode: "live", state: "pending", client_order_id: "c-buy", side: "buy" });
  const w = world({
    strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "live" }), pendingBuy], active: {},
  });
  const r = await tick(w.deps);
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals([protective.length, protective[0]?.action], [1, "exit"]);
  assert(r.errors.some((e) => e.includes("stopping out past a buy in flight")), r.errors.join("; "));
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell").length, 1);

  // A SELL in flight is different: never place a second one over a sell we cannot see.
  const pendingSell = seedOrder({ id: 8, mode: "live", state: "pending", client_order_id: "c-sell", side: "sell" });
  const w2 = world({
    strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "live" }), pendingSell], active: {},
  });
  const r2 = await tick(w2.deps);
  assert(r2.skipped.some((x) => x.includes("a sell is already in flight")), r2.skipped.join("; "));
  assertEquals(w2.mem.tables.agent_orders.filter((o) => o.side === "sell" && o.state !== "pending").length, 0);
});

Deno.test("an order with no decision id is never placed: 0041's index is partial, so it would carry no claim", async () => {
  const w = world();
  const r = await tick(w.deps);
  assertEquals(r.errors, []);                                  // the ordinary path always has one
  assertEquals(w.mem.tables.agent_orders.length, 1);

  // With the decision insert returning nothing, the order has no claim and two turns would both place it.
  const w2 = world();
  const realInsert = w2.deps.db.insert.bind(w2.deps.db);
  // deno-lint-ignore no-explicit-any
  (w2.deps.db as any).insert = async (table: string, rows: unknown, returning = true) => {
    const out = await realInsert(table, rows as never, returning);
    return (table === "agent_decisions" ? [] : out) as never;
  };
  const r2 = await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders, []);
  assert(r2.errors.some((e) => e.includes("no decision id")), r2.errors.join("; "));
});

Deno.test("a row with jevGate false enters on the rulebook's signal whatever the model says, and still records the model's answer", async () => {
  // The world's model answers P(healthy) from its stub; force a veto-level answer by setting enterMin above it.
  const shadow = strategy({ params: { ...strategy().params, enterMin: 0.99, jevGate: false } });
  const w = world({ strategies: [shadow] });
  const r = await tick(w.deps);
  assertEquals(r.errors, []);
  assertEquals([r.decisions[0].action, r.decisions[0].kind], ["enter", "bar"]);
  const dec = w.mem.tables.agent_decisions[0];
  assert(String(dec.final_reason).includes("model in shadow — would veto"), String(dec.final_reason));
  assert(dec.answers && Object.keys(dec.answers as object).length > 0, "the model was still asked and its answer kept");
  assertEquals(w.mem.tables.agent_orders.length, 1);

  // The same world with the gate on (the default) is a hold — the switch is the only difference.
  const gated = world({ strategies: [strategy({ params: { ...strategy().params, enterMin: 0.99 } })] });
  const r2 = await tick(gated.deps);
  assertEquals(r2.decisions[0].action, "hold");
  assertEquals(gated.mem.tables.agent_orders.length, 0);
});

// ── the second pre-live review's findings, pinned (2026-09-22) ─────────────────────────────────────
// Each of these failed on the code it was written against; the review ran every one of them as a reproduction first.

Deno.test("the floor does not wait for the SIGNAL venue: Kraken's candles down, a Revolut X position through its floor is still sold", async () => {
  // Until 2026-09-22 a pair with no signal series was skipped before its floor ran — so a Kraken outage took the floor
  // off every Revolut X position while Revolut X's own quotes, pair config and the book were all fine.
  const w = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })],
    orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })],   // ~35 % under cost
    krakenCandlesDown: () => true,
  });
  const r = await tick(w.deps);
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals([protective.length, protective[0]?.action], [1, "exit"]);
  const sell = w.mem.tables.agent_orders.find((o) => o.id !== 50)!;
  assertEquals([sell.side, sell.venue, sell.base_size], ["sell", "revx", 0.1]);
  assert(r.errors.some((e) => e.includes("candles")), r.errors.join("; "));                // the outage is still reported …
  assertEquals(r.decisions.filter((d) => d.kind === "bar"), []);                          // … and no bar is decided without a series
  assertEquals((w.mem.tables.agent_decisions[0].state as { signal: string }).signal, "unavailable");
});

Deno.test("a warm cache stands in for a failed signal fetch: the floor runs on it, and no bar is decided on the stale series", async () => {
  const s4h = series(1.01, FOUR_H, 220);                                                // enough bars for the cache to count as warm
  let down = false;
  const w = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })],
    orders: [longSince(ONE_H, s4h.lastClose, 0.1, { strategy_id: "trend-4h", venue: "revx" })],   // bought an hour ago at the market: healthy
    series: { "BTC/USD": s4h }, krakenCandlesDown: () => down,
  });
  await tick(w.deps);                                                                    // a good turn warms the cache
  down = true;
  // Four hours on: the bar the cache holds as "forming" has closed on the clock, but its data stopped at the last good
  // fetch. Deciding it would read a partial candle as a closed one — so nothing is decided on it.
  const later = NOW + FOUR_H;
  const r2 = await tick({ ...w.deps, now: later });
  assertEquals(r2.decisions, []);
  assert(r2.skipped.some((x) => x.includes("stale")), r2.skipped.join("; "));
  assert(r2.errors.some((e) => e.includes("cached series stands in")), r2.errors.join("; "));
  // The same outage with the Revolut X bid through the floor: the floor fires from the cache-backed turn.
  const w3 = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", signal_venue: "kraken" })],
    orders: [longSince(ONE_H, s4h.lastClose, 0.1, { strategy_id: "trend-4h", venue: "revx" })],
    series: { "BTC/USD": s4h }, krakenCandlesDown: () => down,
  });
  down = false;
  await tick(w3.deps);
  down = true;
  const cold = w3.revxQuote.bid * 0.85;
  w3.deps.venues.revx.quotes = (syms: string[]) => Promise.resolve(Object.fromEntries(syms.map((x) => [x, { bid: cold, ask: cold + 0.02 }])));
  const r3 = await tick({ ...w3.deps, now: NOW + ONE_M });
  assertEquals(r3.decisions.filter((d) => d.kind === "protective").map((d) => d.action), ["exit"]);
});

Deno.test("an unreadable fill does not disarm the floor: a live buy the venue reported filled counts as held until it settles", async () => {
  // The first live order is where the settlement names are least certain (B4). A buy that filled on arrival and whose
  // read-back then fails used to be in NO book: the floor saw flat and never fired, whatever the market did to the coins.
  const unsettled = seedOrder({
    id: 7, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", mode: "live", side: "buy", state: "new",
    price: 200, base_size: 0.1, client_order_id: "c-arrived", venue_order_id: "V-7", request: { marketable: true },
    response: { placedState: "filled", result: { data: [{ venue_order_id: "V-7", state: "filled" }] } },
  });
  const w = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [unsettled],
    risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxBalances: { BTC: 0.1, USD: 80 },   // the venue has the coins …
  });                                                                                                                   // … its order read fails (no view)
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("order lookup")), r.errors.join("; "));
  const protective = r.decisions.filter((d) => d.kind === "protective");
  assertEquals([protective.length, protective[0]?.action], [1, "exit"]);                   // ~35 % under the limit price: the floor fires
  const sell = w.mem.tables.agent_orders.find((o) => o.side === "sell")!;
  assertEquals([sell.mode, sell.venue, sell.base_size], ["live", "revx", 0.1]);
  assert(w.revx.calls.some((c) => c.startsWith("place sell 0.1")), w.revx.calls.join(","));
  // A buy that settles normally is never counted twice: the same world with the venue's view readable settles it, and the
  // floor then sees exactly the one position.
  const view: OrderView = { state: "filled", filledBase: 0.1, avgPrice: 200, feeUsd: 0.02, raw: {} };
  const w2 = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [unsettled],
    risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxBalances: { BTC: 0.1, USD: 80 }, revxOrderView: view,
  });
  await tick(w2.deps);
  const sells2 = w2.mem.tables.agent_orders.filter((o) => o.side === "sell");
  assertEquals(sells2.map((o) => o.base_size), [0.1]);
});

Deno.test("an unreadable buy whose placement reply said `new` is held as far as the venue's own balance shows its coins — and no further", async () => {
  // The documented placement reply's example says `new` (revolut-x-api-for-llm.md, POST /orders), so a buy that crossed may be
  // reported that way on arrival; if its read-back then fails, the word `filled` never comes, and a floor that waited for it
  // left the coins with none. On a sub-account nothing else trades, coins the venue holds beyond the settled book are this buy's.
  const unsettled = seedOrder({
    id: 7, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", mode: "live", side: "buy", state: "new",
    price: 200, base_size: 0.1, client_order_id: "c-new", venue_order_id: "V-7", request: { marketable: true }, response: { placedState: "new" },
  });
  const live = { strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [unsettled], risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true };
  const sold = (w: ReturnType<typeof world>) => w.mem.tables.agent_orders.filter((o) => o.side === "sell").map((o) => [o.mode, o.base_size]);
  // (a) The venue holds 0.1 BTC and the book explains none of it: the floor counts the buy, ~35 % under its price, and sells it.
  const w = world({ ...live, revxBalances: { BTC: 0.1, USD: 80 } });
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("floor counts 0.1 as held") && e.includes("more than the settled book explains")), r.errors.join("; "));
  assertEquals(sold(w), [["live", 0.1]]);
  // (b) A part filled and the rest died: the venue shows 0.04, so 0.04 is what the floor protects and sells.
  const w2 = world({ ...live, revxBalances: { BTC: 0.04, USD: 92 } });
  await tick(w2.deps);
  assertEquals(sold(w2), [["live", 0.04]]);
  // (c) The IOC died unfilled: the venue shows no coin, nothing is counted, nothing is sold.
  const w3 = world({ ...live, revxBalances: { BTC: 0, USD: 100 } });
  const r3 = await tick(w3.deps);
  assertEquals([r3.decisions.filter((d) => d.kind === "protective").length, sold(w3).length], [0, 0]);
  assert(!r3.errors.some((e) => e.includes("floor counts")), r3.errors.join("; "));
});

Deno.test("a live buy whose placement reply never arrived stays `pending` for a person — and the coins the venue took for it still have a floor", async () => {
  // A timeout after the venue took the order: no reply, no venue id, and an IOC that filled is not among the active orders.
  // The row is left for a person to settle (nothing guessed); until then its coins were in no book, and had no floor.
  const lost = seedOrder({
    id: 7, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", mode: "live", side: "buy", state: "pending",
    price: 200, base_size: 0.1, client_order_id: "c-lost", venue_order_id: null, request: { marketable: true },
  });
  const live = { strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [lost], risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true };
  const w = world({ ...live, revxBalances: { BTC: 0.1, USD: 80 } });
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("outcome unknown") && e.includes("revx holds 0.1 BTC against 0 on record")), r.errors.join("; "));
  assertEquals(w.mem.tables.agent_orders.find((o) => o.id === 7)!.state, "pending");                 // still the person's to settle
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell").map((o) => [o.mode, o.base_size]), [["live", 0.1]]);   // ~35 % under: sold
  // The venue shows no coin (the order died, or never reached it): nothing is protected because nothing is there.
  const w2 = world({ ...live, revxBalances: { BTC: 0, USD: 100 } });
  const r2 = await tick(w2.deps);
  assertEquals([r2.decisions.length, w2.mem.tables.agent_orders.filter((o) => o.side === "sell").length], [0, 0]);
});

Deno.test("a buy the floor already sold is dated from its own row when it finally settles: the book ends flat, never long coins the venue does not hold", async () => {
  // The floor counts an unreadable live buy as held from its row's time and sells it. If the buy's read-back comes good
  // only after the sell has settled, a fill dated from the READING turn lands after the sell: the book reads long 0.1, the
  // venue holds nothing, and the floor tries to sell the phantom every minute ("under the venue minimum; not placed").
  const unsettled = seedOrder({
    id: 7, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", mode: "live", side: "buy", state: "new",
    price: 200, base_size: 0.1, client_order_id: "c-late", venue_order_id: "V-7", request: { marketable: true }, response: { placedState: "new" },
  });
  const w = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [unsettled],
    risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxBalances: { BTC: 0.1, USD: 80 },
  });
  // Turn 1: the buy cannot be read back; the venue holds its coins; ~35 % under its price, the floor sells them.
  await tick(w.deps);
  const sell = w.mem.tables.agent_orders.find((o) => o.side === "sell")!;
  assertEquals([sell.mode, sell.base_size, sell.venue_order_id], ["live", 0.1, "V-1"]);
  // Turn 2: the sell reads back filled and the coins are gone; the buy still cannot be read.
  const views: Record<string, OrderView> = { "V-1": { state: "filled", filledBase: 0.1, avgPrice: 130, feeUsd: 0.01, raw: {} } };
  w.deps.venues.revx.order = (vid) => Promise.resolve(views[vid] ? { ok: true as const, view: views[vid] } : { ok: false as const, error: "no view" });
  w.deps.venues.revx.balances = () => Promise.resolve({ BTC: 0, USD: 93 });
  await tick({ ...w.deps, now: NOW + ONE_M });
  assertEquals(w.mem.tables.agent_orders.find((o) => o.id === sell.id)!.state, "filled");
  // Turn 3: the buy finally reads back, filled at its price.
  views["V-7"] = { state: "filled", filledBase: 0.1, avgPrice: 200, feeUsd: 0.02, raw: {} };
  const r3 = await tick({ ...w.deps, now: NOW + 2 * ONE_M });
  const buy = w.mem.tables.agent_orders.find((o) => o.id === 7)!;
  assertEquals(buy.state, "filled");
  assertEquals(buy.filled_at, unsettled.ts);                                             // when it crossed, not when it was read
  const book = positionFromFills(w.mem.tables.agent_orders.filter((o) => o.state === "filled").map((o) => toFill(o as unknown as OrderRow)));
  assertEquals(book.base, 0);                                                            // bought, then sold: flat
  assertEquals(r3.decisions.filter((d) => d.kind === "protective"), []);                 // nothing left to protect …
  assert(!r3.errors.some((e) => e.includes("not placed")), r3.errors.join("; "));        // … and no phantom to chase
});

Deno.test("fillStamp: a fill already on record keeps its time; a marketable order is dated from its own row; a resting one from the turn that reads it", () => {
  const now = "2026-09-22T12:05:00.000Z", ts = "2026-09-22T12:00:00.000Z";
  assertEquals(fillStamp({ filled_at: "2026-09-22T12:01:00.000Z", ts, request: { marketable: true } }, now), "2026-09-22T12:01:00.000Z");
  assertEquals(fillStamp({ filled_at: null, ts, request: { marketable: true } }, now), ts);
  assertEquals(fillStamp({ filled_at: null, ts, request: { marketable: false } }, now), now);
  assertEquals(fillStamp({ filled_at: null, ts, request: null }, now), now);
});

Deno.test("a live placement keeps what the venue's reply said (placedState), so an unsettled 'filled on arrival' is known next turn", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxPlacedState: "filled" });
  await tick(w.deps);
  const o = w.mem.tables.agent_orders[0] as Row & { response: { placedState: string } };
  assertEquals([o.mode, o.state, o.response.placedState], ["live", "new", "filled"]);
});

Deno.test("every live Revolut X sell is capped at what the venue holds: a book that over-states the coins can still get out", async () => {
  // If the venue took the buy's fee in the coin, it holds 0.0999 where the book says 0.1 — and a sell of 0.1 is refused,
  // every minute, by a venue that has no more to give. Sized from the book alone, the floor could never get out.
  const w = world({
    strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })],
    orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx", mode: "live" })],
    risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxBalances: { BTC: 0.0999, USD: 80 },
  });
  const r = await tick(w.deps);
  const sell = w.mem.tables.agent_orders.find((o) => o.id !== 50)!;
  assertEquals([sell.side, sell.mode, sell.base_size], ["sell", "live", 0.0999]);
  assert(r.errors.some((e) => e.includes("capped to 0.099900")), r.errors.join("; "));
  // The venue's balance is read only where a live Revolut X book needs it: a paper world never asks.
  const paper = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })], revxCanTrade: true, revxBalances: { BTC: 0 } });
  await tick(paper.deps);
  assert(!paper.revx.calls.includes("balances"), paper.revx.calls.join(","));
  assertEquals(w.revx.calls.filter((c) => c === "balances").length, 1);             // once a turn, not once a pair
});

Deno.test("isUniqueViolation: Postgres's 23505 — or PostgREST's 409 saying duplicate key — and never a row value that happens to contain 409", () => {
  assert(isUniqueViolation(new Error(`db POST agent_orders → 409: {"code":"23505","details":"Key (decision_id, requotes)=(12, 0) already exists.","hint":null,"message":"duplicate key value violates unique constraint"}`)));
  assert(isUniqueViolation(new Error(`db POST agent_decisions → 409: duplicate key value violates unique constraint "agent_decisions_one_per_bar"`)));
  // A CHECK violation whose failing row holds an id of 1409 and a price of 64091.23 — the bare-word test called this a duplicate.
  assert(!isUniqueViolation(new Error(`db POST agent_orders → 400: {"code":"23514","details":"Failing row contains (1409, 2026-09-22 16:40:09.409113+00, rotation-1d, 64091.23, paused, sell)","hint":null,"message":"new row violates check constraint \\"agent_orders_mode_check\\""}`)));
  // A foreign-key violation is a 409 too, and it is not another turn's claim.
  assert(!isUniqueViolation(new Error(`db POST agent_orders → 409: {"code":"23503","details":"Key (decision_id)=(99) is not present in table \\"agent_decisions\\".","hint":null,"message":"insert or update on table \\"agent_orders\\" violates foreign key constraint"}`)));
});

Deno.test("an order refused by the database for a real reason is an ERROR, even when its row's values contain '409'", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })] });
  const realInsert = w.mem.db.insert;
  w.mem.db.insert = (table, rows, returning) => table === "agent_orders"
    ? Promise.reject(new Error(`db POST agent_orders → 400: {"code":"23514","details":"Failing row contains (1409, 2026-09-22 04:05:05.123456+00, trend-4h, 1001, revx, BTC/USD, paused, sell, limit, 129.04, 0.1","hint":null`))
    : realInsert(table, rows, returning);
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("→ 400")), r.errors.join("; "));
  assert(!r.skipped.some((x) => x.includes("already placed by another turn")), r.skipped.join("; "));
});

Deno.test("a sell in flight stands the stop down FIRST: a resting buy on the same pair does not hide it", async () => {
  // The position (real coins), a buy still resting and readable, and the stop's own earlier sell whose reply never
  // landed (`pending`, not listed by the venue). The resting buy used to be all the stop looked at: it cancelled the
  // buy and placed a SECOND sell over the first.
  const restingBuy = seedOrder({ id: 8, ts: new Date(NOW - 2 * ONE_M).toISOString(), mode: "live", state: "new", side: "buy", price: 120, base_size: 0.05, client_order_id: "c-buy", venue_order_id: "V-8" });
  const pendingSell = seedOrder({ id: 9, ts: new Date(NOW - 2 * ONE_M).toISOString(), mode: "live", state: "pending", side: "sell", price: 129, base_size: 0.1, client_order_id: "c-sell" });
  const w = world({
    strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" },
    orders: [longSince(2 * ONE_D, 200, 0.1, { mode: "live" }), restingBuy, pendingSell], active: {},
    orderView: { state: "new", filledBase: 0, avgPrice: null, feeUsd: 0, raw: {} },
  });
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.includes("pending sell")), r.errors.join("; "));             // the loop knows the sell is out there …
  assert(r.skipped.some((x) => x.includes("a sell is already in flight")), r.skipped.join("; "));
  assert(!w.kraken.calls.some((c) => c.startsWith("place sell")), w.kraken.calls.join(","));   // … and places no second one
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell").length, 1);
});

Deno.test("no ENTRY on a bar that closed more than a quarter of a bar ago — fresh or retried — and never a refused exit for age", async () => {
  assertEquals(entryTooLate(0, FOUR_H, FOUR_H + 60 * ONE_M), null);                   // an hour after a 4-hour bar closed: still in time
  assert(entryTooLate(0, FOUR_H, FOUR_H + 61 * ONE_M)?.includes("too late"));
  assert(entryTooLate(0, ONE_D, ONE_D + 6 * ONE_H + ONE_M)?.includes("too late"));      // a day bar allows six hours
  // Fresh: the turn comes back three hours after the 04:00 close (an outage, or a row just added). The breakout is real
  // but three hours old; an entry now pays today's touch for it. Recorded as a hold, with the reason, and the model not asked.
  const w = world({ now: NOW + 3 * ONE_H });
  const r = await tick(w.deps);
  const d = r.decisions.find((x) => x.kind === "bar")!;
  assertEquals(d.action, "hold");
  assert(d.reason.includes("too late to enter"), d.reason);
  assertEquals([w.mem.tables.agent_orders.length, w.jevLog.length], [0, 0]);
  // Retried: an entry decided at the close with no order behind it is closed, not placed, three hours on …
  const barStart = new Date(world().lastClosedBarStart).toISOString();
  const orphan = (id: number, action: "enter" | "exit"): Row => ({ id, ts: new Date(NOW - ONE_M).toISOString(), strategy_id: "trend-4h-kraken", venue: "kraken", symbol: "BTC/USD", mode: "paper", bar_start: barStart, state: {}, numbers: { orderUsd: action === "enter" ? 20 : 0, kind: "bar" }, provider: "rule", rule_action: action, rule_reason: "x", final_action: action, final_reason: "x", risk_allowed: true, risk_reason: "within limits" });
  const w2 = world({ now: NOW + 3 * ONE_H, decisions: [orphan(920, "enter")] });
  await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders.length, 0);
  assert(String(w2.mem.tables.agent_decisions[0].risk_reason).includes("too late to enter"), String(w2.mem.tables.agent_decisions[0].risk_reason));
  // … while an EXIT decided on the same bar is still placed: a late exit is still the way out.
  const w3 = world({ now: NOW + 3 * ONE_H, orders: [longSince(2 * ONE_D, 128, 0.1)], decisions: [orphan(921, "exit")] });
  await tick(w3.deps);
  assertEquals(w3.mem.tables.agent_orders.filter((o) => o.side === "sell").map((o) => o.decision_id), [921]);
});

Deno.test("a protective exit that cannot be placed says so, naming the exit: no quote this minute is an error, not a silent 'allowed'", async () => {
  // Revolut X's tickers are down; its last closed minute still gives a mark, and the position is ~35 % under cost.
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })], revxNoQuote: true });
  const r = await tick(w.deps);
  assertEquals(r.decisions.filter((d) => d.kind === "protective").map((d) => d.allowed), [true]);
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell"), []);
  assert(r.errors.some((e) => e.includes("protective exit") && e.includes("no quote")), r.errors.join("; "));
});

Deno.test("a re-quote with no decision id is refused like any other decisionless order: it would carry no claim under 0041", async () => {
  // A legacy resting order with no decision behind it goes stale. The cancel still happens; the re-quote does not — two
  // overlapping turns could both place it, and the reason it was once exempt holds only when turns never overlap.
  const w = world({ orders: [seedOrder({ id: 17, ts: new Date(NOW - REQUOTE_AFTER_MS).toISOString(), price: 120, base_size: 0.1, client_order_id: "c17", requotes: 1 })] });
  const r = await tick(w.deps);
  assertEquals(r.settled, [{ id: 17, state: "cancelled" }]);
  assertEquals(w.mem.tables.agent_orders.filter((o) => o.requotes === 2), []);
  assert(r.errors.some((e) => e.includes("no decision id")), r.errors.join("; "));
});

Deno.test("a NON-essential read that fails costs its own job only: the stops still run, new risk is refused, exits are not", async () => {
  // Each read below used to end the whole turn before a single stop ran. The position is ~35 % under cost in every world.
  const held = () => ({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })] });
  const failing = (w: ReturnType<typeof world>, pred: (table: string, query: string) => boolean) => {
    const sel = w.mem.db.select, all = w.mem.db.selectAll;
    w.mem.db.select = (t, q) => pred(t, q) ? Promise.reject(new Error("db GET → 503: timeout")) : sel(t, q);
    w.mem.db.selectAll = (t, q) => pred(t, q) ? Promise.reject(new Error("db GET → 503: timeout")) : all(t, q);
  };
  for (const [what, pred] of [
    ["today's order count", (t: string, q: string) => t === "agent_orders" && q.includes("select=venue,mode")],
    ["last observations", (t: string) => t === "agent_observations"],
    ["maker probes", (t: string) => t === "agent_maker_probes"],
    ["the caps", (t: string) => t === "agent_risk"],
  ] as const) {
    const w = world(held());
    failing(w, pred);
    const r = await tick(w.deps);
    assertEquals(r.decisions.filter((d) => d.kind === "protective").map((d) => [d.action, d.allowed]), [["exit", true]], `${what}: ${r.errors.join("; ")}`);
    assertEquals(w.mem.tables.agent_orders.filter((o) => o.side === "sell").length, 1, what);
    assert(r.errors.length > 0, `${what} failed silently`);
  }
  // Fail CLOSED for new risk: a flat book on a bar that would enter, with today's order count unreadable, enters nothing.
  const flat = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })] });
  failing(flat, (t, q) => t === "agent_orders" && q.includes("select=venue,mode"));
  const r2 = await tick(flat.deps);
  assertEquals(r2.decisions.map((d) => [d.action, d.allowed]), [["enter", false]]);
  assertEquals(flat.mem.tables.agent_orders, []);
});

Deno.test("an ESSENTIAL read that fails stops the turn LOUDLY: no book, no stop — and it says so rather than throwing", async () => {
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })] });
  const all = w.mem.db.selectAll;
  w.mem.db.selectAll = (t, q) => t === "agent_orders" && q.includes("state=in.(filled,partially_filled)") ? Promise.reject(new Error("db GET → 503: timeout")) : all(t, q);
  const r = await tick(w.deps);
  assert(r.errors.some((e) => e.startsWith("ESSENTIAL READ FAILED — the book")), r.errors.join("; "));
  assertEquals([r.decisions.length, w.mem.tables.agent_orders.length], [0, 1]);
  assertEquals(w.mem.tables.agent_locks[0].holder, null);                          // and the lease is still given back
});

Deno.test("a turn that has lost its lease stops: it places nothing beside the turn that took the lock over", async () => {
  // The turn stalls a minute before its first check (a slow venue, a slow database), its lease expires, and the next
  // minute's turn takes the lock. The stalled turn used to renew with an UPDATE that matched nothing, carry on, and
  // claim its own protective minute — two sells for one position.
  const w = world({ strategies: [strategy({ id: "trend-4h", venue: "revx" })], orders: [longSince(2 * ONE_D, 200, 0.1, { strategy_id: "trend-4h", venue: "revx" })] });
  let calls = 0;
  const clock = () => {
    if (++calls === 2) w.mem.tables.agent_locks[0] = { name: "tick", lease_until: new Date(NOW + 2 * ONE_M).toISOString(), holder: "the next turn" };
    return NOW + (calls === 1 ? 0 : 60e3);
  };
  const r = await tick({ ...w.deps, clock });
  assert(r.errors.some((e) => e.includes("lease lost")), r.errors.join("; "));
  assertEquals([r.decisions.length, w.mem.tables.agent_orders.length], [0, 1]);            // no stop, no order: the other turn owns this minute
  assertEquals(w.mem.tables.agent_locks[0].holder, "the next turn");                      // and its lock is untouched
});

Deno.test("a long turn keeps its lease: renewed whenever half of it is gone, not once", async () => {
  // Three pairs, each reached 30 s after the last. A lease renewed only once expires under the third.
  const w = world({ strategies: [strategy({ symbols: ["BTC/USD", "ETH/USD", "SOL/USD"] })], series: { "BTC/USD": series(), "ETH/USD": series(), "SOL/USD": series() } });
  let t = 0;
  const clock = () => NOW + (t++) * 30e3;
  const claim = w.mem.db.claim;
  let renewals = 0;
  w.mem.db.claim = (table, query, patch) => { if (table === "agent_locks" && query.includes("holder=eq.")) renewals++; return claim(table, query, patch); };
  const r = await tick({ ...w.deps, clock });
  assert(renewals >= 2, `${renewals} renewal(s)`);
  assert(!r.errors.some((e) => e.includes("lease")), r.errors.join("; "));
});

Deno.test("a fill is dated from when it FIRST filled: finishing the order — read back filled, or cancelled with the rest unfilled — never re-stamps it", async () => {
  const first = new Date(NOW - 30 * ONE_M).toISOString();                        // the first part filled half an hour ago
  const partial = (over: Row = {}) => seedOrder({ id: 30, ts: new Date(NOW - 40 * ONE_M).toISOString(), mode: "live", state: "partially_filled", filled_base: 0.05, avg_fill_price: 129, filled_at: first, client_order_id: "c30", venue_order_id: "V-30", price: 129, base_size: 0.155, ...over });
  const live = { strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" } };
  // (a) The venue now says the whole order filled.
  const w = world({ ...live, orders: [partial()], orderView: { state: "filled", filledBase: 0.155, avgPrice: 129, feeUsd: 0.08, raw: {} } });
  await tick(w.deps);
  assertEquals([w.mem.tables.agent_orders[0].state, w.mem.tables.agent_orders[0].filled_at], ["filled", first]);
  // (b) An hour old, so the turn cancels it; what filled is settled as the fill — still dated from its first part.
  const w2 = world({ ...live, orders: [partial({ ts: new Date(NOW - 61 * ONE_M).toISOString() })], orderView: { state: "cancelled", filledBase: 0.05, avgPrice: 129, feeUsd: 0.03, raw: {} } });
  await tick(w2.deps);
  assertEquals([w2.mem.tables.agent_orders[0].state, w2.mem.tables.agent_orders[0].filled_at], ["filled", first]);
  // (c) Still working when read, too old, so the turn cancels it — and the read-back after the cancel reports the fill.
  const w3 = world({ ...live, orders: [partial({ ts: new Date(NOW - 61 * ONE_M).toISOString() })], orderViews: [
    { state: "partially_filled", filledBase: 0.05, avgPrice: 129, feeUsd: 0.03, raw: {} },
    { state: "cancelled", filledBase: 0.05, avgPrice: 129, feeUsd: 0.03, raw: {} },
  ] });
  await tick(w3.deps);
  assert(w3.kraken.calls.includes("cancel V-30"), w3.kraken.calls.join(","));
  assertEquals([w3.mem.tables.agent_orders[0].state, w3.mem.tables.agent_orders[0].filled_at], ["filled", first]);
});

Deno.test("the day opens at yesterday's CLOSE until the venue publishes today's candle — pure, and through the tick's own P&L just after midnight", async () => {
  const day = Date.parse("2026-09-21T00:00:00Z");
  const yesterday = { start: day - ONE_D, open: 100, high: 112, low: 99, close: 110, volume: 1 };
  assertEquals(dayOpenOf([yesterday], day), 110);                                  // its CLOSE, not its open (100)
  assertEquals(dayOpenOf([yesterday, { ...yesterday, start: day, open: 111, close: 115 }], day), 111);   // published: today's own open
  assertEquals(dayOpenOf([], day), null);
  // Through the tick, two minutes after midnight, the daily candle for today not yet published. Held 0.1 since before
  // yesterday: today's P&L is 0.1 × (mark − yesterday's close). Read from yesterday's OPEN it was a whole day off.
  const midnight = Math.floor(NOW / ONE_D) * ONE_D + ONE_D;
  const bars: Candle[] = Array.from({ length: 130 }, (_, i) => { const c = 100 * Math.pow(1.002, i); return { start: midnight - (129 - i) * FOUR_H, open: c / 1.002, high: c * 1.0005, low: c / 1.002 * 0.9995, close: c, volume: 1 }; });
  const last4h = bars[128].close;
  const c1d: Candle[] = Array.from({ length: 130 }, (_, i) => { const c = last4h * Math.pow(1.01, i - 129); return { start: midnight - (130 - i) * ONE_D, open: c / 1.01, high: c * 1.002, low: c / 1.01 * 0.998, close: c, volume: 1 }; });
  const w = world({ now: midnight + 2 * ONE_M, series: { "BTC/USD": { bars, c1d } }, orders: [longSince(2 * ONE_D, 120, 0.1)] });
  await tick(w.deps);
  const dec = w.mem.tables.agent_decisions.find((d) => (d.numbers as { kind: string }).kind === "bar")!;
  const n = dec.numbers as { pnlToday: number; mark: number };
  assertAlmostEquals(n.pnlToday, 0.1 * (n.mark - c1d[129].close), 1e-9);
  assert(Math.abs(n.pnlToday - 0.1 * (n.mark - c1d[129].open)) > 0.01);           // …which is not what yesterday's open gives
});

Deno.test("the in-memory database refuses what Postgres refuses, on UPDATE as well as INSERT", async () => {
  // The rules live in ONE function the double calls on every write; this pins the double, so it can never again be
  // looser than the schema it stands in for.
  const now = () => NOW;
  const row = { strategy_id: "s", venue: "revx", symbol: "BTC/USD", mode: "live", side: "buy", price: 100, base_size: 0.1, client_order_id: "00000000-0000-4000-8000-00000000000a" };
  assertEquals(schemaRefusal("agent_orders", { ...row, state: "new", filled_base: 0, fee_usd: 0, requotes: 0 }), null);
  const { db, tables } = memDb({ agent_orders: [] }, { now });
  await db.insert("agent_orders", row);
  assertEquals([tables.agent_orders[0].state, tables.agent_orders[0].filled_base, tables.agent_orders[0].fee_usd], ["new", 0, 0]);   // Postgres's defaults
  const id = tables.agent_orders[0].id;
  let refused = "";
  await db.update("agent_orders", `id=eq.${id}`, { state: "filled", fee_usd: NaN }).catch((e) => { refused = String(e); });   // NaN travels as null
  assert(refused.includes("not-null") && refused.includes("fee_usd"), refused);
  assertEquals(tables.agent_orders[0].state, "new");                                     // the statement changed nothing
  refused = "";
  await db.update("agent_orders", `id=eq.${id}`, { state: "settled" }).catch((e) => { refused = String(e); });
  assert(refused.includes("agent_orders_state_check"), refused);
  refused = "";
  await db.insert("agent_orders", { ...row, mode: "paused" }).catch((e) => { refused = String(e); });
  assert(refused.includes("agent_orders_mode_check"), refused);
  refused = "";
  await db.insert("agent_maker_probes", { strategy_id: "s", venue: "revx", symbol: "BTC/USD", side: "buy", mode: "live", taker_price: 100, maker_price: 0, base_size: 0.1, expires_at: new Date(NOW).toISOString() }).catch((e) => { refused = String(e); });
  assert(refused.includes("maker_price_check"), refused);
  // `client_order_id uuid not null unique`: a second order under the same id is a unique violation, and not a uuid is not a row.
  refused = "";
  await db.insert("agent_orders", row).catch((e) => { refused = String(e); });
  assert(refused.includes("→ 409") && refused.includes("agent_orders_client_order_id_key"), refused);
  refused = "";
  await db.insert("agent_orders", { ...row, client_order_id: "c-1" }).catch((e) => { refused = String(e); });
  assert(refused.includes("invalid input syntax for type uuid"), refused);
  assertEquals(tables.agent_orders.length, 1);
});

Deno.test("a settlement Postgres would refuse is not certified by the tests: a fee that is not a number leaves the order unsettled, and says so", async () => {
  // The fee reaches the database as null and `fee_usd NOT NULL` refuses the UPDATE. The old double applied it anyway.
  const live = seedOrder({ id: 3, mode: "live", client_order_id: "c3", venue_order_id: "V-9" });
  const view: OrderView = { state: "filled", filledBase: 0.155, avgPrice: 128.95, feeUsd: NaN, raw: {} };
  const w = world({ strategies: [strategy({ mode: "live" })], canTrade: true, risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, orders: [live], orderView: view });
  const r = await tick(w.deps);
  assertEquals(w.mem.tables.agent_orders[0].state, "new");
  assert(r.errors.some((e) => e.includes("not-null") && e.includes("fee_usd")), r.errors.join("; "));
});

Deno.test("a LIVE Revolut X order is read back through the real client's reader: the documented reply settles; an unreadable one is refused and the floor still holds", async () => {
  const documented: VenueOrder = {
    id: "V-7", client_order_id: "c-docs", symbol: "BTC/USD", side: "buy", type: "limit", quantity: "0.1", filled_quantity: "0.1", leaves_quantity: "0",
    price: "200.00", average_fill_price: "199.90", total_fee: "0.018", fee_currency: "USD", status: "filled",
  };
  const unsettled = seedOrder({
    id: 7, ts: new Date(NOW - 2 * ONE_M).toISOString(), strategy_id: "trend-4h", venue: "revx", mode: "live", side: "buy", state: "new",
    price: 200, base_size: 0.1, client_order_id: "c-docs", venue_order_id: "V-7", request: { marketable: true }, response: { placedState: "filled" },
  });
  const live = { strategies: [strategy({ id: "trend-4h", venue: "revx", mode: "live" })], orders: [unsettled], risk: { live_confirmed_at: "2026-09-20T00:00:00Z" }, revxCanTrade: true, revxBalances: { BTC: 0.1, USD: 80 } };
  // (a) The reply in the names the venue documents: settled with the venue's own size, price and fee.
  const w = world({ ...live, revxOrderReply: documented });
  const r = await tick(w.deps);
  const o = w.mem.tables.agent_orders[0];
  assertEquals([o.state, o.filled_base, o.avg_fill_price, o.fee_usd], ["filled", 0.1, 199.9, 0.018]);
  // … and, ~35 % under its cost, the floor then sells it in the same turn.
  assertEquals(r.decisions.filter((d) => d.kind === "protective").map((d) => d.action), ["exit"]);
  // (b) A status the client does not know: refused, never "new with nothing filled" — and the coins it bought still have a floor.
  const w2 = world({ ...live, revxOrderReply: { ...documented, status: "completed" } });
  const r2 = await tick(w2.deps);
  assertEquals(w2.mem.tables.agent_orders[0].state, "new");
  assert(r2.errors.some((e) => e.includes("does not know")), r2.errors.join("; "));
  assertEquals(w2.mem.tables.agent_orders.filter((x) => x.side === "sell").map((x) => [x.mode, x.base_size]), [["live", 0.1]]);
});
