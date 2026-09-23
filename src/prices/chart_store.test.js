// Pins for the IDB chart-cache pruning wired up in 2026-06 (the
// `pruneOlderThan` method existed but was never called, so the three
// stores grew unbounded). In vitest there's no `indexedDB`, so the
// stores run mem-only — which is exactly the in-memory mirror these
// assertions exercise.
import { describe, it, expect, beforeEach } from 'vitest';
import { ChartStore, MaStore, YtdStore, pruneAllChartStores } from './chart_store.js';

const DAY = 24 * 60 * 60 * 1000;

describe('chart store pruning', () => {
  beforeEach(async () => {
    await ChartStore._resetForTest();
    await MaStore._resetForTest();
    await YtdStore._resetForTest();
  });

  it('pruneOlderThan drops entries older than the cutoff, keeps fresher ones', () => {
    const now = Date.now();
    ChartStore.set('OLD', { ts: now - 40 * DAY, data: [1, 2] });
    ChartStore.set('NEW', { ts: now - 1 * DAY, data: [1, 2] });
    ChartStore.pruneOlderThan(now - 30 * DAY);
    expect(ChartStore.get('OLD')).toBeNull();
    expect(ChartStore.get('NEW')).not.toBeNull();
  });

  it('pruneAllChartStores evicts 30-days-stale entries across all three stores', () => {
    const now = Date.now();
    const stale = now - 31 * DAY;
    const fresh = now - 2 * DAY;
    for (const s of [ChartStore, MaStore, YtdStore]) {
      s.set('STALE', { ts: stale, data: [1, 2] });
      s.set('FRESH', { ts: fresh, data: [1, 2] });
    }
    pruneAllChartStores();
    for (const s of [ChartStore, MaStore, YtdStore]) {
      expect(s.get('STALE')).toBeNull();
      expect(s.get('FRESH')).not.toBeNull();
    }
  });

  it('treats a missing ts as epoch-0 → pruned (defensive against malformed rows)', () => {
    ChartStore.set('NOTS', /** @type {any} */ ({ data: [1, 2] }));
    ChartStore.pruneOlderThan(Date.now() - 30 * DAY);
    expect(ChartStore.get('NOTS')).toBeNull();
  });
});
