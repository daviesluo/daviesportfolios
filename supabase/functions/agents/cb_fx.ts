// The Coinbase arms' FX rate at second resolution (Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，如果还是正向
// 优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks"). The long backtest passed on every arm
// (docs/agents/reviews/2026-10-29-fx-second-sources.md §8, FX-SPEED-LONG: out of sample 2025-11-21 → 2026-10-08, base +£25.5 a year,
// the weekend arm +£31.3, the USDC arm +£5.9, the nudge arm +£3.2), so every Coinbase arm switches to the rule §8 modelled
// (`docs/agents/backtests/fx_speed/scripts/cb_long.py`, its (b), L3 at TrueFX's own level):
//
//   * THE CAP. Minute t is decided at about t + 120 s, after minute t + 1's prints are in, so `fx_ticks` then already holds
//     quotes from after the orders went live (t + 60 s). The rule reads only what had ARRIVED by t + 58 s (`CB_FX_CUTOFF_MS`),
//     two seconds before go-live: a read received at t + 59 s is not used.
//   * THE SOURCE. The recorder (`fx_rec.ts`, 0172) reads TrueFX every second and keeps a read when it brings something new;
//     while TrueFX is unhealthy it reads Kraken every 2 s and MARKS those reads `fallback`. The rate is the newest TrueFX read,
//     or the newest marked Kraken read when that is newer (TrueFX has failed or frozen since); Kraken's routine, unmarked reads
//     are never used. Its level is the source's own mid ((bid + ask) / 2, `mid` in millionths): no Yahoo level carried over
//     (§8.1: raw against Yahoo-aligned is a tie, £0.2–3.5 a year either way, and raw drops Yahoo's +2.82 bps on EUR/USD).
//   * FRESH. That read counts while it arrived no more than `CB_FX_FRESH_MS` (120 s, the recorder's own `FX_STALE_MS`) before
//     t + 58 s. Otherwise the minute falls back to the arm's Yahoo bar as before: `fxBarAt`, the newest bar started in
//     [t − 10 min, t − 1 min].
//   * CLOSURES, unchanged. Which minutes are lit outside a fresh read is today's rule, exactly: the base test goes dark when
//     Yahoo's bar is missing too, as it did; a held arm (the weekend rule: "with Euros", "- 1", "- 2") is lit wherever its held
//     bar (`cbHoldBarAt`, 60 hours) is, and holds the newest fast read if it arrived no earlier than that bar started (§8
//     carried the fast value through a closure, `carry`), else the bar. The recorder marks Kraken's reads only while the
//     market is open (`fx_rec.ts`), and keeps a TrueFX read only when it is new, so a closure brings no fresh read.
//   * THE SWITCH. From the first minute an arm decides at or after `CB_FX_NOT_BEFORE`, written once to its state (`fxFrom`,
//     `cbFxSwitch`); no backfill. Every minute after it records which source priced it (`fx_src` on the minute record, 0173)
//     and the state counts them (`fxCount`).
// Revolut X's rows, PR5's `stepMinute` and the recorder are untouched; nothing here reads Yahoo, the arms' stored bars do.
// One race is accepted: a run that decides minute t before the recorder has written minute t's row (it writes at about
// t + 58 s; the call decides t at t + 60 s at the earliest, usually t + 120 s) reads the newest read before it, still under
// the cap, and the minute is counted by the source that priced it.

import type { Db } from "./db.ts";
import { fxBarAt } from "./quotes.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const enc = (ms: number) => encodeURIComponent(iso(ms));
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));

/** No minute before 2026-10-29 10:00 UTC is priced on `fx_ticks` (earlier worlds keep their rule). */
export const CB_FX_NOT_BEFORE = Date.UTC(2026, 9, 29, 10);
/** A read must have arrived by t + 58 s to price minute t. */
export const CB_FX_CUTOFF_MS = 58_000;
/** And no more than 120 s before that (the recorder's `FX_STALE_MS`), or the minute falls back to Yahoo. */
export const CB_FX_FRESH_MS = 120_000;
export const CB_FX_PAIRS = ["GBPUSD", "EURUSD"] as const;
export type CbFxPair = typeof CB_FX_PAIRS[number];

/** One read as the rule uses it: when it arrived (ms since the epoch), its mid, and its source. */
export type CbFxRead = { at: number; mid: number; source: "truefx" | "kraken" };
/** A pair's usable reads, oldest first: TrueFX's, and Kraken's marked fallback reads. */
export type CbFxReads = { truefx: CbFxRead[]; kraken: CbFxRead[] };
/** Which source priced a minute's rate. */
export type CbFxSrc = "truefx" | "kraken" | "yahoo" | "held:truefx" | "held:kraken" | "held:yahoo";
export const emptyFx = (): Record<CbFxPair, CbFxReads> => ({ GBPUSD: { truefx: [], kraken: [] }, EURUSD: { truefx: [], kraken: [] } });

/** A stored `fx_ticks` row (0172): the minute, and per read when it arrived (ms after the minute), its mid in millionths, marked or not. */
export type FxTickRow = { source: string; pair: string; minute: string; recv_ms: number[]; mid: number[]; fallback: boolean[] };

/** The reads of some rows, per pair, oldest first: every TrueFX read and every MARKED Kraken read. */
export function cbFxReadsOf(rows: FxTickRow[]): Record<CbFxPair, CbFxReads> {
  const out = emptyFx();
  for (const r of rows) {
    const pair = r.pair as CbFxPair, src = r.source;
    if (!out[pair] || (src !== "truefx" && src !== "kraken")) continue;
    const m = msOf(r.minute);
    for (let i = 0; i < (r.recv_ms ?? []).length; i++) {
      if (src === "kraken" && !r.fallback?.[i]) continue;
      const mid = Number(r.mid[i]) / 1e6;
      if (mid > 0) out[pair][src].push({ at: m + Number(r.recv_ms[i]), mid, source: src });
    }
  }
  for (const p of CB_FX_PAIRS) for (const s of ["truefx", "kraken"] as const) out[p][s].sort((a, b) => a.at - b.at);
  return out;
}

/** The newest read arrived at or before `until` (binary search). */
function newest(reads: CbFxRead[], until: number): CbFxRead | null {
  let lo = 0, hi = reads.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (reads[mid].at <= until) lo = mid + 1; else hi = mid; }
  return lo > 0 ? reads[lo - 1] : null;
}

/** The fast read for minute `t`: the newest TrueFX read arrived by t + 58 s, or the newest marked Kraken read when newer. */
export function cbFastAt(r: CbFxReads, t: number): CbFxRead | null {
  const until = t + CB_FX_CUTOFF_MS, tf = newest(r.truefx, until), kr = newest(r.kraken, until);
  return kr && (!tf || kr.at > tf.at) ? kr : tf;
}

/**
 * Minute `t`'s rate, its instant and its source, from a pair's fast reads `r` and the arm's stored Yahoo bars. In session:
 * the fast read when it is fresh, else Yahoo's bar of today's rule (`fxBarAt`). Where today's rule finds no bar in the ten
 * minutes (a closure, or Yahoo silent), the base test is dark as it was; a held arm (`holdBar`, its `cbHoldBarAt`) is lit
 * exactly where its held bar is, and holds the newest fast read if it arrived no earlier than that bar started (the fast
 * value carried through the closure, as §8 carried it), else the bar itself.
 */
export function cbFxAt(t: number, r: CbFxReads, bars: Array<[number, number]>, holdBar: ((t: number) => [number, number] | null) | null):
  { x: number | null; at: number | null; src: CbFxSrc | null } {
  const f = cbFastAt(r, t);
  if (f && t + CB_FX_CUTOFF_MS - f.at <= CB_FX_FRESH_MS) return { x: f.mid, at: f.at, src: f.source };
  const y = fxBarAt(t, bars);
  if (y) return { x: y[1], at: y[0], src: "yahoo" };
  const h = holdBar ? holdBar(t) : null;
  if (!h) return { x: null, at: null, src: null };
  if (f && f.at >= h[0]) return { x: f.mid, at: f.at, src: f.source === "truefx" ? "held:truefx" : "held:kraken" };
  return { x: h[1], at: h[0], src: "held:yahoo" };
}

/** The switch, written once into the state at `first`, the run's first minute, if it is not before `CB_FX_NOT_BEFORE`. */
export function cbFxSwitch(st: { fxFrom?: number }, first: number): void {
  if (st.fxFrom == null && first >= CB_FX_NOT_BEFORE) st.fxFrom = first;
}
export const cbFxLive = (st: { fxFrom?: number }, t: number) => st.fxFrom != null && t >= st.fxFrom;

/** One count more for the source that priced a book's minute (or `dark`), in the state. */
export function cbFxCount(st: { fxCount?: Record<string, number> }, src: CbFxSrc | null): void {
  const k = src ?? "dark";
  (st.fxCount ??= {})[k] = (st.fxCount[k] ?? 0) + 1;
}

/**
 * The rates of a book's minute for a driver: before the switch the arm's own Yahoo lookup (`oldBar`, exactly as it was);
 * from it `cbFxAt` for GBP/USD and EUR/USD (`held`: the arm holds through closures, `oldBar` being its `cbHoldBarAt`). Returns them as [instant, value] bars, as the drivers pass them on, and the
 * source of each.
 */
export function cbRatesAt(st: { fxFrom?: number }, t: number, gbpBars: Array<[number, number]>, eurBars: Array<[number, number]>, fx: Record<CbFxPair, CbFxReads>,
  oldBar: (t: number, bars: Array<[number, number]>) => [number, number] | null, held: boolean) {
  if (!cbFxLive(st, t)) return { bar: oldBar(t, gbpBars), eb: oldBar(t, eurBars), gbpSrc: null as CbFxSrc | null, eurSrc: null as CbFxSrc | null };
  const hold = (bars: Array<[number, number]>) => (held ? (u: number) => oldBar(u, bars) : null);
  const g = cbFxAt(t, fx.GBPUSD, gbpBars, hold(gbpBars)), e = cbFxAt(t, fx.EURUSD, eurBars, hold(eurBars));
  return {
    bar: g.x != null ? [g.at!, g.x] as [number, number] : null, eb: e.x != null ? [e.at!, e.x] as [number, number] : null,
    gbpSrc: g.src, eurSrc: e.src,
  };
}

/**
 * The `fx_ticks` reads a run from `first` to `horizon` can use: every row of the minutes [first − 3 min, horizon] (the cap
 * reaches t + 58 s, freshness two minutes before it), and for a held arm (`holdMs`) each source's newest row in the hold
 * before them, so a closure holds the last fast value. None before the switch could apply.
 */
export async function readCbFx(db: Db, first: number, horizon: number, holdMs: number | null): Promise<Record<CbFxPair, CbFxReads>> {
  if (horizon < CB_FX_NOT_BEFORE) return emptyFx();
  const sel = "select=source,pair,minute,recv_ms,mid,fallback";
  const from = first - 3 * M;
  const rows = await db.selectAll<FxTickRow>("fx_ticks", `minute=gte.${enc(from)}&minute=lte.${enc(horizon)}&${sel}&order=source.asc,pair.asc,minute.asc`);
  if (holdMs != null) {
    for (const source of ["truefx", "kraken"]) for (const pair of CB_FX_PAIRS) {
      // Kraken's newest row with a MARKED read (its routine reads go on through a closure and are never used).
      const marked = source === "kraken" ? "&fallback=cs.%7Btrue%7D" : "";
      rows.push(...await db.select<FxTickRow>("fx_ticks",
        `source=eq.${source}&pair=eq.${pair}&minute=lt.${enc(from)}&minute=gte.${enc(first - holdMs)}${marked}&${sel}&order=minute.desc&limit=1`));
    }
  }
  return cbFxReadsOf(rows);
}
