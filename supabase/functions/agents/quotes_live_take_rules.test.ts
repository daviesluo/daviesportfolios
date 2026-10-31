// The live account's take (`take_mode`, variant-2's rule, the twins' own code path) under the rules LIVE took after Davies'
// 10-18 word: the £1 holding line (`holdMin`, 10-29 22:00), USDT-GBP alone (`weights`, 10-29 22:30), every exit a tick beyond
// fair (`exitOffset`, 10-30 00:00) and, for three days after new weights, the coin rebook (`rebookOn`). The two risks the
// 2026-10-30 re-read of the shadow left unverified (docs/agents/reviews/2026-09-24-pr5-live-design.md, the 10-18 addendum):
//   1. a take IOC that fills only under the line leaves the rung not holding: may it send more IOCs, and how many?
//   2. a rebook's sale of surplus coin against the coin a take bought: may it offer that coin too, or starve the rung's exit?
// The live executor (quotes_live.ts) with the live account's instance runs on a simulated Revolut X account (revx_sim.ts),
// wired as quotes_live_switches.test.ts wires it; PR5's engine is stepped by its own `stepMinute`. Each pin has its
// counterfactual beside it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { holdLineBase, QUOTE_LIVE_INSTANCE, rebookOn, runQuotesLive, takeBookRow, type QuoteLiveInstance, type QuoteLiveReport } from "./quotes_live.ts";
import { LIVE_WK_PAPER } from "./quotes_live_weekend.ts";
import { newSimState, SimRevx, type SimState } from "./revx_sim.ts";
import { simBookOfRead, stampTs, takeFillRead, takeReadsAt } from "./quotes_twin.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const X = 1.3238;                                // GBP/USD; with the USD books at 1.0000 fair is 1 / X = 0.755401…
const F = 1 / X;
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const USDT: QuoteBook = "USDT-GBP";
const T0 = Date.parse("2026-11-05T09:00:00Z");   // a Thursday, every rule of LIVE's in force, the rebook's three days over
const isTake = (r: Row) => (r.request as { take?: unknown } | null)?.take === true;
const isDrainRow = (r: Row) => (r.request as { drain?: unknown } | null)?.drain === true;
const OPEN = new Set(["pending", "new", "partially_filled"]);

type Opts = { inst?: QuoteLiveInstance; config?: Record<string, unknown>; balances?: Record<string, number> };

/** The live account's executor after PR5's engine, its turns 25 s into the minute after the one decided, on a simulated account. */
function world(o: Opts = {}) {
  const I = o.inst ?? QUOTE_LIVE_INSTANCE;
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 3 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 3 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: I.lease, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_live_config: [{ id: 1, dry_run: false, live_confirmed_at: iso(T0 - H), capital_gbp: 600, take_mode: "live", ...(o.config ?? {}) }],
    agent_quote_live_orders: [], agent_quote_live_events: [], agent_quote_live_state: [], agent_quote_state: [], [LIVE_WK_PAPER]: [],
    agent_quote_inputs: inputs, agent_quote_events: [], agent_book_levels: [],
  }, { now: () => clock.now });
  const seed = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seed(b))])) as Record<QuoteBook, BookState>;
  const st: SimState = newSimState(o.balances ?? { GBP: 400, USDC: 0, USDT: 400 }, { "USDC-GBP": seed("USDC-GBP"), [USDT]: seed(USDT) });
  let n = 0;
  return {
    mem, clock, st, I,
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
    orders: () => mem.tables.agent_quote_live_orders as Row[],
    events: (kind: string) => (mem.tables.agent_quote_live_events as Row[]).filter((e) => e.kind === kind),
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
  await turnWith(w, T0, null);
  const reports: QuoteLiveReport[] = [];
  for (let i = 1; i <= 5; i++) reports.push(await turnWith(w, T0 + i * M, [[0.7539, depths[i - 1] ?? 500]]));
  return { w, reports };
}

Deno.test("a take that fills under the £1 line leaves the rung unheld: the next turn sends the rung's whole IOC again; one a turn at most, the coin carried at most a line over the rung, one exit for all of it, none while it holds", async () => {
  // The line: £1 of coin at fair, 1 / 0.7554 = 1.3238 USDT (the venue's minimum under it).
  assertEquals(Number(holdLineBase(QUOTE_LIVE_INSTANCE, T0, 0, F).toFixed(4)), 1.3238);
  const { w, reports } = await partialCase({}, [0.6, 0.6, 500]);
  // Turn 1: the rung's maker entry is cancelled for the take, and an IOC for its £100 at 0.7539 (132.64358 USDT) meets a read
  // 0.6 deep: 0.6 filled, 0.59946 after the 0.09 % fee in the coin, under the line. Turn 2: the rung counts as holding
  // nothing, the book is still through, and the same IOC goes again (0.6 more). Turn 3: again, against a read 500 deep: it
  // fills whole. Three IOCs on one opportunity, each for the rung's whole pounds, never two in a turn.
  assertEquals(takes(w).map((o) => [o.ts, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base)]), [
    [iso(T0 + 2 * M + 25e3), 0.7539, 132.64358, "filled", 0.59946],
    [iso(T0 + 3 * M + 25e3), 0.7539, 132.64358, "filled", 0.59946],
    [iso(T0 + 4 * M + 25e3), 0.7539, 132.64358, "filled", 132.5242],
  ]);
  assertEquals(bid1(w)[0].cancel_reason, "a take replaces the rung's entry");
  for (const r of reports) assert(r.placed.filter((p) => p.rung === "USDT-GBP|bid|0.001" && p.leg === "entry").length <= 1);
  // What it carries: the rung's 132.5242 and the two partials' 1.19892, over its £100 by less than the line. One exit sells
  // all of it (trimmed to the penny by `pennyExit`) a tick beyond fair (0.7556), and the turn after it, the book still
  // through the limit, sends no fourth IOC: the rung holds.
  const held = 0.59946 * 2 + 132.5242;
  assert(held - 132.5242 < 1.3238);
  const [exit] = exitsOf(w);
  assertEquals([exitsOf(w).length, exit.side, Number(exit.price), exit.state], [1, "sell", 0.7556, "new"]);
  assert(Number(exit.base_size) <= held && held - Number(exit.base_size) < 0.01, String(exit.base_size));
  assertEquals(reports.flatMap((r) => r.errors), []);

  // Counterfactual, the depth: a read 2 coins deep (over the line) fills 1.9982 after the fee: the rung holds, its exit goes
  // out the next turn, and no second IOC follows though the book stays through the limit for four more turns.
  const deep = await partialCase({}, [2, 0.6, 0.6]);
  assertEquals(takes(deep.w).map((o) => [o.ts, Number(o.filled_base)]), [[iso(T0 + 2 * M + 25e3), 1.9982]]);
  assertEquals(exitsOf(deep.w).map((o) => [o.ts, Number(o.price)]), [[iso(T0 + 3 * M + 25e3), 0.7556]]);
  // Counterfactual, the line: the same 0.6-coin partial with no `holdMin` (the line the venue's minimum, LIVE before 10-29
  // 22:00) is a holding: one IOC, then its exit, no second.
  const noLine = await partialCase({ inst: { ...QUOTE_LIVE_INSTANCE, holdMin: undefined } }, [0.6, 0.6, 500]);
  assertEquals(takes(noLine.w).map((o) => Number(o.filled_base)), [0.59946]);
  assertEquals(exitsOf(noLine.w).length, 1);
});

Deno.test("take_mode shadow on the same partials: no IOC, every order as 'off' sends it, and one take_shadow event a minute the book is through", async () => {
  const off = await partialCase({ config: { take_mode: "off" } }, [0.6, 0.6, 500]);
  const sh = await partialCase({ config: { take_mode: "shadow" } }, [0.6, 0.6, 500]);
  assertEquals([takes(off.w).length, takes(sh.w).length], [0, 0]);
  assertEquals(sh.w.orders().map(shape), off.w.orders().map(shape));
  // The paper entry keeps resting (no print fills it), so the shadow's would-be IOC is the same each minute: five of them.
  const ev = sh.w.events("take_shadow").filter((e) => e.book === USDT);
  assertEquals(ev.map((e) => [e.rung_side, Number(e.k), (e.detail as { limit: number }).limit, (e.detail as { base: string }).base]),
    Array.from({ length: 5 }, () => ["bid", 0.001, 0.7539, "132.64358"]));
  assertEquals(bid1(sh.w).map((o) => [Number(o.price), o.state]), [[0.7546, "new"]]);
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
