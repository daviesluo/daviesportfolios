// Revolut X's UK order books for the stablecoin quotes' queue model (fp5 review, 2026-09-26: "no book history" stopped
// both fp2 and fp5). On a pegged book a resting quote is filled by its place in the queue far more often than by the
// price moving through it, and nothing on record says how long that queue was. This records it: the top levels of the
// four stablecoin books, read once a minute from the keyless public book, and stored only when they change.
//
// It reads nothing but the public book, needs no key and places nothing; nothing reads its table but a study. The
// queue model it is for is pre-registered before any of it is read.

import type { Db } from "./db.ts";

export const BOOK_SYMBOLS = ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"] as const;
export type BookSymbol = typeof BOOK_SYMBOLS[number];
/** Levels kept a side: the public book's own page of five. */
export const BOOK_LEVELS = 5;
const BOOK_HOST = "https://revx.revolut.com";

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

export type BooksReport = { recorded: number; unchanged: number; errors: string[] };

/**
 * One minute: read the four books and store each that differs from its last stored reading. A book that cannot be read
 * is skipped for the minute and says so; the others are kept. The table's retention is the migration's own daily job.
 */
export async function runBooks(d: { db: Db; now: number; fetchImpl?: typeof fetch }): Promise<BooksReport> {
  const report: BooksReport = { recorded: 0, unchanged: 0, errors: [] };
  const f = d.fetchImpl ?? fetch;
  const ts = new Date(Math.floor(d.now / 60e3) * 60e3).toISOString();
  const rows: Array<{ book: BookSymbol; ts: string; bids: BookLevel[]; asks: BookLevel[] }> = [];
  await Promise.all(BOOK_SYMBOLS.map(async (b) => {
    try {
      const res = await f(`${BOOK_HOST}/api/2.0/public/order-book/${b}?region=UK&limit=${BOOK_LEVELS}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status}`);
      const now = bookLevels(await res.json());
      if (!now) throw new Error("unreadable book");
      const [last] = await d.db.select<{ bids: BookLevel[]; asks: BookLevel[] }>("agent_book_levels", `book=eq.${b}&select=bids,asks&order=ts.desc&limit=1`);
      if (last && sameBook(now, { bids: last.bids, asks: last.asks })) { report.unchanged++; return; }
      rows.push({ book: b, ts, ...now });
    } catch (e) { report.errors.push(`${b}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); }
  }));
  if (rows.length) {
    await d.db.upsert("agent_book_levels", rows, "book,ts");
    report.recorded = rows.length;
  }
  return report;
}
