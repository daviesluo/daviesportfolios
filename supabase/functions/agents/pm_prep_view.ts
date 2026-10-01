// "Reward quotes live-prep" as the Agents page shows it (`pm_prep.ts`, 0077): a row of TESTING STRATEGIES on the
// Polymarket card and a page of its own, which is RW's page (Davies, 2026-10-01: "the same as the other Reward quotes
// pages"). Every figure comes from the layer's own records through the functions that made them: the P&L is `paperPnl`
// (the order path's `tokenBooks` and `bookPnl`) on the fills the state has decided, and a market's part of it is
// `bookPnl` on that market's two tokens; the rewards and the worst case are RW's own on the layer's account per market,
// which is RW's `Acc`. Nothing is computed a second way. The days are RW's: each the change since the close before,
// so they add up to the total; the path's own day figure, which counts every holding against its cost (its day stop's
// reading), stays with the stop and the pre-registered check.

import { bookPnl, type PmSettlement } from "./pm_live.ts";
import { paperPnl, type PrepFill, type PrepState } from "./pm_prep.ts";
import { accStress } from "./pmrw.ts";

const M = 60e3, DAY = 86400e3;
/** The newest fills the page lists. */
export const PREP_RECENT_FILLS = 25;
/** The layer decides each minute two minutes after it starts: a last decided minute older than this means it has stopped. */
export const PREP_STALE_MINUTES = 5;

export type PrepStateRow = { state: unknown; last_minute: string | null; last_error: string | null; updated_at?: string | null };
export type PrepDayRow = {
  day: string; reward: number | string; fills_pnl_total: number | string; fills: number | string; stop_day: boolean; stop_total: boolean;
};
export type PrepMinuteRow = {
  minute: string; cond: string; class: string; b: number | string | null; a: number | string | null; n: number | string | null; qb: boolean | null; qa: boolean | null;
  close_only: boolean | null; reward: number | string | null;
};
/** The path's reward rate for each market at the last decided minute (`pm_live_minutes`), the one the formula used. */
export type PrepRateRow = { cond: string; rate: number | string };
export type PrepFillRow = {
  cond: string; minute: string; print_id: string; ts: string; side: "bid" | "ask"; price: number | string; size: number | string; token: string;
  token_side: "BUY" | "SELL"; token_price: number | string; close_only: boolean;
};
/** The path's selection (`pm_live_markets`), every day since the layer started: a day's markets and what their quotes need. */
export type PrepMarketRow = {
  day: string; cond: string; question: string | null; reward_rate: number | string | null; rank: number | string; n_size: number | string | null;
  capital: number | string | null;
};

const nz = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (d: string) => String(d).slice(0, 10);

/**
 * The dashboard's `prep`, in the shape of RW's (`rwSummary`), so its row and its page are RW's: null until the layer has
 * a state. `capUsd` is the order path's total cap (`pm_live_config`), the row's capital: the most the path may commit.
 * Only what the state has decided is counted (the engine writes fills before the state that counts them, so a read
 * between the two sees fills of minutes not yet decided).
 *
 * What RW keeps and this layer does not, the page reads as it can: a day's Costs are what its selection's quotes need,
 * N × (b + 1 − a) a market (`pm_live_markets.capital`, the path's own measure; RW's also count the largest inventory),
 * and a closed day's worst case is not recorded, so it is null (the running one is RW's `accStress` on the account).
 */
export function prepSummary(input: {
  state: PrepStateRow | null; days: PrepDayRow[]; latest: PrepMinuteRow[]; rates: PrepRateRow[]; fills: PrepFillRow[]; settlements: PmSettlement[];
  markets: PrepMarketRow[]; capUsd: number; nowMs: number;
}) {
  const st = input.state?.state as PrepState | undefined;
  if (!st || typeof st !== "object" || st.version !== 1 || !input.state?.last_minute) return null;
  const lagMinutes = Math.round((input.nowMs - Date.parse(input.state.last_minute)) / M);
  const todayStart = Math.floor(input.nowMs / DAY) * DAY, today = iso(todayStart).slice(0, 10);
  const fills = input.fills.filter((f) => Date.parse(f.minute) <= st.lastDecided).map((f): PrepFill => ({
    cond: f.cond, minute: Date.parse(f.minute), printId: f.print_id, ts: Date.parse(f.ts), side: f.side, price: Number(f.price), size: Number(f.size),
    token: f.token, tokenSide: f.token_side, tokenPrice: Number(f.token_price), closeOnly: !!f.close_only,
  }));
  const pnl = paperPnl(fills, input.settlements, st.tokens ?? {}, st.marks ?? {}, todayStart);
  let realisedFills = 0, cost = 0;
  for (const t of Object.values(pnl.books)) { realisedFills += t.realised; cost += t.held * t.avgCost; }
  const closed = input.days.filter((d) => Date.parse(d.day) < st.dayOf).sort((a, b) => a.day.localeCompare(b.day));
  // Every closed day's, and the day being accumulated (yesterday's, for the minute or two after midnight before it closes).
  const closedReward = closed.reduce((s, d) => s + Number(d.reward), 0);
  const reward = closedReward + st.day.reward;
  const acc = st.acc ?? {};

  // Each market's part: its rewards on its account, and what its two tokens made by the path's book-keeping, marked as
  // `paperPnl` marks them (YES at the mid, NO at 1 − mid). The parts add up to the total (`mismatchUsd` says by how much not).
  const partOf = (cond: string) => {
    const tk = st.tokens?.[cond];
    let fillsPnl = 0;
    if (tk) {
      const mid = st.marks?.[cond];
      const books: typeof pnl.books = {};
      for (const t of [tk.yes, tk.no]) if (pnl.books[t]) books[t] = pnl.books[t];
      fillsPnl = bookPnl(books, { [tk.yes]: mid ?? null, [tk.no]: mid == null ? null : 1 - mid }).total;
    }
    const rewardUsd = acc[cond]?.reward ?? 0;
    return { rewardUsd, fillsPnlUsd: fillsPnl, totalUsd: rewardUsd + fillsPnl };
  };
  const partOut = (cond: string) => {
    const p = partOf(cond);
    return { rewardUsd: r6(p.rewardUsd), fillsPnlUsd: r6(p.fillsPnlUsd), totalUsd: r6(p.totalUsd) };
  };
  let best = -Infinity, parts = 0, stress = 0;
  for (const cond of new Set([...Object.keys(st.tokens ?? {}), ...Object.keys(acc)])) {
    const p = partOf(cond);
    best = Math.max(best, p.totalUsd); parts += p.totalUsd;
  }
  for (const a of Object.values(acc)) stress += accStress(a);
  const total = pnl.total + reward;

  const heldBy = (cond: string) => {
    const tk = st.tokens?.[cond];
    return tk ? { yes: pnl.held[tk.yes] ?? 0, no: pnl.held[tk.no] ?? 0 } : { yes: 0, no: 0 };
  };
  const latest = new Map(input.latest.map((r) => [r.cond, r]));
  const rates = new Map(input.rates.map((r) => [r.cond, Number(r.rate)]));
  const todays = input.markets.filter((m) => dayOf(m.day) === today).sort((a, b) => Number(a.rank) - Number(b.rank));
  const markets: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  // What the quotes resting now tie up (Davies, 2026-10-01: DEPLOYED is every dollar at work, as the stablecoin quotes'):
  // as RW counts a market's first quotes' capital, a resting bid N × b and a resting ask N × (1 − a), the bid buying YES
  // and the ask buying NO. Close-only, what rests sells what is held, which `heldUsd` already counts.
  let quoted = 0;
  for (const m of todays) {
    const row = latest.get(m.cond), h = heldBy(m.cond);
    seen.add(m.cond);
    const bid = row && row.qb !== false && row.class === "matched" ? nz(row.b) : null, ask = row && row.qa !== false && row.class === "matched" ? nz(row.a) : null;
    const size = nz(row?.n) ?? nz(m.n_size);
    if (size !== null && !row?.close_only) quoted += (bid !== null ? size * bid : 0) + (ask !== null ? size * (1 - ask) : 0);
    // Our share of the pool at that minute, as RW's page shows it: the formula paid rate / 1440 × ours / (ours + others).
    const r = nz(row?.reward), rate = rates.get(m.cond);
    markets.push({
      cond: m.cond, q: m.question ?? "", rank: Number(m.rank), quoting: true, ratePerDay: nz(m.reward_rate),
      cls: row?.class ?? null, bid, ask, yes: h.yes, no: h.no, mark: st.marks?.[m.cond] ?? null,
      share: r !== null && r > 0 && rate !== undefined && rate > 0 ? r6((r * 1440) / rate) : null,
      ...partOut(m.cond),
    });
  }
  // Markets still held from an earlier day: marked, never quoted.
  for (const cond of Object.keys(st.tokens ?? {}).sort()) {
    const h = heldBy(cond);
    if (seen.has(cond) || h.yes + h.no <= 0) continue;
    markets.push({
      cond, q: "", rank: null, quoting: false, ratePerDay: null, cls: null, bid: null, ask: null, yes: h.yes, no: h.no, mark: st.marks?.[cond] ?? null,
      share: null, ...partOut(cond),
    });
  }
  const open = markets.filter((x) => Number(x.yes) + Number(x.no) > 0).length;
  const qOf = new Map(input.markets.map((m) => [m.cond, m.question ?? ""]));
  const recent = fills.slice().sort((x, y) => y.ts - x.ts || y.minute - x.minute || (x.printId < y.printId ? 1 : -1)).slice(0, PREP_RECENT_FILLS).map((f) => ({
    ts: iso(f.ts), minute: iso(f.minute), cond: f.cond, q: qOf.get(f.cond) ?? "", side: f.side, price: f.price, size: f.size, tokenSide: f.tokenSide,
    outcome: st.tokens?.[f.cond]?.yes === f.token ? "yes" : "no", tokenPrice: f.tokenPrice, closeOnly: f.closeOnly,
  }));
  // A day's Costs: its selection's quotes, null for a day the path recorded none of.
  const capitalOf = (day: string) => {
    const xs = input.markets.filter((m) => dayOf(m.day) === day).map((m) => nz(m.capital)).filter((x): x is number => x !== null);
    return xs.length ? r6(xs.reduce((s, x) => s + x, 0)) : null;
  };
  // A closed day is its change: the run's fills P&L at its close less the close before's, and its rewards.
  const days = closed.map((d, i) => ({
    day: dayOf(d.day), phase: "run", live: false,
    totalUsd: r6(Number(d.fills_pnl_total) - (i > 0 ? Number(closed[i - 1].fills_pnl_total) : 0) + Number(d.reward)),
    stressUsd: null, rewardUsd: Number(d.reward), fills: Number(d.fills), capitalUsd: capitalOf(d.day), stop: !!d.stop_day || !!d.stop_total,
  })).reverse();
  const last = closed.at(-1);
  return {
    lastMinute: input.state.last_minute, lagMinutes, running: lagMinutes <= PREP_STALE_MINUTES, lastError: input.state.last_error ?? null,
    // One run, from its first minute, with no warm-up and no end of its own (its window is the pre-registration's).
    phase: "run", runStart: null, runEnd: null, dayOfRun: null, finished: false, catchingUp: false, notStarted: false,
    startedAt: st.startedAt, capUsd: input.capUsd, capitalUsd: capitalOf(today),
    rewardUsd: r6(reward), fillsPnlUsd: pnl.total, heldUsd: pnl.heldValue, quotedUsd: r6(quoted), costUsd: r6(cost),
    realisedUsd: r6(reward + realisedFills), realisedFillsUsd: r6(realisedFills), unrealisedUsd: r6(pnl.total - realisedFills),
    totalUsd: r6(total), stressUsd: r6(stress), mismatchUsd: r6(parts - total), bestMarketUsd: Number.isFinite(best) ? r6(best) : null,
    // Today against the last close, as RW's: the days and today then add up to the total.
    todayUsd: r6(total - (last ? Number(last.fills_pnl_total) : 0) - closedReward),
    fills: fills.length,
    // A day stop holds for its own UTC day only, as the path reads it.
    stopDay: st.stopDay === today ? st.stopDay : null, stopTotal: st.stopTotal, open, quoting: todays.length,
    markets, recent, days,
  };
}
