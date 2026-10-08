// The unit tests' network guard (test_setup.js; review T1, 2026-10-08): four performance-chart test files sent 25 GETs
// a run to production's Edge Functions. A fetch to anything but this machine now rejects with the guard's own error and
// is recorded, so the test that made it fails when it ends; a stub replaces the guard for the test that wants one. The
// URLs here are on `.invalid`, a name that can never resolve, so even without the guard nothing would leave.
import { describe, it, expect, vi, afterEach } from 'vitest';

/** @type {() => string[]} */
const takeLeaked = /** @type {any} */ (globalThis).__takeLeakedFetches;

describe('test_setup.js — no test reaches the network', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('refuses a fetch to another host, with its own error, and records it for the end of the test', async () => {
    await expect(fetch('https://production.example.invalid/functions/v1/data?action=price-snapshots')).rejects.toThrow(/no test reaches the network/);
    await expect(fetch(new Request('https://production.example.invalid/x'))).rejects.toThrow(/no test reaches the network/);
    expect(takeLeaked()).toEqual(['https://production.example.invalid/functions/v1/data?action=price-snapshots', 'https://production.example.invalid/x']);
    expect(takeLeaked()).toEqual([]);                                // read once, cleared: this test ends clean
  });

  it('lets this machine through, refusing nothing', async () => {
    // Port 9 (discard) on the loopback: nothing listens, so the real fetch fails on its own, not on the guard.
    await expect(fetch('http://127.0.0.1:9/')).rejects.not.toThrow(/no test reaches the network/);
    expect(takeLeaked()).toEqual([]);
  });

  // The guard's whole point: a refused fetch the test swallows (as the app's code catches a failed fetch) still fails
  // the test when it ends. `it.fails` passes only because that failure happens.
  it.fails('a test that leaves a refused fetch behind fails when it ends', async () => {
    await fetch('https://production.example.invalid/w').catch(() => null);
  });

  it('gives way to a stub, and is back once the stub is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))));
    expect(await (await fetch('https://production.example.invalid/y')).json()).toEqual({});
    vi.unstubAllGlobals();
    await expect(fetch('https://production.example.invalid/z')).rejects.toThrow(/no test reaches the network/);
    expect(takeLeaked()).toEqual(['https://production.example.invalid/z']);
  });
});
