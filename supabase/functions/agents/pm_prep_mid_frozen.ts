// "Reward quotes live-prep": the paper test of exactly what Polymarket's order path would do (Davies, 2026-10-01, about
// 18:15 UTC: "Polymarket的准备好的live策略是不是从来没有paper trading测试过？要不要先上线Reward quotes live-prep测试一下？有问题也及时修复，
// 然后我们操作账户和转账问题，纸面测试24小时之后再验证一遍没问题自动上线？"). Migration 0077; pre-registration
// docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md; its check docs/agents/backtests/pmlive/prep_check.sql.
//
// WHAT IT TESTS: the order path's OWN decisions (`agents/pm_live.ts`, in dry-run), not a second implementation of them.
// Each minute the path records the book it decided on (`pm_live_minutes`, mode dry_run: RW's `summarize` row of the
// book it read) and every order it would send, with the turn that placed it and the turn that cancelled or expired it
// (`pm_live_orders`, mode dry_run). This layer reads both, two minutes behind the clock as RW decides a minute
// (`RW_DECIDE_LAG_MS`: the minute's prints are public by then), and fills the orders the path had resting from the
// public prints by RW's own rule: RW's `stepRw` (`agents/pmrw.ts`, frozen, imported) on the very row the path decided
// on. It never writes a table of the path's, so what the path would send is the same with this layer on or off
// (pinned in pm_prep.test.ts against a simulated day of the path itself).
//
// One market-minute is classified by what the path had resting after its turn of that minute:
//   matched   its bid (a BUY of YES) and ask (a BUY of NO) are RW's quote on the minute's row at RW's N, as `rwQuotes`
//             places them with nothing held: the minute is RW's minute, and `stepRw` decides it on that row and the
//             minute's prints — the fills, a side stopped at 3N of the PAPER inventory (the path's own rule, which
//             only fills can exercise), and RW's reward line. A dry-run never holds anything, so this is the one place
//             where what live mode would do differs from what the dry-run did, and stepRw is RW's rule for it.
//   dark      nothing rested (a gate closed, the book unreadable or one-sided, the rule quoting nothing): no fill, no
//             reward, as live.
//   diverged  something rested that is not RW's quote on that row (a side withheld, a turn's post late): not quoted on
//             paper, recorded with what rested; the pre-registration bounds how often.
// A market-minute the path recorded no row for (its turn did not run, or the book could not be read) is decided as
// nothing, as RW's engine decides a minute it has no book for; a minute of a day with markets and no row at all is
// counted `missing`.
//
// THE PATH'S OWN BOOK-KEEPING: every paper fill is booked as the path would book its fill (a bid as a BUY of YES at its
// order's price, an ask as a BUY of NO; in close-only, the sells `closeOnly` makes), and the P&L is the path's own
// `tokenBooks` and `bookPnl` on those fills and on each market's settlement (`settlementFills`), marked at the touch
// mid of the book the path read, as it marks. Its loss stops act as the path's do (`effectiveLimits` of its config,
// −$25 a day and −$75 in all): from the minute after one trips nothing opens — the day stop until the next UTC day, the
// total stop for good — and only `closeOnly`'s sells of what is held rest, each side run alone through `stepRw`.
// Rewards are the formula's (RW's line, as stepRw computes it), and at R = 0.40, RW's break-even ratio of what is paid
// to what the formula says; the formula is never counted in the path's stop, which reads fills alone, as live.
//
// WHAT IT READS AND WRITES: `pm_live_config` (the stops), `pm_live_markets` (the day's tokens), `pm_live_minutes` and
// `pm_live_orders` (the dry-run's), read only; Polymarket's public prints of the markets the path quoted, its public
// books of markets the paper still holds that the path no longer quotes (for their marks), and Gamma's word on a held
// market's resolution; its own `pm_prep_*` tables and its `pm-prep` lease. No key, nothing placed, nothing of RW's,
// RW-E's, RW-X's or RW-C's read. Every read of the data API carries the read's own millisecond (`pmPrints`), so no
// cached copy answers it (reference §4 item 36).
//
// ITS END: it decides the dry-run's minutes only. Once the path is live its minutes carry mode `live` and the real fills
// are the record; from then on every minute here is `missing`, and the test has ended.
//
// INSTANCES (2026-10-02, with the order path's: pm_live.ts's header). The layer runs beside one instance of the path, and
// reads that instance's tables (`PrepInstance`): `PREP_INSTANCE` is the layer as it ran before instances, "Reward quotes
// small-pool" (the name the row took that day; "live-prep" before it), reading `pm_live_*` and writing `pm_prep_*`, name
// for name, and `pm_instance.test.ts` runs it beside the pre-registered code (`pm_prep_frozen.ts`) and finds every table
// and report the same. Mid-pool's (`PREP_MID_INSTANCE`, `pm_mid.ts`) reads `pm_mid_*` and writes `pm_midprep_*`. The rule,
// the fills, the book-keeping and the stops do not differ by instance.

import { newAcc, quote, RW_DECIDE_LAG_MS, RW_INV_CAP, RW_STATUS_EVERY_MS, sizeN, stepRw, type Acc, type BookRow } from "./pmrw.ts";
import { applyFill } from "./pmrw_e.ts";
import { pmBooks, pmMarkets, pmPrints, type PmPrint, type PmPublicOpts } from "../_shared/polymarket_public.ts";
import { asTickSize } from "../_shared/polymarket_orders.ts";
import {
  bookPnl, closeOnly, effectiveLimits, inYesBook, onTick, settlementFills, tokenBooks, type PmFill, type PmIntent, type PmLiveConfig, type PmOrderRow,
  type PmSettlement,
} from "./pm_live.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;

/** Its own tables (0077). */
export const PREP_TABLES = ["pm_prep_state", "pm_prep_minutes", "pm_prep_prints", "pm_prep_fills", "pm_prep_days", "pm_prep_settlements", "pm_prep_events"] as const;
/** The order path's tables it reads, and never writes. */
export const PREP_READS = ["pm_live_config", "pm_live_markets", "pm_live_minutes", "pm_live_orders"] as const;
export const PREP_DB_TABLES: readonly string[] = [...PREP_TABLES, ...PREP_READS, "agent_locks"];
export const PREP_LOCK = "pm-prep";
/** One instance of the layer: the tables it writes, the order path's it reads, its lease and the migration that made it. */
export type PrepInstance = {
  name: string;
  tables: { state: string; minutes: string; prints: string; fills: string; days: string; settlements: string; events: string };
  reads: { config: string; markets: string; minutes: string; orders: string };
  lock: string;
  migration: string;
};
/** The layer as it ran before instances, name for name (0077): beside the small-pool path. */
export const PREP_INSTANCE: PrepInstance = {
  name: "Reward quotes small-pool",
  tables: {
    state: "pm_prep_state", minutes: "pm_prep_minutes", prints: "pm_prep_prints", fills: "pm_prep_fills", days: "pm_prep_days", settlements: "pm_prep_settlements",
    events: "pm_prep_events",
  },
  reads: { config: "pm_live_config", markets: "pm_live_markets", minutes: "pm_live_minutes", orders: "pm_live_orders" },
  lock: PREP_LOCK,
  migration: "0077",
};
/** What an instance of the layer may touch: its own tables, the path's four it reads, and `agent_locks` (its lease). */
export const prepDbTables = (inst: PrepInstance): readonly string[] => [...Object.values(inst.tables), ...Object.values(inst.reads), "agent_locks"];
/** The path's tables an instance reads, and never writes. */
export const prepReads = (inst: PrepInstance): readonly string[] => Object.values(inst.reads);
export const PREP_LEASE_MS = 55e3;
/** Minutes decided in one run at most (a catch-up after an outage goes 240 at a time, as RW's engine does). */
export const PREP_MAX_MINUTES = 240;
/** RW's break-even ratio of actual to formula rewards (the live pre-study, from RW's paper fills): the second rewards column. */
export const PREP_R_BREAK_EVEN = 0.40;
/** The venue's usual minimum order, in shares, for a market whose minimum the path never recorded (`book_seen.minSize`). */
export const PREP_VENUE_MIN_FALLBACK = 5;

export type PrepClass = "matched" | "dark" | "diverged";
/** A dry-run order as this layer reads it. */
export type PrepOrder = Pick<PmOrderRow, "id" | "ts" | "cond" | "token" | "outcome" | "side" | "price" | "size" | "state" | "cancelled_at" | "request" | "book_seen">;
/** One minute of the path's record (`pm_live_minutes`), as this layer reads it. */
export type PrepLiveMinute = {
  minute: string; cond: string; rate: number | string; max_spread: number | string; min_size: number | string; tick: number | string;
  bb: number | string | null; ba: number | string | null; ab: number | string | null; aa: number | string | null; q1: number | string | null; q2: number | string | null;
};
/** One paper fill: RW's (the side of the one book, RW's price, the print that proved it) and the path's booking of it. */
export type PrepFill = {
  cond: string; minute: number; printId: string; ts: number; side: "bid" | "ask"; price: number; size: number;
  token: string; tokenSide: "BUY" | "SELL"; tokenPrice: number; closeOnly: boolean;
};
export type PrepDay = { reward: number; fills: number; matched: number; dark: number; diverged: number; missing: number; markets: string[] };
export type PrepState = {
  version: 1;
  startedAt: string;
  lastDecided: number;                                   // ms: the last minute decided
  dayOf: number;                                         // ms: the UTC day being accumulated
  statusAt: number;                                      // ms: the last settlement check
  acc: Record<string, Acc>;                              // RW's account per market: stepRw's state (net = YES − NO held)
  tokens: Record<string, { yes: string; no: string }>;   // every market it has decided, its two tokens
  marks: Record<string, number>;                         // the touch mid (YES) of each market's latest book
  stopDay: string | null;                                // the UTC day a day stop tripped in
  stopTotal: string | null;                              // when the total stop tripped
  day: PrepDay;
  pnl: { at: string; day: number; total: number } | null;
};
export type PrepReport = {
  skipped?: string; at: string; minutes: number; from: string | null; to: string | null; prints: number; fills: number; reward: number;
  matched: number; dark: number; diverged: number; missing: number; settled: number; days: number; stops: string[]; held: number; errors: string[];
};
/** `inst` is the layer this run is: `PREP_INSTANCE` (beside small-pool) when absent. */
export type PrepDeps = { db: Db; now: number; holder: string; pm?: PmPublicOpts; inst?: PrepInstance };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const enc = encodeURIComponent;
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const nz = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const newDay = (): PrepDay => ({ reward: 0, fills: 0, matched: 0, dark: 0, diverged: 0, missing: 0, markets: [] });
/**
 * A public read, made again once at once if it fails: a single dropped request is not a fault of the run (every one of
 * these reads is keyless and changes nothing, so a second asking is safe); a second failure is.
 */
export async function twice<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch { return await read(); }
}

// ------------------------------------------------------------------ the pure rules, each pinned in pm_prep.test.ts

/** The minute of the turn that placed an order: its signed `timestamp` is that turn's clock (`buildOrder`); else its row's time. */
export function placedMinute(o: Pick<PrepOrder, "request" | "ts">): number {
  const t = Number((o.request as { timestamp?: unknown } | null)?.timestamp);
  return minuteOf(Number.isFinite(t) && t > 0 ? t : Date.parse(o.ts));
}
/**
 * The minute of the turn that ended an order, or null while it rests. A dry-run row is closed with `cancelled_at` set to
 * the closing turn's clock (a cancel, an expiry, a pending row closed); a closed row without one ended with its turn.
 */
export function endedMinute(o: Pick<PrepOrder, "state" | "cancelled_at" | "request" | "ts">): number | null {
  if (o.state === "live" || o.state === "pending") return null;
  return o.cancelled_at ? minuteOf(Date.parse(o.cancelled_at)) : placedMinute(o);
}
/** The path's orders resting in market `cond` once its turn of minute `t` was done: placed by then, not yet ended. */
export function restingAfterTurn(orders: PrepOrder[], cond: string, t: number): PrepOrder[] {
  return orders.filter((o) => {
    if (o.cond !== cond || placedMinute(o) > t) return false;
    const end = endedMinute(o);
    return end === null || end > t;
  });
}

/** A minute's row as RW's rule reads it (`BookRow`), or null without a two-sided touch. */
export const rowOf = (r: PrepLiveMinute): BookRow | null =>
  r.bb === null || r.ba === null ? null : [Number(r.bb), Number(r.ba), nz(r.ab), nz(r.aa), Number(r.q1 ?? 0), Number(r.q2 ?? 0)];

/**
 * The quote the path's rule rests on a minute's row with nothing held (`rwQuotes` in pm_live.ts): RW's `quote` on the
 * row, on the tick, at RW's N; the bid a BUY of YES at b, the ask a BUY of NO at 1 − a, which is an ask at a in the one
 * book. Null where the rule quotes nothing.
 */
export function ruleQuote(row: BookRow | null, tick: number, v: number, minSize: number): { b: number; a: number; n: number } | null {
  const t = asTickSize(tick);
  if (!row || !t || !(v > 0) || !(minSize >= 0)) return null;
  const q = quote(row, tick);
  if (!q) return null;
  return { b: onTick(q.b, t), a: Math.round((1 - onTick(1 - q.a, t)) * 1e9) / 1e9, n: sizeN(minSize) };
}

/**
 * What the path had resting in a market after a turn, against RW's quote on the row it decided on: `matched` when it is
 * exactly that quote (one BUY of YES at b and one BUY of NO at 1 − a, each of size N), `dark` when nothing rested,
 * `diverged` otherwise, with why.
 */
export function classify(resting: PrepOrder[], rule: { b: number; a: number; n: number } | null): { cls: PrepClass; bid: PrepOrder | null; ask: PrepOrder | null; why: string | null } {
  if (!resting.length) return { cls: "dark", bid: null, ask: null, why: null };
  const at = (o: PrepOrder) => inYesBook({ outcome: o.outcome, side: o.side, price: Number(o.price) });
  const bids = resting.filter((o) => at(o).side === "bid"), asks = resting.filter((o) => at(o).side === "ask");
  const desc = resting.map((o) => `${o.outcome} ${o.side} ${Number(o.price)} × ${Number(o.size)}`).join(", ");
  if (!rule) return { cls: "diverged", bid: null, ask: null, why: `orders rest (${desc}) where RW's rule quotes nothing` };
  if (bids.length !== 1 || asks.length !== 1) return { cls: "diverged", bid: null, ask: null, why: `${bids.length} bid(s) and ${asks.length} ask(s) rest (${desc}); RW's rule rests one of each` };
  const bid = bids[0], ask = asks[0];
  const same = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  const ok = bid.outcome === "yes" && bid.side === "BUY" && ask.outcome === "no" && ask.side === "BUY"
    && same(at(bid).price, rule.b) && same(at(ask).price, rule.a) && same(Number(bid.size), rule.n) && same(Number(ask.size), rule.n);
  return ok ? { cls: "matched", bid, ask, why: null }
    : { cls: "diverged", bid: null, ask: null, why: `rests ${desc}; RW's quote on the row is ${rule.b} / ${rule.a} × ${rule.n}` };
}

/**
 * One matched market-minute on paper. Normally RW's `stepRw` decides it on the row the path decided on, with the paper's
 * inventory (a side stopped at 3N its way, as `rwQuotes` stops it on what is held): RW's fills, RW's reward line. Each
 * fill is booked as the path would book its order's fill: a bid as a BUY of YES, an ask as a BUY of NO, at the order's
 * own price. While a paper loss stop is in force, the path is close-only: `rwQuotes`' intents on what is held go through
 * the path's own `closeOnly`, and each sell it rests (our bid as a SELL of NO, our ask as a SELL of YES, at most what is
 * held, nothing under the venue's minimum) is run ALONE through `stepRw` on a scratch account that quotes only that
 * side (with `invCap` 0, an account short by one quotes only its bid, one long by one only its ask) at the sell's size,
 * and its fills are applied to the market's account by RW-E's `applyFill`, stepRw's own book-keeping. A one-sided minute
 * earns no reward, by RW's formula.
 */
export function decideMinute(p: {
  acc: Acc; t: number; row: BookRow; tick: number; v: number; rate: number; minSize: number; venueMin: number;
  bid: PrepOrder; ask: PrepOrder; tokens: { yes: string; no: string }; held: { yes: number; no: number }; stopped: boolean; prints: PmPrint[];
}): { reward: number; fills: PrepFill[]; qb: boolean; qa: boolean; b: number | null; a: number | null } {
  const N = sizeN(p.minSize), tSec = p.t / 1000, cond = p.bid.cond;
  if (!p.stopped) {
    const out = stepRw(p.acc, tSec, p.row, p.tick, p.v, p.rate, N, p.prints);
    const fills = out.fills.map((f): PrepFill => ({
      cond, minute: p.t, printId: f.printId, ts: f.ts * 1000, side: f.side, price: f.price, size: f.size, closeOnly: false,
      token: f.side === "bid" ? p.tokens.yes : p.tokens.no, tokenSide: "BUY", tokenPrice: Number(f.side === "bid" ? p.bid.price : p.ask.price),
    }));
    return { reward: out.decision?.reward ?? 0, fills, qb: out.decision?.qb ?? false, qa: out.decision?.qa ?? false, b: out.decision?.b ?? null, a: out.decision?.a ?? null };
  }
  // Close-only. `rwQuotes`' inventory rule on what is held, then the path's own `closeOnly`.
  const net = p.held.yes - p.held.no;
  const intents: PmIntent[] = [];
  if (net < RW_INV_CAP * N) intents.push({ outcome: "yes", side: "BUY", price: Number(p.bid.price), size: N });
  if (net > -RW_INV_CAP * N) intents.push({ outcome: "no", side: "BUY", price: Number(p.ask.price), size: N });
  const t = asTickSize(p.tick);
  const sells = t ? closeOnly(intents, p.held, { tick: t, minSize: p.venueMin }) : [];
  const fills: PrepFill[] = [];
  let qb = false, qa = false, b: number | null = null, a: number | null = null;
  for (const s of sells) {
    const side = inYesBook(s).side;
    const scratch = newAcc();
    scratch.net = side === "bid" ? -1 : 1;
    const out = stepRw(scratch, tSec, p.row, p.tick, p.v, p.rate, s.size, p.prints, 0, 0);
    if (!out.decision) continue;
    if (side === "bid") { qb = true; b = out.decision.b; } else { qa = true; a = out.decision.a; }
    for (const f of out.fills) {
      applyFill(p.acc, { side: f.side, price: f.price, size: f.size }, p.tick);
      fills.push({
        cond, minute: p.t, printId: f.printId, ts: f.ts * 1000, side: f.side, price: f.price, size: f.size, closeOnly: true,
        token: s.outcome === "yes" ? p.tokens.yes : p.tokens.no, tokenSide: "SELL", tokenPrice: s.price,
      });
    }
  }
  if (p.row[2] !== null && p.row[3] !== null) { p.acc.lastM = (p.row[2] + p.row[3]) / 2; p.acc.lastAb = p.row[2]; p.acc.lastAa = p.row[3]; }
  return { reward: 0, fills, qb, qa, b, a };
}

/** The paper fills as the path's own `tokenBooks` reads its CONFIRMED fills. */
export const pathFills = (fills: Array<Pick<PrepFill, "token" | "tokenSide" | "tokenPrice" | "size" | "ts">>): PmFill[] =>
  fills.map((f) => ({ token: f.token, side: f.tokenSide, price: f.tokenPrice, size: f.size, ts: f.ts }));

/**
 * The paper's P&L as the path computes its own for its stops (`tokenBooks`, `bookPnl`): its fills and settlements up to
 * `until`, each holding marked at its market's touch mid (YES at the mid, NO at 1 − mid), the day from `dayStart`.
 */
export function paperPnl(fills: PrepFill[], settlements: PmSettlement[], tokens: Record<string, { yes: string; no: string }>, marks: Record<string, number>, dayStart: number, until = Infinity) {
  const fs = pathFills(fills.filter((f) => f.ts < until));
  const ss = settlementFills(settlements.filter((s) => Date.parse(s.settled_at) < until));
  const tb = tokenBooks([...fs, ...ss], dayStart);
  const m: Record<string, number | null> = {};
  for (const [cond, tk] of Object.entries(tokens)) {
    const mid = marks[cond];
    m[tk.yes] = mid ?? null; m[tk.no] = mid == null ? null : 1 - mid;
  }
  const pnl = bookPnl(tb, m);
  let heldValue = 0;
  const held: Record<string, number> = {};
  for (const [token, t] of Object.entries(tb)) {
    held[token] = t.held;
    if (t.held > 0 && m[token] != null) heldValue += t.held * (m[token] as number);
  }
  return { ...pnl, heldValue: r6(heldValue), held, books: tb };
}

/** Each market's holdings by the path's book-keeping: YES and NO held. */
export function heldOf(books: ReturnType<typeof tokenBooks>, tk: { yes: string; no: string }): { yes: number; no: number } {
  return { yes: books[tk.yes]?.held ?? 0, no: books[tk.no]?.held ?? 0 };
}

// ------------------------------------------------------------------ the driver

const newState = (now: number): PrepState => ({
  version: 1, startedAt: iso(now), lastDecided: minuteOf(now) - RW_DECIDE_LAG_MS - M, dayOf: Math.floor(now / DAY) * DAY, statusAt: 0,
  acc: {}, tokens: {}, marks: {}, stopDay: null, stopTotal: null, day: newDay(), pnl: null,
});

type FillRow = { cond: string; minute: string; print_id: string; ts: string; side: "bid" | "ask"; price: number | string; size: number | string; token: string; token_side: "BUY" | "SELL"; token_price: number | string; close_only: boolean };
const fillOfRow = (r: FillRow): PrepFill => ({
  cond: r.cond, minute: Date.parse(r.minute), printId: r.print_id, ts: Date.parse(r.ts), side: r.side, price: Number(r.price), size: Number(r.size),
  token: r.token, tokenSide: r.token_side, tokenPrice: Number(r.token_price), closeOnly: !!r.close_only,
});
const rowOfFill = (f: PrepFill) => ({
  cond: f.cond, minute: iso(f.minute), print_id: f.printId, ts: iso(f.ts), side: f.side, price: f.price, size: f.size, token: f.token, token_side: f.tokenSide,
  token_price: f.tokenPrice, close_only: f.closeOnly,
});

/**
 * One run: take the lease; decide every minute of the path's record at least two minutes old, in order, reading the
 * prints of the markets it quoted first (a minute is never decided without them: a failed read stops the run, and the
 * next decides from the same place); close each UTC day with its row; read the books of markets still held that the
 * path no longer quotes (their marks); every ten minutes, settle a held market Gamma shows resolved. It never throws:
 * whatever fails ends in `errors`, and the lease is always given back.
 */
export async function runPmPrep(d: PrepDeps): Promise<PrepReport> {
  const inst = d.inst ?? PREP_INSTANCE;
  const report: PrepReport = {
    at: iso(d.now), minutes: 0, from: null, to: null, prints: 0, fills: 0, reward: 0, matched: 0, dark: 0, diverged: 0, missing: 0, settled: 0, days: 0, stops: [], held: 0, errors: [],
  };
  let leased: unknown[];
  try {
    leased = await d.db.claim("agent_locks", `name=eq.${inst.lock}&lease_until=lt.${enc(iso(d.now))}`, { lease_until: iso(d.now + PREP_LEASE_MS), holder: d.holder });
  } catch (e) {
    report.errors.push(`lease: ${msg(e)}`);
    return report;
  }
  if (!leased.length) return { ...report, skipped: `another run holds the ${inst.lock} lease (or migration ${inst.migration} has not run)` };
  try {
    await prepRun(d, inst, report);
  } catch (e) {
    report.errors.push(`run: ${msg(e)}`);
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${inst.lock}&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires on its own */ }
  }
  return report;
}

async function prepRun(d: PrepDeps, inst: PrepInstance, report: PrepReport): Promise<void> {
  const { db } = d;
  const T = inst.tables, R = inst.reads;
  const nowMinute = minuteOf(d.now);
  const cfg = (await db.select<PmLiveConfig>(R.config, "id=eq.1&select=*"))[0];
  if (!cfg) { report.skipped = `no ${R.config} row`; return; }
  const lim = effectiveLimits(cfg);
  const stored = (await db.select<{ state: PrepState | Record<string, never> }>(T.state, "id=eq.1&select=state"))[0]?.state;
  const st: PrepState = stored && (stored as PrepState).version === 1 ? stored as PrepState : newState(d.now);
  const settlements = await db.selectAll<PmSettlement>(T.settlements, "select=cond,yes_token,no_token,payout,settled_at&order=cond.asc");
  const fills = (await db.selectAll<FillRow>(T.fills, "select=*&order=cond.asc,minute.asc,print_id.asc")).map(fillOfRow);
  const settled = new Set(settlements.map((s) => s.cond));

  // ── 1. decide every minute at least two minutes old ─────────────────────────────────────────────────────────────
  const from = st.lastDecided + M, to = Math.min(nowMinute - RW_DECIDE_LAG_MS, from + (PREP_MAX_MINUTES - 1) * M);
  if (to >= from) {
    const live = await db.selectAll<PrepLiveMinute>(R.minutes,
      `mode=eq.dry_run&minute=gte.${enc(iso(from))}&minute=lte.${enc(iso(to))}&select=minute,cond,rate,max_spread,min_size,tick,bb,ba,ab,aa,q1,q2&order=mode.asc,minute.asc,cond.asc`);
    const markets = await db.select<{ day: string; cond: string; yes_token: string; no_token: string }>(R.markets,
      `day=gte.${dayStr(from)}&day=lte.${dayStr(to)}&select=day,cond,yes_token,no_token&order=day.asc,cond.asc`);
    // The dry-run's orders that could rest in the range: those resting now, and those ended since its first minute.
    const cols = "select=id,ts,cond,token,outcome,side,price,size,state,cancelled_at,request,book_seen";
    const byId = new Map<number, PrepOrder>();
    for (const o of await db.selectAll<PrepOrder>(R.orders, `mode=eq.dry_run&state=in.(pending,live)&${cols}&order=id.asc`)) byId.set(o.id, o);
    for (const o of await db.selectAll<PrepOrder>(R.orders, `mode=eq.dry_run&cancelled_at=gte.${enc(iso(from))}&${cols}&order=id.asc`)) byId.set(o.id, o);
    const orders = [...byId.values()];
    // Each market's minimum order as the venue told the path (its latest order's `book_seen.minSize`).
    const venueMin = new Map<string, number>();
    for (const o of [...orders].sort((x, y) => x.id - y.id)) {
      const ms = Number((o.book_seen as { minSize?: unknown } | null)?.minSize);
      if (ms > 0) venueMin.set(o.cond, ms);
    }
    for (const m of markets) st.tokens[m.cond] ??= { yes: m.yes_token, no: m.no_token };
    const dayMarkets = new Map<string, string[]>();
    for (const m of markets) (dayMarkets.get(m.day) ?? dayMarkets.set(m.day, []).get(m.day)!).push(m.cond);
    // The marks of held markets the path no longer quotes: this layer's own reads (`held` rows).
    const heldRows = await db.selectAll<{ minute: string; cond: string; mark: number | string | null }>(T.minutes,
      `class=eq.held&minute=gte.${enc(iso(from))}&minute=lte.${enc(iso(to))}&select=minute,cond,mark&order=minute.asc,cond.asc`);

    // The prints of every market the path quoted in the range, from its first minute: all of them, or nothing is decided.
    const quoted = [...new Set(live.map((r) => r.cond))].filter((c) => !settled.has(c));
    const prints = new Map<string, PmPrint[]>();
    let ok = true;
    for (const c of quoted) {
      try {
        const got = await twice(async () => {
          const g = await pmPrints(c, Math.floor(from / 1000), d.pm);
          if (!g.complete) throw new Error("prints not complete");
          return g;
        });
        prints.set(c, got.prints);
        report.prints += got.prints.length;
        if (got.prints.length) {
          await db.upsert(T.prints, got.prints.map((p) => ({ id: p.id, cond: c, ts: iso(p.ts * 1000), side: p.side, oi: p.oi, price: p.price, size: p.size })), "id");
        }
      } catch (e) { ok = false; report.errors.push(`prints ${c.slice(0, 10)}…: ${msg(e)}`); }
    }
    if (!ok) { await saveState(d, T, st, report); return; }

    const liveAt = new Map<number, PrepLiveMinute[]>();
    for (const r of live) { const t = Date.parse(r.minute); (liveAt.get(t) ?? liveAt.set(t, []).get(t)!).push(r); }
    const heldAt = new Map<number, Array<{ cond: string; mark: number | null }>>();
    for (const r of heldRows) { const t = Date.parse(r.minute); (heldAt.get(t) ?? heldAt.set(t, []).get(t)!).push({ cond: r.cond, mark: nz(r.mark) }); }
    const minuteRows: Record<string, unknown>[] = [];
    const newFills: PrepFill[] = [];
    for (let t = from; t <= to; t += M) {
      if (t >= st.dayOf + DAY) await closeDays(d, T, st, t, fills.concat(newFills), settlements, report);
      const day = dayStr(t), dayStart = Math.floor(t / DAY) * DAY;
      const rows = liveAt.get(t) ?? [];
      // A minute of a day with markets in which the path recorded nothing at all: its turn did not run, or read no book.
      if (!rows.length && (dayMarkets.get(day) ?? []).length) { st.day.missing++; report.missing++; }
      // Books first: every market's mark as of this minute, so the holdings are marked where the path would mark them.
      for (const r of rows) if (r.bb !== null && r.ba !== null) st.marks[r.cond] = (Number(r.bb) + Number(r.ba)) / 2;
      for (const h of heldAt.get(t) ?? []) if (h.mark !== null && !rows.some((r) => r.cond === h.cond)) st.marks[h.cond] = h.mark;
      const all = fills.concat(newFills);
      const before = paperPnl(all, settlements, st.tokens, st.marks, dayStart);
      const stopped = st.stopTotal !== null || st.stopDay === day;
      for (const r of [...rows].sort((x, y) => (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0))) {
        const c = r.cond, tk = st.tokens[c];
        if (!tk || settled.has(c)) continue;
        const row = rowOf(r), tick = Number(r.tick), v = Number(r.max_spread), minSize = Number(r.min_size), rate = Number(r.rate);
        const rule = ruleQuote(row, tick, v, minSize);
        const cl = classify(restingAfterTurn(orders, c, t), rule);
        const acc = (st.acc[c] ??= newAcc());
        const held = heldOf(before.books, tk);
        let out: ReturnType<typeof decideMinute> | null = null;
        if (cl.cls === "matched" && row) {
          out = decideMinute({
            acc, t, row, tick, v, rate, minSize, venueMin: venueMin.get(c) ?? PREP_VENUE_MIN_FALLBACK, bid: cl.bid!, ask: cl.ask!, tokens: tk, held, stopped,
            prints: prints.get(c) ?? [],
          });
          newFills.push(...out.fills);
          st.day.reward += out.reward; report.reward += out.reward;
          st.day.fills += out.fills.length; report.fills += out.fills.length;
        } else if (row && row[2] !== null && row[3] !== null) {
          acc.lastM = (row[2] + row[3]) / 2; acc.lastAb = row[2]; acc.lastAa = row[3];
        }
        st.day[cl.cls]++; report[cl.cls]++;
        if (!st.day.markets.includes(c)) st.day.markets.push(c);
        const after = { yes: held.yes, no: held.no };
        for (const f of out?.fills ?? []) {
          const k = f.token === tk.yes ? "yes" : "no";
          after[k] = Math.max(0, after[k] + (f.tokenSide === "BUY" ? f.size : -f.size));
        }
        minuteRows.push({
          minute: iso(t), cond: c, class: cl.cls, bb: nz(r.bb), ba: nz(r.ba), b: rule?.b ?? null, a: rule?.a ?? null, n: rule?.n ?? null,
          qb: out ? out.qb : null, qa: out ? out.qa : null, close_only: cl.cls === "matched" && stopped, reward: out?.reward ?? 0, fills: out?.fills.length ?? 0,
          yes_held: after.yes, no_held: after.no, mark: st.marks[c] ?? null,
          detail: cl.cls === "diverged" ? { why: cl.why } : cl.cls === "matched" ? { bid: cl.bid!.id, ask: cl.ask!.id } : {},
        });
      }
      // The path's stops, on the paper's P&L after this minute's fills: acting from the next minute, as the path's next turn would.
      const pnl = paperPnl(fills.concat(newFills), settlements, st.tokens, st.marks, dayStart);
      st.pnl = { at: iso(t), day: r6(pnl.day), total: r6(pnl.total) };
      if (st.stopTotal === null && pnl.total <= -lim.lossTotal) {
        st.stopTotal = iso(t);
        report.stops.push(`loss_stop_total at ${iso(t)}: ${r6(pnl.total)}`);
        await db.upsert(T.events, [{ minute: iso(t), kind: "loss_stop_total", detail: { totalPnl: r6(pnl.total), limit: -lim.lossTotal } }], "minute,kind");
      }
      if (st.stopDay !== day && pnl.day <= -lim.lossDay) {
        st.stopDay = day;
        report.stops.push(`loss_stop_day at ${iso(t)}: ${r6(pnl.day)}`);
        await db.upsert(T.events, [{ minute: iso(t), kind: "loss_stop_day", detail: { dayPnl: r6(pnl.day), limit: -lim.lossDay } }], "minute,kind");
      }
    }
    if (minuteRows.length) await db.upsert(T.minutes, minuteRows, "minute,cond");
    if (newFills.length) await db.upsert(T.fills, newFills.map(rowOfFill), "cond,minute,print_id");
    fills.push(...newFills);
    st.lastDecided = to;
    report.minutes = (to - from) / M + 1; report.from = iso(from); report.to = iso(to);
  }

  // ── 2. the books of markets still held that the path does not quote today: their marks, once a minute ───────────
  const pnlNow = paperPnl(fills, settlements, st.tokens, st.marks, Math.floor(d.now / DAY) * DAY);
  const heldConds = Object.entries(st.tokens).filter(([c, tk]) => !settled.has(c) && (pnlNow.held[tk.yes] ?? 0) + (pnlNow.held[tk.no] ?? 0) > 0).map(([c]) => c);
  report.held = heldConds.length;
  if (heldConds.length) {
    const today = new Set((await db.select<{ cond: string }>(R.markets, `day=eq.${dayStr(d.now)}&select=cond&order=cond.asc`)).map((m) => m.cond));
    const watch = heldConds.filter((c) => !today.has(c));
    const have = watch.length ? await db.select(T.minutes, `minute=eq.${enc(iso(nowMinute))}&class=eq.held&select=cond&limit=1`) : [];
    if (watch.length && !have.length) {
      try {
        const books = await twice(() => pmBooks(watch.map((c) => st.tokens[c].yes), d.pm));
        const out: Record<string, unknown>[] = [];
        for (const c of watch) {
          const b = books.get(st.tokens[c].yes);
          if (!b || !b.bids.length || !b.asks.length) continue;
          out.push({ minute: iso(nowMinute), cond: c, class: "held", bb: b.bids[0][0], ba: b.asks[0][0], mark: (b.bids[0][0] + b.asks[0][0]) / 2, reward: 0, fills: 0, close_only: false, detail: {} });
        }
        if (out.length) await db.upsert(T.minutes, out, "minute,cond");
      } catch (e) { report.errors.push(`held books: ${msg(e)}`); }
    }
  }

  // ── 3. settlements: every ten minutes, a held market Gamma shows resolved ───────────────────────────────────────
  if (heldConds.length && d.now - st.statusAt >= RW_STATUS_EVERY_MS) {
    try {
      for (const m of await twice(() => pmMarkets(heldConds, true, d.pm))) {
        const tk = st.tokens[m.cond];
        if (!tk || settled.has(m.cond) || m.payout === null) continue;
        const s = { cond: m.cond, yes_token: tk.yes, no_token: tk.no, payout: m.payout, closed_time: m.closedTime, settled_at: iso(d.now), detail: { heldYes: pnlNow.held[tk.yes] ?? 0, heldNo: pnlNow.held[tk.no] ?? 0 } };
        await db.upsert(T.settlements, [s], "cond");
        await db.upsert(T.events, [{ minute: iso(nowMinute), kind: "settlement", detail: { cond: m.cond, payout: m.payout } }], "minute,kind");
        if (st.acc[m.cond]) st.acc[m.cond].settled = m.payout;
        report.settled++;
      }
      st.statusAt = d.now;
    } catch (e) { report.errors.push(`settlements: ${msg(e)}`); }
  }
  await saveState(d, T, st, report);
}

/**
 * Close every UTC day that ended before minute `t`: its formula rewards (and at R = 0.40), its fills' P&L by the path's
 * book-keeping at the day's end (the day's and the run's), its holdings at the mid, its minutes by class, and its stops.
 */
async function closeDays(d: PrepDeps, T: PrepInstance["tables"], st: PrepState, t: number, fills: PrepFill[], settlements: PmSettlement[], report: PrepReport) {
  while (t >= st.dayOf + DAY) {
    const day = dayStr(st.dayOf), end = st.dayOf + DAY;
    const pnl = paperPnl(fills, settlements, st.tokens, st.marks, st.dayOf, end);
    const reward = r6(st.day.reward), r40 = r6(st.day.reward * PREP_R_BREAK_EVEN);
    await d.db.upsert(T.days, [{
      day, reward, reward_r40: r40, fills_pnl_day: r6(pnl.day), fills_pnl_total: r6(pnl.total), pnl_day_r40: r6(pnl.day + r40), held_value: pnl.heldValue,
      fills: st.day.fills, minutes_matched: st.day.matched, minutes_dark: st.day.dark, minutes_diverged: st.day.diverged, minutes_missing: st.day.missing,
      stop_day: st.stopDay === day, stop_total: st.stopTotal !== null && st.stopTotal.slice(0, 10) <= day, markets: st.day.markets.length,
      detail: { markets: st.day.markets, startedAt: st.startedAt }, closed_at: iso(d.now),
    }], "day");
    report.days++;
    st.dayOf = end;
    st.day = newDay();
  }
}

async function saveState(d: PrepDeps, T: PrepInstance["tables"], st: PrepState, report: PrepReport) {
  await d.db.upsert(T.state, [{
    id: 1, state: st, last_minute: iso(st.lastDecided), updated_at: iso(d.now), last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null,
  }], "id");
}
