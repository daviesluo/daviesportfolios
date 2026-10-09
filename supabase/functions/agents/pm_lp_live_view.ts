// "Reward quotes live-prep"'s real-money book as the Agents page shows it: a row of LIVE and a page of its own (Davies,
// 2026-10-09: "网站的agents live页怎么看不到这个上线", the morning it went live), the way PR5's live executor became one
// (`quotesLiveRow`). On LIVE it is called "Reward quotes" (the same day: "live页里"Reward quotes live-prep"改名为"Reward
// quotes""), and its page's STATUS is the TESTING page's, its worst case replaced by the actual R (`status`). Every figure is read from the order path's own live rows (`pm_lp_*`, mode `live`) through the
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
//   fees       what each CONFIRMED trade's own record says we paid (`pmLiveFillFee`: a taker's `fee_rate_bps` by the docs'
//              formula, a maker's nothing); every order is post-only, so every fill so far is a maker's and pays nothing.
//              Taken off realised, as a fee is. The maker rebates Polymarket paid are the readout's own (`rebate_usd`).
//   the stop   −$75 on the fills' total plus what was paid (rebates not), exactly as the path judges it each turn.

import { bookPnl, settlementFills, tokenBooks, type PmFill, type PmSettlement } from "./pm_live.ts";
import { pmLiveFillFee } from "./pm_fees.ts";

const M = 60e3, DAY = 86400e3;
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
  /** The trade record's side for us and its fee rate (`detail.trade`), when the read asks for them. */
  trader_side?: string | null; fee_rate_bps?: string | number | null;
};
export type LpLiveRewardDayRow = {
  day: string; cond: string; minutes: number | string | null; minutes_scored: number | string | null; formula_usd: number | string | null;
  actual_usd: number | string | null; actual_sponsored_usd: number | string | null; rebate_usd: number | string | null;
};
/** The path's selection (`pm_lp_markets`), every day since it went live. */
export type LpLiveMarketRow = {
  day: string; cond: string; question: string | null; yes_token: string; no_token: string; reward_rate?: number | string | null; rank?: number | string | null;
};
/** The path's live minute (`pm_lp_minutes`, mode `live`) at its last turn: the formula's reward for our quotes and the pool's rate. */
export type LpLiveMinuteRow = { cond: string; rate: number | string | null; formula_usd: number | string | null };
/** The live total stop's event (`pm_lp_events`, kind `loss_stop_total`, mode `live`), if it has tripped. */
export type LpLiveStopRow = { minute: string; detail: unknown };

/** The columns each read takes. */
export const LP_LIVE_ORDER_COLUMNS = "id,ts,cond,token,outcome,side,price,size,state,size_matched,gate,reason,cancel_reason,filled_at,cancelled_at";
export const LP_LIVE_FILL_COLUMNS = "trade_id,hash,cond,token,side,price,size,status,match_time,trader_side:detail->trade->>trader_side,fee_rate_bps:detail->trade->>fee_rate_bps";
export const LP_LIVE_REWARD_COLUMNS = "day,cond,minutes,minutes_scored,formula_usd,actual_usd,actual_sponsored_usd,rebate_usd";
export const LP_LIVE_MARKET_COLUMNS = "day,cond,question,yes_token,no_token,reward_rate,rank";
export const LP_LIVE_MINUTE_COLUMNS = "cond,rate,formula_usd";

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const nz = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (d: string) => String(d).slice(0, 10);

/** When the book went live: the arming's time, else (disarmed since) its first live order's; null for neither. */
export function lpLiveSince(cfg: Pick<LpLiveConfigRow, "live_confirmed_at"> | null, firstLiveOrderTs: string | null): string | null {
  return cfg?.live_confirmed_at ?? firstLiveOrderTs ?? null;
}

/**
 * The dashboard's `lpLive`: live-prep's real-money book from its live rows, or null while it is no LIVE row — the
 * config unread, or never armed and never sent a live order. `open` are its live orders resting (pending or live),
 * `firstLive` its first live order's time, `fills` every fill of a live order (the table holds nothing else: a dry-run
 * never fills), `settlements` the path's own (written only by a live turn), `rewardDays` the readout's live rows,
 * `markets` the path's selection since it went live, `minutes` its live minute at the last turn (`state.minute`).
 */
export function lpLiveSummary(input: {
  config: LpLiveConfigRow | null; state: LpLiveStateRow | null; open: LpLiveOrderRow[]; firstLive: string | null; fills: LpLiveFillRow[];
  settlements: PmSettlement[]; rewardDays: LpLiveRewardDayRow[]; markets: LpLiveMarketRow[]; minutes?: LpLiveMinuteRow[]; stop: LpLiveStopRow | null;
  nowMs: number;
}) {
  const cfg = input.config;
  if (!cfg) return null;
  const armed = cfg.dry_run === false && !!cfg.live_confirmed_at;
  const tradedLive = input.open.length > 0 || !!input.firstLive || input.fills.length > 0;
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
  const fees = confirmed.reduce((s, f) => s + pmLiveFillFee(num(f.size), num(f.price), f.trader_side, f.fee_rate_bps), 0);
  let realisedFills = 0, heldCost = 0, heldValue = 0;
  const condOfToken = new Map<string, string>();
  for (const m of market.values()) { condOfToken.set(m.yes_token, m.cond); condOfToken.set(m.no_token, m.cond); }
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
  // Each market's part, as the TESTING page splits it: what Polymarket paid for it (rewards and rebates) and what its two
  // tokens made at the marks; the parts add up to the total.
  const partOf = (cond: string) => {
    const m = market.get(cond);
    const own: typeof books = {};
    for (const t of m ? [m.yes_token, m.no_token] : []) if (books[t]) own[t] = books[t];
    const fillsPnl = m ? bookPnl(own, { [m.yes_token]: marks[m.yes_token] ?? null, [m.no_token]: marks[m.no_token] ?? null }).total : 0;
    const rewardUsd = input.rewardDays.filter((r) => r.cond === cond).reduce((s, r) => s + num(r.actual_usd) + num(r.actual_sponsored_usd) + num(r.rebate_usd), 0);
    return { rewardUsd: r6(rewardUsd), fillsPnlUsd: r6(fillsPnl), totalUsd: r6(rewardUsd + fillsPnl) };
  };
  let best = -Infinity;
  for (const cond of new Set([...input.rewardDays.map((r) => r.cond), ...Object.keys(books).map((t) => condOfToken.get(t) ?? t)])) best = Math.max(best, partOf(cond).totalUsd);

  // QUOTES, the TESTING page's table from the live book: today's markets by rank, then those still held from an earlier
  // day. A market's quote is what its live orders rest at, in YES's book (a buy of YES or a sell of NO is a bid, a buy of
  // NO or a sell of YES an ask; the best of each side); its share is the formula's reward for our quotes at the last live
  // minute over the pool's rate a minute, as RW's page shows it.
  const restingOn = (cond: string) => {
    let bid: number | null = null, ask: number | null = null;
    for (const o of input.open.filter((x) => x.cond === cond)) {
      const p = num(o.price), isBid = (o.outcome === "yes") === (o.side === "BUY"), yes = o.outcome === "yes" ? p : r6(1 - p);
      if (isBid) bid = bid === null ? yes : Math.max(bid, yes); else ask = ask === null ? yes : Math.min(ask, yes);
    }
    return { bid, ask };
  };
  const minute = new Map((input.minutes ?? []).map((x) => [x.cond, x]));
  const heldOf = (cond: string) => {
    const m = market.get(cond);
    return m ? { yes: r6(books[m.yes_token]?.held ?? 0), no: r6(books[m.no_token]?.held ?? 0) } : { yes: 0, no: 0 };
  };
  const quotes: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const m of input.markets.filter((x) => dayOf(x.day) === today).sort((x, y) => num(x.rank) - num(y.rank))) {
    if (seen.has(m.cond)) continue;
    seen.add(m.cond);
    const q = restingOn(m.cond), x = minute.get(m.cond), f = nz(x?.formula_usd), rate = nz(x?.rate);
    quotes.push({
      cond: m.cond, q: m.question || qOf(m.cond), rank: num(m.rank), quoting: true, ratePerDay: nz(m.reward_rate),
      cls: q.bid !== null || q.ask !== null ? "matched" : "dark", bid: q.bid, ask: q.ask, ...heldOf(m.cond), mark: mid.get(m.cond) ?? null,
      share: f !== null && f > 0 && rate !== null && rate > 0 ? r6((f * 1440) / rate) : null, ...partOf(m.cond),
    });
  }
  for (const h of held) {
    const cond = String(h.cond);
    if (seen.has(cond)) continue;
    seen.add(cond);
    const q = restingOn(cond);
    quotes.push({
      cond, q: qOf(cond), rank: null, quoting: false, ratePerDay: null, cls: q.bid !== null || q.ask !== null ? "matched" : "dark", bid: q.bid, ask: q.ask,
      ...heldOf(cond), mark: mid.get(cond) ?? null, share: null, ...partOf(cond),
    });
  }
  const quotingToday = quotes.filter((x) => x.quoting).length;
  // FILLS, the TESTING page's table: each fill as the venue lists it, newest first; one not yet CONFIRMED is listed,
  // marked, and counted nowhere.
  const fillTs = (f: LpLiveFillRow) => (f.match_time ? Date.parse(f.match_time) : input.nowMs);
  const recentFills = [...input.fills].sort((a, b) => fillTs(b) - fillTs(a) || (a.trade_id < b.trade_id ? 1 : a.trade_id > b.trade_id ? -1 : 0))
    .slice(0, LP_LIVE_RECENT_FILLS).map((f) => ({
      tradeId: f.trade_id, ts: iso(fillTs(f)), minute: iso(Math.floor(fillTs(f) / M) * M), cond: f.cond, q: qOf(f.cond), side: f.side === "BUY" ? "bid" : "ask",
      price: num(f.price), size: num(f.size), tokenSide: f.side, outcome: outcomeOf(f.cond, f.token), tokenPrice: num(f.price),
      status: f.status, counted: f.status === "CONFIRMED",
    }));

  const limit = cfg.loss_total_usd == null ? null : num(cfg.loss_total_usd);
  const basis = pnl.total + paid;
  const lastTurn = input.state?.updated_at ?? null;
  const lagMinutes = lastTurn ? Math.max(0, Math.round((input.nowMs - Date.parse(lastTurn)) / M)) : null;
  const marketsAtWork = new Set([...input.open.map((o) => o.cond), ...held.map((h) => String(h.cond))]);
  return {
    armed, dryRun: !!cfg.dry_run, liveSince: lpLiveSince(cfg, input.firstLive), tradedLive,
    lastTurn, lagMinutes, running: lagMinutes !== null && lagMinutes <= LP_LIVE_STALE_MINUTES, lastError: input.state?.last_error ?? null,
    capUsd: num(cfg.cap_total_usd),
    valueUsd: r6(restingBuys + heldCost), restingBuysUsd: r6(restingBuys), costUsd: r6(heldCost), heldValueUsd: r6(heldValue),
    todayUsd: r6(pnl.day + paidToday),
    unrealisedUsd: r6(pnl.total - realisedFills),
    realisedUsd: r6(realisedFills + paid + rebates - fees), realisedFillsUsd: r6(realisedFills - fees), paidUsd: r6(paid), rebateUsd: r6(rebates),
    totalUsd: r6(pnl.total + paid + rebates - fees), feesUsd: r6(fees),
    // R, the actual over the formula on the live days whose payout has been read; null before the first is.
    formulaUsd: r6(formula), r: formula > 0 ? r6(paid / formula) : null,
    // The TESTING page's STATUS tiles, but R (ACTUAL) for its worst case: the largest market's part (TOP SHARE is it over
    // the total), the markets chosen today, and the markets still holding tokens.
    status: { bestMarketUsd: Number.isFinite(best) ? r6(best) : null, quoting: quotingToday, held: quotes.filter((x) => Number(x.yes) + Number(x.no) > 0).length },
    stop: {
      limitUsd: limit, fillsPnlUsd: r6(pnl.total), paidUsd: r6(paid), basisUsd: r6(basis), roomUsd: limit == null ? null : r6(limit + basis),
      trippedAt: input.stop?.minute ?? null,
    },
    // The last turn's gates, in the path's own words; a turn of the dry-run (the config disarmed) says so by its mode.
    gates: st && st.gates && typeof st.gates === "object"
      ? { mode: st.mode ?? null, armed: !!st.armed, verdicts: st.gates, openBlockedBy: st.openBlockedBy ?? null, reduceBlockedBy: st.reduceBlockedBy ?? null }
      : null,
    openOrders: input.open.length, markets: marketsAtWork.size, fills: confirmed.length,
    quotes, recentFills, days,
  };
}
