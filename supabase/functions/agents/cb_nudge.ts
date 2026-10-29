// "Stablecoin quotes with Euros - 3" (migration 0168; Davies, 2026-10-29: "建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的
// USDC-GBP"): "with Euros - 2"'s rule exactly (cb_usdc.ts, its driver `runCbUsdcArm` called unchanged), on USDC-GBP alone, $50 a
// rung, six rungs, $300, with ONE change: the fair it quotes around is nudged by Revolut X's USDC-GBP book. Pre-registered in
// docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md, frozen at the commit that adds this file.
//
// THE NUDGE is the REVX-FAIR study's one lead (docs/agents/reviews/2026-10-29-revx-fair-price-study.md §5) mirrored onto Coinbase,
// as that study's §8 replayed it (docs/agents/backtests/fair_price/scripts/cb_mirror.ts, cb_mirror_prep.py), convention for
// convention:
//   * RX, Revolut X's USDC-GBP mid: the newest `agent_book_levels` snapshot stamped before the minute (`books.ts` writes one
//     when the book changes and extends its `seen_until` while it does not), its own best bid and best ask (LIVE's resting
//     orders included), a touch no wider than 1 %; none when the minute is more than 5 minutes past its `seen_until`;
//   * fair, the minute's own book fair (fairU ÷ X), in a minute the rule is lit (not dark, not in a release blackout);
//   * g = RX − fair, and its EMA with a 24-hour half-life, time-weighted (1 − 0.5^(minutes since its last update ÷ 1,440)),
//     updated with the minute's own g before it is used, only where both exist, kept in the state (`nudge`);
//   * d = g − EMA; the fair is fair + ½ × d where the row's scope holds and |d| < 50 bps of fair, else as it is.
// THE SCOPE is a rule of the row (`CB_NUDGE_SCOPE`), "closures": on only inside PR5-W's FX closures (`inQuoteClosure`), where the
// held GBP/USD freezes Coinbase's fair. Davies, 2026-10-29, choosing between every minute and the closures after the §8 replay:
// "-3 只在休市时用". ("all" stays in `nudgeStep` for the replay's other setting.) The EMA moves in every lit minute either way.
// With no RX the minute's fair is the un-nudged one. Every quote, exit and stop the rule makes is priced off that fair, as "- 2"
// prices off its own. The minute record keeps both fairs, RX and its snapshot's stamp, d, the EMA and whether d was applied.

import type { Db } from "./db.ts";
import { CB_RUNG_USD } from "./cb_quotes.ts";
import type { CbProduct } from "./cb_rec.ts";
import { CB_USDC_FACTOR_50, runCbUsdcArm, type CbUsdcArm, type CbUsdcFair, type CbUsdcState } from "./cb_usdc.ts";
import type { CbQuoteReport } from "./cb_quotes.ts";
import type { CbRecState } from "./cb_rec.ts";
import { cbInBlackout } from "./cb_releases.ts";
import { inQuoteClosure } from "./quotes_weekend.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));

/** The page's name for it, right after "Stablecoin quotes with Euros - 2". */
export const CB_NUDGE_ROW_NAME = "Stablecoin quotes with Euros - 3";
/** The twin id its page payload carries. */
export const CB_NUDGE_ID = "coinbasenudge";
/** Its one book. */
export const CB_NUDGE_PRODUCTS = ["USDC-GBP"] as const satisfies readonly CbProduct[];
/** $50 a rung: the engine's $100 ÷ 2, as "- 2" from its Deviation 2; six rungs, $300. */
export const CB_NUDGE_RUNG_USD = CB_RUNG_USD / CB_USDC_FACTOR_50;
export const CB_NUDGE_LEASE = "cb-nudge";
export const CB_NUDGE_TABLES = { state: "cb_nudge_state", events: "cb_nudge_events", trips: "cb_nudge_trips", minutes: "cb_nudge_minutes", days: "cb_nudge_days" } as const;
/** Where the nudge applies: inside PR5-W's FX closures alone ("closures"), or in every minute ("all"). The row's rule is "closures" (Davies: "-3 只在休市时用"). */
export type CbNudgeScope = "all" | "closures";
export const CB_NUDGE_SCOPE: CbNudgeScope = "closures";
/** The nudge's settings, the study's chosen ones: weight ½, a 24-hour half-life, skipped at 50 bps of fair or more. */
export const CB_NUDGE_W = 0.5;
export const CB_NUDGE_HL_MIN = 1440;
export const CB_NUDGE_MAX_DEV = 0.005;
/** A snapshot stands until its `seen_until` and this much after it (cb_mirror_prep.py). */
export const CB_NUDGE_FRESH_MS = 5 * M;
/** The Revolut X book read. */
export const CB_NUDGE_RX_BOOK = "USDC-GBP";

/** A stored Revolut X snapshot: levels [price, quantity, orders], best first. */
export type RxSnapshot = { ts: string; seen_until: string | null; bids: unknown; asks: unknown };

/** A snapshot's raw mid: its own best bid and best ask (whatever their size), a touch no wider than 1 %; else null. */
export function rxMid(s: RxSnapshot): number | null {
  const top = (x: unknown) => (Array.isArray(x) && Array.isArray(x[0]) ? Number(x[0][0]) : NaN);
  const bb = top(s.bids), ba = top(s.asks);
  if (!(bb > 0) || !(ba > bb && ba <= bb * 1.01)) return null;
  return (bb + ba) / 2;
}

/** The mid known at minute `t`: the newest snapshot stamped before `t` (at or before t − 1 ms), unless `t` is more than 5 minutes past its `seen_until`. */
export function rxMidAt(snaps: RxSnapshot[], t: number): { mid: number; at: number } | null {
  let s: RxSnapshot | null = null;
  for (const x of snaps) { if (msOf(x.ts) <= t - 1) s = x; else break; }
  if (!s) return null;
  const at = msOf(s.ts), until = Math.max(at, s.seen_until ? msOf(s.seen_until) : at);
  if (t - until > CB_NUDGE_FRESH_MS) return null;
  const mid = rxMid(s);
  return mid == null ? null : { mid, at };
}

/**
 * One minute of the nudge, updating `n` (the EMA and its last minute): the lit fair `f` and RX at `t` give g = RX − f, its EMA
 * and d = g − EMA; the fair is f + `CB_NUDGE_W` × d when `scope` holds at `t` and |d| < `CB_NUDGE_MAX_DEV` of f. Without both,
 * nothing moves and the EMA is kept.
 */
export function nudgeStep(n: { ema: number | null; last: number | null }, t: number, f: number | null, mid: number | null, scope: CbNudgeScope = CB_NUDGE_SCOPE): { fair: number | null; dev: number | null; nudged: boolean } {
  if (!f || !mid) return { fair: f, dev: null, nudged: false };
  const g = mid - f;
  n.ema = n.ema == null || n.last == null ? g : n.ema + (1 - 0.5 ** ((t - n.last) / M / CB_NUDGE_HL_MIN)) * (g - n.ema);
  n.last = t;
  const dev = g - n.ema, on = scope === "all" || inQuoteClosure(t);
  return on && Math.abs(dev / f) < CB_NUDGE_MAX_DEV ? { fair: f + CB_NUDGE_W * dev, dev, nudged: true } : { fair: f, dev, nudged: false };
}

/** The Revolut X snapshots a run from `first` to `horizon` can read: every one stamped before its last minute and fresh at its first. */
export async function readRxSnapshots(db: Db, first: number, horizon: number): Promise<RxSnapshot[]> {
  return await db.select<RxSnapshot>("agent_book_levels",
    `book=eq.${CB_NUDGE_RX_BOOK}&ts=lt.${enc(horizon)}&seen_until=gte.${enc(first - CB_NUDGE_FRESH_MS - M)}&select=ts,seen_until,bids,asks&order=ts.asc&limit=1000`);
}

/**
 * The arm's fair for a run under `scope`: the snapshots read once, then each minute's nudge on the engine's own fairU (fairU ÷ X
 * is the fair). A minute in a release blackout is dark (its fairU withheld by the driver after this), so it neither moves the
 * EMA nor is nudged, as in the §8 replay.
 */
export function cbNudgeFairWith(scope: CbNudgeScope) {
  return async (db: Db, first: number, horizon: number): Promise<CbUsdcFair> => {
    const snaps = await readRxSnapshots(db, first, horizon);
    return (st: CbUsdcState, t: number, _b: CbProduct, io: { x: number | null; fairU: number | null }) => {
      const n = (st.nudge ??= { ema: null, last: null });
      const f = io.x && io.fairU && !cbInBlackout(t) ? io.fairU / io.x : null;
      const rx = rxMidAt(snaps, t);
      const r = nudgeStep(n, t, f, rx?.mid ?? null, scope);
      return {
        fairU: r.nudged && io.x ? r.fair! * io.x : io.fairU,
        extra: { fair_raw: io.x && io.fairU ? io.fairU / io.x : null, rx_mid: rx?.mid ?? null, rx_t: rx ? iso(rx.at) : null, dev: r.dev, ema: rx && f ? n.ema : null, nudged: r.nudged },
      };
    };
  };
}
export const cbNudgeFair = cbNudgeFairWith(CB_NUDGE_SCOPE);

/** "with Euros - 3": USDC-GBP alone, $50 a rung from its first minute, its own tables and lease, and the nudged fair (`CB_NUDGE_SCOPE`). */
export const CB_NUDGE_ARM: CbUsdcArm = {
  tables: CB_NUDGE_TABLES, lease: CB_NUDGE_LEASE, products: CB_NUDGE_PRODUCTS, factorAt: () => CB_USDC_FACTOR_50, fairOf: cbNudgeFair,
};

/** Decide what the recorder has covered on USDC-GBP, as "- 2" does, with the nudge. */
export function runCbNudge(d: { db: Db; now: number; holder: string; rec: CbRecState | null }): Promise<CbQuoteReport> {
  return runCbUsdcArm(d, CB_NUDGE_ARM);
}
