// Pins GROKPM's independent record (grokpm_rec.ts) since Deviation D2: nothing read while no wallet is set; before the go
// the account's activity is stored and nothing else; from the go, the agent's OWN trades only (told apart by the order
// path's fills; live-prep's dust and redemptions never count), its holdings marked at the books' mids (the data API's
// price where no book is read, the payout once resolved), its cash the budget plus its trades' dollars, public reads only
// (each carrying its slot), entries written once with the mid when first seen, and a second run in a slot changing nothing. The database double is
// `memDb`, held to 0124's columns and primary keys (`_shared/grokpm_schema.ts`) (a write naming a column the table does not have, or an upsert on any
// key but the table's, is refused, as PostgREST refuses it).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Db } from "./db.ts";
import { memDb, type Row } from "./testing.ts";
import { GROKPM_TABLES } from "../_shared/grokpm_schema.ts";
import { activityRow, agentBook, agentPositions, balanceOf, GROKPM_CASH_TOKENS, midOf, runGrokPmRec, snapshotRow } from "./grokpm_rec.ts";

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
  { proxyWallet: W, asset: "111", conditionId: COND, size: 15, avgPrice: 0.4, curPrice: 0.455, redeemable: false, outcome: "Yes", outcomeIndex: 0, title: "Will A?", endDate: "2026-10-28" },
  { proxyWallet: W, asset: "333", conditionId: COND2, size: 10, avgPrice: 0.7, curPrice: 1, redeemable: true, outcome: "Yes", outcomeIndex: 0, title: "Will B?", endDate: "2026-10-15" },
  // Live-prep's dust in the same account: never the agent's.
  { proxyWallet: W, asset: "999", conditionId: COND, size: 4.28, avgPrice: 0.3, curPrice: 0.2, redeemable: false, outcome: "No", outcomeIndex: 1, title: "Will A?", endDate: "2026-10-28" },
];
const START = "2026-10-15T09:00:00.000Z";
const s = (iso: string) => Date.parse(iso) / 1000;
const ACTIVITY = [
  { proxyWallet: W, timestamp: s("2026-10-15T09:20:00Z"), conditionId: COND, type: "TRADE", size: 20, usdcSize: 8, transactionHash: "0x01", price: 0.4, asset: "111", side: "BUY", outcomeIndex: 0, title: "Will A?" },
  { proxyWallet: W, timestamp: s("2026-10-15T12:00:00Z"), conditionId: COND2, type: "TRADE", size: 10, usdcSize: 7, transactionHash: "0x02", price: 0.7, asset: "333", side: "BUY", outcomeIndex: 0, title: "Will B?" },
  { proxyWallet: W, timestamp: s("2026-10-16T08:00:00Z"), conditionId: COND, type: "TRADE", size: 5, usdcSize: 2.5, transactionHash: "0x03", price: 0.5, asset: "111", side: "SELL", outcomeIndex: 0, title: "Will A?" },
  // Live-prep's: a dust trade of another transaction, before and after the go, and a redemption.
  { proxyWallet: W, timestamp: s("2026-10-14T08:00:00Z"), conditionId: COND, type: "TRADE", size: 4.28, usdcSize: 1.28, transactionHash: "0x09", price: 0.3, asset: "999", side: "BUY", outcomeIndex: 1, title: "Will A?" },
  { proxyWallet: W, timestamp: s("2026-10-15T10:00:00Z"), conditionId: COND, type: "TRADE", size: 1, usdcSize: 0.3, transactionHash: "0x0a", price: 0.3, asset: "999", side: "SELL", outcomeIndex: 1, title: "Will A?" },
  { proxyWallet: W, timestamp: s("2026-10-15T11:00:00Z"), conditionId: COND2, type: "REDEEM", size: 3, usdcSize: 3, transactionHash: "0x0b", price: 0, asset: "", side: "", outcomeIndex: 0, title: "Will B?" },
];
/** The order path's fills, as `grokpm_fills` holds them: the agent's three, and one that failed on chain. */
const FILLS = [
  { trade_id: "t1", hash: "0x" + "1".repeat(64), cond: COND, token: "111", side: "BUY", price: 0.4, size: 20, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: "2026-10-15T09:20:00Z", tx_hash: "0x01" },
  { trade_id: "t2", hash: "0x" + "2".repeat(64), cond: COND2, token: "333", side: "BUY", price: 0.7, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: "2026-10-15T12:00:00Z", tx_hash: "0x02" },
  { trade_id: "t3", hash: "0x" + "3".repeat(64), cond: COND, token: "111", side: "SELL", price: 0.5, size: 5, fee_usd: 0, taker: false, status: "MATCHED", match_time: "2026-10-16T08:00:00Z", tx_hash: "0x03" },
  { trade_id: "t4", hash: "0x" + "4".repeat(64), cond: COND, token: "999", side: "BUY", price: 0.3, size: 1, fee_usd: 0, taker: false, status: "FAILED", match_time: "2026-10-15T10:00:00Z", tx_hash: "0x0a" },
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
      const cash = o.cash ?? { pusd: 308.03, usdce: 0, usdc: 0 };
      const by: Record<string, number> = { [GROKPM_CASH_TOKENS.pusd]: cash.pusd, [GROKPM_CASH_TOKENS.usdce]: cash.usdce, [GROKPM_CASH_TOKENS.usdc]: cash.usdc };
      for (const c of calls) assertEquals(c.params[0].data, "0x70a08231" + W.slice(2).padStart(64, "0"));
      return ok(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: hex(by[c.params[0].to]) })));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const seed = (wallet: string | null, started: string | null = START): Record<string, Row[]> => ({
  grokpm_config: [{ id: 1, wallet, funded_usd: 100, daily_loss_usd: 10, total_stop_usd: 30, started_at: started }],
  grokpm_rec_state: [{ id: 1, state: {}, updated_at: null, last_error: null, last_report: null }],
  grokpm_entries: [], grokpm_resolutions: [], grokpm_snapshots: [], grokpm_activity: [], grokpm_fills: FILLS,
});

Deno.test("no wallet: nothing is read and nothing written", async () => {
  const log: string[] = [];
  const d = strictDb(seed(null), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  assertEquals(r, { skipped: "no wallet configured", errors: [] });
  assertEquals(log, []);
});

Deno.test("before the go: the account's activity is stored, nothing else", async () => {
  const log: string[] = [];
  const d = strictDb(seed(W, null), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  assertEquals(r.errors, []);
  assertEquals(d.tables().grokpm_activity.length, ACTIVITY.length);
  assertEquals([d.tables().grokpm_snapshots.length, d.tables().grokpm_entries.length], [0, 0]);
  assertEquals(log.map((l) => l.split("?")[0]), ["GET data-api.polymarket.com/activity"]);
});

Deno.test("from the go: the agent's own trades only, its cash the budget plus their dollars, live-prep's dust never counted", async () => {
  const log: string[] = [];
  const d = strictDb(seed(W), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  assertEquals(r.errors, []);
  const slot = Date.parse("2026-10-16T09:30:00Z");
  for (const l of log.filter((x) => x.includes("data-api"))) assert(l.startsWith("GET ") && l.includes(`_=${slot}`), l);
  assert(log.every((l) => /^(GET|POST) (data-api\.polymarket\.com|clob\.polymarket\.com\/books|gamma-api\.polymarket\.com|polygon-bor-rpc\.publicnode\.com)/.test(l)), log.join("\n"));
  const snap = d.tables().grokpm_snapshots[0];
  // By hand: cash 100 − 8 − 7 + 2.5 = 87.50; 111: 15 left at its mid 0.46 = 6.90; 333: 10 with no book, at the data API's
  // price 1 = 10. Equity 104.40. The shared wallet's pUSD (308.03) is kept beside it and counts nowhere.
  assertEquals([snap.slot, snap.cash_usd, snap.positions_value_usd, snap.equity_usd, snap.cash_pusd], ["2026-10-16T09:30:00.000Z", 87.5, 16.9, 104.4, 308.03]);
  assertEquals((snap.positions as Row[]).map((p) => [p.asset, p.size, p.mark, p.value]), [["111", 15, 0.46, 6.9], ["333", 10, 1, 10]]);
  assertEquals(d.tables().grokpm_entries.map((e) => [e.asset, e.mid, e.first_fill_at]), [["111", 0.46, "2026-10-15T09:20:00.000Z"], ["333", null, "2026-10-15T12:00:00.000Z"]]);
});

Deno.test("a second run in the slot changes nothing the first did", async () => {
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([]) });
  const once = JSON.stringify([d.tables().grokpm_snapshots, d.tables().grokpm_entries, d.tables().grokpm_activity.length]);
  await runGrokPmRec({ db: d, now: T0 + 20e3, fetchImpl: fakeFetch([]) });
  const twice = JSON.parse(JSON.stringify([d.tables().grokpm_snapshots, d.tables().grokpm_entries, d.tables().grokpm_activity.length]));
  const a = JSON.parse(once);
  assertEquals([twice[0].length, twice[1], twice[2]], [1, a[1], a[2]]);
  assertEquals(twice[0][0].equity_usd, a[0][0].equity_usd);
});

Deno.test("a resolution is stored, and a resolved holding is marked at its payout", async () => {
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { closed: true }) });
  assertEquals(d.tables().grokpm_resolutions.map((r) => [r.cond, r.tokens, r.payouts]), [[COND2, ["333", "555"], [1, 0]]]);
  // The next run marks 333 at its payout (here equal to the data API's price) and flags it redeemable.
  await runGrokPmRec({ db: d, now: T0 + 5 * 60e3, fetchImpl: fakeFetch([], { closed: true }) });
  const p = (d.tables().grokpm_snapshots.at(-1)!.positions as Row[]).find((x) => x.asset === "333")!;
  assertEquals([p.mark, p.redeemable], [1, true]);
});

Deno.test("an unread wallet balance stops nothing: the agent's snapshot does not depend on it", async () => {
  const d = strictDb(seed(W), () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { failRpc: true }) });
  assertEquals(d.tables().grokpm_snapshots[0].equity_usd, 104.4);
  assert(r.errors[0].startsWith("balances: "), r.errors.join());
});

Deno.test("the pure parts: the agent's book, its positions, mids, balances, rows", async () => {
  const trades = (await Promise.all(ACTIVITY.map(activityRow))).map((a) => ({ ...a }));
  const b = agentBook(trades, FILLS.filter((f) => f.status !== "FAILED"), START);
  assertEquals(b.flowUsd, -12.5);
  assertEquals(b.assets.map((a) => [a.asset, a.size, a.avgPrice]), [["111", 15, 0.4], ["333", 10, 0.7]]);
  // A trade before the go, or of another token in one of its transactions, is not the agent's.
  assertEquals(agentBook(trades, FILLS, "2026-10-16T00:00:00.000Z").assets.map((a) => [a.asset, a.size]), [["111", -5]]);
  assertEquals(agentBook(trades, [{ tx_hash: "0x01", token: "999" }], START).assets, []);
  const pos = agentPositions(b, { "333": 1 }, new Map([["111", 0.5]]), new Map());
  assertEquals(pos.map((x) => [x.asset, x.mark, x.redeemable]), [["111", 0.5, false], ["333", 1, true]]);
  assertEquals(midOf({ bids: [[0.25, 1]], asks: [[0.75, 1]] }), 0.5);
  assertEquals(midOf({ bids: [], asks: [[0.42, 1]] }), null);
  assertEquals(balanceOf("0x" + (12_345_678n).toString(16)), 12.345678);
  const snap = snapshotRow({ slot: 0, at: 1, cash: { pusd: 1, usdce: 2, usdc: 3 }, positions: pos, valueApi: null, agentCashUsd: 87.5 });
  assertEquals([snap.cash_usd, snap.positions_value_usd, snap.equity_usd, snap.cash_pusd], [87.5, 17.5, 105, 1]);
  const a = await activityRow(ACTIVITY[0]), c = await activityRow({ ...ACTIVITY[0] });
  assertEquals(a.key, c.key);
});
