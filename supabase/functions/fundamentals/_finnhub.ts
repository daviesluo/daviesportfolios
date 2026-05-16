// Finnhub integration — the per-stock fallback when Yahoo's crumb
// handshake fails or quoteSummary returns null. Also the source of
// `pe3yAvg` / `ps3yAvg` regardless of which primary source the
// current ratios came from, since Yahoo's free tier doesn't expose
// historical annuals.
//
// Caveat documented in pickPsFields (_math.ts): Finnhub's `psTTM` /
// `series.annual.ps` use USD market cap ÷ foreign-currency revenue
// for ADRs, so the published numbers are off by the FX rate. The
// dispatcher (index.ts) cross-checks Finnhub's P/S against Yahoo's
// and drops the 3Y avg when they disagree.

import { FINNHUB_API_KEY, type Fundamentals } from "./_shared.ts";
import { computePe3yAvg } from "./_math.ts";

export async function fetchFinnhub(symbol: string): Promise<Fundamentals | null> {
  if (!FINNHUB_API_KEY) return null;
  const url =
    `https://finnhub.io/api/v1/stock/metric` +
    `?symbol=${encodeURIComponent(symbol)}&metric=all` +
    `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const m = data?.metric;
    if (!m) return null;
    const peRaw  = Number(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual);
    const epsRaw = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    const psRaw  = Number(m.psTTM ?? m.psAnnual);
    const pe  = isFinite(peRaw)  && peRaw  > 0 ? peRaw  : 0;
    const eps = isFinite(epsRaw) && epsRaw > 0 ? epsRaw : 0;
    const ps  = isFinite(psRaw)  && psRaw  > 0 ? psRaw  : 0;
    // Surface the row whenever ANY ratio is usable. Loss-makers
    // typically have pe/eps absent but ps populated — without this
    // relaxation the function dropped them entirely and the new P/S
    // YTD view would have nothing to show.
    if (pe === 0 && eps === 0 && ps === 0) return null;
    const pe3yAvg = computePe3yAvg(data?.series?.annual?.pe ?? []);
    const ps3yAvg = computePe3yAvg(data?.series?.annual?.ps ?? []);
    return { pe, eps, ps, pe3yAvg, ps3yAvg };
  } catch {
    return null;
  }
}

// Fetches the last ~12 quarters of reported EPS so the client can build
// a rolling TTM-EPS series. The default P/E modal logic divides every
// historical price by a single CURRENT EPS, which made the P/E chart
// just a 1:1 scale of the price chart — earnings revisions never
// showed up. With this list the client can recompute TTM EPS at each
// price date (sum of the latest 4 reports whose period+lag <= date)
// so the P/E line genuinely steps when a new quarter prints.
//
// Each entry is { date: "YYYY-MM-DD" (quarter end), eps: <actual EPS>}.
// Free Finnhub returns up to 12 quarters which covers ~3 years —
// plenty for the modal's YTD window. Returns null on any error or
// when the response is empty so the client cleanly falls back.
export async function fetchFinnhubEarningsHistory(
  symbol: string,
): Promise<Array<{ date: string; eps: number }> | null> {
  if (!FINNHUB_API_KEY) return null;
  const url =
    `https://finnhub.io/api/v1/stock/earnings` +
    `?symbol=${encodeURIComponent(symbol)}&limit=12` +
    `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    const out = arr
      .map((r: any) => ({
        date: String(r?.period ?? ""),
        eps:  Number(r?.actual),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.eps))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
