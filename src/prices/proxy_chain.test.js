// Pins mapWithConcurrency — the bounded fan-out used by the per-ticker
// proxy fallbacks. Each ticker's fallback races all 5 proxies at once,
// so an unbounded map over a 30-ticker portfolio fired ~150 fetches the
// moment the Edge Function was down — enough for Chromium to reject
// them with net::ERR_INSUFFICIENT_RESOURCES and turn a degraded refresh
// into a totally failed one (observed in the 2026-07 cold-start
// investigation's browser reproduction).
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './proxy_chain.js';

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` callbacks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 6, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1); // it IS still concurrent
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it('preserves input order in the results regardless of completion order', async () => {
    const out = await mapWithConcurrency([30, 5, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 5, 20]);
  });

  it('handles empty input and limit larger than the item count', async () => {
    expect(await mapWithConcurrency([], 6, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n)).toEqual([1, 2]);
  });
});
