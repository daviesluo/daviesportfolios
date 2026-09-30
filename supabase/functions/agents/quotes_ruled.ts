// "Stablecoin quotes variant-2" (rule D) on paper. The pre-registration is
// docs/agents/reviews/2026-09-28-pr5-rule-d-prereg.md. It is a second instance of
// `stepVariantMinute`, with its own state, tables, lease and cron row. PR5V's
// engine, its `VARIANT_CODE_VERSION`, its tables and its row of the minute job
// are not rewritten. A code change here that could change a decision bumps
// `RULED_CODE_VERSION`, wipes only these tables, and re-decides from the start.
//
//   d   the arm that is judged. PR5V's arm `main` (nine rungs, 0.03 % exits,
//       $100, the shared cap, four keys, 600 / 700) except an entry re-prices
//       when fair has moved more than max(0.03 %, k/3), and the fair rate is
//       TrueFX's GBP/USD read in the minute before the turn it prices, for a
//       minute this call is deciding within three minutes of its clock.
//       Yahoo — the bar PR5 stored — is the fallback, and the X of every
//       older minute.
//   v1  the deviation, never judged. PR5V's arm `main` exactly, on PR5's stored
//       X every minute, so a drift in the shared function shows up here.
//
// TrueFX is read once in the call, only while the engine is current, and held
// in the state for the next minute's turn: the turn at t reads data to t − 1
// (the pre-registration's §2), and this call decides minute m − 2 at m + ~1 s,
// because PR5 decides m − 1 only at m + 25 s. The first engine (code version
// 1) gave the rate it read now to the minute it decided now, a rate from about
// two minutes after that turn, so a re-price chose which quotes rested through
// a minute on where GBP/USD went during it (deviation 1, reference §4 item 47;
// `backtests/pr5v/lookahead.json` prices it). It is not stored as a series of
// its own. No venue is called.

import type { Db } from "./db.ts";
import {
  fairHours, fxBarAt, median, QUOTE_BOOKS, QUOTE_FX_LOOKBACK_MS, QUOTE_SIZE_USD, QUOTE_TICK, QUOTE_USD_BOOK, QUOTE_VOLUME_SHARE,
  type BookState, type MinuteInputs, type Print, type QuoteBook,
} from "./quotes.ts";
import {
  newGovCounts, newVariantBook, printOrder, stepVariantMinute, VARIANT_ARMS, VARIANT_LEASE_MS, VARIANT_MAX_MINUTES, VARIANT_CHUNK_MINUTES,
  VARIANT_START, VARIANT_WALL_STOP_MS, variantEventRow, variantTripRow,
  type GovCounts, type VariantArm, type VariantEvent, type VariantTrip,
} from "./quotes_variant.ts";

const M = 60e3, DAY = 86400e3;
/** TrueFX's keyless GBP/USD snapshot. One GET, no key, not a registered source. */
const TRUEFX_URL = "https://webrates.truefx.com/rates/connect.html?f=csv";
const TRUEFX_TIMEOUT_MS = 3000;
/** A snapshot older than this against the call's clock is a miss. */
const TRUEFX_STALE_MS = 60e3;
/** A snapshot this far ahead of the call's clock is a miss. */
const TRUEFX_AHEAD_MS = 5e3;
/** TrueFX is the rate only for a minute the call is deciding within this of its clock. */
const TRUEFX_LIVE_MS = 3 * M;

/** Rule D's entry step: max(0.03 %, k/3). Exits stay on `reprice`. `away` is unset, so both directions share the step. */
export function ruleDEntryBand(k: number): number {
  return Math.max(0.0003, k / 3);
}

export type TrueFxSnap = { mid: number; srcMs: number };

/**
 * TrueFX's CSV the way the study's reader parses it: the GBP/USD row, bid and ask each the concatenation of the two
 * price fields, the timestamp the row's own. Anything else, or a mid that is not a positive number, is a miss.
 */
export function parseTrueFxGbpUsd(body: string): TrueFxSnap | null {
  for (const line of body.trim().split(/\r?\n/)) {
    const p = line.split(",");
    if (p[0] !== "GBP/USD" || p.length < 6) continue;
    const bid = Number(p[2] + p[3]), ask = Number(p[4] + p[5]), srcMs = Number(p[1]);
    if (!(bid > 0) || !(ask > 0) || !Number.isFinite(srcMs)) return null;
    const mid = (bid + ask) / 2;
    return mid > 0 ? { mid, srcMs } : null;
  }
  return null;
}

/** The snapshot's own timestamp is within 60 s behind the call's clock, and at most 5 s ahead of it. */
export function trueFxFresh(srcMs: number, nowMs: number): boolean {
  return nowMs - srcMs <= TRUEFX_STALE_MS && srcMs - nowMs <= TRUEFX_AHEAD_MS;
}

/** The minute is one this call is deciding within three minutes of its clock, and not one in the future. */
export function trueFxApplies(minute: number, nowMs: number): boolean {
  return nowMs >= minute && nowMs - minute <= TRUEFX_LIVE_MS;
}

/** A snapshot read by one call and held for the turn it may price: the start of the minute after the one it was read in. */
export type TrueFxHeld = TrueFxSnap & { readAt: number; serves: number };

/**
 * A fresh snapshot, read at `readAt` by this engine's clock, becomes the rate of the turn at the start of the next
 * minute, and of no other: that turn reads data to t − 1, and the snapshot is known before t. A stale one is a miss.
 */
export function holdTrueFx(snap: TrueFxSnap | null, readAt: number): TrueFxHeld | null {
  if (!snap || !trueFxFresh(snap.srcMs, readAt)) return null;
  return { ...snap, readAt, serves: Math.floor(readAt / M) * M + M };
}

/**
 * Arm `d`'s X for one minute: the snapshot held for that minute's turn — read before the minute began — when the minute
 * is decided within three minutes of the clock; otherwise the Yahoo bar (PR5's stored X, which may itself be null).
 * `source` is what the minute's record says, and a TrueFX minute records when the snapshot was read.
 */
export function xForArmD(yahoo: number | null, held: TrueFxHeld | null, minute: number, nowMs: number): { x: number | null; source: "truefx" | "yahoo"; srcMs: number | null; readAt: number | null } {
  if (held && held.serves === minute && held.readAt < minute && trueFxApplies(minute, nowMs)) {
    return { x: held.mid, source: "truefx", srcMs: held.srcMs, readAt: held.readAt };
  }
  return { x: yahoo, source: "yahoo", srcMs: null, readAt: null };
}

export type RuledArmName = "v1" | "d";
const NINE = VARIANT_ARMS.main.rungs;
const GOVERNED = { reprice: 0.0003, sizeUsd: QUOTE_SIZE_USD, volumeShare: QUOTE_VOLUME_SHARE, entryAt: 600, stopAt: 700 };
/** Arm `v1` is PR5V's `main` with the entry band unset. Arm `d` is the same plus rule D's band. */
export const RULED_ARMS: Record<RuledArmName, VariantArm> = {
  v1: { name: "v1", rungs: NINE, ...GOVERNED },
  d: { name: "d", rungs: NINE, ...GOVERNED, entryBand: ruleDEntryBand },
};
export const RULED_ARM_NAMES: RuledArmName[] = ["v1", "d"];
/** 2 since 2026-09-30: arm `d`'s TrueFX is the snapshot read before the turn, not the one read when the minute is decided. */
export const RULED_CODE_VERSION = 2;
export const RULED_START = VARIANT_START;

export type RuledArmState = { books: Record<QuoteBook, BookState>; gov: GovCounts };
export type RuledState = {
  codeVersion: number; lastMinute: number; arms: Record<RuledArmName, RuledArmState>;
  /** Largest |arm v1 − PR5V main| of daily P&L, and how many days either arm had a trip. */
  checkMaxUsd: number; checkDays: number;
  /** The snapshots read and not yet used: each for the turn at its `serves`. */
  truefx?: TrueFxHeld[];
};
export type RuledMinuteRecord = {
  book: QuoteBook; minute: string; source: "minutes" | "rebuilt"; x: number | null; x_t: string | null; fair_u: number | null;
  hours_n: number; prints_n: number; pr5_prints_n: number | null; x_d: number | null; x_source: "truefx" | "yahoo";
  /** A TrueFX minute's snapshot: its own timestamp, and when this engine read it (always before `minute`). */
  x_d_t: string | null; x_d_read: string | null;
};
type ArmCounts = { orders: number; posts: number; refused: number; withdrawn: number; fills: number; exits: number; stops: number; trips: number };
export type RuledReport = {
  skipped?: string; minutes: number; from: number | null; to: number | null; pr5LastMinute: number | null; chunks: number;
  stoppedEarly: boolean; reset: boolean; prints: number; rebuilt: number; printsDiffer: number; truefx: number;
  /** The turn this call's snapshot was held for, when it read a fresh one. */
  truefxHeld?: string;
  arms: Record<RuledArmName, ArmCounts>; checkMaxUsd: number | null; checkDays: number | null; errors: string[];
};
export type RuledDeps = { db: Db; now: number; holder: string; clock?: () => number; fx?: () => Promise<TrueFxSnap | null>; fetchImpl?: typeof fetch };

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => typeof v === "number" ? v : Date.parse(String(v));
const enc = (ms: number) => encodeURIComponent(iso(ms));
const num = (v: unknown) => (v == null ? null : Number(v));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

type PrintRow = { id: string; ts: string; price: number | string; qty: number | string; side: Print["side"] };
const toPrint = (r: PrintRow): Print => ({ id: r.id, ts: msOf(r.ts), ticks: Math.round(Number(r.price) / QUOTE_TICK), qty: Number(r.qty), side: r.side });
type MinuteRow = { book: QuoteBook; minute: string; x: number | string | null; x_t: string | null; fair_u: number | string | null; hours_n: number | string; prints_n: number | string };

export function newRuledState(start: number, seeds: Record<QuoteBook, Print | null>): RuledState {
  const arm = (a: RuledArmName): RuledArmState => ({
    books: Object.fromEntries(QUOTE_BOOKS.map((b) => [b, newVariantBook(b, RULED_ARMS[a], seeds[b])])) as Record<QuoteBook, BookState>,
    gov: newGovCounts(),
  });
  return { codeVersion: RULED_CODE_VERSION, lastMinute: start - M, arms: { v1: arm("v1"), d: arm("d") }, checkMaxUsd: 0, checkDays: 0, truefx: [] };
}

/**
 * The held snapshots after a new one (which replaces any held for the same turn), keeping only those a later call can
 * still use: a turn not yet decided, and one that will still be within three minutes of the clock.
 */
export function keepHeld(held: TrueFxHeld[] | undefined, add: TrueFxHeld | null, lastMinute: number, nowMs: number): TrueFxHeld[] {
  const all = [...(held ?? []).filter((h) => !add || h.serves !== add.serves), ...(add ? [add] : [])];
  return all.filter((h) => h.serves > lastMinute && nowMs - h.serves <= TRUEFX_LIVE_MS).sort((a, b) => a.serves - b.serves);
}

const wipeRuledRows = (db: Db) => db.insert("rpc/agent_quoted_reset", {}, false);

async function readTrueFx(fetchImpl: typeof fetch): Promise<TrueFxSnap | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TRUEFX_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TRUEFX_URL, { signal: ac.signal });
    if (!res.ok) return null;
    return parseTrueFxGbpUsd(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The call's one snapshot. A failed read is a miss. */
async function trueFxOnce(d: RuledDeps): Promise<TrueFxSnap | null> {
  try {
    return d.fx ? await d.fx() : await readTrueFx(d.fetchImpl ?? fetch);
  } catch {
    return null;
  }
}

/**
 * Arm `v1`'s trips against PR5V's arm `main`, summed by the UTC day of entry. The largest absolute difference and the
 * number of days either has a trip. A failed read leaves the previous check and does not become `last_error`.
 */
async function deviationCheck(db: Db): Promise<{ checkMaxUsd: number; checkDays: number } | null> {
  try {
    const [v1, main] = await Promise.all([
      db.selectAll<{ t_entry: string; pnl_usd: number | string }>("agent_quoted_trips", "arm=eq.v1&select=t_entry,pnl_usd&order=id.asc"),
      db.selectAll<{ t_entry: string; pnl_usd: number | string }>("agent_quotev_trips", "arm=eq.main&select=t_entry,pnl_usd&order=id.asc"),
    ]);
    const days = new Map<string, { v1: number; main: number }>();
    const add = (rows: { t_entry: string; pnl_usd: number | string }[], which: "v1" | "main") => {
      for (const r of rows) {
        const day = new Date(r.t_entry).toISOString().slice(0, 10);
        const cur = days.get(day) ?? { v1: 0, main: 0 };
        cur[which] += Number(r.pnl_usd);
        days.set(day, cur);
      }
    };
    add(v1, "v1");
    add(main, "main");
    let max = 0;
    for (const v of days.values()) max = Math.max(max, Math.abs(v.v1 - v.main));
    return { checkMaxUsd: max, checkDays: days.size };
  } catch {
    return null;
  }
}

export async function runQuotesRuled(d: RuledDeps): Promise<RuledReport> {
  const clock = d.clock ?? Date.now, began = clock();
  const zero = (): ArmCounts => ({ orders: 0, posts: 0, refused: 0, withdrawn: 0, fills: 0, exits: 0, stops: 0, trips: 0 });
  const report: RuledReport = {
    minutes: 0, from: null, to: null, pr5LastMinute: null, chunks: 0, stoppedEarly: false, reset: false, prints: 0, rebuilt: 0, printsDiffer: 0, truefx: 0,
    arms: { v1: zero(), d: zero() }, checkMaxUsd: null, checkDays: null, errors: [],
  };
  const held = await d.db.claim("agent_locks", `name=eq.quotesd&lease_until=lt.${enc(d.now)}`, { lease_until: iso(d.now + VARIANT_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the quotesd lease" };
  try {
    const pr5 = await d.db.select<{ last_minute: string | null }>("agent_quote_state", "id=eq.1&select=last_minute");
    const pr5Last = pr5[0]?.last_minute ? msOf(pr5[0].last_minute) : null;
    report.pr5LastMinute = pr5Last;
    if (pr5Last === null) return { ...report, skipped: "PR5's engine has decided no minute yet" };
    const rows = await d.db.select<{ state: RuledState | Record<string, never> }>("agent_quoted_state", "id=eq.1&select=state");
    let st = rows[0]?.state as RuledState | undefined;
    if (st && "arms" in st && st.codeVersion !== RULED_CODE_VERSION) {
      await wipeRuledRows(d.db);
      report.reset = true;
      st = undefined;
    }
    if (!st || !("arms" in st)) {
      const seeds = {} as Record<QuoteBook, Print | null>;
      for (const b of QUOTE_BOOKS) {
        const p = await d.db.select<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=lt.${enc(RULED_START)}&select=id,ts,price,qty,side&order=ts.desc,id.desc&limit=50`);
        seeds[b] = p.map(toPrint).sort(printOrder).at(-1) ?? null;
      }
      st = newRuledState(RULED_START, seeds);
    }
    const end = Math.min(pr5Last, st.lastMinute + VARIANT_MAX_MINUTES * M);
    // Arm d's rate for a later turn: read once, only while the engine is current (its last minute after this call within
    // three minutes of the clock), and held for the turn at the start of the next minute. Never this call's minutes.
    if (trueFxApplies(Math.max(end, st.lastMinute), d.now)) {
      const kept = holdTrueFx(await trueFxOnce(d), d.now + (clock() - began));
      if (kept) report.truefxHeld = iso(kept.serves);
      st.truefx = keepHeld(st.truefx, kept, st.lastMinute, d.now);
    }
    if (end <= st.lastMinute) {
      // Nothing to decide this call: keep the snapshot for the turn it serves.
      if (report.truefxHeld) await d.db.upsert("agent_quoted_state", [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: null }], "id");
      return { ...report, skipped: "no minute PR5 has decided is left to decide" };
    }
    while (st.lastMinute < end) {
      if (report.chunks > 0 && clock() - began >= VARIANT_WALL_STOP_MS) { report.stoppedEarly = true; break; }
      const first = st.lastMinute + M, last = Math.min(end, st.lastMinute + VARIANT_CHUNK_MINUTES * M);
      await decideChunk(d, st, first, last, report);
      report.chunks++;
      report.from ??= first; report.to = last; report.minutes += (last - first) / M + 1;
    }
    st.truefx = keepHeld(st.truefx, null, st.lastMinute, d.now);
    const check = await deviationCheck(d.db);
    if (check) {
      st.checkMaxUsd = check.checkMaxUsd;
      st.checkDays = check.checkDays;
      report.checkMaxUsd = check.checkMaxUsd;
      report.checkDays = check.checkDays;
      await d.db.upsert("agent_quoted_state", [{ id: 1, state: st, last_minute: iso(st.lastMinute), updated_at: iso(d.now), last_error: null }], "id");
    }
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.quotesd&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}

async function decideChunk(d: RuledDeps, st: RuledState, first: number, last: number, report: RuledReport) {
  const n = (last - first) / M + 1;
  const recRows = await d.db.select<MinuteRow>("agent_quote_minutes", `minute=gte.${enc(first)}&minute=lte.${enc(last)}&select=book,minute,x,x_t,fair_u,hours_n,prints_n&order=minute.asc,book.asc&limit=${2 * n}`);
  const recs = new Map(recRows.map((r) => [`${r.book}|${msOf(r.minute)}`, r]));
  const prints = {} as Record<QuoteBook, Print[]>;
  for (const b of QUOTE_BOOKS) {
    const pRows = await d.db.selectAll<PrintRow>("agent_quote_prints", `book=eq.${b}&ts=gte.${enc(first)}&ts=lt.${enc(last + M)}&select=id,ts,price,qty,side&order=ts.asc,id.asc`);
    prints[b] = pRows.map(toPrint).sort(printOrder);
    report.prints += prints[b].length;
  }
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
  const trips: VariantTrip[] = [], events: VariantEvent[] = [], records: RuledMinuteRecord[] = [];
  const j = { "USDC-GBP": 0, "USDT-GBP": 0 } as Record<QuoteBook, number>;
  for (let t = first; t <= last; t += M) {
    for (const b of QUOTE_BOOKS) {
      const mine: Print[] = [];
      while (j[b] < prints[b].length && prints[b][j[b]].ts < t + M) { if (prints[b][j[b]].ts >= t) mine.push(prints[b][j[b]]); j[b]++; }
      const rec = recs.get(`${b}|${t}`);
      let yahoo: MinuteInputs, recordBase: Omit<RuledMinuteRecord, "x_d" | "x_source" | "x_d_t" | "x_d_read">;
      if (rec) {
        yahoo = { x: num(rec.x), fairU: num(rec.fair_u), prints: mine };
        recordBase = {
          book: b, minute: iso(t), source: "minutes", x: yahoo.x, x_t: rec.x_t ? iso(msOf(rec.x_t)) : null, fair_u: yahoo.fairU,
          hours_n: Number(rec.hours_n), prints_n: mine.length, pr5_prints_n: Number(rec.prints_n),
        };
        if (recordBase.pr5_prints_n !== mine.length) report.printsDiffer++;
      } else {
        const bar = fxBarAt(t, fxBars), win = fairHours(t, hours[b] ?? []);
        yahoo = { x: bar ? bar[1] : null, fairU: median(win), prints: mine };
        recordBase = { book: b, minute: iso(t), source: "rebuilt", x: yahoo.x, x_t: bar ? iso(bar[0]) : null, fair_u: yahoo.fairU, hours_n: win.length, prints_n: mine.length, pr5_prints_n: null };
        report.rebuilt++;
      }
      const xd = xForArmD(yahoo.x, st.truefx?.find((h) => h.serves === t) ?? null, t, d.now);
      if (xd.source === "truefx") report.truefx++;
      records.push({
        ...recordBase, x_d: xd.x, x_source: xd.source,
        x_d_t: xd.srcMs === null ? null : iso(xd.srcMs), x_d_read: xd.readAt === null ? null : iso(xd.readAt),
      });
      const forD: MinuteInputs = { x: xd.x, fairU: yahoo.fairU, prints: mine };
      for (const a of RULED_ARM_NAMES) {
        const out = stepVariantMinute(st.arms[a].books[b], t, a === "d" ? forD : yahoo, RULED_ARMS[a], st.arms[a].gov);
        trips.push(...out.trips); events.push(...out.events);
      }
    }
  }
  for (const a of RULED_ARM_NAMES) {
    const c = report.arms[a], mine = events.filter((e) => e.arm === a);
    c.orders += mine.filter((e) => e.kind === "order").length; c.posts += mine.filter((e) => e.what !== null).length;
    c.refused += mine.filter((e) => e.kind === "refused").length; c.withdrawn += mine.filter((e) => e.kind === "withdraw").length;
    c.fills += mine.filter((e) => e.kind === "fill").length; c.exits += mine.filter((e) => e.kind === "exit").length;
    c.stops += mine.filter((e) => e.kind === "stop").length; c.trips += trips.filter((x) => x.arm === a).length;
  }
  await d.db.upsert("agent_quoted_minutes", records, "book,minute");
  if (events.length) await d.db.upsert("agent_quoted_events", events.map(variantEventRow), "arm,book,minute,side,k,kind");
  if (trips.length) await d.db.upsert("agent_quoted_trips", trips.map(variantTripRow), "arm,book,side,k,t_entry");
  st.lastMinute = last;
  await d.db.upsert("agent_quoted_state", [{ id: 1, state: st, last_minute: iso(last), updated_at: iso(d.now), last_error: null }], "id");
}
