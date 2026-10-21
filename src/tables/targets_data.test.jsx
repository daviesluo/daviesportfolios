// @vitest-environment jsdom
// Pins the Target price page's preload (targets_data.js; Davies, 2026-10-21: no cold fetch, no empty or loading state
// on open): the app asks for the targets after its first paint, before any page opens; one request for every holding,
// with the app token; a copy younger than the TTL is not asked for again; a request already out is joined; a failure
// keeps what is here; a reload paints the kept copy. And the page, opened after the preload, draws its figures on its
// first render without asking again.
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { _resetTargets, fetchTargets, prefetchTargets, readTargetsCache, targetsFresh, TARGETS_TTL_MS, TARGETS_URL } from './targets_data.js';
import { TargetPriceModal } from './target_price.jsx';

const BODY = {
  slot: '2026-10-21T13:30:00.000Z', asOf: '2026-10-21T13:30:20.000Z',
  rows: { ACME: { kind: 'consensus', currency: 'USD', refPrice: 240, mean: 260, low: 230, high: 300, rating: 1.8, analysts: 12, targets: [] } },
};
const ok = () => new Response(JSON.stringify(BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });
const METRICS = { marketValue: 1000, positions: { A: { players: [{ ticker: 'ACME', lastPrice: 240, marketValue: 480, currency: 'USD', shares: 2, cost: 200, fx: 1 }] } } };

beforeEach(() => { _resetTargets(); localStorage.clear(); sessionStorage.setItem('dp.token', 'tok'); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the targets preload', () => {
  it('is started by the app after its first paint, beside the split pages (prefetchModalChunks)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.jsx'), 'utf8');
    const body = src.slice(src.indexOf('function prefetchModalChunks()'), src.indexOf('\n}\n', src.indexOf('function prefetchModalChunks()')));
    expect(body).toContain('prefetchTargets()');
    expect(body).toMatch(/TargetPriceModal/);
    // After the first paint, never in the way of it.
    expect(src).toContain('const id = setTimeout(prefetchModalChunks, 0);');
  });

  it('asks once, for every holding at once, with the app token; joins a request already out; keeps the copy for its TTL', async () => {
    const f = vi.fn(async () => ok());
    let t = 1_000_000;
    const now = () => t;
    const [a, b] = [prefetchTargets(f, now), prefetchTargets(f, now)];
    await Promise.all([a, b]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = /** @type {any} */ (f.mock.calls[0]);
    expect(url).toBe(TARGETS_URL);
    expect(url).toMatch(/\/functions\/v1\/targets$/);
    expect(init.headers['X-App-Token']).toBe('tok');
    expect(readTargetsCache()?.data.rows.ACME.mean).toBe(260);
    t += TARGETS_TTL_MS - 1;
    await prefetchTargets(f, now);
    expect(f).toHaveBeenCalledTimes(1);
    t += 1;
    await prefetchTargets(f, now);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('an empty answer is never fresh: the next preload asks again (the 2026-10-21 first run hid behind it)', async () => {
    let t = 5_000_000;
    const now = () => t;
    const empty = vi.fn(async () => new Response(JSON.stringify({ asOf: null, rows: {} }), { status: 200 }));
    await prefetchTargets(empty, now);
    expect(targetsFresh(readTargetsCache(), t)).toBe(false);
    t += 60e3;
    const full = vi.fn(async () => ok());
    await prefetchTargets(full, now);
    expect(full).toHaveBeenCalledTimes(1);
    expect(readTargetsCache()?.data.rows.ACME.mean).toBe(260);
    expect(targetsFresh(readTargetsCache(), t)).toBe(true);
    expect(targetsFresh(readTargetsCache(), t + TARGETS_TTL_MS)).toBe(false);
  });

  it('a failure or a bad answer keeps the copy already here and never throws', async () => {
    await fetchTargets(async () => ok());
    const before = readTargetsCache();
    expect(await fetchTargets(async () => new Response('{}', { status: 500 }))).toBe(null);
    expect(await fetchTargets(async () => new Response('{"error":"x"}', { status: 200 }))).toBe(null);
    expect(await fetchTargets(async () => { throw new Error('offline'); })).toBe(null);
    expect(readTargetsCache()).toBe(before);
  });

  it('a reload reads the copy kept in this browser', async () => {
    await fetchTargets(async () => ok());
    _resetTargets();
    expect(readTargetsCache()?.data.rows.ACME.low).toBe(230);
  });
});

describe('the page after the preload', () => {
  it('draws its figures on its first render and asks nothing more', async () => {
    await prefetchTargets(async () => ok());
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<TargetPriceModal metrics={METRICS} onTickerClick={() => {}} onClose={() => {}} />);
    // Synchronously after render: no "Reading targets…", the row's avg vs price already there (260 / 240 − 1 = +8.3 %).
    expect(screen.queryByText(/Reading targets/)).toBeNull();
    expect(screen.getByText('+8.3%')).toBeTruthy();
    expect(screen.getByText('$230 – $300')).toBeTruthy();   // both ends 100 and up: no decimals; the symbol on each
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('shows the Key risks the GET serves (the hand-targets branch), not the bundled ones', async () => {
    const body = { ...BODY, risks: { asOf: '2026-10-22', risks: { ACME: [{ text: 'Served by the branch' }] } } };
    await prefetchTargets(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    render(<TargetPriceModal metrics={METRICS} onTickerClick={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Served by the branch')).toBeTruthy();
  });

  it('moves Weight, Price and Avg vs price with a board tick, and asks nothing of the server', async () => {
    await prefetchTargets(async () => ok());
    const spy = vi.spyOn(globalThis, 'fetch');
    const { rerender } = render(<TargetPriceModal metrics={METRICS} onTickerClick={() => {}} onClose={() => {}} />);
    const cells = () => [...document.querySelectorAll('.tp-table tbody tr td')].map((td) => (td.textContent || '').trim());
    // 480 / 1,000 = 48.00 %; 240; 260 / 240 − 1 = +8.3 %.
    expect(cells().slice(1, 3)).toEqual(['48.00%', '$240.00']);
    expect(cells()[8]).toBe('+8.3%');
    const updated = (document.querySelector('.tp-updated')?.textContent || '').trim();
    // The board ticks: ACME 240 → 250 (and its value with it, 2 × 250 = 500 of 1,020).
    const tick = { marketValue: 1020, positions: { A: { players: [{ ...METRICS.positions.A.players[0], lastPrice: 250, marketValue: 500 }] } } };
    rerender(<TargetPriceModal metrics={tick} onTickerClick={() => {}} onClose={() => {}} />);
    // 500 / 1,020 = 49.02 %; 250; 260 / 250 − 1 = +4.0 %. The scheduled columns and their stamp stay as they were.
    expect(cells().slice(1, 3)).toEqual(['49.02%', '$250.00']);
    expect(cells()[8]).toBe('+4.0%');
    expect(cells()[3]).toBe('$260.00');
    expect((document.querySelector('.tp-updated')?.textContent || '').trim()).toBe(updated);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
