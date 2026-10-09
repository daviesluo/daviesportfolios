// "Reward quotes live-prep"'s real-money book as the Agents page shows it: a row of LIVE and a page of its own (Davies,
// 2026-10-09: "网站的agents live页怎么看不到这个上线", the morning it went live), the way PR5's live executor became one
// (`quotesLiveRow`). Every figure is read from the order path's own live rows (`pm_lp_*`, mode `live`) through the
// functions the path judges its stop with: `tokenBooks` on its CONFIRMED fills and its settlements, `bookPnl` at the
// mids its last turn read. Nothing of the paper layer (`pm_lpprep_*`) or of a dry-run row is read, so its TESTING row
// stays what it was and the two never add into one another.
//
// What the row's cells are:
//   funded     the config's total cap (`cap_total_usd`, $320): the most the path may commit, as PR5's funded is its
//              config's capital. The pUSD the account held at arming is not it: that balance also holds the room under
//              the −$75 stop and the reserve the cap was set below, and the state's `pusd` moves with every fill.
//   deployed   the collateral of its resting live buys (price × what is left of each) and what it holds at cost.
//   today      the day's realised P&L plus every holding against its cost (`bookPnl`'s day, the path's own day reading;
//              live-prep keeps no opening marks, having no day stop), plus what Polymarket paid for today's date.
//   unrealised what it holds at the last turn's mids against its cost.
//   realised   what its sells and settlements realised, plus the rewards Polymarket paid (native and sponsored) and the
//              maker rebates, as its readout booked them (`pm_lp_reward_days`, live rows). The formula's rewards are
//              shown apart and counted nowhere.
//   fees       none: every order is post-only, a maker's, and Polymarket's CLOB charges the taker.
//   the stop   −$75 on the fills' total plus what was paid (rebates not), exactly as the path judges it each turn.

import { bookPnl, settlementFills, tokenBooks, type PmFill, type PmSettlement } from "./pm_live.ts";

const M = 60e3, DAY = 86400e3;
/** The newest ended orders the page lists. */
export const LP_LIVE_RECENT_ORDERS = 30;
/** The newest fills the page lists. */
export const LP_LIVE_RECENT_FILLS = 50;
/** The path turns every minute: a last turn older than this means it has stopped. */
export const LP_LIVE_STALE_MINUTES = 5;

export type LpLiveConfigRow = { dry_run: boolean; live_confirmed_at: string | null; cap_total_usd: number | string | null; loss_total_usd: number | string | null };
export type LpLiveStateRow = { state: unknown; updated_at: string | null; last_error: string | null };
export type LpLiveOrderRow = {
  id: number; ts: string; cond: string; token: string; outcome: "yes" | "no"; side: "BUY" | "SELL"; price: number | string; size: number | string;
  state: string; size_matched: number | string | null; gate: string | null; reason: string | null; cancel_reason: string | null;
  filled_at: string | null; cancelled_at: string | null;
};
export type LpLiveFillRow = {
  trade_id: string; hash: string; cond: string; token: string; side: "BUY" | "SELL"; price: number | string; size: number | string; status: string;
  match_time: string | null;
};
export type LpLiveRewardDayRow = {
  day: string; cond: string; minutes: number | string | null; minutes_scored: number | string | null; formula_usd: number | string | null;
  actual_usd: number | string | null; actual_sponsored_usd: number | string | null; rebate_usd: number | string | null;
};
export type LpLiveMarketRow = { day: string; cond: string; question: string | null; yes_token: string; no_token: string };
/** The live total stop's event (`pm_lp_events`, kind `loss_stop_total`, mode `live`), if it has tripped. */
export type LpLiveStopRow = { minute: string; detail: unknown };

/** The columns each read takes. */
export const LP_LIVE_ORDER_COLUMNS = "id,ts,cond,token,outcome,side,price,size,state,size_matched,gate,reason,cancel_reason,filled_at,cancelled_at";
export const LP_LIVE_FILL_COLUMNS = "trade_id,hash,cond,token,side,price,size,status,match_time";
export const LP_LIVE_REWARD_COLUMNS = "day,cond,minutes,minutes_scored,formula_usd,actual_usd,actual_sponsored_usd,rebate_usd";

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (d: string) => String(d).slice(0, 10);

/** The conditions a summary needs named and marked: those of every fill and every order it lists. */
export function lpLiveConds(rows: { fills: Array<{ cond: string }>; open: Array<{ cond: string }>; recent: Array<{ cond: string }> }): string[] {
  return [...new Set([...rows.fills, ...rows.open, ...rows.recent].map((r) => r.cond))].sort();
}

/**
 * The dashboard's `lpLive`: live-prep's real-money book from its live rows, or null while it is no LIVE row — the
 * config unread, or never armed and never sent a live order. `open` are its live orders resting (pending or live),
 * `recent` its newest ended live orders, `fills` every fill of a live order (the table holds nothing else: a dry-run
 * never fills), `settlements` the path's own (written only by a live turn), `rewardDays` the readout's live rows,
 * `markets` the path's selection rows for the conditions named, any day, newest first.
 */
export function lpLiveSummary(input: {
  config: LpLiveConfigRow | null; state: LpLiveStateRow | null; open: LpLiveOrderRow[]; recent: LpLiveOrderRow[]; fills: LpLiveFillRow[];
  settlements: PmSettlement[]; rewardDays: LpLiveRewardDayRow[]; markets: LpLiveMarketRow[]; stop: LpLiveStopRow | null; nowMs: number;
}) {
  const cfg = input.config;
  if (!cfg) return null;
  const armed = cfg.dry_run === false && !!cfg.live_confirmed_at;
  const tradedLive = input.open.length > 0 || input.recent.length > 0 || input.fills.length > 0;
  if (!armed && !tradedLive) return null;
  const todayStart = Math.floor(input.nowMs / DAY) * DAY, today = iso(todayStart).slice(0, 10);

  // Each condition's question and tokens, from its newest selection row.
  const market = new Map<string, LpLiveMarketRow>();
  for (const m of [...input.markets].sort((a, b) => dayOf(b.day).localeCompare(dayOf(a.day)))) if (!market.has(m.cond)) market.set(m.cond, m);
  const qOf = (cond: string) => market.get(cond)?.question ?? "";
  const outcomeOf = (cond: string, token: string): "yes" | "no" | null => {
    const m = market.get(cond);
    return !m ? null : m.yes_token === token ? "yes" : m.no_token === token ? "no" : null;
  };

  // The last turn's books, as the path marks them: YES at the mid, NO at 1 − mid.
  const st = (input.state?.state ?? null) as { markets?: Array<{ cond?: string; book?: { bestBid?: number; bestAsk?: number } | null }>; gates?: Record<string, boolean | null>; openBlockedBy?: string | null; reduceBlockedBy?: string | null; mode?: string; armed?: boolean } | null;
  const mid = new Map<string, number>();
  for (const x of Array.isArray(st?.markets) ? st!.markets! : []) {
    const b = x?.book;
    if (x?.cond && b && Number.isFinite(b.bestBid) && Number.isFinite(b.bestAsk)) mid.set(x.cond, (Number(b.bestBid) + Number(b.bestAsk)) / 2);
  }
  const marks: Record<string, number | null> = {};
  for (const [cond, m] of market) {
    const x = mid.get(cond);
    marks[m.yes_token] = x ?? null; marks[m.no_token] = x == null ? null : 1 - x;
  }

  // CONFIRMED fills only, ordered as the path orders them (a buy first at a tie), and the settlements as the sells they amount to.
  const confirmed = input.fills.filter((f) => f.status === "CONFIRMED");
  const fills = confirmed.map((f): PmFill => ({ token: f.token, side: f.side, price: num(f.price), size: num(f.size), ts: f.match_time ? Date.parse(f.match_time) : input.nowMs }))
    .sort((a, b) => a.ts - b.ts || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const books = tokenBooks([...fills, ...settlementFills(input.settlements)], todayStart);
  const pnl = bookPnl(books, marks);
  let realisedFills = 0, heldCost = 0, heldValue = 0;
  const condOfToken = new Map<string, string>();
  for (const f of input.fills) condOfToken.set(f.token, f.cond);
  const held: Array<Record<string, unknown>> = [];
  for (const [token, t] of Object.entries(books)) {
    realisedFills += t.realised;
    if (!(t.held > 0)) continue;
    const cost = t.held * t.avgCost, mark = marks[token] ?? null;
    heldCost += cost; heldValue += mark == null ? cost : t.held * mark;
    const cond = condOfToken.get(token) ?? "";
    held.push({
      cond, q: qOf(cond), outcome: outcomeOf(cond, token), shares: r6(t.held), avgCost: r6(t.avgCost), mark: mark == null ? null : r6(mark), costUsd: r6(cost),
      valueUsd: r6(mark == null ? cost : t.held * mark), unrealisedUsd: r6(mark == null ? 0 : t.held * (mark - t.avgCost)),
    });
  }
  held.sort((a, b) => String(a.q).localeCompare(String(b.q)) || String(a.outcome).localeCompare(String(b.outcome)));

  // What Polymarket paid, by the readout's live rows, and the formula's figure beside it.
  type Day = { day: string; markets: number; minutesScored: number; formulaUsd: number; paidUsd: number; rebateUsd: number };
  const byDay = new Map<string, Day>();
  for (const r of input.rewardDays) {
    const d = dayOf(r.day);
    const x = byDay.get(d) ?? { day: d, markets: 0, minutesScored: 0, formulaUsd: 0, paidUsd: 0, rebateUsd: 0 };
    x.markets++; x.minutesScored += num(r.minutes_scored); x.formulaUsd += num(r.formula_usd);
    x.paidUsd += num(r.actual_usd) + num(r.actual_sponsored_usd); x.rebateUsd += num(r.rebate_usd);
    byDay.set(d, x);
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({
    day: d.day, markets: d.markets, minutesScored: d.minutesScored, formulaUsd: r6(d.formulaUsd), paidUsd: r6(d.paidUsd), rebateUsd: r6(d.rebateUsd),
    r: d.formulaUsd > 0 ? r6(d.paidUsd / d.formulaUsd) : null,
  }));
  const sum = (f: (d: Day) => number, only?: (d: Day) => boolean) => [...byDay.values()].filter((d) => !only || only(d)).reduce((s, d) => s + f(d), 0);
  const paid = sum((d) => d.paidUsd), rebates = sum((d) => d.rebateUsd), formula = sum((d) => d.formulaUsd);
  const paidToday = sum((d) => d.paidUsd + d.rebateUsd, (d) => d.day === today);

  // Resting buys tie up their collateral: price × what is left of each.
  const restingBuys = input.open.filter((o) => o.side === "BUY").reduce((s, o) => s + num(o.price) * Math.max(0, num(o.size) - num(o.size_matched)), 0);
  const orderOut = (o: LpLiveOrderRow) => ({
    id: Number(o.id), ts: o.ts, cond: o.cond, q: qOf(o.cond), outcome: o.outcome, side: o.side, price: num(o.price), size: num(o.size),
    matched: num(o.size_matched), state: o.state, gate: o.gate ?? null, reason: o.reason ?? null, cancelReason: o.cancel_reason ?? null,
    endedAt: o.filled_at ?? o.cancelled_at ?? null,
  });
  const fillTs = (f: LpLiveFillRow) => (f.match_time ? Date.parse(f.match_time) : input.nowMs);
  const recentFills = [...input.fills].sort((a, b) => fillTs(b) - fillTs(a) || (a.trade_id < b.trade_id ? 1 : a.trade_id > b.trade_id ? -1 : 0))
    .slice(0, LP_LIVE_RECENT_FILLS).map((f) => ({
      tradeId: f.trade_id, ts: f.match_time, cond: f.cond, q: qOf(f.cond), outcome: outcomeOf(f.cond, f.token), side: f.side, price: num(f.price), size: num(f.size),
      status: f.status, counted: f.status === "CONFIRMED",
    }));

  const limit = cfg.loss_total_usd == null ? null : num(cfg.loss_total_usd);
  const basis = pnl.total + paid;
  const lastTurn = input.state?.updated_at ?? null;
  const lagMinutes = lastTurn ? Math.max(0, Math.round((input.nowMs - Date.parse(lastTurn)) / M)) : null;
  const marketsAtWork = new Set([...input.open.map((o) => o.cond), ...held.map((h) => String(h.cond))]);
  return {
    armed, dryRun: !!cfg.dry_run, liveSince: cfg.live_confirmed_at, tradedLive,
    lastTurn, lagMinutes, running: lagMinutes !== null && lagMinutes <= LP_LIVE_STALE_MINUTES, lastError: input.state?.last_error ?? null,
    capUsd: num(cfg.cap_total_usd),
    valueUsd: r6(restingBuys + heldCost), restingBuysUsd: r6(restingBuys), costUsd: r6(heldCost), heldValueUsd: r6(heldValue),
    todayUsd: r6(pnl.day + paidToday),
    unrealisedUsd: r6(pnl.total - realisedFills),
    realisedUsd: r6(realisedFills + paid + rebates), realisedFillsUsd: r6(realisedFills), paidUsd: r6(paid), rebateUsd: r6(rebates),
    totalUsd: r6(pnl.total + paid + rebates), feesUsd: 0,
    formulaUsd: r6(formula), r: formula > 0 ? r6(paid / formula) : null,
    stop: {
      limitUsd: limit, fillsPnlUsd: r6(pnl.total), paidUsd: r6(paid), basisUsd: r6(basis), roomUsd: limit == null ? null : r6(limit + basis),
      trippedAt: input.stop?.minute ?? null,
    },
    // The last turn's gates, in the path's own words; a turn of the dry-run (the config disarmed) says so by its mode.
    gates: st && st.gates && typeof st.gates === "object"
      ? { mode: st.mode ?? null, armed: !!st.armed, verdicts: st.gates, openBlockedBy: st.openBlockedBy ?? null, reduceBlockedBy: st.reduceBlockedBy ?? null }
      : null,
    openOrders: input.open.length, markets: marketsAtWork.size, fills: confirmed.length,
    resting: [...input.open].sort((a, b) => Number(b.id) - Number(a.id)).map(orderOut),
    recent: [...input.recent].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, LP_LIVE_RECENT_ORDERS).map(orderOut),
    recentFills, held, days,
  };
}
