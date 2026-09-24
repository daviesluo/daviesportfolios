// What the vs-S&P panel draws while a reload's data is still arriving.
//
// Measured in the real bundle before the fix, with every response held
// back two seconds: "Computing…" from the first paint until the network
// answered, then a FLAT portfolio line reading +0.00 % for as long as the
// holdings' batch took, then the real line. These pin the three rules that
// replaced it:
//
//   * the first render draws the 24H picture the page last drew (the seed)
//     when the chart store has not loaded yet — never "Computing…";
//   * a mount waits for the store instead of calling its copy "not cached";
//   * the benchmark's batch alone is never drawn: with no holding history
//     every holding counts flat and the line reads 0.00 %.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const ctl = vi.hoisted(() => ({
  ready: true,
  /** @type {Promise<void>} */ hydrate: Promise.resolve(),
  /** @type {Array<{ symbols: string[], resolve: (v: any) => void }>} */ batches: [],
}));

vi.mock('../prices/historical.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('../prices/historical.js'));
  return {
    ...actual,
    fetchHistoricalBatch: vi.fn((symbols) => new Promise((resolve) => { ctl.batches.push({ symbols, resolve }); })),
    fetchHistorical: vi.fn(() => Promise.resolve(null)),
  };
});
vi.mock('../prices/price_snapshots.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('../prices/price_snapshots.js'));
  return { ...actual, refreshPriceSnapshots: vi.fn(() => Promise.resolve([])), readCachedPriceSnapshots: vi.fn(() => null) };
});
vi.mock('../prices/chart_store.js', () => {
  /** @type {Map<string, any>} */
  const store = new Map();
  const noop = { get: () => null, set: () => {}, del: () => {}, keys: () => [], pruneOlderThan: () => {} };
  return {
    YtdStore: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => store.set(k, v),
      del: (k) => store.delete(k),
      keys: () => Array.from(store.keys()),
      pruneOlderThan: () => {},
      _testSeed: (k, v) => store.set(k, v),
      _testClear: () => store.clear(),
    },
    ChartStore: noop,
    MaStore: noop,
    chartStoresReady: () => ctl.ready,
    hydrateAllChartStores: () => ctl.hydrate,
  };
});
vi.mock('../app/ops_error.js', () => ({ reportError: vi.fn() }));

import { PerfChart, perfBarsIncomplete, perfSeedFrom, perfSeedSignature, _resetPerfSeedMemo } from './perf_chart.jsx';
import { YtdStore } from '../prices/chart_store.js';
import { Storage } from '../app/storage.js';

// Bars inside US regular hours whichever side of daylight saving the test
// runs on (14:30-20:00 UTC is inside both), so the ^GSPC session filter
// keeps all three.
const DAY = '2026-09-17';
const bars = (a, b, c) => [
  { date: `${DAY}T15:00`, close: a }, { date: `${DAY}T17:00`, close: b }, { date: `${DAY}T19:30`, close: c },
];
const SP = bars(5000, 5100, 5200);           // +4.00 %
const ACME = bars(200, 220, 240);            // 10 shares: 2000 -> 2400, +20.00 %
const PORTFOLIO = {
  positions: { CM: { role: 'MID', tickers: ['ACME'] } },
  holdings: { ACME: { shares: 10, cost: 150, lastPrice: 240, prevClose: 238, dayPct: 0.84, currency: 'USD', lots: [{ date: '2026-06-01', shares: 10, cost: 150 }] } },
};
const YEAR = new Date().getFullYear();

const chart = (props = {}) => (
  <PerfChart portfolio={PORTFOLIO} marketData={{}} extendedHours={false} phase="afterhours"
    rangeKey="1D" setRangeKey={() => {}} {...props} />
);
const legend = (c) => Array.from(c.querySelectorAll('.perf-legend-item')).map((n) => n.textContent.replace(/\s+/g, ' ').trim());
const empty = (c) => c.querySelector('.sparkline-empty')?.textContent ?? null;
const portY = (c) => {
  const p = Array.from(c.querySelectorAll('svg path')).find((n) => n.getAttribute('stroke-width') === '1.6' && !n.getAttribute('opacity'));
  return (p?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((s) => Number(s.split(',')[1]));
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Answer the oldest outstanding batch with the fixture's bars for the symbols it asked for. */
const answer = async (which) => {
  const i = ctl.batches.findIndex((b) => (which === 'sp' ? b.symbols.includes('^GSPC') : !b.symbols.includes('^GSPC')));
  const [b] = ctl.batches.splice(i, 1);
  const out = {};
  for (const s of b.symbols) out[s] = s === '^GSPC' ? SP : ACME;
  await act(async () => { b.resolve(out); await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  _resetPerfSeedMemo();
  /** @type {any} */ (YtdStore)._testClear();
  ctl.ready = true;
  ctl.hydrate = Promise.resolve();
  ctl.batches.length = 0;
});

describe('perfBarsIncomplete', () => {
  const tickers = ['ACME'];
  it('holds the benchmark alone while the holdings are still out — the flat 0.00 % line', () => {
    expect(perfBarsIncomplete({ '^GSPC': SP }, '^GSPC', tickers, { sp: false, tickers: true })).toBe(true);
  });
  it('holds a book without its benchmark while the benchmark is still out', () => {
    expect(perfBarsIncomplete({ ACME }, '^GSPC', tickers, { sp: true, tickers: false })).toBe(true);
  });
  it('draws once both are there, or once nothing more is coming', () => {
    expect(perfBarsIncomplete({ '^GSPC': SP, ACME }, '^GSPC', tickers, { sp: true, tickers: true })).toBe(false);
    expect(perfBarsIncomplete({ '^GSPC': SP }, '^GSPC', tickers, { sp: false, tickers: false })).toBe(false);
    expect(perfBarsIncomplete({ '^GSPC': SP }, '^GSPC', [], { sp: false, tickers: true })).toBe(false);
  });
});

describe('perfSeedFrom / perfSeedSignature', () => {
  it('keeps the two fields the chart reads, the book\'s own symbols, and only the window\'s recorded rows', () => {
    const nowMs = Date.parse(`${DAY}T23:00:00Z`);
    const seed = perfSeedFrom({
      variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], nowMs,
      hist: { '^GSPC': SP.map((p) => ({ ...p, volume: 9 })), ACME, SOLD: ACME },
      recorded: [
        { ts: '2026-09-16T12:00:00.000Z', prices: { ACME: 1 } },                // before the 24 h window
        { ts: `${DAY}T14:55:00.000Z`, prices: { ACME: 199, SOLD: 5 } },
      ],
    });
    expect(Object.keys(seed.hist).sort()).toEqual(['ACME', '^GSPC']);
    expect(seed.hist['^GSPC'][0]).toEqual({ date: `${DAY}T15:00`, close: 5000 });
    expect(seed.recorded).toEqual([{ ts: `${DAY}T14:55:00.000Z`, prices: { ACME: 199 } }]);
  });
  it('changes when a bar does, and not otherwise', () => {
    const a = perfSeedFrom({ variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], hist: { '^GSPC': SP, ACME }, recorded: [] });
    const b = perfSeedFrom({ variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], hist: { '^GSPC': SP, ACME }, recorded: [] });
    const c = perfSeedFrom({ variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], hist: { '^GSPC': SP, ACME: bars(200, 220, 241) }, recorded: [] });
    expect(perfSeedSignature(a)).toBe(perfSeedSignature(b));
    expect(perfSeedSignature(c)).not.toBe(perfSeedSignature(a));
  });
});

describe('PerfChart on a reload', () => {
  it('draws the last 24H picture on its FIRST render while the store is still loading — no "Computing…"', async () => {
    Storage.savePerfSeed(perfSeedFrom({ variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], hist: { '^GSPC': SP, ACME }, recorded: [] }));
    ctl.ready = false;
    /** @type {() => void} */
    let loaded = () => {};
    ctl.hydrate = new Promise((r) => { loaded = r; });

    const { container } = render(chart());
    expect(empty(container)).toBeNull();
    expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+4.00%']);
    // …and asks the network nothing until the store has said what it holds.
    await flush();
    expect(ctl.batches.length).toBe(0);

    await act(async () => { loaded(); await new Promise((r) => setTimeout(r, 0)); });
    // The 24H window's two batches (the other ranges' background warm-up,
    // which also waited for the store, asks for its own after them).
    expect(ctl.batches.slice(0, 2).map((b) => b.symbols.join(','))).toEqual(['^GSPC', 'ACME']);
    await answer('sp');
    await answer('tickers');
    expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+4.00%']);
  });

  it('never draws the benchmark alone: no flat 0.00 % line while the holdings are still out', async () => {
    const { container } = render(chart());
    expect(empty(container)).toBe('Computing…');
    await flush();
    await answer('sp');
    expect(empty(container)).toBe('Computing…');
    expect(portY(container)).toEqual([]);
    await answer('tickers');
    expect(legend(container)[0]).toBe('PORTFOLIO+20.00%');
    const ys = portY(container);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });

  it('keeps the picture it drew for the next reload — the ext-off 24H window only', async () => {
    YtdStore.set(`y${YEAR}|1D:closed|^GSPC`, { ts: Date.now(), data: SP });
    YtdStore.set(`y${YEAR}|1D:closed|ACME`, { ts: Date.now(), data: ACME });
    render(chart());
    await flush();
    const kept = Storage.loadPerfSeed();
    expect(kept?.variantKey).toBe('closed');
    expect(kept?.hist.ACME).toEqual(ACME);

    cleanup();
    localStorage.clear();
    _resetPerfSeedMemo();
    YtdStore.set(`y${YEAR}|1D:ext|ES=F`, { ts: Date.now(), data: SP });
    YtdStore.set(`y${YEAR}|1D:ext|ACME`, { ts: Date.now(), data: ACME });
    render(chart({ extendedHours: true }));
    await flush();
    expect(Storage.loadPerfSeed()).toBeNull();
  });

  it('on a range switch before the store has loaded, draws that range\'s own picture or says so — never the last range\'s bars', async () => {
    Storage.savePerfSeed(perfSeedFrom({ variantKey: 'closed', spSymbol: '^GSPC', tickers: ['ACME'], hist: { '^GSPC': SP, ACME }, recorded: [] }));
    ctl.ready = false;
    ctl.hydrate = new Promise(() => {});
    const { container, rerender } = render(chart());
    expect(legend(container)[0]).toBe('PORTFOLIO+20.00%');
    rerender(chart({ rangeKey: 'YTD' }));
    await flush();
    expect(empty(container)).toBe('Computing…');
  });
});
