// PR5's live executor as an instance (2026-10-02, for the realistic twins): its default instance IS the code that ran the
// live account until then. `quotes_live_frozen.ts` is that file byte for byte (sha256 60d3f33f…a52, its last commit
// 8acbcead); here it runs beside today's default instance over the same simulated hours, turn by turn, each in a database
// of its own and against a simulated Revolut X account of its own (revx_sim.ts) fed the same public prints, and after
// every turn every table, the account's whole state and the two reports are compared whole.
//
// The hours go through what the executor does: the operator's maker conversions and a taker one, entries following the
// paper engine, fills by the prints through them (in part and whole), exits and their re-prices, post-only refusals at
// the book, automatic top-ups, the stale-input guard (GBP/USD dark for an hour), the de-peg guard, a 24-hour stop, the
// governor closing entries, the global pause, and a stretch unarmed. Without the coverage this test also asserts, an
// equality would prove nothing.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { REVX_REGION, revxVenue } from "../_shared/revx.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import * as Now from "./quotes_live.ts";
import * as Frozen from "./quotes_live_frozen.ts";
import { newSimState, SimRevx } from "./revx_sim.ts";
import { memDb, type Row } from "./testing.ts";
import { specFromRow, TWIN_SPEC_ROWS } from "./quotes_twin.ts";

const M = 60e3, H = 3600e3;
const T0 = Date.parse("2026-09-24T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const HOURS = 6;

/** A seeded generator (mulberry32): the same tape every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GBP/USD each minute: steady, then swinging 0.08 % a minute (every quote re-prices), dark for an hour, a 0.7 % jump. */
function fxAtMinute(t: number): number | null {
  const h = (t - T0) / H;
  if (h >= 2 && h < 3) return null;                                        // dark: the stale-input guard
  if (h >= 1 && h < 1.75) return ((t - T0) / M) % 2 === 0 ? 1.3238 : 1.3249; // swinging: every quote re-prices, the governor fills
  if (h >= 4 && h < 4.25) return 1.3238 * 1.007;                            // a jump: fair leaves the last prints, the de-peg guard
  return 1.3238;
}

type Mod = typeof Now | typeof Frozen;

function world(mod: Mod, instance?: Now.QuoteLiveInstance) {
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + (HOURS + 1) * H; t += M) { const x = fxAtMinute(t < T0 ? T0 : t); if (x != null) inputs.push({ kind: "fx", t: iso(t), value: x }); }
  for (let t = T0 - 30 * H; t <= T0 + (HOURS + 1) * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  const mem = memDb({
    agent_locks: [{ name: "quotes-live", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_live_config: [{ id: 1, dry_run: false, live_confirmed_at: iso(T0 - H), capital_gbp: 120 }],
    agent_quote_live_orders: [], agent_quote_live_events: [], agent_quote_live_state: [],
    agent_quote_state: [], agent_quote_inputs: inputs, agent_quote_events: [],
  }, { now: () => clock.now });
  const seed: Print = { id: "seed", ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" };
  const sim = new SimRevx(newSimState({ GBP: 120.33, USDC: 13.2 }, { "USDC-GBP": seed, "USDT-GBP": { ...seed, ticks: 7551 } }), () => clock.now, () => null);
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const deps = (at: number) => ({
    db: mem.db, now: at, holder: `h${at}`, uuid, account: revxVenue({ apiKey: "simulated", privateKey: KEY }, sim.fetch, REVX_REGION, () => clock.now), accountNote: null,
    fetch: sim.publicFetch, pause: () => Promise.resolve(), clock: () => clock.now, ...(instance ? { instance } : {}),
  });
  return {
    mem, sim, clock,
    turn(at: number) { clock.now = at; return mod.runQuotesLive(deps(at)); },
    convert(at: number, body: Record<string, unknown>) { clock.now = at; return mod.runQuotesConvert(deps(at), body); },
    print(book: QuoteBook, p: Print) { clock.now = p.ts; sim.applyPrint(book, p); },
    // The state's `venueBalances` (2026-10-29: the venue's available and on-hold amounts for the LIVE page, `venueBalancesOf`)
    // is a write of what the turn read, which the frozen file does not make and nothing decides on: it is left out of the
    // comparison, and pinned on its own below.
    snapshot: () => JSON.stringify({ tables: mem.tables, account: sim.st }, (k, v) => (k === "venueBalances" ? undefined : v)),
  };
}

Deno.test("the executor's default instance is the frozen executor: the same tables, account and reports, turn by turn", () => sixHours());

// p50x1's rule extension (docs/agents/reviews/2026-10-09-p50x1-prereg.md): an `exitOffset` whose instant has not come is
// no change at all. The same six hours, today's executor with an offset of a tick from an instant after them, against the
// frozen file: every table, the account and every report equal after every turn.
Deno.test("an exitOffset before its instant is the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, exitOffset: { ticks: 1, from: T0 + (HOURS + 1) * H } }));

// Rule D's twin's retired rung likewise: a retirement whose instant has not come changes nothing.
Deno.test("a retired rung before its instant is the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, retired: { ks: [0.001], from: T0 + (HOURS + 1) * H } }));

// Variant-3's weekend rule (take50wk, 0130; docs/agents/reviews/2026-10-18-revx-weekend-prereg.md): before its instant, and
// in force on a weekday — the six hours are a Thursday, with GBP/USD dark for its third hour — it changes nothing: a dark
// minute outside a closure stays dark, the stale-input guard as the frozen executor has it.
Deno.test("a weekend rule before its instant is the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, weekend: { from: T0 + (HOURS + 1) * H } }));
Deno.test("a weekend rule in force on a weekday is the frozen executor: the Thursday's dark hour stays dark, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, weekend: { from: T0 - 24 * H } }));

// PR5-OPT's two options (docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md) are the live account's code untouched where
// they are absent (the default instance above), before their instant, and in force at their neutral settings: equal weights
// size every rung at the capital over twelve and cap a conversion at three asks' worth, as `rungGbp` and a quarter of the
// capital do; a holding line of £0.10 is the venue's own minimum. Every table, the account and every report equal the frozen
// executor's after every turn of the six hours, with their fills, exits, stops, top-ups and conversions.
Deno.test("weights before their instant are the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, weights: { from: T0 + (HOURS + 1) * H, book: { "USDT-GBP": 2 }, k: { "0.003": 0 } } }));
Deno.test("equal weights in force are the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, weights: { from: T0 - 24 * H, book: { "USDC-GBP": 1, "USDT-GBP": 1 }, side: { bid: 1, ask: 1 } } }));
Deno.test("a holding line before its instant is the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, holdMin: { from: T0 + (HOURS + 1) * H, gbp: 1 } }));
Deno.test("a holding line of £0.10 in force (the venue's own minimum) is the frozen executor: the same six hours, turn by turn", () =>
  sixHours({ ...Now.QUOTE_LIVE_INSTANCE, holdMin: { from: T0 - 24 * H, gbp: 0.1 } }));

// An operator's conversion following the bid (`convertRepeg`, 2026-10-28; the live account's instance alone). Before its
// instant the live account's instance is the frozen executor (the first test above runs it, its instant after the six
// hours). In force, on these six hours, the operator's maker conversion fills before it falls behind a moved bid, and the
// executor is still the frozen one, turn by turn: the rule changes nothing until a conversion is left under the bid.
Deno.test("the live account's instance has its conversion follow the bid from 2026-10-28 00:00 UTC, the top-ups' 30 minutes after it fell behind; no other option", () => {
  assertEquals(Now.QUOTE_LIVE_INSTANCE.convertRepeg, { from: Date.parse("2026-10-28T00:00:00Z") });
  assertEquals([Now.QUOTE_LIVE_CONVERT_REPEG_MS, Now.QUOTE_LIVE_TOPUP_REST_MS, Now.QUOTE_LIVE_CONVERT_REST_MS], [30 * M, 30 * M, 24 * H]);
});
Deno.test("a conversion following the bid, in force over the six hours, is the frozen executor: no conversion is left under the bid, turn by turn", async () => {
  const seen = await sixHoursSeen({ ...Now.QUOTE_LIVE_INSTANCE, convertRepeg: { from: T0 - 24 * H } });
  assertEquals(seen.repegs, 0);
});

// An exit meeting the book (`exitTicksOnBook`, every instance from 2026-10-29). Before its instant the default instance is the
// frozen executor (the first test above). In force over the six hours, it is the frozen executor turn by turn until the first
// exit whose rule price crosses the book it meets: there the frozen one records a refused row and this one rests that exit
// inside the book, at a better price; nothing else differs at that turn's start.
Deno.test("an exit meeting the book, in force over the six hours, is the frozen executor turn by turn until an exit crosses; that exit rests inside the book", async () => {
  const seen = await sixHoursSeen({ ...Now.QUOTE_LIVE_INSTANCE, exitInside: { from: T0 - 24 * H } }, { untilExitCrosses: true });
  assert(seen.equalTurns >= 10, JSON.stringify(seen));
  assertEquals(seen.crossed.length, 1, JSON.stringify(seen.crossed));
});

// The twins (quotes_twin.ts) run this executor on instances their spec rows build (`specFromRow`), and no twin rule sets
// `convertRepeg`: LIVE's twin (`live600`, 0141) and PR5-OPT's five (`o600*`, 0149) rest their operator's conversion as
// they did. The counterfactual: each of their instances, its options in force from before the six hours, with and without
// the rule in force too, on the hours with no operator conversion (the asks' coin from the executor's own top-ups), gives
// the same tables, account and reports turn by turn: the rule acts on an operator's conversion and on nothing else.
const TWIN_ROWS = [
  { id: "live600", rules: { fill: { model: "at", from: "2026-10-27T00:00:00Z" }, weekend: { from: "2026-10-30T21:00:00Z" } } },
  { id: "o600no03", rules: { fill: { model: "at", from: "2026-10-27T06:00:00Z" }, weekend: { from: "2026-10-27T06:00:00Z" }, weights: { from: "2026-10-27T06:00:00Z", k: { "0.001": 1, "0.002": 1, "0.003": 0 } } } },
  { id: "o600hold1", rules: { fill: { model: "at", from: "2026-10-27T06:00:00Z" }, weekend: { from: "2026-10-27T06:00:00Z" }, holdMin: { from: "2026-10-27T06:00:00Z", gbp: 1 } } },
  { id: "o600usdt2", rules: { fill: { model: "at", from: "2026-10-27T06:00:00Z" }, weekend: { from: "2026-10-27T06:00:00Z" }, weights: { from: "2026-10-27T06:00:00Z", book: { "USDC-GBP": 1, "USDT-GBP": 2 } } } },
  { id: "o600usdt3", rules: { fill: { model: "at", from: "2026-10-27T06:00:00Z" }, weekend: { from: "2026-10-27T06:00:00Z" }, weights: { from: "2026-10-27T06:00:00Z", book: { "USDC-GBP": 1, "USDT-GBP": 3 } } } },
  { id: "o600usdt", rules: { fill: { model: "at", from: "2026-10-27T06:00:00Z" }, weekend: { from: "2026-10-27T06:00:00Z" }, weights: { from: "2026-10-27T06:00:00Z", book: { "USDC-GBP": 0, "USDT-GBP": 1 } } } },
];
const twinRow = (r: (typeof TWIN_ROWS)[number]) => ({
  ...TWIN_SPEC_ROWS[1], id: r.id, display_name: r.id, table_prefix: `agent_quote_twin_${r.id}`, lease: `quotes-twin-${r.id}`, capital_gbp: 600, rules: r.rules,
});
/** A twin's instance on the live account's tables (the six hours' world), each of its options in force from a day before them. */
function twinOnLiveTables(r: (typeof TWIN_ROWS)[number]): Now.QuoteLiveInstance {
  const I = Now.QUOTE_LIVE_INSTANCE, t = specFromRow(twinRow(r)).instance, from = T0 - 24 * H;
  return {
    ...t, config: I.config, orders: I.orders, events: I.events, state: I.state, paper: I.paper, lease: I.lease, migration: I.migration,
    ...(t.weights ? { weights: { ...t.weights, from } } : {}), ...(t.holdMin ? { holdMin: { ...t.holdMin, from } } : {}),
    ...(t.weekend ? { weekend: { from } } : {}), ...(t.simFill ? { simFill: { ...t.simFill, from } } : {}),
  };
}
Deno.test("no twin follows the bid: LIVE's twin and PR5-OPT's five carry no convertRepeg, and no twin row can set it", () => {
  for (const r of TWIN_ROWS) assertEquals(specFromRow(twinRow(r)).instance.convertRepeg, undefined, r.id);
  for (const r of TWIN_SPEC_ROWS) assertEquals(specFromRow(r).instance.convertRepeg, undefined, r.id);
  let why = "";
  try { specFromRow({ ...twinRow(TWIN_ROWS[0]), rules: { convertRepeg: { from: "2026-10-28T00:00:00Z" } } }); } catch (e) { why = (e as Error).message; }
  assertEquals(why, "twin live600: no code for its rule convertRepeg");
});
// An exit meeting the book is every instance's, the twins' with LIVE's: on each twin's instance (its rules in force), the same
// six hours in force or not are equal turn by turn until an exit crosses, and that exit rests inside the book.
for (const r of TWIN_ROWS) {
  Deno.test(`${r.id}'s instance: an exit meeting the book changes nothing until an exit crosses, and rests that one inside the book`, async () => {
    const t = twinOnLiveTables(r);
    const seen = await sixHoursSeen({ ...t, exitInside: { from: T0 - 24 * H } }, { against: t, operator: false, untilExitCrosses: true });
    assert(seen.equalTurns >= 10 && seen.crossed.length >= 1, JSON.stringify({ equalTurns: seen.equalTurns, crossed: seen.crossed }));
  });
}
for (const r of TWIN_ROWS) {
  Deno.test(`${r.id}'s instance with no operator conversion: following the bid in force or not, the same six hours, turn by turn`, async () => {
    const t = twinOnLiveTables(r);
    const seen = await sixHoursSeen({ ...t, convertRepeg: { from: T0 - 24 * H } }, { against: t, operator: false });
    assertEquals([seen.makerConv, seen.takerConv, seen.repegs], [0, 0, 0]);
  });
}

Deno.test("the live account's instance: the frozen rule's sizes, retirements and conversion cap until 2026-10-29 22:30 UTC and USDT-GBP alone from then (0178, 0179); its holding line the venue's minimum until 2026-10-29 22:00 UTC and £1 from then (0176)", () => {
  const I = Now.QUOTE_LIVE_INSTANCE;
  // USDT-GBP alone from QUOTE_LIVE_USDT_ONLY_FROM (docs/agents/reviews/2026-10-29-usdt-only-deviation.md); the rebook runs three days from it.
  const U = Date.parse("2026-10-29T22:30:00Z");
  assertEquals([Now.QUOTE_LIVE_USDT_ONLY_FROM, Now.QUOTE_LIVE_REBOOK_SINCE, I.weights, I.rebook], [U, U, { from: U, book: { "USDC-GBP": 0, "USDT-GBP": 1 } }, undefined]);
  assertEquals([Now.rebookOn(I, U - 1), Now.rebookOn(I, U), Now.rebookOn(I, U + 72 * H - 1), Now.rebookOn(I, U + 72 * H)], [false, true, true, false]);
  // Variant-4's £1 holding line from QUOTE_LIVE_HOLD_MIN_FROM (docs/agents/reviews/2026-10-29-holdmin-deviation.md).
  assertEquals([Now.QUOTE_LIVE_HOLD_MIN_FROM, I.holdMin], [Date.parse("2026-10-29T22:00:00Z"), { from: Date.parse("2026-10-29T22:00:00Z"), gbp: 1 }]);
  for (const now of [0, Date.parse("2026-10-29T00:00:00Z"), U - 1]) {
    for (const b of QUOTE_BOOKS) for (const side of ["bid", "ask"] as const) for (const k of I.rungs) {
      assertEquals(Now.rungGbpOf(I, 600, b, side, k, now), Now.rungGbp(600, I.rungs));
      assertEquals(Now.weightRetired(I, now, b, side, k), false);
    }
    for (const b of QUOTE_BOOKS) assertEquals(Now.convertCapGbp(I, 600, b, now), 600 * Now.QUOTE_LIVE_CONVERT_MAX_FRACTION);
  }
  // From it: USDT-GBP's six rungs £100 each at £600, USDC-GBP's none (no entry; a holding still exits), a conversion of USDT up to its asks' £300.
  for (const now of [U, Date.parse("2030-01-01T00:00:00Z")]) {
    for (const side of ["bid", "ask"] as const) for (const k of I.rungs) {
      assertEquals([Now.rungGbpOf(I, 600, "USDT-GBP", side, k, now), Now.rungGbpOf(I, 600, "USDC-GBP", side, k, now)], [100, 0]);
      assertEquals([Now.weightRetired(I, now, "USDT-GBP", side, k), Now.weightRetired(I, now, "USDC-GBP", side, k)], [false, true]);
    }
    assertEquals([Now.convertCapGbp(I, 600, "USDT-GBP", now), Now.convertCapGbp(I, 600, "USDC-GBP", now)], [300, 0]);
  }
  // Before the instant the line is the venue's minimum, as the frozen executor's; from it, £1 of coin at the price.
  assertEquals(Now.holdLineBase(I, Now.QUOTE_LIVE_HOLD_MIN_FROM - 1, 0.1337, 0.748), 0.1337);
  assertEquals(Now.holdLineBase(I, Now.QUOTE_LIVE_HOLD_MIN_FROM, 0.1337, 0.748), 1 / 0.748);
  assertEquals(Now.holdLineBase(I, Date.parse("2030-01-01T00:00:00Z"), 0.1337, 0.748), 1 / 0.748);
});

Deno.test("PR5-OPT's weights size each rung by its weight's share and retire a rung of weight 0; the conversion cap is the book's asks", () => {
  const usdt2 = { ...Now.QUOTE_LIVE_INSTANCE, weights: { from: 0, book: { "USDC-GBP": 1, "USDT-GBP": 2 } } };
  const no03 = { ...Now.QUOTE_LIVE_INSTANCE, weights: { from: 0, k: { "0.001": 1, "0.002": 1, "0.003": 0 } } };
  const r = (x: number) => Math.round(x * 1e8) / 1e8;
  assertEquals([r(Now.rungGbpOf(usdt2, 600, "USDT-GBP", "bid", 0.001, 1)), r(Now.rungGbpOf(usdt2, 600, "USDC-GBP", "ask", 0.003, 1))], [66.66, 33.33]);
  assertEquals([r(Now.convertCapGbp(usdt2, 600, "USDT-GBP", 1)), r(Now.convertCapGbp(usdt2, 600, "USDC-GBP", 1))], [199.98, 99.99]);
  assertEquals([Now.rungGbpOf(no03, 600, "USDC-GBP", "bid", 0.001, 1), Now.rungGbpOf(no03, 600, "USDT-GBP", "ask", 0.003, 1)], [75, 0]);
  assertEquals([Now.weightRetired(no03, 1, "USDT-GBP", "ask", 0.003), Now.weightRetired(no03, 1, "USDT-GBP", "ask", 0.002)], [true, false]);
  assertEquals(Now.convertCapGbp(no03, 600, "USDC-GBP", 1), 150);
  // Before the instant, the rule's: £50 a rung, a quarter of the capital.
  const later = { ...usdt2, weights: { ...usdt2.weights, from: 10 } };
  assertEquals([Now.rungGbpOf(later, 600, "USDT-GBP", "bid", 0.001, 9), Now.convertCapGbp(later, 600, "USDT-GBP", 9)], [50, 150]);
});

Deno.test("PR5-OPT's weights through the executor: USDT-GBP's entries twice USDC-GBP's, and no 0.3 % entry where its weight is 0", async () => {
  const entries = async (instance: Now.QuoteLiveInstance) => {
    const w = world(Now, instance);
    w.sim.st.balances.USDC = 60; w.sim.st.balances.USDT = 60;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    for (let t = T0; t < T0 + 3 * M; t += M) {
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: [] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    return Object.fromEntries((w.mem.tables.agent_quote_live_orders as Row[]).filter((o) => o.leg === "entry")
      .map((o) => [`${o.book} ${o.rung_side} ${o.k}`, Math.round(Number(o.base_size) * Number(o.price) * 100) / 100]));
  };
  const usdt2 = await entries({ ...Now.QUOTE_LIVE_INSTANCE, weights: { from: T0, book: { "USDC-GBP": 1, "USDT-GBP": 2 } } });
  // £120: USDT-GBP's rungs £13.33, USDC-GBP's £6.66 (a third of £20, floored to the penny), each in coin floored to the step (a sell one step up to its penny).
  for (const [key, gbp] of Object.entries(usdt2)) assert(Math.abs(gbp - (key.startsWith("USDT") ? 13.33 : 6.66)) <= 0.01, `${key}: £${gbp}`);
  assertEquals(Object.keys(usdt2).length, 12);
  const no03 = await entries({ ...Now.QUOTE_LIVE_INSTANCE, weights: { from: T0, k: { "0.003": 0 } } });
  assertEquals(Object.keys(no03).filter((k) => k.endsWith(" 0.003")), []);
  for (const [key, gbp] of Object.entries(no03)) assert(Math.abs(gbp - 15) <= 0.01, `${key}: £${gbp}`);
  assertEquals(Object.keys(no03).length, 8);
});

// "Stablecoin quotes USDC/GBP" on Revolut X (0180; docs/agents/reviews/2026-10-29-rx-usdc-live.md): RX-USDC's rules on its own
// tables, lease and governed key: USDC-GBP alone, the 0.3 % rungs quoting nothing (£30 on each 0.1 % and 0.2 % rung at £120),
// every exit a tick beyond fair, LIVE's £1 line and weekend replica; its asks' first coin bought by top-ups of up to £65 a day.
Deno.test("the USDC/GBP executor's instance: USDC-GBP's 0.1 % and 0.2 % rungs at £30 of £120, exits a tick beyond fair, its own tables, top-ups to £65 a day", () => {
  const R = Now.QUOTE_RXU_INSTANCE, L = Now.QUOTE_LIVE_INSTANCE;
  assertEquals([R.config, R.orders, R.events, R.state, R.lease, R.paper, R.migration], ["agent_quote_rxu_config", "agent_quote_rxu_orders", "agent_quote_rxu_events", "agent_quote_rxu_state", "quotes-live-rxu", L.paper, "0180"]);
  for (const k of ["config", "orders", "events", "state", "lease"] as const) assert(R[k] !== L[k], k);
  const now = Date.parse("2026-10-30T12:00:00Z");
  const gbp = (b: QuoteBook, s: "bid" | "ask", k: number) => Now.rungGbpOf(R, 120, b, s, k, now);
  for (const s of ["bid", "ask"] as const) {
    assertEquals([gbp("USDC-GBP", s, 0.001), gbp("USDC-GBP", s, 0.002), gbp("USDC-GBP", s, 0.003), gbp("USDT-GBP", s, 0.001)], [30, 30, 0, 0]);
    assertEquals([Now.weightRetired(R, now, "USDC-GBP", s, 0.003), Now.weightRetired(R, now, "USDT-GBP", s, 0.001), Now.weightRetired(R, now, "USDC-GBP", s, 0.001)], [true, true, false]);
  }
  assertEquals([R.exitOffset, R.holdMin, R.topUps, R.liveSwitches, R.convertRepeg, R.fairNudge], [{ ticks: 1, from: 0 }, { from: 0, gbp: 1 }, { maxGbpDay: 65 }, L.liveSwitches, undefined, undefined]);
  // No rebook (its weights are from before the rebook's instant): the top-ups' own day is the instance's £65.
  assertEquals(Now.rebookOn(R, now), false);
});
Deno.test("the USDC/GBP executor through the simulated account: from pounds alone it quotes USDC-GBP's two inner rungs a side, and buys its asks' coin by one maker top-up past £5", async () => {
  const L = Now.QUOTE_LIVE_INSTANCE;
  const inst = { ...Now.QUOTE_RXU_INSTANCE, config: L.config, orders: L.orders, events: L.events, state: L.state, lease: L.lease };
  const w = world(Now, inst);
  w.sim.st.balances.USDC = 0;
  const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
  for (let t = T0; t < T0 + 3 * M; t += M) {
    for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: [] });
    await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
    await w.turn(t + M + 30e3);
  }
  const orders = w.mem.tables.agent_quote_live_orders as Row[];
  const entries = orders.filter((o) => o.leg === "entry");
  assertEquals([...new Set(entries.map((o) => `${o.book} ${o.rung_side} ${Number(o.k)}`))].sort(), ["USDC-GBP bid 0.001", "USDC-GBP bid 0.002"]);
  for (const o of entries) assert(Math.abs(Number(o.base_size) * Number(o.price) - 30) <= 0.01, JSON.stringify(o));
  const conv = orders.filter((o) => o.leg === "convert");
  assertEquals(conv.map((o) => [o.book, o.side, (o.request as Record<string, unknown>).postOnly, (o.request as Record<string, unknown>).auto]), [["USDC-GBP", "buy", true, true]]);
  const gbp = Number(conv[0].base_size) * Number(conv[0].price);
  assert(gbp > Now.QUOTE_LIVE_TOPUP_MAX_GBP_DAY && gbp <= 65, `£${gbp}`);
});

// The venue's balances for the LIVE page (Davies, 2026-10-29 22:20, "revolut也一样"): each turn that read them saves the
// account's available and on-hold amounts of GBP, USDC and USDT as the venue gave them, `{ at, ccy: { CODE: { available, hold } } }`.
Deno.test("each turn saves the venue's balances, available and on hold, for the LIVE page: GBP, USDC and USDT as the venue gave them", async () => {
  const w = world(Now);
  w.sim.st.balances.USDC = 40;
  const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
  for (let t = T0; t < T0 + 2 * M; t += M) {
    for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: [] });
    await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
    await w.turn(t + M + 30e3);
  }
  const st = (w.mem.tables.agent_quote_live_state as Row[])[0].state as { venueBalances?: { at: string; ccy: Record<string, { available: number; hold: number }> }; balances?: Record<string, number> };
  const vb = st.venueBalances!;
  assertEquals([vb.at, Object.keys(vb.ccy).sort()], [iso(T0 + 2 * M + 30e3), ["GBP", "USDC"]]);
  for (const c of ["GBP", "USDC"]) {
    assertEquals(Object.keys(vb.ccy[c]).sort(), ["available", "hold"]);
    // available + on hold is the total the turn's coin book reads (`balances`, unchanged).
    assertAlmostEquals(vb.ccy[c].available + vb.ccy[c].hold, st.balances![c], 1e-9);
  }
  assert(vb.ccy.GBP.hold > 0, JSON.stringify(vb));   // the bids rest on the account's pounds
  assertEquals(Now.venueBalancesOf("t", null), null);
  assertEquals(Now.venueBalancesOf("t", { GBP: { available: 1, hold: 2 }, BTC: { available: 3, hold: 0 }, USDT: { available: NaN, hold: 0 } }), { at: "t", ccy: { GBP: { available: 1, hold: 2 } } });
});

// The coin rebook (`rebookOn`; Davies, 2026-10-29: "换币也用挂单不要有转换损失"): weights that come into force at the rebook's
// instant or later sell the book's surplus coin by a post-only order at the top of the asks, never under fair, and top up the
// book that is short with no £5 cap; weights from before the rebook's instant (PR5-OPT's twins) do neither.
Deno.test("the coin rebook through the executor: USDC sold post-only at or over fair, USDT bought past the £5 cap, USDC quoting no entry; none before its instant", async () => {
  const run = async (instance: Now.QuoteLiveInstance, minutes = 4) => {
    const w = world(Now, instance);
    w.sim.st.balances.USDC = 60; w.sim.st.balances.USDT = 0;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    for (let t = T0; t < T0 + minutes * M; t += M) {
      const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
      // A buyer of 100 USDC well over fair at minute 2: it fills a resting sale.
      if (t === T0 + 2 * M) prints["USDC-GBP"].push({ id: "buyer", ts: t + 20e3, ticks: 7570, qty: 100, side: "buy" });
      for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) w.print(bk, p);
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: prints[bk] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    const orders = w.mem.tables.agent_quote_live_orders as Row[];
    return {
      drains: orders.filter((o) => o.leg === "convert" && o.side === "sell"),
      topUps: orders.filter((o) => o.leg === "convert" && o.side === "buy"),
      usdcEntries: orders.filter((o) => o.leg === "entry" && o.book === "USDC-GBP"),
      balances: w.sim.st.balances,
    };
  };
  const weights = { from: T0, book: { "USDC-GBP": 0, "USDT-GBP": 1 } };
  const on = await run({ ...Now.QUOTE_LIVE_INSTANCE, weights, rebook: { since: T0 } });
  const fair = 1 / 1.3238;
  assert(on.drains.length >= 1, JSON.stringify(on.drains));
  for (const o of on.drains) {
    const req = o.request as Record<string, unknown>;
    assertEquals([o.book, req.auto, req.drain, req.postOnly, req.marketable], ["USDC-GBP", true, true, true, false]);
    assert(Math.round(Number(o.price) / 1e-4) >= Math.ceil(fair / 1e-4 - 1e-9), `sold under fair: ${o.price}`);
  }
  // Its asks need none of it: every USDC the account holds is surplus, and the first sale offers all 60.
  assertEquals(Number(on.drains[0].base_size), 60);
  // The buyer at 0.7570 filled it: no USDC left, its pounds credited.
  assert(Number(on.drains[0].filled_base) > 0, JSON.stringify(on.drains[0]));
  assert(on.balances.USDC < 1e-9, JSON.stringify(on.balances));
  // USDT-GBP's asks, £20 each at £120, need about 79 USDT: one top-up buys it, far past the £5 a day.
  assert(on.topUps.length >= 1 && Number(on.topUps[0].base_size) * Number(on.topUps[0].price) > Now.QUOTE_LIVE_TOPUP_MAX_GBP_DAY, JSON.stringify(on.topUps));
  assertEquals(on.usdcEntries, []);
  // Weights from before the rebook's instant (the default instant, after these hours): no sale, top-ups capped at £5 a day.
  const off = await run({ ...Now.QUOTE_LIVE_INSTANCE, weights });
  assertEquals(off.drains, []);
  for (const o of off.topUps) assert(Number(o.base_size) * Number(o.price) <= Now.QUOTE_LIVE_TOPUP_MAX_GBP_DAY + 0.01, JSON.stringify(o));
  assertEquals(off.usdcEntries, []);
  // The rebook ends QUOTE_LIVE_REBOOK_MS after the weights' instant.
  const I = { ...Now.QUOTE_LIVE_INSTANCE, weights, rebook: { since: T0 } };
  assertEquals([Now.rebookOn(I, T0 - 1), Now.rebookOn(I, T0), Now.rebookOn(I, T0 + Now.QUOTE_LIVE_REBOOK_MS - 1), Now.rebookOn(I, T0 + Now.QUOTE_LIVE_REBOOK_MS)], [false, true, true, false]);
});

Deno.test("PR5-OPT's holding line through the executor: a £0.10 nibble leaves the rung unheld (no exit, its coin carried); the next fill takes it over and the exit buys back the whole", async () => {
  // A buyer of 0.135 USDC through USDC's 0.1 % ask (7562) at minute 4 nibbles it (£0.102). Without a line the rung is held and
  // buys its 0.135 back at fair (the F1 test above). With a £1 line it is not: no exit; the paper rung, filled by the same print,
  // holds the entry back until its own exit at fair fills (a seller at 7553, minute 6), and then the rung quotes again; a buyer
  // of 20 at minute 9 fills it, the holding passes £1, and one exit buys back everything, the nibble's 0.135 with it.
  const run = async (instance?: Now.QuoteLiveInstance) => {
    const w = world(Now, instance);
    w.sim.st.balances.USDC = 40;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    for (let t = T0; t < T0 + 13 * M; t += M) {
      const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
      if (t === T0 + 4 * M) prints["USDC-GBP"].push({ id: "dust", ts: t + 10e3, ticks: 7563, qty: 0.135, side: "buy" });
      if (t === T0 + 6 * M) prints["USDC-GBP"].push({ id: "under", ts: t + 10e3, ticks: 7553, qty: 0.5, side: "sell" });
      if (t === T0 + 9 * M) prints["USDC-GBP"].push({ id: "big", ts: t + 40e3, ticks: 7563, qty: 20, side: "buy" });
      for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) w.print(bk, p);
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: prints[bk] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    return (w.mem.tables.agent_quote_live_orders as Row[]).filter((o) => o.book === "USDC-GBP" && o.rung_side === "ask" && Number(o.k) === 0.001)
      .map((o) => `${o.leg} ${Math.round(Number(o.price) / 1e-4)} ${o.state} ${Number(o.filled_base)}/${Number(o.base_size)}`);
  };
  const line = await run({ ...Now.QUOTE_LIVE_INSTANCE, holdMin: { from: T0, gbp: 1 } });
  const none = await run(), later = await run({ ...Now.QUOTE_LIVE_INSTANCE, holdMin: { from: T0 + 60 * M, gbp: 1 } });
  assertEquals(later, none);
  // Without the line: the nibble is held and bought back at fair at once.
  assertEquals(none, ["entry 7562 filled 0.135/13.22402", "exit 7554 new 0/0.14561"]);
  // With it: no exit for the nibble alone, and the entry, re-placed once the paper rung quotes again, is the same order of
  // 13.22402 (a fresh POST at the same price after the paper's exit). The big buyer fills it; the holding, 0.135 + 13.22402 =
  // 13.35902, passes £1 and one exit buys it back at fair, trimmed to the penny as every exit is (`pennyExit`: 13.35716).
  assertEquals(line, ["entry 7562 filled 0.135/13.22402", "entry 7562 filled 13.22402/13.22402", "exit 7554 new 0/13.35716"]);
});

/**
 * The six hours, `instance` on today's executor against the frozen file, or with `against` against today's executor on
 * that instance instead. `operator: false` leaves the operator out (no `quotes-convert`): the asks' coin comes from the
 * executor's own top-ups alone.
 */
async function sixHours(instance?: Now.QuoteLiveInstance, o: { against?: Now.QuoteLiveInstance; operator?: boolean } = {}): Promise<void> {
  await sixHoursSeen(instance, o);
}
/** The six hours (`sixHours`), returning what they went through. */
/**
 * `untilExitCrosses`: compare turn by turn only until the first turn at which the executor `against` (the frozen one, or the
 * same instance with exits not meeting the book) records an exit refused for crossing the book; at that turn, check that
 * `instance` rests that exit inside the book instead (`request.ruleTicks` the refused exit's price), and stop, returning
 * how many turns were equal (`equalTurns`) and the exits it compared (`crossed`).
 */
async function sixHoursSeen(instance?: Now.QuoteLiveInstance, o: { against?: Now.QuoteLiveInstance; operator?: boolean; untilExitCrosses?: boolean } = {}) {
  const operator = o.operator !== false;
  const a = world(Now, instance), b = o.against ? world(Now, o.against) : world(Frozen);
  const both = async <T>(f: (w: ReturnType<typeof world>) => Promise<T>): Promise<[T, T]> => [await f(a), await f(b)];
  // An old long on USDT's 0.2 % bid, bought a day and a minute before the start: its 24-hour stop goes at the first turn.
  for (const w of [a, b]) {
    await w.mem.db.insert("agent_quote_live_orders", { mode: "live", book: "USDT-GBP", rung_side: "bid", k: 0.002, leg: "entry", side: "buy", price: 0.7538, base_size: 13.26, filled_base: 13.26,
      avg_fill_price: 0.7538, client_order_id: "00000000-0000-4000-9000-000000000001", state: "filled", ts: iso(T0 - 24 * H - M), filled_at: iso(T0 - 24 * H - M) }, true);
    w.sim.st.balances.USDT = 13.26;
  }
  // The day's POSTs from elsewhere, written half an hour before the end: the governor closes the entries.
  const fillers = async (w: ReturnType<typeof world>, at: number) => {
    for (let i = 0; i < Now.QUOTE_LIVE_ENTRY_POSTS; i++) {
      await w.mem.db.insert("agent_quote_live_orders", { mode: "live", book: "USDT-GBP", rung_side: "ask", k: 0.003, leg: "entry", side: "sell", price: 0.76, base_size: 1,
        client_order_id: `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`, state: "rejected", ts: iso(at) }, true);
    }
  };
  // PR5's engine, once for both: its state each minute is what both executors read.
  const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
  const r = rng(20261002);
  let seq = 0;
  const seen = { fills: 0, partial: 0, exits: 0, reprices: 0, refusals: 0, stops: 0, topups: 0, makerConv: 0, takerConv: 0, stale: 0, depeg: 0, governor: 0, paused: 0, unarmed: 0, repegs: 0, insides: 0, equalTurns: 0, crossed: [] as string[] };
  for (let t = T0; t < T0 + HOURS * H; t += M) {
    // The minute's prints: a seller under fair and a buyer over it, now and then, of random size, at random depth.
    const fair = 1 / (fxAtMinute(t) ?? 1.3238);
    const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
    for (const bk of QUOTE_BOOKS) {
      for (let i = 0; i < 2; i++) {
        if (r() < 0.35) continue;
        const side = r() < 0.5 ? "sell" : "buy";
        const off = Math.ceil(r() * 32);
        const ticks = Math.round(fair / 1e-4) + (side === "sell" ? -off : off);
        prints[bk].push({ id: `p${String(++seq).padStart(6, "0")}`, ts: t + Math.floor(r() * 59e3) + 500, ticks, qty: Math.round(r() * 1500) / 10 + 1, side });
      }
      prints[bk].sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
    }
    // The prints reach both accounts in time order, before the executors' turn at :30 of the next minute.
    for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) { a.print(bk, p); b.print(bk, p); }
    for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: fxAtMinute(t), fairU: 1.0, prints: prints[bk] });
    for (const w of [a, b]) {
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
    }
    const at = t + M + 30e3;
    const h = (t - T0) / H;
    // The operator: maker conversions at the start, a taker one later; a pause and a stretch unarmed.
    if (t === T0 && operator) {
      const [ca, cb] = await both((w) => w.convert(at - 5e3, { book: "USDT-GBP", gbp: 20, send: true }));
      assertEquals(ca, cb);
      if ((ca as Row).sent) seen.makerConv++;
    }
    if (t === T0 + 5 * H && operator) {
      const [ca, cb] = await both((w) => w.convert(at - 5e3, { book: "USDC-GBP", gbp: 15, send: true, taker: true }));
      assertEquals(ca, cb);
      if ((ca as Row).sent) seen.takerConv++;
    }
    if (t === T0 + 5.5 * H) { await fillers(a, t); await fillers(b, t); }
    if (h >= 3.5 && h < 3.6) { for (const w of [a, b]) (w.mem.tables.agent_risk as Row[])[0].global_pause = true; seen.paused++; }
    else for (const w of [a, b]) (w.mem.tables.agent_risk as Row[])[0].global_pause = false;
    if (h >= 4.5 && h < 4.75) { for (const w of [a, b]) (w.mem.tables.agent_quote_live_config as Row[])[0].live_confirmed_at = null; seen.unarmed++; }
    else for (const w of [a, b]) (w.mem.tables.agent_quote_live_config as Row[])[0].live_confirmed_at = iso(T0 - H);
    const [ra, rb] = await both((w) => w.turn(at));
    if (o.untilExitCrosses) {
      const refused = (b.mem.tables.agent_quote_live_orders as Row[]).filter((x) => x.leg === "exit" && (x.response as Row | null)?.wouldBeRefused === true);
      if (refused.length) {
        const inside = (a.mem.tables.agent_quote_live_orders as Row[]).filter((x) => x.leg === "exit" && (x.request as Row | null)?.ruleTicks != null);
        const tk = (x: Row) => Math.round(Number(x.price) / 1e-4);
        assertEquals(inside.map((x) => [x.book, x.rung_side, Number(x.k), (x.request as Row).ruleTicks]), refused.map((x) => [x.book, x.rung_side, Number(x.k), tk(x)]));
        for (const [i, x] of inside.entries()) assert(x.side === "buy" ? tk(x) < tk(refused[i]) : tk(x) > tk(refused[i]), `inside is better: ${tk(x)} vs ${tk(refused[i])}`);
        seen.equalTurns = Math.round((t - T0) / M);
        seen.crossed = refused.map((x) => `${x.book} ${x.rung_side} ${Number(x.k)} ${x.side} rule ${tk(x)} → ${tk(inside[refused.indexOf(x)])}`);
        return seen;
      }
    }
    assertEquals(ra, rb, `the reports of the turn at ${iso(at)}`);
    assertEquals(a.snapshot(), b.snapshot(), `the tables and the account after the turn at ${iso(at)}`);
    if (Object.values(ra.guards).some((g) => g.some((x) => /stale|dark|old/i.test(x)))) seen.stale++;
    if (Object.values(ra.guards).some((g) => g.some((x) => /de-peg|depeg|bps from fair|from the last/i.test(x)))) seen.depeg++;
    if (ra.posts.live >= Now.QUOTE_LIVE_ENTRY_POSTS) seen.governor++;
  }
  const orders = a.mem.tables.agent_quote_live_orders as Row[];
  seen.fills = orders.filter((o) => o.leg === "entry" && Number(o.filled_base) > 0).length;
  seen.partial = orders.filter((o) => Number(o.filled_base) > 0 && Number(o.filled_base) < Number(o.base_size)).length;
  seen.exits = orders.filter((o) => o.leg === "exit" && Number(o.filled_base) > 0).length;
  seen.reprices = orders.filter((o) => o.state === "cancelled" && /re-?pric|moved|fair/i.test(String(o.cancel_reason ?? ""))).length;
  seen.refusals = orders.filter((o) => o.state === "rejected").length;
  seen.stops = orders.filter((o) => o.leg === "stop").length;
  seen.topups = orders.filter((o) => o.leg === "convert" && (o.request as Row)?.auto === true).length;
  seen.repegs = orders.filter((o) => o.leg === "convert" && (o.request as Row)?.repegOf != null).length;
  seen.insides = orders.filter((o) => o.leg === "exit" && (o.request as Row)?.ruleTicks != null).length;
  // What the hours went through, or the equality above proves nothing (the operator's conversions only when there is one; a
  // conversion following the bid is counted, not required: `seen.repegs`).
  for (const [k, v] of Object.entries(seen)) {
    // Without the operator the asks hold only the account's starting coin, a shortfall past the top-ups' £5 a day: none goes out.
    if (typeof v !== "number" || k === "repegs" || k === "insides" || k === "equalTurns" || (!operator && (k === "makerConv" || k === "takerConv" || k === "topups"))) continue;
    assert(v > 0, `the simulated hours never reached ${k}: ${JSON.stringify(seen)}`);
  }
  return seen;
}

Deno.test("F1 through the executor and the simulated account: a £0.10 print nibbles an ask; the buy-back buys what its whole penny buys (the frozen executor paid it for nothing)", async () => {
  // The 2026-10-09 review's F1 end to end, on today's executor and on the frozen one, each against its own simulated
  // Revolut X account fed the same prints: a buyer of 0.135 USDC (£0.1021 at the 0.1 % ask, 0.7562) takes part of the
  // resting ask; the rung withdraws the rest of its entry and buys back its 0.135 at fair (0.7554), £0.1020: the trim to
  // £0.10 (0.13238) is under the venue's minimum. A seller under it fills the buy-back; the account is debited the notional
  // rounded up, £0.11, either way. The frozen executor sent 0.13500 (£0.0080 for nothing); today's sends 0.14561, what
  // 0.11 / 0.7554 = 0.145618… buys to the step (£0.109993794), and the 0.01061 over the holding stays in the account.
  const results: Array<{ exit: Row; usdc: number; gbp: number }> = [];
  for (const mod of [Now, Frozen] as Mod[]) {
    const w = world(mod);
    w.sim.st.balances.USDC = 40;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    let before: { usdc: number; gbp: number } | null = null;
    for (let t = T0; t < T0 + 12 * M; t += M) {
      const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
      if (t === T0 + 5 * M) prints["USDC-GBP"].push({ id: "dust", ts: t + 10e3, ticks: 7563, qty: 0.135, side: "buy" });
      if (t === T0 + 9 * M) prints["USDC-GBP"].push({ id: "under", ts: t + 10e3, ticks: 7553, qty: 5, side: "sell" });
      if (t === T0 + 9 * M) before = { usdc: w.sim.st.balances.USDC, gbp: w.sim.st.balances.GBP };
      for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) w.print(bk, p);
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: prints[bk] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    const orders = w.mem.tables.agent_quote_live_orders as Row[];
    const mine = orders.filter((o) => o.book === "USDC-GBP" && o.rung_side === "ask" && Number(o.k) === 0.001);
    const entry = mine.find((o) => o.leg === "entry" && Number(o.filled_base) > 0)!;
    const exits = mine.filter((o) => o.leg === "exit");
    assertEquals([Number(entry.filled_base), Number(entry.price), exits.length], [0.135, 0.7562, 1]);
    assert(before);
    results.push({ exit: exits[0], usdc: w.sim.st.balances.USDC - before.usdc, gbp: Math.round((w.sim.st.balances.GBP - before.gbp) * 1e8) / 1e8 });
  }
  const [now, frozen] = results;
  // Both buy back at fair, 0.7554, filled whole by the seller's print, and both are debited £0.11.
  for (const r of results) assertEquals([Number(r.exit.price), r.exit.state, Number(r.exit.filled_base), r.gbp], [0.7554, "filled", Number(r.exit.base_size), -0.11]);
  assertEquals([Number(frozen.exit.base_size), Math.round(frozen.usdc * 1e5) / 1e5], [0.135, 0.135]);
  assertEquals([Number(now.exit.base_size), Math.round(now.usdc * 1e5) / 1e5], [0.14561, 0.14561]);
  // What the penny bought, at the exit's price: £0.1019790 frozen (£0.0080210 for nothing), £0.109993794 now.
  assertAlmostEquals(0.11 - 0.135 * 0.7554, 0.008021, 1e-12);
  assertAlmostEquals(0.11 - 0.14561 * 0.7554, 0.000006206, 1e-12);
});

Deno.test("a retired rung (rule D's twin's 0.03 %, from 2026-10-10): from its instant it quotes no entry and its resting one is withdrawn; its holding still exits; before it, the rule's", async () => {
  // The live account's three rungs, with 0.1 % retired from the seventh minute's turn. A seller fills USDC's 0.1 % bid
  // (7546) at minute 4; the ask's 0.1 % entry (7562) rests. From the retirement the ask's entry is withdrawn and no 0.1 %
  // entry goes out again; the long's exit, at fair rounded up (7555), still goes out and fills on a buyer at 7556.
  const run = async (instance?: Now.QuoteLiveInstance) => {
    const w = world(Now, instance);
    w.sim.st.balances.USDC = 40;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    for (let t = T0; t < T0 + 14 * M; t += M) {
      const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
      if (t === T0 + 4 * M) prints["USDC-GBP"].push({ id: "s1", ts: t + 10e3, ticks: 7545, qty: 20, side: "sell" }, { id: "f1", ts: t + 30e3, ticks: 7554, qty: 1, side: "sell" });
      if (t === T0 + 10 * M) prints["USDC-GBP"].push({ id: "b1", ts: t + 10e3, ticks: 7556, qty: 20, side: "buy" });
      for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) w.print(bk, p);
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: 1.3238, fairU: 1.0, prints: prints[bk] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    const orders = (w.mem.tables.agent_quote_live_orders as Row[]).filter((o) => o.book === "USDC-GBP" && Number(o.k) === 0.001);
    return orders.map((o) => `${o.rung_side} ${o.leg} ${Math.round(Number(o.price) / 1e-4)} ${o.state}${o.cancel_reason ? ` (${o.cancel_reason})` : ""}`);
  };
  const before = await run(), retiredLater = await run({ ...Now.QUOTE_LIVE_INSTANCE, retired: { ks: [0.001], from: T0 + 20 * M } });
  const retired = await run({ ...Now.QUOTE_LIVE_INSTANCE, retired: { ks: [0.001], from: T0 + 6 * M + 30e3 } });
  // Not yet retired: as the rule has it, and the same as no retirement at all.
  assertEquals(retiredLater, before);
  // The rule's: the bid fills, its exit sells at 7555 and fills, and the bid quotes again; the ask rests throughout.
  assertEquals(before, ["bid entry 7546 filled", "ask entry 7562 new", "bid exit 7555 filled", "bid entry 7546 new"]);
  // Retired: the ask's entry withdrawn for that reason, the exit still placed and filled, and no entry after it.
  assertEquals(retired, ["bid entry 7546 filled", "ask entry 7562 cancelled (the rung is retired: it quotes no entry (a holding still exits))", "bid exit 7555 filled"]);
});

Deno.test("p50x1's exitOffset: from its instant every exit, placed or re-priced, rests a tick beyond the rule's, in the position's favour; before it, and in the frozen file, at the rule's", async () => {
  // Fair 1 / 1.3238 = 0.755401…: a long's exit at fair rounded up, 7555 ticks, a short's at fair rounded down, 7554.
  // Long: a seller fills USDC's 0.1 % bid (7546) whole; GBP/USD then moves to 1.3230 (fair 0.755858…, 6 bps, past the
  // 0.05 % re-price step) and the exit is re-priced to 7559. Short: a buyer fills its 0.1 % ask (7562); GBP/USD moves to
  // 1.3246 (fair 0.754945…) and the buy-back goes to 7549. A small seller at 7554 after the fill leaves the touch the last
  // print implies (bid 7554, ask 7555) where no exit crosses it, and no print goes through an exit. With a tick's offset:
  // 7556 then 7560, and 7553 then 7548.
  const exitsOf = async (side: "bid" | "ask", mod: Mod, instance?: Now.QuoteLiveInstance) => {
    const w = world(mod, instance);
    w.sim.st.balances.USDC = 40;
    const books = Object.fromEntries(QUOTE_BOOKS.map((bk) => [bk, newBookState(bk, { id: "seed", ts: T0 - 30e3, ticks: bk === "USDC-GBP" ? 7553 : 7551, qty: 10, side: "sell" })])) as Record<QuoteBook, BookState>;
    const moved = T0 + 8 * M, x1 = side === "bid" ? 1.3230 : 1.3246;
    for (const r of w.mem.tables.agent_quote_inputs as Row[]) if (r.kind === "fx" && Date.parse(String(r.t)) >= moved) r.value = x1;
    for (let t = T0; t < T0 + 12 * M; t += M) {
      const prints: Record<QuoteBook, Print[]> = { "USDC-GBP": [], "USDT-GBP": [] };
      if (t === T0 + 4 * M) {
        prints["USDC-GBP"].push(side === "bid" ? { id: "s1", ts: t + 10e3, ticks: 7545, qty: 20, side: "sell" } : { id: "b1", ts: t + 10e3, ticks: 7564, qty: 20, side: "buy" });
        prints["USDC-GBP"].push({ id: "f1", ts: t + 30e3, ticks: 7554, qty: 1, side: "sell" });
      }
      for (const bk of QUOTE_BOOKS) for (const p of prints[bk]) w.print(bk, p);
      for (const bk of QUOTE_BOOKS) stepMinute(books[bk], t, { x: t >= moved ? x1 : 1.3238, fairU: 1.0, prints: prints[bk] });
      await w.mem.db.upsert("agent_quote_state", [{ id: 1, state: { lastMinute: t, books: JSON.parse(JSON.stringify(books)), fetchedTo: {}, hourFetchedFor: 0 }, last_minute: iso(t), updated_at: iso(t), last_error: null }], "id");
      await w.turn(t + M + 30e3);
    }
    const orders = w.mem.tables.agent_quote_live_orders as Row[];
    const fills = orders.filter((o) => o.leg === "entry" && Number(o.filled_base) > 0).map((o) => `${o.book} ${o.rung_side} ${o.k} ${o.price}`);
    assertEquals(fills, [side === "bid" ? "USDC-GBP bid 0.001 0.7546" : "USDC-GBP ask 0.001 0.7562"]);
    return orders.filter((o) => o.leg === "exit").map((o) => `${o.rung_side} ${Math.round(Number(o.price) / 1e-4)} ${o.state}`);
  };
  const off = (ticks: number, from: number) => ({ ...Now.QUOTE_LIVE_INSTANCE, exitOffset: { ticks, from } });
  for (const [side, rule, one, two] of [
    ["bid", ["bid 7555 cancelled", "bid 7559 new"], ["bid 7556 cancelled", "bid 7560 new"], ["bid 7557 cancelled", "bid 7561 new"]],
    ["ask", ["ask 7554 cancelled", "ask 7549 new"], ["ask 7553 cancelled", "ask 7548 new"], ["ask 7552 cancelled", "ask 7547 new"]],
  ] as const) {
    assertEquals(await exitsOf(side, Frozen), [...rule], `${side}: the frozen executor`);
    assertEquals(await exitsOf(side, Now), [...rule], `${side}: today's, no offset`);
    assertEquals(await exitsOf(side, Now, off(1, T0 + 20 * M)), [...rule], `${side}: an offset whose instant has not come`);
    assertEquals(await exitsOf(side, Now, off(1, T0)), [...one], `${side}: a tick`);
    assertEquals(await exitsOf(side, Now, off(2, T0)), [...two], `${side}: two ticks`);
  }
});
