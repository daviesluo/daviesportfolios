// Unit tests for the valuation-metadata hook extracted from the modal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const store = new Map();
vi.mock('./chart_store.js', () => ({
  ChartStore: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v) },
}));
const fetchFundamentals = vi.fn();
vi.mock('./yahoo_fetch.js', () => ({ fetchFundamentals: (...a) => fetchFundamentals(...a) }));

import { useTickerFundamentals } from './use_ticker_fundamentals.js';

beforeEach(() => { store.clear(); fetchFundamentals.mockReset(); });

describe('useTickerFundamentals', () => {
  it('non-supported ticker → all null/false and no fetch', async () => {
    fetchFundamentals.mockResolvedValue({});
    const { result } = renderHook(() => useTickerFundamentals('^VIX', false));
    expect(result.current.peSupported).toBe(false);
    expect(result.current.psSupported).toBe(false);
    expect(result.current.sharesOut).toBe(null);
    await waitFor(() => expect(fetchFundamentals).not.toHaveBeenCalled());
  });

  it('profitable stock → peSupported, with 3yAvg / PEG / sharesOut from the fetch', async () => {
    fetchFundamentals.mockResolvedValue({ NVDA: { eps: 5, pe: 30, pe3yAvg: 40, peg: 1.5, sharesOutstanding: 1e9 } });
    const { result } = renderHook(() => useTickerFundamentals('NVDA', true));
    await waitFor(() => expect(result.current.peSupported).toBe(true));
    expect(result.current.psSupported).toBe(false);
    expect(result.current.pe3yAvg).toBe(40);
    expect(result.current.peg).toBe(1.5);
    expect(result.current.sharesOut).toBe(1e9);
    // writes the row back to the FUND cache for the next open
    expect(store.get('NVDA|FUND|v3')?.data?.pe).toBe(30);
  });

  it('loss-maker (eps≤0, pe≤0, ps>0) → psSupported, peSupported false', async () => {
    fetchFundamentals.mockResolvedValue({ NBIS: { eps: 0, pe: 0, ps: 8, ps3yAvg: 12 } });
    const { result } = renderHook(() => useTickerFundamentals('NBIS', true));
    await waitFor(() => expect(result.current.psSupported).toBe(true));
    expect(result.current.peSupported).toBe(false);
    expect(result.current.ps3yAvg).toBe(12);
  });

  it('seeds synchronously from the FUND cache on the very first render', () => {
    store.set('AAPL|FUND|v3', { ts: Date.now(), data: { eps: 6, pe: 25, sharesOutstanding: 5e8 } });
    fetchFundamentals.mockResolvedValue({});
    const { result } = renderHook(() => useTickerFundamentals('AAPL', true));
    expect(result.current.peSupported).toBe(true);   // before the effect runs
    expect(result.current.sharesOut).toBe(5e8);
  });

  it('a transient empty fetch response does NOT clobber a good seed', async () => {
    store.set('AAPL|FUND|v3', { ts: Date.now(), data: { eps: 6, pe: 25 } });
    fetchFundamentals.mockResolvedValue({}); // no row for AAPL
    const { result } = renderHook(() => useTickerFundamentals('AAPL', true));
    await waitFor(() => expect(fetchFundamentals).toHaveBeenCalled());
    expect(result.current.peSupported).toBe(true); // seed survives
  });
});
