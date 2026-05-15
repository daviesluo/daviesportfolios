// Per-position portfolio rollup ("computeMetrics") + formation
// detection. The numbers on the scoreboard, the heatmap tile sizes,
// and the position drill modal all come from here. Lifted out of
// utils.js so a test/file that only cares about the math doesn't
// pull in fetch plumbing / market hours / Storage.

import { fxRateToUSD } from './fx.js';
import { isUsEquity } from './ticker_class.js';

// Yahoo's `postMarketPrice` for OTC ADRs like SFTBY is bogus — it
// ships today's regular-session OPEN as if it were an after-hours
// quote, even though SFTBY doesn't actually trade AH. The result on
// the home page was a +8 % "AH move" the ticker never made.
//
// Without an intraday series at this layer (computeMetrics doesn't
// fetch — it consumes whatever marketData gives it), the strongest
// signal we have is the absolute divergence between `extPrice` and
// `lastPrice` (= today's regular close). Real after-hours quotes
// usually sit within a couple of percent of the regular close; the
// SFTBY-shape bug spikes 8 %+. 5 % threshold catches it while
// allowing typical AH movement.
//
// Earnings-day false negative: an honest 10 % AH move on a real
// stock (NVDA after a beat) would also exceed 5 % and fall back to
// lastPrice on the tactics board. The trade-off is intentional —
// the user has explicitly asked for SFTBY to stop lying, and they
// can still see the real AH price in the modal (which has the
// intraday series to validate). Re-tighten when we have a better
// per-ticker signal here.
const EXT_PRICE_MAX_DIVERGENCE = 0.05;

/** @param {number | null | undefined} extPrice @param {number | null | undefined} lastPrice */
function extPriceLooksReal(extPrice, lastPrice) {
  if (typeof extPrice !== 'number' || extPrice <= 0) return false;
  if (typeof lastPrice !== 'number' || lastPrice <= 0) return true; // no anchor → trust extPrice
  return Math.abs(extPrice - lastPrice) / lastPrice < EXT_PRICE_MAX_DIVERGENCE;
}

/**
 * Aggregate every position in `portfolio` into `{ marketValue,
 * dayChange, unrlGL, positions: {[k]: ...}, fxMissingTickers }`.
 * The `players` array on each position has per-ticker USD-converted
 * marketValue / dayChange / cost plus the native lastPrice so modals
 * can render with the correct currency symbol.
 *
 * @param {{
 *   holdings: Record<string, any>,
 *   positions: Record<string, { role: string, tickers: string[], label?: string }>,
 * }} portfolio
 * @param {{
 *   extended?: boolean,
 *   marketData?: Record<string, { lastPrice?: number }>,
 * }} [opts]
 */
export const computeMetrics = (portfolio, opts = {}) => {
  const ext = !!opts.extended;
  const marketData = opts.marketData || {};
  let marketValue = 0, totalCost = 0, dayChange = 0;
  /** @type {string[]} tickers whose FX pair couldn't be read live this tick */
  const fxMissingTickers = [];
  const positionsOut = {};
  for (const [posKey, pos] of Object.entries(portfolio.positions)) {
    let posMV = 0, posPrev = 0, posCost = 0;
    const players = [];
    for (const t of pos.tickers) {
      const h = portfolio.holdings[t];
      if (!h) continue;
      // Cash entries: MV = lastPrice (held as dollar amount); no P/L, no day change.
      const isCash = !!h.isCash;
      // In extended mode use the extended price if it's a real AH
      // quote. The verdict is `h.extPriceTrusted` — set by the app's
      // ext-hours validation fetch, which inspects the intraday
      // series exactly the way the chart modal does, so the position
      // card and the drill modal never disagree (the CBRS divergence
      // bug). When that verdict hasn't been computed yet (first paint,
      // or the validation fetch failed) fall back to the lightweight
      // ±5% quote-only heuristic. Cash always uses lastPrice.
      const extVerdict = typeof h.extPriceTrusted === 'boolean'
        ? h.extPriceTrusted
        : extPriceLooksReal(h.extPrice, h.lastPrice);
      const trustExt = !isCash && ext && extVerdict;
      const priceNative = trustExt ? h.extPrice : h.lastPrice;
      // `extActive` = "treat this row's day-change as a US extended-
      // hours move". US equities / ADRs only: crypto trades 24/7 (no
      // RTH close to anchor at) and London / CN-fund rows keep their
      // own session's "since previous close", so both are excluded.
      // When active, the change is measured from today's RTH close —
      // so a US name that doesn't actually trade AH shows 0%, not a
      // stale regular-session number. Also drives baselinePrice below.
      const extActive = ext && !isCash && isUsEquity(t);
      const pct = extActive
        ? (trustExt && h.extDayPct != null ? h.extDayPct : 0)
        : (h.dayPct ?? 0);
      // Convert native → USD (cash is already USD; treat missing currency as USD).
      // `fxMissing` propagates to the player object so the UI can badge
      // it — without that flag a GBP holding silently falls back to
      // 1:1 USD and the portfolio value undercounts by ~20%.
      const fxResult = isCash
        ? { rate: 1, missing: false }
        : fxRateToUSD(h.currency, marketData);
      const fx = fxResult.rate;
      const fxMissing = fxResult.missing;
      const priceUSD = priceNative * fx;
      const mv = isCash ? h.lastPrice : h.shares * priceUSD;
      // Day-change baseline:
      //   - ext-on, extPrice trusted → today's RTH close, so the
      //     change is the AH move since 16:00 ET.
      //   - ext-on, extPrice rejected/absent (OTC ADRs like SFTBY
      //     that don't trade AH) → ALSO today's RTH close → 0, since
      //     the price genuinely hasn't moved since the close. (This
      //     used to fall back to yesterday's prevClose and show the
      //     regular-session move, but in ext mode that's a stale
      //     number — a non-AH-trading stock IS flat after the close.)
      //   - ext-off → yesterday's prevClose, the full-session move.
      const baselinePrice = extActive
        ? (h.lastPrice ?? h.prevClose ?? priceNative)
        : (h.prevClose ?? priceNative);
      const prevMV = isCash ? mv : h.shares * baselinePrice * fx;
      const costUSD = isCash ? mv : h.shares * h.cost * fx;
      posMV += mv; posPrev += prevMV; posCost += costUSD;
      if (fxMissing) fxMissingTickers.push(t);
      // Player object: marketValue / dayChange / cost in USD; lastPrice
      // stays native so modals can render it with the correct currency
      // symbol. dayChange = mv − prevMV in the same units (USD).
      players.push({
        ticker: t, ...h,
        marketValue: mv,
        dayChange: mv - prevMV,
        lastPrice: priceNative,
        lastPriceUSD: priceUSD,
        fx,
        fxMissing,
        dayPct: pct,
      });
    }
    marketValue += posMV; totalCost += posCost;
    const dayDelta = posMV - posPrev;
    dayChange += dayDelta;
    positionsOut[posKey] = {
      ...pos,
      marketValue: posMV,
      dayChange: dayDelta,
      dayPct: posPrev > 0 ? (dayDelta / posPrev) * 100 : 0,
      unrlGL: posMV - posCost,
      unrlPct: posCost > 0 ? ((posMV - posCost) / posCost) * 100 : 0,
      players,
    };
  }
  return {
    marketValue,
    totalCost,
    dayChange,
    dayPct: (marketValue - dayChange) > 0 ? (dayChange / (marketValue - dayChange)) * 100 : 0,
    unrlGL: marketValue - totalCost,
    unrlPct: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
    tickerCount: Object.keys(portfolio.holdings).filter(t => t !== "CASH" && !(portfolio.holdings[t] && portfolio.holdings[t].isCash)).length,
    positions: positionsOut,
    // Tickers whose native-currency → USD rate had to fall back to
    // 1:1 because the FX pair wasn't in marketData this tick. The
    // header surfaces this so a silent fxToUSD()→1 fallback can't
    // misreport the portfolio without the user noticing.
    fxMissingTickers,
  };
};

/**
 * Build the "DEF-MID-FWD" formation string for the brand header.
 * GK is always 1 so we omit it.
 * @param {{ positions: Record<string, { role: string }> }} portfolio
 */
export const detectFormation = (portfolio) => {
  const counts = { DEF: 0, MID: 0, FWD: 0 };
  for (const pos of Object.values(portfolio.positions)) {
    if (pos.role !== "GK") {
      counts[pos.role] = (counts[pos.role] || 0) + 1;
    }
  }
  return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
};
