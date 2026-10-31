// The live account's take (`take_mode`, variant-2's rule, the twins' own code path) under the rules LIVE took after Davies'
// 10-18 word: the £1 holding line (`holdMin`, 10-29 22:00), USDT-GBP alone (`weights`, 10-29 22:30), every exit a tick beyond
// fair (`exitOffset`, 10-30 00:00) and, for three days after new weights, the coin rebook (`rebookOn`). The two risks the
// 2026-10-30 re-read of the shadow left unverified (docs/agents/reviews/2026-09-24-pr5-live-design.md, the 10-18 addendum):
//   1. a take IOC that fills only under the line leaves the rung not holding: may it send more IOCs, and how many? Before
//      TAKE_DEPTH_FROM it did, an IOC a minute; from it a read resting no more coin through the limit than the line is no
//      take at all (TAKE-DEPTH, the take pre-registration's deviation reviews/2026-10-31-take-depth-deviation.md);
//   2. a rebook's sale of surplus coin against the coin a take bought: may it offer that coin too, or starve the rung's exit?
// The live executor (quotes_live.ts) with the live account's instance runs on a simulated Revolut X account (revx_sim.ts),
// wired as quotes_live_switches.test.ts wires it; PR5's engine is stepped by its own `stepMinute`. Each pin has its
// counterfactual beside it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { holdLineBase, QUOTE_LIVE_INSTANCE, readDepthThrough, rebookOn, runQuotesLive, TAKE_DEPTH_FROM, takeBookRow, takeDeep, type QuoteLiveInstance, type QuoteLiveReport } from "./quotes_live.ts";
import { LIVE_WK_PAPER } from "./quotes_live_weekend.ts";
import { newSimState, SimRevx, type SimState } from "./revx_sim.ts";
import { simBookOfRead, specFromRow, stampTs, takeFillRead, takeReadsAt, TWIN_SPEC_ROWS } from "./quotes_twin.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const X = 1.3238;                                // GBP/USD; with the USD books at 1.0000 fair is 1 / X = 0.755401…
const F = 1 / X;
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const USDT: QuoteBook = "USDT-GBP";
const T0 = Date.parse("2026-11-05T09:00:00Z");   // a Thursday, every rule of LIVE's in force, the rebook's three days over
const T0_DEFAULT = T0;
const BEFORE = Date.parse("2026-10-30T09:00:00Z"); // a Friday before TAKE_DEPTH_FROM, every other rule of LIVE's in force
const isTake = (r: Row) => (r.request as { take?: unknown } | null)?.take === true;
const isDrainRow = (r: Row) => (r.request as { drain?: unknown } | null)?.drain === true;
const OPEN = new Set(["pending", "new", "partially_filled"]);

type Opts = { t0?: number; inst?: QuoteLiveInstance; config?: Record<string, unknown>; balances?: Record<string, number> };

/** The live account's executor after PR5's engine, its turns 25 s into the minute after the one decided, on a simulated account. */
function world(o: Opts = {}) {
  const I = o.inst ?? QUOTE_LIVE_INSTANCE, T0 = o.t0 ?? T0_DEFAULT;
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 3 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 3 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: I.lease, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    [I.config]: [{ id: 1, dry_run: false, live_confirmed_at: iso(T0 - H), capital_gbp: 600, take_mode: "live", ...(o.config ?? {}) }],
    [I.orders]: [], [I.events]: [], [I.state]: [], [I.paper]: [], [LIVE_WK_PAPER]: [],
    agent_quote_inputs: inputs, agent_quote_events: [], agent_book_levels: [],
  }, { now: () => clock.now });
  const seed = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seed(b))])) as Record<QuoteBook, BookState>;
  const st: SimState = newSimState(o.balances ?? { GBP: 400, USDC: 0, USDT: 400 }, { "USDC-GBP": seed("USDC-GBP"), [USDT]: seed(USDT) });
  let n = 0;
  return {
    mem, clock, st, I, t0: T0,
    async paper(t: number) {
      for (const b of QUOTE_BOOKS) stepMinute(books[b], t, { x: X, fairU: 1.0, prints: [] });
      await mem.db.upsert(I.paper, [{ id: 1, state: { lastMinute: t, books, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t) }], "id");
    },
    /** A read of the book recorder: USDT-GBP first read at `ts`, read unchanged until `seen`. */
    read(ts: number, seen: number, bids: Array<[number, number]>, asks: Array<[number, number]>) {
      (mem.tables.agent_book_levels as Row[]).push({ book: USDT, ts: iso(ts), seen_until: iso(seen), reads: 1, bids: bids.map(([p, q]) => [p, q, 1]), asks: asks.map(([p, q]) => [p, q, 1]) });
    },
    async turn(t: number): Promise<QuoteLiveReport> {
      const at = t + M + 25e3;
      clock.now = at;
      const reads = await takeReadsAt(mem.db, at);
      const sim = new SimRevx(st, () => clock.now, () => null, (b) => { const r = takeFillRead(reads[b], at); return r ? simBookOfRead(r) : null; });
      const mark = (row: Record<string, unknown>) => { if (isTake(row)) sim.markTake(String(row.client_order_id)); };
      return await runQuotesLive({
        db: stampTs(mem.db, I.orders, () => at, undefined, mark), now: at, holder: `h${at}`, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        account: revxVenue({ apiKey: "simulated", privateKey: KEY }, sim.fetch, REVX_REGION, () => clock.now), accountNote: null,
        fetch: sim.publicFetch, pause: () => Promise.resolve(), clock: () => clock.now, instance: I,
        recordedBook: (b: QuoteBook) => Promise.resolve(takeBookRow(reads[b].before, at)),
      });
    },
    orders: () => mem.tables[I.orders] as Row[],
    events: (kind: string) => (mem.tables[I.events] as Row[]).filter((e) => e.kind === kind),
  };
}
type World = ReturnType<typeof world>;
/** The turn after PR5 decided minute `t`, at `t` + 85 s, meeting a USDT read made 15 s before it and read again after it. */
async function turnWith(w: World, t: number, asks: Array<[number, number]> | null) {
  const at = t + M + 25e3;
  if (asks) w.read(at - 15e3, at + 15e3, [[0.7530, 500]], asks);
  await w.paper(t);
  return await w.turn(t);
}
const bid1 = (w: World) => w.orders().filter((o) => o.mode === "live" && o.book === USDT && o.rung_side === "bid" && Number(o.k) === 0.001);
const shape = (o: Row) => [o.ts, o.book, o.rung_side, o.k, o.leg, o.side, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base), o.cancel_reason ?? null].join("|");

// ------------------------------------------------------------------ 1. a take that fills under the £1 line

const takes = (w: World) => bid1(w).filter(isTake);
const exitsOf = (w: World) => bid1(w).filter((o) => o.leg === "exit");
/** Five turns after the first: the 0.1 % bid's take limit is 0.7539; turn i meets a read asking it `depths[i - 1]` deep (500 past the list). */
async function partialCase(o: Opts, depths: number[]) {
  const w = world(o);
  await turnWith(w, w.t0, null);
  const reports: QuoteLiveReport[] = [];
  for (let i = 1; i <= 5; i++) reports.push(await turnWith(w, w.t0 + i * M, [[0.7539, depths[i - 1] ?? 500]]));
  return { w, reports };
}
/** When turn i's order was written: 25 s into the minute after PR5's minute t0 + i. */
const turnTs = (w: World, i: number) => iso(w.t0 + (i + 1) * M + 25e3);

Deno.test("TAKE-DEPTH: the coin a read rests through a take's limit, and from TAKE_DEPTH_FROM a take only through more of it than the holding line", () => {
  const read = { bids: [[0.7569, 0.2, 1], [0.7570, 0.3, 1], [0.7568, 9, 1]] as Array<[number, number, number]>, asks: [[0.7539, 0.6, 1], [0.7538, 0.5, 2], [0.7540, 9, 1]] as Array<[number, number, number]> };
  // A bid rung's buy at 7539 meets the asks at or under it (0.6 + 0.5); an ask rung's sell at 7569 the bids at or over it (0.2 + 0.3).
  assertEquals([readDepthThrough(read, "bid", 7539), readDepthThrough(read, "ask", 7569), readDepthThrough(read, "bid", 7537), readDepthThrough(read, "ask", 7571)], [1.1, 0.5, 0, 0]);
  assertEquals(TAKE_DEPTH_FROM, Date.parse("2026-10-31T04:00:00Z"));
  // Before the instant every depth takes; from it, only more than the line.
  assertEquals([takeDeep(TAKE_DEPTH_FROM - 1, 0.1, 1.3238), takeDeep(TAKE_DEPTH_FROM, 1.3238, 1.3238), takeDeep(TAKE_DEPTH_FROM, 1.3239, 1.3238), takeDeep(TAKE_DEPTH_FROM, 0.1, 0)], [true, false, true, true]);
});

Deno.test("from TAKE_DEPTH_FROM a read resting no more than the £1 line through the limit is no take: the rung's entry rests on, the first deeper read takes once, whole; before it, the same reads sent an IOC a minute", async () => {
  // The line: £1 of coin at fair, 1 / 0.7554 = 1.3238 USDT (the venue's minimum under it).
  assertEquals(Number(holdLineBase(QUOTE_LIVE_INSTANCE, T0, 0, F).toFixed(4)), 1.3238);
  const { w, reports } = await partialCase({}, [0.6, 0.6, 500]);
  // Turns 1 and 2 meet a read 0.6 deep through 0.7539: no take, and the rung's maker entry (0.7546) is not touched. Turn 3
  // meets one 500 deep: the entry is cancelled for the take and one IOC for the rung's £100 (132.64358 USDT) fills whole.
  assertEquals(takes(w).map((o) => [o.ts, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base)]), [
    [turnTs(w, 3), 0.7539, 132.64358, "filled", 132.5242],
  ]);
  const entry = bid1(w)[0];
  assertEquals([entry.ts, Number(entry.price), entry.state, entry.cancel_reason, entry.cancel_requested_at], [turnTs(w, 0), 0.7546, "cancelled", "a take replaces the rung's entry", turnTs(w, 3)]);
  // It holds the rung's own coin, no partial carried; one exit sells it a tick beyond fair (0.7556), and no IOC follows.
  const [exit] = exitsOf(w);
  assertEquals([exitsOf(w).length, exit.ts, exit.side, Number(exit.price), exit.state], [1, turnTs(w, 4), "sell", 0.7556, "new"]);
  assert(Number(exit.base_size) <= 132.5242 && 132.5242 - Number(exit.base_size) < 0.01, String(exit.base_size));
  assertEquals(reports.flatMap((r) => r.errors), []);
  // A read 2 coins deep (over the line) takes at once: 1.9982 after the fee, a holding, its exit the next turn, no second IOC.
  const deep = await partialCase({}, [2, 0.6, 0.6]);
  assertEquals(takes(deep.w).map((o) => [o.ts, Number(o.filled_base)]), [[turnTs(deep.w, 1), 1.9982]]);
  assertEquals(exitsOf(deep.w).map((o) => [o.ts, Number(o.price)]), [[turnTs(deep.w, 2), 0.7556]]);

  // Counterfactual, the rule before TAKE_DEPTH_FROM (what the code did until this deviation): the same reads on 10-30. The
  // 0.6-deep read took: an IOC for the rung's whole £100, 0.59946 filled after the fee, under the line, so the rung counted
  // as holding nothing; the next turn sent the same IOC again (0.6 more); the third, against the deep read, filled whole.
  // Three IOCs on one opportunity, one a turn, the rung carrying 1.19892 coins over its pounds into one exit.
  const old = await partialCase({ t0: BEFORE }, [0.6, 0.6, 500]);
  assertEquals(takes(old.w).map((o) => [o.ts, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base)]), [
    [turnTs(old.w, 1), 0.7539, 132.64358, "filled", 0.59946],
    [turnTs(old.w, 2), 0.7539, 132.64358, "filled", 0.59946],
    [turnTs(old.w, 3), 0.7539, 132.64358, "filled", 132.5242],
  ]);
  for (const r of old.reports) assert(r.placed.filter((p) => p.rung === "USDT-GBP|bid|0.001" && p.leg === "entry").length <= 1);
  const held = 0.59946 * 2 + 132.5242, [oldExit] = exitsOf(old.w);
  assertEquals([exitsOf(old.w).length, Number(oldExit.price)], [1, 0.7556]);
  assert(Number(oldExit.base_size) <= held && held - Number(oldExit.base_size) < 0.01 && Number(oldExit.base_size) > 133.7, String(oldExit.base_size));
  // Counterfactual, the line: with no `holdMin` the line is the venue's minimum, so a 0.6-coin read is deep enough and its fill
  // a holding: one IOC, then its exit, no second.
  const noLine = await partialCase({ inst: { ...QUOTE_LIVE_INSTANCE, holdMin: undefined } }, [0.6, 0.6, 500]);
  assertEquals(takes(noLine.w).map((o) => Number(o.filled_base)), [0.59946]);
  assertEquals(exitsOf(noLine.w).length, 1);
});

Deno.test("take_mode shadow under TAKE-DEPTH: no IOC, every order as 'off' sends it, and a take_shadow event only a minute the read is deeper than the line", async () => {
  const off = await partialCase({ config: { take_mode: "off" } }, [0.6, 0.6, 500]);
  const sh = await partialCase({ config: { take_mode: "shadow" } }, [0.6, 0.6, 500]);
  assertEquals([takes(off.w).length, takes(sh.w).length], [0, 0]);
  assertEquals(sh.w.orders().map(shape), off.w.orders().map(shape));
  const events = (w: World) => w.events("take_shadow").filter((e) => e.book === USDT)
    .map((e) => [e.minute, e.rung_side, Number(e.k), (e.detail as { limit: number }).limit, (e.detail as { base: string }).base]);
  // The paper entry keeps resting (no print fills it): turns 3 to 5, 500 deep, each record the would-be IOC; turns 1 and 2 none.
  assertEquals(events(sh.w), [3, 4, 5].map((i) => [iso(sh.w.t0 + (i + 1) * M), "bid", 0.001, 0.7539, "132.64358"]));
  assertEquals(bid1(sh.w).map((o) => [Number(o.price), o.state]), [[0.7546, "new"]]);
  // Counterfactual: before TAKE_DEPTH_FROM the shallow reads were recorded too, all five minutes.
  const old = await partialCase({ t0: BEFORE, config: { take_mode: "shadow" } }, [0.6, 0.6, 500]);
  assertEquals(events(old.w).length, 5);
});

/** Variant-2 (`take50`) as its row stands since 0181: TAKE's rule on LIVE's (the holding line, USDT-GBP alone, the exit a tick beyond fair). */
const TAKE50 = specFromRow({
  ...TWIN_SPEC_ROWS[1], id: "take50", display_name: "Stablecoin quotes variant-2", display_order: 30, table_prefix: "agent_quote_twin_take50",
  lease: "quotes-twin-take50", backfill: null, prereg: "docs/agents/reviews/2026-10-03-take-prereg.md", migration: "0089",
  rules: { take: { from: "2026-10-04T16:00:00Z" }, holdMin: { gbp: 1, from: "2026-10-29T22:00:00Z" }, weights: { book: { "USDC-GBP": 0, "USDT-GBP": 1 }, from: "2026-10-29T22:30:00Z" }, exitOffset: { from: "2026-10-30T00:00:00Z", ticks: 1 } },
}).instance;

Deno.test("variant-2 (take50) takes TAKE-DEPTH at the same minute as LIVE: its shallow reads take nothing from TAKE_DEPTH_FROM and took an IOC a minute before it", async () => {
  assertEquals([TAKE50.orders, TAKE50.holdMin, TAKE50.liveSwitches], ["agent_quote_twin_take50_orders", { from: Date.parse("2026-10-29T22:00:00Z"), gbp: 1 }, undefined]);
  const now = await partialCase({ inst: TAKE50 }, [0.6, 0.6, 500]);
  assertEquals(takes(now.w).map((o) => [o.ts, Number(o.filled_base)]), [[turnTs(now.w, 3), 132.5242]]);
  const old = await partialCase({ inst: TAKE50, t0: BEFORE }, [0.6, 0.6, 500]);
  assertEquals(takes(old.w).map((o) => [o.ts, Number(o.filled_base)]), [[turnTs(old.w, 1), 0.59946], [turnTs(old.w, 2), 0.59946], [turnTs(old.w, 3), 132.5242]]);
});

// ------------------------------------------------------------------ 2. a rebook's sale and the coin a take bought

/** LIVE's instance with its weights new six hours before the start: the rebook runs (QUOTE_LIVE_REBOOK_MS from them). */
const REBOOK: QuoteLiveInstance = { ...QUOTE_LIVE_INSTANCE, weights: { ...QUOTE_LIVE_INSTANCE.weights!, from: T0 - 6 * H } };
const drains = (w: World) => w.orders().filter((o) => o.mode === "live" && o.book === USDT && isDrainRow(o));
/** The USDT the account's open live sells offer. */
const offered = (w: World) => w.orders().filter((o) => o.mode === "live" && o.book === USDT && o.side === "sell" && OPEN.has(String(o.state)))
  .reduce((a, o) => a + Number(o.base_size) - (Number(o.filled_base) || 0), 0);
/** 35 turns from T0 on 420 USDT, the 0.1 % bid taking a read 500 deep at turn 1 when `take`; what is offered checked each turn. */
async function rebookCase(inst: QuoteLiveInstance, take: boolean) {
  const w = world({ inst, balances: { GBP: 400, USDC: 0, USDT: 420 } });
  const errors: string[] = [];
  for (let i = 0; i <= 34; i++) {
    const r = await turnWith(w, T0 + i * M, take && i === 1 ? [[0.7539, 500]] : null);
    errors.push(...r.errors);
    assert(offered(w) <= (w.st.balances.USDT ?? 0) + 1e-9, `turn ${i}: ${offered(w)} USDT offered, ${w.st.balances.USDT} held`);
  }
  return { w, errors };
}

Deno.test("a rebook's sale never offers the coin a take bought, and never starves the rung's exit: the same sale with or without the take, the same exit with or without the rebook", async () => {
  assert(rebookOn(REBOOK, T0) && !rebookOn(QUOTE_LIVE_INSTANCE, T0));
  const withTake = await rebookCase(REBOOK, true);
  // 420 USDT against the three asks' coin and the 2 % buffer: 15.75471 surplus, sold at the top of the asks (0.7555, never
  // under fair) from the first turn. The take buys 132.5242 at turn 1; the sale rests 30 minutes, is cancelled, and the same
  // turn sends what is still surplus with the take's coin in the account: 15.75471 again, not 132.5242 more.
  assertEquals(drains(withTake.w).map((o) => [o.ts, Number(o.price), Number(o.base_size), o.state]), [
    [iso(T0 + M + 25e3), 0.7555, 15.75471, "cancelled"],
    [iso(T0 + 31 * M + 25e3), 0.7555, 15.75471, "new"],
  ]);
  assertEquals(takes(withTake.w).map((o) => Number(o.filled_base)), [132.5242]);
  const [exit] = exitsOf(withTake.w);
  assertEquals([exitsOf(withTake.w).length, exit.state, Number(exit.price)], [1, "new", 0.7556]);
  assertEquals(withTake.errors, []);

  // Counterfactual, the take: without it the sales are the same, so none of the take's coin is ever counted surplus.
  const noTake = await rebookCase(REBOOK, false);
  const sale = (o: Row) => [o.ts, Number(o.base_size), o.state];
  assertEquals(drains(noTake.w).map(sale), drains(withTake.w).map(sale));
  assertEquals(takes(noTake.w).length, 0);
  // Counterfactual, the rebook: without it (LIVE's own instance, its three days over) the exit is the same order, so the
  // sale took nothing from it; and no sale at all.
  const noRebook = await rebookCase(QUOTE_LIVE_INSTANCE, true);
  assertEquals(drains(noRebook.w).length, 0);
  assertEquals(exitsOf(noRebook.w).map(shape), exitsOf(withTake.w).map(shape));
  // On 400 USDT (no surplus) the take's coin lifts the account to 532.5242, and still nothing is sold: that coin is the long's.
  const lean = world({ inst: REBOOK, balances: { GBP: 400, USDC: 0, USDT: 400 } });
  for (let i = 0; i <= 3; i++) await turnWith(lean, T0 + i * M, i === 1 ? [[0.7539, 500]] : null);
  assertEquals([drains(lean).length, Number((lean.st.balances.USDT ?? 0).toFixed(5)), exitsOf(lean).length], [0, 532.5242, 1]);
});
