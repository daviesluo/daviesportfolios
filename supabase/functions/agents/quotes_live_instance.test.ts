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

function world(mod: Mod) {
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
    fetch: sim.publicFetch, pause: () => Promise.resolve(), clock: () => clock.now,
  });
  return {
    mem, sim, clock,
    turn(at: number) { clock.now = at; return mod.runQuotesLive(deps(at)); },
    convert(at: number, body: Record<string, unknown>) { clock.now = at; return mod.runQuotesConvert(deps(at), body); },
    print(book: QuoteBook, p: Print) { clock.now = p.ts; sim.applyPrint(book, p); },
    snapshot: () => JSON.stringify({ tables: mem.tables, account: sim.st }),
  };
}

Deno.test("the executor's default instance is the frozen executor: the same tables, account and reports, turn by turn", async () => {
  const a = world(Now), b = world(Frozen);
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
  const seen = { fills: 0, partial: 0, exits: 0, reprices: 0, refusals: 0, stops: 0, topups: 0, makerConv: 0, takerConv: 0, stale: 0, depeg: 0, governor: 0, paused: 0, unarmed: 0 };
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
    if (t === T0) {
      const [ca, cb] = await both((w) => w.convert(at - 5e3, { book: "USDT-GBP", gbp: 20, send: true }));
      assertEquals(ca, cb);
      if ((ca as Row).sent) seen.makerConv++;
    }
    if (t === T0 + 5 * H) {
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
  // What the hours went through, or the equality above proves nothing.
  for (const [k, v] of Object.entries(seen)) assert(v > 0, `the simulated hours never reached ${k}: ${JSON.stringify(seen)}`);
});

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
