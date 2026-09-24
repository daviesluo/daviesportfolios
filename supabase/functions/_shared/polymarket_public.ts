// Keyless reads of Polymarket's public endpoints, for the paper test of RW (agents/pmrw.ts, reference §3.33 and the
// spec `reviews/2026-09-24-polymarket-rw-paper-spec.md`).
//
// Nothing here reads a credential, signs anything or calls an order endpoint: the account's credentialed read-only
// client is `polymarket.ts`, and this file does not import it. Every call goes to one of three documented hosts,
// follows no redirect, and times out. The one POST is the CLOB's public `/books`, a read that takes its token list
// as a body.
//
// The data API and Gamma answer `cache-control: public, max-age=300` and CloudFront serves repeats of a URL from
// its cache (measured 2026-09-24: a hit 50 s old, the same newest print for 36 s). A print read that must be current
// therefore carries a parameter no earlier request carried (`pmPrints`); a stale Gamma read only delays a settlement.

export const PM_CLOB = "https://clob.polymarket.com";
export const PM_GAMMA = "https://gamma-api.polymarket.com";
export const PM_DATA = "https://data-api.polymarket.com";
const HOSTS = new Set([new URL(PM_CLOB).host, new URL(PM_GAMMA).host, new URL(PM_DATA).host]);
const END_CURSOR = "LTE=";
const UA = "daviesportfolios-rw-paper/1.0 (public data only)";

type Fetch = typeof fetch;
export type PmPublicOpts = { fetchImpl?: Fetch; timeoutMs?: number; clock?: () => number };

/** A book level: price, size (shares). */
export type PmLevel = [number, number];
/** One token's book, best level first on both sides, with the tick the venue reports for it now. */
export type PmBook = { token: string; tick: number | null; bids: PmLevel[]; asks: PmLevel[] };
/** A market's liquidity-reward configuration: its daily pool, its maximum qualifying spread (cents) and minimum size. */
export type PmReward = { cond: string; rate: number; v: number; minSize: number };
/** Gamma's record of a two-token market, reduced to what the paper test reads. */
export type PmMarket = {
  cond: string; yes: string; no: string; tick: number; end: string | null; q: string; cat: string | null;
  accepting: boolean; closed: boolean; closedTime: string | null; payout: number | null;
};
/** A taker print. `oi` is the outcome index (0 = YES); `ts` is Unix seconds. */
export type PmPrint = { id: string; ts: number; side: "BUY" | "SELL"; oi: number; price: number; size: number };

const num = (x: unknown, d = 0): number => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : d;
};

async function call(method: "GET" | "POST", url: string, body: unknown, o: PmPublicOpts): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.host)) throw new Error(`polymarket public: host not allowed: ${u.host}`);
  if (method === "POST" && !(u.host === new URL(PM_CLOB).host && u.pathname === "/books")) throw new Error(`polymarket public: POST only to /books`);
  const res = await (o.fetchImpl ?? fetch)(u.href, {
    method,
    headers: { Accept: "application/json", "User-Agent": UA, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${u.host}${u.pathname} → ${res.status} ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${method} ${u.host}${u.pathname} → not JSON`); }
}

/** Every market in the reward programme (native and sponsored), one row each; a market listed twice keeps its larger rate. */
export async function pmRewardsCurrent(o: PmPublicOpts = {}): Promise<PmReward[]> {
  const out = new Map<string, PmReward>();
  for (const sponsored of ["false", "true"]) {
    let cursor = "";
    for (let page = 0; page < 200; page++) {
      const q = new URLSearchParams({ sponsored });
      if (cursor) q.set("next_cursor", cursor);
      const d = await call("GET", `${PM_CLOB}/rewards/markets/current?${q}`, undefined, o) as { data?: Array<Record<string, unknown>>; next_cursor?: string };
      const rows = d.data ?? [];
      for (const r of rows) {
        const cond = String(r.condition_id ?? "");
        if (!cond) continue;
        const rate = num(r.total_daily_rate) || num(r.native_daily_rate) + num(r.sponsored_daily_rate);
        const cur = out.get(cond);
        if (!cur || rate > cur.rate) out.set(cond, { cond, rate, v: num(r.rewards_max_spread), minSize: num(r.rewards_min_size) });
      }
      cursor = d.next_cursor ?? "";
      if (!cursor || cursor === END_CURSOR || !rows.length) break;
    }
  }
  return [...out.values()];
}

/**
 * The CLOB's list of rewarded markets, reduced to each two-token market's tokens in the venue's order (the YES token
 * first, as Gamma's `clobTokenIds`). About 600 bytes a market against Gamma's 7,900, so the selection can read the
 * tokens of every rewarded market and leave Gamma for the few it chooses.
 */
export async function pmSimplifiedMarkets(o: PmPublicOpts = {}): Promise<Map<string, { yes: string; no: string }>> {
  const out = new Map<string, { yes: string; no: string }>();
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    const d = await call("GET", `${PM_CLOB}/sampling-simplified-markets${cursor ? `?next_cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, o) as { data?: Array<Record<string, unknown>>; next_cursor?: string };
    const rows = d.data ?? [];
    for (const r of rows) {
      const toks = Array.isArray(r.tokens) ? r.tokens as Array<Record<string, unknown>> : [];
      if (toks.length !== 2 || !r.condition_id) continue;
      out.set(String(r.condition_id), { yes: String(toks[0].token_id), no: String(toks[1].token_id) });
    }
    cursor = d.next_cursor ?? "";
    if (!cursor || cursor === END_CURSOR || !rows.length) break;
  }
  return out;
}

/** Gamma's records of `conds`, fifty a request; `closed` picks open or closed markets (Gamma answers one or the other). */
export async function pmMarkets(conds: string[], closed: boolean, o: PmPublicOpts & { concurrency?: number } = {}): Promise<PmMarket[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < conds.length; i += 50) chunks.push(conds.slice(i, i + 50));
  const out: PmMarket[] = [];
  await pool(chunks, o.concurrency ?? 6, async (chunk) => {
    const q = new URLSearchParams({ limit: "100", closed: String(closed) });
    for (const c of chunk) q.append("condition_ids", c);
    const d = await call("GET", `${PM_GAMMA}/markets/keyset?${q}`, undefined, o) as { markets?: Array<Record<string, unknown>> };
    for (const m of d.markets ?? []) {
      let toks: unknown = [];
      try { toks = JSON.parse(String(m.clobTokenIds ?? "[]")); } catch { toks = []; }
      if (!Array.isArray(toks) || toks.length !== 2) continue;
      let prices: unknown = [];
      try { prices = JSON.parse(String(m.outcomePrices ?? "[]")); } catch { prices = []; }
      const p0 = Array.isArray(prices) && prices.length ? Number(prices[0]) : NaN;
      out.push({
        cond: String(m.conditionId), yes: String(toks[0]), no: String(toks[1]), tick: num(m.orderPriceMinTickSize, 0.01) || 0.01,
        end: typeof m.endDate === "string" ? m.endDate : null, q: String(m.question ?? "").slice(0, 100),
        cat: typeof m.feeType === "string" ? m.feeType : null,
        accepting: Boolean(m.enableOrderBook) && Boolean(m.acceptingOrders) && !m.closed, closed: Boolean(m.closed),
        closedTime: typeof m.closedTime === "string" ? m.closedTime : null,
        payout: m.closed && typeof m.closedTime === "string" && Number.isFinite(p0) ? p0 : null,
      });
    }
  });
  return out;
}

/** The books of `tokens`, a hundred a request. A token the venue has no book for is missing from the answer. */
export async function pmBooks(tokens: string[], o: PmPublicOpts & { concurrency?: number } = {}): Promise<Map<string, PmBook>> {
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100));
  const out = new Map<string, PmBook>();
  await pool(chunks, o.concurrency ?? 6, async (chunk) => {
    const d = await call("POST", `${PM_CLOB}/books`, chunk.map((t) => ({ token_id: t })), o) as Array<Record<string, unknown>>;
    for (const b of Array.isArray(d) ? d : []) {
      const lv = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((l: Record<string, unknown>) => [num(l.price), num(l.size)] as PmLevel).filter(([p, s]) => p > 0 && s > 0);
      const bids = lv(b.bids).sort((x, y) => y[0] - x[0]), asks = lv(b.asks).sort((x, y) => x[0] - y[0]);
      const tick = num(b.tick_size, NaN);
      out.set(String(b.asset_id), { token: String(b.asset_id), tick: Number.isFinite(tick) && tick > 0 ? tick : null, bids, asks });
    }
  });
  return out;
}

/**
 * Every taker print of `cond` at or after `sinceSec`, oldest first. The feed carries no id of its own, so one is made
 * from the fields that identify a fill: the transaction, the taker's wallet, the token, side, price, size and second.
 * Each page's URL carries the read's own millisecond (`_`), so no cached copy of an earlier read can answer it.
 */
export async function pmPrints(cond: string, sinceSec: number, o: PmPublicOpts & { maxPages?: number } = {}): Promise<{ prints: PmPrint[]; complete: boolean }> {
  const out = new Map<string, PmPrint>();
  let cursor = "", complete = false;
  const at = String((o.clock ?? Date.now)());
  for (let page = 0; page < (o.maxPages ?? 20); page++) {
    const q = new URLSearchParams({ condition: cond, limit: "1000" });
    if (cursor) q.set("cursor", cursor);
    q.set("_", at);
    const d = await call("GET", `${PM_DATA}/v2/trades?${q}`, undefined, o) as { data?: Array<Record<string, unknown>>; pagination?: { next_cursor?: string } };
    const rows = d.data ?? [];
    for (const r of rows) {
      const ts = num(r.timestamp, -1);
      if (ts < sinceSec) continue;
      const side = r.side === "BUY" ? "BUY" : r.side === "SELL" ? "SELL" : null;
      if (!side) continue;
      const tok = String(r.token_id ?? "");
      const id = [r.transaction_hash, r.proxy_wallet, tok.slice(-10), side, r.price, r.size, ts].join("|");
      out.set(id, { id, ts, side, oi: num(r.outcome_index, -1), price: num(r.price), size: num(r.size) });
    }
    cursor = d.pagination?.next_cursor ?? "";
    const oldest = rows.length ? num(rows[rows.length - 1].timestamp, 0) : 0;
    if (!cursor || !rows.length || oldest < sinceSec) { complete = true; break; }
  }
  return { prints: [...out.values()].sort(printOrder), complete };
}

/** RW's order for prints of one second: the order rw_test.py read them in (a sorted list of [ts, side, oi, price, size]). */
export function printOrder(a: PmPrint, b: PmPrint): number {
  return a.ts - b.ts || (a.side < b.side ? -1 : a.side > b.side ? 1 : 0) || a.oi - b.oi || a.price - b.price || a.size - b.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const x = items[i++]; await f(x); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
