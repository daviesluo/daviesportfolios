// The realistic twins' driver (quotes_twin.ts) in a world built by hand: PR5's engine stepped by this test as its call
// steps it (its record of each minute, its events, the instant its call read the prints), a tape of public prints, and
// the twin's call a minute behind it. What is pinned: the operator's maker conversions at the twin's start, the asks
// waiting for their coin until a conversion has filled by the prints through it, the dead-man's cutoff, the operator's
// conversion sent again after a cancel, the replica equal to the engine, the orders sent each day, a backfill's load
// (its sha256 checked) and the record continuing from it as the twin's own would have — and that no turn reaches a
// network or writes a table that is not the twin's.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { printOrder } from "./quotes_variant.ts";
import { memDb, type Row } from "./testing.ts";
import {
  loadTwinBackfill, runQuotesTwins, specFromRow, stampTs, TWIN_IDS, TWIN_READS, TWIN_SPEC_ROWS, twinBackfillOf, twinSpecs, twinWrites, TWINS,
  type TwinBackfill, type TwinDeps, type TwinDriverState, type TwinSpec, type TwinSpecRow,
} from "./quotes_twin.ts";
import type { Db } from "./db.ts";
import { RULED_ARMS } from "./quotes_ruled.ts";
import { QUOTE_LIVE_INSTANCE, retiredAt } from "./quotes_live.ts";

const M = 60e3, H = 3600e3;
const T0 = Date.parse("2026-09-24T10:00:00Z");     // a Thursday, before PR5's beats and minute records: its call ran every minute
const X = 1.3238;                                   // GBP/USD; with the USD books at 1.0000, fair is 1 / X = 0.75540
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const SPEC: TwinSpec = { ...TWINS.pr5, start: T0 };
const ORDERS = SPEC.instance.orders;

/**
 * A world: PR5's record as its call leaves it, minute by minute, and the twins' call a minute behind it. `specs` are the
 * twins it may hold (their tables and leases); a call runs `specs` unless it names others.
 */
function world(seed?: Record<string, Row[]>, specs: TwinSpec[] = [SPEC]) {
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 30 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 30 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  // The last print before the start: a seller at 0.7553 on each book (the touch it implies: bid 0.7553, ask 0.7554).
  const seedPrint = (book: QuoteBook): Row => ({ id: `s-${book}`, book, ts: iso(T0 - 30e3), price: 0.7553, qty: 10, side: "sell" });
  const mem = memDb(seed ?? {
    agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, ...specs.map((s) => ({ name: s.instance.lease, lease_until: iso(0), holder: null }))],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_state: [], agent_quote_minutes: [], agent_quote_prints: QUOTE_BOOKS.map(seedPrint), agent_quote_inputs: inputs, agent_quote_events: [],
    agent_quoted_state: [], agent_quoted_events: [], edge_call_beats: [],
  }, { now: () => clock.now });
  // PR5's engine, as its call steps it: the same `stepMinute`, from the last print before the start.
  const seedOf = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seedOf(b))])) as Record<QuoteBook, BookState>;
  // The twins may touch their own tables, their leases, and read PR5's record and the risk row; nothing else.
  const allowed = new Set([...specs.flatMap(twinWrites), "agent_locks", ...TWIN_READS]);
  const readOnly = new Set(TWIN_READS);
  const touched = new Set<string>();
  const guard = (method: string, t: string, q = "") => {
    if (!allowed.has(t)) throw new Error(`the twin touched ${t} (${method})`);
    if (readOnly.has(t) && method !== "select") throw new Error(`the twin wrote ${t} (${method})`);
    if (t === "agent_locks" && method !== "select" && !(q.includes("name=eq.quotes-twins") || specs.some((s) => q.includes(`name=eq.${s.instance.lease}`)))) throw new Error(`the twin took a lease not its own: ${q}`);
    touched.add(t);
  };
  const db: Db = {
    select: (t, q) => { guard("select", t, q); return mem.db.select(t, q); },
    selectAll: (t, q) => { guard("select", t, q); return mem.db.selectAll(t, q); },
    insert: (t, r, x) => { guard("insert", t); return mem.db.insert(t, r, x); },
    upsert: (t, r, k) => { guard("upsert", t); return mem.db.upsert(t, r, k); },
    update: (t, q, p) => { guard("update", t, q); return mem.db.update(t, q, p); },
    claim: (t, q, p) => { guard("claim", t, q); return mem.db.claim(t, q, p); },
  };
  let n = 0;
  const w = {
    mem, clock, db, touched,
    print(book: QuoteBook, ts: number, price: number, qty: number, side: "buy" | "sell") {
      (mem.tables.agent_quote_prints as Row[]).push({ id: `p${String(++n).padStart(5, "0")}`, book, ts: iso(ts), price, qty, side });
    },
    /** PR5's call in minute t + 1: it decides minute t on that minute's prints, records it, and has read the prints to :25. */
    async pr5(t: number) {
      for (const b of QUOTE_BOOKS) {
        const prints = (mem.tables.agent_quote_prints as Row[]).filter((p) => p.book === b && Date.parse(String(p.ts)) >= t && Date.parse(String(p.ts)) < t + M)
          .map((p): Print => ({ id: String(p.id), ts: Date.parse(String(p.ts)), ticks: Math.round(Number(p.price) / 1e-4), qty: Number(p.qty), side: p.side as Print["side"] })).sort(printOrder);
        const out = stepMinute(books[b], t, { x: X, fairU: 1.0, prints });
        (mem.tables.agent_quote_minutes as Row[]).push({ book: b, minute: iso(t), x: X, x_t: null, fair_u: 1.0, hours_n: 24, prints_n: prints.length, recorded_at: iso(t + M + 27e3) });
        const evs = out.events.map((e) => ({ book: e.book, minute: iso(e.minute), side: e.side, k: e.k, kind: e.kind, ticks: e.ticks, detail: e.detail }));
        if (evs.length) await mem.db.upsert("agent_quote_events", evs, "book,minute,side,k,kind");
      }
      const fetchedTo = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, t + M + 25e3]));
      await mem.db.upsert("agent_quote_state", [{ id: 1, state: { fetchedTo }, last_minute: iso(t), updated_at: iso(t + M + 27e3), last_error: null }], "id");
    },
    /** The twins' call in minute t + 1, 38 s in. */
    call(t: number, extra: Partial<TwinDeps> = {}, list: TwinSpec[] = specs) {
      clock.now = t + M + 38e3;
      return runQuotesTwins({ db, now: clock.now, holder: `h${clock.now}`, signingKey: KEY, clock: () => clock.now, ...extra }, list);
    },
    orders: (s: TwinSpec = SPEC) => (mem.tables[s.instance.orders] ?? []) as Row[],
    driver: (s: TwinSpec = SPEC) => ((mem.tables[s.sim] ?? [])[0]?.state ?? null) as TwinDriverState | null,
  };
  return w;
}

/** An order as both records must agree on it, without what is random or numbered by the database. */
const shape = (o: Row) => [o.ts, o.book, o.rung_side, o.k, o.leg, o.side, Number(o.price), Number(o.base_size), o.state, Number(o.filled_base), o.avg_fill_price == null ? null : Number(o.avg_fill_price), Number(o.fee_gbp)].join("|");

Deno.test("a twin: maker conversions at its start, asks waiting for their coin, the dead-man, the operator again, and nothing beyond its own tables", async () => {
  const real = globalThis.fetch;
  const net: string[] = [];
  globalThis.fetch = ((i: string | URL | Request) => { net.push(String(i)); return Promise.reject(new Error("no network")); }) as typeof fetch;
  try {
    const w = world();
    // Minute T0: PR5 decides its first minute; the twin starts.
    await w.pr5(T0);
    const r0 = await w.call(T0);
    assertEquals(r0.twins[0].errors, []);
    const convs = () => w.orders().filter((o) => o.leg === "convert");
    // The operator's conversions: a quarter of £1,200 into each coin, makers resting at the top of the bids (the seller's
    // 0.7553: the touch is a tick wide, so at the bid), two and one seconds before the first turn; £300 at 0.7553 is
    // 397.19316 coins, floored to the step.
    assertEquals(convs().map((o) => [o.ts, o.book, o.side, Number(o.price), o.base_size, o.state, (o.request as Row).postOnly]), [
      [iso(T0 + M + 23e3), "USDC-GBP", "buy", 0.7553, 397.19316, "new", true],
      [iso(T0 + M + 24e3), "USDT-GBP", "buy", 0.7553, 397.19316, "new", true],
    ]);
    // The first turn quotes the bids from the £600 the conversions leave; the asks have no coin to sell.
    const turn0 = r0.twins[0].lastTurnReport!;
    assertEquals(turn0.placed.filter((p) => p.leg === "entry" && p.side === "buy").length, 6);
    assertEquals(turn0.placed.filter((p) => p.leg === "entry" && p.side === "sell").length, 0);
    assert(turn0.skippedEntries.some((s) => /no USDC to sell/.test(s.reason)) && turn0.skippedEntries.some((s) => /no USDT to sell/.test(s.reason)), JSON.stringify(turn0.skippedEntries));

    // Minute T0+1: a seller at 0.7550 for 200, through the conversion's 0.7553 (and through nothing else of ours).
    w.print("USDC-GBP", T0 + M + 40e3, 0.7550, 200, "sell");
    await w.pr5(T0 + M);
    await w.call(T0 + M);
    assertEquals(convs().map((o) => [o.state, Number(o.filled_base)]), [["partially_filled", 200], ["new", 0]]);
    // Minute T0+2: another 250 at 0.7550 fills the other 197.19316; the asks of USDC/GBP go out at the next turn.
    w.print("USDC-GBP", T0 + 2 * M + 40e3, 0.7550, 250, "sell");
    await w.pr5(T0 + 2 * M);
    await w.call(T0 + 2 * M);
    assertEquals(convs()[0].state, "filled");
    assertEquals(Number(convs()[0].fee_gbp), 0);                                 // a maker's 0 %
    await w.pr5(T0 + 3 * M);
    const r3 = await w.call(T0 + 3 * M);
    const asksOut = (book: QuoteBook) => w.orders().filter((o) => o.leg === "entry" && o.side === "sell" && o.book === book && ["new", "partially_filled"].includes(String(o.state)));
    assertEquals(asksOut("USDC-GBP").length, 3, JSON.stringify(r3.twins[0].lastTurnReport?.skippedEntries));
    assertEquals(asksOut("USDT-GBP").length, 0);                                 // its conversion has not filled
    const usdcBid = () => w.orders().find((o) => o.leg === "entry" && o.book === "USDC-GBP" && o.rung_side === "bid" && Number(o.k) === 0.001)!;
    assertEquals([Number(usdcBid().price), usdcBid().state], [0.7546, "new"]);

    // The twin's call misses minutes T0+4 … T0+7 while PR5's runs: its last turn stands at T0+4m25s, so the dead-man
    // cancels every resting order at T0+7m25s. A seller through the 0.1 % bid before it fills 50; one after it, nothing.
    for (let t = T0 + 4 * M; t <= T0 + 7 * M; t += M) {
      if (t === T0 + 5 * M) w.print("USDC-GBP", t + 10e3, 0.7545, 50, "sell");
      if (t === T0 + 7 * M) w.print("USDC-GBP", t + 40e3, 0.7545, 80, "sell");
      await w.pr5(t);
    }
    await w.pr5(T0 + 8 * M);
    const r8 = await w.call(T0 + 8 * M);
    assertEquals(r8.twins[0].errors, []);
    const deadman = (w.mem.tables[SPEC.instance.events] as Row[]).filter((e) => e.kind === "deadman");
    assertEquals(deadman.map((e) => [e.minute, (e.detail as Row).at, (e.detail as Row).lastTurn]), [[iso(T0 + 7 * M), iso(T0 + 7 * M + 25e3), iso(T0 + 4 * M + 25e3)]]);
    // The bid filled 50 before the cutoff and nothing after; the USDT conversion, unfilled, went with the rest.
    assertEquals([usdcBid().state, Number(usdcBid().filled_base)], ["filled", 50]);
    const usdt = convs().filter((o) => o.book === "USDT-GBP");
    assertEquals(usdt[0].state, "cancelled");
    // The operator sends USDT's again, three seconds after the turn, for what its three asks still lack at the price it
    // would rest at: asks of £100 at 0.7562, 0.7570 and 0.7577 sell 132.24014 + 132.10039 + 131.97835 = 396.31888 coins,
    // £299.34 at 0.7553 (299.3396… to the penny up), which buys 396.31934 coins at 0.7553.
    assertEquals(usdt.length, 2);
    assertEquals([usdt[1].ts, Number(usdt[1].price), usdt[1].state, Number(usdt[1].base_size)], [iso(T0 + 9 * M + 25e3 + 3e3), 0.7553, "new", 396.31934]);
    const ds = w.driver()!;
    assertEquals([ds.operator?.["USDT-GBP"]?.sent, ds.operator?.["USDT-GBP"]?.done, ds.operator?.["USDC-GBP"]?.done], [2, false, true]);

    // Its replica decided every minute as PR5's engine did, event for event.
    assert(ds.paperCheck && ds.paperCheck.events > 0 && ds.paperCheck.mismatches === 0, JSON.stringify(ds.paperCheck));
    // Its orders sent each UTC day: every row written, less any recorded refused and never sent.
    const sent = w.orders().filter((o) => (o.response as { wouldBeRefused?: unknown } | null)?.wouldBeRefused !== true).length;
    assertEquals(ds.days, { "2026-09-24": sent });
    // Nothing reached a network, and the twin touched its own tables, its leases and PR5's record alone.
    assertEquals(net, []);
    assert([...w.touched].every((t) => t.startsWith("agent_quote_twin_pr5_") || t === "agent_locks" || TWIN_READS.includes(t)), [...w.touched].join(","));
  } finally { globalThis.fetch = real; }
});

Deno.test("a backfill loads by its sha256, and the record goes on from it as the twin's own", async () => {
  const a = world();
  const tape = (t: number) => {
    if ((t - T0) / M % 3 === 1) a.print("USDC-GBP", t + 40e3, 0.7550, 150, "sell");
    if ((t - T0) / M % 5 === 2) a.print("USDT-GBP", t + 20e3, 0.7551, 220, "sell");
  };
  for (let t = T0; t < T0 + 12 * M; t += M) { tape(t); await a.pr5(t); await a.call(t); }
  const until = T0 + 11 * M;
  const tables = (w: ReturnType<typeof world>) => ({
    config: w.mem.tables[SPEC.instance.config] as Row[], orders: w.orders(), events: (w.mem.tables[SPEC.instance.events] ?? []) as Row[],
    state: w.mem.tables[SPEC.instance.state] as Row[], paper: w.mem.tables[SPEC.instance.paper] as Row[], sim: w.mem.tables[SPEC.sim] as Row[],
  });
  const data = twinBackfillOf(SPEC, until, tables(a));
  assertEquals([data.twin, data.until, data.orders.length > 10, "id" in data.orders[0]], ["pr5", iso(until), true, false]);
  const gz = new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", gz))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const served: string[] = [];
  const fake = ((u: string | URL | Request) => { served.push(String(u)); return Promise.resolve(new Response(gz)); }) as typeof fetch;
  // World B: PR5's record as A's, and no twin yet.
  const pr5Tables = ["agent_risk", "agent_quote_state", "agent_quote_minutes", "agent_quote_prints", "agent_quote_inputs", "agent_quote_events", "agent_quoted_state", "agent_quoted_events", "edge_call_beats"];
  const b = world({
    agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: SPEC.instance.lease, lease_until: iso(0), holder: null }],
    ...Object.fromEntries(pr5Tables.map((t) => [t, JSON.parse(JSON.stringify(a.mem.tables[t] ?? []))])),
  });
  // A file whose bytes are not the pinned ones is refused, and nothing is written.
  const wrong: TwinBackfill = { file: "docs/agents/backtests/twins/pr5.json.gz", sha256: "0".repeat(64), until: iso(until) };
  assert(/not the pinned/.test(String(await loadTwinBackfill(b.db, SPEC, wrong, fake, T0))));
  assertEquals(b.orders().length, 0);
  const bf: TwinBackfill = { ...wrong, sha256: sha };
  b.clock.now = until + M + 38e3;
  const loaded = await runQuotesTwins({ db: b.db, now: b.clock.now, holder: "hb", signingKey: KEY, clock: () => b.clock.now, fetch: fake, backfills: { pr5: bf } }, [SPEC]);
  assert(/loaded/.test(String(loaded.twins[0].skipped)), JSON.stringify(loaded));
  // Read from the repository's own file on main: once for the refused hash, once for the load.
  assertEquals(served, Array(2).fill("https://raw.githubusercontent.com/daviesluo/daviesportfolios/main/docs/agents/backtests/twins/pr5.json.gz"));
  assertEquals(b.orders().map(shape), a.orders().map(shape));
  assertEquals(b.driver()?.origin, { kind: "backfill", file: bf.file, sha256: sha, until, loadedAt: until + M + 38e3 });
  // From there, the same minutes give the same record, order for order: PR5's record of each is A's, read by both.
  const before = a.orders().length;
  for (let t = until + M; t < until + 8 * M; t += M) {
    tape(t);
    // A seller through the 0.1 % bids, so the minutes after the load fill, exit and quote again.
    if (t === until + 2 * M) for (const book of ["USDC-GBP", "USDT-GBP"] as const) a.print(book, t + 30e3, 0.7540, 400, "sell");
    await a.pr5(t);
    for (const name of pr5Tables.filter((x) => x.startsWith("agent_quote_"))) b.mem.tables[name] = JSON.parse(JSON.stringify(a.mem.tables[name] ?? []));
    await a.call(t);
    await b.call(t);
    assertEquals(b.orders().map(shape), a.orders().map(shape));
  }
  assertEquals(b.driver()?.days, a.driver()?.days);
  assert(a.orders().length > before, "the minutes after the load sent orders, or the comparison proves nothing");
});

Deno.test("stampTs stamps the turn's instant on the orders it writes and counts those sent", async () => {
  const mem = memDb({ [ORDERS]: [] }, { now: () => 0 });
  let n = 0;
  const db = stampTs(mem.db, ORDERS, () => T0 + 25e3, (k) => { n += k; });
  const row = { mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 132.5, client_order_id: crypto.randomUUID(), state: "pending" };
  const [a] = await db.insert<Row>(ORDERS, row, true);
  await db.insert(ORDERS, { ...row, k: 0.002, client_order_id: crypto.randomUUID() }, true);
  assertEquals([a.ts, n], [iso(T0 + 25e3), 2]);
  // One recorded refused and never sent is not counted.
  await db.update(ORDERS, `id=eq.${a.id}`, { state: "rejected", response: { wouldBeRefused: true } });
  assertEquals(n, 1);
});

// ------------------------------------------------------------------ deviation 1 (2026-10-03): the twins are rows (0088), p50 the first new one, d renamed "variant-3"

Deno.test("deviation 1 makes the twins rows: pr5's and d's specs are what was frozen (d's page name alone moved), and p50 is pr5's at £600 on tables of its own", () => {
  // A spec as plain data: its key function by what it answers for each book and side (a conversion has none).
  const keys = (s: TwinSpec) => QUOTE_BOOKS.flatMap((b) => (["bid", "ask", null] as const).map((x) => s.instance.govKey(b, x)));
  const plain = (s: TwinSpec) => {
    const { backfill: _bf, ...rest } = s;
    return { ...rest, instance: { ...s.instance, rungs: [...s.instance.rungs], govKey: keys(s) } };
  };
  const tables = (id: string) => ({
    config: `agent_quote_twin_${id}_config`, orders: `agent_quote_twin_${id}_orders`, events: `agent_quote_twin_${id}_events`,
    state: `agent_quote_twin_${id}_state`, paper: `agent_quote_twin_${id}_paper`,
  });
  // pr5 and d as quotes_twin.ts held them when the twins' pre-registration froze it (sha256 921ce33a…): every field, no
  // other; d's page name alone moved, "variant-1" to "variant-3" (Davies, 2026-10-03, deviation 1).
  assertEquals(plain(TWINS.pr5), {
    id: "pr5", name: "Stablecoin quotes", engine: "pr5", sim: "agent_quote_twin_pr5_sim", capitalGbp: 1200, start: Date.parse("2026-09-23T15:09:00Z"),
    instance: { ...tables("pr5"), migration: "0087", lease: "quotes-twin-pr5", rungs: [0.001, 0.002, 0.003], exitReprice: 0.0005, govKey: Array(6).fill("account") },
  });
  assertEquals(plain(TWINS.d), {
    id: "d", name: "Stablecoin quotes variant-3", engine: "ruled-d", sim: "agent_quote_twin_d_sim", capitalGbp: 1800, start: Date.parse("2026-09-28T00:00:00Z"),
    instance: {
      ...tables("d"), migration: "0087", lease: "quotes-twin-d", rungs: [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003], exitReprice: 0.0003,
      govKey: ["USDC-GBP/bid", "USDC-GBP/ask", "USDC-GBP/ask", "USDT-GBP/bid", "USDT-GBP/ask", "USDT-GBP/ask"],
      // Deviation 4 (2026-10-09, Davies): from 2026-10-10 00:00 UTC it quotes no entry on the 0.03 % rungs.
      retired: { ks: [0.0003], from: Date.parse("2026-10-10T00:00:00Z") },
    },
  });
  // p50: pr5's spec but for its id, page name, tables and lease, its migration and its £600.
  assertEquals(plain(TWINS.p50), {
    ...plain(TWINS.pr5), id: "p50", name: "Stablecoin quotes variant-1", sim: "agent_quote_twin_p50_sim", capitalGbp: 600,
    instance: { ...plain(TWINS.pr5).instance, ...tables("p50"), migration: "0088", lease: "quotes-twin-p50" },
  });
  // The page's order, variant-1 above variant-3, which the call runs them in.
  assertEquals(TWIN_IDS, ["pr5", "p50", "d"]);
  // £50 a rung: the capital over two books, two sides and three rungs, as the executor's `rungGbp` divides it.
  assertEquals(TWINS.p50.capitalGbp / (QUOTE_BOOKS.length * 2 * TWINS.p50.instance.rungs.length), 50);
  // The backfills, each its row's now: pr5's and d's as frozen (`TWIN_BACKFILLS` then), p50's beside them, to the same minute.
  assertEquals(TWINS.pr5.backfill, { file: "docs/agents/backtests/twins/pr5.json.gz", sha256: "f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98", until: "2026-10-02T21:05:00.000Z" });
  assertEquals(TWINS.d.backfill, { file: "docs/agents/backtests/twins/d.json.gz", sha256: "ecbec6c51dc34d1ae6d2e7b80dafa03194e3296600d460ac3fa1692b04bb9392", until: "2026-10-02T21:05:00.000Z" });
  assertEquals([TWINS.p50.backfill?.file, TWINS.p50.backfill?.until], ["docs/agents/backtests/twins/p50.json.gz", "2026-10-02T21:05:00.000Z"]);
});

// ------------------------------------------------------------------ deviation 4 (2026-10-09): rule D's twin drops its 0.03 % rung

Deno.test("deviation 4: rule D's twin retires its 0.03 % rung from 2026-10-10 00:00 UTC; rule D's paper engine keeps nine; no other twin retires one", () => {
  // Davies, 2026-10-09: "…"规则 D 最内层的档位基本不赚钱"这个档删了". The twin alone: arm d of rule D's engine, which its replica
  // steps and its 10-28 reading reads, keeps its nine rungs, so the replica still matches that engine's record.
  assertEquals([...RULED_ARMS.d.rungs], [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]);
  assertEquals([...RULED_ARMS.d.rungs], [...RULED_ARMS.v1.rungs]);
  assertEquals(TWINS.d.instance.retired, { ks: [0.0003], from: Date.parse("2026-10-10T00:00:00Z") });
  assertEquals(TWINS.d.instance.rungs, RULED_ARMS.d.rungs);
  // Each rung keeps its £50: the capital over all nine a side of each book.
  assertEquals(TWINS.d.capitalGbp / (QUOTE_BOOKS.length * 2 * TWINS.d.instance.rungs.length), 50);
  assertEquals([retiredAt(TWINS.d.instance, Date.parse("2026-10-09T23:59:59Z")), retiredAt(TWINS.d.instance, Date.parse("2026-10-10T00:00:00Z"))], [[], [0.0003]]);
  for (const id of ["pr5", "p50"]) assertEquals(TWINS[id].instance.retired, undefined, id);
  assertEquals(retiredAt(QUOTE_LIVE_INSTANCE, Date.parse("2026-11-01T00:00:00Z")), []);
});

/** A spec row for the tests: p50's, under another id, its tables and lease named by it. */
const rowAs = (id: string, o: Partial<TwinSpecRow> = {}): TwinSpecRow => ({
  ...TWIN_SPEC_ROWS[1], id, display_name: `T ${id}`, table_prefix: `agent_quote_twin_${id}`, lease: `quotes-twin-${id}`, ...o,
});

Deno.test("twinSpecs: the table's enabled rows in their order; a row this code cannot carry out is refused with why; before 0088, 0087's twins", async () => {
  const mem = memDb({
    agent_quote_twin_specs: [
      rowAs("zz", { display_order: 50 }), ...TWIN_SPEC_ROWS, rowAs("off", { display_order: 15, enabled: false }),
      rowAs("take", { display_order: 30, rules: { take: { bps: 5 } } }), rowAs("eng", { display_order: 45, engine: "nope" as TwinSpecRow["engine"] }),
      rowAs("queue", { display_order: 35, rules: { queue: { bps: 5 } } }), rowAs("tk", { display_order: 32, rules: { take: { from: "2026-10-05T00:00:00Z" } } }),
    ],
  }, { now: () => T0 });
  const r = await twinSpecs(mem.db);
  assertEquals(r.specs.map((s) => s.id), ["pr5", "p50", "tk", "d", "zz"]);
  assertEquals([r.specs[0], r.specs[1], r.specs[3]], [TWINS.pr5, TWINS.p50, TWINS.d]);
  // A rule the code has sets its instance option (`take`, TAKE's, 0089); its settings unreadable, or a rule the code
  // lacks, and the row is refused with why.
  assertEquals(r.specs[2].instance.take, { from: Date.parse("2026-10-05T00:00:00Z") });
  assertEquals(r.refused, [
    { id: "take", why: `twin take: its rule take needs "from", a UTC instant` }, { id: "queue", why: "twin queue: no code for its rule queue" },
    { id: "eng", why: "twin eng: no engine nope" },
  ]);
  // The table not there yet (the function deployed before 0088 applied): the twins 0087 made, and nothing else.
  const absent = (t: string) => Promise.reject(new Error(`db GET ${t} → 404: {"code":"PGRST205","message":"Could not find the table 'public.${t}' in the schema cache"}`));
  assertEquals((await twinSpecs({ ...mem.db, select: (t, q) => (t === "agent_quote_twin_specs" ? absent(t) : mem.db.select(t, q)) })).specs, [TWINS.pr5, TWINS.d]);
  // Any other failure is the call's: it runs no twin on a guess.
  await assertRejects(() => twinSpecs({ ...mem.db, select: () => Promise.reject(new Error("db GET agent_quote_twin_specs → 503")) }), Error, "503");
});

Deno.test("the call runs the spec table's rows: a row it cannot carry out is reported, and the others turn", async () => {
  const w = world();
  w.mem.tables.agent_quote_twin_specs = [{ ...TWIN_SPEC_ROWS[0], start: iso(T0) }, rowAs("queue", { display_order: 5, rules: { queue: {} } })];
  await w.pr5(T0);
  w.clock.now = T0 + M + 38e3;
  const r = await runQuotesTwins({ db: w.db, now: w.clock.now, holder: "h", signingKey: KEY, clock: () => w.clock.now });
  assertEquals(r.twins.map((t) => [t.twin, t.skipped ?? null, t.errors, t.turns]), [["queue", "its spec row is not one this code carries out", ["twin queue: no code for its rule queue"], 0], ["pr5", null, [], 1]]);
  assert(w.orders().some((o) => o.leg === "entry"), "pr5's twin quoted");
});

Deno.test("the in-memory database knows every twin's tables and holds each to 0087's rules, as Postgres holds 0088's", async () => {
  for (const s of [...TWIN_IDS.map((id) => TWINS[id]), specFromRow(rowAs("zz"))]) {
    const I = s.instance, id = s.id;
    const mem = memDb({}, { now: () => T0 });
    const order = { mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", price: 0.7546, base_size: 132.5, client_order_id: crypto.randomUUID() };
    const [row] = await mem.db.insert<Row>(I.orders, order, true);
    // 0052's defaults, as a real insert stores them.
    assertEquals([row.state, Number(row.filled_base), Number(row.fee_gbp), row.venue_order_id], ["pending", 0, 0, null], id);
    const again = () => ({ ...order, client_order_id: crypto.randomUUID() });
    await assertRejects(() => mem.db.insert(I.orders, { ...again(), leg: "bogus" }), Error, `${I.orders}_leg_check`);
    await assertRejects(() => mem.db.insert(I.orders, { ...again(), k: 0.002, rung_side: null }), Error, `${I.orders}_check"`);
    await assertRejects(() => mem.db.insert(I.orders, again()), Error, `${I.orders}_one_open_per_rung`);
    await assertRejects(() => mem.db.insert(I.orders, { ...order, k: 0.003 }), Error, `${I.orders}_client_order_id_key`);
    await assertRejects(() => mem.db.upsert(I.events, [{ mode: "live", minute: iso(T0), book: "-", rung_side: "-", k: 0, kind: "bogus", detail: {} }], "mode,minute,book,rung_side,k,kind"), Error, `${I.events}_kind_check`);
    await assertRejects(() => mem.db.upsert(I.config, [{ id: 1, dry_run: false, capital_gbp: 0 }], "id"), Error, `${I.config}_capital_gbp_check`);
    for (const t of [I.paper, s.sim]) {
      await assertRejects(() => mem.db.upsert(t, [{ id: 2, state: {} }], "id"), Error, `${t}_id_check`);
      await assertRejects(() => mem.db.upsert(t, [{ id: 1, state: {} }], "state"), Error, "ON CONFLICT");
      // A path into a column the table does not have (as `fetched:state->fetchedTo` reads one it has).
      await assertRejects(() => mem.db.select(t, "id=eq.1&select=x:nonsense->a"), Error, "column nonsense does not exist");
    }
  }
  // The spec table's own checks (0088): a row on another twin's tables or lease, or with an engine or keys the code lacks.
  const mem = memDb({}, { now: () => T0 });
  const T = "agent_quote_twin_specs";
  await assertRejects(() => mem.db.insert(T, rowAs("x", { table_prefix: "agent_quote_twin_pr5" })), Error, `${T}_check"`);
  await assertRejects(() => mem.db.insert(T, rowAs("x", { lease: "quotes-twin-pr5" })), Error, `${T}_check1"`);
  await assertRejects(() => mem.db.insert(T, rowAs("x", { engine: "take" as TwinSpecRow["engine"] })), Error, `${T}_engine_check`);
  await assertRejects(() => mem.db.insert(T, rowAs("x", { gov: "two" as TwinSpecRow["gov"] })), Error, `${T}_gov_check`);
  await assertRejects(() => mem.db.insert(T, rowAs("X-1", { table_prefix: "agent_quote_twin_X-1", lease: "quotes-twin-X-1" })), Error, `${T}_id_check`);
  await assertRejects(() => mem.db.insert(T, rowAs("x", { capital_gbp: 0 })), Error, `${T}_capital_gbp_check`);
});

Deno.test("TAKE's twin is variant-1's turn for turn before take.from; from it a turn waits for the recorder's read after it (at most 120 s), and a take reaches the account by its order row", async () => {
  const P50: TwinSpec = { ...TWINS.p50, start: T0 };
  const FROM = T0 + 6 * M;
  const TAKE: TwinSpec = { ...specFromRow(rowAs("take50", { display_order: 30, rules: { take: { from: iso(FROM) } } })), start: T0 };
  const w = world(undefined, [P50, TAKE]);
  w.mem.tables.agent_book_levels = [];
  const levels = w.mem.tables.agent_book_levels as Row[];
  const read = (book: QuoteBook, ts: number, bids: number, asks: number): Row => ({ book, ts: iso(ts), seen_until: iso(ts), reads: 1, bids: [[bids, 500, 1]], asks: [[asks, 500, 1]] });
  const lastTurn = (s: TwinSpec) => w.driver(s)?.venue.lastTurnAt;
  const takeOf = (r: Awaited<ReturnType<typeof runQuotesTwins>>) => r.twins.find((t) => t.twin === "take50")!;
  // Before take.from both turn in the call, at PR5's instant, and their records are the same order for order.
  for (let t = T0; t <= T0 + 4 * M; t += M) {
    await w.pr5(t);
    const r = await w.call(t);
    assertEquals(r.twins.map((x) => [x.twin, x.errors, x.turns]), [["p50", [], 1], ["take50", [], 1]], `minute ${(t - T0) / M}`);
    assertEquals(w.orders(TAKE).map(shape), w.orders(P50).map(shape), `minute ${(t - T0) / M}`);
    assertEquals(lastTurn(TAKE), lastTurn(P50));
  }
  assert(w.orders(P50).some((o) => o.leg === "entry"), "the twins quoted before take.from, or the comparison proves less");
  // The recorder reads 40 s into the minute: USDC asking 0.7539, through the 0.1 % bid's take limit (fair 0.75540, less
  // 19 bps), and USDT through nothing.
  levels.push(read("USDC-GBP", T0 + 5 * M + 40e3, 0.7530, 0.7539), read("USDT-GBP", T0 + 5 * M + 41e3, 0.7552, 0.7556));
  // From take.from the turn at PR5's 09:06:25 may take: no read after it yet, so it waits; p50 turns.
  await w.pr5(T0 + 5 * M);
  const r5 = await w.call(T0 + 5 * M);
  assertEquals([takeOf(r5).turns, takeOf(r5).skipped, lastTurn(TAKE), lastTurn(P50)], [0, `its turn at ${iso(FROM + 25e3)} waits for the book recorder's read after it`, T0 + 5 * M + 25e3, FROM + 25e3]);
  assertEquals(w.driver(TAKE)?.waiting, [{ at: FROM + 25e3, upTo: T0 + 5 * M }]);
  // The recorder reads both books again at :40, unchanged: the turn goes, a call behind, at its own instant, and its take
  // is filled against that read: 66.32179 at 0.7539. The next instant waits in its place.
  for (const r of levels) r.seen_until = iso(Date.parse(String(r.ts)) + M);
  await w.pr5(T0 + 6 * M);
  const r6 = await w.call(T0 + 6 * M);
  assertEquals([takeOf(r6).turns, takeOf(r6).errors, lastTurn(TAKE)], [1, [], FROM + 25e3]);
  assertEquals(w.driver(TAKE)?.waiting, [{ at: FROM + M + 25e3, upTo: T0 + 6 * M }]);
  const takes = w.orders(TAKE).filter((o) => (o.request as { take?: unknown } | null)?.take === true);
  assertEquals(takes.map((o) => [o.ts, o.book, o.rung_side, Number(o.k), o.side, Number(o.price), Number(o.base_size), o.paper_oid]), [[iso(FROM + 25e3), "USDC-GBP", "bid", 0.001, "buy", 0.7539, 66.32179, null]]);
  const filled = w.driver(TAKE)!.venue.orders.find((o) => o.take);
  assertEquals([filled?.status, filled?.filled, filled?.fills[0]?.print], ["filled", 66.32179, `book: recorded read ${iso(T0 + 5 * M + 40e3)}`]);
  assertEquals(w.orders(P50).filter((o) => (o.request as { take?: unknown } | null)?.take === true).length, 0);
  // No read after 09:07:25: it waits while 120 s have not passed since it, then turns with none to fill a take against.
  await w.pr5(T0 + 7 * M);
  const r7 = await w.call(T0 + 7 * M);
  assertEquals([takeOf(r7).turns, lastTurn(TAKE)], [0, FROM + 25e3]);
  await w.pr5(T0 + 8 * M);
  const r8 = await w.call(T0 + 8 * M);
  assertEquals([takeOf(r8).turns, takeOf(r8).errors, lastTurn(TAKE)], [1, [], FROM + M + 25e3]);
  assertEquals(w.driver(TAKE)?.waiting?.map((x) => x.at), [FROM + 2 * M + 25e3, FROM + 3 * M + 25e3]);
  assertEquals(lastTurn(P50), FROM + 3 * M + 25e3);
});

Deno.test("a twin added later costs the running ones nothing: the call that loads its backfill turns them, and its missing tables stop none", async () => {
  const P50: TwinSpec = { ...TWINS.p50, start: T0 };
  const pr5Tables = ["agent_risk", "agent_quote_state", "agent_quote_minutes", "agent_quote_prints", "agent_quote_inputs", "agent_quote_events", "agent_quoted_state", "agent_quoted_events", "edge_call_beats"];
  const locks = (specs: TwinSpec[]) => [{ name: "quotes-twins", lease_until: iso(0), holder: null }, ...specs.map((s) => ({ name: s.instance.lease, lease_until: iso(0), holder: null }))];
  // A: PR5's record and its twin alone, minute by minute. C: p50 alone on the same record, whose tables at its fifth
  // minute become the backfill the others load. B and E: PR5's twin from the start, and p50 from minute 6, as a
  // deploy adds it: B's tables are there from the start; E's are missing until minute 8, as before a migration applies.
  const a = world();
  const c = world({ agent_locks: locks([P50]) }, [P50]);
  const b = world({ agent_locks: locks([SPEC, P50]) }, [SPEC, P50]);
  const e = world({ agent_locks: locks([SPEC, P50]) }, [SPEC, P50]);
  let missing = true;
  const gone = (t: string) => missing && t.startsWith("agent_quote_twin_p50_");
  const absent = (t: string) => Promise.reject(new Error(`db GET ${t} → 404: {"code":"PGRST205","message":"Could not find the table 'public.${t}' in the schema cache"}`));
  const eDb: Db = {
    select: (t, q) => (gone(t) ? absent(t) : e.db.select(t, q)), selectAll: (t, q) => (gone(t) ? absent(t) : e.db.selectAll(t, q)),
    insert: (t, r, x) => (gone(t) ? absent(t) : e.db.insert(t, r, x)), upsert: (t, r, k) => (gone(t) ? absent(t) : e.db.upsert(t, r, k)),
    update: (t, q, p) => (gone(t) ? absent(t) : e.db.update(t, q, p)), claim: (t, q, p) => (gone(t) ? absent(t) : e.db.claim(t, q, p)),
  };
  const tape = (t: number) => {
    if ((t - T0) / M % 3 === 1) a.print("USDC-GBP", t + 40e3, 0.7550, 150, "sell");
    if ((t - T0) / M % 5 === 2) a.print("USDT-GBP", t + 20e3, 0.7551, 220, "sell");
    // A seller through the 0.1 % bids at minute 6: the turn the load's call must not cost fills, exits and quotes again.
    if (t === T0 + 6 * M) for (const book of ["USDC-GBP", "USDT-GBP"] as const) a.print(book, t + 30e3, 0.7540, 400, "sell");
  };
  const copy = (w: ReturnType<typeof world>) => { for (const name of pr5Tables) w.mem.tables[name] = JSON.parse(JSON.stringify(a.mem.tables[name] ?? [])); };
  let bf: TwinBackfill | null = null, gz: Uint8Array | null = null;
  const fake = (() => Promise.resolve(new Response(gz!))) as typeof fetch;
  type R = Awaited<ReturnType<typeof runQuotesTwins>>;
  const reports: Record<string, R> = {};
  for (let t = T0; t < T0 + 11 * M; t += M) {
    const minute = (t - T0) / M;
    tape(t);
    await a.pr5(t);
    copy(b);
    copy(e);
    await a.call(t);
    if (minute <= 5) {
      copy(c);
      await c.call(t);
      // Before the deploy, B and E run PR5's twin alone.
      await b.call(t, {}, [SPEC]);
      await e.call(t, {}, [SPEC]);
      continue;
    }
    if (!bf) {
      const data = twinBackfillOf(P50, T0 + 5 * M, {
        config: c.mem.tables[P50.instance.config] as Row[], orders: c.orders(P50), events: (c.mem.tables[P50.instance.events] ?? []) as Row[],
        state: c.mem.tables[P50.instance.state] as Row[], paper: c.mem.tables[P50.instance.paper] as Row[], sim: c.mem.tables[P50.sim] as Row[],
      });
      gz = new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
      const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", gz))].map((x) => x.toString(16).padStart(2, "0")).join("");
      bf = { file: "docs/agents/backtests/twins/p50.json.gz", sha256: sha, until: iso(T0 + 5 * M) };
    }
    if (minute === 8) missing = false;                // E's migration applies
    const deployed: Partial<TwinDeps> = { fetch: fake, backfills: { p50: bf } };
    reports[`b${minute}`] = await b.call(t, deployed);
    e.clock.now = t + M + 38e3;
    reports[`e${minute}`] = await runQuotesTwins({ db: eDb, now: e.clock.now, holder: `h${e.clock.now}`, signingKey: KEY, clock: () => e.clock.now, ...deployed }, [SPEC, P50]);
    // PR5's twin is A's, order for order and turn for turn, in both: p50 cost it nothing.
    for (const w of [b, e]) {
      assertEquals(w.orders().map(shape), a.orders().map(shape), `minute ${minute}`);
      assertEquals([w.driver()?.turns, w.driver()?.venue.lastTurnAt], [a.driver()?.turns, a.driver()?.venue.lastTurnAt], `minute ${minute}`);
    }
  }
  const twin = (key: string, id: string) => reports[key].twins.find((x) => x.twin === id);
  // B: minute 6's call loads p50's backfill and turns PR5's twin; from minute 7 both turn, p50 from its own record.
  assertEquals([reports.b6.skipped, twin("b6", "p50")?.skipped, twin("b6", "pr5")?.turns], ["a backfill was loaded this call", `its backfill to ${iso(T0 + 5 * M)} is loaded; it catches up from there`, 1]);
  assertEquals([twin("b7", "p50")?.turns, twin("b7", "pr5")?.turns], [1, 1]);
  assertEquals(b.driver(P50)?.origin, { kind: "backfill", file: bf!.file, sha256: bf!.sha256, until: T0 + 5 * M, loadedAt: T0 + 7 * M + 38e3 });
  // E: while its tables are missing, p50 says so and does nothing, and PR5's twin turns; once they are there it
  // loads, then turns.
  for (const k of ["e6", "e7"]) {
    assertEquals([twin(k, "p50")?.skipped, /PGRST205/.test(String(twin(k, "p50")?.errors[0])), twin(k, "pr5")?.turns, twin(k, "pr5")?.errors], ["its record cannot be read", true, 1, []]);
  }
  assertEquals([twin("e8", "p50")?.skipped?.startsWith("its backfill to"), twin("e8", "pr5")?.turns, twin("e9", "p50")?.turns], [true, 1, 1]);
  assert(b.orders(P50).length > 0 && e.orders(P50).length > 0, "p50 quoted after its load in both, or the comparison proves less");
  assert(a.orders().some((o) => o.leg === "entry" && Number(o.filled_base) > 0 && Date.parse(String(o.filled_at ?? o.ts)) >= T0 + 6 * M), "PR5's twin filled from minute 6, or the comparison proves less");
});
