// The two outside-Grok test rows of TESTING (Davies, 2026-10-29: "在testing列表中把IG Trader…都上线", and the standing
// instruction that a verified build is shown in TESTING): "Crypto analyst" (CXBOT, paper on Hyperliquid's public tape,
// `cxbot_*`, 0161) and "IG Trader" (IGBOT, spread bets on IG's demo, `igbot_*`, 0157). Each is summarised in one shape the
// page draws as a row and a page (`grokTestRow`, `GrokTestDetail` in src/agents): the mode, the budget and the equity
// against it, today, the open positions with their stop and limit, trades, the days run, and the scores per layer.
//
// IG Trader's money is its BUDGET (£1,000, `igbot_config.budget_gbp`) plus its P&L since the arm, read from the demo
// account's snapshots as a difference: the demo account's own balance is never returned. Its scored brackets use the F11
// outcome (a bracket closed early, or amended, scores where its close level stands between stop and limit), as its scorer
// does (docs/agents/backtests/igbot/score.mjs). CXBOT's layer A is the assigned brackets the server resolved on its tape;
// its own brackets score here on how they closed, the reading re-scores both from the tape.

import type { Db } from "./db.ts";

const DAY = 86400e3;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const num = (x: unknown): number | null => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const ms = (s: unknown) => (s === null || s === undefined ? NaN : Date.parse(String(s)));

export type Layer = { key: string; label: string; scored: number; issued?: number; answered?: number; d: number | null; brierP: number | null; brierBase: number | null; base: string };
export type GrokTestPosition = { market: string; direction: "long" | "short"; size: number; entry: number; stop: number | null; limit: number | null; openedAt: string; pnl: number | null };
export type GrokTest = {
  id: "cxbot" | "igbot"; name: string; venueId: "hyperliquid" | "ig"; ccy: "USD" | "GBP"; usdPerUnit: number | null;
  mode: string; startedAt: string | null; daysRun: number | null; shakedown: boolean; running: boolean; lagMinutes: number | null;
  budget: number; equity: number; realised: number; unrealised: number; fees: number; today: number; deployed: number;
  positions: GrokTestPosition[]; resting: number; trades: number; layers: Layer[]; stops: { dayHit: boolean; totalHit: boolean };
};

/** Brier of p and of the baseline over rows {p, base, y}, and D = Brier(base) − Brier(p) (positive: the agent is better). */
export function brierOf(rows: Array<{ p: number; base: number; y: number }>) {
  if (!rows.length) return { d: null, brierP: null, brierBase: null };
  const c = (x: number) => Math.min(0.999, Math.max(0.001, x));
  const bp = rows.reduce((s, r) => s + (c(r.p) - r.y) ** 2, 0) / rows.length;
  const bb = rows.reduce((s, r) => s + (c(r.base) - r.y) ** 2, 0) / rows.length;
  return { d: r4(bb - bp), brierP: r4(bp), brierBase: r4(bb) };
}

/** Where a price stands in a bracket, from the stop (0) to the limit (1), clipped (the F11 outcome). */
export function fraction(long: boolean, stop: number, limit: number, x: number): number {
  const f = long ? (x - stop) / (limit - stop) : (stop - x) / (stop - limit);
  return Math.min(1, Math.max(0, f));
}

const daysSince = (start: string | null, now: number) => (start ? Math.max(0, Math.floor((now - ms(start)) / DAY) + 1) : null);

// ── Crypto analyst (CXBOT) ────────────────────────────────────────────────────────────────────────────────────────────

export type CxbotInput = {
  config: Record<string, unknown> | null; state: Record<string, unknown> | null; snapshot: Record<string, unknown> | null; dayOpen: number | null;
  positions: Array<Record<string, unknown>>; resting: number; questions: Array<Record<string, unknown>>; forecasts: Array<Record<string, unknown>>;
  lastFetchedAt: string | null; mids: Record<string, number>; nowMs: number;
};

export function cxbotSummary(x: CxbotInput): GrokTest | null {
  if (!x.config) return null;
  const budget = num(x.config.budget_usd) ?? 1000;
  const startedAt = (x.config.started_at as string) ?? null;
  const paper = x.config.mode === "paper";
  const eq = paper ? num(x.snapshot?.equity_usd) ?? budget : budget;
  const unrealised = paper ? num(x.snapshot?.unrealised_usd) ?? 0 : 0;
  const fees = paper ? num(x.snapshot?.fees_usd) ?? 0 : 0;
  const open = x.positions.filter((p) => p.state === "open");
  const closed = x.positions.filter((p) => p.state === "closed");
  const lag = x.lastFetchedAt ? Math.round((x.nowMs - ms(x.lastFetchedAt)) / 60e3) : null;
  // Layer A: the assigned brackets the server resolved and the agent answered; B: Polymarket's strikes against the mid.
  const p = new Map(x.forecasts.map((f) => [String(f.question_id), num(f.p)]));
  const t0 = startedAt ? ms(startedAt) + 2 * DAY : Infinity;
  const aIssued = x.questions.filter((q) => q.layer === "A" && ms(q.issued_at) >= t0);
  const aRows = aIssued.filter((q) => q.state === "resolved" && p.get(String(q.id)) != null).map((q) => ({ p: p.get(String(q.id))!, base: Number(q.m), y: Number(q.y) }));
  const bRows = x.questions.filter((q) => q.layer === "B" && ms(q.issued_at) >= t0 && q.state === "resolved" && p.get(String(q.id)) != null && num(q.pm_mid) !== null)
    .map((q) => ({ p: p.get(String(q.id))!, base: Number(q.pm_mid), y: Number(q.y) }));
  // Layer C here: the real paper brackets closed after the shakedown, scored on how they closed against their original levels.
  const cRows = closed.filter((q) => ms(q.opened_at) >= t0 && num(q.p) !== null && num(q.close_price) !== null).map((q) => {
    const long = q.direction === "long", stop = Number(q.stop0), limit = Number(q.limit0), entry = Number(q.entry);
    const y = q.close_how === "limit" && Number(q.limit_px) === limit ? 1 : q.close_how === "stop" && Number(q.stop) === stop ? 0 : fraction(long, stop, limit, Number(q.close_price));
    return { p: Number(q.p), base: long ? (entry - stop) / (limit - stop) : (stop - entry) / (stop - limit), y };
  });
  const answered = aIssued.filter((q) => p.get(String(q.id)) != null).length;
  return {
    id: "cxbot", name: "Crypto analyst", venueId: "hyperliquid", ccy: "USD", usdPerUnit: 1,
    mode: paper ? "paper" : "dry_run", startedAt, daysRun: paper ? daysSince(startedAt, x.nowMs) : null,
    shakedown: paper && !!startedAt && x.nowMs < ms(startedAt) + 2 * DAY, running: lag !== null && lag <= 3, lagMinutes: lag,
    budget, equity: r2(eq), realised: r2(eq - budget - unrealised), unrealised: r2(unrealised), fees: r2(fees),
    today: paper && x.dayOpen !== null ? r2(eq - x.dayOpen) : 0,
    deployed: r2(open.reduce((s, q) => s + (Number(q.size) * Number(q.entry)) / (Number(q.leverage) || 1), 0)),
    positions: open.map((q) => {
      const mid = x.mids[String(q.coin)];
      const long = q.direction === "long";
      return {
        market: `${q.coin}-PERP`, direction: long ? "long" : "short", size: Number(q.size), entry: Number(q.entry), stop: num(q.stop), limit: num(q.limit_px), openedAt: String(q.opened_at),
        pnl: mid ? r2((long ? 1 : -1) * (mid - Number(q.entry)) * Number(q.size) - Number(q.fee_open_usd ?? 0) - Number(q.funding_usd ?? 0)) : null,
      };
    }),
    resting: x.resting, trades: x.positions.length,
    layers: [
      { key: "A", label: "Assigned brackets", scored: aRows.length, issued: aIssued.length, answered, ...brierOf(aRows), base: "m" },
      { key: "B", label: "Polymarket strikes", scored: bRows.length, ...brierOf(bRows), base: "market mid" },
      { key: "C", label: "Own brackets (closed)", scored: cRows.length, ...brierOf(cRows), base: "m" },
    ],
    stops: { dayHit: !!x.state?.dayStop && String((x.state.dayStop as { day?: string }).day) === new Date(x.nowMs).toISOString().slice(0, 10), totalHit: !!x.state?.totalStop },
  };
}

export async function readCxbot(d: Db, now: number): Promise<GrokTest | null> {
  try {
    const cfg = (await d.select<Record<string, unknown>>("cxbot_config", "id=eq.1&select=mode,venue,started_at,budget_usd"))[0] ?? null;
    if (!cfg) return null;
    const venue = String(cfg.venue);
    const day = new Date(now - (now % DAY)).toISOString();
    const [st, snap, dayFirst, positions, resting, questions, forecasts, last] = await Promise.all([
      d.select<{ state: Record<string, unknown> }>("cxbot_exec_state", "id=eq.1&select=state"),
      d.select<Record<string, unknown>>("cxbot_snapshots", "select=slot,equity_usd,unrealised_usd,fees_usd&order=slot.desc&limit=1"),
      d.select<{ equity_usd: number }>("cxbot_snapshots", `slot=gte.${encodeURIComponent(day)}&select=equity_usd&order=slot.asc&limit=1`),
      d.select<Record<string, unknown>>("cxbot_positions", "select=id,coin,direction,size,entry,stop,limit_px,stop0,limit0,p,leverage,opened_at,fee_open_usd,funding_usd,state,close_price,close_how&order=id.asc&limit=1000"),
      d.select<{ id: number }>("cxbot_orders", "state=eq.resting&select=id"),
      d.select<Record<string, unknown>>("cxbot_questions", "select=id,layer,issued_at,state,m,y,pm_mid&order=issued_at.desc&limit=5000"),
      d.select<Record<string, unknown>>("cxbot_forecasts", "select=question_id,p&order=question_id.asc&limit=10000"),
      d.select<{ coin: string; bid: number; ask: number; fetched_at: string }>("cxbot_tape", `venue=eq.${encodeURIComponent(venue)}&bid=not.is.null&select=coin,bid,ask,fetched_at&order=t.desc&limit=3`),
    ]);
    const mids: Record<string, number> = {};
    for (const r of last) if (!(r.coin in mids)) mids[r.coin] = (Number(r.bid) + Number(r.ask)) / 2;
    return cxbotSummary({
      config: cfg, state: st[0]?.state ?? null, snapshot: snap[0] ?? null, dayOpen: dayFirst[0] ? Number(dayFirst[0].equity_usd) : null,
      positions, resting: resting.length, questions, forecasts, lastFetchedAt: last[0]?.fetched_at ?? null, mids, nowMs: now,
    });
  } catch { return null; }
}

// ── IG Trader (IGBOT) ─────────────────────────────────────────────────────────────────────────────────────────────────

export type IgbotInput = {
  config: Record<string, unknown> | null; state: Record<string, unknown> | null; atArm: number | null; latest: Record<string, unknown> | null; dayOpen: number | null;
  positions: Array<Record<string, unknown>>; working: number; decisions: Array<Record<string, unknown>>; shadows: number; gbpusd: number | null; nowMs: number;
  instruments: Record<string, string>;
};

export function igbotSummary(x: IgbotInput): GrokTest | null {
  if (!x.config) return null;
  const budget = num(x.config.budget_gbp) ?? 1000;
  const armed = x.config.mode === "demo" && !!x.config.armed_at;
  const startedAt = (x.config.started_at as string) ?? null;
  const eqNow = num(x.latest?.equity_gbp);
  const today = new Date(x.nowMs).toISOString().slice(0, 10);
  // The equity at the arm and at the day's start as IGBOT's own engine keeps them (`igbot_exec_state`), else the snapshots'.
  const st = x.state ?? {};
  const atArm = num((st.startEquity as { equityGbp?: number } | undefined)?.equityGbp) ?? x.atArm;
  const dOpen = (st.dayOpen as { day?: string; equityGbp?: number } | undefined)?.day === today ? num((st.dayOpen as { equityGbp?: number }).equityGbp) : x.dayOpen;
  // The bot's money: its budget plus the demo account's change since the arm. The account's own balance is never shown.
  const pnl = armed && eqNow !== null && atArm !== null ? eqNow - atArm : 0;
  const equity = budget + pnl;
  const unrealised = armed ? num(x.latest?.upl_gbp) ?? 0 : 0;
  const lagMinutes = x.latest?.at ? Math.round((x.nowMs - ms(x.latest.at)) / 60e3) : null;
  const m = new Map(x.decisions.map((d) => [String(d.id), num(d.m_base)]));
  const p = new Map(x.decisions.map((d) => [String(d.id), num(d.p_target)]));
  const open = x.positions.filter((q) => q.state === "open");
  const rows = x.positions.filter((q) => q.state === "closed" && q.decision_id && m.get(String(q.decision_id)) != null && p.get(String(q.decision_id)) != null).map((q) => {
    const long = q.direction === "BUY";
    const d = x.decisions.find((k) => k.id === q.decision_id)!;
    const stop = Number(d.stop_level), limit = Number(d.limit_level);
    const y = q.close_how === "limit" ? 1 : q.close_how === "stop" ? 0 : num(q.close_level) === null ? null : fraction(long, stop, limit, Number(q.close_level));
    return y === null ? null : { p: p.get(String(q.decision_id))!, base: m.get(String(q.decision_id))!, y };
  }).filter((r): r is { p: number; base: number; y: number } => r !== null);
  return {
    id: "igbot", name: "IG Trader", venueId: "ig", ccy: "GBP", usdPerUnit: x.gbpusd,
    mode: armed ? "demo" : "dry_run", startedAt: armed ? startedAt : null, daysRun: armed ? daysSince(startedAt, x.nowMs) : null, shakedown: false,
    running: lagMinutes !== null && lagMinutes <= 10, lagMinutes,
    budget, equity: r2(equity), realised: r2(pnl - unrealised), unrealised: r2(unrealised), fees: 0, today: armed && dOpen !== null && eqNow !== null ? r2(eqNow - dOpen) : 0,
    deployed: armed ? r2(num(x.latest?.margin_gbp) ?? 0) : 0,
    positions: open.map((q) => ({
      market: x.instruments[String(q.epic)] ?? String(q.epic), direction: q.direction === "BUY" ? "long" : "short", size: Number(q.size), entry: Number(q.open_level),
      stop: num(q.stop_level), limit: num(q.limit_level), openedAt: String(q.opened_at), pnl: null,
    })),
    resting: x.working, trades: x.positions.length,
    layers: [
      { key: "R", label: "Brackets opened (closed)", scored: rows.length, ...brierOf(rows), base: "m" },
      { key: "S", label: "Shadow brackets journalled", scored: x.shadows, d: null, brierP: null, brierBase: null, base: "scored in the reading" },
    ],
    stops: { dayHit: (st.dayStop as { day?: string } | null | undefined)?.day === today, totalHit: !!st.totalStop },
  };
}

export async function readIgbot(d: Db, now: number): Promise<GrokTest | null> {
  try {
    const cfg = (await d.select<Record<string, unknown>>("igbot_config", "id=eq.1&select=mode,armed_at,started_at,budget_gbp"))[0] ?? null;
    if (!cfg) return null;
    const day = new Date(now - (now % DAY)).toISOString();
    const arm = cfg.armed_at ? String(cfg.armed_at) : null;
    const [st, latest, atArm, dayFirst, positions, decisions, shadows, inst, fx] = await Promise.all([
      d.select<{ state: Record<string, unknown> }>("igbot_exec_state", "id=eq.1&select=state"),
      d.select<Record<string, unknown>>("igbot_snapshots", "ok=is.true&select=slot,at,equity_gbp,upl_gbp,margin_gbp,working&order=slot.desc&limit=1"),
      arm ? d.select<{ equity_gbp: number }>("igbot_snapshots", `ok=is.true&slot=gte.${encodeURIComponent(arm)}&select=equity_gbp&order=slot.asc&limit=1`) : Promise.resolve([]),
      d.select<{ equity_gbp: number }>("igbot_snapshots", `ok=is.true&slot=gte.${encodeURIComponent(day)}&select=equity_gbp&order=slot.asc&limit=1`),
      d.select<Record<string, unknown>>("igbot_positions", "select=deal_id,epic,direction,size,open_level,stop_level,limit_level,opened_at,decision_id,state,close_level,close_how&order=opened_at.asc&limit=1000"),
      d.select<Record<string, unknown>>("igbot_decisions", "action=eq.open&select=id,m_base,p_target,stop_level,limit_level&order=ts.asc&limit=2000"),
      d.select<{ id: string }>("igbot_decisions", "action=eq.no_action&p_target=not.is.null&select=id&limit=5000"),
      d.select<{ epic: string; name: string }>("igbot_instruments", "select=epic,name"),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1").catch(() => []),
    ]);
    return igbotSummary({
      config: cfg, state: st[0]?.state ?? null, atArm: atArm[0] ? Number(atArm[0].equity_gbp) : null, latest: latest[0] ?? null,
      dayOpen: dayFirst[0] ? Number(dayFirst[0].equity_gbp) : null, positions, working: Array.isArray(latest[0]?.working) ? (latest[0].working as unknown[]).length : 0, decisions, shadows: shadows.length,
      gbpusd: fx[0] ? Number(fx[0].value) : null, nowMs: now, instruments: Object.fromEntries(inst.map((i) => [i.epic, i.name])),
    });
  } catch { return null; }
}
