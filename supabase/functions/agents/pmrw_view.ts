// RW's paper test on the Agents page (reference §4 item 36): the dashboard's `rw`, a row of TESTING STRATEGIES with a
// page of its own (Davies, 2026-09-24).
//
// Every figure comes from the engine's own state and records through the engine's own functions — `snapshot`,
// `accTotal`, `accCapital` — so the page, the day rows and the verdict are one number, never two. The one thing the
// engine does not keep is a split of a market's fill P&L into what closed trades made and what the open inventory is
// marked at; `rwFillBook` makes it from the market's fills by average cost, and the two parts must sum to the engine's
// figure (`mismatchUsd` says by how much they do not, and the page shows it when they do not).

import { accCapital, accTotal, RW_RUN_END, RW_RUN_START, rwPhase, snapshot, type Acc, type RwState } from "./pmrw.ts";
import { excludedByDay, RWE_CHECK_USD, RWE_START, type RweSelRow, type RweState } from "./pmrw_e.ts";

const DAY = 86400e3, M = 60e3;
/** How many of the phase's fills the page lists, newest first. */
export const RW_RECENT_FILLS = 25;
/** The engine decides two minutes behind the clock; a last decided minute older than this means it has stopped. */
export const RW_STALE_MINUTES = 5;

export type RwStateRow = { state: unknown; last_minute: string | null; last_error: string | null };
export type RwSelRow = { day: string; cond: string; rank: number; rate: number | string; v: number | string; min_size: number | string; capital: number | string; q: string | null; cat: string | null; end_date: string | null };
export type RwMinuteRow = { cond: string; minute: string; b: number | string | null; a: number | string | null; m: number | string | null; ours: number | string | null; others: number | string | null; qb: boolean | null; qa: boolean | null };
export type RwDayRow = { day: string; total: number | string; stress_total: number | string; reward: number | string; fills: number | string; capital: number | string; markets: number | string; detail: { phase?: string } | null };
export type RwFillRow = { cond: string; minute: string; ts: string; side: "bid" | "ask"; price: number | string; size: number | string; print_id: string };

const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));

/**
 * A market's fills by average cost, in the order they happened: `net` YES shares (negative is short YES, which is long
 * NO), their average price, and what closing trades made. For any mark, `realised + net × (mark − avgCost)` is the
 * engine's `cash + net × mark`.
 */
export function rwFillBook(fills: Array<{ side: "bid" | "ask"; price: number | string; size: number | string }>): { net: number; avgCost: number; realised: number } {
  let net = 0, avg = 0, realised = 0;
  for (const f of fills) {
    const q = Number(f.size), px = Number(f.price), dir = f.side === "bid" ? 1 : -1;
    if (!(q > 0)) continue;
    if (net === 0 || Math.sign(net) === dir) {
      avg = (Math.abs(net) * avg + q * px) / (Math.abs(net) + q);
      net += dir * q;
      continue;
    }
    const close = Math.min(q, Math.abs(net));
    realised += close * (dir === -1 ? px - avg : avg - px);
    net += dir * close;
    if (q > close) { net += dir * (q - close); avg = px; }
    else if (net === 0) avg = 0;
  }
  return { net, avgCost: avg, realised };
}

/** The order the engine filled in: by the minute it decided, then the print's second and its id. */
const fillOrder = (a: RwFillRow, b: RwFillRow) =>
  Date.parse(a.minute) - Date.parse(b.minute) || Date.parse(a.ts) - Date.parse(b.ts) || (a.print_id < b.print_id ? -1 : a.print_id > b.print_id ? 1 : 0);

/**
 * The dashboard's `rw`: null until the engine has a state (before `0053`, or before its first selection). `selection`
 * is the engine's own day's portfolio, `latest` the rows of the last minute it decided, `days` every closed day, `fills`
 * every fill of the phase the engine is in (the warm-up's, or the fourteen days').
 */
export function rwSummary(input: {
  state: RwStateRow | null; selection: RwSelRow[]; latest: RwMinuteRow[]; days: RwDayRow[]; fills: RwFillRow[];
  firstMinute: string | null; nowMs: number;
  /** How old the last decided minute may be before the page says it has stopped (RW's own 5 by default). */
  staleMinutes?: number;
  /** Markets whose own fills are not on record (RW-E's `diverged`): their fill P&L is open while they are, closed once settled. */
  approx?: ReadonlySet<string>;
}) {
  const st = input.state?.state as RwState | undefined;
  if (!st || typeof st !== "object" || !("acc" in st) || !input.state?.last_minute) return null;
  const phase = rwPhase(st.dayOf);
  const inPhase = (minute: string) => (phase === "warm-up" ? Date.parse(minute) < RW_RUN_START : Date.parse(minute) >= RW_RUN_START);
  // A run writes the fills of the minutes it decides, and the row of a day it closes, before it saves the state that
  // counts them; a page read between the two sees records the state does not hold yet. The dashboard reads the state
  // first, and the page shows only what that state has decided.
  const decided = (minute: string) => Date.parse(minute) <= st.lastDecided;
  const byCond = new Map<string, RwFillRow[]>();
  for (const f of input.fills.filter((x) => inPhase(x.minute) && decided(x.minute)).sort(fillOrder)) (byCond.get(f.cond) ?? byCond.set(f.cond, []).get(f.cond)!).push(f);

  const snap = snapshot(st, st.dayActive ?? []);
  const sel = new Map(input.selection.map((s) => [s.cond, s]));
  const latest = new Map(input.latest.map((r) => [r.cond, r]));
  let realised = 0, unrealised = 0, held = 0, open = 0, best = -Infinity;
  const markets: Array<Record<string, unknown>> = [];
  for (const [cond, a] of Object.entries(st.acc ?? {}) as Array<[string, Acc]>) {
    const book = rwFillBook(byCond.get(cond) ?? []);
    const mark = a.settled ?? a.lastM ?? 0;
    const settledPart = a.settled != null ? book.net * (a.settled - book.avgCost) : 0;
    // A market whose fills are not on record has no average cost to split by: its fill P&L is all open until it settles.
    const own = input.approx?.has(cond) ? accTotal(a) - a.reward : null;
    const mRealised = own != null ? a.reward + (a.settled != null ? own : 0) : a.reward + book.realised + settledPart;
    const mUnrealised = own != null ? (a.settled != null ? 0 : own) : a.settled != null ? 0 : book.net * (mark - book.avgCost);
    realised += mRealised; unrealised += mUnrealised;
    const holding = a.settled == null && a.net !== 0;
    if (holding) { open++; held += a.net > 0 ? a.net * mark : -a.net * (1 - mark); }
    const total = accTotal(a);
    best = Math.max(best, total);
    const s = sel.get(cond), meta = st.meta?.[cond];
    if (!s && !holding) continue;
    const row = latest.get(cond);
    const ours = n(row?.ours), others = n(row?.others);
    markets.push({
      cond, q: s?.q ?? meta?.q ?? "", cat: s?.cat ?? meta?.cat ?? null, rank: s ? Number(s.rank) : null, quoting: !!s,
      ratePerDay: s ? Number(s.rate) : meta?.rate ?? null, endDate: s?.end_date ?? null,
      net: a.net, avgCost: own == null && book.net !== 0 ? book.avgCost : null, mark: a.lastM, settled: a.settled,
      rewardUsd: a.reward, fillsPnlUsd: total - a.reward, totalUsd: total, fills: a.fills, capitalUsd: accCapital(a),
      bid: row && row.qb !== false ? n(row.b) : null, ask: row && row.qa !== false ? n(row.a) : null,
      share: ours != null && ours > 0 && others != null ? ours / (ours + others) : null,
    });
  }
  // Today's portfolio first, in its rank; then what is only held.
  markets.sort((x, y) => (x.rank == null ? 1 : 0) - (y.rank == null ? 1 : 0) || Number(x.rank ?? 0) - Number(y.rank ?? 0) || String(x.cond).localeCompare(String(y.cond)));

  // Closed days, each against the day before in the same phase: the warm-up starts at nothing, and so does the run.
  const asc = input.days.filter((d) => Date.parse(d.day) < st.dayOf).sort((a, b) => a.day.localeCompare(b.day));
  const days = asc.map((d, i) => {
    const p = d.detail?.phase ?? rwPhase(Date.parse(d.day));
    const prev = i > 0 && (asc[i - 1].detail?.phase ?? rwPhase(Date.parse(asc[i - 1].day))) === p ? asc[i - 1] : null;
    const less = (k: "total" | "stress_total" | "reward" | "fills") => Number(d[k]) - (prev ? Number(prev[k]) : 0);
    return { day: d.day, phase: p, totalUsd: less("total"), stressUsd: less("stress_total"), rewardUsd: less("reward"), fills: less("fills"), capitalUsd: Number(d.capital), markets: Number(d.markets), runningUsd: Number(d.total) };
  }).reverse();
  const yesterday = asc.find((d) => Date.parse(d.day) === st.dayOf - DAY);
  const baseline = yesterday && (yesterday.detail?.phase ?? rwPhase(Date.parse(yesterday.day))) === phase ? Number(yesterday.total) : 0;

  const capital = snap.capital > 0 ? snap.capital : input.selection.reduce((s, x) => s + Number(x.capital), 0);
  const lagMinutes = Math.round((input.nowMs - Date.parse(input.state.last_minute)) / M);
  const over = st.dayOf >= RW_RUN_END;
  const recent = [...byCond.values()].flat().sort((x, y) => fillOrder(y, x)).slice(0, RW_RECENT_FILLS).map((f) => ({
    ts: f.ts, minute: f.minute, cond: f.cond, q: sel.get(f.cond)?.q ?? st.meta?.[f.cond]?.q ?? "", side: f.side, price: Number(f.price), size: Number(f.size),
  }));
  const total = snap.total;
  return {
    phase, runStart: new Date(RW_RUN_START).toISOString(), runEnd: new Date(RW_RUN_END).toISOString(),
    dayOfRun: phase === "run" ? Math.floor((st.dayOf - RW_RUN_START) / DAY) + 1 : null,
    startedAt: input.firstMinute, lastMinute: input.state.last_minute, lagMinutes, lastError: input.state.last_error,
    running: !over && lagMinutes <= (input.staleMinutes ?? RW_STALE_MINUTES), finished: over,
    capitalUsd: capital, totalUsd: total, stressUsd: snap.stress, rewardUsd: snap.reward, fillsPnlUsd: total - snap.reward,
    realisedUsd: realised, unrealisedUsd: unrealised, mismatchUsd: realised + unrealised - total,
    todayUsd: total - baseline, heldUsd: held, open, fills: snap.fills, quoting: input.selection.length,
    bestMarketUsd: Number.isFinite(best) ? best : null,
    markets, days, recent,
  };
}

export type RweStateRow = { state: unknown; last_minute: string | null; last_error: string | null };
export type RweDaysRow = { day: string; arm: "rw" | "e"; total: number | string; stress_total: number | string; reward: number | string; fills: number | string; capital: number | string; markets?: number | string; detail: { excluded?: string[]; check?: Record<string, number> | null } | null };

/** How long the replay may trail the clock before the page says it has stopped: it runs every five minutes, two behind RW. */
export const RWE_STALE_MINUTES = 15;

/**
 * RW-E beside RW on RW's page (pre-registration `reviews/2026-09-26-polymarket-rw-end-prereg.md`): both arms of the
 * replay from 2026-09-27 00:00, when RW-E's twelve days begin, to the last minute replayed. Each arm's figure is its
 * running total now less its running total at the close of 09-26, when the two arms are one; both come from the same
 * replay, so the pair is always read at the same minute. `excludedToday` is today's selection's markets that end today.
 * `check` is the largest gap between the replay's rw arm and RW's own closed days: under a cent, or the replay is not one.
 */
export function rweSummary(input: { state: RweStateRow | null; days: RweDaysRow[]; selection: RwSelRow[]; nowMs: number }) {
  const st = input.state?.state as RweState | undefined;
  if (!st || typeof st !== "object" || !("arms" in st) || !input.state?.last_minute) return null;
  const base = new Map(input.days.filter((d) => String(d.day).slice(0, 10) === new Date(RWE_START - DAY).toISOString().slice(0, 10)).map((d) => [d.arm, d]));
  const started = st.lastDecided >= RWE_START;
  const arm = (k: "rw" | "e") => {
    const a = st.arms[k];
    const now = snapshot({ acc: a.acc } as unknown as RwState, a.dayActive);
    const b = base.get(k);
    if (!started || !b) return null;
    return {
      totalUsd: now.total - Number(b.total), stressUsd: now.stress - Number(b.stress_total),
      rewardUsd: now.reward - Number(b.reward), fills: now.fills - Number(b.fills), capitalUsd: now.capital,
    };
  };
  const day0 = Math.floor(input.nowMs / DAY) * DAY;
  const excludedToday = input.selection
    .filter((s) => s.end_date && Date.parse(s.end_date) < day0 + DAY && String(s.day).slice(0, 10) === new Date(day0).toISOString().slice(0, 10))
    .map((s) => ({ cond: s.cond, q: s.q ?? "", endDate: s.end_date }));
  const checked = input.days.filter((d) => d.arm === "rw" && d.detail?.check);
  const lagMinutes = Math.round((input.nowMs - Date.parse(input.state.last_minute)) / M);
  return {
    since: new Date(RWE_START).toISOString(), started, lastMinute: input.state.last_minute, lagMinutes, lastError: input.state.last_error,
    running: st.dayOf < RW_RUN_END && lagMinutes <= RWE_STALE_MINUTES,
    rw: arm("rw"), e: arm("e"),
    excludedToday, diverged: st.diverged.length,
    check: { days: checked.length, maxUsd: st.checkMaxUsd, ok: checked.length > 0 && st.checkMaxUsd < RWE_CHECK_USD },
  };
}

/**
 * RW-E as a strategy of its own on the page (Davies, 2026-09-26: "两个testing策略"): the replay's `e` arm, in the
 * shape of the dashboard's `rw`, so its row and its page are RW's row and page read from the other arm. It is RW's
 * summary run on what RW-E holds: the arm's own accounts, its own closed days (`pm_rw_e_days`, arm `e`), and RW's fills
 * less those RW-E did not make, which are the market-days it leaves out (the replay's own `excludedByDay`, over every
 * day's selection) and the markets it had to run through the rule itself (`diverged`, whose fills are not on record).
 * Today's quotes are RW's less today's left-out markets. null until the replay has a state.
 */
export function rweArmSummary(input: {
  rwState: RwStateRow | null; eState: RweStateRow | null; selectionAll: RweSelRow[]; today: RwSelRow[]; latest: RwMinuteRow[];
  days: RweDaysRow[]; fills: RwFillRow[]; nowMs: number;
}) {
  const st = input.eState?.state as RweState | undefined;
  if (!st || typeof st !== "object" || !("arms" in st) || !input.eState?.last_minute) return null;
  const excluded = excludedByDay(input.selectionAll);
  const dayOf = (minute: string) => new Date(Math.floor(Date.parse(minute) / DAY) * DAY).toISOString().slice(0, 10);
  const diverged = new Set(st.diverged);
  const out = (cond: string, day: string) => excluded.get(day)?.has(cond) ?? false;
  const today = new Date(Math.floor(st.dayOf / DAY) * DAY).toISOString().slice(0, 10);
  const rw = input.rwState?.state as RwState | undefined;
  return rwSummary({
    state: {
      state: { acc: st.arms.e.acc, dayActive: st.arms.e.dayActive, lastDecided: st.lastDecided, dayOf: st.dayOf, meta: rw?.meta ?? {} },
      last_minute: input.eState.last_minute, last_error: input.eState.last_error,
    },
    selection: input.today.filter((s) => !out(s.cond, String(s.day).slice(0, 10))),
    latest: input.latest.filter((r) => !out(r.cond, today)),
    days: input.days.filter((d) => d.arm === "e").map((d) => ({
      day: String(d.day).slice(0, 10), total: d.total, stress_total: d.stress_total, reward: d.reward, fills: d.fills, capital: d.capital,
      markets: d.markets ?? 0, detail: null,
    })),
    fills: input.fills.filter((f) => !diverged.has(f.cond) && !out(f.cond, dayOf(f.minute))),
    // The replay starts where RW's fourteen days do; the warm-up before them is RW's alone.
    firstMinute: new Date(RW_RUN_START).toISOString(), nowMs: input.nowMs, staleMinutes: RWE_STALE_MINUTES, approx: diverged,
  });
}
