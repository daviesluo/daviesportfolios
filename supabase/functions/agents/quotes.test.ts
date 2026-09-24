// The paper quote test (quotes.ts) against the simulator it was tested with.
//
// `golden_windows.json` is PR5's frozen simulator (docs/agents/scripts/pr5/pr5_sim.py) run on five windows — both books
// in the wide market of March 2026, both in the tight one of September, and a stretch with three 24-hour stops — with
// the exact prints, GBP/USD minutes and USD-book hours it read. `stepMinute` must reproduce it trip for trip and order
// for order: the loop's paper record is only worth reading if it runs the rule that was tested.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/pr5/golden_windows.json" with { type: "json" };
import evening from "../../../docs/agents/backtests/pr5_live/first_evening_fixture.json" with { type: "json" };
import type { Db } from "./db.ts";
import {
  blocks, exitTicks, fairHours, fairUAt, fxAt, fxBarAt, median, minuteRecord, newBookState, type Print, QUOTE_BOOKS, QUOTE_STOP_MS, type QuoteReport,
  quoteTicks, runQuotes, stepMinute, through, type QuoteBook, type Trip,
} from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;

type GoldenTrip = { book: string; side: string; k: number; t_entry: number; t_exit: number; entry: number; exit: number; how: string; notional_usd: number; pnl_usd: number; fill_ts: number };
type Window = {
  name: string; book: QuoteBook; t0: number; t1: number; seed_print: [number, number, number, string] | null;
  fx: Array<[number, number]>; fair_hours: Array<[number, number]>; prints: Array<[number, number, number, string]>;
  orders_by_day: Record<string, number>; trips: GoldenTrip[];
  open_at_end: Array<{ side: string; k: number; t_entry: number; entry: number; fill_ts: number }>;
};

const WINDOWS = (golden as unknown as { windows: Window[] }).windows;
const asPrint = ([ts, ticks, qty, side]: [number, number, number, string], i: number): Print => ({ ts, ticks, qty, side: side === "buy" ? "buy" : "sell", id: `p${ts}-${i}` });

function replay(w: Window) {
  const s = newBookState(w.book, w.seed_print ? asPrint(w.seed_print, -1) : null);
  const prints = w.prints.map(asPrint);
  const trips: Trip[] = [], orders: Record<string, number> = {};
  let j = 0;
  for (let t = w.t0; t < w.t1; t += M) {
    const mine: Print[] = [];
    while (j < prints.length && prints[j].ts < t + M) mine.push(prints[j++]);
    const out = stepMinute(s, t, { x: fxAt(t, w.fx), fairU: fairUAt(t, w.fair_hours), prints: mine });
    trips.push(...out.trips);
    if (out.orders) orders[String(Math.floor(t / 86400e3))] = (orders[String(Math.floor(t / 86400e3))] ?? 0) + out.orders;
  }
  return { s, trips, orders };
}

for (const w of WINDOWS) {
  Deno.test(`stepMinute reproduces PR5's simulator: ${w.name} ${w.book} (${w.trips.length} trips)`, () => {
    const { s, trips, orders } = replay(w);
    assertEquals(orders, w.orders_by_day, "orders placed per day");
    assertEquals(trips.length, w.trips.length, "round trips");
    trips.forEach((t, i) => {
      const g = w.trips[i];
      assertEquals([t.side, t.k, t.tEntry, t.fillTs, t.tExit, t.how], [g.side, g.k, g.t_entry, g.fill_ts, g.t_exit, g.how], `trip ${i}`);
      assertEquals(Math.round(t.entry * 1e6) / 1e6, g.entry, `trip ${i} entry`);
      assertEquals(Math.round(t.exit * 1e8) / 1e8, g.exit, `trip ${i} exit`);
      assertAlmostEquals(t.pnlUsd, g.pnl_usd, 1e-12, `trip ${i} pnl`);
      assertAlmostEquals(t.notionalUsd, g.notional_usd, 1e-9, `trip ${i} notional`);
    });
    // What the simulator closed only because its data ended is still open here, exactly as entered.
    const open = s.rungs.filter((r) => r.mode === "position").map((r) => ({ side: r.side, k: r.k, t_entry: r.tEntry, entry: Math.round(r.entry! * 1e6) / 1e6, fill_ts: r.fillTs }));
    assertEquals<unknown>(open, w.open_at_end);
  });
}

Deno.test("the golden windows cover what the rule does: fills both ways, maker exits, and 24-hour stops", () => {
  const all = WINDOWS.flatMap((w) => w.trips);
  assert(all.some((t) => t.side === "bid") && all.some((t) => t.side === "ask"));
  assert(all.filter((t) => t.how === "taker").length >= 3, "a stop is in the replay");
  assert(all.filter((t) => t.how === "maker").length >= 90);
});

Deno.test("quoteTicks and exitTicks round the way the simulator does: bids down, asks up, exits toward fair's far side", () => {
  assertEquals(quoteTicks(0.75, 0.001, "bid"), 7492);          // 0.74925 → down
  assertEquals(quoteTicks(0.75, 0.001, "ask"), 7508);          // 0.75075 → up
  assertEquals(quoteTicks(0.7500, 0.002, "bid"), 7485);
  assertEquals(exitTicks(0.74951, "bid"), 7496);                // a long sells at fair rounded up
  assertEquals(exitTicks(0.74951, "ask"), 7495);                // a short buys back at fair rounded down
  assertEquals(exitTicks(0.75, "bid"), 7500);                   // exactly on the grid stays there (the 1e-9 guard)
});

Deno.test("blocks: a post-only order is refused when the last print is through it, or at it from the other side", () => {
  const lp = (ticks: number, side: "buy" | "sell"): Print => ({ ts: 0, ticks, qty: 1, side, id: "x" });
  assert(blocks("bid", 7500, lp(7499, "sell")));                // the market traded below the bid
  assert(blocks("bid", 7500, lp(7500, "buy")));                 // a buyer lifted an ask AT the bid: the ask sits there
  assert(!blocks("bid", 7500, lp(7500, "sell")));               // a seller hit a bid at 7500: that is our level, not through it
  assert(!blocks("bid", 7500, lp(7501, "buy")));
  assert(blocks("ask", 7500, lp(7501, "buy")));
  assert(blocks("ask", 7500, lp(7500, "sell")));
  assert(!blocks("ask", 7500, lp(7500, "buy")));
  assert(!blocks("ask", 7500, null));
});

Deno.test("through: strictly beyond, never a touch", () => {
  assert(through("bid", 7500, 7499) && !through("bid", 7500, 7500));
  assert(through("ask", 7500, 7501) && !through("ask", 7500, 7500));
});

Deno.test("fxAt: the latest minute that started between ten minutes and one minute before the turn; none is dark", () => {
  const t = 1_000 * M;
  const bars: Array<[number, number]> = [[t - 12 * M, 1.1], [t - 10 * M, 1.2], [t - 2 * M, 1.3], [t - M, 1.4], [t, 1.5]];
  assertEquals(fxAt(t, bars), 1.4);                             // the bar of minute t−1, not the one of minute t
  assertEquals(fxAt(t, bars.slice(0, 2)), 1.2);                 // ten minutes back still counts
  assertEquals(fxAt(t, bars.slice(0, 1)), null);                // eleven or more: dark
  assertEquals(fxAt(t, []), null);
});

Deno.test("fairUAt: the median close of the hours lying wholly inside the last 24 h", () => {
  const t = 100 * H;
  const hours: Array<[number, number]> = [[t - 25 * H, 9], [t - 24 * H, 1.0002], [t - 2 * H, 1.0000], [t - H, 1.0001], [t, 9]];
  assertEquals(fairUAt(t, hours), 1.0001);                      // t−24 h, t−2 h, t−1 h; not t−25 h, not the unfinished hour at t
  assertEquals(median([3, 1, 2, 4]), 2.5);
  assertEquals(median([]), null);
});

Deno.test("stepMinute: no GBP/USD or no fair means no entry quote; a quote already out is withdrawn", () => {
  const s = newBookState("USDC-GBP");
  const t = 5_000 * M;
  const a = stepMinute(s, t, { x: 1.35, fairU: 1.0, prints: [] });
  assertEquals(a.orders, 6);
  assert(s.rungs.every((r) => r.mode === "quote" && r.o!.live === t + M));
  const b = stepMinute(s, t + M, { x: null, fairU: 1.0, prints: [] });
  assertEquals(b.orders, 0);
  assert(s.rungs.every((r) => r.mode === "idle" && r.o === null));
  assertEquals(b.events.filter((e) => e.kind === "withdraw").length, 6);
});

Deno.test("stepMinute: a fill on a print strictly through, sized by the minute's volume; the exit rests at fair the minute after", () => {
  const s = newBookState("USDT-GBP");
  const t = 7_000 * M, x = 1.35, fairU = 1.0;                  // fair 0.74074… GBP
  stepMinute(s, t, { x, fairU, prints: [] });                   // six quotes placed, live from t+1
  const bid1 = s.rungs[0];
  const px = bid1.o!.ticks;
  // Minute t+1: the orders go live; one print strictly below the 0.1 % bid, 200 USDT at that price.
  const p: Print = { ts: t + M + 5_000, ticks: px - 1, qty: 200, side: "sell", id: "fill-1" };
  const out = stepMinute(s, t + M, { x, fairU, prints: [p] });
  assertEquals(bid1.mode, "position");
  assertEquals(bid1.fillId, "fill-1");
  const gbp = 200 * (px - 1) * 1e-4;
  assertAlmostEquals(bid1.nq!, Math.min(100, 0.1 * gbp * x) / x, 1e-12);   // 10 % of the minute's GBP, in USD, then back to GBP
  assertEquals(out.events.filter((e) => e.kind === "fill").length, 1);    // only the 0.1 % bid sits above that print
  assertEquals(s.rungs[1].mode, "quote");                                   // the 0.2 % bid, 7392, is not reached
  // Minute t+2: the exit is placed at fair rounded up, live from t+3.
  const o2 = stepMinute(s, t + 2 * M, { x, fairU, prints: [] });
  assert(bid1.o && bid1.o.side === "ask" && bid1.o.live === t + 3 * M);
  assertEquals(o2.events.filter((e) => e.kind === "order" && (e.detail as { leg: string }).leg === "exit").length, 1);
});

Deno.test("stepMinute: a position 24 hours old closes at the last print as a taker, net of 9 bps and half the spread", () => {
  const s = newBookState("USDT-GBP", { ts: 0, ticks: 7400, qty: 1, side: "buy", id: "seed" });
  const t0 = 9_000 * M;
  const r = s.rungs[3];                                          // the 0.1 % ask
  Object.assign(r, { mode: "position", o: null, entry: 0.7420, tEntry: t0, qty: 100, nq: 74.2, fillTs: t0 + 1, fillId: "f", entryOid: 1, xEntry: 1.35, fairEntry: 0.74 });
  s.lastX = 1.35;
  const before = stepMinute(s, t0 + QUOTE_STOP_MS - M, { x: null, fairU: null, prints: [] });
  assertEquals(before.trips.length, 0);
  const at = stepMinute(s, t0 + QUOTE_STOP_MS, { x: null, fairU: null, prints: [] });
  assertEquals(at.trips.length, 1);
  const trip = at.trips[0];
  assertEquals(trip.how, "taker");
  assertAlmostEquals(trip.exit, 0.7400 * (1 + 0.0009 + 0.000067), 1e-12);
  assertAlmostEquals(trip.pnlUsd, 100 * (0.7420 - trip.exit) * 1.35, 1e-12);
});

// ------------------------------------------------------------------ the driver, against the in-memory database

type Call = string;
function stubFetch(now: number, calls: Call[], opts: { tradesDown?: boolean } = {}) {
  const book = (u: URL) => u.searchParams.get("symbol") ?? "";
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url.hostname === "query1.finance.yahoo.com") {
      const start = Math.floor(now / M) * M - 30 * M;
      const ts = Array.from({ length: 31 }, (_, i) => (start + i * M) / 1000);
      return ok({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ close: ts.map(() => 1.35) }] } }] } });
    }
    if (url.pathname === "/api/1.0/public/trades/all") {
      if (opts.tradesDown) return Promise.resolve(new Response(JSON.stringify({ message: "down" }), { status: 503 }));
      const b = book(url), a = Number(url.searchParams.get("start_date")), z = Number(url.searchParams.get("end_date"));
      const all = [
        { id: `${b}-old`, symbol: b.replace("-", "/"), price: "0.7400", quantity: "10", timestamp: Math.floor(now / M) * M - 90 * M, region: "UK", side: "buy" },
        { id: `${b}-new`, symbol: b.replace("-", "/"), price: "0.7401", quantity: "10", timestamp: Math.floor(now / M) * M - M + 1_000, region: "UK", side: "sell" },
        { id: `${b}-eea`, symbol: b.replace("-", "/"), price: "0.7000", quantity: "10", timestamp: Math.floor(now / M) * M - M + 2_000, region: "EEA", side: "sell" },
      ];
      return ok({ data: all.filter((r) => r.timestamp >= a && r.timestamp <= z), metadata: { next_cursor: "" } });
    }
    if (url.pathname.startsWith("/api/1.0/public/candles/")) {
      const hr = Math.floor(now / H) * H;
      return ok({ data: Array.from({ length: 27 }, (_, i) => ({ start: hr - (26 - i) * H, close: "1.0000" })) });
    }
    if (url.pathname.startsWith("/api/2.0/public/order-book/")) return ok({ data: { bids: [{ p: "0.7390" }], asks: [{ p: "0.7410" }] } });
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
}

function quoteWorld() {
  return memDb({ agent_locks: [{ name: "quotes", lease_until: new Date(0).toISOString(), holder: null } as Row], agent_quote_state: [], agent_quote_prints: [], agent_quote_inputs: [], agent_quote_events: [], agent_quote_trips: [], agent_quote_minutes: [] }, { now: () => Date.now() });
}

Deno.test("runQuotes: the first run seeds the books, stores UK prints only, and decides the minute just closed", async () => {
  const now = Date.UTC(2026, 8, 23, 15, 0, 25);
  const { db, tables } = quoteWorld();
  const calls: Call[] = [];
  const r = await runQuotes({ db, fetch: stubFetch(now, calls), now, holder: "h1", pause: () => Promise.resolve() });
  assertEquals(r.errors, []);
  assertEquals(r.minutes, 1);
  assertEquals(r.to, Math.floor(now / M) * M - M);
  const ids = (tables.agent_quote_prints as Row[]).map((p) => p.id).sort();
  assertEquals(ids, ["USDC-GBP-new", "USDC-GBP-old", "USDT-GBP-new", "USDT-GBP-old"]);         // the EEA print is not the UK book's
  const st = (tables.agent_quote_state as Row[])[0];
  assertEquals(st.last_minute, new Date(Math.floor(now / M) * M - M).toISOString());
  // Twelve entry quotes went out and go live now: each book's order book was read as their evidence.
  assertEquals(r.orders, 12);
  assertEquals(r.snapshots, 2);
  assertEquals((tables.agent_quote_events as Row[]).filter((e) => e.kind === "book").length, 2);
  // The lease is given back, and a second run a second later, in the same minute, finds nothing to decide.
  const again = await runQuotes({ db, fetch: stubFetch(now + 1_000, calls), now: now + 1_000, holder: "h2", pause: () => Promise.resolve() });
  assertEquals(again.skipped, "nothing new to decide");
});

Deno.test("runQuotes never calls anything but public market data: no key, no order endpoint", async () => {
  const now = Date.UTC(2026, 8, 23, 15, 0, 25);
  const { db } = quoteWorld();
  const calls: Call[] = [];
  await runQuotes({ db, fetch: stubFetch(now, calls), now, holder: "h", pause: () => Promise.resolve() });
  await runQuotes({ db, fetch: stubFetch(now + 5 * M, calls), now: now + 5 * M, holder: "h", pause: () => Promise.resolve() });
  assert(calls.length > 0);
  for (const c of calls) assert(/^https:\/\/(revx\.revolut\.com\/api\/[12]\.0\/public\/|query1\.finance\.yahoo\.com\/)/.test(c), c);
});

Deno.test("runQuotes: a book whose prints cannot be read decides nothing past what is stored", async () => {
  const now = Date.UTC(2026, 8, 23, 15, 0, 25);
  const { db, tables } = quoteWorld();
  await runQuotes({ db, fetch: stubFetch(now, []), now, holder: "h", pause: () => Promise.resolve() });
  const later = now + 3 * M;
  const r = await runQuotes({ db, fetch: stubFetch(later, [], { tradesDown: true }), now: later, holder: "h", pause: () => Promise.resolve() });
  assertEquals(r.minutes, 0);
  assert(r.errors.some((e) => /prints/.test(e)), r.errors.join(" | "));
  assertEquals((tables.agent_quote_state as Row[])[0].last_minute, new Date(Math.floor(now / M) * M - M).toISOString());
});

Deno.test("runQuotes: a run that finds the lease held does nothing", async () => {
  const now = Date.UTC(2026, 8, 23, 15, 0, 25);
  const { db } = memDb({ agent_locks: [{ name: "quotes", lease_until: new Date(now + 30e3).toISOString(), holder: "other" } as Row], agent_quote_state: [], agent_quote_prints: [], agent_quote_inputs: [], agent_quote_events: [], agent_quote_trips: [] }, { now: () => Date.now() });
  const calls: Call[] = [];
  const r = await runQuotes({ db, fetch: stubFetch(now, calls), now, holder: "h", pause: () => Promise.resolve() });
  assertEquals(r.skipped, "another run holds the quotes lease");
  assertEquals(calls, []);
});

Deno.test("QUOTE_BOOKS are the two GBP stablecoin books PR5 tested", () => {
  assertEquals([...QUOTE_BOOKS], ["USDC-GBP", "USDT-GBP"]);
});

// ------------------------------------------------------------------ the per-minute record (`0055`)

Deno.test("the minute record is what the turn read: the bar X came from, the closes fair took, the prints; dark is null, not a guess", () => {
  const t = Date.UTC(2026, 8, 23, 15, 0);
  const bars: Array<[number, number]> = [[t - 12 * M, 1.30], [t - 3 * M, 1.32], [t, 1.33]];
  assertEquals([fxBarAt(t, bars), fxAt(t, bars)], [[t - 3 * M, 1.32], 1.32]);   // fxAt is that bar's close
  assertEquals([fxBarAt(t + 13 * M, bars), fxAt(t + 13 * M, bars)], [null, null]);
  const hours = Array.from({ length: 30 }, (_, i) => [t - (30 - i) * H, 1 + i / 1e4] as [number, number]);
  assertEquals(fairHours(t, hours).length, 24);
  assertEquals(fairUAt(t, hours), median(fairHours(t, hours)));
  const print: Print = { ts: t + 5e3, ticks: 7540, qty: 10, side: "sell", id: "p" };
  assertEquals(minuteRecord("USDT-GBP", t, fxBarAt(t, bars), 24, { x: 1.32, fairU: fairUAt(t, hours), prints: [print] }), {
    book: "USDT-GBP", minute: "2026-09-23T15:00:00.000Z", x: 1.32, x_t: "2026-09-23T14:57:00.000Z", fair_u: fairUAt(t, hours), hours_n: 24, prints_n: 1,
  });
  const dark = minuteRecord("USDC-GBP", t + 13 * M, null, 0, { x: null, fairU: null, prints: [] });
  assertEquals([dark.x, dark.x_t, dark.fair_u, dark.hours_n, dark.prints_n], [null, null, null, 0, 0]);
});

type Evening = {
  from: number; to: number; fx: Array<[number, number]>;
  prints: Record<string, Array<[string, number, string, string, string]>>; hours: Record<string, Array<[number, string]>>;
  engine: Record<string, Record<string, Record<string, [number, number]>>>;
};
const EV = evening as unknown as Evening;

/** Revolut X and Yahoo as the engine met them on its first evening (`first_evening_fixture.json`), served as their APIs answer. */
function eveningFetch(now: number) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url.hostname === "query1.finance.yahoo.com") {
      const bars = EV.fx.filter(([t]) => t >= now - 30 * M && t < now);
      return ok({ chart: { result: [{ timestamp: bars.map(([t]) => t / 1000), indicators: { quote: [{ close: bars.map(([, c]) => c) }] } }] } });
    }
    if (url.pathname === "/api/1.0/public/trades/all") {
      const b = url.searchParams.get("symbol") ?? "", a = Number(url.searchParams.get("start_date")), z = Number(url.searchParams.get("end_date"));
      const data = (EV.prints[b] ?? []).filter(([, ts]) => ts >= a && ts <= z && ts <= now)
        .map(([id, timestamp, price, quantity, side]) => ({ id, symbol: b.replace("-", "/"), price, quantity, timestamp, region: "UK", side }));
      return ok({ data, metadata: { next_cursor: "" } });
    }
    if (url.pathname.startsWith("/api/1.0/public/candles/")) {
      const series = EV.hours[url.pathname.split("/").pop() ?? ""] ?? [];
      return ok({ data: series.filter(([s]) => s + H <= now).map(([start, close]) => ({ start, close })) });
    }
    if (url.pathname.startsWith("/api/2.0/public/order-book/")) return ok({ data: { bids: [{ p: "0.7540" }], asks: [{ p: "0.7560" }] } });
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
}

/** The engine run minute by minute over the evening, 25 s into each minute as its cron job runs it; `record` false is the database before `0055`. */
async function replayEvening(record: boolean) {
  const { db, tables } = memDb({
    agent_locks: [{ name: "quotes", lease_until: new Date(0).toISOString(), holder: null } as Row], agent_quote_state: [], agent_quote_prints: [],
    agent_quote_inputs: [], agent_quote_events: [], agent_quote_trips: [], ...(record ? { agent_quote_minutes: [] } : {}),
  }, { now: () => Date.now() });
  const noTable = () => Promise.reject(new Error(`db POST agent_quote_minutes → 404: {"code":"PGRST205","message":"Could not find the table 'public.agent_quote_minutes' in the schema cache"}`));
  const d: Db = record ? db : { ...db, upsert: (t, rows, key) => (t === "agent_quote_minutes" ? noTable() : db.upsert(t, rows, key)) };
  const reports: QuoteReport[] = [];
  for (let m = EV.from + M; m <= EV.to + M; m += M) {
    const now = m + 25e3;
    reports.push(await runQuotes({ db: d, fetch: eveningFetch(now), now, holder: `h${now}`, pause: () => Promise.resolve() }));
  }
  return { tables, reports };
}

// A snapshot's `at` is the wall clock the order book was read at, the one field that is not a function of the inputs.
const decided = (rows: Row[]) => rows.map((e) => (e.kind === "book" ? { ...e, detail: { ...(e.detail as Row), at: null } } : e));

Deno.test("the per-minute record changes no decision: production's first evening decides byte for byte the same with the table and without it, and as production did", async () => {
  const withIt = await replayEvening(true), without = await replayEvening(false);
  const minutes = (EV.to - EV.from) / M + 1;
  assertEquals(withIt.reports.map((r) => r.minutes), Array(minutes).fill(1));
  for (const t of ["agent_quote_trips", "agent_quote_prints", "agent_quote_inputs"]) assertEquals(JSON.stringify(withIt.tables[t]), JSON.stringify(without.tables[t]), t);
  assertEquals(JSON.stringify(decided(withIt.tables.agent_quote_events as Row[])), JSON.stringify(decided(without.tables.agent_quote_events as Row[])));
  const state = (w: typeof withIt) => { const s = (w.tables.agent_quote_state as Row[])[0]; return JSON.stringify([s.state, s.last_minute, s.updated_at]); };
  assertEquals(state(withIt), state(without));
  // With the table every decided minute is written, one row a book, and nothing goes wrong; without it the gap is said.
  assert(withIt.reports.every((r) => r.errors.length === 0 && r.recorded === 2), JSON.stringify(withIt.reports.find((r) => r.errors.length || r.recorded !== 2)));
  assertEquals((withIt.tables.agent_quote_minutes as Row[]).length, 2 * minutes);
  assert(without.reports.every((r) => r.recorded === 0 && r.errors.length === 1 && r.errors[0].startsWith("minute record:")));
  // And the decisions are production's: each book's orders and refusals per minute, count and ticks, as agent_quote_events
  // holds them for that evening; nothing else happened in it.
  const events = withIt.tables.agent_quote_events as Row[];
  for (const kind of ["order", "refused"]) {
    for (const b of QUOTE_BOOKS) {
      const got: Record<string, [number, number]> = {};
      for (const e of events.filter((x) => x.kind === kind && x.book === b)) {
        const k = String(e.minute).slice(11, 16);
        got[k] = [(got[k]?.[0] ?? 0) + 1, (got[k]?.[1] ?? 0) + Number(e.ticks)];
      }
      assertEquals(got, EV.engine[kind][b], `${kind} ${b}`);
    }
  }
  assertEquals([...new Set(events.map((e) => e.kind))].sort(), ["book", "order", "refused"]);
  // Each order's recorded inputs are the ones the order was priced from.
  const rec = new Map((withIt.tables.agent_quote_minutes as Row[]).map((r) => [`${r.book}|${r.minute}`, r]));
  for (const e of events.filter((x) => x.kind === "order")) {
    const r = rec.get(`${e.book}|${e.minute}`)!, dt = e.detail as { x: number; fair: number };
    assertEquals([r.x, Number(r.fair_u) / Number(r.x), r.x_t], [dt.x, dt.fair, new Date(Date.parse(String(e.minute)) - M).toISOString()]);
  }
});
