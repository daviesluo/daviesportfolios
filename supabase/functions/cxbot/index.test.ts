// Pins CXBOT's server end to end on a database double that holds 0163's columns (`schema.ts`: a write naming a column the
// table does not have is refused, as PostgREST refuses it; a paged read without a total order throws, as the real client
// does) and a public-market double: the bearer before anything; the guard that refuses every host off the list; the minute's
// beat first, the recorder, the context, the dry-run (nothing booked) and the paper book; the assigned questions issued,
// answered, started at their deadline and resolved on the tape; a market open filled through the book and stopped out at
// the conservative fill; amends, closes and cancels on the bot's own book; the journal; and the `reach` probe.
import { assert, assertAlmostEquals, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPagedOrder, type Db } from "../agents/db.ts";
import { assertCxbotAllowed, CxbotRefused, makeReader } from "./client.ts";
import { makeDeps, sd24Of } from "./engine.ts";
import { handle } from "./index.ts";
import { CXBOT_RULES, stopFill } from "./rules.ts";
import { CXBOT_TABLES } from "./schema.ts";

const M = 60e3, H = 3600e3;
const TOKEN = "t".repeat(40), CRON = "c".repeat(40);
const iso = (t: number) => new Date(t).toISOString();

type Row = Record<string, unknown>;
class FakeDb implements Db {
  t: Record<string, Row[]> = {};
  seq: Record<string, number> = {};
  constructor() {
    for (const k of Object.keys(CXBOT_TABLES)) this.t[k] = [];
    this.t.cxbot_config = [{ id: 1, mode: "dry_run", venue: "hyperliquid", started_at: null, ended_at: null, budget_usd: 1000, day_stop_usd: 20, total_stop_usd: 100, max_orders_day: 30 }];
    this.t.cxbot_exec_state = [{ id: 1, state: {}, lease_until: null, lease_owner: null }];
    this.t.agent_risk = [{ id: 1, global_pause: false }];
  }
  private check(table: string, row: Row) {
    const cols = table === "agent_risk" ? ["id", "global_pause"] : CXBOT_TABLES[table]?.columns;
    if (!cols) throw new Error(`no table ${table}`);
    for (const k of Object.keys(row)) if (!cols.includes(k)) throw new Error(`${table}: no column ${k}`);
  }
  private where(table: string, query: string): Row[] {
    let rows = this.t[table] ?? [];
    for (const part of query.split("&")) {
      const i = part.indexOf("="), k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      if (k === "or") {
        const alts = v.slice(1, -1).split(",").map((x) => { const [c, op, ...rest] = x.split("."); return [c, op, rest.join(".")]; });
        rows = rows.filter((r) => alts.some(([c, op, val]) => test(r[c], op, val)));
        continue;
      }
      const dot = v.indexOf("."), op = v.slice(0, dot), val = v.slice(dot + 1);
      rows = rows.filter((r) => test(r[k], op, val));
    }
    const ord = /(?:^|&)order=([^&]+)/.exec(query)?.[1];
    if (ord) {
      const keys = decodeURIComponent(ord).split(",").map((x) => x.split("."));
      rows = [...rows].sort((a, b) => {
        for (const [c, d] of keys) {
          const x = a[c], y = b[c];
          const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          if (cmp) return d === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
    const lim = /(?:^|&)limit=(\d+)/.exec(query);
    return lim ? rows.slice(0, Number(lim[1])) : rows;
  }
  select<T>(table: string, query: string): Promise<T[]> { return Promise.resolve(this.where(table, query).map((r) => ({ ...r })) as T[]); }
  selectAll<T>(table: string, query: string): Promise<T[]> { assertPagedOrder(table, query); return this.select<T>(table, query); }
  insert<T>(table: string, rows: unknown): Promise<T[]> {
    const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
    for (const r of list) this.check(table, r);
    const out: Row[] = [];
    for (const r of list) {
      const key = CXBOT_TABLES[table].key;
      const row: Row = { ...r };
      if (key === "id" && row.id === undefined) row.id = (this.seq[table] = (this.seq[table] ?? 0) + 1);
      if (!row.at && table === "cxbot_requests") row.at = iso(NOW);
      if (!row.created_at && table === "cxbot_orders") row.created_at = iso(NOW);
      if (this.t[table].some((x) => key.split(",").every((k) => x[k] === row[k]))) return Promise.reject(new Error(`${table}: duplicate key`));
      if (table === "cxbot_orders" && !this.t.cxbot_decisions.some((d) => d.id === row.decision_id)) return Promise.reject(new Error("cxbot_orders: decision_id references no decision"));
      if (table === "cxbot_forecasts" && !this.t.cxbot_questions.some((q) => q.id === row.question_id)) return Promise.reject(new Error("cxbot_forecasts: no such question"));
      this.t[table].push(row);
      out.push({ ...row });
    }
    return Promise.resolve(out as T[]);
  }
  upsert(table: string, rows: unknown, onConflict: string): Promise<void> {
    const list = rows as Row[];
    const keys0 = Object.keys(list[0] ?? {}).sort().join(",");
    for (const r of list) {
      this.check(table, r);
      if (Object.keys(r).sort().join(",") !== keys0) return Promise.reject(new Error("All object keys must match"));
      const keys = onConflict.split(",");
      const i = this.t[table].findIndex((x) => keys.every((k) => x[k] === r[k]));
      if (i >= 0) this.t[table][i] = { ...this.t[table][i], ...r };
      else this.t[table].push({ ...r });
    }
    return Promise.resolve();
  }
  update(table: string, query: string, patch: unknown): Promise<void> {
    this.check(table, patch as Row);
    for (const r of this.where(table, query)) Object.assign(r, patch);
    return Promise.resolve();
  }
  claim<T>(table: string, query: string, patch: unknown): Promise<T[]> {
    this.check(table, patch as Row);
    const rows = this.where(table, query);
    for (const r of rows) Object.assign(r, patch);
    return Promise.resolve(rows.map((r) => ({ ...r })) as T[]);
  }
}
function test(x: unknown, op: string, val: string): boolean {
  const s = x === null || x === undefined ? null : String(x);
  switch (op) {
    case "eq": return s === val;
    case "neq": return s !== val;
    case "is": return val === "null" ? s === null : val === "true" ? x === true : x === false;
    case "not": return !test(x, val.split(".")[0], val.split(".").slice(1).join("."));
    case "gt": return s !== null && s > val;
    case "gte": return s !== null && s >= val;
    case "lt": return s !== null && s < val;
    case "lte": return s !== null && s <= val;
    case "in": return val.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(s ?? "");
    default: throw new Error(`filter op ${op}`);
  }
}

// ── a public-market double ─────────────────────────────────────────────────────────────────────────────────────────────

let NOW = Date.parse("2026-11-04T07:50:30Z");
const BASE: Record<string, number> = { BTC: 81200, ETH: 2400, SOL: 182 };
/** Minute candles the test overrides; every other minute is flat at its coin's base price. */
const BARS: Record<string, Record<number, { o: number; h: number; l: number; c: number }>> = { BTC: {}, ETH: {}, SOL: {} };
const bar = (coin: string, t: number) => BARS[coin][t] ?? { o: BASE[coin], h: BASE[coin], l: BASE[coin], c: BASE[coin] };
let calls: string[] = [];
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  calls.push(`${url.host}${url.pathname}`);
  if (url.host === "api.hyperliquid.xyz") {
    const b = JSON.parse(String(init?.body));
    if (b.type === "candleSnapshot") {
      const { coin, interval, startTime, endTime } = b.req;
      if (interval === "1h") return ok(Array.from({ length: 169 }, (_, i) => ({ t: i, c: String(BASE[coin] * (1 + 0.004 * Math.sin(i))) })));
      const out = [];
      for (let t = Math.ceil(startTime / M) * M; t <= Math.min(endTime, NOW); t += M) {
        const x = bar(coin, t);
        out.push({ t, T: t + M - 1, o: String(x.o), h: String(x.h), l: String(x.l), c: String(x.c), v: "1", n: 10 });
      }
      return ok(out);
    }
    if (b.type === "metaAndAssetCtxs") {
      return ok([{ universe: ["BTC", "ETH", "SOL"].map((name) => ({ name, szDecimals: 5, maxLeverage: 20 })) }, ["BTC", "ETH", "SOL"].map((c) => ({ funding: "0.0000125", openInterest: "100", premium: "0", oraclePx: String(BASE[c]), markPx: String(BASE[c]), midPx: String(BASE[c]) }))]);
    }
    if (b.type === "predictedFundings") return ok(["BTC", "ETH", "SOL"].map((c) => [c, [["HlPerp", { fundingRate: "0.0000125", fundingIntervalHours: 1 }], ["BinPerp", { fundingRate: "0.0001", fundingIntervalHours: 8 }]]]));
    if (b.type === "l2Book") {
      const p = BASE[b.coin];
      return ok({ levels: [[{ px: String(p - 1), sz: "5" }, { px: String(p - 2), sz: "5" }], [{ px: String(p + 1), sz: "5" }, { px: String(p + 2), sz: "5" }]] });
    }
    if (b.type === "meta") return ok({ universe: [] });
  }
  if (url.host === "www.deribit.com") return ok({ result: url.pathname.endsWith("get_index_price") ? { index_price: 81150 } : url.pathname.endsWith("get_volatility_index_data") ? { data: [[0, 37, 37, 37, 37.3]] } : [] });
  if (url.host === "gamma-api.polymarket.com") return ok(GAMMA[url.searchParams.get("slug") ?? ""] ?? []);
  if (url.host === "data-api.binance.vision") return ok({ bidPrice: "81240", askPrice: "81240.01" });
  if (url.host === "www.okx.com") return ok({ data: [{ details: [] }] });
  if (url.host === "community-api.coinmetrics.io") return ok({ data: [] });
  if (url.host === "stablecoins.llama.fi") return ok([]);
  if (url.host === "fapi.binance.com") return new Response("restricted", { status: 451 });
  return new Response("not found", { status: 404 });
}
const GAMMA: Record<string, unknown[]> = {};

function world() {
  const db = new FakeDb();
  calls = [];
  for (const c of Object.keys(BARS)) BARS[c] = {};
  const beats: string[] = [];
  const h = {
    secret: TOKEN, db, cronSecret: CRON, now: () => NOW, region: "eu-west-2", fetchImpl: fakeFetch as typeof fetch,
    deps: (t: number) => makeDeps(db, t, fakeFetch as typeof fetch), beat: (k: string) => { beats.push(k); return Promise.resolve(true); },
    report: () => Promise.resolve(), owner: () => "o",
  };
  const call = (action: string, o: { method?: string; body?: unknown; bearer?: string; query?: string } = {}) => handle(new Request(`https://x/functions/v1/cxbot?${action ? `action=${action}` : ""}${o.query ?? ""}`, {
    method: o.method ?? (o.body === undefined ? "GET" : "POST"), headers: { Authorization: `Bearer ${o.bearer ?? TOKEN}`, "Content-Type": "application/json" },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  }), h);
  const tick = async (at: number) => { NOW = at; const r = await call("tick", { method: "POST", bearer: CRON }); return { status: r.status, body: await r.json() }; };
  return { db, call, tick, beats };
}

Deno.test("the bearer comes first: no token, a wrong one, a short secret; the minute and reach take the scheduler's", async () => {
  const w = world();
  assertEquals((await w.call("account", { bearer: "nope" })).status, 401);
  assertEquals((await w.call("tick", { method: "POST" })).status, 401);
  assertEquals((await w.call("reach", { method: "POST" })).status, 401);
  assertEquals((await handle(new Request("https://x/functions/v1/cxbot"), { ...w, secret: "short", db: w.db, deps: (t) => makeDeps(w.db, t, fakeFetch as typeof fetch) })).status, 503);
  assertEquals((await w.call("nothing")).status, 404);
  assertEquals((await w.call("order")).status, 405);
});

Deno.test("the guard refuses every host and method off the list before fetch; the reader holds no key", async () => {
  assertEquals(assertCxbotAllowed("https://api.hyperliquid.xyz/info", "POST").host, "api.hyperliquid.xyz");
  for (const [u, m] of [["https://api.hyperliquid.xyz/exchange", "POST"], ["https://api.hyperliquid.xyz/info", "GET"], ["https://fapi.binance.com/fapi/v1/order", "POST"], ["https://evil.example/x", "GET"], ["http://www.okx.com/api/v5/public/time", "GET"], ["https://www.okx.com/api/v5/trade/order", "GET"]]) {
    let threw = false;
    try { assertCxbotAllowed(u, m); } catch (e) { threw = e instanceof CxbotRefused; }
    assert(threw, `${m} ${u}`);
  }
  let fetched = 0;
  const r = makeReader(() => { fetched++; return Promise.resolve(ok({})); });
  await assertRejects(() => r.get("https://www.okx.com/api/v5/trade/order"));
  assertEquals(fetched, 0);
});

Deno.test("the minute in dry-run: its beat first, the tape and the context recorded, no question issued, an order answered with its fill and nothing booked", async () => {
  const w = world();
  const r = await w.tick(Date.parse("2026-11-04T07:50:30Z"));
  assertEquals(r.status, 200);
  assertEquals(w.beats, ["cxbot?action=tick"]);
  assertEquals(w.db.t.cxbot_tape.filter((x) => x.coin === "BTC" && x.c !== undefined).length, 360); // six hours of minutes
  assert(w.db.t.cxbot_tape.some((x) => x.coin === "BTC" && x.bid === 81199 && x.t === "2026-11-04T07:50:00.000Z"));
  assertEquals(new Set(w.db.t.cxbot_ctx.map((x) => x.kind)), new Set(["deribit", "polymarket", "spot", "vol", "liquidations", "flows", "stablecoins"]));
  assertEquals(w.db.t.cxbot_questions.length, 0);
  // A second run in the minute writes the same rows.
  await w.tick(Date.parse("2026-11-04T07:50:40Z"));
  assertEquals(w.db.t.cxbot_tape.filter((x) => x.coin === "BTC").length, 361);
  const o = await w.call("order", { body: { decision: dec(), entry_type: "market" } });
  const b = await o.json();
  assertEquals([o.status, b.sent, b.state], [200, false, "dry_run"]);
  assertEquals(b.would_fill, 81201 + 1);
  assertEquals(w.db.t.cxbot_positions.length, 0);
});

const dec = (o: Record<string, unknown> = {}) => ({
  id: `d-${Math.random().toString(36).slice(2, 10)}`, ts: iso(NOW), action: "open", category: "N", coin: "BTC", direction: "long", size: 0.0054,
  entry: 81240, stop: 79580, limit: 84450, p: 0.47, sources: ["https://example.com/a"], reason: "a reason", invalidation: "a level", ...o,
});

Deno.test("paper: the six assigned brackets at 08:00, answers before the deadline only, the start at the deadline's open, resolution on the tape", async () => {
  const w = world();
  await w.tick(Date.parse("2026-11-04T07:58:30Z"));
  w.db.t.cxbot_config[0].mode = "paper";
  w.db.t.cxbot_config[0].started_at = "2026-11-04T07:59:00.000Z";
  await w.tick(Date.parse("2026-11-04T08:00:30Z"));
  const qs = w.db.t.cxbot_questions;
  assertEquals(qs.map((q) => q.id).sort(), ["BTC", "ETH", "SOL"].flatMap((c) => [`A-2026-11-04T08:00-${c}-long`, `A-2026-11-04T08:00-${c}-short`]).sort());
  const btc = qs.find((q) => q.id === "A-2026-11-04T08:00-BTC-long")!;
  assertEquals(btc.deadline, "2026-11-04T08:20:00.000Z");
  assertAlmostEquals(Number(btc.m), 1 / 3, 1e-4);
  const sd = sd24Of(Array.from({ length: 169 }, (_, i) => 81200 * (1 + 0.004 * Math.sin(i))))!;
  assertAlmostEquals(Number(btc.stop_frac), Math.max(0.01, sd), 1e-4);
  const view = await (await w.call("questions")).json();
  assertEquals(view.questions.length, 6);
  const f1 = await w.call("forecast", { body: { answers: [{ question_id: btc.id, p: 0.36, reason: "slightly above m" }] } });
  assertEquals(f1.status, 200);
  assertEquals((await (await w.call("forecast", { body: { answers: [{ question_id: btc.id, p: 0.4, reason: "again" }] } })).json()).refusals[0].rule, "forecast_duplicate");
  NOW = Date.parse("2026-11-04T08:20:10Z");
  assertEquals((await (await w.call("forecast", { body: { answers: [{ question_id: "A-2026-11-04T08:00-ETH-long", p: 0.3, reason: "late" }] } })).json()).refusals[0].rule, "forecast_window");
  // The deadline's minute opens at 81,300: the bracket starts there, its distances kept.
  BARS.BTC[Date.parse("2026-11-04T08:20:00Z")] = { o: 81300, h: 81300, l: 81300, c: 81300 };
  await w.tick(Date.parse("2026-11-04T08:21:30Z"));
  const started = w.db.t.cxbot_questions.find((q) => q.id === btc.id)!;
  assertEquals([started.state, started.entry, started.start_at], ["scoring", 81300, "2026-11-04T08:20:00.000Z"]);
  assertAlmostEquals(Number(started.limit_px), 81300 * (1 + 2 * Number(btc.stop_frac)), 0.01);
  // An hour later a minute trades through the long's limit (and so the short's stop): 1 and 0.
  const up = Date.parse("2026-11-04T09:30:00Z");
  BARS.BTC[up] = { o: 81300, h: Number(started.limit_px) + 1, l: 81300, c: 81300 };
  await w.tick(Date.parse("2026-11-04T09:31:30Z"));
  const res = Object.fromEntries(w.db.t.cxbot_questions.filter((q) => q.coin === "BTC").map((q) => [q.direction, [q.state, q.y, q.how]]));
  assertEquals(res, { long: ["resolved", 1, "limit"], short: ["resolved", 0, "stop"] });
});

Deno.test("paper: a market open fills through the book; the stop fills at the worse of its level less 5 bps and the next open; fees count", async () => {
  const w = world();
  await w.tick(Date.parse("2026-11-04T08:58:30Z"));
  w.db.t.cxbot_config[0].mode = "paper";
  w.db.t.cxbot_config[0].started_at = "2026-11-04T08:59:00.000Z";
  await w.tick(Date.parse("2026-11-04T08:59:30Z"));
  NOW = Date.parse("2026-11-04T09:00:30Z");
  const d = dec();
  const r = await w.call("order", { body: { decision: d, entry_type: "market" } });
  const b = await r.json();
  assertEquals([r.status, b.state, b.fill_price], [200, "filled", 81202]);
  assertEquals((await (await w.call("order", { body: { decision: d, entry_type: "market" } })).json()).duplicate, true);
  // A second open in BTC is refused (one per coin).
  const again = await (await w.call("order", { body: { decision: dec(), entry_type: "market" } })).json();
  assert(again.refusals.some((x: { rule: string }) => x.rule === "one_per_coin"), JSON.stringify(again));
  const pos = w.db.t.cxbot_positions[0];
  assertEquals([pos.state, pos.leverage, pos.entry], ["open", 3, 81202]);
  // Three trading requests a minute at most: the next minute, a stop amended wider is refused; tighter is taken.
  assertEquals((await (await w.call("cancel_all", { method: "POST", body: {} })).json()).refusals[0].rule, "orders_minute");
  NOW += M;
  const am = (stop: number) => w.call("amend", { body: { decision: { id: `a-${stop}`, ts: iso(NOW), action: "amend", category: "C", position_id: pos.id, stop, reason: "r" } } });
  assertEquals((await (await am(79000)).json()).refusals[0].rule, "stop_wider");
  assertEquals((await am(79600)).status, 200);
  // Minute 09:02 trades down to 79,500; 09:03 opens at 79,400: the stop at 79,600 fills at min(79,600 × 0.9995, 79,400).
  BARS.BTC[Date.parse("2026-11-04T09:02:00Z")] = { o: 81200, h: 81200, l: 79500, c: 79500 };
  BARS.BTC[Date.parse("2026-11-04T09:03:00Z")] = { o: 79400, h: 79450, l: 79400, c: 79450 };
  await w.tick(Date.parse("2026-11-04T09:05:30Z"));
  const closed = w.db.t.cxbot_positions[0];
  assertEquals([closed.state, closed.close_how, closed.close_price], ["closed", "stop", stopFill("long", 79600, 79400)]);
  const fees = 0.0054 * 81202 * 0.00045 + 0.0054 * 79400 * 0.00045;
  assertAlmostEquals(Number(closed.pnl_usd), (79400 - 81202) * 0.0054 - fees, 1e-3);
  const acc = await (await w.call("account")).json();
  assertAlmostEquals(acc.budget.equity_usd, Math.round((1000 + Number(closed.pnl_usd)) * 100) / 100, 0.02);
  assertEquals(acc.positions, []);
});

Deno.test("paper: a resting limit fills only when a later minute trades strictly through it, and is cancelled by its id", async () => {
  const w = world();
  await w.tick(Date.parse("2026-11-04T09:58:30Z"));
  w.db.t.cxbot_config[0].mode = "paper";
  w.db.t.cxbot_config[0].started_at = "2026-11-04T09:59:00.000Z";
  await w.tick(Date.parse("2026-11-04T09:59:30Z"));
  NOW = Date.parse("2026-11-04T10:00:30Z");
  const r = await w.call("order", { body: { decision: dec({ entry: 81000, stop: 79400, limit: 84200, size: 0.0055 }), entry_type: "limit", good_till: iso(NOW + 6 * H) } });
  const b = await r.json();
  assertEquals([r.status, b.state], [200, "resting"], JSON.stringify(b));
  BARS.BTC[Date.parse("2026-11-04T10:02:00Z")] = { o: 81100, h: 81100, l: 81000, c: 81050 }; // touches, not through
  await w.tick(Date.parse("2026-11-04T10:05:30Z"));
  assertEquals(w.db.t.cxbot_orders[0].state, "resting");
  const c = await w.call("cancel", { body: { order_id: b.order_id, decision: { id: "c-1", ts: iso(NOW), action: "cancel", category: "C", reason: "gone" } } });
  assertEquals(c.status, 200);
  assertEquals(w.db.t.cxbot_orders[0].state, "cancelled");
});

Deno.test("the journal: a shadow bracket stored with its m and limit, a resend a duplicate; the quote's numbers", async () => {
  const w = world();
  await w.tick(Date.parse("2026-11-04T07:50:30Z"));
  const body = { decisions: [{ id: "s-1", ts: iso(NOW), action: "no_action", category: "N", coin: "SOL", direction: "long", entry: 182.5, stop: 176.9, limit: 194, p: 0.38, reason: "considered" }] };
  const r = await (await w.call("", { body })).json();
  assertEquals(r.stored.decisions, 1);
  assertEquals([w.db.t.cxbot_decisions[0].limit_px, w.db.t.cxbot_decisions[0].m_base], [194, Math.round((5.6 / 17.1) * 1e4) / 1e4]);
  assertEquals((await (await w.call("", { body })).json()).duplicates, 1);
  const q = await (await w.call("quote", { query: "&coin=BTC&direction=long&entry=81200&stop=79176&limit=85260&p=0.47" })).json();
  assertAlmostEquals(q.m, 1 / 3, 1e-3);
  assertEquals(q.leverage, 3);
  assert(q.rv.p_limit_first > 0 && q.rv.p_stop_first > q.rv.p_limit_first);
  assert(q.size_max > 0);
  assertEquals((await w.call("quote", { query: "&coin=DOGE&direction=long&entry=1&stop=0.9&limit=1.2" })).status, 422);
});

Deno.test("reach: one public read of each target from this region, stored; the scheduler's bearer only", async () => {
  const w = world();
  const r = await w.call("reach", { method: "POST", bearer: CRON });
  const b = await r.json();
  assertEquals(b.region, "eu-west-2");
  const by = Object.fromEntries(b.reach.map((x: { target: string; status: number }) => [x.target, x.status]));
  assertEquals([by.hyperliquid, by.binance_futures, by.okx], [200, 451, 200]);
  assertEquals(w.db.t.cxbot_reach.length, b.reach.length);
  assert(w.db.t.cxbot_reach.every((x) => x.region === "eu-west-2"));
});

Deno.test("the rules' constants the prompt states", () => {
  assertEquals([CXBOT_RULES.maxOrdersDay, CXBOT_RULES.maxOpen, CXBOT_RULES.edgeMin, CXBOT_RULES.maxLeverage], [30, 3, 0.08, 3]);
});
