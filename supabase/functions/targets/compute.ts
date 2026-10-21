// The analyst-target snapshots the job writes, one per holding, from three kinds of source (Davies, 2026-10-21):
//
//   consensus   a stock's sell-side consensus, as Yahoo's quoteSummary serves it: `financialData` (the mean, low and high
//               of the current targets, the mean rating on Yahoo's 1–5 scale, the number of analysts) and
//               `upgradeDowngradeHistory` (each firm's dated actions with its current target), from which the page's
//               fresh window is read: each firm's latest target set in the last 30 days.
//   holdings    an ETF, which no source gives a consensus for: its holdings-weighted target. Each covered holding's
//               targets as ratios to its own price (currency-free), averaged by the holding's weight in the ETF, then put
//               on the ETF's price. Mean, low and high are the weighted means of each holding's mean, lowest and highest
//               target; the analysts the median of the holdings' counts; the fresh window the weighted mean of each
//               covered holding's own last-30-day range and mean, its count the number of those targets. Coverage (the share of
//               the ETF's weight priced) travels with it, and the page shows it. Each holding's ratio is its targets
//               over `financialData.currentPrice` of the SAME response (one quote, one currency). A holding whose mean
//               is under a fifth of its price or over five times it is taken for a unit or listing error and left out,
//               named as skipped (the same bounds as a stock's, SANE_MEAN_RATIO). A tighter band (0.5–2×) briefly
//               skipped Samsung (2.14×) and SK hynix (2.39×) on 2026-10-21; their targets were checked and are real
//               (same-response KRW price, 36 and 38 analysts, set before a 20–30 % fall), so they count (Davies,
//               2026-10-21).
//   strategist  bitcoin, which no API covers: the dated, sourced bank targets in `strategists.ts`, kept by hand.
//
// Every snapshot is in the instrument's own currency. The page compares it with the price the board shows, so its
// percentages move with the board between runs; the job's own price (`refPrice`) is kept for the record.

export const FRESH_DAYS = 30;
const DAY = 86400e3;

/** One firm's current target with the day it was set. */
export type FirmTarget = { firm: string; target: number; at: string };
export type Snapshot = {
  ticker: string;
  kind: "consensus" | "holdings" | "strategist";
  currency: string | null;
  refPrice: number | null;
  mean: number | null; low: number | null; high: number | null;
  /** Yahoo's mean recommendation, 1 (strong buy) to 5 (sell); null where there is no rating scale. */
  rating: number | null;
  analysts: number | null;
  /** Each firm's latest target (consensus: the last 45 days; strategist: all), newest first. */
  targets: FirmTarget[];
  /**
   * The fresh window computed by the job, for a holdings-weighted row only (the page computes the others' from
   * `targets`): its low, high and mean (the page's "Fresh avg vs price", Davies 2026-10-21), and how many targets.
   */
  fresh?: { low: number; high: number; mean: number; count: number } | null;
  /**
   * A holdings-weighted row's basis: the share of the ETF's weight covered, how many holdings, and the holdings left out
   * as a likely unit or listing error (their mean over their price outside CONSTITUENT_RATIO), with that ratio.
   */
  coverage?: { weight: number; names: number; source: string; skipped?: Array<{ symbol: string; weight: number; ratio: number }> } | null;
  /** A strategist row's sources, one per target. */
  sources?: Array<{ firm: string; target: number; at: string; horizon: string; url: string }>;
};

const raw = (x: unknown): number | null => {
  const v = x && typeof x === "object" ? (x as { raw?: unknown }).raw : x;
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
};
const pos = (n: number | null) => (n !== null && n > 0 ? n : null);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** What the job reads of one quoteSummary result. */
export type Analyst = {
  currency: string | null; price: number | null;
  /** `financialData.currentPrice`: the price the same response's targets stand against (null when it gives none). */
  fdPrice: number | null;
  mean: number | null; low: number | null; high: number | null;
  rating: number | null; analysts: number | null; history: FirmTarget[]; holdings: Array<{ symbol: string; weight: number }>;
};

/** A quoteSummary result (modules financialData, upgradeDowngradeHistory, price, topHoldings) reduced to what the job reads. */
export function parseAnalyst(result: Record<string, any> | null | undefined): Analyst | null {
  if (!result || typeof result !== "object") return null;
  const f = result.financialData ?? {}, p = result.price ?? {};
  // Each firm's latest action that carries a target: the history is newest first, and a 0 is "no target".
  const seen = new Set<string>();
  const history: FirmTarget[] = [];
  const hist = Array.isArray(result.upgradeDowngradeHistory?.history) ? result.upgradeDowngradeHistory.history : [];
  for (const h of [...hist].sort((a: any, b: any) => Number(b?.epochGradeDate) - Number(a?.epochGradeDate))) {
    const firm = typeof h?.firm === "string" ? h.firm.trim() : "", target = Number(h?.currentPriceTarget), t = Number(h?.epochGradeDate);
    if (!firm || seen.has(firm) || !(target > 0) || !(t > 0)) continue;
    seen.add(firm);
    history.push({ firm, target, at: new Date(t * 1000).toISOString() });
  }
  const holdings = (Array.isArray(result.topHoldings?.holdings) ? result.topHoldings.holdings : [])
    .map((h: any) => ({ symbol: String(h?.symbol ?? ""), weight: raw(h?.holdingPercent) ?? 0 }))
    .filter((h: { symbol: string; weight: number }) => h.symbol && h.weight > 0);
  return {
    currency: typeof p.currency === "string" ? p.currency : null,
    price: pos(raw(f.currentPrice)) ?? pos(raw(p.regularMarketPrice)),
    fdPrice: pos(raw(f.currentPrice)),
    mean: pos(raw(f.targetMeanPrice)), low: pos(raw(f.targetLowPrice)), high: pos(raw(f.targetHighPrice)),
    rating: pos(raw(f.recommendationMean)), analysts: pos(raw(f.numberOfAnalystOpinions)),
    history, holdings,
  };
}

/**
 * How far a mean target may sit from the price before the figures are taken for a unit or currency mix-up (a target quoted
 * in another listing's currency, a price in pence) rather than a view: a consensus a fifth of the price, or five times it,
 * is not one this page shows without a person checking it. No holding on the board was near either bound on 2026-10-21.
 */
export const SANE_MEAN_RATIO = { min: 0.2, max: 5 };

/** A stock's consensus snapshot; null when Yahoo has no targets for it. Targets older than 45 days are left out of the list. */
export function consensusSnapshot(ticker: string, a: Analyst | null, nowMs: number): Snapshot | null {
  if (!a || a.mean === null) return null;
  if (a.price !== null && (a.mean / a.price < SANE_MEAN_RATIO.min || a.mean / a.price > SANE_MEAN_RATIO.max)) return null;
  return {
    ticker, kind: "consensus", currency: a.currency, refPrice: a.price, mean: a.mean, low: a.low, high: a.high,
    rating: a.rating, analysts: a.analysts !== null ? Math.round(a.analysts) : null,
    targets: a.history.filter((t) => nowMs - Date.parse(t.at) <= 45 * DAY),
  };
}

/** Each firm's latest target set in the last 30 days: the fresh window's targets. */
export function freshTargets(targets: FirmTarget[], nowMs: number, days = FRESH_DAYS): FirmTarget[] {
  return targets.filter((t) => { const at = Date.parse(t.at); return at <= nowMs && nowMs - at <= days * DAY; });
}

/** A constituent's mean target over its own price must lie in this band to be weighted in: a stock's bounds (see the header). */
export const CONSTITUENT_RATIO = { min: SANE_MEAN_RATIO.min, max: SANE_MEAN_RATIO.max };

/**
 * A preferred share in a fund's holdings and the common share whose consensus stands for it. Yahoo's few targets on a
 * preferred line (005935.KS: 4 analysts on 2026-10-21, against 36 on 005930.KS) are not the market's view of the company,
 * so the ratio is read from the common share's targets over the common share's price, and applied at the preferred's
 * weight. Keys are as `topHoldings` names them, before `yahooSymbolCandidates`.
 */
export const PREFERRED_COMMON: Record<string, string> = { "005935": "005930.KS", "005935.KS": "005930.KS", "005935.KQ": "005930.KS" };

/**
 * An ETF's holdings-weighted snapshot (see the header): `holdings` its constituents with their weights in the ETF (fractions),
 * `data` each constituent's quoteSummary as read, `etf` the ETF's own price and currency. Null when nothing is covered.
 */
export function holdingsSnapshot(
  ticker: string, holdings: Array<{ symbol: string; weight: number }>, data: Map<string, Analyst | null>,
  etf: { price: number | null; currency: string | null }, nowMs: number, source: string,
): Snapshot | null {
  if (!etf.price) return null;
  let w = 0, wMean = 0, wLow = 0, wHigh = 0, wf = 0, fLow = 0, fHigh = 0, fMean = 0, fCount = 0, names = 0;
  const counts: number[] = [];
  const skipped: Array<{ symbol: string; weight: number; ratio: number }> = [];
  for (const h of holdings) {
    const a = data.get(h.symbol);
    // The targets and the price from one response: `financialData`'s own currentPrice, never another quote's.
    const px = a?.fdPrice ?? null;
    if (!a || !px || a.mean === null || a.low === null || a.high === null) continue;
    const ratio = a.mean / px;
    if (ratio < CONSTITUENT_RATIO.min || ratio > CONSTITUENT_RATIO.max) { skipped.push({ symbol: h.symbol, weight: r4(h.weight), ratio: r4(ratio) }); continue; }
    w += h.weight; names++;
    wMean += h.weight * ratio; wLow += h.weight * (a.low / px); wHigh += h.weight * (a.high / px);
    if (a.analysts !== null) counts.push(a.analysts);
    const fresh = freshTargets(a.history, nowMs).map((t) => t.target);
    if (fresh.length) {
      wf += h.weight; fCount += fresh.length;
      fLow += h.weight * (Math.min(...fresh) / px); fHigh += h.weight * (Math.max(...fresh) / px);
      fMean += h.weight * (fresh.reduce((s, x) => s + x, 0) / fresh.length / px);
    }
  }
  if (!(w > 0)) return null;
  counts.sort((x, y) => x - y);
  const median = counts.length ? (counts.length % 2 ? counts[(counts.length - 1) / 2] : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2) : null;
  const p = etf.price;
  return {
    ticker, kind: "holdings", currency: etf.currency, refPrice: p,
    mean: r4(p * wMean / w), low: r4(p * wLow / w), high: r4(p * wHigh / w), rating: null,
    analysts: median === null ? null : Math.round(median), targets: [],
    fresh: wf > 0 ? { low: r4(p * fLow / wf), high: r4(p * fHigh / wf), mean: r4(p * fMean / wf), count: fCount } : null,
    coverage: { weight: r4(w), names, source, skipped },
  };
}

/** Bitcoin's (or any hand-kept instrument's) snapshot from its dated, sourced targets. */
export function strategistSnapshot(
  ticker: string, rows: Array<{ firm: string; target: number; date: string; horizon: string; url: string }>, price: number | null,
): Snapshot | null {
  if (!rows.length) return null;
  const ts = rows.map((r) => r.target);
  return {
    ticker, kind: "strategist", currency: "USD", refPrice: price,
    mean: r4(ts.reduce((s, x) => s + x, 0) / ts.length), low: Math.min(...ts), high: Math.max(...ts), rating: null, analysts: rows.length,
    targets: [...rows].sort((a, b) => b.date.localeCompare(a.date)).map((r) => ({ firm: r.firm, target: r.target, at: `${r.date}T00:00:00.000Z` })),
    sources: rows.map((r) => ({ firm: r.firm, target: r.target, at: r.date, horizon: r.horizon, url: r.url })),
  };
}

/**
 * The symbols to try, in order, for a holding as Yahoo's quoteSummary may know it. Yahoo's own `topHoldings` names some
 * Asian listings in forms its quoteSummary does not answer (read 2026-10-21 on SAEM.L): Korean names as `.KQ` (Samsung
 * `005930.KQ` answers nothing; `005930.KS` does), a preferred share bare (`005935`, which is `005935.KS`), Hong Kong's with
 * five digits (`00939`, which is `0939.HK`). The symbol as given is tried first, so a real KOSDAQ listing still answers.
 */
export function yahooSymbolCandidates(symbol: string): string[] {
  const s = symbol.trim().toUpperCase();
  if (/^\d{6}\.KQ$/.test(s)) return [s, s.replace(/\.KQ$/, ".KS")];
  if (/^\d{6}$/.test(s)) return [`${s}.KS`, `${s}.KQ`];
  if (/^0\d{4}$/.test(s)) return [`${s.slice(1)}.HK`];
  return [s];
}
