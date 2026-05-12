// Unit tests for the network/proxy plumbing — pin the race-and-cancel
// behavior of fetchHistoricalBatch so future refactors can't silently
// regress the perf wins from PRs #47/#48 (Codex P1: edge-only path used
// to block on slow proxies; Codex P2: AbortControllers weren't retained
// so losing proxies kept eating bandwidth).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHistoricalBatch } from './utils.js';

/** @param {(input: any, init?: any) => any} impl */
const ANY_FETCH = (impl) => {
  globalThis.fetch = /** @type {any} */ (vi.fn(impl));
};

beforeEach(() => {
  // Each test installs its own fetch stub.
  globalThis.fetch = /** @type {any} */ (
    vi.fn(() => Promise.reject(new Error("fetch not stubbed")))
  );
});
afterEach(() => { vi.restoreAllMocks(); });

// Minimal Yahoo-shaped response builder (only the fields parseResponse cares about).
function yahooBody(closes, dates) {
  return {
    chart: {
      result: [{
        timestamp: dates.map(d => Math.floor(new Date(d).getTime() / 1000)),
        meta: { currency: "USD" },
        indicators: { quote: [{ close: closes }] },
      }],
    },
  };
}

describe('fetchHistoricalBatch — Edge Function fast path', () => {
  it('resolves immediately when the Edge Function fills every requested ticker', async () => {
    ANY_FETCH(async (url) => {
      // Edge Function URL contains "/functions/v1/chart"
      if (String(url).includes("/functions/v1/chart")) {
        return new Response(JSON.stringify({
          AAPL: [{ date: "2026-04-27", close: 270 }],
          NVDA: [{ date: "2026-04-27", close: 200 }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Proxy fallback — never resolves; should be aborted before it can
      return new Promise(() => {});
    });

    const out = await fetchHistoricalBatch(["AAPL", "NVDA"]);
    expect(out.AAPL).toEqual([{ date: "2026-04-27", close: 270 }]);
    expect(out.NVDA).toEqual([{ date: "2026-04-27", close: 200 }]);
  });

  it('trusts Edge omissions as real failures and does NOT fall back to proxies when Edge succeeded', async () => {
    // Pins the post-39c73c4 behaviour: when the Edge Function call
    // itself succeeds (200 + JSON), tickers it didn't include are
    // treated as genuinely unavailable — the Edge already exhausts
    // every reasonable upstream server-side, so re-trying the SAME
    // sources through browser CORS proxies would just burn the
    // proxies' rate limits without any chance of new data.
    let proxyHits = 0;
    ANY_FETCH(async (url) => {
      const u = String(url);
      if (u.includes("/functions/v1/chart")) {
        return new Response(JSON.stringify({
          AAPL: [{ date: "2026-04-27", close: 270 }],
        }), { status: 200 });
      }
      // Even though a proxy COULD return data for NVDA here, the new
      // logic shouldn't fire it.
      proxyHits++;
      if (u.includes("NVDA")) {
        return new Response(JSON.stringify(yahooBody([200], ["2026-04-27"])), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const out = await fetchHistoricalBatch(["AAPL", "NVDA", "MISSING"]);
    expect(out.AAPL).toBeDefined();
    expect(out.NVDA).toBeUndefined();
    expect(out.MISSING).toBeUndefined();
    expect(proxyHits).toBe(0);
  });

  it('falls back to proxies for ALL tickers when the Edge Function call itself fails', async () => {
    // Counterpart to the previous test: proxy-fallback only kicks in
    // when the Edge call itself failed (network error / 5xx / not
    // deployed). In that case the proxies are the only available
    // route to data.
    ANY_FETCH(async (url) => {
      const u = String(url);
      if (u.includes("/functions/v1/chart")) {
        return new Response("boom", { status: 500 });
      }
      if (u.includes("NVDA")) {
        return new Response(JSON.stringify(yahooBody([200], ["2026-04-27"])), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const out = await fetchHistoricalBatch(["AAPL", "NVDA"]);
    expect(out.NVDA).toBeDefined();
  });
});

describe('fetchHistoricalBatch — CN fund proxy bypass', () => {
  it('skips Yahoo proxy for 6-digit numeric tickers (Yahoo would 404 on every proxy)', async () => {
    let yahooProxyHits = 0;
    ANY_FETCH(async (url) => {
      const u = String(url);
      if (u.includes("/functions/v1/chart")) {
        // Edge Function returns the CN fund data
        return new Response(JSON.stringify({
          "017731": [{ date: "2026-04-27", close: 1.5 }],
        }), { status: 200 });
      }
      // Yahoo proxy URL contains "query1.finance.yahoo.com"
      if (u.includes("query1.finance.yahoo.com")) yahooProxyHits++;
      return new Promise(() => {}); // hang the proxy fallback
    });

    const out = await fetchHistoricalBatch(["017731"]);
    expect(out["017731"]).toEqual([{ date: "2026-04-27", close: 1.5 }]);
    expect(yahooProxyHits).toBe(0); // PROXIES were skipped for the 6-digit code
  });
});

describe('fetchHistoricalBatch — empty input', () => {
  it('returns {} immediately without hitting the network when symbols is empty', async () => {
    let calls = 0;
    ANY_FETCH(async () => { calls++; return new Response("{}", { status: 200 }); });
    const out = await fetchHistoricalBatch([]);
    expect(out).toEqual({});
    expect(calls).toBe(0);
  });

  it('deduplicates the input so the same ticker isn\'t fetched twice', async () => {
    let edgeUrls = [];
    ANY_FETCH(async (url) => {
      const u = String(url);
      if (u.includes("/functions/v1/chart")) {
        edgeUrls.push(u);
        return new Response(JSON.stringify({
          AAPL: [{ date: "2026-04-27", close: 270 }],
        }), { status: 200 });
      }
      return new Promise(() => {});
    });

    await fetchHistoricalBatch(["AAPL", "AAPL", "AAPL"]);
    // The Edge URL should list AAPL exactly once (?tickers=AAPL not AAPL,AAPL,AAPL).
    expect(edgeUrls.length).toBe(1);
    const tickers = new URL(edgeUrls[0]).searchParams.get("tickers");
    expect(tickers).toBe("AAPL");
  });
});

// ---------------------------------------------------------------------------
// Storage.loadMarketCache / saveMarketCache — pin the cold-start FX seed.
//
// Critical for the portfolio total NOT to flash a 1:1-fallback value on every
// page load. Regressions here are silent (vitest won't catch a key-name typo
// without an explicit test) so they get their own block.
// ---------------------------------------------------------------------------
describe('Storage.loadMarketCache / saveMarketCache', () => {
  // Stub localStorage so the test doesn't depend on jsdom's quirks.
  /** @type {Record<string, string>} */
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = /** @type {any} */ ({
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { store = {}; },
    });
  });

  it('returns {} when the row is missing', async () => {
    const { Storage } = await import('./utils.js');
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('roundtrips a save → load: every ticker with a positive lastPrice comes back', async () => {
    const { Storage } = await import('./utils.js');
    const tick = {
      'GBPUSD=X': { lastPrice: 1.27 },
      'USDCNY=X': { lastPrice: 7.21 },
      '^GSPC':    { lastPrice: 5300, prevClose: 5280, dayPct: 0.37 },
      'BZ=F':     { lastPrice: 82.5 },
    };
    Storage.saveMarketCache(tick);
    const loaded = Storage.loadMarketCache();
    expect(loaded['GBPUSD=X'].lastPrice).toBe(1.27);
    expect(loaded['USDCNY=X'].lastPrice).toBe(7.21);
    expect(loaded['^GSPC'].lastPrice).toBe(5300);
    expect(loaded['^GSPC'].prevClose).toBe(5280);
    expect(loaded['BZ=F'].lastPrice).toBe(82.5);
  });

  it('drops entries with non-positive / invalid lastPrice on both save and load', async () => {
    const { Storage } = await import('./utils.js');
    Storage.saveMarketCache({
      OK:    { lastPrice: 100 },
      ZERO:  { lastPrice: 0 },
      NEG:   { lastPrice: -1 },
      NULL:  { lastPrice: null },
      NAN:   { lastPrice: NaN },
      OBJ:   /** @type {any} */ ('not an object'),
      ABSENT:{ /* no lastPrice field */ },
    });
    const loaded = Storage.loadMarketCache();
    expect(Object.keys(loaded).sort()).toEqual(['OK']);
  });

  it('expires rows older than 7 days', async () => {
    const { Storage } = await import('./utils.js');
    // Write directly so we control the ts.
    const stale = {
      ts: Date.now() - (7 * 24 * 60 * 60 * 1000 + 60_000),
      data: { 'GBPUSD=X': { lastPrice: 1.27 } },
    };
    store['dp.marketCache'] = JSON.stringify(stale);
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('keeps rows just under the 7-day threshold', async () => {
    const { Storage } = await import('./utils.js');
    const fresh = {
      ts: Date.now() - (6 * 24 * 60 * 60 * 1000),
      data: { 'GBPUSD=X': { lastPrice: 1.27 } },
    };
    store['dp.marketCache'] = JSON.stringify(fresh);
    expect(Storage.loadMarketCache()).toEqual({ 'GBPUSD=X': { lastPrice: 1.27 } });
  });

  it('returns {} on malformed JSON / wrong shape (defensive)', async () => {
    const { Storage } = await import('./utils.js');
    // Corrupt JSON
    store['dp.marketCache'] = '{not json';
    expect(Storage.loadMarketCache()).toEqual({});
    // Missing ts
    store['dp.marketCache'] = JSON.stringify({ data: { OK: { lastPrice: 1 } } });
    expect(Storage.loadMarketCache()).toEqual({});
    // Missing data
    store['dp.marketCache'] = JSON.stringify({ ts: Date.now() });
    expect(Storage.loadMarketCache()).toEqual({});
    // String data
    store['dp.marketCache'] = JSON.stringify({ ts: Date.now(), data: 'oops' });
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('save returns false on empty / no-usable-tickers input', async () => {
    const { Storage } = await import('./utils.js');
    expect(Storage.saveMarketCache(null)).toBe(false);
    expect(Storage.saveMarketCache({})).toBe(false);
    expect(Storage.saveMarketCache({ A: { lastPrice: 0 } })).toBe(false);
  });

  it('falls back to the legacy dp.fxCache shape when the new key is empty (Codex P2 #106)', async () => {
    const { Storage } = await import('./utils.js');
    // Old shape: { ts, rates: { ... } } — what PR #105 wrote before
    // PR #106 renamed the key.
    const legacy = {
      ts: Date.now() - (12 * 60 * 60 * 1000),
      rates: {
        'GBPUSD=X': { lastPrice: 1.27 },
        'USDCNY=X': { lastPrice: 7.21 },
      },
    };
    store['dp.fxCache'] = JSON.stringify(legacy);
    // No dp.marketCache yet — first cold start after upgrade.
    expect(Storage.loadMarketCache()).toEqual({
      'GBPUSD=X': { lastPrice: 1.27 },
      'USDCNY=X': { lastPrice: 7.21 },
    });
  });

  it('expires the legacy fxCache row too (7-day max age)', async () => {
    const { Storage } = await import('./utils.js');
    store['dp.fxCache'] = JSON.stringify({
      ts: Date.now() - (8 * 24 * 60 * 60 * 1000),
      rates: { 'GBPUSD=X': { lastPrice: 1.27 } },
    });
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('saveMarketCache deletes the legacy dp.fxCache row after a fresh write', async () => {
    const { Storage } = await import('./utils.js');
    store['dp.fxCache'] = JSON.stringify({
      ts: Date.now(),
      rates: { 'GBPUSD=X': { lastPrice: 1.27 } },
    });
    expect('dp.fxCache' in store).toBe(true);
    Storage.saveMarketCache({ '^GSPC': { lastPrice: 5300 } });
    expect('dp.fxCache' in store).toBe(false);
  });
});
