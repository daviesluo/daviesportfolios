// The USDC-GBP fair nudge, a twin's rule alone ("Stablecoin quotes variant-7", 0169; Davies, 2026-10-29: "“唯一的线索：只针对
// USDC-GBP • 做法：用 Coinbase 的 USDC-GBP 中间价偏离程度，对合理价做半权重的微调。” 这个开testing variant-7，在目前实盘的基础上做300美元
// funded"). It is REVX-FAIR's lead (docs/agents/reviews/2026-10-29-revx-fair-price-study.md §5), written as that study's replay
// computed it (docs/agents/backtests/fair_price/scripts/lead.py, replay.py), and pre-registered in
// docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md.
//
// For each minute t of the rule's book, with the book's fair f = fairU / X as PR5's rule takes it (X held through a closure by
// the weekend rule):
//   1. Coinbase's mid m: the latest touch of `cb_touch` (product = the book) stamped at or before t − 1 ms, if no more than
//      `staleMs` (5 minutes) before t − 1 ms; else none ("stale").
//   2. g = m / f − 1. The EMA of g moves only on minutes with both: e ← g at the first, then e ← e + (1 − 0.5^(Δ/HL)) (g − e),
//      Δ the minutes since its last move and HL its HALF-LIFE in minutes (1,440: a 24-hour half-life, the study's convention).
//   3. dev = g − e (e after this minute's move). |dev| at or over `capFrac` (50 bps): f is left ("cap"). Else
//      f′ = f × (1 + w × dev), w = 0.5.
// Every minute of the rule's book is recorded (`agent_quote_twin_nudge`): f, m and its instant, e, dev, f′ and why it fell back.
// The paper replica quotes and exits off f′ (its fairU becomes f′ × X); the executor prices its exits, its stop's bound and its
// guards off f′ too, from the replica's record of the minute it carries out (`nudgedInputs`, quotes_live.ts). With no rule,
// or on the other book, or before `from`, nothing here runs.

const M = 60e3, H = 3600e3;

/** The rule as a spec row names it (`rules.fairNudge`), with the study's settings as its defaults. */
export type FairNudgeRule = {
  from: number; book: "USDC-GBP" | "USDT-GBP"; w: number; halfLifeMin: number; staleMs: number; capFrac: number; warmMs: number;
};
/** The study's settings: half weight, a 24-hour half-life, a touch at most 5 minutes old, a 50 bps cap, 72 hours of warm-up. */
export const FAIR_NUDGE_DEFAULTS = { w: 0.5, halfLifeMin: 1440, staleMs: 5 * M, capFrac: 0.005, warmMs: 72 * H } as const;

/** A spec row's `rules.fairNudge`: `from` (UTC) and `book` required; `w`, `halfLifeMin` optional (the defaults). Refused unreadable. */
export function parseFairNudge(v: unknown): FairNudgeRule {
  const o = v as { from?: unknown; book?: unknown; w?: unknown; halfLifeMin?: unknown } | null;
  const from = Date.parse(String(o?.from));
  if (!Number.isFinite(from)) throw new Error(`its rule fairNudge needs "from", a UTC instant`);
  if (o?.book !== "USDC-GBP" && o?.book !== "USDT-GBP") throw new Error(`its rule fairNudge needs "book", USDC-GBP or USDT-GBP`);
  const w = o?.w == null ? FAIR_NUDGE_DEFAULTS.w : Number(o.w);
  const hl = o?.halfLifeMin == null ? FAIR_NUDGE_DEFAULTS.halfLifeMin : Number(o.halfLifeMin);
  if (!(w > 0 && w <= 1)) throw new Error(`its rule fairNudge's "w" must be more than 0 and at most 1`);
  if (!(Number.isInteger(hl) && hl >= 60 && hl <= 10080)) throw new Error(`its rule fairNudge's "halfLifeMin" must be a whole number of minutes from 60 to 10080`);
  return { from, book: o.book, w, halfLifeMin: hl, staleMs: FAIR_NUDGE_DEFAULTS.staleMs, capFrac: FAIR_NUDGE_DEFAULTS.capFrac, warmMs: FAIR_NUDGE_DEFAULTS.warmMs };
}

/** Why a minute's fair was not nudged: no fair (dark), Coinbase's touch missing or too old, or the deviation at the cap. */
export type NudgeFallback = "dark" | "stale" | "cap" | null;
/** One minute of the rule's book, as recorded. `fairNudged` is the fair it priced off (f′, or f when it fell back). */
export type NudgeRec = {
  minute: number; fair: number | null; cbMid: number | null; cbAt: number | null; ema: number | null; dev: number | null;
  fairNudged: number | null; fallback: NudgeFallback;
};
/** The EMA as the replica carries it from minute to minute, and its last minute's record (what the executor reads). */
export type NudgeState = { ema: number | null; emaAt: number | null; last: NudgeRec | null; warmedFrom?: number };
export const newNudgeState = (): NudgeState => ({ ema: null, emaAt: null, last: null });

/** Coinbase's touches as [instant, mid], ascending. */
export type Touch = [number, number];
/** The touch a minute t reads: the latest stamped at or before t − 1 ms, if no more than `staleMs` before t − 1 ms. */
export function touchAt(touches: readonly Touch[], t: number, staleMs: number): Touch | null {
  let lo = 0, hi = touches.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (touches[mid][0] <= t - 1) lo = mid + 1; else hi = mid; }
  const k = lo - 1;
  if (k < 0) return null;
  return t - 1 - touches[k][0] > staleMs ? null : touches[k];
}

/**
 * One minute of the rule: the EMA moved (mutating `s`), the record made. `f` the book's fair (null: dark), `touch` the one
 * the minute reads (null: stale). Before the EMA has a value the first g sets it, so the first minute's dev is 0.
 */
export function nudgeStep(s: NudgeState, t: number, f: number | null, touch: Touch | null, rule: Pick<FairNudgeRule, "w" | "halfLifeMin" | "capFrac">): NudgeRec {
  if (f == null || !(f > 0)) return { minute: t, fair: null, cbMid: touch?.[1] ?? null, cbAt: touch?.[0] ?? null, ema: s.ema, dev: null, fairNudged: null, fallback: "dark" };
  if (!touch) return { minute: t, fair: f, cbMid: null, cbAt: null, ema: s.ema, dev: null, fairNudged: f, fallback: "stale" };
  const g = touch[1] / f - 1;
  s.ema = s.ema == null || s.emaAt == null ? g : s.ema + (1 - Math.pow(0.5, (t - s.emaAt) / M / rule.halfLifeMin)) * (g - s.ema);
  s.emaAt = t;
  const dev = g - s.ema;
  const capped = Math.abs(dev) >= rule.capFrac;
  return { minute: t, fair: f, cbMid: touch[1], cbAt: touch[0], ema: s.ema, dev, fairNudged: capped ? f : f * (1 + rule.w * dev), fallback: capped ? "cap" : null };
}

/** The fair a minute prices off once its record is known: f × (1 + w × dev) when the record nudged it, else f. */
export function nudgedFair(f: number, rec: Pick<NudgeRec, "dev" | "fallback"> | null | undefined, w: number): number {
  return rec && rec.fallback == null && rec.dev != null ? f * (1 + w * rec.dev) : f;
}

/** A record as `agent_quote_twin_nudge` (0169) keeps it. */
export function nudgeRow(twinId: string, book: string, r: NudgeRec) {
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
  return {
    twin_id: twinId, book, minute: iso(r.minute), fair: r.fair, cb_mid: r.cbMid, cb_at: iso(r.cbAt), ema: r.ema, dev: r.dev,
    fair_nudged: r.fairNudged, fallback: r.fallback,
  };
}
