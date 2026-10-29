// Pins the shared account's automatic redemption (`redeem.ts`, Deviation D6, migration 0128). The encodings are held to
// vectors computed INDEPENDENTLY, by viem 2.21.54 with the published ABIs and builder-relayer-client's own hash recipe
// (docs/agents/backtests/grokpm/scripts/redeem_vectors.mjs), never by this module checking itself. The run is driven
// against a fake of the five hosts it reads, and the database double is held to 0128's columns.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PmOrderKey, recoverSigner } from "../_shared/polymarket_orders.ts";
import { GROKPM_TABLES } from "../_shared/grokpm_schema.ts";
import type { Db } from "../agents/db.ts";
import { agentBook } from "../agents/grokpm_rec.ts";
import { memDb, PM_TEST_KEY, PM_TEST_SIGNER, type Row } from "../agents/testing.ts";
import { ledgerOf } from "./exec.ts";
import {
  balanceOfCalldata, chooseRedemptions, GROKPM_REDEEM, personalDigest, PM_CTF_ADAPTER, PM_NEG_RISK_CTF_ADAPTER, PM_PROXY_FACTORY, PM_RELAY_HUB, proxyCalldata, proxyWalletOf,
  redeemCalldata, type RedeemDeps, relayStructHash, runRedeem,
} from "./redeem.ts";

// ── the vectors (viem 2.21.54; see the header) ─────────────────────────────────────────────────────────────────────
import vectors from "../../../docs/agents/backtests/grokpm/redeem_vectors.json" with { type: "json" };

Deno.test("encoding: redeemPositions, proxy(calls), the relay hash, its personal digest and signature, the proxy wallet, balanceOf (viem's vectors)", () => {
  assertEquals(redeemCalldata(vectors.C1), vectors.redeemC1);
  assertEquals(redeemCalldata(vectors.C2), vectors.redeemC2);
  assertEquals(proxyCalldata([{ to: PM_CTF_ADAPTER, data: vectors.redeemC1 }]), vectors.proxyOne);
  assertEquals(proxyCalldata([{ to: PM_CTF_ADAPTER, data: vectors.redeemC1 }, { to: PM_NEG_RISK_CTF_ADAPTER, data: vectors.redeemC2 }]), vectors.proxyTwo);
  const h = relayStructHash({ from: vectors.signer, to: PM_PROXY_FACTORY, data: vectors.proxyTwo, fee: "0", gasPrice: "0", gasLimit: vectors.gasLimit, nonce: vectors.nonce, relayHub: PM_RELAY_HUB, relay: vectors.relay });
  assertEquals(h, vectors.structHash);
  assertEquals(personalDigest(h), vectors.personalDigest);
  assertEquals(new PmOrderKey(PM_TEST_KEY).signDigest(personalDigest(h)), vectors.signature);
  assertEquals(recoverSigner(vectors.personalDigest, vectors.signature), PM_TEST_SIGNER);
  assertEquals(proxyWalletOf(PM_TEST_SIGNER), vectors.proxyWallet.toLowerCase());
  assertEquals(balanceOfCalldata("0x1111111111111111111111111111111111111111", vectors.token), vectors.balanceOfCall);
  // The two known selectors, as Polygonscan shows them for these contracts.
  assertEquals([redeemCalldata(vectors.C1).slice(0, 10), vectors.proxyOne.slice(0, 10)], ["0x01b7037c", "0x34ee9791"]);
});

// ── the choice ───────────────────────────────────────────────────────────────────────────────────────────────────────
const T0 = Date.parse("2026-10-17T10:00:00Z");
const cond = (i: number) => "0x" + i.toString(16).padStart(2, "0").repeat(32);
const pos = (c: string, token: string, o: Partial<Record<string, unknown>> = {}) => ({
  conditionId: c, asset: token, size: 10, curPrice: 1, redeemable: true, negativeRisk: false, outcomeIndex: 0, title: `market ${c.slice(2, 6)}`, ...o,
});
const closed = (negRisk = false, version: string | null = "v1") => ({ closed: true, negRisk, version });

Deno.test("choice: the adapter by neg-risk, the largest payout first, at most five, and every skip with its reason", () => {
  const positions = [
    pos(cond(1), "11", { size: 2, curPrice: 1 }), pos(cond(1), "12", { size: 40, curPrice: 0, outcomeIndex: 1 }),          // $2, and its losing side
    pos(cond(2), "21", { size: 9, negativeRisk: true }),                                                                    // $9, neg-risk
    pos(cond(3), "31", { size: 30, curPrice: 0 }),                                                                          // $0 (a loss: cleared, last)
    pos(cond(4), "41", { size: 5 }), pos(cond(5), "51", { size: 6 }), pos(cond(6), "61", { size: 7 }),
    pos(cond(7), "71", { size: 8 }),                                                                                         // already redeemed on chain
    pos(cond(8), "81", { size: 8 }),                                                                                         // a v2 market
    pos(cond(9), "91", { size: 8 }),                                                                                         // in flight
    pos(cond(10), "101", { size: 8 }),                                                                                       // confirmed an hour ago
    pos(cond(11), "111", { size: 8 }),                                                                                       // not closed on Gamma
    pos(cond(12), "121", { size: 8 }, ), { ...pos(cond(13), "131"), redeemable: false },
  ];
  const gamma = new Map([1, 2, 3, 4, 5, 6, 7, 9, 10, 12].map((i) => [cond(i), closed(i === 2)] as const));
  gamma.set(cond(8), closed(false, "v2"));
  gamma.set(cond(11), { closed: false, negRisk: false, version: "v1" });
  const balances = new Map([["71", 0], ["12", 40]]);
  const attempts = [
    { cond: cond(9), status: "submitted", at: new Date(T0 - 600e3).toISOString() }, { cond: cond(10), status: "confirmed", at: new Date(T0 - 3600e3).toISOString() },
    ...[1, 2, 3].map((k) => ({ cond: cond(12), status: "failed", at: new Date(T0 - k * 3600e3).toISOString() })),
  ];
  const { plan, skipped } = chooseRedemptions({ positions, gamma, balances, attempts, nowMs: T0 });
  assertEquals(plan.map((x) => [x.cond, x.adapter, x.payoutUsd, x.size]), [
    [cond(2), PM_NEG_RISK_CTF_ADAPTER, 9, 9], [cond(6), PM_CTF_ADAPTER, 7, 7], [cond(5), PM_CTF_ADAPTER, 6, 6], [cond(4), PM_CTF_ADAPTER, 5, 5], [cond(1), PM_CTF_ADAPTER, 2, 42],
  ]);
  const why = Object.fromEntries(skipped.map((s) => [s.cond, s.why]));
  assertEquals(why[cond(3)], "over this run's 5: next run");
  assertEquals(why[cond(7)], "nothing left on chain: already redeemed");
  assertEquals(why[cond(8)], "a v2 market (PositionManager): not handled here");
  assertEquals(why[cond(9)], "an attempt is in flight");
  assertEquals(why[cond(10)], "redeemed in the last six hours");
  assertEquals(why[cond(11)], "not closed on Gamma");
  assertEquals(why[cond(12)], "failed three times today: left for a person");
  assert(!(cond(13) in why) && !plan.some((x) => x.cond === cond(13)));
  assertEquals(GROKPM_REDEEM.perRun, 5);
});

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const WALLET = proxyWalletOf(PM_TEST_SIGNER);
const C_WIN = cond(0xa1), C_NEG = cond(0xa2);
function strictDb(seed: Record<string, Row[]>): Db & { tables: Record<string, Row[]> } {
  const { db: mem, tables } = memDb(seed, { now: () => T0 });
  const check = (t: string, rows: unknown) => {
    const s = GROKPM_TABLES[t];
    if (!s) return;
    for (const r of (Array.isArray(rows) ? rows : [rows]) as Row[]) for (const k of Object.keys(r)) if (!s.columns.includes(k)) throw new Error(`${t}: no column ${k}`);
  };
  return {
    ...mem, tables,
    insert: (t, rows, ret) => { try { check(t, rows); } catch (e) { return Promise.reject(e); } return mem.insert(t, rows, ret); },
    update: (t, q, p) => { try { check(t, p); } catch (e) { return Promise.reject(e); } return mem.update(t, q, p); },
  };
}
type Host = { calls: Array<{ method: string; url: string; body?: string; headers?: Record<string, string> }>; relayState: string; receipt: string | null; balances: Map<string, bigint>; positions: unknown[]; positionsStatus: number[] };
function hosts(): Host & { fetch: typeof fetch } {
  const h: Host = {
    calls: [], relayState: "STATE_NEW", receipt: null, positionsStatus: [], balances: new Map([["501", 3_500_000n], ["502", 0n], ["601", 1_250_000n]]),
    positions: [
      pos(C_WIN, "501", { size: 3.5 }), pos(C_WIN, "502", { size: 20, curPrice: 0, outcomeIndex: 1 }), pos(C_NEG, "601", { size: 1.25, negativeRisk: true }),
    ],
  };
  const f = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), u = new URL(url), method = init?.method ?? "GET", body = typeof init?.body === "string" ? init.body : undefined;
    h.calls.push({ method, url, body, headers: init?.headers as Record<string, string> | undefined });
    const ok = (x: unknown) => Promise.resolve(new Response(JSON.stringify(x), { status: 200 }));
    if (u.host === "data-api.polymarket.com") {
      const st = h.positionsStatus.shift();
      return st && st !== 200 ? Promise.resolve(new Response("Too Many Requests", { status: st })) : ok(h.positions);
    }
    if (u.host === "gamma-api.polymarket.com") {
      const ids = u.searchParams.getAll("condition_ids");
      return ok({ markets: ids.map((c) => ({ conditionId: c, closed: true, negRisk: c === C_NEG, version: "v1" })) });
    }
    if (u.host === "polygon-bor-rpc.publicnode.com") {
      const q = JSON.parse(body ?? "{}");
      if (q.method === "eth_call") {
        const token = BigInt("0x" + String(q.params[0].data).slice(74)).toString();
        return ok({ jsonrpc: "2.0", id: 1, result: "0x" + (h.balances.get(token) ?? 0n).toString(16) });
      }
      if (q.method === "eth_estimateGas") return ok({ jsonrpc: "2.0", id: 1, result: "0x9c40c" });
      if (q.method === "eth_getTransactionReceipt") return ok({ jsonrpc: "2.0", id: 1, result: h.receipt ? { status: h.receipt } : null });
    }
    if (u.host === "relayer-v2.polymarket.com") {
      if (u.pathname === "/relay-payload") return ok({ address: "0x7777777777777777777777777777777777777777", nonce: "42" });
      if (u.pathname === "/submit") return ok({ transactionID: "relay-tx-1", state: "STATE_NEW" });
      if (u.pathname === "/transaction") return ok([{ transactionID: "relay-tx-1", state: h.relayState, transactionHash: h.relayState === "STATE_NEW" ? "" : "0x" + "ab".repeat(32) }]);
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return Object.assign(h, { fetch: f as typeof fetch });
}
function setup(o: { enabled?: boolean; relayer?: boolean; pause?: boolean; relayerAddress?: string } = {}) {
  const db = strictDb({
    grokpm_config: [{ id: 1, redeem_enabled: !!o.enabled }], grokpm_exec_state: [{ id: 1, state: {}, redeem_state: {} }], grokpm_redeems: [],
    agent_risk: [{ id: 1, global_pause: !!o.pause }], grokpm_fills: [], grokpm_orders: [],
  });
  const net = hosts();
  let now = T0;
  const deps = (): RedeemDeps => ({
    db, now, region: "eu-west-1", fetchImpl: net.fetch, wallet: WALLET, eoa: PM_TEST_SIGNER, signer: new PmOrderKey(PM_TEST_KEY), keyProblem: null,
    relayer: o.relayer === false ? null : { key: "relayer-key-for-tests-0123456789", address: o.relayerAddress ?? PM_TEST_SIGNER },
    sleep: (ms: number) => { waits.push(ms); return Promise.resolve(); },
  });
  const waits: number[] = [];
  return { db, net, deps, waits, at: (t: number) => { now = t; } };
}
const writes = (net: Host) => net.calls.filter((c) => c.method === "POST" && c.url.startsWith("https://relayer-v2.polymarket.com/submit"));

Deno.test("dry run (redeem_enabled false): the plan is recorded, nothing is signed or sent, no attempt row", async () => {
  const s = setup({ enabled: false });
  const r = await runRedeem(s.deps());
  assertEquals([r.mode, r.sent, r.plan.map((x) => [x.cond, x.adapter, x.payoutUsd])], ["dry_run", false, [[C_WIN, PM_CTF_ADAPTER, 3.5], [C_NEG, PM_NEG_RISK_CTF_ADAPTER, 1.25]]]);
  assertEquals(writes(s.net).length, 0);
  assertEquals(s.net.calls.filter((c) => c.url.includes("relay-payload") || c.url.includes("eth_estimateGas")).length, 0);
  assertEquals(s.db.tables.grokpm_redeems.length, 0);
  assertEquals((s.db.tables.grokpm_exec_state[0].redeem_state as { plan: unknown[]; mode: string }).plan.length, 2);
  // Its record says enabling it would send; without the relayer's key, it says why not.
  assertEquals(r.blockedBy, []);
  const k = setup({ enabled: false, relayer: false });
  assertEquals((await runRedeem(k.deps())).blockedBy, ["no Relayer API key: set POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS"]);
  assertEquals(writes(k.net).length, 0);
});

Deno.test("enabled: one relayed transaction for every market chosen, signed by the account's signer, rows written first; a second run sends nothing; then it settles", async () => {
  const s = setup({ enabled: true });
  const r = await runRedeem(s.deps());
  assertEquals([r.mode, r.sent, r.relayId, r.errors], ["live", true, "relay-tx-1", []]);
  const sub = writes(s.net);
  assertEquals(sub.length, 1);
  const body = JSON.parse(sub[0].body!);
  assertEquals([body.type, body.to, body.from, body.proxyWallet, body.nonce, body.signatureParams], [
    "PROXY", PM_PROXY_FACTORY, PM_TEST_SIGNER, WALLET, "42", { gasPrice: "0", gasLimit: String(0x9c40c), relayerFee: "0", relayHub: PM_RELAY_HUB, relay: "0x7777777777777777777777777777777777777777" },
  ]);
  assertEquals(body.data, proxyCalldata([{ to: PM_CTF_ADAPTER, data: redeemCalldata(C_WIN) }, { to: PM_NEG_RISK_CTF_ADAPTER, data: redeemCalldata(C_NEG) }]));
  const hash = relayStructHash({ from: PM_TEST_SIGNER, to: PM_PROXY_FACTORY, data: body.data, fee: "0", gasPrice: "0", gasLimit: String(0x9c40c), nonce: "42", relayHub: PM_RELAY_HUB, relay: "0x7777777777777777777777777777777777777777" });
  assertEquals(recoverSigner(personalDigest(hash), body.signature), PM_TEST_SIGNER);
  assertEquals(sub[0].headers?.RELAYER_API_KEY_ADDRESS, PM_TEST_SIGNER);
  assertEquals(s.db.tables.grokpm_redeems.map((x) => [x.cond, x.status, x.relay_id, Number(x.payout_usd)]), [[C_WIN, "submitted", "relay-tx-1", 3.5], [C_NEG, "submitted", "relay-tx-1", 1.25]]);
  // The same hour again (the watchdog's retry, or a slow relayer): in flight, so nothing is sent.
  s.at(T0 + 20e3);
  const again = await runRedeem(s.deps());
  assertEquals([again.sent, again.inFlight, writes(s.net).length], [false, 2, 1]);
  // Mined and confirmed: the rows settle; the chain holds nothing more of them, so the next run plans neither.
  s.net.relayState = "STATE_CONFIRMED"; s.net.receipt = "0x1";
  s.net.balances.set("501", 0n); s.net.balances.set("601", 0n);
  s.at(T0 + 3600e3);
  const next = await runRedeem(s.deps());
  assertEquals([next.settled, next.sent, next.plan.length, writes(s.net).length], [2, false, 0, 1]);
  assertEquals(s.db.tables.grokpm_redeems.map((x) => [x.status, x.tx_hash]), [["confirmed", "0x" + "ab".repeat(32)], ["confirmed", "0x" + "ab".repeat(32)]]);
});

Deno.test("enabled but not sendable: no Relayer key, a key of another address, or the global pause; each says why and sends nothing", async () => {
  for (const [o, why] of [[{ relayer: false }, /no Relayer API key/], [{ relayerAddress: "0x" + "22".repeat(20) }, /not the account's signer/], [{ pause: true }, /global pause/]] as const) {
    const s = setup({ enabled: true, ...o });
    const r = await runRedeem(s.deps());
    assertEquals([r.sent, writes(s.net).length, s.db.tables.grokpm_redeems.length], [false, 0, 0]);
    assert(r.errors.some((e) => why.test(e)), JSON.stringify(r.errors));
    assert(!JSON.stringify(r).includes("relayer-key-for-tests"));
  }
});

Deno.test("in flight holds the whole run: a market newly redeemable while another's attempt is unsettled waits, so no second transaction races the first (audit 2026-10-17)", async () => {
  const s = setup({ enabled: true });
  await runRedeem(s.deps());
  assertEquals(writes(s.net).length, 1);
  // A third market resolves within the hour; the first transaction is still not final.
  const C_NEW = cond(0xa3);
  s.net.positions.push(pos(C_NEW, "701", { size: 2 }));
  s.net.balances.set("701", 2_000_000n);
  s.at(T0 + 20e3);
  const r = await runRedeem(s.deps());
  assertEquals([r.sent, r.inFlight, r.plan.map((x) => x.cond), writes(s.net).length, s.db.tables.grokpm_redeems.length], [false, 2, [C_NEW], 1, 2]);
});

Deno.test("a reverted or refused transaction is failed with its reason; one never answered is expired after two hours", async () => {
  const s = setup({ enabled: true });
  await runRedeem(s.deps());
  s.net.relayState = "STATE_MINED"; s.net.receipt = "0x0";
  s.at(T0 + 3600e3);
  await runRedeem(s.deps());
  assertEquals(s.db.tables.grokpm_redeems.slice(0, 2).map((x) => [x.status, x.error]), [["failed", "the transaction reverted"], ["failed", "the transaction reverted"]]);
  const t = setup({ enabled: true });
  await runRedeem(t.deps());
  t.at(T0 + 2 * 3600e3 + 60e3);
  t.net.balances.set("501", 0n); t.net.balances.set("601", 0n);
  await runRedeem(t.deps());
  assertEquals(t.db.tables.grokpm_redeems.map((x) => x.status), ["expired", "expired"]);
});

Deno.test("the book: a redemption writes no fill, so GROKPM's ledger and the keyless record's book are what they were (D4 counted the payout)", async () => {
  // The agent held 10 YES of C_WIN (bought at 0.40), which resolved YES: D4's ledger has it as cash at 1.
  const fills = [{ trade_id: "t", hash: "0x" + "aa".repeat(32), cond: C_WIN, token: "501", side: "BUY" as const, price: 0.4, size: 10, fee_usd: 0, taker: false, status: "CONFIRMED", match_time: new Date(T0 - 86400e3).toISOString(), tx_hash: "0x" + "cd".repeat(32) }];
  const before = ledgerOf({ fundedUsd: 100, orders: [], fills, mids: {}, payouts: { "501": 1 }, nowMs: T0 });
  const s = setup({ enabled: true });
  s.db.tables.grokpm_fills.push(...fills as unknown as Row[]);
  await runRedeem(s.deps());
  assertEquals(s.db.tables.grokpm_fills.length, 1);
  const after = ledgerOf({ fundedUsd: 100, orders: [], fills: s.db.tables.grokpm_fills as never, mids: {}, payouts: { "501": 1 }, nowMs: T0 + 3600e3 });
  assertEquals([after.cashUsd, after.equityUsd, after.totalUsd], [before.cashUsd, before.equityUsd, before.totalUsd]);
  assertEquals([before.cashUsd, before.totalUsd], [106, 6]);
  // The record (since 2026-10-29): the account's REDEEM item turns the agent's resolved holding into its cash, once. Before
  // it, the holding was marked at its payout ($10 of position value); after it, the $10 is cash and nothing is held, so the
  // record's equity (budget + cash flows + holdings at their marks) is $106 either way, as D4's ledger above has it.
  const trade = { ts: new Date(T0 - 86400e3).toISOString(), type: "TRADE", cond: C_WIN, asset: "501", side: "BUY", size: 10, usdc_size: 4, tx: "0x" + "cd".repeat(32), outcome_index: 0, title: null };
  const redeem = { ts: new Date(T0 + 1800e3).toISOString(), type: "REDEEM", cond: C_WIN, asset: "501", side: null, size: 10, usdc_size: 10, tx: "0x" + "ab".repeat(32), outcome_index: 0, title: null };
  const start = new Date(T0 - 2 * 86400e3).toISOString();
  const book = agentBook([trade, redeem], fills, start), without = agentBook([trade], fills, start);
  assertEquals([without.flowUsd, without.assets[0].size], [-4, 10]);
  assertEquals([book.flowUsd, book.assets[0].size, book.assets[0].redeemedUsd], [6, 0, 10]);
  assertEquals([100 + without.flowUsd + without.assets[0].size * 1, 100 + book.flowUsd + book.assets[0].size * 1], [106, 106]);
  assertEquals(before.equityUsd, 106);
});

Deno.test("the endpoint: redeem takes only the scheduler's bearer, beats first, runs in eu-west-1, and reports a fault once an hour", async () => {
  const { handle } = await import("./index.ts");
  const s = setup({ enabled: true, relayer: false });
  const beats: string[] = [], reports: string[] = [];
  const ingest = { recentRequests: () => Promise.resolve([]), insertIgnore: () => Promise.resolve(0), logRequest: () => Promise.resolve() };
  const deps = (region: string) => ({
    secret: "s".repeat(40), db: ingest, now: () => T0, region, cronSecret: "c".repeat(40), redeem: () => Promise.resolve(s.deps()),
    beat: (k: string) => { beats.push(k); return Promise.resolve(); }, report: (k: string) => { reports.push(k); return Promise.resolve(); },
  });
  const req = (auth: string) => new Request("https://x.test/functions/v1/grokpm?action=redeem&forceFunctionRegion=eu-west-1", { method: "POST", headers: { Authorization: `Bearer ${auth}` } });
  assertEquals((await handle(req("s".repeat(40)), deps("eu-west-1") as never)).status, 401);
  assertEquals((await handle(req("c".repeat(40)), deps("us-east-1") as never)).status, 403);
  const r = await handle(req("c".repeat(40)), deps("eu-west-1") as never);
  assertEquals(r.status, 200);
  const b = await r.json();
  assertEquals([b.mode, b.sent, b.plan.length], ["live", false, 2]);
  await handle(req("c".repeat(40)), deps("eu-west-1") as never);
  assertEquals([beats.every((k) => k === "grokpm?action=redeem"), reports], [true, ["grokpm.redeem"]]);
  assertEquals(writes(s.net).length, 0);
});

// The optimisation review's F3 (2026-10-24): the 10-23 14:00 UTC run's "redeemable positions unread: positions: 429".
Deno.test("a busy positions read is tried again; one busy run plans nothing and says nothing; two in a row reach the errors box", async () => {
  const s = setup({ enabled: false });
  // 429 then 200: the retry reads the positions and the run plans as usual.
  s.net.positionsStatus.push(429);
  const ok1 = await runRedeem(s.deps());
  assertEquals([ok1.errors, ok1.rateLimited, ok1.plan.length, s.waits], [[], undefined, 2, [2_000]]);
  // Busy on all three tries: nothing planned, nothing sent, no error, the state says so.
  s.waits.length = 0;
  s.net.positionsStatus.push(429, 429, 503);
  const busy1 = await runRedeem(s.deps());
  assertEquals([busy1.errors, busy1.rateLimited, busy1.plan.length, writes(s.net).length, s.waits], [[], true, 0, 0, [2_000, 5_000]]);
  assertEquals((s.db.tables.grokpm_exec_state[0].redeem_state as { rateLimited: boolean }).rateLimited, true);
  // The next run busy too: now it is an error.
  s.net.positionsStatus.push(429, 429, 429);
  const busy2 = await runRedeem(s.deps());
  assertEquals(busy2.errors, ["redeemable positions unread: positions: 429 after 3 tries, two runs running"]);
  // And a run that reads them clears the flag.
  const ok2 = await runRedeem(s.deps());
  assertEquals([ok2.errors, (s.db.tables.grokpm_exec_state[0].redeem_state as { rateLimited: boolean }).rateLimited], [[], false]);
  // A refusal that is not busy (a 404) is still the run's error at once, as before.
  s.net.positionsStatus.push(404);
  const nf = await runRedeem(s.deps());
  assertEquals(nf.errors, ["redeemable positions unread: positions: 404"]);
});
