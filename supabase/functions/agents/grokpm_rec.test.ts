// Pins GROKPM's independent record (grokpm_rec.ts): nothing read while no wallet is set; a run's reads (public GETs and a
// public JSON-RPC batch only, each carrying its slot), its snapshot marked at the books' mids and at the payout once
// redeemable, activity stored once by its content, entries written once with the mid when first seen, the start stamped
// at 90 % of FUNDED, resolutions every half hour, and a second run in a slot changing nothing. The database double is
// `memDb`, held to 0124's columns and primary keys (`_shared/grokpm_schema.ts`) (a write naming a column the table does not have, or an upsert on any
// key but the table's, is refused, as PostgREST refuses it).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Db } from "./db.ts";
import { memDb, type Row } from "./testing.ts";
import { GROKPM_TABLES } from "../_shared/grokpm_schema.ts";
import { activityRow, balanceOf, GROKPM_CASH_TOKENS, midOf, newEntries, positionsOf, runGrokPmRec, snapshotRow, startsNow } from "./grokpm_rec.ts";

const T0 = Date.parse("2026-10-16T09:31:12Z");
const W = "0xabcdef0123456789abcdef0123456789abcdef01";
const COND = "0x" + "a1".repeat(32), COND2 = "0x" + "b2".repeat(32);

const schemaOf = (table: string) => GROKPM_TABLES[table];

/** `memDb`, held to 0124's columns and keys on every write to a grokpm table. */
function strictDb(seed: Record<string, Row[]>, now: () => number): Db & { tables: () => Record<string, Row[]> } {
  const { db: mem, tables } = memDb(seed, { now });
  const check = (table: string, rows: unknown) => {
    if (!table.startsWith("grokpm_")) return;
    const s = schemaOf(table);
    for (const r of (Array.isArray(rows) ? rows : [rows]) as Row[]) for (const k of Object.keys(r)) if (!s.columns.includes(k)) throw new Error(`${table}: no column ${k}`);
  };
  return {
    ...mem,
    insert: (t, rows, ret) => { check(t, rows); return mem.insert(t, rows, ret); },
    upsert: (t, rows, on) => {
      check(t, rows);
      if (t.startsWith("grokpm_") && on !== schemaOf(t).key) return Promise.reject(new Error(`${t}: no unique key ${on}`));
      return mem.upsert(t, rows, on);
    },
    update: (t, q, patch) => { check(t, patch); return mem.update(t, q, patch); },
    tables: () => tables,
  };
}

const POSITIONS = [
  { proxyWallet: W, asset: "111", conditionId: COND, size: 20, avgPrice: 0.4, curPrice: 0.455, redeemable: false, outcome: "Yes", outcomeIndex: 0, title: "Will A?", endDate: "2026-10-28" },
  { proxyWallet: W, asset: "333", conditionId: COND2, size: 10, avgPrice: 0.7, curPrice: 1, redeemable: true, outcome: "Yes", outcomeIndex: 0, title: "Will B?", endDate: "2026-10-15" },
  { proxyWallet: W, asset: "555", conditionId: COND2, size: 0, avgPrice: 0.3, curPrice: 0, redeemable: true, outcome: "No", outcomeIndex: 1, title: "Will B?", endDate: "2026-10-15" },
];
const ACTIVITY = [
  { proxyWallet: W, timestamp: 1792056000, conditionId: COND, type: "TRADE", size: 20, usdcSize: 8, transactionHash: "0x01", price: 0.4, asset: "111", side: "BUY", outcomeIndex: 0, title: "Will A?" },
  { proxyWallet: W, timestamp: 1791990000, conditionId: COND2, type: "TRADE", size: 10, usdcSize: 7, transactionHash: "0x02", price: 0.7, asset: "333", side: "BUY", outcomeIndex: 0, title: "Will B?" },
];
const hex = (usd: number) => "0x" + BigInt(Math.round(usd * 1e6)).toString(16).padStart(64, "0");

/** The public hosts as measured on 2026-10-15, answering what each read asks; every request is logged. */
function fakeFetch(log: string[], o: { cash?: Record<string, number>; closed?: boolean; failRpc?: boolean } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    log.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}${u.search}`);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.host === "data-api.polymarket.com" && u.pathname === "/positions") return ok(POSITIONS);
    if (u.host === "data-api.polymarket.com" && u.pathname === "/value") return ok([{ user: W, value: 19.1 }]);
    if (u.host === "data-api.polymarket.com" && u.pathname === "/activity") return ok(ACTIVITY);
    if (u.host === "clob.polymarket.com" && u.pathname === "/books") {
      const ids = (JSON.parse(String(init?.body)) as Array<{ token_id: string }>).map((x) => x.token_id);
      return ok(ids.filter((t) => t === "111").map((t) => ({ asset_id: t, bids: [{ price: "0.45", size: "100" }], asks: [{ price: "0.47", size: "50" }], tick_size: "0.01" })));
    }
    if (u.host === "gamma-api.polymarket.com") {
      return ok({ markets: o.closed ? [{ conditionId: COND2, clobTokenIds: JSON.stringify(["333", "555"]), outcomePrices: JSON.stringify(["1", "0"]), closed: true, closedTime: "2026-10-15 20:00:00+00", question: "Will B?" }] : [] });
    }
    if (u.host === "polygon-bor-rpc.publicnode.com") {
      if (o.failRpc) return new Response("busy", { status: 503 });
      const calls = JSON.parse(String(init?.body)) as Array<{ id: number; params: [{ to: string; data: string }] }>;
      const cash = o.cash ?? { pusd: 60.5, usdce: 0, usdc: 1.25 };
      const by: Record<string, number> = { [GROKPM_CASH_TOKENS.pusd]: cash.pusd, [GROKPM_CASH_TOKENS.usdce]: cash.usdce, [GROKPM_CASH_TOKENS.usdc]: cash.usdc };
      for (const c of calls) assertEquals(c.params[0].data, "0x70a08231" + W.slice(2).padStart(64, "0"));
      return ok(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: hex(by[c.params[0].to]) })));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const seed = (wallet: string | null, started: string | null = null): Record<string, Row[]> => ({
  grokpm_config: [{ id: 1, wallet, funded_usd: 100, daily_loss_usd: 10, total_stop_usd: 30, started_at: started }],
  grokpm_rec_state: [{ id: 1, state: {}, updated_at: null, last_error: null, last_report: null }],
  grokpm_entries: [], grokpm_resolutions: [], grokpm_snapshots: [], grokpm_activity: [],
});

Deno.test("no wallet: nothing is read and nothing written", async () => {
  const log: string[] = [];
  const d = strictDb(seed(null), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  assertEquals(r, { skipped: "no wallet configured", errors: [] });
  assertEquals(log, []);
});

Deno.test("a run: public reads only, its slot on each data-API read; the snapshot, activity, entries and the start", async () => {
  const log: string[] = [];
  const d = strictDb(seed(W), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log, { cash: { pusd: 90.5, usdce: 0, usdc: 1.25 } }) });
  assertEquals(r.errors, []);
  const slot = Date.parse("2026-10-16T09:30:00Z");
  for (const l of log.filter((x) => x.includes("data-api"))) assert(l.startsWith("GET ") && l.includes(`_=${slot}`), l);
  assert(log.every((l) => /^(GET|POST) (data-api\.polymarket\.com|clob\.polymarket\.com\/books|gamma-api\.polymarket\.com|polygon-bor-rpc\.publicnode\.com)/.test(l)), log.join("\n"));
  const t = d.tables();
  const snap = t.grokpm_snapshots[0];
  // Cash 90.5 + 1.25; 111 at its mid 0.46 (9.20); 333 redeemable at its payout 1 (10.00); 555's zero size dropped.
  assertEquals([snap.slot, snap.cash_usd, snap.positions_value_usd, snap.value_api_usd, snap.equity_usd], ["2026-10-16T09:30:00.000Z", 91.75, 19.2, 19.1, 110.95]);
  assertEquals((snap.positions as Row[]).map((p) => [p.asset, p.mark, p.value]), [["111", 0.46, 9.2], ["333", 1, 10]]);
  assertEquals(t.grokpm_activity.length, 2);
  // Entries: 111 at its mid when first seen; 333 redeemable, so no mid (it is scored with the agent's m).
  assertEquals(t.grokpm_entries.map((e) => [e.asset, e.mid, e.first_fill_at]), [["111", 0.46, "2026-10-15T09:20:00.000Z"], ["333", null, "2026-10-14T15:00:00.000Z"]]);
  assertEquals(r.started, true);
  // A redeemable position makes the resolution read due at once: Gamma answered nothing closed yet.
  assertEquals(r.resolved, 0);
});

Deno.test("a second run in the slot changes nothing the first did; equity under 90 % starts nothing", async () => {
  const log: string[] = [];
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  const once = JSON.stringify(d.tables());
  await runGrokPmRec({ db: d, now: T0 + 20e3, fetchImpl: fakeFetch(log) });
  const t = d.tables();
  assertEquals(t.grokpm_snapshots.length, 1);
  assertEquals(t.grokpm_activity.length, 2);
  assertEquals(t.grokpm_entries.length, JSON.parse(once).grokpm_entries.length);
  // 61.75 + 19.20 = 80.95 is under 90 % of $100: not started.
  assertEquals(t.grokpm_snapshots[0].equity_usd, 80.95);
  assertEquals(startsNow({ wallet: W, funded_usd: 100, started_at: null }, 80.95), false);
  assertEquals(startsNow({ wallet: W, funded_usd: 100, started_at: null }, 90), true);
  assertEquals(startsNow({ wallet: W, funded_usd: 100, started_at: "2026-10-16T00:00:00Z" }, 200), false);
});

Deno.test("a resolution is stored once Gamma shows the market closed, with each token's payout", async () => {
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { closed: true }) });
  assertEquals(d.tables().grokpm_resolutions.map((r) => [r.cond, r.tokens, r.payouts, r.closed_at]), [[COND2, ["333", "555"], [1, 0], "2026-10-15T20:00:00.000Z"]]);
});

Deno.test("an unread balance leaves the slot without a snapshot, keeps the activity, and says why", async () => {
  const d = strictDb(seed(W), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { failRpc: true }) });
  assertEquals(d.tables().grokpm_snapshots.length, 0);
  assertEquals(d.tables().grokpm_activity.length, 2);
  assert(r.errors[0].startsWith("snapshot: "), r.errors.join());
  assertEquals(r.report, true);
});

Deno.test("the pure parts: marks, mids, balances, rows", async () => {
  const mids = new Map<string, number | null>([["111", 0.5]]);
  const p = positionsOf(POSITIONS, mids);
  assertEquals(p.map((x) => [x.asset, x.mark]), [["111", 0.5], ["333", 1]]);
  assertEquals(positionsOf([{ ...POSITIONS[0], asset: "x" }], mids), []);
  assertEquals(midOf({ bids: [[0.25, 1]], asks: [[0.75, 1]] }), 0.5);
  assertEquals(midOf({ bids: [], asks: [[0.42, 1]] }), null);
  assertEquals(balanceOf("0x" + (12_345_678n).toString(16)), 12.345678);
  const s = snapshotRow({ slot: 0, at: 1, cash: { pusd: 1, usdce: 2, usdc: 3 }, positions: p, valueApi: null });
  assertEquals([s.cash_usd, s.positions_value_usd, s.equity_usd], [6, 20, 26]);
  const a = await activityRow(ACTIVITY[0]), b = await activityRow({ ...ACTIVITY[0] });
  assertEquals(a.key, b.key);
  assertEquals([a.type, a.side, a.ts], ["TRADE", "BUY", "2026-10-15T09:20:00.000Z"]);
  const e = newEntries({ positions: p, buys: [], known: new Set(["111"]), mids, nowMs: T0 });
  assertEquals(e.map((x) => x.asset), ["333"]);
});
