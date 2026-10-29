// "Stablecoin quotes USDC/GBP", the Coinbase live executor (cb_live.ts, 0177), against an in-memory Coinbase that keeps
// orders, fills and balances as the Advanced Trade API answers them. Pins: (1) dry-run never POSTs (the venue fails the test
// on one) and records what it would send, once a decision, at the paper's prices and £20 sizes; (2) armed, it sends six
// post-only good-til-date orders of Coinbase's documented shape, nothing new while nothing changes, and re-places an order
// before its end; (3) a fill read back makes the rung held: its exit at the paper's fair, the trip closed when the exit fills,
// the rung quoting again; (4) the kill switch withdraws entries and keeps exits; the global pause cancels everything; (5) a
// post-only refusal is not sent again for the same paper decision; (6) a lost reply stays pending and is adopted by its
// client id, never marked rejected; (7) the 24-hour stop is an IOC within 50 bps; (8) a remainder under £1 is carried; (9)
// the start conversion buys the asks' USDC post-only at the bid within the pounds the bids leave; (10) the loss stop and the
// governor stop entries; (11) LIVE's row reads the tables alone.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { CB_KEY_NAME_SECRET, CB_PRIVATE_KEY_SECRET } from "../_shared/coinbase.ts";
import { CB_LIVE_GTD_MS, CB_LIVE_NAME, isDust, readCbLive, runCbLive, rungQty, tripPnl, tripsOf, type FillRow } from "./cb_live.ts";
import { exitTicks, newBookState, quoteTicks, QUOTE_TICK, type BookState } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 9, 30, 10, 0);
const FAIR = 0.75;

const derLen = (n: number) => (n < 0x80 ? [n] : [0x81, n]);
const tlv = (tag: number, b: number[]) => [tag, ...derLen(b.length), ...b];
const PEM = await (async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const j = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const sec1 = tlv(0x30, [0x02, 0x01, 0x01, ...tlv(0x04, [...b64ToBytes(j.d!)]), ...tlv(0xa0, oid), ...tlv(0xa1, tlv(0x03, [0x00, 0x04, ...b64ToBytes(j.x!), ...b64ToBytes(j.y!)]))]);
  let s = ""; for (const b of sec1) s += String.fromCharCode(b);
  return `-----BEGIN EC PRIVATE KEY-----\n${btoa(s)}\n-----END EC PRIVATE KEY-----`;
})();
const ENV: Record<string, string> = { [CB_KEY_NAME_SECRET]: "organizations/o/apiKeys/k", [CB_PRIVATE_KEY_SECRET]: PEM };

/** The paper arm's book: every rung quoting its entry at `fair`, each a decision going live at `live`. */
function paperBook(fair: number, live: number, oid0 = 1): BookState {
  const b = newBookState("USDC-GBP");
  b.lastX = 1.3333; b.nextOid = oid0 + 6;
  b.rungs.forEach((r, i) => { r.mode = "quote"; r.o = { side: r.side, ticks: quoteTicks(fair, r.k, r.side), fairAt: fair, live, state: "live", oid: oid0 + i }; });
  return b;
}

type VOrder = { order_id: string; client_order_id: string; product_id: string; side: "BUY" | "SELL"; status: string; filled_size: string; average_filled_price: string; total_fees: string; created_time: string; cfg: Record<string, unknown> };
/** An in-memory Coinbase: its orders, fills, balances and touch; `post` false fails on any POST. */
function venue(o: { post: boolean; gbp?: number; usdc?: number; touch?: { bid: string; ask: string }; onCreate?: (b: Record<string, unknown>) => "ok" | "refuse" | "throw" }) {
  const orders: VOrder[] = [], fills: Record<string, unknown>[] = [], calls: string[] = [];
  const bal = { GBP: o.gbp ?? 120, USDC: o.usdc ?? 100 };
  let n = 0, clock = T0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    await Promise.resolve();
    const u = new URL(url), method = init.method ?? "GET", p = u.pathname.replace("/api/v3/brokerage", "");
    calls.push(`${method} ${p}`);
    if (method !== "GET" && !o.post) throw new Error(`dry-run sent ${method} ${p}`);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (p === "/products/USDC-GBP") return ok({ product_id: "USDC-GBP", base_increment: "0.01", quote_increment: "0.0001", base_min_size: "1" });
    if (p === "/best_bid_ask") return ok({ pricebooks: [{ product_id: "USDC-GBP", bids: [{ price: o.touch?.bid ?? "0.7499" }], asks: [{ price: o.touch?.ask ?? "0.7501" }] }] });
    if (p === "/accounts") return ok({ accounts: [{ currency: "GBP", available_balance: { value: String(bal.GBP), currency: "GBP" } }, { currency: "USDC", available_balance: { value: String(bal.USDC), currency: "USDC" } }], has_next: false });
    if (p === "/orders" && method === "POST") {
      const b = JSON.parse(String(init.body));
      const seen = orders.find((x) => x.client_order_id === b.client_order_id);
      if (seen) return ok({ success: true, success_response: { order_id: seen.order_id } });
      const what = o.onCreate?.(b) ?? "ok";
      if (what === "throw") throw new Error("socket hang up");
      if (what === "refuse") return ok({ success: false, error_response: { error: "INVALID_LIMIT_PRICE_POST_ONLY", new_order_failure_reason: "INVALID_LIMIT_PRICE_POST_ONLY" } });
      const v: VOrder = { order_id: `v${++n}`, client_order_id: b.client_order_id, product_id: b.product_id, side: b.side, status: "OPEN", filled_size: "0", average_filled_price: "0", total_fees: "0", created_time: iso(clock), cfg: b.order_configuration };
      orders.push(v);
      return ok({ success: true, success_response: { order_id: v.order_id, client_order_id: b.client_order_id } });
    }
    if (p === "/orders/batch_cancel") {
      const ids: string[] = JSON.parse(String(init.body)).order_ids;
      return ok({ results: ids.map((id) => { const v = orders.find((x) => x.order_id === id); if (v && v.status === "OPEN") v.status = "CANCELLED"; return { success: !!v, order_id: id }; }) });
    }
    if (p === "/orders/historical/batch") {
      const since = u.searchParams.get("start_date"), open = u.searchParams.getAll("order_status").includes("OPEN");
      return ok({ orders: orders.filter((x) => (!since || x.created_time >= since) && (!open || x.status === "OPEN")), has_next: false });
    }
    if (p === "/orders/historical/fills") {
      const ids = u.searchParams.getAll("order_ids");
      return ok({ fills: fills.filter((f) => ids.includes(String(f.order_id))), cursor: "" });
    }
    const m = /^\/orders\/historical\/(.+)$/.exec(p);
    if (m) return ok({ order: orders.find((x) => x.order_id === m[1]) });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  /** Fill `qty` of an order at its limit price. */
  const fill = (order_id: string, qty: number, at: number, fee = 0) => {
    const v = orders.find((x) => x.order_id === order_id)!;
    const c = (v.cfg.limit_limit_gtd ?? v.cfg.sor_limit_ioc) as { limit_price: string; base_size: string };
    const done = Number(v.filled_size) + qty;
    v.filled_size = String(done); v.average_filled_price = c.limit_price; v.total_fees = String(Number(v.total_fees) + fee);
    if (done >= Number(c.base_size) - 1e-9) v.status = "FILLED";
    fills.push({ entry_id: `e${fills.length + 1}`, trade_id: `t${fills.length + 1}`, order_id, trade_time: iso(at), trade_type: "FILL", price: c.limit_price, size: String(qty), commission: String(fee), product_id: "USDC-GBP", liquidity_indicator: "MAKER", side: v.side });
  };
  return { orders, fills, calls, fetchImpl, fill, bal, setClock: (t: number) => { clock = t; } };
}

function world(o: { dry: boolean; armed?: boolean; book?: BookState; last?: number; fair?: number | null; pause?: boolean; cfg?: Record<string, unknown> }) {
  const last = o.last ?? T0 - M;
  return memDb({
    cb_live_config: [{ id: 1, paper: "coinbasenudge", dry_run: o.dry, armed_at: o.armed ? iso(T0 - H) : null, rung_gbp: 20, capital_gbp: 120, daily_loss_pct: 0.01,
      gov_entry_posts: 1500, gov_stops_only_posts: 1800, convert_max_gbp_day: 70, ...o.cfg }],
    cb_live_orders: [], cb_live_fills: [], cb_live_events: [], cb_live_state: [],
    agent_locks: [{ name: "cb-live", lease_until: iso(0), holder: null }],
    agent_risk: [{ id: 1, global_pause: !!o.pause }],
    cb_nudge_state: [{ id: 1, state: { books: { "USDC-GBP": o.book ?? paperBook(FAIR, T0) } }, last_minute: iso(last) }],
    cb_nudge_minutes: [{ book: "USDC-GBP", minute: iso(last), fair: o.fair === undefined ? FAIR : o.fair }],
  }, { now: () => T0 });
}
let holder = 0;
const turn = (w: ReturnType<typeof world>, v: ReturnType<typeof venue>, now: number, env: Record<string, string> = ENV) =>
  runCbLive({ db: w.db, now, holder: `h${++holder}`, read: (n) => env[n], fetchImpl: v.fetchImpl });
const rows = (w: ReturnType<typeof world>) => w.tables.cb_live_orders as Row[];

Deno.test("dry-run never POSTs: what it would send is a row a decision, the paper's prices at £20, with or without the key", async () => {
  for (const env of [ENV, {}]) {
    const w = world({ dry: true }), v = venue({ post: false });
    const r = await turn(w, v, T0 + 10e3, env);
    assertEquals([r.mode, r.armed, r.errors], ["dry_run", false, []]);
    assert(v.calls.every((c) => c.startsWith("GET ")));
    if (!Object.keys(env).length) assertEquals(v.calls, []);
    const dry = rows(w).filter((x) => x.state === "dry");
    assertEquals(dry.length, 6);
    for (const x of dry) {
      const ticks = quoteTicks(FAIR, Number(x.k), x.rung_side as "bid" | "ask");
      assertAlmostEquals(Number(x.price), ticks * QUOTE_TICK, 1e-12);
      assertEquals(Number(x.base_size), rungQty(20, ticks * QUOTE_TICK, 0.01));
      assertEquals([x.mode, x.side], ["dry_run", x.rung_side === "bid" ? "BUY" : "SELL"]);
    }
    // Nothing changed: nothing new. The paper re-prices: the old row is withdrawn and the new decision written.
    await turn(w, v, T0 + 70e3, env);
    assertEquals(rows(w).length, 6);
    w.tables.cb_nudge_state[0].state = { books: { "USDC-GBP": paperBook(0.7505, T0 + 2 * M, 20) } };
    w.tables.cb_nudge_minutes.push({ book: "USDC-GBP", minute: iso(T0 + M), fair: 0.7505 });
    w.tables.cb_nudge_state[0].last_minute = iso(T0 + M);
    await turn(w, v, T0 + 130e3, env);
    assertEquals([rows(w).filter((x) => x.state === "dry_withdrawn").length, rows(w).filter((x) => x.state === "dry").length], [6, 6]);
  }
});

Deno.test("armed: six post-only good-til-date orders in Coinbase's shape, nothing new while nothing changes, re-placed before their end", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true, usdc: 100 });
  const r = await turn(w, v, T0 + 10e3);
  assertEquals([r.mode, r.armed, r.errors, r.placed], ["live", true, [], 6]);
  assertEquals(v.orders.length, 6);
  const bid = v.orders.find((x) => x.side === "BUY")!;
  const g = bid.cfg.limit_limit_gtd as Record<string, unknown>;
  assertEquals(Object.keys(bid.cfg), ["limit_limit_gtd"]);
  assertEquals(g.post_only, true);
  assertEquals(g.end_time, iso(T0 + 10e3 + CB_LIVE_GTD_MS).replace(/\.\d{3}Z$/, "Z"));
  assert(/^\d+\.\d{2}$/.test(String(g.base_size)) && /^\d+\.\d{4}$/.test(String(g.limit_price)));
  assert(rows(w).every((x) => x.state === "open" && x.venue_order_id));
  const r2 = await turn(w, v, T0 + 70e3);
  assertEquals([r2.placed, v.orders.length], [0, 6]);
  // Sixteen minutes on (the paper has decided its minutes since), less than five are left: each is cancelled, read back,
  // and placed again at the same price.
  w.tables.cb_nudge_state[0].last_minute = iso(T0 + 15 * M);
  w.tables.cb_nudge_minutes.push({ book: "USDC-GBP", minute: iso(T0 + 15 * M), fair: FAIR });
  const r3 = await turn(w, v, T0 + 10e3 + 16 * M);
  assertEquals([r3.cancelled, r3.placed, v.orders.filter((x) => x.status === "OPEN").length, v.orders.filter((x) => x.status === "CANCELLED").length], [6, 6, 6, 6]);
});

Deno.test("a fill read back makes the rung held: its exit at the paper's fair; the exit's fill closes the trip and the rung quotes again", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true });
  await turn(w, v, T0 + 10e3);
  const bidRow = rows(w).find((x) => x.rung_side === "bid" && Number(x.k) === 0.001)!;
  const qty = Number(bidRow.base_size);
  v.fill(bidRow.venue_order_id as string, qty, T0 + 30e3, 0);
  const r = await turn(w, v, T0 + 70e3);
  assertEquals(r.errors, []);
  assertEquals(w.tables.cb_live_fills.length, 1);
  assertEquals(r.held["bid|0.001"], qty);
  const exit = rows(w).find((x) => x.leg === "exit")!;
  assertEquals([exit.side, Number(exit.base_size), exit.trip, exit.state], ["SELL", qty, bidRow.client_order_id, "open"]);
  assertAlmostEquals(Number(exit.price), exitTicks(FAIR, "bid") * QUOTE_TICK, 1e-12);
  v.fill(exit.venue_order_id as string, qty, T0 + 90e3, 0);
  const r2 = await turn(w, v, T0 + 130e3);
  assertEquals(r2.held, {});
  const t = [...tripsOf(w.tables.cb_live_fills as unknown as FillRow[]).values()][0];
  assertAlmostEquals(tripPnl(t, FAIR).realised, qty * (Number(exit.price) - Number(bidRow.price)), 1e-9);
  // The rung quotes its entry again (the same paper decision, a new order and trip).
  assertEquals(rows(w).filter((x) => x.rung_side === "bid" && Number(x.k) === 0.001 && x.leg === "entry" && x.state === "open").length, 1);
});

Deno.test("the kill switch withdraws entries and keeps the exit; the global pause cancels everything, exits included", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true });
  await turn(w, v, T0 + 10e3);
  const b = rows(w).find((x) => x.rung_side === "bid" && Number(x.k) === 0.001)!;
  v.fill(b.venue_order_id as string, Number(b.base_size), T0 + 30e3);
  await turn(w, v, T0 + 70e3);
  w.tables.cb_live_config[0].armed_at = null;
  const r = await turn(w, v, T0 + 130e3);
  assertEquals([r.armed, r.mode], [false, "live"]);
  const open = rows(w).filter((x) => x.state === "open");
  assertEquals(open.map((x) => x.leg), ["exit"]);
  w.tables.agent_risk[0].global_pause = true;
  const p = await turn(w, v, T0 + 190e3);
  assertEquals([p.mode, p.placed, rows(w).filter((x) => x.state === "open").length, v.orders.filter((x) => x.status === "OPEN").length], ["paused", 0, 0, 0]);
});

Deno.test("a post-only refusal is not sent again for the same paper decision; a lost reply stays pending and is adopted by its client id", async () => {
  let refuse = true;
  const w = world({ dry: false, armed: true }), v = venue({ post: true, onCreate: (b) => (refuse && b.side === "SELL" ? "refuse" : "ok") });
  await turn(w, v, T0 + 10e3);
  assertEquals(rows(w).filter((x) => x.state === "refused").length, 3);
  refuse = false;
  const r = await turn(w, v, T0 + 70e3);
  assertEquals([r.placed, rows(w).filter((x) => x.state === "refused").length], [0, 3]);
  // A reply lost on the wire.
  let lose = true;
  const w2 = world({ dry: false, armed: true }), v2 = venue({ post: true, onCreate: () => (lose ? "throw" : "ok") });
  const a = await turn(w2, v2, T0 + 10e3);
  assertEquals([a.errors.length, rows(w2).every((x) => x.state === "pending")], [6, true]);
  const b = await turn(w2, v2, T0 + 70e3);                                    // the venue shows nothing: still pending, nothing sent
  assertEquals([b.placed, rows(w2).filter((x) => x.state === "rejected").length], [0, 0]);
  const c = await turn(w2, v2, T0 + 4 * M);
  assert(c.events.includes("unknown_order"));
  // The venue had it after all (a later read shows it): adopted by its client id.
  lose = false;
  v2.orders.push({ order_id: "late", client_order_id: String(rows(w2)[0].client_order_id), product_id: "USDC-GBP", side: rows(w2)[0].side as "BUY", status: "OPEN", filled_size: "0", average_filled_price: "0", total_fees: "0", created_time: iso(T0 + 10e3), cfg: (rows(w2)[0].request as { order_configuration: Record<string, unknown> }).order_configuration });
  w2.tables.cb_nudge_state[0].last_minute = iso(T0 + 4 * M);                 // the paper has decided on: its entry still stands
  w2.tables.cb_nudge_minutes.push({ book: "USDC-GBP", minute: iso(T0 + 4 * M), fair: FAIR });
  await turn(w2, v2, T0 + 5 * M);
  assertEquals([rows(w2)[0].venue_order_id, rows(w2)[0].state], ["late", "open"]);
});

Deno.test("the 24-hour stop is an IOC within 50 bps of fair; a remainder under £1 is carried, not exited", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true });
  await turn(w, v, T0 + 10e3);
  const b = rows(w).find((x) => x.rung_side === "bid" && Number(x.k) === 0.001)!;
  v.fill(b.venue_order_id as string, Number(b.base_size), T0 + 30e3);
  const later = T0 + 25 * H;
  w.tables.cb_nudge_state[0].last_minute = iso(later - M);
  w.tables.cb_nudge_minutes.push({ book: "USDC-GBP", minute: iso(later - M), fair: FAIR });
  await turn(w, v, later);
  const stop = rows(w).find((x) => x.leg === "stop")!;
  assertEquals(Object.keys((stop.request as { order_configuration: Record<string, unknown> }).order_configuration), ["sor_limit_ioc"]);
  assertAlmostEquals(Number(stop.price), Math.floor(FAIR * 0.995 / QUOTE_TICK) * QUOTE_TICK, 1e-9);
  assertEquals([isDust(1.2, 0.75, 1), isDust(1.4, 0.75, 1), isDust(0.9, 0.75, 1)], [true, false, true]);   // £0.90, £1.05, under the minimum
  assertEquals(isDust(1.3, 0.75, 1), true);                                   // £0.975: carried
  assertEquals(isDust(1.34, 0.75, 1), false);                                 // £1.005: exited
});

Deno.test("the start conversion: asks short of USDC, a post-only buy at the bid within the pounds the bids leave", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true, gbp: 120, usdc: 0 });
  const r = await turn(w, v, T0 + 10e3);
  assertEquals(rows(w).filter((x) => x.leg === "entry" && x.state === "open").map((x) => x.side), ["BUY", "BUY", "BUY"]);
  const conv = rows(w).find((x) => x.leg === "convert")!;
  assertEquals([conv.side, Number(conv.price), conv.rung_side, conv.mode], ["BUY", 0.7499, null, "live"]);
  const asksNeed = [0.001, 0.002, 0.003].reduce((s, k) => s + rungQty(20, quoteTicks(FAIR, k, "ask") * QUOTE_TICK, 0.01), 0);
  const bidsCost = rows(w).filter((x) => x.leg === "entry").reduce((s, x) => s + Number(x.price) * Number(x.base_size), 0);
  assertAlmostEquals(Number(conv.base_size), Math.min(Math.ceil(asksNeed * 1.02 * 100) / 100, Math.floor((120 - bidsCost) / 0.7499 * 100) / 100), 1e-9);
  assert(Number(conv.base_size) * 0.7499 <= 120 - bidsCost + 1e-9);
  assert(((conv.request as { order_configuration: { limit_limit_gtd: { post_only: boolean } } }).order_configuration.limit_limit_gtd.post_only));
  assert(r.events.includes("skip_inventory"));
});

Deno.test("the daily loss stop and the governor stop entries; stale or dark paper inputs place none", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true });
  w.tables.cb_live_orders.push({ id: 1, client_order_id: crypto.randomUUID(), venue_order_id: "x", mode: "live", leg: "entry", trip: "11111111-1111-4111-8111-111111111111", rung_side: "bid", k: 0.003,
    side: "BUY", price: 0.75, base_size: 10, end_time: null, state: "filled", paper_key: null, fair: 0.75, filled_size: 10, avg_price: 0.75, fees_gbp: 0, reason: null, request: null, response: {}, created_at: iso(T0 - H), updated_at: iso(T0 - H) });
  // A trip that lost £1.50 today: 10 bought at 0.75, sold at 0.60.
  for (const [leg, side, price] of [["entry", "BUY", 0.75], ["exit", "SELL", 0.60]] as const) {
    w.tables.cb_live_fills.push({ entry_id: `L${leg}`, trade_id: "t", order_id: "x", client_order_id: w.tables.cb_live_orders[0].client_order_id, trip: "11111111-1111-4111-8111-111111111111", leg, rung_side: "bid", k: 0.003, side, price, size: 10, commission: 0, liquidity: "MAKER", trade_time: iso(T0 - 30 * M) });
  }
  const r = await turn(w, v, T0 + 10e3);
  assertEquals([r.lossStopped, r.placed], [true, 0]);
  const g = world({ dry: false, armed: true, cfg: { gov_entry_posts: 1, gov_stops_only_posts: 1 } });
  g.tables.cb_live_orders.push({ id: 1, client_order_id: crypto.randomUUID(), venue_order_id: "y", mode: "live", leg: "convert", trip: null, rung_side: null, k: null, side: "BUY", price: 0.75, base_size: 2, end_time: null, state: "cancelled",
    paper_key: null, fair: null, filled_size: 0, avg_price: null, fees_gbp: 0, reason: null, request: null, response: {}, created_at: iso(T0), updated_at: iso(T0) });
  const gr = await turn(g, venue({ post: true }), T0 + 10e3);
  assertEquals([gr.placed, gr.events.includes("governor")], [0, true]);
  for (const o of [{ last: T0 - 10 * M }, { fair: null }]) {
    const s = world({ dry: false, armed: true, ...o });
    assertEquals((await turn(s, venue({ post: true }), T0 + 10e3)).placed, 0);
  }
});

Deno.test("LIVE's row of it reads its own tables: its name, the arm, what it holds and has made, in pounds with the paper's GBP/USD", async () => {
  const w = world({ dry: false, armed: true }), v = venue({ post: true });
  await turn(w, v, T0 + 10e3);
  const b = rows(w).find((x) => x.rung_side === "bid" && Number(x.k) === 0.001)!;
  v.fill(b.venue_order_id as string, Number(b.base_size), T0 + 30e3, 0.001);
  await turn(w, v, T0 + 70e3);
  const c = (await readCbLive(w.db, T0 + 80e3))!;
  assertEquals([c.name, c.armed, c.tradedLive, c.running, c.capitalGbp, c.heldRungs, c.gbpUsd], [CB_LIVE_NAME, true, true, true, 120, 1, 1.3333]);
  assertEquals(CB_LIVE_NAME, "Stablecoin quotes USDC/GBP");
  assertAlmostEquals(c.costGbp, Number(b.base_size) * Number(b.price), 1e-9);
  assertAlmostEquals(c.realisedGbp, -0.001, 1e-12);
  const none = memDb({}, { now: () => T0 });
  assertEquals(await readCbLive(none.db, T0), null);
});
