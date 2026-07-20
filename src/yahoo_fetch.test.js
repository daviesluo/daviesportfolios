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
    // The CN-fund proxy fallback now runs in the BACKGROUND (it no
    // longer blocks the refresh) — give its microtask chain one
    // macrotask to finish before asserting the benching happened.
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < PROXIES.length; i++) expect(proxyIsAvailable(i)).toBe(false);
  });
});

// Pins the parallel-race redesign of the proxy fallback (fetchOneYahooChart).
// The previous version fell through PROXIES sequentially — `for (i of
// idxs) { await fetch(...) }` — so a proxy that never resolves (hangs, or
// is just slow) blocks every proxy AFTER it in the array from even being
// tried, and the theoretical worst case was PROXIES.length × the per-proxy
// timeout (≈40 s for 5 proxies × 8 s). A race launches every proxy at once,
// so a hung/slow FIRST proxy can no longer starve a fast LATER one.
describe('fetchTickers — proxy fallback races all proxies in parallel (not sequential fall-through)', () => {
  const origFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = origFetch;
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
  });

  it('a hung first proxy does not block a later proxy from winning the race', async () => {
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    const goodBody = {
      chart: { result: [{ meta: { regularMarketPrice: 224.85, regularMarketPreviousClose: 224.5, currency: 'USD' } }] },
    };
    globalThis.fetch = /** @type {any} */ (vi.fn((url, opts) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      // The FIRST proxy (api.cors.lol) never settles — its promise hangs
      // until the caller aborts it. A sequential fall-through would await
      // this forever and never reach the other proxies.
      if (String(url).includes('cors.lol')) {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      // Every other proxy answers immediately with a good quote.
      return Promise.resolve({ ok: true, json: async () => goodBody });
    }));
    const out = await fetchTickers(['NVDA']);
    expect(out.NVDA.lastPrice).toBe(224.85);
  });

  // Codex #201 P2: cleanup() aborts every losing proxy the instant a
  // winner lands, and that abort used to fall into the same catch
  // block as a genuine timeout/network error — blacklisting a proxy
  // that was perfectly healthy and simply slower this round.
  it('does not blacklist a healthy proxy that loses the race to cleanup()', async () => {
    const { proxyIsAvailable, clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    const goodBody = {
      chart: { result: [{ meta: { regularMarketPrice: 224.85, regularMarketPreviousClose: 224.5, currency: 'USD' } }] },
    };
    globalThis.fetch = /** @type {any} */ (vi.fn((url, opts) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      // The FIRST proxy answers immediately and wins the race, which
      // triggers cleanup() → aborts every other in-flight proxy.
      if (String(url).includes('cors.lol')) {
        return Promise.resolve({ ok: true, json: async () => goodBody });
      }
      // Every other proxy is still healthy, just slower — it never
      // gets a chance to answer because the winner's cleanup() aborts
      // it first, same as a real-world loser.
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));
    await fetchTickers(['NVDA']);
    // Every losing proxy (index 1+) must still be considered available —
    // losing a race to a winner is not evidence the proxy is unhealthy.
    for (let i = 1; i < 5; i++) expect(proxyIsAvailable(i)).toBe(true);
  });
});

// Pins the fix for the "first refresh after opening the app takes ~20 s"
// bug (2026-07). Root cause: the prices Edge Function's fundgz upstream
// got geo-blocked from Deno egress IPs, so every response omitted the
// portfolio's CN fund — and the client then walked the CORS-proxy list
// SEQUENTIALLY (8 s timeout each, and Western proxies rarely reach
// eastmoney at all) while the whole refresh awaited it. In-page
// refreshes were fast only because the failed proxies were benched
// in-memory; closing and reopening reset the backoff and paid the full
// gauntlet again. The fallback is now (a) a parallel race and (b) fully
// backgrounded — one unreachable fund must never hold the other 29
// fresh quotes and the spinner hostage.
describe('fetchTickers — CN-fund proxy fallback never blocks the refresh', () => {
  const origFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = origFetch;
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
  });

  const EDGE_BODY = {
    NVDA: { lastPrice: 100, extPrice: null, prevClose: 99, currency: 'USD', dayPct: 1.01, extDayPct: null },
  };

  it('returns the Edge quotes immediately even while every CN proxy hangs', async () => {
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    globalThis.fetch = /** @type {any} */ (vi.fn((url, opts) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve({ ok: true, json: async () => EDGE_BODY });
      }
      // Every proxy hangs until aborted — the old sequential fallback
      // sat through up to 5 × 8 s of timeouts here, with the refresh
      // spinner waiting on it the whole time.
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));
    const t0 = Date.now();
    const out = await fetchTickers(['NVDA', '017731']);
    // Resolves on the Edge round-trip alone — nowhere near even ONE
    // 8 s proxy timeout.
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out.NVDA.lastPrice).toBe(100);
    expect(out['017731']).toBeUndefined();
  });

  it('a background proxy success is merged into the NEXT refresh tick', async () => {
    const { clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    const gz = 'jsonpgz({"fundcode":"110011","name":"x","jzrq":"2026-07-17","dwjz":"4.2025","gsz":"3.9509","gszzl":"-5.99","gztime":"2026-07-17 15:00"});';
    globalThis.fetch = /** @type {any} */ (vi.fn((url) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve({ ok: true, json: async () => EDGE_BODY });
      }
      return Promise.resolve({ ok: true, text: async () => gz });
    }));
    const first = await fetchTickers(['NVDA', '110011']);
    // This tick doesn't wait for the proxies — the fund is simply absent.
    expect(first['110011']).toBeUndefined();
    // Let the background race land (it resolves in microtasks here; the
    // 50 ms grace also proves the race is PARALLEL — a sequential walk
    // would still be inside the first proxy's 8 s timeout).
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetchTickers(['NVDA', '110011']);
    expect(second['110011'].lastPrice).toBe(3.9509);   // gsz (intraday estimate)
    expect(second['110011'].prevClose).toBe(4.2025);   // dwjz (official NAV)
    expect(second['110011'].currency).toBe('CNY');
  });

  it('multi-ticker fan-out skips doomed proxy races when every proxy is already benched', async () => {
    const { PROXIES, markProxyDead, clearProxyBackoff } = await import('./proxy_chain.js');
    clearProxyBackoff();
    // An earlier wave (simulated here) proved every proxy dead.
    for (let i = 0; i < PROXIES.length; i++) markProxyDead(i);
    globalThis.fetch = /** @type {any} */ (vi.fn((url, opts) => {
      if (String(url).includes('supabase.co')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      // Any proxy attempt would hang to its full 8 s timeout — with
      // skipIfAllDead the fan-out must never even get here.
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));
    const t0 = Date.now();
    const out = await fetchTickers(['NVDA', 'PLTR']);
    // Bails immediately instead of stacking ceil(N/pool) × 8 s waves.
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out).toBe(null);
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
