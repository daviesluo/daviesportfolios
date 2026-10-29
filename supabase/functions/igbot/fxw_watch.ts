// `GET /igbot?action=fxw_watch`: the AUD weekend strategy's health for IGBOT's agent, which watches it for Davies.
//
// Davies, 2026-10-29: "我想让ig trader bot帮我也盯着澳元策略的记录和run的情况". The agent reaches us only through this function
// with its bearer; it has no database and no site login. This answer is READ-ONLY and small (under 8 KB): it reads the
// database alone, makes no IG call and reads no IG secret (the handler answers it before IG's client is built). It
// carries no balance of any account: the FXW book is paper, and the live IG facts it reads were stripped of balances by
// the `ig` function before they were stored; an account id is shown by its last two characters only.
//
// What it reads: `ig_fxw_state` and the newest `ig_fxw_weekends` rows (`supabase/functions/ig/fxw.ts`, 0162), the
// weekend recorder's runs on the live login (`ig_quote_runs`, environment 'live', 0161), the newest live `ig_facts` row of
// each account kind, and the two calls of the minute job that serve it (`edge_calls`, `edge_call_beats`, 0075). The window
// is `public.ig_quotes_window`'s, worked out in code (`inDbWindow`, which the ig function's Deno test checks against it).
// `problems` is the list the agent's prompt tells it to report (docs/agents/igbot/GROK_PROMPT.md, "Watching the AUD
// weekend strategy (FXW-AUD) for Davies"): an empty list is a healthy strategy.

import type { Db } from "../agents/db.ts";
import { inDbWindow, ukToUtcMs } from "../ig/windows.ts";

/**
 * The strategy's terms this answer needs, as `supabase/functions/ig/fxw.ts` holds them (a vitest pins that they agree).
 * Copied, not imported: fxw.ts reaches the `ig` function's client, which knows IG's live host, and nothing of IGBOT's may.
 */
export const FXW = { name: "FXW-AUD weekend", fundedGbp: 1000, horizonMs: 24 * 3_600_000, startFriday: "2026-10-30" } as const;
/** A weekend's UK instants from its Friday: the start (Friday 21:35), Friday's close (22:00) and Sunday's open (21:00). */
export function weekendTimes(friday: string) {
  const [y, m, d] = friday.split("-").map(Number);
  const at = (days: number, hh: number, mm: number) => {
    const day = new Date(Date.UTC(y, m - 1, d + days));
    return ukToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
  };
  return { start: at(0, 21, 35), friClose: at(0, 22, 0), open: at(2, 21, 0) };
}

export const FXW_WATCH_ACTION = "fxw_watch";
/** The answer's cap: the agent reads it in its context. */
export const FXW_WATCH_MAX_BYTES = 8192;
/** A call with no beat for this long is a problem (its row runs every minute or every five). */
export const FXW_WATCH_BEAT_MS = 10 * 60_000;
export const FXW_WATCH_WEEKENDS = 3;
const KINDS = ["sb", "cfd"] as const;
const CALLS = ["ig?action=quotes", "ig?action=fxw"] as const;
const MIN = 60_000;

/** Every problem the answer can name, and what it means (the prompt lists the same codes; a vitest pins them). */
export const FXW_WATCH_PROBLEMS = {
  recorder_failing: "the weekend recorder's last two or more runs failed, inside its window",
  facts_not_ok: "an account's newest live facts row is missing, not ok, or names no AUD/USD epic",
  missing_accounts: "an account kind has no ok live facts row, so the recorder reads only the other",
  fxw_error: "the strategy's last run ended with an error",
  weekend_missed: "the newest weekend is MISSED: the recorder held no quote in a minute after Sunday's open",
  no_beat: "a call has written no beat for 10 minutes while it should be running",
} as const;
export type FxwWatchProblem = keyof typeof FXW_WATCH_PROBLEMS;

type State = { last_run: string | null; last_error: string | null; name: string | null; funded_gbp: number | null; stake_gbp: number | null; start_at: string | null };
type Weekend = Record<string, unknown> & { friday: string; status: string };
type Run = { id: number; ok: boolean; started_at: string };
type LastRun = Run & { error: string | null };
type Facts = { at: string; account_kind: string; account_id: string | null; ok: boolean; selected: Record<string, string> | null };
type Call = { path: string; enabled: boolean };

export type FxwWatchInput = {
  state: State | null; weekends: Weekend[]; runs: Run[]; lastRun: LastRun | null; facts: Partial<Record<(typeof KINDS)[number], Facts | null>>;
  calls: Call[]; beats: Partial<Record<(typeof CALLS)[number], string | null>>; windowFrom: number;
};

const n = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const iso = (ms: number) => new Date(ms).toISOString();
const ageMin = (at: string | null | undefined, now: number) => (at ? Math.max(0, Math.round((now - Date.parse(at)) / MIN)) : null);
/** An account id by its last two characters. */
export const maskAccount = (id: string | null | undefined) => (id ? `…${String(id).slice(-2)}` : null);

/** The start of the window `now` is in, or of the last one before it (minutes; at most a fortnight back). */
export function windowStart(now: number): number {
  let t = Math.floor(now / MIN) * MIN;
  for (let i = 0; i < 20_160 && !inDbWindow(t); i++) t -= MIN;
  for (let i = 0; i < 20_160 && inDbWindow(t - MIN); i++) t -= MIN;
  return t;
}
/** The next window start after `now`. */
export function nextWindowStart(now: number): number {
  let t = Math.floor(now / MIN) * MIN + MIN;
  for (let i = 0; i < 20_160 && inDbWindow(t); i++) t += MIN;
  for (let i = 0; i < 20_160 && !inDbWindow(t); i++) t += MIN;
  return t;
}

/** The strategy's next step, in words with its instant. */
function nextStep(latest: Weekend | null, now: number): string {
  const s = latest?.status;
  if (latest && s === "open") {
    const exitBy = Date.parse(String(latest.entry_ts)) + FXW.horizonMs;
    return `close at the first quote reaching Friday's mid ${latest.fri_mid}, else at the first quote from ${iso(exitBy)}`;
  }
  if (latest && s === "waiting") return `the decision quote at Sunday's open, ${iso(weekendTimes(latest.friday).open)}`;
  if (latest && s === "pending") return `Friday's mid frozen at ${iso(weekendTimes(latest.friday).friClose)}`;
  // The next Friday whose 21:35 UK is ahead.
  const [y, m, d] = FXW.startFriday.split("-").map(Number);
  for (let k = 0; k < 520; k++) {
    const f = new Date(Date.UTC(y, m - 1, d + 7 * k)).toISOString().slice(0, 10);
    const w = weekendTimes(f);
    if (w.start > now) return `Friday's quotes from ${iso(w.start)}, Friday's mid at ${iso(w.friClose)}`;
  }
  return "none";
}

/** The answer, from what was read. Pure. */
export function fxwWatchView(x: FxwWatchInput, now: number) {
  const problems: { code: FxwWatchProblem; detail: string }[] = [];
  const add = (code: FxwWatchProblem, detail: string) => problems.push({ code, detail: detail.slice(0, 160) });
  const ids = KINDS.map((k) => x.facts[k]?.account_id).filter((v): v is string => !!v);
  /** Free text with every account id masked. */
  const mask = (t: string | null | undefined) => (t ? ids.reduce((a, id) => a.split(id).join(maskAccount(id)!), String(t)).slice(0, 160) : null);

  // The strategy.
  const st = x.state;
  const weekends = [...x.weekends].sort((a, b) => b.friday.localeCompare(a.friday));
  const latest = weekends[0] ?? null;
  const funded = n(st?.funded_gbp) ?? FXW.fundedGbp;
  const closed = x.weekends.filter((w) => w.status === "closed").reduce((a, w) => a + (n(w.net_gbp) ?? 0), 0);
  const open = weekends.find((w) => w.status === "open") ?? null;
  const equity = Math.round((funded + closed + (open ? n(open.net_gbp) ?? 0 : 0)) * 100) / 100;
  const started = !!st?.start_at && now >= Date.parse(st.start_at);
  if (st?.last_error) add("fxw_error", mask(st.last_error)!);
  if (latest?.status === "missed") add("weekend_missed", `${latest.friday}: ${mask(String(latest.reason ?? ""))}`);
  const strategy = {
    name: st?.name ?? FXW.name, kind: "frozen paper strategy, not traded by the agent",
    start_gbp: funded, equity_gbp: equity, change_gbp: Math.round((equity - funded) * 100) / 100, stake_gbp_per_pip: n(st?.stake_gbp),
    start_at: st?.start_at ?? null, status: !st ? "no run yet" : !started ? "not started" : latest?.status ?? "no weekend yet",
    last_run: st?.last_run ?? null, last_run_age_min: ageMin(st?.last_run, now), last_error: mask(st?.last_error),
    open_position: open
      ? { friday: open.friday, side: open.side, entry: n(open.entry_price), entry_at: open.entry_ts, mark: n(open.mark_price), mark_at: open.mark_ts, net_gbp: n(open.net_gbp), margin_gbp: n(open.margin_gbp) }
      : null,
    next_step: nextStep(latest, now),
  };
  const weekendRows = weekends.slice(0, FXW_WATCH_WEEKENDS).map((w) => ({
    friday: w.friday, status: w.status, reason: mask(w.reason as string | null),
    friday_mid: w.fri_ts ? { mid: n(w.fri_mid), bid: n(w.fri_bid), offer: n(w.fri_offer), at: w.fri_ts } : null,
    decision: w.dec_ts ? { bid: n(w.dec_bid), offer: n(w.dec_offer), at: w.dec_ts, gap_bps: n(w.gap_bps) } : null,
    side: w.side ?? null, entry: w.entry_ts ? { price: n(w.entry_price), at: w.entry_ts } : null,
    exit: w.exit_ts ? { price: n(w.exit_price), bid: n(w.exit_bid), offer: n(w.exit_offer), at: w.exit_ts, reason: w.exit_reason } : null,
    net_gbp: n(w.net_gbp), funding_gbp: n(w.funding_gbp),
  }));

  // The window and the recorder.
  const inWindow = inDbWindow(now);
  const runs = [...x.runs].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id - b.id);
  const count = (from: number) => {
    const r = runs.filter((q) => Date.parse(q.started_at) >= from);
    return { ok: r.filter((q) => q.ok).length, failed: r.filter((q) => !q.ok).length };
  };
  let streak = 0;
  for (let i = runs.length - 1; i >= 0 && !runs[i].ok && Date.parse(runs[i].started_at) >= x.windowFrom; i--) streak++;
  if (inWindow && streak >= 2) add("recorder_failing", `${streak} failed runs in a row; the last: ${mask(x.lastRun?.error) ?? "no error text"}`);
  const factsOut: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const k of KINDS) {
    const f = x.facts[k] ?? null;
    const found = !!f?.selected?.fx_audusd;
    factsOut[k] = f ? { account: maskAccount(f.account_id), ok: !!f.ok, fx_audusd_found: found, at: f.at } : null;
    if (!f || !f.ok) missing.push(k);
    if (!f || !f.ok || (k === "sb" && !found)) add("facts_not_ok", `${k}: ${!f ? "no live facts row" : !f.ok ? "the newest live facts row is not ok" : "no AUD/USD epic"}`);
  }
  if (missing.length) add("missing_accounts", `the recorder has no ok live facts for: ${missing.join(", ")}`);
  const recorder = {
    environment: "live",
    last_run_at: x.lastRun?.started_at ?? null, last_run_ok: x.lastRun ? !!x.lastRun.ok : null, last_error: mask(x.lastRun?.error),
    last_hour: count(now - 3_600_000), window: { from: iso(x.windowFrom), ...count(x.windowFrom) }, failed_streak: streak, missing_accounts: missing,
  };

  // The calls.
  const callsOut: Record<string, unknown> = {};
  for (const p of CALLS) {
    const c = x.calls.find((q) => q.path === p) ?? null;
    const age = ageMin(x.beats[p], now);
    callsOut[p] = { enabled: c ? !!c.enabled : null, last_beat_age_min: age };
    const due = p === "ig?action=fxw" ? !!c?.enabled : inWindow && !!c?.enabled;
    if (due && (age === null || age * MIN > FXW_WATCH_BEAT_MS)) add("no_beat", `${p}: ${age === null ? "no beat recorded" : `last beat ${age} min ago`}`);
  }

  return {
    now: iso(now),
    strategy, weekends: weekendRows, recorder,
    window: { in_window: inWindow, current_from: inWindow ? iso(x.windowFrom) : null, next_start: inWindow ? null : iso(nextWindowStart(now)) },
    facts: factsOut, calls: callsOut,
    problems,
  };
}

/** Everything the answer reads, from the database alone. */
export async function readFxwWatch(db: Db, now: number) {
  const from = windowStart(now);
  const since = iso(Math.min(from, now - 3_600_000));
  const one = async <T>(table: string, q: string) => (await db.select<T>(table, q))[0] ?? null;
  const factsOf = (k: string) =>
    one<Facts>("ig_facts", `select=at,account_kind,account_id,ok,selected&environment=eq.live&account_kind=eq.${k}&order=id.desc&limit=1`);
  const beatOf = async (p: string) =>
    (await one<{ ts: string }>("edge_call_beats", `select=ts&path=eq.${encodeURIComponent(p)}&order=minute.desc&limit=1`))?.ts ?? null;
  const [state, weekends, runs, lastRun, sb, cfd, quotesCall, fxwCall, quotesBeat, fxwBeat] = await Promise.all([
    one<State>("ig_fxw_state", "id=eq.1&select=last_run,last_error,name,funded_gbp,stake_gbp,start_at"),
    db.select<Weekend>("ig_fxw_weekends", "select=friday,status,reason,fri_ts,fri_bid,fri_offer,fri_mid,dec_ts,dec_bid,dec_offer,gap_bps,side,entry_ts,entry_price,margin_gbp,exit_ts,exit_bid,exit_offer,exit_price,exit_reason,mark_ts,mark_price,net_gbp,funding_gbp&order=friday.desc&limit=12"),
    db.selectAll<Run>("ig_quote_runs", `select=id,ok,started_at&environment=eq.live&started_at=gte.${encodeURIComponent(since)}&order=started_at.asc,id.asc`),
    one<LastRun>("ig_quote_runs", "select=id,ok,started_at,error&environment=eq.live&order=id.desc&limit=1"),
    factsOf("sb"), factsOf("cfd"),
    one<Call>("edge_calls", `select=path,enabled&path=eq.${encodeURIComponent(CALLS[0])}`),
    one<Call>("edge_calls", `select=path,enabled&path=eq.${encodeURIComponent(CALLS[1])}`),
    beatOf(CALLS[0]), beatOf(CALLS[1]),
  ]);
  return fxwWatchView({
    state, weekends, runs, lastRun, facts: { sb, cfd }, calls: [quotesCall, fxwCall].filter((c): c is Call => !!c),
    beats: { [CALLS[0]]: quotesBeat, [CALLS[1]]: fxwBeat }, windowFrom: from,
  }, now);
}
