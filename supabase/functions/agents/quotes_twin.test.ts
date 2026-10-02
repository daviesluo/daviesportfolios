// The realistic twins' driver (quotes_twin.ts) in a world built by hand: PR5's engine stepped by this test as its call
// steps it (its record of each minute, its events, the instant its call read the prints), a tape of public prints, and
// the twin's call a minute behind it. What is pinned: the operator's maker conversions at the twin's start, the asks
// waiting for their coin until a conversion has filled by the prints through it, the dead-man's cutoff, the operator's
// conversion sent again after a cancel, the replica equal to the engine, the orders sent each day, a backfill's load
// (its sha256 checked) and the record continuing from it as the twin's own would have — and that no turn reaches a
// network or writes a table that is not the twin's.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newBookState, QUOTE_BOOKS, stepMinute, type BookState, type Print, type QuoteBook } from "./quotes.ts";
import { printOrder } from "./quotes_variant.ts";
import { memDb, type Row } from "./testing.ts";
import {
  loadTwinBackfill, runQuotesTwins, stampTs, TWIN_READS, twinBackfillOf, twinWrites, TWINS, type TwinBackfill, type TwinDriverState, type TwinSpec,
} from "./quotes_twin.ts";
import type { Db } from "./db.ts";

const M = 60e3, H = 3600e3;
const T0 = Date.parse("2026-09-24T10:00:00Z");     // a Thursday, before PR5's beats and minute records: its call ran every minute
const X = 1.3238;                                   // GBP/USD; with the USD books at 1.0000, fair is 1 / X = 0.75540
const iso = (ms: number) => new Date(ms).toISOString();
const KEY = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
const SPEC: TwinSpec = { ...TWINS.pr5, start: T0 };
const ORDERS = SPEC.instance.orders;

/** A world: PR5's record as its call leaves it, minute by minute, and the twin's call a minute behind it. */
function world(seed?: Record<string, Row[]>) {
  const clock = { now: T0 };
  const inputs: Row[] = [];
  for (let t = T0 - 2 * H; t <= T0 + 30 * H; t += M) inputs.push({ kind: "fx", t: iso(t), value: X });
  for (let t = T0 - 30 * H; t <= T0 + 30 * H; t += H) for (const kind of ["fair:USDC-USD", "fair:USDT-USD"]) inputs.push({ kind, t: iso(t), value: 1.0 });
  // The last print before the start: a seller at 0.7553 on each book (the touch it implies: bid 0.7553, ask 0.7554).
  const seedPrint = (book: QuoteBook): Row => ({ id: `s-${book}`, book, ts: iso(T0 - 30e3), price: 0.7553, qty: 10, side: "sell" });
  const mem = memDb(seed ?? {
    agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: SPEC.instance.lease, lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    agent_quote_state: [], agent_quote_minutes: [], agent_quote_prints: QUOTE_BOOKS.map(seedPrint), agent_quote_inputs: inputs, agent_quote_events: [],
    agent_quoted_state: [], agent_quoted_events: [], edge_call_beats: [],
  }, { now: () => clock.now });
  // PR5's engine, as its call steps it: the same `stepMinute`, from the last print before the start.
  const seedOf = (b: QuoteBook): Print => ({ id: `s-${b}`, ts: T0 - 30e3, ticks: 7553, qty: 10, side: "sell" });
  const books = Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newBookState(b, seedOf(b))])) as Record<QuoteBook, BookState>;
  // The twin may touch its own tables, its two leases, and read PR5's record and the risk row; nothing else.
  const allowed = new Set([...twinWrites(SPEC), "agent_locks", ...TWIN_READS]);
  const readOnly = new Set(TWIN_READS);
  const touched = new Set<string>();
  const guard = (method: string, t: string, q = "") => {
    if (!allowed.has(t)) throw new Error(`the twin touched ${t} (${method})`);
    if (readOnly.has(t) && method !== "select") throw new Error(`the twin wrote ${t} (${method})`);
    if (t === "agent_locks" && method !== "select" && !(q.includes("name=eq.quotes-twins") || q.includes(`name=eq.${SPEC.instance.lease}`))) throw new Error(`the twin took a lease not its own: ${q}`);
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
    call(t: number) {
      clock.now = t + M + 38e3;
      return runQuotesTwins({ db, now: clock.now, holder: `h${clock.now}`, signingKey: KEY, clock: () => clock.now }, [SPEC]);
    },
    orders: () => (mem.tables[ORDERS] ?? []) as Row[],
    driver: () => ((mem.tables[SPEC.sim] ?? [])[0]?.state ?? null) as TwinDriverState | null,
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
