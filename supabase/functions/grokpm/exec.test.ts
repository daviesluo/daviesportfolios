// Pins GROKPM's order path (exec.ts, Deviation D2): the agent trades through this server on the shared account, never
// holding a key, and every rule of the pre-registration's §2 a machine can check is refused with its reason. The venue is
// the order path's own strict double (`FakePolymarket`: it checks every order's signature, maker, signer, tick, size,
// expiry, post-only crossing, balances and the geoblock as the CLOB does), with Gamma's record of each market beside it;
// the database is `memDb` held to 0124's and 0125's columns and keys and to 0125's checks on an order. Each case is one
// rule: the request that breaks it, the refusal that names it, and nothing journalled or sent.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PmOrderKey } from "../_shared/polymarket_orders.ts";
import { GROKPM_TABLES } from "../_shared/grokpm_schema.ts";
import type { Db } from "../agents/db.ts";
import { FakePolymarket, memDb, PM_TEST_FUNDER, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "../agents/testing.ts";
import {
  bookOf, cancelOrders, context, type ExecDeps, expiryOf, type GrokVenue, ledgerOf, liveGateRefusals, marketOf, marketView, orderRefusals, placeOrder, syncOrders,
} from "./exec.ts";
import { handle, type IngestDb } from "./index.ts";
import examples from "../../../docs/agents/backtests/grokpm/contract_examples.json" with { type: "json" };

const T0 = Date.parse("2026-10-16T09:30:00Z");
const DAY = 86400e3;
const C1 = "0x" + "c1".repeat(32), C2 = "0x" + "c2".repeat(32), C_DUST = "0x" + "dd".repeat(32);
const cond = (i: number) => "0x" + i.toString(16).padStart(2, "0").repeat(32);
const iso = (ms: number) => new Date(ms).toISOString();

/** `memDb`, held to GROKPM's columns, primary keys, the orders' unique decision and hash, and 0125's post-only check. */
function strictDb(seed: Record<string, Row[]>, now: () => number): Db & { tables: Record<string, Row[]> } {
  const { db: mem, tables } = memDb(seed, { now });
  const check = (table: string, rows: unknown, insert: boolean) => {
    const s = GROKPM_TABLES[table];
    if (!s) return;
    for (const r of (Array.isArray(rows) ? rows : [rows]) as Row[]) {
      for (const k of Object.keys(r)) if (!s.columns.includes(k)) throw new Error(`${table}: no column ${k}`);
      if (table === "grokpm_orders" && insert) {
        if (!(r.post_only === true || (r.side === "SELL" && r.category === "C"))) throw new Error("grokpm_orders: violates check (post_only or SELL of category C)");
        for (const u of ["decision_id", "hash"]) if ((tables.grokpm_orders ?? []).some((x) => x[u] === r[u])) throw new Error(`grokpm_orders: duplicate ${u}`);
      }
      if (table === "grokpm_decisions" && insert && (tables.grokpm_decisions ?? []).some((x) => x.id === r.id)) throw new Error("grokpm_decisions: duplicate key");
    }
  };
  return {
    ...mem, tables,
    insert: (t, rows, ret) => { try { check(t, rows, true); } catch (e) { return Promise.reject(e); } return mem.insert(t, rows, ret); },
    upsert: (t, rows, on) => { try { check(t, rows, false); } catch (e) { return Promise.reject(e); } if (GROKPM_TABLES[t] && on !== GROKPM_TABLES[t].key) return Promise.reject(new Error(`${t}: no unique key ${on}`)); return mem.upsert(t, rows, on); },
    update: (t, q, patch) => { try { check(t, patch, false); } catch (e) { return Promise.reject(e); } return mem.update(t, q, patch); },
  };
}

/** An order path's config row as the double holds it (0074's columns): unarmed, or armed since yesterday. */
const pmConfig = (armed: boolean): Row => ({
  id: 1, dry_run: !armed, live_confirmed_at: armed ? iso(T0 - DAY) : null, ireland_attested_at: null, ireland_until: null, cap_total_usd: 320, cap_market_usd: 100,
  loss_day_usd: null, loss_total_usd: 75, max_posts_day: 6000, gtd_lifetime_s: 600, updated_at: iso(T0 - DAY), max_markets: 10, select_budget_usd: 200,
});
type Opts = { armed?: boolean; attested?: boolean; region?: string; key?: boolean; otherArmed?: boolean; pause?: boolean };
function world(o: Opts = {}) {
  let now = T0;
  const fake = new FakePolymarket(() => now);
  fake.pusd = 308.03;
  const deep: Array<[number, number]> = [[0, 2000], [1, 2000]];
  // Gamma's records beside the venue's books: an end date, a fee type, tags.
  const gammaExtra = new Map<string, Record<string, unknown>>();
  const add = (c: string, yes: string, no: string, extra: Record<string, unknown> = {}, book: Partial<{ bid: number; ask: number; depth: Array<[number, number]> }> = {}) => {
    fake.addMarket({ cond: c, yes, no, bid: 0.45, ask: 0.47, depth: deep, minSize: 5, question: `Will ${c.slice(2, 6)}?`, ...book });
    gammaExtra.set(c, { endDate: iso(T0 + 10 * DAY), ...extra });
  };
  add(C1, "101", "102");
  add(C2, "201", "202");
  // Live-prep's dust: the account holds 4 of token 901, which the agent never bought.
  add(C_DUST, "901", "902");
  fake.tokens.set("901", 4.28);
  const gamma: GrokVenue["gamma"] = (q) => {
    const m = fake.markets.find((x) => (q.cond ? x.cond === q.cond : x.yes === q.token || x.no === q.token));
    if (!m) return Promise.resolve({ ok: true, status: 200, ms: 0, data: { markets: [] } });
    return Promise.resolve({
      ok: true, status: 200, ms: 0, data: {
        markets: [{
          conditionId: m.cond, question: m.question, clobTokenIds: JSON.stringify([m.yes, m.no]), outcomes: '["Yes","No"]', negRisk: m.negRisk, closed: false,
          acceptingOrders: m.accepting, enableOrderBook: true, orderPriceMinTickSize: Number(m.tick), orderMinSize: m.minSize, ...gammaExtra.get(m.cond),
        }],
      },
    });
  };
  const venue: GrokVenue = { ...fake.venue(), gamma };
  const db = strictDb({
    grokpm_config: [{
      id: 1, wallet: PM_TEST_FUNDER.toLowerCase(), funded_usd: 100, daily_loss_usd: 10, total_stop_usd: 30, created_at: iso(T0 - DAY), max_orders_day: 50,
      started_at: o.armed ? iso(T0 - 3600e3) : null, dry_run: !o.armed, armed_at: o.armed ? iso(T0 - 3600e3) : null,
      ireland_attested_at: o.attested === false ? null : "2026-10-01T00:00:00Z", ireland_until: null,
    }],
    grokpm_exec_state: [{ id: 1, state: {}, updated_at: null, last_error: null }],
    agent_risk: [{ id: 1, global_pause: !!o.pause }],
    pm_live_config: [pmConfig(false)], pm_mid_config: [pmConfig(false)], pm_lp_config: [pmConfig(!!o.otherArmed)],
    grokpm_orders: [], grokpm_fills: [], grokpm_decisions: [], grokpm_resolutions: [],
  }, () => now);
  const deps = (): ExecDeps => ({
    db, venue, now, region: o.region ?? "eu-west-1",
    signer: o.key === false ? null : new PmOrderKey(PM_TEST_KEY), keyProblem: o.key === false ? "POLYMARKET_PRIVATE_KEY missing: no order can be signed" : null,
    account: o.key === false ? null : { maker: PM_TEST_FUNDER, signer: PM_TEST_SIGNER },
  });
  return { fake, db, deps, gammaExtra, add, at: (t: number) => { now = t; }, get now() { return now; } };
}

let seq = 0;
/** An open's decision as the contract asks: every field the journal needs, category B unless named. */
const open = (o: Partial<Record<string, unknown>> = {}) => ({
  decision: {
    id: `d-${++seq}`, ts: iso(T0 - 60e3), action: "open", market_id: C1, token_id: "101", outcome: "Yes", side: "BUY", price: 0.44, size: 10,
    p: 0.6, m: 0.46, category: "B", sources: ["https://example.org/a"], reason: "researched", invalidation: "if wrong", ...o,
  },
  theme: "theme-1",
});
const close = (o: Partial<Record<string, unknown>> = {}) => ({
  decision: { id: `d-${++seq}`, ts: iso(T0 - 60e3), action: "close", market_id: C1, token_id: "101", outcome: "Yes", side: "SELL", price: 0.48, size: 5, category: "C", reason: "thesis broke", ...o },
});
const rules = (r: { body: Record<string, unknown> }) => ((r.body.refusals ?? []) as Array<{ rule: string }>).map((x) => x.rule);
const posts = (fake: FakePolymarket) => fake.calls.filter((c) => c.startsWith("POST clob.polymarket.com/order")).length;

Deno.test("dry-run: an order is checked and journalled, answers what it would send, and nothing is signed or sent", async () => {
  const w = world();
  const r = await placeOrder(w.deps(), open());
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals([r.body.mode, r.body.sent], ["dry_run", false]);
  assertEquals((r.body.would_send as Record<string, unknown>).post_only, true);
  assertEquals(posts(w.fake), 0);
  assertEquals(w.fake.calls.some((c) => c.startsWith("DELETE")), false);
  assertEquals(w.db.tables.grokpm_decisions.length, 1);
  assertEquals([w.db.tables.grokpm_orders[0].mode, w.db.tables.grokpm_orders[0].state], ["dry_run", "live"]);
  // A resend of the same decision is the order it made, not a second one.
  const again = await placeOrder(w.deps(), { ...open(), decision: (open() as { decision: Record<string, unknown> }).decision, ...{} });
  assertEquals(again.status, 200);
  const dup = await placeOrder(w.deps(), { decision: w.db.tables.grokpm_decisions[0].raw, theme: "theme-1" });
  assertEquals([dup.status, dup.body.duplicate], [200, true]);
  assertEquals(w.db.tables.grokpm_orders.length, 2);
  // Its dry-run order ends when the venue would have ended it.
  w.at(T0 + 40 * 60e3);
  await syncOrders(w.deps(), []);
  assert(w.db.tables.grokpm_orders.every((o) => o.state === "expired"));
});

Deno.test("armed: a BUY rests post-only on the venue, signed for the account; its fills are read back into the agent's own book", async () => {
  const w = world({ armed: true });
  const r = await placeOrder(w.deps(), open({ price: 0.44, size: 10 }));
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals([r.body.mode, r.body.sent, posts(w.fake)], ["live", true, 1]);
  const hash = w.db.tables.grokpm_orders[0].hash as string;
  assertEquals(w.fake.orders.get(hash)?.status, "LIVE");
  w.fake.fill(hash, 10);
  w.at(T0 + 60e3);
  const errors: string[] = [];
  const s = await syncOrders(w.deps(), errors);
  assertEquals([s.fills, errors], [1, []]);
  const c = await context(w.deps(), { readGeo: true, sync: false });
  // By hand: cash 100 − 10 × 0.44 = 95.60; held 10 at the mid 0.46: 4.60; equity 100.20, total +0.20.
  assertEquals([c.ledger.cashUsd, c.ledger.heldValueUsd, c.ledger.equityUsd, c.ledger.totalUsd], [95.6, 4.6, 100.2, 0.2]);
  assertEquals(Object.keys(c.ledger.held), ["101"]);
  // It may sell what it bought, and only that.
  const sell = await placeOrder(w.deps(), close({ price: 0.48, size: 10, category: "B" }));
  assertEquals(sell.status, 200, JSON.stringify(sell.body));
  const more = await placeOrder(w.deps(), close({ price: 0.48, size: 5 }));
  assertEquals(rules(more), ["not_owned"]);
});

Deno.test("budget isolation: the account's other holdings and pUSD are never the agent's; it cannot sell live-prep's dust", async () => {
  const w = world({ armed: true });
  const c = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([c.ledger.equityUsd, c.ledger.cashUsd, Object.keys(c.ledger.held).length], [100, 100, 0]);
  const r = await placeOrder(w.deps(), close({ market_id: C_DUST, token_id: "901", size: 4, price: 0.5 }));
  assertEquals([r.status, rules(r).includes("not_owned")], [422, true]);
  assertEquals(posts(w.fake), 0);
  assertEquals(w.fake.tokens.get("901"), 4.28);
});

Deno.test("each open rule refuses with its reason, and nothing is journalled or sent", async () => {
  const cases: Array<[string, Record<string, unknown>, (w: ReturnType<typeof world>) => void]> = [
    ["longshot", { price: 0.04 }, () => {}],
    ["favourite", { price: 0.9 }, (w) => { w.fake.markets[0].bid = 0.9; w.fake.markets[0].ask = 0.92; }],
    ["market_cap", { size: 23 }, () => {}],
    ["end_date", {}, (w) => w.gammaExtra.set(C1, { endDate: iso(T0 + 31 * DAY) })],
    ["sports", {}, (w) => w.gammaExtra.set(C1, { endDate: iso(T0 + 3 * DAY), feeType: "sports_fees_v3" })],
    ["crypto", {}, (w) => w.gammaExtra.set(C1, { endDate: iso(T0 + 2 * DAY), feeType: "crypto_fees_v2" })],
    ["thin", {}, (w) => { w.fake.markets[0].depth = [[0, 50], [1, 100]]; }],
    ["thin", {}, (w) => { w.fake.markets[0].bid = 0.4; w.fake.markets[0].ask = 0.47; }],
    ["post_only", { price: 0.47 }, () => {}],
    ["venue", { price: 0.445 }, () => {}],
    ["venue", { size: 3 }, () => {}],
    ["market", { token_id: "201" }, () => {}],
  ];
  for (const [rule, change, setup] of cases) {
    const w = world();
    setup(w);
    const r = await placeOrder(w.deps(), open(change));
    assertEquals([rule, r.status, rules(r).includes(rule)], [rule, 422, true], `${rule}: ${JSON.stringify(r.body)}`);
    assertEquals([w.db.tables.grokpm_decisions.length, w.db.tables.grokpm_orders.length, posts(w.fake)], [0, 0, 0], rule);
  }
  // A favourite is category A's: at 0.90 with category A it passes.
  const w = world();
  w.fake.markets[0].bid = 0.9; w.fake.markets[0].ask = 0.92;
  assertEquals((await placeOrder(w.deps(), open({ price: 0.9, category: "A" }))).status, 200);
  // The decision itself: an open without p, m, invalidation, or sources for A/B, is invalid.
  const v = await placeOrder(world().deps(), { decision: { ...open().decision, p: undefined, sources: [] }, theme: "t" });
  assertEquals(v.status, 422);
  assertEquals((v.body.errors as string[]).sort(), ["decision.p: required", "decision.sources: at least one source is required for category A or B"]);
  // No theme, no open.
  assertEquals(rules(await placeOrder(world().deps(), { decision: open().decision })), ["theme"]);
});

Deno.test("positions, themes, the cash floor and the day's orders, from the agent's own resting orders", async () => {
  const w = world();
  for (let i = 1; i <= 6; i++) w.add(cond(i), `${i}11`, `${i}12`);
  // Six markets at $4.40 each, three themes of two: $26.40 resting; free cash $73.60.
  for (let i = 1; i <= 6; i++) assertEquals((await placeOrder(w.deps(), { ...open({ market_id: cond(i), token_id: `${i}11` }), theme: `t${Math.ceil(i / 2)}` })).status, 200);
  const seventh = await placeOrder(w.deps(), { ...open(), theme: "t9" });
  assertEquals(rules(seventh), ["positions"]);
  // The theme cap: t1 holds 8.80; another 4.40 there, in one of its own markets, is 13.20, under 25.
  assertEquals((await placeOrder(w.deps(), { ...open({ market_id: cond(1), token_id: "111" }), theme: "t1" })).status, 200);
  // A market keeps its first theme.
  assertEquals(rules(await placeOrder(w.deps(), { ...open({ market_id: cond(2), token_id: "211" }), theme: "t2" })), ["theme"]);
  // The cash floor and the theme cap, by hand on a ledger: free 100 − 26.40 − 4.40 = 69.20; a 9.90 buy leaves 59.30.
  const c = await context(w.deps(), { readGeo: false, sync: false });
  assertEquals([c.ledger.freeCashUsd, c.ledger.costByTheme.t1], [69.2, 13.2]);
  const L = { ...c.ledger, freeCashUsd: 35, costByTheme: { ...c.ledger.costByTheme, t2: 20 } };
  const book = { tick: "0.01" as const, minSize: 5, negRisk: false, bestBid: 0.45, bestAsk: 0.47, mid: 0.46, spread: 0.02, bidDepthUsd: 1000, askDepthUsd: 1000, twoSided: true };
  const market = marketOf({ conditionId: cond(3), clobTokenIds: '["311","312"]', acceptingOrders: true, endDate: iso(T0 + 5 * DAY) });
  // 12 at 0.44 = 5.28 in cond(3), theme t2: its market 9.68 (under 10), its theme 25.28 (over 25), cash after 29.72 (under 30).
  const d = { ...(open({ market_id: cond(3), token_id: "311", size: 12 }).decision as Record<string, unknown>) } as never;
  const r = orderRefusals({ decision: d, theme: "t2", ledger: L, market, book, nowMs: T0, dayPnlUsd: 0, dailyLossUsd: 10, totalStopUsd: 30, ordersToday: 0, maxOrdersDay: 50 });
  assertEquals(r.refusals.map((x) => x.rule).sort(), ["cash_floor", "theme_cap"]);
  const day = orderRefusals({ decision: d, theme: "t2", ledger: c.ledger, market, book, nowMs: T0, dayPnlUsd: 0, dailyLossUsd: 10, totalStopUsd: 30, ordersToday: 50, maxOrdersDay: 50 });
  assert(day.refusals.some((x) => x.rule === "orders_day"));
});

Deno.test("the stops, from the agent's own fills and marks: −$10 a day and −$30 in all refuse a BUY and never a close", async () => {
  const w = world({ armed: true });
  // Its own book: bought 20 of 101 at 0.44 yesterday (8.80); the mid is now 0.04: −8.00.
  const hash = "0x" + "ab".repeat(32);
  w.db.tables.grokpm_orders.push({ id: 1, created_at: iso(T0 - DAY), mode: "live", decision_id: "x", cond: C1, token: "101", outcome: "Yes", side: "BUY", price: 0.44, size: 20, post_only: true, expiration: 0, neg_risk: false, hash, theme: "t", category: "B", state: "filled", size_matched: 20 });
  w.db.tables.grokpm_fills.push({ trade_id: "t1", hash, cond: C1, token: "101", side: "BUY", price: 0.44, size: 20, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - DAY), tx_hash: "0x01" });
  w.fake.markets[0].bid = 0.03; w.fake.markets[0].ask = 0.05;
  w.db.tables.grokpm_exec_state[0].state = { dayOpen: { day: iso(T0).slice(0, 10), equityUsd: 110 } };
  const c = await context(w.deps(), { readGeo: true, sync: false });
  // Equity 100 − 8.80 + 20 × 0.04 = 92.00: the day −18 (from 110), the total −8.
  assertEquals([c.ledger.equityUsd, c.dayPnlUsd, c.ledger.totalUsd], [92, -18, -8]);
  const buy = await placeOrder(w.deps(), open({ market_id: C2, token_id: "201" }));
  assert(rules(buy).includes("day_stop"), JSON.stringify(buy.body));
  assert(!rules(buy).includes("total_stop"));
  // The total stop on a ledger: −30.
  const book = bookOf({ bids: [{ price: "0.45", size: "2000" }], asks: [{ price: "0.47", size: "2000" }], tick_size: "0.01", min_order_size: "5" });
  const market = marketOf({ conditionId: C2, clobTokenIds: '["201","202"]', acceptingOrders: true, endDate: iso(T0 + 5 * DAY) });
  const r = orderRefusals({ decision: open({ market_id: C2, token_id: "201" }).decision as never, theme: "t", ledger: { ...c.ledger, totalUsd: -30 }, market, book, nowMs: T0, dayPnlUsd: 0, dailyLossUsd: 10, totalStopUsd: 30, ordersToday: 0, maxOrdersDay: 50 });
  assertEquals(r.refusals.map((x) => x.rule), ["total_stop"]);
  // A close is never stopped: the agent may sell what it holds.
  w.fake.tokens.set("101", 20);
  const sell = await placeOrder(w.deps(), close({ price: 0.06, size: 20, category: "B" }));
  assertEquals(sell.status, 200, JSON.stringify(sell.body));
});

Deno.test("a SELL may cross the book only as a close of category C; it then goes not post-only", async () => {
  const w = world({ armed: true });
  const hash = "0x" + "cd".repeat(32);
  w.db.tables.grokpm_orders.push({ id: 1, created_at: iso(T0 - DAY), mode: "live", decision_id: "y", cond: C1, token: "101", outcome: "Yes", side: "BUY", price: 0.44, size: 20, post_only: true, expiration: 0, neg_risk: false, hash, theme: "t", category: "B", state: "filled", size_matched: 20 });
  w.db.tables.grokpm_fills.push({ trade_id: "t1", hash, cond: C1, token: "101", side: "BUY", price: 0.44, size: 20, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - DAY), tx_hash: "0x01" });
  w.fake.tokens.set("101", 20);
  const b = await placeOrder(w.deps(), close({ price: 0.45, size: 10, category: "B" }));
  assertEquals(rules(b), ["post_only"]);
  const c = await placeOrder(w.deps(), close({ price: 0.45, size: 10, category: "C" }));
  assertEquals(c.status, 200, JSON.stringify(c.body));
  assertEquals(w.db.tables.grokpm_orders.at(-1)!.post_only, false);
  // The venue took it at the bid.
  assertEquals(w.fake.orders.get(w.db.tables.grokpm_orders.at(-1)!.hash as string)?.status, "MATCHED");
});

Deno.test("the live gates: region, geoblock IE, the attestation (opens only), one armed path, the key, the global pause", async () => {
  const g = { region: "eu-west-1", mode: "live" as const, armed: true, keyProblem: null, attestation: true, geo: { ok: true, country: "IE", blocked: true }, globalPause: false, otherArmed: null, closedOnly: false };
  assertEquals(liveGateRefusals(g, "BUY"), []);
  assertEquals(liveGateRefusals({ ...g, region: "us-east-1" }, "SELL").map((r) => r.rule), ["region"]);
  assertEquals(liveGateRefusals({ ...g, geo: { ok: true, country: "GB", blocked: true } }, "SELL").map((r) => r.rule), ["geoblock"]);
  assertEquals(liveGateRefusals({ ...g, attestation: false }, "BUY").map((r) => r.rule), ["attestation"]);
  assertEquals(liveGateRefusals({ ...g, attestation: false }, "SELL"), []);
  assertEquals(liveGateRefusals({ ...g, otherArmed: "pm_lp_config" }, "SELL").map((r) => r.rule), ["one_armed"]);
  assertEquals(liveGateRefusals({ ...g, keyProblem: "no key" }, "BUY").map((r) => r.rule), ["key"]);
  assertEquals(liveGateRefusals({ ...g, globalPause: true }, "SELL").map((r) => r.rule), ["global_pause"]);
  assertEquals(liveGateRefusals({ ...g, closedOnly: true }, "BUY").map((r) => r.rule), ["closed_only"]);
  // Dry-run sends nothing, so only the region and the pause hold it back.
  assertEquals(liveGateRefusals({ ...g, mode: "dry_run", keyProblem: "x", attestation: false, geo: { ok: false, country: null, blocked: null } }, "BUY"), []);
  // In the world: from Great Britain, or with live-prep armed, an armed BUY is refused and nothing is sent.
  const gb = world({ armed: true });
  gb.fake.geo = { blocked: true, country: "GB", region: "ENG", ip: "203.0.113.9" };
  assert(rules(await placeOrder(gb.deps(), open())).includes("geoblock"));
  const two = world({ armed: true, otherArmed: true });
  assert(rules(await placeOrder(two.deps(), open())).includes("one_armed"));
  const nokey = world({ armed: true, key: false });
  assert(rules(await placeOrder(nokey.deps(), open())).includes("key"));
  const us = world({ armed: true, region: "us-east-1" });
  assert(rules(await placeOrder(us.deps(), open())).includes("region"));
  for (const x of [gb, two, nokey, us]) assertEquals(posts(x.fake), 0);
});

Deno.test("cancel and cancel_all touch the agent's own orders only, each by its id, never the venue's cancel-all", async () => {
  const w = world({ armed: true });
  assertEquals((await placeOrder(w.deps(), open())).status, 200);
  assertEquals((await placeOrder(w.deps(), open({ market_id: C2, token_id: "201" }))).status, 200);
  // Another order of the shared account, not the agent's: it must stay.
  w.fake.orders.set("0x" + "ee".repeat(32), { hash: "0x" + "ee".repeat(32), token: "901", side: "SELL", price: 0.5, size: 4, matched: 0, status: "LIVE", expiration: Math.floor(T0 / 1000) + 3600, orderType: "GTD", trades: [], cond: C_DUST, at: T0 });
  w.fake.cancelLagReads = 0;
  const r = await cancelOrders(w.deps(), {}, true);
  assertEquals(r.status, 200);
  assertEquals((r.body.cancelled as unknown[]).length, 2);
  assertEquals(w.fake.calls.filter((c) => c === "DELETE clob.polymarket.com/cancel-all").length, 0);
  assertEquals(w.fake.calls.filter((c) => c === "DELETE clob.polymarket.com/order").length, 2);
  assertEquals(w.fake.orders.get("0x" + "ee".repeat(32))?.status, "LIVE");
  assert(w.db.tables.grokpm_orders.every((o) => o.state === "cancelled"));
  assertEquals((await cancelOrders(w.deps(), { order_id: "0x" + "ee".repeat(32) }, false)).status, 404);
});

Deno.test("the expiry is clamped to 3–65 minutes (35 by default), plus the venue's minute", () => {
  const nowS = Math.floor(T0 / 1000);
  assertEquals(expiryOf(null, T0), { expiration: nowS + 60 + 2100, lifetimeS: 2100, clamped: false });
  assertEquals(expiryOf(iso(T0 + 60e3), T0).lifetimeS, 180);
  assertEquals(expiryOf(iso(T0 + 5 * 3600e3), T0).lifetimeS, 3900);
  assertEquals(expiryOf(iso(T0 + 20 * 60e3), T0), { expiration: nowS + 60 + 1200, lifetimeS: 1200, clamped: false });
});

Deno.test("the market view: Gamma's record, both books and what blocks an open", async () => {
  const w = world();
  w.gammaExtra.set(C1, { endDate: iso(T0 + 40 * DAY), tags: [{ slug: "politics" }] });
  const r = await marketView(w.deps(), { token: "102" });
  assertEquals(r.status, 200);
  const b = r.body as Record<string, unknown>;
  assertEquals([b.market_id, b.open_blocked_by, (b.outcomes as unknown[]).length, b.tags], [C1, ["resolves more than 30 days out"], 2, ["politics"]]);
  assertEquals((await marketView(w.deps(), { cond: "0x" + "99".repeat(32) })).status, 404);
});

Deno.test("the ledger: dust under a cent is no position, a resolved holding is at its payout and off the caps", () => {
  const L = ledgerOf({
    fundedUsd: 100, orders: [], nowMs: T0, mids: { "101": 0.5 }, payouts: { "201": 1 },
    fills: [
      { trade_id: "a", hash: "h", cond: C1, token: "101", side: "BUY", price: 0.4, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - 9e5), tx_hash: null },
      { trade_id: "b", hash: "h2", cond: C2, token: "201", side: "BUY", price: 0.7, size: 10, fee_usd: 0.1, taker: true, status: "CONFIRMED", match_time: iso(T0 - 8e5), tx_hash: null },
      { trade_id: "c", hash: "h3", cond: C1, token: "101", side: "SELL", price: 0.5, size: 9.995, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - 7e5), tx_hash: null },
      { trade_id: "d", hash: "h4", cond: C1, token: "101", side: "BUY", price: 0.4, size: 5, fee_usd: 0, taker: false, status: "FAILED", match_time: iso(T0 - 6e5), tx_hash: null },
    ],
  });
  // Cash 100 − 4 − 7 + 4.9975 − 0.1 = 93.8975; 201 at its payout: 10; 101's 0.005 left is dust (worth 0.0025).
  assertEquals([L.cashUsd, L.equityUsd, Object.keys(L.held), L.openConds], [93.8975, 103.9, ["201"], []]);
  assertEquals(L.totalUsd, 3.9);
});

Deno.test("the endpoint: every action but the ping and the journal refuses outside eu-west-1; sync takes the scheduler's bearer and beats first", async () => {
  const secret = "s".repeat(40);
  const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  const w = world();
  const req = (path: string, init: RequestInit = {}) => new Request(`https://x.test/functions/v1/grokpm${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, ...(init.headers ?? {}) } });
  const base = { secret, db: ingest, now: () => T0, exec: () => Promise.resolve(w.deps()), cronSecret: "c".repeat(40) };
  const us = await handle(req("?action=account"), { ...base, region: "us-east-1" });
  assertEquals(us.status, 403);
  const ping = await handle(req(""), { ...base, region: "us-east-1" });
  assertEquals((await ping.json()).region, "us-east-1");
  const acct = await handle(req("?action=account&forceFunctionRegion=eu-west-1"), { ...base, region: "eu-west-1" });
  assertEquals(acct.status, 200);
  const a = await acct.json();
  assertEquals([a.mode, a.budget.equity_usd, a.budget.spendable_usd, JSON.stringify(a).toLowerCase().includes(PM_TEST_FUNDER.toLowerCase())], ["dry_run", 100, 70, false]);
  assertEquals((await handle(req("?action=order", { method: "GET" }), { ...base, region: "eu-west-1" })).status, 405);
  assertEquals((await handle(req("?action=nope"), { ...base, region: "eu-west-1" })).status, 404);
  const beats: string[] = [];
  const sync = (auth: string) => handle(new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${auth}` } }),
    { ...base, region: "eu-west-1", beat: (k) => { beats.push(k); return Promise.resolve(); } });
  assertEquals((await sync(secret)).status, 401);
  assertEquals((await sync("c".repeat(40))).status, 200);
  assertEquals(beats, ["grokpm?action=sync"]);
});

Deno.test("the appendix's order and close examples pass the contract (only the market, unknown here, is refused)", async () => {
  for (const k of ["order", "close"] as const) {
    const w = world();
    w.at(Date.parse(examples[k].decision.ts) + 60e3);
    const r = await placeOrder(w.deps(), examples[k]);
    assertEquals([k, r.status, r.body.error], [k, 422, "refused"], JSON.stringify(r.body));
    assert(rules(r).includes("market"), JSON.stringify(r.body));
  }
});

Deno.test("one account, one armed path (0125's trigger, as the double holds it): GROKPM and live-prep never armed together", async () => {
  const w = world({ otherArmed: true });
  const refused = (p: Promise<unknown>) => p.then(() => "", (e) => String((e as Error).message));
  const arm = { dry_run: false, armed_at: iso(T0), started_at: iso(T0) };
  assert((await refused(w.db.update("grokpm_config", "id=eq.1", arm))).includes("grokpm_config cannot be armed while pm_lp_config is armed"));
  await w.db.update("pm_lp_config", "id=eq.1", { live_confirmed_at: null });
  assertEquals(await refused(w.db.update("grokpm_config", "id=eq.1", arm)), "");
  assert((await refused(w.db.update("pm_lp_config", "id=eq.1", { live_confirmed_at: iso(T0) }))).includes("pm_lp_config cannot be armed while grokpm_config is armed"));
});
