// Pin tests for the transaction-ledger accounting. The net-cash model is
// the user's spec: a sale's realized P&L folds into the remaining cost
// basis (sell high → lower AC on the shares you keep; sell-then-rebuy-lower
// carries the gain into the new basis). These cases nail the headline
// example and the partial / loss / over-sell edges so a refactor can't
// quietly drift the cost basis or realized G/L.

import { describe, it, expect } from 'vitest';
import { cleanSells, netPosition, realizedGain, buildTransactionLog, totalRealizedUsd,
         toLedgerRows, fromLedgerRows, annotateLedger } from './transactions.js';
import { withClosedFromFills } from './t212_fills.js';
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

// 2026-10-07: the realized total priced each sale against the NET-CASH average, into which an earlier sale's gain had
// already been folded, so a position sold in two or more pieces booked its first gain twice (and a loss twice). Every
// case below is worked by hand; a sold-out position must read exactly proceeds − cost.
describe('realizedGain — the classic average cost, never a gain twice', () => {
  it('two halves sold at a profit: +100 for a +100 round trip (the net-cash average read +150)', () => {
    const lots = [{ date: '2026-01-01', shares: 10, cost: 10 }];
    const sells = [{ date: '2026-02-01', shares: 5, price: 20 }, { date: '2026-03-01', shares: 5, price: 20 }];
    expect(realizedGain(lots, sells)).toBe(100);
  });

  it('two halves sold at a loss: −200 for a −200 round trip (the net-cash average read −300)', () => {
    const lots = [{ date: '2026-01-01', shares: 10, cost: 100 }];
    const sells = [{ date: '2026-02-01', shares: 5, price: 80 }, { date: '2026-03-01', shares: 5, price: 80 }];
    expect(realizedGain(lots, sells)).toBe(-200);
  });

  it('buys between sales: a sold-out position reads proceeds − cost', () => {
    // buy 10@10, sell 4@15 (+20), buy 6@12 (average 11), sell 12@14 (+36): 56 = (60 + 168) − (100 + 72).
    const lots = [{ date: '2026-01-01', shares: 10, cost: 10 }, { date: '2026-03-01', shares: 6, cost: 12 }];
    const sells = [{ date: '2026-02-01', shares: 4, price: 15 }, { date: '2026-04-01', shares: 12, price: 14 }];
    expect(realizedGain(lots, sells)).toBeCloseTo(56, 10);
  });

  it("the ledger rows: each sale's gain at the classic average, adding up to the total, and the sale shows that average", () => {
    const lots = [{ date: '2026-01-01', shares: 10, cost: 10 }];
    const sells = [{ date: '2026-02-01', shares: 5, price: 20 }, { date: '2026-03-01', shares: 5, price: 20 }];
    const rows = annotateLedger(lots, sells);
    expect(rows.map((r) => r.gain)).toEqual([null, 50, 50]);
    expect(rows.map((r) => r.gainPct)).toEqual([null, 100, 100]);
    // Each sale reads the average it was measured against, the closing one included (2026-10-07: it read blank).
    expect(rows.map((r) => r.acAfter)).toEqual([10, 10, 10]);
  });

  it('a purchase after a sale still shows the net-cash average the position view shows', () => {
    // buy 10@10, sell 5@20, buy 5@10: net cash 100 − 100 + 50 = 50 over 10 shares = 5; the next sale is measured at 10.
    const lots = [{ date: '2026-01-01', shares: 10, cost: 10 }, { date: '2026-03-01', shares: 5, cost: 10 }];
    const sells = [{ date: '2026-02-01', shares: 5, price: 20 }, { date: '2026-04-01', shares: 10, price: 20 }];
    const rows = annotateLedger(lots, sells);
    expect(rows.map((r) => r.acAfter)).toEqual([10, 10, 5, 10]);
    expect(rows[3].gain).toBeCloseTo(100, 10);
  });
});

describe('totalRealizedUsd — a London fill in pence is booked in pounds', () => {
  it('JEQP: 10 bought at 2000p and sold at 1950p is a £5 loss, not £500', () => {
    const orders = [
      { ticker: 'JEQP.L', side: 'buy', shares: 10, price: 2000, executed_at: '2025-01-10T12:00:00Z' },
      { ticker: 'JEQP.L', side: 'sell', shares: 10, price: 1950, executed_at: '2025-02-10T12:00:00Z' },
    ];
    const all = withClosedFromFills({}, orders);
    expect(all['JEQP.L'].currency).toBe('GBP');
    expect(totalRealizedUsd(all, (c) => (c === 'GBP' ? 1.32 : 1))).toBeCloseTo(-5 * 1.32, 9);
  });

  it.each(['CSPX.L', 'QQQ3.L'])('%s, which trades in dollars, is booked in dollars', (ticker) => {
    const orders = [
      { ticker, side: 'buy', shares: 0.5, price: 500, executed_at: '2025-01-10T12:00:00Z' },
      { ticker, side: 'sell', shares: 0.5, price: 600, executed_at: '2025-02-10T12:00:00Z' },
    ];
    const all = withClosedFromFills({}, orders);
    expect(all[ticker].currency).toBe('USD');
    expect(totalRealizedUsd(all, (c) => (c === 'GBP' ? 1.32 : 1))).toBeCloseTo(50, 9);
  });

  // Every London listing the book has filled at Trading 212, with the currency Yahoo quotes it in (read 2026-10-07).
  // The `.L` suffix says nothing about it: four trade in dollars, one in pence. A new London fill belongs in this table.
  it.each([
    ['VUAA.L', 'USD'], ['SAEM.L', 'USD'], ['CSPX.L', 'USD'], ['QQQ3.L', 'USD'],
    ['JEQP.L', 'GBp'], ['ROLG.L', 'GBP'], ['SEGM.L', 'GBP'], ['VUAG.L', 'GBP'],
  ])('%s is quoted in %s, and its fills are booked that way', (ticker, quoted) => {
    const all = withClosedFromFills({}, [{ ticker, side: 'buy', shares: 1, price: 100, executed_at: '2025-01-10T12:00:00Z' }]);
    expect(all[ticker].currency).toBe(quoted === 'GBp' ? 'GBP' : quoted);
    expect(all[ticker].lots[0].cost).toBe(quoted === 'GBp' ? 1 : 100);
  });
});

// The property that makes the headline trustworthy whatever the ledger: over many random ledgers (buys and partial
// sales interleaved, fractional shares, same-day rows), a position sold out realizes exactly proceeds − cost, an open
// one realizes what its sales took in less the average cost of what they sold, and the rows' gains add up to it.
describe('realizedGain — properties over random ledgers', () => {
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  it('a sold-out position reads proceeds − cost, and the rows add up to the total, on 2,000 ledgers', () => {
    const r = rng(20261007);
    for (let n = 0; n < 2000; n++) {
      const lots = [], sells = [];
      let held = 0, day = 1, proceeds = 0, cost = 0;
      const steps = 2 + Math.floor(r() * 12);
      for (let i = 0; i < steps; i++) {
        const date = `2026-01-${String(Math.min(28, day)).padStart(2, '0')}`;
        if (r() < 0.25) day += 0; else day += 1;
        const price = Math.round((5 + r() * 200) * 100) / 100;
        if (held > 1e-6 && r() < 0.45) {
          const sh = Math.round(held * (0.1 + r() * 0.9) * 1e4) / 1e4;
          if (sh <= 0) continue;
          sells.push({ date, shares: sh, price }); held -= sh; proceeds += sh * price;
        } else {
          const sh = Math.round((0.01 + r() * 20) * 1e4) / 1e4;
          lots.push({ date, shares: sh, cost: price }); held += sh; cost += sh * price;
        }
      }
      if (held > 1e-6) { const date = '2026-02-28'; sells.push({ date, shares: held, price: 100 }); proceeds += held * 100; }
      const total = realizedGain(lots, sells);
      expect(Math.abs(total - (proceeds - cost))).toBeLessThan(1e-6 * Math.max(1, Math.abs(cost)));
      const rows = annotateLedger(lots, sells);
      const rowsSum = rows.reduce((s, x) => s + (x.gain ?? 0), 0);
      expect(Math.abs(rowsSum - total)).toBeLessThan(1e-6 * Math.max(1, Math.abs(cost)));
      // Every sale row checks by hand: its gain is its shares × (its price − the Avg Cost it shows).
      for (const x of rows) if (x.kind === 'sell') expect(Math.abs((x.gain ?? 0) - x.shares * (x.price - x.acAfter))).toBeLessThan(1e-6);
    }
  });
});

// ---- Dividends come off the average cost (Davies, 2026-10-07: "分红的盈利也算起来，直接算在average cost里") ----
// Synthetic numbers only. A dividend is `{ date, ts?, amount, shares? }`, the net cash received in the holding's currency.

describe('dividends — folded into the average cost and the realized figure', () => {
  const lots = [{ date: '2026-01-05', shares: 10, cost: 100 }];
  const div = [{ date: '2026-02-01', amount: 20, shares: 10 }];

  it('netPosition takes the dividends off the net cash; with none it reads exactly as before', () => {
    expect(netPosition(lots, [], div)).toEqual({ shares: 10, netCash: 980, avgCost: 98 });
    const sells = [{ date: '2026-03-01', shares: 4, price: 120 }];
    expect(netPosition(lots, sells, [])).toEqual(netPosition(lots, sells));
    expect(netPosition(lots, sells, null)).toEqual(netPosition(lots, sells));
  });

  it('a sale realizes the dividends received while held: 10 @ 100, 20 paid, sold @ 110 → +120 (proceeds − cost + dividends)', () => {
    const sells = [{ date: '2026-03-01', shares: 10, price: 110 }];
    expect(realizedGain(lots, sells, div)).toBeCloseTo(1100 - 1000 + 20, 9);
    expect(realizedGain(lots, sells)).toBeCloseTo(100, 9);
    const rows = annotateLedger(lots, sells, div);
    expect(rows.map((r) => r.kind)).toEqual(['buy', 'div', 'sell']);
    expect(rows[1]).toMatchObject({ kind: 'div', amount: 20, shares: 10, price: 2, acAfter: 98, gain: null });
    // The sale row's Avg Cost is the classic average it was measured against, net of the dividend.
    expect(rows[2].acAfter).toBeCloseTo(98, 9);
    expect(rows[2].gain).toBeCloseTo(10 * (110 - 98), 9);
  });

  it('half sold before the dividend, half after: the dividend lowers only the later sale\'s cost', () => {
    const sells = [{ date: '2026-01-20', shares: 5, price: 110 }, { date: '2026-03-01', shares: 5, price: 110 }];
    const d = [{ date: '2026-02-01', amount: 10, shares: 5 }];
    const rows = annotateLedger(lots, sells, d);
    expect(rows.filter((r) => r.kind === 'sell').map((r) => r.acAfter)).toEqual([100, 98]);
    expect(realizedGain(lots, sells, d)).toBeCloseTo(1100 - 1000 + 10, 9);
  });

  it('a dividend paid after the last sale is realized as it arrives, and only that row shows a Realised G/L', () => {
    const sells = [{ date: '2026-01-20', shares: 10, price: 105 }];
    const late = [{ date: '2026-02-10', amount: 7, shares: 10 }];
    const rows = annotateLedger(lots, sells, late);
    expect(rows[2]).toMatchObject({ kind: 'div', gain: 7, acAfter: 0 });
    expect(realizedGain(lots, sells, late)).toBeCloseTo(50 + 7, 9);
  });

  it('a buy row after a dividend carries the net-cash average with the dividend off it', () => {
    const more = [...lots, { date: '2026-03-01', shares: 10, cost: 120 }];
    const rows = annotateLedger(more, [], div);
    expect(rows.at(-1)?.acAfter).toBeCloseTo((1000 - 20 + 1200) / 20, 9);
    expect(netPosition(more, [], div).avgCost).toBeCloseTo((1000 - 20 + 1200) / 20, 9);
  });

  it('same-day events follow their time: a dividend stamped before a sale counts toward it', () => {
    const sells = [{ date: '2026-02-01', shares: 10, price: 110, ts: Date.parse('2026-02-01T16:00:00Z') }];
    const d = [{ date: '2026-02-01', amount: 20, ts: Date.parse('2026-02-01T12:00:00Z') }];
    expect(annotateLedger(lots, sells, d).map((r) => r.kind)).toEqual(['buy', 'div', 'sell']);
    expect(annotateLedger(lots, sells, d)[2].gain).toBeCloseTo(120, 9);
  });

  it('buildTransactionLog and totalRealizedUsd carry the dividend rows and their gain; the auto-invested ETFs stay out', () => {
    const holdings = {
      ABC: { currency: 'GBP', lots, sells: [{ date: '2026-03-01', shares: 10, price: 110 }] },
      'VUAA.L': { currency: 'USD', lots: [{ date: '2026-01-05', shares: 1, cost: 100 }] },
    };
    const divs = { ABC: div, 'VUAA.L': [{ date: '2026-02-01', amount: 5 }] };
    const log = buildTransactionLog(holdings, divs);
    expect(log.map((r) => `${r.kind}:${r.ticker}`)).toEqual(['sell:ABC', 'div:ABC', 'buy:ABC']);
    expect(log[1]).toMatchObject({ amount: 20, currency: 'GBP', acAfter: 98, gain: null });
    expect(totalRealizedUsd(holdings, (c) => (c === 'GBP' ? 1.25 : 1), divs)).toBeCloseTo(120 * 1.25, 9);
    expect(totalRealizedUsd(holdings, (c) => (c === 'GBP' ? 1.25 : 1))).toBeCloseTo(100 * 1.25, 9);
  });
});

describe('dividends — properties over random ledgers', () => {
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  it('sold out = proceeds − cost + dividends, rows sum to the total, every sale gains shares × (price − its Avg Cost), on 2,000 ledgers', () => {
    const r = rng(20261008);
    let withDivs = 0;
    for (let n = 0; n < 2000; n++) {
      const lots = [], sells = [], divs = [];
      let held = 0, day = 1, proceeds = 0, cost = 0, received = 0;
      const steps = 2 + Math.floor(r() * 12);
      for (let i = 0; i < steps; i++) {
        const date = `2026-01-${String(Math.min(28, day)).padStart(2, '0')}`;
        const ts = Date.parse(`${date}T00:00:00Z`) + i * 60_000;
        if (r() >= 0.25) day += 1;
        const price = Math.round((5 + r() * 200) * 100) / 100;
        const roll = r();
        if (roll < 0.2) {
          // A dividend: usually while held, sometimes after a sell-out; now and then a negative correction.
          const amount = Math.round((r() < 0.1 ? -1 : 1) * (0.01 + r() * 30) * 100) / 100;
          divs.push({ date, ts, amount, shares: held > 0 ? held : undefined }); received += amount;
        } else if (held > 1e-6 && roll < 0.55) {
          const sh = Math.round(held * (0.1 + r() * 0.9) * 1e4) / 1e4;
          if (sh <= 0) continue;
          sells.push({ date, ts, shares: sh, price }); held -= sh; proceeds += sh * price;
        } else {
          const sh = Math.round((0.01 + r() * 20) * 1e4) / 1e4;
          lots.push({ date, ts, shares: sh, cost: price }); held += sh; cost += sh * price;
        }
      }
      if (held > 1e-6) { sells.push({ date: '2026-02-27', ts: Date.parse('2026-02-27T00:00:00Z'), shares: held, price: 100 }); proceeds += held * 100; }
      if (r() < 0.3) { const amount = 3.21; divs.push({ date: '2026-02-28', amount }); received += amount; }
      if (divs.length) withDivs++;
      const tol = 1e-6 * Math.max(1, Math.abs(cost));
      const total = realizedGain(lots, sells, divs);
      expect(Math.abs(total - (proceeds - cost + received))).toBeLessThan(tol);
      const rows = annotateLedger(lots, sells, divs);
      expect(Math.abs(rows.reduce((s, x) => s + (x.gain ?? 0), 0) - total)).toBeLessThan(tol);
      for (const x of rows.filter((y) => y.kind === 'sell')) {
        expect(Math.abs(/** @type {number} */ (x.gain) - x.shares * (x.price - x.acAfter))).toBeLessThan(tol);
      }
      // Without dividends the walk is the one that was there before.
      expect(realizedGain(lots, sells, [])).toBe(realizedGain(lots, sells));
    }
    expect(withDivs).toBeGreaterThan(1000);
  });
});

describe('the headline is the sum of the rows, same-day trades in the order they happened', () => {
  // Main on 2026-10-07: `realizedGain` sorted by date alone (a day's buys before its sales) while `annotateLedger` sorted
  // by date and time, so on the real book the headline and its own rows disagreed. Bought 10 @ 50; on one day sold 10 @
  // 120 at 10:00 and bought 10 @ 100 at 15:00. The sale came first: 10 × (120 − 50) = +700, not the +450 that pricing
  // it against the afternoon's buy gives.
  it('a sale before a same-day buy is measured against what was held then', () => {
    const day = '2026-03-02';
    const lots = [{ date: '2026-03-01', shares: 10, cost: 50 }, { date: day, shares: 10, cost: 100, ts: Date.parse(`${day}T15:00:00Z`) }];
    const sells = [{ date: day, shares: 10, price: 120, ts: Date.parse(`${day}T10:00:00Z`) }];
    expect(realizedGain(lots, sells)).toBeCloseTo(700, 9);
    expect(annotateLedger(lots, sells).reduce((s, r) => s + (r.gain ?? 0), 0)).toBeCloseTo(700, 9);
  });
});
