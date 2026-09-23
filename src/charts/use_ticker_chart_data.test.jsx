// Unit tests for the price-series data hook extracted from the modal.
// The pure deps (ytd / cache / indicators / ticker_class / helpers) run
// for real; the network + stores are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const chartMem = new Map();
const maMem = new Map();
vi.mock('../prices/chart_store.js', () => ({
  ChartStore: { get: (k) => chartMem.get(k) ?? null, set: (k, v) => chartMem.set(k, v) },
  MaStore:    { get: (k) => maMem.get(k) ?? null,    set: (k, v) => maMem.set(k, v) },
}));
const fetchHistoricalBatch = vi.fn();
vi.mock('../prices/historical.js', () => ({ fetchHistoricalBatch: (...a) => fetchHistoricalBatch(...a) }));
vi.mock('../prices/yahoo_fetch.js', () => ({ fetchFundamentals: vi.fn(() => Promise.resolve({})) }));
vi.mock('../prices/overnight_intraday.js', () => ({
  getOvernightSeries: () => [],
  fetchOvernightSeries: vi.fn(() => Promise.resolve({})),
  OVERNIGHT_FETCH_EVENT: 'overnight:fetched',
}));

import { useTickerChartData } from './use_ticker_chart_data.js';
import { tickerChartCacheKey } from '../prices/cache.js';

const BARS = [
  { date: '2026-05-28T13:30', close: 100, volume: 10 },
  { date: '2026-05-28T13:35', close: 101, volume: 12 },
];

const ARGS = (over = {}) => ({
  ticker: 'NVDA', rangeKey: '1D', useExt: false, phase: 'regular',
  dailyOnly: false, isRatioRange: false, extendedHours: false,
  visibleRangeKeys: ['1D'], ...over,
});

beforeEach(() => { chartMem.clear(); maMem.clear(); fetchHistoricalBatch.mockReset(); });

describe('useTickerChartData', () => {
  it('seeds series from a warm cache → no spinner on first render', () => {
    chartMem.set(tickerChartCacheKey('NVDA', '1D', false, 'regular'), { ts: Date.now(), data: BARS });
    fetchHistoricalBatch.mockResolvedValue({});
    const { result } = renderHook(() => useTickerChartData(ARGS()));
    expect(result.current.loading).toBe(false);
    expect(result.current.series).toHaveLength(2);
  });

  it('cold cache → fetches, populates series, clears loading', async () => {
    fetchHistoricalBatch.mockResolvedValue({ NVDA: BARS });
    const { result } = renderHook(() => useTickerChartData(ARGS()));
    expect(result.current.loading).toBe(true);          // first paint
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.series).toEqual(BARS);
    expect(result.current.error).toBe(false);
  });

  it('all fetch attempts empty → error state', async () => {
    fetchHistoricalBatch.mockResolvedValue({});         // never returns NVDA
    const { result } = renderHook(() => useTickerChartData(ARGS()));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.series).toBe(null);
  });

  it('returns the documented shape', () => {
    fetchHistoricalBatch.mockResolvedValue({});
    const { result } = renderHook(() => useTickerChartData(ARGS()));
    expect(Object.keys(result.current).sort()).toEqual(
      ['error', 'loading', 'maHistory', 'noPe', 'overnightPts', 'series'],
    );
  });
});

// The open modal polled every 5 s for as long as it stayed open: no
// visibility gate and no market gate. A modal forgotten in a background
// tab over a weekend is tens of thousands of Edge calls and a
// measurable slice of the phone's battery, for a chart nobody is
// looking at and a tape that is not moving.
describe('useTickerChartData — the 1D poll stops when there is nothing to watch', () => {
  const warm = (ticker = 'NVDA', phase = 'regular') => {
    chartMem.set(tickerChartCacheKey(ticker, '1D', false, phase), { ts: Date.now(), data: BARS });
    fetchHistoricalBatch.mockResolvedValue({ [ticker]: BARS });
  };
  /** Drive the poll's self-rearming 5 s timer forward. */
  const tick = async (ms = 6000) => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  const setHidden = (hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => { vi.useFakeTimers(); setHidden(false); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  it('polls while the page is visible and the US session is open', async () => {
    warm();
    renderHook(() => useTickerChartData(ARGS()));
    const before = fetchHistoricalBatch.mock.calls.length;
    await tick();
    expect(fetchHistoricalBatch.mock.calls.length).toBeGreaterThan(before);
  });

  it('stops while the tab is hidden, and picks up again when it is shown', async () => {
    warm();
    const { rerender } = renderHook(() => useTickerChartData(ARGS()));
    await tick();
    setHidden(true);
    rerender();
    const whileHidden = fetchHistoricalBatch.mock.calls.length;
    await tick(60_000);
    expect(fetchHistoricalBatch.mock.calls.length).toBe(whileHidden);
    setHidden(false);
    rerender();
    await tick();
    expect(fetchHistoricalBatch.mock.calls.length).toBeGreaterThan(whileHidden);
  });

  it('stops overnight for a name with no overnight session', async () => {
    // SFTBY is in `NO_OVERNIGHT_SESSION` — an OTC ADR that does not
    // trade the T212 overnight window. A plain US equity like NVDA does,
    // so it keeps polling all night on purpose; picking it here would
    // have tested nothing.
    warm('SFTBY', 'overnight');
    renderHook(() => useTickerChartData(ARGS({ ticker: 'SFTBY', phase: 'overnight' })));
    const before = fetchHistoricalBatch.mock.calls.length;
    await tick(60_000);
    expect(fetchHistoricalBatch.mock.calls.length).toBe(before);
  });

  it('keeps polling overnight for crypto, which never closes', async () => {
    warm('BTC-USD', 'overnight');
    renderHook(() => useTickerChartData(ARGS({ ticker: 'BTC-USD', phase: 'overnight' })));
    const before = fetchHistoricalBatch.mock.calls.length;
    await tick();
    expect(fetchHistoricalBatch.mock.calls.length).toBeGreaterThan(before);
  });
});
