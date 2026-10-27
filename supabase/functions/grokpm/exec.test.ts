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
  accountView, bookOf, cancelOrders, context, cutThinCapOrders, eventCostUsd, eventKeyOf, type ExecDeps, expiryOf, FAR_FIELDS, farMarketsOf, farMarketsView,
  type GrokOrderRow, type GrokVenue, ledgerOf, liveGateRefusals, marketOf, marketView, orderRefusals, placeOrder, syncOrders, thinCapRefusals,
} from "./exec.ts";
import { farQuery, handle, type IngestDb } from "./index.ts";
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
  const again = await placeOrder(w.deps(), open({ market_id: C2, token_id: "201" }));
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
    // Thin for its depth alone: category A keeps the thin rule; category B meets D15's terms instead (here, no event_at).
    ["thin", { category: "A" }, (w) => { w.fake.markets[0].depth = [[0, 50], [1, 100]]; }],
    ["thin_cap", {}, (w) => { w.fake.markets[0].depth = [[0, 50], [1, 100]]; }],
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
  assertEquals((await placeOrder(w.deps(), open({ price: 0.9, p: 0.99, category: "A" }))).status, 200);
  // The decision itself: an open without p, m, invalidation, or sources for A/B, is invalid.
  const v = await placeOrder(world().deps(), { decision: { ...open().decision, p: undefined, sources: [] }, theme: "t" });
  assertEquals(v.status, 422);
  assertEquals((v.body.errors as string[]).sort(), ["decision.p: required", "decision.sources: at least one source is required for category A or B"]);
  // No theme, no open.
  assertEquals(rules(await placeOrder(world().deps(), { decision: open().decision })), ["theme"]);
});

Deno.test("Deviation D3: A's 8 and B's 12 points against the dearer of price and mid, a quarter Kelly, and C only on a holding", async () => {
  // The book: bid 0.45, ask 0.47, mid 0.46. B at 0.44 is measured from the mid: p 0.58 is 12 points, 0.57 is 11.
  assertEquals((await placeOrder(world().deps(), open({ p: 0.58 }))).status, 200);
  const b11 = await placeOrder(world().deps(), open({ p: 0.57 }));
  assertEquals([b11.status, rules(b11)], [422, ["edge"]]);
  // A needs 8 points: p 0.54 passes, 0.53 does not.
  assertEquals((await placeOrder(world().deps(), open({ p: 0.54, category: "A" }))).status, 200);
  assertEquals(rules(await placeOrder(world().deps(), open({ p: 0.53, size: 5, category: "A" }))), ["edge"]);
  // Grok's rehearsal: B at p 0.85 with the mid at 0.865 is no edge at all.
  const g = world();
  g.fake.markets[0].bid = 0.85; g.fake.markets[0].ask = 0.88;
  assertEquals(rules(await placeOrder(g.deps(), open({ price: 0.85, size: 5, p: 0.85 }))), ["edge"]);
  // A quarter Kelly of $100 at p 0.6 and 0.44: 0.25 × 0.16 / 0.56 × 100 = $7.14, so 16 shares ($7.04) pass and 17 ($7.48) do not.
  assertEquals((await placeOrder(world().deps(), open({ size: 16 }))).status, 200);
  assertEquals(rules(await placeOrder(world().deps(), open({ size: 17 }))), ["kelly"]);
  // The venue's smallest order always fits when the edge does: A at p 0.54 and 0.44 is $4.46, and 5 shares cost $2.20.
  assertEquals((await placeOrder(world().deps(), open({ p: 0.54, size: 5, category: "A" }))).status, 200);
  // C adds to a holding: with nothing held it is refused; it needs p over the price, not a bar.
  assertEquals(rules(await placeOrder(world().deps(), open({ category: "C", p: 0.5, size: 5 }))), ["adjustment"]);
  const w = world({ armed: true });
  const hash = "0x" + "ef".repeat(32);
  w.db.tables.grokpm_orders.push({ id: 1, created_at: iso(T0 - DAY), mode: "live", decision_id: "z", cond: C1, token: "101", outcome: "Yes", side: "BUY", price: 0.44, size: 10, post_only: true, expiration: 0, neg_risk: false, hash, theme: "theme-1", category: "B", state: "filled", size_matched: 10 });
  w.db.tables.grokpm_fills.push({ trade_id: "t1", hash, cond: C1, token: "101", side: "BUY", price: 0.44, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - DAY), tx_hash: "0x01" });
  assertEquals((await placeOrder(w.deps(), open({ category: "C", p: 0.6, size: 5 }))).status, 200);
  assertEquals(rules(await placeOrder(w.deps(), open({ category: "C", p: 0.44, size: 5 }))), ["edge"]);
});

Deno.test("Kelly is cumulative in one market: held cost and unfilled resting buys count before a new open", async () => {
  // No existing exposure: at p 0.6, price 0.44 and $100 equity the quarter-Kelly cap is $7.14.
  assertEquals((await placeOrder(world().deps(), open({ size: 16 }))).status, 200);
  assertEquals(rules(await placeOrder(world().deps(), open({ size: 17 }))), ["kelly"]);

  // A filled position: 10 held at 0.44 cost $4.40. Seven more would make $7.48 and fail; six make $7.04 and pass.
  const heldWorld = () => {
    const w = world({ armed: true });
    const hash = "0x" + "aa".repeat(32);
    w.db.tables.grokpm_orders.push({ id: 1, created_at: iso(T0 - DAY), mode: "live", decision_id: "held", cond: C1, token: "101", outcome: "Yes", side: "BUY", price: 0.44, size: 10, post_only: true, expiration: 0, neg_risk: false, hash, theme: "theme-1", category: "B", state: "filled", size_matched: 10 });
    w.db.tables.grokpm_fills.push({ trade_id: "held-fill", hash, cond: C1, token: "101", side: "BUY", price: 0.44, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - DAY), tx_hash: "0x01" });
    return w;
  };
  const held = heldWorld();
  assertEquals(rules(await placeOrder(held.deps(), open({ size: 7 }))), ["kelly"]);
  assertEquals((await placeOrder(held.deps(), open({ size: 6 }))).status, 200);

  // An unfilled resting buy is exposure too: the first order's $4.40 leaves the same room as a filled position.
  const resting = world();
  assertEquals((await placeOrder(resting.deps(), open({ size: 10 }))).status, 200);
  assertEquals(rules(await placeOrder(resting.deps(), open({ size: 7 }))), ["kelly"]);
  assertEquals((await placeOrder(resting.deps(), open({ size: 6 }))).status, 200);

  // Already exactly at the smaller cap: at price 0.50 and p 0.65, quarter Kelly is $7.50 (under the $10 market cap).
  const capped = world();
  capped.fake.markets[0].bid = 0.49;
  capped.fake.markets[0].ask = 0.51;
  assertEquals((await placeOrder(capped.deps(), open({ price: 0.5, p: 0.65, size: 15 }))).status, 200);
  assertEquals(rules(await placeOrder(capped.deps(), open({ price: 0.5, p: 0.65, size: 5 }))), ["kelly"]);
});

Deno.test("positions, themes, the cash floor and the day's orders, from the agent's own resting orders", async () => {
  const w = world();
  for (let i = 1; i <= 6; i++) w.add(cond(i), `${i}11`, `${i}12`);
  // Six markets at $4.40 each, three themes of two: $26.40 resting; free cash $73.60.
  for (let i = 1; i <= 6; i++) assertEquals((await placeOrder(w.deps(), { ...open({ market_id: cond(i), token_id: `${i}11` }), theme: `t${Math.ceil(i / 2)}` })).status, 200);
  const seventh = await placeOrder(w.deps(), { ...open(), theme: "t9" });
  assertEquals(rules(seventh), ["positions"]);
  // The theme cap: t1 holds 8.80; another 2.20 there, in one of its own markets, is 11.00, under 25.
  assertEquals((await placeOrder(w.deps(), { ...open({ market_id: cond(1), token_id: "111", size: 5 }), theme: "t1" })).status, 200);
  // A market keeps its first theme.
  assertEquals(rules(await placeOrder(w.deps(), { ...open({ market_id: cond(2), token_id: "211", size: 5 }), theme: "t2" })), ["theme"]);
  // The cash floor and the theme cap, by hand on a ledger: free 100 − 26.40 − 2.20 = 71.40.
  const c = await context(w.deps(), { readGeo: false, sync: false });
  assertEquals([c.ledger.freeCashUsd, c.ledger.costByTheme.t1], [71.4, 11]);
  const L = { ...c.ledger, freeCashUsd: 32, costByTheme: { ...c.ledger.costByTheme, t2: 24 } };
  const book = { tick: "0.01" as const, minSize: 5, negRisk: false, bestBid: 0.45, bestAsk: 0.47, mid: 0.46, spread: 0.02, bidDepthUsd: 1000, askDepthUsd: 1000, twoSided: true };
  const market = marketOf({ conditionId: cond(3), clobTokenIds: '["311","312"]', acceptingOrders: true, endDate: iso(T0 + 5 * DAY) });
  // 6 at 0.44 = 2.64 in cond(3), theme t2: its market 7.04 (under Kelly and 10), its theme 26.64 (over 25), cash after 29.36 (under 30).
  const d = { ...(open({ market_id: cond(3), token_id: "311", size: 6 }).decision as Record<string, unknown>) } as never;
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

Deno.test("the ledger: dust under a cent is no position, a resolved holding settles into cash at its payout and is off the caps (D4)", () => {
  const L = ledgerOf({
    fundedUsd: 100, orders: [], nowMs: T0, mids: { "101": 0.5 }, payouts: { "201": 1 },
    fills: [
      { trade_id: "a", hash: "h", cond: C1, token: "101", side: "BUY", price: 0.4, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - 9e5), tx_hash: null },
      { trade_id: "b", hash: "h2", cond: C2, token: "201", side: "BUY", price: 0.7, size: 10, fee_usd: 0.1, taker: true, status: "CONFIRMED", match_time: iso(T0 - 8e5), tx_hash: null },
      { trade_id: "c", hash: "h3", cond: C1, token: "101", side: "SELL", price: 0.5, size: 9.995, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: iso(T0 - 7e5), tx_hash: null },
      { trade_id: "d", hash: "h4", cond: C1, token: "101", side: "BUY", price: 0.4, size: 5, fee_usd: 0, taker: false, status: "FAILED", match_time: iso(T0 - 6e5), tx_hash: null },
    ],
  });
  // Cash 100 − 4 − 7 + 4.9975 − 0.1 = 93.8975, plus 201 settled at its payout: 10 → 103.8975; 101's 0.005 left is dust
  // (worth 0.0025). Before D4 the 10 sat in the held value and never in the cash (93.8975, held ["201"]).
  assertEquals([L.cashUsd, L.settledUsd, L.equityUsd, Object.keys(L.held), L.openConds], [103.8975, 10, 103.9, [], []]);
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

// ── the 2026-10-17 audit: each case failed on the code before it (the counterfactual is in the commit message) ──────────

/** A live BUY the agent filled before `T0` (seeded as the order path would have written it), with its confirmed fill. */
function seedFill(w: ReturnType<typeof world>, o: { hash: string; cond: string; token: string; price: number; size: number; theme?: string }) {
  const at = iso(T0 - 30 * 60e3);
  w.db.tables.grokpm_orders.push({
    id: 900 + w.db.tables.grokpm_orders.length, created_at: at, updated_at: at, mode: "live", decision_id: `seed-${o.hash.slice(2, 8)}`, cond: o.cond, token: o.token,
    outcome: "Yes", side: "BUY", price: o.price, size: o.size, post_only: true, expiration: Math.floor(T0 / 1000) - 600, neg_risk: false, hash: o.hash, theme: o.theme ?? "seeded",
    category: "B", state: "filled", size_matched: o.size, request: {}, response: {}, cancel_requested_at: null, cancelled_at: null, filled_at: at,
  });
  w.db.tables.grokpm_fills.push({
    trade_id: `seed-${o.hash.slice(2, 8)}`, hash: o.hash, cond: o.cond, token: o.token, side: "BUY", price: o.price, size: o.size, fee_usd: 0, taker: false,
    status: "CONFIRMED", match_time: at, tx_hash: "0x" + "fe".repeat(32), detail: {}, updated_at: at,
  });
  w.fake.tokens.set(o.token, (w.fake.tokens.get(o.token) ?? 0) + o.size);
}

Deno.test("audit: a resolved win is cash again (D4), so the cash floor does not shrink with every win", async () => {
  const w = world({ armed: true });
  // 75 YES of C2 bought at 0.88 ($66), and C2 resolved YES: the agent's cash is 100 − 66 + 75 = 109.
  seedFill(w, { hash: "0x" + "a1".repeat(32), cond: C2, token: "201", price: 0.88, size: 75 });
  w.db.tables.grokpm_resolutions.push({ cond: C2, tokens: ["201", "202"], payouts: [1, 0], closed_at: iso(T0 - 600e3), read_at: iso(T0 - 300e3) });
  const c = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([c.ledger.cashUsd, c.ledger.settledUsd, c.ledger.equityUsd, c.ledger.openConds], [109, 75, 109, []]);
  // Before D4 the cash was 34 and this $4.40 open was refused by the cash floor (29.60 < 30).
  const r = await placeOrder(w.deps(), open({ price: 0.44, size: 10 }));
  assertEquals(r.status, 200, JSON.stringify(r.body));
});

Deno.test("audit: the day and total stops latch (D4): a mark that recovers does not open them again; closes still go", async () => {
  const w = world({ armed: true });
  seedFill(w, { hash: "0x" + "a2".repeat(32), cond: C1, token: "101", price: 0.45, size: 100 });
  // The mid falls to 0.15: equity 100 − 45 + 15 = 70, −30 in all and today.
  w.fake.markets[0].bid = 0.14; w.fake.markets[0].ask = 0.16;
  const down = await context(w.deps(), { readGeo: true, sync: true });
  assertEquals([down.ledger.totalUsd, down.dayStopAt, down.totalStopAt], [-30, iso(T0), iso(T0)]);
  // It recovers to 0.46 a minute later: computed afresh, both stops would be open again.
  w.fake.markets[0].bid = 0.45; w.fake.markets[0].ask = 0.47;
  w.at(T0 + 60e3);
  const r = await placeOrder(w.deps(), open({ market_id: C2, token_id: "201" }));
  assertEquals([r.status, rules(r).filter((x) => x.endsWith("_stop"))], [422, ["total_stop", "day_stop"]]);
  const c = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([c.ledger.totalUsd > -30, accountViewOf(c).budget.can_open, accountViewOf(c).budget.total_stop_hit_at], [true, false, iso(T0)]);
  assertEquals((await placeOrder(w.deps(), close({ price: 0.48, size: 10, category: "B" }))).status, 200);
  // The next UTC day the day stop is gone; the total stop holds to the end.
  w.at(T0 + DAY);
  const next = await placeOrder(w.deps(), open({ market_id: C2, token_id: "201", ts: iso(T0 + DAY - 60e3) }));
  assertEquals(rules(next).filter((x) => x.endsWith("_stop")), ["total_stop"]);
  // The sync says so once, to the errors box.
  const reports: string[] = [];
  const syncReq = () => new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${"c".repeat(40)}` } });
  const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  const deps = { secret: "s".repeat(40), db: ingest, now: () => w.now, exec: () => Promise.resolve(w.deps()), cronSecret: "c".repeat(40), region: "eu-west-1", beat: () => Promise.resolve(),
    report: (kind: string) => { reports.push(kind); return Promise.resolve(); } };
  await handle(syncReq(), deps as never);
  await handle(syncReq(), deps as never);
  assertEquals(reports.filter((k) => k === "grokpm.total_stop").length, 1);
});
const accountViewOf = (c: Awaited<ReturnType<typeof context>>) => accountView(c, T0) as unknown as { budget: Record<string, unknown> };

Deno.test("audit: a fill between the last sync and a cancel is booked by the cancel's read-back", async () => {
  const w = world({ armed: true });
  assertEquals((await placeOrder(w.deps(), open({ price: 0.44, size: 10 }))).status, 200);
  const hash = w.db.tables.grokpm_orders[0].hash as string;
  w.fake.fill(hash, 4);
  w.fake.cancelLagReads = 0;
  const r = await cancelOrders(w.deps(), { order_id: hash }, false);
  assertEquals(r.status, 200);
  assertEquals([w.db.tables.grokpm_orders[0].state, Number(w.db.tables.grokpm_orders[0].size_matched)], ["cancelled", 4]);
  assertEquals(w.db.tables.grokpm_fills.map((f) => [f.hash, Number(f.size)]), [[hash, 4]]);
  const c = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([c.ledger.cashUsd, c.ledger.held["101"]?.held], [98.24, 4]);
});

Deno.test("audit: a trade booked at MATCHED (no transaction hash) is read again until CONFIRMED, so the keyless record can find it", async () => {
  const w = world({ armed: true });
  assertEquals((await placeOrder(w.deps(), open({ price: 0.44, size: 10 }))).status, 200);
  const hash = w.db.tables.grokpm_orders[0].hash as string;
  const trade = w.fake.fill(hash, 10);
  w.at(T0 + 60e3);
  await syncOrders(w.deps(), []);
  assertEquals([w.db.tables.grokpm_orders[0].state, w.db.tables.grokpm_fills[0].status, w.db.tables.grokpm_fills[0].tx_hash], ["filled", "MATCHED", null]);
  w.fake.settle(trade, "CONFIRMED");
  w.at(T0 + 120e3);
  await syncOrders(w.deps(), []);
  assertEquals([w.db.tables.grokpm_fills[0].status, w.db.tables.grokpm_fills[0].tx_hash], ["CONFIRMED", "0x" + "ab".repeat(32)]);
});

Deno.test("audit: the kill switches reach what rests: disarmed or under the global pause, the sync cancels the agent's live orders", async () => {
  for (const how of ["disarm", "pause"] as const) {
    const w = world({ armed: true });
    assertEquals((await placeOrder(w.deps(), open())).status, 200);
    const hash = w.db.tables.grokpm_orders[0].hash as string;
    if (how === "disarm") Object.assign(w.db.tables.grokpm_config[0], { dry_run: true, armed_at: null });
    else w.db.tables.agent_risk[0].global_pause = true;
    w.fake.cancelLagReads = 0;
    w.at(T0 + 60e3);
    const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
    const res = await handle(new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${"c".repeat(40)}` } }),
      { secret: "s".repeat(40), db: ingest, now: () => w.now, exec: () => Promise.resolve(w.deps()), cronSecret: "c".repeat(40), region: "eu-west-1", beat: () => Promise.resolve(), report: () => Promise.resolve() });
    assertEquals([res.status, (await res.json()).cancelled], [200, 1], how);
    assertEquals([w.fake.orders.get(hash)?.status, w.db.tables.grokpm_orders[0].state], ["CANCELED", "cancelled"], how);
  }
  // A dry-run's own orders are not touched by it.
  const d = world();
  assertEquals((await placeOrder(d.deps(), open())).status, 200);
  const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  await handle(new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${"c".repeat(40)}` } }),
    { secret: "s".repeat(40), db: ingest, now: () => d.now, exec: () => Promise.resolve(d.deps()), cronSecret: "c".repeat(40), region: "eu-west-1", beat: () => Promise.resolve(), report: () => Promise.resolve() });
  assertEquals(d.db.tables.grokpm_orders[0].state, "live");
});

Deno.test("audit: an order whose decision id is already a journal row is refused with its reason, not a 500", async () => {
  const w = world();
  w.db.tables.grokpm_decisions.push({ id: "j-1", received_at: iso(T0 - 120e3), ts: iso(T0 - 120e3), action: "no_action", reason: "nothing today", sources: [], raw: {} });
  const r = await placeOrder(w.deps(), open({ id: "j-1" }));
  assertEquals([r.status, r.body.error], [422, "invalid"]);
  assertEquals(w.db.tables.grokpm_orders.length, 0);
});

Deno.test("audit: more than 1,000 orders are read whole, not refused (50 a day reaches 1,000 inside the 28 days)", async () => {
  const w = world();
  for (let i = 0; i < 1001; i++) {
    w.db.tables.grokpm_orders.push({
      id: 10_000 + i, created_at: iso(T0 - 5 * DAY), updated_at: iso(T0 - 5 * DAY), mode: "dry_run", decision_id: `old-${i}`, cond: C1, token: "101", outcome: "Yes", side: "BUY",
      price: 0.44, size: 5, post_only: true, expiration: Math.floor((T0 - 5 * DAY) / 1000), neg_risk: false, hash: "0x" + i.toString(16).padStart(64, "0"), theme: "t", category: "B",
      state: "expired", size_matched: 0, request: {}, response: {}, cancel_requested_at: null, cancelled_at: null, filled_at: null,
    });
  }
  const c = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([c.orders.length, c.ledger.cashUsd], [1001, 100]);
});

// Deviation D14 (2026-10-24, the optimisation review's P4): the book settles a holding only at a final payout.
Deno.test("D14: a resolution at a price short of the outcome settles nothing; at 1 the holding is cash", async () => {
  const w = world({ armed: true });
  seedFill(w, { hash: "0x" + "a3".repeat(32), cond: C2, token: "201", price: 0.88, size: 75 });
  w.db.tables.grokpm_resolutions.push({ cond: C2, tokens: ["201", "202"], payouts: [0.9995, 0.0005], closed_at: iso(T0 - 600e3), read_at: iso(T0 - 300e3) });
  const held = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([held.ledger.settledUsd, held.ledger.openConds], [0, [C2]]);
  w.db.tables.grokpm_resolutions[0].payouts = [1, 0];
  const done = await context(w.deps(), { readGeo: true, sync: false });
  assertEquals([done.ledger.settledUsd, done.ledger.cashUsd, done.ledger.openConds], [75, 109, []]);
});

// Deviation D12 (2026-10-24, the optimisation review's P2): the market read carries each outcome's last public trade.
Deno.test("D12: the market read gives each outcome's last trade (the other side's at 1 - q), and null with 'unread' when the tape fails", async () => {
  const w = world();
  const s = (iso_: string) => Date.parse(iso_) / 1000;
  const venue = w.deps().venue;
  const tapeOk: GrokVenue["tape"] = () => Promise.resolve([
    { asset: "102", side: "BUY", price: 0.03, size: 5, timestamp: s(iso(T0 - 60e3)) },
    { asset: "101", side: "SELL", price: 0.5, size: 9, timestamp: s(iso(T0 - 3600e3)) },
  ]);
  const r = await marketView({ ...w.deps(), venue: { ...venue, tape: tapeOk } }, { cond: C1 });
  const b = r.body as { outcomes: Array<{ token_id: string; last_trade: { price: number; at: string } | null }>; last_trade_read: string };
  assertEquals([b.last_trade_read, b.outcomes.map((o) => [o.token_id, o.last_trade])], ["ok", [["101", { price: 0.97, at: iso(T0 - 60e3) }], ["102", { price: 0.03, at: iso(T0 - 60e3) }]]]);
  const bad = await marketView({ ...w.deps(), venue: { ...venue, tape: () => Promise.reject(new Error("429")) } }, { cond: C1 });
  const bb = bad.body as { outcomes: Array<{ last_trade: unknown }>; last_trade_read: string };
  assertEquals([bad.status, bb.last_trade_read, bb.outcomes.map((o) => o.last_trade)], [200, "unread", [null, null]]);
  // A market that never traded: no last trade, read ok.
  const none = await marketView({ ...w.deps(), venue: { ...venue, tape: () => Promise.resolve([]) } }, { cond: C1 });
  assertEquals((none.body as { outcomes: Array<{ last_trade: unknown }> }).outcomes.map((o) => o.last_trade), [null, null]);
});

// Deviation D11 (2026-10-24, the optimisation review's P1): the far list, for choosing markets by title before any price.
const DAYS = (n: number) => iso(T0 + n * DAY);
const farEvent = (o: Record<string, unknown> = {}, markets: Array<Record<string, unknown>> = []) => ({
  id: "1", title: "Toronto mayor", slug: "toronto-mayor", endDate: DAYS(10), volume: 999999, liquidity: 5000, competitive: 0.9,
  tags: [{ slug: "politics" }, { slug: "rewards-20-4pt5-50" }, { slug: "Canada" }], markets, ...o,
});
const farMarket = (cond: string, o: Record<string, unknown> = {}) => ({
  conditionId: cond, question: `Will ${cond.slice(2, 6)} win?`, slug: `will-${cond.slice(2, 6)}-win`, clobTokenIds: '["1","2"]', outcomes: '["Yes","No"]',
  endDate: DAYS(10), active: true, closed: false, archived: false, acceptingOrders: true, enableOrderBook: true, volumeNum: 25_000, volume: "25000",
  outcomePrices: '["0.41","0.59"]', bestBid: 0.4, bestAsk: 0.42, lastTradePrice: 0.41, spread: 0.02, liquidityNum: 3000, oneDayPriceChange: 0.01,
  description: "This market resolves to Yes if   X wins.\n\nOtherwise No.", ...o,
});

Deno.test("D11: the far list keeps open, low-attention markets ending 3 to 30 days out, and carries no price-like field at all", () => {
  const ok = "0x" + "a1".repeat(32);
  const events = [farEvent({}, [
    farMarket(ok),
    farMarket("0x" + "a2".repeat(32), { endDate: DAYS(2) }),            // too soon
    farMarket("0x" + "a3".repeat(32), { endDate: DAYS(31) }),           // too far
    farMarket("0x" + "a4".repeat(32), { volumeNum: 60_000 }),           // high attention
    farMarket("0x" + "a5".repeat(32), { volumeNum: 4_000 }),            // thin
    farMarket("0x" + "a6".repeat(32), { closed: true }),
    farMarket("0x" + "a7".repeat(32), { acceptingOrders: false }),
  ])];
  const low = farMarketsOf(events, T0, "low");
  assertEquals(low.map((m) => m.market_id), [ok]);
  assertEquals(low[0], {
    market_id: ok, question: "Will a1a1 win?", slug: "will-a1a1-win", event_title: "Toronto mayor", event_slug: "toronto-mayor", end_date: DAYS(10),
    tags: ["politics", "canada"], description: "This market resolves to Yes if X wins. Otherwise No.", sports: false, crypto: false,
  });
  assertEquals(farMarketsOf(events, T0, "all").length, 3);
  // Every row carries exactly FAR_FIELDS, and no key or value anywhere looks like a price, a book, a volume or a trade.
  const priceLike = /price|bid|ask|volume|liquid|spread|mid|trade|competitive|interest|change|outcome/i;
  const walk = (x: unknown, path: string): void => {
    if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { assert(!priceLike.test(k), `${path}.${k}`); walk(v, `${path}.${k}`); }
  };
  for (const m of farMarketsOf(events, T0, "all")) {
    assertEquals(Object.keys(m).sort(), [...FAR_FIELDS].sort());
    walk(m, "market");
    assert(!/0\.4[12]|0\.59|25000|60000/.test(JSON.stringify(m)), JSON.stringify(m));
  }
});

Deno.test("D11: the far list's view and query: one Gamma page, the window it asked for, the next offset, and refusals", async () => {
  const w = world();
  const asked: unknown[] = [];
  const venue = { ...w.deps().venue, farEvents: (q: unknown) => { asked.push(q); return Promise.resolve(Array.from({ length: 100 }, () => farEvent({}, [farMarket("0x" + "b1".repeat(32))]))); } };
  const r = await farMarketsView({ ...w.deps(), venue }, { tag: "politics", offset: 100, attention: "low" });
  const b = r.body as Record<string, unknown>;
  assertEquals([r.status, b.next_offset, b.events_read, (b.markets as unknown[]).length], [200, 200, 100, 100]);
  assertEquals(asked, [{ fromIso: DAYS(3), toIso: DAYS(30), tag: "politics", offset: 100 }]);
  assert(!/price|bid|ask|volume|liquid/i.test(JSON.stringify(b)), "the whole answer is price-free");
  assertEquals((await farMarketsView({ ...w.deps(), venue: { ...w.deps().venue, farEvents: () => Promise.reject(new Error("503")) } }, { tag: null, offset: 0, attention: "low" })).status, 502);
  assertEquals((await farMarketsView(w.deps(), { tag: null, offset: 0, attention: "low" })).status, 503);
  const q = (s: string) => farQuery(new URLSearchParams(s));
  assertEquals(q(""), { tag: null, offset: 0, attention: "low" });
  assertEquals(q("tag=Politics&offset=200&attention=all"), { tag: "politics", offset: 200, attention: "all" });
  for (const bad of ["tag=../x", "offset=50", "offset=-100", "attention=high"]) assert("error" in q(bad), bad);
});

Deno.test("D11: markets_far is an authorised GET in eu-west-1 like every action", async () => {
  const secret = "s".repeat(40);
  const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  const w = world();
  const deps = { ...w.deps(), venue: { ...w.deps().venue, farEvents: () => Promise.resolve([farEvent({}, [farMarket("0x" + "c1".repeat(32))])]) } };
  const base = { secret, db: ingest, now: () => T0, exec: () => Promise.resolve(deps), cronSecret: "c".repeat(40) };
  const req = (path: string, auth = true, method = "GET") => new Request(`https://x.test/functions/v1/grokpm${path}`, { method, headers: auth ? { Authorization: `Bearer ${secret}` } : {} });
  assertEquals((await handle(req("?action=markets_far", false), { ...base, region: "eu-west-1" })).status, 401);
  assertEquals((await handle(req("?action=markets_far"), { ...base, region: "us-east-1" })).status, 403);
  assertEquals((await handle(req("?action=markets_far", true, "POST"), { ...base, region: "eu-west-1" })).status, 405);
  const ok = await handle(req("?action=markets_far&tag=politics"), { ...base, region: "eu-west-1" });
  assertEquals([ok.status, ((await ok.json()).markets as unknown[]).length], [200, 1]);
  assertEquals((await handle(req("?action=markets_far&offset=7"), { ...base, region: "eu-west-1" })).status, 422);
});

// ── Deviation D15 (2026-10-26): the thin rule's capped exception ─────────────────────────────────────────────────────
const C3 = "0x" + "c3".repeat(32), C4 = "0x" + "c4".repeat(32), C5 = "0x" + "c5".repeat(32), C6 = "0x" + "c6".repeat(32);
/** A market thin for its depth alone: two-sided, a 2-point spread, $35.60 of bids within 5 points (0.45 × 40 + 0.44 × 40). */
function thinWorld(o: Opts = {}, endDays = 5) {
  const w = world(o);
  for (const [c, y, n] of [[C3, "301", "302"], [C4, "401", "402"], [C5, "501", "502"], [C6, "601", "602"]] as const) {
    w.add(c, y, n, { endDate: iso(T0 + endDays * DAY) }, { bid: 0.45, ask: 0.47, depth: [[0, 40], [1, 40]] });
  }
  return w;
}
const d15 = (o: Partial<Record<string, unknown>> = {}, body: Record<string, unknown> = { event_at: null }) => {
  const x = open({ market_id: C3, token_id: "301", price: 0.44, size: 10, p: 0.6, m: 0.46, category: "B", ...o });
  return { ...x, theme: `t-${String(o.market_id ?? C3).slice(2, 6)}`, ...body };
};
const refusalsOf = (r: { body: Record<string, unknown> }) => ((r.body.refusals ?? []) as Array<{ rule: string; why: string }>);

Deno.test("D15: a category-B open thin for its depth alone rests under the cap; the order says so and when it must be gone", async () => {
  const w = thinWorld();
  const r = await placeOrder(w.deps(), d15());
  assertEquals(r.status, 200, JSON.stringify(r.body));
  const row = w.db.tables.grokpm_orders.at(-1)!;
  // The cut: 48 hours before the market's end (no release named).
  assertEquals([row.thin_cap, row.cut_at], [true, iso(T0 + 5 * DAY - 48 * 3600e3)]);
  const acct = accountView(await context(w.deps(), { readGeo: true, sync: false }), T0);
  assertEquals([acct.budget.thin_cap_markets, (acct.open_orders as Array<{ thin_cap: boolean }>)[0].thin_cap], [[C3], true]);
});

Deno.test("D15: the exception is for category B, a two-sided book of spread 5 points or under, and depth alone", async () => {
  const w = thinWorld();
  // Category A in the same book: the thin rule as before.
  assertEquals(refusalsOf(await placeOrder(w.deps(), d15({ category: "A", p: 0.6 }))).map((x) => x.rule), ["thin"]);
  // A wide book: thin, no exception.
  w.fake.markets.find((x) => x.cond === C6)!.bid = 0.40;
  assertEquals(refusalsOf(await placeOrder(w.deps(), d15({ market_id: C6, token_id: "601", price: 0.39, p: 0.6 }))).map((x) => x.rule), ["thin", "thin"]);
});

Deno.test("D15: each term refuses as thin_cap and names itself: event_at, size, cut, one bid, markets, orders", async () => {
  const w = thinWorld();
  const why = (r: { body: Record<string, unknown> }) => refusalsOf(r).filter((x) => x.rule === "thin_cap").map((x) => x.why.split(":")[0]);
  // event_at not sent at all.
  assertEquals(why(await placeOrder(w.deps(), d15({}, {}))), ["event_at"]);
  // Size: $5.28 is over min($5, a quarter of $35.60 = $8.90).
  assertEquals(why(await placeOrder(w.deps(), d15({ size: 12 }))), ["size"]);
  // Cut: a release named 2 days out puts the cut before the order's own life ends.
  const r = await placeOrder(w.deps(), d15({}, { event_at: iso(T0 + 2 * DAY) }));
  assertEquals(why(r), ["cut"]);
  assert(refusalsOf(r)[0].why.includes("named release"), refusalsOf(r)[0].why);
  // One bid a market: a D15 bid rests; a second one in that market is refused (and so is going over $5 there).
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }))).status, 200);
  assertEquals(why(await placeOrder(w.deps(), d15({ size: 1 }))), ["one bid"]);
  // Markets: with three D15 markets open, a fourth is refused.
  assertEquals((await placeOrder(w.deps(), d15({ market_id: C4, token_id: "401", size: 5 }))).status, 200);
  assertEquals((await placeOrder(w.deps(), d15({ market_id: C5, token_id: "501", size: 5 }))).status, 200);
  assertEquals(why(await placeOrder(w.deps(), d15({ market_id: C6, token_id: "601", size: 5 }))), ["markets"]);
});

Deno.test("D15: the pure terms: the depth share, the end-based cut, no end date, and the day's 100 orders", () => {
  const w = thinWorld();
  const L = ledgerOf({ fundedUsd: 100, orders: [], fills: [], mids: {}, payouts: {}, nowMs: T0 });
  const market = marketOf({ conditionId: C3, clobTokenIds: '["301","302"]', endDate: iso(T0 + 5 * DAY), acceptingOrders: true });
  const base = { cond: C3, cost: 2, inMarket: 2, depthUsd: 35.6, ledger: L, market, nowMs: T0, expirationS: Math.floor(T0 / 1000) + 60 + 35 * 60, eventAt: null, ordersToday: 0 };
  assertEquals(thinCapRefusals(base), { refusals: [], cutMs: T0 + 5 * DAY - 48 * 3600e3 });
  assertEquals(thinCapRefusals({ ...base, depthUsd: 4 }).refusals.map((x) => x.why.split(":")[0]), ["size"]);   // a quarter of $4 is $1
  assertEquals(thinCapRefusals({ ...base, ordersToday: 100 }).refusals.map((x) => x.why.split(":")[0]), ["orders"]);
  assertEquals(thinCapRefusals({ ...base, market: marketOf({ conditionId: C3, clobTokenIds: '["301","302"]', endDate: iso(T0 + 2 * DAY), acceptingOrders: true }) }).refusals.map((x) => x.why.split(":")[0]), ["cut"]);
  assertEquals(thinCapRefusals({ ...base, market: marketOf({ conditionId: C3, clobTokenIds: '["301","302"]', acceptingOrders: true }) }).refusals.map((x) => x.why.split(":")[0]), ["cut"]);
  assertEquals(thinCapRefusals({ ...base, eventAt: "soon" }).refusals.map((x) => x.why.split(":")[0]), ["event_at"]);
  void w;
});

Deno.test("D15: a D15 market stays held to $5 at cost after its book deepens, partial fills and re-bids included", async () => {
  const w = thinWorld({ armed: true });
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }))).status, 200);   // $2.20 resting
  // A fill of 5 at 0.44 is held ($2.20 at cost), and the book is now deep: an ordinary buy may not take the market past $5.
  seedFill(w, { hash: "0x" + "d1".repeat(32), cond: C3, token: "301", price: 0.44, size: 5 });
  w.fake.markets.find((x) => x.cond === C3)!.depth = [[0, 2000], [1, 2000]];
  const r = await placeOrder(w.deps(), d15({ size: 7 }));
  assert(refusalsOf(r).some((x) => x.rule === "thin_cap" && x.why.startsWith("cap")), JSON.stringify(refusalsOf(r)));
  // Within $5 it may (the held $2.20 and the resting $2.20 cancelled first, so $2.20 + $2.64 = $4.84).
  for (const o of w.db.tables.grokpm_orders.filter((x) => x.state === "live")) await cancelOrders(w.deps(), { order_id: o.hash }, false);
  const ok = await placeOrder(w.deps(), d15({ size: 6 }, { event_at: null, theme: "seeded" }));
  assertEquals(ok.status, 200, JSON.stringify(ok.body));
});

Deno.test("D15: the minute's cut cancels a D15 order at its cut, and earlier when Gamma moves the end; others are left", async () => {
  const w = thinWorld();
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }))).status, 200);
  assertEquals((await placeOrder(w.deps(), open({ size: 5 }))).status, 200);   // an ordinary order in C1
  const errors: string[] = [];
  assertEquals(await cutThinCapOrders(w.deps(), errors), 0);
  // Gamma moves C3's end to 47 hours from now: inside the cut, so the D15 order is cancelled; C1's is not.
  w.gammaExtra.set(C3, { endDate: iso(T0 + 47 * 3600e3) });
  assertEquals(await cutThinCapOrders(w.deps(), errors), 1);
  const states = w.db.tables.grokpm_orders.map((o) => [o.cond, o.state]);
  assertEquals(states.filter(([c]) => c === C3).map(([, s]) => s), ["cancelled"]);
  assertEquals(states.filter(([c]) => c === C1).map(([, s]) => s), ["live"]);
  // At the stored cut itself (end unchanged), the same.
  const v = thinWorld();
  assertEquals((await placeOrder(v.deps(), d15({ size: 5 }))).status, 200);
  v.at(T0 + 5 * DAY - 48 * 3600e3);
  assertEquals(await cutThinCapOrders(v.deps(), []), 1);
  assertEquals(errors, []);
});

Deno.test("D15: the minute's sync runs the cut (an armed D15 bid inside its cut is cancelled at the venue)", async () => {
  const w = thinWorld({ armed: true });
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }))).status, 200);
  // A minute later Gamma moves the market's end to 47 hours out (its GTD life alone would let it rest 34 more minutes).
  w.gammaExtra.set(C3, { endDate: iso(T0 + 47 * 3600e3) });
  w.at(T0 + 60e3);
  w.fake.cancelLagReads = 0;   // the venue shows the cancel at once (otherwise the row stays open until its read-back)
  const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  const deps = { secret: "s".repeat(40), db: ingest, now: () => w.now, exec: () => Promise.resolve(w.deps()), cronSecret: "c".repeat(40), region: "eu-west-1", beat: () => Promise.resolve(),
    report: () => Promise.resolve() };
  const res = await handle(new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${"c".repeat(40)}` } }), deps as never);
  const body = await res.json();
  assertEquals([res.status, body.d15_cut], [200, 1]);
  assertEquals(w.db.tables.grokpm_orders.map((o) => o.state), ["cancelled"]);
});

// 0143 (the order verification of 2026-10-27, V1): an order keeps the event_at it was sent and what its checks read.
Deno.test("V1: a D15 order keeps its event_at and its checks (book, edge, costs, Kelly cap, D15 cap and cut); an ordinary one its checks", async () => {
  const w = thinWorld();
  const event = iso(T0 + 4 * DAY);
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }, { event_at: event }))).status, 200);
  const row = w.db.tables.grokpm_orders.at(-1)!;
  assertEquals([row.event_at, row.cut_at], [event, iso(T0 + 4 * DAY - 48 * 3600e3)]);
  // By hand: book 0.45/0.47 (mid 0.46, spread 0.02, bids within 5 points 0.45 × 40 + 0.44 × 40 = 35.6, asks 0.47 × 40 + 0.48 × 40 = 38);
  // edge 0.6 − max(0.44, 0.46) = 0.14; cost 5 × 0.44 = 2.2; Kelly min(10, 0.25 × 0.16 / 0.56 × 100) = 7.142857; D15 cap min(5, 8.9) = 5.
  assertEquals(row.checks, {
    book: { best_bid: 0.45, best_ask: 0.47, mid: 0.46, spread: 0.02, bid_depth_usd: 35.6, ask_depth_usd: 38 }, edge: 0.14, cost_usd: 2.2, market_cost_usd: 2.2,
    event: { key: C3, cost_usd: 2.2 }, kelly_cap_usd: 7.142857, thin_cap: { cap_usd: 5, cut_at: iso(T0 + 4 * DAY - 48 * 3600e3) },
  });
  const acct = accountView(await context(w.deps(), { readGeo: true, sync: false }), T0);
  assertEquals((acct.open_orders as Array<{ event_at: string | null }>)[0].event_at, event);
  // An ordinary order in a deep book: no event_at, no D15 part.
  assertEquals((await placeOrder(w.deps(), open({ size: 5 }))).status, 200);
  const o = w.db.tables.grokpm_orders.at(-1)!;
  assertEquals([o.event_at, (o.checks as { thin_cap: unknown }).thin_cap, (o.checks as { book: { bid_depth_usd: number } }).book.bid_depth_usd > 500], [null, null, true]);
});

// ── Deviation D16 (2026-10-27): a resting category-B bid lives up to the server's 65 minutes ──────────────────────────
Deno.test("D16: a bid asked to rest 65 minutes rests 65 (the server's limit), 2 hours is held to 65, 35 stays 35", async () => {
  const w = world();
  const nowS = Math.floor(T0 / 1000);
  for (const [ask, life] of [[65, 3900], [120, 3900], [35, 2100]] as const) {
    const r = await placeOrder(w.deps(), { ...open({ size: 5 }), expires_at: iso(T0 + ask * 60e3) });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    // The venue is sent its minute on top (it ends a GTD order a minute early); the agent is told when it ends.
    assertEquals([w.db.tables.grokpm_orders.at(-1)!.expiration, (r.body.would_send as { expires_at: string }).expires_at], [nowS + 60 + life, iso(T0 + life * 1000)], `${ask}`);
  }
});

Deno.test("D16: a D15 bid's whole 65 minutes must end before its cut: refused with the cut 64 minutes away, sent with it 66", async () => {
  // A release `min` minutes past 48 hours from now puts the cut `min` minutes from now.
  const release = (min: number) => iso(T0 + 48 * 3600e3 + min * 60e3);
  const w = thinWorld();
  const r = await placeOrder(w.deps(), d15({ size: 5 }, { event_at: release(64), expires_at: iso(T0 + 65 * 60e3) }));
  assertEquals(refusalsOf(r).map((x) => [x.rule, x.why.split(":")[0]]), [["thin_cap", "cut"]]);
  // The same bid for 35 minutes ends before that cut.
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }, { event_at: release(64), expires_at: iso(T0 + 35 * 60e3) }))).status, 200);
  const v = thinWorld();
  assertEquals((await placeOrder(v.deps(), d15({ size: 5 }, { event_at: release(66), expires_at: iso(T0 + 65 * 60e3) }))).status, 200);
  const row = v.db.tables.grokpm_orders.at(-1)!;
  assertEquals([row.expiration, row.cut_at], [Math.floor(T0 / 1000) + 60 + 3900, iso(T0 + 66 * 60e3)]);
});

Deno.test("D16: a 65-minute bid is cancelled by the minute's sync once disarmed or paused, as any bid is", async () => {
  for (const how of ["disarm", "pause"] as const) {
    const w = world({ armed: true });
    assertEquals((await placeOrder(w.deps(), { ...open(), expires_at: iso(T0 + 65 * 60e3) })).status, 200);
    const hash = w.db.tables.grokpm_orders[0].hash as string;
    if (how === "disarm") Object.assign(w.db.tables.grokpm_config[0], { dry_run: true, armed_at: null });
    else w.db.tables.agent_risk[0].global_pause = true;
    w.fake.cancelLagReads = 0;
    w.at(T0 + 60e3);
    const ingest: IngestDb = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
    const res = await handle(new Request("https://x.test/functions/v1/grokpm?action=sync&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${"c".repeat(40)}` } }),
      { secret: "s".repeat(40), db: ingest, now: () => w.now, exec: () => Promise.resolve(w.deps()), cronSecret: "c".repeat(40), region: "eu-west-1", beat: () => Promise.resolve(), report: () => Promise.resolve() });
    assertEquals([res.status, (await res.json()).cancelled], [200, 1], how);
    assertEquals([w.fake.orders.get(hash)?.status, w.db.tables.grokpm_orders[0].state], ["CANCELED", "cancelled"], how);
  }
});

// ── Deviation D17 (2026-10-27): one event's outcome markets are one market for the $10 cap and D15's $5 ────────────────
const G1 = "0x" + "e1".repeat(32), G2 = "0x" + "e2".repeat(32);
/** Put markets under one negative-risk group, as Gamma shows the outcomes of one event (and the venue's books agree). */
function oneEvent(w: ReturnType<typeof world>, key: string, ...conds: string[]) {
  for (const c of conds) {
    w.fake.markets.find((x) => x.cond === c)!.negRisk = true;
    w.gammaExtra.set(c, { ...w.gammaExtra.get(c), negRisk: true, negRiskMarketID: key });
  }
}

Deno.test("D17: a market's event is Gamma's negRiskMarketID (lowercased); none when not negative-risk or malformed", () => {
  const base = { conditionId: C1, clobTokenIds: '["101","102"]' };
  assertEquals(marketOf({ ...base, negRisk: true, negRiskMarketID: "0x" + "E1".repeat(32) })!.negRiskId, G1);
  assertEquals(marketOf({ ...base, negRisk: false, negRiskMarketID: G1 })!.negRiskId, null);
  assertEquals(marketOf({ ...base, negRisk: true, negRiskMarketID: "0x12" })!.negRiskId, null);
  assertEquals(marketOf({ ...base, negRisk: true })!.negRiskId, null);
});

Deno.test("D17: the ledger groups the agent's markets by the event its orders stored (the newest that names one), else alone", () => {
  const row = (id: number, cond: string, g: string | null, price: number, size: number): GrokOrderRow => ({
    id, created_at: iso(T0), mode: "live", decision_id: `x${id}`, cond, token: `${id}0`, outcome: "Yes", side: "BUY", price, size, post_only: true,
    expiration: Math.floor(T0 / 1000) + 600, neg_risk: true, hash: `h${id}`, theme: "t", category: "B", state: "live", size_matched: 0,
    cancel_requested_at: null, cancelled_at: null, filled_at: null, neg_risk_market_id: g,
  });
  // C1's first order is from before 0147 (no group); its second names G1. C3 names none.
  const L = ledgerOf({ fundedUsd: 100, orders: [row(1, C1, null, 0.5, 4), row(2, C1, G1, 0.5, 2), row(3, C2, G1, 0.4, 5), row(4, C3, null, 0.3, 10)], fills: [], mids: {}, payouts: {}, nowMs: T0 });
  assertEquals(L.eventOf, { [C1]: G1, [C2]: G1, [C3]: C3 });
  assertEquals([L.costByCond, L.costByEvent], [{ [C1]: 3, [C2]: 2, [C3]: 3 }, { [G1]: 5, [C3]: 3 }]);
  // Gamma's group first; a market the book holds under another key still counts as this market.
  assertEquals([eventKeyOf(L, C1, null), eventKeyOf(L, C3, null), eventKeyOf(L, C3, { negRiskId: G2 })], [G1, C3, G2]);
  assertEquals([eventCostUsd(L, G1, C1), eventCostUsd(L, G2, C3), eventCostUsd(L, G1, C3)], [5, 3, 8]);
});

Deno.test("D17: one event's outcome markets share the $10 cap ($5.28 + $5.28 refused, $5.28 + $4.40 sent); apart, both go", async () => {
  const w = world();
  oneEvent(w, G1, C1, C2);
  assertEquals((await placeOrder(w.deps(), open({ size: 12 }))).status, 200);   // C1: 12 × 0.44 = $5.28
  const r = await placeOrder(w.deps(), open({ market_id: C2, token_id: "201", size: 12 }));
  assertEquals(refusalsOf(r).map((x) => x.rule), ["market_cap"]);
  assert(refusalsOf(r)[0].why.startsWith("this market and the other outcomes of its event (D17) would hold $10.56 at cost"), refusalsOf(r)[0].why);
  assertEquals((await placeOrder(w.deps(), open({ market_id: C2, token_id: "201", size: 10 }))).status, 200);   // $5.28 + $4.40 = $9.68
  assertEquals(w.db.tables.grokpm_orders.map((o) => o.neg_risk_market_id), [G1, G1]);
  assertEquals((w.db.tables.grokpm_orders.at(-1)!.checks as { event: unknown }).event, { key: G1, cost_usd: 9.68 });
  const acct = accountView(await context(w.deps(), { readGeo: true, sync: false }), T0);
  assertEquals(acct.budget.cost_by_event, { [G1]: 9.68 });
  assertEquals(((await marketView(w.deps(), { cond: C2 })).body as { neg_risk_market_id?: string }).neg_risk_market_id, G1);
  // Not one event: the same two buys both go, and nothing is grouped.
  const v = world();
  assertEquals((await placeOrder(v.deps(), open({ size: 12 }))).status, 200);
  assertEquals((await placeOrder(v.deps(), open({ market_id: C2, token_id: "201", size: 12 }))).status, 200);
  assertEquals(v.db.tables.grokpm_orders.map((o) => o.neg_risk_market_id), [null, null]);
});

Deno.test("D17: D15's $5 is the event's: a second thin outcome gets what the first leaves, and so does a deep one", async () => {
  const w = thinWorld();
  oneEvent(w, G2, C3, C4, C1);
  assertEquals((await placeOrder(w.deps(), d15({ size: 5 }))).status, 200);   // C3 under D15: $2.20
  // C4, thin too: $2.20 + 7 × 0.44 = $5.28, over min($5, a quarter of $35.60): the size term, counted over the event.
  const r = await placeOrder(w.deps(), d15({ market_id: C4, token_id: "401", size: 7 }));
  assertEquals(refusalsOf(r).map((x) => [x.rule, x.why.split(":")[0]]), [["thin_cap", "size"]]);
  assert(refusalsOf(r)[0].why.includes("this market and the other outcomes of its event (D17) would hold $5.28"), refusalsOf(r)[0].why);
  // C1, a deep book (an ordinary order): the event holds a D15 bid, so $2.20 + $4.40 = $6.60 is refused and $2.20 + $2.64 goes.
  const deep = await placeOrder(w.deps(), open({ size: 10 }));
  assertEquals(refusalsOf(deep).map((x) => [x.rule, x.why.split(":")[0]]), [["thin_cap", "cap"]]);
  assert(refusalsOf(deep)[0].why.includes("another outcome of this event holds a D15 position"), refusalsOf(deep)[0].why);
  assertEquals((await placeOrder(w.deps(), open({ size: 6 }))).status, 200);
  // Apart, each of the three would have gone.
  const v = thinWorld();
  assertEquals((await placeOrder(v.deps(), d15({ size: 5 }))).status, 200);
  assertEquals((await placeOrder(v.deps(), d15({ market_id: C4, token_id: "401", size: 7 }))).status, 200);
  assertEquals((await placeOrder(v.deps(), open({ size: 10 }))).status, 200);
});
