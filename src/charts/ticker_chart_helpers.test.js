// Pins for the pure ticker-chart helpers extracted from the modal.
import { describe, it, expect } from 'vitest';
import {
  fmtTickerPrice, modalTtl, NIGHT_BAR_INTERVAL_MS, INDEX_PE_ALLOWED, TICKER_DISPLAY_NAMES,
  crosshairFormatFor,
} from './ticker_chart_helpers.js';
import { RANGES, maFetchParamsFor } from './ytd.js';
import { RANGE_TTL_MS } from '../prices/cache.js';
import { RANGE_BUCKET_SECONDS } from '../prices/price_snapshots.js';

describe('fmtTickerPrice', () => {
  it('renders ^TNX as a 2-dp percentage', () => {
    expect(fmtTickerPrice(4.235, '^TNX', '$')).toBe('4.24%');
  });
  it('renders FX pairs / =X tickers at 4 dp, no symbol', () => {
    expect(fmtTickerPrice(1.2735, 'GBPUSD=X', '$')).toBe('1.2735');
    expect(fmtTickerPrice(7.1, 'USDHKD=X', '$')).toBe('7.1000');
  });
  it('renders indices / futures without a currency prefix', () => {
    expect(fmtTickerPrice(5300, '^GSPC', '$')).not.toMatch(/^\$/);
    expect(fmtTickerPrice(5300, 'ES=F', '$')).not.toMatch(/^\$/);
  });
  it('prefixes plain equities with the currency symbol', () => {
    expect(fmtTickerPrice(123.4, 'NVDA', '$')).toBe('$123.40');
    expect(fmtTickerPrice(50, 'VOD.L', '£')).toBe('£50.00');
  });
  it('guards non-finite input', () => {
    expect(fmtTickerPrice(null, 'NVDA', '$')).toBe('—');
    expect(fmtTickerPrice(NaN, 'NVDA', '$')).toBe('—');
  });
});

describe('modalTtl', () => {
  it('matches each range bar interval', () => {
    expect(modalTtl('1D')).toBe(5 * 60 * 1000);
    expect(modalTtl('1W')).toBe(15 * 60 * 1000);
    expect(modalTtl('1M')).toBe(60 * 60 * 1000);
    expect(modalTtl('3M')).toBe(60 * 60 * 1000);
    expect(modalTtl('YTD')).toBe(12 * 60 * 60 * 1000);
    expect(modalTtl('1Y')).toBe(12 * 60 * 60 * 1000);
  });
});

// 1W's bar cadence is written down in five places for five different
// consumers — the fetch params, the MA overlay's wider fetch, the
// recorded-overnight downsample, and two cache TTLs. They were already
// out of step before this test existed: `RANGES` said 60m while a
// comment above PERF_CACHE_TTL_MS said 30m and `maFetchParamsFor` used
// 30m, so the MA line was computed over bars the chart never drew.
// Anything that means "how long is a 1W bar" has to agree.
describe('1W cadence — one interval, five call sites', () => {
  it('every consumer says 15 minutes', () => {
    expect(RANGES['1W'].interval).toBe('15m');
    expect(maFetchParamsFor('1W')?.interval).toBe('15m');
    expect(NIGHT_BAR_INTERVAL_MS['1W']).toBe(15 * 60_000);
    expect(modalTtl('1W')).toBe(15 * 60 * 1000);
    expect(RANGE_TTL_MS['1W']).toBe(15 * 60 * 1000);
  });
});

// Same discipline for 3M, which moved from daily bars to a four-hour
// sampling grid over 60-minute bars. Its numbers are of TWO kinds and
// the distinction is the point: the fetch/TTL family tracks the BAR
// interval (60 m), while the recorded-snapshot read bucket tracks the
// SAMPLING cadence (4 h), because that is what decides how many stored
// rows a grid point needs to choose between.
describe('3M cadence — bars at 60 m, samples every 4 h', () => {
  it('everything that means "how long is a 3M bar" says 60 minutes', () => {
    expect(RANGES['3M'].interval).toBe('60m');
    expect(maFetchParamsFor('3M')?.interval).toBe('60m');
    expect(modalTtl('3M')).toBe(60 * 60 * 1000);
    expect(RANGE_TTL_MS['3M']).toBe(60 * 60 * 1000);
  });

  it('the recorded-row read bucket is the four-hour sampling cadence', () => {
    expect(RANGE_BUCKET_SECONDS['3M']).toBe(4 * 3600);
    // Six of them a day, which is what the grid asks for.
    expect(24 * 3600 / RANGE_BUCKET_SECONDS['3M']).toBe(6);
  });

  it('3M stays out of the overnight-dot / overnight-splice set', () => {
    // Its overnight comes from price_snapshots, already on this grid;
    // overnight_intraday_points would be a second source at a second
    // resolution over 30 days of a 93-day window.
    expect(NIGHT_BAR_INTERVAL_MS['3M']).toBeUndefined();
  });
});

// The crosshair pill's format lives beside the other pure helpers
// because BOTH charts ask for it. It used to be inlined in the ticker
// modal as `1W || 1M`, so when 3M became intraday the performance
// panel's pill grew a time and the modal's kept showing a bare date
// under six points a day.
describe('crosshairFormatFor', () => {
  it('a minute-interval range other than 1D always carries a time', () => {
    for (const k of ['1W', '1M', '3M', 'YTD', '1Y']) {
      const intraday = /^\d+m$/.test(RANGES[k].interval);
      expect(crosshairFormatFor(k)).toBe(intraday ? 'datetime' : 'date');
    }
    expect(crosshairFormatFor('1D')).toBe('time');
  });
});

describe('static maps', () => {
  it('NIGHT_BAR_INTERVAL_MS only covers the intraday-dot ranges', () => {
    expect(Object.keys(NIGHT_BAR_INTERVAL_MS).sort()).toEqual(['1D', '1M', '1W']);
  });
  it('INDEX_PE_ALLOWED is the four ETF-proxied indices', () => {
    expect([...INDEX_PE_ALLOWED].sort()).toEqual(['^GSPC', '^NDX', '^RUT', '^SOX']);
  });
  it('TICKER_DISPLAY_NAMES labels the index/FX tickers', () => {
    expect(TICKER_DISPLAY_NAMES['^GSPC']).toBe('S&P 500');
    expect(TICKER_DISPLAY_NAMES['GBPUSD=X']).toBe('GBP/USD');
  });
});
