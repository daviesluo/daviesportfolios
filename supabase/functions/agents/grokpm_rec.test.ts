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
import {
  activityRow, agentBook, agentPositions, balanceOf, finalResolution, forecastMarkets, GROKPM_CASH_TOKENS, GROKPM_MARKETS_PER_RUN, GROKPM_SHADOW_MARKETS_PER_RUN, GROKPM_SHADOW_TRADES,
  lastTradeBefore, marketRow, midOf, missingMarkets, pendingForecasts, runGrokPmRec, snapshotRow, touchOf,
} from "./grokpm_rec.ts";

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
/** Gamma's markets by condition id (0126's titles): one open, one closed; COND3's is not on Gamma at all. */
const COND3 = "0x" + "c3".repeat(32), COND4 = "0x" + "d4".repeat(32);
const GAMMA_MARKETS = [
  { conditionId: COND, question: "Will A?", slug: "will-a", endDate: "2026-10-28T12:00:00Z", closed: false },
  { conditionId: COND4, question: "Will the Fed hold in October?", slug: "fed-hold-october", endDate: "2026-10-29T03:59:00Z", closed: true },
];
const hex = (usd: number) => "0x" + BigInt(Math.round(usd * 1e6)).toString(16).padStart(64, "0");

/** The public hosts as measured on 2026-10-15, answering what each read asks; every request is logged. */
function fakeFetch(log: string[], o: { cash?: Record<string, number>; closed?: boolean; failRpc?: boolean; failGamma?: boolean; keyset?: unknown[]; tapes?: Record<string, unknown[] | number> } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    log.push(`${init?.method ?? "GET"} ${u.host}${u.pathname}${u.search}`);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.host === "data-api.polymarket.com" && u.pathname === "/positions") return ok(POSITIONS);
    if (u.host === "data-api.polymarket.com" && u.pathname === "/value") return ok([{ user: W, value: 19.1 }]);
    if (u.host === "data-api.polymarket.com" && u.pathname === "/activity") return ok(ACTIVITY);
    if (u.host === "data-api.polymarket.com" && u.pathname === "/trades") {
      const t = o.tapes?.[u.searchParams.get("market") ?? ""];
      return typeof t === "number" ? new Response("rate limited", { status: t }) : ok(t ?? []);
    }
    if (u.host === "clob.polymarket.com" && u.pathname === "/books") {
      const ids = (JSON.parse(String(init?.body)) as Array<{ token_id: string }>).map((x) => x.token_id);
      return ok(ids.filter((t) => t === "111").map((t) => ({ asset_id: t, bids: [{ price: "0.45", size: "100" }], asks: [{ price: "0.47", size: "50" }], tick_size: "0.01" })));
    }
    if (u.host === "gamma-api.polymarket.com" && u.pathname === "/markets") {
      if (o.failGamma) return new Response("busy", { status: 503 });
      const ids = new Set(u.searchParams.getAll("condition_ids")), closed = u.searchParams.get("closed") === "true";
      return ok(GAMMA_MARKETS.filter((m) => ids.has(m.conditionId) && m.closed === closed));
    }
    if (u.host === "gamma-api.polymarket.com") {
      if (o.keyset) return ok({ markets: o.keyset.filter((m) => u.searchParams.getAll("condition_ids").includes((m as { conditionId: string }).conditionId)) });
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

Deno.test("a redeemed holding leaves the positions and its payout enters the cash once; the equity is what it was (2026-10-29, Vertiv)", async () => {
  // The bug: the record counted TRADE activity only, so a token the account had redeemed stayed a position at its payout,
  // "resolved · to redeem", for ever. The redemption is the account's (no fill of the agent's names it).
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { closed: true }) });
  await runGrokPmRec({ db: d, now: T0 + 5 * 60e3, fetchImpl: fakeFetch([], { closed: true }) });
  const before = d.tables().grokpm_snapshots.at(-1)!;
  assertEquals((before.positions as Row[]).map((p) => [p.asset, p.redeemable]), [["111", false], ["333", true]]);
  const redeem = await activityRow({ proxyWallet: W, timestamp: s("2026-10-16T09:40:00Z"), conditionId: COND2, type: "REDEEM", size: 10, usdcSize: 10,
    transactionHash: "0x0c", price: 0, asset: "333", side: "", outcomeIndex: 0, title: "Will B?" });
  await d.upsert("grokpm_activity", [redeem], "key");
  await runGrokPmRec({ db: d, now: T0 + 10 * 60e3, fetchImpl: fakeFetch([], { closed: true }) });
  const after = d.tables().grokpm_snapshots.at(-1)!;
  assertEquals((after.positions as Row[]).map((p) => p.asset), ["111"]);
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  assertEquals([r6(Number(after.cash_usd) - Number(before.cash_usd)), r6(Number(after.positions_value_usd) - Number(before.positions_value_usd))], [10, -10]);
  assertEquals(after.equity_usd, before.equity_usd);
});

Deno.test("the book: a buy then the account's redemption leaves no position and the payout in cash once; a share when the account held more", () => {
  const fills = [{ tx_hash: "0xaa", token: "777" }];
  const buy = { ts: "2026-10-26T06:43:44.000Z", type: "TRADE", cond: COND, asset: "777", side: "BUY", size: 9, usdc_size: 4.635, tx: "0xaa", outcome_index: 0, title: "Vertiv" };
  const red = { ts: "2026-10-28T11:57:47.000Z", type: "REDEEM", cond: COND, asset: "777", side: null, size: 9, usdc_size: 9, tx: "0xbb", outcome_index: 0, title: "Vertiv" };
  const b = agentBook([red, buy], fills, START);
  assertEquals([b.flowUsd, b.assets[0].size, b.assets[0].redeemedUsd], [4.365, 0, 9]);
  assertEquals(agentPositions(b, { "777": 1 }, new Map(), new Map()), []);
  // The account held 11 (2 of them someone else's): the agent's 9 leave and 9/11 of the payout is its.
  const share = agentBook([buy, { ...red, size: 11, usdc_size: 11 }], fills, START);
  assertEquals([share.flowUsd, share.assets[0].size], [4.365, 0]);
  // A losing token redeemed at 0 leaves at 0; a redemption of a token the agent does not hold, or before the start, is not its.
  assertEquals(agentBook([buy, { ...red, usdc_size: 0 }], fills, START).flowUsd, -4.635);
  assertEquals(agentBook([buy, { ...red, asset: "888" }], fills, START).assets[0].size, 9);
  assertEquals(agentBook([{ ...red, ts: "2026-10-14T00:00:00.000Z" }, buy], fills, START).assets[0].size, 9);
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

// Market titles (0126; Davies, 2026-10-17: the journal showed "0xdf9bf27e…" for a market the agent did not hold).
const decision = (id: string, ts: string, market_id: string | null) => ({ id, ts, market_id });

Deno.test("market titles: each market the journal names is looked up once on Gamma, open and closed, before the go too", async () => {
  const log: string[] = [];
  const d = strictDb({ ...seed(W, null), grokpm_markets: [], grokpm_decisions: [
    decision("d3", "2026-10-16T09:00:00Z", COND4.toUpperCase().replace("0X", "0x")), decision("d2", "2026-10-16T08:00:00Z", null),
    decision("d1", "2026-10-16T07:00:00Z", COND), decision("d0", "2026-10-16T06:00:00Z", COND3),
  ] }, () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log) });
  assertEquals(r.errors, []);
  assertEquals(r.markets, 2);
  const gamma = log.filter((l) => l.includes("gamma-api"));
  assertEquals(gamma.map((l) => new URL(`https://${l.split(" ")[1]}`).searchParams.get("closed")), ["false", "true"]);
  assertEquals(new URL(`https://${gamma[0].split(" ")[1]}`).searchParams.getAll("condition_ids"), [COND4, COND, COND3]);
  assertEquals(d.tables().grokpm_markets.map((m) => [m.cond, m.question, m.slug, m.end_date]).sort(), [
    [COND, "Will A?", "will-a", "2026-10-28T12:00:00.000Z"], [COND4, "Will the Fed hold in October?", "fed-hold-october", "2026-10-29T03:59:00.000Z"],
  ].sort());
  // The next run asks Gamma only for the one it has not found.
  const log2: string[] = [];
  await runGrokPmRec({ db: d, now: T0 + 5 * 60e3, fetchImpl: fakeFetch(log2) });
  assertEquals(log2.filter((l) => l.includes("gamma-api")).map((l) => new URL(`https://${l.split(" ")[1]}`).searchParams.getAll("condition_ids")), [[COND3], [COND3]]);
  assertEquals(d.tables().grokpm_markets.length, 2);
});

Deno.test("market titles: a Gamma failure is the run's error and stops neither the activity nor the snapshot", async () => {
  const d = strictDb({ ...seed(W), grokpm_markets: [], grokpm_decisions: [decision("d1", "2026-10-16T07:00:00Z", COND3)] }, () => T0);
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { failGamma: true }) });
  assert(r.errors.length === 1 && r.errors[0].startsWith("markets: gamma-api.polymarket.com/markets → 503"), r.errors.join());
  assertEquals([d.tables().grokpm_activity.length, d.tables().grokpm_snapshots[0].equity_usd, d.tables().grokpm_markets.length], [ACTIVITY.length, 104.4, 0]);
  assert(String(d.tables().grokpm_rec_state[0].last_error).startsWith("markets: "));
});

Deno.test("market titles: the pure parts", () => {
  const known = new Set([COND]);
  assertEquals(missingMarkets([null, COND, "  " + COND4.toUpperCase().replace("0X", "0x") + " ", "0xshort", "slug-not-id", COND4, COND3], known), [COND4, COND3]);
  const many = Array.from({ length: 30 }, (_, i) => "0x" + i.toString(16).padStart(64, "0"));
  assertEquals(missingMarkets(many, new Set()).length, GROKPM_MARKETS_PER_RUN);
  assertEquals(marketRow({ conditionId: COND, question: " Will A? ", slug: "will-a", endDate: "2026-10-28T12:00:00Z" }, T0),
    { cond: COND, question: "Will A?", slug: "will-a", end_date: "2026-10-28T12:00:00.000Z", updated_at: new Date(T0).toISOString() });
  // A slug that is not Polymarket's shape is not kept (the page then shows the title unlinked); no id, no row.
  assertEquals(marketRow({ conditionId: COND, question: "Q", slug: "../evil?x=1", endDate: "never" }, T0)?.slug, null);
  assertEquals(marketRow({ conditionId: COND, question: "Q", slug: "../evil?x=1", endDate: "never" }, T0)?.end_date, null);
  assertEquals(marketRow({ question: "Q" }, T0), null);
});

// The shadow forecasts' scoring record (the optimisation review of 2026-10-24, F1 and F2; 0138): their markets' outcomes
// and each forecast's last trade (D10), neither of which was recorded before.
const forecast = (id: string, ts: string, market_id: string, token_id: string, p: number | null = 0.9, m: number | null = 0.6) => ({ id, ts, market_id, token_id, p, m });
const tr = (asset: string, price: number, iso: string, side = "BUY", size = 10) => ({ asset, price, side, size, timestamp: Date.parse(iso) / 1000 });

Deno.test("forecasts: each one gets the market's last trade before it, once; its outcome is written only at 0, 1/2 or 1", async () => {
  const log: string[] = [];
  const decisions = [
    forecast("f1", "2026-10-16T08:00:00Z", COND3, "31"), forecast("f2", "2026-10-16T09:00:00Z", COND3, "31"),
    forecast("f3", "2026-10-16T09:10:00Z", COND4, "41"), { id: "n1", ts: "2026-10-16T09:20:00Z", market_id: COND, token_id: null, p: null, m: null },
  ];
  const d = strictDb({ ...seed(W), grokpm_markets: [], grokpm_decisions: decisions, grokpm_shadow_marks: [] }, () => T0);
  const tapes = {
    // COND3: newest first; the other outcome's trade at 0.3 is this token's 0.7; the trade after f2 is not its.
    [COND3]: [tr("31", 0.95, "2026-10-16T09:05:00Z"), tr("32", 0.3, "2026-10-16T08:30:00Z", "SELL"), tr("31", 0.55, "2026-10-16T07:00:00Z")],
    [COND4]: [tr("41", 0.5, "2026-10-16T09:30:00Z")],  // nothing before f3, and the page is not full
  };
  const keyset = [
    { conditionId: COND3, clobTokenIds: JSON.stringify(["31", "32"]), outcomePrices: JSON.stringify(["1", "0"]), closed: true, closedTime: "2026-10-16 09:20:00+00" },
    // Closed, but at a price that is not a payout: not written.
    { conditionId: COND4, clobTokenIds: JSON.stringify(["41", "42"]), outcomePrices: JSON.stringify(["0.9995", "0.0005"]), closed: true, closedTime: "2026-10-16 09:40:00+00" },
  ];
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch(log, { tapes, keyset }) });
  assertEquals(r.errors, []);
  assertEquals([r.marked, r.forecastResolved], [3, 1]);
  const marks = Object.fromEntries(d.tables().grokpm_shadow_marks.map((x) => [x.decision_id, [x.status, x.price, x.trade_at]]));
  assertEquals(marks, {
    f1: ["found", 0.55, "2026-10-16T07:00:00.000Z"], f2: ["found", 0.7, "2026-10-16T08:30:00.000Z"], f3: ["none_before", null, null],
  });
  assertEquals(d.tables().grokpm_resolutions.map((x) => [x.cond, x.tokens, x.payouts]), [[COND3, ["31", "32"], [1, 0]]]);
  // Every tape read is keyless, taker-only and carries the slot.
  for (const l of log.filter((x) => x.includes("/trades"))) assert(l.startsWith("GET data-api.polymarket.com/trades?market=") && l.includes("takerOnly=true") && l.includes("_="), l);
  // The next run reads no tape for a forecast already marked, and looks up an outcome again only after half an hour.
  const log2: string[] = [];
  const r2 = await runGrokPmRec({ db: d, now: T0 + 5 * 60e3, fetchImpl: fakeFetch(log2, { tapes, keyset }) });
  assertEquals([r2.marked, log2.filter((x) => x.includes("/trades")).length, log2.filter((x) => x.includes("/markets/keyset")).length], [0, 0, 0]);
  const log3: string[] = [];
  await runGrokPmRec({ db: d, now: T0 + 31 * 60e3, fetchImpl: fakeFetch(log3, { tapes, keyset }) });
  // (The traded markets' own half-hourly look, COND and COND2, is the other keyset read.)
  const asked = log3.filter((x) => x.includes("/markets/keyset")).map((l) => new URL(`https://${l.split(" ")[1]}`).searchParams.getAll("condition_ids"));
  assertEquals(asked.filter((ids) => !ids.includes(COND)), [[COND4]]);
});

Deno.test("forecasts: a failed tape read is the run's error, marks nothing for that market, and the snapshot stands", async () => {
  const d = strictDb({ ...seed(W), grokpm_markets: [], grokpm_decisions: [forecast("f1", "2026-10-16T08:00:00Z", COND3, "31")], grokpm_shadow_marks: [] }, () => T0);
  const waits: number[] = [];
  const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { tapes: { [COND3]: 429 } }), sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
  assert(r.errors.length === 1 && r.errors[0].startsWith("forecast trades: data-api.polymarket.com/trades → 429"), r.errors.join());
  assertEquals(waits, [1_500]);  // tried once more before it is an error
  assertEquals([d.tables().grokpm_shadow_marks.length, d.tables().grokpm_snapshots[0].equity_usd], [0, 104.4]);
});

Deno.test("forecasts: the pure parts", () => {
  const tape = [tr("1", 0.8, "2026-10-16T10:00:00Z"), tr("2", 0.25, "2026-10-16T09:00:00Z", "SELL", 3)];
  assertEquals(lastTradeBefore(tape, "1", Date.parse("2026-10-16T09:30:00Z"), false),
    { status: "found", price: 0.75, trade_at: "2026-10-16T09:00:00.000Z", trade_asset: "2", trade_side: "SELL", trade_size: 3 });
  // A trade at the forecast's own second counts; with none that old, why depends on whether the page was full.
  assertEquals(lastTradeBefore(tape, "1", Date.parse("2026-10-16T10:00:00Z"), true).price, 0.8);
  assertEquals(lastTradeBefore(tape, "1", Date.parse("2026-10-16T08:00:00Z"), false).status, "none_before");
  assertEquals(lastTradeBefore(tape, "1", Date.parse("2026-10-16T08:00:00Z"), true).status, "beyond_window");
  // Forecasts only (p and m, a token, a condition id), each market once, newest first, at most the run's markets.
  const ds = Array.from({ length: 6 }, (_, i) => forecast(`f${i}`, `2026-10-16T0${i}:00:00Z`, "0x" + String(i).repeat(64), String(i)));
  ds.push(forecast("g5", "2026-10-16T05:30:00Z", "0x" + "5".repeat(64), "5"), forecast("x", "2026-10-16T07:00:00Z", COND, "9", null, 0.5));
  assertEquals(forecastMarkets(ds)[0], "0x" + "5".repeat(64));
  const p = pendingForecasts(ds, new Set(["f4"]));
  assertEquals([...p.keys()], ["5", "3", "2", "1"].map((c) => "0x" + c.repeat(64)).slice(0, GROKPM_SHADOW_MARKETS_PER_RUN));
  assertEquals(p.get("0x" + "5".repeat(64))!.map((x) => x.id), ["g5", "f5"]);
  assertEquals(GROKPM_SHADOW_TRADES, 1000);
  assertEquals(finalResolution({ cond: COND, yes: "1", no: "2", closed: true, payout: 0.5, closedTime: null })?.payouts, [0.5, 0.5]);
  assertEquals(finalResolution({ cond: COND, yes: "1", no: "2", closed: true, payout: 0.98, closedTime: null }), null);
  assertEquals(finalResolution({ cond: COND, yes: "1", no: "2", closed: false, payout: 1, closedTime: null }), null);
  // The book is the forecast's only when read within ten minutes of it; a one-sided book keeps its empty side null.
  const books = new Map([["7", { bids: [[0.31, 50]] as Array<[number, number]>, asks: [] as Array<[number, number]> }]]);
  const at = Date.parse("2026-10-16T09:00:00Z");
  assertEquals(touchOf(books, { ts: "2026-10-16T09:00:00Z", token_id: "7" }, at + 9 * 60e3), { book_bid: 0.31, book_ask: null, bid_depth_usd: null, ask_depth_usd: null });
  assertEquals(touchOf(books, { ts: "2026-10-16T09:00:00Z", token_id: "7" }, at + 11 * 60e3), { book_bid: null, book_ask: null, bid_depth_usd: null, ask_depth_usd: null });
  // 0139 (the thin-rule study's G3): the dollars within 5 points of the mid, as the server's thin rule counts them.
  // Mid 0.515: bids at 0.511 (20) and 0.47 (100) count, 0.40 does not; asks at 0.52 (10) and 0.56 (5) count, 0.60 does not.
  const deep = new Map([["8", { bids: [[0.511, 20], [0.47, 100], [0.4, 1000]] as Array<[number, number]>, asks: [[0.52, 10], [0.56, 5], [0.6, 1000]] as Array<[number, number]> }]]);
  assertEquals(touchOf(deep, { ts: "2026-10-16T09:00:00Z", token_id: "8" }, at), { book_bid: 0.511, book_ask: 0.52, bid_depth_usd: 57.22, ask_depth_usd: 8 });
});

Deno.test("forecasts: a fresh forecast keeps the book it saw; an old one is marked without a book", async () => {
  const log: string[] = [];
  const now = Date.parse("2026-10-16T09:34:00Z");
  const d = strictDb({ ...seed(W), grokpm_markets: [], grokpm_decisions: [forecast("new", "2026-10-16T09:30:00Z", COND, "111"), forecast("old", "2026-10-16T08:00:00Z", COND3, "31")], grokpm_shadow_marks: [] }, () => now);
  await runGrokPmRec({ db: d, now, fetchImpl: fakeFetch(log, { tapes: { [COND]: [tr("111", 0.46, "2026-10-16T09:20:00Z")], [COND3]: [] } }) });
  const m = Object.fromEntries(d.tables().grokpm_shadow_marks.map((x) => [x.decision_id, [x.status, x.price, x.book_bid, x.book_ask]]));
  assertEquals(m, { new: ["found", 0.46, 0.45, 0.47], old: ["none_before", null, null, null] });
  assertEquals(d.tables().grokpm_shadow_marks.map((x) => [x.decision_id, x.bid_depth_usd, x.ask_depth_usd]), [["new", 45, 23.5], ["old", null, null]]);
});

// The optimisation review's F3: a busy activity read is tried once more, so one 429 is not a line in the errors box.
Deno.test("activity: a 429 is tried once more after a short wait; a second refusal is the run's error", async () => {
  for (const [answers, ok] of [[[429], true], [[429, 503], false]] as const) {
    const left = [...answers];
    const base = fakeFetch([]);
    const f = ((url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname === "/activity" && left.length) return Promise.resolve(new Response("Too Many Requests", { status: left.shift()! }));
      return base(url, init);
    }) as typeof fetch;
    const d = strictDb(seed(W, null), () => T0);
    const waits: number[] = [];
    const r = await runGrokPmRec({ db: d, now: T0, fetchImpl: f, sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
    assertEquals([r.errors.length === 0, d.tables().grokpm_activity.length === ACTIVITY.length, waits], [ok, ok, [1_500]]);
  }
});

// Deviation D14 (2026-10-24, the optimisation review's P4): a traded market settles only at a final payout.
Deno.test("D14: a traded market closed at a price short of its outcome is not a resolution; at 1 it is, and the holding is marked at it", async () => {
  const at = (prices: string[]) => [{ conditionId: COND2, clobTokenIds: JSON.stringify(["333", "555"]), outcomePrices: JSON.stringify(prices), closed: true, closedTime: "2026-10-15 20:00:00+00", question: "Will B?" }];
  const d = strictDb(seed(W), () => T0);
  await runGrokPmRec({ db: d, now: T0, fetchImpl: fakeFetch([], { keyset: at(["0.9995", "0.0005"]) }) });
  assertEquals(d.tables().grokpm_resolutions.filter((x) => x.cond === COND2).length, 0);
  // 333 is still marked as a holding (the data API's price, no book), not settled.
  assertEquals((d.tables().grokpm_snapshots.at(-1)!.positions as Row[]).find((x) => x.asset === "333")!.redeemable, false);
  await runGrokPmRec({ db: d, now: T0 + 31 * 60e3, fetchImpl: fakeFetch([], { keyset: at(["1", "0"]) }) });
  assertEquals(d.tables().grokpm_resolutions.filter((x) => x.cond === COND2).map((x) => x.payouts), [[1, 0]]);
  // A row written before D14 at a non-final price is not read as a payout either.
  d.tables().grokpm_resolutions.push({ cond: COND, tokens: ["111", "999"], payouts: [0.9995, 0.0005], closed_at: null, read_at: null });
  await runGrokPmRec({ db: d, now: T0 + 36 * 60e3, fetchImpl: fakeFetch([], { keyset: at(["1", "0"]) }) });
  const p = (d.tables().grokpm_snapshots.at(-1)!.positions as Row[]).find((x) => x.asset === "111")!;
  assertEquals([p.redeemable, p.mark], [false, 0.46]);
});
