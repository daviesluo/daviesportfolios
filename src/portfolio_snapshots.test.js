// The 5-minute sampler behind Investment Performance.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  snapshotBucket, saveSnapshot, loadSnapshots, SNAPSHOT_INTERVAL_MS,
  RANGE_BUCKET_SECONDS, snapshotCacheKey, readCachedSnapshots, refreshSnapshots,
} from './portfolio_snapshots.js';
import { YtdStore } from './chart_store.js';

vi.mock('./chart_store.js', () => {
  const m = new Map();
  return { YtdStore: {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => m.set(k, v),
    del: (k) => m.delete(k),
    keys: () => [...m.keys()],
    pruneOlderThan: () => {},
  } };
});

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; sessionStorage.clear(); });

describe('snapshotBucket', () => {
  it('floors to the 5-minute bucket so concurrent devices collide on purpose', () => {
    const base = Date.parse('2026-08-14T14:30:00Z');
    // 14:32 and 14:34 from two devices must land on the SAME row — the
    // bucket is the table's primary key, so they upsert over each other
    // instead of stacking two near-identical points.
    expect(snapshotBucket(base + 2 * 60_000)).toBe(base);
    expect(snapshotBucket(base + 4 * 60_000 + 59_000)).toBe(base);
    // …and 14:35 starts the next one.
    expect(snapshotBucket(base + 5 * 60_000)).toBe(base + SNAPSHOT_INTERVAL_MS);
  });
});

describe('saveSnapshot', () => {
  it('posts the bucketed timestamp with the app token', async () => {
    sessionStorage.setItem('dp.token', 'tok.sig');
    const calls = [];
    globalThis.fetch = /** @type {any} */ (vi.fn(async (url, opts) => {
      calls.push([String(url), opts]); return { ok: true, json: async () => ({ ok: true }) };
    }));
    const at = Date.parse('2026-08-14T14:32:10Z');
    expect(await saveSnapshot(1234.5, 1000, at)).toBe(true);
    const [url, opts] = calls[0];
    expect(url).toContain('action=snapshot');
    expect(opts.headers['X-App-Token']).toBe('tok.sig');
    const body = JSON.parse(opts.body);
    expect(body.ts).toBe(Date.parse('2026-08-14T14:30:00Z'));
    expect(body.valueUsd).toBe(1234.5);
    expect(body.depositUsd).toBe(1000);
  });

  it('refuses to record a not-yet-loaded board', async () => {
    // A zero value means the portfolio hasn't landed; recording it would
    // punch a hole in the chart at the moment the user opened the app.
    globalThis.fetch = /** @type {any} */ (vi.fn());
    expect(await saveSnapshot(0, 0)).toBe(false);
    expect(await saveSnapshot(NaN, 100)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('swallows a failed write — the next tick carries an equally good number', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(saveSnapshot(100, 90)).resolves.toBe(false);
  });
});

describe('loadSnapshots', () => {
  it('maps rows to epoch ms, ascending, dropping malformed ones', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
      ok: true,
      json: async () => ({ snapshots: [
        { ts: '2026-08-14T14:35:00Z', value_usd: 110, deposit_usd: 100 },
        { ts: '2026-08-14T14:30:00Z', value_usd: 105, deposit_usd: 100 },
        { ts: 'not-a-date', value_usd: 1, deposit_usd: 1 },
        { ts: '2026-08-14T14:40:00Z', value_usd: null, deposit_usd: 100 },
      ] }),
    })));
    const out = await loadSnapshots(Date.parse('2026-08-14T00:00:00Z'));
    expect(out.map(r => r.value)).toEqual([105, 110]);
  });

  it('returns empty on failure so the chart falls back to the ledger', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await loadSnapshots(1)).toEqual([]);
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => { throw new Error('x'); }));
    expect(await loadSnapshots(1)).toEqual([]);
  });
});

describe('range buckets + cache', () => {
  it('asks for a coarser point the longer the window is', () => {
    // The server returns the LAST sample per bucket, so this is what
    // keeps a YTD read to a few hundred rows instead of the ~60k that
    // 5-minute sampling actually stores. An ascending LIMIT over the raw
    // table returned January and dropped everything recent.
    expect(RANGE_BUCKET_SECONDS['1D']).toBe(300);
    const order = ['1D', '1W', '1M', '3M', 'YTD'].map(k => RANGE_BUCKET_SECONDS[k]);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('sends the range\'s bucket to the server', async () => {
    const calls = [];
    globalThis.fetch = /** @type {any} */ (vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ snapshots: [] }) };
    }));
    await loadSnapshots(1000, RANGE_BUCKET_SECONDS['YTD']);
    expect(calls[0]).toContain('bucket=86400');
  });

  it('caches a non-empty read so the panel paints on first render', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
      ok: true,
      json: async () => ({ snapshots: [
        { ts: '2026-08-14T14:30:00Z', value_usd: 105, deposit_usd: 100 },
        { ts: '2026-08-14T14:35:00Z', value_usd: 110, deposit_usd: 100 },
      ] }),
    })));
    expect(readCachedSnapshots('1D')).toBeNull();
    await refreshSnapshots('1D', 1000);
    expect(readCachedSnapshots('1D')?.map(r => r.value)).toEqual([105, 110]);
    expect(YtdStore.get(snapshotCacheKey('1D'))).toBeTruthy();
  });

  it('never caches an EMPTY read over a good one', async () => {
    // Empty is ambiguous — no samples yet, or a failed request — and
    // caching it would blank a panel that had good points a moment ago.
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
      ok: true, json: async () => ({ snapshots: [] }),
    })));
    await refreshSnapshots('1W', 1000);
    expect(readCachedSnapshots('1W')).toBeNull();
  });
});
