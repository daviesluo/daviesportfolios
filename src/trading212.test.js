// Pin the lots-merge shape so a future change to applyTrading212
// can't silently break the VUAA.L / SAEM.L auto-sync. The
// fetchTrading212Holdings path is just a fetch wrapper — covered by
// the Edge Function's deno tests, not retested here.

import { describe, it, expect, vi } from 'vitest';
import {
  applyTrading212,
  applyTrading212NightPrice,
  clearTrading212OrdersCache,
  fetchTrading212Orders,
  lotsFromOrders,
  stripClosedFromPositions,
} from './trading212.js';

describe('applyTrading212', () => {
  it('syncs the T212 slice without replacing the user ledger; leaves other tickers alone', () => {
    const holdings = {
      'VUAA.L': {
        currency: 'USD',
        lastPrice: 110,
        lots: [{ date: '2024-01-01', shares: 5, cost: 100 }],  // 100 USD/share AC
        shares: 5,
        cost: 100,
      },
      'SAEM.L': {
        currency: 'USD',
        lastPrice: 12,
        lots: [{ date: '2024-06-01', shares: 100, cost: 10 }], // 10 USD/share AC
        shares: 100,
        cost: 10,
      },
      'NVDA': {
        currency: 'USD',
        lastPrice: 200,
        lots: [{ date: '2024-01-01', shares: 10, cost: 150 }], // 150 USD/share AC
        shares: 10,
        cost: 150,
      },
    };
    // T212-shaped: per-share AC in the instrument's settle currency
    // (USD for both VUAA.L / SAEM.L — both USD-denominated UCITS
    // ETFs on LSE; matches what shapeT212Portfolio returns).
    const t212 = {
      'VUAA.L': { shares: 12.3, cost: 105.5 },
      'SAEM.L': { shares: 150,  cost: 11.67 },
    };
    const out = applyTrading212(holdings, t212, undefined, '2026-05-15');
    // The broker is authoritative for its slice, but not for another
    // broker's lots/sells on the same board ticker.
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
    expect(out['VUAA.L'].shares).toBe(12.3);
    expect(out['VUAA.L'].cost).toBe(105.5);
    expect(out['VUAA.L'].t212Shares).toBe(12.3);
    expect(out['VUAA.L'].t212Cost).toBe(105.5);
    // No prices map passed → price fields stay untouched.
    expect(out['VUAA.L'].currency).toBe('USD');
    expect(out['VUAA.L'].lastPrice).toBe(110);
    expect(out['SAEM.L'].lots).toEqual([{ date: '2024-06-01', shares: 100, cost: 10 }]);
    // NVDA isn't in the T212 response — leave it exactly as it was.
    expect(out['NVDA']).toBe(holdings['NVDA']);
    expect(out['NVDA'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 150 }]);
  });

  it('stamps today only on the FIRST sync, when there is nothing to preserve', () => {
    const out = applyTrading212(
      { 'VUAA.L': { currency: 'USD', lastPrice: 110 } },
      { 'VUAA.L': { shares: 1, cost: 100 } }, undefined, '2026-05-15',
    );
    expect(out['VUAA.L'].lots).toEqual([{
      date: '2026-05-15', shares: 1, cost: 100, source: 't212-synthetic',
    }]);
  });

  it('keeps the EARLIEST date when the holding carries several lots', () => {
    const out = applyTrading212(
      { 'VUAA.L': { lots: [
        { date: '2025-03-04', shares: 2, cost: 90 },
        { date: '2024-02-02', shares: 3, cost: 80 },
      ] } },
      { 'VUAA.L': { shares: 5, cost: 84 } }, undefined, '2026-05-15',
    );
    expect(out['VUAA.L'].lots).toEqual([
      { date: '2025-03-04', shares: 2, cost: 90 },
      { date: '2024-02-02', shares: 3, cost: 80 },
    ]);
  });

  it('null T212 input → holdings untouched (network failure / API key absent)', () => {
    const holdings = {
      'VUAA.L': { lots: [{ date: '2024-01-01', shares: 5, cost: 100 }], shares: 5, cost: 100 },
    };
    const out = applyTrading212(holdings, null);
    expect(out).toBe(holdings);
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
  });

  it('T212 ticker not in holdings → ignored (no phantom holdings created)', () => {
    const holdings = { 'NVDA': { lots: [], shares: 0, cost: 0 } };
    const t212 = { 'VUAA.L': { shares: 5, cost: 100 } };
    applyTrading212(holdings, t212, undefined, '2026-05-15');
    expect(holdings['VUAA.L']).toBeUndefined();
    expect(holdings['NVDA']).toEqual({ lots: [], shares: 0, cost: 0 });
  });

  it('no prices map → price fields untouched (shares/cost only)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 100, prevClose: 98, dayPct: 2.04, extPrice: null,
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 6, cost: 95 } };
    const out = applyTrading212(holdings, t212, undefined, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(100);          // untouched
    expect(out['VUAA.L'].dayPct).toBeCloseTo(2.04, 6);  // untouched
    expect(out['VUAA.L'].shares).toBe(6);               // shares/cost synced
    expect(out['VUAA.L'].cost).toBe(95);
  });

  it('with a prices map → uses the T212 quote as lastPrice + recomputes dayPct vs prevClose (USD)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 144.46,   // stale Yahoo close
        prevClose: 144.46,   // yesterday's close (USD)
        dayPct: 0, extPrice: null, currency: 'USD',
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212   = { 'VUAA.L': { shares: 6, cost: 95 } };
    const prices = { 'VUAA.L': 145.08 };   // broker's live quote
    const out = applyTrading212(holdings, t212, prices, '2026-07-02');
    expect(out['VUAA.L'].lastPrice).toBe(145.08);           // T212 quote wins
    expect(out['VUAA.L'].currency).toBe('USD');             // pinned USD
    expect(out['VUAA.L'].dayPct).toBeCloseTo(0.4292, 3);    // (145.08-144.46)/144.46*100
    expect(out['VUAA.L'].shares).toBe(6);                   // shares/cost still synced
    expect(out['VUAA.L'].cost).toBe(95);
  });

  it('prices map without an entry for the ticker → that ticker keeps its Yahoo price', () => {
    const holdings = {
      'VUAA.L': { lastPrice: 110, prevClose: 108, dayPct: 1.85, currency: 'USD',
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90 },
    };
    const t212   = { 'VUAA.L': { shares: 6, cost: 95 } };
    const prices = { 'SAEM.L': 10.6 };   // no VUAA.L quote this tick
    const out = applyTrading212(holdings, t212, prices, '2026-07-02');
    expect(out['VUAA.L'].lastPrice).toBe(110);             // untouched (Yahoo fallback)
    expect(out['VUAA.L'].dayPct).toBeCloseTo(1.85, 6);
  });

  it('takes the broker as the whole position on FIRST sync, then applies deltas', () => {
    // Measured on the real book: the board said 24 shares of GOOG
    // against the broker's 22, and had PLTR recorded as sold out while
    // 55 shares sat in the account. Preserving the board's excess as an
    // assumed other-broker slice would have frozen both errors in place
    // with no way back — so an untagged ticker takes the broker's number.
    const holdings = {
      'VUAA.L': {
        lastPrice: 100,
        shares: 10,
        cost: 90,
        lots: [{ date: '2024-01-01', shares: 10, cost: 90 }],
      },
    };
    const first = applyTrading212(
      holdings,
      { 'VUAA.L': { shares: 4, cost: 80 } },
      undefined,
      '2026-08-18',
    );
    expect(first['VUAA.L'].shares).toBe(4);
    expect(first['VUAA.L'].cost).toBe(80);
    expect(first['VUAA.L'].t212Shares).toBe(4);
    // What made the original overwrite destructive was that it also took
    // the ledger with it. The lots are untouched.
    expect(first['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 90 }]);

    // Once tagged, only the slice's DELTA moves. A six-share
    // other-broker slice added by hand afterwards survives every later
    // sync.
    const mixed = { 'VUAA.L': { ...first['VUAA.L'], shares: 10, cost: 86 } };
    const second = applyTrading212(
      mixed,
      { 'VUAA.L': { shares: 5, cost: 82 } },
      undefined,
      '2026-08-19',
    );
    expect(second['VUAA.L'].shares).toBe(11);
    expect(second['VUAA.L'].t212Shares).toBe(5);
    expect(second['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 90 }]);
  });

  it('revives a position the board had recorded as sold out', () => {
    // PLTR: closed at 0 shares on the board, 55 in the account.
    const holdings = {
      PLTR: {
        shares: 0, cost: 0, closed: true, lastPrice: 171.54,
        lots: [{ date: '2024-07-24', shares: 6.5, cost: 26 }],
        sells: [{ date: '2024-08-08', shares: 6.5, price: 28.1 }],
      },
    };
    const out = applyTrading212(holdings, { PLTR: { shares: 55, cost: 123.29 } }, undefined, '2026-08-18');
    expect(out.PLTR.shares).toBe(55);
    expect(out.PLTR.cost).toBe(123.29);
    expect(out.PLTR.closed).toBeUndefined();
    // The 2024 round trip is history and stays exactly as recorded.
    expect(out.PLTR.lots).toEqual([{ date: '2024-07-24', shares: 6.5, cost: 26 }]);
    expect(out.PLTR.sells).toEqual([{ date: '2024-08-08', shares: 6.5, price: 28.1 }]);
  });

  it('removes a sold T212 slice while preserving other-broker shares', () => {
    const holdings = {
      'VUAA.L': {
        shares: 10,
        cost: 90,
        t212Shares: 4,
        t212Cost: 80,
        lots: [{ date: '2024-01-01', shares: 10, cost: 90 }],
      },
    };
    const out = applyTrading212(
      holdings,
      { 'VUAA.L': { shares: 0, cost: 0 } },
      undefined,
      '2026-08-20',
    );
    expect(out['VUAA.L'].shares).toBe(6);
    expect(out['VUAA.L'].cost).toBeCloseTo((10 * 90 - 4 * 80) / 6, 9);
    expect(out['VUAA.L'].closed).not.toBe(true);
  });

  it('marks a T212-only allow-list position closed after a full sale', () => {
    const holdings = {
      'VUAA.L': {
        shares: 4,
        cost: 80,
        t212Shares: 4,
        t212Cost: 80,
        lots: [{ date: '2026-01-01', shares: 4, cost: 80 }],
      },
    };
    const out = applyTrading212(
      holdings,
      { 'VUAA.L': { shares: 0, cost: 0 } },
      undefined,
      '2026-08-20',
    );
    expect(out['VUAA.L'].shares).toBe(0);
    expect(out['VUAA.L'].closed).toBe(true);
    expect(out['VUAA.L'].lots[0].source).toBe('t212-synthetic');
  });

  it('uses the server-carried previous slice for a legacy full sale', () => {
    const holdings = {
      'VUAA.L': {
        shares: 4,
        cost: 80,
        lots: [{ date: '2026-01-01', shares: 4, cost: 80 }],
      },
    };
    const out = applyTrading212(
      holdings,
      {
        'VUAA.L': {
          shares: 0,
          cost: 0,
          previousShares: 4,
          previousCost: 80,
        },
      },
      undefined,
      '2026-08-20',
    );
    expect(out['VUAA.L'].shares).toBe(0);
    expect(out['VUAA.L'].closed).toBe(true);
  });
});

describe('stripClosedFromPositions', () => {
  it('removes a newly closed T212-only holding from the board', () => {
    const portfolio = {
      holdings: {
        ETF: { shares: 0, closed: true },
        KEEP: { shares: 2 },
      },
      positions: {
        CB1: { tickers: ['ETF'] },
        CM: { tickers: ['KEEP'] },
      },
    };
    const out = stripClosedFromPositions(portfolio);
    expect(out.positions.CB1.tickers).toEqual([]);
    expect(out.positions.CM).toBe(portfolio.positions.CM);
    expect(out.holdings.ETF.t212PositionKey).toBe('CB1');

    const reopened = stripClosedFromPositions({
      ...out,
      holdings: {
        ...out.holdings,
        ETF: { ...out.holdings.ETF, shares: 1, closed: false },
      },
    });
    expect(reopened.positions.CB1.tickers).toEqual(['ETF']);
    expect(reopened.holdings.ETF.t212PositionKey).toBeUndefined();

    const movedThenClosed = stripClosedFromPositions({
      ...reopened,
      holdings: {
        ...reopened.holdings,
        ETF: { ...reopened.holdings.ETF, shares: 0, closed: true, t212PositionKey: 'CB1' },
      },
      positions: {
        ...reopened.positions,
        CB1: { tickers: [] },
        CM: { tickers: ['KEEP', 'ETF'] },
      },
    });
    expect(movedThenClosed.holdings.ETF.t212PositionKey).toBe('CM');
  });
});

describe('applyTrading212NightPrice', () => {
  const usHolding = (over = {}) => ({
    currency: 'USD', lastPrice: 200, prevClose: 198, dayPct: 1.0,
    extPrice: null, extDayPct: null, shares: 10, cost: 150, ...over,
  });

  it('active → overrides extPrice + extPriceTrusted + extDayPct for US equities in the intersection', () => {
    const holdings = { AAPL: usHolding({ lastPrice: 200 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.AAPL.extPrice).toBe(206);
    expect(out.AAPL.extPriceTrusted).toBe(true);
    expect(out.AAPL.extDayPct).toBeCloseTo(3, 6); // (206-200)/200*100
    // lastPrice (regular close) is left as the baseline.
    expect(out.AAPL.lastPrice).toBe(200);
  });

  it('inactive (not overnight / ext off) → no-op, original Yahoo logic preserved', () => {
    const holdings = { AAPL: usHolding({ extPrice: 201, extDayPct: 0.5 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, false);
    expect(out.AAPL.extPrice).toBe(201);   // unchanged
    expect(out.AAPL.extDayPct).toBe(0.5);  // unchanged
  });

  it('skips non-US-equity tickers (LSE ETFs etc. have no US overnight session)', () => {
    const holdings = { 'VUAA.L': { lastPrice: 98, extPrice: null, currency: 'USD' } };
    const prices = { 'VUAA.L': 99 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out['VUAA.L'].extPrice).toBeNull(); // .L → not US equity → skipped
  });

  it('skips OTC ADRs with no overnight session (SFTBY) even though they are US-shaped', () => {
    // SFTBY passes isUsEquity (no suffix) but has no T212 night market —
    // its currentPrice is just the stale RTH/AH close, so we must NOT
    // surface it as a live overnight quote. Leave it on Yahoo.
    const holdings = { SFTBY: usHolding({ lastPrice: 25, extPrice: null }) };
    const prices = { SFTBY: 25.01 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.SFTBY.extPrice).toBeNull();  // excluded by hasOvernightSession
  });

  it('skips tickers not held in the portfolio (T212-only, e.g. a T212 stock not on the board)', () => {
    const holdings = { AAPL: usHolding() };
    const prices = { TSLA: 412 }; // TSLA in T212 but not in local holdings
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.TSLA).toBeUndefined();
    expect(out.AAPL.extPrice).toBeNull(); // AAPL has no T212 price → untouched
  });

  it('no usable lastPrice baseline → extDayPct null but extPrice still set', () => {
    const holdings = { AAPL: usHolding({ lastPrice: 0 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.AAPL.extPrice).toBe(206);
    expect(out.AAPL.extDayPct).toBeNull();
  });

  it('null prices / null holdings → no-op', () => {
    expect(applyTrading212NightPrice(/** @type {any} */ (null), { AAPL: 1 }, true)).toBeNull();
    const h = { AAPL: usHolding() };
    expect(applyTrading212NightPrice(h, null, true)).toBe(h);
  });
});

describe('lotsFromOrders — real purchase history replacing the guess', () => {
  const fills = [
    { ticker: 'VUAA.L', executed_at: '2024-02-02T09:00:00Z', side: 'buy',  shares: 3, price: 80, account: 'invest' },
    { ticker: 'VUAA.L', executed_at: '2025-03-04T10:30:00Z', side: 'buy',  shares: 2, price: 90, account: 'isa' },
    { ticker: 'VUAA.L', executed_at: '2025-06-01T11:00:00Z', side: 'sell', shares: 1, price: 95, account: 'invest' },
    { ticker: 'AAPL',   executed_at: '2025-01-01T00:00:00Z', side: 'buy',  shares: 9, price: 10, account: 'invest' },
  ];

  it('builds dated lots and sells, oldest first, across both accounts', () => {
    // The board has one row per ticker; which T212 account a share sits
    // in isn't something the ledger models.
    const out = /** @type {any} */ (lotsFromOrders(fills, 'VUAA.L'));
    expect(out.lots).toEqual([
      { date: '2024-02-02', shares: 3, cost: 80 },
      { date: '2025-03-04', shares: 2, cost: 90 },
    ]);
    expect(out.sells).toEqual([{ date: '2025-06-01', shares: 1, price: 95 }]);
  });

  it('returns null when there is nothing to rebuild from', () => {
    // The caller keeps whatever it had — an unfinished backfill must not
    // empty a position's ledger.
    expect(lotsFromOrders(fills, 'NVDA')).toBeNull();
    expect(lotsFromOrders([], 'VUAA.L')).toBeNull();
    expect(lotsFromOrders(/** @type {any} */ (null), 'VUAA.L')).toBeNull();
    // Sells alone can't make a ledger either.
    expect(lotsFromOrders([{ ticker: 'X', executed_at: '2025-01-01T00:00:00Z', side: 'sell', shares: 1, price: 5 }], 'X'))
      .toBeNull();
  });

  it('skips malformed fills rather than poisoning the ledger', () => {
    const out = /** @type {any} */ (lotsFromOrders([
      { ticker: 'X', executed_at: '2025-01-01T00:00:00Z', side: 'buy', shares: 1, price: 5 },
      { ticker: 'X', executed_at: '2025-01-02T00:00:00Z', side: 'buy', shares: 0, price: 5 },
      { ticker: 'X', executed_at: '', side: 'buy', shares: 1, price: 5 },
      { ticker: 'X', executed_at: '2025-01-03T00:00:00Z', side: 'buy', shares: 1, price: 0 },
    ], 'X'));
    expect(out.lots).toEqual([{ date: '2025-01-01', shares: 1, cost: 5 }]);
  });
});

describe('fetchTrading212Orders — completion cache', () => {
  it('downgrades complete after a server-side reset without dropping good rows', async () => {
    clearTrading212OrdersCache();
    const fill = {
      ticker: 'NVDA', executed_at: '2026-01-01T00:00:00Z',
      side: 'buy', shares: 1, price: 100,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [fill], complete: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [], complete: false }) });
    vi.stubGlobal('fetch', fetchMock);
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(await fetchTrading212Orders()).toEqual({ rows: [fill], complete: true });
      nowSpy.mockReturnValue(now + 11 * 60 * 1000);
      expect(await fetchTrading212Orders()).toEqual({ rows: [fill], complete: false });
    } finally {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
      clearTrading212OrdersCache();
    }
  });
});

describe('applyTrading212 — orders never replace the board ledger', () => {
  it('keeps allow-list manual history when the backfill has reached the ticker', () => {
    const holdings = { 'VUAA.L': { currency: 'USD', lastPrice: 110,
                                   lots: [{ date: '2024-01-01', shares: 5, cost: 100 }], shares: 5, cost: 100 } };
    const out = applyTrading212(
      holdings, { 'VUAA.L': { shares: 5, cost: 84 } }, undefined, '2026-05-15',
      [
        { ticker: 'VUAA.L', executed_at: '2024-02-02T00:00:00Z', side: 'buy', shares: 3, price: 80 },
        { ticker: 'VUAA.L', executed_at: '2025-03-04T00:00:00Z', side: 'buy', shares: 2, price: 90 },
      ],
    );
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
    // Shares and cost still come from the broker's own position figure,
    // which is authoritative for what is held right now.
    expect(out['VUAA.L'].shares).toBe(5);
    expect(out['VUAA.L'].cost).toBe(84);
  });

  it('keeps the manual lot while the backfill is unfinished', () => {
    const holdings = { 'VUAA.L': { lots: [{ date: '2024-01-01', shares: 5, cost: 100 }], shares: 5, cost: 100 } };
    const out = applyTrading212(holdings, { 'VUAA.L': { shares: 5, cost: 84 } }, undefined, '2026-05-15', []);
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
  });

  it('does not stamp T212 fills onto a non-allow-list ticker', () => {
    const holdings = {
      NVDA: { currency: 'USD', lastPrice: 200, lots: [{ date: '2024-01-01', shares: 10, cost: 150 }], shares: 10, cost: 150 },
    };
    const out = applyTrading212(
      holdings, {}, undefined, '2026-05-15',
      [
        { ticker: 'NVDA', executed_at: '2025-10-30T00:00:00Z', side: 'buy', shares: 4, price: 140 },
        { ticker: 'NVDA', executed_at: '2026-01-08T00:00:00Z', side: 'buy', shares: 6, price: 160 },
      ],
    );
    expect(out.NVDA.lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 150 }]);
    expect(out.NVDA.shares).toBe(10);
    expect(out.NVDA.cost).toBe(150);
  });

  it('preserves other-platform lots and sells on a mixed ticker', () => {
    const holdings = {
      NVDA: {
        currency: 'USD',
        shares: 10,
        cost: 176,
        lots: [{ date: '2024-06-01', shares: 6, cost: 200 }],
        sells: [{ date: '2025-02-01', shares: 1, price: 220 }],
      },
    };
    const before = structuredClone(holdings.NVDA);
    applyTrading212(
      holdings,
      {},
      undefined,
      '2026-08-18',
      [{ ticker: 'NVDA', executed_at: '2026-01-08T00:00:00Z', side: 'buy', shares: 4, price: 140 }],
    );
    expect(holdings.NVDA).toEqual(before);
  });
});
