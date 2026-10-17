// Automatic redemption of the shared Polymarket account's resolved positions (Davies, 2026-10-17: "加上吧 全部都自动化掉",
// on redeeming resolved positions automatically; the GROKPM pre-registration's Deviation D6, migration 0128).
//
// Why. A resolved market's winning tokens pay 1 pUSD each only once they are REDEEMED on chain; until then the money sits
// as tokens. GROKPM's book already counts a resolved holding as cash at its payout (D4), but the account's real pUSD does
// not move until the redemption, so unredeemed wins could leave the agent's next buys short of pUSD at the venue. Live-prep's
// resolved dust and Davies' own resolved positions are the same account's: redeeming is value-neutral (it only turns
// resolved tokens into pUSD; a losing token pays 0 and is cleared), so every redeemable position of the account is taken.
//
// How (research 2026-10-17, from Polymarket's sources, not memory):
//   - The account is a POLY_PROXY wallet (signature type 1): a Polymarket proxy wallet owned by the Magic EOA. The EOA
//     acts through the ProxyWalletFactory's `proxy((uint8 typeCode, address to, uint256 value, bytes data)[])`, which runs
//     each call FROM the proxy wallet (proxy-factories, ProxyWalletFactory.sol; typeCode 1 = CALL).
//   - Its markets are CTF markets (Gamma `version` "v1"): the outcome tokens are ERC-1155s in Conditional Tokens. Since the
//     pUSD migration a CTF market is redeemed through a collateral adapter, which pulls the caller's FULL balance of both
//     outcomes, redeems them on the legacy CTF and pays pUSD: `redeemPositions(address, bytes32, bytes32 conditionId,
//     uint256[])` on the CtfCollateralAdapter for a standard market and on the NegRiskCtfCollateralAdapter for a neg-risk
//     one (ctf-exchange-v2 `src/adapters/*.sol`, commit ccc0596; docs.polymarket.com trading/positions/manage). Only the
//     condition id is read; the call passes pUSD, a zero parent collection and [1, 2], as the docs show. The proxy wallet
//     has approved both adapters on Conditional Tokens (`isApprovedForAll`, read keylessly 2026-10-17). A market of
//     `version` "v2" (PositionManager, the Router's `redeem`) is not handled: it is listed as skipped.
//   - The transaction goes through Polymarket's gasless relayer (`relayer-v2.polymarket.com`), as polymarket.com's own
//     redemptions do: the EOA signs the relay hash of the factory call (builder-relayer-client `src/builder/proxy.ts`,
//     commit 9fe0514: keccak256("rlx:" ‖ from ‖ to ‖ data ‖ fee ‖ gasPrice ‖ gasLimit ‖ nonce ‖ relayHub ‖ relay), signed
//     as a personal message), and the relayer pays the gas. So nothing needs POL. It needs a Relayer API key (headers
//     `RELAYER_API_KEY`, `RELAYER_API_KEY_ADDRESS`), which Davies creates at polymarket.com → Settings → API Keys →
//     Relayer API Keys and stores as the Edge Function secrets `POLYMARKET_RELAYER_API_KEY` and
//     `POLYMARKET_RELAYER_API_KEY_ADDRESS`. Without it a run plans and sends nothing.
//
// What a run does (hourly, `grokpm?action=redeem`, eu-west-1, the scheduler's bearer): settle the attempts in flight
// (relayer state, then the receipt); then, with none in flight, read the account's redeemable positions keylessly (data
// API), check each market on Gamma and each token's balance on chain, and choose at most `GROKPM_REDEEM.perRun` markets,
// the largest payout first. With `grokpm_config.redeem_enabled` false (the default) it records what it WOULD redeem and
// sends nothing. Enabled, it sends ONE relayed transaction carrying them all (one relay nonce a run, so a second
// transaction never races the first), each market a row of `grokpm_redeems` written before the relayer is called.
//
// The book. Nothing here writes a fill: GROKPM's book (`exec.ts` `ledgerOf`) counts its fills and the resolutions
// (`grokpm_resolutions`), and the keyless record (`agents/grokpm_rec.ts` `agentBook`) counts TRADE activity matched to
// those fills; a REDEEM activity item is neither, so a redemption changes neither figure. Pinned in redeem.test.ts.
//
// Secrets: the signing key is the order path's (`loadPmLiveEnv`, held where nothing prints it); the relayer key travels
// only in its header and is scrubbed from every message. No address is returned to the agent: this action takes the
// scheduler's bearer only.

import { keccak_256 } from "npm:@noble/hashes@2.0.1/sha3.js";
import type { PmSigner } from "../_shared/polymarket_orders.ts";
import type { Db } from "../agents/db.ts";

export const PM_CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
export const PM_CTF_ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f";
export const PM_NEG_RISK_CTF_ADAPTER = "0xadA2005600Dec949baf300f4C6120000bDB6eAab";
export const PM_PUSD = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
export const PM_PROXY_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052";
/** The relay hub the relayer's PROXY transactions name (builder-relayer-client `src/config`, Polygon). */
export const PM_RELAY_HUB = "0xD216153c06E857cD7f72665E0aF1d7D82172F494";
/** The proxy wallet's CREATE2 init-code hash (builder-relayer-client `src/constants`). */
export const PM_PROXY_INIT_CODE_HASH = "0xd21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b";
export const PM_RELAYER = "https://relayer-v2.polymarket.com";
export const PM_DATA_API = "https://data-api.polymarket.com";
export const PM_GAMMA_API = "https://gamma-api.polymarket.com";
export const PM_RPC = "https://polygon-bor-rpc.publicnode.com";
const HOSTS = new Set([PM_RELAYER, PM_DATA_API, PM_GAMMA_API, PM_RPC].map((u) => new URL(u).host));

export const GROKPM_REDEEM = {
  /** Markets one run redeems, at most: one relayed transaction a run; 5 keeps its gas (≈ 0.27–0.53 M a market, read by
   *  eth_estimateGas 2026-10-17) under ~3 M, and at one run an hour that is 120 markets a day. */
  perRun: 5,
  /** No minimum value: the relayer pays the gas, so a losing (zero) position is cleared too, after every paying one. */
  /** An attempt not final after this long is closed as `expired` (a later run may try its markets again: a second
   *  redemption of a market already redeemed moves nothing). */
  staleMs: 2 * 3600e3,
  /** A market redeemed (confirmed) this recently is not tried again while the data API still lists it. */
  confirmedQuietMs: 6 * 3600e3,
  /** A market whose attempts failed this many times in a day waits for a person. */
  maxFailsDay: 3,
  timeoutMs: 8_000,
} as const;

// ── encoding (pinned against vectors computed independently, by viem, in redeem.test.ts) ─────────────────────────────

const enc = new TextEncoder();
const hex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
function bytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error("not hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}
const word = (v: bigint) => v.toString(16).padStart(64, "0");
const addrWord = (a: string) => { if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("not an address"); return a.slice(2).toLowerCase().padStart(64, "0"); };
const b32 = (h: string) => { if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("not 32 bytes"); return h.slice(2).toLowerCase(); };
const selector = (sig: string) => hex(keccak_256(enc.encode(sig))).slice(2, 10);
export const keccakHex = (h: string) => hex(keccak_256(bytes(h)));

/** `redeemPositions(pUSD, 0x0, conditionId, [1, 2])`: the adapters read only the condition id. */
export function redeemCalldata(conditionId: string): string {
  return "0x" + selector("redeemPositions(address,bytes32,bytes32,uint256[])") + addrWord(PM_PUSD) + word(0n) + b32(conditionId) + word(128n) + word(2n) + word(1n) + word(2n);
}

/** `proxy((uint8,address,uint256,bytes)[])`: each call a CALL (typeCode 1) of value 0 from the proxy wallet. */
export function proxyCalldata(calls: Array<{ to: string; data: string }>): string {
  const tuples = calls.map((c) => {
    const d = c.data.slice(2).toLowerCase(), len = d.length / 2;
    return word(1n) + addrWord(c.to) + word(0n) + word(128n) + word(BigInt(len)) + d.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let offset = 32n * BigInt(calls.length), heads = "";
  for (const t of tuples) { heads += word(offset); offset += BigInt(t.length / 2); }
  return "0x" + selector("proxy((uint8,address,uint256,bytes)[])") + word(32n) + word(BigInt(calls.length)) + heads + tuples.join("");
}

/** The relay hash the EOA signs for a PROXY transaction (builder-relayer-client's `createStructHash`). */
export function relayStructHash(p: { from: string; to: string; data: string; fee: string; gasPrice: string; gasLimit: string; nonce: string; relayHub: string; relay: string }): string {
  const a = (x: string) => addrWord(x).slice(24);
  return keccakHex(hex(enc.encode("rlx:")) + a(p.from) + a(p.to) + p.data.slice(2) + word(BigInt(p.fee)) + word(BigInt(p.gasPrice)) + word(BigInt(p.gasLimit)) + word(BigInt(p.nonce)) + a(p.relayHub) + a(p.relay));
}

/** EIP-191: what a wallet signs for `signMessage({ raw: hash })`. */
export function personalDigest(hash32: string): string {
  return keccakHex(hex(enc.encode("\x19Ethereum Signed Message:\n32")) + b32(hash32));
}

/** The proxy wallet an EOA owns (CREATE2 from the factory, salt keccak256(eoa)), lower case. */
export function proxyWalletOf(eoa: string): string {
  const salt = keccakHex(addrWord(eoa).slice(24));
  return "0x" + keccakHex("ff" + addrWord(PM_PROXY_FACTORY).slice(24) + salt.slice(2) + PM_PROXY_INIT_CODE_HASH.slice(2)).slice(26);
}

/** ERC-1155 `balanceOf(owner, id)` for an eth_call. */
export function balanceOfCalldata(owner: string, tokenId: string): string {
  return "0x" + selector("balanceOf(address,uint256)") + addrWord(owner) + word(BigInt(tokenId));
}

// ── the choice ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type RedeemToken = { token: string; outcomeIndex: number | null; size: number; payout: number };
export type RedeemPlanItem = { cond: string; negRisk: boolean; adapter: string; tokens: RedeemToken[]; size: number; payoutUsd: number; title: string | null };
export type RedeemSkip = { cond: string; why: string; title: string | null };
export type RedeemAttempt = { cond: string; status: string; at: string };

/**
 * Which markets a run redeems: the data API's redeemable positions grouped by market, each checked against Gamma (closed,
 * not a "v2" market, its neg-risk flag as Gamma has it) and against the chain (a token's balance, in whole units; a market
 * holding none is already redeemed), less a market with an attempt in flight, one confirmed in the last six hours, or
 * three failures today. The largest payout first, then the largest size; at most `perRun`.
 */
export function chooseRedemptions(p: {
  positions: Array<Record<string, unknown>>; gamma: Map<string, { closed: boolean; negRisk: boolean; version: string | null }>;
  balances: Map<string, number>; attempts: RedeemAttempt[]; nowMs: number; perRun?: number;
}): { plan: RedeemPlanItem[]; skipped: RedeemSkip[] } {
  const byCond = new Map<string, { negRisk: boolean | null; title: string | null; tokens: RedeemToken[] }>();
  for (const x of p.positions) {
    if (x.redeemable !== true) continue;
    const cond = String(x.conditionId ?? "").toLowerCase(), token = String(x.asset ?? "");
    if (!/^0x[0-9a-f]{64}$/.test(cond) || !/^[0-9]{1,80}$/.test(token)) continue;
    const g = byCond.get(cond) ?? { negRisk: typeof x.negativeRisk === "boolean" ? x.negativeRisk : null, title: typeof x.title === "string" ? x.title.slice(0, 120) : null, tokens: [] };
    const payout = Number(x.curPrice);
    g.tokens.push({ token, outcomeIndex: Number.isInteger(x.outcomeIndex) ? Number(x.outcomeIndex) : null, size: Number(x.size) || 0, payout: payout === 0 || payout === 1 || payout === 0.5 ? payout : NaN });
    byCond.set(cond, g);
  }
  const plan: RedeemPlanItem[] = [], skipped: RedeemSkip[] = [];
  for (const [cond, g] of byCond) {
    const skip = (why: string) => skipped.push({ cond, why, title: g.title });
    const m = p.gamma.get(cond);
    if (!m) { skip("Gamma does not list it"); continue; }
    if (!m.closed) { skip("not closed on Gamma"); continue; }
    if (m.version === "v2") { skip("a v2 market (PositionManager): not handled here"); continue; }
    if (g.negRisk !== null && g.negRisk !== m.negRisk) { skip("the data API and Gamma disagree on neg-risk"); continue; }
    const mine = p.attempts.filter((a) => a.cond === cond);
    if (mine.some((a) => a.status === "pending" || a.status === "submitted")) { skip("an attempt is in flight"); continue; }
    if (mine.some((a) => a.status === "confirmed" && p.nowMs - Date.parse(a.at) < GROKPM_REDEEM.confirmedQuietMs)) { skip("redeemed in the last six hours"); continue; }
    if (mine.filter((a) => a.status === "failed" && p.nowMs - Date.parse(a.at) < 86400e3).length >= GROKPM_REDEEM.maxFailsDay) { skip("failed three times today: left for a person"); continue; }
    if (g.tokens.some((t) => !Number.isFinite(t.payout))) { skip("a payout that is not 0, ½ or 1"); continue; }
    const tokens = g.tokens.map((t) => ({ ...t, size: p.balances.has(t.token) ? p.balances.get(t.token)! : t.size }));
    if (!tokens.some((t) => t.size > 0)) { skip("nothing left on chain: already redeemed"); continue; }
    const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
    plan.push({
      cond, negRisk: m.negRisk, adapter: m.negRisk ? PM_NEG_RISK_CTF_ADAPTER : PM_CTF_ADAPTER, tokens, title: g.title,
      size: r6(tokens.reduce((s, t) => s + t.size, 0)), payoutUsd: r6(tokens.reduce((s, t) => s + t.size * t.payout, 0)),
    });
  }
  plan.sort((a, b) => b.payoutUsd - a.payoutUsd || b.size - a.size || a.cond.localeCompare(b.cond));
  const n = p.perRun ?? GROKPM_REDEEM.perRun;
  for (const x of plan.slice(n)) skipped.push({ cond: x.cond, why: `over this run's ${n}: next run`, title: x.title });
  return { plan: plan.slice(0, n), skipped };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RedeemDeps = {
  db: Db; now: number; region: string | null; fetchImpl?: typeof fetch;
  /** The proxy wallet (the account) and the EOA that owns it, and the EOA's key (the order path's). */
  wallet: string | null; eoa: string | null; signer: PmSigner | null; keyProblem: string | null;
  /** The Relayer API key and the address it belongs to; null when the secrets are not set. */
  relayer: { key: string; address: string } | null;
};
export type RedeemRow = {
  id: number; created_at: string; updated_at: string; cond: string; neg_risk: boolean; adapter: string; tokens: unknown; size: number | string; payout_usd: number | string;
  relay_id: string | null; tx_hash: string | null; status: "pending" | "submitted" | "confirmed" | "failed" | "expired"; error: string | null;
};
export type RedeemReport = {
  mode: "dry_run" | "live"; settled: number; inFlight: number; plan: RedeemPlanItem[]; skipped: RedeemSkip[]; sent: boolean; relayId: string | null; errors: string[];
  /** What would stop a send now besides a redemption in flight (read in a dry run too): empty when enabling it would send. */
  blockedBy: string[];
};

/** A keyless (or relayer-keyed) JSON request to one of four hosts, with its time limit; the relayer key never in a message. */
async function call(d: RedeemDeps, url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.host)) throw new Error(`host not allowed: ${u.host}`);
  const res = await (d.fetchImpl ?? fetch)(u.href, { ...init, redirect: "manual", signal: AbortSignal.timeout(GROKPM_REDEEM.timeoutMs) });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}
const scrubbed = (d: RedeemDeps, s: string) => (d.relayer?.key ? s.split(d.relayer.key).join("[redacted]") : s).slice(0, 300);
async function rpc(d: RedeemDeps, method: string, params: unknown[]): Promise<unknown> {
  const r = await call(d, PM_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const b = r.body as { result?: unknown; error?: { message?: string } } | null;
  if (r.status !== 200 || !b || b.error) throw new Error(`rpc ${method}: ${r.status} ${b?.error?.message ?? ""}`.trim());
  return b.result;
}

/** One run (see the header). Writes only `grokpm_redeems` and `grokpm_exec_state.redeem_state`. */
export async function runRedeem(d: RedeemDeps): Promise<RedeemReport> {
  const { db, now } = d, nowIso = new Date(now).toISOString();
  const errors: string[] = [];
  const cfg = (await db.select<{ redeem_enabled: boolean | null }>("grokpm_config", "id=eq.1&select=redeem_enabled"))[0];
  const enabled = cfg?.redeem_enabled === true;
  const report: RedeemReport = { mode: enabled ? "live" : "dry_run", settled: 0, inFlight: 0, plan: [], skipped: [], sent: false, relayId: null, errors, blockedBy: [] };

  // 1. The attempts in flight: the relayer's state, then the receipt.
  const open = await db.select<RedeemRow>("grokpm_redeems", "status=in.(pending,submitted)&select=*&order=id.asc&limit=100");
  const groups = new Map<string, RedeemRow[]>();
  for (const r of open) groups.set(r.relay_id ?? `row-${r.id}`, [...(groups.get(r.relay_id ?? `row-${r.id}`) ?? []), r]);
  for (const [key, rows] of groups) {
    const set = async (patch: Record<string, unknown>) => { for (const r of rows) await db.update("grokpm_redeems", `id=eq.${r.id}`, { ...patch, updated_at: nowIso }); };
    const age = now - Date.parse(rows[0].created_at);
    try {
      let txHash = rows[0].tx_hash, state: string | null = null;
      if (rows[0].relay_id) {
        const t = await call(d, `${PM_RELAYER}/transaction?id=${encodeURIComponent(rows[0].relay_id)}`);
        const x = (Array.isArray(t.body) ? t.body[0] : null) as { state?: string; transactionHash?: string } | null;
        state = x?.state ?? null;
        if (x?.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(x.transactionHash)) txHash = x.transactionHash.toLowerCase();
      }
      if (state === "STATE_FAILED" || state === "STATE_INVALID") { await set({ status: "failed", tx_hash: txHash, error: `relayer: ${state}` }); report.settled += rows.length; continue; }
      if (txHash) {
        const rc = await rpc(d, "eth_getTransactionReceipt", [txHash]) as { status?: string } | null;
        if (rc?.status === "0x1") { await set({ status: "confirmed", tx_hash: txHash, error: null }); report.settled += rows.length; continue; }
        if (rc?.status === "0x0") { await set({ status: "failed", tx_hash: txHash, error: "the transaction reverted" }); report.settled += rows.length; continue; }
      }
      if (!rows[0].relay_id && age > 10 * 60e3) { await set({ status: "failed", error: "no relayer answer was recorded for it" }); report.settled += rows.length; continue; }
      if (age > GROKPM_REDEEM.staleMs) { await set({ status: "expired", tx_hash: txHash, error: `not final after ${Math.round(age / 60e3)} min (relayer ${state ?? "unread"})` }); report.settled += rows.length; errors.push(`redemption ${key} not final after two hours`); continue; }
      if (txHash !== rows[0].tx_hash) await set({ tx_hash: txHash });
      report.inFlight += rows.length;
    } catch (e) {
      errors.push(`attempt ${key}: ${scrubbed(d, (e as Error).message)}`);
      report.inFlight += rows.length;
    }
  }

  // 2. What is redeemable now, keylessly.
  if (!d.wallet) { errors.push("no account wallet loaded"); return finish(d, report); }
  const wallet = d.wallet.toLowerCase();
  try {
    const pos = await call(d, `${PM_DATA_API}/positions?user=${wallet}&redeemable=true&sizeThreshold=0&limit=500&_=${Math.floor(now / 60e3)}`);
    if (pos.status !== 200 || !Array.isArray(pos.body)) throw new Error(`positions: ${pos.status}`);
    const positions = (pos.body as Array<Record<string, unknown>>).filter((x) => x && x.redeemable === true);
    const conds = [...new Set(positions.map((x) => String(x.conditionId ?? "").toLowerCase()).filter((c) => /^0x[0-9a-f]{64}$/.test(c)))];
    const gamma = new Map<string, { closed: boolean; negRisk: boolean; version: string | null }>();
    for (let i = 0; i < conds.length; i += 20) {
      const qs = new URLSearchParams([["limit", "20"], ["closed", "true"], ...conds.slice(i, i + 20).map((c) => ["condition_ids", c] as [string, string])]);
      const g = await call(d, `${PM_GAMMA_API}/markets/keyset?${qs}`);
      const ms = (g.body as { markets?: Array<Record<string, unknown>> } | null)?.markets ?? [];
      for (const m of ms) gamma.set(String(m.conditionId ?? "").toLowerCase(), { closed: m.closed === true, negRisk: m.negRisk === true, version: typeof m.version === "string" ? m.version : null });
    }
    const balances = new Map<string, number>();
    for (const x of positions) {
      const token = String(x.asset ?? "");
      if (!/^[0-9]{1,80}$/.test(token) || balances.has(token)) continue;
      try { balances.set(token, Number(BigInt(String(await rpc(d, "eth_call", [{ to: PM_CTF, data: balanceOfCalldata(wallet, token) }, "latest"])))) / 1e6); }
      catch (e) { errors.push(`balance of a token unread: ${scrubbed(d, (e as Error).message)}`); }
    }
    const attempts = (await db.select<RedeemRow>("grokpm_redeems", `created_at=gte.${encodeURIComponent(new Date(now - 86400e3).toISOString())}&select=cond,status,created_at,updated_at&order=id.asc&limit=1000`))
      .map((r) => ({ cond: r.cond, status: r.status, at: r.updated_at ?? r.created_at }));
    // The rows just settled count as they now are.
    const c = chooseRedemptions({ positions, gamma, balances, attempts, nowMs: now });
    report.plan = c.plan; report.skipped = c.skipped;
  } catch (e) { errors.push(`redeemable positions unread: ${scrubbed(d, (e as Error).message)}`); return finish(d, report); }

  // 3. Send: enabled, nothing in flight, every gate open. The gates are read in a dry run too, so its record says whether
  // enabling it would send (`blockedBy`).
  const why: string[] = [];
  if (report.inFlight) why.push("a redemption is in flight");
  if (d.region !== "eu-west-1") why.push(`region ${d.region ?? "unknown"}, not eu-west-1`);
  if (!d.signer || !d.eoa || d.keyProblem) why.push(d.keyProblem ?? "no signing key loaded");
  if (!d.relayer) why.push("no Relayer API key: set POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS");
  else if (d.eoa && d.relayer.address.toLowerCase() !== d.eoa.toLowerCase()) why.push("the Relayer API key's address is not the account's signer");
  if (d.eoa && proxyWalletOf(d.eoa) !== wallet) why.push("the signer's proxy wallet is not the account");
  const pause = (await db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause").catch(() => [{ global_pause: true }]))[0];
  if (pause?.global_pause !== false) why.push("the global pause is on (or unreadable)");
  report.blockedBy = why.filter((w) => w !== "a redemption is in flight");
  if (!enabled || !report.plan.length) return finish(d, report);
  if (why.length) { if (!report.inFlight || why.length > 1) errors.push(`not sent: ${why.join("; ")}`); return finish(d, report); }

  const eoa = d.eoa!, rel = d.relayer!;
  let ids: number[] = [];
  try {
    const data = proxyCalldata(report.plan.map((x) => ({ to: x.adapter, data: redeemCalldata(x.cond) })));
    const gasLimit = BigInt(String(await rpc(d, "eth_estimateGas", [{ from: eoa, to: PM_PROXY_FACTORY, data }]))).toString();
    const rp = await call(d, `${PM_RELAYER}/relay-payload?address=${eoa}&type=PROXY`);
    const relay = (rp.body as { address?: string } | null)?.address, nonce = (rp.body as { nonce?: unknown } | null)?.nonce;
    if (rp.status !== 200 || !relay || !/^0x[0-9a-fA-F]{40}$/.test(relay) || !/^\d+$/.test(String(nonce))) throw new Error(`relay payload: ${rp.status}`);
    const hash = relayStructHash({ from: eoa, to: PM_PROXY_FACTORY, data, fee: "0", gasPrice: "0", gasLimit, nonce: String(nonce), relayHub: PM_RELAY_HUB, relay });
    const signature = d.signer!.signDigest(personalDigest(hash));
    // The claim first: each market's row, written before the relayer is called.
    const rows = await db.insert<{ id: number }>("grokpm_redeems", report.plan.map((x) => ({
      created_at: nowIso, updated_at: nowIso, cond: x.cond, neg_risk: x.negRisk, adapter: x.adapter, tokens: x.tokens, size: x.size, payout_usd: x.payoutUsd, status: "pending",
    })), true);
    ids = rows.map((r) => r.id);
    const body = {
      from: eoa, to: PM_PROXY_FACTORY, proxyWallet: wallet, data, nonce: String(nonce), signature,
      signatureParams: { gasPrice: "0", gasLimit, relayerFee: "0", relayHub: PM_RELAY_HUB, relay }, type: "PROXY", metadata: "Redeem positions",
    };
    const s = await call(d, `${PM_RELAYER}/submit`, {
      method: "POST", headers: { "Content-Type": "application/json", RELAYER_API_KEY: rel.key, RELAYER_API_KEY_ADDRESS: rel.address }, body: JSON.stringify(body),
    });
    const b = s.body as { transactionID?: string; state?: string; transactionHash?: string } | null;
    if (s.status !== 200 || !b?.transactionID) throw new Error(`relayer submit: ${s.status} ${scrubbed(d, JSON.stringify(s.body ?? "")).slice(0, 160)}`);
    for (const id of ids) await db.update("grokpm_redeems", `id=eq.${id}`, { relay_id: String(b.transactionID).slice(0, 128), status: "submitted", tx_hash: /^0x[0-9a-fA-F]{64}$/.test(String(b.transactionHash ?? "")) ? String(b.transactionHash).toLowerCase() : null, updated_at: nowIso });
    report.sent = true; report.relayId = String(b.transactionID);
  } catch (e) {
    const msg = scrubbed(d, (e as Error).message);
    errors.push(`redemption not sent: ${msg}`);
    for (const id of ids) await db.update("grokpm_redeems", `id=eq.${id}`, { status: "failed", error: msg, updated_at: nowIso }).catch(() => {});
  }
  return finish(d, report);
}

/** The run's last word, kept in its own column of the exec state (the minute's sync writes the other columns). */
async function finish(d: RedeemDeps, r: RedeemReport): Promise<RedeemReport> {
  const state = {
    at: new Date(d.now).toISOString(), mode: r.mode, sent: r.sent, relayId: r.relayId, inFlight: r.inFlight, blockedBy: r.blockedBy,
    plan: r.plan.map((x) => ({ cond: x.cond, title: x.title, negRisk: x.negRisk, size: x.size, payoutUsd: x.payoutUsd })),
    skipped: r.skipped.slice(0, 30), errors: r.errors.slice(0, 10),
  };
  await d.db.update("grokpm_exec_state", "id=eq.1", { redeem_state: state }).catch((e) => { r.errors.push(`state not written: ${(e as Error).message.slice(0, 120)}`); });
  return r;
}
