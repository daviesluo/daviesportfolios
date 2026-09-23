// One live Revolut X row, one whole life: the integration pin this feature never had (2026-09-22).
//
// The tick runs through the REAL venue clients — `revxVenue` signing every private call, `krakenVenue` on its public
// endpoints — over fake HTTP venues that answer in the shapes Revolut X and Kraken document (`testing.ts`), against the
// strict in-memory database (CHECK and NOT NULL on insert AND update, the unique claims, PostgREST's page cap). Nothing
// between the loop and the wire is stubbed: a placement reply, an order read-back, a cancel and a balance go through the
// same parsing production runs. Every stage asserts the RECORD — decisions, orders, fills, the venue's own balance — not
// merely that the turn did not throw.
//
// It began as the adversarial review's scratchpad scenario (review R, 2026-09-22), on the code of that day: the kill
// switch wrote a false record, retried a refused entry every minute and placed a stale one into a 200 bps book on
// re-arm; a Kraken outage took the floor off every Revolut X position; and an unreadable fill reply left the coins it
// bought with no floor at all. Each stage names the fix it pins, and reverting any of those fixes turns it red.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { krakenVenue } from "../_shared/kraken.ts";
import { revxVenue } from "../_shared/revx.ts";
import { FakeKraken, FakeRevx, jevFetch, memDb, type Row } from "./testing.ts";
import { MAX_ORDER_AGE_MS, REENTRY_BARS, tick, type TickReport } from "./tick.ts";

const ONE_M = 60e3, FOUR_H = 4 * 3600e3;
const BAR0 = Date.parse("2026-09-23T04:00:00Z");
/** The n-th 4-hour bar boundary after BAR0: the close of one bar and the open of the next. */
const B = (n: number) => BAR0 + n * FOUR_H;
const CONFIRMED = "2026-09-22T12:00:00Z";

/** The row the go-live draft adds (`0051`): trend-4h on Revolut X, Kraken's candles, one slot — here on BTC alone, $20. */
const LIVE_ROW: Row = {
  id: "trend-4h-live", kind: "trend-4h", venue: "revx", signal_venue: "kraken", name: "Trend 4h · Revolut X · live", description: "",
  symbols: ["BTC/USD"], mode: "live", capital_usd: 20, retired_at: null,
  params: { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42, enterMin: 0.45, exitMax: 0.3 },
};
const RISK: Row = { id: 1, global_pause: false, max_exposure_usd: 150, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: CONFIRMED };

const round8 = (x: number) => Math.round(x * 1e8) / 1e8;

async function world(start: number) {
  let now = start;
  // Postgres stamps `ts default now()` a few seconds into the turn, never at the turn's own `now`: the extra seconds are
  // what make a `pending` row wait a full minute before it is reconciled, exactly as in production.
  const mem = memDb({
    agent_risk: [RISK], agent_strategies: [LIVE_ROW], agent_orders: [], agent_decisions: [], agent_observations: [],
    agent_maker_probes: [], agent_candles: [], agent_locks: [{ name: "tick", lease_until: "1970-01-01T00:00:00.000Z", holder: null }],
  }, { now: () => now + 5_000 });
  const rx = new FakeRevx(() => now), kr = new FakeKraken(() => now);
  const { privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const venues = { revx: revxVenue({ apiKey: "k".repeat(64), privateKey }, rx.fetch), kraken: krakenVenue(null, kr.fetch) };
  const jevLog: string[] = [];
  const T = mem.tables;
  const orders = () => T.agent_orders;
  const decisions = () => T.agent_decisions;
  return {
    rx, kr, jevLog, T,
    /** One cron minute at `t`. */
    at: (t: number): Promise<TickReport> => {
      now = t;
      return tick({ db: mem.db, venues, jev: { openrouterKey: "k" }, now, fetchImpl: jevFetch({ log: jevLog }), uuid: () => crypto.randomUUID() });
    },
    row: () => T.agent_strategies[0],
    risk: () => T.agent_risk[0],
    orders, decisions,
    live: () => orders().filter((o) => o.mode === "live"),
    order: (id: unknown) => orders().find((o) => o.id === id)!,
    decision: (id: unknown) => decisions().find((d) => d.id === id)!,
    lastDecision: () => decisions().at(-1)!,
    kind: (d: Row) => (d.numbers as { kind?: string }).kind,
    /** The live book: what the filled live orders say this row holds. */
    book: () => round8(orders().filter((o) => o.mode === "live" && (o.state === "filled" || o.state === "partially_filled"))
      .reduce((a, o) => a + (o.side === "buy" ? 1 : -1) * Number(o.filled_base || o.base_size), 0)),
    /** What the venue itself holds: the ground truth for a sub-account nothing else trades on. */
    venueBtc: () => round8(rx.balances.BTC ?? 0),
  };
}

const why = (r: TickReport) => JSON.stringify({ errors: r.errors, skipped: r.skipped, decisions: r.decisions });

Deno.test("lifecycle: one live row from flat through an entry, the floor, the cooldown, a Kraken outage, the kill switch, a demotion and an unreadable fill", async (t) => {
  const w = await world(B(0) + 5 * ONE_M);
  // A stage that fails leaves the world in a state no later stage was written for: the rest are skipped, not failed,
  // so the first red stage is the finding.
  let broken: string | null = null;
  const stage = async (name: string, fn: () => Promise<void>) => {
    await t.step({ name, ignore: broken != null, fn: async () => { try { await fn(); } catch (e) { broken = name; throw e; } } });
  };

  await stage("1 flat → entry: the row is `pending` while the venue is called, `new` after a fill on arrival, settled next turn from the venue's own reply", async () => {
    let atPost: string[] = [];
    w.rx.onPost = () => { atPost = w.orders().map((o) => String(o.state)); };
    const r = await w.at(B(0) + 5 * ONE_M);
    w.rx.onPost = undefined;
    assertEquals(r.errors, [], why(r));
    const dec = w.lastDecision();
    assertEquals([w.kind(dec), dec.final_action, dec.risk_allowed, dec.mode, dec.provider], ["bar", "enter", true, "live", "openrouter"]);
    assertEquals(atPost, ["pending"]);                                           // the intent was durable BEFORE the venue was called
    const [buy] = w.live();
    const atVenue = w.rx.orders.get(String(buy.venue_order_id))!;
    assertEquals([atVenue.status, atVenue.tif, atVenue.postOnly], ["filled", "ioc", false]);   // an IOC at the touch, filled on arrival
    // … and nothing is invented from the placement reply: no size, no price, no fee until the venue is asked.
    assertEquals([buy.side, buy.state, buy.decision_id, buy.filled_base, buy.fee_usd, (buy.response as Row).placedState], ["buy", "new", dec.id, 0, 0, "filled"]);
    assertEquals([w.book(), w.venueBtc()], [0, round8(Number(buy.base_size))]);  // the venue holds the coins; the book does not yet

    const r2 = await w.at(B(0) + 6 * ONE_M);
    assertEquals(r2.errors, [], why(r2));
    assertEquals(r2.settled, [{ id: buy.id, state: "filled" }]);
    const b = w.order(buy.id);
    assertEquals([b.state, b.filled_base, b.avg_fill_price, b.fee_usd], ["filled", atVenue.filled, atVenue.avg, atVenue.fee]);   // the venue's own figures
    assert(Number(b.fee_usd) > 0, String(b.fee_usd));
    assertEquals(w.book(), w.venueBtc());
  });

  await stage("2 the floor fires on the BID when the UK book falls 10 %: a marketable live sell of exactly what is held, then flat in the book and at the venue", async () => {
    w.rx.shock["BTC/USD"] = 0.9;
    const held = w.book();
    const r = await w.at(B(0) + 10 * ONE_M);
    assertEquals(r.errors, [], why(r));
    const stop = w.lastDecision();
    assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed, stop.mode], ["protective", "exit", true, "live"]);
    assert(String(stop.final_reason).startsWith("protective floor"), String(stop.final_reason));
    const sell = w.live().at(-1)!;
    assertEquals([sell.side, sell.decision_id, sell.base_size, (sell.request as Row).marketable, sell.price], ["sell", stop.id, held, true, w.rx.quote("BTC/USD").bid]);
    const r2 = await w.at(B(0) + 11 * ONE_M);
    assertEquals(r2.errors, [], why(r2));
    assertEquals(w.order(sell.id).state, "filled");
    assertEquals([w.book(), w.venueBtc()], [0, 0]);
    w.rx.shock["BTC/USD"] = 1;
  });

  await stage(`3 the cooldown: no re-entry for ${REENTRY_BARS} of the rule's bars after the exit — and no model paid for the holds — then the rule re-enters`, async () => {
    const asked = w.jevLog.length, placed = w.orders().length;
    for (const n of [1, 2]) {
      const r = await w.at(B(n) + ONE_M);
      assertEquals(r.errors, [], why(r));
      const d = w.lastDecision();
      assertEquals([w.kind(d), d.rule_action, d.final_action], ["bar", "hold", "hold"]);
      assert(String(d.rule_reason).includes("cooling down"), String(d.rule_reason));
    }
    assertEquals([w.jevLog.length, w.orders().length], [asked, placed]);
    const r = await w.at(B(3) + ONE_M);
    assertEquals(r.errors, [], why(r));
    const d = w.lastDecision();
    assertEquals([w.kind(d), d.final_action, d.risk_allowed], ["bar", "enter", true]);
    assertEquals(w.orders().filter((o) => o.decision_id === d.id).map((o) => o.side), ["buy"]);
    await w.at(B(3) + 2 * ONE_M);
    assert(w.book() > 0, String(w.book()));
    assertEquals(w.book(), w.venueBtc());
  });

  await stage("4 Kraken's candles go down: the cached series stands in, the floor still sells the Revolut X position, and no bar is decided on the stale series", async () => {
    // Kraken supplies the signal; Revolut X holds the coins and quotes the exit. Until 2026-09-22 an OHLC outage skipped
    // the pair before its floor ran — the floor needs Revolut X's bid and the book, never a Kraken candle.
    w.kr.down = true;
    w.rx.shock["BTC/USD"] = 0.9;
    const held = w.book();
    const r = await w.at(B(3) + 10 * ONE_M);
    const outage = (e: string) => e.includes("kraken BTC/USD") && e.includes("cached series stands in");
    assert(r.errors.some(outage), why(r));                                       // the outage is reported …
    assertEquals(r.errors.filter((e) => !outage(e)), [], why(r));
    const stop = w.lastDecision();                                               // … and the floor ran anyway
    assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed, (stop.state as Row).signal], ["protective", "exit", true, "unavailable"]);
    const sell = w.live().at(-1)!;
    assertEquals([sell.side, sell.decision_id, sell.base_size, (sell.request as Row).marketable], ["sell", stop.id, held, true]);
    await w.at(B(3) + 11 * ONE_M);
    assertEquals([w.order(sell.id).state, w.book(), w.venueBtc()], ["filled", 0, 0]);
    // A bar closes during the outage. Its candle in the cache is the forming one frozen at the last good fetch, so it is
    // never read as closed: no decision, and the skip says why.
    const before = w.decisions().length;
    const r3 = await w.at(B(4) + ONE_M);
    assertEquals(w.decisions().length, before, why(r3));
    assert(r3.skipped.some((x) => x.includes("signal series stale")), why(r3));
    w.kr.down = false;
    w.rx.shock["BTC/USD"] = 1;
  });

  await stage("5a the kill switch pulled mid-position: the exit still goes out, and nothing blames the confirmation", async () => {
    // Stage 4's exit was at B(3)+11m: B(5) is still inside the cooldown, B(6) is past it.
    const r0 = await w.at(B(5) + ONE_M);
    assert(String(w.lastDecision().rule_reason).includes("cooling down"), why(r0));
    const r1 = await w.at(B(6) + ONE_M);
    assertEquals(r1.errors, [], why(r1));
    assertEquals([w.lastDecision().final_action, w.lastDecision().risk_allowed], ["enter", true]);
    await w.at(B(6) + 2 * ONE_M);
    const held = w.book();
    assert(held > 0 && held === w.venueBtc(), `${held} / ${w.venueBtc()}`);
    w.risk().live_confirmed_at = null;                                           // the documented way to stop the BUYING
    w.rx.shock["BTC/USD"] = 0.9;
    const r = await w.at(B(6) + 10 * ONE_M);
    assertEquals(r.errors, [], why(r));
    const stop = w.lastDecision();
    assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed], ["protective", "exit", true]);
    assertEquals([w.live().at(-1)!.side, w.live().at(-1)!.decision_id], ["sell", stop.id]);
    await w.at(B(6) + 11 * ONE_M);
    assertEquals([w.book(), w.venueBtc()], [0, 0]);
    w.rx.shock["BTC/USD"] = 1;
  });

  await stage("5b an entry while the switch is off is refused ON THE RECORD — risk_allowed false, the confirmation named — and is not retried every minute, nor placed on re-arm", async () => {
    // Stage 5a's exit was at B(6)+11m: B(9) is the first bar past the cooldown.
    const placed = w.orders().length;
    const r = await w.at(B(9) + ONE_M);
    assertEquals(r.errors, [], why(r));
    const d = w.lastDecision();
    assertEquals([w.kind(d), d.rule_action, d.final_action, d.risk_allowed], ["bar", "enter", "enter", false]);
    assert(String(d.risk_reason).includes("live_confirmed_at"), String(d.risk_reason));
    const decided = w.decisions().length;
    for (let k = 2; k <= 11; k++) {
      const rk = await w.at(B(9) + k * ONE_M);
      assertEquals(rk.errors, [], `minute ${k}: ${why(rk)}`);                   // one refusal on the record, not one error a minute
    }
    assertEquals([w.decisions().length, w.orders().length], [decided, placed]);
    // Re-armed half an hour into the bar, with the UK book 200 bps wide: a refused entry stays refused.
    w.risk().live_confirmed_at = CONFIRMED;
    w.rx.spreadBps["BTC/USD"] = 200;
    const r2 = await w.at(B(9) + 30 * ONE_M);
    assertEquals(r2.errors, [], why(r2));
    assertEquals(w.orders().length, placed);
    w.rx.spreadBps["BTC/USD"] = 2;
  });

  // An ALLOWED entry with no order behind it — Revolut X's pair config unavailable at the close — is placed on a later
  // turn. That retry is an entry at the later minute's touch, so it passes every gate a fresh entry passes.
  const allowedButUnplaced = async (bar: number) => {
    w.rx.down.pairs = true;
    const r = await w.at(B(bar) + ONE_M);
    w.rx.down.pairs = false;
    assertEquals(r.errors.filter((e) => !e.includes("revx: pairs")), ["trend-4h-live|BTC/USD: no quote/pair config on revx; the order waits for the next minute"], why(r));
    const d = w.lastDecision();
    assertEquals([w.kind(d), d.final_action, d.risk_allowed], ["bar", "enter", true]);
    assertEquals(w.orders().filter((o) => o.decision_id === d.id), []);
    return d.id;
  };

  await stage("5c the retry of an allowed entry is refused, on the record, once the switch has been pulled — and never tried again", async () => {
    const id = await allowedButUnplaced(10);
    w.risk().live_confirmed_at = null;
    const r = await w.at(B(10) + 2 * ONE_M);
    assertEquals(r.errors, [], why(r));
    assertEquals(w.decision(id).risk_allowed, false);
    assert(String(w.decision(id).risk_reason).startsWith("on the retry: live not confirmed"), String(w.decision(id).risk_reason));
    const r2 = await w.at(B(10) + 3 * ONE_M);
    assertEquals(r2.errors, [], why(r2));
    assertEquals(w.orders().filter((o) => o.decision_id === id), []);
    w.risk().live_confirmed_at = CONFIRMED;
  });

  await stage("5d the same retry into a UK book 200 bps wide is refused by the thin-book guard, as a fresh entry would be", async () => {
    const id = await allowedButUnplaced(11);
    w.rx.spreadBps["BTC/USD"] = 200;
    const r = await w.at(B(11) + 2 * ONE_M);
    w.rx.spreadBps["BTC/USD"] = 2;
    assertEquals(r.errors, [], why(r));
    assertEquals(w.decision(id).risk_allowed, false);
    assert(String(w.decision(id).risk_reason).startsWith("on the retry: book too wide to cross"), String(w.decision(id).risk_reason));
    assertEquals(w.orders().filter((o) => o.decision_id === id), []);
  });

  await stage("5e … and a retry more than a quarter of a bar after the close is closed as too late: no entry at today's touch on an old signal", async () => {
    const id = await allowedButUnplaced(12);
    const r = await w.at(B(12) + 62 * ONE_M);
    assertEquals(r.errors, [], why(r));
    assertEquals(w.decision(id).risk_allowed, false);
    assert(String(w.decision(id).risk_reason).includes("too late to enter"), String(w.decision(id).risk_reason));
    assertEquals(w.orders().filter((o) => o.decision_id === id), []);
  });

  await stage("6 set to paper mid-position: the real coins keep their floor, the sell is written LIVE, and no paper buy is placed beside them", async () => {
    const r0 = await w.at(B(13) + ONE_M);
    assertEquals([r0.errors, w.lastDecision().final_action, w.lastDecision().risk_allowed], [[], "enter", true], why(r0));
    await w.at(B(13) + 2 * ONE_M);
    const held = w.book();
    assert(held > 0 && held === w.venueBtc(), `${held} / ${w.venueBtc()}`);
    w.row().mode = "paper";
    const r1 = await w.at(B(14) + ONE_M);
    assertEquals(r1.errors, [], why(r1));
    assertEquals(r1.windingDown, ["trend-4h-live"]);                             // the tick is winding the live book down
    const d = w.lastDecision();
    assertEquals([w.kind(d), d.mode], ["bar", "live"]);                         // decided in the book the coins are in
    assert(d.final_action !== "enter", String(d.final_action));
    assertEquals(w.orders().filter((o) => o.mode === "paper"), []);
    w.rx.shock["BTC/USD"] = 0.9;
    const r2 = await w.at(B(14) + 10 * ONE_M);
    assertEquals(r2.errors, [], why(r2));
    const stop = w.lastDecision();
    assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed, stop.mode], ["protective", "exit", true, "live"]);
    const sell = w.orders().at(-1)!;
    assertEquals([sell.side, sell.mode, sell.decision_id, sell.base_size], ["sell", "live", stop.id, held]);
    await w.at(B(14) + 11 * ONE_M);
    assertEquals([w.book(), w.venueBtc()], [0, 0]);
    w.rx.shock["BTC/USD"] = 1;
  });

  await stage("6e the cooldown the LIVE exit started holds on the PAPER book the row now trades: the rulebook's cooldown, not a book's (#15)", async () => {
    const r = await w.at(B(15) + ONE_M);
    assertEquals(r.errors, [], why(r));
    const d = w.lastDecision();
    assertEquals([w.kind(d), d.mode, d.rule_action], ["bar", "paper", "hold"]);
    assert(String(d.rule_reason).includes("cooling down"), String(d.rule_reason));
    assertEquals(w.orders().filter((o) => o.mode === "paper"), []);
  });

  await stage("7 an unreadable fill reply (B4) does not disarm the floor: the coins the venue holds for a buy it cannot settle are sold when the price falls through it — once", async () => {
    // The first live read-back is where the settlement field names are least certain. Here the venue's order reply has no
    // fee field: the read-back is refused, the buy is never settled from a guess — and its coins must not go unprotected.
    // The placement reply says `new`, as the documented example does, so the floor cannot lean on the word `filled`: it
    // counts what the venue's own balance shows beyond the settled book.
    w.row().mode = "live";
    w.rx.dialect = "no-fee";
    w.rx.placementReply = "new";
    const r0 = await w.at(B(17) + ONE_M);                                        // stage 6's exit was at B(14)+11m
    assertEquals(r0.errors, [], why(r0));
    const buy = w.live().at(-1)!;
    assertEquals([buy.side, (buy.response as Row).placedState, w.rx.orders.get(String(buy.venue_order_id))!.status], ["buy", "new", "filled"]);
    const bought = w.venueBtc();
    assert(bought > 0 && bought === round8(Number(buy.base_size)), `${bought}`);
    const r1 = await w.at(B(17) + 2 * ONE_M);
    assert(r1.errors.some((e) => e.includes("order lookup") && e.includes("total_fee/fees")), why(r1));
    assert(r1.errors.some((e) => e.includes(`floor counts ${bought} as held`) && e.includes("more than the settled book explains")), why(r1));
    assertEquals([w.order(buy.id).state, w.book()], ["new", 0]);               // the book cannot see the coins …
    w.rx.shock["BTC/USD"] = 0.8;
    const r2 = await w.at(B(17) + 3 * ONE_M);
    const stop = w.lastDecision();                                               // … the floor can
    assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed], ["protective", "exit", true], why(r2));
    const sell = w.live().at(-1)!;
    assertEquals([sell.side, sell.decision_id, sell.base_size, (sell.request as Row).marketable], ["sell", stop.id, bought, true]);
    assertEquals(w.venueBtc(), 0);
    // Nine more minutes 20 % down, neither order readable: the sell in flight stands the floor down — never a second sell.
    for (let k = 4; k <= 12; k++) {
      const rk = await w.at(B(17) + k * ONE_M);
      assert(!rk.errors.some((e) => /rejected|ESSENTIAL|lease/.test(e)), `minute ${k}: ${why(rk)}`);
    }
    const after = w.live().filter((o) => Number(o.id) > Number(buy.id));
    assertEquals(after.map((o) => [o.side, o.state]), [["sell", "new"]]);
    assertEquals(w.venueBtc(), 0);
  });
});

Deno.test("lifecycle: a venue that names a filled order's status in a word the client does not know — and answers a finished order's DELETE with 204 — never has its coins settled as cancelled, nor bought twice", async () => {
  // Read as "new, nothing filled", such a buy sat unsettled until the too-old cancel: the DELETE "worked", the read-back said
  // nothing filled, the row was settled `cancelled`, the coins left the book — and the next bar bought them again (review
  // R, 6c/6d). An unknown status is now a read-back the client refuses, and a refused read-back settles nothing.
  const w = await world(B(0) + 5 * ONE_M);
  w.rx.dialect = "foreign";
  w.rx.deleteFinished = 204;
  const r0 = await w.at(B(0) + 5 * ONE_M);
  assertEquals(r0.errors, [], why(r0));
  const [buy] = w.live();
  const bought = w.venueBtc();
  assert(bought > 0, String(bought));
  // Past MAX_ORDER_AGE_MS the too-old cancel runs: its DELETE answers 204, and its read-back still cannot be read.
  const tooOld = 5 + MAX_ORDER_AGE_MS / ONE_M + 1;
  for (const m of [6, 30, tooOld]) {
    const r = await w.at(B(0) + m * ONE_M);
    assert(r.errors.some((e) => e.includes("does not know")), `minute ${m}: ${why(r)}`);
  }
  assert(w.rx.calls.includes(`DELETE /api/1.0/orders/${buy.venue_order_id}`), w.rx.calls.join(","));
  assertEquals(w.order(buy.id).state, "new");                                    // never settled from a guess
  // The next bar: the pair is still in flight, so the coins the book cannot see are not bought again …
  const r1 = await w.at(B(1) + ONE_M);
  assert(r1.skipped.some((x) => x.includes("order in flight")), why(r1));
  assertEquals(w.live().filter((o) => o.side === "buy").length, 1);
  assertEquals(w.venueBtc(), bought);
  // … and the floor still covers them.
  w.rx.shock["BTC/USD"] = 0.8;
  await w.at(B(1) + 10 * ONE_M);
  const stop = w.lastDecision();
  assertEquals([(stop.numbers as Row).kind, stop.final_action, stop.risk_allowed], ["protective", "exit", true]);
  assertEquals([w.live().at(-1)!.side, w.live().at(-1)!.base_size, w.venueBtc()], ["sell", bought, 0]);
});

Deno.test("lifecycle: a buy the venue took but whose reply never arrived stays `pending` for a person — and the coins the book cannot see still have a floor", async () => {
  // A timeout after the venue has the order: the row written before the call stays `pending`, with no venue id. An IOC that
  // filled is not among the active orders, so the loop cannot reconcile it and must not guess — a person settles it from
  // the venue's history. Until then the coins are in no book; the venue's own balance is what the floor goes by.
  const w = await world(B(0) + 5 * ONE_M);
  w.rx.loseReply = true;
  const r0 = await w.at(B(0) + 5 * ONE_M);
  w.rx.loseReply = false;
  assert(r0.errors.some((e) => e.includes("aborted")), why(r0));
  const [buy] = w.live();
  assertEquals([buy.side, buy.state, buy.venue_order_id], ["buy", "pending", null]);
  const bought = w.venueBtc();
  assert(bought > 0 && bought === round8(Number(buy.base_size)), String(bought));
  await w.at(B(0) + 6 * ONE_M);                                                  // under a minute old by the database's clock: left alone
  const r2 = await w.at(B(0) + 7 * ONE_M);
  assert(r2.errors.some((e) => e.includes("outcome unknown") && e.includes("revx holds")), why(r2));
  assert(r2.errors.some((e) => e.includes("floor counts") && e.includes("more than the settled book explains")), why(r2));
  w.rx.shock["BTC/USD"] = 0.8;
  const r3 = await w.at(B(0) + 8 * ONE_M);
  const stop = w.lastDecision();
  assertEquals([w.kind(stop), stop.final_action, stop.risk_allowed], ["protective", "exit", true], why(r3));
  assertEquals([w.live().at(-1)!.side, w.live().at(-1)!.decision_id, w.live().at(-1)!.base_size, w.venueBtc()], ["sell", stop.id, bought, 0]);
  for (let k = 9; k <= 12; k++) {
    const rk = await w.at(B(0) + k * ONE_M);
    assert(!rk.errors.some((e) => /rejected|ESSENTIAL|lease/.test(e)), `minute ${k}: ${why(rk)}`);
  }
  assertEquals(w.live().filter((o) => o.side === "sell").length, 1);            // once: the venue holds nothing more to protect
  assertEquals([w.order(buy.id).state, w.venueBtc()], ["pending", 0]);          // and the row is still the person's to settle
});
