// The paper test of PR5's rule (reference §3.27, §4 item 31): 0 % resting quotes 0.1 / 0.2 / 0.3 % either side of
// interbank on Revolut X's USDC/GBP and USDT/GBP books, run forward on PAPER, one minute at a time.
//
// It is a notebook, like the maker probes: it never calls a venue's order endpoints, never writes `agent_orders`,
// and no position, exposure, cap or P&L of the strategy rows reads it. Its own tables (`0051`) hold every input it
// read — each print, each minute's GBP/USD, each hour's USD-book close — beside what it concluded, so the frozen
// simulator can replay the four weeks and say whether the loop ran the rule it was tested on.
//
// `stepMinute` is `simulate()` in docs/agents/scripts/pr5/pr5_sim.py (frozen with PR5's pre-registration), one
// minute at a time: the turn at the start of minute t on data up to t−1, the go-live check at the start of t, the
// prints during t in time order, then the 24-hour stop. `quotes.test.ts` replays that script's golden windows trip
// for trip. The driver runs one minute BEHIND the clock, so a minute's prints are complete before it is decided —
// every decision still uses only what was known when the rule would have acted.

import { revxPublic, type RevxResponse } from "../_shared/revx.ts";
import type { Db } from "./db.ts";

export const QUOTE_BOOKS = ["USDC-GBP", "USDT-GBP"] as const;
export type QuoteBook = typeof QUOTE_BOOKS[number];
/** The USD book whose 24-hour median is the stablecoin's fair value in dollars. */
export const QUOTE_USD_BOOK: Record<QuoteBook, "USDC-USD" | "USDT-USD"> = { "USDC-GBP": "USDC-USD", "USDT-GBP": "USDT-USD" };
export const QUOTE_RUNGS = [0.001, 0.002, 0.003];
export const QUOTE_TICK = 1e-4;
export const QUOTE_REPRICE = 0.0005;             // a quote moves when fair has moved more than 0.05 % since it was priced
export const QUOTE_FEE = 0.0009;                 // the taker fee the 24-hour stop pays …
export const QUOTE_HALF_SPREAD = 0.000067;       // … plus half the measured spread
export const QUOTE_SIZE_USD = 100;               // one rung
export const QUOTE_VOLUME_SHARE = 0.10;          // and at most this share of the minute's printed volume
const M = 60e3, H = 3600e3, DAY = 86400e3;
export const QUOTE_STOP_MS = DAY;                // a position this old is closed at the last print, as a taker
export const QUOTE_FX_LOOKBACK_MS = 10 * M;      // no GBP/USD minute in the last ten: dark, no entry quotes
export const QUOTE_LEASE_MS = 55e3;
export const QUOTE_MAX_MINUTES = 120;            // minutes caught up in one run at most
export const QUOTE_REVX_GAP_MS = 1_100;          // between this module's own Revolut X calls (one token a second)

export type Side = "bid" | "ask";
export type Aggressor = "buy" | "sell";
/** A print: time (ms), price in 0.0001 ticks, quantity (base units), the aggressor's side, the venue's id. */
export type Print = { ts: number; ticks: number; qty: number; side: Aggressor; id: string };
export type QOrder = { side: Side; ticks: number; fairAt: number; live: number; state: "pending" | "live" | "rejected"; oid: number };
export type Rung = {
  side: Side; k: number; mode: "idle" | "quote" | "position"; o: QOrder | null;
  entry?: number; tEntry?: number; qty?: number; nq?: number; fillTs?: number; fillId?: string; entryOid?: number;
  xEntry?: number; fairEntry?: number | null;
};
export type BookState = { book: QuoteBook; rungs: Rung[]; lastX: number | null; lastPrint: Print | null; nextOid: number };
export type Trip = {
  book: QuoteBook; side: Side; k: number; tEntry: number; fillTs: number; fillId: string; entry: number; qty: number;
  nq: number; xEntry: number; fairEntry: number | null; entryOid: number;
  tExit: number; exit: number; how: "maker" | "taker"; exitPrintId: string | null; exitOid: number | null;
  notionalUsd: number; pnlUsd: number;
};
export type QuoteEvent = { book: QuoteBook; minute: number; side: Side | "-"; k: number; kind: string; ticks: number | null; detail: Record<string, unknown> };
export type MinuteInputs = { x: number | null; fairU: number | null; prints: Print[] };

export function newBookState(book: QuoteBook, lastPrint: Print | null = null): BookState {
  const rungs: Rung[] = [];
  for (const side of ["bid", "ask"] as Side[]) for (const k of QUOTE_RUNGS) rungs.push({ side, k, mode: "idle", o: null });
  return { book, rungs, lastX: null, lastPrint, nextOid: 1 };
}

/** An entry quote k from fair, on the tick grid: a bid rounds down, an ask up (`rt`). */
export function quoteTicks(fair: number, k: number, side: Side): number {
  return side === "bid" ? Math.floor(fair * (1 - k) / QUOTE_TICK + 1e-9) : Math.ceil(fair * (1 + k) / QUOTE_TICK - 1e-9);
}

/** The exit at fair: a long (from a bid) sells at fair rounded up, a short buys it back rounded down (`rt_exit`). */
export function exitTicks(fair: number, positionSide: Side): number {
  return positionSide === "bid" ? Math.ceil(fair / QUOTE_TICK - 1e-9) : Math.floor(fair / QUOTE_TICK + 1e-9);
}

/**
 * Was the market already through a post-only order when it went live? `lp` is the last print before that instant: a
 * bid is through when the market printed below it, or at it with a BUYER lifting (the ask sat at the bid's price).
 */
export function blocks(side: Side, ticks: number, lp: Print | null): boolean {
  if (!lp) return false;
  return side === "bid" ? lp.ticks < ticks || (lp.ticks === ticks && lp.side === "buy") : lp.ticks > ticks || (lp.ticks === ticks && lp.side === "sell");
}

/** A resting order fills only on a print strictly beyond its price: a print AT it fills the queue ahead first. */
export function through(side: Side, ticks: number, printTicks: number): boolean {
  return side === "bid" ? printTicks < ticks : printTicks > ticks;
}

/** GBP/USD for the turn at `t`: the latest minute close whose bar started in [t−10 min, t−1 min]; null means dark. */
export function fxAt(t: number, bars: Array<[number, number]>): number | null {
  let lo = 0, hi = bars.length;                       // the last bar starting at or before t − 1 min
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] <= t - M) lo = mid + 1; else hi = mid; }
  const k = lo - 1;
  return k >= 0 && bars[k][0] >= t - QUOTE_FX_LOOKBACK_MS ? bars[k][1] : null;
}

/** `statistics.median`: the middle value, or the mean of the two middle values. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q), n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** The USD book's fair for the turn at `t`: the median close of the hourly candles lying wholly inside [t−24 h, t). */
export function fairUAt(t: number, hours: Array<[number, number]>): number | null {
  return median(hours.filter(([s]) => s >= t - DAY && s <= t - H).map(([, c]) => c));
}

function close(s: BookState, r: Rung, t: number, px: number, how: "maker" | "taker", exitPrintId: string | null, trips: Trip[]) {
  const pnlQ = r.side === "bid" ? r.qty! * (px - r.entry!) : r.qty! * (r.entry! - px);
  const xr = s.lastX || 1.0;
  trips.push({
    book: s.book, side: r.side, k: r.k, tEntry: r.tEntry!, fillTs: r.fillTs!, fillId: r.fillId!, entry: r.entry!, qty: r.qty!, nq: r.nq!,
    xEntry: r.xEntry!, fairEntry: r.fairEntry ?? null, entryOid: r.entryOid!,
    tExit: t, exit: px, how, exitPrintId, exitOid: how === "maker" ? r.o?.oid ?? null : null,
    notionalUsd: r.nq! * xr, pnlUsd: pnlQ * xr,
  });
  r.mode = "idle"; r.o = null;
  for (const key of ["entry", "tEntry", "qty", "nq", "fillTs", "fillId", "entryOid", "xEntry", "fairEntry"] as const) delete r[key];
}

/**
 * One minute of the rule for one book, mutating `s`. Returns what happened: completed trips, the order log, and how many
 * orders it placed (every placement, re-price and re-placement counts one, as in the simulator).
 */
export function stepMinute(s: BookState, t: number, inp: MinuteInputs): { trips: Trip[]; events: QuoteEvent[]; orders: number } {
  const trips: Trip[] = [], events: QuoteEvent[] = [];
  let orders = 0;
  const ev = (r: Rung | null, kind: string, ticks: number | null, detail: Record<string, unknown> = {}) =>
    events.push({ book: s.book, minute: t, side: r ? r.side : "-", k: r ? r.k : 0, kind, ticks, detail });
  const newOrder = (side: Side, ticks: number, fairAt: number): QOrder => ({ side, ticks, fairAt, live: t + M, state: "pending", oid: s.nextOid++ });
  const x = inp.x;
  if (x) s.lastX = x;
  const f = x && inp.fairU ? inp.fairU / x : null;
  const lpBefore = s.lastPrint;                        // the last print strictly before t
  // 1. the turn at the start of minute t
  for (const r of s.rungs) {
    if (r.mode === "idle" || r.mode === "quote") {
      const o = r.o;
      if (f === null) {
        if (r.mode === "quote") { ev(r, "withdraw", o?.ticks ?? null); r.mode = "idle"; r.o = null; }
        continue;
      }
      if (r.mode === "idle" || !o) {
        r.o = newOrder(r.side, quoteTicks(f, r.k, r.side), f); r.mode = "quote"; orders++;
        ev(r, "order", r.o.ticks, { what: "place", leg: "entry", oid: r.o.oid, fair: f, x });
        continue;
      }
      if (o.state === "rejected") {
        if (Math.abs(f / o.fairAt - 1) > QUOTE_REPRICE) { o.ticks = quoteTicks(f, r.k, r.side); o.fairAt = f; }
        if (!blocks(o.side, o.ticks, lpBefore)) { o.live = t + M; o.state = "pending"; orders++; ev(r, "order", o.ticks, { what: "replace", leg: "entry", oid: o.oid, fair: f, x }); }
        continue;
      }
      if (Math.abs(f / o.fairAt - 1) > QUOTE_REPRICE) {
        o.ticks = quoteTicks(f, r.k, r.side); o.fairAt = f; o.live = t + M; o.state = "pending"; orders++;
        ev(r, "order", o.ticks, { what: "reprice", leg: "entry", oid: o.oid, fair: f, x });
      }
    } else {
      const o = r.o;                                   // the exit order, null until a fair exists
      const xs: Side = r.side === "bid" ? "ask" : "bid";
      if (!o) {
        if (f !== null) { r.o = newOrder(xs, exitTicks(f, r.side), f); orders++; ev(r, "order", r.o.ticks, { what: "place", leg: "exit", oid: r.o.oid, fair: f, x }); }
      } else if (o.state === "rejected") {
        if (f !== null && Math.abs(f / o.fairAt - 1) > QUOTE_REPRICE) { o.ticks = exitTicks(f, r.side); o.fairAt = f; }
        if (!blocks(o.side, o.ticks, lpBefore)) { o.live = t + M; o.state = "pending"; orders++; ev(r, "order", o.ticks, { what: "replace", leg: "exit", oid: o.oid, fair: f, x }); }
      } else if (f !== null && Math.abs(f / o.fairAt - 1) > QUOTE_REPRICE) {
        o.ticks = exitTicks(f, r.side); o.fairAt = f; o.live = t + M; o.state = "pending"; orders++;
        ev(r, "order", o.ticks, { what: "reprice", leg: "exit", oid: o.oid, fair: f, x });
      }
    }
  }
  // 2. go-live at the start of minute t: a post-only order the market is already through is refused
  for (const r of s.rungs) {
    const o = r.o;
    if (o && o.state === "pending" && o.live === t) {
      o.state = blocks(o.side, o.ticks, lpBefore) ? "rejected" : "live";
      if (o.state === "rejected") ev(r, "refused", o.ticks, { oid: o.oid, lastPrint: lpBefore && { id: lpBefore.id, ticks: lpBefore.ticks, side: lpBefore.side, ts: lpBefore.ts } });
    }
  }
  // 3. the prints of minute t, in time order
  if (inp.prints.length) {
    const qvol = inp.prints.reduce((a, p) => a + p.qty * p.ticks * QUOTE_TICK, 0);       // GBP printed this minute
    for (const p of inp.prints) {
      for (const r of s.rungs) {
        const o = r.o;
        if (!o || o.state !== "live" || !through(o.side, o.ticks, p.ticks)) continue;
        if (r.mode === "quote") {
          if (!s.lastX) continue;
          const usd = Math.min(QUOTE_SIZE_USD, QUOTE_VOLUME_SHARE * qvol * s.lastX);
          if (usd <= 0) continue;
          const nq = usd / s.lastX, px = o.ticks * QUOTE_TICK;
          Object.assign(r, { mode: "position", o: null, entry: px, tEntry: t, qty: nq / px, nq, fillTs: p.ts, fillId: p.id, entryOid: o.oid, xEntry: s.lastX, fairEntry: f });
          ev(r, "fill", o.ticks, { oid: o.oid, print: { id: p.id, ts: p.ts, ticks: p.ticks, side: p.side, qty: p.qty }, usd, minuteGbp: qvol, x: s.lastX, fair: f });
        } else if (r.mode === "position") {
          ev(r, "exit", o.ticks, { oid: o.oid, print: { id: p.id, ts: p.ts, ticks: p.ticks, side: p.side, qty: p.qty } });
          close(s, r, t, o.ticks * QUOTE_TICK, "maker", p.id, trips);
        }
      }
    }
    s.lastPrint = inp.prints[inp.prints.length - 1];
  }
  // 4. the 24-hour stop, at the last print at or before the end of minute t; a position entered this minute is not checked
  for (const r of s.rungs) {
    if (r.mode === "position" && r.tEntry !== t && t >= r.tEntry! + QUOTE_STOP_MS && s.lastPrint) {
      const c = s.lastPrint.ticks * QUOTE_TICK, taker = QUOTE_FEE + QUOTE_HALF_SPREAD;
      const px = r.side === "bid" ? c * (1 - taker) : c * (1 + taker);
      ev(r, "stop", s.lastPrint.ticks, { lastPrint: { id: s.lastPrint.id, ts: s.lastPrint.ts }, px });
      close(s, r, t, px, "taker", null, trips);
    }
  }
  return { trips, events, orders };
}

// ------------------------------------------------------------------ the driver

export type QuoteState = {
  lastMinute: number;                          // the last minute fully decided
  books: Record<QuoteBook, BookState>;
  fetchedTo: Record<QuoteBook, number>;        // prints stored up to this instant (ms)
  hourFetchedFor: number;                      // the last completed hour whose USD-book closes are stored
};
export type QuoteReport = {
  skipped?: string; minutes: number; from: number | null; to: number | null; prints: number; fills: number; exits: number;
  stops: number; orders: number; refused: number; snapshots: number; errors: string[];
};
export type QuoteDeps = { db: Db; fetch?: typeof fetch; now: number; holder: string; pause?: (ms: number) => Promise<void> };

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => typeof v === "number" ? v : Date.parse(String(v));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;

type TradeRow = { id: string; symbol: string; price: string; quantity: string; timestamp: number; region: string; side: string };

/** Every UK print of `book` in [from, to], one day's window a request, following the cursor. */
export async function fetchPrints(book: QuoteBook, from: number, to: number, call: (path: string) => Promise<RevxResponse<{ data: TradeRow[]; metadata?: { next_cursor?: string } }>>): Promise<Print[]> {
  const out = new Map<string, Print>();
  for (let a = from; a <= to; a += DAY) {
    const b = Math.min(to, a + DAY - 1);
    let cursor = "";
    for (let page = 0; page < 50; page++) {
      const r = await call(`/api/1.0/public/trades/all?symbol=${book}&start_date=${a}&end_date=${b}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!r.ok) throw new Error(`trades ${book} → ${r.status} ${r.error}`);
      for (const row of r.data.data ?? []) {
        if (row.region !== "UK") continue;
        const ticks = Math.round(Number(row.price) / QUOTE_TICK);
        out.set(row.id, { id: row.id, ts: Number(row.timestamp), ticks, qty: Number(row.quantity), side: row.side === "buy" ? "buy" : "sell" });
      }
      cursor = r.data.metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  }
  return [...out.values()].sort((p, q) => p.ts - q.ts || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/** Yahoo's GBPUSD=X one-minute closes, complete bars only (a bar that has not ended by `now` is left out). */
export async function fetchFx(now: number, f: typeof fetch): Promise<Array<[number, number]>> {
  const res = await f("https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json,text/plain,*/*" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`yahoo GBPUSD=X → ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [], cl: Array<number | null> = r?.indicators?.quote?.[0]?.close ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ts.length; i++) {
    const start = minuteOf(ts[i] * 1000), c = cl[i];
    if (typeof c === "number" && c > 0 && start + M <= now) out.push([start, c]);
  }
  return out;
}

/** The USD book's UK hourly closes for the last 26 hours, completed hours only. */
export async function fetchHours(usdBook: string, now: number, call: (path: string) => Promise<RevxResponse<{ data: Array<{ start: number; close: string }> }>>): Promise<Array<[number, number]>> {
  const r = await call(`/api/1.0/public/candles/${usdBook}?interval=60&since=${now - 26 * H}&until=${now}&region=UK`);
  if (!r.ok) throw new Error(`candles ${usdBook} → ${r.status} ${r.error}`);
  return (r.data.data ?? []).map((c) => [Number(c.start), Number(c.close)] as [number, number]).filter(([s, c]) => s + H <= now && c > 0);
}

/**
 * One run of the paper test: take the lease, store the new inputs, decide every complete minute not yet decided
 * (one minute behind the clock, at most `QUOTE_MAX_MINUTES`), store what happened, and — when caught up — take the
 * order book of each book where an order goes live this minute, the evidence of whether a post-only order would
 * have been accepted. Nothing here can place an order: the only Revolut X calls are public reads.
 */
export async function runQuotes(d: QuoteDeps): Promise<QuoteReport> {
  const report: QuoteReport = { minutes: 0, from: null, to: null, prints: 0, fills: 0, exits: 0, stops: 0, orders: 0, refused: 0, snapshots: 0, errors: [] };
  const f = d.fetch ?? fetch;
  const pause = d.pause ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));
  const held = await d.db.claim("agent_locks", `name=eq.quotes&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + QUOTE_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the quotes lease" };
  let lastCall = 0;
  const call = async <T,>(path: string) => {
    const wait = lastCall + QUOTE_REVX_GAP_MS - Date.now();
    if (lastCall && wait > 0) await pause(wait);
    lastCall = Date.now();
    return await revxPublic<T>(path, f);
  };
  try {
    const nowMinute = minuteOf(d.now);
    const rows = await d.db.select<{ state: QuoteState | Record<string, never> }>("agent_quote_state", "id=eq.1&select=state");
    let st = rows[0]?.state as QuoteState | undefined;
    if (!st || !("books" in st)) {
      // First run: start clean two minutes back, each book seeded with its last print of the past day.
      const books = {} as Record<QuoteBook, BookState>, fetchedTo = {} as Record<QuoteBook, number>;
      for (const b of QUOTE_BOOKS) {
        const ps = await fetchPrints(b, d.now - DAY, nowMinute - M, call);
        books[b] = newBookState(b, ps.filter((p) => p.ts < nowMinute - M).at(-1) ?? null);
        fetchedTo[b] = nowMinute - M;
        if (ps.length) await d.db.upsert("agent_quote_prints", ps.map((p) => printRow(b, p)), "id");
      }
      st = { lastMinute: nowMinute - 2 * M, books, fetchedTo, hourFetchedFor: 0 };
    }
    const first = st.lastMinute + M, last = Math.min(nowMinute - M, st.lastMinute + QUOTE_MAX_MINUTES * M);
    if (last < first) return { ...report, skipped: "nothing new to decide" };
    // Inputs. Prints first: they are what a fill is proven by.
    for (const b of QUOTE_BOOKS) {
      try {
        const ps = await fetchPrints(b, st.fetchedTo[b] - M, d.now, call);
        if (ps.length) await d.db.upsert("agent_quote_prints", ps.map((p) => printRow(b, p)), "id");
        report.prints += ps.filter((p) => p.ts > st!.fetchedTo[b]).length;
        st.fetchedTo[b] = d.now;
      } catch (e) { report.errors.push(`prints ${b}: ${msg(e)}`); }
    }
    try {
      const fx = await fetchFx(d.now, f);
      if (fx.length) await d.db.upsert("agent_quote_inputs", fx.map(([t, v]) => ({ kind: "fx", t: iso(t), value: v })), "kind,t");
    } catch (e) { report.errors.push(`fx: ${msg(e)}`); }
    const completedHour = Math.floor(d.now / H) * H - H;
    if (st.hourFetchedFor < completedHour) {
      let ok = true;
      for (const b of QUOTE_BOOKS) {
        try {
          const hs = await fetchHours(QUOTE_USD_BOOK[b], d.now, call);
          if (hs.length) await d.db.upsert("agent_quote_inputs", hs.map(([t, v]) => ({ kind: `fair:${QUOTE_USD_BOOK[b]}`, t: iso(t), value: v })), "kind,t");
        } catch (e) { ok = false; report.errors.push(`hours ${QUOTE_USD_BOOK[b]}: ${msg(e)}`); }
      }
      if (ok) st.hourFetchedFor = completedHour;
    }
    // A book whose prints could not be read this run is not decided past what is stored: stop at its horizon.
    const horizon = Math.min(last, ...QUOTE_BOOKS.map((b) => minuteOf(st!.fetchedTo[b]) - M));
    if (horizon < first) { report.errors.push("prints not read far enough to decide a minute"); await saveState(d, st); return report; }
    const fxRows = await d.db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.fx&t=gte.${encodeURIComponent(iso(first - QUOTE_FX_LOOKBACK_MS))}&t=lte.${encodeURIComponent(iso(horizon))}&select=t,value&order=kind.asc,t.asc`);
    const fxBars = fxRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    const trips: Trip[] = [], events: QuoteEvent[] = [];
    for (const b of QUOTE_BOOKS) {
      const usd = QUOTE_USD_BOOK[b];
      const hRows = await d.db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.${encodeURIComponent(`fair:${usd}`)}&t=gte.${encodeURIComponent(iso(first - DAY))}&t=lte.${encodeURIComponent(iso(horizon))}&select=t,value&order=kind.asc,t.asc`);
      const hours = hRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
      const pRows = await d.db.selectAll<{ id: string; ts: string; price: number; qty: number; side: Aggressor }>("agent_quote_prints", `book=eq.${b}&ts=gte.${encodeURIComponent(iso(first))}&ts=lt.${encodeURIComponent(iso(horizon + M))}&select=id,ts,price,qty,side&order=ts.asc,id.asc`);
      const prints = pRows.map((r) => ({ id: r.id, ts: msOf(r.ts), ticks: Math.round(Number(r.price) / QUOTE_TICK), qty: Number(r.qty), side: r.side }));
      let j = 0;
      for (let t = first; t <= horizon; t += M) {
        const mine: Print[] = [];
        while (j < prints.length && prints[j].ts < t + M) { if (prints[j].ts >= t) mine.push(prints[j]); j++; }
        const out = stepMinute(st.books[b], t, { x: fxAt(t, fxBars), fairU: fairUAt(t, hours), prints: mine });
        trips.push(...out.trips); events.push(...out.events); report.orders += out.orders;
      }
    }
    report.minutes = (horizon - first) / M + 1; report.from = first; report.to = horizon;
    report.fills = events.filter((e) => e.kind === "fill").length;
    report.exits = events.filter((e) => e.kind === "exit").length;
    report.stops = events.filter((e) => e.kind === "stop").length;
    report.refused = events.filter((e) => e.kind === "refused").length;
    // Idempotent by their natural keys: a run that dies after this point re-decides the same minutes the same way.
    if (events.length) await d.db.upsert("agent_quote_events", events.map(eventRow), "book,minute,side,k,kind");
    if (trips.length) await d.db.upsert("agent_quote_trips", trips.map(tripRow), "book,side,k,t_entry");
    st.lastMinute = horizon;
    // Caught up: the orders placed in the minute just decided go live now. The book they meet is the evidence.
    if (horizon === nowMinute - M) {
      for (const b of QUOTE_BOOKS) {
        const going = st.books[b].rungs.filter((r) => r.o && r.o.state === "pending" && r.o.live === nowMinute).map((r) => ({ side: r.o!.side, k: r.k, ticks: r.o!.ticks, oid: r.o!.oid, leg: r.mode === "position" ? "exit" : "entry" }));
        if (!going.length) continue;
        try {
          const ob = await call<{ data?: { bids?: Array<Record<string, unknown>>; asks?: Array<Record<string, unknown>> } }>(`/api/2.0/public/order-book/${b}?region=UK&limit=5`);
          if (!ob.ok) throw new Error(`${ob.status} ${ob.error}`);
          await d.db.upsert("agent_quote_events", [eventRow({ book: b, minute: nowMinute, side: "-", k: 0, kind: "book", ticks: null, detail: { at: Date.now(), orders: going, book: ob.data?.data ?? ob.data } })], "book,minute,side,k,kind");
          report.snapshots++;
        } catch (e) { report.errors.push(`order book ${b}: ${msg(e)}`); }
      }
    }
    await saveState(d, st, report.errors.length ? report.errors.join(" | ").slice(0, 500) : null);
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.quotes&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}

async function saveState(d: QuoteDeps, st: QuoteState, lastError: string | null = null) {
  await d.db.upsert("agent_quote_state", [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: lastError }], "id");
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function printRow(book: QuoteBook, p: Print) {
  return { id: p.id, book, ts: iso(p.ts), price: Number((p.ticks * QUOTE_TICK).toFixed(4)), qty: p.qty, side: p.side };
}

function eventRow(e: QuoteEvent) {
  return { book: e.book, minute: iso(e.minute), side: e.side, k: e.k, kind: e.kind, ticks: e.ticks, detail: e.detail };
}

function tripRow(t: Trip) {
  return {
    book: t.book, side: t.side, k: t.k, t_entry: iso(t.tEntry), fill_ts: iso(t.fillTs), fill_print_id: t.fillId, entry: t.entry, qty: t.qty,
    x_entry: t.xEntry, fair_entry: t.fairEntry, entry_oid: t.entryOid, t_exit: iso(t.tExit), exit: t.exit, how: t.how,
    exit_print_id: t.exitPrintId, exit_oid: t.exitOid, notional_usd: t.notionalUsd, pnl_usd: t.pnlUsd,
  };
}
