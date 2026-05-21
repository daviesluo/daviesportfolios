// Utilities barrel. Historically a 933 LoC god module; split out
// piece by piece into named modules (see imports below). Kept as a
// thin re-export shim so existing consumers don't need to update
// their `import { X } from './utils.js'` lines in one go — new code
// should prefer importing from the target module directly.

// -------- Storage --------------------------------------------------
// localStorage `dp.*` namespace + schema migration. See src/storage.js
// for the full surface.
export { Storage } from './storage.js';

// -------- Formatters ------------------------------------------------
// maskDigits / fmtMoney / fmtPct / fmtPrice / pctColor / formatAgo.
// See src/formatters.js.
export { maskDigits, fmtMoney, fmtPct, fmtPrice, pctColor, formatAgo } from './formatters.js';

// -------- Market time / phase --------------------------------------
// londonTimeParts / usMarketPhase / ukTzAbbr / usMarketHoursUtc.
// See src/market_hours.js.
export {
  londonTimeParts,
  usMarketPhase,
  ukTzAbbr,
  usMarketHoursUtc,
  lseIsOpen,
  isWeekendDeadZone,
} from './market_hours.js';

// -------- Currency / FX --------------------------------------------
// detectCurrency / currencySymbol / fxRateToUSD / fxToUSD. See
// src/fx.js.
export { detectCurrency, currencySymbol, fxRateToUSD, fxToUSD } from './fx.js';

// -------- Portfolio metrics ----------------------------------------
// computeMetrics / detectFormation — the per-render rollup of
// holdings × marketData → marketValue / dayChange / per-position
// breakdowns / fxMissingTickers. See src/metrics.js.
export { computeMetrics, detectFormation } from './metrics.js';

// -------- Public CORS proxy chain ----------------------------------
// PROXIES + per-proxy backoff cache. See src/proxy_chain.js.
export {
  PROXY_BACKOFF_MS,
  proxyIsAvailable,
  markProxyDead,
  clearProxyBackoff,
  _proxyBackoffSnapshot,
} from './proxy_chain.js';

// -------- Live price fetch (Edge + proxy fallback) -----------------
// refreshPrices / fetchTickers / fetchFundamentals. See
// src/yahoo_fetch.js.
export { refreshPrices, fetchTickers, fetchFundamentals } from './yahoo_fetch.js';

// -------- Historical chart data + CN-fund variant ------------------
// fetchHistorical / fetchHistoricalBatch / fetchTodayRegularClose.
// See src/historical.js.
export { fetchHistorical, fetchHistoricalBatch, fetchTodayRegularClose } from './historical.js';

// -------- Position coordinates on 100x100 pitch --------------------
// (home team attacks UP; GK at bottom). Used by Pitch / Heatmap.
export const POSITION_COORDS = {
  GK:  { x: 50, y: 91 },
  CB1: { x: 38, y: 76 },
  CB2: { x: 62, y: 76 },
  LB:  { x: 15, y: 70 },
  RB:  { x: 85, y: 70 },
  CDM: { x: 50, y: 58 },
  CM:  { x: 30, y: 44 },
  CAM: { x: 70, y: 44 },
  LW:  { x: 15, y: 22 },
  ST:  { x: 50, y: 15 },
  RW:  { x: 85, y: 22 },
};
