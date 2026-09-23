// Deribit REST (JSON-RPC over HTTP), READ-ONLY. Nothing in this file can trade, transfer or withdraw: it exists so the
// agents probe can tell what a key is allowed to do, and to read the implied-volatility index (DVOL) the key is most
// useful for while the account cannot be funded (reference §6). Authentication is `public/auth` with
// `grant_type: client_credentials`, sent in a POST body so the secret never sits in a URL; the reply's access token
// goes in `Authorization: Bearer` and is never returned by the probe, nor is the secret or any balance.

export const DERIBIT_BASE = "https://www.deribit.com/api/v2";

/** Every method the probe may call. A test fails if the probe asks for anything else. */
export const DERIBIT_READ_METHODS = ["public/get_index_price", "public/auth", "private/get_account_summary", "public/get_volatility_index_data"] as const;

export type DeribitEnv = { clientId: string; clientSecret: string; base?: string; fetchImpl?: typeof fetch; now?: () => number };
type Reply = { ok: boolean; status: number; result?: any; error?: string };

async function rpc(env: DeribitEnv, method: string, params: Record<string, unknown>, token?: string): Promise<Reply> {
  if (!(DERIBIT_READ_METHODS as readonly string[]).includes(method)) return { ok: false, status: 0, error: `not a read method: ${method}` };
  try {
    const res = await (env.fetchImpl ?? fetch)(`${env.base ?? DERIBIT_BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text below */ }
    if (!res.ok || data?.error) {
      const e = data?.error;
      return { ok: false, status: res.status, error: e ? `${e.code ?? ""} ${e.message ?? ""}${e.data?.reason ? ` (${e.data.reason})` : ""}`.trim() : text.slice(0, 200) };
    }
    return { ok: true, status: res.status, result: data?.result };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What the key may do, and the DVOL series, read-only. */
export async function deribitProbe(env: DeribitEnv): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const now = (env.now ?? Date.now)();
  const idx = await rpc(env, "public/get_index_price", { index_name: "btc_usd" });
  out.reachable = idx.ok ? { status: idx.status } : { status: idx.status, error: idx.error };
  if (!idx.ok) return out;
  const auth = await rpc(env, "public/auth", { grant_type: "client_credentials", client_id: env.clientId, client_secret: env.clientSecret });
  out.auth = auth.ok ? { status: auth.status, scope: auth.result?.scope ?? null, expiresInS: auth.result?.expires_in ?? null } : { status: auth.status, error: auth.error };
  if (auth.ok && auth.result?.access_token) {
    const acct = await rpc(env, "private/get_account_summary", { currency: "BTC" }, auth.result.access_token);
    // Which fields a summary has, and whether the account holds anything at all — not how much.
    out.account = acct.ok
      ? { status: acct.status, fields: Object.keys(acct.result ?? {}).length, funded: Number(acct.result?.equity ?? 0) > 0 }
      : { status: acct.status, error: acct.error };
  }
  for (const currency of ["BTC", "ETH"]) {
    const dv = await rpc(env, "public/get_volatility_index_data", { currency, resolution: "1D", start_timestamp: now - 10 * 86_400_000, end_timestamp: now });
    const rows = dv.ok ? (dv.result?.data ?? []) : [];
    out[`dvol${currency}`] = dv.ok ? { status: dv.status, days: rows.length, last: rows.at(-1) ?? null } : { status: dv.status, error: dv.error };
  }
  return out;
}
