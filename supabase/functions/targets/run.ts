// One run of the analyst-target job: every holding on the board, its snapshot (compute.ts) from Yahoo's quoteSummary,
// an ETF's from its holdings, bitcoin's from the hand-kept table, each written to `analyst_targets` (0134) under the
// slot the run was due for (schedule.ts). Reads only public market data; it places nothing and holds no key but the
// optional Alpha Vantage one, read from the environment by the caller and never logged.
//
// Cost per run (2026-10-21's book): one quoteSummary a holding (about 45), one per ETF for its top holdings and one per
// holding priced (VUAA's up to 60 when Alpha Vantage lists them, else 10; SAEM's 10), about 120 Yahoo requests, eight
// at a time; and at most one Alpha Vantage request a day (its ETF list is kept a day in the state row). Three runs on a
// trading day, one on any other.

import type { Db } from "../agents/db.ts";
import { isFundamentalsTicker } from "../fundamentals/_shared.ts";
import { type Analyst, consensusSnapshot, holdingsSnapshot, parseAnalyst, PREFERRED_COMMON, type Snapshot, strategistSnapshot, yahooSymbolCandidates } from "./compute.ts";
import { dueSlot } from "./schedule.ts";
import { STRATEGIST_TARGETS } from "./strategists.ts";

export const TARGETS_TABLE = "analyst_targets";
export const TARGETS_STATE = "analyst_targets_state";
/** A claimed slot whose run has not finished in this long is run again. */
export const CLAIM_MS = 5 * 60e3;
export const YAHOO_CONCURRENCY = 8;
export const YAHOO_TIMEOUT_MS = 8_000;
/** The constituents an ETF's weighted target reads at most, largest first. */
export const ETF_MAX_NAMES = 60;
export const AV_CACHE_MS = 24 * 3600e3;
/** A run starts no new request after this long, and writes what it has: the call's own timeout is 55 s (0134). */
export const RUN_BUDGET_MS = 40_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * The ETFs on the board and where their constituents come from. Alpha Vantage's ETF_PROFILE lists every holding with its
 * weight (QQQ: 103 holdings, 99.9 % of the weight, read 2026-10-21 with its demo key) and is tried for VUAA through SPY,
 * the same index; Yahoo's `topHoldings` (its ten largest) is the fallback, and SAEM's only source: an EM fund's holdings
 * are Asian listings whose symbols Alpha Vantage gives in a form not yet checked.
 */
export const ETF_SOURCES: Record<string, { yahoo: string; av?: string }> = {
  "VUAA.L": { yahoo: "VUAA.L", av: "SPY" },
  "SAEM.L": { yahoo: "SAEM.L" },
};

export type Crumb = { crumb: string; cookie: string };
export type RunDeps = {
  db: Db; now: number; fetchImpl?: typeof fetch; crumb: () => Promise<Crumb | null>; avKey?: string | null; force?: boolean;
  /** The wall clock the run budget is read on (tests pass their own). */
  clock?: () => number;
};
type State = { last_slot: string | null; claimed_slot: string | null; claimed_at: string | null; cache: Record<string, any> | null };

/** `n` workers over `items`; none starts an item once `open()` says the run's budget is spent. */
async function pool<T>(items: T[], n: number, open: () => boolean, f: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length && open()) await f(q.shift() as T); }));
}

/** One quoteSummary, reduced; null on any failure (the holding then shows no targets this run). */
export async function quoteSummary(symbol: string, modules: string, auth: Crumb, f: typeof fetch): Promise<Analyst | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await f(url, { headers: { "User-Agent": UA, Accept: "application/json", Cookie: auth.cookie }, signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const d = await res.json();
    return parseAnalyst(d?.quoteSummary?.result?.[0]);
  } catch { return null; }
}

/** An ETF's holdings from Alpha Vantage's ETF_PROFILE, largest first; null when it answers none. */
export async function avHoldings(symbol: string, key: string, f: typeof fetch): Promise<Array<{ symbol: string; weight: number }> | null> {
  try {
    const res = await f(`https://www.alphavantage.co/query?function=ETF_PROFILE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const d = await res.json();
    const list = (Array.isArray(d?.holdings) ? d.holdings : [])
      .map((h: any) => ({ symbol: String(h?.symbol ?? "").trim(), weight: Number(h?.weight) }))
      .filter((h: { symbol: string; weight: number }) => /^[A-Z][A-Z.-]{0,6}$/.test(h.symbol) && h.weight > 0)
      .sort((a: { weight: number }, b: { weight: number }) => b.weight - a.weight);
    return list.length ? list : null;
  } catch { return null; }
}

/** The board's holdings: every ticker but cash, with the currency it is priced in. */
export async function boardHoldings(db: Db): Promise<Array<{ ticker: string; currency: string | null }>> {
  const rows = await db.select<{ data: { holdings?: Record<string, { isCash?: boolean; currency?: string }> } }>("board_data", "id=eq.1&select=data");
  const h = rows[0]?.data?.holdings ?? {};
  return Object.entries(h).filter(([t, x]) => t !== "CASH" && !x?.isCash).map(([t, x]) => ({ ticker: t, currency: typeof x?.currency === "string" ? x.currency : null }));
}

export type RunReport = { skipped?: string; slot?: string; written?: number; covered?: string[]; uncovered?: string[]; errors: string[] };

export async function runTargets(o: RunDeps): Promise<RunReport> {
  const f = o.fetchImpl ?? fetch, d = o.db, errors: string[] = [];
  const clock = o.clock ?? Date.now, started = clock(), open = () => clock() - started < RUN_BUDGET_MS;
  const st = (await d.select<State>(TARGETS_STATE, "id=eq.1&select=last_slot,claimed_slot,claimed_at,cache"))[0] ?? { last_slot: null, claimed_slot: null, claimed_at: null, cache: null };
  const slotMs = o.force ? o.now : dueSlot(o.now, st.last_slot ? Date.parse(st.last_slot) : null);
  if (slotMs === null) return { skipped: "no slot due", errors };
  const slot = new Date(slotMs).toISOString();
  // One run a slot: a second call while the first is still working leaves it alone (the watchdog's retry included). The
  // claim is a compare-and-set, so two calls in the same instant cannot both win it: the row changes only while no live
  // claim on this slot is there (none, another slot's, or one older than CLAIM_MS, whose run died).
  const stale = new Date(o.now - CLAIM_MS).toISOString();
  const won = await d.claim(TARGETS_STATE, `id=eq.1&or=(claimed_slot.is.null,claimed_slot.neq.${slot},claimed_at.lt.${stale})`, { claimed_slot: slot, claimed_at: new Date(o.now).toISOString() });
  if (!won.length && !o.force) return { skipped: "running", slot, errors };

  const auth = await o.crumb();
  const holdings = await boardHoldings(d);
  const cache: Record<string, any> = { ...(st.cache ?? {}) };
  const out: Snapshot[] = [];
  const uncovered: string[] = [];
  if (!auth) errors.push("yahoo: no crumb");

  // Stocks: one quoteSummary each.
  const stocks = holdings.filter((h) => !STRATEGIST_TARGETS[h.ticker] && !ETF_SOURCES[h.ticker] && isFundamentalsTicker(h.ticker));
  if (auth) {
    await pool(stocks, YAHOO_CONCURRENCY, open, async (h) => {
      const s = consensusSnapshot(h.ticker, await quoteSummary(h.ticker, "financialData,upgradeDowngradeHistory,price", auth, f), o.now);
      if (s) out.push(s); else uncovered.push(h.ticker);
    });
  }
  // ETFs: their holdings, then each holding priced.
  for (const h of holdings.filter((x) => ETF_SOURCES[x.ticker])) {
    if (!auth || !open()) break;
    const src = ETF_SOURCES[h.ticker];
    const etf = await quoteSummary(src.yahoo, "price,financialData,topHoldings", auth, f);
    let list = etf?.holdings ?? [], source = `${src.yahoo}'s top holdings (Yahoo)`;
    if (src.av && o.avKey) {
      const key = `av:${src.av}`;
      let av = cache[key] && o.now - Number(cache[key].at) < AV_CACHE_MS ? cache[key].list : null;
      if (!av) { av = await avHoldings(src.av, o.avKey, f); if (av) cache[key] = { at: o.now, list: av }; }
      if (av && av.length > list.length) { list = av; source = `${src.av}'s holdings (Alpha Vantage), the same index`; }
    }
    const names = list.slice(0, ETF_MAX_NAMES);
    const data = new Map<string, Analyst | null>();
    await pool(names, YAHOO_CONCURRENCY, open, async (n) => {
      // A preferred line is read through its common share (PREFERRED_COMMON).
      for (const sym of PREFERRED_COMMON[n.symbol] ? [PREFERRED_COMMON[n.symbol]] : yahooSymbolCandidates(n.symbol)) {
        const a = await quoteSummary(sym, "financialData,upgradeDowngradeHistory,price", auth, f);
        if (a && a.mean !== null) { data.set(n.symbol, a); return; }
      }
      data.set(n.symbol, null);
    });
    const s = holdingsSnapshot(h.ticker, names, data, { price: etf?.price ?? null, currency: etf?.currency ?? null }, o.now, source);
    if (s) out.push(s); else uncovered.push(h.ticker);
  }
  // Bitcoin and anything else kept by hand.
  for (const h of holdings.filter((x) => STRATEGIST_TARGETS[x.ticker])) {
    const s = strategistSnapshot(h.ticker, STRATEGIST_TARGETS[h.ticker], null);
    if (s) out.push(s);
  }
  for (const h of holdings) if (!out.some((s) => s.ticker === h.ticker) && !uncovered.includes(h.ticker)) uncovered.push(h.ticker);
  if (!open()) errors.push(`budget: stopped after ${RUN_BUDGET_MS / 1000} s`);

  const asOf = new Date(o.now).toISOString();
  if (out.length) await d.upsert(TARGETS_TABLE, out.map((s) => ({ ticker: s.ticker, slot, as_of: asOf, payload: s })), "ticker");
  // A run that read nothing at all (Yahoo down) keeps the last snapshots and is not the slot's run: the next call tries again.
  const done = out.length > 0;
  await d.update(TARGETS_STATE, "id=eq.1", {
    ...(done ? { last_slot: slot } : {}), claimed_slot: null, claimed_at: null, cache, updated_at: asOf,
    last_error: errors.length ? errors.join("; ").slice(0, 500) : null,
  });
  return { slot, written: out.length, covered: out.map((s) => s.ticker).sort(), uncovered: uncovered.sort(), errors };
}

/** What the page reads: every snapshot of a held ticker, the newest slot's time, and when the run was. */
export async function readTargets(db: Db) {
  const [rows, st] = await Promise.all([
    db.select<{ ticker: string; slot: string; as_of: string; payload: Snapshot }>(TARGETS_TABLE, "select=ticker,slot,as_of,payload&order=ticker.asc&limit=500"),
    db.select<{ last_slot: string | null; updated_at: string | null }>(TARGETS_STATE, "id=eq.1&select=last_slot,updated_at"),
  ]);
  const slot = rows.reduce<string | null>((m, r) => (m === null || r.slot > m ? r.slot : m), null);
  return { slot, asOf: st[0]?.updated_at ?? null, rows: Object.fromEntries(rows.map((r) => [r.ticker, { ...r.payload, slot: r.slot, asOf: r.as_of }])) };
}
