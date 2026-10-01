// Polymarket's order path (pm_live.ts) against doubles no looser than what they stand in for: the in-memory database with
// 0074's checks and unique indexes (testing.ts), held by `onlyTables` to the path's own tables, and a fake Polymarket
// that refuses what the CLOB refuses (a price off the tick, a size under the minimum, an expiration too near, a
// signature that does not recover to the API key's address, a maker or signer that is not the account's, a post-only
// order that would take, an unfunded order, a buy in closed-only mode or from a blocked country) and can lose a reply
// or a cancel.
//
// Every gate is pinned both ways, close-only case by case, the caps, the stops and the governor, pending-before-POST,
// unknown against rejected, reconciliation by hash, cancel-then-post, the day's selection outside RW's universe, and a
// full simulated day through the REAL client in which no request but a GET leaves. The counterfactuals (each gate
// removed in turn, each failing a pin here) are listed in docs/agents/reviews/2026-10-01-polymarket-order-path.md.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOrder as buildOrderFor, exchangeFor, orderHash, PM_GTD_EARLY_S, PM_GTD_MIN_LEAD_S, PM_ORDER_SENDS_ENABLED, PmL2Creds, PmOrderKey, pmVenue,
  type PmOrderStruct, type PmVenue,
} from "../_shared/polymarket_orders.ts";
import {
  attestationCurrent, bookNow, bookPnl, candidateOf, closeOnly, crosses, effectiveLimits, gates, onTick, placeholderQuotes, PM_LIVE_DB_TABLES,
  PM_LIVE_LEASE_MS, PM_LIVE_LIFETIME_S, PM_LIVE_MIN_HORIZON_MS, PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_SEND_UNTIL_MS, PM_LIVE_TIMEOUT_MS, PM_OPEN_GATES, pmTime, postOutcome, rewardRate,
  runPmLive, selectMarkets, stateOfStatus, tokenBooks, tradeStatus, type GateInputs, type PmLiveConfig, type PmMarketRow, type PmQuoteRule,
} from "./pm_live.ts";
import { runPmLiveAction } from "./index.ts";
import { FakePolymarket, memDb, onlyTables, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_OWNER, PM_TEST_SIGNER, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const T0 = Date.parse("2026-10-02T10:00:30Z");
const iso = (ms: number) => new Date(ms).toISOString();
const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
/** Token ids of uint256 size, distinct per market and outcome. */
const tok = (n: number, outcome: "yes" | "no") => `${7000000000000000000000000000000000000000000000000000000000000000000n + BigInt(n * 2 + (outcome === "no" ? 1 : 0))}`;

const CONFIG: PmLiveConfig & { id: number } = {
  id: 1, dry_run: true, live_confirmed_at: null, ireland_attested_at: "2026-10-01T04:00:00.000Z", ireland_until: null,
  cap_total_usd: 300, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 300,
};

type WorldOpts = { live?: boolean; region?: string | null; config?: Partial<PmLiveConfig>; signer?: boolean; rule?: PmQuoteRule; realClient?: boolean };

/**
 * Gamma's order puts four decoys first: a standard market in RW's universe ($50 a day natively), one at exactly $10, a
 * neg-risk market at $12 listed only as sponsored, and a neg-risk market not accepting orders. Then the two the rule
 * must take: a standard market at $3 a day (A) and a neg-risk market with no reward programme at all (B). A third,
 * C, comes after them and must never be reached.
 */
function makeWorld(o: WorldOpts = {}) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const add = (n: number, extra: Record<string, unknown>) => pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), ...extra });
  add(1, { rate: 50, bid: 0.30, ask: 0.32 });
  add(2, { rate: 10, bid: 0.60, ask: 0.62 });
  add(3, { rate: null, sponsoredRate: 12, negRisk: true, bid: 0.10, ask: 0.12 });
  add(4, { rate: null, negRisk: true, accepting: false });
  const A = add(5, { rate: 3, bid: 0.45, ask: 0.47, minSize: 5 });
  const B = add(6, { rate: null, negRisk: true, bid: 0.20, ask: 0.23, tick: "0.001", minSize: 20 });
  const C = add(7, { rate: 1, bid: 0.50, ask: 0.52 });
  const mem = memDb({
    agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }, { name: "pmrwc", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_live_config: [{ ...CONFIG, dry_run: !o.live, live_confirmed_at: o.live ? "2026-10-02T00:00:00.000Z" : null, ...o.config }],
    pm_live_markets: [], pm_live_orders: [], pm_live_fills: [], pm_live_events: [], pm_live_state: [],
    // RW's and RW-C's tables exist beside it, as in production, with a row each: the path must never read them.
    pm_rw_minutes: [{ cond: cond(1), minute: iso(T0) }], pm_rwc_minutes: [{ cond: cond(1), minute: iso(T0) }], pm_rwc_selection: [{ day: "2026-10-02", cond: cond(1) }],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, PM_LIVE_DB_TABLES, { lease: "pm-live", readOnly: ["agent_risk"] });
  let salt = 1000;
  const key = new PmOrderKey(PM_TEST_KEY);
  const w = {
    clock, pm, mem, db, A, B, C,
    venue: (): PmVenue => (o.realClient
      ? pmVenue({ fetchImpl: pm.fetch, sigType: 1, creds: new PmL2Creds(PM_TEST_OWNER, btoa("TEST-L2-SECRET-32-BYTES-LONG-001"), "test-passphrase"), address: PM_TEST_SIGNER, now: () => clock.now })
      : pm.venue()),
    async turn(at = clock.now, extra: Partial<Parameters<typeof runPmLive>[0]> = {}) {
      clock.now = at;
      return await runPmLive({
        db, now: at, holder: `h${at}`, venue: w.venue(), sbRegion: o.region === undefined ? "eu-west-1" : o.region, sendsEnabled: !!o.live,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: o.live || o.signer ? key : null, salt: () => String(salt++), rule: o.rule, ...extra,
      });
    },
    orders: () => mem.tables.pm_live_orders as Row[],
    open: (mode?: string) => (mem.tables.pm_live_orders as Row[]).filter((r) => (r.state === "pending" || r.state === "live") && (!mode || r.mode === mode)),
    events: (kind?: string) => (mem.tables.pm_live_events as Row[]).filter((e) => !kind || e.kind === kind),
    state: () => (mem.tables.pm_live_state as Row[])[0]?.state as Record<string, any>,
    setConfig(p: Partial<PmLiveConfig>) { Object.assign((mem.tables.pm_live_config as Row[])[0], p); },
    writes: () => pm.calls.filter((c) => !c.startsWith("GET ")),
  };
  return w;
}

// ------------------------------------------------------------------ the pure rules

Deno.test("effectiveLimits: a config row may lower every cap and stop, and never raise one past the code's ceiling", () => {
  assertEquals(effectiveLimits(CONFIG), { capTotal: 300, capMarket: 60, lossDay: 25, lossTotal: 75, maxPosts: 6000, lifetimeS: 300 });
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: 1000, cap_market_usd: 61, loss_day_usd: 100, loss_total_usd: 76, max_posts_day: 99999, gtd_lifetime_s: 3600 }),
    { capTotal: 300, capMarket: 60, lossDay: 25, lossTotal: 75, maxPosts: 6000, lifetimeS: 600 });
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: "120", cap_market_usd: 20, loss_day_usd: 5, loss_total_usd: 10, max_posts_day: 3, gtd_lifetime_s: 30 }),
    { capTotal: 120, capMarket: 20, lossDay: 5, lossTotal: 10, maxPosts: 3, lifetimeS: 180 });
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: "nonsense", gtd_lifetime_s: "x" }).capTotal, 300);
});

Deno.test("a turn's time: an order sent at the last moment a turn allows, answered at its timeout, still meets the venue's 3 minutes; every read ends inside the lease", () => {
  // Sent with expiration now + 60 + lifetime, at most PM_LIVE_SEND_UNTIL_MS into the turn, reaching the venue by its timeout.
  const leadAtVenueS = PM_GTD_EARLY_S + PM_LIVE_LIFETIME_S.min - (PM_LIVE_SEND_UNTIL_MS + PM_LIVE_TIMEOUT_MS) / 1000;
  assertEquals(leadAtVenueS, 195);
  assert(leadAtVenueS >= PM_GTD_MIN_LEAD_S);
  // The selection's last read and the last POST both end before the lease does, and the lease before the cron call's 58 s.
  assert(PM_LIVE_SELECT_UNTIL_MS + PM_LIVE_TIMEOUT_MS < PM_LIVE_LEASE_MS && PM_LIVE_SEND_UNTIL_MS + PM_LIVE_TIMEOUT_MS < PM_LIVE_LEASE_MS);
  assert(PM_LIVE_LEASE_MS < 58e3);
});

Deno.test("attestationCurrent: from the moment it is set, until a revocation; a standing one has no end; anything unreadable is no attestation", () => {
  const now = T0;
  assertEquals(attestationCurrent({ ireland_attested_at: null, ireland_until: null }, now), false);
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now - DAY), ireland_until: null }, now), true);              // standing
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now - DAY), ireland_until: iso(now + H) }, now), true);
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now - DAY), ireland_until: iso(now) }, now), false);          // revoked this instant
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now - DAY), ireland_until: iso(now - H) }, now), false);
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now + M), ireland_until: null }, now), false);                // not yet
  assertEquals(attestationCurrent({ ireland_attested_at: "garbage", ireland_until: null }, now), false);
  assertEquals(attestationCurrent({ ireland_attested_at: iso(now - DAY), ireland_until: "garbage" }, now), false);
});

const ALL_PASS: GateInputs = {
  mode: "live", globalPause: false, riskReadable: true, armed: true, sbRegion: "eu-west-1", geo: { ok: true, country: "IE", region: "L", blocked: true },
  closedOnly: false, attested: true, inventoryReadable: true, lossDay: false, lossTotal: false,
};

Deno.test("gates: every gate passing opens; each one failing alone stops opening and names itself, in the documented order", () => {
  const all = gates(ALL_PASS);
  assertEquals([all.open, all.reduce, all.cancelAll, all.openBlockedBy, all.reduceBlockedBy], [true, true, false, null, null]);
  const failing: Record<string, Partial<GateInputs>> = {
    global_pause: { globalPause: true }, risk_readable: { riskReadable: false }, armed: { armed: false }, region: { sbRegion: "eu-west-2" },
    geoblock: { geo: { ok: true, country: "GB", region: "ENG", blocked: true } }, closed_only: { closedOnly: true }, attestation: { attested: false },
    inventory: { inventoryReadable: false }, loss_day: { lossDay: true }, loss_total: { lossTotal: true },
  };
  assertEquals(Object.keys(failing), [...PM_OPEN_GATES]);
  for (const [name, p] of Object.entries(failing)) {
    const g = gates({ ...ALL_PASS, ...p });
    assertEquals([g.open, g.openBlockedBy, g.verdicts[name]], [false, name, false], name);
  }
  // An unreadable geoblock or closed-only flag is no permission.
  assertEquals(gates({ ...ALL_PASS, geo: { ok: false, country: null, region: null, blocked: null } }).openBlockedBy, "geoblock");
  assertEquals(gates({ ...ALL_PASS, closedOnly: null }).openBlockedBy, "closed_only");
  assertEquals(gates({ ...ALL_PASS, sbRegion: null }).openBlockedBy, "region");
  // From eu-west-1 the geoblock answers `blocked: true, country IE` (reference §6): the country decides, not the flag.
  assertEquals(gates({ ...ALL_PASS, geo: { ok: true, country: "IE", region: "L", blocked: false } }).open, true);
  assertEquals(gates({ ...ALL_PASS, geo: { ok: true, country: "US", region: "OH", blocked: false } }).open, false);
});

Deno.test("gates: reducing survives every gate but the pause, the region, a completely blocked country and the inventory read", () => {
  for (const p of [{ armed: false }, { closedOnly: true }, { closedOnly: null }, { attested: false }, { lossDay: true }, { lossTotal: true }, { riskReadable: false },
    { geo: { ok: true, country: "GB", region: "ENG", blocked: true } }, { geo: { ok: false, country: null, region: null, blocked: null } }] as Array<Partial<GateInputs>>) {
    const g = gates({ ...ALL_PASS, ...p });
    assertEquals([g.open, g.reduce], [false, true], JSON.stringify(p));
  }
  assertEquals(gates({ ...ALL_PASS, globalPause: true }).reduceBlockedBy, "global_pause");
  assertEquals(gates({ ...ALL_PASS, globalPause: true }).cancelAll, true);
  assertEquals(gates({ ...ALL_PASS, sbRegion: "eu-west-2" }).reduceBlockedBy, "region");
  assertEquals(gates({ ...ALL_PASS, geo: { ok: true, country: "IR", region: "", blocked: true } }).reduceBlockedBy, "geoblock");
  assertEquals(gates({ ...ALL_PASS, geo: { ok: true, country: "UA", region: "43", blocked: true } }).reduceBlockedBy, "geoblock");
  assertEquals(gates({ ...ALL_PASS, inventoryReadable: false }).reduceBlockedBy, "inventory");
});

Deno.test("gates: in a dry-run `live_confirmed_at` decides nothing (the dry-run shows what live and armed would send); in live it does", () => {
  const dry = gates({ ...ALL_PASS, mode: "dry_run", armed: false });
  assertEquals([dry.open, dry.verdicts.armed], [true, null]);
  assertEquals(gates({ ...ALL_PASS, mode: "live", armed: false }).openBlockedBy, "armed");
});

const BOOK = { bestBid: 0.45, bestAsk: 0.47, tick: "0.01" as const, minSize: 5, negRisk: false, at: null, hash: null };

Deno.test("placeholderQuotes: BUY YES at the best bid, BUY NO at 1 − the best ask on the tick, both at the market's minimum size", () => {
  const m = { day: "2026-10-02", kind: "standard", cond: cond(5), yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 3, rank: 5, question: null } as PmMarketRow;
  assertEquals(placeholderQuotes({ market: m, book: { ...BOOK, bestAsk: 0.53 }, held: { yes: 0, no: 0 } }), [
    { outcome: "yes", side: "BUY", price: 0.45, size: 5 },
    { outcome: "no", side: "BUY", price: 0.47, size: 5 },                                     // 1 − 0.53, not 0.47000000000000003
  ]);
  assertEquals(onTick(1 - 0.123, "0.001"), 0.877);
});

Deno.test("closeOnly, case by case: no buy ever; YES sold at our ask and NO at 1 − our bid, at most what is held; flat rests nothing", () => {
  const quotes = [{ outcome: "yes", side: "BUY", price: 0.45, size: 5 }, { outcome: "no", side: "BUY", price: 0.53, size: 5 }] as const;
  const q = [...quotes].map((x) => ({ ...x }));
  // Flat: nothing at all.
  assertEquals(closeOnly(q, { yes: 0, no: 0 }, BOOK), []);
  // YES held: our ask (a BUY of NO at 0.53) becomes a SELL of YES at 0.47; our bid wants NO, which is not held.
  assertEquals(closeOnly(q, { yes: 30, no: 0 }, BOOK), [{ outcome: "yes", side: "SELL", price: 0.47, size: 5 }]);
  // NO held: our bid (a BUY of YES at 0.45) becomes a SELL of NO at 0.55.
  assertEquals(closeOnly(q, { yes: 0, no: 30 }, BOOK), [{ outcome: "no", side: "SELL", price: 0.55, size: 5 }]);
  // Both held: both sells.
  assertEquals(closeOnly(q, { yes: 30, no: 30 }, BOOK), [{ outcome: "no", side: "SELL", price: 0.55, size: 5 }, { outcome: "yes", side: "SELL", price: 0.47, size: 5 }]);
  // At most what is held: 7.5 YES held sells 5 (the quote's size); with a larger quote it sells the 7.5 and no more.
  assertEquals(closeOnly([{ outcome: "no", side: "BUY", price: 0.53, size: 20 }], { yes: 7.5, no: 0 }, BOOK), [{ outcome: "yes", side: "SELL", price: 0.47, size: 7.5 }]);
  // A holding under the market's minimum cannot be sold: nothing rests.
  assertEquals(closeOnly(q, { yes: 4.99, no: 0 }, BOOK), []);
  // A sell the rule already wanted stays, capped at the holding; a second sell of the same token is not added.
  assertEquals(closeOnly([{ outcome: "yes", side: "SELL", price: 0.5, size: 50 }, { outcome: "no", side: "BUY", price: 0.53, size: 5 }], { yes: 19.99, no: 0 }, BOOK),
    [{ outcome: "yes", side: "SELL", price: 0.5, size: 19.99 }]);
  for (const held of [{ yes: 0, no: 0 }, { yes: 100, no: 0 }, { yes: 0, no: 100 }, { yes: 100, no: 100 }]) {
    assert(closeOnly(q, held, BOOK).every((x) => x.side === "SELL"), "close-only never buys");
  }
});

Deno.test("crosses: a post-only buy at or over the token's ask, or a sell at or under its bid, would take; NO's book is YES's mirror", () => {
  assertEquals([crosses({ outcome: "yes", side: "BUY", price: 0.46 }, BOOK), crosses({ outcome: "yes", side: "BUY", price: 0.47 }, BOOK)], [false, true]);
  assertEquals([crosses({ outcome: "yes", side: "SELL", price: 0.46 }, BOOK), crosses({ outcome: "yes", side: "SELL", price: 0.45 }, BOOK)], [false, true]);
  // NO: best bid 1 − 0.47 = 0.53, best ask 1 − 0.45 = 0.55.
  assertEquals([crosses({ outcome: "no", side: "BUY", price: 0.53 }, BOOK), crosses({ outcome: "no", side: "BUY", price: 0.55 }, BOOK)], [false, true]);
  assertEquals([crosses({ outcome: "no", side: "SELL", price: 0.55 }, BOOK), crosses({ outcome: "no", side: "SELL", price: 0.53 }, BOOK)], [false, true]);
});

Deno.test("bookNow: the touch found in the CLOB's order, the market's tick and minimum; a one-sided or out-of-range book is none", () => {
  const raw = { asset_id: "1", timestamp: "1790000000000", hash: "h", tick_size: "0.01", min_order_size: "20", neg_risk: true,
    bids: [{ price: "0.01", size: "100" }, { price: "0.44", size: "10" }, { price: "0.45", size: "0" }], asks: [{ price: "0.99", size: "1" }, { price: "0.47", size: "3" }] };
  assertEquals(bookNow(raw), { bestBid: 0.44, bestAsk: 0.47, tick: "0.01", minSize: 20, negRisk: true, at: iso(1790000000000), hash: "h" });   // a level of size 0 is no level
  assertEquals(bookNow({ ...raw, asks: [] }), null);
  assertEquals(bookNow({ ...raw, tick_size: "0.02" }), null);                                          // not a tick the clients know
  assertEquals(bookNow({ ...raw, bids: [{ price: "0.48", size: "1" }] }), null);                       // crossed
  assertEquals(bookNow({ ...raw, tick_size: "0.1", bids: [{ price: "0.05", size: "1" }] }), null);     // under the tick
  assertEquals(bookNow({ ...raw, min_order_size: "0" }), null);
});

Deno.test("postOutcome: an explicit refusal is rejected, a 425 or 429 rejected and sent again, a 5xx or a lost reply unknown, never rejected", () => {
  const h = `0x${"ab".repeat(32)}`;
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: true, orderID: h, status: "live" } }, h).state, "live");
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: false, errorMsg: "not enough balance / allowance" } }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 400, ms: 1, error: "invalid post-only order: order crosses book" }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 0, ms: 0, error: "PM_ORDER_SENDS_ENABLED is false", refused: "sends-disabled" }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 425, ms: 1, error: "restarting" }, h), { state: "rejected", why: "425 restarting: not taken", retry: true });
  assertEquals(postOutcome({ ok: false, status: 429, ms: 1, error: "Too Many Requests" }, h).retry, true);
  for (const r of [{ ok: false, status: 500, ms: 1, error: "order timed out" }, { ok: false, status: 503, ms: 1, error: "Trading is currently disabled" }, { ok: false, status: 0, ms: 5000, error: "Signal timed out." }]) {
    assertEquals(postOutcome(r, h).state, "pending", JSON.stringify(r));
  }
  // A 200 that names another id than the hash is settled by read-back, not believed.
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: true, orderID: `0x${"cd".repeat(32)}` } }, h).state, "pending");
});

Deno.test("tradeStatus, stateOfStatus: both spellings of a trade's status; an order's read-back status to the row's state, an unknown one to none", () => {
  assertEquals([tradeStatus("TRADE_STATUS_CONFIRMED"), tradeStatus("CONFIRMED"), tradeStatus("failed"), tradeStatus("MINED"), tradeStatus("SETTLED")], ["CONFIRMED", "CONFIRMED", "FAILED", "MINED", null]);
  assertEquals(["LIVE", "MATCHED", "CANCELED", "CANCELED_MARKET_RESOLVED", "INVALID", "UNMATCHED"].map(stateOfStatus), ["live", "filled", "cancelled", "cancelled", "rejected", null]);
});

Deno.test("tokenBooks and bookPnl: average cost, realised on sells (today's apart), holdings marked; worked out by hand", () => {
  const day = Date.parse("2026-10-02T00:00:00Z");
  const books = tokenBooks([
    { token: "Y", side: "BUY", price: 0.40, size: 10, ts: day - H },
    { token: "Y", side: "BUY", price: 0.50, size: 10, ts: day + H },          // average 0.45 on 20
    { token: "Y", side: "SELL", price: 0.60, size: 5, ts: day + 2 * H },      // +0.75 today
    { token: "N", side: "BUY", price: 0.30, size: 20, ts: day - 2 * H },
    { token: "N", side: "SELL", price: 0.20, size: 20, ts: day - H },         // −2.00, yesterday
  ], day);
  assertAlmostEquals(books.Y.avgCost, 0.45, 1e-12);
  assertEquals([books.Y.held, books.N.held], [15, 0]);
  assertAlmostEquals(books.Y.realisedToday, 0.75, 1e-12);
  assertAlmostEquals(books.N.realised, -2, 1e-12);
  // Y marked at 0.41: 15 × (0.41 − 0.45) = −0.60. Day: 0.75 − 0.60 = 0.15. All: 0.75 − 2 − 0.60 = −1.85.
  assertEquals(bookPnl(books, { Y: 0.41, N: 0.5 }), { day: 0.15, total: -1.85 });
});

Deno.test("candidateOf and rewardRate: outside RW's universe is a rate under $10 or none; only markets taking orders with two tokens", () => {
  const m = { conditionId: cond(9).toUpperCase().replace("0X", "0x"), clobTokenIds: '["11","12"]', enableOrderBook: true, acceptingOrders: true, closed: false, negRisk: false, question: "Q" };
  const rates = (r: number | null) => new Map(r == null ? [] : [[cond(9), r]]);
  assertEquals(candidateOf(m, rates(null))?.rate, null);
  assertEquals(candidateOf(m, rates(9.99))?.rate, 9.99);
  assertEquals(candidateOf(m, rates(10)), null);
  assertEquals(candidateOf(m, rates(250)), null);
  assertEquals(candidateOf({ ...m, acceptingOrders: false }, rates(null)), null);
  assertEquals(candidateOf({ ...m, enableOrderBook: false }, rates(null)), null);
  assertEquals(candidateOf({ ...m, closed: true }, rates(null)), null);
  assertEquals(candidateOf({ ...m, clobTokenIds: '["11","12","13"]' }, rates(null)), null);
  assertEquals(candidateOf({ ...m, conditionId: "0x12" }, rates(null)), null);
  assertEquals([rewardRate({ total_daily_rate: 12 }), rewardRate({ native_daily_rate: 2.5, sponsored_daily_rate: 0.5 }), rewardRate({})], [12, 3, 0]);
});

Deno.test("candidateOf passes over a market whose game starts, or which ends, within two days: one that resolves while selected leaves no book", () => {
  const now = Date.parse("2026-10-01T05:31:00Z");
  const m = { conditionId: cond(9), clobTokenIds: '["11","12"]', enableOrderBook: true, acceptingOrders: true, closed: false, negRisk: false, question: "Q" };
  const none = new Map<string, number>();
  // The first day's standard pick, as Gamma shows it: an endDate a week on, and a game that had started at 03:05.
  assertEquals(candidateOf({ ...m, endDate: "2026-10-08T02:00:00Z", gameStartTime: "2026-10-01 03:05:00+00" }, none, now), null);
  assertEquals(candidateOf({ ...m, endDate: "2026-10-03T05:30:59Z" }, none, now), null);                         // ends inside two days
  assertEquals(candidateOf({ ...m, gameStartTime: "2026-10-03 05:30:00+00" }, none, now), null);                   // starts inside them
  assertEquals(candidateOf({ ...m, endDate: "2026-10-03T05:31:00Z", gameStartTime: "2026-10-03 05:31:00+00" }, none, now)?.cond, cond(9));
  assertEquals(candidateOf({ ...m, endDate: "2026-10-29T03:59:00Z", gameStartTime: null }, none, now)?.cond, cond(9)); // a Fed market
  assertEquals(candidateOf(m, none, now)?.cond, cond(9));                                                          // no times: nothing to go on
  assertEquals(candidateOf({ ...m, endDate: "soon" }, none, now)?.cond, cond(9));                                  // nor an unreadable one
  assertEquals(candidateOf({ ...m, endDate: "2026-10-01T06:00:00Z" }, none)?.cond, cond(9));                       // no clock, no horizon
  assertEquals(PM_LIVE_MIN_HORIZON_MS, 2 * DAY);
  assertEquals(
    [pmTime("2026-10-01 03:05:00+00"), pmTime("2026-10-08T02:00:00Z"), pmTime("2026-10-01 03:05:00+05:30"), pmTime("2026-10-29"), pmTime(null), pmTime("")],
    [Date.parse("2026-10-01T03:05:00Z"), Date.parse("2026-10-08T02:00:00Z"), Date.parse("2026-09-30T21:35:00Z"), Date.parse("2026-10-29T00:00:00Z"), null, null],
  );
});

// ------------------------------------------------------------------ the dry-run, as it runs from the push

const nowS = (ms: number) => Math.floor(ms / 1000);
const quoteRows = (w: ReturnType<typeof makeWorld>) => w.open().map((r) => [String(r.cond).slice(-2), r.outcome, r.side, Number(r.price), Number(r.size)].join(" ")).sort();

Deno.test("dry-run, the default: it records SB_REGION and every gate, and writes each order it would send — hash, market, token, side, price, size, GTD expiration, neg_risk, gate, the book it met — and sends nothing", async () => {
  const w = makeWorld();
  const r = await w.turn();
  assertEquals(r.errors, []);
  assertEquals(r.mode, "dry_run");
  assert(r.why.includes("PM_ORDER_SENDS_ENABLED is false"), r.why);
  const st = w.state();
  assertEquals([st.sbRegion, st.mode, st.dryRun, st.armed, st.attested, st.openBlockedBy], ["eu-west-1", "dry_run", true, false, true, null]);
  assertEquals(st.gates, { global_pause: true, risk_readable: true, armed: null, region: true, geoblock: true, closed_only: true, attestation: true, inventory: true, loss_day: true, loss_total: true });
  // The two markets outside RW's universe, never a decoy: A (standard, $3 a day) and B (neg-risk, no programme).
  assertEquals((w.mem.tables.pm_live_markets as Row[]).map((m) => [m.kind, m.cond, m.reward_rate, m.rank]).sort(), [["neg_risk", cond(6), null, 6], ["standard", cond(5), 3, 5]]);
  // BUY YES at the bid and BUY NO at 1 − the ask, at each market's minimum: A 0.45 / 0.47 at 5, B 0.200 / 0.230 at 20.
  assertEquals(quoteRows(w), ["05 no BUY 0.53 5", "05 yes BUY 0.45 5", "06 no BUY 0.77 20", "06 yes BUY 0.2 20"]);
  for (const o of w.orders()) {
    assertEquals([o.mode, o.state, o.order_type, o.post_only, o.gate, Number(o.expiration)], ["dry_run", "live", "GTD", true, "open", nowS(T0) + 60 + 300]);
    const req = o.request as PmOrderStruct & { exchange: string; expiration: string };
    assertEquals(req.exchange, exchangeFor(o.neg_risk === true));
    assertEquals([req.maker, req.signer, req.signatureType, req.expiration], [PM_TEST_FUNDER, PM_TEST_SIGNER, 1, String(o.expiration)]);
    assertEquals(orderHash(req, req.exchange), o.hash);                                  // the id is the struct's EIP-712 hash
    const seen = o.book_seen as { bestBid: number; bestAsk: number; tick: string };
    assertEquals([seen.bestBid, seen.bestAsk], o.cond === cond(5) ? [0.45, 0.47] : [0.2, 0.23]);
    assertEquals(o.neg_risk, o.cond === cond(6));
  }
  assertEquals(w.writes(), []);                                                          // not one request but a GET
  const all = JSON.stringify(w.mem.tables);
  assert(!/"signature"\s*:/.test(all) && !/0x[0-9a-fA-F]{130}\b/.test(all), "no signature is ever written");
  assertEquals(w.events().map((e) => e.kind).sort(), ["gates", "selection"]);
});

Deno.test("dry-run writes only on change: the same book writes nothing; a moved touch re-prices (cancel, then the new order); an order near its expiry is refreshed; one the loop missed expires", async () => {
  const w = makeWorld();
  await w.turn(T0);
  const first = w.orders().length;
  await w.turn(T0 + M);
  assertEquals(w.orders().length, first);
  w.A.bid = 0.46;
  const r = await w.turn(T0 + 2 * M);
  assertEquals(r.cancelled.map((c) => [c.gate, c.outcome]), [["reprice", "cancelled"]]);
  assertEquals(quoteRows(w), ["05 no BUY 0.53 5", "05 yes BUY 0.46 5", "06 no BUY 0.77 20", "06 yes BUY 0.2 20"]);
  // Placed at T0 with expiration T0 + 360 s, an order's life ends at T0 + 300 s; it is replaced once 90 s or less is left.
  const r3 = await w.turn(T0 + 3 * M);
  assertEquals(r3.cancelled, []);
  const r4 = await w.turn(T0 + 4 * M);
  assertEquals(r4.cancelled.map((c) => c.gate).sort(), ["refresh", "refresh", "refresh"]);   // the re-priced one has life left
  assertEquals(w.open().length, 4);
  // Ten minutes with no turn: every open order is past its life, expired, and the next turn places afresh.
  await w.turn(T0 + 15 * M);
  assertEquals(w.orders().filter((o) => o.state === "expired").length, 4);
  assertEquals(w.open().length, 4);
  assert(w.open().every((o) => Number(o.expiration) === nowS(T0 + 15 * M) + 360));
});

// ------------------------------------------------------------------ the day's markets: never RW's universe

Deno.test("selectMarkets: the first standard and the first neg-risk market outside RW's universe, in Gamma's order; RW's never, even listed only as sponsored", async () => {
  const w = makeWorld();
  const sel = await selectMarkets(w.pm.venue(), "2026-10-02", ["standard", "neg_risk"], new Set());
  assertEquals(sel.picks.map((p) => [p.kind, p.cond, p.reward_rate, p.rank, Number(p.tick), Number(p.min_size)]), [["standard", cond(5), 3, 5, 0.01, 5], ["neg_risk", cond(6), null, 6, 0.001, 20]]);
  // Every page of both listings was read: four natively listed markets in two pages of two, five sponsored in three.
  assertEquals(w.pm.calls.filter((c) => c.endsWith("/rewards/markets/current")).length, 5);
  // A one-sided book is passed over: B's ask leaves the book and no other neg-risk market qualifies.
  const w2 = makeWorld();
  w2.B.ask = 1.2;
  const sel2 = await selectMarkets(w2.pm.venue(), "2026-10-02", ["standard", "neg_risk"], new Set());
  assertEquals(sel2.picks.map((p) => p.kind), ["standard"]);
  assertEquals(sel2.note.notFound, ["neg_risk"]);
  // A reward listing it cannot read takes nothing: without it RW's universe cannot be told apart.
  const w3 = makeWorld();
  w3.pm.down.rewards = true;
  assertEquals((await selectMarkets(w3.pm.venue(), "2026-10-02", ["standard"], new Set())).picks, []);
});

Deno.test("a market with a reward rate of $10 or more is never chosen: 300 random worlds, every pick checked against the fake's own listings", async () => {
  let seed = 20261001;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rate = () => { const x = rand(); return x < 0.3 ? null : Math.round(x * 3000) / 100; };   // null, or $0 … $30
  let picked = 0;
  for (let world = 0; world < 300; world++) {
    const pm = new FakePolymarket(() => T0);
    const n = 3 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) {
      const r = rate(), sr = rand() < 0.3 ? rate() : null;
      pm.addMarket({ cond: cond(1000 * world + i), yes: tok(1000 * world + i, "yes"), no: tok(1000 * world + i, "no"), rate: r, sponsoredRate: sr, negRisk: rand() < 0.5, accepting: rand() < 0.9, bid: 0.3, ask: rand() < 0.9 ? 0.33 : 1.5 });
    }
    const sel = await selectMarkets(pm.venue(), "2026-10-02", ["standard", "neg_risk"], new Set());
    for (const p of sel.picks) {
      picked++;
      const m = pm.markets.find((x) => x.cond === p.cond)!;
      const listed = [m.rate, m.sponsoredRate].filter((x): x is number => x != null);
      assert(listed.every((x) => x < 10), `world ${world}: ${p.cond} is listed at ${listed}`);
      // And it is the FIRST eligible market of its kind in Gamma's order (accepting, two-sided, under $10 or unlisted).
      const first = pm.markets.find((x) => x.negRisk === (p.kind === "neg_risk") && x.accepting && x.ask < 1 && [x.rate, x.sponsoredRate].every((y) => y == null || y < 10));
      assertEquals(p.cond, first?.cond);
    }
  }
  assert(picked > 300, `${picked} picks`);
});

Deno.test("the day's selection is made once, retried every five minutes while a kind is missing, and made again on the next UTC day", async () => {
  const w = makeWorld();
  w.pm.down.rewards = true;
  await w.turn(T0);
  assertEquals((w.mem.tables.pm_live_markets as Row[]).length, 0);
  assertEquals(w.orders().length, 0);
  w.pm.down.rewards = false;
  const before = w.pm.calls.length;
  await w.turn(T0 + M);                                                                  // not yet five minutes
  assertEquals(w.pm.calls.slice(before).filter((c) => c.includes("/rewards/")).length, 0);
  await w.turn(T0 + 5 * M);
  assertEquals((w.mem.tables.pm_live_markets as Row[]).length, 2);
  assertEquals(w.open().length, 4);
  const n = w.pm.calls.filter((c) => c.includes("/rewards/")).length;
  await w.turn(T0 + 6 * M);
  assertEquals(w.pm.calls.filter((c) => c.includes("/rewards/")).length, n);            // chosen: not read again today
  await w.turn(T0 + DAY);
  assertEquals((w.mem.tables.pm_live_markets as Row[]).filter((m) => m.day === "2026-10-03").length, 2);
});

Deno.test("selectMarkets applies the horizon: a standard market whose game starts within two days of the selection is passed over for the next", async () => {
  const w = makeWorld();
  w.A.gameStartTime = "2026-10-02 18:00:00+00";                                          // A plays today
  assertEquals((await selectMarkets(w.pm.venue(), "2026-10-02", ["standard"], new Set(), undefined, T0)).picks.map((p) => p.cond), [cond(7)]);
  w.A.gameStartTime = "2026-10-05 18:00:00+00";                                          // three days on: A again
  assertEquals((await selectMarkets(w.pm.venue(), "2026-10-02", ["standard"], new Set(), undefined, T0)).picks.map((p) => p.cond), [cond(5)]);
});

Deno.test("a selected market that leaves the book: recorded once, no fault each minute, its orders closed, its book not read again, its kind chosen again without it", async () => {
  const w = makeWorld();
  const std = () => (w.mem.tables.pm_live_markets as Row[]).find((m) => m.day === "2026-10-02" && m.kind === "standard")?.cond;
  const goneEvents = () => w.events("selection").flatMap((e) => ((e.detail as { gone?: Array<{ cond: string }> }).gone ?? []).map((g) => g.cond));
  const bookReads = () => w.pm.calls.filter((c) => c === "GET clob.polymarket.com/book").length;
  await w.turn(T0);
  assertEquals(std(), cond(5));
  assertEquals(w.open().filter((o) => o.cond === cond(5)).length, 2);
  w.A.resolved = true;                                                                    // its book goes: /book answers 404
  const r1 = await w.turn(T0 + M);
  assertEquals(r1.errors, []);
  assertEquals(w.open().filter((o) => o.cond === cond(5)).length, 0);
  assertEquals(goneEvents(), [cond(5)]);
  const before = bookReads();
  const r2 = await w.turn(T0 + 2 * M);                                                    // inside the five minutes: no pick yet, no fault
  assertEquals(r2.errors, []);
  assertEquals(bookReads() - before, 1);                                                  // B's book alone
  await w.turn(T0 + 5 * M);                                                               // chosen again, without A
  assertEquals(std(), cond(7));
  assertEquals(w.open().filter((o) => o.cond === cond(7)).length, 2);
  assertEquals(goneEvents(), [cond(5)]);                                                  // recorded once
  await w.turn(T0 + DAY);                                                                 // a new UTC day starts afresh
  assertEquals(w.state().gone, []);
});

Deno.test("the selection's deadline: no read starts 40 s into the turn; a listing not read to its end takes nothing, a market already found stands, the rest is tried again in five minutes", async () => {
  // A clock that moves 15 s at each look: the reward listing (five pages here) is not read to its end, so nothing is taken.
  const w = makeWorld();
  let t = 0;
  const r = await w.turn(T0, { clock: () => (t += 15e3) });
  assertEquals((w.mem.tables.pm_live_markets as Row[]).length, 0);
  assert(r.errors.some((e) => e.startsWith("selection: time budget: the reward listing was not read to its end")), r.errors.join(" | "));
  const ev = w.events("selection")[0].detail as Record<string, unknown>;
  assert(Number(ev.rewardPages) < 5 && Number(ev.ms) > 0, JSON.stringify(ev));
  assertEquals(w.pm.calls.filter((c) => c.endsWith("/rewards/markets/current")).length, Number(ev.rewardPages));
  // The deadline passes after the standard market's book was read: it is kept and quoted, and the neg-risk one is looked
  // for again five minutes later. Nothing is sent that turn either: past 40 s, no order goes.
  const w2 = makeWorld();
  const inner = w2.pm.venue();
  let late = false;
  const venue: PmVenue = { ...inner, book: async (token) => { const b = await inner.book(token); late = true; return b; } };
  const r2 = await w2.turn(T0, { venue, clock: () => (late ? 41e3 : 0) });
  assertEquals((w2.mem.tables.pm_live_markets as Row[]).map((m) => [m.kind, m.cond]), [["standard", cond(5)]]);
  assertEquals((w2.events("selection")[0].detail as { notFound: string[] }).notFound, ["neg_risk"]);
  assertEquals(w2.orders().length, 0);
  assertEquals(r2.withheld.map((x) => x.gate), ["time", "time"]);
  await w2.turn(T0 + M);
  assertEquals(quoteRows(w2), ["05 no BUY 0.53 5", "05 yes BUY 0.45 5"]);
  await w2.turn(T0 + 5 * M);
  assertEquals((w2.mem.tables.pm_live_markets as Row[]).map((m) => m.kind).sort(), ["neg_risk", "standard"]);
  assertEquals(quoteRows(w2), ["05 no BUY 0.53 5", "05 yes BUY 0.45 5", "06 no BUY 0.77 20", "06 yes BUY 0.2 20"]);
});

// ------------------------------------------------------------------ the database it may touch

Deno.test("the db double refuses every table outside the path's own list: RW's, RW-C's, the strategy rows'; agent_locks only through its lease; agent_risk read-only", async () => {
  const w = makeWorld();
  for (const t of ["pm_rw_minutes", "pm_rwc_minutes", "pm_rwc_selection", "pm_rw_e_days", "pm_rwc_x_days", "agent_orders", "agent_quote_live_orders"]) {
    let err = "";
    try { await w.db.select(t, "select=*"); } catch (e) { err = String(e); }
    assert(err.includes(`may not touch ${t}`), `${t}: ${err}`);
  }
  let err = "";
  try { await w.db.claim("agent_locks", "name=eq.pmrwc&lease_until=lt.x", { holder: "x" }); } catch (e) { err = String(e); }
  assert(err.includes("own lease row"), err);
  err = "";
  try { await w.db.update("agent_risk", "id=eq.1", { global_pause: true }); } catch (e) { err = String(e); }
  assert(err.includes("read-only"), err);
  // Three hours of turns touch nothing else, and RW's and RW-C's rows are as they were.
  for (let t = T0; t < T0 + 3 * H; t += M) await w.turn(t);
  assert([...w.db.touched].every((t) => PM_LIVE_DB_TABLES.includes(t)), [...w.db.touched].join());
  assertEquals([(w.mem.tables.pm_rw_minutes as Row[]).length, (w.mem.tables.pm_rwc_minutes as Row[]).length, (w.mem.tables.pm_rwc_selection as Row[]).length], [1, 1, 1]);
  assertEquals((w.mem.tables.agent_locks as Row[]).find((l) => l.name === "pmrwc")?.holder, null);
});

Deno.test("0074's constraints hold in the double: one open order per market, token and side; a hash once; a fill only of a known order; a market only under $10", async () => {
  const w = makeWorld();
  await w.turn();
  const o = w.open()[0];
  const { id: _id, ts: _ts, ...copy } = o;
  for (const [row, want] of [
    [{ ...copy }, "pm_live_orders_hash_key"],
    [{ ...copy, hash: `0x${"aa".repeat(32)}` }, "pm_live_orders_one_open_per_slot"],
    [{ ...copy, hash: `0x${"AA".repeat(32)}`, state: "cancelled" }, "pm_live_orders_hash_check"],
    [{ ...copy, hash: `0x${"bb".repeat(32)}`, state: "cancelled", order_type: "GTC" }, "pm_live_orders_order_type_check"],
    [{ ...copy, hash: `0x${"bb".repeat(32)}`, state: "cancelled", price: 1 }, "pm_live_orders_price_check"],
    [{ ...copy, hash: `0x${"bb".repeat(32)}`, state: "cancelled", gate: "maybe" }, "pm_live_orders_gate_check"],
  ] as Array<[Row, string]>) {
    let err = "";
    try { await w.mem.db.insert("pm_live_orders", row); } catch (e) { err = String(e); }
    assert(err.includes(want), `${want}: ${err}`);
  }
  // A settled row is no claim on its slot; an update that would reopen a second one is refused too.
  const [closed] = await w.mem.db.insert<Row>("pm_live_orders", { ...copy, hash: `0x${"cc".repeat(32)}`, state: "cancelled" });
  let err = "";
  try { await w.mem.db.update("pm_live_orders", `id=eq.${closed.id}`, { state: "live" }); } catch (e) { err = String(e); }
  assert(err.includes("one_open_per_slot"), err);
  err = "";
  try { await w.mem.db.upsert("pm_live_fills", [{ trade_id: "t", hash: `0x${"dd".repeat(32)}`, cond: "c", token: "t", side: "BUY", price: 0.5, size: 1, status: "MATCHED" }], "trade_id,hash"); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_fills_hash_fkey"), err);
  err = "";
  try { await w.mem.db.upsert("pm_live_markets", [{ day: "2026-10-09", kind: "standard", cond: "c", yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 10, rank: 1, detail: {} }], "day,kind"); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_markets_reward_rate_check"), err);
  err = "";
  try { await w.mem.db.update("pm_live_config", "id=eq.1", { cap_total_usd: 301 }); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_config_cap_total_usd_check"), err);
  err = "";
  try { await w.mem.db.update("pm_live_config", "id=eq.1", { gtd_lifetime_s: 179 }); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_config_gtd_lifetime_s_check"), err);
  await w.mem.db.update("pm_live_config", "id=eq.1", { gtd_lifetime_s: 180 });            // the floor itself is allowed
  err = "";
  try { await w.mem.db.update("pm_live_config", "id=eq.1", { ireland_attested_at: null, ireland_until: iso(T0) }); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_config_check"), err);
});

// ------------------------------------------------------------------ a whole day through the REAL client

Deno.test("PM_ORDER_SENDS_ENABLED is false: a full simulated day through the real client sends not one request but a GET — as deployed, and with a live config, a key and a caller that claims sends are on", async () => {
  assertEquals(PM_ORDER_SENDS_ENABLED, false);
  const prevRegion = Deno.env.get("SB_REGION");
  Deno.env.set("SB_REGION", "eu-west-1");
  try {
    for (const variant of ["as deployed", "live config, key, sends claimed on"] as const) {
      const live = variant !== "as deployed";
      const w = makeWorld({ realClient: true, live, signer: live });
      for (let t = T0; t < T0 + DAY; t += M) {
        if ((t - T0) % (7 * M) === 0) w.A.bid = w.A.bid === 0.45 ? 0.44 : 0.45;           // a touch that moves
        const r = await w.turn(t);
        if (t === T0) assertEquals(r.mode, live ? "live" : "dry_run");
      }
      assertEquals(w.writes(), [], variant);
      assert(w.pm.calls.length > 1440 * 5, `${w.pm.calls.length} GETs`);
      if (!live) {
        assert(w.orders().length > 1000, `${w.orders().length} dry-run rows`);
        assert(w.orders().every((o) => o.mode === "dry_run"));
      } else {
        // Every order the mistaken live turn tried was refused by the client before a request was built.
        assert(w.orders().length >= 4);
        assert(w.orders().every((o) => o.mode === "live" && o.state === "rejected" && (o.response as { refused?: string }).refused === "sends-disabled"), JSON.stringify(w.orders()[0].response));
      }
    }
  } finally {
    if (prevRegion === undefined) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", prevRegion);
  }
});

// ------------------------------------------------------------------ every gate in the turn, both ways

const sides = (w: ReturnType<typeof makeWorld>) => w.open().map((o) => `${String(o.cond).slice(-2)} ${o.outcome} ${o.side} ${Number(o.price)} ${Number(o.size)} ${o.gate}`).sort();
const OPENING = ["05 no BUY 0.53 5 open", "05 yes BUY 0.45 5 open", "06 no BUY 0.77 20 open", "06 yes BUY 0.2 20 open"];

Deno.test("global pause: every open order cancelled, nothing placed; lifted, the quotes come back", async () => {
  const w = makeWorld();
  await w.turn(T0);
  assertEquals(sides(w), OPENING);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = true;
  const r = await w.turn(T0 + M);
  assertEquals([r.cancelled.length, r.placed.length, w.open().length], [4, 0, 0]);
  assert(r.cancelled.every((c) => c.gate === "global_pause"));
  assertEquals(w.state().gates.global_pause, false);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = false;
  await w.turn(T0 + 2 * M);
  assertEquals(sides(w), OPENING);
});

Deno.test("agent_risk unreadable: nothing opens (it might be paused); what is held may still be sold", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.tokens.set(w.A.yes, 12);
  const broken = { ...w.db, select: (t: string, q: string) => (t === "agent_risk" ? Promise.reject(new Error("db GET agent_risk → 503")) : w.db.select(t, q)) };
  const r = await w.turn(T0 + M, { db: broken as typeof w.db });
  assertEquals(r.gates?.openBlockedBy, "risk_readable");
  assertEquals(sides(w), ["05 yes SELL 0.47 5 reduce"]);
});

Deno.test("region: a runtime that is not eu-west-1 places nothing and withdraws what rests; back in eu-west-1 it quotes again", async () => {
  const w = makeWorld();
  await w.turn(T0);
  const r = await w.turn(T0 + M, { sbRegion: "eu-west-2" });
  assertEquals([r.gates?.openBlockedBy, r.gates?.reduceBlockedBy, w.open().length], ["region", "region", 0]);
  assert(r.cancelled.every((c) => c.gate === "region"));
  assertEquals(w.state().sbRegion, "eu-west-2");                       // recorded every minute
  await w.turn(T0 + 2 * M, { sbRegion: null });
  assertEquals([w.open().length, w.state().sbRegion], [0, null]);
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);
  const z = makeWorld({ region: "eu-west-2" });
  await z.turn(T0);
  assertEquals(z.orders().length, 0);
});

Deno.test("geoblock: a country that is not IE is close-only — buys withdrawn, a holding sold at our ask; an unreadable answer is the same; IE again, it opens", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.geo = { blocked: true, country: "GB", region: "ENG", ip: "198.51.100.1" };
  w.pm.tokens.set(w.A.yes, 12);                                         // 12 YES held in A
  const r = await w.turn(T0 + M);
  assertEquals(r.gates?.openBlockedBy, "geoblock");
  assertEquals(sides(w), ["05 yes SELL 0.47 5 reduce"]);               // YES sold at our ask (A's 0.47), the quote's size
  assert(r.cancelled.every((c) => c.gate === "geoblock"));
  w.pm.down.geoblock = true;
  assertEquals((await w.turn(T0 + 2 * M)).gates?.openBlockedBy, "geoblock");
  assertEquals(sides(w), ["05 yes SELL 0.47 5 reduce"]);
  assert(String((w.mem.tables.pm_live_state as Row[])[0].last_error).includes("geoblock unreadable"));
  w.pm.down.geoblock = false;
  w.pm.geo = { blocked: true, country: "IE", region: "L", ip: "203.0.113.7" };
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);                                      // open again: the sell gives way to the rule's buys
  w.pm.geo = { blocked: true, country: "IR", region: "", ip: "192.0.2.1" };
  const blocked = await w.turn(T0 + 4 * M);
  assertEquals([blocked.gates?.reduceBlockedBy, w.open().length], ["geoblock", 0]);   // blocked completely: not even a sell
});

Deno.test("closed-only: the account's flag (or a flag that cannot be read) makes the path close-only; NO held is sold at 1 − our bid", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.closedOnlyFlag = true;
  w.pm.tokens.set(w.B.no, 50);                                          // 50 NO held in B
  const r = await w.turn(T0 + M);
  assertEquals(r.gates?.openBlockedBy, "closed_only");
  assertEquals(sides(w), ["06 no SELL 0.8 20 reduce"]);                 // our bid 0.200 → NO sold at 0.800, the quote's 20
  w.pm.closedOnlyFlag = false;
  w.pm.down.closedOnly = true;
  assertEquals((await w.turn(T0 + 2 * M)).gates?.openBlockedBy, "closed_only");
  w.pm.down.closedOnly = false;
  // Open again. The 50 NO still held in B count against its $60 cap at $1 a share (no fill prices them), so B's NO bid
  // (20 × 0.77) does not fit beside them; sold, it does.
  const r4 = await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING.filter((s) => !s.startsWith("06 no")));
  assertEquals(r4.withheld.map((x) => x.gate), ["cap_market"]);
  w.pm.tokens.set(w.B.no, 0);
  await w.turn(T0 + 4 * M);
  assertEquals(sides(w), OPENING);
});

Deno.test("attestation: revoked with one statement's effect, the path is close-only from that instant; attested again, it opens", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.setConfig({ ireland_until: iso(T0 + 30e3) });                       // `update … set ireland_until = now()`
  w.pm.tokens.set(w.A.no, 7);
  let r = await w.turn(T0 + M);
  assertEquals([r.gates?.openBlockedBy, w.state().attested], ["attestation", false]);
  assertEquals(sides(w), ["05 no SELL 0.55 5 reduce"]);                 // NO sold at 1 − our bid 0.45
  w.setConfig({ ireland_attested_at: iso(T0 + 90e3), ireland_until: null });
  r = await w.turn(T0 + 2 * M);
  assertEquals([r.gates?.open, w.state().attested], [true, true]);
  assertEquals(sides(w), OPENING);
});

Deno.test("inventory: holdings that cannot be read open nothing and sell nothing", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.down.balance = true;
  const r = await w.turn(T0 + M);
  assertEquals([r.gates?.openBlockedBy, r.gates?.reduceBlockedBy, w.open().length], ["inventory", "inventory", 0]);
  w.pm.down.balance = false;
  await w.turn(T0 + 2 * M);
  assertEquals(sides(w), OPENING);
});

// ------------------------------------------------------------------ caps, stops and the governor

Deno.test("caps: buys' collateral (N × b, N × (1 − a)) and the holdings' cost stay under the market cap and the total cap; an order that would pass one is withheld", async () => {
  // Market cap $3: A's YES bid (5 × 0.45 = 2.25) fits; its NO bid (5 × 0.53) would make 4.90; B's bids (4.00, 15.40) do not fit at all.
  const m = makeWorld({ config: { cap_market_usd: 3 } });
  const r = await m.turn(T0);
  assertEquals(sides(m), ["05 yes BUY 0.45 5 open"]);
  assertEquals(r.withheld.filter((x) => x.gate === "cap_market").length, 3);
  // Total cap $10: 2.25 + 2.65 + 4.00 = 8.90 rests; B's NO bid (15.40) would pass it.
  const t = makeWorld({ config: { cap_total_usd: 10 } });
  await t.turn(T0);
  assertEquals(sides(t), ["05 no BUY 0.53 5 open", "05 yes BUY 0.45 5 open", "06 yes BUY 0.2 20 open"]);
  // Holdings count: 30 YES held in B with no fill to price them are counted at $1 a share, so with a $40 market cap
  // B's YES bid fits (30 + 4) and its NO bid does not (34 + 15.40).
  const h = makeWorld({ config: { cap_market_usd: 40 } });
  h.pm.tokens.set(h.B.yes, 30);
  await h.turn(T0);
  assertEquals(sides(h), ["05 no BUY 0.53 5 open", "05 yes BUY 0.45 5 open", "06 yes BUY 0.2 20 open"]);
  // The ceiling: a config row asking for more than $300 / $60 is refused by the database, and the code would not use it.
  assertEquals([effectiveLimits({ ...CONFIG, cap_total_usd: 301 }).capTotal, effectiveLimits({ ...CONFIG, cap_market_usd: 61 }).capMarket], [300, 60]);
});

Deno.test("the governor: at the day's POST limit nothing more is sent, once recorded; the next UTC day it starts again", async () => {
  const w = makeWorld({ config: { max_posts_day: 3 } });
  const r = await w.turn(T0);
  assertEquals([w.orders().length, r.withheld.filter((x) => x.gate === "governor").length], [3, 1]);
  await w.turn(T0 + M);
  assertEquals(w.orders().length, 3);
  assertEquals(w.events("governor").length, 1);
  await w.turn(Date.parse("2026-10-03T00:00:30Z"));
  assert(w.orders().length > 3);
});

Deno.test("loss stops: past the day's limit nothing opens for the rest of the UTC day; past the run's limit nothing opens again; sells stay armed", async () => {
  const w = makeWorld({ live: true, config: { loss_day_usd: 0.5, loss_total_usd: 1 } });
  await w.turn(T0);
  const yes = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "yes")!;
  const trade = w.pm.fill(String(yes.hash), 5);                         // 5 YES bought at 0.45
  w.pm.settle(trade, "CONFIRMED");
  w.A.bid = 0.33; w.A.ask = 0.35;                                       // marked at 0.34: −0.55 today
  let r = await w.turn(T0 + M);
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -0.55, total: -0.55 }, "loss_day"]);
  assertEquals(sides(w), ["05 yes SELL 0.35 5 reduce"]);                // the holding is sold at our ask; nothing bought
  assertEquals(w.events("loss_stop_day").length, 1);
  // The mark recovers within the day: the day's stop holds until midnight.
  w.A.bid = 0.45; w.A.ask = 0.47;
  r = await w.turn(T0 + 2 * M);
  assertEquals(r.gates?.openBlockedBy, "loss_day");
  // A new UTC day: it opens again.
  r = await w.turn(Date.parse("2026-10-03T00:01:00Z"));
  assertEquals(r.gates?.open, true);
  // Past the run's limit (−1): stopped for good, whatever the day.
  w.A.bid = 0.20; w.A.ask = 0.22;
  r = await w.turn(Date.parse("2026-10-03T00:02:00Z"));
  assertEquals(r.gates?.openBlockedBy, "loss_day");
  assertEquals(w.events("loss_stop_total").length, 1);
  w.A.bid = 0.45; w.A.ask = 0.47;
  r = await w.turn(Date.parse("2026-10-04T00:01:00Z"));
  assertEquals(r.gates?.openBlockedBy, "loss_total");
});

// ------------------------------------------------------------------ the live path, against the strict fake (tests only: sends are off in code)

Deno.test("armed: in live mode `live_confirmed_at` cleared places nothing that opens, while a holding is still sold; set, it opens", async () => {
  const w = makeWorld({ live: true, config: { live_confirmed_at: null } });
  w.pm.tokens.set(w.A.yes, 10);
  const r = await w.turn(T0);
  assertEquals([r.mode, r.gates?.openBlockedBy], ["live", "armed"]);
  assertEquals(sides(w), ["05 yes SELL 0.47 5 reduce"]);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 1);
  w.setConfig({ live_confirmed_at: iso(T0) });
  await w.turn(T0 + M);
  assertEquals(sides(w), OPENING);
});

Deno.test("the three locks: sends disabled in code, dry_run on, or no key matching the stored signer — each alone keeps the path a dry-run that sends nothing", async () => {
  const other = new PmOrderKey("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");   // Hardhat's published #1: not the stored signer
  for (const [label, setup, why] of [
    ["sends disabled in code", { sendsEnabled: false }, "PM_ORDER_SENDS_ENABLED is false"],
    ["dry_run on", null, "pm_live_config.dry_run is on"],
    ["no key", { signer: null }, "no signing key loaded"],
    ["a key that is not the stored signer", { signer: other }, "no signing key loaded"],
  ] as const) {
    const w = makeWorld({ live: true });
    if (setup === null) w.setConfig({ dry_run: true });
    const r = await w.turn(T0, setup ?? {});
    assertEquals(r.mode, "dry_run", label);
    assert(r.why.includes(why), `${label}: ${r.why}`);
    assertEquals(w.writes(), [], label);
    assertEquals(w.open("live"), [], label);
    assertEquals(w.open("dry_run").length, 4, label);
  }
  // All three open: live, and the four orders go.
  const w = makeWorld({ live: true });
  const r = await w.turn(T0);
  assertEquals([r.mode, w.writes().length, w.open("live").length], ["live", 4, 4]);
});

Deno.test("live: every order is written pending, keyed by its hash, BEFORE its POST; the venue's reply settles it; the hash is the venue's id", async () => {
  const w = makeWorld({ live: true });
  const inner = w.pm.venue();
  const pendingAtPost: Array<string | undefined> = [];
  const venue: PmVenue = {
    ...inner,
    postOrder: (o, t, p) => {
      const m = w.pm.markets.find((x) => x.yes === o.tokenId || x.no === o.tokenId)!;
      pendingAtPost.push(w.orders().find((r) => r.hash === orderHash(o, exchangeFor(m.negRisk)))?.state as string | undefined);
      return inner.postOrder(o, t, p);
    },
  };
  const r = await w.turn(T0, { venue });
  assertEquals(pendingAtPost, ["pending", "pending", "pending", "pending"]);
  assertEquals(sides(w), OPENING);
  assertEquals(r.errors, []);
  for (const o of w.open("live")) assertEquals(w.pm.orders.get(String(o.hash))?.status, "LIVE");
  // Not a signature anywhere in the database, though four were sent.
  const sigs = w.pm.bodies.map((b) => JSON.parse(b).order?.signature).filter(Boolean);
  assertEquals(sigs.length, 4);
  const all = JSON.stringify(w.mem.tables);
  assert(sigs.every((s: string) => !all.includes(s.slice(2, 40))));
});

Deno.test("live: an order is sent only while the turn holds its lease, renewed once half of it is gone; a run that lost it sends nothing more", async () => {
  // 30 s into the turn, and another run has the lease (this one's ran out): nothing is written pending, nothing is sent.
  const w = makeWorld({ live: true });
  const inner = w.pm.venue();
  let late = false;
  const lease = () => (w.mem.tables.agent_locks as Row[]).find((l) => l.name === "pm-live")!;
  const venue: PmVenue = { ...inner, closedOnly: async () => { late = true; lease().holder = "another run"; return await inner.closedOnly(); } };
  const r = await w.turn(T0, { venue, clock: () => (late ? 30e3 : 0) });
  assertEquals(w.writes(), []);
  assertEquals(w.orders(), []);
  assertEquals(r.withheld.map((x) => x.gate), ["lease", "lease", "lease", "lease"]);
  assert(r.errors.includes("lease lost: another run holds pm-live now; this one sends nothing more"), r.errors.join(" | "));
  assertEquals(lease().holder, "another run");                                         // and its lease is not released by this one
  // Still held 30 s in: renewed for another 55 s from then, and the four orders go.
  const w2 = makeWorld({ live: true });
  const inner2 = w2.pm.venue();
  let late2 = false;
  const leaseAtPost: unknown[] = [];
  const venue2: PmVenue = {
    ...inner2,
    closedOnly: async () => { late2 = true; return await inner2.closedOnly(); },
    postOrder: (o, t, p) => { leaseAtPost.push((w2.mem.tables.agent_locks as Row[]).find((l) => l.name === "pm-live")!.lease_until); return inner2.postOrder(o, t, p); },
  };
  const r2 = await w2.turn(T0, { venue: venue2, clock: () => (late2 ? 30e3 : 0) });
  assertEquals(r2.errors, []);
  assertEquals(leaseAtPost, [iso(T0 + 85e3), iso(T0 + 85e3), iso(T0 + 85e3), iso(T0 + 85e3)]);
  assertEquals(sides(w2), OPENING);
});

Deno.test("a POST whose reply is lost stays pending; the next turn settles it by its hash, and nothing is sent twice", async () => {
  const w = makeWorld({ live: true });
  w.pm.postMode = "lose-reply";
  await w.turn(T0);
  assertEquals(w.open("live").map((o) => o.state), ["pending", "pending", "pending", "pending"]);
  assertEquals(w.pm.orders.size, 4);                                    // the venue took them
  w.pm.postMode = "ok";
  const posts = () => w.pm.calls.filter((c) => c.startsWith("POST")).length;
  await w.turn(T0 + 30e3);                                              // within the grace: the turn's own, left alone
  assertEquals([posts(), w.open("live").filter((o) => o.state === "pending").length], [4, 4]);
  await w.turn(T0 + 61e3);
  assertEquals([posts(), w.open("live").filter((o) => o.state === "live").length], [4, 4]);
});

Deno.test("unknown is never rejected: a 5xx leaves the order pending; one the venue shows nowhere stays pending for a person, and its slot sends nothing", async () => {
  const w = makeWorld({ live: true });
  w.pm.postMode = "500";                                                // not taken, and the reply does not say so
  const r = await w.turn(T0);
  assertEquals(w.open("live").map((o) => o.state), ["pending", "pending", "pending", "pending"]);
  assert(r.errors.every((e) => e.includes("outcome unknown")), r.errors.join("\n"));
  w.pm.postMode = "ok";
  for (const t of [T0 + 2 * M, T0 + 10 * M]) {
    const rr = await w.turn(t);
    assertEquals(w.open("live").map((o) => o.state), ["pending", "pending", "pending", "pending"]);
    assert(rr.errors.some((e) => e.includes("shown nowhere by the venue") && e.includes("for a person")), rr.errors.join("\n"));
    // Its slot does not even try a second order (the database's one-open-per-slot index would refuse it: a last guard).
    assert(!rr.errors.some((e) => e.includes("another open order holds this slot")), rr.errors.join("\n"));
  }
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 4);
  // Accepted with a 5xx: pending, then live on the read-back.
  const v = makeWorld({ live: true });
  v.pm.postMode = "500-after-accept";
  await v.turn(T0);
  v.pm.postMode = "ok";
  await v.turn(T0 + 2 * M);
  assertEquals(v.open("live").map((o) => o.state), ["live", "live", "live", "live"]);
});

Deno.test("an explicit refusal is rejected and the same quote is not sent again; a 425 restart is not a refusal: sent again as a new order", async () => {
  const w = makeWorld({ live: true });
  w.pm.pusd = 0;
  await w.turn(T0);
  assertEquals(w.orders().map((o) => o.state), ["rejected", "rejected", "rejected", "rejected"]);
  assert(w.orders().every((o) => String((o.response as { why: string }).why).includes("not enough balance / allowance")));
  const r = await w.turn(T0 + M);
  assertEquals([w.orders().length, r.withheld.filter((x) => x.gate === "refused").length], [4, 4]);
  w.A.bid = 0.44;                                                       // the rule's price moves: that quote is sent again
  await w.turn(T0 + 2 * M);
  assertEquals(w.orders().length, 5);
  const z = makeWorld({ live: true });
  z.pm.restart = true;
  await z.turn(T0);
  assertEquals(z.orders().map((o) => [o.state, (o.response as { retry: boolean }).retry]), [["rejected", true], ["rejected", true], ["rejected", true], ["rejected", true]]);
  z.pm.restart = false;
  await z.turn(T0 + M);
  assertEquals(z.open("live").length, 4);
  assertEquals(new Set(z.orders().map((o) => o.hash)).size, 8);           // new orders, new hashes
});

Deno.test("reconciliation by hash: a fill is read from the order and its trades until CONFIRMED; FAILED is no fill; P&L counts CONFIRMED only", async () => {
  const w = makeWorld({ live: true });
  w.pm.tradeStatusPrefix = "TRADE_STATUS_";                             // the OpenAPI's spelling
  await w.turn(T0);
  const yes = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "yes")!;
  const no = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "no")!;
  const t1 = w.pm.fill(String(yes.hash), 5);
  const t2 = w.pm.fill(String(no.hash), 2);
  let r = await w.turn(T0 + M);
  assertEquals(w.orders().find((o) => o.hash === yes.hash)?.state, "filled");
  assertEquals([w.orders().find((o) => o.hash === no.hash)?.state, Number(w.orders().find((o) => o.hash === no.hash)?.size_matched)], ["live", 2]);
  const fills = () => (w.mem.tables.pm_live_fills as Row[]).map((f) => [f.trade_id, f.status, Number(f.size), Number(f.price)]).sort();
  assertEquals(fills(), [[t1, "MATCHED", 5, 0.45], [t2, "MATCHED", 2, 0.53]]);
  assertEquals(r.pnl, { day: 0, total: 0 });                             // nothing CONFIRMED yet
  w.pm.settle(t1, "CONFIRMED");
  w.pm.settle(t2, "FAILED");
  r = await w.turn(T0 + 2 * M);
  assertEquals(fills(), [[t1, "CONFIRMED", 5, 0.45], [t2, "FAILED", 2, 0.53]]);
  // 5 YES at 0.45 marked at A's mid 0.46: +0.05. The failed NO fill counts nowhere.
  assertEquals(r.pnl, { day: 0.05, total: 0.05 });
});

Deno.test("cancel, then post: the replacement goes only after the cancel is READ BACK; a cancel the venue did not take freezes the slot until it does", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const slotCalls = () => w.pm.calls.filter((c) => !c.includes("/book") && !c.includes("geoblock") && !c.includes("closed-only") && !c.includes("balance"));
  w.A.bid = 0.46;
  w.pm.calls.length = 0;
  await w.turn(T0 + M);
  // Every open order is read back first (four GETs); then, for the moved slot alone: the DELETE, its read-back, the POST.
  assertEquals(slotCalls().map((c) => c.replace(/\/data\/order\/.*/, "/data/order/*")), [
    ...Array(4).fill("GET clob.polymarket.com/data/order/*"), "DELETE clob.polymarket.com/order", "GET clob.polymarket.com/data/order/*", "POST clob.polymarket.com/order",
  ]);
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
  // A lost cancel: the venue says canceled and the order rests on. Frozen: no replacement, asked again each turn.
  w.pm.cancelMode = "lost";
  w.A.bid = 0.44;
  let r = await w.turn(T0 + 2 * M);
  assertEquals(r.cancelled.map((c) => c.outcome), ["frozen"]);
  assert(r.errors.some((e) => e.includes("FROZEN")));
  assert(!r.errors.some((e) => e.includes("another open order holds this slot")), r.errors.join("\n"));
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
  r = await w.turn(T0 + 3 * M);
  assertEquals([r.cancelled.map((c) => c.outcome), w.pm.calls.filter((c) => c.startsWith("POST")).length], [["frozen"], 1]);   // only the 0.46 order since the reset
  // The cancel lands (its reply lost this time): read back cancelled, and the replacement follows. (The three orders
  // placed at T0 are refreshed in the same turn: 60 s of their life is left.)
  w.pm.cancelMode = "throw";
  r = await w.turn(T0 + 4 * M);
  assertEquals(r.cancelled.filter((c) => c.slot === "0x0000…0005|yes|BUY").map((c) => [c.gate, c.outcome]), [["reprice", "cancelled"]]);
  assertEquals(r.cancelled.filter((c) => c.slot !== "0x0000…0005|yes|BUY").map((c) => c.gate), ["refresh", "refresh", "refresh"]);
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.44 5 open"]);
});

Deno.test("an order that fills while it is being cancelled is not replaced in that turn: the next turn reads the holding it made first", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const inner = w.pm.venue();
  // The touch moves; as the cancel goes out, a taker takes the whole order, so the DELETE finds it matched.
  const venue: PmVenue = { ...inner, cancelOrder: async (id) => { if (w.pm.orders.get(id)?.status === "LIVE") w.pm.fill(id, 1e9); return await inner.cancelOrder(id); } };
  w.A.bid = 0.46;
  const posts = () => w.pm.calls.filter((c) => c.startsWith("POST")).length;
  const before = posts();
  const r = await w.turn(T0 + M, { venue });
  assertEquals(r.cancelled.map((c) => [c.slot, c.outcome]), [["0x0000…0005|yes|BUY", "filled"]]);
  assertEquals(posts(), before);                                                   // nothing in its place this turn
  assertEquals(w.orders().filter((o) => o.cond === cond(5) && o.outcome === "yes").map((o) => o.state), ["filled"]);
  // The next turn reads the five YES it bought, and the bid goes back at the new touch.
  const r2 = await w.turn(T0 + 2 * M);
  assertEquals(r2.markets.find((m) => m.cond === cond(5))?.held, { yes: 5, no: 0 });
  assertEquals(posts(), before + 1);
  assertEquals(sides(w).filter((x) => x.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
});

Deno.test("global pause, live: one cancel-all, every open order read back cancelled, nothing placed; lifted, it quotes again", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = true;
  w.pm.calls.length = 0;
  await w.turn(T0 + M);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("DELETE")), ["DELETE clob.polymarket.com/cancel-all"]);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 0);
  assertEquals([w.open("live").length, [...w.pm.orders.values()].filter((o) => o.status === "LIVE").length], [0, 0]);
  w.pm.calls.length = 0;
  await w.turn(T0 + 2 * M);
  assertEquals(w.pm.calls.filter((c) => !c.startsWith("GET")), []);                // nothing open: nothing to cancel, nothing placed
  (w.mem.tables.agent_risk as Row[])[0].global_pause = false;
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);
});

Deno.test("the fake is as strict as the CLOB: off-tick, under-minimum, too-near expiry, a foreign signature, maker or signer, a crossing post-only order, a duplicate, closed-only and a blocked country are all refused", async () => {
  const w = makeWorld({ live: true });
  const v = w.pm.venue();
  const key = new PmOrderKey(PM_TEST_KEY), other = new PmOrderKey(`0x${"11".repeat(32)}`);
  const exp = nowS(T0) + 300;
  type Make = Partial<{
    price: number; size: number; side: "BUY" | "SELL"; maker: string; signer: string; expiration: number; negRisk: boolean; by: PmOrderKey; salt: string;
    amounts: { makerAmount: string; takerAmount: string };
  }>;
  /** An order as the path builds it, with any field overridden BEFORE it is hashed and signed (or after, for `negRisk`). */
  const make = (p: Make = {}) => {
    const b = buildOrderFor({ tokenId: w.A.yes, side: p.side ?? "BUY", price: p.price ?? 0.44, size: p.size ?? 5, tick: "0.01", negRisk: false,
      maker: p.maker ?? PM_TEST_FUNDER, signer: p.signer ?? PM_TEST_SIGNER, salt: p.salt ?? "77", timestampMs: T0, expiration: p.expiration ?? exp });
    const order = { ...b.order, ...(p.amounts ?? {}) };
    return { ...order, signature: (p.by ?? key).signDigest(orderHash(order, exchangeFor(p.negRisk ?? false))) };
  };
  const err = async (o: ReturnType<typeof make>) => (await v.postOrder(o, "GTD", true)).error ?? "accepted";
  assertEquals(await err(make()), "accepted");
  // 10 shares for $4.45 is a price of 0.445: off the 0.01 tick (the official rounding never builds one; the venue still refuses it).
  assert((await err(make({ salt: "78", amounts: { makerAmount: "4450000", takerAmount: "10000000" } }))).includes("breaks minimum tick size rule"));
  assert((await err(make({ salt: "79", size: 4 }))).includes("lower than the minimum"));
  assertEquals(await err(make({ salt: "80", expiration: nowS(T0) + 179 })), "invalid expiration");
  assertEquals(await err(make({ salt: "81", by: other })), "invalid signature");
  assertEquals(await err(make({ salt: "82", negRisk: true })), "invalid signature");             // signed for the wrong exchange
  assertEquals(await err(make({ salt: "83", maker: `0x${"22".repeat(20)}` })), "the order owner has to be the owner of the API KEY");
  assertEquals(await err(make({ salt: "84", signer: other.address(), by: other })), "the order signer address has to be the address of the API KEY");
  assertEquals(await err(make({ salt: "85", price: 0.47 })), "invalid post-only order: order crosses book");
  assert((await err(make())).includes("Duplicated"));
  assertEquals(await err(make({ salt: "86", side: "SELL", price: 0.48 })), "not enough balance / allowance");   // nothing held to sell
  w.pm.closedOnlyFlag = true;
  assert((await err(make({ salt: "87" }))).includes("closed only mode"));
  w.pm.closedOnlyFlag = false;
  w.pm.geo = { blocked: true, country: "GB", region: "ENG", ip: "198.51.100.1" };
  assertEquals(await err(make({ salt: "88" })), "trading restricted in GB");
});

// ------------------------------------------------------------------ the action, as the one-minute job calls it

Deno.test("agents?action=pmlive: it never asks for the private key, records the runtime's SB_REGION, signs its account reads, scrubs what it returns, and never throws", async () => {
  const w = makeWorld();
  const secret = btoa("TEST-L2-SECRET-32-BYTES-LONG-001");
  const planted: Record<string, string> = {
    POLYMARKET_PRIVATE_KEY: PM_TEST_KEY, POLYMARKET_CLOB_API_KEY: PM_TEST_OWNER, POLYMARKET_CLOB_SECRET: secret, POLYMARKET_CLOB_PASSPHRASE: "test-passphrase-123",
    POLYMARKET_FUNDER_ADDRESS: PM_TEST_FUNDER, POLYMARKET_SIGNER_ADDRESS: PM_TEST_SIGNER, POLYMARKET_SIG_TYPE: "1", SB_REGION: "eu-west-1",
  };
  const asked: string[] = [];
  const read = (n: string) => { asked.push(n); return planted[n]; };
  const r = await runPmLiveAction({ db: w.db, fetchImpl: w.pm.fetch, read, now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(!asked.includes("POLYMARKET_PRIVATE_KEY"), asked.join());
  assertEquals([r.mode, r.sbRegion, r.errors], ["dry_run", "eu-west-1", []]);
  assertEquals(w.open().length, 4);
  assertEquals(w.writes(), []);
  assert(!w.pm.calls.some((c) => c.endsWith("(401)")), "every account read carried the key's L2 headers");
  assert(!JSON.stringify(r).includes("test-passphrase-123") && !JSON.stringify(r).includes(secret));
  // A database that refuses everything: a report, not a throw.
  const broken = { ...w.db, claim: () => Promise.reject(new Error("db PATCH agent_locks → 503")) };
  const r2 = await runPmLiveAction({ db: broken as typeof w.db, fetchImpl: w.pm.fetch, read, now: T0 + M }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(r2.errors[0].startsWith("LEASE CLAIM FAILED"), JSON.stringify(r2));
  // Missing secrets are named in the report, and the turn still runs its public reads.
  const r3 = await runPmLiveAction({ db: makeWorld().db, fetchImpl: w.pm.fetch, read: (n) => (n === "SB_REGION" ? "eu-west-1" : undefined), now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(r3.errors.some((e) => e.startsWith("secrets:")) && r3.errors.some((e) => e.startsWith("closed-only flag unreadable")), r3.errors.join("\n"));
});
