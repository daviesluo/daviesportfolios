// Pins IGBOT's server end to end: the bearer before anything; the demo-only client's guard; a dry-run open checked,
// journalled and never sent; a demo open sent only after its order row and deal reference are written, booked from IG's
// confirmation; refusals that store nothing; resends that send nothing twice; the lease; closes, amends and cancels on the
// bot's own book; and the minute's sync (its beat first, closes read from the history, the five-day limit, the kill
// switch, the snapshot). The database double holds 0157's columns (`schema.ts`): a write naming a column the table does not
// have is refused, as PostgREST refuses it.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Db } from "../agents/db.ts";
import { assertIgbotAllowed, IGBOT_DEMO_BASE, IgbotClient, igbotCreds, IgbotRefused, type IgbotSession } from "./client.ts";
import {
  accountOf, barsOf, closedPnl, closeOf, confirmOf, type ExecDeps, type IgApi, IGBOT_MISSING_GRACE_MS, type IgSend, marketOf, positionsOf, premiumOf, workingOf,
} from "./exec.ts";
import { IGBOT_IG_CALLS_PER_MINUTE, rateVerdict } from "./ingest.ts";
import { handle } from "./index.ts";
import { IGBOT_TABLES } from "./schema.ts";

const T0 = Date.parse("2026-11-03T15:00:00Z");
const TOKEN = "t".repeat(40), CRON = "c".repeat(40);
const US500 = "IX.D.SPTRD.DAILY.IP";

// ── a PostgREST double: the filters this function sends, and 0157's columns ─────────────────────────────────────────

type Row = Record<string, unknown>;
class FakeDb implements Db {
  t: Record<string, Row[]> = {};
  seq: Record<string, number> = {};
  log: string[] = [];
  constructor() {
    for (const k of Object.keys(IGBOT_TABLES)) this.t[k] = [];
    this.t.igbot_config = [{ id: 1, environment: "demo", mode: "dry_run", armed_at: null, started_at: null, budget_gbp: 1000, day_stop_gbp: 20, total_stop_gbp: 100, max_orders_day: 40 }];
    this.t.igbot_exec_state = [{ id: 1, state: {}, lease_until: null, lease_owner: null }];
    this.t.igbot_instruments = [{ epic: US500, name: "US 500", kind: "index", enabled: true }, { epic: "CS.D.AUDUSD.TODAY.IP", name: "AUD/USD", kind: "fx", enabled: true }];
    this.t.agent_risk = [{ id: 1, global_pause: false }];
  }
  private check(table: string, row: Row) {
    const cols = table === "agent_risk" ? ["id", "global_pause"] : IGBOT_TABLES[table]?.columns;
    if (!cols) throw new Error(`no table ${table}`);
    for (const k of Object.keys(row)) if (!cols.includes(k)) throw new Error(`${table}: no column ${k}`);
  }
  private where(table: string, query: string): Row[] {
    let rows = this.t[table] ?? [];
    for (const part of query.split("&")) {
      const i = part.indexOf("="), k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
      if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
      if (k === "or") {
        const alts = v.slice(1, -1).split(",").map((x) => { const [c, op, ...rest] = x.split("."); return [c, op, rest.join(".")]; });
        rows = rows.filter((r) => alts.some(([c, op, val]) => test(r[c], op, val)));
        continue;
      }
      const dot = v.indexOf("."), op = v.slice(0, dot), val = v.slice(dot + 1);
      rows = rows.filter((r) => test(r[k], op, val));
    }
    const ord = /(?:^|&)order=([a-z_]+)\.(asc|desc)/.exec(query);
    if (ord) rows = [...rows].sort((a, b) => (String(a[ord[1]]) < String(b[ord[1]]) ? -1 : String(a[ord[1]]) > String(b[ord[1]]) ? 1 : 0) * (ord[2] === "asc" ? 1 : -1));
    const lim = /(?:^|&)limit=(\d+)/.exec(query);
    return lim ? rows.slice(0, Number(lim[1])) : rows;
  }
  select<T>(table: string, query: string): Promise<T[]> { return Promise.resolve(this.where(table, query).map((r) => ({ ...r })) as T[]); }
  selectAll<T>(table: string, query: string): Promise<T[]> { return this.select<T>(table, query); }
  insert<T>(table: string, rows: unknown): Promise<T[]> {
    const list = (Array.isArray(rows) ? rows : [rows]) as Row[];
    for (const r of list) this.check(table, r);
    const out: Row[] = [];
    for (const r of list) {
      const key = IGBOT_TABLES[table].key;
      const row: Row = { ...r };
      if (key === "id" && row.id === undefined) row.id = (this.seq[table] = (this.seq[table] ?? 0) + 1);
      if (table === "igbot_requests" && !row.at) row.at = new Date(T0).toISOString();
      if (this.t[table].some((x) => x[key] === row[key])) return Promise.reject(new Error(`${table}: duplicate key ${row[key]}`));
      if (table === "igbot_orders" && this.t[table].some((x) => x.decision_id === row.decision_id || x.deal_reference === row.deal_reference)) return Promise.reject(new Error("unique"));
      if (table === "igbot_orders" && !this.t.igbot_decisions.some((d) => d.id === row.decision_id)) return Promise.reject(new Error("igbot_orders: decision_id references no decision"));
      this.t[table].push(row);
      this.log.push(`insert ${table}`);
      out.push({ ...row });
    }
    return Promise.resolve(out as T[]);
  }
  upsert(table: string, rows: unknown, onConflict: string): Promise<void> {
    for (const r of rows as Row[]) {
      this.check(table, r);
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
    case "gt": return s !== null && s > val;
    case "gte": return s !== null && s >= val;
    case "lt": return s !== null && s < val;
    case "in": return val.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(s ?? "");
    case "like": return s !== null && new RegExp(`^${val.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(s);
    default: throw new Error(`filter op ${op}`);
  }
}

// ── an IG double: the demo account, its lists, and every call counted ───────────────────────────────────────────────

const marketRaw = (epic = US500, o: Row = {}) => ({
  instrument: { epic, name: "US 500", type: "INDICES", expiry: "DFB", currencies: [{ code: "GBP", isDefault: true }], limitedRiskPremium: { value: 0.6, unit: "POINTS" } },
  dealingRules: { minDealSize: { unit: "POINTS", value: 0.04 }, minControlledRiskStopDistance: { unit: "POINTS", value: 4 } },
  snapshot: { marketStatus: "TRADEABLE", bid: 6800, offer: 6800.4, updateTime: "15:00:00", ...o },
});
class FakeIg implements IgApi {
  calls: string[] = [];
  equity = 10000;
  pos: Row[] = [];
  wo: Row[] = [];
  confirms = new Map<string, Row>();
  hist: Row[] = [];
  /** What the database held when each send reached IG (the order row must already be there). */
  seenRows: number[] = [];
  failSend = false;
  /** IG refuses the next deals (`dealStatus` REJECTED) while set. */
  reject = false;
  /** Called while the open path reads the market (to change the world mid-request). */
  onMarket: (() => void) | null = null;
  constructor(public db: FakeDb) {}
  accounts() { this.calls.push("accounts"); return Promise.resolve({ accounts: [{ accountId: "ZDEMO1", balance: { balance: this.equity, profitLoss: 0, deposit: 0, available: this.equity } }] }); }
  market(epic: string) { this.calls.push(`market ${epic}`); this.onMarket?.(); return Promise.resolve(marketRaw(epic)); }
  markets(epics: string[]) { this.calls.push("markets"); return Promise.resolve({ marketDetails: epics.map((e) => marketRaw(e)) }); }
  positions() { this.calls.push("positions"); return Promise.resolve({ positions: this.pos }); }
  working() { this.calls.push("list-working"); return Promise.resolve({ workingOrders: this.wo }); }
  confirm(ref: string) { this.calls.push(`confirm ${ref}`); const c = this.confirms.get(ref); return c ? Promise.resolve(c) : Promise.reject(new Error("404 deal-not-found")); }
  /** The history IG gives for a query by deal id (`hist`) and for one without (`histAll`, the whole account since). */
  histAll: Row[] | null = null;
  activity(q: { dealId?: string }) {
    this.calls.push(`activity ${q.dealId ?? "*"}`);
    return Promise.resolve({ activities: q.dealId || this.histAll === null ? this.hist : this.histAll });
  }
  bars: Record<string, Row[]> = {};
  prices(epic: string, max: number) { this.calls.push(`prices ${epic} ${max}`); return Promise.resolve({ prices: this.bars[epic] ?? [] }); }
  private send(kind: string, body: Row): Promise<IgSend> {
    this.calls.push(kind);
    this.seenRows.push(this.db.t.igbot_orders.filter((o) => o.deal_reference === body.dealReference).length);
    if (this.failSend) return Promise.reject(new Error("connection reset"));
    const ref = String(body.dealReference ?? `IG-${this.calls.length}`);
    if (this.reject) {
      this.confirms.set(ref, { dealStatus: "REJECTED", reason: "MARKET_CLOSED_WITH_EDITS", dealId: null });
      return Promise.resolve({ status: 200, dealReference: ref, error: null });
    }
    if (kind === "open") {
      this.confirms.set(ref, { dealStatus: "ACCEPTED", reason: "SUCCESS", dealId: "DIAAAA1", level: 6800.6, size: body.size, status: "OPEN" });
      this.pos.push({ position: { dealId: "DIAAAA1", dealReference: ref, size: body.size, direction: body.direction, level: 6800.6, stopLevel: body.stopLevel, limitLevel: body.limitLevel, controlledRisk: true, limitedRiskPremium: { value: 0.6 }, createdDateUTC: "2026-11-03T15:00:00" }, market: { epic: body.epic, bid: 6800, offer: 6800.4 } });
    }
    if (kind === "close") {
      this.lastClose = body;
      this.confirms.set(ref, { dealStatus: "ACCEPTED", reason: "SUCCESS", dealId: "DIAAAA9", level: 6820, size: body.size, status: "CLOSED", profit: 4.66 });
      this.pos = this.pos.filter((p) => (p.position as Row).dealId !== body.dealId);
    }
    return Promise.resolve({ status: 200, dealReference: ref, error: null });
  }
  open(b: Row) { return this.send("open", b); }
  close(b: Row) { return this.send("close", b); }
  amend(dealId: string, b: Row) { this.calls.push(`amend ${dealId} ${JSON.stringify(b)}`); return Promise.resolve({ status: 200, dealReference: "AMD1", error: null }); }
  /** The last close body IG received, as sent. */
  lastClose: Row | null = null;
  placeWorking(b: Row) { return this.send("working", b); }
  deleteWorking(dealId: string) { this.calls.push(`delete ${dealId}`); this.wo = this.wo.filter((w) => (w.workingOrderData as Row).dealId !== dealId); return Promise.resolve({ status: 200, dealReference: "DEL1", error: null }); }
}

const sends = (ig: FakeIg) => ig.calls.filter((c) => /^(open|close|working|amend|delete)/.test(c));
function world(o: { mode?: "dry_run" | "demo"; ig?: boolean } = {}) {
  const db = new FakeDb(), ig = new FakeIg(db);
  if (o.mode === "demo") Object.assign(db.t.igbot_config[0], { mode: "demo", armed_at: "2026-11-01T00:00:00Z", started_at: "2026-11-01T00:00:00Z" });
  const beats: string[] = [];
  let now = T0, refs = 0;
  const exec = (t: number): ExecDeps => ({
    db, now: t, ig: o.ig === false ? null : ig, credsProblem: o.ig === false ? "IG's demo secrets are not set: IGBOT_DEMO_API_KEY" : null, accountId: "ZDEMO1", rand: () => `r${++refs}`,
    sleep: () => Promise.resolve(), clock: () => now, igCalls: ((base) => () => ig.calls.length - base)(ig.calls.length),
  });
  const call = async (method: string, action: string, body?: unknown, auth = `Bearer ${TOKEN}`) => {
    const res = await handle(new Request(`https://x.test/functions/v1/igbot${action ? `?action=${action}` : ""}`, {
      method, headers: { Authorization: auth, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }), { secret: TOKEN, db, now: () => now, cronSecret: CRON, exec, beat: (k) => { beats.push(k); return Promise.resolve(true); }, report: (_k, o) => { if (Deno.env.get("IGBOT_TEST_DEBUG")) console.error(o?.message); return Promise.resolve(); }, owner: () => "o1" });
    return { status: res.status, body: await res.json() };
  };
  return { db, ig, beats, call, at: (t: number) => { now = t; } };
}
const OPEN = {
  id: "2026-11-03T15:00Z-open-1", ts: "2026-11-03T15:00:00Z", action: "open", category: "N", epic: US500, direction: "BUY", size: 0.24, level: 6801,
  stop_level: 6761, limit_level: 6881, p_target: 0.5, sources: ["https://www.federalreserve.gov/newsevents.htm"], reason: "A test thesis.", invalidation: "Price closes under 6780.",
};

Deno.test("without the bearer secret everything is refused before anything is read; a wrong bearer leaves no row", async () => {
  const w = world();
  const r0 = await handle(new Request("https://x.test/igbot", { method: "GET" }), { secret: "", db: w.db, exec: () => { throw new Error("read"); } });
  assertEquals(r0.status, 503);
  const r = await w.call("POST", "order", { decision: OPEN }, "Bearer " + "x".repeat(40));
  assertEquals(r.status, 401);
  assertEquals(w.db.t.igbot_requests.length + w.db.t.igbot_decisions.length + w.db.t.igbot_orders.length, 0);
  assertEquals(w.ig.calls, []);
});

Deno.test("dry-run: an open is checked against IG's market, journalled with its m, and answered with what would be sent; nothing is sent", async () => {
  const w = world();
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals([r.body.mode, r.body.sent], ["dry_run", false]);
  const ws = r.body.would_send;
  assertEquals([ws.orderType, ws.timeInForce, ws.guaranteedStop, ws.forceOpen, ws.expiry, ws.currencyCode, ws.level, ws.stopLevel, ws.limitLevel], ["LIMIT", "FILL_OR_KILL", true, true, "DFB", "GBP", 6801, 6761, 6881]);
  assertEquals(sends(w.ig), []);
  assertEquals(w.db.t.igbot_decisions[0].m_base, 0.3333);
  assertEquals(w.db.t.igbot_orders[0].state, "dry_run");
  // A resend of the same decision answers the same order and sends nothing.
  const again = await w.call("POST", "order", { decision: OPEN });
  assertEquals([again.body.duplicate, w.db.t.igbot_orders.length], [true, 1]);
});

Deno.test("a refused open names every rule and stores no decision and no order", async () => {
  const w = world();
  const r = await w.call("POST", "order", { decision: { ...OPEN, p_target: 0.38, size: 0.5, epic: "IX.D.NIKKEI.DAILY.IP" } });
  assertEquals(r.status, 422);
  assertEquals(r.body.refusals.map((x: { rule: string }) => x.rule).sort(), ["edge", "instrument", "risk"]);
  assertEquals([w.db.t.igbot_decisions.length, w.db.t.igbot_orders.length], [0, 0]);
  const bad = await w.call("POST", "order", { decision: { ...OPEN, stop_level: undefined, invalidation: undefined, sources: [] }, extra: 1 });
  assertEquals(bad.status, 422);
  assertEquals(bad.body.errors.length >= 3, true);
});

Deno.test("demo: the order row and its deal reference are written before the send; IG's confirmation books the position", async () => {
  const w = world({ mode: "demo" });
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals([r.body.mode, r.body.sent, r.body.order.state, r.body.order.deal_id], ["demo", true, "accepted", "DIAAAA1"]);
  assertEquals(w.ig.seenRows, [1]);
  const p = w.db.t.igbot_positions[0];
  assertEquals([p.deal_id, p.open_level, p.state, p.guaranteed, p.decision_id], ["DIAAAA1", 6800.6, "open", true, OPEN.id]);
  // The start's and the day's equity were read on the arm.
  assertEquals((w.db.t.igbot_exec_state[0].state as Row).startEquity, { at: new Date(T0).toISOString(), equityGbp: 10000 });
  // The lease was given back.
  assertEquals(w.db.t.igbot_exec_state[0].lease_until, null);
  // A second open on the same market is refused (one per market), and nothing more is sent.
  const two = await w.call("POST", "order", { decision: { ...OPEN, id: "o-2" } });
  assertEquals(two.body.refusals.map((x: { rule: string }) => x.rule), ["one_per_market"]);
  assertEquals(sends(w.ig), ["open"]);
});

Deno.test("demo: a send with no answer stays unknown, and the minute's sync settles it from IG's confirmation", async () => {
  const w = world({ mode: "demo" });
  w.ig.failSend = true;
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals(r.body.order.state, "unknown");
  const ref = String(w.db.t.igbot_orders[0].deal_reference);
  w.ig.confirms.set(ref, { dealStatus: "ACCEPTED", reason: "SUCCESS", dealId: "DIAAAA7", level: 6800.6, size: 0.24 });
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(s.status, 200);
  assertEquals([w.db.t.igbot_orders[0].state, w.db.t.igbot_orders[0].deal_id, s.body.confirmed], ["accepted", "DIAAAA7", 1]);
});

Deno.test("the lease: a request while another decides on the book is answered busy and sends nothing", async () => {
  const w = world({ mode: "demo" });
  Object.assign(w.db.t.igbot_exec_state[0], { lease_until: new Date(T0 + 10e3).toISOString(), lease_owner: "other" });
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals([r.status, r.body.error], [409, "busy"]);
  assertEquals(sends(w.ig), []);
});

Deno.test("the stops: past the day's loss no open, but a close still goes", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.ig.equity = 9975; // −£25 from the start and the day's open: the day stop (−£20)
  const r = await w.call("POST", "order", { decision: { ...OPEN, id: "o-3", epic: "CS.D.AUDUSD.TODAY.IP" } });
  assert(r.body.refusals.some((x: { rule: string }) => x.rule === "day_stop"));
  const c = await w.call("POST", "close", { decision: { id: "c-1", ts: "2026-11-03T15:00:00Z", action: "close", deal_id: "DIAAAA1", reason: "Thesis broken." } });
  assertEquals([c.status, c.body.order.state], [200, "accepted"]);
  assertEquals(sends(w.ig), ["open", "close"]);
  const p = w.db.t.igbot_positions[0];
  assertEquals([p.state, p.close_level, p.close_how, p.pnl_gbp], ["closed", 6820, "bot", 4.66]);
});

Deno.test("close and amend touch only what the bot holds; an amend sends both levels and only tightens", async () => {
  const w = world({ mode: "demo" });
  const nope = await w.call("POST", "close", { decision: { id: "c-0", ts: "2026-11-03T15:00:00Z", action: "close", deal_id: "NOTMINE", reason: "x" } });
  assertEquals(nope.body.refusals.map((x: { rule: string }) => x.rule), ["not_held"]);
  await w.call("POST", "order", { decision: OPEN });
  const wide = await w.call("POST", "amend", { decision: { id: "a-0", ts: "2026-11-03T15:00:00Z", action: "amend", deal_id: "DIAAAA1", stop_level: 6700, reason: "x" } });
  assertEquals(wide.body.refusals.map((x: { rule: string }) => x.rule), ["stop_wider"]);
  const ok = await w.call("POST", "amend", { decision: { id: "a-1", ts: "2026-11-03T15:00:00Z", action: "amend", deal_id: "DIAAAA1", stop_level: 6780, reason: "Lock in." } });
  assertEquals(ok.status, 200, JSON.stringify(ok.body));
  assertEquals(w.ig.calls.find((c) => c.startsWith("amend")), 'amend DIAAAA1 {"stopLevel":6780,"limitLevel":6881,"guaranteedStop":true,"trailingStop":false}');
});

Deno.test("the journal takes no_action rows (a shadow forecast keeps its m), cycles and daily rows; an open there is refused", async () => {
  const w = world();
  const shadow = { id: "s-1", ts: "2026-11-03T15:00:00Z", action: "no_action", epic: US500, direction: "BUY", level: 6801, stop_level: 6761, limit_level: 6881, p_target: 0.45, reason: "Watching." };
  const cycle = { id: "cy-1", ts: "2026-11-03T15:00:00Z", kind: "light", equity_gbp: 1000, open_positions: 0, open_risk_gbp: 0, actions: 0 };
  const r = await w.call("POST", "", { decisions: [shadow], cycles: [cycle] });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.stored, { decisions: 1, cycles: 1, daily: 0 });
  assertEquals(w.db.t.igbot_decisions[0].m_base, 0.3333);
  const again = await w.call("POST", "", { decisions: [shadow] });
  assertEquals(again.body.duplicates, 1);
  const open = await w.call("POST", "", { decisions: [OPEN] });
  assertEquals(open.status, 422);
});

Deno.test("an action budget of four a minute: the fifth is 429", async () => {
  const w = world();
  for (let i = 0; i < 4; i++) assertEquals((await w.call("GET", "calendar")).status, 200);
  assertEquals((await w.call("GET", "calendar")).status, 429);
});

Deno.test("account and markets: the agent's view of its book and IG's quotes; without IG's secrets it says which are missing, by name", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.at(T0 + 61e3);
  const a = await w.call("GET", "account");
  assertEquals([a.body.environment, a.body.mode, a.body.budget.risk_per_trade_gbp, a.body.budget.max_total_risk_gbp, a.body.positions.length, a.body.positions[0].risk_gbp], ["demo", "demo", 10, 30, 1, 9.65]);
  const m = await w.call("GET", "markets");
  assertEquals(m.body.markets.map((x: { epic: string; min_guaranteed_stop_points: number }) => [x.epic, x.min_guaranteed_stop_points]), [["CS.D.AUDUSD.TODAY.IP", 4], [US500, 4]]);
  const n = world({ ig: false });
  const ping = await n.call("GET", "");
  assertEquals([ping.body.ig_configured, ping.body.ig_missing], [false, "IG's demo secrets are not set: IGBOT_DEMO_API_KEY"]);
});

Deno.test("sync: the scheduler's bearer, its beat first; a position IG no longer lists closed from the history with its premium", async () => {
  const w = world({ mode: "demo" });
  assertEquals((await w.call("POST", "sync")).status, 401);
  await w.call("POST", "order", { decision: OPEN });
  w.ig.pos = []; // the guaranteed stop at 6761 triggered
  w.ig.hist = [{ date: "2026-11-03T16:00:00", channel: "SYSTEM", details: { level: 6761, actions: [{ actionType: "POSITION_CLOSED", affectedDealId: "DIAAAA1" }] } }];
  w.at(T0 + 3600e3);
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(w.beats, ["igbot?action=sync"]);
  assertEquals(s.body.closed, 1);
  const p = w.db.t.igbot_positions[0];
  // 0.24 × (6761 − 6800.6) − 0.24 × 0.6 = −9.504 − 0.144 = −9.65
  assertEquals([p.state, p.close_how, p.close_level, p.pnl_gbp], ["closed", "stop", 6761, -9.65]);
  assertEquals(w.db.t.igbot_snapshots.length, 1);
});

Deno.test("sync: the server closes a position held five days, and deletes working orders while disarmed", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.at(T0 + 5 * 86400e3);
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(s.body.auto_closed, 1);
  assertEquals(w.db.t.igbot_orders.at(-1)!.kind, "auto_close");
  // Disarmed with a working order resting at IG: it is deleted by its own id.
  Object.assign(w.db.t.igbot_config[0], { mode: "dry_run", armed_at: null });
  w.ig.wo = [{ workingOrderData: { dealId: "WO1", dealReference: "IGB-x-1", epic: US500, direction: "BUY", orderSize: 0.2, orderLevel: 6750, orderType: "LIMIT", guaranteedStop: true, stopDistance: 40, limitDistance: 80 } }];
  w.at(T0 + 5 * 86400e3 + 60e3);
  const s2 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(s2.body.cancelled, 1);
  assert(w.ig.calls.includes("delete WO1"));
});

Deno.test("IG's answers read: markets, positions, working orders, confirmations, the account, a close in the history", () => {
  const m = marketOf(marketRaw())!;
  assertEquals([m.epic, m.minDealSize, m.gsPremium, m.gbp, m.minGsDistance], [US500, 0.04, 0.6, true, { unit: "POINTS", value: 4 }]);
  assertEquals(marketOf({ instrument: {} }), null);
  const p = positionsOf({ positions: [{ position: { dealId: "D1", size: 1, direction: "SELL", level: 100, stopLevel: 110, controlledRisk: true, createdDateUTC: "2026-11-03T15:00:00" }, market: { epic: US500, bid: 99, offer: 100 } }, { junk: 1 }] });
  assertEquals([p.length, p[0].createdMs, p[0].limitLevel, p[0].guaranteed], [1, T0, null, true]);
  assertEquals(workingOf({ workingOrders: [{ workingOrderData: { dealId: "W", epic: US500, direction: "BUY", orderSize: "2", orderLevel: 90, goodTillDateISO: "2026-11-03T16:00" } }] })[0].goodTillMs, T0 + 3600e3);
  assertEquals(confirmOf({ dealStatus: "REJECTED", reason: "MINIMUM_ORDER_SIZE_ERROR" })?.reason, "MINIMUM_ORDER_SIZE_ERROR");
  assertEquals(accountOf({ accounts: [{ accountId: "A", balance: { balance: 100, profitLoss: -2.5, deposit: 5, available: 90 } }] }, "A")?.equity, 97.5);
  assertEquals(accountOf({ accounts: [] }, "A"), null);
  const hist = { activities: [{ channel: "SYSTEM", details: { level: 6881, actions: [{ actionType: "POSITION_CLOSED", affectedDealId: "D1" }] } }] };
  assertEquals(closeOf(hist, { dealId: "D1", stopLevel: 6761, limitLevel: 6881 })?.how, "limit");
  assertEquals(closeOf(hist, { dealId: "D2", stopLevel: 6761, limitLevel: 6881 }), null);
  assertEquals(closedPnl({ direction: "SELL", size: 2, openLevel: 100, closeLevel: 90, guaranteed: true, premium: 1, how: "limit" }), 20);
});


// ── the 2026-10-29 audit's pins: each fails on the code as it stood before it ─────────────────────────────────────────

const CLOSE = { id: "c-1", ts: "2026-11-03T15:00:00Z", action: "close", deal_id: "DIAAAA1", reason: "Thesis broken." };

Deno.test("a close is IG's LIMIT fill-or-kill at the bid less a tolerance, carries no deal reference, and is confirmed under IG's own", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  const c = await w.call("POST", "close", { decision: CLOSE });
  assertEquals([c.status, c.body.order.state], [200, "accepted"], JSON.stringify(c.body));
  // The bid 6800 less max(3 x 0.4, 0.0005 x 6800 = 3.4) = 6796.6, down to a whole point. No `dealReference`: IG's close
  // takes none (its reference lists the close's fields), and MARKET may be refused on an account whose market-order
  // preference is off (all six markets: AVAILABLE_DEFAULT_OFF on the demo, ig_facts 3).
  assertEquals(w.ig.lastClose, { dealId: "DIAAAA1", direction: "SELL", size: 0.24, orderType: "LIMIT", level: 6796, timeInForce: "FILL_OR_KILL" });
  const row = w.db.t.igbot_orders.find((o) => o.kind === "close")!;
  assert(String(row.deal_reference).startsWith("IG-"), String(row.deal_reference));
  assertEquals(w.ig.calls.filter((x) => x.startsWith("confirm")).length, 2); // the open's, then the close's under IG's reference
});

Deno.test("an amend is confirmed under the reference IG answered with, and says what IG said", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.ig.confirms.set("AMD1", { dealStatus: "ACCEPTED", reason: "SUCCESS", dealId: "DIAAAA1" });
  const ok = await w.call("POST", "amend", { decision: { id: "a-1", ts: "2026-11-03T15:00:00Z", action: "amend", deal_id: "DIAAAA1", stop_level: 6780, reason: "Lock in." } });
  assertEquals([ok.status, ok.body.order.state, ok.body.order.deal_reference], [200, "accepted", "AMD1"]);
  assertEquals(w.ig.calls.filter((x) => x.startsWith("confirm IGB-")).length, 1); // the open's only
});

Deno.test("the five-day close waits while the market is closed and is tried again ten minutes after IG refuses it", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  const mkt = w.ig.pos[0].market as Row;
  mkt.marketStatus = "CLOSED"; // a Saturday
  w.at(T0 + 5 * 86400e3);
  const s0 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s0.body.auto_closed, sends(w.ig)], [0, ["open"]]);
  mkt.marketStatus = "TRADEABLE";
  w.ig.reject = true;
  w.at(T0 + 5 * 86400e3 + 60e3);
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(sends(w.ig), ["open", "close"]);
  assertEquals(w.db.t.igbot_orders.at(-1)!.state, "rejected");
  w.at(T0 + 5 * 86400e3 + 3 * 60e3); // within ten minutes: not again
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(sends(w.ig), ["open", "close"]);
  w.ig.reject = false;
  w.at(T0 + 5 * 86400e3 + 12 * 60e3);
  const s3 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s3.body.auto_closed, sends(w.ig)], [1, ["open", "close", "close"]]);
  assertEquals(w.db.t.igbot_positions[0].close_how, "server");
});

Deno.test("nothing the bot did not place is touched: the sync deletes, books and closes none of it, and no open is taken beside it", async () => {
  const w = world();
  w.ig.wo = [{ workingOrderData: { dealId: "MANUALWO", epic: US500, direction: "BUY", orderSize: 1, orderLevel: 6700, orderType: "LIMIT", guaranteedStop: false } }];
  w.ig.pos = [{ position: { dealId: "MANUALPOS", dealReference: "WEB123", size: 1, direction: "BUY", level: 6000, stopLevel: null, controlledRisk: false, createdDateUTC: "2026-10-01T10:00:00" }, market: { epic: US500, bid: 6800, offer: 6800.4, marketStatus: "TRADEABLE" } }];
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s.status, s.body.cancelled, s.body.opened, sends(w.ig)], [200, 0, 0, []]);
  assert(s.body.errors >= 1);
  assertEquals(w.db.t.igbot_positions.length, 0);
  const r = await w.call("POST", "order", { decision: { ...OPEN, epic: "CS.D.AUDUSD.TODAY.IP", direction: "SELL", level: 6799.5, stop_level: 6839.5, limit_level: 6719.5 } });
  assert(r.body.refusals.some((x: { rule: string }) => x.rule === "account_shared"), JSON.stringify(r.body));
  // Armed, a five-day-old foreign position is not closed by the server either.
  Object.assign(w.db.t.igbot_config[0], { mode: "demo", armed_at: "2026-11-01T00:00:00Z", started_at: "2026-11-01T00:00:00Z" });
  w.at(T0 + 60e3);
  const s2 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s2.body.auto_closed, sends(w.ig)], [0, []]);
});

Deno.test("IG's allowance is held across requests: an action that could take the minute past 24 IG requests is refused before it reads IG", async () => {
  const w = world({ mode: "demo" });
  w.db.t.igbot_requests.push({ id: 900, at: new Date(T0 - 10e3).toISOString(), status: 200, rows: 0, action: "sync", error: null, ig_calls: 20 });
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals(r.status, 429);
  assert(String(r.body.detail).includes("IG's allowance"), JSON.stringify(r.body));
  assertEquals(w.ig.calls, []);
  // A minute later the budget is free again; the sync's own requests are a row of their own.
  w.at(T0 + 61e3);
  const ok = await w.call("POST", "order", { decision: OPEN });
  assertEquals(ok.status, 200, JSON.stringify(ok.body));
  const sync = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(sync.status, 200);
  const rows = w.db.t.igbot_requests.filter((x) => x.action === "sync" && x.id !== 900);
  assertEquals(rows.length, 1);
  assert(Number(rows[0].ig_calls) >= 3);
  assert(Number(w.db.t.igbot_requests.find((x) => x.action === "order" && x.status === 200)!.ig_calls) >= 5);
  assertEquals(IGBOT_IG_CALLS_PER_MINUTE, 24);
});

Deno.test("the agent's limits count neither the sync's rows nor its own 429s", () => {
  const at = (s: number) => new Date(T0 - s * 1000).toISOString();
  const sync = Array.from({ length: 50 }, (_, i) => ({ at: at(i), status: 200, rows: 0, action: "sync" }));
  assertEquals(rateVerdict(sync, 0, T0, true).ok, true);
  assertEquals(rateVerdict(sync, 0, T0, true).requests, 0);
  const refused = Array.from({ length: 6 }, (_, i) => ({ at: at(i), status: 429, rows: 0, action: "order" }));
  assertEquals(rateVerdict(refused, 0, T0, true).ok, true);
  const done = Array.from({ length: 4 }, (_, i) => ({ at: at(i), status: 200, rows: 0, action: "account" }));
  assertEquals(rateVerdict(done, 0, T0, true).ok, false);
});

Deno.test("a position IG no longer lists stays open until its close is in the history, read by deal id and then across the account", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.ig.pos = [];
  w.ig.hist = [];
  w.ig.histAll = [];
  w.at(T0 + 60e3);
  const s1 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s1.body.closed, w.db.t.igbot_positions[0].state], [0, "open"]);
  assert(w.ig.calls.includes("activity DIAAAA1") && w.ig.calls.includes("activity *"));
  // The close arrives in the account's history (an activity of its own deal id, its action naming the position).
  w.ig.histAll = [{ date: "2026-11-03T15:01:30", channel: "SYSTEM", status: "ACCEPTED", dealId: "DIAAAA9", details: { level: 6881, actions: [{ actionType: "POSITION_CLOSED", affectedDealId: "DIAAAA1" }] } }];
  w.at(T0 + 3 * 60e3);
  const s2 = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(s2.body.closed, 1);
  const p = w.db.t.igbot_positions[0];
  // 0.24 x (6881 - 6800.6) = 19.296
  assertEquals([p.state, p.close_how, p.close_level, p.pnl_gbp], ["closed", "limit", 6881, 19.3]);
});

Deno.test("with no close in the history after fifteen minutes, a position IG no longer lists is booked closed unknown", async () => {
  const w = world({ mode: "demo" });
  await w.call("POST", "order", { decision: OPEN });
  w.ig.pos = [];
  w.ig.histAll = [];
  w.at(T0 + 60e3);
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  w.at(T0 + 60e3 + IGBOT_MISSING_GRACE_MS - 1000);
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(w.db.t.igbot_positions[0].state, "open");
  w.at(T0 + 60e3 + IGBOT_MISSING_GRACE_MS);
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals([s.body.closed, w.db.t.igbot_positions[0].state, w.db.t.igbot_positions[0].close_how], [1, "closed", "unknown"]);
});

Deno.test("the sync keeps IG's hour bars for the reading: each market once an hour, two a minute", async () => {
  const w = world();
  const bar = (h: string) => ({
    snapshotTimeUTC: h, openPrice: { bid: 6800, ask: 6800.4 }, highPrice: { bid: 6810, ask: 6810.4 }, lowPrice: { bid: 6790, ask: 6790.4 }, closePrice: { bid: 6805, ask: 6805.4 },
  });
  w.ig.bars[US500] = [bar("2026-11-03T14:00:00"), bar("2026-11-03T15:00:00")];
  w.ig.bars["CS.D.AUDUSD.TODAY.IP"] = [bar("2026-11-03T14:00:00")];
  w.at(T0 + 3 * 60e3); // 15:03
  const s = await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(s.body.bars, 2);
  assertEquals(w.ig.calls.filter((x) => x.startsWith("prices")), ["prices CS.D.AUDUSD.TODAY.IP 2", `prices ${US500} 2`]);
  assertEquals(w.db.t.igbot_bars.length, 3);
  const b = w.db.t.igbot_bars.find((x) => x.epic === US500 && x.hour === "2026-11-03T14:00:00.000Z")!;
  assertEquals([b.bid_high, b.ask_low, b.fetched_at], [6810, 6790.4, new Date(T0 + 3 * 60e3).toISOString()]);
  w.at(T0 + 4 * 60e3);
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(w.ig.calls.filter((x) => x.startsWith("prices")).length, 2);
  // The next hour, again; the forming 15:00 bar is read complete and replaces the first read.
  w.at(T0 + 63 * 60e3);
  await w.call("POST", "sync", undefined, `Bearer ${CRON}`);
  assertEquals(w.ig.calls.filter((x) => x.startsWith("prices")).length, 4);
  assertEquals(w.db.t.igbot_bars.find((x) => x.epic === US500 && x.hour === "2026-11-03T15:00:00.000Z")!.fetched_at, new Date(T0 + 63 * 60e3).toISOString());
  assertEquals(barsOf({ prices: [bar("2026-11-03T15:30:00"), { snapshotTimeUTC: "2026-11-03T14:00:00", highPrice: {} }] }, US500, T0 + 3600e3), []);
});

Deno.test("the lease is held again before a send: a request whose lease ran out while it read IG sends and journals nothing", async () => {
  const w = world({ mode: "demo" });
  w.ig.onMarket = () => Object.assign(w.db.t.igbot_exec_state[0], { lease_owner: "the-sync", lease_until: new Date(T0 + 60e3).toISOString() });
  const r = await w.call("POST", "order", { decision: OPEN });
  assertEquals([r.status, r.body.error], [409, "busy"]);
  assertEquals([sends(w.ig), w.db.t.igbot_decisions.length, w.db.t.igbot_orders.length], [[], 0, 0]);
  // The lease it lost is not given back by it.
  assertEquals(w.db.t.igbot_exec_state[0].lease_owner, "the-sync");
});

Deno.test("an open waits while an earlier order in its market has no answer from IG", async () => {
  const w = world({ mode: "demo" });
  w.ig.failSend = true;
  const r1 = await w.call("POST", "order", { decision: OPEN });
  assertEquals(r1.body.order.state, "unknown");
  w.ig.failSend = false;
  const r2 = await w.call("POST", "order", { decision: { ...OPEN, id: "o-again" } });
  assertEquals(r2.body.refusals?.map((x: { rule: string }) => x.rule), ["pending_order"]);
  assertEquals(sends(w.ig), ["open"]);
});

Deno.test("a guaranteed-stop premium IG states as a percentage is a share of the level, never read as points", () => {
  assertEquals(premiumOf({ unit: "PERCENTAGE", value: 0.01 }, 6800.4), 0.68);
  assertEquals(premiumOf({ unit: "POINTS", value: 0.6 }, 6800.4), 0.6);
  assertEquals(premiumOf({ unit: "PERCENTAGE", value: 0.01 }, null), Infinity);
  const m = marketOf({ ...marketRaw(), instrument: { ...marketRaw().instrument, limitedRiskPremium: { value: 0.01, unit: "PERCENTAGE" } } })!;
  assertEquals(m.gsPremium, 0.68);
  assertEquals([m.minLimitDistance, m.maxStopLimitDistance], [null, null]);
});

// ── the client: demo host only, its list of calls, its secrets ──────────────────────────────────────────────────────

Deno.test("the guard refuses the live host, look-alikes, every call off the list and every query off the list, before anything is sent", () => {
  const refused = [
    ["GET", "https://api.ig.com/gateway/deal/positions"], ["GET", "http://demo-api.ig.com/gateway/deal/positions"], ["GET", "https://demo-api.ig.com:8443/gateway/deal/positions"],
    ["GET", "https://demo-api.ig.com.evil.test/gateway/deal/positions"], ["GET", "https://demo-api.ig.com/gateway/other/positions"], ["GET", `${IGBOT_DEMO_BASE}/history/transactions`],
    ["GET", `${IGBOT_DEMO_BASE}/watchlists`], ["POST", `${IGBOT_DEMO_BASE}/operations/application`], ["DELETE", `${IGBOT_DEMO_BASE}/positions/otc`],
    ["POST", `${IGBOT_DEMO_BASE}/positions/otc?x=1`], ["GET", `${IGBOT_DEMO_BASE}/markets?searchTerm=x`],
    ["PUT", `${IGBOT_DEMO_BASE}/workingorders/otc/D1`], ["GET", `${IGBOT_DEMO_BASE}/accounts/preferences`],
  ];
  for (const [m, u] of refused) assertThrows(() => assertIgbotAllowed(m, u), IgbotRefused, undefined, `${m} ${u}`);
  assertEquals(assertIgbotAllowed("POST", `${IGBOT_DEMO_BASE}/positions/otc`), { path: "/positions/otc", trading: true });
  assertEquals(assertIgbotAllowed("GET", `${IGBOT_DEMO_BASE}/markets?epics=${US500}`).trading, false);
  assertEquals(assertIgbotAllowed("GET", `${IGBOT_DEMO_BASE}/history/activity?from=2026-11-03T00:00:00&dealId=D1&detailed=true&pageSize=50`).trading, false);
  assertEquals(assertIgbotAllowed("DELETE", `${IGBOT_DEMO_BASE}/workingorders/otc/DIAAA-1`).trading, true);
});

Deno.test("only the four IGBOT demo secrets are read, missing ones named, never a value", () => {
  assertEquals(igbotCreds({ IG_API_KEY_DEMO: "k", IG_DEMO_USERNAME: "u", IG_DEMO_PASSWORD: "p", IG_API_KEY_LIVE: "live" }), {
    missing: ["IGBOT_DEMO_API_KEY", "IGBOT_DEMO_USERNAME", "IGBOT_DEMO_PASSWORD", "IGBOT_DEMO_ACCOUNT_ID"],
  });
  assertEquals(igbotCreds({ IGBOT_DEMO_API_KEY: "k", IGBOT_DEMO_USERNAME: "u", IGBOT_DEMO_PASSWORD: "p", IGBOT_DEMO_ACCOUNT_ID: "Z1" }), { key: "k", username: "u", password: "p", accountId: "Z1" });
});

const CREDS = { key: "key-SECRET-123", username: "user-SECRET", password: "pass-SECRET", accountId: "ZSB1" };
function fakeIgHttp(o: { accounts: Array<{ accountId: string; accountType: string }>; current: string; echo?: boolean }) {
  const seen: string[] = [];
  const f = (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)), m = init?.method ?? "GET";
    seen.push(`${m} ${u.pathname.replace("/gateway/deal", "")}`);
    const h = new Headers({ "Content-Type": "application/json" });
    if (u.pathname.endsWith("/session") && m === "POST") {
      h.set("CST", "cst-TOKEN-1"); h.set("X-SECURITY-TOKEN", "xst-TOKEN-1");
      return Promise.resolve(new Response(JSON.stringify({ currentAccountId: o.current, accounts: o.accounts }), { status: 200, headers: h }));
    }
    if (u.pathname.endsWith("/session") && m === "PUT") { h.set("X-SECURITY-TOKEN", "xst-TOKEN-2"); return Promise.resolve(new Response("{}", { status: 200, headers: h })); }
    if (u.pathname.endsWith("/session") && m === "DELETE") return Promise.resolve(new Response("", { status: 204 }));
    const body = o.echo ? { errorCode: "error.x", echo: `${CREDS.password} cst-TOKEN-1 xst-TOKEN-2 ${encodeURIComponent(CREDS.username)}` } : { positions: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: o.echo ? 400 : 200, headers: h }));
  };
  return { f: f as typeof fetch, seen };
}

Deno.test("the client logs in, moves onto the configured spread-bet account, and scrubs every secret from what it returns", async () => {
  const x = fakeIgHttp({ accounts: [{ accountId: "ZCFD1", accountType: "CFD" }, { accountId: "ZSB1", accountType: "SPREADBET" }], current: "ZCFD1", echo: true });
  const store: { s: IgbotSession | null } = { s: null };
  const c = new IgbotClient({ creds: CREDS, fetchImpl: x.f, store });
  const err = await assertRejects(() => c.get("/positions", 2));
  assertEquals(x.seen, ["POST /session", "PUT /session", "GET /positions"]);
  for (const s of ["SECRET", "TOKEN"]) assertEquals((err as Error).message.includes(s), false, (err as Error).message);
  assertEquals(store.s?.accountId, "ZSB1");
});

Deno.test("the client refuses an account that is not a spread-bet account, or not this login's, and logs out", async () => {
  for (const accounts of [[{ accountId: "ZSB1", accountType: "CFD" }], [{ accountId: "OTHER", accountType: "SPREADBET" }]]) {
    const x = fakeIgHttp({ accounts, current: accounts[0].accountId });
    const c = new IgbotClient({ creds: CREDS, fetchImpl: x.f, store: { s: null } });
    await assertRejects(() => c.get("/positions", 2), IgbotRefused);
    assertEquals(x.seen, ["POST /session", "DELETE /session"]);
  }
});

Deno.test("the client's minute budget is the isolate's: a second client counts what the first sent (the 2026-10-29 audit)", async () => {
  const x = fakeIgHttp({ accounts: [{ accountId: "ZSB1", accountType: "SPREADBET" }], current: "ZSB1" });
  const t = Date.now() + 365 * 86400e3; // past every other test's clock, so their entries in the isolate's list have aged out
  const a = new IgbotClient({ creds: CREDS, fetchImpl: x.f, store: { s: null }, now: () => t });
  for (let i = 0; i < 20; i++) await a.get("/positions", 2); // with the login, 21 non-trading requests
  const b = new IgbotClient({ creds: CREDS, fetchImpl: x.f, store: { s: null }, now: () => t });
  for (let i = 0; i < 2; i++) await b.get("/positions", 2); // b logs in too: 24
  await assertRejects(() => b.get("/positions", 2), IgbotRefused, "non-trading");
  assertEquals(assertIgbotAllowed("GET", `${IGBOT_DEMO_BASE}/prices/${US500}?resolution=HOUR&max=2&pageSize=0`).trading, false);
  assertThrows(() => assertIgbotAllowed("GET", `${IGBOT_DEMO_BASE}/prices/${US500}?from=2026-01-01`), IgbotRefused);
});

Deno.test("the client's minute budget sits under IG's allowances", async () => {
  const x = fakeIgHttp({ accounts: [{ accountId: "ZSB1", accountType: "SPREADBET" }], current: "ZSB1" });
  const c = new IgbotClient({ creds: CREDS, fetchImpl: x.f, store: { s: null }, now: () => T0, sent: [] });
  for (let i = 0; i < 23; i++) await c.get("/positions", 2); // with the login, 24 non-trading requests
  await assertRejects(() => c.get("/positions", 2), IgbotRefused, "non-trading");
});
