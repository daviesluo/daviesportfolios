// Revolut X's UK order books for the stablecoin quotes' queue model (fp5 review, 2026-09-26: "no book history" stopped
// both fp2 and fp5). On a pegged book a resting quote is filled by its place in the queue far more often than by the
// price moving through it, and nothing on record says how long that queue was. This records it: the top levels of the
// four stablecoin books, read once a minute from the keyless public book, and stored only when they change.
//
// It reads nothing but the public book, needs no key and places nothing; nothing reads its table but a study. The
// queue model it is for is pre-registered before any of it is read.
//
// The public endpoints share a bucket of about a token a second (reference §2), and the tick (from :00) and PR5's
// engine (from :25) read them every minute. The first version read all four books at once at :00 and lost three of
// them to 429 every minute (2026-09-26 18:16–18:20 UTC). So it reads 40 s into the minute, when both are done, one
// book at a time, and it gives the bucket back on the first 429: it is the one reader here that can miss a minute.

import type { Db } from "./db.ts";

export const BOOK_SYMBOLS = ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"] as const;
export type BookSymbol = typeof BOOK_SYMBOLS[number];
/** Levels kept a side: the public book's own page of five. */
export const BOOK_LEVELS = 5;
const BOOK_HOST = "https://revx.revolut.com";
/** How far into the minute the reads start: after the tick's public reads (from :00) and PR5's (from :25). */
export const BOOKS_START_MS = 40e3;
/** Between two of its own reads: a little more than the bucket's token a second. */
export const BOOKS_GAP_MS = 1_250;
/** No read starts later than this after the first, so a run ends well inside its cron call's 58 s. */
export const BOOKS_BUDGET_MS = 12e3;
const BOOK_TIMEOUT_MS = 4_000;

/** How long the cron call waits before reading: until `BOOKS_START_MS` into the minute, or not at all past it. */
export function booksDelayMs(nowMs: number): number {
  const into = nowMs % 60e3;
  return into < BOOKS_START_MS ? BOOKS_START_MS - into : 0;
}

/** The four books in the order a minute reads them: turned by one each minute, so a 429 never costs the same book twice running. */
export function bookOrder(nowMs: number): BookSymbol[] {
  const k = Math.floor(nowMs / 60e3) % BOOK_SYMBOLS.length;
  return [...BOOK_SYMBOLS.slice(k), ...BOOK_SYMBOLS.slice(0, k)];
}

/** One level as stored: price, quantity, and how many orders make it up (null when the venue did not say). */
export type BookLevel = [price: number, qty: number, orders: number | null];
export type BookSides = { bids: BookLevel[]; asks: BookLevel[] };

/** The public book (`{ data: { bids, asks } }`, levels of `price`, `quantity`, `count`), best level first; null when unreadable. */
export function bookLevels(raw: unknown): BookSides | null {
  const top = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const d = top && top.data && typeof top.data === "object" ? top.data as Record<string, unknown> : null;
  if (!d || !Array.isArray(d.bids) || !Array.isArray(d.asks)) return null;
  const level = (l: unknown): BookLevel | null => {
    if (!l || typeof l !== "object") return null;
    const r = l as Record<string, unknown>;
    const p = Number(r.price), q = Number(r.quantity), n = r.count == null ? null : Number(r.count);
    return Number.isFinite(p) && p > 0 && Number.isFinite(q) && q >= 0 ? [p, q, n != null && Number.isFinite(n) ? n : null] : null;
  };
  const side = (xs: unknown[], desc: boolean) => xs.map(level).filter((x): x is BookLevel => x != null)
    .sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, BOOK_LEVELS);
  return { bids: side(d.bids, true), asks: side(d.asks, false) };
}

/** Whether two readings of a book are the same book: every level's price, quantity and order count. */
export const sameBook = (a: BookSides | null, b: BookSides | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

export type BooksReport = { recorded: number; unchanged: number; errors: string[]; skipped: BookSymbol[] };

type Stored = { ts: string; bids: BookLevel[]; asks: BookLevel[]; reads: number | null };

/**
 * One minute: read the four books one after another and store each that differs from its last stored reading. A
 * reading that finds the book unchanged extends that row instead (`seen_until`, `reads`), so a study can tell a book
 * that stood still from one nobody saw. A book that cannot be read is skipped for the minute and says so; a 429 ends
 * the minute's reads there. The table's retention is the migration's own daily job.
 */
export async function runBooks(d: {
  db: Db; clock?: () => number; fetchImpl?: typeof fetch; pause?: (ms: number) => Promise<void>;
}): Promise<BooksReport> {
  const report: BooksReport = { recorded: 0, unchanged: 0, errors: [], skipped: [] };
  const clock = d.clock ?? (() => Date.now());
  const f = d.fetchImpl ?? fetch;
  const pause = d.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = clock();
  const order = bookOrder(t0);
  let last = 0;
  for (const [i, b] of order.entries()) {
    const wait = last ? last + BOOKS_GAP_MS - clock() : 0;
    if (wait > 0) await pause(wait);
    if (clock() - t0 > BOOKS_BUDGET_MS) { report.skipped.push(...order.slice(i)); break; }
    last = clock();
    try {
      const res = await f(`${BOOK_HOST}/api/2.0/public/order-book/${b}?region=UK&limit=${BOOK_LEVELS}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(BOOK_TIMEOUT_MS) });
      const body = await res.text();
      const at = new Date(clock()).toISOString();
      if (res.status === 429) {
        report.errors.push(`${b}: 429`);
        report.skipped.push(...order.slice(i + 1));
        break;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      let now: BookSides | null = null;
      try { now = bookLevels(JSON.parse(body)); } catch { /* unreadable below */ }
      if (!now) throw new Error("unreadable book");
      const [prev] = await d.db.select<Stored>("agent_book_levels", `book=eq.${b}&select=ts,bids,asks,reads&order=ts.desc&limit=1`);
      if (prev && sameBook(now, { bids: prev.bids, asks: prev.asks })) {
        await d.db.update("agent_book_levels", `book=eq.${b}&ts=eq.${encodeURIComponent(prev.ts)}`, { seen_until: at, reads: (prev.reads ?? 1) + 1 });
        report.unchanged++;
      } else {
        await d.db.upsert("agent_book_levels", [{ book: b, ts: at, bids: now.bids, asks: now.asks, seen_until: at, reads: 1 }], "book,ts");
        report.recorded++;
      }
    } catch (e) { report.errors.push(`${b}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); }
  }
  return report;
}
