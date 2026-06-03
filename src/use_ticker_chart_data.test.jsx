// Unit tests for the price-series data hook extracted from the modal.
// The pure deps (ytd / cache / indicators / ticker_class / helpers) run
// for real; the network + stores are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const chartMem = new Map();
const maMem = new Map();
vi.mock('./chart_store.js', () => ({
  ChartStore: { get: (k) => chartMem.get(k) ?? null, set: (k, v) => chartMem.set(k, v) },
  MaStore:    { get: (k) => maMem.get(k) ?? null,    set: (k, v) => maMem.set(k, v) },
}));
const fetchHistoricalBatch = vi.fn();
vi.mock('./historical.js', () => ({ fetchHistoricalBatch: (...a) => fetchHistoricalBatch(...a) }));
vi.mock('./yahoo_fetch.js', () => ({ fetchFundamentals: vi.fn(() => Promise.resolve({})) }));
vi.mock('./overnight_intraday.js', () => ({
  getOvernightSeries: () => [],
  fetchOvernightSeries: vi.fn(() => Promise.resolve({})),
  OVERNIGHT_FETCH_EVENT: 'overnight:fetched',
}));

import { useTickerChartData } from './use_ticker_chart_data.js';
import { tickerChartCacheKey } from './cache.js';

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
