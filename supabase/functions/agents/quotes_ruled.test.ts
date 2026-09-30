// Rule D's paper instance (`quotes_ruled.ts`, pre-registration 2026-09-28). The band and the deviation arm are closed
// form. The driver is pinned on the in-memory database: both arms decide on PR5's stored X, so arm `d` differs from arm
// `v1` by rule D's band alone (deviation 2), no feed is read, and nothing of PR5V's tables is written.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Db } from "./db.ts";
import { QUOTE_BOOKS, quoteTicks, type QuoteBook } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";
import {
  newGovCounts, newVariantBook, stepVariantMinute, VARIANT_ARMS, VARIANT_CODE_VERSION, VARIANT_START,
  type VariantArm, type VariantEvent,
} from "./quotes_variant.ts";
import { newRuledState, RULED_ARMS, RULED_CODE_VERSION, runQuotesRuled, ruleDEntryBand, type RuledState } from "./quotes_ruled.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("rule D re-prices the inner rung on a 0.05 % move and leaves the outer rung, and no band re-prices both", () => {
  assertEquals(ruleDEntryBand(0.0003), 0.0003);
  assertEquals(ruleDEntryBand(0.003), 0.001);
  const plain: VariantArm = { name: "plain", rungs: [0.0003, 0.003], reprice: 0.0003, sizeUsd: 100, volumeShare: 0.1, entryAt: 600, stopAt: 700 };
  const ruled: VariantArm = { ...plain, name: "d", entryBand: ruleDEntryBand };
  const ks = (arm: VariantArm) => {
    const s = newVariantBook("USDC-GBP", arm, null), gov = newGovCounts();
    stepVariantMinute(s, 0, { x: 1, fairU: 1, prints: [] }, arm, gov);
    const out = stepVariantMinute(s, M, { x: 1, fairU: 1.0005, prints: [] }, arm, gov);
    return [...new Set(out.events.filter((e) => e.what === "reprice").map((e) => e.k))].sort((a, b) => a - b);
  };
  // 0.05 % clears 0.03 % and does not clear max(0.03 %, 0.30 % / 3) = 0.10 %.
  assertEquals(ks(plain), [0.0003, 0.003]);
  assertEquals(ks(ruled), [0.0003]);
});

Deno.test("arm v1 decides a minute exactly as PR5V's main, and PR5V's own arms still have no entry band", () => {
  // Both moved on 2026-09-30. PR5V re-decides once, because `entryBand` was added to its engine after it had decided
  // minutes (its deviation 1). Variant-2 read TrueFX after its turn (its deviation 1), then before it, and from code
  // version 3 reads PR5's stored X, as variant-1 does (its deviation 2).
  assertEquals(VARIANT_CODE_VERSION, 2);
  assertEquals(RULED_CODE_VERSION, 3);
  assertEquals(RULED_ARMS.v1.entryBand, undefined);
  assertEquals(RULED_ARMS.v1.rungs, VARIANT_ARMS.main.rungs);
  assertEquals([RULED_ARMS.d.reprice, RULED_ARMS.d.entryAt, RULED_ARMS.d.stopAt, RULED_ARMS.d.sizeUsd], [0.0003, 600, 700, 100]);
  const run = (arm: VariantArm) => {
    const s = newVariantBook("USDC-GBP", arm, null), gov = newGovCounts(), events: VariantEvent[] = [];
    for (let i = 0; i < 5; i++) events.push(...stepVariantMinute(s, i * M, { x: 1.3, fairU: 1 + i * 0.0002, prints: [] }, arm, gov).events);
    return events.map((e) => ({ ...e, arm: "v1" }));
  };
  assertEquals(run(RULED_ARMS.v1), run(VARIANT_ARMS.main));
  assertEquals(VARIANT_ARMS.main.entryBand, undefined);
});

const BOOKS = QUOTE_BOOKS;
const QUOTED = ["agent_quoted_state", "agent_quoted_minutes", "agent_quoted_events", "agent_quoted_trips"];
function world(over: Record<string, Row[]> = {}) {
  const minute = iso(VARIANT_START);
  const minutes = BOOKS.map((b) => ({ book: b, minute, x: 1.34, x_t: iso(VARIANT_START - M), fair_u: 1, hours_n: 24, prints_n: 0 }));
  return memDb({
    agent_locks: [{ name: "quotesd", lease_until: iso(0), holder: null }, { name: "quotesv", lease_until: iso(0), holder: null }],
    agent_quote_state: [{ id: 1, state: { books: "not read" }, last_minute: minute, updated_at: minute, last_error: null }],
    agent_quote_minutes: minutes, agent_quote_prints: [], agent_quote_inputs: [],
    agent_quotev_trips: [], agent_quotev_state: [], agent_quotev_minutes: [], agent_quotev_events: [],
    ...Object.fromEntries(QUOTED.map((t) => [t, []])),
    ...over,
  }, { now: () => Date.now() });
}

Deno.test("runQuotesRuled: arm d decides on PR5's stored X, as arm v1 does, reads no feed, and writes none of PR5V", async () => {
  // Two calls as production runs them: at START − 1 min + 1 s there is nothing new to decide, and at START + 2 min + 1 s
  // the call decides START, the minute PR5 decided at START + 1 min + 25 s. Code version 2 read TrueFX in the first call
  // and priced START's turn with it; now no feed is read at all, and both arms place on the same fair.
  const { db, tables } = world({
    agent_quote_state: [{ id: 1, state: { books: "not read" }, last_minute: iso(VARIANT_START - 3 * M), updated_at: iso(VARIANT_START), last_error: null }],
  });
  const writes: string[] = [];
  const spy: Db = {
    ...db,
    upsert: (t, rows, k) => { writes.push(`upsert ${t}`); return db.upsert(t, rows, k); },
    insert: (t, rows, ret) => { writes.push(`insert ${t}`); return db.insert(t, rows, ret); },
    update: (t, q, p) => { writes.push(`update ${t}`); return db.update(t, q, p); },
  };
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => { fetches++; return Promise.reject(new Error("no feed may be read")); }) as typeof fetch;
  try {
    const a = await runQuotesRuled({ db: spy, now: VARIANT_START - M + 1_000, holder: "h", clock: () => 0 });
    assertEquals([a.skipped, a.errors], ["no minute PR5 has decided is left to decide", []]);
    tables.agent_quote_state[0].last_minute = iso(VARIANT_START);
    const r = await runQuotesRuled({ db: spy, now: VARIANT_START + 2 * M + 1_000, holder: "h", clock: () => 0 });
    assertEquals([r.errors, r.minutes, r.checkMaxUsd, r.checkDays], [[], 1, 0, 0]);
  } finally {
    globalThis.fetch = realFetch;
  }
  assertEquals(fetches, 0);
  assertEquals(writes.filter((w) => w.includes("agent_quotev")), []);
  assertEquals(tables.agent_quoted_minutes.map((m) => [m.x, m.x_d, m.x_source, m.x_d_t ?? null, m.x_d_read ?? null]), [
    [1.34, 1.34, "yahoo", null, null], [1.34, 1.34, "yahoo", null, null],
  ]);
  const place = (arm: string, book: QuoteBook) => tables.agent_quoted_events.find((e) => e.arm === arm && e.book === book && e.side === "bid" && e.k === 0.0003 && e.what === "place")!;
  for (const b of BOOKS) assertEquals([place("d", b).ticks, place("v1", b).ticks], [quoteTicks(1 / 1.34, 0.0003, "bid"), quoteTicks(1 / 1.34, 0.0003, "bid")]);
  assertEquals(tables.agent_quotev_trips, []);
  const st = tables.agent_quoted_state[0].state as RuledState;
  assertEquals([st.codeVersion, st.lastMinute, st.checkMaxUsd, "truefx" in st], [RULED_CODE_VERSION, VARIANT_START, 0, false]);
});

Deno.test("the in-memory database refuses a TrueFX minute read at or after its turn, as 0073 does", async () => {
  const { db } = world();
  const row = (read: string | null) => ({
    book: "USDC-GBP", minute: iso(VARIANT_START), source: "minutes", x: 1.34, x_t: null, fair_u: 1, hours_n: 24, prints_n: 0, pr5_prints_n: 0,
    x_d: 1.4, x_source: "truefx", x_d_t: read, x_d_read: read,
  });
  for (const read of [null, iso(VARIANT_START), iso(VARIANT_START + 2 * M)]) {
    const err = await db.upsert("agent_quoted_minutes", [row(read)], "book,minute").then(() => null, (e) => String(e));
    assert(err?.includes("agent_quoted_minutes_truefx_before_turn_check"), `${read}: ${err}`);
  }
  await db.upsert("agent_quoted_minutes", [row(iso(VARIANT_START - 59e3))], "book,minute");
});

Deno.test("runQuotesRuled: a PR5V trip arm v1 lacks sets the deviation, and a failed read of it leaves the decisions", async () => {
  const trip = {
    id: 1, arm: "main", key: "USDC-GBP/bid", book: "USDC-GBP", side: "bid", k: 0.0003, t_entry: iso(VARIANT_START),
    fill_ts: iso(VARIANT_START), fill_print_id: "p", entry: 0.74, qty: 1, t_exit: iso(VARIANT_START + M), exit: 0.75,
    how: "maker", notional_usd: 100, pnl_usd: 1.25,
  };
  const hit = world({ agent_quotev_trips: [trip] });
  const a = await runQuotesRuled({ db: hit.db, now: VARIANT_START + 2 * M, holder: "h" });
  assertEquals([a.checkMaxUsd, a.checkDays], [1.25, 1]);
  assertEquals(hit.tables.agent_quotev_trips, [trip]);

  const miss = world({ agent_quotev_trips: [trip] });
  const spy: Db = { ...miss.db, selectAll: (t, q) => t === "agent_quotev_trips" ? Promise.reject(new Error("quotev down")) : miss.db.selectAll(t, q) };
  const b = await runQuotesRuled({ db: spy, now: VARIANT_START + 2 * M, holder: "h2" });
  assertEquals([b.errors, b.checkMaxUsd, miss.tables.agent_quoted_state[0].last_error], [[], null, null]);
  assert((miss.tables.agent_quoted_events as Row[]).length > 0);
  assertEquals(miss.tables.agent_quotev_trips, [trip]);
});

Deno.test("runQuotesRuled: another code version wipes only its own rows and starts flat", async () => {
  const { db, tables } = world({
    agent_quoted_state: [{ id: 1, state: { ...newRuledState(VARIANT_START, { "USDC-GBP": null, "USDT-GBP": null }), codeVersion: 0 }, last_minute: iso(VARIANT_START), updated_at: iso(VARIANT_START), last_error: null }],
    agent_quoted_events: [{ arm: "d", book: "USDC-GBP", minute: iso(VARIANT_START), side: "bid", k: 0.0003, kind: "order", what: "place", key: "USDC-GBP/bid", ticks: 1, detail: {} }],
    agent_quotev_trips: [{ id: 7, arm: "main", key: "USDC-GBP/bid", book: "USDC-GBP", side: "bid", k: 0.0003, t_entry: iso(VARIANT_START), fill_ts: iso(VARIANT_START), fill_print_id: "p", entry: 0.74, qty: 1, t_exit: iso(VARIANT_START), exit: 0.75, how: "maker", notional_usd: 100, pnl_usd: 0.5 }],
  });
  const r = await runQuotesRuled({ db, now: VARIANT_START + 10 * M, holder: "h" });
  assertEquals([r.reset, r.errors], [true, []]);
  assertEquals((tables.agent_quoted_state[0].state as RuledState).codeVersion, RULED_CODE_VERSION);
  assertEquals(tables.agent_quotev_trips.length, 1);
  assert(tables.agent_quoted_events.every((e) => e.minute === iso(VARIANT_START)));
});
