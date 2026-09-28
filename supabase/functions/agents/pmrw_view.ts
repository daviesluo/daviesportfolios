// RW's paper test on the Agents page (reference §4 item 36): the dashboard's `rw`, a row of TESTING STRATEGIES with a
// page of its own (Davies, 2026-09-24); and RW-C's, `rwc`, the same summary of RW-C's own engine run (`rwcSummary`).
//
// Every figure comes from the engine's own state and records through the engine's own functions — `snapshot`,
// `accTotal`, `accCapital` — so the page, the day rows and the verdict are one number, never two. The one thing the
// engine does not keep is a split of a market's fill P&L into what closed trades made and what the open inventory is
// marked at; `rwFillBook` makes it from the market's fills by average cost, and the two parts must sum to the engine's
// figure (`mismatchUsd` says by how much they do not, and the page shows it when they do not).

import { accCapital, accTotal, RW_INSTANCE, RW_RUN_END, RW_RUN_START, RWC_INSTANCE, rwPhase, snapshot, type Acc, type RwInstance, type RwState } from "./pmrw.ts";
import { excludedByDay, metaFor, RWE_CHECK_USD, RWE_START, type RweSelRow, type RweState } from "./pmrw_e.ts";
import { RWX_NAMES, RWX_SPECS, type RwxStored } from "./pmrw_x.ts";

const DAY = 86400e3, M = 60e3;
/** How many of the phase's fills the page lists, newest first. */
export const RW_RECENT_FILLS = 25;
/** The engine decides two minutes behind the clock; a last decided minute older than this means it has stopped. */
export const RW_STALE_MINUTES = 5;
/**
 * ...unless its state was written this recently: then it is working through a backlog, not stopped. A new replay version
 * replays from RW's start at 720 minutes a run (Davies saw "not running: its last decided minute is 552 min old" on
 * variant-1 while one caught up, 2026-09-27).
 */
export const RW_CATCHUP_WRITE_MINUTES = 3;
/**
 * What RW and RW-E are each funded with on the page (Davies, 2026-09-26: "两个Reward quotes策略都设置一个1000 usd的
 * cap"), as every other strategy has a capital of its own: the row's cap, its FUNDED, and the base of its today and
 * realised percents. The frozen rule keeps its own $300 of quotes a day; what its quotes and inventory tie up is
 * `capitalUsd`, which the days table shows and the verdict reads (the spec's capital). Nothing here changes a decision.
 */
export const RW_FUNDED_USD = 1000;

export type RwStateRow = { state: unknown; last_minute: string | null; last_error: string | null; updated_at?: string | null };
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
 *
 * `since` makes it a variant's: RW-E's and its variants' rows show only what each did under its own rules (Davies,
 * 2026-09-27: "只从自己rules下的记录才显示"), from its first minute, `ms`, against `base`, its accounts as that minute
 * began. Every total, day, fill and market is then the change since: a market it held at that minute is carried in at
 * that minute's mark, as if bought there, so its moves after count and its history before does not. The running total
 * less `base`'s is its pre-registration's own reading, the running total now less the one at the close of the day
 * before. Until the replay has reached that minute and kept its accounts, the row is `notStarted`, with nothing in it.
 * A replay far behind the clock that wrote its state just now is `catchingUp` (a new replay version replays from RW's
 * start), not stopped. `inst` is the engine run whose fourteen days the phases and days are read against: RW's unless
 * it names another (RW-C's, `rwcSummary`).
 */
export function rwSummary(input: {
  state: RwStateRow | null; selection: RwSelRow[]; latest: RwMinuteRow[]; days: RwDayRow[]; fills: RwFillRow[];
  firstMinute: string | null; nowMs: number;
  /** How old the last decided minute may be before the page says it has stopped (RW's own 5 by default). */
  staleMinutes?: number;
  /** Markets whose own fills are not on record (RW-E's `diverged`): their fill P&L is open while they are, closed once settled. */
  approx?: ReadonlySet<string>;
  since?: { ms: number; base: Record<string, Acc> | undefined };
  inst?: RwInstance;
}) {
  const st = input.state?.state as RwState | undefined;
  if (!st || typeof st !== "object" || !("acc" in st) || !input.state?.last_minute) return null;
  const inst = input.inst ?? RW_INSTANCE;
  const phase = rwPhase(st.dayOf, inst);
  const lagMinutes = Math.round((input.nowMs - Date.parse(input.state.last_minute)) / M);
  const over = st.dayOf >= inst.runEnd;
  const behind = lagMinutes > (input.staleMinutes ?? RW_STALE_MINUTES);
  const wrote = input.state.updated_at ? (input.nowMs - Date.parse(input.state.updated_at)) / M : Infinity;
  const head = {
    phase, runStart: new Date(inst.runStart).toISOString(), runEnd: new Date(inst.runEnd).toISOString(),
    dayOfRun: phase === "run" ? Math.floor((st.dayOf - inst.runStart) / DAY) + 1 : null,
    lastMinute: input.state.last_minute, lagMinutes, lastError: input.state.last_error,
    running: !over && !behind, finished: over, fundedUsd: RW_FUNDED_USD,
    // Far behind the clock, yet written just now: replaying a backlog, not stopped.
    catchingUp: !over && behind && wrote <= RW_CATCHUP_WRITE_MINUTES,
    notStarted: false, startsAt: input.since ? new Date(input.since.ms).toISOString() : null,
  };
  const since = input.since ?? null;
  if (since && (st.lastDecided < since.ms || !since.base)) {
    return {
      ...head, notStarted: true, startedAt: null,
      capitalUsd: 0, totalUsd: 0, stressUsd: 0, rewardUsd: 0, fillsPnlUsd: 0, realisedUsd: 0, unrealisedUsd: 0, mismatchUsd: 0,
      todayUsd: 0, heldUsd: 0, open: 0, fills: 0, quoting: 0, bestMarketUsd: null,
      markets: [] as Array<Record<string, unknown>>, days: [] as ReturnType<typeof rwDayRows>, recent: [] as ReturnType<typeof rwRecent>,
    };
  }
  const base: Record<string, Acc> = since?.base ?? {};
  const inPhase = (minute: string) => (phase === "warm-up" ? Date.parse(minute) < inst.runStart : Date.parse(minute) >= inst.runStart);
  // A run writes the fills of the minutes it decides, and the row of a day it closes, before it saves the state that
  // counts them; a page read between the two sees records the state does not hold yet. The dashboard reads the state
  // first, and the page shows only what that state has decided.
  const decided = (minute: string) => Date.parse(minute) <= st.lastDecided;
  const own = (minute: string) => !since || Date.parse(minute) >= since.ms;
  const byCond = new Map<string, RwFillRow[]>();
  for (const f of input.fills.filter((x) => inPhase(x.minute) && decided(x.minute) && own(x.minute)).sort(fillOrder)) (byCond.get(f.cond) ?? byCond.set(f.cond, []).get(f.cond)!).push(f);

  const snap = snapshot(st, st.dayActive ?? []);
  const was = snapshot({ acc: base } as unknown as RwState, []);
  const sel = new Map(input.selection.map((s) => [s.cond, s]));
  const latest = new Map(input.latest.map((r) => [r.cond, r]));
  let realised = 0, unrealised = 0, held = 0, open = 0, best = -Infinity;
  const markets: Array<Record<string, unknown>> = [];
  for (const [cond, a] of Object.entries(st.acc ?? {}) as Array<[string, Acc]>) {
    const b = base[cond];
    // Settled before the variant's first minute: nothing of it is the variant's.
    if (b?.settled != null) continue;
    // What it held as its first minute began, as a fill at that minute's mark: the change since is then its own.
    const carried = b && b.net !== 0 ? [{ side: b.net > 0 ? "bid" as const : "ask" as const, price: b.lastM ?? 0, size: Math.abs(b.net) }] : [];
    const book = rwFillBook([...carried, ...(byCond.get(cond) ?? [])]);
    const reward = a.reward - (b?.reward ?? 0);
    const total = accTotal(a) - (b ? accTotal(b) : 0);
    const mark = a.settled ?? a.lastM ?? 0;
    const settledPart = a.settled != null ? book.net * (a.settled - book.avgCost) : 0;
    // A market whose fills are not on record has no average cost to split by: its fill P&L is all open until it settles.
    const approx = input.approx?.has(cond) ? total - reward : null;
    const mRealised = approx != null ? reward + (a.settled != null ? approx : 0) : reward + book.realised + settledPart;
    const mUnrealised = approx != null ? (a.settled != null ? 0 : approx) : a.settled != null ? 0 : book.net * (mark - book.avgCost);
    realised += mRealised; unrealised += mUnrealised;
    const holding = a.settled == null && a.net !== 0;
    if (holding) { open++; held += a.net > 0 ? a.net * mark : -a.net * (1 - mark); }
    best = Math.max(best, total);
    const s = sel.get(cond), meta = st.meta?.[cond];
    if (!s && !holding) continue;
    const row = latest.get(cond);
    const ours = n(row?.ours), others = n(row?.others);
    markets.push({
      cond, q: s?.q ?? meta?.q ?? "", cat: s?.cat ?? meta?.cat ?? null, rank: s ? Number(s.rank) : null, quoting: !!s,
      ratePerDay: s ? Number(s.rate) : meta?.rate ?? null, endDate: s?.end_date ?? null,
      net: a.net, avgCost: approx == null && book.net !== 0 ? book.avgCost : null, mark: a.lastM, settled: a.settled,
      rewardUsd: reward, fillsPnlUsd: total - reward, totalUsd: total, fills: a.fills - (b?.fills ?? 0), capitalUsd: accCapital(a),
      bid: row && row.qb !== false ? n(row.b) : null, ask: row && row.qa !== false ? n(row.a) : null,
      share: ours != null && ours > 0 && others != null ? ours / (ours + others) : null,
    });
  }
  // Today's portfolio first, in its rank; then what is only held.
  markets.sort((x, y) => (x.rank == null ? 1 : 0) - (y.rank == null ? 1 : 0) || Number(x.rank ?? 0) - Number(y.rank ?? 0) || String(x.cond).localeCompare(String(y.cond)));

  const asc = input.days.filter((d) => Date.parse(d.day) < st.dayOf).sort((a, b) => a.day.localeCompare(b.day));
  const days = rwDayRows(asc, since ? new Date(since.ms).toISOString().slice(0, 10) : null, was.total, inst);
  // Today against yesterday's close; on a variant's first day, against its first minute.
  const yesterday = asc.find((d) => Date.parse(d.day) === st.dayOf - DAY);
  const baseline = since && st.dayOf <= since.ms ? was.total
    : yesterday && (yesterday.detail?.phase ?? rwPhase(Date.parse(yesterday.day), inst)) === phase ? Number(yesterday.total) : 0;

  const capital = snap.capital > 0 ? snap.capital : input.selection.reduce((s, x) => s + Number(x.capital), 0);
  const recent = rwRecent(byCond, (cond) => sel.get(cond)?.q ?? st.meta?.[cond]?.q ?? "");
  const total = snap.total - was.total, reward = snap.reward - was.reward;
  return {
    ...head, startedAt: since ? new Date(since.ms).toISOString() : input.firstMinute,
    capitalUsd: capital, totalUsd: total, stressUsd: snap.stress - was.stress, rewardUsd: reward, fillsPnlUsd: total - reward,
    realisedUsd: realised, unrealisedUsd: unrealised, mismatchUsd: realised + unrealised - total,
    todayUsd: snap.total - baseline, heldUsd: held, open, fills: snap.fills - was.fills, quoting: input.selection.length,
    bestMarketUsd: Number.isFinite(best) ? best : null,
    markets, days, recent,
  };
}

/**
 * Closed days, newest first, each against the day before in the same phase: the warm-up starts at nothing, and so does
 * the run. A variant's (`from`, its first day) lists only its own days, the first against its first minute, whose
 * running total is `was`; each day's `runningUsd` is then its own since. A day row without its phase is placed against
 * `inst`'s fourteen days.
 */
function rwDayRows(asc: RwDayRow[], from: string | null, was: number, inst: RwInstance) {
  return asc.map((d, i) => {
    const p = d.detail?.phase ?? rwPhase(Date.parse(d.day), inst);
    const prev = i > 0 && (asc[i - 1].detail?.phase ?? rwPhase(Date.parse(asc[i - 1].day), inst)) === p ? asc[i - 1] : null;
    const less = (k: "total" | "stress_total" | "reward" | "fills") => Number(d[k]) - (prev ? Number(prev[k]) : 0);
    return { day: d.day, phase: p, totalUsd: less("total"), stressUsd: less("stress_total"), rewardUsd: less("reward"), fills: less("fills"), capitalUsd: Number(d.capital), markets: Number(d.markets), runningUsd: Number(d.total) - (from ? was : 0) };
  }).filter((d) => !from || String(d.day).slice(0, 10) >= from).reverse();
}

/** The newest fills, newest first, as the page lists them. */
function rwRecent(byCond: Map<string, RwFillRow[]>, q: (cond: string) => string) {
  return [...byCond.values()].flat().sort((x, y) => fillOrder(y, x)).slice(0, RW_RECENT_FILLS).map((f) => ({
    ts: f.ts, minute: f.minute, cond: f.cond, q: q(f.cond), side: f.side, price: Number(f.price), size: Number(f.size),
  }));
}

/**
 * How long after RW-C's warm-up begins its engine may still have no state before the page says it is not running: the
 * warm-up's first selection is made in its first minutes, tried again five minutes later if it fails, and the engine
 * starts on its first run after one lands.
 */
export const RWC_FIRST_STATE_MINUTES = RW_STALE_MINUTES + 5;

/**
 * RW-C on the page (`0069`; the RW-NEXT pre-registration's part 2): the dashboard's `rwc`, a row of TESTING with RW's
 * page, made by RW's own summary from RW-C's own engine run and read against its fourteen days, 2026-10-09 → 10-23 UTC.
 * It counts from its first minute, which its engine starts flat, so its warm-up is on neither its row nor its page:
 * until that minute is decided the summary is `notStarted` and says when it starts. Before the engine has a state at
 * all (before its warm-up, 2026-10-08) the summary is the same, made from the constants; a state still missing
 * `RWC_FIRST_STATE_MINUTES` into the warm-up reads as not running.
 */
export function rwcSummary(input: { state: RwStateRow | null; selection: RwSelRow[]; latest: RwMinuteRow[]; days: RwDayRow[]; fills: RwFillRow[]; nowMs: number }) {
  const inst = RWC_INSTANCE;
  const summary = rwSummary({ ...input, firstMinute: null, inst, since: { ms: inst.runStart, base: {} } });
  if (summary) return summary;
  const at = (ms: number) => new Date(ms).toISOString();
  return {
    phase: rwPhase(input.nowMs, inst), runStart: at(inst.runStart), runEnd: at(inst.runEnd), dayOfRun: null,
    lastMinute: null, lagMinutes: null, lastError: null,
    running: input.nowMs < (inst.quietUntil ?? inst.runStart) + RWC_FIRST_STATE_MINUTES * M, finished: false, fundedUsd: RW_FUNDED_USD,
    catchingUp: false, notStarted: true, startsAt: at(inst.runStart), startedAt: null,
    capitalUsd: 0, totalUsd: 0, stressUsd: 0, rewardUsd: 0, fillsPnlUsd: 0, realisedUsd: 0, unrealisedUsd: 0, mismatchUsd: 0,
    todayUsd: 0, heldUsd: 0, open: 0, fills: 0, quoting: 0, bestMarketUsd: null,
    markets: [] as Array<Record<string, unknown>>, days: [] as ReturnType<typeof rwDayRows>, recent: [] as ReturnType<typeof rwRecent>,
  };
}

export type RweStateRow = { state: unknown; last_minute: string | null; last_error: string | null; updated_at?: string | null };
export type RweDaysRow = { day: string; arm: "rw" | "e"; total: number | string; stress_total: number | string; reward: number | string; fills: number | string; capital: number | string; markets?: number | string; detail: { excluded?: string[]; check?: Record<string, number> | null } | null };

/**
 * How long the replay may trail the clock before the page says it has stopped. It runs every minute (`0060`; every
 * five until then) and replays up to the last minute RW has decided, which itself may trail by RW_STALE_MINUTES.
 */
export const RWE_STALE_MINUTES = RW_STALE_MINUTES + 3;

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
  // RW-E's rule from its twelve days' first minute: before them it is RW (its pre-registration, replay version 2).
  const firstDay = new Date(RWE_START).toISOString().slice(0, 10);
  const out = (cond: string, day: string) => day >= firstDay && (excluded.get(day)?.has(cond) ?? false);
  const today = new Date(Math.floor(st.dayOf / DAY) * DAY).toISOString().slice(0, 10);
  const rw = input.rwState?.state as RwState | undefined;
  return rwSummary({
    state: {
      state: { acc: st.arms.e.acc, dayActive: st.arms.e.dayActive, lastDecided: st.lastDecided, dayOf: st.dayOf, meta: rw?.meta ?? {} },
      last_minute: input.eState.last_minute, last_error: input.eState.last_error, updated_at: input.eState.updated_at,
    },
    selection: input.today.filter((s) => !out(s.cond, String(s.day).slice(0, 10))),
    latest: input.latest.filter((r) => !out(r.cond, today)),
    days: input.days.filter((d) => d.arm === "e").map((d) => ({
      day: String(d.day).slice(0, 10), total: d.total, stress_total: d.stress_total, reward: d.reward, fills: d.fills, capital: d.capital,
      markets: d.markets ?? 0, detail: null,
    })),
    fills: input.fills.filter((f) => !diverged.has(f.cond) && !out(f.cond, dayOf(f.minute))),
    // Only what RW-E did under its own rule: from its twelve days' first minute, against what it held as it began.
    firstMinute: new Date(RW_RUN_START).toISOString(), nowMs: input.nowMs, staleMinutes: RWE_STALE_MINUTES, approx: diverged,
    since: { ms: RWE_START, base: st.base },
  });
}

/** A replayed variant's closed days, as `pm_rw_x_days` holds them. */
export type RwxDaysRow = { day: string; arm: string; total: number | string; stress_total: number | string; reward: number | string; fills: number | string; capital: number | string; markets?: number | string };

/**
 * RW-E's variants as strategies of their own on the page (Davies, 2026-09-27; `reviews/2026-09-27-polymarket-rw-variants-
 * prereg.md`): each arm of the variants' replay in the shape of the dashboard's `rw`, as `rweArmSummary` makes RW-E's —
 * its own accounts and closed days, and RW's fills less those it did not make: the market-days its rules leave out, the
 * minutes it was paused, and the markets it ran through the rule itself, whose fills are not on record. `checks` are the
 * replay's two: its `rw` arm against RW's days and its `e` arm against RW-E's. Empty until the replay has a state.
 */
export function rwxArmSummaries(input: {
  rwState: RwStateRow | null; xState: RweStateRow | null; selectionAll: RweSelRow[]; today: RwSelRow[]; latest: RwMinuteRow[];
  days: RwxDaysRow[]; fills: RwFillRow[]; nowMs: number;
}) {
  const st = input.xState?.state as RwxStored | undefined;
  if (!st || typeof st !== "object" || !("arms" in st) || !input.xState?.last_minute) return [];
  const xState = input.xState;
  const excluded = excludedByDay(input.selectionAll);
  const rw = input.rwState?.state as RwState | undefined;
  const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
  const today = new Date(Math.floor(st.dayOf / DAY) * DAY).toISOString().slice(0, 10);
  // The replay's two checks (the pre-registration's): its rw arm against RW's own days, its e arm against RW-E's.
  const checks = {
    rwMaxUsd: st.checkMaxUsd, eMaxUsd: st.checkEMaxUsd ?? 0, eDays: st.checkEDays ?? 0,
    ok: st.checkMaxUsd < RWE_CHECK_USD && (st.checkEMaxUsd ?? 0) < RWE_CHECK_USD,
  };
  const out = [];
  for (const spec of RWX_SPECS) {
    if (spec.id === "e" || !st.arms[spec.id]) continue;
    const a = st.arms[spec.id];
    const diverged = new Set(a.diverged);
    // Left out for a whole day: RW-E's rule from its first day, the arm's categories from its own.
    const leftOut = (cond: string, day: string) => {
      const t = dayMs(day);
      if (spec.noSameDayFrom !== null && t >= spec.noSameDayFrom && (excluded.get(day)?.has(cond) ?? false)) return true;
      const cat = spec.noCats && t >= spec.from ? metaFor(input.selectionAll, cond, t)?.cat : null;
      return !!cat && spec.noCats!.includes(String(cat));
    };
    const paused = (cond: string, ms: number) => (a.pauses?.[cond] ?? []).some(([f, u]) => ms >= f && ms < u);
    const summary = rwSummary({
      state: {
        state: { acc: a.acc, dayActive: a.dayActive, lastDecided: st.lastDecided, dayOf: st.dayOf, meta: rw?.meta ?? {} },
        last_minute: xState.last_minute, last_error: xState.last_error, updated_at: xState.updated_at,
      },
      selection: input.today.filter((x) => !leftOut(x.cond, String(x.day).slice(0, 10))),
      latest: input.latest.filter((r) => !leftOut(r.cond, today) && !paused(r.cond, Date.parse(r.minute))),
      days: input.days.filter((d) => d.arm === spec.id).map((d) => ({
        day: String(d.day).slice(0, 10), total: d.total, stress_total: d.stress_total, reward: d.reward, fills: d.fills, capital: d.capital,
        markets: d.markets ?? 0, detail: null,
      })),
      fills: input.fills.filter((f) => !diverged.has(f.cond) && !leftOut(f.cond, new Date(Math.floor(Date.parse(f.minute) / DAY) * DAY).toISOString().slice(0, 10))
        && !paused(f.cond, Date.parse(f.minute))),
      firstMinute: new Date(RW_RUN_START).toISOString(), nowMs: input.nowMs, staleMinutes: RWE_STALE_MINUTES, approx: diverged,
      // Only what the variant did under its own rules: from its first minute, against what it held as that began.
      since: { ms: spec.from, base: a.base },
    });
    if (summary) out.push({ ...summary, id: spec.id, name: RWX_NAMES[spec.id], checks });
  }
  return out;
}
