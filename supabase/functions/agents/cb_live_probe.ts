// The Coinbase key's probe (`agents?action=cblive&mode=probe`, operator only): GETs alone, through a client that cannot
// POST (`cbClient` with `post` false throws before any request). Davies stored the key on 2026-10-29 as the function's
// secrets `COINBASE_API_KEY_NAME` and `COINBASE_API_PRIVATE_KEY`; this reads them and answers, in the HTTP response only:
//   * the secrets' forms, never their values (`cbKeyForm`: the key name's shape, PEM SEC1 or PKCS#8, literal "\n"s);
//   * whether Coinbase accepted the signed JWT, and what the key may do (`GET /key_permissions`: view, trade, TRANSFER,
//     its portfolio). A key that can transfer (deposit or withdraw) is a loud warning: the live path needs view and trade
//     only, and Davies should replace it;
//   * the GBP, USDC and EUR balances (available and on hold), product USDC-GBP's increments and status, the touch, the
//     fee tier, and how many orders rest on USDC-GBP.
// Nothing is written: no table, no log line with a balance. A failed step says why and the others still run.

import { CB_ALIVE, cbClientFromEnv, CbHttpError, type CbKeyPermissions } from "../_shared/coinbase.ts";

export const CB_PROBE_PRODUCT = "USDC-GBP";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Pure: the warnings a key's permissions carry. */
export function permissionWarnings(p: CbKeyPermissions | null): string[] {
  if (!p) return ["the key's permissions could not be read"];
  const w: string[] = [];
  if (p.can_transfer) w.push("WARNING: this key can TRANSFER (deposit or withdraw) funds. The live path needs view and trade only: create a new key without transfer and replace the secrets.");
  if (!p.can_view) w.push("the key cannot view: it can read no balance or order");
  if (!p.can_trade) w.push("the key cannot trade: the probe works, the live path would not");
  return w;
}

/**
 * Pure: the account's fee tier (`GET /transaction_summary`, its `fee_tier`) as maker and taker per cent. It is the account's
 * spot tier; Coinbase prices stable pairs apart (0 % maker on its fee page), which no endpoint read here confirms.
 */
export function feesOf(t: { pricing_tier?: string; maker_fee_rate?: string; taker_fee_rate?: string } | null) {
  const pct = (r?: string) => (r == null || r === "" || !Number.isFinite(Number(r)) ? null : Number((Number(r) * 100).toFixed(6)));
  return { tier: t?.pricing_tier ?? null, makerPct: pct(t?.maker_fee_rate), takerPct: pct(t?.taker_fee_rate), scope: "the account's spot tier; stable pairs may be priced apart" };
}

export async function runCbLiveProbe(read: (n: string) => string | undefined, fetchImpl?: typeof fetch, now?: () => number): Promise<Record<string, unknown>> {
  const { client, why, form } = await cbClientFromEnv(read, false, fetchImpl, now);
  const out: Record<string, unknown> = { ok: false, secrets: form, warnings: [] as string[] };
  const warnings = out.warnings as string[];
  if (form.name === "other") warnings.push("COINBASE_API_KEY_NAME is neither \"organizations/{org_id}/apiKeys/{key_id}\" nor a bare key id");
  if (form.key === "not-pem") warnings.push("COINBASE_API_PRIVATE_KEY is not a PEM: an Ed25519 secret? Create the CDP key with the ECDSA signature algorithm");
  if (!client) { out.why = why; return out; }
  let accepted = false, rejected = false;
  const step = async (k: string, f: () => Promise<unknown>) => {
    try { out[k] = await f(); accepted = true; }
    catch (e) {
      if (e instanceof CbHttpError && e.status === 401) rejected = true;
      out[k] = { error: msg(e) };
    }
  };
  let perms: CbKeyPermissions | null = null;
  await step("permissions", async () => {
    perms = await client.keyPermissions();
    return { can_view: perms.can_view ?? null, can_trade: perms.can_trade ?? null, can_transfer: perms.can_transfer ?? null, portfolio_type: perms.portfolio_type ?? null, portfolio_uuid: perms.portfolio_uuid ?? null };
  });
  warnings.push(...permissionWarnings(perms));
  await step("balances", async () => {
    const acc = await client.accounts();
    const sum = (c: string, k: "available_balance" | "hold") => acc.filter((a) => a.currency === c).reduce((s, a) => s + Number(a[k]?.value ?? 0), 0);
    return Object.fromEntries(["GBP", "USDC", "EUR"].map((c) => [c, { available: sum(c, "available_balance"), hold: sum(c, "hold"), accounts: acc.filter((a) => a.currency === c).length }]));
  });
  await step("product", async () => {
    const p = await client.product(CB_PROBE_PRODUCT);
    return { product_id: p.product_id, base_increment: p.base_increment, quote_increment: p.quote_increment, base_min_size: p.base_min_size, base_max_size: p.base_max_size ?? null,
      quote_min_size: p.quote_min_size ?? null, status: p.status ?? null, trading_disabled: p.trading_disabled ?? null, cancel_only: p.cancel_only ?? null, limit_only: p.limit_only ?? null, post_only: p.post_only ?? null };
  });
  await step("touch", () => client.bestBidAsk(CB_PROBE_PRODUCT));
  await step("fees", async () => feesOf((await client.feeTier()).fee_tier ?? null));
  const f = out.fees as ReturnType<typeof feesOf> | { error: string } | undefined;
  if (f && "makerPct" in f && f.makerPct != null && f.makerPct > 0) {
    warnings.push(`the account's spot tier charges makers ${f.makerPct} %: the CB-LIVE-RULES study assumed 0 % on the stable pair (each 0.01 % costs about 2 bps a round trip); confirm USDC-GBP's own rate on Coinbase's fee page before arming`);
  }
  await step("openOrders", async () => (await client.listOrders(CB_PROBE_PRODUCT, { open: true })).filter((o) => CB_ALIVE.includes(o.status)).length);
  out.jwt = rejected && !accepted ? "rejected (401): check the key name, the key's algorithm (ECDSA) and its IP allow-list" : accepted ? "accepted" : "unknown";
  out.ok = accepted && !rejected && warnings.every((w) => !w.startsWith("WARNING"));
  return out;
}
