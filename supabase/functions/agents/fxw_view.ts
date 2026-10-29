// "AUD weekend (FXW-AUD)" for the Agents page: the dashboard's `fxwAud`, made from what `ig?action=fxw` wrote
// (`ig_fxw_weekends`, `ig_fxw_state`; migration 0162; the rule and its fills in `supabase/functions/ig/fxw.ts`). Paper: a
// row of TESTING, in pounds (the spread-bet account's own), with dollars at the books' last GBP/USD for the scoreboard.
// Davies, 2026-10-29: "在testing列表中把IG Trader和澳元策略都上线，funded金额按照你推荐的来定，确保模拟一切真实".
//
// The figures. Funded is the account the run holds (GBP 1,000). Realised is the closed trades' net (price P&L less
// funding); unrealised the open position's at its last recorded exit-side quote, less funding so far; equity is funded
// plus both. Deployed is what the open position ties up in margin, and unrealised's percent is on it. Today is what the
// trades closed today made plus the open position's move today, each since its mark at the last UTC midnight when it was
// opened before it (the run records that mark). Nothing here reads a quote: every figure is the run's.

import type { Db } from "./db.ts";

export type FxwRow = {
  friday: string; status: string; reason: string | null; epic: string | null;
  fri_ts: string | null; fri_bid: number | null; fri_offer: number | null; fri_mid: number | null;
  dec_ts: string | null; dec_bid: number | null; dec_offer: number | null; gap_bps: number | null;
  side: string | null; stake_gbp: number | null; entry_ts: string | null; entry_price: number | null; margin_gbp: number | null;
  exit_ts: string | null; exit_bid: number | null; exit_offer: number | null; exit_price: number | null; exit_reason: string | null;
  mark_ts: string | null; mark_price: number | null; midnight_ts: string | null; midnight_price: number | null;
  pnl_gbp: number | null; funding_gbp: number | null; net_gbp: number | null; equity_before: number | null; updated_at: string | null;
};
export type FxwState = { last_run: string | null; last_error: string | null; name: string | null; funded_gbp: number | null; stake_gbp: number | null; start_at: string | null };

/** The run is every five minutes: a last run older than this is a stopped run. */
export const FXW_STALE_MS = 15 * 60_000;
const PIP = 0.0001;
const n = (x: unknown) => (x === null || x === undefined ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Price P&L in GBP of a weekend's position at a price. */
function pnlAt(w: FxwRow, price: number): number {
  const dir = w.side === "long" ? 1 : -1;
  return dir * ((price - Number(w.entry_price)) / PIP) * Number(w.stake_gbp);
}

/** The next thing the book does, in UK words. */
function nextText(open: FxwRow | null, last: FxwRow | null): string {
  if (open) return "exit at Friday's mid, or +24 h";
  if (last && (last.status === "pending" || last.status === "waiting")) return last.status === "pending" ? "Friday's mid, 22:00 UK" : "Sunday's open, 21:00 UK";
  return "Friday 21:35 UK";
}

export function fxwView(o: { state: FxwState | null; rows: readonly FxwRow[]; gbpusd: number | null; nowMs: number; dayStartMs: number }) {
  const st = o.state;
  if (!st || n(st.funded_gbp) === null) return null;
  const funded = Number(st.funded_gbp);
  const rows = [...o.rows].sort((a, b) => a.friday.localeCompare(b.friday));
  const closed = rows.filter((w) => w.status === "closed");
  const open = rows.find((w) => w.status === "open") ?? null;
  const realised = closed.reduce((a, w) => a + (n(w.net_gbp) ?? 0), 0);
  const funding = rows.reduce((a, w) => a + (w.status === "closed" ? n(w.funding_gbp) ?? 0 : 0), 0);
  const unrealised = open ? n(open.net_gbp) ?? 0 : 0;
  const margin = open ? n(open.margin_gbp) ?? 0 : 0;
  // Today: each position's move since the last UTC midnight (or since its entry, when it opened after it).
  let today = 0;
  for (const w of rows) {
    const inToday = w.status === "closed" ? Date.parse(String(w.exit_ts)) >= o.dayStartMs : w.status === "open";
    if (!inToday) continue;
    const before = Date.parse(String(w.entry_ts)) < o.dayStartMs;
    const base = before && n(w.midnight_price) !== null ? pnlAt(w, Number(w.midnight_price)) : 0;
    today += (n(w.net_gbp) ?? 0) - base;
  }
  const startMs = st.start_at ? Date.parse(st.start_at) : NaN;
  const lastRun = st.last_run ? Date.parse(st.last_run) : NaN;
  const started = Number.isFinite(startMs) && o.nowMs >= startMs;
  const running = Number.isFinite(lastRun) && o.nowMs - lastRun <= FXW_STALE_MS;
  const last = [...rows].reverse()[0] ?? null;
  const usd = (gbp: number) => (o.gbpusd ? r2(gbp * o.gbpusd) : 0);
  return {
    name: String(st.name ?? "AUD weekend (FXW-AUD)"),
    started, running, lagMinutes: Number.isFinite(lastRun) ? Math.max(0, Math.round((o.nowMs - lastRun) / 60_000)) : null,
    lastError: st.last_error ?? null, startAt: st.start_at, stakeGbp: n(st.stake_gbp),
    daysRun: started ? Math.floor((o.nowMs - startMs) / 86_400_000) : 0,
    trades: closed.length, weekends: rows.length,
    equityGbp: r2(funded + realised + unrealised),
    capitalGbp: funded, valueGbp: r2(margin), costGbp: r2(margin),
    realisedGbp: r2(realised), unrealisedGbp: r2(unrealised), todayGbp: r2(today), feesGbp: r2(funding),
    capitalUsd: usd(funded), valueUsd: usd(margin), costUsd: usd(margin),
    realisedUsd: usd(realised), unrealisedUsd: usd(unrealised), todayUsd: usd(today), feesUsd: usd(funding),
    gbpusd: o.gbpusd,
    open: open ? { friday: open.friday, side: open.side, entryTs: open.entry_ts, entryPrice: n(open.entry_price), markTs: open.mark_ts, markPrice: n(open.mark_price), marginGbp: n(open.margin_gbp), netGbp: n(open.net_gbp) } : null,
    nextText: nextText(open, last),
    // Newest first, for the page's table; the last weekend is the first of them.
    rows: [...rows].reverse().map((w) => ({
      friday: w.friday, status: w.status, reason: w.reason,
      friTs: w.fri_ts, friBid: n(w.fri_bid), friOffer: n(w.fri_offer), friMid: n(w.fri_mid),
      decTs: w.dec_ts, decBid: n(w.dec_bid), decOffer: n(w.dec_offer), gapBps: n(w.gap_bps),
      side: w.side, stakeGbp: n(w.stake_gbp), entryTs: w.entry_ts, entryPrice: n(w.entry_price), marginGbp: n(w.margin_gbp),
      exitTs: w.exit_ts, exitBid: n(w.exit_bid), exitOffer: n(w.exit_offer), exitPrice: n(w.exit_price), exitReason: w.exit_reason,
      markTs: w.mark_ts, markPrice: n(w.mark_price), pnlGbp: n(w.pnl_gbp), fundingGbp: n(w.funding_gbp), netGbp: n(w.net_gbp),
      equityBefore: n(w.equity_before),
    })),
  };
}

export async function readFxw(d: Db, now: number, dayStartMs: number) {
  try {
    const [st, rows, fx] = await Promise.all([
      d.select<FxwState>("ig_fxw_state", "id=eq.1&select=last_run,last_error,name,funded_gbp,stake_gbp,start_at"),
      d.select<FxwRow>("ig_fxw_weekends", "select=*&order=friday.desc&limit=200"),
      d.select<{ value: number }>("agent_quote_inputs", "kind=eq.fx&select=value&order=t.desc&limit=1"),
    ]);
    return fxwView({ state: st[0] ?? null, rows, gbpusd: fx[0] ? Number(fx[0].value) : null, nowMs: now, dayStartMs });
  } catch {
    return null;
  }
}
