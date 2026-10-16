// "Polymarket analyst (Grok)", GROKPM, as the Agents page shows it: a row of LIVE and a page of its own, modelled on the
// Reward quotes live page (Davies, 2026-10-15: "网站中live页也加上策略和子策略页面（仿照之前rewards策略来做）"). Pre-registered in
// docs/agents/reviews/2026-10-15-grokpm-prereg.md; migration 0124.
//
// Every dollar here is the INDEPENDENT record's (`grokpm_snapshots`, written keylessly by `grokpm_rec.ts`), never the agent's
// word. The agent's journal (`grokpm_decisions`, `grokpm_cycles`, `grokpm_daily`, posted by the agent to the `grokpm`
// function) is shown as what it says, beside the record, and a mismatch over $1 is flagged.
//
// What each figure is (the pre-registration's §5, in one place):
//   funded      `grokpm_config.funded_usd` ($100) from the experiment's start (`started_at`, the recorder's first snapshot
//               holding 90 % of it); nothing before it.
//   equity      the latest snapshot: pUSD + USDC.e + USDC, plus each position at its mark (the book's mid; its payout once
//               redeemable).
//   total       equity − funded.
//   today       equity − the day's opening equity (the UTC day's first snapshot; on the start day, funded).
//   unrealised  Σ over positions still trading of size × (mark − average price).
//   realised    total − unrealised: what its own trades closed and settled, after every fee, as their cash says.
//   deployed    Σ size × average price of what it holds: its cost.
//   stop room   $30 + total (the total stop) and $10 + today (the day's), as the agent's rules state them; the page only
//               shows them, nothing here can stop the agent.
//   Brier       on each token it bought whose market has resolved (`grokpm_entries` × `grokpm_resolutions`): the agent's p
//               from its last `open` decision for that token before the first fill, the market's m the book's mid when the
//               record first saw it (the agent's own m when the record has none), y its payout; the mean of (p − y)² against
//               the mean of (m − y)².
//   DAYS        each UTC day from the start: the record's P&L (its close, the next day's opening equity, or the latest for
//               today, less its open) beside the agent's own daily summary; a gap over $1 is a mismatch.

const DAY = 86400e3, M = 60e3;
/** The record runs every five minutes: a last snapshot older than this means it has stopped. */
export const GROKPM_STALE_MINUTES = 15;
/** A reported figure further than this from the record's is flagged. */
export const GROKPM_MISMATCH_USD = 1;
/** The journal entries the page lists. */
export const GROKPM_JOURNAL_ROWS = 30;
/** A cycle is compared with the snapshot of its own slot or the one before, no further. */
export const GROKPM_CYCLE_MATCH_MS = 10 * M;

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const nz = (x: unknown) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (s: string) => String(s).slice(0, 10);

export type GrokPmConfigRow = {
  wallet: string | null; funded_usd: number | string; daily_loss_usd: number | string; total_stop_usd: number | string; started_at: string | null;
  /** The order path's lock (0125): armed while `dry_run` is false and `armed_at` set. Absent on a row read before 0125. */
  dry_run?: boolean | null; armed_at?: string | null;
};
export type GrokPmSnapshotRow = {
  slot: string; at: string; cash_usd: number | string; positions_value_usd: number | string; value_api_usd: number | string | null; equity_usd: number | string;
  positions: Array<Record<string, unknown>> | null;
};
export type GrokPmDayOpenRow = { day: string; slot: string; equity_usd: number | string };
export type GrokPmDecisionRow = {
  id: string; ts: string; action: string; market_id: string | null; token_id: string | null; outcome: string | null; side: string | null;
  price: number | string | null; size: number | string | null; p: number | string | null; m: number | string | null; category: string | null;
  sources: unknown; reason: string; invalidation: string | null;
};
export type GrokPmCycleRow = { id: string; ts: string; kind: string; cash_usd: number | string; positions_value_usd: number | string; pnl_usd: number | string; open_positions: number; actions: number };
export type GrokPmDailyRow = { id: string; received_at: string; day: string; pnl_day_usd: number | string; pnl_total_usd: number | string; trades: number; summary: string };
export type GrokPmEntryRow = { asset: string; cond: string; title: string | null; first_seen_at: string; first_fill_at: string | null; mid: number | string | null };
export type GrokPmResolutionRow = { cond: string; tokens: unknown; payouts: unknown };
export type GrokPmOpenRow = { id: string; ts: string; token_id: string | null; p: number | string | null; m: number | string | null; category: string | null };

export const GROKPM_CONFIG_COLUMNS = "wallet,funded_usd,daily_loss_usd,total_stop_usd,started_at,dry_run,armed_at";
export const GROKPM_SNAPSHOT_COLUMNS = "slot,at,cash_usd,positions_value_usd,value_api_usd,equity_usd,positions";
export const GROKPM_DECISION_COLUMNS = "id,ts,action,market_id,token_id,outcome,side,price,size,p,m,category,sources,reason,invalidation";
export const GROKPM_CYCLE_COLUMNS = "id,ts,kind,cash_usd,positions_value_usd,pnl_usd,open_positions,actions";
export const GROKPM_DAILY_COLUMNS = "id,received_at,day,pnl_day_usd,pnl_total_usd,trades,summary";
export const GROKPM_ENTRY_COLUMNS = "asset,cond,title,first_seen_at,first_fill_at,mid";
export const GROKPM_OPEN_COLUMNS = "id,ts,token_id,p,m,category";


/** Only an http(s) URL is a link; anything else the agent sent is dropped from the links (it stays in the record as sent). */
export function safeLinks(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is string => {
    if (typeof s !== "string") return false;
    try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
  }).slice(0, 10);
}

/**
 * The Brier comparison on every resolved entry (see the header): each entry once, the agent's p from its last `open` of
 * that token at or before its first fill (else its first `open` of it), the market's m the record's mid when first seen
 * (else the agent's m), y the token's payout. Entries without a p or a resolution are not scored.
 */
export function brierOf(entries: GrokPmEntryRow[], resolutions: GrokPmResolutionRow[], opens: GrokPmOpenRow[]) {
  const payout = new Map<string, number>();
  for (const r of resolutions) {
    const toks = Array.isArray(r.tokens) ? r.tokens.map(String) : [], pays = Array.isArray(r.payouts) ? r.payouts.map(Number) : [];
    toks.forEach((t, i) => { if (Number.isFinite(pays[i])) payout.set(t, pays[i]); });
  }
  const scored: Array<{ asset: string; p: number; m: number; y: number; category: string | null; mFrom: "record" | "agent" }> = [];
  let resolved = 0;
  for (const e of entries) {
    const y = payout.get(e.asset);
    if (y === undefined) continue;
    resolved++;
    const mine = opens.filter((o) => o.token_id === e.asset && nz(o.p) !== null).sort((a, b) => a.ts.localeCompare(b.ts));
    if (!mine.length) continue;
    const cut = e.first_fill_at ?? e.first_seen_at;
    const before = mine.filter((o) => o.ts <= cut);
    const o = before.length ? before[before.length - 1] : mine[0];
    const mRec = nz(e.mid), mAgent = nz(o.m);
    const m = mRec ?? mAgent;
    if (m === null) continue;
    scored.push({ asset: e.asset, p: num(o.p), m, y, category: o.category, mFrom: mRec !== null ? "record" : "agent" });
  }
  const mean = (f: (s: typeof scored[number]) => number) => (scored.length ? r6(scored.reduce((a, s) => a + f(s), 0) / scored.length) : null);
  return { n: scored.length, resolved, agent: mean((s) => (s.p - s.y) ** 2), market: mean((s) => (s.m - s.y) ** 2), scored };
}

/**
 * The dashboard's `grokPm`: null until the wallet is configured (the `grokpm` function writes it from the account's own settings); then the row's and the page's every figure (see the
 * header). `latest` is the newest snapshot, `opens` each UTC day's first (`grokpm_day_opens`), `cycleSnap` the snapshot of
 * the latest cycle's slot (or the one before).
 */
export function grokPmSummary(input: {
  config: GrokPmConfigRow | null; latest: GrokPmSnapshotRow | null; dayOpens: GrokPmDayOpenRow[]; decisions: GrokPmDecisionRow[]; cycle: GrokPmCycleRow | null;
  cycleSnap: GrokPmSnapshotRow | null; daily: GrokPmDailyRow[]; entries: GrokPmEntryRow[]; resolutions: GrokPmResolutionRow[]; opens: GrokPmOpenRow[];
  recState: { updated_at: string | null; last_error: string | null } | null; nowMs: number;
}) {
  const cfg = input.config;
  if (!cfg?.wallet) return null;
  const funded = num(cfg.funded_usd), dayLimit = num(cfg.daily_loss_usd), totalLimit = num(cfg.total_stop_usd);
  const started = !!cfg.started_at && !!input.latest;
  const today = iso(Math.floor(input.nowMs / DAY) * DAY).slice(0, 10);
  const startDay = cfg.started_at ? dayOf(cfg.started_at) : null;
  const equity = input.latest ? num(input.latest.equity_usd) : null;

  // Positions, from the latest snapshot as the record marked them.
  const titleOf = new Map<string, string>();
  for (const e of input.entries) if (e.title) titleOf.set(e.cond, e.title);
  const positions = (input.latest?.positions ?? []).map((x) => {
    const size = num(x.size), avg = num(x.avgPrice), mark = num(x.mark), redeemable = x.redeemable === true;
    if (typeof x.title === "string") titleOf.set(String(x.cond), x.title);
    return {
      asset: String(x.asset), cond: String(x.cond ?? ""), title: typeof x.title === "string" ? x.title : "", outcome: typeof x.outcome === "string" ? x.outcome : null,
      size: r6(size), avgPrice: r6(avg), mark: r6(mark), mid: nz(x.mid), costUsd: r6(size * avg), valueUsd: r6(size * mark),
      unrealisedUsd: redeemable ? 0 : r6(size * (mark - avg)), redeemable, endDate: typeof x.endDate === "string" ? x.endDate : null,
    };
  }).sort((a, b) => a.title.localeCompare(b.title) || String(a.outcome).localeCompare(String(b.outcome)));
  const cost = positions.reduce((s, p) => s + p.costUsd, 0);
  const unrealised = positions.reduce((s, p) => s + p.unrealisedUsd, 0);

  // The day's open and the days.
  const openOf = new Map(input.dayOpens.map((o) => [dayOf(o.day), num(o.equity_usd)]));
  const dayOpen = (d: string) => (d === startDay ? funded : openOf.get(d) ?? null);
  const total = started ? equity! - funded : 0;
  const todayOpen = started ? dayOpen(today) : null;
  const todayUsd = started && todayOpen !== null ? equity! - todayOpen : 0;
  const agentDay = new Map<string, GrokPmDailyRow>();
  for (const y of [...input.daily].sort((a, b) => a.received_at.localeCompare(b.received_at))) agentDay.set(dayOf(y.day), y);   // the newest summary of a day
  const days: Array<Record<string, unknown>> = [];
  if (started && startDay) {
    for (let t = Date.parse(`${startDay}T00:00:00Z`); t <= Date.parse(`${today}T00:00:00Z`); t += DAY) {
      const d = iso(t).slice(0, 10), next = iso(t + DAY).slice(0, 10);
      const open = dayOpen(d), close = d === today ? equity : openOf.get(next) ?? null;
      const record = open !== null && close !== null ? r6(close - open) : null;
      const a = agentDay.get(d);
      const agent = a ? r6(num(a.pnl_day_usd)) : null;
      days.push({
        day: d, today: d === today, recordUsd: record, agentUsd: agent, trades: a ? a.trades : null, summary: a ? a.summary : null,
        mismatch: record !== null && agent !== null && Math.abs(record - agent) > GROKPM_MISMATCH_USD,
      });
    }
    days.reverse();
  }

  // The latest cycle against the record at its time.
  let cycle: Record<string, unknown> | null = null;
  if (input.cycle) {
    const c = input.cycle, agentEquity = num(c.cash_usd) + num(c.positions_value_usd);
    const snap = input.cycleSnap && Math.abs(Date.parse(input.cycleSnap.slot) - Date.parse(c.ts)) <= GROKPM_CYCLE_MATCH_MS ? input.cycleSnap : null;
    const recEquity = snap ? num(snap.equity_usd) : null;
    const recTotal = recEquity === null ? null : recEquity - funded;
    cycle = {
      ts: c.ts, kind: c.kind, actions: c.actions, openPositions: c.open_positions, agentEquityUsd: r6(agentEquity), agentPnlUsd: r6(num(c.pnl_usd)),
      recordEquityUsd: recEquity === null ? null : r6(recEquity), recordPnlUsd: recTotal === null ? null : r6(recTotal),
      mismatch: recEquity !== null && (Math.abs(agentEquity - recEquity) > GROKPM_MISMATCH_USD || Math.abs(num(c.pnl_usd) - recTotal!) > GROKPM_MISMATCH_USD),
    };
  }

  const brier = brierOf(input.entries, input.resolutions, input.opens);
  const journal = input.decisions.slice(0, GROKPM_JOURNAL_ROWS).map((x) => ({
    id: x.id, ts: x.ts, action: x.action, category: x.category, title: (x.market_id && titleOf.get(x.market_id)) || null, marketId: x.market_id,
    outcome: x.outcome, side: x.side, price: nz(x.price), size: nz(x.size), p: nz(x.p), m: nz(x.m), reason: String(x.reason ?? ""),
    invalidation: x.invalidation ?? null, sources: safeLinks(x.sources),
  }));

  const lastAt = input.latest?.at ?? input.recState?.updated_at ?? null;
  const lagMinutes = lastAt ? Math.max(0, Math.round((input.nowMs - Date.parse(lastAt)) / M)) : null;
  const totalTripped = started && total <= -totalLimit;
  const dayTripped = started && todayUsd <= -dayLimit;
  return {
    // The account's address is never sent to the page (since D2 it is the project's own account): only whether the order
    // path is armed, and from when the agent's own book counts.
    mode: cfg.dry_run === false && cfg.armed_at ? "live" as const : "dry_run" as const, started, startedAt: cfg.started_at,
    fundedUsd: started ? funded : null, configuredFundedUsd: funded,
    equityUsd: equity === null ? null : r6(equity), cashUsd: input.latest ? r6(num(input.latest.cash_usd)) : null,
    positionsValueUsd: input.latest ? r6(num(input.latest.positions_value_usd)) : null, valueApiUsd: input.latest ? nz(input.latest.value_api_usd) : null,
    totalUsd: r6(total), todayUsd: r6(todayUsd), unrealisedUsd: r6(started ? unrealised : 0), realisedUsd: r6(started ? total - unrealised : 0), costUsd: r6(cost),
    stop: {
      dayLimitUsd: dayLimit, dayRoomUsd: started ? r6(dayLimit + todayUsd) : null, dayTripped,
      totalLimitUsd: totalLimit, totalRoomUsd: started ? r6(totalLimit + total) : null, totalTripped,
    },
    lastSnapshotAt: input.latest?.at ?? null, lagMinutes, running: lagMinutes !== null && lagMinutes <= GROKPM_STALE_MINUTES, lastError: input.recState?.last_error ?? null,
    status: { open: positions.filter((p) => !p.redeemable).length, brierAgent: brier.agent, brierMarket: brier.market, scored: brier.n, resolved: brier.resolved },
    positions, journal, days, cycle,
    mismatch: !!cycle?.mismatch || days.some((d) => d.mismatch),
  };
}
