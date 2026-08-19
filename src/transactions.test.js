// Pin tests for the transaction-ledger accounting. The net-cash model is
// the user's spec: a sale's realized P&L folds into the remaining cost
// basis (sell high → lower AC on the shares you keep; sell-then-rebuy-lower
// carries the gain into the new basis). These cases nail the headline
// example and the partial / loss / over-sell edges so a refactor can't
// quietly drift the cost basis or realized G/L.

import { describe, it, expect } from 'vitest';
import { cleanSells, netPosition, realizedGain, buildTransactionLog, totalRealizedUsd,
         toLedgerRows, fromLedgerRows } from './transactions.js';
import { cleanLots } from './lots.js';

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

  it('preserves an entry timestamp (ts) when present, omits it otherwise', () => {
    const out = cleanSells([
      { date: '2026-01-01', shares: 2, price: 5, ts: 1717000000000 },
      { date: '2026-01-02', shares: 1, price: 6 },
    ]);
    expect(out[0]).toEqual({ date: '2026-01-01', shares: 2, price: 5, ts: 1717000000000 });
    expect(out[1]).toEqual({ date: '2026-01-02', shares: 1, price: 6 }); // no ts key
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

  it('FRACTIONAL full close nets to an EXACT 0 (float dust snapped)', () => {
    // 0.1 + 0.2 buys, one 0.3 sell: raw float math gives ±5.55e-17, which
    // failed updateHolding's `shares <= 0` close check — the sold-out
    // holding stayed on the board and in the header ticker count.
    const r = netPosition(
      [{ date: '2026-01-01', shares: 0.1, cost: 100 }, { date: '2026-02-01', shares: 0.2, cost: 110 }],
      [{ date: '2026-07-01', shares: 0.3, price: 120 }],
    );
    expect(r.shares).toBe(0);       // exactly 0, not 5.55e-17
    expect(r.avgCost).toBe(0);
    // ...while a REAL tiny fractional position survives the snap.
    const tiny = netPosition([{ date: '2026-01-01', shares: 0.0000001, cost: 100 }], []);
    expect(tiny.shares).toBeCloseTo(0.0000001, 12);
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

  it('hides the auto-invested ETFs — 155 fractional buys nobody decided on', () => {
    // Not because the rows are fake (they are real fills now) but because
    // cashback and spare-change auto-invest bury the trades the owner
    // actually made. This view is a record of decisions.
    const log = buildTransactionLog({
      NVDA: { currency: 'USD', lots: [{ date: '2026-01-10', shares: 10, cost: 100 }] },
      'VUAA.L': { currency: 'USD', lots: [{ date: '2026-01-11', shares: 2, cost: 90 }] },
      'SAEM.L': { currency: 'USD', lots: [{ date: '2026-01-12', shares: 1, cost: 50 }] },
    });
    expect(log.map((r) => r.ticker)).toEqual(['NVDA']);
  });

  it('guards empty / null', () => {
    expect(buildTransactionLog(null)).toEqual([]);
    expect(buildTransactionLog({})).toEqual([]);
  });

  it('orders same-day rows by record time (ts), newest entry first', () => {
    // Three buys all dated the same day, across two tickers, added in a
    // known order. Date alone ties; ts breaks it by actual record time —
    // NOT alphabetically-by-ticker (the bug this fixes).
    const log = buildTransactionLog({
      ZZZ: { currency: 'USD', lots: [
        { date: '2026-02-01', shares: 1, cost: 10, ts: 100 }, // added 1st
        { date: '2026-02-01', shares: 1, cost: 11, ts: 300 }, // added 3rd
      ] },
      AAA: { currency: 'USD', lots: [
        { date: '2026-02-01', shares: 1, cost: 12, ts: 200 }, // added 2nd
      ] },
    });
    expect(log.map((r) => `${r.ticker}@${r.ts}`)).toEqual(['ZZZ@300', 'AAA@200', 'ZZZ@100']);
  });

  it('a timestamped row sorts above a same-day ts-less (legacy) row', () => {
    const log = buildTransactionLog({
      AAA: { currency: 'USD', lots: [{ date: '2026-02-01', shares: 1, cost: 10 }] },          // no ts
      ZZZ: { currency: 'USD', lots: [{ date: '2026-02-01', shares: 1, cost: 12, ts: 500 }] }, // ts
    });
    expect(log.map((r) => r.ticker)).toEqual(['ZZZ', 'AAA']); // ts'd first despite Z > A
  });

  it('still falls back to the stable order when same-day rows all lack ts', () => {
    const log = buildTransactionLog({
      ZZZ: { currency: 'USD', lots: [{ date: '2026-02-01', shares: 1, cost: 10 }] },
      AAA: { currency: 'USD', lots: [{ date: '2026-02-01', shares: 1, cost: 12 }] },
    });
    expect(log.map((r) => r.ticker)).toEqual(['AAA', 'ZZZ']); // alphabetical tie-break unchanged
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

  it('leaves the auto-invested ETFs out of the realized total too', () => {
    const holdings = {
      NVDA: { currency: 'USD', lots: [{ date: '2026-01-01', shares: 10, cost: 100 }], sells: [{ date: '2026-02-01', shares: 10, price: 120 }] }, // +200
      'VUAA.L': { currency: 'USD', lots: [{ date: '2026-01-01', shares: 10, cost: 50 }], sells: [{ date: '2026-02-01', shares: 10, price: 80 }] }, // +300, hidden
    };
    expect(totalRealizedUsd(holdings, fxRate)).toBe(200);
  });

  it('guards empty / null', () => {
    expect(totalRealizedUsd(null, fxRate)).toBe(0);
    expect(totalRealizedUsd({}, fxRate)).toBe(0);
  });
});

describe('toLedgerRows / fromLedgerRows', () => {
  const HOLDING = {
    lots: [
      { date: '2025-11-13', shares: 1, cost: 45.97 },
      { date: '2026-08-18', shares: 3, cost: 71.2, src: 'other' },
    ],
    sells: [{ date: '2026-08-17', shares: 2, price: 70, ts: 5 }],
  };

  it('merges buys and sells into one list, newest first', () => {
    expect(toLedgerRows(HOLDING).map((r) => `${r.date}:${r.kind}`)).toEqual([
      '2026-08-18:buy',
      '2026-08-17:sell',
      '2025-11-13:buy',
    ]);
  });

  it('breaks a same-day tie by entry time, newest first', () => {
    const rows = toLedgerRows({
      lots: [{ date: '2026-08-18', shares: 1, cost: 10, ts: 100 }],
      sells: [{ date: '2026-08-18', shares: 1, price: 12, ts: 200 }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['sell', 'buy']);
  });

  it('round-trips back to lots and sells, keeping src and ts', () => {
    const { lots, sells } = fromLedgerRows(toLedgerRows(HOLDING));
    expect(cleanLots(lots)).toEqual([
      { date: '2025-11-13', shares: 1, cost: 45.97 },
      { date: '2026-08-18', shares: 3, cost: 71.2, src: 'other' },
    ]);
    expect(cleanSells(sells)).toEqual([{ date: '2026-08-17', shares: 2, price: 70, ts: 5 }]);
  });

  it('survives a holding with no ledger at all', () => {
    expect(toLedgerRows({})).toEqual([]);
    expect(fromLedgerRows(undefined)).toEqual({ lots: [], sells: [] });
  });
});
