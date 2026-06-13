// Pin tests for the transaction-ledger accounting. The net-cash model is
// the user's spec: a sale's realized P&L folds into the remaining cost
// basis (sell high → lower AC on the shares you keep; sell-then-rebuy-lower
// carries the gain into the new basis). These cases nail the headline
// example and the partial / loss / over-sell edges so a refactor can't
// quietly drift the cost basis or realized G/L.

import { describe, it, expect } from 'vitest';
import { cleanSells, netPosition, realizedGain, buildTransactionLog, totalRealizedUsd } from './transactions.js';

describe('cleanSells', () => {
  it('keeps finite shares>0 / price>=0 / valid past dates, sorted ascending', () => {
    const out = cleanSells([
      { date: '2026-03-02', shares: '5', price: '120' },
      { date: '2026-01-01', shares: 3, price: 0 }, // price 0 allowed
      { date: '2026-02-01', shares: 2, price: 99 },
    ]);
    expect(out).toEqual([
      { date: '2026-01-01', shares: 3, price: 0 },
      { date: '2026-02-01', shares: 2, price: 99 },
      { date: '2026-03-02', shares: 5, price: 120 },
    ]);
  });

  it('drops zero / negative / NaN shares, negative price, malformed + future dates', () => {
    const today = new Date().toISOString().slice(0, 10);
    const future = '2999-01-01';
    expect(cleanSells([
      { date: '2026-01-01', shares: 0, price: 10 },       // shares 0
      { date: '2026-01-01', shares: -2, price: 10 },      // shares < 0
      { date: '2026-01-01', shares: 'x', price: 10 },     // NaN
      { date: '2026-01-01', shares: 2, price: -5 },       // price < 0
      { date: '01-01-2026', shares: 2, price: 5 },        // bad date
      { date: future, shares: 2, price: 5 },              // future
    ])).toEqual([]);
    // sanity: a today-dated row survives
    expect(cleanSells([{ date: today, shares: 1, price: 1 }])).toHaveLength(1);
  });

  it('guards non-array', () => {
    // @ts-expect-error exercising the guard
    expect(cleanSells(null)).toEqual([]);
  });
});

describe('netPosition (net-cash model)', () => {
  it('no sells → plain weighted buy position', () => {
    const r = netPosition([{ date: '2026-01-01', shares: 10, cost: 100 }], []);
    expect(r).toEqual({ shares: 10, netCash: 1000, avgCost: 100 });
  });

  it("the headline example: buy 10@100, sell 10@120, rebuy 10@90 → 10 sh @ AC 70", () => {
    const lots = [
      { date: '2026-01-01', shares: 10, cost: 100 },
      { date: '2026-03-01', shares: 10, cost: 90 },
    ];
    const sells = [{ date: '2026-02-01', shares: 10, price: 120 }];
    const r = netPosition(lots, sells);
    expect(r.shares).toBe(10);
    expect(r.netCash).toBe(700); // 1900 bought − 1200 sold
    expect(r.avgCost).toBe(70);  // banked $30/sh round-trip gain lowers AC
  });

  it('partial sell above cost lowers the remaining AC', () => {
    const r = netPosition([{ date: '2026-01-01', shares: 10, cost: 100 }], [{ date: '2026-02-01', shares: 5, price: 120 }]);
    expect(r).toEqual({ shares: 5, netCash: 400, avgCost: 80 });
  });

  it('full close → 0 shares, AC 0', () => {
    const r = netPosition([{ date: '2026-01-01', shares: 10, cost: 100 }], [{ date: '2026-02-01', shares: 10, price: 80 }]);
    expect(r.shares).toBe(0);
    expect(r.avgCost).toBe(0);
    expect(r.netCash).toBe(200); // spent 1000, recovered 800 at a loss
  });

  it('over-sell yields negative shares (caller can flag the data error)', () => {
    const r = netPosition([{ date: '2026-01-01', shares: 5, cost: 100 }], [{ date: '2026-02-01', shares: 8, price: 120 }]);
    expect(r.shares).toBe(-3);
    expect(r.avgCost).toBe(0);
  });
});

describe('realizedGain', () => {
  it('is 0 when nothing was sold', () => {
    expect(realizedGain([{ date: '2026-01-01', shares: 10, cost: 100 }], [])).toBe(0);
  });

  it('banks gain at the average cost in force at sale time', () => {
    // buy 10@100, sell 10@120 → +200; the rebuy doesn't change realized.
    const lots = [
      { date: '2026-01-01', shares: 10, cost: 100 },
      { date: '2026-03-01', shares: 10, cost: 90 },
    ];
    const sells = [{ date: '2026-02-01', shares: 10, price: 120 }];
    expect(realizedGain(lots, sells)).toBe(200);
  });

  it('partial sell realizes only the sold portion', () => {
    expect(realizedGain([{ date: '2026-01-01', shares: 10, cost: 100 }], [{ date: '2026-02-01', shares: 5, price: 120 }])).toBe(100);
  });

  it('a sale below cost realizes a loss', () => {
    expect(realizedGain([{ date: '2026-01-01', shares: 10, cost: 100 }], [{ date: '2026-02-01', shares: 10, price: 80 }])).toBe(-200);
  });

  it('processes in date order regardless of input order', () => {
    // Same as the headline example but sells listed before the rebuy lot.
    const lots = [
      { date: '2026-03-01', shares: 10, cost: 90 },
      { date: '2026-01-01', shares: 10, cost: 100 },
    ];
    const sells = [{ date: '2026-02-01', shares: 10, price: 120 }];
    expect(realizedGain(lots, sells)).toBe(200);
  });
});

describe('buildTransactionLog', () => {
  const holdings = {
    NVDA: {
      currency: 'USD',
      lots: [{ date: '2026-01-10', shares: 10, cost: 100 }],
      sells: [{ date: '2026-03-05', shares: 4, price: 130 }],
    },
    'XFAB.PA': {
      currency: 'EUR',
      lots: [{ date: '2026-02-01', shares: 50, cost: 8 }],
    },
    CASH: { isCash: true, shares: 1, cost: 0 },
    // A CLOSED holding (net 0, off the board but kept) still contributes.
    OLDCO: {
      currency: 'USD', closed: true, shares: 0,
      lots: [{ date: '2026-01-02', shares: 5, cost: 50 }],
      sells: [{ date: '2026-02-20', shares: 5, price: 70 }],
    },
  };

  it('merges every holding\'s buys + sells, newest first, cash excluded', () => {
    const log = buildTransactionLog(holdings);
    expect(log.map((r) => `${r.date} ${r.ticker} ${r.kind}`)).toEqual([
      '2026-03-05 NVDA sell',
      '2026-02-20 OLDCO sell',
      '2026-02-01 XFAB.PA buy',
      '2026-01-10 NVDA buy',
      '2026-01-02 OLDCO buy',
    ]);
    // No CASH row, and the closed holding's records are present.
    expect(log.some((r) => r.ticker === 'CASH')).toBe(false);
    expect(log.filter((r) => r.ticker === 'OLDCO')).toHaveLength(2);
  });

  it('carries the native price + currency on each row', () => {
    const log = buildTransactionLog(holdings);
    const eur = log.find((r) => r.ticker === 'XFAB.PA');
    expect(eur).toMatchObject({ kind: 'buy', shares: 50, price: 8, currency: 'EUR' });
    const sell = log.find((r) => r.ticker === 'NVDA' && r.kind === 'sell');
    expect(sell).toMatchObject({ shares: 4, price: 130, currency: 'USD' });
  });

  it('guards empty / null', () => {
    expect(buildTransactionLog(null)).toEqual([]);
    expect(buildTransactionLog({})).toEqual([]);
  });
});

describe('totalRealizedUsd', () => {
  const fxRate = (cur) => (cur === 'EUR' ? 1.1 : cur === 'GBP' ? 1.25 : 1);

  it('sums each holding\'s native realized gain converted to USD', () => {
    const holdings = {
      NVDA: { currency: 'USD', lots: [{ date: '2026-01-01', shares: 10, cost: 100 }], sells: [{ date: '2026-02-01', shares: 10, price: 120 }] }, // +200 USD
      'XFAB.PA': { currency: 'EUR', lots: [{ date: '2026-01-01', shares: 10, cost: 8 }], sells: [{ date: '2026-02-01', shares: 5, price: 10 }] }, // +10 EUR → 11 USD
      VOD: { currency: 'USD', lots: [{ date: '2026-01-01', shares: 5, cost: 50 }] }, // no sells → 0
      CASH: { isCash: true },
    };
    // 200 + 11 = 211
    expect(totalRealizedUsd(holdings, fxRate)).toBeCloseTo(211, 6);
  });

  it('counts losses (negative) and closed holdings', () => {
    const holdings = {
      LOSS: { currency: 'USD', closed: true, shares: 0, lots: [{ date: '2026-01-01', shares: 10, cost: 100 }], sells: [{ date: '2026-02-01', shares: 10, price: 80 }] }, // −200
    };
    expect(totalRealizedUsd(holdings, fxRate)).toBe(-200);
  });

  it('guards empty / null', () => {
    expect(totalRealizedUsd(null, fxRate)).toBe(0);
    expect(totalRealizedUsd({}, fxRate)).toBe(0);
  });
});
