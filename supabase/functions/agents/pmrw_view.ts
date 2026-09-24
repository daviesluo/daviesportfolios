// RW's paper test on the Agents page (reference §4 item 36): the dashboard's `rw`, a row of TESTING STRATEGIES with a
// page of its own (Davies, 2026-09-24).
//
// Every figure comes from the engine's own state and records through the engine's own functions — `snapshot`,
// `accTotal`, `accCapital` — so the page, the day rows and the verdict are one number, never two. The one thing the
// engine does not keep is a split of a market's fill P&L into what closed trades made and what the open inventory is
// marked at; `rwFillBook` makes it from the market's fills by average cost, and the two parts must sum to the engine's
// figure (`mismatchUsd` says by how much they do not, and the page shows it when they do not).

import { accCapital, accTotal, RW_RUN_END, RW_RUN_START, rwPhase, snapshot, type Acc, type RwState } from "./pmrw.ts";

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
}) {
  const st = input.state?.state as RwState | undefined;
  if (!st || typeof st !== "object" || !("acc" in st) || !input.state?.last_minute) return null;
  const phase = rwPhase(st.dayOf);
  const inPhase = (minute: string) => (phase === "warm-up" ? Date.parse(minute) < RW_RUN_START : Date.parse(minute) >= RW_RUN_START);
  const byCond = new Map<string, RwFillRow[]>();
  for (const f of input.fills.filter((x) => inPhase(x.minute)).sort(fillOrder)) (byCond.get(f.cond) ?? byCond.set(f.cond, []).get(f.cond)!).push(f);

  const snap = snapshot(st, st.dayActive ?? []);
  const sel = new Map(input.selection.map((s) => [s.cond, s]));
  const latest = new Map(input.latest.map((r) => [r.cond, r]));
  let realised = 0, unrealised = 0, held = 0, open = 0, best = -Infinity;
  const markets: Array<Record<string, unknown>> = [];
  for (const [cond, a] of Object.entries(st.acc ?? {}) as Array<[string, Acc]>) {
    const book = rwFillBook(byCond.get(cond) ?? []);
    const mark = a.settled ?? a.lastM ?? 0;
    const settledPart = a.settled != null ? book.net * (a.settled - book.avgCost) : 0;
    const mRealised = a.reward + book.realised + settledPart;
    const mUnrealised = a.settled != null ? 0 : book.net * (mark - book.avgCost);
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
      net: a.net, avgCost: book.net !== 0 ? book.avgCost : null, mark: a.lastM, settled: a.settled,
      rewardUsd: a.reward, fillsPnlUsd: total - a.reward, totalUsd: total, fills: a.fills, capitalUsd: accCapital(a),
      bid: row && row.qb !== false ? n(row.b) : null, ask: row && row.qa !== false ? n(row.a) : null,
      share: ours != null && ours > 0 && others != null ? ours / (ours + others) : null,
    });
  }
  // Today's portfolio first, in its rank; then what is only held.
  markets.sort((x, y) => (x.rank == null ? 1 : 0) - (y.rank == null ? 1 : 0) || Number(x.rank ?? 0) - Number(y.rank ?? 0) || String(x.cond).localeCompare(String(y.cond)));

  // Closed days, each against the day before in the same phase: the warm-up starts at nothing, and so does the run.
  const asc = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
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
    running: !over && lagMinutes <= RW_STALE_MINUTES, finished: over,
    capitalUsd: capital, totalUsd: total, stressUsd: snap.stress, rewardUsd: snap.reward, fillsPnlUsd: total - snap.reward,
    realisedUsd: realised, unrealisedUsd: unrealised, mismatchUsd: realised + unrealised - total,
    todayUsd: total - baseline, heldUsd: held, open, fills: snap.fills, quoting: input.selection.length,
    bestMarketUsd: Number.isFinite(best) ? best : null,
    markets, days, recent,
  };
}
