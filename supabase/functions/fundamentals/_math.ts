// Pure math helpers — PEG / forward-growth / P/S cross-check /
// TTM rolling / EPS USD rescale / 3-year-average P/E. Zero
// external deps (no env, no network, no constants), all formula
// math, so all of these are pinned by `index.test.ts`.
//
// `index.ts` re-exports each function so test imports stay at
// `import { ... } from "./index.ts"`.

/**
 * Blended forward EPS-growth rate from Yahoo's `earningsTrend.trend`
 * — the PEG denominator.
 *
 * Yahoo used to publish a `+5y` analyst long-term-growth bucket but
 * dropped it (confirmed gone in the May-2026 prod probe — only the
 * near-term buckets remain). `0y` (current fiscal year) and `+1y`
 * (next fiscal year) each still carry a forward `growth.raw`
 * (decimal — 0.585 = 58.5 %) derived from consensus EPS estimates.
 * Averaging the two gives a 2-year forward growth rate: genuinely
 * multi-year and forward-looking, and steadier than any single year
 * — which matters for the cyclical semi/tech names where one fiscal
 * year can land on a cycle peak or trough.
 *
 * Quarterly buckets (`0q` / `+1q`) are ignored — their `growth` is
 * quarter-over-year-ago-quarter, not an annual rate.
 *
 * Only positive buckets are averaged. A bucket calling for an
 * earnings decline is dropped rather than allowed to drag the blend
 * down (and `computePeg` hides PEG on non-positive growth anyway).
 * Falls back to the single present bucket when only one of `0y` /
 * `+1y` is usable; returns null when neither is — brand-new IPOs,
 * names without analyst coverage, or a consensus down-cycle across
 * both years.
 *
 * @param {unknown} trend  Yahoo's `earningsTrend.trend` array
 */
export function computeForwardGrowth(trend: unknown): number | null {
  if (!Array.isArray(trend)) return null;
  const bucketGrowth = (period: string): number | null => {
    const bucket = trend.find((t: any) => t?.period === period);
    const g = Number(bucket?.growth?.raw);
    return isFinite(g) && g > 0 ? g : null;
  };
  const vals = [bucketGrowth("0y"), bucketGrowth("+1y")]
    .filter((g): g is number => g !== null);
  if (vals.length === 0) return null;
  return vals.reduce((s, g) => s + g, 0) / vals.length;
}

/**
 * PEG = forward P/E ÷ forward EPS-growth rate (in percent).
 *
 * The "forward over forward" convention is the load-bearing detail:
 * the market prices in expectations, not history, so pairing
 * trailing P/E with forward growth (or vice versa) gives a
 * misleading number. The numerator is Yahoo's
 * `summaryDetail.forwardPE.raw`; the denominator is the blended 2y
 * forward growth from `computeForwardGrowth` (Yahoo dropped its
 * `+5y` long-term-growth bucket, so the two near-term annual
 * buckets are averaged instead).
 *
 * Growth is a DECIMAL (0.225 = 22.5 %). To turn it into the
 * standard "PEG denominator" we multiply by 100, so PEG ends up
 * scaled the way Bloomberg / Yahoo / etc. display it (a fairly-
 * valued stock has PEG ≈ 1).
 *
 * Returns null whenever the formula doesn't have a meaningful
 * answer: forwardPE missing or ≤ 0, growth missing or ≤ 0
 * (negative growth makes PEG itself negative, and most data
 * vendors hide PEG in that case rather than try to interpret it).
 *
 * @param {number | undefined | null} forwardPE
 * @param {number | undefined | null} growth  decimal, e.g. 0.225
 */
export function computePeg(
  forwardPE: number | undefined | null,
  growth: number | undefined | null,
): number | null {
  const f = Number(forwardPE);
  const g = Number(growth);
  if (!isFinite(f) || f <= 0) return null;
  if (!isFinite(g) || g <= 0) return null;
  return f / (g * 100);
}

/**
 * Pick the P/S value and the 3-year-average reference value, guarding
 * against the ADR currency-mismatch that plagued Finnhub's `peTTM`
 * (USD ADR price ÷ foreign-currency reported EPS). Finnhub's
 * `psTTM` / `series.annual.ps` inherit the same bug — for an ADR
 * Finnhub divides USD market cap by foreign-currency revenue, so
 * the published ratios come out off by the FX rate. Yahoo's
 * `summaryDetail.priceToSalesTrailing12Months` is USD-correct
 * because the consumer-facing site has to display a coherent
 * number, so we always prefer it for the current value.
 *
 * The harder case is the 3-year average. Yahoo doesn't expose
 * historical annual P/S on the free tier, so the 3Y AVG dashed
 * reference line on the chart comes from Finnhub's annual series
 * regardless of source. We can still catch the ADR case
 * heuristically: when BOTH sources have a current P/S, compare
 * them. If they agree within 2× either way, currencies are
 * consistent and Finnhub's annual series is trustworthy. If they
 * disagree (Yahoo $TSM ps ~12, Finnhub $TSM psTTM ~360 because
 * of the TWD mismatch), drop Finnhub's `ps3yAvg` so the chart
 * doesn't paint a wildly off-scale reference line.
 *
 * @param {number | undefined | null} yahooPs   Yahoo's USD-USD P/S
 * @param {number | undefined | null} finnPs    Finnhub's possibly-mixed-unit P/S
 * @param {number | undefined | null} finnPs3y  Finnhub's annual 3Y avg P/S
 */
export function pickPsFields(
  yahooPs: number | undefined | null,
  finnPs: number | undefined | null,
  finnPs3y: number | undefined | null,
): { ps: number; ps3yAvg: number | null } {
  const ys = isFinite(Number(yahooPs)) && Number(yahooPs) > 0 ? Number(yahooPs) : 0;
  const fs = isFinite(Number(finnPs))  && Number(finnPs)  > 0 ? Number(finnPs)  : 0;
  const ps = ys > 0 ? ys : fs;
  // The annual 3Y avg only renders when sources cross-check. When
  // only one source has a current value the cross-check is
  // impossible — fall back to "no reference line", same as if
  // Finnhub had returned no annual series at all.
  let ps3yAvg: number | null = null;
  if (
    typeof finnPs3y === 'number' && isFinite(finnPs3y) && finnPs3y > 0
    && ys > 0 && fs > 0
  ) {
    const r = ys / fs;
    if (r > 0.5 && r < 2) ps3yAvg = finnPs3y;
  }
  return { ps, ps3yAvg };
}

/**
 * Build a TTM EPS history from raw quarterly Finnhub EPS by summing
 * each rolling window of 4 quarters. Used as the fallback when
 * Yahoo's trailingDilutedEPS endpoint fails. Returns null if there
 * aren't enough quarters to form a single TTM point.
 */
export function rollingTtmFromRawQuarterly(
  raw: Array<{ date: string; eps: number }>,
): Array<{ date: string; eps: number }> | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const out: Array<{ date: string; eps: number }> = [];
  for (let i = 3; i < raw.length; i++) {
    out.push({
      date: raw[i].date,
      eps:  raw[i].eps + raw[i - 1].eps + raw[i - 2].eps + raw[i - 3].eps,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Scale a TTM-EPS history series to USD using the ratio between the
 * authoritative USD eps (from Yahoo quoteSummary) and the latest
 * entry in the historical series. ADRs like TSM / SFTBY report
 * fundamentals in the underlying foreign currency (TWD / JPY) via
 * Yahoo's fundamentals-timeseries endpoint, while the ADR's market
 * price + trailingPE / trailingEps from quoteSummary are pre-
 * normalized to USD. Dividing USD prices by foreign-currency EPS
 * was the source of the TSM=1.22 / SFTBY=0.07 bug.
 *
 * The scaling assumes the FX rate has been approximately constant
 * over the historical window — true within ±5-10 % for USD/TWD,
 * USD/JPY over a typical 1y chart, which is acceptable for a "how
 * has the P/E moved this year?" visualization.
 *
 * For US-listed stocks where currencies already match, the ratio is
 * ≈ 1.0 so this is a near no-op (just a uniform multiply).
 *
 * @param history       latest-last EPS series, foreign-currency for ADRs
 * @param epsUsdLatest  authoritative USD trailing EPS (Yahoo quoteSummary)
 */
export function normalizeEpsHistoryToUsd(
  history: Array<{ date: string; eps: number }>,
  epsUsdLatest: number,
): Array<{ date: string; eps: number }> {
  if (!Array.isArray(history) || history.length === 0) return history;
  if (!isFinite(epsUsdLatest) || epsUsdLatest <= 0) return history;
  const latest = history[history.length - 1].eps;
  if (!isFinite(latest) || latest <= 0) return history;
  // If the latest historical EPS is already within ±20 % of the
  // authoritative USD value, currencies already match — return as-is
  // rather than apply a near-1.0 scale that could amplify noise.
  const ratio = epsUsdLatest / latest;
  if (ratio > 0.8 && ratio < 1.2) return history;
  return history.map((p) => ({ date: p.date, eps: p.eps * ratio }));
}

/**
 * Compute the 3-year average P/E from Finnhub's `series.annual.pe`
 * (or any similarly-shaped { period, v } array). Takes the 3 most
 * recent valid years.
 */
export function computePe3yAvg(
  annualSeries: Array<{ period?: unknown; v?: unknown }>,
): number | null {
  if (!Array.isArray(annualSeries) || annualSeries.length === 0) return null;
  const sorted = annualSeries
    .map((p) => ({ period: String(p?.period ?? ""), v: Number(p?.v) }))
    .filter((p) => p.period && isFinite(p.v) && p.v > 0)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, 3);
  if (sorted.length === 0) return null;
  return sorted.reduce((s, p) => s + p.v, 0) / sorted.length;
}
