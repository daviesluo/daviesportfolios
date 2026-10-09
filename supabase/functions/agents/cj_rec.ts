// CoinJar's GBP stablecoin books, RECORDED: every print once, and the book near its touch, for CJ5's paper test.
// Davies, 2026-10-09: "建起来" — CJ5, PR5's rule on CoinJar UK's USDC/GBP and USDT/GBP (0.00 % maker), second in the
// stat-arb search (docs/agents/reviews/2026-10-09-stat-arb-search.md §5.2), is recorded before any paper test, by a
// keyless recorder: no account, no key. He is opening the CoinJar account himself; nothing here needs it.
//
// It trades nothing, reads no key and places nothing: CoinJar's Data API (`data.exchange.coinjar.com`) "does not require
// authentication" (its Getting Started page), and is GET only. It reads and writes only its own tables (`cj_*`, migration
// 0110). Nothing of a trading path reads it.
//
// WHAT IT RECORDS, every minute, for each book of `CJ_PRODUCTS` (measured keyless on 2026-10-09 before it was built):
//   prints  every print, once, by its `tid`, from `/products/{id}/trades?after=<unix s>&limit=1000`. `after` is a unix
//           second and is inclusive (a print at 17:24:51.68 comes back for `after` = 17:24:51 and not for 17:24:52);
//           the page is ascending, a thousand at most (`limit=5000` returns 1,000). The search read the newest 500 with
//           no `after` and took them for the whole keyless history; `after=0` pages forward from the book's first print
//           (USDC/GBP 2020-04-02, USDT/GBP 2021-08-27), and paging the newest thousand's span forward gave the same
//           1,000 records, field for field. So the cursor is the newest stored print's second, a page past it is asked
//           again, prints already stored in that second are told apart by `tid`, and an empty table starts at
//           `CJ_FROM_ISO`. From 2026-09-01: USDC/GBP 59 prints a day, USDT/GBP 32.
//   book    `/products/{id}/book?level=2` (40 levels a side as served, though the docs say 20): each side's levels within
//           `CJ_BOOK_BAND` of the mid, the best always kept, `CJ_BOOK_LEVELS` at most, stored only when they differ from
//           the book's last stored reading; a reading that finds it the same extends that row (`seen_until`, `reads`), as
//           Revolut X's books are kept (`books.ts`), so a study can tell a book that stood still from one nobody read.
//
// CoinJar's market data is not rate limited (its Rate Limits page); a minute is four requests, a page more a book while
// it catches up. No read starts past
// `CJ_READS_UNTIL_MS` into the run; each waits `CJ_TIMEOUT_MS` at most. A fault is reported to `ops_errors` as
// `agents.cj_rec` when it first appears and at most hourly while it lasts (`faultKey`, `reportDue`, as the Polymarket
// recorder's), its state row keeping what was last reported.

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

/** The books it records: CJ5's two (CoinJar UK's GBP stablecoin books). A book more is a word here and in 0110's check. */
export const CJ_PRODUCTS = ["USDCGBP", "USDTGBP"] as const;
export type CjProduct = typeof CJ_PRODUCTS[number];
export const CJ_DATA = "https://data.exchange.coinjar.com";
/** The trades endpoint's largest page. */
export const CJ_PAGE = 1000;
/** Pages a book a run: its catch-up from `CJ_FROM_ISO` (2,283 USDC/GBP prints to 2026-10-09) takes one run. */
export const CJ_PAGES_MAX = 5;
/** Where an empty table starts: S1's window and the four weeks before CJ5's reading, read from CoinJar's own history. */
export const CJ_FROM_ISO = "2026-09-01T00:00:00Z";
/**
 * A level is kept within this fraction of the mid: 40 bps, PR5's furthest rung from fair (30 bps) and 10 more. In ten
 * readings a minute apart on 2026-10-09 (18:26–18:35 UTC) that was 17–20 levels of USDC/GBP, both sides together, and
 * 10–13 of USDT/GBP (at 60 bps, 26–28 and 17–21), and each book changed from every reading to the next (9 of 9).
 */
export const CJ_BOOK_BAND = 0.004;
/** Levels kept a side at most. */
export const CJ_BOOK_LEVELS = 25;
export const CJ_TIMEOUT_MS = 8_000;
/** No read starts later than this into the run, so it ends inside its call's 30 s. */
export const CJ_READS_UNTIL_MS = 18_000;
const UA = "daviesportfolios-cj-rec/1.0 (public data only)";

// ---------------------------------------------------------------------------------------------------------- parsing

/** A print as `cj_trades` keeps it: the venue's own fields, `ts` as served (microseconds). */
export type CjPrint = { product: CjProduct; tid: number; ts: string; price: number; size: number; value: number; taker_side: CjSide };
export type CjSide = "buy" | "sell" | "auction";
const SIDES: readonly string[] = ["buy", "sell", "auction"];

const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * The trades endpoint's page (`[{ tid, price, size, value, taker_side, timestamp }]`, prices and sizes as strings) as
 * prints, oldest first. A record missing a field, with a price or size not above zero, an unknown side or an unreadable
 * time is dropped and counted; a page that is not an array is null.
 */
export function parseTrades(raw: unknown, product: CjProduct): { prints: CjPrint[]; dropped: number } | null {
  if (!Array.isArray(raw)) return null;
  const prints: CjPrint[] = [];
  let dropped = 0;
  for (const r of raw as Array<Record<string, unknown>>) {
    const tid = r && typeof r === "object" ? r.tid : null;
    const price = num(r?.price), size = num(r?.size), value = num(r?.value);
    const ts = typeof r?.timestamp === "string" ? r.timestamp : "";
    const side = String(r?.taker_side ?? "");
    if (typeof tid !== "number" || !Number.isSafeInteger(tid) || tid <= 0 || price == null || price <= 0 || size == null || size <= 0
      || value == null || value < 0 || !SIDES.includes(side) || !Number.isFinite(Date.parse(ts))) { dropped++; continue; }
    prints.push({ product, tid, ts, price, size, value, taker_side: side as CjSide });
  }
  prints.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.tid - b.tid);
  return { prints, dropped };
}

/** The unix second an instant falls in: the trades endpoint's `after`, which is inclusive. */
export const secondOf = (ts: string) => Math.floor(Date.parse(ts) / 1000);

/** The prints of a page not already stored (by `tid`), each once. */
export function newPrints(page: CjPrint[], known: ReadonlySet<number>): CjPrint[] {
  const seen = new Set(known), out: CjPrint[] = [];
  for (const p of page) if (!seen.has(p.tid)) { seen.add(p.tid); out.push(p); }
  return out;
}

/**
 * Where the next page starts: the newest print's second (asked again, its prints told apart by `tid`), and whether there
 * may be more. A full page whose newest print is in the second it started from would ask the same page for ever: the
 * next starts a second later, and `skipped` says that second may hold prints this did not read.
 */
export function nextCursor(page: CjPrint[], cursorS: number): { cursorS: number; more: boolean; skipped: boolean } {
  if (!page.length) return { cursorS, more: false, skipped: false };
  const newest = secondOf(page[page.length - 1].ts);
  const full = page.length >= CJ_PAGE;
  if (full && newest <= cursorS) return { cursorS: cursorS + 1, more: true, skipped: true };
  return { cursorS: Math.max(newest, cursorS), more: full, skipped: false };
}

/** One level as stored: price and size, both as the venue served them, as numbers. */
export type CjLevel = [price: number, size: number];
export type CjSides = { bids: CjLevel[]; asks: CjLevel[] };

/**
 * The book endpoint's snapshot (`{ bids: [[price, size]], asks }`, strings) as levels best first, keeping each side's
 * levels within `band` of the mid (from the two bests), the best always, at most `max` a side. A side may be empty (the
 * mid is then the other side's best); a snapshot with neither, or not of this shape, is null.
 */
export function parseBook(raw: unknown, band = CJ_BOOK_BAND, max = CJ_BOOK_LEVELS): CjSides | null {
  const top = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!top || !Array.isArray(top.bids) || !Array.isArray(top.asks)) return null;
  const level = (l: unknown): CjLevel | null => {
    if (!Array.isArray(l)) return null;
    const p = num(l[0]), q = num(l[1]);
    return p != null && p > 0 && q != null && q > 0 ? [p, q] : null;
  };
  const side = (xs: unknown[], desc: boolean) => xs.map(level).filter((x): x is CjLevel => x != null)
    .sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]));
  const bids = side(top.bids, true), asks = side(top.asks, false);
  if (!bids.length && !asks.length) return null;
  const mid = bids.length && asks.length ? (bids[0][0] + asks[0][0]) / 2 : (bids[0] ?? asks[0])[0];
  const lo = mid * (1 - band), hi = mid * (1 + band);
  return {
    bids: bids.filter((l, i) => i === 0 || l[0] >= lo).slice(0, max),
    asks: asks.filter((l, i) => i === 0 || l[0] <= hi).slice(0, max),
  };
}

/** Whether two readings are the same book: every level's price and size. */
export const sameCjBook = (a: CjSides | null, b: CjSides | null) =>
  !!a && !!b && JSON.stringify([a.bids, a.asks]) === JSON.stringify([b.bids.map((l) => l.map(Number)), b.asks.map((l) => l.map(Number))]);

// -------------------------------------------------------------------------------------------------------------- run

export type CjBookReport = {
  prints: number; pages: number; dropped: number; cursor: string | null; behind: boolean; skipped: number;
  book: "recorded" | "unchanged" | null;
};
export type CjRecReport = { at: string; ms: number; books: Partial<Record<CjProduct, CjBookReport>>; errors: string[]; report: boolean };
export type CjRecDeps = { db: Db; now: number; fetchImpl?: typeof fetch; clock?: () => number };
type State = { id: number; state: { fault?: { key: string; at: number } } | null };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(CJ_TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 80)}`);
  try { return JSON.parse(body); } catch { throw new Error("unreadable JSON"); }
}

/** One book's prints: from the newest stored print's second, page by page, each print inserted once. */
async function recordPrints(d: CjRecDeps, f: typeof fetch, product: CjProduct, late: () => boolean, r: CjBookReport) {
  const [last] = await d.db.select<{ tid: number; ts: string }>("cj_trades", `product=eq.${product}&select=tid,ts&order=ts.desc,tid.desc&limit=1`);
  let cursorS = last ? secondOf(last.ts) : secondOf(CJ_FROM_ISO);
  // The prints already stored in the cursor's second: the first page asks for them again.
  const known = new Set<number>(last
    ? (await d.db.select<{ tid: number }>("cj_trades", `product=eq.${product}&ts=gte.${encodeURIComponent(iso(cursorS * 1000))}&select=tid&limit=${CJ_PAGE}`)).map((x) => Number(x.tid))
    : []);
  for (let i = 0; i < CJ_PAGES_MAX; i++) {
    if (late()) { r.behind = true; break; }
    const parsed = parseTrades(await getJson(f, `${CJ_DATA}/products/${product}/trades?after=${cursorS}&limit=${CJ_PAGE}`), product);
    if (!parsed) throw new Error("trades: not a list");
    r.pages++;
    r.dropped += parsed.dropped;
    const fresh = newPrints(parsed.prints, known);
    if (fresh.length) await d.db.upsert("cj_trades", fresh, "product,tid");
    for (const p of fresh) known.add(p.tid);
    r.prints += fresh.length;
    const next = nextCursor(parsed.prints, cursorS);
    if (next.skipped) r.skipped++;
    cursorS = next.cursorS;
    r.cursor = iso(cursorS * 1000);
    if (!next.more) { r.behind = false; return; }
    r.behind = true;
  }
}

type StoredBook = { ts: string; bids: CjLevel[]; asks: CjLevel[]; reads: number | null };

/** One book's snapshot: stored when it changed, else its last row extended. */
async function recordBook(d: CjRecDeps, f: typeof fetch, product: CjProduct, at: () => string, r: CjBookReport) {
  const now = parseBook(await getJson(f, `${CJ_DATA}/products/${product}/book?level=2`));
  if (!now) throw new Error("book: unreadable");
  const t = at();
  const [prev] = await d.db.select<StoredBook>("cj_book", `product=eq.${product}&select=ts,bids,asks,reads&order=ts.desc&limit=1`);
  if (prev && sameCjBook(now, { bids: prev.bids, asks: prev.asks })) {
    await d.db.update("cj_book", `product=eq.${product}&ts=eq.${encodeURIComponent(prev.ts)}`, { seen_until: t, reads: (prev.reads ?? 1) + 1 });
    r.book = "unchanged";
  } else {
    await d.db.upsert("cj_book", [{ product, ts: t, bids: now.bids, asks: now.asks, seen_until: t, reads: 1 }], "product,ts");
    r.book = "recorded";
  }
}

/**
 * One minute: each book's new prints and its book, the books side by side. A book that cannot be read is named in
 * `errors` and the rest go on; its prints wait for the next minute from where they stopped, as nothing past a stored print
 * is lost. Then the state row: what was last reported, and the minute's errors.
 */
export async function runCjRec(d: CjRecDeps): Promise<CjRecReport> {
  const f = d.fetchImpl ?? fetch;
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  const late = () => clock() - t0 > CJ_READS_UNTIL_MS;
  const report: CjRecReport = { at: iso(d.now), ms: 0, books: {}, errors: [], report: false };
  await Promise.all(CJ_PRODUCTS.map(async (p) => {
    const r: CjBookReport = { prints: 0, pages: 0, dropped: 0, cursor: null, behind: false, skipped: 0, book: null };
    report.books[p] = r;
    try { await recordBook(d, f, p, () => iso(d.now + (clock() - t0)), r); } catch (e) { report.errors.push(`${p} book: ${msg(e)}`); }
    try { await recordPrints(d, f, p, late, r); } catch (e) { report.errors.push(`${p} prints: ${msg(e)}`); }
    if (r.dropped) report.errors.push(`${p} prints: ${r.dropped} unreadable`);
    if (r.skipped) report.errors.push(`${p} prints: a second held more than a page`);
  }));
  report.errors.sort();
  report.ms = clock() - t0;
  try {
    const [st] = await d.db.select<State>("cj_rec_state", "id=eq.1&select=id,state");
    const key = faultKey(report.errors);
    const prev = st?.state?.fault ?? null;
    report.report = reportDue(prev, key, d.now);
    const fault = !key ? undefined : report.report ? { key, at: d.now } : prev ?? undefined;
    await d.db.upsert("cj_rec_state", [{
      id: 1, state: fault ? { fault } : {}, updated_at: iso(d.now), last_error: report.errors.join(" | ").slice(0, 1000) || null,
      last_report: { at: report.at, ms: report.ms, books: report.books },
    }], "id");
  } catch (e) {
    report.errors.push(`state: ${msg(e)}`);
    report.report = true;
  }
  return report;
}
