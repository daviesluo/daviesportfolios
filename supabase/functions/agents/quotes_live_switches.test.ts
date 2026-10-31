// The live account's two switches (0131; Davies, 2026-10-18: "live的策略有主动吃单吗？…会的话就加上，然后加上周末的挂单，一定验证好没问题
// 再推上实盘部署"), each 'off' by default, 'shadow' (record what it would send, send nothing) or 'live':
//   take_mode     TAKE's taker entry (variant-2's rule), the twins' own code path;
//   weekend_mode  PR5-W's weekend quoting, carrying out the weekend replica (quotes_live_weekend.ts) inside an FX closure.
// The live executor (quotes_live.ts) with the live account's instance runs on a simulated Revolut X account (revx_sim.ts),
// PR5's engine stepped by its own `stepMinute`. What is pinned, each with its counterfactual: off sends and records nothing new;
// shadow records the would-be order and sends exactly what off sends; live sends it; the weekend source only inside a closure,
// never on a stale replica; and the replica's own start, warm-up, rule instant and check against PR5's record.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { newBookState, QUOTE_BOOKS, quoteTicks, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { QUOTE_LIVE_INSTANCE, runQuotesLive, switchMode, takeBookRow, type QuoteLiveReport } from "./quotes_live.ts";
import { closureStartOf, LIVE_WK_PAPER, nextClosureStart, stepLiveWeekendPaper } from "./quotes_live_weekend.ts";
import { inQuoteClosure } from "./quotes_weekend.ts";
import { newSimState, SimRevx, type SimState } from "./revx_sim.ts";
import { simBookOfRead, stampTs, takeFillRead, takeReadsAt } from "./quotes_twin.ts";
import { memDb, type Row } from "./testing.ts";
import type { Db } from "./db.ts";

const M = 60e3, H = 3600e3;
const X = 1.3238;                           // GBP/USD; with the USD books at 1.0000 fair is 1 / X = 0.755401…
const F = 1 / X;
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const I = QUOTE_LIVE_INSTANCE;
const USDC: QuoteBook = "USDC-GBP";
const THU = Date.parse("2026-10-22T09:00:00Z");   // a Thursday: GBP/USD live
const SAT = Date.parse("2026-10-24T09:00:00Z");   // a Saturday: inside the closure, GBP/USD dark
const isTake = (r: Row) => (r.request as { take?: unknown } | null)?.take === true;

type Opts = { t0?: number; config?: Record<string, unknown>; fxLive?: boolean; preMigration?: boolean; jsonb?: boolean };

/** The database as it answers before 0131 has run: a select naming its columns is PostgREST's 42703. */
const MISSING = `db GET /rest/v1/agent_quote_live_config → 400: {"code":"42703","message":"column agent_quote_live_config.take_mode does not exist"}`;
/** Objects as jsonb gives them back: keys in its own order (shortest first, then bytewise), never the order written. */
const jsonbOrder = (v: unknown): unknown => Array.isArray(v) ? v.map(jsonbOrder)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])])) : v;
function asJsonb(db: Db): Db {
  return { ...db, select: (async <T>(t: string, q: string) => (await db.select<T>(t, q)).map((r) => jsonbOrder(r) as T)) as Db["select"] };
}
function before0131(db: Db): Db {
  return { ...db, select: (<T>(t: string, q: string) => /take_mode|weekend_mode/.test(q) ? Promise.reject(new Error(MISSING)) : db.select<T>(t, q)) as Db["select"] };
}

/** The live account's executor after PR5's engine, its turns 25 s into the minute after the one decided, on a simulated account. */
function world(o: Opts = {}) {
  const T0 = o.t0 ?? THU, fxLive = o.fxLive ?? true;
  const clock = { now: T0 };
  const inputs: Row[] = [];
  if (fxLive) for (let t = T0 - 2 * H; t <= T0 + 3 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 3 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: I.lease, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_live_config: [{ id: 1, dry_run: false, live_confirmed_at: iso(T0 - H), capital_gbp: 600, ...(o.config ?? {}) }],
    agent_quote_live_orders: [], agent_quote_live_events: [], agent_quote_live_state: [], agent_quote_state: [], [LIVE_WK_PAPER]: [],
    agent_quote_inputs: inputs, agent_quote_events: [], agent_book_levels: [],
  }, { now: () => clock.now });
  const seed = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seed(b))])) as Record<QuoteBook, BookState>;
  const wkBooks = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seed(b))])) as Record<QuoteBook, BookState>;
  const st: SimState = newSimState({ GBP: 300, USDC: 200, USDT: 200 }, { [USDC]: seed(USDC), "USDT-GBP": seed("USDT-GBP") });
  let n = 0;
  const w = {
    mem, clock, st,
    /** PR5's engine decides minute t, as its call does (dark when GBP/USD is), and saves it where the executor reads it. */
    async paper(t: number) {
      for (const b of QUOTE_BOOKS) stepMinute(books[b], t, { x: fxLive ? X : null, fairU: 1.0, prints: [] });
      await mem.db.upsert(I.paper, [{ id: 1, state: { lastMinute: t, books, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t) }], "id");
    },
    /**
     * The weekend replica decides minute t on the held X (PR5-W's case 2), saved where the executor reads it; `behind` leaves it
     * a minute stale; `x` decides it on another X, so its prices differ from PR5's engine's.
     */
    async weekend(t: number, behind = false, x = X) {
      for (const b of QUOTE_BOOKS) stepMinute(wkBooks[b], t, { x, fairU: 1.0, prints: [] });
      const at = behind ? t - M : t;
      await mem.db.upsert(LIVE_WK_PAPER, [{ id: 1, state: { lastMinute: at, books: wkBooks, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(at), updated_at: iso(t) }], "id");
    },
    read(book: QuoteBook, ts: number, seen: number, bids: Array<[number, number]>, asks: Array<[number, number]>) {
      (mem.tables.agent_book_levels as Row[]).push({ book, ts: iso(ts), seen_until: iso(seen), reads: 1, bids: bids.map(([p, q]) => [p, q, 1]), asks: asks.map(([p, q]) => [p, q, 1]) });
    },
    async turn(t: number): Promise<QuoteLiveReport> {
      const at = t + M + 25e3;
      clock.now = at;
      const reads = await takeReadsAt(mem.db, at);
      const sim = new SimRevx(st, () => clock.now, () => null, (b) => { const r = takeFillRead(reads[b], at); return r ? simBookOfRead(r) : null; });
      const mark = (row: Record<string, unknown>) => { if (isTake(row)) sim.markTake(String(row.client_order_id)); };
      return await runQuotesLive({
        db: stampTs(o.preMigration ? before0131(mem.db) : o.jsonb ? asJsonb(mem.db) : mem.db, I.orders, () => at, undefined, mark), now: at, holder: `h${at}`, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        account: revxVenue({ apiKey: "simulated", privateKey: KEY }, sim.fetch, REVX_REGION, () => clock.now), accountNote: null,
        fetch: sim.publicFetch, pause: () => Promise.resolve(), clock: () => clock.now, instance: I,
        recordedBook: (b: QuoteBook) => Promise.resolve(takeBookRow(reads[b].before, at)),
      });
    },
    orders: () => mem.tables.agent_quote_live_orders as Row[],
    events: (kind: string) => (mem.tables.agent_quote_live_events as Row[]).filter((e) => e.kind === kind),
  };
  return w;
}
/** An order as two worlds must agree on it, without what the database numbers. */
const shape = (o: Row) => [o.ts, o.book, o.rung_side, o.k, o.leg, o.side, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base), o.cancel_reason ?? null].join("|");

/** Two Thursday turns, the second meeting a USDC read made 15 s before it and read again after it, asking 0.7539 (through the 0.1 % bid's take limit). */
async function takeCase(config: Record<string, unknown>, before?: (w: ReturnType<typeof world>) => void) {
  const w = world({ config });
  before?.(w);
  await w.paper(THU);
  await w.turn(THU);
  const at2 = THU + 2 * M + 25e3;
  w.read(USDC, at2 - 15e3, at2 + 15e3, [[0.7530, 500]], [[0.7539, 500]]);
  await w.paper(THU + M);
  const r = await w.turn(THU + M);
  return { w, r };
}

Deno.test("switchMode: only 'shadow' and 'live' are on; anything else, a missing column included, is off", () => {
  assertEquals([switchMode("shadow"), switchMode("live"), switchMode("off"), switchMode(undefined), switchMode(null), switchMode("LIVE")], ["shadow", "live", "off", "off", "off", "off"]);
});

Deno.test("take_mode: off checks nothing; shadow records the IOC it would send and sends exactly what off sends; live sends it", async () => {
  const off = await takeCase({});
  assertEquals([off.w.orders().filter(isTake).length, off.w.events("take_shadow").length], [0, 0]);
  const bid1 = (w: ReturnType<typeof world>) => w.orders().filter((o) => o.book === USDC && o.rung_side === "bid" && Number(o.k) === 0.001);
  assertEquals(bid1(off.w).map((o) => [Number(o.price), o.state]), [[0.7546, "new"]]);         // the rung's paper entry rests

  const sh = await takeCase({ take_mode: "shadow" });
  // Nothing sent but what off sent: the same orders, row for row; no take; the entry still rests.
  assertEquals(sh.w.orders().map(shape), off.w.orders().map(shape));
  assertEquals(sh.w.orders().filter(isTake).length, 0);
  // One event: the 0.1 % bid's IOC at k + 0.09 % (0.7539) for its £50 (66.32179 coins), funds enough, the read it met.
  const [e] = sh.w.events("take_shadow");
  const d = e.detail as Record<string, unknown>;
  assertEquals([e.book, e.rung_side, Number(e.k), e.mode], [USDC, "bid", 0.001, "live"]);
  assertEquals([d.limit, d.side, d.base, d.fundsOk, d.replaces, d.read], [0.7539, "buy", "66.32179", true, bid1(sh.w)[0].id, { ts: iso(THU + 2 * M + 10e3), seenUntil: iso(THU + 2 * M + 40e3), bestBid: 0.753, bestAsk: 0.7539 }]);
  assertEquals(sh.w.events("take_shadow").length, 1);
  assertEquals(sh.r.shadow, { takes: 1, weekend: 0 });

  const lv = await takeCase({ take_mode: "live" });
  const takes = lv.w.orders().filter(isTake);
  assertEquals(takes.map((o) => [o.book, o.rung_side, Number(o.k), o.side, Number(o.price), Number(o.base_size)]), [[USDC, "bid", 0.001, "buy", 0.7539, 66.32179]]);
  assertEquals(bid1(lv.w)[0].cancel_reason, "a take replaces the rung's entry");
  assertEquals(lv.w.events("take_shadow").length, 0);
});

Deno.test("deployed before 0131 has run: the switches' columns missing, the turn runs as both off, and the weekend replica waits without an error", async () => {
  const run = async (o: Opts) => {
    const w = world(o);
    const reports: QuoteLiveReport[] = [];
    for (let t = THU; t < THU + 3 * M; t += M) { await w.paper(t); reports.push(await w.turn(t)); }
    return { w, reports };
  };
  const a = await run({}), b = await run({ preMigration: true });
  assert(entries(a.w).length >= 12);
  assertEquals(b.w.orders().map(shape), a.w.orders().map(shape));
  assertEquals(b.reports.map((r) => [r.skipped ?? null, r.errors]), a.reports.map((r) => [r.skipped ?? null, r.errors]));
  assertEquals(await stepLiveWeekendPaper(before0131(a.w.mem.db), THU + 4 * M), { skipped: "migration 0131 has not run" });
});

/** Saturday turns from 09:00: PR5's engine dark, the weekend replica deciding on the held X. */
async function weekendCase(config: Record<string, unknown>, minutes = 2, behind = false, jsonb = false) {
  const w = world({ t0: SAT, config, fxLive: false, jsonb });
  const reports: QuoteLiveReport[] = [];
  for (let t = SAT; t < SAT + minutes * M; t += M) {
    await w.paper(t);
    await w.weekend(t, behind);
    reports.push(await w.turn(t));
  }
  return { w, reports };
}
const entries = (w: ReturnType<typeof world>) => w.orders().filter((o) => o.leg === "entry");

Deno.test("weekend_mode: off quotes nothing in the closure (PR5 is dark); shadow records the replica's entries when they change and sends nothing; live carries them out", async () => {
  const off = await weekendCase({});
  assertEquals(entries(off.w).length, 0);
  assertEquals(off.reports.at(-1)!.guards[USDC][0], "no GBP/USD minute in the last ten: dark");
  assertEquals(off.w.events("weekend_shadow").length, 0);

  const sh = await weekendCase({ weekend_mode: "shadow" }, 3);
  assertEquals(entries(sh.w).length, 0);
  // One event a book, at the first turn: the six rungs at the replica's prices (k from fair at the held X), £50 each; the
  // turns after, the same targets, add none.
  const ev = sh.w.events("weekend_shadow");
  assertEquals(ev.map((e) => [e.book, e.minute]), [[USDC, iso(SAT + M)], ["USDT-GBP", iso(SAT + M)]]);
  const d = ev[0].detail as { x: number; fair: number; targets: Array<{ side: string; k: number; price: number; base: string; holding: boolean }>; guards: string[] };
  assertEquals([d.x, d.fair, d.guards], [X, F, []]);
  assertEquals(d.targets.map((t) => [t.side, t.k, t.price, t.holding]), [
    ["bid", 0.001, quoteTicks(F, 0.001, "bid") * 1e-4, false], ["bid", 0.002, Number((quoteTicks(F, 0.002, "bid") * 1e-4).toFixed(4)), false], ["bid", 0.003, Number((quoteTicks(F, 0.003, "bid") * 1e-4).toFixed(4)), false],
    ["ask", 0.001, Number((quoteTicks(F, 0.001, "ask") * 1e-4).toFixed(4)), false], ["ask", 0.002, Number((quoteTicks(F, 0.002, "ask") * 1e-4).toFixed(4)), false], ["ask", 0.003, Number((quoteTicks(F, 0.003, "ask") * 1e-4).toFixed(4)), false],
  ]);
  assert(d.targets.every((t) => Number(t.base) > 0), "each rung sized");
  assertEquals(sh.reports.map((r) => r.shadow?.weekend ?? 0), [2, 0, 0]);     // one a book at the first turn, none while unchanged

  // The same read back as jsonb gives it (keys reordered): still one event a book until the targets change.
  const jb = await weekendCase({ weekend_mode: "shadow" }, 5, false, true);
  assertEquals(jb.reports.map((r) => r.shadow?.weekend ?? 0), [2, 0, 0, 0, 0]);
  assertEquals(jb.w.events("weekend_shadow").length, 2);

  const lv = await weekendCase({ weekend_mode: "live" }, 3);
  // The six rungs a book rest at the replica's prices (the asks too: the account holds coin), from the replica's minute.
  const resting = entries(lv.w).filter((o) => o.state === "new");
  assertEquals(resting.length, 12);
  assertEquals(resting.filter((o) => o.book === USDC && o.rung_side === "bid").map((o) => Number(o.price)).sort(), [0.7531, 0.7538, 0.7546]);
  assertEquals(lv.reports.at(-1)!.weekend, { source: "weekend" });
  assertEquals(lv.w.events("weekend_shadow").length, 0);
});

Deno.test("weekend_mode live: a replica behind PR5's minute is stale (no entry), and outside a closure PR5's engine is read exactly as with the switch off", async () => {
  const stale = await weekendCase({ weekend_mode: "live" }, 3, true);
  assertEquals(entries(stale.w).length, 0);
  assert(stale.reports.at(-1)!.guards[USDC].some((g) => /stale inputs/.test(g)), JSON.stringify(stale.reports.at(-1)!.guards));
  // A Thursday: both switches on, the same orders as both off, row for row (no read of the book makes a take here).
  const run = async (config: Record<string, unknown>) => {
    const w = world({ config });
    for (let t = THU; t < THU + 4 * M; t += M) { await w.paper(t); await w.weekend(t); await w.turn(t); }
    return w;
  };
  const a = await run({}), b = await run({ weekend_mode: "live", take_mode: "shadow" });
  assert(entries(a).length >= 12);
  assertEquals(b.orders().map(shape), a.orders().map(shape));
  assertEquals([b.events("weekend_shadow").length, b.events("take_shadow").length], [0, 0]);
});

Deno.test("weekend_mode live outside a closure: a replica that differs from PR5's engine (last weekend's, or on another X) is never read (audit 2026-10-19)", async () => {
  // PR5's engine decides Thursday's minutes; the replica row is not PR5's: left from last weekend's closure (its last minute
  // Sunday 20:59), or stepped every minute on another X. Either way the executor reads PR5's engine, as with the switch off:
  // the same orders row for row, no stale guard, no weekend source. Reading the replica outside a closure would quote it
  // (other prices) or stop every weekday entry as stale.
  const SUN = Date.parse("2026-10-18T20:59:00Z");
  const run = async (config: Record<string, unknown>, replica: "none" | "last-weekend" | "other-x") => {
    const w = world({ config });
    if (replica === "last-weekend") {
      const old = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, { id: `o-${b}`, ts: SUN - 30e3, ticks: 7480, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
      for (const b of QUOTE_BOOKS) stepMinute(old[b], SUN, { x: 1.3330, fairU: 1.0, prints: [] });
      await w.mem.db.upsert(LIVE_WK_PAPER, [{ id: 1, state: { lastMinute: SUN, books: old, fetchedTo: {}, hourFetchedFor: 0, syncedAt: SUN, late: false }, last_minute: iso(SUN), updated_at: iso(SUN) }], "id");
    }
    const reports: QuoteLiveReport[] = [];
    for (let t = THU; t < THU + 3 * M; t += M) {
      await w.paper(t);
      if (replica === "other-x") await w.weekend(t, false, 1.30);
      reports.push(await w.turn(t));
    }
    return { w, reports };
  };
  const off = await run({}, "none");
  assert(entries(off.w).length >= 12);
  for (const replica of ["last-weekend", "other-x"] as const) {
    const lv = await run({ weekend_mode: "live" }, replica);
    assertEquals(lv.w.orders().map(shape), off.w.orders().map(shape), replica);
    assertEquals(lv.reports.map((r) => r.weekend ?? null), [null, null, null], replica);
    assert(lv.reports.every((r) => QUOTE_BOOKS.every((b) => !(r.guards[b] ?? []).some((g) => /stale/.test(g)))), `${replica}: ${JSON.stringify(lv.reports.at(-1)!.guards)}`);
  }
});

Deno.test("weekend_mode live inside a closure obeys the kill switch: live_confirmed_at null, global_pause or dry_run send no live entry (audit 2026-10-19)", async () => {
  // Counterfactual: armed, the replica's twelve rungs rest live (the weekend_mode test above).
  const armed = await weekendCase({ weekend_mode: "live" }, 2);
  assertEquals(entries(armed.w).filter((o) => o.mode === "live").length, 12);
  const disarmed = await weekendCase({ weekend_mode: "live", live_confirmed_at: null }, 2);
  assertEquals(entries(disarmed.w).length, 0);
  assertEquals(disarmed.reports.map((r) => r.entryBook), [null, null]);
  const dry = await weekendCase({ weekend_mode: "live", dry_run: true }, 2);
  assertEquals(entries(dry.w).filter((o) => o.mode === "live").length, 0);
  const paused = world({ t0: SAT, config: { weekend_mode: "live" }, fxLive: false });
  (paused.mem.tables.agent_risk as Row[])[0].global_pause = true;
  for (let t = SAT; t < SAT + 2 * M; t += M) { await paused.paper(t); await paused.weekend(t); await paused.turn(t); }
  assertEquals(entries(paused).length, 0);
});

Deno.test("take_mode shadow records nothing on a rung that may not enter: live_confirmed_at null, or the day's loss stop (audit 2026-10-19)", async () => {
  // Counterfactual: armed, the same read makes one take_shadow event (the take_mode test above).
  const armed = await takeCase({ take_mode: "shadow" });
  assertEquals(armed.w.events("take_shadow").length, 1);
  const disarmed = await takeCase({ take_mode: "shadow", live_confirmed_at: null });
  assertEquals([disarmed.w.events("take_shadow").length, disarmed.r.shadow?.takes ?? 0], [0, 0]);
  const stopped = await takeCase({ take_mode: "shadow" }, (w) => {
    (w.mem.tables.agent_quote_live_events as Row[]).push({ mode: "live", minute: iso(THU), book: "-", rung_side: "-", k: 0, kind: "loss_stop", detail: {} });
  });
  assertEquals([stopped.w.events("take_shadow").length, stopped.r.shadow?.takes ?? 0], [0, 0]);
  assert(!stopped.r.errors.some((e) => /take shadow/.test(e)), JSON.stringify(stopped.r.errors));
});

// ------------------------------------------------------------------ the weekend replica (quotes_live_weekend.ts)

/** PR5's engine and its record, as its call keeps them, stepped on to any minute: X live outside closures, dark (null) inside. */
function pr5World(start: number) {
  const mem = memDb({
    agent_quote_live_config: [{ id: 1, dry_run: false, live_confirmed_at: null, capital_gbp: 120, weekend_mode: "off" }],
    agent_quote_state: [], agent_quote_minutes: [], agent_quote_prints: [], agent_quote_inputs: [], agent_quote_events: [], [LIVE_WK_PAPER]: [],
  }, { now: () => start });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, { id: `s-${b}`, ts: start - 30e3, ticks: 7553, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
  let last = start - M, n = 0;
  return {
    mem, books,
    async stepTo(end: number) {
      for (let t = last + M; t <= end; t += M) {
        const x = inQuoteClosure(t) ? null : X;
        for (const b of QUOTE_BOOKS) {
          // A print through the 0.1 % bid every 37 minutes, so positions open and close.
          const prints: Print[] = (t - start) % (37 * M) === 0 ? [{ id: `p${String(++n).padStart(6, "0")}`, ts: t + 5e3, ticks: 7545, qty: 500, side: "sell" }] : [];
          for (const p of prints) (mem.tables.agent_quote_prints as Row[]).push({ id: p.id, book: b, ts: iso(p.ts), price: p.ticks * 1e-4, qty: p.qty, side: p.side });
          stepMinute(books[b], t, { x, fairU: 1.0, prints });
          (mem.tables.agent_quote_minutes as Row[]).push({ book: b, minute: iso(t), x, x_t: null, fair_u: 1.0, hours_n: 24, prints_n: prints.length, recorded_at: iso(t + M + 27e3) });
        }
      }
      last = end;
      await mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: end, books, fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(end), updated_at: iso(end), last_error: null }], "id");
    },
    replica: () => (mem.tables[LIVE_WK_PAPER] as Row[])[0]?.state as { lastMinute: number; books: Record<QuoteBook, BookState>; syncedAt: number; late: boolean } | undefined,
  };
}
const resting = (bs: BookState) => bs.rungs.filter((r) => r.o).length;

Deno.test("the weekend replica: off, nothing; on a weekday, nothing; in the hour before a closure, PR5's engine itself; inside it, stepped on the held X while PR5 is dark; switched on late, PR5 as it stands", async () => {
  const FRI = Date.parse("2026-10-23T18:00:00Z");     // a Friday: the closure opens at 21:00
  const w = pr5World(FRI);
  await w.stepTo(FRI + 150 * M);                        // 20:30
  const now = FRI + 151 * M + 30e3;
  assertEquals(await stepLiveWeekendPaper(w.mem.db, now), { skipped: "weekend_mode is off" });
  (w.mem.tables.agent_quote_live_config as Row[])[0].weekend_mode = "shadow";
  // Before the hour: a weekday, the replica is not kept.
  const w2 = pr5World(FRI); (w2.mem.tables.agent_quote_live_config as Row[])[0].weekend_mode = "shadow";
  await w2.stepTo(FRI + 119 * M);                      // 19:59
  assertEquals(await stepLiveWeekendPaper(w2.mem.db, now), { skipped: "a weekday: PR5's engine is the rule" });
  assertEquals((w2.mem.tables[LIVE_WK_PAPER] as Row[]).length, 0);
  // 20:30: a copy of PR5's engine, books and all.
  assertEquals(await stepLiveWeekendPaper(w.mem.db, now), { synced: true, late: false, minutes: 0, lastMinute: iso(FRI + 150 * M) });
  assertEquals(JSON.stringify(w.replica()!.books), JSON.stringify(w.books));
  // 21:10: PR5's engine dark since 21:00 (its entries withdrawn); the replica stepped 40 minutes, quoting on the held X.
  await w.stepTo(FRI + 190 * M);
  assertEquals(await stepLiveWeekendPaper(w.mem.db, now), { synced: false, late: false, minutes: 40, lastMinute: iso(FRI + 190 * M) });
  const r = w.replica()!;
  assertEquals(QUOTE_BOOKS.map((b) => [resting(w.books[b]) , r.books[b].lastX]), [[0, X], [0, X]]);
  assert(QUOTE_BOOKS.every((b) => resting(r.books[b]) >= 4), JSON.stringify(QUOTE_BOOKS.map((b) => resting(r.books[b]))));
  // Switched on late (no row, inside the closure): PR5's engine as it stands, from then on.
  (w.mem.tables[LIVE_WK_PAPER] as Row[]).length = 0;
  await w.stepTo(FRI + 200 * M);
  assertEquals(await stepLiveWeekendPaper(w.mem.db, now), { synced: true, late: true, minutes: 0, lastMinute: iso(FRI + 200 * M) });
  await w.stepTo(FRI + 203 * M);
  assertEquals((await stepLiveWeekendPaper(w.mem.db, now)).minutes, 3);
  assert(QUOTE_BOOKS.every((b) => resting(w.replica()!.books[b]) >= 4));
  // The closures' own instants.
  assertEquals(nextClosureStart(Date.parse("2026-10-24T03:00:00Z")), Date.parse("2026-10-30T21:00:00Z"));   // inside one: the next
  assertEquals(closureStartOf(Date.parse("2026-10-25T20:59:00Z")), Date.parse("2026-10-23T21:00:00Z"));
});

Deno.test("no take inside an FX closure: with weekend_mode 'live' and the book through the take limit, take_mode 'live' sends no IOC and 'shadow' records none; the replica's entries are the same as with take off", async () => {
  /** Two Saturday turns on the weekend replica, the second meeting a USDC read asking 0.7539, 500 deep (through the 0.1 % bid's limit at the held X). */
  const closed = async (config: Record<string, unknown>) => {
    const w = world({ t0: SAT, config: { weekend_mode: "live", ...config }, fxLive: false });
    const at2 = SAT + 2 * M + 25e3;
    w.read(USDC, at2 - 15e3, at2 + 15e3, [[0.7530, 500]], [[0.7539, 500]]);
    const reports: QuoteLiveReport[] = [];
    for (let t = SAT; t < SAT + 2 * M; t += M) { await w.paper(t); await w.weekend(t); reports.push(await w.turn(t)); }
    return { w, reports };
  };
  const off = await closed({}), lv = await closed({ take_mode: "live" }), sh = await closed({ take_mode: "shadow" });
  assertEquals(lv.reports.at(-1)!.weekend, { source: "weekend" });
  // The replica's 0.1 % USDC bid rests at 0.7546 (12 entries in all): through 0.7539 on a weekday it would be the take's turn.
  assertEquals(entries(off.w).filter((o) => o.book === USDC && o.rung_side === "bid" && Number(o.k) === 0.001).map((o) => [Number(o.price), o.state]), [[0.7546, "new"]]);
  assertEquals([lv.w.orders().filter(isTake).length, sh.w.events("take_shadow").length, sh.reports.at(-1)!.shadow?.takes ?? 0], [0, 0, 0]);
  assertEquals(lv.w.orders().map(shape), off.w.orders().map(shape));
  assertEquals(sh.w.orders().map(shape), off.w.orders().map(shape));
  // The same book on a weekday is a take, live and in shadow (`takeCase` above): the closure alone stops it.
  assertEquals((await takeCase({ take_mode: "live" })).w.orders().filter(isTake).length, 1);
  assertEquals((await takeCase({ take_mode: "shadow" })).w.events("take_shadow").length, 1);
});
