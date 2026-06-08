// Pure module-scope constants + helpers lifted out of
// ticker_chart_modal.jsx (which had grown past 1500 lines). These are
// all dependency-light and side-effect-free apart from the two cache
// wrappers, so they live here where they can be imported by the modal
// and pinned by tests without mounting React. The component's effects /
// geometry / render still live in the modal itself.

import { fmtPrice as fmtPr } from './formatters.js';
import { ChartStore } from './chart_store.js';

export const SYMBOL_BY_CUR = { USD: '$', GBP: '£', CNY: '¥', HKD: 'HK$', EUR: '€' };

// Bar interval per intraday range, for the overnight live-dot's
// time-proportional gap (chart_geometry.overnightTrailingGap) and the
// 1W/1M overnight-point downsample. Only these three ranges get the
// dot; ratio ranges / 3M / YTD / 1Y don't.
export const NIGHT_BAR_INTERVAL_MS = { '1D': 5 * 60_000, '1W': 30 * 60_000, '1M': 60 * 60_000 };

// Friendly modal-title names for non-stock tickers. Stocks just show
// the ticker symbol since the company name isn't carried anywhere in
// the holdings shape; indices/futures/forex/yields all have ASCII
// tickers that mean nothing to a human and benefit from a label.
export const TICKER_DISPLAY_NAMES = {
  '^GSPC':    'S&P 500',
  '^NDX':     'NASDAQ 100',
  '^RUT':     'Russell 2000',
  '^SOX':     'PHLX SOX',
  '^VIX':     'VIX',
  '^TNX':     'US 10Y Yield',
  'BZ=F':     'Brent Oil',
  'ES=F':     'S&P Futures',
  'NQ=F':     'Nasdaq Futures',
  'RTY=F':    'R2K Futures',
  'GBPUSD=X': 'GBP/USD',
  'GBPCNY=X': 'GBP/CNY',
  'USDCNY=X': 'USD/CNY',
};

// Indices we still surface a P/E 1Y chart for, via the fundamentals
// Edge Function's INDEX_ETF_PROXY mapping (^GSPC→SPY, ^NDX→QQQ,
// ^RUT→IWM, ^SOX→SOXX). Other ^-prefixed tickers (^VIX, ^TNX) don't
// have a meaningful EPS so the button stays hidden.
export const INDEX_PE_ALLOWED = new Set(['^GSPC', '^NDX', '^RUT', '^SOX']);

const FX_4DP = new Set(['GBPUSD=X', 'GBPCNY=X', 'USDCNY=X']);

// Per-ticker price formatter. Indices / futures / forex / yields don't
// carry a currency symbol; yields are rendered as percentages; the two
// FX pairs the app shows always need 4 dp. Stocks fall through to the
// currency-prefixed format the modal had before.
export function fmtTickerPrice(price, ticker, sym) {
  if (price == null || !isFinite(price)) return '—';
  if (ticker === '^TNX') return price.toFixed(2) + '%';
  if (FX_4DP.has(ticker)) return price.toFixed(4);
  if (/=X$/.test(ticker)) return price.toFixed(4);
  if (/^\^/.test(ticker) || /=F$/.test(ticker)) return fmtPr(price);
  return `${sym}${fmtPr(price)}`;
}

// Per-range cache TTL, matched to each range's bar interval so we don't
// refetch faster than the source can publish a new bar:
//   1D → 5 m · 1W → 30 m · 1M → 1 h · 3M/YTD/1Y → 12 h
export function modalTtl(rangeKey) {
  if (rangeKey === '1D') return  5 * 60 * 1000;
  if (rangeKey === '1W') return 30 * 60 * 1000;
  if (rangeKey === '1M') return 60 * 60 * 1000;
  return                       12 * 60 * 60 * 1000;
}

// Cache I/O routes through `ChartStore` (chart_store.js), IndexedDB-
// backed with a synchronous in-memory mirror. Reads stay sync (the
// modal's useState initializer reads on first paint); writes update the
// mirror immediately and persist to IDB in the background.
export function modalCacheGet(key) {
  return ChartStore.get(key); // { ts, data } | null
}
export function modalCacheSet(key, data) {
  ChartStore.set(key, { ts: Date.now(), data });
}
