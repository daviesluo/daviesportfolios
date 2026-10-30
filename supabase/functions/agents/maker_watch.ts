// The other maker's WATCH on Revolut X's two GBP stablecoin books (USDT-GBP, USDC-GBP). Davies, 2026-10-30: "我们能不能对他加个
// 监控，实时观察和记录他的行为" — watch the automated maker that quotes one order of about 5,000 coins a side, and keep a record
// of what it does (reviews/2026-10-30-mmcomp-3.md: 5 ticks wide to 10-12, 12 from 10-13, 5 again from 10-28 ~12:00, gone
// from 10-29 21:16; away before for 7-10 hours on 10-12 and 10-20).
//
// WHAT IT READS. Nothing new from the venue: the book recorder's own snapshots (`agent_book_levels`, books.ts: the top five
// levels a side, a row when the book changed, `seen_until` the last reading that found it unchanged) and PR5's minute record
// (`agent_quote_minutes`: GBP/USD and the USD fair, the fair LIVE quotes from). It places nothing and reads no key.
//
// WHAT IT WRITES, its own three tables (migration 0185):
//   agent_maker_minutes  a row per book per UTC minute: whether the maker was there (both sides, bid only, ask only, none,
//                        or 'unseen' when the recorder had no fresh reading), its prices and sizes, how each was recognised,
//                        the gap between its bid and ask in ticks, and each side's distance from LIVE's fair in bps;
//   agent_maker_events   appeared / disappeared / width (its bid-ask gap settled at a new number of ticks) / size (its
//                        order settled at a new size), each at the first minute of the run that made it;
//   agent_maker_state    each book's cursor (the last minute written), what the page shows, and the debounce's memory.
//
// HOW THE MAKER IS RECOGNISED, per side, the best level (nearest the touch) that is
//   'one'      one order within ±MW_SIZE_BAND coins of the maker's size (`ref`, started at 5,000 and following the median of
//              its recent one-order sightings, so the slow drift seen 09-26 -> 10-28, 5,000.2 to 5,019.6, is followed);
//   'shared'   several orders together holding from its size to MW_SHARED_EXTRA coins more (another order joined its price),
//              or up to MW_SHARED_SAME_EXTRA more at the very price it held on that side the minute before (10-08: 8,473
//              coins in two orders);
//   'partial'  one order of MW_PARTIAL_MIN coins or more, at most MW_CHAIN_FILL coins under and never over the order it was
//              last seen as on that side (within MW_CHAIN_MS), within MW_CHAIN_TICKS of its price: it was part-filled and
//              not topped up, and moves with the price at its smaller size (2026-10-27's night: 3,733.7 coins at 0.7497,
//              then 3,732.9 at 0.7487, then 3,699.8 at 0.7492).
// The recorder keeps five levels a side: on a crowded book (our rungs, the £0.10 bot) its order can sit deeper and is then
// not seen, which the debounce absorbs.
// Present on one side only is still present ('bid' / 'ask'); the width needs both. A maker that comes back at another size
// altogether (10,000 coins, say) reads as absent: each disappearance keeps the book's top levels in its event's detail, so
// a person can see what replaced it.
//
// WHEN A MINUTE IS SEEN. The recorder reads each book 40-52 s into the minute. Minute m reads the newest snapshot stamped
// before m + 60 s, if a reading found it at m - 60 s or later (one missed reading is allowed); otherwise the minute is
// 'unseen' and changes nothing in the debounce.
//
// THE DEBOUNCE. A flicker is not an event: disappeared after MW_GONE_MIN seen minutes in a row with no maker, appeared after
// MW_BACK_MIN with one; the width is the median of its last MW_WIDTH_WINDOW two-sided minutes, its event when that moves
// MW_WIDTH_STEP ticks or more (its 4-5 tick wobble is one regime, 5 to 12 another); the size the median of its recent
// one-order sightings in whole coins, its event when that moves MW_SIZE_STEP coins or more.
//
// WHEN IT RUNS. Inside the recorder's own call (`agents?action=books`, one row of `edge_calls`), in the 40 s the call waits
// before it reads, bounded by a deadline: no new recurring call. It writes minutes up to the last whole one, a chunk of
// MW_CHUNK_MIN minutes at a time and at most MW_RUN_CHUNKS chunks a run (an Edge request has 2 s of CPU, and the reads come
// after), so its first runs fill the history from MW_FROM (the recorder keeps 35 days) in about 50 minutes and every later
// run writes the minute just gone. A fault never reaches the recorder: the call catches it and reports it.

import type { Db } from "./db.ts";

export const MW_BOOKS = ["USDT-GBP", "USDC-GBP"] as const;
export type MwBook = typeof MW_BOOKS[number];
/** The history starts here: the first day of the recorder's snapshots still kept when the watch was built (2026-10-30). */
export const MW_FROM = Date.parse("2026-09-26T00:00:00Z");
export const MW_TICK = 0.0001;
/** The maker's size when the watch starts (both books, 2026-09-26: 5,000.0-5,000.6 coins). */
export const MW_SIZE0 = 5000.5;
/** A one-order level within this many coins of its size is its order. */
export const MW_SIZE_BAND = 50;
/** A level of several orders holding its size up to this many coins more holds its order and another's. */
export const MW_SHARED_EXTRA = 1000;
/** At the very price it held the minute before, a shared level may hold this much more (never a deep level of 100,000s). */
export const MW_SHARED_SAME_EXTRA = 5000;
/** A part-filled order: one order at least this big at the price it held the minute before. */
export const MW_PARTIAL_MIN = 2500;
/** A snapshot stands for minute m if a reading found it at m - this or later. */
export const MW_SEEN_MS = 60e3;
/** A part-filled or moved order is followed from the order last seen on its side for this long (see `mwSide`), ... */
export const MW_CHAIN_MS = 30 * 60e3;
/** ... by at most this many coins filled since it was last seen, ... */
export const MW_CHAIN_FILL = 1500;
/** ... and at most this many ticks from where it was. */
export const MW_CHAIN_TICKS = 20;
/** Disappeared after this many seen minutes in a row without it: its real absences last hours, and its order leaves the
 * five levels the recorder keeps for minutes at a time when the book is crowded or it is filled (2026-10-27's night). */
export const MW_GONE_MIN = 15;
export const MW_BACK_MIN = 3;
export const MW_WIDTH_WINDOW = 60;
export const MW_WIDTH_MIN = 20;
export const MW_WIDTH_STEP = 3;
export const MW_SIZE_WINDOW = 30;
export const MW_SIZE_STEP = 10;
/** Minutes a chunk covers: under PostgREST's 1,000 rows for each read. */
export const MW_CHUNK_MIN = 360;
/** Chunks a run writes at most, both books together. */
export const MW_RUN_CHUNKS = 6;
export const MW_TABLES = { minutes: "agent_maker_minutes", events: "agent_maker_events", state: "agent_maker_state" } as const;
const M = 60e3;

export type MwLevel = [price: number, qty: number, orders: number | null];
export type MwSnap = { ts: number; seen: number; bids: MwLevel[]; asks: MwLevel[] };
export type MwKind = "one" | "shared" | "partial";
export type MwSide = { price: number; qty: number; kind: MwKind };
/** Its order as last seen on a side: price, coins, and the minute. */
export type MwPrev = { price: number; qty: number; at: number };
export type MwPresent = "both" | "bid" | "ask" | "none" | "unseen";

/** The debounce's memory, kept in `agent_maker_state.memo`. */
export type MwMemo = {
  status: "present" | "absent" | null;
  since: number | null;
  run: { status: "present" | "absent"; from: number; n: number } | null;
  widths: number[];
  width: number | null;
  sizes: number[];
  size: number | null;
  ref: number;
  prevBid: MwPrev | null;
  prevAsk: MwPrev | null;
  lastX: number | null;
};
export const mwMemo0 = (): MwMemo => ({ status: null, since: null, run: null, widths: [], width: null, sizes: [], size: null, ref: MW_SIZE0, prevBid: null, prevAsk: null, lastX: null });

export type MwMinuteRow = {
  book: MwBook; minute: string; present: MwPresent;
  bid: number | null; bid_qty: number | null; bid_kind: MwKind | null;
  ask: number | null; ask_qty: number | null; ask_kind: MwKind | null;
  width_ticks: number | null; fair: number | null; bid_bps: number | null; ask_bps: number | null;
  touch_bid: number | null; touch_ask: number | null;
};
export type MwEventKind = "appeared" | "disappeared" | "width" | "size";
export type MwEventRow = { book: MwBook; ts: string; kind: MwEventKind; from_value: number | null; to_value: number | null; detail: Record<string, unknown> };

const iso = (ms: number) => new Date(ms).toISOString();
const ticks = (p: number) => Math.round(p / MW_TICK);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** One side's maker level: the best level that is its order (see the head of the file), or null. */
export function mwSide(levels: MwLevel[], ref: number, prev: MwPrev | null, m: number): MwSide | null {
  const chain = prev && m - prev.at <= MW_CHAIN_MS ? prev : null;
  for (const [price, qty, orders] of levels) {
    const n = orders ?? 1;
    if (n === 1 && Math.abs(qty - ref) <= MW_SIZE_BAND) return { price, qty, kind: "one" };
    const same = chain != null && ticks(price) === ticks(chain.price);
    if (n > 1 && qty >= ref - 0.5 && (qty <= ref + MW_SHARED_EXTRA || (same && qty <= ref + MW_SHARED_SAME_EXTRA))) return { price, qty, kind: "shared" };
    if (n === 1 && chain && qty >= MW_PARTIAL_MIN && qty <= chain.qty + 1 && qty >= chain.qty - MW_CHAIN_FILL &&
      Math.abs(ticks(price) - ticks(chain.price)) <= MW_CHAIN_TICKS) return { price, qty, kind: "partial" };
  }
  return null;
}

/** The snapshot that stands for minute `m` (snaps ascending by ts), or null when the recorder had no fresh reading. */
export function mwSnapFor(snaps: MwSnap[], m: number): MwSnap | null {
  let best: MwSnap | null = null;
  for (const s of snaps) { if (s.ts < m + M) best = s; else break; }
  return best && best.seen >= m - MW_SEEN_MS ? best : null;
}

/** LIVE's fair for a minute: PR5's USD fair over GBP/USD, the last X held through a minute without one (the weekend's rule). */
export function mwFair(fu: number | null, x: number | null, lastX: number | null): { fair: number | null; x: number | null } {
  const xx = x != null && x > 0 ? x : lastX;
  return { fair: fu != null && fu > 0 && xx ? fu / xx : null, x: xx };
}

/**
 * One minute: its row, its events, and the memory carried to the next. Pure: the same snapshots and minutes give the same
 * rows and events however the minutes are cut into runs.
 */
export function mwStep(book: MwBook, m: number, snap: MwSnap | null, fu: number | null, x: number | null, memo: MwMemo): { row: MwMinuteRow; events: MwEventRow[]; memo: MwMemo } {
  const mem: MwMemo = { ...memo, widths: [...memo.widths], sizes: [...memo.sizes], run: memo.run ? { ...memo.run } : null };
  const f = mwFair(fu, x, mem.lastX);
  mem.lastX = f.x;
  const fair = f.fair;
  const events: MwEventRow[] = [];
  const row: MwMinuteRow = {
    book, minute: iso(m), present: "unseen", bid: null, bid_qty: null, bid_kind: null, ask: null, ask_qty: null, ask_kind: null,
    width_ticks: null, fair, bid_bps: null, ask_bps: null, touch_bid: null, touch_ask: null,
  };
  if (!snap) return { row, events, memo: mem };
  const b = mwSide(snap.bids, mem.ref, mem.prevBid, m), a = mwSide(snap.asks, mem.ref, mem.prevAsk, m);
  row.touch_bid = snap.bids[0]?.[0] ?? null;
  row.touch_ask = snap.asks[0]?.[0] ?? null;
  row.present = b && a ? "both" : b ? "bid" : a ? "ask" : "none";
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (b) { row.bid = b.price; row.bid_qty = b.qty; row.bid_kind = b.kind; if (fair) row.bid_bps = r2((fair - b.price) / fair * 1e4); }
  if (a) { row.ask = a.price; row.ask_qty = a.qty; row.ask_kind = a.kind; if (fair) row.ask_bps = r2((a.price - fair) / fair * 1e4); }
  if (b && a) row.width_ticks = ticks(a.price) - ticks(b.price);
  // The order it was last seen as, a side each: a part-fill or a move is followed from it for MW_CHAIN_MS (a 'shared' level
  // says nothing of its own size, so it carries the last one on).
  if (b) mem.prevBid = { price: b.price, qty: b.kind === "shared" ? (mem.prevBid?.qty ?? mem.ref) : b.qty, at: m };
  if (a) mem.prevAsk = { price: a.price, qty: a.kind === "shared" ? (mem.prevAsk?.qty ?? mem.ref) : a.qty, at: m };

  // Presence, debounced.
  const now: "present" | "absent" = b || a ? "present" : "absent";
  if (mem.run && mem.run.status === now) mem.run.n++;
  else mem.run = { status: now, from: m, n: 1 };
  const need = now === "present" ? MW_BACK_MIN : MW_GONE_MIN;
  if (mem.status !== now && mem.run.n >= need) {
    const top = { bids: snap.bids.slice(0, 2), asks: snap.asks.slice(0, 2) };
    events.push({ book, ts: iso(mem.run.from), kind: now === "present" ? "appeared" : "disappeared", from_value: null, to_value: null,
      detail: now === "present" ? { width: row.width_ticks, bid: row.bid, ask: row.ask, size: b?.qty ?? a?.qty ?? null, firstStatus: mem.status } : { top, lastWidth: mem.width } });
    mem.status = now;
    mem.since = mem.run.from;
  }

  // The width: the median of its last MW_WIDTH_WINDOW two-sided minutes (once it has MW_WIDTH_MIN of them), an event when
  // it is MW_WIDTH_STEP ticks or more from the width it had: its 4-6 tick wobble is one regime, 5 to 12 another.
  // Only from its full-size orders: a part-filled one moving with the price says little of where it quotes.
  if (row.width_ticks != null && b?.kind !== "partial" && a?.kind !== "partial") {
    mem.widths.push(row.width_ticks);
    if (mem.widths.length > MW_WIDTH_WINDOW) mem.widths.shift();
    const w = median(mem.widths)!;
    if (mem.widths.length >= MW_WIDTH_MIN && (mem.width == null || Math.abs(w - mem.width) >= MW_WIDTH_STEP)) {
      events.push({ book, ts: iso(m), kind: "width", from_value: mem.width, to_value: w, detail: { window: mem.widths.length } });
      mem.width = w;
    }
  }
  if (now === "absent" && mem.status === "absent") mem.widths = [];

  // The size: the median of its recent one-order sightings, in whole coins; it also moves `ref`, which follows the drift.
  for (const s of [b, a]) if (s?.kind === "one") { mem.sizes.push(s.qty); if (mem.sizes.length > MW_SIZE_WINDOW) mem.sizes.shift(); }
  const med = median(mem.sizes);
  if (med != null && mem.sizes.length >= Math.min(MW_SIZE_WINDOW, 10)) {
    mem.ref = med;
    const whole = Math.round(med);
    if (mem.size == null || Math.abs(whole - mem.size) >= MW_SIZE_STEP) {
      events.push({ book, ts: iso(m), kind: "size", from_value: mem.size, to_value: whole, detail: { sightings: mem.sizes.length } });
      mem.size = whole;
    }
  }
  return { row, events, memo: mem };
}

/** What the page shows for a book, from its state row. */
export type MwStatus = {
  book: MwBook; at: string | null; status: "present" | "absent" | null; since: string | null; present: MwPresent | null;
  width: number | null; bid: number | null; ask: number | null; bidBps: number | null; askBps: number | null; size: number | null;
};

type StateRow = { book: string; cursor: string | null; memo: MwMemo | null; last: MwMinuteRow | null };

/** The page's view of the watch: one entry a book, null for a book the watch has not written yet. */
export function mwStatusOf(rows: StateRow[]): Partial<Record<MwBook, MwStatus>> {
  const out: Partial<Record<MwBook, MwStatus>> = {};
  for (const r of rows) {
    if (!MW_BOOKS.includes(r.book as MwBook) || !r.memo) continue;
    const l = r.last;
    out[r.book as MwBook] = {
      book: r.book as MwBook, at: r.cursor, status: r.memo.status, since: r.memo.since != null ? iso(r.memo.since) : null,
      present: l?.present ?? null, width: r.memo.width, bid: l?.bid ?? null, ask: l?.ask ?? null, bidBps: l?.bid_bps ?? null, askBps: l?.ask_bps ?? null,
      size: r.memo.size,
    };
  }
  return out;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const levels = (v: unknown): MwLevel[] => (Array.isArray(v) ? v : []).map((l) => [Number(l[0]), Number(l[1]), l[2] == null ? null : Number(l[2])] as MwLevel);

export type MwReport = { books: Partial<Record<MwBook, { from: string; to: string; minutes: number; events: number }>>; behind: boolean };

/**
 * Write every whole minute not yet written, a chunk at a time, oldest first, until caught up or `deadline` (the call's
 * clock) passes. Each chunk's rows, events and state go out together after it is worked out, so a run cut short resumes at
 * the chunk it did not write.
 */
export async function runMakerWatch(d: { db: Db; clock?: () => number; deadline: number }): Promise<MwReport> {
  const clock = d.clock ?? (() => Date.now());
  const report: MwReport = { books: {}, behind: false };
  let chunks = 0;
  const last = Math.floor(clock() / M) * M - M;      // the last whole minute: its reading came 40-52 s into it
  for (const book of MW_BOOKS) {
    const [st] = await d.db.select<StateRow>(MW_TABLES.state, `book=eq.${book}&select=book,cursor,memo,last`);
    let memo: MwMemo = st?.memo ? { ...mwMemo0(), ...st.memo } : mwMemo0();
    let from = st?.cursor ? Date.parse(st.cursor) + M : MW_FROM;
    if (memo.lastX == null) {
      const [x] = await d.db.select<{ x: unknown }>("agent_quote_minutes", `book=eq.${book}&minute=lt.${encodeURIComponent(iso(from))}&x=gt.0&select=x&order=minute.desc&limit=1`);
      memo.lastX = num(x?.x);
    }
    while (from <= last) {
      if (clock() > d.deadline || chunks >= MW_RUN_CHUNKS) { report.behind = true; break; }
      chunks++;
      const to = Math.min(last, from + (MW_CHUNK_MIN - 1) * M);
      const [before, within, mins] = await Promise.all([
        d.db.select<{ ts: string; seen_until: string | null; bids: unknown; asks: unknown }>("agent_book_levels",
          `book=eq.${book}&ts=lt.${encodeURIComponent(iso(from))}&select=ts,seen_until,bids,asks&order=ts.desc&limit=1`),
        d.db.select<{ ts: string; seen_until: string | null; bids: unknown; asks: unknown }>("agent_book_levels",
          `book=eq.${book}&ts=gte.${encodeURIComponent(iso(from))}&ts=lt.${encodeURIComponent(iso(to + M))}&select=ts,seen_until,bids,asks&order=ts.asc&limit=1000`),
        d.db.select<{ minute: string; x: unknown; fair_u: unknown }>("agent_quote_minutes",
          `book=eq.${book}&minute=gte.${encodeURIComponent(iso(from))}&minute=lte.${encodeURIComponent(iso(to))}&select=minute,x,fair_u&order=minute.asc&limit=1000`),
      ]);
      const snaps: MwSnap[] = [...before, ...within].map((s) => ({ ts: Date.parse(s.ts), seen: Date.parse(s.seen_until ?? s.ts), bids: levels(s.bids), asks: levels(s.asks) }));
      const byMin = new Map(mins.map((r) => [Date.parse(r.minute), r]));
      const rows: MwMinuteRow[] = [], events: MwEventRow[] = [];
      let i = 0;
      for (let m = from; m <= to; m += M) {
        while (i + 1 < snaps.length && snaps[i + 1].ts < m + M) i++;
        const snap = snaps.length ? mwSnapFor(snaps.slice(i, i + 1), m) : null;
        const q = byMin.get(m);
        const r = mwStep(book, m, snap && snap.ts < m + M ? snap : null, num(q?.fair_u), num(q?.x), memo);
        memo = r.memo; rows.push(r.row); events.push(...r.events);
      }
      await d.db.upsert(MW_TABLES.minutes, rows, "book,minute");
      if (events.length) await d.db.upsert(MW_TABLES.events, events, "book,ts,kind");
      await d.db.upsert(MW_TABLES.state, [{ book, cursor: iso(to), memo, last: rows[rows.length - 1], updated_at: iso(clock()) }], "book");
      const b = report.books[book] ?? { from: iso(from), to: iso(to), minutes: 0, events: 0 };
      b.to = iso(to); b.minutes += rows.length; b.events += events.length;
      report.books[book] = b;
      from = to + M;
    }
  }
  return report;
}
