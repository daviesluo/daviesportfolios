// TAKE ("Stablecoin quotes variant-2", `take50`; docs/agents/reviews/2026-10-03-take-prereg.md): the taker entry of the
// live executor's own code (quotes_live.ts) when the recorded book rests through a rung, on a simulated account
// (revx_sim.ts) wired as the twins' driver wires it (quotes_twin.ts: the recorded reads around the turn, the order row
// that marks the take). PR5's engine is stepped by its own `stepMinute`. Each pin has its counterfactual beside it: the
// trigger a tick short, every condition of eligibility, the read after the turn, the cancel before the take, the POST
// the governor counts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { readTouch, recordedBookAt, runQuotesLive, takeBookRow, takeLimitTicks, takeTriggered, type QuoteLiveInstance, type RecordedRead } from "./quotes_live.ts";
import { newSimState, SimRevx, type SimState } from "./revx_sim.ts";
import { simBookOfRead, specFromRow, stampTs, takeFillRead, takeReadsAt, TWIN_SPEC_ROWS } from "./quotes_twin.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const FROM = Date.parse("2026-10-05T00:00:00Z");
const T0 = FROM + 9 * H;                    // Monday 2026-10-05 09:00 UTC, after `take.from`
const X = 1.3238;                           // GBP/USD; with the USD books at 1.0000 fair is 1 / X = 0.755401…
const F = 1 / X;
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
/** variant-2 as 0089's row makes it: p50's but for its id, name, place, tables, lease, rule and pre-registration. */
const SPEC = specFromRow({
  ...TWIN_SPEC_ROWS[1], id: "take50", display_name: "Stablecoin quotes variant-2", display_order: 30, table_prefix: "agent_quote_twin_take50",
  lease: "quotes-twin-take50", rules: { take: { from: "2026-10-05T00:00:00Z" } }, backfill: null, prereg: "docs/agents/reviews/2026-10-03-take-prereg.md", migration: "0089",
});
const I = SPEC.instance;
const USDC: QuoteBook = "USDC-GBP";
const isTake = (r: Row) => (r.request as { take?: unknown } | null)?.take === true;

type Opts = { inst?: QuoteLiveInstance; config?: Record<string, unknown>; balances?: Record<string, number> };

/** The executor of `inst` (variant-2's by default) after PR5's engine, its turns 25 s into the minute after the one decided. */
function world(o: Opts = {}) {
  const inst = o.inst ?? I;
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 3 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 3 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: inst.lease, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    [inst.config]: [{ id: 1, dry_run: false, live_confirmed_at: iso(T0 - H), capital_gbp: 600, ...(o.config ?? {}) }],
    [inst.orders]: [], [inst.events]: [], [inst.state]: [], [inst.paper]: [],
    agent_quote_inputs: inputs, agent_quote_events: [], agent_book_levels: [],
  }, { now: () => clock.now });
  // The last print before the start, a seller at 0.7553 on each book: the touch it implies is 0.7553 / 0.7554.
  const seed = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seed(b))])) as Record<QuoteBook, BookState>;
  const st: SimState = newSimState(o.balances ?? { GBP: 300, USDC: 200, USDT: 200 }, { [USDC]: seed(USDC), "USDT-GBP": seed("USDT-GBP") });
  let n = 0;
  const w = {
    mem, clock, st, books,
    /** PR5's engine decides minute t, as its call does, and saves it where the executor reads it. */
    async paper(t: number, prints: Partial<Record<QuoteBook, Print[]>> = {}) {
      for (const b of QUOTE_BOOKS) stepMinute(books[b], t, { x: X, fairU: 1.0, prints: prints[b] ?? [] });
      await mem.db.upsert(inst.paper, [{ id: 1, state: { lastMinute: t, books, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t) }], "id");
    },
    /** A read of the book recorder (`agent_book_levels`): the book first read at `ts`, read unchanged until `seen`. */
    read(book: QuoteBook, ts: number, seen: number, bids: Array<[number, number]>, asks: Array<[number, number]>) {
      (mem.tables.agent_book_levels as Row[]).push({ book, ts: iso(ts), seen_until: iso(seen), reads: 1, bids: bids.map(([p, q]) => [p, q, 1]), asks: asks.map(([p, q]) => [p, q, 1]) });
    },
    /** The executor's turn after PR5 decided minute t, wired as the driver wires a turn that may take. */
    async turn(t: number) {
      const at = t + M + 25e3;
      clock.now = at;
      const reads = await takeReadsAt(mem.db, at);
      const sim = new SimRevx(st, () => clock.now, () => null, (b) => { const r = takeFillRead(reads[b], at); return r ? simBookOfRead(r) : null; });
      const mark = (row: Record<string, unknown>) => { if (isTake(row)) sim.markTake(String(row.client_order_id)); };
      return await runQuotesLive({
        db: stampTs(mem.db, inst.orders, () => at, undefined, mark), now: at, holder: `h${at}`, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        account: revxVenue({ apiKey: "simulated", privateKey: KEY }, sim.fetch, REVX_REGION, () => clock.now), accountNote: null,
        fetch: sim.publicFetch, pause: () => Promise.resolve(), clock: () => clock.now, instance: inst,
        recordedBook: (b: QuoteBook) => Promise.resolve(takeBookRow(reads[b].before, at)),
      });
    },
    orders: () => mem.tables[inst.orders] as Row[],
    takes: () => (mem.tables[inst.orders] as Row[]).filter(isTake),
    /** Rows sent today, as the governor counts them. */
    sent: () => (mem.tables[inst.orders] as Row[]).filter((r) => (r.response as { wouldBeRefused?: unknown } | null)?.wouldBeRefused !== true).length,
  };
  return w;
}
/** The turn of the second minute: 2026-10-05 09:02:25 UTC. */
const AT2 = T0 + 2 * M + 25e3;
/** Two turns, the second meeting a USDC read made 15 s before it and read again after it, asking `ask` (500 deep). */
async function twoTurns(w: ReturnType<typeof world>, ask = 0.7539, prints2: Partial<Record<QuoteBook, Print[]>> = {}) {
  await w.paper(T0);
  await w.turn(T0);
  w.read(USDC, AT2 - 15e3, AT2 + 15e3, [[0.7530, 500]], [[ask, 500]]);
  await w.paper(T0 + M, prints2);
  return await w.turn(T0 + M);
}

// ------------------------------------------------------------------ the rule's arithmetic

Deno.test("the take's limit is k + 0.09 % from fair, 19 / 29 / 39 bps, and a book a tick short of it does not take", () => {
  // Fair 1 / 1.3238 = 0.7554011…: a bid rung buys at most floor(f × (1 − k − 0.0009)), an ask rung sells at least ceil(f × (1 + k + 0.0009)).
  assertEquals([0.001, 0.002, 0.003].map((k) => takeLimitTicks(F, k, "bid")), [7539, 7532, 7524]);
  assertEquals([0.001, 0.002, 0.003].map((k) => takeLimitTicks(F, k, "ask")), [7569, 7576, 7584]);
  // A bid rung takes when the best ask is at or under its limit; an ask rung when the best bid is at or over it.
  assertEquals([takeTriggered("bid", 7539, { bid: 7530, ask: 7539 }), takeTriggered("bid", 7539, { bid: 7530, ask: 7540 }), takeTriggered("bid", 7539, { bid: 7538, ask: null })], [true, false, false]);
  assertEquals([takeTriggered("ask", 7569, { bid: 7569, ask: 7575 }), takeTriggered("ask", 7569, { bid: 7568, ask: 7575 }), takeTriggered("ask", 7569, { bid: null, ask: 7570 })], [true, false, false]);
  // A read's touch: its best bid and best ask in ticks, whatever order its levels came in.
  assertEquals(readTouch({ bids: [[0.7530, 5, 1], [0.7531, 5, 1]], asks: [[0.7540, 5, 1], [0.7539, 5, 1]] }), { bid: 7531, ask: 7539 });
});

Deno.test("the book a take decides on is the recorder's last read at or before the turn, seen at most 90 s before it", async () => {
  const at = AT2;
  const row = (ts: number, seen: number | null): RecordedRead => ({ ts: iso(ts), seen_until: seen == null ? null : iso(seen), bids: [], asks: [] });
  assertEquals(takeBookRow(row(at - 300e3, at - 90e3), at)?.ts, iso(at - 300e3));
  assertEquals(takeBookRow(row(at - 300e3, at - 90e3 - 1), at), null);                       // seen 90.001 s before: too old
  assertEquals(takeBookRow(row(at - 60e3, null), at)?.ts, iso(at - 60e3));                   // a row from before 0058: its ts
  assertEquals(takeBookRow(row(at + 1, at + 1), at), null);                                  // read after the turn
  // What the executor reads without a driver: the last row at or before the turn, by that rule.
  const w = world();
  w.read(USDC, at - 200e3, at - 100e3, [[0.7530, 1]], [[0.7539, 1]]);
  w.read(USDC, at - 80e3, at - 20e3, [[0.7531, 1]], [[0.7540, 1]]);
  w.read(USDC, at + 10e3, at + 10e3, [[0.7532, 1]], [[0.7541, 1]]);
  assertEquals((await recordedBookAt(w.mem.db, USDC, at))?.ts, iso(at - 80e3));
  assertEquals((await recordedBookAt(w.mem.db, USDC, at + 100e3))?.ts, iso(at + 10e3));     // its last read, 90 s before
  assertEquals(await recordedBookAt(w.mem.db, USDC, at + 101e3), null);                     // 91 s before: none
});

Deno.test("the read a take fills against: the one the turn met when it was read again after the turn, else the next within 60 s, else none", () => {
  const at = AT2;
  const row = (ts: number, seen: number): RecordedRead => ({ ts: iso(ts), seen_until: iso(seen), bids: [], asks: [] });
  const met = row(at - 15e3, at + 15e3), stale = row(at - 15e3, at), next = row(at + 40e3, at + 40e3);
  assertEquals(takeFillRead({ before: met, after: next }, at), met);                         // the same row, read again after the turn
  assertEquals(takeFillRead({ before: stale, after: next }, at), next);                      // last seen at the turn: the next row
  assertEquals(takeFillRead({ before: stale, after: row(at + 60e3, at + 60e3) }, at)?.ts, iso(at + 60e3));
  assertEquals(takeFillRead({ before: stale, after: row(at + 60e3 + 1, at + 70e3) }, at), null);   // 60.001 s after: none
  assertEquals(takeFillRead({ before: null, after: null }, at), null);
  assertEquals(simBookOfRead({ ts: iso(at + 40e3), seen_until: null, bids: [[0.7530, 5, 1]], asks: [[0.7539, 7, null]] }),
    { bids: [[0.7530, 5]], asks: [[0.7539, 7]], source: `recorded read ${iso(at + 40e3)}`, at: at + 40e3 });
});

// ------------------------------------------------------------------ the take in the executor

Deno.test("a take: the rung's entry cancelled and read back, then one IOC at k + 0.09 % for its £50, an entry with no paper order; filled, it exits as any entry", async () => {
  const w = world();
  const r2 = await twoTurns(w);
  const usdcBid = (k: number) => w.orders().filter((o) => o.book === USDC && o.rung_side === "bid" && Number(o.k) === k);
  // The 0.1 % bid's entry (0.7546) went first, read back cancelled; then the IOC at the limit 0.7539, for £50 at it:
  // 50 / 0.7539 = 66.32179 coins, floored to the step. The 0.2 % and 0.3 % bids (limits 0.7532, 0.7524) did not take.
  const [entry, take] = usdcBid(0.001);
  assertEquals([entry.leg, Number(entry.price), entry.state, entry.cancel_reason], ["entry", 0.7546, "cancelled", "a take replaces the rung's entry"]);
  assertEquals([take.leg, take.side, Number(take.price), Number(take.base_size), take.paper_oid, take.paper_live, Number(take.fair)], ["entry", "buy", 0.7539, 66.32179, null, null, F]);
  const req = take.request as Record<string, unknown>;
  assertEquals([req.take, req.marketable, req.postOnly, req.timeInForce, req.takeRead], [true, true, false, "ioc", { ts: iso(AT2 - 15e3), seenUntil: iso(AT2 + 15e3), bestBid: 0.753, bestAsk: 0.7539 }]);
  assertEquals(w.takes().length, 1);
  assertEquals(r2.cancelled.filter((c) => c.reason === "a take replaces the rung's entry").map((c) => [c.rung, c.outcome]), [["USDC-GBP|bid|0.001", "cancelled"]]);
  // The account filled it against the read the turn met (read again after it): 66.32179 at 0.7539, £49.99999748 debited
  // £50.00, its fee 0.05969 USDC (66.32179 × 0.0009, up to the step) in the coin.
  const sim = w.st.orders.find((o) => o.take)!;
  assertEquals([sim.status, sim.filled, sim.moved, sim.fee, sim.feeCurrency], ["filled", 66.32179, 50, 0.05969, "USDC"]);
  // The next turn reads it back: an entry fill of 66.32179 − 0.05969 = 66.2621 coins at what the account moved a coin
  // (£50.00 / 66.32179), and the rung exits at fair (0.7555) as any entry's fill does.
  await w.paper(T0 + 2 * M);
  await w.turn(T0 + 2 * M);
  assertEquals([take.state, Number(take.filled_base), Number(take.avg_fill_price)], ["filled", 66.2621, 50 / 66.32179]);
  const exit = usdcBid(0.001).find((o) => o.leg === "exit")!;
  assertEquals([exit.side, Number(exit.price), exit.state], ["sell", 0.7555, "new"]);
  assert(Number(exit.base_size) <= 66.2621 && Number(exit.base_size) > 66.26, String(exit.base_size));

  // Counterfactual: the book a tick over the limit (0.7540). Nothing takes, and the entry keeps resting.
  const c = world();
  await twoTurns(c, 0.7540);
  assertEquals(c.takes().length, 0);
  assertEquals(c.orders().filter((o) => o.book === USDC && o.rung_side === "bid" && Number(o.k) === 0.001).map((o) => [Number(o.price), o.state]), [[0.7546, "new"]]);
});

Deno.test("a take needs every condition of its eligibility: each one alone stops it, and the paper rung's own position too", async () => {
  /** How many takes the second turn sent, with the world changed by `setup` before it (and `before` before the first). */
  const takes = async (o: Opts, setup: (w: ReturnType<typeof world>) => Promise<void> | void = () => {}, prints2: Partial<Record<QuoteBook, Print[]>> = {}) => {
    const w = world(o);
    await w.paper(T0);
    await w.turn(T0);
    w.read(USDC, AT2 - 15e3, AT2 + 15e3, [[0.7530, 500]], [[0.7539, 500]]);
    await setup(w);
    await w.paper(T0 + M, prints2);
    await w.turn(T0 + M);
    return w.takes().length;
  };
  const today = (w: ReturnType<typeof world>, n: number) => {
    for (let i = 0; i < n; i++) (w.mem.tables[I.orders] as Row[]).push({ id: 90000 + i, ts: iso(T0 - 60e3), mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.003, leg: "entry", side: "sell", price: 0.7584, base_size: 1, client_order_id: crypto.randomUUID(), state: "cancelled", filled_base: 0, fee_gbp: 0, response: null });
  };
  // The case itself takes.
  assertEquals(await takes({}), 1);
  // Its option not yet in force (from 12:00 that day), or none at all (the live account's instance has none).
  assertEquals(await takes({ inst: { ...I, take: { from: T0 + 3 * H } } }), 0);
  assertEquals(await takes({ inst: { ...I, take: undefined } }), 0);
  // Entries not going to the live book: not armed, or in dry-run.
  assertEquals(await takes({ config: { live_confirmed_at: null } }), 0);
  assertEquals(await takes({ config: { dry_run: true } }), 0);
  // A guard on the book: its USD book's hours stale (none for three hours).
  assertEquals(await takes({}, (w) => { w.mem.tables.agent_quote_inputs = (w.mem.tables.agent_quote_inputs as Row[]).filter((r) => !(r.kind === "fair:USDC-USD" && Date.parse(String(r.t)) > T0 - 3 * H)); }), 0);
  // The governor past 900 POSTs today, and the day's loss stop.
  assertEquals(await takes({}, (w) => today(w, 900)), 0);
  assertEquals(await takes({}, async (w) => { await w.mem.db.upsert(I.events, [{ mode: "live", minute: iso(T0), book: "-", rung_side: "-", k: 0, kind: "loss_stop", detail: {} }], "mode,minute,book,rung_side,k,kind"); }), 0);
  // The rung holding (an entry of 66 filled before): it exits instead; none of its siblings is through its own limit.
  assertEquals(await takes({}, async (w) => {
    await w.mem.db.insert(I.orders, { ts: iso(T0), mode: "live", book: USDC, rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 66, client_order_id: crypto.randomUUID(), state: "filled", filled_base: 66, avg_fill_price: 0.7546, filled_at: iso(T0) });
    w.st.balances.USDC += 66;
  }), 0);
  // The read the turn would decide on last seen 91 s before it; at 90 s it still takes.
  assertEquals(await takes({}, (w) => { (w.mem.tables.agent_book_levels as Row[])[0].seen_until = iso(AT2 - 91e3); (w.mem.tables.agent_book_levels as Row[])[0].ts = iso(AT2 - 100e3); }), 0);
  assertEquals(await takes({}, (w) => { (w.mem.tables.agent_book_levels as Row[])[0].seen_until = iso(AT2 - 90e3); (w.mem.tables.agent_book_levels as Row[])[0].ts = iso(AT2 - 100e3); }), 1);
  // PR5's paper rung in a position of its own: a seller at 0.7545 through its 0.7546 bid at 09:01:10 fills it.
  const through: Print = { id: "p1", ts: T0 + M + 10e3, ticks: 7545, qty: 500, side: "sell" };
  assertEquals(await takes({}, () => {}, { [USDC]: [through] }), 0);
  // Counterfactual of the last: the same seller at 0.7546, at the bid's price, fills nothing on paper, and the rung takes.
  assertEquals(await takes({}, () => {}, { [USDC]: [{ ...through, ticks: 7546 }] }), 1);
});

Deno.test("a take's POST is the governor's: the 900th closes entries to the rungs after it in the same turn", async () => {
  /** Takes in the second turn, with today's POSTs `upTo` before it, both USDC bids through their limits (ask 0.7532). */
  const takes = async (upTo: number) => {
    const w = world();
    await w.paper(T0);
    const r1 = await w.turn(T0);
    const sent = w.sent();
    assertEquals(r1.posts.live, sent);
    for (let i = 0; i < upTo - sent; i++) (w.mem.tables[I.orders] as Row[]).push({ id: 90000 + i, ts: iso(T0 - 60e3), mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.003, leg: "entry", side: "sell", price: 0.7584, base_size: 1, client_order_id: crypto.randomUUID(), state: "cancelled", filled_base: 0, fee_gbp: 0, response: null });
    w.read(USDC, AT2 - 15e3, AT2 + 15e3, [[0.7520, 500]], [[0.7532, 500]]);
    await w.paper(T0 + M);
    const r2 = await w.turn(T0 + M);
    return { takes: w.takes().map((o) => Number(o.k)), posts: r2.posts.live };
  };
  // 898 sent before the turn: both bids take, the POSTs reaching 900.
  assertEquals(await takes(898), { takes: [0.001, 0.002], posts: 900 });
  // 899: the 0.1 % bid's take is the 900th, and the 0.2 % bid, after it, is closed to entries.
  assertEquals(await takes(899), { takes: [0.001], posts: 900 });
});

Deno.test("a frozen cancel waits: no take while the rung's entry cannot be read back cancelled", async () => {
  // £100 more than the six bids hold, so the take's own funds check would pass: only the frozen cancel stops it.
  const w = world({ balances: { GBP: 400, USDC: 200, USDT: 200 } });
  await w.paper(T0);
  await w.turn(T0);
  // The 0.1 % bid's entry with no venue id known: its cancel cannot be asked, so the rung is frozen.
  const entry = w.orders().find((o) => o.book === USDC && o.rung_side === "bid" && Number(o.k) === 0.001)!;
  entry.venue_order_id = null;
  w.read(USDC, AT2 - 15e3, AT2 + 15e3, [[0.7530, 500]], [[0.7539, 500]]);
  await w.paper(T0 + M);
  const r2 = await w.turn(T0 + M);
  assertEquals([w.takes().length, entry.state], [0, "new"]);
  assert(r2.errors.some((e) => /cannot cancel .* the rung is frozen/.test(e)), JSON.stringify(r2.errors));
  // It waited: it did not go on to an order the rung's one open row would refuse.
  assert(!r2.errors.some((e) => /another live order is open on this rung/.test(e)), JSON.stringify(r2.errors));
});

Deno.test("the take fills against the read after the turn: the same row, the next one, or none", async () => {
  /** The take's fill in the account, with the USDC reads around the second turn set by `reads`. */
  const fill = async (reads: (w: ReturnType<typeof world>) => void) => {
    const w = world();
    await w.paper(T0);
    await w.turn(T0);
    reads(w);
    await w.paper(T0 + M);
    await w.turn(T0 + M);
    const o = w.st.orders.find((x) => x.take);
    return o ? [o.status, o.filled, o.moved] : null;
  };
  const met = (seen: number) => (w: ReturnType<typeof world>) => w.read(USDC, AT2 - 15e3, seen, [[0.7530, 500]], [[0.7539, 500]]);
  // The read the turn met, read again 15 s after it: 66.32179 at 0.7539, £50.00.
  assertEquals(await fill(met(AT2 + 15e3)), ["filled", 66.32179, 50]);
  // Last seen at the turn, then a new read 15 s after it asking 0.7536: 66.32179 × 0.7536 = £49.98010… debited £49.99.
  assertEquals(await fill((w) => { met(AT2)(w); w.read(USDC, AT2 + 15e3, AT2 + 15e3, [[0.7530, 500]], [[0.7536, 500]]); }), ["filled", 66.32179, 49.99]);
  // That new read over the limit (0.7541): nothing fills.
  assertEquals(await fill((w) => { met(AT2)(w); w.read(USDC, AT2 + 15e3, AT2 + 15e3, [[0.7530, 500]], [[0.7541, 500]]); }), ["cancelled", 0, 0]);
  // The next read 61 s after the turn, or none: nothing fills.
  assertEquals(await fill((w) => { met(AT2)(w); w.read(USDC, AT2 + 61e3, AT2 + 61e3, [[0.7530, 500]], [[0.7536, 500]]); }), ["cancelled", 0, 0]);
  assertEquals(await fill(met(AT2)), ["cancelled", 0, 0]);
});
