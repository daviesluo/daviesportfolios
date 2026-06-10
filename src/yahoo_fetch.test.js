// Pins the SFTBY-shape ext-price suppression: OTC ADRs that quote only
// their regular US session must never carry a Yahoo postMarketPrice, so
// the phantom "after-hours / overnight" move can't reach the UI. Tests
// the predicate directly + the end-to-end suppression through the public
// `fetchTickers` (Edge path).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quotesRegularSessionOnly, fetchTickers } from './yahoo_fetch.js';

describe('quotesRegularSessionOnly', () => {
  it('is true only for US-shaped tickers with no overnight session (SFTBY)', () => {
    expect(quotesRegularSessionOnly('SFTBY')).toBe(true);
    expect(quotesRegularSessionOnly('sftby')).toBe(true); // case-insensitive
  });
  it('is false for normal US equities (they DO trade ext-hours)', () => {
    expect(quotesRegularSessionOnly('NVDA')).toBe(false);
    expect(quotesRegularSessionOnly('AAPL')).toBe(false);
  });
  it('is false for non-US shapes (handled by their own suffix rules)', () => {
    expect(quotesRegularSessionOnly('VUAG.L')).toBe(false);  // LSE
    expect(quotesRegularSessionOnly('BTC-USD')).toBe(false); // crypto
    expect(quotesRegularSessionOnly('600519')).toBe(false);  // CN fund
    expect(quotesRegularSessionOnly('ES=F')).toBe(false);    // futures
  });
});

// Pins the 200-wrapped-proxy-error backoff: some free CORS proxies
// serve their own rate-limit / error body with a 200, which used to
// slip past the !res.ok and res.json()-throw backoff paths entirely —
// a proxy stuck in that state was never benched and burned an attempt
// slot (+ up to 8 s of timeout) on every single poll.
describe('fetchTickers — proxies answering 200 with a non-upstream body get benched', () => {
  const origFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = origFetch;
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
  });

  it('benches every proxy that wraps a Yahoo quote in its own error JSON', async () => {
    const { PROXIES, proxyIsAvailable, clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    globalThis.fetch = /** @type {any} */ (vi.fn(async (url) => {
      // Edge Function down → fetchTickers falls back to the proxy chain.
      if (String(url).includes('supabase.co')) return { ok: false, status: 500, json: async () => ({}) };
      // Every proxy answers 200 with its own JSON — no `chart` envelope.
      return { ok: true, json: async () => ({ error: 'rate limited' }), text: async () => '{"error":"rate limited"}' };
    }));
    expect(await fetchTickers(['NVDA'])).toBe(null);
    for (let i = 0; i < PROXIES.length; i++) expect(proxyIsAvailable(i)).toBe(false);
  });

  it('benches a proxy answering a CN-fund JSONP request with an HTML error page', async () => {
    const { PROXIES, proxyIsAvailable, clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    globalThis.fetch = /** @type {any} */ (vi.fn(async (url) => {
      if (String(url).includes('supabase.co')) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({}), text: async () => '<html><body>502</body></html>' };
    }));
    expect(await fetchTickers(['000001'])).toBe(null);
    for (let i = 0; i < PROXIES.length; i++) expect(proxyIsAvailable(i)).toBe(false);
  });
});

describe('fetchTickers — SFTBY ext-price suppression (Edge path)', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  it('nulls SFTBY extPrice/extDayPct from the Edge reply but keeps NVDA’s', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
      ok: true,
      json: async () => ({
        SFTBY: { lastPrice: 27.38, prevClose: 27.38, extPrice: 27.11, extDayPct: -0.99, dayPct: 0, currency: 'USD' },
        NVDA:  { lastPrice: 224.85, prevClose: 224.5, extPrice: 226.0, extDayPct: 0.51, dayPct: 0.16, currency: 'USD' },
      }),
    })));
    const out = await fetchTickers(['SFTBY', 'NVDA']);
    expect(out.SFTBY.extPrice).toBe(null);
    expect(out.SFTBY.extDayPct).toBe(null);
    expect(out.SFTBY.lastPrice).toBe(27.38);    // RTH price untouched
    // A real overnight-session equity keeps its ext quote.
    expect(out.NVDA.extPrice).toBe(226.0);
    expect(out.NVDA.extDayPct).toBe(0.51);
  });
});
