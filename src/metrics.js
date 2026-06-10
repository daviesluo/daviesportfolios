// Per-position portfolio rollup ("computeMetrics") + formation
// detection. The numbers on the scoreboard, the heatmap tile sizes,
// and the position drill modal all come from here. Lifted out of
// the since-retired utils.js barrel so a test/file that only cares about the math doesn't
// pull in fetch plumbing / market hours / Storage.

import { fxRateToUSD } from './fx.js';
import { isUsEquity, isEuroExchange } from './ticker_class.js';
import { lseIsOpen, euroExchangeIsOpen } from './market_hours.js';

// Yahoo's `postMarketPrice` for OTC ADRs like SFTBY is bogus — it
// ships today's regular-session OPEN as if it were an after-hours
// quote, even though SFTBY doesn't actually trade AH. The result on
// the home page was a +8 % "AH move" the ticker never made.
//
// FALLBACK ONLY. The primary verdict is `h.extPriceTrusted`, set by
// the app's refresh path from the real intraday series
// (`extPriceIsRealAh` in indicators.js — the same check the chart
// modal runs), which has no divergence cap and accepts an honest
// >5 % earnings-night AH move. This quote-only heuristic is consulted
// only while that verdict is missing: the first paint before a
// refresh completes, or an ext-series fetch failure. Within that
// window a real >5 % AH move reads as flat on the tactics board —
// self-correcting on the next refresh tick, and the modal (which
// fetches its own series) shows the true move all along.
//
// 5 % threshold: real AH quotes usually sit within a couple of
// percent of the regular close; the SFTBY-shape bug spikes 8 %+.
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
      // LSE-only gate for the ext-hours toggle. LSE has no US-style
      // pre/after session, so when the toggle is on the row should
      // show the live LSE intraday pct ONLY while LSE itself is
      // currently trading (08:00-16:30 UK — covers US pre-market and
      // the first hour of US RTH). Outside LSE hours (US after-hours
      // / overnight / night-market for the East-Asia user) it should
      // read 0 — there is literally no movement happening. Without
      // this gate the toggle painted the stale LSE close pct as
      // "extended-hours" 24/7, which is what surfaced as the
      // "VUAG.L / SEGM.L show non-zero ext-hours at midnight" bug.
      const isLse = typeof t === 'string' && t.endsWith('.L');
      const lseSuppress = ext && !isCash && isLse && !lseIsOpen();
      // Same gate for euro-zone listings (.PA / .DE / .MI / …): no
      // US-style pre/after session, so when the toggle is on and the
      // local exchange is closed the row reads 0 instead of the stale
      // last-close pct. XFAB.PA before the Euronext open is the case
      // that prompted this — identical treatment to the .L ETFs.
      const isEuro = isEuroExchange(t);
      const euroSuppress = ext && !isCash && isEuro && !euroExchangeIsOpen();
      const sessionSuppress = lseSuppress || euroSuppress;
      let pct;
      if (extActive) {
        pct = (trustExt && h.extDayPct != null ? h.extDayPct : 0);
      } else if (sessionSuppress) {
        pct = 0;
      } else {
        pct = (h.dayPct ?? 0);
      }
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
      //   - sessionSuppress (LSE/euro ticker, ext-on, local exchange
      //     closed) → current priceNative → dayChange = 0 too. These
      //     venues have no movement when their own session is closed,
      //     and the toggle visually promises "extended-hours" which
      //     doesn't exist for them.
      //   - ext-off → yesterday's prevClose, the full-session move.
      const baselinePrice = extActive
        ? (h.lastPrice ?? h.prevClose ?? priceNative)
        : sessionSuppress
          ? priceNative
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
