// One turn of the agents' loop. Runs every five minutes from pg_cron and
// does, in order, for every strategy that is not paused:
//
//   1. refresh the market: for every symbol in play, both venues' public
//      quotes (the basis between them is recorded every turn), and for
//      every (signal venue, symbol) the candles the rulebooks read — the
//      decision bar's series, the daily series, and the latest closed
//      5-minute candle on the EXECUTION venue for paper fills;
//   2. settle open orders — a `pending` row (written before a live order
//      was sent) is reconciled against the venue's active orders by client
//      id; a paper order fills if the venue's last 5-minute candle traded
//      through its price (and pays that venue's maker fee); a live order is
//      re-read from the venue; either kind is cancelled after `STALE_TICKS`
//      turns unfilled, a live one only after the venue confirms and any
//      partial fill has been read back;
//   3. on a NEWLY closed decision bar and with no order in flight: build
//      the categorical state, ask Jev, apply the rulebook (the rotation
//      rule sees the whole cross-section), apply the risk gate, CLAIM the
//      bar by inserting the decision — a unique index makes a second claim
//      fail, so two overlapping ticks cannot both order — and place the
//      order it allows as a resting post-only limit at the touch.
//
// Two venues, one loop. A strategy row names where it trades (`venue`)
// and where its candles come from (`signal_venue`): the Revolut X rows read
// Kraken's candles, the deeper book, and fill on Revolut X, the free maker.
// Paper fills pay the execution venue's real maker fee, so the Kraken
// twins measure what its fee costs against the same signal.
//
// Everything the decision saw and everything the venue said is written
// down. Positions and P&L are never stored: `positionFromFills` derives
// them from the filled orders every time they are needed, so there is
// exactly one implementation of "what do we hold and what has it made".
//
// A live order needs THREE things at once: the strategy row says `live`,
// `agent_risk.live_confirmed_at` is set, and the risk gate allows it —
// plus credentials for that venue. Paper needs the gate only. The caps in
// `agent_risk` are per venue account and per mode, so paper and live never
// crowd each other out of the same cap.

import { askJev, type JevEnv, type JevResult } from "../_shared/jev.ts";
import {
  buildSnapshot, combineDecision, DEFAULT_ROTATION, DEFAULT_TREND, jevQuestions, positionFromFills, riskGate, rotationTargets, ruleFor,
  sizeBase, unrealisedUsd,
  type Action, type Candle, type JevView, type PairConfig, type Position, type RankView, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { paperFeeUsd, type Quote, type Venue, type VenueId } from "../_shared/venue.ts";
import type { Db } from "./db.ts";

export const STALE_TICKS = 3;                 // 15 minutes unfilled → cancel, re-quote next turn
const FOUR_H = 4 * 3600e3, ONE_H = 3600e3, ONE_D = 86400e3, FIVE_M = 5 * 60e3;
const DAILY_BARS = 130;                       // SMA 100 + the 30-day lookback, with room

export type StrategyRow = {
  id: string; kind: StrategyKind; venue: VenueId; signal_venue: VenueId; name: string; symbols: string[]; mode: "paper" | "live" | "paused";
  capital_usd: number; params: Record<string, number | boolean>;
};
export type RiskRow = {
  global_pause: boolean; max_order_usd: number; max_exposure_usd: number; daily_loss_limit_usd: number;
  max_orders_per_day: number; live_confirmed_at: string | null;
};
export type OrderRow = {
  id: number; ts: string; strategy_id: string; venue: VenueId; symbol: string; mode: "paper" | "live"; side: "buy" | "sell";
  price: number; base_size: number; client_order_id: string; venue_order_id: string | null; state: string;
  filled_base: number; avg_fill_price: number | null; fee_usd: number; filled_at: string | null;
};

export type TickDeps = {
  db: Db;
  venues: Partial<Record<VenueId, Venue>>;
  jev: JevEnv;
  now: number;
  fetchImpl?: typeof fetch;
  uuid: () => string;
};

export type TickReport = {
  at: string; strategies: number; markets: string[];
  basis: Record<string, number>;
  decisions: { strategy: string; venue: VenueId; symbol: string; action: Action; reason: string; provider: string; allowed: boolean }[];
  orders: { strategy: string; venue: VenueId; symbol: string; mode: string; side: string; price: number; base: number; state: string }[];
  settled: { id: number; state: string }[];
  skipped: string[];
  errors: string[];
};

type Market = { c5m: Candle | null; mark: number; quote?: Quote; pair?: PairConfig };
type Signal = { bars: Candle[]; barMs: number; c1d: Candle[] };

const mk = (venue: string, symbol: string) => `${venue}|${symbol}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The decision bar of a rulebook: 4h for trend-4h, 1h for trend-1h, daily for the rest. */
export function decisionBarMs(kind: StrategyKind): number {
  return kind === "trend-4h" ? FOUR_H : kind === "trend-1h" ? ONE_H : ONE_D;
}
/** The candle series the rulebook's state is built from (the trend rules read their own bar; the daily rules read 4h). */
export function stateBarMs(kind: StrategyKind): number {
  return kind === "trend-1h" ? ONE_H : FOUR_H;
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
    const mark = marks[sym] ?? now.avgCost;
    const open = dayOpen[sym] ?? mark;
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

function trendParamsOf(row: StrategyRow): TrendParams {
  const p = row.params ?? {};
  const n = (k: keyof TrendParams) => (typeof p[k] === "number" ? (p[k] as number) : DEFAULT_TREND[k]);
  return { fast: n("fast"), slow: n("slow"), breakoutUp: n("breakoutUp"), breakoutDown: n("breakoutDown"), atrN: n("atrN"), atrStop: n("atrStop"), volN: n("volN") };
}
function rotationParamsOf(row: StrategyRow): RotationParams {
  const p = row.params ?? {};
  return {
    lookbackDays: typeof p.lookbackDays === "number" ? p.lookbackDays : DEFAULT_ROTATION.lookbackDays,
    topN: typeof p.topN === "number" ? p.topN : DEFAULT_ROTATION.topN,
    slowDays: typeof p.slowDays === "number" ? p.slowDays : DEFAULT_ROTATION.slowDays,
    bearFilter: typeof p.bearFilter === "boolean" ? p.bearFilter : DEFAULT_ROTATION.bearFilter,
    minHoldDays: typeof p.minHoldDays === "number" ? p.minHoldDays : DEFAULT_ROTATION.minHoldDays,
  };
}
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

export async function tick(d: TickDeps): Promise<TickReport> {
  const report: TickReport = { at: new Date(d.now).toISOString(), strategies: 0, markets: [], basis: {}, decisions: [], orders: [], settled: [], skipped: [], errors: [] };
  const nowIso = new Date(d.now).toISOString();
  const [riskRows, strategies, open] = await Promise.all([
    d.db.select<RiskRow>("agent_risk", "id=eq.1&select=*"),
    d.db.select<StrategyRow>("agent_strategies", "mode=in.(paper,live)&select=*"),
    d.db.select<OrderRow>("agent_orders", "state=in.(pending,new,partially_filled)&select=*"),
  ]);
  const risk = riskRows[0];
  if (!risk) { report.errors.push("agent_risk row missing"); return report; }
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
  if (basisRows.length) {
    try { await d.db.upsert("agent_basis", basisRows, "ts,symbol"); } catch (e) { report.errors.push(`basis: ${msg(e)}`); }
  }

  const markets = new Map<string, Market>();
  for (const [vid, syms] of execWanted) {
    const venue = d.venues[vid];
    if (!venue) { report.errors.push(`${vid}: venue not configured`); continue; }
    let pairs: Record<string, PairConfig> = {};
    try { pairs = await venue.pairs([...syms]); } catch (e) { report.errors.push(`${vid}: pairs ${msg(e)}`); }
    for (const sym of syms) {
      try {
        const m5 = await venue.candles(sym, 5, d.now - 3 * FIVE_M, d.now);
        const closed5 = m5.filter((c) => c.start + FIVE_M <= d.now);
        const q = quotes[vid]?.[sym];
        const mark = q ? (q.bid + q.ask) / 2 : closed5.at(-1)?.close ?? 0;
        markets.set(mk(vid, sym), { c5m: closed5.at(-1) ?? null, mark, quote: q, pair: pairs[sym] });
        report.markets.push(mk(vid, sym));
      } catch (e) {
        report.errors.push(`${vid} ${sym}: 5m candles ${msg(e)}`);
      }
    }
  }

  const signals = new Map<string, Signal>();
  for (const [key, w] of signalWanted) {
    const venue = d.venues[w.venue];
    if (!venue) { report.errors.push(`${w.venue}: signal venue not configured`); continue; }
    try {
      const intervalMin = w.barMs / 60e3;
      const [bars, c1d] = await Promise.all([
        venue.candles(w.symbol, intervalMin, d.now - 210 * w.barMs, d.now),   // 210 bars: SMA 100 + breakout 55 with room
        venue.candles(w.symbol, 1440, d.now - DAILY_BARS * ONE_D, d.now),
      ]);
      signals.set(key, { bars, barMs: w.barMs, c1d });
      const rows = [...bars.map((c) => ({ ...c, interval_min: intervalMin })), ...c1d.map((c) => ({ ...c, interval_min: 1440 }))]
        .map((c) => ({ venue: w.venue, symbol: w.symbol, interval_min: c.interval_min, start: new Date(c.start).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      if (rows.length) await d.db.upsert("agent_candles", rows, "venue,symbol,interval_min,start");
    } catch (e) {
      report.errors.push(`${w.venue} ${w.symbol}: candles ${msg(e)}`);
    }
  }
  const signalFor = (s: StrategyRow, sym: string) => signals.get(`${s.signal_venue}|${sym}|${stateBarMs(s.kind)}`);

  // 2. open orders --------------------------------------------------------
  const inFlight = new Set<string>();
  const settle = async (o: OrderRow, patch: Record<string, unknown>, state: string) => {
    await d.db.update("agent_orders", `id=eq.${o.id}`, { ...patch, state, updated_at: nowIso });
    report.settled.push({ id: o.id, state });
  };
  const activeByVenue = new Map<VenueId, Record<string, { venueOrderId: string; view: { state: string; filledBase: number; avgPrice: number | null; feeUsd: number; raw: unknown } }>>();
  for (const o of open) {
    const key = `${o.strategy_id}|${o.symbol}`;
    const venue = d.venues[o.venue];
    const m = markets.get(mk(o.venue, o.symbol));
    try {
      const ageTicks = Math.floor((d.now - new Date(o.ts).getTime()) / FIVE_M);
      if (o.state === "pending") {
        // Written before the venue was called; the reply never landed. Ask the venue whether it has the order.
        if (ageTicks < 1) { inFlight.add(key); continue; }            // still this turn's; leave it
        if (!venue?.canTrade) { report.errors.push(`${key}: pending live order and no ${o.venue} credentials to reconcile it`); inFlight.add(key); continue; }
        if (!activeByVenue.has(o.venue)) {
          const a = await venue.activeOrders();
          if (!a.ok) { report.errors.push(`${key}: active orders ${a.error}`); inFlight.add(key); continue; }
          activeByVenue.set(o.venue, a.byClientId);
        }
        const found = activeByVenue.get(o.venue)![o.client_order_id];
        if (found) {
          await d.db.update("agent_orders", `id=eq.${o.id}`, { state: found.view.state === "filled" ? "filled" : found.view.state, venue_order_id: found.venueOrderId, filled_base: found.view.filledBase, avg_fill_price: found.view.avgPrice, fee_usd: found.view.feeUsd, response: { reconciled: true, view: found.view.raw }, updated_at: nowIso });
          report.settled.push({ id: o.id, state: `reconciled:${found.view.state}` });
          inFlight.add(key);
          continue;
        }
        // Not resting at the venue. A post-only order cannot have filled on arrival, so it was never
        // accepted — or it filled inside the turn and is gone from the active list, which the venue
        // balances on the dashboard would show. Either way a human looks: the row is marked and reported.
        await settle(o, { cancelled_at: nowIso, response: { reconciled: false, note: "not among the venue's active orders one turn later" } }, "rejected");
        report.errors.push(`${key}: pending order ${o.client_order_id} not found at ${o.venue}; marked rejected — check the venue's balances`);
        continue;
      }
      if (o.mode === "paper") {
        const c = m?.c5m;
        const hit = c && (o.side === "buy" ? c.low <= Number(o.price) : c.high >= Number(o.price));
        if (hit) {
          const fee = paperFeeUsd(Number(o.base_size), Number(o.price), venue?.feeBps ?? { maker: 0 });
          await settle(o, {
            filled_base: o.base_size, avg_fill_price: o.price, fee_usd: fee, filled_at: new Date(c!.start + FIVE_M).toISOString(),
            response: { paperFillCandle: c, makerBps: venue?.feeBps.maker ?? 0 },
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
            await settle(o, { cancelled_at: nowIso, response: view.raw }, view.state);
            continue;
          }
          if (view.state === "partially_filled" && (o.state !== "partially_filled" || Number(o.filled_base) !== view.filledBase)) {
            await d.db.update("agent_orders", `id=eq.${o.id}`, { state: "partially_filled", filled_base: view.filledBase, avg_fill_price: view.avgPrice, fee_usd: view.feeUsd, response: view.raw, updated_at: nowIso });
          }
        }
      }
      if (ageTicks >= STALE_TICKS) {
        if (o.mode === "live") {
          if (!venue?.canTrade || !o.venue_order_id) { report.errors.push(`${key}: stale live order but no venue credentials to cancel it`); inFlight.add(key); continue; }
          const c = await venue.cancel(o.venue_order_id);
          if (!c.ok) { report.errors.push(`${key}: cancel ${o.venue_order_id} → ${c.error}`); inFlight.add(key); continue; }
          // What actually filled before the cancel landed is the venue's to say.
          const after = await venue.order(o.venue_order_id);
          if (after.ok && after.view.filledBase > 0) {
            await settle(o, { filled_base: after.view.filledBase, avg_fill_price: after.view.avgPrice ?? o.price, fee_usd: after.view.feeUsd, filled_at: nowIso, cancelled_at: nowIso, response: after.view.raw }, "filled");
            continue;
          }
        }
        await settle(o, { cancelled_at: nowIso }, "cancelled");
        continue;
      }
      inFlight.add(key);
    } catch (e) {
      report.errors.push(`${key}: settle ${msg(e)}`);
      inFlight.add(key);
    }
  }
  if (!strategies.length) return report;

  // 3. what we hold, per venue and mode ----------------------------------
  const filled = await d.db.select<OrderRow>("agent_orders", "state=eq.filled&select=*&order=ts.asc");
  const dayStart = Math.floor(d.now / ONE_D) * ONE_D;
  const todayRows = await d.db.select<{ venue: VenueId; mode: string }>("agent_orders", `ts=gte.${new Date(dayStart).toISOString()}&select=venue,mode`);
  const ordersToday: Record<string, number> = {};
  for (const r of todayRows) ordersToday[mk(r.venue, r.mode)] = (ordersToday[mk(r.venue, r.mode)] ?? 0) + 1;
  const marksFor = (vid: VenueId): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, m] of markets) if (k.startsWith(`${vid}|`)) out[k.slice(vid.length + 1)] = m.mark;
    return out;
  };
  // Today's opening price per symbol, from whichever daily series was loaded for it.
  const dayOpen: Record<string, number> = {};
  for (const [key, sig] of signals) {
    const sym = key.split("|")[1];
    const today = sig.c1d.find((c) => c.start === dayStart) ?? sig.c1d.at(-1);
    if (today && dayOpen[sym] == null) dayOpen[sym] = today.open;
  }
  const positions = new Map<string, Position>();
  const exposure: Record<string, number> = {};
  const byKey = new Map<string, OrderRow[]>();
  for (const o of filled) { const k = `${o.strategy_id}|${o.symbol}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(o); }
  for (const [k, rows] of byKey) {
    const pos = positionFromFills(rows.map(toFill));
    positions.set(k, pos);
    const bucket = mk(rows[0].venue, rows[0].mode);
    exposure[bucket] = (exposure[bucket] ?? 0) + pos.base * (marksFor(rows[0].venue)[rows[0].symbol] || pos.avgCost);
  }
  const pnlToday: Record<string, number> = {};
  for (const bucket of new Set(filled.map((o) => mk(o.venue, o.mode)))) {
    const [vid] = bucket.split("|") as [VenueId, string];
    pnlToday[bucket] = dayPnl(filled.filter((o) => mk(o.venue, o.mode) === bucket), marksFor(vid), dayOpen, dayStart);
  }
  const limits = {
    maxOrderUsd: Number(risk.max_order_usd), maxExposureUsd: Number(risk.max_exposure_usd),
    dailyLossLimitUsd: Number(risk.daily_loss_limit_usd), maxOrdersPerDay: Number(risk.max_orders_per_day), globalPause: !!risk.global_pause,
  };

  // 4. decisions ----------------------------------------------------------
  for (const s of strategies) {
    const p = trendParamsOf(s);
    const rotation = rotationParamsOf(s);
    const venue = d.venues[s.venue];
    const barMs = decisionBarMs(s.kind);
    const bucket = mk(s.venue, s.mode);

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
      const m = markets.get(mk(s.venue, sym));
      const sig = signalFor(s, sym);
      if (inFlight.has(key)) { report.skipped.push(`${key}: order in flight`); continue; }
      if (!m || !sig || sig.bars.length < p.slow + 2 || !sig.c1d.length) { report.skipped.push(`${key}: not enough candles`); continue; }
      const bars = sig.bars, dd = sig.c1d;
      const i = lastClosedIndex(bars, sig.barMs, d.now);
      const di = lastClosedIndex(dd, ONE_D, d.now);
      const barStart = barMs === ONE_D ? dd[di]?.start : bars[i]?.start;
      if (i < 0 || barStart == null) { report.skipped.push(`${key}: no closed bar`); continue; }
      // Decide once per closed bar: the previous decision for this pair names the bar it saw (fast path; the unique index is the guarantee).
      const prev = await d.db.select<{ bar_start: string }>("agent_decisions", `strategy_id=eq.${s.id}&symbol=eq.${encodeURIComponent(sym)}&select=bar_start&order=ts.desc&limit=1`);
      if (prev[0] && new Date(prev[0].bar_start).getTime() === barStart) { report.skipped.push(`${key}: bar ${new Date(barStart).toISOString()} already decided`); continue; }

      const pos = positions.get(key) ?? positionFromFills([]);
      const snap = buildSnapshot(sym, bars, i, dd.slice(0, di + 1), pos, d.now, p, undefined, (ONE_D / sig.barMs) * 365);
      const questions = jevQuestions(snap.state);
      let jr: JevResult;
      try { jr = await askJev(snap.state, questions, d.jev, d.fetchImpl); }
      catch (e) { jr = { provider: "none", model: null, answers: {}, inputTokens: 0, costUsd: 0, latencyMs: 0, errors: [msg(e)] }; }
      const a = jr.answers;
      const view: JevView = {
        healthy: a.healthy_trend?.type === "noul" ? a.healthy_trend.probability : null,
        caution: a.caution?.type === "score" ? a.caution.score : null,
        echoOk: a._state?.type === "choice" ? a._state.choice === sym : false,
        provider: jr.provider,
      };
      const rule = ruleFor(s.kind, snap, pos, p, { rank: ranks?.[sym], nowMs: d.now, rotation });
      const final = combineDecision(rule, view, { enterMin: num(s.params?.enterMin, 0.6), exitMax: num(s.params?.exitMax, 0.3), cautionExit: 1.75 });
      const mark = m.mark || snap.numbers.close;
      // Rotation slots share the capital among the symbols it may hold at once; the others split it evenly.
      const slots = s.kind === "rotation-1d" ? Math.max(1, rotation.topN) : Math.max(1, s.symbols.length);
      const orderUsd = final.action === "enter" ? Math.min(Number(s.capital_usd) / slots, limits.maxOrderUsd) : pos.base * mark;
      const ctx = { exposureUsd: exposure[bucket] ?? 0, ordersToday: ordersToday[bucket] ?? 0, dayPnlUsd: pnlToday[bucket] ?? 0, mode: s.mode };
      const gate = riskGate(final.action, orderUsd, ctx, limits);

      // The claim. A duplicate here means another tick got this bar first; nothing more happens for it.
      let dec: { id: number } | undefined;
      try {
        [dec] = await d.db.insert<{ id: number }>("agent_decisions", {
          strategy_id: s.id, venue: s.venue, symbol: sym, mode: s.mode, bar_start: new Date(barStart).toISOString(),
          state: snap.state, numbers: { ...snap.numbers, barStart, mark, orderUsd, exposureUsd: ctx.exposureUsd, ordersToday: ctx.ordersToday, pnlToday: ctx.dayPnlUsd, rank: ranks?.[sym] ?? null, signalVenue: s.signal_venue },
          questions, answers: a, provider: jr.provider, model: jr.model, latency_ms: jr.latencyMs, cost_usd: jr.costUsd,
          rule_action: rule.action, rule_reason: rule.reason, final_action: final.action,
          final_reason: `${final.reason} [${final.jevSaid}${jr.errors.length ? "; " + jr.errors.join(" | ").slice(0, 300) : ""}]`,
          risk_allowed: gate.allowed, risk_reason: gate.reason,
        });
      } catch (e) {
        if (/409|duplicate|unique/i.test(msg(e))) { report.skipped.push(`${key}: bar ${new Date(barStart).toISOString()} claimed by another tick`); continue; }
        throw e;
      }
      report.decisions.push({ strategy: s.id, venue: s.venue, symbol: sym, action: final.action, reason: final.reason, provider: jr.provider, allowed: gate.allowed });
      if (final.action === "hold" || !gate.allowed) continue;

      // 5. the order ----------------------------------------------------
      const q = m.quote, cfg = m.pair;
      if (!q || !cfg) { report.errors.push(`${key}: no quote/pair config on ${s.venue}`); continue; }
      const side: "buy" | "sell" = final.action === "enter" ? "buy" : "sell";
      const price = side === "buy" ? q.bid : q.ask;                  // resting at the touch, post-only
      const priceStr = price.toFixed((cfg.quote_step.split(".")[1] ?? "").length);
      const base = side === "buy" ? sizeBase(orderUsd, price, cfg) : sizeBase(pos.base * price, price, cfg);
      if (!base) { report.errors.push(`${key}: size under venue minimum`); continue; }
      const client_order_id = d.uuid();
      const request = { clientOrderId: client_order_id, symbol: sym, side, base, price: priceStr, postOnly: true, timeInForce: "gtc" };
      const row: Record<string, unknown> = {
        strategy_id: s.id, decision_id: dec?.id ?? null, venue: s.venue, symbol: sym, mode: s.mode, side, order_type: "limit",
        price: Number(priceStr), base_size: Number(base), client_order_id, request, state: "new",
      };
      if (s.mode === "live") {
        if (!risk.live_confirmed_at) { report.errors.push(`${key}: live order refused — live_confirmed_at is null`); continue; }
        if (!venue?.canTrade) { report.errors.push(`${key}: live order refused — no ${s.venue} credentials`); continue; }
        // The intent is durable BEFORE the venue is called: if the reply never lands, the next turn reconciles by client id.
        const [pending] = await d.db.insert<{ id: number }>("agent_orders", { ...row, state: "pending" });
        const placed = await venue.placeLimit(request);
        if (!placed.ok) {
          await d.db.update("agent_orders", `id=eq.${pending.id}`, { state: "rejected", cancelled_at: nowIso, response: { status: placed.status, error: placed.error, response: placed.response }, updated_at: nowIso });
          report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode: s.mode, side, price, base: Number(base), state: "rejected" });
          report.errors.push(`${key}: ${s.venue} rejected → ${placed.status} ${placed.error}`);
          continue;
        }
        await d.db.update("agent_orders", `id=eq.${pending.id}`, { state: placed.state, venue_order_id: placed.venueOrderId, response: placed.response, updated_at: nowIso });
        ordersToday[bucket] = (ordersToday[bucket] ?? 0) + 1;
        if (side === "buy") exposure[bucket] = (exposure[bucket] ?? 0) + orderUsd;
        report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode: s.mode, side, price, base: Number(base), state: placed.state });
        continue;
      }
      await d.db.insert("agent_orders", row, false);
      ordersToday[bucket] = (ordersToday[bucket] ?? 0) + 1;
      if (side === "buy") exposure[bucket] = (exposure[bucket] ?? 0) + orderUsd;
      report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode: s.mode, side, price, base: Number(base), state: "new" });
    }
  }
  return report;
}
