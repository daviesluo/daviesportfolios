import { describe, it, expect, vi } from 'vitest';
import { CHUNK_ERROR_RE, RECOVERY_KEY, chunkUrlFromError, healAndReload, healRejection, isChunkLoadError, shouldHeal } from './chunk_recovery.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

describe('a chunk that does not arrive', () => {
  it('is recognised in every browser\'s words, and in the nosniff refusal production produced', () => {
    for (const msg of [
      "Failed to fetch dynamically imported module: https://daviesluo.com/assets/ticker_chart_modal-510f18a2.js",
      "'text/html' is not a valid JavaScript MIME type for module script 'https://daviesluo.com/assets/ticker_chart_modal-510f18a2.js'.",
      'Importing a module script failed.',
      'error loading dynamically imported module: https://daviesluo.com/assets/agents-12d5c754.js',
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ]) expect(isChunkLoadError(new Error(msg))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(CHUNK_ERROR_RE.test('Load failed')).toBe(false);          // a data fetch, not a chunk
  });
  it('pulls the chunk URL out of the message when the browser gave one', () => {
    expect(chunkUrlFromError(new Error("'text/html' is not a valid JavaScript MIME type for module script 'https://daviesluo.com/assets/x-1.js'."))).toBe('https://daviesluo.com/assets/x-1.js');
    expect(chunkUrlFromError(new Error('Importing a module script failed.'))).toBeNull();
  });
  it('heals once per window: the second failure inside it is shown, not retried', () => {
    const s = mem();
    expect(shouldHeal(s, 1_000_000)).toBe(true);
    s.setItem(RECOVERY_KEY, '1000000');
    expect(shouldHeal(s, 1_000_000 + 60e3)).toBe(false);
    expect(shouldHeal(s, 1_000_000 + 6 * 60e3)).toBe(true);
    expect(shouldHeal({ getItem: () => { throw new Error('blocked'); } }, 5)).toBe(true);
  });
  it('refreshes the browser\'s copy, drops every worker and cache, reports, and reloads — in that order, each step optional', async () => {
    const calls = [];
    const s = mem();
    const err = new Error("Failed to fetch dynamically imported module: https://daviesluo.com/assets/holdings_list-2d8a66f3.js");
    const out = await healAndReload(err, {
      storage: s, nowMs: 42,
      fetchImpl: vi.fn(async (url, init) => { calls.push(['fetch', url, init.cache]); return { ok: true }; }),
      sw: { getRegistrations: async () => [{ unregister: async () => calls.push(['unregister']) }, { unregister: async () => calls.push(['unregister']) }] },
      cacheStore: { keys: async () => ['workbox-precache-v2', 'google-fonts'], delete: async (k) => calls.push(['delete', k]) },
      report: (kind, opts) => calls.push(['report', kind, opts.context.url]),
      reload: () => calls.push(['reload']),
    });
    expect(out).toBe('reloading');
    expect(calls).toEqual([
      ['fetch', 'https://daviesluo.com/assets/holdings_list-2d8a66f3.js', 'reload'],
      ['unregister'], ['unregister'],
      ['delete', 'workbox-precache-v2'], ['delete', 'google-fonts'],
      ['report', 'chunk.load', 'https://daviesluo.com/assets/holdings_list-2d8a66f3.js'],
      ['reload'],
    ]);
    expect(s.getItem(RECOVERY_KEY)).toBe('42');
    // The same failure a minute later, same browser: no second reload.
    const again = await healAndReload(err, { storage: s, nowMs: 42 + 60e3, reload: () => calls.push(['reload']) });
    expect(again).toBe('gave-up');
    expect(calls.filter((c) => c[0] === 'reload')).toHaveLength(1);
  });
  it('a browser with no service worker, no caches and no URL in the message still gets the reload', async () => {
    const calls = [];
    const out = await healAndReload(new Error('Importing a module script failed.'), {
      storage: mem(), nowMs: 1, fetchImpl: vi.fn(), sw: undefined, cacheStore: undefined, report: () => {}, reload: () => calls.push('reload'),
    });
    expect(out).toBe('reloading');
    expect(calls).toEqual(['reload']);
  });
});

describe('healRejection', () => {
  it('heals a chunk failure that arrives as an unhandled rejection, and leaves every other rejection alone', async () => {
    const storage = { getItem: () => null, setItem: () => {} };
    const calls = [];
    const deps = {
      storage, nowMs: 1_000_000,
      fetchImpl: async () => { calls.push('fetch'); return new Response(''); },
      sw: { getRegistrations: async () => [] },
      cacheStore: { keys: async () => [], delete: async () => true },
      reload: () => calls.push('reload'),
      report: (kind) => calls.push(`report:${kind}`),
    };
    const chunkErr = new TypeError("Failed to fetch dynamically imported module: https://x/assets/agents-1.js");
    expect(await healRejection(chunkErr, deps)).toBe(true);
    expect(calls).toContain('reload');
    expect(calls).toContain('report:chunk.load');
    calls.length = 0;
    expect(await healRejection(new Error('some ordinary failure'), deps)).toBe(false);
    expect(calls).toEqual([]);
    expect(await healRejection(undefined, deps)).toBe(false);
  });
});
