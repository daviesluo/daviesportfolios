// "Stablecoin quotes - variant" (quotes_variant.ts) against the reference it was chosen on.
//
// `golden_variant.json` is `pr5v_sim.simulate` (docs/agents/scripts/pr5v/pr5v_sim.py) at the PR5V pre-registration's
// settings, at PR5's own minute, run by `golden_variant.py` on four windows, both arms on each: two tight weekdays of the
// study's 28 days; two on which keys reach 600 POSTs; a busy Friday and the Saturday its 24-hour stops fall on; and two
// fresh days on Yahoo's GBP/USD, the paper engine's own source, where the governor binds on both days. Each carries the
// exact prints with their ids, in the engine's order (`printOrder`), the seed print, and the X and fairU each minute's
// turn reads. `stepVariantMinute` must reproduce it trip for trip, and each key's POSTs day by day and one by one: the
// paper record is only worth reading if the engine runs the rule that was chosen.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/pr5v/golden_variant.json" with { type: "json" };
import type { Db } from "./db.ts";
import type { MinuteInputs, Print, QuoteBook, Side } from "./quotes.ts";
import {
  newGovCounts, newVariantBook, newVariantState, printOrder, runQuotesVariant, stepVariantMinute, VARIANT_ARM_NAMES, VARIANT_ARMS, VARIANT_CHUNK_MINUTES,
  VARIANT_CODE_VERSION, VARIANT_START, VARIANT_WALL_STOP_MS, variantCapitalUsd, variantEventRow, variantTripRow, type VariantArmName, type VariantEvent,
  type VariantState, type VariantTrip,
} from "./quotes_variant.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, DAY = 86400e3;
const BOOKS: QuoteBook[] = ["USDC-GBP", "USDT-GBP"];

type GoldenPrint = [number, number, number, string, string];
type GoldenTrip = {
  side: string; k: number; t_entry: number; fill_ts: number; t_exit: number; exit_ts: number | null; how: string; entry: number; exit: number;
  notional_usd: number; pnl_usd: number;
};
type GoldenBookArm = { trips: GoldenTrip[]; open_at_end: Array<{ side: string; k: number; t_entry: number; entry: number; fill_ts: number }>; posts: Array<[number, string, string, number]> };
type Window = {
  name: string; what: string; inputs: string; t0: number; t1: number; x: Array<number | null>;
  books: Record<QuoteBook, { seed_print: GoldenPrint | null; prints: GoldenPrint[]; fair_u: Array<number | null> }>;
  arms: Record<VariantArmName, { books: Record<QuoteBook, GoldenBookArm>; posts_by_key_day: Record<string, Record<string, number>> }>;
};

const WINDOWS = (golden as unknown as { windows: Window[] }).windows;
/**
 * The governor the golden file was made at: the pre-registration's 600 / 700. The arms run at 900 / 950 since
 * 2026-10-01 (Davies; PR5V's deviation 2), and `stepVariantMinute` reads its limits from the arm it is given, so the
 * golden replay runs each arm at the golden's limits: it pins the function, and the arms' own limits are pinned below.
 */
const GOLDEN_GOV = (golden as unknown as { settings: { governor: { entry_at: number; stop_at: number } } }).settings.governor;
const asPrint = ([ts, ticks, qty, side, id]: GoldenPrint): Print => ({ ts, ticks, qty, side: side === "buy" ? "buy" : "sell", id });

/** The engine over one window, both books, one arm, flat at its first minute with every key at zero. */
function replay(w: Window, armName: VariantArmName) {
  const arm = { ...VARIANT_ARMS[armName], entryAt: GOLDEN_GOV.entry_at, stopAt: GOLDEN_GOV.stop_at };
  const gov = newGovCounts();
  const out = {} as Record<QuoteBook, { state: ReturnType<typeof newVariantBook>; trips: VariantTrip[]; events: VariantEvent[]; prints: Print[] }>;
  for (const b of BOOKS) {
    const wb = w.books[b];
    out[b] = { state: newVariantBook(b, arm, wb.seed_print ? asPrint(wb.seed_print) : null), trips: [], events: [], prints: wb.prints.map(asPrint) };
  }
  const j = { "USDC-GBP": 0, "USDT-GBP": 0 } as Record<QuoteBook, number>;
  for (let i = 0, t = w.t0; t < w.t1; i++, t += M) {
    for (const b of BOOKS) {
      const o = out[b], mine: Print[] = [];
      while (j[b] < o.prints.length && o.prints[j[b]].ts < t + M) mine.push(o.prints[j[b]++]);
      const r = stepVariantMinute(o.state, t, { x: w.x[i], fairU: w.books[b].fair_u[i], prints: mine }, arm, gov);
      o.trips.push(...r.trips); o.events.push(...r.events);
    }
  }
  return out;
}

/** The POSTs an arm's order log shows, in the reference's form: [minute index, rung side, kind, k]. */
function postsOf(w: Window, events: VariantEvent[]): Array<[number, string, string, number]> {
  return events.filter((e) => e.what !== null).map((e) => [(e.minute - w.t0) / M, e.side, e.what!, e.k]);
}

for (const w of WINDOWS) {
  for (const armName of VARIANT_ARM_NAMES) {
    const g = w.arms[armName];
    const n = BOOKS.reduce((a, b) => a + g.books[b].trips.length, 0);
    Deno.test(`stepVariantMinute reproduces pr5v_sim: ${w.name}, arm ${armName} (${n} trips)`, () => {
      const out = replay(w, armName);
      for (const b of BOOKS) {
        const gb = g.books[b], o = out[b];
        assertEquals([...o.prints].sort(printOrder), o.prints, `${b}: the golden prints are in the engine's order`);
        const tsOf = new Map(o.prints.map((p) => [p.id, p.ts]));
        assertEquals(o.trips.length, gb.trips.length, `${b}: round trips`);
        o.trips.forEach((t, i) => {
          const x = gb.trips[i];
          assertEquals(
            [t.side, t.k, t.tEntry, t.fillTs, t.tExit, t.exitPrintId ? tsOf.get(t.exitPrintId) : null, t.how],
            [x.side, x.k, x.t_entry, x.fill_ts, x.t_exit, x.exit_ts, x.how], `${b} trip ${i}`,
          );
          assertEquals(Math.round(t.entry * 1e6) / 1e6, x.entry, `${b} trip ${i} entry`);
          assertEquals(Math.round(t.exit * 1e8) / 1e8, x.exit, `${b} trip ${i} exit`);
          assertAlmostEquals(t.pnlUsd, x.pnl_usd, 1e-12, `${b} trip ${i} pnl`);
          assertAlmostEquals(t.notionalUsd, x.notional_usd, 1e-9, `${b} trip ${i} notional`);
          assertEquals([t.arm, t.key], [armName, `${b}/${t.side}`]);
        });
        // What the reference closed only because its window ended is still open here, exactly as entered.
        const open = o.state.rungs.filter((r) => r.mode === "position")
          .map((r) => ({ side: r.side, k: r.k, t_entry: r.tEntry, entry: Math.round(r.entry! * 1e6) / 1e6, fill_ts: r.fillTs }))
          .sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.k - b.k));
        assertEquals<unknown>(open, gb.open_at_end, `${b}: open at the end`);
        // Every POST, in order: what it was, on which rung, in which minute.
        assertEquals(postsOf(w, o.events), gb.posts, `${b}: POSTs one by one`);
      }
      // Each key's POSTs, UTC day by UTC day.
      const perDay: Record<string, Record<string, number>> = {};
      for (const b of BOOKS) {
        for (const e of out[b].events.filter((e) => e.what !== null)) {
          const day = String(Math.floor(e.minute / DAY));
          (perDay[e.key!] ??= {})[day] = (perDay[e.key!]?.[day] ?? 0) + 1;
        }
      }
      assertEquals(perDay, g.posts_by_key_day);
    });
  }
}

Deno.test("the golden windows cover what the variant adds: the governor binding and releasing, one print filling several rungs, stops, both sides", () => {
  let bound = 0, shared = 0, capped = 0, withdrawn = 0, stops = 0;
  const sides = new Set<string>(), sharedIn: Record<string, number> = {};
  for (const w of WINDOWS) {
    for (const armName of VARIANT_ARM_NAMES) {
      for (const b of BOOKS) {
        const gb = w.arms[armName].books[b];
        stops += gb.trips.filter((t) => t.how === "taker").length;
        for (const t of gb.trips) sides.add(t.side);
      }
      for (const days of Object.values(w.arms[armName].posts_by_key_day)) bound += Object.values(days).filter((c) => c >= GOLDEN_GOV.entry_at).length;
      const out = replay(w, armName);
      for (const b of BOOKS) {
        const fills = out[b].events.filter((e) => e.kind === "fill");
        const byPrint = new Map<string, number>();
        for (const f of fills) { const id = (f.detail.print as { id: string }).id; byPrint.set(id, (byPrint.get(id) ?? 0) + 1); }
        const several = [...byPrint.values()].filter((c) => c >= 2).length;            // one print filling two rungs or more
        shared += several;
        if (armName === "main") sharedIn[w.name] = (sharedIn[w.name] ?? 0) + several;
        capped += fills.filter((f) => Number(f.detail.usd) < VARIANT_ARMS[armName].sizeUsd).length;
        withdrawn += out[b].events.filter((e) => e.kind === "withdraw" && e.detail.why === "governor").length;
      }
    }
  }
  assert(bound >= 10, `key-days at the golden's ${GOLDEN_GOV.entry_at}: ${bound}`);
  assert(withdrawn >= 20, `quotes the governor withdrew: ${withdrawn}`);
  assert(shared >= 10, `prints that filled more than one rung: ${shared}`);
  assert(WINDOWS.every((w) => (sharedIn[w.name] ?? 0) >= 1), `in every window, a print that filled several of main's rungs: ${JSON.stringify(sharedIn)}`);
  assert(capped >= 20, `fills held under $100 by the cap: ${capped}`);
  assert(stops >= 8, `24-hour stops: ${stops}`);
  assertEquals([...sides].sort(), ["ask", "bid"]);
});

Deno.test("the arms are the pre-registration's: nine rungs a side and the top five, 0.03 % re-price, $100, 10 %, the live design's 900 / 950", () => {
  assertEquals(VARIANT_ARMS.main.rungs, [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]);
  assertEquals(VARIANT_ARMS.top5.rungs, [0.0005, 0.00075, 0.001, 0.00125, 0.0015]);
  for (const a of VARIANT_ARM_NAMES) {
    const arm = VARIANT_ARMS[a];
    assertEquals([arm.name, arm.reprice, arm.sizeUsd, arm.volumeShare, arm.entryAt, arm.stopAt], [a, 0.0003, 100, 0.10, 900, 950]);
    assertEquals(arm.entryBand, undefined);
  }
  assertEquals([variantCapitalUsd(VARIANT_ARMS.main), variantCapitalUsd(VARIANT_ARMS.top5)], [3600, 2000]);
  // A turn visits the bids and then the asks, each in k order: the order the governor's count is read in.
  const s = newVariantBook("USDC-GBP", VARIANT_ARMS.main);
  assertEquals(s.rungs.map((r) => `${r.side}${r.k}`), [...VARIANT_ARMS.main.rungs.map((k) => `bid${k}`), ...VARIANT_ARMS.main.rungs.map((k) => `ask${k}`)]);
  // And the golden file was made at these settings, with the pre-registration's governor before deviation 2: the replay
  // above runs at those limits.
  const set = (golden as unknown as { settings: { arms: Record<string, number[]>; reprice: number; governor: { entry_at: number; stop_at: number } } }).settings;
  assertEquals([set.arms.main, set.arms.top5, set.reprice, set.governor], [VARIANT_ARMS.main.rungs, VARIANT_ARMS.top5.rungs, 0.0003, { entry_at: 600, stop_at: 700 }]);
  assertEquals(VARIANT_CODE_VERSION, 3);                                             // the record is re-decided under them
});

// ------------------------------------------------------------------ the governor and the shared cap, by hand

const T0 = Date.UTC(2026, 8, 30, 10, 0);                    // a Wednesday
const X = 1.25, FAIR_U = 0.74 * 1.25;                        // fair £0.7400
const quiet = { x: X, fairU: FAIR_U, prints: [] as Print[] };
const pr = (ts: number, ticks: number, qty: number, side: "buy" | "sell", id: string): Print => ({ ts, ticks, qty, side, id });

Deno.test("the governor: from 900 a key's quotes are withdrawn and none is placed; its other rungs and keys go on; at 00:00 UTC it counts from zero", () => {
  const arm = VARIANT_ARMS.main, gov = newGovCounts();
  const s = newVariantBook("USDC-GBP", arm, pr(T0 - 5e3, 7400, 1, "buy", "seed"));
  // The bid key has sent 896 today: four more placements reach 900, and the turn's fifth bid reads 900 and places nothing.
  stepVariantMinute(s, T0 - M, { x: null, fairU: null, prints: [] }, arm, gov);     // sets the day
  gov.counts["USDC-GBP/bid"] = 896;
  const a = stepVariantMinute(s, T0, quiet, arm, gov);
  const placed = (side: Side) => a.events.filter((e) => e.kind === "order" && e.side === side).map((e) => e.k);
  assertEquals(placed("bid"), arm.rungs.slice(0, 4));
  assertEquals(placed("ask"), arm.rungs);                                            // the ask key is its own
  assertEquals(a.posts, { "USDC-GBP/bid": 4, "USDC-GBP/ask": 9 });
  assertEquals(gov.counts["USDC-GBP/bid"], 900);
  // The next turn withdraws the four the bid key still has out; the asks are untouched.
  const b = stepVariantMinute(s, T0 + M, quiet, arm, gov);
  assertEquals(b.events.filter((e) => e.kind === "withdraw").map((e) => [e.side, e.k, e.detail.why]), arm.rungs.slice(0, 4).map((k) => ["bid", k, "governor"]));
  assert(s.rungs.filter((r) => r.side === "bid").every((r) => r.mode === "idle"));
  assert(s.rungs.filter((r) => r.side === "ask").every((r) => r.mode === "quote"));
  // At 00:00 UTC the count starts again, and the bids go back out.
  const midnight = Date.UTC(2026, 9, 1);
  const c = stepVariantMinute(s, midnight, quiet, arm, gov);
  assertEquals(c.events.filter((e) => e.kind === "order" && e.side === "bid").length, 9);
  assertEquals(gov.counts["USDC-GBP/bid"], 9);
});

Deno.test("the governor: from 950 a key sends only stops — its exits are not placed or moved, the one already resting still fills, and the stop goes out", () => {
  const arm = VARIANT_ARMS.main, gov = newGovCounts();
  const s = newVariantBook("USDT-GBP", arm, pr(T0 - 5e3, 7400, 1, "buy", "seed"));
  stepVariantMinute(s, T0 - M, { x: null, fairU: null, prints: [] }, arm, gov);
  // Two bid rungs hold positions entered a day ago (one with its exit resting at fair, one with none yet).
  const held = (r: typeof s.rungs[number], withExit: boolean) => Object.assign(r, {
    mode: "position", o: withExit ? { side: "ask", ticks: 7400, fairAt: 0.74, live: T0 - DAY + 2 * M, state: "live", oid: 90 } : null,
    entry: 0.7398, tEntry: T0 - DAY + M, qty: 100, nq: 73.98, fillTs: T0 - DAY + M + 1, fillId: "f", entryOid: 1, xEntry: X, fairEntry: 0.74,
  });
  held(s.rungs[0], true); held(s.rungs[1], false);
  gov.counts["USDT-GBP/bid"] = 950;
  // Fair moves 0.1 %: under 950 the resting exit would be re-priced and the other placed. At 950 neither is.
  const moved = { x: X, fairU: FAIR_U * 1.001, prints: [pr(T0 + 5e3, 7401, 50, "buy", "lift")] };
  const a = stepVariantMinute(s, T0, moved, arm, gov);
  assertEquals(a.events.filter((e) => e.kind === "order" && e.side === "bid"), []);
  // The exit already resting at 7400 still fills on a print through it, and closes as a maker.
  assertEquals(a.trips.map((t) => [t.k, t.how, t.exit]), [[arm.rungs[0], "maker", 0.74]]);
  // At the 24-hour mark the other is stopped, and the stop is sent whatever the count: it is the last POST that always goes.
  const b = stepVariantMinute(s, T0 + M, quiet, arm, gov);
  assertEquals(b.trips.map((t) => [t.k, t.how]), [[arm.rungs[1], "taker"]]);
  assertEquals(b.posts["USDT-GBP/bid"], 1);
  assertEquals(gov.counts["USDT-GBP/bid"], 951);
});

Deno.test("the shared cap: the bids a print goes through share the minute's 10 %, nearest first, and an exit takes none of it", () => {
  const arm = VARIANT_ARMS.top5, gov = newGovCounts();
  const s = newVariantBook("USDC-GBP", arm, pr(T0 - 5e3, 7400, 1, "buy", "seed"));
  stepVariantMinute(s, T0, quiet, arm, gov);                                         // quotes out, live from T0 + 1 min
  const bid = (k: number) => s.rungs.find((r) => r.side === "bid" && r.k === k)!;
  assertEquals([bid(0.0005).o!.ticks, bid(0.00075).o!.ticks, bid(0.001).o!.ticks], [7396, 7394, 7392]);
  // An ask rung sold at 7405 earlier; its exit, a bid at fair (7400), rests too.
  const ask = s.rungs.find((r) => r.side === "ask" && r.k === 0.0005)!;
  Object.assign(ask, {
    mode: "position", o: { side: "bid", ticks: 7400, fairAt: 0.74, live: T0, state: "live", oid: 77 }, entry: 0.7405, tEntry: T0 - 30 * M, qty: 100,
    nq: 74.05, fillTs: T0 - 30 * M, fillId: "s", entryOid: 5, xEntry: X, fairEntry: 0.74,
  });
  // Minute T0 + 1: a SELL of 60 coins at 7393 (through 7400, 7396 and 7394, not 7392), then one of 400 at the same price.
  const p1 = pr(T0 + M + 1e3, 7393, 60, "sell", "p1"), p2 = pr(T0 + M + 2e3, 7393, 400, "sell", "p2");
  const out = stepVariantMinute(s, T0 + M, { x: X, fairU: FAIR_U, prints: [p1, p2] }, arm, gov);
  const capUsd = 0.10 * (460 * 7393 * 1e-4) * X;                                       // 10 % of the minute's $425.10
  const fills = out.events.filter((e) => e.kind === "fill").map((e) => [e.k, (e.detail.print as { id: string }).id, Number(e.detail.usd)]);
  // The exit closes whole on the first print and takes nothing of it. The 0.05 % bid (7396) takes the whole minute's cap
  // from that print ($42.51 of its $55.45); the 0.075 % bid (7394) is left nothing, on either print. Under the frozen
  // per-rung cap both would have filled, each at its own 10 %.
  assertEquals(out.trips.map((t) => [t.side, t.k, t.how, t.exit]), [["ask", 0.0005, "maker", 0.74]]);
  assertEquals(fills.map(([k, id]) => [k, id]), [[0.0005, "p1"]]);
  assertAlmostEquals(fills[0][2] as number, capUsd, 1e-9);
  assertEquals([bid(0.0005).mode, bid(0.00075).mode, bid(0.001).mode], ["position", "quote", "quote"]);
});

Deno.test("the shared cap: each print shares its own quantity, nearest the market first, ties broken by k", () => {
  const arm = VARIANT_ARMS.main, gov = newGovCounts();
  const s = newVariantBook("USDT-GBP", arm, pr(T0 - 5e3, 7400, 1, "buy", "seed"));
  stepVariantMinute(s, T0, quiet, arm, gov);
  const bids = s.rungs.filter((r) => r.side === "bid");
  // Two rungs at one price: the lower k fills first.
  bids[1].o!.ticks = bids[0].o!.ticks;
  // A small print through the top three bids, then a big one: the first fills the nearest bids by what it printed, in turn.
  const top = bids[0].o!.ticks;
  const small = pr(T0 + M + 1e3, bids[2].o!.ticks - 1, 30, "sell", "small"), big = pr(T0 + M + 2e3, bids[2].o!.ticks - 1, 20000, "sell", "big");
  const out = stepVariantMinute(s, T0 + M, { x: X, fairU: FAIR_U, prints: [small, big] }, arm, gov);
  const fills = out.events.filter((e) => e.kind === "fill").map((e) => [e.k, (e.detail.print as { id: string }).id]);
  const smallUsd = 30 * small.ticks * 1e-4 * X;                                          // $27.69: less than one rung
  assertEquals(fills.slice(0, 1), [[bids[0].k, "small"]]);                               // at `top`, k 0.03 % before 0.05 %
  assertAlmostEquals(Number(out.events.find((e) => e.kind === "fill")!.detail.usd), smallUsd, 1e-9);
  assertEquals(fills.slice(1).map(([, id]) => id), fills.slice(1).map(() => "big"));
  assertEquals(fills.slice(1).map(([k]) => k), [bids[1].k, bids[2].k]);                   // the big print: the tie's other rung, then the next price
  assertEquals(Math.round(bids[1].entry! / 1e-4), top);                                   // at its own price, the tie's
});

// ------------------------------------------------------------------ the driver, against the in-memory database

/**
 * PR5's record as its engine leaves it, cut from the golden "fresh" window (Yahoo's GBP/USD, the paper engine's own
 * source) and moved five whole days, so the window's first minute, 2026-09-23 00:00, falls on the variant's start,
 * 2026-09-28 00:00, at the same UTC hours: every print in `agent_quote_prints` with its id, a row of
 * `agent_quote_minutes` for every minute PR5 has decided, and `agent_quote_state.last_minute`.
 */
const FRESH = WINDOWS.find((w) => w.name === "fresh")!;
const SHIFT = VARIANT_START - FRESH.t0;
const freshPrints = Object.fromEntries(BOOKS.map((b) => [b, [
  ...(FRESH.books[b].seed_print ? [FRESH.books[b].seed_print!] : []), ...FRESH.books[b].prints,
].map((p) => ({ ...asPrint(p), ts: p[0] + SHIFT }))])) as Record<QuoteBook, Print[]>;
const minuteIndex = (t: number) => (t - SHIFT - FRESH.t0) / M;
const freshX = (t: number) => FRESH.x[minuteIndex(t)];
const freshFairU = (b: QuoteBook, t: number) => FRESH.books[b].fair_u[minuteIndex(t)];
const printsIn = (b: QuoteBook, a: number, z: number) => freshPrints[b].filter((p) => p.ts >= a && p.ts < z);
const isoOf = (t: number) => new Date(t).toISOString();

function pr5Record(lastMinute: number, opts: { skip?: Array<[QuoteBook, number]>; printsN?: (b: QuoteBook, t: number) => number } = {}) {
  const minutes: Row[] = [];
  for (let t = VARIANT_START; t <= lastMinute; t += M) {
    for (const b of BOOKS) {
      if (opts.skip?.some(([sb, st]) => sb === b && st === t)) continue;
      minutes.push({
        book: b, minute: isoOf(t), x: freshX(t), x_t: freshX(t) == null ? null : isoOf(t - M), fair_u: freshFairU(b, t), hours_n: 24,
        prints_n: opts.printsN ? opts.printsN(b, t) : printsIn(b, t, t + M).length, recorded_at: isoOf(t + M + 30e3),
      });
    }
  }
  const prints = BOOKS.flatMap((b) => freshPrints[b].map((p) => ({ id: p.id, book: b, ts: isoOf(p.ts), price: Number((p.ticks * 1e-4).toFixed(4)), qty: p.qty, side: p.side })));
  return {
    agent_quote_state: [{ id: 1, state: {}, last_minute: isoOf(lastMinute), updated_at: isoOf(lastMinute + M + 30e3), last_error: null }] as Row[],
    agent_quote_minutes: minutes, agent_quote_prints: prints as Row[], agent_quote_inputs: [] as Row[],
  };
}

const QUOTEV_TABLES = ["agent_quotev_state", "agent_quotev_minutes", "agent_quotev_events", "agent_quotev_trips"];
function variantWorld(record: Record<string, Row[]>, lease: Row = { name: "quotesv", lease_until: isoOf(0), holder: null }) {
  return memDb({ agent_locks: [lease], ...record, ...Object.fromEntries(QUOTEV_TABLES.map((t) => [t, []])) }, { now: () => Date.now() });
}

/** The rule itself over PR5's minutes [from, to], flat at `from`, seeded with the last print before it: what the driver must write. */
function pureRun(from: number, to: number, inputs: (b: QuoteBook, t: number) => MinuteInputs = (b, t) => ({ x: freshX(t), fairU: freshFairU(b, t), prints: printsIn(b, t, t + M) })) {
  const seeds = Object.fromEntries(BOOKS.map((b) => [b, freshPrints[b].filter((p) => p.ts < from).at(-1) ?? null])) as Record<QuoteBook, Print | null>;
  const st = newVariantState(from, seeds);
  const events: VariantEvent[] = [], trips: VariantTrip[] = [];
  for (let t = from; t <= to; t += M) {
    for (const b of BOOKS) {
      const inp = inputs(b, t);
      for (const a of VARIANT_ARM_NAMES) {
        const out = stepVariantMinute(st.arms[a].books[b], t, inp, VARIANT_ARMS[a], st.arms[a].gov);
        events.push(...out.events); trips.push(...out.trips);
      }
    }
  }
  return { events, trips, st };
}

const byPk = (keys: string[]) => (a: Row, b: Row) => {
  for (const k of keys) { const x = String(a[k]), y = String(b[k]); if (x !== y) return x < y ? -1 : 1; }
  return 0;
};
const EVENT_PK = ["arm", "book", "minute", "side", "k", "kind"], TRIP_PK = ["arm", "book", "side", "k", "t_entry"], MINUTE_PK = ["book", "minute"];
const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const eventRows = (events: VariantEvent[]) => wire(events.map(variantEventRow)).sort(byPk(EVENT_PK));
const tripRows = (trips: VariantTrip[]) => wire(trips.map(variantTripRow)).sort(byPk(TRIP_PK));
const stored = (tables: Record<string, Row[]>, name: string, pk: string[]) =>
  (tables[name] ?? []).map((r) => { const { id: _id, ...rest } = r; return name === "agent_quotev_trips" ? rest : r; }).sort(byPk(pk));
const runAt = (db: Db, now: number, clock?: () => number) => runQuotesVariant({ db, now, holder: `h${now}`, clock });
/** Calls until the variant has caught up with PR5, as the one-minute job makes them. */
async function catchUp(db: Db, now: number) {
  const reports = [];
  for (let i = 0; i < 100; i++) { const r = await runAt(db, now + i); reports.push(r); if (r.skipped) break; }
  return reports;
}

Deno.test("runQuotesVariant: the first call starts both arms flat at 2026-09-28 00:00 UTC, each book seeded with its last print before then", async () => {
  // Three prints: one at 23:30 the day before, the last before the start at 23:59:59, and one at 00:05, after the minute decided.
  const at = (h: number, m: number, s = 0) => VARIANT_START + ((h * 60 + m) * 60 + s) * 1e3;
  const prints: Row[] = [[at(-1, 30), 7400, "a"], [at(-1, 59, 59), 7401, "b"], [at(0, 5), 7399, "c"]].map(([ts, ticks, id]) => ({
    id, book: "USDC-GBP", ts: isoOf(ts as number), price: (ticks as number) / 1e4, qty: 10, side: "buy",
  }));
  const minutes = BOOKS.map((b) => ({ book: b, minute: isoOf(VARIANT_START), x: 1.34, x_t: isoOf(VARIANT_START - M), fair_u: 1.0, hours_n: 24, prints_n: 0, recorded_at: isoOf(at(0, 1, 30)) }));
  const { db, tables } = variantWorld({
    agent_quote_state: [{ id: 1, state: {}, last_minute: isoOf(VARIANT_START), updated_at: isoOf(at(0, 1, 30)), last_error: null }],
    agent_quote_minutes: minutes, agent_quote_prints: prints, agent_quote_inputs: [],
  });
  const r = await runAt(db, at(0, 2, 1));
  assertEquals([r.errors, r.minutes, r.from, r.to, r.chunks, r.reset], [[], 1, VARIANT_START, VARIANT_START, 1, false]);
  const st = (tables.agent_quotev_state[0].state as unknown) as VariantState;
  assertEquals([st.lastMinute, st.codeVersion], [VARIANT_START, VARIANT_CODE_VERSION]);
  assertEquals(st.arms.main.books["USDC-GBP"].lastPrint?.id, "b");                  // the seed: the last print before 00:00
  assertEquals(st.arms.main.books["USDT-GBP"].lastPrint, null);                     // a book with no print yet has none
  // Flat: every rung of both arms goes out at 00:00, and nothing else happens.
  const ev = tables.agent_quotev_events;
  assertEquals(ev.filter((e) => e.arm === "main" && e.what === "place").length, 36);
  assertEquals(ev.filter((e) => e.arm === "top5" && e.what === "place").length, 20);
  assertEquals([ev.length, ev.every((e) => e.minute === isoOf(VARIANT_START) && e.kind === "order")], [56, true]);
  assertEquals(tables.agent_quotev_state[0].last_minute, isoOf(VARIANT_START));
  // One record of the minute for each book, shared by both arms: PR5's X and fairU, and the prints it was decided on.
  assertEquals(tables.agent_quotev_minutes.map((m) => [m.book, m.source, m.x, m.fair_u, m.prints_n, m.pr5_prints_n]),
    [["USDC-GBP", "minutes", 1.34, 1.0, 0, 0], ["USDT-GBP", "minutes", 1.34, 1.0, 0, 0]]);
});

Deno.test("runQuotesVariant decides a minute only once PR5 has decided it, and never one twice; of PR5's state it reads last_minute alone", async () => {
  const { db, tables } = variantWorld(pr5Record(VARIANT_START + 4 * M));
  // PR5's state carries its books; nothing of it but last_minute may reach the variant.
  tables.agent_quote_state[0].state = { books: "not the variant's to read" };
  const reads: string[] = [];
  const spy: Db = { ...db, select: (t, q) => { reads.push(`${t}?${q}`); return db.select(t, q); } };
  const a = await runAt(spy, VARIANT_START + 6 * M);
  assertEquals([a.from, a.to, a.minutes, a.pr5LastMinute], [VARIANT_START, VARIANT_START + 4 * M, 5, VARIANT_START + 4 * M]);
  assertEquals(reads.filter((r) => r.startsWith("agent_quote_state?")), ["agent_quote_state?id=eq.1&select=last_minute"]);
  assert(!reads.some((r) => /^agent_quote_(trips|events|live)/.test(r)), reads.join(" | "));
  const b = await runAt(db, VARIANT_START + 6 * M + 5e3);
  assertEquals(b.skipped, "no minute PR5 has decided is left to decide");
  // PR5 decides two more: so does the variant, and only those.
  tables.agent_quote_state[0].last_minute = isoOf(VARIANT_START + 6 * M);
  const c = await runAt(db, VARIANT_START + 7 * M);
  assertEquals([c.from, c.to, c.minutes], [VARIANT_START + 5 * M, VARIANT_START + 6 * M, 2]);
  // Before PR5 has decided anything, nothing.
  const empty = variantWorld({ agent_quote_state: [], agent_quote_minutes: [], agent_quote_prints: [], agent_quote_inputs: [] });
  assertEquals((await runAt(empty.db, VARIANT_START + M)).skipped, "PR5's engine has decided no minute yet");
  assertEquals(empty.tables.agent_quotev_state, []);
});

Deno.test("runQuotesVariant catches up at most 120 minutes a call, in chunks, and what it writes over many calls is the rule run straight through", async () => {
  const last = VARIANT_START + 299 * M;
  const { db, tables } = variantWorld(pr5Record(last));
  const runs = await catchUp(db, last + 2 * M);
  assertEquals(runs.map((r) => r.minutes), [120, 120, 60, 0]);
  assertEquals(runs.map((r) => r.chunks), [120 / VARIANT_CHUNK_MINUTES, 120 / VARIANT_CHUNK_MINUTES, 60 / VARIANT_CHUNK_MINUTES, 0]);
  assertEquals(runs.map((r) => r.to), [VARIANT_START + 119 * M, VARIANT_START + 239 * M, last, null]);
  assertEquals(runs[3].skipped, "no minute PR5 has decided is left to decide");
  // Calls and chunks, the state saved and read back between them, write exactly what one pass of the rule over the same
  // minutes gives: every POST with its key's running count, every refusal, withdrawal, fill, exit and trip.
  const pure = pureRun(VARIANT_START, last);
  assertEquals(stored(tables, "agent_quotev_events", EVENT_PK), eventRows(pure.events));
  assertEquals(stored(tables, "agent_quotev_trips", TRIP_PK), tripRows(pure.trips));
  assertEquals((tables.agent_quotev_state[0].state as unknown) as VariantState, wire({ ...pure.st, lastMinute: last }));
  assertEquals(tables.agent_quotev_minutes.length, 2 * 300);
  assert(pure.events.some((e) => e.kind === "fill"), "the stretch fills something");
  // Every row a bulk write sends has every column (a PostgREST bulk write takes one set of keys).
  for (const t of ["agent_quotev_minutes", "agent_quotev_events", "agent_quotev_trips"]) {
    const keys = new Set((tables[t] ?? []).map((r) => Object.keys(r).filter((k) => k !== "id").sort().join()));
    assert(keys.size <= 1, `${t}: ${[...keys].join(" | ")}`);
  }
});

Deno.test("runQuotesVariant from its start reproduces the golden window it starts on: the same trips, and the same POSTs one by one", async () => {
  // The fresh window starts flat at its first minute, as the variant does at 2026-09-28 00:00: over its first six hours
  // the driver, reading PR5's record through the database, must write what the reference did.
  const last = VARIANT_START + 359 * M;
  const { db, tables } = variantWorld(pr5Record(last));
  await catchUp(db, last + 2 * M);
  for (const a of VARIANT_ARM_NAMES) {
    for (const b of BOOKS) {
      const g = FRESH.arms[a].books[b];
      const trips = tables.agent_quotev_trips.filter((t) => t.arm === a && t.book === b).sort((x, y) => Date.parse(String(x.t_exit)) - Date.parse(String(y.t_exit)));
      const want = g.trips.filter((t) => t.t_exit + SHIFT <= last);
      assertEquals(trips.map((t) => [t.side, t.k, Date.parse(String(t.t_entry)) - SHIFT, Date.parse(String(t.t_exit)) - SHIFT, t.how]),
        want.map((t) => [t.side, t.k, t.t_entry, t.t_exit, t.how]), `${a} ${b} trips`);
      trips.forEach((t, i) => assertAlmostEquals(Number(t.pnl_usd), want[i].pnl_usd, 1e-12));
      const posts = tables.agent_quotev_events.filter((e) => e.arm === a && e.book === b && e.what != null)
        .sort(byPk(["minute", "side", "k"])).map((e) => [(Date.parse(String(e.minute)) - VARIANT_START) / M, e.side, e.what, e.k]);
      const wantPosts = g.posts.filter(([i]) => i <= 359).map((p) => [...p]).sort((x, y) => (x[0] as number) - (y[0] as number) || String(x[1]).localeCompare(String(y[1])) || (x[3] as number) - (y[3] as number));
      assertEquals(posts, wantPosts, `${a} ${b} POSTs`);
    }
  }
});

Deno.test("runQuotesVariant takes a minute's prints by time, then by id in code-point order, whatever order the database returns them in", async () => {
  // Two sells in the same millisecond through the variant's two nearest USDC-GBP bids (7397 and 7396 at fair 0.74): one
  // small, through the nearest only, and one large, through both. Their ids sort "B" < "a" by code point, and a database
  // collation that ignores case would put "a" first. Decided on the small one first, it takes $22 of the nearest bid
  // and the large one fills the next; decided the other way, the large one fills both. The rule decides "B" first.
  const t = VARIANT_START + 3 * M, at = t + 30e3;
  const rows: Row[] = [
    { id: "a", book: "USDC-GBP", ts: isoOf(at), price: 0.7395, qty: 5000, side: "sell" },
    { id: "B", book: "USDC-GBP", ts: isoOf(at), price: 0.7396, qty: 30, side: "sell" },
  ];
  const minutes: Row[] = [];
  for (let m = VARIANT_START; m <= t; m += M) {
    for (const b of BOOKS) minutes.push({ book: b, minute: isoOf(m), x: 1.25, x_t: isoOf(m - M), fair_u: 0.925, hours_n: 24, prints_n: b === "USDC-GBP" && m === t ? 2 : 0, recorded_at: isoOf(m + 90e3) });
  }
  const record = { agent_quote_state: [{ id: 1, state: {}, last_minute: isoOf(t), updated_at: isoOf(t + 90e3), last_error: null }], agent_quote_minutes: minutes, agent_quote_prints: rows, agent_quote_inputs: [] };
  const { db, tables } = variantWorld(record);
  // The database answers in its own collation: case ignored, "a" before "B".
  const caseless: Db = { ...db, selectAll: async <T,>(tb: string, q: string) => (await db.selectAll<Row>(tb, q)).sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || String(x.id).toLowerCase().localeCompare(String(y.id).toLowerCase())) as T[] };
  const r = await runAt(caseless, t + 2 * M);
  assertEquals(r.errors, []);
  const fills = tables.agent_quotev_events.filter((e) => e.arm === "main" && e.kind === "fill").map((e) => [e.k, (e.detail as { print: { id: string } }).print.id]);
  assertEquals(fills, [[0.0003, "B"], [0.0005, "a"]]);
  // And the rule, handed the two the other way round, decides otherwise: the order is part of it.
  const s = newVariantBook("USDC-GBP", VARIANT_ARMS.main), gov = newGovCounts();
  for (let m = VARIANT_START; m < t; m += M) stepVariantMinute(s, m, { x: 1.25, fairU: 0.925, prints: [] }, VARIANT_ARMS.main, gov);
  const prints = rows.map((p) => ({ id: String(p.id), ts: at, ticks: Math.round(Number(p.price) * 1e4), qty: Number(p.qty), side: "sell" as const }));
  const wrong = stepVariantMinute(s, t, { x: 1.25, fairU: 0.925, prints }, VARIANT_ARMS.main, gov);
  assertEquals(wrong.events.filter((e) => e.kind === "fill").map((e) => [e.k, (e.detail.print as { id: string }).id]), [[0.0003, "a"], [0.0005, "a"]]);
});

Deno.test("runQuotesVariant: a book-minute PR5 decided without writing its row is rebuilt from agent_quote_inputs as PR5's engine computes it, and its record says so", async () => {
  const last = VARIANT_START + 30 * M, gap = VARIANT_START + 17 * M;
  const record = pr5Record(last, { skip: [["USDT-GBP", gap]] });
  // The stored series as PR5's engine keeps them: GBP/USD minute bars, and the USD book's hours (one close, 24 times).
  for (let t = gap - 12 * M; t < gap; t += M) if (freshX(t + M) != null) record.agent_quote_inputs.push({ kind: "fx", t: isoOf(t), value: freshX(t + M) });
  const hour = Math.floor(gap / 3600e3) * 3600e3;
  for (let h = hour - 24 * 3600e3; h < hour; h += 3600e3) record.agent_quote_inputs.push({ kind: "fair:USDT-USD", t: isoOf(h), value: freshFairU("USDT-GBP", gap) });
  const { db, tables } = variantWorld(record);
  const r = await runAt(db, last + 2 * M);
  assertEquals([r.errors, r.rebuilt, r.printsDiffer], [[], 1, 0]);
  const rebuilt = tables.agent_quotev_minutes.filter((m) => m.source === "rebuilt");
  // X from the bar of the minute before; fairU the median of the closes lying wholly inside the last 24 hours (01:00 … 23:00).
  assertEquals(rebuilt.map((m) => [m.book, m.minute, m.x, m.x_t, m.fair_u, m.hours_n, m.pr5_prints_n]),
    [["USDT-GBP", isoOf(gap), freshX(gap), isoOf(gap - M), freshFairU("USDT-GBP", gap), 23, null]]);
  assertEquals(tables.agent_quotev_minutes.length, 2 * 31);
  // Decided exactly as on PR5's own row: the same POSTs, fills and trips.
  const pure = pureRun(VARIANT_START, last);
  assertEquals(stored(tables, "agent_quotev_events", EVENT_PK), eventRows(pure.events));
  assertEquals(stored(tables, "agent_quotev_trips", TRIP_PK), tripRows(pure.trips));
});

Deno.test("runQuotesVariant: a minute PR5 decided on another count of prints is decided on what is stored, and its record shows both counts", async () => {
  const last = VARIANT_START + 10 * M, odd = VARIANT_START + 3 * M;
  const { db, tables } = variantWorld(pr5Record(last, { printsN: (b, t) => printsIn(b, t, t + M).length + (b === "USDC-GBP" && t === odd ? 1 : 0) }));
  const r = await runAt(db, last + 2 * M);
  assertEquals(r.printsDiffer, 1);
  const rec = tables.agent_quotev_minutes.filter((m) => m.prints_n !== m.pr5_prints_n);
  assertEquals(rec.map((m) => [m.book, m.minute, m.source, m.prints_n, m.pr5_prints_n]),
    [["USDC-GBP", isoOf(odd), "minutes", printsIn("USDC-GBP", odd, odd + M).length, printsIn("USDC-GBP", odd, odd + M).length + 1]]);
});

Deno.test("runQuotesVariant: a call that dies before its state is saved is decided again the same way, and nothing is written twice", async () => {
  const last = VARIANT_START + 150 * M;
  const clean = variantWorld(pr5Record(last));
  await catchUp(clean.db, last + 2 * M);
  const { db, tables } = variantWorld(pr5Record(last));
  let failNext = true;
  const dying: Db = { ...db, upsert: (t, rows, key) => (t === "agent_quotev_state" && failNext ? (failNext = false, Promise.reject(new Error("db POST agent_quotev_state → 503"))) : db.upsert(t, rows, key)) };
  const first = await runAt(dying, last + 2 * M);
  assertEquals([first.errors, first.minutes], [["db POST agent_quotev_state → 503"], 0]);
  assert(tables.agent_quotev_events.length > 0 && tables.agent_quotev_state.length === 0);     // written, but not the state
  await catchUp(dying, last + 2 * M + 1e3);                                                    // decides the first chunk again
  for (const [t, pk] of [["agent_quotev_minutes", MINUTE_PK], ["agent_quotev_events", EVENT_PK], ["agent_quotev_trips", TRIP_PK]] as const) {
    assertEquals(stored(tables, t, pk).map((r) => ({ ...r, recorded_at: null })), stored(clean.tables, t, pk).map((r) => ({ ...r, recorded_at: null })), t);
  }
  assertEquals(tables.agent_quotev_state[0].state, clean.tables.agent_quotev_state[0].state);
  assertEquals(tables.agent_locks[0].holder, null);                                            // the lease went back each time
});

Deno.test("runQuotesVariant starts no chunk after 10 s, so a call returns in about 20 s at most; the next call goes on from where it stopped", async () => {
  const last = VARIANT_START + 119 * M;
  const { db, tables } = variantWorld(pr5Record(last));
  // A slow database: every read of PR5's minutes takes 4 s of the call's time.
  let clock = 0;
  const slow: Db = { ...db, select: (t, q) => { if (t === "agent_quote_minutes") clock += 4e3; return db.select(t, q); } };
  const a = await runAt(slow, last + 2 * M, () => clock);
  // Chunks at 0, 4 and 8 s; at 12 s none starts. What was decided is saved; the rest is the next call's.
  assertEquals([a.chunks, a.minutes, a.stoppedEarly, a.to], [3, 3 * VARIANT_CHUNK_MINUTES, true, VARIANT_START + (3 * VARIANT_CHUNK_MINUTES - 1) * M]);
  assert(clock >= VARIANT_WALL_STOP_MS);
  assertEquals(tables.agent_quotev_state[0].last_minute, isoOf(VARIANT_START + (3 * VARIANT_CHUNK_MINUTES - 1) * M));
  clock = 0;
  const b = await runAt(slow, last + 2 * M + 1e3, () => clock);
  assertEquals([b.from, b.to, b.stoppedEarly], [VARIANT_START + 3 * VARIANT_CHUNK_MINUTES * M, last, false]);
  const pure = pureRun(VARIANT_START, last);
  assertEquals(stored(tables, "agent_quotev_events", EVENT_PK), eventRows(pure.events));
});

Deno.test("runQuotesVariant: a record written under another code version is wiped, PR5's untouched, and everything decided again from 00:00 UTC, flat", async () => {
  const last = VARIANT_START + 90 * M;
  const clean = variantWorld(pr5Record(last));
  await catchUp(clean.db, last + 2 * M);
  const { db, tables } = variantWorld(pr5Record(last));
  await catchUp(db, last + 2 * M);
  // The record as an older engine left it: its version, a trip and an event the current rule never made, and a state
  // that believes it is further on than it is.
  const st = tables.agent_quotev_state[0].state as unknown as VariantState;
  tables.agent_quotev_state[0].state = { ...st, codeVersion: VARIANT_CODE_VERSION - 1, lastMinute: last - 10 * M };
  tables.agent_quotev_trips.push({ ...tables.agent_quotev_trips[0] ?? {}, id: 1, arm: "main", key: "USDC-GBP/bid", book: "USDC-GBP", side: "bid", k: 0.0003, t_entry: isoOf(VARIANT_START + 5 * M), pnl_usd: 99 });
  tables.agent_quotev_events.push({ arm: "top5", book: "USDT-GBP", minute: isoOf(VARIANT_START + 7 * M), side: "ask", k: 0.0015, kind: "withdraw", what: null, key: "USDT-GBP/ask", ticks: 1, detail: { why: "older code" } });
  const pr5Before = wire(Object.fromEntries(["agent_quote_state", "agent_quote_minutes", "agent_quote_prints", "agent_quote_inputs"].map((t) => [t, tables[t]])));
  const runs = await catchUp(db, last + 3 * M);
  assertEquals([runs[0].reset, runs[0].from, runs.slice(1).some((r) => r.reset)], [true, VARIANT_START, false]);
  for (const [t, pk] of [["agent_quotev_minutes", MINUTE_PK], ["agent_quotev_events", EVENT_PK], ["agent_quotev_trips", TRIP_PK]] as const) {
    assertEquals(stored(tables, t, pk).map((r) => ({ ...r, recorded_at: null })), stored(clean.tables, t, pk).map((r) => ({ ...r, recorded_at: null })), t);
  }
  assertEquals(tables.agent_quotev_state[0].state, clean.tables.agent_quotev_state[0].state);
  assertEquals(((tables.agent_quotev_state[0].state as unknown) as VariantState).codeVersion, VARIANT_CODE_VERSION);
  assertEquals(wire(Object.fromEntries(["agent_quote_state", "agent_quote_minutes", "agent_quote_prints", "agent_quote_inputs"].map((t) => [t, tables[t]]))), pr5Before);
});

Deno.test("runQuotesVariant: a call that finds the lease held does nothing", async () => {
  const now = VARIANT_START + 10 * M;
  const { db, tables } = variantWorld(pr5Record(VARIANT_START + 5 * M), { name: "quotesv", lease_until: isoOf(now + 30e3), holder: "other" });
  const r = await runAt(db, now);
  assertEquals(r.skipped, "another run holds the quotesv lease");
  assertEquals([tables.agent_quotev_state, tables.agent_quotev_events, tables.agent_quotev_minutes], [[], [], []]);
  assertEquals(tables.agent_locks[0].holder, "other");
});

Deno.test("runQuotesVariant calls nothing but the database: no venue, no network", async () => {
  const { db } = variantWorld(pr5Record(VARIANT_START + 20 * M));
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((u: string | URL | Request) => { calls.push(String(u)); return Promise.reject(new Error("no network")); }) as typeof fetch;
  try {
    const r = await runAt(db, VARIANT_START + 22 * M);
    assertEquals([r.errors, r.minutes], [[], 21]);
  } finally { globalThis.fetch = realFetch; }
  assertEquals(calls, []);
});

Deno.test("a 120-minute catch-up costs well under the Edge request's 2 s of CPU, past the tape's busiest two hours", async () => {
  // The busiest 120 minutes of the committed tape hold 247 prints (213 on USDC-GBP, 34 on USDT-GBP). Measured here: the
  // fresh days' first two hours as they are, and every print of the two fresh days (394) folded into those same two
  // hours, both arms flat at the start so every rung of both goes out in the first minute. The in-memory database
  // round-trips every row through JSON, as PostgREST's client does, and merges an upsert row by row, slower than Postgres.
  const last = VARIANT_START + 119 * M, span = 120 * M;
  const timed = async (record: ReturnType<typeof pr5Record>) => {
    const { db } = variantWorld(record);
    const t0 = performance.now();
    const r = await runAt(db, last + 2 * M);
    const ms = performance.now() - t0;
    assertEquals([r.errors, r.minutes], [[], 120]);
    return { ms, prints: r.prints };
  };
  const plain = await timed(pr5Record(last));
  const fold = (ts: number) => (ts < VARIANT_START ? ts : VARIANT_START + ((ts - VARIANT_START) % span));
  const folded = Object.fromEntries(BOOKS.map((b) => [b, freshPrints[b].map((p) => ({ ...p, ts: fold(p.ts) }))])) as Record<QuoteBook, Print[]>;
  const heavy = pr5Record(last, { printsN: (b, t) => folded[b].filter((p) => p.ts >= t && p.ts < t + M).length });
  heavy.agent_quote_prints = heavy.agent_quote_prints.map((p) => ({ ...p, ts: isoOf(fold(Date.parse(String(p.ts)))) }));
  const busy = await timed(heavy);
  console.log(`120-minute catch-up: ${plain.ms.toFixed(0)} ms on ${plain.prints} prints; ${busy.ms.toFixed(0)} ms on ${busy.prints}`);
  assert(busy.prints >= 247, `${busy.prints} prints`);
  assert(plain.ms < 1000 && busy.ms < 1000, `${plain.ms} / ${busy.ms} ms`);
});
