// Polymarket's order path (pm_live.ts) against doubles no looser than what they stand in for: the in-memory database with
// 0074's and 0076's checks and unique indexes (testing.ts), held by `onlyTables` to the path's own tables, and a fake
// Polymarket that refuses what the CLOB refuses (a price off the tick, a size under the minimum, an expiration too near, a
// signature that does not recover to the API key's address, a maker or signer that is not the account's, a post-only
// order that would take — our own resting orders included, since the market has one book —, an unfunded order, a buy in
// closed-only mode or from a blocked country), whose book holds our own resting orders, whose reward listing pages and
// moves as the CLOB's does, and which can lose a reply or a cancel.
//
// What is pinned: RW's rule as the path quotes it (golden against RW's own `stepRw` on RW's recorded books), the
// minute's formula (golden against `stepRw`'s reward line), the selection (golden against RW's own `firstScore` and
// `choose` over random worlds, and every filter of the universe load-bearing), the listing read whole and proved so,
// the readout, settlement, the collateral guard, the geoblock's ten minutes, a market's condition kept out of the
// faults; and, as before, every gate both ways, close-only case by case, the caps, the stops and the governor,
// pending-before-POST, unknown against rejected, reconciliation by hash, cancel-then-post. The counterfactuals (each rule
// removed in turn, each failing a pin here) are listed in docs/agents/reviews/2026-10-01-polymarket-live-calibration.md.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import golden from "../../../docs/agents/backtests/polymarket/results/rw_golden.json" with { type: "json" };
import {
  buildOrder as buildOrderFor, exchangeFor, orderHash, PM_GTD_EARLY_S, PM_GTD_MIN_LEAD_S, PM_ORDER_SENDS_ENABLED, PmL2Creds, PmOrderKey, pmVenue,
  type PmOrderStruct, type PmVenue,
} from "../_shared/polymarket_orders.ts";
import type { PmLevel } from "../_shared/polymarket_public.ts";
import { choose, firstScore, newAcc, RW_INV_CAP, scoreS, sizeN, stepRw, summarize, type BookRow } from "./pmrw.ts";
import { excludedByDay } from "./pmrw_e.ts";
import {
  attestationCurrent, bookNow, bookPnl, bookProtocol, bookQualityOf, candidateOf, closeOnly, crosses, cursorOffset, effectiveLimits, gates, geoOf, inUniverse, inYesBook, minuteFormula, onTick,
  othersLevels, placeholderQuotes, PM_LIVE_INSTANCE, PM_MINI_INSTANCE, PM_MINI_QUALITY, scoresAt, withOwnLevels, PM_LIVE_CANCEL_REREAD_MS, PM_LISTING_OVERLAP, refusalWait, PM_LIVE_DB_TABLES, PM_LIVE_GEO_CACHE_MS, PM_LIVE_LEASE_MS, PM_LIVE_LIFETIME_S, PM_LIVE_MAX_N,
  PM_LIVE_CAP_TOTAL_USD, PM_LIVE_LOSS_TOTAL_USD, PM_LIVE_MIN_FORMULA_DAY_USD, PM_LIVE_MIN_HORIZON_MS, PM_LIVE_REWARD_FLOOR, PM_LIVE_REWARD_RATE_MAX, PM_LIVE_SELECT_UNTIL_MS, PM_LIVE_SEND_UNTIL_MS,
  PM_LIVE_TIMEOUT_MS, PM_OPEN_GATES, pmTime, postOutcome, rewardListing, rewardRate, runPmLive, rweSameDay, rwQuotes, selectMarkets, settlementFills,
  stateOfStatus, tokenBooks, tradeStatus, type GateInputs, type PmBookNow, type PmLiveConfig, type PmMarketRow, type PmOwnOrder, type PmQuoteRule,
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
  cap_total_usd: 300, cap_market_usd: 60, loss_day_usd: 25, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 300, max_markets: 2, select_budget_usd: 40,
};

type WorldOpts = {
  live?: boolean; region?: string | null; config?: Partial<PmLiveConfig>; signer?: boolean; rule?: PmQuoteRule; realClient?: boolean; wide?: boolean;
  /**
   * A second level 5 ¢ behind each touch, as deep as the first: outside every market's 4.5 ¢ of its midpoint, so no score
   * moves, and close enough for mini-pool's book-quality rule to take the market (2026-10-04).
   */
  deep?: boolean;
};

/**
 * The universe is a reward rate in [$6, $10), a maximum spread, N ≤ 20, accepting, nothing ending or starting within 48
 * hours, and a formula of at least $2.50 a day; ranked by RW's first-round reward per dollar. Each decoy below would be
 * ranked above A or B by RW's `firstScore` if the filter it stands for were gone (per dollar a day, A 0.816, B 0.186):
 *   1  $50 a day (RW's universe), 5.10       2  $10 exactly (RW's), 1.02         3  $8 natively, $12 sponsored: RW keeps $12
 *   4  $8, not accepting orders, 0.816 (a tie with A that its id wins)          8  $5.90, under the floor, 0.602
 *   9  $9.90 at N = 25, 0.202                10 $9, ends within 48 hours, 0.918  11 $9, its game starts within 48 hours, 0.918
 *   12 $9, but a formula of $2.25 a day, 0.459
 * and C ($8.50, 0.144) ranks behind B by RW's ranking though its pool is larger: a rate ranking would take it first.
 * With two markets and $40, RW's rule takes A (standard) and B (neg-risk).
 */
function makeWorld(o: WorldOpts = {}) {
  const clock = { now: T0 };
  const pm = new FakePolymarket(() => clock.now);
  const add = (n: number, extra: Record<string, unknown>) => {
    const m = pm.addMarket({ cond: cond(n), yes: tok(n, "yes"), no: tok(n, "no"), depth: [[0, 5]], ...extra });
    if (o.deep) m.depth = [...m.depth, [Math.round(0.05 / Number(m.tick)), m.depth[0][1]]];
    return m;
  };
  add(1, { rate: 50, bid: 0.30, ask: 0.32 });
  add(2, { rate: 10, bid: 0.60, ask: 0.62 });
  add(3, { rate: 8, sponsoredRate: 12, bid: 0.40, ask: 0.42 });
  add(4, { rate: 8, accepting: false, bid: 0.40, ask: 0.42 });
  const A = add(5, { rate: 8, bid: 0.45, ask: o.wide ? 0.50 : 0.47, minSize: 5 });
  const B = add(6, { rate: 7, negRisk: true, bid: 0.20, ask: 0.23, tick: "0.001", minSize: 20, depth: [[0, 20]] });
  const C = add(7, { rate: 8.5, bid: 0.50, ask: 0.52, minSize: 20, depth: [[0, 40]] });
  add(8, { rate: 5.9, bid: 0.45, ask: 0.47 });
  add(9, { rate: 9.9, bid: 0.45, ask: 0.47, minSize: 25, depth: [[0, 25]] });
  add(10, { rate: 9, bid: 0.45, ask: 0.47, endDate: iso(T0 + DAY) });
  add(11, { rate: 9, bid: 0.45, ask: 0.47, gameStartTime: "2026-10-03 18:00:00+00" });
  add(12, { rate: 9, bid: 0.45, ask: 0.47, depth: [[0, 15]] });
  const mem = memDb({
    agent_locks: [{ name: "pm-live", lease_until: iso(0), holder: null }, { name: "pmrwc", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: false }],
    pm_live_config: [{ ...CONFIG, dry_run: !o.live, live_confirmed_at: o.live ? "2026-10-02T00:00:00.000Z" : null, ...o.config }],
    pm_live_markets: [], pm_live_orders: [], pm_live_fills: [], pm_live_events: [], pm_live_state: [], pm_live_minutes: [], pm_live_reward_days: [], pm_live_settlements: [],
    // RW's and RW-C's tables exist beside it, as in production, with a row each: the path must never read them.
    pm_rw_minutes: [{ cond: cond(1), minute: iso(T0) }], pm_rwc_minutes: [{ cond: cond(1), minute: iso(T0) }], pm_rwc_selection: [{ day: "2026-10-02", cond: cond(1) }],
  }, { now: () => clock.now });
  const db = onlyTables(mem.db, PM_LIVE_DB_TABLES, { lease: "pm-live", readOnly: ["agent_risk"] });
  let salt = 1000;
  const key = new PmOrderKey(PM_TEST_KEY);
  const w = {
    clock, pm, mem, db, A, B, C,
    /** Every pause the turns asked for, in order: the tests never sleep. */
    pauses: [] as number[],
    venue: (): PmVenue => (o.realClient
      ? pmVenue({ fetchImpl: pm.fetch, sigType: 1, creds: new PmL2Creds(PM_TEST_OWNER, btoa("TEST-L2-SECRET-32-BYTES-LONG-001"), "test-passphrase"), address: PM_TEST_SIGNER, now: () => clock.now })
      : pm.venue()),
    async turn(at = clock.now, extra: Partial<Parameters<typeof runPmLive>[0]> = {}) {
      clock.now = at;
      return await runPmLive({
        db, now: at, holder: `h${at}`, venue: w.venue(), sbRegion: o.region === undefined ? "eu-west-1" : o.region, sendsEnabled: true,
        account: { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER }, signer: o.live || o.signer !== false ? key : null, salt: () => String(salt++), rule: o.rule,
        pause: (ms: number) => { w.pauses.push(ms); return Promise.resolve(); }, ...extra,
      });
    },
    orders: () => mem.tables.pm_live_orders as Row[],
    open: (mode?: string) => (mem.tables.pm_live_orders as Row[]).filter((r) => (r.state === "pending" || r.state === "live") && (!mode || r.mode === mode)),
    events: (kind?: string) => (mem.tables.pm_live_events as Row[]).filter((e) => !kind || e.kind === kind),
    markets: () => mem.tables.pm_live_markets as Row[],
    minutes: () => mem.tables.pm_live_minutes as Row[],
    state: () => (mem.tables.pm_live_state as Row[])[0]?.state as Record<string, any>,
    setConfig(p: Partial<PmLiveConfig>) { Object.assign((mem.tables.pm_live_config as Row[])[0], p); },
    writes: () => pm.calls.filter((c) => !c.startsWith("GET ")),
  };
  return w;
}

// ------------------------------------------------------------------ the pure rules

Deno.test("effectiveLimits: a config row may lower every cap and stop, and never raise one past the code's ceiling; the day's markets and budget likewise", () => {
  assertEquals(effectiveLimits(CONFIG), { capTotal: 300, capMarket: 60, lossDay: 25, lossTotal: 75, maxPosts: 6000, lifetimeS: 300, maxMarkets: 2, budget: 40 });
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: 1000, cap_market_usd: 61, loss_day_usd: 100, loss_total_usd: 76, max_posts_day: 99999, gtd_lifetime_s: 3600, max_markets: 99, select_budget_usd: 1000 }),
    { capTotal: 320, capMarket: 60, lossDay: 25, lossTotal: 75, maxPosts: 6000, lifetimeS: 600, maxMarkets: 12, budget: 320 });
  // The total ceiling is the $400 Davies named less the −$75 stop and a $5 margin; 0076 seeds it, and a row may go up to it.
  assertEquals(PM_LIVE_CAP_TOTAL_USD, 400 - PM_LIVE_LOSS_TOTAL_USD - 5);
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: 320, select_budget_usd: 160, max_markets: 8 }), { capTotal: 320, capMarket: 60, lossDay: 25, lossTotal: 75, maxPosts: 6000, lifetimeS: 300, maxMarkets: 8, budget: 160 });
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: "120", cap_market_usd: 20, loss_day_usd: 5, loss_total_usd: 10, max_posts_day: 3, gtd_lifetime_s: 30, max_markets: "6", select_budget_usd: "200" }),
    { capTotal: 120, capMarket: 20, lossDay: 5, lossTotal: 10, maxPosts: 3, lifetimeS: 180, maxMarkets: 6, budget: 120 });   // the budget never passes the total cap
  assertEquals(effectiveLimits({ ...CONFIG, cap_total_usd: "nonsense", gtd_lifetime_s: "x" }).capTotal, 320);
  // A row without the day's markets (0076 not run) selects nothing.
  const { max_markets: _m, select_budget_usd: _b, ...old } = CONFIG;
  assertEquals([effectiveLimits(old).maxMarkets, effectiveLimits(old).budget], [0, 0]);
});

Deno.test("a turn's time: an order sent at the last moment a turn allows, answered at its timeout, still meets the venue's 3 minutes; every read ends inside the lease", () => {
  const leadAtVenueS = PM_GTD_EARLY_S + PM_LIVE_LIFETIME_S.min - (PM_LIVE_SEND_UNTIL_MS + PM_LIVE_TIMEOUT_MS) / 1000;
  assertEquals(leadAtVenueS, 195);
  assert(leadAtVenueS >= PM_GTD_MIN_LEAD_S);
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
  assertEquals(gates({ ...ALL_PASS, geo: { ok: false, country: null, region: null, blocked: null } }).openBlockedBy, "geoblock");
  assertEquals(gates({ ...ALL_PASS, closedOnly: null }).openBlockedBy, "closed_only");
  assertEquals(gates({ ...ALL_PASS, sbRegion: null }).openBlockedBy, "region");
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

const BOOK: PmBookNow = { bestBid: 0.45, bestAsk: 0.47, tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels: { bids: [[0.45, 50]], asks: [[0.47, 50]] } };
const MKT = (o: Partial<PmMarketRow> = {}) => ({ day: "2026-10-02", kind: "standard", cond: cond(5), yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 8, rank: 1, question: null, max_spread: 4.5, ...o }) as PmMarketRow;

Deno.test("placeholderQuotes: BUY YES at the best bid, BUY NO at 1 − the best ask on the tick, both at the market's minimum size", () => {
  assertEquals(placeholderQuotes({ market: MKT(), book: { ...BOOK, bestAsk: 0.53 }, held: { yes: 0, no: 0 } }), [
    { outcome: "yes", side: "BUY", price: 0.45, size: 5 },
    { outcome: "no", side: "BUY", price: 0.47, size: 5 },                                     // 1 − 0.53, not 0.47000000000000003
  ]);
  assertEquals(onTick(1 - 0.123, "0.001"), 0.877);
});

Deno.test("closeOnly, case by case: no buy ever; YES sold at our ask and NO at 1 − our bid, at most what is held; flat rests nothing", () => {
  const q = [{ outcome: "yes", side: "BUY", price: 0.45, size: 5 }, { outcome: "no", side: "BUY", price: 0.53, size: 5 }].map((x) => ({ ...x })) as Array<{ outcome: "yes" | "no"; side: "BUY" | "SELL"; price: number; size: number }>;
  assertEquals(closeOnly(q, { yes: 0, no: 0 }, BOOK), []);
  assertEquals(closeOnly(q, { yes: 30, no: 0 }, BOOK), [{ outcome: "yes", side: "SELL", price: 0.47, size: 5 }]);
  assertEquals(closeOnly(q, { yes: 0, no: 30 }, BOOK), [{ outcome: "no", side: "SELL", price: 0.55, size: 5 }]);
  assertEquals(closeOnly(q, { yes: 30, no: 30 }, BOOK), [{ outcome: "no", side: "SELL", price: 0.55, size: 5 }, { outcome: "yes", side: "SELL", price: 0.47, size: 5 }]);
  assertEquals(closeOnly([{ outcome: "no", side: "BUY", price: 0.53, size: 20 }], { yes: 7.5, no: 0 }, BOOK), [{ outcome: "yes", side: "SELL", price: 0.47, size: 7.5 }]);
  assertEquals(closeOnly(q, { yes: 4.99, no: 0 }, BOOK), []);
  assertEquals(closeOnly([{ outcome: "yes", side: "SELL", price: 0.5, size: 50 }, { outcome: "no", side: "BUY", price: 0.53, size: 5 }], { yes: 19.99, no: 0 }, BOOK),
    [{ outcome: "yes", side: "SELL", price: 0.5, size: 19.99 }]);
  for (const held of [{ yes: 0, no: 0 }, { yes: 100, no: 0 }, { yes: 0, no: 100 }, { yes: 100, no: 100 }]) {
    assert(closeOnly(q, held, BOOK).every((x) => x.side === "SELL"), "close-only never buys");
  }
});

Deno.test("crosses: a post-only buy at or over the token's ask, or a sell at or under its bid, would take; NO's book is YES's mirror", () => {
  assertEquals([crosses({ outcome: "yes", side: "BUY", price: 0.46 }, BOOK), crosses({ outcome: "yes", side: "BUY", price: 0.47 }, BOOK)], [false, true]);
  assertEquals([crosses({ outcome: "yes", side: "SELL", price: 0.46 }, BOOK), crosses({ outcome: "yes", side: "SELL", price: 0.45 }, BOOK)], [false, true]);
  assertEquals([crosses({ outcome: "no", side: "BUY", price: 0.53 }, BOOK), crosses({ outcome: "no", side: "BUY", price: 0.55 }, BOOK)], [false, true]);
  assertEquals([crosses({ outcome: "no", side: "SELL", price: 0.55 }, BOOK), crosses({ outcome: "no", side: "SELL", price: 0.53 }, BOOK)], [false, true]);
});

Deno.test("bookNow: the touch and the levels found in the CLOB's order, the market's tick and minimum; a one-sided or out-of-range book is none", () => {
  const raw = { asset_id: "1", timestamp: "1790000000000", hash: "h", tick_size: "0.01", min_order_size: "20", neg_risk: true,
    bids: [{ price: "0.01", size: "100" }, { price: "0.44", size: "10" }, { price: "0.45", size: "0" }], asks: [{ price: "0.99", size: "1" }, { price: "0.47", size: "3" }] };
  assertEquals(bookNow(raw), {
    bestBid: 0.44, bestAsk: 0.47, tick: "0.01", minSize: 20, negRisk: true, at: iso(1790000000000), hash: "h",
    levels: { bids: [[0.44, 10], [0.01, 100]], asks: [[0.47, 3], [0.99, 1]] },                            // a level of size 0 is no level
  });
  assertEquals(bookNow({ ...raw, asks: [] }), null);
  assertEquals(bookNow({ ...raw, tick_size: "0.02" }), null);
  assertEquals(bookNow({ ...raw, bids: [{ price: "0.48", size: "1" }] }), null);
  assertEquals(bookNow({ ...raw, tick_size: "0.1", bids: [{ price: "0.05", size: "1" }] }), null);
  assertEquals(bookNow({ ...raw, min_order_size: "0" }), null);
});

Deno.test("postOutcome: an explicit refusal is rejected, a 425 or 429 rejected and sent again, a 5xx or a lost reply unknown, never rejected", () => {
  const h = `0x${"ab".repeat(32)}`;
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: true, orderID: h, status: "live" } }, h).state, "live");
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: false, errorMsg: "not enough balance / allowance" } }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 400, ms: 1, error: "invalid post-only order: order crosses book" }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 0, ms: 0, error: "sends are disabled", refused: "sends-disabled" }, h).state, "rejected");
  assertEquals(postOutcome({ ok: false, status: 425, ms: 1, error: "restarting" }, h), { state: "rejected", why: "425 restarting: not taken", retry: true });
  assertEquals(postOutcome({ ok: false, status: 429, ms: 1, error: "Too Many Requests" }, h).retry, true);
  for (const r of [{ ok: false, status: 500, ms: 1, error: "order timed out" }, { ok: false, status: 503, ms: 1, error: "Trading is currently disabled" }, { ok: false, status: 0, ms: 5000, error: "Signal timed out." }]) {
    assertEquals(postOutcome(r, h).state, "pending", JSON.stringify(r));
  }
  assertEquals(postOutcome({ ok: true, status: 200, ms: 1, data: { success: true, orderID: `0x${"cd".repeat(32)}` } }, h).state, "pending");
});

Deno.test("tradeStatus, stateOfStatus: both spellings of a trade's status; an order's read-back status to the row's state, an unknown one to none", () => {
  assertEquals([tradeStatus("TRADE_STATUS_CONFIRMED"), tradeStatus("CONFIRMED"), tradeStatus("failed"), tradeStatus("MINED"), tradeStatus("SETTLED")], ["CONFIRMED", "CONFIRMED", "FAILED", "MINED", null]);
  assertEquals(["LIVE", "MATCHED", "CANCELED", "CANCELED_MARKET_RESOLVED", "INVALID", "UNMATCHED"].map(stateOfStatus), ["live", "filled", "cancelled", "cancelled", "rejected", null]);
});

Deno.test("tokenBooks and bookPnl: average cost, realised on sells (today's apart), holdings marked; a settlement realises a holding at its payout", () => {
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
  assertEquals(bookPnl(books, { Y: 0.41, N: 0.5 }), { day: 0.15, total: -1.85 });
  // A market that resolves YES at 1 while 15 YES (at 0.45) and nothing of NO are held: +8.25 realised, nothing held after.
  const s = settlementFills([{ cond: "c", yes_token: "Y", no_token: "N", payout: 1, settled_at: iso(day + 3 * H) }]);
  const after = tokenBooks([
    { token: "Y", side: "BUY", price: 0.40, size: 10, ts: day - H }, { token: "Y", side: "BUY", price: 0.50, size: 10, ts: day + H },
    { token: "Y", side: "SELL", price: 0.60, size: 5, ts: day + 2 * H }, ...s,
  ], day);
  assertEquals(after.Y.held, 0);
  assertAlmostEquals(after.Y.realisedToday, 0.75 + 15 * 0.55, 1e-9);
  assertEquals(bookPnl(after, {}).day, 9);
});

// ------------------------------------------------------------------ RW's rule, as the path quotes it

const G = golden as unknown as { raw_books: Array<{ cond: string; minute: number; v: number; min_size: number; book: { b: PmLevel[]; a: PmLevel[] } | null; row: BookRow | null }> };
const goldenBooks = G.raw_books.filter((x) => x.book && x.book.b.length && x.book.a.length);

Deno.test("rwQuotes is RW's own quote: on every recorded book of RW's golden day, at every inventory, it bids and asks where stepRw does, N each, a side stopped at 3N", () => {
  assert(goldenBooks.length >= 40, `${goldenBooks.length} books`);
  let quoted = 0;
  for (const g of goldenBooks) {
    const levels = { bids: g.book!.b, asks: g.book!.a };
    const book: PmBookNow = { bestBid: g.book!.b[0][0], bestAsk: g.book!.a[0][0], tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels };
    const N = sizeN(g.min_size);
    for (const net of [0, 2.5 * N, 3 * N, -3 * N, -2.9 * N]) {
      const acc = newAcc();
      acc.net = net;
      const want = stepRw(acc, g.minute, summarize(levels.bids, levels.asks, g.v, g.min_size), 0.01, g.v, 100, N, []).decision;
      const got = rwQuotes({ market: MKT({ max_spread: g.v, min_size: g.min_size }), book, held: net >= 0 ? { yes: net, no: 0 } : { yes: 0, no: -net }, own: [] });
      if (!want) { assertEquals(got, [], g.cond); continue; }
      quoted++;
      const exp = [
        ...(want.qb ? [{ outcome: "yes", side: "BUY", price: onTick(want.b, "0.01"), size: N }] : []),
        ...(want.qa ? [{ outcome: "no", side: "BUY", price: onTick(1 - want.a, "0.01"), size: N }] : []),
      ];
      assertEquals(got, exp, `${g.cond} net ${net}`);
    }
  }
  assert(quoted > 100, `${quoted} quoted`);
  assertEquals(RW_INV_CAP, 3);
  // A market row without a reward programme (0074's picks, on the day 0076 lands) is quoted nothing.
  const g = goldenBooks[0], lv = { bids: g.book!.b, asks: g.book!.a };
  const bk: PmBookNow = { bestBid: lv.bids[0][0], bestAsk: lv.asks[0][0], tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels: lv };
  assertEquals(rwQuotes({ market: MKT({ max_spread: null }), book: bk, held: { yes: 0, no: 0 }, own: [] }), []);
});

Deno.test("minuteFormula at placement is RW's reward line wherever our quotes leave the venue's midpoint where the rest of the book put it; elsewhere the midpoint is the venue's, with them in it", () => {
  let same = 0, moved = 0;
  for (const g of goldenBooks) {
    const levels = { bids: g.book!.b, asks: g.book!.a };
    const N = sizeN(g.min_size), rate = 144;
    const acc = newAcc();
    const want = stepRw(acc, g.minute, summarize(levels.bids, levels.asks, g.v, g.min_size), 0.01, g.v, rate, N, []).decision;
    const book: PmBookNow = { bestBid: levels.bids[0][0], bestAsk: levels.asks[0][0], tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels };
    const quotes = rwQuotes({ market: MKT({ max_spread: g.v, min_size: g.min_size }), book, held: { yes: 0, no: 0 }, own: [] });
    const f = minuteFormula({ rate, v: g.v, minSize: g.min_size, levels, inBook: [], quotes });
    // The venue's book is the book with our quotes in it: its size-cutoff midpoint is the formula's.
    const v = withOwnLevels(levels, quotes), vrow = summarize(v.bids, v.asks, g.v, g.min_size);
    if (!want) { assertEquals(f.formula, 0, g.cond); continue; }
    assertEquals(f.mRw, want.m);
    assertAlmostEquals(f.m!, (vrow![2]! + vrow![3]!) / 2, 1e-12);
    if (Math.abs(f.m! - want.m) < 1e-12) {
      same++;
      assertAlmostEquals(f.formula, want.reward, 1e-12, g.cond);
      assertAlmostEquals(f.ours, want.ours, 1e-9); assertAlmostEquals(f.others, want.others, 1e-9);
    } else {
      moved++;
      const sc = (d: number) => scoreS(g.v, d * 100) * N;
      assertAlmostEquals(f.ours, Math.min(sc(f.m! - want.b), sc(want.a - f.m!)), 1e-9, g.cond);
      assert(f.ours >= want.ours - 1e-9, `${g.cond}: our quotes setting the midpoint never score less than against the others' (${f.ours} < ${want.ours})`);
    }
  }
  // Both happen on RW's golden day: a book whose quotes are a tick inside a touch that holds the minimum leaves the
  // midpoint where it was; one whose touch is thinner than the minimum, or whose quote is capped at m ± half a tick, moves it.
  assert(same > 20 && moved > 5, `same ${same}, moved ${moved}`);
});

Deno.test("the dry-run's blind spot, from mini-pool's own record of 2026-10-03: resting quotes the book moved away from score as the venue would hold them, which the code before 2026-10-04 read as nothing", () => {
  const q = (bid: number, ask: number, size = 20): PmOwnOrder[] => [{ outcome: "yes", side: "BUY", price: bid, size }, { outcome: "no", side: "BUY", price: onTick(1 - ask, "0.01"), size }];
  const S = (v: number, s: number) => ((v - s) / v) ** 2;
  // 0x067a7888 at 01:04: the rest of the book 0.03 / 0.39 (its 0.27 bid gone for a minute), our 0.29 / 0.38 resting from
  // 01:03. Without them the midpoint is 0.21 and neither quote is inside 6.5 ¢ of it; with them it is 0.335, both 4.5 ¢ out.
  const L1 = { bids: [[0.03, 50]] as PmLevel[], asks: [[0.39, 40]] as PmLevel[] };
  const f1 = minuteFormula({ rate: 8, v: 6.5, minSize: 20, levels: L1, inBook: [], quotes: q(0.29, 0.38) });
  assertAlmostEquals(f1.mRw!, 0.21, 1e-12);
  assertAlmostEquals(f1.m!, 0.335, 1e-12);
  const ours1 = S(6.5, 4.5) * 20, others1 = (S(6.5, 5.5) * 40) / 3;               // the 0.39 ask 5.5 ¢ out; one-sided: a third
  assertAlmostEquals(f1.ours, ours1, 1e-9);
  assertAlmostEquals(f1.others, Math.round(S(6.5, 5.5) * 40 * 1e4) / 1e4 / 3, 1e-9);
  assertAlmostEquals(f1.formula, 8 / 1440 * ours1 / (ours1 + others1), 1e-6);
  // 0x67d66925 at 06:03: the rest 0.02 / 0.13 holding the minimum (0.11 under it), our 0.03 / 0.10. Without them the
  // midpoint is 0.075, our bid exactly 4.5 ¢ out (nothing); with them 0.065, both 3.5 ¢ out, alone in the pool.
  const L2 = { bids: [[0.02, 50]] as PmLevel[], asks: [[0.11, 5], [0.13, 50]] as PmLevel[] };
  const f2 = minuteFormula({ rate: 9, v: 4.5, minSize: 20, levels: L2, inBook: [], quotes: q(0.03, 0.10) });
  assertAlmostEquals(f2.mRw!, 0.075, 1e-12);
  assertAlmostEquals(f2.m!, 0.065, 1e-12);
  assertEquals(f2.others, 0);
  assertAlmostEquals(f2.formula, 9 / 1440, 1e-12);
  // Live, the same quotes are in the book as read: the formula is the same, never counted twice. In the third book a
  // second bid of ours, 12 left of 20 (a replacement beside one not yet gone), holds less than the minimum: counted once,
  // its level is no size-cutoff touch (the midpoint 0.45); counted twice it would be (0.455).
  const L3 = { bids: [[0.42, 50], [0.40, 50]] as PmLevel[], asks: [[0.48, 50], [0.50, 50]] as PmLevel[] };
  const Q3: PmOwnOrder[] = [...q(0.43, 0.47), { outcome: "yes", side: "BUY", price: 0.44, size: 12 }];
  assertAlmostEquals(minuteFormula({ rate: 9, v: 4.5, minSize: 20, levels: L3, inBook: [], quotes: Q3 }).m!, 0.45, 1e-12);
  for (const [L, Q, rate, v] of [[L1, q(0.29, 0.38), 8, 6.5], [L2, q(0.03, 0.10), 9, 4.5], [L3, Q3, 9, 4.5]] as const) {
    const dry = minuteFormula({ rate, v, minSize: 20, levels: L, inBook: [], quotes: Q });
    const live = minuteFormula({ rate, v, minSize: 20, levels: withOwnLevels(L, Q), inBook: Q, quotes: Q });
    assertEquals(JSON.stringify(live), JSON.stringify(dry));
  }
  assertEquals(othersLevels(withOwnLevels(L2, q(0.03, 0.10)), q(0.03, 0.10)), L2);
  // A quote the rest of the book has since crossed is not resting (the venue would have matched it): not in the book, not scored.
  const crossed = minuteFormula({ rate: 9, v: 4.5, minSize: 20, levels: { bids: [[0.02, 50]], asks: [[0.03, 50], [0.13, 50]] }, inBook: [], quotes: q(0.03, 0.10) });
  assertEquals([crossed.qBid, crossed.ours, crossed.formula], [0, 0, 0]);
  // The others' scores at the venue's midpoint are summarize's, digit for digit, at the book's own touch and midpoint.
  for (const g of goldenBooks.slice(0, 30)) {
    const row = summarize(g.book!.b, g.book!.a, g.v, g.min_size);
    if (!row || row[2] === null || row[3] === null) continue;
    assertEquals(scoresAt({ bids: g.book!.b, asks: g.book!.a }, row[0], row[1], (row[2] + row[3]) / 2, g.v, g.min_size), [row[4], row[5]]);
  }
});

Deno.test("our own orders are taken out of the book: the rule and the others' scores are the rest of the market's, so the rule never chases itself and we never score against ourselves", () => {
  // We bid 0.41 × 5 and ask 0.49 × 5 (a BUY of NO at 0.51) into a book of 0.40 / 0.50: the venue shows them in its one book.
  const own = [{ outcome: "yes" as const, side: "BUY" as const, price: 0.41, size: 5 }, { outcome: "no" as const, side: "BUY" as const, price: 0.51, size: 5 }];
  assertEquals([inYesBook(own[0]), inYesBook(own[1]), inYesBook({ outcome: "yes", side: "SELL", price: 0.49 }), inYesBook({ outcome: "no", side: "SELL", price: 0.59 })],
    [{ side: "bid", price: 0.41 }, { side: "ask", price: 0.49 }, { side: "ask", price: 0.49 }, { side: "bid", price: 0.41 }]);
  const levels = { bids: [[0.41, 5], [0.40, 5]] as PmLevel[], asks: [[0.49, 5], [0.50, 5]] as PmLevel[] };
  assertEquals(othersLevels(levels, own), { bids: [[0.40, 5]], asks: [[0.50, 5]] });
  assertEquals(othersLevels({ bids: [[0.41, 8], [0.40, 5]], asks: [[0.50, 5]] }, own).bids, [[0.41, 3], [0.40, 5]]);   // another's 3 at our price stays
  const book: PmBookNow = { bestBid: 0.41, bestAsk: 0.49, tick: "0.01", minSize: 5, negRisk: false, at: null, hash: null, levels };
  // Without ours the touch is 0.40 / 0.50 and RW bids 0.41, asks 0.49: what already rests. Read with them, it would step in.
  assertEquals(rwQuotes({ market: MKT(), book, held: { yes: 0, no: 0 }, own }), own);
  assertEquals(rwQuotes({ market: MKT(), book, held: { yes: 0, no: 0 }, own: [] }).map((x) => x.price), [0.42, 0.52]);
  // The formula: our 5 at 0.41 / 0.49 against the others' 5 at 0.40 / 0.50, not against themselves; the midpoint is the
  // venue's, ours in its book (0.45 either way here: our quotes are a tick inside each side).
  const f = minuteFormula({ rate: 14.4, v: 4.5, minSize: 5, levels, inBook: own, quotes: own });
  const s = (d: number) => ((4.5 - d) / 4.5) ** 2;
  assertAlmostEquals(f.ours, s(4) * 5, 1e-9);
  assertEquals(f.others, 0);                                                                  // 5 ¢ out: outside 4.5, scores nothing
  assertAlmostEquals(f.formula, 14.4 / 1440, 1e-12);                                           // alone in the pool
  // An order under the reward minimum scores nothing; one side alone is RW's min: nothing.
  assertEquals(minuteFormula({ rate: 14.4, v: 4.5, minSize: 20, levels, inBook: own, quotes: own }).formula, 0);
  assertEquals(minuteFormula({ rate: 14.4, v: 4.5, minSize: 5, levels, inBook: [own[0]], quotes: [own[0]] }).formula, 0);
  // The cutoff is on our order's own size: the others' 25 a side at 0.42 / 0.48 qualify at a minimum of 20 and score,
  // our 5 inside them does not; at 20 it does.
  const mine = [{ outcome: "yes" as const, side: "BUY" as const, price: 0.43, size: 5 }, { outcome: "no" as const, side: "BUY" as const, price: 0.53, size: 5 }];
  const deep = (n: number) => ({ bids: [[0.43, n], [0.42, 25]] as PmLevel[], asks: [[0.47, n], [0.48, 25]] as PmLevel[] });
  const cut = minuteFormula({ rate: 14.4, v: 4.5, minSize: 20, levels: deep(5), inBook: mine, quotes: mine });
  assert(cut.row !== null && cut.m !== null && cut.others > 0, JSON.stringify(cut));
  assertEquals([cut.qBid, cut.qAsk, cut.ours, cut.formula], [0, 0, 0, 0]);
  const at20 = mine.map((o) => ({ ...o, size: 20 }));
  assert(minuteFormula({ rate: 14.4, v: 4.5, minSize: 20, levels: deep(20), inBook: at20, quotes: at20 }).formula > 0);
});

// ------------------------------------------------------------------ the universe and the selection

Deno.test("bookQualityOf: each side's levels holding the minimum within 10 ¢ of its touch, the size-cutoff spread with either best taken away, the midpoint's band", () => {
  const rule = { name: "t", levels: 2, spreadOverV: 2, mid: [0.1, 0.9] as [number, number] };
  const x = (bids: PmLevel[], asks: PmLevel[]) => bookQualityOf({ v: 4.5, minSize: 20, levels: { bids, asks }, tick: 0.01 }, rule);
  // Two levels a side holding 20: without the best bid the spread is 0.48 − 0.40 = 8 ¢, without the best ask 0.50 − 0.42 = 8 ¢,
  // both within 2 × 4.5 ¢.
  assertEquals(x([[0.42, 20], [0.40, 25]], [[0.48, 20], [0.50, 30]]), null);
  assertEquals(x([[0.42, 20], [0.39, 25]], [[0.48, 20], [0.50, 30]]), null);                    // 9 ¢: at the bar
  assertEquals(x([[0.42, 20], [0.38, 25]], [[0.48, 20], [0.50, 30]]), "spread");                // 10 ¢: past it
  assertEquals(x([[0.42, 20], [0.40, 25]], [[0.48, 20], [0.52, 30]]), "spread");
  // An order under the minimum is no level of the rule's, at the touch or behind it; nor is one past 10 ¢ of the touch.
  assertEquals(x([[0.44, 5], [0.42, 20], [0.40, 25]], [[0.48, 20], [0.50, 30]]), null);
  assertEquals(x([[0.42, 20], [0.40, 10]], [[0.48, 20], [0.50, 30]]), "depth");
  assertEquals(x([[0.42, 20], [0.31, 50]], [[0.48, 20], [0.50, 30]]), "depth");
  assertEquals(x([[0.05, 20], [0.04, 20]], [[0.09, 20], [0.10, 20]]), "mid");                   // midpoint 0.07
  assertEquals(x([], [[0.48, 20]]), "one-sided");
  // One level a side and a spread of 1.5 v: the size-cutoff spread itself.
  const one = { name: "t1", levels: 1, spreadOverV: 1.5, mid: [0, 1] as [number, number] };
  assertEquals(bookQualityOf({ v: 4.5, minSize: 20, levels: { bids: [[0.42, 20]], asks: [[0.48, 20]] }, tick: 0.01 }, one), null);    // 6 ¢ <= 6.75
  assertEquals(bookQualityOf({ v: 4.5, minSize: 20, levels: { bids: [[0.42, 20]], asks: [[0.49, 20]] }, tick: 0.01 }, one), "spread"); // 7 ¢
  // Mini-pool's rule is the depth alone (Addendum 6): two levels a side holding the minimum within 10 ¢ of the touch,
  // whatever the spread behind them and wherever the midpoint.
  assertEquals(PM_MINI_QUALITY, { name: "two levels a side holding the reward minimum within 10 ¢ of the touch", levels: 2 });
  const mini = (bids: PmLevel[], asks: PmLevel[]) => bookQualityOf({ v: 4.5, minSize: 20, levels: { bids, asks }, tick: 0.01 }, PM_MINI_QUALITY);
  assertEquals(mini([[0.42, 20], [0.33, 25]], [[0.48, 20], [0.57, 30]]), null);                 // 9 ¢ behind each best: still within 10 ¢
  assertEquals(mini([[0.05, 20], [0.04, 20]], [[0.09, 20], [0.10, 20]]), null);                 // midpoint 0.07
  assertEquals(mini([[0.42, 20], [0.40, 19.99]], [[0.48, 20], [0.50, 30]]), "depth");           // the second bid under the minimum
  assertEquals(mini([[0.42, 20], [0.40, 25]], [[0.48, 20], [0.58, 30]]), null);                 // the second ask 10 ¢ away: at the bar
  assertEquals(mini([[0.42, 20], [0.40, 25]], [[0.48, 20], [0.59, 30]]), "depth");              // 11 ¢: past it
  assertEquals(mini([[0.42, 20], [0.40, 25]], [[0.48, 20], [0.49, 1], [0.59, 30]]), "depth");   // a level under the minimum is none
  assertEquals(mini([[0.42, 20], [0.40, 25]], []), "one-sided");
});

Deno.test("mini-pool's selection ranks the books its rule passes first: one it passes over comes back only for the slots and the budget the others leave; the default instance, the path its pre-registration froze, ranks as before", async () => {
  const run = async (inst: typeof PM_LIVE_INSTANCE, edit: (w: ReturnType<typeof makeWorld>) => void = () => {}) => {
    const w = makeWorld({ deep: true });
    edit(w);
    await w.turn(T0, { inst });
    const ranked = w.markets().slice().sort((x, y) => Number(x.rank) - Number(y.rank)).map((m) => m.cond as string);
    return { ranked, note: (w.events("selection")[0]?.detail as Record<string, any>) ?? {} };
  };
  // Every book two levels a side: the rule passes them all, and mini-pool chooses what the default chooses, in its order
  // (the test config's two slots: A, then B).
  const d0 = await run(PM_LIVE_INSTANCE), m0 = await run(PM_MINI_INSTANCE);
  assertEquals([d0.ranked, m0.ranked], [[cond(5), cond(6)], [cond(5), cond(6)]]);
  assertEquals([d0.note.bookQuality, m0.note.bookQuality], [undefined, { rule: PM_MINI_QUALITY.name, passedOver: 0, why: {}, filled: 0 }]);
  // A's book one level a side: the two slots go to the books that pass (B, C), as the ranking without A takes them;
  // the default takes A first.
  const single = (w: ReturnType<typeof makeWorld>) => { w.A.depth = [[0, 5]]; };
  const d1 = await run(PM_LIVE_INSTANCE, single), m1 = await run(PM_MINI_INSTANCE, single);
  const noA = await run(PM_LIVE_INSTANCE, (w) => { w.A.accepting = false; });
  assertEquals([d1.ranked, m1.ranked, noA.ranked], [[cond(5), cond(6)], [cond(6), cond(7)], [cond(6), cond(7)]]);
  assertEquals(m1.note.bookQuality, { rule: PM_MINI_QUALITY.name, passedOver: 1, why: { depth: 1 }, filled: 0 });
  // A third slot and the budget for it: the books that pass leave it, and A comes back for it, behind them. The day
  // quotes what the default's does, in the rule's order.
  const three = (w: ReturnType<typeof makeWorld>) => { single(w); w.setConfig({ max_markets: 3, select_budget_usd: 160 }); };
  const d3 = await run(PM_LIVE_INSTANCE, three), m3 = await run(PM_MINI_INSTANCE, three);
  assertEquals([d3.ranked, m3.ranked], [[cond(5), cond(6), cond(7)], [cond(6), cond(7), cond(5)]]);
  assertEquals(m3.note.bookQuality, { rule: PM_MINI_QUALITY.name, passedOver: 1, why: { depth: 1 }, filled: 1 });
  // A third slot without the budget for A (B and C use $39.04 of $40): nothing comes back.
  const tight = await run(PM_MINI_INSTANCE, (w) => { single(w); w.setConfig({ max_markets: 3 }); });
  assertEquals([tight.ranked, tight.note.bookQuality.filled], [[cond(6), cond(7)], 0]);
  // Mid-pool's instance has no rule.
  assertEquals((await import("./pm_mid.ts")).PM_MID_INSTANCE.bookQuality, undefined);
});

Deno.test("inUniverse and candidateOf: a listed rate in [$6, $10), a spread, N ≤ 20; accepting with two tokens; nothing at $10, nothing unlisted", () => {
  const m = { conditionId: cond(9).toUpperCase().replace("0X", "0x"), clobTokenIds: '["11","12"]', enableOrderBook: true, acceptingOrders: true, closed: false, negRisk: false, question: "Q" };
  const L = (rate: number, v = 4.5, minSize = 20) => new Map([[cond(9), { rate, v, minSize }]]);
  assertEquals([PM_LIVE_REWARD_FLOOR, PM_LIVE_REWARD_RATE_MAX, PM_LIVE_MAX_N, PM_LIVE_MIN_FORMULA_DAY_USD], [6, 10, 20, 2.5]);
  assertEquals(candidateOf(m, L(6))?.rate, 6);
  assertEquals(candidateOf(m, L(9.99))?.rate, 9.99);
  for (const [l, why] of [[L(5.99), "under the floor"], [L(10), "RW's universe"], [L(250), "RW's universe"], [L(8, 0), "no spread"], [L(8, 4.5, 25), "N 25"], [new Map(), "not rewarded"]] as const) {
    assertEquals(candidateOf(m, l as Map<string, { rate: number; v: number; minSize: number }>), null, why);
  }
  assertEquals(candidateOf(m, L(8, 4.5, 4))?.minSize, 4);                                     // N is max(4, 5) = 5
  assertEquals([inUniverse({ rate: 6, v: 1, minSize: 20 }), inUniverse({ rate: 6, v: 1, minSize: 20.01 })], [true, false]);
  assertEquals(candidateOf({ ...m, acceptingOrders: false }, L(8)), null);
  assertEquals(candidateOf({ ...m, enableOrderBook: false }, L(8)), null);
  assertEquals(candidateOf({ ...m, closed: true }, L(8)), null);
  assertEquals(candidateOf({ ...m, clobTokenIds: '["11","12","13"]' }, L(8)), null);
  assertEquals(candidateOf({ ...m, conditionId: "0x12" }, L(8)), null);
  assertEquals([rewardRate({ total_daily_rate: 12 }), rewardRate({ native_daily_rate: 2.5, sponsored_daily_rate: 0.5 }), rewardRate({})], [12, 3, 0]);
});

Deno.test("candidateOf passes over a market whose game starts, or which ends, within two days, and one RW-E would not quote that day — in RW-E's own code", () => {
  const now = Date.parse("2026-10-01T05:31:00Z");
  const m = { conditionId: cond(9), clobTokenIds: '["11","12"]', enableOrderBook: true, acceptingOrders: true, closed: false, negRisk: false, question: "Q" };
  const L = new Map([[cond(9), { rate: 8, v: 4.5, minSize: 20 }]]);
  assertEquals(candidateOf({ ...m, endDate: "2026-10-08T02:00:00Z", gameStartTime: "2026-10-01 03:05:00+00" }, L, now), null);
  assertEquals(candidateOf({ ...m, endDate: "2026-10-03T05:30:59Z" }, L, now), null);
  assertEquals(candidateOf({ ...m, gameStartTime: "2026-10-03 05:30:00+00" }, L, now), null);
  assertEquals(candidateOf({ ...m, endDate: "2026-10-03T05:31:00Z", gameStartTime: "2026-10-03 05:31:00+00" }, L, now)?.cond, cond(9));
  assertEquals(candidateOf(m, L, now)?.cond, cond(9));
  assertEquals(candidateOf({ ...m, endDate: "soon" }, L, now)?.cond, cond(9));
  assertEquals(candidateOf({ ...m, endDate: "2026-10-01T06:00:00Z" }, L)?.cond, cond(9));    // no clock, no horizon
  assertEquals(PM_LIVE_MIN_HORIZON_MS, 2 * DAY);
  // RW-E's same-day rule is RW-E's function: an end before the day's end is excluded that day, at the boundary as RW-E does.
  for (const [day, end] of [["2026-10-02", "2026-10-02T23:59:59Z"], ["2026-10-02", "2026-10-03T00:00:00Z"], ["2026-10-02", "2026-10-01T12:00:00Z"], ["2026-10-02", "2026-12-31T00:00:00Z"]]) {
    const rwe = excludedByDay([{ day, cond: "c", tick: 0, v: 0, min_size: 0, rate: 0, end_date: end }]).get(day)?.has("c") === true;
    assertEquals(rweSameDay(day, end), rwe, `${day} ${end}`);
  }
  assertEquals([rweSameDay("2026-10-02", "2026-10-02T23:59:59Z"), rweSameDay("2026-10-02", "2026-10-03T00:00:00Z"), rweSameDay("2026-10-02", null)], [true, false, false]);
  assertEquals(
    [pmTime("2026-10-01 03:05:00+00"), pmTime("2026-10-08T02:00:00Z"), pmTime("2026-10-01 03:05:00+05:30"), pmTime("2026-10-29"), pmTime(null), pmTime("")],
    [Date.parse("2026-10-01T03:05:00Z"), Date.parse("2026-10-08T02:00:00Z"), Date.parse("2026-09-30T21:35:00Z"), Date.parse("2026-10-29T00:00:00Z"), null, null],
  );
});

const pickConds = (picks: PmMarketRow[]) => picks.map((p) => p.cond);

Deno.test("selectMarkets is RW's ranking on this universe: A then B by first-round reward per dollar, every decoy left out, the pick's RW reading recorded", async () => {
  const w = makeWorld();
  const sel = await selectMarkets(w.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0);
  assertEquals(pickConds(sel.picks), [cond(5), cond(6)]);
  const [a, b] = sel.picks;
  assertEquals([a.kind, a.rank, a.reward_rate, a.n_size, a.max_spread, Number(a.tick), Number(a.min_size)], ["standard", 1, 8, 5, 4.5, 0.01, 5]);
  assertEquals([b.kind, b.rank, b.reward_rate, b.n_size, Number(b.tick), b.neg_risk], ["neg_risk", 2, 7, 20, 0.001, true]);
  assertAlmostEquals(Number(a.capital), 4.9, 1e-9);
  assertAlmostEquals(Number(a.formula_day), 4, 1e-4);                                        // half of $8: the others' score equals ours
  assertAlmostEquals(Number(b.capital), 19.44, 1e-9);
  assertAlmostEquals(Number(b.formula_day), 7 * 9.4914 / (9.4914 + 8.8889), 1e-3);
  assertAlmostEquals(Number(a.per_dollar_day), Number(a.formula_day) / Number(a.capital), 1e-9);
  // What it read: the listings whole, Gamma for the universe only, a book for each eligible market.
  assertEquals([sel.note.universe, sel.note.eligible, sel.note.scored, sel.note.chosen], [7, 4, 3, 2]);
  assertEquals((sel.note.listing as { rewarded: number }).rewarded, 12);
  // C ($8.50) is the third by RW's ranking and has the largest pool of the three: with three markets and room, it comes third.
  const three = await selectMarkets(w.pm.venue(), "2026-10-02", { maxMarkets: 3, budget: 60 }, new Set(), undefined, T0);
  assertEquals(pickConds(three.picks), [cond(5), cond(6), cond(7)]);
  // Whole markets within the budget, RW's `choose`: with $20, B (19.44) does not fit beside A (4.90), and C does not either.
  assertEquals(pickConds((await selectMarkets(w.pm.venue(), "2026-10-02", { maxMarkets: 3, budget: 20 }, new Set(), undefined, T0)).picks), [cond(5)]);
  // A one-sided book is passed over: B's ask leaves the book, and C comes in.
  const w2 = makeWorld();
  w2.B.ask = 1.2;
  assertEquals(pickConds((await selectMarkets(w2.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0)).picks), [cond(5), cond(7)]);
  // A reward listing it cannot read takes nothing: without it RW's universe cannot be told apart.
  const w3 = makeWorld();
  w3.pm.down.rewards = true;
  const s3 = await selectMarkets(w3.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0);
  assertEquals([s3.picks, String(s3.note.error).startsWith("rewards/markets/current")], [[], true]);
  // Nor does a Gamma read, or a book read, that fails (once more, then it decides).
  const w4 = makeWorld();
  w4.pm.down.gamma = true;
  assertEquals((await selectMarkets(w4.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0)).picks, []);
  const w5 = makeWorld();
  w5.pm.down.book = true;
  assertEquals((await selectMarkets(w5.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0)).picks, []);
});

Deno.test("every filter of the universe is load-bearing: with any one gone, RW's ranking takes the decoy it kept out", async () => {
  // The filters' own decoys, by RW's ranking: what the first two picks would be without each. (The counterfactual runs
  // in the design remove each filter from the source; this pins that each decoy would win if it got through.)
  const sel = async (w: ReturnType<typeof makeWorld>) => pickConds((await selectMarkets(w.pm.venue(), "2026-10-02", { maxMarkets: 2, budget: 40 }, new Set(), undefined, T0)).picks);
  const base = makeWorld();
  assertEquals(await sel(base), [cond(5), cond(6)]);
  const variants: Array<[string, (w: ReturnType<typeof makeWorld>) => void, string[]]> = [
    ["RW's universe, were it under $10", (w) => { w.pm.markets.find((m) => m.cond === cond(1))!.rate = 9.5; w.pm.markets.find((m) => m.cond === cond(1))!.sponsoredRate = null; }, [cond(1), cond(5)]],
    ["the sponsored $12, were it the only listing", (w) => { w.pm.markets.find((m) => m.cond === cond(3))!.sponsoredRate = null; }, [cond(3), cond(5)]],
    ["the market not accepting, were it accepting", (w) => { w.pm.markets.find((m) => m.cond === cond(4))!.accepting = true; }, [cond(4), cond(5)]],
    ["the one under the floor, were it at $6", (w) => { w.pm.markets.find((m) => m.cond === cond(8))!.rate = 6; }, [cond(5), cond(8)]],
    ["N 25, were it 20", (w) => { const m = w.pm.markets.find((x) => x.cond === cond(9))!; m.rewardsMinSize = 20; m.minSize = 20; m.depth = [[0, 20]]; }, [cond(5), cond(9)]],
    ["the end inside 48 hours, were it later", (w) => { w.pm.markets.find((m) => m.cond === cond(10))!.endDate = iso(T0 + 3 * DAY); }, [cond(10), cond(5)]],
    ["the game inside 48 hours, were it later", (w) => { w.pm.markets.find((m) => m.cond === cond(11))!.gameStartTime = "2026-10-05 18:00:00+00"; }, [cond(11), cond(5)]],
    ["the $2.25 formula, were it $2.50", (w) => { w.pm.markets.find((m) => m.cond === cond(12))!.depth = [[0, 5]]; }, [cond(12), cond(5)]],
  ];
  for (const [name, change, want] of variants) {
    const w = makeWorld();
    change(w);
    assertEquals(await sel(w), want, name);
  }
});

Deno.test("selectMarkets is RW's firstScore and choose over the universe, exactly: 300 random worlds, every pick under $10 in both listings", async () => {
  let seed = 20261001;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rateOf = () => { const x = rand(); return x < 0.15 ? null : Math.round(x * 1300) / 100; };    // null, or $0 … $13
  let picked = 0;
  for (let world = 0; world < 300; world++) {
    const pm = new FakePolymarket(() => T0);
    pm.rewardsPageSize = 3 + Math.floor(rand() * 4);
    const n = 3 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i++) {
      const bid = Math.round((0.05 + rand() * 0.8) * 100) / 100, spread = 1 + Math.floor(rand() * 6);
      pm.addMarket({
        cond: cond(1000 * world + i), yes: tok(1000 * world + i, "yes"), no: tok(1000 * world + i, "no"), rate: rateOf(), sponsoredRate: rand() < 0.3 ? rateOf() : null,
        negRisk: rand() < 0.5, accepting: rand() < 0.9, bid, ask: rand() < 0.9 ? Number((bid + spread * 0.01).toFixed(2)) : 1.5,
        minSize: [5, 10, 20, 25][Math.floor(rand() * 4)], maxSpread: [0, 2.5, 4.5, 6.5][Math.floor(rand() * 4)], depth: [[0, [5, 20, 60][Math.floor(rand() * 3)]], [1, 40]],
        endDate: rand() < 0.2 ? iso(T0 + rand() * 4 * DAY) : undefined,
      });
    }
    const maxMarkets = 1 + Math.floor(rand() * 4), budget = 10 + Math.floor(rand() * 60);
    const sel = await selectMarkets(pm.venue(), "2026-10-02", { maxMarkets, budget }, new Set(), undefined, T0);
    // The same, worked out here from the fake's own markets with RW's functions.
    const scored = pm.markets.flatMap((m) => {
      const listed = [m.rate, m.sponsoredRate].filter((x): x is number => x != null);
      if (!listed.length) return [];
      const rate = Math.max(...listed);
      if (!(rate >= 6 && rate < 10) || !(m.maxSpread > 0) || sizeN(m.rewardsMinSize) > 20 || !m.accepting) return [];
      if (m.endDate && Date.parse(m.endDate) < T0 + 2 * DAY) return [];
      const yb = pm.yesBook(m);
      if (!yb.bids.length || !yb.asks.length) return [];
      const fs = firstScore(summarize(yb.bids, yb.asks, m.maxSpread, m.rewardsMinSize), Number(m.tick), m.maxSpread, m.rewardsMinSize, rate);
      if (!fs || fs.perDollar * 1440 * fs.cap < 2.5 - 1e-9) return [];
      return [{ cond: m.cond, perDollar: fs.perDollar, cap: fs.cap }];
    });
    const want = choose(scored, budget).slice(0, maxMarkets).map((x) => x.cond);
    assertEquals(pickConds(sel.picks), want, `world ${world}`);
    for (const p of sel.picks) {
      picked++;
      const m = pm.markets.find((x) => x.cond === p.cond)!;
      assert([m.rate, m.sponsoredRate].every((x) => x == null || x < 10), `world ${world}: ${p.cond}`);
    }
  }
  assert(picked > 100, `${picked} picks`);
});

Deno.test("the listing is read whole and proved so: base64-offset cursors, pages read at once over each other, every boundary inside the page before", async () => {
  assertEquals([cursorOffset("MA=="), cursorOffset("NTAw"), cursorOffset("LTE="), cursorOffset("not base64!")], [0, 500, null, null]);
  // 230 rewarded markets in pages of 50: offsets 0, 30, 60, … (an overlap of 20), eight at a time.
  const pm = new FakePolymarket(() => T0);
  pm.rewardsPageSize = 50;
  for (let i = 0; i < 230; i++) pm.addMarket({ cond: cond(5000 + i), yes: tok(5000 + i, "yes"), no: tok(5000 + i, "no"), rate: 6 + (i % 4), sponsoredRate: null });
  const l = await rewardListing(pm.venue());
  assertEquals([l.ok, l.rows.size, l.how], [true, 230, "concurrent+one page"]);
  assertEquals(PM_LISTING_OVERLAP, 20);
  const offsets = pm.urls.filter((u) => u.includes("sponsored=false")).map((u) => cursorOffset(new URL(u.split(" ")[1]).searchParams.get("next_cursor") ?? "MA==")).sort((a, b) => a! - b!);
  assertEquals(offsets.slice(0, 8), [0, 30, 60, 90, 120, 150, 180, 210]);
  // The listing moves under the read, as the real one does: rows inserted and removed between two page reads, fewer than
  // the overlap, leave every boundary proved and every row that was there throughout read.
  const churn = new FakePolymarket(() => T0);
  churn.rewardsPageSize = 50;
  for (let i = 0; i < 230; i++) churn.addMarket({ cond: cond(5000 + i), yes: tok(5000 + i, "yes"), no: tok(5000 + i, "no"), rate: 7, sponsoredRate: null });
  let k = 0;
  churn.onRewardsPage = (offset, sponsored) => {
    if (sponsored || offset === 0) return;
    churn.addMarket({ cond: cond(4000 + k), yes: tok(4000 + k, "yes"), no: tok(4000 + k, "no"), rate: 7, sponsoredRate: null });   // inserted before everything
    k++;
    if (k % 2 === 0) churn.markets.splice(churn.markets.findIndex((m) => m.cond === cond(5100 + k)), 1);                          // and one removed
  };
  const lc = await rewardListing(churn.venue());
  assert(lc.ok, lc.error);
  for (let i = 0; i < 230; i++) if (churn.markets.some((m) => m.cond === cond(5000 + i))) assert(lc.rows.has(cond(5000 + i)), `row ${i}`);
  assert(lc.shifts.length > 0, "the read saw the listing move");
  // More moved between two reads than the overlap covers: no proof, read again; the same again: nothing is taken.
  const big = new FakePolymarket(() => T0);
  big.rewardsPageSize = 50;
  for (let i = 0; i < 230; i++) big.addMarket({ cond: cond(5000 + i), yes: tok(5000 + i, "yes"), no: tok(5000 + i, "no"), rate: 7, sponsoredRate: null });
  let removed = 0;
  big.onRewardsPage = (offset, sponsored) => { if (!sponsored && offset === 30) { big.markets.splice(0, 25); removed += 25; } };
  const lb = await rewardListing(big.venue());
  assertEquals(lb.ok, false);
  assert(String(lb.error).startsWith("the reward listing could not be proved complete twice"), lb.error);
  assertEquals(removed, 50);                                                                  // two reads, both refused
  // Once the listing holds still, the second read proves it.
  const once = new FakePolymarket(() => T0);
  once.rewardsPageSize = 50;
  for (let i = 0; i < 230; i++) once.addMarket({ cond: cond(5000 + i), yes: tok(5000 + i, "yes"), no: tok(5000 + i, "no"), rate: 7, sponsoredRate: null });
  let moved = false;
  once.onRewardsPage = (offset, sponsored) => { if (!sponsored && offset === 30 && !moved) { once.markets.splice(0, 25); moved = true; } };
  const lo = await rewardListing(once.venue());
  assertEquals([lo.ok, lo.rows.size], [true, 205]);
});

Deno.test("a listing whose cursor is not an offset, or whose pages are not in id order, is read page after page by its own cursors", async () => {
  const pm = new FakePolymarket(() => T0);
  pm.rewardsPageSize = 4;
  for (let i = 0; i < 11; i++) pm.addMarket({ cond: cond(300 + i), yes: tok(300 + i, "yes"), no: tok(300 + i, "no"), rate: 7, sponsoredRate: null });
  const inner = pm.venue();
  // A venue whose cursors are keysets ("id:…"), as /sampling-simplified-markets' are: no offsets to read at once.
  const keyset: PmVenue = {
    ...inner,
    rewardsPage: async (s, c) => {
      const off = c ? Number(atob(c).slice(3)) : 0;
      const r = await inner.rewardsPage(s, off ? btoa(String(off)) : "");
      const next = r.data?.next_cursor === "LTE=" ? "LTE=" : btoa(`id:${off + 4}`);
      return { ...r, data: { ...r.data, next_cursor: next } };
    },
  };
  const l = await rewardListing(keyset);
  assertEquals([l.ok, l.rows.size, l.how], [true, 11, "sequential+one page"]);
  // The deadline: no read starts past it, and a listing not read whole is a failure.
  let t = 0;
  const late = await rewardListing(pm.venue(), { clock: () => (t += 15e3), until: 40e3 });
  assertEquals(late.ok, false);
  assert(String(late.error).startsWith("time budget"), late.error);
});

// ------------------------------------------------------------------ the dry-run, as it runs from the push

const nowS = (ms: number) => Math.floor(ms / 1000);
const quoteRows = (w: ReturnType<typeof makeWorld>) => w.open().map((r) => [String(r.cond).slice(-2), r.outcome, r.side, Number(r.price), Number(r.size)].join(" ")).sort();
/** RW's quotes on A (0.45 / 0.47, N 5) and B (0.200 / 0.230, tick 0.001, N 20): a tick inside B's touch, A's already one apart. */
const RW_A = ["05 no BUY 0.53 5", "05 yes BUY 0.45 5"];
const RW_B = ["06 no BUY 0.771 20", "06 yes BUY 0.201 20"];

Deno.test("dry-run, the default: it selects by RW's ranking, quotes RW's prices, records every gate and each order it would send — and sends nothing", async () => {
  const w = makeWorld();
  const r = await w.turn();
  assertEquals(r.errors, []);
  assertEquals(r.mode, "dry_run");
  assert(r.why.includes("pm_live_config.dry_run is on"), r.why);
  const st = w.state();
  assertEquals([st.sbRegion, st.mode, st.dryRun, st.armed, st.attested, st.openBlockedBy, st.sendsEnabled], ["eu-west-1", "dry_run", true, false, true, null, true]);
  assertEquals(st.gates, { global_pause: true, risk_readable: true, armed: null, region: true, geoblock: true, closed_only: true, attestation: true, inventory: true, loss_day: true, loss_total: true });
  assertEquals(w.markets().map((m) => [m.cond, m.kind, m.rank, m.reward_rate]), [[cond(5), "standard", 1, 8], [cond(6), "neg_risk", 2, 7]]);
  assertEquals(quoteRows(w), [...RW_A, ...RW_B]);
  for (const o of w.orders()) {
    assertEquals([o.mode, o.state, o.order_type, o.post_only, o.gate, Number(o.expiration)], ["dry_run", "live", "GTD", true, "open", nowS(T0) + 60 + 300]);
    const req = o.request as PmOrderStruct & { exchange: string; expiration: string };
    assertEquals(req.exchange, exchangeFor(o.neg_risk === true));
    assertEquals([req.maker, req.signer, req.signatureType, req.expiration], [PM_TEST_FUNDER, PM_TEST_SIGNER, 1, String(o.expiration)]);
    assertEquals(orderHash(req, req.exchange), o.hash);
  }
  assertEquals(w.writes(), []);                                                          // not one request but a GET
  const all = JSON.stringify(w.mem.tables);
  assert(!/"signature"\s*:/.test(all) && !/0x[0-9a-fA-F]{130}\b/.test(all), "no signature is ever written");
  assertEquals(w.events().map((e) => e.kind).sort(), ["gates", "readout", "selection"]);
  // The selection's event says what it read and what it took.
  const ev = w.events("selection")[0].detail as Record<string, any>;
  assertEquals([ev.universe, ev.eligible, ev.scored, ev.chosen, ev.picked.length], [7, 4, 3, 2, 2]);
  assert(typeof ev.ms === "number");
});

Deno.test("the minute's formula is recorded every minute for every market quoted: RW's reward line on what rested when the book was read", async () => {
  const w = makeWorld();
  await w.turn(T0);
  // First minute: nothing rested yet when the book was read.
  assertEquals(w.minutes().map((m) => [m.cond, m.bid_price, m.ask_price, m.formula_usd]), [[cond(5), null, null, 0], [cond(6), null, null, 0]]);
  await w.turn(T0 + M);
  const rows = w.minutes().filter((m) => m.minute === iso(Math.floor((T0 + M) / M) * M));
  assertEquals(rows.map((m) => [m.mode, m.cond, m.bid_price, m.bid_size, m.ask_price, m.ask_size, m.bid_scoring, m.ask_scoring]), [
    ["dry_run", cond(5), 0.45, 5, 0.47, 5, null, null], ["dry_run", cond(6), 0.201, 20, 0.229, 20, null, null],
  ]);
  // A: our 5 at 0.45 / 0.47 against the others' 5 at the same prices (m 0.46): half of $8 a day, a minute of it.
  const a = rows.find((m) => m.cond === cond(5))!;
  assertAlmostEquals(Number(a.formula_usd), 8 / 1440 * 0.5, 1e-6);
  assertEquals([a.rate, a.max_spread, a.min_size, Number(a.ab), Number(a.aa)], [8, 4.5, 5, 0.45, 0.47]);
  assertEquals(rows.every((m) => m.pct === 0), true);                                     // the venue's live share: the account has none
});

Deno.test("each minute also records what rests after its turn, scored against the book it read with those quotes in it (detail.after): the next minute's formula of the same quotes on the same book is that figure", async () => {
  const w = makeWorld({ wide: true });                                                    // A 0.45 / 0.50: RW bids 0.46, asks 0.49
  await w.turn(T0);
  const first = w.minutes().filter((m) => m.minute === iso(Math.floor(T0 / M) * M));
  // Nothing rested when the first book was read; after the turn RW's quote rests, scored on that book with it in it.
  const a0 = first.find((m) => m.cond === cond(5))!, d0 = a0.detail as Record<string, any>;
  assertEquals([Number(a0.formula_usd), d0.after.orders], [0, 2]);
  const Q: PmOwnOrder[] = [{ outcome: "yes", side: "BUY", price: 0.46, size: 5 }, { outcome: "no", side: "BUY", price: 0.51, size: 5 }];
  const want = minuteFormula({ rate: 8, v: 4.5, minSize: 5, levels: { bids: [[0.45, 5]], asks: [[0.50, 5]] }, inBook: [], quotes: Q });
  assertAlmostEquals(d0.after.formula, want.formula, 1e-12);
  assertAlmostEquals(d0.after.m, 0.475, 1e-12);
  assert(want.formula > 0);
  // The book does not move: the next minute's formula of those quotes is the figure the turn before recorded as after.
  await w.turn(T0 + M);
  const a1 = w.minutes().find((m) => m.minute === iso(Math.floor((T0 + M) / M) * M) && m.cond === cond(5))!;
  assertAlmostEquals(Number(a1.formula_usd), d0.after.formula, 1e-12);
  assertEquals([(a1.detail as Record<string, any>).m, (a1.detail as Record<string, any>).mRw], [0.475, 0.475]);
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
  assertEquals(quoteRows(w), ["05 no BUY 0.53 5", "05 yes BUY 0.46 5", ...RW_B]);
  const r3 = await w.turn(T0 + 3 * M);
  assertEquals(r3.cancelled, []);
  const r4 = await w.turn(T0 + 4 * M);
  assertEquals(r4.cancelled.map((c) => c.gate).sort(), ["refresh", "refresh", "refresh"]);
  assertEquals(w.open().length, 4);
  await w.turn(T0 + 15 * M);
  assertEquals(w.orders().filter((o) => o.state === "expired").length, 4);
  assertEquals(w.open().length, 4);
  assert(w.open().every((o) => Number(o.expiration) === nowS(T0 + 15 * M) + 360));
});

Deno.test("the day's selection is made once, retried every five minutes while nothing is selected, and made again on the next UTC day", async () => {
  const w = makeWorld();
  w.pm.down.rewards = true;
  const r = await w.turn(T0);
  assertEquals([w.markets().length, w.orders().length], [0, 0]);
  assert(r.errors.some((e) => e.startsWith("selection: rewards/markets/current")), r.errors.join(" | "));
  w.pm.down.rewards = false;
  const before = w.pm.calls.length;
  await w.turn(T0 + M);
  assertEquals(w.pm.calls.slice(before).filter((c) => c.includes("/rewards/markets")).length, 0);
  await w.turn(T0 + 5 * M);
  assertEquals(w.markets().length, 2);
  assertEquals(w.open().length, 4);
  const n = w.pm.calls.filter((c) => c.includes("/rewards/markets")).length;
  await w.turn(T0 + 6 * M);
  assertEquals(w.pm.calls.filter((c) => c.includes("/rewards/markets")).length, n);
  await w.turn(T0 + DAY);
  assertEquals(w.markets().filter((m) => m.day === "2026-10-03").length, 2);
  // A config that asks for no markets selects nothing at all; one that asks for six takes the three the universe has.
  const z = makeWorld({ config: { max_markets: 0 } });
  await z.turn(T0);
  assertEquals([z.markets().length, z.pm.calls.filter((c) => c.includes("/rewards/markets")).length], [0, 0]);
  const six = makeWorld({ config: { max_markets: 6, select_budget_usd: 120 } });
  await six.turn(T0);
  assertEquals(six.markets().map((m) => m.cond), [cond(5), cond(6), cond(7)]);
  // One asked for, within a budget that holds two: RW's first only.
  const one = makeWorld({ config: { max_markets: 1 } });
  await one.turn(T0);
  assertEquals(one.markets().map((m) => m.cond), [cond(5)]);
});

Deno.test("a market that leaves the book: recorded once as its condition, never a fault, its orders closed, its book read no more, and not replaced that day", async () => {
  const w = makeWorld();
  const bookReads = () => w.pm.calls.filter((c) => c === "GET clob.polymarket.com/book").length;
  await w.turn(T0);
  assertEquals(w.open().filter((o) => o.cond === cond(5)).length, 2);
  w.A.resolved = true;
  const r1 = await w.turn(T0 + M);
  assertEquals(r1.errors, []);
  assertEquals(r1.conditions, { [cond(5)]: "left the book (404)" });
  assertEquals(w.open().filter((o) => o.cond === cond(5)).length, 0);
  const before = bookReads();
  const r2 = await w.turn(T0 + 2 * M);
  assertEquals(r2.errors, []);
  assertEquals(bookReads() - before, 1);                                                  // B's book alone
  await w.turn(T0 + 10 * M);
  assertEquals(w.markets().filter((m) => m.day === "2026-10-02").map((m) => m.cond), [cond(5), cond(6)]);   // no replacement
  assertEquals(w.events("condition").length, 1);                                          // recorded once
  assertEquals(w.events("selection").flatMap((e) => ((e.detail as { gone?: Array<{ cond: string }> }).gone ?? []).map((g) => g.cond)), [cond(5)]);
  await w.turn(T0 + DAY);
  assertEquals(w.state().gone, []);
});

Deno.test("a market's own condition is state, not a fault: a one-sided book is recorded once, quotes nothing, and writes no error", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.B.ask = 1.2;                                                                          // B's asks leave the book
  const r = await w.turn(T0 + M);
  assertEquals(r.errors, []);
  assertEquals(r.conditions, { [cond(6)]: "one-sided book" });
  assertEquals(w.open().filter((o) => o.cond === cond(6)).length, 0);
  assertEquals((w.mem.tables.pm_live_state as Row[])[0].last_error, null);
  await w.turn(T0 + 2 * M);
  assertEquals(w.events("condition").length, 1);
  w.B.ask = 0.23;
  await w.turn(T0 + 3 * M);
  assertEquals(w.events("condition").length, 2);                                          // and once more when it clears
  assertEquals(w.state().conditions, {});
  assertEquals(quoteRows(w), [...RW_A, ...RW_B]);
});

Deno.test("the selection's deadline: no read starts 40 s into the turn; a selection not read whole takes nothing and is tried again in five minutes", async () => {
  const w = makeWorld();
  let t = 0;
  const r = await w.turn(T0, { clock: () => (t += 15e3) });
  assertEquals(w.markets().length, 0);
  assert(r.errors.some((e) => e.startsWith("selection: time budget")), r.errors.join(" | "));
  // The deadline comes once Gamma is read, before any book: nothing is taken (RW's ranking is over every candidate or
  // none), nothing is sent, and five minutes later the day is selected whole.
  const w2 = makeWorld();
  const inner = w2.pm.venue();
  let late = false;
  const venue: PmVenue = { ...inner, gammaByConditions: async (c, closed) => { const g = await inner.gammaByConditions(c, closed); late = true; return g; } };
  const r2 = await w2.turn(T0, { venue, clock: () => (late ? 41e3 : 0) });
  assertEquals([w2.markets().length, w2.orders().length], [0, 0]);
  assert(r2.errors.some((e) => e.includes("every candidate's book")), r2.errors.join(" | "));
  await w2.turn(T0 + 5 * M);
  assertEquals(quoteRows(w2), [...RW_A, ...RW_B]);
});

Deno.test("the readout: once a UTC day after 01:00, the two days before — what Polymarket paid per market, its total, the rebates, and the formula's sums — so R is a query", async () => {
  const w = makeWorld({ live: true });
  const A = cond(5), D1 = "2026-10-01";
  // 10-01's minutes as the path recorded them: three live minutes of A (two of them scored on both sides), one dry-run.
  const min = (m: number, scoring: boolean, mode = "live") => ({
    mode, minute: `${D1}T10:0${m}:00.000Z`, cond: A, rate: 8, max_spread: 4.5, min_size: 5, tick: 0.01, bb: 0.45, ba: 0.47, ab: 0.45, aa: 0.47, q1: 3.0247, q2: 3.0247,
    bid_price: 0.45, bid_size: 5, ask_price: 0.47, ask_size: 5, bid_scoring: scoring, ask_scoring: scoring, ours: 3.0247, others: 3.0247, formula_usd: 0.002778, pct: 50, detail: {},
  });
  (w.mem.tables.pm_live_minutes as Row[]).push(min(1, true), min(2, true), min(3, false), min(4, false, "dry_run"));
  w.pm.earnings[D1] = { native: [{ cond: A, usd: 0.005 }], sponsored: [{ cond: A, usd: 0.001 }] };
  w.pm.rebatesByDay[D1] = [{ cond: A, usdc: "0.0004" }];
  // Before 01:00 nothing is read.
  await w.turn(Date.parse("2026-10-02T00:59:30Z"));
  assertEquals((w.mem.tables.pm_live_reward_days as Row[]).length, 0);
  const r = await w.turn(Date.parse("2026-10-02T01:00:30Z"));
  assertEquals(r.errors, []);
  const days = (w.mem.tables.pm_live_reward_days as Row[]).filter((d) => d.day === D1);
  const live = days.find((d) => d.mode === "live")!, dry = days.find((d) => d.mode === "dry_run")!;
  assertEquals([live.minutes, live.minutes_two_sided, live.minutes_scored, live.actual_usd, live.actual_sponsored_usd, live.rebate_usd], [3, 3, 2, 0.005, 0.001, 0.0004]);
  assertAlmostEquals(Number(live.formula_usd), 3 * 0.002778, 1e-9);
  assertAlmostEquals(Number(live.formula_scored_usd), 2 * 0.002778, 1e-9);
  assertEquals([dry.minutes, dry.actual_usd, dry.actual_sponsored_usd, dry.rebate_usd], [1, null, null, null]);   // a dry-run is never paid
  // R, as the design's query computes it.
  const liveRows = (w.mem.tables.pm_live_reward_days as Row[]).filter((d) => d.mode === "live");
  const R = liveRows.reduce((s, d) => s + Number(d.actual_usd ?? 0) + Number(d.actual_sponsored_usd ?? 0), 0) / liveRows.reduce((s, d) => s + Number(d.formula_usd), 0);
  assertAlmostEquals(R, 0.006 / (3 * 0.002778), 1e-9);
  const ev = w.events("readout")[0].detail as { days: Array<{ day: string; total: number; actual: number }> };
  assertEquals(ev.days.map((x) => x.day), [D1, "2026-09-30"]);
  assertEquals(ev.days[0].total, 0.006);                                                   // the venue's own total, native and sponsored
  // Read once that day; the next day, 10-01 once more (a late posting) and 10-02.
  const reads = () => w.pm.calls.filter((c) => c === "GET clob.polymarket.com/rewards/user/total").length;
  const n = reads();
  await w.turn(Date.parse("2026-10-02T02:00:30Z"));
  assertEquals(reads(), n);
  await w.turn(Date.parse("2026-10-03T01:00:30Z"));
  assertEquals(reads(), n + 2);
  // A failed read writes nothing for its day, and is tried again ten minutes later.
  const v = makeWorld();
  v.pm.down.earnings = true;
  const rv = await v.turn(Date.parse("2026-10-02T01:00:30Z"));
  assert(rv.errors.some((e) => e.startsWith("readout of 2026-10-01: rewards/user")), rv.errors.join(" | "));
  v.pm.down.earnings = false;
  const m0 = v.pm.calls.filter((c) => c.includes("/rewards/user?") || c === "GET clob.polymarket.com/rewards/user").length;
  await v.turn(Date.parse("2026-10-02T01:05:30Z"));
  assertEquals(v.pm.calls.filter((c) => c === "GET clob.polymarket.com/rewards/user").length, m0);
  await v.turn(Date.parse("2026-10-02T01:11:30Z"));
  assert(v.pm.calls.filter((c) => c === "GET clob.polymarket.com/rewards/user").length > m0);
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
  for (let t = T0; t < T0 + 3 * H; t += M) await w.turn(t);
  assert([...w.db.touched].every((t) => PM_LIVE_DB_TABLES.includes(t)), [...w.db.touched].join());
  assertEquals([(w.mem.tables.pm_rw_minutes as Row[]).length, (w.mem.tables.pm_rwc_minutes as Row[]).length, (w.mem.tables.pm_rwc_selection as Row[]).length], [1, 1, 1]);
  assertEquals((w.mem.tables.agent_locks as Row[]).find((l) => l.name === "pmrwc")?.holder, null);
});

Deno.test("0074's and 0076's constraints hold in the double: one open order per slot, a hash once, a market under $10, a minute under $10, a dry-run never paid", async () => {
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
  const refused = async (table: string, rows: Row[], key: string, want: string) => {
    let err = "";
    try { await w.mem.db.upsert(table, rows, key); } catch (e) { err = String(e); }
    assert(err.includes(want), `${want}: ${err}`);
  };
  const mkt = { day: "2026-10-09", kind: "standard", cond: "c", yes_token: "1", no_token: "2", neg_risk: false, tick: 0.01, min_size: 5, reward_rate: 10, rank: 1, detail: {} };
  await refused("pm_live_markets", [mkt], "day,cond", "pm_live_markets_reward_rate_check");
  await refused("pm_live_markets", [{ ...mkt, reward_rate: 8 }], "day,kind", "no unique or exclusion constraint");   // 0076 keyed it by market
  await w.mem.db.upsert("pm_live_markets", [{ ...mkt, reward_rate: 8 }, { ...mkt, cond: "d", reward_rate: 9 }], "day,cond");   // two standard markets a day
  const minute = { mode: "live", minute: iso(T0), cond: "c", rate: 10, max_spread: 4.5, min_size: 5, tick: 0.01, ours: 0, others: 0, formula_usd: 0, detail: {} };
  await refused("pm_live_minutes", [minute], "mode,minute,cond", "pm_live_minutes_rate_check");
  await refused("pm_live_minutes", [{ ...minute, rate: 8, formula_usd: -1 }], "mode,minute,cond", "pm_live_minutes_formula_usd_check");
  const rd = { mode: "dry_run", day: "2026-10-01", cond: "c", minutes: 1, minutes_two_sided: 1, minutes_scored: 0, formula_usd: 0, formula_scored_usd: 0, read_at: iso(T0), detail: {} };
  await refused("pm_live_reward_days", [{ ...rd, actual_usd: 0.1 }], "mode,day,cond", "pm_live_reward_days_check");
  await w.mem.db.upsert("pm_live_reward_days", [{ ...rd, mode: "live", actual_usd: 0.1 }], "mode,day,cond");
  await refused("pm_live_settlements", [{ cond: "c", yes_token: "1", no_token: "2", payout: 1.5, settled_at: iso(T0), detail: {} }], "cond", "pm_live_settlements_payout_check");
  const cfgRefused = async (p: Row, want: string) => {
    let err = "";
    try { await w.mem.db.update("pm_live_config", "id=eq.1", p); } catch (e) { err = String(e); }
    assert(err.includes(want), `${want}: ${err}`);
  };
  await cfgRefused({ cap_total_usd: 321 }, "pm_live_config_cap_total_usd_check");
  await cfgRefused({ select_budget_usd: 321 }, "pm_live_config_select_budget_usd_check");
  await w.mem.db.update("pm_live_config", "id=eq.1", { cap_total_usd: 320, select_budget_usd: 320 });   // 0076's ceiling, for the $400 deposit
  await cfgRefused({ max_markets: 13 }, "pm_live_config_max_markets_check");
  await cfgRefused({ select_budget_usd: 0 }, "pm_live_config_select_budget_usd_check");
  await cfgRefused({ gtd_lifetime_s: 179 }, "pm_live_config_gtd_lifetime_s_check");
  await w.mem.db.update("pm_live_config", "id=eq.1", { gtd_lifetime_s: 600, max_markets: 12 });
  await cfgRefused({ ireland_attested_at: null, ireland_until: iso(T0) }, "pm_live_config_check");
  let err = "";
  try { await w.mem.db.insert("pm_live_events", { mode: "live", minute: iso(T0), kind: "whatever", detail: {} }); } catch (e) { err = String(e); }
  assert(err.includes("pm_live_events_kind_check"), err);
});

Deno.test("before 0076 has run the turn does nothing: a config row without the day's markets is skipped, with nothing read or written", async () => {
  const w = makeWorld();
  const { max_markets: _m, select_budget_usd: _b, ...old } = (w.mem.tables.pm_live_config as Row[])[0];
  (w.mem.tables.pm_live_config as Row[])[0] = old;
  const r = await w.turn();
  assert(String(r.skipped).includes("migration 0076 has not run"), r.skipped);
  assertEquals([w.pm.calls.length, w.orders().length, (w.mem.tables.pm_live_state as Row[]).length], [0, 0, 0]);
});

// ------------------------------------------------------------------ the locks that remain, through the REAL client

Deno.test("sends are enabled in code; the config is the lock: as deployed (dry_run on, unarmed, the key loaded) a full day through the real client sends nothing but GETs", async () => {
  assertEquals(PM_ORDER_SENDS_ENABLED, true);
  const prevRegion = Deno.env.get("SB_REGION");
  Deno.env.set("SB_REGION", "eu-west-1");
  try {
    for (const variant of ["as deployed: dry_run on", "dry_run off but unarmed, nothing held"] as const) {
      const w = makeWorld({ realClient: true, signer: true, config: variant === "as deployed: dry_run on" ? {} : { dry_run: false, live_confirmed_at: null } });
      for (let t = T0; t < T0 + DAY; t += M) {
        if ((t - T0) % (7 * M) === 0) w.A.bid = w.A.bid === 0.45 ? 0.44 : 0.45;
        const r = await w.turn(t);
        if (t === T0) assertEquals([r.mode, r.gates?.openBlockedBy ?? null], variant === "as deployed: dry_run on" ? ["dry_run", null] : ["live", "armed"]);
      }
      assertEquals(w.writes(), [], variant);
      assert(w.pm.calls.length > 1440 * 5, `${w.pm.calls.length} GETs`);
      if (variant === "as deployed: dry_run on") assert(w.orders().length > 1000 && w.orders().every((o) => o.mode === "dry_run"));
      else assertEquals(w.orders().filter((o) => o.mode === "live"), []);
    }
    // Unlocked — dry_run off and armed — the same client sends the orders, and the venue takes them.
    const live = makeWorld({ realClient: true, live: true });
    await live.turn(T0);
    assertEquals(live.writes().length, 4);
    assertEquals(live.open("live").map((o) => o.state), ["live", "live", "live", "live"]);
  } finally {
    if (prevRegion === undefined) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", prevRegion);
  }
});

Deno.test("the locks that remain, each alone: dry_run on, no key, a key that is not the signer's, unarmed, a region not eu-west-1, the code's switch — and with all open, it sends", async () => {
  const other = new PmOrderKey("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");   // Hardhat's published #1: not the stored signer
  for (const [label, setup, why] of [
    ["dry_run on", { config: { dry_run: true } }, "pm_live_config.dry_run is on"],
    ["no key", { extra: { signer: null, signerProblem: "POLYMARKET_PRIVATE_KEY missing: no order can be signed" } }, "no signing key loaded for the stored signer (POLYMARKET_PRIVATE_KEY missing"],
    ["a key that is not the stored signer", { extra: { signer: other } }, "no signing key loaded"],
    ["the code's switch off", { extra: { sendsEnabled: false } }, "PM_ORDER_SENDS_ENABLED is false"],
  ] as const) {
    const w = makeWorld({ live: true });
    if ("config" in setup) w.setConfig(setup.config);
    const r = await w.turn(T0, "extra" in setup ? setup.extra : {});
    assertEquals(r.mode, "dry_run", label);
    assert(r.why.includes(why), `${label}: ${r.why}`);
    assertEquals([w.writes(), w.open("live")], [[], []], label);
    assertEquals(w.open("dry_run").length, 4, label);
  }
  // Live but unarmed: nothing that opens; live from another region: nothing at all.
  const u = makeWorld({ live: true, config: { live_confirmed_at: null } });
  const ru = await u.turn(T0);
  assertEquals([ru.mode, ru.gates?.openBlockedBy, u.writes().length], ["live", "armed", 0]);
  const g = makeWorld({ live: true, region: "eu-west-2" });
  const rg = await g.turn(T0);
  assertEquals([rg.mode, rg.gates?.openBlockedBy, rg.gates?.reduceBlockedBy, g.writes().length], ["live", "region", "region", 0]);
  // All open: live, and the four orders go.
  const w = makeWorld({ live: true });
  const r = await w.turn(T0);
  assertEquals([r.mode, w.writes().length, w.open("live").length], ["live", 4, 4]);
});

Deno.test("the state says whether a key for the stored signer is loaded, in dry-run too, so it can be read before the go-time statement — never the key", async () => {
  const w = makeWorld({});                                              // dry_run on, as 0076 leaves it; the stored signer's key loaded
  await w.turn(T0);
  assertEquals([w.state().mode, w.state().keyed, w.state().signerProblem], ["dry_run", true, null]);
  const hex = PM_TEST_KEY.replace(/^0x/, "").toLowerCase();
  assert(!JSON.stringify(w.state()).toLowerCase().includes(hex), "the state must never carry the key");
  const n = makeWorld({ signer: false });
  await n.turn(T0, { signerProblem: "POLYMARKET_PRIVATE_KEY missing: no order can be signed" });
  assertEquals([n.state().mode, n.state().keyed, n.state().signerProblem], ["dry_run", false, "POLYMARKET_PRIVATE_KEY missing: no order can be signed"]);
});

// ------------------------------------------------------------------ every gate in the turn, both ways

const sides = (w: ReturnType<typeof makeWorld>) => w.open().map((o) => `${String(o.cond).slice(-2)} ${o.outcome} ${o.side} ${Number(o.price)} ${Number(o.size)} ${o.gate}`).sort();
const OPENING = [...RW_A, ...RW_B].map((s) => `${s} open`);

Deno.test("global pause: every open order cancelled, nothing placed; lifted, the quotes come back", async () => {
  const w = makeWorld();
  await w.turn(T0);
  assertEquals(sides(w), OPENING);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = true;
  const r = await w.turn(T0 + M);
  assertEquals([r.cancelled.length, r.placed.length, w.open().length], [4, 0, 0]);
  assert(r.cancelled.every((c) => c.gate === "global_pause"));
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
  assertEquals(w.state().sbRegion, "eu-west-2");
  await w.turn(T0 + 2 * M, { sbRegion: null });
  assertEquals([w.open().length, w.state().sbRegion], [0, null]);
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);
});

Deno.test("geoblock: a country that is not IE is close-only — buys withdrawn, a holding sold at our ask; IE again, it opens; OFAC: not even a sell", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.geo = { blocked: true, country: "GB", region: "ENG", ip: "198.51.100.1" };
  w.pm.tokens.set(w.A.yes, 12);
  const r = await w.turn(T0 + M);
  assertEquals(r.gates?.openBlockedBy, "geoblock");
  assertEquals(sides(w), ["05 yes SELL 0.47 5 reduce"]);
  assert(r.cancelled.every((c) => c.gate === "geoblock"));
  w.pm.geo = { blocked: true, country: "IE", region: "L", ip: "203.0.113.7" };
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);
  w.pm.geo = { blocked: true, country: "IR", region: "", ip: "192.0.2.1" };
  const blocked = await w.turn(T0 + 4 * M);
  assertEquals([blocked.gates?.reduceBlockedBy, w.open().length], ["geoblock", 0]);
});

Deno.test("geoblock: a failed read is answered by the last good one for ten minutes, with no fault; past that the gate closes, reported once; read again, it opens", async () => {
  assertEquals(PM_LIVE_GEO_CACHE_MS, 10 * M);
  const w = makeWorld();
  await w.turn(T0);
  w.pm.down.geoblock = true;
  for (let k = 1; k <= 10; k++) {
    const r = await w.turn(T0 + k * M);
    assertEquals([r.errors, r.gates?.open], [[], true], `minute ${k}`);
    assertEquals(w.state().geoCachedFrom, iso(T0));
  }
  assertEquals(sides(w), OPENING);
  const r11 = await w.turn(T0 + 11 * M);
  assertEquals(r11.gates?.openBlockedBy, "geoblock");
  assertEquals(r11.errors.filter((e) => e.startsWith("geoblock unreadable")).length, 1);
  const r12 = await w.turn(T0 + 12 * M);
  assertEquals([r12.gates?.openBlockedBy, r12.errors], ["geoblock", []]);                 // once, not every minute
  w.pm.down.geoblock = false;
  const r13 = await w.turn(T0 + 13 * M);
  assertEquals([r13.gates?.open, r13.errors], [true, []]);
  // A first read that fails has nothing to fall back on: closed at once, reported once.
  const z = makeWorld();
  z.pm.down.geoblock = true;
  const rz = await z.turn(T0);
  assertEquals([rz.gates?.openBlockedBy, rz.errors.filter((e) => e.startsWith("geoblock unreadable")).length], ["geoblock", 1]);
  // The pure rule: a good answer is kept; a stale one is not; the report goes out once.
  const prevGood = { geoGood: { at: iso(T0), country: "IE", region: "L", blocked: true } };
  assertEquals(geoOf({ ok: false, status: 0, ms: 0, error: "timeout" }, T0 + 10 * M, prevGood).geo.ok, true);
  assertEquals(geoOf({ ok: false, status: 0, ms: 0, error: "timeout" }, T0 + 10 * M + 1, prevGood).geo.ok, false);
  assertEquals(geoOf({ ok: false, status: 0, ms: 0, error: "timeout" }, T0 + 11 * M, { ...prevGood, geoStaleReported: true }).fault, null);
});

Deno.test("closed-only: the account's flag (or a flag that cannot be read) makes the path close-only; NO held is sold at 1 − our bid", async () => {
  const w = makeWorld();
  await w.turn(T0);
  w.pm.closedOnlyFlag = true;
  w.pm.tokens.set(w.B.no, 50);
  const r = await w.turn(T0 + M);
  assertEquals(r.gates?.openBlockedBy, "closed_only");
  assertEquals(sides(w), ["06 no SELL 0.799 20 reduce"]);                                  // RW's bid 0.201 → NO sold at 0.799
  w.pm.closedOnlyFlag = false;
  w.pm.down.closedOnly = true;
  assertEquals((await w.turn(T0 + 2 * M)).gates?.openBlockedBy, "closed_only");
  w.pm.down.closedOnly = false;
  // Open again. The 50 NO still held in B count against its $60 cap at $1 a share (no fill prices them), so beside B's
  // YES bid (20 × 0.201) its NO bid (20 × 0.771) does not fit; sold, it does.
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
  w.setConfig({ ireland_until: iso(T0 + 30e3) });
  w.pm.tokens.set(w.A.no, 7);
  let r = await w.turn(T0 + M);
  assertEquals([r.gates?.openBlockedBy, w.state().attested], ["attestation", false]);
  assertEquals(sides(w), ["05 no SELL 0.55 5 reduce"]);
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

// ------------------------------------------------------------------ caps, collateral, stops and the governor

Deno.test("caps, live: a buy the turn cancels counts until its cancel is read back, so a cancel that never lands leaves the book within its cap (A7)", async () => {
  // 10-02 23:58: A and B selected, the four opening buys rest (24.34 USD) under a total cap of $30. 10-03 00:00: B's book is
  // one-sided, so the day's selection is A and C; B's two buys (19.44) are withdrawn and C's are wanted. The venue takes B's
  // cancels and never carries them out. Counted as gone, C's buys went out beside B's still resting, past the cap; counted
  // until read back, they wait, withheld on the total cap, and what rests stays under it.
  const w = makeWorld({ live: true, config: { cap_total_usd: 30 } });
  await w.turn(Date.parse("2026-10-02T23:58:30Z"));
  assertEquals(sides(w), OPENING);
  w.B.ask = 1.2;
  w.pm.cancelMode = "lost";
  const r = await w.turn(Date.parse("2026-10-03T00:00:30Z"));
  const resting = () => w.open("live").filter((o) => o.side === "BUY").reduce((a, o) => a + Number(o.price) * (Number(o.size) - Number(o.size_matched ?? 0)), 0);
  assert(resting() <= 30 + 1e-9, `${resting()} USD resting: ${sides(w).join("; ")}`);
  assertEquals(w.open("live").filter((o) => o.cond === cond(7)).length, 0);
  assert(r.withheld.some((x) => x.gate === "cap_total" && String(x.slot).startsWith(cond(7))), JSON.stringify(r.withheld));
  // Dry-run's cancels always land, so its caps count as before: the same day there places C's buys at once.
  const d = makeWorld({ config: { cap_total_usd: 30 } });
  await d.turn(Date.parse("2026-10-02T23:58:30Z"));
  d.B.ask = 1.2;
  await d.turn(Date.parse("2026-10-03T00:00:30Z"));
  assertEquals(d.open("dry_run").filter((o) => o.cond === cond(7) && o.side === "BUY").length, 2);
});

Deno.test("caps: buys' collateral (N × b, N × (1 − a)) and the holdings' cost stay under the market cap and the total cap; an order that would pass one is withheld", async () => {
  // Market cap $3: A's YES bid (5 × 0.45 = 2.25) fits; its NO bid (5 × 0.53) would make 4.90; B's bids (4.02, 15.42) do not fit at all.
  const m = makeWorld({ config: { cap_market_usd: 3 } });
  const r = await m.turn(T0);
  assertEquals(sides(m), ["05 yes BUY 0.45 5 open"]);
  assertEquals(r.withheld.filter((x) => x.gate === "cap_market").length, 3);
  // Total cap $30 with 10 YES of B held and no fill to price them ($1 a share): 10 + 2.25 + 2.65 + 4.02 = 18.92 rests;
  // B's NO bid (15.42) would make 34.34. (The selection's budget is the cap at most, and RW's first-quote capital is the
  // four bids' collateral exactly, so the total cap binds on what is held.)
  const t = makeWorld({ config: { cap_total_usd: 30 } });
  t.pm.tokens.set(t.B.yes, 10);
  const rt = await t.turn(T0);
  assertEquals(sides(t), ["05 no BUY 0.53 5 open", "05 yes BUY 0.45 5 open", "06 yes BUY 0.201 20 open"]);
  assertEquals(rt.withheld.filter((x) => x.gate === "cap_total").map((x) => [x.slot, x.reason]), [[`${cond(6)}|${tok(6, "no")}|BUY`, "34.34 USD would pass the cap of 30"]]);
  // Holdings count: 30 YES held in B with no fill to price them are counted at $1 a share, so with a $40 market cap
  // B's YES bid fits (30 + 4.02) and its NO bid does not (34.02 + 15.42).
  const h = makeWorld({ config: { cap_market_usd: 40 } });
  h.pm.tokens.set(h.B.yes, 30);
  await h.turn(T0);
  assertEquals(sides(h), ["05 no BUY 0.53 5 open", "05 yes BUY 0.45 5 open", "06 yes BUY 0.201 20 open"]);
  assertEquals([effectiveLimits({ ...CONFIG, cap_total_usd: 321 }).capTotal, effectiveLimits({ ...CONFIG, cap_market_usd: 61 }).capMarket], [320, 60]);
});

Deno.test("collateral: live, no buy is sent that the account's pUSD cannot cover beside what its resting buys reserve; an unread balance sends no buy", async () => {
  const w = makeWorld({ live: true });
  w.pm.pusd = 3;
  const r = await w.turn(T0);
  assertEquals(sides(w), ["05 yes BUY 0.45 5 open"]);                                      // 2.25 fits, 2.65 more would not
  assertEquals(r.withheld.filter((x) => x.gate === "collateral").length, 3);
  assertEquals(w.orders().filter((o) => o.state === "rejected"), []);                       // the venue refused nothing
  assertEquals(w.state().pusd, 3);
  w.pm.pusd = 100;
  await w.turn(T0 + M);
  assertEquals(sides(w), OPENING);
  w.pm.down.collateral = true;
  w.A.bid = 0.46;                                                                           // a re-price wants a new buy
  const r2 = await w.turn(T0 + 2 * M);
  assert(r2.errors.some((e) => e.startsWith("pUSD balance unreadable")), r2.errors.join(" | "));
  assertEquals(r2.withheld.filter((x) => x.gate === "collateral").map((x) => [x.slot, x.reason]), [[`${cond(5)}|${tok(5, "yes")}|BUY`, "the pUSD balance could not be read"]]);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 4);                    // 1, then 3; none this turn
  // The three funded orders the rule keeps as they are stay: an unread balance stops new buys, it cancels nothing funded.
  assertEquals(r2.cancelled.map((c) => c.gate), ["collateral"]);
  assertEquals(sides(w), ["05 no BUY 0.53 5 open", "06 no BUY 0.771 20 open", "06 yes BUY 0.201 20 open"]);
  // A dry-run reads the balance too, and records it for the go-time statement, and is held to none: with $0 it rests
  // all four quotes.
  const d = makeWorld();
  d.pm.pusd = 0;
  const rd = await d.turn(T0);
  assertEquals([d.open().length, d.pm.calls.filter((c) => c.includes("balance-allowance")).length, d.state().pusd, rd.withheld], [4, 5, 0, []]);
  d.pm.pusd = 401.37;
  await d.turn(T0 + M);
  assertEquals(d.state().pusd, 401.37);
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
  const trade = w.pm.fill(String(yes.hash), 5);
  w.pm.settle(trade, "CONFIRMED");
  w.A.bid = 0.33; w.A.ask = 0.35;
  let r = await w.turn(T0 + M);
  assertEquals([r.pnl, r.gates?.openBlockedBy], [{ day: -0.55, total: -0.55 }, "loss_day"]);
  assertEquals(sides(w), ["05 yes SELL 0.35 5 reduce"]);
  assertEquals(w.events("loss_stop_day").length, 1);
  w.A.bid = 0.45; w.A.ask = 0.47;
  r = await w.turn(T0 + 2 * M);
  assertEquals(r.gates?.openBlockedBy, "loss_day");
  r = await w.turn(Date.parse("2026-10-03T00:01:00Z"));
  assertEquals(r.gates?.open, true);
  // The new day's YES bid fills too (10 YES at 0.45), and A falls to 0.30 / 0.32, under our NO bid's ask at 0.47:
  // −1.40 in all, past the run's limit. Today (the day stop counts the change since 00:00 from 2026-10-07): the 5 held
  // from yesterday start the day at their mark as it began, 0.46 (the 10-02 turn's, A at 0.45 / 0.47), the 5 bought
  // today at 0.45: 5 × (0.31 − 0.46) + 5 × (0.31 − 0.45) = −1.45, past the day's.
  const yes2 = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "yes" && o.side === "BUY")!;
  w.pm.settle(w.pm.fill(String(yes2.hash), 5), "CONFIRMED");
  w.A.bid = 0.30; w.A.ask = 0.32;
  r = await w.turn(Date.parse("2026-10-03T00:02:00Z"));
  assertEquals(r.pnl, { day: -1.45, total: -1.4 });
  assertEquals(r.gates?.openBlockedBy, "loss_day");
  assertEquals([w.events("loss_stop_day").length, w.events("loss_stop_total").length], [2, 1]);
  w.A.bid = 0.45; w.A.ask = 0.47;
  r = await w.turn(Date.parse("2026-10-04T00:01:00Z"));
  assertEquals(r.gates?.openBlockedBy, "loss_total");
});

Deno.test("a market held from an earlier day is read and marked, never quoted; resolved, it is settled at its payout and its unredeemed tokens count as capital until redeemed", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const yes = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "yes")!;
  w.pm.settle(w.pm.fill(String(yes.hash), 5), "CONFIRMED");                              // 5 YES of A at 0.45
  await w.turn(T0 + M);
  // The next day A takes no orders, so it is not chosen; it is still held: read (book, both balances), marked, not quoted.
  w.A.accepting = false;
  const r = await w.turn(Date.parse("2026-10-03T00:01:30Z"));
  assertEquals(r.markets.find((m) => m.cond === cond(5))?.quoting, false);
  assertEquals(r.markets.find((m) => m.cond === cond(5))?.held, { yes: 5, no: 0 });
  assertEquals(w.open("live").filter((o) => o.cond === cond(5)), []);
  assertEquals(w.markets().filter((m) => m.day === "2026-10-03").map((m) => m.cond), [cond(6), cond(7)]);
  // A's book goes and Gamma shows it closed with a payout but no closed time yet: held at its cost, not settled (RW's
  // condition is both), and no fault.
  Object.assign(w.A, { resolved: true, payout: 1 });
  const pre = await w.turn(Date.parse("2026-10-03T06:04:30Z"));
  assertEquals([(w.mem.tables.pm_live_settlements as Row[]).length, pre.errors, pre.conditions[cond(5)]], [0, [], "left the book (404)"]);
  // A resolves YES: Gamma shows it closed at 1, with its time. Settled: +5 × 0.55 realised, nothing of it held.
  w.A.closedTime = "2026-10-03 06:00:00+00";
  const s = await w.turn(Date.parse("2026-10-03T06:05:30Z"));
  assertEquals(s.errors, []);
  assertEquals((w.mem.tables.pm_live_settlements as Row[]).map((x) => [x.cond, Number(x.payout), x.closed_time]), [[cond(5), 1, "2026-10-03 06:00:00+00"]]);
  // In all +5 × 0.55; today (the change since 00:00, 2026-10-07) from the mark the day began at, 0.46: +5 × 0.54.
  assertEquals(s.pnl, { day: 2.7, total: 2.75 });
  // Until redeemed, its 5 YES are $5 of capital the pUSD does not have back: B's and C's bids ($39.04) fit a $42 total
  // cap alone, not beside it.
  w.setConfig({ cap_total_usd: 42 });
  const capped = await w.turn(Date.parse("2026-10-03T06:06:30Z"));
  assert(capped.withheld.some((x) => x.gate === "cap_total"), JSON.stringify(capped.withheld));
  w.pm.tokens.set(w.A.yes, 0);                                                            // redeemed on polymarket.com
  await w.turn(Date.parse("2026-10-03T06:07:30Z"));
  assertEquals(w.state().redeemed, [cond(5)]);
  const free = await w.turn(Date.parse("2026-10-03T06:08:30Z"));
  assertEquals(free.withheld.filter((x) => x.gate === "cap_total"), []);
  assertEquals(w.pm.calls.filter((c) => c === "GET clob.polymarket.com/balance-allowance").length > 0, true);
});

// ------------------------------------------------------------------ the live path, against the strict fake

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
  const sigs = w.pm.bodies.map((b) => JSON.parse(b).order?.signature).filter(Boolean);
  assertEquals(sigs.length, 4);
  const all = JSON.stringify(w.mem.tables);
  assert(sigs.every((s: string) => !all.includes(s.slice(2, 40))));
});

Deno.test("live: our resting orders are in the venue's book, and RW's rule does not chase them — a wide market is quoted once and left alone", async () => {
  // A at 0.45 / 0.50: RW bids 0.46 and asks 0.49 (a BUY of NO at 0.51). In the venue's one book they are the new touch.
  const w = makeWorld({ live: true, wide: true });
  await w.turn(T0);
  assertEquals(sides(w).filter((s) => s.startsWith("05")), ["05 no BUY 0.51 5 open", "05 yes BUY 0.46 5 open"]);
  const yesBook = w.pm.yesBook(w.A);
  assertEquals([yesBook.bids[0], yesBook.asks[0]], [[0.46, 5], [0.49, 5]]);
  const posts = () => w.pm.calls.filter((c) => c.startsWith("POST")).length;
  const before = posts();
  for (let k = 1; k <= 3; k++) {
    const r = await w.turn(T0 + k * M);
    assertEquals(r.cancelled, [], `minute ${k}`);
  }
  assertEquals(posts(), before);
  // The minute's formula scores ours against the others' 5 at 0.45 / 0.50, and the venue says both sides are scoring.
  const row = w.minutes().find((m) => m.cond === cond(5) && m.minute === iso(Math.floor((T0 + 3 * M) / M) * M))!;
  assertEquals([row.mode, Number(row.bb), Number(row.ba), row.bid_price, row.ask_price, row.bid_scoring, row.ask_scoring], ["live", 0.45, 0.5, 0.46, 0.49, true, true]);
  assert(Number(row.formula_usd) > 0);
});

Deno.test("live: the next day's selection reads the books without our orders still resting from the day before, so a market we quoted ranks as the rest of its book does", async () => {
  const w = makeWorld({ live: true });
  await w.turn(Date.parse("2026-10-02T23:59:30Z"));
  const ranked = (day: string) => w.markets().filter((m) => m.day === day).map((m) => [m.cond, m.rank, Number(m.per_dollar_day), Number(m.capital)]);
  assertEquals(w.open("live").length, 4);                                                    // still resting at midnight
  await w.turn(Date.parse("2026-10-03T00:00:30Z"));
  assertEquals(ranked("2026-10-03"), ranked("2026-10-02"));
  assertEquals(ranked("2026-10-03").map((x) => x[0]), [cond(5), cond(6)]);
});

Deno.test("live: an order is sent only while the turn holds its lease, renewed once half of it is gone; a run that lost it sends nothing more", async () => {
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
  assertEquals(lease().holder, "another run");
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
  assertEquals(w.pm.orders.size, 4);
  w.pm.postMode = "ok";
  const posts = () => w.pm.calls.filter((c) => c.startsWith("POST")).length;
  await w.turn(T0 + 30e3);
  assertEquals([posts(), w.open("live").filter((o) => o.state === "pending").length], [4, 4]);
  await w.turn(T0 + 61e3);
  assertEquals([posts(), w.open("live").filter((o) => o.state === "live").length], [4, 4]);
});

Deno.test("unknown is never rejected: a 5xx leaves the order pending; one the venue shows nowhere stays pending for a person, its slot sending nothing, until it is past its expiration: then it is closed as expired and its slot quotes again (F3)", async () => {
  const w = makeWorld({ live: true });
  w.pm.postMode = "500";
  const r = await w.turn(T0);
  assertEquals(w.open("live").map((o) => o.state), ["pending", "pending", "pending", "pending"]);
  assert(r.errors.every((e) => e.includes("outcome unknown")), r.errors.join("\n"));
  const expiration = Number(w.open("live")[0].expiration);
  w.pm.postMode = "ok";
  // Until the venue's expiry (the expiration less its minute) nothing is known: pending, for a person, no second order.
  for (const t of [T0 + 2 * M, (expiration - 61) * 1000]) {
    const rr = await w.turn(t);
    assertEquals(w.open("live").map((o) => o.state), ["pending", "pending", "pending", "pending"]);
    assert(rr.errors.some((e) => e.includes("shown nowhere by the venue") && e.includes("for a person")), rr.errors.join("\n"));
    assert(!rr.errors.some((e) => e.includes("another open order holds this slot")), rr.errors.join("\n"));
  }
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 4);
  // From then it cannot rest: each row is closed as expired, said once, and the freed slots quote again in the same turn.
  const t1 = (expiration - 60) * 1000;
  const r1 = await w.turn(t1);
  const closed = w.orders().filter((o) => o.mode === "live" && o.state === "expired");
  assertEquals(closed.length, 4);
  assert(closed.every((o) => o.cancelled_at === new Date(t1).toISOString()), JSON.stringify(closed.map((o) => o.cancelled_at)));
  assertEquals(r1.errors.filter((e) => e.includes("closed as expired")).length, 4);
  assertEquals(w.open("live").map((o) => o.state), ["live", "live", "live", "live"]);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 8);
  const r2 = await w.turn(t1 + M);
  assert(!r2.errors.some((e) => e.includes("shown nowhere") || e.includes("closed as expired")), r2.errors.join("\n"));
  const v = makeWorld({ live: true });
  v.pm.postMode = "500-after-accept";
  await v.turn(T0);
  v.pm.postMode = "ok";
  await v.turn(T0 + 2 * M);
  assertEquals(v.open("live").map((o) => o.state), ["live", "live", "live", "live"]);
});

Deno.test("an explicit refusal is rejected and the same quote is not sent again; a 425 restart is not a refusal: sent again as a new order", async () => {
  // The fake refuses for balance (the collateral guard would have withheld these: it is told the balance is ample).
  const w = makeWorld({ live: true });
  const inner = w.pm.venue();
  const venue: PmVenue = { ...inner, collateral: async () => ({ ok: true, status: 200, ms: 0, data: { balance: "1000000000" } }) };
  w.pm.pusd = 0;
  await w.turn(T0, { venue });
  assertEquals(w.orders().map((o) => o.state), ["rejected", "rejected", "rejected", "rejected"]);
  assert(w.orders().every((o) => String((o.response as { why: string }).why).includes("not enough balance / allowance")));
  const r = await w.turn(T0 + M, { venue });
  assertEquals([w.orders().length, r.withheld.filter((x) => x.gate === "refused").length], [4, 4]);
  w.A.bid = 0.44;                                                                           // RW's bid on A moves: that quote is sent again
  await w.turn(T0 + 2 * M, { venue });
  assert(w.orders().length > 4);
  const z = makeWorld({ live: true });
  z.pm.restart = true;
  await z.turn(T0);
  assertEquals(z.orders().map((o) => [o.state, (o.response as { retry: boolean }).retry]), [["rejected", true], ["rejected", true], ["rejected", true], ["rejected", true]]);
  z.pm.restart = false;
  await z.turn(T0 + M);
  assertEquals(z.open("live").length, 4);
  assertEquals(new Set(z.orders().map((o) => o.hash)).size, 8);
});

Deno.test("refusalWait: a refused quote waits for new information — the rule's price or size, or, refused as crossing, the level it faced; a retry kind waits for nothing", () => {
  const CROSS = "400 invalid post-only order: order crosses book";
  const last = (why: string, facing: PmLevel | null, o: Record<string, unknown> = {}) => ({ state: "rejected" as const, price: 0.45, size: 5, response: { why, retry: false }, book_seen: { facing }, ...o });
  const w = { price: 0.45, size: 5, facing: [0.47, 5] as PmLevel };
  assert(refusalWait(last(CROSS, [0.47, 5]), w)?.includes("as crossing"));                          // the same level: wait
  assertEquals(refusalWait(last(CROSS, [0.47, 8]), w), null);                                       // its size moved: go
  assertEquals(refusalWait(last(CROSS, [0.48, 5]), w), null);                                       // its price moved: go
  assertEquals(refusalWait(last(CROSS, null), w), null);                                            // it was empty, now is not
  assert(refusalWait(last(CROSS, null), { ...w, facing: null }) !== null);                          // empty both times: wait
  assertEquals(refusalWait(last(CROSS, [0.47, 5]), { ...w, price: 0.44 }), null);                   // the rule moved: go
  assertEquals(refusalWait(last(CROSS, [0.47, 5]), { ...w, size: 6 }), null);
  assert(refusalWait(last("400 not enough balance / allowance", [0.47, 5]), { ...w, facing: [0.47, 9] })?.includes("price or size"));   // not a cross: the book is no news
  assertEquals(refusalWait(last(CROSS, [0.47, 5], { response: { why: "429 too many requests: not taken", retry: true } }), w), null);
  assertEquals(refusalWait({ ...last(CROSS, [0.47, 5]), state: "cancelled" }, w), null);
  assertEquals(refusalWait(undefined, w), null);
});

Deno.test("a quote the venue refused as crossing is not sent every minute: five quiet minutes, one send; the level it faces moves, one more; never leaning on the rate limit", async () => {
  // The venue's book at the POST was not the one the turn read: it refuses A's YES bid as crossing, every time it is sent.
  const w = makeWorld({ live: true });
  const inner = w.pm.venue();
  let refuse = true;
  const venue: PmVenue = {
    ...inner,
    postOrder: (o, t, p) => (refuse && o.tokenId === w.A.yes ? Promise.resolve({ ok: false, status: 400, ms: 0, error: "invalid post-only order: order crosses book" }) : inner.postOrder(o, t, p)),
  };
  const sends = () => w.orders().filter((o) => o.token === w.A.yes && o.side === "BUY");
  await w.turn(T0, { venue });
  assertEquals(sends().map((o) => [o.state, Number(o.price), (o.book_seen as { facing: PmLevel }).facing]), [["rejected", 0.45, [0.47, 5]]]);
  for (let k = 1; k <= 5; k++) {
    const r = await w.turn(T0 + k * M, { venue });
    assert(r.withheld.some((x) => x.gate === "refused" && x.slot.includes(w.A.yes)), `minute ${k}`);
  }
  assertEquals(sends().length, 1);                                                          // five quiet minutes: one send
  // The ask it faces takes more size (the rule's price is the same): new information, so it goes once more.
  w.A.depth = [[0, 8]];
  await w.turn(T0 + 6 * M, { venue });
  await w.turn(T0 + 7 * M, { venue });
  assertEquals(sends().map((o) => [o.state, Number(o.price)]), [["rejected", 0.45], ["rejected", 0.45]]);
  // The venue takes it once the level moves again.
  refuse = false;
  w.A.depth = [[0, 5]];
  await w.turn(T0 + 8 * M, { venue });
  assertEquals(sends().map((o) => o.state), ["rejected", "rejected", "live"]);
});

Deno.test("post-only against the whole book: a bid that would take our own ask whose cancel the venue did not take is withheld, not sent to be refused", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const no = w.open("live").find((o) => o.cond === cond(5) && o.outcome === "no")!;            // NO BUY 0.53: our ask at 0.47
  const inner = w.pm.venue();
  // The venue says it cancelled NO's order and did not: it still rests, at 0.47 in the one book.
  const venue: PmVenue = { ...inner, cancelOrder: (id) => (id === no.hash ? Promise.resolve({ ok: true, status: 200, ms: 0, data: { canceled: [id], not_canceled: {} } }) : inner.cancelOrder(id)) };
  // The rest of A's book goes to 0.46 / 0.50: RW bids 0.47 and asks 0.49, so both slots re-price.
  w.A.bid = 0.46; w.A.ask = 0.50;
  const r = await w.turn(T0 + M, { venue });
  assertEquals(r.cancelled.filter((c) => c.slot.startsWith("0x0000…0005")).map((c) => [c.slot.split("|").slice(1).join(" "), c.outcome]).sort(), [["no BUY", "frozen"], ["yes BUY", "cancelled"]]);
  const self = r.withheld.find((x) => x.gate === "post_only" && x.slot.includes(w.A.yes));
  assert(self?.reason.includes("would take our own live order"), JSON.stringify(r.withheld));
  assertEquals(w.orders().filter((o) => o.state === "rejected"), []);                      // nothing sent to be refused
  // Once the venue takes the cancel, both go.
  await w.turn(T0 + 2 * M);
  assertEquals(sides(w).filter((s) => s.startsWith("05")), ["05 no BUY 0.51 5 open", "05 yes BUY 0.47 5 open"]);
});

Deno.test("reconciliation by hash: a fill is read from the order and its trades until CONFIRMED; FAILED is no fill; P&L counts CONFIRMED only", async () => {
  const w = makeWorld({ live: true });
  w.pm.tradeStatusPrefix = "TRADE_STATUS_";
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
  assertEquals(r.pnl, { day: 0, total: 0 });
  w.pm.settle(t1, "CONFIRMED");
  w.pm.settle(t2, "FAILED");
  r = await w.turn(T0 + 2 * M);
  assertEquals(fills(), [[t1, "CONFIRMED", 5, 0.45], [t2, "FAILED", 2, 0.53]]);
  assertEquals(r.pnl, { day: 0.05, total: 0.05 });
});

Deno.test("cancel, then post: the replacement goes only after the cancel is READ BACK; a cancel the venue never carries out freezes the slot, a fault from the turn after it was first asked", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const slotCalls = () => w.pm.calls.filter((c) => !c.includes("/book") && !c.includes("geoblock") && !c.includes("closed-only") && !c.includes("balance") && !c.includes("/rewards/") && !c.includes("/order-scoring") && !c.includes("/rebates/"));
  w.A.bid = 0.46;
  w.pm.calls.length = 0;
  await w.turn(T0 + M);
  // The read-back straight after the DELETE still shows it resting (the venue a read behind); 300 ms later it is
  // cancelled, and only then does the replacement go.
  assertEquals(slotCalls().map((c) => c.replace(/\/data\/order\/.*/, "/data/order/*")), [
    ...Array(4).fill("GET clob.polymarket.com/data/order/*"), "DELETE clob.polymarket.com/order", "GET clob.polymarket.com/data/order/*", "GET clob.polymarket.com/data/order/*",
    "POST clob.polymarket.com/order",
  ]);
  assertEquals(w.pauses, [PM_LIVE_CANCEL_REREAD_MS[0]]);
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
  // A cancel the venue says it took and never carries out: frozen, read again twice, no fault on its first turn…
  w.pm.cancelMode = "lost";
  w.A.bid = 0.45;
  w.pauses.length = 0;
  let r = await w.turn(T0 + 2 * M);
  assertEquals(r.cancelled.map((c) => c.outcome), ["frozen"]);
  assertEquals(w.pauses, [...PM_LIVE_CANCEL_REREAD_MS]);
  assertEquals(r.errors.filter((e) => e.includes("FROZEN")), []);
  assert(!r.errors.some((e) => e.includes("another open order holds this slot")), r.errors.join("\n"));
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
  // …and a fault from the next, once a slot, while nothing is placed in it.
  r = await w.turn(T0 + 3 * M);
  assertEquals([r.cancelled.map((c) => c.outcome), w.pm.calls.filter((c) => c.startsWith("POST")).length], [["frozen"], 1]);
  assertEquals(r.errors.filter((e) => e.includes("FROZEN") && e.includes("first asked at")).length, 1, r.errors.join("\n"));
  w.pm.cancelMode = "throw";
  r = await w.turn(T0 + 4 * M);
  assertEquals(r.cancelled.filter((c) => c.slot === "0x0000…0005|yes|BUY").map((c) => [c.gate, c.outcome]), [["reprice", "cancelled"]]);
  assertEquals(r.cancelled.filter((c) => c.slot !== "0x0000…0005|yes|BUY").map((c) => c.gate), ["refresh", "refresh", "refresh"]);
  assertEquals(sides(w).filter((s) => s.startsWith("05 yes")), ["05 yes BUY 0.45 5 open"]);
});

Deno.test("a cancel the venue carries out a read after its reply (the double's default, as PR5's venue was measured): read again, confirmed in the same turn, replaced, no fault", async () => {
  const w = makeWorld({ live: true });
  assertEquals(w.pm.cancelLagReads, 1);
  await w.turn(T0);
  w.A.bid = 0.46; w.A.ask = 0.48;                                                           // both of A's quotes re-price
  const r = await w.turn(T0 + M);
  assertEquals(r.errors, []);
  assertEquals(r.cancelled.map((c) => [c.gate, c.outcome]), [["reprice", "cancelled"], ["reprice", "cancelled"]]);
  assertEquals(w.pauses, [PM_LIVE_CANCEL_REREAD_MS[0], PM_LIVE_CANCEL_REREAD_MS[0]]);         // one re-read each
  assertEquals(sides(w).filter((x) => x.startsWith("05")), ["05 no BUY 0.52 5 open", "05 yes BUY 0.46 5 open"]);
  assert(w.orders().filter((o) => o.state === "cancelled").every((o) => o.cancel_requested_at != null && o.cancelled_at != null));
});

Deno.test("a cancel slower than the re-reads freezes its slot for a turn without a fault, the old order still in it; the next turn confirms it and replaces it", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  w.pm.cancelLagReads = 3;                                                                  // resting on the read-back and both re-reads
  w.A.bid = 0.46;
  const r1 = await w.turn(T0 + M);
  assertEquals(r1.errors, []);
  assertEquals(r1.cancelled.map((c) => c.outcome), ["frozen"]);
  assertEquals(w.pauses, [...PM_LIVE_CANCEL_REREAD_MS]);
  assertEquals(sides(w).filter((x) => x.startsWith("05 yes")), ["05 yes BUY 0.45 5 open"]);   // never two orders in a slot
  assertEquals([...w.pm.orders.values()].filter((o) => o.status === "LIVE" && o.token === w.A.yes).length, 1);
  const old = w.open("live").find((o) => o.token === w.A.yes)!;
  const r2 = await w.turn(T0 + 2 * M);                                                      // the venue has carried it out by now:
  assertEquals(r2.errors, []);                                                              // the turn's own read-back settles it
  assertEquals(r2.settled.filter((x) => x.hash === old.hash), [{ hash: String(old.hash), state: "cancelled" }]);
  assertEquals(sides(w).filter((x) => x.startsWith("05 yes")), ["05 yes BUY 0.46 5 open"]);
});

Deno.test("global pause, live: a cancel-all the venue carries out late is no fault on its first turn; one it never carries out is, from the next", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = true;
  w.pm.cancelLagReads = 3;
  const r1 = await w.turn(T0 + M);
  assertEquals(r1.errors, []);
  assertEquals(w.open("live").length, 4);                                                   // still resting, every one marked
  assert(w.open("live").every((o) => o.cancel_gate === "global_pause" && o.cancel_requested_at === iso(T0 + M)));
  const r2 = await w.turn(T0 + 2 * M);
  assertEquals([r2.errors, w.open("live").length], [[], 0]);
  // Never carried out: a fault on each order from the turn after the cancel-all was first sent.
  const n = makeWorld({ live: true });
  await n.turn(T0);
  (n.mem.tables.agent_risk as Row[])[0].global_pause = true;
  n.pm.cancelMode = "lost";
  const s1 = await n.turn(T0 + M);
  assertEquals(s1.errors, []);
  const s2 = await n.turn(T0 + 2 * M);
  assertEquals(s2.errors.filter((e) => e.includes("after the global pause's cancel-all, first asked at")).length, 4, s2.errors.join("\n"));
  assertEquals(n.pm.calls.filter((c) => c.startsWith("POST")).length, 4);                    // nothing placed while paused
});

Deno.test("an order that fills while it is being cancelled is not replaced in that turn: the next turn reads the holding it made first", async () => {
  const w = makeWorld({ live: true });
  await w.turn(T0);
  const inner = w.pm.venue();
  const venue: PmVenue = { ...inner, cancelOrder: async (id) => { if (w.pm.orders.get(id)?.status === "LIVE") w.pm.fill(id, 1e9); return await inner.cancelOrder(id); } };
  w.A.bid = 0.46;
  const posts = () => w.pm.calls.filter((c) => c.startsWith("POST")).length;
  const before = posts();
  const r = await w.turn(T0 + M, { venue });
  assertEquals(r.cancelled.map((c) => [c.slot, c.outcome]), [["0x0000…0005|yes|BUY", "filled"]]);
  assertEquals(posts(), before);
  assertEquals(w.orders().filter((o) => o.cond === cond(5) && o.outcome === "yes").map((o) => o.state), ["filled"]);
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
  const r1 = await w.turn(T0 + M);
  assertEquals(r1.errors, []);                                                              // a read behind: confirmed on a re-read
  assertEquals(w.pauses, Array(4).fill(PM_LIVE_CANCEL_REREAD_MS[0]));
  assertEquals(w.pm.calls.filter((c) => c.startsWith("DELETE")), ["DELETE clob.polymarket.com/cancel-all"]);
  assertEquals(w.pm.calls.filter((c) => c.startsWith("POST")).length, 0);
  assertEquals([w.open("live").length, [...w.pm.orders.values()].filter((o) => o.status === "LIVE").length], [0, 0]);
  w.pm.calls.length = 0;
  await w.turn(T0 + 2 * M);
  assertEquals(w.pm.calls.filter((c) => !c.startsWith("GET")), []);
  (w.mem.tables.agent_risk as Row[])[0].global_pause = false;
  await w.turn(T0 + 3 * M);
  assertEquals(sides(w), OPENING);
});

Deno.test("the fake is as strict as the CLOB: off-tick, under-minimum, too-near expiry, a foreign signature, maker or signer, a crossing post-only order (ours included), a duplicate, closed-only and a blocked country are all refused", async () => {
  const w = makeWorld({ live: true });
  const v = w.pm.venue();
  const key = new PmOrderKey(PM_TEST_KEY), other = new PmOrderKey(`0x${"11".repeat(32)}`);
  const exp = nowS(T0) + 300;
  type Make = Partial<{
    price: number; size: number; side: "BUY" | "SELL"; maker: string; signer: string; expiration: number; negRisk: boolean; by: PmOrderKey; salt: string; token: string;
    amounts: { makerAmount: string; takerAmount: string };
  }>;
  const make = (p: Make = {}) => {
    const b = buildOrderFor({ tokenId: p.token ?? w.A.yes, side: p.side ?? "BUY", price: p.price ?? 0.44, size: p.size ?? 5, tick: "0.01", negRisk: false,
      maker: p.maker ?? PM_TEST_FUNDER, signer: p.signer ?? PM_TEST_SIGNER, salt: p.salt ?? "77", timestampMs: T0, expiration: p.expiration ?? exp });
    const order = { ...b.order, ...(p.amounts ?? {}) };
    return { ...order, signature: (p.by ?? key).signDigest(orderHash(order, exchangeFor(p.negRisk ?? false))) };
  };
  const err = async (o: ReturnType<typeof make>) => (await v.postOrder(o, "GTD", true)).error ?? "accepted";
  assertEquals(await err(make()), "accepted");
  assert((await err(make({ salt: "78", amounts: { makerAmount: "4450000", takerAmount: "10000000" } }))).includes("breaks minimum tick size rule"));
  assert((await err(make({ salt: "79", size: 4 }))).includes("lower than the minimum"));
  assertEquals(await err(make({ salt: "80", expiration: nowS(T0) + 179 })), "invalid expiration");
  assertEquals(await err(make({ salt: "81", by: other })), "invalid signature");
  assertEquals(await err(make({ salt: "82", negRisk: true })), "invalid signature");
  assertEquals(await err(make({ salt: "83", maker: `0x${"22".repeat(20)}` })), "the order owner has to be the owner of the API KEY");
  assertEquals(await err(make({ salt: "84", signer: other.address(), by: other })), "the order signer address has to be the address of the API KEY");
  assertEquals(await err(make({ salt: "85", price: 0.47 })), "invalid post-only order: order crosses book");
  // Our own resting bid at 0.44 is in the book: a NO bid at 0.56 (an ask at 0.44) would take it.
  assertEquals(await err(make({ salt: "89", token: w.A.no, price: 0.56 })), "invalid post-only order: order crosses book");
  assert((await err(make())).includes("Duplicated"));
  assertEquals(await err(make({ salt: "86", side: "SELL", price: 0.48 })), "not enough balance / allowance");
  w.pm.closedOnlyFlag = true;
  assert((await err(make({ salt: "87" }))).includes("closed only mode"));
  w.pm.closedOnlyFlag = false;
  w.pm.geo = { blocked: true, country: "GB", region: "ENG", ip: "198.51.100.1" };
  assertEquals(await err(make({ salt: "88" })), "trading restricted in GB");
});

// ------------------------------------------------------------------ the action, as the one-minute job calls it

Deno.test("agents?action=pmlive: it loads the key only for the stored signer, records the runtime's SB_REGION, signs its account reads, scrubs what it returns, and never throws", async () => {
  // Books of two levels a side: mini-pool's book-quality rule, which its action runs (PM_MINI_INSTANCE), takes A and B.
  const w = makeWorld({ deep: true });
  const secret = btoa("TEST-L2-SECRET-32-BYTES-LONG-001");
  const planted: Record<string, string> = {
    POLYMARKET_PRIVATE_KEY: PM_TEST_KEY, POLYMARKET_CLOB_API_KEY: PM_TEST_OWNER, POLYMARKET_CLOB_SECRET: secret, POLYMARKET_CLOB_PASSPHRASE: "test-passphrase-123",
    POLYMARKET_FUNDER_ADDRESS: PM_TEST_FUNDER, POLYMARKET_SIGNER_ADDRESS: PM_TEST_SIGNER, POLYMARKET_SIG_TYPE: "1", SB_REGION: "eu-west-1",
  };
  const asked: string[] = [];
  const read = (n: string) => { asked.push(n); return planted[n]; };
  const r = await runPmLiveAction({ db: w.db, fetchImpl: w.pm.fetch, read, now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(asked.includes("POLYMARKET_PRIVATE_KEY"), asked.join());
  // The config is the lock: dry_run on, so a dry-run whatever the key.
  assertEquals([r.mode, r.sbRegion, r.errors], ["dry_run", "eu-west-1", []]);
  assert(r.why.includes("pm_live_config.dry_run is on"), r.why);
  assertEquals(w.open().length, 4);
  assertEquals(w.writes(), []);
  // The action runs mini-pool's instance: its selection applied the book-quality rule and recorded it.
  const sel = w.events("selection")[0]?.detail as Record<string, any>;
  assertEquals(sel?.bookQuality, { rule: PM_MINI_QUALITY.name, passedOver: 0, why: {}, filled: 0 });
  assert(!w.pm.calls.some((c) => c.endsWith("(401)")), "every account read carried the key's L2 headers");
  const out = JSON.stringify(r) + JSON.stringify(w.mem.tables);
  for (const s of ["test-passphrase-123", secret, PM_TEST_KEY.slice(2, 22), PM_TEST_KEY.slice(30, 50).toUpperCase()]) assert(!out.includes(s), s);
  // Unlocked by the config, it is live and sends (the wire reads the runtime's own SB_REGION, not the action's reader).
  const L = makeWorld({ live: true, deep: true });
  const prevRegion = Deno.env.get("SB_REGION");
  Deno.env.set("SB_REGION", "eu-west-1");
  try {
    const rl = await runPmLiveAction({ db: L.db, fetchImpl: L.pm.fetch, read, now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
    assertEquals([rl.mode, L.writes().length, rl.errors], ["live", 4, []]);
  } finally {
    if (prevRegion === undefined) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", prevRegion);
  }
  // A key that is not the signer's loads none: a dry-run, and it says why.
  const K = makeWorld({ live: true, deep: true });
  const rk = await runPmLiveAction({ db: K.db, fetchImpl: K.pm.fetch, read: (n) => (n === "POLYMARKET_PRIVATE_KEY" ? `0x${"11".repeat(32)}` : planted[n]), now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
  assertEquals([rk.mode, K.writes()], ["dry_run", []]);
  assert(rk.why.includes("the private key's address is not POLYMARKET_SIGNER_ADDRESS"), rk.why);
  assert(rk.errors.some((e) => e.startsWith("secrets:")), rk.errors.join(" | "));
  // A database that refuses everything: a report, not a throw.
  const broken = { ...w.db, claim: () => Promise.reject(new Error("db PATCH agent_locks → 503")) };
  const r2 = await runPmLiveAction({ db: broken as typeof w.db, fetchImpl: w.pm.fetch, read, now: T0 + M }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(r2.errors[0].startsWith("LEASE CLAIM FAILED"), JSON.stringify(r2));
  // Missing secrets are named in the report, and the turn still runs its public reads.
  const r3 = await runPmLiveAction({ db: makeWorld().db, fetchImpl: w.pm.fetch, read: (n) => (n === "SB_REGION" ? "eu-west-1" : undefined), now: T0 }) as Awaited<ReturnType<typeof runPmLive>>;
  assert(r3.errors.some((e) => e.startsWith("secrets:")) && r3.errors.some((e) => e.startsWith("closed-only flag unreadable")), r3.errors.join("\n"));
});

// ------------------------------------------------------------------ F4: a V2-protocol book; a refusal of the order's version

Deno.test("bookProtocol / bookNow: a book that names a protocol (a Polymarket Protocol V2 book) is unquotable; a CTF book omits it", () => {
  const ctf = { bids: [{ price: "0.40", size: "10" }], asks: [{ price: "0.42", size: "10" }], tick_size: "0.01", min_order_size: "5", neg_risk: false, timestamp: "1790000000000" };
  assertEquals(bookProtocol(ctf), null);
  assert(bookNow(ctf) !== null);
  for (const version of ["v2", "2", "ctf"]) {
    assertEquals(bookProtocol({ ...ctf, version }), version);
    assertEquals(bookNow({ ...ctf, version }), null);
  }
  assertEquals([bookProtocol({ ...ctf, version: null }), bookProtocol({ ...ctf, version: "" })], [null, null]);
});

Deno.test("a V2-protocol book is never selected, and one that turns V2 while selected is withdrawn and recorded as a condition, not a fault (F4)", async () => {
  // Selection: A, RW's first pick, names a protocol; it is passed over and nothing is ever placed in it.
  const v = makeWorld({ live: true });
  v.A.version = "v2";
  await v.turn(T0);
  assert(!v.markets().some((m) => m.cond === v.A.cond), JSON.stringify(v.markets().map((m) => m.cond)));
  assert(v.markets().length > 0);
  assert(!v.orders().some((o) => o.cond === v.A.cond));
  // A selected market whose book turns V2: its orders are withdrawn, nothing replaces them, and the minute says why.
  const w = makeWorld({ live: true });
  await w.turn(T0);
  assert(w.open("live").some((o) => o.cond === w.A.cond));
  w.A.version = "v2";
  const r = await w.turn(T0 + M);
  assertEquals(w.open("live").filter((o) => o.cond === w.A.cond).length, 0);
  assert(!w.orders().some((o) => o.cond === w.A.cond && Date.parse(String(o.ts)) >= T0 + M));
  assertEquals(r.conditions[w.A.cond], "a Polymarket Protocol v2 book: unquotable here");
  assert(!r.errors.some((e) => e.includes(w.A.cond.slice(0, 10))), r.errors.join("\n"));
});

Deno.test("a refusal of the order's version is reported once an hour, not every minute (F4)", async () => {
  const w = makeWorld({ live: true });
  w.pm.postMode = "version-mismatch";
  const said = (r: { errors: string[] }) => r.errors.filter((e) => e.includes("refused the order's version")).length;
  const r0 = await w.turn(T0);
  assert(w.orders().filter((o) => o.mode === "live").every((o) => o.state === "rejected"));
  assertEquals(said(r0), 1);
  assertEquals(w.state().versionMismatchAt, iso(T0));
  // New quotes (the book moved) are refused the same way: within the hour, nothing more is said.
  w.A.bid = 0.44; w.A.ask = 0.46;
  const r1 = await w.turn(T0 + 30 * M);
  assert(w.orders().some((o) => o.mode === "live" && Date.parse(String(o.ts)) === T0 + 30 * M), "sent again on new information");
  assertEquals(said(r1), 0);
  // An hour on, it is said again.
  w.A.bid = 0.45; w.A.ask = 0.47;
  const r2 = await w.turn(T0 + 61 * M);
  assertEquals(said(r2), 1);
  assertEquals(w.state().versionMismatchAt, iso(T0 + 61 * M));
  // A turn that never met one keeps no such field.
  const d = makeWorld({ live: true });
  await d.turn(T0);
  assertEquals("versionMismatchAt" in d.state(), false);
});
