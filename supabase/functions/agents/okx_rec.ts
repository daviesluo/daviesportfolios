// OKX's two stablecoin books that OTHERVENUES ranked first (docs/agents/reviews/2026-10-27-other-coins-venues.md), RECORDED:
// every print once, by trade id with no gap, and the top of the book each minute, for the paper twins of `okx_quotes.ts`.
// Davies, 2026-10-27: "我已经有okx在英国的账户了，okx的这两个策略在这个账户上可以做吗？可以的话就加盘口记录器和开testings策略（目前live的rules？）".
// The pre-registration is docs/agents/reviews/2026-10-27-okx-paper-prereg.md.
//
// It trades nothing, reads no key and places nothing: OKX's market data (`www.okx.com/api/v5/market/…`) is public and GET only.
// It reads and writes only its own tables (`okx_*`, migration 0150). Nothing of a trading path reads it.
//
// WHAT IT RECORDS, every minute, for each book of `OKX_BOOKS`:
//   prints  `/api/v5/market/trades?instId=<book>&limit=500`: the newest 500, newest first (measured 2026-10-27: trade ids
//           run one a print in each book, with no gap; `side` is the TAKER's, the aggressor, as every print table here keeps
//           it). The books trade about 230 (USDG-EUR) and 80 (EURC-USDC) prints a DAY, so the newest page always reaches the
//           newest id stored; when it does not, the ids in between are paged back with
//           `/api/v5/market/history-trades?instId=<book>&type=1&after=<trade id>&limit=100` (ids below it, newest first) and,
//           until they are all stored, coverage stays where it was (`hole`), as Coinbase's recorder does (`cb_rec.ts`).
//   book    `/api/v5/market/books?instId=<book>&sz=5`: the best five levels a side, a row a minute: what a post-only order
//           would have met (the twin's crossing check) and what its 24-hour stop would have sold into.
//
// OKX's books are unified (its instrument list, `tradeQuoteCcyList`): USDG-EUR is quoted in EUR or EURC, EURC-USDC in USDC,
// USD, USDG or RLUSD, all one book. A fault is reported to `ops_errors` as `agents.okx_rec` when it first appears and at most
// hourly while it lasts (`faultKey`, `reportDue`, as the Coinbase recorder's).

import type { Db } from "./db.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

/** The books it records. A book more is a word here and in 0150's checks. */
export const OKX_BOOKS = ["USDG-EUR", "EURC-USDC"] as const;
export type OkxBook = typeof OKX_BOOKS[number];
export const OKX_API = "https://www.okx.com";
/** The trades endpoint's largest page; the history endpoint's. */
export const OKX_PAGE = 500;
export const OKX_HISTORY_PAGE = 100;
/** Pages of history a book a minute at most, paging back into a hole. */
export const OKX_PAGES_MAX = 5;
export const OKX_TIMEOUT_MS = 8_000;
/** No read starts later than this into the run. */
export const OKX_READS_UNTIL_MS = 15_000;
/** Coverage stands this far before the instant the newest page was asked for. */
export const OKX_COVER_MARGIN_MS = 5_000;
/** The levels a side the book row keeps. */
export const OKX_LEVELS = 5;
const UA = "daviesportfolios-okx-rec/1.0 (public data only)";

export type OkxSide = "buy" | "sell";
/** A print as `okx_trades` keeps it: the venue's id, its time (ms), price, size and the AGGRESSOR (OKX's taker side). */
export type OkxPrint = { book: OkxBook; trade_id: number; ts: number; price: number; size: number; side: OkxSide };

const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

/** OKX's envelope `{ code: "0", msg, data }`: its data, or an error naming the code. */
export function okxData(raw: unknown): unknown[] {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!o || String(o.code) !== "0" || !Array.isArray(o.data)) throw new Error(`okx: code ${String(o?.code ?? "?")} ${String(o?.msg ?? "").slice(0, 60)}`);
  return o.data;
}

/**
 * A trades page (`[{ instId, tradeId, px, sz, side, ts }]`, strings, newest first) as prints, newest first. `side` is the
 * taker's, kept as the aggressor. A record of another book, missing a field, with a price or size not above zero, an unknown
 * side or an unreadable time is dropped and counted.
 */
export function parseOkxTrades(data: unknown[], book: OkxBook): { prints: OkxPrint[]; dropped: number } {
  const prints: OkxPrint[] = [];
  let dropped = 0;
  for (const r of data as Array<Record<string, unknown>>) {
    const id = num(r?.tradeId), price = num(r?.px), size = num(r?.sz), ts = num(r?.ts);
    const side = String(r?.side ?? "");
    if (r?.instId !== book || id == null || !Number.isSafeInteger(id) || id <= 0 || price == null || price <= 0 || size == null || size <= 0
      || ts == null || ts <= 0 || (side !== "buy" && side !== "sell")) { dropped++; continue; }
    prints.push({ book, trade_id: id, ts, price, size, side });
  }
  prints.sort((a, b) => b.trade_id - a.trade_id);
  return { prints, dropped };
}

export type OkxLevels = { bids: Array<[number, number]>; asks: Array<[number, number]> };
/** The book (`[{ asks: [[px, sz, "0", orders]], bids, ts }]`): its best `OKX_LEVELS` a side, or null when a side is empty. */
export function parseOkxBook(data: unknown[]): (OkxLevels & { bid: number; ask: number; bid_size: number; ask_size: number }) | null {
  const top = data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
  const side = (k: string) => (Array.isArray(top?.[k]) ? top![k] as unknown[] : []).slice(0, OKX_LEVELS)
    .map((l) => (Array.isArray(l) ? [num(l[0]), num(l[1])] : [null, null]))
    .filter((l): l is [number, number] => l[0] != null && l[1] != null && l[0] > 0 && l[1] > 0);
  const bids = side("bids"), asks = side("asks");
  if (!bids.length || !asks.length) return null;
  return { bids, asks, bid: bids[0][0], ask: asks[0][0], bid_size: bids[0][1], ask_size: asks[0][1] };
}

/**
 * Where a book's record stands, as Coinbase's (`CbCursor`): `top` the newest trade id stored, every id to `hi` stored since
 * `from`; `hole` ids in (hi, hole.after) still to page back for; `coveredTo` every print up to this instant is stored.
 */
export type OkxCursor = { from: number; hi: number; top: number; topAt: number; hole: { after: number } | null; coveredTo: number };

/**
 * One page's step, as a pure function: what to store, the cursor after it, and the page to read next (`next`: its `after`).
 * `head` says it is the newest page; `askedAt` when it was asked for. The rules are `stepCursor`'s in cb_rec.ts.
 */
export function stepOkxCursor(cur: OkxCursor | null, page: OkxPrint[], head: boolean, askedAt: number): { store: OkxPrint[]; cur: OkxCursor; next: number | null } {
  const close = (c: OkxCursor): OkxCursor => ({ ...c, hi: c.top, hole: null, coveredTo: Math.max(c.coveredTo, c.topAt - OKX_COVER_MARGIN_MS) });
  if (!page.length) {
    if (!cur) return { store: [], cur: { from: 0, hi: 0, top: 0, topAt: askedAt, hole: null, coveredTo: askedAt - OKX_COVER_MARGIN_MS }, next: null };
    if (cur.hole && !head) return { store: [], cur: close(cur), next: null };
    return { store: [], cur: head && !cur.hole ? { ...cur, coveredTo: Math.max(cur.coveredTo, askedAt - OKX_COVER_MARGIN_MS) } : cur, next: null };
  }
  const newest = page[0].trade_id, oldest = page[page.length - 1].trade_id;
  if (!cur || cur.top === 0) {
    return { store: page, cur: { from: oldest, hi: newest, top: newest, topAt: askedAt, hole: null, coveredTo: askedAt - OKX_COVER_MARGIN_MS }, next: null };
  }
  if (!head) {
    const store = page.filter((p) => p.trade_id > cur.hi);
    if (oldest <= cur.hi + 1) return { store, cur: close(cur), next: null };
    return { store, cur: { ...cur, hole: { after: oldest } }, next: oldest };
  }
  if (cur.hole) return { store: [], cur, next: null };
  const store = page.filter((p) => p.trade_id > cur.top);
  const top = Math.max(cur.top, newest);
  if (oldest <= cur.top + 1) return { store, cur: { ...cur, hi: top, top, topAt: askedAt, coveredTo: Math.max(cur.coveredTo, askedAt - OKX_COVER_MARGIN_MS) }, next: null };
  return { store, cur: { ...cur, top, topAt: askedAt, hole: { after: oldest } }, next: oldest };
}

export type OkxBookReport = { prints: number; pages: number; dropped: number; coveredTo: string | null; hole: boolean; book: boolean };
export type OkxRecReport = { at: string; ms: number; books: Partial<Record<OkxBook, OkxBookReport>>; errors: string[]; report: boolean; reached: boolean };
export type OkxRecDeps = { db: Db; now: number; fetchImpl?: typeof fetch; clock?: () => number };
export type OkxRecState = { cursors?: Partial<Record<OkxBook, OkxCursor>>; fault?: { key: string; at: number } };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function getData(f: typeof fetch, url: string): Promise<unknown[]> {
  const res = await f(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(OKX_TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 80)}`);
  let j: unknown;
  try { j = JSON.parse(body); } catch { throw new Error("unreadable JSON"); }
  return okxData(j);
}

const row = (p: OkxPrint) => ({ book: p.book, trade_id: p.trade_id, ts: iso(p.ts), price: p.price, size: p.size, side: p.side });

async function recordPrints(d: OkxRecDeps, f: typeof fetch, book: OkxBook, cursor: OkxCursor | null, late: () => boolean, clock: () => number, r: OkxBookReport): Promise<OkxCursor | null> {
  let cur = cursor;
  const t0 = clock();
  const read = async (after: number | null) => {
    const askedAt = d.now + (clock() - t0);
    const url = after == null
      ? `${OKX_API}/api/v5/market/trades?instId=${book}&limit=${OKX_PAGE}`
      : `${OKX_API}/api/v5/market/history-trades?instId=${book}&type=1&after=${after}&limit=${OKX_HISTORY_PAGE}`;
    const parsed = parseOkxTrades(await getData(f, url), book);
    r.pages++; r.dropped += parsed.dropped;
    return { page: parsed.prints, askedAt };
  };
  const save = async (store: OkxPrint[]) => {
    if (!store.length) return;
    for (let i = 0; i < store.length; i += 500) await d.db.upsert("okx_trades", store.slice(i, i + 500).map(row), "book,trade_id");
    r.prints += store.length;
  };
  let pages = 0;
  while (cur?.hole && pages < OKX_PAGES_MAX && !late()) {
    const { page, askedAt } = await read(cur.hole.after);
    pages++;
    const s = stepOkxCursor(cur, page, false, askedAt);
    await save(s.store); cur = s.cur;
  }
  if (pages < OKX_PAGES_MAX && !late()) {
    const { page, askedAt } = await read(null);
    pages++;
    let s = stepOkxCursor(cur, page, true, askedAt);
    await save(s.store); cur = s.cur;
    while (s.next != null && pages < OKX_PAGES_MAX && !late()) {
      const back = await read(s.next);
      pages++;
      s = stepOkxCursor(cur, back.page, false, back.askedAt);
      await save(s.store); cur = s.cur;
    }
  }
  return cur;
}

async function recordBook(d: OkxRecDeps, f: typeof fetch, book: OkxBook, at: () => string, r: OkxBookReport) {
  const b = parseOkxBook(await getData(f, `${OKX_API}/api/v5/market/books?instId=${book}&sz=${OKX_LEVELS}`));
  if (!b) throw new Error("book: a side is empty");
  await d.db.upsert("okx_books", [{ book, ts: at(), bid: b.bid, ask: b.ask, bid_size: b.bid_size, ask_size: b.ask_size, levels: { bids: b.bids, asks: b.asks } }], "book,ts");
  r.book = true;
}

/**
 * One minute: each book's new prints and its book, side by side. A book that cannot be read is named in `errors` and the rest
 * go on; its prints wait for the next minute from where they stopped. `reached` says OKX answered at least one request from
 * the Edge region (the after-deploy check: Supabase runs this function in eu-west-2). Then the state row.
 */
export async function runOkxRec(d: OkxRecDeps): Promise<OkxRecReport & { state: OkxRecState }> {
  const f = d.fetchImpl ?? fetch;
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  const late = () => clock() - t0 > OKX_READS_UNTIL_MS;
  const report: OkxRecReport = { at: iso(d.now), ms: 0, books: {}, errors: [], report: false, reached: false };
  let state: OkxRecState = {};
  try {
    const [st] = await d.db.select<{ state: OkxRecState | null }>("okx_rec_state", "id=eq.1&select=state");
    state = st?.state ?? {};
  } catch (e) { report.errors.push(`state read: ${msg(e)}`); }
  const cursors: Partial<Record<OkxBook, OkxCursor>> = { ...(state.cursors ?? {}) };
  await Promise.all(OKX_BOOKS.map(async (b) => {
    const r: OkxBookReport = { prints: 0, pages: 0, dropped: 0, coveredTo: null, hole: false, book: false };
    report.books[b] = r;
    try { await recordBook(d, f, b, () => iso(d.now + (clock() - t0)), r); report.reached = true; } catch (e) { report.errors.push(`${b} book: ${msg(e)}`); }
    try {
      const cur = await recordPrints(d, f, b, cursors[b] ?? null, late, clock, r);
      if (r.pages) report.reached = true;
      if (cur) cursors[b] = cur;
    } catch (e) { report.errors.push(`${b} prints: ${msg(e)}`); }
    const c = cursors[b];
    r.coveredTo = c ? iso(c.coveredTo) : null;
    r.hole = !!c?.hole;
    if (r.dropped) report.errors.push(`${b} prints: ${r.dropped} unreadable`);
  }));
  report.errors.sort();
  report.ms = clock() - t0;
  const key = faultKey(report.errors);
  const prev = state.fault ?? null;
  report.report = reportDue(prev, key, d.now);
  const fault = !key ? undefined : report.report ? { key, at: d.now } : prev ?? undefined;
  state = { cursors, ...(fault ? { fault } : {}) };
  try {
    await d.db.upsert("okx_rec_state", [{
      id: 1, state, updated_at: iso(d.now), last_error: report.errors.join(" | ").slice(0, 1000) || null,
      last_report: { at: report.at, ms: report.ms, books: report.books, reached: report.reached },
    }], "id");
  } catch (e) {
    report.errors.push(`state: ${msg(e)}`);
    report.report = true;
  }
  return { ...report, state };
}
