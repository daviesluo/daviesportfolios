// Binance (binance.com) spot REST, READ-ONLY. Nothing in this file can place, cancel or withdraw: it exists so the
// agents probe can tell what a key is allowed to do before anything depends on it (reference §6). Signed endpoints
// take `timestamp` (and `recvWindow`) in the query and an HMAC-SHA256 of the whole query string, as lower-case hex, in
// `signature`; the key id goes in `X-MBX-APIKEY`. The documented example is pinned in binance.test.ts.
//
// The probe reports permissions, fee rates, symbol rules and WHICH assets hold a balance — never an amount, and never
// a byte of either key. The page's VENUES card (`binanceAccount`) does show the amounts: it is behind the app's
// password like every other balance on that page, and nothing it reads is ever written to the repository.

export const BINANCE_BASE = "https://api.binance.com";

/** Every path the probe may call. A test fails if the probe asks for anything else. */
export const BINANCE_READ_PATHS = ["/api/v3/time", "/api/v3/account", "/sapi/v1/account/apiRestrictions", "/sapi/v1/asset/tradeFee", "/api/v3/exchangeInfo"] as const;

export type BinanceEnv = { apiKey: string; secret: string; base?: string; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number };
type Reply = { ok: boolean; status: number; data?: any; error?: string };

/** HMAC-SHA256 of the query string, hex: Binance's `signature`. */
export async function binanceSignature(query: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(query)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function call(env: BinanceEnv, path: string, params: Record<string, string>, signed: boolean): Promise<Reply> {
  if (!(BINANCE_READ_PATHS as readonly string[]).includes(path)) return { ok: false, status: 0, error: `not a read path: ${path}` };
  let q = new URLSearchParams(params).toString();
  if (signed) {
    q = new URLSearchParams({ ...params, recvWindow: "10000", timestamp: String((env.now ?? Date.now)()) }).toString();
    q += `&signature=${await binanceSignature(q, env.secret)}`;
  }
  try {
    const res = await (env.fetchImpl ?? fetch)(`${env.base ?? BINANCE_BASE}${path}${q ? `?${q}` : ""}`, {
      headers: signed ? { "X-MBX-APIKEY": env.apiKey } : {},
      signal: AbortSignal.timeout(env.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text below */ }
    if (!res.ok) return { ok: false, status: res.status, error: typeof data?.msg === "string" ? `${data.code ?? ""} ${data.msg}`.trim() : text.slice(0, 200) };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The filters an order would have to respect, from one exchangeInfo symbol. */
export function symbolRules(s: any): Record<string, unknown> {
  const f = (t: string) => (s?.filters ?? []).find((x: any) => x.filterType === t) ?? null;
  const lot = f("LOT_SIZE"), price = f("PRICE_FILTER"), notional = f("NOTIONAL") ?? f("MIN_NOTIONAL");
  return {
    status: s?.status ?? null,
    stepSize: lot?.stepSize ?? null, minQty: lot?.minQty ?? null,
    tickSize: price?.tickSize ?? null,
    minNotional: notional?.minNotional ?? null,
    orderTypes: s?.orderTypes ?? null,
  };
}

/** What a key may do and at what price, read-only. `symbols` in Binance's form (`BTCUSDT`). */
export async function binanceProbe(env: BinanceEnv, symbols: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Reachability first, with no key: a 451 or 403 here is the REGION being refused, not the key.
  const t = await call(env, "/api/v3/time", {}, false);
  out.reachable = t.ok ? { status: t.status, clockSkewMs: Number(t.data?.serverTime) - (env.now ?? Date.now)() } : { status: t.status, error: t.error };
  if (!t.ok) return out;
  const a = await call(env, "/api/v3/account", { omitZeroBalances: "true" }, true);
  out.account = a.ok
    ? {
      status: a.status, accountType: a.data?.accountType ?? null, canTrade: a.data?.canTrade ?? null,
      canWithdraw: a.data?.canWithdraw ?? null, canDeposit: a.data?.canDeposit ?? null,
      permissions: a.data?.permissions ?? null, commissionRates: a.data?.commissionRates ?? null,
      assetsHeld: (a.data?.balances ?? []).filter((b: any) => Number(b.free) + Number(b.locked) > 0).map((b: any) => b.asset),
    }
    : { status: a.status, error: a.error };
  const r = await call(env, "/sapi/v1/account/apiRestrictions", {}, true);
  out.restrictions = r.ok ? { status: r.status, ...r.data } : { status: r.status, error: r.error };
  const fee = await call(env, "/sapi/v1/asset/tradeFee", { symbol: symbols[0] ?? "BTCUSDT" }, true);
  out.tradeFee = fee.ok ? { status: fee.status, rows: fee.data } : { status: fee.status, error: fee.error };
  const ex = await call(env, "/api/v3/exchangeInfo", { symbols: JSON.stringify(symbols) }, false);
  if (ex.ok) {
    const rules: Record<string, unknown> = {};
    for (const s of ex.data?.symbols ?? []) rules[s.symbol] = symbolRules(s);
    out.symbols = { status: ex.status, rules };
  } else {
    out.symbols = { status: ex.status, error: ex.error };
  }
  return out;
}

/** The account as the VENUES card shows it: may the key trade, what the account pays, and what it holds. Pure. */
export function binanceAccountView(data: any): { canTrade: boolean; feeBps: { maker: number; taker: number } | null; balances: Record<string, number> } {
  // `commissionRates` are fractions as strings ("0.00100000" is 10 bps); a missing or unreadable one leaves the fee unknown.
  const bps = (x: unknown) => (x == null || x === "" ? NaN : Math.round(Number(x) * 1e6) / 100);
  const maker = bps(data?.commissionRates?.maker), taker = bps(data?.commissionRates?.taker);
  const balances: Record<string, number> = {};
  for (const b of Array.isArray(data?.balances) ? data.balances : []) {
    const amount = Number(b?.free) + Number(b?.locked);
    if (typeof b?.asset === "string" && Number.isFinite(amount) && amount > 0) balances[b.asset] = amount;
  }
  return { canTrade: data?.canTrade === true, feeBps: Number.isFinite(maker) && Number.isFinite(taker) ? { maker, taker } : null, balances };
}

/** One signed read of the account, for the page. Read-only like everything here; `timeoutMs` keeps a slow reply off the page. */
export async function binanceAccount(env: BinanceEnv): Promise<{ ok: true; view: ReturnType<typeof binanceAccountView> } | { ok: false; error: string }> {
  const a = await call(env, "/api/v3/account", { omitZeroBalances: "true" }, true);
  return a.ok ? { ok: true, view: binanceAccountView(a.data) } : { ok: false, error: `account${a.status ? ` ${a.status}` : ""}: ${a.error ?? "no reply"}` };
}
