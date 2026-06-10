// Pins for the CN-fund range trim. Both the danjuanapp and xueqiu
// endpoints return ~500 daily bars regardless of the chart range, so
// trimCnFundToRange is what makes 1M / 3M / YTD actually differ — the
// bug that originally shipped was every range rendering identical
// multi-year data. (fetchHistoricalBatch's Edge/proxy strategy is
// pinned separately in utils.test.js.)
import { describe, it, expect } from 'vitest';
import { trimCnFundToRange } from './historical.js';

const DAY = 86_400_000;
const ymd = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

// Wide margins on either side of each cutoff so the local-vs-UTC
// midnight fuzz in the comparison can't flip a case.
const OLD = { date: ymd(400 * DAY), close: 1 };   // ~13 months ago
const MID = { date: ymd(50 * DAY), close: 2 };    // ~7 weeks ago
const NEW = { date: ymd(10 * DAY), close: 3 };    // ~10 days ago
const points = [OLD, MID, NEW];

describe('trimCnFundToRange', () => {
  it('passes through empty / non-array inputs untouched', () => {
    expect(trimCnFundToRange([], '1mo')).toEqual([]);
    expect(trimCnFundToRange(/** @type {any} */ (null), '1mo')).toBeNull();
  });

  it('keeps everything for an unknown range', () => {
    expect(trimCnFundToRange(points, '5y')).toBe(points);
  });

  it('1mo keeps only the last ~35 days', () => {
    const out = trimCnFundToRange(points, '1mo');
    expect(out).toEqual([NEW]);
  });

  it('3mo keeps the last ~100 days', () => {
    const out = trimCnFundToRange(points, '3mo');
    expect(out).toEqual([MID, NEW]);
  });

  it('1y keeps the last ~380 days (drops the 400-day-old bar)', () => {
    const out = trimCnFundToRange(points, '1y');
    expect(out).toEqual([MID, NEW]);
    // case-insensitive on the range label
    expect(trimCnFundToRange(points, '1Y')).toEqual([MID, NEW]);
  });

  it('ytd keeps current-year bars (Jan-1 minus a 7-day grace)', () => {
    const jan2 = `${new Date().getFullYear()}-01-02`;
    const lastYearMid = `${new Date().getFullYear() - 1}-06-15`;
    const out = trimCnFundToRange(
      [{ date: lastYearMid, close: 1 }, { date: jan2, close: 2 }],
      'ytd',
    );
    expect(out).toEqual([{ date: jan2, close: 2 }]);
  });

  it('returns the original (not an empty array) when the cutoff would drop everything', () => {
    // All bars older than the 1mo cutoff → the trim would empty the
    // series, so it falls back to the full set rather than a blank chart.
    const allOld = [OLD, { date: ymd(420 * DAY), close: 0.5 }];
    expect(trimCnFundToRange(allOld, '1mo')).toBe(allOld);
  });
});

// Pins the 200-wrapped-proxy-error backoff on the chart-history race:
// a proxy that answers 200 with its own error JSON (no Yahoo `chart`
// envelope) must get benched, not silently lose the race and re-enter
// the next one. See yahoo_fetch.test.js for the quote-path twin.
describe('fetchHistorical — proxies answering 200 with a non-Yahoo body get benched', () => {
  it('returns null and backs off every poisoned proxy', async () => {
    const { fetchHistorical } = await import('./historical.js');
    const { PROXIES, proxyIsAvailable, clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    const origFetch = globalThis.fetch;
    globalThis.fetch = /** @type {any} */ (async () => ({
      ok: true,
      json: async () => ({ status: 429, message: 'proxy rate limit' }),
    }));
    try {
      expect(await fetchHistorical('NVDA', 'ytd', '1d')).toBe(null);
      for (let i = 0; i < PROXIES.length; i++) expect(proxyIsAvailable(i)).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      clearProxyBackoff();
    }
  });
});
