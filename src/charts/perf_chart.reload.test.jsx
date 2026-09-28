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
import { refreshPriceSnapshots } from '../prices/price_snapshots.js';
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

// Davies, 2026-09-28: the panel moved with neither the clock nor the refresh button. Its bars and the recorded prices
// were fetched once, when the window was first drawn, and nothing asked again: the axis and the S&P line stopped at
// the moment the page was opened, and only the book's last point followed the live prices.
describe('PerfChart on a refresh', () => {
  const SP2 = [...SP, { date: `${DAY}T19:55`, close: 5300 }];        // +6.00 %
  const ACME2 = [...ACME, { date: `${DAY}T19:55`, close: 240 }];
  /** Answer the oldest outstanding batch of one kind with the given bars. */
  const answerWith = async (which, sp, acme) => {
    const i = ctl.batches.findIndex((b) => (which === 'sp' ? b.symbols.includes('^GSPC') : !b.symbols.includes('^GSPC')));
    const [b] = ctl.batches.splice(i, 1);
    const out = {};
    for (const s of b.symbols) out[s] = s === '^GSPC' ? sp : acme;
    await act(async () => { b.resolve(out); await new Promise((r) => setTimeout(r, 0)); });
  };
  /** Mount on the first bars, as the page opens, with the other ranges' warm-up set aside. */
  const opened = async (t0, props = {}) => {
    const view = render(chart({ refreshedAt: t0, ...props }));
    await flush();
    await answer('sp');
    await answer('tickers');
    ctl.batches.length = 0;          // the other ranges' warm-up, which waits on its first batch for good
    return view;
  };
  const asked = () => ctl.batches.map((b) => b.symbols.join(',')).sort();

  it("fetches what has gone stale at the page's refresh, and draws the new bar", async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { container, rerender } = await opened(t0);
      expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+4.00%']);
      expect(portY(container)).toHaveLength(3);
      // Forty seconds on, everything is fresh: a tick asks for nothing.
      clock.mockReturnValue(t0 + 40e3);
      rerender(chart({ refreshedAt: t0 + 40e3 }));
      await flush();
      expect(asked()).toEqual([]);
      // Four minutes on, the holdings' bars are still inside their five minutes, the benchmark's past its one (it is
      // the axis, and its futures arrive ten minutes late already): a tick asks for the benchmark alone.
      clock.mockReturnValue(t0 + 4 * 60e3);
      rerender(chart({ refreshedAt: t0 + 4 * 60e3 }));
      await flush();
      expect(asked()).toEqual(['^GSPC']);
      await answerWith('sp', SP, ACME);
      // Six minutes on both have gone stale: the tick fetches both batches, and the chart draws the new bar.
      clock.mockReturnValue(t0 + 6 * 60e3);
      rerender(chart({ refreshedAt: t0 + 6 * 60e3 }));
      await flush();
      expect(asked()).toEqual(['ACME', '^GSPC']);
      await answerWith('sp', SP2, ACME2);
      await answerWith('tickers', SP2, ACME2);
      expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+6.00%']);
      expect(portY(container)).toHaveLength(4);
    } finally { clock.mockRestore(); }
  });

  it('fetches everything the window shows at the refresh button, however fresh', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { container, rerender } = await opened(t0);
      clock.mockReturnValue(t0 + 60e3);
      rerender(chart({ refreshedAt: t0, forceRefreshKey: t0 + 60e3 }));
      await flush();
      expect(asked()).toEqual(['ACME', '^GSPC']);
      await answerWith('sp', SP2, ACME2);
      await answerWith('tickers', SP2, ACME2);
      expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+6.00%']);
    } finally { clock.mockRestore(); }
  });

  it('runs a refresh that arrives while another is out once that one lands, and keeps the button\'s force', async () => {
    // Found by the gates (2026-09-28): a tick six minutes on arrived while the button's own fetch was still out, and was
    // dropped: the panel waited a whole refresh more. A button pressed during a tick's fetch was dropped the same way.
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { container, rerender } = await opened(t0);
      clock.mockReturnValue(t0 + 6 * 60e3);
      rerender(chart({ refreshedAt: t0 + 6 * 60e3 }));
      await flush();
      expect(asked()).toEqual(['ACME', '^GSPC']);
      // The button, pressed while that fetch is out: nothing is asked yet, and nothing is lost.
      clock.mockReturnValue(t0 + 6 * 60e3 + 10e3);
      rerender(chart({ refreshedAt: t0 + 6 * 60e3, forceRefreshKey: 1 }));
      await flush();
      expect(asked()).toEqual(['ACME', '^GSPC']);
      await answerWith('sp', SP, ACME);
      await answerWith('tickers', SP, ACME);
      await flush();
      // Once it lands, the button's refresh runs: everything again, however fresh.
      expect(asked()).toEqual(['ACME', '^GSPC']);
      await answerWith('sp', SP2, ACME2);
      await answerWith('tickers', SP2, ACME2);
      expect(legend(container)).toEqual(['PORTFOLIO+20.00%', 'S&P 500+6.00%']);
    } finally { clock.mockRestore(); }
  });

  it('re-reads the recorded prices at a refresh once a new five-minute sample is due, and at the button always', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const snaps = vi.mocked(refreshPriceSnapshots);
    try {
      snaps.mockClear();
      const { rerender } = await opened(t0);
      expect(snaps).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(t0 + 60e3);
      rerender(chart({ refreshedAt: t0 + 60e3 }));
      await flush();
      expect(snaps).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(t0 + 6 * 60e3);
      rerender(chart({ refreshedAt: t0 + 6 * 60e3 }));
      await flush();
      expect(snaps).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(t0 + 7 * 60e3);
      rerender(chart({ refreshedAt: t0 + 6 * 60e3, forceRefreshKey: t0 + 7 * 60e3 }));
      await flush();
      expect(snaps).toHaveBeenCalledTimes(3);
    } finally { clock.mockRestore(); }
  });
});

describe('PerfChart at the live edge', () => {
  // Davies (2026-09-28): the panel ran about ten minutes behind the clock. Its x grid is the benchmark's bars, and the
  // futures reach us ten minutes late (CME's delayed feed on Yahoo); the book's last point sat at the benchmark's last
  // bar. Here the benchmark's last bar is 19:30 and the clock 19:40:30: the book gets a point of its own at 19:40, at
  // its live price, one past the benchmark's line, and the 19:30 point is valued from the bars like any other.
  const LIVE = { ...PORTFOLIO, holdings: { ACME: { ...PORTFOLIO.holdings.ACME, lastPrice: 250 } } };   // 2500: +25.00 %
  const spY = (c) => {
    const p = Array.from(c.querySelectorAll('svg path')).find((n) => n.getAttribute('stroke-width') === '1.2');
    return (p?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((q) => Number(q.split(',')[1]));
  };
  const xs = (c) => {
    const p = Array.from(c.querySelectorAll('svg path')).find((n) => n.getAttribute('stroke-width') === '1.6' && !n.getAttribute('opacity'));
    return (p?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((q) => Number(q.split(',')[0]));
  };
  it('draws the book to the current minute at live prices and ends the benchmark at its last print', async () => {
    const t0 = Date.parse(`${DAY}T19:40:30Z`);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const view = render(chart({ portfolio: LIVE, refreshedAt: t0 }));
      await flush();
      await answer('sp');
      await answer('tickers');
      const c = view.container;
      // The book: 2000, 2200, 2400 on the bars, then 2500 live — +25.00 %; the benchmark stops at its 19:30 +4.00 %.
      expect(legend(c)).toEqual(['PORTFOLIO+25.00%', 'S&P 500+4.00%']);
      expect(portY(c)).toHaveLength(4);
      expect(spY(c)).toHaveLength(3);
      const y = portY(c);
      expect(y[3]).toBeLessThan(y[2]);                    // the live point (+25 %) sits above the 19:30 bar's (+20 %)
      const x = xs(c);
      expect(x[3]).toBeGreaterThan(x[2]);                 // one step to the right of the benchmark's last print
    } finally { clock.mockRestore(); }
  });
  it('does the same on 1W, and asks for the benchmark again after a minute there too', async () => {
    // 1W's window is cut from the calendar (`anchorDateFor`, which reads `new Date()`), so the whole Date is faked here,
    // not just Date.now; the timers stay real.
    const t0 = Date.parse(`${DAY}T19:40:30Z`);
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    try {
      const view = render(chart({ portfolio: LIVE, refreshedAt: t0, rangeKey: '1W' }));
      await flush();
      await answer('sp');
      await answer('tickers');
      ctl.batches.length = 0;                             // the other ranges' warm-up
      const c = view.container;
      expect(legend(c)).toEqual(['PORTFOLIO+25.00%', 'S&P 500+4.00%']);
      expect(portY(c)).toHaveLength(4);
      expect(spY(c)).toHaveLength(3);
      // Seventy seconds on, the benchmark alone is past its minute; the holdings' fifteen are not.
      vi.setSystemTime(t0 + 70e3);
      view.rerender(chart({ portfolio: LIVE, refreshedAt: t0 + 70e3, rangeKey: '1W' }));
      await flush();
      expect(ctl.batches.map((b) => b.symbols.join(','))).toEqual(['^GSPC']);
    } finally { vi.useRealTimers(); }
  });
  it('adds no point once the benchmark has stopped trading: its last bar stays the right edge, valued live', async () => {
    const t0 = Date.parse(`${DAY}T23:00:00Z`);          // 3½ hours after the last bar
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const view = render(chart({ portfolio: LIVE, refreshedAt: t0 }));
      await flush();
      await answer('sp');
      await answer('tickers');
      expect(legend(view.container)).toEqual(['PORTFOLIO+25.00%', 'S&P 500+4.00%']);
      expect(portY(view.container)).toHaveLength(3);
      expect(spY(view.container)).toHaveLength(3);
    } finally { clock.mockRestore(); }
  });
});
