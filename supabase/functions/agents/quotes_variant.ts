// "Stablecoin quotes - variant" (PR5V) on paper: PR5's stored minutes replayed through the variant's rule, into tables of
// its own (`0071`). The rule and its reference are the PR5V pre-registration's §2: `pr5v_sim.simulate` in
// docs/agents/scripts/pr5v/pr5v_sim.py, at PR5's own minute (its `REF` timing), in two arms.
//
//   main  nine rungs a side (0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30 %) on both books, $100 each;
//         re-priced when fair moves more than 0.03 %; the orders resting on one side of one book share one cap a minute
//         (10 % of the minute's printed volume) and each print's own quantity, nearest the market first; four keys (a
//         book and a side each), governed per UTC day: from 600 POSTs a key's quotes are withdrawn and none is placed,
//         from 700 it sends only stops. It is the arm the pre-registration judges.
//   top5  the same with k = 0.05, 0.075, 0.10, 0.125, 0.15 %. Reported beside it, never judged.
//
// Everything else is PR5's frozen rule, reused from quotes.ts by import: the turn at the start of minute t on data to
// t−1, an order live from t+1, a re-priced order withdrawn at the turn, the post-only refusal against the last print
// before an order goes live and its re-placement once the last print is no longer through it, exits at fair that fill
// whole on any print strictly through them, the 24-hour taker stop at the last print of its minute, dark when X is.
//
// It changes nothing of PR5 and calls no venue. Of PR5's state it reads one column, `agent_quote_state.last_minute`,
// and decides a minute only once PR5 has; it then reads the X and fairU PR5's `stepMinute` was given
// (`agent_quote_minutes`, `0055`) and the minute's prints (`agent_quote_prints`), never PR5's books, trips or events. A
// book-minute with no row is rebuilt from `agent_quote_inputs` with PR5's own `fxBarAt`, `fairHours` and `median`, and
// its record says so. `quotes_variant.test.ts` replays golden windows cut from the reference
// (docs/agents/backtests/pr5v/golden_variant.json) trip for trip and POST for POST, in both arms.
//
// The reference visits only the steps where something can happen; this engine turns every minute. The two agree
// because every instant at which X or fairU can change, and every hour start, is one of the reference's steps: the
// golden replay is the proof, including days on which the governor binds and the counts start again at 00:00 UTC.

import type { Db } from "./db.ts";
import {
  blocks, exitTicks, fairHours, fxBarAt, median, QUOTE_BOOKS, QUOTE_FEE, QUOTE_FX_LOOKBACK_MS, QUOTE_HALF_SPREAD, QUOTE_LEASE_MS,
  QUOTE_MAX_MINUTES, QUOTE_SIZE_USD, QUOTE_STOP_MS, QUOTE_TICK, QUOTE_USD_BOOK, QUOTE_VOLUME_SHARE, quoteTicks, through,
  type Aggressor, type BookState, type MinuteInputs, type Print, type QOrder, type QuoteBook, type Rung, type Side, type Trip,
} from "./quotes.ts";

const M = 60e3, DAY = 86400e3;

export type VariantArmName = "main" | "top5";
export type VariantArm = {
  name: VariantArmName;
  /** Each rung's distance from fair, the same on both sides, in the order a turn visits them (bids first, then asks). */
  rungs: number[];
  /** A quote or an exit moves when fair has moved more than this since it was priced. */
  reprice: number;
  sizeUsd: number;
  /** The share of a minute's printed volume the orders on one side of a book may take between them. */
  volumeShare: number;
  /** A key's POSTs in a UTC day from which its quotes are withdrawn and none is placed. */
  entryAt: number;
  /** A key's POSTs in a UTC day from which it sends only stops. */
  stopAt: number;
};

const GOVERNED = { reprice: 0.0003, sizeUsd: QUOTE_SIZE_USD, volumeShare: QUOTE_VOLUME_SHARE, entryAt: 600, stopAt: 700 };
/** The pre-registration's two arms (its §2), both run every minute. */
export const VARIANT_ARMS: Record<VariantArmName, VariantArm> = {
  main: { name: "main", rungs: [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003], ...GOVERNED },
  top5: { name: "top5", rungs: [0.0005, 0.00075, 0.001, 0.00125, 0.0015], ...GOVERNED },
};
export const VARIANT_ARM_NAMES: VariantArmName[] = ["main", "top5"];
/** What an arm's quotes lock: both books, both sides, every rung at its size. */
export const variantCapitalUsd = (arm: VariantArm) => QUOTE_BOOKS.length * 2 * arm.rungs.length * arm.sizeUsd;

/** Both arms start flat here (the pre-registration's §3), each book seeded with its last stored print before it. */
export const VARIANT_START = Date.parse("2026-09-28T00:00:00Z");
/**
 * Bump by hand with any change here that could change a decision. A run that finds its record written under another
 * version wipes the variant's own rows (never PR5's) and decides everything again from `VARIANT_START`, flat: the
 * record is always one version of the code, run from the start.
 */
export const VARIANT_CODE_VERSION = 1;
export const VARIANT_LEASE_MS = QUOTE_LEASE_MS;
/** Minutes decided in one call at most; a catch-up after a pause, or after a new version, is several calls. */
export const VARIANT_MAX_MINUTES = QUOTE_MAX_MINUTES;
/** A call decides in chunks, each read, decided, written and saved before the next begins … */
export const VARIANT_CHUNK_MINUTES = 30;
/** … and starts no new chunk this long after it began, so it answers in about 20 s at most and never holds the minute's batch. */
export const VARIANT_WALL_STOP_MS = 10e3;

/** The key a rung's POSTs count against: its book and its own side (a bid rung's exit is sent on the bid key). */
export const variantKey = (book: QuoteBook, side: Side) => `${book}/${side}`;
/** The four keys, one per book and side. */
export const VARIANT_KEYS = QUOTE_BOOKS.flatMap((b) => (["bid", "ask"] as Side[]).map((side) => variantKey(b, side)));
/** Each key's POSTs in the UTC day `day` (days since the epoch). */
export type GovCounts = { day: number; counts: Record<string, number> };
export const newGovCounts = (): GovCounts => ({ day: -1, counts: {} });

/**
 * The order of a minute's prints: by time, then by the venue's id compared as a string, code point by code point. A
 * third of the prints share their millisecond with another, and under the shared cap the first print through a quote
 * can take what the next one would have, so the order is part of the rule. The golden generator orders them the same way.
 */
export function printOrder(a: Print, b: Print): number {
  return a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export type VariantTrip = Trip & { arm: VariantArmName; key: string };
export type VariantEventKind = "order" | "refused" | "withdraw" | "fill" | "exit" | "stop";
/** What a POST was, in the reference's words: an entry placed, re-priced or re-placed; an exit the same; a stop. */
export type PostKind = "place" | "reprice" | "replace" | "exit" | "exit_reprice" | "exit_replace" | "stop";
/**
 * One line of an arm's order log: PR5's event, with the arm, the key a POST counted against and, on a POST (an `order`
 * or a `stop`), what it was.
 */
export type VariantEvent = {
  arm: VariantArmName; book: QuoteBook; minute: number; side: Side | "-"; k: number; kind: VariantEventKind; what: PostKind | null;
  key: string | null; ticks: number | null; detail: Record<string, unknown>;
};

export function newVariantBook(book: QuoteBook, arm: VariantArm, lastPrint: Print | null = null): BookState {
  const rungs: Rung[] = [];
  for (const side of ["bid", "ask"] as Side[]) for (const k of arm.rungs) rungs.push({ side, k, mode: "idle", o: null });
  return { book, rungs, lastX: null, lastPrint, nextOid: 1 };
}

function close(s: BookState, arm: VariantArm, r: Rung, t: number, px: number, how: "maker" | "taker", exitPrintId: string | null, trips: VariantTrip[]) {
  const pnlQ = r.side === "bid" ? r.qty! * (px - r.entry!) : r.qty! * (r.entry! - px);
  const xr = s.lastX || 1.0;
  trips.push({
    arm: arm.name, key: variantKey(s.book, r.side),
    book: s.book, side: r.side, k: r.k, tEntry: r.tEntry!, fillTs: r.fillTs!, fillId: r.fillId!, entry: r.entry!, qty: r.qty!, nq: r.nq!,
    xEntry: r.xEntry!, fairEntry: r.fairEntry ?? null, entryOid: r.entryOid!,
    tExit: t, exit: px, how, exitPrintId, exitOid: how === "maker" ? r.o?.oid ?? null : null,
    notionalUsd: r.nq! * xr, pnlUsd: pnlQ * xr,
  });
  r.mode = "idle"; r.o = null;
  for (const key of ["entry", "tEntry", "qty", "nq", "fillTs", "fillId", "entryOid", "xEntry", "fairEntry"] as const) delete r[key];
}

/**
 * One minute of one arm on one book, mutating `s` and the arm's key counts `gov` (one object for both books: the keys
 * differ). The reference's minute at its REF timing: the turn at the start of t, reading each key's count rung by rung
 * as it goes (bids before asks, each side in k order); the go-live check; the minute's prints in the order given (the
 * driver gives them in `printOrder`), the orders each goes through sharing, per side of the book, the minute's cap and
 * the print's own quantity, nearest the market first (a bid's highest price first, an ask's lowest; ties by k), while an
 * exit fills whole on any print through it; then the 24-hour stop, which is sent whatever the key's count. Returns the
 * completed trips, the order log, and the POSTs this minute sent on each key.
 */
export function stepVariantMinute(s: BookState, t: number, inp: MinuteInputs, arm: VariantArm, gov: GovCounts): { trips: VariantTrip[]; events: VariantEvent[]; posts: Record<string, number> } {
  const trips: VariantTrip[] = [], events: VariantEvent[] = [], posts: Record<string, number> = {};
  const day = Math.floor(t / DAY);
  if (gov.day !== day) { gov.day = day; gov.counts = {}; }
  const keyOf = (r: Rung) => variantKey(s.book, r.side);
  const ev = (r: Rung, kind: VariantEventKind, ticks: number | null, detail: Record<string, unknown> = {}, what: PostKind | null = null) =>
    events.push({ arm: arm.name, book: s.book, minute: t, side: r.side, k: r.k, kind, what, key: keyOf(r), ticks, detail });
  const post = (r: Rung): number => {
    const key = keyOf(r);
    gov.counts[key] = (gov.counts[key] ?? 0) + 1;
    posts[key] = (posts[key] ?? 0) + 1;
    return gov.counts[key];
  };
  const order = (r: Rung, o: QOrder, what: PostKind, fair: number | null, x: number | null) =>
    ev(r, "order", o.ticks, { leg: r.mode === "position" ? "exit" : "entry", oid: o.oid, fair, x, n: post(r) }, what);
  const newOrder = (side: Side, ticks: number, fairAt: number): QOrder => ({ side, ticks, fairAt, live: t + M, state: "pending", oid: s.nextOid++ });
  const x = inp.x;
  if (x) s.lastX = x;
  const f = x && inp.fairU ? inp.fairU / x : null;
  const lpBefore = s.lastPrint;                        // the last print strictly before t
  // 1. the turn at the start of minute t
  for (const r of s.rungs) {
    const n = gov.counts[keyOf(r)] ?? 0;                // read rung by rung: a POST earlier in this turn counts
    if (r.mode === "idle" || r.mode === "quote") {
      const o = r.o;
      if (f === null) {
        if (r.mode === "quote") { ev(r, "withdraw", o?.ticks ?? null, { why: "dark", oid: o?.oid ?? null }); r.mode = "idle"; r.o = null; }
        continue;
      }
      if (n >= arm.entryAt) {
        if (r.mode === "quote") { ev(r, "withdraw", o?.ticks ?? null, { why: "governor", oid: o?.oid ?? null, n }); r.mode = "idle"; r.o = null; }
        continue;
      }
      if (r.mode === "idle" || !o) {
        r.o = newOrder(r.side, quoteTicks(f, r.k, r.side), f); r.mode = "quote";
        order(r, r.o, "place", f, x);
        continue;
      }
      if (o.state === "rejected") {
        if (Math.abs(f / o.fairAt - 1) > arm.reprice) { o.ticks = quoteTicks(f, r.k, r.side); o.fairAt = f; }
        if (!blocks(o.side, o.ticks, lpBefore)) { o.live = t + M; o.state = "pending"; order(r, o, "replace", f, x); }
        continue;
      }
      if (Math.abs(f / o.fairAt - 1) > arm.reprice) {
        o.ticks = quoteTicks(f, r.k, r.side); o.fairAt = f; o.live = t + M; o.state = "pending";
        order(r, o, "reprice", f, x);
      }
    } else {
      if (n >= arm.stopAt) continue;                   // only stops from here: the exit already out stays out
      const o = r.o;                                   // the exit order, null until a fair exists
      const xs: Side = r.side === "bid" ? "ask" : "bid";
      if (!o) {
        if (f !== null) { r.o = newOrder(xs, exitTicks(f, r.side), f); order(r, r.o, "exit", f, x); }
      } else if (o.state === "rejected") {
        if (f !== null && Math.abs(f / o.fairAt - 1) > arm.reprice) { o.ticks = exitTicks(f, r.side); o.fairAt = f; }
        if (!blocks(o.side, o.ticks, lpBefore)) { o.live = t + M; o.state = "pending"; order(r, o, "exit_replace", f, x); }
      } else if (f !== null && Math.abs(f / o.fairAt - 1) > arm.reprice) {
        o.ticks = exitTicks(f, r.side); o.fairAt = f; o.live = t + M; o.state = "pending";
        order(r, o, "exit_reprice", f, x);
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
  // 3. the prints of minute t, in the order given
  if (inp.prints.length) {
    const qvol = inp.prints.reduce((a, p) => a + p.qty * p.ticks * QUOTE_TICK, 0);       // GBP printed this minute
    const budget = new Map<Side, number>();                                                // what each side's cap has left
    for (const p of inp.prints) {
      let cands = s.rungs.filter((r) => r.o && r.o.state === "live" && r.o.live <= p.ts && through(r.o.side, r.o.ticks, p.ticks));
      if (!s.lastX) cands = cands.filter((r) => r.mode === "position");                    // no rate: nothing can enter
      if (!cands.length) continue;
      const bySide = new Map<Side, Rung[]>();                                              // by the side the ORDER rests on
      for (const r of cands) {
        const list = bySide.get(r.o!.side);
        if (list) list.push(r); else bySide.set(r.o!.side, [r]);
      }
      const printUsd = p.qty * p.ticks * QUOTE_TICK * (s.lastX || 0);
      for (const [sd, list] of bySide) {
        // Nearest the market first: the highest bid, the lowest ask; ties by k. A stable sort keeps the turn's order.
        list.sort((a, b) => (sd === "bid" ? b.o!.ticks - a.o!.ticks : a.o!.ticks - b.o!.ticks) || a.k - b.k);
        if (!budget.has(sd)) budget.set(sd, arm.volumeShare * qvol * (s.lastX || 0));
        let printLeft = printUsd;
        for (const r of list) {
          const o = r.o!;
          if (r.mode === "position") {                                                     // an exit is not in the queue
            ev(r, "exit", o.ticks, { oid: o.oid, print: { id: p.id, ts: p.ts, ticks: p.ticks, side: p.side, qty: p.qty } });
            close(s, arm, r, t, o.ticks * QUOTE_TICK, "maker", p.id, trips);
            continue;
          }
          const room = Math.min(budget.get(sd)!, printLeft);
          if (room <= 1e-12) continue;
          const usd = Math.min(arm.sizeUsd, room);
          const nq = usd / s.lastX!, px = o.ticks * QUOTE_TICK;
          Object.assign(r, { mode: "position", o: null, entry: px, tEntry: t, qty: nq / px, nq, fillTs: p.ts, fillId: p.id, entryOid: o.oid, xEntry: s.lastX, fairEntry: f });
          ev(r, "fill", o.ticks, { oid: o.oid, print: { id: p.id, ts: p.ts, ticks: p.ticks, side: p.side, qty: p.qty }, usd, room, minuteGbp: qvol, x: s.lastX, fair: f });
          budget.set(sd, budget.get(sd)! - usd);
          printLeft -= usd;
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
      ev(r, "stop", s.lastPrint.ticks, { lastPrint: { id: s.lastPrint.id, ts: s.lastPrint.ts }, px, n: post(r) }, "stop");
      close(s, arm, r, t, px, "taker", null, trips);
    }
  }
  return { trips, events, posts };
}

// ------------------------------------------------------------------ the driver

export type VariantArmState = { books: Record<QuoteBook, BookState>; gov: GovCounts };
export type VariantState = { codeVersion: number; lastMinute: number; arms: Record<VariantArmName, VariantArmState> };
/**
 * What one book-minute was decided on, for both arms (they share it): PR5's record of it (`minutes`), or, with no row,
 * the minute rebuilt from the stored series (`rebuilt`). `pr5_prints_n` is the count PR5 decided on, where it says.
 */
export type VariantMinuteRecord = {
  book: QuoteBook; minute: string; source: "minutes" | "rebuilt"; x: number | null; x_t: string | null; fair_u: number | null;
  hours_n: number; prints_n: number; pr5_prints_n: number | null;
};
type ArmCounts = { orders: number; posts: number; refused: number; withdrawn: number; fills: number; exits: number; stops: number; trips: number };
export type VariantReport = {
  skipped?: string; minutes: number; from: number | null; to: number | null; pr5LastMinute: number | null; chunks: number;
  stoppedEarly: boolean; reset: boolean; prints: number; rebuilt: number; printsDiffer: number; arms: Record<VariantArmName, ArmCounts>;
  errors: string[];
};
/** `clock` is the wall clock the call's time bound reads (the tests move it); `now` is the instant the lease is taken at. */
export type VariantDeps = { db: Db; now: number; holder: string; clock?: () => number };

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => typeof v === "number" ? v : Date.parse(String(v));
const enc = (ms: number) => encodeURIComponent(iso(ms));
const num = (v: unknown) => (v == null ? null : Number(v));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

type PrintRow = { id: string; ts: string; price: number | string; qty: number | string; side: Aggressor };
const toPrint = (r: PrintRow): Print => ({ id: r.id, ts: msOf(r.ts), ticks: Math.round(Number(r.price) / QUOTE_TICK), qty: Number(r.qty), side: r.side });
/** A row of PR5's `agent_quote_minutes` as the variant reads it. */
type MinuteRow = { book: QuoteBook; minute: string; x: number | string | null; x_t: string | null; fair_u: number | string | null; hours_n: number | string; prints_n: number | string };

/** Both arms flat, each book seeded with the last print before the start. */
export function newVariantState(start: number, seeds: Record<QuoteBook, Print | null>): VariantState {
  const arm = (a: VariantArmName): VariantArmState => ({
    books: Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newVariantBook(b, VARIANT_ARMS[a], seeds[b])])) as Record<QuoteBook, BookState>,
    gov: newGovCounts(),
  });
  return { codeVersion: VARIANT_CODE_VERSION, lastMinute: start - M, arms: { main: arm("main"), top5: arm("top5") } };
}

/**
 * The variant's own rows, wiped: `0071`'s `agent_quotev_reset()`, which deletes from its four tables and nothing else,
 * run through PostgREST's rpc endpoint (a POST to `rpc/<name>`, which is what the database client's insert sends).
 */
const wipeVariantRows = (db: Db) => db.insert("rpc/agent_quotev_reset", {}, false);

/**
 * One call: take the lease and decide, in order and in chunks of `VARIANT_CHUNK_MINUTES`, every minute PR5's engine has
 * decided and this one has not, at most `VARIANT_MAX_MINUTES`, from PR5's record alone. Each chunk's minute records,
 * events and trips are written, idempotently by their natural keys, before its state is saved, so a call that dies
 * decides the same minutes the same way next time. No chunk starts `VARIANT_WALL_STOP_MS` after the call began. A record
 * written under another `VARIANT_CODE_VERSION` is wiped first, and everything decided again from `VARIANT_START`. It
 * calls no venue.
 */
export async function runQuotesVariant(d: VariantDeps): Promise<VariantReport> {
  const clock = d.clock ?? Date.now, began = clock();
  const zero = (): ArmCounts => ({ orders: 0, posts: 0, refused: 0, withdrawn: 0, fills: 0, exits: 0, stops: 0, trips: 0 });
  const report: VariantReport = {
    minutes: 0, from: null, to: null, pr5LastMinute: null, chunks: 0, stoppedEarly: false, reset: false, prints: 0, rebuilt: 0, printsDiffer: 0,
    arms: { main: zero(), top5: zero() }, errors: [],
  };
  const held = await d.db.claim("agent_locks", `name=eq.quotesv&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + VARIANT_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the quotesv lease" };
  try {
    const pr5 = await d.db.select<{ last_minute: string | null }>("agent_quote_state", "id=eq.1&select=last_minute");
    const pr5Last = pr5[0]?.last_minute ? msOf(pr5[0].last_minute) : null;
    report.pr5LastMinute = pr5Last;
    if (pr5Last === null) return { ...report, skipped: "PR5's engine has decided no minute yet" };
    const rows = await d.db.select<{ state: VariantState | Record<string, never> }>("agent_quotev_state", "id=eq.1&select=state");
    let st = rows[0]?.state as VariantState | undefined;
    if (st && "arms" in st && st.codeVersion !== VARIANT_CODE_VERSION) {
      await wipeVariantRows(d.db);
      report.reset = true;
      st = undefined;
    }
    if (!st || !("arms" in st)) {
      const seeds = {} as Record<QuoteBook, Print | null>;
      for (const b of QUOTE_BOOKS) {
        const p = await d.db.select<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=lt.${enc(VARIANT_START)}&select=id,ts,price,qty,side&order=ts.desc,id.desc&limit=50`);
        seeds[b] = p.map(toPrint).sort(printOrder).at(-1) ?? null;      // the last in code-point order, whatever the collation
      }
      st = newVariantState(VARIANT_START, seeds);
    }
    const end = Math.min(pr5Last, st.lastMinute + VARIANT_MAX_MINUTES * M);
    if (end <= st.lastMinute) return { ...report, skipped: "no minute PR5 has decided is left to decide" };
    while (st.lastMinute < end) {
      if (report.chunks > 0 && clock() - began >= VARIANT_WALL_STOP_MS) { report.stoppedEarly = true; break; }
      const first = st.lastMinute + M, last = Math.min(end, st.lastMinute + VARIANT_CHUNK_MINUTES * M);
      await decideChunk(d, st, first, last, report);
      report.chunks++;
      report.from ??= first; report.to = last; report.minutes += (last - first) / M + 1;
    }
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.quotesv&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}

/** Minutes [first, last]: read what PR5 decided them on, decide them in both arms, write it all, then save the state. */
async function decideChunk(d: VariantDeps, st: VariantState, first: number, last: number, report: VariantReport) {
  const n = (last - first) / M + 1;
  const recRows = await d.db.select<MinuteRow>("agent_quote_minutes", `minute=gte.${enc(first)}&minute=lte.${enc(last)}&select=book,minute,x,x_t,fair_u,hours_n,prints_n&order=minute.asc,book.asc&limit=${2 * n}`);
  const recs = new Map(recRows.map((r) => [`${r.book}|${msOf(r.minute)}`, r]));
  const prints = {} as Record<QuoteBook, Print[]>;
  for (const b of QUOTE_BOOKS) {
    const pRows = await d.db.selectAll<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=gte.${enc(first)}&ts=lt.${enc(last + M)}&select=id,ts,price,qty,side&order=ts.asc,id.asc`);
    prints[b] = pRows.map(toPrint).sort(printOrder);                  // the rule's order, not the database's collation
    report.prints += prints[b].length;
  }
  // A book-minute PR5 decided without writing its row: rebuilt from the stored series as PR5's engine computes it.
  const missing = QUOTE_BOOKS.filter((b) => { for (let t = first; t <= last; t += M) if (!recs.has(`${b}|${t}`)) return true; return false; });
  let fxBars: Array<[number, number]> = [];
  const hours = {} as Record<QuoteBook, Array<[number, number]>>;
  if (missing.length) {
    const fxRows = await d.db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.fx&t=gte.${enc(first - QUOTE_FX_LOOKBACK_MS)}&t=lte.${enc(last)}&select=t,value&order=kind.asc,t.asc`);
    fxBars = fxRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    for (const b of missing) {
      const hRows = await d.db.selectAll<{ t: string; value: number }>("agent_quote_inputs", `kind=eq.${encodeURIComponent(`fair:${QUOTE_USD_BOOK[b]}`)}&t=gte.${enc(first - DAY)}&t=lte.${enc(last)}&select=t,value&order=kind.asc,t.asc`);
      hours[b] = hRows.map((r) => [msOf(r.t), Number(r.value)] as [number, number]);
    }
  }
  const trips: VariantTrip[] = [], events: VariantEvent[] = [], records: VariantMinuteRecord[] = [];
  const j = { "USDC-GBP": 0, "USDT-GBP": 0 } as Record<QuoteBook, number>;
  for (let t = first; t <= last; t += M) {
    for (const b of QUOTE_BOOKS) {
      const mine: Print[] = [];
      while (j[b] < prints[b].length && prints[b][j[b]].ts < t + M) { if (prints[b][j[b]].ts >= t) mine.push(prints[b][j[b]]); j[b]++; }
      const rec = recs.get(`${b}|${t}`);
      let inp: MinuteInputs, record: VariantMinuteRecord;
      if (rec) {
        inp = { x: num(rec.x), fairU: num(rec.fair_u), prints: mine };
        record = {
          book: b, minute: iso(t), source: "minutes", x: inp.x, x_t: rec.x_t ? iso(msOf(rec.x_t)) : null, fair_u: inp.fairU,
          hours_n: Number(rec.hours_n), prints_n: mine.length, pr5_prints_n: Number(rec.prints_n),
        };
        if (record.pr5_prints_n !== mine.length) report.printsDiffer++;   // a print came late, or went: decided on what is stored
      } else {
        const bar = fxBarAt(t, fxBars), win = fairHours(t, hours[b] ?? []);
        inp = { x: bar ? bar[1] : null, fairU: median(win), prints: mine };
        record = { book: b, minute: iso(t), source: "rebuilt", x: inp.x, x_t: bar ? iso(bar[0]) : null, fair_u: inp.fairU, hours_n: win.length, prints_n: mine.length, pr5_prints_n: null };
        report.rebuilt++;
      }
      records.push(record);
      for (const a of VARIANT_ARM_NAMES) {
        const out = stepVariantMinute(st.arms[a].books[b], t, inp, VARIANT_ARMS[a], st.arms[a].gov);
        trips.push(...out.trips); events.push(...out.events);
      }
    }
  }
  for (const a of VARIANT_ARM_NAMES) {
    const c = report.arms[a], mine = events.filter((e) => e.arm === a);
    c.orders += mine.filter((e) => e.kind === "order").length; c.posts += mine.filter((e) => e.what !== null).length;
    c.refused += mine.filter((e) => e.kind === "refused").length; c.withdrawn += mine.filter((e) => e.kind === "withdraw").length;
    c.fills += mine.filter((e) => e.kind === "fill").length; c.exits += mine.filter((e) => e.kind === "exit").length;
    c.stops += mine.filter((e) => e.kind === "stop").length; c.trips += trips.filter((x) => x.arm === a).length;
  }
  // Idempotent by their natural keys: a call that dies after this point decides the same minutes the same way next time.
  await d.db.upsert("agent_quotev_minutes", records, "book,minute");
  if (events.length) await d.db.upsert("agent_quotev_events", events.map(variantEventRow), "arm,book,minute,side,k,kind");
  if (trips.length) await d.db.upsert("agent_quotev_trips", trips.map(variantTripRow), "arm,book,side,k,t_entry");
  st.lastMinute = last;
  await d.db.upsert("agent_quotev_state", [{ id: 1, state: st, last_minute: iso(last), updated_at: iso(d.now), last_error: null }], "id");
}

/** An event as `agent_quotev_events` stores it. Every row has every column, as a PostgREST bulk write needs. */
export function variantEventRow(e: VariantEvent) {
  return { arm: e.arm, book: e.book, minute: iso(e.minute), side: e.side, k: e.k, kind: e.kind, what: e.what, key: e.key, ticks: e.ticks, detail: e.detail };
}

/** A round trip as `agent_quotev_trips` stores it: PR5's columns, with the arm and the key. */
export function variantTripRow(t: VariantTrip) {
  return {
    arm: t.arm, key: t.key, book: t.book, side: t.side, k: t.k, t_entry: iso(t.tEntry), fill_ts: iso(t.fillTs), fill_print_id: t.fillId, entry: t.entry,
    qty: t.qty, x_entry: t.xEntry, fair_entry: t.fairEntry, entry_oid: t.entryOid, t_exit: iso(t.tExit), exit: t.exit, how: t.how,
    exit_print_id: t.exitPrintId, exit_oid: t.exitOid, notional_usd: t.notionalUsd, pnl_usd: t.pnlUsd,
  };
}
