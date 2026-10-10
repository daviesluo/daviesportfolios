// Coinbase's four GBP and EUR stablecoin order books, RECORDED: the top ten price levels a side, once a minute, stored only
// when they changed. Davies, 2026-10-10: "Coinbase的订单簿要不要像 Revolut X 一样也记录上用来inform策略" — record Coinbase's
// books as Revolut X's are (`books.ts`), to inform the strategy.
//
// WHAT IT IS FOR. On a pegged book a resting quote is filled by its place in the queue far more often than by the price
// moving through it, and the prints and the touch (`cb_rec.ts`) do not say how long that queue was. This keeps it: for a
// queue model of the Coinbase books, the same use as Revolut X's QUEUE study, pre-registered before any of it is read;
// and for where a rung sits and how deep the book is behind it. NOTHING IN THE FROZEN PAPER TEST READS IT: the Coinbase
// paper test (`cb_quotes.ts`, docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md) decides on the recorded prints
// alone, and this file, its table and its call (migration 0114) touch none of the recorder's or the test's files.
//
// It trades nothing, reads no key and places nothing: `GET /products/{id}/book?level=2` is Coinbase Exchange's public market
// data. It reads and writes only `cb_book_levels` and `cb_book_state`.
//
// THE ROW. Each level is `[price, size, num_orders]` as served (price and size strings). A row keeps a side's ten best as
// three arrays: prices in the book's price steps (`CB_BOOK_TICK`: 0.0001, USDT-EUR 0.00001, Coinbase's `quote_increment`
// read 2026-10-10), sizes in hundredths of a coin (its `base_increment`, 0.01, on all four), order counts. A price or size
// off that grid is a fault and the book is skipped for the minute, so a change of step is seen at once, never stored
// wrong. With the arrays: Coinbase's `sequence` (it counts the book's messages, so its difference between two rows says how
// busy the book was between them) and its `time`. Measured 2026-10-10 on the production database (`pg_column_size` of the
// fixture's books as the table's types): 524 bytes a row (the same levels as numerics, about a fifth more), about 560 with
// its key, so 5,760 rows a day are about 3.2 MB and the 35 days 0114 keeps about 113 MB (the database was 1,312 MB). All
// four books changed between two readings a minute apart (the fixture), so nearly every reading is a row.
//
// THE BUDGET. Coinbase serves public data at 10 requests a second per IP. The recorder (`cb_rec.ts`) reads from the top of
// the minute and starts no read past 15 s, each waiting 8 s at most, so it is done by 23 s: eight requests a minute
// usually (a touch and a trades page a book), 28 at most (six pages a book in a burst). This reads from 30 s into the
// minute (`CB_BOOKS_START_MS`), one book at a time 250 ms apart: four requests, never more than four in a second, and never
// in a second the recorder reads. A minute is so 12 requests usually and 32 at most. A 429 ends its minute there: it is the
// reader here that gives way. The edge sits behind Coinbase's CDN, which caches a book for up to 2 s (`max-age=2`): the
// row's `book_ts` is Coinbase's own time for what it served.
//
// A fault is reported to `ops_errors` as `agents.cb_books` when it first appears and at most hourly while it lasts
// (`faultKey`, `reportDue`, as the recorder's).

import type { Db } from "./db.ts";
import { CB_API, CB_PRODUCTS, type CbProduct } from "./cb_rec.ts";
import { faultKey, reportDue } from "./pm_book_rec.ts";

/** Levels kept a side. The top ten of USDC-GBP spanned 21 bps on 2026-10-09; USDT-EUR showed 8 to 16 levels in all. */
export const CB_BOOK_LEVELS = 10;
/** Each book's price step (Coinbase's `quote_increment`, 2026-10-10). */
export const CB_BOOK_TICK: Record<CbProduct, number> = { "USDC-GBP": 1e-4, "USDT-GBP": 1e-4, "USDC-EUR": 1e-4, "USDT-EUR": 1e-5 };
/** The size unit, in coins (Coinbase's `base_increment`, 0.01 on all four). */
export const CB_BOOK_SIZE_UNIT = 0.01;
/** How far into the minute the reads start: after the recorder's (from :00, none starting past 15 s, each 8 s at most). */
export const CB_BOOKS_START_MS = 30e3;
/** Between two of its own reads. */
export const CB_BOOKS_GAP_MS = 250;
/** No read starts later than this after the first, so a run ends well inside its call's 58 s. */
export const CB_BOOKS_BUDGET_MS = 12e3;
export const CB_BOOKS_TIMEOUT_MS = 4_000;
const UA = "daviesportfolios-cb-books/1.0 (public data only)";

/** How long the call waits before reading: until `CB_BOOKS_START_MS` into the minute, or not at all past it. */
export function cbBooksDelayMs(nowMs: number): number {
  const into = nowMs % 60e3;
  return into < CB_BOOKS_START_MS ? CB_BOOKS_START_MS - into : 0;
}

/** The four books in the order a minute reads them: turned by one each minute, so a 429 never costs the same book twice running. */
export function cbBookOrder(nowMs: number): CbProduct[] {
  const k = Math.floor(nowMs / 60e3) % CB_PRODUCTS.length;
  return [...CB_PRODUCTS.slice(k), ...CB_PRODUCTS.slice(0, k)];
}

/** One side as a row keeps it: prices in steps, sizes in hundredths of a coin, order counts; best level first. */
export type CbBookSide = { px: number[]; sz: number[]; n: number[] };
export type CbBook = { seq: number | null; bookTs: string | null; bid: CbBookSide; ask: CbBookSide };

/** A value as a whole number of `unit`s, or null when it is not one (to a millionth of the unit). */
function onGrid(v: unknown, unit: number): number | null {
  const x = typeof v === "string" && v !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(x) || x < 0) return null;
  const k = Math.round(x / unit);
  return Math.abs(k - x / unit) <= 1e-6 && Number.isSafeInteger(k) ? k : null;
}

/**
 * The level-2 book (`{ bids: [[price, size, num_orders]], asks, sequence, time, … }`) as a row's levels: each side sorted
 * best first and cut to `CB_BOOK_LEVELS`. Throws, naming why, when the answer is not a book, a level is not three
 * readable values, or a price or size is off the book's grid; a side may be shorter than ten, or empty.
 */
export function parseCbBook(raw: unknown, product: CbProduct): CbBook {
  const top = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!top || !Array.isArray(top.bids) || !Array.isArray(top.asks)) throw new Error("not a book");
  const tick = CB_BOOK_TICK[product];
  const side = (xs: unknown[], desc: boolean): CbBookSide => {
    const levels = xs.map((l) => {
      if (!Array.isArray(l) || l.length < 3) throw new Error("unreadable level");
      const px = onGrid(l[0], tick), sz = onGrid(l[1], CB_BOOK_SIZE_UNIT), n = typeof l[2] === "number" ? l[2] : Number(l[2]);
      if (px == null || px <= 0) throw new Error(`price off the ${tick} grid: ${String(l[0]).slice(0, 20)}`);
      if (sz == null) throw new Error(`size off the ${CB_BOOK_SIZE_UNIT} grid: ${String(l[1]).slice(0, 20)}`);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("unreadable order count");
      return [px, sz, n] as const;
    }).sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, CB_BOOK_LEVELS);
    return { px: levels.map((l) => l[0]), sz: levels.map((l) => l[1]), n: levels.map((l) => l[2]) };
  };
  const seq = typeof top.sequence === "number" && Number.isSafeInteger(top.sequence) ? top.sequence : null;
  const bookTs = typeof top.time === "string" && Number.isFinite(Date.parse(top.time)) ? top.time : null;
  return { seq, bookTs, bid: side(top.bids, true), ask: side(top.asks, false) };
}

/** Whether two readings hold the same levels: every price, size and order count (the sequence and time aside). */
export function sameCbBook(a: Pick<CbBook, "bid" | "ask">, b: Pick<CbBook, "bid" | "ask">): boolean {
  const k = (s: CbBookSide) => JSON.stringify([s.px, s.sz, s.n]);
  return k(a.bid) === k(b.bid) && k(a.ask) === k(b.ask);
}

/** A reading as `cb_book_levels` keeps it. */
export function cbBookRow(product: CbProduct, at: string, b: CbBook) {
  return {
    product, ts: at, seq: b.seq, book_ts: b.bookTs,
    bid_px: b.bid.px, bid_sz: b.bid.sz, bid_n: b.bid.n, ask_px: b.ask.px, ask_sz: b.ask.sz, ask_n: b.ask.n,
    seen_until: at, reads: 1,
  };
}

export type CbBooksReport = {
  at: string; ms: number; recorded: number; unchanged: number; skipped: CbProduct[]; errors: string[]; report: boolean; reached: boolean;
};
export type CbBooksState = { fault?: { key: string; at: number } };
type Stored = { ts: string; bid_px: number[]; bid_sz: number[]; bid_n: number[]; ask_px: number[]; ask_sz: number[]; ask_n: number[]; reads: number | null };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * One minute: read the four books one after another and store each that differs from its last stored row. A reading
 * that finds the book unchanged extends that row instead (`seen_until`, `reads`), so a study can tell a book that stood
 * still from one nobody saw. A book that cannot be read is skipped for the minute and named in `errors`; a 429 ends the
 * minute's reads there. Then the state row: the fault last reported, the minute's errors and its report.
 */
export async function runCbBooks(d: {
  db: Db; now: number; clock?: () => number; fetchImpl?: typeof fetch; pause?: (ms: number) => Promise<void>;
}): Promise<CbBooksReport> {
  const clock = d.clock ?? (() => Date.now());
  const f = d.fetchImpl ?? fetch;
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = clock();
  const report: CbBooksReport = { at: iso(d.now), ms: 0, recorded: 0, unchanged: 0, skipped: [], errors: [], report: false, reached: false };
  const order = cbBookOrder(d.now);
  let last: number | null = null;
  for (const [i, p] of order.entries()) {
    const wait = last == null ? 0 : last + CB_BOOKS_GAP_MS - clock();
    if (wait > 0) await pause(wait);
    if (clock() - t0 > CB_BOOKS_BUDGET_MS) { report.skipped.push(...order.slice(i)); break; }
    last = clock();
    try {
      const res = await f(`${CB_API}/products/${p}/book?level=2`,
        { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(CB_BOOKS_TIMEOUT_MS) });
      const body = await res.text();
      report.reached = true;
      if (res.status === 429) {
        // Named by its place in the minute, not its book (`skipped` names those): the order turns each minute, so a limit
        // that lasts keeps one fault key and is reported hourly, not every minute.
        report.errors.push(`429 at read ${i + 1}`);
        report.skipped.push(...order.slice(i + 1));
        break;
      }
      if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 80)}`);
      let raw: unknown;
      try { raw = JSON.parse(body); } catch { throw new Error("unreadable JSON"); }
      const book = parseCbBook(raw, p);
      const at = iso(d.now + (clock() - t0));
      const [prev] = await d.db.select<Stored>("cb_book_levels",
        `product=eq.${p}&select=ts,bid_px,bid_sz,bid_n,ask_px,ask_sz,ask_n,reads&order=ts.desc&limit=1`);
      if (prev && sameCbBook(book, { bid: { px: prev.bid_px, sz: prev.bid_sz, n: prev.bid_n }, ask: { px: prev.ask_px, sz: prev.ask_sz, n: prev.ask_n } })) {
        await d.db.update("cb_book_levels", `product=eq.${p}&ts=eq.${encodeURIComponent(prev.ts)}`, { seen_until: at, reads: (prev.reads ?? 1) + 1 });
        report.unchanged++;
      } else {
        await d.db.upsert("cb_book_levels", [cbBookRow(p, at, book)], "product,ts");
        report.recorded++;
      }
    } catch (e) { report.errors.push(`${p}: ${msg(e)}`); }
  }
  report.errors.sort();
  report.ms = clock() - t0;
  let state: CbBooksState = {};
  try {
    const [st] = await d.db.select<{ state: CbBooksState | null }>("cb_book_state", "id=eq.1&select=state");
    state = st?.state ?? {};
  } catch (e) { report.errors.push(`state read: ${msg(e)}`); }
  const key = faultKey(report.errors);
  const prev = state.fault ?? null;
  report.report = reportDue(prev, key, d.now);
  const fault = !key ? undefined : report.report ? { key, at: d.now } : prev ?? undefined;
  try {
    await d.db.upsert("cb_book_state", [{
      id: 1, state: fault ? { fault } : {}, updated_at: iso(d.now), last_error: report.errors.join(" | ").slice(0, 1000) || null,
      last_report: { at: report.at, ms: report.ms, recorded: report.recorded, unchanged: report.unchanged, skipped: report.skipped, reached: report.reached },
    }], "id");
  } catch (e) {
    report.errors.push(`state: ${msg(e)}`);
    report.report = true;
  }
  return report;
}
