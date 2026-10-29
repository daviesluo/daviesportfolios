// FXW-AUD on paper: "FXW-AUD weekend" on the Agents page's TESTING list, computed from the live recorder's own IG
// quotes. It never calls IG: it reads `ig_quotes` (environment 'live', the spread-bet account's AUD/USD epic) and writes
// one row a weekend to `ig_fxw_weekends` (migration 0162).
//
// On whose word. Davies, 2026-10-29: "在testing列表中把IG Trader和澳元策略都上线，funded金额按照你推荐的来定，确保模拟一切真实".
// The size is the recommendation of `docs/agents/reviews/2026-10-18-ig-strategy-search-3.md` §5: a GBP 1,000 spread-bet
// account, GBP 1.50 a pip, no stop (about 10x, margin about GBP 500).
//
// The rule is the frozen one, nothing added (`docs/agents/backtests/ig_deepdive/params/g2_s1a_frozen.json`, `s1a` and
// `g3.fxw_rule`; the spec's S1b on recorded quotes, `SPEC-for-verification.md`; Deviation 1's coverage rule):
//   * Friday's mid: the last TRADEABLE quote recorded before Friday's close (22:00 UK; IG's FX hours end 21:59), from the
//     recorder's Friday window (on from 21:35 UK).
//   * The decision quote: the first TRADEABLE quote (bid below offer) at or after Sunday's documented open, 21:00 UK.
//   * The gap: ln(decision mid / Friday mid). Under 20 bps either way, no trade.
//   * Against the gap at the decision quote's executable side: a fall buys at the offer, a rise sells at the bid.
//   * The exit: the first TRADEABLE quote whose exit side (bid for a long, offer for a short) reaches Friday's mid, at that
//     side; otherwise the first TRADEABLE quote at or after +24 h, at its exit side. No stop.
// Realism (the same message: "确保模拟一切真实"):
//   * Fills are recorded quotes only, at the executable side, never a mid. Every minute from the open to the decision
//     quote must be covered by a recorded quote (Deviation 1: a quote no older than 2 minutes at the minute's end), or the
//     entry is MISSED, not filled late: the first tradable quote is then not known.
//   * The stake is GBP 1.50 a pip, never under IG's minimum of GBP 0.50 (G1/F10). P&L in GBP is the pip move times it.
//   * Margin 5 % of the position's value (stake x price / pip; F10, G1's first bands). No entry unless the equity covers
//     it; IG closes the position when equity falls under half the margin (F28-F30; §5 models the same), at that quote.
//   * Funding as the research charged it (`ig_search3/scripts/search.py`, `fxw`): 0.22 bps of the position's value a
//     night (IG's admin fee of about 0.8 % a year, F12), at each weekday 22:00 UK the position is held through, Friday's
//     counting three nights; Sunday 22:00 is not a funding time (F16). Within its 24 h a trade entered at Sunday's open
//     crosses none, as in the research.
// The equity starts at GBP 1,000 at Friday 2026-10-30 21:35 UK, the first weekend the recorder reads on the live login.

import { latestFacts, type Rest } from "./actions.ts";
import { ukClock, ukToUtcMs } from "./windows.ts";

export const FXW = {
  name: "FXW-AUD weekend",
  fundedGbp: 1000,
  stakeGbp: 1.5,
  minStakeGbp: 0.5,
  pip: 0.0001,
  marginRate: 0.05,
  closeOutShare: 0.5,
  signalBps: 20,
  horizonMs: 24 * 3_600_000,
  fundingBpsNight: 0.22,
  /** The first Friday it trades, UK date, and its start instant: the recorder's Friday window opens at 21:35 UK. */
  startFriday: "2026-10-30",
  startUk: { hh: 21, mm: 35 },
  /** Friday's mid is read from quotes received from this UK time on, before the close. */
  fridayClose: { hh: 22, mm: 0 },
  sundayOpen: { hh: 21, mm: 0 },
  /** The recorder's SUN window ends Monday 22:05 UK (`windows.ts`): no quote is recorded after it. */
  recorderEnd: { hh: 22, mm: 5 },
  /** Deviation 1: a minute is covered by a quote no older than this at its end. */
  coverMs: 2 * 60_000,
} as const;

export type QuoteRow = { ts: string; seen_until: string; bid: number | string | null; offer: number | string | null; market_status: string };
type Q = { t: number; until: number; bid: number | null; offer: number | null; status: string };

export type FxwStatus = "pending" | "waiting" | "no_trade" | "missed" | "open" | "closed";
export type FxwWeekend = {
  friday: string; status: FxwStatus; reason: string | null;
  fri_ts: string | null; fri_bid: number | null; fri_offer: number | null; fri_mid: number | null;
  dec_ts: string | null; dec_bid: number | null; dec_offer: number | null; gap_bps: number | null;
  side: "long" | "short" | null; stake_gbp: number | null; entry_ts: string | null; entry_price: number | null; margin_gbp: number | null;
  exit_ts: string | null; exit_bid: number | null; exit_offer: number | null; exit_price: number | null; exit_reason: string | null;
  mark_ts: string | null; mark_price: number | null; midnight_ts: string | null; midnight_price: number | null;
  pnl_gbp: number | null; funding_gbp: number | null; net_gbp: number | null; equity_before: number;
};

const iso = (ms: number) => new Date(ms).toISOString();
const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const r2 = (x: number) => Math.round(x * 100) / 100;
const hhmm = (ms: number) => {
  const c = ukClock(ms);
  return `${String(Math.floor(c.minutes / 60)).padStart(2, "0")}:${String(c.minutes % 60).padStart(2, "0")}`;
};

/** The UK instants of a weekend, from its Friday's UK date. */
export function weekendTimes(friday: string) {
  const [y, m, d] = friday.split("-").map(Number);
  const at = (days: number, t: { hh: number; mm: number }) => {
    const day = new Date(Date.UTC(y, m - 1, d + days));
    return ukToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t.hh, t.mm);
  };
  return {
    start: at(0, FXW.startUk), friClose: at(0, FXW.fridayClose), open: at(2, FXW.sundayOpen), recEnd: at(3, FXW.recorderEnd),
  };
}

/** The Fridays (UK dates) it trades, from its first to the last whose 21:35 UK has come. */
export function fxwFridays(nowMs: number): string[] {
  const out: string[] = [];
  const [y, m, d] = FXW.startFriday.split("-").map(Number);
  for (let k = 0; k < 520; k++) {
    const day = new Date(Date.UTC(y, m - 1, d + 7 * k));
    const f = day.toISOString().slice(0, 10);
    if (weekendTimes(f).start > nowMs) break;
    out.push(f);
  }
  return out;
}

/** The position's value in GBP: the stake a pip times the price in pips (IG's margin and funding base). */
export const positionValueGbp = (stake: number, price: number) => stake * (price / FXW.pip);
/** IG's margin on it, 5 %. */
export const marginGbp = (stake: number, price: number) => FXW.marginRate * positionValueGbp(stake, price);
/** Price P&L in GBP: the move in pips times the stake, long +1, short -1. */
export const pnlGbp = (dir: 1 | -1, entry: number, exit: number, stake: number) => dir * ((exit - entry) / FXW.pip) * stake;

/** The funding nights a position held from `fromMs` to `toMs` pays: each weekday 22:00 UK inside (from, to], Friday's three. */
export function fundingNights(fromMs: number, toMs: number): number {
  let nights = 0;
  const first = ukClock(fromMs);
  for (let k = 0; k < 400; k++) {
    const day = new Date(Date.UTC(first.y, first.m - 1, first.d + k));
    const t = ukToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 22, 0);
    if (t > toMs) break;
    if (t <= fromMs) continue;
    const dow = day.getUTCDay();
    if (dow >= 1 && dow <= 4) nights += 1;
    else if (dow === 5) nights += 3;
  }
  return nights;
}
/** Funding in GBP: 0.22 bps of the position's value a night. */
export const fundingGbp = (nights: number, stake: number, price: number) => nights * (FXW.fundingBpsNight / 1e4) * positionValueGbp(stake, price);

const tradable = (q: Q) => q.status === "TRADEABLE" && q.bid !== null && q.offer !== null && q.bid < q.offer;

/** Whether the recorder held a quote no older than two minutes at instant t (Deviation 1). */
function covered(qs: readonly Q[], t: number): boolean {
  return qs.some((q) => q.t <= t && q.until >= t - FXW.coverMs);
}

/**
 * One weekend, from its recorded quotes (any order; the rows of `ig_quotes` for the epic, `seen_until` at or after the
 * Friday start, `ts` before the recorder's end), the equity it starts with, and the clock. Pure: the same quotes give the
 * same row.
 */
export function fxwWeekend(o: { friday: string; quotes: readonly QuoteRow[]; equityBefore: number; nowMs: number; stake?: number }): FxwWeekend {
  const stake = o.stake ?? FXW.stakeGbp;
  if (!(stake >= FXW.minStakeGbp)) throw new Error(`a stake of ${stake} a pip is under IG's minimum of ${FXW.minStakeGbp}`);
  const w = weekendTimes(o.friday);
  const qs: Q[] = o.quotes.map((r) => ({ t: Date.parse(r.ts), until: Date.parse(r.seen_until ?? r.ts), bid: num(r.bid), offer: num(r.offer), status: String(r.market_status) }))
    .filter((q) => Number.isFinite(q.t)).sort((a, b) => a.t - b.t);
  const row: FxwWeekend = {
    friday: o.friday, status: "pending", reason: null, fri_ts: null, fri_bid: null, fri_offer: null, fri_mid: null,
    dec_ts: null, dec_bid: null, dec_offer: null, gap_bps: null, side: null, stake_gbp: null, entry_ts: null, entry_price: null, margin_gbp: null,
    exit_ts: null, exit_bid: null, exit_offer: null, exit_price: null, exit_reason: null, mark_ts: null, mark_price: null,
    midnight_ts: null, midnight_price: null, pnl_gbp: null, funding_gbp: null, net_gbp: null, equity_before: r2(o.equityBefore),
  };
  const now = o.nowMs;
  if (now < w.friClose) return { ...row, reason: "Friday's quotes are being recorded" };
  // Friday's mid: the last tradable quote received from the Friday window's start, before the close.
  const fri = [...qs].reverse().find((q) => q.t >= w.start && q.t < w.friClose && tradable(q));
  if (!fri) return { ...row, status: "no_trade", reason: "no tradable quote was recorded on Friday before 22:00 UK" };
  const fmid = (fri.bid! + fri.offer!) / 2;
  Object.assign(row, { fri_ts: iso(fri.t), fri_bid: fri.bid, fri_offer: fri.offer, fri_mid: fmid });
  if (now < w.open) return { ...row, status: "waiting", reason: "Friday's mid is frozen; waiting for Sunday's open, 21:00 UK" };
  // The decision quote, and every minute from the open to it covered by a recorded quote.
  const dec = qs.find((q) => q.t >= w.open && q.t < w.recEnd && tradable(q));
  const until = dec ? dec.t : Math.min(now, w.recEnd);
  for (let t = w.open; t <= until; t += 60_000) {
    if (t > now) break;
    if (!covered(qs, t)) {
      return { ...row, status: "missed", reason: `missed: no quote was recorded at ${hhmm(t)} UK, so the first tradable quote after the open is not known` };
    }
  }
  if (!dec) {
    if (now < w.recEnd) return { ...row, status: "waiting", reason: "waiting for the first tradable quote after Sunday's open" };
    return { ...row, status: "no_trade", reason: "no tradable quote was recorded between Sunday's open and Monday 22:05 UK" };
  }
  const dmid = (dec.bid! + dec.offer!) / 2;
  const gap = 1e4 * Math.log(dmid / fmid);
  Object.assign(row, { dec_ts: iso(dec.t), dec_bid: dec.bid, dec_offer: dec.offer, gap_bps: Math.round(gap * 100) / 100 });
  if (Math.abs(gap) < FXW.signalBps) return { ...row, status: "no_trade", reason: `the gap was ${gap.toFixed(1)} bps, under ${FXW.signalBps}` };
  const dir: 1 | -1 = gap < 0 ? 1 : -1;
  const entry = dir === 1 ? dec.offer! : dec.bid!;
  const margin = marginGbp(stake, entry);
  if (o.equityBefore < margin) {
    return { ...row, status: "no_trade", reason: `the equity, £${o.equityBefore.toFixed(2)}, cannot margin £${margin.toFixed(2)}` };
  }
  Object.assign(row, { side: dir === 1 ? "long" : "short", stake_gbp: stake, entry_ts: iso(dec.t), entry_price: entry, margin_gbp: r2(margin) });
  const exitSide = (q: Q) => (dir === 1 ? q.bid! : q.offer!);
  const close = (q: Q, why: string) => {
    const px = exitSide(q);
    const pnl = pnlGbp(dir, entry, px, stake);
    const fund = fundingGbp(fundingNights(dec.t, q.t), stake, entry);
    return {
      ...row, status: "closed" as const, reason: null, exit_ts: iso(q.t), exit_bid: q.bid, exit_offer: q.offer, exit_price: px, exit_reason: why,
      mark_ts: iso(q.t), mark_price: px, pnl_gbp: r2(pnl), funding_gbp: r2(fund), net_gbp: r2(pnl - fund),
    };
  };
  // The mark at the last UTC midnight while the position was open (TODAY on the page reads the move since it): the last
  // tradable quote at or before it, the decision quote itself when none came between.
  const midnight = Math.floor(now / 86_400_000) * 86_400_000;
  let mid: Q | null = dec.t <= midnight ? dec : null;
  let last: Q | null = null;
  for (const q of qs) {
    if (q.t <= dec.t || !tradable(q)) continue;
    if (q.t > now) break;
    let out: FxwWeekend | null = null;
    if (q.t >= dec.t + FXW.horizonMs) {
      const late = Math.round((q.t - dec.t - FXW.horizonMs) / 60_000);
      out = close(q, late > 2 ? `24 h (no quote recorded for ${late} min after it)` : "24 h");
    } else {
      const fund = fundingGbp(fundingNights(dec.t, q.t), stake, entry);
      const equity = o.equityBefore + pnlGbp(dir, entry, exitSide(q), stake) - fund;
      if (equity < FXW.closeOutShare * margin) out = close(q, "margin close-out");
      else if (dir === 1 ? q.bid! >= fmid : q.offer! <= fmid) out = close(q, "target: Friday's mid");
    }
    if (out) {
      if (q.t > midnight && mid) Object.assign(out, { midnight_ts: iso(mid.t), midnight_price: exitSide(mid) });
      return out;
    }
    if (q.t <= midnight) mid = q;
    last = q;
  }
  if (now >= w.recEnd && last) {
    // The recorder stops at Monday 22:05 UK: a position it never saw reach either exit closes at its last recorded quote.
    return close(last, "the recorder's window ended: its last recorded quote");
  }
  const mark = last ?? dec;
  const pnl = pnlGbp(dir, entry, exitSide(mark), stake);
  const fund = fundingGbp(fundingNights(dec.t, now), stake, entry);
  return {
    ...row, status: "open", reason: null, mark_ts: iso(mark.t), mark_price: exitSide(mark),
    ...(mid ? { midnight_ts: iso(mid.t), midnight_price: exitSide(mid) } : {}),
    pnl_gbp: r2(pnl), funding_gbp: r2(fund), net_gbp: r2(pnl - fund),
  };
}

/** A status that never changes once written. */
export const FINAL: ReadonlySet<FxwStatus> = new Set(["no_trade", "missed", "closed"]);

// ---------------------------------------------------------------------------------------------------------------------
// The run: `ig?action=fxw`, every five minutes (0162). It reads the database only and upserts each weekend not yet final.


export const FXW_TABLE = "ig_fxw_weekends";
export const FXW_STATE = "ig_fxw_state";

export type StoredWeekend = FxwWeekend & { epic: string | null; account_id: string | null };

export async function runFxw(o: { rest: Rest; now: () => number }): Promise<Record<string, unknown>> {
  const now = o.now();
  let error: string | null = null;
  const done: Record<string, string> = {};
  try {
    const fridays = fxwFridays(now);
    if (fridays.length) {
      const stored = await o.rest.select<StoredWeekend>(FXW_TABLE, "select=*&order=friday.asc");
      const byFriday = new Map(stored.map((r) => [r.friday, r]));
      let equity: number = FXW.fundedGbp;
      let facts: Awaited<ReturnType<typeof latestFacts>>["sb"] | null | undefined;
      for (const friday of fridays) {
        const was = byFriday.get(friday);
        if (was && FINAL.has(was.status)) {
          equity += Number(was.net_gbp) || 0;
          done[friday] = was.status;
          continue;
        }
        facts ??= (await latestFacts(o.rest)).sb ?? null;
        const epic = was?.epic ?? facts?.selected?.fx_audusd ?? null;
        const accountId = was?.account_id ?? facts?.account_id ?? null;
        if (!epic) throw new Error("no live facts row names the spread-bet account's AUD/USD epic: run ?action=facts&account=sb");
        const w = weekendTimes(friday);
        const quotes = await o.rest.select<QuoteRow>(
          "ig_quotes",
          `select=ts,seen_until,bid,offer,market_status&environment=eq.live&account_kind=eq.sb&epic=eq.${encodeURIComponent(epic)}` +
            `&seen_until=gte.${encodeURIComponent(iso(w.start))}&ts=lt.${encodeURIComponent(iso(w.recEnd))}&order=ts.asc`,
        );
        const row = fxwWeekend({ friday, quotes, equityBefore: equity, nowMs: now });
        await o.rest.upsert(FXW_TABLE, { ...row, epic, account_id: accountId, updated_at: iso(now) }, "friday");
        done[friday] = row.status;
        if (row.status === "closed") equity += Number(row.net_gbp) || 0;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const f = weekendTimes(FXW.startFriday);
  await o.rest.upsert(FXW_STATE, {
    id: 1, last_run: iso(now), last_error: error ? error.slice(0, 300) : null,
    name: FXW.name, funded_gbp: FXW.fundedGbp, stake_gbp: FXW.stakeGbp, start_at: iso(f.start),
  }, "id").catch(() => {});
  return { action: "fxw", weekends: done, error };
}
