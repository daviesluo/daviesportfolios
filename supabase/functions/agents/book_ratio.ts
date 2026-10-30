// Each book's, and each coin's, realised a year on its share of a strategy's capital since an instant: the per-coin comparison a
// Stablecoin quotes page shows under its scoreboard. One reading for every venue: Revolut X's twins on both books from the
// USDT-only switch (`twinBookRatio`, index.ts; Davies, 2026-10-29: "追踪usdt和usdc的年化比率，在它子页面的score board下加一行文字更新这个"),
// and Coinbase's "with Euros - 1" and "- 2" (`coinbaseInUsd`, cb_page.ts; Davies, 2026-10-30: "-1和-2都像revolut那几个一样在scoreboard
// 底下加上不同币的performace对比"). The page writes it as one line (`quotesTwinRatioLine`, src/agents/agents.js).

/** A round trip as this reads it: its book, when it closed, and what it made in the capital's currency. */
export type RatioTrip = { book: string; tExit: string | number; pnl: number };

/** One book's, or one coin's, part: its round trips since the instant, what they made, its share of the capital, that a year. */
export type RatioPart = { trips: number; realised: number; share: number; pctYear: number | null };

/** The coin of a book: "USDT-GBP" → "USDT". */
export const coinOf = (book: string) => book.split("-")[0];

/**
 * Each of `books`' realised a year on its share of `capital` (its weight over the books', `weight` defaulting to 1) from `from`,
 * of the round trips that closed since then; each coin's over its books together; and USDT's over USDC's when the strategy quotes
 * both (null while USDC has made nothing or lost). The whole is null before the instant.
 */
export function booksAYear(trips: ReadonlyArray<RatioTrip>, o: { from: number; now: number; capital: number; books: readonly string[]; weight?: (book: string) => number }) {
  if (!(o.now > o.from)) return null;
  const w = o.weight ?? (() => 1), sum = o.books.reduce((a, b) => a + w(b), 0);
  const years = (o.now - o.from) / (365 * 864e5);
  const part = (mine: ReadonlyArray<RatioTrip>, share: number): RatioPart => {
    const realised = mine.reduce((a, t) => a + t.pnl, 0);
    return { trips: mine.length, realised, share, pctYear: share > 0 ? 100 * realised / share / years : null };
  };
  const since = trips.filter((t) => (typeof t.tExit === "number" ? t.tExit : Date.parse(t.tExit)) >= o.from);
  const shareOf = (b: string) => (sum > 0 ? o.capital * w(b) / sum : 0);
  const books = Object.fromEntries(o.books.map((b) => [b, part(since.filter((t) => t.book === b), shareOf(b))])) as Record<string, RatioPart>;
  const coinNames = [...new Set(o.books.map(coinOf))];
  const coins = Object.fromEntries(coinNames.map((c) => {
    const mine = o.books.filter((b) => coinOf(b) === c);
    return [c, part(since.filter((t) => mine.includes(t.book)), mine.reduce((a, b) => a + shareOf(b), 0))];
  })) as Record<string, RatioPart>;
  const c = coins.USDC?.pctYear ?? null, t = coins.USDT?.pctYear ?? null;
  return { from: new Date(o.from).toISOString(), books, coins, usdtOverUsdc: c != null && t != null && c > 0 ? t / c : null };
}
