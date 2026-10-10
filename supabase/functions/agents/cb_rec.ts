// Coinbase's GBP and EUR stablecoin books, RECORDED: every print once, by trade id with no gap, and the touch each minute,
// for the forward paper test of PR5's frozen rule on Coinbase (`cb_quotes.ts`). Davies, 2026-10-10: "先建起来吧，并且和
// Revolute X对比看哪个更好" — build it, and compare it with Revolut X. The venue screen that chose Coinbase is
// docs/agents/reviews/2026-10-09-stablecoin-venues.md; the pre-registration docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md.
//
// It trades nothing, reads no key and places nothing: Coinbase Exchange's market data (`api.exchange.coinbase.com`) is
// public and GET only. It reads and writes only its own tables (`cb_*`, migration 0112). Nothing of a trading path reads it.
//
// WHAT IT RECORDS, every minute, for each book of `CB_PRODUCTS` (the four a UK Coinbase account quotes):
//   prints  `/products/{id}/trades?limit=1000`, newest first, then `&after=<trade id>` for the page before it (measured
//           2026-10-09: `after=N` serves ids below N, newest first; `before=N` serves the NEWEST page above N, not the one
//           nearest N, so the recorder never pages forward). Trade ids run one a print in each book, with no gap (two
//           years of all four books paged back on 2026-10-09: every id present). So a minute reads the newest page and
//           pages back until it reaches the newest id it holds: everything between is stored, and coverage stands at the
//           instant the newest page was asked for. When a burst outruns the minute's pages (`CB_PAGES_MAX`), what is
//           missing is kept as a hole (`hole.after`) and the next minutes page it back first; coverage stays where it was
//           until it closes. `side` is the MAKER's side on Coinbase (its docs: "The side of a trade indicates the maker
//           order side"); a row keeps the aggressor, the other side, as every print table here does.
//   touch   `/products/{id}/book?level=1`: the best bid and ask, their sizes and order counts, a row a minute: what a
//           post-only order would have met, and half of it the 24-hour stop's cost.
//
// The volumes (2025-10-09 → 2026-10-09): USDC-GBP 3.56 m prints, USDT-GBP 1.53 m, USDC-EUR 8.9 m, USDT-EUR 3.18 m, about
// 47,000 a day together, so prints are kept CB_TRADES_DAYS (0112's prune) and the paper engine's minute record keeps each
// decided minute's bar for longer. Coinbase serves public data at 10 requests a second per IP; a minute is eight
// requests and a page more a book only in a burst. No read starts past `CB_READS_UNTIL_MS` into the run; each waits
// `CB_TIMEOUT_MS` at most. A fault is reported to `ops_errors` as `agents.cb_rec` when it first appears and at most hourly
// while it lasts (`faultKey`, `reportDue`, as the CoinJar recorder's).

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

/** The books it records: the four a UK Coinbase customer can quote (GBP and EUR balances). A book more is a word here and in 0112's check. */
export const CB_PRODUCTS = ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"] as const;
export type CbProduct = typeof CB_PRODUCTS[number];
export const CB_API = "https://api.exchange.coinbase.com";
/** The trades endpoint's largest page. */
export const CB_PAGE = 1000;
/** Pages a book a minute at most: 6,000 prints, against about 17 a minute on the busiest book on average. */
export const CB_PAGES_MAX = 6;
export const CB_TIMEOUT_MS = 8_000;
/** No read starts later than this into the run, so the recorder and the paper engine after it end inside the call's 30 s. */
export const CB_READS_UNTIL_MS = 15_000;
/** Coverage stands this far before the instant the newest page was asked for: a print the engine stamps a little before
 *  its reply can still be on its way into the page. */
export const CB_COVER_MARGIN_MS = 5_000;
const UA = "daviesportfolios-cb-rec/1.0 (public data only)";

// ---------------------------------------------------------------------------------------------------------- parsing

export type CbSide = "buy" | "sell";
/** A print as `cb_trades` keeps it: the venue's id, its time (as served, microseconds), price, size and the AGGRESSOR. */
export type CbPrint = { product: CbProduct; trade_id: number; ts: string; price: number; size: number; side: CbSide };

const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * The trades endpoint's page (`[{ trade_id, side, size, price, time }]`, prices and sizes as strings, newest first) as
 * prints, newest first. `side` is the maker's, so the aggressor is the other. A record missing a field, with a price or
 * size not above zero, an unknown side or an unreadable time is dropped and counted; a page that is not an array is null.
 */
export function parseCbTrades(raw: unknown, product: CbProduct): { prints: CbPrint[]; dropped: number } | null {
  if (!Array.isArray(raw)) return null;
  const prints: CbPrint[] = [];
  let dropped = 0;
  for (const r of raw as Array<Record<string, unknown>>) {
    const id = r && typeof r === "object" ? r.trade_id : null;
    const price = num(r?.price), size = num(r?.size);
    const ts = typeof r?.time === "string" ? r.time : "";
    const maker = String(r?.side ?? "");
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || price == null || price <= 0 || size == null || size <= 0
      || (maker !== "buy" && maker !== "sell") || !Number.isFinite(Date.parse(ts))) { dropped++; continue; }
    prints.push({ product, trade_id: id, ts, price, size, side: maker === "buy" ? "sell" : "buy" });
  }
  prints.sort((a, b) => b.trade_id - a.trade_id);
  return { prints, dropped };
}

/** The touch from `/book?level=1` (`{ bids: [[price, size, orders]], asks }`), or null when a side is missing. */
export function parseCbTouch(raw: unknown): { bid: number; ask: number; bid_size: number; ask_size: number; bid_orders: number | null; ask_orders: number | null } | null {
  const top = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const b = Array.isArray(top?.bids) ? (top!.bids as unknown[])[0] : null, a = Array.isArray(top?.asks) ? (top!.asks as unknown[])[0] : null;
  if (!Array.isArray(b) || !Array.isArray(a)) return null;
  const bid = num(b[0]), bs = num(b[1]), ask = num(a[0]), as = num(a[1]);
  if (bid == null || ask == null || bs == null || as == null || bid <= 0 || ask <= 0) return null;
  return { bid, ask, bid_size: bs, ask_size: as, bid_orders: num(b[2]), ask_orders: num(a[2]) };
}

/**
 * Where a book's record stands. `top`: the newest trade id stored. `hi`: every id up to it is stored since `from` (the
 * first id the recorder took). `hole`: ids in (hi, hole.after) still to page back for, when a burst outran a minute.
 * `topAt`: when the page that brought `top` was asked for. `coveredTo`: every print up to this instant is stored (the
 * paper engine decides no minute past it).
 */
export type CbCursor = { from: number; fromTs: string; hi: number; top: number; topAt: number; hole: { after: number } | null; coveredTo: number };

/**
 * One minute's paging plan, as a pure step: given what the cursor holds and a page just read (newest first), what to
 * store, the cursor after it, and whether to read the page before it (`next`: its `after`). `head` says the page is the
 * newest one (read with no cursor) and `askedAt` when it was asked for.
 */
export function stepCursor(cur: CbCursor | null, page: CbPrint[], head: boolean, askedAt: number): { store: CbPrint[]; cur: CbCursor; next: number | null } {
  if (!page.length) {
    if (!cur) throw new Error("an empty first page");
    // An empty page while paging back: nothing older to read (only before the book's first print).
    if (cur.hole && !head) return { store: [], cur: closeHole(cur), next: null };
    return { store: [], cur: head && !cur.hole ? { ...cur, coveredTo: Math.max(cur.coveredTo, askedAt - CB_COVER_MARGIN_MS) } : cur, next: null };
  }
  const newest = page[0].trade_id, oldest = page[page.length - 1].trade_id;
  if (!cur) {
    // The first page: the record starts at its oldest print, complete from there.
    return { store: page, cur: { from: oldest, fromTs: page[page.length - 1].ts, hi: newest, top: newest, topAt: askedAt, hole: null, coveredTo: askedAt - CB_COVER_MARGIN_MS }, next: null };
  }
  if (!head) {
    // Paging back into a hole: keep what is above `hi`; the hole closes when the page reaches it.
    const store = page.filter((p) => p.trade_id > cur.hi);
    if (oldest <= cur.hi + 1) return { store, cur: closeHole(cur), next: null };
    return { store, cur: { ...cur, hole: { after: oldest } }, next: oldest };
  }
  // The newest page while a hole is open: one hole at a time, so it is not read (the run reads the hole first and reads
  // the newest page only once it has closed); were it read, nothing changes and it is read again.
  if (cur.hole) return { store: [], cur, next: null };
  // The newest page: everything above `top` is new.
  const store = page.filter((p) => p.trade_id > cur.top);
  const top = Math.max(cur.top, newest);
  if (oldest <= cur.top + 1) {
    // It reaches what is stored: complete to the instant it was asked for.
    return { store, cur: { ...cur, hi: top, top, topAt: askedAt, coveredTo: Math.max(cur.coveredTo, askedAt - CB_COVER_MARGIN_MS) }, next: null };
  }
  // A burst: more than a page since the last minute. What lies between `top` and this page is a hole to page back.
  return { store, cur: { ...cur, top, topAt: askedAt, hole: { after: oldest } }, next: oldest };
}

/** A hole paged back to what was stored: every id to `top` is stored, so coverage moves to when `top` was read. */
function closeHole(cur: CbCursor): CbCursor {
  return { ...cur, hi: cur.top, hole: null, coveredTo: Math.max(cur.coveredTo, cur.topAt - CB_COVER_MARGIN_MS) };
}

// -------------------------------------------------------------------------------------------------------------- run

export type CbBookReport = { prints: number; pages: number; dropped: number; coveredTo: string | null; hole: boolean; touch: boolean };
export type CbRecReport = { at: string; ms: number; books: Partial<Record<CbProduct, CbBookReport>>; errors: string[]; report: boolean; reached: boolean };
export type CbRecDeps = { db: Db; now: number; fetchImpl?: typeof fetch; clock?: () => number };
export type CbRecState = { cursors?: Partial<Record<CbProduct, CbCursor>>; fault?: { key: string; at: number } };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(CB_TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 80)}`);
  try { return JSON.parse(body); } catch { throw new Error("unreadable JSON"); }
}

const row = (p: CbPrint) => ({ product: p.product, trade_id: p.trade_id, ts: p.ts, price: p.price, size: p.size, side: p.side });

/** One book's prints this minute: its hole first, then the newest pages back to what is stored. */
async function recordPrints(d: CbRecDeps, f: typeof fetch, product: CbProduct, cursor: CbCursor | null, late: () => boolean, clock: () => number, r: CbBookReport): Promise<CbCursor | null> {
  let cur = cursor;
  const t0 = clock();
  const read = async (after: number | null) => {
    const askedAt = d.now + (clock() - t0);
    const parsed = parseCbTrades(await getJson(f, `${CB_API}/products/${product}/trades?limit=${CB_PAGE}${after ? `&after=${after}` : ""}`), product);
    if (!parsed) throw new Error("trades: not a list");
    r.pages++; r.dropped += parsed.dropped;
    return { page: parsed.prints, askedAt };
  };
  const save = async (store: CbPrint[]) => {
    if (!store.length) return;
    for (let i = 0; i < store.length; i += 1000) await d.db.upsert("cb_trades", store.slice(i, i + 1000).map(row), "product,trade_id");
    r.prints += store.length;
  };
  // 1. An open hole pages back first.
  let pages = 0;
  while (cur?.hole && pages < CB_PAGES_MAX && !late()) {
    const { page, askedAt } = await read(cur.hole.after);
    pages++;
    const s = stepCursor(cur, page, false, askedAt);
    await save(s.store); cur = s.cur;
  }
  // 2. The newest page, and back from it while it has not reached what is stored.
  if (pages < CB_PAGES_MAX && !late()) {
    const { page, askedAt } = await read(null);
    pages++;
    let s = stepCursor(cur, page, true, askedAt);
    await save(s.store); cur = s.cur;
    while (s.next != null && pages < CB_PAGES_MAX && !late()) {
      const back = await read(s.next);
      pages++;
      s = stepCursor(cur, back.page, false, back.askedAt);
      await save(s.store); cur = s.cur;
    }
  }
  return cur;
}

/** One book's touch: a row a minute. */
async function recordTouch(d: CbRecDeps, f: typeof fetch, product: CbProduct, at: () => string, r: CbBookReport) {
  const t = parseCbTouch(await getJson(f, `${CB_API}/products/${product}/book?level=1`));
  if (!t) throw new Error("touch: unreadable");
  await d.db.upsert("cb_touch", [{ product, ts: at(), ...t }], "product,ts");
  r.touch = true;
}

/**
 * One minute: each book's new prints and its touch, the books side by side. A book that cannot be read is named in
 * `errors` and the rest go on; its prints wait for the next minute from where they stopped (its cursor), as nothing past a
 * stored print is lost. `reached` says Coinbase answered at least one request (the Edge region's reach). Then the state row.
 */
export async function runCbRec(d: CbRecDeps): Promise<CbRecReport & { state: CbRecState }> {
  const f = d.fetchImpl ?? fetch;
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  const late = () => clock() - t0 > CB_READS_UNTIL_MS;
  const report: CbRecReport = { at: iso(d.now), ms: 0, books: {}, errors: [], report: false, reached: false };
  let state: CbRecState = {};
  try {
    const [st] = await d.db.select<{ state: CbRecState | null }>("cb_rec_state", "id=eq.1&select=state");
    state = st?.state ?? {};
  } catch (e) { report.errors.push(`state read: ${msg(e)}`); }
  const cursors: Partial<Record<CbProduct, CbCursor>> = { ...(state.cursors ?? {}) };
  await Promise.all(CB_PRODUCTS.map(async (p) => {
    const r: CbBookReport = { prints: 0, pages: 0, dropped: 0, coveredTo: null, hole: false, touch: false };
    report.books[p] = r;
    try { await recordTouch(d, f, p, () => iso(d.now + (clock() - t0)), r); report.reached = true; } catch (e) { report.errors.push(`${p} touch: ${msg(e)}`); }
    try {
      const cur = await recordPrints(d, f, p, cursors[p] ?? null, late, clock, r);
      if (r.pages) report.reached = true;
      if (cur) cursors[p] = cur;
    } catch (e) { report.errors.push(`${p} prints: ${msg(e)}`); }
    const c = cursors[p];
    r.coveredTo = c ? iso(c.coveredTo) : null;
    r.hole = !!c?.hole;
    if (r.dropped) report.errors.push(`${p} prints: ${r.dropped} unreadable`);
  }));
  report.errors.sort();
  report.ms = clock() - t0;
  const key = faultKey(report.errors);
  const prev = state.fault ?? null;
  report.report = reportDue(prev, key, d.now);
  const fault = !key ? undefined : report.report ? { key, at: d.now } : prev ?? undefined;
  state = { cursors, ...(fault ? { fault } : {}) };
  try {
    await d.db.upsert("cb_rec_state", [{
      id: 1, state, updated_at: iso(d.now), last_error: report.errors.join(" | ").slice(0, 1000) || null,
      last_report: { at: report.at, ms: report.ms, books: report.books, reached: report.reached },
    }], "id");
  } catch (e) {
    report.errors.push(`state: ${msg(e)}`);
    report.report = true;
  }
  return { ...report, state };
}
