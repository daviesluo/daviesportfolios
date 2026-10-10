// "Reward quotes live-prep"'s real-money book as the Agents page shows it: a row of LIVE and a page of its own (Davies,
// 2026-10-09: "网站的agents live页怎么看不到这个上线", the morning it went live), the way PR5's live executor became one
// (`quotesLiveRow`). On LIVE it is called "Reward quotes" (the same day: "live页里"Reward quotes live-prep"改名为"Reward
// quotes""), and its page's STATUS is the TESTING page's, its worst case replaced by the actual R (`status`). Every figure is read from the order path's own live rows (`pm_lp_*`, mode `live`) through the
// functions the path judges its stop with: `tokenBooks` on its CONFIRMED fills and its settlements, `bookPnl` at the
// mids its last turn read. Nothing of the paper layer (`pm_lpprep_*`) or of a dry-run row is read, so its TESTING row
// stays what it was and the two never add into one another.
//
// What the row's cells are:
//   funded     since 2026-10-10 (Addendum 10) the money Davies put in (`fundedUsd`): pUSD + what the CONFIRMED fills spent net
//              − what redeemed settlements paid in − the rewards and rebates paid, kept by the path (`lpFunding`) and moved
//              only by a deposit or a withdrawal it books; until the path has booked it, its last turn's reading of the same
//              sum; never the cap (`capUsd`, `state.limits.capTotal`, which stays the most its buys may commit).
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
  /** The formula over the minutes Polymarket read both our sides scoring (Addendum 9: what R and the estimate rest on). */
  formula_scored_usd?: number | string | null;
  actual_usd: number | string | null; actual_sponsored_usd: number | string | null; rebate_usd: number | string | null;
};
/** The path's selection (`pm_lp_markets`), every day since it went live. */
export type LpLiveMarketRow = {
  day: string; cond: string; question: string | null; yes_token: string; no_token: string; reward_rate?: number | string | null; rank?: number | string | null;
};
/** The path's live minute (`pm_lp_minutes`, mode `live`) at its last turn: the formula's reward for our quotes and the pool's rate. */
export type LpLiveMinuteRow = { cond: string; rate: number | string | null; formula_usd: number | string | null };
/**
 * One market's live hour (`pm_lp_live_hours`, migration 0107: `pm_lp_minutes`' live rows of the last 48 hours summed by
 * UTC hour and market): the minutes the path recorded in it and the formula's reward for our quotes over them; since
 * 0111 (2026-10-10, Addendum 9) also the formula over the minutes Polymarket read both our sides scoring.
 */
export type LpLiveHourRow = { hour: string; cond: string; minutes: number | string | null; formula_usd: number | string | null; formula_scored_usd?: number | string | null };
/** The live total stop's event (`pm_lp_events`, kind `loss_stop_total`, mode `live`), if it has tripped. */
export type LpLiveStopRow = { minute: string; detail: unknown };

/** The columns each read takes. */
export const LP_LIVE_ORDER_COLUMNS = "id,ts,cond,token,outcome,side,price,size,state,size_matched,gate,reason,cancel_reason,filled_at,cancelled_at";
export const LP_LIVE_FILL_COLUMNS = "trade_id,hash,cond,token,side,price,size,status,match_time,trader_side:detail->trade->>trader_side,fee_rate_bps:detail->trade->>fee_rate_bps";
export const LP_LIVE_REWARD_COLUMNS = "day,cond,minutes,minutes_scored,formula_usd,formula_scored_usd,actual_usd,actual_sponsored_usd,rebate_usd";
export const LP_LIVE_MARKET_COLUMNS = "day,cond,question,yes_token,no_token,reward_rate,rank";
export const LP_LIVE_MINUTE_COLUMNS = "cond,rate,formula_usd";
export const LP_LIVE_HOUR_COLUMNS = "hour,cond,minutes,formula_usd,formula_scored_usd";
/** The view the dashboard reads the day's formula from (0107). */
export const LP_LIVE_HOURS_VIEW = "pm_lp_live_hours";

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
 * A live day whose readout's scored formula was measured on a stale programme, read instead at its like-for-like figure
 * (the pre-registration's Addendum 10; Davies' main session, 2026-10-10). 2026-10-09 was quoted all day on the 00:00
 * selection's programmes, which Polymarket cut during the day, so its `formula_scored_usd` priced the minutes Polymarket
 * scored at rates it no longer paid: R 0.33. Its like-for-like formula is each of those minutes' recorded formula times
 * the rate the CLOB's listing showed at that minute over the selected rate (`backtests/lpcfg/scripts/rtrue.py`, its output
 * `results/rtrue.txt`): $8.081876 in all, R = 6.524180 / 8.081876 = 0.807. The table is never written to: the readout's
 * rows stay as read, and only the figure R is calibrated on is this. Days from 2026-10-10 on are measured with the
 * reward check in place and stand as read.
 */
export const LP_R_DAY_CORRECTIONS: Readonly<Record<string, { source: string; formulaScoredUsd: Readonly<Record<string, number>> }>> = {
  "2026-10-09": {
    source: "docs/agents/backtests/lpcfg/results/rtrue.txt",
    formulaScoredUsd: {
      "0x045fdf4be2f890a3f846357a5160834685bb7dfae65909d3d307e5547898e1ad": 0.879838,
      "0x5b3350e20f05e072422dbb35a02cc87a7c83c63052794a9d91a3c25c8c1f5dd0": 0.314623,
      "0x5fec667514efa90a507dc672f18706a38eff7643cb80e77be606219da1fa2ad0": 1.884818,
      "0x9235351ee3dd6313185e3b7d75730d3be90cf8c736985fa03ebb69cece650522": 1.973267,
      "0xa326c49fad38dd03d04d67c5acb334f4fb851a88784153b5e55bec1a5d75e96b": 0.968556,
      "0xecc209a690169d2ccf22be5db33e42bec5ff01930e9773d2ccc1ab0ed81e6301": 0.346739,
      "0xeee7384867f13b7aa044eb5c52cb52cf193e4f520aa1349b7f3f63a98857eb87": 0.897922,
      "0xf050353934ca8adbf3a2706a763afd2190c27f2e067daf28d5ccb060894ca337": 0.0,
      "0xf6f3f159e6d96c5f875705c1257b02b87711fa7c08edac71a73e7dbbea984978": 0.65654,
      "0xfbd3437ca9a83c2d96f09df6a9278451a175dc7ed155cc6ac890064410df74c4": 0.159572,
    },
  },
};
/** A live reward-day row's scored formula, as R is calibrated on it: the readout's, or its day's like-for-like figure. */
export function scoredFormulaOf(r: Pick<LpLiveRewardDayRow, "day" | "cond" | "formula_scored_usd">): number {
  const c = LP_R_DAY_CORRECTIONS[dayOf(r.day)]?.formulaScoredUsd;
  return c && r.cond in c ? c[r.cond] : num(r.formula_scored_usd);
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
  /** The live hours of the last two days (`pm_lp_live_hours`): today's rewards are estimated from them (`lpRewardEstimate`). */
  hours?: LpLiveHourRow[];
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

  // What Polymarket paid, by the readout's live rows, and the formula's figure beside it: since 2026-10-10 (Addendum 9)
  // the formula over the minutes Polymarket read both our sides scoring (`formula_scored_usd`), which R is over; the whole
  // formula, scored or not, is `formulaAllUsd`. On 2026-10-09 the whole formula counted programmes Polymarket had already
  // cut (backtests/lpcfg/): R over it read 0.04, over the scored minutes about 0.33.
  type Day = { day: string; markets: number; minutesScored: number; formulaUsd: number; formulaAllUsd: number; paidUsd: number; rebateUsd: number };
  const byDay = new Map<string, Day>();
  for (const r of input.rewardDays) {
    const d = dayOf(r.day);
    const x = byDay.get(d) ?? { day: d, markets: 0, minutesScored: 0, formulaUsd: 0, formulaAllUsd: 0, paidUsd: 0, rebateUsd: 0 };
    x.markets++; x.minutesScored += num(r.minutes_scored); x.formulaUsd += scoredFormulaOf(r); x.formulaAllUsd += num(r.formula_usd);
    x.paidUsd += num(r.actual_usd) + num(r.actual_sponsored_usd); x.rebateUsd += num(r.rebate_usd);
    byDay.set(d, x);
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({
    day: d.day, markets: d.markets, minutesScored: d.minutesScored, formulaUsd: r6(d.formulaUsd), formulaAllUsd: r6(d.formulaAllUsd), paidUsd: r6(d.paidUsd), rebateUsd: r6(d.rebateUsd),
    r: d.formulaUsd > 0 ? r6(d.paidUsd / d.formulaUsd) : null,
  }));
  const sum = (f: (d: Day) => number, only?: (d: Day) => boolean) => [...byDay.values()].filter((d) => !only || only(d)).reduce((s, d) => s + f(d), 0);
  const paid = sum((d) => d.paidUsd), rebates = sum((d) => d.rebateUsd), formula = sum((d) => d.formulaUsd), formulaAll = sum((d) => d.formulaAllUsd);
  const paidToday = sum((d) => d.paidUsd + d.rebateUsd, (d) => d.day === today);

  // Resting buys tie up their collateral: price × what is left of each.
  const restingBuys = input.open.filter((o) => o.side === "BUY").reduce((s, o) => s + num(o.price) * Math.max(0, num(o.size) - num(o.size_matched)), 0);
  // Each market's part, as the TESTING page splits it: what Polymarket paid for it (rewards and rebates) and what its two
  // tokens made at the marks; the parts add up to the total.
  // Today's rewards, estimated, and each market's rewards not yet read at its point R (`lpRewardEstimate`).
  const estimate = lpRewardEstimate({ rewardDays: input.rewardDays, hours: input.hours ?? [], nowMs: input.nowMs });
  const partOf = (cond: string) => {
    const m = market.get(cond);
    const own: typeof books = {};
    for (const t of m ? [m.yes_token, m.no_token] : []) if (books[t]) own[t] = books[t];
    const fillsPnl = m ? bookPnl(own, { [m.yes_token]: marks[m.yes_token] ?? null, [m.no_token]: marks[m.no_token] ?? null }).total : 0;
    const rewardUsd = input.rewardDays.filter((r) => r.cond === cond).reduce((s, r) => s + num(r.actual_usd) + num(r.actual_sponsored_usd) + num(r.rebate_usd), 0);
    // LIVE's QUOTES (Davies, 2026-10-09: "avg cost列删了，换成Rewards(est.)…之后的Total也改成Total(est.)"): what was paid
    // plus what the days not yet read have earned at the market's point R, and the total with it. Shown there only: every
    // other figure, the scoreboard's included, counts what was paid.
    const rewardEst = rewardUsd + (estimate.markets[cond]?.estUsd ?? 0);
    return {
      rewardUsd: r6(rewardUsd), fillsPnlUsd: r6(fillsPnl), totalUsd: r6(rewardUsd + fillsPnl),
      rewardEstUsd: r6(rewardEst), totalEstUsd: r6(rewardEst + fillsPnl),
    };
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
  // What it holds of each token: QUOTES' Held (its Avg cost column went the same day for Rewards (est.)).
  const heldOf = (cond: string) => {
    const m = market.get(cond);
    if (!m) return { yes: 0, no: 0 };
    const y = books[m.yes_token], n = books[m.no_token];
    return { yes: r6(y?.held ?? 0), no: r6(n?.held ?? 0) };
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
  // QUOTING TODAY is the current set (Addendum 13): today's markets less those the path's last turn had out (the reward
  // check, the backstop, the AI rule, a refill's replaced market: `state.lp.outNow`); without that reading, today's markets.
  const outNow = (st as { lp?: { outNow?: unknown } } | null)?.lp?.outNow;
  const outSet = new Set(Array.isArray(outNow) ? outNow.map(String) : []);
  const quotingToday = quotes.filter((x) => x.quoting && !outSet.has(String(x.cond))).length;
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
    capUsd: (() => { const c = Number((st as { limits?: { capTotal?: unknown } } | null)?.limits?.capTotal); return Number.isFinite(c) && c >= 0 ? c : num(cfg.cap_total_usd); })(),
    // FUNDED (Addendum 10; Davies: "子页面中的FUNDED得显示我实际真实投入的钱"): the money put in, as the path's last live turn
    // booked it (`lpFunding`, `state.lp.funding`); null until it has, when the row falls back to the cap.
    // Until the path has booked it, this turn's reading of it (`fundingResidual`); never the cap (Davies, 2026-10-10:
    // "FUNDED还是显示的是$322，而不是我实际投入的402左右"). Null when neither is there: the page shows a dash.
    ...(() => {
      const lp = (st as { lp?: { funding?: { depositUsd?: unknown }; fundingResidual?: { usd?: unknown } } } | null)?.lp;
      const f = Number(lp?.funding?.depositUsd), r = Number(lp?.fundingResidual?.usd);
      return Number.isFinite(f) && f > 0 ? { fundedUsd: r6(f), fundedBasis: "booked" as const }
        : Number.isFinite(r) && r > 0 ? { fundedUsd: r6(r), fundedBasis: "reading" as const } : { fundedUsd: null, fundedBasis: null };
    })(),
    valueUsd: r6(restingBuys + heldCost), restingBuysUsd: r6(restingBuys), costUsd: r6(heldCost), heldValueUsd: r6(heldValue),
    todayUsd: r6(pnl.day + paidToday),
    unrealisedUsd: r6(pnl.total - realisedFills),
    realisedUsd: r6(realisedFills + paid + rebates - fees), realisedFillsUsd: r6(realisedFills - fees), paidUsd: r6(paid), rebateUsd: r6(rebates),
    totalUsd: r6(pnl.total + paid + rebates - fees), feesUsd: r6(fees),
    // R, the actual over the formula on the live days whose payout has been read; null before the first is.
    formulaUsd: r6(formula), formulaAllUsd: r6(formulaAll), r: formula > 0 ? r6(paid / formula) : null,
    // The TESTING page's STATUS tiles, but R (ACTUAL) for its worst case: the largest market's part (TOP SHARE is it over
    // the total), the markets chosen today, and the markets still holding tokens.
    status: { bestMarketUsd: Number.isFinite(best) ? r6(best) : null, quoting: quotingToday, held: quotes.filter((x) => Number(x.yes) + Number(x.no) > 0).length },
    // Today's rewards, estimated (STATUS' last tile on LIVE, Davies 2026-10-09: "预估今日rewards收益…给个范围（最低-最优）").
    estimate,
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

// ------------------------------------------------------------------ today's rewards, estimated (LIVE's STATUS tile)

/**
 * What R is before any payout has been read, and how much a prior weighs against the days that have been. The studies
 * priced R at 0.2, 0.4 and 1 (Phase A, LPSELF, LPCAP); nothing measured says where in that span it lies, so the prior is
 * the span itself, read as an 80 % band on the log scale: median √(0.2 × 1) = 0.447, σ = ln(1 / 0.2) / (2 × 1.2816).
 * It weighs as two days of the record (`days`): after two live days it carries half the weight, after eight a fifth.
 */
export const LP_EST_PRIOR = { low: 0.2, high: 1, days: 2 } as const;
/** The two-sided 80 % normal quantile: the band is the 10th to the 90th percentile. */
export const LP_EST_Z = 1.2815515655446004;
/** A day's R is read on the log scale; a day paid nothing reads as this, not as minus infinity. */
export const LP_EST_R_FLOOR = 0.02;
/** A live day counts towards R only when its formula is at least this: a few cents of formula say nothing of R. */
export const LP_EST_MIN_DAY_FORMULA_USD = 1;
/** Polymarket pays nothing under $1 (reference §2d); the low end counts a market's projected day as nothing below it. */
export const LP_EST_MIN_PAYOUT_USD = 1;
/** The recent rate of formula reward: the newest recorded hours back to at least this many minutes. */
export const LP_EST_RECENT_MINUTES = 60;

/**
 * Live R as the live readout has calibrated it at `nowMs`: one function, so every figure priced at "the live R" reads the
 * same one (the estimate below, and what else the page prices at it). Each live day before today whose scored formula is
 * at least $1 gives ln(max(paid ÷ scored formula, 0.02)); their mean and spread are shrunk towards the prior's as if it
 * were two such days (`LP_EST_PRIOR`). `point` is exp(mean), `low`–`high` the 10th to 90th percentile of one day's R;
 * `basis` "prior" until a day is read. `muOf` is a market's own mean, shrunk towards the overall one, and `band` the
 * band about a mean; `pastFormula` and `pastDays` the scored formula of the days before today and how many there are.
 */
export function lpLiveR(rewardDays: LpLiveRewardDayRow[], nowMs: number) {
  const dayStart = Math.floor(nowMs / DAY) * DAY, today = iso(dayStart).slice(0, 10);
  const z = LP_EST_Z, mu0 = Math.log(Math.sqrt(LP_EST_PRIOR.low * LP_EST_PRIOR.high)), s0 = Math.log(LP_EST_PRIOR.high / LP_EST_PRIOR.low) / (2 * z), k = LP_EST_PRIOR.days;
  const lnR = (paid: number, f: number) => Math.log(Math.max(paid / f, LP_EST_R_FLOOR));

  // The live days before today, whole and by market.
  type D = { formula: number; paid: number; byCond: Map<string, { formula: number; paid: number }> };
  const days = new Map<string, D>();
  for (const r of rewardDays) {
    const d = dayOf(r.day);
    if (d >= today) continue;
    const x = days.get(d) ?? { formula: 0, paid: 0, byCond: new Map() };
    const f = scoredFormulaOf(r), p = num(r.actual_usd) + num(r.actual_sponsored_usd);
    x.formula += f; x.paid += p;
    const c = x.byCond.get(r.cond) ?? { formula: 0, paid: 0 };
    c.formula += f; c.paid += p; x.byCond.set(r.cond, c);
    days.set(d, x);
  }
  const read = [...days.values()].filter((d) => d.formula >= LP_EST_MIN_DAY_FORMULA_USD);
  const ls = read.map((d) => lnR(d.paid, d.formula)), n = ls.length;
  const mu = (k * mu0 + ls.reduce((a, b) => a + b, 0)) / (k + n);
  const mean = n ? ls.reduce((a, b) => a + b, 0) / n : 0;
  const s2 = n >= 2 ? ls.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : s0 * s0;
  const sigma = Math.sqrt((k * s0 * s0 + n * s2) / (k + n));
  // Each market's own: its days' ln R, shrunk towards the overall mean.
  const own = new Map<string, number[]>();
  for (const d of read) for (const [c, x] of d.byCond) if (x.formula > 0) own.set(c, [...(own.get(c) ?? []), lnR(x.paid, x.formula)]);
  const muOf = (c: string) => { const l = own.get(c) ?? []; return (k * mu + l.reduce((a, b) => a + b, 0)) / (k + l.length); };
  const band = (m: number) => ({ low: Math.exp(m - z * sigma), high: Math.exp(m + z * sigma) });

  const all = band(mu);
  return {
    point: r6(Math.exp(mu)), low: r6(all.low), high: r6(all.high), days: n, basis: n ? "live" as const : "prior" as const,
    mu, sigma, muOf, band, pastFormula: [...days.values()].reduce((a, d) => a + d.formula, 0), pastDays: days.size,
  };
}

/**
 * Today's rewards, estimated: what the formula has given our quotes since 00:00 UTC times a band of R, and the same for the
 * whole day with the rest of it projected. Since 2026-10-10 (the pre-registration's Addendum 9) every formula figure here
 * is the formula over the minutes Polymarket read both our sides scoring (`formula_scored_usd`, the readout's per day and
 * 0111's per hour): R is calibrated on it and today is estimated from it, so a minute the venue did not score, a
 * programme it had cut, counts in neither. The prior band and its weight are as they were. A pure function of the stored rows, so it recalibrates by itself: each payout
 * the readout books (`rewardDays`, the live rows of `pm_lp_reward_days`) moves R's band at the next dashboard read, and the
 * day's window is whatever `hours` hold from today's 00:00 UTC, so it starts from nothing at each UTC midnight.
 *
 * R. Each live day with a formula of at least $1 gives ln(max(paid ÷ formula, 0.02)). Their mean is shrunk towards the
 * prior's (ln 0.447) as if the prior were two such days; their spread likewise towards the prior's σ (until two days are
 * read, the spread is the prior's). A market seen on earlier days has its own mean, shrunk towards the overall one with
 * the same two days' weight; a market never seen takes the overall. The band is exp(mean ± 1.2816 σ): the 10th to the
 * 90th percentile of one day's R, which is what today is; it narrows as the days' own spread replaces the prior's, not
 * to nothing, because one day's R keeps its day-to-day spread.
 *
 * The formula. So far: the sum of today's hours, per market. The rest of the day: the minutes left at the lowest and the
 * highest of three rates (the newest hour's, today's own, and the earlier live days' mean a minute), a market's share of
 * the projection its share of today so far. Low: each market's so-far at its R's low end; for the whole day, a market
 * whose projected low is under $1 counts as nothing (the payout minimum, if it applies per market). High: the high ends.
 */
export function lpRewardEstimate(input: { rewardDays: LpLiveRewardDayRow[]; hours: LpLiveHourRow[]; nowMs: number }) {
  const dayStart = Math.floor(input.nowMs / DAY) * DAY;
  const minutesLeft = Math.max(0, Math.round((dayStart + DAY - input.nowMs) / M));
  const R = lpLiveR(input.rewardDays, input.nowMs);
  const { mu, muOf, band } = R;

  // Today's hours, and the rates.
  const hours = input.hours.filter((h) => { const t = Date.parse(h.hour); return t >= dayStart && t < dayStart + DAY && t <= input.nowMs; });
  const soFarOf = new Map<string, number>();
  const perHour = new Map<number, { f: number; m: number }>();
  for (const h of hours) {
    const t = Date.parse(h.hour), f = num(h.formula_scored_usd), m = num(h.minutes);
    soFarOf.set(h.cond, (soFarOf.get(h.cond) ?? 0) + f);
    const x = perHour.get(t) ?? { f: 0, m: 0 };
    x.f += f; x.m = Math.max(x.m, m);                                     // a minute is one row per market: the hour's minutes are its fullest market's
    perHour.set(t, x);
  }
  const soFar = [...soFarOf.values()].reduce((a, b) => a + b, 0);
  const hs = [...perHour.entries()].sort((a, b) => b[0] - a[0]);
  const recorded = hs.reduce((a, [, x]) => a + x.m, 0);
  let rf = 0, rm = 0;
  for (const [, x] of hs) { if (rm >= LP_EST_RECENT_MINUTES) break; rf += x.f; rm += x.m; }
  const rates = {
    recent: rm > 0 ? rf / rm : null,
    today: recorded > 0 ? soFar / recorded : null,
    days: R.pastDays ? R.pastFormula / R.pastDays / 1440 : null,
  };
  const known = [rates.recent, rates.today, rates.days].filter((x): x is number => x !== null);
  const restLow = known.length ? Math.min(...known) * minutesLeft : 0, restHigh = known.length ? Math.max(...known) * minutesLeft : 0;

  let soLow = 0, soHigh = 0, dayLow = 0, dayHigh = 0;
  const conds = [...soFarOf.keys()].sort();
  for (const c of conds) {
    const f = soFarOf.get(c)!, b = band(muOf(c));
    soLow += f * b.low; soHigh += f * b.high;
    const share = soFar > 0 ? f / soFar : 0;
    const lowDay = (f + share * restLow) * b.low, highDay = (f + share * restHigh) * b.high;
    dayLow += lowDay >= LP_EST_MIN_PAYOUT_USD ? lowDay : 0; dayHigh += highDay;
  }
  // Nothing recorded yet today (the first minutes after 00:00): the day is the projection alone, at the overall band.
  if (!conds.length) { const b = band(mu); dayLow = restLow * b.low >= LP_EST_MIN_PAYOUT_USD ? restLow * b.low : 0; dayHigh = restHigh * b.high; }
  // Each market's rewards not yet read (QUOTES' Rewards (est.), Davies 2026-10-09: "用最新数据的最合理r来估算"): its formula
  // on every day the readout has not yet booked (today, and yesterday until its payout is read: a day is read once any live
  // row of it is), times its point R, exp of its shrunk mean. Read days are what was paid, counted elsewhere.
  const readDays = new Set(input.rewardDays.map((r) => dayOf(r.day)));
  const unread = new Map<string, number>();
  for (const h of input.hours) {
    const t = Date.parse(h.hour);
    if (!(t <= input.nowMs) || readDays.has(iso(Math.floor(t / DAY) * DAY).slice(0, 10))) continue;
    unread.set(h.cond, (unread.get(h.cond) ?? 0) + num(h.formula_scored_usd));
  }
  const markets: Record<string, { r: number; unreadFormulaUsd: number; estUsd: number }> = {};
  for (const c of [...unread.keys()].sort()) {
    const r = Math.exp(muOf(c)), f = unread.get(c)!;
    markets[c] = { r: r6(r), unreadFormulaUsd: r6(f), estUsd: r6(f * r) };
  }
  const r6n = (x: number | null) => (x === null ? null : r6(x));
  return {
    day: iso(dayStart).slice(0, 10), minutesLeft,
    soFar: { formulaUsd: r6(soFar), lowUsd: r6(soLow), highUsd: r6(soHigh) },
    fullDay: { formulaLowUsd: r6(soFar + restLow), formulaHighUsd: r6(soFar + restHigh), lowUsd: r6(dayLow), highUsd: r6(dayHigh) },
    r: { point: R.point, low: R.low, high: R.high, days: R.days, basis: R.basis },
    rates: { recent: r6n(rates.recent), today: r6n(rates.today), days: r6n(rates.days) },
    markets,
  };
}

// ------------------------------------------------------------------ TESTING's Reward quotes rows at the live R (Addendum 10)

/** The live R a page prices rewards at: `lpLiveR`'s point and band, as `lpRewardEstimate` returns them (`estimate.r`). */
export type LpLiveRPrice = { point: number; low: number; high: number; days: number; basis: "live" | "prior" };

/**
 * A paper Reward quotes summary (RW-C's "Reward quotes" and its variants, `pmrw_view.ts`; the order paths' paper layers,
 * `pm_prep_view.ts`) priced at the live R (Davies, 2026-10-10: "确保r更新后所有testing的策略都用这个最新的来算他们的r"). Those
 * summaries count the formula's rewards at R = 1 and their worst case at half; here each reward is the formula's times
 * the live R's point, and the worst case's half becomes the band's low, everywhere the page shows them: the total, today,
 * realised, each day, each market. Fills, holdings and capital do not move. The dashboard passes the one R it read
 * (`lpLive.estimate.r`, else the prior's) to every row, and `rPricing` says which. What the PAGES show moves only:
 * every pre-registered reading keeps the R it froze (RW's and RW-C's verdicts, TB1, the RW-X tests, mid-pool's readout,
 * LPRESEL6, RWC-OPT, and the paper layers' own stops at R = 0.40), none of which reads this.
 */
// deno-lint-ignore no-explicit-any
export function atLiveR<T extends Record<string, any> | null | undefined>(s: T, R: LpLiveRPrice): T {
  if (!s || typeof s !== "object") return s;
  const k = R.point, lo = R.low;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const F = n(s.rewardUsd) ?? 0;
  // deno-lint-ignore no-explicit-any
  const out: Record<string, any> = { ...s, rPricing: { point: R.point, low: R.low, high: R.high, days: R.days, basis: R.basis, stressAt: "low" } };
  const shift = (x: unknown, f: number) => (n(x) === null ? x : r6(Number(x) - (1 - k) * f));
  const stress = (x: unknown, f: number) => (n(x) === null ? x : r6(Number(x) - 0.5 * f + lo * f));
  out.rewardUsd = n(s.rewardUsd) === null ? s.rewardUsd : r6(k * F);
  out.totalUsd = shift(s.totalUsd, F);
  out.realisedUsd = shift(s.realisedUsd, F);
  out.stressUsd = stress(s.stressUsd, F);
  // Today's rewards: the run's less every closed day's.
  const days = Array.isArray(s.days) ? s.days : [];
  const closed = days.reduce((a: number, d: Record<string, unknown>) => a + (n(d.rewardUsd) ?? 0), 0);
  const todayF = F - closed;
  out.todayUsd = shift(s.todayUsd, todayF);
  if ("todayStressUsd" in s) out.todayStressUsd = stress(s.todayStressUsd, todayF);
  // Each closed day, and the running total at its close (oldest first for the running sum, in the order given).
  const order = days.map((d: Record<string, unknown>, i: number) => [String(d.day ?? ""), i] as const).sort((a: readonly [string, number], b: readonly [string, number]) => a[0].localeCompare(b[0]));
  const cum = new Map<number, number>();
  let run = 0;
  for (const [, i] of order) { run += n(days[i].rewardUsd) ?? 0; cum.set(i, run); }
  if (Array.isArray(s.days)) {
    out.days = days.map((d: Record<string, unknown>, i: number) => {
      const f = n(d.rewardUsd) ?? 0;
      return {
        ...d, rewardUsd: n(d.rewardUsd) === null ? d.rewardUsd : r6(k * f), totalUsd: shift(d.totalUsd, f), stressUsd: stress(d.stressUsd, f),
        ...("runningUsd" in d ? { runningUsd: shift(d.runningUsd, cum.get(i) ?? 0) } : {}),
      };
    });
  }
  if (Array.isArray(s.markets)) {
    out.markets = s.markets.map((m: Record<string, unknown>) => {
      const f = n(m.rewardUsd) ?? 0;
      return { ...m, rewardUsd: n(m.rewardUsd) === null ? m.rewardUsd : r6(k * f), totalUsd: shift(m.totalUsd, f) };
    });
    const best = out.markets.map((m: Record<string, unknown>) => n(m.totalUsd)).filter((x: number | null): x is number => x !== null);
    if (best.length && n(s.bestMarketUsd) !== null) out.bestMarketUsd = r6(Math.max(...best));
  }
  return out as T;
}
