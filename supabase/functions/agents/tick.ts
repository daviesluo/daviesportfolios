// One turn of the agents' loop. Runs every five minutes from pg_cron and
// does, in order, for every strategy that is not paused:
//
//   1. refresh, from the strategy's OWN venue, the candles it reads (4h
//      and daily), the latest closed 5-minute candle, the touch and the
//      pair config for each symbol;
//   2. settle open orders — a paper order fills if the venue's last
//      5-minute candle traded through its price (and pays that venue's
//      maker fee), a live order is re-read from the venue; either kind is
//      cancelled after `STALE_TICKS` turns unfilled, a live one only after
//      the venue confirms and any partial fill has been read back;
//   3. on a NEWLY closed decision bar (4h for trend-4h, daily for
//      momentum-1d) and with no order in flight: build the categorical
//      state, ask Jev, apply the rulebook, apply the risk gate, record the
//      decision, and place the order it allows — as a resting post-only
//      limit at the touch, paper or live.
//
// Two venues, one loop. A strategy row names its venue; everything it
// sees and everything it does is that venue's — so a paper run on Kraken
// and a paper run on Revolut X are each a fair rehearsal of going live
// there, fee model included, and the dashboard can put them side by side.
//
// Everything the decision saw and everything the venue said is written
// down. Positions and P&L are never stored: `positionFromFills` derives
// them from the filled orders every time they are needed, so there is
// exactly one implementation of "what do we hold and what has it made".
//
// A live order needs THREE things at once: the strategy row says `live`,
// `agent_risk.live_confirmed_at` is set, and the risk gate allows it —
// plus, of course, credentials for that venue. Paper needs the gate only.
// The caps in `agent_risk` are per venue account (each holds its own
// funding), so exposure, order count and the daily loss are tallied per
// venue.

import { askJev, type JevEnv, type JevResult } from "../_shared/jev.ts";
import {
  buildSnapshot, combineDecision, DEFAULT_TREND, jevQuestions, positionFromFills, riskGate, ruleFor, sizeBase, unrealisedUsd,
  type Action, type Candle, type JevView, type PairConfig, type Position, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { paperFeeUsd, type Quote, type Venue, type VenueId } from "../_shared/venue.ts";
import type { Db } from "./db.ts";

export const STALE_TICKS = 3;                 // 15 minutes unfilled → cancel, re-quote next turn
const FOUR_H = 4 * 3600e3, ONE_D = 86400e3, FIVE_M = 5 * 60e3;

export type StrategyRow = {
  id: string; kind: StrategyKind; venue: VenueId; name: string; symbols: string[]; mode: "paper" | "live" | "paused";
  capital_usd: number; params: Record<string, number>;
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
  decisions: { strategy: string; venue: VenueId; symbol: string; action: Action; reason: string; provider: string; allowed: boolean }[];
  orders: { strategy: string; venue: VenueId; symbol: string; mode: string; side: string; price: number; base: number; state: string }[];
  settled: { id: number; state: string }[];
  skipped: string[];
  errors: string[];
};

type Market = { c4h: Candle[]; c1d: Candle[]; c5m: Candle | null; mark: number; quote?: Quote; pair?: PairConfig };

const mk = (venue: string, symbol: string) => `${venue}|${symbol}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The last CLOSED candle's index for a series of `spanMs` candles at `now`. */
export function lastClosedIndex(series: Candle[], spanMs: number, now: number): number {
  let i = series.length - 1;
  while (i >= 0 && series[i].start + spanMs > now) i--;
  return i;
}

/** Today's realised P&L plus the open positions' unrealised, over the rows given — the daily loss circuit breaker's input, one venue at a time. */
export function dayPnl(allFilled: OrderRow[], marks: Record<string, number>, dayStartMs: number): number {
  let realisedToday = 0, unrealised = 0;
  const groups = new Map<string, OrderRow[]>();
  for (const o of allFilled) {
    const k = `${o.strategy_id}|${o.symbol}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }
  for (const [k, rows] of groups) {
    const fills = rows.map(toFill);
    const pos = positionFromFills(fills);
    const before = positionFromFills(fills.filter((f) => f.ts < dayStartMs));
    realisedToday += pos.realisedUsd - before.realisedUsd;
    unrealised += unrealisedUsd(pos, marks[k.split("|")[1]] ?? pos.avgCost);
  }
  return realisedToday + unrealised;
}

export function toFill(o: OrderRow) {
  return {
    ts: new Date(o.filled_at ?? o.ts).getTime(), side: o.side,
    base: Number(o.filled_base || o.base_size), price: Number(o.avg_fill_price ?? o.price), feeUsd: Number(o.fee_usd || 0),
  };
}

function paramsOf(row: StrategyRow): TrendParams {
  const p = row.params ?? {};
  return {
    fast: p.fast ?? DEFAULT_TREND.fast, slow: p.slow ?? DEFAULT_TREND.slow,
    breakoutUp: p.breakoutUp ?? DEFAULT_TREND.breakoutUp, breakoutDown: p.breakoutDown ?? DEFAULT_TREND.breakoutDown,
    atrN: p.atrN ?? DEFAULT_TREND.atrN, atrStop: p.atrStop ?? DEFAULT_TREND.atrStop, volN: p.volN ?? DEFAULT_TREND.volN,
  };
}

export async function tick(d: TickDeps): Promise<TickReport> {
  const report: TickReport = { at: new Date(d.now).toISOString(), strategies: 0, markets: [], decisions: [], orders: [], settled: [], skipped: [], errors: [] };
  const nowIso = new Date(d.now).toISOString();
  const [riskRows, strategies, open] = await Promise.all([
    d.db.select<RiskRow>("agent_risk", "id=eq.1&select=*"),
    d.db.select<StrategyRow>("agent_strategies", "mode=in.(paper,live)&select=*"),
    d.db.select<OrderRow>("agent_orders", "state=in.(new,partially_filled)&select=*"),
  ]);
  const risk = riskRows[0];
  if (!risk) { report.errors.push("agent_risk row missing"); return report; }
  report.strategies = strategies.length;

  // 1. markets: every (venue, symbol) a strategy reads or an open order sits on
  const wanted = new Map<VenueId, Set<string>>();
  const want = (v: VenueId, s: string) => { if (!wanted.has(v)) wanted.set(v, new Set()); wanted.get(v)!.add(s); };
  for (const s of strategies) for (const sym of s.symbols) want(s.venue, sym);
  for (const o of open) want(o.venue, o.symbol);
  const markets = new Map<string, Market>();
  for (const [vid, syms] of wanted) {
    const venue = d.venues[vid];
    if (!venue) { report.errors.push(`${vid}: venue not configured`); continue; }
    const symbols = [...syms];
    let quotes: Record<string, Quote> = {}, pairs: Record<string, PairConfig> = {};
    try { quotes = await venue.quotes(symbols); } catch (e) { report.errors.push(`${vid}: quotes ${msg(e)}`); }
    try { pairs = await venue.pairs(symbols); } catch (e) { report.errors.push(`${vid}: pairs ${msg(e)}`); }
    for (const sym of symbols) {
      try {
        const [h4, dd, m5] = await Promise.all([
          venue.candles(sym, 240, d.now - 210 * FOUR_H, d.now),   // 210 bars: SMA 100 + breakout 55 with room
          venue.candles(sym, 1440, d.now - 45 * ONE_D, d.now),
          venue.candles(sym, 5, d.now - 3 * FIVE_M, d.now),
        ]);
        const closed5 = m5.filter((c) => c.start + FIVE_M <= d.now);
        const q = quotes[sym];
        const mark = q ? (q.bid + q.ask) / 2 : closed5.at(-1)?.close ?? h4.at(-1)?.close ?? 0;
        markets.set(mk(vid, sym), { c4h: h4, c1d: dd, c5m: closed5.at(-1) ?? null, mark, quote: q, pair: pairs[sym] });
        report.markets.push(mk(vid, sym));
        const rows = [...h4.map((c) => ({ ...c, interval_min: 240 })), ...dd.map((c) => ({ ...c, interval_min: 1440 }))]
          .map((c) => ({ venue: vid, symbol: sym, interval_min: c.interval_min, start: new Date(c.start).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
        if (rows.length) await d.db.upsert("agent_candles", rows, "venue,symbol,interval_min,start");
      } catch (e) {
        report.errors.push(`${vid} ${sym}: candles ${msg(e)}`);
      }
    }
  }

  // 2. open orders --------------------------------------------------------
  const inFlight = new Set<string>();
  const settle = async (o: OrderRow, patch: Record<string, unknown>, state: string) => {
    await d.db.update("agent_orders", `id=eq.${o.id}`, { ...patch, state, updated_at: nowIso });
    report.settled.push({ id: o.id, state });
  };
  for (const o of open) {
    const key = `${o.strategy_id}|${o.symbol}`;
    const venue = d.venues[o.venue];
    const m = markets.get(mk(o.venue, o.symbol));
    try {
      const ageTicks = Math.floor((d.now - new Date(o.ts).getTime()) / FIVE_M);
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

  // 3. what we hold, per venue -------------------------------------------
  const filled = await d.db.select<OrderRow>("agent_orders", "state=eq.filled&select=*&order=ts.asc");
  const dayStart = Math.floor(d.now / ONE_D) * ONE_D;
  const todayRows = await d.db.select<{ venue: VenueId }>("agent_orders", `ts=gte.${new Date(dayStart).toISOString()}&select=venue`);
  const ordersToday: Record<string, number> = {};
  for (const r of todayRows) ordersToday[r.venue] = (ordersToday[r.venue] ?? 0) + 1;
  const marksFor = (vid: VenueId): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, m] of markets) if (k.startsWith(`${vid}|`)) out[k.slice(vid.length + 1)] = m.mark;
    return out;
  };
  const positions = new Map<string, Position>();
  const exposure: Record<string, number> = {};
  const byKey = new Map<string, OrderRow[]>();
  for (const o of filled) { const k = `${o.strategy_id}|${o.symbol}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(o); }
  for (const [k, rows] of byKey) {
    const pos = positionFromFills(rows.map(toFill));
    positions.set(k, pos);
    const vid = rows[0].venue;
    exposure[vid] = (exposure[vid] ?? 0) + pos.base * (marksFor(vid)[rows[0].symbol] || pos.avgCost);
  }
  const pnlToday: Record<string, number> = {};
  for (const vid of new Set(filled.map((o) => o.venue))) pnlToday[vid] = dayPnl(filled.filter((o) => o.venue === vid), marksFor(vid), dayStart);
  const limits = {
    maxOrderUsd: Number(risk.max_order_usd), maxExposureUsd: Number(risk.max_exposure_usd),
    dailyLossLimitUsd: Number(risk.daily_loss_limit_usd), maxOrdersPerDay: Number(risk.max_orders_per_day), globalPause: !!risk.global_pause,
  };

  // 4. decisions ----------------------------------------------------------
  for (const s of strategies) {
    const p = paramsOf(s);
    const venue = d.venues[s.venue];
    const spanMs = s.kind === "momentum-1d" ? ONE_D : FOUR_H;
    for (const sym of s.symbols) {
      const key = `${s.id}|${sym}`;
      const m = markets.get(mk(s.venue, sym));
      if (inFlight.has(key)) { report.skipped.push(`${key}: order in flight`); continue; }
      if (!m || m.c4h.length < p.slow + 2 || !m.c1d.length) { report.skipped.push(`${key}: not enough candles`); continue; }
      const h4 = m.c4h, dd = m.c1d;
      const i = lastClosedIndex(h4, FOUR_H, d.now);
      const barStart = s.kind === "momentum-1d" ? dd[lastClosedIndex(dd, ONE_D, d.now)]?.start : h4[i]?.start;
      if (i < 0 || barStart == null) { report.skipped.push(`${key}: no closed bar`); continue; }
      // Decide once per closed bar: the previous decision for this pair names the bar it saw.
      const prev = await d.db.select<{ numbers: { barStart?: number } }>("agent_decisions", `strategy_id=eq.${s.id}&symbol=eq.${encodeURIComponent(sym)}&select=numbers&order=ts.desc&limit=1`);
      if (prev[0]?.numbers?.barStart === barStart) { report.skipped.push(`${key}: bar ${new Date(barStart).toISOString()} already decided`); continue; }

      const pos = positions.get(key) ?? positionFromFills([]);
      const dailyClosed = dd.slice(0, lastClosedIndex(dd, ONE_D, d.now) + 1);
      const snap = buildSnapshot(sym, h4, i, dailyClosed, pos, d.now, p);
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
      const rule = ruleFor(s.kind, snap, pos, p);
      const final = combineDecision(rule, view, { enterMin: s.params?.enterMin ?? 0.6, exitMax: s.params?.exitMax ?? 0.3, cautionExit: 1.75 });
      const mark = m.mark || snap.numbers.close;
      const perSymbol = Number(s.capital_usd) / Math.max(1, s.symbols.length);
      const orderUsd = final.action === "enter" ? Math.min(perSymbol, limits.maxOrderUsd) : pos.base * mark;
      const ctx = { exposureUsd: exposure[s.venue] ?? 0, ordersToday: ordersToday[s.venue] ?? 0, dayPnlUsd: pnlToday[s.venue] ?? 0, mode: s.mode };
      const gate = riskGate(final.action, orderUsd, ctx, limits);

      const [dec] = await d.db.insert<{ id: number }>("agent_decisions", {
        strategy_id: s.id, venue: s.venue, symbol: sym, mode: s.mode,
        state: snap.state, numbers: { ...snap.numbers, barStart, mark, orderUsd, exposureUsd: ctx.exposureUsd, ordersToday: ctx.ordersToday, pnlToday: ctx.dayPnlUsd },
        questions, answers: a, provider: jr.provider, model: jr.model, latency_ms: jr.latencyMs, cost_usd: jr.costUsd,
        rule_action: rule.action, rule_reason: rule.reason, final_action: final.action,
        final_reason: `${final.reason} [${final.jevSaid}${jr.errors.length ? "; " + jr.errors.join(" | ").slice(0, 300) : ""}]`,
        risk_allowed: gate.allowed, risk_reason: gate.reason,
      });
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
        const placed = await venue.placeLimit(request);
        if (!placed.ok) {
          await d.db.insert("agent_orders", { ...row, state: "rejected", response: { status: placed.status, error: placed.error, response: placed.response } }, false);
          report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode: s.mode, side, price, base: Number(base), state: "rejected" });
          report.errors.push(`${key}: ${s.venue} rejected → ${placed.status} ${placed.error}`);
          continue;
        }
        row.venue_order_id = placed.venueOrderId;
        row.response = placed.response;
        row.state = placed.state;
      }
      await d.db.insert("agent_orders", row, false);
      ordersToday[s.venue] = (ordersToday[s.venue] ?? 0) + 1;
      if (side === "buy") exposure[s.venue] = (exposure[s.venue] ?? 0) + orderUsd;
      report.orders.push({ strategy: s.id, venue: s.venue, symbol: sym, mode: s.mode, side, price, base: Number(base), state: String(row.state) });
    }
  }
  return report;
}
