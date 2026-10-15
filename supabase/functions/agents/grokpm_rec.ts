// GROKPM's independent record: what the outside Grok agent's Polymarket wallet actually holds, read keylessly every five
// minutes, so the Agents page's money never rests on the agent's word (Davies, 2026-10-15; pre-registered in
// docs/agents/reviews/2026-10-15-grokpm-prereg.md §4; migration 0124).
//
// It trades nothing, reads no key and places nothing. Every read is a public GET or a public JSON-RPC `eth_call`:
//   data-api.polymarket.com  /positions?user=  each holding: size, average price, the data API's own price, redeemable
//                            /value?user=      the data API's value of the holdings, kept beside ours as a check
//                            /activity?user=   every trade, redemption, split and merge, newest first (500 a read)
//   clob.polymarket.com      POST /books       each held token's book: its mid is the mark, and the probability the
//                                               Brier comparison gives the market (`grokpm_entries`)
//   gamma-api.polymarket.com /markets/keyset   whether a market the wallet touched has resolved, and how
//   polygon-bor-rpc.publicnode.com  eth_call balanceOf  the wallet's pUSD (Polymarket's collateral), USDC.e and USDC
// The data API is cached by CloudFront (positions 5 s, activity 15 s, value 6 s, measured 2026-10-15), so each read carries
// the slot as `_`, a parameter no earlier slot's read carried.
//
// While `grokpm_config.wallet` is null (until Davies sends the address and a one-line migration sets it) the recorder reads
// nothing at all. A snapshot is keyed by its five-minute slot, activity by a hash of the item as served, entries and
// resolutions are written once: a second run in a slot (the watchdog's) changes nothing the first did.
//
// The equity it stores is cash (the three stablecoins) plus every position at its mark: the book's mid while the market
// trades, the data API's price once a position is redeemable (its payout, 0 or 1). FUNDED, the stops' room and the day's
// P&L are computed from these snapshots by the page (`grokpm_view.ts`), in one place.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { PM_DATA, pmBooks, pmMarkets } from "../_shared/polymarket_public.ts";

export const GROKPM_RPC = "https://polygon-bor-rpc.publicnode.com";
/** The stablecoins whose balance is the wallet's cash, all six decimals (read keylessly, `decimals()`, 2026-10-15). */
export const GROKPM_CASH_TOKENS = {
  pusd: "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb",   // pUSD, Polymarket's CollateralToken (_shared/polymarket.ts' list)
  usdce: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",  // USDC.e (bridged), the collateral before pUSD
  usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",   // native USDC on Polygon, what a deposit may arrive as
} as const;
export const GROKPM_SLOT_MS = 5 * 60e3;
export const GROKPM_ACTIVITY_PAGE = 500;
/** Resolutions are looked for every this often (and at once for a position the data API calls redeemable). */
export const GROKPM_RESOLVE_EVERY_MS = 30 * 60e3;
/** `started_at` is stamped at the first snapshot whose equity is at least this share of FUNDED: the money has arrived. */
export const GROKPM_START_SHARE = 0.9;
/** Each read waits at most this long: four rounds of reads stay inside the call's 30 s. */
export const GROKPM_TIMEOUT_MS = 6_000;
const HOSTS = new Set([new URL(PM_DATA).host, new URL(GROKPM_RPC).host]);
const UA = "daviesportfolios-grokpm-rec/1.0 (public data only)";

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const nz = (x: unknown) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export type GrokPmConfig = { wallet: string | null; funded_usd: number | string; started_at: string | null };
/** A position as the data API serves it, reduced to what the record keeps. */
export type GrokPmPosition = {
  asset: string; cond: string; outcome: string | null; outcomeIndex: number | null; title: string | null; size: number; avgPrice: number;
  curPrice: number; redeemable: boolean; endDate: string | null; mid: number | null; mark: number; value: number;
};

/** `/positions`' answer as positions (a size above zero only), each marked: its mid while it trades, its price once redeemable. */
export function positionsOf(raw: unknown, mids: Map<string, number | null>): GrokPmPosition[] {
  if (!Array.isArray(raw)) throw new Error("positions: not a list");
  const out: GrokPmPosition[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const asset = String(r?.asset ?? ""), size = num(r?.size);
    if (!/^[0-9]{1,80}$/.test(asset) || !(size > 0)) continue;
    const curPrice = num(r.curPrice), redeemable = r.redeemable === true, mid = mids.get(asset) ?? null;
    const mark = redeemable || mid === null ? curPrice : mid;
    out.push({
      asset, cond: String(r.conditionId ?? ""), outcome: typeof r.outcome === "string" ? r.outcome.slice(0, 64) : null,
      outcomeIndex: Number.isInteger(r.outcomeIndex) ? Number(r.outcomeIndex) : null, title: typeof r.title === "string" ? r.title.slice(0, 200) : null,
      size: r6(size), avgPrice: r6(num(r.avgPrice)), curPrice: r6(curPrice), redeemable, endDate: typeof r.endDate === "string" ? r.endDate : null,
      mid: mid === null ? null : r6(mid), mark: r6(mark), value: r6(size * mark),
    });
  }
  return out.sort((a, b) => a.asset.localeCompare(b.asset));
}

/** A book's mid, or null when a side is empty. */
export function midOf(book: { bids: Array<[number, number]>; asks: Array<[number, number]> } | undefined): number | null {
  if (!book || !book.bids.length || !book.asks.length) return null;
  const bid = book.bids[0][0], ask = book.asks[0][0];
  return bid < ask ? (bid + ask) / 2 : null;
}

/** An `eth_call` answer's uint256 in six-decimal units, as dollars. */
export function balanceOf(hex: unknown): number {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(hex)) throw new Error("balance: not a uint256");
  return Number(BigInt(hex)) / 1e6;
}

/** The snapshot row of a slot. */
export function snapshotRow(p: { slot: number; at: number; cash: { pusd: number; usdce: number; usdc: number }; positions: GrokPmPosition[]; valueApi: number | null }) {
  const cash = p.cash.pusd + p.cash.usdce + p.cash.usdc;
  const pv = p.positions.reduce((s, x) => s + x.value, 0);
  return {
    slot: new Date(p.slot).toISOString(), at: new Date(p.at).toISOString(),
    cash_pusd: r6(p.cash.pusd), cash_usdce: r6(p.cash.usdce), cash_usdc: r6(p.cash.usdc), cash_usd: r6(cash),
    positions_value_usd: r6(pv), value_api_usd: p.valueApi === null ? null : r6(p.valueApi), equity_usd: r6(cash + pv), positions: p.positions,
  };
}

/** An activity item's row: its fields, and the item itself under a key that is the hash of the item as served. */
export async function activityRow(item: Record<string, unknown>) {
  const raw = JSON.stringify(item);
  const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const t = num(item.timestamp);
  return {
    key, ts: new Date(t * 1000).toISOString(), type: String(item.type ?? "UNKNOWN").slice(0, 32),
    cond: typeof item.conditionId === "string" ? item.conditionId : null, asset: typeof item.asset === "string" && item.asset ? item.asset : null,
    side: typeof item.side === "string" && item.side ? item.side : null, size: nz(item.size), price: nz(item.price), usdc_size: nz(item.usdcSize),
    tx: typeof item.transactionHash === "string" ? item.transactionHash : null, outcome_index: Number.isInteger(item.outcomeIndex) ? Number(item.outcomeIndex) : null,
    title: typeof item.title === "string" ? item.title.slice(0, 200) : null, raw: item,
  };
}

/**
 * The tokens the wallet came to hold that `grokpm_entries` does not have yet, each with the market's mid when first seen
 * (the probability the market gave it, for the Brier comparison) and its first buy's time from the activity. A token
 * bought and gone before a snapshot saw it is entered from its first BUY, at the mid read now (`mid_at` says when).
 */
export function newEntries(p: {
  positions: GrokPmPosition[]; buys: Array<{ asset: string; cond: string; ts: string; outcome_index: number | null; title: string | null; price: number | null }>;
  known: Set<string>; mids: Map<string, number | null>; nowMs: number;
}) {
  const out = new Map<string, Record<string, unknown>>();
  const firstBuy = new Map<string, { ts: string; price: number | null }>();
  for (const b of [...p.buys].sort((x, y) => x.ts.localeCompare(y.ts))) if (!firstBuy.has(b.asset)) firstBuy.set(b.asset, { ts: b.ts, price: b.price });
  const now = new Date(p.nowMs).toISOString();
  for (const x of p.positions) {
    if (p.known.has(x.asset) || out.has(x.asset)) continue;
    const mid = x.redeemable ? null : x.mid;
    out.set(x.asset, {
      asset: x.asset, cond: x.cond, outcome_index: x.outcomeIndex, title: x.title, first_seen_at: now, first_fill_at: firstBuy.get(x.asset)?.ts ?? null,
      mid, mid_at: mid === null ? null : now, avg_price: x.avgPrice,
    });
  }
  for (const b of p.buys) {
    if (p.known.has(b.asset) || out.has(b.asset) || !b.cond) continue;
    const mid = p.mids.get(b.asset) ?? null;
    out.set(b.asset, {
      asset: b.asset, cond: b.cond, outcome_index: b.outcome_index, title: b.title, first_seen_at: now, first_fill_at: firstBuy.get(b.asset)?.ts ?? b.ts,
      mid, mid_at: mid === null ? null : now, avg_price: firstBuy.get(b.asset)?.price ?? null,
    });
  }
  return [...out.values()];
}

/** Whether this snapshot starts the experiment: none started yet, and the equity has reached 90 % of FUNDED. */
export function startsNow(cfg: GrokPmConfig, equity: number): boolean {
  return !cfg.started_at && equity >= GROKPM_START_SHARE * num(cfg.funded_usd);
}

async function getJson(url: string, f: typeof fetch, body?: unknown): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.host)) throw new Error(`grokpm: host not allowed: ${u.host}`);
  const res = await f(u.href, {
    method: body === undefined ? "GET" : "POST",
    headers: { Accept: "application/json", "User-Agent": UA, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(GROKPM_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${u.host}${u.pathname} → ${res.status} ${text.slice(0, 120)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${u.host}${u.pathname} → not JSON`); }
}

/** The wallet's three stablecoin balances, by one public JSON-RPC batch of `balanceOf` calls. */
export async function readCash(wallet: string, f: typeof fetch): Promise<{ pusd: number; usdce: number; usdc: number }> {
  const data = "0x70a08231" + wallet.slice(2).padStart(64, "0");
  const names = Object.keys(GROKPM_CASH_TOKENS) as Array<keyof typeof GROKPM_CASH_TOKENS>;
  const reply = await getJson(GROKPM_RPC, f, names.map((k, i) => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [{ to: GROKPM_CASH_TOKENS[k], data }, "latest"] })));
  if (!Array.isArray(reply)) throw new Error("rpc: not a batch reply");
  const by = new Map((reply as Array<{ id: number; result?: unknown; error?: unknown }>).map((r) => [r.id, r]));
  const out = { pusd: 0, usdce: 0, usdc: 0 };
  names.forEach((k, i) => {
    const r = by.get(i + 1);
    if (!r || r.error !== undefined) throw new Error(`rpc: ${k} balance unread`);
    out[k] = balanceOf(r.result);
  });
  return out;
}

export type GrokPmRecReport = { skipped?: string; slot?: string; equity?: number; positions?: number; activity?: number; entries?: number; resolved?: number; started?: boolean; errors: string[]; report?: boolean };

/**
 * One run: nothing while the wallet is unset; else the cash, the positions and their books, the activity, the snapshot,
 * new entries, the experiment's start, and every half hour the resolutions of the markets the wallet touched. A read that
 * fails leaves the snapshot unwritten (a snapshot is whole or absent); the activity and resolutions are written on their own.
 */
export async function runGrokPmRec(o: { db: Db; now: number; fetchImpl?: typeof fetch }): Promise<GrokPmRecReport> {
  const f = o.fetchImpl ?? fetch, d = o.db;
  const cfg = (await d.select<GrokPmConfig>("grokpm_config", "id=eq.1&select=wallet,funded_usd,started_at"))[0];
  if (!cfg?.wallet) return { skipped: "no wallet configured", errors: [] };
  const w = cfg.wallet, slot = Math.floor(o.now / GROKPM_SLOT_MS) * GROKPM_SLOT_MS, bust = `_=${slot}`;
  const st = (await d.select<{ state: Record<string, unknown> | null; last_report: { key: string; at: number } | null }>("grokpm_rec_state", "id=eq.1&select=state,last_report"))[0];
  const state = (st?.state ?? {}) as { lastResolveAt?: number };
  const errors: string[] = [];
  const report: GrokPmRecReport = { slot: new Date(slot).toISOString(), errors };

  // Activity first: written on its own, whatever the snapshot's reads do.
  let buys: Array<{ asset: string; cond: string; ts: string; outcome_index: number | null; title: string | null; price: number | null }> = [];
  try {
    const raw = await getJson(`${PM_DATA}/activity?user=${w}&limit=${GROKPM_ACTIVITY_PAGE}&offset=0&${bust}`, f);
    if (!Array.isArray(raw)) throw new Error("activity: not a list");
    const rows = await Promise.all((raw as Array<Record<string, unknown>>).filter((x) => x && typeof x === "object").map(activityRow));
    if (rows.length) await d.upsert("grokpm_activity", rows, "key");
    report.activity = rows.length;
    buys = rows.filter((r) => r.type === "TRADE" && r.side === "BUY" && r.asset && r.cond)
      .map((r) => ({ asset: r.asset!, cond: r.cond!, ts: r.ts, outcome_index: r.outcome_index, title: r.title, price: r.price }));
  } catch (e) { errors.push(`activity: ${(e as Error).message}`); }

  try {
    const [cash, rawPositions, value] = await Promise.all([
      readCash(w, f),
      getJson(`${PM_DATA}/positions?user=${w}&sizeThreshold=0&limit=500&${bust}`, f),
      getJson(`${PM_DATA}/value?user=${w}&${bust}`, f).catch(() => null),
    ]);
    const assets = (Array.isArray(rawPositions) ? rawPositions as Array<Record<string, unknown>> : []).map((r) => String(r?.asset ?? "")).filter((a) => /^[0-9]{1,80}$/.test(a));
    const known = new Set((await d.select<{ asset: string }>("grokpm_entries", "select=asset&order=asset.asc&limit=1000")).map((x) => x.asset));
    const tokens = [...new Set([...assets, ...buys.map((b) => b.asset).filter((a) => !known.has(a))])];
    const books = tokens.length ? await pmBooks(tokens, { fetchImpl: f, timeoutMs: GROKPM_TIMEOUT_MS }) : new Map();
    const mids = new Map(tokens.map((t) => [t, midOf(books.get(t))] as const));
    const positions = positionsOf(rawPositions, mids);
    const valueApi = Array.isArray(value) && value[0] && Number.isFinite(Number((value[0] as { value?: unknown }).value)) ? Number((value[0] as { value?: unknown }).value) : null;
    const snap = snapshotRow({ slot, at: o.now, cash, positions, valueApi });
    await d.upsert("grokpm_snapshots", [snap], "slot");
    report.equity = snap.equity_usd; report.positions = positions.length;
    const entries = newEntries({ positions, buys, known, mids, nowMs: o.now });
    if (entries.length) await d.upsert("grokpm_entries", entries, "asset");
    report.entries = entries.length;
    if (startsNow(cfg, snap.equity_usd)) {
      await d.update("grokpm_config", "id=eq.1&started_at=is.null", { started_at: snap.slot });
      report.started = true;
    }
    // Resolutions: every half hour, and at once when the data API calls a position redeemable.
    const due = !state.lastResolveAt || o.now - state.lastResolveAt >= GROKPM_RESOLVE_EVERY_MS || positions.some((p) => p.redeemable);
    if (due) {
      const resolved = new Set((await d.select<{ cond: string }>("grokpm_resolutions", "select=cond&order=cond.asc&limit=1000")).map((x) => x.cond));
      const touched = new Set((await d.select<{ cond: string }>("grokpm_entries", "select=cond&order=asset.asc&limit=1000")).map((x) => x.cond));
      for (const p of positions) touched.add(p.cond);
      const open = [...touched].filter((c) => /^0x[0-9a-f]{64}$/.test(c) && !resolved.has(c));
      const ms = open.length ? await pmMarkets(open, true, { fetchImpl: f, timeoutMs: GROKPM_TIMEOUT_MS }) : [];
      const rows = ms.filter((m) => m.closed && m.payout !== null).map((m) => ({
        cond: m.cond, tokens: [m.yes, m.no], payouts: [m.payout, r6(1 - (m.payout as number))], closed_at: m.closedTime ? new Date(m.closedTime.replace(" ", "T").replace(/\+00$/, "Z")).toISOString() : null,
      }));
      if (rows.length) await d.upsert("grokpm_resolutions", rows, "cond");
      report.resolved = rows.length;
      state.lastResolveAt = o.now;
    }
  } catch (e) { errors.push(`snapshot: ${(e as Error).message}`); }

  const key = faultKey(errors);
  const last = st?.last_report ?? null;
  report.report = reportDue(last, key, o.now);
  await d.update("grokpm_rec_state", "id=eq.1", {
    state, updated_at: new Date(o.now).toISOString(), last_error: errors.length ? errors.join("; ").slice(0, 500) : null,
    ...(report.report ? { last_report: { key, at: o.now } } : {}),
  });
  return report;
}
