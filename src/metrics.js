// Per-position portfolio rollup ("computeMetrics") + formation
// detection. The numbers on the scoreboard, the heatmap tile sizes,
// and the position drill modal all come from here. Lifted out of
// utils.js so a test/file that only cares about the math doesn't
// pull in fetch plumbing / market hours / Storage.

import { fxRateToUSD } from './fx.js';

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
      // In extended mode use the extended price if available; cash always uses lastPrice.
      const priceNative = isCash ? h.lastPrice : ((ext && h.extPrice != null) ? h.extPrice : h.lastPrice);
      const pct   = (ext && h.extDayPct != null) ? h.extDayPct : (h.dayPct ?? 0);
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
      // In extended-hours mode the baseline is today's RTH close (lastPrice), not yesterday's close.
      // This makes position + scoreboard day change reflect the after-hours move since 16:00 ET.
      const baselinePrice = ext ? (h.lastPrice ?? h.prevClose ?? priceNative) : (h.prevClose ?? priceNative);
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
