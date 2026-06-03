// Pins for the pure ticker-chart helpers extracted from the modal.
import { describe, it, expect } from 'vitest';
import {
  fmtTickerPrice, modalTtl, NIGHT_BAR_INTERVAL_MS, INDEX_PE_ALLOWED, TICKER_DISPLAY_NAMES,
} from './ticker_chart_helpers.js';

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
    expect(modalTtl('1W')).toBe(30 * 60 * 1000);
    expect(modalTtl('1M')).toBe(60 * 60 * 1000);
    expect(modalTtl('3M')).toBe(12 * 60 * 60 * 1000);
    expect(modalTtl('YTD')).toBe(12 * 60 * 60 * 1000);
    expect(modalTtl('1Y')).toBe(12 * 60 * 60 * 1000);
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
