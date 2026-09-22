// One turn of the agents' loop, every minute from pg_cron. In order:
//
//   1. the market: both venues' public quotes for every symbol in play
//      (the basis between them recorded every fifth minute), the candle
//      series each rulebook reads from its signal venue — cached in
//      `agent_candles` and topped up with the venue's tail, so a minute's
//      turn costs a few small calls, not a history download — and the
//      execution venue's last closed 1-minute candle for paper fills;
//   2. open orders: a `pending` row (written before a live order was
//      sent) is reconciled against the venue's active orders by client
//      id; a paper order fills if the venue's last minute traded through
//      its price (and pays that venue's maker fee); a live order is
//      re-read from the venue; an unfilled resting order whose touch has
//      moved away is re-quoted at the new touch, a few times, then
//      dropped — an order chased forever is a market order in disguise;
//   3. the book: positions and today's P&L per venue and mode, derived
//      from fills, never stored;
//   4. protective stops, EVERY minute, against the live mark: a hard
//      floor under cost, on every rule. The one action taken between bar
//      closes, and only ever an exit. There is NO intra-bar ATR trail
//      since 2026-09-21: it was the rulebook's own trail evaluated on
//      wicks instead of closes, and it pre-empted the rulebook on 48 of
//      49 protective exits in one walk-forward window (§3.13);
//   5. observations, EVERY minute: the categorical state on the forming
//      bar, written down when it changes — how the page shows what the
//      market is doing between decisions without a single order;
//   6. decisions, on a NEWLY closed bar of the rule's own size (an hour,
//      four hours, a day; a minute for the dislocation rule) and with no
//      order in flight: build the state, ask Jev, apply the rulebook,
//      apply the risk gate, CLAIM the bar by inserting the decision — a
//      unique index makes a second claim fail, so two overlapping ticks
//      cannot both order — and place the order it allows: marketable at
//      the touch on Revolut X (9 bps, the backtest's fill), post-only at
//      the touch on Kraken (its taker fee is not worth the certainty).
//
// A strategy row names where it trades (`venue`) and where its candles
// come from (`signal_venue`): the Revolut X rows read Kraken's candles,
// the deeper book, and fill on Revolut X, the free maker. Paper fills pay
// the execution venue's real maker fee, so the Kraken twins measure what
// its fee costs against the same signal.
//
// Everything the decision saw and everything the venue said is written
// down. Positions and P&L are never stored: `positionFromFills` derives
// them from the filled orders every time they are needed, so there is
// exactly one implementation of "what do we hold and what has it made".
//
// One turn at a time: pg_net fires the next minute's call whether or not
// this one has finished, so a turn takes a lease (`agent_locks`, a
// compare-and-set on its expiry) and a turn that finds it held does
// nothing. The bar claim below still protects decisions on its own.
//
// What the loop refuses to guess. A `pending` row the venue does not list
// is left pending and reported every turn with the venue's balance beside
// the record — a marketable order fills or dies inside the turn, so its
// absence from the active list proves nothing, and a person settles it from
// the venue's history. A cancelled order that cannot be read back stays
// open for the next turn to settle from the venue. A decision whose order
// never reached the book (no pair config, a size under the venue minimum,
// the confirmation or the credentials missing) is placed on a later turn:
// the claim stays with the decision, and the unique index on (decision,
// attempt) from migration 0041 makes two turns' retries one order. A turn
// that runs long stops opening bar decisions past its budget and never
// releases a lease another turn has since taken.
//
// A live order needs THREE things at once: the strategy row says `live`,
// `agent_risk.live_confirmed_at` is set, and the risk gate allows it —
// plus credentials for that venue. Paper needs the gate only. The caps in
// `agent_risk` are per venue account and per mode.

import { askJev, type JevEnv, type JevResult, type Questions } from "../_shared/jev.ts";
import {
  atrAt, buildSnapshot, ceilToStep, combineDecision, DEFAULT_DISLOCATION, DEFAULT_ROTATION, DEFAULT_TREND, dislocationQuestions, dislocationState,
  floorToStep, highWaterSince, jevQuestions, positionFromFills, protectiveExit, riskGate, rotationTargets, ruleDecisionDislocation, ruleFor, sizeBase,
  unrealisedUsd,
  type Action, type Candle, type DislocationParams, type JevView, type PairConfig, type Position, type RankView, type RotationParams,
  type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { paperFeeUsd, type Quote, type Venue, type VenueId } from "../_shared/venue.ts";
import type { Db } from "./db.ts";

export const TICK_MS = 60e3;                      // the cron cadence
export const REQUOTE_AFTER_MS = 3 * 60e3;         // an unfilled resting order older than this may be re-quoted …
export const REQUOTE_MOVE_BPS = 5;                // … when the touch has moved this far from it
export const MAX_REQUOTES = 5;                    // then the decision lapses until the next bar
export const MAX_ORDER_AGE_MS = 60 * 60e3;        // nothing rests longer than an hour
export const LEASE_MS = 55e3;                     // one turn holds the tick lease this long at most (under the cron minute)
export const REENTRY_BARS = 2;                    // after ANY exit, no entry for this many of the rule's own bars
export const TURN_BUDGET_MS = Math.round(LEASE_MS * 0.7);   // past this, no NEW bar decision is opened this turn (a Jev round trip is up to 16 s)
export const PROTECTIVE_CLAIM_OFFSET_MS = 1000;   // a protective decision claims one second INTO its minute: a bar starts on the minute, so the two never collide
export const PROBE_TTL_MS = 4 * 3600e3;           // a maker probe watches for one 4-hour bar, then expires unfilled
export const PROBE_FOLLOW_UP_MS = [15 * 60e3, 60 * 60e3];   // and the mark is recorded this long after it resolved — that gap IS the adverse selection
export const WIDE_SPREAD_BPS = 50;                // above this the book is too wide to CROSS for a new position — see `exitMark`
const ONE_M = 60e3, ONE_H = 3600e3, FOUR_H = 4 * 3600e3, ONE_D = 86400e3;
const DAILY_BARS = 130;                           // SMA 100 + the 30-day lookback, with room
const SIGNAL_BARS = 210;                          // SMA 100 + breakout 55, with room

export type StrategyRow = {
  id: string; kind: StrategyKind; venue: VenueId; signal_venue: VenueId; name: string; symbols: string[]; mode: "paper" | "live" | "paused";
  capital_usd: number; params: Record<string, number | boolean>;
  /** Set by a migration when a row is retired (`0038`, `0043`). Such a row never buys; if it still
   *  holds a position its exits keep running until it is flat. */
  retired_at?: string | null;
};
export type RiskRow = {
  global_pause: boolean; max_order_usd: number; max_exposure_usd: number; paper_exposure_usd: number | null; daily_loss_limit_usd: number;
  max_orders_per_day: number; live_confirmed_at: string | null;
};
export type OrderRow = {
  id: number; ts: string; strategy_id: string; decision_id: number | null; venue: VenueId; symbol: string; mode: "paper" | "live"; side: "buy" | "sell";
  price: number; base_size: number; client_order_id: string; venue_order_id: string | null; state: string;
  filled_base: number; avg_fill_price: number | null; fee_usd: number; requotes: number; filled_at: string | null;
  request?: { marketable?: boolean } | null;
};

export type TickDeps = {
  db: Db;
  venues: Partial<Record<VenueId, Venue>>;
  jev: JevEnv;
  now: number;
  fetchImpl?: typeof fetch;
  uuid: () => string;
  /** Wall clock for the turn budget and the lease renewal; injectable so a test can make a turn run long. */
  clock?: () => number;
};

export type TickReport = {
  at: string; strategies: number; markets: string[];
  basis: Record<string, number>;
  observations: number;
  decisions: { strategy: string; venue: VenueId; symbol: string; action: Action; reason: string; provider: string; allowed: boolean; kind: "bar" | "protective" }[];
  orders: { strategy: string; venue: VenueId; symbol: string; mode: string; side: string; price: number; base: number; state: string }[];
  settled: { id: number; state: string }[];
  /** Maker probes touched this turn (`0042`): never orders, never in any book. */
  probes: { opened: number; filled: number; expired: number; followedUp: number };
  /** Retired rows that still hold a position: their exits keep running, they can never buy. */
  windingDown: string[];
  skipped: string[];
  errors: string[];
};

type Market = { c1m: Candle | null; mark: number | null; quote?: Quote; pair?: PairConfig };   // mark null when neither a quote nor a candle gave one — never 0
type Signal = { bars: Candle[]; barMs: number; c1d: Candle[] };

const mk = (venue: string, symbol: string) => `${venue}|${symbol}`;
/**
 * What the loop gates on, read out of one model reply: P(healthy), the caution score, and whether the model
 * echoed the symbol it was shown. ONE implementation — the tick gates on it and `?action=jev` measures it, and
 * a measurement read differently from the gate would be measuring something the gate never sees.
 */
export function jevViewOf(jr: JevResult, symbol: string): JevView {
  const a = jr.answers;
  return {
    healthy: a.healthy_trend?.type === "noul" ? a.healthy_trend.probability : null,
    caution: a.caution?.type === "score" ? a.caution.score : null,
    echoOk: a._state?.type === "choice" ? a._state.choice === symbol : false,
    provider: jr.provider,
  };
}
/** A position's identity: the rulebook, the coin, and the MODE its fills were in — paper money and real coins are two books, never one. */
export const posKey = (strategyId: string, symbol: string, mode: string) => `${strategyId}|${symbol}|${mode}`;
/** A state as one comparable string: jsonb hands keys back in its own order, so a plain stringify never matches what was written. */
export const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const enc = encodeURIComponent;

/** The decision bar of a rulebook. */
export function decisionBarMs(kind: StrategyKind): number {
  return kind === "trend-4h" ? FOUR_H : kind === "trend-1h" ? ONE_H : kind === "dislocation-1m" ? ONE_M : ONE_D;
}
/** The candle series the rulebook's state is built from (the trend rules read their own bar; the daily rules read 4h; dislocation reads 1h for volatility only). */
export function stateBarMs(kind: StrategyKind): number {
  return kind === "trend-1h" || kind === "dislocation-1m" ? ONE_H : FOUR_H;
}

/** The last CLOSED candle's index for a series of `spanMs` candles at `now`. */
export function lastClosedIndex(series: Candle[], spanMs: number, now: number): number {
  let i = series.length - 1;
  while (i >= 0 && series[i].start + spanMs > now) i--;
  return i;
}

/**
 * Today's P&L for the daily loss breaker, over the rows given (one venue
 * and mode at a time): realised since the day began, plus the CHANGE in
 * unrealised since the day began — a position opened last week counts
 * only what it did today, marked from the day's opening price.
 */
export function dayPnl(allFilled: OrderRow[], marks: Record<string, number>, dayOpen: Record<string, number>, dayStartMs: number): number {
  let out = 0;
  const groups = new Map<string, OrderRow[]>();
  for (const o of allFilled) {
    const k = `${o.strategy_id}|${o.symbol}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }
  for (const [k, rows] of groups) {
    const sym = k.split("|")[1];
    const fills = rows.map(toFill);
    const now = positionFromFills(fills);
    const before = positionFromFills(fills.filter((f) => f.ts < dayStartMs));
    const mark = marks[sym] || now.avgCost;         // a missing OR zero mark falls back to cost: 0 is not a price, and a $100 book marked at 0 would read as a $100 loss
    const open = dayOpen[sym] || mark;
    out += (now.realisedUsd - before.realisedUsd) + (unrealisedUsd(now, mark) - unrealisedUsd(before, open));
  }
  return out;
}

export function toFill(o: OrderRow) {
  return {
    ts: new Date(o.filled_at ?? o.ts).getTime(), side: o.side,
    base: Number(o.filled_base || o.base_size), price: Number(o.avg_fill_price ?? o.price), feeUsd: Number(o.fee_usd || 0),
  };
}

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

function trendParamsOf(row: StrategyRow): TrendParams {
  const p = row.params ?? {};
  return {
    fast: num(p.fast, DEFAULT_TREND.fast), slow: num(p.slow, DEFAULT_TREND.slow), breakoutUp: num(p.breakoutUp, DEFAULT_TREND.breakoutUp),
    breakoutDown: num(p.breakoutDown, DEFAULT_TREND.breakoutDown), atrN: num(p.atrN, DEFAULT_TREND.atrN), atrStop: num(p.atrStop, DEFAULT_TREND.atrStop), volN: num(p.volN, DEFAULT_TREND.volN),
  };
}
function rotationParamsOf(row: StrategyRow): RotationParams {
  const p = row.params ?? {};
  return {
    lookbackDays: num(p.lookbackDays, DEFAULT_ROTATION.lookbackDays), topN: num(p.topN, DEFAULT_ROTATION.topN), slowDays: num(p.slowDays, DEFAULT_ROTATION.slowDays),
    bearFilter: bool(p.bearFilter, DEFAULT_ROTATION.bearFilter), minHoldDays: num(p.minHoldDays, DEFAULT_ROTATION.minHoldDays),
  };
}
function dislocationParamsOf(row: StrategyRow): DislocationParams {
  const p = row.params ?? {};
  return {
    entryBps: num(p.entryBps, DEFAULT_DISLOCATION.entryBps), exitBps: num(p.exitBps, DEFAULT_DISLOCATION.exitBps), maxHoldMin: num(p.maxHoldMin, DEFAULT_DISLOCATION.maxHoldMin),
    stopBps: num(p.stopBps, DEFAULT_DISLOCATION.stopBps), sharpMoveBps: num(p.sharpMoveBps, DEFAULT_DISLOCATION.sharpMoveBps),
    cooldownMin: num(p.cooldownMin, DEFAULT_DISLOCATION.cooldownMin),
  };
}

type CandleRow = { start: string; open: number; high: number; low: number; close: number; volume: number };

/**
 * A candle series from the cache plus the venue's tail. When the cache is
 * warm (enough rows, newest within three bars) only candles from the
 * newest stored one onward are fetched; otherwise the whole window is.
 * The forming candle is included and refreshed every turn.
 */
async function loadSeries(d: TickDeps, venue: Venue, symbol: string, intervalMin: number, count: number): Promise<Candle[]> {
  const spanMs = intervalMin * 60e3;
  const stored = await d.db.select<CandleRow>("agent_candles",
    `venue=eq.${venue.id}&symbol=eq.${enc(symbol)}&interval_min=eq.${intervalMin}&select=start,open,high,low,close,volume&order=start.desc&limit=${count}`);
  const have: Candle[] = stored.map((r) => ({ start: Date.parse(r.start), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }))
    .sort((a, b) => a.start - b.start);
  const newest = have.at(-1)?.start ?? 0;
  // Warm means complete: a gap in the middle (a venue outage, a failed turn) would otherwise stay forever, and every indicator
  // indexes by position, so a 100-bar average would quietly span 104 bars. Hour bars and up must be contiguous; minutes may
  // legitimately skip (no trade, no candle) and are not held to it.
  const contiguous = spanMs < ONE_H || have.every((c, j) => j === 0 || c.start - have[j - 1].start === spanMs);
  const warm = have.length >= count - 2 && newest >= d.now - 3 * spanMs && contiguous;
  const since = warm ? newest - spanMs : d.now - count * spanMs;
  const tail = await venue.candles(symbol, intervalMin, since, d.now);
  const byStart = new Map<number, Candle>(have.map((c) => [c.start, c]));
  for (const c of tail) byStart.set(c.start, c);
  const merged = [...byStart.values()].sort((a, b) => a.start - b.start).slice(-count);
  if (tail.length) {
    await d.db.upsert("agent_candles", tail.map((c) => ({
      venue: venue.id, symbol, interval_min: intervalMin, start: new Date(c.start).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    })), "venue,symbol,interval_min,start");
  }
  return merged;
}

export async function tick(d: TickDeps): Promise<TickReport> {
  const report: TickReport = { at: new Date(d.now).toISOString(), strategies: 0, markets: [], basis: {}, observations: 0, decisions: [], orders: [], settled: [], probes: { opened: 0, filled: 0, expired: 0, followedUp: 0 }, windingDown: [], skipped: [], errors: [] };
  const nowIso = new Date(d.now).toISOString();
  const holder = `${nowIso} ${d.uuid()}`;
  const held = await d.db.claim<{ name: string }>("agent_locks", `name=eq.tick&lease_until=lt.${enc(nowIso)}`, { lease_until: new Date(d.now + LEASE_MS).toISOString(), holder });
  if (!held.length) { report.skipped.push("another tick holds the lease; nothing done this minute"); return report; }
  try {
    await turn(d, report, nowIso, holder);
  } finally {
    // Released by its holder only: a turn that overran its lease must not free the lease the NEXT turn has since taken —
    // one overrun would otherwise cascade into every later turn overlapping its successor.
    try { await d.db.update("agent_locks", `name=eq.tick&holder=eq.${enc(holder)}`, { lease_until: nowIso, holder: null }); } catch (e) { report.errors.push(`lease release: ${msg(e)}`); }
  }
  return report;
}

/**
 * The maker probe (migration `0042`). Revolut X is 0 % maker and 0.09 % taker and the loop
 * takes the touch, so the standing question is whether resting instead would be free money.
 * §3.13 could not answer it: on a breakout rule a resting bid fills exactly when the breakout
 * fails, and the backtest — Coinbase candles, synthetic bid and ask — says the bid fills with
 * a median delay of zero hours, which is the model's limit rather than a measurement. So every
 * time the loop crosses the touch it writes down where a resting order WOULD have sat, and
 * then watches the real book: did the market come back to that price, when, and where did it
 * go afterwards. A probe is never an order. Nothing reads it into a position, a book, an
 * exposure or a P&L.
 */
export type ProbeRow = {
  id: number; ts: string; strategy_id: string; venue: VenueId; symbol: string; side: "buy" | "sell";
  taker_price: string | number; maker_price: string | number; state: string;
  resolved_at: string | null; follow_up: Record<string, number> | null; expires_at: string; watching: boolean;
};

/**
 * Has the market come back to where a resting order would have sat? A buy fills when the
 * minute traded at or below it, a sell at or above — the same test `paperFill` applies to a
 * resting paper order, against the execution venue's own last closed minute.
 */
export function probeFilled(side: "buy" | "sell", makerPrice: number, c: Candle | null): boolean {
  if (!c) return false;
  return side === "buy" ? c.low <= makerPrice : c.high >= makerPrice;
}

/**
 * Which follow-up mark is due, if any: the first offset in `PROBE_FOLLOW_UP_MS` that has
 * elapsed since the probe resolved and is not already recorded. Returns the key to write
 * (`m15`, `m60`) or null. A probe that resolved long ago catches up one offset per turn,
 * which is why this returns the EARLIEST outstanding one rather than the latest due.
 */
export function probeFollowUpDue(resolvedAtMs: number, have: Record<string, number> | null, nowMs: number): string | null {
  for (const ms of PROBE_FOLLOW_UP_MS) {
    const key = `m${Math.round(ms / 60e3)}`;
    if (have && key in have) continue;
    if (nowMs - resolvedAtMs >= ms) return key;
    return null;                                   // offsets are ascending: nothing later can be due either
  }
  return null;
}

/**
 * The price a LONG position's stop should be judged at: the bid, not the mid.
 *
 * The stop has always been checked against the mid and then filled at the bid (§4.11, and the
 * backtester reads each bar's low), which is half a spread of wishful thinking — 0.75 bps on BTC,
 * but 21 on SUI, and unbounded if the book ever goes wide. A stop exists to say "this position is
 * down far enough to close", and the only price that answers that is the one it can actually be
 * closed at. Judging on the mid says a position is above its floor while the money available for
 * it is below: the stop fires late, into a worse price, exactly when the book is worst.
 *
 * With no quote there is nothing to be conservative with and the candle mark stands.
 */
export function exitMark(m: { mark: number | null; quote?: Quote }): number | null {
  return m.quote ? m.quote.bid : m.mark;
}

/** The book's width in bps, or null with no quote. Used to refuse a CROSSING entry, never an exit. */
export function spreadBps(q: Quote | undefined): number | null {
  if (!q || !(q.bid > 0) || !(q.ask > 0)) return null;
  return (q.ask - q.bid) / ((q.ask + q.bid) / 2) * 1e4;
}

/** The position with its high-water trailed to the market: the fills' own high never rises, and a stop or a state word read from it would not trail. */
function trailed(pos: Position, bars: Candle[], lastClosedIdx: number): Position {
  if (pos.base <= 0) return pos;
  const hw = highWaterSince(pos, bars, lastClosedIdx);
  return hw == null ? pos : { ...pos, highWater: hw };
}

async function turn(d: TickDeps, report: TickReport, nowIso: string, holder: string): Promise<void> {
  const clock = d.clock ?? (() => Date.now());
  const started = clock();
  const elapsed = () => clock() - started;
  const overBudget = () => elapsed() > TURN_BUDGET_MS;
  let renewedAt = 0;
  /**
   * Keep the lock while this turn finishes, so the next cron minute skips rather than overlaps. It used to
   * renew exactly ONCE, which bounded a turn at about half a lease plus a lease — past that the lock expired
   * under a turn still placing orders and the next minute ran beside it. It now renews whenever the lease is
   * more than half gone, so a slow database or a long venue call extends the lock instead of losing it.
   */
  const renewLease = async () => {
    const now = clock();
    if (now - renewedAt < LEASE_MS / 2) return;
    renewedAt = now;
    try { await d.db.update("agent_locks", `name=eq.tick&holder=eq.${enc(holder)}`, { lease_until: new Date(clock() + LEASE_MS).toISOString() }); }
    catch (e) { report.errors.push(`lease renewal: ${msg(e)}`); }
  };
  const [riskRows, strategies, open, probes] = await Promise.all([
    d.db.select<RiskRow>("agent_risk", "id=eq.1&select=*"),
    // Retired rows are read too, because a retired row can still HOLD something — see the
    // winding-down gate after the book is derived. A row that is retired AND flat is skipped
    // there, so this costs one row read and nothing else.
    d.db.select<StrategyRow>("agent_strategies", "mode=in.(paper,live,paused)&select=*&order=id.asc"),
    d.db.selectAll<OrderRow>("agent_orders", "state=in.(pending,new,partially_filled)&select=*&order=id.asc"),
    // Maker probes still being watched (`0042`): resting ones waiting for the market to come
    // back, and resolved ones whose follow-up marks are not all in yet. A handful of rows.
    d.db.select<ProbeRow>("agent_maker_probes", "watching=eq.true&select=*"),
  ]);
  const risk = riskRows[0];
  if (!risk) { report.errors.push("agent_risk row missing"); return; }
  report.strategies = strategies.length;

  // 1. the market ---------------------------------------------------------
  const symbols = new Set<string>();
  const execWanted = new Map<VenueId, Set<string>>();
  const signalWanted = new Map<string, { venue: VenueId; symbol: string; barMs: number }>();
  const want = (m: Map<VenueId, Set<string>>, v: VenueId, s: string) => { if (!m.has(v)) m.set(v, new Set()); m.get(v)!.add(s); };
  for (const s of strategies) {
    for (const sym of s.symbols) {
      symbols.add(sym);
      want(execWanted, s.venue, sym);
      const barMs = stateBarMs(s.kind);
      signalWanted.set(`${s.signal_venue}|${sym}|${barMs}`, { venue: s.signal_venue, symbol: sym, barMs });
      if (s.kind === "dislocation-1m") signalWanted.set(`${s.signal_venue}|${sym}|${ONE_M}`, { venue: s.signal_venue, symbol: sym, barMs: ONE_M });
    }
  }
  for (const o of open) { symbols.add(o.symbol); want(execWanted, o.venue, o.symbol); }

  // Both venues' quotes for every symbol: the touch for orders, the mark for P&L, the basis for the record.
  const quotes: Partial<Record<VenueId, Record<string, Quote>>> = {};
  for (const vid of ["revx", "kraken"] as VenueId[]) {
    const venue = d.venues[vid];
    if (!venue) continue;
    try { quotes[vid] = await venue.quotes([...symbols]); } catch (e) { report.errors.push(`${vid}: quotes ${msg(e)}`); }
  }
  const basisRows: Record<string, unknown>[] = [];
  for (const sym of symbols) {
    const r = quotes.revx?.[sym], k = quotes.kraken?.[sym];
    if (!r || !k) continue;
    const bps = ((r.bid + r.ask) / 2 - (k.bid + k.ask) / 2) / ((k.bid + k.ask) / 2) * 1e4;
    report.basis[sym] = Math.round(bps * 100) / 100;
    basisRows.push({ ts: nowIso, symbol: sym, revx_bid: r.bid, revx_ask: r.ask, kraken_bid: k.bid, kraken_ask: k.ask, basis_bps: report.basis[sym] });
  }
  if (basisRows.length && Math.floor(d.now / ONE_M) % 5 === 0) {
    try { await d.db.upsert("agent_basis", basisRows, "ts,symbol"); } catch (e) { report.errors.push(`basis: ${msg(e)}`); }
  }

  // The execution venue's last closed minute has ONE reader: a paper order resting at a price, which fills when the minute
  // trades through it. It is fetched only where such an order rests (or where no quote gave a mark) — every other call would
  // be spent from Revolut X's one-token-a-second public budget for nothing, and paid for in seconds of turn time.
  const needsMinute = new Set<string>();
  for (const o of open) if (o.mode === "paper" && !o.request?.marketable) needsMinute.add(mk(o.venue, o.symbol));
  // A resting maker probe reads the same minute for the same reason: it is asking whether the
  // market traded through a price. It adds a call only on a symbol the loop has just traded.
  for (const p of probes) if (p.state === "resting") needsMinute.add(mk(p.venue, p.symbol));
  const markets = new Map<string, Market>();
  for (const [vid, syms] of execWanted) {
    const venue = d.venues[vid];
    if (!venue) { report.errors.push(`${vid}: venue not configured`); continue; }
    let pairs: Record<string, PairConfig> = {};
    try { pairs = await venue.pairs([...syms]); } catch (e) { report.errors.push(`${vid}: pairs ${msg(e)}`); }
    for (const sym of syms) {
      try {
        const q = quotes[vid]?.[sym];
        const m1 = needsMinute.has(mk(vid, sym)) || !q ? await venue.candles(sym, 1, d.now - 3 * ONE_M, d.now) : [];
        const closed = m1.filter((c) => c.start + ONE_M <= d.now);
        const mark = q ? (q.bid + q.ask) / 2 : closed.at(-1)?.close ?? null;
        markets.set(mk(vid, sym), { c1m: closed.at(-1) ?? null, mark, quote: q, pair: pairs[sym] });
        report.markets.push(mk(vid, sym));
      } catch (e) {
        report.errors.push(`${vid} ${sym}: 1m candles ${msg(e)}`);
      }
    }
  }

  const signals = new Map<string, Signal>();
  const dailyBy = new Map<string, Candle[]>();     // `${venue}|${symbol}` → daily series, loaded once
  for (const [key, w] of signalWanted) {
    const venue = d.venues[w.venue];
    if (!venue) { report.errors.push(`${w.venue}: signal venue not configured`); continue; }
    try {
      const intervalMin = w.barMs / 60e3;
      const bars = await loadSeries(d, venue, w.symbol, intervalMin, w.barMs === ONE_M ? 30 : SIGNAL_BARS);
      const dk = mk(w.venue, w.symbol);
      if (!dailyBy.has(dk)) dailyBy.set(dk, await loadSeries(d, venue, w.symbol, 1440, DAILY_BARS));
      signals.set(key, { bars, barMs: w.barMs, c1d: dailyBy.get(dk)! });
    } catch (e) {
      report.errors.push(`${w.venue} ${w.symbol}: candles ${msg(e)}`);
    }
  }
  const signalFor = (s: StrategyRow, sym: string) => signals.get(`${s.signal_venue}|${sym}|${stateBarMs(s.kind)}`);
  const minuteFor = (s: StrategyRow, sym: string) => signals.get(`${s.signal_venue}|${sym}|${ONE_M}`);

  // 2. open orders --------------------------------------------------------
  const inFlight = new Set<string>();
  /** Of those, the ones that are SELLS. A stop must never place a second sell over one it cannot see or cancel; a BUY it may simply sell past. */
  const inFlightSells = new Set<string>();
  const holdInFlight = (key: string, side: string) => { inFlight.add(key); if (side === "sell") inFlightSells.add(key); };
  const requoteWanted: { o: OrderRow; touch: number }[] = [];
  const settledIds = new Set<number>();            // rows this turn closed: no longer risk
  const settle = async (o: OrderRow, patch: Record<string, unknown>, state: string) => {
    await d.db.update("agent_orders", `id=eq.${o.id}`, { ...patch, state, updated_at: nowIso });
    settledIds.add(o.id);
    report.settled.push({ id: o.id, state });
  };
  const resting = new Map<string, OrderRow>();     // `${strategy}|${symbol}` → an order still resting after this turn's settlement
  /**
   * Take a resting order off the book. Live: the venue cancels, then says
   * what filled before the cancel landed — that is the venue's to say, and
   * a fill wins over the cancel. If the order cannot be read back after the
   * cancel, the row stays OPEN: the cancel is done and cannot be undone, so
   * settling the row blind would write "nothing filled" over a fill the
   * venue may have made; the next turn reads the order and settles it from
   * the venue's own view. Paper: the row is closed.
   */
  const cancelOrder = async (o: OrderRow, why: string): Promise<"cancelled" | "filled" | "failed"> => {
    const key = `${o.strategy_id}|${o.symbol}`;
    const venue = d.venues[o.venue];
    if (o.mode === "live") {
      if (!venue?.canTrade || !o.venue_order_id) { report.errors.push(`${key}: ${why}, but no ${o.venue} credentials to cancel ${o.client_order_id}`); return "failed"; }
      const c = await venue.cancel(o.venue_order_id);
      if (!c.ok) { report.errors.push(`${key}: cancel ${o.venue_order_id} → ${c.error}`); return "failed"; }
      const after = await venue.order(o.venue_order_id);
      if (!after.ok) { report.errors.push(`${key}: cancelled ${o.venue_order_id} but could not read it back (${after.error}); left open for the next turn to settle from the venue`); return "failed"; }
      if (after.view.filledBase > 0) {
        await settle(o, { filled_base: after.view.filledBase, avg_fill_price: after.view.avgPrice ?? o.price, fee_usd: after.view.feeUsd, filled_at: nowIso, cancelled_at: nowIso, response: after.view.raw }, "filled");
        return "filled";
      }
    }
    await settle(o, { cancelled_at: nowIso, response: { cancelled: why } }, "cancelled");
    return "cancelled";
  };
  const activeByVenue = new Map<VenueId, Record<string, { venueOrderId: string; view: { state: string; filledBase: number; avgPrice: number | null; feeUsd: number; raw: unknown } }>>();
  for (const o of open) {
    const key = `${o.strategy_id}|${o.symbol}`;
    const venue = d.venues[o.venue];
    const m = markets.get(mk(o.venue, o.symbol));
    try {
      const ageMs = d.now - new Date(o.ts).getTime();
      if (o.state === "pending") {
        // Written before the venue was called; the reply never landed. Ask the venue whether it has the order.
        if (ageMs < TICK_MS) { holdInFlight(key, o.side); continue; }            // still this turn's; leave it
        if (!venue?.canTrade) { report.errors.push(`${key}: pending live order and no ${o.venue} credentials to reconcile it`); holdInFlight(key, o.side); continue; }
        if (!activeByVenue.has(o.venue)) {
          const a = await venue.activeOrders();
          if (!a.ok) { report.errors.push(`${key}: active orders ${a.error}`); holdInFlight(key, o.side); continue; }
          activeByVenue.set(o.venue, a.byClientId);
        }
        const found = activeByVenue.get(o.venue)![o.client_order_id];
        if (found) {
          await d.db.update("agent_orders", `id=eq.${o.id}`, { state: found.view.state, venue_order_id: found.venueOrderId, filled_base: found.view.filledBase, avg_fill_price: found.view.avgPrice, fee_usd: found.view.feeUsd, response: { reconciled: true, view: found.view.raw }, updated_at: nowIso });
          report.settled.push({ id: o.id, state: `reconciled:${found.view.state}` });
          holdInFlight(key, o.side);
          continue;
        }
        // Not resting at the venue, and no reply on record: the outcome is UNKNOWN. A marketable IOC order — every Revolut X
        // order — fills or dies inside the turn, so absence from the active list proves nothing; a post-only bid at the touch
        // can be lifted seconds after it rests. Nothing here guesses. The row stays `pending`: it keeps the pair in flight and
        // counts as exposure, and it is reported every turn, with the venue's balance beside what the record says is held,
        // until a person settles it from the venue's own history (write the fill in, or mark it rejected).
        let heldNote = "";
        try {
          const bal = await venue.balances();
          const asset = o.symbol.split("/")[0];
          const known = positionFromFills((await d.db.selectAll<OrderRow>("agent_orders",
            `venue=eq.${o.venue}&mode=eq.live&symbol=eq.${enc(o.symbol)}&state=in.(filled,partially_filled)&select=*&order=ts.asc,id.asc`)).map(toFill)).base;
          heldNote = `; ${o.venue} holds ${bal[asset] ?? 0} ${asset} against ${known} on record`;
        } catch (e) { heldNote = `; balances unreadable (${msg(e)})`; }
        report.errors.push(`${key}: pending ${o.side} ${o.base_size} ${o.symbol} (${o.client_order_id}) is not among ${o.venue}'s active orders ${Math.round(ageMs / 60e3)} min on — outcome unknown; the row stays pending for a person to settle from the venue's history${heldNote}`);
        holdInFlight(key, o.side);
        continue;
      }
      const marketable = !!o.request?.marketable;
      if (o.mode === "paper") {
        const c = m?.c1m;
        // A marketable order fills at its price at once; a resting one when the last minute traded through it.
        const hit = marketable || (c && (o.side === "buy" ? c.low <= Number(o.price) : c.high >= Number(o.price)));
        if (hit) {
          const bps = marketable ? (venue?.feeBps.taker ?? 0) : (venue?.feeBps.maker ?? 0);
          const fee = paperFeeUsd(Number(o.base_size), Number(o.price), { maker: bps });
          await settle(o, {
            filled_base: o.base_size, avg_fill_price: o.price, fee_usd: fee, filled_at: c ? new Date(c.start + ONE_M).toISOString() : nowIso,
            response: { paperFillCandle: c, feeBps: bps, marketable },
          }, "filled");
          continue;
        }
      } else if (venue?.canTrade && o.venue_order_id) {
        const v = await venue.order(o.venue_order_id);
        if (!v.ok) {
          report.errors.push(`${key}: order lookup ${v.error}`);
        } else {
          const view = v.view;
          if (view.state === "filled") {
            await settle(o, { filled_base: view.filledBase || o.base_size, avg_fill_price: view.avgPrice ?? o.price, fee_usd: view.feeUsd, filled_at: nowIso, response: view.raw }, "filled");
            continue;
          }
          if (view.state === "cancelled" || view.state === "rejected") {
            // A cancel after a partial fill is a FILL of what filled — an IOC that took part of the ask is the usual case.
            if (view.filledBase > 0) await settle(o, { filled_base: view.filledBase, avg_fill_price: view.avgPrice ?? o.price, fee_usd: view.feeUsd, filled_at: nowIso, cancelled_at: nowIso, response: view.raw }, "filled");
            else await settle(o, { cancelled_at: nowIso, response: view.raw }, view.state);
            continue;
          }
          if (view.state === "partially_filled" && (o.state !== "partially_filled" || Number(o.filled_base) !== view.filledBase)) {
            await d.db.update("agent_orders", `id=eq.${o.id}`, { state: "partially_filled", filled_base: view.filledBase, avg_fill_price: view.avgPrice, fee_usd: view.feeUsd, response: view.raw, filled_at: o.filled_at ?? nowIso, updated_at: nowIso });
          }
        }
      }
      // Re-quote or drop a resting order the market has walked away from.
      const q = m?.quote;
      const touch = q ? (o.side === "buy" ? q.bid : q.ask) : null;
      const movedBps = touch ? Math.abs(touch - Number(o.price)) / Number(o.price) * 1e4 : 0;
      const tooOld = ageMs >= MAX_ORDER_AGE_MS;
      const stale = ageMs >= REQUOTE_AFTER_MS && movedBps >= REQUOTE_MOVE_BPS;
      if (tooOld || stale) {
        const c = await cancelOrder(o, stale && !tooOld ? `touch moved ${movedBps.toFixed(1)} bps` : "too old");
        if (c === "failed") { holdInFlight(key, o.side); continue; }
        if (c === "cancelled" && stale && !tooOld && Number(o.requotes ?? 0) < MAX_REQUOTES && touch) { requoteWanted.push({ o, touch }); holdInFlight(key, o.side); }
        continue;
      }
      holdInFlight(key, o.side);
      resting.set(key, o);
    } catch (e) {
      report.errors.push(`${key}: settle ${msg(e)}`);
      holdInFlight(key, o.side);
    }
  }

  // 2b. maker probes — the adverse-selection notebook (`0042`) ------------
  // Never an order, never a position, never in any book or P&L. Two jobs a turn: resolve the
  // resting ones against the execution venue's last closed minute, and fill in the follow-up
  // marks that have come due. A probe that fails here costs the turn nothing.
  for (const p of probes) {
    const m = markets.get(mk(p.venue, p.symbol));
    try {
      if (p.state === "resting") {
        const maker = Number(p.maker_price);
        const startedMs = Date.parse(p.ts);
        if (probeFilled(p.side, maker, m?.c1m ?? null)) {
          await d.db.update("agent_maker_probes", `id=eq.${p.id}`, {
            state: "filled", resolved_at: nowIso, mark_at_resolve: m?.mark ?? null,
            minutes_to_fill: Math.max(0, Math.round((d.now - startedMs) / ONE_M)),
          });
          report.probes.filled++;
        } else if (d.now >= Date.parse(p.expires_at)) {
          await d.db.update("agent_maker_probes", `id=eq.${p.id}`, {
            state: "expired", resolved_at: nowIso, mark_at_resolve: m?.mark ?? null,
            minutes_to_fill: null,
          });
          report.probes.expired++;
        }
        continue;
      }
      // Resolved: record the mark at each follow-up offset as it comes due. The gap between
      // that mark and `maker_price` is the number §3.13 needed and could not compute.
      if (!p.resolved_at || m?.mark == null) continue;
      const key = probeFollowUpDue(Date.parse(p.resolved_at), p.follow_up, d.now);
      if (!key) continue;
      const follow_up = { ...(p.follow_up ?? {}), [key]: m.mark };
      // The last offset in the list closes the probe: nothing reads it again.
      const last = `m${Math.round(PROBE_FOLLOW_UP_MS[PROBE_FOLLOW_UP_MS.length - 1] / 60e3)}`;
      await d.db.update("agent_maker_probes", `id=eq.${p.id}`, { follow_up, watching: !(last in follow_up) });
      report.probes.followedUp++;
    } catch (e) {
      report.errors.push(`probe ${p.id}: ${msg(e)}`);
    }
  }

  // 3. the book, per venue and mode -------------------------------------
  // What filled, including the filled part of a live order still working: real base the stops and the caps must see. Read
  // page by page: PostgREST stops at 1,000 rows without a word, and a book built from the OLDEST thousand fills would freeze
  // every position at a state weeks old — sells gone, so a flat book reads long; buys gone, so a held position reads flat.
  const filled = await d.db.selectAll<OrderRow>("agent_orders", "state=in.(filled,partially_filled)&select=*&order=ts.asc,id.asc");
  const dayStart = Math.floor(d.now / ONE_D) * ONE_D;
  const todayRows = await d.db.selectAll<{ venue: VenueId; mode: string }>("agent_orders", `ts=gte.${new Date(dayStart).toISOString()}&select=venue,mode&order=id.asc`);
  const ordersToday: Record<string, number> = {};
  for (const r of todayRows) ordersToday[mk(r.venue, r.mode)] = (ordersToday[mk(r.venue, r.mode)] ?? 0) + 1;
  /** This venue's marks by symbol. A symbol that got no mark this turn is left out — never written as 0, which is not a price. */
  const marksFor = (vid: VenueId): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, m] of markets) if (k.startsWith(`${vid}|`) && m.mark != null) out[k.slice(vid.length + 1)] = m.mark;
    return out;
  };
  // Today's open per SIGNAL venue and symbol — the rule's own daily candles, the series the dashboard reads for its "today" too.
  const dayOpenBy = new Map<VenueId, Record<string, number>>();
  const dayOpenAny: Record<string, number> = {};
  for (const [key, c1d] of dailyBy) {
    const [vid, sym] = key.split("|") as [VenueId, string];
    // Just after 00:00 UTC the venue has not published today's daily candle yet. Falling back to the last
    // candle and reading its OPEN gave YESTERDAY's open as today's — a whole day of move counted as today's,
    // every night, which inflates `dayPnl` and can spend the daily loss limit on a move that already happened.
    // Yesterday's CLOSE is where today opened, so that is the fallback.
    const today = c1d.find((c) => c.start === dayStart);
    const open = today ? today.open : c1d.at(-1)?.close;
    if (open == null) continue;
    if (!dayOpenBy.has(vid)) dayOpenBy.set(vid, {});
    dayOpenBy.get(vid)![sym] = open;
    if (dayOpenAny[sym] == null) dayOpenAny[sym] = open;
  }
  const byId = new Map(strategies.map((s) => [s.id, s]));
  // A position belongs to the MODE it was opened in: a paper fill is a number in this table and a live
  // fill is a coin at the venue, and one is not the other. Keyed on strategy|symbol alone — as this was
  // until 2026-09-22 — a row switched from paper to live inherits its paper positions, so the rulebook
  // sees itself already long, never buys them for real, and the first time an exit or the floor fires
  // places a REAL sell for coins the account never bought. (The exposure bucket read `rows[0].mode`, so
  // that blended position would have been billed to the paper cap as well.) The mode is in the key, and
  // a book that changes mode leaves its old positions behind rather than carrying them across.
  const positions = new Map<string, Position>();
  const exposure: Record<string, number> = {};
  const byKey = new Map<string, OrderRow[]>();
  for (const o of filled) { const k = posKey(o.strategy_id, o.symbol, o.mode); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(o); }
  for (const [k, rows] of byKey) {
    const pos = positionFromFills(rows.map(toFill));
    positions.set(k, pos);
    const bucket = mk(rows[0].venue, rows[0].mode);
    exposure[bucket] = (exposure[bucket] ?? 0) + pos.base * (marksFor(rows[0].venue)[rows[0].symbol] || pos.avgCost);
  }
  /**
   * The book this row is trading now — the one key both its position and its own fill history are read
   * under. Its mode picks it, with one exception: a PAUSED row is not a book of its own, it is whatever
   * it was when it took the position, and `0043` proved a paused row must keep seeing that position or
   * it loses its exits. Live is preferred there because real coins outrank paper ones.
   */
  const bookMode = (s: StrategyRow, sym: string): "paper" | "live" => {
    // Real coins outrank a label. A row demoted to `paper` while it holds LIVE base still has coins at the
    // venue, and reading its own label literally would leave them with no floor and no rule exit while the
    // row happily traded paper beside them. Otherwise the row's own mode decides, and a PAUSED row — which
    // is not a book of its own — falls back to paper, because its live book was just ruled out above.
    if ((positions.get(posKey(s.id, sym, "live"))?.base ?? 0) > 0) return "live";
    return s.mode === "live" ? "live" : "paper";
  };
  const bookKey = (s: StrategyRow, sym: string): string => posKey(s.id, sym, bookMode(s, sym));
  /** True when this row holds a position in a book it is not currently trading — its exits must run, its entries must not. */
  const offBook = (s: StrategyRow, sym: string): boolean =>
    (positions.get(bookKey(s, sym))?.base ?? 0) > 0 && (s.mode === "paused" || bookMode(s, sym) !== s.mode);
  const positionOf = (s: StrategyRow, sym: string): Position => positions.get(bookKey(s, sym)) ?? positionFromFills([]);
  /** This row's own fills, in its own book: what the re-entry cooldown reads for the last exit. */
  const fillsOf = (s: StrategyRow, sym: string): OrderRow[] => byKey.get(bookKey(s, sym)) ?? [];
  // ── winding down: a retired row that still holds something ──────────────────────────────
  // A position does not stop being a position because its row was switched off. `0038` retired
  // `dislocation-1m` flat and nothing was left behind; `0043` retired three rows that were still
  // long, and a paused row's position had nowhere to go — no floor, no rule exit, and hidden from
  // the page. So a retired row that holds anything keeps running its EXITS (the floor under cost
  // and the rulebook's own exit) and can never buy again; a retired row that is flat is skipped
  // entirely, which is what every earlier turn did to all of them.
  const windingDown = new Set<string>();
  for (const s of strategies) {
    if (!s.retired_at) continue;
    if (s.symbols.some((sym) => positionOf(s, sym).base > 0)) windingDown.add(s.id);
  }
  for (const s of strategies) {
    if (s.symbols.some((sym) => offBook(s, sym))) windingDown.add(s.id);
  }
  report.windingDown = [...windingDown];

  // An open buy is risk too: a bid resting at the venue, or a `pending` row whose outcome is unknown, becomes a position the
  // moment it fills, so its unfilled notional counts against the cap now, not a turn late.
  for (const o of open) {
    if (o.side !== "buy" || settledIds.has(o.id)) continue;
    const bucket = mk(o.venue, o.mode);
    exposure[bucket] = (exposure[bucket] ?? 0) + Math.max(0, Number(o.base_size) - Number(o.filled_base || 0)) * Number(o.price);
  }
  // Today's P&L per venue and mode, summed one strategy at a time so each is marked from ITS signal venue's day open. The
  // dashboard computes its "today" the same way, so the page and the daily loss breaker read one figure.
  const pnlToday: Record<string, number> = {};
  const groups = new Map<string, OrderRow[]>();
  for (const o of filled) { const g = `${o.strategy_id}|${o.venue}|${o.mode}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(o); }
  for (const [g, rows] of groups) {
    const [sid, vid, mode] = g.split("|") as [string, VenueId, string];
    const s = byId.get(sid);
    const opens = (s && dayOpenBy.get(s.signal_venue)) ?? dayOpenAny;
    pnlToday[mk(vid, mode)] = (pnlToday[mk(vid, mode)] ?? 0) + dayPnl(rows, marksFor(vid), opens, dayStart);
  }
  // The caps, per venue account and per mode. Paper twins measure independently, so their
  // exposure cap is its own number: with the live cap they would crowd each other out of the book.
  const limitsFor = (mode: string) => ({
    maxOrderUsd: Number(risk.max_order_usd),
    maxExposureUsd: mode === "paper" && risk.paper_exposure_usd != null ? Number(risk.paper_exposure_usd) : Number(risk.max_exposure_usd),
    dailyLossLimitUsd: Number(risk.daily_loss_limit_usd), maxOrdersPerDay: Number(risk.max_orders_per_day), globalPause: !!risk.global_pause,
  });
  // The caps are counted in the book the order will be written to; `mode` stays the row's LABEL, because that
  // is what `riskGate`'s paused test asks about — whether this rulebook may take new risk, not which book it is in.
  const ctxFor = (s: StrategyRow, sym: string) => {
    const bucket = mk(s.venue, bookMode(s, sym));
    return { exposureUsd: exposure[bucket] ?? 0, ordersToday: ordersToday[bucket] ?? 0, dayPnlUsd: pnlToday[bucket] ?? 0, mode: s.mode };
  };
  // The last recorded state per strategy × symbol, each its own tiny query: one window over all of them
  // would let a busy pair push a quiet pair's row out and turn the change log into a heartbeat.
  const latestObs = new Map<string, string>();     // `${strategy}|${symbol}` → JSON of the last recorded state
  await Promise.all(strategies.flatMap((s) => s.symbols.map(async (sym) => {
    const rows = await d.db.select<{ state: unknown }>("agent_observations", `strategy_id=eq.${s.id}&symbol=eq.${enc(sym)}&select=state&order=ts.desc&limit=1`);
    if (rows[0]) latestObs.set(`${s.id}|${sym}`, canon(rows[0].state));
  })));
  type Prior = { id: number; final_action: Action; risk_allowed: boolean; numbers: { orderUsd?: number } | null };
  /** The decision already recorded for this pair and bar (or minute), if any — looked up by the bar itself, not by "the newest row". */
  const priorDecision = async (s: StrategyRow, sym: string, barStart: number): Promise<Prior | null> =>
    (await d.db.select<Prior>("agent_decisions", `strategy_id=eq.${s.id}&symbol=eq.${enc(sym)}&bar_start=eq.${enc(new Date(barStart).toISOString())}&select=id,final_action,risk_allowed,numbers&limit=1`))[0] ?? null;
  /** Did any order — placed, rejected or cancelled — ever come out of this decision? */
  const hasOrder = async (decisionId: number) =>
    (await d.db.select<{ id: number }>("agent_orders", `decision_id=eq.${decisionId}&select=id&limit=1`)).length > 0;

  // The one way an order is placed: paper → a row; live → a pending row, the venue, the row again.
  const place = async (s: StrategyRow, sym: string, side: "buy" | "sell", base: string, price: number, decisionId: number | null, marketable: boolean, requotes: number) => {
    const mode = bookMode(s, sym);
    const bucket = mk(s.venue, mode);
    const venue = d.venues[s.venue];
    const cfg = markets.get(mk(s.venue, sym))?.pair;
    if (!cfg) { report.errors.push(`${s.id}|${sym}: no pair config on ${s.venue}; nothing placed`); return; }
    // On the venue's price grid: a marketable buy rounds up so it still reaches the ask, everything else rounds down.
    const priceStr = side === "buy" && marketable ? ceilToStep(price, cfg.quote_step) : floorToStep(price, cfg.quote_step);
    const client_order_id = d.uuid();
    const request = { clientOrderId: client_order_id, symbol: sym, side, base, price: priceStr, postOnly: !marketable, marketable, timeInForce: marketable ? "ioc" : "gtc" };
    const row: Record<string, unknown> = {
      strategy_id: s.id, decision_id: decisionId, venue: s.venue, symbol: sym, mode, side, order_type: "limit",
      price: Number(priceStr), base_size: Number(base), client_order_id, request, requotes, state: "new",
    };
    // The order INSERT is the claim on this decision's attempt (unique on decision_id + requotes, 0041): when a decision's
    // order is placed on a later turn, two turns overlapping on that retry cannot both place — the second insert fails here.
    const insertOrder = async (r: Record<string, unknown>, returning: boolean): Promise<{ id: number }[] | null> => {
      try { return await d.db.insert<{ id: number }>("agent_orders", r, returning); }
      catch (e) {
        if (/409|duplicate|unique/i.test(msg(e))) { report.skipped.push(`${s.id}|${sym}: order for decision ${decisionId ?? "—"} (attempt ${requotes}) already placed by another turn`); return null; }
        throw e;
      }
    };
    // `0041`'s unique index is on (decision_id, requotes) and is partial: `where decision_id is not null`. A
    // FRESH order with no decision id therefore carries NO claim, so two turns retrying it would both place;
    // refuse it instead. A re-quote is different and is left alone: it replaces a row the same turn has
    // already cancelled and settled, so a second turn does not see it resting, and MAX_REQUOTES bounds it.
    if (decisionId == null && requotes === 0) {
      report.errors.push(`${s.id}|${sym}: order has no decision id and so no claim under 0041; nothing placed`);
      return;
    }
    if (mode === "live") {
      // The confirmation is a gate on RISK, not on the exits. Clearing `live_confirmed_at` is the documented way to
      // stop this thing, and until 2026-09-22 it was side-agnostic: it refused the protective sell too, so the one
      // lever the operator is told to pull would have left real coins with no way out while the record said the exit
      // was allowed. A BUY needs the confirmation; a SELL of base this book actually holds does not. `global_pause`
      // stays the single switch that outranks an exit — that one is deliberate, and `riskGate` enforces it.
      if (!risk.live_confirmed_at && side === "buy") { report.errors.push(`${s.id}|${sym}: live order refused — live_confirmed_at is null`); return; }
      if (!venue?.canTrade) { report.errors.push(`${s.id}|${sym}: live order refused — no ${s.venue} credentials`); return; }
      // The intent is durable BEFORE the venue is called: if the reply never lands, the next turn reconciles by client id.
      const inserted = await insertOrder({ ...row, state: "pending" }, true);
      if (!inserted) return;
      const [pending] = inserted;
      const placed = await venue.placeLimit({ clientOrderId: client_order_id, symbol: sym, side, base, price: priceStr, marketable });
      if (!placed.ok) {
        await d.db.update("agent_orders", `id=eq.${pending.id}`, { state: "rejected", cancelled_at: nowIso, response: { status: placed.status, error: placed.error, response: placed.response }, updated_at: nowIso });
        report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode, side, price, base: Number(base), state: "rejected" });
        report.errors.push(`${s.id}|${sym}: ${s.venue} rejected → ${placed.status} ${placed.error}`);
        return;
      }
      // The row stays `new` whatever the placement reply says, even "filled": the next turn reads the order back from the
      // venue and settles it with the venue's own filled size, average price and fee. A fill recorded from the placement
      // reply alone would have no fee on it — and a marketable order is exactly the one that fills on arrival.
      await d.db.update("agent_orders", `id=eq.${pending.id}`, { state: "new", venue_order_id: placed.venueOrderId, response: placed.response, updated_at: nowIso });
      report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode, side, price, base: Number(base), state: placed.state === "filled" ? "new (filled on arrival; settles next turn)" : placed.state });
    } else {
      if (!(await insertOrder(row, false))) return;
      report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode, side, price, base: Number(base), state: "new" });
    }
    ordersToday[bucket] = (ordersToday[bucket] ?? 0) + 1;
    if (side === "buy") exposure[bucket] = (exposure[bucket] ?? 0) + Number(base) * price;
    holdInFlight(`${s.id}|${sym}`, side);
    // The maker probe (`0042`), opened only where the question exists: an order that CROSSED
    // the touch and paid for it. A post-only order already rests, so there is nothing to ask.
    // The probe records where the same order would have sat instead — the same side's touch —
    // and later turns watch whether the market came back to it and where it went next. It
    // places nothing and is deliberately written last, after the real order is safely on
    // record: a probe that fails to insert must never cost an order.
    const pq = markets.get(mk(s.venue, sym))?.quote;
    if (marketable && pq) {
      try {
        await d.db.insert("agent_maker_probes", {
          strategy_id: s.id, order_id: null, venue: s.venue, symbol: sym, mode, side,
          taker_price: Number(priceStr), maker_price: side === "buy" ? pq.bid : pq.ask,
          base_size: Number(base), expires_at: new Date(d.now + PROBE_TTL_MS).toISOString(),
          // Written out rather than left to the column defaults: the starting state of a probe
          // is part of what this code means, and it should not change because a schema does.
          state: "resting", watching: true, follow_up: {},
        }, false);
        report.probes.opened++;
      } catch (e) {
        report.skipped.push(`${s.id}|${sym}: maker probe not opened — ${msg(e)}`);
      }
    }
  };

  // Re-quotes first: the same decision, the new touch, one more try — through the same gate as any order. A re-quote is a
  // new order, so the pause, the loss limit and the caps apply to it; the resting one it replaces was cancelled above and is
  // no longer counted, so the gate sees the book as it is.
  for (const { o, touch } of requoteWanted) {
    const s = byId.get(o.strategy_id);
    if (!s) continue;
    const gate = riskGate(o.side === "buy" ? "enter" : "exit", Number(o.base_size) * touch, ctxFor(s, o.symbol), limitsFor(bookMode(s, o.symbol)));
    if (!gate.allowed) { report.skipped.push(`${o.strategy_id}|${o.symbol}: re-quote refused — ${gate.reason}`); continue; }
    await place(s, o.symbol, o.side, String(o.base_size), touch, o.decision_id ?? null, false, Number(o.requotes ?? 0) + 1);
  }

  // 4–6. per strategy -----------------------------------------------------
  type Decided = { action: Action; allowed: boolean; decisionId: number | null; orderUsd: number };
  const decide = async (
    s: StrategyRow, sym: string, barStart: number, snapState: unknown, numbers: Record<string, unknown>, questions: Questions | null,
    rule: { action: Action; reason: string }, kind: "bar" | "protective", jevOverride?: JevResult,
  ): Promise<Decided | null> => {
    // A retired row winding down can only leave. This gate sits inside `decide` rather than at
    // each call site because every decision — bar, protective, dislocation — passes through here,
    // and a new one added later would otherwise miss it.
    if ((s.retired_at || s.mode === "paused" || offBook(s, sym)) && rule.action === "enter") {
      // Before `askJev`, not after: `riskGate` would refuse this anyway, having already paid for the answer and
      // spent up to 16 s of the turn's budget on it.
      report.skipped.push(`${s.id}|${sym}: ${s.mode === "paused" ? "paused" : `winding down a ${bookMode(s, sym)} book this row does not trade`} — exits only`);
      return null;
    }
    const m = markets.get(mk(s.venue, sym))!;
    const pos = positionOf(s, sym);
    let jr: JevResult = jevOverride ?? { provider: "rule", model: null, answers: {}, inputTokens: 0, costUsd: 0, latencyMs: 0, errors: [] };
    if (!jevOverride && questions && rule.action === "enter") {
      try { jr = await askJev(snapState as Record<string, unknown>, questions, d.jev, d.fetchImpl); }
      catch (e) { jr = { provider: "none", model: null, answers: {}, inputTokens: 0, costUsd: 0, latencyMs: 0, errors: [msg(e)] }; }
    }
    const a = jr.answers;
    const view = jevViewOf(jr, sym);
    // An exit passes the model untouched; an entry needs its vote.
    let final = rule.action === "enter"
      ? combineDecision(rule, view, { enterMin: num(s.params?.enterMin, 0.6), cautionExit: 1.75 }, s.params?.jevGate !== false)
      : { ...rule, jevSaid: jr.provider === "rule" ? "rule only" : `${jr.provider}: ${view.healthy == null ? "no answer" : `healthy=${view.healthy.toFixed(2)}`}` };
    // The thin-book guard. Every Revolut X entry CROSSES — it pays the ask — so a book that has gone
    // wide charges its width as a fee on the way in, on top of the 9 bps. The measured UK book is
    // 1.5–24 bps wide; the EEA book this account cannot trade was once seen at 180 (§2.2, §4.14), and
    // a quote that wide is either a real dislocation or a broken feed, and an ENTRY is worth neither.
    // An exit is never refused here: a stop exists for exactly the minute the book is ugly, and it
    // already judges itself on the bid (`exitMark`) rather than the mid, which is the conservative
    // side. An entry can always wait for the next bar; a position cannot wait for a better book.
    const bookBps = spreadBps(m.quote);
    if (final.action === "enter" && bookBps != null && bookBps > WIDE_SPREAD_BPS) {
      final = { action: "hold", reason: `book too wide to cross: ${bookBps.toFixed(1)} bps > ${WIDE_SPREAD_BPS}`, jevSaid: final.jevSaid };
    }
    const mark = m.mark ?? Number(numbers.close ?? 0);
    const limits = limitsFor(bookMode(s, sym));
    const slots = s.kind === "rotation-1d" ? Math.max(1, rotationParamsOf(s).topN) : Math.max(1, s.symbols.length);
    const orderUsd = final.action === "enter" ? Math.min(Number(s.capital_usd) / slots, limits.maxOrderUsd) : pos.base * mark;
    const ctx = ctxFor(s, sym);
    const gate = riskGate(final.action, orderUsd, ctx, limits);
    let dec: { id: number } | undefined;
    try {
      [dec] = await d.db.insert<{ id: number }>("agent_decisions", {
        strategy_id: s.id, venue: s.venue, symbol: sym, mode: bookMode(s, sym), bar_start: new Date(barStart).toISOString(),
        state: snapState, numbers: { ...numbers, barStart, mark, orderUsd, exposureUsd: ctx.exposureUsd, ordersToday: ctx.ordersToday, pnlToday: ctx.dayPnlUsd, signalVenue: s.signal_venue, kind, bookBps },
        questions, answers: a, provider: jr.provider, model: jr.model, latency_ms: jr.latencyMs, cost_usd: jr.costUsd,
        rule_action: rule.action, rule_reason: rule.reason, final_action: final.action,
        final_reason: `${final.reason} [${final.jevSaid}${jr.errors.length ? "; " + jr.errors.join(" | ").slice(0, 300) : ""}]`,
        risk_allowed: gate.allowed, risk_reason: gate.reason,
      });
    } catch (e) {
      if (/409|duplicate|unique/i.test(msg(e))) { report.skipped.push(`${s.id}|${sym}: bar ${new Date(barStart).toISOString()} claimed by another tick`); return null; }
      throw e;
    }
    report.decisions.push({ strategy: s.id, venue: s.venue, symbol: sym, action: final.action, reason: final.reason, provider: jr.provider, allowed: gate.allowed, kind });
    return { action: final.action, allowed: gate.allowed, decisionId: dec?.id ?? null, orderUsd };
  };

  for (const s of strategies) {
    // Retired and flat: nothing to protect and nothing to decide. Retired and still holding:
    // fall through, and `decide` refuses every entry.
    if (s.retired_at && !windingDown.has(s.id)) continue;
    const p = trendParamsOf(s);
    const rotation = rotationParamsOf(s);
    const lookbackDays = num(s.params?.lookbackDays, 30);   // the momentum word's window; a row without the parameter reads the 30 days its name says
    const barMs = decisionBarMs(s.kind);
    // The floor under cost, and no intra-bar ATR trail on any rule: the trail `ruleDecision` applies to
    // the CLOSE and the one this checked against the live mark were the same trail from the same anchor,
    // and the per-minute copy always fired first — 48 of 49 protective exits in one walk-forward window,
    // 67 of 68 in the other, for a rule that is better without it on 8 of 10 coin-windows (§3.13, §4.11).
    // The rulebook's trail is untouched and now does the work it was written to do.
    const stops = { atrStop: null, maxLossPct: num(s.params?.maxLossPct, 0.08) };

    // The rotation rule ranks the whole cross-section once, on closed daily candles.
    let ranks: Record<string, RankView> | null = null;
    if (s.kind === "rotation-1d") {
      const closedDaily: Record<string, Candle[]> = {};
      for (const sym of s.symbols) {
        const sig = signalFor(s, sym);
        if (sig) closedDaily[sym] = sig.c1d.slice(0, lastClosedIndex(sig.c1d, ONE_D, d.now) + 1);
      }
      ranks = rotationTargets(closedDaily, rotation);
    }

    for (const sym of s.symbols) {
      const key = `${s.id}|${sym}`;
      try {
        await renewLease();   // no-op until the lease is half gone
        const m = markets.get(mk(s.venue, sym));
        const sig = signalFor(s, sym);
        if (!m || !sig || sig.bars.length < p.slow + 2 || !sig.c1d.length) { report.skipped.push(`${key}: not enough candles`); continue; }
        const bars = sig.bars, dd = sig.c1d;
        const i = lastClosedIndex(bars, sig.barMs, d.now);
        const di = lastClosedIndex(dd, ONE_D, d.now);
        if (i < 0 || di < 0) { report.skipped.push(`${key}: no closed bar`); continue; }
        const pos = positionOf(s, sym);
        const closedDaily = dd.slice(0, di + 1);
        const barsPerYear = (ONE_D / sig.barMs) * 365;
        const forming = bars.length - 1;
        const minuteStart = Math.floor(d.now / ONE_M) * ONE_M;
        const protectiveClaim = minuteStart + PROTECTIVE_CLAIM_OFFSET_MS;

        // --- dislocation: quotes, every minute, no bar to wait for ---------
        if (s.kind === "dislocation-1m") {
          const dp = dislocationParamsOf(s);
          const rq = quotes.revx?.[sym], kq = quotes[s.signal_venue]?.[sym];
          const m1 = minuteFor(s, sym)?.bars ?? [];
          const ci = lastClosedIndex(m1, ONE_M, d.now);
          const move5 = ci >= 5 ? (m1[ci].close / m1[ci - 5].close - 1) * 1e4 : null;
          if (!rq || !kq) { report.skipped.push(`${key}: no quotes on both venues`); continue; }
          const view = dislocationState(sym, rq, kq, move5, pos, d.now, dp);
          const prevObs = latestObs.get(key);
          const stateJson = canon(view.state);
          if (prevObs !== stateJson) {
            await d.db.insert("agent_observations", { strategy_id: s.id, symbol: sym, ts: nowIso, bar_start: new Date(minuteStart).toISOString(), state: view.state, numbers: { basisBps: view.basisBps, fair: view.fair, move5, revx: rq, reference: kq, mark: m.mark } }, false);
            latestObs.set(key, stateJson); report.observations++;
          }
          const lastExit = fillsOf(s, sym).filter((o) => o.side === "sell").map((o) => toFill(o).ts).at(-1) ?? null;
          const rule = ruleDecisionDislocation(view, rq, pos, d.now, dp, lastExit);
          if (inFlight.has(key)) {
            // A resting exit ask does not outrank the stops: when the loss stop or the time stop says sell now, it is taken off first.
            const r0 = resting.get(key);
            if (!(r0 && r0.side === "sell" && rule.action === "exit" && rule.marketable)) { report.skipped.push(`${key}: order in flight`); continue; }
            const c = await cancelOrder(r0, rule.reason);
            if (c !== "cancelled") { report.skipped.push(`${key}: resting ask ${c === "filled" ? "filled on cancel" : "could not be cancelled"}`); continue; }
            inFlight.delete(key);
          }
          if (rule.action === "hold") continue;                       // a minute with nothing to do is not a decision
          if (await priorDecision(s, sym, minuteStart)) continue;
          const r = await decide(s, sym, minuteStart, view.state, { basisBps: view.basisBps, fair: view.fair, move5, close: m.mark ?? (rq.bid + rq.ask) / 2, revx: rq, reference: kq }, dislocationQuestions(view.state), rule, rule.action === "exit" && rule.marketable ? "protective" : "bar");
          if (!r || r.action === "hold" || !r.allowed) continue;
          const cfg = m.pair;
          if (!cfg) { report.errors.push(`${key}: no pair config`); continue; }
          const side: "buy" | "sell" = r.action === "enter" ? "buy" : "sell";
          const price = rule.price ?? (side === "buy" ? rq.ask : rq.bid);
          const base = side === "buy" ? sizeBase(r.orderUsd, price, cfg) : sizeBase(pos.base * price, price, cfg);
          if (!base) { report.errors.push(`${key}: size under venue minimum`); continue; }
          await place(s, sym, side, base, price, r.decisionId, rule.marketable, 0);
          continue;
        }

        // --- observation on the forming bar, every minute -------------------
        // The position's high-water is trailed to the market first: from the fills alone it never rises, and the state's
        // drawdown word (and the bar rule's ATR clause below) would read the entry price where the backtester read the high.
        const obs = buildSnapshot(sym, bars, forming, closedDaily, trailed(pos, bars, forming), d.now, p, undefined, barsPerYear, lookbackDays);
        const stateJson = canon(obs.state);
        if (latestObs.get(key) !== stateJson) {
          await d.db.insert("agent_observations", { strategy_id: s.id, symbol: sym, ts: nowIso, bar_start: new Date(bars[forming].start).toISOString(), state: obs.state, numbers: { ...obs.numbers, mark: m.mark } }, false);
          latestObs.set(key, stateJson); report.observations++;
        }

        // --- protective stop against the live mark, every minute, before anything else -----
        // Claimed one second INTO the minute, so a stop whose order was rejected or lapsed is tried again next minute, not next
        // bar — and so a stop in the first minute of a bar can never take the bar's own claim (a bar starts on the minute).
        if (pos.base > 0) {
          const hw = highWaterSince(pos, bars, i);
          const atr = atrAt(bars, i, p.atrN);
          const why = protectiveExit(exitMark(m) ?? 0, pos, hw, atr, stops);
          if (why) {
            const marketable = s.venue === "revx";                    // Kraken's taker fee is not worth certainty at this size: rest at the ask and let the re-quote walk it down
            if (inFlight.has(key)) {
              // A resting sell that is already the best this venue can do is left to work; anything the stop outranks is
              // taken off first. What this must NOT do is treat every order in flight as a reason to stand down: until
              // 2026-09-22 a BUY that could not be read back or cancelled — which is exactly what an unverified
              // settlement reply (B4) or a venue timeout produces — blocked this pair's stop every minute, for good.
              // A buy is not the exit. Cancel it if we can, sell what we hold either way; if it fills after all, the
              // next turn derives the new position and stops that too.
              const r0 = resting.get(key);
              if (!r0) {
                if (inFlightSells.has(key)) { report.skipped.push(`${key}: stop wants out; a sell is already in flight`); continue; }
                report.errors.push(`${key}: stopping out past a buy in flight that could not be read back`);
              } else if (r0.side === "sell" && !marketable) {
                report.skipped.push(`${key}: stop wants out; a resting sell is already the best this venue can do`);
                continue;
              } else {
                const c = await cancelOrder(r0, why);
                if (c === "filled") { report.skipped.push(`${key}: resting order filled on cancel`); continue; }
                if (c !== "cancelled" && r0.side === "sell") { report.skipped.push(`${key}: resting sell could not be cancelled`); continue; }
                if (c !== "cancelled") report.errors.push(`${key}: stopping out past a resting buy that could not be cancelled`);
                inFlight.delete(key);
              }
            }
            if (await priorDecision(s, sym, protectiveClaim)) { report.skipped.push(`${key}: stop already decided this minute`); continue; }
            const r = await decide(s, sym, protectiveClaim, obs.state, { ...obs.numbers, highWater: hw, atr }, null, { action: "exit", reason: why }, "protective");
            if (r && r.allowed) {
              const cfg = m.pair, q = m.quote;
              if (cfg && q) {
                const price = marketable ? q.bid : q.ask;
                const base = sizeBase(pos.base * price, price, cfg);
                if (base) await place(s, sym, "sell", base, price, r.decisionId, marketable, 0);
                else report.errors.push(`${key}: size under venue minimum`);
              }
            }
            continue;
          }
        }

        if (inFlight.has(key)) { report.skipped.push(`${key}: order in flight`); continue; }

        // --- the bar decision, once per closed bar --------------------------
        const barStart = barMs === ONE_D ? dd[di].start : bars[i].start;
        const prior = await priorDecision(s, sym, barStart);
        let r: Decided;
        if (prior) {
          if (prior.final_action === "hold" || !prior.risk_allowed || await hasOrder(prior.id)) { report.skipped.push(`${key}: bar ${new Date(barStart).toISOString()} already decided`); continue; }
          // Decided, allowed, and no order ever came of it — no pair config, a size under the venue minimum, the confirmation
          // or the credentials missing at the time. The bar's claim stays with the decision; the order gets another try at
          // today's touch. (A venue rejection made an order row, so it is not retried here: the venue said no.) An entry is
          // put through the gate again — the book may have moved — and one the gate now refuses is closed for good.
          const orderUsd = Number(prior.numbers?.orderUsd ?? 0);
          if (prior.final_action === "enter") {
            const gate = riskGate("enter", orderUsd, ctxFor(s, sym), limitsFor(bookMode(s, sym)));
            if (!gate.allowed) {
              await d.db.update("agent_decisions", `id=eq.${prior.id}`, { risk_allowed: false, risk_reason: `on the retry: ${gate.reason}` });
              report.skipped.push(`${key}: decision ${prior.id} had no order and the gate now refuses it — ${gate.reason}`);
              continue;
            }
          }
          report.skipped.push(`${key}: decision ${prior.id} (${prior.final_action}) had no order; placing it now`);
          r = { action: prior.final_action, allowed: true, decisionId: prior.id, orderUsd };
        } else {
          // A new decision may ask the model, up to 16 s a time; past the budget the bar waits for the next minute, when it is
          // still the last closed bar. Stops and observations above are never deferred.
          if (overBudget()) { report.skipped.push(`${key}: turn ${Math.round(elapsed() / 1000)} s in, over its budget; the bar waits for the next minute`); continue; }
          const posBar = trailed(pos, bars, i);
          const snap = buildSnapshot(sym, bars, i, closedDaily, posBar, d.now, p, undefined, barsPerYear, lookbackDays);
          let rule = ruleFor(s.kind, snap, posBar, p, { rank: ranks?.[sym], nowMs: d.now, rotation });
          // After any exit the rule waits REENTRY_BARS of its own bars before buying again: a floor stop under a rule that is
          // still "on" (momentum, rotation) would otherwise sell and re-buy every bar. Same rule in the backtester.
          const lastExitTs = fillsOf(s, sym).filter((o) => o.side === "sell").map((o) => toFill(o).ts).at(-1) ?? null;
          if (rule.action === "enter" && lastExitTs != null && d.now - lastExitTs < REENTRY_BARS * barMs) {
            rule = { action: "hold", reason: `cooling down: exited ${Math.round((d.now - lastExitTs) / 60e3)} min ago, no re-entry for ${REENTRY_BARS} bars` };
          }
          const dec = await decide(s, sym, barStart, snap.state, { ...snap.numbers, rank: ranks?.[sym] ?? null }, jevQuestions(snap.state), rule, "bar");
          if (!dec || dec.action === "hold" || !dec.allowed) continue;
          r = dec;
        }
        const q = m.quote, cfg = m.pair;
        if (!q || !cfg) { report.errors.push(`${key}: no quote/pair config on ${s.venue}; the order waits for the next minute`); continue; }
        const side: "buy" | "sell" = r.action === "enter" ? "buy" : "sell";
        // Revolut X takes the touch (9 bps): a bid resting on a breakout fills exactly when the breakout fails, which is the
        // backtest's fill model turned inside out. Kraken rests post-only at the touch: 80 bps a side is not worth certainty here.
        const marketable = s.venue === "revx";
        const price = side === "buy" ? (marketable ? q.ask : q.bid) : (marketable ? q.bid : q.ask);
        const base = side === "buy" ? sizeBase(r.orderUsd, price, cfg) : sizeBase(pos.base * price, price, cfg);
        if (!base) { report.errors.push(`${key}: size under venue minimum; the order waits for the next minute`); continue; }
        await place(s, sym, side, base, price, r.decisionId, marketable, 0);
      } catch (e) {
        // One pair's failure is one pair's failure: the other strategies still get their stops and their turn.
        report.errors.push(`${key}: ${msg(e)}`);
      }
    }
  }
}
