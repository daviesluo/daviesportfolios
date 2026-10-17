// GROKPM's independent record: what the outside Grok agent actually did on Polymarket, read keylessly every five
// minutes, so the Agents page's money never rests on the agent's word (Davies, 2026-10-15; pre-registered in
// docs/agents/reviews/2026-10-15-grokpm-prereg.md §4; migrations 0124 and 0125).
//
// Since Deviation D2 (2026-10-16) the agent trades through this project's server on the account live-prep used, so the
// wallet is shared: its proxy address is `grokpm_config.wallet`, written by the `grokpm` function from the account's own
// settings (never printed). The agent's book is its OWN trades only: the account's public activity, each TRADE from the
// go statement's `started_at` on whose transaction and token are one of the agent's fills as the order path read them
// back (`grokpm_fills.tx_hash`), counted at the data API's own sizes and dollars (`agentBook`). Live-prep's dust, its
// redemptions and anything else the account does are never the agent's.
//
// It trades nothing, reads no key and places nothing. Every read is a public GET or a public JSON-RPC `eth_call`:
//   data-api.polymarket.com  /activity?user= (500 a read, all stored), /positions?user= (the data API's price for a
//                            held token), /value?user= (kept for information)
//   clob.polymarket.com      POST /books       each held token's book: its mid is the mark, and the probability the
//                                               Brier comparison gives the market (`grokpm_entries`)
//   gamma-api.polymarket.com /markets/keyset   whether a market the agent traded has resolved, and how
//                            /markets?condition_ids=  the question, slug and end date of each market its journal or its
//                                               record names, once (`grokpm_markets`, 0126: the page's titles and links)
//   polygon-bor-rpc.publicnode.com  eth_call balanceOf  the shared wallet's pUSD, USDC.e and USDC, for information
// The data API is cached by CloudFront (positions 5 s, activity 15 s, value 6 s, measured 2026-10-15), so each read carries
// the slot as `_`, a parameter no earlier slot's read carried.
//
// A snapshot is keyed by its five-minute slot, activity by a hash of the item as served, entries and resolutions are
// written once: a second run in a slot (the watchdog's) changes nothing the first did. Its equity is the agent's budget
// plus its trades' cash flows, plus each holding at its mark (its payout once resolved, else the book's mid). FUNDED, the
// stops' room and the day's P&L are computed from these snapshots by the page (`grokpm_view.ts`), in one place.
//
// Market titles (0126; Davies, 2026-10-17: the journal showed "0xdf9bf27e…" for a market the agent did not hold): every
// run, before the go as after it, each condition id the agent's decisions or entries name that `grokpm_markets` does not
// hold yet, newest first and at most `GROKPM_MARKETS_PER_RUN`, is looked up on Gamma in two requests (its open markets and
// its closed ones: Gamma answers one or the other) and written once. A failure is the run's error like any other read's;
// the snapshot never waits on it.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";
import { PM_DATA, PM_GAMMA, pmBooks, pmMarkets } from "../_shared/polymarket_public.ts";

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
/** Each read waits at most this long: four rounds of reads stay inside the call's 30 s. */
export const GROKPM_TIMEOUT_MS = 6_000;
/** Market titles looked up a run at most: two Gamma requests (open and closed markets), fifty ids each at most. */
export const GROKPM_MARKETS_PER_RUN = 20;
const HOSTS = new Set([new URL(PM_DATA).host, new URL(GROKPM_RPC).host, new URL(PM_GAMMA).host]);
const COND = /^0x[0-9a-f]{64}$/;
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
export function snapshotRow(p: { slot: number; at: number; cash: { pusd: number; usdce: number; usdc: number }; positions: GrokPmPosition[]; valueApi: number | null; agentCashUsd?: number }) {
  // Since D2 the wallet is the shared account: its three balances are kept for information, and the agent's cash is its
  // budget plus its own trades' cash flows (`agentCashUsd`).
  const cash = p.agentCashUsd ?? p.cash.pusd + p.cash.usdce + p.cash.usdc;
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

/** A trade of the shared account as `grokpm_activity` keeps it, reduced to what the agent's book reads. */
export type GrokPmTrade = { ts: string; type: string; cond: string | null; asset: string | null; side: string | null; size: number | string | null; usdc_size: number | string | null; tx: string | null; outcome_index: number | null; title: string | null };
/**
 * The agent's own trades in the shared account's public activity (Deviation D2): a TRADE from the start on whose
 * transaction and token are one of the agent's own fills as the order path read them back (`grokpm_fills.tx_hash`).
 * Everything else the account does (live-prep's dust, its redemptions) is not the agent's. Its cash flows are the data
 * API's own `usdcSize`; its holdings the trades' sizes. Each asset: its market, net size, cash out and in, and average
 * buy price.
 */
export function agentBook(trades: GrokPmTrade[], fills: Array<{ tx_hash: string | null; token: string }>, startedAt: string) {
  const ours = new Set(fills.filter((f) => f.tx_hash).map((f) => `${String(f.tx_hash).toLowerCase()}|${f.token}`));
  const out = new Map<string, { asset: string; cond: string; outcomeIndex: number | null; title: string | null; size: number; buySize: number; buyUsd: number; flowUsd: number; firstBuy: string | null }>();
  let flow = 0;
  for (const t of [...trades].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (t.type !== "TRADE" || !t.asset || !t.cond || !t.tx || t.ts < startedAt || !ours.has(`${t.tx.toLowerCase()}|${t.asset}`)) continue;
    const size = Number(t.size), usd = Number(t.usdc_size);
    if (!(size > 0) || !(usd >= 0)) continue;
    const x = out.get(t.asset) ?? { asset: t.asset, cond: t.cond, outcomeIndex: t.outcome_index, title: t.title, size: 0, buySize: 0, buyUsd: 0, flowUsd: 0, firstBuy: null };
    if (t.side === "BUY") { x.size += size; x.buySize += size; x.buyUsd += usd; x.flowUsd -= usd; x.firstBuy ??= t.ts; flow -= usd; }
    else if (t.side === "SELL") { x.size -= size; x.flowUsd += usd; flow += usd; }
    out.set(t.asset, x);
  }
  return { assets: [...out.values()].map((x) => ({ ...x, size: r6(x.size), avgPrice: x.buySize > 0 ? r6(x.buyUsd / x.buySize) : 0 })), flowUsd: r6(flow) };
}

/**
 * The agent's positions for the snapshot: each asset it still holds from its own trades, marked at its payout once its
 * market resolved, else the book's mid, else the data API's price for the account's position, else its average price.
 */
export function agentPositions(
  book: ReturnType<typeof agentBook>, payouts: Record<string, number>, mids: Map<string, number | null>, curPrice: Map<string, { price: number; outcome: string | null; endDate: string | null }>,
): GrokPmPosition[] {
  return book.assets.filter((a) => a.size > 0).map((a) => {
    const payout = payouts[a.asset], mid = mids.get(a.asset) ?? null, api = curPrice.get(a.asset);
    const mark = payout !== undefined ? payout : mid ?? api?.price ?? a.avgPrice;
    return {
      asset: a.asset, cond: a.cond, outcome: api?.outcome ?? null, outcomeIndex: a.outcomeIndex, title: a.title, size: a.size, avgPrice: a.avgPrice,
      curPrice: r6(api?.price ?? mark), redeemable: payout !== undefined, endDate: api?.endDate ?? null, mid: mid === null ? null : r6(mid), mark: r6(mark), value: r6(a.size * mark),
    };
  }).sort((x, y) => x.asset.localeCompare(y.asset));
}

/**
 * The condition ids to look up: each one the journal (newest decision first) or the record's entries name, lower-cased,
 * that `known` (what `grokpm_markets` holds) does not, once, at most `limit`. Anything that is not a condition id is skipped.
 */
export function missingMarkets(named: Array<string | null | undefined>, known: Set<string>, limit = GROKPM_MARKETS_PER_RUN): string[] {
  const out: string[] = [];
  for (const x of named) {
    const c = typeof x === "string" ? x.trim().toLowerCase() : "";
    if (!COND.test(c) || known.has(c) || out.includes(c)) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** A Gamma market as `grokpm_markets` keeps it, or null when it carries no condition id. A slug is kept only as Polymarket writes one. */
export function marketRow(m: Record<string, unknown>, now: number) {
  const cond = typeof m.conditionId === "string" ? m.conditionId.toLowerCase() : "";
  if (!COND.test(cond)) return null;
  const q = typeof m.question === "string" ? m.question.trim().slice(0, 300) : "";
  const slug = typeof m.slug === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(m.slug) ? m.slug : null;
  const end = typeof m.endDate === "string" && Number.isFinite(Date.parse(m.endDate)) ? new Date(Date.parse(m.endDate)).toISOString() : null;
  return { cond, question: q || null, slug, end_date: end, updated_at: new Date(now).toISOString() };
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

export type GrokPmRecReport = { skipped?: string; slot?: string; equity?: number; positions?: number; activity?: number; entries?: number; resolved?: number; markets?: number; started?: boolean; errors: string[]; report?: boolean };

/**
 * One run: nothing while the wallet is unset. Then the shared account's public activity, stored whole; and once the
 * experiment has started (the go statement's `started_at`), the agent's own book from it (`agentBook`: its trades only,
 * told apart by the order path's fills), its holdings at the books' mids, the snapshot, new entries, and every half hour
 * the resolutions of the markets it traded. The wallet's balances are read for information; their failure stops nothing.
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

  try {
    const raw = await getJson(`${PM_DATA}/activity?user=${w}&limit=${GROKPM_ACTIVITY_PAGE}&offset=0&${bust}`, f);
    if (!Array.isArray(raw)) throw new Error("activity: not a list");
    const rows = await Promise.all((raw as Array<Record<string, unknown>>).filter((x) => x && typeof x === "object").map(activityRow));
    if (rows.length) await d.upsert("grokpm_activity", rows, "key");
    report.activity = rows.length;
  } catch (e) { errors.push(`activity: ${(e as Error).message}`); }

  // The titles of the markets its journal and its record name (0126), a few a run.
  try {
    const [decisions, entryConds, have] = await Promise.all([
      d.select<{ market_id: string | null }>("grokpm_decisions", "select=market_id&order=ts.desc,id.desc&limit=200"),
      d.select<{ cond: string }>("grokpm_entries", "select=cond&order=first_seen_at.desc&limit=1000"),
      d.select<{ cond: string }>("grokpm_markets", "select=cond&order=cond.asc&limit=5000"),
    ]);
    const want = missingMarkets([...decisions.map((x) => x.market_id), ...entryConds.map((x) => x.cond)], new Set(have.map((x) => x.cond)));
    if (want.length) {
      const ids = want.map((c) => `condition_ids=${c}`).join("&");
      const found = new Map<string, NonNullable<ReturnType<typeof marketRow>>>();
      for (const closed of [false, true]) {
        const got = await getJson(`${PM_GAMMA}/markets?limit=50&closed=${closed}&${ids}`, f);
        if (!Array.isArray(got)) throw new Error("gamma markets: not a list");
        for (const m of got as Array<Record<string, unknown>>) {
          const row = m && typeof m === "object" ? marketRow(m, o.now) : null;
          if (row && want.includes(row.cond)) found.set(row.cond, row);
        }
        if (found.size === want.length) break;
      }
      if (found.size) await d.upsert("grokpm_markets", [...found.values()], "cond");
      report.markets = found.size;
    } else report.markets = 0;
  } catch (e) { errors.push(`markets: ${(e as Error).message}`); }

  if (cfg.started_at) {
    try {
      const startedAt = new Date(Date.parse(cfg.started_at)).toISOString();
      const [trades, fills, resolutionRows] = await Promise.all([
        d.select<GrokPmTrade>("grokpm_activity", `type=eq.TRADE&ts=gte.${encodeURIComponent(startedAt)}&select=ts,type,cond,asset,side,size,usdc_size,tx,outcome_index,title&order=ts.asc,key.asc&limit=1000`),
        d.select<{ tx_hash: string | null; token: string }>("grokpm_fills", "status=in.(MATCHED,MINED,CONFIRMED,RETRYING)&select=tx_hash,token&order=trade_id.asc,hash.asc&limit=1000"),
        d.select<{ cond: string; tokens: unknown; payouts: unknown }>("grokpm_resolutions", "select=cond,tokens,payouts&order=cond.asc&limit=1000"),
      ]);
      if (trades.length >= 1000) throw new Error("over 1,000 trades since the start: the record would be read in part");
      const book = agentBook(trades, fills, startedAt);
      const payouts: Record<string, number> = {};
      for (const r of resolutionRows) {
        const t = Array.isArray(r.tokens) ? r.tokens.map(String) : [], p = Array.isArray(r.payouts) ? r.payouts.map(Number) : [];
        t.forEach((tok, i) => { if (Number.isFinite(p[i])) payouts[tok] = p[i]; });
      }
      const held = book.assets.filter((a) => a.size > 0 && payouts[a.asset] === undefined).map((a) => a.asset);
      const [cash, rawPositions, value] = await Promise.all([
        readCash(w, f).catch((e) => { errors.push(`balances: ${(e as Error).message}`); return { pusd: 0, usdce: 0, usdc: 0 }; }),
        getJson(`${PM_DATA}/positions?user=${w}&sizeThreshold=0&limit=500&${bust}`, f).catch(() => []),
        getJson(`${PM_DATA}/value?user=${w}&${bust}`, f).catch(() => null),
      ]);
      const books = held.length ? await pmBooks(held, { fetchImpl: f, timeoutMs: GROKPM_TIMEOUT_MS }) : new Map();
      const mids = new Map(held.map((t) => [t, midOf(books.get(t))] as const));
      const api = new Map<string, { price: number; outcome: string | null; endDate: string | null }>();
      for (const r of (Array.isArray(rawPositions) ? rawPositions : []) as Array<Record<string, unknown>>) {
        if (typeof r?.asset === "string") api.set(r.asset, { price: Number(r.curPrice) || 0, outcome: typeof r.outcome === "string" ? r.outcome.slice(0, 64) : null, endDate: typeof r.endDate === "string" ? r.endDate : null });
      }
      const positions = agentPositions(book, payouts, mids, api);
      const valueApi = Array.isArray(value) && value[0] && Number.isFinite(Number((value[0] as { value?: unknown }).value)) ? Number((value[0] as { value?: unknown }).value) : null;
      const snap = snapshotRow({ slot, at: o.now, cash, positions, valueApi, agentCashUsd: r6(Number(cfg.funded_usd) + book.flowUsd) });
      await d.upsert("grokpm_snapshots", [snap], "slot");
      report.equity = snap.equity_usd; report.positions = positions.length;
      // Entries: each token the agent bought, once, with the market's mid when the record first saw it.
      const known = new Set((await d.select<{ asset: string }>("grokpm_entries", "select=asset&order=asset.asc&limit=1000")).map((x) => x.asset));
      const now = new Date(o.now).toISOString();
      const entries = book.assets.filter((a) => a.firstBuy && !known.has(a.asset)).map((a) => {
        const m0 = payouts[a.asset] !== undefined ? null : mids.get(a.asset) ?? null, mid = m0 === null ? null : r6(m0);
        return { asset: a.asset, cond: a.cond, outcome_index: a.outcomeIndex, title: a.title, first_seen_at: now, first_fill_at: a.firstBuy, mid, mid_at: mid === null ? null : now, avg_price: a.avgPrice };
      });
      if (entries.length) await d.upsert("grokpm_entries", entries, "asset");
      report.entries = entries.length;
      const due = !state.lastResolveAt || o.now - state.lastResolveAt >= GROKPM_RESOLVE_EVERY_MS;
      if (due) {
        const open = [...new Set(book.assets.map((a) => a.cond))].filter((c) => /^0x[0-9a-f]{64}$/.test(c) && !resolutionRows.some((r) => r.cond === c));
        const ms = open.length ? await pmMarkets(open, true, { fetchImpl: f, timeoutMs: GROKPM_TIMEOUT_MS }) : [];
        const rows = ms.filter((m) => m.closed && m.payout !== null).map((m) => ({
          cond: m.cond, tokens: [m.yes, m.no], payouts: [m.payout, r6(1 - (m.payout as number))], closed_at: m.closedTime ? new Date(m.closedTime.replace(" ", "T").replace(/\+00$/, "Z")).toISOString() : null,
        }));
        if (rows.length) await d.upsert("grokpm_resolutions", rows, "cond");
        report.resolved = rows.length;
        state.lastResolveAt = o.now;
      }
    } catch (e) { errors.push(`snapshot: ${(e as Error).message}`); }
  }

  const key = faultKey(errors);
  const last = st?.last_report ?? null;
  report.report = reportDue(last, key, o.now);
  await d.update("grokpm_rec_state", "id=eq.1", {
    state, updated_at: new Date(o.now).toISOString(), last_error: errors.length ? errors.join("; ").slice(0, 500) : null,
    ...(report.report ? { last_report: { key, at: o.now } } : {}),
  });
  return report;
}
