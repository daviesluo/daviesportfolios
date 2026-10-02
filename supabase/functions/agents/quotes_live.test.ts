// PR5's live executor (quotes_live.ts) against doubles no looser than what they stand in for: the in-memory database with
// 0052's CHECKs and unique indexes (testing.ts), and a fake Revolut X that refuses a crossing post-only order, reserves
// what a resting order could spend, answers in the venue's documented fields and can lose a reply or a cancel.
//
// Each rule the design names has a pin here, and each pin fails without its rule (the counterfactuals are listed in
// reference §4 item 35). The paper engine is driven by its own `stepMinute`, exactly as `runQuotes` drives it, and its
// state is saved the way `runQuotes` saves it; the executor then reads that state, as it does in production.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/pr5/golden_windows.json" with { type: "json" };
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import type { Venue } from "../_shared/venue.ts";
import {
  exitTicks, fairUAt, fxAt, newBookState, QUOTE_BOOKS, QUOTE_TICK, stepMinute, type BookState, type Print, type QuoteBook, type QuoteEvent, type Side, type Trip,
} from "./quotes.ts";
import {
  bookInputs, crossesBook, dustBase, entryBookOf, pennyExit, entryGuards, exitMayGo, governorLevel, lossStopHit, markedGbp, paperEntryTarget, paperRefused, parseBook, QUOTE_LIVE_429_WAIT_MS, QUOTE_LIVE_CANCEL_REREAD_MS,
  QUOTE_LIVE_ENTRY_POSTS, QUOTE_LIVE_POST_GAP_MS, QUOTE_LIVE_STOPS_ONLY_POSTS, rungBase, rungBook, rungGbp, runQuotesConvert, runQuotesLive, stopDue, stopLimitTicks,
  venueSideOf, wasRateLimited,
} from "./quotes_live.ts";
import { bookLiveBuy } from "./tick.ts";
import { FakeRevx, GBP_BOOK_PAIR, memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const T0 = Date.parse("2026-09-24T10:00:00Z");          // a Thursday: FX is open
const X = 1.3238;                                        // GBP/USD; with the USD books at 1.0000, fair is 1 / X
const ARMED = "2026-09-24T00:00:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
const PAIR = { base_step: GBP_BOOK_PAIR.base_step, quote_step: GBP_BOOK_PAIR.quote_step, min_order_size: GBP_BOOK_PAIR.min_order_size, min_order_size_quote: GBP_BOOK_PAIR.min_order_size_quote };
/** The rung's size in coin at `price`, worked out by hand: £50 over twelve rungs, floored to the 0.00001 step. */
const handBase = (price: number, capital = 50) => Math.floor(capital / 12 / price * 1e5) / 1e5;

type Opts = { live?: boolean; armed?: boolean; key?: boolean; balances?: Record<string, number>; capital?: number };

function makeWorld(o: Opts = {}) {
  const clock = { now: T0 + M + 30e3 };
  /** With `pauses.advance`, a pause the executor takes moves the clock, as a real one does; every pause is recorded. */
  const pauses = { advance: false, taken: [] as number[] };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 30 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 30 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: "quotes-live", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_live_config: [{ id: 1, dry_run: !o.live, live_confirmed_at: o.armed ? ARMED : null, capital_gbp: o.capital ?? 50 }],
    agent_quote_live_orders: [], agent_quote_live_events: [], agent_quote_live_state: [],
    agent_quote_state: [], agent_quote_inputs: inputs, agent_quote_events: [],
  }, { now: () => clock.now });
  const rx = new FakeRevx(() => clock.now);
  rx.balances = { GBP: 50, ...(o.balances ?? {}) };
  const account: Venue | null = o.key === false ? null : revxVenue({ apiKey: "k".repeat(64), privateKey: KEY.privateKey }, (i, init) => rx.fetch(i, init), REVX_REGION, () => clock.now);
  // Every table the EXECUTOR writes, on every turn of every test: the paper engine's record must never be one of them.
  const executorWrites = new Set<string>();
  const db = mem.db;
  const executorDb: typeof db = {
    ...db,
    insert: (t, r, x) => { executorWrites.add(t); return db.insert(t, r, x); },
    upsert: (t, r, k) => { executorWrites.add(t); return db.upsert(t, r, k); },
    update: (t, q, p) => { executorWrites.add(t); return db.update(t, q, p); },
    claim: (t, q, p) => { executorWrites.add(t); return db.claim(t, q, p); },
  };
  const w = {
    mem, rx, clock, pauses, account, executorWrites,
    books: { "USDC-GBP": newBookState("USDC-GBP"), "USDT-GBP": newBookState("USDT-GBP") } as Record<QuoteBook, BookState>,
    paperEvents: [] as QuoteEvent[], paperTrips: [] as Trip[],
    series(kind: string) {
      return (mem.tables.agent_quote_inputs as Row[]).filter((r) => r.kind === kind).map((r) => [Date.parse(String(r.t)), Number(r.value)] as [number, number]).sort((a, b) => a[0] - b[0]);
    },
    /** The paper engine decides minute t with its own `stepMinute` on both books, and saves its state as `runQuotes` does. */
    async paperStep(t: number, prints: Partial<Record<QuoteBook, Print[]>> = {}) {
      const fx = w.series("fx");
      for (const b of QUOTE_BOOKS) {
        const out = stepMinute(w.books[b], t, { x: fxAt(t, fx), fairU: fairUAt(t, w.series(b === "USDC-GBP" ? "fair:USDC-USD" : "fair:USDT-USD")), prints: prints[b] ?? [] });
        w.paperEvents.push(...out.events); w.paperTrips.push(...out.trips);
      }
      await mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: w.books, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
    },
    /** The executor's turn after the paper engine decided minute t: 30 s into the next minute, as in production. */
    live(t: number, at = t + M + 30e3) {
      clock.now = at;
      const pause = (ms: number) => { pauses.taken.push(ms); if (pauses.advance) clock.now += ms; return Promise.resolve(); };
      return runQuotesLive({ db: executorDb, now: at, holder: `h${at}`, uuid: () => crypto.randomUUID(), account, accountNote: account ? null : "no key", fetch: rx.fetch, pause, clock: () => clock.now });
    },
    async step(t: number, prints: Partial<Record<QuoteBook, Print[]>> = {}) { await w.paperStep(t, prints); return await w.live(t); },
    async run(from: number, to: number) { let r; for (let t = from; t <= to; t += M) r = await w.step(t); return r!; },
    orders: () => mem.tables.agent_quote_live_orders as Row[],
    events: () => mem.tables.agent_quote_live_events as Row[],
    posts: () => rx.calls.filter((c) => c === "POST /api/1.0/orders").length,
    deletes: () => rx.calls.filter((c) => c.startsWith("DELETE /api/1.0/orders/")).length,
    open: (mode?: string) => (mem.tables.agent_quote_live_orders as Row[]).filter((r) => ["pending", "new", "partially_filled"].includes(String(r.state)) && (!mode || r.mode === mode)),
    setFx(from: number, to: number, value: number | null) {
      const rows = mem.tables.agent_quote_inputs as Row[];
      for (let i = rows.length - 1; i >= 0; i--) {
        const t = Date.parse(String(rows[i].t));
        if (rows[i].kind === "fx" && t >= from && t <= to) { if (value == null) rows.splice(i, 1); else rows[i].value = value; }
      }
    },
    /** A settled fill already on the book, inserted through the double's own checks. */
    async seed(r: Record<string, unknown>) {
      const [row] = await mem.db.insert<Row>("agent_quote_live_orders", { client_order_id: crypto.randomUUID(), state: "filled", ...r }, true);
      return row;
    },
  };
  return w;
}
const entryRows = (rows: Row[], mode = "live") => rows.filter((o) => o.leg === "entry" && o.mode === mode);
const ticks = (o: Row) => Math.round(Number(o.price) / QUOTE_TICK);

// ------------------------------------------------------------------ the pure rules

Deno.test("the rungs split the capital as the frozen shape does: £50 over twelve rungs, each order floored to the pair's step", () => {
  assertAlmostEquals(rungGbp(50), 50 / 12, 1e-12);
  assertEquals(rungBase(rungGbp(50), 0.7546, PAIR), "5.52168");
  assertEquals(Number(rungBase(rungGbp(50), 0.7562, PAIR)), handBase(0.7562));
  assertEquals(rungBase(0.05, 0.7546, PAIR), null);                          // £0.05 is under the venue's 0.1 minimum
  assertAlmostEquals(dustBase(PAIR, 0.7546), 0.1 / 0.7546, 1e-12);
  assertEquals([venueSideOf("bid", "entry"), venueSideOf("bid", "exit"), venueSideOf("ask", "entry"), venueSideOf("ask", "stop")], ["buy", "sell", "sell", "buy"]);
});

Deno.test("rungBase: a sell takes one base step more when it carries the proceeds over a whole penny — the venue floors a sell's GBP — and a buy stays floored", () => {
  // Fill 1184 (2026-10-01): 13.18565 USDT sold at 0.7584 is £9.99999696, and the venue credited £9.99.
  assertEquals(rungBase(10, 0.7584, GBP_BOOK_PAIR, "buy"), "13.18565");
  assertEquals(rungBase(10, 0.7584, GBP_BOOK_PAIR), "13.18565");                 // a buy by default
  assertEquals(rungBase(10, 0.7584, GBP_BOOK_PAIR, "sell"), "13.18566");         // £10.000004544: credited £10.00
  assertEquals(rungBase(10, 0.7591, GBP_BOOK_PAIR, "sell"), "13.17350");         // £10.000003850
  // A sell whose next step does not reach the next penny keeps the floor: £50 over twelve rungs at 0.7584.
  assertEquals([rungBase(50 / 12, 0.7584, GBP_BOOK_PAIR, "sell"), rungBase(50 / 12, 0.7584, GBP_BOOK_PAIR, "buy")], ["5.49402", "5.49402"]);
  // What the venue credits for each, floored to the penny: the step up is worth a penny, and costs a hundred-thousandth of a coin.
  const credited = (base: string, price: number) => Math.floor(Number(base) * price * 100 + 1e-9) / 100;
  assertEquals([credited("13.18565", 0.7584), credited(rungBase(10, 0.7584, GBP_BOOK_PAIR, "sell")!, 0.7584)], [9.99, 10]);
});

Deno.test("pennyExit: a resting exit trades to the penny the venue rounds to — a buy-back pays the penny below, a sell keeps the hair over its penny", () => {
  const dust = dustBase(GBP_BOOK_PAIR, 0.7578);
  const debited = (base: string, p: number) => Math.ceil(Number(base) * p * 100 - 1e-9) / 100;
  const credited = (base: string, p: number) => Math.floor(Number(base) * p * 100 + 1e-9) / 100;
  // The first live round trip (2026-10-01): the ask sold 13.18565 at 0.7584, the exit bought them back at 0.7578 for
  // £9.9920856 and was debited £10.00. Trimmed, it buys 13.18289 for £9.98999404, debited £9.99: a penny less, for
  // 0.00276 of a coin (£0.0021) the rung still owes and carries — 0.79p better, the 0.1 % rung's whole edge.
  assertEquals(pennyExit("buy", "13.18565", 0.7578, GBP_BOOK_PAIR, dust), "13.18289");
  assertEquals([debited("13.18565", 0.7578), debited("13.18289", 0.7578)], [10, 9.99]);
  // A bid rung's exit sells 13.21702 at 0.7574 (£10.01057), credited £10.01; 13.21627 is credited the same and keeps 0.00075.
  assertEquals(pennyExit("sell", "13.21702", 0.7574, GBP_BOOK_PAIR, dust), "13.21627");
  assertEquals([credited("13.21702", 0.7574), credited("13.21627", 0.7574)], [10.01, 10.01]);
  // Nothing to trim on a whole penny; nothing trimmed past the rung's dust, or under the venue's minimum.
  assertEquals(pennyExit("buy", "10.00000", 0.75, GBP_BOOK_PAIR, dust), "10.00000");
  assertEquals(pennyExit("sell", "10.00000", 0.75, GBP_BOOK_PAIR, dust), "10.00000");
  assertEquals(pennyExit("buy", "13.18565", 0.7578, GBP_BOOK_PAIR, 0.001), "13.18565");
  assertEquals(pennyExit("buy", "0.13200", 0.7578, GBP_BOOK_PAIR, dust), "0.13200");
});

Deno.test("rungBook: a bid rung's round trip and an ask rung's, in GBP; fees come off; dust is carried, never held against a stop", () => {
  const day = Date.parse("2026-09-24T00:00:00Z");
  const bid = rungBook("bid", [
    { id: 1, ts: day + H, leg: "entry", base: 5, price: 0.7546, feeGbp: 0 },
    { id: 2, ts: day + 2 * H, leg: "exit", base: 5, price: 0.7555, feeGbp: 0 },
  ], day);
  assertAlmostEquals(bid.realisedGbp, 5 * (0.7555 - 0.7546), 1e-12);
  assertEquals([bid.held, bid.openedAt], [0, null]);
  const ask = rungBook("ask", [
    { id: 1, ts: day - H, leg: "entry", base: 5, price: 0.7562, feeGbp: 0 },
    { id: 2, ts: day + H, leg: "stop", base: 5, price: 0.7600, feeGbp: 0.0034 },
  ], day);
  assertAlmostEquals(ask.realisedGbp, 5 * (0.7562 - 0.7600) - 0.0034, 1e-12);
  assertAlmostEquals(ask.realisedTodayGbp, ask.realisedGbp, 1e-12);          // the exit, and its fee, are today's
  // Dust: 0.05 of a coin cannot be sold (the venue's minimum is 0.1 GBP), so it opens no position; the next fill does.
  const dusty = rungBook("bid", [
    { id: 1, ts: day, leg: "entry", base: 0.05, price: 0.7546, feeGbp: 0 },
    { id: 2, ts: day + H, leg: "entry", base: 5, price: 0.7546, feeGbp: 0 },
  ], day, 0.13);
  assertEquals([dusty.held, dusty.openedAt], [5.05, day + H]);
  assertAlmostEquals(markedGbp("bid", dusty, 0.7500), 5.05 * (0.7500 - 0.7546), 1e-12);
  assertAlmostEquals(markedGbp("ask", ask, 0.75), 0, 0);                      // flat: nothing to mark
});

Deno.test("bookInputs and entryGuards: the rule's fair on the stored inputs, and each of the design's entry guards on its own", () => {
  const T = T0;
  const fx: Array<[number, number]> = [[T - 2 * M, X], [T - M, X]];
  const hours: Array<[number, number]> = Array.from({ length: 26 }, (_, i) => [T - (26 - i) * H, 1.0] as [number, number]);
  const i = bookInputs(T, fx, hours);
  assertAlmostEquals(i.f!, 1 / X, 1e-12);
  assertEquals([i.usdLast, i.usdHourEnd], [1.0, T]);
  assertEquals(entryGuards(T, i, 0.7554), []);
  // Dark: no GBP/USD minute in the last ten.
  assert(entryGuards(T, bookInputs(T, [[T - 11 * M, X]], hours), 0.7554).some((g) => g.includes("dark")));
  // The USD book's newest hour ended more than two hours before the minute.
  const old = hours.filter(([s]) => s <= T - 4 * H);
  assert(entryGuards(T, bookInputs(T, fx, old), 0.7554).some((g) => g.includes("stale inputs")));
  // De-peg, the USD way: the last hourly close 60 bps from the 24-hour median.
  const depeg: Array<[number, number]> = hours.map(([s, v]) => [s, s === T - H ? 1.006 : v]);
  assert(entryGuards(T, bookInputs(T, fx, depeg), 0.7554).some((g) => g.startsWith("de-peg: the USD book")));
  // … at 40 bps it is not one.
  assertEquals(entryGuards(T, bookInputs(T, fx, hours.map(([s, v]) => [s, s === T - H ? 1.004 : v])), 0.7554), []);
  // De-peg, the GBP way: the last print 60 bps from fair.
  assert(entryGuards(T, i, 0.7554 * 1.006).some((g) => g.startsWith("de-peg: the GBP book")));
});

Deno.test("the governor, the loss stop, the stop's bound and the book an order meets", () => {
  // Davies, 2026-10-01: entries to 900 a UTC day (600 before), stops only from 950 (700 before).
  assertEquals([QUOTE_LIVE_ENTRY_POSTS, QUOTE_LIVE_STOPS_ONLY_POSTS], [900, 950]);
  assertEquals([governorLevel(600), governorLevel(700), governorLevel(899), governorLevel(900), governorLevel(949), governorLevel(950)],
    ["all", "all", "all", "no-entries", "no-entries", "stops-only"]);
  assertEquals([lossStopHit(-0.49, 50), lossStopHit(-0.5, 50), lossStopHit(-0.6, 50)], [false, true, true]);
  assertEquals([stopDue(T0, T0 + DAY - 1), stopDue(T0, T0 + DAY), stopDue(null, T0 + 9 * DAY)], [false, true, false]);
  // fair 0.755401: a long sells no lower than 0.7517 (fair − 50 bps, rounded up); a short buys back no higher than 0.7591.
  assertEquals([stopLimitTicks(1 / X, "bid"), stopLimitTicks(1 / X, "ask")], [7517, 7591]);
  // The venue's public book, as `backtests/pr5_live/inputs/revx_books.json.gz` recorded it.
  const b = parseBook({ data: { asks: [{ count: 1, price: "0.7550", quantity: "31833.65559" }, { count: 1, price: "0.7556", quantity: "5000" }], bids: [{ count: 1, price: "0.7546", quantity: "900" }] } }, "public", "x")!;
  assertEquals([b.bestBid, b.bestAsk], [0.7546, 0.755]);
  assertEquals([crossesBook("buy", 0.7550, b), crossesBook("buy", 0.7549, b), crossesBook("sell", 0.7546, b), crossesBook("sell", 0.7547, b), crossesBook("buy", 1, null)], [true, false, true, false, null]);
  assertEquals(parseBook({ data: { bids: [{ p: "0.7390" }], asks: [{ p: "0.7410" }] } }, "paper", "x")!.bestAsk, 0.741);   // the paper engine's stub shape too
});

Deno.test("entryBookOf: dry-run by default; live needs dry_run off AND live_confirmed_at AND the key; the global pause outranks all", () => {
  const ok = { globalPause: false, riskReadable: true, canTrade: true };
  assertEquals(entryBookOf({ dry_run: true, live_confirmed_at: null }, ok).book, "dry_run");
  assertEquals(entryBookOf({ dry_run: true, live_confirmed_at: ARMED }, ok).book, "dry_run");        // armed is not live while dry_run is on
  assertEquals(entryBookOf({ dry_run: false, live_confirmed_at: null }, ok).book, null);             // the kill switch
  assertEquals(entryBookOf({ dry_run: false, live_confirmed_at: ARMED }, { ...ok, canTrade: false }).book, null);
  assertEquals(entryBookOf({ dry_run: false, live_confirmed_at: ARMED }, ok).book, "live");
  assertEquals(entryBookOf({ dry_run: false, live_confirmed_at: ARMED }, { ...ok, globalPause: true }).book, null);
  assertEquals(entryBookOf({ dry_run: true, live_confirmed_at: null }, { ...ok, riskReadable: false }).book, null);
});

Deno.test("bookLiveBuy, the tick's D11/D12 rule the executor books buys through: reported fee → floored; unreported → the account", () => {
  // D11: 5.5 − a coin fee at full precision falls between two steps; the base is the step below.
  assertEquals(bookLiveBuy(5.5 - 5.5 * 0.0009, "0.00001", null), { ok: true, base: 5.49505 });
  // D12: nothing reported; the account holds 20 − 0.00495 and the rest of the book explains 14.5 of it.
  const b = bookLiveBuy(5.5, "0.00001", { asset: "USDT", held: 20 - 0.00495, rest: 14.5, feeBps: 9 });
  assertEquals(b, { ok: true, base: 5.49505, fromAccount: { asset: "USDT", held: 20 - 0.00495, rest: 14.5, gross: 5.5 } });
  // A shortfall no fee explains books nothing.
  assertEquals(bookLiveBuy(5.5, "0.00001", { asset: "USDT", held: 19, rest: 14.5, feeBps: 9 }).ok, false);
});

Deno.test("paperEntryTarget: a quoting paper rung's order is the target; idle, holding, exiting or refused is none", () => {
  const s = newBookState("USDC-GBP");
  stepMinute(s, T0, { x: X, fairU: 1.0, prints: [] });
  const t = paperEntryTarget(s.rungs[0])!;
  assertEquals([t.ticks, t.live], [7546, T0 + M]);
  assertEquals(paperEntryTarget(newBookState("USDC-GBP").rungs[0]), null);
  assertEquals(paperEntryTarget({ ...s.rungs[0], mode: "position" }), null);
  // A print under the bids before they go live: the engine refuses them, and a refused order is no target.
  stepMinute(s, T0 + M, { x: X, fairU: 1.0, prints: [] });
  const r = newBookState("USDC-GBP");
  stepMinute(r, T0, { x: X, fairU: 1.0, prints: [{ ts: T0 + 20e3, ticks: 7530, qty: 50, side: "sell", id: "p" }] });
  stepMinute(r, T0 + M, { x: X, fairU: 1.0, prints: [] });
  assertEquals([s.rungs[0].o!.state, paperRefused(s.rungs[0]), paperEntryTarget(s.rungs[0])?.ticks], ["live", false, 7546]);
  assertEquals([r.rungs[0].o!.state, paperRefused(r.rungs[0]), paperEntryTarget(r.rungs[0])], ["rejected", true, null]);
});

// ------------------------------------------------------------------ the double is as strict as the database

Deno.test("the in-memory database refuses what 0052 refuses: a second open order on a rung, a bad client id, a rung-less entry", async () => {
  const w = makeWorld();
  const base = { mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 5.5 };
  await w.mem.db.insert("agent_quote_live_orders", { ...base, client_order_id: crypto.randomUUID(), state: "new" });
  let err = "";
  try { await w.mem.db.insert("agent_quote_live_orders", { ...base, client_order_id: crypto.randomUUID(), state: "pending" }); } catch (e) { err = String(e); }
  assert(err.includes("agent_quote_live_orders_one_open_per_rung"), err);
  // The same rung in the OTHER mode is another book, and a settled row is no claim.
  await w.mem.db.insert("agent_quote_live_orders", { ...base, mode: "dry_run", client_order_id: crypto.randomUUID(), state: "new" });
  await w.mem.db.insert("agent_quote_live_orders", { ...base, client_order_id: crypto.randomUUID(), state: "cancelled" });
  // An UPDATE that would reopen a second order on the rung is refused too.
  const closed = (w.orders()).find((o) => o.state === "cancelled")!;
  err = "";
  try { await w.mem.db.update("agent_quote_live_orders", `id=eq.${closed.id}`, { state: "new" }); } catch (e) { err = String(e); }
  assert(err.includes("one_open_per_rung"), err);
  err = "";
  try { await w.mem.db.insert("agent_quote_live_orders", { ...base, k: 0.002, client_order_id: "not-a-uuid" }); } catch (e) { err = String(e); }
  assert(err.includes("uuid"), err);
  err = "";
  try { await w.mem.db.insert("agent_quote_live_orders", { ...base, k: 0.002, leg: "convert", client_order_id: crypto.randomUUID() }); } catch (e) { err = String(e); }
  assert(err.includes("agent_quote_live_orders_check"), err);
  // A conversion belongs to no rung, so it is outside the one-per-rung index.
  await w.mem.db.insert("agent_quote_live_orders", { ...base, rung_side: null, k: null, leg: "convert", client_order_id: crypto.randomUUID(), state: "pending" });
  await w.mem.db.insert("agent_quote_live_orders", { ...base, rung_side: null, k: null, leg: "convert", client_order_id: crypto.randomUUID(), state: "pending" });
});

// ------------------------------------------------------------------ dry-run: the default

Deno.test("dry-run, the default: every order it would send is recorded — price, size, client id, the book it met — and no order endpoint is called", async () => {
  const w = makeWorld();                                   // dry_run on and unarmed, as 0052 leaves it; the key loads
  const r = await w.step(T0);
  assertEquals(r.errors, []);
  assertEquals(r.entryBook, "dry_run");
  const bids = entryRows(w.orders(), "dry_run").sort((a, b) => String(a.book).localeCompare(String(b.book)) || Number(a.k) - Number(b.k));
  // The six bids, at the paper engine's own prices (fair 1/1.3238 = 0.755401, 0.1/0.2/0.3 % under, rounded down) …
  assertEquals(bids.map((o) => [o.book, Number(o.k), o.side, o.state, Number(o.price)]), [
    ["USDC-GBP", 0.001, "buy", "new", 0.7546], ["USDC-GBP", 0.002, "buy", "new", 0.7538], ["USDC-GBP", 0.003, "buy", "new", 0.7531],
    ["USDT-GBP", 0.001, "buy", "new", 0.7546], ["USDT-GBP", 0.002, "buy", "new", 0.7538], ["USDT-GBP", 0.003, "buy", "new", 0.7531],
  ]);
  for (const o of bids) {
    assertEquals(Number(o.base_size), handBase(Number(o.price)));                        // … each a twelfth of £50
    assert(/^[0-9a-f-]{36}$/.test(String(o.client_order_id)));
    assertEquals((o.book_seen as { bestBid: number }).bestBid, o.book === "USDC-GBP" ? 0.7548 : 0.7546);   // the book it met
    const ev = w.paperEvents.find((e) => e.kind === "order" && e.book === o.book && e.side === o.rung_side && e.k === Number(o.k));
    assertEquals([o.paper_oid, o.paper_live], [(ev!.detail as { oid: number }).oid, iso(T0 + M)]);   // … and the paper order it carries out
  }
  // The asks are SKIPPED, not errors: the account holds GBP only. One skip per rung and paper decision.
  const skips = w.events().filter((e) => e.kind === "skip");
  assertEquals(skips.length, 6);
  assert(skips.every((e) => e.rung_side === "ask" && String((e.detail as { reason: string }).reason).startsWith("no USD")));
  // Nothing reached an order endpoint; the account's balances were read (the dry-run on the real account).
  assert(!w.rx.calls.some((c) => /^(POST|DELETE) \/api\/1\.0\/orders/.test(c)), w.rx.calls.join(" | "));
  assert(w.rx.calls.includes("GET /api/1.0/balances"));
  assertEquals(w.rx.orders.size, 0);
  // Another minute with no new decision records nothing new, and skips the same decisions once only.
  await w.step(T0 + M);
  assertEquals([entryRows(w.orders(), "dry_run").length, w.events().filter((e) => e.kind === "skip").length], [6, 6]);
});

Deno.test("before migration 0052 is applied the executor says so and does nothing — not an error every minute", async () => {
  const w = makeWorld();
  delete (w.mem.tables as Record<string, unknown>).agent_quote_live_config;
  const db = { ...w.mem.db, select: ((t: string, q: string) => t === "agent_quote_live_config" ? Promise.reject(new Error(`db GET ${t} → 404: {"code":"PGRST205","message":"Could not find the table 'public.agent_quote_live_config' in the schema cache"}`)) : w.mem.db.select(t, q)) as typeof w.mem.db.select };
  await w.paperStep(T0);
  const r = await runQuotesLive({ db, now: T0 + M + 30e3, holder: "h", uuid: () => crypto.randomUUID(), account: w.account, fetch: w.rx.fetch, pause: () => Promise.resolve() });
  assertEquals([r.errors, r.skipped], [[], "the live tables are not in this database yet: migration 0052 has not run"]);
  assertEquals(w.rx.calls, []);
});

Deno.test("dry-run without the key assumes the capital, all GBP, and still sends nothing", async () => {
  const w = makeWorld({ key: false });
  const r = await w.step(T0);
  assertEquals([r.entryBook, entryRows(w.orders(), "dry_run").length, w.rx.calls.length > 0 && w.rx.calls.every((c) => c.startsWith("GET /api/") && c.includes("/public/"))], ["dry_run", 6, true]);
});

Deno.test("dry-run records a post-only order the book it met would have refused as refused, and does not record that decision again", async () => {
  const w = makeWorld();
  w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7530, ask: 0.7540 };           // the 0.1 % bid at 0.7546 would cross the 0.7540 ask
  await w.step(T0);
  const refused = w.orders().filter((o) => o.state === "rejected");
  assertEquals(refused.map((o) => [o.book, Number(o.k), Number(o.price)]), [["USDC-GBP", 0.001, 0.7546]]);
  assertEquals((refused[0].response as { wouldBeRefused: boolean }).wouldBeRefused, true);
  await w.step(T0 + M);
  await w.step(T0 + 2 * M);
  assertEquals(w.orders().filter((o) => o.book === "USDC-GBP" && Number(o.k) === 0.001).length, 1);
});

// ------------------------------------------------------------------ live: the paper's decisions, order for order

Deno.test("live: entries carry out the paper engine's decisions order for order — one POST each, a re-price is a confirmed cancel then a place, a withdrawal cancels", async () => {
  const w = makeWorld({ live: true, armed: true });
  const r0 = await w.step(T0);
  assertEquals([r0.errors, r0.entryBook], [[], "live"]);
  assertEquals(w.rx.resting().map((o) => [o.symbol, o.side, o.price, o.tif, o.postOnly]).sort(), [
    ["USDC/GBP", "buy", "0.7531", "gtc", true], ["USDC/GBP", "buy", "0.7538", "gtc", true], ["USDC/GBP", "buy", "0.7546", "gtc", true],
    ["USDT/GBP", "buy", "0.7531", "gtc", true], ["USDT/GBP", "buy", "0.7538", "gtc", true], ["USDT/GBP", "buy", "0.7546", "gtc", true],
  ]);
  assertEquals(w.posts(), 6);
  // A minute with no new paper decision sends nothing.
  await w.step(T0 + M);
  assertEquals([w.posts(), w.deletes()], [6, 0]);
  // GBP/USD moves to 1.3300 (0.47 %): the paper engine re-prices every quote, and so does the live book — each cancel
  // read back as cancelled before its replacement goes out, so the venue never holds two orders on one rung.
  w.setFx(T0 + M, T0 + 30 * H, 1.3300);
  await w.step(T0 + 2 * M);
  assertEquals([w.posts(), w.deletes()], [12, 6]);
  assertEquals(w.rx.resting().map((o) => o.price).sort(), ["0.7496", "0.7496", "0.7503", "0.7503", "0.7511", "0.7511"]);
  assert(w.orders().filter((o) => o.state === "cancelled").every((o) => o.cancel_reason === "the paper engine re-priced this rung"));
  // Every live entry is a paper order: the same rung, the same ticks, the same decision (order id and live minute).
  for (const o of entryRows(w.orders())) {
    const ev = w.paperEvents.find((e) => e.kind === "order" && e.book === o.book && e.side === o.rung_side && e.k === Number(o.k)
      && e.minute === Date.parse(String(o.paper_live)) - M && (e.detail as { oid: number }).oid === o.paper_oid);
    assert(ev && ev.ticks === ticks(o), JSON.stringify(o));
  }
  // Dark: GBP/USD stops. Once its last minute is ten old the paper engine withdraws, and the live quotes are cancelled.
  w.setFx(T0 + 2 * M, T0 + 30 * H, null);
  await w.run(T0 + 3 * M, T0 + 13 * M);
  assertEquals([w.rx.resting().length, w.posts()], [0, 12]);
});

Deno.test("live: a post-only order the venue refuses is the refused state — that decision is not sent again; the paper's next decision is", async () => {
  for (const how of ["status", "http-400"] as const) {
    const w = makeWorld({ live: true, armed: true });
    w.rx.postOnlyRefusal = how;
    w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7530, ask: 0.7540 };        // the 0.1 % bid at 0.7546 crosses the ask
    await w.step(T0);
    await w.step(T0 + M);                                             // read back (or refused at once): rejected
    const rung = () => w.orders().filter((o) => o.book === "USDC-GBP" && Number(o.k) === 0.001);
    assertEquals(rung().map((o) => o.state), ["rejected"], how);
    await w.run(T0 + 2 * M, T0 + 4 * M);
    assertEquals(rung().length, 1, `${how}: the same decision is never sent twice`);
    // The paper engine re-prices (GBP/USD up): a new decision, sent once; this one rests below the 0.7540 ask.
    w.setFx(T0 + 4 * M, T0 + 30 * H, 1.3300);
    await w.step(T0 + 5 * M);
    assertEquals(rung().map((o) => [o.state, Number(o.price)]), [["rejected", 0.7546], ["new", 0.7511]], how);
  }
});

/** Reference §4 item 35's L3 and L4 on the double: every entry is the paper order it names, at that order's ticks, and every paper bid decision was carried out. */
function orderForOrder(w: ReturnType<typeof makeWorld>, mode: string) {
  const entries = entryRows(w.orders(), mode);
  const oid = (e: QuoteEvent) => (e.detail as { oid: number }).oid;
  const l3 = entries.filter((o) => !w.paperEvents.some((e) => e.kind === "order" && e.book === o.book && e.side === o.rung_side && e.k === Number(o.k)
    && e.minute === Date.parse(String(o.paper_live)) - M && oid(e) === o.paper_oid && e.ticks === ticks(o)));
  const l4 = w.paperEvents.filter((e) => e.kind === "order" && e.side === "bid" && (e.detail as { leg: string }).leg === "entry")
    .filter((e) => !entries.some((o) => o.book === e.book && o.rung_side === e.side && Number(o.k) === e.k && o.paper_oid === oid(e) && Date.parse(String(o.paper_live)) === e.minute + M));
  return { l3: l3.map((o) => [o.book, Number(o.k), ticks(o), o.paper_live]), l4: l4.map((e) => [e.book, e.k, e.ticks, iso(e.minute)]) };
}

// Production, 2026-09-24 12:36–12:50 UTC, USDT-GBP's 0.2 % bid (dry-run order 108): the paper engine refused its order at
// go-live (a print below it), the venue's book would have taken it, the rule re-priced the refused order without placing
// it, and the executor sent those ticks under the refused decision's name, then had nothing to send when the rule placed it.
Deno.test("a refused paper order is no decision: the rung withdraws and sends nothing, whatever the rule re-prices it to, until the rule places it again", async () => {
  for (const mode of ["dry_run", "live"] as const) {
    const w = makeWorld(mode === "live" ? { live: true, armed: true } : {});
    const sent = () => mode === "live" ? w.posts() : entryRows(w.orders(), mode).length;
    const usdt = (k: number) => entryRows(w.orders(), mode).filter((o) => o.book === "USDT-GBP" && Number(o.k) === k);
    const openUsdt = () => w.open(mode).filter((o) => o.book === "USDT-GBP" && o.leg === "entry").map((o) => [Number(o.k), ticks(o), o.paper_live]).sort();
    // Minute T0: six bids at 7546 / 7538 / 7531, and a USDT-GBP print at 7530 under all three before they go live.
    await w.step(T0, { "USDT-GBP": [{ ts: T0 + 20e3, ticks: 7530, qty: 50, side: "sell", id: "p1" }] });
    assertEquals(sent(), 6, mode);
    // T0 + 1 min: the paper engine refuses USDT-GBP's three bids; the venue's book (0.7546 / 0.7551) would not have.
    await w.step(T0 + M);
    assertEquals(w.paperEvents.filter((e) => e.kind === "refused").map((e) => [e.book, e.k, e.ticks]), [["USDT-GBP", 0.001, 7546], ["USDT-GBP", 0.002, 7538], ["USDT-GBP", 0.003, 7531]]);
    assertEquals(openUsdt(), [], `${mode}: the refused orders are withdrawn`);
    assert([0.001, 0.002, 0.003].every((k) => String(usdt(k)[0].cancel_reason).includes("refused")), mode);
    assertEquals(sent(), 6, mode);
    // GBP/USD 1.3250 (fair −0.09 %): the rule re-prices the refused 0.1 % and 0.2 % bids to 7539 / 7532, still under the
    // print, so it places neither; the 0.3 % bid at 7524 is off the print and placed again, and USDC-GBP re-prices.
    w.setFx(T0 + M, T0 + 30 * H, 1.3250);
    await w.step(T0 + 2 * M);
    assertEquals(openUsdt(), [[0.003, 7524, iso(T0 + 3 * M)]], mode);
    assertEquals(sent(), 10, mode);
    // A print at 7545 lifts the block: the rule places the two at 7539 / 7532 (live T0 + 5 min), and each is sent once.
    await w.step(T0 + 3 * M, { "USDT-GBP": [{ ts: T0 + 3 * M + 20e3, ticks: 7545, qty: 50, side: "buy", id: "p2" }] });
    await w.step(T0 + 4 * M);
    assertEquals(openUsdt(), [[0.001, 7539, iso(T0 + 5 * M)], [0.002, 7532, iso(T0 + 5 * M)], [0.003, 7524, iso(T0 + 3 * M)]], mode);
    assertEquals(sent(), 12, mode);
    assertEquals(orderForOrder(w, mode), { l3: [], l4: [] }, mode);
  }
});

// Production, 2026-09-24 02:41 UTC (dry-run order 4): the executor's first minute found a bid the paper engine had refused
// at 00:18 and since re-priced, and recorded it at the re-priced ticks under the 00:18 decision.
Deno.test("the executor's first turn finds a paper order already refused and re-priced: nothing is sent for it", async () => {
  const w = makeWorld();
  await w.paperStep(T0, { "USDT-GBP": [{ ts: T0 + 20e3, ticks: 7530, qty: 50, side: "sell", id: "p1" }] });
  await w.paperStep(T0 + M);
  w.setFx(T0 + M, T0 + 30 * H, 1.3250);
  await w.paperStep(T0 + 2 * M);
  await w.live(T0 + 2 * M);
  assertEquals(entryRows(w.orders(), "dry_run").filter((o) => o.book === "USDT-GBP").map((o) => [Number(o.k), ticks(o), o.paper_live]), [[0.003, 7524, iso(T0 + 3 * M)]]);
  assertEquals(orderForOrder(w, "dry_run").l3, []);
});

Deno.test("live: every order is written pending BEFORE the venue is called, and a lost reply is reconciled by client id, never re-sent", async () => {
  const w = makeWorld({ live: true, armed: true });
  let pendingAtPost = 0;
  w.rx.onPost = () => { pendingAtPost += w.orders().filter((o) => o.state === "pending").length > 0 ? 1 : 0; };
  w.rx.loseReply = true;                                              // the venue takes each order; no reply arrives
  const r0 = await w.step(T0);
  assertEquals(pendingAtPost, 6);                                     // the row existed when each POST went out
  assertEquals([w.orders().map((o) => o.state), w.rx.resting().length], [Array(6).fill("pending"), 6]);
  assert(r0.errors.every((e) => e.includes("left pending for the next turn to reconcile by client id")));
  w.rx.loseReply = false;
  await w.step(T0 + M);                                               // found among the active orders, by client id
  assertEquals(w.orders().map((o) => [o.state, o.venue_order_id != null]), Array(6).fill(["new", true]));
  assertEquals(w.posts(), 6);                                         // nothing sent twice
});

Deno.test("live: an order the venue shows nowhere stays pending for a person — never rejected on a guess — and its rung places nothing", async () => {
  const w = makeWorld({ live: true, armed: true });
  const inner = w.rx.fetch;
  let drop = true;                                                    // the request never reached the venue
  w.rx.fetch = (input, init) => {
    const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
    if (drop && p === "/api/1.0/orders" && m === "POST") { w.rx.calls.push("POST /api/1.0/orders"); return Promise.reject(new TypeError("connection reset")); }
    return inner(input, init);
  };
  await w.step(T0);
  drop = false;
  const r = await w.step(T0 + M);
  assertEquals(w.orders().map((o) => o.state), Array(6).fill("pending"));
  assert(r.errors.some((e) => e.includes("stays pending for a person to settle")), JSON.stringify(r.errors));
  await w.step(T0 + 2 * M);
  assertEquals([w.orders().length, w.orders().every((o) => o.state === "pending"), w.rx.orders.size], [6, true, 0]);
});

Deno.test("live: a cancel the venue does not carry out FREEZES the rung — no replacement until the read-back shows it cancelled", async () => {
  const w = makeWorld({ live: true, armed: true });
  await w.step(T0);
  w.rx.cancelMode = "lost";                                            // DELETE says 204; the order stays on the book
  w.setFx(T0, T0 + 30 * H, 1.3300);                                   // the paper engine re-prices at T0+M
  const r1 = await w.step(T0 + M);
  assertEquals([w.posts(), w.rx.resting().length], [6, 6]);           // no replacement went out: one order per rung, still
  // The first turn's freeze is the venue a moment behind, as far as anyone can tell: frozen, read again twice, no error.
  assertEquals(r1.errors.filter((e) => e.includes("FROZEN")), []);
  assertEquals(r1.cancelled.filter((c) => c.outcome === "frozen").length, 6);
  assert(w.open("live").every((o) => o.cancel_requested_at != null));
  const r2 = await w.step(T0 + 2 * M);                                 // a minute on, still not done: still frozen, asked again,
  assertEquals([w.posts(), w.rx.resting().length], [6, 6]);           // and now it is an error, once a rung
  assertEquals(r2.errors.filter((e) => e.includes("FROZEN") && e.includes("first asked at")).length, 6, JSON.stringify(r2.errors));
  w.rx.cancelMode = "ok";
  await w.step(T0 + 3 * M);                                            // confirmed at last: the replacements go out
  assertEquals([w.posts(), w.rx.resting().map((o) => o.price).sort()], [12, ["0.7496", "0.7496", "0.7503", "0.7503", "0.7511", "0.7511"]]);
  // A cancel whose reply is lost after it took effect is confirmed by the read-back all the same.
  w.rx.cancelMode = "timeout";
  w.setFx(T0 + 3 * M, T0 + 30 * H, X);
  await w.step(T0 + 4 * M);
  assertEquals([w.rx.resting().length, w.posts()], [6, 18]);
});

Deno.test("live: the venue carries a cancel out a moment after its 204 (PR5's first live hour) — read again, confirmed in the same turn, replaced, no error", async () => {
  const w = makeWorld({ live: true, armed: true });
  assertEquals(w.rx.cancelLagReads, 1);                                // the double as the venue was measured
  await w.step(T0);
  w.setFx(T0, T0 + 30 * H, 1.3300);                                   // the paper engine re-prices every quote at T0+M
  const r = await w.step(T0 + M);
  // Each read-back straight after the DELETE says `new`; one pause later it says cancelled, and the replacement goes out.
  assertEquals([w.posts(), w.deletes(), w.rx.resting().length], [12, 6, 6]);
  assertEquals(r.errors, []);
  assertEquals(r.cancelled.map((c) => c.outcome), Array(6).fill("cancelled"));
  assertEquals(w.pauses.taken.filter((ms) => ms === QUOTE_LIVE_CANCEL_REREAD_MS[0]).length, 6);
  assertEquals(w.pauses.taken.filter((ms) => ms === QUOTE_LIVE_CANCEL_REREAD_MS[1]).length, 0);
  assertEquals(w.rx.resting().map((o) => o.price).sort(), ["0.7496", "0.7496", "0.7503", "0.7503", "0.7511", "0.7511"]);
  assert(w.orders().filter((o) => o.state === "cancelled").every((o) => o.cancel_requested_at != null && o.cancelled_at != null));
});

Deno.test("live: a cancel slower than the re-reads freezes its rung for a turn without an error; the next turn confirms it and replaces it", async () => {
  const w = makeWorld({ live: true, armed: true });
  await w.step(T0);
  w.rx.cancelLagReads = 3;                                             // open on the read-back and both re-reads
  w.setFx(T0, T0 + 30 * H, 1.3300);
  const r1 = await w.step(T0 + M);
  assertEquals([w.posts(), w.rx.resting().length], [6, 6]);           // never two orders on a rung
  assertEquals(r1.errors, []);
  assertEquals(r1.cancelled.map((c) => c.outcome), Array(6).fill("frozen"));
  assertEquals(w.pauses.taken.filter((ms) => (QUOTE_LIVE_CANCEL_REREAD_MS as readonly number[]).includes(ms)), Array(6).fill([...QUOTE_LIVE_CANCEL_REREAD_MS]).flat());
  const r2 = await w.step(T0 + 2 * M);                                 // the venue has carried them out by now
  assertEquals(r2.errors, []);
  assertEquals([w.posts(), w.rx.resting().length], [12, 6]);
  assertEquals(w.rx.resting().map((o) => o.price).sort(), ["0.7496", "0.7496", "0.7503", "0.7503", "0.7511", "0.7511"]);
});

Deno.test("live: a fill is booked only from the venue's read-back — the paper's print fills nothing live, the venue's fill is the position", async () => {
  const w = makeWorld({ live: true, armed: true });
  await w.step(T0);
  // A print strictly through the 0.1 % USDC bid fills the PAPER rung. The venue has not filled ours: no live position,
  // and since that paper rung now quotes nothing, the live bid is withdrawn.
  await w.step(T0 + M, { "USDC-GBP": [{ ts: T0 + M + 5e3, ticks: 7540, qty: 500, side: "sell", id: "p1" }] });
  assertEquals(w.books["USDC-GBP"].rungs[0].mode, "position");
  await w.step(T0 + 2 * M);
  const r1 = w.orders().filter((o) => o.book === "USDC-GBP" && Number(o.k) === 0.001);
  assertEquals(r1.map((o) => [o.state, Number(o.filled_base), o.cancel_reason]), [["cancelled", 0, "the paper rung quotes nothing"]]);
  // The venue fills OUR 0.2 % USDT bid; the paper rung saw no print. The read-back is the fill, and the exit goes out at
  // fair by the rule's own rounding (a long sells at fair rounded up: 0.7555), post-only, for the least coin the venue
  // credits the same penny (`pennyExit`): 5.51953 (£4.17000…), where all 5.52754 (£4.17605…) would also be credited £4.17.
  const bid = w.rx.resting("USDT/GBP").find((o) => o.price === "0.7538")!;
  w.rx.fillResting(bid.id, Number(bid.quantity));
  await w.step(T0 + 3 * M);
  const entry = w.orders().find((o) => o.venue_order_id === bid.id)!;
  assertEquals([entry.state, Number(entry.filled_base), Number(entry.avg_fill_price), Number(entry.fee_gbp)], ["filled", 5.52754, 0.7538, 0]);
  const exit = w.orders().find((o) => o.leg === "exit")!;
  assertEquals([exit.book, Number(exit.k), exit.side, Number(exit.price), Number(exit.base_size), (exit.request as { postOnly: boolean }).postOnly, exit.state], ["USDT-GBP", 0.002, "sell", 0.7555, 5.51953, true, "new"]);
  assertEquals(w.books["USDT-GBP"].rungs[1].mode, "quote");          // the paper rung never filled
  // The exit fills; the round trip is the venue's on what it sold, 5.51953 × (0.7555 − 0.7538) GBP, and the 0.00801 kept
  // is dust on the rung, carried into its next trip and marked as any holding is: this book has no print, so at fair (1 / X).
  w.rx.fillResting(String(exit.venue_order_id), 5.51953);
  const r = await w.step(T0 + 4 * M);
  assertAlmostEquals(r.dayPnlGbp!, 5.51953 * (0.7555 - 0.7538) + 0.00801 * (1 / X - 0.7538), 1e-8);   // the report keeps 8 decimals
  // Flat again (its dust is under the venue's minimum), the rung carries out the paper's order once more.
  assertEquals(w.open("live").filter((o) => o.book === "USDT-GBP" && Number(o.k) === 0.002).map((o) => [o.leg, Number(o.price)]), [["entry", 0.7538]]);
});

Deno.test("live: a fill is booked at the pounds the venue moved — fill 1184's shape books the £9.99 credited (its 0.7576 average booked £9.98945), its buy-back the debit, and the rung's book is the account's", async () => {
  const w = makeWorld({ live: true, armed: true, capital: 120, balances: { GBP: 120, USDT: 13.18565 } });
  w.rx.settlement = "venue";                                            // whole pennies, as every live fill showed
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7552, ask: 0.7558 };            // the ask rests over the bid, its buy-back under the ask
  // Order 1184 as it was placed (2026-10-01 16:42 UTC), before `rungBase` sized a sell one step up: 13.18565 USDT at 0.7584.
  const cid = crypto.randomUUID();
  const placed = await w.account!.placeLimit({ clientOrderId: cid, symbol: "USDT/GBP", side: "sell", base: "13.18565", price: "0.7584" });
  assert(placed.ok && placed.state === "new", JSON.stringify(placed));
  await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.001, leg: "entry", side: "sell", price: 0.7584, base_size: 13.18565,
    client_order_id: cid, venue_order_id: placed.venueOrderId, state: "new", filled_base: 0, request: { postOnly: true }, ts: iso(T0 - 10 * M) });
  const gbp = () => w.rx.balances.GBP;
  let before = gbp();
  w.rx.fillResting(placed.venueOrderId, 13.18565);
  const credited = Math.round((gbp() - before) * 100) / 100;
  assertEquals(credited, 9.99);                                         // £9.99999696 credited £9.99, as on 2026-10-01
  await w.step(T0);
  const sold = w.orders().find((o) => o.client_order_id === cid)!;
  const reply = sold.response as Row;
  assertEquals([sold.state, Number(sold.filled_base), reply.filled_amount, reply.average_fill_price], ["filled", 13.18565, "9.99", "0.7576"]);   // 1184's own reply
  assertEquals(Number(sold.filled_base) * Number(sold.avg_fill_price), 9.99);
  // The rung holds the short and buys it back, trimmed to the penny below (`pennyExit`); the venue debits the penny above.
  const exit = w.orders().find((o) => o.leg === "exit" && o.book === "USDT-GBP" && o.rung_side === "ask")!;
  assert(exit && exit.state === "new", JSON.stringify(w.orders().filter((o) => o.leg !== "entry")));
  before = gbp();
  w.rx.fillResting(String(exit.venue_order_id), Number(exit.base_size));
  const debited = Math.round((before - gbp()) * 100) / 100;
  await w.step(T0 + M);
  const bought = w.orders().find((o) => o.id === exit.id)!;
  assertEquals(bought.state, "filled");
  assert(Math.abs(Number(bought.filled_base) * Number(bought.avg_fill_price) - debited) < 1e-12, `${Number(bought.filled_base) * Number(bought.avg_fill_price)} against ${debited}`);
  // The rung's book by the executor's own arithmetic: what it realised, and the hair it still owes at the price it sold that
  // hair for, together are the pounds the two fills moved — the £0.00055 the average lost is not in it.
  const fills = [sold, bought].map((o) => ({ id: Number(o.id), ts: Date.parse(String(o.filled_at ?? o.ts)), leg: o.leg as "entry" | "exit", base: Number(o.filled_base), price: Number(o.avg_fill_price), feeGbp: Number(o.fee_gbp) }));
  const book = rungBook("ask", fills, 0);
  const owed = Math.round((13.18565 - Number(bought.filled_base)) * 1e5) / 1e5;
  assertAlmostEquals(book.held, owed, 1e-12);
  assert(Math.abs(book.realisedGbp + owed * book.avgEntry - (credited - debited)) < 1e-12, `${book.realisedGbp} + ${owed} × ${book.avgEntry} against ${credited - debited}`);
});

Deno.test("live: a taker conversion books the £30.00 the venue debited, its coin fee booked net (D4) — the double answers as order 1154 was answered, field for field", async () => {
  const w = makeWorld({ live: true, armed: true, capital: 120, balances: { GBP: 120 } });
  w.rx.settlement = "venue";
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7568, ask: 0.7572 };            // 1154 took the ask at 0.7572 (2026-10-01 16:31 UTC)
  await w.paperStep(T0);
  const now = T0 + M + 30e3;
  const sent = await runQuotesConvert({ db: w.mem.db, now, holder: "op", uuid: () => crypto.randomUUID(), account: w.account, fetch: w.rx.fetch, pause: () => Promise.resolve(), clock: () => now },
    { book: "USDT-GBP", gbp: 30, send: true, taker: true });
  assert(!sent.error, JSON.stringify(sent));
  await w.step(T0 + M);                                                 // the minute loop settles it from the venue
  const conv = w.orders().find((o) => o.leg === "convert")!;
  const reply = conv.response as Row;
  assertEquals([conv.state, reply.filled_quantity, reply.filled_amount, reply.average_fill_price, reply.total_fee, reply.fee_currency],
    ["filled", "39.61965", "30", "0.7572", "0.03566", "USDT"]);         // 1154's reply: £29.99999898 debited £30, the fee in the coin
  assertEquals(Number(conv.filled_base), 39.58399);                     // net of the coin fee, as the account received it
  assertAlmostEquals(Number(conv.filled_base), w.rx.balances.USDT, 1e-9);
  // Booked at the pounds debited: the coins held and the coins taken as the fee cost £30.00 (the 0.7572 average booked £29.99999898).
  const cost = Number(conv.filled_base) * Number(conv.avg_fill_price) + Number(conv.fee_gbp);
  assert(Math.abs(cost - 30) < 1e-12, String(cost));
});

Deno.test("live: a partial entry fill — the rest is withdrawn (confirmed) and the exit sells what filled; a dust fill keeps the entry resting", async () => {
  const w = makeWorld({ live: true, armed: true });
  await w.step(T0);
  const bid = w.rx.resting("USDC/GBP").find((o) => o.price === "0.7546")!;
  w.rx.fillResting(bid.id, 2);
  await w.step(T0 + M);                                               // read back partially filled: held 2, the rest cancelled
  const row = w.orders().find((o) => o.venue_order_id === bid.id)!;
  assertEquals([row.state, Number(row.filled_base), w.rx.orders.get(bid.id)!.status], ["filled", 2, "cancelled"]);
  await w.step(T0 + 2 * M);
  const exit = w.orders().find((o) => o.leg === "exit")!;
  assertEquals([Number(exit.base_size), Number(exit.price)], [1.99868, 0.7555]);   // 2 × 0.7555 is credited £1.51; so is 1.99868
  // Dust: 0.05 of a coin (£0.04) cannot be sold under the venue's 0.1 GBP minimum, so it is no position and the entry rests on.
  const bid2 = w.rx.resting("USDC/GBP").find((o) => o.price === "0.7538")!;
  w.rx.fillResting(bid2.id, 0.05);
  await w.step(T0 + 3 * M);
  assertEquals([w.rx.orders.get(bid2.id)!.status, w.orders().filter((o) => o.leg === "exit").length], ["partially_filled", 1]);
});

Deno.test("live: D11/D12 — a stop's buy-back whose coin fee is taken and not reported is booked from the account; one reported at full precision is floored", async () => {
  for (const reported of [false, true]) {
    const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDT: 20 } });
    // The account's USDT came from a conversion, on the book like any order; then the 0.1 % ask sold 5.51 of it 25 h ago.
    await w.seed({ mode: "live", book: "USDT-GBP", leg: "convert", side: "buy", price: 0.7560, base_size: 20, filled_base: 20, avg_fill_price: 0.7560, ts: iso(T0 - 30 * H), filled_at: iso(T0 - 30 * H) });
    await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.001, leg: "entry", side: "sell", price: 0.7562, base_size: 5.51, filled_base: 5.51, avg_fill_price: 0.7562, ts: iso(T0 - 25 * H), filled_at: iso(T0 - 25 * H) });
    w.rx.balances = { GBP: 50 - 20 * 0.7560 + 5.51 * 0.7562, USDT: 20 - 5.51 };
    w.rx.dialect = reported ? "documented" : "no-fee";
    const inner = w.rx.fetch;
    const coinFee = new Map<string, number>();
    w.rx.fetch = async (input, init) => {
      const p = new URL(String(input)).pathname, m = (init?.method ?? "GET").toUpperCase();
      const before = new Set(w.rx.orders.keys());
      const res = await inner(input, init);
      if (p === "/api/1.0/orders" && m === "POST") {
        for (const [id, o] of w.rx.orders) if (!before.has(id) && o.side === "buy" && o.status === "filled") {
          const fee = o.filled * 0.0009;                             // taken in the coin, at full precision
          w.rx.balances.USDT -= fee; w.rx.balances.GBP += o.fee; coinFee.set(id, fee);
        }
      }
      if (reported && m === "GET" && p.startsWith("/api/1.0/orders/") && !p.endsWith("/active") && !p.endsWith("/historical") && res.ok) {
        const fee = coinFee.get(p.split("/").at(-1)!);
        if (fee != null) { const j = await res.json(); j.data.total_fee = fee.toFixed(12); j.data.fee_currency = "USDT"; return new Response(JSON.stringify(j), { status: 200 }); }
      }
      return res;
    };
    // The short is 25 h old: the 24-hour stop buys it back as an IOC bounded at fair + 50 bps (0.7591), and fills at the ask.
    await w.step(T0);
    const stop = w.orders().find((o) => o.leg === "stop")!;
    assertEquals([stop.side, Number(stop.price), (stop.request as { timeInForce: string }).timeInForce, Number(stop.base_size)], ["buy", 0.7591, "ioc", 5.51]);
    const r = await w.step(T0 + M);
    const settled = w.orders().find((o) => o.id === stop.id)!;
    assertEquals(settled.state, "filled", JSON.stringify(r.errors));
    const net = Math.floor((5.51 - 5.51 * 0.0009) * 1e5) / 1e5;
    assertEquals(Number(settled.filled_base), net, `${reported ? "reported" : "unreported"}: booked what reached the account, in whole steps`);
    if (!reported) {
      const fa = (settled.response as { fromAccount: { held: number; rest: number; gross: number } }).fromAccount;
      assertEquals([fa.rest, fa.gross], [20 - 5.51, 5.51]);            // what the booking read, beside the reply
    }
    // The rung is flat to within dust; nothing is left for a stop to chase.
    const r2 = await w.step(T0 + 2 * M);
    assert(!r2.placed.some((p) => p.leg === "stop"), JSON.stringify(r2.placed));
  }
});

// ------------------------------------------------------------------ the hard limits

Deno.test("the governor: from 600 POSTs today the entry quotes are withdrawn (DELETEs only) and exits still go; from 700 only the 24-hour stop", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.step(T0);                                                   // six bids resting
  // A long on the USDC 0.2 % rung, filled an hour ago: its exit is due.
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 5, filled_base: 5, avg_fill_price: 0.7538, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  const cancelled = w.rx.resting("USDC/GBP").find((o) => o.price === "0.7538")!;
  w.rx.orders.get(cancelled.id)!.status = "cancelled";               // (that rung's quote had filled and gone)
  w.orders().find((o) => o.venue_order_id === cancelled.id)!.state = "cancelled";
  const filler = async (n: number) => { for (let i = 0; i < n; i++) await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.003, leg: "entry", side: "sell", price: 0.76, base_size: 1, state: "rejected", ts: iso(T0 + M) }); };
  await filler(QUOTE_LIVE_ENTRY_POSTS - 6);                           // 600 POSTs today with the six bids
  const posts0 = w.posts();
  const r = await w.step(T0 + M);
  assertEquals(w.rx.resting().filter((o) => o.side === "buy").length, 0);                 // every entry quote withdrawn …
  assertEquals(w.deletes(), 5);                                                             // … by DELETE
  assertEquals(r.placed.map((p) => [p.leg, p.side, p.price]), [["exit", "sell", 0.7555]]); // … and the exit still went out
  assertEquals(w.posts(), posts0 + 1);
  // 700: the exit re-prices no more, and no new exit is placed; a stop still would be (the 24-hour stop's own test).
  await filler(QUOTE_LIVE_STOPS_ONLY_POSTS - QUOTE_LIVE_ENTRY_POSTS - 1);
  w.setFx(T0 + M, T0 + 30 * H, 1.3300);                               // fair moves 0.47 %: the rule would re-price the exit
  const r2 = await w.step(T0 + 2 * M);
  assertEquals(r2.placed, []);
  assertEquals(w.rx.resting().map((o) => o.price), ["0.7555"]);
});

Deno.test("Davies' 900: with 700 POSTs today the six bids still go out (the old governor sent only stops from 700); at 900 they are withdrawn", async () => {
  const w = makeWorld({ live: true, armed: true });
  const filler = async (n: number) => { for (let i = 0; i < n; i++) await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.003, leg: "entry", side: "sell", price: 0.76, base_size: 1, state: "rejected", ts: iso(T0 + M) }); };
  await filler(700);
  const r = await w.step(T0);
  assertEquals(r.placed.filter((p) => p.leg === "entry" && p.side === "buy").length, 6, JSON.stringify(r.placed));
  assertEquals(r.posts.live, 706);
  assertEquals(w.rx.resting().filter((o) => o.side === "buy").length, 6);
  await filler(900 - 706);                                            // 900 POSTs today
  const r2 = await w.step(T0 + M);
  assertEquals(r2.placed, []);
  assertEquals(w.rx.resting().length, 0);                             // every bid withdrawn, by DELETE
  assertEquals(w.deletes(), 6);
});

Deno.test("exitMayGo: a refused exit waits for a newer print that is not through it; a refusal of an earlier holding, or a 429, holds nothing back", () => {
  const lp = (id: string, ticks: number, side: "buy" | "sell") => ({ ts: T0, ticks, qty: 1, side, id });
  const refused = { ts: iso(T0), state: "rejected", response: { status: 400 }, request: { paperLastPrint: { id: "p1", ticks: 7557, side: "buy" as const } } };
  assertEquals(exitMayGo(null, T0 - H, "ask", 7555, lp("p1", 7557, "buy")), true);                          // never refused
  assertEquals(exitMayGo({ ...refused, state: "cancelled" }, T0 - H, "ask", 7555, lp("p1", 7557, "buy")), true);
  assertEquals(exitMayGo(refused, T0 - H, "ask", 7555, lp("p1", 7557, "buy")), false);                      // nothing new has printed
  // Refused while the last print was NOT through it (the venue's book moved without a trade): still nothing new to go on.
  const quiet = { ...refused, request: { paperLastPrint: { id: "p0", ticks: 7552, side: "buy" as const } } };
  assertEquals(exitMayGo(quiet, T0 - H, "ask", 7555, lp("p0", 7552, "buy")), false);
  assertEquals(exitMayGo(refused, T0 - H, "ask", 7555, lp("p2", 7556, "sell")), false);                     // newer, and still through the ask
  assertEquals(exitMayGo(refused, T0 - H, "ask", 7555, lp("p2", 7555, "sell")), false);                     // a seller at the ask's own price: through
  assertEquals(exitMayGo(refused, T0 - H, "ask", 7555, lp("p2", 7555, "buy")), true);                       // a buyer at it: the market has left
  assertEquals(exitMayGo(refused, T0 - H, "ask", 7555, lp("p2", 7552, "buy")), true);
  assertEquals(exitMayGo(refused, T0 + H, "ask", 7555, lp("p1", 7557, "buy")), true);                       // the refusal was an earlier holding's
  assertEquals(exitMayGo({ ...refused, response: { status: 429 } }, T0 - H, "ask", 7555, lp("p1", 7557, "buy")), true);
  // A short's exit is a bid: through when the market printed below it.
  assertEquals(exitMayGo({ ...refused, request: { paperLastPrint: { id: "p1", ticks: 7550, side: "sell" } } }, T0 - H, "bid", 7554, lp("p2", 7553, "sell")), false);
  assertEquals(exitMayGo({ ...refused, request: { paperLastPrint: { id: "p1", ticks: 7550, side: "sell" } } }, T0 - H, "bid", 7554, lp("p2", 7556, "buy")), true);
});

for (const refusal of ["http-400", "status"] as const) {
  Deno.test(`live: an exit the venue refuses (${refusal}) waits as the rule's refused order waits — not sent again until a newer print is not through it`, async () => {
    const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
    // A long of 5 USDC on the 0.2 % bid rung, filled an hour ago: its exit is a sell at fair rounded up, 0.7555.
    await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 5, filled_base: 5, avg_fill_price: 0.7538, ts: iso(T0 - H), filled_at: iso(T0 - H) });
    w.rx.postOnlyRefusal = refusal;
    w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7556, ask: 0.7558 };          // the book is through the exit: a post-only sell at 0.7555 crosses
    const exitPosts = () => w.orders().filter((o) => o.leg === "exit").length;
    const print = (id: string, ticks: number, side: "buy" | "sell", at: number) => ({ "USDC-GBP": [{ ts: at, ticks, qty: 100, side, id }] });
    await w.step(T0, print("a", 7557, "buy", T0 + 5e3));
    assertEquals(exitPosts(), 1);
    const first = w.orders().find((o) => o.leg === "exit")!;
    assertEquals((first.request as { paperLastPrint?: { id: string } }).paperLastPrint?.id, "a");
    await w.step(T0 + M);                                               // nothing printed: it waits (the old executor sent it again)
    assertEquals(exitPosts(), 1);
    assertEquals(w.orders().find((o) => o.leg === "exit")!.state, "rejected");
    await w.step(T0 + 2 * M, print("b", 7556, "sell", T0 + 2 * M + 5e3));  // newer, and still through the ask: it waits
    assertEquals(exitPosts(), 1);
    // The market leaves: the book comes back under the exit, and a print below it.
    w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7549, ask: 0.7553 };
    await w.step(T0 + 3 * M, print("c", 7552, "buy", T0 + 3 * M + 5e3));
    assertEquals(exitPosts(), 2);
    assertEquals(w.rx.resting().filter((o) => o.side === "sell").map((o) => o.price), ["0.7555"]);   // the exit rests (the other rungs' bids beside it)
  });
}

Deno.test("live: an exit refused while the tape shows nothing through it (the book moved without a trade) is not sent every minute — once per newer print", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 5, filled_base: 5, avg_fill_price: 0.7538, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  w.rx.postOnlyRefusal = "http-400";
  w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7556, ask: 0.7558 };
  const exitPosts = () => w.orders().filter((o) => o.leg === "exit").length;
  await w.step(T0, { "USDC-GBP": [{ ts: T0 + 5e3, ticks: 7552, qty: 100, side: "buy", id: "q" }] });   // the last print is under the exit
  assertEquals(exitPosts(), 1);
  for (let i = 1; i <= 5; i++) await w.step(T0 + i * M);             // five quiet minutes: the book still through, no print
  assertEquals(exitPosts(), 1);
  await w.step(T0 + 6 * M, { "USDC-GBP": [{ ts: T0 + 6 * M + 5e3, ticks: 7553, qty: 100, side: "buy", id: "r" }] });
  assertEquals(exitPosts(), 2);                                       // a newer print, not through it: one more try (refused again)
  await w.step(T0 + 7 * M);
  assertEquals(exitPosts(), 2);
});

Deno.test("live: an ask rung's exit buy-back is trimmed to the penny below, and once it fills the rung is flat, its hair carried as dust", async () => {
  const w = makeWorld({ live: true, armed: true, capital: 120, balances: { GBP: 120, USDT: 0 } });
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7552, ask: 0.7558 };          // the exit buy-back rests under the ask
  // A short of 13.18565 USDT on the 0.1 % ask rung, sold an hour ago at 0.7584 (the first live trip's entry).
  await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.001, leg: "entry", side: "sell", price: 0.7584, base_size: 13.18565, filled_base: 13.18565, avg_fill_price: 0.7584, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  await w.step(T0);
  const exit = w.orders().find((o) => o.leg === "exit" && o.book === "USDT-GBP" && o.rung_side === "ask")!;
  assert(exit, JSON.stringify(w.orders()));
  const price = Number(exit.price), base = Number(exit.base_size), full = 13.18565;
  const pennies = (b: number) => Math.ceil(b * price * 100 - 1e-9);
  // It pays the penny below what the whole short would have cost, and owes back under a penny's worth of coin.
  assertEquals(pennies(base), pennies(full) - 1, JSON.stringify(exit));
  assert(full - base > 0 && (full - base) * price < 0.01, String(full - base));
  // The venue fills it; next turn the rung's book holds only the hair, under dust: it is flat and quotes its ask again.
  w.rx.fillResting(String(exit.venue_order_id), base);
  await w.step(T0 + M);
  assertEquals(w.orders().find((o) => o.id === exit.id)!.state, "filled");
  await w.step(T0 + 2 * M);
  const asks = w.open("live").filter((o) => o.book === "USDT-GBP" && o.rung_side === "ask" && Number(o.k) === 0.001);
  assert(asks.every((o) => o.leg === "entry"), JSON.stringify(asks));
  // The dust it judged that by is in its state, for the page to judge the rung, and close its round trip, the same way:
  // the venue's £0.10 minimum at the book's price, far over the hair.
  const dust = Number(((w.mem.tables.agent_quote_live_state as Row[])[0].state as { dust?: Record<string, number> }).dust?.["USDT-GBP"]);
  assert(dust > full - base && 0.1 / dust > 0.7 && 0.1 / dust < 0.8, String(dust));
});

Deno.test("the daily loss stop: at −1 % of capital realised today plus marked, no entries for the rest of the UTC day; exits stay armed; the next day quotes again", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  // Today: a round trip that lost £0.60 on the USDT 0.1 % rung (bought 5.52168 at 0.7546, stopped at 0.6459) …
  await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 5.52168, filled_base: 5.52168, avg_fill_price: 0.7546, ts: iso(T0 - 3 * H), filled_at: iso(T0 - 3 * H) });
  await w.seed({ mode: "live", book: "USDT-GBP", rung_side: "bid", k: 0.001, leg: "stop", side: "sell", price: 0.6459, base_size: 5.52168, filled_base: 5.52168, avg_fill_price: 0.6459, ts: iso(T0 - 2 * H), filled_at: iso(T0 - 2 * H) });
  // … and a long still held on the USDC 0.3 % rung, whose exit must still go out.
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.003, leg: "entry", side: "buy", price: 0.7531, base_size: 5, filled_base: 5, avg_fill_price: 0.7531, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  const r = await w.step(T0);
  assertAlmostEquals(r.dayPnlGbp!, 5.52168 * (0.6459 - 0.7546) + 5 * (1 / X - 0.7531), 1e-6);
  assert(r.errors.some((e) => e.startsWith("LOSS STOP")), JSON.stringify(r.errors));
  assertEquals(r.placed.map((p) => [p.leg, p.rung]), [["exit", "USDC-GBP|bid|0.003"]]);   // the exit, and no entry
  assertEquals(w.events().filter((e) => e.kind === "loss_stop").length, 1);
  // Latched: a later minute today quotes nothing either, whatever the mark does.
  await w.step(T0 + M);
  assertEquals(w.open("live").filter((o) => o.leg === "entry").length, 0);
  assertEquals(w.rx.resting().map((o) => o.side), ["sell"]);                               // the exit alone
  // The next UTC day quotes again.
  const T1 = Date.parse("2026-09-25T00:05:00Z");
  w.books = { "USDC-GBP": newBookState("USDC-GBP"), "USDT-GBP": newBookState("USDT-GBP") };
  const r1 = await w.step(T1);
  assert(r1.placed.some((p) => p.leg === "entry"), JSON.stringify(r1));
});

Deno.test("the de-peg guard: a book quotes no entry while its USD book's last hour is > 50 bps from its median, or its last print is > 50 bps from fair", async () => {
  const w = makeWorld({ live: true, armed: true });
  // USDC's USD book closed its last hour at 1.0060 against a 24-hour median of 1.0000.
  for (const r of w.mem.tables.agent_quote_inputs as Row[]) if (r.kind === "fair:USDC-USD" && Date.parse(String(r.t)) === T0 - H) r.value = 1.006;
  const r = await w.step(T0);
  assert(r.guards["USDC-GBP"].some((g) => g.startsWith("de-peg: the USD book")), JSON.stringify(r.guards));
  assertEquals([...new Set(entryRows(w.orders()).map((o) => o.book))], ["USDT-GBP"]);   // the other book quotes as usual
  // USDT's GBP book printed 0.7600, 61 bps over fair: its quotes are withdrawn at the next minute.
  const r2 = await w.step(T0 + M, { "USDT-GBP": [{ ts: T0 + M + 1e3, ticks: 7600, qty: 1, side: "buy", id: "far" }] });
  assert(r2.guards["USDT-GBP"].some((g) => g.startsWith("de-peg: the GBP book")), JSON.stringify(r2.guards));
  assertEquals(w.rx.resting().length, 0);
  assert(w.events().some((e) => e.kind === "guard" && e.book === "USDT-GBP"));
});

Deno.test("stale inputs: no entries while the paper engine is behind or the USD book's hours are stale; a resting exit keeps its price", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.step(T0);
  // The paper engine has not decided the minute just closed (the executor runs two minutes on): entries withdrawn.
  const r = await w.live(T0, T0 + 2 * M + 30e3);
  assert(r.guards["USDC-GBP"].some((g) => g.includes("paper engine's last minute")));
  assertEquals(w.rx.resting().length, 0);
  // USDT's USD hours stop four hours back: fair still exists for the paper engine, but the live book quotes no USDT entry.
  const rows = w.mem.tables.agent_quote_inputs as Row[];
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === "fair:USDT-USD" && Date.parse(String(rows[i].t)) > T0 - 4 * H) rows.splice(i, 1);
  // A long on USDC with a resting exit; fair then moves 0.47 % while USDC's hours are stale too.
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 5, filled_base: 5, avg_fill_price: 0.7546, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  await w.step(T0 + 2 * M);
  assertEquals([...new Set(entryRows(w.orders()).filter((o) => o.state === "new").map((o) => o.book))], ["USDC-GBP"]);
  const exit = w.orders().find((o) => o.leg === "exit")!;
  assertEquals(Number(exit.price), 0.7555);
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === "fair:USDC-USD" && Date.parse(String(rows[i].t)) > T0 - 4 * H) rows.splice(i, 1);
  w.setFx(T0 + 2 * M, T0 + 30 * H, 1.3300);
  await w.step(T0 + 3 * M);
  assertEquals(w.orders().filter((o) => o.leg === "exit").map((o) => [o.state, Number(o.price)]), [["new", 0.7555]]);   // kept its price
  assertEquals(w.open("live").filter((o) => o.leg === "entry").length, 0);                                                 // and no entries anywhere
});

// The PR5v study (2026-09-28) found the frozen shape sends twelve POSTs at once when every rung is placed or re-priced,
// over Revolut X's 10 a second on a key; before this a 429 was recorded as a refusal and its decision never sent again.
Deno.test("live: the executor's own POSTs are paced under the venue's 10 a second — twelve rungs placed at once are all taken, none turned away", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 20, USDT: 20 } });
  w.pauses.advance = true;
  // In production the book an order meets is the paper engine's snapshot of the minute, read from the database, so no
  // public read (and its 1.1 s pause) falls between the twelve POSTs: the same here.
  for (const b of QUOTE_BOOKS) {
    const q = w.rx.gbpBooks[b.replace("-", "/")];
    await w.mem.db.upsert("agent_quote_events", [{ book: b, minute: iso(T0 + M), side: "-", k: 0, kind: "book", ticks: null,
      detail: { at: T0 + M + 1e3, orders: [], book: { bids: [{ count: 1, price: q.bid.toFixed(4), quantity: "5000" }], asks: [{ count: 1, price: q.ask.toFixed(4), quantity: "5000" }] } } }], "book,minute,side,k,kind");
  }
  const r0 = await w.step(T0);
  assertEquals([r0.errors, w.posts(), w.rx.rateLimited], [[], 12, 0]);
  assert(w.rx.postTimes.at(-1)! - w.rx.postTimes[0] < 2000, "the twelve went out as one burst");
  assertEquals(entryRows(w.orders()).map((o) => o.state), Array(12).fill("new"));
  const gaps = w.rx.postTimes.slice(1).map((t, i) => t - w.rx.postTimes[i]);
  assert(gaps.every((g) => g >= QUOTE_LIVE_POST_GAP_MS), JSON.stringify(gaps));
  // The venue's own limit, which the double enforces: never more than 10 taken in any second.
  assert(w.rx.postTimes.every((t) => w.rx.postTimes.filter((x) => x > t - 1000 && x <= t).length <= 10));
});

Deno.test("live: a POST the rate limit turns away (429) is not a refusal — sent once more after a second, and taken", async () => {
  const w = makeWorld({ live: true, armed: true });
  w.rx.rateLimitNext = 1;
  const r0 = await w.step(T0);
  assertEquals(r0.errors, []);
  assertEquals(entryRows(w.orders()).map((o) => o.state), Array(6).fill("new"));
  assertEquals([w.posts(), w.rx.rateLimited, w.rx.resting().length], [7, 1, 6]);
  assert(w.pauses.taken.includes(QUOTE_LIVE_429_WAIT_MS));
});

Deno.test("live: turned away twice, the order is recorded as rate-limited and its decision sent again next turn — the one refusal that is re-sent", async () => {
  const w = makeWorld({ live: true, armed: true });
  w.rx.rateLimitNext = 2;
  const r0 = await w.step(T0);
  const first = entryRows(w.orders())[0];
  assertEquals([first.state, (first.response as { status: number }).status, wasRateLimited(first)], ["rejected", 429, true]);
  assert(r0.errors.some((e) => e.includes("rate limit")), JSON.stringify(r0.errors));
  // Next turn, no new paper decision: only the turned-away rung sends, the same decision (paper order and live minute).
  await w.step(T0 + M);
  const rung = entryRows(w.orders()).filter((o) => o.book === first.book && o.rung_side === first.rung_side && Number(o.k) === Number(first.k));
  assertEquals(rung.map((o) => o.state), ["rejected", "new"]);
  assertEquals([rung[1].paper_oid, rung[1].paper_live, ticks(rung[1])], [first.paper_oid, first.paper_live, ticks(first)]);
  assertEquals(w.posts(), 6 + 2);
  // A refusal by the book is still never re-sent; the rate limit's is the only one (the post-only test above pins the other).
  assertEquals(wasRateLimited({ state: "rejected", response: { status: 400 } }), false);
  assertEquals(wasRateLimited({ state: "new", response: { status: 429 } }), false);
});

Deno.test("live: a 24-hour stop the rate limit turns away twice is tried again next turn, not an hour later", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 5, filled_base: 5, avg_fill_price: 0.7538, ts: iso(T0 - DAY - 5 * M), filled_at: iso(T0 - DAY - 5 * M) });
  w.rx.rateLimitNext = 2;                                            // the stop is the turn's first POST
  await w.step(T0);
  assertEquals(w.orders().filter((o) => o.leg === "stop").map((o) => [o.state, wasRateLimited(o)]), [["rejected", true]]);
  await w.step(T0 + M);                                             // sent again at once, not an hour on
  assertEquals(w.orders().filter((o) => o.leg === "stop").map((o) => o.state), ["rejected", "new"]);
  await w.step(T0 + 2 * M);                                         // an IOC settles on the read-back of the next turn
  assertEquals(w.orders().filter((o) => o.leg === "stop").map((o) => o.state), ["rejected", "filled"]);
  assertEquals(w.rx.balances.USDC, 0);
});

Deno.test("the 24-hour stop: an IOC bounded at fair − 50 bps; unfilled it alerts, the book quotes no entries, and it is tried again an hour later, not every minute", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 5, filled_base: 5, avg_fill_price: 0.7538, ts: iso(T0 - DAY - 5 * M), filled_at: iso(T0 - DAY - 5 * M) });
  w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7400, ask: 0.7410 };         // the book has left fair by 2 %: the bounded IOC cannot fill
  const r0 = await w.step(T0);
  const stop = w.orders().find((o) => o.leg === "stop")!;
  assertEquals([stop.side, Number(stop.price), (stop.request as { marketable: boolean; timeInForce: string }).timeInForce, Number(stop.base_size)], ["sell", 0.7517, "ioc", 5]);
  assert(r0.guards["USDC-GBP"].includes("a position on this book is past its 24-hour stop"));
  const r1 = await w.step(T0 + M);
  assert(r1.errors.some((e) => e.includes("24-hour stop came back unfilled")), JSON.stringify(r1.errors));
  assertEquals(w.events().filter((e) => e.kind === "stop_unfilled").length, 1);
  // Not chased: the rule's maker exit rests at fair meanwhile, and no second IOC goes out inside the hour.
  await w.run(T0 + 2 * M, T0 + 59 * M);
  assertEquals(w.orders().filter((o) => o.leg === "stop").length, 1);
  assertEquals(w.open("live").map((o) => [o.leg, Number(o.price)]).filter(([l]) => l !== "entry"), [["exit", 0.7555]]);
  assertEquals(w.open("live").filter((o) => o.book === "USDC-GBP" && o.leg === "entry").length, 0);   // that book quotes no entry
  // An hour on, the exit is cancelled (confirmed) and the stop tried again; this time the book is back and it fills.
  w.rx.gbpBooks["USDC/GBP"] = { bid: 0.7548, ask: 0.7552 };
  await w.run(T0 + 60 * M, T0 + 62 * M);
  const stops = w.orders().filter((o) => o.leg === "stop");
  assertEquals(stops.map((o) => o.state), ["cancelled", "filled"]);
  assertEquals(w.rx.balances.USDC, 0);
});

Deno.test("the kill switch: live_confirmed_at cleared withdraws every live entry and places none, while exits stay armed; global_pause cancels everything", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDC: 5 } });
  await w.step(T0);
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 5, filled_base: 5, avg_fill_price: 0.7546, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  const q = w.rx.resting("USDC/GBP").find((o) => o.price === "0.7546")!;
  w.rx.orders.get(q.id)!.status = "cancelled";
  w.orders().find((o) => o.venue_order_id === q.id)!.state = "cancelled";
  (w.mem.tables.agent_quote_live_config as Row[])[0].live_confirmed_at = null;
  const r = await w.step(T0 + M);
  assertEquals(r.entryBook, null);
  assertEquals(w.rx.resting().map((o) => [o.side, o.price]), [["sell", "0.7555"]]);   // entries gone; the exit went out
  await w.step(T0 + 2 * M);
  assertEquals(entryRows(w.orders()).filter((o) => o.state === "new").length, 0);
  // The global pause outranks the exit too: every open order cancelled, nothing placed.
  (w.mem.tables.agent_risk as Row[])[0].global_pause = true;
  const r2 = await w.step(T0 + 3 * M);
  assertEquals([w.rx.resting().length, r2.placed.length], [0, 0]);
});

Deno.test("inventory: an ask needs coin beyond what the book's own longs will sell — a conversion's coin quotes, a long's does not, and neither book goes short of GBP", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50 - 20 * 0.756 - 5 * 0.7546, USDT: 20, USDC: 5 } });
  await w.seed({ mode: "live", book: "USDT-GBP", leg: "convert", side: "buy", price: 0.756, base_size: 20, filled_base: 20, avg_fill_price: 0.756, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  await w.seed({ mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 5, filled_base: 5, avg_fill_price: 0.7546, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  const r = await w.step(T0);
  const placed = w.open("live").filter((o) => o.leg === "entry");
  const asks = placed.filter((o) => o.rung_side === "ask");
  assertEquals(asks.map((o) => [o.book, Number(o.price), Number(o.base_size)]).sort(), [["USDT-GBP", 0.7562, handBase(0.7562)], ["USDT-GBP", 0.757, handBase(0.757)], ["USDT-GBP", 0.7577, handBase(0.7577)]]);
  assert(r.skippedEntries.filter((s) => s.rung.startsWith("USDC-GBP|ask")).length === 3, JSON.stringify(r.skippedEntries));
  // GBP: 50 − 15.12 − 3.773 = £31.11 before the bids; five bids (£20.83) fit; the USDC 0.1 % rung holds a long and exits.
  assertEquals(placed.filter((o) => o.rung_side === "bid").length, 5);
  assertEquals(w.open("live").filter((o) => o.leg === "exit").map((o) => [o.book, Number(o.base_size)]), [["USDC-GBP", 4.99008]]);   // 5 to the penny
  assertEquals(r.errors, []);
  // With GBP for three bids only, the other three are skipped, not placed and refused.
  const w2 = makeWorld({ live: true, armed: true, balances: { GBP: 3 * 4.17 } });
  const r2 = await w2.step(T0);
  assertEquals([w2.open("live").length, r2.skippedEntries.filter((s) => s.reason === "not enough free GBP").length], [3, 3]);
  assertEquals(w2.orders().filter((o) => o.state === "rejected").length, 0);
});

Deno.test("inventory: a re-price on tight inventory gives the cancelled order's coin back before the replacement is sized, so it is replaced, not skipped", async () => {
  // Exactly enough USDT for the three asks at 0.7562 / 0.7570 / 0.7577, and no more.
  const need = handBase(0.7562) + handBase(0.757) + handBase(0.7577);
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50 - need * 0.756, USDT: need } });
  await w.seed({ mode: "live", book: "USDT-GBP", leg: "convert", side: "buy", price: 0.756, base_size: need, filled_base: need, avg_fill_price: 0.756, ts: iso(T0 - H), filled_at: iso(T0 - H) });
  await w.step(T0);
  assertEquals(w.rx.resting("USDT/GBP").filter((o) => o.side === "sell").length, 3);
  // GBP/USD down to 1.3180: fair up 0.44 %, so every quote is re-priced, the asks to 0.7595 / 0.7603 / 0.7611.
  w.setFx(T0, T0 + 30 * H, 1.3180);
  const r = await w.step(T0 + M);
  assertEquals(r.skippedEntries.filter((s) => s.rung.startsWith("USDT-GBP|ask")), []);
  assertEquals(w.rx.resting("USDT/GBP").filter((o) => o.side === "sell").map((o) => o.price).sort(), ["0.7595", "0.7603", "0.7611"]);
});

// ------------------------------------------------------------------ the one-off conversion

Deno.test("the conversion is an operator's call: without send it only says what it would send; it never sends in dry-run, over three rungs, or past fair + 50 bps (taker: an IOC)", async () => {
  const w = makeWorld();
  await w.paperStep(T0);
  const deps = () => ({ db: w.mem.db, now: T0 + M + 30e3, holder: "op", uuid: () => crypto.randomUUID(), account: w.account, fetch: w.rx.fetch, pause: () => Promise.resolve(), clock: () => T0 + M + 30e3 });
  const preview = await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, taker: true });
  assertEquals((preview.wouldSend as { limit: string; timeInForce: string }).limit, "0.7591");        // fair + 50 bps, rounded down
  assertEquals([w.orders().length, w.posts()], [0, 0]);
  assertEquals((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true, taker: true })).error, "dry_run is on: nothing is sent while it is");
  assert(String((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.6 })).error).startsWith("gbp: more than 0 and at most 12.5"));
  (w.mem.tables.agent_quote_live_config as Row[])[0].dry_run = false;
  assertEquals((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true, taker: true })).error, "live_confirmed_at is null: nothing is sent until it is set");
  (w.mem.tables.agent_quote_live_config as Row[])[0].live_confirmed_at = ARMED;
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7590, ask: 0.7600 };
  assert(String((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true, taker: true })).error).includes("more than 50 bps over fair"));
  assertEquals(w.posts(), 0);
  // Live and armed, the ask within bounds: one IOC buy, written pending first, sized at the ask (12.5 / 0.7551) and
  // bounded at 0.7591.
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7546, ask: 0.7551 };
  const sent = await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true, taker: true });
  assertEquals([w.posts(), w.orders().map((o) => [o.leg, o.side, o.rung_side, Number(o.price), Number(o.base_size), (o.request as { timeInForce: string }).timeInForce])],
    [1, [["convert", "buy", null, 0.7591, Math.floor(12.5 / 0.7551 * 1e5) / 1e5, "ioc"]]], JSON.stringify(sent));
  // The minute loop settles it from the venue, and the three USDT asks now have their coin.
  await w.step(T0 + M);
  assertEquals(w.orders()[0].state, "filled");
  assertEquals(w.open("live").filter((o) => o.leg === "entry" && o.book === "USDT-GBP" && o.rung_side === "ask").length, 3);
  // Three asks' worth held (resting or not): a second conversion is refused.
  const again = await runQuotesConvert({ ...deps(), now: T0 + 2 * M + 40e3 }, { book: "USDT-GBP", gbp: 12.5, send: true });
  assert(String(again.error).includes("three asks' worth"), JSON.stringify(again));
  assertEquals(w.posts(), 1 + w.open("live").length);
});

Deno.test("by default the conversion rests at the bid, post-only at a maker's 0 %: booked as the venue fills it; one a book; cancelled after 24 hours, on a global pause or disarmed", async () => {
  const w = makeWorld({ live: true, armed: true, capital: 50 });
  await w.paperStep(T0);
  const at = (now: number) => ({ db: w.mem.db, now, holder: "op", uuid: () => crypto.randomUUID(), account: w.account, fetch: w.rx.fetch, pause: () => Promise.resolve(), clock: () => now });
  const open = () => w.open("live").filter((o) => o.leg === "convert");
  // The spread 0.7546 / 0.7551 leaves room: one tick over the best bid, 0.7547, sized at that price (12.5 / 0.7547),
  // good till cancelled and post-only. The preview says so and sends nothing.
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7546, ask: 0.7551 };
  const preview = (await runQuotesConvert(at(T0 + M + 30e3), { book: "USDT-GBP", gbp: 12.5 })).wouldSend as Record<string, unknown>;
  assertEquals([preview.limit, preview.timeInForce, preview.postOnly, preview.base], ["0.7547", "gtc", true, String(Math.floor(12.5 / 0.7547 * 1e5) / 1e5)]);
  assertEquals(w.posts(), 0);
  await runQuotesConvert(at(T0 + M + 30e3), { book: "USDT-GBP", gbp: 12.5, send: true });
  const conv = open()[0];
  assert(conv, JSON.stringify(w.orders()));
  const req = conv.request as { postOnly: boolean; timeInForce: string };
  assertEquals([Number(conv.price), Number(conv.base_size), req.postOnly, req.timeInForce, conv.state], [0.7547, Math.floor(12.5 / 0.7547 * 1e5) / 1e5, true, "gtc", "new"]);
  // One a book: a second while it rests is refused, and sends nothing.
  const posts = w.posts();
  assert(String((await runQuotesConvert(at(T0 + M + 40e3), { book: "USDT-GBP", gbp: 12.5, send: true })).error).includes("already rests"));
  assertEquals(w.posts(), posts);
  // The venue fills it at its price, a maker's fill: the minute loop books it, fee nothing, and leaves it alone meanwhile.
  await w.step(T0 + M);
  assertEquals(open().length, 1);
  w.rx.fillResting(String(conv.venue_order_id), Number(conv.base_size));
  await w.step(T0 + 2 * M);
  const done = w.orders().find((o) => o.id === conv.id)!;
  assertEquals([done.state, Number(done.filled_base), Number(done.avg_fill_price), Number(done.fee_gbp)], ["filled", Math.floor(12.5 / 0.7547 * 1e5) / 1e5, 0.7547, 0]);
  // A tight book (one tick wide) rests AT the best bid; after 24 hours unfilled the minute loop cancels it.
  const w2 = makeWorld({ live: true, armed: true, capital: 50 });
  await w2.paperStep(T0);
  w2.rx.gbpBooks["USDC/GBP"] = { bid: 0.7548, ask: 0.7549 };
  await runQuotesConvert({ ...at(T0 + M + 30e3), db: w2.mem.db, account: w2.account, fetch: w2.rx.fetch }, { book: "USDC-GBP", gbp: 12.5, send: true });
  const c2 = w2.open("live").find((o) => o.leg === "convert")!;
  assertEquals(Number(c2.price), 0.7548);
  await w2.step(T0 + M);
  assertEquals(w2.open("live").filter((o) => o.leg === "convert").length, 1);                 // a minute old: it rests
  await w2.step(T0 + 25 * H);
  const gone = w2.orders().find((o) => o.id === c2.id)!;
  assertEquals([gone.state, String(gone.cancel_reason).startsWith("unfilled after 24 hours")], ["cancelled", true]);
  // Disarmed (live_confirmed_at cleared), a resting conversion is cancelled at once; and on a global pause.
  for (const [what, set] of [["disarmed", (x: Row[]) => { (x[0] as Row).live_confirmed_at = null; }], ["global pause", null]] as const) {
    const w3 = makeWorld({ live: true, armed: true, capital: 50 });
    await w3.paperStep(T0);
    await runQuotesConvert({ ...at(T0 + M + 30e3), db: w3.mem.db, account: w3.account, fetch: w3.rx.fetch }, { book: "USDT-GBP", gbp: 12.5, send: true });
    const c3 = w3.open("live").find((o) => o.leg === "convert")!;
    if (set) set(w3.mem.tables.agent_quote_live_config as Row[]);
    else (w3.mem.tables.agent_risk as Row[])[0].global_pause = true;
    await w3.step(T0 + M);
    const c3After = w3.orders().find((o) => o.id === c3.id)!;
    assertEquals(c3After.state, "cancelled", what);
  }
});

// ------------------------------------------------------------------ the paper test does not change

/** The executor wrote only its own tables and its lease: never the paper engine's state, prints, inputs, events or trips. */
const onlyItsOwnTables = (writes: Set<string>) => [...writes].every((t) => t.startsWith("agent_quote_live_") || t === "agent_locks");

Deno.test("the executor never writes a paper table: the pre-registered test's record is the paper engine's alone", async () => {
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, USDT: 20 } });
  await w.paperStep(T0);
  const before = JSON.stringify(w.mem.tables.agent_quote_state);
  await w.live(T0);                                                   // quotes placed
  const bid = w.rx.resting("USDC/GBP")[0];
  w.rx.fillResting(bid.id, Number(bid.quantity));                     // a venue fill …
  await w.step(T0 + M);                                               // … settled, and its exit placed
  await w.live(T0 + M, T0 + 3 * M + 10e3);                            // the paper engine falls behind: a guard comes …
  await w.step(T0 + 2 * M);                                           // … and goes
  assert(w.executorWrites.size > 0 && onlyItsOwnTables(w.executorWrites), [...w.executorWrites].join(", "));
  assertEquals(w.orders().filter((o) => o.leg === "exit").length, 1);
  assert(w.events().filter((e) => e.kind === "guard").length >= 2, "the turns that write guard events were exercised");
  assert(JSON.stringify(w.mem.tables.agent_quote_state) !== before, "the paper engine itself moved on meanwhile");
});

Deno.test("PR5's golden 24-hour-stop window through the live engine: the paper replay is unchanged, every live entry is a paper order, never two orders on a rung, stops are bounded IOCs", async () => {
  type Window = { name: string; book: QuoteBook; t0: number; t1: number; seed_print: [number, number, number, string] | null; fx: Array<[number, number]>; fair_hours: Array<[number, number]>; prints: Array<[number, number, number, string]>; trips: Array<{ t_entry: number; t_exit: number; how: string }> };
  const win = (golden as unknown as { windows: Window[] }).windows.find((x) => x.name === "stop")!;
  const book = win.book, sym = book === "USDC-GBP" ? "USDC/GBP" : "USDT/GBP", other: QuoteBook = book === "USDC-GBP" ? "USDT-GBP" : "USDC-GBP";
  const w = makeWorld({ live: true, armed: true, balances: { GBP: 50, [book.split("-")[0]]: 20 } });
  // The window's own inputs in place of the world's: its GBP/USD minutes and its USD book's hours.
  const usdKind = book === "USDC-GBP" ? "fair:USDC-USD" : "fair:USDT-USD";
  w.mem.tables.agent_quote_inputs = [
    ...win.fx.map(([t, v]) => ({ kind: "fx", t: iso(t), value: v })),
    ...win.fair_hours.map(([t, v]) => ({ kind: usdKind, t: iso(t), value: v })),
  ];
  // The coin the asks sell came from a conversion, on the book.
  await w.seed({ mode: "live", book, leg: "convert", side: "buy", price: 0.75, base_size: 20, filled_base: 20, avg_fill_price: 0.75, ts: iso(win.t0 - H), filled_at: iso(win.t0 - H) });
  const asPrint = ([ts, ticks, qty, side]: [number, number, number, string], i: number): Print => ({ ts, ticks, qty, side: side === "buy" ? "buy" : "sell", id: `p${ts}-${i}` });
  w.books = { [book]: newBookState(book, win.seed_print ? asPrint(win.seed_print, -1) : null), [other]: newBookState(other) } as Record<QuoteBook, BookState>;
  const prints = win.prints.map(asPrint);
  let last = win.seed_print ? asPrint(win.seed_print, -1) : null, j = 0, maxOpen = 0;
  for (let t = win.t0; t < win.t1; t += M) {
    // The venue's book sits a tick either side of the last print; a print strictly through one of our resting orders fills it.
    if (last) w.rx.gbpBooks[sym] = { bid: (last.ticks - 1) * QUOTE_TICK, ask: (last.ticks + 1) * QUOTE_TICK };
    const mine: Print[] = [];
    while (j < prints.length && prints[j].ts < t + M) mine.push(prints[j++]);
    for (const p of mine) {
      for (const o of w.rx.resting(sym)) {
        const px = Math.round(Number(o.price) / QUOTE_TICK);
        if (o.side === "buy" ? p.ticks < px : p.ticks > px) w.rx.fillResting(o.id, Number(o.quantity) - o.filled);
      }
      last = p;
    }
    await w.paperStep(t, { [book]: mine });
    w.clock.now = t + M + 30e3;
    await w.live(t);
    const open = w.open("live").filter((o) => o.rung_side != null);
    const perRung = new Map<string, number>();
    for (const o of open) perRung.set(`${o.book}|${o.rung_side}|${o.k}`, (perRung.get(`${o.book}|${o.rung_side}|${o.k}`) ?? 0) + 1);
    maxOpen = Math.max(maxOpen, ...perRung.values(), 0);
    assert(w.rx.resting(sym).length <= 6, `minute ${iso(t)}: ${w.rx.resting(sym).length} orders resting on six rungs`);
  }
  // The paper replay is the golden one: the executor read the paper state, changed nothing in it, and wrote none of its
  // tables in 1,710 turns of placements, re-prices, refusals, fills, exits, stops and guards.
  assertEquals(w.paperTrips.filter((t) => t.book === book).map((t) => [t.tEntry, t.tExit, t.how]), win.trips.map((t) => [t.t_entry, t.t_exit, t.how]));
  assert(onlyItsOwnTables(w.executorWrites), [...w.executorWrites].join(", "));
  assertEquals(maxOpen, 1);
  const rows = w.orders().filter((o) => o.book === book && o.mode === "live");
  const entries = rows.filter((o) => o.leg === "entry");
  assert(entries.length > 20, `${entries.length} live entries`);
  for (const o of entries) {
    const ev = w.paperEvents.find((e) => e.kind === "order" && e.book === o.book && e.side === o.rung_side && e.k === Number(o.k)
      && e.minute === Date.parse(String(o.paper_live)) - M && (e.detail as { oid: number }).oid === o.paper_oid);
    assert(ev && ev.ticks === ticks(o), `entry ${o.id} is no paper order: ${JSON.stringify(o)}`);
  }
  assert(entries.length <= w.paperEvents.filter((e) => e.kind === "order" && e.book === book && (e.detail as { leg: string }).leg === "entry").length);
  // Exits at the rule's price on the fair they record; stops as IOCs at fair ∓ 50 bps, a day or more after the fill.
  for (const o of rows.filter((x) => x.leg === "exit")) assertEquals(ticks(o), exitTicks(Number(o.fair), o.rung_side as Side));
  const stops = rows.filter((o) => o.leg === "stop");
  assert(stops.length >= 1, "a live position reached its 24-hour stop");
  for (const s of stops) {
    assertEquals([ticks(s), (s.request as { timeInForce: string }).timeInForce], [stopLimitTicks(Number(s.fair), s.rung_side as Side), "ioc"]);
    const opened = rows.filter((o) => o.leg === "entry" && o.rung_side === s.rung_side && Number(o.k) === Number(s.k) && Number(o.filled_base) > 0 && Date.parse(String(o.filled_at)) <= Date.parse(String(s.ts)))
      .map((o) => Date.parse(String(o.filled_at))).sort((a, b) => b - a)[0];
    assert(opened != null && Date.parse(String(s.ts)) - opened >= DAY, `stop ${s.id} at ${s.ts}, fill at ${opened && iso(opened)}`);
  }
});
