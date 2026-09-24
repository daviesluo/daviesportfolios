// PR5's live executor (quotes_live.ts) against doubles no looser than what they stand in for: the in-memory database with
// 0052's CHECKs and unique indexes (testing.ts), and a fake Revolut X that refuses a crossing post-only order, reserves
// what a resting order could spend, answers in the venue's documented fields and can lose a reply or a cancel.
//
// Each rule the design names has a pin here, and each pin fails without its rule (the counterfactuals are listed in
// reference §4 item 35). The paper engine is driven by its own `stepMinute`, exactly as `runQuotes` drives it, and its
// state is saved the way `runQuotes` saves it; the executor then reads that state, as it does in production.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/pr5/golden_windows.json" with { type: "json" };
import { revxVenue } from "../_shared/revx.ts";
import type { Venue } from "../_shared/venue.ts";
import {
  exitTicks, fairUAt, fxAt, newBookState, QUOTE_BOOKS, QUOTE_TICK, stepMinute, type BookState, type Print, type QuoteBook, type QuoteEvent, type Side, type Trip,
} from "./quotes.ts";
import {
  bookInputs, crossesBook, dustBase, entryBookOf, entryGuards, governorLevel, lossStopHit, markedGbp, paperEntryTarget, paperRefused, parseBook, QUOTE_LIVE_ENTRY_POSTS,
  QUOTE_LIVE_STOPS_ONLY_POSTS, rungBase, rungBook, rungGbp, runQuotesConvert, runQuotesLive, stopDue, stopLimitTicks, venueSideOf,
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
  const account: Venue | null = o.key === false ? null : revxVenue({ apiKey: "k".repeat(64), privateKey: KEY.privateKey }, (i, init) => rx.fetch(i, init));
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
    mem, rx, clock, account, executorWrites,
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
      return runQuotesLive({ db: executorDb, now: at, holder: `h${at}`, uuid: () => crypto.randomUUID(), account, accountNote: account ? null : "no key", fetch: rx.fetch, pause: () => Promise.resolve(), clock: () => clock.now });
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
  assertEquals([governorLevel(599), governorLevel(QUOTE_LIVE_ENTRY_POSTS), governorLevel(699), governorLevel(QUOTE_LIVE_STOPS_ONLY_POSTS)], ["all", "no-entries", "no-entries", "stops-only"]);
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
  assert(r1.errors.filter((e) => e.includes("FROZEN")).length === 6, JSON.stringify(r1.errors));
  assert(w.open("live").every((o) => o.cancel_requested_at != null));
  await w.step(T0 + 2 * M);                                            // still not done: still frozen, asked again
  assertEquals([w.posts(), w.rx.resting().length], [6, 6]);
  w.rx.cancelMode = "ok";
  await w.step(T0 + 3 * M);                                            // confirmed at last: the replacements go out
  assertEquals([w.posts(), w.rx.resting().map((o) => o.price).sort()], [12, ["0.7496", "0.7496", "0.7503", "0.7503", "0.7511", "0.7511"]]);
  // A cancel whose reply is lost after it took effect is confirmed by the read-back all the same.
  w.rx.cancelMode = "timeout";
  w.setFx(T0 + 3 * M, T0 + 30 * H, X);
  await w.step(T0 + 4 * M);
  assertEquals([w.rx.resting().length, w.posts()], [6, 18]);
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
  // fair by the rule's own rounding (a long sells at fair rounded up: 0.7555), post-only.
  const bid = w.rx.resting("USDT/GBP").find((o) => o.price === "0.7538")!;
  w.rx.fillResting(bid.id, Number(bid.quantity));
  await w.step(T0 + 3 * M);
  const entry = w.orders().find((o) => o.venue_order_id === bid.id)!;
  assertEquals([entry.state, Number(entry.filled_base), Number(entry.avg_fill_price), Number(entry.fee_gbp)], ["filled", 5.52754, 0.7538, 0]);
  const exit = w.orders().find((o) => o.leg === "exit")!;
  assertEquals([exit.book, Number(exit.k), exit.side, Number(exit.price), Number(exit.base_size), (exit.request as { postOnly: boolean }).postOnly, exit.state], ["USDT-GBP", 0.002, "sell", 0.7555, 5.52754, true, "new"]);
  assertEquals(w.books["USDT-GBP"].rungs[1].mode, "quote");          // the paper rung never filled
  // The exit fills; the round trip is the venue's: 5.52754 × (0.7555 − 0.7538) GBP.
  w.rx.fillResting(String(exit.venue_order_id), 5.52754);
  const r = await w.step(T0 + 4 * M);
  assertAlmostEquals(r.dayPnlGbp!, 5.52754 * (0.7555 - 0.7538), 1e-8);          // the report keeps 8 decimals
  // Flat again, the rung carries out the paper's order once more.
  assertEquals(w.open("live").filter((o) => o.book === "USDT-GBP" && Number(o.k) === 0.002).map((o) => [o.leg, Number(o.price)]), [["entry", 0.7538]]);
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
  assertEquals([Number(exit.base_size), Number(exit.price)], [2, 0.7555]);
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
  assertEquals(w.open("live").filter((o) => o.leg === "exit").map((o) => [o.book, Number(o.base_size)]), [["USDC-GBP", 5]]);
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

Deno.test("the conversion is an operator's call: without send it only says what it would send; it never sends in dry-run, over three rungs, or past fair + 50 bps", async () => {
  const w = makeWorld();
  await w.paperStep(T0);
  const deps = () => ({ db: w.mem.db, now: T0 + M + 30e3, holder: "op", uuid: () => crypto.randomUUID(), account: w.account, fetch: w.rx.fetch, pause: () => Promise.resolve(), clock: () => T0 + M + 30e3 });
  const preview = await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5 });
  assertEquals((preview.wouldSend as { limit: string; timeInForce: string }).limit, "0.7591");        // fair + 50 bps, rounded down
  assertEquals([w.orders().length, w.posts()], [0, 0]);
  assertEquals((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true })).error, "dry_run is on: nothing is sent while it is");
  assert(String((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.6 })).error).startsWith("gbp: more than 0 and at most 12.5"));
  (w.mem.tables.agent_quote_live_config as Row[])[0].dry_run = false;
  assertEquals((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true })).error, "live_confirmed_at is null: nothing is sent until it is set");
  (w.mem.tables.agent_quote_live_config as Row[])[0].live_confirmed_at = ARMED;
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7590, ask: 0.7600 };
  assert(String((await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true })).error).includes("more than 50 bps over fair"));
  assertEquals(w.posts(), 0);
  // Live and armed, the ask within bounds: one IOC buy, written pending first, sized at the ask (12.5 / 0.7551) and
  // bounded at 0.7591.
  w.rx.gbpBooks["USDT/GBP"] = { bid: 0.7546, ask: 0.7551 };
  const sent = await runQuotesConvert(deps(), { book: "USDT-GBP", gbp: 12.5, send: true });
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
